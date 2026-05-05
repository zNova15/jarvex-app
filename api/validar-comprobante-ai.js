// Vercel serverless function: POST /api/validar-comprobante-ai
//
// Body: { comprobante: { tipo, serie, correlativo, fecha, moneda,
//   emisor: {ruc, razon_social},
//   cliente: {tipo_doc, documento, razon_social, direccion},
//   items: [{descripcion, cantidad, precio_unitario, igv_pct, tax_exemption_code}],
//   totales: {subtotal, igv, total}
// } }
// Returns: { result: { valid, errors:[{campo,mensaje,severidad}], warnings:[] },
//            confianza: 0..1, razonamiento, advertencias, model, usage }
//
// Usa Claude Haiku 4.5 (rápido + económico). Detecta errores típicos antes de
// generar el XML SUNAT (RUC/DNI inválido, IGV mal calculado, fecha futura, etc).
// Requiere ANTHROPIC_API_KEY en Vercel env vars.

const SYSTEM_PROMPT = `Eres un auditor experto en comprobantes electrónicos peruanos SUNAT (factura 01, boleta 03, nota de crédito 07, nota de débito 08). Recibirás los datos de un comprobante en JSON y tu tarea es detectar errores ANTES de que se genere el XML UBL 2.1 y se envíe a SUNAT.

Reglas de validación que DEBES aplicar (cada hallazgo va en errors[] o warnings[]):

1. RUC del emisor: exactamente 11 dígitos numéricos, debe empezar en 10, 15, 16, 17 o 20. Si no, severidad "high".
2. Documento del cliente:
   - tipo_doc "6" (RUC) → 11 dígitos numéricos, empieza en 10/15/16/17/20.
   - tipo_doc "1" (DNI) → exactamente 8 dígitos numéricos.
   - tipo_doc "0" o vacío en factura (tipo "01") → severidad "high" (factura requiere RUC).
   - DNI en factura → severidad "high".
3. Razón social del emisor o cliente vacía o < 3 caracteres → severidad "high" (en boleta sin documento → "medium").
4. Items:
   - cantidad <= 0 → severidad "high".
   - precio_unitario < 0 → severidad "high".
   - descripcion vacía → severidad "medium".
   - tax_exemption_code distinto de "10","20","30","40" → severidad "medium" (raro/inválido).
   - tax_exemption_code "10" pero igv_pct distinto de 18 → severidad "medium".
5. Totales (tolerancia ±0.02 por redondeo):
   - subtotal × 0.18 ≈ igv para items gravados → si difiere más de la tolerancia, severidad "high".
   - subtotal + igv ≈ total → si no, severidad "high".
   - Si todos los items son exonerados (20) o inafectos (30), igv debería ser 0 — si no, severidad "high".
6. Serie/correlativo:
   - Factura (tipo "01"): serie debe ser F + 3 dígitos (Ej: F001).
   - Boleta (tipo "03"): serie debe ser B + 3 dígitos (Ej: B001).
   - NC/ND (tipos "07"/"08"): serie F### o B### (acepta también FC01/FD01).
   - Si no cumple → severidad "high".
   - correlativo <= 0 → severidad "high".
7. Fecha futura: si fecha_emision > hoy (UTC date) → severidad "high".
8. Moneda distinta de PEN/USD → severidad "medium".

Cada hallazgo:
{ "campo": "<nombre del campo afectado>", "mensaje": "<descripción clara, en español, máx 140 caracteres>", "severidad": "high"|"medium"|"low" }

Devuelve SOLO JSON válido (sin markdown, sin texto extra) con esta estructura exacta:
{
  "result": {
    "valid": <true si NO hay errors con severidad "high">,
    "errors": [ {campo, mensaje, severidad} ],
    "warnings": [ {campo, mensaje, severidad} ]
  },
  "confianza": <number 0..1>,
  "razonamiento": "<resumen breve de qué validaste, máx 200 caracteres>",
  "advertencias": [ "<strings con caveats si los hubo>" ]
}

Coloca en errors[] todo lo "high" y "medium". Coloca en warnings[] los "low". confianza alta (>=0.85) cuando los datos son completos y validables sin ambigüedad.`;

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
  const comprobante = body.comprobante;
  if (!comprobante || typeof comprobante !== 'object') {
    return res.status(422).json({ error: 'Falta el campo "comprobante" en el body' });
  }
  if (!Array.isArray(comprobante.items) || comprobante.items.length === 0) {
    return res.status(422).json({ error: 'El comprobante debe tener al menos 1 item' });
  }
  if (!comprobante.totales || typeof comprobante.totales !== 'object') {
    return res.status(422).json({ error: 'Falta el bloque "totales"' });
  }

  const today = new Date().toISOString().slice(0, 10);
  const userMessage = `Hoy es ${today} (UTC). Valida el siguiente comprobante peruano antes de generar el XML SUNAT:\n\n` +
    JSON.stringify(comprobante, null, 2) +
    `\n\nResponde SOLO con el JSON estructurado descrito en las instrucciones del sistema.`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
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

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(502).json({ error: 'Claude no devolvió JSON parseable', rawText: text.slice(0, 500) });
    }

    let parsed;
    try { parsed = JSON.parse(jsonMatch[0]); }
    catch (e) {
      return res.status(502).json({ error: 'JSON inválido de Claude', detail: e.message, rawText: text.slice(0, 500) });
    }

    // Normalizar estructura defensivamente
    const normErr = (arr) => (Array.isArray(arr) ? arr : []).map(x => ({
      campo: String(x.campo || ''),
      mensaje: String(x.mensaje || ''),
      severidad: ['high', 'medium', 'low'].includes(x.severidad) ? x.severidad : 'medium',
    })).filter(x => x.mensaje);

    const result = {
      valid: typeof parsed.result?.valid === 'boolean' ? parsed.result.valid : false,
      errors: normErr(parsed.result?.errors),
      warnings: normErr(parsed.result?.warnings),
    };
    // Auto-derivar valid si Claude lo omite: válido si no hay errors high
    if (typeof parsed.result?.valid !== 'boolean') {
      result.valid = !result.errors.some(e => e.severidad === 'high');
    }

    let confianza = Number(parsed.confianza);
    if (!Number.isFinite(confianza)) confianza = 0.5;
    confianza = Math.max(0, Math.min(1, confianza));

    return res.status(200).json({
      result,
      confianza,
      razonamiento: String(parsed.razonamiento || '').slice(0, 500),
      advertencias: Array.isArray(parsed.advertencias) ? parsed.advertencias.map(String) : [],
      model: data.model,
      usage: data.usage,
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'Claude tardó demasiado (>30s)' });
    }
    return res.status(502).json({ error: 'Error consultando Claude', detail: e.message });
  }
}
