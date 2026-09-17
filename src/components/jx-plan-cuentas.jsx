import React from "react";
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  PCGE_CUENTAS,
  PCGE_ELEMENTOS_ORDENADOS,
  PCGE_TIPO_LABEL,
  PCGE_TIPO_BADGE,
  NIVEL_CUENTA,
  NIVEL_SUBCUENTA,
  NIVEL_MAXIMO,
  cuenta as buscarCuentaPorCodigo,
  hijosDe,
  tieneHijos,
  rutaDe,
  buscarCuentas,
} from '../lib/pcge.js';
import { PCGE_DESCRIPCIONES } from '../lib/pcge-descripciones.js';
import { filtroInicialEmpresa } from "../lib/empresa-activa.js";
import { useEmpresaBloqueada } from "../hooks/useEmpresaActiva.js";
import { calcularBalance, lineasDeBalance } from "../lib/balance-general.js";

const { useState: uSP, useMemo: uMP } = React;

// ─── Helpers ─────────────────────────────────────────────────
const fmtCurP = (n, currency = 'PEN') => {
  const symbol = currency === 'USD' ? 'USD ' : 'S/ ';
  return symbol + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const MESES = [
  { v: 1,  label: 'Enero' },     { v: 2,  label: 'Febrero' },
  { v: 3,  label: 'Marzo' },     { v: 4,  label: 'Abril' },
  { v: 5,  label: 'Mayo' },      { v: 6,  label: 'Junio' },
  { v: 7,  label: 'Julio' },     { v: 8,  label: 'Agosto' },
  { v: 9,  label: 'Setiembre' }, { v: 10, label: 'Octubre' },
  { v: 11, label: 'Noviembre' }, { v: 12, label: 'Diciembre' },
];

// ╔════════════════════════════════════════════════════════════╗
// ║  PLAN DE CUENTAS PCGE — SOLO LECTURA                       ║
// ╚════════════════════════════════════════════════════════════╝
//
// Esta pantalla NO edita nada, y es a propósito (decisión de Gabriel,
// 17-set-2026, tras hablar con las contadoras). Lo que muestra es el Plan
// Contable General Empresarial del MEF entero —1.792 códigos, con la
// descripción, la dinámica debe/haber y los comentarios del propio PDF—, que
// es la norma con la que se arma el Libro Diario.
//
// ANTES había 52 cuentas escritas a mano, un botón «Cargar PCGE default», otro
// «Cuenta custom» y un tacho para vaciar el plan, todo en localStorage. Eso
// significaba que el plan de cuentas podía ser distinto en cada PC y que
// ninguno era el del Estado peruano. Se fue entero.
//
// El nivel con el que se trabaja es la CUENTA de dos dígitos («63 Gastos de
// servicios prestados por terceros»), que es como hablan las contadoras, con
// la subcuenta de tres a un clic y el detalle hasta cinco para quien lo
// necesite.

// Las cuentas que aparecen cuando el que factura o el que ejecuta es un
// CONSORCIO. El PCGE no tiene un capítulo de consorcios: tiene estas tres
// cuentas y el resto sale del régimen tributario (R.S. 022-98/SUNAT, el
// documento de atribución). Se listan acá para que no haya que buscarlas.
const CUENTAS_CONSORCIO = [
  ['3027', 'El aporte del partícipe al consorcio, del lado de quien aporta.'],
  ['6782', 'La pérdida que le toca al partícipe por su parte en el negocio conjunto.'],
  ['7782', 'La ganancia que le toca al partícipe por su parte en el negocio conjunto.'],
];

const NIVELES = [
  { v: NIVEL_CUENTA,    label: 'Cuentas (2 dígitos)' },
  { v: NIVEL_SUBCUENTA, label: 'Hasta subcuenta (3)' },
  { v: 4,               label: 'Hasta divisionaria (4)' },
  { v: NIVEL_MAXIMO,    label: 'Todo el detalle (5)' },
];

/** Una línea del árbol. El sangrado ES el nivel: se lee de un vistazo. */
function FilaCuenta({ c, abierta, onToggle, onSelect, seleccionada }) {
  const sangria = (c.nivel - NIVEL_CUENTA) * 18;
  const esCuenta = c.nivel === NIVEL_CUENTA;
  const conHijos = tieneHijos(c.codigo);
  return (
    <div
      onClick={() => onSelect(c.codigo)}
      style={{
        display: 'flex', alignItems: 'baseline', gap: 8, cursor: 'pointer',
        padding: '6px 10px', paddingLeft: 10 + sangria,
        borderLeft: seleccionada ? '3px solid var(--amber)' : '3px solid transparent',
        background: seleccionada ? 'rgba(242,183,5,.10)' : undefined,
        borderBottom: '1px solid var(--border)',
      }}
    >
      <button
        className="btn btn-ghost btn-xs"
        style={{ width: 20, minWidth: 20, padding: 0, visibility: conHijos ? 'visible' : 'hidden' }}
        onClick={(e) => { e.stopPropagation(); onToggle(c.codigo); }}
        title={abierta ? 'Contraer' : 'Desglosar'}
      >
        {abierta ? '−' : '+'}
      </button>
      <span className="col-m" style={{ fontWeight: esCuenta ? 700 : 500, minWidth: 54 }}>{c.codigo}</span>
      <span style={{ fontWeight: esCuenta ? 600 : 400, fontSize: esCuenta ? 13.5 : 13 }}>{c.nombre}</span>
    </div>
  );
}

/** El detalle de una cuenta: lo que el PDF dice de ella, sin resumir. */
function DetalleCuenta({ codigo }) {
  const c = buscarCuentaPorCodigo(codigo);
  if (!c) {
    return (
      <div className="card card-p" style={{ color: 'var(--tm)', fontSize: 13 }}>
        Elegí una cuenta de la lista para ver qué dice el PCGE sobre ella.
      </div>
    );
  }
  const ruta = rutaDe(codigo);
  // La descripción la trae la CUENTA de dos dígitos: el PDF describe a ese
  // nivel. Una subcuenta muestra además su propio párrafo, si lo tiene.
  const madre = ruta[0]?.codigo;
  const desc = PCGE_DESCRIPCIONES[madre];
  const propia = desc?.subcuentas?.[codigo];
  const subcuentas = hijosDe(codigo);

  return (
    <div className="card card-p" style={{ display: 'grid', gap: 14 }}>
      <div>
        <div style={{ fontSize: 11, color: 'var(--tm)', display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          <span>{c.elementoNombre}</span>
          {ruta.slice(0, -1).map(r => <span key={r.codigo}>· {r.codigo} {r.nombre}</span>)}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
          <span className="col-m" style={{ fontSize: 22, fontWeight: 700 }}>{c.codigo}</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{c.nombre}</span>
          <span className={`badge ${PCGE_TIPO_BADGE[c.tipo] || 'b-gray'}`}>
            {PCGE_TIPO_LABEL[c.tipo] || c.tipo}
          </span>
        </div>
      </div>

      {propia && (
        <div>
          <div className="flabel">Qué va en esta subcuenta</div>
          <p style={{ fontSize: 13, lineHeight: 1.55, margin: '4px 0 0' }}>{propia}</p>
        </div>
      )}

      {!!desc?.contenido?.length && (
        <div>
          <div className="flabel">
            {codigo === madre ? 'Contenido' : `Contenido de la cuenta ${madre}`}
          </div>
          {desc.contenido.map((p, i) => (
            <p key={i} style={{ fontSize: 13, lineHeight: 1.55, margin: '4px 0 0' }}>{p}</p>
          ))}
        </div>
      )}

      {!!subcuentas.length && (
        <div>
          <div className="flabel">Se desglosa en</div>
          <div style={{ display: 'grid', gap: 6, marginTop: 4 }}>
            {subcuentas.map(s => (
              <div key={s.codigo} style={{ fontSize: 13 }}>
                <span className="col-m" style={{ fontWeight: 600 }}>{s.codigo}</span>{' '}
                <span>{s.nombre}</span>
                {desc?.subcuentas?.[s.codigo] && (
                  <div style={{ color: 'var(--tm)', fontSize: 12.5, lineHeight: 1.5, marginTop: 2 }}>
                    {desc.subcuentas[s.codigo]}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!!(desc?.dinamica?.debe?.length || desc?.dinamica?.haber?.length) && (
        <div>
          <div className="flabel">Dinámica de la cuenta {madre}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 4 }}>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--green)' }}>Se DEBITA por</div>
              <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 12.5, lineHeight: 1.5 }}>
                {desc.dinamica.debe.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            </div>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--red)' }}>Se ACREDITA por</div>
              <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 12.5, lineHeight: 1.5 }}>
                {desc.dinamica.haber.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            </div>
          </div>
        </div>
      )}

      {!!desc?.comentarios?.length && (
        <div>
          <div className="flabel">Comentarios del Consejo Normativo</div>
          {desc.comentarios.map((p, i) => (
            <p key={i} style={{ fontSize: 12.5, lineHeight: 1.55, margin: '4px 0 0', color: 'var(--tm)' }}>{p}</p>
          ))}
        </div>
      )}

      {!!desc?.niif?.length && (
        <div>
          <div className="flabel">NIIF e interpretaciones referidas</div>
          <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 12.5, lineHeight: 1.5, color: 'var(--tm)' }}>
            {desc.niif.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function PlanCuentasPage({ showToast }) {
  const [busqueda, setBusqueda] = uSP('');
  const [elementoFiltro, setElementoFiltro] = uSP('todos');
  const [nivelMax, setNivelMax] = uSP(NIVEL_SUBCUENTA);
  const [abiertas, setAbiertas] = uSP(() => new Set());
  const [seleccionada, setSeleccionada] = uSP(null);

  const hayBusqueda = busqueda.trim().length > 0;

  // El universo tras el buscador y el filtro de elemento.
  const encontradas = uMP(
    () => buscarCuentas(busqueda, { nivelMax })
      .filter(c => elementoFiltro === 'todos' || c.elemento === elementoFiltro),
    [busqueda, nivelMax, elementoFiltro],
  );

  /**
   * Las filas que se pintan.
   *
   * Sin búsqueda es un ÁRBOL: se ven las 83 cuentas y cada una se desgloza al
   * abrirla. Con búsqueda es una LISTA PLANA de lo que coincide — desplegar un
   * árbol filtrado esconde justo la fila que se estaba buscando.
   */
  const filas = uMP(() => {
    if (hayBusqueda) return encontradas;
    const out = [];
    const agregar = (c) => {
      out.push(c);
      if (!abiertas.has(c.codigo)) return;
      for (const h of hijosDe(c.codigo)) {
        if (h.nivel <= nivelMax) agregar(h);
      }
    };
    for (const c of encontradas) if (c.nivel === NIVEL_CUENTA) agregar(c);
    return out;
  }, [hayBusqueda, encontradas, abiertas, nivelMax]);

  const toggle = (codigo) => setAbiertas(prev => {
    const s = new Set(prev);
    if (s.has(codigo)) s.delete(codigo); else s.add(codigo);
    return s;
  });

  // Al elegir una cuenta de la búsqueda, se abre su rama: así al borrar el
  // texto la fila sigue a la vista y no hay que volver a buscarla.
  const seleccionar = (codigo) => {
    setSeleccionada(codigo);
    setAbiertas(prev => {
      const s = new Set(prev);
      for (const r of rutaDe(codigo)) if (r.codigo !== codigo) s.add(r.codigo);
      return s;
    });
  };

  const exportarPDF = () => {
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      doc.setFontSize(13);
      doc.text('Plan Contable General Empresarial (PCGE)', 14, 14);
      doc.setFontSize(8);
      doc.text('Versión modificada — Consejo Normativo de Contabilidad · MEF', 14, 19);
      autoTable(doc, {
        startY: 24,
        head: [['Código', 'Cuenta', 'Elemento']],
        body: filas.map(c => [c.codigo, c.nombre, c.elementoNombre]),
        styles: { fontSize: 7.5, cellPadding: 1.2 },
        headStyles: { fillColor: [242, 183, 5], textColor: 20 },
        columnStyles: { 0: { cellWidth: 20 }, 2: { cellWidth: 45 } },
      });
      doc.save(`PlanDeCuentas_PCGE_${filas.length}-cuentas.pdf`);
      showToast?.(`${filas.length} cuentas exportadas`, 'green');
    } catch (e) {
      showToast?.('No se pudo exportar: ' + (e?.message || e), 'red');
    }
  };

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Plan de Cuentas (PCGE)</div>
          <div className="pg-sub">
            Plan Contable General Empresarial · versión modificada, Consejo Normativo de
            Contabilidad (MEF) — {PCGE_CUENTAS.length.toLocaleString('es-PE')} cuentas
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={exportarPDF} title="Exportar lo que se ve">
          {window.JxIcon ? <window.JxIcon name="download" size={13}/> : null}PDF
        </button>
      </div>

      {/* Por qué no hay botones de editar. Sin este cartel, la pregunta
          «¿y dónde agrego una cuenta?» vuelve cada vez. */}
      <div className="card card-p" style={{ padding: 10, marginBottom: 12, fontSize: 12.5, lineHeight: 1.5 }}>
        <strong>Éste es el plan oficial y no se edita.</strong> Es la norma con la que se arma el
        Libro Diario: los mismos códigos, los mismos nombres y las mismas reglas en todos los
        dispositivos. Cada cuenta trae lo que el propio PCGE dice de ella — qué va adentro, por
        qué se debita, por qué se acredita y los comentarios del Consejo Normativo.
      </div>

      <div className="frow-sb" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <div className="search-bar" style={{ flex: '1 1 240px' }}>
          {window.JxIcon ? <window.JxIcon name="search" size={14} color="var(--tm)"/> : null}
          <input
            placeholder="Buscar por código (63) o por nombre (transporte, alquiler…)"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
          />
        </div>
        <select className="fi" style={{ minWidth: 190 }} value={elementoFiltro}
          onChange={e => setElementoFiltro(e.target.value)}>
          <option value="todos">Todos los elementos</option>
          {PCGE_ELEMENTOS_ORDENADOS.map(e => (
            <option key={e.codigo} value={e.codigo}>{e.codigo} · {e.nombre}</option>
          ))}
        </select>
        <select className="fi" style={{ minWidth: 175 }} value={nivelMax}
          onChange={e => setNivelMax(Number(e.target.value))}
          title="Hasta qué nivel del plan se muestra">
          {NIVELES.map(n => <option key={n.v} value={n.v}>{n.label}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--tm)', alignSelf: 'center' }}>
          {hayBusqueda ? `${filas.length} coincidencia(s)` : `${filas.length} fila(s)`}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 12, alignItems: 'start' }}>
        <div className="card" style={{ overflow: 'hidden', maxHeight: '70vh', overflowY: 'auto' }}>
          {filas.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--tm)', fontSize: 13 }}>
              Ninguna cuenta coincide con «{busqueda}».
            </div>
          ) : filas.map(c => (
            <FilaCuenta
              key={c.codigo}
              c={c}
              abierta={abiertas.has(c.codigo)}
              onToggle={toggle}
              onSelect={seleccionar}
              seleccionada={seleccionada === c.codigo}
            />
          ))}
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          <DetalleCuenta codigo={seleccionada}/>

          {/* El grupo ejecuta obras en consorcio y el PCGE no les dedica un
              capítulo: son estas tres cuentas. Tenerlas a mano evita buscarlas
              en 1.792 códigos cada vez. */}
          <div className="card card-p" style={{ fontSize: 12.5 }}>
            <div className="flabel">Cuentas que aparecen en un consorcio</div>
            <div style={{ display: 'grid', gap: 7, marginTop: 5 }}>
              {CUENTAS_CONSORCIO.map(([cod, para]) => {
                const cc = buscarCuentaPorCodigo(cod);
                if (!cc) return null;
                return (
                  <div key={cod} style={{ cursor: 'pointer' }} onClick={() => seleccionar(cod)}>
                    <span className="col-m" style={{ fontWeight: 600 }}>{cod}</span>{' '}
                    <span>{cc.nombre}</span>
                    <div style={{ color: 'var(--tm)', fontSize: 12, lineHeight: 1.45 }}>{para}</div>
                  </div>
                );
              })}
            </div>
            <p style={{ color: 'var(--tm)', fontSize: 12, lineHeight: 1.5, marginTop: 8, marginBottom: 0 }}>
              Un consorcio <strong>con contabilidad independiente</strong> —que es el caso de los
              del grupo: tienen RUC propio y su propio libro— lleva el plan completo como
              cualquier empresa. Lo que le es propio no son cuentas sino el circuito de
              atribución: el operador factura y cada mes reparte ingresos y gastos a los
              partícipes con el <strong>documento de atribución</strong> (R.S. 022-98/SUNAT), que
              no es una factura y no se declara como tal.
            </p>
          </div>
        </div>
      </div>
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

// Exportada además como módulo para poder renderizarla en un test. La app la
// sigue tomando de `window` (el chunk se carga por su efecto), así que esto no
// cambia cómo se monta la pantalla.
export { PlanCuentasPage };
