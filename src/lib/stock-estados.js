// ═══════════════════════════════════════════════════════════════════
// JARVEX — Stock por estado/condición (buckets)
//
// Subdivide el stock_actual de un item por condición física:
//   nuevo · bueno · reparacion · baja
// El total por estado nunca supera el stock_actual del item; lo que no se
// clasifica queda "sin clasificar". Mover entre estados no cambia el total.
// Cada bucket puede llevar una foto (foto_evidencia_id) y una nota.
//
// Local-first (Dexie). El SyncEngine pushea stock_estados al server.
// ═══════════════════════════════════════════════════════════════════

import { db, newId } from '../db/jarvex.db';

const PEND_CREATE = 'pending_create';
const PEND_UPDATE = 'pending_update';

// Orden y etiquetas de los estados (la UI los pinta en este orden).
export const ESTADOS_COND = [
  { key: 'nuevo',      label: 'Nuevo',          color: 'var(--green)',  badge: 'b-green' },
  { key: 'bueno',      label: 'Bueno',          color: 'var(--blue)',   badge: 'b-blue'  },
  { key: 'reparacion', label: 'En reparación',  color: 'var(--amber)',  badge: 'b-amber' },
  { key: 'baja',       label: 'De baja',        color: 'var(--tm)',     badge: 'b-gray'  },
];
export const ESTADO_LABEL = Object.fromEntries(ESTADOS_COND.map(e => [e.key, e.label]));

/** Filas vivas de estado para un item. */
export async function getEstados(itemTipo, itemId) {
  if (!itemId) return [];
  try {
    return await db.stock_estados
      .where('[item_tipo+item_id]').equals([itemTipo, itemId])
      .filter(r => !r.deleted_at).toArray();
  } catch {
    return await db.stock_estados.filter(r =>
      r.item_tipo === itemTipo && r.item_id === itemId && !r.deleted_at).toArray();
  }
}

/** Mapa itemId → Map(estado → cantidad) para una lista de items. */
export async function getEstadosBulk(itemTipo, itemIds) {
  const set = new Set(itemIds);
  const map = new Map();
  if (!itemIds?.length) return map;
  const rows = await db.stock_estados
    .filter(r => r.item_tipo === itemTipo && set.has(r.item_id) && !r.deleted_at).toArray();
  for (const r of rows) {
    if (!map.has(r.item_id)) map.set(r.item_id, new Map());
    map.get(r.item_id).set(r.estado, Number(r.cantidad || 0));
  }
  return map;
}

/** Upsert de la fila (item, estado). Devuelve la fila. */
async function upsertEstado(obraId, itemTipo, itemId, estado, patch, userId) {
  const now = new Date().toISOString();
  const existente = (await getEstados(itemTipo, itemId)).find(r => r.estado === estado);
  if (existente) {
    await db.stock_estados.update(existente.id, {
      ...patch, updated_at: now, updated_by: userId,
      version: (existente.version ?? 0) + 1,
      sync_status: existente.sync_status === PEND_CREATE ? PEND_CREATE : PEND_UPDATE,
    });
    return { ...existente, ...patch };
  }
  const id = newId();
  const row = {
    id, obra_id: obraId, item_tipo: itemTipo, item_id: itemId, estado,
    cantidad: 0, foto_evidencia_id: null, notas: null, ...patch,
    created_by: userId, updated_by: userId, created_at: now, updated_at: now,
    version: 1, sync_status: PEND_CREATE, last_synced_at: null,
    idempotency_key: `${userId || 'x'}_se_${id}`,
  };
  await db.stock_estados.add(row);
  return row;
}

/** Setea la cantidad ABSOLUTA de un estado (no delta). */
export async function setCantidadEstado({ obraId, itemTipo, itemId, estado, cantidad, userId }) {
  if (!obraId || !itemTipo || !itemId || !estado) return;
  await upsertEstado(obraId, itemTipo, itemId, estado, { cantidad: Math.max(0, Number(cantidad) || 0) }, userId);
  try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'stock_estados' } })); } catch {}
}

/** Asocia/cambia la foto (evidencia) y/o nota de un bucket de estado. */
export async function setFotoEstado({ obraId, itemTipo, itemId, estado, fotoEvidenciaId, notas, userId }) {
  const patch = {};
  if (fotoEvidenciaId !== undefined) patch.foto_evidencia_id = fotoEvidenciaId;
  if (notas !== undefined) patch.notas = notas;
  await upsertEstado(obraId, itemTipo, itemId, estado, patch, userId);
  try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'stock_estados' } })); } catch {}
}

/** Mueve `cantidad` unidades de un estado a otro (el total no cambia). */
export async function moverEntreEstados({ obraId, itemTipo, itemId, origen, destino, cantidad, userId }) {
  const cant = Number(cantidad) || 0;
  if (cant <= 0) throw new Error('La cantidad a mover debe ser mayor a 0');
  if (!origen || !destino) throw new Error('Elegí estado origen y destino');
  if (origen === destino) throw new Error('Origen y destino no pueden ser el mismo estado');
  const filas = await getEstados(itemTipo, itemId);
  const enOrigen = Number(filas.find(r => r.estado === origen)?.cantidad || 0);
  if (cant > enOrigen) throw new Error(`En "${ESTADO_LABEL[origen] || origen}" solo hay ${enOrigen}. No podés mover ${cant}.`);
  const enDestino = Number(filas.find(r => r.estado === destino)?.cantidad || 0);
  await upsertEstado(obraId, itemTipo, itemId, origen, { cantidad: enOrigen - cant }, userId);
  await upsertEstado(obraId, itemTipo, itemId, destino, { cantidad: enDestino + cant }, userId);
  try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'stock_estados' } })); } catch {}
  return { ok: true };
}
