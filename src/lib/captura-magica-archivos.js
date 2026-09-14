// ═══════════════════════════════════════════════════════════════════
// JARVEX — Qué archivos acepta Captura Mágica, y con qué mimeType los manda.
//
// Lib pura (sin React, sin DOM más allá de leer `file.type`/`file.name`) para
// poder testear el caso HEIC sin montar el componente.
//
// ── HEIC/HEIF (13-set-2026) ─────────────────────────────────────
// Gabriel: «captura mágica no me deja procesar evidencia .heic, que subieron
// por captura rápido algunas personas». Son las fotos que salen de "Tomar
// foto" en un iPhone cuando el sistema no las convirtió solo a JPEG. Ni
// Mistral OCR ni Claude visión leen HEIC directamente, así que el SERVIDOR
// las convierte a JPEG antes de mandarlas a cualquiera de los dos motores
// (ver api/captura-magica.js, que usa `heic-convert`) — acá solo hace falta
// dejarlas pasar el filtro de tipo del cliente.
//
// Safari/iOS tiene un quirk conocido: un .heic a veces llega con `file.type`
// VACÍO (el navegador no le reconoce un MIME). Sin `mimeEfectivoDeArchivo`,
// esa foto se rechazaba como "tipo no soportado" aunque la extensión fuera
// HEIC de sobra — se infiere por el nombre SOLO cuando el navegador no dio
// nada útil, nunca pisando un tipo que sí vino bien puesto.
// ═══════════════════════════════════════════════════════════════════

export const ALLOWED_MIME_CAPTURA = [
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
];

const EXT_HEIC_RE = /\.(heic|heif)$/i;

/**
 * El mimeType con el que se manda este archivo al server: el que declaró el
 * navegador si es uno reconocido, o el inferido por extensión cuando el
 * navegador no dio nada usable (HEIC de Safari con `file.type` vacío).
 *
 * @param {{type?: string, name?: string}} f  un File (o algo con esa forma)
 */
export function mimeEfectivoDeArchivo(f) {
  const t = f?.type || '';
  if (ALLOWED_MIME_CAPTURA.includes(t)) return t;
  if ((!t || t === 'application/octet-stream') && EXT_HEIC_RE.test(f?.name || '')) return 'image/heic';
  return t;
}

/** ¿Este archivo pasa el filtro de tipo de Captura Mágica? */
export function tipoAceptado(f) {
  return ALLOWED_MIME_CAPTURA.includes(mimeEfectivoDeArchivo(f));
}
