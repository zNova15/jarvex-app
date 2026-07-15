import React from "react";
import { cargarAvanceObra, agregarAvance } from "../lib/reportes-avance.js";
import { generateReportePDF, downloadPDF } from "../lib/reports.js";
import { JxIcon, fmtN, fmtS, ChartTop, chartsToPNG, KpiCards } from "./jx-reportes-shared.jsx";
const { useState: uS, useMemo: uM, useEffect: uE, useRef: uRf } = React;

const pct = (x) => (x == null ? '—' : (x * 100).toFixed(0) + '%');
const cumpMeta = (c) => (c == null ? { cls: 'b-gray', txt: 's/meta' } : c >= 0.9 ? { cls: 'b-green', txt: pct(c) } : c >= 0.6 ? { cls: 'b-amber', txt: pct(c) } : { cls: 'b-red', txt: pct(c) });

export function AvanceView({ ctx }) {
  const { obraId, obraActual, period, periodoLabel, company, userName, showToast, pushHistorial, frenteById } = ctx;
  const [pdfBusy, setPdfBusy] = uS(false);
  const [cargando, setCargando] = uS(false);
  const [datos, setDatos] = uS({ avance: [], reportesDia: [], metas: [], partidasById: new Map(), ingenierosById: new Map(), fotosPorAvance: new Set() });
  const chartInsts = uRf({});
  const onInstance = (id, inst) => { if (inst) chartInsts.current[id] = inst; else delete chartInsts.current[id]; };

  uE(() => {
    if (!obraId) { setDatos({ avance: [], reportesDia: [], metas: [], partidasById: new Map(), ingenierosById: new Map() }); return; }
    let cancel = false;
    const cargar = async () => { setCargando(true); try { const r = await cargarAvanceObra(window.__db, obraId); if (!cancel) setDatos(r); } catch { } finally { if (!cancel) setCargando(false); } };
    cargar();
    let deb; const on = () => { clearTimeout(deb); deb = setTimeout(cargar, 400); };
    window.addEventListener('jx_data_changed', on); window.addEventListener('jarvex_master_updated', on);
    return () => { cancel = true; clearTimeout(deb); window.removeEventListener('jx_data_changed', on); window.removeEventListener('jarvex_master_updated', on); };
  }, [obraId]);

  const agg = uM(() => agregarAvance({ avance: datos.avance, reportesDia: datos.reportesDia, metas: datos.metas, partidasById: datos.partidasById, frentesById: frenteById, ingenierosById: datos.ingenierosById, fotosPorAvance: datos.fotosPorAvance, from: period.from, to: period.to, topN: 10 }), [datos, frenteById, period]);
  const tieneFoto = (a) => datos.fotosPorAvance.has(a.id) || !!a.evidencia_id;

  const ingNombre = (id) => datos.ingenierosById.get(id) || '(usuario)';
  const partNombre = (id) => datos.partidasById.get(id)?.nombre || '—';
  const frNombre = (id) => (id ? (frenteById.get(id) || 'Frente') : 'Sin frente');
  const detalleRender = uM(() => agg.detalle.slice(0, 500), [agg]);

  async function exportarPDF() {
    if (!obraActual) { showToast('Selecciona una obra', 'red'); return; }
    setPdfBusy(true);
    try {
      const meta = [`Obra: ${obraActual.nombre_obra || obraActual.nombre || '—'}`, `Período: ${periodoLabel}${period.from ? ` (${period.from} a ${period.to})` : ''}`];
      const kpis = [
        { label: 'Reportes', value: fmtN(agg.kpis.reportes) }, { label: 'Metrado', value: fmtN(agg.kpis.metradoTotal) },
        { label: 'Valor avance', value: fmtS(agg.kpis.valorAvance) }, { label: 'Días sin avance', value: fmtN(agg.kpis.diasSinAvance) },
        { label: 'Frentes activos', value: fmtN(agg.kpis.frentesActivos) }, { label: 'Ingenieros', value: fmtN(agg.kpis.ingenierosActivos) },
      ];
      const charts = chartsToPNG(chartInsts, [['ch-rep', 'TOP ingenieros por reportes'], ['ch-av', 'TOP ingenieros por avance (S/)'], ['ch-fr', 'Avance por frente (metrado)']]);
      const tablas = [
        { titulo: 'Avance por frente vs meta', columnas: ['Frente', 'Metrado real', 'Meta', 'Cumplimiento', 'Reportes', 'Días sin avance'], filas: agg.porFrente.map(f => [f.nombre, fmtN(f.metradoReal), f.meta ? fmtN(f.meta) : '—', f.cumplimiento == null ? '—' : pct(f.cumplimiento), f.reportes, f.diasSinAvance]) },
        { titulo: 'Ranking de ingenieros', columnas: ['Ingeniero', 'Reportes', 'Metrado', 'Valor (S/)', 'Días sin avance'], filas: agg.ingenieros.map(e => [e.nombre, e.reportes, fmtN(e.metrado), fmtN(e.valor), e.diasSinAvance]) },
      ];
      const doc = await generateReportePDF({ company, titulo: 'REPORTE DE AVANCE', subtitulo: 'Avance Técnico de Obra', meta, kpis, charts, tablas, footer: `Generado por ${userName} — JARVEX` });
      downloadPDF(doc, `JARVEX_avance_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.pdf`);
      pushHistorial({ nombre: `Avance · ${periodoLabel}`, fecha: new Date().toLocaleString('es-PE'), user: userName, formato: 'PDF', obra: obraActual.nombre_obra || obraActual.nombre });
      showToast('PDF generado', 'green');
    } catch (e) { showToast('Error PDF: ' + (e.message || e), 'red'); }
    finally { setPdfBusy(false); }
  }

  return (<>
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
      <button className="btn btn-amber btn-sm" disabled={pdfBusy || cargando} onClick={exportarPDF}><JxIcon name="download" size={13} /> {pdfBusy ? 'Generando…' : 'Descargar PDF'}</button>
    </div>

    <KpiCards items={[
      { lbl: 'REPORTES', val: fmtN(agg.kpis.reportes), color: 'var(--blue)' },
      { lbl: 'DÍAS CON REPORTE', val: fmtN(agg.kpis.diasConReporte), color: 'var(--tp)' },
      { lbl: 'METRADO EJECUTADO', val: fmtN(agg.kpis.metradoTotal), color: 'var(--green)' },
      { lbl: 'VALOR DE AVANCE', val: fmtS(agg.kpis.valorAvance), color: 'var(--amber)' },
      { lbl: 'DÍAS SIN AVANCE', val: fmtN(agg.kpis.diasSinAvance), color: 'var(--red)' },
      { lbl: 'FRENTES / ING.', val: `${fmtN(agg.kpis.frentesActivos)} / ${fmtN(agg.kpis.ingenierosActivos)}`, color: 'var(--tp)' },
    ]} />

    {cargando ? (
      <div className="card card-p empty-state"><JxIcon name="hardHat" size={32} color="var(--tm)" /><p>Cargando avance…</p></div>
    ) : (<>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginBottom: 16 }}>
        <div className="card card-p"><div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tp)', marginBottom: 10 }}>TOP ingenieros por reportes</div><ChartTop chartId="ch-rep" labels={agg.topReportes.map(e => e.nombre)} data={agg.topReportes.map(e => e.reportes)} color="rgba(52,152,219,0.75)" onInstance={onInstance} /></div>
        <div className="card card-p"><div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tp)', marginBottom: 10 }}>TOP ingenieros por avance (S/)</div><ChartTop chartId="ch-av" labels={agg.topAvance.map(e => e.nombre)} data={agg.topAvance.map(e => Math.round(e.valor))} color="rgba(242,183,5,0.75)" onInstance={onInstance} /></div>
        <div className="card card-p"><div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tp)', marginBottom: 10 }}>Avance por frente (metrado)</div><ChartTop chartId="ch-fr" labels={agg.porFrente.slice(0, 10).map(f => f.nombre)} data={agg.porFrente.slice(0, 10).map(f => f.metradoReal)} color="rgba(46,204,113,0.75)" onInstance={onInstance} /></div>
      </div>

      {agg.atrasos.length > 0 && (
        <div className="card card-p" style={{ marginBottom: 16, background: 'rgba(231,76,60,0.06)', border: '1px solid rgba(231,76,60,0.3)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--red)', marginBottom: 6 }}>⚠ Frentes atrasados vs meta ({agg.atrasos.length})</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{agg.atrasos.map((a, i) => (<span key={i} className="badge b-red" title={`real ${fmtN(a.metradoReal)} / meta ${fmtN(a.meta)}`}>{a.nombre} · {pct(a.cumplimiento)}</span>))}</div>
        </div>
      )}

      <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, color: 'var(--tp)', borderBottom: '1px solid var(--border)' }}>Avance por frente vs meta</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>Frente</th><th style={{ textAlign: 'right' }}>Metrado real</th><th style={{ textAlign: 'right' }}>Meta</th><th>Cumplimiento</th><th style={{ textAlign: 'right' }}>Reportes</th><th style={{ textAlign: 'right' }}>Días sin avance</th></tr></thead>
            <tbody>
              {agg.porFrente.length === 0 ? (<tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: 'var(--tm)' }}>Sin avance en el período</td></tr>)
                : agg.porFrente.map((f, i) => { const c = cumpMeta(f.cumplimiento); return (<tr key={i}><td className="col-p">{f.nombre}</td><td style={{ textAlign: 'right' }}>{fmtN(f.metradoReal)}</td><td style={{ textAlign: 'right', color: 'var(--tm)' }}>{f.meta ? fmtN(f.meta) : '—'}</td><td><span className={`badge ${c.cls}`}>{c.txt}</span></td><td style={{ textAlign: 'right' }}>{f.reportes}</td><td style={{ textAlign: 'right', color: f.diasSinAvance > 0 ? 'var(--red)' : 'var(--tm)' }}>{f.diasSinAvance}</td></tr>); })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, color: 'var(--tp)', borderBottom: '1px solid var(--border)' }}>Ranking de ingenieros</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>Ingeniero</th><th style={{ textAlign: 'right' }}>Reportes</th><th style={{ textAlign: 'right' }}>Metrado</th><th style={{ textAlign: 'right' }}>Valor (S/)</th><th style={{ textAlign: 'right' }}>Días sin avance</th></tr></thead>
            <tbody>
              {agg.ingenieros.length === 0 ? (<tr><td colSpan={5} style={{ textAlign: 'center', padding: 20, color: 'var(--tm)' }}>Sin actividad en el período</td></tr>)
                : agg.ingenieros.map((e, i) => (<tr key={i}><td className="col-p">{e.nombre}</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{e.reportes}</td><td style={{ textAlign: 'right' }}>{fmtN(e.metrado)}</td><td style={{ textAlign: 'right' }}>{fmtS(e.valor)}</td><td style={{ textAlign: 'right', color: e.diasSinAvance > 0 ? 'var(--red)' : 'var(--tm)' }}>{e.diasSinAvance}</td></tr>))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, color: 'var(--tp)', borderBottom: '1px solid var(--border)' }}>Detalle de reportes · {agg.detalle.length}</div>
        <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 380px)' }}>
          <table className="tbl">
            <thead><tr><th>Fecha</th><th>Frente</th><th>Partida</th><th style={{ textAlign: 'right' }}>Metrado</th><th style={{ textAlign: 'right' }}>%</th><th>Ingeniero</th><th>Foto</th><th>Observaciones</th></tr></thead>
            <tbody>
              {detalleRender.length === 0 ? (<tr><td colSpan={8} style={{ textAlign: 'center', padding: 20, color: 'var(--tm)' }}>Sin reportes en el período</td></tr>)
                : detalleRender.map(a => (<tr key={a.id}><td className="col-m">{a.fecha}</td><td>{frNombre(a.frente_id)}</td><td className="col-p">{partNombre(a.partida_id)}</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtN(a.metrado_ejecutado)}</td><td style={{ textAlign: 'right' }}>{a.porcentaje_avance_reportado != null ? fmtN(a.porcentaje_avance_reportado) + '%' : '—'}</td><td>{ingNombre(a.responsable_id)}</td><td>{tieneFoto(a) ? '📷' : '—'}</td><td style={{ maxWidth: 260, whiteSpace: 'normal', fontSize: 11 }}>{a.observaciones || '—'}</td></tr>))}
            </tbody>
          </table>
        </div>
      </div>
    </>)}
  </>);
}
