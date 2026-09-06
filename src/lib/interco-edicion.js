// ═══════════════════════════════════════════════════════════════════
// JARVEX — QUIÉN PUEDE EDITAR UN MOVIMIENTO INTERCO (tanda 7).
//
// EL PROBLEMA, medido contra producción el 6-sep-2026:
//
//   · `intercompany_transactions` tiene 0 filas. En toda su historia.
//   · 171 movimientos están marcados `is_intercompany`.
//   · 76 de ellos son la VENTA original, por S/ 2.188.404,52.
//
// La pantalla de Movimientos bloqueaba el lápiz con `if (m.is_intercompany)` y
// mandaba a la contadora a «Operaciones entre empresas»… que lee justamente esa
// tabla vacía. O sea: la app señalaba dónde arreglarlo y ese lugar no podía
// mostrarlo nunca. Es el 🔴 que Gabriel reportó como «movimientos a veces no me
// deja ingresar».
//
// EL ERROR DE DISEÑO, en una línea: `is_intercompany` es un ATRIBUTO CONTABLE
// del comprobante —lo pone Captura Mágica al detectar que la contraparte es del
// grupo— y NO es la prueba de que exista un par registrado que haya que mover
// en bloque. Se estaba condicionando en la señal equivocada.
//
// LA SEÑAL CORRECTA: un movimiento se bloquea solo si es PATA de una fila viva
// de `intercompany_transactions`, porque ahí sí hay dos lados que tienen que
// moverse juntos o no moverse. Con esa tabla en cero, los 171 se destraban solos
// y la garantía queda intacta para cuando se empiece a usar.
//
// LO QUE ESTO NO TOCA: el `type`. `derivarTypeContable()` lo fuerza cuando el
// movimiento es interco y `guardar()` ya lee `is_intercompany` de la fila
// original, así que editar no puede convertir una venta interna en otra cosa.
//
// Puro: sin React, sin Dexie, sin imports.
// ═══════════════════════════════════════════════════════════════════

/**
 * Los ids de movimiento que SON una pata de un par intercompany registrado.
 *
 * @param transacciones filas de `intercompany_transactions`
 * @returns Set de ids de `accounting_movements`
 */
export function movimientosConParRegistrado(transacciones) {
  const ids = new Set();
  for (const t of transacciones || []) {
    if (!t || t.deleted_at) continue;
    if (t.seller_movement_id) ids.add(t.seller_movement_id);
    if (t.buyer_movement_id) ids.add(t.buyer_movement_id);
  }
  return ids;
}

const MOTIVO_PAR =
  'Este comprobante es una de las dos patas de una operación entre empresas registrada. ' +
  'Se edita desde «Operaciones entre empresas» para que los dos lados se muevan juntos.';

/**
 * ¿Se puede editar este movimiento?
 *
 * @param mov         la fila de accounting_movements
 * @param idsConPar   Set de movimientosConParRegistrado()
 * @returns {{ puede: boolean, motivo: string|null }}
 */
export function puedeEditarMovimiento(mov, idsConPar) {
  if (!mov) return { puede: false, motivo: 'Movimiento inexistente' };
  if (mov.deleted_at) return { puede: false, motivo: 'El movimiento está eliminado' };
  const conPar = idsConPar instanceof Set ? idsConPar : new Set();
  if (conPar.has(mov.id)) return { puede: false, motivo: MOTIVO_PAR };
  return { puede: true, motivo: null };
}

/**
 * ¿Se puede eliminar?
 *
 * Mismo criterio que editar, con una excepción que ya existía y se conserva: el
 * ESPEJO AUTO (la compra que la app genera sola al cargar la venta interna) se
 * puede borrar siempre — es un reflejo, no un comprobante que alguien emitió.
 *
 * @param opts.esEspejoAuto  true si notas.intercompany_auto está puesto
 */
export function puedeEliminarMovimiento(mov, idsConPar, { esEspejoAuto = false } = {}) {
  if (esEspejoAuto) return { puede: true, motivo: null };
  return puedeEditarMovimiento(mov, idsConPar);
}

/**
 * El aviso —NO bloqueo— para un comprobante que tiene su espejo cargado.
 *
 * `related_movement_id` apunta al mismo comprobante visto desde el otro libro.
 * Editar acá NO lo mueve allá, y la contadora tiene que saberlo antes de tocar
 * el monto. Devuelve null si no hay espejo vivo.
 *
 * @param movsById Map(id → movimiento)
 * @param nombreDeEmpresa (company_id) => string|null
 */
export function avisoDeEspejo(mov, movsById, nombreDeEmpresa) {
  if (!mov?.related_movement_id) return null;
  const get = movsById instanceof Map ? (id) => movsById.get(id) : () => null;
  const par = get(mov.related_movement_id);
  if (!par || par.deleted_at) return null;
  const nombre = typeof nombreDeEmpresa === 'function' ? nombreDeEmpresa(par.company_id) : null;
  return `Este comprobante también está cargado en el libro de ${nombre || 'la otra empresa'}. ` +
         'Lo que cambies aquí NO se copia allá: si corresponde, hay que editar las dos patas.';
}

export const MOTIVO_PAR_REGISTRADO = MOTIVO_PAR;
