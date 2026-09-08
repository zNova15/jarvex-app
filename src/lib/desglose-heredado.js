// ═══════════════════════════════════════════════════════════════════
// JARVEX — EL DESGLOSE QUE SE LEE DEL OTRO LADO (tanda 15).
//
// EL PEDIDO, de la jefa de contabilidad (8-set-2026): «el ojo para ver la
// factura no te muestra la factura real; la real muestra el detalle de los
// insumos que se compraron. Por ello la orden de compra sale sin ítems, o sea
// totalmente mal».
//
// LA CAUSA, medida contra producción antes de tocar código:
//
//   · Cuando una empresa del grupo le vende a otra, la app crea sola la COMPRA
//     espejo en el libro del comprador (Captura Mágica → «auto-espejo
//     intercompany»). Ese espejo nace A PROPÓSITO sin `notas.items_factura`:
//     si llevara los ítems, el almacén del comprador contaría dos veces los
//     mismos materiales. En su lugar deja un puntero:
//     `notas.desglose_heredado_de` (y `notas.intercompany_mirror_of`).
//
//   · El puntero se escribía desde el 7-ago-2026 y NADIE lo leía. Los 95
//     espejos vivos de producción tienen el puntero, los 95 están sin ítems
//     propios, y los 95 podrían heredar el detalle real de su venta de origen.
//
//   · Consecuencia en la pantalla que reportó la contadora: el 👁 decía «este
//     comprobante no tiene el detalle cargado» y la orden retroactiva salía con
//     UNA línea que dice «Insumos y materiales» — cuando la factura real trae
//     12 (BROCHAS, DISCO DE CORTE, CINTA AISLANTE 3M…). En la obra Miraflores
//     son 6 de los 20 comprobantes que esperan respaldo.
//
// LO QUE ESTE MÓDULO HACE: leer el puntero, con guardas, y SOLO EN MEMORIA.
// No escribe los ítems en el espejo — la invariante del doble conteo en almacén
// se mantiene intacta: el detalle se MUESTRA heredado, no se COPIA.
//
// LAS GUARDAS (por qué no alcanza con seguir el puntero a ciegas):
//   1. Si el comprobante tiene ítems propios, mandan los suyos. Siempre.
//   2. El origen tiene que vivir en OTRO libro: un espejo es el mismo papel
//      visto desde la otra empresa. Esto además descarta solo el otro uso de
//      `related_movement_id` — el vínculo nota de crédito → factura, que es
//      dentro de la MISMA empresa.
//   3. Mismo comprobante (serie-correlativo normalizado). Sin esta guarda, un
//      puntero viejo o mal cargado le pegaría a una orden el detalle de otra
//      factura, y eso es peor que no tener detalle.
//   4. El origen tiene que traer ítems de verdad; si no, no hay nada que heredar.
//
// Un solo salto, a propósito: en una cadena de tres empresas cada tramo es un
// comprobante DISTINTO, así que la guarda 3 corta sola. No hay recursión que
// perseguir.
//
// Puro: sin React, sin Dexie. Testeado en __tests__/desglose-heredado.test.js
// ═══════════════════════════════════════════════════════════════════

import { itemsDeFactura, parseNotas } from './cruce-recepcion.js';
import { mismoComprobante } from './doc-id.js';

/** Map(id → movimiento) para resolver punteros sin recorrer el arreglo. */
export function indexarMovs(movs) {
  const m = new Map();
  for (const mv of movs || []) if (mv?.id) m.set(mv.id, mv);
  return m;
}

/**
 * A qué movimiento apunta este comprobante para su desglose.
 *
 * Los tres campos que la app escribió a lo largo del tiempo, en orden de
 * confianza: el explícito de la herencia, el del espejo, y el vínculo crudo
 * (que solo se mira si el comprobante está marcado como interno).
 */
export function punteroDeDesglose(mov) {
  if (!mov) return null;
  const j = parseNotas(mov.notas);
  const p = j.desglose_heredado_de || j.intercompany_mirror_of || null;
  if (p) return String(p);
  if (mov.is_intercompany === true && mov.related_movement_id) return String(mov.related_movement_id);
  return null;
}

/**
 * El comprobante de origen del que se puede heredar el desglose, ya validado.
 * `null` cuando no hay de dónde heredar — que es la respuesta correcta cuando
 * el dato no alcanza: nunca se inventa un detalle.
 */
export function origenDelDesglose(mov, movsPorId) {
  if (!mov) return null;
  const get = movsPorId instanceof Map
    ? (id) => movsPorId.get(id) || null
    : (id) => (movsPorId || []).find(m => m?.id === id) || null;

  const puntero = punteroDeDesglose(mov);
  if (!puntero || puntero === mov.id) return null;

  const origen = get(puntero);
  if (!origen || origen.deleted_at) return null;
  // Guarda 2: el espejo vive en el OTRO libro.
  if (origen.company_id && mov.company_id && origen.company_id === mov.company_id) return null;
  // Guarda 3: el mismo papel, no otro.
  if (!mismoComprobante(origen.document_number, mov.document_number)) return null;
  // Guarda 4: que haya algo que heredar.
  if (!itemsDeFactura(origen).length) return null;
  return origen;
}

/**
 * Los ítems de un comprobante, propios o heredados.
 *
 * @returns {{ items: Array, heredadoDe: string|null, origen: object|null }}
 *   `heredadoDe` es el id de la venta de origen cuando el detalle no es propio
 *   — la pantalla lo usa para DECIRLO (un detalle heredado no se muestra como
 *   si estuviera cargado en el comprobante).
 */
export function itemsConHerencia(mov, movsPorId) {
  const propios = itemsDeFactura(mov);
  if (propios.length) return { items: propios, heredadoDe: null, origen: null };
  const origen = origenDelDesglose(mov, movsPorId);
  if (!origen) return { items: [], heredadoDe: null, origen: null };
  return { items: itemsDeFactura(origen), heredadoDe: origen.id, origen };
}

/**
 * El mismo movimiento con el desglose heredado puesto, listo para las
 * funciones que leen `notas.items_factura` (`tipoSugerido`,
 * `igvSugeridoDesdeItems`, `borradorDesdeMovimiento`).
 *
 * ⚠ SOLO EN MEMORIA. Esta copia NO se guarda en Dexie ni se sube: el espejo
 * sigue sin ítems propios en la base, que es lo que evita el doble conteo en
 * el almacén del comprador. `parseNotas` acepta un objeto, así que devolver
 * `notas` como objeto (y no como texto JSON) es válido y ahorra un stringify.
 */
export function conDesgloseHeredado(mov, movsPorId) {
  if (!mov) return mov;
  const { items, heredadoDe } = itemsConHerencia(mov, movsPorId);
  if (!heredadoDe) return mov;
  return {
    ...mov,
    notas: { ...parseNotas(mov.notas), items_factura: items },
    __desglose_heredado_de: heredadoDe,
  };
}
