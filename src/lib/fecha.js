// ═══════════════════════════════════════════════════════════════════
// Zona horaria GLOBAL de la app (default Perú · America/Lima).
// Corrige el bug de "hoy": new Date().toISOString().slice(0,10) usa UTC, así que
// de noche en Perú (UTC−5) la fecha salta al día siguiente. Acá calculamos la
// fecha/hora en la zona configurada con Intl.DateTimeFormat.
// ═══════════════════════════════════════════════════════════════════
const TZ_KEY = 'jx_timezone';
export const TZ_DEFAULT = 'America/Lima';

export const ZONAS_HORARIAS = [
  { id: 'America/Lima', label: 'Perú · Lima (UTC−5)' },
  { id: 'America/Bogota', label: 'Colombia · Bogotá (UTC−5)' },
  { id: 'America/Guayaquil', label: 'Ecuador · Guayaquil (UTC−5)' },
  { id: 'America/La_Paz', label: 'Bolivia · La Paz (UTC−4)' },
  { id: 'America/Santiago', label: 'Chile · Santiago' },
  { id: 'America/Argentina/Buenos_Aires', label: 'Argentina · Buenos Aires (UTC−3)' },
  { id: 'America/Mexico_City', label: 'México · CDMX (UTC−6)' },
  { id: 'America/New_York', label: 'EE.UU. Este · Nueva York' },
  { id: 'America/Los_Angeles', label: 'EE.UU. Pacífico · Los Ángeles' },
  { id: 'Europe/Madrid', label: 'España · Madrid' },
  { id: 'UTC', label: 'UTC' },
];

export function getTZ() {
  try { return localStorage.getItem(TZ_KEY) || TZ_DEFAULT; } catch { return TZ_DEFAULT; }
}
export function setTZ(tz) {
  try {
    localStorage.setItem(TZ_KEY, tz || TZ_DEFAULT);
    window.dispatchEvent(new CustomEvent('jx_timezone_changed', { detail: { tz: tz || TZ_DEFAULT } }));
  } catch {}
}
export function etiquetaTZ(tz) {
  const t = tz || getTZ();
  return (ZONAS_HORARIAS.find(z => z.id === t) || { label: t }).label;
}

// "Hoy" como YYYY-MM-DD en la zona configurada (en-CA da el formato ISO).
export function hoyLocal(tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || getTZ(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch { return new Date().toISOString().slice(0, 10); }
}
// Hora actual HH:MM en la zona configurada.
export function horaLocal(tz) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz || getTZ(), hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  } catch { return new Date().toTimeString().slice(0, 5); }
}
// "YYYY-MM-DD HH:MM" ahora, en la zona configurada.
export function ahoraLocal(tz) { return `${hoyLocal(tz)} ${horaLocal(tz)}`; }
// Un timestamp ISO (UTC, p.ej. created_at del server) → 'YYYY-MM-DD' en la zona
// configurada. Para comparar contra un <input type=date> local sin el corrimiento
// de día que da .slice(0,10) (día UTC) después de las 19:00 en Perú.
export function fechaLocalDe(iso, tz) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || getTZ(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  } catch { return String(iso).slice(0, 10); }
}
// Un ISO → 'YYYY-MM-DD HH:MM' en la zona configurada (para mostrar).
export function fechaHoraLocalDe(iso, tz) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz || getTZ(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const h = new Intl.DateTimeFormat('en-GB', { timeZone: tz || getTZ(), hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
    return `${f} ${h}`;
  } catch { return String(iso).slice(0, 16).replace('T', ' '); }
}

// 'YYYY-MM-DD' → 'dd/mm' por string-split (NO pasa por Date: evita el corrimiento
// de un día por zona horaria de new Date('2026-06-01')). '' si no hay fecha.
export function fmtFechaCorta(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return (d && m) ? `${d}/${m}` : String(iso);
}

// 'YYYY-MM-DD' → 'dd/mm/aaaa' SIN pasar por new Date(): una fecha de día suelta
// se parsea como medianoche UTC y en Perú (UTC−5) `getDate()` devuelve el día
// ANTERIOR — el Libro Diario y los PLE mostraban/declaraban toda fecha un día
// antes (detectado 31-ago-2026 al tocar los asientos). Un ISO CON hora sí es un
// instante real y se muestra en la zona local.
export function fmtFechaLarga(valor) {
  if (!valor) return '';
  if (typeof valor === 'string') {
    const soloDia = valor.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (soloDia) return `${soloDia[3]}/${soloDia[2]}/${soloDia[1]}`;
  }
  try {
    const d = (valor instanceof Date) ? valor : new Date(valor);
    if (isNaN(d.getTime())) return String(valor);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
  } catch { return String(valor); }
}

// Fecha de un valor como 'YYYY-MM-DD', SIN el corrimiento de un día: una fecha
// de día suelta se devuelve tal cual (no pasa por Date) y un ISO con hora se
// resuelve en la zona local. Sirve para filtrar por período: con new Date() una
// factura del 01/07 caía en JUNIO (y una del 01/01, en el año anterior).
export function ymdDe(valor) {
  if (!valor) return '';
  if (typeof valor === 'string') {
    const soloDia = valor.trim().match(/^(\d{4}-\d{2}-\d{2})$/);
    if (soloDia) return soloDia[1];
  }
  try {
    const d = (valor instanceof Date) ? valor : new Date(valor);
    if (isNaN(d.getTime())) return '';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  } catch { return ''; }
}

// ¿La fecha cae en el período (año, mes)? mes es 1-12.
export function enPeriodo(valor, anio, mes) {
  const ymd = ymdDe(valor);
  if (!ymd) return false;
  return ymd.slice(0, 7) === `${anio}-${String(mes).padStart(2, '0')}`;
}
