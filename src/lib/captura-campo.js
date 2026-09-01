// ═══════════════════════════════════════════════════════════════════
// JARVEX — Lógica pura del portal de Captura de Campo y de su bandeja
// en Captura Mágica. Vive acá (y no dentro de los .jsx) porque son las
// reglas que ya fallaron una vez en producción y necesitan tests.
// ═══════════════════════════════════════════════════════════════════

// ── Quién sube ──────────────────────────────────────────────────────
// BUG (1-sep, reportado por Gabriel): jx-captura-campo armaba la identidad
// con `profile.nombre || profile.full_name || profile.email`. La tabla
// `profiles` tiene **nombres** y **apellidos** (plural) — ni `nombre` ni
// `full_name` existen → SIEMPRE caía al email y el nombre de la persona no
// aparecía por ningún lado en la bandeja.
export function identidadDePerfil(profile) {
  const nom = `${profile?.nombres || ''} ${profile?.apellidos || ''}`.trim();
  return nom || profile?.email || 'usuario del sistema';
}

const PREFIJO = '📸 Captura de campo';
const SEP = ' · ';

// Observación que se guarda en la evidencia. Formato estable — lo lee
// parseObservacionCampo() para mostrar "quién subió" destacado en la bandeja.
export function armarObservacionCampo({ quienSube, comentario, esCuentaCampo }) {
  const quien = String(quienSube || '').trim() || 'sin nombre';
  const com = String(comentario || '').trim();
  return `${PREFIJO}${SEP}De: ${quien}${esCuentaCampo ? '' : ' (usuario del sistema)'}`
    + (com ? `${SEP}${com}` : '');
}

// Inverso tolerante: si la observación no tiene el formato (evidencia vieja,
// escrita a mano), devuelve todo como comentario y quien = null. Nunca tira.
export function parseObservacionCampo(obs) {
  const txt = String(obs || '').trim();
  if (!txt) return { quien: null, cuentaCampo: false, comentario: '' };
  if (!txt.startsWith(PREFIJO)) return { quien: null, cuentaCampo: false, comentario: txt };
  const resto = txt.slice(PREFIJO.length).replace(/^\s*·\s*/, '');
  const m = resto.match(/^De:\s*([^·]*?)\s*(\(usuario del sistema\))?\s*(?:·\s*([\s\S]*))?$/);
  if (!m) return { quien: null, cuentaCampo: false, comentario: resto };
  return {
    quien: (m[1] || '').trim() || null,
    cuentaCampo: !m[2],              // sin la marca = lo tecleó la cuenta de campo
    comentario: (m[3] || '').trim(),
  };
}

// ── Estados de la bandeja ───────────────────────────────────────────
// 'pendiente' → nadie la tocó · 'leida' → ya se mandó a la IA (mig 164)
// 'registrada' / 'descartada' → cerrada. Antes "Leer con IA" no cambiaba el
// estado: la foto seguía en la bandeja aunque ya estuviera trabajada y había
// que acordarse de marcarla a mano (pedido de Gabriel 1-sep).
export const ESTADO_PENDIENTE = 'pendiente';
export const ESTADO_LEIDA = 'leida';
export const ESTADO_REGISTRADA = 'registrada';
export const ESTADO_DESCARTADA = 'descartada';

// Filas que muestra cada pestaña. Las evidencias viejas sin campo_revision
// cuentan como pendientes (no se pierden de vista).
export function filtrarBandeja(filas, pestana) {
  const rows = (filas || []).filter(e => !e.deleted_at && e.tipo_evidencia === 'factura_campo');
  if (pestana === ESTADO_LEIDA) return rows.filter(e => e.campo_revision === ESTADO_LEIDA);
  return rows.filter(e => !e.campo_revision || e.campo_revision === ESTADO_PENDIENTE);
}

// ¿El error del UPDATE es "falta aplicar la migración 164"? Postgres devuelve
// 23514 (check_violation) si el estado nuevo todavía no está permitido.
export function esFaltaMigracion164(error) {
  const cod = error?.code || '';
  const msg = String(error?.message || error || '').toLowerCase();
  return cod === '23514' || msg.includes('campo_revision_check') || (msg.includes('check') && msg.includes('campo_revision'));
}

// ── Archivos aceptados ──────────────────────────────────────────────
// Se agregó PDF (1-sep): muchas facturas llegan por WhatsApp ya en PDF y
// antes había que sacarle una foto a la pantalla. El pipeline de evidencias
// ya los tolera (optimizar-imagen los pasa intactos).
export const ACEPTA_IMAGEN = 'image/*';
export const ACEPTA_PDF = 'application/pdf,.pdf';

export function esPdf(file) {
  const mime = String(file?.type || '').toLowerCase();
  const nombre = String(file?.name || '').toLowerCase();
  return mime === 'application/pdf' || (!mime && nombre.endsWith('.pdf'));
}
