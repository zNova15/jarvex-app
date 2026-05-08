// Vercel serverless function: POST /api/ocr-asistencia
//
// Body: {
//   file: "<base64-string>",
//   mimeType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp",
//   personalConocido: [{ id, nombres, apellidos, dni }] (opcional, para matching),
//   fecha: "YYYY-MM-DD" (opcional, fecha esperada del parte)
// }
// Returns: {
//   result: { fila_detectada: [...], fecha_detectada, total_personas },
//   confianza: 0..1,
//   razonamiento: string,
//   advertencias: [string],
//   model, usage
// }
//
// Usa Claude Sonnet 4.6 con Vision API para parsear partes de asistencia
// de obra peruana (papel firmado con tabla de trabajadores) desde PDF o imagen.
// Requiere ANTHROPIC_API_KEY en Vercel env vars.

const ALLOWED_MIME = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];

// Máximo 8 MB de string base64 (≈6 MB binario)
const MAX_BASE64_BYTES = 8 * 1024 * 1024;

const SYSTEM_PROMPT = `Eres un parser de partes de asistencia de obra peruana. Lees una foto/PDF de un parte físico (papel) que contiene una tabla con los trabajadores del día, sus horarios de entrada y salida, firmas, y a veces DNI. Tu tarea es extraer cada fila de la tabla y devolver JSON estructurado.

Reglas estrictas:
- NO inventes datos. Si un campo no se ve con confianza, devuelve null.
- DNI peruano: exactamente 8 dígitos. Si lees algo distinto, devuelve null y agrega advertencia.
- Horas en formato HH:MM (24h). Si dice "7:00 am" devuelve "07:00". Si dice "5 pm" devuelve "17:00".
- Estado por fila:
    · "asistio"  → llegó dentro del horario, hay firma o marca clara.
    · "tardanza" → marcó pero llegó tarde (hora ingreso > 08:00 o nota de tardanza).
    · "falta"    → casillero vacío, marca de "F", "falta" o tachado.
    · "permiso"  → marca de "P", "permiso", o nota de permiso médico/familiar.
- Si la fila tiene tanto entrada como salida, calcula coherencia básica (salida > entrada).
- Si hay observaciones manuscritas en la fila, transcríbelas tal cual.
- Si la imagen está borrosa, torcida, cortada o ilegible, agrega advertencias específicas y baja la confianza global.
- Si te dan un array "personalConocido", para cada fila intenta hacer match por nombre completo (apellidos+nombres) y/o DNI. Devuelve match_id (el id del registro) si coincide con alta confianza, o null si no estás seguro. NO uses match parcial débil.

Responde SOLO con JSON válido (sin markdown, sin texto extra) con esta estructura exacta:
{
  "fecha_detectada": "YYYY-MM-DD" | null,
  "total_personas": number,
  "fila_detectada": [
    {
      "nombre_detectado": string,
      "dni_detectado_o_null": string | null,
      "hora_entrada": "HH:MM" | null,
      "hora_salida_o_null": "HH:MM" | null,
      "estado": "asistio" | "tardanza" | "falta" | "permiso",
      "observaciones": string | null,
      "match_id_o_null": string | null,
      "confianza_fila": number
    }
  ],
  "confianza": number,
  "razonamiento": string,
  "advertencias": [string]
}`;

import { requireAuth, rateLimit, sanitizeError, sanitizeForPrompt, validateFileBytes } from '../lib/api-helpers.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Solo POST' });
  }

  try {
    await requireAuth(req);
    rateLimit(req, { windowMs: 60_000, max: 30 });
  } catch (e) {
    const s = sanitizeError(e, 'No autorizado');
    return res.status(s.status).json(s.body);
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
  const personalConocido = Array.isArray(body.personalConocido) ? body.personalConocido : [];
  const fecha = typeof body.fecha === 'string' ? body.fecha.trim() : '';

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

  // Sanitizar base64
  const cleanBase64 = file.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!cleanBase64) {
    return res.status(422).json({ error: 'El archivo en base64 está vacío' });
  }
  if (cleanBase64.length > MAX_BASE64_BYTES) {
    return res.status(422).json({
      error: `Archivo demasiado grande. Máximo ${Math.floor(MAX_BASE64_BYTES / 1024 / 1024)} MB en base64 (≈6 MB binario)`,
    });
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(cleanBase64)) {
    return res.status(422).json({ error: 'El archivo no es base64 válido' });
  }

  // Validar magic bytes — no confiar en mimeType declarado
  try {
    const buf = Buffer.from(cleanBase64, 'base64');
    const v = validateFileBytes(buf, mimeType);
    if (!v.ok) {
      return res.status(415).json({
        error: v.reason || `Tipo de archivo inválido (declarado: ${mimeType}, real: ${v.actualType || 'desconocido'})`,
      });
    }
  } catch (e) {
    return res.status(422).json({ error: 'No se pudo decodificar base64' });
  }

  // Limitar el array de personalConocido a algo razonable (50 trabajadores)
  // y proyectar solo los campos que necesitamos (no fugar datos extra).
  // Sanitizamos nombres/apellidos para evitar prompt injection.
  const personalSlim = personalConocido.slice(0, 50).map(p => ({
    id: sanitizeForPrompt(p?.id, 50) || null,
    nombres: sanitizeForPrompt(p?.nombres, 100),
    apellidos: sanitizeForPrompt(p?.apellidos, 100),
    dni: /^\d{8}$/.test(p?.dni || '') ? p.dni : null,
  }));

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

  const userInstruction = `Analiza este parte de asistencia y extrae cada fila al JSON descrito en el system prompt.

${fecha ? `Fecha esperada del parte: ${fecha} (úsala como referencia si no podés leer la fecha en el documento).` : ''}

${personalSlim.length > 0 ? `Personal conocido en la obra (intentá hacer match por nombre+DNI; devolvé match_id_o_null cuando coincida con alta confianza):
${JSON.stringify(personalSlim)}` : 'No hay lista de personal de referencia. Devolvé match_id_o_null=null en todas las filas.'}

Responde SOLO con el JSON, sin texto adicional ni markdown.`;

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
      console.error('[ocr-asistencia] upstream error:', upstream.status, errText.slice(0, 200));
      const isProd = process.env.NODE_ENV === 'production';
      return res.status(upstream.status).json({
        error: `Claude API respondió ${upstream.status}`,
        ...(isProd ? {} : { detail: errText.slice(0, 500) }),
      });
    }

    const data = await upstream.json();
    const text = data.content?.[0]?.text || '';

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(502).json({
        error: 'Claude no devolvió JSON parseable',
        rawText: text.slice(0, 500),
      });
    }

    let parsed;
    try { parsed = JSON.parse(jsonMatch[0]); }
    catch (e) {
      return res.status(502).json({
        error: 'JSON inválido de Claude',
        detail: e.message,
        rawText: text.slice(0, 500),
      });
    }

    // Normalizar la salida con defaults seguros
    const filas = Array.isArray(parsed.fila_detectada) ? parsed.fila_detectada : [];
    const result = {
      fila_detectada: filas.map(f => ({
        nombre_detectado: typeof f?.nombre_detectado === 'string' ? f.nombre_detectado : '',
        dni_detectado_o_null: typeof f?.dni_detectado_o_null === 'string' ? f.dni_detectado_o_null : null,
        hora_entrada: typeof f?.hora_entrada === 'string' ? f.hora_entrada : null,
        hora_salida_o_null: typeof f?.hora_salida_o_null === 'string' ? f.hora_salida_o_null : null,
        estado: ['asistio','tardanza','falta','permiso'].includes(f?.estado) ? f.estado : 'asistio',
        observaciones: typeof f?.observaciones === 'string' ? f.observaciones : null,
        match_id_o_null: f?.match_id_o_null ?? null,
        confianza_fila: typeof f?.confianza_fila === 'number' ? Math.max(0, Math.min(1, f.confianza_fila)) : 0.5,
      })),
      fecha_detectada: typeof parsed.fecha_detectada === 'string' ? parsed.fecha_detectada : (fecha || null),
      total_personas: typeof parsed.total_personas === 'number' ? parsed.total_personas : filas.length,
    };

    const confianzaGlobal = typeof parsed.confianza === 'number'
      ? Math.max(0, Math.min(1, parsed.confianza))
      : 0.5;

    return res.status(200).json({
      result,
      confianza: confianzaGlobal,
      razonamiento: typeof parsed.razonamiento === 'string' ? parsed.razonamiento : '',
      advertencias: Array.isArray(parsed.advertencias) ? parsed.advertencias : [],
      model: data.model,
      usage: data.usage,
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'Claude tardó demasiado (>90s)' });
    }
    return res.status(502).json({ error: 'Error consultando Claude', detail: e.message });
  }
}
