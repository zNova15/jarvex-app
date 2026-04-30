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
const startOfMonthISO = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => {
  if (!a || !b) return 0;
  return Math.round((new Date(b) - new Date(a)) / 86400000);
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

function KPIsObraPage() {
  const { data: obras = [] } = (window.__hooks?.useObras?.() ?? { data: [] });
  const [obraId, setObraId] = uS('');

  uE(() => {
    if (!obraId && obras.length > 0) {
      const stored = window.__getObraActivaId?.();
      const a = (stored && obras.find(o => o.id === stored && !o.deleted_at)) || obras.find(o => !o.deleted_at);
      if (a) setObraId(a.id);
    }
  }, [obras]);

  const obra = obras.find(o => o.id === obraId);

  const { data: partidas = [] } = (window.__hooks?.usePartidas?.(obraId) ?? { data: [] });
  const { data: valorizaciones = [] } = (window.__hooks?.useValorizaciones?.(obraId) ?? { data: [] });
  const { data: personal = [] } = (window.__hooks?.usePersonal?.(obraId) ?? { data: [] });
  const { data: asistencias = [] } = (window.__hooks?.useAsistencia?.(obraId) ?? { data: [] });
  const { data: movs = [] } = (window.__hooks?.useAccountingMovements?.() ?? { data: [] });
  const { data: activos = [] } = (window.__hooks?.useActivosPesados?.() ?? { data: [] });
  const { data: hms = [] } = (window.__hooks?.useHorasMaquina?.() ?? { data: [] });
  const { data: charlas = [] } = (window.__hooks?.useCharlasSeguridad?.(obraId) ?? { data: [] });
  const { data: ipercs = [] } = (window.__hooks?.useIperc?.(obraId) ?? { data: [] });
  const { data: incidencias = [] } = (window.__hooks?.useIncidencias?.(obraId) ?? { data: [] });
  const { data: epps = [] } = (window.__hooks?.useEppEntregas?.(obraId) ?? { data: [] });
  const { data: requisiciones = [] } = (window.__hooks?.useRequisiciones?.(obraId) ?? { data: [] });
  const { data: ocs = [] } = (window.__hooks?.useOrdenesCompra?.(obraId) ?? { data: [] });
  const { data: subcontratos = [] } = (window.__hooks?.useSubcontratos?.() ?? { data: [] });

  // ── Sección 1: Avance ──
  const avance = uM(() => {
    const ps = (partidas || []).filter(p => !p.deleted_at);
    const presupuesto = ps.reduce((s, p) => s + Number(p.precio_unitario || 0) * Number(p.metrado_total || 0), 0);
    const totalMetrado = ps.reduce((s, p) => s + Number(p.metrado_total || 0), 0);
    const fisico = totalMetrado > 0
      ? ps.reduce((s, p) => s + (Number(p.porcentaje_avance || 0) / 100) * Number(p.metrado_total || 0), 0) / totalMetrado
      : 0;
    const valorizado = (valorizaciones || []).filter(v => !v.deleted_at && v.estado === 'aprobada')
      .reduce((s, v) => s + Number(v.monto_neto || v.monto_total || 0), 0);
    const financiero = presupuesto > 0 ? valorizado / presupuesto : 0;
    const gap = fisico - financiero;
    let gapStatus = 'alineado';
    if (gap > 0.05) gapStatus = 'retraso_facturacion';
    else if (gap < -0.05) gapStatus = 'sobrefacturacion';
    return { fisico, financiero, presupuesto, valorizado, gap, gapStatus, partidas: ps.length };
  }, [partidas, valorizaciones]);

  // ── Sección 2: Costos ──
  const costos = uM(() => {
    const movsObra = (movs || []).filter(m => !m.deleted_at && m.obra_id === obraId && (m.type === 'cost' || m.type === 'expense'));
    const ejecutado = movsObra.reduce((s, m) => s + Number(m.amount || 0), 0);
    const planificadoAlAvance = avance.presupuesto * avance.fisico;
    const variacion = ejecutado - planificadoAlAvance;
    const pctVariacion = planificadoAlAvance > 0 ? variacion / planificadoAlAvance : 0;

    const cats = { materiales: 0, mano_obra: 0, subcontratos: 0, equipos: 0, otros: 0 };
    movsObra.forEach(m => {
      const c = String(m.category || '').toLowerCase();
      if (/material/.test(c)) cats.materiales += Number(m.amount || 0);
      else if (/(planilla|sueldo|mano|personal)/.test(c)) cats.mano_obra += Number(m.amount || 0);
      else if (/(subcontrato|servicio)/.test(c)) cats.subcontratos += Number(m.amount || 0);
      else if (/(equipo|maquinaria|alquiler)/.test(c)) cats.equipos += Number(m.amount || 0);
      else cats.otros += Number(m.amount || 0);
    });
    return { ejecutado, planificadoAlAvance, variacion, pctVariacion, cats, count: movsObra.length };
  }, [movs, obraId, avance]);

  // ── Sección 3: Personal ──
  const rrhh = uM(() => {
    const ps = (personal || []).filter(p => !p.deleted_at);
    const activos = ps.filter(p => p.estado === 'activo' || !p.estado);
    const hace30 = new Date(); hace30.setDate(hace30.getDate() - 30);
    const hace30ISO = hace30.toISOString().slice(0, 10);
    const asis30 = (asistencias || []).filter(a => !a.deleted_at && a.fecha >= hace30ISO);
    const diasUnicos = new Set(asis30.map(a => a.fecha)).size;
    const promedioDiario = diasUnicos > 0 ? asis30.length / diasUnicos : 0;
    const horasHombre = asis30.reduce((s, a) => s + Number(a.horas_trabajadas || a.horas || 8), 0);
    return { totalActivos: activos.length, asis30: asis30.length, promedioDiario, horasHombre, diasUnicos };
  }, [personal, asistencias]);

  // ── Sección 4: Equipos ──
  const equipos = uM(() => {
    const asignados = (activos || []).filter(a => !a.deleted_at && a.obra_actual_id === obraId);
    const hmObra = (hms || []).filter(h => !h.deleted_at && h.obra_id === obraId)
      .reduce((s, h) => s + Number(h.horas_trabajadas || h.horas || 0), 0);
    return { count: asignados.length, hmAcum: hmObra };
  }, [activos, hms, obraId]);

  // ── Sección 5: SSOMA ──
  const ssoma = uM(() => {
    const desdeMes = startOfMonthISO();
    const charlasMes = (charlas || []).filter(c => !c.deleted_at && c.fecha >= desdeMes).length;
    const ipercAbiertos = (ipercs || []).filter(i => !i.deleted_at && i.estado !== 'controlado').length;
    const incAbiertas = (incidencias || []).filter(i => !i.deleted_at && i.estado !== 'resuelta' && i.estado !== 'cerrada').length;
    const eppMes = (epps || []).filter(e => !e.deleted_at && e.fecha >= desdeMes).length;
    return { charlasMes, ipercAbiertos, incAbiertas, eppMes };
  }, [charlas, ipercs, incidencias, epps]);

  // ── Sección 6: Compras ──
  const compras = uM(() => {
    const reqsPend = (requisiciones || []).filter(r => !r.deleted_at && r.estado !== 'cerrada' && r.estado !== 'rechazada').length;
    const desdeMes = startOfMonthISO();
    const ocsMes = (ocs || []).filter(o => !o.deleted_at && o.fecha >= desdeMes);
    const ocsMontoMes = ocsMes.reduce((s, o) => s + Number(o.monto_total || o.total || 0), 0);
    const subsActivos = (subcontratos || []).filter(s => !s.deleted_at && s.obra_id === obraId && s.estado === 'activo').length;
    return { reqsPend, ocsMesCount: ocsMes.length, ocsMontoMes, subsActivos };
  }, [requisiciones, ocs, subcontratos, obraId]);

  // Días transcurridos vs planificados
  const tiempoObra = uM(() => {
    if (!obra?.fecha_inicio) return { dias: 0, planif: 0, pctTiempo: 0 };
    const dias = daysBetween(obra.fecha_inicio, todayISO());
    const planif = obra.fecha_fin_estimada ? daysBetween(obra.fecha_inicio, obra.fecha_fin_estimada) : 0;
    const pctTiempo = planif > 0 ? Math.min(1, dias / planif) : 0;
    return { dias, planif, pctTiempo };
  }, [obra]);

  const COLOR = { ok: '#34D399', warn: '#F2B705', bad: '#E74C3C', blue: '#4A90E2' };
  const colorVariacion = Math.abs(costos.pctVariacion) <= 0.1 ? COLOR.ok : Math.abs(costos.pctVariacion) <= 0.2 ? COLOR.warn : COLOR.bad;
  const colorGap = avance.gapStatus === 'alineado' ? COLOR.ok : COLOR.warn;

  const exportPDF = () => {
    if (!obra) return;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    doc.setFillColor(13, 24, 34); doc.rect(0, 0, 210, 24, 'F');
    doc.setTextColor(242, 183, 5); doc.setFontSize(15); doc.setFont('helvetica', 'bold');
    doc.text('JARVEX', 14, 12);
    doc.setTextColor(255, 255, 255); doc.setFontSize(11); doc.setFont('helvetica', 'normal');
    doc.text(`KPIs de Obra · ${obra.nombre || obra.codigo || ''}`, 14, 18);
    doc.setTextColor(0, 0, 0); doc.setFontSize(9);
    let y = 32;
    const sec = (label, rows) => {
      autoTable(doc, {
        startY: y, head: [[label, '']], body: rows,
        headStyles: { fillColor: [30, 45, 66], textColor: 242 }, bodyStyles: { fontSize: 9 }, theme: 'grid',
      });
      y = doc.lastAutoTable.finalY + 4;
    };
    sec('Avance', [
      ['Físico (ponderado)', fmtPct(avance.fisico)],
      ['Financiero (valorizado)', fmtPct(avance.financiero)],
      ['Gap', `${(avance.gap * 100).toFixed(1)}% (${avance.gapStatus})`],
      ['Presupuesto total', fmtCur(avance.presupuesto)],
      ['Valorizado total', fmtCur(avance.valorizado)],
      ['Días transcurridos / planif.', `${tiempoObra.dias} / ${tiempoObra.planif}`],
    ]);
    sec('Costos', [
      ['Ejecutado', fmtCur(costos.ejecutado)],
      ['Planificado al avance', fmtCur(costos.planificadoAlAvance)],
      ['Variación', `${fmtCur(costos.variacion)} (${(costos.pctVariacion * 100).toFixed(1)}%)`],
      ['Materiales', fmtCur(costos.cats.materiales)],
      ['Mano de obra', fmtCur(costos.cats.mano_obra)],
      ['Subcontratos / servicios', fmtCur(costos.cats.subcontratos)],
      ['Equipos / maquinaria', fmtCur(costos.cats.equipos)],
      ['Otros', fmtCur(costos.cats.otros)],
    ]);
    sec('Personal', [
      ['Trabajadores activos', String(rrhh.totalActivos)],
      ['Asistencias últimos 30 días', String(rrhh.asis30)],
      ['Promedio diario', rrhh.promedioDiario.toFixed(1)],
      ['Horas-hombre acumuladas (30d)', rrhh.horasHombre.toFixed(0)],
    ]);
    sec('Equipos / Maquinaria', [
      ['Activos asignados', String(equipos.count)],
      ['HM acumuladas en obra', equipos.hmAcum.toFixed(1)],
    ]);
    sec('SSOMA', [
      ['Charlas mes', String(ssoma.charlasMes)],
      ['IPERC abiertos', String(ssoma.ipercAbiertos)],
      ['Incidencias abiertas', String(ssoma.incAbiertas)],
      ['EPP entregadas mes', String(ssoma.eppMes)],
    ]);
    sec('Compras / Subcontratos', [
      ['Requisiciones pendientes', String(compras.reqsPend)],
      ['OC del mes', `${compras.ocsMesCount} (${fmtCur(compras.ocsMontoMes)})`],
      ['Subcontratos activos', String(compras.subsActivos)],
    ]);
    const slug = String(obra.nombre || obra.codigo || 'obra').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30);
    doc.save(`kpis_obra_${slug}_${todayISO()}.pdf`);
  };

  if (obras.length === 0) {
    return <div className="page-wrap"><div className="card card-p"><p>No hay obras disponibles.</p></div></div>;
  }

  return (
    <div className="page-wrap">
      <div className="card card-p" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>KPIs por Obra</h2>
          <select value={obraId} onChange={e => setObraId(e.target.value)} style={{ minWidth: 280 }}>
            {obras.filter(o => !o.deleted_at).map(o => (
              <option key={o.id} value={o.id}>{o.nombre || o.codigo || o.id.slice(0, 8)}</option>
            ))}
          </select>
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={exportPDF} disabled={!obra}>
            <JxIcon name="download" size={14} /> Exportar PDF
          </button>
        </div>
      </div>

      {!obra ? (
        <div className="card card-p"><p>Selecciona una obra.</p></div>
      ) : (
        <>
          <SectionH title="Avance" />
          <div className="kpi-grid">
            <KpiCard label="Avance físico" value={fmtPct(avance.fisico)} sub={`${avance.partidas} partidas`} color={COLOR.blue} icon="trending" accent />
            <KpiCard label="Avance financiero" value={fmtPct(avance.financiero)} sub={`${fmtCurK(avance.valorizado)} / ${fmtCurK(avance.presupuesto)}`} color={COLOR.blue} icon="dollar" accent />
            <KpiCard label="Gap físico - financ." value={`${(avance.gap * 100).toFixed(1)}%`} sub={avance.gapStatus.replace('_', ' ')} color={colorGap} icon="compare" accent />
            <KpiCard label="Días transcurridos" value={`${tiempoObra.dias}`} sub={`de ${tiempoObra.planif} planif. (${(tiempoObra.pctTiempo * 100).toFixed(0)}%)`} color={COLOR.blue} icon="calendar" accent />
          </div>

          <SectionH title="Costos" />
          <div className="kpi-grid">
            <KpiCard label="Costo ejecutado" value={fmtCurK(costos.ejecutado)} sub={`${costos.count} movimientos`} color={COLOR.bad} icon="dollar" accent />
            <KpiCard label="Planificado al avance" value={fmtCurK(costos.planificadoAlAvance)} color={COLOR.blue} accent />
            <KpiCard label="Variación" value={fmtCurK(costos.variacion)} sub={`${(costos.pctVariacion * 100).toFixed(1)}%`} color={colorVariacion} accent />
          </div>
          <div className="card card-p" style={{ marginTop: 8 }}>
            <table className="tbl">
              <thead><tr><th>Categoría</th><th style={{ textAlign: 'right' }}>Monto</th><th style={{ textAlign: 'right' }}>%</th></tr></thead>
              <tbody>
                {Object.entries(costos.cats).map(([k, v]) => (
                  <tr key={k}>
                    <td>{k.replace('_', ' ')}</td>
                    <td style={{ textAlign: 'right' }}>{fmtCur(v)}</td>
                    <td style={{ textAlign: 'right' }}>{costos.ejecutado > 0 ? ((v / costos.ejecutado) * 100).toFixed(1) + '%' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <SectionH title="Personal y productividad" />
          <div className="kpi-grid">
            <KpiCard label="Trabajadores activos" value={String(rrhh.totalActivos)} color={COLOR.blue} icon="users" accent />
            <KpiCard label="Asistencias 30d" value={String(rrhh.asis30)} sub={`${rrhh.diasUnicos} días con asistencia`} color={COLOR.ok} icon="check" accent />
            <KpiCard label="Promedio diario" value={rrhh.promedioDiario.toFixed(1)} color={COLOR.ok} accent />
            <KpiCard label="Horas-hombre 30d" value={rrhh.horasHombre.toFixed(0)} color={COLOR.blue} icon="clock" accent />
          </div>

          <SectionH title="Equipos y maquinaria" />
          <div className="kpi-grid">
            <KpiCard label="Activos asignados" value={String(equipos.count)} color={COLOR.blue} icon="tool" accent />
            <KpiCard label="HM acumuladas" value={equipos.hmAcum.toFixed(0)} color={COLOR.blue} icon="clock" accent />
          </div>

          <SectionH title="SSOMA" />
          <div className="kpi-grid">
            <KpiCard label="Charlas mes" value={String(ssoma.charlasMes)} color={COLOR.ok} icon="shield" accent />
            <KpiCard label="IPERC abiertos" value={String(ssoma.ipercAbiertos)} color={ssoma.ipercAbiertos > 0 ? COLOR.warn : COLOR.ok} icon="alert" accent />
            <KpiCard label="Incidencias abiertas" value={String(ssoma.incAbiertas)} color={ssoma.incAbiertas > 0 ? COLOR.bad : COLOR.ok} icon="alert" accent />
            <KpiCard label="EPP entregadas mes" value={String(ssoma.eppMes)} color={COLOR.ok} icon="check" accent />
          </div>

          <SectionH title="Compras y subcontratos" />
          <div className="kpi-grid">
            <KpiCard label="Requisiciones pendientes" value={String(compras.reqsPend)} color={compras.reqsPend > 0 ? COLOR.warn : COLOR.ok} icon="list" accent />
            <KpiCard label="OC del mes" value={String(compras.ocsMesCount)} sub={fmtCurK(compras.ocsMontoMes)} color={COLOR.blue} icon="package" accent />
            <KpiCard label="Subcontratos activos" value={String(compras.subsActivos)} color={COLOR.blue} icon="users" accent />
          </div>
        </>
      )}
    </div>
  );
}

Object.assign(window, { KPIsObraPage });
