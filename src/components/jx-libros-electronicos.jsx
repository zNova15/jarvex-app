import React from "react";
import {
  generateLibroDiarioPLE,
  generateLibroMayorPLE,
  downloadPLE,
} from '../lib/sunat-ple.js';
import { enPeriodo } from '../lib/fecha.js';
import { generatePDT601, buildPDT601Filename } from '../lib/sunat-pdt601.js';
import { generarAsientosBatch } from '../lib/asientos.js';
import { contextoDeAsientos } from '../lib/asientos-contexto.js';
import { notaSinEfecto } from '../lib/notas-credito.js';
import { tasaDeComprobante } from '../lib/tipo-cambio-pasada.js';
import { cargarBancarizados } from '../lib/bancarizado-db.js';
import { crearResolvedorDeFamilia, cuentasDeComprobante } from '../lib/cuenta-de-comprobante.js';
import { activoPorLinea, activoDeLineaDe } from '../lib/naturaleza-insumo.js';
import { destinoPorNombre } from '../lib/destino-inventario.js';
import { declaraEnPeriodo } from '../lib/periodo-declaracion.js';
import { filtroInicialEmpresa } from "../lib/empresa-activa.js";
import { useEmpresaBloqueada } from "../hooks/useEmpresaActiva.js";
import { ComparativaSunat } from './jx-cotejo-sunat.jsx';
import { RegistroComprasVentas } from './jx-registro-compras-ventas.jsx';

const { useState: uS, useMemo: uM, useEffect: uE } = React;

const MOSTRAR_PDT601 = false;
const MESES_LARGOS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Setiembre','Octubre','Noviembre','Diciembre'];
const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function pad2(n) { return String(n || 0).padStart(2, '0'); }


function LibrosElectronicosPage({ showToast }) {
  const today = new Date();
  const [anio, setAnio] = uS(today.getFullYear());
  const [mes,  setMes]  = uS(today.getMonth() + 1);
  // Acá la empresa es OBLIGATORIA: '' = ninguna elegida. El efecto de abajo
  // autoselecciona la primera si esto queda vacío.
  const [companyIdRaw, setCompanyId] = uS(() => filtroInicialEmpresa(''));
  // ÁMBITO, no filtro: con una empresa activa esta pantalla es la contabilidad
  // de ESA empresa y el selector va clavado (Gabriel: «netamente y
  // exclusivamente de esa empresa seleccionada»).
  const empresaFija = useEmpresaBloqueada();
  const companyId = empresaFija || companyIdRaw;
  const [busy, setBusy] = uS(false);
  // ── LAS CARAS DE ESTA PANTALLA, Y CUÁL VA PRIMERO (17-set) ────────
  // Arranca en el REGISTRO DE COMPRAS Y VENTAS, no en la generación de PLE:
  // «los registros de compra y venta deberían estar en primer plano» (Gabriel).
  // Es lo que se mira todos los meses; el .txt del PLE se genera una vez y se
  // sube. Las otras dos caras —el registro y el cotejo— comparten el ámbito
  // exacto (empresa + año + mes) y por eso viven acá y no en el menú.
  //
  // El reemplazo SIRE y el escáner de incoherencias YA NO son pestañas: se
  // mudaron adentro del registro (tandas 5 y 6). El SIRE es una de sus tres
  // exportaciones, con la selección por comprobante en la propia fila; el
  // escáner es una ventana que se abre desde ahí, apuntada al período.
  const [tab, setTab] = uS('registro');
  const userId = (() => { try { return window.__useAuth?.()?.profile?.id || null; } catch { return null; } })();

  const { data: companies = [] } = window.__hooks.useCompanies();
  const { data: movs       = [] } = window.__hooks.useAccountingMovements();
  const { data: planillas  = [] } = window.__hooks.usePlanillas
    ? window.__hooks.usePlanillas()
    : { data: [] };

  // selección por defecto: primera empresa
  uE(() => {
    if (!companyId && companies.length > 0) {
      setCompanyId(companies[0].id);
    }
  }, [companies, companyId]);

  const company = uM(
    () => companies.find(c => c.id === companyId) || null,
    [companies, companyId]
  );

  // Filtro de movimientos por período + empresa
  // Índice completo (NO filtrado por período): las notas de crédito/débito
  // referencian facturas que suelen ser de meses anteriores.
  const movsById = uM(() => new Map((movs || []).map(m => [m.id, m])), [movs]);

  // ── EL MES ES EL DE DECLARACIÓN, NO EL DE EMISIÓN (23-set-2026) ──
  // Una factura emitida en febrero se puede declarar en junio (el crédito
  // fiscal se usa dentro de los 12 meses siguientes, Ley 29215 art. 2), y las
  // asistentes tenían que poder moverla. `declaraEnPeriodo` es la ÚNICA
  // función que contesta en qué mes cae un comprobante: usa `periodo_declarado`
  // si lo tiene y, si no, su fecha de emisión —que es el 100 % de lo ya
  // cargado—. Acá se filtra con ella para que el registro, el PLE y los
  // asientos del mes digan todos lo mismo; preguntarle a `date` en alguno de
  // los tres haría aparecer el comprobante en dos meses distintos según quién
  // pregunte.
  const movsPeriodo = uM(() => {
    return (movs || []).filter(m => {
      if (!m || m.deleted_at) return false;
      if (m.payment_status === 'cancelled') return false;
      // Factura y nota quedan las DOS vivas (Gabriel, 25-set-2026). Una nota
      // cuya factura igual quedó dada de baja no resta: si no, la baja se
      // cuenta dos veces en el registro, el PLE y el libro de este mes.
      if (notaSinEfecto(m, movsById)) return false;
      if (companyId && m.company_id && m.company_id !== companyId) return false;
      return declaraEnPeriodo(m, Number(anio), Number(mes));
    });
  }, [movs, movsById, anio, mes, companyId]);

  const movsCompras = uM(
    () => movsPeriodo.filter(m => m.type === 'cost' || m.type === 'expense'),
    [movsPeriodo]
  );
  const movsVentas = uM(
    () => movsPeriodo.filter(m => m.type === 'income'),
    [movsPeriodo]
  );

  // Asientos (Libro Diario / Mayor)
  //
  // El PLE que se le declara a SUNAT lleva la MISMA cuenta que muestra el
  // Libro Diario en pantalla. Si esta pantalla generara los asientos sin el
  // reparto, el libro en pantalla diría 63 y el archivo declarado diría 60 —
  // dos verdades distintas del mismo mes, y la que llega a SUNAT sería la
  // equivocada. Por eso el resolvedor se arma también acá.
  const { data: catalogoInsumos } = window.__hooks?.useCatalogoInsumos?.() || { data: [] };
  const { data: insumoCategorias } = window.__hooks?.useInsumoCategorias?.() || { data: [] };
  const { data: terminosCustom } = window.__hooks?.useClasificacionTerminos?.() || { data: [] };

  // Y la naturaleza del insumo (tanda 4), por el MISMO motivo de arriba: si el
  // Libro Diario asienta la tubería de reventa en la 601 y el PLE la declara en
  // la 602, la que llega a SUNAT es la equivocada.
  const { data: decisionesCotejo } = window.__hooks?.useCotejoDecisiones?.() || { data: [] };
  const { data: activosFijos } = window.__hooks?.useActivosFijos?.(companyId || null) || { data: [] };

  const repartoDe = uM(() => {
    const familiaDe = crearResolvedorDeFamilia({
      catalogo: catalogoInsumos || [],
      alias: insumoCategorias || [],
      terminosCustom: terminosCustom || [],
      companyId: companyId || null,
      naturalezaPorNombre: destinoPorNombre(decisionesCotejo || []),
    });
    const activoDeLinea = activoDeLineaDe(activoPorLinea(activosFijos || []));
    return (mov) => cuentasDeComprobante(mov, { familiaDe, activoDeLinea });
  }, [catalogoInsumos, insumoCategorias, terminosCustom, companyId, decisionesCotejo, activosFijos]);

  // La misma evidencia bancaria que usa el Libro Diario: el PLE que se declara
  // tiene que llevar la MISMA contrapartida que la pantalla, no una deducida
  // con menos datos (17-set).
  const [bancarizadoIds, setBancarizadoIds] = uS(() => new Set());
  uE(() => {
    let vivo = true;
    cargarBancarizados(window.__db)
      .then(s => { if (vivo) setBancarizadoIds(s); })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);

  // La moneda, los anticipos y la referencia: los MISMOS que usa el Libro
  // Diario en pantalla (tanda C). Si esta pantalla asentara el anticipo en la
  // 60 y el libro en la 422, el PLE que llega a SUNAT sería el equivocado.
  const { data: tasasTc = [] } = window.__hooks?.useTiposCambio?.() || { data: [] };
  const { data: aplicacionesAnticipo = [] } = window.__hooks?.useAnticipoAplicaciones?.() || { data: [] };
  const contexto = uM(
    () => contextoDeAsientos({ movimientos: movs || [], aplicaciones: aplicacionesAnticipo || [], tasas: tasasTc || [] }),
    [movs, aplicacionesAnticipo, tasasTc],
  );

  const asientos = uM(
    () => generarAsientosBatch(movsPeriodo, { ...contexto, repartoDe, bancarizadoIds }),
    [movsPeriodo, contexto, repartoDe, bancarizadoIds]
  );

  // ── LOS ASIENTOS QUE VAN AL PLE DEL MES (tanda F, 26-set-2026) ────
  // El asiento de un comprobante va en el mes en que se DECLARA (los de
  // `movsPeriodo`), pero la salida de inventario va en SU fecha: una compra de
  // mayo consumida en agosto es costo de agosto. Por eso las salidas se toman
  // de toda la empresa por su propia fecha, y no las que cuelgan de los
  // comprobantes del mes. El generador ya no vuelve a filtrar por `fecha`
  // (tiraba en silencio los asientos de los comprobantes diferidos).
  const movsConSalidaDelMes = uM(() => (movs || []).filter(m =>
    m && !m.deleted_at && m.payment_status !== 'cancelled'
    && (!companyId || m.company_id === companyId)
    && m.existencia_salida_cuenta
    && enPeriodo(m.existencia_salida_fecha, Number(anio), Number(mes))),
  [movs, companyId, anio, mes]);
  const asientosPle = uM(() => [
    ...asientos.filter(a => !a.esSalidaExistencia),
    ...generarAsientosBatch(movsConSalidaDelMes, { ...contexto, repartoDe, bancarizadoIds })
      .filter(a => a.esSalidaExistencia),
  ], [asientos, movsConSalidaDelMes, contexto, repartoDe, bancarizadoIds]);

  // Totales para card resumen — EN SOLES al tipo de cambio de cada comprobante
  // (regla 11: nunca soles y dólares crudos en la misma suma). Lo que no tiene
  // tasa queda afuera y se cuenta, en vez de sumarse como si fueran soles.
  const resumen = uM(() => {
    let sinTc = 0;
    const enSoles = (m) => {
      const mon = String(m.currency || 'PEN').toUpperCase();
      if (mon === 'PEN') return Number(m.amount || 0);
      const t = tasaDeComprobante(m, tasasTc || []);
      if (!t) { sinTc += 1; return 0; }
      return Number(m.amount || 0) * t.valor;
    };
    const totVentas = movsVentas.reduce((s, m) => s + enSoles(m), 0);
    const totCompras = movsCompras.reduce((s, m) => s + enSoles(m), 0);
    return {
      registros: movsPeriodo.length,
      ventas:    totVentas,
      compras:   totCompras,
      asientos:  asientosPle.length,
      sinTc,
    };
  }, [movsPeriodo, movsVentas, movsCompras, asientosPle, tasasTc]);

  // Planilla del período seleccionado
  const planillaPeriodo = uM(() => {
    return (planillas || []).find(p =>
      p && !p.deleted_at
      && Number(p.periodo_anio) === Number(anio)
      && Number(p.periodo_mes)  === Number(mes)
      && (!companyId || p.company_id === companyId)
    ) || null;
  }, [planillas, anio, mes, companyId]);

  const periodo = { anio: Number(anio), mes: Number(mes) };
  const ruc = company?.ruc || '';
  const rucValid = String(ruc).length === 11;

  // ─── Descargas ──────────────────────────────────────────────
  // Lo que el validador de SUNAT rechazaría va en el aviso, NUNCA dentro del
  // .txt (una línea que no es de detalle invalida el archivo entero).
  const avisarPle = (nombre, out, unidad) => {
    const extras = [];
    if (out.omitidos) extras.push(`${out.omitidos} asiento(s) en otra moneda sin tipo de cambio quedaron AFUERA — cargá la tasa y volvé a generarlo`);
    extras.push(...(out.avisos || []));
    showToast?.(`${nombre}: ${unidad}` + (extras.length ? ` · ⚠ ${extras.join(' · ')}` : ''), extras.length ? 'amber' : 'green');
  };

  const handleLibroDiario = () => {
    if (!rucValid) return showToast?.('La empresa no tiene RUC válido', 'red');
    const out = generateLibroDiarioPLE(asientosPle, periodo, ruc, { movsById });
    if (!out.content) return showToast?.('Sin asientos en el período', 'orange');
    downloadPLE(out.filename, out.content);
    avisarPle('Libro Diario PLE', out, `${out.registros} asientos, ${out.lineas} líneas`);
  };

  const handleLibroMayor = () => {
    if (!rucValid) return showToast?.('La empresa no tiene RUC válido', 'red');
    const out = generateLibroMayorPLE(asientosPle, periodo, ruc, { movsById });
    if (!out.content) return showToast?.('Sin asientos en el período', 'orange');
    downloadPLE(out.filename, out.content);
    avisarPle('Libro Mayor PLE', out, `${out.lineas} movimientos en ${out.cuentas} cuentas`);
  };

  const handlePDT601 = async () => {
    if (!rucValid) return showToast?.('La empresa no tiene RUC válido', 'red');
    if (!planillaPeriodo) return showToast?.('No hay planilla cerrada para este período', 'red');
    setBusy(true);
    try {
      // Cargar boletas + personal + contratos
      const boletas = await window.__db.planilla_boletas
        .where('planilla_id').equals(planillaPeriodo.id)
        .filter(b => !b.deleted_at)
        .toArray();
      let personalList = [];
      try {
        personalList = await window.__db.personal
          .filter(p => !p.deleted_at)
          .toArray();
      } catch (_) {}
      const contratos = [];
      for (const p of personalList) {
        try {
          const cs = await window.__db.personal_contrato
            .where('personal_id').equals(p.id)
            .filter(c => !c.deleted_at)
            .toArray();
          contratos.push(...cs);
        } catch (_) {}
      }
      const txt = generatePDT601(planillaPeriodo, boletas, contratos, personalList, company);
      const filename = buildPDT601Filename(ruc, periodo);
      downloadPLE(filename, txt);
      showToast?.(`PDT 601 generado: ${boletas.length} trabajadores`, 'green');
    } catch (e) {
      console.error('[PDT601]', e);
      showToast?.('Error al generar PDT 601: ' + e.message, 'red');
    } finally {
      setBusy(false);
    }
  };

  // ─── Definición de cards ────────────────────────────────────
  const cards = [
    {
      key: 'diario',
      titulo: 'Libro Diario',
      formato: 'PLE 5.1.0 — código 050100',
      color: 'var(--blue)',
      registros: asientosPle.length,
      warning: !rucValid ? 'Empresa sin RUC válido' : (asientosPle.length === 0 ? 'No hay asientos en el período' : null),
      onDownload: handleLibroDiario,
      label: 'Asientos contables del período',
    },
    {
      key: 'mayor',
      titulo: 'Libro Mayor',
      formato: 'PLE 6.1.0 — código 060100',
      color: 'var(--purple, #8b5cf6)',
      registros: asientosPle.length,
      warning: !rucValid ? 'Empresa sin RUC válido' : (asientosPle.length === 0 ? 'No hay asientos en el período' : null),
      onDownload: handleLibroMayor,
      label: 'Movimientos del Diario, ordenados por cuenta',
    },
  ];

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Libros Electrónicos</div>
          <div className="pg-sub">Registro de Compras y Ventas (SIRE) · Libro Diario y Mayor (PLE)</div>
        </div>
      </div>
      {window.EmpresaActivaBanner ? <window.EmpresaActivaBanner/> : null}

      {/* Selector empresa + período */}
      <div className="card card-p" style={{ marginBottom: 16, display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
        <div>
          <label className="flabel">Empresa</label>
          <select
            className="fi"
            value={companyId}
            onChange={e => setCompanyId(e.target.value)}
            disabled={!!empresaFija}
            title={empresaFija ? 'Estás dentro de la contabilidad de esta empresa: los PLE se generan para ella.' : undefined}
          >
            {companies.length === 0 && <option value="">— sin empresas —</option>}
            {companies.map(c => (
              <option key={c.id} value={c.id}>
                {c.legal_name || c.name} {c.ruc ? `· RUC ${c.ruc}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="flabel">Año</label>
          <select className="fi" value={anio} onChange={e => setAnio(Number(e.target.value))}>
            {[anio + 1, anio, anio - 1, anio - 2, anio - 3].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="flabel">Mes</label>
          <select className="fi" value={mes} onChange={e => setMes(Number(e.target.value))}>
            {MESES_LARGOS.map((m, i) => (
              <option key={i} value={i + 1}>{m}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Las caras de esta pantalla */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          ['registro', '📊 Registro de Compras y Ventas'],
          ['sunat', '🔍 SUNAT vs JARVEX'],
          ['ple', '📄 Generar libros (PLE)'],
        ].map(([k, label]) => (
          <button
            key={k}
            className={tab === k ? 'btn btn-amber' : 'btn'}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'registro' && (
        <RegistroComprasVentas
          company={company}
          companies={companies}
          movs={movs}
          movsPeriodo={movsPeriodo}
          movsById={movsById}
          asientos={asientos}
          anio={anio}
          mes={mes}
          showToast={showToast}
          userId={userId}
          empresaFija={empresaFija}
        />
      )}

      {tab === 'sunat' && (
        <ComparativaSunat
          company={company}
          companies={companies}
          movs={movs}
          anio={anio}
          mes={mes}
          showToast={showToast}
          userId={userId}
        />
      )}

      {tab !== 'ple' ? null : <>
      {/* Card resumen */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
        <div className="card card-p" style={{ padding: 12, textAlign: 'center' }}>
          <div style={{ color: 'var(--tm)', fontSize: 11 }}>Movimientos del período</div>
          <div style={{ fontWeight: 700, fontSize: 20 }}>{resumen.registros}</div>
        </div>
        <div className="card card-p" style={{ padding: 12, textAlign: 'center' }}>
          <div style={{ color: 'var(--tm)', fontSize: 11 }}>Total Ventas</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--green)' }}>{fmtS(resumen.ventas)}</div>
        </div>
        <div className="card card-p" style={{ padding: 12, textAlign: 'center' }}>
          <div style={{ color: 'var(--tm)', fontSize: 11 }}>Total Compras</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--orange)' }}>{fmtS(resumen.compras)}</div>
        </div>
        <div className="card card-p" style={{ padding: 12, textAlign: 'center' }}>
          <div style={{ color: 'var(--tm)', fontSize: 11 }}>Asientos generados</div>
          <div style={{ fontWeight: 700, fontSize: 20, color: 'var(--blue)' }}>{resumen.asientos}</div>
        </div>
      </div>

      {company && !rucValid && (
        <div className="card card-p" style={{ padding: 12, marginBottom: 16, background: '#fee', border: '1px solid #f99' }}>
          <strong style={{ color: '#a00' }}>Atención:</strong>
          <span style={{ marginLeft: 8 }}>
            La empresa "{company.legal_name || company.name}" no tiene RUC de 11 dígitos. SUNAT no aceptará los archivos.
          </span>
        </div>
      )}

      {/* Cards de descarga PLE */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12, marginBottom: 16 }}>
        {cards.map(c => (
          <div key={c.key} className="card card-p" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{
                width: 8, height: 28, background: c.color, borderRadius: 4
              }} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{c.titulo}</div>
                <div style={{ fontSize: 11, color: 'var(--tm)' }}>{c.formato}</div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--tm)' }}>{c.label}</div>
                <div style={{ fontWeight: 700, fontSize: 22, color: c.color }}>{c.registros}</div>
              </div>
              <button
                className="btn btn-amber"
                onClick={c.onDownload}
                disabled={busy || !!c.warning}
              >
                Descargar PLE (.txt)
              </button>
            </div>
            {c.warning && (
              <div style={{
                marginTop: 10, padding: 8,
                background: '#fee', border: '1px solid #f99', borderRadius: 6,
                color: '#a00', fontSize: 12
              }}>
                {c.warning}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Compras y Ventas ya no son PLE: desde 2025 van SOLO por el SIRE. */}
      <div className="card card-p" style={{ padding: 16, marginBottom: 16, borderLeft: '4px solid var(--orange)' }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Registro de Compras y Registro de Ventas</div>
        <div style={{ fontSize: 12, color: 'var(--tm)', marginTop: 4 }}>
          Desde 2025 SUNAT los recibe <strong>solo por el SIRE</strong> (RVIE y RCE): los .txt del PLE 8.1 y 14.1 ya no se aceptan.
          El archivo que sirve es el reemplazo de propuesta, que se genera desde el registro con «📦 Exportar a SIRE (.zip)»
          — {movsCompras.length} compras y {movsVentas.length} ventas en este período.
        </div>
        <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => setTab('registro')}>
          Ir al Registro de Compras y Ventas
        </button>
      </div>

      {/* Card PDT 601 — ARCHIVADA el 25-set-2026 (Gabriel, respuesta 14 de la
          revisión Ola 1: planillas con 0 filas, el PDT 601 nunca se generó).
          El generador sigue en sunat-pdt601.js; se vuelve a mostrar poniendo
          MOSTRAR_PDT601 en true cuando las planillas se usen. */}
      {MOSTRAR_PDT601 && <div className="card card-p" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <div style={{
            width: 8, height: 28, background: 'var(--amber)', borderRadius: 4
          }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>PDT 601 — Planilla Mensual</div>
            <div style={{ fontSize: 11, color: 'var(--tm)' }}>
              Formato txt importable a SUNAT Operaciones en Línea (PLAME).
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--tm)' }}>Trabajadores en planilla del período</div>
            <div style={{ fontWeight: 700, fontSize: 22, color: 'var(--amber)' }}>
              {planillaPeriodo?.total_trabajadores ?? '—'}
            </div>
          </div>
          <button
            className="btn btn-amber"
            onClick={handlePDT601}
            disabled={busy || !rucValid || !planillaPeriodo}
          >
            Descargar PDT 601 (.txt)
          </button>
        </div>
        {!planillaPeriodo && (
          <div style={{
            marginTop: 10, padding: 8,
            background: '#fee', border: '1px solid #f99', borderRadius: 6,
            color: '#a00', fontSize: 12
          }}>
            No existe una planilla cerrada para {MESES_LARGOS[mes - 1]} {anio}.
            Crea una en el módulo Planillas y asóciala a la empresa.
          </div>
        )}
        {planillaPeriodo && (
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--tm)' }}>
            Período: {MESES_LARGOS[mes - 1]} {anio} · Planilla: {planillaPeriodo.id?.slice(0, 8)} · Neto {fmtS(planillaPeriodo.total_neto)}
          </div>
        )}
      </div>}

      <div style={{ marginTop: 16, fontSize: 11, color: 'var(--tm)' }}>
        Estructura del Anexo 2 de SUNAT: 21 campos por línea, separados por «|» y terminados en «|», UTF-8 con CRLF.
        Los importes van en soles; el campo 20 lleva el CAR del comprobante en el RVIE/RCE. Lo que el validador
        rechazaría (descuadres, líneas sin cuenta) se avisa al descargar, fuera del archivo.
      </div>
      </>}
    </div>
  );
}

window.LibrosElectronicosPage = LibrosElectronicosPage;

export default LibrosElectronicosPage;
