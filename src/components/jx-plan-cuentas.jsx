import React from "react";
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  PCGE_DEFAULT,
  PCGE_TIPO_LABEL,
  PCGE_TIPO_BADGE,
  PCGE_CUSTOM_KEY,
  loadCustomCuentas,
  saveCustomCuentas,
} from '../lib/pcge-default';

const { useState: uSP, useMemo: uMP, useEffect: uEP } = React;

// ─── Helpers ─────────────────────────────────────────────────
const fmtCurP = (n, currency = 'PEN') => {
  const symbol = currency === 'USD' ? 'USD ' : 'S/ ';
  return symbol + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtCurPK = (n, currency = 'PEN') => {
  const v = Number(n || 0);
  const symbol = currency === 'USD' ? 'USD ' : 'S/ ';
  if (Math.abs(v) >= 1e6) return symbol + (v / 1e6).toFixed(2) + 'M';
  if (Math.abs(v) >= 1e3) return symbol + (v / 1e3).toFixed(0) + 'K';
  return symbol + v.toFixed(0);
};

const MESES = [
  { v: 1,  label: 'Enero' },     { v: 2,  label: 'Febrero' },
  { v: 3,  label: 'Marzo' },     { v: 4,  label: 'Abril' },
  { v: 5,  label: 'Mayo' },      { v: 6,  label: 'Junio' },
  { v: 7,  label: 'Julio' },     { v: 8,  label: 'Agosto' },
  { v: 9,  label: 'Setiembre' }, { v: 10, label: 'Octubre' },
  { v: 11, label: 'Noviembre' }, { v: 12, label: 'Diciembre' },
];

const TIPOS_CUSTOM = [
  { v: 'activo',     label: 'Activo' },
  { v: 'pasivo',     label: 'Pasivo' },
  { v: 'patrimonio', label: 'Patrimonio' },
  { v: 'ingreso',    label: 'Ingreso' },
  { v: 'gasto',      label: 'Gasto' },
];

// ╔════════════════════════════════════════════════════════════╗
// ║  PLAN DE CUENTAS PCGE                                      ║
// ╚════════════════════════════════════════════════════════════╝
function PlanCuentasPage({ showToast }) {
  // El "catálogo cargado" se controla por flag en localStorage para permitir
  // mostrar el botón "Cargar PCGE default" si está vacío.
  const FLAG_KEY = 'jarvex_plan_cuentas_loaded';
  const [loaded, setLoaded] = uSP(() => {
    try { return localStorage.getItem(FLAG_KEY) === '1'; } catch { return false; }
  });
  const [custom, setCustom] = uSP(() => loadCustomCuentas());
  const [tipoFiltro, setTipoFiltro] = uSP('todos');
  const [busqueda, setBusqueda] = uSP('');
  const [modal, setModal] = uSP(null); // null | 'nueva'
  const [form, setForm] = uSP({ codigo: '', nombre: '', tipo: 'activo', clase: 1, padre: '' });

  const cargarDefault = () => {
    try { localStorage.setItem(FLAG_KEY, '1'); } catch {}
    setLoaded(true);
    showToast?.(`Plan PCGE cargado: ${PCGE_DEFAULT.length} cuentas`, 'green');
  };

  const limpiarTodo = () => {
    if (!confirm('¿Vaciar plan de cuentas? Se quitará el catálogo default y las cuentas custom.')) return;
    try { localStorage.removeItem(FLAG_KEY); } catch {}
    saveCustomCuentas([]);
    setCustom([]);
    setLoaded(false);
    showToast?.('Plan de cuentas vaciado', 'amber');
  };

  const abrirNueva = () => {
    setForm({ codigo: '', nombre: '', tipo: 'activo', clase: 1, padre: '' });
    setModal('nueva');
  };

  const guardarCustom = () => {
    const codigo = (form.codigo || '').trim();
    const nombre = (form.nombre || '').trim();
    if (!codigo) { showToast?.('Código requerido', 'red'); return; }
    if (!nombre) { showToast?.('Nombre requerido', 'red'); return; }
    const todos = [...(loaded ? PCGE_DEFAULT : []), ...custom];
    if (todos.some(c => c.codigo === codigo)) {
      showToast?.(`El código ${codigo} ya existe`, 'red'); return;
    }
    const nueva = {
      codigo,
      nombre,
      tipo: form.tipo,
      clase: Number(form.clase) || 1,
      padre: form.padre?.trim() || null,
      _custom: true,
    };
    const next = [...custom, nueva];
    setCustom(next);
    saveCustomCuentas(next);
    setModal(null);
    showToast?.(`Cuenta ${codigo} agregada`, 'green');
  };

  const eliminarCustom = (codigo) => {
    if (!confirm(`¿Eliminar cuenta custom ${codigo}?`)) return;
    const next = custom.filter(c => c.codigo !== codigo);
    setCustom(next);
    saveCustomCuentas(next);
    showToast?.(`Cuenta ${codigo} eliminada`, 'amber');
  };

  // Lista jerárquica: padres primero (alfabéticamente por código), luego sus hijos.
  const jerarquia = uMP(() => {
    const todos = [...(loaded ? PCGE_DEFAULT : []), ...custom];
    const padres = todos.filter(c => !c.padre).sort((a,b) => a.codigo.localeCompare(b.codigo));
    const hijosPorPadre = new Map();
    todos.filter(c => c.padre).forEach(c => {
      const arr = hijosPorPadre.get(c.padre) || [];
      arr.push(c);
      hijosPorPadre.set(c.padre, arr);
    });
    const out = [];
    padres.forEach(p => {
      out.push({ ...p, _level: 0 });
      (hijosPorPadre.get(p.codigo) || [])
        .sort((a,b) => a.codigo.localeCompare(b.codigo))
        .forEach(h => out.push({ ...h, _level: 1 }));
    });
    return out;
  }, [loaded, custom]);

  const filtrado = uMP(() => {
    let arr = jerarquia;
    if (tipoFiltro !== 'todos') arr = arr.filter(c => c.tipo === tipoFiltro);
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase();
      arr = arr.filter(c =>
        c.codigo.toLowerCase().includes(q) ||
        c.nombre.toLowerCase().includes(q)
      );
    }
    return arr;
  }, [jerarquia, tipoFiltro, busqueda]);

  const totalCuentas = (loaded ? PCGE_DEFAULT.length : 0) + custom.length;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Plan de Cuentas PCGE</div>
          <div className="pg-sub">
            {totalCuentas} cuentas · {loaded ? 'PCGE default cargado' : 'sin catálogo default'} · {custom.length} custom
          </div>
        </div>
        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
          {!loaded && (
            <button className="btn btn-amber btn-sm" onClick={cargarDefault}>
              <JxIcon name="download" size={13}/>Cargar PCGE default
            </button>
          )}
          <button className="btn btn-amber btn-sm" onClick={abrirNueva}>
            <JxIcon name="plus" size={13}/>Cuenta custom
          </button>
          {(loaded || custom.length > 0) && (
            <button className="btn btn-ghost btn-sm" onClick={limpiarTodo} title="Vaciar plan">
              <JxIcon name="trash" size={13}/>
            </button>
          )}
        </div>
      </div>

      {totalCuentas === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="book" size={40} color="var(--tm)"/>
          <p>No hay plan de cuentas cargado todavía. Pulsa <strong>Cargar PCGE default</strong> para iniciar con el catálogo estándar peruano (clases 1 a 7) o crea cuentas custom.</p>
        </div>
      ) : (
        <>
          <div className="frow-sb" style={{ gap:8, marginBottom:10, flexWrap:'wrap' }}>
            <div className="search-bar" style={{ flex:'1 1 220px' }}>
              <JxIcon name="search" size={14} color="var(--tm)"/>
              <input
                placeholder="Buscar código o nombre…"
                value={busqueda}
                onChange={e=>setBusqueda(e.target.value)}
              />
            </div>
            <select
              className="fi"
              value={tipoFiltro}
              onChange={e=>setTipoFiltro(e.target.value)}
              style={{ minWidth:160 }}>
              <option value="todos">Todos los tipos</option>
              {TIPOS_CUSTOM.map(t => (
                <option key={t.v} value={t.v}>{t.label}</option>
              ))}
            </select>
          </div>

          <div className="card" style={{ overflow:'hidden' }}>
            <div style={{ overflowX:'auto' }}>
              <table className="tbl">
                <thead><tr>
                  <th style={{ width:120 }}>Código</th>
                  <th>Nombre</th>
                  <th style={{ width:130 }}>Tipo</th>
                  <th style={{ width:80, textAlign:'center' }}>Clase</th>
                  <th style={{ width:100, textAlign:'center' }}>Origen</th>
                  <th style={{ width:80, textAlign:'center' }}>Acciones</th>
                </tr></thead>
                <tbody>
                  {filtrado.map(c => (
                    <tr key={c.codigo}>
                      <td className="col-m" style={{ fontWeight: c._level === 0 ? 700 : 500, paddingLeft: c._level === 1 ? 24 : undefined }}>
                        {c._level === 1 ? '↳ ' : ''}{c.codigo}
                      </td>
                      <td className="col-p" style={{ fontWeight: c._level === 0 ? 600 : 400 }}>
                        {c.nombre}
                      </td>
                      <td>
                        <span className={`badge ${PCGE_TIPO_BADGE[c.tipo] || 'b-gray'}`}>
                          {PCGE_TIPO_LABEL[c.tipo] || c.tipo}
                        </span>
                      </td>
                      <td style={{ textAlign:'center' }}>{c.clase}</td>
                      <td style={{ textAlign:'center' }}>
                        {c._custom
                          ? <span className="tag" style={{ background:'rgba(255,179,0,0.15)' }}>Custom</span>
                          : <span className="tag">PCGE</span>}
                      </td>
                      <td style={{ textAlign:'center' }}>
                        {c._custom && (
                          <button
                            className="btn btn-ghost btn-xs"
                            title="Eliminar cuenta custom"
                            onClick={()=>eliminarCustom(c.codigo)}>
                            <JxIcon name="trash" size={11}/>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filtrado.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign:'center', color:'var(--tm)', padding:18 }}>
                      Sin resultados con los filtros actuales.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Modal nueva cuenta custom */}
      {modal === 'nueva' && (
        <div className="modal-bg" onClick={()=>setModal(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{ maxWidth:520 }}>
            <div className="modal-hd">
              <div className="modal-title">Nueva cuenta custom</div>
              <button className="btn btn-ghost btn-xs" onClick={()=>setModal(null)}>
                <JxIcon name="x" size={13}/>
              </button>
            </div>
            <div className="modal-bd" style={{ display:'grid', gap:10 }}>
              <label className="fl">
                <span>Código *</span>
                <input
                  className="fi"
                  value={form.codigo}
                  onChange={e=>setForm({ ...form, codigo: e.target.value })}
                  placeholder="Ej. 1041"/>
              </label>
              <label className="fl">
                <span>Nombre *</span>
                <input
                  className="fi"
                  value={form.nombre}
                  onChange={e=>setForm({ ...form, nombre: e.target.value })}
                  placeholder="Ej. Banco Crédito - Cuenta operativa"/>
              </label>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                <label className="fl">
                  <span>Tipo</span>
                  <select
                    className="fi"
                    value={form.tipo}
                    onChange={e=>setForm({ ...form, tipo: e.target.value })}>
                    {TIPOS_CUSTOM.map(t => (
                      <option key={t.v} value={t.v}>{t.label}</option>
                    ))}
                  </select>
                </label>
                <label className="fl">
                  <span>Clase</span>
                  <select
                    className="fi"
                    value={form.clase}
                    onChange={e=>setForm({ ...form, clase: Number(e.target.value) })}>
                    {[1,2,3,4,5,6,7].map(n => (
                      <option key={n} value={n}>Clase {n}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="fl">
                <span>Cuenta padre (opcional)</span>
                <input
                  className="fi"
                  value={form.padre}
                  onChange={e=>setForm({ ...form, padre: e.target.value })}
                  placeholder="Ej. 10 (deja vacío si es de primer nivel)"/>
              </label>
            </div>
            <div className="modal-ft">
              <button className="btn btn-ghost btn-sm" onClick={()=>setModal(null)}>Cancelar</button>
              <button className="btn btn-amber btn-sm" onClick={guardarCustom}>
                <JxIcon name="check" size={13}/>Guardar cuenta
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ╔════════════════════════════════════════════════════════════╗
// ║  BALANCE GENERAL                                           ║
// ╚════════════════════════════════════════════════════════════╝
function BalanceGeneralPage({ showToast }) {
  const { data: companies } = window.__hooks.useCompanies();
  const { data: movs }      = window.__hooks.useAccountingMovements();
  const { data: pagos }     = window.__hooks.useCronogramaPagos();

  const [companyId, setCompanyId] = uSP('todas');
  const [moneda, setMoneda] = uSP('PEN');

  const data = uMP(() => {
    // ── Activo: ingresos cobrados - costos pagados (simplificación) ──
    const ms = (movs || []).filter(m =>
      m.currency === moneda &&
      m.payment_status !== 'cancelled' &&
      (companyId === 'todas' || m.company_id === companyId)
    );

    let ingresosCobrados = 0;
    let costosPagados    = 0;
    let gastosPagados    = 0;
    let cxc              = 0; // cuentas por cobrar (income pendiente)
    let cxp              = 0; // cuentas por pagar (cost/expense pendiente)

    ms.forEach(m => {
      const a = Number(m.amount || 0);
      const isPaid = m.payment_status === 'paid';
      if (m.type === 'income') {
        if (isPaid) ingresosCobrados += a; else cxc += a;
      } else if (m.type === 'cost') {
        if (isPaid) costosPagados += a; else cxp += a;
      } else if (m.type === 'expense') {
        if (isPaid) gastosPagados += a; else cxp += a;
      }
    });

    // efectivo se clampa en 0 si es negativo; el déficit va al pasivo
    const efectivoBruto = ingresosCobrados - costosPagados - gastosPagados;
    const efectivo = Math.max(0, efectivoBruto);
    const deficitFinanciamiento = efectivoBruto < 0 ? -efectivoBruto : 0;

    // ── Pasivo: cronograma de pagos pendientes ──
    const pagosPendientes = (pagos || []).filter(p =>
      (p.estado === 'programado' || p.estado === 'vencido') &&
      (companyId === 'todas' || p.company_id === companyId || !p.company_id)
    );
    const pasivoCronograma = pagosPendientes.reduce((s, p) => s + Number(p.monto || 0), 0);

    // Activo total = efectivo + cuentas por cobrar
    const activoTotal = efectivo + cxc;
    // Pasivo total = cuentas por pagar (movs) + cronograma pendiente + déficit
    const pasivoTotal = cxp + pasivoCronograma + deficitFinanciamiento;
    // Patrimonio = Activo - Pasivo (cuadra por construcción)
    const patrimonio  = activoTotal - pasivoTotal;

    return {
      efectivo, cxc, cxp, deficitFinanciamiento,
      ingresosCobrados, costosPagados, gastosPagados,
      pasivoCronograma,
      activoTotal, pasivoTotal, patrimonio,
      pasivoMasPatrimonio: pasivoTotal + patrimonio,
      cuadra: Math.abs(activoTotal - (pasivoTotal + patrimonio)) < 0.01,
      countMovs: ms.length,
      countPagos: pagosPendientes.length,
    };
  }, [movs, pagos, companyId, moneda]);

  const empresaSel = (companies || []).find(c => c.id === companyId);
  const tituloEmpresa = companyId === 'todas' ? 'Grupo consolidado' : (empresaSel?.name || '—');

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Balance General</div>
          <div className="pg-sub">
            {tituloEmpresa} · {data.countMovs} movimientos · {data.countPagos} pagos pendientes ({moneda})
          </div>
        </div>
        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
          <select
            className="fi"
            value={companyId}
            onChange={e=>setCompanyId(e.target.value)}
            style={{ minWidth:180 }}>
            <option value="todas">Todas las empresas</option>
            {(companies || []).filter(c=>c.status==='activa').map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select
            className="fi"
            value={moneda}
            onChange={e=>setMoneda(e.target.value)}
            style={{ minWidth:100 }}>
            <option value="PEN">S/ (PEN)</option>
            <option value="USD">USD</option>
          </select>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:12, marginBottom:18 }}>
        <div className="card card-p" style={{ borderLeft:'3px solid var(--green)' }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Activo total</div>
          <div style={{ fontSize:22, fontWeight:800, color:'var(--green)', marginTop:4 }}>{fmtCurP(data.activoTotal, moneda)}</div>
        </div>
        <div className="card card-p" style={{ borderLeft:'3px solid var(--red)' }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Pasivo total</div>
          <div style={{ fontSize:22, fontWeight:800, color:'var(--red)', marginTop:4 }}>{fmtCurP(data.pasivoTotal, moneda)}</div>
        </div>
        <div className="card card-p" style={{ borderLeft:`3px solid ${data.patrimonio>=0?'var(--blue)':'var(--red)'}` }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Patrimonio</div>
          <div style={{ fontSize:22, fontWeight:800, color: data.patrimonio>=0?'var(--blue)':'var(--red)', marginTop:4 }}>{fmtCurP(data.patrimonio, moneda)}</div>
        </div>
        <div className="card card-p" style={{ borderLeft:`3px solid ${data.cuadra?'var(--green)':'var(--amber)'}` }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Pasivo + Patrimonio</div>
          <div style={{ fontSize:22, fontWeight:800, marginTop:4 }}>{fmtCurP(data.pasivoMasPatrimonio, moneda)}</div>
          <div style={{ fontSize:10.5, marginTop:4, color: data.cuadra?'var(--green)':'var(--amber)' }}>
            {data.cuadra ? '✓ cuadra con activo' : 'no cuadra (revisar)'}
          </div>
        </div>
      </div>

      {/* Tabla detalle */}
      <div className="card" style={{ overflow:'hidden' }}>
        <div style={{ overflowX:'auto' }}>
          <table className="tbl">
            <thead><tr>
              <th style={{ width:120 }}>Tipo</th>
              <th>Cuenta principal (PCGE)</th>
              <th style={{ width:160, textAlign:'right' }}>Saldo</th>
            </tr></thead>
            <tbody>
              {/* Activo */}
              <tr style={{ background:'rgba(46,204,113,0.06)' }}>
                <td colSpan={3} style={{ fontWeight:700, color:'var(--green)' }}>ACTIVO</td>
              </tr>
              <tr>
                <td><span className="badge b-green">Activo</span></td>
                <td><strong>10</strong> Efectivo y equivalentes (ingresos cobrados − pagos)</td>
                <td style={{ textAlign:'right' }} className="col-num">{fmtCurP(data.efectivo, moneda)}</td>
              </tr>
              <tr>
                <td><span className="badge b-green">Activo</span></td>
                <td><strong>12</strong> Cuentas por cobrar comerciales</td>
                <td style={{ textAlign:'right' }} className="col-num">{fmtCurP(data.cxc, moneda)}</td>
              </tr>
              <tr style={{ fontWeight:700 }}>
                <td>—</td>
                <td>Total Activo</td>
                <td style={{ textAlign:'right', color:'var(--green)' }} className="col-num">{fmtCurP(data.activoTotal, moneda)}</td>
              </tr>

              {/* Pasivo */}
              <tr style={{ background:'rgba(231,76,60,0.06)' }}>
                <td colSpan={3} style={{ fontWeight:700, color:'var(--red)' }}>PASIVO</td>
              </tr>
              <tr>
                <td><span className="badge b-red">Pasivo</span></td>
                <td><strong>42</strong> Cuentas por pagar comerciales (movs pendientes)</td>
                <td style={{ textAlign:'right' }} className="col-num">{fmtCurP(data.cxp, moneda)}</td>
              </tr>
              <tr>
                <td><span className="badge b-red">Pasivo</span></td>
                <td><strong>46</strong> Cuentas por pagar diversas (cronograma)</td>
                <td style={{ textAlign:'right' }} className="col-num">{fmtCurP(data.pasivoCronograma, moneda)}</td>
              </tr>
              {data.deficitFinanciamiento > 0 && (
                <tr>
                  <td><span className="badge b-red">Pasivo</span></td>
                  <td><strong>45</strong> Déficit de financiamiento (efectivo neg.)</td>
                  <td style={{ textAlign:'right' }} className="col-num">{fmtCurP(data.deficitFinanciamiento, moneda)}</td>
                </tr>
              )}
              <tr style={{ fontWeight:700 }}>
                <td>—</td>
                <td>Total Pasivo</td>
                <td style={{ textAlign:'right', color:'var(--red)' }} className="col-num">{fmtCurP(data.pasivoTotal, moneda)}</td>
              </tr>

              {/* Patrimonio */}
              <tr style={{ background:'rgba(74,144,226,0.06)' }}>
                <td colSpan={3} style={{ fontWeight:700, color:'var(--blue)' }}>PATRIMONIO</td>
              </tr>
              <tr>
                <td><span className="badge b-blue">Patrimonio</span></td>
                <td><strong>59</strong> Resultados acumulados (Activo − Pasivo)</td>
                <td style={{ textAlign:'right' }} className="col-num">{fmtCurP(data.patrimonio, moneda)}</td>
              </tr>
              <tr style={{ fontWeight:700 }}>
                <td>—</td>
                <td>Total Pasivo + Patrimonio</td>
                <td style={{ textAlign:'right', color: data.cuadra?'var(--green)':'var(--amber)' }} className="col-num">
                  {fmtCurP(data.pasivoMasPatrimonio, moneda)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ fontSize:11, color:'var(--tm)', marginTop:10 }}>
        Simplificación: Activo = ingresos cobrados − costos/gastos pagados + cuentas por cobrar pendientes.
        Pasivo = movimientos pendientes + cronograma de pagos no liquidados. Patrimonio se calcula como cuadre.
      </div>
    </div>
  );
}

// ╔════════════════════════════════════════════════════════════╗
// ║  ESTADO DE RESULTADOS (P&L)                                ║
// ╚════════════════════════════════════════════════════════════╝
function EstadoResultadosPage({ showToast }) {
  const { data: companies } = window.__hooks.useCompanies();
  const { data: movs }      = window.__hooks.useAccountingMovements();

  const hoy = new Date();
  const [companyId, setCompanyId] = uSP('todas');
  const [moneda, setMoneda]       = uSP('PEN');
  const [anio, setAnio]           = uSP(hoy.getFullYear());
  const [mes, setMes]             = uSP(0); // 0 = todo el año

  const TASA_IR = 0.295; // IR estimado 29.5%

  const data = uMP(() => {
    const ms = (movs || []).filter(m => {
      if (m.currency !== moneda) return false;
      if (m.payment_status === 'cancelled') return false;
      if (companyId !== 'todas' && m.company_id !== companyId) return false;
      const fecha = m.fecha || m.date || m.created_at || '';
      if (!fecha) return false;
      const d = new Date(fecha);
      if (isNaN(d.getTime())) return false;
      if (d.getFullYear() !== Number(anio)) return false;
      if (mes !== 0 && (d.getMonth() + 1) !== Number(mes)) return false;
      return true;
    });

    let ingresos = 0, costos = 0, gastos = 0;
    ms.forEach(m => {
      const a = Number(m.amount || 0);
      if (m.type === 'income')  ingresos += a;
      if (m.type === 'cost')    costos   += a;
      if (m.type === 'expense') gastos   += a;
    });

    const utilidadBruta    = ingresos - costos;
    const utilidadOperativa = utilidadBruta - gastos;
    const ir               = utilidadOperativa > 0 ? utilidadOperativa * TASA_IR : 0;
    const utilidadNeta     = utilidadOperativa - ir;
    const margenBruto      = ingresos > 0 ? (utilidadBruta / ingresos) * 100 : 0;
    const margenOperativo  = ingresos > 0 ? (utilidadOperativa / ingresos) * 100 : 0;
    const margenNeto       = ingresos > 0 ? (utilidadNeta / ingresos) * 100 : 0;

    return {
      ingresos, costos, gastos,
      utilidadBruta, utilidadOperativa, ir, utilidadNeta,
      margenBruto, margenOperativo, margenNeto,
      countMovs: ms.length,
    };
  }, [movs, companyId, moneda, anio, mes]);

  const empresaSel = (companies || []).find(c => c.id === companyId);
  const tituloEmpresa = companyId === 'todas' ? 'Grupo consolidado' : (empresaSel?.name || '—');
  const periodoLabel = mes === 0
    ? `Año ${anio}`
    : `${MESES.find(m=>m.v===Number(mes))?.label} ${anio}`;

  const exportarPDF = () => {
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const W = doc.internal.pageSize.getWidth();

      doc.setFontSize(16); doc.setFont('helvetica', 'bold');
      doc.text('Estado de Resultados', W/2, 18, { align: 'center' });
      doc.setFontSize(11); doc.setFont('helvetica', 'normal');
      doc.text(`${tituloEmpresa} — ${periodoLabel} (${moneda})`, W/2, 25, { align: 'center' });

      const filas = [
        ['Ingresos',                    fmtCurP(data.ingresos, moneda)],
        ['(−) Costos directos',         fmtCurP(data.costos, moneda)],
        ['Utilidad bruta',              fmtCurP(data.utilidadBruta, moneda)],
        [`Margen bruto`,                `${data.margenBruto.toFixed(1)}%`],
        ['(−) Gastos operativos',       fmtCurP(data.gastos, moneda)],
        ['Utilidad operativa',          fmtCurP(data.utilidadOperativa, moneda)],
        [`Margen operativo`,            `${data.margenOperativo.toFixed(1)}%`],
        [`(−) IR estimado (${(TASA_IR*100).toFixed(1)}%)`, fmtCurP(data.ir, moneda)],
        ['Utilidad neta',               fmtCurP(data.utilidadNeta, moneda)],
        [`Margen neto`,                 `${data.margenNeto.toFixed(1)}%`],
      ];

      autoTable(doc, {
        startY: 32,
        head: [['Concepto', 'Importe']],
        body: filas,
        styles: { fontSize: 10 },
        headStyles: { fillColor: [255, 179, 0], textColor: 0 },
        columnStyles: {
          0: { cellWidth: 110 },
          1: { cellWidth: 60, halign: 'right' },
        },
      });

      doc.setFontSize(9); doc.setTextColor(120);
      doc.text(`Generado por JARVEX — ${new Date().toLocaleString('es-PE')}`, W/2, doc.internal.pageSize.getHeight() - 10, { align: 'center' });

      const safeName = tituloEmpresa.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
      doc.save(`estado_resultados_${safeName}_${anio}${mes === 0 ? '' : '_' + String(mes).padStart(2,'0')}.pdf`);
      showToast?.('PDF generado', 'green');
    } catch (e) {
      showToast?.('Error generando PDF: ' + (e.message || e), 'red');
    }
  };

  const aniosDisponibles = uMP(() => {
    const set = new Set();
    set.add(hoy.getFullYear());
    (movs || []).forEach(m => {
      const f = m.fecha || m.date || m.created_at;
      if (!f) return;
      const d = new Date(f);
      if (!isNaN(d.getTime())) set.add(d.getFullYear());
    });
    return [...set].sort((a,b) => b - a);
  }, [movs]);

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Estado de Resultados</div>
          <div className="pg-sub">
            {tituloEmpresa} · {periodoLabel} · {data.countMovs} movimientos ({moneda})
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
            value={anio}
            onChange={e=>setAnio(Number(e.target.value))}
            style={{ minWidth:100 }}>
            {aniosDisponibles.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select
            className="fi"
            value={mes}
            onChange={e=>setMes(Number(e.target.value))}
            style={{ minWidth:130 }}>
            <option value={0}>Todo el año</option>
            {MESES.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
          </select>
          <select
            className="fi"
            value={moneda}
            onChange={e=>setMoneda(e.target.value)}
            style={{ minWidth:100 }}>
            <option value="PEN">S/ (PEN)</option>
            <option value="USD">USD</option>
          </select>
          <button className="btn btn-ghost btn-sm" onClick={exportarPDF}>
            <JxIcon name="download" size={13}/>Exportar PDF
          </button>
        </div>
      </div>

      {/* Cards visuales con números grandes */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:12, marginBottom:18 }}>
        <div className="card card-p" style={{ borderLeft:'3px solid var(--green)' }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Ingresos</div>
          <div style={{ fontSize:24, fontWeight:800, color:'var(--green)', marginTop:4 }}>{fmtCurP(data.ingresos, moneda)}</div>
        </div>
        <div className="card card-p" style={{ borderLeft:'3px solid var(--red)' }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Costos directos</div>
          <div style={{ fontSize:24, fontWeight:800, color:'var(--red)', marginTop:4 }}>{fmtCurP(data.costos, moneda)}</div>
        </div>
        <div className="card card-p" style={{ borderLeft:`3px solid ${data.utilidadBruta>=0?'var(--blue)':'var(--red)'}` }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Utilidad bruta</div>
          <div style={{ fontSize:24, fontWeight:800, color: data.utilidadBruta>=0?'var(--blue)':'var(--red)', marginTop:4 }}>{fmtCurP(data.utilidadBruta, moneda)}</div>
          <div style={{ fontSize:11, color:'var(--tm)', marginTop:2 }}>Margen {data.margenBruto.toFixed(1)}%</div>
        </div>
        <div className="card card-p" style={{ borderLeft:'3px solid var(--amber)' }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Gastos operativos</div>
          <div style={{ fontSize:24, fontWeight:800, color:'var(--amber)', marginTop:4 }}>{fmtCurP(data.gastos, moneda)}</div>
        </div>
        <div className="card card-p" style={{ borderLeft:`3px solid ${data.utilidadOperativa>=0?'var(--blue)':'var(--red)'}` }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Utilidad operativa</div>
          <div style={{ fontSize:24, fontWeight:800, color: data.utilidadOperativa>=0?'var(--blue)':'var(--red)', marginTop:4 }}>{fmtCurP(data.utilidadOperativa, moneda)}</div>
          <div style={{ fontSize:11, color:'var(--tm)', marginTop:2 }}>Margen {data.margenOperativo.toFixed(1)}%</div>
        </div>
        <div className="card card-p" style={{ borderLeft:'3px solid var(--ts)' }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>IR estimado (29.5%)</div>
          <div style={{ fontSize:24, fontWeight:800, marginTop:4 }}>{fmtCurP(data.ir, moneda)}</div>
        </div>
        <div className="card card-p" style={{ borderLeft:`3px solid ${data.utilidadNeta>=0?'var(--green)':'var(--red)'}`, background: data.utilidadNeta>=0?'rgba(46,204,113,0.05)':'rgba(231,76,60,0.05)' }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Utilidad neta</div>
          <div style={{ fontSize:28, fontWeight:800, color: data.utilidadNeta>=0?'var(--green)':'var(--red)', marginTop:4 }}>{fmtCurP(data.utilidadNeta, moneda)}</div>
          <div style={{ fontSize:11, color:'var(--tm)', marginTop:2 }}>Margen {data.margenNeto.toFixed(1)}%</div>
        </div>
      </div>

      {/* Tabla detalle */}
      <div className="card" style={{ overflow:'hidden' }}>
        <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--bd)', fontWeight:700, fontSize:13 }}>
          Detalle del periodo
        </div>
        <div style={{ overflowX:'auto' }}>
          <table className="tbl">
            <thead><tr>
              <th>Concepto</th>
              <th style={{ width:160, textAlign:'right' }}>Importe</th>
              <th style={{ width:100, textAlign:'right' }}>Margen</th>
            </tr></thead>
            <tbody>
              <tr>
                <td>Ingresos (cuenta 70 — Ventas / Servicios)</td>
                <td style={{ textAlign:'right', color:'var(--green)' }} className="col-num">{fmtCurP(data.ingresos, moneda)}</td>
                <td style={{ textAlign:'right' }}>100.0%</td>
              </tr>
              <tr>
                <td>(−) Costos directos (cuenta 60 — Compras)</td>
                <td style={{ textAlign:'right', color:'var(--red)' }} className="col-num">{fmtCurP(data.costos, moneda)}</td>
                <td style={{ textAlign:'right' }}>{data.ingresos > 0 ? `${(data.costos/data.ingresos*100).toFixed(1)}%` : '—'}</td>
              </tr>
              <tr style={{ fontWeight:700, background:'rgba(74,144,226,0.05)' }}>
                <td>Utilidad bruta</td>
                <td style={{ textAlign:'right', color: data.utilidadBruta>=0?'var(--blue)':'var(--red)' }} className="col-num">{fmtCurP(data.utilidadBruta, moneda)}</td>
                <td style={{ textAlign:'right' }}>{data.margenBruto.toFixed(1)}%</td>
              </tr>
              <tr>
                <td>(−) Gastos operativos (cuentas 62, 63, 65)</td>
                <td style={{ textAlign:'right', color:'var(--amber)' }} className="col-num">{fmtCurP(data.gastos, moneda)}</td>
                <td style={{ textAlign:'right' }}>{data.ingresos > 0 ? `${(data.gastos/data.ingresos*100).toFixed(1)}%` : '—'}</td>
              </tr>
              <tr style={{ fontWeight:700, background:'rgba(74,144,226,0.05)' }}>
                <td>Utilidad operativa</td>
                <td style={{ textAlign:'right', color: data.utilidadOperativa>=0?'var(--blue)':'var(--red)' }} className="col-num">{fmtCurP(data.utilidadOperativa, moneda)}</td>
                <td style={{ textAlign:'right' }}>{data.margenOperativo.toFixed(1)}%</td>
              </tr>
              <tr>
                <td>(−) Impuesto a la renta estimado (29.5%)</td>
                <td style={{ textAlign:'right' }} className="col-num">{fmtCurP(data.ir, moneda)}</td>
                <td style={{ textAlign:'right' }}>—</td>
              </tr>
              <tr style={{ fontWeight:800, background: data.utilidadNeta>=0?'rgba(46,204,113,0.08)':'rgba(231,76,60,0.08)' }}>
                <td>Utilidad neta</td>
                <td style={{ textAlign:'right', color: data.utilidadNeta>=0?'var(--green)':'var(--red)' }} className="col-num">{fmtCurP(data.utilidadNeta, moneda)}</td>
                <td style={{ textAlign:'right' }}>{data.margenNeto.toFixed(1)}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ fontSize:11, color:'var(--tm)', marginTop:10 }}>
        Cálculo simplificado sobre los movimientos contables del periodo. El IR es una estimación
        gerencial al {(TASA_IR*100).toFixed(1)}% sobre la utilidad operativa positiva — no reemplaza la liquidación oficial SUNAT.
      </div>
    </div>
  );
}

// ╔════════════════════════════════════════════════════════════╗
// ║  REGISTRO GLOBAL                                           ║
// ╚════════════════════════════════════════════════════════════╝
Object.assign(window, {
  PlanCuentasPage,
  BalanceGeneralPage,
  EstadoResultadosPage,
});
