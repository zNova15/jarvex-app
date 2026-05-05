import React from "react";
import { CATALOGO_EPP, epppTipo, epppVidaTexto, sumarDiasISO } from "../lib/epp-utils.js";
const { useState: uS, useMemo: uM, useEffect: uE } = React;

const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const RIESGO_COLOR = {
  trivial:'var(--green)', tolerable:'var(--green)', moderado:'var(--amber)',
  importante:'var(--orange)', intolerable:'var(--red)',
};
const TIPOS_EPP = ['Casco','Chaleco reflectivo','Guantes','Botas de seguridad','Lentes','Mascarilla','Arnés','Auriculares','Tapones','Otro'];

// Catálogo y helpers de EPP viven en src/lib/epp-utils.js (testeables, reusables).

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

  const [proveedoresDB, setProveedoresDB] = uS([]);
  uE(() => {
    const cargar = () => window.__db?.proveedores?.toArray()
      .then(d => setProveedoresDB((d || []).filter(x => !x.deleted_at)))
      .catch(()=>{});
    cargar();
    const onCh = () => cargar();
    window.addEventListener('jx_data_changed', onCh);
    return () => window.removeEventListener('jx_data_changed', onCh);
  }, []);

  // Tab: 'entregas' (a trabajadores) | 'entradas' (compras a proveedor)
  const [tab, setTab] = uS('entregas');
  const [modal, setModal] = uS(null); // 'entrega' | 'entrada' | null
  const [form, setForm] = uS(null);
  const [detalleOpen, setDetalleOpen] = uS(null);

  const lookupP = (id) => personal?.find(p => p.id === id);
  const lookupProv = (id) => proveedoresDB.find(p => p.id === id);

  // ── Separar entregas vs entradas ────────────────────────────
  // Las "entradas" son registros con tipo_movimiento='entrada' o personal_id=null.
  // Las "entregas" son las clásicas con personal_id.
  const entregasFiltradas = uM(() => {
    return (entregas || []).filter(e =>
      !e.deleted_at &&
      e.tipo_movimiento !== 'entrada' &&
      !!e.personal_id
    ).sort((a,b) => (b.fecha||'').localeCompare(a.fecha||''));
  }, [entregas]);

  const entradasFiltradas = uM(() => {
    return (entregas || []).filter(e =>
      !e.deleted_at &&
      (e.tipo_movimiento === 'entrada' || (!e.personal_id && e.proveedor_id))
    ).sort((a,b) => (b.fecha||'').localeCompare(a.fecha||''));
  }, [entregas]);

  // Compatibilidad: una entrega puede ser un solo tipo (campos planos) o
  // un grupo con `items: [{tipo_epp, cantidad, marca, costo_unitario}]`.
  const entregaItems = (e) => {
    if (Array.isArray(e?.items) && e.items.length) return e.items;
    if (e?.tipo_epp) return [{ tipo_epp: e.tipo_epp, cantidad: e.cantidad, marca: e.marca, costo_unitario: e.costo_unitario, costo_total: e.costo_total }];
    return [];
  };
  const entregaTotalCosto = (e) => {
    const its = entregaItems(e);
    return its.reduce((s, it) => s + Number(it.costo_total || (Number(it.cantidad||0) * Number(it.costo_unitario||0))), 0);
  };
  const entregaTotalCant = (e) => entregaItems(e).reduce((s, it) => s + Number(it.cantidad||0), 0);

  // ── Stock por tipo ──────────────────────────────────────────
  // Stock = total entradas - total entregas (suma cantidades).
  const stockPorTipo = uM(() => {
    const map = {}; // tipo → { entradas, entregas, stock }
    CATALOGO_EPP.forEach(c => { map[c.tipo] = { entradas: 0, entregas: 0, stock: 0 }; });
    (entregas || []).forEach(e => {
      if (e.deleted_at) return;
      const its = entregaItems(e);
      const esEntrada = e.tipo_movimiento === 'entrada' || (!e.personal_id && e.proveedor_id);
      its.forEach(it => {
        const t = it.tipo_epp;
        if (!map[t]) map[t] = { entradas: 0, entregas: 0, stock: 0 };
        const c = Number(it.cantidad || 0);
        if (esEntrada) map[t].entradas += c;
        else map[t].entregas += c;
        map[t].stock = map[t].entradas - map[t].entregas;
      });
    });
    return map;
  }, [entregas]);

  // ── Próximos vencimientos por trabajador ────────────────────
  // Para cada entrega, calcula fecha de vencimiento (entrega + vida_util_dias)
  // y agrupa los que vencen en los próximos 7 días o ya vencieron.
  const proximosVencimientos = uM(() => {
    const hoy = new Date().toISOString().slice(0, 10);
    const en7d = new Date(Date.now() + 7*86400000).toISOString().slice(0, 10);
    const list = [];
    entregasFiltradas.forEach(e => {
      const its = entregaItems(e);
      its.forEach(it => {
        const meta = epppTipo(it.tipo_epp);
        if (!meta?.vida_util_dias) return;
        const venceISO = sumarDiasISO(e.fecha, meta.vida_util_dias);
        if (!venceISO) return;
        if (venceISO <= en7d) {
          list.push({
            personal_id: e.personal_id,
            tipo_epp: it.tipo_epp,
            fecha_entrega: e.fecha,
            fecha_vence: venceISO,
            vencido: venceISO < hoy,
          });
        }
      });
    });
    return list.sort((a, b) => a.fecha_vence.localeCompare(b.fecha_vence));
  }, [entregasFiltradas]);

  // ── Abrir modales ───────────────────────────────────────────
  const openNuevaEntrega = () => {
    setForm({
      fecha: new Date().toISOString().slice(0,10),
      personal_id:'',
      motivo:'inicial',
      observaciones:'',
      items: [{ tipo_epp:'Casco', marca:'', cantidad:1, costo_unitario: epppTipo('Casco')?.costo_ref || '' }],
    });
    setModal('entrega');
  };
  const openNuevaEntrada = () => {
    setForm({
      fecha: new Date().toISOString().slice(0,10),
      proveedor_id:'',
      documento_asociado:'',
      observaciones:'',
      items: [{ tipo_epp:'Casco', marca:'', cantidad:10, costo_unitario: epppTipo('Casco')?.costo_ref || '' }],
    });
    setModal('entrada');
  };

  const updateItem = (idx, patch) => {
    setForm(f => {
      const nuevos = [...(f.items || [])];
      nuevos[idx] = { ...nuevos[idx], ...patch };
      // Auto-rellenar costo de referencia al cambiar tipo
      if (patch.tipo_epp != null) {
        const ref = epppTipo(patch.tipo_epp)?.costo_ref;
        if (ref && !nuevos[idx].costo_unitario) nuevos[idx].costo_unitario = ref;
      }
      return { ...f, items: nuevos };
    });
  };
  const addItem = () => setForm(f => ({ ...f, items: [...(f.items || []), { tipo_epp:'Casco', marca:'', cantidad:1, costo_unitario: epppTipo('Casco')?.costo_ref || '' }] }));
  const removeItem = (idx) => setForm(f => {
    const arr = (f.items || []).filter((_, i) => i !== idx);
    return { ...f, items: arr.length ? arr : [{ tipo_epp:'Casco', marca:'', cantidad:1, costo_unitario:'' }] };
  });

  const totalForm = uM(() => {
    if (!form?.items) return 0;
    return form.items.reduce((s, it) => s + (Number(it.cantidad)||0) * (Number(it.costo_unitario)||0), 0);
  }, [form?.items]);

  // ── Guardar ─────────────────────────────────────────────────
  const guardar = async () => {
    if (!form) return;
    if (modal === 'entrega' && !form.personal_id) {
      showToast('Seleccioná el trabajador', 'red'); return;
    }
    const items = (form.items || []).filter(it => it.tipo_epp && Number(it.cantidad) > 0);
    if (items.length === 0) {
      showToast('Agregá al menos un EPP con cantidad', 'red'); return;
    }
    const totalCant = items.reduce((s,it)=>s+Number(it.cantidad),0);
    const totalCosto = +items.reduce((s,it)=>s+(Number(it.cantidad)||0)*(Number(it.costo_unitario)||0),0).toFixed(2);

    // Validación stock: en entrega, no podés entregar más de lo que hay en stock
    if (modal === 'entrega') {
      for (const it of items) {
        const stockActual = stockPorTipo[it.tipo_epp]?.stock || 0;
        if (Number(it.cantidad) > stockActual) {
          if (!isAdmin && !confirm(`Stock insuficiente de ${it.tipo_epp} (hay ${stockActual}, pedís ${it.cantidad}). ¿Registrar igual?`)) return;
        }
      }
    }

    const now = new Date().toISOString();
    try {
      const id = window.__newId();
      const isEntrada = modal === 'entrada';
      const itemsNorm = items.map(it => ({
        tipo_epp: it.tipo_epp,
        marca: it.marca || null,
        cantidad: Number(it.cantidad),
        costo_unitario: Number(it.costo_unitario) || 0,
        costo_total: +(Number(it.cantidad) * (Number(it.costo_unitario)||0)).toFixed(2),
        // Guardamos la vida útil aplicada al momento de la entrega para
        // tener trazabilidad si después cambia el catálogo.
        vida_util_dias: epppTipo(it.tipo_epp)?.vida_util_dias ?? null,
      }));

      await window.__db.epp_entregas.add({
        id, obra_id: obraId,
        tipo_movimiento: isEntrada ? 'entrada' : 'entrega',
        personal_id: isEntrada ? null : form.personal_id,
        proveedor_id: isEntrada ? (form.proveedor_id || null) : null,
        fecha: form.fecha,
        // Campos legacy para retrocompat con vistas antiguas:
        tipo_epp: itemsNorm.length === 1 ? itemsNorm[0].tipo_epp : null,
        marca:    itemsNorm.length === 1 ? itemsNorm[0].marca : null,
        cantidad: totalCant,
        costo_unitario: itemsNorm.length === 1 ? itemsNorm[0].costo_unitario : null,
        costo_total: totalCosto,
        // Items individuales (nuevo modelo):
        items: itemsNorm,
        motivo: isEntrada ? 'compra' : (form.motivo || 'inicial'),
        documento_asociado: isEntrada ? (form.documento_asociado || null) : null,
        observaciones: form.observaciones || null,
        created_by: userId, updated_by: userId,
        created_at: now, updated_at: now,
        version: 1, sync_status: 'pending_create', last_synced_at: null,
        idempotency_key: `${userId}_epp_${id}`,
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'epp_entregas' } })); } catch {}
      showToast(isEntrada
        ? `Entrada de ${totalCant} EPP registrada (${fmtS(totalCosto)})`
        : `Entrega de ${totalCant} EPP a trabajador (${fmtS(totalCosto)})`, 'green');
      setModal(null); setForm(null);
    } catch (e) { showToast('Error: '+e.message, 'red'); }
  };

  if (!obraId) return <div className="page-wrap"><div className="empty-state"><p>Selecciona una obra.</p></div></div>;

  // Costo total
  const costoEntregas = entregasFiltradas.reduce((s,e)=>s+entregaTotalCosto(e),0);
  const costoEntradas = entradasFiltradas.reduce((s,e)=>s+entregaTotalCosto(e),0);
  const stockTotal = Object.values(stockPorTipo).reduce((s, x) => s + Math.max(0, x.stock), 0);

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Equipos de Protección Personal (EPP)</div>
          <div className="pg-sub">
            {entradasFiltradas.length} compras · {entregasFiltradas.length} entregas · stock {stockTotal} unid · costo entradas {fmtS(costoEntradas)}
          </div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-ghost btn-sm" onClick={openNuevaEntrada}>
            <JxIcon name="arrowIn" size={13}/> Nueva Compra
          </button>
          <button className="btn btn-amber btn-sm" onClick={openNuevaEntrega}>
            <JxIcon name="plus" size={13}/> Nueva Entrega
          </button>
        </div>
      </div>

      {/* Resumen stock por tipo */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(160px, 1fr))', gap:8, marginBottom:14 }}>
        {CATALOGO_EPP.filter(c => c.tipo !== 'Otro').map(c => {
          const s = stockPorTipo[c.tipo] || { stock: 0, entradas: 0, entregas: 0 };
          const sinStock = s.stock <= 0;
          const bajo = s.stock > 0 && s.stock < 5;
          return (
            <div key={c.tipo} className="card card-p" style={{ padding:'10px 12px' }}>
              <div style={{ fontSize:11, color:'var(--tm)' }}>{c.tipo}</div>
              <div style={{ fontSize:18, fontWeight:700, color: sinStock ? 'var(--red)' : bajo ? 'var(--amber)' : 'var(--green)', marginTop:2 }}>
                {s.stock} <span style={{ fontSize:10, color:'var(--tm)', fontWeight:400 }}>en stock</span>
              </div>
              <div style={{ fontSize:10, color:'var(--tm)', marginTop:2 }}>
                Vida útil: {epppVidaTexto(c.vida_util_dias)} · ref. {fmtS(c.costo_ref)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Alertas de vencimiento próximo */}
      {proximosVencimientos.length > 0 && (
        <div className="card card-p" style={{ marginBottom:14, background:'rgba(242,183,5,0.07)', border:'1px solid rgba(242,183,5,0.3)' }}>
          <div style={{ fontSize:12, fontWeight:700, color:'var(--amber)', marginBottom:6, display:'flex', alignItems:'center', gap:6 }}>
            <JxIcon name="alert" size={13} color="var(--amber)"/>
            Reposiciones a programar ({proximosVencimientos.length})
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6, fontSize:11 }}>
            {proximosVencimientos.slice(0, 12).map((v, i) => {
              const p = lookupP(v.personal_id);
              return (
                <span key={i} style={{ padding:'4px 8px', borderRadius:6, background: v.vencido ? 'rgba(231,76,60,0.15)' : 'rgba(242,183,5,0.12)', border:`1px solid ${v.vencido ? 'rgba(231,76,60,0.3)' : 'rgba(242,183,5,0.25)'}`, color: v.vencido ? 'var(--red)' : 'var(--amber)' }}>
                  {v.tipo_epp} · {p ? `${p.nombres} ${p.apellidos}`.slice(0, 22) : '?'} · {v.vencido ? 'vencido' : `vence ${v.fecha_vence}`}
                </span>
              );
            })}
            {proximosVencimientos.length > 12 && <span style={{ color:'var(--tm)' }}>+{proximosVencimientos.length - 12} más</span>}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display:'flex', gap:6, marginBottom:14, borderBottom:'1px solid var(--border)' }}>
        <button onClick={()=>setTab('entregas')}
          className={tab === 'entregas' ? 'btn btn-amber btn-sm' : 'btn btn-ghost btn-sm'}
          style={{ borderRadius:'6px 6px 0 0' }}>
          Entregas a trabajadores ({entregasFiltradas.length})
        </button>
        <button onClick={()=>setTab('entradas')}
          className={tab === 'entradas' ? 'btn btn-amber btn-sm' : 'btn btn-ghost btn-sm'}
          style={{ borderRadius:'6px 6px 0 0' }}>
          Compras / Entradas ({entradasFiltradas.length})
        </button>
      </div>

      {/* Tabla */}
      {tab === 'entregas' ? (
        entregasFiltradas.length === 0 ? (
          <div className="card card-p empty-state"><p>Sin entregas de EPP a trabajadores.</p></div>
        ) : (
          <div className="card" style={{ overflow:'hidden' }}>
            <table className="tbl">
              <thead><tr>
                <th>Fecha</th><th>Trabajador</th><th>EPP entregados</th>
                <th>Motivo</th>
                <th style={{ textAlign:'right' }}>Cant</th>
                <th style={{ textAlign:'right' }}>Costo total</th>
                <th>Próximo cambio</th>
              </tr></thead>
              <tbody>
                {entregasFiltradas.map(e => {
                  const p = lookupP(e.personal_id);
                  const its = entregaItems(e);
                  // Próximo cambio = el item con vida_util más corta
                  const proximos = its.map(it => {
                    const dias = it.vida_util_dias ?? epppTipo(it.tipo_epp)?.vida_util_dias;
                    return dias ? sumarDiasISO(e.fecha, dias) : null;
                  }).filter(Boolean).sort();
                  const proxFecha = proximos[0] || null;
                  const hoy = new Date().toISOString().slice(0,10);
                  const vencido = proxFecha && proxFecha < hoy;
                  return (
                    <tr key={e.id} onClick={()=>setDetalleOpen(e)} style={{ cursor:'pointer' }}>
                      <td className="col-m">{e.fecha}</td>
                      <td className="col-p">{p ? `${p.nombres} ${p.apellidos}` : '—'}</td>
                      <td>
                        {its.slice(0, 3).map((it, i) => (
                          <span key={i} className="tag" style={{ marginRight:4, marginBottom:2, display:'inline-block' }}>
                            {it.tipo_epp} ×{it.cantidad}
                          </span>
                        ))}
                        {its.length > 3 && <span style={{ fontSize:10, color:'var(--tm)' }}>+{its.length - 3}</span>}
                      </td>
                      <td><span className="tag">{e.motivo}</span></td>
                      <td style={{ textAlign:'right' }}>{entregaTotalCant(e)}</td>
                      <td style={{ textAlign:'right' }}>{fmtS(entregaTotalCosto(e))}</td>
                      <td style={{ fontSize:11, color: vencido ? 'var(--red)' : 'var(--ts)' }}>
                        {proxFecha ? (vencido ? `⚠ ${proxFecha} (vencido)` : proxFecha) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        entradasFiltradas.length === 0 ? (
          <div className="card card-p empty-state">
            <p>Sin compras de EPP. Empezá registrando la primera compra al proveedor.</p>
          </div>
        ) : (
          <div className="card" style={{ overflow:'hidden' }}>
            <table className="tbl">
              <thead><tr>
                <th>Fecha</th><th>Proveedor</th><th>EPP comprados</th>
                <th>Documento</th>
                <th style={{ textAlign:'right' }}>Cant</th>
                <th style={{ textAlign:'right' }}>Costo total</th>
              </tr></thead>
              <tbody>
                {entradasFiltradas.map(e => {
                  const prov = e.proveedor_id ? lookupProv(e.proveedor_id) : null;
                  const its = entregaItems(e);
                  return (
                    <tr key={e.id} onClick={()=>setDetalleOpen(e)} style={{ cursor:'pointer' }}>
                      <td className="col-m">{e.fecha}</td>
                      <td className="col-p">{prov?.razon_social || prov?.nombre || '—'}</td>
                      <td>
                        {its.slice(0, 3).map((it, i) => (
                          <span key={i} className="tag" style={{ marginRight:4, marginBottom:2, display:'inline-block' }}>
                            {it.tipo_epp} ×{it.cantidad}
                          </span>
                        ))}
                        {its.length > 3 && <span style={{ fontSize:10, color:'var(--tm)' }}>+{its.length - 3}</span>}
                      </td>
                      <td className="col-m">{e.documento_asociado || '—'}</td>
                      <td style={{ textAlign:'right' }}>{entregaTotalCant(e)}</td>
                      <td style={{ textAlign:'right' }}>{fmtS(entregaTotalCosto(e))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ── MODAL DETALLE ─────────────────────────────────────── */}
      {detalleOpen && (
        <Modal title={`Detalle · ${detalleOpen.fecha}`} icon="check" onClose={()=>setDetalleOpen(null)}>
          <div style={{ fontSize:12, marginBottom:12 }}>
            {detalleOpen.tipo_movimiento === 'entrada' || (!detalleOpen.personal_id && detalleOpen.proveedor_id) ? (
              <>Compra a <strong>{lookupProv(detalleOpen.proveedor_id)?.razon_social || '—'}</strong>{detalleOpen.documento_asociado && ` · doc ${detalleOpen.documento_asociado}`}</>
            ) : (
              <>Entrega a <strong>{(() => { const p = lookupP(detalleOpen.personal_id); return p ? `${p.nombres} ${p.apellidos}` : '—'; })()}</strong> · motivo {detalleOpen.motivo}</>
            )}
          </div>
          <table className="tbl" style={{ fontSize:11.5 }}>
            <thead><tr>
              <th>Tipo</th><th>Marca</th>
              <th style={{ textAlign:'right' }}>Cant</th>
              <th style={{ textAlign:'right' }}>P.Unit</th>
              <th style={{ textAlign:'right' }}>Subtotal</th>
              <th>Vida útil</th>
            </tr></thead>
            <tbody>
              {entregaItems(detalleOpen).map((it, i) => {
                const meta = epppTipo(it.tipo_epp);
                const vida = it.vida_util_dias ?? meta?.vida_util_dias;
                const vence = sumarDiasISO(detalleOpen.fecha, vida);
                return (
                  <tr key={i}>
                    <td>{it.tipo_epp}</td>
                    <td>{it.marca || '—'}</td>
                    <td style={{ textAlign:'right' }}>{it.cantidad}</td>
                    <td style={{ textAlign:'right' }}>{fmtS(it.costo_unitario)}</td>
                    <td style={{ textAlign:'right' }}>{fmtS(it.costo_total || (it.cantidad * it.costo_unitario))}</td>
                    <td style={{ fontSize:10.5, color:'var(--tm)' }}>
                      {vida ? `${epppVidaTexto(vida)}${vence ? ` · vence ${vence}` : ''}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {detalleOpen.observaciones && (
            <div style={{ marginTop:10, fontSize:11, color:'var(--ts)', padding:'8px 10px', background:'rgba(255,255,255,0.025)', border:'1px solid var(--border)', borderRadius:6 }}>
              <strong>Observaciones:</strong> {detalleOpen.observaciones}
            </div>
          )}
        </Modal>
      )}

      {/* ── MODAL NUEVA ENTREGA / ENTRADA ──────────────────────── */}
      {modal && form && (
        <Modal title={modal === 'entrada' ? 'Nueva Compra de EPP' : 'Nueva Entrega de EPP'}
          icon={modal === 'entrada' ? 'arrowIn' : 'check'}
          onClose={()=>{ setModal(null); setForm(null); }}
          wide>
          <div style={{ fontSize:11, color:'var(--tm)', marginBottom:10, padding:'8px 10px', background: modal === 'entrada' ? 'rgba(52,152,219,0.07)' : 'rgba(155,89,182,0.06)', borderRadius:6 }}>
            {modal === 'entrada'
              ? 'Registra los EPPs que entran al almacén comprados al proveedor. El stock se incrementa automáticamente y queda historial de precios por fecha.'
              : 'Registra los EPPs entregados a un trabajador. Podés agregar varios EPPs en una misma entrega. El stock disponible se descuenta. Cada EPP tiene una vida útil estándar — el sistema te avisa cuando toca reponer.'}
          </div>

          <div className="g2" style={{ marginBottom:12 }}>
            <div>
              <label className="flabel">Fecha *</label>
              <input className="fi" type="date" value={form.fecha||''} onChange={e=>setForm({...form, fecha:e.target.value})}/>
            </div>
            {modal === 'entrada' ? (
              <>
                <div>
                  <label className="flabel">Proveedor *</label>
                  <select className="fi" value={form.proveedor_id||''} onChange={e=>setForm({...form, proveedor_id:e.target.value})}>
                    <option value="">— Seleccionar —</option>
                    {proveedoresDB.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.razon_social || p.nombre || '(sin nombre)'}{p.ruc ? ` · ${p.ruc}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ gridColumn:'1/-1' }}>
                  <label className="flabel">Documento (factura/boleta)</label>
                  <input className="fi" placeholder="F001-12345" value={form.documento_asociado||''} onChange={e=>setForm({...form, documento_asociado:e.target.value})}/>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="flabel">Trabajador *</label>
                  <select className="fi" value={form.personal_id||''} onChange={e=>setForm({...form, personal_id:e.target.value})}>
                    <option value="">— Seleccionar —</option>
                    {(personal||[]).filter(p=>p.estado==='activo').map(p => (
                      <option key={p.id} value={p.id}>{p.nombres} {p.apellidos} · {p.dni}</option>
                    ))}
                  </select>
                </div>
                <div style={{ gridColumn:'1/-1' }}>
                  <label className="flabel">Motivo</label>
                  <select className="fi" value={form.motivo||'inicial'} onChange={e=>setForm({...form, motivo:e.target.value})}>
                    <option value="inicial">Entrega inicial</option>
                    <option value="reposicion">Reposición (vida útil cumplida)</option>
                    <option value="cambio">Cambio (deterioro/percance)</option>
                    <option value="perdida">Pérdida</option>
                    <option value="dotacion">Dotación adicional</option>
                  </select>
                </div>
              </>
            )}
          </div>

          {/* ── Tabla de items ──────────────────────────────── */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--amber)', textTransform:'uppercase', letterSpacing:'.05em' }}>
              EPP {modal === 'entrada' ? 'comprados' : 'entregados'} ({form.items?.length || 0})
            </div>
            <button type="button" className="btn btn-ghost btn-xs" onClick={addItem}>
              <JxIcon name="plus" size={10}/> Agregar EPP
            </button>
          </div>
          <div style={{ overflow:'auto', maxHeight:340, border:'1px solid var(--border)', borderRadius:6, marginBottom:10 }}>
            <table className="tbl" style={{ fontSize:11 }}>
              <thead><tr>
                <th>Tipo *</th>
                <th>Marca</th>
                <th style={{ textAlign:'right' }}>Cant *</th>
                <th style={{ textAlign:'right' }}>P.Unit (S/)</th>
                <th style={{ textAlign:'right' }}>Subt</th>
                <th>Vida útil</th>
                {modal === 'entrega' && <th>Stock</th>}
                <th></th>
              </tr></thead>
              <tbody>
                {(form.items || []).map((it, i) => {
                  const meta = epppTipo(it.tipo_epp);
                  const subt = (Number(it.cantidad)||0) * (Number(it.costo_unitario)||0);
                  const stock = stockPorTipo[it.tipo_epp]?.stock || 0;
                  const insuficiente = modal === 'entrega' && Number(it.cantidad) > stock;
                  return (
                    <tr key={i}>
                      <td>
                        <select className="fi" style={{ fontSize:11, padding:'4px 6px' }}
                          value={it.tipo_epp||'Casco'}
                          onChange={e=>updateItem(i, { tipo_epp: e.target.value, costo_unitario: epppTipo(e.target.value)?.costo_ref || it.costo_unitario })}>
                          {CATALOGO_EPP.map(c => <option key={c.tipo} value={c.tipo}>{c.tipo}</option>)}
                        </select>
                      </td>
                      <td>
                        <input className="fi" style={{ fontSize:11, padding:'4px 6px' }}
                          placeholder="3M / Cofra / etc"
                          value={it.marca||''}
                          onChange={e=>updateItem(i, { marca: e.target.value })}/>
                      </td>
                      <td>
                        <input className="fi" style={{ fontSize:11, padding:'4px 6px', width:60, textAlign:'right' }}
                          type="number" min="1" value={it.cantidad||1}
                          onChange={e=>updateItem(i, { cantidad: e.target.value })}/>
                      </td>
                      <td>
                        <input className="fi" style={{ fontSize:11, padding:'4px 6px', width:80, textAlign:'right' }}
                          type="number" step="0.01" min="0" value={it.costo_unitario||''}
                          onChange={e=>updateItem(i, { costo_unitario: e.target.value })}/>
                      </td>
                      <td style={{ textAlign:'right' }}>{fmtS(subt)}</td>
                      <td style={{ fontSize:10.5, color:'var(--tm)' }}>
                        {meta?.vida_util_dias ? epppVidaTexto(meta.vida_util_dias) : '—'}
                      </td>
                      {modal === 'entrega' && (
                        <td style={{ fontSize:11, color: insuficiente ? 'var(--red)' : (stock < 5 ? 'var(--amber)' : 'var(--green)') }}>
                          {stock} {insuficiente && '⚠'}
                        </td>
                      )}
                      <td>
                        <button type="button" className="btn btn-ghost btn-xs"
                          disabled={(form.items || []).length <= 1}
                          onClick={()=>removeItem(i)}>
                          <JxIcon name="x" size={10}/>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight:700 }}>
                  <td colSpan={4} style={{ textAlign:'right', padding:'6px 8px' }}>Total:</td>
                  <td style={{ textAlign:'right', color:'var(--amber)', padding:'6px 8px' }}>{fmtS(totalForm)}</td>
                  <td colSpan={modal === 'entrega' ? 3 : 2}></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div>
            <label className="flabel">Observaciones</label>
            <textarea className="fi" rows={2} value={form.observaciones||''} onChange={e=>setForm({...form, observaciones:e.target.value})}/>
          </div>

          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>{ setModal(null); setForm(null); }}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardar}>
              <JxIcon name="check" size={13}/>
              {modal === 'entrada' ? 'Registrar Compra' : 'Registrar Entrega'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { CharlasSeguridadPage, IpercPage, EppPage });
