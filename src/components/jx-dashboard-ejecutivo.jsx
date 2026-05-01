import React from "react";
const { useState: uS, useMemo: uM, useEffect: uE } = React;

// ─── Helpers ─────────────────────────────────────────────────
const fmtCur = (n, currency = 'PEN') => {
  const symbol = currency === 'USD' ? 'USD ' : 'S/ ';
  return symbol + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtCurK = (n, currency = 'PEN') => {
  const v = Number(n || 0);
  const symbol = currency === 'USD' ? 'USD ' : 'S/ ';
  if (Math.abs(v) >= 1e6) return symbol + (v / 1e6).toFixed(2) + 'M';
  if (Math.abs(v) >= 1e3) return symbol + (v / 1e3).toFixed(0) + 'K';
  return symbol + v.toFixed(0);
};
const startOfMonth = (d) => { const x = new Date(d); x.setDate(1); return x.toISOString().slice(0, 10); };
const endOfMonth = (d) => { const x = new Date(d); x.setMonth(x.getMonth() + 1, 0); return x.toISOString().slice(0, 10); };
const todayISO = () => new Date().toISOString().slice(0, 10);

function KpiCardEj({ label, value, sub, color, icon, accent }) {
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
      <div className="kpi-val" style={{ color: color || 'var(--tp)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ╔════════════════════════════════════════════════════════════╗
// ║  DASHBOARD EJECUTIVO — vista global cross-empresa/cross-obra  ║
// ╚════════════════════════════════════════════════════════════╝
function DashboardEjecutivoPage() {
  // Filtros simples
  const [moneda, setMoneda] = uS('PEN');
  const [desde, setDesde] = uS(startOfMonth(new Date()));
  const [hasta, setHasta] = uS(endOfMonth(new Date()));

  // ── Hooks globales (sin filtro de obra para ver TODO) ──
  const { data: companies } = window.__hooks.useCompanies();
  const { data: obras } = window.__hooks.useObras();
  const { data: personal } = window.__hooks.usePersonal();
  const { data: movs } = window.__hooks.useAccountingMovements();
  const { data: cuentas } = window.__hooks.useCuentasBancarias();
  const { data: movsBanco } = window.__hooks.useMovimientosBancarios();
  const { data: pagos } = window.__hooks.useCronogramaPagos();
  const { data: ordenes } = window.__hooks.useOrdenesCompra();
  const { data: iperc } = window.__hooks.useIperc();
  const { data: materiales } = window.__hooks.useMateriales();
  const { data: valorizaciones } = window.__hooks.useValorizaciones();
  const { data: partidas } = window.__hooks.usePartidas();

  const today = todayISO();

  // ── KPIs principales ──
  const kpis = uM(() => {
    const empresasActivas = (companies || []).filter(c => c.status === 'activa');
    const obrasActivas = (obras || []).filter(o => o.estado === 'activo');
    const personalActivo = (personal || []).filter(p => p.estado === 'activo' || !p.estado);

    // Cash actual: saldo_inicial + Σ movimientos_bancarios por cuenta
    const cuentasActivas = (cuentas || []).filter(c => c.estado === 'activa' && c.moneda === moneda);
    const idsActivas = new Set(cuentasActivas.map(c => c.id));
    let cashActual = 0;
    cuentasActivas.forEach(c => { cashActual += Number(c.saldo_inicial || 0); });
    (movsBanco || []).forEach(m => {
      if (idsActivas.has(m.cuenta_id)) cashActual += Number(m.monto || 0);
    });

    // Por cobrar / por pagar (todas las empresas, en moneda activa, no anulados, pendientes)
    const movsPend = (movs || []).filter(m => m.currency === moneda && m.payment_status === 'pending');
    const porCobrar = movsPend.filter(m => m.type === 'income').reduce((s, m) => s + Number(m.amount || 0), 0);
    const porPagar = movsPend.filter(m => m.type === 'cost' || m.type === 'expense').reduce((s, m) => s + Number(m.amount || 0), 0);

    // Ingresos / costos del rango (excluyendo intercompany)
    const movsRango = (movs || []).filter(m =>
      m.currency === moneda &&
      m.payment_status !== 'cancelled' &&
      !m.is_intercompany &&
      m.date >= desde && m.date <= hasta
    );
    const ingresosMes = movsRango.filter(m => m.type === 'income').reduce((s, m) => s + Number(m.amount || 0), 0);
    const costosMes = movsRango.filter(m => m.type === 'cost').reduce((s, m) => s + Number(m.amount || 0), 0);
    const gastosMes = movsRango.filter(m => m.type === 'expense').reduce((s, m) => s + Number(m.amount || 0), 0);
    const utilidadMes = ingresosMes - costosMes - gastosMes;

    return {
      empresasActivas: empresasActivas.length,
      empresasTotal: (companies || []).length,
      obrasActivas: obrasActivas.length,
      obrasTotal: (obras || []).length,
      personalActivo: personalActivo.length,
      cashActual,
      cuentasActivasCount: cuentasActivas.length,
      porCobrar, porPagar,
      ingresosMes, costosMes, gastosMes, utilidadMes,
      margenMes: ingresosMes > 0 ? (utilidadMes / ingresosMes * 100) : 0,
    };
  }, [companies, obras, personal, cuentas, movsBanco, movs, moneda, desde, hasta]);

  // ── Por empresa ──
  const porEmpresa = uM(() => {
    return (companies || []).filter(c => c.status === 'activa').map(c => {
      const movsCo = (movs || []).filter(m =>
        m.company_id === c.id &&
        m.currency === moneda &&
        m.payment_status !== 'cancelled' &&
        !m.is_intercompany &&
        m.date >= desde && m.date <= hasta
      );
      const ing = movsCo.filter(m => m.type === 'income').reduce((s, m) => s + Number(m.amount || 0), 0);
      const cos = movsCo.filter(m => m.type === 'cost').reduce((s, m) => s + Number(m.amount || 0), 0);
      const gas = movsCo.filter(m => m.type === 'expense').reduce((s, m) => s + Number(m.amount || 0), 0);
      const util = ing - cos - gas;
      const margen = ing > 0 ? (util / ing * 100) : 0;

      const cuentasCo = (cuentas || []).filter(x => x.company_id === c.id && x.estado === 'activa' && x.moneda === moneda);
      const idsCo = new Set(cuentasCo.map(x => x.id));
      let saldo = 0;
      cuentasCo.forEach(x => { saldo += Number(x.saldo_inicial || 0); });
      (movsBanco || []).forEach(m => { if (idsCo.has(m.cuenta_id)) saldo += Number(m.monto || 0); });

      return {
        id: c.id, nombre: c.name, tipo: c.company_type,
        ingresos: ing, costos: cos + gas, utilidad: util, margen,
        cuentasActivas: cuentasCo.length, saldo,
      };
    }).sort((a, b) => b.ingresos - a.ingresos);
  }, [companies, movs, cuentas, movsBanco, moneda, desde, hasta]);

  // ── Por obra ──
  const porObra = uM(() => {
    return (obras || []).filter(o => o.estado === 'activo').map(o => {
      const parts = (partidas || []).filter(p => p.obra_id === o.id);
      const totalPres = parts.reduce((s, p) => s + Number(p.costo_total_presupuestado || 0), 0);
      const totalReal = parts.reduce((s, p) => s + Number(p.costo_real_acumulado || 0), 0);
      const partidasTotal = parts.length;
      const partidasTerm = parts.filter(p => p.estado === 'terminado' || Number(p.porcentaje_avance || 0) >= 100).length;
      let avancePond = 0;
      if (totalPres > 0) {
        const num = parts.reduce((s, p) => s + Number(p.porcentaje_avance || 0) * Number(p.costo_total_presupuestado || 0), 0);
        avancePond = num / totalPres;
      }
      const presupuesto = Number(o.presupuesto_total || 0) || totalPres;
      return {
        id: o.id, nombre: o.nombre_obra,
        presupuesto, costoReal: totalReal, avance: avancePond,
        partidasTotal, partidasTerm,
      };
    }).sort((a, b) => b.presupuesto - a.presupuesto);
  }, [obras, partidas]);

  // ── Alertas ──
  const alertas = uM(() => {
    const list = [];

    // 1. Pagos vencidos
    (pagos || []).filter(p => p.estado === 'vencido').forEach(p => {
      list.push({
        type: 'pago_vencido',
        icon: 'alertCircle', color: '#E74C3C',
        titulo: `Pago vencido — ${p.beneficiario || p.descripcion || 'Sin descripción'}`,
        sub: `${fmtCur(p.monto, p.moneda || 'PEN')} · vence ${p.fecha_vencimiento || '—'}`,
      });
    });

    // 2. OC no recibidas con fecha pasada
    (ordenes || []).filter(oc =>
      (oc.estado === 'enviada' || oc.estado === 'aceptada') &&
      oc.fecha_entrega && oc.fecha_entrega < today
    ).forEach(oc => {
      list.push({
        type: 'oc_atrasada',
        icon: 'package', color: '#F28C28',
        titulo: `OC atrasada — ${oc.numero_oc || oc.id?.slice(0, 8)}`,
        sub: `${oc.proveedor_nombre || oc.proveedor || '—'} · entrega ${oc.fecha_entrega} · ${oc.estado}`,
      });
    });

    // 3. IPERC importante / intolerable sin controlar
    (iperc || []).filter(i =>
      (i.clasificacion === 'importante' || i.clasificacion === 'intolerable') &&
      i.estado !== 'controlado' && i.estado !== 'cerrado'
    ).forEach(i => {
      list.push({
        type: 'iperc',
        icon: 'alert', color: i.clasificacion === 'intolerable' ? '#E74C3C' : '#F28C28',
        titulo: `IPERC ${i.clasificacion} — ${i.peligro || i.actividad || 'Riesgo'}`,
        sub: `Nivel ${i.nivel_riesgo || '—'} · estado ${i.estado || '—'}`,
      });
    });

    // 4. Stock: incluye agotado, sin_stock, crítico y reponer (en mínimo)
    (materiales || []).filter(m =>
      m.alerta === 'agotado' || m.alerta === 'sin_stock' ||
      m.alerta === 'critico' || m.alerta === 'reponer'
    ).forEach(m => {
      const esAgotado = m.alerta === 'agotado' || m.alerta === 'sin_stock';
      const esCritico = m.alerta === 'critico';
      list.push({
        type: 'stock',
        icon: 'package',
        color: esAgotado ? '#E74C3C' : esCritico ? '#E74C3C' : '#F2B705',
        titulo: `Stock ${esAgotado ? 'AGOTADO' : esCritico ? 'crítico' : 'en mínimo'} — ${m.nombre_material}`,
        sub: `${m.stock_actual ?? 0} ${m.unidad || ''} · mín ${m.stock_minimo ?? 0}`,
        prioridad: esAgotado ? 1 : esCritico ? 2 : 3, // para ordenar
      });
    });

    // 5. Valorizaciones presentadas/aprobadas sin facturar
    (valorizaciones || []).filter(v =>
      (v.estado === 'presentada' || v.estado === 'aprobada') &&
      !v.accounting_movement_id
    ).forEach(v => {
      list.push({
        type: 'val',
        icon: 'fileText', color: '#F2B705',
        titulo: `Valorización ${v.estado} sin facturar — N° ${v.numero || '—'}`,
        sub: `${fmtCur(v.monto_total, 'PEN')} · período ${v.periodo_anio || ''}/${v.periodo_mes || ''}`,
      });
    });

    // Ordenar: alertas con prioridad numérica primero (stock 1=agotado, 2=crítico, 3=mínimo);
    // las sin prioridad explícita van al final
    list.sort((a, b) => (a.prioridad || 99) - (b.prioridad || 99));
    return list;
  }, [pagos, ordenes, iperc, materiales, valorizaciones, today]);

  // Conteo rápido para banner: cuántos materiales en cada nivel de alerta
  const stockCounts = uM(() => {
    const c = { agotado: 0, critico: 0, reponer: 0 };
    (materiales || []).forEach(m => {
      if (m.alerta === 'agotado' || m.alerta === 'sin_stock') c.agotado++;
      else if (m.alerta === 'critico') c.critico++;
      else if (m.alerta === 'reponer') c.reponer++;
    });
    return c;
  }, [materiales]);

  return (
    <div className="page-wrap">
      {/* Header */}
      <div className="pg-hd frow-sb" style={{ marginBottom: 18 }}>
        <div>
          <div className="pg-title">Dashboard Ejecutivo</div>
          <div className="pg-sub">Vista global del grupo · {kpis.empresasActivas} empresas · {kpis.obrasActivas} obras activas</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="fi" type="date" value={desde} onChange={e => setDesde(e.target.value)} style={{ minWidth: 130 }} title="Desde" />
          <span style={{ color: 'var(--tm)', fontSize: 11 }}>→</span>
          <input className="fi" type="date" value={hasta} onChange={e => setHasta(e.target.value)} style={{ minWidth: 130 }} title="Hasta" />
          <select className="fi" value={moneda} onChange={e => setMoneda(e.target.value)} style={{ minWidth: 90 }}>
            <option value="PEN">S/ PEN</option>
            <option value="USD">USD</option>
          </select>
        </div>
      </div>

      {/* KPIs principales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 22 }}>
        <KpiCardEj label="Empresas activas" value={String(kpis.empresasActivas)} sub={`${kpis.empresasTotal} totales`} color="#3498DB" icon="building" />
        <KpiCardEj label="Obras activas" value={String(kpis.obrasActivas)} sub={`${kpis.obrasTotal} totales`} color="#F28C28" icon="hardHat" />
        <KpiCardEj label="Personal activo" value={String(kpis.personalActivo)} sub="Todas las obras" color="#2ECC71" icon="users" />
        <KpiCardEj label="Cash actual" value={fmtCurK(kpis.cashActual, moneda)} sub={`${kpis.cuentasActivasCount} cuentas activas`} color="#2ECC71" icon="dollar" accent />
        <KpiCardEj label="Por cobrar" value={fmtCurK(kpis.porCobrar, moneda)} sub="Pendiente de clientes" color="#3498DB" icon="arrowIn" />
        <KpiCardEj label="Por pagar" value={fmtCurK(kpis.porPagar, moneda)} sub="Pendiente a proveedores" color="#E74C3C" icon="arrowOut" />
        <KpiCardEj label="Ingresos del rango" value={fmtCurK(kpis.ingresosMes, moneda)} sub="Sin intercompany" color="var(--green)" icon="trendingUp" />
        <KpiCardEj label="Costos del rango" value={fmtCurK(kpis.costosMes + kpis.gastosMes, moneda)} sub="Sin intercompany" color="var(--red)" icon="trendingDown" />
        <KpiCardEj
          label="Utilidad del rango"
          value={fmtCurK(kpis.utilidadMes, moneda)}
          sub={`Margen ${kpis.margenMes.toFixed(1)}%`}
          color={kpis.utilidadMes >= 0 ? 'var(--blue)' : 'var(--red)'}
          icon="chart" accent
        />
      </div>

      {/* Por empresa */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10 }}>
          Por empresa
        </div>
        {porEmpresa.length === 0 ? (
          <div className="card card-p empty-state">Sin empresas activas</div>
        ) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr>
                  <th>Empresa</th>
                  <th style={{ textAlign: 'right' }}>Ingresos</th>
                  <th style={{ textAlign: 'right' }}>Costos</th>
                  <th style={{ textAlign: 'right' }}>Utilidad</th>
                  <th style={{ textAlign: 'right' }}>Margen</th>
                  <th style={{ textAlign: 'right' }}>Cuentas</th>
                  <th style={{ textAlign: 'right' }}>Saldo total</th>
                </tr></thead>
                <tbody>
                  {porEmpresa.map(r => (
                    <tr key={r.id}>
                      <td className="col-p"><strong>{r.nombre}</strong></td>
                      <td style={{ textAlign: 'right' }} className="col-num">{fmtCurK(r.ingresos, moneda)}</td>
                      <td style={{ textAlign: 'right' }} className="col-num">{fmtCurK(r.costos, moneda)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: r.utilidad >= 0 ? 'var(--green)' : 'var(--red)' }} className="col-num">{fmtCurK(r.utilidad, moneda)}</td>
                      <td style={{ textAlign: 'right', color: r.margen >= 0 ? 'var(--green)' : 'var(--red)' }} className="col-num">{r.margen.toFixed(1)}%</td>
                      <td style={{ textAlign: 'right' }} className="col-num">{r.cuentasActivas}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }} className="col-num">{fmtCurK(r.saldo, moneda)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Por obra */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10 }}>
          Por obra
        </div>
        {porObra.length === 0 ? (
          <div className="card card-p empty-state">Sin obras activas</div>
        ) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr>
                  <th>Obra</th>
                  <th style={{ textAlign: 'right' }}>Presupuesto</th>
                  <th style={{ textAlign: 'right' }}>Costo real</th>
                  <th style={{ textAlign: 'right' }}>% Presup. usado</th>
                  <th style={{ textAlign: 'right' }}>% Avance</th>
                  <th style={{ textAlign: 'right' }}>Partidas</th>
                </tr></thead>
                <tbody>
                  {porObra.map(o => {
                    const pctUsado = o.presupuesto > 0 ? (o.costoReal / o.presupuesto * 100) : 0;
                    const avanceColor = o.avance >= 80 ? 'var(--green)' : o.avance >= 50 ? 'var(--amber)' : 'var(--red)';
                    return (
                      <tr key={o.id}>
                        <td className="col-p"><strong>{o.nombre}</strong></td>
                        <td style={{ textAlign: 'right' }} className="col-num">{fmtCurK(o.presupuesto)}</td>
                        <td style={{ textAlign: 'right' }} className="col-num">{fmtCurK(o.costoReal)}</td>
                        <td style={{ textAlign: 'right', color: pctUsado > 100 ? 'var(--red)' : 'var(--ts)' }} className="col-num">{pctUsado.toFixed(1)}%</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: avanceColor }} className="col-num">{o.avance.toFixed(1)}%</td>
                        <td style={{ textAlign: 'right' }} className="col-num">{o.partidasTerm}/{o.partidasTotal}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Banner de stock — visible solo si hay agotados o críticos */}
      {(stockCounts.agotado > 0 || stockCounts.critico > 0 || stockCounts.reponer > 0) && (
        <div style={{ marginBottom: 18, padding: '14px 18px', borderRadius: 10,
          background: stockCounts.agotado > 0 ? 'rgba(231,76,60,0.12)' : 'rgba(242,183,5,0.10)',
          border: `1px solid ${stockCounts.agotado > 0 ? 'rgba(231,76,60,0.4)' : 'rgba(242,183,5,0.35)'}`,
          display:'flex', gap:14, alignItems:'center' }}>
          <JxIcon name="package" size={26} color={stockCounts.agotado > 0 ? '#E74C3C' : '#F2B705'}/>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:13, fontWeight:700, color:'var(--tp)' }}>
              {stockCounts.agotado > 0 ? '⚠ STOCK AGOTADO ' : 'Atención al stock'}
              {stockCounts.agotado > 0 && <span style={{ color:'var(--red)' }}> — {stockCounts.agotado} material{stockCounts.agotado > 1 ? 'es' : ''} sin stock</span>}
            </div>
            <div style={{ fontSize:11.5, color:'var(--tm)', marginTop:4, display:'flex', gap:14, flexWrap:'wrap' }}>
              {stockCounts.agotado > 0 && <span><strong style={{ color:'#E74C3C' }}>{stockCounts.agotado}</strong> agotados</span>}
              {stockCounts.critico > 0 && <span><strong style={{ color:'#E74C3C' }}>{stockCounts.critico}</strong> en estado crítico</span>}
              {stockCounts.reponer > 0 && <span><strong style={{ color:'#F2B705' }}>{stockCounts.reponer}</strong> en mínimo (reponer)</span>}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => { window.location.hash = '#/materiales'; }}>
            Ver materiales →
          </button>
        </div>
      )}

      {/* Alertas */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <JxIcon name="bell" size={13} color="var(--amber)" />
          Alertas que requieren atención
          <span className="tag" style={{ marginLeft: 4 }}>{alertas.length}</span>
        </div>
        {alertas.length === 0 ? (
          <div className="card card-p empty-state" style={{ padding: '24px 16px' }}>
            <JxIcon name="checkCircle" size={28} color="#2ECC71" />
            <p>Sin alertas activas · todo bajo control</p>
          </div>
        ) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            {alertas.slice(0, 50).map((a, i) => (
              <div key={i} style={{
                display: 'flex', gap: 12, padding: '12px 16px',
                borderBottom: i < Math.min(alertas.length, 50) - 1 ? '1px solid var(--border)' : 'none',
                alignItems: 'flex-start',
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8, background: a.color + '1a',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <JxIcon name={a.icon} size={14} color={a.color} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--tp)', fontWeight: 600 }}>{a.titulo}</div>
                  <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 2 }}>{a.sub}</div>
                </div>
              </div>
            ))}
            {alertas.length > 50 && (
              <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--tm)', textAlign: 'center', borderTop: '1px solid var(--border)' }}>
                Y {alertas.length - 50} alertas más…
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { DashboardEjecutivoPage });
