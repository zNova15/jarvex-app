import React from "react";
const { useState: uSO, useMemo: uMO, useEffect: uEO } = React;

const EST_PART = { terminado:'b-green', en_ejecucion:'b-blue', atrasado:'b-red', pendiente:'b-gray', observado:'b-yellow' };
const EST_LBL  = { terminado:'Terminado', en_ejecucion:'En Ejecución', atrasado:'Atrasado', pendiente:'Pendiente', observado:'Observado' };

const EST_OBRA = { activo:'b-green', planificacion:'b-blue', pausado:'b-yellow', terminado:'b-gray', cancelado:'b-red' };
const EST_OBRA_LBL = { activo:'Activo', planificacion:'Planificación', pausado:'Pausado', terminado:'Terminado', cancelado:'Cancelado' };

// Helper para detectar obra activa
function useObraActiva() {
  const [obraId, setObraId] = uSO(null);
  uEO(() => {
    let cancelled = false;
    const find = async () => {
      const obras = await window.__db.obras.toArray();
      const a = obras.find(o => !o.deleted_at);
      if (a) { if (!cancelled) setObraId(a.id); }
      else if (!cancelled) setTimeout(find, 500);
    };
    find();
    return () => { cancelled = true; };
  }, []);
  return obraId;
}

// Helper formato moneda
const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtSk = (n) => {
  const v = Number(n || 0);
  if (v >= 1000000) return 'S/ ' + (v/1000000).toFixed(1) + 'M';
  if (v >= 1000)    return 'S/ ' + (v/1000).toFixed(0) + 'K';
  return fmtS(v);
};
const fmtPct = (n) => Number(n || 0).toFixed(1) + '%';

// ─── OBRAS PAGE ───────────────────────────────────────────
function ObrasPage({ showToast }) {
  const { data: obras, loading, create: createObra, update: updateObra } = window.__hooks.useObras();
  const [modal, setModal] = uSO(null);
  const [form, setForm] = uSO({});
  const [editingId, setEditingId] = uSO(null);

  const openEditObra = (o) => {
    setForm({
      nombre_obra: o.nombre_obra || '',
      cliente: o.cliente || '',
      ubicacion: o.ubicacion || '',
      estado: o.estado || 'planificacion',
      fecha_inicio: o.fecha_inicio || '',
      fecha_fin_estimada: o.fecha_fin_estimada || '',
      presupuesto_total: o.presupuesto_total ?? '',
      observaciones: o.observaciones || '',
    });
    setEditingId(o.id);
    setModal('editar');
  };

  const handleSubmit = async () => {
    if (!form.nombre_obra) { showToast('Falta el nombre de la obra', 'red'); return; }
    try {
      if (editingId) {
        const oldObra = obras.find(o => o.id === editingId);
        const newFields = {
          nombre_obra: form.nombre_obra,
          cliente: form.cliente || null,
          ubicacion: form.ubicacion || null,
          estado: form.estado || 'planificacion',
          fecha_inicio: form.fecha_inicio || null,
          fecha_fin_estimada: form.fecha_fin_estimada || null,
          presupuesto_total: parseFloat(form.presupuesto_total) || null,
          observaciones: form.observaciones || null,
        };
        await updateObra(editingId, newFields);
        try { await window.__logAudit?.({ action:'update', table:'obras', recordId:editingId, oldData:oldObra, newData:newFields }); } catch(e) {}
        showToast(`Obra "${form.nombre_obra}" actualizada`, 'green');
      } else {
        const created = await createObra({
          nombre_obra: form.nombre_obra,
          cliente: form.cliente || null,
          ubicacion: form.ubicacion || null,
          estado: form.estado || 'planificacion',
          fecha_inicio: form.fecha_inicio || null,
          fecha_fin_estimada: form.fecha_fin_estimada || null,
          presupuesto_total: parseFloat(form.presupuesto_total) || null,
          observaciones: form.observaciones || null,
          avance_fisico: 0,
          avance_financiero: 0,
          costo_real_acumulado: 0,
        });
        try { await window.__logAudit?.({ action:'insert', table:'obras', recordId:created?.id, newData:created }); } catch(e) {}
        showToast(`Obra "${form.nombre_obra}" creada`, 'green');
      }
      setModal(null); setForm({}); setEditingId(null);
    } catch (e) {
      showToast('Error: ' + e.message, 'red');
    }
  };

  if (loading) return <div className="page-wrap"><div className="empty-state"><JxIcon name="building" size={32} color="var(--tm)"/><p>Cargando obras…</p></div></div>;

  const activas = obras.filter(o => o.estado === 'activo').length;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div><div className="pg-title">Obras / Proyectos</div><div className="pg-sub">{obras.length} proyectos · {activas} activos</div></div>
        <button className="btn btn-amber btn-sm" onClick={()=>{setForm({}); setEditingId(null); setModal('nueva');}}><JxIcon name="plus" size={13}/>Nueva Obra</button>
      </div>

      {obras.length === 0 ? (
        <div className="card card-p empty-state"><JxIcon name="building" size={40} color="var(--tm)"/><p>No hay obras registradas. Click en "Nueva Obra".</p></div>
      ) : (
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
        {obras.map(o => {
          const pres = Number(o.presupuesto_total || 0);
          const real = Number(o.costo_real_acumulado || 0);
          const margen = pres > 0 ? ((pres - real) / pres * 100).toFixed(1) : 0;
          const over = real > pres;
          return (
            <div key={o.id} className="card card-p card-hover">
              <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:12, gap:10}}>
                <div style={{flex:1,paddingRight:12}}>
                  <div style={{fontSize:14,fontWeight:700,color:'var(--tp)',marginBottom:4,lineHeight:1.3}}>{o.nombre_obra}</div>
                  <div style={{fontSize:11.5,color:'var(--tm)',display:'flex',gap:12,flexWrap:'wrap'}}>
                    {o.cliente && <span><JxIcon name="user" size={11}/> {o.cliente}</span>}
                    {o.ubicacion && <span><JxIcon name="map" size={11}/> {o.ubicacion}</span>}
                  </div>
                </div>
                <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:6,flexShrink:0}}>
                  <span className={`badge ${EST_OBRA[o.estado]||'b-gray'}`}>{EST_OBRA_LBL[o.estado] || o.estado}</span>
                  <button className="btn btn-ghost btn-xs" title="Editar obra" onClick={(e)=>{ e.stopPropagation(); openEditObra(o); }}>
                    <JxIcon name="edit" size={11}/>
                  </button>
                </div>
              </div>

              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:14}}>
                <div style={{background:'rgba(0,0,0,0.2)',borderRadius:7,padding:'10px 12px'}}>
                  <div style={{fontSize:10,color:'var(--tm)',fontWeight:500,marginBottom:3}}>PRESUPUESTO</div>
                  <div style={{fontSize:14,fontWeight:700,color:'var(--tp)'}}>{fmtSk(pres)}</div>
                </div>
                <div style={{background:'rgba(0,0,0,0.2)',borderRadius:7,padding:'10px 12px'}}>
                  <div style={{fontSize:10,color:'var(--tm)',fontWeight:500,marginBottom:3}}>COSTO REAL</div>
                  <div style={{fontSize:14,fontWeight:700,color:over?'var(--red)':'var(--tp)'}}>{fmtSk(real)}</div>
                </div>
                <div style={{background:'rgba(0,0,0,0.2)',borderRadius:7,padding:'10px 12px'}}>
                  <div style={{fontSize:10,color:'var(--tm)',fontWeight:500,marginBottom:3}}>MARGEN EST.</div>
                  <div style={{fontSize:14,fontWeight:700,color:over?'var(--red)':'var(--green)'}}>{margen}%</div>
                </div>
              </div>

              <div style={{marginBottom:8}}>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'var(--tm)',marginBottom:5}}>
                  <span>Avance físico</span><span style={{color:'var(--tp)',fontWeight:600}}>{fmtPct(o.avance_fisico)}</span>
                </div>
                <div className="progress-bar"><div className="progress-fill" style={{width:`${o.avance_fisico||0}%`,background:`linear-gradient(90deg,#3498DB,#2ECC71)`}}/></div>
              </div>
              <div>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'var(--tm)',marginBottom:5}}>
                  <span>Avance financiero</span><span style={{color:'var(--tp)',fontWeight:600}}>{fmtPct(o.avance_financiero)}</span>
                </div>
                <div className="progress-bar"><div className="progress-fill" style={{width:`${o.avance_financiero||0}%`,background:`linear-gradient(90deg,#F2B705,#F28C28)`}}/></div>
              </div>

              <div style={{display:'flex',justifyContent:'space-between',marginTop:14,paddingTop:12,borderTop:'1px solid var(--border)',fontSize:11.5,color:'var(--tm)'}}>
                <span>Inicio: {o.fecha_inicio || '—'}</span>
                <span>Fin est.: {o.fecha_fin_estimada || '—'}</span>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {(modal === 'nueva' || modal === 'editar') && <Modal title={editingId ? 'Editar Obra' : 'Nueva Obra'} icon="building" onClose={()=>{setModal(null); setEditingId(null); setForm({});}}>
        <div className="g2">
          <div style={{gridColumn:'1/-1'}}><label className="flabel">Nombre de la obra *</label><input className="fi" placeholder="Ej: Edificio Las Palmas" value={form.nombre_obra||''} onChange={e=>setForm({...form, nombre_obra:e.target.value})}/></div>
          <div><label className="flabel">Cliente</label><input className="fi" placeholder="Razón social" value={form.cliente||''} onChange={e=>setForm({...form, cliente:e.target.value})}/></div>
          <div><label className="flabel">Estado</label>
            <select className="fi" value={form.estado||'planificacion'} onChange={e=>setForm({...form, estado:e.target.value})}>
              <option value="planificacion">Planificación</option><option value="activo">Activo</option>
              <option value="pausado">Pausado</option><option value="finalizada">Finalizada</option>
              <option value="cancelada">Cancelada</option>
            </select>
          </div>
          <div style={{gridColumn:'1/-1'}}><label className="flabel">Ubicación</label><input className="fi" placeholder="Distrito, dirección" value={form.ubicacion||''} onChange={e=>setForm({...form, ubicacion:e.target.value})}/></div>
          <div><label className="flabel">Fecha inicio</label><input className="fi" type="date" value={form.fecha_inicio||''} onChange={e=>setForm({...form, fecha_inicio:e.target.value})}/></div>
          <div><label className="flabel">Fecha fin estimada</label><input className="fi" type="date" value={form.fecha_fin_estimada||''} onChange={e=>setForm({...form, fecha_fin_estimada:e.target.value})}/></div>
          <div style={{gridColumn:'1/-1'}}><label className="flabel">Presupuesto total (S/)</label><input className="fi" type="number" step="0.01" placeholder="0.00" value={form.presupuesto_total||''} onChange={e=>setForm({...form, presupuesto_total:e.target.value})}/></div>
          <div style={{gridColumn:'1/-1'}}><label className="flabel">Observaciones</label><textarea className="fi" value={form.observaciones||''} onChange={e=>setForm({...form, observaciones:e.target.value})}/></div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={()=>{setModal(null); setEditingId(null); setForm({});}}>Cancelar</button>
          <button className="btn btn-amber" onClick={handleSubmit}><JxIcon name="check" size={13}/>{editingId ? 'Guardar Cambios' : 'Crear Obra'}</button>
        </div>
      </Modal>}
    </div>
  );
}

// ─── PARTIDAS PAGE ────────────────────────────────────────
function PartidasPage({ showToast }) {
  const obraId = useObraActiva();
  const { data: partidas, loading, create: createPartida } = window.__hooks.usePartidas(obraId);
  const [q, setQ] = uSO('');
  const [modal, setModal] = uSO(null);
  const [form, setForm] = uSO({});

  const filtered = uMO(() => {
    if (!partidas) return [];
    if (!q) return partidas;
    return partidas.filter(p =>
      p.nombre_partida?.toLowerCase().includes(q.toLowerCase()) ||
      p.codigo_delfin?.toLowerCase().includes(q.toLowerCase()) ||
      p.categoria?.toLowerCase().includes(q.toLowerCase())
    );
  }, [q, partidas]);

  const totalPres = partidas?.reduce((s,p) => s + Number(p.costo_total_presupuestado || 0), 0) ?? 0;
  const totalReal = partidas?.reduce((s,p) => s + Number(p.costo_real_acumulado || 0), 0) ?? 0;

  const stats = uMO(() => ({
    terminadas:  partidas?.filter(p => p.estado === 'terminado').length ?? 0,
    ejecucion:   partidas?.filter(p => p.estado === 'en_ejecucion').length ?? 0,
    atrasadas:   partidas?.filter(p => p.estado === 'atrasado').length ?? 0,
    pendientes:  partidas?.filter(p => p.estado === 'pendiente').length ?? 0,
  }), [partidas]);

  const handleSubmit = async () => {
    if (!form.nombre_partida) { showToast('Falta nombre de partida', 'red'); return; }
    try {
      const cantidad = parseFloat(form.metrado_contratado) || 0;
      const precio = parseFloat(form.precio_unitario_pres) || 0;
      await createPartida({
        obra_id: obraId,
        codigo_delfin: form.codigo_delfin || null,
        nombre_partida: form.nombre_partida,
        categoria: form.categoria || 'General',
        unidad: form.unidad || 'und',
        metrado_contratado: cantidad,
        precio_unitario_pres: precio,
        costo_total_presupuestado: cantidad * precio,
        fecha_inicio_planificada: form.fecha_inicio_planificada || null,
        fecha_fin_planificada: form.fecha_fin_planificada || null,
        estado: 'pendiente',
      });
      showToast(`Partida "${form.nombre_partida}" creada`, 'green');
      setModal(null); setForm({});
    } catch (e) {
      showToast('Error: ' + e.message, 'red');
    }
  };

  if (loading || !obraId) return <div className="page-wrap"><div className="empty-state"><JxIcon name="list" size={32} color="var(--tm)"/><p>Cargando partidas…</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div><div className="pg-title">Partidas de Obra</div><div className="pg-sub">{partidas.length} partidas · {fmtSk(totalReal)} ejecutado de {fmtSk(totalPres)}</div></div>
        <button className="btn btn-amber btn-sm" onClick={()=>{setForm({}); setModal('nueva');}}><JxIcon name="plus" size={13}/>Nueva Partida</button>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
        {[
          {label:'Terminadas',val:stats.terminadas,color:'var(--green)'},
          {label:'En Ejecución',val:stats.ejecucion,color:'var(--blue)'},
          {label:'Atrasadas',val:stats.atrasadas,color:'var(--red)'},
          {label:'Pendientes',val:stats.pendientes,color:'var(--tm)'},
        ].map((s,i)=>(
          <div key={i} className="card card-p"><div style={{fontSize:11,color:'var(--tm)'}}>{s.label}</div><div style={{fontSize:26,fontWeight:800,color:s.color,margin:'4px 0'}}>{s.val}</div></div>
        ))}
      </div>

      <div style={{display:'flex',gap:8,marginBottom:14}}>
        <div className="search-bar"><JxIcon name="search" size={14} color="var(--tm)"/><input placeholder="Buscar partida…" value={q} onChange={e=>setQ(e.target.value)}/></div>
      </div>

      {partidas.length === 0 ? (
        <div className="card card-p empty-state"><JxIcon name="list" size={40} color="var(--tm)"/><p>No hay partidas. Click en "Nueva Partida".</p></div>
      ) : (
      <div className="card" style={{overflow:'hidden'}}>
        <div style={{overflowX:'auto'}}>
          <table className="tbl">
            <thead><tr>
              <th>Cód.</th><th>Partida</th><th>Cat.</th><th>Und.</th>
              <th style={{textAlign:'right'}}>Met. Cont.</th><th style={{textAlign:'right'}}>Met. Ejec.</th>
              <th style={{textAlign:'right'}}>% Av.</th>
              <th style={{textAlign:'right'}}>C. Pres.</th><th style={{textAlign:'right'}}>C. Real</th>
              <th style={{textAlign:'right'}}>Diferencia</th><th>Estado</th>
            </tr></thead>
            <tbody>
              {filtered.map(p => {
                const ctPres = Number(p.costo_total_presupuestado || 0);
                const ctReal = Number(p.costo_real_acumulado || 0);
                const diff = ctReal - ctPres;
                const diffPct = ctPres > 0 ? ((diff / ctPres) * 100).toFixed(1) : 0;
                const av = Number(p.porcentaje_avance || 0);
                return (
                  <tr key={p.id}>
                    <td className="col-m">{p.codigo_delfin || '—'}</td>
                    <td className="col-p">{p.nombre_partida}</td>
                    <td><span className="tag">{p.categoria || '—'}</span></td>
                    <td className="col-m">{p.unidad}</td>
                    <td style={{textAlign:'right'}} className="col-num">{Number(p.metrado_contratado || 0).toLocaleString('es-PE')}</td>
                    <td style={{textAlign:'right'}} className="col-num">{Number(p.metrado_ejecutado || 0).toLocaleString('es-PE')}</td>
                    <td style={{textAlign:'right'}}>
                      <div style={{display:'flex',alignItems:'center',gap:6,justifyContent:'flex-end'}}>
                        <div style={{width:50,height:5,background:'rgba(255,255,255,0.08)',borderRadius:4,overflow:'hidden'}}>
                          <div style={{height:'100%',width:`${av}%`,background:av===100?'var(--green)':p.estado==='atrasado'?'var(--red)':'var(--blue)',borderRadius:4}}/>
                        </div>
                        <span className="col-num" style={{fontSize:12,fontWeight:600,color:av===100?'var(--green)':p.estado==='atrasado'?'var(--red)':'var(--tp)'}}>{av.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td style={{textAlign:'right'}} className="col-num">{fmtS(ctPres)}</td>
                    <td style={{textAlign:'right'}} className="col-num">{fmtS(ctReal)}</td>
                    <td style={{textAlign:'right'}} className="col-num">
                      {ctReal > 0 ? <span style={{color:diff>0?'var(--red)':'var(--green)',fontWeight:600}}>{diff>0?'+':''}{Math.round(diff).toLocaleString()} ({diffPct}%)</span> : <span style={{color:'var(--tm)'}}>—</span>}
                    </td>
                    <td><span className={`badge ${EST_PART[p.estado]||'b-gray'}`}>{EST_LBL[p.estado] || p.estado}</span></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={7} style={{padding:'12px 14px',fontWeight:700,color:'var(--ts)',fontSize:12,background:'rgba(0,0,0,0.15)'}}>TOTALES</td>
                <td style={{textAlign:'right',padding:'12px 14px',fontWeight:700,color:'var(--tp)',background:'rgba(0,0,0,0.15)'}} className="col-num">{fmtS(totalPres)}</td>
                <td style={{textAlign:'right',padding:'12px 14px',fontWeight:700,color:'var(--tp)',background:'rgba(0,0,0,0.15)'}} className="col-num">{fmtS(totalReal)}</td>
                <td style={{textAlign:'right',padding:'12px 14px',fontWeight:700,background:'rgba(0,0,0,0.15)'}} className="col-num">
                  <span style={{color:(totalReal-totalPres)>0?'var(--red)':'var(--green)'}}>{(totalReal-totalPres)>0?'+':''}{Math.round(totalReal-totalPres).toLocaleString()}</span>
                </td>
                <td style={{background:'rgba(0,0,0,0.15)'}}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      )}

      {modal === 'nueva' && <Modal title="Nueva Partida" icon="list" onClose={()=>setModal(null)}>
        <div className="g2">
          <div><label className="flabel">Código</label><input className="fi" placeholder="Ej: 03.01.01" value={form.codigo_delfin||''} onChange={e=>setForm({...form, codigo_delfin:e.target.value})}/></div>
          <div><label className="flabel">Categoría</label>
            <select className="fi" value={form.categoria||''} onChange={e=>setForm({...form, categoria:e.target.value})}>
              <option value="">— Selecciona —</option>
              <option>Movimiento de tierras</option><option>Concreto</option><option>Acero</option>
              <option>Albañilería</option><option>Acabados</option><option>Instalaciones eléctricas</option>
              <option>Instalaciones sanitarias</option><option>Carpintería</option>
            </select>
          </div>
          <div style={{gridColumn:'1/-1'}}><label className="flabel">Nombre de la partida *</label><input className="fi" placeholder="Ej: Concreto en zapatas f'c=210 kg/cm²" value={form.nombre_partida||''} onChange={e=>setForm({...form, nombre_partida:e.target.value})}/></div>
          <div><label className="flabel">Unidad</label>
            <select className="fi" value={form.unidad||''} onChange={e=>setForm({...form, unidad:e.target.value})}>
              <option value="">— Selecciona —</option>
              <option>m³</option><option>m²</option><option>m</option><option>kg</option>
              <option>und</option><option>glb</option>
            </select>
          </div>
          <div><label className="flabel">Metrado contratado</label><input className="fi" type="number" step="0.01" value={form.metrado_contratado||''} onChange={e=>setForm({...form, metrado_contratado:e.target.value})}/></div>
          <div><label className="flabel">Precio unitario pres. (S/)</label><input className="fi" type="number" step="0.01" value={form.precio_unitario_pres||''} onChange={e=>setForm({...form, precio_unitario_pres:e.target.value})}/></div>
          <div><label className="flabel">Costo total (calc.)</label><div className="fi" style={{color:'var(--amber)',fontWeight:600}}>{fmtS((parseFloat(form.metrado_contratado)||0) * (parseFloat(form.precio_unitario_pres)||0))}</div></div>
          <div><label className="flabel">Fecha inicio plan.</label><input className="fi" type="date" value={form.fecha_inicio_planificada||''} onChange={e=>setForm({...form, fecha_inicio_planificada:e.target.value})}/></div>
          <div><label className="flabel">Fecha fin plan.</label><input className="fi" type="date" value={form.fecha_fin_planificada||''} onChange={e=>setForm({...form, fecha_fin_planificada:e.target.value})}/></div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={()=>setModal(null)}>Cancelar</button>
          <button className="btn btn-amber" onClick={handleSubmit}><JxIcon name="check" size={13}/>Crear Partida</button>
        </div>
      </Modal>}
    </div>
  );
}

// ─── CRONOGRAMA / GANTT PAGE ──────────────────────────────
function CronogramaPage() {
  const obraId = useObraActiva();
  const { data: partidas, loading } = window.__hooks.usePartidas(obraId);

  if (loading || !obraId) return <div className="page-wrap"><div className="empty-state"><JxIcon name="gantt" size={32} color="var(--tm)"/><p>Cargando cronograma…</p></div></div>;

  // Calcular rango de semanas a partir de fechas planificadas
  const partidasConFechas = partidas.filter(p => p.fecha_inicio_planificada && p.fecha_fin_planificada);

  if (partidasConFechas.length === 0) {
    return (
      <div className="page-wrap">
        <div className="pg-hd"><div><div className="pg-title">Cronograma / Gantt</div><div className="pg-sub">No hay partidas con fechas planificadas</div></div></div>
        <div className="card card-p empty-state"><JxIcon name="gantt" size={40} color="var(--tm)"/><p>Crea partidas con fecha de inicio y fin planificada para ver el Gantt.</p></div>
      </div>
    );
  }

  const fechaMin = partidasConFechas.reduce((min, p) => p.fecha_inicio_planificada < min ? p.fecha_inicio_planificada : min, partidasConFechas[0].fecha_inicio_planificada);
  const fechaMax = partidasConFechas.reduce((max, p) => p.fecha_fin_planificada > max ? p.fecha_fin_planificada : max, partidasConFechas[0].fecha_fin_planificada);
  const startMs = new Date(fechaMin).getTime();
  const endMs = new Date(fechaMax).getTime();
  const totalDays = Math.ceil((endMs - startMs) / (1000*60*60*24)) + 1;
  const totalWeeks = Math.max(1, Math.ceil(totalDays / 7));
  const todayMs = Date.now();
  const todayWeek = Math.floor((todayMs - startMs) / (1000*60*60*24*7)) + 1;

  const weeks = Array.from({length: totalWeeks}, (_, i) => 'S' + (i+1));
  const cellW = 32, rowH = 38, labelW = 220;

  const COLORS = { terminado:'#2ECC71', en_ejecucion:'#3498DB', atrasado:'#E74C3C', pendiente:'rgba(255,255,255,0.12)', observado:'#F1C40F' };

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div><div className="pg-title">Cronograma / Gantt</div><div className="pg-sub">{partidasConFechas.length} partidas · Semana actual: S{todayWeek > 0 ? todayWeek : 1} de {totalWeeks}</div></div>
        <div style={{display:'flex',gap:8}}>
          <span className="badge b-green">Terminado</span>
          <span className="badge b-blue">En Ejecución</span>
          <span className="badge b-red">Atrasado</span>
          <span className="badge b-gray">Pendiente</span>
        </div>
      </div>

      <div className="card" style={{overflow:'hidden'}}>
        <div style={{overflowX:'auto'}}>
          <div style={{minWidth: labelW + totalWeeks*cellW + 40}}>
            <div style={{display:'flex',borderBottom:'1px solid var(--border)',background:'rgba(0,0,0,0.2)'}}>
              <div style={{width:labelW,minWidth:labelW,padding:'10px 14px',fontSize:10.5,fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',color:'var(--tm)',borderRight:'1px solid var(--border)',flexShrink:0}}>Partida</div>
              <div style={{display:'flex',flex:1}}>
                {weeks.map((w,i)=>(
                  <div key={i} style={{width:cellW,minWidth:cellW,textAlign:'center',fontSize:9.5,color:i+1===todayWeek?'var(--amber)':'var(--tm)',fontWeight:i+1===todayWeek?700:400,padding:'10px 0',background:i+1===todayWeek?'rgba(242,183,5,0.06)':'transparent',borderRight:'1px solid rgba(255,255,255,0.03)'}}>{w}</div>
                ))}
              </div>
            </div>

            {partidasConFechas.map((p, idx) => {
              const inicioMs = new Date(p.fecha_inicio_planificada).getTime();
              const finMs = new Date(p.fecha_fin_planificada).getTime();
              const inicioWeek = Math.max(0, Math.floor((inicioMs - startMs) / (1000*60*60*24*7)));
              const durWeeks = Math.max(1, Math.ceil((finMs - inicioMs) / (1000*60*60*24*7)));
              const avancePct = Number(p.porcentaje_avance || 0) / 100;
              const realWeeks = avancePct > 0 ? durWeeks * avancePct : 0;
              const color = COLORS[p.estado] || COLORS.pendiente;
              return (
                <div key={p.id} style={{display:'flex',alignItems:'center',borderBottom:'1px solid rgba(255,255,255,0.03)',height:rowH,background:idx%2===0?'transparent':'rgba(0,0,0,0.07)'}}>
                  <div style={{width:labelW,minWidth:labelW,padding:'0 14px',borderRight:'1px solid var(--border)',flexShrink:0,overflow:'hidden'}}>
                    <div style={{fontSize:12,fontWeight:500,color:'var(--ts)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',display:'flex',alignItems:'center',gap:6}}>
                      <span style={{fontSize:9,color:'var(--tm)',fontWeight:700,flexShrink:0}}>{p.codigo_delfin || ''}</span>
                      {p.nombre_partida}
                    </div>
                  </div>
                  <div style={{position:'relative',flex:1,height:'100%',display:'flex',alignItems:'center'}}>
                    {todayWeek > 0 && todayWeek <= totalWeeks && <div style={{position:'absolute',left:(todayWeek-1)*cellW,width:cellW,height:'100%',background:'rgba(242,183,5,0.04)',pointerEvents:'none'}}/>}
                    <div style={{position:'absolute',left:inicioWeek*cellW,width:durWeeks*cellW-3,height:14,background:color,borderRadius:4,opacity:0.2}}/>
                    <div style={{position:'absolute',left:inicioWeek*cellW,width:durWeeks*cellW-3,height:14,border:`1px solid ${color}`,borderRadius:4,opacity:0.4}}/>
                    {realWeeks > 0 && <div style={{position:'absolute',left:inicioWeek*cellW,width:realWeeks*cellW-3,height:14,background:color,borderRadius:4,display:'flex',alignItems:'center',paddingLeft:6}}>
                      <span style={{fontSize:8.5,fontWeight:700,color:'rgba(0,0,0,0.7)',whiteSpace:'nowrap'}}>{Math.round(avancePct*100)}%</span>
                    </div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{padding:'12px 16px',borderTop:'1px solid var(--border)',display:'flex',gap:16,fontSize:11.5,color:'var(--tm)',alignItems:'center'}}>
          <span>Leyenda: <strong style={{color:'rgba(255,255,255,0.3)'}}>borde</strong> = planificado · <strong style={{color:'var(--ts)'}}>relleno</strong> = ejecutado real</span>
          <span style={{marginLeft:'auto'}}>Semana actual marcada en <span style={{color:'var(--amber)'}}>ámbar</span></span>
        </div>
      </div>
    </div>
  );
}

// ─── AVANCE DE OBRA PAGE ──────────────────────────────────
function AvancePage({ showToast }) {
  const obraId = useObraActiva();
  const { data: partidas } = window.__hooks.usePartidas(obraId);
  const { data: registros, loading, create: createAvance, refresh } = window.__hooks.useAvanceObra(obraId);
  const { data: obras } = window.__hooks.useObras();
  const obraActiva = obras?.find(o => o.id === obraId);

  const [modal, setModal] = uSO(false);
  const [form, setForm] = uSO({});

  const calcSemana = (fecha) => {
    if (!obraActiva?.fecha_inicio || !fecha) return '';
    const start = new Date(obraActiva.fecha_inicio).getTime();
    const date = new Date(fecha).getTime();
    const week = Math.floor((date - start) / (1000*60*60*24*7)) + 1;
    return 'S' + Math.max(1, week);
  };

  const handleSubmit = async () => {
    if (!form.partida_id || !form.metrado_ejecutado) {
      showToast('Selecciona partida y metrado', 'red');
      return;
    }
    const partida = partidas.find(p => p.id === form.partida_id);
    try {
      await createAvance({
        obra_id: obraId,
        partida_id: form.partida_id,
        fecha: form.fecha,
        semana: calcSemana(form.fecha),
        metrado_ejecutado: parseFloat(form.metrado_ejecutado),
        porcentaje_avance_reportado: parseFloat(form.porcentaje_avance_reportado) || null,
        personal_asignado: parseInt(form.personal_asignado) || null,
        observaciones: form.observaciones || null,
      });
      // Optimistic: actualizar partida local
      const totalEjecutado = registros
        .filter(r => r.partida_id === form.partida_id)
        .reduce((s, r) => s + Number(r.metrado_ejecutado || 0), 0) + parseFloat(form.metrado_ejecutado);
      const nuevoPct = partida.metrado_contratado > 0
        ? Math.min(100, (totalEjecutado / partida.metrado_contratado) * 100)
        : 0;
      await window.__db.partidas.update(form.partida_id, {
        metrado_ejecutado: totalEjecutado,
        porcentaje_avance: nuevoPct,
        estado: nuevoPct >= 100 ? 'terminado' : 'en_ejecucion',
      });
      refresh();
      showToast(`Avance registrado · ${form.metrado_ejecutado} ${partida.unidad}`, 'green');
      setModal(false); setForm({});
    } catch (e) {
      showToast('Error: ' + e.message, 'red');
    }
  };

  const openModal = () => {
    setForm({ fecha: new Date().toISOString().slice(0,10) });
    setModal(true);
  };

  if (loading || !obraId) return <div className="page-wrap"><div className="empty-state"><JxIcon name="hardHat" size={32} color="var(--tm)"/><p>Cargando avance…</p></div></div>;

  // Stats
  const ordenados = [...registros].sort((a,b) => (b.fecha || '').localeCompare(a.fecha || ''));
  const semanaActual = calcSemana(new Date().toISOString().slice(0,10));
  const avSemActual = registros
    .filter(r => r.semana === semanaActual)
    .reduce((s, r) => s + Number(r.metrado_ejecutado || 0), 0);

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div><div className="pg-title">Avance de Obra</div><div className="pg-sub">Registros diarios y semanales · {registros.length} registros</div></div>
        <button className="btn btn-amber btn-sm" onClick={openModal}><JxIcon name="plus" size={13}/>Registrar Avance</button>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14,marginBottom:20}}>
        <div className="card card-p">
          <div style={{fontSize:11,color:'var(--tm)'}}>Avance Físico General</div>
          <div style={{fontSize:26,fontWeight:800,color:'var(--blue)',margin:'6px 0 2px'}}>{fmtPct(obraActiva?.avance_fisico)}</div>
          <div style={{fontSize:11,color:'var(--tm)'}}>{partidas?.length ?? 0} partidas en seguimiento</div>
        </div>
        <div className="card card-p">
          <div style={{fontSize:11,color:'var(--tm)'}}>Esta Semana ({semanaActual})</div>
          <div style={{fontSize:26,fontWeight:800,color:'var(--green)',margin:'6px 0 2px'}}>+{avSemActual.toFixed(1)}</div>
          <div style={{fontSize:11,color:'var(--tm)'}}>unidades ejecutadas</div>
        </div>
        <div className="card card-p">
          <div style={{fontSize:11,color:'var(--tm)'}}>Total Registros</div>
          <div style={{fontSize:26,fontWeight:800,color:'var(--amber)',margin:'6px 0 2px'}}>{registros.length}</div>
          <div style={{fontSize:11,color:'var(--tm)'}}>desde inicio de obra</div>
        </div>
      </div>

      {ordenados.length === 0 ? (
        <div className="card card-p empty-state"><JxIcon name="hardHat" size={40} color="var(--tm)"/><p>Sin registros de avance. Click en "Registrar Avance".</p></div>
      ) : (
      <div className="card" style={{overflow:'hidden'}}>
        <table className="tbl">
          <thead><tr>
            <th>Fecha</th><th>Semana</th><th>Partida Ejecutada</th>
            <th style={{textAlign:'right'}}>Metrado</th><th style={{textAlign:'right'}}>% Reportado</th>
            <th style={{textAlign:'right'}}>Personal</th><th>Observaciones</th><th>Sync</th>
          </tr></thead>
          <tbody>
            {ordenados.map(r => {
              const partida = partidas.find(p => p.id === r.partida_id);
              return (
                <tr key={r.id}>
                  <td className="col-m">{r.fecha}</td>
                  <td><span className="badge b-blue">{r.semana || '—'}</span></td>
                  <td className="col-p">{partida?.nombre_partida || '(partida eliminada)'}</td>
                  <td style={{textAlign:'right'}} className="col-num">{Number(r.metrado_ejecutado).toLocaleString('es-PE')} {partida?.unidad || ''}</td>
                  <td style={{textAlign:'right'}} className="col-num">{r.porcentaje_avance_reportado ? r.porcentaje_avance_reportado + '%' : '—'}</td>
                  <td style={{textAlign:'right'}} className="col-num">{r.personal_asignado || '—'}</td>
                  <td className="col-m">{r.observaciones || '—'}</td>
                  <td>{r.sync_status && r.sync_status !== 'synced' ? <span className="badge b-amber">⏱</span> : <span style={{color:'var(--green)',fontSize:11}}>✓</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {modal && <Modal title="Registrar Avance de Obra" icon="hardHat" onClose={()=>setModal(false)}>
        <div className="g2">
          <div><label className="flabel">Fecha</label><input className="fi" type="date" value={form.fecha||''} onChange={e=>setForm({...form, fecha:e.target.value})}/></div>
          <div><label className="flabel">Semana (auto)</label><div className="fi" style={{color:'var(--amber)'}}>{calcSemana(form.fecha)}</div></div>
          <div style={{gridColumn:'1/-1'}}><label className="flabel">Partida ejecutada *</label>
            <select className="fi" value={form.partida_id||''} onChange={e=>setForm({...form, partida_id:e.target.value})}>
              <option value="">Selecciona...</option>
              {partidas.map(p => <option key={p.id} value={p.id}>{p.codigo_delfin ? `${p.codigo_delfin} — ` : ''}{p.nombre_partida} ({p.unidad})</option>)}
            </select>
          </div>
          <div><label className="flabel">Metrado ejecutado *</label><input className="fi" type="number" step="0.01" min="0" value={form.metrado_ejecutado||''} onChange={e=>setForm({...form, metrado_ejecutado:e.target.value})}/></div>
          <div><label className="flabel">% Avance reportado</label><input className="fi" type="number" min="0" max="100" step="1" placeholder="0-100" value={form.porcentaje_avance_reportado||''} onChange={e=>setForm({...form, porcentaje_avance_reportado:e.target.value})}/></div>
          <div><label className="flabel">Personal asignado</label><input className="fi" type="number" min="0" value={form.personal_asignado||''} onChange={e=>setForm({...form, personal_asignado:e.target.value})}/></div>
        </div>
        <div style={{marginTop:14}}><label className="flabel">Observaciones</label><textarea className="fi" placeholder="Descripción del avance, materiales usados, inconvenientes..." value={form.observaciones||''} onChange={e=>setForm({...form, observaciones:e.target.value})}/></div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={()=>setModal(false)}>Cancelar</button>
          <button className="btn btn-amber" onClick={handleSubmit}><JxIcon name="check" size={13}/>Guardar Avance</button>
        </div>
      </Modal>}
    </div>
  );
}

// ─── COMPARATIVO PAGE ─────────────────────────────────────
function ComparativoPage() {
  const obraId = useObraActiva();
  const { data: partidas, loading } = window.__hooks.usePartidas(obraId);
  const { data: obras } = window.__hooks.useObras();
  const obra = obras?.find(o => o.id === obraId);

  const semaforo = (diff) => diff <= 0 ? {cls:'b-green',lbl:'OK',ic:'checkCircle'} : diff <= 10 ? {cls:'b-yellow',lbl:'Alerta',ic:'alertCircle'} : {cls:'b-red',lbl:'Exceso',ic:'alert'};

  if (loading || !obraId) return <div className="page-wrap"><div className="empty-state"><JxIcon name="compare" size={32} color="var(--tm)"/><p>Cargando comparativo…</p></div></div>;

  const totalPres = partidas.reduce((s,p) => s + Number(p.costo_total_presupuestado || 0), 0);
  const totalReal = partidas.reduce((s,p) => s + Number(p.costo_real_acumulado || 0), 0);
  const desvCosto = totalPres > 0 ? ((totalReal - totalPres) / totalPres * 100) : 0;
  const avFisicoReal = obra?.avance_fisico ?? 0;

  const kpis = [
    {label:'Avance Físico', pres:'—', real:fmtPct(avFisicoReal), diff:0},
    {label:'Avance Financiero', pres:fmtPct(totalPres > 0 ? (totalPres/totalPres)*100 : 0), real:fmtPct(obra?.avance_financiero), diff:0},
    {label:'Costo Acumulado', pres:fmtSk(totalPres), real:fmtSk(totalReal), diff:Number(desvCosto.toFixed(1))},
    {label:'Partidas Atrasadas', pres:'0', real:String(partidas.filter(p => p.estado === 'atrasado').length), diff:partidas.filter(p => p.estado === 'atrasado').length},
  ];

  const partidasConCosto = partidas.filter(p => Number(p.costo_total_presupuestado || 0) > 0 || Number(p.costo_real_acumulado || 0) > 0);

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div><div className="pg-title">Planificado vs Real</div><div className="pg-sub">Comparativo de costos y avance · {obra?.nombre_obra || ''}</div></div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
        {kpis.map((s,i) => {
          const sem = semaforo(s.diff);
          return (
            <div key={i} className="card card-p" style={{borderTop:`2px solid ${s.diff<=0?'var(--green)':s.diff<=5?'var(--yellow)':'var(--red)'}`}}>
              <div style={{fontSize:11,color:'var(--tm)',marginBottom:10}}>{s.label}</div>
              <div style={{display:'flex',gap:8,marginBottom:8}}>
                <div style={{flex:1,background:'rgba(52,152,219,0.1)',borderRadius:6,padding:'8px'}}>
                  <div style={{fontSize:9,color:'var(--blue)',fontWeight:700,marginBottom:3}}>PLAN.</div>
                  <div style={{fontSize:14,fontWeight:700,color:'var(--tp)'}}>{s.pres}</div>
                </div>
                <div style={{flex:1,background:'rgba(242,183,5,0.1)',borderRadius:6,padding:'8px'}}>
                  <div style={{fontSize:9,color:'var(--amber)',fontWeight:700,marginBottom:3}}>REAL</div>
                  <div style={{fontSize:14,fontWeight:700,color:'var(--tp)'}}>{s.real}</div>
                </div>
              </div>
              <span className={`badge ${sem.cls}`}><JxIcon name={sem.ic} size={10}/> {sem.lbl}</span>
            </div>
          );
        })}
      </div>

      {partidasConCosto.length === 0 ? (
        <div className="card card-p empty-state"><JxIcon name="compare" size={40} color="var(--tm)"/><p>Aún no hay datos de costos para comparar. Registra avances o agrega presupuesto a las partidas.</p></div>
      ) : (
      <div className="chart-card">
        <div className="chart-title">Comparativo por Partida</div>
        <div className="chart-sub">Costo presupuestado vs ejecutado por partida</div>
        <table className="tbl" style={{marginTop:8}}>
          <thead><tr>
            <th>Partida</th><th style={{textAlign:'right'}}>% Avance</th>
            <th style={{textAlign:'right'}}>C. Presupuestado</th><th style={{textAlign:'right'}}>C. Real</th>
            <th style={{textAlign:'right'}}>Desviación</th><th>Estado</th>
          </tr></thead>
          <tbody>
            {partidasConCosto.map(p => {
              const ctPres = Number(p.costo_total_presupuestado || 0);
              const ctReal = Number(p.costo_real_acumulado || 0);
              const diff = ctReal - ctPres;
              const diffPct = ctPres > 0 ? (diff / ctPres * 100) : 0;
              const sem = semaforo(diffPct);
              return (
                <tr key={p.id}>
                  <td className="col-p">{p.codigo_delfin ? p.codigo_delfin + ' — ' : ''}{p.nombre_partida}</td>
                  <td style={{textAlign:'right'}} className="col-num">{Number(p.porcentaje_avance || 0).toFixed(0)}%</td>
                  <td style={{textAlign:'right'}} className="col-num">{fmtS(ctPres)}</td>
                  <td style={{textAlign:'right'}} className="col-num">{fmtS(ctReal)}</td>
                  <td style={{textAlign:'right'}} className="col-num"><span style={{color:diff>0?'var(--red)':'var(--green)',fontWeight:600}}>{diff>0?'+':''}{Math.round(diff).toLocaleString()} ({diffPct.toFixed(1)}%)</span></td>
                  <td><span className={`badge ${sem.cls}`}>{sem.lbl}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

Object.assign(window, { ObrasPage, PartidasPage, CronogramaPage, AvancePage, ComparativoPage });
