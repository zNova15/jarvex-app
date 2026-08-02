// ═══════════════════════════════════════════════════════════════════
// JARVEX — Consultas del puente ALMACÉN ↔ CONTABILIDAD (Fase 2)
//
// Hilo dirigido: una parte pregunta por un insumo/factura con referencia
// EXACTA y SIN COSTOS; la otra responde (Sí / Parcial / No / Otra fecha).
// Escritura offline-first: Dexie + eventos de sync (igual que el resto).
// La tabla puente_consultas tiene RLS authenticated (ambos roles conversan).
// ═══════════════════════════════════════════════════════════════════

import { db, newId } from '../db/jarvex.db';

const ahora = () => new Date().toISOString();
const uid = () => window.__currentUserId || null;

export const RESPUESTA_TIPOS = [
  { value: 'si', label: '✅ Sí, llegó', tone: 'green' },
  { value: 'parcial', label: '🟡 Parcial', tone: 'amber' },
  { value: 'no', label: '❌ No llegó', tone: 'red' },
  { value: 'otra_fecha', label: '📅 Llegó en otra fecha', tone: 'amber' },
];
export const RESPUESTA_LABEL = Object.fromEntries(RESPUESTA_TIPOS.map(r => [r.value, r.label]));
export const ORIGEN_LABEL = { almacen: 'Almacén', contabilidad: 'Contabilidad' };

function emitir() {
  try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'puente_consultas' } })); } catch {}
  try { window.dispatchEvent(new Event('online')); } catch {}
}

/**
 * Crea una consulta. `referencia` DEBE venir sin costos (usar referenciaSinCostos
 * para facturas). origen: 'almacen' | 'contabilidad'.
 */
export async function crearConsulta({ obra_id = null, origen, accounting_movement_id = null, item_idx = null, movimiento_id = null, referencia = {}, pregunta }) {
  if (origen !== 'almacen' && origen !== 'contabilidad') throw new Error('origen inválido');
  const id = newId();
  const t = ahora();
  const u = uid();
  const row = {
    id, obra_id, origen, estado: 'abierta',
    accounting_movement_id, item_idx: (item_idx == null ? null : Number(item_idx)), movimiento_id,
    referencia: referencia || {},
    pregunta: String(pregunta || '').trim() || '(sin texto)',
    respuesta: null, respuesta_tipo: null,
    created_by: u, updated_by: u, created_at: t, updated_at: t,
    version: 1, deleted_at: null,
    idempotency_key: `${u || 'x'}_cons_${id}`,
    sync_status: 'pending_create', last_synced_at: null,
  };
  await db.puente_consultas.put(row);
  try { await window.__logAudit?.({ action: 'insert', table: 'puente_consultas', recordId: id, reason: `Consulta ${origen}→${origen === 'almacen' ? 'contabilidad' : 'almacén'}: ${row.pregunta.slice(0, 80)}` }); } catch {}
  emitir();
  return row;
}

/** Responde una consulta abierta. respuesta_tipo: si|parcial|no|otra_fecha. */
export async function responderConsulta(id, { respuesta_tipo = null, respuesta = '' } = {}) {
  const c = await db.puente_consultas.get(id);
  if (!c) throw new Error('La consulta ya no existe');
  const t = ahora();
  const u = uid();
  await db.puente_consultas.update(id, {
    respuesta: String(respuesta || '').trim() || null,
    respuesta_tipo: respuesta_tipo || null,
    estado: 'respondida',
    updated_by: u, updated_at: t, version: (c.version || 0) + 1,
    sync_status: c.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
  });
  try { await window.__logAudit?.({ action: 'update', table: 'puente_consultas', recordId: id, reason: `Respuesta: ${respuesta_tipo || ''} ${String(respuesta || '').slice(0, 60)}`.trim() }); } catch {}
  emitir();
}

/** Cierra una consulta (ya resuelta / ya no aplica). */
export async function cerrarConsulta(id) {
  const c = await db.puente_consultas.get(id);
  if (!c) return;
  const t = ahora();
  const u = uid();
  await db.puente_consultas.update(id, {
    estado: 'cerrada', updated_by: u, updated_at: t, version: (c.version || 0) + 1,
    sync_status: c.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
  });
  emitir();
}
