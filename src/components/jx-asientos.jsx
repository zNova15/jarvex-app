import React from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { generarAsientosBatch } from "../lib/asientos";
import { PCGE_DEFAULT } from "../lib/pcge-default";

const { useState: uS, useMemo: uM } = React;

// ─── Helpers ─────────────────────────────────────────────────
const fmtS = (n) =>
  'S/ ' + Number(n || 0).toLocaleString('es-PE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const fmtDate = (d) => {
  if (!d) return '';
  try {
    const date = (d instanceof Date) ? d : new Date(d);
    if (isNaN(date.getTime())) return String(d);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  } catch (_) { return String(d); }
};

const MESES = [
  { v: 'all', label: 'Todo el año' },
  { v: '01', label: 'Enero' }, { v: '02', label: 'Febrero' },
  { v: '03', label: 'Marzo' }, { v: '04', label: 'Abril' },
  { v: '05', label: 'Mayo' },  { v: '06', label: 'Junio' },
  { v: '07', label: 'Julio' }, { v: '08', label: 'Agosto' },
  { v: '09', label: 'Septiembre' }, { v: '10', label: 'Octubre' },
  { v: '11', label: 'Noviembre' },  { v: '12', label: 'Diciembre' },
];

const TIPO_FILTRO = [
  { v: 'all',     label: 'Todos los asientos' },
  { v: 'income',  label: 'Solo ingresos' },
  { v: 'cost',    label: 'Solo costos' },
  { v: 'expense', label: 'Solo gastos' },
];

const TIPO_BADGE = { income: 'b-green', cost: 'b-red', expense: 'b-amber' };
const TIPO_LABEL = { income: 'Ingreso', cost: 'Costo', expense: 'Gasto' };

// Lookup de cuentas PCGE para mostrar nombre legible
const cuentaNombre = (codigo) => {
  if (!codigo) return '';
  const exact = PCGE_DEFAULT.find(c => c.codigo === codigo);
  if (exact) return exact.nombre;
  // Sube al padre (101 → 10)
  const padre = PCGE_DEFAULT.find(c => c.codigo === codigo.slice(0, 2));
  return padre ? padre.nombre : '';
};

// ╔════════════════════════════════════════════════════════════╗
// ║  LIBRO DIARIO                                              ║
// ╚════════════════════════════════════════════════════════════╝
function LibroDiarioPage({ showToast }) {
  const { data: companies } = window.__hooks.useCompanies();
  const { data: movs } = window.__hooks.useAccountingMovements();

  const ahora = new Date();
  const [empresaId, setEmpresaId] = uS('all');
  const [anio, setAnio] = uS(String(ahora.getFullYear()));
  const [mes, setMes] = uS('all');
  const [tipoFiltro, setTipoFiltro] = uS('all');

  // Años disponibles a partir de los movimientos
  const aniosDisp = uM(() => {
    const set = new Set();
    (movs || []).forEach(m => {
      const d = m.date || m.created_at;
      if (d) {
        const y = new Date(d).getFullYear();
        if (!isNaN(y)) set.add(String(y));
      }
    });
    set.add(String(ahora.getFullYear()));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [movs]);

  // Movimientos filtrados por empresa + período + tipo
  const movsFiltrados = uM(() => {
    return (movs || []).filter(m => {
      if (m.deleted_at) return false;
      if (m.payment_status === 'cancelled') return false;
      if (empresaId !== 'all' && m.company_id !== empresaId) return false;
      if (tipoFiltro !== 'all' && m.type !== tipoFiltro) return false;
      const d = new Date(m.date || m.created_at);
      if (isNaN(d.getTime())) return false;
      if (String(d.getFullYear()) !== String(anio)) return false;
      if (mes !== 'all') {
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        if (mm !== mes) return false;
      }
      return true;
    });
  }, [movs, empresaId, anio, mes, tipoFiltro]);

  // Asientos generados al vuelo
  const asientos = uM(() => generarAsientosBatch(movsFiltrados), [movsFiltrados]);

  // Totales globales
  const totales = uM(() => {
    let totDebe = 0, totHaber = 0, lineas = 0;
    asientos.forEach(a => {
      a.partidas.forEach(p => {
        totDebe += p.debe;
        totHaber += p.haber;
        lineas += 1;
      });
    });
    return {
      totDebe: Math.round(totDebe * 100) / 100,
      totHaber: Math.round(totHaber * 100) / 100,
      lineas,
      cuadra: Math.abs(totDebe - totHaber) < 0.05,
    };
  }, [asientos]);

  const empresaActual = uM(() => {
    if (empresaId === 'all') return null;
    return (companies || []).find(c => c.id === empresaId);
  }, [companies, empresaId]);

  // ─── Periodo legible ───────────────────────────────────────
  const periodoLabel = uM(() => {
    const m = MESES.find(x => x.v === mes);
    return mes === 'all'
      ? `Año ${anio}`
      : `${m?.label || mes} ${anio}`;
  }, [anio, mes]);

  // ─── Exportar PDF ──────────────────────────────────────────
  const exportarPDF = () => {
    try {
      if (asientos.length === 0) {
        showToast?.('No hay asientos para exportar', 'amber');
        return;
      }
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageWidth = 297;

      // Header
      doc.setFillColor(14, 22, 32);
      doc.rect(0, 0, pageWidth, 26, 'F');
      doc.setTextColor(242, 183, 5);
      doc.setFontSize(15);
      doc.setFont('helvetica', 'bold');
      doc.text('JARVEX', 14, 12);
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(empresaActual?.name || 'Todas las empresas', 14, 18);
      if (empresaActual?.ruc) doc.text(`RUC: ${empresaActual.ruc}`, 14, 22);

      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(242, 183, 5);
      doc.text('LIBRO DIARIO', pageWidth - 14, 12, { align: 'right' });
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(255, 255, 255);
      doc.text(`Período: ${periodoLabel}`, pageWidth - 14, 18, { align: 'right' });
      doc.setFontSize(8);
      doc.setTextColor(220, 220, 220);
      doc.text(`Generado: ${new Date().toLocaleString('es-PE')}`, pageWidth - 14, 23, { align: 'right' });
      doc.setTextColor(0, 0, 0);

      // Construir filas (una por partida, agrupadas)
      const body = [];
      asientos.forEach((a, idx) => {
        a.partidas.forEach((p, j) => {
          body.push([
            j === 0 ? String(idx + 1) : '',
            j === 0 ? fmtDate(a.fecha) : '',
            j === 0 ? a.glosa.slice(0, 60) : '',
            p.cuenta,
            p.descripcion.slice(0, 40),
            p.debe > 0 ? fmtS(p.debe) : '',
            p.haber > 0 ? fmtS(p.haber) : '',
          ]);
        });
      });

      // Fila total
      body.push([
        '', '', { content: 'TOTALES', styles: { fontStyle: 'bold', halign: 'right' } },
        '', '',
        { content: fmtS(totales.totDebe), styles: { fontStyle: 'bold', halign: 'right', fillColor: [235, 240, 245] } },
        { content: fmtS(totales.totHaber), styles: { fontStyle: 'bold', halign: 'right', fillColor: [235, 240, 245] } },
      ]);

      autoTable(doc, {
        startY: 30,
        head: [['N°', 'Fecha', 'Glosa', 'Cuenta', 'Descripción', 'Debe', 'Haber']],
        body,
        headStyles: { fillColor: [28, 45, 64], textColor: 255, fontSize: 9 },
        bodyStyles: { fontSize: 7.5 },
        alternateRowStyles: { fillColor: [248, 248, 248] },
        columnStyles: {
          0: { cellWidth: 12, halign: 'center' },
          1: { cellWidth: 22 },
          2: { cellWidth: 'auto' },
          3: { cellWidth: 16, halign: 'center' },
          4: { cellWidth: 70 },
          5: { cellWidth: 26, halign: 'right' },
          6: { cellWidth: 26, halign: 'right' },
        },
        margin: { left: 10, right: 10 },
      });

      // Footer
      const pages = doc.internal.getNumberOfPages();
      const ph = doc.internal.pageSize.getHeight();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(128, 128, 128);
        doc.text(`Libro Diario · ${periodoLabel}`, 14, ph - 8);
        doc.text(`Página ${i} de ${pages}`, pageWidth - 14, ph - 8, { align: 'right' });
      }

      const fname = `LibroDiario_${(empresaActual?.name || 'todas').replace(/\s+/g, '-')}_${anio}-${mes}.pdf`;
      doc.save(fname);
      showToast?.('PDF generado', 'green');
    } catch (e) {
      showToast?.('Error: ' + (e.message || e), 'red');
    }
  };

  // ─── Exportar Excel ────────────────────────────────────────
  const exportarExcel = () => {
    try {
      if (asientos.length === 0) {
        showToast?.('No hay asientos para exportar', 'amber');
        return;
      }
      if (!window.__reports?.generateExcel) {
        showToast?.('Excel no disponible', 'red');
        return;
      }
      const columnas = ['N°', 'Fecha', 'Glosa', 'Tipo', 'Cuenta', 'Nombre cuenta', 'Descripción', 'Debe', 'Haber'];
      const filas = [];
      asientos.forEach((a, idx) => {
        a.partidas.forEach((p, j) => {
          filas.push([
            j === 0 ? (idx + 1) : '',
            j === 0 ? fmtDate(a.fecha) : '',
            j === 0 ? a.glosa : '',
            j === 0 ? (TIPO_LABEL[a.type] || a.type) : '',
            p.cuenta,
            cuentaNombre(p.cuenta),
            p.descripcion,
            p.debe > 0 ? p.debe : '',
            p.haber > 0 ? p.haber : '',
          ]);
        });
      });
      filas.push(['', '', '', '', '', '', 'TOTALES', totales.totDebe, totales.totHaber]);

      window.__reports.generateExcel({
        sheetName: `Libro Diario ${anio}`,
        columnas,
        filas,
        filename: `LibroDiario_${(empresaActual?.name || 'todas').replace(/\s+/g, '-')}_${anio}-${mes}.xlsx`,
      });
      showToast?.('Excel generado', 'green');
    } catch (e) {
      showToast?.('Error: ' + (e.message || e), 'red');
    }
  };

  // ─── Render ────────────────────────────────────────────────
  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Libro Diario</div>
          <div className="pg-sub">
            Asientos contables generados automáticamente desde los movimientos · PCGE Perú
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost btn-sm" onClick={exportarPDF} title="Exportar PDF">
            {window.JxIcon ? <window.JxIcon name="download" size={13}/> : null}PDF
          </button>
          <button className="btn btn-ghost btn-sm" onClick={exportarExcel} title="Exportar Excel">
            {window.JxIcon ? <window.JxIcon name="download" size={13}/> : null}Excel
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="card card-p" style={{ marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--tm)', textTransform: 'uppercase' }}>Empresa</label>
            <select className="fi" value={empresaId} onChange={e => setEmpresaId(e.target.value)} style={{ width: '100%' }}>
              <option value="all">Todas las empresas</option>
              {(companies || []).filter(c => !c.deleted_at).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--tm)', textTransform: 'uppercase' }}>Año</label>
            <select className="fi" value={anio} onChange={e => setAnio(e.target.value)} style={{ width: '100%' }}>
              {aniosDisp.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--tm)', textTransform: 'uppercase' }}>Mes</label>
            <select className="fi" value={mes} onChange={e => setMes(e.target.value)} style={{ width: '100%' }}>
              {MESES.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--tm)', textTransform: 'uppercase' }}>Tipo de asiento</label>
            <select className="fi" value={tipoFiltro} onChange={e => setTipoFiltro(e.target.value)} style={{ width: '100%' }}>
              {TIPO_FILTRO.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Resumen */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
        <div className="card card-p" style={{ borderLeft: '3px solid var(--blue)' }}>
          <div style={{ fontSize: 11, color: 'var(--tm)', textTransform: 'uppercase' }}>Movimientos</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ts)', marginTop: 4 }}>{movsFiltrados.length}</div>
        </div>
        <div className="card card-p" style={{ borderLeft: '3px solid var(--amber)' }}>
          <div style={{ fontSize: 11, color: 'var(--tm)', textTransform: 'uppercase' }}># Asientos</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ts)', marginTop: 4 }}>{asientos.length}</div>
        </div>
        <div className="card card-p" style={{ borderLeft: '3px solid var(--green)' }}>
          <div style={{ fontSize: 11, color: 'var(--tm)', textTransform: 'uppercase' }}>Total Debe</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--green)', marginTop: 4 }}>{fmtS(totales.totDebe)}</div>
        </div>
        <div className="card card-p" style={{ borderLeft: '3px solid var(--red)' }}>
          <div style={{ fontSize: 11, color: 'var(--tm)', textTransform: 'uppercase' }}>Total Haber</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--red)', marginTop: 4 }}>{fmtS(totales.totHaber)}</div>
        </div>
        <div className="card card-p" style={{ borderLeft: `3px solid ${totales.cuadra ? 'var(--green)' : 'var(--red)'}` }}>
          <div style={{ fontSize: 11, color: 'var(--tm)', textTransform: 'uppercase' }}>Cuadre</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: totales.cuadra ? 'var(--green)' : 'var(--red)', marginTop: 4 }}>
            {totales.cuadra ? 'OK' : `Δ ${fmtS(Math.abs(totales.totDebe - totales.totHaber))}`}
          </div>
        </div>
      </div>

      {/* Tabla de asientos */}
      {asientos.length === 0 ? (
        <div className="card card-p empty-state">
          <p style={{ color: 'var(--tm)' }}>
            No hay movimientos en el período seleccionado.
            Registra movimientos contables y los asientos se generarán automáticamente.
          </p>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 50 }}>N°</th>
                  <th style={{ width: 90 }}>Fecha</th>
                  <th>Glosa</th>
                  <th style={{ width: 70 }}>Cuenta</th>
                  <th>Descripción</th>
                  <th style={{ textAlign: 'right', width: 110 }}>Debe</th>
                  <th style={{ textAlign: 'right', width: 110 }}>Haber</th>
                </tr>
              </thead>
              <tbody>
                {asientos.map((a, idx) => (
                  a.partidas.map((p, j) => {
                    const isFirst = j === 0;
                    const isLast = j === a.partidas.length - 1;
                    return (
                      <tr
                        key={`${a.movimiento_id}-${j}`}
                        style={{
                          borderTop: isFirst ? '2px solid var(--bg-s)' : 'none',
                          borderBottom: isLast ? '1px solid var(--bg-s)' : 'none',
                        }}
                      >
                        <td style={{ fontWeight: isFirst ? 700 : 400, color: isFirst ? 'var(--ts)' : 'transparent' }}>
                          {isFirst ? (idx + 1) : ''}
                        </td>
                        <td className="col-m">{isFirst ? fmtDate(a.fecha) : ''}</td>
                        <td>
                          {isFirst && (
                            <>
                              <strong style={{ fontSize: 12 }}>{a.glosa}</strong>
                              <div style={{ marginTop: 2 }}>
                                <span className={`badge ${TIPO_BADGE[a.type] || 'b-gray'}`} style={{ fontSize: 10 }}>
                                  {TIPO_LABEL[a.type] || a.type}
                                </span>
                              </div>
                            </>
                          )}
                        </td>
                        <td className="col-m" style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                          {p.cuenta}
                        </td>
                        <td style={{ fontSize: 12 }}>
                          {p.descripcion}
                          <div style={{ fontSize: 10, color: 'var(--tm)' }}>{cuentaNombre(p.cuenta)}</div>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: p.debe > 0 ? 700 : 400, color: p.debe > 0 ? 'var(--green)' : 'var(--tm)' }} className="col-num">
                          {p.debe > 0 ? fmtS(p.debe) : '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: p.haber > 0 ? 700 : 400, color: p.haber > 0 ? 'var(--red)' : 'var(--tm)' }} className="col-num">
                          {p.haber > 0 ? fmtS(p.haber) : '—'}
                        </td>
                      </tr>
                    );
                  })
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--bg-s)', fontWeight: 700 }}>
                  <td colSpan={5} style={{ textAlign: 'right', padding: '10px 12px' }}>TOTALES:</td>
                  <td style={{ textAlign: 'right', color: 'var(--green)' }} className="col-num">{fmtS(totales.totDebe)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--red)' }} className="col-num">{fmtS(totales.totHaber)}</td>
                </tr>
                {!totales.cuadra && (
                  <tr style={{ background: 'rgba(231,76,60,0.08)' }}>
                    <td colSpan={5} style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--red)' }}>
                      ⚠ Diferencia (debe ≠ haber):
                    </td>
                    <td colSpan={2} style={{ textAlign: 'right', color: 'var(--red)', fontWeight: 700 }}>
                      {fmtS(Math.abs(totales.totDebe - totales.totHaber))}
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// Registro global
window.LibroDiarioPage = LibroDiarioPage;
export { LibroDiarioPage };
export default LibroDiarioPage;
