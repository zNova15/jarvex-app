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

function DashboardPage() {
  const [obraId, setObraId] = uSD(null);

  uED(() => {
    let cancelled = false;
    const find = async () => {
      const obras = await window.__db.obras.toArray();
      const stored = window.__getObraActivaId?.();
      const a = (stored && obras.find(o => o.id === stored && !o.deleted_at))
             || obras.find(o => !o.deleted_at);
      if (a) { if (!cancelled) setObraId(a.id); }
      else if (!cancelled) setTimeout(find, 500);
    };
    find();
    return () => { cancelled = true; };
  }, []);

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
    const partidasAtrasadas = partidas.filter(p => p.estado === 'atrasado');
    const incAbiertas = incidencias.filter(i => i.estado === 'abierta').length;

    const totalPres = partidas.reduce((s,p) => s + Number(p.costo_total_presupuestado || 0), 0);
    const totalReal = partidas.reduce((s,p) => s + Number(p.costo_real_acumulado || 0), 0);
    const sobrecosto = totalReal - totalPres;

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
      totalPres, totalReal, sobrecosto,
      pctPresupuesto: totalPres > 0 ? (totalReal / totalPres * 100) : 0,
      incAbiertas,
    };
  }, [obras, personal, materiales, herramientas, partidas, asistencia, incidencias, obraActiva, today]);

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
          {kpis.materialesAlerta + kpis.partidasAtrasadas + kpis.incAbiertas > 0 && (
            <button className="btn btn-amber btn-sm"><JxIcon name="bell" size={13}/> {kpis.materialesAlerta + kpis.partidasAtrasadas + kpis.incAbiertas} Alertas</button>
          )}
        </div>
      </div>

      {kpis.materialesAlerta > 0 && (
        <div className="alert-banner" style={{marginBottom:18}}>
          <JxIcon name="alert" size={16} color="#E74C3C"/>
          <span><strong>{kpis.matsSinStock + kpis.matsCritico} material{kpis.matsSinStock+kpis.matsCritico>1?'es':''} en estado crítico:</strong> {materiales.filter(m=>m.alerta==='critico'||m.alerta==='sin_stock').slice(0,3).map(m=>`${m.nombre_material} (${m.stock_actual} ${m.unidad})`).join(' · ')}{kpis.materialesAlerta>3?` · y ${kpis.materialesAlerta-3} más`:''}</span>
        </div>
      )}

      <div className="g4" style={{ marginBottom: 20 }}>
        <KpiCard label="Obras Activas" value={String(kpis.obrasActivas)} icon="building" color="#3498DB" sub={`${obras.length} totales`}/>
        <KpiCard label="Personal Presente Hoy" value={String(kpis.presentesHoy)} unit={`/${kpis.personalTotal}`} icon="users" color="#2ECC71" sub={`${kpis.tardanzasHoy} tardanza · ${kpis.faltasHoy} falta`}/>
        <KpiCard label="Materiales en Alerta" value={String(kpis.materialesAlerta)} icon="package" color={kpis.materialesAlerta>0?'#E74C3C':'#2ECC71'} sub={`${kpis.matsCritico} críticos · ${kpis.matsReponer} por reponer`}/>
        <KpiCard label="Herramientas en Uso" value={String(kpis.herrEnUso)} unit={`/${kpis.herrTotal}`} icon="tool" color="#F28C28"/>
      </div>
      <div className="g4" style={{ marginBottom: 22 }}>
        <KpiCard label="Avance General de Obra" value={kpis.avanceFisico.toFixed(0)} unit="%" icon="hardHat" color="#F2B705"/>
        <KpiCard label="Partidas Atrasadas" value={String(kpis.partidasAtrasadas)} icon="gantt" color={kpis.partidasAtrasadas>0?'#E74C3C':'#2ECC71'} sub={kpis.partidasAtrasadasNombres}/>
        <KpiCard label="Presupuesto Ejecutado" value={'S/ ' + (kpis.totalReal/1000).toFixed(0) + 'K'} icon="dollar" color="#2ECC71" sub={`de S/ ${(kpis.totalPres/1000).toFixed(0)}K · ${kpis.pctPresupuesto.toFixed(1)}%`}/>
        <KpiCard label={kpis.sobrecosto>=0?"Sobrecosto":"Ahorro"} value={'S/ ' + Math.abs(kpis.sobrecosto/1000).toFixed(1) + 'K'} icon={kpis.sobrecosto>=0?"trendUp":"trendDown"} color={kpis.sobrecosto>=0?'#E74C3C':'#2ECC71'}/>
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
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