import React from "react";
import { CATS_MOV, cargarMovimientosObra, agregarMovimientos } from "../lib/reportes-movimientos.js";
import { generateReportePDF, downloadPDF } from "../lib/reports.js";
import { JxIcon, fmtN, fmtS, ChartTop, chartsToPNG, KpiCards } from "./jx-reportes-shared.jsx";
const { useState: uS, useMemo: uM, useEffect: uE, useRef: uRf } = React;

const DIR_LABEL = { entrada: 'Entrada', salida: 'Salida', devolucion: 'Devolución', otro: 'Otro', reverso: 'Reverso' };
const TIPO_OPCIONES = [{ key: 'todos', label: 'Todos' }, ...CATS_MOV.map(c => ({ key: c.key, label: c.label }))];
const AGOTAR_META = { agotado: { cls: 'b-red', lbl: '⛔ Agotado' }, critico: { cls: 'b-amber', lbl: '⚠ Crítico' }, ok: { cls: 'b-green', lbl: '✓ OK' }, desconocido: { cls: 'b-gray', lbl: '—' } };
const AGOTAR_PDF = { agotado: 'Agotado', critico: 'Crítico', ok: 'OK', desconocido: '—' };

export function MovimientosView({ ctx }) {
  const { obraId, obraActual, period, periodoLabel, company, userName, showToast, pushHistorial, personalById, subById, frenteById } = ctx;
  const [tipo, setTipo] = uS('todos');
  const [modo, setModo] = uS('resumen');
  const [pdfBusy, setPdfBusy] = uS(false);
  const [datos, setDatos] = uS({ catalogo: [], movimientos: [] });
  const [cargando, setCargando] = uS(false);
  const chartInsts = uRf({});
  const onInstance = (id, inst) => { if (inst) chartInsts.current[id] = inst; else delete chartInsts.current[id]; };

  uE(() => {
    if (!obraId) { setDatos({ catalogo: [], movimientos: [] }); return; }
    let cancel = false;
    const cargar = async () => { setCargando(true); try { const r = await cargarMovimientosObra(window.__db, obraId); if (!cancel) setDatos(r); } catch { if (!cancel) setDatos({ catalogo: [], movimientos: [] }); } finally { if (!cancel) setCargando(false); } };
    cargar();
    let deb; const on = () => { clearTimeout(deb); deb = setTimeout(cargar, 400); };
    window.addEventListener('jx_data_changed', on); window.addEventListener('jarvex_master_updated', on);
    return () => { cancel = true; clearTimeout(deb); window.removeEventListener('jx_data_changed', on); window.removeEventListener('jarvex_master_updated', on); };
  }, [obraId]);

  const agg = uM(() => agregarMovimientos({ movimientos: datos.movimientos, catalogo: datos.catalogo, personalById, subById, frenteById, tipo, from: period.from, to: period.to, topN: 10 }), [datos, personalById, subById, frenteById, tipo, period]);

  const tipoLabelDe = (k) => (CATS_MOV.find(c => c.key === k)?.label || k);
  const nombrePersona = (m) => { if (m.subId) return (subById.get(m.subId)?.razon_social || 'Subcontrato') + ' (subc.)'; if (m.personaId) { const p = personalById.get(m.personaId); return p ? `${p.nombres || ''} ${p.apellidos || ''}`.trim() : '(persona)'; } return '—'; };
  const nombreFrente = (m) => (m.frenteId ? (frenteById.get(m.frenteId) || 'Frente') : 'Sin frente');
  const detalleCap = 500;
  const detalleRender = uM(() => agg.detalle.slice(0, detalleCap), [agg]);

  async function exportarPDF() {
    if (!obraActual) { showToast('Selecciona una obra', 'red'); return; }
    setPdfBusy(true);
    try {
      const tipoLbl = TIPO_OPCIONES.find(t => t.key === tipo)?.label || 'Todos';
      const meta = [`Obra: ${obraActual.nombre_obra || obraActual.nombre || '—'}`, `Período: ${periodoLabel}${period.from ? ` (${period.from} a ${period.to})` : ''}`, `Tipo: ${tipoLbl} · Modo: ${modo === 'resumen' ? 'Resumen' : 'Detallado'}`];
      const kpis = [
        { label: 'Salidas', value: fmtN(agg.kpis.totalSalidas) }, { label: 'Entradas', value: fmtN(agg.kpis.totalEntradas) },
        { label: 'Movimientos', value: fmtN(agg.kpis.nMovimientos) }, { label: 'Insumos distintos', value: fmtN(agg.kpis.insumosDistintos) },
        { label: 'Valor salidas', value: fmtS(agg.kpis.valorSalidas) },
      ];
      const charts = [], tablas = [];
      if (modo === 'resumen') {
        charts.push(...chartsToPNG(chartInsts, [['chart-insumos', 'TOP insumos más movidos'], ['chart-personal', 'TOP personal por salidas'], ['chart-frentes', 'TOP frentes por consumo']]));
        tablas.push({ titulo: 'Más salen y por agotarse', columnas: ['Insumo', 'Salidas', 'Stock', 'Mín.', 'Estado'], filas: agg.porAgotarse.map(r => [r.nombre, fmtN(r.salidas), r.stock == null ? '—' : fmtN(r.stock), fmtN(r.stockMin), AGOTAR_PDF[r.estado] || '—']) });
      } else {
        tablas.push({ titulo: `Detalle de movimientos (${agg.detalle.length})`, columnas: ['Fecha', 'Tipo', 'Insumo', 'Mov.', 'Cantidad', 'Unidad', 'Responsable', 'Frente'], filas: agg.detalle.slice(0, 1000).map(m => [m.fecha, tipoLabelDe(m.cat), m.insumoNombre, DIR_LABEL[m.dir] || m.dir, fmtN(m.cantidad), m.unidad || '', nombrePersona(m), nombreFrente(m)]) });
      }
      const doc = await generateReportePDF({ company, titulo: 'REPORTE DE MOVIMIENTOS', subtitulo: 'Movimientos de Insumos', meta, kpis, charts, tablas, footer: `Generado por ${userName} — JARVEX` });
      downloadPDF(doc, `JARVEX_movimientos_${tipo}_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.pdf`);
      pushHistorial({ nombre: `Movimientos · ${tipoLbl} · ${periodoLabel}`, fecha: new Date().toLocaleString('es-PE'), user: userName, formato: 'PDF', obra: obraActual.nombre_obra || obraActual.nombre });
      showToast('PDF generado', 'green');
    } catch (e) { showToast('Error PDF: ' + (e.message || e), 'red'); }
    finally { setPdfBusy(false); }
  }

  return (<>
    <div className="card card-p" style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <div style={{ flex: '0 0 160px' }}>
        <label className="flabel">Tipo de insumo</label>
        <select className="fi" value={tipo} onChange={e => setTipo(e.target.value)}>{TIPO_OPCIONES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
      </div>
      <div style={{ flex: '0 0 auto' }}>
        <label className="flabel">Modo</label>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className={`btn btn-sm ${modo === 'resumen' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setModo('resumen')}>Resumen</button>
          <button className={`btn btn-sm ${modo === 'detallado' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setModo('detallado')}>Detallado</button>
        </div>
      </div>
      <div style={{ flex: '0 0 auto', marginLeft: 'auto' }}>
        <button className="btn btn-amber btn-sm" disabled={pdfBusy || cargando} onClick={exportarPDF} style={{ height: 38 }}><JxIcon name="download" size={13} /> {pdfBusy ? 'Generando…' : 'Descargar PDF'}</button>
      </div>
    </div>

    <KpiCards items={[
      { lbl: 'SALIDAS', val: fmtN(agg.kpis.totalSalidas), color: 'var(--amber)' },
      { lbl: 'ENTRADAS', val: fmtN(agg.kpis.totalEntradas), color: 'var(--green)' },
      { lbl: 'DEVOLUCIONES', val: fmtN(agg.kpis.totalDevoluciones), color: 'var(--blue)' },
      { lbl: 'MOVIMIENTOS', val: fmtN(agg.kpis.nMovimientos), color: 'var(--tp)' },
      { lbl: 'INSUMOS DISTINTOS', val: fmtN(agg.kpis.insumosDistintos), color: 'var(--tp)' },
      { lbl: 'VALOR SALIDAS', val: fmtS(agg.kpis.valorSalidas), color: 'var(--amber)' },
    ]} />

    {cargando ? (
      <div className="card card-p empty-state"><JxIcon name="package" size={32} color="var(--tm)" /><p>Cargando movimientos…</p></div>
    ) : modo === 'resumen' ? (<>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginBottom: 16 }}>
        <div className="card card-p"><div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tp)', marginBottom: 10 }}>TOP insumos más movidos</div><ChartTop chartId="chart-insumos" labels={agg.topInsumos.map(i => i.nombre)} data={agg.topInsumos.map(i => i.cantidad)} color="rgba(242,183,5,0.75)" onInstance={onInstance} /></div>
        <div className="card card-p"><div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tp)', marginBottom: 10 }}>TOP personal por salidas</div><ChartTop chartId="chart-personal" labels={agg.topPersonal.map(p => p.nombre)} data={agg.topPersonal.map(p => p.cantidad)} color="rgba(52,152,219,0.75)" onInstance={onInstance} /></div>
        <div className="card card-p"><div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tp)', marginBottom: 10 }}>TOP frentes por consumo</div><ChartTop chartId="chart-frentes" labels={agg.topFrentes.map(f => f.nombre)} data={agg.topFrentes.map(f => f.cantidad)} color="rgba(46,204,113,0.75)" onInstance={onInstance} /></div>
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, color: 'var(--tp)', borderBottom: '1px solid var(--border)' }}>Más salen y por agotarse</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>Insumo</th><th style={{ textAlign: 'right' }}>Salidas</th><th style={{ textAlign: 'right' }}>Stock</th><th style={{ textAlign: 'right' }}>Mín.</th><th>Estado</th></tr></thead>
            <tbody>
              {agg.porAgotarse.length === 0 ? (<tr><td colSpan={5} style={{ textAlign: 'center', padding: 20, color: 'var(--tm)' }}>Sin salidas en el período</td></tr>)
                : agg.porAgotarse.map((r, i) => (<tr key={i}><td className="col-p">{r.nombre}</td><td style={{ textAlign: 'right' }}>{fmtN(r.salidas)}</td><td style={{ textAlign: 'right', color: r.estado === 'agotado' ? 'var(--red)' : r.estado === 'critico' ? 'var(--amber)' : 'var(--ts)' }}>{r.stock == null ? '—' : fmtN(r.stock)}</td><td style={{ textAlign: 'right', color: 'var(--tm)' }}>{fmtN(r.stockMin)}</td><td><span className={`badge ${AGOTAR_META[r.estado].cls}`}>{AGOTAR_META[r.estado].lbl}</span></td></tr>))}
            </tbody>
          </table>
        </div>
      </div>
    </>) : (
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, color: 'var(--tp)', borderBottom: '1px solid var(--border)' }}>Detalle · {agg.detalle.length}{agg.detalle.length > detalleCap ? ` (se muestran ${detalleCap}, PDF hasta 1000)` : ''}</div>
        <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 380px)' }}>
          <table className="tbl">
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Insumo</th><th>Mov.</th><th style={{ textAlign: 'right' }}>Cant.</th><th>Unidad</th><th>Responsable</th><th>Frente</th></tr></thead>
            <tbody>
              {detalleRender.length === 0 ? (<tr><td colSpan={8} style={{ textAlign: 'center', padding: 20, color: 'var(--tm)' }}>Sin movimientos en el período</td></tr>)
                : detalleRender.map(m => (<tr key={m.cat + ':' + m.id}><td className="col-m">{m.fecha}</td><td>{tipoLabelDe(m.cat)}</td><td className="col-p">{m.insumoNombre}</td><td><span className={`badge ${m.dir === 'salida' ? 'b-orange' : m.dir === 'entrada' ? 'b-green' : m.dir === 'devolucion' ? 'b-blue' : 'b-gray'}`}>{DIR_LABEL[m.dir] || m.dir}</span></td><td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtN(m.cantidad)}</td><td>{m.unidad || '—'}</td><td>{nombrePersona(m)}</td><td>{nombreFrente(m)}</td></tr>))}
            </tbody>
          </table>
        </div>
      </div>
    )}
  </>);
}
