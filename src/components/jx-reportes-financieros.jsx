import React from "react";
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const { useState: uSF, useMemo: uMF, useEffect: uEF, useRef: uRF } = React;

// ─── Helpers ─────────────────────────────────────────────────
const fmtCurF = (n, currency = 'PEN') => {
  const symbol = currency === 'USD' ? 'USD ' : 'S/ ';
  return symbol + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtCurFK = (n, currency = 'PEN') => {
  const v = Number(n || 0);
  const symbol = currency === 'USD' ? 'USD ' : 'S/ ';
  if (Math.abs(v) >= 1e6) return symbol + (v / 1e6).toFixed(2) + 'M';
  if (Math.abs(v) >= 1e3) return symbol + (v / 1e3).toFixed(0) + 'K';
  return symbol + v.toFixed(0);
};

const MESES_ABBR = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Set','Oct','Nov','Dic'];
const MESES_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Setiembre','Octubre','Noviembre','Diciembre'];

const parseDate = (s) => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

const addDaysISO = (s, days) => {
  const d = parseDate(s);
  if (!d) return null;
  d.setDate(d.getDate() + days);
  return d;
};

const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
const monthLabel = (d) => `${MESES_ABBR[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
const monthFullLabel = (d) => `${MESES_FULL[d.getMonth()]} ${d.getFullYear()}`;

// ╔════════════════════════════════════════════════════════════╗
// ║  FLUJO DE CAJA PROYECTADO                                  ║
// ╚════════════════════════════════════════════════════════════╝
function FlujoProyectadoPage({ showToast }) {
  const { data: companies } = window.__hooks.useCompanies();
  const { data: movs }      = window.__hooks.useAccountingMovements();
  const { data: pagos }     = window.__hooks.useCronogramaPagos();
  const { data: valors }    = window.__hooks.useValorizaciones();
  const { data: contratos } = window.__hooks.usePersonalContrato();

  const [companyId, setCompanyId] = uSF('todas');
  const [horizonte, setHorizonte] = uSF(6);
  const [moneda, setMoneda] = uSF('PEN');
  const [saldoInicial, setSaldoInicial] = uSF(0);
  const chartRef = uRF(null);
  const chartInstanceRef = uRF(null);

  // Cargar saldo inicial desde cuentas_bancarias activas
  uEF(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await window.__db.cuentas_bancarias
          .filter(c => !c.deleted_at && c.estado !== 'cerrada' && c.estado !== 'inactiva')
          .toArray();
        const filtradas = all.filter(c =>
          (c.currency || 'PEN') === moneda &&
          (companyId === 'todas' || c.company_id === companyId)
        );
        const saldo = filtradas.reduce((s, c) => s + Number(c.saldo_actual || 0), 0);
        if (!cancelled) setSaldoInicial(saldo);
      } catch (e) {
        if (!cancelled) setSaldoInicial(0);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, moneda]);

  const proyeccion = uMF(() => {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    // Generar lista de meses futuros
    const meses = [];
    for (let i = 1; i <= horizonte; i++) {
      const d = new Date(hoy.getFullYear(), hoy.getMonth() + i, 1);
      meses.push({
        offset: i,
        key: monthKey(d),
        label: monthLabel(d),
        fullLabel: monthFullLabel(d),
        year: d.getFullYear(),
        month: d.getMonth(),
        ingresos: 0,
        egresos: 0,
        flujoNeto: 0,
        saldoAcumulado: 0,
      });
    }

    const mesByKey = new Map(meses.map(m => [m.key, m]));

    // ── Ingresos esperados ──────────────────────────────────────
    // 1) movs type=income, payment_status=pending
    (movs || [])
      .filter(m => !m.deleted_at &&
        m.type === 'income' &&
        m.payment_status === 'pending' &&
        (m.currency || 'PEN') === moneda &&
        (companyId === 'todas' || m.company_id === companyId))
      .forEach(m => {
        const fechaBase = m.fecha_cobro_esperada
          ? parseDate(m.fecha_cobro_esperada)
          : addDaysISO(m.fecha || m.date || m.created_at, 30);
        if (!fechaBase) return;
        const k = monthKey(fechaBase);
        const mes = mesByKey.get(k);
        if (mes) mes.ingresos += Number(m.amount || 0);
      });

    // 2) valorizaciones aprobadas con fecha_pago_estimada
    (valors || [])
      .filter(v => !v.deleted_at && v.estado === 'aprobada')
      .forEach(v => {
        const fecha = parseDate(v.fecha_pago_estimada);
        if (!fecha) return;
        const k = monthKey(fecha);
        const mes = mesByKey.get(k);
        if (mes) mes.ingresos += Number(v.monto_neto || v.monto_total || v.monto || 0);
      });

    // ── Egresos esperados ───────────────────────────────────────
    // 1) cronograma_pagos programado/vencido
    (pagos || [])
      .filter(p => !p.deleted_at &&
        (p.estado === 'programado' || p.estado === 'vencido') &&
        ((p.currency || 'PEN') === moneda) &&
        (companyId === 'todas' || p.company_id === companyId || !p.company_id))
      .forEach(p => {
        const fecha = parseDate(p.fecha_programada);
        if (!fecha) return;
        const k = monthKey(fecha);
        const mes = mesByKey.get(k);
        if (mes) mes.egresos += Number(p.monto || 0);
      });

    // 2) movs cost/expense pending
    (movs || [])
      .filter(m => !m.deleted_at &&
        (m.type === 'cost' || m.type === 'expense') &&
        m.payment_status === 'pending' &&
        (m.currency || 'PEN') === moneda &&
        (companyId === 'todas' || m.company_id === companyId))
      .forEach(m => {
        const fechaBase = m.fecha_pago_esperada
          ? parseDate(m.fecha_pago_esperada)
          : addDaysISO(m.fecha || m.date || m.created_at, 30);
        if (!fechaBase) return;
        const k = monthKey(fechaBase);
        const mes = mesByKey.get(k);
        if (mes) mes.egresos += Number(m.amount || 0);
      });

    // 3) Planilla mensual estimada (proxy)
    // Solo aplica para PEN (planilla siempre en soles)
    if (moneda === 'PEN') {
      const contratosActivos = (contratos || []).filter(c =>
        !c.deleted_at &&
        (c.estado === 'activo' || c.activo === true || (!c.estado && !c.fecha_fin)) &&
        (companyId === 'todas' || c.company_id === companyId || !c.company_id)
      );
      const planillaMensual = contratosActivos.reduce((s, c) =>
        s + Number(c.sueldo_basico || 0) + Number(c.asignacion_familiar || 0), 0);
      if (planillaMensual > 0) {
        meses.forEach(m => { m.egresos += planillaMensual; });
      }
    }

    // ── Flujo neto + saldo acumulado ────────────────────────────
    let saldo = Number(saldoInicial || 0);
    meses.forEach(m => {
      m.flujoNeto = m.ingresos - m.egresos;
      saldo += m.flujoNeto;
      m.saldoAcumulado = saldo;
    });

    const totalIng = meses.reduce((s, m) => s + m.ingresos, 0);
    const totalEgr = meses.reduce((s, m) => s + m.egresos, 0);
    const saldoFinal = meses.length ? meses[meses.length - 1].saldoAcumulado : saldoInicial;
    const peor = meses.reduce((acc, m) =>
      (acc === null || m.flujoNeto < acc.flujoNeto) ? m : acc, null);
    const mejor = meses.reduce((acc, m) =>
      (acc === null || m.flujoNeto > acc.flujoNeto) ? m : acc, null);

    return { meses, totalIng, totalEgr, saldoFinal, peor, mejor };
  }, [movs, pagos, valors, contratos, companyId, horizonte, moneda, saldoInicial]);

  // ── Renderizar gráfico Chart.js si está disponible ─────────────
  uEF(() => {
    if (!window.Chart || !chartRef.current) return;
    const ctx = chartRef.current.getContext('2d');
    if (chartInstanceRef.current) {
      try { chartInstanceRef.current.destroy(); } catch {}
      chartInstanceRef.current = null;
    }
    const labels = proyeccion.meses.map(m => m.label);
    const ing = proyeccion.meses.map(m => m.ingresos);
    const egr = proyeccion.meses.map(m => m.egresos);
    const acc = proyeccion.meses.map(m => m.saldoAcumulado);
    try {
      chartInstanceRef.current = new window.Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { type: 'bar', label: 'Ingresos', data: ing, backgroundColor: 'rgba(46,204,113,0.7)', order: 2 },
            { type: 'bar', label: 'Egresos', data: egr, backgroundColor: 'rgba(231,76,60,0.7)', order: 2 },
            { type: 'line', label: 'Saldo acumulado', data: acc, borderColor: 'rgba(74,144,226,1)', backgroundColor: 'rgba(74,144,226,0.15)', borderWidth: 2, tension: 0.25, fill: false, order: 1 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom' } },
          scales: { y: { beginAtZero: false, ticks: { callback: v => fmtCurFK(v, moneda) } } },
        },
      });
    } catch {}
    return () => {
      if (chartInstanceRef.current) {
        try { chartInstanceRef.current.destroy(); } catch {}
        chartInstanceRef.current = null;
      }
    };
  }, [proyeccion, moneda]);

  const empresaSel = (companies || []).find(c => c.id === companyId);
  const tituloEmpresa = companyId === 'todas' ? 'Grupo consolidado' : (empresaSel?.name || '—');

  const exportarPDF = () => {
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const W = doc.internal.pageSize.getWidth();

      doc.setFontSize(16); doc.setFont('helvetica', 'bold');
      doc.text('Flujo de Caja Proyectado', W/2, 15, { align: 'center' });
      doc.setFontSize(10); doc.setFont('helvetica', 'normal');
      doc.text(`${tituloEmpresa} — Horizonte ${horizonte} meses (${moneda})`, W/2, 22, { align: 'center' });
      doc.text(`Saldo inicial: ${fmtCurF(saldoInicial, moneda)}`, W/2, 27, { align: 'center' });

      const filas = proyeccion.meses.map(m => [
        `M+${m.offset}`,
        m.fullLabel,
        fmtCurF(m.ingresos, moneda),
        fmtCurF(m.egresos, moneda),
        fmtCurF(m.flujoNeto, moneda),
        fmtCurF(m.saldoAcumulado, moneda),
      ]);
      filas.push([
        '', 'TOTAL',
        fmtCurF(proyeccion.totalIng, moneda),
        fmtCurF(proyeccion.totalEgr, moneda),
        fmtCurF(proyeccion.totalIng - proyeccion.totalEgr, moneda),
        fmtCurF(proyeccion.saldoFinal, moneda),
      ]);

      autoTable(doc, {
        startY: 33,
        head: [['#', 'Mes', 'Ingresos', 'Egresos', 'Flujo neto', 'Saldo acumulado']],
        body: filas,
        styles: { fontSize: 9 },
        headStyles: { fillColor: [255, 179, 0], textColor: 0 },
        columnStyles: {
          0: { cellWidth: 18, halign: 'center' },
          1: { cellWidth: 50 },
          2: { cellWidth: 45, halign: 'right' },
          3: { cellWidth: 45, halign: 'right' },
          4: { cellWidth: 45, halign: 'right' },
          5: { cellWidth: 50, halign: 'right' },
        },
      });

      doc.setFontSize(9); doc.setTextColor(120);
      doc.text(`Generado por JARVEX — ${new Date().toLocaleString('es-PE')}`, W/2, doc.internal.pageSize.getHeight() - 8, { align: 'center' });

      const safeName = tituloEmpresa.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
      doc.save(`flujo_proyectado_${safeName}_${horizonte}m.pdf`);
      showToast?.('PDF generado', 'green');
    } catch (e) {
      showToast?.('Error generando PDF: ' + (e.message || e), 'red');
    }
  };

  const Icon = (props) => window.JxIcon ? <window.JxIcon {...props}/> : null;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Flujo de Caja Proyectado</div>
          <div className="pg-sub">
            {tituloEmpresa} · próximos {horizonte} meses · saldo inicial {fmtCurF(saldoInicial, moneda)} ({moneda})
          </div>
        </div>
        <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
          <select
            className="fi"
            value={companyId}
            onChange={e=>setCompanyId(e.target.value)}
            style={{ minWidth:160 }}>
            <option value="todas">Todas las empresas</option>
            {(companies || []).filter(c=>c.status==='activa').map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <div style={{ display:'flex', gap:0, border:'1px solid var(--bd)', borderRadius:6, overflow:'hidden' }}>
            <button
              className={horizonte===6 ? 'btn btn-amber btn-sm' : 'btn btn-ghost btn-sm'}
              style={{ borderRadius:0 }}
              onClick={()=>setHorizonte(6)}>6 meses</button>
            <button
              className={horizonte===12 ? 'btn btn-amber btn-sm' : 'btn btn-ghost btn-sm'}
              style={{ borderRadius:0 }}
              onClick={()=>setHorizonte(12)}>12 meses</button>
          </div>
          <select
            className="fi"
            value={moneda}
            onChange={e=>setMoneda(e.target.value)}
            style={{ minWidth:100 }}>
            <option value="PEN">S/ (PEN)</option>
            <option value="USD">USD</option>
          </select>
          <button className="btn btn-ghost btn-sm" onClick={exportarPDF}>
            <Icon name="download" size={13}/>Exportar PDF
          </button>
        </div>
      </div>

      {/* Cards resumen */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:12, marginBottom:18 }}>
        <div className="card card-p" style={{ borderLeft:'3px solid var(--green)' }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Total ingresos</div>
          <div style={{ fontSize:22, fontWeight:800, color:'var(--green)', marginTop:4 }}>{fmtCurF(proyeccion.totalIng, moneda)}</div>
        </div>
        <div className="card card-p" style={{ borderLeft:'3px solid var(--red)' }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Total egresos</div>
          <div style={{ fontSize:22, fontWeight:800, color:'var(--red)', marginTop:4 }}>{fmtCurF(proyeccion.totalEgr, moneda)}</div>
        </div>
        <div className="card card-p" style={{ borderLeft:`3px solid ${proyeccion.saldoFinal>=0?'var(--blue)':'var(--red)'}` }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Saldo final proyectado</div>
          <div style={{ fontSize:22, fontWeight:800, color: proyeccion.saldoFinal>=0?'var(--blue)':'var(--red)', marginTop:4 }}>{fmtCurF(proyeccion.saldoFinal, moneda)}</div>
        </div>
        <div className="card card-p" style={{ borderLeft:'3px solid var(--amber)' }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Mes con mayor déficit</div>
          <div style={{ fontSize:16, fontWeight:700, marginTop:4 }}>
            {proyeccion.peor && proyeccion.peor.flujoNeto < 0
              ? `${proyeccion.peor.fullLabel}`
              : 'Sin déficit ✓'}
          </div>
          {proyeccion.peor && proyeccion.peor.flujoNeto < 0 && (
            <div style={{ fontSize:13, color:'var(--red)', marginTop:2 }}>{fmtCurF(proyeccion.peor.flujoNeto, moneda)}</div>
          )}
        </div>
      </div>

      {/* Gráfico */}
      {window.Chart && proyeccion.meses.length > 0 && (
        <div className="card card-p" style={{ marginBottom:14 }}>
          <div style={{ fontWeight:700, fontSize:13, marginBottom:8 }}>Proyección visual</div>
          <div style={{ height:280 }}>
            <canvas ref={chartRef}/>
          </div>
        </div>
      )}

      {/* Tabla mensual */}
      <div className="card" style={{ overflow:'hidden' }}>
        <div style={{ overflowX:'auto' }}>
          <table className="tbl">
            <thead><tr>
              <th style={{ width:60 }}>#</th>
              <th>Mes</th>
              <th style={{ width:140, textAlign:'right' }}>Ingresos esperados</th>
              <th style={{ width:140, textAlign:'right' }}>Egresos esperados</th>
              <th style={{ width:140, textAlign:'right' }}>Flujo neto</th>
              <th style={{ width:160, textAlign:'right' }}>Saldo acumulado</th>
            </tr></thead>
            <tbody>
              <tr style={{ background:'rgba(74,144,226,0.05)', fontWeight:600 }}>
                <td>—</td>
                <td>Saldo inicial (efectivo actual)</td>
                <td colSpan={3} style={{ textAlign:'right', color:'var(--tm)' }}>—</td>
                <td style={{ textAlign:'right' }} className="col-num">{fmtCurF(saldoInicial, moneda)}</td>
              </tr>
              {proyeccion.meses.map(m => (
                <tr key={m.key}>
                  <td style={{ textAlign:'center', fontWeight:600 }}>M+{m.offset}</td>
                  <td className="col-p">{m.fullLabel}</td>
                  <td style={{ textAlign:'right', color:'var(--green)' }} className="col-num">{fmtCurF(m.ingresos, moneda)}</td>
                  <td style={{ textAlign:'right', color:'var(--red)' }} className="col-num">{fmtCurF(m.egresos, moneda)}</td>
                  <td style={{ textAlign:'right', color: m.flujoNeto>=0?'var(--blue)':'var(--red)', fontWeight:600 }} className="col-num">{fmtCurF(m.flujoNeto, moneda)}</td>
                  <td style={{ textAlign:'right', color: m.saldoAcumulado>=0?'var(--green)':'var(--red)', fontWeight:700 }} className="col-num">{fmtCurF(m.saldoAcumulado, moneda)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight:800, background:'rgba(255,179,0,0.08)' }}>
                <td>—</td>
                <td>TOTAL ({horizonte} meses)</td>
                <td style={{ textAlign:'right', color:'var(--green)' }} className="col-num">{fmtCurF(proyeccion.totalIng, moneda)}</td>
                <td style={{ textAlign:'right', color:'var(--red)' }} className="col-num">{fmtCurF(proyeccion.totalEgr, moneda)}</td>
                <td style={{ textAlign:'right', color: (proyeccion.totalIng-proyeccion.totalEgr)>=0?'var(--blue)':'var(--red)' }} className="col-num">{fmtCurF(proyeccion.totalIng - proyeccion.totalEgr, moneda)}</td>
                <td style={{ textAlign:'right', color: proyeccion.saldoFinal>=0?'var(--green)':'var(--red)' }} className="col-num">{fmtCurF(proyeccion.saldoFinal, moneda)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ fontSize:11, color:'var(--tm)', marginTop:10 }}>
        Proyección basada en cuentas por cobrar pendientes (mov. tipo ingreso + valorizaciones aprobadas), cuentas por pagar pendientes
        (cronograma + mov. tipo costo/gasto) y planilla mensual estimada (sueldo + asignación familiar de personal con contrato activo).
        Fechas sin <em>fecha esperada</em> usan +30 días desde la fecha del movimiento.
      </div>
    </div>
  );
}

// ╔════════════════════════════════════════════════════════════╗
// ║  COMPARATIVO DE PERIODOS                                   ║
// ╚════════════════════════════════════════════════════════════╝
function ComparativoPeriodosPage({ showToast }) {
  const { data: companies } = window.__hooks.useCompanies();
  const { data: movs }      = window.__hooks.useAccountingMovements();

  const [companyId, setCompanyId]   = uSF('todas');
  const [moneda, setMoneda]         = uSF('PEN');
  const [tipoPeriodo, setTipoPeriodo] = uSF('mes'); // mes | trimestre | anio
  const [rango, setRango]           = uSF(12);

  const periodKeyOf = (d, tipo) => {
    const y = d.getFullYear();
    const m = d.getMonth();
    if (tipo === 'anio') return { key: `${y}`, label: `${y}`, sortKey: y * 100 };
    if (tipo === 'trimestre') {
      const q = Math.floor(m / 3) + 1;
      return { key: `${y}-Q${q}`, label: `${y} Q${q}`, sortKey: y * 10 + q };
    }
    // mes
    return { key: `${y}-${String(m+1).padStart(2,'0')}`, label: `${MESES_ABBR[m]} ${String(y).slice(2)}`, sortKey: y * 100 + (m+1) };
  };

  const data = uMF(() => {
    const filtrados = (movs || []).filter(m =>
      !m.deleted_at &&
      (m.currency || 'PEN') === moneda &&
      m.payment_status === 'paid' &&
      (companyId === 'todas' || m.company_id === companyId)
    );

    // Agrupar por periodo
    const map = new Map(); // key -> { key, label, sortKey, ingresos, costos, gastos }
    filtrados.forEach(m => {
      const f = m.fecha_pago || m.fecha || m.date || m.created_at;
      const d = parseDate(f);
      if (!d) return;
      const { key, label, sortKey } = periodKeyOf(d, tipoPeriodo);
      let row = map.get(key);
      if (!row) {
        row = { key, label, sortKey, ingresos: 0, costos: 0, gastos: 0 };
        map.set(key, row);
      }
      const a = Number(m.amount || 0);
      if (m.type === 'income')  row.ingresos += a;
      if (m.type === 'cost')    row.costos   += a;
      if (m.type === 'expense') row.gastos   += a;
    });

    // Generar últimos N periodos (incluso vacíos) hasta el periodo actual
    const hoy = new Date();
    const periodos = [];
    for (let i = rango - 1; i >= 0; i--) {
      let d;
      if (tipoPeriodo === 'mes') {
        d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
      } else if (tipoPeriodo === 'trimestre') {
        const qActual = Math.floor(hoy.getMonth() / 3);
        d = new Date(hoy.getFullYear(), (qActual - i) * 3, 1);
      } else {
        d = new Date(hoy.getFullYear() - i, 0, 1);
      }
      const { key, label, sortKey } = periodKeyOf(d, tipoPeriodo);
      const row = map.get(key) || { key, label, sortKey, ingresos: 0, costos: 0, gastos: 0 };
      row.utilidad = row.ingresos - row.costos - row.gastos;
      row.margen = row.ingresos > 0 ? (row.utilidad / row.ingresos) * 100 : 0;
      periodos.push(row);
    }

    // Totales y promedios
    const totIng = periodos.reduce((s, p) => s + p.ingresos, 0);
    const totCos = periodos.reduce((s, p) => s + p.costos, 0);
    const totGas = periodos.reduce((s, p) => s + p.gastos, 0);
    const totUti = totIng - totCos - totGas;
    const margenProm = totIng > 0 ? (totUti / totIng) * 100 : 0;
    const promIng = periodos.length ? totIng / periodos.length : 0;
    const promUti = periodos.length ? totUti / periodos.length : 0;

    // Insights
    const conIng = periodos.filter(p => p.ingresos > 0 || p.costos > 0 || p.gastos > 0);
    const mejor = conIng.reduce((acc, p) => (acc === null || p.utilidad > acc.utilidad) ? p : acc, null);
    const peor  = conIng.reduce((acc, p) => (acc === null || p.utilidad < acc.utilidad) ? p : acc, null);

    // Tendencia: últimos 3 vs 3 previos
    let tendencia = null;
    if (periodos.length >= 6) {
      const last3 = periodos.slice(-3);
      const prev3 = periodos.slice(-6, -3);
      const sumLast = last3.reduce((s, p) => s + p.utilidad, 0);
      const sumPrev = prev3.reduce((s, p) => s + p.utilidad, 0);
      if (sumPrev !== 0) {
        tendencia = ((sumLast - sumPrev) / Math.abs(sumPrev)) * 100;
      } else if (sumLast !== 0) {
        tendencia = sumLast > 0 ? 100 : -100;
      } else {
        tendencia = 0;
      }
    }

    return {
      periodos, totIng, totCos, totGas, totUti, margenProm,
      promIng, promUti, mejor, peor, tendencia,
    };
  }, [movs, companyId, moneda, tipoPeriodo, rango]);

  const empresaSel = (companies || []).find(c => c.id === companyId);
  const tituloEmpresa = companyId === 'todas' ? 'Grupo consolidado' : (empresaSel?.name || '—');
  const tipoLabel = tipoPeriodo === 'mes' ? 'meses' : tipoPeriodo === 'trimestre' ? 'trimestres' : 'años';

  const exportarExcel = () => {
    try {
      const filas = data.periodos.map(p => [
        p.label,
        Number(p.ingresos.toFixed(2)),
        Number(p.costos.toFixed(2)),
        Number(p.gastos.toFixed(2)),
        Number(p.utilidad.toFixed(2)),
        Number(p.margen.toFixed(1)),
      ]);
      filas.push([
        'TOTAL',
        Number(data.totIng.toFixed(2)),
        Number(data.totCos.toFixed(2)),
        Number(data.totGas.toFixed(2)),
        Number(data.totUti.toFixed(2)),
        Number(data.margenProm.toFixed(1)),
      ]);
      filas.push([
        'PROMEDIO',
        Number(data.promIng.toFixed(2)),
        Number((data.totCos/(data.periodos.length||1)).toFixed(2)),
        Number((data.totGas/(data.periodos.length||1)).toFixed(2)),
        Number(data.promUti.toFixed(2)),
        Number(data.margenProm.toFixed(1)),
      ]);
      window.__reports.generateExcel({
        sheetName: 'Comparativo',
        columnas: ['Periodo', `Ingresos (${moneda})`, `Costos (${moneda})`, `Gastos (${moneda})`, `Utilidad (${moneda})`, 'Margen %'],
        filas,
        filename: `comparativo_${tipoPeriodo}_${rango}p_${tituloEmpresa.replace(/[^a-z0-9]+/gi,'_').toLowerCase()}.xlsx`,
      });
      showToast?.('Excel generado', 'green');
    } catch (e) {
      showToast?.('Error generando Excel: ' + (e.message || e), 'red');
    }
  };

  const Icon = (props) => window.JxIcon ? <window.JxIcon {...props}/> : null;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Comparativo de Periodos</div>
          <div className="pg-sub">
            {tituloEmpresa} · últimos {rango} {tipoLabel} ({moneda})
          </div>
        </div>
        <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
          <select
            className="fi"
            value={companyId}
            onChange={e=>setCompanyId(e.target.value)}
            style={{ minWidth:160 }}>
            <option value="todas">Todas las empresas</option>
            {(companies || []).filter(c=>c.status==='activa').map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select
            className="fi"
            value={tipoPeriodo}
            onChange={e=>setTipoPeriodo(e.target.value)}
            style={{ minWidth:120 }}>
            <option value="mes">Mensual</option>
            <option value="trimestre">Trimestral</option>
            <option value="anio">Anual</option>
          </select>
          <select
            className="fi"
            value={rango}
            onChange={e=>setRango(Number(e.target.value))}
            style={{ minWidth:130 }}>
            <option value={6}>Últimos 6</option>
            <option value={12}>Últimos 12</option>
            <option value={24}>Últimos 24</option>
          </select>
          <select
            className="fi"
            value={moneda}
            onChange={e=>setMoneda(e.target.value)}
            style={{ minWidth:100 }}>
            <option value="PEN">S/ (PEN)</option>
            <option value="USD">USD</option>
          </select>
          <button className="btn btn-ghost btn-sm" onClick={exportarExcel}>
            <Icon name="download" size={13}/>Exportar Excel
          </button>
        </div>
      </div>

      {/* Cards insights */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:12, marginBottom:18 }}>
        <div className="card card-p" style={{ borderLeft:'3px solid var(--green)' }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Mejor periodo</div>
          {data.mejor ? (
            <>
              <div style={{ fontSize:16, fontWeight:700, marginTop:4 }}>{data.mejor.label}</div>
              <div style={{ fontSize:13, color:'var(--green)', marginTop:2 }}>{fmtCurF(data.mejor.utilidad, moneda)}</div>
            </>
          ) : <div style={{ fontSize:13, color:'var(--tm)', marginTop:6 }}>Sin datos</div>}
        </div>
        <div className="card card-p" style={{ borderLeft:'3px solid var(--red)' }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Peor periodo</div>
          {data.peor ? (
            <>
              <div style={{ fontSize:16, fontWeight:700, marginTop:4 }}>{data.peor.label}</div>
              <div style={{ fontSize:13, color:'var(--red)', marginTop:2 }}>{fmtCurF(data.peor.utilidad, moneda)}</div>
            </>
          ) : <div style={{ fontSize:13, color:'var(--tm)', marginTop:6 }}>Sin datos</div>}
        </div>
        <div className="card card-p" style={{ borderLeft:`3px solid ${data.tendencia===null?'var(--tm)':data.tendencia>=0?'var(--green)':'var(--red)'}` }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Tendencia (últ. 3 vs 3 prev.)</div>
          {data.tendencia !== null ? (
            <div style={{ fontSize:22, fontWeight:800, color: data.tendencia>=0?'var(--green)':'var(--red)', marginTop:4 }}>
              {data.tendencia >= 0 ? '+' : ''}{data.tendencia.toFixed(1)}%
            </div>
          ) : <div style={{ fontSize:13, color:'var(--tm)', marginTop:6 }}>Necesitas 6+ periodos</div>}
        </div>
        <div className="card card-p" style={{ borderLeft:`3px solid ${data.totUti>=0?'var(--blue)':'var(--red)'}` }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Utilidad total / margen prom.</div>
          <div style={{ fontSize:20, fontWeight:800, color: data.totUti>=0?'var(--blue)':'var(--red)', marginTop:4 }}>{fmtCurF(data.totUti, moneda)}</div>
          <div style={{ fontSize:11, color:'var(--tm)', marginTop:2 }}>Margen {data.margenProm.toFixed(1)}%</div>
        </div>
      </div>

      {/* Tabla */}
      {data.periodos.length === 0 ? (
        <div className="card card-p empty-state">
          <Icon name="bar-chart" size={40} color="var(--tm)"/>
          <p>No hay movimientos cobrados/pagados en los periodos seleccionados.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <div style={{ overflowX:'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Periodo</th>
                <th style={{ width:140, textAlign:'right' }}>Ingresos cobrados</th>
                <th style={{ width:140, textAlign:'right' }}>Costos pagados</th>
                <th style={{ width:140, textAlign:'right' }}>Gastos pagados</th>
                <th style={{ width:140, textAlign:'right' }}>Utilidad neta</th>
                <th style={{ width:100, textAlign:'right' }}>Margen %</th>
              </tr></thead>
              <tbody>
                {data.periodos.map(p => (
                  <tr key={p.key}>
                    <td className="col-p" style={{ fontWeight:600 }}>{p.label}</td>
                    <td style={{ textAlign:'right', color:'var(--green)' }} className="col-num">{fmtCurF(p.ingresos, moneda)}</td>
                    <td style={{ textAlign:'right', color:'var(--red)' }} className="col-num">{fmtCurF(p.costos, moneda)}</td>
                    <td style={{ textAlign:'right', color:'var(--amber)' }} className="col-num">{fmtCurF(p.gastos, moneda)}</td>
                    <td style={{ textAlign:'right', color: p.utilidad>=0?'var(--blue)':'var(--red)', fontWeight:600 }} className="col-num">{fmtCurF(p.utilidad, moneda)}</td>
                    <td style={{ textAlign:'right', color: p.margen>=0?'var(--blue)':'var(--red)' }}>{p.margen.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight:800, background:'rgba(255,179,0,0.08)' }}>
                  <td>TOTAL</td>
                  <td style={{ textAlign:'right', color:'var(--green)' }} className="col-num">{fmtCurF(data.totIng, moneda)}</td>
                  <td style={{ textAlign:'right', color:'var(--red)' }} className="col-num">{fmtCurF(data.totCos, moneda)}</td>
                  <td style={{ textAlign:'right', color:'var(--amber)' }} className="col-num">{fmtCurF(data.totGas, moneda)}</td>
                  <td style={{ textAlign:'right', color: data.totUti>=0?'var(--blue)':'var(--red)' }} className="col-num">{fmtCurF(data.totUti, moneda)}</td>
                  <td style={{ textAlign:'right' }}>{data.margenProm.toFixed(1)}%</td>
                </tr>
                <tr style={{ fontWeight:600, background:'rgba(74,144,226,0.05)', color:'var(--tm)' }}>
                  <td>PROMEDIO</td>
                  <td style={{ textAlign:'right' }} className="col-num">{fmtCurF(data.promIng, moneda)}</td>
                  <td style={{ textAlign:'right' }} className="col-num">{fmtCurF(data.totCos/(data.periodos.length||1), moneda)}</td>
                  <td style={{ textAlign:'right' }} className="col-num">{fmtCurF(data.totGas/(data.periodos.length||1), moneda)}</td>
                  <td style={{ textAlign:'right' }} className="col-num">{fmtCurF(data.promUti, moneda)}</td>
                  <td style={{ textAlign:'right' }}>{data.margenProm.toFixed(1)}%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <div style={{ fontSize:11, color:'var(--tm)', marginTop:10 }}>
        Sólo se incluyen movimientos con <code>payment_status = paid</code> (ingresos efectivamente cobrados, costos/gastos efectivamente pagados).
        El margen se calcula como utilidad neta / ingresos cobrados del periodo.
      </div>
    </div>
  );
}

// ╔════════════════════════════════════════════════════════════╗
// ║  REGISTRO GLOBAL                                           ║
// ╚════════════════════════════════════════════════════════════╝
Object.assign(window, {
  FlujoProyectadoPage,
  ComparativoPeriodosPage,
});
