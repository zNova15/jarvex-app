// ═══════════════════════════════════════════════════════════════════
// JARVEX — ¿Este comprobante genera un ingreso al almacén de una obra?
//
// EL PROBLEMA QUE RESUELVE (Gabriel, 13-set-2026)
// El casillero «Genera ingreso al almacén» de Captura Mágica salía SIEMPRE
// marcado y editable, incluso cuando la factura se estaba vinculando a
// «Gastos Generales de la Empresa» o a «Contabilidad Neta». Ahí el almacén de
// obra no existe: la promesa del casillero no se podía cumplir. Peor, el
// resumen del pie prometía «+ 1 recepción pendiente para almacén» y después no
// aparecía en ninguna parte — y las que igual quedaban marcadas se volvían
// invisibles, porque «Compras pendientes» filtra por `obra_id` (y ahí es NULL).
//
// LA REGLA, EN UN SOLO LUGAR
// El almacén es DE UNA OBRA. Sin obra no hay almacén, y una obra terminada o
// cancelada ya no recibe material. Esta función la usan los TRES lugares que
// tienen que coincidir: el casillero del modal, el texto del pie, y el
// `recepcion_status` que se escribe al confirmar. Cuando divergían, la pantalla
// decía una cosa y la base guardaba otra.
// ═══════════════════════════════════════════════════════════════════
import { normalizarEstadoObra } from './tipos-trabajo.js';

/** Obras que ya no reciben material (espejo de ESTADOS_OBRA de tipos-trabajo). */
export const ESTADOS_OBRA_SIN_ALMACEN = ['terminado', 'cancelado'];

/** ¿Esta obra puede recibir un ingreso de almacén hoy? */
export function obraRecibeAlmacen(obra) {
  if (!obra || obra.deleted_at) return false;
  return !ESTADOS_OBRA_SIN_ALMACEN.includes(normalizarEstadoObra(obra.estado));
}

/**
 * @param {object} p
 * @param {string} p.obraDestino  valor del selector "Destino de la factura"
 *                                (id de obra, '__empresa__', '__otros__', '__nose__' o '')
 * @param {Array}  p.obras        obras del hook (con deleted_at/estado)
 * @param {boolean} p.esRxh       recibo por honorarios
 * @param {boolean} p.esNota      nota de crédito / débito
 * @param {boolean} p.esVenta     el emisor es una empresa nuestra
 * @returns {{permitido:boolean, motivo:string, obra:object|null, texto:string}}
 *          `texto` es lo que se le muestra a la persona cuando NO se permite
 *          (vacío cuando sí: ahí manda el label del casillero).
 */
export function evaluarRecepcionAlmacen({ obraDestino, obras = [], esRxh = false, esNota = false, esVenta = false } = {}) {
  const no = (motivo, texto, obra = null) => ({ permitido: false, motivo, obra, texto });
  // Los tres casos que nunca fueron una compra de bienes para la obra. Se
  // devuelven con texto vacío: el modal no los comenta (nunca lo hizo) porque
  // no son un error de la persona, es la naturaleza del documento.
  if (esVenta) return no('venta', '');
  if (esRxh) return no('rxh', '');
  if (esNota) return no('nota', '');

  if (!obraDestino) {
    return no('sin_destino', 'Elegí primero el destino de la factura: el ingreso al almacén es de una obra.');
  }
  if (obraDestino === '__empresa__') {
    return no('gastos_generales', 'Gasto general de la empresa: no entra al almacén de ninguna obra.');
  }
  if (obraDestino === '__otros__') {
    return no('contabilidad_neta', 'Contabilidad neta: solo contabilidad, sin obra ni almacén.');
  }
  if (obraDestino === '__nose__') {
    return no('sin_clasificar', 'Sin destino definido: hasta que la Contadora Jefe le asigne una obra, no hay almacén al que mandarla.');
  }
  const obra = (obras || []).find(o => o && o.id === obraDestino && !o.deleted_at) || null;
  if (!obra) {
    return no('obra_inexistente', 'La obra elegida ya no existe en este dispositivo — sincronizá o elegí otro destino.');
  }
  if (!obraRecibeAlmacen(obra)) {
    const est = normalizarEstadoObra(obra.estado);
    return no('obra_cerrada',
      `La obra «${obra.nombre_obra || obra.id}» está ${est === 'cancelado' ? 'cancelada' : 'terminada'}: su almacén ya no recibe material. La factura se registra igual, solo en contabilidad.`,
      obra);
  }
  return { permitido: true, motivo: 'ok', obra, texto: '' };
}
