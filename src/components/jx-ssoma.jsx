import React from "react";
const { useState: uS, useMemo: uM, useEffect: uE } = React;

const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const RIESGO_COLOR = {
  trivial:'var(--green)', tolerable:'var(--green)', moderado:'var(--amber)',
  importante:'var(--orange)', intolerable:'var(--red)',
};
const TIPOS_EPP = ['Casco','Chaleco reflectivo','Guantes','Botas de seguridad','Lentes','Mascarilla','Arnés','Auriculares','Tapones','Otro'];

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
// ║  CHARLAS DE SEGURIDAD                                     ║
// ╚════════════════════════════════════════════════════════════╝
function CharlasSeguridadPage({ showToast }) {
  const obraId = useObraActiva();
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id ?? 'offline';
  const isAdmin = auth?.profile?.rol === 'admin';
  const { data: charlas } = window.__hooks.useCharlasSeguridad(obraId);
  const { data: personal } = window.__hooks.usePersonal(obraId);

  const [modal, setModal] = uS(null);
  const [editing, setEditing] = uS(null);
  const [form, setForm] = uS({});
  const [asistentes, setAsistentes] = uS(new Set());

  const sorted = uM(() => [...(charlas||[])].sort((a,b) => (b.fecha||'').localeCompare(a.fecha||'')), [charlas]);

  const openNueva = () => {
    setForm({
      fecha: new Date().toISOString().slice(0,10),
      hora: new Date().toTimeString().slice(0,5),
      tema: '',
      duracion_min: 5,
      contenido: '',
      facilitador_id: '',
      observaciones: '',
    });
    setAsistentes(new Set());
    setEditing(null);
    setModal(true);
  };

  const verEditar = async (c) => {
    setForm({ ...c });
    setEditing(c);
    try {
      const ass = await window.__db.charla_asistentes.where('charla_id').equals(c.id).filter(x=>!x.deleted_at).toArray();
      setAsistentes(new Set(ass.map(a => a.personal_id).filter(Boolean)));
    } catch { setAsistentes(new Set()); }
    setModal(true);
  };

  const toggleAsistente = (pid) => {
    const s = new Set(asistentes);
    if (s.has(pid)) s.delete(pid); else s.add(pid);
    setAsistentes(s);
  };

  const guardar = async () => {
    if (!form.tema?.trim()) { showToast('Tema requerido', 'red'); return; }
    if (asistentes.size === 0 && !confirm('No marcaste asistentes. ¿Guardar igual?')) return;
    const now = new Date().toISOString();
    try {
      let charlaId;
      if (editing) {
        charlaId = editing.id;
        await window.__db.charlas_seguridad.update(charlaId, {
          ...form,
          total_asistentes: asistentes.size,
          updated_at: now, updated_by: userId,
          version: (editing.version ?? 0) + 1,
          sync_status: editing.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
        // Borrar asistentes existentes y reinsertar
        const old = await window.__db.charla_asistentes.where('charla_id').equals(charlaId).toArray();
        for (const o of old) {
          await window.__db.charla_asistentes.update(o.id, { deleted_at: now, sync_status: 'pending_delete' });
        }
      } else {
        charlaId = window.__newId();
        const fac = personal?.find(p => p.id === form.facilitador_id);
        await window.__db.charlas_seguridad.add({
          id: charlaId, obra_id: obraId,
          ...form,
          facilitador_nombre: fac ? `${fac.nombres} ${fac.apellidos}` : null,
          duracion_min: parseInt(form.duracion_min)||5,
          total_asistentes: asistentes.size,
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_chs_${charlaId}`,
        });
      }
      // Insertar asistentes
      for (const pid of asistentes) {
        const p = personal?.find(x => x.id === pid);
        const id = window.__newId();
        await window.__db.charla_asistentes.add({
          id, charla_id: charlaId,
          personal_id: pid,
          nombre: p ? `${p.nombres} ${p.apellidos}` : null,
          dni: p?.dni || null,
          firma_url: null,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_cha_${id}`,
        });
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'charlas_seguridad' } })); } catch {}
      try { window.dispatchEvent(new Event('online')); } catch {}
      showToast(editing ? 'Charla actualizada' : `Charla "${form.tema}" registrada con ${asistentes.size} asistentes`, 'green');
      setModal(null); setEditing(null); setAsistentes(new Set());
    } catch (e) { showToast('Error: '+e.message, 'red'); }
  };

  const eliminar = async (c) => {
    if (!isAdmin) return;
    if (!confirm(`¿Eliminar charla "${c.tema}"?`)) return;
    try {
      await window.__db.charlas_seguridad.update(c.id, {
        deleted_at: new Date().toISOString(),
        sync_status: c.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'charlas_seguridad' } })); } catch {}
    } catch (e) { showToast('Error: '+e.message, 'red'); }
  };

  if (!obraId) return <div className="page-wrap"><div className="empty-state"><JxIcon name="alert" size={32} color="var(--tm)"/><p>Selecciona una obra activa.</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Charlas de Seguridad (5 min)</div>
          <div className="pg-sub">{sorted.length} charlas registradas</div>
        </div>
        <button className="btn btn-amber btn-sm" onClick={openNueva}>
          <JxIcon name="plus" size={13}/>Nueva Charla
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="alert" size={40} color="var(--tm)"/>
          <p>No hay charlas. Las charlas de 5 minutos diarias son obligatorias en obra (Ley SST).</p>
        </div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <table className="tbl">
            <thead><tr>
              <th>Fecha</th><th>Hora</th><th>Tema</th><th>Facilitador</th>
              <th style={{ textAlign:'right' }}>Asistentes</th>
              <th style={{ textAlign:'right' }}>Duración</th>
              <th style={{ textAlign:'center' }}>Acciones</th>
            </tr></thead>
            <tbody>
              {sorted.map(c => (
                <tr key={c.id}>
                  <td className="col-m">{c.fecha}</td>
                  <td className="col-m">{c.hora || '—'}</td>
                  <td className="col-p"><strong>{c.tema}</strong></td>
                  <td>{c.facilitador_nombre || '—'}</td>
                  <td style={{ textAlign:'right', fontWeight:700, color:'var(--green)' }}>{c.total_asistentes || 0}</td>
                  <td style={{ textAlign:'right' }}>{c.duracion_min || 5} min</td>
                  <td style={{ textAlign:'center' }}>
                    <button className="btn btn-ghost btn-xs" onClick={()=>verEditar(c)}><JxIcon name="edit" size={11}/></button>
                    {isAdmin && <button className="btn btn-red btn-xs" onClick={()=>eliminar(c)} style={{marginLeft:4}}><JxIcon name="trash" size={11}/></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={editing ? 'Editar Charla' : 'Nueva Charla de Seguridad'} icon="alert" onClose={()=>{setModal(null); setEditing(null); setAsistentes(new Set());}} wide>
          <div className="g2">
            <div><label className="flabel">Fecha *</label><input className="fi" type="date" value={form.fecha||''} onChange={e=>setForm({...form, fecha:e.target.value})}/></div>
            <div><label className="flabel">Hora</label><input className="fi" type="time" value={form.hora||''} onChange={e=>setForm({...form, hora:e.target.value})}/></div>
            <div style={{gridColumn:'1/-1'}}><label className="flabel">Tema *</label><input className="fi" value={form.tema||''} onChange={e=>setForm({...form, tema:e.target.value})} placeholder="Ej: Trabajo en altura"/></div>
            <div><label className="flabel">Facilitador</label>
              <select className="fi" value={form.facilitador_id||''} onChange={e=>setForm({...form, facilitador_id:e.target.value})}>
                <option value="">— Selecciona —</option>
                {(personal||[]).map(p => <option key={p.id} value={p.id}>{p.nombres} {p.apellidos}</option>)}
              </select>
            </div>
            <div><label className="flabel">Duración (min)</label><input className="fi" type="number" min="1" value={form.duracion_min||5} onChange={e=>setForm({...form, duracion_min:e.target.value})}/></div>
            <div style={{gridColumn:'1/-1'}}><label className="flabel">Contenido / temas tratados</label><textarea className="fi" rows={3} value={form.contenido||''} onChange={e=>setForm({...form, contenido:e.target.value})}/></div>
          </div>

          <div style={{ marginTop:14 }}>
            <strong style={{ fontSize:13 }}>Asistentes ({asistentes.size}/{(personal||[]).length})</strong>
            <div style={{ maxHeight:240, overflowY:'auto', border:'1px solid var(--border)', borderRadius:6, marginTop:8, padding:8, display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
              {(personal||[]).filter(p => p.estado === 'activo').map(p => (
                <label key={p.id} style={{ display:'flex', gap:8, alignItems:'center', padding:6, cursor:'pointer', fontSize:11.5, borderRadius:4, background: asistentes.has(p.id) ? 'rgba(46,204,113,0.10)' : 'transparent' }}>
                  <input type="checkbox" checked={asistentes.has(p.id)} onChange={()=>toggleAsistente(p.id)}/>
                  <span><strong>{p.nombres} {p.apellidos}</strong> · {p.cargo || '—'} · {p.dni}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>{setModal(null); setEditing(null); setAsistentes(new Set());}}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardar}><JxIcon name="check" size={13}/>{editing?'Guardar':'Registrar'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ╔════════════════════════════════════════════════════════════╗
// ║  IPERC                                                     ║
// ╚════════════════════════════════════════════════════════════╝
function IpercPage({ showToast }) {
  const obraId = useObraActiva();
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id ?? 'offline';
  const isAdmin = auth?.profile?.rol === 'admin';
  const { data: registros } = window.__hooks.useIperc(obraId);
  const { data: personal } = window.__hooks.usePersonal(obraId);

  const [modal, setModal] = uS(null);
  const [editing, setEditing] = uS(null);
  const [form, setForm] = uS({});

  const clasificar = (prob, sev) => {
    const v = (prob||0) * (sev||0);
    if (v <= 4) return 'trivial';
    if (v <= 8) return 'tolerable';
    if (v <= 12) return 'moderado';
    if (v <= 18) return 'importante';
    return 'intolerable';
  };

  const sorted = uM(() => [...(registros||[])].sort((a,b) => (b.nivel_riesgo||0) - (a.nivel_riesgo||0)), [registros]);

  const openNueva = () => {
    setForm({
      fecha: new Date().toISOString().slice(0,10),
      actividad:'', proceso:'', peligro:'', riesgo:'', consecuencia:'',
      probabilidad:3, severidad:3,
      control_existente:'', control_propuesto:'',
      responsable_id:'', estado:'identificado',
    });
    setEditing(null);
    setModal(true);
  };

  const verEditar = (i) => { setForm({...i}); setEditing(i); setModal(true); };

  const guardar = async () => {
    if (!form.actividad?.trim() || !form.peligro?.trim() || !form.riesgo?.trim()) {
      showToast('Actividad, peligro y riesgo son requeridos', 'red'); return;
    }
    const prob = parseInt(form.probabilidad)||1;
    const sev = parseInt(form.severidad)||1;
    const nivel = prob * sev;
    const cls = clasificar(prob, sev);
    const now = new Date().toISOString();
    try {
      const data = {
        ...form,
        probabilidad: prob, severidad: sev,
        nivel_riesgo: nivel,
        clasificacion: cls,
        responsable_id: form.responsable_id || null,
      };
      if (editing) {
        await window.__db.iperc.update(editing.id, {
          ...data, updated_at: now, updated_by: userId,
          version: (editing.version ?? 0) + 1,
          sync_status: editing.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
      } else {
        const id = window.__newId();
        await window.__db.iperc.add({
          id, obra_id: obraId, ...data,
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_iperc_${id}`,
        });
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'iperc' } })); } catch {}
      showToast(editing ? 'IPERC actualizado' : `Riesgo ${cls.toUpperCase()} registrado`, 'green');
      setModal(null); setEditing(null);
    } catch (e) { showToast('Error: '+e.message, 'red'); }
  };

  const eliminar = async (i) => {
    if (!isAdmin) return;
    if (!confirm('¿Eliminar este registro IPERC?')) return;
    try {
      await window.__db.iperc.update(i.id, {
        deleted_at: new Date().toISOString(),
        sync_status: i.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'iperc' } })); } catch {}
    } catch (e) {}
  };

  if (!obraId) return <div className="page-wrap"><div className="empty-state"><JxIcon name="alert" size={32} color="var(--tm)"/><p>Selecciona una obra activa.</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">IPERC — Matriz de Identificación de Peligros</div>
          <div className="pg-sub">{sorted.length} riesgos identificados · {sorted.filter(r => r.clasificacion==='intolerable' || r.clasificacion==='importante').length} críticos</div>
        </div>
        <button className="btn btn-amber btn-sm" onClick={openNueva}>
          <JxIcon name="plus" size={13}/>Nuevo Riesgo
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="alert" size={40} color="var(--tm)"/>
          <p>No hay registros IPERC. Identifica los peligros de cada actividad de la obra.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <div style={{ overflowX:'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Actividad</th><th>Peligro</th><th>Riesgo</th>
                <th style={{ textAlign:'center' }}>Prob</th>
                <th style={{ textAlign:'center' }}>Sev</th>
                <th style={{ textAlign:'center' }}>Nivel</th>
                <th>Clasificación</th>
                <th>Control propuesto</th>
                <th>Estado</th>
                <th style={{ textAlign:'center' }}>Acciones</th>
              </tr></thead>
              <tbody>
                {sorted.map(r => (
                  <tr key={r.id}>
                    <td className="col-p">{r.actividad}</td>
                    <td>{r.peligro}</td>
                    <td>{r.riesgo}</td>
                    <td style={{ textAlign:'center' }}>{r.probabilidad}</td>
                    <td style={{ textAlign:'center' }}>{r.severidad}</td>
                    <td style={{ textAlign:'center', fontWeight:700, color: RIESGO_COLOR[r.clasificacion] }}>{r.nivel_riesgo}</td>
                    <td><span style={{ color: RIESGO_COLOR[r.clasificacion], fontWeight:600, textTransform:'uppercase', fontSize:11 }}>{r.clasificacion}</span></td>
                    <td style={{ fontSize:11.5 }}>{r.control_propuesto || '—'}</td>
                    <td><span className="tag">{r.estado}</span></td>
                    <td style={{ textAlign:'center' }}>
                      <button className="btn btn-ghost btn-xs" onClick={()=>verEditar(r)}><JxIcon name="edit" size={11}/></button>
                      {isAdmin && <button className="btn btn-red btn-xs" onClick={()=>eliminar(r)} style={{marginLeft:4}}><JxIcon name="trash" size={11}/></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal && (
        <Modal title={editing ? 'Editar IPERC' : 'Nuevo Registro IPERC'} icon="alert" onClose={()=>{setModal(null); setEditing(null);}} wide>
          <div className="g2">
            <div><label className="flabel">Fecha</label><input className="fi" type="date" value={form.fecha||''} onChange={e=>setForm({...form, fecha:e.target.value})}/></div>
            <div><label className="flabel">Estado</label>
              <select className="fi" value={form.estado||'identificado'} onChange={e=>setForm({...form, estado:e.target.value})}>
                <option value="identificado">Identificado</option>
                <option value="en_control">En control</option>
                <option value="controlado">Controlado</option>
                <option value="cerrado">Cerrado</option>
              </select>
            </div>
            <div><label className="flabel">Actividad *</label><input className="fi" value={form.actividad||''} onChange={e=>setForm({...form, actividad:e.target.value})} placeholder="Ej: Excavación de zanjas"/></div>
            <div><label className="flabel">Proceso</label><input className="fi" value={form.proceso||''} onChange={e=>setForm({...form, proceso:e.target.value})}/></div>
            <div style={{gridColumn:'1/-1'}}><label className="flabel">Peligro *</label><input className="fi" value={form.peligro||''} onChange={e=>setForm({...form, peligro:e.target.value})} placeholder="Ej: Derrumbe de talud"/></div>
            <div style={{gridColumn:'1/-1'}}><label className="flabel">Riesgo *</label><input className="fi" value={form.riesgo||''} onChange={e=>setForm({...form, riesgo:e.target.value})} placeholder="Ej: Aplastamiento del personal"/></div>
            <div style={{gridColumn:'1/-1'}}><label className="flabel">Consecuencia</label><input className="fi" value={form.consecuencia||''} onChange={e=>setForm({...form, consecuencia:e.target.value})}/></div>
            <div><label className="flabel">Probabilidad (1-5)</label>
              <select className="fi" value={form.probabilidad||3} onChange={e=>setForm({...form, probabilidad:e.target.value})}>
                <option value="1">1 - Muy improbable</option>
                <option value="2">2 - Improbable</option>
                <option value="3">3 - Posible</option>
                <option value="4">4 - Probable</option>
                <option value="5">5 - Muy probable</option>
              </select>
            </div>
            <div><label className="flabel">Severidad (1-5)</label>
              <select className="fi" value={form.severidad||3} onChange={e=>setForm({...form, severidad:e.target.value})}>
                <option value="1">1 - Insignificante</option>
                <option value="2">2 - Menor</option>
                <option value="3">3 - Moderado</option>
                <option value="4">4 - Mayor</option>
                <option value="5">5 - Catastrófico</option>
              </select>
            </div>
            <div className="card card-p" style={{ gridColumn:'1/-1', textAlign:'center', background:'rgba(0,0,0,0.18)' }}>
              <div style={{ fontSize:11, color:'var(--tm)' }}>Nivel de riesgo (Probabilidad × Severidad)</div>
              <div style={{ fontSize:24, fontWeight:800, color: RIESGO_COLOR[clasificar(parseInt(form.probabilidad)||3, parseInt(form.severidad)||3)] }}>
                {(parseInt(form.probabilidad)||3) * (parseInt(form.severidad)||3)} — {clasificar(parseInt(form.probabilidad)||3, parseInt(form.severidad)||3).toUpperCase()}
              </div>
            </div>
            <div style={{gridColumn:'1/-1'}}><label className="flabel">Control existente</label><textarea className="fi" rows={2} value={form.control_existente||''} onChange={e=>setForm({...form, control_existente:e.target.value})}/></div>
            <div style={{gridColumn:'1/-1'}}><label className="flabel">Control propuesto</label><textarea className="fi" rows={2} value={form.control_propuesto||''} onChange={e=>setForm({...form, control_propuesto:e.target.value})}/></div>
            <div><label className="flabel">Responsable</label>
              <select className="fi" value={form.responsable_id||''} onChange={e=>setForm({...form, responsable_id:e.target.value})}>
                <option value="">—</option>
                {(personal||[]).map(p => <option key={p.id} value={p.id}>{p.nombres} {p.apellidos}</option>)}
              </select>
            </div>
            <div><label className="flabel">Fecha implementación</label><input className="fi" type="date" value={form.fecha_implementacion||''} onChange={e=>setForm({...form, fecha_implementacion:e.target.value})}/></div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>{setModal(null); setEditing(null);}}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardar}><JxIcon name="check" size={13}/>{editing?'Guardar':'Registrar'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ╔════════════════════════════════════════════════════════════╗
// ║  ENTREGAS DE EPP                                          ║
// ╚════════════════════════════════════════════════════════════╝
function EppPage({ showToast }) {
  const obraId = useObraActiva();
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id ?? 'offline';
  const isAdmin = auth?.profile?.rol === 'admin';
  const { data: entregas } = window.__hooks.useEppEntregas(obraId);
  const { data: personal } = window.__hooks.usePersonal(obraId);

  const [modal, setModal] = uS(null);
  const [form, setForm] = uS({});

  const sorted = uM(() => [...(entregas||[])].sort((a,b) => (b.fecha||'').localeCompare(a.fecha||'')), [entregas]);
  const lookupP = (id) => personal?.find(p => p.id === id);

  const openNueva = () => {
    setForm({
      fecha: new Date().toISOString().slice(0,10),
      personal_id:'', tipo_epp:'Casco', marca:'', cantidad:1,
      motivo:'inicial', costo_unitario:'', observaciones:'',
    });
    setModal(true);
  };

  const guardar = async () => {
    if (!form.personal_id || !form.tipo_epp) { showToast('Trabajador y EPP requeridos', 'red'); return; }
    const cant = parseInt(form.cantidad)||1;
    const costo = parseFloat(form.costo_unitario)||0;
    const now = new Date().toISOString();
    try {
      const id = window.__newId();
      await window.__db.epp_entregas.add({
        id, obra_id: obraId,
        personal_id: form.personal_id,
        fecha: form.fecha,
        tipo_epp: form.tipo_epp,
        marca: form.marca || null,
        cantidad: cant,
        motivo: form.motivo,
        costo_unitario: costo,
        costo_total: +(cant * costo).toFixed(2),
        observaciones: form.observaciones || null,
        created_by: userId, updated_by: userId,
        created_at: now, updated_at: now,
        version: 1, sync_status: 'pending_create', last_synced_at: null,
        idempotency_key: `${userId}_epp_${id}`,
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'epp_entregas' } })); } catch {}
      showToast('EPP entregado', 'green');
      setModal(null);
    } catch (e) { showToast('Error: '+e.message, 'red'); }
  };

  if (!obraId) return <div className="page-wrap"><div className="empty-state"><p>Selecciona una obra.</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Entregas de EPP</div>
          <div className="pg-sub">{sorted.length} entregas · costo total {fmtS(sorted.reduce((s,e)=>s+Number(e.costo_total||0),0))}</div>
        </div>
        <button className="btn btn-amber btn-sm" onClick={openNueva}><JxIcon name="plus" size={13}/>Nueva Entrega</button>
      </div>

      {sorted.length === 0 ? (
        <div className="card card-p empty-state"><p>Sin entregas de EPP.</p></div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <table className="tbl">
            <thead><tr>
              <th>Fecha</th><th>Trabajador</th><th>EPP</th><th>Marca</th>
              <th>Motivo</th>
              <th style={{ textAlign:'right' }}>Cantidad</th>
              <th style={{ textAlign:'right' }}>Costo</th>
            </tr></thead>
            <tbody>
              {sorted.map(e => {
                const p = lookupP(e.personal_id);
                return (
                  <tr key={e.id}>
                    <td className="col-m">{e.fecha}</td>
                    <td className="col-p">{p ? `${p.nombres} ${p.apellidos}` : '—'}</td>
                    <td><span className="tag">{e.tipo_epp}</span></td>
                    <td>{e.marca || '—'}</td>
                    <td><span className="tag">{e.motivo}</span></td>
                    <td style={{ textAlign:'right' }}>{e.cantidad}</td>
                    <td style={{ textAlign:'right' }}>{fmtS(e.costo_total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title="Nueva Entrega de EPP" icon="check" onClose={()=>setModal(null)}>
          <div className="g2">
            <div><label className="flabel">Fecha</label><input className="fi" type="date" value={form.fecha||''} onChange={e=>setForm({...form, fecha:e.target.value})}/></div>
            <div><label className="flabel">Trabajador *</label>
              <select className="fi" value={form.personal_id||''} onChange={e=>setForm({...form, personal_id:e.target.value})}>
                <option value="">—</option>
                {(personal||[]).filter(p=>p.estado==='activo').map(p => <option key={p.id} value={p.id}>{p.nombres} {p.apellidos} · {p.dni}</option>)}
              </select>
            </div>
            <div><label className="flabel">Tipo EPP *</label>
              <select className="fi" value={form.tipo_epp||'Casco'} onChange={e=>setForm({...form, tipo_epp:e.target.value})}>
                {TIPOS_EPP.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div><label className="flabel">Marca</label><input className="fi" value={form.marca||''} onChange={e=>setForm({...form, marca:e.target.value})}/></div>
            <div><label className="flabel">Cantidad</label><input className="fi" type="number" min="1" value={form.cantidad||1} onChange={e=>setForm({...form, cantidad:e.target.value})}/></div>
            <div><label className="flabel">Motivo</label>
              <select className="fi" value={form.motivo||'inicial'} onChange={e=>setForm({...form, motivo:e.target.value})}>
                <option value="inicial">Entrega inicial</option>
                <option value="reposicion">Reposición</option>
                <option value="cambio">Cambio (deterioro)</option>
                <option value="perdida">Pérdida</option>
                <option value="dotacion">Dotación adicional</option>
              </select>
            </div>
            <div><label className="flabel">Costo unitario (S/)</label><input className="fi" type="number" step="0.01" value={form.costo_unitario||''} onChange={e=>setForm({...form, costo_unitario:e.target.value})}/></div>
            <div style={{gridColumn:'1/-1'}}><label className="flabel">Observaciones</label><textarea className="fi" rows={2} value={form.observaciones||''} onChange={e=>setForm({...form, observaciones:e.target.value})}/></div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>setModal(null)}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardar}><JxIcon name="check" size={13}/>Registrar Entrega</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { CharlasSeguridadPage, IpercPage, EppPage });
