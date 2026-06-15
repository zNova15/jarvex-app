// ═══════════════════════════════════════════════════════════════════
// JARVEX — Historial de precio unitario de insumos
//
// Cada vez que llega un comprobante (recepción) o se cambia el precio a
// mano, si el precio difiere del estimado actual del insumo dejamos un
// evento de cambio (precio anterior → nuevo, documento, movimiento) y
// actualizamos `precio_unitario_estimado` del insumo.
//
// Dos tablas por razones históricas:
//   - materiales        → material_precios_historial (mig 020, FK a materiales)
//   - herr/epp/emergencia → insumo_precios_historial (mig 077, genérica
//                            por item_tipo+item_id, FK-less como stock_ubicaciones)
// Este módulo esconde esa diferencia: `registrarCambioPrecio` y
// `leerHistorialPrecios` enrutan a la tabla correcta según item_tipo.
// ═══════════════════════════════════════════════════════════════════

import { db, newId } from '../db/jarvex.db';

// item_tipo → tabla de catálogo (donde vive precio_unitario_estimado).
export const CATALOGO_DE = {
  material: 'materiales',
  herramienta: 'herramientas',
  epp: 'epps',
  emergencia: 'insumos_emergencia',
};

// item_tipo → tabla de historial.
const tablaHist = (itemTipo) => itemTipo === 'material' ? 'material_precios_historial' : 'insumo_precios_historial';

// Normaliza un precio (tolera coma decimal por imports/ediciones a mano).
const aNumero = (v) => Number(String(v ?? '').replace(',', '.')) || 0;

// Construye e inserta la fila de historial en la tabla que corresponda. NO toca
// el catálogo (eso lo decide el caller). Devuelve el id insertado.
async function insertarFilaHistorial({ itemTipo, itemId, obraId, precioAnterior, precioNuevo, fuente, documentoRef, origenMovId, motivo, userId, noSube, ts }) {
  const histId = newId();
  const fila = {
    id: histId, obra_id: obraId,
    precio_anterior: aNumero(precioAnterior), precio_nuevo: aNumero(precioNuevo), fecha: ts.slice(0, 10),
    motivo: motivo || null, documento_ref: documentoRef || null,
    fuente: fuente || 'movimiento', // DEBE estar en el CHECK del server
    origen_movimiento_id: origenMovId || null,
    created_by: userId, updated_by: userId, created_at: ts, updated_at: ts,
    version: 1, sync_status: noSube ? 'synced' : 'pending_create', last_synced_at: null,
    idempotency_key: `${userId || 'x'}_${itemTipo === 'material' ? 'mph' : 'iph'}_${histId}`,
    ...(noSube ? { demo: true } : {}),
  };
  if (itemTipo === 'material') fila.material_id = itemId;
  else { fila.item_tipo = itemTipo; fila.item_id = itemId; }
  await db[tablaHist(itemTipo)].add(fila);
  return histId;
}

/**
 * Registra un cambio de precio (solo si difiere del estimado actual) en la
 * tabla de historial correcta y actualiza precio_unitario_estimado del insumo.
 *
 * Pensado para correr DENTRO de una transacción Dexie (no dispara eventos): el
 * caller despacha jx_data_changed al cerrar. Devuelve true si registró algo.
 *
 * `forzarDemo` lo usa la recepción cuando la factura es demo aunque el insumo
 * no lo sea (no pushear un historial ligado a una factura que no sube).
 */
export async function registrarCambioPrecio({
  itemTipo, itemId, obraId, precioNuevo,
  fuente = 'movimiento', documentoRef = null, origenMovId = null, motivo = null,
  userId = null, isPrueba = false, forzarDemo = false, now,
}) {
  const cat = CATALOGO_DE[itemTipo];
  if (!cat || !itemId || !obraId) return false;
  const p = aNumero(precioNuevo);
  if (!(p > 0)) return false;
  const item = await db[cat].get(itemId);
  if (!item) return false;
  const anterior = aNumero(item.precio_unitario_estimado);
  if (Math.abs(p - anterior) < 0.0001) return false; // no cambió → no registra

  const ts = now || new Date().toISOString();
  // Demo-coherencia: si el insumo es demo, la factura no sube, o estamos en modo
  // prueba, la fila de historial tampoco sube (sería un puntero a algo ausente).
  const noSube = isPrueba || item.demo === true || forzarDemo;
  await insertarFilaHistorial({ itemTipo, itemId, obraId, precioAnterior: anterior, precioNuevo: p, fuente, documentoRef, origenMovId, motivo, userId, noSube, ts });
  await db[cat].update(itemId, {
    precio_unitario_estimado: p, updated_at: ts, updated_by: userId,
    version: (item.version || 0) + 1,
    sync_status: noSube ? 'synced' : (item.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'),
  });
  return true;
}

/**
 * Registra SOLO la fila de historial (no toca el catálogo): para cuando el
 * caller ya guardó el nuevo precio (ej. el form de edición del insumo). Pasale
 * el precio anterior (el de antes de guardar) y el nuevo. No registra si no hubo
 * cambio real. Devuelve true si registró.
 */
export async function registrarSoloHistorial({
  itemTipo, itemId, obraId, precioAnterior, precioNuevo,
  fuente = 'manual', documentoRef = null, origenMovId = null, motivo = null,
  userId = null, isPrueba = false, esDemo = false, now,
}) {
  if (!CATALOGO_DE[itemTipo] || !itemId || !obraId) return false;
  const ant = aNumero(precioAnterior);
  const nuevo = aNumero(precioNuevo);
  if (!(nuevo > 0) || Math.abs(nuevo - ant) < 0.0001) return false;
  const ts = now || new Date().toISOString();
  await insertarFilaHistorial({ itemTipo, itemId, obraId, precioAnterior: ant, precioNuevo: nuevo, fuente, documentoRef, origenMovId, motivo, userId, noSube: isPrueba || esDemo, ts });
  return true;
}

/** Lee el historial de un insumo (de la tabla correcta), ordenado desc por fecha. */
export async function leerHistorialPrecios(itemTipo, itemId) {
  if (!itemId) return [];
  const orden = (rows) => rows.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || (b.created_at || '').localeCompare(a.created_at || ''));
  try {
    if (itemTipo === 'material') {
      return orden(await db.material_precios_historial.where('material_id').equals(itemId).filter(r => !r.deleted_at).toArray());
    }
    return orden(await db.insumo_precios_historial.where('[item_tipo+item_id]').equals([itemTipo, itemId]).filter(r => !r.deleted_at).toArray());
  } catch {
    // Fallback sin índice compuesto.
    const rows = await db.insumo_precios_historial.filter(r => r.item_tipo === itemTipo && r.item_id === itemId && !r.deleted_at).toArray();
    return orden(rows);
  }
}

// Tablas de historial que una transacción debe incluir para poder registrar.
export const TABLAS_HISTORIAL = ['material_precios_historial', 'insumo_precios_historial'];
