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
import { filtroInicialEmpresa } from "../lib/empresa-activa.js";
import { useEmpresaBloqueada } from "../hooks/useEmpresaActiva.js";
import { calcularBalance, lineasDeBalance } from "../lib/balance-general.js";

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
        <div className="overlay" onClick={()=>setModal(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{ maxWidth:520 }}>
            <div className="modal-hd">
              <div className="modal-hd-left">Nueva cuenta custom</div>
              <button className="btn btn-ghost btn-xs" onClick={()=>setModal(null)}>
                <JxIcon name="x" size={13}/>
              </button>
            </div>
            <div style={{ display:'grid', gap:10 }}>
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
            <div className="modal-actions">
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
  // El registro 7.1 completo (todas las empresas, todos los ejercicios): la lib
  // se queda con el último de cada empresa. Sin esto el activo del balance
  // ignoraba las máquinas de la empresa — ver el encabezado de balance-general.js.
  const { data: activosFijos } = window.__hooks.useActivosFijos();

  const [companyIdRaw, setCompanyId] = uSP(() => filtroInicialEmpresa('todas'));
  // ÁMBITO, no filtro: con una empresa activa este es SU balance / SU estado
  // de resultados, y el selector va clavado.
  const empresaFija = useEmpresaBloqueada();
  const companyId = empresaFija || companyIdRaw;
  const [moneda, setMoneda] = uSP('PEN');
  // Qué línea está abierta. UNA a la vez: el desglose de «efectivo» son tres
  // tablas y dos abiertas al mismo tiempo no entran en la pantalla.
  const [abierta, setAbierta] = uSP(null);

  const data = uMP(
    () => calcularBalance({ movs: movs || [], pagos: pagos || [], activos: activosFijos || [], companyId, moneda }),
    [movs, pagos, activosFijos, companyId, moneda]
  );
  const lineas = uMP(() => lineasDeBalance(data), [data]);

  const empresaSel = (companies || []).find(c => c.id === companyId);
  const tituloEmpresa = companyId === 'todas' ? 'Grupo consolidado' : (empresaSel?.name || '—');
  const nombreEmpresa = (id) => (companies || []).find(c => c.id === id)?.name || '—';

  const BADGE = { activo: 'b-green', pasivo: 'b-red', patrimonio: 'b-blue' };
  const SECCION = {
    activo:     { label: 'ACTIVO',     color: 'var(--green)', fondo: 'rgba(46,204,113,0.06)' },
    pasivo:     { label: 'PASIVO',     color: 'var(--red)',   fondo: 'rgba(231,76,60,0.06)' },
    patrimonio: { label: 'PATRIMONIO', color: 'var(--blue)',  fondo: 'rgba(74,144,226,0.06)' },
  };
  const TOTAL_DE = {
    activo: { label: 'Total Activo', monto: data.activoTotal, color: 'var(--green)' },
    pasivo: { label: 'Total Pasivo', monto: data.pasivoTotal, color: 'var(--red)' },
    patrimonio: {
      label: 'Total Pasivo + Patrimonio', monto: data.pasivoMasPatrimonio,
      color: data.cuadra ? 'var(--green)' : 'var(--amber)',
    },
  };

  // Una tabla de comprobantes. Es lo que se abre debajo de cada línea.
  const TablaDetalle = ({ filas, signo = 1, vacio }) => {
    if (!filas || filas.length === 0) {
      return <div style={{ fontSize: 11.5, color: 'var(--tm)', fontStyle: 'italic', padding: '6px 2px' }}>{vacio}</div>;
    }
    return (
      <div style={{ maxHeight: 260, overflowY: 'auto', overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
        <table className="tbl" style={{ fontSize: 11.5 }}>
          <thead><tr>
            <th style={{ width: 92 }}>Fecha</th>
            <th style={{ width: 130 }}>Documento</th>
            <th>Quién</th>
            {companyId === 'todas' && <th style={{ width: 170 }}>Empresa</th>}
            <th style={{ width: 120, textAlign: 'right' }}>Importe</th>
          </tr></thead>
          <tbody>
            {filas.map(f => (
              <tr key={f.id}>
                <td>{f.fecha || '—'}</td>
                <td style={{ fontFamily: 'monospace' }}>{f.documento}</td>
                <td>{f.tercero}</td>
                {companyId === 'todas' && <td style={{ color: 'var(--tm)' }}>{nombreEmpresa(f.companyId)}</td>}
                <td style={{ textAlign: 'right', fontWeight: 600, color: f.monto < 0 ? 'var(--amber)' : undefined }}
                    className="col-num">
                  {signo < 0 ? '− ' : ''}{fmtCurP(f.monto, moneda)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

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
            onChange={e=>{ setCompanyId(e.target.value); setAbierta(null); }}
            disabled={!!empresaFija}
            title={empresaFija ? 'Estás dentro de la contabilidad de esta empresa: el reporte es solo suyo.' : undefined}
            style={{ minWidth:180 }}>
            {!empresaFija && <option value="todas">Todas las empresas</option>}
            {(companies || []).filter(c=>c.status==='activa' && (!empresaFija || c.id === empresaFija)).map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select
            className="fi"
            value={moneda}
            onChange={e=>{ setMoneda(e.target.value); setAbierta(null); }}
            style={{ minWidth:100 }}>
            <option value="PEN">S/ (PEN)</option>
            <option value="USD">USD</option>
          </select>
        </div>
      </div>
      {window.EmpresaActivaBanner ? <window.EmpresaActivaBanner/> : null}

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

      <div style={{ fontSize:11.5, color:'var(--ts)', marginBottom:8 }}>
        Tocá cualquier línea para ver <strong>de qué comprobantes sale</strong>, ordenados por importe.
      </div>

      {/* Tabla detalle — cada línea se abre y muestra su desglose */}
      <div className="card" style={{ overflow:'hidden' }}>
        <div style={{ overflowX:'auto' }}>
          <table className="tbl">
            <thead><tr>
              <th style={{ width:120 }}>Tipo</th>
              <th>Cuenta principal (PCGE)</th>
              <th style={{ width:160, textAlign:'right' }}>Saldo</th>
            </tr></thead>
            <tbody>
              {['activo','pasivo','patrimonio'].map(sec => {
                const info = SECCION[sec];
                const propias = lineas.filter(l => l.seccion === sec);
                const total = TOTAL_DE[sec];
                return (
                  <React.Fragment key={sec}>
                    <tr style={{ background: info.fondo }}>
                      <td colSpan={3} style={{ fontWeight:700, color: info.color }}>{info.label}</td>
                    </tr>
                    {propias.map(l => {
                      const abrible = !!(l.filas || l.partes);
                      const esta = abierta === l.clave;
                      return (
                        <React.Fragment key={l.clave}>
                          <tr onClick={abrible ? () => setAbierta(esta ? null : l.clave) : undefined}
                              style={{ cursor: abrible ? 'pointer' : 'default' }}
                              title={abrible ? 'Ver de dónde sale este número' : undefined}>
                            <td><span className={`badge ${BADGE[sec]}`}>{info.label.charAt(0) + info.label.slice(1).toLowerCase()}</span></td>
                            <td>
                              {abrible && <span style={{ color:'var(--tm)', marginRight:5 }}>{esta ? '▾' : '▸'}</span>}
                              <strong>{l.codigo}</strong> {l.label}
                            </td>
                            <td style={{ textAlign:'right' }} className="col-num">{fmtCurP(l.monto, moneda)}</td>
                          </tr>
                          {esta && (
                            <tr>
                              <td colSpan={3} style={{ background:'var(--tint-neutral)', padding:'10px 14px' }}>
                                {l.nota && (
                                  <div style={{ fontSize:11.5, color:'var(--ts)', marginBottom:8 }}>{l.nota}</div>
                                )}
                                {l.partes ? l.partes.map(p => (
                                  <div key={p.titulo} style={{ marginBottom:10 }}>
                                    <div style={{ fontSize:12, fontWeight:700, marginBottom:4 }}>
                                      {p.signo < 0 ? '−' : '+'} {p.titulo}
                                      <span style={{ color:'var(--tm)', fontWeight:400 }}> · {p.filas.length} comprobante(s) · {fmtCurP(p.total, moneda)}</span>
                                    </div>
                                    <TablaDetalle filas={p.filas} signo={p.signo}
                                      vacio={`No hay ${p.titulo.toLowerCase()} en ${moneda}.`} />
                                  </div>
                                )) : (
                                  <TablaDetalle filas={l.filas} vacio="No hay nada cargado en esta línea." />
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                    <tr style={{ fontWeight:700 }}>
                      <td>—</td>
                      <td>{total.label}</td>
                      <td style={{ textAlign:'right', color: total.color }} className="col-num">
                        {fmtCurP(total.monto, moneda)}
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ fontSize:11, color:'var(--tm)', marginTop:10, lineHeight:1.6 }}>
        <strong>Lo que sigue siendo una simplificación:</strong> el efectivo no sale de las cuentas bancarias
        sino de la diferencia entre lo cobrado y lo pagado; el patrimonio no sale del capital social sino del
        cuadre (Activo − Pasivo), por eso el balance cuadra siempre. Lo que ya <strong>no</strong> es
        simplificación: los bienes del registro 7.1 entran en el activo por su valor en libros — antes la
        empresa aparecía más pobre por haber comprado una máquina.
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
  const [companyIdRaw, setCompanyId] = uSP(() => filtroInicialEmpresa('todas'));
  // ÁMBITO, no filtro: con una empresa activa este es SU balance / SU estado
  // de resultados, y el selector va clavado.
  const empresaFija = useEmpresaBloqueada();
  const companyId = empresaFija || companyIdRaw;
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
            disabled={!!empresaFija}
            title={empresaFija ? 'Estás dentro de la contabilidad de esta empresa: el reporte es solo suyo.' : undefined}
            style={{ minWidth:160 }}>
            {!empresaFija && <option value="todas">Todas las empresas</option>}
            {(companies || []).filter(c=>c.status==='activa' && (!empresaFija || c.id === empresaFija)).map(c => (
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
      {window.EmpresaActivaBanner ? <window.EmpresaActivaBanner/> : null}

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
        <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontWeight:700, fontSize:13 }}>
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
