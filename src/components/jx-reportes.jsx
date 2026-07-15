import React from "react";
import { useChart } from "../lib/chart-loader.js";
import { CATS_MOV, cargarMovimientosObra, agregarMovimientos } from "../lib/reportes-movimientos.js";
import { generateReportePDF, downloadPDF } from "../lib/reports.js";
import { hoyLocal } from "../lib/fecha.js";
const { useState: uSR, useMemo: uMR, useEffect: uER, useRef: uRR } = React;

const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);
const fmtN = (n) => Number(n || 0).toLocaleString('es-PE', { maximumFractionDigits: 2 });
const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DIR_LABEL = { entrada: 'Entrada', salida: 'Salida', devolucion: 'Devolución', otro: 'Otro', reverso: 'Reverso' };
const TIPO_OPCIONES = [{ key: 'todos', label: 'Todos' }, ...CATS_MOV.map(c => ({ key: c.key, label: c.label }))];
const AGOTAR_META = {
  agotado: { cls: 'b-red', lbl: '⛔ Agotado' },
  critico: { cls: 'b-amber', lbl: '⚠ Crítico' },
  ok: { cls: 'b-green', lbl: '✓ OK' },
  desconocido: { cls: 'b-gray', lbl: '—' },
};
// Etiqueta plana para el PDF (sin emoji; no derivar por regex del label con emoji).
const AGOTAR_PDF = { agotado: 'Agotado', critico: 'Crítico', ok: 'OK', desconocido: '—' };

// Familias de reporte (Fase 1 = Movimientos). Cada una gateada por su PERMISO
// real (no una lista de roles paralela que se desincroniza de la matriz).
// Movimientos = quien tiene lectura de movimientos de almacén.
const FAMILIAS = [
  { id: 'movimientos', label: 'Movimientos de Insumos', icon: 'package',
    puede: (rol) => rol === 'admin' || (window.__hasPerm?.(rol, 'Mov. Materiales', 'r') ?? false) },
];

function familiasVisibles(rol) {
  return FAMILIAS.filter(f => f.puede(rol));
}

// Rango del período ANCLADO en la fecha local (America/Lima) — nunca mezcla
// componentes locales de Date con toISOString UTC (ese corrimiento hacía que la
// "semana actual" vista de noche omitiera el lunes). La aritmética se hace sobre
// un Date a mediodía UTC de la fecha local, así getUTCDay/getUTCDate no cruzan día.
function getPeriod(periodo, from, to) {
  const hoy = hoyLocal(); // 'YYYY-MM-DD' en la zona configurada
  const parse = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12)); };
  const fmt = (dt) => dt.toISOString().slice(0, 10);
  if (periodo === 'dia') return { from: hoy, to: hoy };
  if (periodo === 'semana') { const dt = parse(hoy); const day = dt.getUTCDay() || 7; dt.setUTCDate(dt.getUTCDate() - day + 1); return { from: fmt(dt), to: hoy }; }
  if (periodo === 'mes') { const [y, m] = hoy.split('-'); return { from: `${y}-${m}-01`, to: hoy }; }
  if (periodo === 'custom') return { from: from || '2000-01-01', to: to || hoy };
  return { from: null, to: null }; // acumulado
}
const PERIODO_LABEL = { dia: 'Hoy', semana: 'Semana actual', mes: 'Mes actual', acumulado: 'Acumulado', custom: 'Rango personalizado' };

function loadHistorial() { try { return JSON.parse(localStorage.getItem('reportes_historial') || '[]'); } catch { return []; } }
function saveHistorial(a) { try { localStorage.setItem('reportes_historial', JSON.stringify(a)); } catch {} }

// ── Gráfico de barras horizontal (registra su instancia para exportar a PDF) ──
function ChartTop({ chartId, labels, data, color, onInstance, height = 200 }) {
  const Chart = useChart();
  const ref = uRR(null);
  const inst = uRR(null);
  uER(() => {
    if (!Chart || !ref.current || !labels.length) return;
    if (inst.current) inst.current.destroy();
    inst.current = new Chart(ref.current, {
      type: 'bar',
      data: { labels, datasets: [{ data, backgroundColor: color, borderRadius: 4, maxBarThickness: 22 }] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false }, tooltip: { enabled: true } },
        scales: {
          x: { ticks: { color: '#7A8A9A', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' }, border: { display: false } },
          y: { ticks: { color: '#9AA7B4', font: { size: 10 } }, grid: { display: false }, border: { display: false } },
        },
      },
    });
    onInstance?.(chartId, inst.current);
    return () => { try { inst.current?.destroy(); } catch {} onInstance?.(chartId, null); };
  }, [Chart, labels.join('|'), data.join('|'), color]);
  if (!labels.length) return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tm)', fontSize: 12 }}>Sin datos en el período</div>;
  return <div style={{ height }}><canvas ref={ref} /></div>;
}

function ReportesPage({ showToast }) {
  const toast = showToast || window.__showToast || (() => {});
  const auth = window.__useAuth ? window.__useAuth() : {};
  const rol = auth?.profile?.rol || '';
  const userName = `${auth?.profile?.nombres || ''} ${auth?.profile?.apellidos || ''}`.trim() || auth?.profile?.email || 'Usuario';

  const familias = uMR(() => familiasVisibles(rol), [rol]);
  const [familia, setFamilia] = uSR(() => familias[0]?.id || null);
  const [tab, setTab] = uSR('dashboard'); // dashboard | historial

  const { data: obras } = window.__hooks?.useObras?.() || { data: [] };
  const { data: personal } = window.__hooks?.usePersonal?.(undefined) || { data: [] };
  const { data: subcontratistas } = window.__hooks?.useSubcontratistas?.() || { data: [] };

  const [obraId, setObraId] = uSR(() => window.__getObraActivaId?.() || '');
  const [periodo, setPeriodo] = uSR('mes');
  const [customFrom, setCustomFrom] = uSR('');
  const [customTo, setCustomTo] = uSR('');
  const [tipo, setTipo] = uSR('todos');
  const [modo, setModo] = uSR('resumen'); // resumen | detallado
  const [pdfBusy, setPdfBusy] = uSR(false);
  const [historial, setHistorial] = uSR(loadHistorial());

  // Frentes de la obra (para nombres de TOP frentes).
  const { data: frentes } = window.__hooks?.useFrentesObra?.(obraId, { soloActivas: false }) || { data: [] };

  const obrasVivas = uMR(() => (obras || []).filter(o => !o.deleted_at), [obras]);
  uER(() => { if (!obraId && obrasVivas.length) setObraId(obrasVivas[0].id); }, [obrasVivas, obraId]);
  const obraActual = uMR(() => obrasVivas.find(o => o.id === obraId), [obrasVivas, obraId]);

  // Carga de movimientos + catálogo de la obra (se recarga al cambiar obra o datos).
  const [datos, setDatos] = uSR({ catalogo: [], movimientos: [] });
  const [cargando, setCargando] = uSR(false);
  uER(() => {
    if (!obraId) { setDatos({ catalogo: [], movimientos: [] }); return; }
    let cancel = false;
    const cargar = async () => {
      setCargando(true);
      try { const r = await cargarMovimientosObra(window.__db, obraId); if (!cancel) setDatos(r); }
      catch { if (!cancel) setDatos({ catalogo: [], movimientos: [] }); }
      finally { if (!cancel) setCargando(false); }
    };
    cargar();
    let deb; const on = () => { clearTimeout(deb); deb = setTimeout(cargar, 400); };
    window.addEventListener('jx_data_changed', on);
    window.addEventListener('jarvex_master_updated', on);
    return () => { cancel = true; clearTimeout(deb); window.removeEventListener('jx_data_changed', on); window.removeEventListener('jarvex_master_updated', on); };
  }, [obraId]);

  const personalById = uMR(() => { const m = new Map(); (personal || []).forEach(p => m.set(p.id, p)); return m; }, [personal]);
  const subById = uMR(() => { const m = new Map(); (subcontratistas || []).forEach(s => m.set(s.id, s)); return m; }, [subcontratistas]);
  const frenteById = uMR(() => { const m = new Map(); (frentes || []).forEach(f => m.set(f.id, f.nombre || '—')); return m; }, [frentes]);

  const period = uMR(() => getPeriod(periodo, customFrom, customTo), [periodo, customFrom, customTo]);
  const agg = uMR(() => agregarMovimientos({
    movimientos: datos.movimientos, catalogo: datos.catalogo,
    personalById, subById, frenteById, tipo, from: period.from, to: period.to, topN: 10,
  }), [datos, personalById, subById, frenteById, tipo, period]);

  // Instancias de gráficos (para exportar a PDF).
  const chartInsts = uRR({});
  const onInstance = (id, inst) => { if (inst) chartInsts.current[id] = inst; else delete chartInsts.current[id]; };

  const nombrePersona = (m) => {
    if (m.subId) return (subById.get(m.subId)?.razon_social || 'Subcontrato') + ' (subc.)';
    if (m.personaId) { const p = personalById.get(m.personaId); return p ? `${p.nombres || ''} ${p.apellidos || ''}`.trim() : '(persona)'; }
    return '—';
  };
  const nombreFrente = (m) => (m.frenteId ? (frenteById.get(m.frenteId) || 'Frente') : 'Sin frente');
  const tipoLabelDe = (k) => (CATS_MOV.find(c => c.key === k)?.label || k);

  const detalleCap = 500;
  const detalleRender = uMR(() => agg.detalle.slice(0, detalleCap), [agg]);

  async function exportarPDF() {
    if (!obraActual) { toast('Selecciona una obra', 'red'); return; }
    setPdfBusy(true);
    try {
      let company = {};
      try { const cs = await window.__db.companies.toArray(); company = cs.find(c => !c.deleted_at && c.status === 'activa') || cs[0] || {}; } catch {}
      const tipoLbl = TIPO_OPCIONES.find(t => t.key === tipo)?.label || 'Todos';
      const meta = [
        `Obra: ${obraActual.nombre_obra || obraActual.nombre || '—'}`,
        `Período: ${PERIODO_LABEL[periodo]}${period.from ? ` (${period.from} a ${period.to})` : ''}`,
        `Tipo de insumo: ${tipoLbl} · Modo: ${modo === 'resumen' ? 'Resumen' : 'Detallado'}`,
      ];
      const kpis = [
        { label: 'Salidas', value: fmtN(agg.kpis.totalSalidas) },
        { label: 'Entradas', value: fmtN(agg.kpis.totalEntradas) },
        { label: 'Movimientos', value: fmtN(agg.kpis.nMovimientos) },
        { label: 'Insumos distintos', value: fmtN(agg.kpis.insumosDistintos) },
        { label: 'Valor salidas', value: fmtS(agg.kpis.valorSalidas) },
      ];
      const charts = [];
      const tablas = [];
      if (modo === 'resumen') {
        for (const [id, titulo] of [['chart-insumos', 'TOP insumos más movidos'], ['chart-personal', 'TOP personal por salidas'], ['chart-frentes', 'TOP frentes por consumo']]) {
          const inst = chartInsts.current[id];
          if (!inst) continue;
          // El PDF va sobre página BLANCA: paso ticks/grid oscuros solo para
          // capturar la imagen, luego restauro el tema oscuro del dashboard.
          try {
            const sc = inst.options.scales;
            const prev = { xt: sc.x.ticks.color, yt: sc.y.ticks.color, xg: sc.x.grid.color };
            sc.x.ticks.color = '#334155'; sc.y.ticks.color = '#1E293B'; sc.x.grid.color = 'rgba(0,0,0,0.08)';
            inst.update('none');
            charts.push({ titulo, png: inst.toBase64Image('image/png', 1), height: 55 });
            sc.x.ticks.color = prev.xt; sc.y.ticks.color = prev.yt; sc.x.grid.color = prev.xg;
            inst.update('none');
          } catch { try { charts.push({ titulo, png: inst.toBase64Image('image/png', 1), height: 55 }); } catch {} }
        }
        tablas.push({
          titulo: 'Más salen y por agotarse',
          columnas: ['Insumo', 'Salidas período', 'Stock actual', 'Stock mín.', 'Estado'],
          filas: agg.porAgotarse.map(r => [r.nombre, fmtN(r.salidas), r.stock == null ? '—' : fmtN(r.stock), fmtN(r.stockMin), AGOTAR_PDF[r.estado] || '—']),
        });
      } else {
        tablas.push({
          titulo: `Detalle de movimientos (${agg.detalle.length})`,
          columnas: ['Fecha', 'Tipo', 'Insumo', 'Mov.', 'Cantidad', 'Unidad', 'Responsable / Destino', 'Frente'],
          filas: agg.detalle.slice(0, 1000).map(m => [m.fecha, tipoLabelDe(m.cat), m.insumoNombre, DIR_LABEL[m.dir] || m.dir, fmtN(m.cantidad), m.unidad || '', nombrePersona(m), nombreFrente(m)]),
        });
        if (agg.detalle.length > 1000) tablas[0].titulo += ' — se muestran las primeras 1000';
      }
      const doc = await generateReportePDF({
        company, titulo: 'REPORTE DE MOVIMIENTOS', subtitulo: 'Movimientos de Insumos', meta, kpis, charts, tablas,
        footer: `Generado por ${userName} — JARVEX`,
      });
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      downloadPDF(doc, `JARVEX_movimientos_${tipo}_${stamp}.pdf`);
      const entry = { nombre: `Movimientos · ${tipoLbl} · ${PERIODO_LABEL[periodo]}`, fecha: new Date().toLocaleString('es-PE'), user: userName, formato: 'PDF', obra: obraActual.nombre_obra || obraActual.nombre };
      const upd = [entry, ...historial].slice(0, 100); setHistorial(upd); saveHistorial(upd);
      toast('PDF generado', 'green');
    } catch (e) { toast('Error PDF: ' + (e.message || e), 'red'); }
    finally { setPdfBusy(false); }
  }

  if (!familias.length) {
    return <div className="page-wrap"><div className="card card-p empty-state"><JxIcon name="chart" size={40} color="var(--tm)" /><p>Tu rol no tiene reportes asignados por ahora.</p></div></div>;
  }

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Reportes</div>
          <div className="pg-sub">Dashboard interactivo y exportación a PDF</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {['dashboard', 'historial'].map(t => (
            <button key={t} onClick={() => setTab(t)} className={`btn ${tab === t ? 'btn-amber' : 'btn-ghost'} btn-sm`} style={{ textTransform: 'capitalize' }}>{t}</button>
          ))}
        </div>
      </div>

      {/* Selector de familia (Fase 1: solo Movimientos, pero listo para crecer) */}
      {familias.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {familias.map(f => (
            <button key={f.id} className={`btn btn-sm ${familia === f.id ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setFamilia(f.id)}>
              <JxIcon name={f.icon} size={12} /> {f.label}
            </button>
          ))}
        </div>
      )}

      {tab === 'dashboard' && (<>
        {/* Controles */}
        <div className="card card-p" style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 240px', minWidth: 200 }}>
            <label className="flabel">Obra</label>
            <select className="fi" value={obraId} onChange={e => setObraId(e.target.value)}>
              {obrasVivas.length === 0 && <option value="">— Sin obras —</option>}
              {obrasVivas.map(o => <option key={o.id} value={o.id}>{o.nombre_obra || o.nombre}</option>)}
            </select>
          </div>
          <div style={{ flex: '0 0 150px' }}>
            <label className="flabel">Período</label>
            <select className="fi" value={periodo} onChange={e => setPeriodo(e.target.value)}>
              <option value="dia">Hoy</option><option value="semana">Semana actual</option>
              <option value="mes">Mes actual</option><option value="acumulado">Acumulado</option>
              <option value="custom">Rango personalizado</option>
            </select>
          </div>
          {periodo === 'custom' && <>
            <div style={{ flex: '0 0 140px' }}><label className="flabel">Desde</label><input type="date" className="fi" value={customFrom} onChange={e => setCustomFrom(e.target.value)} /></div>
            <div style={{ flex: '0 0 140px' }}><label className="flabel">Hasta</label><input type="date" className="fi" value={customTo} onChange={e => setCustomTo(e.target.value)} /></div>
          </>}
          <div style={{ flex: '0 0 150px' }}>
            <label className="flabel">Tipo de insumo</label>
            <select className="fi" value={tipo} onChange={e => setTipo(e.target.value)}>
              {TIPO_OPCIONES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          <div style={{ flex: '0 0 auto' }}>
            <label className="flabel">Modo</label>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className={`btn btn-sm ${modo === 'resumen' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setModo('resumen')}>Resumen</button>
              <button className={`btn btn-sm ${modo === 'detallado' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setModo('detallado')}>Detallado</button>
            </div>
          </div>
          <div style={{ flex: '0 0 auto', marginLeft: 'auto' }}>
            <button className="btn btn-amber btn-sm" disabled={pdfBusy || cargando} onClick={exportarPDF} style={{ height: 38 }}>
              <JxIcon name="download" size={13} /> {pdfBusy ? 'Generando…' : 'Descargar PDF'}
            </button>
          </div>
        </div>

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
          {[
            { lbl: 'SALIDAS', val: fmtN(agg.kpis.totalSalidas), color: 'var(--amber)' },
            { lbl: 'ENTRADAS', val: fmtN(agg.kpis.totalEntradas), color: 'var(--green)' },
            { lbl: 'DEVOLUCIONES', val: fmtN(agg.kpis.totalDevoluciones), color: 'var(--blue)' },
            { lbl: 'MOVIMIENTOS', val: fmtN(agg.kpis.nMovimientos), color: 'var(--tp)' },
            { lbl: 'INSUMOS DISTINTOS', val: fmtN(agg.kpis.insumosDistintos), color: 'var(--tp)' },
            { lbl: 'VALOR SALIDAS', val: fmtS(agg.kpis.valorSalidas), color: 'var(--amber)' },
          ].map((k, i) => (
            <div key={i} className="card card-p" style={{ borderLeft: `3px solid ${k.color}` }}>
              <div style={{ fontSize: 10.5, color: 'var(--tm)', letterSpacing: '.05em' }}>{k.lbl}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: k.color, marginTop: 4 }}>{k.val}</div>
            </div>
          ))}
        </div>

        {cargando ? (
          <div className="card card-p empty-state"><JxIcon name="package" size={32} color="var(--tm)" /><p>Cargando movimientos…</p></div>
        ) : modo === 'resumen' ? (<>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginBottom: 16 }}>
            <div className="card card-p">
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tp)', marginBottom: 10 }}>TOP insumos más movidos</div>
              <ChartTop chartId="chart-insumos" labels={agg.topInsumos.map(i => i.nombre)} data={agg.topInsumos.map(i => i.cantidad)} color="rgba(242,183,5,0.75)" onInstance={onInstance} />
            </div>
            <div className="card card-p">
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tp)', marginBottom: 10 }}>TOP personal por salidas</div>
              <ChartTop chartId="chart-personal" labels={agg.topPersonal.map(p => p.nombre)} data={agg.topPersonal.map(p => p.cantidad)} color="rgba(52,152,219,0.75)" onInstance={onInstance} />
            </div>
            <div className="card card-p">
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tp)', marginBottom: 10 }}>TOP frentes por consumo</div>
              <ChartTop chartId="chart-frentes" labels={agg.topFrentes.map(f => f.nombre)} data={agg.topFrentes.map(f => f.cantidad)} color="rgba(46,204,113,0.75)" onInstance={onInstance} />
            </div>
          </div>

          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, color: 'var(--tp)', borderBottom: '1px solid var(--border)' }}>Más salen y por agotarse</div>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr><th>Insumo</th><th style={{ textAlign: 'right' }}>Salidas período</th><th style={{ textAlign: 'right' }}>Stock actual</th><th style={{ textAlign: 'right' }}>Stock mín.</th><th>Estado</th></tr></thead>
                <tbody>
                  {agg.porAgotarse.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: 'center', padding: 20, color: 'var(--tm)' }}>Sin salidas en el período</td></tr>
                  ) : agg.porAgotarse.map((r, i) => (
                    <tr key={i}>
                      <td className="col-p">{r.nombre}</td>
                      <td style={{ textAlign: 'right' }}>{fmtN(r.salidas)}</td>
                      <td style={{ textAlign: 'right', color: r.estado === 'agotado' ? 'var(--red)' : r.estado === 'critico' ? 'var(--amber)' : 'var(--ts)' }}>{r.stock == null ? '—' : fmtN(r.stock)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--tm)' }}>{fmtN(r.stockMin)}</td>
                      <td><span className={`badge ${AGOTAR_META[r.estado].cls}`}>{AGOTAR_META[r.estado].lbl}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, color: 'var(--tp)', borderBottom: '1px solid var(--border)' }}>
              Detalle de movimientos · {agg.detalle.length}{agg.detalle.length > detalleCap ? ` (se muestran ${detalleCap}, el PDF incluye hasta 1000)` : ''}
            </div>
            <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 360px)' }}>
              <table className="tbl">
                <thead><tr><th>Fecha</th><th>Tipo</th><th>Insumo</th><th>Mov.</th><th style={{ textAlign: 'right' }}>Cantidad</th><th>Unidad</th><th>Responsable / Destino</th><th>Frente</th></tr></thead>
                <tbody>
                  {detalleRender.length === 0 ? (
                    <tr><td colSpan={8} style={{ textAlign: 'center', padding: 20, color: 'var(--tm)' }}>Sin movimientos en el período</td></tr>
                  ) : detalleRender.map(m => (
                    <tr key={m.cat + ':' + m.id}>
                      <td className="col-m">{m.fecha}</td>
                      <td>{tipoLabelDe(m.cat)}</td>
                      <td className="col-p">{m.insumoNombre}</td>
                      <td><span className={`badge ${m.dir === 'salida' ? 'b-orange' : m.dir === 'entrada' ? 'b-green' : m.dir === 'devolucion' ? 'b-blue' : 'b-gray'}`}>{DIR_LABEL[m.dir] || m.dir}</span></td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtN(m.cantidad)}</td>
                      <td>{m.unidad || '—'}</td>
                      <td>{nombrePersona(m)}</td>
                      <td>{nombreFrente(m)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </>)}

      {tab === 'historial' && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 10 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { if (confirm('¿Limpiar historial?')) { setHistorial([]); saveHistorial([]); } }}><JxIcon name="trash" size={12} /> Limpiar</button>
          </div>
          <table className="tbl">
            <thead><tr><th>Reporte</th><th>Obra</th><th>Generado</th><th>Usuario</th><th>Tipo</th></tr></thead>
            <tbody>
              {historial.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--tm)' }}>Sin reportes generados aún</td></tr>
              ) : historial.map((h, i) => (
                <tr key={i}><td className="col-p"><JxIcon name="file" size={13} color="var(--red)" /> {h.nombre}</td><td className="col-m">{h.obra || '—'}</td><td className="col-m">{h.fecha}</td><td>{h.user}</td><td><span className="badge b-red">{h.formato}</span></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { ReportesPage });
