// ═══════════════════════════════════════════════════════════════════
// JARVEX — Audit log client
// Registra acciones (insert/update/delete) en Supabase. Si offline,
// guarda en IndexedDB (audit_log_pending) y sincroniza después.
// ═══════════════════════════════════════════════════════════════════

import { db, newId } from '../db/jarvex.db';
import { supabase } from './supabase';

const VALID_ACTIONS = ['insert', 'update', 'delete'];

async function getCurrentUser() {
  try {
    const { data } = await supabase.auth.getUser();
    const user = data?.user;
    if (user) return { id: user.id, email: user.email || null };
  } catch (e) { /* offline */ }

  // Fallback: usar cache local
  try {
    const cached = await db.auth_cache.get('current_profile');
    if (cached?.value) return { id: cached.value.id, email: cached.value.email || null };
  } catch (e) { /* sin cache */ }

  return { id: null, email: null };
}

/**
 * Registra una entrada de auditoría.
 * @param {Object} opts
 * @param {'insert'|'update'|'delete'} opts.action
 * @param {string} opts.table         — nombre de la tabla
 * @param {string} opts.recordId      — UUID del registro afectado
 * @param {Object|null} [opts.oldData]
 * @param {Object|null} [opts.newData]
 * @param {string} [opts.reason]
 */
export async function logAudit({ action, table, recordId, oldData = null, newData = null, reason = null }) {
  if (!VALID_ACTIONS.includes(action)) {
    console.warn('[audit] acción inválida:', action);
    return;
  }
  if (!table) {
    console.warn('[audit] table requerido');
    return;
  }

  const { id: userId, email: userEmail } = await getCurrentUser();
  const createdAt = new Date().toISOString();

  const row = {
    user_id: userId,
    user_email: userEmail,
    action,
    table_name: table,
    record_id: recordId || null,
    old_data: oldData,
    new_data: newData,
    reason: reason || null,
  };

  // Intentar enviar online directamente
  if (navigator.onLine && userId) {
    try {
      const { error } = await supabase.from('audit_log').insert(row);
      if (!error) return;
      console.warn('[audit] online insert falló, guardando en cola:', error.message);
    } catch (e) {
      console.warn('[audit] online insert excepción, guardando en cola:', e?.message || e);
    }
  }

  // Offline o falló: encolar localmente
  try {
    await db.audit_log_pending.put({
      id: newId(),
      created_at: createdAt,
      action,
      table_name: table,
      record_id: recordId || null,
      old_data: oldData,
      new_data: newData,
      reason: reason || null,
      user_id: userId,
      user_email: userEmail,
      synced: false,
    });
  } catch (e) {
    console.warn('[audit] no se pudo encolar log local:', e?.message || e);
  }
}

/**
 * Sube los logs pendientes a Supabase.
 * Devuelve el número de logs sincronizados.
 */
export async function syncPendingAuditLogs() {
  if (!navigator.onLine) return 0;

  let pending;
  try {
    pending = await db.audit_log_pending.where('synced').equals(0).toArray();
    if (!pending.length) {
      // Dexie indexa booleanos como 0/1 — fallback por si están como false
      pending = await db.audit_log_pending.filter(r => !r.synced).toArray();
    }
  } catch (e) {
    return 0;
  }
  if (!pending.length) return 0;

  let synced = 0;
  for (const row of pending) {
    const payload = {
      user_id: row.user_id,
      user_email: row.user_email,
      action: row.action,
      table_name: row.table_name,
      record_id: row.record_id,
      old_data: row.old_data,
      new_data: row.new_data,
      reason: row.reason,
      created_at: row.created_at,
    };
    if (!payload.user_id) continue; // sin user_id falla RLS

    try {
      const { error } = await supabase.from('audit_log').insert(payload);
      if (!error) {
        await db.audit_log_pending.update(row.id, { synced: true });
        synced++;
      } else {
        console.warn('[audit] sync falló para', row.id, error.message);
      }
    } catch (e) {
      console.warn('[audit] sync excepción para', row.id, e?.message || e);
    }
  }

  // Limpiar logs ya sincronizados con más de 7 días para no acumular basura
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    await db.audit_log_pending
      .filter(r => r.synced === true && r.created_at < cutoff)
      .delete();
  } catch (e) { /* noop */ }

  return synced;
}

/**
 * Lee logs de auditoría desde Supabase con filtros.
 * @param {Object} opts
 * @param {string} [opts.table]
 * @param {string} [opts.recordId]
 * @param {string} [opts.userId]
 * @param {number} [opts.limit=100]
 */
export async function listAuditLogs({ table, recordId, userId, limit = 100 } = {}) {
  let q = supabase
    .from('audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (table)    q = q.eq('table_name', table);
  if (recordId) q = q.eq('record_id', recordId);
  if (userId)   q = q.eq('user_id', userId);

  const { data, error } = await q;
  if (error) {
    console.warn('[audit] listAuditLogs:', error.message);
    return [];
  }
  return data || [];
}
