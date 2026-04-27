import React from "react";
const { useState: uSS, useEffect: uES, useMemo: uMS, useCallback: uCS } = React;

// ─── Helpers ─────────────────────────────────────────────
const STATUS_BADGE = {
  pendiente:  { class: 'b-amber',  label: 'Pendiente' },
  aprobada:   { class: 'b-green',  label: 'Aprobada' },
  rechazada:  { class: 'b-red',    label: 'Rechazada' },
  cancelada:  { class: 'b-gray',   label: 'Cancelada' },
};

const TABLE_LABELS = {
  materiales: 'Materiales',
  herramientas: 'Herramientas',
  personal: 'Personal',
  proveedores: 'Proveedores',
  obras: 'Obras',
  movimientos_materiales: 'Mov. Materiales',
  movimientos_herramientas: 'Mov. Herramientas',
  asistencia: 'Asistencia',
  partidas: 'Partidas',
  avance_obra: 'Avance Obra',
  incidencias: 'Incidencias',
};

function fmtDate(ts) {
  try { return new Date(ts).toLocaleString('es-PE'); } catch { return ts; }
}

// ─── Diff visual de proposed_changes ─────────────────────
function ChangeDiff({ changes }) {
  if (!changes || typeof changes !== 'object') return <span style={{ color: 'var(--tm)' }}>—</span>;
  const entries = Object.entries(changes);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {entries.map(([field, val]) => {
        const oldV = val && typeof val === 'object' ? val.old : undefined;
        const newV = val && typeof val === 'object' ? val.new : val;
        return (
          <div key={field} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 12, alignItems: 'center' }}>
            <span style={{ color: 'var(--tm)', fontWeight: 600, minWidth: 100 }}>{field}:</span>
            {oldV !== undefined && (
              <span style={{ background: 'rgba(231,76,60,0.1)', border: '1px solid rgba(231,76,60,0.25)', color: '#EF6B5E', padding: '2px 8px', borderRadius: 4, textDecoration: 'line-through', fontSize: 11.5 }}>
                {String(oldV ?? '—')}
              </span>
            )}
            {oldV !== undefined && <span style={{ color: 'var(--tm)' }}>→</span>}
            <span style={{ background: 'rgba(46,204,113,0.1)', border: '1px solid rgba(46,204,113,0.25)', color: '#2ECC71', padding: '2px 8px', borderRadius: 4, fontSize: 11.5 }}>
              {String(newV ?? '—')}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── SolicitudesPage ─────────────────────────────────────
function SolicitudesPage({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const isAdmin = auth?.profile?.rol === 'admin';
  const myId = auth?.profile?.id;

  const [tab, setTab] = uSS(isAdmin ? 'pendientes' : 'mias');
  const [requests, setRequests] = uSS([]);
  const [loading, setLoading] = uSS(true);
  const [busy, setBusy] = uSS(false);

  const [reviewing, setReviewing] = uSS(null);     // request en revisión
  const [reviewMode, setReviewMode] = uSS(null);   // 'approve' | 'reject'
  const [reviewComment, setReviewComment] = uSS('');

  const cr = window.__changeRequests || {};

  const reload = uCS(async () => {
    setLoading(true);
    try {
      let data;
      if (tab === 'pendientes' && isAdmin) {
        data = await cr.list?.({ status: 'pendiente', limit: 200 }) || [];
      } else {
        data = await cr.list?.({ requesterId: myId, limit: 200 }) || [];
      }
      setRequests(data);
    } catch (e) {
      console.warn('[SolicitudesPage] load error', e);
    } finally {
      setLoading(false);
    }
  }, [tab, isAdmin, myId]);

  uES(() => { reload(); }, [reload]);

  const handleCancel = async (req) => {
    if (!confirm('¿Cancelar esta solicitud?')) return;
    setBusy(true);
    try {
      await cr.cancel(req.id);
      showToast('Solicitud cancelada', 'amber');
      reload();
    } catch (e) {
      showToast('Error: ' + (e?.message || e), 'red');
    } finally {
      setBusy(false);
    }
  };

  // applyChange callback: aplica los cambios al registro target.
  // Usa los hooks expuestos en window.__hooks. Lo más universal es
  // escribir directamente a Dexie + Supabase via las funciones update.
  // Aquí usamos un atajo: escribimos directo a Supabase y a Dexie local.
  const applyChange = async (req) => {
    const fields = {};
    for (const [k, v] of Object.entries(req.proposed_changes || {})) {
      fields[k] = v && typeof v === 'object' && 'new' in v ? v.new : v;
    }

    // Leer registro actual para oldData (si existe)
    let oldData = null;
    try {
      const local = await window.__db?.[req.target_table]?.get(req.target_record_id);
      if (local) oldData = local;
    } catch (e) {}
    if (!oldData) {
      try {
        const { data } = await window.__supabase
          .from(req.target_table)
          .select('*')
          .eq('id', req.target_record_id)
          .single();
        if (data) oldData = data;
      } catch (e) {}
    }

    // Aplicar en Supabase
    const { error } = await window.__supabase
      .from(req.target_table)
      .update(fields)
      .eq('id', req.target_record_id);
    if (error) throw error;

    // Reflejar localmente en Dexie (si la tabla existe)
    try {
      if (window.__db?.[req.target_table]) {
        await window.__db[req.target_table].update(req.target_record_id, fields);
      }
    } catch (e) {}

    return { oldData, newData: fields };
  };

  const handleApprove = async () => {
    if (!reviewing) return;
    setBusy(true);
    try {
      await cr.approve(reviewing.id, reviewComment, applyChange);
      showToast('Solicitud aprobada y aplicada', 'green');
      setReviewing(null); setReviewMode(null); setReviewComment('');
      reload();
    } catch (e) {
      showToast('Error: ' + (e?.message || e), 'red');
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!reviewing) return;
    if (!reviewComment || reviewComment.trim().length < 3) {
      showToast('Indica el motivo del rechazo (mín 3 caracteres)', 'red');
      return;
    }
    setBusy(true);
    try {
      await cr.reject(reviewing.id, reviewComment);
      showToast('Solicitud rechazada', 'amber');
      setReviewing(null); setReviewMode(null); setReviewComment('');
      reload();
    } catch (e) {
      showToast('Error: ' + (e?.message || e), 'red');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Solicitudes de Cambio</div>
          <div className="pg-sub">
            {tab === 'pendientes'
              ? `${requests.length} solicitudes esperando revisión`
              : `${requests.length} solicitudes propias`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={reload}>
            <JxIcon name="activity" size={13} />Recargar
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, borderBottom: '1px solid var(--border)' }}>
        <button
          className={`btn btn-ghost btn-sm`}
          onClick={() => setTab('mias')}
          style={{
            borderRadius: 0,
            borderBottom: tab === 'mias' ? '2px solid var(--amber)' : '2px solid transparent',
            color: tab === 'mias' ? 'var(--amber)' : 'var(--tm)',
            fontWeight: tab === 'mias' ? 700 : 500,
          }}>
          <JxIcon name="user" size={13} /> Mis Solicitudes
        </button>
        {isAdmin && (
          <button
            className={`btn btn-ghost btn-sm`}
            onClick={() => setTab('pendientes')}
            style={{
              borderRadius: 0,
              borderBottom: tab === 'pendientes' ? '2px solid var(--amber)' : '2px solid transparent',
              color: tab === 'pendientes' ? 'var(--amber)' : 'var(--tm)',
              fontWeight: tab === 'pendientes' ? 700 : 500,
            }}>
            <JxIcon name="shield" size={13} /> Pendientes de Revisión
          </button>
        )}
      </div>

      {loading ? (
        <div className="card card-p empty-state">
          <JxIcon name="shield" size={32} color="var(--tm)" />
          <p>Cargando solicitudes…</p>
        </div>
      ) : requests.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="checkCircle" size={40} color="var(--tm)" />
          <p>{tab === 'pendientes' ? 'No hay solicitudes pendientes de revisión.' : 'Aún no has creado solicitudes de cambio.'}</p>
        </div>
      ) : tab === 'pendientes' && isAdmin ? (
        // ── ADMIN: cards con diff y botones ─────────────
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
          {requests.map(req => (
            <div key={req.id} className="card card-p">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tp)', marginBottom: 4 }}>
                    <span className="tag" style={{ marginRight: 6 }}>{TABLE_LABELS[req.target_table] || req.target_table}</span>
                    {req.target_record_label || <span style={{ color: 'var(--tm)' }}>(sin etiqueta)</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>
                    Solicita: <span style={{ color: 'var(--ts)' }}>{req.requester_email || '—'}</span> · {fmtDate(req.created_at)}
                  </div>
                </div>
                <span className={`badge ${STATUS_BADGE.pendiente.class}`}>{STATUS_BADGE.pendiente.label}</span>
              </div>

              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--tm)', letterSpacing: '.08em', marginBottom: 6 }}>CAMBIOS PROPUESTOS</div>
                <ChangeDiff changes={req.proposed_changes} />
              </div>

              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--tm)', letterSpacing: '.08em', marginBottom: 4 }}>MOTIVO</div>
                <div style={{ fontSize: 12.5, color: 'var(--ts)', lineHeight: 1.5 }}>{req.reason}</div>
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-red btn-sm" disabled={busy}
                        onClick={() => { setReviewing(req); setReviewMode('reject'); setReviewComment(''); }}>
                  <JxIcon name="x" size={13} />Rechazar
                </button>
                <button className="btn btn-green btn-sm" disabled={busy}
                        onClick={() => { setReviewing(req); setReviewMode('approve'); setReviewComment(''); }}>
                  <JxIcon name="check" size={13} />Aprobar
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        // ── MIS SOLICITUDES: tabla ─────────────────────
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Fecha</th>
                <th>Tabla</th>
                <th>Registro</th>
                <th>Cambios</th>
                <th>Motivo</th>
                <th>Estado</th>
                <th>Comentario admin</th>
                <th style={{ textAlign: 'center' }}>Acciones</th>
              </tr></thead>
              <tbody>
                {requests.map(req => {
                  const st = STATUS_BADGE[req.status] || STATUS_BADGE.pendiente;
                  return (
                    <tr key={req.id}>
                      <td className="col-m">{fmtDate(req.created_at)}</td>
                      <td><span className="tag">{TABLE_LABELS[req.target_table] || req.target_table}</span></td>
                      <td className="col-p">{req.target_record_label || '—'}</td>
                      <td><ChangeDiff changes={req.proposed_changes} /></td>
                      <td style={{ fontSize: 12, maxWidth: 220 }}>{req.reason}</td>
                      <td><span className={`badge ${st.class}`}>{st.label}</span></td>
                      <td style={{ fontSize: 11.5, color: 'var(--ts)', maxWidth: 200 }}>{req.reviewer_comment || '—'}</td>
                      <td style={{ textAlign: 'center' }}>
                        {req.status === 'pendiente' && req.requester_id === myId && (
                          <button className="btn btn-ghost btn-xs" disabled={busy} title="Cancelar solicitud" onClick={() => handleCancel(req)}>
                            <JxIcon name="x" size={11} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de revisión (admin) */}
      {reviewing && reviewMode && (
        <Modal
          title={reviewMode === 'approve' ? 'Aprobar solicitud' : 'Rechazar solicitud'}
          icon={reviewMode === 'approve' ? 'checkCircle' : 'alertCircle'}
          onClose={() => { setReviewing(null); setReviewMode(null); setReviewComment(''); }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--tm)', marginBottom: 4 }}>Registro:</div>
            <div style={{ fontSize: 13, color: 'var(--tp)', fontWeight: 600 }}>
              {TABLE_LABELS[reviewing.target_table] || reviewing.target_table} · {reviewing.target_record_label || reviewing.target_record_id}
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--tm)', marginBottom: 4 }}>Cambios propuestos:</div>
            <ChangeDiff changes={reviewing.proposed_changes} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--tm)', marginBottom: 4 }}>Motivo del solicitante:</div>
            <div style={{ fontSize: 12.5, color: 'var(--ts)' }}>{reviewing.reason}</div>
          </div>

          <div>
            <label className="flabel">
              {reviewMode === 'approve' ? 'Comentario (opcional)' : 'Motivo del rechazo *'}
            </label>
            <textarea className="fi" rows={3}
                      placeholder={reviewMode === 'approve' ? 'Notas adicionales…' : 'Explica al solicitante por qué se rechaza…'}
                      value={reviewComment}
                      onChange={e => setReviewComment(e.target.value)} />
          </div>

          <div className="modal-actions">
            <button className="btn btn-ghost" disabled={busy}
                    onClick={() => { setReviewing(null); setReviewMode(null); setReviewComment(''); }}>
              Cancelar
            </button>
            {reviewMode === 'approve' ? (
              <button className="btn btn-green" disabled={busy} onClick={handleApprove}>
                <JxIcon name="check" size={13} />{busy ? 'Aplicando…' : 'Aprobar y aplicar'}
              </button>
            ) : (
              <button className="btn btn-red" disabled={busy} onClick={handleReject}>
                <JxIcon name="x" size={13} />{busy ? 'Rechazando…' : 'Confirmar rechazo'}
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── RequestChangeModal — modal compartido para "Solicitar Cambio" ───
// Recibe: { table, record, fields: [{key, label, type?, options?}], onClose, showToast }
// Se usa desde Materiales / Herramientas / Personal / Proveedores.
function RequestChangeModal({ table, record, recordLabel, fields, onClose, showToast }) {
  const [field, setField] = uSS(fields[0]?.key || '');
  const [newValue, setNewValue] = uSS('');
  const [reason, setReason] = uSS('');
  const [busy, setBusy] = uSS(false);

  const fieldDef = fields.find(f => f.key === field) || fields[0];
  const oldValue = record?.[field];

  const handleSubmit = async () => {
    if (!field) { showToast('Selecciona un campo', 'red'); return; }
    if (newValue === '' || newValue === null || newValue === undefined) {
      showToast('Indica el valor propuesto', 'red'); return;
    }
    if (!reason || reason.trim().length < 10) {
      showToast('El motivo debe tener al menos 10 caracteres', 'red'); return;
    }
    setBusy(true);
    try {
      let parsedNew = newValue;
      if (fieldDef?.type === 'number') parsedNew = parseFloat(newValue);

      await window.__changeRequests.create({
        table,
        recordId: record.id,
        recordLabel: recordLabel || record.id,
        proposedChanges: { [field]: { old: oldValue ?? null, new: parsedNew } },
        reason: reason.trim(),
      });
      showToast('Solicitud enviada al admin', 'green');
      onClose();
    } catch (e) {
      showToast('Error: ' + (e?.message || e), 'red');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Solicitar Cambio" icon="alert" onClose={onClose}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--tm)', marginBottom: 4 }}>Registro:</div>
        <div style={{ fontSize: 13, color: 'var(--tp)', fontWeight: 600 }}>{recordLabel || record?.id}</div>
      </div>

      <div className="g2">
        <div>
          <label className="flabel">Campo a modificar *</label>
          <select className="fi" value={field} onChange={e => { setField(e.target.value); setNewValue(''); }}>
            {fields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </div>
        <div>
          <label className="flabel">Valor actual</label>
          <input className="fi" disabled value={oldValue == null ? '—' : String(oldValue)} />
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <label className="flabel">Valor propuesto *</label>
          {fieldDef?.options ? (
            <select className="fi" value={newValue} onChange={e => setNewValue(e.target.value)}>
              <option value="">— Selecciona —</option>
              {fieldDef.options.map(o => (
                <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
              ))}
            </select>
          ) : (
            <input
              className="fi"
              type={fieldDef?.type === 'number' ? 'number' : 'text'}
              step={fieldDef?.type === 'number' ? '0.01' : undefined}
              placeholder="Nuevo valor"
              value={newValue}
              onChange={e => setNewValue(e.target.value)}
            />
          )}
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <label className="flabel">Motivo * (mín. 10 caracteres)</label>
          <textarea className="fi" rows={3} placeholder="Explica por qué este registro debe cambiar…"
                    value={reason} onChange={e => setReason(e.target.value)} />
        </div>
      </div>

      <div className="modal-actions">
        <button className="btn btn-ghost" disabled={busy} onClick={onClose}>Cancelar</button>
        <button className="btn btn-amber" disabled={busy} onClick={handleSubmit}>
          <JxIcon name="check" size={13} />{busy ? 'Enviando…' : 'Enviar Solicitud'}
        </button>
      </div>
    </Modal>
  );
}

Object.assign(window, { SolicitudesPage, RequestChangeModal });
