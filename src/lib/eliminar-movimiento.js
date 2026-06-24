// ═══════════════════════════════════════════════════════════════════
// JARVEX — M1: núcleo compartido del "Eliminar" unificado.
//
// Reemplaza el viejo par Eliminar(no ajusta)/Reversar(crea movimiento). Ahora
// "Eliminar" en un solo paso: corre el guard de stock negativo, revierte el
// stock (callback por tipo), revierte la imputación a partida si la salida
// estaba imputada, soft-deletea y audita. NO crea movimiento compensatorio.
// ═══════════════════════════════════════════════════════════════════
import { deltaPorAlmacen, stockTrasBorrar, dejaNegativo } from './stock-guard.js';

// Config por tabla de movimiento: campo del item, catálogo, si lleva stock por cantidad.
const CFG_MOV = {
  movimientos_materiales:         { itemField: 'material_id',           catalog: 'materiales',         porCantidad: true,  itemTipo: 'material' },
  movimientos_herramientas:       { itemField: 'herramienta_id',        catalog: 'herramientas',       porCantidad: true,  itemTipo: 'herramienta', herramienta: true },
  movimientos_epp:                { itemField: 'epp_id',                catalog: 'epps',               porCantidad: true,  itemTipo: 'epp' },
  movimientos_insumos_emergencia: { itemField: 'insumo_emergencia_id',  catalog: 'insumos_emergencia', porCantidad: true,  itemTipo: 'insumo_emergencia' },
  movimientos_maquinaria:         { itemField: 'activo_id',             catalog: 'activos_pesados',    porCantidad: false, itemTipo: null },
};

const invertirAccionHerr = (a) => ({ salida:'entrada', entrada:'salida', mantenimiento:'entrada', baja:'reposicion', reposicion:'baja' }[a] || 'entrada');

async function revertirHerramientaStock(db, mov, herr, userId) {
  const accionInv = invertirAccionHerr(mov.accion);
  const cant = Number(mov.cantidad) || 0;
  const now = new Date().toISOString();
  const patch = { fecha_ultimo_movimiento: now.slice(0, 10), updated_at: now, updated_by: userId,
    version: (herr.version ?? 0) + 1, sync_status: herr.sync_status === 'pending_create' ? 'pending_create' : 'pending_update' };
  if (cant > 0) {
    const delta = (accionInv === 'entrada' || accionInv === 'reposicion') ? cant : accionInv === 'salida' ? -cant : 0;
    if (delta !== 0) {
      const nuevoStock = Math.max(0, Number(herr.stock_actual || 0) + delta);
      patch.stock_actual = nuevoStock;
      try { const { calcAlerta } = await import('./stock-utils.js'); patch.alerta = calcAlerta(nuevoStock, Number(herr.stock_minimo || 0)); } catch {}
      if (mov.ubicacion_id) { try { const { aplicarDelta } = await import('./stock-ubicaciones.js'); await aplicarDelta({ obraId: mov.obra_id, itemTipo: 'herramienta', itemId: herr.id, ubicacionId: mov.ubicacion_id, delta, userId }); } catch (e) { console.warn('[revert herr desglose]', e?.message); } }
    }
  }
  if (accionInv === 'entrada' || accionInv === 'reposicion') { patch.disponible = true; patch.ubicacion_actual = 'almacen'; patch.ultimo_responsable_id = null; }
  if (accionInv === 'salida') { patch.disponible = false; patch.ubicacion_actual = 'en_uso'; patch.ultimo_responsable_id = mov.responsable_id || null; }
  if (accionInv === 'mantenimiento') { patch.disponible = false; patch.ubicacion_actual = 'mantenimiento'; patch.estado_actual = 'mantenimiento'; }
  if (accionInv === 'baja') { patch.disponible = false; patch.ubicacion_actual = 'baja'; patch.estado_actual = 'baja'; }
  await db.herramientas.update(herr.id, patch);
}

/**
 * Versión SELF-CONTAINED del Eliminar unificado (carga el movimiento, el catálogo
 * y la lista del item por sí misma). La usa jx-solicitudes al APROBAR una solicitud
 * de borrado del almacenero, para que el borrado ajuste stock + revierta partida
 * igual que el Eliminar directo del admin. Soporta los 5 tipos de movimiento.
 * @param {Object} o { tabla, movId, userId, conGuard=true }
 */
export async function eliminarMovimientoCompleto({ tabla, movId, userId = null, conGuard = true }) {
  const db = window.__db;
  const cfg = CFG_MOV[tabla];
  if (!cfg) throw new Error('Tabla de movimiento no soportada: ' + tabla);
  const mov = await db[tabla].get(movId);
  if (!mov || mov.deleted_at) return;
  const itemId = mov[cfg.itemField];
  const item = itemId ? await db[cfg.catalog].get(itemId) : null;

  // 1. Guard de stock negativo: BLOQUEO DURO basado en el stock REAL (incluye herramientas).
  if (conGuard && item && cfg.porCantidad) {
    let nuevoStock;
    if (cfg.herramienta) {
      const accionInv = invertirAccionHerr(mov.accion);
      const cant = Number(mov.cantidad) || 0;
      const delta = (accionInv === 'entrada' || accionInv === 'reposicion') ? cant : accionInv === 'salida' ? -cant : 0;
      nuevoStock = Number(item.stock_actual || 0) + delta;
    } else {
      nuevoStock = stockTrasBorrar(item.stock_actual, mov);
    }
    if (dejaNegativo(nuevoStock)) {
      const e = new Error(`No se puede eliminar: dejaría el stock en ${nuevoStock}. No se permite stock negativo.`);
      e.code = 'STOCK_NEGATIVO'; throw e;
    }
  }
  // 2. Revertir stock por tipo.
  if (item && cfg.porCantidad) {
    if (cfg.herramienta) {
      await revertirHerramientaStock(db, mov, item, userId);
    } else {
      const undo = -deltaPorAlmacen(mov);
      const nuevoStock = Math.max(0, Number(item.stock_actual ?? 0) + undo);
      const min = Number(item.stock_minimo || 0);
      const alerta = nuevoStock <= 0 ? 'sin_stock' : (min > 0 && nuevoStock <= min * 0.5) ? 'critico' : (min > 0 && nuevoStock <= min) ? 'reponer' : 'ok';
      const now = new Date().toISOString();
      await db[cfg.catalog].update(itemId, { stock_actual: nuevoStock, alerta, updated_at: now, updated_by: userId,
        version: (item.version ?? 0) + 1, sync_status: item.sync_status === 'pending_create' ? 'pending_create' : 'pending_update' });
      if (mov.ubicacion_id) {
        try { const { aplicarDelta } = await import('./stock-ubicaciones.js'); await aplicarDelta({ obraId: mov.obra_id, itemTipo: cfg.itemTipo, itemId, ubicacionId: mov.ubicacion_id, delta: undo, userId }); }
        catch (e) { console.warn('[elim completo desglose]', e?.message); }
      }
    }
  }
  // 3. Revertir imputación a partida (solo materiales, salida imputada).
  if (tabla === 'movimientos_materiales' && mov.tipo_movimiento === 'salida' && mov.partida_id && item) {
    try { const { revertirConsumoPartida } = await import('./partida-allocation.js'); await revertirConsumoPartida({ mov, partida_id: mov.partida_id, material: item, userId }); }
    catch (e) { console.warn('[elim completo partida]', e?.message); }
  }
  // 3b. Maquinaria (serializada): si borro la SALIDA que dejó el activo asignado,
  // liberar la custodia (mismo criterio que jx-activos.jsx borrarHistorial). Sin
  // esto, aprobar el borrado de una salida dejaba el equipo mal asignado.
  if (tabla === 'movimientos_maquinaria' && mov.tipo_movimiento === 'salida' && item
      && item.asignado_a_id && item.fecha_asignacion === mov.fecha) {
    const nowM = new Date().toISOString();
    await db.activos_pesados.update(item.id, {
      asignado_a_tipo: null, asignado_a_id: null, asignado_a_nombre: null, fecha_asignacion: null,
      updated_at: nowM, updated_by: userId, version: (item.version ?? 0) + 1,
      sync_status: item.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
    });
  }
  // 4. Soft-delete.
  const now = new Date().toISOString();
  await db[tabla].update(movId, { deleted_at: now, updated_at: now, updated_by: userId,
    version: (mov.version ?? 0) + 1, sync_status: mov.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete' });
  // 5. Audit + refresh.
  try { await window.__logAudit?.({ action: 'delete', table: tabla, recordId: movId, oldData: mov, reason: 'Eliminación unificada (aprobación de solicitud)' }); } catch {}
  try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla } })); } catch {}
}

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
  tabla, mov, nuevoStockGlobal = null,
  revertirStock = null, material = null, userId = null, updateMov,
}) {
  // 1. Guard de stock negativo: BLOQUEO DURO para todos (admin y super admin incluidos).
  //    Se basa en el stock REAL resultante (no en una reconstrucción).
  if (nuevoStockGlobal != null && dejaNegativo(nuevoStockGlobal)) {
    const e = new Error(
      `No se puede eliminar: dejaría el stock en ${Number(nuevoStockGlobal)}. ` +
      `El stock no puede quedar negativo — registrá o ajustá primero el ingreso que falta.`
    );
    e.code = 'STOCK_NEGATIVO';
    throw e;
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
