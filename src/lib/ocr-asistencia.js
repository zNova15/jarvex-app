// Wrapper cliente para POST /api/ocr-asistencia
// Convierte File/Blob a base64 y llama al endpoint serverless.
//
// Uso:
//   const out = await ocrAsistencia(file, personalConocido, '2026-05-03');
//   // out = { result, confianza, razonamiento, advertencias, model, usage }

const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB binario

export async function fileToBase64(file) {
  if (!file) throw new Error('Archivo vacío');
  if (typeof file.arrayBuffer !== 'function') {
    throw new Error('Tipo de archivo no soportado (esperaba File/Blob)');
  }
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // btoa con chunks para evitar stack overflow en archivos grandes
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function ocrAsistencia(file, personalConocido = [], fecha = null) {
  if (!file) throw new Error('Falta el archivo del parte');
  const mimeType = file.type || '';
  if (!ALLOWED_MIME.includes(mimeType)) {
    throw new Error(`Tipo no permitido (${mimeType || 'desconocido'}). Usa PDF/JPG/PNG/WEBP.`);
  }
  if (typeof file.size === 'number' && file.size > MAX_BYTES) {
    throw new Error('Archivo muy grande (máx 8 MB)');
  }

  const base64 = await fileToBase64(file);

  const res = await fetch('/api/ocr-asistencia', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file: base64,
      mimeType,
      personalConocido: Array.isArray(personalConocido) ? personalConocido : [],
      fecha: fecha || null,
    }),
  });

  let payload;
  try { payload = await res.json(); }
  catch (e) { payload = { error: 'Respuesta no es JSON válido' }; }

  if (!res.ok) {
    const err = new Error(payload?.error || `OCR falló (${res.status})`);
    err.status = res.status;
    err.detail = payload?.detail;
    throw err;
  }

  return payload;
}

export default ocrAsistencia;
