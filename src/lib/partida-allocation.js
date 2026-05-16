// ═══════════════════════════════════════════════════════════════════
// JARVEX — Helper de imputación de consumo material → partida
//
// Antes: la actualización de `insumos_partida.cantidad_real_usada` +
// `partidas.costo_real_acumulado` se hacía inline en jx-almacen.jsx
// cuando el almacenero registraba una salida con partida_id.
//
// Ahora: el almacenero ya no asigna partida. Esta lógica se ejecuta
// cuando el INGENIERO vincula una salida del inbox a su partida.
// Reusable también para:
//   - reversa de imputación cuando se cambia la partida (delta inverso)
//   - aprobación de change_request que mueve la salida a otra partida
//
// El precio_unitario_real puede no estar (el ingeniero no lo ve, pero
// igual queda guardado desde almacén si lo registró). Si está, sumamos
// cantidad×precio al costo_real_acumulado de la partida.
// ═══════════════════════════════════════════════════════════════════

import { db } from '../db/jarvex.db';

const SYNC_STATUS_PENDING_UPDATE = 'pending_update';
const SYNC_STATUS_PENDING_CREATE = 'pending_create';

/**
 * Aplica el consumo de un movimiento de salida sobre una partida.
 * - Suma `mov.cantidad` al insumo que matchea por nombre dentro de la partida
 * - Suma `mov.cantidad × mov.precio_unitario_real` al costo_real_acumulado
 *
 * @param {Object} opts
 * @param {Object} opts.mov         — movimiento_materiales (con cantidad, precio_unitario_real)
 * @param {string} opts.partida_id  — id de la partida a imputar
 * @param {Object} opts.material    — material del catálogo (para matchear nombre vs insumo)
 * @param {string} opts.userId      — usuario que ejecuta (para audit)
 * @returns {Promise<{insumoTouched: string|null, costoDelta: number}>}
 */
export async function aplicarConsumoPartida({ mov, partida_id, material, userId }) {
  const cantidad = Number(mov.cantidad || 0);
  if (!partida_id || cantidad <= 0) return { insumoTouched: null, costoDelta: 0 };

  // Buscar el insumo material de esa partida que matchea por nombre.
  // Heurística: todas las palabras ≥4 chars del material deben estar
  // contenidas en el nombre del insumo (caso-insensible).
  let insumoTouched = null;
  try {
    const insumos = await db.insumos_partida.where('partida_id').equals(partida_id).toArray();
    const palabras = String(material?.nombre_material || '')
      .toLowerCase()
      .split(/[^a-záéíóúñ0-9]+/)
      .filter(p => p.length >= 4);
    const target = insumos.find(i =>
      !i.deleted_at &&
      i.tipo_insumo === 'material' &&
      palabras.length > 0 &&
      palabras.every(w => String(i.nombre_insumo || '').toLowerCase().includes(w))
    );
    if (target) {
      const nuevoUsado = Number(target.cantidad_real_usada || 0) + cantidad;
      await db.insumos_partida.update(target.id, {
        cantidad_real_usada: nuevoUsado,
        sync_status: target.sync_status === SYNC_STATUS_PENDING_CREATE ? SYNC_STATUS_PENDING_CREATE : SYNC_STATUS_PENDING_UPDATE,
        updated_at: new Date().toISOString(),
        updated_by: userId,
        version: (target.version ?? 0) + 1,
      });
      insumoTouched = target.id;
    }
  } catch (e) {
    console.warn('[partida-allocation] no se pudo actualizar insumo_partida:', e?.message);
  }

  // Actualizar costo_real_acumulado de la partida si hay precio.
  let costoDelta = 0;
  const precioReal = Number(mov.precio_unitario_real || 0);
  if (precioReal > 0) {
    try {
      const partida = await db.partidas.get(partida_id);
      if (partida && !partida.deleted_at) {
        costoDelta = cantidad * precioReal;
        const nuevoCosto = Number(partida.costo_real_acumulado || 0) + costoDelta;
        await db.partidas.update(partida_id, {
          costo_real_acumulado: nuevoCosto,
          sync_status: partida.sync_status === SYNC_STATUS_PENDING_CREATE ? SYNC_STATUS_PENDING_CREATE : SYNC_STATUS_PENDING_UPDATE,
          updated_at: new Date().toISOString(),
          updated_by: userId,
          version: (partida.version ?? 0) + 1,
        });
      }
    } catch (e) {
      console.warn('[partida-allocation] no se pudo actualizar costo partida:', e?.message);
    }
  }

  return { insumoTouched, costoDelta };
}

/**
 * Revierte el consumo previamente imputado a una partida (delta negativo).
 * Se usa cuando se cambia de partida en un mov ya imputado, antes de
 * aplicar la nueva. Garantiza que partidas.costo_real_acumulado no se
 * descontrola por cambios de asignación.
 */
export async function revertirConsumoPartida({ mov, partida_id, material, userId }) {
  const cantidad = Number(mov.cantidad || 0);
  if (!partida_id || cantidad <= 0) return;

  try {
    const insumos = await db.insumos_partida.where('partida_id').equals(partida_id).toArray();
    const palabras = String(material?.nombre_material || '')
      .toLowerCase()
      .split(/[^a-záéíóúñ0-9]+/)
      .filter(p => p.length >= 4);
    const target = insumos.find(i =>
      !i.deleted_at &&
      i.tipo_insumo === 'material' &&
      palabras.length > 0 &&
      palabras.every(w => String(i.nombre_insumo || '').toLowerCase().includes(w))
    );
    if (target) {
      const nuevoUsado = Math.max(0, Number(target.cantidad_real_usada || 0) - cantidad);
      await db.insumos_partida.update(target.id, {
        cantidad_real_usada: nuevoUsado,
        sync_status: target.sync_status === SYNC_STATUS_PENDING_CREATE ? SYNC_STATUS_PENDING_CREATE : SYNC_STATUS_PENDING_UPDATE,
        updated_at: new Date().toISOString(),
        updated_by: userId,
        version: (target.version ?? 0) + 1,
      });
    }
  } catch (e) {
    console.warn('[partida-allocation] no se pudo revertir insumo_partida:', e?.message);
  }

  const precioReal = Number(mov.precio_unitario_real || 0);
  if (precioReal > 0) {
    try {
      const partida = await db.partidas.get(partida_id);
      if (partida && !partida.deleted_at) {
        const nuevoCosto = Math.max(0, Number(partida.costo_real_acumulado || 0) - cantidad * precioReal);
        await db.partidas.update(partida_id, {
          costo_real_acumulado: nuevoCosto,
          sync_status: partida.sync_status === SYNC_STATUS_PENDING_CREATE ? SYNC_STATUS_PENDING_CREATE : SYNC_STATUS_PENDING_UPDATE,
          updated_at: new Date().toISOString(),
          updated_by: userId,
          version: (partida.version ?? 0) + 1,
        });
      }
    } catch (e) {
      console.warn('[partida-allocation] no se pudo revertir costo partida:', e?.message);
    }
  }
}
