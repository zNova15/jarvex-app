import React from "react";
import { calcAvanceFinanciero } from "../lib/avance-financiero.js";
import { esUnidadPorcentaje } from "../lib/apuParser.js";
const { useMemo: uM } = React;

// ─── Helpers ─────────────────────────────────────────────────
const pct = (v) => `${Number(v || 0).toFixed(1)}%`;
const num = (v) => Number(v || 0).toLocaleString('es-PE');
const ESTADO_PARTIDA = {
  pendiente:    { label: 'Pendientes',  color: 'var(--tm)' },
  en_ejecucion: { label: 'En ejecución', color: 'var(--blue)' },
  terminado:    { label: 'Terminadas',  color: 'var(--green)' },
  atrasado:     { label: 'Atrasadas',   color: 'var(--red)' },
  observado:    { label: 'Observadas',  color: 'var(--orange)' },
};
const SEV = { alta: 'var(--red)', media: 'var(--orange)', baja: 'var(--blue)' };

function KpiG({ label, value, sub, color, icon }) {
  return (
    <div className="kpi-card" style={{ borderLeft: color ? `3px solid ${color}` : undefined }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 11.5, color: 'var(--tm)', fontWeight: 500 }}>{label}</div>
        {icon && <div style={{ width: 30, height: 30, borderRadius: 8, background: `color-mix(in srgb, ${color || 'var(--blue)'} 10%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><JxIcon name={icon} size={14} color={color || 'var(--blue)'} /></div>}
      </div>
      <div className="kpi-val" style={{ color: color || 'var(--tp)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  DASHBOARD GESTIÓN DE OBRA — resumen de la obra activa         ║
// ║  (read-only; pensado para el rol Asistente de Administrador)   ║
// ╚══════════════════════════════════════════════════════════════╝
function DashboardGestionPage() {
  const obraHook = window.__useObraActiva ? window.__useObraActiva() : { obraId: null };
  const obraId = obraHook?.obraId || null;
  const { data: obras } = window.__hooks.useObras();
  const { data: partidas } = window.__hooks.usePartidas(obraId);
  const { data: avances } = window.__hooks.useAvanceObra(obraId);
  const { data: incidencias } = window.__hooks.useIncidencias(obraId);
  const { data: frentes } = window.__hooks.useFrentesObra(obraId, { soloActivas: false });
  const [usuarios, setUsuarios] = React.useState([]);
  React.useEffect(() => { window.__db?.profiles?.toArray?.().then(setUsuarios).catch(() => {}); }, []);

  // Avance financiero = lo que los contadores vincularon en Conciliación de Insumos
  // (factura ↔ insumo presupuestado) ÷ presupuesto facturable de la obra.
  const [vincObra, setVincObra] = React.useState([]);
  const [insumosObra, setInsumosObra] = React.useState([]);
  React.useEffect(() => {
    if (!obraId) { setVincObra([]); setInsumosObra([]); return; }
    let c = false;
    const load = async () => {
      try {
        const [vin, ins] = await Promise.all([
          window.__db.conciliacion_vinculos.where('obra_id').equals(obraId).filter(r => !r.deleted_at).toArray(),
          window.__db.insumos_partida.where('obra_id').equals(obraId).filter(r => !r.deleted_at).toArray(),
        ]);
        if (!c) { setVincObra(vin); setInsumosObra(ins); }
      } catch { /* Dexie viejo sin conciliacion_vinculos */ }
    };
    load();
    let deb;
    const on = (e) => { const t = e?.detail?.tabla; if (!t || t === 'conciliacion_vinculos' || t === 'insumos_partida' || t === 'accounting_movements') { clearTimeout(deb); deb = setTimeout(load, 400); } };
    window.addEventListener('jx_data_changed', on);
    return () => { c = true; clearTimeout(deb); window.removeEventListener('jx_data_changed', on); };
  }, [obraId]);

  const obra = uM(() => (obras || []).find(o => o.id === obraId) || null, [obras, obraId]);
  const usuariosById = uM(() => { const m = new Map(); (usuarios || []).forEach(u => m.set(u.id, u)); return m; }, [usuarios]);
  const nombreUsuario = (id) => { const u = usuariosById.get(id); return u ? (`${u.nombres || ''} ${u.apellidos || ''}`.trim() || u.email || '—') : '—'; };

  // Partidas hoja (específicas, no capítulos) — base para avance/estado/costos.
  const hojas = uM(() => {
    const vivas = (partidas || []).filter(p => !p.deleted_at && p.codigo_delfin);
    const folders = new Set();
    for (const p of vivas) { const s = String(p.codigo_delfin).trim().split('.'); for (let i = 1; i < s.length; i++) folders.add(s.slice(0, i).join('.')); }
    return vivas.filter(p => !folders.has(String(p.codigo_delfin).trim()));
  }, [partidas]);

  const kpis = uM(() => {
    // Avance físico ponderado por costo presupuestado (mismo criterio que el ejecutivo).
    let sumPres = 0, sumAv = 0, sumReal = 0;
    const porEstado = {};
    for (const p of hojas) {
      const presup = Number(p.costo_total_presupuestado) || 0;
      const av = Number(p.porcentaje_avance) || 0;
      sumPres += presup; sumAv += av * presup; sumReal += Number(p.costo_real_acumulado) || 0;
      const e = p.estado || 'pendiente';
      porEstado[e] = (porEstado[e] || 0) + 1;
    }
    const avanceFisico = sumPres > 0 ? sumAv / sumPres : 0;
    const reportes = (avances || []).filter(a => !a.deleted_at && a.origen === 'reporte');
    const ultimoReporte = reportes.reduce((mx, a) => (a.fecha && a.fecha > mx) ? a.fecha : mx, '');
    const frentesVivos = (frentes || []).filter(f => !f.deleted_at);
    const frentesActivos = frentesVivos.filter(f => f.activo !== false);
    const incVivas = (incidencias || []).filter(i => !i.deleted_at);
    const incAbiertas = incVivas.filter(i => i.estado !== 'cerrada' && i.estado !== 'resuelta');
    return {
      avanceFisico, sumPres, sumReal,
      nHojas: hojas.length, porEstado,
      nReportes: reportes.length, ultimoReporte,
      nFrentes: frentesVivos.length, nFrentesActivos: frentesActivos.length,
      nIncAbiertas: incAbiertas.length, nIncTotal: incVivas.length,
      incPorSev: { alta: incAbiertas.filter(i => i.severidad === 'alta' || i.severidad === 'critica').length, media: incAbiertas.filter(i => i.severidad === 'media').length, baja: incAbiertas.filter(i => i.severidad === 'baja' || !i.severidad).length },
    };
  }, [hojas, avances, frentes, incidencias]);

  const avanceFin = uM(() => {
    const partidasById = new Map(); (partidas || []).forEach(p => partidasById.set(p.id, p));
    return calcAvanceFinanciero({
      insumosPartida: insumosObra.filter(i => i.tipo_insumo !== 'mano_obra' && !esUnidadPorcentaje(i.unidad)),
      vinculos: vincObra,
      partidasById,
    });
  }, [insumosObra, vincObra, partidas]);

  // Resumen por ingeniero: avance promedio reportado + nº reportes + metrado.
  const porIngeniero = uM(() => {
    const m = new Map();
    for (const a of (avances || [])) {
      if (a.deleted_at || a.origen !== 'reporte' || !a.responsable_id) continue;
      const e = m.get(a.responsable_id) || { nReportes: 0, metrado: 0, ultimo: '' };
      e.nReportes += 1; e.metrado += Number(a.metrado_ejecutado) || 0;
      if (a.fecha && a.fecha > e.ultimo) e.ultimo = a.fecha;
      m.set(a.responsable_id, e);
    }
    return [...m.entries()].map(([id, v]) => ({ id, nombre: nombreUsuario(id), ...v })).sort((a, b) => b.nReportes - a.nReportes);
  }, [avances, usuariosById]);

  const incidenciasRecientes = uM(() => (incidencias || [])
    .filter(i => !i.deleted_at && i.estado !== 'cerrada' && i.estado !== 'resuelta')
    .sort((a, b) => String(b.fecha || b.created_at || '').localeCompare(String(a.fecha || a.created_at || '')))
    .slice(0, 8), [incidencias]);

  if (!obraId) return <div className="page-wrap"><div className="card card-p empty-state"><JxIcon name="dashboard" size={32} color="var(--tm)" /><p>Seleccioná una obra activa.</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd">
        <div className="pg-title">Dashboard Gestión de Obra</div>
        <div className="pg-sub">{obra?.nombre_obra || 'Obra'} · resumen de avance, frentes, ingenieros e incidencias</div>
      </div>

      {/* KPIs principales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12, marginBottom: 18 }}>
        <KpiG label="Avance físico general" value={pct(kpis.avanceFisico)} sub={`${kpis.nHojas} partidas específicas`} color="var(--blue)" icon="trending" />
        <KpiG label="Avance financiero" value={pct(avanceFin.obraPct)} sub={`S/ ${num(Math.round(avanceFin.obraFacturado))} facturado · vinculado por contabilidad`} color="var(--orange)" icon="dollar" />
        <KpiG label="Presupuesto (CD)" value={`S/ ${num(Math.round(kpis.sumPres))}`} sub={`Real: S/ ${num(Math.round(kpis.sumReal))}`} color="var(--blue)" icon="dollar" />
        <KpiG label="Frentes activos" value={kpis.nFrentesActivos} sub={`${kpis.nFrentes} en total`} color="var(--orange)" icon="flag" />
        <KpiG label="Reportes de avance" value={kpis.nReportes} sub={kpis.ultimoReporte ? `último: ${kpis.ultimoReporte}` : 'sin reportes'} color="var(--purple)" icon="edit" />
        <KpiG label="Incidencias abiertas" value={kpis.nIncAbiertas} sub={`${kpis.incPorSev.alta} alta · ${kpis.incPorSev.media} media · ${kpis.incPorSev.baja} baja`} color={kpis.nIncAbiertas > 0 ? 'var(--red)' : 'var(--green)'} icon="alert" />
      </div>

      {/* Partidas por estado */}
      <div className="card card-p" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tp)', marginBottom: 10 }}>Partidas por estado</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10 }}>
          {Object.entries(ESTADO_PARTIDA).map(([k, cfg]) => (
            <div key={k} style={{ background: 'var(--tint-neutral)', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 11, color: 'var(--tm)' }}>{cfg.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: cfg.color }}>{kpis.porEstado[k] || 0}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 16 }}>
        {/* Resumen por ingeniero */}
        <div className="card" style={{ overflow: 'auto' }}>
          <div style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700 }}>Reportes por ingeniero</div>
          <table className="tbl" style={{ fontSize: 12 }}>
            <thead><tr><th>Ingeniero</th><th style={{ textAlign: 'right' }}>Reportes</th><th style={{ textAlign: 'right' }}>Metrado rep.</th><th>Último</th></tr></thead>
            <tbody>
              {porIngeniero.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.nombre}</td>
                  <td style={{ textAlign: 'right' }}>{r.nReportes}</td>
                  <td style={{ textAlign: 'right' }}>{num(r.metrado)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.ultimo || '—'}</td>
                </tr>
              ))}
              {porIngeniero.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>Sin reportes de ingenieros todavía.</td></tr>}
            </tbody>
          </table>
        </div>

        {/* Incidencias abiertas */}
        <div className="card" style={{ overflow: 'auto' }}>
          <div style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700 }}>Incidencias abiertas ({kpis.nIncAbiertas})</div>
          <table className="tbl" style={{ fontSize: 12 }}>
            <thead><tr><th>Fecha</th><th>Título</th><th>Severidad</th><th>Estado</th></tr></thead>
            <tbody>
              {incidenciasRecientes.map(i => (
                <tr key={i.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{(i.fecha || i.created_at || '').slice(0, 10) || '—'}</td>
                  <td>{i.titulo || i.descripcion || '—'}</td>
                  <td><span className="badge" style={{ background: SEV[i.severidad] || SEV.baja, color: '#000', fontSize: 9 }}>{i.severidad || 'baja'}</span></td>
                  <td><span className="badge b-amber" style={{ fontSize: 9 }}>{i.estado || 'abierta'}</span></td>
                </tr>
              ))}
              {incidenciasRecientes.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>Sin incidencias abiertas. 👍</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { DashboardGestionPage });
