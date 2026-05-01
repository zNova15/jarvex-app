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
  const { data: versiones } = window.__hooks.usePresupuestosVersiones(obraId);

  const obra = obras?.find(o => o.id === obraId);

  // Selector de fuente de "Planificado": partidas actuales o una versión específica
  const [fuentePlan, setFuentePlan] = uSG('actual'); // 'actual' | versionId
  const [partidasVer, setPartidasVer] = uSG([]);

  // Auto-seleccionar la versión más reciente cuando hay versiones y aún no se eligió manualmente
  uEG(() => {
    if (fuentePlan === 'actual' && versiones && versiones.length > 0) {
      const ultima = [...versiones].sort((a,b) => (b.numero||0) - (a.numero||0))[0];
      // No la activamos por defecto — el usuario decide. Solo dejamos disponible el toggle.
    }
  }, [versiones]);

  // Cargar partidas de la versión seleccionada (si aplica)
  uEG(() => {
    let cancelled = false;
    (async () => {
      if (fuentePlan === 'actual') { setPartidasVer([]); return; }
      try {
        const rows = await window.__db.partidas_versionadas
          .where('version_id').equals(fuentePlan)
          .filter(p => !p.deleted_at)
          .toArray();
        if (!cancelled) setPartidasVer(rows);
      } catch { if (!cancelled) setPartidasVer([]); }
    })();
    return () => { cancelled = true; };
  }, [fuentePlan]);

  const versionActiva = uMG(() => (versiones || []).find(v => v.id === fuentePlan), [versiones, fuentePlan]);

  // Totales: pres viene de la fuente elegida, real siempre viene de partidas reales
  const totales = uMG(() => {
    if (!partidas) return { pres:0, real:0 };
    let pres;
    if (fuentePlan === 'actual') {
      pres = partidas.reduce((s,p) => s + Number(p.costo_total_presupuestado || 0), 0);
    } else {
      pres = (partidasVer || []).reduce((s,p) => s + Number(p.costo_total || 0), 0);
    }
    const real = partidas.reduce((s,p) => s + Number(p.costo_real_acumulado || 0), 0);
    return { pres, real };
  }, [partidas, partidasVer, fuentePlan]);

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
        <div>
          <div className="pg-title">Análisis de Costos</div>
          <div className="pg-sub">
            {obra?.nombre_obra || ''} · {fuentePlan === 'actual'
              ? 'Presupuesto = partidas actuales · Ejecutado = movimientos'
              : `Presupuesto = ${versionActiva?.nombre || 'versión'} · Ejecutado = movimientos`}
          </div>
        </div>
        {versiones && versiones.length > 0 && (
          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
            <label style={{ fontSize:11, color:'var(--tm)' }}>Comparar contra:</label>
            <select className="fi" value={fuentePlan} onChange={e=>setFuentePlan(e.target.value)} style={{ minWidth:200 }}>
              <option value="actual">Partidas actuales (Real en uso)</option>
              {[...versiones].sort((a,b) => (a.numero||0) - (b.numero||0)).map(v => (
                <option key={v.id} value={v.id}>v{v.numero} · {v.nombre}</option>
              ))}
            </select>
          </div>
        )}
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

// ─── VERSIONES DE PRESUPUESTO ─────────────────────────────
// Permite mantener hasta 5 versiones de presupuesto por obra y compararlas
// lado a lado. La tabla `partidas` actual sigue siendo la versión "Real" en uso.
const TIPO_LABEL = { inicial:'Inicial', modificado:'Modificado', propuesta:'Propuesta', adicional:'Adicional', real:'Real' };
const TIPO_COLOR = { inicial:'var(--blue)', modificado:'var(--amber)', propuesta:'var(--ts)', adicional:'var(--orange)', real:'var(--green)' };

function VersionesPage({ showToast }) {
  const obraId = useObraActiva();
  const auth = window.__useAuth?.();
  const isAdmin = auth?.profile?.rol === 'admin';
  const userId = auth?.profile?.id || 'offline';
  const appMode = window.__useAppMode?.() || { isPrueba: false, isEdicion: false };
  // Compat: antes isPrueba era el flag para "permitir edición destructiva"
  const puedeEditar = appMode.isEdicion || appMode.isPrueba;

  const { data: versiones } = window.__hooks.usePresupuestosVersiones(obraId);
  const { data: obras } = window.__hooks.useObras();
  const obra = (obras || []).find(o => o.id === obraId);

  const [selectedIds, setSelectedIds] = uSG([]); // hasta 5 versiones a comparar
  const [partidasPorVersion, setPartidasPorVersion] = uSG({}); // { vId: [...partidas] }
  const [insumosPorPartidaVer, setInsumosPorPartidaVer] = uSG({}); // { vId: { codigo: [...insumos] } }
  const [partidaInsumosOpen, setPartidaInsumosOpen] = uSG(null); // codigo abierto para ver insumos
  const [modalNueva, setModalNueva] = uSG(false);
  const [form, setForm] = uSG({ nombre:'', tipo:'inicial', descripcion:'', fecha:new Date().toISOString().slice(0,10) });

  // Auto-seleccionar todas las versiones existentes (hasta 5) al cargar
  uEG(() => {
    if (versiones && versiones.length && selectedIds.length === 0) {
      const ordenadas = [...versiones].sort((a,b) => (a.numero||0) - (b.numero||0));
      setSelectedIds(ordenadas.slice(0,5).map(v => v.id));
    }
  }, [versiones]);

  // Cargar partidas + insumos de cada versión seleccionada
  uEG(() => {
    let cancelled = false;
    (async () => {
      const outPart = {};
      const outIns = {};
      for (const vid of selectedIds) {
        try {
          const rows = await window.__db.partidas_versionadas
            .where('version_id').equals(vid)
            .filter(p => !p.deleted_at)
            .toArray();
          outPart[vid] = rows;
          // mapeo partida_versionada_id → codigo
          const idToCodigo = new Map(rows.map(r => [r.id, r.codigo]));
          // insumos versionados de esta versión, agrupados por codigo de partida
          const insRows = await window.__db.insumos_partida_versionadas
            .where('version_id').equals(vid)
            .filter(i => !i.deleted_at)
            .toArray();
          const porCodigo = {};
          insRows.forEach(i => {
            const cod = idToCodigo.get(i.partida_versionada_id);
            if (!cod) return;
            if (!porCodigo[cod]) porCodigo[cod] = [];
            porCodigo[cod].push(i);
          });
          outIns[vid] = porCodigo;
        } catch (e) { outPart[vid] = []; outIns[vid] = {}; }
      }
      if (!cancelled) {
        setPartidasPorVersion(outPart);
        setInsumosPorPartidaVer(outIns);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedIds.join(',')]);

  // Construir matriz de comparación: 1 fila por código, 1 columna por versión
  // Incluye nivel jerárquico (nº de puntos en código) para soportar colapso.
  const matriz = uMG(() => {
    const porCodigo = new Map();
    selectedIds.forEach(vid => {
      const partidas = partidasPorVersion[vid] || [];
      partidas.forEach(p => {
        const cur = porCodigo.get(p.codigo) || {
          codigo: p.codigo,
          nombre: p.nombre_partida,
          unidad: p.unidad,
          orden: p.orden ?? 0,
          nivel: ((p.codigo || '').match(/\./g) || []).length + 1,
          values: {},
        };
        cur.nombre = cur.nombre || p.nombre_partida;
        cur.values[vid] = { metrado: Number(p.metrado || 0), costo: Number(p.costo_total || 0) };
        porCodigo.set(p.codigo, cur);
      });
    });
    return Array.from(porCodigo.values()).sort((a,b) => (a.codigo || '').localeCompare(b.codigo || '', 'es', { numeric:true }));
  }, [selectedIds, partidasPorVersion]);

  // Estado del árbol colapsable
  const [filtroTexto, setFiltroTexto] = uSG('');
  const [nivelMax, setNivelMax] = uSG(9); // por defecto: TODO expandido para ver cambios reales
  const [expandidos, setExpandidos] = uSG(new Set()); // códigos expandidos manualmente
  const [soloCambios, setSoloCambios] = uSG(false); // filtra filas donde hay delta entre versiones

  // ¿La fila tiene diferencias entre versiones seleccionadas?
  const tieneDelta = (row) => {
    if (selectedIds.length < 2) return true; // no aplica
    const costos = selectedIds.map(vid => row.values[vid]?.costo);
    // Hay nuevo o eliminado (alguno undefined)
    if (costos.some(c => c === undefined) && costos.some(c => c !== undefined)) return true;
    // Diferencia mayor a 0.01 entre montos
    const min = Math.min(...costos.filter(c => c !== undefined));
    const max = Math.max(...costos.filter(c => c !== undefined));
    return Math.abs(max - min) > 0.01;
  };

  // Filas visibles: respeta nivelMax + expansiones manuales + filtro texto + soloCambios
  const filasVisibles = uMG(() => {
    const q = filtroTexto.trim().toLowerCase();
    const matchesText = (row) => !q || (row.codigo + ' ' + (row.nombre||'')).toLowerCase().includes(q);
    return matriz.filter(row => {
      if (soloCambios && !tieneDelta(row)) return false;
      if (q) return matchesText(row); // si hay filtro, ignoro nivelMax
      if (row.nivel <= nivelMax) return true;
      // Filas más profundas: visibles solo si algún ancestro está en `expandidos`
      let parent = row.codigo.split('.').slice(0, -1).join('.');
      while (parent) {
        if (expandidos.has(parent)) return true;
        parent = parent.split('.').slice(0, -1).join('.');
      }
      return false;
    });
  }, [matriz, nivelMax, expandidos, filtroTexto, soloCambios, selectedIds]);

  // Determina si un código tiene hijos en la matriz (para mostrar el chevron)
  const tieneHijos = uMG(() => {
    const padres = new Set();
    matriz.forEach(r => {
      const parent = r.codigo.split('.').slice(0, -1).join('.');
      if (parent) padres.add(parent);
    });
    return padres;
  }, [matriz]);

  const toggleExpand = (codigo) => {
    setExpandidos(prev => {
      const next = new Set(prev);
      if (next.has(codigo)) next.delete(codigo); else next.add(codigo);
      return next;
    });
  };
  const expandirTodo = () => setExpandidos(new Set(Array.from(tieneHijos)));
  const colapsarTodo = () => setExpandidos(new Set());

  const versionesSel = uMG(
    () => selectedIds.map(id => (versiones || []).find(v => v.id === id)).filter(Boolean),
    [selectedIds, versiones]
  );

  const totalesPorVersion = uMG(() => {
    const out = {};
    selectedIds.forEach(vid => {
      const partidas = partidasPorVersion[vid] || [];
      out[vid] = partidas.reduce((s, p) => s + Number(p.costo_total || 0), 0);
    });
    return out;
  }, [selectedIds, partidasPorVersion]);

  const toggleSel = (id) => {
    setSelectedIds(cur => {
      if (cur.includes(id)) return cur.filter(x => x !== id);
      if (cur.length >= 5) return cur; // máx 5
      return [...cur, id];
    });
  };

  const crearVersionDesdePartidas = async () => {
    if (!obraId) { showToast?.('No hay obra activa', 'red'); return; }
    if (!form.nombre.trim()) { showToast?.('Ingresa un nombre', 'red'); return; }
    const numerosUsados = (versiones || []).map(v => v.numero);
    let numero = 1;
    while (numerosUsados.includes(numero) && numero <= 5) numero++;
    if (numero > 5) { showToast?.('Ya hay 5 versiones. Elimina una primero.', 'red'); return; }

    const partidasReal = await window.__db.partidas
      .where('obra_id').equals(obraId)
      .filter(p => !p.deleted_at)
      .toArray();

    const now = new Date().toISOString();
    const versionId = window.__newId();
    const monto = partidasReal.reduce((s, p) => s + Number(p.costo_total_presupuestado || 0), 0);

    try {
      await window.__db.presupuestos_versiones.add({
        id: versionId, obra_id: obraId,
        numero, nombre: form.nombre.trim(), tipo: form.tipo,
        descripcion: form.descripcion || null,
        fecha: form.fecha || now.slice(0,10),
        monto_total: monto,
        bloqueado: false,
        archivo_origen: 'partidas_actuales',
        notas: null,
        created_by: userId, updated_by: userId,
        created_at: now, updated_at: now,
        version: 1, sync_status: 'pending_create', last_synced_at: null,
        idempotency_key: `${userId}_pres_ver_${versionId}`,
      });

      // Mapear partida_id → partida_versionada_id (lo necesitamos para snapshot de insumos)
      const idMap = new Map();
      const partidasVersion = partidasReal.map(p => {
        const id = window.__newId();
        idMap.set(p.id, id);
        return {
          id, version_id: versionId, obra_id: obraId,
          codigo: p.codigo_delfin || '',
          nombre_partida: p.nombre_partida,
          unidad: p.unidad,
          metrado: Number(p.metrado_contratado || 0),
          precio_unitario: Number(p.precio_unitario_pres || 0),
          costo_total: Number(p.costo_total_presupuestado || 0),
          nivel: p.nivel ?? 1,
          parent_codigo: p.parent_codigo ?? null,
          orden: p.orden ?? 0,
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_part_ver_${id}`,
        };
      });
      if (partidasVersion.length) {
        await window.__db.partidas_versionadas.bulkAdd(partidasVersion);
      }

      // Snapshot de insumos por partida (si la obra tiene APU importado)
      let insumosCopiados = 0;
      try {
        const insumosReal = await window.__db.insumos_partida.where('obra_id').equals(obraId).filter(i => !i.deleted_at).toArray();
        const insumosVersion = insumosReal
          .filter(i => idMap.has(i.partida_id))
          .map(i => {
            const id = window.__newId();
            return {
              id, version_id: versionId,
              partida_versionada_id: idMap.get(i.partida_id),
              obra_id: obraId,
              insumo_codigo: i.insumo_codigo || null,
              nombre_insumo: i.nombre_insumo,
              tipo_insumo: i.tipo_insumo || null,
              unidad: i.unidad || null,
              cantidad_presupuestada: Number(i.cantidad_presupuestada || 0),
              precio_presupuestado: Number(i.precio_presupuestado || 0),
              costo_total: Number(i.cantidad_presupuestada || 0) * Number(i.precio_presupuestado || 0),
              created_by: userId, updated_by: userId,
              created_at: now, updated_at: now,
              version: 1, sync_status: 'pending_create', last_synced_at: null,
              idempotency_key: `${userId}_insv_${id}`,
            };
          });
        if (insumosVersion.length) {
          await window.__db.insumos_partida_versionadas.bulkAdd(insumosVersion);
          insumosCopiados = insumosVersion.length;
        }
      } catch (e) { console.warn('[snapshot insumos]', e); }

      try { await window.__logAudit?.({ action:'insert', table:'presupuestos_versiones', recordId: versionId,
        newData:{ numero, nombre: form.nombre, partidas: partidasVersion.length, insumos: insumosCopiados, monto } }); } catch {}
      try {
        window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'presupuestos_versiones' } }));
        window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'partidas_versionadas' } }));
        window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'insumos_partida_versionadas' } }));
        window.dispatchEvent(new Event('online'));
      } catch {}
      showToast?.(`Versión v${numero} "${form.nombre}" creada con ${partidasVersion.length} partidas${insumosCopiados ? ` y ${insumosCopiados} insumos` : ''}`, 'green');
      setModalNueva(false);
      setForm({ nombre:'', tipo:'inicial', descripcion:'', fecha:new Date().toISOString().slice(0,10) });
    } catch (e) {
      showToast?.('Error: ' + (e.message || e), 'red');
    }
  };

  const eliminarVersion = async (v) => {
    if (!isAdmin || !puedeEditar) return;
    if (!confirm(`¿Eliminar la versión "${v.nombre}" (v${v.numero})? Las partidas versionadas se borran. La versión "Real" en partidas no se toca.`)) return;
    try {
      const partidas = await window.__db.partidas_versionadas.where('version_id').equals(v.id).toArray();
      const ids = partidas.map(p => p.id);
      const now = new Date().toISOString();
      for (const id of ids) {
        await window.__db.partidas_versionadas.update(id, { deleted_at: now, sync_status: 'pending_delete' });
      }
      await window.__db.presupuestos_versiones.update(v.id, { deleted_at: now, sync_status: 'pending_delete' });
      try { await window.__logAudit?.({ action:'delete', table:'presupuestos_versiones', recordId: v.id, oldData: v, reason: 'Eliminación manual' }); } catch {}
      setSelectedIds(cur => cur.filter(x => x !== v.id));
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'presupuestos_versiones' } })); } catch {}
      showToast?.(`Versión "${v.nombre}" eliminada`, 'amber');
    } catch (e) {
      showToast?.('Error: ' + (e.message || e), 'red');
    }
  };

  const toggleBloqueada = async (v) => {
    if (!isAdmin) return;
    try {
      await window.__db.presupuestos_versiones.update(v.id, {
        bloqueado: !v.bloqueado,
        sync_status: v.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        updated_at: new Date().toISOString(),
        version: (v.version ?? 0) + 1,
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'presupuestos_versiones' } })); } catch {}
      showToast?.(v.bloqueado ? 'Versión desbloqueada' : 'Versión bloqueada', 'green');
    } catch (e) {
      showToast?.('Error: ' + (e.message || e), 'red');
    }
  };

  if (!obraId) return <div className="page-wrap"><div className="empty-state"><JxIcon name="compare" size={32} color="var(--tm)"/><p>Selecciona una obra para gestionar versiones de presupuesto.</p></div></div>;

  const totalReal = (matriz || []).reduce((s, r) => s + Math.max(...Object.values(r.values).map(v => v.costo || 0), 0), 0);
  const noHayVersiones = !versiones || versiones.length === 0;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Versiones de Presupuesto</div>
          <div className="pg-sub">
            {obra?.nombre_obra || ''} · Hasta 5 versiones (Inicial → Modificado → Propuesta → Adicional → Real). Compara las que necesites lado a lado.
          </div>
        </div>
        {isAdmin && (versiones?.length || 0) < 5 && (
          <button className="btn btn-amber btn-sm" onClick={()=>setModalNueva(true)}>
            <JxIcon name="plus" size={13}/> Nueva versión desde partidas actuales
          </button>
        )}
      </div>

      {noHayVersiones ? (
        <div className="card card-p" style={{ textAlign:'center', padding:'40px 20px' }}>
          <JxIcon name="compare" size={40} color="var(--tm)"/>
          <div style={{ fontSize:15, fontWeight:700, color:'var(--tp)', marginTop:14, marginBottom:6 }}>Aún no hay versiones</div>
          <p style={{ maxWidth:560, margin:'0 auto 18px', fontSize:12.5, color:'var(--tm)', lineHeight:1.5 }}>
            Una versión es una <strong>foto congelada</strong> de tus partidas en un momento dado (ej: lo que firmó el cliente, una propuesta, un adicional).
            Te sirve para comparar después contra otras versiones o el costo real ejecutado.
          </p>
          <div style={{ display:'flex', gap:10, justifyContent:'center', flexWrap:'wrap' }}>
            {isAdmin && (
              <button className="btn btn-amber" onClick={()=>setModalNueva(true)}>
                <JxIcon name="plus" size={13}/> Crear v1 desde mis partidas actuales
              </button>
            )}
            <a className="btn btn-ghost" href="#" onClick={(e)=>{ e.preventDefault(); window.location.hash = '#importar'; window.dispatchEvent(new HashChangeEvent('hashchange')); }}>
              <JxIcon name="upload" size={13}/> Ir a Importar APU (con opción de guardar versión)
            </a>
          </div>
        </div>
      ) : (
        <>
          {/* Selector de versiones a comparar */}
          <div className="card card-p" style={{ marginBottom:14 }}>
            <div style={{ fontSize:12.5, fontWeight:700, color:'var(--tp)', marginBottom:8 }}>
              <JxIcon name="check" size={12}/> Versiones (selecciona hasta 5 para comparar — {selectedIds.length}/5)
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:10 }}>
              {[...versiones].sort((a,b) => (a.numero||0) - (b.numero||0)).map(v => {
                const sel = selectedIds.includes(v.id);
                const monto = totalesPorVersion[v.id];
                return (
                  <div key={v.id}
                    style={{ position:'relative', borderRadius:8,
                             border:`1.5px solid ${sel ? TIPO_COLOR[v.tipo] || 'var(--amber)' : 'var(--border)'}`,
                             background: sel ? `${(TIPO_COLOR[v.tipo] || 'var(--amber)')}14` : 'transparent',
                             padding:10 }}>
                    <label style={{ display:'flex', gap:8, alignItems:'flex-start', cursor:'pointer' }}>
                      <input type="checkbox" checked={sel} onChange={()=>toggleSel(v.id)}/>
                      <div style={{ flex:1 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, color:'var(--tm)' }}>
                          <span style={{ background: TIPO_COLOR[v.tipo], color:'#fff', padding:'1px 6px', borderRadius:4, fontSize:10, fontWeight:700 }}>
                            v{v.numero}
                          </span>
                          <span style={{ textTransform:'uppercase', letterSpacing:'.04em' }}>{TIPO_LABEL[v.tipo] || v.tipo}</span>
                          {v.bloqueado && <JxIcon name="lock" size={10} color="var(--amber)"/>}
                        </div>
                        <div style={{ fontSize:13, fontWeight:700, color:'var(--tp)', marginTop:3 }}>{v.nombre}</div>
                        <div style={{ fontSize:11, color:'var(--tm)', marginTop:2 }}>
                          {v.fecha || '—'} · S/ {(monto ?? Number(v.monto_total||0)).toLocaleString('es-PE', { maximumFractionDigits: 0 })}
                        </div>
                      </div>
                    </label>
                    {isAdmin && (
                      <div style={{ display:'flex', gap:4, marginTop:6, justifyContent:'flex-end' }}>
                        <button className="btn btn-ghost btn-xs" title={v.bloqueado ? 'Desbloquear' : 'Bloquear (no se podrá editar)'} onClick={()=>toggleBloqueada(v)}>
                          <JxIcon name={v.bloqueado ? 'lock' : 'check'} size={10}/>
                        </button>
                        {puedeEditar && (
                          <button className="btn btn-red btn-xs" title="Eliminar versión (solo modo edición)" onClick={()=>eliminarVersion(v)}>
                            <JxIcon name="trash" size={10}/>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Matriz comparativa */}
          {versionesSel.length === 0 ? (
            <div className="card card-p empty-state">
              <JxIcon name="compare" size={32} color="var(--tm)"/>
              <p>Selecciona al menos una versión arriba para verla.</p>
            </div>
          ) : (
            <>
              {/* KPIs por versión */}
              <div style={{ display:'grid', gridTemplateColumns:`repeat(${versionesSel.length}, 1fr)`, gap:12, marginBottom:14 }}>
                {versionesSel.map((v, i) => {
                  const monto = totalesPorVersion[v.id] ?? Number(v.monto_total || 0);
                  const prev = i > 0 ? (totalesPorVersion[versionesSel[i-1].id] ?? Number(versionesSel[i-1].monto_total||0)) : null;
                  const delta = prev !== null ? monto - prev : null;
                  const deltaPct = prev !== null && prev !== 0 ? (delta / prev * 100) : null;
                  return (
                    <div key={v.id} className="card card-p" style={{ borderTop:`3px solid ${TIPO_COLOR[v.tipo] || 'var(--amber)'}` }}>
                      <div style={{ fontSize:10.5, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.05em' }}>
                        v{v.numero} · {TIPO_LABEL[v.tipo] || v.tipo}
                      </div>
                      <div style={{ fontSize:13, fontWeight:600, color:'var(--ts)', marginTop:2, marginBottom:6 }}>{v.nombre}</div>
                      <div style={{ fontSize:20, fontWeight:800, color: TIPO_COLOR[v.tipo] || 'var(--amber)' }}>
                        S/ {monto.toLocaleString('es-PE', { maximumFractionDigits: 0 })}
                      </div>
                      <div style={{ fontSize:11, color:'var(--tm)', marginTop:4 }}>
                        {(partidasPorVersion[v.id] || []).length} partidas
                        {delta !== null && (
                          <span style={{ marginLeft:8, color: delta >= 0 ? 'var(--red)' : 'var(--green)', fontWeight:600 }}>
                            {delta >= 0 ? '+' : ''}S/ {delta.toLocaleString('es-PE', { maximumFractionDigits: 0 })}
                            {' '}({deltaPct >= 0 ? '+' : ''}{(deltaPct ?? 0).toFixed(1)}%)
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Controles de árbol */}
              <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:10 }}>
                <input className="fi" placeholder="Buscar partida (código o nombre)…"
                  value={filtroTexto} onChange={e=>setFiltroTexto(e.target.value)}
                  style={{ flex:'1 1 220px', minWidth:200 }}/>
                <select className="fi" value={nivelMax} onChange={e=>setNivelMax(Number(e.target.value))} style={{ minWidth:140 }}>
                  <option value={1}>Solo capítulos (nivel 1)</option>
                  <option value={2}>Hasta nivel 2</option>
                  <option value={3}>Hasta nivel 3</option>
                  <option value={4}>Hasta nivel 4</option>
                  <option value={9}>Todo expandido</option>
                </select>
                <button className="btn btn-ghost btn-sm" onClick={expandirTodo}>
                  <JxIcon name="chevD" size={11}/> Expandir todo
                </button>
                <button className="btn btn-ghost btn-sm" onClick={colapsarTodo}>
                  <JxIcon name="chevR" size={11}/> Colapsar todo
                </button>
                {versionesSel.length >= 2 && (
                  <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, color: soloCambios ? 'var(--amber)' : 'var(--tm)', cursor:'pointer', padding:'4px 8px', border:`1px solid ${soloCambios?'var(--amber)':'var(--bd)'}`, borderRadius:6 }}>
                    <input type="checkbox" checked={soloCambios} onChange={e=>setSoloCambios(e.target.checked)} style={{ accentColor:'var(--amber)' }}/>
                    Solo con cambios
                  </label>
                )}
                <span style={{ fontSize:11, color:'var(--tm)' }}>
                  {filasVisibles.length} / {matriz.length} partidas
                  {versionesSel.length >= 2 && (() => {
                    const conCambio = matriz.filter(r => tieneDelta(r)).length;
                    return <> · <strong style={{ color:'var(--amber)' }}>{conCambio} con diferencias</strong></>;
                  })()}
                </span>
              </div>

              {/* Tabla matriz */}
              <div className="card" style={{ overflow:'auto' }}>
                <table className="tbl" style={{ minWidth: 600 + versionesSel.length * 140 }}>
                  <thead>
                    <tr>
                      <th style={{ minWidth:140 }}>Código</th>
                      <th style={{ minWidth:280 }}>Partida</th>
                      <th>Unidad</th>
                      {versionesSel.map(v => (
                        <th key={v.id} style={{ minWidth:140, textAlign:'right' }}>
                          v{v.numero} · {TIPO_LABEL[v.tipo] || v.tipo}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matriz.length === 0 ? (
                      <tr><td colSpan={3 + versionesSel.length} style={{ padding:'20px', textAlign:'center', color:'var(--tm)' }}>
                        Las versiones seleccionadas no tienen partidas guardadas.
                      </td></tr>
                    ) : filasVisibles.length === 0 ? (
                      <tr><td colSpan={3 + versionesSel.length} style={{ padding:'20px', textAlign:'center', color:'var(--tm)' }}>
                        Sin coincidencias para "{filtroTexto}".
                      </td></tr>
                    ) : filasVisibles.map(row => {
                      const conHijos = tieneHijos.has(row.codigo);
                      const expanded = expandidos.has(row.codigo);
                      const indent = (row.nivel - 1) * 14;
                      const esCapitulo = row.nivel <= 2;
                      const insumosOpen = partidaInsumosOpen === row.codigo;
                      // ¿alguna versión tiene insumos para esta partida?
                      const tieneInsumos = versionesSel.some(v => (insumosPorPartidaVer[v.id]?.[row.codigo] || []).length > 0);
                      // Construir matriz de insumos por código si está expandida
                      let insumosFilas = [];
                      if (insumosOpen) {
                        const porCodInsumo = new Map();
                        versionesSel.forEach(v => {
                          (insumosPorPartidaVer[v.id]?.[row.codigo] || []).forEach(ins => {
                            const k = ins.insumo_codigo || ins.nombre_insumo;
                            const cur = porCodInsumo.get(k) || {
                              codigo: ins.insumo_codigo,
                              nombre: ins.nombre_insumo,
                              tipo: ins.tipo_insumo,
                              unidad: ins.unidad,
                              values: {},
                            };
                            cur.values[v.id] = {
                              cantidad: Number(ins.cantidad_presupuestada || 0),
                              costo: Number(ins.costo_total || (ins.cantidad_presupuestada * ins.precio_presupuestado) || 0),
                            };
                            porCodInsumo.set(k, cur);
                          });
                        });
                        insumosFilas = Array.from(porCodInsumo.values()).sort((a,b) =>
                          (a.tipo||'').localeCompare(b.tipo||'') || (a.codigo||'').localeCompare(b.codigo||'')
                        );
                      }
                      return (
                        <React.Fragment key={row.codigo}>
                          <tr style={esCapitulo ? { background:'rgba(255,255,255,0.025)', fontWeight:600 } : null}>
                            <td className="col-m" style={{ fontFamily:'monospace', fontSize:11, paddingLeft: 8 + indent }}>
                              {conHijos && (
                                <button onClick={()=>toggleExpand(row.codigo)}
                                  style={{ background:'none', border:'none', cursor:'pointer', color:'var(--amber)', marginRight:4, padding:0, fontSize:11 }}>
                                  {expanded ? '▼' : '▶'}
                                </button>
                              )}
                              {!conHijos && <span style={{ display:'inline-block', width:14 }}/>}
                              {row.codigo}
                            </td>
                            <td className="col-p" style={{ fontWeight: esCapitulo ? 600 : 400 }}>
                              {row.nombre}
                              {tieneInsumos && (
                                <button
                                  onClick={()=>setPartidaInsumosOpen(insumosOpen ? null : row.codigo)}
                                  title="Ver/ocultar insumos por partida"
                                  style={{ background:'none', border:'1px solid var(--border)', borderRadius:4, padding:'1px 6px', marginLeft:6, fontSize:10, cursor:'pointer', color: insumosOpen ? 'var(--amber)' : 'var(--tm)' }}>
                                  {insumosOpen ? '▾ insumos' : '▸ insumos'}
                                </button>
                              )}
                            </td>
                            <td className="col-m">{row.unidad || '—'}</td>
                            {versionesSel.map((v, i) => {
                              const cell = row.values[v.id];
                              const prev = i > 0 ? row.values[versionesSel[i-1].id] : null;
                              const delta = cell && prev ? (cell.costo - prev.costo) : null;
                              return (
                                <td key={v.id} style={{ textAlign:'right', whiteSpace:'nowrap' }} className="col-num">
                                  {cell ? (
                                    <>
                                      <div style={{ fontSize:12, fontWeight:esCapitulo?700:600 }}>S/ {cell.costo.toLocaleString('es-PE', { maximumFractionDigits: 0 })}</div>
                                      {delta !== null && delta !== 0 && (
                                        <div style={{ fontSize:10, color: delta > 0 ? 'var(--red)' : 'var(--green)', marginTop:1 }}>
                                          {delta > 0 ? '+' : ''}S/ {delta.toLocaleString('es-PE', { maximumFractionDigits: 0 })}
                                        </div>
                                      )}
                                    </>
                                  ) : <span style={{ color:'var(--tm)' }}>—</span>}
                                </td>
                              );
                            })}
                          </tr>
                          {insumosOpen && insumosFilas.length > 0 && (
                            <tr>
                              <td colSpan={3 + versionesSel.length} style={{ padding:0, background:'rgba(52,152,219,0.04)' }}>
                                <div style={{ padding:'6px 14px 10px 28px', fontSize:11 }}>
                                  <div style={{ fontWeight:700, color:'var(--blue)', marginBottom:4 }}>
                                    Insumos comparados ({insumosFilas.length})
                                  </div>
                                  <table className="tbl" style={{ fontSize:10.5 }}>
                                    <thead>
                                      <tr>
                                        <th style={{ minWidth:70 }}>Cód.</th>
                                        <th>Insumo</th>
                                        <th>Tipo</th>
                                        <th>Unid.</th>
                                        {versionesSel.map(v => (
                                          <th key={v.id} style={{ textAlign:'right' }}>v{v.numero}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {insumosFilas.map((ins, k) => (
                                        <tr key={k}>
                                          <td className="col-m" style={{ fontFamily:'monospace' }}>{ins.codigo || '—'}</td>
                                          <td>{ins.nombre}</td>
                                          <td className="col-m" style={{ textTransform:'capitalize' }}>{(ins.tipo || '').replace('_',' ') || '—'}</td>
                                          <td className="col-m">{ins.unidad || '—'}</td>
                                          {versionesSel.map((v, i) => {
                                            const cell = ins.values[v.id];
                                            const prev = i > 0 ? ins.values[versionesSel[i-1].id] : null;
                                            const delta = cell && prev ? (cell.costo - prev.costo) : null;
                                            return (
                                              <td key={v.id} style={{ textAlign:'right' }} className="col-num">
                                                {cell ? (
                                                  <>
                                                    <div>S/ {cell.costo.toLocaleString('es-PE', { maximumFractionDigits: 0 })}</div>
                                                    {delta !== null && delta !== 0 && (
                                                      <div style={{ fontSize:9, color: delta > 0 ? 'var(--red)' : 'var(--green)' }}>
                                                        {delta > 0 ? '+' : ''}{delta.toLocaleString('es-PE', { maximumFractionDigits: 0 })}
                                                      </div>
                                                    )}
                                                  </>
                                                ) : <span style={{ color:'var(--tm)' }}>—</span>}
                                              </td>
                                            );
                                          })}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background:'rgba(0,0,0,0.18)', fontWeight:700 }}>
                      <td colSpan={3} style={{ padding:'10px 14px' }}>TOTAL</td>
                      {versionesSel.map(v => (
                        <td key={v.id} style={{ textAlign:'right', padding:'10px 14px', color: TIPO_COLOR[v.tipo] || 'var(--amber)' }}>
                          S/ {(totalesPorVersion[v.id] || 0).toLocaleString('es-PE', { maximumFractionDigits: 0 })}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {modalNueva && (
        <Modal title="Nueva versión de presupuesto" icon="plus" onClose={()=>setModalNueva(false)}>
          <div style={{ fontSize:12, color:'var(--tm)', marginBottom:12 }}>
            Toma una foto del estado actual de las partidas y la guarda como una versión congelada.
            Útil cuando el cliente aprueba una propuesta o se firma un adicional.
          </div>
          <div className="g2">
            <div style={{ gridColumn:'1 / -1' }}>
              <label className="flabel">Nombre *</label>
              <input className="fi" value={form.nombre} placeholder='ej: "v1 Inicial firmado por cliente"'
                onChange={e=>setForm({...form, nombre:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Tipo</label>
              <select className="fi" value={form.tipo} onChange={e=>setForm({...form, tipo:e.target.value})}>
                {Object.entries(TIPO_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="flabel">Fecha</label>
              <input className="fi" type="date" value={form.fecha} onChange={e=>setForm({...form, fecha:e.target.value})}/>
            </div>
            <div style={{ gridColumn:'1 / -1' }}>
              <label className="flabel">Descripción / Notas</label>
              <textarea className="fi" rows={3} value={form.descripcion}
                placeholder="Contexto: por qué se crea esta versión, qué cambió respecto a la anterior, etc."
                onChange={e=>setForm({...form, descripcion:e.target.value})}/>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>setModalNueva(false)}>Cancelar</button>
            <button className="btn btn-amber" onClick={crearVersionDesdePartidas}>
              <JxIcon name="check" size={13}/> Crear versión
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { InsumosPage, CostosPage, IncidenciasPage, VersionesPage });
