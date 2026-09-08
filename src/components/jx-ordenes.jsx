// ═══════════════════════════════════════════════════════════════════
// JARVEX — ÓRDENES DE COMPRA Y DE SERVICIO (tanda 5, B2 + B3).
//
// Gabriel, 4-sep-2026, probando la tanda 3 en producción:
//   «no encuentro las órdenes de compra ni las de servicio, y las necesito
//    para respaldar las compras de la obra actual».
//
// POR QUÉ ESTA PANTALLA EXISTE SI YA HAY UNA DE ÓRDENES DE COMPRA:
// `jx-compras.jsx` tiene el circuito de LOGÍSTICA — requisición → OC →
// recepción — y vive dentro del desglose de un trabajo. Está bien donde
// está, pero es un flujo de almacén: se entra por «pedir material», no por
// «respaldar una factura». Gabriel fue a buscarlas a la CONTABILIDAD, que es
// donde se necesita el papel, y ahí no había nada.
//
// Esto es el REGISTRO DOCUMENTAL de la empresa: todas sus órdenes emitidas
// (de compra y de servicio), y la puerta para emitir las que faltan. Las dos
// pantallas leen la MISMA tabla `ordenes_compra`.
//
// LA PESTAÑA QUE JUSTIFICA LA TANDA — «Sin respaldo»:
// medido el 4-sep contra producción, con el umbral de S/ 2.000 que propuso
// Gabriel, 200 de 1.205 comprobantes de compra (el 17% de los papeles)
// concentran S/ 3,91 M — el 97% del dinero. Emitirlas de a una a mano es
// inviable; emitirlas en lote, con la grilla editable antes de confirmar, es
// una tarde. Al emitir se llena `accounting_movements.orden_compra_id`, que
// existe desde la mig 041 con 0 de 1.378 filas usadas.
//
// EL GUARD SÍNCRONO de emitir() no es decorativo: es la regla crítica #2 del
// CLAUDE.md. Un doble click en «Emitir 200 órdenes» con el guard por estado
// duplica el lote entero.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import {
  TIPO_ORDEN_LABEL, textosDeTipo, proximoCodigo,
  comprobantesSinOrden, agruparPorEmpresa, resumenRespaldo,
  borradorDesdeMovimiento, recalcularBorrador, ordenarParaEmitir,
  exigeOrdenesDeRespaldo, motivoNoExigido,
  conLineaEditada, conLineaNueva, conLineaQuitada, lineasParaEmitir, sumaDeLineas,
  UMBRAL_POR_DEFECTO,
  nuevaOrdenBorrador, numerarOrden, pasosDeOrden, estaNumerada,
  formatearCodigo,
} from "../lib/ordenes.js";
import { filtroInicialEmpresa, setEmpresaActivaId } from "../lib/empresa-activa.js";
import { useEmpresaBloqueada } from "../hooks/useEmpresaActiva.js";
import { titularContableDeObra } from "../lib/consorcio.js";
import { itemsDeFactura } from "../lib/cruce-recepcion.js";
import {
  abastecimientoDeObra, buscarEnPresupuesto, buscarComprasDelGrupo, mapeoImplicito,
  ofertaPorEmpresa, catalogoDelGrupo, lineasDeFamilia, insumosPorMonto, insumoParaFamilia,
  esUnidadPorcentual,
} from "../lib/abastecimiento.js";
import { resolverMapeos } from "../lib/mapeo-insumos.js";
import {
  directorioDeCompra, buscarDestinatario, destinatarioDeCandidato,
  etiquetaTipo, pareceRuc, porRucExacto, soloDigitos, esBusquedaPorRuc,
} from "../lib/directorio-compra.js";
import {
  corpusDeDescripciones, buscarDescripcion, origenPrincipal, ETIQUETA_ORIGEN,
} from "../lib/sugerir-descripcion.js";
import {
  buzonDeEmpresa, resumenBuzon, estadoRespuesta, respuestaCerrada, lineasQueExcedenElStock,
  RESPUESTA_LABEL, RESPUESTA_BADGE,
  inventarioTextualDeEmpresa, cruzarOrdenConInventario, borradorDeFacturaDesdeOrden,
  totalesDeBorrador, avisosDeFactura, itemsFacturaDeBorrador,
} from "../lib/ordenes-recibidas.js";
import { derivarTypeContable } from "../lib/clasificacion-contable.js";
import { consultarRUC } from "../lib/identity.js";
import { totalesConModoIgv, lineasNormalizadas } from "../lib/precios-igv.js";
import { siguienteComprobante, documentoYaUsado, partirDocumento } from "../lib/serie-comprobante.js";

const { useState: uS, useMemo: uM, useEffect: uE, useRef: uR } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);
const Modal = (p) => (window.Modal ? <window.Modal {...p} /> : null);

const cantF = (n) => Number(n || 0).toLocaleString('es-PE', { maximumFractionDigits: 2 });
const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// El mismo número con SU moneda. Desde la tanda 14 la lista de «Sin respaldo»
// puede mostrar compras en dólares: imprimirles «S/» sería decir algo falso
// justo en la columna del importe.
const fmtMon = (n, moneda) => (!moneda || moneda === 'PEN')
  ? fmtS(n)
  : `${moneda} ` + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtSk = (n) => {
  const v = Number(n || 0);
  if (v >= 1e6) return 'S/ ' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return 'S/ ' + (v / 1e3).toFixed(0) + 'K';
  return 'S/ ' + v.toFixed(0);
};

const ESTADO_BADGE = {
  borrador: 'b-gray', por_confirmar: 'b-amber', firmada: 'b-blue', enviada: 'b-blue',
  aceptada: 'b-green', recibida_parcial: 'b-amber', recibida: 'b-green',
  anulada: 'b-red', cancelada: 'b-red',
};
const ESTADO_LABEL = {
  borrador: 'Borrador', por_confirmar: 'Por confirmar', firmada: 'Firmada', enviada: 'Enviada',
  aceptada: 'Aceptada', recibida_parcial: 'Recibida parcial', recibida: 'Recibida',
  anulada: 'Anulada', cancelada: 'Anulada',
};
const ANULADA = new Set(['anulada', 'cancelada']);

function OrdenesPage({ showToast }) {
  const toast = showToast || window.__showToast || (() => {});
  const auth = window.__useAuth?.();
  const rol = auth?.profile?.rol || '';
  const userId = auth?.profile?.id ?? 'offline';
  const isAdmin = rol === 'admin';
  const canEmitir = isAdmin || rol === 'contador' || rol === 'gerente'
    || (window.__hasPerm?.(rol, 'Órdenes de Compra', 'w') ?? false);

  const { data: companies } = window.__hooks.useCompanies();
  const { data: movs } = window.__hooks.useAccountingMovements();
  const { data: obras } = window.__hooks.useObras();
  const { data: cfg } = window.__hooks.useAppConfig();
  const { data: consorcios } = window.__hooks.useConsorcios();
  const { data: insumosPartida } = window.__hooks.useInsumosPartida(window.__plano === 'obra' ? (window.__getObraActivaId?.() || null) : null);
  const { data: insumoMapeos } = window.__hooks.useInsumoMapeos();
  const resolverConfig = window.__hooks.resolverConfig;

  // ── Estado (TODOS los hooks antes de cualquier return: regla #3) ──
  const [ordenes, setOrdenes] = uS([]);
  const [proveedores, setProveedores] = uS([]);
  const [tab, setTab] = uS('emitidas');
  // Dentro de la contabilidad de UNA empresa el selector queda CLAVADO: es la
  // regla de la tanda 2G («netamente y exclusivamente de esa empresa
  // seleccionada»), y una orden mal atribuida se numera en la serie de otro RUC.
  const empresaFija = useEmpresaBloqueada();
  // ÁMBITO DE OBRA (tanda 6). La misma pantalla, abierta desde el workspace de
  // un trabajo, es «las órdenes que respaldan las compras de ESTA obra».
  // No se acota la EMPRESA junto con la obra a propósito: en Miraflores, de
  // 460 comprobantes solo 112 son del titular (CONSORCIO EL INCA) — el resto
  // es la cadena intercompany, y fijar el titular escondería 3 de cada 4.
  // Mismo criterio que Movimientos de esta obra (docs/tanda-2-navegacion.md B1).
  const enObra = window.__plano === 'obra';
  const obraScopeId = enObra ? (() => { try { return window.__getObraActivaId?.() || null; } catch { return null; } })() : null;
  // Dentro de una obra el filtro arranca en TODAS: acotar además por la
  // empresa activa (que puede ser vieja, de la última vez que se entró a un
  // panel de empresa) escondería la mayor parte de la obra sin decir por qué.
  const [filtroEmpresaRaw, setFiltroEmpresa] = uS(() => (enObra ? 'todas' : filtroInicialEmpresa('todas')));
  const filtroEmpresa = empresaFija || filtroEmpresaRaw;
  const [filtroTipo, setFiltroTipo] = uS('todos');
  const [busqueda, setBusqueda] = uS('');
  const [verAnuladas, setVerAnuladas] = uS(false);
  const [borradores, setBorradores] = uS([]);
  const [emitiendo, setEmitiendo] = uS(false);
  const [progreso, setProgreso] = uS(null);
  const [detalle, setDetalle] = uS(null);
  const [detalleItems, setDetalleItems] = uS([]);
  const emitiendoRef = uR(false);
  // ── LA ORDEN QUE NACE ANTES DEL COMPROBANTE (tanda 7, entrega 6c) ──
  //
  // Gabriel, 6-set-2026, después de probar la primera versión: «¿qué pasa si
  // quiero emitir ahorita mismo una orden de compra o una orden de servicio a
  // un tercero, a una empresa que tal vez aún no está dentro del sistema?
  // ¿Cómo lo hago? En esta sección no me permite».
  //
  // Tenía razón: la primera versión SOLO se llenaba viniendo de Abastecimiento,
  // o sea que sin obra y sin presupuesto no había forma de emitir nada. Y el
  // caso más común de una EMPRESA (sin obra) es justamente ése: comprarle a un
  // tercero. Ahora el formulario se abre vacío y se llena a mano; Abastecimiento
  // pasó a ser una AYUDA que agrega líneas, no la puerta de entrada.
  //
  // Su regla, textual: «centrarnos en que una empresa emita una orden de compra
  // o de servicios. Cualquier empresa, la de nuestro grupo o una de terceros. Y
  // en el caso de la obra, lo mismo prácticamente, pero con la ayuda de tener
  // el inventario de las empresas del grupo, y teniendo a la mano también qué
  // es lo que necesita [la obra]».
  const ordenVacia = () => ({
    companyId: '', tipo: 'compra', igvPct: 18,
    // ¿Los precios que estoy escribiendo YA traen IGV? (tanda 9). Por defecto
    // NO, que es como se cargó todo lo que ya existe.
    igvIncluido: false,
    // A quién se le compra. La clase ya NO se elige antes de buscar (tanda 8):
    // sale del resultado que se eligió en el buscador de RUC / razón social.
    //   ''           — todavía no se eligió a nadie
    //   'grupo'      — otra empresa nuestra (habilita su buzón de recibidas)
    //   'registrado' — un proveedor que ya está en el catálogo
    //   'nuevo'      — uno que NO está en ningún lado: se escribe acá mismo
    provModo: '', provCompanyId: '', provId: '',
    provNombre: '', provRuc: '', provDireccion: '',
    fecha: '', fechaEntrega: '', lugarEntrega: '', condicionPago: '',
    titulo: '', notas: '', obraId: '', obraDescripcion: '',
    guardarProveedor: false,
  });
  const [nueva, setNueva] = uS(ordenVacia);
  const [lineas, setLineas] = uS([]);
  const setNu = (patch) => setNueva(n => ({ ...n, ...patch }));
  // El ayudante de la obra: 'necesita' (presupuesto) | 'grupo' (stock) | null
  const [ayuda, setAyuda] = uS(null);
  const [verMov, setVerMov] = uS(null);   // id del comprobante a mirar desde «Sin respaldo»
  // ── LA VISTA DE «SIN RESPALDO» (tanda 14) ───────────────────────
  // Gabriel, 7-set-2026: «en esa pestaña no se puede filtrar bien por empresa
  // que le facturó al consorcio» y «en el caso de consorcio EL INCA incluso
  // faltan cosas». Las dos cosas se arreglan acá: un filtro por PROVEEDOR (el
  // de arriba es el de la empresa que EMITE, que no es lo mismo) y dos
  // apertura para ver lo que el umbral dejaba afuera. Las compras en otra
  // moneda ya no tienen casilla: se muestran siempre, rotuladas (decisión de
  // Gabriel del 7-set-2026).
  const [respProveedor, setRespProveedor] = uS('todos');
  const [respBusca, setRespBusca] = uS('');
  const [verBajoUmbral, setVerBajoUmbral] = uS(false);
  const [respAbierta, setRespAbierta] = uS(null);   // movimiento_id con el detalle desplegado
  // ── EL AYUDANTE DE DOS BLOQUES ──────────────────────────────────
  // A la izquierda lo que la obra NECESITA (presupuesto); a la derecha lo que
  // las empresas del grupo YA COMPRARON (texto crudo de las facturas). Ninguna
  // de las dos depende del mapeo: el mapeo es lo que sale de usarlas.
  const [buscaNec, setBuscaNec] = uS('');
  const [buscaGrupo, setBuscaGrupo] = uS('');
  // Cómo se agrupa el bloque del grupo: por EMPRESA (lo que pidió Gabriel) o
  // por descripción (lo de antes). Y qué fila tiene el detalle desplegado.
  const [vistaGrupo, setVistaGrupo] = uS('empresa');
  const [detalleOferta, setDetalleOferta] = uS(null);
  // ── EL CATÁLOGO SIN BUSCAR (tanda 13) ───────────────────────────
  // Gabriel: «¿qué tiene JARVEX? De tal manera que veamos, ah, mira, JARVEX ha
  // comprado un montón de herramientas». Antes había que escribir «martillo»
  // para descubrir que los tenía. Ahora el bloque abre con el inventario del
  // grupo, empresa por empresa y familia por familia; el buscador sigue ahí
  // para cuando ya se sabe qué se quiere. `famAbierta` es «empresa|familia».
  const [famAbierta, setFamAbierta] = uS(null);
  // El presupuesto se acota al tipo de orden, con escape a «ver todo».
  const [necTodoTipo, setNecTodoTipo] = uS(false);
  const [lineaFoco, setLineaFoco] = uS(null);   // línea a la que se le asigna el origen
  const creandoRef = uR(false);
  // ── EL BUSCADOR DEL DESTINATARIO (tanda 8, entrega 1) ───────────
  // Gabriel: «me gustaría implementarlo de tal manera que pueda buscar
  // rápidamente el RUC, si es que me acuerdo, para emitir esta orden». Antes
  // había que decidir PRIMERO de qué clase era el destinatario y recién después
  // buscarlo, cada clase en su propio <select>. Ahora es al revés: se busca, y
  // la clase sale del resultado.
  const [provBusca, setProvBusca] = uS('');
  const [provAlta, setProvAlta] = uS(false);   // se está dando de alta uno nuevo
  const [consultandoRuc, setConsultandoRuc] = uS(false);
  // ── EL AUTOCOMPLETADO DEL DETALLE (tanda 8, entrega 2) ──────────
  const [ocItems, setOcItems] = uS([]);
  const [sugFoco, setSugFoco] = uS(null);      // key de la línea que muestra sugerencias
  // ── EL BUZÓN (tanda 8, entrega 3) ───────────────────────────────
  const [buzonBusca, setBuzonBusca] = uS('');
  const [buzonCerradas, setBuzonCerradas] = uS(false);
  const [atendiendo, setAtendiendo] = uS(null);   // { orden, items }
  const [atBorrador, setAtBorrador] = uS(null);
  const [atCruce, setAtCruce] = uS([]);
  const [atGuardando, setAtGuardando] = uS(false);
  const facturandoRef = uR(false);

  const umbral = uM(() => {
    const v = Number(resolverConfig?.(cfg, 'orden_umbral_monto', UMBRAL_POR_DEFECTO));
    return Number.isFinite(v) && v > 0 ? v : UMBRAL_POR_DEFECTO;
  }, [cfg, resolverConfig]);

  const recargarOrdenes = React.useCallback(async () => {
    try {
      const all = await window.__db.ordenes_compra.toArray();
      setOrdenes(all.filter(o => !o.deleted_at));
    } catch { setOrdenes([]); }
    try {
      const its = await window.__db.oc_items.toArray();
      setOcItems(its.filter(i => !i.deleted_at));
    } catch { /* el autocompletado se queda sin esa fuente, no es fatal */ }
  }, []);

  uE(() => {
    recargarOrdenes();
    window.__db.proveedores.toArray().then(p => setProveedores(p.filter(x => !x.deleted_at))).catch(() => {});
    // Las líneas de las órdenes ya emitidas son el mejor corpus para
    // autocompletar el detalle: es texto que alguien ya dio por bueno en un
    // documento firmado. Se lee UNA vez y se refresca con los mismos eventos.
    window.__db.oc_items.toArray().then(i => setOcItems(i.filter(x => !x.deleted_at))).catch(() => {});
    const on = (e) => { if (!e?.detail?.tabla || e.detail.tabla === 'ordenes_compra') recargarOrdenes(); };
    window.addEventListener('jx_data_changed', on);
    window.addEventListener('jx_sync_pull', recargarOrdenes);
    return () => {
      window.removeEventListener('jx_data_changed', on);
      window.removeEventListener('jx_sync_pull', recargarOrdenes);
    };
  }, [recargarOrdenes]);

  const companyId = filtroEmpresa === 'todas' ? null : filtroEmpresa;
  const lookupCompany = React.useCallback((id) => (companies || []).find(c => c.id === id) || null, [companies]);
  const lookupProv = React.useCallback((id) => (proveedores || []).find(p => p.id === id) || null, [proveedores]);
  const lookupObra = React.useCallback((id) => (obras || []).find(o => o.id === id) || null, [obras]);

  // ── QUIÉN EMITE NO SE PREGUNTA: SE SABE ─────────────────────────
  //
  // Gabriel, 6-set-2026: «empresa que emite la orden, esto de aquí no debería
  // estar preguntándome porque es muy obvio. Si yo ingreso a órdenes de compra
  // desde JARVEX, la empresa que emite obviamente es JARVEX y debería estar
  // limitado a que yo lo haga con JARVEX».
  //
  // Y dentro de una obra, la que emite es la que EJECUTA: «aquí lo que me
  // debería salir es que la orden la está emitiendo la entidad que está
  // ejecutando esta obra, que en este caso es CONSORCIO EL INCA, y eso debería
  // estar bloqueado».
  //
  // Tiene razón por partida doble: además de ser obvio, dejarlo abierto
  // permitía numerar una orden en la serie de OTRO RUC, que es un error que
  // después no se arregla.
  const titularObra = uM(
    () => (obraScopeId ? titularContableDeObra(lookupObra(obraScopeId), consorcios || []) : null),
    [obraScopeId, obras, consorcios] // eslint-disable-line react-hooks/exhaustive-deps
  );
  // La empresa emisora queda FIJA cuando el ámbito la determina.
  const emisoraFija = empresaFija || titularObra || null;

  // «Sin respaldo» sigue el mismo criterio que la pestaña de una empresa: son
  // los comprobantes de ESA empresa. Dentro de una obra, los de su ejecutora —
  // que es lo que Gabriel esperaba ver y no veía (le salían los de GASOMI
  // emitidos por JHEENSEG, que no le tocan a EL INCA respaldar).
  const companyIdRespaldo = emisoraFija || companyId;

  // Sin ámbito (la vista del grupo entero) la regla es la misma que con él:
  // solo los consorcios ejecutores llevan órdenes de respaldo. Sin este corte,
  // la vista del grupo seguía listando las compras de GASOMI o JARVEX como
  // «pendientes» — una lista que nadie tiene que cerrar.
  const idsConsorcios = uM(
    () => new Set((companies || []).filter(exigeOrdenesDeRespaldo).map(c => c.id)),
    [companies]
  );
  const movsRespaldo = uM(
    () => (companyIdRespaldo ? (movs || []) : (movs || []).filter(m => idsConsorcios.has(m.company_id))),
    [movs, companyIdRespaldo, idsConsorcios]
  );

  const resumen = uM(
    () => resumenRespaldo(movsRespaldo, ordenes, { umbral, companyId: companyIdRespaldo, obraId: obraScopeId }),
    [movsRespaldo, ordenes, umbral, companyIdRespaldo, obraScopeId]
  );

  // ── Pestaña 1: las emitidas ─────────────────────────────────────
  const emitidas = uM(() => {
    let f = (ordenes || []).filter(o => !o.deleted_at);
    if (companyId) f = f.filter(o => o.company_id === companyId);
    if (obraScopeId) f = f.filter(o => o.obra_id === obraScopeId);
    if (filtroTipo !== 'todos') f = f.filter(o => (o.tipo || 'compra') === filtroTipo);
    if (!verAnuladas) f = f.filter(o => !ANULADA.has(o.estado));
    if (busqueda) {
      const q = busqueda.toLowerCase();
      f = f.filter(o =>
        (o.codigo || '').toLowerCase().includes(q) ||
        (o.proveedor_nombre || '').toLowerCase().includes(q) ||
        (o.titulo || '').toLowerCase().includes(q));
    }
    return f.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
  }, [ordenes, companyId, obraScopeId, filtroTipo, verAnuladas, busqueda]);

  // ── Pestaña 2: lo que falta respaldar ───────────────────────────
  //
  // LA PESTAÑA ES SOLO DE CONSORCIOS EJECUTORES (tanda 14). Gabriel: «en las
  // empresas no debería salirme esta pestaña de sin respaldo, solo en
  // consorcios ejecutores de obra». La entidad del ámbito es la emisora fija
  // (la empresa por la que se entró, o la ejecutora de la obra); sin ámbito
  // —la vista del grupo entero— se sigue mostrando, porque ahí es justamente
  // donde se ve el consorcio junto con todo lo demás.
  const entidadDelAmbito = uM(
    () => (emisoraFija ? lookupCompany(emisoraFija) : null),
    [emisoraFija, lookupCompany]
  );
  const hayPestanaRespaldo = entidadDelAmbito
    ? exigeOrdenesDeRespaldo(entidadDelAmbito)
    : idsConsorcios.size > 0;

  const pendientes = uM(
    () => comprobantesSinOrden(movsRespaldo, ordenes, {
      umbral, companyId: companyIdRespaldo, obraId: obraScopeId,
      incluirBajoUmbral: verBajoUmbral,
    }),
    [movsRespaldo, ordenes, umbral, companyIdRespaldo, obraScopeId, verBajoUmbral]
  );
  const gruposPendientes = uM(
    () => agruparPorEmpresa(pendientes, companies || []),
    [pendientes, companies]
  );

  // ══ PESTAÑA 3: EL BUZÓN — LAS QUE NOS EMITIERON A NOSOTROS ══════
  //
  // Gabriel: «tenemos que tener una sección donde diga ORDEN RECIBIDA, y
  // podamos ver las órdenes recibidas para cada una de nuestras empresas, como
  // si fuera su propio buzón de la empresa».
  //
  // El ámbito manda, igual que en las otras dos pestañas: dentro de la
  // contabilidad de una empresa es SU buzón; en la vista del grupo son los
  // buzones de todas, con la columna que dice a cuál le llegó. Dentro de una
  // obra se acota además a las órdenes de ese trabajo — que es lo que hace que
  // la cadena intercompany de Miraflores se lea de los dos lados sin salir.
  const empresasConBuzon = uM(() => {
    if (empresaFija) return [empresaFija];
    const ids = new Set();
    for (const o of (ordenes || [])) if (o.proveedor_company_id && !o.deleted_at) ids.add(o.proveedor_company_id);
    return [...ids];
  }, [ordenes, empresaFija]);

  const ordenesDelAmbito = uM(
    () => (obraScopeId ? (ordenes || []).filter(o => o.obra_id === obraScopeId) : (ordenes || [])),
    [ordenes, obraScopeId]
  );

  const recibidas = uM(() => {
    const out = [];
    for (const cid of empresasConBuzon) {
      out.push(...buzonDeEmpresa({
        ordenes: ordenesDelAmbito, companyId: cid,
        incluirCerradas: buzonCerradas, tipo: filtroTipo, texto: buzonBusca,
      }));
    }
    const rango = { pendiente: 0, en_revision: 1, aceptada: 2, facturada: 3, rechazada: 4 };
    return out.sort((a, b) => rango[a.respuestaEstado] - rango[b.respuestaEstado]
      || String(b.fecha || '').localeCompare(String(a.fecha || '')));
  }, [ordenesDelAmbito, empresasConBuzon, buzonCerradas, filtroTipo, buzonBusca]);

  // El badge de la pestaña cuenta SOLO lo que espera respuesta, sin filtros de
  // búsqueda: un número que cambia al tipear no sirve para saber si hay trabajo.
  const porAtender = uM(() => {
    let n = 0;
    for (const cid of empresasConBuzon) n += resumenBuzon(ordenesDelAmbito, cid).pendiente;
    return n;
  }, [ordenesDelAmbito, empresasConBuzon]);

  // Los borradores se arman al entrar a la pestaña y se conservan mientras se
  // editan: recalcularlos en cada render tiraría abajo lo que la contadora
  // acaba de escribir en la grilla.
  //
  // Se SINCRONIZAN, no se rehacen (tanda 14): al abrir «ver también los de
  // menos de S/ X» la lista crece, y rehacerla de cero borraría las fechas y
  // los detalles que ya se editaron en las filas de arriba. Cada movimiento
  // que ya tenía borrador conserva el suyo tal cual.
  const sincronizarBorradores = () => {
    setBorradores(prev => {
      const porMov = new Map((prev || []).map(b => [b.movimiento_id, b]));
      return pendientes.slice(0, 400).map(m => porMov.get(m.id) || {
        ...borradorDesdeMovimiento(m, {
          company: lookupCompany(m.company_id),
          proveedor: lookupProv(m.proveedor_id),
          obra: lookupObra(m.obra_id),
        }),
        // De dónde salió la fila: para rotularla y para no emitir una orden en
        // soles por un comprobante que estaba en dólares.
        moneda: m.currency || 'PEN',
        fuera: motivoNoExigido(m, { umbral }),
      });
    });
  };

  uE(() => {
    if (tab === 'respaldo' && pendientes.length > 0) sincronizarBorradores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, pendientes.length, verBajoUmbral]);

  // Si el ámbito es una empresa del grupo, esta pestaña no existe para ella:
  // volver a «Emitidas» en vez de dejar una pantalla vacía sin explicación.
  uE(() => {
    if (tab === 'respaldo' && !hayPestanaRespaldo) setTab('emitidas');
  }, [tab, hayPestanaRespaldo]);

  // ── La grilla que se ve, después de los filtros de la pestaña ────
  // El filtro de arriba de la pantalla es el de la empresa que EMITE; éste es
  // el de quién FACTURÓ, que es como se busca de verdad («qué le falta
  // respaldar a EL INCA de lo que le vendió tal ferretería»).
  const proveedoresPendientes = uM(() => {
    const m = new Map();
    for (const b of borradores) {
      const k = (b.proveedor_nombre || '').trim() || '— sin proveedor —';
      const g = m.get(k) || { nombre: k, n: 0, monto: 0 };
      g.n++; g.monto += Number(b.total) || 0;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.monto - a.monto);
  }, [borradores]);

  const borradoresVisibles = uM(() => {
    const q = respBusca.trim().toLowerCase();
    return borradores
      .map((b, idx) => ({ b, idx }))
      .filter(({ b }) => {
        if (respProveedor !== 'todos') {
          const k = (b.proveedor_nombre || '').trim() || '— sin proveedor —';
          if (k !== respProveedor) return false;
        }
        if (!q) return true;
        return `${b.documento || ''} ${b.proveedor_nombre || ''} ${b.descripcion || ''}`.toLowerCase().includes(q);
      });
  }, [borradores, respProveedor, respBusca]);
  const hayFiltroResp = respProveedor !== 'todos' || !!respBusca.trim();

  // ── LO QUE LLEGA DE ABASTECIMIENTO ──────────────────────────────
  // Ya NO es la puerta: es una de las formas de llenar las líneas. Se lee UNA
  // vez y se limpia el buzón, para que volver a esta pantalla más tarde no
  // reviva un pedido que ya se emitió.
  uE(() => {
    const p = window.__pedidoAbastecimiento;
    if (!p || !p.lineas?.length) return;
    delete window.__pedidoAbastecimiento;
    setTab('nueva');
    setNueva(n => ({
      ...n,
      companyId: p.titular_id || n.companyId,
      obraId: p.obra_id || '',
      obraDescripcion: p.obra_nombre || '',
      fecha: n.fecha || (window.__fecha?.hoyLocal?.() || ''),
      // Viene de un solo proveedor por vez; si trae varios, se toma el primero
      // y las demás líneas quedan igual para que la persona decida.
      provModo: 'grupo',
      provCompanyId: p.lineas[0]?.company_id || '',
    }));
    setLineas(p.lineas.map(l => ({
      key: window.__newId(),
      descripcion: l.nombre, unidad: l.unidad || 'UND',
      cantidad: l.cantidad, precio_unitario: '',
      insumo_codigo: l.insumo_codigo || null,
      origen_company_id: l.company_id || null,
      tope: l.topeDisponible ?? null,
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // ── EL EDITOR DE LÍNEAS ─────────────────────────────────────────
  // El cuadro de abastecimiento alimenta el bloque izquierdo: trae de una vez
  // cuánto pide el presupuesto, cuánto compró la ejecutora y cuánto falta.
  const abastecimiento = uM(() => (obraScopeId ? abastecimientoDeObra({
    insumosPartida: insumosPartida || [],
    movs: movs || [],
    mapeos: resolverMapeos(insumoMapeos || []),
    titularId: titularObra,
    companies: companies || [],
    ordenes,
  }) : { filas: [], resumen: {} }), [obraScopeId, insumosPartida, movs, insumoMapeos, titularObra, companies, ordenes]);

  // ── QUÉ NECESITA LA OBRA, ACOTADO AL TIPO DE ORDEN (tanda 9) ────
  //
  // Medido contra producción el 7-set-2026, `insumos_partida` tiene exactamente
  // tres tipos: material (2.958), mano_obra (2.287) y equipo (1.477). O sea que
  // en una ORDEN DE SERVICIO —mano de obra, alquiler de maquinaria, fletes— más
  // de la mitad del presupuesto sí aplica, y en una de COMPRA no aplica nada de
  // eso. Filtrar por tipo no es cosmético: es la diferencia entre una lista útil
  // y 6.722 filas revueltas.
  //
  // Con escape: «ver todo» está siempre a un clic, porque el tipo del
  // presupuesto lo cargó otra persona y puede estar mal puesto.
  const TIPOS_DE_ORDEN = { compra: ['material'], servicio: ['mano_obra', 'equipo'] };
  const sugNecesita = uM(() => {
    if (!obraScopeId) return [];
    const permitidos = necTodoTipo ? null : TIPOS_DE_ORDEN[nueva.tipo];
    const filas = permitidos
      ? abastecimiento.filas.filter(f => !f.tipo_insumo || permitidos.includes(f.tipo_insumo))
      : abastecimiento.filas;
    return buscarEnPresupuesto(filas, buscaNec, { limite: 10 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obraScopeId, abastecimiento, buscaNec, nueva.tipo, necTodoTipo]);
  const sugGrupo = uM(() => buscarComprasDelGrupo({
    movs: movs || [], texto: buscaGrupo, companies: companies || [],
    titularId: titularObra, obraId: obraScopeId, limite: 10,
  }), [movs, buscaGrupo, companies, titularObra, obraScopeId]);

  // `companyId` es lo nuevo de la tanda 8: hasta acá el destinatario del grupo
  // se guardaba SOLO como texto, y un buzón armado comparando «GASOMI» contra
  // «GASOMI E.I.R.L.» deja órdenes sin entregar. Ver la mig 186.
  const proveedorDeNueva = uM(() => {
    if (nueva.provModo === 'grupo') {
      const c = lookupCompany(nueva.provCompanyId);
      return {
        id: null, companyId: nueva.provCompanyId || null,
        nombre: c?.legal_name || c?.name || '', ruc: c?.ruc || '', direccion: c?.address || '',
      };
    }
    if (nueva.provModo === 'registrado') {
      const pv = lookupProv(nueva.provId);
      return {
        id: nueva.provId || null, companyId: null,
        nombre: pv?.razon_social || pv?.nombre || '', ruc: pv?.ruc || '', direccion: pv?.direccion || '',
      };
    }
    return {
      id: null, companyId: null,
      nombre: nueva.provNombre.trim(), ruc: nueva.provRuc.trim(), direccion: nueva.provDireccion.trim(),
    };
  }, [nueva, companies, proveedores]);

  // ── EL DIRECTORIO DE DESTINATARIOS ───────────────────────────────
  // Las tres fuentes en una sola lista buscable por RUC o razón social. Se
  // arma UNA vez (recorre todas las facturas) y el buscador solo filtra.
  const emisoraId = emisoraFija || nueva.companyId || null;
  const directorio = uM(() => directorioDeCompra({
    companies: companies || [], proveedores: proveedores || [],
    movs: movs || [], excluirCompanyId: emisoraId,
  }), [companies, proveedores, movs, emisoraId]);

  const resultadosProv = uM(
    () => buscarDestinatario(directorio, provBusca, { limite: 10 }),
    [directorio, provBusca]
  );
  // Si lo que se tipeó ES un RUC y no está en ninguna de las tres listas,
  // ofrecemos darlo de alta con ese RUC ya puesto. Si el RUC SÍ existe, no se
  // ofrece: dar de alta un duplicado es el lío que después hay que fusionar.
  const rucTipeado = uM(() => (pareceRuc(provBusca) ? soloDigitos(provBusca) : null), [provBusca]);
  const rucYaExiste = uM(() => (rucTipeado ? porRucExacto(directorio, rucTipeado) : null), [directorio, rucTipeado]);

  const elegirDestinatario = (cand) => {
    const d = destinatarioDeCandidato(cand);
    setProvAlta(false);
    setProvBusca('');
    if (d.modo === 'grupo') {
      setNu({ provModo: 'grupo', provCompanyId: d.companyId, provId: '', provNombre: '', provRuc: '', provDireccion: '', guardarProveedor: false });
    } else if (d.modo === 'proveedor') {
      setNu({ provModo: 'registrado', provId: d.proveedorId, provCompanyId: '', provNombre: '', provRuc: '', provDireccion: '', guardarProveedor: false });
    } else {
      // Un TERCERO con papel: no está en el catálogo, pero su nombre y su RUC
      // los sabemos porque ya le compramos. Se trata como «nuevo» con los
      // datos puestos, y se ofrece guardarlo — no se guarda solo.
      setNu({
        provModo: 'nuevo', provCompanyId: '', provId: d.proveedorId || '',
        provNombre: d.nombre, provRuc: d.ruc, provDireccion: d.direccion,
        guardarProveedor: false,
      });
    }
  };

  /**
   * TRAER LA RAZÓN SOCIAL DE SUNAT.
   *
   * A PEDIDO, con un botón, y NO al tipear: el plan de decolecta es de 100
   * consultas al mes, y disparar una por cada tecla lo quema en una tarde. Es
   * la misma razón por la que Captura Mágica tampoco consulta sola.
   *
   * Si falla —sin internet, cuota agotada, SUNAT caída— no pasa nada: la razón
   * social se escribe a mano, que es como se hacía hasta ahora. Una orden no
   * puede quedar bloqueada porque un servicio de terceros no contestó.
   */
  const traerDeSunat = async () => {
    const r = soloDigitos(nueva.provRuc);
    if (r.length !== 11) { toast('Escribe los 11 dígitos del RUC', 'amber'); return; }
    setConsultandoRuc(true);
    try {
      const d = await consultarRUC(r);
      setNu({
        provNombre: d.razonSocial || nueva.provNombre,
        provDireccion: d.direccionExacta || d.direccion || nueva.provDireccion,
      });
      if (d.estado && d.estado.toUpperCase() !== 'ACTIVO') {
        toast(`Ojo: en SUNAT figura como ${d.estado}${d.condicion ? ` · ${d.condicion}` : ''}`, 'amber');
      } else {
        toast(`${d.razonSocial || 'Encontrado'} — traído de SUNAT`, 'green');
      }
    } catch (e) {
      toast('No se pudo consultar SUNAT: ' + (e.message || e) + '. Escríbelo a mano.', 'amber');
    } finally { setConsultandoRuc(false); }
  };

  const limpiarDestinatario = () => {
    setProvAlta(false);
    setNu({ provModo: '', provCompanyId: '', provId: '', provNombre: '', provRuc: '', provDireccion: '', guardarProveedor: false });
  };

  const destinatarioElegido = !!(nueva.provModo && proveedorDeNueva.nombre);
  // El bloque «qué tienen las empresas del grupo» solo cuando puede servir: o
  // todavía no se eligió a quién comprarle (y sirve para descubrirlo), o se le
  // está comprando a una empresa nuestra. A una ferretería de terceros no.
  const mostrarBloqueGrupo = !destinatarioElegido || nueva.provModo === 'grupo';
  // Y si ya se sabe A CUÁL, el bloque muestra lo de ESA empresa: ofrecer el
  // stock de GASOMI en una orden dirigida a JHEENSEG invita a enlazar un origen
  // que la orden no puede respaldar.
  const sugGrupoVisible = uM(() => {
    if (nueva.provModo !== 'grupo' || !nueva.provCompanyId) return sugGrupo;
    return sugGrupo
      .map(g => ({ ...g, porEmpresa: g.porEmpresa.filter(e => e.company_id === nueva.provCompanyId) }))
      .filter(g => g.porEmpresa.length);
  }, [sugGrupo, nueva.provModo, nueva.provCompanyId]);

  // ── LO MISMO, VISTO POR EMPRESA (tanda 9, Acote 1) ───────────────
  // «que me salgan el bloque de cemento que compró GASOMI, aunque sean con
  // diferentes nombres». Es un pivoteo: no cambia un solo número.
  const ofertaGrupo = uM(() => ofertaPorEmpresa(sugGrupoVisible), [sugGrupoVisible]);

  // ── EL CATÁLOGO DEL GRUPO, SIN ESCRIBIR NADA (tanda 13) ──────────
  // Lo mismo que ofrece el buscador, pero al revés: primero se ve QUÉ HAY
  // —empresa → familia → ítems— y recién después se elige. Solo se calcula
  // cuando el bloque está sin búsqueda, que es cuando se muestra.
  const catalogo = uM(() => (buscaGrupo.trim() ? [] : catalogoDelGrupo({
    movs: movs || [], companies: companies || [], titularId: titularObra,
    obraId: obraScopeId,
    companyId: nueva.provModo === 'grupo' ? (nueva.provCompanyId || null) : null,
  })), [buscaGrupo, movs, companies, titularObra, obraScopeId, nueva.provModo, nueva.provCompanyId]);

  // ── LOS INSUMOS QUE EL PRESUPUESTO MIDE EN PLATA ─────────────────
  // «HERRAMIENTAS MANUALES» de Miraflores está en 1.115 partidas con unidad
  // %mo: su cantidad no significa nada, su monto sí (S/ 132.492,97). Es contra
  // eso que cuadra una orden de herramientas — ver el encabezado de la lib.
  const insumosMonto = uM(() => (obraScopeId ? insumosPorMonto({
    insumosPartida: insumosPartida || [], ordenes, ocItems, obraId: obraScopeId,
  }) : []), [obraScopeId, insumosPartida, ordenes, ocItems]);
  const montoDeInsumo = (codigo) => insumosMonto.find(i => i.codigo === codigo) || null;

  // ── EL CORPUS DEL AUTOCOMPLETADO ─────────────────────────────────
  // Todo lo que la app vio escrito alguna vez, con lo que compró ESTA empresa
  // pesando más. No se acota por tipo de orden: ver el porqué en el encabezado
  // de lib/sugerir-descripcion.js.
  const corpus = uM(() => corpusDeDescripciones({
    ocItems, movs: movs || [], insumosPartida: insumosPartida || [],
    companyId: emisoraId,
  }), [ocItems, movs, insumosPartida, emisoraId]);

  const lineaVacia = () => ({
    // La unidad por defecto la decide el TIPO: «SERV» en una orden de servicio.
    key: window.__newId(), descripcion: '', unidad: textosDeTipo(nueva.tipo).unidadPorDefecto,
    cantidad: '', precio_unitario: '', insumo_codigo: null,
    origen_company_id: null, tope: null,
    // Las dos mitades del mapeo implícito: de qué insumo del presupuesto sale
    // la línea, y contra qué descripción de compra se la está cruzando.
    insumo_nombre: null, insumo_unidad: null, origen_descripcion: null, origen_unidad: null,
  });
  const addLinea = () => setLineas(ls => [...ls, lineaVacia()]);
  // ── LAS RECOMENDACIONES DE LA LÍNEA QUE SE ESTÁ ESCRIBIENDO ──────
  // Una sola línea a la vez tiene el foco, así que se calcula UNA vez por
  // render y no una por fila: el corpus tiene decenas de miles de entradas en
  // producción y filtrarlo por cada fila de la tabla se nota al tipear.
  const sugActuales = uM(() => {
    if (!sugFoco) return [];
    const l = lineas.find(x => x.key === sugFoco);
    if (!l) return [];
    return buscarDescripcion(corpus, l.descripcion, {
      limite: 7,
      // Acote 2: el nombre que usa la empresa a la que le estás comprando va
      // primero. Es la que va a emitir la factura con ESE nombre.
      proveedorId: nueva.provModo === 'grupo' ? (nueva.provCompanyId || null) : null,
    });
  }, [sugFoco, lineas, corpus, nueva.provModo, nueva.provCompanyId]);

  /**
   * Aceptar una recomendación.
   *
   * El PRECIO no se pisa nunca: si la persona ya escribió uno, es el que
   * negoció. Y si estaba vacío se rellena con el último conocido, que es una
   * sugerencia con fecha al lado — no un número aparecido de la nada.
   */
  const usarSugerencia = (key, sg) => {
    setLineas(ls => ls.map(l => (l.key !== key ? l : {
      ...l,
      descripcion: sg.descripcion,
      unidad: l.unidad && l.unidad !== 'UND' ? l.unidad : (sg.unidad || l.unidad || 'UND'),
      precio_unitario: Number(l.precio_unitario) > 0 ? l.precio_unitario : (sg.precio ?? l.precio_unitario),
      insumo_codigo: l.insumo_codigo || sg.insumoCodigo || null,
      insumo_nombre: l.insumo_nombre || (sg.insumoCodigo ? sg.descripcion : null),
      insumo_unidad: l.insumo_unidad || (sg.insumoCodigo ? sg.unidad : null),
    })));
    setSugFoco(null);
  };
  const setLinea = (key, patch) => setLineas(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));
  const delLinea = (key) => setLineas(ls => ls.filter(l => l.key !== key));
  const addLineas = (nuevas) => setLineas(ls => [...ls, ...nuevas.map(n => ({ ...lineaVacia(), ...n, key: window.__newId() }))]);

  /**
   * Enlazar una oferta del grupo con la línea marcada.
   *
   * Hace las dos cosas a la vez porque son la misma decisión: si el material
   * sale de GASOMI, la orden es PARA GASOMI. Dejarlas separadas permitía
   * enlazar el stock de una empresa en una orden dirigida a otra, y esa orden
   * después no respalda nada.
   */
  const enlazarOferta = (emp, it) => {
    if (!lineaFoco) { toast('Marca primero la línea del detalle a la que enlazar esto', 'amber'); return; }
    setLinea(lineaFoco, {
      origen_company_id: emp.company_id,
      origen_descripcion: it.descripcion,
      origen_unidad: it.unidad || null,
      tope: it.disponible,
    });
    setNu({ provModo: 'grupo', provCompanyId: emp.company_id });
  };

  /**
   * TODO UN BLOQUE DE UNA VEZ: «vamos a hacerle una orden a JARVEX por todo lo
   * que es herramientas».
   *
   * Hace las tres cosas que son la misma decisión: mete las líneas, apunta la
   * orden a esa empresa (igual que `enlazarOferta`: si el material sale de
   * JARVEX, la orden es PARA JARVEX) y, cuando la obra presupuesta esa familia,
   * deja cada línea enlazada al insumo del presupuesto. Eso último es lo que
   * hace que la orden cuente después como consumo: el mapeo se aprende
   * trabajando, no en una tarea aparte.
   */
  const agregarFamilia = (emp, fam) => {
    const insumo = obraScopeId ? insumoParaFamilia(fam.familia, insumosMonto) : null;
    const nuevas = lineasDeFamilia(fam.items, { companyId: emp.company_id, insumo });
    if (!nuevas.length) return;
    addLineas(nuevas);
    setNu({ provModo: 'grupo', provCompanyId: emp.company_id });
    toast(
      `${nuevas.length} ${nuevas.length === 1 ? 'línea agregada' : 'líneas agregadas'} de ${emp.nombre}`
      + (insumo ? ` · van contra «${insumo.nombre}» del presupuesto` : ''),
      'green'
    );
  };

  const totalesNueva = uM(
    () => totalesConModoIgv(lineas, { igvPct: Number(nueva.igvPct), preciosIncluyenIgv: !!nueva.igvIncluido }),
    [lineas, nueva.igvPct, nueva.igvIncluido]
  );

  const faltaNueva = uM(() => {
    const f = [];
    if (!(emisoraFija || nueva.companyId)) f.push('la empresa que emite');
    if (!proveedorDeNueva.nombre) f.push('a quién se le compra');
    const vivas = lineas.filter(l => String(l.descripcion || '').trim() && Number(l.cantidad) > 0);
    if (!vivas.length) f.push('al menos una línea con descripción y cantidad');
    else if (vivas.some(l => !(Number(l.precio_unitario) > 0))) f.push('el precio de cada línea');
    return f;
  }, [nueva, proveedorDeNueva, lineas, emisoraFija]);

  // ── ¿LE ESTOY PIDIENDO MÁS DE LO QUE TIENE? (tanda 9) ───────────
  //
  // Gabriel, 7-set-2026: «no es que la orden no se pueda emitir, se emitirá,
  // pero nos arrojará un aviso que la empresa del grupo a la que le estamos
  // solicitando no tiene dicha cantidad».
  //
  // SOLO con empresas del grupo. De un tercero no sabemos qué stock tiene —sus
  // compras no están en nuestros libros— y avisar «la ferretería no tiene 500 kg
  // de clavos» sería inventar un dato.
  const inventarioDestinatario = uM(
    () => (nueva.provModo === 'grupo' && nueva.provCompanyId
      ? inventarioTextualDeEmpresa({ movs: movs || [], companyId: nueva.provCompanyId })
      : new Map()),
    [nueva.provModo, nueva.provCompanyId, movs]
  );
  const excesos = uM(() => lineasQueExcedenElStock({
    lineas, inventario: inventarioDestinatario, mapeos: resolverMapeos(insumoMapeos || []),
  }), [lineas, inventarioDestinatario, insumoMapeos]);

  const limpiarNueva = () => {
    setNueva(ordenVacia()); setLineas([]); setAyuda(null);
    setProvBusca(''); setProvAlta(false); setSugFoco(null);
  };

  // ── CREAR LA ORDEN ──────────────────────────────────────────────
  //
  // Guard SÍNCRONO (regla crítica #2): confirmar consume un correlativo, y un
  // doble click dejaría dos órdenes numeradas para el mismo pedido.
  const crearOrden = async ({ numerar }) => {
    if (creandoRef.current) return;
    if (!canEmitir) { toast('No tienes permiso para emitir órdenes', 'red'); return; }
    if (faltaNueva.length) { toast('Falta ' + faltaNueva.join(', '), 'amber'); return; }

    const company = lookupCompany(emisoraId);
    const hoy = nueva.fecha || window.__fecha?.hoyLocal?.() || new Date().toISOString().slice(0, 10);
    const anio = Number(String(hoy).slice(0, 4));
    // 🔴 Lo que se GUARDA es siempre VALOR DE VENTA, escriba la persona con IGV
    // o sin él (tanda 9). Guardar unas líneas con IGV y otras sin haría que
    // comparar dos compras del mismo insumo dependa de cómo estaba el checkbox
    // ese día — y de ahí comen el historial de precios y el abastecimiento.
    const items = lineasNormalizadas(
      lineas.filter(l => String(l.descripcion || '').trim() && Number(l.cantidad) > 0),
      { igvPct: Number(nueva.igvPct), preciosIncluyenIgv: !!nueva.igvIncluido }
    ).map(l => ({
      nombre: l.descripcion.trim(), unidad: l.unidad || 'UND',
      cantidad: Number(l.cantidad), precio_unitario: Number(l.precio_unitario),
      insumo_codigo: l.insumo_codigo || null,
      // De quién sale el material. Si la orden va a una empresa del grupo, sale
      // de ELLA aunque nadie haya usado el bloque de abastecimiento: es lo que
      // hace que su nombre quede en SU vocabulario para la próxima vez
      // (Acote 2 de Gabriel, 7-set-2026).
      company_id: l.origen_company_id || proveedorDeNueva.companyId || null,
    }));

    if (numerar) {
      const { correlativo } = proximoCodigo(ordenes, { company, tipo: nueva.tipo, anio });
      const cod = formatearCodigo(correlativo, { company, tipo: nueva.tipo, anio });
      if (!window.confirm(
        `Emitir ${cod} a ${proveedorDeNueva.nombre}?\n\n${items.length} línea(s) · ${fmtS(totalesNueva.total)}\n\n`
        + (excesos.length
          ? `${excesos.length} línea(s) piden más de lo que ${proveedorDeNueva.nombre} tiene según sus facturas. `
            + 'Se puede emitir igual: tendrá que comprarlo para atenderte.\n\n'
          : '')
        + `Ese número queda tomado en la serie de ${company?.name || 'la empresa'} y no se libera aunque después se anule.`
      )) return;
    }

    creandoRef.current = true;
    try {
      const now = new Date().toISOString();
      // Un proveedor nuevo se guarda en el catálogo SOLO si se pidió: no
      // ensuciamos la lista de 378 proveedores con cada nombre tipeado a mano.
      let provId = proveedorDeNueva.id;
      if (nueva.provModo === 'nuevo' && nueva.guardarProveedor && proveedorDeNueva.nombre) {
        try {
          provId = window.__newId();
          await window.__db.proveedores.add({
            id: provId, razon_social: proveedorDeNueva.nombre, ruc: proveedorDeNueva.ruc || null,
            direccion: proveedorDeNueva.direccion || null, estado: 'activo',
            created_by: userId, updated_by: userId, created_at: now, updated_at: now,
            version: 1, sync_status: 'pending_create', last_synced_at: null,
            idempotency_key: `${userId}_prov_${provId}`,
          });
          setProveedores(ps => [...ps, { id: provId, razon_social: proveedorDeNueva.nombre, ruc: proveedorDeNueva.ruc }]);
        } catch (e) { console.warn('[ordenes] no se pudo guardar el proveedor:', e); provId = null; }
      }

      const { fila, items: filasItems } = nuevaOrdenBorrador({
        companyId: emisoraId,
        tipo: nueva.tipo,
        obraId: nueva.obraId || obraScopeId || null,
        proveedor: { ...proveedorDeNueva, id: provId },
        items,
        igvPct: Number(nueva.igvPct),
        fecha: hoy,
        fechaEntrega: nueva.fechaEntrega || null,
        lugarEntrega: nueva.lugarEntrega || null,
        condicionPago: nueva.condicionPago || null,
        titulo: nueva.titulo || null,
        obraDescripcion: nueva.obraDescripcion || lookupObra(nueva.obraId || obraScopeId)?.nombre_obra || null,
        observaciones: nueva.notas || null,
      });

      const definitiva = numerar ? numerarOrden({ ...fila }, ordenes, { company, anio }) : fila;
      const ocId = window.__newId();
      await window.__db.ordenes_compra.add({
        ...definitiva, id: ocId,
        created_by: userId, updated_by: userId, created_at: now, updated_at: now,
        version: 1, sync_status: 'pending_create', last_synced_at: null,
        idempotency_key: `${userId}_oc_${ocId}`,
      });
      for (const l of filasItems) {
        const itemId = window.__newId();
        await window.__db.oc_items.add({
          ...l, id: itemId, orden_compra_id: ocId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_oc_item_${itemId}`,
        });
      }
      // ── EL MAPEO QUE SALE DE REGALO ─────────────────────────────
      // Gabriel: «el mapeo lo vamos a lograr aquí cuando la contadora lo haga
      // manualmente». Cada línea que cruza un insumo del presupuesto con una
      // compra real ES una decisión de mapeo, y se guarda sola. Nadie se
      // sienta a mapear 1.875 descripciones: se aprenden trabajando.
      let aprendidos = 0;
      for (const l of lineas) {
        const fila = mapeoImplicito({
          descripcionCompra: l.origen_descripcion,
          insumoCodigo: l.insumo_codigo,
          unidadCompra: l.origen_unidad,
          unidadInsumo: l.insumo_unidad,
        });
        if (!fila) continue;
        try {
          const mid = window.__newId();
          await window.__db.insumo_mapeo.add({
            ...fila, id: mid, demo: false,
            created_by: userId, updated_by: userId, created_at: now, updated_at: now,
            version: 1, sync_status: 'pending_create', last_synced_at: null,
            idempotency_key: `${userId}_mapeo_${mid}`,
          });
          aprendidos++;
        } catch (e) { console.warn('[ordenes] no se pudo guardar el mapeo aprendido:', e); }
      }

      await recargarOrdenes();
      limpiarNueva();
      toast(numerar ? `Orden ${definitiva.codigo} emitida` : 'Borrador guardado (todavía sin número)', 'green');
      if (aprendidos) toast(`${aprendidos} equivalencia(s) aprendida(s) para el mapeo`, 'blue');
      if (numerar) setTab('emitidas');
    } catch (e) {
      console.error('[ordenes] no se pudo crear la orden:', e);
      toast('No se pudo crear la orden: ' + (e.message || e), 'red');
    } finally { creandoRef.current = false; }
  };

  const actualizarBorrador = (idx, patch) => {
    setBorradores(bs => bs.map((b, i) => {
      if (i !== idx) return b;
      const next = { ...b, ...patch };
      return ('total' in patch || 'igvPct' in patch) ? recalcularBorrador(next) : next;
    }));
  };

  // Editar UNA línea del detalle de un borrador (tanda 14).
  const actualizarLinea = (idx, li, patch) =>
    setBorradores(bs => bs.map((b, i) => (i === idx ? conLineaEditada(b, li, patch) : b)));
  const agregarLinea = (idx) =>
    setBorradores(bs => bs.map((b, i) => (i === idx ? conLineaNueva(b, b.tipo) : b)));
  const quitarLinea = (idx, li) =>
    setBorradores(bs => bs.map((b, i) => (i === idx ? conLineaQuitada(b, li) : b)));

  const seleccionados = uM(() => borradores.filter(b => b.incluir), [borradores]);
  // Solo lo que está EN SOLES: sumar dólares y soles en un mismo número daría
  // un total que no existe. Las de otra moneda se cuentan aparte.
  const montoSeleccionado = uM(
    () => seleccionados.filter(b => (b.moneda || 'PEN') === 'PEN').reduce((s, b) => s + Number(b.total || 0), 0),
    [seleccionados]
  );
  const selOtraMoneda = uM(
    () => seleccionados.filter(b => (b.moneda || 'PEN') !== 'PEN').length,
    [seleccionados]
  );
  // Seleccionadas que el filtro de la pestaña está escondiendo: emitir un lote
  // que incluye filas que no se ven es la forma más fácil de emitir de más.
  const seleccionadasOcultas = uM(() => {
    if (!hayFiltroResp) return 0;
    const visibles = new Set(borradoresVisibles.map(v => v.b.movimiento_id));
    return seleccionados.filter(b => !visibles.has(b.movimiento_id)).length;
  }, [hayFiltroResp, borradoresVisibles, seleccionados]);

  // ── LA EMISIÓN EN LOTE ──────────────────────────────────────────
  //
  // Una orden = una fila en `ordenes_compra` + un `oc_items` + el
  // `orden_compra_id` del comprobante. Los tres en la misma pasada: si se
  // escribiera la orden y no el movimiento, el comprobante volvería a
  // aparecer en esta lista y se emitiría dos veces.
  //
  // El correlativo se calcula sobre un acumulador LOCAL (`emitidasAhora`) y
  // no releyendo Dexie en cada vuelta: en un lote de 200, releer daría el
  // mismo número dos veces hasta que la escritura anterior se vea.
  //
  // 🔴 Bloqueante B-3 (tanda 5, cerrado en la tanda 7): `seleccionados` hereda
  // el orden de `pendientes` (por MONTO — correcto para MIRAR la lista), pero
  // recorrerlo así al EMITIR repartía la OC-001 al comprobante más caro, no
  // al más antiguo. `ordenarParaEmitir()` recorre por fecha ascendente SOLO
  // acá, en el momento de pedir los correlativos — la grilla que ve la
  // contadora sigue mostrando lo caro primero, que es donde sirve mirar.
  const emitirLote = async () => {
    if (emitiendoRef.current) return;
    if (!seleccionados.length) { toast('No hay comprobantes seleccionados', 'amber'); return; }
    if (!canEmitir) { toast('No tienes permiso para emitir órdenes', 'red'); return; }
    const sinEmpresa = seleccionados.filter(b => !b.company_id);
    if (sinEmpresa.length) { toast(`${sinEmpresa.length} comprobante(s) sin empresa emisora — no se pueden numerar`, 'red'); return; }
    const extra = selOtraMoneda > 0 ? ` (+ ${selOtraMoneda} en otra moneda)` : '';
    if (!window.confirm(`Emitir ${seleccionados.length} órdenes por ${fmtS(montoSeleccionado)}${extra}?\n\nCada comprobante queda atado a su orden.`)) return;

    emitiendoRef.current = true;
    setEmitiendo(true);
    const porFecha = ordenarParaEmitir(seleccionados);
    setProgreso({ hechas: 0, total: porFecha.length });
    const emitidasAhora = [...ordenes];
    let ok = 0; const errores = [];

    try {
      for (const b of porFecha) {
        try {
          const company = lookupCompany(b.company_id);
          const anio = b.fecha ? Number(String(b.fecha).slice(0, 4)) : new Date().getFullYear();
          const { correlativo, codigo } = proximoCodigo(emitidasAhora, { company, tipo: b.tipo, anio });
          const ocId = window.__newId();
          const now = new Date().toISOString();
          const obra = lookupObra(b.obra_id);
          const T = textosDeTipo(b.tipo);

          const fila = {
            id: ocId,
            codigo, correlativo, anio,
            tipo: b.tipo,
            company_id: b.company_id,
            obra_id: b.obra_id || null,
            trabajo_id: b.trabajo_id || null,
            proveedor_id: b.proveedor_id || null,
            proveedor_nombre: b.proveedor_nombre || null,
            proveedor_ruc: b.proveedor_ruc || null,
            proveedor_direccion: b.proveedor_direccion || null,
            fecha: b.fecha || now.slice(0, 10),
            fecha_entrega: null,
            // La del comprobante que respalda. Con la vista abierta a moneda
            // extranjera (tanda 14) emitir todo en soles habría puesto un
            // símbolo falso en el PDF de una compra en dólares.
            moneda: b.moneda || 'PEN',
            condicion_pago: b.condicion_pago || null,
            estado: 'recibida',   // el bien/servicio YA se recibió: la orden es el respaldo de algo que pasó
            titulo: b.titulo || null,
            obra_descripcion: b.obra_descripcion || obra?.nombre_obra || null,
            contrato_ref: null,
            ejecutor_ref: null,
            igv_pct: Number(b.igvPct ?? 18),
            monto_subtotal: Number(b.valorVenta || 0),
            monto_igv: Number(b.igv || 0),
            monto_total: Number(b.total || 0),
            accounting_movement_id: b.movimiento_id,
            emitida_retroactiva: true,
            // Vacío si nadie escribió nada (tanda 14). Antes se imprimía
            // siempre «Respaldo retroactivo del comprobante …» en el PDF de una
            // orden que ya dice a qué comprobante respalda.
            observaciones: (b.observaciones || '').trim() || null,
            created_by: userId, updated_by: userId,
            created_at: now, updated_at: now,
            version: 1, sync_status: 'pending_create', last_synced_at: null,
            idempotency_key: `${userId}_oc_${ocId}`,
          };

          await window.__db.ordenes_compra.add(fila);
          // Las líneas REALES del comprobante —y desde la tanda 14, las que la
          // contadora dejó escritas en el detalle—, cuadradas contra el valor
          // de venta emitido: una orden que respalda una factura ya emitida no
          // puede cerrar distinto de ella.
          const lineas = lineasParaEmitir(b);
          for (const l of lineas) {
            const liId = window.__newId();
            const cant = Number(l.cantidad || 1) || 1;
            const sub = Number(l.subtotal ?? (cant * Number(l.precio_unitario || 0)));
            await window.__db.oc_items.add({
              id: liId,
              orden_compra_id: ocId,
              tipo_insumo: l.tipo_insumo || (b.tipo === 'servicio' ? 'servicio' : 'material'),
              material_id: null, insumo_id: null, insumo_pendiente_id: null,
              insumo_codigo: null, proveedor_company_id: null,
              nombre: l.nombre, nombre_libre: l.nombre,
              unidad: l.unidad || T.unidadPorDefecto,
              cantidad: cant,
              cantidad_recibida: cant,
              precio_unitario: Number((sub / cant).toFixed(6)),
              subtotal: sub,
              created_at: now, updated_at: now,
              version: 1, sync_status: 'pending_create', last_synced_at: null,
              idempotency_key: `${userId}_oc_item_${liId}`,
            });
          }

          // El otro lado del vínculo. Sin esto la factura sigue "sin respaldo".
          const mv = await window.__db.accounting_movements.get(b.movimiento_id);
          if (mv) {
            await window.__db.accounting_movements.update(b.movimiento_id, {
              orden_compra_id: ocId,
              updated_at: now, updated_by: userId,
              version: (mv.version ?? 0) + 1,
              sync_status: mv.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
            });
          }

          emitidasAhora.push(fila);
          ok++;
          setProgreso({ hechas: ok, total: porFecha.length });
        } catch (e) {
          errores.push(`${b.documento || b.movimiento_id}: ${e.message || e}`);
        }
      }

      try {
        await window.__logAudit?.({
          action: 'create', table: 'ordenes_compra', recordId: null,
          newData: { emitidas: ok, monto: montoSeleccionado },
          reason: `Emisión masiva de respaldo — ${ok} órdenes por ${fmtS(montoSeleccionado)} (umbral S/ ${umbral})`,
        });
      } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'ordenes_compra' } })); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'accounting_movements' } })); } catch {}
      await recargarOrdenes();
      setBorradores([]);
      if (errores.length) {
        console.warn('[órdenes] errores de emisión', errores);
        toast(`${ok} órdenes emitidas · ${errores.length} con error (ver consola)`, 'amber');
      } else {
        toast(`✓ ${ok} órdenes emitidas · ${fmtS(montoSeleccionado)} respaldados`, 'green');
      }
      setTab('emitidas');
    } finally {
      emitiendoRef.current = false;
      setEmitiendo(false);
      setProgreso(null);
    }
  };

  // ── PDF ─────────────────────────────────────────────────────────
  const descargarPdf = async (o) => {
    try {
      const items = await window.__db.oc_items.where('orden_compra_id').equals(o.id).filter(x => !x.deleted_at).toArray();
      window.__pdfs?.generateOrdenPdf?.(o, items, {
        company: lookupCompany(o.company_id) || {},
        obra: lookupObra(o.obra_id),
        proveedor: lookupProv(o.proveedor_id),
      });
    } catch (e) { toast('Error generando el PDF: ' + (e.message || e), 'red'); }
  };

  const verDetalle = async (o) => {
    try {
      const items = await window.__db.oc_items.where('orden_compra_id').equals(o.id).filter(x => !x.deleted_at).toArray();
      setDetalleItems(items);
      setDetalle(o);
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
  };

  const anular = async (o) => {
    const motivo = window.prompt(`Motivo de anulación de ${o.codigo}:`);
    if (!motivo || motivo.trim().length < 5) { toast('Motivo requerido (mín. 5 caracteres)', 'red'); return; }
    try {
      const now = new Date().toISOString();
      await window.__db.ordenes_compra.update(o.id, {
        estado: 'anulada', motivo_anulacion: motivo.trim(), anulado_por: userId, anulado_at: now,
        updated_at: now, updated_by: userId,
        version: (o.version ?? 0) + 1,
        sync_status: o.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      // El comprobante vuelve a quedar sin respaldo — que es la verdad.
      if (o.accounting_movement_id) {
        const mv = await window.__db.accounting_movements.get(o.accounting_movement_id);
        if (mv && mv.orden_compra_id === o.id) {
          await window.__db.accounting_movements.update(mv.id, {
            orden_compra_id: null,
            updated_at: now, updated_by: userId,
            version: (mv.version ?? 0) + 1,
            sync_status: mv.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
          });
        }
      }
      try { await window.__logAudit?.({ action: 'update', table: 'ordenes_compra', recordId: o.id, oldData: { estado: o.estado }, newData: { estado: 'anulada', motivo }, reason: `Anulación ${o.codigo}: ${motivo}` }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'ordenes_compra' } })); } catch {}
      await recargarOrdenes();
      toast(`${o.codigo} anulada`, 'amber');
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
  };

  // ══════════════════════════════════════════════════════════════════
  // ATENDER UNA ORDEN RECIBIDA
  //
  // Gabriel: «tengamos la opción de revisar, cruzar con nuestro inventario de
  // la empresa, corroborar que tenemos los insumos, tal vez no con el mismo
  // nombre, pero podemos enlazarlos […] tal vez no tenga todo, tal vez tenga
  // más, la idea es que se pueda personalizar eso también».
  //
  // Todo eso es EDICIÓN de un borrador que nace siendo la orden tal cual. Nada
  // acá bloquea: cruzar, avisar y dejar decidir. Ver el porqué de cada aviso en
  // lib/ordenes-recibidas.js.
  // ══════════════════════════════════════════════════════════════════
  const abrirAtencion = async (o) => {
    try {
      const items = await window.__db.oc_items.where('orden_compra_id').equals(o.id)
        .filter(x => !x.deleted_at).toArray();
      const inventario = inventarioTextualDeEmpresa({ movs: movs || [], companyId: o.proveedor_company_id });
      const cruce = cruzarOrdenConInventario({
        items, inventario, mapeos: resolverMapeos(insumoMapeos || []),
      });
      setAtCruce(cruce);
      // ── EL CORRELATIVO, PROPUESTO ──────────────────────────────
      // No lo sabe SUNAT: el correlativo lo lleva el CONTRIBUYENTE y SUNAT solo
      // valida que no se repita. Así que la app lo puede saber HOY, sin
      // certificado ni clave SOL, mirando lo que esta empresa ya emitió en esa
      // serie. Ver el porqué completo en lib/serie-comprobante.js.
      const vendedora = lookupCompany(o.proveedor_company_id);
      const sig = siguienteComprobante(movs || [], { companyId: o.proveedor_company_id, company: vendedora });
      setAtBorrador({
        ...borradorDeFacturaDesdeOrden({ orden: o, items, cruce }),
        fecha: window.__fecha?.hoyLocal?.() || new Date().toISOString().slice(0, 10),
        documento: sig.documento,
        serieSugerida: sig,
        igvIncluido: false,
        nota: '',
      });
      setAtendiendo({ orden: o, items, inventario });
      // Abrirla ya cuenta como mirarla: pasa a «en revisión» sola para que la
      // otra contadora vea que alguien la tomó y no la trabajen las dos.
      if (estadoRespuesta(o) === 'pendiente') await marcarRespuesta(o, 'en_revision');
    } catch (e) { toast('No se pudo abrir la orden: ' + (e.message || e), 'red'); }
  };

  const cerrarAtencion = () => { setAtendiendo(null); setAtBorrador(null); setAtCruce([]); };

  const setAtLinea = (key, patch) => setAtBorrador(b => (!b ? b : {
    ...b, lineas: b.lineas.map(l => (l.key === key ? { ...l, ...patch } : l)),
  }));

  // 🔴 La fila se relee de Dexie antes de escribir: `atendiendo.orden` es el
  // snapshot con el que se abrió el modal, y abrirlo ya subió la versión (pasa
  // a «en revisión» solo). Escribir con la versión vieja manda el registro a
  // conflictos manuales del SyncEngine.
  const marcarRespuesta = async (o, estado, nota = null) => {
    try {
      const now = new Date().toISOString();
      const fresca = (await window.__db.ordenes_compra.get(o.id)) || o;
      await window.__db.ordenes_compra.update(o.id, {
        respuesta_estado: estado,
        ...(nota != null ? { respuesta_nota: nota } : {}),
        respuesta_at: now, respuesta_por: userId,
        updated_at: now, updated_by: userId,
        version: (fresca.version ?? 0) + 1,
        sync_status: fresca.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'ordenes_compra' } })); } catch {}
      await recargarOrdenes();
      return true;
    } catch (e) {
      toast('No se pudo actualizar la orden: ' + (e.message || e), 'red');
      return false;
    }
  };

  const rechazarRecibida = async (o) => {
    const motivo = window.prompt(`¿Por qué no se puede atender ${o.codigo || 'esta orden'}?`);
    if (!motivo || motivo.trim().length < 5) { toast('Hace falta un motivo (mín. 5 caracteres)', 'red'); return; }
    if (await marcarRespuesta(o, 'rechazada', motivo.trim())) {
      toast('Orden rechazada — quien la emitió lo ve en su lista', 'amber');
      cerrarAtencion();
    }
  };

  const totalesAt = uM(() => (atBorrador ? totalesDeBorrador(atBorrador) : { valorVenta: 0, igv: 0, total: 0 }), [atBorrador]);
  const avisosAt = uM(
    () => (atBorrador && atendiendo ? avisosDeFactura({ borrador: atBorrador, orden: atendiendo.orden }) : []),
    [atBorrador, atendiendo]
  );
  // Se puede tipear el número a mano —porque ya se emitió en el sistema del
  // contador externo— y ahí hay que avisar ANTES de duplicarlo, no después.
  const docRepetido = uM(
    () => (atBorrador?.documento && atendiendo
      ? documentoYaUsado(movs || [], { companyId: atendiendo.orden.proveedor_company_id, documento: atBorrador.documento })
      : null),
    [atBorrador, atendiendo, movs]
  );

  /**
   * EMITIR LA FACTURA CONTRA LA ORDEN.
   *
   * Escribe el PAR intercompany —ingreso en quien vende, costo en quien
   * compró— con el mismo molde que `generarFacturasInternas` (lib/
   * facturas-internas.js): `is_intercompany`, `related_company_id` y
   * `related_movement_id` cruzados. Es lo que hace que el Consolidado elimine
   * la operación interna en vez de contarla dos veces.
   *
   * Las líneas van en `notas.items_factura`, que es de donde las leen el
   * inventario, el abastecimiento y el mapeo. Escribirlas en otro lado sería
   * una factura invisible para el resto de la app.
   *
   * GUARD SÍNCRONO (regla crítica #2): un doble click acá emite DOS facturas
   * por la misma orden, y una factura duplicada en dos libros no se arregla
   * anulándola de un lado.
   */
  const emitirFacturaDeOrden = async () => {
    if (facturandoRef.current) return;
    if (!atendiendo || !atBorrador) return;
    const o = atendiendo.orden;
    const vendedora = lookupCompany(o.proveedor_company_id);
    const compradora = lookupCompany(o.company_id);
    if (!vendedora) { toast('No encuentro la empresa que recibe la orden', 'red'); return; }
    const lineas = atBorrador.lineas.filter(l => l.incluir);
    if (!lineas.length) { toast('No queda ninguna línea incluida', 'amber'); return; }
    if (lineas.some(l => !(Number(l.cantidad) > 0) || !(Number(l.precio_unitario) > 0))) {
      toast('Cada línea incluida necesita cantidad y precio', 'amber'); return;
    }
    if (docRepetido && !window.confirm(
      `El número ${atBorrador.documento} YA lo usó ${vendedora.name}.\n\n`
      + 'Repetir un correlativo es un rechazo de SUNAT que después hay que anular con nota de crédito.\n\n'
      + '¿Emitir igual?'
    )) return;
    const graves = avisosAt.filter(a => a.nivel === 'alto');
    if (!window.confirm(
      `Emitir la factura de ${vendedora.name} a ${compradora?.name || 'quien emitió la orden'}?\n\n`
      + `${lineas.length} línea(s) · ${fmtS(totalesAt.total)}\n\n`
      + (graves.length ? `⚠ ${graves.map(a => a.texto).join('\n\n')}\n\n` : '')
      + 'Se escriben los DOS lados: el ingreso en quien vende y el costo en quien compró.'
    )) return;

    facturandoRef.current = true;
    setAtGuardando(true);
    try {
      const now = new Date().toISOString();
      const fecha = atBorrador.fecha || now.slice(0, 10);
      const items = itemsFacturaDeBorrador(atBorrador);
      const ventaId = window.__newId();
      const compraId = window.__newId();
      const doc = String(atBorrador.documento || '').trim() || null;
      const meta = {
        items_factura: items,
        // De qué pedido salió esta factura. Es lo que permite cuadrar los dos
        // papeles cuando la contadora renombró las líneas — que es el caso
        // normal, no la excepción.
        orden_compra: {
          id: o.id, codigo: o.codigo, emitida_por: o.company_id,
          total_orden: Number(o.monto_total || 0),
        },
        subtotal: totalesAt.valorVenta, igv: totalesAt.igv, total: totalesAt.total,
      };

      const comun = {
        date: fecha,
        amount: totalesAt.total,
        currency: o.moneda || 'PEN',
        document_type: 'factura',
        document_number: doc,
        payment_status: 'pending',
        estado_factura: 'borrador',
        is_intercompany: true,
        obra_id: o.obra_id || null,
        trabajo_id: o.trabajo_id || null,
        created_by: userId, updated_by: userId,
        created_at: now, updated_at: now,
        version: 1, sync_status: 'pending_create', last_synced_at: null,
        deleted_at: null,
      };

      // 1) El INGRESO de quien atiende la orden.
      await window.__db.accounting_movements.add({
        ...comun,
        id: ventaId,
        company_id: vendedora.id,
        clase: 'venta',
        type: derivarTypeContable({ clase: 'venta', is_intercompany: true }),
        category: 'venta_intercompany',
        description: `Venta a ${compradora?.name || 'empresa del grupo'} · orden ${o.codigo || ''}`.trim(),
        third_party_name: compradora?.legal_name || compradora?.name || o.proveedor_nombre || null,
        third_party_ruc: compradora?.ruc || null,
        related_company_id: compradora?.id || null,
        related_movement_id: compraId,
        recepcion_status: 'no_aplica',
        notas: JSON.stringify({ ...meta, rol: 'vendedor' }),
        idempotency_key: `${userId}_acc_${ventaId}`,
      });

      // 2) El COSTO de quien la emitió. Sin este lado, la empresa que pidió el
      //    material tendría una orden atendida y ninguna compra que la respalde.
      await window.__db.accounting_movements.add({
        ...comun,
        id: compraId,
        company_id: o.company_id,
        clase: 'compra',
        type: derivarTypeContable({ clase: 'compra', is_intercompany: true }),
        category: 'compra_intercompany',
        description: `Compra a ${vendedora.name} · orden ${o.codigo || ''}`.trim(),
        third_party_name: vendedora.legal_name || vendedora.name,
        third_party_ruc: vendedora.ruc || null,
        related_company_id: vendedora.id,
        related_movement_id: ventaId,
        // La compra QUEDA RESPALDADA por la orden que la originó: es el vínculo
        // que la pestaña «Sin respaldo» busca, y acá nace lleno de fábrica.
        orden_compra_id: o.id,
        recepcion_status: o.obra_id ? 'pendiente_recepcion' : 'no_aplica',
        notas: JSON.stringify({ ...meta, rol: 'comprador' }),
        idempotency_key: `${userId}_acc_${compraId}`,
      });

      // 3) La orden queda facturada, apuntando a la venta. Se relee por lo
      //    mismo que marcarRespuesta: abrir el modal ya le subió la versión.
      const fresca = (await window.__db.ordenes_compra.get(o.id)) || o;
      await window.__db.ordenes_compra.update(o.id, {
        respuesta_estado: 'facturada',
        respuesta_movimiento_id: ventaId,
        respuesta_nota: atBorrador.nota || null,
        respuesta_at: now, respuesta_por: userId,
        // El emisor ve que su pedido ya está atendido.
        estado: ANULADA.has(fresca.estado) ? fresca.estado : 'aceptada',
        updated_at: now, updated_by: userId,
        version: (fresca.version ?? 0) + 1,
        sync_status: fresca.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });

      // 4) EL MAPEO QUE SALE DE REGALO, otra vez. Cada línea que la contadora
      //    renombró de «lo que pidieron» a «como lo tengo yo» es una decisión
      //    de equivalencia — la misma que se aprende al armar la orden.
      let aprendidos = 0;
      for (const l of lineas) {
        if (!l.insumo_codigo || l.nombre === l.nombreOrden) continue;
        const fila = mapeoImplicito({
          descripcionCompra: l.nombre,
          insumoCodigo: l.insumo_codigo,
          unidadCompra: l.unidad,
          unidadInsumo: l.unidad,
          nota: `Decidido al facturar la orden ${o.codigo || ''}`.trim(),
        });
        if (!fila) continue;
        try {
          const mid = window.__newId();
          await window.__db.insumo_mapeo.add({
            ...fila, id: mid, demo: false,
            created_by: userId, updated_by: userId, created_at: now, updated_at: now,
            version: 1, sync_status: 'pending_create', last_synced_at: null,
            idempotency_key: `${userId}_mapeo_${mid}`,
          });
          aprendidos++;
        } catch (e) { console.warn('[ordenes] mapeo no guardado:', e); }
      }

      try {
        await window.__logAudit?.({
          action: 'create', table: 'accounting_movements', recordId: ventaId,
          newData: { orden: o.codigo, total: totalesAt.total, lineas: items.length },
          reason: `Factura emitida contra la orden recibida ${o.codigo || o.id} (par intercompany)`,
        });
      } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'accounting_movements' } })); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'ordenes_compra' } })); } catch {}
      await recargarOrdenes();
      cerrarAtencion();
      toast(`Factura emitida por ${fmtS(totalesAt.total)} — queda en los dos libros, como borrador`, 'green');
      if (aprendidos) toast(`${aprendidos} equivalencia(s) aprendida(s) para el mapeo`, 'blue');
    } catch (e) {
      console.error('[ordenes] no se pudo emitir la factura:', e);
      toast('No se pudo emitir la factura: ' + (e.message || e), 'red');
    } finally {
      facturandoRef.current = false;
      setAtGuardando(false);
    }
  };

  const empresasConMovs = uM(() => {
    const ids = new Set((movs || []).map(m => m.company_id).filter(Boolean));
    (ordenes || []).forEach(o => { if (o.company_id) ids.add(o.company_id); });
    return (companies || []).filter(c => !c.deleted_at && ids.has(c.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [companies, movs, ordenes]);

  const Banner = window.EmpresaActivaBanner;
  const obraScope = obraScopeId ? lookupObra(obraScopeId) : null;

  return (
    <div className="page-wrap">
      <div className="pg-hd">
        <div>
          <div className="pg-title">Órdenes de compra y servicio</div>
          <div className="pg-sub">
            {emitidas.length} órdenes · {fmtSk(emitidas.reduce((s, o) => s + Number(o.monto_total || 0), 0))}
            {obraScope ? ' · esta obra' : (companyId ? ` · ${lookupCompany(companyId)?.name || ''}` : ' · todo el grupo')}
          </div>
        </div>
      </div>

      {/* EL CARTEL DE LA OBRA (tanda 6). Hermano del de empresa y del de
          Movimientos de esta obra: sin él, una lista más corta de lo normal no
          tendría explicación — y no habría forma de salir del ámbito. */}
      {obraScope && (
        <div className="card card-p" style={{
          marginBottom: 12, borderLeft: '3px solid var(--amber)',
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <JxIcon name="hardHat" size={16} color="var(--amber)" />
          <div style={{ flex: 1, minWidth: 200, fontSize: 12, color: 'var(--ts)' }}>
            Las órdenes que respaldan las compras de <strong style={{ color: 'var(--tp)' }}>{obraScope.nombre_obra}</strong>
            <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 2 }}>
              Cada orden la numera la empresa que la emite (OC-001-2026 por RUC), pero aquí solo se ven
              las de este trabajo — incluidas las de las otras empresas del grupo que le compran.
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => window.__navTo?.('ordenes', 'general')}
            title="Salir del ámbito de la obra y ver las órdenes de todo el grupo">
            Ver las de todo el grupo →
          </button>
        </div>
      )}

      {!obraScope && Banner && <Banner onSalir={() => { setFiltroEmpresa('todas'); setBorradores([]); }} />}

      {/* ── LA BARRA DEL RESPALDO ───────────────────────────────────
          El número que Gabriel fue a buscar y no estaba: cuánto del dinero
          por encima del umbral tiene un papel que lo respalde. */}
      <div className="card card-p" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 2 }}>
              Respaldo de compras por encima de {fmtS(resumen.umbral)}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>
              {resumen.respaldados} de {resumen.sobreUmbral} comprobantes tienen orden ·{' '}
              <strong style={{ color: resumen.sinRespaldo ? 'var(--amber)' : 'var(--green)' }}>
                {fmtS(resumen.montoSinRespaldo)} sin respaldo
              </strong>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: resumen.pctRespaldado >= 90 ? 'var(--green)' : 'var(--amber)' }}>
              {resumen.pctRespaldado.toFixed(0)}%
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>del monto respaldado</div>
          </div>
        </div>
        <div style={{ height: 6, background: 'var(--bg-c2)', borderRadius: 3, marginTop: 10, overflow: 'hidden' }}>
          <div style={{
            width: `${Math.min(100, resumen.pctRespaldado)}%`, height: '100%',
            background: resumen.pctRespaldado >= 90 ? 'var(--green)' : 'var(--amber)',
          }} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${tab === 'emitidas' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('emitidas')}>
          Emitidas ({emitidas.length})
        </button>
        {/* Solo para consorcios ejecutores (tanda 14): el respaldo por orden es
            exigencia de la obra que ejecuta el consorcio, no del giro de una
            empresa del grupo comprándole a su ferretería. */}
        {hayPestanaRespaldo && (
          <button className={`btn btn-sm ${tab === 'respaldo' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('respaldo')}>
            Sin respaldo ({resumen.sinRespaldo})
          </button>
        )}
        {/* La puerta que faltaba: una orden que nace ANTES del comprobante. */}
        <button className={`btn btn-sm ${tab === 'nueva' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('nueva')}>
          Nueva orden{lineas.length ? ` (${lineas.length})` : ''}
        </button>
        {/* EL OTRO LADO DEL MISMO PAPEL: las que nos emitieron a nosotros. */}
        {empresasConBuzon.length > 0 && (
          <button className={`btn btn-sm ${tab === 'recibidas' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('recibidas')}>
            <JxIcon name="inbox" size={13} /> Recibidas{porAtender ? ` (${porAtender})` : ''}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        {/* ⚠️ EL SELECTOR SE VA CUANDO EL ÁMBITO YA DECIDIÓ LA EMPRESA.
            Gabriel, 6-set-2026: «si se ingresa desde CONSORCIO LINKA o desde el
            trabajo de la obra donde LINKA es el ejecutor, debería salirme
            solamente LINKA, pero hay un desplegable que me muestra todas […] y
            creo que ni siquiera tiene una función directa. Si no funciona,
            deberías quitar eso».

            Tenía razón por partida doble. Dentro de una EMPRESA el <select>
            estaba `disabled` con una sola opción: un control que no controla
            nada. Y dentro de una OBRA sí cambiaba la lista, pero ofrecía
            filtrar por empresas que no tienen nada que ver con ese trabajo, y
            el cartel de arriba ya dice —correctamente— que acá se ven las de
            TODAS las empresas del grupo que le compran a la obra. Cortar eso a
            mano escondía justamente la cadena intercompany, que en Miraflores
            son 3 de cada 4 comprobantes.

            El buscador de al lado sigue filtrando por proveedor, código o rubro,
            que es como se busca una orden de verdad. */}
        {/* `!enObra` además de `!emisoraFija`: una obra sin titular contable
            identificable deja `emisoraFija` en null, y ahí el <select> volvería
            a aparecer — y peor, `setEmpresaActivaId` dejaría el contexto de esa
            empresa pegado al salir del trabajo (el bug que arregló la tanda 6). */}
        {!emisoraFija && !enObra && (
          <select className="fi" value={filtroEmpresa}
            onChange={e => {
              setFiltroEmpresa(e.target.value);
              setEmpresaActivaId(e.target.value === 'todas' ? null : e.target.value);
              setBorradores([]);
            }} style={{ minWidth: 220 }}>
            <option value="todas">Todas las empresas</option>
            {empresasConMovs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {emisoraFija && (
          <div className="fi" style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: 0.85, minWidth: 220 }}
            title={obraScopeId
              ? 'Las órdenes de esta obra las emite quien la ejecuta. Acá se ven además las de las otras empresas del grupo que le compran a la obra.'
              : 'Estás dentro de la contabilidad de esta empresa: son SUS órdenes.'}>
            <JxIcon name="lock" size={12} />
            <b style={{ fontSize: 12 }}>{lookupCompany(emisoraFija)?.name || '—'}</b>
          </div>
        )}
        {tab === 'recibidas' && (
          <>
            <select className="fi" value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)} style={{ minWidth: 160 }}>
              <option value="todos">Compra y servicio</option>
              <option value="compra">Solo órdenes de compra</option>
              <option value="servicio">Solo órdenes de servicio</option>
            </select>
            <div className="search-bar" style={{ flex: '1 1 180px' }}>
              <JxIcon name="search" size={14} color="var(--tm)" />
              <input placeholder="Buscar código, rubro u obra…" value={buzonBusca} onChange={e => setBuzonBusca(e.target.value)} />
            </div>
            <label style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 5, color: 'var(--tm)' }}>
              <input type="checkbox" checked={buzonCerradas} onChange={e => setBuzonCerradas(e.target.checked)} />
              ver las ya facturadas y rechazadas
            </label>
          </>
        )}
        {tab === 'emitidas' && (
          <>
            <select className="fi" value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)} style={{ minWidth: 160 }}>
              <option value="todos">Compra y servicio</option>
              <option value="compra">Solo órdenes de compra</option>
              <option value="servicio">Solo órdenes de servicio</option>
            </select>
            <div className="search-bar" style={{ flex: '1 1 180px' }}>
              <JxIcon name="search" size={14} color="var(--tm)" />
              <input placeholder="Buscar código, proveedor o rubro…" value={busqueda} onChange={e => setBusqueda(e.target.value)} />
            </div>
            <label style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 5, color: 'var(--tm)' }}>
              <input type="checkbox" checked={verAnuladas} onChange={e => setVerAnuladas(e.target.checked)} /> ver anuladas
            </label>
          </>
        )}
      </div>

      {/* ═══ NUEVA ORDEN — la que nace antes del comprobante (tanda 7) ═══ */}
      {tab === 'nueva' ? (
        <div>
          {/* ══ QUÉ ESTOY EMITIENDO — LO PRIMERO Y EN GRANDE ═════════
              Gabriel, 7-set-2026: «nos hemos centrado mucho en las Órdenes de
              Compra que esta sección parece que no tuviera para Órdenes de
              Servicio, te puedes fijar por qué en la captura sale como órdenes
              de compra y no agrega servicios».

              El tipo SÍ existía —desde la mig 179— pero era el segundo de
              cuatro <select> apretados arriba, y todo lo de abajo hablaba de
              compras. Un campo que decide el título del documento, la serie
              (OC/OS), la unidad por defecto y qué ayuda tiene sentido no puede
              estar escondido entre la fecha y el IGV. */}
          <div className="card card-p" style={{ marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--tm)' }}>Qué vas a emitir:</span>
            {[['compra', 'Orden de Compra', 'package', 'bienes y materiales'],
              ['servicio', 'Orden de Servicio', 'tool', 'mano de obra, alquileres, fletes']].map(([v, lbl, ic, sub]) => (
              <button key={v} className={`btn ${nueva.tipo === v ? 'btn-amber' : 'btn-ghost'}`}
                onClick={() => setNueva(n => ({
                  ...n, tipo: v,
                  // La unidad por defecto de las líneas VACÍAS acompaña al tipo:
                  // «SERV» en una orden de servicio, «UND» en una de compra.
                }))}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, padding: '7px 14px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                  <JxIcon name={ic} size={14} /> {lbl}
                </span>
                <span style={{ fontSize: 10, opacity: 0.75 }}>{sub}</span>
              </button>
            ))}
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--tm)' }}>
              Se numera como <b style={{ fontFamily: 'monospace' }}>{textosDeTipo(nueva.tipo).prefijo}-001-{new Date().getFullYear()}</b>,
              en la serie propia de la empresa que emite.
            </span>
          </div>

          {/* ── LA CABECERA: quién emite, a quién, y con qué condiciones ── */}
          <div className="card card-p" style={{ marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              <label>
                <div style={{ fontSize: 11, color: 'var(--tm)' }}>Empresa que EMITE la orden *</div>
                {emisoraFija ? (
                  <div className="fi" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, opacity: 0.85 }}
                    title={obraScopeId
                      ? 'La orden la emite la empresa que ejecuta esta obra. No se elige: si se numerara en la serie de otra, sería un error que después no se arregla.'
                      : 'Estás dentro de la contabilidad de esta empresa: la orden es suya.'}>
                    <JxIcon name="lock" size={12} />
                    <b>{lookupCompany(emisoraFija)?.name || lookupCompany(emisoraFija)?.legal_name || '—'}</b>
                  </div>
                ) : (
                  <select className="fi" style={{ width: '100%' }} value={nueva.companyId}
                    onChange={e => setNu({ companyId: e.target.value })}>
                    <option value="">— Elige la empresa —</option>
                    {(companies || []).filter(c => !c.deleted_at).map(c => (
                      <option key={c.id} value={c.id}>{c.name || c.legal_name}</option>
                    ))}
                  </select>
                )}
              </label>
              <label>
                <div style={{ fontSize: 11, color: 'var(--tm)' }}>Fecha</div>
                <input className="fi" type="date" style={{ width: '100%' }} value={nueva.fecha}
                  onChange={e => setNu({ fecha: e.target.value })} />
              </label>
              <label>
                <div style={{ fontSize: 11, color: 'var(--tm)' }}>IGV %</div>
                <input className="fi" type="number" min="0" max="18" step="any" style={{ width: '100%' }}
                  value={nueva.igvPct} onChange={e => setNu({ igvPct: e.target.value })} />
              </label>
            </div>

            {/* ══ ¿LOS PRECIOS QUE ESCRIBO YA TRAEN IGV? (tanda 9) ══════
                Gabriel: «a veces hay facturas donde te las generan con costo
                sin IGV y se lo agregan al final, y en otras ocasiones colocan
                los precios con IGV y simplemente al final sale el desagregado».
                Las dos son verdad. Lo que no puede pasar es que la app asuma
                una mientras la persona tipea la otra: ahí el total sale 18 %
                corrido y nadie se entera hasta que reclama el proveedor. */}
            <label style={{
              marginTop: 10, display: 'flex', gap: 8, alignItems: 'flex-start',
              fontSize: 12, cursor: 'pointer',
            }}>
              <input type="checkbox" checked={!!nueva.igvIncluido} style={{ marginTop: 2 }}
                onChange={e => setNu({ igvIncluido: e.target.checked })} />
              <span>
                <b>Los precios que escribo ya incluyen IGV</b>
                <div style={{ fontSize: 11, color: 'var(--tm)' }}>
                  {nueva.igvIncluido
                    ? `El total es lo que sumen las líneas y el valor de venta se despeja hacia atrás (÷ ${(1 + Number(nueva.igvPct || 0) / 100).toFixed(2)}).`
                    : `Cada precio es valor de venta y el IGV del ${Number(nueva.igvPct || 0)} % se suma al final.`}
                  {' '}En la orden se guarda siempre el valor de venta, para que dos compras del mismo insumo se puedan comparar.
                </div>
              </span>
            </label>

            {/* ══ A QUIÉN SE LE COMPRA — UN BUSCADOR, NO TRES LISTAS ══════
                Gabriel, 6-set-2026: «buscar rápidamente el RUC, si es que me
                acuerdo, para emitir esta orden […] y en caso de que sea un RUC
                nuevo, un proveedor nuevo o una empresa de terceros nueva, pues
                el bloque de qué tiene la empresa del grupo no tiene caso que
                esté allí».

                Antes había que decidir PRIMERO la clase del destinatario y
                recién después buscarlo, cada clase en su propio <select>. Eso
                invierte el orden real: quien emite sabe el RUC o el nombre, no
                si ese RUC está cargado como proveedor, como empresa nuestra, o
                si nunca se le dio de alta. La clase es la RESPUESTA. */}
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11.5, color: 'var(--tm)', marginBottom: 6 }}>¿A quién se le compra? *</div>

              {destinatarioElegido ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                  padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 6,
                  background: 'var(--bg-c2)',
                }}>
                  <JxIcon name={nueva.provModo === 'grupo' ? 'building' : 'truck'} size={15}
                    color={nueva.provModo === 'grupo' ? 'var(--blue)' : 'var(--tm)'} />
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontWeight: 700, fontSize: 12.5 }}>{proveedorDeNueva.nombre}</div>
                    <div style={{ fontSize: 11, color: 'var(--tm)' }}>
                      {proveedorDeNueva.ruc ? `RUC ${proveedorDeNueva.ruc}` : 'sin RUC'}
                      {proveedorDeNueva.direccion ? ` · ${proveedorDeNueva.direccion}` : ''}
                    </div>
                  </div>
                  <span className={`badge ${nueva.provModo === 'grupo' ? 'b-blue' : nueva.provModo === 'registrado' ? 'b-gray' : 'b-amber'}`}>
                    {nueva.provModo === 'grupo' ? 'Empresa del grupo'
                      : nueva.provModo === 'registrado' ? 'Proveedor del catálogo' : 'Se escribe en esta orden'}
                  </span>
                  <button className="btn btn-ghost btn-sm" onClick={limpiarDestinatario}>Cambiar</button>
                </div>
              ) : (
                <>
                  <div className="search-bar" style={{ width: '100%' }}>
                    <JxIcon name="search" size={14} color="var(--tm)" />
                    <input autoFocus={tab === 'nueva'}
                      placeholder="Busca por RUC (20512345678) o por razón social (ferretería, GASOMI…)"
                      value={provBusca} onChange={e => { setProvBusca(e.target.value); setProvAlta(false); }} />
                  </div>

                  {provBusca.trim().length >= 2 && (
                    <div className="card" style={{ marginTop: 6, overflow: 'hidden' }}>
                      {resultadosProv.length === 0 ? (
                        <div style={{ padding: 12, fontSize: 11.5, color: 'var(--tm)' }}>
                          {esBusquedaPorRuc(provBusca)
                            ? 'Ese RUC no está ni en tus empresas, ni en el catálogo de proveedores, ni en ninguna factura cargada.'
                            : 'Nadie con ese nombre está cargado ni aparece en una factura.'}
                        </div>
                      ) : resultadosProv.map(c => (
                        <button key={c.clave} className="btn btn-ghost"
                          onClick={() => elegirDestinatario(c)}
                          style={{
                            display: 'flex', width: '100%', textAlign: 'left', gap: 10,
                            alignItems: 'center', borderRadius: 0,
                            borderBottom: '1px solid var(--border)', padding: '8px 12px',
                          }}>
                          <JxIcon name={c.tipo === 'grupo' ? 'building' : 'truck'} size={14}
                            color={c.tipo === 'grupo' ? 'var(--blue)' : 'var(--tm)'} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 600 }}>{c.nombre}</div>
                            <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                              {c.ruc ? `RUC ${c.ruc}` : 'sin RUC cargado'}
                              {c.veces > 0 && ` · ${c.veces} comprobante${c.veces === 1 ? '' : 's'}`}
                            </div>
                          </div>
                          <span className={`badge ${c.tipo === 'grupo' ? 'b-blue' : c.tipo === 'proveedor' ? 'b-gray' : 'b-amber'}`}
                            style={{ fontSize: 9.5 }}>
                            {etiquetaTipo(c.tipo)}
                          </span>
                        </button>
                      ))}

                      {/* Dar de alta uno nuevo. Con el RUC ya tipeado: es el
                          caso que Gabriel describió («un RUC nuevo»). Si el RUC
                          YA existe no se ofrece — un duplicado hoy es una
                          fusión a mano mañana. */}
                      {rucYaExiste ? (
                        <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--amber)' }}>
                          Ese RUC ya está arriba, como <b>{rucYaExiste.nombre}</b>. Elígelo en vez de cargarlo otra vez.
                        </div>
                      ) : (
                        <button className="btn btn-ghost"
                          onClick={() => {
                            setProvAlta(true);
                            setNu({
                              provModo: 'nuevo', provCompanyId: '', provId: '',
                              provRuc: rucTipeado || '',
                              provNombre: rucTipeado ? '' : provBusca.trim(),
                              provDireccion: '',
                            });
                          }}
                          style={{ display: 'flex', width: '100%', gap: 8, alignItems: 'center', borderRadius: 0, padding: '9px 12px' }}>
                          <JxIcon name="plus" size={13} color="var(--amber)" />
                          <span style={{ fontSize: 12 }}>
                            No es ninguno de éstos — escribirlo{rucTipeado ? ` con el RUC ${rucTipeado}` : ''}
                          </span>
                        </button>
                      )}
                    </div>
                  )}

                  {provBusca.trim().length < 2 && (
                    <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 6 }}>
                      Busca entre tus {(companies || []).filter(c => !c.deleted_at).length} empresas, los{' '}
                      {(proveedores || []).length} proveedores del catálogo y todos los terceros a los que
                      alguna vez se les compró con papel.{' '}
                      <button className="btn btn-ghost btn-xs" onClick={() => { setProvAlta(true); setNu({ provModo: 'nuevo' }); }}>
                        o escribirlo a mano
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* Los datos del que se está dando de alta. Aparecen solo cuando
                  se eligió escribirlo: para un proveedor ya cargado no hay nada
                  que tipear. */}
              {provAlta && nueva.provModo === 'nuevo' && !destinatarioElegido && (
                <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
                  <label>
                    <div style={{ fontSize: 11, color: 'var(--tm)' }}>Razón social *</div>
                    <input className="fi" autoFocus style={{ minWidth: 260 }} value={nueva.provNombre}
                      onChange={e => setNu({ provNombre: e.target.value })} placeholder="DISTRIBUIDORA ... SAC" />
                  </label>
                  <label>
                    <div style={{ fontSize: 11, color: 'var(--tm)' }}>RUC</div>
                    <input className="fi" style={{ width: 150 }} value={nueva.provRuc} inputMode="numeric"
                      onChange={e => setNu({ provRuc: e.target.value })} placeholder="20512345678" />
                  </label>
                  {/* A PEDIDO, no al tipear: el plan de consultas es de 100 al
                      mes. Y si falla, la razón social se escribe a mano. */}
                  <button className="btn btn-sm" disabled={consultandoRuc || !pareceRuc(nueva.provRuc)}
                    style={{ marginBottom: 6 }} onClick={traerDeSunat}
                    title="Trae la razón social y la dirección de SUNAT con ese RUC">
                    <JxIcon name="search" size={12} /> {consultandoRuc ? 'Consultando…' : 'Traer de SUNAT'}
                  </button>
                  <label>
                    <div style={{ fontSize: 11, color: 'var(--tm)' }}>Dirección</div>
                    <input className="fi" style={{ minWidth: 220 }} value={nueva.provDireccion}
                      onChange={e => setNu({ provDireccion: e.target.value })} />
                  </label>
                  <label style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 5, color: 'var(--tm)', paddingBottom: 6 }}>
                    <input type="checkbox" checked={nueva.guardarProveedor}
                      onChange={e => setNu({ guardarProveedor: e.target.checked })} />
                    guardarlo en el catálogo
                  </label>
                  {nueva.provRuc && !pareceRuc(nueva.provRuc) && (
                    <div style={{ fontSize: 11, color: 'var(--amber)', width: '100%' }}>
                      Ese RUC no tiene 11 dígitos con prefijo 10/15/17/20. Igual se puede emitir —
                      revísalo antes de firmar.
                    </div>
                  )}
                  {pareceRuc(nueva.provRuc) && porRucExacto(directorio, nueva.provRuc) && (
                    <div style={{ fontSize: 11, color: 'var(--amber)', width: '100%' }}>
                      Ojo: ese RUC ya existe como <b>{porRucExacto(directorio, nueva.provRuc).nombre}</b>.
                    </div>
                  )}
                </div>
              )}
            </div>

            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--tm)' }}>Condiciones y datos del documento (opcional)</summary>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 10 }}>
                <label><div style={{ fontSize: 11, color: 'var(--tm)' }}>Título / rubro</div>
                  <input className="fi" style={{ width: '100%' }} value={nueva.titulo} onChange={e => setNu({ titulo: e.target.value })} /></label>
                <label><div style={{ fontSize: 11, color: 'var(--tm)' }}>Fecha de entrega</div>
                  <input className="fi" type="date" style={{ width: '100%' }} value={nueva.fechaEntrega} onChange={e => setNu({ fechaEntrega: e.target.value })} /></label>
                <label><div style={{ fontSize: 11, color: 'var(--tm)' }}>Lugar de entrega</div>
                  <input className="fi" style={{ width: '100%' }} value={nueva.lugarEntrega} onChange={e => setNu({ lugarEntrega: e.target.value })} /></label>
                <label><div style={{ fontSize: 11, color: 'var(--tm)' }}>Condición de pago</div>
                  <input className="fi" style={{ width: '100%' }} value={nueva.condicionPago} onChange={e => setNu({ condicionPago: e.target.value })} placeholder="Contado / 30 días" /></label>
                <label style={{ gridColumn: '1 / -1' }}><div style={{ fontSize: 11, color: 'var(--tm)' }}>Notas para el proveedor</div>
                  <input className="fi" style={{ width: '100%' }} value={nueva.notas} onChange={e => setNu({ notas: e.target.value })} /></label>
              </div>
              <p style={{ fontSize: 11, color: 'var(--tm)', margin: '8px 0 0' }}>
                El PDF sale con el logo, el RUC y la numeración de la empresa que emite.
              </p>
            </details>
          </div>

          {/* ── LOS AYUDANTES DE LA OBRA ─────────────────────────────
              Solo dentro de un trabajo, y solo como ATAJOS: agregan líneas al
              mismo formulario de arriba. Sin obra no hay presupuesto contra
              qué comparar, y la orden se llena a mano — que es el caso normal
              de una empresa comprándole a un tercero. */}
          {/* ══ LOS DOS BLOQUES DE AYUDA ══════════════════════════════
              A la izquierda lo que la obra NECESITA; a la derecha lo que las
              empresas del grupo YA COMPRARON. Ninguno depende del mapeo — el
              mapeo es lo que se GENERA al cruzarlos, que es exactamente lo que
              pidió la jefa de contabilidad. */}
          {/* ⚠️ EL BLOQUE DEL GRUPO SE ESCONDE CUANDO NO VIENE AL CASO.
              Gabriel: «en caso de que sea un RUC nuevo, un proveedor nuevo o
              una empresa de terceros nueva […] el bloque de qué tiene la
              empresa del grupo no tiene caso que esté allí, porque no vamos a
              utilizar algo que tenga una empresa a la cual no le vamos a emitir
              la orden». Tiene razón: enlazar una línea al stock de GASOMI en
              una orden dirigida a una ferretería de terceros escribe un origen
              que no existe.

              Sigue visible mientras NO se eligió destinatario: ahí el bloque es
              justamente la forma de descubrir a quién comprarle. */}
          <div style={{ display: 'grid', gridTemplateColumns: (obraScopeId && mostrarBloqueGrupo) ? 'repeat(auto-fit, minmax(320px, 1fr))' : '1fr', gap: 12, marginBottom: 12 }}>
            {obraScopeId && (
              <div className="card" style={{ overflow: 'hidden' }}>
                <div style={{ padding: '9px 12px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <b style={{ fontSize: 12.5 }}>Qué necesita la obra</b>
                    {/* El presupuesto de producción tiene tres tipos: material,
                        mano_obra y equipo. En una orden de SERVICIO no sirve
                        ofrecer materiales, y al revés tampoco — pero el tipo lo
                        cargó otra persona y puede estar mal puesto, así que el
                        escape está siempre a un clic. */}
                    <button className="btn btn-xs btn-ghost" style={{ marginLeft: 'auto' }}
                      onClick={() => setNecTodoTipo(v => !v)}
                      title={necTodoTipo ? 'Volver a mostrar solo lo que aplica a este tipo de orden' : 'Mostrar todo el presupuesto, sin acotar por tipo'}>
                      {necTodoTipo ? 'acotar al tipo' : 'ver todo el presupuesto'}
                    </button>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                    Del presupuesto. Al elegir uno se agrega al detalle, y ahí puedes cambiarle el nombre, la cantidad y el precio.
                    {!necTodoTipo && (
                      <> Mostrando solo <b>{nueva.tipo === 'servicio' ? 'mano de obra y equipos' : 'materiales'}</b>, que es lo que
                      aplica a una {textosDeTipo(nueva.tipo).titulo.toLowerCase()}.</>
                    )}
                  </div>
                  <input className="fi" style={{ width: '100%', marginTop: 6, fontSize: 12 }}
                    placeholder="Buscar en el presupuesto: cemento, fierro, tubería…"
                    value={buscaNec} onChange={e => setBuscaNec(e.target.value)} />
                </div>
                <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                  {sugNecesita.length === 0 ? (
                    <div style={{ padding: 14, fontSize: 11.5, color: 'var(--tm)', textAlign: 'center' }}>
                      {buscaNec ? 'Nada del presupuesto coincide con eso.' : 'Escribe qué estás buscando.'}
                    </div>
                  ) : sugNecesita.map(f => (
                    <div key={f.codigo} style={{ padding: '7px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11.5, fontWeight: 600 }}>{f.nombre}</div>
                        {/* ⚠️ HAY INSUMOS QUE EL PRESUPUESTO NO MIDE EN CANTIDAD.
                            «HERRAMIENTAS MANUALES» viene en %mo —un porcentaje de
                            la mano de obra— repartido en 1.115 partidas: sumar sus
                            cantidades da 33,34, que no son 33 de nada. Su avance se
                            lee en plata, que es lo único que ahí significa algo. */}
                        {esUnidadPorcentual(f.unidad) && montoDeInsumo(f.codigo) ? (() => {
                          const im = montoDeInsumo(f.codigo);
                          return (
                            <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                              presupuesta <b style={{ color: 'var(--tp)' }}>{fmtS(im.presupuestado)}</b>
                              {im.cubierto > 0 && <> · ya en órdenes {fmtS(im.cubierto)}</>}
                              {' · '}<b style={{ color: im.falta > 0 ? 'var(--red)' : 'var(--green)' }}>falta {fmtS(im.falta)}</b>
                              {' · '}<span title={`El presupuesto lo pide como ${f.unidad} en ${im.partidas} partidas, así que su avance se mide en soles y no en cantidad`}>se mide en plata</span>
                            </div>
                          );
                        })() : (
                          <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                            necesita {cantF(f.necesita)} {f.unidad}
                            {f.yaComprado > 0 && <> · ya compró {cantF(f.yaComprado)}</>}
                            {' · '}<b style={{ color: f.falta > 0 ? 'var(--red)' : 'var(--green)' }}>falta {cantF(f.falta)}</b>
                          </div>
                        )}
                      </div>
                      <button className="btn btn-xs btn-amber" title="Agregar al detalle de la orden"
                        onClick={() => {
                          const k = window.__newId();
                          const im = esUnidadPorcentual(f.unidad) ? montoDeInsumo(f.codigo) : null;
                          setLineas(ls => [...ls, {
                            ...lineaVacia(), key: k,
                            descripcion: f.nombre,
                            // Un insumo en %mo no se pide «33,34 %mo»: se pide una
                            // vez, por lo que falta en soles.
                            unidad: im ? 'GLB' : (f.unidad || 'UND'),
                            cantidad: im ? 1 : (f.falta > 0 ? f.falta : ''),
                            precio_unitario: im && im.falta > 0 ? im.falta : '',
                            insumo_codigo: f.codigo, insumo_nombre: f.nombre, insumo_unidad: f.unidad,
                          }]);
                          setLineaFoco(k);
                        }}>+ agregar</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {mostrarBloqueGrupo && (
            <div className="card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '9px 12px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <b style={{ fontSize: 12.5 }}>
                    {nueva.provModo === 'grupo' && proveedorDeNueva.nombre
                      ? `Qué tiene ${proveedorDeNueva.nombre}`
                      : 'Qué tienen las empresas del grupo'}
                  </b>
                  {/* ══ POR EMPRESA O POR NOMBRE (tanda 9, Acote 1) ═══════
                      Gabriel: «me gustaría que se pudiera mostrar por bloque
                      (opción seleccionable) de tal manera que me salgan el
                      bloque de cemento que compró GASOMI, aunque sean con
                      diferentes nombres».

                      En producción el mismo cemento está escrito de cuatro
                      formas, y la lista salía con las cuatro sueltas. Para
                      decidir a quién comprarle eso está al revés: la pregunta
                      es «¿cuánto cemento tiene GASOMI?». */}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                    {[['empresa', 'por empresa'], ['nombre', 'por nombre']].map(([v, lbl]) => (
                      <button key={v} className={`btn btn-xs ${vistaGrupo === v ? 'btn-amber' : 'btn-ghost'}`}
                        onClick={() => { setVistaGrupo(v); setDetalleOferta(null); }}>{lbl}</button>
                    ))}
                  </div>
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                  {!buscaGrupo.trim() && vistaGrupo === 'empresa' ? (
                    <>Todo lo que el grupo compró y todavía no vendió, por empresa y por familia.
                    {' '}Con <b>+ agregar los N</b> entra el bloque entero al detalle de la orden.</>
                  ) : (
                    <>Busca sobre lo que dicen las facturas, sin necesitar el mapeo.
                    {lineaFoco ? ' Al elegir uno se enlaza con la línea marcada.' : ' Marca una línea del detalle para enlazarla.'}</>
                  )}
                </div>
                <input className="fi" style={{ width: '100%', marginTop: 6, fontSize: 12 }}
                  placeholder="Buscar en las compras: cemento, fierro, tubo…"
                  value={buscaGrupo} onChange={e => { setBuscaGrupo(e.target.value); setDetalleOferta(null); }} />
              </div>

              <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                {/* ══ EL CATÁLOGO, SIN BUSCAR NADA (tanda 13) ═══════════
                    «¿qué tiene JARVEX?». Con el buscador vacío el bloque abre
                    con el inventario del grupo por empresa y por familia, que
                    es la forma de DESCUBRIR que JARVEX tiene 54 líneas de
                    herramientas. Apenas se escribe algo, manda la búsqueda. */}
                {!buscaGrupo.trim() && vistaGrupo === 'empresa' ? (
                  catalogo.length === 0 ? (
                    <div style={{ padding: 14, fontSize: 11.5, color: 'var(--tm)', textAlign: 'center' }}>
                      {nueva.provModo === 'grupo' && proveedorDeNueva.nombre
                        ? `${proveedorDeNueva.nombre} no tiene nada disponible: todo lo que compró ya lo vendió.`
                        : 'Ninguna empresa del grupo tiene nada disponible todavía.'}
                    </div>
                  ) : catalogo.map(emp => (
                    <div key={emp.company_id || 'sin'} style={{ borderBottom: '1px solid var(--border)' }}>
                      <div style={{
                        padding: '7px 12px', display: 'flex', gap: 8, alignItems: 'center',
                        background: 'var(--tint-neutral)', flexWrap: 'wrap',
                      }}>
                        <JxIcon name="building" size={13} color="var(--blue)" />
                        <b style={{ fontSize: 12 }}>{emp.nombre}</b>
                        <span style={{ fontSize: 11, color: 'var(--tm)' }}>
                          <b style={{ color: 'var(--tp)' }}>{fmtS(emp.montoDisponible)}</b> disponibles
                          {' '}en {emp.nItems} ítem{emp.nItems === 1 ? '' : 's'}
                        </span>
                      </div>
                      {emp.familias.map(fam => {
                        const clave = `${emp.company_id}|${fam.familia}`;
                        const abierta = famAbierta === clave;
                        // El insumo del presupuesto que le calza a esta familia
                        // —«herramientas manuales» ↔ herramientas— para que la
                        // orden nazca ya contando como consumo de la obra.
                        const ins = obraScopeId ? insumoParaFamilia(fam.familia, insumosMonto) : null;
                        return (
                          <React.Fragment key={clave}>
                            <div style={{ padding: '6px 12px 6px 20px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                              <button className="btn btn-xs btn-ghost" style={{ minWidth: 26 }}
                                title={abierta ? 'Cerrar el detalle' : 'Ver los ítems de este bloque'}
                                onClick={() => setFamAbierta(abierta ? null : clave)}>
                                {abierta ? '▾' : '▸'}
                              </button>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 11.5, fontWeight: 600 }}>
                                  {fam.label}
                                  <span style={{ fontWeight: 400, color: 'var(--tm)' }}>
                                    {' · '}{fam.nItems} ítem{fam.nItems === 1 ? '' : 's'}
                                    {' · '}<b style={{ color: 'var(--tp)' }}>{fmtS(fam.montoDisponible)}</b>
                                  </span>
                                </div>
                                {ins && (
                                  <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                                    📋 va contra <b>{ins.nombre}</b>
                                    {' · falta '}<b style={{ color: ins.falta > 0 ? 'var(--amber)' : 'var(--green)' }}>{fmtS(ins.falta)}</b>
                                    {' de '}{fmtS(ins.presupuestado)}
                                  </div>
                                )}
                              </div>
                              <button className="btn btn-xs btn-amber"
                                title={`Agregar al detalle los ${fam.nItems} ítems de este bloque`}
                                onClick={() => agregarFamilia(emp, fam)}>
                                + agregar los {fam.nItems}
                              </button>
                            </div>
                            {abierta && fam.items.map((it, k) => (
                              <div key={k} style={{ padding: '5px 12px 5px 46px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 11 }}>
                                    {it.descripcion}
                                    {it.obraVinculada && <span className="badge b-blue" style={{ marginLeft: 5, fontSize: 9 }}>ya vinculado a esta obra</span>}
                                  </div>
                                  <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                                    <b style={{ color: 'var(--tp)' }}>{cantF(it.disponible)}</b> {it.unidad}
                                    {it.ultimoPrecio != null
                                      ? <> · último {fmtS(it.ultimoPrecio)} el {it.ultimoPrecioFecha}</>
                                      : <> · <span style={{ color: 'var(--amber)' }}>sin precio en la factura</span></>}
                                  </div>
                                </div>
                                <button className="btn btn-xs btn-ghost" title="Enlazar con la línea marcada del detalle"
                                  onClick={() => enlazarOferta(emp, it)}>usar</button>
                              </div>
                            ))}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  ))
                ) : (vistaGrupo === 'empresa' ? ofertaGrupo.length : sugGrupoVisible.length) === 0 ? (
                  <div style={{ padding: 14, fontSize: 11.5, color: 'var(--tm)', textAlign: 'center' }}>
                    {!buscaGrupo.trim() ? 'Escribe qué estás buscando, o cambia a «por empresa» para ver todo lo que hay.'
                      : (nueva.provModo === 'grupo' && proveedorDeNueva.nombre
                        ? `${proveedorDeNueva.nombre} no tiene nada así disponible.`
                        : 'Ninguna empresa del grupo tiene algo así disponible.')}
                  </div>
                ) : vistaGrupo === 'empresa' ? (
                  // ── AGRUPADO POR EMPRESA ──────────────────────────────
                  ofertaGrupo.map(emp => (
                    <div key={emp.company_id || 'sin'} style={{ borderBottom: '1px solid var(--border)' }}>
                      <div style={{
                        padding: '7px 12px', display: 'flex', gap: 8, alignItems: 'center',
                        background: 'var(--tint-neutral)', flexWrap: 'wrap',
                      }}>
                        <JxIcon name="building" size={13} color="var(--blue)" />
                        <b style={{ fontSize: 12 }}>{emp.nombre}</b>
                        <span style={{ fontSize: 11, color: 'var(--tm)' }}>
                          {/* «de lo que buscaste», no «de este insumo»: sumar
                              cuatro nombres distintos como si fueran uno es una
                              decisión de mapeo, y ésa la toma una persona. */}
                          <b style={{ color: 'var(--tp)' }}>{cantF(emp.disponibleBusqueda)}</b> disponibles
                          {' '}en {emp.items.length} nombre{emp.items.length === 1 ? '' : 's'}
                        </span>
                        {emp.ultimaFecha && (
                          <span style={{ fontSize: 10.5, color: 'var(--tm)' }}>última compra {emp.ultimaFecha}</span>
                        )}
                      </div>
                      {emp.items.map(it => {
                        const clave = `${emp.company_id}|${it.descripcion}`;
                        const abierto = detalleOferta === clave;
                        return (
                          <React.Fragment key={clave}>
                            <div style={{ padding: '6px 12px 6px 26px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 11.5 }}>
                                  {it.descripcion}
                                  {it.obraVinculada && <span className="badge b-blue" style={{ marginLeft: 5, fontSize: 9 }}>ya vinculado a esta obra</span>}
                                </div>
                                <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                                  <b style={{ color: 'var(--tp)' }}>{cantF(it.disponible)}</b> {it.unidad}
                                  {' · compró '}{cantF(it.comprado)}{it.vendido ? ` · vendió ${cantF(it.vendido)}` : ''}
                                  {it.ultimoPrecio != null && <> · último {fmtS(it.ultimoPrecio)} el {it.ultimoPrecioFecha}</>}
                                </div>
                              </div>
                              <button className="btn btn-xs btn-ghost" title="Ver las facturas donde se compró"
                                onClick={() => setDetalleOferta(abierto ? null : clave)}>
                                {abierto ? '▾' : '▸'} {it.compras.length}
                              </button>
                              <button className="btn btn-xs btn-amber" title="Enlazar con la línea marcada del detalle"
                                onClick={() => enlazarOferta(emp, it)}>usar</button>
                            </div>
                            {abierto && (
                              <div style={{ padding: '4px 12px 8px 26px', background: 'var(--bg-c2)' }}>
                                <table className="tbl" style={{ fontSize: 10.5 }}>
                                  <thead><tr>
                                    <th>Fecha</th><th>Comprobante</th>
                                    <th style={{ textAlign: 'right' }}>Cantidad</th>
                                    <th style={{ textAlign: 'right' }}>P. unitario</th>
                                  </tr></thead>
                                  <tbody>
                                    {it.compras.map((c, k) => (
                                      <tr key={k}>
                                        <td>{c.fecha || '—'}</td>
                                        <td style={{ fontFamily: 'monospace' }}>{c.documento || '—'}</td>
                                        <td style={{ textAlign: 'right' }}>{cantF(c.cantidad)}</td>
                                        <td style={{ textAlign: 'right' }}>{c.precio_unitario != null ? fmtS(c.precio_unitario) : '—'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  ))
                ) : (
                  // ── AGRUPADO POR NOMBRE (como estaba) ─────────────────
                  sugGrupoVisible.map((g, i) => (
                    <div key={i} style={{ padding: '7px 12px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11.5, fontWeight: 600 }}>
                        {g.descripcion}
                        {g.obraVinculada && <span className="badge b-blue" style={{ marginLeft: 5, fontSize: 9 }}>ya vinculado a esta obra</span>}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                        {g.porEmpresa.map(e => (
                          <button key={e.company_id || 'sin'} className="btn btn-xs btn-ghost"
                            title={`Comprado ${cantF(e.comprado)}${e.vendido ? ` · vendido ${cantF(e.vendido)}` : ''}${e.ultimoPrecio != null ? ` · último ${fmtS(e.ultimoPrecio)}` : ''}`}
                            onClick={() => enlazarOferta({ company_id: e.company_id }, { descripcion: g.descripcion, unidad: g.unidad, disponible: e.disponible })}>
                            <b>{cantF(e.disponible)}</b>&nbsp;{(e.nombre || '').slice(0, 18)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            )}
          </div>

          {/* ── LAS LÍNEAS ───────────────────────────────────────────── */}
          <div className="card" style={{ overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <b>{textosDeTipo(nueva.tipo).detalle}</b>
              <button className="btn btn-sm" onClick={addLinea}><JxIcon name="plus" size={13} /> Agregar línea</button>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--tm)' }}>
                Valor de venta <b style={{ color: 'var(--tp)' }}>{fmtS(totalesNueva.valorVenta)}</b>
                {' · '}IGV {fmtS(totalesNueva.igv)}
                {' · '}Total <b style={{ color: 'var(--tp)' }}>{fmtS(totalesNueva.total)}</b>
                {nueva.igvIncluido && (
                  <span className="badge b-blue" style={{ marginLeft: 6, fontSize: 9 }}>precios con IGV</span>
                )}
              </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr>
                  <th style={{ minWidth: 240 }}>{textosDeTipo(nueva.tipo).columnaDescripcion}</th>
                  <th style={{ width: 90 }}>Unidad</th>
                  <th style={{ width: 110, textAlign: 'right' }}>Cantidad</th>
                  <th style={{ width: 130, textAlign: 'right' }}>
                    Precio unit.
                    <div style={{ fontSize: 9, fontWeight: 400, color: 'var(--tm)' }}>
                      {nueva.igvIncluido ? 'con IGV' : 'sin IGV'}
                    </div>
                  </th>
                  <th style={{ width: 110, textAlign: 'right' }}>Subtotal</th>
                  <th style={{ width: 40 }}></th>
                </tr></thead>
                <tbody>
                  {lineas.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: 18, color: 'var(--tm)' }}>
                      Sin líneas todavía. Pulsa «Agregar línea» y escribe qué estás comprando.
                    </td></tr>
                  ) : lineas.map(l => (
                    <React.Fragment key={l.key}>
                    <tr
                      style={lineaFoco === l.key ? { outline: '2px solid var(--amber)', outlineOffset: -2 } : undefined}
                      onClick={() => setLineaFoco(l.key)}>
                      <td>
                        <input className="fi" style={{ width: '100%' }} value={l.descripcion}
                          placeholder="CEMENTO PORTLAND TIPO I 42.5 kg"
                          autoComplete="off"
                          onFocus={() => { setLineaFoco(l.key); setSugFoco(l.key); }}
                          onKeyDown={e => { if (e.key === 'Escape') setSugFoco(null); }}
                          onChange={e => { setLinea(l.key, { descripcion: e.target.value }); setSugFoco(l.key); }} />
                        <div style={{ fontSize: 10.5, color: 'var(--tm)', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {l.insumo_codigo && <span title="Insumo del presupuesto">📋 {l.insumo_codigo}</span>}
                          {l.origen_company_id && (
                            <span title={l.origen_descripcion || ''}>
                              📦 {lookupCompany(l.origen_company_id)?.name || 'del grupo'}
                              {l.tope != null ? ` · tiene ${cantF(l.tope)}` : ''}
                            </span>
                          )}
                          {l.insumo_codigo && l.origen_descripcion && (
                            <span style={{ color: 'var(--green)' }} title="Al emitir, esta equivalencia queda aprendida para las próximas facturas">
                              ✓ el mapeo queda aprendido
                            </span>
                          )}
                          {lineaFoco === l.key && !l.origen_descripcion && (
                            <span style={{ color: 'var(--amber)' }}>← elige a la derecha quién lo tiene</span>
                          )}
                        </div>
                      </td>
                      <td><input className="fi" style={{ width: '100%' }} value={l.unidad}
                        onChange={e => setLinea(l.key, { unidad: e.target.value })} /></td>
                      <td><input className="fi" type="number" min="0" step="any" style={{ width: '100%', textAlign: 'right' }}
                        value={l.cantidad} onChange={e => setLinea(l.key, { cantidad: e.target.value })} /></td>
                      <td><input className="fi" type="number" min="0" step="any" style={{ width: '100%', textAlign: 'right' }}
                        value={l.precio_unitario} placeholder="0.00"
                        onChange={e => setLinea(l.key, { precio_unitario: e.target.value })} /></td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>
                        {fmtS(Number(l.cantidad || 0) * Number(l.precio_unitario || 0))}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button className="btn btn-xs btn-ghost" title="Quitar la línea" onClick={() => delLinea(l.key)}>✕</button>
                      </td>
                    </tr>
                    {/* ══ LAS RECOMENDACIONES AL TIPEAR ═══════════════════
                        Gabriel: «si yo coloco "cem.." no me sale
                        recomendaciones de algún insumo que empiece por ese
                        nombre. Implementa eso».

                        Va como una FILA de la tabla y no como un desplegable
                        flotante a propósito: el contenedor de esta tabla tiene
                        overflow-x:auto, y en CSS eso vuelve el overflow-y
                        'auto' también — un dropdown absoluto quedaría cortado
                        o metido dentro de un scroll propio. La fila no se
                        puede cortar, y además empuja el detalle hacia abajo en
                        vez de tapar la línea siguiente. */}
                    {sugFoco === l.key && sugActuales.length > 0 && (
                      <tr>
                        <td colSpan={6} style={{ padding: 0, background: 'var(--bg-c2)' }}>
                          <div style={{ padding: '6px 8px 8px', borderBottom: '2px solid var(--amber)' }}>
                            <div style={{ fontSize: 10.5, color: 'var(--tm)', marginBottom: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
                              <span>Lo que ya se compró o se pidió con ese nombre — pulsa para usarlo</span>
                              <button className="btn btn-xs btn-ghost" style={{ marginLeft: 'auto' }}
                                onClick={() => setSugFoco(null)}>ocultar</button>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                              {sugActuales.map(sg => (
                                <button key={sg.norm} className="btn btn-ghost btn-xs"
                                  onClick={() => usarSugerencia(l.key, sg)}
                                  style={{ display: 'flex', gap: 8, alignItems: 'center', textAlign: 'left', width: '100%' }}>
                                  <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, whiteSpace: 'normal' }}>{sg.descripcion}</span>
                                  {sg.unidad && <span className="badge b-gray" style={{ fontSize: 9 }}>{sg.unidad}</span>}
                                  {sg.precio != null && (
                                    <span style={{ fontSize: 10.5, color: 'var(--tm)', whiteSpace: 'nowrap' }}
                                      title={sg.precioFecha ? `Último precio conocido, del ${sg.precioFecha}` : 'Último precio conocido'}>
                                      {fmtS(sg.precio)}{sg.precioFecha ? ` · ${sg.precioFecha}` : ''}
                                    </span>
                                  )}
                                  <span className="badge b-gray" style={{ fontSize: 9, whiteSpace: 'nowrap' }}>
                                    {ETIQUETA_ORIGEN[origenPrincipal(sg)]}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* AVISA, NO BLOQUEA. Comprar para atender el pedido es lo normal,
              no la excepcion - y el disponible sale de comprado menos vendido,
              asi que puede estar desactualizado. */}
          {excesos.length > 0 && (
            <div className="card card-p" style={{ marginBottom: 12, borderLeft: '3px solid var(--amber)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                {proveedorDeNueva.nombre} no tiene todo lo que le estas pidiendo
              </div>
              {excesos.map((e, i) => (
                <div key={i} style={{ fontSize: 11.5, color: 'var(--ts)', lineHeight: 1.5 }}>
                  {'\u00b7 '}<b>{e.descripcion}</b>: pides {cantF(e.pedido)} {e.unidad} y segun sus facturas
                  {' '}tiene <b style={{ color: 'var(--amber)' }}>{cantF(e.disponible)}</b>
                  {' '}{'\u2014'} faltan {cantF(e.faltante)}
                  {e.seLlama && e.seLlama !== e.descripcion && <> (ella lo tiene como {'\u00ab'}{e.seLlama}{'\u00bb'})</>}.
                </div>
              ))}
              <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 6, lineHeight: 1.5 }}>
                La orden se emite igual: puede comprarlo para atenderte. Al facturarla se le vuelve a
                avisar, y si la emite sin tenerlo, ese insumo le queda en <b>stock negativo</b> en su
                inventario {'\u2014'} que es la verdad, no un error.
              </div>
            </div>
          )}

          <div className="card card-p" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-sm" onClick={limpiarNueva}>Limpiar</button>
            <button className="btn btn-sm" disabled={!!faltaNueva.length} onClick={() => crearOrden({ numerar: false })}>
              Guardar como borrador
            </button>
            <button className="btn btn-amber btn-sm" disabled={!!faltaNueva.length || !canEmitir}
              onClick={() => crearOrden({ numerar: true })}>
              <JxIcon name="check" size={14} /> Confirmar y numerar
            </button>
            {faltaNueva.length > 0 && (
              <span style={{ fontSize: 11.5, color: 'var(--amber)' }}>Falta {faltaNueva.join(', ')}.</span>
            )}
            {!faltaNueva.length && (
              <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>
                El número se asigna al confirmar: un borrador que se abandona no deja huecos en la numeración.
              </span>
            )}
          </div>
        </div>
      ) : tab === 'emitidas' ? (
        emitidas.length === 0 ? (
          <div className="card card-p empty-state">
            <JxIcon name="package" size={40} color="var(--tm)" />
            <p>No hay órdenes emitidas en esta vista.</p>
            {resumen.sinRespaldo > 0 && (
              <button className="btn btn-amber btn-sm" onClick={() => setTab('respaldo')}>
                Hay {resumen.sinRespaldo} comprobantes sin respaldo — emitirlas
              </button>
            )}
          </div>
        ) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr>
                  <th>N°</th><th>Tipo</th><th>Empresa que emite</th><th>Proveedor</th>
                  <th>Fecha</th><th style={{ textAlign: 'right' }}>Importe total</th>
                  <th>Estado</th><th style={{ textAlign: 'center' }}>Acciones</th>
                </tr></thead>
                <tbody>
                  {emitidas.map(o => {
                    const anulada = ANULADA.has(o.estado);
                    return (
                      <tr key={o.id} style={anulada ? { opacity: 0.6 } : undefined}>
                        <td className="col-m" style={{ fontFamily: 'monospace', fontWeight: 700 }}>
                          {o.codigo || '—'}
                          {o.emitida_retroactiva && <div style={{ fontSize: 9.5, color: 'var(--tm)', fontFamily: 'inherit' }}>respaldo retroactivo</div>}
                        </td>
                        <td>
                          <span className={`badge ${(o.tipo || 'compra') === 'servicio' ? 'b-purple' : 'b-blue'}`}>
                            {(o.tipo || 'compra') === 'servicio' ? 'Servicio' : 'Compra'}
                          </span>
                        </td>
                        <td className="col-p" style={{ maxWidth: 200, fontSize: 11.5 }}>{lookupCompany(o.company_id)?.name || '—'}</td>
                        <td className="col-p" style={{ maxWidth: 200, fontSize: 11.5 }}>
                          {o.proveedor_nombre || lookupProv(o.proveedor_id)?.razon_social || '—'}
                          {o.titulo && <div style={{ fontSize: 10, color: 'var(--tm)' }}>{o.titulo}</div>}
                        </td>
                        <td className="col-m">{o.fecha || '—'}</td>
                        <td className="col-num" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--blue)' }}>{fmtS(o.monto_total)}</td>
                        <td><span className={`badge ${ESTADO_BADGE[o.estado] || 'b-gray'}`}>{ESTADO_LABEL[o.estado] || o.estado}</span></td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <button className="btn btn-ghost btn-xs" title="Ver detalle" onClick={() => verDetalle(o)}><JxIcon name="eye" size={11} /></button>
                          <button className="btn btn-ghost btn-xs" title="Descargar el PDF con la marca de la empresa" onClick={() => descargarPdf(o)} style={{ marginLeft: 4 }}><JxIcon name="download" size={11} /></button>
                          {canEmitir && !anulada && (
                            <button className="btn btn-red btn-xs" title="Anular (con motivo)" onClick={() => anular(o)} style={{ marginLeft: 4 }}><JxIcon name="x" size={11} /></button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : tab === 'recibidas' ? (
        // ══ PESTAÑA «RECIBIDAS» — EL BUZÓN DE LA EMPRESA ═══════════
        recibidas.length === 0 ? (
          <div className="card card-p empty-state">
            <JxIcon name="inbox" size={40} color="var(--tm)" />
            <p>
              {buzonBusca || filtroTipo !== 'todos'
                ? 'Ninguna orden recibida coincide con eso.'
                : buzonCerradas
                  ? 'A esta empresa todavía no le emitieron ninguna orden.'
                  : 'No hay órdenes esperando respuesta.'}
            </p>
            <div style={{ fontSize: 11.5, color: 'var(--tm)', maxWidth: 560, lineHeight: 1.55 }}>
              Acá aparecen las órdenes que <b>otra empresa del grupo</b> le emitió a ésta. Llegan
              solas: cuando alguien emite una orden y elige como destinatario a una empresa nuestra,
              el pedido entra en este buzón sin que nadie lo reenvíe.
              {!buzonCerradas && ' Las ya facturadas o rechazadas se ven marcando la casilla de arriba.'}
            </div>
          </div>
        ) : (
          <>
            <div className="card card-p" style={{ marginBottom: 12, background: 'var(--tint-neutral)' }}>
              <div style={{ fontSize: 12, color: 'var(--ts)', lineHeight: 1.55 }}>
                Cada una de éstas es un <strong>pedido que le hicieron a esta empresa</strong>. Al
                revisarla se cruza línea por línea con lo que la empresa compró según sus propias
                facturas — aunque lo tenga cargado con otro nombre — y desde ahí se emite la
                factura, editando lo que haga falta: los nombres, las cantidades, o quitando lo que
                no se puede atender.
              </div>
            </div>
            <div className="card" style={{ overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl">
                  <thead><tr>
                    <th>N°</th><th>Tipo</th>
                    {!empresaFija && <th>Se la emitieron a</th>}
                    <th>La emite</th><th>Fecha</th>
                    <th style={{ textAlign: 'right' }}>Importe pedido</th>
                    <th>Estado</th><th style={{ textAlign: 'center' }}>Acciones</th>
                  </tr></thead>
                  <tbody>
                    {recibidas.map(o => (
                      <tr key={o.id} style={respuestaCerrada(o) ? { opacity: 0.65 } : undefined}>
                        <td className="col-m" style={{ fontFamily: 'monospace', fontWeight: 700 }}>
                          {o.codigo || '(sin numerar)'}
                          {o.obra_descripcion && (
                            <div style={{ fontSize: 9.5, color: 'var(--tm)', fontFamily: 'inherit', maxWidth: 190 }}>
                              {o.obra_descripcion.slice(0, 60)}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${(o.tipo || 'compra') === 'servicio' ? 'b-purple' : 'b-blue'}`}>
                            {(o.tipo || 'compra') === 'servicio' ? 'Servicio' : 'Compra'}
                          </span>
                        </td>
                        {!empresaFija && (
                          <td className="col-p" style={{ maxWidth: 180, fontSize: 11.5, fontWeight: 600 }}>
                            {lookupCompany(o.proveedor_company_id)?.name || '—'}
                          </td>
                        )}
                        <td className="col-p" style={{ maxWidth: 180, fontSize: 11.5 }}>
                          {lookupCompany(o.company_id)?.name || '—'}
                          {o.titulo && <div style={{ fontSize: 10, color: 'var(--tm)' }}>{o.titulo}</div>}
                        </td>
                        <td className="col-m">{o.fecha || '—'}</td>
                        <td className="col-num" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--blue)' }}>{fmtS(o.monto_total)}</td>
                        <td>
                          <span className={`badge ${RESPUESTA_BADGE[o.respuestaEstado]}`}>{RESPUESTA_LABEL[o.respuestaEstado]}</span>
                          {o.respuesta_nota && (
                            <div style={{ fontSize: 9.5, color: 'var(--tm)', maxWidth: 150 }}>{o.respuesta_nota.slice(0, 60)}</div>
                          )}
                        </td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <button className="btn btn-ghost btn-xs" title="Ver el pedido tal cual llegó" onClick={() => verDetalle(o)}>
                            <JxIcon name="eye" size={11} />
                          </button>
                          <button className="btn btn-ghost btn-xs" title="Descargar el PDF de la orden" onClick={() => descargarPdf(o)} style={{ marginLeft: 4 }}>
                            <JxIcon name="download" size={11} />
                          </button>
                          {canEmitir && o.respuestaEstado !== 'facturada' && (
                            <button className="btn btn-amber btn-xs" style={{ marginLeft: 4 }}
                              title="Cruzar con el inventario de esta empresa y emitir la factura"
                              onClick={() => abrirAtencion(o)}>
                              Revisar
                            </button>
                          )}
                          {o.respuestaEstado === 'facturada' && o.respuesta_movimiento_id && (
                            <span className="badge b-green" style={{ marginLeft: 4, fontSize: 9 }}>facturada</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )
      ) : (
        // ── PESTAÑA «SIN RESPALDO» ────────────────────────────────
        <>
          {/* LOS FILTROS VAN ANTES DE LA LISTA Y NO DESAPARECEN CUANDO ESTÁ
              VACÍA: si fue un filtro el que la vació, hay que poder desarmarlo
              desde donde se está mirando. */}
          <div className="card card-p" style={{ marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label className="flabel" style={{ fontSize: 10.5 }}>Quién facturó</label>
              <select className="fi" style={{ minWidth: 230, fontSize: 12 }}
                value={respProveedor} onChange={e => setRespProveedor(e.target.value)}>
                <option value="todos">Todos los proveedores ({proveedoresPendientes.length})</option>
                {proveedoresPendientes.map(p => (
                  <option key={p.nombre} value={p.nombre}>{p.nombre} · {p.n} · {fmtS(p.monto)}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label className="flabel" style={{ fontSize: 10.5 }}>Buscar</label>
              <input className="fi" style={{ width: '100%', fontSize: 12 }} value={respBusca}
                placeholder="comprobante, proveedor o qué se compró"
                onChange={e => setRespBusca(e.target.value)} />
            </div>
            {hayFiltroResp && (
              <button className="btn btn-ghost btn-sm" onClick={() => { setRespProveedor('todos'); setRespBusca(''); }}>
                Limpiar filtros
              </button>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5, color: 'var(--ts)' }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}
                title={`Debajo de ${fmtS(umbral)} la orden no es obligatoria, pero se puede emitir igual.`}>
                <input type="checkbox" checked={verBajoUmbral} onChange={e => setVerBajoUmbral(e.target.checked)} />
                Ver también los de menos de {fmtS(umbral)}
              </label>
            </div>
          </div>

          {borradoresVisibles.length === 0 ? (
            <div className="card card-p empty-state">
              <JxIcon name="checkCircle" size={40} color="var(--green)" />
              {hayFiltroResp
                ? <p>Ningún comprobante coincide con el filtro. Límpialo para ver los {borradores.length} pendientes.</p>
                : <p>Todos los comprobantes por encima de {fmtS(umbral)} tienen su orden.{!verBajoUmbral && <> Marca «ver también los de menos de {fmtS(umbral)}» si quieres emitir alguno de los chicos.</>}</p>}
            </div>
          ) : (
          <>
            <div className="card card-p" style={{ marginBottom: 12, background: 'var(--tint-neutral)' }}>
              <div style={{ fontSize: 12, color: 'var(--ts)', lineHeight: 1.55 }}>
                Cada fila genera <strong>una orden</strong> atada a ese comprobante. Abre el
                detalle con <strong>«Ver detalle»</strong> para corregir los insumos, la fecha y las
                observaciones antes de emitir — después la orden queda ligada a la factura y solo
                se puede anular con motivo.
                {gruposPendientes.length > 1 && (
                  <> Hay <strong>{gruposPendientes.length} empresas</strong> emitiendo: cada una numera su propia serie.</>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
              {/* Marcan y desmarcan SOLO lo que se está viendo: con un filtro
                  puesto, «marcar todas» no puede alcanzar filas invisibles. */}
              <button className="btn btn-ghost btn-sm"
                onClick={() => { const v = new Set(borradoresVisibles.map(x => x.idx)); setBorradores(bs => bs.map((b, i) => (v.has(i) ? { ...b, incluir: true } : b))); }}>
                Marcar {hayFiltroResp ? 'las visibles' : 'todas'}
              </button>
              <button className="btn btn-ghost btn-sm"
                onClick={() => { const v = new Set(borradoresVisibles.map(x => x.idx)); setBorradores(bs => bs.map((b, i) => (v.has(i) ? { ...b, incluir: false } : b))); }}>
                Desmarcar {hayFiltroResp ? 'las visibles' : 'todas'}
              </button>
              <div style={{ flex: 1 }} />
              <div style={{ fontSize: 12, color: 'var(--tm)' }}>
                {seleccionados.length} seleccionadas · <strong style={{ color: 'var(--amber)' }}>{fmtS(montoSeleccionado)}</strong>
                {selOtraMoneda > 0 && (
                  <span title="No se suman con los soles: cada orden sale en la moneda de su comprobante.">
                    {' '}+ {selOtraMoneda} en otra moneda
                  </span>
                )}
                {seleccionadasOcultas > 0 && (
                  <span style={{ color: 'var(--amber)' }} title="Están marcadas pero el filtro no las muestra. Se emiten igual.">
                    {' '}· {seleccionadasOcultas} fuera del filtro
                  </span>
                )}
              </div>
              {canEmitir && (
                <button className="btn btn-amber btn-sm" disabled={emitiendo || !seleccionados.length} onClick={emitirLote}>
                  <JxIcon name="check" size={13} />
                  {emitiendo
                    ? `Emitiendo ${progreso?.hechas ?? 0}/${progreso?.total ?? 0}…`
                    : `Emitir ${seleccionados.length} órdenes`}
                </button>
              )}
            </div>

            <div className="card" style={{ overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl" style={{ fontSize: 11.5 }}>
                  <thead><tr>
                    <th style={{ width: 32 }}></th>
                    <th style={{ width: 128 }}>Comprobante</th>
                    <th style={{ width: 116 }}>Fecha de la orden</th>
                    <th style={{ width: 170 }}>Proveedor</th>
                    <th style={{ minWidth: 240 }}>Qué se compró</th>
                    <th style={{ width: 108 }}>Tipo</th>
                    <th style={{ width: 92 }}>IGV</th>
                    <th style={{ width: 140, textAlign: 'right' }}>Importe total</th>
                  </tr></thead>
                  <tbody>
                    {borradoresVisibles.map(({ b, idx }) => {
                      const abierta = respAbierta === b.movimiento_id;
                      const suma = sumaDeLineas(b.lineas);
                      const desc = Math.abs(suma - Number(b.valorVenta || 0)) > 0.01;
                      return (
                    <React.Fragment key={b.movimiento_id}>
                      <tr style={b.incluir ? undefined : { opacity: 0.45 }}>
                        <td style={{ textAlign: 'center' }}>
                          <input type="checkbox" checked={!!b.incluir} onChange={e => actualizarBorrador(idx, { incluir: e.target.checked })} />
                        </td>
                        <td className="col-m" style={{ fontSize: 10.5 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            {/* El ojo que pidió Gabriel: ver de qué factura se
                                está hablando sin salir de la pantalla. */}
                            <button className="btn btn-xs btn-ghost" title="Ver el comprobante"
                              onClick={() => setVerMov(b.movimiento_id)}>
                              <JxIcon name="eye" size={13} />
                            </button>
                            <span style={{ fontFamily: 'monospace' }}>{b.documento || '—'}</span>
                          </div>
                          {/* Por qué esta fila estaba escondida hasta ahora. */}
                          {b.fuera === 'bajo_umbral' && (
                            <span className="badge b-gray" style={{ fontSize: 8.5 }} title={`Debajo de ${fmtS(umbral)} la orden no es obligatoria — se puede emitir igual.`}>
                              bajo el umbral
                            </span>
                          )}
                          {b.fuera === 'moneda_extranjera' && (
                            <span className="badge b-purple" style={{ fontSize: 8.5 }}
                              title={`Comprobante en ${b.moneda}. El umbral está en soles, así que no se le compara, y su importe no se suma con los de soles en ningún total.`}>
                              en {b.moneda}
                            </span>
                          )}
                        </td>
                        <td>
                          {/* Editable (tanda 14): antes salía la del comprobante
                              y no se podía tocar en ningún punto del camino.
                              El AÑO de esta fecha es el que numera la serie. */}
                          <input className="fi" type="date" style={{ fontSize: 11, width: '100%' }}
                            value={b.fecha || ''} onChange={e => actualizarBorrador(idx, { fecha: e.target.value })} />
                        </td>
                        <td style={{ maxWidth: 170, fontSize: 10.5 }}>
                          <div style={{ fontWeight: 600 }}>{b.proveedor_nombre || '—'}</div>
                          <div style={{ color: 'var(--tm)' }}>emite: {lookupCompany(b.company_id)?.name || '⚠ sin empresa'}</div>
                        </td>
                        <td>
                          <div style={{ fontSize: 11, lineHeight: 1.4 }}>{b.descripcion || '—'}</div>
                          <button className="btn btn-ghost btn-xs" style={{ padding: '1px 6px', fontSize: 9.5, marginTop: 3 }}
                            onClick={() => setRespAbierta(abierta ? null : b.movimiento_id)}>
                            {abierta ? '▾ Cerrar detalle' : `▸ Ver detalle (${b.lineas?.length || 0})`}
                          </button>
                          {desc && !abierta && (
                            <span style={{ fontSize: 9.5, color: 'var(--amber)', marginLeft: 6 }} title="Al emitir se ajusta para cuadrar contra el comprobante.">
                              ⚠ el detalle no suma el total
                            </span>
                          )}
                        </td>
                        <td>
                          <select className="fi" style={{ fontSize: 11 }} value={b.tipo}
                            onChange={e => actualizarBorrador(idx, { tipo: e.target.value, unidad: textosDeTipo(e.target.value).unidadPorDefecto })}>
                            <option value="compra">Compra</option>
                            <option value="servicio">Servicio</option>
                          </select>
                        </td>
                        <td>
                          <select className="fi" style={{ fontSize: 11, width: '100%' }} value={String(b.igvPct)}
                            onChange={e => actualizarBorrador(idx, { igvPct: Number(e.target.value) })}>
                            <option value="18">18%</option>
                            <option value="0">Sin IGV</option>
                          </select>
                        </td>
                        <td>
                          <input className="fi" type="number" min="0" step="0.01"
                            style={{ fontSize: 11, textAlign: 'right', width: '100%' }}
                            value={b.total} onChange={e => actualizarBorrador(idx, { total: e.target.value })} />
                          <div style={{ fontSize: 9.5, color: 'var(--tm)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {fmtMon(b.valorVenta, b.moneda)} + {fmtMon(b.igv, b.moneda)}
                          </div>
                        </td>
                      </tr>
                      {/* ── EL DETALLE REAL DE LA FACTURA, EDITABLE ────────
                          Gabriel: «no se colocan los insumos reales que se
                          facturaron». Nacían de `items_factura` pero no había
                          dónde corregirlos: la única casilla editable era un
                          resumen que la emisión descartaba. */}
                      {abierta && (
                        <tr>
                          <td colSpan={8} style={{ background: 'var(--bg-c2)', padding: '10px 14px' }}>
                            <div style={{ fontSize: 10.5, color: 'var(--tm)', marginBottom: 6 }}>
                              Lo que dice la factura, línea por línea. Se puede renombrar, cambiar la
                              unidad, la cantidad y el importe, partir una línea en dos o quitar la que no va.
                            </div>
                            <table className="tbl" style={{ fontSize: 11, marginBottom: 8 }}>
                              <thead><tr>
                                <th style={{ minWidth: 220 }}>Insumo o servicio</th>
                                <th style={{ width: 80 }}>Unidad</th>
                                <th style={{ width: 90 }}>Cantidad</th>
                                <th style={{ width: 120, textAlign: 'right' }}>Importe</th>
                                <th style={{ width: 34 }}></th>
                              </tr></thead>
                              <tbody>
                                {(b.lineas || []).map((l, li) => (
                                  <tr key={li}>
                                    <td><input className="fi" style={{ fontSize: 11, width: '100%' }} value={l.nombre || ''}
                                      onChange={e => actualizarLinea(idx, li, { nombre: e.target.value })} /></td>
                                    <td><input className="fi" style={{ fontSize: 11, width: '100%' }} value={l.unidad || ''}
                                      onChange={e => actualizarLinea(idx, li, { unidad: e.target.value })} /></td>
                                    <td><input className="fi" type="number" min="0" step="0.01" style={{ fontSize: 11, width: '100%', textAlign: 'right' }}
                                      value={l.cantidad ?? ''} onChange={e => actualizarLinea(idx, li, { cantidad: e.target.value })} /></td>
                                    <td><input className="fi" type="number" min="0" step="0.01" style={{ fontSize: 11, width: '100%', textAlign: 'right' }}
                                      value={l.subtotal ?? ''} onChange={e => actualizarLinea(idx, li, { subtotal: e.target.value })} /></td>
                                    <td style={{ textAlign: 'center' }}>
                                      {(b.lineas || []).length > 1 && (
                                        <button className="btn btn-ghost btn-xs" title="Quitar esta línea"
                                          onClick={() => quitarLinea(idx, li)}>×</button>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                              <button className="btn btn-ghost btn-xs" onClick={() => agregarLinea(idx)}>+ Agregar línea</button>
                              <div style={{ fontSize: 11, color: desc ? 'var(--amber)' : 'var(--tm)' }}>
                                El detalle suma <strong>{fmtMon(suma, b.moneda)}</strong> contra un valor de venta de <strong>{fmtMon(b.valorVenta, b.moneda)}</strong>
                                {desc && <> {'—'} al emitir se ajusta la última línea para cuadrar contra el comprobante.</>}
                              </div>
                            </div>
                            <div>
                              <label className="flabel" style={{ fontSize: 10.5 }}>
                                Observaciones (opcional {'—'} si lo dejas vacío, el PDF no imprime nada)
                              </label>
                              <input className="fi" style={{ fontSize: 11, width: '100%' }}
                                value={b.observaciones || ''} placeholder="En blanco por defecto"
                                onChange={e => actualizarBorrador(idx, { observaciones: e.target.value })} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            {pendientes.length > borradores.length && (
              <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 8 }}>
                Mostrando las {borradores.length} más caras de {pendientes.length}. Emitidas éstas, aparecen las siguientes.
              </div>
            )}
            {hayFiltroResp && (
              <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 4 }}>
                Viendo {borradoresVisibles.length} de {borradores.length} con el filtro puesto.
              </div>
            )}
          </>
          )}
        </>
      )}

      {/* ── EL COMPROBANTE, VISTO DESDE «SIN RESPALDO» ────────────
          Gabriel: «me gustaría que esté el ojito que me permita abrir y ver
          de qué factura estamos hablando». Muestra lo que la factura DICE —
          sus ítems— que es justo lo que la columna de al lado no mostraba. */}
      {verMov && (() => {
        const mv = (movs || []).find(m => m.id === verMov);
        if (!mv) return null;
        const items = itemsDeFactura(mv);
        return (
          <Modal title={`${mv.category || 'Comprobante'} ${mv.document_number || ''}`.trim()} icon="file" size="lg" onClose={() => setVerMov(null)}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 12 }}>
              <div><div style={{ fontSize: 11, color: 'var(--tm)' }}>Proveedor</div><b>{mv.third_party_name || '—'}</b>
                <div style={{ fontSize: 11, color: 'var(--tm)' }}>{mv.third_party_ruc || ''}</div></div>
              <div><div style={{ fontSize: 11, color: 'var(--tm)' }}>Cargado en el libro de</div><b>{lookupCompany(mv.company_id)?.name || '—'}</b></div>
              <div><div style={{ fontSize: 11, color: 'var(--tm)' }}>Fecha</div><b>{mv.date || '—'}</b></div>
              <div><div style={{ fontSize: 11, color: 'var(--tm)' }}>Importe</div><b>{fmtS(mv.amount)}</b>
                <div style={{ fontSize: 11, color: 'var(--tm)' }}>{mv.currency || 'PEN'}</div></div>
            </div>
            {mv.obra_id && (
              <p style={{ fontSize: 11.5, color: 'var(--tm)', margin: '0 0 10px' }}>
                Vinculado a <b>{lookupObra(mv.obra_id)?.nombre_obra?.slice(0, 70) || 'una obra'}</b>.
              </p>
            )}
            <div className="card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 12 }}>
                Lo que dice la factura
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl" style={{ fontSize: 11.5 }}>
                  <thead><tr><th>Descripción</th><th style={{ width: 90, textAlign: 'right' }}>Cantidad</th><th style={{ width: 70 }}>Unidad</th><th style={{ width: 110, textAlign: 'right' }}>P. unitario</th></tr></thead>
                  <tbody>
                    {items.length === 0 ? (
                      <tr><td colSpan={4} style={{ textAlign: 'center', padding: 14, color: 'var(--tm)' }}>
                        Este comprobante no tiene el detalle cargado.
                      </td></tr>
                    ) : items.map((it, i) => (
                      <tr key={i}>
                        <td className="col-p">{it.descripcion || '—'}</td>
                        <td style={{ textAlign: 'right' }}>{Number(it.cantidad || 0).toLocaleString('es-PE')}</td>
                        <td>{it.unidad || '—'}</td>
                        <td style={{ textAlign: 'right' }}>{fmtS(it.precio_unitario)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* ══ ATENDER UNA ORDEN RECIBIDA ═══════════════════════════════
          El pedido a la izquierda, lo que esta empresa tiene a la derecha, y
          la factura que va a salir abajo. Todo editable: los nombres (cada
          empresa nombra sus insumos como los tiene cargados), las cantidades
          («tal vez no tenga todo, tal vez tenga más») y qué líneas entran. */}
      {atendiendo && atBorrador && (() => {
        const o = atendiendo.orden;
        const vendedora = lookupCompany(o.proveedor_company_id);
        const compradora = lookupCompany(o.company_id);
        const porKey = new Map(atCruce.map(c => [c.item?.id, c]));
        return (
          <Modal title={`Orden recibida ${o.codigo || ''}`.trim()} icon="inbox" size="xl" onClose={cerrarAtencion}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
              <div><div style={{ fontSize: 11, color: 'var(--tm)' }}>Te la emite</div><b>{compradora?.name || o.proveedor_nombre || '—'}</b></div>
              <div><div style={{ fontSize: 11, color: 'var(--tm)' }}>La recibe</div><b>{vendedora?.name || '—'}</b></div>
              <div><div style={{ fontSize: 11, color: 'var(--tm)' }}>Fecha del pedido</div><b>{o.fecha || '—'}</b></div>
              <div><div style={{ fontSize: 11, color: 'var(--tm)' }}>Importe pedido</div><b>{fmtS(o.monto_total)}</b></div>
            </div>
            {o.obra_descripcion && (
              <p style={{ fontSize: 11.5, color: 'var(--tm)', margin: '0 0 10px' }}>
                Para <b>{o.obra_descripcion}</b>.
              </p>
            )}

            {/* Los avisos. Ninguno bloquea: los tres casos que detectan pasan
                todo el tiempo y son legítimos. Lo que no puede pasar es que
                ocurran sin que nadie los vea. */}
            {avisosAt.length > 0 && (
              <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {avisosAt.map(a => (
                  <div key={a.clave} className="card card-p" style={{
                    borderLeft: `3px solid ${a.nivel === 'alto' ? 'var(--red)' : a.nivel === 'medio' ? 'var(--amber)' : 'var(--tm)'}`,
                    fontSize: 11.5, lineHeight: 1.5, padding: '8px 12px',
                  }}>
                    {a.texto}
                  </div>
                ))}
              </div>
            )}

            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
              <table className="tbl" style={{ fontSize: 11 }}>
                <thead><tr>
                  <th style={{ width: 30 }}></th>
                  <th style={{ minWidth: 190 }}>Qué te piden</th>
                  <th style={{ minWidth: 210 }}>Cómo lo tienes tú (va a la factura)</th>
                  <th style={{ width: 80 }}>Unidad</th>
                  <th style={{ width: 96, textAlign: 'right' }}>Cantidad</th>
                  <th style={{ width: 110, textAlign: 'right' }}>
                    Precio
                    <div style={{ fontSize: 9, fontWeight: 400, color: 'var(--tm)' }}>
                      {atBorrador.igvIncluido ? 'con IGV' : 'sin IGV'}
                    </div>
                  </th>
                  <th style={{ width: 96, textAlign: 'right' }}>Subtotal</th>
                </tr></thead>
                <tbody>
                  {atBorrador.lineas.map(l => {
                    const c = porKey.get(l.key) || null;
                    return (
                      <tr key={l.key} style={l.incluir ? undefined : { opacity: 0.42 }}>
                        <td style={{ textAlign: 'center' }}>
                          <input type="checkbox" checked={l.incluir} title="Incluir esta línea en la factura"
                            onChange={e => setAtLinea(l.key, { incluir: e.target.checked })} />
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{l.nombreOrden}</div>
                          <div style={{ fontSize: 10, color: 'var(--tm)' }}>
                            piden {cantF(l.cantidadPedida)} {l.unidad}
                            {l.disponible != null && (
                              <> · tienes <b style={{ color: l.disponible >= l.cantidad ? 'var(--green)' : 'var(--amber)' }}>{cantF(l.disponible)}</b></>
                            )}
                            {l.disponible == null && <> · <span style={{ color: 'var(--tm)' }}>sin equivalencia encontrada</span></>}
                          </div>
                        </td>
                        <td>
                          <input className="fi" style={{ width: '100%', fontSize: 11 }} value={l.nombre}
                            onChange={e => setAtLinea(l.key, { nombre: e.target.value })} />
                          {/* Los otros candidatos del inventario. Enlazar es
                              también decidir una equivalencia, y esa decisión
                              se guarda al facturar. */}
                          {c?.candidatos?.length > 1 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 3 }}>
                              {c.candidatos.map(cd => (
                                <button key={cd.norm} className={`btn btn-xs ${l.enlazadoA === cd.norm ? 'btn-amber' : 'btn-ghost'}`}
                                  title={`Comprado ${cantF(cd.comprado)}${cd.vendido ? ` · vendido ${cantF(cd.vendido)}` : ''}${cd.ultimoCosto != null ? ` · último costo ${fmtS(cd.ultimoCosto)}` : ''}`}
                                  onClick={() => setAtLinea(l.key, {
                                    nombre: cd.descripcion, enlazadoA: cd.norm,
                                    unidad: cd.unidad || l.unidad,
                                    disponible: cd.disponible, costoUnitario: cd.ultimoCosto,
                                  })}>
                                  {cd.descripcion.slice(0, 26)} · {cantF(cd.disponible)}
                                </button>
                              ))}
                            </div>
                          )}
                          {l.costoUnitario != null && (
                            <div style={{ fontSize: 10, color: l.precio_unitario > 0 && l.precio_unitario < l.costoUnitario ? 'var(--red)' : 'var(--tm)' }}>
                              te costó {fmtS(l.costoUnitario)} la unidad
                            </div>
                          )}
                        </td>
                        <td><input className="fi" style={{ width: '100%', fontSize: 11 }} value={l.unidad}
                          onChange={e => setAtLinea(l.key, { unidad: e.target.value })} /></td>
                        <td><input className="fi" type="number" min="0" step="any" style={{ width: '100%', fontSize: 11, textAlign: 'right' }}
                          value={l.cantidad} onChange={e => setAtLinea(l.key, { cantidad: e.target.value })} /></td>
                        <td><input className="fi" type="number" min="0" step="any" style={{ width: '100%', fontSize: 11, textAlign: 'right' }}
                          value={l.precio_unitario} onChange={e => setAtLinea(l.key, { precio_unitario: e.target.value })} /></td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>
                          {fmtS(Number(l.cantidad || 0) * Number(l.precio_unitario || 0))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr><td colSpan={6} style={{ textAlign: 'right', padding: '6px 12px' }}>Valor de venta:</td>
                    <td style={{ textAlign: 'right' }}>{fmtS(totalesAt.valorVenta)}</td></tr>
                  <tr><td colSpan={6} style={{ textAlign: 'right', padding: '6px 12px' }}>IGV ({Number(atBorrador.igvPct)}%):</td>
                    <td style={{ textAlign: 'right' }}>{fmtS(totalesAt.igv)}</td></tr>
                  <tr style={{ background: 'rgba(242,183,5,0.15)', fontWeight: 700 }}>
                    <td colSpan={6} style={{ textAlign: 'right', padding: '8px 12px' }}>Total a facturar:</td>
                    <td style={{ textAlign: 'right', color: 'var(--amber)' }}>{fmtS(totalesAt.total)}</td></tr>
                </tfoot>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'flex-end' }}>
              <button className="btn btn-sm" onClick={() => setAtBorrador(b => ({
                ...b,
                lineas: [...b.lineas, {
                  key: window.__newId(), incluir: true, nombreOrden: '(no estaba en el pedido)',
                  nombre: '', enlazadoA: null, unidad: 'UND',
                  cantidad: '', cantidadPedida: 0, precio_unitario: '',
                  costoUnitario: null, disponible: null, insumo_codigo: null,
                },
                ],
              }))}>
                <JxIcon name="plus" size={12} /> Agregar una línea que no estaba
              </button>
              <label><div style={{ fontSize: 11, color: 'var(--tm)' }}>Fecha de la factura</div>
                <input className="fi" type="date" value={atBorrador.fecha || ''}
                  onChange={e => setAtBorrador(b => ({ ...b, fecha: e.target.value }))} /></label>
              <label><div style={{ fontSize: 11, color: 'var(--tm)' }}>Serie-correlativo</div>
                <input className="fi" style={{ width: 170, fontFamily: 'monospace' }} value={atBorrador.documento || ''} placeholder="F001-00000123"
                  onChange={e => setAtBorrador(b => ({ ...b, documento: e.target.value }))} /></label>
              <label><div style={{ fontSize: 11, color: 'var(--tm)' }}>IGV %</div>
                <input className="fi" type="number" min="0" max="18" step="any" style={{ width: 80 }}
                  value={atBorrador.igvPct} onChange={e => setAtBorrador(b => ({ ...b, igvPct: e.target.value }))} /></label>
              {/* El mismo checkbox que en la orden, por la misma razón. */}
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11.5, paddingBottom: 7, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!atBorrador.igvIncluido}
                  onChange={e => setAtBorrador(b => ({ ...b, igvIncluido: e.target.checked }))} />
                los precios ya incluyen IGV
              </label>
            </div>

            {/* ── DE DÓNDE SALE ESE NÚMERO ──────────────────────────────
                Gabriel: «puede suceder que la empresa que emitirá la factura ya
                tenga otra factura que emitió. ¿O es que acaso eso se ve cuando
                se configure bien el sistema de la SUNAT?».

                Las dos cosas, en este orden: la SERIE la asigna SUNAT y se
                configura una vez por empresa; el CORRELATIVO lo lleva el
                contribuyente, así que la app lo sabe HOY mirando lo ya emitido.
                Se muestra de dónde salió en vez de un número pelado: un
                correlativo que no se puede explicar no se puede defender. */}
            <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 6, lineHeight: 1.55 }}>
              {atBorrador.serieSugerida && (
                <>Serie <b>{atBorrador.serieSugerida.serie}</b>
                  {lookupCompany(o.proveedor_company_id)?.serie_factura
                    ? ' (la configurada para esta empresa)'
                    : ' (la de por defecto — configúrala en el panel de la empresa si SUNAT le asignó otra)'}.
                  {atBorrador.serieSugerida.ultimo > 0
                    ? ` La última que emitió fue la ${atBorrador.serieSugerida.ultimo} de ${atBorrador.serieSugerida.usados} registradas, así que le toca la ${atBorrador.serieSugerida.correlativo}.`
                    : ' No tiene ninguna registrada en esa serie: le toca la 1.'}
                </>
              )}
              {docRepetido && (
                <div style={{ color: 'var(--red)', marginTop: 4 }}>
                  Ese número YA lo usó esta empresa (en {docRepetido.date || 'una factura anterior'}
                  {docRepetido.third_party_name ? `, a ${docRepetido.third_party_name}` : ''}). Repetirlo es un rechazo de SUNAT.
                </div>
              )}
              {!docRepetido && atBorrador.documento && !partirDocumento(atBorrador.documento) && (
                <div style={{ color: 'var(--amber)', marginTop: 4 }}>
                  «{atBorrador.documento}» no tiene forma de comprobante (F001-00000123). Se guarda igual, pero SUNAT no lo va a aceptar así.
                </div>
              )}
            </div>

            <p style={{ fontSize: 11, color: 'var(--tm)', margin: '10px 0 0', lineHeight: 1.55 }}>
              Al emitir se escriben <b>los dos lados</b>: el ingreso en {vendedora?.name || 'esta empresa'} y
              el costo en {compradora?.name || 'la que pidió'}, marcados como operación interna del grupo
              para que el consolidado no los cuente dos veces. Quedan como <b>borrador</b> — el número
              real de SUNAT se pone después, en Contabilidad.
            </p>

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={cerrarAtencion}>Cerrar</button>
              <button className="btn btn-red btn-sm" disabled={atGuardando} onClick={() => rechazarRecibida(o)}>
                No la podemos atender
              </button>
              <button className="btn btn-sm" disabled={atGuardando}
                onClick={async () => { if (await marcarRespuesta(o, 'aceptada')) { toast('Marcada como aceptada', 'green'); cerrarAtencion(); } }}>
                Aceptar sin facturar todavía
              </button>
              <button className="btn btn-amber" disabled={atGuardando || !canEmitir} onClick={emitirFacturaDeOrden}>
                <JxIcon name="check" size={13} />
                {atGuardando ? 'Emitiendo…' : `Emitir la factura · ${fmtS(totalesAt.total)}`}
              </button>
            </div>
          </Modal>
        );
      })()}

      {detalle && (
        <Modal title={`${TIPO_ORDEN_LABEL[detalle.tipo || 'compra']} ${detalle.codigo || ''}`} icon="package"
          onClose={() => { setDetalle(null); setDetalleItems([]); }} wide>
          <div className="g2">
            <div><label className="flabel">Empresa que emite</label><div className="fi" style={{ background: 'var(--bg-c2)' }}>{lookupCompany(detalle.company_id)?.name || '—'}</div></div>
            <div><label className="flabel">Proveedor</label><div className="fi" style={{ background: 'var(--bg-c2)' }}>{detalle.proveedor_nombre || lookupProv(detalle.proveedor_id)?.razon_social || '—'}</div></div>
            <div><label className="flabel">Fecha</label><div className="fi" style={{ background: 'var(--bg-c2)' }}>{detalle.fecha || '—'}</div></div>
            <div><label className="flabel">Estado</label><div className="fi" style={{ background: 'var(--bg-c2)' }}>{ESTADO_LABEL[detalle.estado] || detalle.estado}</div></div>
            {detalle.obra_descripcion && (
              <div style={{ gridColumn: '1/-1' }}><label className="flabel">Obra</label><div className="fi" style={{ background: 'var(--bg-c2)', height: 'auto', minHeight: 34, whiteSpace: 'normal' }}>{detalle.obra_descripcion}</div></div>
            )}
          </div>
          <div style={{ marginTop: 14, overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
            <table className="tbl" style={{ fontSize: 11 }}>
              <thead><tr>
                <th>#</th><th>{textosDeTipo(detalle.tipo).columnaDescripcion}</th>
                <th>Unidad</th><th style={{ textAlign: 'right' }}>Cant.</th>
                <th style={{ textAlign: 'right' }}>P. Unit.</th><th style={{ textAlign: 'right' }}>Importe</th>
              </tr></thead>
              <tbody>
                {detalleItems.map((it, i) => (
                  <tr key={it.id}>
                    <td>{i + 1}</td>
                    <td>{it.nombre || it.nombre_libre || '—'}</td>
                    <td>{it.unidad || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{Number(it.cantidad || 0).toFixed(2)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtS(it.precio_unitario)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtS(it.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={5} style={{ textAlign: 'right', padding: '6px 12px' }}>Valor de venta:</td><td style={{ textAlign: 'right' }}>{fmtS(detalle.monto_subtotal)}</td></tr>
                <tr><td colSpan={5} style={{ textAlign: 'right', padding: '6px 12px' }}>IGV ({Number(detalle.igv_pct ?? 18)}%):</td><td style={{ textAlign: 'right' }}>{fmtS(detalle.monto_igv)}</td></tr>
                <tr style={{ background: 'rgba(242,183,5,0.15)', fontWeight: 700 }}>
                  <td colSpan={5} style={{ textAlign: 'right', padding: '8px 12px' }}>{textosDeTipo(detalle.tipo).total}:</td>
                  <td style={{ textAlign: 'right', color: 'var(--amber)' }}>{fmtS(detalle.monto_total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => { setDetalle(null); setDetalleItems([]); }}>Cerrar</button>
            <button className="btn btn-amber" onClick={() => descargarPdf(detalle)}><JxIcon name="download" size={13} />Descargar PDF</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { OrdenesPage });
export { OrdenesPage };
