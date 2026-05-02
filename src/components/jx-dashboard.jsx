import React from "react";
const { useEffect, useRef } = React;

// ── Chart defaults ──
const CHART_DEFAULTS = {
  color: '#BFC7D1',
  plugins: { legend: { labels: { color: '#7A8A9A', font: { size: 11, family: 'Inter' }, boxWidth: 12, padding: 16 } } },
  scales: {
    x: { ticks: { color: '#5A6A7A', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false }, border: { display: false } },
    y: { ticks: { color: '#5A6A7A', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false }, border: { display: false } },
  },
};

function ChartLine({ id, labels, datasets, height = 200 }) {
  const ref = useRef(null);
  const inst = useRef(null);
  useEffect(() => {
    if (inst.current) inst.current.destroy();
    inst.current = new Chart(ref.current, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: CHART_DEFAULTS.plugins,
        scales: CHART_DEFAULTS.scales,
      }
    });
    return () => inst.current?.destroy();
  }, []);
  return <div style={{ height }}><canvas ref={ref} /></div>;
}

function ChartBar({ id, labels, datasets, height = 200, horizontal = false }) {
  const ref = useRef(null);
  const inst = useRef(null);
  useEffect(() => {
    if (inst.current) inst.current.destroy();
    inst.current = new Chart(ref.current, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        indexAxis: horizontal ? 'y' : 'x',
        interaction: { mode: 'index', intersect: false },
        plugins: { ...CHART_DEFAULTS.plugins, legend: { ...CHART_DEFAULTS.plugins.legend } },
        scales: CHART_DEFAULTS.scales,
        borderRadius: 4,
      }
    });
    return () => inst.current?.destroy();
  }, []);
  return <div style={{ height }}><canvas ref={ref} /></div>;
}

function ChartDoughnut({ id, labels, data, colors, height = 180 }) {
  const ref = useRef(null);
  const inst = useRef(null);
  useEffect(() => {
    if (inst.current) inst.current.destroy();
    inst.current = new Chart(ref.current, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#1C2D40' }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: '68%',
        plugins: { ...CHART_DEFAULTS.plugins, legend: { position: 'right', labels: { color: '#7A8A9A', font: { size: 11 }, boxWidth: 12, padding: 12 } } },
      }
    });
    return () => inst.current?.destroy();
  }, []);
  return <div style={{ height }}><canvas ref={ref} /></div>;
}

// ── KPI Card ──
function KpiCard({ label, value, unit, change, icon, color, sub }) {
  return (
    <div className="kpi-card">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 11.5, color: 'var(--tm)', fontWeight: 500 }}>{label}</div>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: color + '1a', display: 'flex', alignItems: 'center', justifyContent: 'center', color }}>
          <JxIcon name={icon} size={15} color={color} />
        </div>
      </div>
      <div className="kpi-val">{value}<span style={{ fontSize: 14, fontWeight: 500, color: 'var(--tm)', marginLeft: 4 }}>{unit}</span></div>
      {sub && <div style={{ fontSize: 11, color: 'var(--tm)' }}>{sub}</div>}
      {change && <div className={`kpi-change ${change.dir}`}>{change.dir === 'up' ? '↑' : change.dir === 'dn' ? '↓' : '—'} {change.label}</div>}
    </div>
  );
}

// ── Recent Activity ──
const ACTIVITY = [
  { time: '08:42', text: 'Salida de 50 bolsas de cemento — Partida 03', type: 'out', who: 'R. Torres' },
  { time: '08:15', text: 'Devolución de nivel láser NL-200 — Estado: Bueno', type: 'in', who: 'J. Pérez' },
  { time: '07:55', text: 'Registro de asistencia completado — 12/14 presentes', type: 'ok', who: 'Sistema' },
  { time: 'Ayer', text: 'Alerta: Fierro 3/8" por debajo del stock mínimo', type: 'alert', who: 'Sistema' },
  { time: 'Ayer', text: 'Avance semana 12 registrado — Partida 07: 78%', type: 'ok', who: 'Ing. García' },
  { time: 'Ayer', text: 'Nuevo proveedor registrado: Aceros del Perú SAC', type: 'info', who: 'Admin' },
];

const ACT_COLORS = { out: '#F28C28', in: '#2ECC71', ok: '#3498DB', alert: '#E74C3C', info: '#F2B705' };
const ACT_ICONS  = { out: 'arrowOut', in: 'arrowIn', ok: 'checkCircle', alert: 'alertCircle', info: 'bell' };

const { useState: uSD, useEffect: uED, useMemo: uMD } = React;

// ── Helpers ──
function fmtSoles(n) {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1_000_000) return 'S/ ' + (v / 1_000_000).toFixed(2) + 'M';
  if (Math.abs(v) >= 1_000) return 'S/ ' + (v / 1_000).toFixed(1) + 'K';
  return 'S/ ' + v.toFixed(0);
}
function avanceColor(pct) {
  if (pct >= 80) return '#2ECC71';
  if (pct >= 50) return '#F2B705';
  return '#E74C3C';
}
function diasUrgenciaColor(dias) {
  if (dias == null) return 'var(--tm)';
  if (dias < 0) return '#E74C3C';
  if (dias < 15) return '#E74C3C';
  if (dias <= 30) return '#F2B705';
  return '#2ECC71';
}

function DashboardPage() {
  const [obraId, setObraId] = uSD(null);
  const [vistaPonderada, setVistaPonderada] = uSD(null); // KPI desde Supabase view (opcional)
  const [vistaTick, setVistaTick] = uSD(0);

  // Filtrado por rol: el almacenero / operativos no necesitan ver datos
  // gerenciales (partidas, costos, avance, atrasos, actividad reciente).
  const auth = window.__useAuth?.();
  const rol = auth?.profile?.rol || '';
  const isAdmin = rol === 'admin';
  const has = (mod, n='r') => isAdmin || !rol || (window.__hasPerm?.(rol, mod, n) ?? true);
  const canPartidas = has('Partidas');
  const canCostos   = has('Costos');
  const canObras    = has('Obras');
  // Bloque "managerial": agregados de obra (avance, costos, atrasos, distribución, actividad reciente).
  const canManagement = canPartidas || canCostos;

  uED(() => {
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

  // Refresca la vista ponderada de Supabase cada 15s
  uED(() => {
    if (!obraId) return;
    let cancelled = false;
    const fetchView = async () => {
      try {
        const sb = window.__supabase;
        if (!sb) return;
        const { data, error } = await sb
          .from('v_obras_avance_ponderado')
          .select('*')
          .eq('obra_id', obraId)
          .single();
        if (!cancelled && !error && data) setVistaPonderada(data);
      } catch (_) { /* offline o vista inexistente: ignorar */ }
    };
    fetchView();
    const id = setInterval(() => { setVistaTick(t => t + 1); fetchView(); }, 15000);
    return () => { cancelled = true; clearInterval(id); };
  }, [obraId]);

  const { data: obras } = window.__hooks.useObras();
  const { data: personal } = window.__hooks.usePersonal(obraId);
  const { data: materiales } = window.__hooks.useMateriales(obraId);
  const { data: herramientas } = window.__hooks.useHerramientas(obraId);
  const { data: partidas } = window.__hooks.usePartidas(obraId);
  const { data: asistencia } = window.__hooks.useAsistencia(obraId);
  const { data: movMateriales } = window.__hooks.useMovimientosMateriales(obraId);
  const { data: movHerramientas } = window.__hooks.useMovimientosHerramientas(obraId);
  const { data: incidencias } = window.__hooks.useIncidencias(obraId);

  const obraActiva = obras?.find(o => o.id === obraId);

  const today = new Date().toISOString().slice(0, 10);
  const fechaTexto = new Date().toLocaleDateString('es-PE', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

  // KPIs reales
  const kpis = uMD(() => {
    const asistHoy = asistencia.filter(a => a.fecha === today);
    const materialesAlerta = materiales.filter(m => m.alerta === 'critico' || m.alerta === 'sin_stock');
    const matsCritico = materiales.filter(m => m.alerta === 'critico').length;
    const matsReponer = materiales.filter(m => m.alerta === 'reponer').length;
    const matsSinStock = materiales.filter(m => m.alerta === 'sin_stock').length;
    const matsOk = materiales.filter(m => m.alerta === 'ok' || !m.alerta).length;
    const herrEnUso = herramientas.filter(h => h.ubicacion_actual === 'en_uso').length;
    const incAbiertas = incidencias.filter(i => i.estado === 'abierta').length;

    // ── Cálculos partidas / cronograma / costos ──
    const totalPres = partidas.reduce((s,p) => s + Number(p.costo_total_presupuestado || 0), 0);
    const totalReal = partidas.reduce((s,p) => s + Number(p.costo_real_acumulado || 0), 0);
    const sobrecosto = totalReal - totalPres;

    // Avance ponderado por costo (fallback cliente)
    let avancePonderadoLocal = 0;
    if (totalPres > 0) {
      const num = partidas.reduce((s,p) => s + (Number(p.porcentaje_avance || 0) * Number(p.costo_total_presupuestado || 0)), 0);
      avancePonderadoLocal = num / totalPres;
    }

    const partidasTerminadas = partidas.filter(p => p.estado === 'terminado' || Number(p.porcentaje_avance || 0) >= 100).length;
    const partidasEnEjecucion = partidas.filter(p => p.estado === 'en_ejecucion').length;
    const partidasPendientes = partidas.filter(p => p.estado === 'pendiente' || (!p.estado && Number(p.porcentaje_avance || 0) === 0)).length;
    const partidasObservadas = partidas.filter(p => p.estado === 'observado').length;

    // Atrasadas: estado=atrasado O fecha_fin_planificada < today && avance < 80
    const partidasAtrasadasArr = partidas.filter(p => {
      if (p.estado === 'atrasado') return true;
      if (p.estado === 'terminado') return false;
      const ff = p.fecha_fin_planificada;
      if (!ff) return false;
      return ff < today && Number(p.porcentaje_avance || 0) < 80;
    });
    const partidasAtrasadas = partidasAtrasadasArr;

    // Top 5 atrasadas: ordenar por días vencidos desc
    const topAtrasadas = partidasAtrasadasArr
      .map(p => {
        const ff = p.fecha_fin_planificada;
        let diasVencidos = null;
        if (ff) {
          const d1 = new Date(ff + 'T00:00:00');
          const d2 = new Date(today + 'T00:00:00');
          diasVencidos = Math.floor((d2 - d1) / 86400000);
        }
        return { ...p, _diasVencidos: diasVencidos };
      })
      .sort((a,b) => (b._diasVencidos || 0) - (a._diasVencidos || 0))
      .slice(0, 5);

    // Días al vencimiento de la obra
    let diasAlVencimiento = null;
    const ffObra = obraActiva?.fecha_fin_estimada;
    if (ffObra) {
      const d1 = new Date(ffObra + 'T00:00:00');
      const d2 = new Date(today + 'T00:00:00');
      diasAlVencimiento = Math.floor((d1 - d2) / 86400000);
    }

    return {
      obrasActivas: obras.filter(o => o.estado === 'activo').length,
      asistHoy, presentesHoy: asistHoy.filter(a => a.estado_asistencia === 'asistio').length,
      tardanzasHoy: asistHoy.filter(a => a.estado_asistencia === 'tardanza').length,
      faltasHoy: asistHoy.filter(a => a.estado_asistencia === 'falta').length,
      personalTotal: personal.length,
      materialesAlerta: materialesAlerta.length, matsCritico, matsReponer, matsSinStock, matsOk,
      herrEnUso, herrTotal: herramientas.length,
      avanceFisico: Number(obraActiva?.avance_fisico || 0),
      partidasAtrasadas: partidasAtrasadas.length,
      partidasAtrasadasNombres: partidasAtrasadas.slice(0,2).map(p => p.nombre_partida).join(' · ') || '—',
      topAtrasadas,
      partidasTerminadas, partidasEnEjecucion, partidasPendientes, partidasObservadas,
      partidasTotal: partidas.length,
      avancePonderadoLocal,
      diasAlVencimiento,
      ffObra,
      totalPres, totalReal, sobrecosto,
      pctPresupuesto: totalPres > 0 ? (totalReal / totalPres * 100) : 0,
      incAbiertas,
    };
  }, [obras, personal, materiales, herramientas, partidas, asistencia, incidencias, obraActiva, today]);

  // KPI ponderado: Supabase view o fallback cliente
  const avancePonderadoPct = vistaPonderada
    ? Number(vistaPonderada.avance_ponderado_pct || 0)
    : kpis.avancePonderadoLocal;
  const partidasTerminadasView = vistaPonderada
    ? Number(vistaPonderada.partidas_terminadas || kpis.partidasTerminadas)
    : kpis.partidasTerminadas;
  const totalPartidasView = vistaPonderada
    ? Number(vistaPonderada.total_partidas || kpis.partidasTotal)
    : kpis.partidasTotal;

  // Datos para gráficos
  const partidaChart = uMD(() => {
    return partidas
      .filter(p => Number(p.costo_total_presupuestado || 0) > 0)
      .slice(0, 8);
  }, [partidas]);

  const movRecientes = uMD(() => {
    const items = [];
    movMateriales.forEach(m => {
      const mat = materiales.find(x => x.id === m.material_id);
      items.push({
        type: m.tipo_movimiento === 'entrada' ? 'in' : 'out',
        text: `${m.tipo_movimiento === 'entrada' ? 'Ingreso' : 'Salida'} de ${m.cantidad} ${m.unidad} de ${mat?.nombre_material || 'material'}`,
        time: m.fecha + (m.hora ? ' ' + m.hora.slice(0,5) : ''),
        ts: new Date(m.created_at || m.fecha).getTime(),
      });
    });
    movHerramientas.forEach(m => {
      const h = herramientas.find(x => x.id === m.herramienta_id);
      items.push({
        type: m.accion === 'salida' ? 'out' : 'in',
        text: `${m.accion === 'salida' ? 'Salida' : 'Devolución'} de ${h?.nombre_herramienta || 'herramienta'}`,
        time: m.fecha,
        ts: new Date(m.created_at || m.fecha).getTime(),
      });
    });
    incidencias.filter(i => i.estado === 'abierta').forEach(i => {
      items.push({ type:'alert', text: i.descripcion, time: i.created_at?.slice(0,10) || '', ts: new Date(i.created_at).getTime() });
    });
    return items.sort((a,b) => b.ts - a.ts).slice(0, 6);
  }, [movMateriales, movHerramientas, incidencias, materiales, herramientas]);

  const ACT_COLORS = { out:'#F28C28', in:'#2ECC71', alert:'#E74C3C', info:'#F2B705' };
  const ACT_ICONS = { out:'arrowOut', in:'arrowIn', alert:'alertCircle', info:'bell' };

  // Top herramientas por uso
  const topHerramientas = uMD(() => {
    const counts = {};
    movHerramientas.filter(m => m.accion === 'salida').forEach(m => {
      counts[m.herramienta_id] = (counts[m.herramienta_id] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([id, n]) => ({ nombre: herramientas.find(h => h.id === id)?.nombre_herramienta || '?', n }))
      .sort((a,b) => b.n - a.n)
      .slice(0, 5);
  }, [movHerramientas, herramientas]);

  return (
    <div className="page-wrap">
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div className="pg-title">Dashboard General</div>
            <div className="pg-sub" style={{textTransform:'capitalize'}}>{fechaTexto} · Obra: {obraActiva?.nombre_obra || '—'}</div>
          </div>
          {(() => {
            const tot = canManagement
              ? kpis.materialesAlerta + kpis.partidasAtrasadas + kpis.incAbiertas
              : kpis.materialesAlerta;
            return tot > 0 ? (
              <button className="btn btn-amber btn-sm"><JxIcon name="bell" size={13}/> {tot} Alertas</button>
            ) : null;
          })()}
        </div>
      </div>

      {kpis.materialesAlerta > 0 && (
        <div className="alert-banner" style={{marginBottom:18}}>
          <JxIcon name="alert" size={16} color="#E74C3C"/>
          <span><strong>{kpis.matsSinStock + kpis.matsCritico} material{kpis.matsSinStock+kpis.matsCritico>1?'es':''} en estado crítico:</strong> {materiales.filter(m=>m.alerta==='critico'||m.alerta==='sin_stock').slice(0,3).map(m=>`${m.nombre_material} (${m.stock_actual} ${m.unidad})`).join(' · ')}{kpis.materialesAlerta>3?` · y ${kpis.materialesAlerta-3} más`:''}</span>
        </div>
      )}

      <div className={canManagement ? "g4" : "g3"} style={{ marginBottom: 20, display:'grid', gridTemplateColumns: canManagement ? 'repeat(4,1fr)' : 'repeat(3,1fr)', gap:12 }}>
        {canManagement && (
          <KpiCard label="Obras Activas" value={String(kpis.obrasActivas)} icon="building" color="#3498DB" sub={`${obras.length} totales`}/>
        )}
        <KpiCard label="Personal Presente Hoy" value={String(kpis.presentesHoy)} unit={`/${kpis.personalTotal}`} icon="users" color="#2ECC71" sub={`${kpis.tardanzasHoy} tardanza · ${kpis.faltasHoy} falta`}/>
        <KpiCard label="Materiales en Alerta" value={String(kpis.materialesAlerta)} icon="package" color={kpis.materialesAlerta>0?'#E74C3C':'#2ECC71'} sub={`${kpis.matsCritico} críticos · ${kpis.matsReponer} por reponer`}/>
        <KpiCard label="Herramientas en Uso" value={String(kpis.herrEnUso)} unit={`/${kpis.herrTotal}`} icon="tool" color="#F28C28"/>
      </div>
      {/* ── KPIs principales obra activa: avance, costo, atrasos, vencimiento ── */}
      {canManagement && obraActiva ? (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10 }}>
            Obra activa · {obraActiva.nombre_obra}
          </div>
          <div className="g4" style={{ marginBottom: 14 }}>
            {/* 1. Avance Físico ponderado */}
            <div className="kpi-card">
              <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
                <div style={{ fontSize: 11.5, color:'var(--tm)', fontWeight: 500 }}>Avance Físico (ponderado)</div>
                <div style={{ width:32, height:32, borderRadius:8, background: avanceColor(avancePonderadoPct)+'1a', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <JxIcon name="hardHat" size={15} color={avanceColor(avancePonderadoPct)}/>
                </div>
              </div>
              <div className="kpi-val" style={{ color: avanceColor(avancePonderadoPct) }}>
                {avancePonderadoPct.toFixed(1)}<span style={{ fontSize:14, fontWeight:500, color:'var(--tm)', marginLeft:4 }}>%</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--tm)', marginBottom: 8 }}>
                {partidasTerminadasView} de {totalPartidasView} partidas terminadas
                {vistaPonderada ? '' : ' · cálculo local'}
              </div>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: Math.min(100, avancePonderadoPct) + '%', background: avanceColor(avancePonderadoPct) }}/>
              </div>
            </div>

            {/* 2. Costo ejecutado vs presupuesto */}
            <div className="kpi-card">
              <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
                <div style={{ fontSize: 11.5, color:'var(--tm)', fontWeight: 500 }}>Costo Ejecutado / Presupuesto</div>
                <div style={{ width:32, height:32, borderRadius:8, background:'#2ECC711a', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <JxIcon name="dollar" size={15} color="#2ECC71"/>
                </div>
              </div>
              <div className="kpi-val">
                {kpis.pctPresupuesto.toFixed(1)}<span style={{ fontSize:14, fontWeight:500, color:'var(--tm)', marginLeft:4 }}>%</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--tm)', marginBottom: 8 }}>
                {fmtSoles(kpis.totalReal)} de {fmtSoles(kpis.totalPres)}
              </div>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: Math.min(100, kpis.pctPresupuesto) + '%', background: kpis.pctPresupuesto > 100 ? '#E74C3C' : '#2ECC71' }}/>
              </div>
            </div>

            {/* 3. Partidas atrasadas */}
            <div className="kpi-card">
              <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
                <div style={{ fontSize: 11.5, color:'var(--tm)', fontWeight: 500 }}>Partidas Atrasadas</div>
                <div style={{ width:32, height:32, borderRadius:8, background: (kpis.partidasAtrasadas>0?'#E74C3C':'#2ECC71')+'1a', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <JxIcon name="alertCircle" size={15} color={kpis.partidasAtrasadas>0?'#E74C3C':'#2ECC71'}/>
                </div>
              </div>
              <div className="kpi-val" style={{ color: kpis.partidasAtrasadas > 0 ? '#E74C3C' : 'var(--tp)' }}>
                {kpis.partidasAtrasadas}
              </div>
              <div style={{ fontSize: 11, color: 'var(--tm)' }}>
                {kpis.partidasAtrasadas > 0 ? 'Necesitan atención' : 'Sin atrasos · al día'}
              </div>
            </div>

            {/* 4. Días al vencimiento */}
            <div className="kpi-card">
              <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
                <div style={{ fontSize: 11.5, color:'var(--tm)', fontWeight: 500 }}>Días al Vencimiento</div>
                <div style={{ width:32, height:32, borderRadius:8, background: diasUrgenciaColor(kpis.diasAlVencimiento)+'1a', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <JxIcon name="calendar" size={15} color={diasUrgenciaColor(kpis.diasAlVencimiento)}/>
                </div>
              </div>
              <div className="kpi-val" style={{ color: diasUrgenciaColor(kpis.diasAlVencimiento) }}>
                {kpis.diasAlVencimiento == null
                  ? '—'
                  : (kpis.diasAlVencimiento < 0 ? Math.abs(kpis.diasAlVencimiento) : kpis.diasAlVencimiento)}
                <span style={{ fontSize:13, fontWeight:500, color:'var(--tm)', marginLeft:4 }}>
                  {kpis.diasAlVencimiento == null ? '' : (kpis.diasAlVencimiento < 0 ? ' días vencida' : ' días')}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--tm)' }}>
                {kpis.ffObra ? `Fin estimado: ${kpis.ffObra}` : 'Sin fecha estimada'}
              </div>
            </div>
          </div>

          {/* Sobrecosto / extra */}
          <div className="g4" style={{ marginBottom: 22 }}>
            <KpiCard label="Avance Reportado (obra)" value={kpis.avanceFisico.toFixed(0)} unit="%" icon="chart" color="#3498DB" sub="Reportado manual en obra"/>
            <KpiCard label={kpis.sobrecosto>=0?"Sobrecosto":"Ahorro"} value={fmtSoles(Math.abs(kpis.sobrecosto))} icon={kpis.sobrecosto>=0?"alert":"checkCircle"} color={kpis.sobrecosto>=0?'#E74C3C':'#2ECC71'} sub={kpis.sobrecosto>=0?"Real > presupuesto":"Bajo presupuesto"}/>
            <KpiCard label="Partidas en Ejecución" value={String(kpis.partidasEnEjecucion)} icon="hardHat" color="#3498DB" sub={`${kpis.partidasPendientes} pendientes · ${kpis.partidasObservadas} observadas`}/>
            <KpiCard label="Incidencias Abiertas" value={String(kpis.incAbiertas)} icon="alert" color={kpis.incAbiertas>0?'#F28C28':'#2ECC71'}/>
          </div>

          {/* ── Top 5 atrasadas + Distribución por estado ── */}
          {(kpis.topAtrasadas.length > 0 || kpis.partidasTotal > 0) && (
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>
              <div className="card card-p">
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <JxIcon name="alertCircle" size={14} color="#E74C3C"/>Top 5 Partidas Atrasadas
                </div>
                <div style={{ fontSize: 11, color: 'var(--tm)', marginBottom: 12 }}>Ordenadas por días vencidos</div>
                {kpis.topAtrasadas.length === 0 ? (
                  <div className="empty-state" style={{ padding: '30px 0' }}>
                    <JxIcon name="checkCircle" size={28} color="#2ECC71"/>
                    <p>Ninguna partida atrasada · todo al día</p>
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ color: 'var(--tm)', textAlign: 'left', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                          <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>Código</th>
                          <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>Partida</th>
                          <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>Fin plan.</th>
                          <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>Días</th>
                          <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>Avance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {kpis.topAtrasadas.map(p => {
                          const av = Number(p.porcentaje_avance || 0);
                          const clickable = !!window.__setPage;
                          return (
                            <tr key={p.id}
                                onClick={clickable ? () => window.__setPage('partidas') : undefined}
                                style={{ cursor: clickable ? 'pointer' : 'default' }}>
                              <td style={{ padding: '8px', borderBottom: '1px solid var(--border)', color: 'var(--ts)', fontFamily: 'monospace', fontSize: 11 }}>{p.codigo_partida || '—'}</td>
                              <td style={{ padding: '8px', borderBottom: '1px solid var(--border)', color: 'var(--tp)' }}>{p.nombre_partida}</td>
                              <td style={{ padding: '8px', borderBottom: '1px solid var(--border)', color: 'var(--ts)' }}>{p.fecha_fin_planificada || '—'}</td>
                              <td style={{ padding: '8px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: '#E74C3C', fontWeight: 600 }}>
                                {p._diasVencidos != null ? `+${p._diasVencidos}d` : '—'}
                              </td>
                              <td style={{ padding: '8px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: avanceColor(av), fontWeight: 600 }}>{av.toFixed(0)}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="card card-p">
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <JxIcon name="chart" size={14} color="var(--amber)"/>Distribución de Partidas
                </div>
                <div style={{ fontSize: 11, color: 'var(--tm)', marginBottom: 14 }}>Por estado</div>
                {kpis.partidasTotal === 0 ? (
                  <div className="empty-state" style={{ padding: '30px 0' }}>Sin partidas</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {[
                      { label: 'Terminadas', n: kpis.partidasTerminadas, color: '#2ECC71' },
                      { label: 'En ejecución', n: kpis.partidasEnEjecucion, color: '#3498DB' },
                      { label: 'Pendientes', n: kpis.partidasPendientes, color: '#7A8A9A' },
                      { label: 'Atrasadas', n: kpis.partidasAtrasadas, color: '#E74C3C' },
                      { label: 'Observadas', n: kpis.partidasObservadas, color: '#F2B705' },
                    ].map(row => {
                      const pct = kpis.partidasTotal > 0 ? (row.n / kpis.partidasTotal * 100) : 0;
                      return (
                        <div key={row.label}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 4, color: 'var(--ts)' }}>
                            <span>{row.label}</span>
                            <span style={{ color: 'var(--tm)' }}>{row.n} <span style={{ opacity: .6 }}>({pct.toFixed(0)}%)</span></span>
                          </div>
                          <div className="progress-bar">
                            <div className="progress-fill" style={{ width: pct + '%', background: row.color }}/>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      ) : !canManagement ? null : (
        <div className="card card-p" style={{ marginBottom: 22, textAlign: 'center', padding: '32px 20px' }}>
          <JxIcon name="building" size={32} color="var(--tm)"/>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ts)', marginTop: 8 }}>Sin obra activa</div>
          <div style={{ fontSize: 12, color: 'var(--tm)', marginTop: 4 }}>Selecciona o crea una obra para ver KPIs y cronograma.</div>
        </div>
      )}

      {/* Charts: Avance por partida + Estado materiales */}
      <div style={{ display: 'grid', gridTemplateColumns: canPartidas ? '2fr 1fr' : '1fr', gap: 16, marginBottom: 16 }}>
        {canPartidas && (
          <div className="chart-card">
            <div className="chart-title">Avance por Partida</div>
            <div className="chart-sub">% de avance por partida (presupuesto vs ejecutado)</div>
            {partidaChart.length > 0 ? (
              <ChartBar id="part-av" labels={partidaChart.map(p => p.nombre_partida.substring(0,30))}
                datasets={[
                  { label:'% Avance', data: partidaChart.map(p => Number(p.porcentaje_avance || 0)), backgroundColor:'rgba(52,152,219,0.6)', borderColor:'rgba(52,152,219,0.8)', borderWidth:1 },
                ]} height={210}/>
            ) : <div className="empty-state" style={{padding:'40px 0'}}>Sin partidas con presupuesto</div>}
          </div>
        )}
        <div className="chart-card">
          <div className="chart-title">Estado de Materiales</div>
          <div className="chart-sub">Distribución por nivel de alerta</div>
          {materiales.length > 0 ? (
            <ChartDoughnut id="estado-mat"
              labels={['Stock OK', 'Por Reponer', 'Crítico', 'Sin Stock']}
              data={[kpis.matsOk, kpis.matsReponer, kpis.matsCritico, kpis.matsSinStock]}
              colors={['#2ECC71', '#F1C40F', '#F28C28', '#E74C3C']}
              height={210}/>
          ) : <div className="empty-state" style={{padding:'40px 0'}}>Sin materiales</div>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: canCostos ? '1fr 1fr' : '1fr', gap: 16, marginBottom: 16 }}>
        {canCostos && (
          <div className="chart-card">
            <div className="chart-title">Costo por Partida</div>
            <div className="chart-sub">Presupuestado vs Real (S/)</div>
            {partidaChart.length > 0 ? (
              <ChartBar id="costos-part" labels={partidaChart.map(p => p.nombre_partida.substring(0,18))}
                datasets={[
                  { label:'Presupuestado', data: partidaChart.map(p => Number(p.costo_total_presupuestado || 0)), backgroundColor:'rgba(52,152,219,0.6)', borderColor:'rgba(52,152,219,0.8)', borderWidth:1 },
                  { label:'Real', data: partidaChart.map(p => Number(p.costo_real_acumulado || 0)), backgroundColor:'rgba(242,183,5,0.6)', borderColor:'rgba(242,183,5,0.8)', borderWidth:1 },
                ]} height={195}/>
            ) : <div className="empty-state" style={{padding:'40px 0'}}>Sin partidas</div>}
          </div>
        )}
        <div className="chart-card">
          <div className="chart-title">Asistencia Hoy</div>
          <div className="chart-sub">{fechaTexto.split(',')[0]}</div>
          <ChartDoughnut id="asist-hoy"
            labels={['Asistió','Tardanza','Falta','Permiso']}
            data={[
              kpis.presentesHoy,
              kpis.tardanzasHoy,
              kpis.faltasHoy,
              kpis.asistHoy.filter(a => a.estado_asistencia === 'permiso').length,
            ]}
            colors={['#2ECC71','#F1C40F','#E74C3C','#3498DB']}
            height={195}/>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: canManagement ? '1fr 1fr' : '1fr', gap: 16 }}>
        {canManagement && (
          <div className="card card-p">
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <JxIcon name="activity" size={14} color="var(--amber)" />Actividad Reciente
            </div>
            {movRecientes.length === 0 ? (
              <div className="empty-state" style={{padding:'30px 0'}}>Sin actividad reciente</div>
            ) : movRecientes.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, paddingBottom: 12, marginBottom: 12, borderBottom: i < movRecientes.length-1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: ACT_COLORS[a.type] + '1a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                  <JxIcon name={ACT_ICONS[a.type]} size={13} color={ACT_COLORS[a.type]} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: 'var(--ts)', lineHeight: 1.4 }}>{a.text}</div>
                  <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 3 }}>{a.time}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="chart-card">
          <div className="chart-title">Herramientas Más Utilizadas</div>
          <div className="chart-sub">Total de salidas registradas</div>
          {topHerramientas.length > 0 ? (
            <ChartBar id="tools" labels={topHerramientas.map(t => t.nombre)}
              datasets={[{ label:'Salidas', data: topHerramientas.map(t => t.n), backgroundColor:['rgba(242,183,5,.65)','rgba(242,140,40,.65)','rgba(52,152,219,.65)','rgba(46,204,113,.65)','rgba(149,165,166,.5)'], borderWidth:0 }]}
              height={210} horizontal={true}/>
          ) : <div className="empty-state" style={{padding:'40px 0'}}>Sin movimientos de herramientas</div>}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { DashboardPage, ChartLine, ChartBar, ChartDoughnut });