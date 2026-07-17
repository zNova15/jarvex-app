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
// nuevo > bueno > regular > reparación > baja (de mejor a peor condición).
export const ESTADOS_COND = [
  { key: 'nuevo',      label: 'Nuevo',          color: 'var(--green)',  badge: 'b-green'  },
  { key: 'bueno',      label: 'Bueno',          color: 'var(--blue)',   badge: 'b-blue'   },
  { key: 'regular',    label: 'Regular',        color: 'var(--yellow)', badge: 'b-yellow' },
  { key: 'reparacion', label: 'En reparación',  color: 'var(--amber)',  badge: 'b-amber'  },
  { key: 'baja',       label: 'De baja',        color: 'var(--tm)',     badge: 'b-gray'   },
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

/** Suma (o resta, con delta negativo) `delta` unidades a un bucket de condición.
 *  Clampa a 0. Lo usan los movimientos de herramientas para mantener los
 *  buckets en sync automáticamente: ingreso → +nuevo, salida → −(condición de
 *  origen), devolución → +(condición de retorno). */
export async function aplicarDeltaEstado({ obraId, itemTipo, itemId, estado, delta, userId }) {
  if (!obraId || !itemTipo || !itemId || !estado || !delta) return;
  const actual = Number((await getEstados(itemTipo, itemId)).find(r => r.estado === estado)?.cantidad || 0);
  await upsertEstado(obraId, itemTipo, itemId, estado, { cantidad: Math.max(0, actual + Number(delta)) }, userId);
  try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'stock_estados' } })); } catch {}
}

/** Bucket de condición (stock_estados) que un movimiento de HERRAMIENTA afecta,
 *  y con qué signo entró (efecto sobre el bucket = signo·cantidad):
 *   · ingreso   → 'nuevo',           signo +1
 *   · devolución→ estado_devolucion, signo +1
 *   · salida    → estado_salida,     signo −1  ('_sin'/sin dato → no toca bucket)
 *  Devuelve { estado, signo } o null si el movimiento no toca ningún bucket
 *  (salida/devolución vieja sin la condición persistida — stock_estados es capa
 *  blanda, mejor no adivinar el bucket). */
export function bucketDeMovHerr(mov) {
  if (!mov) return null;
  const tipo = mov.tipo_movimiento || (mov.accion === 'salida' ? 'salida' : 'ingreso');
  if (tipo === 'devolucion') return mov.estado_devolucion ? { estado: mov.estado_devolucion, signo: +1 } : null;
  if (tipo === 'salida' || mov.accion === 'salida') {
    const c = mov.estado_salida || null;
    return (c && c !== '_sin') ? { estado: c, signo: -1 } : null;
  }
  return { estado: 'nuevo', signo: +1 }; // ingreso
}

/** Revierte en stock_estados el efecto que un movimiento de HERRAMIENTA tuvo
 *  sobre su bucket de condición, al ELIMINAR o REVERSAR ese movimiento. Es la
 *  contraparte del ajuste que se hace al CREAR el movimiento (jx-almacen.jsx):
 *  sin esto, borrar un ingreso dejaba el +Nuevo vivo y stock_estados quedaba
 *  inflado (drift del ROTOMARTILLOS: nuevo=2 con total 1). */
export async function revertirEstadoMovHerr(mov, userId) {
  if (!mov || !mov.herramienta_id || !mov.obra_id) return;
  const cant = Number(mov.cantidad || 0);
  if (!(cant > 0)) return;
  const b = bucketDeMovHerr(mov);
  if (!b) return;
  await aplicarDeltaEstado({ obraId: mov.obra_id, itemTipo: 'herramienta', itemId: mov.herramienta_id, estado: b.estado, delta: -b.signo * cant, userId });
}

/** Ajusta stock_estados cuando se EDITA la cantidad de un movimiento de
 *  herramienta: el bucket se mueve en lockstep con el stock, así que el delta
 *  del bucket = deltaStock (mismo signo que el aplicado a stock_actual). */
export async function ajustarEstadoMovHerrEdicion(mov, deltaStock, userId) {
  if (!mov || !mov.herramienta_id || !mov.obra_id || !deltaStock) return;
  const b = bucketDeMovHerr(mov);
  if (!b) return;
  await aplicarDeltaEstado({ obraId: mov.obra_id, itemTipo: 'herramienta', itemId: mov.herramienta_id, estado: b.estado, delta: Number(deltaStock), userId });
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
