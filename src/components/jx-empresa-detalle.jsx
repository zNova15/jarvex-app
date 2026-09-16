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
import { db } from "../db/jarvex.db";
import { extraerLineasDeFacturas } from "../lib/analisis-insumos.js";
import { resolverPares, construirGrupos, normInsumo } from "../lib/insumo-correlacion.js";
import {
  inventarioDeEmpresa, resumenFinancieroEmpresa, filtrarInventario, filtrarPorFlujo,
  saldosNegativos, tieneSaldoNegativo, aniosDeLineas, labelUnidad,
} from "../lib/inventario-empresa.js";
import { noInventariables } from "../lib/insumo-o-servicio.js";
import {
  activosPorLinea, esActivoDe, destinoParaInventario, llaveDestino, contarDestinos,
  DESTINOS, DESTINO_INFO, labelDestino, AMBITO_DESTINO,
} from "../lib/destino-inventario.js";
import {
  efectoEnInventario, construirTransformacion, validarTransformacion,
  costoUnitarioSugerido, disponibleDe, leerLineas, transformacionesDe,
  resumenTransformaciones, unidadDeLinea, REPARTOS, REPARTO_INFO,
} from "../lib/transformacion.js";
import { decidirCotejo } from "../lib/cotejo-sunat-db.js";
import { aprenderClasificacion } from "../lib/clasificar-items.js";
import { decidir } from "../lib/bandeja-categorizacion-db.js";
// Import ESTÁTICO (regla 1 del CLAUDE.md): viaja en el mismo chunk que esta
// pantalla, que es la única que lo usa.
import { PanelAnticipos } from "./jx-anticipos.jsx";
import { sociosDeObra } from "../lib/consorcio.js";
import { TIPO_LBL as TRABAJO_TIPO_LBL, ESTADO_LBL as TRABAJO_ESTADO_LBL, ESTADO_BADGE as TRABAJO_ESTADO_BADGE, esAbierto as trabajoAbierto } from "../lib/trabajos.js";
import { TIPOS_TRABAJO, TIPO_TRABAJO_DEFAULT, normalizarEstadoObra, ESTADO_OBRA_LBL, ESTADO_OBRA_BADGE } from "../lib/tipos-trabajo.js";
import { categoriaDe, CATEGORIA_LABEL, CATEGORIA_BADGE } from "../lib/personal-categoria.js";
import { DOCS_EMPRESA, documentosDeEmpresa, resumenDocsEmpresa, serializarMetaDoc } from "../lib/documentos-empresa.js";
import { getEvidenciaSrc, abrirUrlEvidencia } from "../lib/evidencias-url.js";
import { uploadPendingEvidencias } from "../sync/EvidenceUploader.js";
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
  // Entrar al trabajo SALE de la empresa (tanda 6): los dos ámbitos son
  // hermanos y excluyentes. Sin esto, el contexto de esta empresa quedaba
  // pegado y reaparecía al abrir cualquier pantalla contable general.
  limpiarEmpresaActiva();
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
  limpiarEmpresaActiva();   // mismo corte que irAObra: se entra al trabajo
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

// Navegar a Análisis de Insumos -> pestaña Correlaciones fijando la empresa activa.
const irACorrelacionesInsumos = (companyId) => {
  if (companyId) setEmpresaActivaId(companyId);
  window.__analisisInsumosIntent = { tab: 'correlaciones', companyId: companyId || null };
  window.__navTo?.('analisis-insumos', 'general');
};

const TIPO_BADGE = {
  material: 'b-blue', servicio: 'b-gray', epp: 'b-green',
  herramienta: 'b-amber', maquinaria: 'b-red',
  anticipo: 'b-purple', servicio_obra: 'b-indigo',
};

const PASO_LISTA = 50;   // insumos por tanda (GASOMI tiene cientos)

function EmpresaDetalle({ company, obrasEjecutora = [], obras = [], consorcios = [], consorcioSocios = [], trabajosBS = [], onVolver, seccionInicial = null }) {
  // ── Hooks: TODOS antes de cualquier return (regla crítica 3) ──────
  const movsHook = window.__hooks.useAccountingMovements(company?.id);
  // ── EL LIBRO DE AL LADO, SOLO PARA LEER EL PROPIO (tanda 2, 15-set-2026) ──
  // La compra espejo intercompany no trae sus ítems: los presta la VENTA de la
  // otra empresa del grupo (ver `extraerLineasDeFacturas`). Ese origen vive por
  // definición fuera de `movsHook`, que está filtrado por empresa — sin esta
  // segunda lectura la herencia no encontraría nunca de dónde leer, y las 98
  // compras espejo del grupo (S/ 2,32 M, 290 líneas) seguirían entrando al
  // inventario sin una sola línea de mercadería.
  // 🔴 Se usa SOLO como índice de orígenes. Todo lo que se muestra sigue
  // saliendo de `movs` —el libro de ESTA empresa— y el detalle heredado se
  // muestra marcado, nunca como si estuviera cargado en el comprobante.
  const movsGrupoHook = window.__hooks.useAccountingMovements();
  const corrHook = window.__hooks.useInsumoCorrelaciones();
  const personalHook = window.__hooks.usePersonal?.() || { data: [] };
  // Secciones nuevas del desglose (tanda 2E): los hooks ya aceptan company_id,
  // así que la vista se arma acá en vez de mandar al usuario a otra pantalla.
  const cuentasHook = window.__hooks.useCuentasBancarias?.(company?.id) || { data: [] };
  const cronogramaHook = window.__hooks.useCronogramaPagos?.(company?.id) || { data: [] };
  const activosHook = window.__hooks.useActivosPesados?.() || { data: [] };
  // Los papeles de la empresa (ficha RUC, vigencia de poder, testimonio, RNP).
  // Son evidencias SIN obra: se piden todas y se filtran por empresa en la lib.
  const evidenciasHook = window.__hooks.useEvidencias?.(null) || { data: [], refresh: null };
  // Anticipos a proveedores (mig 207): plata que ya salió y mercadería que
  // todavía no llegó. Ver `src/lib/anticipos.js` y el caso KOPLAST.
  const anticiposHook = window.__hooks.useAnticipoAplicaciones?.() || { data: [], refresh: null };
  const [moneda, setMoneda] = uSD('PEN');
  // `seccion` = null → las TARJETAS del desglose (como el Panel del trabajo).
  // Un id de sección → esa vista, con "volver al panel".
  const [seccion, setSeccion] = uSD(seccionInicial || null);
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

  const movsGrupo = movsGrupoHook.data || [];
  const lineas = uMD(
    () => extraerLineasDeFacturas(movs, { demo: esPrueba, origenes: movsGrupo }),
    [movs, movsGrupo, esPrueba]
  );
  // Las compras espejo cuyo detalle se leyó del otro libro: el resumen las
  // descuenta de «facturas sin detalle» para no decir dos cosas distintas
  // sobre el mismo comprobante (la tabla de abajo SÍ muestra sus líneas).
  const heredanDetalle = uMD(
    () => new Set(lineas.filter(l => l.heredadaDe).map(l => l.movId)),
    [lineas]
  );
  const resumen = uMD(
    () => resumenFinancieroEmpresa(movs, { companyId: company?.id, moneda, demo: esPrueba, heredanDetalle }),
    [movs, company?.id, moneda, esPrueba, heredanDetalle]
  );
  const resueltos = uMD(() => resolverPares(corrHook.data || [], { demo: esPrueba }), [corrHook.data, esPrueba]);
  const { grupoDe, grupos, factorDe } = uMD(() => construirGrupos(resueltos), [resueltos]);
  // ── Bloques temporales (Tanda 3) ─────────────────────────────────────
  // 'historico' = sin filtro | 'anio' = año completo | 'mes' = mes puntual
  const [periodoInv, setPeriodoInv] = uSD('historico');
  const [anioSel, setAnioSel] = uSD(() => new Date().getFullYear());
  const [mesSel, setMesSel] = uSD(() => new Date().getMonth() + 1); // 1-12

  // Años con facturas de ESTA empresa (excluye cancelados y demo como la lib)
  const aniosDisponibles = uMD(
    () => aniosDeLineas((lineas || []).filter(l => !l.cancelado && l.companyId === company?.id)),
    [lineas, company?.id]
  );

  // Rango ISO derivado del selector de período
  const { desde: desdePeriodo, hasta: hastaPeriodo } = uMD(() => {
    if (periodoInv === 'historico') return { desde: null, hasta: null };
    const anio = anioSel;
    if (periodoInv === 'anio') {
      return { desde: `${anio}-01-01`, hasta: `${anio}-12-31` };
    }
    // 'mes'
    // new Date(year, month, 0) devuelve el último día del mes anterior;
    // usando month = mesSel (1-12) obtenemos el último día de mesSel.
    const ultimoDia = new Date(anio, mesSel, 0).toISOString().slice(0, 10);
    const mm = String(mesSel).padStart(2, '0');
    return { desde: `${anio}-${mm}-01`, hasta: ultimoDia };
  }, [periodoInv, anioSel, mesSel]);

  const hayFiltroTemporal = periodoInv !== 'historico';

  // Lo que alguien marcó como «esto no es un insumo» desde Correlaciones
  // (tanda 3): un arbitraje, un seguro, una detracción. No es mercadería que
  // entre ni salga, así que no tiene cantidades que sumar. Ver
  // `insumo-o-servicio.js`.
  const decisHook = window.__hooks.useCotejoDecisiones();
  const descartadasInv = uMD(() => noInventariables(decisHook.data || []), [decisHook.data]);
  // ── TANDA 6: el hecho y la decisión ──────────────────────────────
  // El HECHO: qué líneas de factura ya están cargadas en el registro 7.1.
  // El vínculo existe desde que existe la tabla (`accounting_movement_id` +
  // `accounting_item_idx`, y los 12 activos de producción lo tienen); lo que
  // faltaba era que esta pantalla lo leyera.
  // La DECISIÓN: qué va a pasar con cada insumo. Ver `destino-inventario.js`.
  const afHook = window.__hooks.useActivosFijos?.(company?.id) || { data: [] };
  const activosLinea = uMD(() => activosPorLinea(afHook.data || []), [afHook.data]);
  const esActivo = uMD(() => esActivoDe(activosLinea), [activosLinea]);
  const destinoDe = uMD(() => destinoParaInventario(decisHook.data || []), [decisHook.data]);
  // ── TANDA 7: lo que entró de una forma y salió de otra ───────────
  // El cajón «🔁 Se transforma» de la tanda 6 apagaba el saldo y no había
  // manera de decir en qué se convirtió la mercadería. Con esto el saldo
  // vuelve a cerrar: comprado + producido − vendido − consumido.
  const transfHook = window.__hooks.useTransformaciones?.(company?.id) || { data: [], refresh: null };
  const transformadoDe = uMD(
    () => efectoEnInventario(transfHook.data || [], { companyId: company?.id }),
    [transfHook.data, company?.id]
  );
  const inv = uMD(
    () => inventarioDeEmpresa(lineas, {
      companyId: company?.id, grupoDe, grupos, factorDe,
      desde: desdePeriodo, hasta: hastaPeriodo,
      noInventariables: descartadasInv,
      esActivo, destinoDe, transformadoDe,
    }),
    [lineas, company?.id, grupoDe, grupos, factorDe, desdePeriodo, hastaPeriodo,
      descartadasInv, esActivo, destinoDe, transformadoDe]
  );
  // Para el modal: encontrar un insumo por cualquiera de sus nombres. Se indexa
  // por TODAS las variantes porque quien carga la transformación escribe el
  // nombre que tiene a mano, no el canónico del grupo.
  const insumoPorNorm = uMD(() => {
    const m = new Map();
    for (const i of inv.insumos) {
      for (const v of (i.variantes || [])) m.set(normInsumo(v), i);
      m.set(normInsumo(i.display), i);
    }
    return m;
  }, [inv]);
  const transformaciones = uMD(() => transformacionesDe(transfHook.data || [], company?.id), [transfHook.data, company?.id]);
  const resumenTransf = uMD(() => resumenTransformaciones(transfHook.data || [], company?.id), [transfHook.data, company?.id]);
  const [modalTransf, setModalTransf] = uSD(null);   // null | { entradaInicial }
  const [verTransf, setVerTransf] = uSD(false);
  const transfEnCursoRef = React.useRef(false);
  const tiposPresentes = uMD(() => {
    const s = new Set();
    inv.insumos.forEach(i => i.tipos.forEach(t => s.add(t)));
    return [...s].sort();
  }, [inv]);
  // ── LOS INSUMOS EN ROJO (tanda 9) ────────────────────────────────
  // Gabriel, 7-set-2026: facturar una orden sin tener el stock se puede, «pero
  // en el inventario de la empresa que emitió la factura se mostrará que tienen
  // un stock negativo». La columna Saldo ya pintaba el número en rojo; lo que
  // faltaba era poder VERLOS: entre 400 insumos, tres en rojo no se encuentran
  // scrolleando.
  const negativos = uMD(() => saldosNegativos(inv.insumos), [inv]);
  const [soloNegativos, setSoloNegativos] = uSD(false);
  // Los insumos cuya factura una nota de crédito rebajó EN PARTE (15-set).
  const rebajados = uMD(() => {
    const ins = inv.insumos.filter(i => (i.rebajadas || 0) > 0);
    return { insumos: ins, total: ins.length };
  }, [inv]);
  const [soloRebajados, setSoloRebajados] = uSD(false);
  // Tanda 6: '' | 'activos' | 'sin_decidir' | uno de DESTINOS
  const [destinoFiltro, setDestinoFiltro] = uSD('');
  const conteoDestinos = uMD(() => contarDestinos(inv.insumos), [inv]);
  const [flujoFiltro, setFlujoFiltro] = uSD('todos');
  const [modalCategorizar, setModalCategorizar] = uSD(null);

  const filtrados = uMD(() => {
    const porTexto = filtrarInventario(inv.insumos, busca);
    const porTipo = tipoFiltro ? porTexto.filter(i => i.tipos.includes(tipoFiltro)) : porTexto;
    const porFlujo = filtrarPorFlujo(porTipo, flujoFiltro);
    if (soloNegativos) return porFlujo.filter(tieneSaldoNegativo);
    if (soloRebajados) return porFlujo.filter(i => (i.rebajadas || 0) > 0);
    // Tanda 6: por destino, y 'activos' = lo que ya está en el registro 7.1
    // (el hecho), que no es lo mismo que «marcado como uso de la empresa».
    if (destinoFiltro === 'activos') return porFlujo.filter(i => (i.activosCargados || 0) > 0);
    if (destinoFiltro === 'sin_decidir') return porFlujo.filter(i => !i.destino);
    if (destinoFiltro) return porFlujo.filter(i => i.destino === destinoFiltro);
    return porFlujo;
  }, [inv, busca, tipoFiltro, flujoFiltro, soloNegativos, soloRebajados, destinoFiltro]);

  const guardarRecategorizacion = async (insumo, cat, subcat) => {
    const showToast = window.__showToast || (() => {});
    try {
      const database = window.__db || db;
      if (database?.accounting_movements && Array.isArray(insumo.lineas)) {
        for (const l of insumo.lineas) {
          if (!l.movId) continue;
          try {
            const mv = await database.accounting_movements.get(l.movId);
            if (mv) {
              let notas = mv.notas;
              if (typeof notas === 'string') {
                try { notas = JSON.parse(notas); } catch { notas = {}; }
              }
              if (notas && Array.isArray(notas.items_factura) && notas.items_factura[l.itemIdx]) {
                notas.items_factura[l.itemIdx].tipo_insumo = cat;
                notas.items_factura[l.itemIdx].categoria = cat;
                if (subcat) notas.items_factura[l.itemIdx].subcategoria = subcat;
                await database.accounting_movements.update(mv.id, {
                  notas: JSON.stringify(notas),
                  updated_at: new Date().toISOString(),
                });
              }
            }
          } catch (e) {
            console.warn('Error actualizando comprobante:', e);
          }
        }
      }
      try {
        await aprenderClasificacion({
          descripcion: insumo.display,
          categoria: cat,
          subcategoria: subcat,
          fuente: 'manual',
          userId: window.__currentUser?.id,
        });
        await decidir({
          norm: normInsumo(insumo.display),
          muestra: insumo.display,
          decision: 'catalogo',
          familia: cat,
          subfamilia: subcat || null,
          company_id: company?.id || null,
          fuente: 'manual',
        });
      } catch (e) {
        console.warn('Error aprendiendo clasificación:', e);
      }
      showToast('✓ Categoría actualizada y recordada en el catálogo', 'green');
    } catch (err) {
      console.error(err);
      showToast('Error al guardar categoría', 'red');
    }
  };

  const verNegativos = () => {
    setBusca('');
    setTipoFiltro('');
    setSoloNegativos(true);
    setTope(Math.max(PASO_LISTA, negativos.total));
  };

  const toggleNegativos = () => {
    if (soloNegativos) {
      setSoloNegativos(false);
      setTope(PASO_LISTA);
    } else {
      verNegativos();
    }
  };

  // ── QUÉ VA A PASAR CON ESTE INSUMO (tanda 6) ──────────────────────
  // Se guarda por DESCRIPCIÓN y no por línea: «los taladros son para uso de
  // la empresa» es una política sobre el insumo, y escribirla una vez por
  // cada factura de taladros sería pedirle a la contadora que conteste
  // cuarenta veces la misma pregunta. La compra puntual que se aparta de esa
  // política se distingue por el HECHO (queda cargada en el 7.1), no por acá.
  //
  // Se marca sobre TODAS las variantes del grupo: el insumo se muestra con el
  // nombre de un proveedor y puede volver a aparecer con el de otro.
  const guardarDestino = async (ins, destino) => {
    // 🔴 `window.__currentUserId`, NO `window.__useAuth()`. __useAuth ES el hook
    // de React: llamarlo desde un onChange —fuera de la fase de render— tira
    // "Invalid hook call" (ver useAuth.js y Sentry JARVEX-APP-D). Y como esta
    // línea vivía ANTES del try, el handler moría acá: sin escritura, sin toast,
    // el select volviendo solo a "— destino —". Medido el 16-set: la tanda 6
    // llevaba desde su deploy con CERO filas `destino_inv` en cotejo_decisiones.
    // El Provider espeja el id en window justo para los llamadores no-React.
    const userId = window.__currentUserId || null;
    const showToast = window.__showToast || (() => {});
    try {
      for (const v of (ins.variantes || [])) {
        await decidirCotejo({
          ambito: AMBITO_DESTINO,
          llave: llaveDestino(v),
          decision: destino,                 // null = deshacer, ya lo sabe decidirCotejo
          nota: String(ins.display || '').slice(0, 200),
          companyId: company?.id || null,
        }, userId);
      }
      showToast(destino
        ? `✓ «${String(ins.display).slice(0, 30)}» → ${labelDestino(destino)}`
        : '✓ Destino borrado', 'green');
    } catch (e) {
      showToast('Error: ' + (e.message || e), 'red');
    }
  };

  // ── REGISTRAR UNA TRANSFORMACIÓN (tanda 7) ────────────────────────
  // 🔴 La fila la arma `construirTransformacion` y nadie más: la mig 216 tiene
  // un CHECK sobre «lo que sale vale lo que entró más lo que costó
  // transformarlo» y Dexie no valida CHECKs (regla 9) — una fila armada acá a
  // mano que no cerrara quedaría rebotando en el push para siempre.
  //
  // El guard es un ref SÍNCRONO (regla 2): el guard por estado se activa recién
  // después del await a Dexie, y en esa ventana un segundo clic entra y
  // duplica. Acá duplicaría una transformación entera, con su valor.
  const guardarTransformacion = async (borrador) => {
    if (transfEnCursoRef.current) return false;
    transfEnCursoRef.current = true;
    const showToast = window.__showToast || (() => {});
    try {
      const { fila, error } = construirTransformacion({ ...borrador, companyId: company?.id });
      if (error) { showToast(error, 'red'); return false; }
      const userId = window.__currentUser?.id || null;
      const now = new Date().toISOString();
      const id = window.__newId();
      await (window.__db || db).transformaciones.add({
        id, ...fila,
        demo: false,
        created_by: userId, updated_by: userId,
        created_at: now, updated_at: now, deleted_at: null,
        version: 1, sync_status: 'pending_create', last_synced_at: null,
        idempotency_key: `${userId}_tr_${id}`,
      });
      try {
        await window.__logAudit?.({
          action: 'create', table: 'transformaciones', recordId: id,
          newData: { descripcion: fila.descripcion, valor_salidas: fila.valor_salidas },
          reason: `Transformación en ${company?.name || 'la empresa'}`,
        });
      } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'transformaciones' } })); } catch {}
      await transfHook.refresh?.();
      showToast('✓ Transformación registrada', 'green');
      return true;
    } catch (e) {
      showToast('Error al registrar: ' + (e.message || e), 'red');
      return false;
    } finally {
      transfEnCursoRef.current = false;
    }
  };

  // Anular no borra: la transformación deja de mover el saldo y se sigue
  // viendo. Es lo que hace falta cuando el corte se cargó mal hace un mes y ya
  // hay ventas contra esas láminas — borrarla dejaría el saldo sin explicación.
  const cambiarEstadoTransf = async (t, estado) => {
    const showToast = window.__showToast || (() => {});
    try {
      const userId = window.__currentUser?.id || null;
      await (window.__db || db).transformaciones.update(t.id, {
        estado,
        updated_at: new Date().toISOString(), updated_by: userId,
        version: (t.version ?? 0) + 1,
        sync_status: t.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'transformaciones' } })); } catch {}
      await transfHook.refresh?.();
      showToast(estado === 'anulada' ? '✓ Transformación anulada' : '✓ Transformación restablecida', 'green');
    } catch (e) {
      showToast('Error: ' + (e.message || e), 'red');
    }
  };

  // Lo mismo para las rebajadas por una nota de crédito parcial (15-set).
  const toggleRebajados = () => {
    if (soloRebajados) {
      setSoloRebajados(false);
      setTope(PASO_LISTA);
    } else {
      setBusca('');
      setTipoFiltro('');
      setSoloNegativos(false);        // los dos filtros a la vez no tienen sentido
      setSoloRebajados(true);
      setTope(Math.max(PASO_LISTA, rebajados.total));
    }
  };

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
    ficha: (() => {
      // La tarjeta dice cuántos papeles faltan: si no, hay que entrar para
      // enterarse de que el RNP venció.
      const rd = resumenDocsEmpresa(evidenciasHook.data || [], company.id,
        { hoy: (() => { try { return window.__fecha.hoyLocal(); } catch { return undefined; } })() });
      const base = company.ruc ? `RUC ${company.ruc}` : 'sin RUC cargado';
      if (rd.vencidos) return `${base} · ⚠ ${rd.vencidos} documento(s) VENCIDO(S)`;
      if (rd.porVencer) return `${base} · ${rd.porVencer} por vencer`;
      return `${base} · ${rd.cargados}/${rd.total} documentos`;
    })(),
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
        <FichaEmpresa company={company} obrasDeEmpresa={obrasDeEmpresa}
          evidencias={evidenciasHook.data || []} refreshEvidencias={evidenciasHook.refresh} />
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
        volvé a este panel («Volver a la empresa» en el cartel de arriba de cada una) y usá «Volver a Empresas».
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
      {/* ── Anticipos a proveedores ──────────────────────────────── */}
      <PanelAnticipos
        movs={movs}
        aplicaciones={anticiposHook.data || []}
        companyId={company?.id || null}
        demo={esPrueba}
        userId={window.__useAuth?.()?.profile?.id || null}
        onCambio={() => anticiposHook.refresh?.()}
      />

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

      {/* ── LA COMPRA A OTRA EMPRESA DEL GRUPO YA TRAE SU MERCADERÍA (tanda 2) ──
          El espejo intercompany se carga solo y SIN ítems, a propósito: si los
          trajera, el almacén del comprador contaría dos veces lo mismo. El
          detalle se lee de la venta de origen y se dice que es prestado. */}
      {inv.totales.lineasHeredadas > 0 && (
        <div className="card card-p" style={{ marginBottom: 10, borderLeft: '3px solid var(--purple)', fontSize: 11.5, color: 'var(--ts)' }}>
          <strong>Compras a otra empresa del grupo</strong> — <strong>{inv.totales.facturasHeredadas} factura(s)</strong>{' '}
          de esta empresa no tienen el detalle cargado en el comprobante (la compra espejo se crea sola y sin ítems,
          para que el almacén no cuente dos veces la misma mercadería). Sus <strong>{inv.totales.lineasHeredadas} línea(s)</strong>{' '}
          se leen de la venta del otro lado —el mismo comprobante, visto desde el libro de la empresa que lo emitió— y
          cuentan en este inventario como cualquier otra compra. En la lista salen con la chapita «↩ del otro libro».
          Si esa venta se anuló con una nota de crédito, sus líneas no cuentan acá tampoco.
        </div>
      )}
      {/* ── LO QUE LA NOTA DE CRÉDITO SE LLEVÓ (tanda 1, 15-set-2026) ──
          Gabriel: «si una factura se llega a anular con una nota de crédito,
          los insumos de dicha factura dejan de existir también en nuestro
          inventario». Ya no cuentan — y se dice, porque un saldo que baja sin
          explicación es un saldo que la contadora deja de creer. */}
      {/* ── LO QUE NO ES MERCADERÍA (tanda 3, 15-set) ────────────────
          Marcado a mano desde Correlaciones → «No va al inventario». */}
      {inv.totales.nombresNoInventariables > 0 && (
        <div className="card card-p" style={{ marginBottom: 10, borderLeft: '3px solid var(--tm)', fontSize: 11.5, color: 'var(--ts)' }}>
          <strong>No va al inventario</strong> — <strong>{inv.totales.nombresNoInventariables} descripción(es)</strong>{' '}
          ({inv.totales.lineasNoInventariables} línea(s)) están marcadas como algo que no es mercadería: arbitrajes,
          seguros, detracciones, penalidades, anticipos. Se siguen viendo en Movimientos y suman en los reportes
          contables; lo que no hacen es ocupar una fila de inventario con una cantidad que nadie puede recibir ni
          entregar. Se marcan y se deshacen desde <strong>Análisis de insumos → Correlaciones</strong>.
        </div>
      )}

      {(inv.totales.facturasAnuladas > 0 || inv.totales.lineasRebajadas > 0) && (
        <div className="card card-p" style={{ marginBottom: 10, borderLeft: '3px solid var(--amber)', fontSize: 11.5, color: 'var(--ts)' }}>
          <strong style={{ color: 'var(--amber)' }}>Notas de crédito aplicadas</strong>
          {inv.totales.facturasAnuladas > 0 && (
            <> — <strong>{inv.totales.facturasAnuladas} factura(s)</strong> quedaron anuladas por su nota de crédito:
            sus <strong>{inv.totales.lineasAnuladas} línea(s)</strong> ya no cuentan en el inventario, porque esa
            mercadería nunca entró.</>
          )}
          {inv.totales.lineasRebajadas > 0 && (
            <> {inv.totales.facturasAnuladas > 0 ? 'Además, ' : '— '}
            <strong>{inv.totales.lineasRebajadas} línea(s)</strong> vienen de facturas que una nota de crédito
            rebajó <strong>en parte</strong>: la compra sigue siendo real y se cuenta entera, así que la cantidad
            puede estar por encima de lo que finalmente quedó. Están marcadas con «NC parcial» en la lista.</>
          )}
        </div>
      )}

      <div className="card" style={{ overflow: 'hidden' }}>
        {/* ── Selector de período (Tanda 3) ─────────────────────────────
            Permite ver el inventario comprado en un período específico: el año
            completo, un mes puntual, o desde siempre (histórico). Los años que
            aparecen en el selector se derivan de las fechas de las facturas de
            esta empresa — nunca se hardcodean. */}
        <div style={{ display: 'flex', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-s)', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--tm)', fontWeight: 600 }}>Período:</span>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <button
              className={`btn btn-xs ${periodoInv === 'historico' ? 'btn-amber' : 'btn-ghost'}`}
              onClick={() => { setPeriodoInv('historico'); setTope(PASO_LISTA); }}
            >Desde siempre</button>
            <button
              className={`btn btn-xs ${periodoInv === 'anio' ? 'btn-amber' : 'btn-ghost'}`}
              onClick={() => { setPeriodoInv('anio'); setTope(PASO_LISTA); }}
            >Por año</button>
            <button
              className={`btn btn-xs ${periodoInv === 'mes' ? 'btn-amber' : 'btn-ghost'}`}
              onClick={() => { setPeriodoInv('mes'); setTope(PASO_LISTA); }}
            >Por mes</button>
          </div>
          {(periodoInv === 'anio' || periodoInv === 'mes') && (
            <select className="fi" style={{ width: 80 }} value={anioSel} onChange={e => { setAnioSel(Number(e.target.value)); setTope(PASO_LISTA); }}>
              {(aniosDisponibles.length > 0 ? aniosDisponibles : [new Date().getFullYear()]).map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          )}
          {periodoInv === 'mes' && (
            <select className="fi" style={{ width: 110 }} value={mesSel} onChange={e => { setMesSel(Number(e.target.value)); setTope(PASO_LISTA); }}>
              {['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'].map((nm, i) => (
                <option key={i + 1} value={i + 1}>{nm}</option>
              ))}
            </select>
          )}
          {hayFiltroTemporal && (
            <span style={{ fontSize: 10.5, color: 'var(--blue)', fontWeight: 600 }}>
              {periodoInv === 'anio' ? `Mostrando ${anioSel}` : `Mostrando ${['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][mesSel - 1]} ${anioSel}`}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: 10, borderBottom: '1px solid var(--border)' }}>

          <input
            className="fi" style={{ flex: 1, minWidth: 180 }}
            placeholder="Buscar insumo (sin tildes, busca también las variantes de nombre)"
            value={busca} onChange={e => { setBusca(e.target.value); setTope(PASO_LISTA); }} />
          <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--tm)', marginRight: 2 }}>Flujo:</span>
            {[
              { id: 'todos', lbl: 'Todos' },
              { id: 'solo_compras', lbl: 'Solo compras' },
              { id: 'solo_ventas', lbl: 'Solo ventas' },
              { id: 'ambos', lbl: 'Compra y venta' },
            ].map(f => (
              <button
                key={f.id}
                type="button"
                className={`btn btn-xs ${flujoFiltro === f.id ? 'btn-blue' : 'btn-ghost'}`}
                onClick={() => { setFlujoFiltro(f.id); setTope(PASO_LISTA); }}
              >
                {f.lbl}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <button className={`btn btn-xs ${tipoFiltro === '' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTipoFiltro('')}>Todos</button>
            {tiposPresentes.map(t => (
              <button key={t} className={`btn btn-xs ${tipoFiltro === t ? 'btn-amber' : 'btn-ghost'}`} onClick={() => { setTipoFiltro(t); setTope(PASO_LISTA); }}>{t}</button>
            ))}
          </div>
          {/* EL BOTÓN ROJO: entre 400 insumos, tres en rojo no se encuentran
              scrolleando. Solo aparece si hay alguno — un filtro que siempre
              devuelve cero es ruido. */}
          {negativos.total > 0 && (
            <button className={`btn btn-xs ${soloNegativos ? 'btn-red' : 'btn-ghost'}`}
              onClick={toggleNegativos}
              title="Vendió más de lo que compró: puede ser que la compra todavía no esté cargada, que esté en otra empresa del grupo, o que esté escrita con otro nombre">
              {soloNegativos ? 'ver todos' : `${negativos.total} en rojo`}
            </button>
          )}
          {/* ── EL MISMO PROBLEMA CON LAS «NC PARCIAL» (15-set, tarde) ──
              Gabriel, probando la tanda 1: «en inventario no pude percibir
              ningún insumo con la notita de nota de crédito parcial». No era
              un error: en TODA la base hay UNA sola factura rebajada en parte
              (GASOMI E001-275, S/ 38.500 con una nota de S/ 690) y sus cinco
              ítems estaban perdidos entre cientos de filas. Misma solución
              que el botón rojo: un filtro que solo existe si hay algo. */}
          {/* ── TANDA 6: filtrar por qué va a pasar con cada insumo ────
              «Activos fijos» son los que YA están en el 7.1 (un hecho, sale
              del vínculo de la tabla). Los demás son la decisión que alguien
              tomó en el selector de cada fila. */}
          {(conteoDestinos.activos_cargados > 0
            || DESTINOS.some(d => conteoDestinos[d] > 0)) && (
            <select className="fi" style={{ width: 'auto', fontSize: 11 }}
              value={destinoFiltro}
              onChange={e => { setDestinoFiltro(e.target.value); setSoloNegativos(false); setSoloRebajados(false); setTope(PASO_LISTA); }}>
              <option value="">Todo destino</option>
              {conteoDestinos.activos_cargados > 0 && (
                <option value="activos">🏗 En el registro 7.1 ({conteoDestinos.activos_cargados})</option>
              )}
              {DESTINOS.filter(d => conteoDestinos[d] > 0).map(d => (
                <option key={d} value={d}>{DESTINO_INFO[d].icono} {labelDestino(d)} ({conteoDestinos[d]})</option>
              ))}
            </select>
          )}
          {rebajados.total > 0 && (
            <button className={`btn btn-xs ${soloRebajados ? 'btn-amber' : 'btn-ghost'}`}
              onClick={toggleRebajados}
              title="Una nota de crédito rebajó en PARTE la factura de estas líneas: la compra sigue siendo real y se cuenta entera, así que la cantidad puede estar por encima de lo que finalmente quedó">
              {soloRebajados ? 'ver todos' : `${rebajados.total} con NC parcial`}
            </button>
          )}
          <button
            className="btn btn-xs btn-ghost"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            onClick={() => irACorrelacionesInsumos(company?.id)}
            title="Abrir Análisis de Insumos para resolver nombres duplicados o equivalencias"
          >
            🤝 Correlaciones
          </button>
          {/* ── TANDA 7: lo que entra de una forma y sale de otra ──────
              El botón está siempre (una transformación puede ser el primer
              registro de esta empresa); el contador solo aparece si hay algo
              que contar, como el resto de los filtros de esta barra. */}
          <button
            className="btn btn-xs btn-ghost"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            onClick={() => setModalTransf({ entradaInicial: null })}
            title="Registrar que unos insumos se convirtieron en otros: entran planchas, salen láminas. El valor de lo que entra (más lo que costó transformarlo) pasa a lo que sale."
          >
            🔁 Transformar
          </button>
          {(resumenTransf.registradas > 0 || resumenTransf.anuladas > 0) && (
            <button
              className={`btn btn-xs ${verTransf ? 'btn-amber' : 'btn-ghost'}`}
              onClick={() => setVerTransf(v => !v)}
              title="Ver las transformaciones registradas en esta empresa"
            >
              {verTransf ? 'ocultar' : `${resumenTransf.registradas} transformación(es)`}
            </button>
          )}
          <span style={{ fontSize: 11, color: 'var(--tm)' }}>{filtrados.length} insumo(s)</span>
        </div>

        {/* ── LAS TRANSFORMACIONES REGISTRADAS (tanda 7) ─────────────
            Cada una dice qué entró, qué costó transformarlo y qué salió. Las
            tres columnas tienen que cerrar: es la única razón por la que este
            registro sirve. Una anulada se sigue viendo —tachada— porque un
            saldo que cambia sin dejar rastro es un saldo que nadie cree. */}
        {verTransf && (
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--tint-neutral)' }}>
            <div style={{ fontSize: 11.5, color: 'var(--ts)', marginBottom: 8 }}>
              <strong>🔁 Lo que entró de una forma y salió de otra</strong> — {resumenTransf.registradas} registrada(s)
              {resumenTransf.anuladas > 0 && <> · {resumenTransf.anuladas} anulada(s)</>}
              {resumenTransf.costos > 0 && <> · {fmtMonto(resumenTransf.costos, 'PEN')} en costos de transformación</>}
              . El valor de lo que entra, más lo que costó transformarlo, es exactamente lo que vale lo que sale.
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr>
                  <th>Fecha</th>
                  <th>Entra</th>
                  <th>Sale</th>
                  <th style={{ textAlign: 'right' }}>Valor</th>
                  <th style={{ textAlign: 'center' }}>—</th>
                </tr></thead>
                <tbody>
                  {transformaciones.map(t => {
                    const anulada = t.estado === 'anulada';
                    const ent = leerLineas(t.entradas), sal = leerLineas(t.salidas), cos = leerLineas(t.costos);
                    return (
                      <tr key={t.id} style={anulada ? { opacity: 0.55 } : undefined}>
                        <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                          {fmtFecha(t.fecha)}
                          {anulada && <div><span className="badge b-red" style={{ fontSize: 9 }}>anulada</span></div>}
                          {t.descripcion && <div style={{ color: 'var(--tm)', fontSize: 10 }}>{t.descripcion}</div>}
                        </td>
                        <td style={{ fontSize: 11 }}>
                          {ent.map((l, i) => (
                            <div key={i}>{fmtCant(l.cantidad)} <span style={{ color: 'var(--tm)', fontSize: 10 }}>{unidadDeLinea(l.unidad)}</span> {l.nombre}</div>
                          ))}
                          {cos.map((c, i) => (
                            <div key={`c${i}`} style={{ color: 'var(--amber)', fontSize: 10 }}>+ {c.concepto}: {fmtMonto(c.monto, t.moneda || 'PEN')}</div>
                          ))}
                        </td>
                        <td style={{ fontSize: 11 }}>
                          {sal.map((l, i) => (
                            <div key={i}>
                              {fmtCant(l.cantidad)} <span style={{ color: 'var(--tm)', fontSize: 10 }}>{unidadDeLinea(l.unidad)}</span> {l.nombre}
                              <span style={{ color: 'var(--tm)', fontSize: 10 }}> · {fmtMonto(l.valor, t.moneda || 'PEN')}</span>
                            </div>
                          ))}
                        </td>
                        <td style={{ textAlign: 'right' }} className="col-num">
                          <div style={{ fontWeight: 600, fontSize: 11 }}>{fmtMonto(t.valor_salidas, t.moneda || 'PEN')}</div>
                          <div style={{ fontSize: 10, color: 'var(--tm)' }}>
                            {fmtMonto(t.valor_entradas, t.moneda || 'PEN')}
                            {Number(t.valor_costos) > 0 && <> + {fmtMonto(t.valor_costos, t.moneda || 'PEN')}</>}
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            className="btn btn-xs btn-ghost"
                            style={{ color: anulada ? 'var(--green)' : 'var(--red)' }}
                            onClick={() => cambiarEstadoTransf(t, anulada ? 'registrada' : 'anulada')}
                            title={anulada
                              ? 'Volver a contarla en el saldo'
                              : 'Dejar de contarla en el saldo. No se borra: se sigue viendo acá.'}
                          >
                            {anulada ? 'Restablecer' : 'Anular'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Un saldo negativo no es un error de la app: es un hecho que hay que
            ver. Tres causas, todas reales — se facturó lo que no se compró
            todavía, la compra está en otra empresa del grupo, o está escrita con
            otro nombre y sin mapear. Redondear a cero taparía las tres. */}
        {negativos.total > 0 && (
          <div
            style={{
              padding: '10px 14px',
              borderBottom: '1px solid var(--border)',
              fontSize: 11.5,
              color: 'var(--ts)',
              lineHeight: 1.5,
              background: soloNegativos ? 'rgba(231, 76, 60, 0.08)' : 'var(--tint-neutral)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div
              onClick={toggleNegativos}
              style={{ cursor: 'pointer', flex: 1, minWidth: 260 }}
              title="Clic para filtrar u ocultar los insumos con saldo negativo"
            >
              <b style={{ color: 'var(--red)' }}>
                {negativos.total} insumo(s) con saldo negativo
              </b>
              {soloNegativos ? (
                <span> — <strong>Filtrando en página 1</strong> (clic aquí para ver todo el inventario).</span>
              ) : (
                <span>
                  {' '}— esta empresa facturó más de lo que tiene comprado.{hayFiltroTemporal ? (
                    <> <strong style={{ color: 'var(--amber)' }}>⚠ Estás viendo un período acotado</strong>: si la compra que respalda la venta está en otro mes o año, va a aparecer como negativo aquí aunque en el histórico esté cuadrado. Revisá en «Desde siempre» para confirmar si es un real descuadre o solo un desfase de período.</>
                  ) : (
                    <> Suele pasar cuando se emite una factura contra una orden sin tener el stock: la compra que la respalda todavía no está cargada, está en otra empresa del grupo, o está escrita con otro nombre y sin mapear.</>
                  )}{' '}
                  <span style={{ color: 'var(--blue)', textDecoration: 'underline', fontWeight: 600, marginLeft: 4 }}>
                    👉 Clic aquí para verlos de inmediato
                  </span>
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                className={`btn btn-xs ${soloNegativos ? 'btn-ghost' : 'btn-red'}`}
                onClick={toggleNegativos}
              >
                {soloNegativos ? 'Ver todos' : `Ver los ${negativos.total} negativos`}
              </button>
              <button
                className="btn btn-xs btn-amber"
                onClick={() => irACorrelacionesInsumos(company?.id)}
                title="Abrir el análisis de correlaciones de insumos para corregir nombres duplicados o equivalencias"
              >
                🤝 Correlaciones de insumos
              </button>
            </div>
          </div>
        )}

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
                <th>Insumo / Categoría</th>
                <th style={{ textAlign: 'right' }}>Compras</th>
                <th style={{ textAlign: 'right' }}>Ventas</th>
                <th style={{ textAlign: 'right' }}>Saldo físico</th>
                <th style={{ textAlign: 'right' }}>Margen econ.</th>
                <th>Última operación</th>
                <th style={{ textAlign: 'center' }}>Facturas</th>
              </tr></thead>
              <tbody>
                {filtrados.slice(0, tope).map(ins => {
                  const abiertoEste = abierto === ins.clave;
                  return (
                    <React.Fragment key={ins.clave}>
                      <tr>
                        <td className="col-p">
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                            <strong>{ins.display}</strong>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              style={{ fontSize: 10, padding: '1px 5px', color: 'var(--blue)', whiteSpace: 'nowrap' }}
                              title="Re-categorizar este insumo y guardar en catálogo"
                              onClick={() => setModalCategorizar({
                                insumo: ins,
                                categoria: (ins.tipos && ins.tipos[0]) || 'materiales',
                                subcategoria: '',
                                guardando: false,
                              })}
                            >
                              🏷 Categorizar
                            </button>
                            {/* ── TANDA 7 ──────────────────────────────
                                Arranca el modal con este insumo ya puesto como
                                entrada y su costo unitario propuesto: nadie
                                abre «transformar» sin saber qué va a
                                transformar, y hacerlo elegir de nuevo entre
                                cientos de nombres es pedirle que repita lo que
                                acaba de decir con el clic. */}
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              style={{ fontSize: 10, padding: '1px 5px', color: 'var(--amber)', whiteSpace: 'nowrap' }}
                              title="Este insumo se convirtió en otro: registrar qué salió de él y con qué valor"
                              onClick={() => setModalTransf({ entradaInicial: ins })}
                            >
                              🔁 Transformar
                            </button>
                            {/* ── QUÉ VA A PASAR CON ESTE INSUMO (tanda 6) ──
                                Gabriel: «se sabe qué insumo se utilizarán
                                dentro de la empresa y no se venderán, para que
                                se muestre de esta manera en nuestro
                                inventario». Cuatro cajones, los mismos que el
                                recomendador de activos — no un vocabulario
                                nuevo. Vacío es lo normal y no hace falta
                                marcarlo: la mayoría se consume. */}
                            <select
                              className="fi"
                              style={{ width: 'auto', fontSize: 10, padding: '1px 4px' }}
                              value={ins.destino || ''}
                              title="Qué va a pasar con este insumo. Cambia si su saldo significa «lo que queda por vender» o es otra cosa."
                              onChange={e => guardarDestino(ins, e.target.value || null)}
                            >
                              <option value="">— destino —</option>
                              {DESTINOS.map(d => (
                                <option key={d} value={d}>{DESTINO_INFO[d].icono} {labelDestino(d)}</option>
                              ))}
                            </select>
                          </div>
                          <div style={{ marginTop: 2, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                            {ins.tipos.map(t => (
                              <span key={t} className={`badge ${TIPO_BADGE[t] || 'b-gray'}`} style={{ fontSize: 9 }}>{t}</span>
                            ))}
                            {ins.esAnticipo && (
                              <span className="badge b-purple" style={{ fontSize: 9 }} title="Este ítem es un anticipo a proveedores / contratistas (activo exigible)">
                                anticipo
                              </span>
                            )}
                            {ins.variantes.length > 1 && (
                              <span style={{ fontSize: 10, color: 'var(--tm)' }} title={ins.variantes.join('\n')}>
                                {ins.variantes.length} variantes
                              </span>
                            )}
                            {ins.recepcion.conDato > 0 && (
                              <span className="badge b-green" style={{ fontSize: 9 }} title="Almacén confirmó recepción de estas líneas">
                                ✓ {fmtCant(ins.recepcion.recibido)} recibido
                              </span>
                            )}
                            {tieneSaldoNegativo(ins) && (
                              <span className="badge b-red" style={{ fontSize: 9 }} title="Vendió más de lo que compró: falta cargar la compra, está en otra empresa del grupo, o está escrita con otro nombre">
                                stock negativo
                              </span>
                            )}
                            {/* ── TANDA 6: el HECHO y la DECISIÓN ────────
                                El badge 🏗 sale del registro 7.1, no de una
                                opinión: hay una fila en `activos_fijos`
                                apuntando a esa línea de esa factura. */}
                            {ins.activosCargados > 0 && (
                              <span className="badge b-blue" style={{ fontSize: 9 }}
                                title={`${ins.activosCargados} de sus compras ya están cargadas en el registro de activos fijos (formato 7.1). No son mercadería para vender.`}>
                                🏗 activo fijo ({ins.activosCargados})
                              </span>
                            )}
                            {ins.destino && DESTINO_INFO[ins.destino] && (
                              <span className={`badge ${DESTINO_INFO[ins.destino].badge}`} style={{ fontSize: 9 }}
                                title={DESTINO_INFO[ins.destino].ayuda}>
                                {DESTINO_INFO[ins.destino].icono} {labelDestino(ins.destino)}
                              </span>
                            )}
                            {/* ── TANDA 7: qué se transformó ────────────
                                Dos hechos distintos y los dos sacados del
                                registro, no de una opinión: cuánto de este
                                insumo se consumió transformándolo, y cuánto de
                                este insumo salió de transformar otra cosa. */}
                            {ins.transformado?.vecesConsumido > 0 && (
                              <span className="badge b-amber" style={{ fontSize: 9 }}
                                title={`Se transformó en otra cosa: ${ins.transformado.consumido.map(c => `${fmtCant(c.cantidad)} ${c.label}`).join(' · ')} por ${fmtMonto(ins.transformado.valorConsumido, 'PEN')}. Ese valor ya no está acá: se fue a lo que salió.`}>
                                🔁 transformado ({ins.transformado.vecesConsumido})
                              </span>
                            )}
                            {ins.transformado?.vecesProducido > 0 && (
                              <span className="badge b-green" style={{ fontSize: 9 }}
                                title={`Salió de transformar otro insumo: ${ins.transformado.producido.map(p => `${fmtCant(p.cantidad)} ${p.label}`).join(' · ')} por ${fmtMonto(ins.transformado.valorProducido, 'PEN')}, que es lo que valía lo que entró más lo que costó transformarlo.`}>
                                ✨ producido ({ins.transformado.vecesProducido})
                              </span>
                            )}
                            {ins.origen === 'transformacion' && (
                              <span className="badge b-gray" style={{ fontSize: 9 }}
                                title="Este insumo no tiene ni una factura detrás: existe porque salió de una transformación. Si algún día se compra con este nombre, las dos cosas van a caer en esta misma fila.">
                                sin factura propia
                              </span>
                            )}
                            {(ins.comprado.convertidas + ins.vendido.convertidas) > 0 && (
                              <span className="badge b-blue" style={{ fontSize: 9 }}
                                title="Este insumo se factura en más de una presentación y alguien declaró cómo se convierten: las cantidades están sumadas en una sola unidad">
                                📏 convertido
                              </span>
                            )}
                            {ins.rebajadas > 0 && (
                              <span className="badge b-amber" style={{ fontSize: 9 }} title="Una nota de crédito rebajó en PARTE la factura de estas líneas. La compra sigue siendo real y se cuenta entera, así que la cantidad puede estar por encima de lo que quedó.">
                                NC parcial ({ins.rebajadas})
                              </span>
                            )}
                            {ins.heredadas > 0 && (
                              <span className="badge b-purple" style={{ fontSize: 9 }}
                                title="Estas líneas llegaron por una COMPRA a otra empresa del grupo. Esa factura espejo se carga sola y sin detalle (si lo trajera, el almacén contaría dos veces lo mismo), así que el detalle se lee de la venta del otro lado: mismo comprobante, misma mercadería, leída desde el libro que sí la tiene cargada.">
                                ↩ del otro libro ({ins.heredadas})
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }} className="col-num">
                          {ins.comprado.veces === 0 ? <span style={{ color: 'var(--tm)' }}>—</span> : (<>
                            {ins.comprado.cantidades.map(c => (
                              <div key={c.unidad}>{fmtCant(c.cantidad)} <span style={{ color: 'var(--tm)', fontSize: 10.5 }}>{c.label}</span></div>
                            ))}
                            <div style={{ fontWeight: 600, fontSize: 11, color: 'var(--ts)' }}>
                              {fmtMonto(ins.totalCompraPen, 'PEN')}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--tm)' }}>
                              {ins.comprado.veces} compra{ins.comprado.veces !== 1 ? 's' : ''}
                              {ins.comprado.interco > 0 ? ` · ${ins.comprado.interco} interco` : ''}
                            </div>
                          </>)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="col-num">
                          {ins.vendido.veces === 0 ? <span style={{ color: 'var(--tm)' }}>—</span> : (<>
                            {ins.vendido.cantidades.map(c => (
                              <div key={c.unidad}>{fmtCant(c.cantidad)} <span style={{ color: 'var(--tm)', fontSize: 10.5 }}>{c.label}</span></div>
                            ))}
                            <div style={{ fontWeight: 600, fontSize: 11, color: 'var(--green)' }}>
                              {fmtMonto(ins.totalVentaPen, 'PEN')}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--tm)' }}>
                              {ins.vendido.veces} venta{ins.vendido.veces !== 1 ? 's' : ''}
                              {ins.vendido.interco > 0 ? ` · ${ins.vendido.interco} interco` : ''}
                            </div>
                          </>)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="col-num">
                          {ins.saldo.length === 0
                            ? <span style={{ color: 'var(--tm)' }} title="Esta empresa no vendió este insumo: el saldo físico coincide con lo comprado">—</span>
                            : ins.saldo.map(s => (
                              <div key={s.unidad} style={{ color: s.cantidad < 0 ? 'var(--red)' : 'var(--ts)', fontWeight: s.cantidad < 0 ? 600 : 400 }}>
                                {fmtCant(s.cantidad)} <span style={{ color: 'var(--tm)', fontSize: 10.5 }}>{s.label}</span>
                              </div>
                            ))}
                          {/* Con una transformación de por medio el saldo deja
                              de ser «comprado − vendido» y hay que decirlo: un
                              número que no se puede rehacer a mano es un número
                              que la contadora deja de mirar. */}
                          {ins.transformado && ins.saldo.length > 0 && (
                            <div style={{ fontSize: 9.5, color: 'var(--tm)', lineHeight: 1.3 }}>
                              {ins.transformado.consumido.map(c => `−${fmtCant(c.cantidad)} ${c.label} transf.`).join(' ')}
                              {ins.transformado.producido.map(p => ` +${fmtCant(p.cantidad)} ${p.label} prod.`).join('')}
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }} className="col-num">
                          {ins.margenEconomicoPen != null ? (
                            <>
                              <div style={{ fontWeight: 600, fontSize: 11.5, color: ins.margenEconomicoPen >= 0 ? 'var(--green)' : 'var(--red)' }}>
                                {ins.margenEconomicoPen >= 0 ? '+' : ''}{fmtMonto(ins.margenEconomicoPen, 'PEN')}
                              </div>
                              {ins.margenPct != null && (
                                <div style={{ fontSize: 10, fontWeight: 500, color: ins.margenPct >= 0 ? 'var(--green)' : 'var(--red)' }}>
                                  {ins.margenPct >= 0 ? '+' : ''}{ins.margenPct.toFixed(1)}%
                                </div>
                              )}
                            </>
                          ) : ins.comprado.veces > 0 && ins.vendido.veces === 0 ? (
                            <span style={{ fontSize: 10.5, color: 'var(--tm)' }} title="Insumo solo comprado">Solo compra</span>
                          ) : ins.vendido.veces > 0 && ins.comprado.veces === 0 ? (
                            <span style={{ fontSize: 10.5, color: 'var(--amber)' }} title="Insumo facturado sin compra registrada">Solo venta</span>
                          ) : (
                            <span style={{ color: 'var(--tm)' }}>—</span>
                          )}
                        </td>
                        <td style={{ fontSize: 11 }}>
                          {ins.comprado.ultimaFecha ? (
                            <div>
                              <div>{fmtFecha(ins.comprado.ultimaFecha)} <span style={{ color: 'var(--tm)', fontSize: 10 }}>compra</span></div>
                              {ins.comprado.ultimoPrecio != null && (
                                <div style={{ color: 'var(--tm)', fontSize: 10 }}>
                                  {fmtMonto(ins.comprado.ultimoPrecio, ins.comprado.ultimaMoneda || 'PEN')} · {ins.comprado.ultimoProveedor || 's/ prov.'}
                                </div>
                              )}
                            </div>
                          ) : ins.vendido.ultimaFecha ? (
                            <div>
                              <div>{fmtFecha(ins.vendido.ultimaFecha)} <span style={{ color: 'var(--green)', fontSize: 10 }}>venta</span></div>
                              {ins.vendido.ultimoPrecio != null && (
                                <div style={{ color: 'var(--tm)', fontSize: 10 }}>
                                  {fmtMonto(ins.vendido.ultimoPrecio, ins.vendido.ultimaMoneda || 'PEN')} · {ins.vendido.ultimoCliente || 's/ cliente'}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: 'var(--tm)' }}>—</span>
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

        {modalCategorizar && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
            <div className="card" style={{ width: '100%', maxWidth: 440, padding: 20, background: 'var(--bg-c)', borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,0.3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Categorizar Insumo</h4>
                <button className="btn btn-ghost btn-xs" onClick={() => setModalCategorizar(null)}>✕</button>
              </div>
              <div style={{ fontSize: 12, marginBottom: 12, padding: 8, background: 'var(--tint-neutral)', borderRadius: 6 }}>
                <strong>Insumo:</strong> {modalCategorizar.insumo.display}
                {modalCategorizar.insumo.variantes?.length > 1 && (
                  <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 4 }}>
                    Aplica a {modalCategorizar.insumo.variantes.length} variantes de nombre
                  </div>
                )}
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, marginBottom: 4 }}>Categoría principal:</label>
                <select
                  className="fi" style={{ width: '100%' }}
                  value={modalCategorizar.categoria}
                  onChange={e => setModalCategorizar({ ...modalCategorizar, categoria: e.target.value })}
                >
                  <option value="materiales">Materiales de construcción</option>
                  <option value="servicios">Servicios (alquiler, fletes, consultoría...)</option>
                  <option value="herramientas">Herramientas</option>
                  <option value="maquinaria">Maquinaria y equipos</option>
                  <option value="epp">EPP e Implementos de Seguridad</option>
                  <option value="anticipo">Anticipos a proveedores / contratistas</option>
                  <option value="gastos_generales">Gastos generales</option>
                  <option value="otros">Otros</option>
                </select>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, marginBottom: 4 }}>Subcategoría / Subfamilia (opcional):</label>
                <input
                  className="fi" style={{ width: '100%' }}
                  placeholder="ej. fierro, cemento, flete de transporte, alquiler..."
                  value={modalCategorizar.subcategoria}
                  onChange={e => setModalCategorizar({ ...modalCategorizar, subcategoria: e.target.value })}
                />
                <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 4 }}>
                  El sistema recordará esta categorización para futuras compras y para las demás empresas.
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={modalCategorizar.guardando}
                  onClick={() => setModalCategorizar(null)}
                >
                  Cancelar
                </button>
                <button
                  className="btn btn-blue btn-sm"
                  disabled={modalCategorizar.guardando}
                  onClick={async () => {
                    setModalCategorizar(prev => ({ ...prev, guardando: true }));
                    await guardarRecategorizacion(modalCategorizar.insumo, modalCategorizar.categoria, modalCategorizar.subcategoria);
                    setModalCategorizar(null);
                  }}
                >
                  {modalCategorizar.guardando ? 'Guardando...' : 'Guardar y recordar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {modalTransf && (
          <ModalTransformar
            company={company}
            insumos={inv.insumos}
            insumoPorNorm={insumoPorNorm}
            entradaInicial={modalTransf.entradaInicial}
            onCerrar={() => setModalTransf(null)}
            onGuardar={async (borrador) => {
              const ok = await guardarTransformacion(borrador);
              if (ok) { setModalTransf(null); setVerTransf(true); }
              return ok;
            }}
          />
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
// ═══════════════════════════════════════════════════════════════════
// MODAL: LO QUE ENTRA DE UNA FORMA Y SALE DE OTRA (tanda 7, 15-set-2026)
//
// Gabriel: «podría […] ser parte de uso de la empresa para transformarla en
// otro insumo (planchas metálicas por ejemplo a láminas más pequeñas)».
//
// La pantalla entera está organizada alrededor de UNA cuenta que tiene que
// cerrar y que se ve todo el tiempo, arriba del botón de guardar:
//
//     lo que entra  +  lo que costó transformarlo  =  lo que sale
//
// Por eso el total vive en una franja fija y no al final de un scroll: si la
// cuenta no cierra hay que enterarse antes de terminar de cargar, no después.
// El botón de guardar queda apagado hasta que cierre, y el motivo se dice con
// todas las letras («faltan S/ 50,00»), nunca como un genérico «revisá los
// datos».
// ═══════════════════════════════════════════════════════════════════
function ModalTransformar({ company, insumos = [], insumoPorNorm, entradaInicial = null, onCerrar, onGuardar }) {
  const lineaVacia = () => ({ nombre: '', cantidad: '', unidad: 'und', valor: '' });

  // Si se entró desde la fila de un insumo, ya viene puesto como entrada con su
  // costo propuesto: la pregunta «¿qué transformo?» ya la contestó el clic.
  const entradaDesde = (ins) => {
    if (!ins) return lineaVacia();
    const unidad = (ins.comprado?.cantidades?.[0]?.unidad) || (ins.saldo?.[0]?.unidad) || 'und';
    return { nombre: ins.display, cantidad: '', unidad, valor: '' };
  };

  const [fecha, setFecha] = uSD(() => (window.__fecha?.hoyLocal?.() || new Date().toISOString().slice(0, 10)));
  const [descripcion, setDescripcion] = uSD('');
  const [entradas, setEntradas] = uSD(() => [entradaDesde(entradaInicial)]);
  const [costos, setCostos] = uSD([]);
  const [salidas, setSalidas] = uSD(() => [lineaVacia()]);
  const [reparto, setReparto] = uSD('cantidad');
  const [guardando, setGuardando] = uSD(false);

  const nombresConocidos = uMD(() => insumos.map(i => i.display).slice(0, 400), [insumos]);
  const insumoDe = (nombre) => (insumoPorNorm ? insumoPorNorm.get(normInsumo(nombre || '')) : null);

  // El costo unitario PROPUESTO, y de dónde sale. Cuando no se puede derivar
  // —dos monedas, otra unidad, sin compras— no se propone nada: un número
  // inventado acá se aceptaría sin mirar y se propagaría a todo lo que salga.
  const sugerenciaDe = (l) => {
    const ins = insumoDe(l.nombre);
    if (!ins) return null;
    return costoUnitarioSugerido(ins, l.unidad);
  };

  const setLinea = (setter, i, campo, valor) =>
    setter(prev => prev.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)));

  // Al escribir la cantidad de una entrada, se completa el valor con el costo
  // propuesto — pero solo si el campo está vacío: lo que una persona escribió a
  // mano no se pisa nunca.
  const cantidadDeEntrada = (i, valor) => {
    setEntradas(prev => prev.map((l, j) => {
      if (j !== i) return l;
      const nueva = { ...l, cantidad: valor };
      if (!String(l.valor || '').trim()) {
        const s = sugerenciaDe(nueva);
        if (s && Number(valor) > 0) nueva.valor = String(Math.round(s.costo * Number(valor) * 100) / 100);
      }
      return nueva;
    }));
  };

  const borrador = {
    companyId: company?.id, fecha, descripcion,
    entradas: entradas.map(l => ({ ...l, cantidad: Number(l.cantidad) || 0, valor: Number(l.valor) || 0 })),
    costos: costos.map(c => ({ ...c, monto: Number(c.monto) || 0 })),
    salidas: salidas.map(l => ({ ...l, cantidad: Number(l.cantidad) || 0, valor: Number(l.valor) || 0 })),
    reparto,
  };
  const { errores, avisos, ok } = validarTransformacion(borrador, { insumoPorNorm });
  const armada = construirTransformacion(borrador);
  const valorEntradas = armada.fila ? armada.fila.valor_entradas
    : Math.round(borrador.entradas.reduce((a, l) => a + l.valor, 0) * 100) / 100;
  const valorCostos = Math.round(borrador.costos.reduce((a, c) => a + c.monto, 0) * 100) / 100;
  const aRepartir = Math.round((valorEntradas + valorCostos) * 100) / 100;
  const valorSalidas = reparto === 'manual'
    ? Math.round(borrador.salidas.reduce((a, l) => a + l.valor, 0) * 100) / 100
    : (armada.fila ? armada.fila.valor_salidas : 0);
  const cierra = Math.abs(valorSalidas - aRepartir) <= 0.05;

  const guardar = async () => {
    if (guardando) return;
    setGuardando(true);
    try { await onGuardar(borrador); } finally { setGuardando(false); }
  };

  const filaLinea = (l, i, setter, lista, { conValor }) => {
    const ins = insumoDe(l.nombre);
    const s = conValor ? sugerenciaDe(l) : null;
    const hay = ins ? disponibleDe(ins, l.unidad) : null;
    return (
      <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'flex-start', marginBottom: 4, flexWrap: 'wrap' }}>
        <div style={{ flex: 2, minWidth: 160 }}>
          <input
            className="fi" list="jx-insumos-empresa" style={{ width: '100%' }}
            placeholder="Nombre del insumo"
            value={l.nombre}
            onChange={e => setLinea(setter, i, 'nombre', e.target.value)}
          />
          {conValor && ins && hay != null && (
            <div style={{ fontSize: 9.5, color: 'var(--tm)' }}>
              hay {fmtCant(hay)} {labelUnidad(l.unidad)}
              {s && <> · costo ≈ {fmtMonto(s.costo, s.moneda)}/{labelUnidad(l.unidad)}</>}
            </div>
          )}
          {conValor && l.nombre && !ins && (
            <div style={{ fontSize: 9.5, color: 'var(--amber)' }}>no está en el inventario de esta empresa</div>
          )}
        </div>
        <input
          className="fi" style={{ width: 76 }} type="number" min="0" step="any" placeholder="Cant."
          value={l.cantidad}
          onChange={e => (conValor ? cantidadDeEntrada(i, e.target.value) : setLinea(setter, i, 'cantidad', e.target.value))}
        />
        <input
          className="fi" style={{ width: 70 }} placeholder="und"
          value={l.unidad}
          onChange={e => setLinea(setter, i, 'unidad', e.target.value)}
        />
        {(conValor || reparto === 'manual') && (
          <input
            className="fi" style={{ width: 90 }} type="number" min="0" step="0.01"
            placeholder={conValor ? 'Valor' : 'Valor'}
            value={l.valor}
            onChange={e => setLinea(setter, i, 'valor', e.target.value)}
          />
        )}
        {!conValor && reparto !== 'manual' && (
          <div style={{ width: 90, fontSize: 11, textAlign: 'right', paddingTop: 6, color: 'var(--tm)' }}>
            {armada.fila && armada.fila.salidas[i] ? fmtMonto(armada.fila.salidas[i].valor, 'PEN') : '—'}
          </div>
        )}
        {reparto === 'mercado' && !conValor && (
          <input
            className="fi" style={{ width: 90 }} type="number" min="0" step="0.01" placeholder="Vale en mercado"
            value={l.valorMercado || ''}
            onChange={e => setLinea(setter, i, 'valorMercado', e.target.value)}
          />
        )}
        <button
          className="btn btn-ghost btn-xs" style={{ color: 'var(--red)' }}
          disabled={lista.length <= 1}
          onClick={() => setter(prev => prev.filter((_, j) => j !== i))}
          title={lista.length <= 1 ? 'Tiene que quedar al menos una línea' : 'Quitar esta línea'}
        >✕</button>
      </div>
    );
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 10 }}>
      <div className="card" style={{ width: '100%', maxWidth: 760, maxHeight: '92vh', overflowY: 'auto', padding: 18, background: 'var(--bg-c)', borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,0.3)' }}>
        <datalist id="jx-insumos-empresa">
          {nombresConocidos.map(n => <option key={n} value={n} />)}
        </datalist>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>🔁 Transformar insumos</h4>
          <button className="btn btn-ghost btn-xs" onClick={onCerrar}>✕</button>
        </div>

        <div style={{ fontSize: 11.5, color: 'var(--ts)', background: 'var(--tint-neutral)', padding: 8, borderRadius: 6, marginBottom: 10 }}>
          Lo que entra sale convertido en otra cosa: <strong>entran planchas, salen láminas</strong>. El valor de lo
          que entra —más lo que costó transformarlo— es exactamente lo que vale lo que sale. Esto <strong>no</strong> es
          un movimiento de almacén ni un asiento contable: es lo que hace que el saldo del inventario vuelva a cerrar.
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--tm)', fontWeight: 700 }}>FECHA</div>
            <input className="fi" type="date" style={{ width: 150 }} value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 10, color: 'var(--tm)', fontWeight: 700 }}>QUÉ PASÓ</div>
            <input className="fi" style={{ width: '100%' }} placeholder="Corte de planchas a láminas de 30×30"
              value={descripcion} onChange={e => setDescripcion(e.target.value)} />
          </div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--red)', marginBottom: 4 }}>ENTRA — se consume</div>
          {entradas.map((l, i) => filaLinea(l, i, setEntradas, entradas, { conValor: true }))}
          <button className="btn btn-ghost btn-xs" onClick={() => setEntradas(prev => [...prev, lineaVacia()])}>+ otro insumo que entra</button>
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber)', marginBottom: 4 }}>
            COSTO DE TRANSFORMAR — opcional
            <span style={{ fontWeight: 400, color: 'var(--tm)' }}> (el servicio de corte, la mano de obra: ya está facturado aparte y se suma al valor de lo que sale)</span>
          </div>
          {costos.map((c, i) => (
            <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
              <input className="fi" style={{ flex: 1 }} placeholder="Concepto (CORTE GUILLOTINA…)"
                value={c.concepto} onChange={e => setCostos(prev => prev.map((x, j) => (j === i ? { ...x, concepto: e.target.value } : x)))} />
              <input className="fi" style={{ width: 100 }} type="number" min="0" step="0.01" placeholder="Monto"
                value={c.monto} onChange={e => setCostos(prev => prev.map((x, j) => (j === i ? { ...x, monto: e.target.value } : x)))} />
              <button className="btn btn-ghost btn-xs" style={{ color: 'var(--red)' }}
                onClick={() => setCostos(prev => prev.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button className="btn btn-ghost btn-xs" onClick={() => setCostos(prev => [...prev, { concepto: '', monto: '' }])}>+ costo de transformación</button>
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)' }}>SALE — lo que se produce</span>
            <span style={{ fontSize: 10.5, color: 'var(--tm)' }}>Repartir el valor:</span>
            {REPARTOS.map(r => (
              <button key={r} className={`btn btn-xs ${reparto === r ? 'btn-blue' : 'btn-ghost'}`}
                title={REPARTO_INFO[r].ayuda}
                onClick={() => setReparto(r)}>{REPARTO_INFO[r].label}</button>
            ))}
          </div>
          {salidas.map((l, i) => filaLinea(l, i, setSalidas, salidas, { conValor: false }))}
          <button className="btn btn-ghost btn-xs" onClick={() => setSalidas(prev => [...prev, lineaVacia()])}>+ otro insumo que sale</button>
        </div>

        {/* LA CUENTA, SIEMPRE A LA VISTA. Si no cierra hay que enterarse antes
            de terminar de cargar, no al apretar guardar. */}
        <div style={{
          padding: 10, borderRadius: 6, marginBottom: 10,
          background: cierra ? 'rgba(46, 204, 113, 0.10)' : 'rgba(231, 76, 60, 0.10)',
          border: `1px solid ${cierra ? 'var(--green)' : 'var(--red)'}`,
          fontSize: 12,
        }}>
          <strong>{fmtMonto(valorEntradas, 'PEN')}</strong> de lo que entra
          {valorCostos > 0 && <> + <strong>{fmtMonto(valorCostos, 'PEN')}</strong> de transformarlo</>}
          {' = '}<strong>{fmtMonto(aRepartir, 'PEN')}</strong>
          <span style={{ margin: '0 6px' }}>→</span>
          sale <strong style={{ color: cierra ? 'var(--green)' : 'var(--red)' }}>{fmtMonto(valorSalidas, 'PEN')}</strong>
          {cierra
            ? <span style={{ color: 'var(--green)', fontWeight: 600 }}> ✓ cierra</span>
            : <span style={{ color: 'var(--red)', fontWeight: 600 }}>
                {' '}✕ {valorSalidas > aRepartir ? 'sobran' : 'faltan'} {fmtMonto(Math.abs(valorSalidas - aRepartir), 'PEN')}
              </span>}
        </div>

        {errores.length > 0 && (
          <div style={{ fontSize: 11.5, color: 'var(--red)', marginBottom: 8 }}>
            {errores.map((e, i) => <div key={i}>• {e}</div>)}
          </div>
        )}
        {avisos.length > 0 && (
          <div style={{ fontSize: 11.5, color: 'var(--amber)', marginBottom: 8 }}>
            {avisos.map((a, i) => <div key={i}>⚠ {a}</div>)}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost btn-sm" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-blue btn-sm" disabled={!ok || guardando} onClick={guardar}>
            {guardando ? 'Registrando…' : 'Registrar transformación'}
          </button>
        </div>
      </div>
    </div>
  );
}

function FichaEmpresa({ company, obrasDeEmpresa, evidencias = [], refreshEvidencias }) {
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

    <DocumentosEmpresa company={company} evidencias={evidencias} refresh={refreshEvidencias} />
  </>);
}

// ── LOS PAPELES DE LA EMPRESA ───────────────────────────────────────
// Pedido de la contadora (7-sep-2026): poder subir y guardar, de cada empresa,
// la FICHA RUC, la VIGENCIA DE PODER, el TESTIMONIO y el RNP. Son los mismos
// cuatro que se adjuntan en cada propuesta y que hasta hoy vivían en un correo.
//
// Dos de ellos caducan (vigencia de poder y RNP): esos piden fecha de
// vencimiento y la ficha avisa cuando falta menos de un mes. Subir la
// renovación NO pisa la anterior — queda de historial, porque una vigencia
// vencida sigue probando quién firmaba en su momento.
function DocumentosEmpresa({ company, evidencias, refresh }) {
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id ?? null;
  const rol = auth?.profile?.rol;
  const puedeSubir = rol === 'admin' || rol === 'contador' || rol === 'ayudante_contador'
    || rol === 'gerente' || rol === 'asistente_admin';
  const showToast = window.__showToast || (() => {});
  const hoy = (() => { try { return window.__fecha.hoyLocal(); } catch { return undefined; } })();
  const docs = uMD(() => documentosDeEmpresa(evidencias, company?.id, { hoy }),
    [evidencias, company?.id, hoy]);
  const [subiendo, setSubiendo] = uSD(null);   // id del doc en curso
  const [metaEdit, setMetaEdit] = uSD({});     // docId → { numero, emision, vencimiento }
  const enCursoRef = React.useRef(false);

  const archivoDe = async (docDef, file) => {
    // Guard SÍNCRONO (regla crítica 2): sin esto, dos clicks en el input
    // guardan el mismo papel dos veces.
    if (enCursoRef.current || !file) return;
    enCursoRef.current = true;
    setSubiendo(docDef.id);
    try {
      const meta = metaEdit[docDef.id] || {};
      await window.__saveEvidenciaLocal({
        id: window.__newId(),
        obra_id: null,                       // es de la EMPRESA, no de una obra
        tipo_evidencia: docDef.tipo,
        modulo_relacionado: 'companies',
        registro_relacionado_id: company.id,
        nombre_archivo: file.name || `${docDef.id}.pdf`,
        mime_type: file.type || '',
        blob: file,
        observaciones: serializarMetaDoc(meta),
        created_by: userId,
        ...((() => { try { return getCurrentMode() === 'prueba'; } catch { return false; } })() ? { demo: true } : {}),
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'evidencias' } })); } catch {}
      try { uploadPendingEvidencias(); } catch {}   // empujar ya si hay señal; si no, la cola offline la sube sola
      showToast(`✓ ${docDef.titulo} guardado`, 'green');
      setMetaEdit(m => ({ ...m, [docDef.id]: {} }));
      refresh?.();
    } catch (e) {
      showToast('No se pudo guardar: ' + (e.message || e), 'red');
    } finally {
      enCursoRef.current = false;
      setSubiendo(null);
    }
  };

  const ver = async (ev) => {
    try {
      const src = await getEvidenciaSrc(ev);
      if (src?.url) await abrirUrlEvidencia(src.url);
      else showToast('El archivo todavía se está subiendo — probá en un minuto.', 'amber');
    } catch { showToast('No se pudo abrir el archivo', 'red'); }
  };

  const quitar = async (ev, docDef) => {
    if (!window.confirm(`¿Quitar «${docDef.titulo}» (${ev.nombre_archivo})?\n\nEl archivo deja de figurar en la ficha. Si era una renovación, vuelve a quedar vigente el anterior.`)) return;
    try {
      await window.__db.evidencias.update(ev.id, {
        deleted_at: new Date().toISOString(),
        sync_status: ev.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
      });
      try { await window.__logAudit?.({ action: 'delete', table: 'evidencias', recordId: ev.id, reason: `Quitar ${docDef.titulo} de ${company.name || company.legal_name || 'la empresa'}` }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'evidencias' } })); } catch {}
      showToast(`${docDef.titulo} quitado`, 'amber');
      refresh?.();
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  const ESTADO_UI = {
    vencido:    { badge: 'b-red',   texto: 'VENCIDO' },
    por_vencer: { badge: 'b-amber', texto: 'vence pronto' },
    vigente:    { badge: 'b-green', texto: 'vigente' },
  };

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', color: 'var(--tm)', marginBottom: 8 }}>
        DOCUMENTOS DE LA EMPRESA
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ts)', marginBottom: 10, lineHeight: 1.5 }}>
        Los papeles que se piden en cada propuesta. La <strong>vigencia de poder</strong> y el
        {' '}<strong>RNP</strong> caducan: cargales la fecha de vencimiento y la ficha avisa antes de que venzan.
        Subir una renovación no borra la anterior — queda de historial.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
        {DOCS_EMPRESA.map(def => {
          const d = docs.get(def.id);
          const ev = d?.vigente;
          const est = ESTADO_UI[d?.estado];
          const meta = metaEdit[def.id] || {};
          return (
            <div key={def.id} className="card card-p" style={{ borderLeft: `3px solid ${ev ? 'var(--green)' : 'var(--border)'}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 12.5 }}>{def.titulo}</strong>
                {est && <span className={`badge ${est.badge}`} style={{ fontSize: 9 }}>{est.texto}</span>}
                {ev && ev.sync_status && ev.sync_status !== 'uploaded' && ev.sync_status !== 'synced' && (
                  <span className="badge b-amber" style={{ fontSize: 9 }} title="Todavía subiendo — se guarda igual y sube sola cuando haya señal">⏱ subiendo</span>
                )}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 3, lineHeight: 1.4 }}>{def.desc}</div>

              {ev ? (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11.5, wordBreak: 'break-word' }}>
                    <button className="btn btn-ghost btn-xs" style={{ padding: '1px 5px' }} onClick={() => ver(ev)}
                      title="Abrir el archivo">
                      <JxIcon name="eye" size={11} /> {ev.nombre_archivo}
                    </button>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 3 }}>
                    {d.meta.numero ? `N.º ${d.meta.numero} · ` : ''}
                    {d.meta.vencimiento ? `vence ${fmtFecha(d.meta.vencimiento)} · ` : ''}
                    subido {ev.fecha ? fmtFecha(ev.fecha) : '—'}
                    {d.historial.length > 0 && ` · ${d.historial.length} anterior(es)`}
                  </div>
                  {puedeSubir && (
                    <button className="btn btn-ghost btn-xs" style={{ marginTop: 6, color: 'var(--red)' }}
                      onClick={() => quitar(ev, def)}>
                      <JxIcon name="trash" size={10} /> Quitar
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 11.5, color: 'var(--tm)', fontStyle: 'italic', marginTop: 8 }}>
                  Sin cargar
                </div>
              )}

              {puedeSubir && (
                <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  {def.venceUsualmente && (
                    <label style={{ display: 'block', fontSize: 10, color: 'var(--tm)', marginBottom: 4 }}>
                      Vence el
                      <input className="fi" type="date" style={{ fontSize: 11, padding: '4px 6px', marginTop: 2 }}
                        value={meta.vencimiento || ''}
                        onChange={e => setMetaEdit(m => ({ ...m, [def.id]: { ...(m[def.id] || {}), vencimiento: e.target.value } }))} />
                    </label>
                  )}
                  <label className="btn btn-ghost btn-xs" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <JxIcon name="upload" size={11} />
                    {subiendo === def.id ? 'Guardando…' : (ev ? 'Subir uno nuevo' : 'Subir archivo')}
                    <input type="file" accept="application/pdf,image/*" style={{ display: 'none' }}
                      disabled={subiendo === def.id}
                      onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; archivoDe(def, f); }} />
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!puedeSubir && (
        <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 8, fontStyle: 'italic' }}>
          Tu rol puede consultar estos documentos, pero no cargarlos.
        </div>
      )}
    </div>
  );
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
