// ═══════════════════════════════════════════════════════════════════
// JARVEX — LO QUE EL LIBRO DIARIO NECESITA SABER ADEMÁS DEL COMPROBANTE
// (tanda C de la revisión, 25-set-2026). Lib PURA.
//
// `asientos.js` no importa datos: se los inyectan (`opts`). Desde la tanda C
// necesita tres cosas más que el comprobante no trae adentro, y las dos
// pantallas que generan asientos —el Libro Diario y los Libros Electrónicos
// (PLE)— tienen que armarlas IGUAL: si el libro en pantalla asienta el
// anticipo en la 422 y el PLE lo declara en la 60, el que llega a SUNAT es el
// equivocado. Por eso se arman en un solo lugar:
//
//   · `tasaDe(mov)`  — el tipo de cambio de SUNAT para la fecha de emisión
//     (tabla `tipos_cambio`, mig 222), para los comprobantes en dólares que no
//     traen el suyo estampado. Gabriel: el libro va en soles al TC de la fecha
//     de emisión y el USD queda de referencia.
//   · `esAnticipo(mov)` y `aplicacionesDe(mov)` — qué comprobante es un
//     anticipo a proveedor (va a la 422) y qué entregas lo consumieron
//     (`anticipo_aplicaciones`, mig 207: 60 contra 422). Gabriel: «sí se usa
//     la 422».
//   · `referencia` — todos los movimientos por id, para que una nota de
//     crédito cuya factura está dada de baja no reste (ver `notas-credito.js`).
// ═══════════════════════════════════════════════════════════════════

import { detectarAnticipos, resolverAplicaciones } from './anticipos.js';
import { tasaDeComprobante } from './tipo-cambio-pasada.js';

/**
 * @param {object} args
 *  · `movimientos`   TODOS los accounting_movements (el anticipo y la factura
 *                    que lo consume suelen ser de meses distintos)
 *  · `aplicaciones`  filas de `anticipo_aplicaciones`
 *  · `tasas`         filas de `tipos_cambio`
 * @returns {{ referencia: Map, esAnticipo: Function, aplicacionesDe: Function, tasaDe: Function }}
 */
export function contextoDeAsientos({ movimientos = [], aplicaciones = [], tasas = [] } = {}) {
  const movs = (movimientos || []).filter(Boolean);
  const porId = new Map(movs.map(m => [m.id, m]));

  // El modo prueba tiene sus propios anticipos: se miran los dos mundos y cada
  // aplicación solo encuentra el anticipo de su mundo, porque va por id.
  const anticipoIds = new Set(
    [...detectarAnticipos(movs, { demo: false }), ...detectarAnticipos(movs, { demo: true })].map(a => a.id),
  );
  const filas = [
    ...resolverAplicaciones(aplicaciones, { demo: false }),
    ...resolverAplicaciones(aplicaciones, { demo: true }),
  ];
  const porFactura = new Map();
  for (const a of filas) {
    const anticipo = porId.get(a.anticipo_movimiento_id);
    // Un anticipo borrado o dado de baja ya no respalda ninguna entrega.
    if (!anticipo || anticipo.deleted_at || anticipo.payment_status === 'cancelled') continue;
    const lista = porFactura.get(a.factura_movimiento_id) || [];
    lista.push({ monto: a.monto, moneda: a.moneda, anticipo });
    porFactura.set(a.factura_movimiento_id, lista);
  }

  return {
    referencia: porId,
    esAnticipo: (m) => !!m && anticipoIds.has(m.id),
    aplicacionesDe: (m) => (m ? (porFactura.get(m.id) || []) : []),
    tasaDe: (m) => tasaDeComprobante(m, tasas)?.valor || null,
  };
}

export default { contextoDeAsientos };
