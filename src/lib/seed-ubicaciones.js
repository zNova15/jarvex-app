import { db, newId, newIdempotencyKey, SYNC_STATUS } from '../db/jarvex.db';
import { getCurrentMode } from '../hooks/useAppMode';

export const UBICACIONES_DEFAULT = [
  { nombre: 'Almacén Central', descripcion: 'Almacén principal cubierto',     orden: 1 },
  { nombre: 'Patio',           descripcion: 'Zona descubierta',                orden: 2 },
  { nombre: 'Frente de Obra',  descripcion: 'Almacén temporal en el frente',   orden: 3 },
  { nombre: 'Externo',         descripcion: 'Almacenamiento externo / tercero', orden: 4 },
];

// Crea las ubicaciones por defecto para una obra recién creada (o vacía).
// Idempotente: si ya hay alguna ubicación viva (no eliminada) en la obra,
// no inserta nada para evitar duplicados.
export async function seedUbicacionesPorDefecto(obraId, userId = 'offline') {
  if (!obraId) return [];
  const existentes = await db.ubicaciones_obra
    .where('obra_id').equals(obraId)
    .filter(u => !u.deleted_at)
    .count();
  if (existentes > 0) return [];

  const isPrueba = getCurrentMode() === 'prueba';
  const now = new Date().toISOString();
  const creados = [];

  for (const u of UBICACIONES_DEFAULT) {
    const record = {
      id: newId(),
      obra_id: obraId,
      nombre: u.nombre,
      descripcion: u.descripcion,
      orden: u.orden,
      activo: true,
      created_by: userId,
      updated_by: userId,
      created_at: now,
      updated_at: now,
      version: 1,
      sync_status: isPrueba ? SYNC_STATUS.SYNCED : SYNC_STATUS.PENDING_CREATE,
      last_synced_at: null,
      idempotency_key: newIdempotencyKey(userId, 'ubicaciones_obra'),
      deleted_at: null,
      ...(isPrueba ? { demo: true } : {}),
    };
    await db.ubicaciones_obra.add(record);
    creados.push(record);
  }

  window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'ubicaciones_obra' } }));
  return creados;
}
