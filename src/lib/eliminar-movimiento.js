// ═══════════════════════════════════════════════════════════════════
// JARVEX — M1: núcleo compartido del "Eliminar" unificado.
//
// Reemplaza el viejo par Eliminar(no ajusta)/Reversar(crea movimiento). Ahora
// "Eliminar" en un solo paso: corre el guard de stock negativo, revierte el
// stock (callback por tipo), revierte la imputación a partida si la salida
// estaba imputada, soft-deletea y audita. NO crea movimiento compensatorio.
// ═══════════════════════════════════════════════════════════════════
import { simularBorrado } from './stock-guard.js';

/**
 * @param {Object} o
 * @param {string} o.tabla              p.ej. 'movimientos_materiales'
 * @param {Object} o.mov                el movimiento a eliminar
 * @param {Array|null} o.movimientosDelItem  movimientos del MISMO item+almacén para el guard
 *                                            (null = sin guard, p.ej. maquinaria serializada)
 * @param {Function} [o.revertirStock]  async, deshace el efecto de stock del movimiento (por tipo)
 * @param {Object|null} [o.material]    fila de catálogo, para revertir la imputación a partida
 * @param {string|null} [o.userId]
 * @param {Function} o.updateMov        (id, fields) => Promise — el update del hook
 */
export async function eliminarMovimiento({
  tabla, mov, movimientosDelItem = null,
  revertirStock = null, material = null, userId = null, updateMov,
}) {
  // 1. Guard de stock negativo (solo tipos con cantidad).
  if (movimientosDelItem) {
    const r = simularBorrado({ movimientos: movimientosDelItem, movId: mov.id });
    if (!r.seguro) {
      const e = new Error(
        `No se puede eliminar: dejaría el stock negativo${r.fechaViolacion ? ' el ' + r.fechaViolacion : ''}. ` +
        `Eliminá primero los movimientos posteriores que dependen de este.`
      );
      e.code = 'STOCK_NEGATIVO';
      throw e;
    }
  }
  // 2. Revertir el stock (lógica por tipo).
  if (revertirStock) await revertirStock();
  // 3. Revertir imputación a partida (salida imputada a una partida).
  if (mov?.tipo_movimiento === 'salida' && mov?.partida_id && material) {
    try {
      const { revertirConsumoPartida } = await import('./partida-allocation.js');
      await revertirConsumoPartida({ mov, partida_id: mov.partida_id, material, userId });
    } catch (e) { console.warn('[eliminar-movimiento] revertir partida:', e?.message || e); }
  }
  // 4. Soft-delete.
  await updateMov(mov.id, { deleted_at: new Date().toISOString() });
  // 5. Audit.
  try {
    await window.__logAudit?.({
      action: 'delete', table: tabla, recordId: mov.id, oldData: mov,
      reason: 'Eliminación unificada (ajusta stock + revierte partida)',
    });
  } catch {}
}
