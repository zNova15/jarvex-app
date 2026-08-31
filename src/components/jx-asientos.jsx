import React from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { generarAsientosBatch, explicarDescuadre } from "../lib/asientos";
import { describirIgv, igvDestacable } from "../lib/igv-desglose.js";
import { PCGE_DEFAULT } from "../lib/pcge-default";
import { getEvidenciaSrc } from "../lib/evidencias-url.js";
import { fmtFechaLarga, ymdDe } from "../lib/fecha.js";

const { useState: uS, useMemo: uM, useEffect: uE, useRef: uR } = React;

// Visor de PDF robusto (copia local del patrón de jx-contabilidad): PDFs
// subidos con content-type genérico se re-tipan vía blob para que el iframe
// siempre los renderice.
function PdfFrameLD({ url, nombre }) {
  const [src, setSrc] = uS(null);
  const [err, setErr] = uS(false);
  uE(() => {
    let obj = null, cancel = false;
    (async () => {
      try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const buf = await resp.arrayBuffer();
        obj = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
        if (cancel) { URL.revokeObjectURL(obj); obj = null; return; }
        setSrc(obj);
      } catch { if (!cancel) setErr(true); }
    })();
    return () => { cancel = true; if (obj) { try { URL.revokeObjectURL(obj); } catch {} } };
  }, [url]);
  if (err) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 10, color: 'var(--tm)' }}>
      <div style={{ fontSize: 12 }}>No se pudo previsualizar {nombre || 'el PDF'} acá.</div>
      <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-amber btn-sm">Abrir en nueva pestaña</a>
    </div>
  );
  if (!src) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--tm)', fontSize: 12 }}>Cargando PDF…</div>;
  return <iframe src={src} title={nombre || 'PDF'} style={{ width: '100%', height: '70vh', border: 'none', background: 'white' }} />;
}

// ─── Helpers ─────────────────────────────────────────────────
const fmtS = (n) =>
  'S/ ' + Number(n || 0).toLocaleString('es-PE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// new Date('YYYY-MM-DD') = medianoche UTC → en Perú mostraba el día ANTERIOR
// en toda la columna Fecha del Libro Diario. fmtFechaLarga parte el string.
const fmtDate = (d) => fmtFechaLarga(d);

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
  const { data: companies } = (window.__hooks?.useCompanies?.() ?? { data: [] });
  const { data: movs } = (window.__hooks?.useAccountingMovements?.() ?? { data: [] });

  const ahora = new Date();
  const [empresaId, setEmpresaId] = uS('all');
  const [anio, setAnio] = uS(String(ahora.getFullYear()));
  const [mes, setMes] = uS('all');
  const [tipoFiltro, setTipoFiltro] = uS('all');
  // Herramienta de descuadre + visor de comprobantes (pedido contadoras 31-ago).
  const [soloDescuadrados, setSoloDescuadrados] = uS(false);
  const [evPorMov, setEvPorMov] = uS(() => new Map());   // mov_id → evidencia (cruda)
  const [visor, setVisor] = uS(null);                    // { url, mime, nombre, _blob }

  // Años disponibles a partir de los movimientos
  const aniosDisp = uM(() => {
    const set = new Set();
    (movs || []).forEach(m => {
      const y = ymdDe(m.date || m.created_at).slice(0, 4);
      if (y) set.add(y);
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
      // Por string: con new Date('2026-01-01') el asiento caía en 2025.
      const ymd = ymdDe(m.date || m.created_at);
      if (!ymd) return false;
      if (ymd.slice(0, 4) !== String(anio)) return false;
      if (mes !== 'all' && ymd.slice(5, 7) !== mes) return false;
      return true;
    });
  }, [movs, empresaId, anio, mes, tipoFiltro]);

  // Asientos generados al vuelo
  const asientosTodos = uM(() => generarAsientosBatch(movsFiltrados), [movsFiltrados]);
  const descuadrados = uM(() => asientosTodos.filter(a => !a.cuadra), [asientosTodos]);
  // Vista: con "solo descuadrados" activo, la tabla, los totales y los exports
  // muestran únicamente los asientos con Δ propio — así la contadora aísla el
  // problema en un click (herramienta de descuadre, 31-ago).
  const asientos = uM(
    () => (soloDescuadrados ? descuadrados : asientosTodos),
    [asientosTodos, descuadrados, soloDescuadrados]
  );
  const movsById = uM(() => new Map(movsFiltrados.map(m => [m.id, m])), [movsFiltrados]);

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

  // Comprobante adjunto por movimiento (el mismo material que Movimientos
  // muestra con el ojo 👁): factura/imagen guardada por Captura Mágica.
  // Se guarda la evidencia CRUDA y la URL se resuelve recién al hacer click
  // (evita crear cientos de signed URLs/objectURLs que nadie abre).
  uE(() => {
    let cancel = false;
    const ids = new Set(movsFiltrados.map(m => m.id));
    const cargar = async () => {
      try {
        const evs = await window.__db.evidencias
          .filter(e => e.modulo_relacionado === 'accounting_movements' && !e.deleted_at
            && e.registro_relacionado_id && ids.has(e.registro_relacionado_id)
            && e.tipo_evidencia !== 'bancarizacion' && e.tipo_evidencia !== 'constancia_detraccion')
          .toArray();
        // Gana la ya subida; entre iguales, la más nueva (patrón de jx-contabilidad).
        const rank = (ev) => (ev.url_archivo && (ev.sync_status === 'uploaded' || ev.sync_status === 'synced')) ? 0 : 1;
        evs.sort((a, b) => (rank(a) - rank(b)) || (b.created_at || '').localeCompare(a.created_at || ''));
        const map = new Map();
        for (const ev of evs) if (!map.has(ev.registro_relacionado_id)) map.set(ev.registro_relacionado_id, ev);
        if (!cancel) setEvPorMov(map);
      } catch {}
    };
    cargar();
    const onChange = (e) => {
      const t = e?.detail?.tabla || e?.detail?.table;
      if (!t || t === 'evidencias') cargar();
    };
    window.addEventListener('jx_data_changed', onChange);
    return () => { cancel = true; window.removeEventListener('jx_data_changed', onChange); };
  }, [movsFiltrados]);

  // objectURL del visor vigente: se revoca al cerrar Y al desmontar la página
  // (sin el cleanup de unmount, navegar con el visor abierto fugaba el blob).
  const visorBlobRef = uR(null);
  uE(() => () => {
    if (visorBlobRef.current) { try { URL.revokeObjectURL(visorBlobRef.current); } catch {} }
  }, []);

  const abrirComprobante = async (movId) => {
    const ev = evPorMov.get(movId);
    if (!ev) return;
    try {
      const src = await getEvidenciaSrc(ev);
      if (!src?.url) { showToast?.('El archivo aún no está disponible (¿todavía subiendo?)', 'amber'); return; }
      // Fallback crudo de getEvidenciaSrc (url_archivo sin firmar = sin señal /
      // API caída): el visor mostraría un recuadro roto — mejor avisar.
      if (!src.isBlob && ev.url_archivo && src.url === ev.url_archivo) {
        showToast?.('Sin conexión con el servidor — el comprobante se abre cuando vuelva la señal.', 'amber');
        return;
      }
      visorBlobRef.current = src.isBlob ? src.url : null;
      setVisor({ url: src.url, mime: ev.mime_type || 'application/pdf', nombre: ev.nombre_archivo || 'comprobante', _blob: !!src.isBlob });
    } catch (e) {
      showToast?.('No se pudo abrir el comprobante: ' + (e.message || e), 'red');
    }
  };
  const cerrarVisor = () => {
    // El objectURL se creó solo para este visor — revocarlo al cerrar (sin
    // esto cada apertura de un comprobante local quedaba fugada en memoria).
    if (visor?._blob) { try { URL.revokeObjectURL(visor.url); } catch {} }
    visorBlobRef.current = null;
    setVisor(null);
  };

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
      // Vista parcial marcada: sin esto, un export con "Solo descuadrados"
      // activo parecía un Libro Diario completo.
      const periodoTxt = periodoLabel + (soloDescuadrados ? ' — SOLO DESCUADRADOS' : '');

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
      doc.text(`Período: ${periodoTxt}`, pageWidth - 14, 18, { align: 'right' });
      doc.setFontSize(8);
      doc.setTextColor(220, 220, 220);
      doc.text(`Generado: ${new Date().toLocaleString('es-PE')}`, pageWidth - 14, 23, { align: 'right' });
      doc.setTextColor(0, 0, 0);

      // Construir filas (una por partida, agrupadas)
      const body = [];
      asientos.forEach((a, idx) => {
        // Solo ASCII: jsPDF con helvetica estándar (WinAnsi) corrompe ⚠ y Δ.
        const marcas = (a.extorno ? ' [NC extorno]' : '') + (!a.cuadra ? ` [DESCUADRE ${fmtS(Math.abs(a.delta))}]` : '');
        a.partidas.forEach((p, j) => {
          body.push([
            j === 0 ? String(idx + 1) : '',
            j === 0 ? fmtDate(a.fecha) : '',
            j === 0 ? (a.glosa.slice(0, 60) + marcas) : '',
            p.cuenta,
            p.descripcion.slice(0, 40),
            p.debe !== 0 ? fmtS(p.debe) : '',
            p.haber !== 0 ? fmtS(p.haber) : '',
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
        doc.text(`Libro Diario · ${periodoTxt}`, 14, ph - 8);
        doc.text(`Página ${i} de ${pages}`, pageWidth - 14, ph - 8, { align: 'right' });
      }

      const fname = `LibroDiario_${(empresaActual?.name || 'todas').replace(/\s+/g, '-')}_${anio}-${mes}${soloDescuadrados ? '_solo-descuadrados' : ''}.pdf`;
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
      const columnas = ['N°', 'Fecha', 'Glosa', 'Tipo', 'Cuenta', 'Nombre cuenta', 'Descripción', 'Debe', 'Haber', 'Δ asiento'];
      const filas = [];
      asientos.forEach((a, idx) => {
        a.partidas.forEach((p, j) => {
          filas.push([
            j === 0 ? (idx + 1) : '',
            j === 0 ? fmtDate(a.fecha) : '',
            j === 0 ? a.glosa : '',
            j === 0 ? ((TIPO_LABEL[a.type] || a.type) + (a.extorno ? ' (NC extorno)' : '')) : '',
            p.cuenta,
            cuentaNombre(p.cuenta),
            p.descripcion,
            p.debe !== 0 ? p.debe : '',
            p.haber !== 0 ? p.haber : '',
            // Δ del PROPIO asiento (herramienta de descuadre): las contadoras
            // revisan el cuadre en Excel — con esta columna el culpable salta solo.
            j === 0 && !a.cuadra ? a.delta : '',
          ]);
        });
      });
      filas.push(['', '', '', '', '', '', 'TOTALES', totales.totDebe, totales.totHaber, '']);

      window.__reports.generateExcel({
        // Máx 31 chars de sheetName en xlsx — 'DESC' marca la vista parcial.
        sheetName: `Libro Diario ${anio}${soloDescuadrados ? ' DESC' : ''}`,
        columnas,
        filas,
        filename: `LibroDiario_${(empresaActual?.name || 'todas').replace(/\s+/g, '-')}_${anio}-${mes}${soloDescuadrados ? '_solo-descuadrados' : ''}.xlsx`,
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
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: descuadrados.length ? 'var(--red)' : 'var(--tm)', cursor: 'pointer', paddingBottom: 8 }}
              title="Mostrar solo los asientos cuyo propio debe ≠ haber — ahí vive el descuadre del total">
              <input type="checkbox" checked={soloDescuadrados} onChange={e => setSoloDescuadrados(e.target.checked)} />
              Solo descuadrados{descuadrados.length ? ` (${descuadrados.length})` : ''}
            </label>
          </div>
        </div>
      </div>

      {/* Resumen */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
        <div className="card card-p" style={{ borderLeft: '3px solid var(--blue)' }}>
          <div style={{ fontSize: 11, color: 'var(--tm)', textTransform: 'uppercase' }}>Movimientos</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ts)', marginTop: 4 }}>
            {soloDescuadrados ? `${asientos.length} de ${movsFiltrados.length}` : movsFiltrados.length}
          </div>
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
        <div className="card card-p"
          style={{ borderLeft: `3px solid ${totales.cuadra ? 'var(--green)' : 'var(--red)'}`, cursor: descuadrados.length ? 'pointer' : 'default' }}
          title={descuadrados.length ? 'Click: ver solo los asientos descuadrados' : 'Todos los asientos cuadran'}
          onClick={() => { if (descuadrados.length) setSoloDescuadrados(v => !v); }}>
          <div style={{ fontSize: 11, color: 'var(--tm)', textTransform: 'uppercase' }}>Cuadre</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: totales.cuadra ? 'var(--green)' : 'var(--red)', marginTop: 4 }}>
            {totales.cuadra ? 'OK' : `Δ ${fmtS(Math.abs(totales.totDebe - totales.totHaber))}`}
          </div>
          {descuadrados.length > 0 && (
            <div style={{ fontSize: 10.5, color: 'var(--red)', marginTop: 3 }}>
              {descuadrados.length} asiento{descuadrados.length > 1 ? 's' : ''} descuadrado{descuadrados.length > 1 ? 's' : ''} — {soloDescuadrados ? 'viéndolos' : 'click para verlos'}
            </div>
          )}
        </div>
      </div>

      {/* Tabla de asientos */}
      {asientos.length === 0 ? (
        <div className="card card-p empty-state">
          <p style={{ color: (soloDescuadrados && asientosTodos.length > 0) ? 'var(--green)' : 'var(--tm)' }}>
            {(soloDescuadrados && asientosTodos.length > 0)
              ? '✓ Ningún asiento descuadrado en este filtro — todos cuadran.'
              : 'No hay movimientos en el período seleccionado. Registra movimientos contables y los asientos se generarán automáticamente.'}
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
                  <React.Fragment key={a.movimiento_id || idx}>
                    {a.partidas.map((p, j) => {
                    const isFirst = j === 0;
                    const isLast = j === a.partidas.length - 1;
                    return (
                      <tr
                        key={`${a.movimiento_id}-${j}`}
                        style={{
                          borderTop: isFirst ? '2px solid var(--bg-s)' : 'none',
                          borderBottom: (isLast && a.cuadra) ? '1px solid var(--bg-s)' : 'none',
                          background: !a.cuadra ? 'rgba(231,76,60,0.05)' : undefined,
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
                              <div style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                                <span className={`badge ${TIPO_BADGE[a.type] || 'b-gray'}`} style={{ fontSize: 10 }}>
                                  {TIPO_LABEL[a.type] || a.type}
                                </span>
                                {a.extorno && (
                                  <span className="badge b-amber" style={{ fontSize: 10 }} title="Nota de crédito / monto negativo asentado como extorno (debe↔haber invertidos)">
                                    ↩ NC · extorno
                                  </span>
                                )}
                                {!a.cuadra && (
                                  <span className="badge b-red" style={{ fontSize: 10 }} title="Este asiento no cuadra: su propio debe ≠ haber">
                                    Δ {fmtS(Math.abs(a.delta))}
                                  </span>
                                )}
                                {/* IGV: solo se avisa cuando NO es el 18 % general — o sea,
                                    cuando la tasa del comprobante es otra (comida al 10 %,
                                    exonerados) o cuando hubo que estimarla. */}
                                {a.desglose && igvDestacable(a.desglose) && (
                                  <span
                                    className={`badge ${a.desglose.origen === 'estimado' ? 'b-amber' : 'b-blue'}`}
                                    style={{ fontSize: 10 }}
                                    title={a.desglose.origen === 'estimado'
                                      ? 'El comprobante no trae base e IGV: se estimó al 18 %. Corregí el movimiento si la tasa era otra.'
                                      : `Base ${fmtS(Math.abs(a.desglose.subtotal))} + IGV ${fmtS(Math.abs(a.desglose.igv))} tomados del comprobante`}>
                                    IGV {describirIgv(a.desglose)}
                                  </span>
                                )}
                                {evPorMov.has(a.movimiento_id) && (
                                  <button className="btn btn-ghost btn-xs" style={{ padding: '0 5px', color: 'var(--blue, #3498DB)' }}
                                    title="Ver el comprobante adjunto (factura/imagen)"
                                    onClick={() => abrirComprobante(a.movimiento_id)}>
                                    {window.JxIcon ? <window.JxIcon name="eye" size={11}/> : '👁'}
                                  </button>
                                )}
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
                        <td style={{ textAlign: 'right', fontWeight: p.debe !== 0 ? 700 : 400, color: p.debe !== 0 ? 'var(--green)' : 'var(--tm)' }} className="col-num">
                          {p.debe !== 0 ? fmtS(p.debe) : '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: p.haber !== 0 ? 700 : 400, color: p.haber !== 0 ? 'var(--red)' : 'var(--tm)' }} className="col-num">
                          {p.haber !== 0 ? fmtS(p.haber) : '—'}
                        </td>
                      </tr>
                    );
                    })}
                    {!a.cuadra && (
                      <tr style={{ background: 'rgba(231,76,60,0.10)', borderBottom: '1px solid var(--bg-s)' }}>
                        <td colSpan={7} style={{ fontSize: 11.5, color: 'var(--red)', padding: '6px 12px' }}>
                          ⚠ {explicarDescuadre(a, movsById.get(a.movimiento_id))}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
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

      {/* Visor del comprobante (mismo material que el ojo 👁 de Movimientos) */}
      {visor && window.Modal && (
        <window.Modal title={`Comprobante: ${visor.nombre}`} icon="eye" onClose={cerrarVisor} wide>
          <div style={{ textAlign: 'center' }}>
            {visor.mime?.startsWith('image/') ? (
              <img src={visor.url} alt={visor.nombre} style={{ maxWidth: '100%', maxHeight: '70vh', borderRadius: 8 }} />
            ) : (
              <PdfFrameLD url={visor.url} nombre={visor.nombre} />
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
            <a href={visor.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">Abrir en pestaña</a>
            <button className="btn btn-amber btn-sm" onClick={cerrarVisor}>Cerrar</button>
          </div>
        </window.Modal>
      )}
    </div>
  );
}

// Registro global
window.LibroDiarioPage = LibroDiarioPage;
export { LibroDiarioPage };
export default LibroDiarioPage;
