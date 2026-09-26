// ═══════════════════════════════════════════════════════════════════
// JARVEX — Tipo de Cambio Oficial SUNAT / SBS y Bancarización (D.L. 1529)
//
// Reglas tributarias en el Perú (Ley de Bancarización, D.L. 1529 vigente desde abr-2022):
//   · Obligación de usar medios de pago (bancarización) a partir de:
//       - S/ 2,000 (dos mil soles) o
//       - US$ 500 (quinientos dólares americanos)
//   · Los comprobantes en dólares superiores a US$ 500 o cuyo equivalente
//     en soles supere S/ 2,000 DEBEN bancarizarse.
//
// Esta lib provee:
//   1. Consulta y cache de tipo de cambio oficial (compra / venta).
//   2. Conversión bidireccional PEN <-> USD con soporte offline inmediato.
//   3. Determinación rigurosa de bancarización obligatoria multimoneda.
// ═══════════════════════════════════════════════════════════════════

import { hoyLocal } from './fecha.js';

export const UMBRAL_BANCARIZACION_PEN = 2000;
export const UMBRAL_BANCARIZACION_USD = 500;

// Último recurso cuando no hay NINGUNA tasa para una fecha. Medido contra
// SUNAT el 17-set-2026 (3,363 compra / 3,371 venta el 12-set). Solo se usa para
// no dividir por cero en conversiones informativas: nada que se declare sale de
// acá — `obtenerTipoCambio` lo devuelve marcado con `fuente:'default'` y quien
// declara tiene que rechazarlo.
export const TIPO_CAMBIO_DEFAULT = 3.37;

// ── EL CACHE ARRANCA VACÍO, Y ESO ES UN ARREGLO ───────────────────
// Acá había seis tasas escritas a mano en el código. Se verificaron contra
// SUNAT el 17-set-2026 y estaban MAL: para el 12-set-2026 decía compra 3,745 /
// venta 3,755 cuando la real es 3,363 / 3,371 — un 11 % de error en un archivo
// que sirve para convertir plata. Eran números de relleno que nadie midió.
//
// Un dato inventado es peor que ninguno: sin tasa, la pantalla avisa que falta;
// con una tasa falsa, declara mal y nadie se entera. Las tasas de verdad viven
// ahora en la tabla `tipos_cambio` (mig 222), se piden una vez por fecha y
// quedan guardadas para las dos PCs. Este cache en memoria sigue existiendo
// como puente: `sembrarTiposCambio()` lo llena con lo que hay en la base.
const CACHE_TC = new Map();

// La clave del cache en localStorage. Versionada: ver el comentario en
// `cargarCacheStorage()`.
const CLAVE_CACHE = 'jx_tc_cache_v2';

/**
 * Llena el cache con las tasas guardadas en la base (mig 222).
 *
 * Lo llama la app al arrancar y cada vez que la pasada trae fechas nuevas, así
 * `obtenerTipoCambio()` y `convertirMoneda()` —que son síncronos y los usa
 * media app— ven las tasas reales sin tener que volverse asíncronos.
 */
export function sembrarTiposCambio(filas = []) {
  let n = 0;
  for (const t of filas || []) {
    if (!t || t.deleted_at) continue;
    const f = String(t.fecha || '').slice(0, 10);
    const venta = Number(t.venta);
    if (!f || !(venta > 0)) continue;
    const previa = CACHE_TC.get(f);
    // Una cargada a mano le gana a la de la API, igual que en `tasaVigente()`.
    if (previa && previa.fuente === 'manual' && t.fuente !== 'manual') continue;
    CACHE_TC.set(f, {
      compra: Number(t.compra) || venta,
      venta,
      fecha: f,
      fuente: t.fuente === 'manual' ? 'manual' : 'sunat',
    });
    n++;
  }
  return n;
}

/**
 * Carga o inicializa el cache persistido en localStorage si está disponible.
 */
function cargarCacheStorage() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    // 🔴 LA CLAVE CAMBIÓ A PROPÓSITO (17-set-2026). La vieja —`jx_tc_cache`—
    // tiene guardadas, en las PCs que ya usaron la app, las seis tasas
    // INVENTADAS que estaban escritas en este archivo: se sembraban en el
    // cache y de ahí se persistían. Borrarlas del código no alcanzaba, volvían
    // solas al recargar. Se ignora la clave vieja y se la borra.
    try { window.localStorage.removeItem('jx_tc_cache'); } catch { /* noop */ }
    const raw = window.localStorage.getItem(CLAVE_CACHE);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item?.fecha && item?.venta) CACHE_TC.set(item.fecha, item);
        }
      }
    }
  } catch { /* noop */ }
}
cargarCacheStorage();

function guardarCacheStorage() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const arr = [...CACHE_TC.values()].slice(-180); // guardar hasta 180 días
    window.localStorage.setItem(CLAVE_CACHE, JSON.stringify(arr));
  } catch { /* noop */ }
}

/**
 * Registra o actualiza una tasa de cambio oficial en el cache.
 */
export function registrarTipoCambio(fecha, { compra, venta, fuente = 'manual' }) {
  if (!fecha) return;
  const f = String(fecha).slice(0, 10);
  const v = Number(venta) || TIPO_CAMBIO_DEFAULT;
  const c = Number(compra) || v;
  const item = { fecha: f, compra: c, venta: v, fuente };
  CACHE_TC.set(f, item);
  guardarCacheStorage();
  return item;
}

/**
 * Obtiene el tipo de cambio síncrono para una fecha dada (con fallback a la más cercana o default).
 * @param {string} [fecha] Fecha en formato ISO YYYY-MM-DD
 * @param {object} [opts] Opciones
 * @returns {{ compra: number, venta: number, fecha: string, fuente: string }}
 */
export function obtenerTipoCambio(fecha, opts = {}) {
  const f = fecha ? String(fecha).slice(0, 10) : hoyLocal();
  if (CACHE_TC.has(f)) return CACHE_TC.get(f);

  // Buscar la fecha anterior más cercana disponible
  const ordenadas = [...CACHE_TC.keys()].sort();
  for (let i = ordenadas.length - 1; i >= 0; i--) {
    if (ordenadas[i] <= f) {
      return CACHE_TC.get(ordenadas[i]);
    }
  }

  const defaultVal = Number(opts.defaultVal) || TIPO_CAMBIO_DEFAULT;
  return { compra: defaultVal, venta: defaultVal, fecha: f, fuente: 'default' };
}

/**
 * Consulta en línea a la API de tipo de cambio SUNAT/SBS (asíncrono).
 * Si la red falla o está offline, retorna silenciosamente el fallback local.
 */
export async function consultarTipoCambioOnline(fecha) {
  const f = fecha ? String(fecha).slice(0, 10) : hoyLocal();
  if (CACHE_TC.has(f) && CACHE_TC.get(f).fuente !== 'default') {
    return CACHE_TC.get(f);
  }
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 3000);
    // Endpoint público SUNAT estándar en Perú
    const resp = await fetch(`https://api.apis.net.pe/v1/tipo-cambio-sunat?fecha=${f}`, {
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.venta) {
        return registrarTipoCambio(f, {
          compra: Number(data.compra) || Number(data.venta),
          venta: Number(data.venta),
          fuente: 'sunat_api',
        });
      }
    }
  } catch { /* fallback offline */ }

  return obtenerTipoCambio(f);
}

/**
 * Convierte un monto entre PEN y USD según la tasa de cambio efectiva.
 * @param {object} params
 * @param {number} params.monto
 * @param {string} params.monedaOrigen 'PEN' | 'USD'
 * @param {string} [params.monedaDestino] 'PEN' | 'USD' (default: 'PEN')
 * @param {string} [params.fecha]
 * @param {number} [params.tipoCambio] Si se especifica, manda sobre el lookup
 * @returns {number} Monto convertido redondeado a 2 decimales
 */
export function convertirMoneda({
  monto = 0,
  monedaOrigen = 'PEN',
  monedaDestino = 'PEN',
  fecha = null,
  tipoCambio = null,
}) {
  const m = Number(monto) || 0;
  const orig = String(monedaOrigen || 'PEN').toUpperCase();
  const dest = String(monedaDestino || 'PEN').toUpperCase();
  if (orig === dest || m === 0) return Math.round(m * 100) / 100;

  const tc = Number(tipoCambio) || obtenerTipoCambio(fecha).venta || TIPO_CAMBIO_DEFAULT;

  let res = m;
  if (orig === 'USD' && dest === 'PEN') {
    res = m * tc;
  } else if (orig === 'PEN' && dest === 'USD') {
    res = tc > 0 ? m / tc : m;
  }

  return Math.round(res * 100) / 100;
}

/**
 * Determina si un movimiento contable requiere bancarización obligatoria
 * según el D.L. 1529 (Ley para la Lucha contra la Evasión y para la Formalización).
 *
 * Umbral legal:
 *  - Montos >= S/ 2,000 en moneda nacional.
 *  - Montos >= US$ 500 en moneda extranjera (dólares).
 *  - O cualquier moneda cuyo valor convertido a Soles sea >= S/ 2,000.
 *
 * @param {number|string} monto
 * @param {string} [moneda] 'PEN' | 'USD'
 * @param {number} [tipoCambio]
 * @param {string} [fecha]
 * @returns {boolean}
 */
export function requiereBancarizacion(monto, moneda = 'PEN', tipoCambio = null, fecha = null) {
  const m = Number(monto) || 0;
  if (m <= 0) return false;
  const cur = String(moneda || 'PEN').toUpperCase();

  if (cur === 'PEN') {
    return m >= UMBRAL_BANCARIZACION_PEN;
  }
  if (cur === 'USD') {
    // Si es US$ 500 o más, aplica directo por D.L. 1529
    if (m >= UMBRAL_BANCARIZACION_USD) return true;
    // O si al tipo de cambio supera S/ 2,000
    const sol = convertirMoneda({ monto: m, monedaOrigen: 'USD', monedaDestino: 'PEN', tipoCambio, fecha });
    return sol >= UMBRAL_BANCARIZACION_PEN;
  }

  // Otra moneda (EUR, etc.): convertir a PEN
  const sol = convertirMoneda({ monto: m, monedaOrigen: cur, monedaDestino: 'PEN', tipoCambio, fecha });
  return sol >= UMBRAL_BANCARIZACION_PEN;
}

