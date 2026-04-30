import React from "react";
const { useState: uS, useMemo: uM, useEffect: uE } = React;

const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtSk = (n) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1e6) return 'S/ ' + (v/1e6).toFixed(2) + 'M';
  if (Math.abs(v) >= 1e3) return 'S/ ' + (v/1e3).toFixed(0) + 'K';
  return 'S/ ' + v.toFixed(0);
};

const SC_BADGE = {
  borrador:'b-gray', firmado:'b-blue', en_ejecucion:'b-amber',
  suspendido:'b-yellow', liquidado:'b-green', cancelado:'b-red',
};
const SC_LABEL = {
  borrador:'Borrador', firmado:'Firmado', en_ejecucion:'En ejecución',
  suspendido:'Suspendido', liquidado:'Liquidado', cancelado:'Cancelado',
};

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
    return () => { cancelled = true; };
  }, []);
  return obraId;
}

// ╔═══ SUBCONTRATISTAS (catálogo) ════════════════════════════╗
function SubcontratistasPage({ showToast }) {
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id ?? 'offline';
  const isAdmin = auth?.profile?.rol === 'admin';
  const { data: subs } = window.__hooks.useSubcontratistas();

  const [modal, setModal] = uS(null);
  const [editing, setEditing] = uS(null);
  const [form, setForm] = uS({});
  const [busy, setBusy] = uS(false);

  const sorted = uM(() => [...(subs||[])].sort((a,b) => (a.razon_social||'').localeCompare(b.razon_social||'')), [subs]);

  const consultarRUC = async () => {
    const ruc = (form.ruc || '').trim();
    if (!/^\d{11}$/.test(ruc)) { showToast('RUC debe ser 11 dígitos', 'red'); return; }
    setBusy(true);
    try {
      const data = await window.__identity.consultarRUC(ruc);
      setForm(prev => ({
        ...prev,
        razon_social: prev.razon_social?.trim() || data.nombre || data.razonSocial || prev.razon_social,
        direccion: prev.direccion?.trim() || data.direccion || prev.direccion,
      }));
      showToast('SUNAT: ' + (data.nombre || 'datos cargados'), 'green');
    } catch (e) { showToast(e.message, 'red'); }
    finally { setBusy(false); }
  };

  const openNueva = () => {
    setForm({ razon_social:'', ruc:'', contacto:'', telefono:'', email:'', direccion:'', especialidad:'', estado:'activo' });
    setEditing(null);
    setModal(true);
  };

  const guardar = async () => {
    if (!form.razon_social?.trim()) { showToast('Razón social requerida', 'red'); return; }
    const now = new Date().toISOString();
    try {
      if (editing) {
        await window.__db.subcontratistas.update(editing.id, {
          ...form,
          updated_at: now, updated_by: userId,
          version: (editing.version ?? 0) + 1,
          sync_status: editing.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
      } else {
        const id = window.__newId();
        await window.__db.subcontratistas.add({
          id, ...form,
          ruc: form.ruc?.trim() || null,
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_sub_${id}`,
        });
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'subcontratistas' } })); } catch {}
      showToast(editing ? 'Subcontratista actualizado' : 'Subcontratista creado', 'green');
      setModal(null); setEditing(null);
    } catch (e) { showToast('Error: '+e.message, 'red'); }
  };

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Subcontratistas</div>
          <div className="pg-sub">{sorted.length} registrados</div>
        </div>
        <button className="btn btn-amber btn-sm" onClick={openNueva}><JxIcon name="plus" size={13}/>Nuevo</button>
      </div>

      {sorted.length === 0 ? (
        <div className="card card-p empty-state"><p>No hay subcontratistas.</p></div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <table className="tbl">
            <thead><tr>
              <th>Razón social</th><th>RUC</th><th>Especialidad</th><th>Contacto</th><th>Estado</th>
              <th style={{ textAlign:'center' }}>Acciones</th>
            </tr></thead>
            <tbody>
              {sorted.map(s => (
                <tr key={s.id}>
                  <td className="col-p"><strong>{s.razon_social}</strong></td>
                  <td className="col-m">{s.ruc || '—'}</td>
                  <td>{s.especialidad || '—'}</td>
                  <td>{s.contacto ? `${s.contacto} · ${s.telefono || ''}` : '—'}</td>
                  <td><span className={`badge ${s.estado==='activo'?'b-green':'b-gray'}`}>{s.estado}</span></td>
                  <td style={{ textAlign:'center' }}>
                    <button className="btn btn-ghost btn-xs" onClick={()=>{setForm({...s}); setEditing(s); setModal(true);}}><JxIcon name="edit" size={11}/></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={editing ? 'Editar Subcontratista' : 'Nuevo Subcontratista'} icon="users" onClose={()=>{setModal(null); setEditing(null);}}>
          <div className="g2">
            <div><label className="flabel">RUC</label>
              <div style={{display:'flex', gap:6}}>
                <input className="fi" maxLength={11} value={form.ruc||''} onChange={e=>setForm({...form, ruc:e.target.value.replace(/\D/g,'').slice(0,11)})} style={{flex:1}}/>
                <button className="btn btn-blue btn-sm" disabled={busy || (form.ruc||'').length!==11} onClick={consultarRUC}>SUNAT</button>
              </div>
            </div>
            <div><label className="flabel">Estado</label>
              <select className="fi" value={form.estado||'activo'} onChange={e=>setForm({...form, estado:e.target.value})}>
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
                <option value="bloqueado">Bloqueado</option>
              </select>
            </div>
            <div style={{gridColumn:'1/-1'}}><label className="flabel">Razón social *</label><input className="fi" value={form.razon_social||''} onChange={e=>setForm({...form, razon_social:e.target.value})}/></div>
            <div><label className="flabel">Especialidad</label><input className="fi" value={form.especialidad||''} placeholder="Instalaciones eléctricas" onChange={e=>setForm({...form, especialidad:e.target.value})}/></div>
            <div><label className="flabel">Contacto</label><input className="fi" value={form.contacto||''} onChange={e=>setForm({...form, contacto:e.target.value})}/></div>
            <div><label className="flabel">Teléfono</label><input className="fi" value={form.telefono||''} onChange={e=>setForm({...form, telefono:e.target.value})}/></div>
            <div><label className="flabel">Email</label><input className="fi" value={form.email||''} onChange={e=>setForm({...form, email:e.target.value})}/></div>
            <div style={{gridColumn:'1/-1'}}><label className="flabel">Dirección</label><input className="fi" value={form.direccion||''} onChange={e=>setForm({...form, direccion:e.target.value})}/></div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>{setModal(null); setEditing(null);}}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardar}><JxIcon name="check" size={13}/>{editing?'Guardar':'Crear'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ╔═══ SUBCONTRATOS (contratos por obra) ═════════════════════╗
function SubcontratosPage({ showToast }) {
  const obraId = useObraActiva();
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id ?? 'offline';
  const isAdmin = auth?.profile?.rol === 'admin';
  const { data: contratos } = window.__hooks.useSubcontratos(obraId);
  const { data: subs } = window.__hooks.useSubcontratistas();

  const [modal, setModal] = uS(null);
  const [editing, setEditing] = uS(null);
  const [form, setForm] = uS({});

  const sorted = uM(() => [...(contratos||[])].sort((a,b) => (b.fecha_inicio||'').localeCompare(a.fecha_inicio||'')), [contratos]);
  const lookupSub = (id) => subs?.find(s => s.id === id);

  const nextCodigo = uM(() => {
    const yr = new Date().getFullYear();
    const count = (contratos||[]).filter(c => (c.codigo||'').startsWith(`SC-${yr}`)).length + 1;
    return `SC-${yr}-${String(count).padStart(3,'0')}`;
  }, [contratos]);

  const openNueva = () => {
    if (!(subs||[]).filter(s=>s.estado==='activo').length) { showToast('Crea primero un subcontratista activo', 'red'); return; }
    setForm({
      codigo: nextCodigo,
      subcontratista_id: subs.find(s=>s.estado==='activo')?.id,
      alcance: '',
      fecha_inicio: new Date().toISOString().slice(0,10),
      fecha_fin: '',
      monto_contrato: '',
      moneda: 'PEN',
      retencion_pct: 5,
      detraccion_pct: 12,
      igv_pct: 18,
      estado: 'borrador',
      observaciones: '',
    });
    setEditing(null);
    setModal(true);
  };

  const guardar = async () => {
    const monto = parseFloat(form.monto_contrato);
    if (!Number.isFinite(monto) || monto <= 0) { showToast('Monto inválido', 'red'); return; }
    if (!form.alcance?.trim()) { showToast('Alcance requerido', 'red'); return; }
    const now = new Date().toISOString();
    try {
      const data = {
        ...form,
        monto_contrato: monto,
        retencion_pct: parseFloat(form.retencion_pct)||0,
        detraccion_pct: parseFloat(form.detraccion_pct)||12,
        igv_pct: parseFloat(form.igv_pct)||18,
        saldo_pendiente: monto - (Number(editing?.monto_valorizado || 0)),
      };
      if (editing) {
        await window.__db.subcontratos.update(editing.id, {
          ...data, updated_at: now, updated_by: userId,
          version: (editing.version ?? 0) + 1,
          sync_status: editing.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
      } else {
        const id = window.__newId();
        await window.__db.subcontratos.add({
          id, obra_id: obraId, ...data,
          monto_valorizado: 0, retencion_acumulada: 0,
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_sct_${id}`,
        });
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'subcontratos' } })); } catch {}
      showToast(editing?'Contrato actualizado':`Subcontrato ${form.codigo} creado por ${fmtS(monto)}`, 'green');
      setModal(null); setEditing(null);
    } catch (e) { showToast('Error: '+e.message, 'red'); }
  };

  const eliminar = async (c) => {
    if (!isAdmin) return;
    if (!confirm(`¿Eliminar ${c.codigo}?`)) return;
    try {
      await window.__db.subcontratos.update(c.id, {
        deleted_at: new Date().toISOString(),
        sync_status: c.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'subcontratos' } })); } catch {}
    } catch (e) {}
  };

  if (!obraId) return <div className="page-wrap"><div className="empty-state"><p>Selecciona una obra.</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Subcontratos</div>
          <div className="pg-sub">{sorted.length} contratos · valor total {fmtSk(sorted.reduce((s,c)=>s+Number(c.monto_contrato||0),0))}</div>
        </div>
        <button className="btn btn-amber btn-sm" onClick={openNueva}><JxIcon name="plus" size={13}/>Nuevo Contrato</button>
      </div>

      {sorted.length === 0 ? (
        <div className="card card-p empty-state"><p>No hay subcontratos.</p></div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <table className="tbl">
            <thead><tr>
              <th>Código</th><th>Subcontratista</th><th>Alcance</th>
              <th>Inicio</th><th>Fin</th>
              <th style={{ textAlign:'right' }}>Contrato</th>
              <th style={{ textAlign:'right' }}>Valorizado</th>
              <th>Estado</th>
              <th style={{ textAlign:'center' }}>Acciones</th>
            </tr></thead>
            <tbody>
              {sorted.map(c => {
                const sub = lookupSub(c.subcontratista_id);
                return (
                  <tr key={c.id}>
                    <td className="col-m"><strong>{c.codigo}</strong></td>
                    <td className="col-p">{sub?.razon_social || '—'}</td>
                    <td style={{ fontSize:11.5, maxWidth:280 }}>{c.alcance}</td>
                    <td className="col-m">{c.fecha_inicio || '—'}</td>
                    <td className="col-m">{c.fecha_fin || '—'}</td>
                    <td style={{ textAlign:'right', fontWeight:700, color:'var(--blue)' }}>{fmtS(c.monto_contrato)}</td>
                    <td style={{ textAlign:'right', color:'var(--green)' }}>{fmtS(c.monto_valorizado || 0)}</td>
                    <td><span className={`badge ${SC_BADGE[c.estado]}`}>{SC_LABEL[c.estado]}</span></td>
                    <td style={{ textAlign:'center' }}>
                      <button className="btn btn-ghost btn-xs" onClick={()=>{setForm({...c}); setEditing(c); setModal(true);}}><JxIcon name="edit" size={11}/></button>
                      {isAdmin && <button className="btn btn-red btn-xs" onClick={()=>eliminar(c)} style={{marginLeft:4}}><JxIcon name="trash" size={11}/></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={editing ? `Subcontrato ${form.codigo}` : 'Nuevo Subcontrato'} icon="package" onClose={()=>{setModal(null); setEditing(null);}} wide>
          <div className="g2">
            <div><label className="flabel">Código</label><input className="fi" value={form.codigo||''} onChange={e=>setForm({...form, codigo:e.target.value})}/></div>
            <div><label className="flabel">Estado</label>
              <select className="fi" value={form.estado||'borrador'} onChange={e=>setForm({...form, estado:e.target.value})}>
                {Object.entries(SC_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div style={{gridColumn:'1/-1'}}><label className="flabel">Subcontratista *</label>
              <select className="fi" value={form.subcontratista_id||''} onChange={e=>setForm({...form, subcontratista_id:e.target.value})}>
                <option value="">—</option>
                {(subs||[]).filter(s=>s.estado==='activo').map(s => <option key={s.id} value={s.id}>{s.razon_social} {s.ruc?`(${s.ruc})`:''}</option>)}
              </select>
            </div>
            <div style={{gridColumn:'1/-1'}}><label className="flabel">Alcance del trabajo *</label><textarea className="fi" rows={3} value={form.alcance||''} onChange={e=>setForm({...form, alcance:e.target.value})} placeholder="Ej: Instalaciones eléctricas del edificio A — incluye tableros, cableado, luminarias, conexión a red"/></div>
            <div><label className="flabel">Fecha inicio</label><input className="fi" type="date" value={form.fecha_inicio||''} onChange={e=>setForm({...form, fecha_inicio:e.target.value})}/></div>
            <div><label className="flabel">Fecha fin</label><input className="fi" type="date" value={form.fecha_fin||''} onChange={e=>setForm({...form, fecha_fin:e.target.value})}/></div>
            <div><label className="flabel">Monto del contrato *</label><input className="fi" type="number" min="0" step="0.01" value={form.monto_contrato||''} onChange={e=>setForm({...form, monto_contrato:e.target.value})}/></div>
            <div><label className="flabel">Moneda</label>
              <select className="fi" value={form.moneda||'PEN'} onChange={e=>setForm({...form, moneda:e.target.value})}>
                <option value="PEN">S/</option><option value="USD">USD</option>
              </select>
            </div>
            <div><label className="flabel">Retención garantía %</label><input className="fi" type="number" step="0.1" value={form.retencion_pct||5} onChange={e=>setForm({...form, retencion_pct:e.target.value})}/></div>
            <div><label className="flabel">Detracción %</label><input className="fi" type="number" step="0.1" value={form.detraccion_pct||12} onChange={e=>setForm({...form, detraccion_pct:e.target.value})}/></div>
            <div><label className="flabel">Fianza fiel cumplimiento</label><input className="fi" type="number" step="0.01" value={form.fianza_fiel_cumplimiento||''} onChange={e=>setForm({...form, fianza_fiel_cumplimiento:e.target.value})}/></div>
            <div><label className="flabel">Fianza adelanto</label><input className="fi" type="number" step="0.01" value={form.fianza_adelanto||''} onChange={e=>setForm({...form, fianza_adelanto:e.target.value})}/></div>
            <div style={{gridColumn:'1/-1'}}><label className="flabel">Observaciones</label><textarea className="fi" rows={2} value={form.observaciones||''} onChange={e=>setForm({...form, observaciones:e.target.value})}/></div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>{setModal(null); setEditing(null);}}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardar}><JxIcon name="check" size={13}/>{editing?'Guardar':'Crear'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { SubcontratistasPage, SubcontratosPage });
