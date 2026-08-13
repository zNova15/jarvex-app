// ═══════════════════════════════════════════════════════════════════
// JARVEX — Change Requests client
// Crea/lista/aprueba/rechaza solicitudes de cambio. Si está offline,
// la creación se encola en Dexie (change_requests_pending) para sync
// posterior, siguiendo el patrón de audit_log_pending.
// ═══════════════════════════════════════════════════════════════════

import { db, newId } from '../db/jarvex.db';
import { supabase } from './supabase';
import { logAudit } from './audit';

async function getCurrentUser() {
  try {
    const { data } = await supabase.auth.getUser();
    const user = data?.user;
    if (user) return { id: user.id, email: user.email || null };
  } catch (e) { /* offline */ }
  try {
    const cached = await db.auth_cache.get('current_profile');
    if (cached?.value) return { id: cached.value.id, email: cached.value.email || null };
  } catch (e) {}
  return { id: null, email: null };
}

/**
 * Crea una solicitud de cambio.
 * @param {Object} opts
 * @param {string} opts.table              — tabla target (ej: 'materiales')
 * @param {string} opts.recordId           — UUID del registro
 * @param {string} [opts.recordLabel]      — etiqueta legible (ej: nombre)
 * @param {Object} opts.proposedChanges    — { field: { old, new } }
 * @param {string} opts.reason             — motivo (mín 10 caracteres)
 */
export async function createChangeRequest({ table, recordId, recordLabel, proposedChanges, reason }) {
  if (!table) throw new Error('table requerido');
  if (!proposedChanges || Object.keys(proposedChanges).length === 0) {
    throw new Error('proposedChanges requerido');
  }
  if (!reason || reason.trim().length < 10) {
    throw new Error('El motivo debe tener al menos 10 caracteres');
  }

  const { id: userId, email: userEmail } = await getCurrentUser();
  const createdAt = new Date().toISOString();

  const row = {
    requester_id: userId,
    requester_email: userEmail,
    target_table: table,
    target_record_id: recordId || null,
    target_record_label: recordLabel || null,
    proposed_changes: proposedChanges,
    reason: reason.trim(),
    status: 'pendiente',
  };

  // Online: insertar directo
  if (navigator.onLine && userId) {
    try {
      const { data, error } = await supabase.from('change_requests').insert(row).select().single();
      if (!error) return data;
      console.warn('[changeRequests] online insert falló, encolando:', error.message);
    } catch (e) {
      console.warn('[changeRequests] online insert excepción, encolando:', e?.message || e);
    }
  }

  // Offline o falló → cola local
  try {
    const localId = newId();
    await db.change_requests_pending.put({
      id: localId,
      created_at: createdAt,
      requester_id: userId,
      requester_email: userEmail,
      target_table: table,
      target_record_id: recordId || null,
      target_record_label: recordLabel || null,
      proposed_changes: proposedChanges,
      reason: reason.trim(),
      status: 'pendiente',
      synced: false,
    });
    return { id: localId, ...row, created_at: createdAt, _pending: true };
  } catch (e) {
    console.warn('[changeRequests] no se pudo encolar local:', e?.message || e);
    throw e;
  }
}

/**
 * Lista solicitudes de cambio. Si está offline, devuelve [].
 * @param {Object} opts
 * @param {string} [opts.status]         — 'pendiente' | 'aprobada' | etc
 * @param {string} [opts.requesterId]    — filtrar por solicitante
 * @param {number} [opts.limit=100]
 */
export async function listChangeRequests({ status, requesterId, limit = 100 } = {}) {
  if (!navigator.onLine) return [];

  let q = supabase
    .from('change_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status) q = q.eq('status', status);
  if (requesterId) q = q.eq('requester_id', requesterId);

  const { data, error } = await q;
  if (error) {
    console.warn('[changeRequests] list:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Cuenta solicitudes pendientes (para badge sidebar).
 */
export async function countPendingChangeRequests() {
  if (!navigator.onLine) return 0;
  const { count, error } = await supabase
    .from('change_requests')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pendiente');
  if (error) return 0;
  return count || 0;
}

/**
 * Aprueba una solicitud. Aplica los cambios al registro target via
 * callback `applyChange(req)`, escribe entrada en audit_log y marca
 * como aprobada.
 *
 * @param {string} requestId
 * @param {string} comment
 * @param {(req: Object) => Promise<{oldData?:Object, newData?:Object}>} applyChange
 */
export async function approveChangeRequest(requestId, comment, applyChange) {
  // 1. Leer el request actual
  const { data: req, error: readErr } = await supabase
    .from('change_requests')
    .select('*')
    .eq('id', requestId)
    .single();
  if (readErr) throw readErr;
  if (!req) throw new Error('Solicitud no encontrada');
  if (req.status !== 'pendiente') {
    throw new Error(`La solicitud ya está ${req.status}`);
  }

  // 2. Aplicar cambios al registro target
  let applyResult = {};
  try {
    if (typeof applyChange === 'function') {
      applyResult = (await applyChange(req)) || {};
    }
  } catch (e) {
    throw new Error('No se pudo aplicar el cambio: ' + (e?.message || e));
  }

  // 3. Marcar como aprobada
  const { id: reviewerId } = await getCurrentUser();
  const { data: updated, error: updErr } = await supabase
    .from('change_requests')
    .update({
      status: 'aprobada',
      reviewer_id: reviewerId,
      reviewer_comment: comment || null,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .select()
    .single();
  if (updErr) throw updErr;

  // 4. Audit log
  try {
    await logAudit({
      action: 'update',
      table: req.target_table,
      recordId: req.target_record_id,
      oldData: applyResult.oldData || null,
      newData: applyResult.newData || req.proposed_changes,
      reason: `Aprobada solicitud #${req.id} — ${req.reason}`,
    });
  } catch (e) {
    console.warn('[changeRequests] audit log falló:', e?.message || e);
  }

  return updated;
}

/**
 * Rechaza una solicitud con comentario.
 */
export async function rejectChangeRequest(requestId, comment) {
  if (!comment || comment.trim().length < 3) {
    throw new Error('El comentario de rechazo es obligatorio');
  }
  const { id: reviewerId } = await getCurrentUser();
  const { data, error } = await supabase
    .from('change_requests')
    .update({
      status: 'rechazada',
      reviewer_id: reviewerId,
      reviewer_comment: comment.trim(),
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * El solicitante EDITA su propia request pendiente (valor propuesto y/o motivo).
 * RLS (mig 124) solo lo permite si es suya y sigue pendiente — el status no
 * puede salir de pendiente/cancelada por este camino.
 */
export async function updateOwnChangeRequest(requestId, { proposedChanges, reason } = {}) {
  const patch = {};
  if (proposedChanges && Object.keys(proposedChanges).length > 0) patch.proposed_changes = proposedChanges;
  if (reason != null) {
    if (String(reason).trim().length < 10) throw new Error('El motivo debe tener al menos 10 caracteres');
    patch.reason = String(reason).trim();
  }
  if (Object.keys(patch).length === 0) throw new Error('Nada que actualizar');

  const { id: userId } = await getCurrentUser();
  if (!userId || !navigator.onLine) throw new Error('Necesitás conexión para editar una solicitud');
  const { data, error } = await supabase
    .from('change_requests')
    .update(patch)
    .eq('id', requestId)
    .eq('requester_id', userId)
    .eq('status', 'pendiente')
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * El solicitante cancela su propia request pendiente.
 */
export async function cancelChangeRequest(requestId) {
  const { data, error } = await supabase
    .from('change_requests')
    .update({ status: 'cancelada' })
    .eq('id', requestId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Sube las solicitudes encoladas offline.
 */
export async function syncPendingChangeRequests() {
  if (!navigator.onLine) return 0;

  let pending;
  try {
    pending = await db.change_requests_pending.where('synced').equals(0).toArray();
    if (!pending.length) {
      pending = await db.change_requests_pending.filter(r => !r.synced).toArray();
    }
  } catch (e) {
    return 0;
  }
  if (!pending.length) return 0;

  // RLS (mig 125): el INSERT exige requester_id = auth.uid(). La cola es por
  // DEVICE (Dexie compartido), así que en una PC compartida solo se suben las
  // filas del usuario logueado AHORA; las de otro usuario esperan a que él
  // vuelva a loguearse acá (antes el insert por rol las subía; hoy fallaría
  // 42501 en silencio en cada sync).
  let uid = null;
  try { const { data } = await supabase.auth.getUser(); uid = data?.user?.id || null; } catch {}
  if (!uid) return 0;

  let synced = 0;
  for (const row of pending) {
    if (!row.requester_id || row.requester_id !== uid) continue;
    const payload = {
      requester_id: row.requester_id,
      requester_email: row.requester_email,
      target_table: row.target_table,
      target_record_id: row.target_record_id,
      target_record_label: row.target_record_label,
      proposed_changes: row.proposed_changes,
      reason: row.reason,
      status: 'pendiente',
      created_at: row.created_at,
    };
    try {
      const { error } = await supabase.from('change_requests').insert(payload);
      if (!error) {
        await db.change_requests_pending.update(row.id, { synced: true, _last_error: null });
        synced++;
      } else {
        console.warn('[changeRequests] sync falló para', row.id, error.message);
        // Motivo VISIBLE: antes el fallo era solo un console.warn — la solicitud
        // quedaba "fantasma" en este dispositivo (el solicitante creía que la
        // envió y el admin nunca la veía). El banner de Solicitudes lo muestra.
        try { await db.change_requests_pending.update(row.id, { _last_error: error.message || 'error', _last_error_at: new Date().toISOString() }); } catch {}
      }
    } catch (e) {
      console.warn('[changeRequests] sync excepción para', row.id, e?.message || e);
      try { await db.change_requests_pending.update(row.id, { _last_error: e?.message || String(e), _last_error_at: new Date().toISOString() }); } catch {}
    }
  }

  // Limpieza de filas sincronizadas con más de 7 días
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    await db.change_requests_pending
      .filter(r => r.synced === true && r.created_at < cutoff)
      .delete();
  } catch (e) {}

  return synced;
}

/**
 * Cola LOCAL de solicitudes aún no subidas al servidor (las "fantasma": el
 * solicitante cree que las envió pero el admin no las ve). Para el banner de
 * la página de Solicitudes. Incluye el motivo del último fallo y si la fila
 * pertenece a OTRO usuario (PC compartida: sube recién cuando él se loguee).
 */
export async function getColaLocalPendiente() {
  let rows = [];
  try { rows = await db.change_requests_pending.filter(r => !r.synced).toArray(); } catch { return []; }
  if (!rows.length) return [];
  let uid = null;
  try { const { data } = await supabase.auth.getUser(); uid = data?.user?.id || null; } catch {}
  return rows.map(r => ({
    id: r.id,
    target_table: r.target_table,
    label: r.target_record_label || r.target_table || '(solicitud)',
    reason: r.reason || '',
    created_at: r.created_at || '',
    requester_email: r.requester_email || null,
    deOtroUsuario: !!(uid && r.requester_id && r.requester_id !== uid),
    error: r._last_error || null,
  })).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}
