// ═══════════════════════════════════════════════════════════════════
// JARVEX — EL DESGLOSE DE UNA EMPRESA (tanda 2E).
//
// Empezó como "el detalle de una empresa" (punto 5 de las contadoras) y en la
// entrega 2C se le agregaron pestañas. Gabriel lo probó y fue tajante:
//   «cada empresa va a tener su desglose al igual que las obras que tienen sus
//    propias secciones […] tú estás haciendo simplemente el desglose de la
//    parte contable y eso está mal».
//
// Así que ahora es un PANEL, hermano del Panel del trabajo: al entrar se ven
// las SECCIONES de la empresa como tarjetas (con cuántas cosas hay en cada
// una), y desde ahí se entra a cada una. Las secciones y su gate por rol
// viven en `src/lib/desglose-empresa.js` (con tests), igual que
// `desglose-obra.js` manda en el desglose de un trabajo.
//
// Las secciones, y de dónde sale cada una:
//   FICHA        datos legales de la company (RUC, régimen, representante…)
//   CONTABILIDAD accounting_movements.company_id — criterio EXACTO del
//                Consolidado (una moneda por vez, sin anulados, interco aparte)
//   INVENTARIO   notas.items_factura de sus facturas: qué compró
//   PERSONAL     DERIVADO: no existe personal.company_id (decisión de Gabriel).
//                Es la gente de los trabajos que ejecuta o de los que es socia,
//                agrupada por forma de pago (planilla / RxH / sin definir)
//   TRABAJOS     obras.ejecutora_company_id + consorcio_socios +
//                trabajos.ejecutor_company_id
//   TESORERÍA    cuentas_bancarias.company_id + cronograma_pagos.company_id
//   EQUIPOS      activos_pesados.company_id
//   DOCUMENTOS   navega a Comprobantes con la empresa preseleccionada (única
//                sección que sale del panel: esa pantalla ya existe entera)
//
// Vive DENTRO de la página Empresas (import estático, mismo chunk: no es una
// página registrada, no toca main/sidebar/admin y no viola la regla
// anti-import-dinámico).
//
// ⚠ El inventario es lo COMPRADO, NO stock: los consumos de obra viven en
//   almacén por obra. La UI lo dice explícitamente para no crear una
//   expectativa falsa.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import {
  seccionesDeEmpresa, seccionEmpresa, CATEGORIAS_EMPRESA,
  CATEGORIA_EMPRESA_LABEL, categoriaDeEmpresa, bloquesContabilidadEmpresa,
} from "../lib/desglose-empresa.js";
import { setEmpresaActivaId, limpiarEmpresaActiva } from "../lib/empresa-activa.js";
import { getCurrentMode } from "../lib/app-mode-core.js";
import { extraerLineasDeFacturas } from "../lib/analisis-insumos.js";
import { resolverPares, construirGrupos } from "../lib/insumo-correlacion.js";
import { inventarioDeEmpresa, resumenFinancieroEmpresa, filtrarInventario } from "../lib/inventario-empresa.js";
import { sociosDeObra } from "../lib/consorcio.js";
import { TIPO_LBL as TRABAJO_TIPO_LBL, ESTADO_LBL as TRABAJO_ESTADO_LBL, ESTADO_BADGE as TRABAJO_ESTADO_BADGE, esAbierto as trabajoAbierto } from "../lib/trabajos.js";
import { TIPOS_TRABAJO, TIPO_TRABAJO_DEFAULT, normalizarEstadoObra, ESTADO_OBRA_LBL, ESTADO_OBRA_BADGE } from "../lib/tipos-trabajo.js";
import { categoriaDe, CATEGORIA_LABEL, CATEGORIA_BADGE } from "../lib/personal-categoria.js";
import { MODO_PAGO_LABEL } from "../lib/pagos.js";

const { useState: uSD, useMemo: uMD } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);

const fmtMonto = (n, moneda = 'PEN') =>
  `${moneda === 'USD' ? 'USD ' : 'S/ '}${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtCant = (n) => Number(n || 0).toLocaleString('es-PE', { maximumFractionDigits: 2 });
const fmtFecha = (f) => (f ? String(f).split('-').reverse().join('/') : '—');

// Ir al panel de un trabajo (obra) fijando la obra activa — mismo mecanismo
// que TrabajosPage.abrir()/entrarObra en jx-app.jsx, pero sin el gate de
// aislamiento por obra: Empresas es una pantalla cross-obra (admin/contador),
// y solo se listan acá obras donde la empresa YA participa.
const irAObra = (obraId) => {
  if (!obraId) return;
  try { window.__setObraActivaId?.(obraId); } catch {}
  window.__navTo?.('panel-obra');
};

// AGREGAR desde el panel de la empresa. Gabriel, 4-sep-2026: «actualmente
// sale como algo creado, pero que no te permite agregar, no puedo todavía
// agregar personal si es que yo quisiera […] también debería tener su sistema
// donde yo pueda agregar nuevos trabajos a los que estoy adhiriéndome».
//
// El panel NO duplica los formularios: lleva al lugar donde el dato ya se
// crea, con el contexto puesto. Duplicarlos sería tener dos altas del mismo
// registro con reglas distintas — el error que ya se pagó con las guías.
//
// PERSONAL: no existe `personal.company_id` (decisión de Gabriel). Una
// persona se da de alta EN UN TRABAJO, así que el botón pregunta en cuál de
// los trabajos de esta empresa y entra a ese plano.
const irAPersonalDeObra = (obraId) => {
  if (!obraId) return;
  try { window.__setObraActivaId?.(obraId); } catch {}
  window.__navTo?.('personal', 'obra');
};

// TRABAJOS: un bien/servicio SÍ es de una empresa (`ejecutor_company_id`), así
// que el alta se abre con ella ya elegida.
const irANuevoBienServicio = (companyId) => {
  window.__trabajoNuevoIntent = { ejecutorCompanyId: companyId || null };
  window.__navTo?.('bienes-servicios', 'general');
};

// Abrir LA FACTURA de la que salió una línea de insumo (pedido de Gabriel,
// 4-sep-2026: «me gustaría ver si aquí se puede mejorar un hipervínculo que
// nos lleve hacia la factura, en caso de que queramos verla»).
//
// No se abre un visor nuevo: se va a Movimientos Contables —donde la factura
// ya tiene su fila con el 👁 del PDF, la bancarización, la guía y la
// recepción— con el contexto de la empresa puesto, el buscador en ese
// documento y la fila marcada. Una sola forma de mirar un comprobante.
const irAFactura = (companyId, movId, doc) => {
  if (companyId) setEmpresaActivaId(companyId);
  window.__movFocoIntent = { id: movId || null, doc: doc || null };
  window.__navTo?.('movimientos-contables', 'general');
};

const TIPO_BADGE = {
  material: 'b-blue', servicio: 'b-gray', epp: 'b-green',
  herramienta: 'b-amber', maquinaria: 'b-red',
};

const PASO_LISTA = 50;   // insumos por tanda (GASOMI tiene cientos)

function EmpresaDetalle({ company, obrasEjecutora = [], obras = [], consorcios = [], consorcioSocios = [], trabajosBS = [], onVolver }) {
  // ── Hooks: TODOS antes de cualquier return (regla crítica 3) ──────
  const movsHook = window.__hooks.useAccountingMovements(company?.id);
  const corrHook = window.__hooks.useInsumoCorrelaciones();
  const personalHook = window.__hooks.usePersonal?.() || { data: [] };
  // Secciones nuevas del desglose (tanda 2E): los hooks ya aceptan company_id,
  // así que la vista se arma acá en vez de mandar al usuario a otra pantalla.
  const cuentasHook = window.__hooks.useCuentasBancarias?.(company?.id) || { data: [] };
  const cronogramaHook = window.__hooks.useCronogramaPagos?.(company?.id) || { data: [] };
  const activosHook = window.__hooks.useActivosPesados?.() || { data: [] };
  const [moneda, setMoneda] = uSD('PEN');
  // `seccion` = null → las TARJETAS del desglose (como el Panel del trabajo).
  // Un id de sección → esa vista, con "volver al panel".
  const [seccion, setSeccion] = uSD(null);
  const [vista, setVista] = uSD('acumulado');    // 'acumulado' | 'externo'
  const [busca, setBusca] = uSD('');
  const [tipoFiltro, setTipoFiltro] = uSD('');
  const [abierto, setAbierto] = uSD(null);       // clave del insumo expandido
  const [tope, setTope] = uSD(PASO_LISTA);
  const [modoPagoFiltro, setModoPagoFiltro] = uSD(''); // '' | 'planilla' | 'rxh' | 'otro'

  const esPrueba = (() => { try { return getCurrentMode() === 'prueba'; } catch { return false; } })();
  const movs = movsHook.data || [];
  const rol = window.__useAuth?.()?.profile?.rol;

  // ── Personal (entrega C, bloque 3): DERIVADO, no personal.company_id ──
  // Los trabajos que la empresa ejecuta o de los que es socia (obrasEjecutora,
  // ya filtrado por rolesPorObra en EmpresasPage) dan el conjunto de obras;
  // el personal de esas obras ES el personal de esta empresa.
  const obraById = uMD(() => new Map((obras || []).map(o => [o.id, o])), [obras]);
  const obraIdsRelacionadas = uMD(() => new Set(obrasEjecutora.map(x => x.obra_id)), [obrasEjecutora]);
  const personalDeEmpresa = uMD(
    () => (personalHook.data || []).filter(p => !p.deleted_at && obraIdsRelacionadas.has(p.obra_id)),
    [personalHook.data, obraIdsRelacionadas]
  );
  const personalPorModo = uMD(() => {
    const grupos = { planilla: [], rxh: [], otro: [] };
    for (const p of personalDeEmpresa) {
      const modo = p.modo_pago === 'planilla' || p.modo_pago === 'rxh' ? p.modo_pago : 'otro';
      grupos[modo].push(p);
    }
    return grupos;
  }, [personalDeEmpresa]);
  const personalFiltrado = uMD(
    () => modoPagoFiltro ? personalPorModo[modoPagoFiltro] : personalDeEmpresa,
    [personalDeEmpresa, personalPorModo, modoPagoFiltro]
  );

  // ── Trabajos (entrega C, bloque 4): obras (ejecutora/socia) + bienes y
  // servicios (`trabajos.ejecutor_company_id` o vía `trabajos.consorcio_id`) ──
  const obrasDeEmpresa = uMD(() => {
    return obrasEjecutora
      .map(x => {
        const obra = obraById.get(x.obra_id);
        if (!obra || obra.deleted_at) return null;
        const socio = x.rol === 'miembro_consorcio'
          ? sociosDeObra(obra, consorcios, consorcioSocios).find(s => s.company_id === company?.id)
          : null;
        return { obra, rol: x.rol, pct: socio?.participacion_pct ?? null, lider: !!socio?.es_lider };
      })
      .filter(Boolean)
      .sort((a, b) => (b.rol === 'ejecutora') - (a.rol === 'ejecutora')
        || String(a.obra.nombre_obra || '').localeCompare(String(b.obra.nombre_obra || '')));
  }, [obrasEjecutora, obraById, consorcios, consorcioSocios, company?.id]);

  // ── Tesorería y equipos: lo demás que una empresa TIENE ──────────
  const cuentasDeEmpresa = uMD(
    () => (cuentasHook.data || []).filter(c => !c.deleted_at && c.company_id === company?.id),
    [cuentasHook.data, company?.id]
  );
  const pagosProgramados = uMD(
    () => (cronogramaHook.data || []).filter(p => !p.deleted_at && p.company_id === company?.id),
    [cronogramaHook.data, company?.id]
  );
  const equiposDeEmpresa = uMD(
    () => (activosHook.data || []).filter(a => !a.deleted_at && a.company_id === company?.id),
    [activosHook.data, company?.id]
  );

  const trabajosBSDeEmpresa = uMD(() => (trabajosBS || []).filter(t => {
    if (t.deleted_at) return false;
    if (t.ejecutor_company_id === company?.id) return true;
    if (t.consorcio_id) return (consorcios || []).find(c => c.id === t.consorcio_id)?.company_id === company?.id;
    return false;
  }).sort((a, b) => trabajoAbierto(b.estado) - trabajoAbierto(a.estado)
    || String(a.nombre || '').localeCompare(String(b.nombre || ''))), [trabajosBS, consorcios, company?.id]);

  const resumen = uMD(
    () => resumenFinancieroEmpresa(movs, { companyId: company?.id, moneda, demo: esPrueba }),
    [movs, company?.id, moneda, esPrueba]
  );
  const lineas = uMD(() => extraerLineasDeFacturas(movs, { demo: esPrueba }), [movs, esPrueba]);
  const resueltos = uMD(() => resolverPares(corrHook.data || [], { demo: esPrueba }), [corrHook.data, esPrueba]);
  const { grupoDe, grupos } = uMD(() => construirGrupos(resueltos), [resueltos]);
  const inv = uMD(
    () => inventarioDeEmpresa(lineas, { companyId: company?.id, grupoDe, grupos }),
    [lineas, company?.id, grupoDe, grupos]
  );
  const tiposPresentes = uMD(() => {
    const s = new Set();
    inv.insumos.forEach(i => i.tipos.forEach(t => s.add(t)));
    return [...s].sort();
  }, [inv]);
  const filtrados = uMD(() => {
    const porTexto = filtrarInventario(inv.insumos, busca);
    return tipoFiltro ? porTexto.filter(i => i.tipos.includes(tipoFiltro)) : porTexto;
  }, [inv, busca, tipoFiltro]);

  if (!company) return null;

  const k = vista === 'externo' ? resumen.externo : resumen.total;
  const hayInterco = resumen.interco.ingresos > 0 || resumen.interco.costos > 0;

  // Gate por rol: el MISMO del sidebar, así ninguna tarjeta muere en "Sin
  // acceso" (idéntico al Panel del trabajo).
  const canSee = (id) => rol === 'admin' ? true : (window.__canSeeSidebarItem?.(rol, id) ?? false);
  const secciones = seccionesDeEmpresa({ canSee });
  const bloquesConta = bloquesContabilidadEmpresa({ canSee });
  // Cuántas cosas hay en cada sección: una tarjeta que dice "12 movimientos"
  // informa; una que no dice nada obliga a entrar para saber si vale la pena.
  const CUENTAS = {
    contabilidad: resumen.nMovs ? `${resumen.nMovs} movimiento(s) en ${moneda === 'USD' ? 'USD' : 'S/'}` : 'sin movimientos',
    inventario: inv.insumos.length ? `${inv.insumos.length} insumo(s) comprados` : 'sin facturas con detalle',
    personal: personalDeEmpresa.length ? `${personalDeEmpresa.length} persona(s)` : 'sin personal derivado',
    trabajos: (obrasDeEmpresa.length + trabajosBSDeEmpresa.length)
      ? `${obrasDeEmpresa.length + trabajosBSDeEmpresa.length} trabajo(s)` : 'no ejecuta trabajos',
    tesoreria: cuentasDeEmpresa.length
      ? `${cuentasDeEmpresa.length} cuenta(s)${pagosProgramados.length ? ` · ${pagosProgramados.length} pago(s) programado(s)` : ''}`
      : 'sin cuentas cargadas',
    equipos: equiposDeEmpresa.length ? `${equiposDeEmpresa.length} equipo(s)` : 'sin equipos a su nombre',
    ficha: company.ruc ? `RUC ${company.ruc}` : 'sin RUC cargado',
    documentos: 'comprobantes y guías',
  };

  const abrirSeccion = (s) => {
    if (s.tipo === 'pagina') {
      setEmpresaActivaId(company.id);
      window.__navTo?.(s.pagina, 'general');
      return;
    }
    setSeccion(s.id);
  };

  // Abrir una pantalla contable SIN perder la empresa: el filtro de esa
  // pantalla arranca en ella (filtroInicialEmpresa) y el cartel de contexto
  // dice dónde estás parado y cómo salir.
  const abrirContabilidad = (b) => {
    setEmpresaActivaId(company.id);
    window.__navTo?.(b.id, 'general');
  };

  const cabecera = (
    <div className="pg-hd frow-sb">
      <div style={{ minWidth: 0 }}>
        <button className="btn btn-ghost btn-sm" style={{ marginBottom: 6 }}
          onClick={() => {
            if (seccion) { setSeccion(null); return; }
            // Salir de la empresa SALE del contexto: si no, abrir después
            // Movimientos desde el menú seguiría mostrando solo la suya sin
            // que nadie recuerde por qué.
            limpiarEmpresaActiva();
            onVolver?.();
          }}>
          <JxIcon name="chevL" size={13} />{seccion ? 'Volver al panel de la empresa' : 'Volver a Empresas'}
        </button>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 2 }}>
          <span className={`badge ${CATEGORIAS_EMPRESA.find(c => c.v === categoriaDeEmpresa(company))?.badge || 'b-gray'}`} style={{ fontSize: 9.5 }}>
            {CATEGORIA_EMPRESA_LABEL[categoriaDeEmpresa(company)]}
          </span>
          {company.status && <span className={`badge ${company.status === 'activa' ? 'b-green' : 'b-gray'}`} style={{ fontSize: 9.5 }}>{company.status}</span>}
          {seccion && <span className="badge b-blue" style={{ fontSize: 9.5 }}>{seccionEmpresa(seccion)?.titulo}</span>}
        </div>
        <div className="pg-title" style={{ wordBreak: 'break-word' }}>{company.name}</div>
        <div className="pg-sub">
          {company.ruc ? `RUC ${company.ruc}` : 'sin RUC'}
          {company.legal_name ? ` · ${company.legal_name}` : ''}
          {company.regimen_tributario ? ` · ${company.regimen_tributario}` : ''}
        </div>
        {obrasEjecutora.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 4 }}>
            ✓ Ejecutora en: {obrasEjecutora.map(o => o.nombre).join(' · ')}
          </div>
        )}
      </div>
      {seccion === 'contabilidad' && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select className="fi" value={moneda} onChange={e => setMoneda(e.target.value)} style={{ minWidth: 100 }}>
            <option value="PEN">S/ (PEN)</option>
            <option value="USD">USD</option>
          </select>
        </div>
      )}
    </div>
  );

  // ── EL PANEL: las secciones de la empresa, como el desglose de una obra ──
  if (!seccion) {
    return (
      <div className="page-wrap">
        {cabecera}
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: 'var(--tm)', margin: '6px 0 10px' }}>
          SECCIONES DE ESTA EMPRESA
        </div>
        {secciones.length === 0 ? (
          <div className="card card-p empty-state">
            <JxIcon name="lock" size={32} color="var(--tm)" />
            <p>Tu rol no tiene secciones habilitadas dentro de una empresa.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 12 }}>
            {secciones.map(s => (
              <button key={s.id} type="button" className="card card-p" onClick={() => abrirSeccion(s)}
                style={{ textAlign: 'left', cursor: 'pointer', border: '1px solid var(--border)', display: 'flex',
                  flexDirection: 'column', gap: 8, minHeight: 124, background: 'var(--bg-c)', color: 'inherit', font: 'inherit' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = s.color; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 9, background: `color-mix(in srgb, ${s.color} 12%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <JxIcon name={s.icon} size={16} color={s.color} />
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--tp)' }}>{s.titulo}</div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--tm)', lineHeight: 1.4, flex: 1 }}>{s.desc}</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 10.5, color: 'var(--ts)', fontWeight: 600 }}>{CUENTAS[s.id] || ''}</span>
                  <JxIcon name="chevR" size={13} color={s.color} />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="page-wrap">
      {cabecera}

      {seccion === 'ficha' && (
        <FichaEmpresa company={company} obrasDeEmpresa={obrasDeEmpresa} />
      )}

      {seccion === 'tesoreria' && (
        <TesoreriaEmpresa cuentas={cuentasDeEmpresa} pagos={pagosProgramados} canSee={canSee} companyId={company.id} />
      )}

      {seccion === 'equipos' && (
        <EquiposEmpresa equipos={equiposDeEmpresa} obraById={obraById} canSee={canSee} />
      )}

      {seccion === 'contabilidad' && (<>
      {/* ── Resumen financiero (criterio del Consolidado) ─────────── */}
      <div style={{ display: 'flex', gap: 6, padding: 4, background: 'var(--bg-s)', borderRadius: 8, marginBottom: 12, width: 'fit-content', flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${vista === 'acumulado' ? 'btn-amber' : 'btn-ghost'}`} style={{ border: 'none' }} onClick={() => setVista('acumulado')}>
          Todo lo facturado
        </button>
        <button className={`btn btn-sm ${vista === 'externo' ? 'btn-amber' : 'btn-ghost'}`} style={{ border: 'none' }} onClick={() => setVista('externo')}>
          Solo con terceros (sin interco)
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
        {[
          { t: 'Ingresos', v: fmtMonto(k.ingresos, moneda), c: 'var(--green)' },
          { t: 'Costos', v: fmtMonto(k.costos, moneda), c: 'var(--red)' },
          { t: 'Gastos', v: fmtMonto(k.gastos, moneda), c: 'var(--amber)' },
          { t: 'Utilidad', v: fmtMonto(k.utilidad, moneda), c: k.utilidad >= 0 ? 'var(--blue)' : 'var(--red)' },
          { t: 'Margen', v: `${k.margen.toFixed(1)}%`, c: k.margen >= 0 ? 'var(--green)' : 'var(--red)' },
        ].map(x => (
          <div key={x.t} className="card card-p" style={{ borderLeft: `3px solid ${x.c}` }}>
            <div style={{ fontSize: 10.5, color: 'var(--tm)', textTransform: 'uppercase' }}>{x.t}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: x.c, marginTop: 3 }}>{x.v}</div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--tm)', marginBottom: 16, display: 'grid', gap: 3 }}>
        {/* Puente con la tabla madre: Empresas muestra una sola columna
            "Egresos" (= costos + gastos, renombrada en el punto 4b). Acá se
            desglosa en dos, así que se explicita la suma para que los dos
            números reconcilien a la vista y nadie crea que falta plata. */}
        <div>
          Egresos = costos + gastos = <strong>{fmtMonto(k.costos + k.gastos, moneda)}</strong>
          {' '}(es la columna «Egresos» de la tabla de Empresas) · Utilidad = ingresos − egresos.
        </div>
        <div>
          {resumen.nMovs} movimiento{resumen.nMovs !== 1 ? 's' : ''} en {moneda === 'USD' ? 'USD' : 'S/'}
          {resumen.cancelados > 0 ? ` · ${resumen.cancelados} anulado(s) fuera del cálculo` : ''}
          {resumen.notas > 0 ? ` · ${resumen.notas} nota(s) de crédito/débito` : ''}
          {resumen.otrasMonedas.map(o => ` · ${o.movs} en ${o.moneda} (cambiá la moneda para verlos)`).join('')}
        </div>
        {hayInterco && (
          <div>
            Entre empresas del grupo: {fmtMonto(resumen.interco.ingresos, moneda)} facturado
            {' '}y {fmtMonto(resumen.interco.costos, moneda)} comprado — la vista
            {' '}<strong>solo con terceros</strong> los saca (es el mismo criterio del Consolidado).
          </div>
        )}
      </div>

      {/* ── LA CONTABILIDAD, POR DENTRO ──────────────────────────────
          Los cinco números de arriba son el resumen; acá está el resto, que
          es lo que Gabriel echó de menos: «no sale los movimientos, acá no
          puedo ver nada de eso». Cada bloque abre su pantalla CON ESTA
          EMPRESA FIJADA, así la contabilidad de una no se mezcla con la de
          las otras. */}
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: 'var(--tm)', margin: '18px 0 4px' }}>
        LA CONTABILIDAD DE {String(company.name || '').toUpperCase()}
      </div>
      <div style={{ fontSize: 11, color: 'var(--tm)', marginBottom: 12 }}>
        Cada pantalla se abre mostrando solo lo de esta empresa. Para volver a ver el grupo entero,
        usá «Ver todas las empresas» en el cartel de arriba de cada una.
      </div>
      {bloquesConta.length === 0 ? (
        <div className="card card-p" style={{ color: 'var(--tm)', fontSize: 12, fontStyle: 'italic' }}>
          Tu rol no tiene acceso a las pantallas contables.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 }}>
          {bloquesConta.map(b => (
            <button key={b.id} type="button" className="card card-p" onClick={() => abrirContabilidad(b)}
              style={{ textAlign: 'left', cursor: 'pointer', border: '1px solid var(--border)', display: 'flex',
                flexDirection: 'column', gap: 6, background: 'var(--bg-c)', color: 'inherit', font: 'inherit' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = b.color; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <JxIcon name={b.icon} size={15} color={b.color} />
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--tp)' }}>{b.titulo}</div>
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--tm)', lineHeight: 1.4 }}>{b.desc}</div>
            </button>
          ))}
        </div>
      )}
      </>)}

      {seccion === 'inventario' && (<>
      {/* ── Inventario comprado ──────────────────────────────────── */}
      <div className="card card-p" style={{ marginBottom: 10, borderLeft: '3px solid var(--blue)', fontSize: 11.5, color: 'var(--ts)' }}>
        <strong style={{ color: 'var(--blue)' }}>Qué compró esta empresa</strong> — sale del detalle de las
        facturas cargadas por Captura Mágica. Es lo <strong>comprado</strong>, no el stock: los consumos y las
        salidas se llevan en Almacén por obra.
        {resumen.sinItems > 0 && (
          <> Hay <strong>{resumen.sinItems} factura(s) en {moneda === 'USD' ? 'USD' : 'S/'} sin detalle de ítems</strong> (registradas a mano): su monto está en los KPIs pero no en esta tabla.</>
        )}
        {inv.totales.lineasNota > 0 && <> {inv.totales.lineasNota} línea(s) de nota de crédito/débito quedan fuera de las cantidades.</>}
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: 10, borderBottom: '1px solid var(--border)' }}>
          <input
            className="fi" style={{ flex: 1, minWidth: 180 }}
            placeholder="Buscar insumo (sin tildes, busca también las variantes de nombre)"
            value={busca} onChange={e => { setBusca(e.target.value); setTope(PASO_LISTA); }} />
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <button className={`btn btn-xs ${tipoFiltro === '' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTipoFiltro('')}>Todos</button>
            {tiposPresentes.map(t => (
              <button key={t} className={`btn btn-xs ${tipoFiltro === t ? 'btn-amber' : 'btn-ghost'}`} onClick={() => { setTipoFiltro(t); setTope(PASO_LISTA); }}>{t}</button>
            ))}
          </div>
          <span style={{ fontSize: 11, color: 'var(--tm)' }}>{filtrados.length} insumo(s)</span>
        </div>

        {filtrados.length === 0 ? (
          <div className="card-p" style={{ color: 'var(--tm)', fontSize: 12, fontStyle: 'italic' }}>
            {inv.insumos.length === 0
              ? 'Esta empresa todavía no tiene facturas con detalle de ítems.'
              : 'Ningún insumo coincide con la búsqueda.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Insumo</th>
                <th style={{ textAlign: 'right' }}>Comprado</th>
                <th style={{ textAlign: 'right' }}>Gasto</th>
                <th style={{ textAlign: 'right' }}>Vendido</th>
                <th style={{ textAlign: 'right' }}>Saldo</th>
                <th>Última compra</th>
                <th style={{ textAlign: 'center' }}>Facturas</th>
              </tr></thead>
              <tbody>
                {filtrados.slice(0, tope).map(ins => {
                  const abiertoEste = abierto === ins.clave;
                  return (
                    <React.Fragment key={ins.clave}>
                      <tr>
                        <td className="col-p">
                          <strong>{ins.display}</strong>
                          <div style={{ marginTop: 2, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                            {ins.tipos.map(t => (
                              <span key={t} className={`badge ${TIPO_BADGE[t] || 'b-gray'}`} style={{ fontSize: 9 }}>{t}</span>
                            ))}
                            {ins.variantes.length > 1 && (
                              <span style={{ fontSize: 10, color: 'var(--tm)' }} title={ins.variantes.join('\n')}>
                                {ins.variantes.length} variantes de nombre
                              </span>
                            )}
                            {ins.recepcion.conDato > 0 && (
                              <span className="badge b-green" style={{ fontSize: 9 }} title="Almacén confirmó recepción de estas líneas">
                                ✓ {fmtCant(ins.recepcion.recibido)} recibido
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }} className="col-num">
                          {/* Un insumo puede aparecer SOLO vendido (lo facturó sin
                              tener la compra cargada acá): mostrar "0 compras"
                              confundiría — va un guión. */}
                          {ins.comprado.veces === 0 ? <span style={{ color: 'var(--tm)' }}>—</span> : (<>
                            {ins.comprado.cantidades.map(c => (
                              <div key={c.unidad}>{fmtCant(c.cantidad)} <span style={{ color: 'var(--tm)', fontSize: 10.5 }}>{c.label}</span></div>
                            ))}
                            <div style={{ fontSize: 10, color: 'var(--tm)' }}>
                              {ins.comprado.veces} compra{ins.comprado.veces !== 1 ? 's' : ''}
                              {ins.comprado.interco > 0 ? ` · ${ins.comprado.interco} interco` : ''}
                            </div>
                          </>)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="col-num">
                          {ins.comprado.montos.length === 0
                            ? <span style={{ color: 'var(--tm)' }}>—</span>
                            : ins.comprado.montos.map(m => <div key={m.moneda}>{fmtMonto(m.monto, m.moneda)}</div>)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="col-num">
                          {ins.vendido.veces === 0
                            ? <span style={{ color: 'var(--tm)' }}>—</span>
                            : (<>
                              {ins.vendido.cantidades.map(c => (
                                <div key={c.unidad}>{fmtCant(c.cantidad)} <span style={{ color: 'var(--tm)', fontSize: 10.5 }}>{c.label}</span></div>
                              ))}
                              {ins.vendido.montos.map(m => (
                                <div key={m.moneda} style={{ fontSize: 10, color: 'var(--green)' }}>{fmtMonto(m.monto, m.moneda)}</div>
                              ))}
                            </>)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="col-num">
                          {ins.saldo.length === 0
                            ? <span style={{ color: 'var(--tm)' }} title="Esta empresa no vendió este insumo: el saldo sería la columna Comprado repetida">—</span>
                            : ins.saldo.map(s => (
                              <div key={s.unidad} style={{ color: s.cantidad < 0 ? 'var(--red)' : 'var(--ts)' }}>
                                {fmtCant(s.cantidad)} <span style={{ color: 'var(--tm)', fontSize: 10.5 }}>{s.label}</span>
                              </div>
                            ))}
                        </td>
                        <td style={{ fontSize: 11.5 }}>
                          <div>{fmtFecha(ins.comprado.ultimaFecha)}</div>
                          {ins.comprado.ultimoPrecio != null && (
                            <div style={{ color: 'var(--tm)', fontSize: 10.5 }}>
                              {fmtMonto(ins.comprado.ultimoPrecio, ins.comprado.ultimaMoneda || 'PEN')} · {ins.comprado.ultimoProveedor || 's/ proveedor'}
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button className="btn btn-ghost btn-xs" onClick={() => setAbierto(abiertoEste ? null : ins.clave)}>
                            {abiertoEste ? '▾' : '▸'} {ins.lineas.length}
                          </button>
                        </td>
                      </tr>
                      {abiertoEste && (
                        <tr>
                          <td colSpan={7} style={{ background: 'var(--tint-neutral)' }}>
                            <div style={{ display: 'grid', gap: 4, padding: '6px 2px' }}>
                              {ins.variantes.length > 1 && (
                                <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                                  Nombres agrupados: {ins.variantes.join(' · ')}
                                </div>
                              )}
                              {ins.lineas.map(l => (
                                <div key={`${l.movId}-${l.itemIdx}`} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5, padding: '4px 6px', background: 'var(--tint-neutral)', borderRadius: 5 }}>
                                  <span className={`badge ${l.clase === 'venta' ? 'b-green' : 'b-red'}`} style={{ fontSize: 9 }}>
                                    {l.clase === 'venta' ? 'venta' : 'compra'}
                                  </span>
                                  {l.interco && <span className="badge b-blue" style={{ fontSize: 9 }}>interco</span>}
                                  <span style={{ color: 'var(--tm)' }}>{fmtFecha(l.fecha)}</span>
                                  {l.movId ? (
                                    <button type="button" className="btn btn-ghost btn-xs"
                                      style={{ padding: '0 5px', fontSize: 11, color: 'var(--blue)', textDecoration: 'underline' }}
                                      title={`Abrir el comprobante ${l.doc || ''} en Movimientos Contables`}
                                      onClick={() => irAFactura(company.id, l.movId, l.doc)}>
                                      {l.doc || 's/n'} <JxIcon name="external" size={10} />
                                    </button>
                                  ) : (
                                    <span className="col-m">{l.doc || 's/n'}</span>
                                  )}
                                  <span style={{ flex: 1, minWidth: 120 }} title={l.nombre}>
                                    {l.proveedorNombre || '(sin nombre)'}
                                  </span>
                                  <span>{fmtCant(l.cantidad)} {l.unidad}</span>
                                  <span style={{ color: l.precio > 0 ? 'var(--ts)' : 'var(--tm)' }}>
                                    {l.precio > 0 ? `${fmtMonto(l.precio, l.moneda)} c/u` : 'sin precio'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            {filtrados.length > tope && (
              <div style={{ padding: 10, textAlign: 'center' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setTope(tope + PASO_LISTA)}>
                  Mostrar {Math.min(PASO_LISTA, filtrados.length - tope)} más ({filtrados.length - tope} restantes)
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      </>)}

      {seccion === 'personal' && (
        <div className="card card-p" style={{ borderLeft: '3px solid var(--purple)', fontSize: 11.5, color: 'var(--ts)', marginBottom: 10 }}>
          <strong style={{ color: 'var(--purple)' }}>Personal de esta empresa</strong> — se DERIVA, no es una
          columna nueva: es la gente designada en las obras que esta empresa ejecuta o de las que es socia de
          consorcio. Agrupado por forma de pago (definida en Pagos), no por cargo.
          <div style={{ marginTop: 6, color: 'var(--tm)' }}>
            Por eso se agrega <strong>dentro de un trabajo</strong>: una persona entra a la obra en la que va a
            trabajar, y desde ahí aparece acá.
          </div>
          {canSee('personal') && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
              {obrasDeEmpresa.length === 0 ? (
                <span style={{ color: 'var(--tm)' }}>
                  Esta empresa todavía no tiene ningún trabajo: agregá uno primero (sección <strong>Trabajos</strong>).
                </span>
              ) : (<>
                <span style={{ color: 'var(--tm)' }}>Agregar personal en:</span>
                {obrasDeEmpresa.slice(0, 6).map(({ obra }) => (
                  <button key={obra.id} className="btn btn-ghost btn-xs"
                    title={`Ir al Personal de ${obra.nombre_obra || 'este trabajo'} para darlo de alta`}
                    onClick={() => irAPersonalDeObra(obra.id)}>
                    <JxIcon name="plus" size={11} /> {obra.nombre_obra || '(sin nombre)'}
                  </button>
                ))}
                {obrasDeEmpresa.length > 6 && (
                  <span style={{ color: 'var(--tm)' }}>y {obrasDeEmpresa.length - 6} trabajo(s) más</span>
                )}
              </>)}
            </div>
          )}
        </div>
      )}
      {seccion === 'personal' && (
        obraIdsRelacionadas.size === 0 ? (
          <div className="card card-p empty-state">
            <JxIcon name="users" size={40} color="var(--tm)" />
            <p>Esta empresa no ejecuta ni es socia de ningún trabajo: no tiene personal para mostrar.</p>
            {canSee('trabajos') && (
              <button className="btn btn-amber btn-sm" style={{ marginTop: 10 }} onClick={() => setSeccion('trabajos')}>
                Ir a Trabajos para agregar el primero
              </button>
            )}
          </div>
        ) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: 10, borderBottom: '1px solid var(--border)' }}>
              <button className={`btn btn-xs ${modoPagoFiltro === '' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setModoPagoFiltro('')}>
                Todos ({personalDeEmpresa.length})
              </button>
              <button className={`btn btn-xs ${modoPagoFiltro === 'planilla' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setModoPagoFiltro('planilla')}>
                Planilla ({personalPorModo.planilla.length})
              </button>
              <button className={`btn btn-xs ${modoPagoFiltro === 'rxh' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setModoPagoFiltro('rxh')}>
                Recibo por honorarios ({personalPorModo.rxh.length})
              </button>
              <button className={`btn btn-xs ${modoPagoFiltro === 'otro' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setModoPagoFiltro('otro')}>
                Sin definir / libre ({personalPorModo.otro.length})
              </button>
            </div>
            {personalFiltrado.length === 0 ? (
              <div className="card-p" style={{ color: 'var(--tm)', fontSize: 12, fontStyle: 'italic' }}>
                Nadie en este grupo todavía.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl">
                  <thead><tr>
                    <th>Nombre</th><th>Cargo</th><th>Categoría</th><th>Obra</th><th>Forma de pago</th><th>Estado</th>
                  </tr></thead>
                  <tbody>
                    {personalFiltrado.map(p => {
                      const { categoria } = categoriaDe(p, null);
                      const obra = obraById.get(p.obra_id);
                      return (
                        <tr key={p.id}>
                          <td className="col-p"><strong>{`${p.nombres || ''} ${p.apellidos || ''}`.trim() || '(sin nombre)'}</strong></td>
                          <td>{p.cargo || '—'}</td>
                          <td><span className={`badge ${CATEGORIA_BADGE[categoria]}`} style={{ fontSize: 9 }}>{CATEGORIA_LABEL[categoria]}</span></td>
                          <td>
                            {obra ? (
                              <button className="btn btn-ghost btn-xs" onClick={() => irAObra(obra.id)} title="Ir al panel de este trabajo">
                                {obra.nombre_obra || '(sin nombre)'}
                              </button>
                            ) : '—'}
                          </td>
                          <td>{p.modo_pago ? <span className="badge b-gray" style={{ fontSize: 9 }}>{MODO_PAGO_LABEL[p.modo_pago] || p.modo_pago}</span> : <span style={{ color: 'var(--tm)' }}>—</span>}</td>
                          <td><span className={`badge ${p.estado === 'activo' ? 'b-green' : 'b-gray'}`} style={{ fontSize: 9 }}>{p.estado || '—'}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      )}

      {seccion === 'trabajos' && (
        <div className="card card-p" style={{ borderLeft: '3px solid var(--blue)', fontSize: 11.5, color: 'var(--ts)', marginBottom: 10 }}>
          <strong style={{ color: 'var(--blue)' }}>Qué ejecuta esta empresa</strong> — obras donde es ejecutora o
          socia de consorcio (<code>obras.ejecutora_company_id</code>, <code>consorcio_socios</code>) y bienes/servicios
          que presta o vende (<code>trabajos.ejecutor_company_id</code>).
          <div style={{ marginTop: 6, color: 'var(--tm)' }}>
            Un <strong>bien o servicio</strong> es de una empresa: se crea acá mismo, ya a su nombre. Una{' '}
            <strong>obra</strong> nace con su buena pro y la empresa se le adhiere como ejecutora o como socia del
            consorcio, así que esa parte se hace desde la obra.
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {canSee('bienes-servicios') && (
              <button className="btn btn-amber btn-xs" onClick={() => irANuevoBienServicio(company.id)}
                title="Abre el alta de Bienes y Servicios con esta empresa como ejecutora">
                <JxIcon name="plus" size={11} /> Nuevo bien o servicio de esta empresa
              </button>
            )}
            {canSee('obras') && (
              <button className="btn btn-ghost btn-xs" onClick={() => window.__navTo?.('obras', 'general')}
                title="Las obras se crean y se les asigna ejecutora/socias desde Obras">
                Ir a Obras para adherirla a una <JxIcon name="chevR" size={10} />
              </button>
            )}
          </div>
        </div>
      )}
      {seccion === 'trabajos' && (
        (obrasDeEmpresa.length === 0 && trabajosBSDeEmpresa.length === 0) ? (
          <div className="card card-p empty-state">
            <JxIcon name="hardHat" size={40} color="var(--tm)" />
            <p>Esta empresa todavía no ejecuta ni participa en ningún trabajo registrado.</p>
            {canSee('bienes-servicios') && (
              <button className="btn btn-amber btn-sm" style={{ marginTop: 10 }} onClick={() => irANuevoBienServicio(company.id)}>
                <JxIcon name="plus" size={13} /> Agregar el primero
              </button>
            )}
          </div>
        ) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr>
                  <th>Trabajo</th><th>Tipo</th><th>Rol</th><th>Estado</th><th style={{ textAlign: 'center' }}>Ir</th>
                </tr></thead>
                <tbody>
                  {obrasDeEmpresa.map(({ obra, rol, pct, lider }) => {
                    const estado = normalizarEstadoObra(obra.estado);
                    const tipoLbl = TIPOS_TRABAJO.find(t => t.v === (obra.tipo_trabajo || TIPO_TRABAJO_DEFAULT))?.corto || '—';
                    return (
                      <tr key={obra.id}>
                        <td className="col-p"><strong>{obra.nombre_obra || '(sin nombre)'}</strong></td>
                        <td>{tipoLbl}</td>
                        <td>
                          {rol === 'ejecutora'
                            ? <span className="badge b-green" style={{ fontSize: 9 }}>Ejecutora</span>
                            : <span className="badge b-gray" style={{ fontSize: 9 }} title="Aporta capital o experiencia; no lleva los libros">
                                Socia{pct != null ? ` · ${Number(pct)}%` : ''}{lider ? ' · líder' : ''}
                              </span>}
                        </td>
                        <td><span className={`badge ${ESTADO_OBRA_BADGE[estado] || 'b-gray'}`} style={{ fontSize: 9 }}>{ESTADO_OBRA_LBL[estado]}</span></td>
                        <td style={{ textAlign: 'center' }}>
                          <button className="btn btn-ghost btn-xs" onClick={() => irAObra(obra.id)} title="Ir al panel de este trabajo">
                            <JxIcon name="chevR" size={11} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {trabajosBSDeEmpresa.map(t => (
                    <tr key={t.id}>
                      <td className="col-p"><strong>{t.nombre || '(sin nombre)'}</strong></td>
                      <td>{TRABAJO_TIPO_LBL[t.tipo] || '—'}</td>
                      <td><span className="badge b-green" style={{ fontSize: 9 }}>Ejecutor</span></td>
                      <td>
                        <span className={`badge ${TRABAJO_ESTADO_BADGE[t.estado] || 'b-gray'}`} style={{ fontSize: 9 }}>
                          {TRABAJO_ESTADO_LBL[t.estado] || t.estado}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button className="btn btn-ghost btn-xs" onClick={() => window.__navTo?.('bienes-servicios')} title="Ver en Bienes y Servicios">
                          <JxIcon name="chevR" size={11} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </div>
  );
}

// ── SECCIÓN: FICHA ─────────────────────────────────────────────────
// La identidad legal de la empresa. Estaba solo dentro del modal de edición:
// para MIRAR el RUC o el representante legal había que abrir un formulario.
function FichaEmpresa({ company, obrasDeEmpresa }) {
  const dato = (label, valor, ancho = 1) => (
    <div style={{ gridColumn: `span ${ancho}` }}>
      <div style={{ fontSize: 10, color: 'var(--tm)', fontWeight: 700, letterSpacing: '.06em' }}>{label}</div>
      <div style={{ fontSize: 13, color: valor ? 'var(--tp)' : 'var(--tm)', marginTop: 2, wordBreak: 'break-word' }}>
        {valor || '— sin cargar —'}
      </div>
    </div>
  );
  const actividades = Array.isArray(company.actividades_economicas) ? company.actividades_economicas : [];
  return (<>
    <div className="card card-p" style={{ marginBottom: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
        {dato('RUC', company.ruc)}
        {dato('RAZÓN SOCIAL', company.legal_name, 2)}
        {dato('NOMBRE COMERCIAL', company.name)}
        {dato('RÉGIMEN TRIBUTARIO', company.regimen_tributario)}
        {dato('REPRESENTANTE LEGAL', company.representante_legal, 2)}
        {dato('DOMICILIO FISCAL', company.direccion, 2)}
        {dato('TELÉFONO', company.telefono)}
        {dato('EMAIL', company.email)}
        {dato('INICIO DE ACTIVIDADES', company.inicio_actividades ? fmtFecha(company.inicio_actividades) : null)}
        {dato('CLASIFICACIÓN', CATEGORIA_EMPRESA_LABEL[categoriaDeEmpresa(company)])}
        {dato('TRABAJOS QUE EJECUTA', obrasDeEmpresa.length ? `${obrasDeEmpresa.length}` : '0')}
      </div>
      {actividades.length > 0 && (
        <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div style={{ fontSize: 10, color: 'var(--tm)', fontWeight: 700, letterSpacing: '.06em', marginBottom: 6 }}>
            ACTIVIDADES ECONÓMICAS (SUNAT)
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {actividades.map((a, i) => (
              <span key={i} className="badge b-gray" style={{ fontSize: 10 }}>{typeof a === 'string' ? a : (a?.descripcion || JSON.stringify(a))}</span>
            ))}
          </div>
        </div>
      )}
    </div>
    <button className="btn btn-ghost btn-sm"
      title="Abre el formulario de la empresa en el catálogo"
      onClick={() => { window.__empresaEditarIntent = company.id; window.__navTo?.('empresas', 'general'); }}>
      <JxIcon name="edit" size={13} /> Editar estos datos
    </button>
  </>);
}

// ── SECCIÓN: TESORERÍA ─────────────────────────────────────────────
function TesoreriaEmpresa({ cuentas, pagos, canSee, companyId }) {
  const pendientes = pagos.filter(p => p.estado !== 'pagado');
  // Las cuentas se dan de alta en Tesorería, que es donde vive el formulario
  // (y la conciliación). Entrar con la empresa activa deja el alta clavada en
  // ella: «no me permite agregar cuentas bancarias» era esto — el panel las
  // mostraba y no decía dónde se crean.
  const irACuentas = () => {
    if (companyId) setEmpresaActivaId(companyId);
    window.__navTo?.('cuentas-bancarias', 'general');
  };
  return (<>
    <div className="card card-p" style={{ marginBottom: 10, borderLeft: '3px solid var(--blue)', fontSize: 11.5, color: 'var(--ts)' }}>
      <strong style={{ color: 'var(--blue)' }}>La plata de esta empresa</strong> — sus cuentas bancarias y los pagos
      que tiene programados. Para registrar movimientos bancarios o conciliar, entrá a Tesorería.
    </div>
    <div className="card" style={{ overflow: 'hidden', marginBottom: 14 }}>
      <div style={{ padding: 10, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: 'var(--tm)' }}>
          CUENTAS BANCARIAS · {cuentas.length}
        </span>
        {canSee('cuentas-bancarias') && (
          <button className="btn btn-amber btn-xs" style={{ marginLeft: 'auto' }} onClick={irACuentas}
            title="Abre Tesorería con esta empresa fijada: la cuenta se crea a su nombre">
            <JxIcon name="plus" size={11} /> Agregar cuenta
          </button>
        )}
      </div>
      {cuentas.length === 0 ? (
        <div className="card-p" style={{ color: 'var(--tm)', fontSize: 12, fontStyle: 'italic' }}>
          Esta empresa no tiene cuentas bancarias cargadas. Con <strong>Agregar cuenta</strong> entrás a
          Tesorería con la empresa ya fijada.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>Banco</th><th>Número</th><th>Moneda</th><th>Tipo</th><th>Estado</th></tr></thead>
            <tbody>
              {cuentas.map(c => (
                <tr key={c.id}>
                  <td className="col-p"><strong>{c.banco || '—'}</strong></td>
                  <td className="col-m">{c.numero_cuenta || c.cci || '—'}</td>
                  <td>{c.moneda || 'PEN'}</td>
                  <td>{c.tipo_cuenta || '—'}</td>
                  <td><span className={`badge ${c.estado === 'activa' ? 'b-green' : 'b-gray'}`} style={{ fontSize: 9 }}>{c.estado || '—'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
    {pagos.length > 0 && (
      <div className="card" style={{ overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ padding: 10, borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: 'var(--tm)' }}>
          PAGOS PROGRAMADOS · {pendientes.length} pendiente(s) de {pagos.length}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>Concepto</th><th>Fecha</th><th style={{ textAlign: 'right' }}>Monto</th><th>Estado</th></tr></thead>
            <tbody>
              {pagos.slice(0, 25).map(p => (
                <tr key={p.id}>
                  <td className="col-p">{p.concepto || p.descripcion || '—'}</td>
                  <td>{fmtFecha(p.fecha_programada)}</td>
                  <td style={{ textAlign: 'right' }} className="col-num">{fmtMonto(p.monto, p.moneda || 'PEN')}</td>
                  <td><span className={`badge ${p.estado === 'pagado' ? 'b-green' : 'b-amber'}`} style={{ fontSize: 9 }}>{p.estado || 'pendiente'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )}
    {canSee('cuentas-bancarias') && (
      <button className="btn btn-ghost btn-sm" onClick={irACuentas}>
        Ir a Tesorería <JxIcon name="chevR" size={12} />
      </button>
    )}
  </>);
}

// ── SECCIÓN: EQUIPOS Y MAQUINARIA ──────────────────────────────────
function EquiposEmpresa({ equipos, obraById, canSee }) {
  return (<>
    <div className="card card-p" style={{ marginBottom: 10, borderLeft: '3px solid var(--orange)', fontSize: 11.5, color: 'var(--ts)' }}>
      <strong style={{ color: 'var(--orange)' }}>Los equipos a nombre de esta empresa</strong> — activos pesados
      con su propietaria registrada. Dónde está cada uno y sus horas de trabajo se llevan en la obra donde opera.
    </div>
    {equipos.length === 0 ? (
      <div className="card card-p empty-state">
        <JxIcon name="tool" size={36} color="var(--tm)" />
        <p>Ningún equipo pesado está registrado a nombre de esta empresa.</p>
      </div>
    ) : (
      <div className="card" style={{ overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>Equipo</th><th>Placa</th><th>Tipo</th><th>Obra actual</th><th>Estado</th></tr></thead>
            <tbody>
              {equipos.map(a => (
                <tr key={a.id}>
                  <td className="col-p"><strong>{a.nombre || a.descripcion || '—'}</strong></td>
                  <td className="col-m">{a.placa || '—'}</td>
                  <td>{a.tipo || '—'}</td>
                  <td style={{ fontSize: 11.5 }}>
                    {a.obra_actual_id
                      ? (obraById.get(a.obra_actual_id)?.nombre_obra || '(otra obra)')
                      : <span style={{ color: 'var(--tm)' }}>sin asignar</span>}
                  </td>
                  <td><span className="badge b-gray" style={{ fontSize: 9 }}>{a.estado || '—'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )}
    {canSee('activos-pesados') && (
      <button className="btn btn-ghost btn-sm" onClick={() => window.__navTo?.('activos-pesados', 'obra')}>
        Ir a Equipos Pesados <JxIcon name="chevR" size={12} />
      </button>
    )}
  </>);
}

Object.assign(window, { EmpresaDetalle });
export { EmpresaDetalle };
