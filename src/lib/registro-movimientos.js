// ═══════════════════════════════════════════════════════════════════
// JARVEX — Orden y filtro por fechas de los REGISTROS de movimientos
// (materiales, herramientas, EPP, insumos de emergencia).
//
// Pedido de Gabriel (24-set-2026, probando staging): los registros no dejaban
// ordenar de lo más antiguo a lo más reciente ni acotar por fechas — solo
// había tipo y buscador, y en emergencia ni eso. Todo acá es PURO para que los
// cuatro registros ordenen y filtren exactamente igual.
// ═══════════════════════════════════════════════════════════════════

const DIA_MS = 24 * 3600 * 1000;

export const ORDENES_REGISTRO = ['fecha_desc', 'fecha_asc', 'cargado'];
export const ORDEN_REGISTRO_LABEL = {
  fecha_desc: 'Más reciente primero',
  fecha_asc: 'Más antiguo primero',
  cargado: 'Últimos cargados primero',
};

export const PRESETS_RANGO = ['todo', 'hoy', '7d', '30d', 'mes', 'mes_anterior', 'personalizado'];
export const PRESET_RANGO_LABEL = {
  todo: 'Todas las fechas',
  hoy: 'Hoy',
  '7d': 'Últimos 7 días',
  '30d': 'Últimos 30 días',
  mes: 'Este mes',
  mes_anterior: 'Mes anterior',
  personalizado: 'Entre dos fechas…',
};

const claveFecha = (m) => `${m?.fecha || ''} ${m?.hora || ''}`;

/**
 * Ordena movimientos sin mutar el arreglo.
 *   'fecha_desc' (default) — por fecha+hora del movimiento, lo último arriba.
 *   'fecha_asc'            — lo más antiguo arriba (para leer el kardex en orden).
 *   'cargado'              — por cuándo se REGISTRÓ en el sistema (created_at):
 *                            lo cargado hoy con fecha atrasada sale primero
 *                            (caso COLLARINES, 24-set: quedaba enterrado).
 * Acepta 'fecha' como sinónimo de 'fecha_desc' (lo que usaba la versión previa).
 */
export function ordenarMovimientos(movs, orden = 'fecha_desc') {
  const arr = (movs || []).slice();
  if (orden === 'cargado') {
    return arr.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  }
  if (orden === 'fecha_asc') {
    return arr.sort((a, b) => claveFecha(a).localeCompare(claveFecha(b)));
  }
  return arr.sort((a, b) => claveFecha(b).localeCompare(claveFecha(a)));
}

function ymd(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Rango {desde, hasta} (YYYY-MM-DD, inclusivo; null = abierto) para un preset.
 * `hoy` es la fecha LOCAL de la obra (window.__fecha.hoyLocal()), inyectada.
 */
export function rangoDePreset(preset, hoy, personalizado = {}) {
  const base = Date.parse(`${hoy}T12:00:00Z`);
  if (!Number.isFinite(base)) return { desde: null, hasta: null };
  switch (preset) {
    case 'hoy': return { desde: hoy, hasta: hoy };
    case '7d': return { desde: ymd(base - 6 * DIA_MS), hasta: hoy };
    case '30d': return { desde: ymd(base - 29 * DIA_MS), hasta: hoy };
    case 'mes': return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy };
    case 'mes_anterior': {
      const [y, m] = hoy.split('-').map(Number);
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      const ultimo = new Date(Date.UTC(py, pm, 0)).getUTCDate();
      const mm = String(pm).padStart(2, '0');
      return { desde: `${py}-${mm}-01`, hasta: `${py}-${mm}-${String(ultimo).padStart(2, '0')}` };
    }
    case 'personalizado': {
      let { desde = null, hasta = null } = personalizado || {};
      desde = desde || null; hasta = hasta || null;
      // Si las pusieron al revés, se entiende lo que quisieron decir.
      if (desde && hasta && desde > hasta) [desde, hasta] = [hasta, desde];
      return { desde, hasta };
    }
    default: return { desde: null, hasta: null };
  }
}

/**
 * Filtra por la FECHA DEL MOVIMIENTO (no la de carga). Con orden 'cargado' el
 * rango sigue siendo por fecha del movimiento: son dos preguntas distintas.
 */
export function filtrarPorRango(movs, { desde = null, hasta = null } = {}) {
  if (!desde && !hasta) return movs || [];
  return (movs || []).filter(m => {
    const f = m?.fecha || '';
    if (!f) return false;
    if (desde && f < desde) return false;
    if (hasta && f > hasta) return false;
    return true;
  });
}

function diasEntre(fechaA, fechaB) {
  const a = Date.parse(`${fechaA}T12:00:00Z`);
  const b = Date.parse(`${fechaB}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.round(Math.abs(a - b) / DIA_MS);
}

/**
 * Si el movimiento se cargó 2+ días DESPUÉS de su fecha, devuelve la fecha
 * local (YYYY-MM-DD) en que se cargó; si no, null. `fechaLocalDe` convierte el
 * created_at (UTC) a la fecha de la obra — se inyecta para no depender del TZ.
 */
export function cargadoDespues(m, fechaLocalDe) {
  if (!m?.created_at || !m?.fecha) return null;
  const cargado = fechaLocalDe(m.created_at);
  if (!cargado) return null;
  return diasEntre(cargado, m.fecha) >= 2 && cargado > m.fecha ? cargado : null;
}
