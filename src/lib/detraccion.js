// ═══════════════════════════════════════════════════════════════════
// JARVEX — LA DETRACCIÓN (SPOT), EN UN SOLO LUGAR (tanda C, 25-set-2026).
// Lib PURA. Testeada en __tests__/detraccion.test.js.
//
// Antes esto vivía repetido y distinto en cinco lados: el umbral de S/ 700 en
// `revision-facturas.js` y otra vez en `jx-contabilidad.jsx`; el 12 % «por
// defecto» en el PDF de valorización, en Valorizaciones y en Subcontratos
// (para obra corresponde el 4 %); y el cálculo en dólares con la etiqueta
// «S/». Las reglas son las que dio Gabriel el 25-set-2026 (pregunta 7 de la
// revisión):
//
//   · 4 % en valorizaciones, subcontratos y obra (código 030, contratos de
//     construcción); 12 % en consultorías (código 022).
//   · Redondeo a 2 decimales.
//   · Al tipo de cambio del día de EMISIÓN: el depósito es siempre en soles,
//     también cuando el comprobante está en dólares.
//   · Casi siempre a partir de S/ 700 (el SPOT alcanza a las operaciones
//     MAYORES a S/ 700).
//   · Las que están sin monto se recalculan, con marca de revisión: la app
//     PROPONE el importe y el escáner lo deja a la vista hasta que alguien lo
//     confirme. No se escribe solo un porcentaje adivinado.
// ═══════════════════════════════════════════════════════════════════

import { tasaOficialSpot, buscarCodigoSpot } from './codigos-spot.js';

/** Umbral SPOT: una operación de S/ 700 o menos no está sujeta a detracción. */
export const UMBRAL_DETRACCION = 700;

/** Obra: valorizaciones, subcontratos, ejecución (Anexo 3, código 030). */
export const DETRACCION_OBRA = { pct: 4, codigo: '030' };
/** Consultoría, supervisión, estudios (Anexo 3, código 022). */
export const DETRACCION_CONSULTORIA = { pct: 12, codigo: '022' };

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * El importe de la detracción, EN SOLES y a 2 decimales.
 *
 * @returns {number|null} null cuando el comprobante está en otra moneda y no
 *   hay tipo de cambio: sin la tasa del día no hay monto honesto.
 */
export function montoDetraccion({ total, moneda = 'PEN', tipoCambio = null, pct } = {}) {
  const p = Number(pct);
  const t = Math.abs(Number(total) || 0);
  if (!(p > 0) || !(t > 0)) return null;
  const mon = String(moneda || 'PEN').toUpperCase();
  const tc = mon === 'PEN' ? 1 : Number(tipoCambio);
  if (!(tc > 0)) return null;
  // Primero el total en soles (el que va al registro), después el porcentaje.
  return r2(r2(t * tc) * p / 100);
}

/** El total del comprobante en soles, o null si está en otra moneda sin tasa. */
export function totalEnSoles({ total, moneda = 'PEN', tipoCambio = null } = {}) {
  const t = Math.abs(Number(total) || 0);
  if (String(moneda || 'PEN').toUpperCase() === 'PEN') return t;
  const tc = Number(tipoCambio);
  return tc > 0 ? r2(t * tc) : null;
}

/** ¿El importe (en soles) alcanza para que la operación esté sujeta? */
export const sujetaPorMonto = (totalSoles) => Number(totalSoles) > UMBRAL_DETRACCION;

// Consultoría va ANTES que obra: «supervisión de obra» y «liquidación de obra»
// dicen «obra» y son servicios profesionales, no contratos de construcción.
const RX_CONSULTORIA = /(consultor|supervisi|asesor|estudio|expediente t[eé]cnico|elaboraci[oó]n de|liquidaci[oó]n de obra|dise[nñ]o)/i;
const RX_OBRA = /(valorizaci|\bobras?\b|subcontrat|ejecuci[oó]n de|construcci[oó]n|saldo de obra|avance de obra)/i;

function textoDe(m) {
  let items = [];
  try {
    const n = typeof m?.notas === 'string' ? JSON.parse(m.notas) : (m?.notas || {});
    items = Array.isArray(n?.items_factura) ? n.items_factura : [];
  } catch { items = []; }
  return [m?.description || '', ...items.map(it => it?.descripcion || '')].join(' ');
}

/**
 * Lo que la app propone para un comprobante marcado con detracción y SIN
 * monto. Nunca inventa: si no hay de dónde sacar el porcentaje, devuelve
 * `null` y el escáner lo dice así.
 *
 * Orden, de lo más firme a lo menos:
 *   1. el porcentaje ya cargado en el comprobante;
 *   2. el código cargado, si su tasa es una sola (el 019 tiene dos: no);
 *   3. el texto: obra/valorización/subcontrato → 4 % (030); consultoría,
 *      supervisión, estudio → 12 % (022). Es la regla de Gabriel.
 *
 * @returns {{ pct, codigo, monto, origen: 'porcentaje'|'codigo'|'texto', porque }|null}
 */
export function propuestaDetraccion(m, { tipoCambio = null } = {}) {
  if (!m) return null;
  const moneda = String(m.currency || 'PEN').toUpperCase();
  const tc = moneda === 'PEN' ? 1 : (Number(m.tipo_cambio) > 0 ? Number(m.tipo_cambio) : Number(tipoCambio) || null);
  let pct = null, codigo = m.detraccion_codigo || null, origen = null, porque = '';

  if (Number(m.detraccion_pct) > 0) {
    pct = Number(m.detraccion_pct); origen = 'porcentaje';
    porque = `el ${pct}% que ya tiene cargado`;
  } else if (codigo && buscarCodigoSpot(codigo) && !buscarCodigoSpot(codigo).tasasAlternativas) {
    pct = tasaOficialSpot(codigo); origen = 'codigo';
    porque = `el código ${buscarCodigoSpot(codigo).codigo} (${buscarCodigoSpot(codigo).nombre}) es al ${pct}%`;
  } else {
    const txt = textoDe(m);
    if (RX_CONSULTORIA.test(txt)) {
      ({ pct, codigo } = { pct: DETRACCION_CONSULTORIA.pct, codigo: codigo || DETRACCION_CONSULTORIA.codigo });
      origen = 'texto'; porque = 'es una consultoría o un servicio profesional (12 %, código 022)';
    } else if (RX_OBRA.test(txt)) {
      ({ pct, codigo } = { pct: DETRACCION_OBRA.pct, codigo: codigo || DETRACCION_OBRA.codigo });
      origen = 'texto'; porque = 'es obra: valorización, subcontrato o ejecución (4 %, código 030)';
    }
  }
  if (!pct) return null;
  const monto = montoDetraccion({ total: m.amount, moneda, tipoCambio: tc, pct });
  return { pct, codigo, monto, origen, porque, sinTipoCambio: monto == null && moneda !== 'PEN' };
}

/**
 * La liquidación de una valorización (de obra o de un subcontrato).
 *
 * Gabriel, 25-set-2026 (pregunta 9): «se emite por el BRUTO». La base de la
 * factura es lo valorizado; la amortización del adelanto, el fondo de
 * garantía y la penalidad NO achican la base ni el IGV: se descuentan del
 * NETO a cobrar, igual que la detracción. Antes el PDF restaba adelanto y
 * garantía antes del IGV: con S/ 100.000 valorizados, 10.000 de amortización y
 * 5.000 de garantía salía un IGV de S/ 15.300 en vez de S/ 18.000, y la
 * detracción al 12 % en vez del 4 %.
 *
 * La detracción va sobre el TOTAL con IGV, al 4 % salvo que se pase otra, y
 * solo si la operación pasa los S/ 700.
 */
export function liquidarValorizacion({
  bruto = 0, adelantos = 0, retenciones = 0, penalidad = 0,
  igvPct = 18, detraccionPct = DETRACCION_OBRA.pct,
} = {}) {
  const base = r2(bruto);
  const igv = r2(base * (Number(igvPct) || 0) / 100);
  const total = r2(base + igv);
  const pct = Number(detraccionPct);
  const detraccion = sujetaPorMonto(total) && pct > 0 ? r2(total * pct / 100) : 0;
  const descAdelanto = r2(adelantos);
  const descGarantia = r2(retenciones);
  const descPenalidad = r2(penalidad);
  const neto = r2(total - detraccion - descAdelanto - descGarantia - descPenalidad);
  return {
    base, igv, total, detraccion, detraccionPct: pct,
    adelantos: descAdelanto, retenciones: descGarantia, penalidad: descPenalidad, neto,
  };
}

export default {
  UMBRAL_DETRACCION, DETRACCION_OBRA, DETRACCION_CONSULTORIA,
  montoDetraccion, totalEnSoles, sujetaPorMonto, propuestaDetraccion, liquidarValorizacion,
};
