import React from "react";
const { useState: uSG, useMemo: uMG, useEffect: uEG } = React;

const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtSk = (n) => {
  const v = Number(n || 0);
  if (v >= 1000000) return 'S/ ' + (v/1000000).toFixed(1) + 'M';
  if (v >= 1000)    return 'S/ ' + (v/1000).toFixed(0) + 'K';
  return fmtS(v);
};

function useObraActiva() {
  const [obraId, setObraId] = uSG(null);
  uEG(() => {
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

// ─── INSUMOS POR PARTIDA ──────────────────────────────────
// Comparativa Presupuestado (desde APU/Delphin → tabla insumos_partida)
// vs Real (desde movimientos de materiales con partida_id asignado).
function InsumosPage({ showToast }) {
  const obraId = useObraActiva();
  const { data: partidas } = window.__hooks.usePartidas(obraId);
  const { data: materiales } = window.__hooks.useMateriales(obraId);
  const { data: movimientos } = window.__hooks.useMovimientosMateriales(obraId);

  const [partidaSel, setPartidaSel] = uSG(null);
  const [insumosPres, setInsumosPres] = uSG([]);

  uEG(() => {
    if (!partidaSel && partidas?.length > 0) setPartidaSel(partidas[0].id);
  }, [partidas]);

  // Cargar insumos presupuestados desde la tabla insumos_partida (importados desde APU)
  uEG(() => {
    let cancelled = false;
    if (!partidaSel) { setInsumosPres([]); return; }
    (async () => {
      try {
        const rows = await window.__db.insumos_partida
          .where('partida_id').equals(partidaSel)
          .filter(r => !r.deleted_at)
          .toArray();
        if (!cancelled) setInsumosPres(rows);
      } catch { if (!cancelled) setInsumosPres([]); }
    })();
    return () => { cancelled = true; };
  }, [partidaSel]);

  const partida = partidas?.find(p => p.id === partidaSel);

  // Real consumido desde movimientos
  const realPorMaterial = uMG(() => {
    if (!partida || !movimientos) return new Map();
    const movs = movimientos.filter(m => m.partida_id === partida.id && m.tipo_movimiento === 'salida');
    const agrupado = new Map();
    movs.forEach(m => {
      const key = m.material_id;
      const cur = agrupado.get(key) || {
        material_id: m.material_id,
        cantidad_real: 0,
        costo_real: 0,
      };
      cur.cantidad_real += Number(m.cantidad) || 0;
      cur.costo_real += (Number(m.cantidad) || 0) * (Number(m.precio_unitario_real) || 0);
      agrupado.set(key, cur);
    });
    return agrupado;
  }, [partida, movimientos]);

  // Filas combinadas: 1 fila por insumo presupuestado + 1 fila por consumido sin presupuesto
  const filas = uMG(() => {
    const rows = [];
    // Map para emparejar: clave = código de insumo (ej: "M01")
    const realPorCodigo = new Map();
    realPorMaterial.forEach((r, matId) => {
      const mat = materiales?.find(x => x.id === matId);
      const codigo = mat?.codigo_s10 || mat?.id;
      realPorCodigo.set(codigo, { ...r, mat });
    });

    insumosPres.forEach(ins => {
      const matchReal = realPorCodigo.get(ins.insumo_codigo);
      const cantPres = Number(ins.cantidad_presupuestada) || 0;
      const precPres = Number(ins.precio_presupuestado) || 0;
      const costoPres = cantPres * precPres;
      const cantReal = matchReal?.cantidad_real || 0;
      const costoReal = matchReal?.costo_real || 0;
      rows.push({
        codigo: ins.insumo_codigo,
        nombre: ins.nombre_insumo,
        tipo: ins.tipo_insumo,
        unidad: ins.unidad,
        cantPres, precPres, costoPres,
        cantReal, costoReal,
        desv: costoReal - costoPres,
        existeEnAlmacen: !!matchReal?.mat,
      });
      if (matchReal) realPorCodigo.delete(ins.insumo_codigo);
    });

    // Materiales consumidos que NO estaban en el APU
    realPorCodigo.forEach((r, codigo) => {
      rows.push({
        codigo: codigo || '—',
        nombre: r.mat?.nombre_material || '(material)',
        tipo: 'material',
        unidad: r.mat?.unidad || '',
        cantPres: 0, precPres: 0, costoPres: 0,
        cantReal: r.cantidad_real, costoReal: r.costo_real,
        desv: r.costo_real,
        sinPresupuestar: true,
        existeEnAlmacen: true,
      });
    });

    return rows;
  }, [insumosPres, realPorMaterial, materiales]);

  if (!obraId) return <div className="page-wrap"><div className="empty-state"><JxIcon name="layers" size={32} color="var(--tm)"/><p>Cargando insumos…</p></div></div>;

  if (!partidas?.length) {
    return (
      <div className="page-wrap">
        <div className="pg-hd"><div><div className="pg-title">Insumos por Partida</div><div className="pg-sub">Recursos presupuestados vs consumidos</div></div></div>
        <div className="card card-p empty-state"><JxIcon name="layers" size={40} color="var(--tm)"/><p>No hay partidas. Crea partidas primero en el módulo "Partidas" o impórtalas desde Delphin.</p></div>
      </div>
    );
  }

  const totalPres = filas.reduce((s,r) => s + r.costoPres, 0);
  const totalReal = filas.reduce((s,r) => s + r.costoReal, 0);
  const presupuesto = Number(partida?.costo_total_presupuestado || 0);
  const desv = totalReal - totalPres;
  const desvPct = totalPres > 0 ? (desv / totalPres * 100) : 0;
  const sinAPU = insumosPres.length === 0;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Insumos por Partida</div>
          <div className="pg-sub">Comparativa <strong>presupuestado</strong> (APU/Delphin) vs <strong>real</strong> (movimientos)</div>
        </div>
        <select className="fi" style={{width:'auto', maxWidth:380}} value={partidaSel||''} onChange={e=>setPartidaSel(e.target.value)}>
          {partidas.map(p => <option key={p.id} value={p.id}>{p.codigo_delfin ? p.codigo_delfin + ' — ' : ''}{p.nombre_partida}</option>)}
        </select>
      </div>

      {partida && (
      <>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
          <div className="card card-p"><div style={{fontSize:11,color:'var(--tm)'}}>Costo Presupuestado (APU)</div><div style={{fontSize:22,fontWeight:800,color:'var(--blue)',margin:'6px 0 2px'}}>{fmtSk(totalPres || presupuesto)}</div><div style={{fontSize:11,color:'var(--tm)'}}>{insumosPres.length} insumos</div></div>
          <div className="card card-p"><div style={{fontSize:11,color:'var(--tm)'}}>Costo Real (movs)</div><div style={{fontSize:22,fontWeight:800,color:'var(--amber)',margin:'6px 0 2px'}}>{fmtSk(totalReal)}</div><div style={{fontSize:11,color:'var(--tm)'}}>{realPorMaterial.size} materiales consumidos</div></div>
          <div className="card card-p"><div style={{fontSize:11,color:'var(--tm)'}}>Desviación</div><div style={{fontSize:22,fontWeight:800,color:desv>0?'var(--red)':'var(--green)',margin:'6px 0 2px'}}>{desv>0?'+':''}{fmtSk(desv)}</div><div style={{fontSize:11,color:'var(--tm)'}}>{totalPres>0 ? `${desvPct.toFixed(1)}%` : '—'}</div></div>
          <div className="card card-p"><div style={{fontSize:11,color:'var(--tm)'}}>% Avance</div><div style={{fontSize:22,fontWeight:800,color:'var(--green)',margin:'6px 0 2px'}}>{Number(partida.porcentaje_avance||0).toFixed(0)}%</div></div>
        </div>

        {sinAPU && (
          <div className="card card-p" style={{ background:'rgba(52,152,219,0.06)', border:'1px solid rgba(52,152,219,0.25)', marginBottom:14, fontSize:12.5, color:'var(--ts)' }}>
            <strong style={{ color:'var(--blue)' }}>ℹ Esta partida no tiene insumos presupuestados.</strong>{' '}
            Importa el APU desde el módulo <strong>Importar → Delphin</strong> (Análisis de Precios Unitarios) para ver la comparativa presupuesto vs real, o registra movimientos de materiales asociándolos a esta partida para ver consumo real.
          </div>
        )}

        {filas.length === 0 ? (
          <div className="card card-p empty-state"><JxIcon name="layers" size={40} color="var(--tm)"/><p>No hay insumos presupuestados ni movimientos para esta partida.</p></div>
        ) : (
        <div className="card" style={{overflow:'hidden'}}>
          <table className="tbl">
            <thead><tr>
              <th>Código</th>
              <th>Insumo</th>
              <th>Tipo</th>
              <th>Unidad</th>
              <th style={{textAlign:'right'}}>Cant. Pres.</th>
              <th style={{textAlign:'right'}}>Cant. Real</th>
              <th style={{textAlign:'right'}}>Costo Pres.</th>
              <th style={{textAlign:'right'}}>Costo Real</th>
              <th style={{textAlign:'right'}}>Desv.</th>
            </tr></thead>
            <tbody>
              {filas.map((r, i) => (
                <tr key={(r.codigo || '_') + '_' + i} style={r.sinPresupuestar ? { background:'rgba(255,179,0,0.06)' } : null}>
                  <td className="col-m" style={{ fontFamily:'monospace', fontSize:11 }}>{r.codigo}</td>
                  <td className="col-p">
                    {r.nombre}
                    {r.sinPresupuestar && <span className="badge b-amber" style={{ marginLeft:6, fontSize:9 }}>Sin APU</span>}
                  </td>
                  <td className="col-m" style={{ textTransform:'capitalize' }}>{r.tipo || '—'}</td>
                  <td className="col-m">{r.unidad || '—'}</td>
                  <td style={{textAlign:'right'}} className="col-num">{r.cantPres ? r.cantPres.toLocaleString('es-PE') : '—'}</td>
                  <td style={{textAlign:'right'}} className="col-num">{r.cantReal ? r.cantReal.toLocaleString('es-PE') : '—'}</td>
                  <td style={{textAlign:'right'}} className="col-num">{r.costoPres ? fmtS(r.costoPres) : '—'}</td>
                  <td style={{textAlign:'right'}} className="col-num">{r.costoReal ? fmtS(r.costoReal) : '—'}</td>
                  <td style={{textAlign:'right', color: r.desv>0?'var(--red)':r.desv<0?'var(--green)':'var(--tm)'}} className="col-num">
                    {r.desv === 0 ? '—' : (r.desv > 0 ? '+' : '') + fmtS(r.desv)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6} style={{padding:'12px 14px',fontWeight:700,color:'var(--ts)',background:'rgba(0,0,0,0.15)'}}>TOTAL</td>
                <td style={{textAlign:'right',padding:'12px 14px',fontWeight:700,color:'var(--blue)',background:'rgba(0,0,0,0.15)'}} className="col-num">{fmtS(totalPres)}</td>
                <td style={{textAlign:'right',padding:'12px 14px',fontWeight:700,color:'var(--amber)',background:'rgba(0,0,0,0.15)'}} className="col-num">{fmtS(totalReal)}</td>
                <td style={{textAlign:'right',padding:'12px 14px',fontWeight:700,color:desv>0?'var(--red)':'var(--green)',background:'rgba(0,0,0,0.15)'}} className="col-num">{desv>0?'+':''}{fmtS(desv)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        )}
      </>
      )}
    </div>
  );
}

// ─── COSTOS PAGE ──────────────────────────────────────────
function CostosPage() {
  const obraId = useObraActiva();
  const { data: partidas } = window.__hooks.usePartidas(obraId);
  const { data: obras } = window.__hooks.useObras();
  const { data: movimientos } = window.__hooks.useMovimientosMateriales(obraId);

  const obra = obras?.find(o => o.id === obraId);

  const totales = uMG(() => {
    if (!partidas) return { pres:0, real:0 };
    return {
      pres: partidas.reduce((s,p) => s + Number(p.costo_total_presupuestado || 0), 0),
      real: partidas.reduce((s,p) => s + Number(p.costo_real_acumulado || 0), 0),
    };
  }, [partidas]);

  const porCategoria = uMG(() => {
    if (!partidas) return [];
    const cats = {};
    partidas.forEach(p => {
      const c = p.categoria || 'Sin categoría';
      if (!cats[c]) cats[c] = { categoria: c, pres: 0, real: 0 };
      cats[c].pres += Number(p.costo_total_presupuestado || 0);
      cats[c].real += Number(p.costo_real_acumulado || 0);
    });
    return Object.values(cats).filter(c => c.pres > 0 || c.real > 0);
  }, [partidas]);

  const curvaS = uMG(() => {
    if (!movimientos || !partidas) return { labels: [], plan: [], real: [] };
    const meses = {};
    movimientos
      .filter(m => m.tipo_movimiento === 'entrada' && m.precio_unitario_real)
      .forEach(m => {
        const mes = m.fecha?.slice(0, 7);
        if (!mes) return;
        meses[mes] = (meses[mes] || 0) + Number(m.cantidad) * Number(m.precio_unitario_real);
      });
    const labels = Object.keys(meses).sort();
    let acumReal = 0;
    const real = labels.map(l => acumReal += meses[l]);
    const planMensual = labels.length > 0 ? totales.pres / labels.length : 0;
    let acumPlan = 0;
    const plan = labels.map(() => acumPlan += planMensual);
    return { labels, plan, real };
  }, [movimientos, partidas, totales]);

  if (!obraId) return <div className="page-wrap"><div className="empty-state"><JxIcon name="dollar" size={32} color="var(--tm)"/><p>Cargando costos…</p></div></div>;

  const desv = totales.real - totales.pres;
  const desvPct = totales.pres > 0 ? (desv / totales.pres * 100) : 0;
  const eficiencia = totales.pres > 0 ? (totales.real / totales.pres * 100) : 0;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div><div className="pg-title">Análisis de Costos</div><div className="pg-sub">{obra?.nombre_obra || ''} · Presupuesto vs Ejecutado</div></div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:20}}>
        <div className="card card-p" style={{borderTop:'2px solid var(--blue)'}}>
          <div style={{fontSize:11,color:'var(--tm)'}}>Presupuesto Total</div>
          <div style={{fontSize:24,fontWeight:800,color:'var(--tp)',margin:'6px 0 2px'}}>{fmtSk(totales.pres)}</div>
          <div style={{fontSize:11,color:'var(--tm)'}}>{partidas?.length || 0} partidas</div>
        </div>
        <div className="card card-p" style={{borderTop:'2px solid var(--amber)'}}>
          <div style={{fontSize:11,color:'var(--tm)'}}>Ejecutado Acumulado</div>
          <div style={{fontSize:24,fontWeight:800,color:'var(--amber)',margin:'6px 0 2px'}}>{fmtSk(totales.real)}</div>
          <div style={{fontSize:11,color:'var(--tm)'}}>{eficiencia.toFixed(1)}% del presupuesto</div>
        </div>
        <div className="card card-p" style={{borderTop:`2px solid ${desv>0?'var(--red)':'var(--green)'}`}}>
          <div style={{fontSize:11,color:'var(--tm)'}}>{desv>=0?'Sobrecosto':'Ahorro'}</div>
          <div style={{fontSize:24,fontWeight:800,color:desv>0?'var(--red)':'var(--green)',margin:'6px 0 2px'}}>{desv>0?'+':''}{fmtSk(desv)}</div>
          <div style={{fontSize:11,color:'var(--tm)'}}>{desvPct.toFixed(1)}% vs presupuesto</div>
        </div>
        <div className="card card-p" style={{borderTop:'2px solid var(--green)'}}>
          <div style={{fontSize:11,color:'var(--tm)'}}>Avance Físico</div>
          <div style={{fontSize:24,fontWeight:800,color:'var(--green)',margin:'6px 0 2px'}}>{Number(obra?.avance_fisico || 0).toFixed(0)}%</div>
          <div style={{fontSize:11,color:'var(--tm)'}}>de obra completada</div>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'2fr 1fr',gap:16,marginBottom:16}}>
        <div className="chart-card">
          <div className="chart-title">Curva S — Gasto Acumulado</div>
          <div className="chart-sub">Planificado lineal vs Real (de movimientos)</div>
          {curvaS.labels.length > 0 ? (
            <ChartLine id="curva-s" labels={curvaS.labels}
              datasets={[
                { label:'Planificado', data: curvaS.plan, borderColor:'#3498DB', backgroundColor:'rgba(52,152,219,0.08)', tension:.4, borderWidth:2, fill:true, pointRadius:4 },
                { label:'Real', data: curvaS.real, borderColor:'#F2B705', backgroundColor:'rgba(242,183,5,0.08)', tension:.4, borderWidth:2, fill:true, pointRadius:4 },
              ]} height={220}/>
          ) : <div className="empty-state" style={{padding:'40px 0'}}>Sin movimientos con precio aún</div>}
        </div>
        <div className="chart-card">
          <div className="chart-title">Distribución por Categoría</div>
          <div className="chart-sub">% del costo real total</div>
          {porCategoria.length > 0 ? (
            <ChartDoughnut id="cat-cost"
              labels={porCategoria.map(c => c.categoria)}
              data={porCategoria.map(c => c.real || c.pres)}
              colors={['#3498DB','#F2B705','#2ECC71','#E74C3C','#F28C28','#9B59B6','#1ABC9C','#95A5A6']}
              height={220}/>
          ) : <div className="empty-state" style={{padding:'40px 0'}}>Sin datos</div>}
        </div>
      </div>

      {porCategoria.length > 0 && (
      <div className="card" style={{overflow:'hidden'}}>
        <div style={{padding:'14px 18px',borderBottom:'1px solid var(--border)',fontSize:13,fontWeight:700,color:'var(--tp)'}}>Detalle por Categoría</div>
        <table className="tbl">
          <thead><tr>
            <th>Categoría</th>
            <th style={{textAlign:'right'}}>Presupuestado</th>
            <th style={{textAlign:'right'}}>Real</th>
            <th style={{textAlign:'right'}}>Desviación</th>
            <th>Estado</th>
          </tr></thead>
          <tbody>
            {porCategoria.map(c => {
              const d = c.real - c.pres;
              const dp = c.pres > 0 ? (d / c.pres * 100) : 0;
              const cls = dp <= 0 ? 'b-green' : dp <= 10 ? 'b-yellow' : 'b-red';
              const lbl = dp <= 0 ? 'OK' : dp <= 10 ? 'Alerta' : 'Exceso';
              return (
                <tr key={c.categoria}>
                  <td className="col-p">{c.categoria}</td>
                  <td style={{textAlign:'right'}} className="col-num">{fmtS(c.pres)}</td>
                  <td style={{textAlign:'right'}} className="col-num">{fmtS(c.real)}</td>
                  <td style={{textAlign:'right'}} className="col-num"><span style={{color:d>0?'var(--red)':'var(--green)',fontWeight:600}}>{d>0?'+':''}{Math.round(d).toLocaleString()} ({dp.toFixed(1)}%)</span></td>
                  <td><span className={`badge ${cls}`}>{lbl}</span></td>
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

// ─── INCIDENCIAS PAGE ─────────────────────────────────────
function IncidenciasPage({ showToast }) {
  const obraId = useObraActiva();
  const { data: incidencias, loading, create: createInc, update: updateInc } = window.__hooks.useIncidencias(obraId);
  const auth = window.__useAuth ? window.__useAuth() : null;
  const isAdmin = auth?.profile?.rol === 'admin';
  const [modal, setModal] = uSG(null);
  const [form, setForm] = uSG({});
  const [filtro, setFiltro] = uSG('todas');
  const [editingId, setEditingId] = uSG(null);

  const openEditIncidencia = (i) => {
    setForm({
      tipo_incidencia: i.tipo_incidencia || 'seguridad',
      severidad: i.severidad || 'media',
      descripcion: i.descripcion || '',
      estado: i.estado || 'abierta',
    });
    setEditingId(i.id);
    setModal('editar');
  };

  const SEVERIDAD = {
    baja:    { color:'var(--blue)',   bg:'rgba(52,152,219,0.08)', label:'Baja' },
    media:   { color:'var(--yellow)', bg:'rgba(241,196,15,0.08)', label:'Media' },
    alta:    { color:'var(--orange)', bg:'rgba(242,140,40,0.08)', label:'Alta' },
    critica: { color:'var(--red)',    bg:'rgba(231,76,60,0.08)',  label:'Crítica' },
  };
  const ESTADO = {
    abierta:     { cls:'b-red',    label:'Abierta' },
    en_revision: { cls:'b-yellow', label:'En Revisión' },
    resuelta:    { cls:'b-green',  label:'Resuelta' },
    cerrada:     { cls:'b-gray',   label:'Cerrada' },
  };
  const TIPO_ICON = {
    herramienta:'tool', seguridad:'shield', material:'package',
    calidad:'checkCircle', equipo:'tool', accidente:'alertCircle', stock_conflicto:'alert',
  };

  const filtered = uMG(() => {
    if (!incidencias) return [];
    if (filtro === 'todas') return incidencias;
    return incidencias.filter(i => i.estado === filtro);
  }, [incidencias, filtro]);

  const stats = uMG(() => ({
    abiertas:  incidencias?.filter(i => i.estado === 'abierta').length ?? 0,
    revision:  incidencias?.filter(i => i.estado === 'en_revision').length ?? 0,
    resueltas: incidencias?.filter(i => i.estado === 'resuelta').length ?? 0,
    criticas:  incidencias?.filter(i => i.severidad === 'critica' && i.estado !== 'cerrada').length ?? 0,
  }), [incidencias]);

  const handleCrear = async () => {
    if (!form.descripcion) { showToast('Falta descripción', 'red'); return; }
    try {
      if (editingId) {
        const oldData = incidencias.find(x => x.id === editingId);
        const nuevoEstado = form.estado || 'abierta';
        const newFields = {
          tipo_incidencia: form.tipo_incidencia || 'seguridad',
          severidad: form.severidad || 'media',
          descripcion: form.descripcion,
          modulo_origen: form.tipo_incidencia || oldData?.modulo_origen || null,
          estado: nuevoEstado,
          resuelto_en: (nuevoEstado === 'resuelta' || nuevoEstado === 'cerrada')
            ? (oldData?.resuelto_en || new Date().toISOString())
            : null,
        };
        await updateInc(editingId, newFields);
        try { await window.__logAudit?.({ action:'update', table:'incidencias', recordId:editingId, oldData, newData:newFields }); } catch(e) {}
        showToast('Incidencia actualizada', 'green');
      } else {
        const created = await createInc({
          obra_id: obraId,
          tipo_incidencia: form.tipo_incidencia || 'seguridad',
          severidad: form.severidad || 'media',
          descripcion: form.descripcion,
          modulo_origen: form.tipo_incidencia,
          estado: 'abierta',
        });
        try { await window.__logAudit?.({ action:'insert', table:'incidencias', recordId:created?.id, newData:created }); } catch(e) {}
        showToast('Incidencia creada', 'green');
      }
      setModal(null); setForm({}); setEditingId(null);
    } catch (e) {
      showToast('Error: ' + e.message, 'red');
    }
  };

  const cambiarEstado = async (inc, nuevoEstado) => {
    try {
      const newFields = {
        estado: nuevoEstado,
        resuelto_en: (nuevoEstado === 'resuelta' || nuevoEstado === 'cerrada') ? new Date().toISOString() : null,
      };
      await updateInc(inc.id, newFields);
      try { await window.__logAudit?.({ action:'update', table:'incidencias', recordId:inc.id, oldData:inc, newData:newFields, reason:`Cambio de estado: ${inc.estado} → ${nuevoEstado}` }); } catch(e) {}
      showToast(`Incidencia marcada como "${ESTADO[nuevoEstado].label}"`, 'green');
    } catch (e) {
      showToast('Error: ' + e.message, 'red');
    }
  };

  if (!obraId) return <SinObraEmpty icon="alert"/>;
  if (loading) return <div className="page-wrap"><div className="empty-state"><JxIcon name="alert" size={32} color="var(--tm)"/><p>Cargando incidencias…</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div><div className="pg-title">Incidencias</div><div className="pg-sub">{incidencias.length} registradas · {stats.abiertas} abiertas · {stats.criticas} críticas</div></div>
        <button className="btn btn-amber btn-sm" onClick={()=>{setForm({}); setEditingId(null); setModal('nueva');}}><JxIcon name="plus" size={13}/>Nueva Incidencia</button>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
        {[
          {label:'Abiertas',val:stats.abiertas,color:'var(--red)'},
          {label:'En Revisión',val:stats.revision,color:'var(--yellow)'},
          {label:'Resueltas',val:stats.resueltas,color:'var(--green)'},
          {label:'Críticas Activas',val:stats.criticas,color:'var(--red)'},
        ].map((s,i) => (
          <div key={i} className="card card-p"><div style={{fontSize:11,color:'var(--tm)'}}>{s.label}</div><div style={{fontSize:26,fontWeight:800,color:s.color,margin:'4px 0'}}>{s.val}</div></div>
        ))}
      </div>

      <div style={{display:'flex',gap:8,marginBottom:14}}>
        {['todas','abierta','en_revision','resuelta','cerrada'].map(f => (
          <button key={f} onClick={()=>setFiltro(f)}
                  className={`btn btn-sm ${filtro===f?'btn-amber':'btn-ghost'}`}>{f === 'todas' ? 'Todas' : ESTADO[f]?.label || f}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card card-p empty-state"><JxIcon name="alert" size={40} color="var(--tm)"/><p>No hay incidencias {filtro!=='todas' ? 'con ese estado' : 'registradas'}.</p></div>
      ) : (
      <div style={{display:'grid',gap:10}}>
        {filtered.map(i => {
          const sev = SEVERIDAD[i.severidad] || SEVERIDAD.media;
          const est = ESTADO[i.estado] || ESTADO.abierta;
          return (
            <div key={i.id} className="card card-p" style={{borderLeft:`3px solid ${sev.color}`,background:sev.bg}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12}}>
                <div style={{display:'flex',gap:12,flex:1}}>
                  <div style={{width:36,height:36,borderRadius:8,background:sev.color+'22',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    <JxIcon name={TIPO_ICON[i.tipo_incidencia] || 'alertCircle'} size={16} color={sev.color}/>
                  </div>
                  <div style={{flex:1}}>
                    <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:4,flexWrap:'wrap'}}>
                      <span className={`badge ${est.cls}`}>{est.label}</span>
                      <span className="tag" style={{textTransform:'capitalize'}}>{(i.tipo_incidencia||'').replace('_',' ')}</span>
                      <span style={{fontSize:11,color:sev.color,fontWeight:700,textTransform:'uppercase'}}>{sev.label}</span>
                    </div>
                    <div style={{fontSize:13,color:'var(--tp)',lineHeight:1.4,marginBottom:6}}>{i.descripcion}</div>
                    <div style={{fontSize:11,color:'var(--tm)'}}>{i.created_at?.slice(0,16).replace('T',' ')} · módulo: {i.modulo_origen || '—'}</div>
                  </div>
                </div>
                <div style={{display:'flex',gap:6,flexShrink:0,alignItems:'center'}}>
                  {i.estado === 'abierta' && <button className="btn btn-blue btn-xs" onClick={()=>cambiarEstado(i,'en_revision')}>En revisión</button>}
                  {(i.estado === 'abierta' || i.estado === 'en_revision') && <button className="btn btn-green btn-xs" onClick={()=>cambiarEstado(i,'resuelta')}>Resolver</button>}
                  {i.estado === 'resuelta' && <button className="btn btn-ghost btn-xs" onClick={()=>cambiarEstado(i,'cerrada')}>Cerrar</button>}
                  {isAdmin && <button className="btn btn-ghost btn-xs" title="Editar incidencia" onClick={()=>openEditIncidencia(i)}>
                    <JxIcon name="edit" size={11}/>
                  </button>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {(modal === 'nueva' || modal === 'editar') && <Modal title={editingId ? 'Editar Incidencia' : 'Nueva Incidencia'} icon="alertCircle" onClose={()=>{setModal(null); setEditingId(null); setForm({});}}>
        <div className="g2">
          <div><label className="flabel">Tipo</label>
            <select className="fi" value={form.tipo_incidencia||''} onChange={e=>setForm({...form, tipo_incidencia:e.target.value})}>
              <option value="seguridad">Seguridad</option><option value="material">Material</option>
              <option value="herramienta">Herramienta</option><option value="calidad">Calidad</option>
              <option value="equipo">Equipo</option><option value="accidente">Accidente</option>
            </select>
          </div>
          <div><label className="flabel">Severidad</label>
            <select className="fi" value={form.severidad||'media'} onChange={e=>setForm({...form, severidad:e.target.value})}>
              <option value="baja">Baja</option><option value="media">Media</option>
              <option value="alta">Alta</option><option value="critica">Crítica</option>
            </select>
          </div>
          {editingId && <div style={{gridColumn:'1/-1'}}><label className="flabel">Estado</label>
            <select className="fi" value={form.estado||'abierta'} onChange={e=>setForm({...form, estado:e.target.value})}>
              <option value="abierta">Abierta</option>
              <option value="en_revision">En Revisión</option>
              <option value="resuelta">Resuelta</option>
              <option value="cerrada">Cerrada</option>
            </select>
          </div>}
          <div style={{gridColumn:'1/-1'}}><label className="flabel">Descripción *</label><textarea className="fi" rows={4} placeholder="Describe la incidencia..." value={form.descripcion||''} onChange={e=>setForm({...form, descripcion:e.target.value})}/></div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={()=>{setModal(null); setEditingId(null); setForm({});}}>Cancelar</button>
          <button className="btn btn-amber" onClick={handleCrear}><JxIcon name="check" size={13}/>{editingId ? 'Guardar Cambios' : 'Crear Incidencia'}</button>
        </div>
      </Modal>}
    </div>
  );
}

Object.assign(window, { InsumosPage, CostosPage, IncidenciasPage });
