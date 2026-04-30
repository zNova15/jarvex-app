import React from "react";
const { useState: uS, useMemo: uM, useEffect: uE } = React;

const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtSk = (n) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1e6) return 'S/ ' + (v/1e6).toFixed(2) + 'M';
  if (Math.abs(v) >= 1e3) return 'S/ ' + (v/1e3).toFixed(0) + 'K';
  return 'S/ ' + v.toFixed(0);
};

const PLAN_DEFAULT = [
  { tipo: 'cambio_aceite', label: 'Cambio aceite motor', cada_hm: 250 },
  { tipo: 'filtros', label: 'Cambio filtros (aire/aceite/comb.)', cada_hm: 500 },
  { tipo: 'hidraulico', label: 'Revisión sistema hidráulico', cada_hm: 1000 },
  { tipo: 'transmision', label: 'Cambio aceite transmisión', cada_hm: 2000 },
  { tipo: 'overhaul', label: 'Overhaul mayor', cada_hm: 5000 },
];

// Local Modal (mismo patrón que jx-almacen.jsx)
function Modal({ title, icon, onClose, children, wide }) {
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { maxWidth: 820 } : {}}>
        <div className="modal-hd">
          <div className="modal-hd-left">
            {icon && <div style={{ width:32,height:32,borderRadius:8,background:'rgba(242,183,5,.12)',display:'flex',alignItems:'center',justifyContent:'center' }}><JxIcon name={icon} size={15} color="var(--amber)" /></div>}
            <span>{title}</span>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-icon"><JxIcon name="x" size={15} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Devuelve estado según faltantes
function calcEstado(faltantes, cada_hm) {
  const umbral = cada_hm * 0.10;
  if (faltantes <= 0) return { v:'rojo', cls:'b-red', lbl:'Vencido' };
  if (faltantes <= umbral) return { v:'ambar', cls:'b-amber', lbl:'Por vencer' };
  return { v:'verde', cls:'b-green', lbl:'OK' };
}

function MantenimientoProgramadoPage({ showToast }) {
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id ?? 'offline';
  const { data: activos } = window.__hooks.useActivosPesados();
  const { data: obras } = window.__hooks.useObras();
  const { data: hms } = window.__hooks.useHorasMaquina();

  // Para forzar refresh tras add a mantenimientos
  const [tickMant, setTickMant] = uS(0);
  uE(() => {
    const handler = (ev) => {
      if (ev?.detail?.tabla === 'mantenimientos_maquinaria') setTickMant(t => t+1);
    };
    window.addEventListener('jx_data_changed', handler);
    return () => window.removeEventListener('jx_data_changed', handler);
  }, []);

  // Por activo: HM acumuladas y último mantenimiento por tipo
  const [resumen, setResumen] = uS({}); // { activoId: { hm: number, ultimos: { tipo: {fecha, hm_actuales, costo_total} }, mantenimientos: [...] } }
  uE(() => {
    if (!activos) return;
    let cancelled = false;
    (async () => {
      const out = {};
      try {
        const [allHm, allMt] = await Promise.all([
          window.__db.horas_maquina.filter(x=>!x.deleted_at).toArray(),
          window.__db.mantenimientos_maquinaria.filter(x=>!x.deleted_at).toArray(),
        ]);
        const hmByAct = {};
        for (const h of allHm) {
          const k = h.activo_id; if (!k) continue;
          (hmByAct[k] = hmByAct[k] || []).push(h);
        }
        const mtByAct = {};
        for (const m of allMt) {
          const k = m.activo_id; if (!k) continue;
          (mtByAct[k] = mtByAct[k] || []).push(m);
        }
        for (const a of activos) {
          if (a.deleted_at) continue;
          const hmRows = hmByAct[a.id] || [];
          const mtRows = mtByAct[a.id] || [];
          const hmAcum = hmRows.reduce((s,h)=>s+Number(h.horas_trabajadas||h.horas||0),0);
          const ultimos = {};
          for (const m of mtRows) {
            const t = m.tipo;
            if (!t) continue;
            const prev = ultimos[t];
            if (!prev || (m.hm_actuales||0) > (prev.hm_actuales||0) || ((m.hm_actuales||0) === (prev.hm_actuales||0) && (m.fecha||'') > (prev.fecha||''))) {
              ultimos[t] = m;
            }
          }
          out[a.id] = { hmAcum, ultimos, mantenimientos: mtRows };
        }
      } catch { /* deja resumen vacío */ }
      if (!cancelled) setResumen(out);
    })();
    return () => { cancelled = true; };
  }, [activos, hms, tickMant]);

  // Cálculo del estado peor de cada activo (rojo>ambar>verde) sobre el plan default
  const filaPorActivo = (a) => {
    const r = resumen[a.id] || { hmAcum:0, ultimos:{} };
    const filas = PLAN_DEFAULT.map(p => {
      const ult = r.ultimos[p.tipo];
      const ultHm = ult ? Number(ult.hm_actuales||0) : 0;
      const proximo = ult ? ultHm + p.cada_hm : p.cada_hm; // si nunca → primer ciclo a cada_hm desde 0
      const faltantes = +(proximo - r.hmAcum).toFixed(1);
      const est = calcEstado(faltantes, p.cada_hm);
      return { ...p, ult, ultHm, proximo, faltantes, estado: est };
    });
    // peor estado
    let peor = 'verde';
    for (const f of filas) {
      if (f.estado.v === 'rojo') { peor = 'rojo'; break; }
      if (f.estado.v === 'ambar') peor = 'ambar';
    }
    // proximo más cercano (faltantes mínimo positivo o 0)
    const sortedAsc = [...filas].sort((a,b) => a.faltantes - b.faltantes);
    const proxMasCercano = sortedAsc[0];
    return { hmAcum: r.hmAcum, filas, peor, proxMasCercano };
  };

  // Filtros
  const [fObra, setFObra] = uS('');
  const [fEstado, setFEstado] = uS('todos'); // todos | atencion

  const activosFiltrados = uM(() => {
    if (!activos) return [];
    return activos.filter(a => !a.deleted_at).filter(a => {
      if (fObra && a.obra_actual_id !== fObra) return false;
      if (fEstado === 'atencion') {
        const f = filaPorActivo(a);
        return f.peor === 'rojo' || f.peor === 'ambar';
      }
      return true;
    });
  }, [activos, fObra, fEstado, resumen]);

  // KPIs resumen
  const kpis = uM(() => {
    let req = 0, prox100 = 0, costoMes = 0;
    if (!activos) return { req, prox100, costoMes };
    const ahora = new Date();
    const mesActual = ahora.toISOString().slice(0,7);
    for (const a of activos) {
      if (a.deleted_at) continue;
      const f = filaPorActivo(a);
      if (f.peor === 'rojo' || f.peor === 'ambar') req++;
      for (const fila of f.filas) {
        if (fila.faltantes > 0 && fila.faltantes <= 100) prox100++;
      }
      const r = resumen[a.id];
      if (r) {
        for (const m of (r.mantenimientos||[])) {
          if ((m.fecha||'').startsWith(mesActual)) costoMes += Number(m.costo_total||0);
        }
      }
    }
    return { req, prox100, costoMes };
  }, [activos, resumen]);

  // Modal detalle
  const [detalle, setDetalle] = uS(null); // activo seleccionado
  // Modal registrar
  const [regModal, setRegModal] = uS(null); // { activo, plan }
  const [formReg, setFormReg] = uS({});

  const openRegistrar = (activo, plan) => {
    const r = resumen[activo.id] || { hmAcum: 0 };
    setRegModal({ activo, plan });
    setFormReg({
      fecha: new Date().toISOString().slice(0,10),
      hm_actuales: r.hmAcum,
      costo_repuestos: '',
      costo_mano_obra: '',
      descripcion: plan.label,
      taller: '',
      mecanico: '',
      observaciones: '',
    });
  };

  const guardarMant = async () => {
    if (!regModal) return;
    const { activo, plan } = regModal;
    if (!formReg.descripcion?.trim()) { showToast('Descripción requerida', 'red'); return; }
    const repuestos = parseFloat(formReg.costo_repuestos) || 0;
    const mo = parseFloat(formReg.costo_mano_obra) || 0;
    const now = new Date().toISOString();
    const id = window.__newId();
    try {
      await window.__db.mantenimientos_maquinaria.add({
        id,
        activo_id: activo.id,
        fecha: formReg.fecha,
        tipo: plan.tipo,
        hm_actuales: parseFloat(formReg.hm_actuales) || 0,
        descripcion: formReg.descripcion.trim(),
        costo_repuestos: repuestos,
        costo_mano_obra: mo,
        costo_total: +(repuestos + mo).toFixed(2),
        costo: +(repuestos + mo).toFixed(2),
        taller: formReg.taller || null,
        mecanico: formReg.mecanico || null,
        observaciones: formReg.observaciones || null,
        deleted_at: null,
        created_by: userId, updated_by: userId,
        created_at: now, updated_at: now,
        version: 1, sync_status: 'pending_create', last_synced_at: null,
        idempotency_key: `${userId}_mm_${id}`,
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'mantenimientos_maquinaria' } })); } catch {}
      showToast(`Mantenimiento "${plan.label}" registrado`, 'green');
      setRegModal(null); setFormReg({});
    } catch (e) {
      showToast('Error: '+e.message, 'red');
    }
  };

  const lookupOb = (id) => obras?.find(o => o.id === id);

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Mantenimiento Programado</div>
          <div className="pg-sub">Plan preventivo por horas-máquina · {(activos||[]).filter(a=>!a.deleted_at).length} equipos</div>
        </div>
      </div>

      {/* KPIs */}
      <div className="g3" style={{ marginBottom:14 }}>
        <div className="card card-p" style={{ borderLeft:'3px solid var(--red)' }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase', letterSpacing:.5 }}>Requieren atención</div>
          <div style={{ fontSize:26, fontWeight:700, color:'var(--red)' }}>{kpis.req}</div>
          <div style={{ fontSize:11, color:'var(--tm)' }}>activos con mantto vencido o por vencer</div>
        </div>
        <div className="card card-p" style={{ borderLeft:'3px solid var(--amber)' }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase', letterSpacing:.5 }}>Próximos 100 HM</div>
          <div style={{ fontSize:26, fontWeight:700, color:'var(--amber)' }}>{kpis.prox100}</div>
          <div style={{ fontSize:11, color:'var(--tm)' }}>mantenimientos a programar pronto</div>
        </div>
        <div className="card card-p" style={{ borderLeft:'3px solid var(--blue)' }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase', letterSpacing:.5 }}>Costo del mes</div>
          <div style={{ fontSize:26, fontWeight:700, color:'var(--blue)' }}>{fmtSk(kpis.costoMes)}</div>
          <div style={{ fontSize:11, color:'var(--tm)' }}>gastado en mantenimientos</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="card card-p" style={{ marginBottom:14, display:'flex', gap:12, flexWrap:'wrap', alignItems:'flex-end' }}>
        <div style={{ minWidth:220 }}>
          <label className="flabel">Obra</label>
          <select className="fi" value={fObra} onChange={e=>setFObra(e.target.value)}>
            <option value="">Todas las obras</option>
            {(obras||[]).filter(o=>!o.deleted_at).map(o => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}
          </select>
        </div>
        <div style={{ minWidth:200 }}>
          <label className="flabel">Estado</label>
          <select className="fi" value={fEstado} onChange={e=>setFEstado(e.target.value)}>
            <option value="todos">Todos</option>
            <option value="atencion">Solo requieren atención</option>
          </select>
        </div>
        <div style={{ marginLeft:'auto', fontSize:11, color:'var(--tm)' }}>
          {activosFiltrados.length} de {(activos||[]).filter(a=>!a.deleted_at).length} equipos
        </div>
      </div>

      {/* Plan default */}
      <div className="card card-p" style={{ marginBottom:14 }}>
        <div style={{ fontSize:13, fontWeight:600, marginBottom:8, color:'var(--amber)' }}>
          <JxIcon name="tool" size={13}/> Plan de mantenimiento default
        </div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          {PLAN_DEFAULT.map(p => (
            <div key={p.tipo} style={{ background:'var(--bg-s)', borderRadius:6, padding:'6px 10px', fontSize:11 }}>
              <strong>{p.label}</strong> · cada <span style={{ color:'var(--amber)', fontWeight:700 }}>{p.cada_hm} HM</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tabla activos */}
      {activosFiltrados.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="tool" size={40} color="var(--tm)"/>
          <p>No hay activos que cumplan los filtros.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <div style={{ overflowX:'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Placa</th><th>Equipo</th><th>Marca / Modelo</th>
                <th style={{ textAlign:'right' }}>HM acum.</th>
                <th style={{ textAlign:'right' }}>Últ. cambio aceite</th>
                <th style={{ textAlign:'right' }}>HM faltantes</th>
                <th style={{ textAlign:'center' }}>Estado</th>
                <th style={{ textAlign:'center' }}>Acciones</th>
              </tr></thead>
              <tbody>
                {activosFiltrados.map(a => {
                  const f = filaPorActivo(a);
                  const aceite = f.filas.find(x => x.tipo === 'cambio_aceite');
                  const peorEst = f.peor === 'rojo' ? { cls:'b-red', lbl:'Crítico' } :
                                  f.peor === 'ambar' ? { cls:'b-amber', lbl:'Por vencer' } :
                                  { cls:'b-green', lbl:'OK' };
                  return (
                    <tr key={a.id} style={{ cursor:'pointer' }} onClick={()=>setDetalle(a)}>
                      <td className="col-m" style={{ fontFamily:'monospace' }}>{a.placa || '—'}</td>
                      <td className="col-p"><strong>{a.nombre}</strong></td>
                      <td>{[a.marca, a.modelo].filter(Boolean).join(' ') || '—'}{a.anio && <span style={{ color:'var(--tm)' }}> · {a.anio}</span>}</td>
                      <td style={{ textAlign:'right', fontWeight:600 }}>{(f.hmAcum||0).toFixed(1)}</td>
                      <td style={{ textAlign:'right' }}>{aceite?.ult ? (aceite.ultHm).toFixed(0) + ' HM' : <span style={{ color:'var(--tm)' }}>nunca</span>}</td>
                      <td style={{ textAlign:'right', fontWeight:700, color: aceite?.estado.v==='rojo'?'var(--red)':aceite?.estado.v==='ambar'?'var(--amber)':'var(--green)' }}>
                        {aceite ? (aceite.faltantes <= 0 ? `${Math.abs(aceite.faltantes).toFixed(0)} HM vencido` : `${aceite.faltantes.toFixed(0)} HM`) : '—'}
                      </td>
                      <td style={{ textAlign:'center' }}>
                        <span className={`badge ${peorEst.cls}`}>{peorEst.lbl}</span>
                      </td>
                      <td style={{ textAlign:'center' }} onClick={e=>e.stopPropagation()}>
                        <button className="btn btn-amber btn-xs" onClick={()=>setDetalle(a)}>
                          <JxIcon name="edit" size={11}/>Ver plan
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal detalle */}
      {detalle && (() => {
        const f = filaPorActivo(detalle);
        return (
          <Modal title={`Plan de mantenimiento — ${detalle.nombre}`} icon="tool" onClose={()=>setDetalle(null)} wide>
            <div style={{ marginBottom:12, display:'flex', gap:14, flexWrap:'wrap', fontSize:12 }}>
              <div><span style={{ color:'var(--tm)' }}>Placa:</span> <strong>{detalle.placa || '—'}</strong></div>
              <div><span style={{ color:'var(--tm)' }}>Marca/Modelo:</span> <strong>{[detalle.marca, detalle.modelo].filter(Boolean).join(' ') || '—'}</strong></div>
              <div><span style={{ color:'var(--tm)' }}>HM acumuladas:</span> <strong style={{ color:'var(--amber)' }}>{(f.hmAcum||0).toFixed(1)}</strong></div>
              <div><span style={{ color:'var(--tm)' }}>Obra:</span> <strong>{lookupOb(detalle.obra_actual_id)?.nombre_obra || '—'}</strong></div>
            </div>

            <div style={{ overflowX:'auto' }}>
              <table className="tbl">
                <thead><tr>
                  <th>Mantenimiento</th>
                  <th style={{ textAlign:'right' }}>Cada</th>
                  <th style={{ textAlign:'right' }}>HM acum.</th>
                  <th style={{ textAlign:'right' }}>Último (HM)</th>
                  <th style={{ textAlign:'right' }}>Próximo (HM)</th>
                  <th style={{ textAlign:'right' }}>Faltantes</th>
                  <th style={{ textAlign:'center' }}>Estado</th>
                  <th style={{ textAlign:'center' }}>Acción</th>
                </tr></thead>
                <tbody>
                  {f.filas.map(p => (
                    <tr key={p.tipo}>
                      <td><strong>{p.label}</strong>{p.ult?.fecha && <div style={{ fontSize:10, color:'var(--tm)' }}>últ: {p.ult.fecha}{p.ult.costo_total ? ' · '+fmtS(p.ult.costo_total) : ''}</div>}</td>
                      <td style={{ textAlign:'right' }}>{p.cada_hm} HM</td>
                      <td style={{ textAlign:'right' }}>{(f.hmAcum||0).toFixed(0)}</td>
                      <td style={{ textAlign:'right' }}>{p.ult ? p.ultHm.toFixed(0) : <span style={{ color:'var(--tm)' }}>nunca</span>}</td>
                      <td style={{ textAlign:'right' }}>{p.proximo.toFixed(0)}</td>
                      <td style={{ textAlign:'right', fontWeight:700, color: p.estado.v==='rojo'?'var(--red)':p.estado.v==='ambar'?'var(--amber)':'var(--green)' }}>
                        {p.faltantes <= 0 ? `−${Math.abs(p.faltantes).toFixed(0)}` : p.faltantes.toFixed(0)}
                      </td>
                      <td style={{ textAlign:'center' }}><span className={`badge ${p.estado.cls}`}>{p.estado.lbl}</span></td>
                      <td style={{ textAlign:'center' }}>
                        <button className="btn btn-amber btn-xs" onClick={()=>openRegistrar(detalle, p)}>
                          <JxIcon name="check" size={11}/>Registrar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={()=>setDetalle(null)}>Cerrar</button>
            </div>
          </Modal>
        );
      })()}

      {/* Modal registrar mantenimiento */}
      {regModal && (
        <Modal title={`Registrar — ${regModal.plan.label}`} icon="plus" onClose={()=>{setRegModal(null); setFormReg({});}}>
          <div style={{ marginBottom:10, padding:10, background:'var(--bg-s)', borderRadius:6, fontSize:12 }}>
            <strong>{regModal.activo.nombre}</strong> · {regModal.activo.placa || 's/p'} · cada <strong style={{ color:'var(--amber)' }}>{regModal.plan.cada_hm} HM</strong>
          </div>
          <div className="g2">
            <div><label className="flabel">Fecha *</label><input className="fi" type="date" value={formReg.fecha||''} onChange={e=>setFormReg({...formReg, fecha:e.target.value})}/></div>
            <div><label className="flabel">HM actuales *</label><input className="fi" type="number" step="0.1" value={formReg.hm_actuales||''} onChange={e=>setFormReg({...formReg, hm_actuales:e.target.value})}/></div>
            <div style={{ gridColumn:'1/-1' }}><label className="flabel">Descripción *</label><input className="fi" value={formReg.descripcion||''} onChange={e=>setFormReg({...formReg, descripcion:e.target.value})}/></div>
            <div><label className="flabel">Costo repuestos</label><input className="fi" type="number" min="0" step="0.01" value={formReg.costo_repuestos||''} onChange={e=>setFormReg({...formReg, costo_repuestos:e.target.value})}/></div>
            <div><label className="flabel">Costo mano de obra</label><input className="fi" type="number" min="0" step="0.01" value={formReg.costo_mano_obra||''} onChange={e=>setFormReg({...formReg, costo_mano_obra:e.target.value})}/></div>
            <div><label className="flabel">Total</label><input className="fi" disabled value={fmtS((parseFloat(formReg.costo_repuestos)||0)+(parseFloat(formReg.costo_mano_obra)||0))}/></div>
            <div><label className="flabel">Taller</label><input className="fi" value={formReg.taller||''} onChange={e=>setFormReg({...formReg, taller:e.target.value})}/></div>
            <div><label className="flabel">Mecánico</label><input className="fi" value={formReg.mecanico||''} onChange={e=>setFormReg({...formReg, mecanico:e.target.value})}/></div>
            <div style={{ gridColumn:'1/-1' }}><label className="flabel">Observaciones</label><textarea className="fi" rows={2} value={formReg.observaciones||''} onChange={e=>setFormReg({...formReg, observaciones:e.target.value})}/></div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>{setRegModal(null); setFormReg({});}}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardarMant}><JxIcon name="check" size={13}/>Registrar mantenimiento</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

window.MantenimientoProgramadoPage = MantenimientoProgramadoPage;
