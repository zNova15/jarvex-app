import React from "react";
const { useState: uSR, useMemo: uMR, useEffect: uER } = React;

// ── PERIOD HELPERS ────────────────────────────────────────
function getPeriodDates(periodo, customFrom, customTo) {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  if (periodo === 'semana_actual') {
    const day = today.getDay() || 7;
    const start = new Date(today);
    start.setDate(today.getDate() - day + 1);
    return { from: start.toISOString().slice(0, 10), to: todayStr };
  }
  if (periodo === 'mes_actual') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: start.toISOString().slice(0, 10), to: todayStr };
  }
  if (periodo === 'custom') {
    return { from: customFrom || '2000-01-01', to: customTo || todayStr };
  }
  return { from: '2000-01-01', to: todayStr };
}

function slugify(s) {
  return String(s || 'obra').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 30);
}

function fechaStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

const REPORT_CARDS = [
  { id: 'materiales',  titulo: 'Reporte de Materiales',     desc: 'Stock, movimientos y alertas de inventario',                icon: 'package',   modulo: 'Almacén',     formato: 'PDF / Excel' },
  { id: 'asistencia',  titulo: 'Reporte de Asistencia',      desc: 'Historial de asistencia por período',                       icon: 'calendar',  modulo: 'Almacén',     formato: 'PDF / Excel' },
  { id: 'herramientas',titulo: 'Reporte de Herramientas',    desc: 'Estado actual y movimientos de herramientas',               icon: 'tool',      modulo: 'Almacén',     formato: 'PDF / Excel' },
  { id: 'avance',      titulo: 'Reporte de Avance de Obra',  desc: 'Progreso físico por partidas y semanas',                    icon: 'hardHat',   modulo: 'Gestión Obra',formato: 'PDF / Excel' },
  { id: 'costos',      titulo: 'Reporte de Costos',          desc: 'Análisis presupuestado vs real, desviaciones',              icon: 'dollar',    modulo: 'Gestión Obra',formato: 'PDF / Excel' },
  { id: 'partidas',    titulo: 'Reporte de Partidas',        desc: 'Estado de todas las partidas, metrados y % avance',         icon: 'list',      modulo: 'Gestión Obra',formato: 'PDF / Excel' },
  { id: 'ejecutivo',   titulo: 'Reporte Ejecutivo General',  desc: 'Resumen de indicadores clave para gerencia y cliente',      icon: 'chart',     modulo: 'General',     formato: 'PDF' },
  { id: 'valorizacion',titulo: 'Valorización de Obra',       desc: 'Valorización mensual para presentación al cliente',         icon: 'clipboard', modulo: 'General',     formato: 'PDF' },
];

// ── DATA LOADERS ──────────────────────────────────────────
async function loadReportData(reportId, obraId, period) {
  const db = window.__db;
  const inRange = (fecha) => fecha && fecha >= period.from && fecha <= period.to;

  if (reportId === 'materiales') {
    const items = await db.materiales.where('obra_id').equals(obraId).filter(m => !m.deleted_at).toArray();
    const movs  = await db.movimientos_materiales.where('obra_id').equals(obraId).toArray();
    return items.map(m => {
      const ms = movs.filter(x => x.material_id === m.id);
      const entradas = ms.filter(x => x.tipo === 'entrada' || x.tipo === 'ingreso').reduce((a,b) => a + (Number(b.cantidad) || 0), 0);
      const salidas  = ms.filter(x => x.tipo === 'salida').reduce((a,b) => a + (Number(b.cantidad) || 0), 0);
      return [
        m.nombre || '',
        m.categoria || '',
        m.unidad || '',
        Number(m.stock_inicial ?? 0),
        Number(m.stock_actual ?? 0),
        Number(m.stock_minimo ?? 0),
        entradas,
        salidas,
        Number(m.precio_unitario ?? 0),
        m.alerta || 'ok',
      ];
    });
  }

  if (reportId === 'asistencia') {
    const items = await db.asistencia.where('obra_id').equals(obraId).filter(a => inRange(a.fecha)).toArray();
    const personal = await db.personal.where('obra_id').equals(obraId).toArray();
    const pmap = Object.fromEntries(personal.map(p => [p.id, p]));
    return items.map(a => {
      const p = pmap[a.personal_id] || {};
      return [
        a.fecha || '',
        p.nombre || a.personal_id || '',
        p.dni || '',
        p.cargo || '',
        a.hora_ingreso || '—',
        a.hora_salida || '—',
        Number(a.horas_trabajadas ?? 0),
        a.estado || '',
      ];
    });
  }

  if (reportId === 'herramientas') {
    const items = await db.herramientas.where('obra_id').equals(obraId).filter(h => !h.deleted_at).toArray();
    const movs  = await db.movimientos_herramientas.where('obra_id').equals(obraId).toArray();
    return items.map(h => {
      const ms = movs.filter(x => x.herramienta_id === h.id).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
      const ult = ms[0]?.fecha || '';
      return [
        h.nombre || '',
        h.tipo || '',
        h.marca || '',
        h.modelo || '',
        h.numero_serie || '',
        h.estado_actual || '',
        h.ubicacion || '',
        h.disponible ? 'Sí' : 'No',
        ult,
      ];
    });
  }

  if (reportId === 'avance') {
    const items = await db.avance_obra.where('obra_id').equals(obraId).filter(a => inRange(a.fecha)).toArray();
    const partidas = await db.partidas.where('obra_id').equals(obraId).toArray();
    const pmap = Object.fromEntries(partidas.map(p => [p.id, p]));
    return items.map(a => {
      const p = pmap[a.partida_id] || {};
      return [
        a.fecha || '',
        a.semana || '',
        p.descripcion || p.nombre || a.partida_id || '',
        Number(a.metrado_ejecutado ?? 0),
        Number(a.porcentaje_avance ?? 0),
        Number(a.personal_asignado ?? 0),
        a.observaciones || '',
      ];
    });
  }

  if (reportId === 'costos' || reportId === 'partidas') {
    const items = await db.partidas.where('obra_id').equals(obraId).filter(p => !p.deleted_at).toArray();
    if (reportId === 'partidas') {
      return items.map(p => [
        p.codigo || '',
        p.descripcion || p.nombre || '',
        p.categoria || '',
        p.unidad || '',
        Number(p.metrado_contractual ?? 0),
        Number(p.metrado_ejecutado ?? 0),
        Number(p.porcentaje_avance ?? 0),
        p.estado || '',
        p.fecha_inicio || '',
        p.fecha_fin || '',
      ]);
    }
    return items.map(p => {
      const pres = Number(p.costo_presupuestado ?? 0);
      const real = Number(p.costo_real ?? 0);
      const dif  = real - pres;
      const desv = pres ? (dif / pres) * 100 : 0;
      return [
        p.codigo || '',
        p.descripcion || p.nombre || '',
        p.categoria || '',
        Number(p.metrado_contractual ?? 0),
        Number(p.metrado_ejecutado ?? 0),
        Number(p.porcentaje_avance ?? 0),
        pres.toFixed(2),
        real.toFixed(2),
        dif.toFixed(2),
        desv.toFixed(1) + '%',
      ];
    });
  }

  return [];
}

const REPORT_COLS = {
  materiales:   ['Material', 'Categoría', 'Unidad', 'Stock Ini', 'Stock Act', 'Stock Mín', 'Entradas', 'Salidas', 'Precio Unit', 'Alerta'],
  asistencia:   ['Fecha', 'Trabajador', 'DNI', 'Cargo', 'Ingreso', 'Salida', 'Horas', 'Estado'],
  herramientas: ['Herramienta', 'Tipo', 'Marca', 'Modelo', 'Serie', 'Estado', 'Ubicación', 'Disponible', 'Último Mov'],
  avance:       ['Fecha', 'Semana', 'Partida', 'Metrado Ejec', '% Avance', 'Personal', 'Observaciones'],
  costos:       ['Código', 'Partida', 'Categoría', 'Met Cont', 'Met Ejec', '% Avance', 'Costo Pres', 'Costo Real', 'Diferencia', '% Desv'],
  partidas:     ['Código', 'Partida', 'Categoría', 'Unidad', 'Met Cont', 'Met Ejec', '% Avance', 'Estado', 'Fecha Ini', 'Fecha Fin'],
};

// ── EJECUTIVO PDF (no autoTable) ──────────────────────────
async function buildEjecutivoPDF(obra) {
  const db = window.__db;
  const obraId = obra.id;

  const [materiales, personal, asistHoy, partidas, incidencias] = await Promise.all([
    db.materiales.where('obra_id').equals(obraId).filter(m => !m.deleted_at).toArray(),
    db.personal.where('obra_id').equals(obraId).filter(p => !p.deleted_at).toArray(),
    db.asistencia.where('obra_id').equals(obraId).filter(a => a.fecha === new Date().toISOString().slice(0, 10)).toArray(),
    db.partidas.where('obra_id').equals(obraId).filter(p => !p.deleted_at).toArray(),
    db.incidencias.where('obra_id').equals(obraId).toArray(),
  ]);

  const alertas = materiales.filter(m => m.alerta && m.alerta !== 'ok').length;
  const valorInv = materiales.reduce((a, m) => a + (Number(m.stock_actual || 0) * Number(m.precio_unitario || 0)), 0);
  const presentes = asistHoy.filter(a => a.estado === 'asistio' || a.estado === 'tardanza').length;
  const partTerm = partidas.filter(p => p.estado === 'terminada' || p.estado === 'completada').length;
  const partEjec = partidas.filter(p => p.estado === 'en_ejecucion' || p.estado === 'en-ejecucion').length;
  const partAtr  = partidas.filter(p => p.estado === 'atrasada').length;
  const partPend = partidas.filter(p => p.estado === 'pendiente' || p.estado === 'no_iniciada').length;
  const incAbier = incidencias.filter(i => i.estado === 'abierta' || i.estado === 'en_proceso').length;

  const totalPres = partidas.reduce((a, p) => a + Number(p.costo_presupuestado || 0), 0);
  const totalReal = partidas.reduce((a, p) => a + Number(p.costo_real || 0), 0);
  const avgAvance = partidas.length ? partidas.reduce((a, p) => a + Number(p.porcentaje_avance || 0), 0) / partidas.length : 0;
  const sobre = totalReal - totalPres;

  // Use the helper to build a base PDF with branding header, then append narrative content
  const doc = window.__reports.generatePDF({
    titulo: 'Reporte Ejecutivo General',
    subtitulo: `Obra: ${obra.nombre || '—'}    Cliente: ${obra.cliente || '—'}`,
    columnas: ['Indicador', 'Valor'],
    filas: [
      ['Avance físico promedio', `${avgAvance.toFixed(1)}%`],
      ['Costo presupuestado total', `S/ ${totalPres.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`],
      ['Costo real total', `S/ ${totalReal.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`],
      [sobre >= 0 ? 'Sobrecosto' : 'Ahorro', `S/ ${Math.abs(sobre).toLocaleString('es-PE', { minimumFractionDigits: 2 })}`],
      ['Total materiales', materiales.length],
      ['Materiales en alerta', alertas],
      ['Valor del inventario', `S/ ${valorInv.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`],
      ['Total personal', personal.length],
      ['Presentes hoy', presentes],
      ['Partidas terminadas', partTerm],
      ['Partidas en ejecución', partEjec],
      ['Partidas atrasadas', partAtr],
      ['Partidas pendientes', partPend],
      ['Incidencias abiertas', incAbier],
      ['Ubicación', obra.ubicacion || obra.direccion || '—'],
      ['Inicio / Fin', `${obra.fecha_inicio || '—'} a ${obra.fecha_fin || '—'}`],
      ['Presupuesto contractual', `S/ ${Number(obra.presupuesto || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}`],
    ],
    footer: 'Reporte Ejecutivo — JARVEX',
  });
  return doc;
}

async function buildValorizacionPDF(obra) {
  const db = window.__db;
  const partidas = await db.partidas.where('obra_id').equals(obra.id).filter(p => !p.deleted_at).toArray();
  const valorizables = partidas.filter(p => Number(p.metrado_ejecutado || 0) > 0);

  const filas = valorizables.map(p => {
    const met = Number(p.metrado_ejecutado || 0);
    const precio = Number(p.precio_unitario || 0);
    return [
      p.codigo || '',
      p.descripcion || p.nombre || '',
      p.unidad || '',
      met,
      precio.toFixed(2),
      (met * precio).toFixed(2),
    ];
  });
  const total = valorizables.reduce((a, p) => a + Number(p.metrado_ejecutado || 0) * Number(p.precio_unitario || 0), 0);

  const doc = window.__reports.generatePDF({
    titulo: `Valorización de Obra — ${obra.nombre || ''}`,
    subtitulo: `Cliente: ${obra.cliente || '—'}    Ubicación: ${obra.ubicacion || obra.direccion || '—'}`,
    columnas: ['Código', 'Partida', 'Unidad', 'Metrado Ejec', 'P. Unitario', 'Subtotal'],
    filas,
    footer: `Total a valorizar: S/ ${total.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`,
  });
  return doc;
}

// ── HISTORIAL ─────────────────────────────────────────────
function loadHistorial() {
  try { return JSON.parse(localStorage.getItem('reportes_historial') || '[]'); }
  catch { return []; }
}
function saveHistorial(arr) {
  localStorage.setItem('reportes_historial', JSON.stringify(arr));
}

// ── COMPONENT ─────────────────────────────────────────────
function ReportesPage({ showToast }) {
  const [tab, setTab] = uSR('generar');
  const obras = window.__hooks.useObras() || [];
  const auth = (window.__useAuth && window.__useAuth()) || {};
  const userName = auth.user?.email || auth.user?.nombre || 'Usuario';

  const [obraId, setObraId] = uSR('');
  const [periodo, setPeriodo] = uSR('mes_actual');
  const [customFrom, setCustomFrom] = uSR('');
  const [customTo, setCustomTo] = uSR('');
  const [formato, setFormato] = uSR('pdf');
  const [busy, setBusy] = uSR(null);
  const [historial, setHistorial] = uSR(loadHistorial());

  uER(() => {
    if (!obraId && obras.length) setObraId(obras[0].id);
  }, [obras, obraId]);

  const obraActual = uMR(() => obras.find(o => o.id === obraId), [obras, obraId]);

  async function handleGenerate(card) {
    if (!obraActual) { showToast?.('Selecciona una obra primero', 'red'); return; }
    setBusy(card.id);
    try {
      const period = getPeriodDates(periodo, customFrom, customTo);
      const slug = slugify(obraActual.nombre);
      const stamp = fechaStamp();
      const baseFilename = `JARVEX_${card.id}_${slug}_${stamp}`;

      let pdfDoc = null;
      let filas = null;
      let columnas = null;

      if (card.id === 'ejecutivo') {
        pdfDoc = await buildEjecutivoPDF(obraActual);
      } else if (card.id === 'valorizacion') {
        pdfDoc = await buildValorizacionPDF(obraActual);
      } else {
        filas = await loadReportData(card.id, obraActual.id, period);
        columnas = REPORT_COLS[card.id];
      }

      const wantsPdf = formato === 'pdf' || formato === 'ambos' || card.formato === 'PDF';
      const wantsExcel = (formato === 'excel' || formato === 'ambos') && card.id !== 'ejecutivo' && card.id !== 'valorizacion';

      if (wantsPdf) {
        const doc = pdfDoc || window.__reports.generatePDF({
          titulo: card.titulo,
          subtitulo: `Obra: ${obraActual.nombre || '—'}    Período: ${period.from} a ${period.to}`,
          columnas,
          filas,
          footer: `Generado por ${userName} — JARVEX`,
        });
        window.__reports.downloadPDF(doc, `${baseFilename}.pdf`);
        const newEntry = {
          nombre: card.titulo,
          fecha: new Date().toLocaleString('es-PE'),
          user: userName,
          formato: 'PDF',
          size: '—',
          obra: obraActual.nombre,
        };
        const updated = [newEntry, ...historial].slice(0, 100);
        setHistorial(updated);
        saveHistorial(updated);
      }

      if (wantsExcel) {
        window.__reports.generateExcel({
          sheetName: card.id,
          columnas,
          filas,
          filename: `${baseFilename}.xlsx`,
        });
        const newEntry = {
          nombre: card.titulo,
          fecha: new Date().toLocaleString('es-PE'),
          user: userName,
          formato: 'Excel',
          size: '—',
          obra: obraActual.nombre,
        };
        const updated = [newEntry, ...historial].slice(0, 100);
        setHistorial(updated);
        saveHistorial(updated);
      }

      showToast?.(`Reporte generado: ${baseFilename}`, 'green');
    } catch (e) {
      console.error(e);
      showToast?.(`Error generando reporte: ${e.message}`, 'red');
    } finally {
      setBusy(null);
    }
  }

  function clearHistorial() {
    if (!confirm('¿Limpiar todo el historial?')) return;
    setHistorial([]);
    saveHistorial([]);
    showToast?.('Historial limpiado', 'amber');
  }

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Reportes</div>
          <div className="pg-sub">Generación y descarga de reportes del sistema</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {['generar', 'historial'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`btn ${tab === t ? 'btn-amber' : 'btn-ghost'} btn-sm`}
              style={{ textTransform: 'capitalize' }}>
              {t === 'generar' ? 'Generar Reporte' : 'Historial'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'generar' && <>
        <div className="card card-p" style={{ marginBottom: 18, display: 'grid', gridTemplateColumns: periodo === 'custom' ? '1fr 1fr 1fr 1fr 1fr' : '1fr 1fr 1fr', gap: 12, alignItems: 'end' }}>
          <div>
            <label className="flabel">Obra / Proyecto</label>
            <select className="fi" value={obraId} onChange={e => setObraId(e.target.value)}>
              {obras.length === 0 && <option value="">— Sin obras —</option>}
              {obras.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="flabel">Período</label>
            <select className="fi" value={periodo} onChange={e => setPeriodo(e.target.value)}>
              <option value="semana_actual">Semana actual</option>
              <option value="mes_actual">Mes actual</option>
              <option value="acumulado">Acumulado</option>
              <option value="custom">Rango personalizado</option>
            </select>
          </div>
          {periodo === 'custom' && <>
            <div>
              <label className="flabel">Desde</label>
              <input type="date" className="fi" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
            </div>
            <div>
              <label className="flabel">Hasta</label>
              <input type="date" className="fi" value={customTo} onChange={e => setCustomTo(e.target.value)} />
            </div>
          </>}
          <div>
            <label className="flabel">Formato de salida</label>
            <select className="fi" value={formato} onChange={e => setFormato(e.target.value)}>
              <option value="pdf">PDF</option>
              <option value="excel">Excel</option>
              <option value="ambos">Ambos</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
          {REPORT_CARDS.map(r => (
            <div key={r.id} className="card card-p card-hover">
              <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(242,183,5,0.1)', border: '1px solid rgba(242,183,5,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                <JxIcon name={r.icon} size={18} color="var(--amber)" />
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tp)', marginBottom: 6, lineHeight: 1.3 }}>{r.titulo}</div>
              <div style={{ fontSize: 11.5, color: 'var(--tm)', lineHeight: 1.5, marginBottom: 12 }}>{r.desc}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span className="tag">{r.modulo}</span>
                <span style={{ fontSize: 10.5, color: 'var(--tm)' }}>{r.formato}</span>
              </div>
              <button className="btn btn-amber btn-sm" style={{ width: '100%', justifyContent: 'center' }}
                disabled={busy === r.id}
                onClick={() => handleGenerate(r)}>
                <JxIcon name="download" size={12} />{busy === r.id ? 'Generando…' : 'Generar'}
              </button>
            </div>
          ))}
        </div>
      </>}

      {tab === 'historial' && <>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={clearHistorial}>
            <JxIcon name="trash" size={12} /> Limpiar historial
          </button>
        </div>
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="tbl">
            <thead><tr><th>Reporte</th><th>Obra</th><th>Generado</th><th>Usuario</th><th>Tipo</th></tr></thead>
            <tbody>
              {historial.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--tm)' }}>Sin reportes generados aún</td></tr>
              )}
              {historial.map((h, i) => (
                <tr key={i}>
                  <td className="col-p">
                    <JxIcon name={h.formato === 'PDF' ? 'file' : 'chart'} size={13} color={h.formato === 'PDF' ? 'var(--red)' : 'var(--green)'} /> {h.nombre}
                  </td>
                  <td className="col-m">{h.obra || '—'}</td>
                  <td className="col-m">{h.fecha}</td>
                  <td>{h.user}</td>
                  <td><span className={`badge ${h.formato === 'PDF' ? 'b-red' : 'b-green'}`}>{h.formato}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}
    </div>
  );
}

Object.assign(window, { ReportesPage });
