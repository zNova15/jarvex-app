import React from "react";
const { useState: uS, useMemo: uM, useEffect: uE } = React;

const RESULTADO_COLOR = {
  conforme: 'var(--green)',
  observaciones: 'var(--amber)',
  no_conforme: 'var(--red)',
};

const TIPOS_INSPECCION = [
  { v: 'general', l: 'General' },
  { v: 'epp', l: 'EPP' },
  { v: 'andamios', l: 'Andamios' },
  { v: 'herramientas', l: 'Herramientas' },
  { v: 'area_trabajo', l: 'Área de trabajo' },
  { v: 'otra', l: 'Otra' },
];

const RESULTADOS = [
  { v: 'conforme', l: 'Conforme' },
  { v: 'observaciones', l: 'Con observaciones' },
  { v: 'no_conforme', l: 'No conforme' },
];

const TIPOS_CAPACITACION = [
  { v: 'induccion', l: 'Inducción' },
  { v: 'dia_dia', l: 'Día a día' },
  { v: 'reentrenamiento', l: 'Reentrenamiento' },
  { v: 'primeros_auxilios', l: 'Primeros auxilios' },
  { v: 'trabajo_altura', l: 'Trabajo en altura' },
  { v: 'espacio_confinado', l: 'Espacio confinado' },
  { v: 'manejo_carga', l: 'Manejo de carga' },
  { v: 'otra', l: 'Otra' },
];

const labelTipoCap = (v) => (TIPOS_CAPACITACION.find(t => t.v === v) || {}).l || v || '—';
const labelTipoInsp = (v) => (TIPOS_INSPECCION.find(t => t.v === v) || {}).l || v || '—';
const labelResultado = (v) => (RESULTADOS.find(r => r.v === v) || {}).l || v || '—';

function useObraActiva() {
  const [obraId, setObraId] = uS(null);
  uE(() => {
    let cancelled = false;
    let attempts = 0;
    const find = async () => {
      attempts++;
      const obras = await window.__db.obras.toArray();
      const stored = window.__getObraActivaId?.();
      const a = (stored && obras.find(o => o.id === stored && !o.deleted_at)) || obras.find(o => !o.deleted_at);
      if (a) { if (!cancelled) setObraId(a.id); return; }
      if (cancelled || attempts >= 10) return;
      setTimeout(find, 500);
    };
    find();
    const onChange = () => { attempts = 0; find(); };
    window.addEventListener('jarvex_master_updated', onChange);
    window.addEventListener('obra_activa_change', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('jarvex_master_updated', onChange);
      window.removeEventListener('obra_activa_change', onChange);
    };
  }, []);
  return obraId;
}

// ╔════════════════════════════════════════════════════════════╗
// ║  INSPECCIONES DE SEGURIDAD                                 ║
// ╚════════════════════════════════════════════════════════════╝
function InspeccionesSeguridadPage({ showToast }) {
  const obraId = useObraActiva();
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id ?? 'offline';
  const isAdmin = auth?.profile?.rol === 'admin';
  const { data: inspecciones } = window.__hooks.useInspeccionesSeguridad(obraId);
  const { data: personal } = window.__hooks.usePersonal(obraId);

  const [modal, setModal] = uS(null);
  const [editing, setEditing] = uS(null);
  const [form, setForm] = uS({});
  const [filtroTipo, setFiltroTipo] = uS('');
  const [filtroResultado, setFiltroResultado] = uS('');

  const filtradas = uM(() => {
    let arr = [...(inspecciones || [])];
    if (filtroTipo) arr = arr.filter(i => i.tipo === filtroTipo);
    if (filtroResultado) arr = arr.filter(i => i.resultado === filtroResultado);
    return arr.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  }, [inspecciones, filtroTipo, filtroResultado]);

  const lookupP = (id) => personal?.find(p => p.id === id);

  const openNueva = () => {
    setForm({
      fecha: new Date().toISOString().slice(0, 10),
      tipo: 'general',
      inspector_id: '',
      area_inspeccionada: '',
      resultado: 'conforme',
      hallazgos: '',
      acciones_correctivas: '',
      fecha_cierre: '',
      responsable_cierre_id: '',
      observaciones: '',
    });
    setEditing(null);
    setModal(true);
  };

  const verEditar = (i) => { setForm({ ...i }); setEditing(i); setModal(true); };

  const guardar = async () => {
    if (!form.fecha) { showToast('Fecha requerida', 'red'); return; }
    if (!form.tipo) { showToast('Tipo requerido', 'red'); return; }
    const now = new Date().toISOString();
    try {
      const data = {
        fecha: form.fecha,
        tipo: form.tipo,
        inspector_id: form.inspector_id || null,
        area_inspeccionada: form.area_inspeccionada || null,
        resultado: form.resultado || 'conforme',
        hallazgos: form.hallazgos || null,
        acciones_correctivas: form.acciones_correctivas || null,
        fecha_cierre: form.fecha_cierre || null,
        responsable_cierre_id: form.responsable_cierre_id || null,
        observaciones: form.observaciones || null,
      };
      if (editing) {
        await window.__db.inspecciones_seguridad.update(editing.id, {
          ...data,
          updated_at: now, updated_by: userId,
          version: (editing.version ?? 0) + 1,
          sync_status: editing.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
      } else {
        const id = window.__newId();
        await window.__db.inspecciones_seguridad.add({
          id, obra_id: obraId,
          ...data,
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_insp_${id}`,
        });
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'inspecciones_seguridad' } })); } catch {}
      try { window.dispatchEvent(new Event('online')); } catch {}
      showToast(editing ? 'Inspección actualizada' : 'Inspección registrada', 'green');
      setModal(null); setEditing(null);
    } catch (e) { showToast('Error: ' + e.message, 'red'); }
  };

  const eliminar = async (i) => {
    if (!isAdmin) return;
    if (!confirm('¿Eliminar esta inspección?')) return;
    try {
      await window.__db.inspecciones_seguridad.update(i.id, {
        deleted_at: new Date().toISOString(),
        sync_status: i.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'inspecciones_seguridad' } })); } catch {}
      try { window.dispatchEvent(new Event('online')); } catch {}
    } catch (e) { showToast('Error: ' + e.message, 'red'); }
  };

  if (!obraId) return <div className="page-wrap"><div className="empty-state"><JxIcon name="alert" size={32} color="var(--tm)"/><p>Selecciona una obra activa.</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Inspecciones de Seguridad</div>
          <div className="pg-sub">{filtradas.length} de {(inspecciones || []).length} inspecciones</div>
        </div>
        <button className="btn btn-amber btn-sm" onClick={openNueva}>
          <JxIcon name="plus" size={13}/>Nueva Inspección
        </button>
      </div>

      <div className="card card-p" style={{ marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ minWidth: 160 }}>
          <label className="flabel">Tipo</label>
          <select className="fi" value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}>
            <option value="">Todos</option>
            {TIPOS_INSPECCION.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 180 }}>
          <label className="flabel">Resultado</label>
          <select className="fi" value={filtroResultado} onChange={e => setFiltroResultado(e.target.value)}>
            <option value="">Todos</option>
            {RESULTADOS.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
          </select>
        </div>
        {(filtroTipo || filtroResultado) && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setFiltroTipo(''); setFiltroResultado(''); }}>Limpiar</button>
        )}
      </div>

      {filtradas.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="alert" size={40} color="var(--tm)"/>
          <p>No hay inspecciones registradas. Las inspecciones periódicas son clave para prevenir incidentes.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Inspector</th>
                <th>Área</th>
                <th>Resultado</th>
                <th>Hallazgos</th>
                <th>Cierre</th>
                <th style={{ textAlign: 'center' }}>Acciones</th>
              </tr></thead>
              <tbody>
                {filtradas.map(i => {
                  const insp = lookupP(i.inspector_id);
                  return (
                    <tr key={i.id}>
                      <td className="col-m">{i.fecha}</td>
                      <td><span className="tag">{labelTipoInsp(i.tipo)}</span></td>
                      <td>{insp ? `${insp.nombres} ${insp.apellidos}` : '—'}</td>
                      <td className="col-p">{i.area_inspeccionada || '—'}</td>
                      <td>
                        <span style={{ color: RESULTADO_COLOR[i.resultado], fontWeight: 700, textTransform: 'uppercase', fontSize: 11 }}>
                          {labelResultado(i.resultado)}
                        </span>
                      </td>
                      <td style={{ fontSize: 11.5, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.hallazgos || '—'}</td>
                      <td className="col-m">{i.fecha_cierre || '—'}</td>
                      <td style={{ textAlign: 'center' }}>
                        <button className="btn btn-ghost btn-xs" onClick={() => verEditar(i)}><JxIcon name="edit" size={11}/></button>
                        {isAdmin && <button className="btn btn-red btn-xs" onClick={() => eliminar(i)} style={{ marginLeft: 4 }}><JxIcon name="trash" size={11}/></button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal && (
        <Modal title={editing ? 'Editar Inspección' : 'Nueva Inspección de Seguridad'} icon="alert" onClose={() => { setModal(null); setEditing(null); }} wide>
          <div className="g2">
            <div><label className="flabel">Fecha *</label><input className="fi" type="date" value={form.fecha || ''} onChange={e => setForm({ ...form, fecha: e.target.value })}/></div>
            <div>
              <label className="flabel">Tipo *</label>
              <select className="fi" value={form.tipo || 'general'} onChange={e => setForm({ ...form, tipo: e.target.value })}>
                {TIPOS_INSPECCION.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
            </div>
            <div>
              <label className="flabel">Inspector</label>
              <select className="fi" value={form.inspector_id || ''} onChange={e => setForm({ ...form, inspector_id: e.target.value })}>
                <option value="">— Selecciona —</option>
                {(personal || []).map(p => <option key={p.id} value={p.id}>{p.nombres} {p.apellidos}</option>)}
              </select>
            </div>
            <div>
              <label className="flabel">Resultado</label>
              <select className="fi" value={form.resultado || 'conforme'} onChange={e => setForm({ ...form, resultado: e.target.value })}>
                {RESULTADOS.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <label className="flabel">Área inspeccionada</label>
              <input className="fi" value={form.area_inspeccionada || ''} onChange={e => setForm({ ...form, area_inspeccionada: e.target.value })} placeholder="Ej: Sector A — torre 2"/>
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <label className="flabel">Hallazgos</label>
              <textarea className="fi" rows={3} value={form.hallazgos || ''} onChange={e => setForm({ ...form, hallazgos: e.target.value })}/>
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <label className="flabel">Acciones correctivas</label>
              <textarea className="fi" rows={3} value={form.acciones_correctivas || ''} onChange={e => setForm({ ...form, acciones_correctivas: e.target.value })}/>
            </div>
            <div><label className="flabel">Fecha de cierre</label><input className="fi" type="date" value={form.fecha_cierre || ''} onChange={e => setForm({ ...form, fecha_cierre: e.target.value })}/></div>
            <div>
              <label className="flabel">Responsable del cierre</label>
              <select className="fi" value={form.responsable_cierre_id || ''} onChange={e => setForm({ ...form, responsable_cierre_id: e.target.value })}>
                <option value="">— Selecciona —</option>
                {(personal || []).map(p => <option key={p.id} value={p.id}>{p.nombres} {p.apellidos}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <label className="flabel">Observaciones</label>
              <textarea className="fi" rows={2} value={form.observaciones || ''} onChange={e => setForm({ ...form, observaciones: e.target.value })}/>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => { setModal(null); setEditing(null); }}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardar}><JxIcon name="check" size={13}/>{editing ? 'Guardar' : 'Registrar'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ╔════════════════════════════════════════════════════════════╗
// ║  CAPACITACIONES                                            ║
// ╚════════════════════════════════════════════════════════════╝
function CapacitacionesPage({ showToast }) {
  const obraId = useObraActiva();
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id ?? 'offline';
  const isAdmin = auth?.profile?.rol === 'admin';
  const { data: capacitaciones } = window.__hooks.useCapacitaciones(obraId);

  const [modal, setModal] = uS(null);
  const [editing, setEditing] = uS(null);
  const [form, setForm] = uS({});
  const [filtroTipo, setFiltroTipo] = uS('');

  const filtradas = uM(() => {
    let arr = [...(capacitaciones || [])];
    if (filtroTipo) arr = arr.filter(c => c.tipo === filtroTipo);
    return arr.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  }, [capacitaciones, filtroTipo]);

  const openNueva = () => {
    setForm({
      fecha: new Date().toISOString().slice(0, 10),
      tema: '',
      tipo: 'induccion',
      duracion_horas: 1,
      expositor: '',
      total_asistentes: 0,
      contenido: '',
      evaluacion: false,
      observaciones: '',
    });
    setEditing(null);
    setModal(true);
  };

  const verEditar = (c) => { setForm({ ...c }); setEditing(c); setModal(true); };

  const guardar = async () => {
    if (!form.tema?.trim()) { showToast('Tema requerido', 'red'); return; }
    if (!form.fecha) { showToast('Fecha requerida', 'red'); return; }
    const now = new Date().toISOString();
    try {
      const data = {
        fecha: form.fecha,
        tema: form.tema,
        tipo: form.tipo || 'induccion',
        duracion_horas: form.duracion_horas !== '' && form.duracion_horas != null ? Number(parseFloat(form.duracion_horas).toFixed(1)) : null,
        expositor: form.expositor || null,
        total_asistentes: parseInt(form.total_asistentes) || 0,
        contenido: form.contenido || null,
        evaluacion: !!form.evaluacion,
        observaciones: form.observaciones || null,
      };
      if (editing) {
        await window.__db.capacitaciones.update(editing.id, {
          ...data,
          updated_at: now, updated_by: userId,
          version: (editing.version ?? 0) + 1,
          sync_status: editing.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
      } else {
        const id = window.__newId();
        await window.__db.capacitaciones.add({
          id, obra_id: obraId,
          ...data,
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_cap_${id}`,
        });
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'capacitaciones' } })); } catch {}
      try { window.dispatchEvent(new Event('online')); } catch {}
      showToast(editing ? 'Capacitación actualizada' : `Capacitación "${form.tema}" registrada`, 'green');
      setModal(null); setEditing(null);
    } catch (e) { showToast('Error: ' + e.message, 'red'); }
  };

  const eliminar = async (c) => {
    if (!isAdmin) return;
    if (!confirm(`¿Eliminar capacitación "${c.tema}"?`)) return;
    try {
      await window.__db.capacitaciones.update(c.id, {
        deleted_at: new Date().toISOString(),
        sync_status: c.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'capacitaciones' } })); } catch {}
      try { window.dispatchEvent(new Event('online')); } catch {}
    } catch (e) { showToast('Error: ' + e.message, 'red'); }
  };

  if (!obraId) return <div className="page-wrap"><div className="empty-state"><JxIcon name="alert" size={32} color="var(--tm)"/><p>Selecciona una obra activa.</p></div></div>;

  const totalHoras = filtradas.reduce((s, c) => s + (Number(c.duracion_horas) || 0), 0);

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Capacitaciones</div>
          <div className="pg-sub">{filtradas.length} capacitaciones · {totalHoras.toFixed(1)} h dictadas</div>
        </div>
        <button className="btn btn-amber btn-sm" onClick={openNueva}>
          <JxIcon name="plus" size={13}/>Nueva Capacitación
        </button>
      </div>

      <div className="card card-p" style={{ marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ minWidth: 200 }}>
          <label className="flabel">Tipo</label>
          <select className="fi" value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}>
            <option value="">Todos</option>
            {TIPOS_CAPACITACION.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
        </div>
        {filtroTipo && (
          <button className="btn btn-ghost btn-sm" onClick={() => setFiltroTipo('')}>Limpiar</button>
        )}
      </div>

      {filtradas.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="alert" size={40} color="var(--tm)"/>
          <p>No hay capacitaciones registradas. Capacita al personal para reducir incidentes y elevar la calidad de obra.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Fecha</th>
                <th>Tema</th>
                <th>Tipo</th>
                <th>Expositor</th>
                <th style={{ textAlign: 'right' }}>Duración</th>
                <th style={{ textAlign: 'right' }}>Asistentes</th>
                <th style={{ textAlign: 'center' }}>Evaluación</th>
                <th style={{ textAlign: 'center' }}>Acciones</th>
              </tr></thead>
              <tbody>
                {filtradas.map(c => (
                  <tr key={c.id}>
                    <td className="col-m">{c.fecha}</td>
                    <td className="col-p"><strong>{c.tema}</strong></td>
                    <td><span className="tag">{labelTipoCap(c.tipo)}</span></td>
                    <td>{c.expositor || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{c.duracion_horas != null ? `${Number(c.duracion_horas).toFixed(1)} h` : '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--green)' }}>{c.total_asistentes || 0}</td>
                    <td style={{ textAlign: 'center' }}>{c.evaluacion ? <span style={{ color: 'var(--green)' }}>Sí</span> : <span style={{ color: 'var(--tm)' }}>No</span>}</td>
                    <td style={{ textAlign: 'center' }}>
                      <button className="btn btn-ghost btn-xs" onClick={() => verEditar(c)}><JxIcon name="edit" size={11}/></button>
                      {isAdmin && <button className="btn btn-red btn-xs" onClick={() => eliminar(c)} style={{ marginLeft: 4 }}><JxIcon name="trash" size={11}/></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal && (
        <Modal title={editing ? 'Editar Capacitación' : 'Nueva Capacitación'} icon="alert" onClose={() => { setModal(null); setEditing(null); }} wide>
          <div className="g2">
            <div><label className="flabel">Fecha *</label><input className="fi" type="date" value={form.fecha || ''} onChange={e => setForm({ ...form, fecha: e.target.value })}/></div>
            <div>
              <label className="flabel">Tipo *</label>
              <select className="fi" value={form.tipo || 'induccion'} onChange={e => setForm({ ...form, tipo: e.target.value })}>
                {TIPOS_CAPACITACION.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <label className="flabel">Tema *</label>
              <input className="fi" value={form.tema || ''} onChange={e => setForm({ ...form, tema: e.target.value })} placeholder="Ej: Trabajo seguro en altura"/>
            </div>
            <div>
              <label className="flabel">Duración (horas)</label>
              <input className="fi" type="number" step="0.1" min="0" value={form.duracion_horas ?? ''} onChange={e => setForm({ ...form, duracion_horas: e.target.value })}/>
            </div>
            <div>
              <label className="flabel">Expositor</label>
              <input className="fi" value={form.expositor || ''} onChange={e => setForm({ ...form, expositor: e.target.value })}/>
            </div>
            <div>
              <label className="flabel">Total asistentes</label>
              <input className="fi" type="number" min="0" value={form.total_asistentes ?? 0} onChange={e => setForm({ ...form, total_asistentes: e.target.value })}/>
            </div>
            <div>
              <label className="flabel">¿Tuvo evaluación?</label>
              <select className="fi" value={form.evaluacion ? '1' : '0'} onChange={e => setForm({ ...form, evaluacion: e.target.value === '1' })}>
                <option value="0">No</option>
                <option value="1">Sí</option>
              </select>
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <label className="flabel">Contenido / temario</label>
              <textarea className="fi" rows={3} value={form.contenido || ''} onChange={e => setForm({ ...form, contenido: e.target.value })}/>
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <label className="flabel">Observaciones</label>
              <textarea className="fi" rows={2} value={form.observaciones || ''} onChange={e => setForm({ ...form, observaciones: e.target.value })}/>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => { setModal(null); setEditing(null); }}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardar}><JxIcon name="check" size={13}/>{editing ? 'Guardar' : 'Registrar'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { InspeccionesSeguridadPage, CapacitacionesPage });
