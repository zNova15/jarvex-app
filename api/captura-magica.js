// Vercel serverless function: POST /api/captura-magica
//
// Body: { file: "<base64-string>", mimeType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp" }
// Returns: { extracted: {...}, model, usage, raw_text_preview }
//
// Usa Claude Sonnet 4.6 con Vision API para parsear comprobantes peruanos
// (factura, boleta, NC/ND, recibo) desde PDF o imagen y devolver JSON estructurado.
// Requiere ANTHROPIC_API_KEY en Vercel env vars.

const ALLOWED_MIME = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];

// Máximo 8 MB de string base64 (≈6 MB binario)
const MAX_BASE64_BYTES = 8 * 1024 * 1024;

const SYSTEM_PROMPT = `Eres un experto parser de comprobantes peruanos emitidos bajo SUNAT (factura electrónica, boleta de venta, nota de crédito, nota de débito, recibo por honorarios). Tu tarea es leer el documento (PDF o imagen) y extraer los datos a JSON estructurado.

Reglas estrictas:
- NO inventes datos. Si un campo no se ve con confianza, devuelve null.
- RUC peruano: exactamente 11 dígitos, empieza en 10/15/16/17/20.
- DNI peruano: exactamente 8 dígitos.
- Fechas en formato ISO YYYY-MM-DD.
- Moneda: "PEN" (soles, S/) o "USD" (dólares, $). Si no es claro, usa "PEN".
- Tasa IGV peruana estándar es 0.18 (18%). Si el documento muestra otra tasa, úsala.
- Items: cada fila/línea de producto o servicio. Mantén descripciones tal cual aparecen.
- Si el documento NO es un comprobante peruano (boleta/factura/NC/ND/recibo), devuelve tipo_documento="otro" y el resto vacío o null.
- Si la imagen está borrosa, torcida, cortada o ilegible, agrega advertencias específicas y baja la confianza.

Responde SOLO con JSON válido (sin markdown, sin texto extra) con esta estructura exacta:
{
  "tipo_documento": "factura" | "boleta" | "nota_credito" | "nota_debito" | "recibo" | "otro",
  "serie_correlativo": "F001-12345" | null,
  "fecha_emision": "YYYY-MM-DD" | null,
  "fecha_vencimiento": "YYYY-MM-DD" | null,
  "moneda": "PEN" | "USD",
  "emisor": {
    "ruc": "<11 dígitos>" | null,
    "razon_social": string | null,
    "direccion": string | null
  },
  "receptor": {
    "tipo_doc": "RUC" | "DNI" | "OTRO" | null,
    "documento": string | null,
    "razon_social_o_nombre": string | null,
    "direccion": string | null
  },
  "items": [
    {
      "descripcion": string,
      "cantidad": number,
      "unidad": "kg" | "m" | "und" | "bls" | "gal" | "m2" | "m3" | "hr" | string,
      "precio_unitario": number,
      "subtotal": number
    }
  ],
  "totales": {
    "subtotal": number,
    "igv": number,
    "total": number,
    "tasa_igv": number
  },
  "observaciones": string | null,
  "confianza": "alta" | "media" | "baja",
  "advertencias": [string]
}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Solo POST' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'ANTHROPIC_API_KEY no configurada en Vercel. Pídele al admin que la agregue en Project Settings → Environment Variables.',
    });
  }

  const body = req.body || {};
  const file = typeof body.file === 'string' ? body.file.trim() : '';
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType.trim() : '';

  if (!file) {
    return res.status(422).json({ error: 'Falta el campo "file" en base64' });
  }
  if (!mimeType) {
    return res.status(422).json({ error: 'Falta el campo "mimeType"' });
  }
  if (!ALLOWED_MIME.includes(mimeType)) {
    return res.status(422).json({
      error: `mimeType no permitido. Permitidos: ${ALLOWED_MIME.join(', ')}`,
    });
  }

  // Sanitizar base64: remover prefijo data URL si vino incluido
  const cleanBase64 = file.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!cleanBase64) {
    return res.status(422).json({ error: 'El archivo en base64 está vacío' });
  }
  if (cleanBase64.length > MAX_BASE64_BYTES) {
    return res.status(422).json({
      error: `Archivo demasiado grande. Máximo ${Math.floor(MAX_BASE64_BYTES / 1024 / 1024)} MB en base64 (≈6 MB binario)`,
    });
  }
  // Validar que sea base64 razonablemente válido (caracteres permitidos)
  if (!/^[A-Za-z0-9+/=]+$/.test(cleanBase64)) {
    return res.status(422).json({ error: 'El archivo no es base64 válido' });
  }

  // Construir el bloque de contenido según sea PDF o imagen
  const isPdf = mimeType === 'application/pdf';
  const fileBlock = isPdf
    ? {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: cleanBase64 },
      }
    : {
        type: 'image',
        source: { type: 'base64', media_type: mimeType, data: cleanBase64 },
      };

  const userInstruction = `Analiza este comprobante peruano y extrae todos los datos al JSON estructurado descrito en las instrucciones del sistema. Responde SOLO con el JSON, sin texto adicional ni markdown.`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90000);
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [fileBlock, { type: 'text', text: userInstruction }],
          },
        ],
      }),
    });
    clearTimeout(timer);

    if (!upstream.ok) {
      const errText = await upstream.text();
      return res.status(upstream.status).json({
        error: `Claude API respondió ${upstream.status}`,
        detail: errText.slice(0, 500),
      });
    }

    const data = await upstream.json();
    const text = data.content?.[0]?.text || '';

    // Extraer JSON del response (puede venir con markdown wrapping aunque pidamos lo contrario)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(502).json({
        error: 'Claude no devolvió JSON parseable',
        rawText: text.slice(0, 500),
      });
    }

    let extracted;
    try { extracted = JSON.parse(jsonMatch[0]); }
    catch (e) {
      return res.status(502).json({
        error: 'JSON inválido de Claude',
        detail: e.message,
        rawText: text.slice(0, 500),
      });
    }

    return res.status(200).json({
      extracted,
      model: data.model,
      usage: data.usage,
      raw_text_preview: text.slice(0, 300),
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'Claude tardó demasiado (>90s)' });
    }
    return res.status(502).json({ error: 'Error consultando Claude', detail: e.message });
  }
}
