import React from "react";
const { useState: uS, useMemo: uM, useEffect: uE } = React;

const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtSk = (n) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1e6) return 'S/ ' + (v/1e6).toFixed(2) + 'M';
  if (Math.abs(v) >= 1e3) return 'S/ ' + (v/1e3).toFixed(0) + 'K';
  return 'S/ ' + v.toFixed(0);
};

const AP_TYPES = [
  { v:'excavadora', l:'Excavadora' },
  { v:'retroexcavadora', l:'Retroexcavadora' },
  { v:'volquete', l:'Volquete' },
  { v:'cargador', l:'Cargador frontal' },
  { v:'tractor', l:'Tractor' },
  { v:'motoniveladora', l:'Motoniveladora' },
  { v:'rodillo', l:'Rodillo' },
  { v:'grua', l:'Grúa' },
  { v:'pavimentadora', l:'Pavimentadora' },
  { v:'bulldozer', l:'Bulldozer' },
  { v:'camion', l:'Camión' },
  { v:'otro', l:'Otro' },
];

function ActivosPesadosPage({ showToast }) {
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id ?? 'offline';
  const isAdmin = auth?.profile?.rol === 'admin';
  const { data: activos } = window.__hooks.useActivosPesados();
  const { data: companies } = window.__hooks.useCompanies();
  const { data: obras } = window.__hooks.useObras();
  const { data: hms } = window.__hooks.useHorasMaquina();

  const [modal, setModal] = uS(null);
  const [editing, setEditing] = uS(null);
  const [form, setForm] = uS({});
  const [hmModal, setHmModal] = uS(null); // activo seleccionado para registrar HM/comb/mant

  // KPIs por activo (HM acumuladas, combustible total, mantenim total)
  const [kpisActivo, setKpisActivo] = uS({});
  uE(() => {
    if (!activos) return;
    let cancelled = false;
    (async () => {
      const out = {};
      for (const a of activos) {
        try {
          const hm = await window.__db.horas_maquina.where('activo_id').equals(a.id).filter(x=>!x.deleted_at).toArray();
          const cb = await window.__db.consumos_combustible.where('activo_id').equals(a.id).filter(x=>!x.deleted_at).toArray();
          const mt = await window.__db.mantenimientos_maquinaria.where('activo_id').equals(a.id).filter(x=>!x.deleted_at).toArray();
          const horasTotal = hm.reduce((s,h)=>s+Number(h.horas_trabajadas||0),0);
          const combTotal = cb.reduce((s,c)=>s+Number(c.total||0),0);
          const mantTotal = mt.reduce((s,m)=>s+Number(m.costo_total||0),0);
          out[a.id] = { horasTotal, combTotal, mantTotal,
            costoHora: horasTotal > 0 ? (combTotal+mantTotal)/horasTotal : 0 };
        } catch { out[a.id] = { horasTotal:0, combTotal:0, mantTotal:0, costoHora:0 }; }
      }
      if (!cancelled) setKpisActivo(out);
    })();
    return () => { cancelled = true; };
  }, [activos, hms]);

  const openNuevo = () => {
    setForm({
      codigo:'', nombre:'', tipo:'excavadora', marca:'', modelo:'',
      anio: new Date().getFullYear(), placa:'', serie:'',
      costo_adquisicion: '', vida_util_anios: 5,
      hm_acumuladas: 0, estado: 'operativo',
      company_id: '', obra_actual_id: '',
    });
    setEditing(null);
    setModal('activo');
  };

  const openEditar = (a) => {
    setForm({ ...a });
    setEditing(a);
    setModal('activo');
  };

  const guardar = async () => {
    if (!form.nombre?.trim()) { showToast('Nombre requerido', 'red'); return; }
    const now = new Date().toISOString();
    try {
      if (editing) {
        await window.__db.activos_pesados.update(editing.id, {
          ...form,
          costo_adquisicion: parseFloat(form.costo_adquisicion)||null,
          anio: parseInt(form.anio)||null,
          vida_util_anios: parseInt(form.vida_util_anios)||5,
          hm_acumuladas: parseFloat(form.hm_acumuladas)||0,
          company_id: form.company_id || null,
          obra_actual_id: form.obra_actual_id || null,
          updated_at: now, updated_by: userId,
          version: (editing.version ?? 0) + 1,
          sync_status: editing.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
      } else {
        const id = window.__newId();
        await window.__db.activos_pesados.add({
          id,
          codigo: form.codigo || null,
          nombre: form.nombre.trim(),
          tipo: form.tipo, marca: form.marca || null, modelo: form.modelo || null,
          anio: parseInt(form.anio)||null,
          placa: form.placa || null, serie: form.serie || null,
          costo_adquisicion: parseFloat(form.costo_adquisicion)||null,
          fecha_adquisicion: form.fecha_adquisicion || null,
          vida_util_anios: parseInt(form.vida_util_anios)||5,
          depreciacion_acumulada: 0,
          hm_acumuladas: parseFloat(form.hm_acumuladas)||0,
          hm_proximo_mant: null,
          estado: form.estado || 'operativo',
          company_id: form.company_id || null,
          obra_actual_id: form.obra_actual_id || null,
          notas: form.notas || null,
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_ap_${id}`,
        });
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'activos_pesados' } })); } catch {}
      showToast(editing ? 'Activo actualizado' : 'Activo creado', 'green');
      setModal(null); setEditing(null);
    } catch (e) { showToast('Error: '+e.message, 'red'); }
  };

  const eliminar = async (a) => {
    if (!isAdmin) return;
    if (!confirm(`¿Dar de baja "${a.nombre}"?`)) return;
    try {
      await window.__db.activos_pesados.update(a.id, {
        deleted_at: new Date().toISOString(),
        sync_status: a.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'activos_pesados' } })); } catch {}
    } catch (e) { showToast('Error: '+e.message, 'red'); }
  };

  // Form para registrar HM, combustible, mantenimiento
  const [tipoRegistro, setTipoRegistro] = uS('hm'); // hm | comb | mant
  const [formReg, setFormReg] = uS({});

  const openHm = (a) => {
    setHmModal(a);
    setTipoRegistro('hm');
    setFormReg({
      fecha: new Date().toISOString().slice(0,10),
      horas_trabajadas: '',
      hm_inicial: a.hm_acumuladas,
      hm_final: '',
      operador_id: '',
      obra_id: a.obra_actual_id || '',
      actividad: '',
    });
  };

  const guardarRegistro = async () => {
    const now = new Date().toISOString();
    const id = window.__newId();
    try {
      if (tipoRegistro === 'hm') {
        const horas = parseFloat(formReg.horas_trabajadas) || 0;
        if (horas <= 0) { showToast('Horas inválidas', 'red'); return; }
        await window.__db.horas_maquina.add({
          id, activo_id: hmModal.id,
          obra_id: formReg.obra_id || hmModal.obra_actual_id,
          fecha: formReg.fecha,
          horas_trabajadas: horas,
          hm_inicial: parseFloat(formReg.hm_inicial)||null,
          hm_final: parseFloat(formReg.hm_final)||null,
          operador_id: formReg.operador_id || null,
          actividad: formReg.actividad || null,
          observaciones: formReg.observaciones || null,
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_hm_${id}`,
        });
        // Actualizar hm acumuladas del activo
        await window.__db.activos_pesados.update(hmModal.id, {
          hm_acumuladas: Number(hmModal.hm_acumuladas||0) + horas,
          updated_at: now,
          version: (hmModal.version ?? 0) + 1,
          sync_status: hmModal.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
        try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'horas_maquina' } })); } catch {}
        try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'activos_pesados' } })); } catch {}
        showToast(`+${horas} HM registradas`, 'green');
      } else if (tipoRegistro === 'comb') {
        const galones = parseFloat(formReg.galones) || 0;
        const precio = parseFloat(formReg.precio_galon) || 0;
        if (galones <= 0) { showToast('Galones inválidos', 'red'); return; }
        await window.__db.consumos_combustible.add({
          id, activo_id: hmModal.id,
          obra_id: formReg.obra_id || hmModal.obra_actual_id,
          fecha: formReg.fecha,
          galones, precio_galon: precio,
          total: +(galones * precio).toFixed(2),
          surtidor: formReg.surtidor || null,
          hm_actuales: parseFloat(formReg.hm_actuales)||null,
          observaciones: formReg.observaciones || null,
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_cc_${id}`,
        });
        try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'consumos_combustible' } })); } catch {}
        showToast(`${galones} gal × ${fmtS(precio)} = ${fmtS(galones*precio)} registrados`, 'green');
      } else if (tipoRegistro === 'mant') {
        if (!formReg.descripcion?.trim()) { showToast('Descripción requerida', 'red'); return; }
        const repuestos = parseFloat(formReg.costo_repuestos) || 0;
        const mo = parseFloat(formReg.costo_mano_obra) || 0;
        await window.__db.mantenimientos_maquinaria.add({
          id, activo_id: hmModal.id,
          fecha: formReg.fecha,
          tipo: formReg.tipo_mant || 'preventivo',
          hm_actuales: parseFloat(formReg.hm_actuales)||null,
          descripcion: formReg.descripcion.trim(),
          costo_repuestos: repuestos,
          costo_mano_obra: mo,
          costo_total: +(repuestos + mo).toFixed(2),
          taller: formReg.taller || null,
          mecanico: formReg.mecanico || null,
          duracion_horas: parseFloat(formReg.duracion_horas)||null,
          observaciones: formReg.observaciones || null,
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_mm_${id}`,
        });
        try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'mantenimientos_maquinaria' } })); } catch {}
        showToast('Mantenimiento registrado', 'green');
      }
      setHmModal(null); setFormReg({});
    } catch (e) { showToast('Error: '+e.message, 'red'); }
  };

  const lookupCo = (id) => companies?.find(c => c.id === id);
  const lookupOb = (id) => obras?.find(o => o.id === id);

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Activos Pesados / Maquinaria</div>
          <div className="pg-sub">{(activos||[]).length} equipos · {(activos||[]).filter(a=>a.estado==='operativo').length} operativos</div>
        </div>
        <button className="btn btn-amber btn-sm" onClick={openNuevo}>
          <JxIcon name="plus" size={13}/>Nuevo Equipo
        </button>
      </div>

      {(activos||[]).length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="tool" size={40} color="var(--tm)"/>
          <p>No hay equipos pesados registrados.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <div style={{ overflowX:'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Código</th><th>Equipo</th><th>Tipo</th><th>Placa</th>
                <th>Estado</th><th>Obra actual</th>
                <th style={{ textAlign:'right' }}>HM acum.</th>
                <th style={{ textAlign:'right' }}>Combust.</th>
                <th style={{ textAlign:'right' }}>Mantenim.</th>
                <th style={{ textAlign:'right' }}>Costo/HM</th>
                <th style={{ textAlign:'center' }}>Acciones</th>
              </tr></thead>
              <tbody>
                {(activos||[]).map(a => {
                  const k = kpisActivo[a.id] || {};
                  return (
                    <tr key={a.id}>
                      <td className="col-m" style={{ fontFamily:'monospace' }}>{a.codigo || '—'}</td>
                      <td className="col-p"><strong>{a.nombre}</strong>{a.marca && <div style={{ fontSize:10, color:'var(--tm)' }}>{a.marca} {a.modelo} {a.anio}</div>}</td>
                      <td><span className="tag">{AP_TYPES.find(t=>t.v===a.tipo)?.l || a.tipo}</span></td>
                      <td className="col-m">{a.placa || '—'}</td>
                      <td><span className={`badge ${a.estado==='operativo'?'b-green':a.estado==='mantenimiento'?'b-amber':a.estado==='reparacion'?'b-red':'b-gray'}`}>{a.estado}</span></td>
                      <td>{lookupOb(a.obra_actual_id)?.nombre_obra || '—'}</td>
                      <td style={{ textAlign:'right', fontWeight:600 }}>{(k.horasTotal||0).toFixed(1)}</td>
                      <td style={{ textAlign:'right', color:'var(--orange)' }}>{fmtSk(k.combTotal||0)}</td>
                      <td style={{ textAlign:'right', color:'var(--red)' }}>{fmtSk(k.mantTotal||0)}</td>
                      <td style={{ textAlign:'right', fontWeight:700, color:'var(--blue)' }}>{fmtS(k.costoHora||0)}</td>
                      <td style={{ textAlign:'center', whiteSpace:'nowrap' }}>
                        <button className="btn btn-amber btn-xs" title="Registrar HM / Comb / Mant" onClick={()=>openHm(a)}>
                          <JxIcon name="plus" size={11}/>
                        </button>
                        <button className="btn btn-ghost btn-xs" title="Editar" onClick={()=>openEditar(a)} style={{ marginLeft:4 }}>
                          <JxIcon name="edit" size={11}/>
                        </button>
                        {isAdmin && (
                          <button className="btn btn-red btn-xs" title="Dar de baja" onClick={()=>eliminar(a)} style={{ marginLeft:4 }}>
                            <JxIcon name="trash" size={11}/>
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

      {/* Modal crear/editar activo */}
      {modal === 'activo' && (
        <Modal title={editing ? 'Editar Equipo' : 'Nuevo Equipo Pesado'} icon="tool" onClose={()=>{setModal(null); setEditing(null);}} wide>
          <div className="g2">
            <div><label className="flabel">Código</label><input className="fi" value={form.codigo||''} placeholder="EXC-001" onChange={e=>setForm({...form, codigo:e.target.value})}/></div>
            <div><label className="flabel">Nombre *</label><input className="fi" value={form.nombre||''} placeholder="Excavadora CAT 320" onChange={e=>setForm({...form, nombre:e.target.value})}/></div>
            <div><label className="flabel">Tipo</label>
              <select className="fi" value={form.tipo||'excavadora'} onChange={e=>setForm({...form, tipo:e.target.value})}>
                {AP_TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
            </div>
            <div><label className="flabel">Estado</label>
              <select className="fi" value={form.estado||'operativo'} onChange={e=>setForm({...form, estado:e.target.value})}>
                <option value="operativo">Operativo</option>
                <option value="mantenimiento">Mantenimiento</option>
                <option value="reparacion">Reparación</option>
                <option value="baja">Baja</option>
              </select>
            </div>
            <div><label className="flabel">Marca</label><input className="fi" value={form.marca||''} onChange={e=>setForm({...form, marca:e.target.value})}/></div>
            <div><label className="flabel">Modelo</label><input className="fi" value={form.modelo||''} onChange={e=>setForm({...form, modelo:e.target.value})}/></div>
            <div><label className="flabel">Año</label><input className="fi" type="number" value={form.anio||''} onChange={e=>setForm({...form, anio:e.target.value})}/></div>
            <div><label className="flabel">Placa</label><input className="fi" value={form.placa||''} onChange={e=>setForm({...form, placa:e.target.value})}/></div>
            <div><label className="flabel">N° serie</label><input className="fi" value={form.serie||''} onChange={e=>setForm({...form, serie:e.target.value})}/></div>
            <div><label className="flabel">Costo adquisición (S/)</label><input className="fi" type="number" step="0.01" value={form.costo_adquisicion||''} onChange={e=>setForm({...form, costo_adquisicion:e.target.value})}/></div>
            <div><label className="flabel">Vida útil (años)</label><input className="fi" type="number" value={form.vida_util_anios||5} onChange={e=>setForm({...form, vida_util_anios:e.target.value})}/></div>
            <div><label className="flabel">HM iniciales</label><input className="fi" type="number" step="0.01" value={form.hm_acumuladas||0} onChange={e=>setForm({...form, hm_acumuladas:e.target.value})}/></div>
            <div><label className="flabel">Empresa propietaria</label>
              <select className="fi" value={form.company_id||''} onChange={e=>setForm({...form, company_id:e.target.value})}>
                <option value="">—</option>
                {(companies||[]).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div><label className="flabel">Obra actual</label>
              <select className="fi" value={form.obra_actual_id||''} onChange={e=>setForm({...form, obra_actual_id:e.target.value})}>
                <option value="">— en almacén —</option>
                {(obras||[]).filter(o=>!o.deleted_at).map(o => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}
              </select>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>{setModal(null); setEditing(null);}}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardar}><JxIcon name="check" size={13}/>{editing?'Guardar':'Crear'}</button>
          </div>
        </Modal>
      )}

      {/* Modal registrar HM/Combustible/Mantenimiento */}
      {hmModal && (
        <Modal title={`Registrar — ${hmModal.nombre}`} icon="plus" onClose={()=>{setHmModal(null); setFormReg({});}} wide>
          <div style={{ display:'flex', gap:6, padding:4, background:'var(--bg-s)', borderRadius:8, marginBottom:14, width:'fit-content' }}>
            {[
              { v:'hm', l:'⏱ Horas-máquina' },
              { v:'comb', l:'⛽ Combustible' },
              { v:'mant', l:'🔧 Mantenimiento' },
            ].map(t => (
              <button key={t.v}
                className={`btn btn-sm ${tipoRegistro===t.v?'btn-amber':'btn-ghost'}`}
                onClick={()=>setTipoRegistro(t.v)}
                style={{ border:'none' }}>
                {t.l}
              </button>
            ))}
          </div>

          {tipoRegistro === 'hm' && (
            <div className="g2">
              <div><label className="flabel">Fecha</label><input className="fi" type="date" value={formReg.fecha||''} onChange={e=>setFormReg({...formReg, fecha:e.target.value})}/></div>
              <div><label className="flabel">Horas trabajadas *</label><input className="fi" type="number" min="0" step="0.1" value={formReg.horas_trabajadas||''} onChange={e=>setFormReg({...formReg, horas_trabajadas:e.target.value})}/></div>
              <div><label className="flabel">HM inicial (horómetro)</label><input className="fi" type="number" step="0.1" value={formReg.hm_inicial||''} onChange={e=>setFormReg({...formReg, hm_inicial:e.target.value})}/></div>
              <div><label className="flabel">HM final</label><input className="fi" type="number" step="0.1" value={formReg.hm_final||''} onChange={e=>setFormReg({...formReg, hm_final:e.target.value})}/></div>
              <div style={{ gridColumn:'1/-1' }}><label className="flabel">Actividad</label><input className="fi" value={formReg.actividad||''} placeholder="Ej: Excavación cimientos zona A" onChange={e=>setFormReg({...formReg, actividad:e.target.value})}/></div>
              <div style={{ gridColumn:'1/-1' }}><label className="flabel">Observaciones</label><textarea className="fi" rows={2} value={formReg.observaciones||''} onChange={e=>setFormReg({...formReg, observaciones:e.target.value})}/></div>
            </div>
          )}

          {tipoRegistro === 'comb' && (
            <div className="g2">
              <div><label className="flabel">Fecha</label><input className="fi" type="date" value={formReg.fecha||''} onChange={e=>setFormReg({...formReg, fecha:e.target.value})}/></div>
              <div><label className="flabel">Galones *</label><input className="fi" type="number" min="0" step="0.01" value={formReg.galones||''} onChange={e=>setFormReg({...formReg, galones:e.target.value})}/></div>
              <div><label className="flabel">Precio por galón</label><input className="fi" type="number" min="0" step="0.0001" value={formReg.precio_galon||''} onChange={e=>setFormReg({...formReg, precio_galon:e.target.value})}/></div>
              <div><label className="flabel">Total</label><input className="fi" disabled value={fmtS((parseFloat(formReg.galones)||0)*(parseFloat(formReg.precio_galon)||0))}/></div>
              <div><label className="flabel">HM al cargar</label><input className="fi" type="number" step="0.1" value={formReg.hm_actuales||''} onChange={e=>setFormReg({...formReg, hm_actuales:e.target.value})}/></div>
              <div><label className="flabel">Surtidor / grifo</label><input className="fi" value={formReg.surtidor||''} onChange={e=>setFormReg({...formReg, surtidor:e.target.value})}/></div>
            </div>
          )}

          {tipoRegistro === 'mant' && (
            <div className="g2">
              <div><label className="flabel">Fecha</label><input className="fi" type="date" value={formReg.fecha||''} onChange={e=>setFormReg({...formReg, fecha:e.target.value})}/></div>
              <div><label className="flabel">Tipo</label>
                <select className="fi" value={formReg.tipo_mant||'preventivo'} onChange={e=>setFormReg({...formReg, tipo_mant:e.target.value})}>
                  <option value="preventivo">Preventivo</option>
                  <option value="correctivo">Correctivo</option>
                </select>
              </div>
              <div style={{ gridColumn:'1/-1' }}><label className="flabel">Descripción *</label><input className="fi" value={formReg.descripcion||''} placeholder="Ej: Cambio de aceite + filtros" onChange={e=>setFormReg({...formReg, descripcion:e.target.value})}/></div>
              <div><label className="flabel">Costo repuestos</label><input className="fi" type="number" min="0" step="0.01" value={formReg.costo_repuestos||''} onChange={e=>setFormReg({...formReg, costo_repuestos:e.target.value})}/></div>
              <div><label className="flabel">Costo mano de obra</label><input className="fi" type="number" min="0" step="0.01" value={formReg.costo_mano_obra||''} onChange={e=>setFormReg({...formReg, costo_mano_obra:e.target.value})}/></div>
              <div><label className="flabel">Total</label><input className="fi" disabled value={fmtS((parseFloat(formReg.costo_repuestos)||0)+(parseFloat(formReg.costo_mano_obra)||0))}/></div>
              <div><label className="flabel">Duración (horas)</label><input className="fi" type="number" step="0.1" value={formReg.duracion_horas||''} onChange={e=>setFormReg({...formReg, duracion_horas:e.target.value})}/></div>
              <div><label className="flabel">Taller</label><input className="fi" value={formReg.taller||''} onChange={e=>setFormReg({...formReg, taller:e.target.value})}/></div>
              <div><label className="flabel">Mecánico</label><input className="fi" value={formReg.mecanico||''} onChange={e=>setFormReg({...formReg, mecanico:e.target.value})}/></div>
            </div>
          )}

          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>{setHmModal(null); setFormReg({});}}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardarRegistro}><JxIcon name="check" size={13}/>Registrar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { ActivosPesadosPage });
