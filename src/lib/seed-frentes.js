// Siembra de frentes de trabajo típicos de una obra de saneamiento.
import { db } from '../db/jarvex.db.js';

const DEFAULTS = [
  'Captación', 'Línea de Conducción', 'Reservorio', 'Línea de Distribución',
  'Redes de Agua Potable', 'Alcantarillado', 'UBS / Conexiones',
];

export async function seedFrentesPorDefecto(obraId, userId) {
  if (!obraId) return [];
  const existentes = await db.frentes_obra.where('obra_id').equals(obraId).filter(f => !f.deleted_at).toArray();
  if (existentes.length > 0) return [];
  const now = new Date().toISOString();
  const creados = [];
  for (let i = 0; i < DEFAULTS.length; i++) {
    const id = window.__newId();
    const rec = {
      id, obra_id: obraId, nombre: DEFAULTS[i], descripcion: null, ingeniero_id: null,
      orden: i + 1, activo: true,
      created_by: userId, updated_by: userId, created_at: now, updated_at: now,
      version: 1, sync_status: 'pending_create', last_synced_at: null,
      idempotency_key: `${userId}_frente_${id}`,
    };
    await db.frentes_obra.add(rec);
    creados.push(rec);
  }
  try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'frentes_obra' } })); } catch {}
  return creados;
}
