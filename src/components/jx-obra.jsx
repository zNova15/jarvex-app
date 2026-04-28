import React from "react";
const { useState: uSO, useMemo: uMO, useEffect: uEO } = React;

const EST_PART = { terminado:'b-green', en_ejecucion:'b-blue', atrasado:'b-red', pendiente:'b-gray', observado:'b-yellow' };
const EST_LBL  = { terminado:'Terminado', en_ejecucion:'En Ejecución', atrasado:'Atrasado', pendiente:'Pendiente', observado:'Observado' };

const EST_OBRA = { activo:'b-green', planificacion:'b-blue', pausado:'b-yellow', terminado:'b-gray', cancelado:'b-red' };
const EST_OBRA_LBL = { activo:'Activo', planificacion:'Planificación', pausado:'Pausado', terminado:'Terminado', cancelado:'Cancelado' };

// Helper para detectar obra activa con tope de reintentos + reanudar
// cuando el realtime traiga una obra nueva (evento 'jarvex_master_updated').
function useObraActiva() {
  const [obraId, setObraId] = uSO(null);
  uEO(() => {
    let cancelled = false;
    let attempts = 0;
    const find = async () => {
      attempts++;
      const obras = await window.__db.obras.toArray();
      const stored = window.__getObraActivaId?.();
      const a = (stored && obras.find(o => o.id === stored && !o.deleted_at))
             || obras.find(o => !o.deleted_at);
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
  const auth = window.__useAuth ? window.__useAuth() : null;
  const isAdmin = auth?.profile?.rol === 'admin';
  const appMode = window.__useAppMode ? window.__useAppMode() : { isPrueba: true };
  const canDelete = isAdmin && appMode.isPrueba;
  const [modal, setModal] = uSO(null);
  const [form, setForm] = uSO({});
  const [editingId, setEditingId] = uSO(null);

  const handleDeleteObra = async (o) => {
    if (!canDelete) return;
    if (!confirm(`¿Eliminar la obra "${o.nombre_obra}"?\n\nESTO ES IRREVERSIBLE. Todos los registros asociados (partidas, materiales, asistencia, movimientos) quedarán huérfanos.\n\nSolo úsalo para limpiar pruebas.`)) return;
    try {
      await updateObra(o.id, { deleted_at: new Date().toISOString() });
      try { await window.__logAudit?.({ action:'delete', table:'obras', recordId:o.id, oldData:o, reason:'Eliminación manual (modo prueba)' }); } catch(e) {}
      showToast(`Obra "${o.nombre_obra}" eliminada`, 'amber');
    } catch (e) { showToast('Error al eliminar: ' + (e.message||e), 'red'); }
  };

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
                  <div style={{ display:'flex', gap:4 }}>
                    <button className="btn btn-ghost btn-xs" title="Editar obra" onClick={(e)=>{ e.stopPropagation(); openEditObra(o); }}>
                      <JxIcon name="edit" size={11}/>
                    </button>
                    {canDelete && (
                      <button className="btn btn-red btn-xs" title="Eliminar (solo modo prueba)" onClick={(e)=>{ e.stopPropagation(); handleDeleteObra(o); }}>
                        <JxIcon name="trash" size={11}/>
                      </button>
                    )}
                  </div>
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
// Construye un árbol jerárquico a partir de codigo_delfin (ej "02.01.01.01.05.01")
// Las partidas reales (de la tabla) son las hojas; los nodos intermedios se infieren.
function buildPartidasTree(partidas) {
  const root = { code: '', label: 'Root', children: new Map(), partidas: [], depth: 0 };
  if (!partidas || !partidas.length) return root;

  for (const p of partidas) {
    const code = (p.codigo_delfin || '').trim();
    if (!code) {
      // Sin código: cuelgan de root como hojas sueltas
      root.partidas.push(p);
      continue;
    }
    const segs = code.split('.');
    let cur = root;
    for (let i = 0; i < segs.length; i++) {
      const prefix = segs.slice(0, i + 1).join('.');
      let child = cur.children.get(prefix);
      if (!child) {
        child = { code: prefix, label: prefix, children: new Map(), partidas: [], depth: i + 1 };
        cur.children.set(prefix, child);
      }
      cur = child;
    }
    // La hoja "real" (la partida) se asocia al nodo del prefijo completo
    cur.partida = p;
  }
  return root;
}

// Calcula agregados recursivos (presupuesto, real, % avance ponderado, conteo de hojas)
function computeAggregates(node) {
  let presupuesto = 0;
  let real = 0;
  let avancePonderado = 0; // Σ(% × costoPres)
  let costoForAvance = 0;
  let leafCount = 0;

  // hojas directas (partidas sin código)
  for (const p of node.partidas) {
    const ctP = Number(p.costo_total_presupuestado || 0);
    const ctR = Number(p.costo_real_acumulado || 0);
    presupuesto += ctP;
    real += ctR;
    const av = Number(p.porcentaje_avance || 0);
    avancePonderado += av * ctP;
    costoForAvance += ctP;
    leafCount += 1;
  }

  // partida asociada al nodo
  if (node.partida) {
    const ctP = Number(node.partida.costo_total_presupuestado || 0);
    const ctR = Number(node.partida.costo_real_acumulado || 0);
    presupuesto += ctP;
    real += ctR;
    const av = Number(node.partida.porcentaje_avance || 0);
    avancePonderado += av * ctP;
    costoForAvance += ctP;
    leafCount += 1;
  }

  for (const child of node.children.values()) {
    const ag = computeAggregates(child);
    presupuesto += ag.presupuesto;
    real += ag.real;
    avancePonderado += ag.avanceWeighted;
    costoForAvance += ag.costoForAvance;
    leafCount += ag.leafCount;
  }

  const avancePct = costoForAvance > 0 ? avancePonderado / costoForAvance : 0;
  node.agg = { presupuesto, real, avancePct, leafCount };
  return { presupuesto, real, avanceWeighted: avancePonderado, costoForAvance, leafCount };
}

// Encuentra todos los códigos de nodos que tienen al menos una hoja matching
// Devuelve un Set de códigos que deben mostrarse (incluyendo ancestros)
function filterTreeMatches(node, predicate, ancestorPath, visibleCodes) {
  let anyMatch = false;
  // hoja propia
  if (node.partida && predicate(node.partida)) {
    anyMatch = true;
    for (const c of ancestorPath) visibleCodes.add(c);
    visibleCodes.add(node.code);
  }
  for (const p of node.partidas) {
    if (predicate(p)) {
      anyMatch = true;
      for (const c of ancestorPath) visibleCodes.add(c);
      visibleCodes.add(node.code);
    }
  }
  ancestorPath.push(node.code);
  for (const child of node.children.values()) {
    if (filterTreeMatches(child, predicate, ancestorPath, visibleCodes)) {
      anyMatch = true;
      visibleCodes.add(node.code);
    }
  }
  ancestorPath.pop();
  return anyMatch;
}

function highlightText(text, terms) {
  if (!text || !terms || !terms.length) return text;
  const lower = text.toLowerCase();
  // marcar rangos
  const ranges = [];
  for (const t of terms) {
    if (!t) continue;
    let idx = 0;
    while ((idx = lower.indexOf(t, idx)) !== -1) {
      ranges.push([idx, idx + t.length]);
      idx += t.length;
    }
  }
  if (!ranges.length) return text;
  ranges.sort((a, b) => a[0] - b[0]);
  // merge
  const merged = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    if (ranges[i][0] <= last[1]) last[1] = Math.max(last[1], ranges[i][1]);
    else merged.push(ranges[i]);
  }
  const out = [];
  let cursor = 0;
  merged.forEach(([s, e], i) => {
    if (s > cursor) out.push(text.slice(cursor, s));
    out.push(<mark key={i} style={{ background: 'rgba(245,158,11,0.35)', color: 'inherit', padding: '0 2px', borderRadius: 3 }}>{text.slice(s, e)}</mark>);
    cursor = e;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

// Mini barra de progreso
function MiniBar({ value, label, color, title }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div title={title || `${label}: ${v.toFixed(1)}%`} style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 70 }}>
      <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${v}%`, background: color, borderRadius: 4 }}/>
      </div>
      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--tm)', minWidth: 28, textAlign: 'right' }}>{v.toFixed(0)}%</span>
    </div>
  );
}

// Fila de hoja (partida real)
function PartidaLeafRow({ partida: p, depth, searchTerms, isAdmin, onEdit, onVerAPU, consumoMap }) {
  const ctPres = Number(p.costo_total_presupuestado || 0);
  const ctReal = Number(p.costo_real_acumulado || 0);
  const av = Number(p.porcentaje_avance || 0);
  const avFin = ctPres > 0 ? (ctReal / ctPres) * 100 : 0;
  const avCons = consumoMap?.[p.id];

  // Atraso vs cronograma: fecha_fin_planificada < hoy && avance < 80
  const today = new Date().toISOString().slice(0, 10);
  const isAtrasada = p.fecha_fin_planificada
    && p.fecha_fin_planificada < today
    && av < 80
    && p.estado !== 'terminado';
  const diasVencidos = isAtrasada
    ? Math.floor((new Date(today) - new Date(p.fecha_fin_planificada)) / 86400000)
    : 0;

  const colorAv = av >= 100 ? 'var(--green)' : (isAtrasada || p.estado === 'atrasado') ? 'var(--red)' : 'var(--blue)';
  const colorFin = avFin > 100 ? 'var(--red)' : avFin >= 80 ? 'var(--amber)' : 'var(--green)';
  const colorCons = avCons == null ? 'var(--tm)' : avCons > 100 ? 'var(--red)' : avCons >= 80 ? 'var(--amber)' : 'var(--green)';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 110px 110px 220px 90px 60px',
        gap: 8,
        alignItems: 'center',
        padding: '8px 12px',
        paddingLeft: 12 + depth * 18,
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        borderLeft: isAtrasada ? '3px solid var(--red)' : '3px solid transparent',
        background: isAtrasada ? 'rgba(231,76,60,0.04)' : 'transparent',
        fontSize: 12,
      }}
      title={isAtrasada ? `⚠ Atrasada ${diasVencidos} día${diasVencidos === 1 ? '' : 's'} (fecha fin planificada: ${p.fecha_fin_planificada})` : undefined}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{ width: 14, display: 'inline-block' }}/>
        <span style={{ color: 'var(--amber)', fontFamily: 'monospace', fontSize: 11, flexShrink: 0 }}>
          {highlightText(p.codigo_delfin || '—', searchTerms)}
        </span>
        <span style={{ color: 'var(--tp)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.nombre_partida}>
          {highlightText(p.nombre_partida || '', searchTerms)}
        </span>
        {p.unidad && <span className="tag" style={{ fontSize: 10, flexShrink: 0 }}>{Number(p.metrado_contratado||0).toLocaleString('es-PE')} {p.unidad}</span>}
      </div>
      <div style={{ textAlign: 'right', color: 'var(--tp)' }}>{fmtS(ctPres)}</div>
      <div style={{ textAlign: 'right', color: ctReal > ctPres ? 'var(--red)' : 'var(--tp)' }}>{fmtS(ctReal)}</div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <MiniBar value={av} label="Reportado" color={colorAv} title={`Avance reportado: ${av.toFixed(1)}%`}/>
        <MiniBar value={avFin} label="Financiero" color={colorFin} title={`Avance financiero: ${avFin.toFixed(1)}% (S/ ${ctReal.toLocaleString()} de S/ ${ctPres.toLocaleString()})`}/>
        <MiniBar value={avCons || 0} label="Consumo" color={colorCons} title={avCons == null ? 'Avance por consumo: sin datos' : `Avance por consumo: ${Number(avCons).toFixed(1)}%`}/>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:3, alignItems:'flex-start' }}>
        <span className={`badge ${EST_PART[p.estado] || 'b-gray'}`} style={{ fontSize: 10 }}>{EST_LBL[p.estado] || p.estado}</span>
        {isAtrasada && (
          <span className="badge b-red" style={{ fontSize: 9, padding:'2px 6px' }} title={`${diasVencidos} día${diasVencidos === 1 ? '' : 's'} vencidos`}>
            ⚠ {diasVencidos}d
          </span>
        )}
      </div>
      <div style={{ textAlign: 'center', whiteSpace:'nowrap' }}>
        <button className="btn btn-ghost btn-xs" title="Ver APU (insumos: MO, materiales, equipo)" onClick={() => onVerAPU?.(p)}>
          <JxIcon name="eye" size={11}/>
        </button>
        {isAdmin && (
          <button className="btn btn-ghost btn-xs" title="Editar partida" onClick={() => onEdit(p)} style={{ marginLeft:2 }}>
            <JxIcon name="edit" size={11}/>
          </button>
        )}
      </div>
    </div>
  );
}

// Nodo del árbol (capítulo / sub-capítulo); renderiza hojas también
function TreeNode({ node, visibleCodes, expanded, onToggle, searchTerms, isAdmin, onEdit, onVerAPU, consumoMap }) {
  if (visibleCodes && !visibleCodes.has(node.code)) return null;

  const isOpen = expanded.has(node.code);
  const hasChildren = node.children.size > 0;
  const isLeafOnly = !hasChildren && node.partida; // nodo terminal con partida real
  const depth = node.depth;

  // Si solo es la hoja (sin hijos), renderizamos como PartidaLeafRow
  if (isLeafOnly && !hasChildren) {
    return (
      <PartidaLeafRow
        partida={node.partida}
        depth={depth}
        searchTerms={searchTerms}
        isAdmin={isAdmin}
        onEdit={onEdit}
        onVerAPU={onVerAPU}
        consumoMap={consumoMap}
      />
    );
  }

  const agg = node.agg || { presupuesto: 0, real: 0, avancePct: 0, leafCount: 0 };
  // Etiqueta del nodo: si tiene partida asociada, usar su nombre; sino código
  const label = node.partida?.nombre_partida || `Capítulo ${node.code}`;
  const bgIntensity = Math.max(0, 0.18 - depth * 0.03);

  return (
    <>
      <div
        onClick={() => hasChildren && onToggle(node.code)}
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 110px 110px 220px 90px 60px',
          gap: 8,
          alignItems: 'center',
          padding: '8px 12px',
          paddingLeft: 12 + depth * 18,
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          background: `rgba(245,158,11,${bgIntensity})`,
          cursor: hasChildren ? 'pointer' : 'default',
          fontSize: 12,
          fontWeight: depth <= 2 ? 700 : 600,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {hasChildren ? (
            <JxIcon name={isOpen ? 'chevD' : 'chevR'} size={12} color="var(--amber)"/>
          ) : (
            <span style={{ width: 12, display: 'inline-block' }}/>
          )}
          <span style={{ color: 'var(--amber)', fontFamily: 'monospace', fontSize: 11, flexShrink: 0 }}>
            {highlightText(node.code, searchTerms)}
          </span>
          <span style={{ color: 'var(--tp)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={label}>
            {highlightText(label, searchTerms)}
          </span>
          <span style={{ fontSize: 10, color: 'var(--tm)', fontWeight: 500, flexShrink: 0 }}>
            ({agg.leafCount} {agg.leafCount === 1 ? 'partida' : 'partidas'})
          </span>
        </div>
        <div style={{ textAlign: 'right', color: 'var(--tp)' }}>{fmtSk(agg.presupuesto)}</div>
        <div style={{ textAlign: 'right', color: agg.real > agg.presupuesto ? 'var(--red)' : 'var(--tp)' }}>{fmtSk(agg.real)}</div>
        <div>
          <MiniBar
            value={agg.avancePct}
            label="Avance ponderado"
            color={agg.avancePct >= 100 ? 'var(--green)' : agg.avancePct >= 50 ? 'var(--blue)' : 'var(--amber)'}
            title={`Avance ponderado por costo: ${agg.avancePct.toFixed(1)}%`}
          />
        </div>
        <div></div>
        <div></div>
      </div>
      {isOpen && (
        <>
          {/* partida asociada al nodo (raro, pero posible) */}
          {node.partida && hasChildren && (
            <PartidaLeafRow
              partida={node.partida}
              depth={depth + 1}
              searchTerms={searchTerms}
              isAdmin={isAdmin}
              onEdit={onEdit}
              onVerAPU={onVerAPU}
              consumoMap={consumoMap}
            />
          )}
          {Array.from(node.children.values())
            .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
            .map(child => (
              <TreeNode
                key={child.code}
                node={child}
                visibleCodes={visibleCodes}
                expanded={expanded}
                onToggle={onToggle}
                searchTerms={searchTerms}
                isAdmin={isAdmin}
                onEdit={onEdit}
              onVerAPU={onVerAPU}
                consumoMap={consumoMap}
              />
            ))}
          {/* hojas sueltas (sin código) */}
          {node.partidas.map(p => (
            <PartidaLeafRow
              key={p.id}
              partida={p}
              depth={depth + 1}
              searchTerms={searchTerms}
              isAdmin={isAdmin}
              onEdit={onEdit}
              onVerAPU={onVerAPU}
              consumoMap={consumoMap}
            />
          ))}
        </>
      )}
    </>
  );
}

function PartidasPage({ showToast }) {
  const obraId = useObraActiva();
  const { data: partidas, loading, create: createPartida, update: updatePartida } = window.__hooks.usePartidas(obraId);
  const auth = window.__useAuth ? window.__useAuth() : null;
  const isAdmin = auth?.profile?.rol === 'admin';
  const [q, setQ] = uSO('');
  const [modal, setModal] = uSO(null);
  const [form, setForm] = uSO({});
  const [editingId, setEditingId] = uSO(null);
  const [expanded, setExpanded] = uSO(() => new Set());
  const [soloActivas, setSoloActivas] = uSO(false);
  const [estadoFilter, setEstadoFilter] = uSO('todos');
  const [consumoMap, setConsumoMap] = uSO({}); // partida_id -> avance_consumo_pct
  const [verAPU, setVerAPU] = uSO(null); // partida cuyos insumos estamos viendo
  const [insumosDetalle, setInsumosDetalle] = uSO([]); // insumos de la partida activa
  const [loadingInsumos, setLoadingInsumos] = uSO(false);

  // Cargar los insumos de la partida cuando se abre el modal "Ver APU"
  uEO(() => {
    if (!verAPU?.id) { setInsumosDetalle([]); return; }
    let cancelled = false;
    setLoadingInsumos(true);
    (async () => {
      try {
        const arr = await window.__db.insumos_partida.where('partida_id').equals(verAPU.id).toArray();
        if (!cancelled) setInsumosDetalle(arr || []);
      } catch (e) {
        console.warn('Error cargando insumos:', e);
        if (!cancelled) setInsumosDetalle([]);
      } finally {
        if (!cancelled) setLoadingInsumos(false);
      }
    })();
    return () => { cancelled = true; };
  }, [verAPU?.id]);

  // Poll vista de Supabase (avance por consumo) — graceful si offline / vista no existe
  uEO(() => {
    if (!obraId) return;
    let cancelled = false;
    const fetchConsumo = async () => {
      try {
        const sb = window.__supabase;
        if (!sb) return;
        const { data, error } = await sb
          .from('v_partidas_avance_consumo')
          .select('partida_id, avance_consumo_pct')
          .eq('obra_id', obraId);
        if (error || cancelled || !data) return;
        const map = {};
        for (const r of data) map[r.partida_id] = Number(r.avance_consumo_pct) || 0;
        setConsumoMap(map);
      } catch (e) { /* offline o vista no disponible: ignorar */ }
    };
    fetchConsumo();
    const id = setInterval(fetchConsumo, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [obraId]);

  const openEditPartida = (p) => {
    setForm({
      codigo_delfin: p.codigo_delfin || '',
      nombre_partida: p.nombre_partida || '',
      categoria: p.categoria || '',
      unidad: p.unidad || '',
      metrado_contratado: p.metrado_contratado ?? '',
      precio_unitario_pres: p.precio_unitario_pres ?? '',
      fecha_inicio_planificada: p.fecha_inicio_planificada || '',
      fecha_fin_planificada: p.fecha_fin_planificada || '',
      estado: p.estado || 'pendiente',
    });
    setEditingId(p.id);
    setModal('editar');
  };

  // Filtros base sobre la lista plana (estado / solo activas)
  const partidasFiltered = uMO(() => {
    if (!partidas) return [];
    return partidas.filter(p => {
      if (soloActivas && p.estado === 'terminado') return false;
      if (estadoFilter !== 'todos' && p.estado !== estadoFilter) return false;
      return true;
    });
  }, [partidas, soloActivas, estadoFilter]);

  // Construir árbol y agregados (memoizado)
  const tree = uMO(() => {
    const t = buildPartidasTree(partidasFiltered);
    computeAggregates(t);
    return t;
  }, [partidasFiltered]);

  // Búsqueda: términos separados por espacio, todos deben aparecer
  const searchTerms = uMO(() => {
    return q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  }, [q]);

  const visibleCodes = uMO(() => {
    if (!searchTerms.length) return null; // null = no filtrar por búsqueda
    const predicate = (p) => {
      const code = (p.codigo_delfin || '').toLowerCase();
      const name = (p.nombre_partida || '').toLowerCase();
      return searchTerms.every(t => code.includes(t) || name.includes(t));
    };
    const set = new Set();
    filterTreeMatches(tree, predicate, [], set);
    return set;
  }, [tree, searchTerms]);

  // Auto-expandir nodos cuando hay búsqueda activa
  const effectiveExpanded = uMO(() => {
    if (!visibleCodes) return expanded;
    return visibleCodes; // mostrar el camino completo
  }, [visibleCodes, expanded]);

  const toggleNode = (code) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  };

  const expandAll = () => {
    const all = new Set();
    const walk = (n) => { if (n.code) all.add(n.code); for (const c of n.children.values()) walk(c); };
    walk(tree);
    setExpanded(all);
  };
  const collapseAll = () => setExpanded(new Set());

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
      if (editingId) {
        const oldData = partidas.find(p => p.id === editingId);
        const newFields = {
          codigo_delfin: form.codigo_delfin || null,
          nombre_partida: form.nombre_partida,
          categoria: form.categoria || 'General',
          unidad: form.unidad || 'und',
          metrado_contratado: cantidad,
          precio_unitario_pres: precio,
          costo_total_presupuestado: cantidad * precio,
          fecha_inicio_planificada: form.fecha_inicio_planificada || null,
          fecha_fin_planificada: form.fecha_fin_planificada || null,
          estado: form.estado || 'pendiente',
        };
        await updatePartida(editingId, newFields);
        try { await window.__logAudit?.({ action:'update', table:'partidas', recordId:editingId, oldData, newData:newFields }); } catch(e) {}
        showToast(`Partida "${form.nombre_partida}" actualizada`, 'green');
      } else {
        const created = await createPartida({
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
        try { await window.__logAudit?.({ action:'insert', table:'partidas', recordId:created?.id, newData:created }); } catch(e) {}
        showToast(`Partida "${form.nombre_partida}" creada`, 'green');
      }
      setModal(null); setForm({}); setEditingId(null);
    } catch (e) {
      showToast('Error: ' + e.message, 'red');
    }
  };

  if (!obraId) return <SinObraEmpty icon="list"/>;
  if (loading) return <div className="page-wrap"><div className="empty-state"><JxIcon name="list" size={32} color="var(--tm)"/><p>Cargando partidas…</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div><div className="pg-title">Partidas de Obra</div><div className="pg-sub">{partidas.length} partidas · {fmtSk(totalReal)} ejecutado de {fmtSk(totalPres)}</div></div>
        <button className="btn btn-amber btn-sm" onClick={()=>{setForm({}); setEditingId(null); setModal('nueva');}}><JxIcon name="plus" size={13}/>Nueva Partida</button>
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

      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
        <div className="search-bar" style={{flex:'1 1 280px'}}><JxIcon name="search" size={14} color="var(--tm)"/><input placeholder="Buscar por código, nombre o palabra clave…" value={q} onChange={e=>setQ(e.target.value)}/></div>
        <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'var(--tm)',cursor:'pointer'}}>
          <input type="checkbox" checked={soloActivas} onChange={e=>setSoloActivas(e.target.checked)}/>
          Solo activas
        </label>
        <select className="fi" style={{maxWidth:160,fontSize:12}} value={estadoFilter} onChange={e=>setEstadoFilter(e.target.value)}>
          <option value="todos">Todos los estados</option>
          <option value="pendiente">Pendiente</option>
          <option value="en_ejecucion">En Ejecución</option>
          <option value="atrasado">Atrasado</option>
          <option value="terminado">Terminado</option>
          <option value="observado">Observado</option>
        </select>
        <button className="btn btn-ghost btn-xs" onClick={expandAll} title="Expandir todo"><JxIcon name="chevD" size={11}/> Expandir</button>
        <button className="btn btn-ghost btn-xs" onClick={collapseAll} title="Colapsar todo"><JxIcon name="chevR" size={11}/> Colapsar</button>
      </div>

      {partidas.length === 0 ? (
        <div className="card card-p empty-state"><JxIcon name="list" size={40} color="var(--tm)"/><p>No hay partidas. Click en "Nueva Partida".</p></div>
      ) : partidasFiltered.length === 0 ? (
        <div className="card card-p empty-state"><JxIcon name="filter" size={40} color="var(--tm)"/><p>Ningún resultado con los filtros actuales.</p></div>
      ) : (
        <div className="card" style={{overflow:'hidden'}}>
          <div style={{padding:'8px 12px',background:'rgba(0,0,0,0.18)',fontSize:11,color:'var(--tm)',fontWeight:600,letterSpacing:0.4,textTransform:'uppercase',borderBottom:'1px solid rgba(255,255,255,0.05)'}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 110px 110px 220px 90px 60px',gap:8,alignItems:'center'}}>
              <div>Código / Partida</div>
              <div style={{textAlign:'right'}}>Presupuesto</div>
              <div style={{textAlign:'right'}}>Real</div>
              <div style={{textAlign:'center'}}>Avance: Reportado · Financiero · Consumo</div>
              <div>Estado</div>
              <div style={{textAlign:'center'}}>{isAdmin ? 'Acc.' : ''}</div>
            </div>
          </div>
          <div style={{maxHeight:'calc(100vh - 360px)',overflowY:'auto'}}>
            {Array.from(tree.children.values()).sort((a,b)=>a.code.localeCompare(b.code,undefined,{numeric:true})).map(node => (
              <TreeNode
                key={node.code}
                node={node}
                visibleCodes={visibleCodes}
                expanded={effectiveExpanded}
                onToggle={toggleNode}
                searchTerms={searchTerms}
                isAdmin={isAdmin}
                onEdit={openEditPartida}
                onVerAPU={setVerAPU}
                consumoMap={consumoMap}
              />
            ))}
            {/* Hojas sin código */}
            {tree.partidas.map(p => (
              <PartidaLeafRow
                key={p.id}
                partida={p}
                depth={1}
                searchTerms={searchTerms}
                isAdmin={isAdmin}
                onEdit={openEditPartida}
                onVerAPU={setVerAPU}
                consumoMap={consumoMap}
              />
            ))}
          </div>
          <div style={{padding:'10px 14px',background:'rgba(0,0,0,0.18)',borderTop:'1px solid rgba(255,255,255,0.05)',display:'grid',gridTemplateColumns:'1fr 110px 110px auto',gap:8,fontSize:12,fontWeight:700,color:'var(--tp)'}}>
            <div style={{color:'var(--ts)'}}>TOTALES</div>
            <div style={{textAlign:'right'}}>{fmtS(totalPres)}</div>
            <div style={{textAlign:'right'}}>{fmtS(totalReal)}</div>
            <div style={{color:(totalReal-totalPres)>0?'var(--red)':'var(--green)'}}>
              {(totalReal-totalPres)>0?'+':''}{Math.round(totalReal-totalPres).toLocaleString()}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal "Ver APU" — detalle de insumos por categoría ── */}
      {verAPU && <Modal
        title={`APU · ${verAPU.codigo_delfin || ''} — ${verAPU.nombre_partida || ''}`}
        icon="list"
        onClose={()=>setVerAPU(null)}
      >
        {(() => {
          const cantidadPartida = Number(verAPU.metrado_contratado || 0);
          const totalPartida = Number(verAPU.costo_total_presupuestado || 0);
          // Agrupar por tipo_insumo
          const grupos = { mano_obra: [], material: [], equipo: [], subcontrato: [], subpartida: [] };
          for (const i of insumosDetalle) {
            const k = i.tipo_insumo || 'material';
            if (!grupos[k]) grupos[k] = [];
            grupos[k].push(i);
          }
          const totalGrupo = (arr) => arr.reduce((s, x) =>
            s + (Number(x.cantidad_presupuestada || 0) * Number(x.precio_presupuestado || 0)), 0
          );
          const TIPO_LABEL = {
            mano_obra: 'MANO DE OBRA',
            material: 'MATERIALES',
            equipo: 'EQUIPO',
            subcontrato: 'SUBCONTRATO',
            subpartida: 'SUBPARTIDA',
          };
          const ORDEN = ['mano_obra', 'material', 'equipo', 'subcontrato', 'subpartida'];

          return (
            <>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:14 }}>
                <div className="card card-p" style={{ textAlign:'center' }}>
                  <div style={{ fontSize:11, color:'var(--tm)' }}>Metrado</div>
                  <div style={{ fontSize:18, fontWeight:700, color:'var(--tp)', marginTop:3 }}>
                    {cantidadPartida.toLocaleString('es-PE')} <span style={{ fontSize:12, color:'var(--tm)' }}>{verAPU.unidad || 'und'}</span>
                  </div>
                </div>
                <div className="card card-p" style={{ textAlign:'center' }}>
                  <div style={{ fontSize:11, color:'var(--tm)' }}>Precio Unitario</div>
                  <div style={{ fontSize:18, fontWeight:700, color:'var(--amber)', marginTop:3 }}>
                    {fmtS(verAPU.precio_unitario_pres || 0)}
                  </div>
                </div>
                <div className="card card-p" style={{ textAlign:'center' }}>
                  <div style={{ fontSize:11, color:'var(--tm)' }}>Costo Total</div>
                  <div style={{ fontSize:18, fontWeight:700, color:'var(--green)', marginTop:3 }}>
                    {fmtS(totalPartida)}
                  </div>
                </div>
              </div>

              {loadingInsumos ? (
                <div style={{ padding:24, textAlign:'center', color:'var(--tm)', fontSize:12.5 }}>Cargando insumos…</div>
              ) : insumosDetalle.length === 0 ? (
                <div style={{ padding:24, textAlign:'center', color:'var(--tm)', fontSize:12.5, background:'rgba(242,183,5,0.06)', borderRadius:8 }}>
                  Esta partida no tiene insumos cargados.<br/>
                  <span style={{ fontSize:11 }}>Reimporta el APU desde S10 para cargar el detalle.</span>
                </div>
              ) : (
                <div className="card" style={{ overflow:'hidden' }}>
                  {ORDEN.map(tipo => {
                    const arr = grupos[tipo] || [];
                    if (!arr.length) return null;
                    const tot = totalGrupo(arr);
                    return (
                      <div key={tipo}>
                        <div style={{ background:'rgba(0,0,0,0.18)', padding:'8px 14px', display:'flex', justifyContent:'space-between', alignItems:'center', borderTop:'1px solid var(--border)' }}>
                          <span style={{ fontSize:11, fontWeight:700, letterSpacing:'.08em', color:'var(--amber)' }}>{TIPO_LABEL[tipo]}</span>
                          <span style={{ fontSize:12, fontWeight:700, color:'var(--tp)' }}>{tot.toFixed(2)}</span>
                        </div>
                        <table className="tbl" style={{ width:'100%' }}>
                          <thead>
                            <tr>
                              <th style={{ width:90 }}>Código</th>
                              <th>Descripción</th>
                              <th style={{ width:60 }}>Unid.</th>
                              <th style={{ width:80, textAlign:'right' }}>Cantidad</th>
                              <th style={{ width:80, textAlign:'right' }}>Costo</th>
                              <th style={{ width:90, textAlign:'right' }}>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {arr.map(i => {
                              const cant = Number(i.cantidad_presupuestada || 0);
                              const pre  = Number(i.precio_presupuestado || 0);
                              return (
                                <tr key={i.id}>
                                  <td className="col-m" style={{ fontFamily:'monospace', fontSize:11 }}>{i.insumo_codigo || '—'}</td>
                                  <td className="col-p" style={{ fontSize:12 }}>{i.nombre_insumo || '—'}</td>
                                  <td className="col-m">{i.unidad || '—'}</td>
                                  <td style={{ textAlign:'right' }} className="col-num">{cant.toLocaleString('es-PE', { maximumFractionDigits: 4 })}</td>
                                  <td style={{ textAlign:'right' }} className="col-num">{pre.toFixed(2)}</td>
                                  <td style={{ textAlign:'right' }} className="col-num"><strong>{(cant * pre).toFixed(2)}</strong></td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    );
                  })}
                  <div style={{ background:'rgba(242,183,5,0.06)', padding:'10px 14px', display:'flex', justifyContent:'space-between', borderTop:'1px solid var(--border)' }}>
                    <span style={{ fontSize:12, fontWeight:700, color:'var(--ts)' }}>TOTAL</span>
                    <span style={{ fontSize:14, fontWeight:800, color:'var(--green)' }}>{fmtS(totalPartida)}</span>
                  </div>
                </div>
              )}
            </>
          );
        })()}
      </Modal>}

      {(modal === 'nueva' || modal === 'editar') && <Modal title={editingId ? 'Editar Partida' : 'Nueva Partida'} icon="list" onClose={()=>{setModal(null); setEditingId(null); setForm({});}}>
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
          {editingId && <div><label className="flabel">Estado</label>
            <select className="fi" value={form.estado||'pendiente'} onChange={e=>setForm({...form, estado:e.target.value})}>
              <option value="pendiente">Pendiente</option>
              <option value="en_ejecucion">En Ejecución</option>
              <option value="atrasado">Atrasado</option>
              <option value="terminado">Terminado</option>
              <option value="observado">Observado</option>
            </select>
          </div>}
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={()=>{setModal(null); setEditingId(null); setForm({});}}>Cancelar</button>
          <button className="btn btn-amber" onClick={handleSubmit}><JxIcon name="check" size={13}/>{editingId ? 'Guardar Cambios' : 'Crear Partida'}</button>
        </div>
      </Modal>}
    </div>
  );
}

// ─── CRONOGRAMA / GANTT PAGE ──────────────────────────────
const DAY_MS = 24 * 60 * 60 * 1000;
const MES_ABBR = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const DOW_ABBR = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

function parseDate(s) {
  if (!s) return null;
  // Use local-midnight to avoid TZ shift on YYYY-MM-DD strings
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const t = new Date(s).getTime();
  return isNaN(t) ? null : t;
}
function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0,0,0,0);
  return d.getTime();
}
function diffDays(aMs, bMs) {
  return Math.round((startOfDay(bMs) - startOfDay(aMs)) / DAY_MS);
}

function calcEstadoCron(p, todayMs) {
  const ini = parseDate(p.fecha_inicio_planificada);
  const fin = parseDate(p.fecha_fin_planificada);
  const av = Number(p.porcentaje_avance || 0);
  if (ini == null || fin == null) return 'sin_planificar';
  if (av >= 100) return 'terminada';
  if (fin < todayMs && av < 80) return 'atrasada';
  if (ini <= todayMs && todayMs <= fin) {
    return av > 0 ? 'en_curso' : 'en_curso_sin_avance';
  }
  if (ini > todayMs) return 'futura';
  return 'normal';
}

const ESTADO_CRON_COLOR = {
  terminada:           { bar:'var(--green)',  fill:'var(--green)',  label:'Terminada' },
  en_curso:            { bar:'var(--blue)',   fill:'var(--blue)',   label:'En curso' },
  en_curso_sin_avance: { bar:'var(--amber)',  fill:'var(--amber)',  label:'En curso s/avance' },
  atrasada:            { bar:'var(--red)',    fill:'var(--red)',    label:'Atrasada' },
  futura:              { bar:'rgba(255,255,255,0.18)', fill:'rgba(255,255,255,0.35)', label:'Futura' },
  normal:              { bar:'rgba(255,255,255,0.22)', fill:'rgba(255,255,255,0.45)', label:'Normal' },
  sin_planificar:      { bar:'rgba(255,255,255,0.10)', fill:'rgba(255,255,255,0.25)', label:'Sin planificar' },
};

function CronogramaPage() {
  const obraId = useObraActiva();
  const { data: partidasRaw, loading } = window.__hooks.usePartidas(obraId);

  const [zoomMode, setZoomMode] = uSO(null); // 'dia' | 'semana' | 'mes' | null=auto
  const [q, setQ] = uSO('');
  const [soloActivas, setSoloActivas] = uSO(false);
  const [soloAtrasadas, setSoloAtrasadas] = uSO(false);
  const [scrollTop, setScrollTop] = uSO(0);
  const [viewportH, setViewportH] = uSO(560);
  const scrollRef = React.useRef(null);

  const todayMs = uMO(() => startOfDay(Date.now()), []);

  const partidasConFechas = uMO(() => {
    if (!partidasRaw) return [];
    return partidasRaw
      .filter(p => p.fecha_inicio_planificada && p.fecha_fin_planificada && parseDate(p.fecha_inicio_planificada) != null && parseDate(p.fecha_fin_planificada) != null)
      .slice()
      .sort((a, b) => {
        const ai = parseDate(a.fecha_inicio_planificada);
        const bi = parseDate(b.fecha_inicio_planificada);
        if (ai !== bi) return ai - bi;
        return String(a.codigo_delfin || '').localeCompare(String(b.codigo_delfin || ''), 'es', { numeric: true });
      });
  }, [partidasRaw]);

  // Rango global
  const range = uMO(() => {
    if (partidasConFechas.length === 0) return null;
    let minMs = Infinity, maxMs = -Infinity;
    for (const p of partidasConFechas) {
      const ini = parseDate(p.fecha_inicio_planificada);
      const fin = parseDate(p.fecha_fin_planificada);
      if (ini < minMs) minMs = ini;
      if (fin > maxMs) maxMs = fin;
    }
    const startMs = startOfDay(minMs);
    const endMs = startOfDay(maxMs);
    const totalDays = Math.max(1, diffDays(startMs, endMs) + 1);
    return { startMs, endMs, totalDays };
  }, [partidasConFechas]);

  // Zoom auto
  const zoom = uMO(() => {
    if (zoomMode) return zoomMode;
    if (!range) return 'semana';
    return range.totalDays > 60 ? 'semana' : 'dia';
  }, [zoomMode, range]);

  // Tamaño de celda según zoom
  const cellW = zoom === 'dia' ? 26 : zoom === 'semana' ? 22 : 60;

  // Construir columnas (cells) para el header
  const columns = uMO(() => {
    if (!range) return [];
    const cols = [];
    if (zoom === 'dia') {
      for (let i = 0; i < range.totalDays; i++) {
        const ms = range.startMs + i * DAY_MS;
        const d = new Date(ms);
        const isToday = startOfDay(ms) === todayMs;
        const isMonthStart = d.getDate() === 1 || i === 0;
        cols.push({
          left: i * cellW,
          width: cellW,
          label: String(d.getDate()),
          subLabel: isMonthStart ? `${MES_ABBR[d.getMonth()]} ${d.getFullYear()}` : '',
          isToday,
          isWeekend: d.getDay() === 0 || d.getDay() === 6,
        });
      }
    } else if (zoom === 'semana') {
      // semanas que arrancan en lunes; alineado al inicio
      let i = 0, dayIdx = 0;
      while (dayIdx < range.totalDays) {
        const ms = range.startMs + dayIdx * DAY_MS;
        const d = new Date(ms);
        const daysLeft = range.totalDays - dayIdx;
        const dow = (d.getDay() + 6) % 7; // 0=lun
        const daysInWeek = Math.min(7 - dow, daysLeft);
        const isToday = todayMs >= ms && todayMs < ms + daysInWeek * DAY_MS;
        cols.push({
          left: i * cellW,
          width: cellW,
          label: 'S' + Math.floor(dayIdx / 7 + 1),
          subLabel: d.getDate() === 1 || dayIdx === 0 ? `${MES_ABBR[d.getMonth()]} ${d.getFullYear()}` : '',
          isToday,
          isWeekend: false,
          dayStart: dayIdx,
          dayCount: daysInWeek,
        });
        dayIdx += daysInWeek;
        i++;
      }
    } else { // mes
      let i = 0;
      let cursor = new Date(range.startMs);
      cursor.setDate(1);
      while (cursor.getTime() <= range.endMs) {
        const monthStartMs = startOfDay(cursor.getTime());
        const next = new Date(cursor);
        next.setMonth(next.getMonth() + 1);
        const monthEndMs = startOfDay(next.getTime()) - DAY_MS;
        const isToday = todayMs >= monthStartMs && todayMs <= monthEndMs;
        cols.push({
          left: i * cellW,
          width: cellW,
          label: MES_ABBR[cursor.getMonth()],
          subLabel: String(cursor.getFullYear()),
          isToday,
          isWeekend: false,
        });
        cursor = next;
        i++;
      }
    }
    return cols;
  }, [range, zoom, cellW, todayMs]);

  // Conversión día → píxel (timeline)
  const dayToPx = (dayIdx) => {
    if (!range) return 0;
    if (zoom === 'dia') return dayIdx * cellW;
    if (zoom === 'semana') {
      // Cada celda = una semana parcial alineada a lunes
      // Buscamos en columns la celda cuyo dayStart <= dayIdx < dayStart+dayCount
      for (const c of columns) {
        if (dayIdx >= c.dayStart && dayIdx < c.dayStart + c.dayCount) {
          return c.left + ((dayIdx - c.dayStart) / c.dayCount) * c.width;
        }
      }
      // fuera de rango → al final
      return columns.length * cellW;
    }
    // mes: aproximación lineal por días dentro del mes correspondiente
    const targetMs = range.startMs + dayIdx * DAY_MS;
    let acc = 0;
    let cursor = new Date(range.startMs);
    cursor.setDate(1);
    let cIdx = 0;
    while (cursor.getTime() <= range.endMs) {
      const monthStartMs = startOfDay(cursor.getTime());
      const next = new Date(cursor);
      next.setMonth(next.getMonth() + 1);
      const monthEndMs = startOfDay(next.getTime());
      const monthDays = Math.round((monthEndMs - monthStartMs) / DAY_MS);
      if (targetMs >= monthStartMs && targetMs < monthEndMs) {
        const offsetDays = (targetMs - monthStartMs) / DAY_MS;
        return acc + (offsetDays / monthDays) * cellW;
      }
      acc += cellW;
      cursor = next;
      cIdx++;
    }
    return acc;
  };

  // Filtros
  const filtered = uMO(() => {
    if (!partidasConFechas.length) return [];
    const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return partidasConFechas.filter(p => {
      const cod = String(p.codigo_delfin || '').toLowerCase();
      const nom = String(p.nombre_partida || '').toLowerCase();
      const hay = (cod + ' ' + nom);
      for (const t of tokens) if (!hay.includes(t)) return false;

      const av = Number(p.porcentaje_avance || 0);
      const fin = parseDate(p.fecha_fin_planificada);
      if (soloActivas && av >= 100) return false;
      if (soloAtrasadas && !(fin < todayMs && av < 80)) return false;
      return true;
    });
  }, [partidasConFechas, q, soloActivas, soloAtrasadas, todayMs]);

  // Estadísticas
  const stats = uMO(() => {
    let atrasadas = 0, enCurso = 0, futuras = 0, terminadas = 0;
    for (const p of partidasConFechas) {
      const e = calcEstadoCron(p, todayMs);
      if (e === 'atrasada') atrasadas++;
      else if (e === 'en_curso' || e === 'en_curso_sin_avance') enCurso++;
      else if (e === 'futura') futuras++;
      else if (e === 'terminada') terminadas++;
    }
    return { atrasadas, enCurso, futuras, terminadas, total: partidasConFechas.length };
  }, [partidasConFechas, todayMs]);

  // Virtualización
  const ROW_H = 30;
  const BUFFER = 20;
  const totalContentH = filtered.length * ROW_H;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - BUFFER);
  const endIdx = Math.min(filtered.length, Math.ceil((scrollTop + viewportH) / ROW_H) + BUFFER);
  const visibleRows = filtered.slice(startIdx, endIdx);

  uEO(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    const onResize = () => setViewportH(el.clientHeight);
    el.addEventListener('scroll', onScroll, { passive: true });
    onResize();
    window.addEventListener('resize', onResize);
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, [filtered.length]);

  // Loading / empty
  if (!obraId) return <SinObraEmpty icon="gantt"/>;
  if (loading) {
    return <div className="page-wrap"><div className="empty-state"><JxIcon name="gantt" size={32} color="var(--tm)"/><p>Cargando cronograma…</p></div></div>;
  }
  if (!partidasConFechas.length) {
    return (
      <div className="page-wrap">
        <div className="pg-hd"><div><div className="pg-title">Cronograma / Gantt</div><div className="pg-sub">No hay partidas con fechas planificadas</div></div></div>
        <div className="card card-p empty-state" style={{borderColor:'var(--amber)',background:'rgba(242,183,5,0.04)'}}>
          <JxIcon name="alert" size={40} color="var(--amber)"/>
          <p style={{color:'var(--ts)',fontWeight:600,margin:'8px 0 4px'}}>Importa el Gantt para ver el cronograma.</p>
          <p style={{color:'var(--tm)',fontSize:12}}>Ve a <strong>Importar</strong> y carga el archivo de cronograma desde S10. Las partidas necesitan <em>fecha_inicio_planificada</em> y <em>fecha_fin_planificada</em>.</p>
        </div>
      </div>
    );
  }

  const todayDayIdx = range ? diffDays(range.startMs, todayMs) : -1;
  const todayPx = (todayDayIdx >= 0 && todayDayIdx <= range.totalDays) ? dayToPx(todayDayIdx) : -1;
  const timelineW = columns.reduce((acc, c) => Math.max(acc, c.left + c.width), 0);
  const labelW = 320;

  const fechaIniStr = new Date(range.startMs).toISOString().slice(0,10);
  const fechaFinStr = new Date(range.endMs).toISOString().slice(0,10);

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb" style={{flexWrap:'wrap',gap:12}}>
        <div>
          <div className="pg-title">Cronograma / Gantt</div>
          <div className="pg-sub">
            Inicio: {fechaIniStr} · Fin: {fechaFinStr} · Hoy: día {Math.max(0, todayDayIdx)+1} de {range.totalDays}
          </div>
          <div className="pg-sub" style={{marginTop:2,fontSize:11.5}}>
            <strong style={{color:'var(--ts)'}}>{stats.total}</strong> partidas ·{' '}
            <span style={{color:'var(--red)'}}>{stats.atrasadas} atrasadas</span> ·{' '}
            <span style={{color:'var(--blue)'}}>{stats.enCurso} en curso</span> ·{' '}
            <span style={{color:'var(--tm)'}}>{stats.futuras} futuras</span>
            {stats.terminadas > 0 && <> · <span style={{color:'var(--green)'}}>{stats.terminadas} terminadas</span></>}
          </div>
        </div>
        <div style={{display:'flex',gap:6,alignItems:'center'}}>
          <span style={{fontSize:11,color:'var(--tm)'}}>Vista:</span>
          {['dia','semana','mes'].map(m => (
            <button
              key={m}
              className={'btn btn-xs ' + (zoom === m ? 'btn-amber' : 'btn-ghost')}
              onClick={() => setZoomMode(m)}
              title={`Cambiar zoom a ${m}`}
            >
              {m === 'dia' ? 'Día' : m === 'semana' ? 'Semana' : 'Mes'}
            </button>
          ))}
        </div>
      </div>

      {/* Filtros */}
      <div className="card card-p" style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center',padding:'10px 14px'}}>
        <div className="search-bar" style={{flex:'1 1 280px'}}>
          <JxIcon name="search" size={14} color="var(--tm)"/>
          <input placeholder="Buscar por código o nombre…" value={q} onChange={e=>setQ(e.target.value)}/>
        </div>
        <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'var(--ts)',cursor:'pointer'}}>
          <input type="checkbox" checked={soloActivas} onChange={e=>setSoloActivas(e.target.checked)}/>
          Solo activas
        </label>
        <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'var(--ts)',cursor:'pointer'}}>
          <input type="checkbox" checked={soloAtrasadas} onChange={e=>setSoloAtrasadas(e.target.checked)}/>
          Solo atrasadas
        </label>
        <div style={{marginLeft:'auto',display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
          <span className="badge b-green">Terminada</span>
          <span className="badge b-blue">En curso</span>
          <span className="badge b-amber">Sin avance</span>
          <span className="badge b-red">Atrasada</span>
          <span className="badge b-gray">Futura</span>
        </div>
      </div>

      {/* Gantt */}
      <div className="card" style={{overflow:'hidden',marginTop:12}}>
        {/* Header sticky */}
        <div style={{display:'flex',borderBottom:'1px solid var(--border)',background:'rgba(0,0,0,0.25)',position:'sticky',top:0,zIndex:5}}>
          <div style={{width:labelW,minWidth:labelW,padding:'8px 14px',fontSize:10.5,fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',color:'var(--tm)',borderRight:'1px solid var(--border)',flexShrink:0,display:'flex',alignItems:'center',gap:6}}>
            <JxIcon name="gantt" size={12} color="var(--amber)"/> Partida
          </div>
          <div style={{flex:1,overflow:'hidden'}}>
            <div style={{position:'relative',width:timelineW,height:46}}>
              {columns.map((c, i) => (
                <div key={i} style={{
                  position:'absolute',
                  left:c.left, width:c.width, height:'100%',
                  borderRight:'1px solid rgba(255,255,255,0.04)',
                  background: c.isToday ? 'rgba(242,183,5,0.10)' : (c.isWeekend ? 'rgba(0,0,0,0.18)' : 'transparent'),
                  display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
                  fontSize: zoom === 'mes' ? 11 : 9.5,
                  color: c.isToday ? 'var(--amber)' : 'var(--tm)',
                  fontWeight: c.isToday ? 700 : 500,
                }}>
                  {c.subLabel && <div style={{fontSize:9,color:'var(--tm)',opacity:0.85}}>{c.subLabel}</div>}
                  <div>{c.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Body scrollable */}
        <div ref={scrollRef} style={{display:'flex',maxHeight:'62vh',overflow:'auto',position:'relative'}}>
          {/* Sticky left col */}
          <div style={{width:labelW,minWidth:labelW,borderRight:'1px solid var(--border)',position:'sticky',left:0,zIndex:3,background:'var(--bg-c)'}}>
            <div style={{height:totalContentH,position:'relative'}}>
              {visibleRows.map((p, i) => {
                const idx = startIdx + i;
                return (
                  <div key={p.id} style={{
                    position:'absolute',top:idx*ROW_H,left:0,right:0,height:ROW_H,
                    padding:'0 12px',display:'flex',alignItems:'center',gap:6,
                    borderBottom:'1px solid rgba(255,255,255,0.03)',
                    background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
                    fontSize:11.5,color:'var(--ts)',whiteSpace:'nowrap',overflow:'hidden',
                  }}>
                    <span style={{fontSize:9.5,color:'var(--tm)',fontWeight:700,flexShrink:0,fontFamily:'ui-monospace,monospace'}}>{p.codigo_delfin || ''}</span>
                    <span style={{overflow:'hidden',textOverflow:'ellipsis'}}>{p.nombre_partida}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Timeline area */}
          <div style={{flex:1,position:'relative'}}>
            <div style={{width:timelineW,height:totalContentH,position:'relative'}}>
              {/* columnas (líneas verticales y resaltado weekend/today) */}
              {columns.map((c, i) => (
                <div key={i} style={{
                  position:'absolute',left:c.left,top:0,width:c.width,height:'100%',
                  borderRight:'1px solid rgba(255,255,255,0.03)',
                  background: c.isWeekend ? 'rgba(0,0,0,0.12)' : 'transparent',
                  pointerEvents:'none',
                }}/>
              ))}

              {/* línea HOY */}
              {todayPx >= 0 && (
                <div style={{
                  position:'absolute',left:todayPx,top:0,width:2,height:'100%',
                  background:'var(--red)',opacity:0.7,zIndex:2,pointerEvents:'none',
                }}/>
              )}

              {/* filas + barras (virtualizadas) */}
              {visibleRows.map((p, i) => {
                const idx = startIdx + i;
                const ini = parseDate(p.fecha_inicio_planificada);
                const fin = parseDate(p.fecha_fin_planificada);
                const iniDay = Math.max(0, diffDays(range.startMs, ini));
                const finDay = Math.min(range.totalDays, diffDays(range.startMs, fin) + 1);
                const left = dayToPx(iniDay);
                const right = dayToPx(finDay);
                const width = Math.max(3, right - left);
                const av = Math.max(0, Math.min(100, Number(p.porcentaje_avance || 0)));
                const estado = calcEstadoCron(p, todayMs);
                const col = ESTADO_CRON_COLOR[estado] || ESTADO_CRON_COLOR.normal;
                const dur = p.duracion_dias || (diffDays(ini, fin) + 1);
                const tooltip = `${p.codigo_delfin || ''} · ${p.nombre_partida || ''}\n${p.fecha_inicio_planificada} → ${p.fecha_fin_planificada}\nDuración: ${dur} días · Avance: ${av.toFixed(1)}%\nEstado: ${col.label}`;

                return (
                  <div key={p.id}
                    title={tooltip}
                    style={{
                      position:'absolute',top:idx*ROW_H,left:0,height:ROW_H,width:'100%',
                      borderBottom:'1px solid rgba(255,255,255,0.03)',
                      background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
                    }}>
                    <div style={{
                      position:'absolute',
                      left, width,
                      top:(ROW_H - 16)/2, height:16,
                      borderRadius:4,
                      background:'rgba(255,255,255,0.04)',
                      border:`1px solid ${col.bar}`,
                      boxShadow: estado === 'atrasada' ? '0 0 0 1px rgba(231,76,60,0.25)' : 'none',
                      overflow:'hidden',
                    }}>
                      {/* relleno avance */}
                      <div style={{
                        position:'absolute',left:0,top:0,bottom:0,
                        width: (av/100) * width,
                        background: col.fill,
                        opacity: estado === 'futura' ? 0.45 : 0.85,
                      }}/>
                      {/* etiqueta % si hay espacio */}
                      {width > 36 && (
                        <span style={{
                          position:'absolute',left:6,top:0,bottom:0,
                          display:'flex',alignItems:'center',
                          fontSize:9.5,fontWeight:700,
                          color: estado === 'terminada' || estado === 'en_curso' ? 'rgba(0,0,0,0.75)' : 'var(--ts)',
                          textShadow:'0 1px 1px rgba(0,0,0,0.35)',
                          pointerEvents:'none',
                          whiteSpace:'nowrap',
                        }}>{Math.round(av)}%</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Pie con stats */}
        <div style={{padding:'10px 16px',borderTop:'1px solid var(--border)',display:'flex',gap:14,fontSize:11.5,color:'var(--tm)',alignItems:'center',flexWrap:'wrap'}}>
          <span><strong style={{color:'var(--ts)'}}>{filtered.length}</strong> de {stats.total} partidas mostradas</span>
          <span>·</span>
          <span><span style={{color:'var(--red)'}}>{stats.atrasadas}</span> atrasadas</span>
          <span style={{marginLeft:'auto',color:'var(--tm)'}}>Línea roja vertical = hoy</span>
        </div>
      </div>
    </div>
  );
}

// ─── AVANCE DE OBRA PAGE ──────────────────────────────────
function AvancePage({ showToast }) {
  const obraId = useObraActiva();
  const { data: partidas } = window.__hooks.usePartidas(obraId);
  const { data: registros, loading, create: createAvance, update: updateAvance, refresh } = window.__hooks.useAvanceObra(obraId);
  const { data: obras } = window.__hooks.useObras();
  const obraActiva = obras?.find(o => o.id === obraId);
  const auth = window.__useAuth ? window.__useAuth() : null;
  const isAdmin = auth?.profile?.rol === 'admin';

  const [modal, setModal] = uSO(false);
  const [form, setForm] = uSO({});
  const [editingId, setEditingId] = uSO(null);

  const openEditAvance = (r) => {
    setForm({
      fecha: r.fecha || '',
      partida_id: r.partida_id || '',
      metrado_ejecutado: r.metrado_ejecutado ?? '',
      porcentaje_avance_reportado: r.porcentaje_avance_reportado ?? '',
      personal_asignado: r.personal_asignado ?? '',
      observaciones: r.observaciones || '',
    });
    setEditingId(r.id);
    setModal(true);
  };

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
      if (editingId) {
        // Solo editamos campos seguros (no recalculamos avance de partida)
        const oldData = registros.find(r => r.id === editingId);
        const newFields = {
          porcentaje_avance_reportado: parseFloat(form.porcentaje_avance_reportado) || null,
          personal_asignado: parseInt(form.personal_asignado) || null,
          observaciones: form.observaciones || null,
        };
        await updateAvance(editingId, newFields);
        try { await window.__logAudit?.({ action:'update', table:'avance_obra', recordId:editingId, oldData, newData:newFields, reason:'Edición de campos seguros (observaciones / % reportado / personal)' }); } catch(e) {}
        showToast('Avance actualizado', 'green');
        setModal(false); setForm({}); setEditingId(null);
        return;
      }
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
    setEditingId(null);
    setModal(true);
  };

  if (!obraId) return <SinObraEmpty icon="hardHat"/>;
  if (loading) return <div className="page-wrap"><div className="empty-state"><JxIcon name="hardHat" size={32} color="var(--tm)"/><p>Cargando avance…</p></div></div>;

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
            {isAdmin && <th style={{textAlign:'center'}}>Acciones</th>}
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
                  {isAdmin && <td style={{textAlign:'center'}}>
                    <button className="btn btn-ghost btn-xs" title="Editar campos seguros (observaciones, % reportado, personal)" onClick={()=>openEditAvance(r)}>
                      <JxIcon name="edit" size={11}/>
                    </button>
                  </td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {modal && <Modal title={editingId ? 'Editar Avance (campos seguros)' : 'Registrar Avance de Obra'} icon="hardHat" onClose={()=>{setModal(false); setEditingId(null); setForm({});}}>
        {editingId && <div style={{padding:'10px 12px',background:'rgba(242,183,5,0.08)',border:'1px solid rgba(242,183,5,0.3)',borderRadius:6,fontSize:11.5,color:'var(--tm)',marginBottom:14}}>
          Por integridad de datos, el <strong>metrado ejecutado</strong>, <strong>fecha</strong> y <strong>partida</strong> son inmutables (afectan el % avance de la partida). Solo se pueden editar observaciones, % reportado y personal asignado.
        </div>}
        <div className="g2">
          <div><label className="flabel">Fecha</label><input className="fi" type="date" value={form.fecha||''} disabled={!!editingId} onChange={e=>setForm({...form, fecha:e.target.value})}/></div>
          <div><label className="flabel">Semana (auto)</label><div className="fi" style={{color:'var(--amber)'}}>{calcSemana(form.fecha)}</div></div>
          <div style={{gridColumn:'1/-1'}}><label className="flabel">Partida ejecutada *</label>
            <select className="fi" value={form.partida_id||''} disabled={!!editingId} onChange={e=>setForm({...form, partida_id:e.target.value})}>
              <option value="">Selecciona...</option>
              {partidas.map(p => <option key={p.id} value={p.id}>{p.codigo_delfin ? `${p.codigo_delfin} — ` : ''}{p.nombre_partida} ({p.unidad})</option>)}
            </select>
          </div>
          <div><label className="flabel">Metrado ejecutado *</label><input className="fi" type="number" step="0.01" min="0" value={form.metrado_ejecutado||''} disabled={!!editingId} onChange={e=>setForm({...form, metrado_ejecutado:e.target.value})}/></div>
          <div><label className="flabel">% Avance reportado</label><input className="fi" type="number" min="0" max="100" step="1" placeholder="0-100" value={form.porcentaje_avance_reportado||''} onChange={e=>setForm({...form, porcentaje_avance_reportado:e.target.value})}/></div>
          <div><label className="flabel">Personal asignado</label><input className="fi" type="number" min="0" value={form.personal_asignado||''} onChange={e=>setForm({...form, personal_asignado:e.target.value})}/></div>
        </div>
        <div style={{marginTop:14}}><label className="flabel">Observaciones</label><textarea className="fi" placeholder="Descripción del avance, materiales usados, inconvenientes..." value={form.observaciones||''} onChange={e=>setForm({...form, observaciones:e.target.value})}/></div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={()=>{setModal(false); setEditingId(null); setForm({});}}>Cancelar</button>
          <button className="btn btn-amber" onClick={handleSubmit}><JxIcon name="check" size={13}/>{editingId ? 'Guardar Cambios' : 'Guardar Avance'}</button>
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

  if (!obraId) return <SinObraEmpty icon="compare"/>;
  if (loading) return <div className="page-wrap"><div className="empty-state"><JxIcon name="compare" size={32} color="var(--tm)"/><p>Cargando comparativo…</p></div></div>;

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
