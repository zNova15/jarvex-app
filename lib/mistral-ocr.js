// Qué modelo de Mistral OCR usa Captura Mágica, y la REGLA que impide que se
// mueva solo.
//
// IMPORTANTE: sin `export default` — así Vercel no lo cuenta como serverless
// function (mismo criterio que api-helpers.js y openrouter.js).
//
// ── QUÉ PASÓ ──────────────────────────────────────────────────────
// El código pedía `mistral-ocr-latest`. El **16-jul-2026** Mistral repuntó ese
// alias de OCR 3 a OCR 4.1 y **el precio se duplicó de USD 2 a 4 por 1.000
// páginas**. Nadie lo decidió, nadie se enteró, y la factura subió sola. Un
// alias móvil es una decisión de compra delegada al proveedor.
//
// ── LA REGLA ──────────────────────────────────────────────────────
// El modelo se FIJA a un snapshot con fecha. Si alguien pone un alias móvil
// (`-latest`, o `mistral-ocr-4` sin versión) en las variables de Vercel, esta
// función lo IGNORA, avisa en los logs y usa el snapshot fijo. No es una
// sugerencia en un comentario: es código que corre.
//
// Escape: `MISTRAL_OCR_PERMITIR_ALIAS=1` deja pasar el alias a propósito (para
// probar una versión nueva sin editar el repo). Es explícito y queda en el log.
//
// ── QUÉ MODELO ────────────────────────────────────────────────────
//   mistral-ocr-2512 = OCR 3 (18-dic-2025) — USD 2 / 1.000 págs.
//     Sin fecha de retiro: la doc de Mistral dice que "sigue disponible para
//     integraciones existentes y cargas de producción".
//   mistral-ocr-4-1  = OCR 4.1 (16-jul-2026) — USD 4 / 1.000 págs.
//     Mejor en tablas, escaneos y manuscrito (93,07 OmniDocBench vs ~85,66).
//     Eso importa en CERTIFICADOS DE CALIDAD, no en una factura electrónica
//     nítida — que es el 100 % del volumen real hoy.

// Snapshot fijo para facturas y guías: el camino de alto volumen.
export const OCR_FIJO = 'mistral-ocr-2512';
// Certificados de calidad. Hoy apunta al mismo snapshot barato porque el módulo
// de calidad todavía no tiene un solo certificado cargado (medido el
// 5-sep-2026: 0 filas en calidad_certificados). Cuando empiece a usarse y se
// vea que OCR 3 se queda corto con las tablas de laboratorio, se sube a
// 'mistral-ocr-4-1' con MISTRAL_OCR_MODEL_CERT — un snapshot, no un alias.
export const OCR_FIJO_CERT = 'mistral-ocr-2512';

// ¿Es un alias que el proveedor puede mover bajo tus pies?
// Móviles documentados por Mistral: 'mistral-ocr-latest' y 'mistral-ocr-4'
// (major sin versión). Un snapshot con fecha ('mistral-ocr-2512') o con versión
// ('mistral-ocr-4-1') apunta siempre a lo mismo.
export function esAliasMovil(modelo) {
  const m = String(modelo || '').trim().toLowerCase();
  if (!m) return false;
  if (m.endsWith('-latest')) return true;
  // 'mistral-ocr-4' sí; 'mistral-ocr-4-1' y 'mistral-ocr-2512' no.
  return /^mistral-ocr-\d{1,2}$/.test(m);
}

// Modelo a usar. `cert` distingue el camino de certificados de calidad.
// Devuelve { modelo, motivo } — `motivo` sirve para loguear por qué.
export function modeloOcr(env = process.env, { cert = false } = {}) {
  const fijo = cert ? OCR_FIJO_CERT : OCR_FIJO;
  const override = String((cert ? env.MISTRAL_OCR_MODEL_CERT : env.MISTRAL_OCR_MODEL) || '').trim();
  if (!override) return { modelo: fijo, motivo: 'fijo' };
  if (!esAliasMovil(override)) return { modelo: override, motivo: 'override' };
  if (env.MISTRAL_OCR_PERMITIR_ALIAS === '1') {
    return { modelo: override, motivo: 'alias-permitido' };
  }
  // Acá está la regla: el alias NO gana.
  return { modelo: fijo, motivo: 'alias-rechazado', rechazado: override };
}
