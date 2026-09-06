import React from "react";
import { cargarBancarizados, agregarContable } from "../lib/reportes-contable.js";
import { generateReportePDF, downloadPDF } from "../lib/reports.js";
import { JxIcon, fmtN, fmtS, fmtSk, ChartTop, chartsToPNG, KpiCards } from "./jx-reportes-shared.jsx";
const { useState: uS, useMemo: uM, useEffect: uE, useRef: uRf } = React;

const EST_PAGO = { pending: { cls: 'b-amber', lbl: 'Pendiente' }, paid: { cls: 'b-green', lbl: 'Pagado' }, cancelled: { cls: 'b-gray', lbl: 'Anulado' } };

export function ContableView({ ctx }) {
  const { period, periodoLabel, company, userName, showToast, pushHistorial, companiesById, obrasById } = ctx;
  const [ambito, setAmbito] = uS('todas'); // 'todas' | obra id
  const [pdfBusy, setPdfBusy] = uS(false);
  const [cargando, setCargando] = uS(false);
  const [movs, setMovs] = uS([]);
  const [banc, setBanc] = uS(() => new Set());
  const [pagos, setPagos] = uS([]);
  // El consumo por obra se parte por modelo B y para eso hace falta saber
  // quién EJECUTA cada obra (`consorcios`). Se lee acá y no por `ctx` para no
  // tocar la firma que comparten los otros reportes.
  const { data: consorcios = [] } = (window.__hooks?.useConsorcios?.() ?? { data: [] });
  const chartInsts = uRf({});
  const onInstance = (id, inst) => { if (inst) chartInsts.current[id] = inst; else delete chartInsts.current[id]; };

  uE(() => {
    let cancel = false;
    const cargar = async () => {
      setCargando(true);
      try {
        const [m, b, p] = await Promise.all([
          window.__db.accounting_movements.filter(x => !x.deleted_at).toArray().catch(() => []),
          cargarBancarizados(window.__db),
          window.__db.pagos.filter(x => !x.deleted_at).toArray().catch(() => []),
        ]);
        if (!cancel) { setMovs(m); setBanc(b); setPagos(p); }
      } catch { if (!cancel) { setMovs([]); setBanc(new Set()); setPagos([]); } }
      finally { if (!cancel) setCargando(false); }
    };
    cargar();
    // Recargar SOLO ante cambios relevantes (no en cada guardado de cualquier
    // módulo): la carga barre accounting_movements/pagos/evidencias completos.
    const RELEV = new Set(['accounting_movements', 'pagos', 'evidencias']);
    let deb; const on = (e) => { const t = e?.detail?.tabla; if (t && !RELEV.has(t)) return; clearTimeout(deb); deb = setTimeout(cargar, 500); };
    window.addEventListener('jx_data_changed', on); window.addEventListener('jarvex_master_updated', on);
    return () => { cancel = true; clearTimeout(deb); window.removeEventListener('jx_data_changed', on); window.removeEventListener('jarvex_master_updated', on); };
  }, []);

  const movsAmbito = uM(() => ambito === 'todas' ? movs : movs.filter(m => m.obra_id === ambito), [movs, ambito]);
  const pagosAmbito = uM(() => ambito === 'todas' ? pagos : pagos.filter(p => p.obra_id === ambito), [pagos, ambito]);
  const agg = uM(() => agregarContable({ movimientos: movsAmbito, bancarizadoSet: banc, pagos: pagosAmbito, companiesById, obrasById, consorcios, from: period.from, to: period.to, topN: 10 }), [movsAmbito, banc, pagosAmbito, companiesById, obrasById, consorcios, period]);

  const ambitoLbl = ambito === 'todas' ? 'Todas las obras' : (obrasById.get(ambito)?.nombre_obra || obrasById.get(ambito)?.nombre || 'Obra');

  async function exportarPDF() {
    setPdfBusy(true);
    try {
      const meta = [`Ámbito: ${ambitoLbl}`, `Período: ${periodoLabel}${period.from ? ` (${period.from} a ${period.to})` : ''}`];
      const kpis = [
        { label: 'Compras', value: fmtS(agg.kpis.totalCompras) }, { label: 'Ventas', value: fmtS(agg.kpis.totalVentas) },
        { label: 'N° facturas', value: fmtN(agg.kpis.nFacturas) }, { label: 'Falta bancarizar', value: `${agg.kpis.bancPendCount} · ${fmtSk(agg.kpis.bancPendMonto)}` },
        { label: 'Pagado', value: fmtS(agg.kpis.pagadoTotal) }, { label: 'Pago pendiente', value: fmtS(agg.kpis.pagoPendiente) },
      ];
      const charts = chartsToPNG(chartInsts, [['ch-emp', 'Consumo por empresa'], ['ch-prov', 'TOP proveedores'], ['ch-cat', 'TOP categorías']]);
      const tablas = [
        { titulo: 'Consumo por obra (las dos columnas NO se suman)', columnas: ['Obra', 'N°', 'Costo de la obra', 'Aporte del grupo'], filas: agg.consumoPorObra.map(o => [o.nombre, o.nCosto, o.hayTitular ? fmtS(o.costo) : '—', fmtS(o.aporte)]) },
        { titulo: 'Consumo por empresa del grupo', columnas: ['Empresa', 'N°', 'Monto'], filas: agg.consumoPorEmpresa.map(c => [c.nombre, c.n, fmtS(c.monto)]) },
        { titulo: 'Facturas recientes', columnas: ['Fecha', 'Proveedor', 'Doc.', 'Empresa', 'Monto', 'Estado', 'Bancariz.'], filas: agg.facturasRecientes.map(f => [f.fecha, f.proveedor, f.doc, f.empresa, fmtS(f.monto), (EST_PAGO[f.estado]?.lbl || f.estado), f.faltaBanc ? 'FALTA' : 'ok']) },
      ];
      const doc = await generateReportePDF({ company, titulo: 'REPORTE CONTABLE', subtitulo: ambitoLbl, meta, kpis, charts, tablas, footer: `Generado por ${userName} — JARVEX` });
      downloadPDF(doc, `JARVEX_contable_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.pdf`);
      pushHistorial({ nombre: `Contable · ${periodoLabel}`, fecha: new Date().toLocaleString('es-PE'), user: userName, formato: 'PDF', obra: ambitoLbl });
      showToast('PDF generado', 'green');
    } catch (e) { showToast('Error PDF: ' + (e.message || e), 'red'); }
    finally { setPdfBusy(false); }
  }

  return (<>
    <div className="card card-p" style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <div style={{ flex: '1 1 240px', minWidth: 200 }}>
        <label className="flabel">Ámbito</label>
        <select className="fi" value={ambito} onChange={e => setAmbito(e.target.value)}>
          <option value="todas">Todas las obras</option>
          {[...obrasById.values()].map(o => <option key={o.id} value={o.id}>{o.nombre_obra || o.nombre}</option>)}
        </select>
      </div>
      <div style={{ flex: '0 0 auto', marginLeft: 'auto' }}>
        <button className="btn btn-amber btn-sm" disabled={pdfBusy || cargando} onClick={exportarPDF} style={{ height: 38 }}><JxIcon name="download" size={13} /> {pdfBusy ? 'Generando…' : 'Descargar PDF'}</button>
      </div>
    </div>

    <KpiCards items={[
      { lbl: 'COMPRAS', val: fmtSk(agg.kpis.totalCompras), color: 'var(--red)' },
      { lbl: 'VENTAS', val: fmtSk(agg.kpis.totalVentas), color: 'var(--green)' },
      { lbl: 'N° FACTURAS', val: fmtN(agg.kpis.nFacturas), color: 'var(--tp)' },
      { lbl: 'FALTA BANCARIZAR', val: `${agg.kpis.bancPendCount} · ${fmtSk(agg.kpis.bancPendMonto)}`, color: 'var(--amber)' },
      { lbl: 'PAGADO', val: fmtSk(agg.kpis.pagadoTotal), color: 'var(--green)' },
      { lbl: 'PAGO PENDIENTE', val: fmtSk(agg.kpis.pagoPendiente), color: 'var(--red)' },
    ]} />

    {cargando ? (
      <div className="card card-p empty-state"><JxIcon name="dollar" size={32} color="var(--tm)" /><p>Cargando contabilidad…</p></div>
    ) : (<>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginBottom: 16 }}>
        <div className="card card-p"><div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tp)', marginBottom: 10 }}>Consumo por empresa</div><ChartTop chartId="ch-emp" labels={agg.consumoPorEmpresa.slice(0, 10).map(c => c.nombre)} data={agg.consumoPorEmpresa.slice(0, 10).map(c => Math.round(c.monto))} color="rgba(155,89,182,0.75)" onInstance={onInstance} /></div>
        <div className="card card-p"><div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tp)', marginBottom: 10 }}>TOP proveedores</div><ChartTop chartId="ch-prov" labels={agg.topProveedores.map(p => p.nombre)} data={agg.topProveedores.map(p => Math.round(p.monto))} color="rgba(52,152,219,0.75)" onInstance={onInstance} /></div>
        <div className="card card-p"><div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tp)', marginBottom: 10 }}>TOP categorías de gasto</div><ChartTop chartId="ch-cat" labels={agg.topCategorias.map(c => c.nombre)} data={agg.topCategorias.map(c => Math.round(c.monto))} color="rgba(242,183,5,0.75)" onInstance={onInstance} /></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 16 }}>
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, color: 'var(--tp)', borderBottom: '1px solid var(--border)' }}>Consumo por obra</div>
          <div style={{ overflowX: 'auto' }}><table className="tbl"><thead><tr><th>Obra</th><th style={{ textAlign: 'right' }}>N°</th><th style={{ textAlign: 'right' }}>Costo de la obra</th><th style={{ textAlign: 'right' }}>Aporte del grupo</th></tr></thead><tbody>
            {agg.consumoPorObra.length === 0 ? (<tr><td colSpan={4} style={{ textAlign: 'center', padding: 16, color: 'var(--tm)' }}>Sin consumo</td></tr>) : agg.consumoPorObra.map((o, i) => (<tr key={i}><td className="col-p">{o.nombre}</td><td style={{ textAlign: 'right', color: 'var(--tm)' }}>{o.nCosto}</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{o.hayTitular ? fmtS(o.costo) : '—'}</td><td style={{ textAlign: 'right', color: 'var(--tm)' }} title={`${o.nAporte} comprobante(s)`}>{fmtS(o.aporte)}</td></tr>))}
          </tbody></table></div>
          <p style={{ fontSize: 10.5, color: 'var(--tm)', margin: 0, padding: '8px 14px', borderTop: '1px solid var(--border)' }}>
            ⚠ Las dos columnas no se suman: el aporte del grupo recién es costo de la obra cuando la empresa le factura a la ejecutora.
          </p>
        </div>
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, color: 'var(--tp)', borderBottom: '1px solid var(--border)' }}>Consumo por empresa del grupo</div>
          <div style={{ overflowX: 'auto' }}><table className="tbl"><thead><tr><th>Empresa</th><th style={{ textAlign: 'right' }}>N°</th><th style={{ textAlign: 'right' }}>Monto</th></tr></thead><tbody>
            {agg.consumoPorEmpresa.length === 0 ? (<tr><td colSpan={3} style={{ textAlign: 'center', padding: 16, color: 'var(--tm)' }}>Sin consumo</td></tr>) : agg.consumoPorEmpresa.map((c, i) => (<tr key={i}><td className="col-p">{c.nombre}</td><td style={{ textAlign: 'right', color: 'var(--tm)' }}>{c.n}</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtS(c.monto)}</td></tr>))}
          </tbody></table></div>
        </div>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, color: 'var(--tp)', borderBottom: '1px solid var(--border)' }}>Facturas recientes</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>Fecha</th><th>Proveedor</th><th>Doc.</th><th>Empresa</th><th>Obra</th><th style={{ textAlign: 'right' }}>Monto</th><th>Estado</th><th>Bancariz.</th></tr></thead>
            <tbody>
              {agg.facturasRecientes.length === 0 ? (<tr><td colSpan={8} style={{ textAlign: 'center', padding: 20, color: 'var(--tm)' }}>Sin facturas en el período</td></tr>)
                : agg.facturasRecientes.map(f => { const e = EST_PAGO[f.estado] || { cls: 'b-gray', lbl: f.estado }; return (<tr key={f.id}><td className="col-m">{f.fecha}</td><td className="col-p">{f.proveedor}</td><td style={{ fontFamily: 'monospace' }}>{f.doc}</td><td>{f.empresa}</td><td>{f.obra}</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtS(f.monto)}</td><td><span className={`badge ${e.cls}`}>{e.lbl}</span></td><td>{f.faltaBanc ? <span className="badge b-red">Falta</span> : <span className="badge b-green">ok</span>}</td></tr>); })}
            </tbody>
          </table>
        </div>
      </div>
    </>)}
  </>);
}
