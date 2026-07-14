// ═══════════════════════════════════════════════════════════════════
// JARVEX — Stock por ubicación + traspasos entre almacenes
//
// Tabla `stock_ubicaciones` guarda cuánto hay de cada item (material /
// herramienta / epp) en cada ubicación. El stock TOTAL del item (ej.
// materiales.stock_actual) se mantiene aparte como la suma — esta capa
// es solo el desglose de "dónde está".
//
// Operaciones:
//   getDesglose(itemTipo, itemId)        → [{ubicacion_id, cantidad}]
//   aplicarDelta({...})                  → suma/resta en una ubicación (upsert)
//   traspasar({...})                     → resta origen + suma destino
//
// Todo es local-first (Dexie). El SyncEngine pushea stock_ubicaciones al
// server y el realtime lo propaga entre dispositivos.
// ═══════════════════════════════════════════════════════════════════

import { db, newId } from '../db/jarvex.db';

const PEND_CREATE = 'pending_create';
const PEND_UPDATE = 'pending_update';

/** Filas vivas de stock para un item. */
export async function getDesglose(itemTipo, itemId) {
  if (!itemId) return [];
  try {
    const rows = await db.stock_ubicaciones
      .where('[item_tipo+item_id]').equals([itemTipo, itemId])
      .filter(r => !r.deleted_at)
      .toArray();
    return rows;
  } catch {
    // Fallback si el índice compuesto no está disponible
    const all = await db.stock_ubicaciones.filter(r =>
      r.item_tipo === itemTipo && r.item_id === itemId && !r.deleted_at).toArray();
    return all;
  }
}

/** Mapa itemId → Map(ubicacion_id → cantidad) para un set de items (lista). */
export async function getDesgloseBulk(itemTipo, itemIds) {
  const set = new Set(itemIds);
  const map = new Map();
  if (!itemIds?.length) return map;
  const rows = await db.stock_ubicaciones
    .filter(r => r.item_tipo === itemTipo && set.has(r.item_id) && !r.deleted_at)
    .toArray();
  for (const r of rows) {
    if (!map.has(r.item_id)) map.set(r.item_id, new Map());
    map.get(r.item_id).set(r.ubicacion_id, (map.get(r.item_id).get(r.ubicacion_id) || 0) + Number(r.cantidad || 0));
  }
  return map;
}

/**
 * Base VALIDABLE de una salida por ubicación, tolerante al DRIFT del desglose.
 *
 * stock_actual es la fuente de verdad (trigger-managed en el server);
 * stock_ubicaciones es 100% client-driven y queda ATRÁS cuando: el
 * stock_inicial nunca se sembró (inicializarDesglose no tiene callers), una
 * recepción falló el apply post-commit, o un movimiento vino sin ubicación.
 * Caso real: material con stock_actual=8 y desglose "Almacén Central: 7" →
 * la salida legítima de 8 se bloqueaba con "hay 7, pedís 8".
 *
 * Si Σdesglose < stock_actual, la DIFERENCIA se considera disponible en la
 * ubicación elegida (donde físicamente está: el desglose es el que miente) y
 * se devuelve `reconciliarDelta` para sanear la fila vía aplicarDelta.
 * La sobre-salida REAL la sigue bloqueando el check global contra stock_actual.
 *
 * @returns { base:number, reconciliarDelta:number }
 */
export function baseSalidaUbicacion(dgItem, ubicacionId, stockActual) {
  const enUbic = Number(dgItem?.get?.(ubicacionId) || 0);
  const suma = dgItem ? [...dgItem.values()].reduce((a, b) => a + (Number(b) || 0), 0) : 0;
  const real = Number(stockActual ?? 0);
  const faltante = real - suma;
  if (faltante > 0.0001) {
    return { base: enUbic + faltante, reconciliarDelta: faltante };
  }
  return { base: enUbic, reconciliarDelta: 0 };
}

/**
 * Suma (delta > 0) o resta (delta < 0) cantidad de un item en una ubicación.
 * Hace upsert sobre la fila (item_tipo, item_id, ubicacion_id). No deja la
 * cantidad bajar de 0.
 */
export async function aplicarDelta({ obraId, itemTipo, itemId, ubicacionId, delta, userId }) {
  if (!obraId || !itemTipo || !itemId || !ubicacionId || !delta) return;
  const now = new Date().toISOString();
  const existente = (await getDesglose(itemTipo, itemId)).find(r => r.ubicacion_id === ubicacionId);
  if (existente) {
    const nueva = Math.max(0, Number(existente.cantidad || 0) + Number(delta));
    await db.stock_ubicaciones.update(existente.id, {
      cantidad: nueva,
      updated_at: now, updated_by: userId,
      version: (existente.version ?? 0) + 1,
      sync_status: existente.sync_status === PEND_CREATE ? PEND_CREATE : PEND_UPDATE,
    });
  } else {
    const id = newId();
    await db.stock_ubicaciones.add({
      id, obra_id: obraId, item_tipo: itemTipo, item_id: itemId, ubicacion_id: ubicacionId,
      cantidad: Math.max(0, Number(delta)),
      created_by: userId, updated_by: userId, created_at: now, updated_at: now,
      version: 1, sync_status: PEND_CREATE, last_synced_at: null,
      idempotency_key: `${userId || 'x'}_su_${id}`,
    });
  }
  try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'stock_ubicaciones' } })); } catch {}
}

/**
 * Traspaso entre almacenes: resta `cantidad` de la ubicación origen y la
 * suma en la destino. El stock total del item NO cambia. Devuelve {ok}.
 * El caller registra los movimientos (salida+entrada) para trazabilidad.
 */
export async function traspasar({ obraId, itemTipo, itemId, origenId, destinoId, cantidad, userId }) {
  const cant = Number(cantidad) || 0;
  if (cant <= 0) throw new Error('La cantidad a traspasar debe ser mayor a 0');
  if (!origenId || !destinoId) throw new Error('Elegí ubicación origen y destino');
  if (origenId === destinoId) throw new Error('Origen y destino no pueden ser la misma ubicación');

  const desglose = await getDesglose(itemTipo, itemId);
  const enOrigen = Number(desglose.find(r => r.ubicacion_id === origenId)?.cantidad || 0);
  if (cant > enOrigen) {
    throw new Error(`En la ubicación origen solo hay ${enOrigen}. No podés traspasar ${cant}.`);
  }
  await aplicarDelta({ obraId, itemTipo, itemId, ubicacionId: origenId, delta: -cant, userId });
  await aplicarDelta({ obraId, itemTipo, itemId, ubicacionId: destinoId, delta: +cant, userId });
  return { ok: true };
}

/**
 * Recalcula el desglose total de un item a partir de los movimientos.
 * Útil para inicializar el stock por ubicación de items que ya existían
 * antes de esta feature: pone todo el stock_actual en la ubicación
 * principal del item (o en la primera ubicación activa).
 */
export async function inicializarDesglose({ obraId, itemTipo, itemId, ubicacionId, cantidad, userId }) {
  if (!ubicacionId || !(Number(cantidad) > 0)) return;
  const yaHay = await getDesglose(itemTipo, itemId);
  if (yaHay.length) return; // ya tiene desglose, no lo pisamos
  await aplicarDelta({ obraId, itemTipo, itemId, ubicacionId, delta: Number(cantidad), userId });
}
