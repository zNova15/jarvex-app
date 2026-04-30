import React from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
const { useState: uS, useMemo: uM, useEffect: uE } = React;

const fmtCur = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtCurK = (n) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1e6) return 'S/ ' + (v / 1e6).toFixed(2) + 'M';
  if (Math.abs(v) >= 1e3) return 'S/ ' + (v / 1e3).toFixed(0) + 'K';
  return 'S/ ' + v.toFixed(0);
};
const fmtPct = (n) => (Number(n || 0) * 100).toFixed(1) + '%';
const todayISO = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a, b) => {
  if (!a || !b) return 0;
  return Math.round((new Date(b) - new Date(a)) / 86400000);
};
const addDaysISO = (iso, n) => {
  const d = new Date(iso);
  d.setDate(d.getDate() + Math.round(n));
  return d.toISOString().slice(0, 10);
};

const JxIcon = (props) => {
  const I = window.JxIcon;
  return I ? <I {...props} /> : null;
};

function KpiCard({ label, value, sub, color = 'var(--tp)', icon, accent }) {
  return (
    <div className="kpi-card" style={{ borderLeft: accent ? `3px solid ${color}` : undefined }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 11.5, color: 'var(--tm)', fontWeight: 500 }}>{label}</div>
        {icon && (
          <div style={{ width: 30, height: 30, borderRadius: 8, background: color + '1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <JxIcon name={icon} size={14} color={color} />
          </div>
        )}
      </div>
      <div className="kpi-val" style={{ color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function SectionH({ title }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '24px 0 12px' }}>
      <h3 style={{ margin: 0, fontSize: 15, color: 'var(--tp)', fontWeight: 700 }}>{title}</h3>
      <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    completada:    { color: '#34D399', label: 'Completada' },
    en_curso:      { color: '#4A90E2', label: 'En curso' },
    atrasada:      { color: '#E74C3C', label: 'Atrasada' },
    no_iniciada:   { color: '#9AA0A6', label: 'No iniciada' },
    adelantada:    { color: '#34D399', label: 'Adelantada' },
  };
  const s = map[status] || map.no_iniciada;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 10,
      fontSize: 11, fontWeight: 600, color: s.color,
      background: s.color + '22', border: `1px solid ${s.color}55`
    }}>{s.label}</span>
  );
}

function CumplimientoCronogramaPage() {
  const { data: obras = [] } = (window.__hooks?.useObras?.() ?? { data: [] });
  const [obraId, setObraId] = uS('');
  const [soloAtrasadas, setSoloAtrasadas] = uS(false);

  uE(() => {
    if (!obraId && obras.length > 0) {
      const stored = window.__getObraActivaId?.();
      const a = (stored && obras.find(o => o.id === stored && !o.deleted_at)) || obras.find(o => !o.deleted_at);
      if (a) setObraId(a.id);
    }
  }, [obras]);

  const obra = obras.find(o => o.id === obraId);
  const { data: partidas = [] } = (window.__hooks?.usePartidas?.(obraId) ?? { data: [] });

  const today = todayISO();

  // ── Cálculos por partida ──
  const filas = uM(() => {
    const ps = (partidas || []).filter(p => !p.deleted_at);
    const obraIni = obra?.fecha_inicio || null;
    const obraFin = obra?.fecha_fin_estimada || null;

    return ps.map(p => {
      const ini = p.fecha_inicio_planificada || obraIni;
      const fin = p.fecha_fin_planificada || obraFin;

      const totalDias = daysBetween(ini, fin);
      const transcurridos = ini ? Math.max(0, daysBetween(ini, today)) : 0;
      let pctPlan = totalDias > 0 ? Math.min(1, transcurridos / totalDias) : 0;
      if (ini && today < ini) pctPlan = 0;
      if (fin && today >= fin) pctPlan = 1;

      const real = Math.max(0, Math.min(1, Number(p.porcentaje_avance || 0) / 100));
      const desviacion = real - pctPlan;

      // Días de retraso/adelanto (proporcional al rango total)
      const diasDelta = totalDias > 0 ? Math.round(desviacion * totalDias) : 0;

      // Status
      let status = 'no_iniciada';
      if (real >= 0.999) status = 'completada';
      else if (real <= 0 && pctPlan <= 0) status = 'no_iniciada';
      else if (desviacion < -0.05) status = 'atrasada';
      else if (desviacion > 0.05) status = 'adelantada';
      else status = 'en_curso';

      const presupuesto = Number(p.precio_unitario || 0) * Number(p.metrado_total || 0);

      return {
        id: p.id,
        codigo: p.codigo_delfin || '',
        nombre: p.nombre_partida || '',
        ini, fin,
        totalDias,
        pctPlan, real, desviacion, diasDelta,
        status,
        presupuesto,
      };
    }).sort((a, b) => {
      // Atrasadas primero, luego por código
      const ord = { atrasada: 0, en_curso: 1, no_iniciada: 2, adelantada: 3, completada: 4 };
      const da = (ord[a.status] ?? 9) - (ord[b.status] ?? 9);
      if (da !== 0) return da;
      return String(a.codigo).localeCompare(String(b.codigo));
    });
  }, [partidas, obra, today]);

  const filasView = uM(() => soloAtrasadas ? filas.filter(f => f.status === 'atrasada') : filas, [filas, soloAtrasadas]);

  // ── KPIs globales ──
  const kpis = uM(() => {
    const presupTotal = filas.reduce((s, f) => s + f.presupuesto, 0);
    const planObra = presupTotal > 0
      ? filas.reduce((s, f) => s + f.pctPlan * f.presupuesto, 0) / presupTotal
      : 0;
    const realObra = presupTotal > 0
      ? filas.reduce((s, f) => s + f.real * f.presupuesto, 0) / presupTotal
      : 0;
    const desvObra = realObra - planObra;
    const atrasadas = filas.filter(f => f.status === 'atrasada').length;
    const aTiempo = filas.filter(f => f.status === 'en_curso' || f.status === 'adelantada' || f.status === 'completada').length;
    return { presupTotal, planObra, realObra, desvObra, atrasadas, aTiempo, total: filas.length };
  }, [filas]);

  // ── Proyección de fin de obra ──
  const proy = uM(() => {
    if (!obra?.fecha_inicio) return null;
    const diasTrans = Math.max(1, daysBetween(obra.fecha_inicio, today));
    const velocidad = kpis.realObra / diasTrans; // % por día
    const faltante = Math.max(0, 1 - kpis.realObra);
    let diasRestantes = velocidad > 0 ? Math.ceil(faltante / velocidad) : null;
    let fechaProyectada = diasRestantes != null ? addDaysISO(today, diasRestantes) : null;

    let diffDias = null;
    if (obra.fecha_fin_estimada && fechaProyectada) {
      diffDias = daysBetween(obra.fecha_fin_estimada, fechaProyectada);
    }
    return {
      diasTrans, velocidad, faltante, diasRestantes, fechaProyectada,
      fechaPlan: obra.fecha_fin_estimada || null, diffDias,
      sinDatos: !(velocidad > 0),
    };
  }, [obra, kpis, today]);

  const COLOR = { ok: '#34D399', warn: '#F2B705', bad: '#E74C3C', blue: '#4A90E2' };
  const colorDesv = kpis.desvObra >= 0 ? COLOR.ok : (kpis.desvObra > -0.05 ? COLOR.warn : COLOR.bad);
  const colorProy = !proy ? COLOR.blue
    : proy.sinDatos ? COLOR.warn
    : proy.diffDias == null ? COLOR.blue
    : (proy.diffDias > 30 ? COLOR.bad : (proy.diffDias > 0 ? COLOR.warn : COLOR.ok));

  const exportPDF = () => {
    if (!obra) return;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    doc.setFillColor(13, 24, 34); doc.rect(0, 0, 210, 24, 'F');
    doc.setTextColor(242, 183, 5); doc.setFontSize(15); doc.setFont('helvetica', 'bold');
    doc.text('JARVEX', 14, 12);
    doc.setTextColor(255, 255, 255); doc.setFontSize(11); doc.setFont('helvetica', 'normal');
    doc.text(`Cumplimiento de Cronograma · ${obra.nombre || obra.codigo || ''}`, 14, 18);
    doc.setTextColor(0, 0, 0); doc.setFontSize(9);
    let y = 32;

    autoTable(doc, {
      startY: y, head: [['Resumen de obra', '']], body: [
        ['Avance planificado a la fecha', fmtPct(kpis.planObra)],
        ['Avance real (ponderado)',       fmtPct(kpis.realObra)],
        ['Desviación',                    `${(kpis.desvObra * 100).toFixed(1)}%`],
        ['Partidas atrasadas',            String(kpis.atrasadas)],
        ['Partidas a tiempo / adelantadas / completadas', String(kpis.aTiempo)],
        ['Total partidas',                String(kpis.total)],
      ],
      headStyles: { fillColor: [30, 45, 66], textColor: 242 }, bodyStyles: { fontSize: 9 }, theme: 'grid',
    });
    y = doc.lastAutoTable.finalY + 4;

    if (proy) {
      autoTable(doc, {
        startY: y, head: [['Proyección de fin de obra', '']], body: [
          ['Días transcurridos',         String(proy.diasTrans)],
          ['Velocidad (% / día)',        proy.sinDatos ? '—' : (proy.velocidad * 100).toFixed(3) + '%'],
          ['Días restantes proyectados', proy.diasRestantes != null ? String(proy.diasRestantes) : '—'],
          ['Fecha proyectada de fin',    proy.fechaProyectada || '—'],
          ['Fecha plan de fin',          proy.fechaPlan || '—'],
          ['Diferencia (días)',          proy.diffDias != null ? `${proy.diffDias} días` : '—'],
        ],
        headStyles: { fillColor: [30, 45, 66], textColor: 242 }, bodyStyles: { fontSize: 9 }, theme: 'grid',
      });
      y = doc.lastAutoTable.finalY + 4;
    }

    autoTable(doc, {
      startY: y,
      head: [['Código', 'Partida', 'Plan %', 'Real %', 'Desv.', 'Días', 'Estado']],
      body: filasView.map(f => [
        f.codigo,
        (f.nombre || '').slice(0, 38),
        fmtPct(f.pctPlan),
        fmtPct(f.real),
        (f.desviacion >= 0 ? '+' : '') + (f.desviacion * 100).toFixed(1) + '%',
        (f.diasDelta >= 0 ? '+' : '') + f.diasDelta,
        f.status.replace('_', ' '),
      ]),
      headStyles: { fillColor: [30, 45, 66], textColor: 242 },
      bodyStyles: { fontSize: 8 },
      columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 60 } },
      theme: 'grid',
    });

    const slug = String(obra.nombre || obra.codigo || 'obra').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30);
    doc.save(`cumplimiento_cronograma_${slug}_${todayISO()}.pdf`);
  };

  if (obras.length === 0) {
    return <div className="page-wrap"><div className="card card-p"><p>No hay obras disponibles.</p></div></div>;
  }

  return (
    <div className="page-wrap">
      <div className="card card-p" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>Cumplimiento de Cronograma</h2>
          <select value={obraId} onChange={e => setObraId(e.target.value)} style={{ minWidth: 280 }}>
            {obras.filter(o => !o.deleted_at).map(o => (
              <option key={o.id} value={o.id}>{o.nombre || o.codigo || o.id.slice(0, 8)}</option>
            ))}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--tm)' }}>
            <input type="checkbox" checked={soloAtrasadas} onChange={e => setSoloAtrasadas(e.target.checked)} />
            Solo atrasadas
          </label>
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={exportPDF} disabled={!obra}>
            <JxIcon name="download" size={14} /> Exportar PDF
          </button>
        </div>
      </div>

      {!obra ? (
        <div className="card card-p"><p>Selecciona una obra.</p></div>
      ) : filas.length === 0 ? (
        <div className="card card-p">
          <div className="empty-state">
            <JxIcon name="gantt" size={32} color="var(--tm)" />
            <p style={{ color: 'var(--ts)', fontWeight: 600, margin: '8px 0 4px' }}>No hay partidas para esta obra.</p>
            <p style={{ color: 'var(--tm)', fontSize: 12 }}>Importa partidas y cronograma desde S10 para ver el cumplimiento.</p>
          </div>
        </div>
      ) : (
        <>
          <SectionH title="Resumen" />
          <div className="kpi-grid">
            <KpiCard label="Avance planificado" value={fmtPct(kpis.planObra)} sub={`a ${today}`} color={COLOR.blue} icon="calendar" accent />
            <KpiCard label="Avance real" value={fmtPct(kpis.realObra)} sub={`${fmtCurK(kpis.presupTotal)} presup.`} color={COLOR.blue} icon="trending" accent />
            <KpiCard label="Desviación" value={`${(kpis.desvObra * 100).toFixed(1)}%`} sub={kpis.desvObra >= 0 ? 'adelantado / on-time' : 'atrasado'} color={colorDesv} icon="compare" accent />
            <KpiCard label="Partidas atrasadas" value={String(kpis.atrasadas)} sub={`de ${kpis.total} total`} color={kpis.atrasadas > 0 ? COLOR.bad : COLOR.ok} icon="alert" accent />
            <KpiCard label="A tiempo / adelantadas" value={String(kpis.aTiempo)} sub={`de ${kpis.total} total`} color={COLOR.ok} icon="check" accent />
          </div>

          <SectionH title="Proyección de fin de obra" />
          {!proy ? (
            <div className="card card-p"><p style={{ color: 'var(--tm)' }}>Falta fecha de inicio de obra.</p></div>
          ) : proy.sinDatos ? (
            <div className="card card-p">
              <p style={{ color: 'var(--tm)' }}>
                Sin avance real registrado todavía. No se puede proyectar la fecha de fin de obra.
                {proy.fechaPlan && <> Fecha plan: <strong>{proy.fechaPlan}</strong>.</>}
              </p>
            </div>
          ) : (
            <div className="kpi-grid">
              <KpiCard label="Velocidad histórica" value={(proy.velocidad * 100).toFixed(3) + '%/d'} sub={`${proy.diasTrans} días transcurridos`} color={COLOR.blue} icon="clock" accent />
              <KpiCard label="Días restantes" value={String(proy.diasRestantes)} sub={`para completar ${(proy.faltante * 100).toFixed(1)}%`} color={COLOR.blue} icon="calendar" accent />
              <KpiCard label="Fecha proyectada fin" value={proy.fechaProyectada || '—'} sub={proy.fechaPlan ? `plan: ${proy.fechaPlan}` : ''} color={colorProy} icon="calendar" accent />
              <KpiCard label="Diferencia vs plan" value={proy.diffDias != null ? `${proy.diffDias >= 0 ? '+' : ''}${proy.diffDias} d` : '—'} sub={proy.diffDias == null ? 'sin plan' : (proy.diffDias > 30 ? 'retraso crítico' : proy.diffDias > 0 ? 'retraso' : 'on-time / adelantado')} color={colorProy} icon="compare" accent />
            </div>
          )}

          <SectionH title={`Detalle por partida${soloAtrasadas ? ' (solo atrasadas)' : ''}`} />
          <div className="card card-p" style={{ marginTop: 8, overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Partida</th>
                  <th style={{ textAlign: 'right' }}>Plan %</th>
                  <th style={{ textAlign: 'right' }}>Real %</th>
                  <th style={{ textAlign: 'right' }}>Desv.</th>
                  <th style={{ textAlign: 'right' }}>Días</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {filasView.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--tm)', padding: 16 }}>Sin partidas con ese filtro.</td></tr>
                ) : filasView.map(f => {
                  const desvColor = f.desviacion >= 0 ? COLOR.ok : (f.desviacion > -0.05 ? COLOR.warn : COLOR.bad);
                  return (
                    <tr key={f.id}>
                      <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{f.codigo}</td>
                      <td>{f.nombre}</td>
                      <td style={{ textAlign: 'right' }}>{fmtPct(f.pctPlan)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtPct(f.real)}</td>
                      <td style={{ textAlign: 'right', color: desvColor, fontWeight: 600 }}>
                        {(f.desviacion >= 0 ? '+' : '')}{(f.desviacion * 100).toFixed(1)}%
                      </td>
                      <td style={{ textAlign: 'right', color: desvColor }}>
                        {(f.diasDelta >= 0 ? '+' : '')}{f.diasDelta}
                      </td>
                      <td><StatusBadge status={f.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

Object.assign(window, { CumplimientoCronogramaPage });
