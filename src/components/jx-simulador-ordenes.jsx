// ═══════════════════════════════════════════════════════════════════
// JARVEX — SIMULADOR DE ÓRDENES POR PRESUPUESTO (tanda 3: la pantalla).
//
// Diseño en `docs/plan-simulador-ordenes.md`. Las tandas 1 y 2 dejaron los
// dos motores puros (`simulador-ordenes.js` y `simulador-dotacion.js`) y la
// tanda 3 dejó el estado de la persona (`simulador-escenarios.js`). Acá NO
// hay lógica de negocio: hay una pantalla que junta esas tres cosas.
//
// ── LA PREGUNTA QUE CONTESTA ──────────────────────────────────────
// `abastecimiento` dice CUÁNTO falta. Ésta dice CUÁNDO conviene pedirlo y
// agrupado en qué orden: «Materiales — octubre 2026», «EPPs — primera
// dotación». Cada corrida se guarda con nombre, para poder comparar sin
// recalcular a mano.
//
// ── DESDE LA RONDA 3 (tanda 3.1, §15) ─────────────────────────────
// La pantalla contesta UNA pregunta a la vez: el primer selector es el modo
// (🧪 Simulación, que no resta nada real, o 📍 Según lo real). Lo básico
// queda a la vista y lo fino detrás de ⚙; los avisos van a un botón y los
// resultados a una pestaña por categoría.
//
// ── DESDE LA TANDA 3.5 («según lo real» completo) ─────────────────
// En modo real, ⚙ deja sacar del plan lo YA EJECUTADO (el avance de cada
// partida) sin volver a restar lo que entró al almacén y se usó en eso, y las
// herramientas y los EPPs se comparan contra lo que HAY en el almacén («ya
// hay 16 guantes»). La comparación no resta: lo que resta es lo imputado.
//
// ── LO QUE ESTA PANTALLA NO HACE, A PROPÓSITO ─────────────────────
//  1. ACEPTAR NO EMITE. Aceptar una orden acá sigue sin escribir una fila:
//     deja la decisión guardada en el navegador. Desde la tanda 4 hay DOS
//     botones más, y son dos pasos separados a propósito (ver el encabezado
//     de `simulador-puente.js`): «Convertir en requisiciones» escribe el
//     pedido —que se puede editar, borrar y rehacer—, y «Emitir la orden»,
//     de a una, quema el correlativo de la ejecutora. Meterlos en un botón
//     haría que aceptar 30 tarjetas queme 30 números que no se arreglan.
//  2. NO PROPONE MANO DE OBRA COMO ORDEN. La planilla no se compra (§5): va
//     en su propia pestaña, como número de referencia contra el padrón real,
//     y con la leyenda puesta.
//  3. NO MUESTRA LA COBERTURA CONTRA EL PRESUPUESTO TOTAL. En Miraflores el
//     47% es planilla: una barra contra los S/ 9,59 M nunca llegaría al 100%
//     y se leería como «vamos por la mitad». Va contra el comprable (§2).
//  4. NO INVENTA NÚMEROS QUE NO TIENE. Las 62 líneas ya ordenadas sin código
//     de insumo no se pueden descontar, y la pantalla lo dice arriba en vez
//     de dejar que el plan las pida de nuevo. Lo mismo con los sobres cuyo
//     consumo nadie informó: el techo se marca como «no firme».
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import {
  simularOrdenes,
  REPARTO_LABEL, GRANULARIDADES,
  MOTIVO_PENDIENTE_LABEL, CATEGORIAS_SIMULADOR,
  mesDePeriodo, etiquetaPeriodo,
  ALMACEN_MODOS, ALMACEN_MODO_LABEL, ALMACEN_MODOS_INSUMO,
  COMPRADO_MODOS, COMPRADO_MODO_LABEL, aplicarAnulaciones, reprogramacionLabel,
} from "../lib/simulador-ordenes.js";
import {
  armarCronograma, curvaDeCarga, fechaCorta, valoresDeHistoria,
  HISTORIAS, HISTORIA_AZAR, HISTORIA_POR_ID, MOTIVO_SIN_DESPLAZAR_LABEL, MOTIVO_SIN_HISTORIA_LABEL, NOTA_CRONOGRAMA_LABEL,
} from "../lib/simulador-cronograma.js";
import { contextoParaHistoria, relatoIAVigente, LARGO_PREOCUPACION } from "../lib/simulador-historias.js";
import { elegirHistoriaConIA } from "../lib/simulador-historia-ai.js";
import {
  catalogoDelPresupuesto, existenciasDelAlmacen, insumosCubiertosPorAlmacen,
} from "../lib/simulador-imputacion.js";
import { stockContraPlan } from "../lib/simulador-stock.js";
import {
  sortearEnfoques, ENFOQUES_SORTEO, ENFOQUE_LABEL, ENFOQUE_ICONO,
} from "../lib/simulador-sorteo.js";
import { recomendarEnfoque } from "../lib/simulador-sorteo-ai.js";
import { CATEGORIA_SIMULADOR_LABEL, SUBCATEGORIA_LABEL } from "../lib/insumo-clasificador.js";
import { bandaConfianza, RUBRO_COMPRA_POR_ID, ordenDeRubro, etiquetaCategoria, categoriasParaElegir } from "../lib/indices-unificados-iupc.js";
import { enseñarDiccionario } from "../lib/clasificaciones-db.js";
import { SelectorClasificacion, ClasificacionDatalist } from "./jx-selector-clasificacion.jsx";
import { FRECUENCIAS, FRECUENCIA_LABEL } from "../lib/simulador-consolidacion.js";
import { simularDotacion, planDeContratacion } from "../lib/simulador-dotacion.js";
import {
  PARAMS_DEFAULT, paramsDeMotor, almacenModoDe, claveAlmacenModo,
  MODOS, MODO_LABEL, ARRANQUES, ARRANQUE_LABEL, CRONOGRAMAS_PANTALLA, CRONOGRAMA_PANTALLA_LABEL, REPARTOS_PANTALLA,
  categoriaDePropuesta,
  nuevoEscenario, conParams, conHistoriaIA,
  decidirPropuesta, decidirLinea, decidirPeriodo,
  editarLinea, limpiarEdicion, proveedorDePropuesta,
  decidirSobre, agregarLineaSobre, editarLineaSobre, quitarLineaSobre, proveedorDeSobre,
  aplicarEscenario, lineasAceptadas,
  leerEscenarios, guardarEscenario, borrarEscenario,
  leerCompras, guardarCompra,
  motorDeCierres, mesPorCerrar, resumenDeCierre, sinCodigoDeLineas,
  cerrarMes, reabrirMes, mesesCerradosDe,
} from "../lib/simulador-escenarios.js";
import {
  armarRequisiciones, borradorDeOrdenDesdeRequisicion, cierreDeRequisicion,
  consumoDeSobres, estadoDelPlan, puedeEmitirOrden,
  MOTIVO_NO_EMITE_LABEL, MOTIVO_OMITIDA_LABEL,
} from "../lib/simulador-puente.js";
import { perfilarProveedores, sugerirProveedores, porQueEsteProveedor } from "../lib/simulador-proveedor.js";
import { titularContableDeObra } from "../lib/consorcio.js";
import { rubroLabel } from "../lib/rubros.js";

const { useState: uS, useMemo: uM, useRef: uR, useEffect: uE, useCallback: uC } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const soles = (n) => `S/ ${num(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const solesK = (n) => {
  const v = num(n);
  if (Math.abs(v) >= 1e6) return `S/ ${(v / 1e6).toLocaleString('es-PE', { maximumFractionDigits: 2 })} M`;
  if (Math.abs(v) >= 1e4) return `S/ ${Math.round(v / 1000).toLocaleString('es-PE')} k`;
  return soles(v);
};
const cant = (n) => num(n).toLocaleString('es-PE', { maximumFractionDigits: 2 });
const pct = (f) => `${Math.round(num(f) * 100)}%`;

const COLOR_DECISION = { aceptada: 'var(--green)', rechazada: 'var(--red)', parcial: 'var(--blue)', pendiente: 'var(--tm)' };
const ESTADO_LABEL = { aceptada: 'Aceptada', rechazada: 'Rechazada', parcial: 'Parcial', pendiente: 'Sin decidir' };

// Cuántas líneas se dibujan de una orden antes de pedir «ver más». Una
// propuesta de materiales de Miraflores puede traer cientos: pintarlas todas
// cuelga la pestaña por un dato que nadie está mirando todavía.
const LINEAS_POR_TANDA = 40;

/**
 * El id del `<datalist>` de proveedores, que se dibuja UNA vez para toda la
 * pantalla.
 *
 * Medido el 22-set-2026: hay **549 proveedores en el catálogo + 28 empresas
 * del grupo = 577 candidatos**. Un `<select>` por línea serían 577 `<option>`
 * por fila — con 40 filas abiertas, 23.000 nodos de DOM para un dato que casi
 * nadie está mirando en ese momento. Un datalist único, compartido por todos
 * los inputs, cuesta 577 nodos en total y encima se filtra escribiendo, que es
 * como se busca entre 549 proveedores.
 *
 * Y se elige ARRIBA, en la orden, no línea por línea: una orden se le emite a
 * un proveedor (§6). La línea suelta se puede pisar igual, al corregirla.
 */
const DATALIST_PROVEEDORES = 'jx-sim-proveedores';

/** El datalist del selector «Clasificar» (tanda 4.1), compartido por toda la pantalla. */
const DATALIST_CLASIFICACION = 'jx-sim-clasificacion';

/** Una semilla al azar para «🎲 Otro», distinta de la que ya está. */
function semillaNueva(actual) {
  let s = actual;
  while (s === actual) s = 1 + Math.floor(Math.random() * 999999);
  return s;
}

// ═══════════════════════════════════════════════════════════════════

// `vistaInicial` existe para poder abrir la pantalla directo en una pestaña
// (mismo patrón que jx-catalogo-canonico). Lo usa el test de pantalla: sin
// esto las tres pestañas de abajo no las mira nadie hasta producción.
// Las pestañas de resultados, una por categoría (tanda 3.1, §15.2 E). La
// mano de obra no está: va por la suya, como referencia.
const CATS_ORDENES = CATEGORIAS_SIMULADOR.filter(c => c !== 'mano_obra');
const ICONO_CAT = { materiales: '🧱', herramientas: '🦺', servicios: '🚚' };

// Las vistas de antes de la ronda 3 que ya no son pestañas: «Órdenes» y
// «Sobres» se repartieron en las categorías, «Escenarios sugeridos» se mudó
// a ⚙ como «puntos de partida», y «Imputar lo ya comprado» es su propia
// página desde la tanda 3.2.
const vistaDeAntes = (v) => (v === 'ordenes' || v === 'sobres' || v === 'enfoques' || v === 'imputar' ? CATS_ORDENES[0] : v);

function SimuladorOrdenesPage({ showToast, vistaInicial = 'ordenes', ajustesAbiertos = false }) {
  const toast = showToast || window.__showToast || (() => {});

  // ── Regla de hooks: TODOS antes de cualquier early return (React #310) ──
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id ?? 'offline';          // para la clave de idempotencia (texto)
  const autorId = auth?.profile?.id ?? null;               // para created_by / updated_by (uuid)
  const userNombre = auth?.profile?.nombre || auth?.profile?.full_name || auth?.profile?.email || null;
  const obrasHook = window.__hooks.useObras();
  const compHook = window.__hooks.useCompanies();
  const consHook = window.__hooks.useConsorcios();

  const obras = uM(() => (obrasHook.data || []).filter(o => !o.deleted_at), [obrasHook.data]);
  const [obraId, setObraId] = uS(() => {
    try { return window.__getObraActivaId?.() || ''; } catch { return ''; }
  });

  const ipHook = window.__hooks.useInsumosPartida(obraId);
  const partidasHook = window.__hooks.usePartidas(obraId);
  const personalHook = window.__hooks.usePersonal(obraId);
  // El diccionario propio: le gana a la base oficial al clasificar los sobres.
  const terHook = window.__hooks.useClasificacionTerminos?.() ?? { data: null, refresh: null };
  const terminosCustom = terHook.data || null;
  // Clasificaciones propias, para poder ofrecerlas en «Clasificar» (tanda 4.1)
  // igual que en el panel de «Insumos → Clasificación de los insumos».
  const clasHook = window.__hooks.useClasificaciones?.() || { data: [] };
  const opcionesClasificacion = uM(() => categoriasParaElegir(clasHook.data || []), [clasHook.data]);

  const [vista, setVista] = uS(() => vistaDeAntes(vistaInicial));
  // ⚙: los ajustes finos, cerrados por defecto (§15.2 B). Los tests lo abren
  // para mirar lo que hay adentro.
  const [ajustes, setAjustes] = uS(ajustesAbiertos || vistaInicial === 'enfoques');
  const [verAvisos, setVerAvisos] = uS(false);
  const [abiertos, setAbiertos] = uS(() => new Set());
  const [verMas, setVerMas] = uS({});          // propuesta id → cuántas líneas
  const [busca, setBusca] = uS('');
  const [soloPendientes, setSoloPendientes] = uS(false);
  const [editando, setEditando] = uS(null);    // ref de la línea en edición
  const [proveedores, setProveedores] = uS([]);
  const [ordenes, setOrdenes] = uS([]);
  const [ocItems, setOcItems] = uS([]);
  // Tanda 4: lo que el plan YA escribió, y los movimientos con los que se
  // deduce a quién conviene pedirle cada orden.
  const [requisiciones, setRequisiciones] = uS([]);
  const [reqItems, setReqItems] = uS([]);
  const [movs, setMovs] = uS([]);
  const [emitiendo, setEmitiendo] = uS(null);   // id de la requisición en curso
  // «No hay botón para solicitar nueva recomendación, solo cambia cambiando
  // los filtros de arriba» (Gabriel, 22-set). El plan se recalcula solo
  // cuando cambia una perilla o llega un sync, y eso deja la duda de si lo
  // que se está mirando es de hace media hora. Este contador fuerza las dos
  // cosas: volver a leer los datos y volver a correr el motor.
  const [recalcN, setRecalcN] = uS(0);
  const convertirRef = uR(false);
  const cerrarRef = uR(false);
  const emitirRef = uR(false);
  // Tanda 2.5: el almacén de la obra (lo que entró y lo que hay). Imputar
  // sus ítems es la página aparte desde la tanda 3.2 (`ImputarComprasPage`).
  const [almacenCrudo, setAlmacenCrudo] = uS(null);
  // Tanda 2.6 (opcional): la recomendación de la IA sobre los 3 enfoques ya
  // calculados. Vive en un state aparte del motor porque es la ÚNICA parte
  // de esta pantalla que pega a la red por decisión explícita de un click —
  // nunca se pide sola.
  const [recoIA, setRecoIA] = uS(null);
  const [pidiendoIA, setPidiendoIA] = uS(false);
  // Tanda 3.4: que la IA elija y cuente la historia del cronograma. Lo que
  // le preocupa a Gabriel de la obra va con el pedido (opcional); el relato
  // que vuelve se guarda con el escenario (`relatoIA`).
  const [preocupacion, setPreocupacion] = uS('');
  const [pidiendoHistoria, setPidiendoHistoria] = uS(false);
  const [motivoHistoriaIA, setMotivoHistoriaIA] = uS(null);
  const historiaIARef = uR(false);

  // ── Escenarios (localStorage, por obra) ───────────────────────────
  // El primer render ya lee lo guardado (sin esperar al efecto): si no, la
  // pantalla se pinta un instante con los defaults —modo real, con sus
  // avisos— y salta al escenario de verdad, que puede ser una simulación.
  const [escenarios, setEscenarios] = uS(() => (obraId ? leerEscenarios(obraId) : []));
  const [escenario, setEscenario] = uS(() => escenarios[0] || null);
  const escRef = uR(escenario);
  const exportRef = uR(false);
  // Cómo se compra cada insumo (unidad, lote, colchón): de la OBRA, no del
  // escenario — ver `leerCompras` en simulador-escenarios.js.
  const [compras, setCompras] = uS({});

  uE(() => {
    if (!obraId && obras.length) {
      const guardada = window.__getObraActivaId?.();
      const a = (guardada && obras.find(o => o.id === guardada)) || obras[0];
      if (a) setObraId(a.id);
    }
  }, [obras, obraId]);

  // Los escenarios se leen al entrar y cuando se cambia de obra. Si no hay
  // ninguno se crea uno con los defaults: entrar y encontrar la pantalla
  // vacía pidiendo «creá un escenario» es una puerta cerrada de más.
  uE(() => {
    if (!obraId) { setEscenarios([]); setEscenario(null); escRef.current = null; setCompras({}); return; }
    setCompras(leerCompras(obraId));
    let lista = leerEscenarios(obraId);
    if (!lista.length) {
      const base = nuevoEscenario({ nombre: 'Escenario base', obraId, params: PARAMS_DEFAULT });
      lista = guardarEscenario(obraId, base);
    }
    setEscenarios(lista);
    setEscenario(lista[0]);
    escRef.current = lista[0];
    setAbiertos(new Set());
  }, [obraId]);

  // Las órdenes ya emitidas y sus ítems: es lo que evita pedir dos veces lo
  // que ya se pidió. No hay hook de `oc_items`, así que van de Dexie.
  uE(() => {
    let vivo = true;
    const cargar = async () => {
      try {
        const [o, i, pv, rq, ri, mv] = await Promise.all([
          window.__db.ordenes_compra.toArray(),
          window.__db.oc_items.toArray(),
          window.__db.proveedores.toArray(),
          window.__db.requisiciones.toArray(),
          window.__db.requisicion_items.toArray(),
          // Las compras del grupo son de dónde sale la sugerencia de
          // proveedor (§6). Se leen enteras una vez y el perfilado se
          // memoiza: son 1.814 líneas de ítems en 741 comprobantes.
          window.__db.accounting_movements.toArray(),
        ]);
        if (!vivo) return;
        setOrdenes(o.filter(x => !x.deleted_at));
        setOcItems(i.filter(x => !x.deleted_at));
        setProveedores(pv.filter(x => !x.deleted_at));
        setRequisiciones(rq.filter(x => !x.deleted_at));
        setReqItems(ri.filter(x => !x.deleted_at));
        setMovs(mv.filter(x => !x.deleted_at));
      } catch {
        if (vivo) { setOrdenes([]); setOcItems([]); setProveedores([]); setRequisiciones([]); setReqItems([]); setMovs([]); }
      }
    };
    cargar();
    const on = (e) => {
      const t = e?.detail?.tabla;
      if (!t || ['ordenes_compra', 'oc_items', 'proveedores', 'requisiciones', 'requisicion_items', 'accounting_movements'].includes(t)) cargar();
    };
    window.addEventListener('jx_data_changed', on);
    window.addEventListener('jx_sync_pull', cargar);
    return () => {
      vivo = false;
      window.removeEventListener('jx_data_changed', on);
      window.removeEventListener('jx_sync_pull', cargar);
    };
  }, [recalcN]);

  // ── El almacén de la obra (tanda 2.5) ─────────────────────────────
  // Es donde de verdad quedó lo comprado: en Miraflores entraron 3.140
  // bolsas de cemento y las órdenes explican 2.250. Se lee solo el de esta
  // obra (todas las tablas tienen índice por obra_id).
  uE(() => {
    let vivo = true;
    if (!obraId) { setAlmacenCrudo(null); return undefined; }
    const TABLAS = ['materiales', 'herramientas', 'epps', 'movimientos_materiales', 'movimientos_herramientas', 'movimientos_epp'];
    const cargar = async () => {
      try {
        const [mat, her, epp, mm, mh, me] = await Promise.all(TABLAS.map(t => (
          window.__db[t] ? window.__db[t].where('obra_id').equals(obraId).toArray() : Promise.resolve([])
        )));
        if (vivo) setAlmacenCrudo({ mat, her, epp, mm, mh, me });
      } catch {
        if (vivo) setAlmacenCrudo({ mat: [], her: [], epp: [], mm: [], mh: [], me: [] });
      }
    };
    cargar();
    const on = (e) => { const t = e?.detail?.tabla; if (!t || TABLAS.includes(t)) cargar(); };
    window.addEventListener('jx_data_changed', on);
    window.addEventListener('jx_sync_pull', cargar);
    return () => {
      vivo = false;
      window.removeEventListener('jx_data_changed', on);
      window.removeEventListener('jx_sync_pull', cargar);
    };
  }, [obraId, recalcN]);

  const almacenFilas = uM(() => (almacenCrudo ? existenciasDelAlmacen({
    materiales: almacenCrudo.mat, herramientas: almacenCrudo.her, epps: almacenCrudo.epp,
    movMateriales: almacenCrudo.mm, movHerramientas: almacenCrudo.mh, movEpp: almacenCrudo.me,
    obraId,
  }) : []), [almacenCrudo, obraId]);

  // El presupuesto como catálogo contra el que se imputa: uno por código.
  const catalogoPres = uM(() => catalogoDelPresupuesto(ipHook.data || []), [ipHook.data]);

  const obra = uM(() => obras.find(o => o.id === obraId) || null, [obras, obraId]);
  const titularId = uM(() => titularContableDeObra(obra, consHook.data || []), [obra, consHook.data]);
  const titular = uM(() => (compHook.data || []).find(c => c.id === titularId) || null, [compHook.data, titularId]);

  const params = escenario?.params || PARAMS_DEFAULT;

  const ordenesObra = uM(
    () => ordenes.filter(o => !obraId || o.obra_id === obraId),
    [ordenes, obraId]
  );

  // ── Lo que el plan YA escribió (tanda 4) ──────────────────────────
  // Es lo que evita que la corrida de noviembre vuelva a proponer lo que ya
  // se requisó en octubre (§7: nada se pide dos veces).
  //
  // Con la anulación aplicada (tanda 4.2): la requisición del plan cuya orden
  // se anuló sale como `cancelada` — vuelve al plan — aunque la anulación se
  // haya hecho en otra computadora o antes de que Órdenes supiera liberarla.
  // Se miran TODAS las órdenes, no solo las de la obra: el `oc_id` manda.
  const requisicionesObra = uM(
    () => aplicarAnulaciones({
      requisiciones: requisiciones.filter(r => !obraId || r.obra_id === obraId),
      ordenes,
    }),
    [requisiciones, obraId, ordenes]
  );
  const reqItemsObra = uM(() => {
    const ids = new Set(requisicionesObra.map(r => r.id));
    return reqItems.filter(it => ids.has(it.requisicion_id));
  }, [reqItems, requisicionesObra]);

  // Cuánto se lleva gastado de cada sobre. Sin esto el motor deja
  // `consumido` en null a propósito y la pantalla marca el techo como «no
  // firme» — creer un sobre intacto cuando ya se gastó la mitad es el doble
  // gasto que el §7 viene a evitar.
  const consumoSobres = uM(
    () => consumoDeSobres({ requisiciones: requisicionesObra, requisicionItems: reqItemsObra }),
    [requisicionesObra, reqItemsObra]
  );

  const yaEscrito = uM(
    () => estadoDelPlan({ requisiciones: requisicionesObra, requisicionItems: reqItemsObra }),
    [requisicionesObra, reqItemsObra]
  );

  const plazo = uM(() => (obra?.fecha_inicio
    ? { inicio: obra.fecha_inicio, fin: obra.fecha_fin_estimada || obra.fecha_fin || null }
    : null), [obra]);

  const simulacion = params.modo === 'simulacion';

  // ── DE DÓNDE SALEN LAS FECHAS (§15.3 y tanda 3.3) ─────────────────
  // El arranque de la simulación («como si empezara hoy» o una fecha) corre
  // el cronograma entero; encima, el cronograma «aleatorio por escenario»
  // cuenta una historia de la obra (frenazo, arranque lento…). Las dos cosas
  // le llegan al motor como una reprogramación de las partidas, y el reparto
  // «según el escenario» como `repartoManual` (el motor solo aprendió el
  // nombre de ese reparto). La traducción vive en `armarCronograma`
  // (simulador-cronograma.js).
  const cron = uM(() => armarCronograma({
    partidas: partidasHook.data || [], insumosPartida: ipHook.data || [], plazo,
    hoy: window.__fecha?.hoyLocal?.() || undefined,
    modo: params.modo, arranque: params.arranque, arranqueFecha: params.arranqueFecha,
    cronograma: params.cronograma,
    historia: params.historia, semilla: params.semilla, historiaAjustes: params.historiaAjustes,
    reparto: params.reparto, granularidad: params.granularidad, anticipacionDias: params.anticipacionDias,
  }), [partidasHook.data, ipHook.data, plazo, params.modo, params.arranque, params.arranqueFecha,
    params.cronograma, params.historia, params.semilla, params.historiaAjustes,
    params.reparto, params.granularidad, params.anticipacionDias]);
  const desplazado = cron.desplazado;
  const historia = cron.escenario;

  // ── LO QUE TODAS LAS CORRIDAS COMPARTEN ───────────────────────────
  // Desde la tanda 4.2 los DOS modos reciben lo real (doc §16.2, decisión 2):
  // la Simulación también termina en órdenes de verdad, y no puede volver a
  // proponer lo que ya se emitió. Qué cuenta lo deciden las perillas del
  // escenario, no el modo: `comprado` (con factura / todas las emitidas; el
  // borrador nunca, lo del plan siempre) y el almacén, que en Simulación
  // arranca en «nada». Lo ejecutado sigue siendo solo del modo real.
  const almacenModoActivo = almacenModoDe(params);
  // Los meses cerrados del escenario (tanda 4.3): lo que queda en ellos el
  // motor lo reprograma en los abiertos. Se memoiza por los cierres y no por
  // el escenario entero: aceptar una línea no tiene por qué recalcular el plan.
  const cierresMotor = uM(() => motorDeCierres(escenario), [escenario?.cierres]);
  const baseMotor = uM(() => {
    const motor = paramsDeMotor(params);
    return {
      insumosPartida: ipHook.data || [],
      partidas: partidasHook.data || [],
      ...motor,
      ...cron.motor,
      terminosCustom,
      compras,
      ordenes: ordenesObra, ocItems,
      requisiciones: requisicionesObra, requisicionItems: reqItemsObra,
      // La factura de una orden se reconoce también por el comprobante que
      // apunta a ella (`orden_compra_id`): la orden fusionada solo tiene ese.
      movimientos: movs,
      consumoSobres, almacen: almacenFilas,
      ...cierresMotor,
    };
  }, [params, ipHook.data, partidasHook.data, cron.motor, terminosCustom, compras,
    ordenesObra, ocItems, requisicionesObra, reqItemsObra, movs, consumoSobres, almacenFilas, cierresMotor]);

  // ── LA CORRIDA DE ÓRDENES ─────────────────────────────────────────
  // `mano_obra` se saca del filtro aunque esté tildada: la planilla no se
  // compra, y mezclarla acá la mostraría como algo que se le puede emitir a
  // un proveedor. Va por su propia pestaña (§5).
  const corrida = uM(() => {
    if (!obraId) return null;
    return simularOrdenes({
      ...baseMotor,
      categorias: baseMotor.categorias.filter(c => c !== 'mano_obra'),
    });
  }, [obraId, baseMotor, recalcN]);

  // ── LA CURVA DE CARGA (tanda 3.3, §15.2 C) ────────────────────────
  // Lo que hace legible una historia: la plata de cada mes con la historia y
  // SIN ella (el mismo escenario sobre el Gantt, con el mismo arranque). Es
  // una segunda corrida del motor, y solo se hace con una historia activa.
  const corridaSinHistoria = uM(() => {
    if (!obraId || !cron.motorSinHistoria) return null;
    return simularOrdenes({
      ...baseMotor,
      ...cron.motorSinHistoria,
      categorias: baseMotor.categorias.filter(c => c !== 'mano_obra'),
    });
  }, [obraId, baseMotor, cron.motorSinHistoria, recalcN]);
  const curva = uM(
    () => (corrida && corridaSinHistoria ? curvaDeCarga(corridaSinHistoria, corrida) : null),
    [corrida, corridaSinHistoria]
  );

  // ── «Personalizado por insumo» (tanda 2.5) ────────────────────────
  // Es lo único de la imputación que sigue siendo del ESCENARIO: elegir qué
  // resta el almacén, insumo por insumo. Imputar la fila en sí (decirle a qué
  // insumo corresponde) es ahora la página aparte `ImputarComprasPage`
  // (tanda 3.2) — eso no depende de qué escenario esté mirando Gabriel.
  // Se arma solo con ⚙ abierto y en modo personalizado.
  const cubiertosAlmacen = uM(
    () => (ajustes && almacenModoActivo === 'personalizado'
      ? insumosCubiertosPorAlmacen(almacenFilas, catalogoPres) : []),
    [ajustes, almacenModoActivo, almacenFilas, catalogoPres]
  );

  // ── LA CORRIDA DE MANO DE OBRA (referencia, nunca una orden) ──────
  const corridaMO = uM(() => {
    if (!obraId || vista !== 'dotacion') return null;
    return simularOrdenes({
      insumosPartida: baseMotor.insumosPartida,
      partidas: baseMotor.partidas,
      granularidad: baseMotor.granularidad, anclaje: baseMotor.anclaje,
      cronograma: baseMotor.cronograma, reparto: baseMotor.reparto,
      reprogramacion: baseMotor.reprogramacion, plazo: baseMotor.plazo,
      repartoManual: baseMotor.repartoManual,
      umbralTramoLargoDias: baseMotor.umbralTramoLargoDias,
      anticipacionDias: baseMotor.anticipacionDias,
      // Lo ya ejecutado tampoco necesita gente (tanda 3.5).
      restarAvance: baseMotor.restarAvance,
      categorias: ['mano_obra'],
    });
  }, [obraId, baseMotor, vista]);

  const dotacion = uM(() => {
    if (!corridaMO) return null;
    return simularDotacion({
      manoObra: corridaMO.manoObra,
      personal: personalHook.data || [],
      partidas: partidasHook.data || [],
      jornada: params.jornada,
      contarSubcontratos: params.contarSubcontratos,
    });
  }, [corridaMO, personalHook.data, partidasHook.data, params.jornada, params.contarSubcontratos]);

  const decorado = uM(
    () => aplicarEscenario(corrida || { propuestas: [], sobres: [] }, escenario),
    [corrida, escenario]
  );

  // ── HERRAMIENTAS Y EPP CONTRA EL STOCK (tanda 3.5, §15.2 E) ──────
  // En modo real, siempre. En Simulación solo si el escenario hace entrar al
  // almacén (tanda 4.2: ahí arranca en «nada», y entonces el almacén no
  // tiene nada que decir). Mira la corrida y no el escenario decorado: lo
  // que se compara es el insumo, no cómo se decidió cada línea.
  const stockPlan = uM(() => {
    if (!corrida || (simulacion && almacenModoActivo === 'nada')) return null;
    return stockContraPlan({
      almacen: almacenFilas,
      lineas: corrida.propuestas.flatMap(p => p.lineas),
      sobres: corrida.sobres,
    });
  }, [simulacion, almacenModoActivo, corrida, almacenFilas]);

  // ── LOS TRES ENFOQUES (tanda 2.6, opcional) ───────────────────────
  // Determinístico y gratis: corre el motor real 3 veces con las perillas
  // de reparto/anticipación/frecuencia/monto mínimo ya existentes. Desde la
  // 3.1 viven en ⚙ como «puntos de partida» y se calculan solo con ⚙ abierto
  // — son 4 corridas del motor y Miraflores no las necesita hasta que alguien
  // las mira.
  const enfoques = uM(() => {
    if (!obraId || !ajustes) return null;
    return sortearEnfoques({ ...baseMotor, categorias: baseMotor.categorias.filter(c => c !== 'mano_obra') });
  }, [obraId, ajustes, baseMotor]);

  // Se limpia al recalcular: una recomendación vieja sobre números que ya
  // cambiaron (otra obra, otro escenario) no se puede seguir mostrando como
  // si fuera de esta corrida.
  uE(() => { setRecoIA(null); }, [enfoques]);

  const pedirRecomendacionIA = async () => {
    if (!enfoques?.length || pidiendoIA) return;
    setPidiendoIA(true);
    try {
      const contexto = {
        obra_nombre: obra?.nombre_obra || '',
        plazo_fin: plazo?.fin || null,
        montoComprable: resumen?.montoComprable ?? null,
        categoriasActivas: params.categorias,
        lineasTramoLargo: resumen?.lineasTramoLargo ?? null,
        almacenModo: almacenModoActivo,
      };
      const r = await recomendarEnfoque(enfoques, contexto);
      setRecoIA(r);
    } finally {
      setPidiendoIA(false);
    }
  };

  // Los rubros que tiene el plan, para fijarles una frecuencia propia. Los
  // que ya tienen una fijada se ofrecen aunque esta corrida no los traiga:
  // si no, quedaría una frecuencia puesta que no se puede sacar.
  const rubrosDelPlan = uM(() => {
    const ids = new Set((corrida?.propuestas || []).map(p => p.rubro));
    for (const r of Object.keys(params.frecuenciaPorRubro || {})) ids.add(r);
    return [...ids]
      .map(r => ({ rubro: r, nombre: RUBRO_COMPRA_POR_ID.get(r)?.nombre || r, icono: RUBRO_COMPRA_POR_ID.get(r)?.icono || '' }))
      .sort((a, b) => ordenDeRubro(a.rubro) - ordenDeRubro(b.rubro));
  }, [corrida, params.frecuenciaPorRubro]);

  const entregable = uM(() => lineasAceptadas(decorado), [decorado]);

  // Los proveedores candidatos: las empresas del grupo primero (son las que
  // facturan adentro) y después el catálogo, alfabético.
  //
  // Las empresas traen `rubro`; los 549 del catálogo NO —`proveedores` no
  // tiene esa columna (verificado el 22-set-2026)—. Por eso acá no se ordena
  // por rubro: lo haría para 28 de 577 y parecería una recomendación cuando
  // en realidad no lo es. El matching del §6 (rubro + historial de precios)
  // es de la tanda 4, y va a necesitar esa columna o salir del historial.
  const candidatos = uM(() => {
    const grupo = [], catalogo = [];
    for (const c of (compHook.data || [])) {
      if (c.deleted_at) continue;
      grupo.push({ id: c.id, nombre: c.name || c.legal_name || '(sin nombre)', rubro: c.rubro || null, grupo: true });
    }
    for (const p of proveedores) {
      catalogo.push({ id: p.id, nombre: p.razon_social || p.nombre || '(sin nombre)', ruc: p.ruc || '', grupo: false });
    }
    const porNombre = (a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es');
    return [...grupo.sort(porNombre), ...catalogo.sort(porNombre)];
  }, [compHook.data, proveedores]);

  // ── A QUIÉN PEDIRLE (§6, tanda 4) ─────────────────────────────────
  // El rubro no alcanzaba: lo traen 28 de 577 candidatos. Lo que sí existe
  // es qué facturó cada uno — 1.814 líneas con proveedor identificado. De
  // ahí sale la sugerencia, y de ahí NO sale ningún precio: ver el
  // encabezado de `simulador-proveedor.js`.
  const perfiles = uM(() => {
    if (!movs.length) return new Map();
    const nombrePorId = {};
    for (const p of proveedores) nombrePorId[p.id] = p.razon_social || p.nombre || '';
    return perfilarProveedores(movs, { nombrePorId });
  }, [movs, proveedores]);

  // Se calcula solo para la tarjeta ABIERTA: perfilar contra 167 líneas por
  // cada una de las ~30 tarjetas al pintar la lista cuelga la pestaña.
  const sugerencias = uM(() => {
    const out = {};
    if (!perfiles.size) return out;
    for (const p of (decorado.propuestas || [])) {
      if (!abiertos.has(p.id)) continue;
      out[p.id] = sugerirProveedores(p.lineas, perfiles, { max: 4 });
    }
    return out;
  }, [perfiles, decorado.propuestas, abiertos]);

  // Escribir el nombre tiene que poder resolverse al id. Si no está en la
  // lista se guarda igual, solo con el nombre: el catálogo no tiene a todos y
  // obligar a elegir dejaría sin proveedor justo a los casos nuevos.
  const resolverProveedor = uC((texto) => {
    const t = String(texto || '').trim();
    if (!t) return { id: null, nombre: '' };
    const hit = candidatos.find(c => c.nombre.toLowerCase() === t.toLowerCase());
    return hit ? { id: hit.id, nombre: hit.nombre } : { id: null, nombre: t };
  }, [candidatos]);

  // ── LAS PESTAÑAS POR CATEGORÍA (tanda 3.1, §15.2 E) ──────────────
  // Cada orden va entera a UNA pestaña (la categoría que más pesa adentro:
  // `categoriaDePropuesta`). Si la pestaña abierta se destildó en «Qué se
  // incluye», se cae a la primera que quede.
  const catsIncluidas = uM(
    () => CATS_ORDENES.filter(c => params.categorias.includes(c)),
    [params.categorias]
  );
  const vistaCat = CATS_ORDENES.includes(vista)
    ? (catsIncluidas.includes(vista) ? vista : (catsIncluidas[0] || null))
    : null;
  const vistaActual = CATS_ORDENES.includes(vista) ? (vistaCat || 'pendientes') : vista;

  const catDe = uM(() => {
    const m = new Map();
    for (const p of (decorado.propuestas || [])) m.set(p.id, categoriaDePropuesta(p));
    return m;
  }, [decorado.propuestas]);

  const porCategoria = uM(() => {
    const out = {};
    for (const c of CATS_ORDENES) out[c] = { propuestas: [], sobres: [], monto: 0, aceptado: 0, pendientes: 0 };
    for (const p of (decorado.propuestas || [])) {
      const g = out[catDe.get(p.id)?.categoria] || out.materiales;
      g.propuestas.push(p);
      g.monto += num(p.montoEditado);
      g.aceptado += num(p.montoAceptado);
      if (p.estado === 'pendiente' || p.estado === 'parcial') g.pendientes += 1;
    }
    for (const s of (decorado.sobres || [])) (out[s.categoria] || out.materiales).sobres.push(s);
    return out;
  }, [decorado.propuestas, decorado.sobres, catDe]);

  const propuestasDeCat = uM(
    () => (vistaCat ? porCategoria[vistaCat].propuestas : []),
    [vistaCat, porCategoria]
  );

  const propuestasVisibles = uM(() => {
    const q = busca.trim().toLowerCase();
    return propuestasDeCat.filter(p => {
      if (soloPendientes && p.estado !== 'pendiente' && p.estado !== 'parcial') return false;
      if (!q) return true;
      if (p.titulo.toLowerCase().includes(q)) return true;
      return p.lineas.some(l => `${l.nombre} ${l.insumo_codigo || ''}`.toLowerCase().includes(q));
    });
  }, [propuestasDeCat, busca, soloPendientes]);

  const porPeriodo = uM(() => {
    const m = new Map();
    for (const p of propuestasVisibles) {
      const g = m.get(p.periodo) || { periodo: p.periodo, etiqueta: p.etiquetaPeriodo, propuestas: [], monto: 0, aceptado: 0 };
      g.propuestas.push(p);
      g.monto += num(p.montoEditado);
      g.aceptado += num(p.montoAceptado);
      m.set(p.periodo, g);
    }
    return [...m.values()].sort((a, b) => (a.periodo < b.periodo ? -1 : 1));
  }, [propuestasVisibles]);

  // ── TIRA DE CHIPS POR PERÍODO (tanda 2.4) ─────────────────────────
  // Ver noviembre hoy es bajar por todos los meses anteriores. La tira
  // resume cada mes (monto, n° de órdenes, cuánto ya se decidió) y saltа al
  // bloque con un click. En semana a semana las semanas cuelgan como
  // sub-chips DE su mes (mismo `mesDePeriodo` que ya usa la consolidación,
  // §12.3): así «octubre» sigue siendo una sola parada aunque tenga 4-5
  // semanas adentro, en vez de una tira de 36 chips sueltos.
  const chipsPorMes = uM(() => {
    if (params.granularidad !== 'semana') {
      return porPeriodo.map(g => ({
        clave: g.periodo, etiqueta: g.etiqueta, monto: g.monto,
        ordenes: g.propuestas.length,
        decididas: g.propuestas.filter(p => p.estado !== 'pendiente').length,
        semanas: null,
      }));
    }
    const m = new Map();
    for (const g of porPeriodo) {
      const mes = mesDePeriodo(g.periodo) || g.periodo;
      const acc = m.get(mes) || { clave: mes, etiqueta: etiquetaPeriodo(mes), monto: 0, ordenes: 0, decididas: 0, semanas: [] };
      acc.monto += g.monto;
      acc.ordenes += g.propuestas.length;
      acc.decididas += g.propuestas.filter(p => p.estado !== 'pendiente').length;
      acc.semanas.push({
        clave: g.periodo, etiqueta: g.etiqueta, monto: g.monto,
        ordenes: g.propuestas.length,
        decididas: g.propuestas.filter(p => p.estado !== 'pendiente').length,
        semanas: null,
      });
      m.set(mes, acc);
    }
    return [...m.values()].sort((a, b) => (a.clave < b.clave ? -1 : 1));
  }, [porPeriodo, params.granularidad]);

  const irAlPeriodo = (periodo) => {
    document.getElementById(`jx-sim-periodo-${periodo}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ── Mutaciones del escenario (se autoguardan) ─────────────────────
  // Autosave y no un botón «Guardar»: lo que se pierde acá son decisiones de
  // una por una, y perderlas por cerrar la pestaña obliga a rehacer el
  // trabajo entero. El botón que sí existe es «Guardar como…», que es otra
  // cosa: duplicar el escenario para comparar.
  const mutar = uC((fn) => {
    const actual = escRef.current;
    if (!actual) return;
    const nuevo = fn(actual);
    escRef.current = nuevo;
    setEscenario(nuevo);
    setEscenarios(guardarEscenario(obraId, nuevo));
  }, [obraId]);

  const cambiarParam = (patch) => mutar(e => conParams(e, patch));

  // «🎲 Otro» (§15.2 C): otra semilla. Con «al azar» sale otra historia; con
  // una elegida, la misma historia con otra intensidad dentro de sus rangos.
  // Los ajustes fijados se sueltan: el sorteo nuevo es justamente lo pedido.
  const otraHistoria = () => cambiarParam({ semilla: semillaNueva(params.semilla), historiaAjustes: {} });

  // «🤖 Que la IA elija la historia» (tanda 3.4). La IA ve la plata por mes
  // con el Gantt, el plazo y lo que preocupa; devuelve un id del catálogo,
  // perillas y relato, ya saneados dos veces (servidor y cliente). Lo que no
  // fijó se completa con el sorteo, para que el relato describa EXACTAMENTE
  // lo que se simula. Anti doble-click con ref síncrono (regla crítica 2):
  // dos pedidos en vuelo pisarían la historia con la del que llegue último.
  const pedirHistoriaIA = async () => {
    if (historiaIARef.current || !curva) return;
    historiaIARef.current = true;
    setPidiendoHistoria(true);
    setMotivoHistoriaIA(null);
    try {
      const contexto = contextoParaHistoria({
        obraNombre: obra?.nombre_obra || obra?.nombre || '',
        plazo: cron.desplazado?.plazo || plazo,
        desde: historia?.desdeHoy ? historia.inicio : null,
        modo: params.modo,
        curva,
        montoComprable: corrida?.resumen?.montoComprable ?? null,
        preocupacion,
      });
      const r = await elegirHistoriaConIA(contexto);
      if (!r.historia) { setMotivoHistoriaIA(r.motivo || 'la IA no respondió'); return; }
      const h = HISTORIA_POR_ID.get(r.historia);
      const { valores } = valoresDeHistoria(h, params.semilla, r.ajustes);
      mutar(e => conHistoriaIA(e, { ...r, valores }));
      toast(`La IA eligió «${h.etiqueta}»: las fechas y la plata las recalculó el sistema`, 'green');
    } finally {
      historiaIARef.current = false;
      setPidiendoHistoria(false);
    }
  };

  // Vale para ese insumo en TODOS los meses y escenarios de la obra.
  const cambiarCompra = uC((clave, patch) => {
    if (!obraId || !clave) return;
    setCompras(guardarCompra(obraId, clave, patch));
  }, [obraId]);

  // Un sobre sin detalle («ACARREO…», «HERRAMIENTAS MANUALES») casi siempre
  // significa que a esa partida le faltó el desglose de insumos al importar
  // el APU. En vez de mandar a adivinar dónde corregirlo, salta directo a
  // «Insumos por Partida» con la partida ya elegida — mismo patrón intent
  // (`__insumosTarget*`) que usan Partidas y el Gantt.
  const irAInsumosDeSobre = (s) => {
    const ids = s.partidaIds || [];
    if (!ids.length) return;
    if (ids.length > 1) {
      toast(`Este sobre aparece en ${ids.length} partidas: se abre la primera.`, 'amber');
    }
    const partida = (partidasHook.data || []).find(p => p.id === ids[0]);
    try {
      window.__insumosTargetPartida = ids[0];
      window.__insumosTargetCodigo = partida?.codigo_delfin || '';
      window.__insumosTargetEsHoja = true;
      window.__insumosFromPartidas = true;
      window.__insumosFromGantt = false;
      window.dispatchEvent(new CustomEvent('jx_navigate', { detail: { page: 'insumos' } }));
    } catch {}
  };

  // «Imputar lo ya comprado» es su propia página desde la tanda 3.2: la obra
  // activa ya la va a tener puesta al entrar (mismo patrón que cualquier otra
  // navegación entre páginas de una obra).
  const irAImputar = () => {
    try { window.dispatchEvent(new CustomEvent('jx_navigate', { detail: { page: 'imputar-compras' } })); } catch {}
  };

  // «Clasificar» desde el simulador (tanda 4.1, §16.1 #3). Antes esto solo se
  // podía arreglar yendo a «Clasificación de insumos y servicios»: acá se
  // enseña al mismo diccionario propio, por línea o por TODAS las líneas «sin
  // clasificar» de una orden a la vez (mismo código para todas — es lo que
  // pasa casi siempre: una orden trae el mismo insumo repartido en semanas).
  // `enseñarDiccionario` no lanza nunca; lo único que puede fallar en serio es
  // el refresh, y ni eso debería tapar el toast.
  const ensenarClasificacion = async (nombres, codigo) => {
    const lista = [...new Set((Array.isArray(nombres) ? nombres : [nombres]).filter(Boolean))];
    if (!lista.length || !codigo) return;
    let n = 0;
    for (const nombre of lista) {
      const r = await enseñarDiccionario({ descripcion: nombre, clasificacionCodigo: codigo }, { userId: autorId });
      if (r) n++;
    }
    try { await terHook.refresh?.(); } catch {}
    if (n) toast(`${n === 1 ? '1 insumo clasificado' : `${n} insumos clasificados`} como ${etiquetaCategoria(codigo)}.`, 'green');
    else toast('Ya estaba clasificado así.', 'amber');
  };

  const toggleCategoria = (cat) => {
    const actuales = new Set(params.categorias);
    if (actuales.has(cat)) actuales.delete(cat); else actuales.add(cat);
    cambiarParam({ categorias: [...actuales] });
  };

  const elegirEscenario = (id) => {
    const e = escenarios.find(x => x.id === id);
    if (!e) return;
    escRef.current = e;
    setEscenario(e);
    setAbiertos(new Set());
  };

  const duplicarEscenario = () => {
    const base = escRef.current;
    if (!base) return;
    const nombre = (window.prompt?.('Nombre del escenario nuevo:', `${base.nombre} (copia)`) || '').trim();
    if (!nombre) return;
    const copia = { ...nuevoEscenario({ nombre, obraId, params: base.params }), decisiones: base.decisiones, ediciones: base.ediciones, sobres: base.sobres, relatoIA: base.relatoIA || null, cierres: base.cierres || {} };
    const lista = guardarEscenario(obraId, copia);
    setEscenarios(lista);
    escRef.current = copia;
    setEscenario(copia);
    toast(`Escenario «${nombre}» creado`, 'green');
  };

  const renombrarEscenario = () => {
    const base = escRef.current;
    if (!base) return;
    const nombre = (window.prompt?.('Nuevo nombre:', base.nombre) || '').trim();
    if (!nombre) return;
    mutar(e => ({ ...e, nombre }));
  };

  const eliminarEscenario = () => {
    const base = escRef.current;
    if (!base) return;
    if (!window.confirm?.(`¿Borrar el escenario «${base.nombre}»? Se pierden sus decisiones y correcciones.`)) return;
    let lista = borrarEscenario(obraId, base.id);
    if (!lista.length) lista = guardarEscenario(obraId, nuevoEscenario({ nombre: 'Escenario base', obraId }));
    setEscenarios(lista);
    escRef.current = lista[0];
    setEscenario(lista[0]);
  };

  const toggleAbierto = (id) => setAbiertos(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  // Anti doble-click (regla crítica 2): ref SÍNCRONO. La descarga arma un
  // Blob y dispara un click; dos clicks en la misma ventana bajan dos veces
  // el mismo archivo con nombres distintos.
  const exportarCsv = async () => {
    if (exportRef.current) return;
    if (!entregable.lineas.length) { toast('Todavía no hay ninguna línea aceptada', 'amber'); return; }
    exportRef.current = true;
    try {
      const cab = ['periodo', 'orden', 'categoria', 'codigo', 'descripcion', 'unidad', 'cantidad', 'precio_unitario', 'monto',
        'equivale_en_expediente', 'unidad_expediente', 'entregas', 'proveedor', 'nota'];
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const filas = entregable.lineas.map(l => [
        l.etiquetaVentana || l.etiquetaPeriodo, l.propuesta_id, SUBCATEGORIA_LABEL[l.subcategoria] || l.subcategoria,
        l.insumo_codigo || '', l.descripcion, l.unidad, l.cantidad, l.precio_unitario, l.monto,
        r4ui(num(l.cantidad) * (num(l.factor) || 1)), l.unidadExpediente || l.unidad,
        (l.entregas || []).length > 1 ? l.entregas.map(e => `${e.etiquetaPeriodo}: ${e.cantidad}`).join(' | ')
          : (l.entregas === null && (l.periodos || []).length > 1 ? 'a coordinar (cantidad corregida)' : ''),
        l.proveedor_nombre || '', l.nota || '',
      ].map(esc).join(';'));
      const csv = `﻿${cab.join(';')}\n${filas.join('\n')}`;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `plan-ordenes-${(escenario?.nombre || 'escenario').replace(/[^\w-]+/g, '_')}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast(`${entregable.lineas.length} línea(s) exportadas`, 'green');
    } finally { exportRef.current = false; }
  };

  // ═══ EL PUENTE AL DOCUMENTO REAL (tanda 4, §7) ══════════════════
  //
  // Son DOS pasos y no uno, a propósito. Ver el encabezado de
  // `simulador-puente.js`: la requisición se puede borrar y rehacer, la
  // orden quema un correlativo de la ejecutora que no se recupera.

  const permiso = uM(
    () => puedeEmitirOrden({ obra, consorcios: consHook.data || [] }),
    [obra, consHook.data]
  );


  // Anti doble-click (regla crítica 2): ref SÍNCRONO. El guard por estado se
  // activa recién después del await a Dexie y en esa ventana un segundo
  // click escribe el lote entero otra vez.
  const convertirEnRequisiciones = async () => {
    if (convertirRef.current) return;
    const { lineas, sinPrecio } = entregable;
    if (!lineas.length) { toast('Todavía no hay ninguna línea aceptada con precio', 'amber'); return; }

    const plan = armarRequisiciones({
      lineas, obraId,
      escenario,
      solicitante: { id: auth?.profile?.id || null, nombre: userNombre },
      yaEscritas: requisicionesObra,
      // Con los ítems, el freno contra escribir dos veces es por línea: una
      // entrega nueva que cayó en una orden ya escrita a medias no se saltea.
      yaEscritasItems: reqItemsObra,
      nuevoId: () => window.__newId(),
    });

    if (!plan.requisiciones.length) {
      toast(plan.duplicadas.length
        ? `Todo lo aceptado ya está escrito como requisición (${plan.duplicadas.length} línea(s))`
        : 'No quedó nada para escribir', 'amber');
      return;
    }

    const aviso = [
      `Se van a crear ${plan.resumen.requisiciones} requisición(es) con ${plan.resumen.items} línea(s) por ${soles(plan.resumen.monto)}.`,
      plan.duplicadas.length ? `${plan.duplicadas.length} línea(s) ya estaban escritas y se saltean.` : '',
      plan.omitidas.length ? `${plan.omitidas.length} se omiten (mirá el detalle después).` : '',
      sinPrecio.length ? `${sinPrecio.length} aceptada(s) sin precio NO se escriben.` : '',
      '',
      'Todavía no es una orden: se puede editar y borrar. ¿Seguimos?',
    ].filter(Boolean).join('\n');
    if (!window.confirm?.(aviso)) return;

    convertirRef.current = true;
    try {
      await escribirRequisiciones(plan);
      toast(`✓ ${plan.resumen.requisiciones} requisición(es) creadas · ${plan.resumen.items} línea(s) por ${soles(plan.resumen.monto)}`, 'green');
      setVista('documentos');
    } catch (e) {
      console.warn('[simulador] error al escribir requisiciones', e);
      toast(`No se pudo escribir: ${e?.message || e}`, 'red');
    } finally {
      convertirRef.current = false;
    }
  };

  // La escritura de un plan de requisiciones, compartida por «Convertir en
  // requisiciones» y «Cerrar mes» (tanda 4.3). Lanza si Dexie falla: quien la
  // llama decide qué decir.
  const escribirRequisiciones = async (plan, { motivo = null } = {}) => {
    const now = new Date().toISOString();
    // `requisicion_items` y `oc_items` NO tienen `created_by`/`updated_by`
    // (mirá el esquema): mandarles esas columnas hace que el push las
    // rechace entero. Por eso el autor se marca solo en las cabeceras.
    const marca = (fila, tabla, { conAutor = false } = {}) => ({
      ...fila,
      created_at: now, updated_at: now,
      // Las columnas de autor son uuid: sin sesión van NULL, no el
      // literal 'offline' (que rebotaría con un 22P02).
      ...(conAutor ? { created_by: autorId, updated_by: autorId } : {}),
      version: 1, sync_status: 'pending_create', last_synced_at: null,
      idempotency_key: `${userId || 'anon'}_${tabla}_${fila.id}`,
    });
    for (const { requisicion, items } of plan.requisiciones) {
      await window.__db.requisiciones.add(marca(requisicion, 'req', { conAutor: true }));
      for (const it of items) await window.__db.requisicion_items.add(marca(it, 'req_item'));
    }
    try {
      await window.__logAudit?.({
        action: 'create', table: 'requisiciones', recordId: null,
        newData: { ...plan.resumen, obra_id: obraId, escenario: escenario?.nombre || null },
        reason: `Simulador${motivo ? ` (${motivo})` : ''}: ${plan.resumen.requisiciones} requisición(es) por ${soles(plan.resumen.monto)} desde el escenario «${escenario?.nombre || '—'}»`,
      });
    } catch {}
    for (const t of ['requisiciones', 'requisicion_items']) {
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: t } })); } catch {}
    }
  };

  // ── CERRAR MES (tanda 4.3, §16.3) ─────────────────────────────────
  // Se cierra el PRIMER mes que todavía tiene órdenes (en orden, para que un
  // mes cerrado nunca tenga uno abierto antes). Lo aceptado de las órdenes
  // que se emiten ese mes se escribe como requisiciones —pre-órdenes, se
  // editan y se borran—; lo demás el motor lo reprograma en los meses que
  // quedan con la estrategia de reparto del escenario. Es sobre la corrida
  // ENTERA (todas las pestañas), no solo la categoría abierta.
  const mesACerrar = uM(() => mesPorCerrar(corrida?.propuestas || [], escenario), [corrida, escenario]);
  const mesesCerrados = uM(() => mesesCerradosDe(escenario), [escenario]);

  const cerrarElMes = async () => {
    if (cerrarRef.current || !mesACerrar) return;
    const r = resumenDeCierre(decorado, mesACerrar);
    const plan = r.lineas.length ? armarRequisiciones({
      lineas: r.lineas, obraId, escenario,
      solicitante: { id: auth?.profile?.id || null, nombre: userNombre },
      yaEscritas: requisicionesObra, yaEscritasItems: reqItemsObra,
      nuevoId: () => window.__newId(),
    }) : null;
    const etiqueta = etiquetaPeriodo(mesACerrar);
    const aviso = [
      `Cerrar ${etiqueta}:`,
      '',
      plan?.requisiciones.length
        ? `• Se escriben ${plan.resumen.requisiciones} requisición(es) con ${plan.resumen.items} línea(s) aceptada(s) por ${soles(plan.resumen.monto)}.`
        : '• No hay nada aceptado nuevo para escribir.',
      plan?.duplicadas.length ? `• ${plan.duplicadas.length} línea(s) aceptada(s) ya estaban escritas.` : '',
      r.sinPrecio.length ? `• ${r.sinPrecio.length} aceptada(s) SIN precio no se escriben: se reprograman.` : '',
      (r.rechazadas + r.sinDecidir) > 0
        ? `• ${r.rechazadas} rechazada(s) y ${r.sinDecidir} sin decidir (${soles(r.montoNoAceptado)}) se reprograman en los meses que quedan (${reprogramacionLabel(baseMotor.reparto)}).`
        : '',
      '',
      `${etiqueta} queda congelado en este escenario. Se puede reabrir; las requisiciones escritas quedan en la base.`,
      '¿Cerrar?',
    ].filter(x => x !== '').join('\n');
    if (!window.confirm?.(aviso)) return;

    cerrarRef.current = true;
    try {
      if (plan?.requisiciones.length) await escribirRequisiciones(plan, { motivo: `cierre de ${etiqueta}` });
      // Lo SIN código escrito ahora o antes: el motor no lo puede descontar
      // por código, así que lo saca por mes y clave.
      // Las omitidas (mano de obra, sin cantidad) no se escribieron: no cuentan.
      const omitidas = new Set((plan?.omitidas || []).map(o => o.linea));
      const sinCodigo = sinCodigoDeLineas(r.lineas.filter(l => !omitidas.has(l)));
      mutar(e => cerrarMes(e, mesACerrar, {
        requisiciones: plan?.resumen.requisiciones || 0,
        lineas: plan?.resumen.items || 0,
        monto: plan?.resumen.monto || 0,
        sinCodigo,
        fecha: window.__fecha?.hoyLocal?.() || undefined,
      }));
      toast(plan?.requisiciones.length
        ? `🔒 ${etiqueta} cerrado · ${plan.resumen.requisiciones} requisición(es) por ${soles(plan.resumen.monto)}`
        : `🔒 ${etiqueta} cerrado`, 'green');
    } catch (e) {
      console.warn('[simulador] error al cerrar el mes', e);
      toast(`No se pudo cerrar: ${e?.message || e}`, 'red');
    } finally {
      cerrarRef.current = false;
    }
  };

  const reabrirElMes = (mes) => {
    const etiqueta = etiquetaPeriodo(mes);
    if (!window.confirm?.(
      `¿Reabrir ${etiqueta}?\n\nLo que se había reprogramado vuelve a ${etiqueta}. Las requisiciones que se escribieron al cerrarlo `
      + 'siguen en la base y se siguen descontando: si no las querés, borralas desde Compras.'
    )) return;
    mutar(e => reabrirMes(e, mes));
    toast(`${etiqueta} reabierto`, 'amber');
  };

  const emitirOrden = async (requisicion, proveedorTexto) => {
    if (emitirRef.current) return;
    const items = reqItemsObra.filter(it => it.requisicion_id === requisicion.id);
    const prov = resolverProveedor(proveedorTexto);
    const b = borradorDeOrdenDesdeRequisicion({
      requisicion, items,
      obra, consorcios: consHook.data || [],
      company: titular,
      proveedor: prov.id || prov.nombre ? { id: prov.id, nombre: prov.nombre } : null,
      // El correlativo se pide contra TODAS las órdenes de la empresa, no
      // contra las de esta obra: la numeración es por empresa/tipo/año.
      ordenes,
      nuevoId: () => window.__newId(),
    });
    if (!b.ok) { toast(MOTIVO_NO_EMITE_LABEL[b.motivo] || 'No se puede emitir', 'amber'); return; }

    if (!window.confirm?.(
      `Se va a emitir ${b.orden.codigo} a nombre de ${titular?.name || titular?.legal_name || 'la ejecutora'}`
      + ` por ${soles(b.orden.monto_total)} (${b.items.length} línea(s)), a ${b.orden.proveedor_nombre}.\n\n`
      + 'El número queda tomado aunque después se anule. ¿Emitir?'
    )) return;

    emitirRef.current = true;
    setEmitiendo(requisicion.id);
    try {
      const now = new Date().toISOString();
      // `requisicion_items` y `oc_items` NO tienen `created_by`/`updated_by`
      // (mirá el esquema): mandarles esas columnas hace que el push las
      // rechace entero. Por eso el autor se marca solo en las cabeceras.
      const marca = (fila, tabla, { conAutor = false } = {}) => ({
        ...fila,
        created_at: now, updated_at: now,
        // Las columnas de autor son uuid: sin sesión van NULL, no el
        // literal 'offline' (que rebotaría con un 22P02).
        ...(conAutor ? { created_by: autorId, updated_by: autorId } : {}),
        version: 1, sync_status: 'pending_create', last_synced_at: null,
        idempotency_key: `${userId || 'anon'}_${tabla}_${fila.id}`,
      });
      await window.__db.ordenes_compra.add(marca(b.orden, 'oc', { conAutor: true }));
      for (const it of b.items) await window.__db.oc_items.add(marca(it, 'oc_item'));
      // El otro sentido del puente: sin esto el plan sigue proponiendo lo que
      // ya es un documento.
      const fresca = (await window.__db.requisiciones.get(requisicion.id)) || requisicion;
      await window.__db.requisiciones.update(requisicion.id, {
        ...cierreDeRequisicion(b.orden),
        updated_at: now, updated_by: autorId,
        version: (fresca.version ?? 0) + 1,
        sync_status: fresca.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      try {
        await window.__logAudit?.({
          action: 'create', table: 'ordenes_compra', recordId: b.orden.id,
          newData: { codigo: b.orden.codigo, monto_total: b.orden.monto_total, proveedor: b.orden.proveedor_nombre, requisicion_id: requisicion.id },
          reason: `Orden ${b.orden.codigo} emitida desde el plan del simulador (${b.items.length} líneas)`,
        });
      } catch {}
      for (const t of ['ordenes_compra', 'oc_items', 'requisiciones']) {
        try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: t } })); } catch {}
      }
      toast(`✓ ${b.orden.codigo} emitida por ${soles(b.orden.monto_total)}`, 'green');
    } catch (e) {
      console.warn('[simulador] error al emitir la orden', e);
      toast(`No se pudo emitir: ${e?.message || e}`, 'red');
    } finally {
      emitirRef.current = false;
      setEmitiendo(null);
    }
  };


  const cargando = obrasHook.loading || ipHook.loading || partidasHook.loading;
  const resumen = corrida?.resumen || null;
  const dec = decorado.resumen;
  // Solo los avisos del modo elegido (§15.2 F). Desde la 4.2 la Simulación
  // también resta lo comprado, así que también tiene avisos de compras; los
  // de lo ejecutado siguen siendo solo del modo real (el motor no los arma).
  const avisos = avisosDelPlan(resumen);
  const avisosAmbar = avisos.filter(a => a.nivel === 'ambar').length;

  if (!obraId) {
    return window.SinObraEmpty ? <window.SinObraEmpty icon="calendar" /> : <div className="card card-p">Elegí un trabajo.</div>;
  }

  const grupoCat = vistaCat ? porCategoria[vistaCat] : null;

  return (
    <div className="page-wrap">
      {/* ── ESCENARIO Y OBRA ───────────────────────────────────────── */}
      <div className="card card-p" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <select className="fi" style={{ maxWidth: 360 }} value={obraId} onChange={e => setObraId(e.target.value)}>
            {obras.map(o => <option key={o.id} value={o.id}>{o.nombre_obra || o.nombre}</option>)}
          </select>
          <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>Escenario:</span>
          <select className="fi" style={{ maxWidth: 260 }} value={escenario?.id || ''} onChange={e => elegirEscenario(e.target.value)}>
            {escenarios.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
          <button className="btn btn-sm btn-ghost" onClick={duplicarEscenario} title="Copiar este escenario con sus decisiones, para comparar otra combinación">
            <JxIcon name="copy" size={13} /> Guardar como…
          </button>
          <button className="btn btn-sm btn-ghost" onClick={renombrarEscenario}><JxIcon name="edit" size={13} /> Renombrar</button>
          <button className="btn btn-sm btn-ghost" onClick={eliminarEscenario}><JxIcon name="trash" size={13} /> Borrar</button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {/* Los avisos van a un botón (§15.2 F): antes eran tres tarjetas y
                hasta cuatro párrafos antes de la primera orden. */}
            {avisos.length > 0 && (
              <button className={`btn btn-sm ${verAvisos ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setVerAvisos(v => !v)}
                style={avisosAmbar > 0 && !verAvisos ? { color: 'var(--amber)', borderColor: 'var(--amber)' } : undefined}
                title="Lo que el plan no pudo saber o no pudo restar, según el modo elegido">
                {avisosAmbar > 0 ? '⚠' : 'ℹ'} Avisos ({avisos.length})
              </button>
            )}
            <button className="btn btn-sm btn-amber"
              onClick={() => { setRecalcN(n => n + 1); toast('Plan recalculado con lo último que hay cargado', 'green'); }}
              title="Vuelve a leer las órdenes, requisiciones y compras, y corre el plan de nuevo. Tus decisiones se conservan.">
              <JxIcon name="refresh" size={13} /> Nueva recomendación
            </button>
          </div>
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--tm)', margin: '10px 0 0' }}>
          {titular
            ? <>Las órdenes de este trabajo las emite <b>{titular.name || titular.legal_name}</b> — la entidad que lo ejecuta.</>
            : <>⚠ Este trabajo no tiene una ejecutora declarada. El plan se arma igual, pero la orden solo la puede emitir la ejecutora: cargala en Consorcios.</>}
          {' '}Lo que decidas acá <b>queda guardado en este navegador</b> hasta que lo conviertas en requisiciones,
          abajo: recién ahí viaja a la base y lo ve el resto del equipo.
        </p>
      </div>

      {/* ── LOS AVISOS DEL MODO ELEGIDO ─────────────────────────────── */}
      {verAvisos && avisos.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          {avisos.map((a, i) => (
            <div key={a.id} className="card-p" style={{
              display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
              borderLeft: `3px solid ${a.nivel === 'ambar' ? 'var(--amber)' : 'var(--blue)'}`,
              ...(i > 0 ? { borderTop: '1px solid var(--border)' } : {}),
            }}>
              <div style={{ flex: '1 1 320px', fontSize: 12 }}>
                <b>{a.titulo}</b>
                {a.detalle && <div style={{ color: 'var(--tm)', marginTop: 2 }}>{a.detalle}</div>}
              </div>
              {/* «Imputar lo ya comprado» es su propia sección desde la tanda
                  3.2 (doc §15.1 punto 6): otra pregunta, otra pantalla. */}
              {a.accion === 'imputar' && (
                <button className="btn btn-sm btn-amber" onClick={irAImputar}>
                  {a.boton || 'Imputar'} →
                </button>
              )}
              {a.accion === 'ajustes' && (
                <button className="btn btn-sm btn-ghost" onClick={() => setAjustes(true)}>
                  ⚙ {a.boton || 'Ajustes finos'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── CONFIGURACIÓN BÁSICA (§15.2 A y B) ──────────────────────── */}
      <div className="card card-p" style={{ marginBottom: 12, display: 'grid', gap: 12 }}>
        {/* El modo es la primera pregunta: separa la simulación de lo real. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {MODOS.map(m => (
            <button key={m} className={`btn ${params.modo === m ? 'btn-amber' : 'btn-ghost'}`}
              onClick={() => cambiarParam({ modo: m })}>
              {MODO_LABEL[m]}
            </button>
          ))}
          <span style={{ fontSize: 11.5, color: 'var(--tm)', flex: '1 1 280px' }}>
            {simulacion
              ? <>¿Cómo compraría esta obra? Sale del presupuesto y del cronograma desde el arranque elegido, y resta {COMPRADO_TEXTO[params.comprado] || COMPRADO_TEXTO.con_factura}{almacenModoActivo !== 'nada' ? ' y el almacén' : ''}: lo que ya se pidió de verdad no se vuelve a pedir.</>
              : <>¿Qué me falta pedir? Desde hoy: resta {COMPRADO_TEXTO[params.comprado] || COMPRADO_TEXTO.con_factura}, las requisiciones{almacenModoActivo !== 'nada' ? ' y el almacén' : ''}{params.restarAvance ? ', saca lo ya ejecutado' : ''}, y trae al mes actual lo que quedó atrasado.</>}
          </span>
          <button className={`btn btn-sm ${ajustes ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setAjustes(v => !v)}
            title="Anticipación, tramo largo, reparto, monto mínimo, frecuencia por rubro, qué cuenta como comprado, almacén y puntos de partida">
            ⚙ Ajustes finos
          </button>
        </div>

        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {simulacion && (
            <label style={{ display: 'block' }}>
              <span className="flabel">La obra arranca</span>
              <select className="fi" value={params.arranque} onChange={e => cambiarParam({ arranque: e.target.value })}>
                {ARRANQUES.map(a => <option key={a} value={a}>{ARRANQUE_LABEL[a]}</option>)}
              </select>
              {params.arranque === 'fecha' && (
                <input className="fi" type="date" style={{ marginTop: 4 }} value={params.arranqueFecha || ''}
                  onChange={e => cambiarParam({ arranqueFecha: e.target.value || null })} />
              )}
            </label>
          )}
          <label style={{ display: 'block' }}>
            <span className="flabel">De dónde salen las fechas</span>
            <select className="fi" value={params.cronograma} onChange={e => cambiarParam({ cronograma: e.target.value })}>
              {CRONOGRAMAS_PANTALLA.map(c => <option key={c} value={c}>{CRONOGRAMA_PANTALLA_LABEL[c]}</option>)}
            </select>
          </label>
          {params.cronograma === 'escenario' && (
            <label style={{ display: 'block' }}>
              <span className="flabel">La historia de la obra</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <select className="fi" style={{ flex: 1, minWidth: 0 }} value={params.historia}
                  onChange={e => cambiarParam({ historia: e.target.value, historiaAjustes: {} })}>
                  <option value={HISTORIA_AZAR}>
                    🎲 Al azar{historia?.azar ? ` (salió: ${historia.historia.etiqueta})` : ''}
                  </option>
                  {HISTORIAS.map(h => <option key={h.id} value={h.id}>{h.icono} {h.etiqueta}</option>)}
                </select>
                <button className="btn btn-sm btn-ghost" onClick={otraHistoria}
                  title={params.historia === HISTORIA_AZAR
                    ? 'Sortear otra historia (y otra intensidad)'
                    : 'La misma historia con otra intensidad: cuándo empieza, cuánto dura, a qué ritmo'}>
                  🎲 Otro
                </button>
              </div>
            </label>
          )}
          <label style={{ display: 'block' }}>
            <span className="flabel">Período</span>
            <select className="fi" value={params.granularidad} onChange={e => cambiarParam({ granularidad: e.target.value })}>
              {GRANULARIDADES.map(g => <option key={g} value={g}>{g === 'mes' ? 'Mes a mes' : 'Semana a semana'}</option>)}
            </select>
          </label>
          <label style={{ display: 'block' }}>
            <span className="flabel">Cada cuánto se emite una orden</span>
            <select className="fi" value={params.frecuencia} onChange={e => cambiarParam({ frecuencia: e.target.value })}>
              {FRECUENCIAS.map(f => <option key={f} value={f}>{FRECUENCIA_LABEL[f]}</option>)}
            </select>
          </label>
        </div>

        {simulacion && desplazado.activo && (
          <p style={{ fontSize: 11.5, color: 'var(--tm)', margin: 0 }}>
            El cronograma entero se corrió {Math.abs(desplazado.deltaDias)} día(s) {desplazado.deltaDias > 0 ? 'hacia adelante' : 'hacia atrás'}:
            {' '}arranca el <b>{desplazado.inicioNuevo}</b> en vez del {desplazado.inicioOriginal}. El plazo y el orden de las partidas no cambian.
          </p>
        )}
        {simulacion && !desplazado.activo && desplazado.motivo && (
          <p style={{ fontSize: 11.5, color: 'var(--amber)', margin: 0 }}>⚠ {MOTIVO_SIN_DESPLAZAR_LABEL[desplazado.motivo]}</p>
        )}

        <div>
          <span className="flabel">Qué se incluye</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {CATS_ORDENES.map(c => (
              <button key={c} className={`btn btn-sm ${params.categorias.includes(c) ? 'btn-amber' : 'btn-ghost'}`}
                onClick={() => toggleCategoria(c)}>
                {ICONO_CAT[c]} {CATEGORIA_SIMULADOR_LABEL[c]}
              </button>
            ))}
            <span style={{ fontSize: 11, color: 'var(--tm)', alignSelf: 'center', marginLeft: 6 }}>
              La mano de obra no se compra: va en su propia pestaña.
            </span>
          </div>
        </div>
      </div>

      {/* ── ⚙ AJUSTES FINOS (§15.2 B) ───────────────────────────────── */}
      {ajustes && (
        <div className="card card-p" style={{ marginBottom: 12, display: 'grid', gap: 12, borderLeft: '3px solid var(--border)' }}>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <label style={{ display: 'block' }}>
              <span className="flabel">Pedir con cuántos días de anticipación</span>
              <input className="fi" type="number" min="0" max="365" value={params.anticipacionDias}
                onChange={e => cambiarParam({ anticipacionDias: e.target.value })} />
            </label>
            <label style={{ display: 'block' }}>
              <span className="flabel">Un tramo es «largo» a partir de (días)</span>
              <input className="fi" type="number" min="1" value={params.umbralTramoLargoDias}
                onChange={e => cambiarParam({ umbralTramoLargoDias: e.target.value })} />
            </label>
            <label style={{ display: 'block' }}>
              <span className="flabel">Cómo se reparte un tramo largo</span>
              <select className="fi" value={params.reparto} onChange={e => cambiarParam({ reparto: e.target.value })}>
                {REPARTOS_PANTALLA.map(r => <option key={r} value={r}>{REPARTO_LABEL[r]}</option>)}
              </select>
              {cron.notas.includes('reparto_sin_cronograma') && (
                <span style={{ display: 'block', fontSize: 11, color: 'var(--amber)', marginTop: 4 }}>
                  ⚠ {NOTA_CRONOGRAMA_LABEL.reparto_sin_cronograma}
                </span>
              )}
            </label>
            <label style={{ display: 'block' }}
              title="Una orden por debajo de este monto se junta con la siguiente del mismo rubro, y se emite en la fecha de la primera: nada llega tarde. 0 = no se junta por monto.">
              <span className="flabel">Monto mínimo por orden (S/)</span>
              <input className="fi" type="number" min="0" step="100" value={params.montoMinimoOrden || ''} placeholder="0 = sin mínimo"
                onChange={e => cambiarParam({ montoMinimoOrden: e.target.value })} />
            </label>
          </div>

          {rubrosDelPlan.length > 0 && (
            <details>
              <summary style={{ fontSize: 12, cursor: 'pointer' }}>
                Frecuencia distinta por rubro
                {Object.keys(params.frecuenciaPorRubro || {}).length > 0 && (
                  <span style={{ color: 'var(--tm)' }}> · {Object.keys(params.frecuenciaPorRubro).length} con frecuencia propia</span>
                )}
              </summary>
              <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', marginTop: 8 }}>
                {rubrosDelPlan.map(r => (
                  <label key={r.rubro} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                    <span style={{ flex: 1 }}>{r.icono} {r.nombre}</span>
                    <select className="fi" style={{ maxWidth: 170, fontSize: 11.5, padding: '3px 6px' }}
                      value={params.frecuenciaPorRubro?.[r.rubro] || ''}
                      onChange={e => {
                        const nuevo = { ...(params.frecuenciaPorRubro || {}) };
                        if (e.target.value) nuevo[r.rubro] = e.target.value; else delete nuevo[r.rubro];
                        cambiarParam({ frecuenciaPorRubro: nuevo });
                      }}>
                      <option value="">Como el resto</option>
                      {FRECUENCIAS.map(f => <option key={f} value={f}>{FRECUENCIA_LABEL[f]}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </details>
          )}

          {/* ── QUÉ CUENTA COMO YA COMPRADO (tanda 4.2, §16.2) Y QUÉ RESTA EL
              ALMACÉN (tanda 2.5) — en los dos modos desde la 4.2. El almacén
              tiene una perilla por modo: en Simulación arranca en «nada». Solo
              resta lo IMPUTADO: lo que no dice a qué insumo corresponde no se
              resta a ojo. */}
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <label style={{ display: 'block' }}
                title="Qué órdenes que NO salieron de este plan se descuentan. El borrador no cuenta nunca; lo que salió de este plan cuenta siempre, tenga factura o no.">
                <span className="flabel">Qué cuenta como ya comprado</span>
                <select className="fi" value={params.comprado || 'con_factura'} onChange={e => cambiarParam({ comprado: e.target.value })}>
                  {COMPRADO_MODOS.map(m => <option key={m} value={m}>{COMPRADO_MODO_LABEL[m]}</option>)}
                </select>
              </label>
              <div style={{ fontSize: 11.5, color: 'var(--tm)', alignSelf: 'end' }}>
                {(params.comprado || 'con_factura') === 'con_factura'
                  ? 'Una orden emitida sin factura todavía se puede caer: no se descuenta hasta que llegue su comprobante.'
                  : 'Toda orden con número y no anulada se descuenta, llegue o no su factura.'}
                {' '}Los borradores no cuentan; lo que salió de este plan (requisiciones y órdenes emitidas desde acá) cuenta siempre.
                {resumen?.comprado && (resumen.comprado.sinFactura.ordenes > 0 || resumen.comprado.borradores.ordenes > 0) && (
                  <div style={{ marginTop: 2 }}>
                    {resumen.comprado.sinFactura.ordenes > 0 && <>Quedan afuera {resumen.comprado.sinFactura.ordenes} orden(es) emitida(s) sin factura ({solesK(resumen.comprado.sinFactura.monto)}). </>}
                    {resumen.comprado.borradores.ordenes > 0 && <>{resumen.comprado.borradores.ordenes} borrador(es) no cuentan ({solesK(resumen.comprado.borradores.monto)}).</>}
                  </div>
                )}
              </div>
              <label style={{ display: 'block' }}
                title="Lo que ya entró al almacén de la obra no se vuelve a pedir. Solo cuenta lo imputado a un insumo del presupuesto.">
                <span className="flabel">Del almacén, restar{simulacion ? ' (en Simulación)' : ''}</span>
                <select className="fi" value={almacenModoActivo} onChange={e => cambiarParam({ [claveAlmacenModo(params)]: e.target.value })}>
                  {ALMACEN_MODOS.map(m => <option key={m} value={m}>{ALMACEN_MODO_LABEL[m]}</option>)}
                </select>
              </label>
              <div style={{ fontSize: 11.5, color: 'var(--tm)', alignSelf: 'end' }}>
                {almacenModoActivo === 'entradas' && 'Lo que entró y ya se usó cubrió meses pasados: restarlo evita volver a pedirlo.'}
                {almacenModoActivo === 'stock' && <span style={{ color: 'var(--amber)' }}>⚠ Vuelve a pedir lo que ya se usó en obra: el plan mira la necesidad desde el inicio.</span>}
                {almacenModoActivo === 'nada' && (simulacion
                  ? 'En Simulación el almacén no resta por defecto: solo cuentan las órdenes y lo que ya salió del plan. Se elige aparte del modo real.'
                  : 'El almacén no resta: solo cuentan órdenes y requisiciones.')}
                {almacenModoActivo === 'personalizado' && (
                  <>Elegí insumo por insumo abajo. Lo que todavía no está imputado se agrega en <button className="btn btn-sm btn-ghost" style={{ padding: '0 6px' }} onClick={irAImputar}>Imputar lo ya comprado</button>.</>
                )}
              </div>
              {/* El picker vive ACÁ (del escenario) y no en «Imputar lo ya
                  comprado» (que ahora es otra página, sin escenario): qué
                  resta el almacén es una decisión del ESCENARIO, imputar una
                  fila no lo es. */}
              {almacenModoActivo === 'personalizado' && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <PersonalizadoAlmacen cubiertos={cubiertosAlmacen} porInsumo={params.almacenPorInsumo || {}} onParam={cambiarParam} />
                </div>
              )}
              {/* ── LO YA EJECUTADO (tanda 3.5) ─────────────────────────
                  Se prende a mano: el avance lo reporta el frente y puede
                  venir atrasado. Lo que ya entró al almacén y se usó en lo
                  ejecutado no se resta dos veces (`coberturaConAvance`).
                  Solo en modo real: el avance es de la obra de verdad, no de
                  una simulación que arranca en otra fecha. */}
              {!simulacion && (
                <>
                  <label style={{ display: 'block' }}
                    title="Saca del plan la parte de cada partida que ya se hizo, según su % de avance. Lo que entró al almacén y se usó en eso no se vuelve a restar.">
                    <span className="flabel">Lo ya ejecutado (avance de las partidas)</span>
                    <select className="fi" value={params.restarAvance ? 'si' : 'no'} onChange={e => cambiarParam({ restarAvance: e.target.value === 'si' })}>
                      <option value="no">No restar</option>
                      <option value="si">Restar lo ejecutado</option>
                    </select>
                  </label>
                  <div style={{ fontSize: 11.5, color: 'var(--tm)', alignSelf: 'end' }}>
                    {!resumen?.avance?.partidas
                      ? 'Ninguna partida de este trabajo tiene avance reportado todavía.'
                      : <>
                        {resumen.avance.partidas} partida(s) con avance · <b>{solesK(resumen.avance.monto)}</b> del presupuesto comprable ya ejecutado
                        {resumen.avance.adelantadas > 0 && <> · {resumen.avance.adelantadas} van adelantadas respecto del cronograma</>}.
                        {!params.restarAvance && ' Hoy el plan lo vuelve a pedir.'}
                      </>}
                  </div>
                </>
              )}
          </div>

          {/* ── PUNTOS DE PARTIDA (los tres enfoques de la 2.6) ──────────
              Son CONFIGURACIÓN —tres combinaciones de perillas—, no un
              resultado: por eso viven acá y no en una pestaña (§15.1 p. 6). */}
          <div>
            <span className="flabel">Puntos de partida</span>
            <EnfoquesVista
              enfoques={enfoques}
              params={params}
              onUsar={(overrides) => { cambiarParam(overrides); toast('Punto de partida aplicado: las perillas quedaron como las dejó', 'green'); }}
              recoIA={recoIA}
              pidiendoIA={pidiendoIA}
              onPedirIA={pedirRecomendacionIA}
            />
          </div>
        </div>
      )}

      {/* ── LA HISTORIA DEL ESCENARIO (tanda 3.3, §15.2 C) ──────────── */}
      {params.cronograma === 'escenario' && historia && (
        <HistoriaDelEscenario
          historia={historia}
          curva={curva}
          reparto={params.reparto}
          onRepartoEscenario={() => cambiarParam({ reparto: 'escenario' })}
          onOtra={otraHistoria}
          relatoIA={relatoIAVigente(escenario?.relatoIA, params) ? escenario.relatoIA : null}
          preocupacion={preocupacion}
          onPreocupacion={setPreocupacion}
          onPedirIA={pedirHistoriaIA}
          pidiendoIA={pidiendoHistoria}
          motivoIA={motivoHistoriaIA}
        />
      )}

      {/* ── LA COBERTURA, CONTRA EL COMPRABLE (§2) ──────────────────── */}
      {resumen && (
        <div className="card card-p" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--tm)' }}>Presupuesto comprable</div>
              <b style={{ fontSize: 16 }}>{solesK(resumen.montoComprable)}</b>
              <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                de {solesK(resumen.montoPresupuesto)} · {solesK(resumen.montoManoObra)} es planilla
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--tm)' }}>Planificado por el simulador</div>
              <b style={{ fontSize: 16 }}>{solesK(resumen.montoPlanificado)}</b>
              <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                {resumen.propuestas} órdenes · {resumen.sobres} sobres
                {resumen.ordenesSinConsolidar > resumen.propuestas && (
                  <span title="Una orden se emite una vez y se entrega por partes: los meses (o semanas) que junta van como entregas adentro.">
                    {' '}· juntadas de {resumen.ordenesSinConsolidar} entregas
                  </span>
                )}
              </div>
              {resumen.ordenesBajoMinimo > 0 && (
                <div style={{ fontSize: 10.5, color: 'var(--tm)' }}
                  title="Ni juntando todo lo de su rubro llegan al monto mínimo. Se proponen igual: la obra las necesita.">
                  {resumen.ordenesBajoMinimo} quedan por debajo del mínimo
                </div>
              )}
              {/* Plata por ENCIMA del expediente: se dice aparte y no cuenta
                  para la cobertura, o un colchón se leería como avance. */}
              {(resumen.montoRedondeo > 0.5 || resumen.montoColchon > 0.5) && (
                <div style={{ fontSize: 10.5, color: 'var(--tm)' }}
                  title="Se pide en unidades enteras de compra (tubos, bolsas, m³) y con el colchón que fijaste por insumo. Esa plata está por encima del expediente y no cuenta para la cobertura.">
                  incluye {resumen.montoRedondeo > 0.5 && <>+{solesK(resumen.montoRedondeo)} por pedir en enteros</>}
                  {resumen.montoRedondeo > 0.5 && resumen.montoColchon > 0.5 && ' · '}
                  {resumen.montoColchon > 0.5 && <>+{solesK(resumen.montoColchon)} de colchón ({resumen.insumosConColchon} insumo{resumen.insumosConColchon === 1 ? '' : 's'})</>}
                </div>
              )}
            </div>
            {resumen.avance?.activo && resumen.avance.monto > 0 && (
              <div title="La parte de cada partida que ya se hizo, según su % de avance. Sale del plan: no se vuelve a pedir.">
                <div style={{ fontSize: 11, color: 'var(--tm)' }}>Ya ejecutado (avance)</div>
                <b style={{ fontSize: 16 }}>{solesK(resumen.avance.monto)}</b>
                <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                  {resumen.avance.partidas} partida(s){resumen.avance.lineasCompletas > 0 && <> · {resumen.avance.lineasCompletas} línea(s) hechas enteras</>}
                </div>
              </div>
            )}
            <div>
              <div style={{ fontSize: 11, color: 'var(--tm)' }}>Aceptado en este escenario</div>
              <b style={{ fontSize: 16, color: dec.montoAceptadoTotal > 0 ? 'var(--green)' : 'var(--tm)' }}>
                {solesK(dec.montoAceptadoTotal)}
              </b>
              <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                {dec.lineasAceptadas} línea(s) · {dec.ordenesAceptadas + dec.ordenesParciales} orden(es)
              </div>
            </div>
            {dec.desvio !== 0 && (
              <div>
                <div style={{ fontSize: 11, color: 'var(--tm)' }}>Desvío sobre el expediente</div>
                <b style={{ fontSize: 16, color: dec.desvio > 0 ? 'var(--red)' : 'var(--green)' }}>
                  {dec.desvio > 0 ? '+' : ''}{solesK(dec.desvio)}
                </b>
                <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>{dec.lineasEditadas} línea(s) corregidas a mano</div>
              </div>
            )}
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--tm)' }}>
              <span>Cobertura del presupuesto comprable</span><span>{pct(resumen.cobertura)}</span>
            </div>
            <div style={{ marginTop: 4, height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
              <div style={{ width: `${Math.min(100, Math.round((resumen.montoComprable > 0 ? dec.montoAceptadoTotal / resumen.montoComprable : 0) * 100))}%`, background: 'var(--green)' }} />
              <div style={{ width: `${Math.max(0, Math.round(resumen.cobertura * 100) - Math.round((resumen.montoComprable > 0 ? dec.montoAceptadoTotal / resumen.montoComprable : 0) * 100))}%`, background: 'var(--amber)' }} />
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 4 }}>
              Verde = aceptado · ámbar = propuesto sin decidir. La barra va contra lo COMPRABLE, no contra el presupuesto
              total: la planilla no se cubre con órdenes.
            </div>
          </div>
        </div>
      )}

      {/* ── CIERRE DE MESES (tanda 4.3, §16.3) ───────────────────────── */}
      {!cargando && (mesACerrar || mesesCerrados.length > 0) && (
        <CierreMeses
          mesACerrar={mesACerrar}
          cerrados={mesesCerrados}
          cierres={escenario?.cierres || {}}
          cierre={resumen?.cierre || null}
          reparto={reprogramacionLabel(baseMotor.reparto)}
          onCerrar={cerrarElMes}
          onReabrir={reabrirElMes}
        />
      )}

      {/* ── PESTAÑAS (§15.2 F) ──────────────────────────────────────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {[
          ...catsIncluidas.map(c => [c, `${ICONO_CAT[c]} ${CATEGORIA_SIMULADOR_LABEL[c]} (${porCategoria[c].propuestas.length + porCategoria[c].sobres.length})`]),
          ['dotacion', '👷 Mano de obra (referencia)'],
          ['pendientes', `⚠ Sin planificar (${corrida?.pendientes.length || 0})`],
          ['documentos', `📄 Ya pedido (${yaEscrito.size})`],
        ].map(([id, lbl]) => (
          <button key={id} className={`btn btn-sm ${vistaActual === id ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setVista(id)}>{lbl}</button>
        ))}
      </div>

      {cargando && <div className="card card-p" style={{ textAlign: 'center', color: 'var(--tm)' }}>Cargando el presupuesto…</div>}

      {/* Los 577 proveedores, UNA sola vez para toda la pantalla. */}
      <datalist id={DATALIST_PROVEEDORES}>
        {candidatos.map(c => (
          <option key={c.id} value={c.nombre}>{c.grupo ? `empresa del grupo${c.rubro ? ` · ${rubroLabel(c.rubro)}` : ''}` : (c.ruc || 'proveedor')}</option>
        ))}
      </datalist>
      <ClasificacionDatalist id={DATALIST_CLASIFICACION} opciones={opcionesClasificacion} />

      {/* ═══ UNA CATEGORÍA: sus órdenes y sus sobres ═══════════════ */}
      {!cargando && grupoCat && (
        <>
          <div className="card card-p" style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <div style={{ fontSize: 12 }}>
              <b>{ICONO_CAT[vistaCat]} {CATEGORIA_SIMULADOR_LABEL[vistaCat]}</b>
              <span style={{ color: 'var(--tm)' }}>
                {' '}· {grupoCat.propuestas.length} orden(es) · {solesK(grupoCat.monto)}
                {grupoCat.aceptado > 0 && <span style={{ color: 'var(--green)' }}> · {solesK(grupoCat.aceptado)} aceptado</span>}
                {grupoCat.sobres.length > 0 && <> · {grupoCat.sobres.length} sobre(s)</>}
              </span>
            </div>
            <input className="fi" style={{ maxWidth: 260, marginLeft: 'auto' }} placeholder="Buscar insumo, código o título…" value={busca} onChange={e => setBusca(e.target.value)} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={soloPendientes} onChange={e => setSoloPendientes(e.target.checked)} />
              Solo lo que falta decidir ({grupoCat.pendientes})
            </label>
          </div>

          {vistaCat === 'herramientas' && stockPlan && (
            <StockAlmacenResumen stock={stockPlan} onImputar={irAImputar} />
          )}

          {porPeriodo.length > 1 && (
            <div className="jx-sticky-page-top" style={{
              // top:0, no var(--header-h): el que scrollea es .page-wrap y el
              // header queda AFUERA. Con 58 px quedaba una franja arriba de la
              // tira por donde pasaban las tarjetas por encima (24-set, captura
              // de Gabriel: «Acero y metalmecánica» montada sobre los chips).
              // El margen/padding negativo que la pega al TOPE real del
              // scrollport (y no al borde de adentro del padding) vive en
              // `.jx-sticky-page-top` (index.css) — ver su comentario: sin
              // eso quedaba un hueco de 24px por donde pasaban las tarjetas
              // (§16.1 #2 del plan, 25-set).
              position: 'sticky', top: 0, zIndex: 6, background: 'var(--bg-p)',
              marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border)',
            }}>
              <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingTop: 8 }}>
                {chipsPorMes.map(c => (
                  <div key={c.clave} style={{
                    display: 'flex', gap: 4, alignItems: 'flex-start', flexShrink: 0,
                    ...(c.semanas ? { border: '1px solid var(--border)', borderRadius: 8, padding: 4 } : {}),
                  }}>
                    <ChipPeriodo c={c} principal onClick={() => irAlPeriodo(c.semanas ? c.semanas[0].clave : c.clave)} />
                    {c.semanas?.map(s => <ChipPeriodo key={s.clave} c={s} chico onClick={() => irAlPeriodo(s.clave)} />)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {porPeriodo.length === 0 ? (
            <div className="card card-p" style={{ textAlign: 'center', color: 'var(--tm)', padding: 24 }}>
              {grupoCat.propuestas.length === 0
                ? ((corrida?.propuestas.length || 0) === 0
                  ? 'El motor no armó ninguna orden con estos parámetros. Mirá «Sin planificar» para ver por qué.'
                  : `No hay órdenes de ${CATEGORIA_SIMULADOR_LABEL[vistaCat].toLowerCase()} con estos parámetros.`)
                : 'Ninguna orden coincide con el filtro.'}
            </div>
          ) : porPeriodo.map(g => (
            <div key={g.periodo} id={`jx-sim-periodo-${g.periodo}`} style={{ marginBottom: 16, scrollMarginTop: 110 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <b style={{ fontSize: 14 }}>{g.etiqueta}</b>
                <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>
                  {g.propuestas.length} orden(es) · {solesK(g.monto)}
                  {g.aceptado > 0 && <span style={{ color: 'var(--green)' }}> · {solesK(g.aceptado)} aceptado</span>}
                </span>
                {/* Decidir el tramo toca SOLO las órdenes de esta pestaña: con
                    la lista entera, aceptar octubre en Materiales aceptaría
                    también las herramientas de octubre sin que se vean. */}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                  <button className="btn btn-sm btn-ghost" title="Aceptar todas las órdenes de este tramo en esta pestaña"
                    onClick={() => mutar(e => decidirPeriodo(e, g.periodo, 'aceptada', propuestasDeCat))}>
                    <JxIcon name="check" size={12} /> Aceptar el tramo
                  </button>
                  <button className="btn btn-sm btn-ghost"
                    onClick={() => mutar(e => decidirPeriodo(e, g.periodo, 'rechazada', propuestasDeCat))}>
                    <JxIcon name="x" size={12} /> Rechazar
                  </button>
                  <button className="btn btn-sm btn-ghost"
                    onClick={() => mutar(e => decidirPeriodo(e, g.periodo, 'pendiente', propuestasDeCat))}>
                    Limpiar
                  </button>
                </div>
              </div>

              {g.propuestas.map(p => (
                <PropuestaCard
                  key={p.id} p={p}
                  mezcla={catDe.get(p.id)?.mezcla || null}
                  abierta={abiertos.has(p.id)}
                  onToggle={() => toggleAbierto(p.id)}
                  // Se pasa la propuesta ENTERA y no su id: desde la 2.3 una
                  // orden puede juntar varios períodos y la decisión se guarda
                  // contra cada uno (sus `atomos`), para que reagrupar no la borre.
                  onDecidir={(d) => mutar(e => decidirPropuesta(e, p, d))}
                  onDecidirLinea={(l, d) => mutar(e => decidirLinea(e, p, l, d))}
                  onEditar={(l, patch) => mutar(e => editarLinea(e, p, l, patch))}
                  onLimpiar={(l) => mutar(e => limpiarEdicion(e, p, l))}
                  onCompra={cambiarCompra}
                  onProveedorOrden={(texto) => {
                    const prov = resolverProveedor(texto);
                    mutar(e => proveedorDePropuesta(e, p, p.lineas, prov));
                  }}
                  resolverProveedor={resolverProveedor}
                  yaEscrita={yaEscrito.get(p.id) || null}
                  sugeridos={sugerencias[p.id] || null}
                  stock={stockPlan?.porClave || null}
                  editando={editando} setEditando={setEditando}
                  tope={verMas[p.id] || LINEAS_POR_TANDA}
                  onVerMas={() => setVerMas(v => ({ ...v, [p.id]: (v[p.id] || LINEAS_POR_TANDA) + LINEAS_POR_TANDA }))}
                  onEnsenar={ensenarClasificacion}
                  listId={DATALIST_CLASIFICACION}
                  opciones={opcionesClasificacion}
                />
              ))}
            </div>
          ))}

          {/* Los sobres entran en el bloque de SU categoría (§15.2 E):
              «HERRAMIENTAS MANUALES» con las herramientas, el flete con los
              servicios. */}
          {grupoCat.sobres.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <b style={{ fontSize: 14, display: 'block', marginBottom: 6 }}>🧧 Sobres sin detalle ({grupoCat.sobres.length})</b>
              <SobresVista
                sobres={grupoCat.sobres}
                simulacion={simulacion}
                stockSobre={stockPlan?.sobreHerramientas ? { clave: stockPlan.sobreHerramientas, items: stockPlan.sueltas.herramientas } : null}
                resolverProveedor={resolverProveedor}
                onDecidir={(clave, d) => mutar(e => decidirSobre(e, clave, d))}
                onAgregar={(clave) => mutar(e => agregarLineaSobre(e, clave, { descripcion: '', unidad: 'und', cantidad: 1, precio: 0 }))}
                onEditar={(clave, id, patch) => mutar(e => editarLineaSobre(e, clave, id, patch))}
                onQuitar={(clave, id) => mutar(e => quitarLineaSobre(e, clave, id))}
                onProveedor={(clave, p) => mutar(e => proveedorDeSobre(e, clave, p))}
                onIrAPartida={irAInsumosDeSobre}
              />
            </div>
          )}
        </>
      )}

      {/* ═══ MANO DE OBRA ══════════════════════════════════════════ */}
      {!cargando && vistaActual === 'dotacion' && <DotacionVista d={dotacion} params={params} onParam={cambiarParam} />}

      {/* ═══ SIN PLANIFICAR ════════════════════════════════════════ */}
      {!cargando && vistaActual === 'pendientes' && <PendientesVista pendientes={corrida?.pendientes || []} />}

      {/* ═══ YA PEDIDO: lo que el plan escribió (tanda 4) ══════════ */}
      {!cargando && vistaActual === 'documentos' && (
        <DocumentosVista
          yaEscrito={yaEscrito}
          ordenes={ordenes}
          titular={titular}
          permiso={permiso}
          emitiendo={emitiendo}
          onEmitir={emitirOrden}
        />
      )}

      {/* ── EL PIE: qué pasa con lo aceptado ────────────────────────── */}
      <div className="card card-p" style={{ marginTop: 16, borderLeft: '3px solid var(--blue)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <div>
            <b>{entregable.lineas.length} línea(s) aceptadas</b>
            {' '}por <b>{soles(dec.montoAceptadoTotal)}</b>
            {entregable.sinPrecio.length > 0 && (
              <div style={{ fontSize: 11.5, color: 'var(--amber)' }}>
                ⚠ {entregable.sinPrecio.length} aceptada(s) sin precio: no se entregan hasta que alguien les ponga uno.
                Un monto inventado en una orden no lo vuelve a mirar nadie.
              </div>
            )}
            {dec.lineasSinProveedor > 0 && (
              <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>
                {dec.lineasSinProveedor} aceptada(s) todavía sin proveedor elegido.
              </div>
            )}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-ghost" onClick={exportarCsv}>
              <JxIcon name="download" size={13} /> Descargar el plan aceptado
            </button>
            <button className="btn btn-sm btn-amber"
              disabled={!entregable.lineas.length}
              title="Escribe lo aceptado como requisiciones. Todavía no es una orden: se puede editar y borrar."
              onClick={convertirEnRequisiciones}>
              <JxIcon name="check" size={13} /> Convertir en requisiciones
            </button>
          </div>
        </div>
        {/* Desde la 4.2 la Simulación también se convierte (§16.2, decisión
            2): ya resta lo comprado de verdad, así que no pide dos veces. Lo
            que sí conviene decir es qué NO está restando. */}
        {simulacion && almacenModoActivo === 'nada' && (
          <p style={{ fontSize: 11.5, color: 'var(--tm)', margin: '8px 0 0' }}>
            🧪 Estás en Simulación: se restan las órdenes ({(COMPRADO_MODO_LABEL[params.comprado] || COMPRADO_MODO_LABEL.con_factura).toLowerCase()}) y lo que ya salió
            de este plan, pero <b>no el almacén</b>. Si en la obra ya entró algo sin orden, se puede prender en ⚙ Ajustes finos.
          </p>
        )}
        <p style={{ fontSize: 11.5, color: 'var(--tm)', margin: '8px 0 0' }}>
          <b>Son dos pasos, y el primero se puede deshacer.</b> «Convertir en requisiciones» escribe el pedido en la
          base —ahí sí lo ve el resto del equipo y viaja entre computadoras—, pero todavía no es una orden: se edita,
          se borra y se vuelve a hacer. Emitir la orden se hace de a una desde <b>Ya pedido</b>, porque toma un número
          correlativo de {titular ? <b>{titular.name || titular.legal_name}</b> : 'la ejecutora'} que no se recupera
          aunque después se anule.
        </p>
        {!permiso.ok && permiso.motivo !== 'sin_obra' && (
          <p style={{ fontSize: 11.5, color: 'var(--amber)', margin: '6px 0 0' }}>
            ⚠ {MOTIVO_NO_EMITE_LABEL[permiso.motivo]} Las requisiciones se pueden escribir igual; la orden, no.
          </p>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// LOS AVISOS DEL PLAN (tanda 3.1, §15.2 F)
//
// Antes eran tarjetas grandes arriba de todo, y salían siempre — también
// cuando la pregunta era hipotética. Ahora son una lista detrás de un botón,
// y solo con los que aplican al modo. Desde la 4.2 la Simulación también
// resta lo comprado, así que tiene los mismos avisos de compras; los de lo
// ejecutado no salen porque el motor no mide avance en una simulación.
// ═══════════════════════════════════════════════════════════════════

// Cómo se nombra, dentro de una oración, lo que la perilla `comprado` resta.
const COMPRADO_TEXTO = {
  con_factura: 'las órdenes emitidas con factura',
  emitidas: 'las órdenes emitidas',
};

function avisosDelPlan(resumen) {
  if (!resumen) return [];
  const out = [];
  // ── Los meses cerrados (tanda 4.3) ──────────────────────────────
  const ci = resumen.cierre;
  if (ci?.sinMesAbierto?.lineas > 0) {
    out.push({
      id: 'sin-mes-abierto', nivel: 'ambar',
      titulo: `${ci.sinMesAbierto.lineas} línea(s) (${solesK(ci.sinMesAbierto.monto)}) quedaron en un mes cerrado sin ningún mes abierto después.`,
      detalle: 'No hay dónde reprogramarlas: están en «Sin planificar». Reabrí el último mes cerrado o extendé el plazo del trabajo.',
    });
  }
  if (ci?.reprogramado?.lineas > 0) {
    out.push({
      id: 'reprogramado', nivel: 'info',
      titulo: `Se reprogramaron ${solesK(ci.reprogramado.monto)} de ${Object.keys(ci.reprogramado.porMes).map(etiquetaPeriodo).join(', ')} a los meses que quedan.`,
      detalle: 'Es lo que no se pidió en los meses cerrados (rechazado, sin decidir o de una orden anulada). Las líneas que lo recibieron lo dicen y hay que volver a decidirlas.',
    });
  }
  // ── Lo que la perilla «qué cuenta como ya comprado» dejó afuera (4.2) ──
  const cp = resumen.comprado;
  if (cp?.sinFactura?.ordenes > 0) {
    out.push({
      id: 'sin-factura', nivel: 'info', accion: 'ajustes', boton: 'Qué cuenta como comprado',
      titulo: `${cp.sinFactura.ordenes} orden(es) emitida(s) sin factura (${solesK(cp.sinFactura.monto)}) no se descuentan.`,
      detalle: 'Así está elegido: hasta que llegue su comprobante, el plan la sigue proponiendo. Si ya es segura, en ⚙ Ajustes finos se puede contar toda orden emitida.',
    });
  }
  if (cp?.borradores?.ordenes > 0) {
    out.push({
      id: 'borradores', nivel: 'info',
      titulo: `${cp.borradores.ordenes} orden(es) en borrador (${solesK(cp.borradores.monto)}) no se descuentan.`,
      detalle: 'Un borrador todavía no es un pedido: cuenta cuando se emite (con número).',
    });
  }
  if (resumen.ocSinImputar?.lineas > 0) {
    out.push({
      id: 'oc', nivel: 'ambar', accion: 'imputar', boton: 'Imputarlas',
      titulo: `${resumen.ocSinImputar.lineas} línea(s) ya ordenadas (${solesK(resumen.ocSinImputar.monto)}) no se pudieron descontar.`,
      detalle: 'No tienen código de insumo: no hay contra qué línea del presupuesto restarlas, y el plan puede estar pidiendo de nuevo algo que ya se pidió.',
    });
  }
  if (resumen.almacen && resumen.almacen.modo !== 'nada' && resumen.almacen.sinImputar?.items > 0) {
    out.push({
      id: 'almacen', nivel: 'ambar', accion: 'imputar', boton: 'Imputar el almacén',
      titulo: `${resumen.almacen.sinImputar.items} ítem(s) del almacén con entradas todavía no se restan.`,
      detalle: `Hasta que cada ítem diga a qué insumo corresponde (y cuánto trae cada unidad), lo que entró no se descuenta.${resumen.almacen.itemsImputados > 0 ? ` Ya se restan ${resumen.almacen.itemsImputados} ítem(s) imputados.` : ''}`,
    });
  }
  if (resumen.reqSinImputar?.lineas > 0) {
    out.push({
      id: 'req', nivel: 'ambar',
      titulo: `${resumen.reqSinImputar.lineas} línea(s) ya requisadas (${solesK(resumen.reqSinImputar.monto)}) tampoco se pudieron descontar.`,
      detalle: 'Son requisiciones sin código de insumo —las cargadas a mano desde el frente—. Lo que escribe este simulador sí nace con código.',
    });
  }
  if (resumen.descontado?.insumos > 0) {
    out.push({
      id: 'descontado', nivel: 'info',
      titulo: `Ya se descontaron ${resumen.descontado.insumos} insumo(s) por ${solesK(resumen.descontado.monto)}.`,
      detalle: 'Están en órdenes, requisiciones o el almacén: eso no se vuelve a pedir.',
    });
  }
  if (resumen.fueraPresupuesto?.lineas > 0) {
    out.push({
      id: 'fuera', nivel: 'info',
      titulo: `${resumen.fueraPresupuesto.lineas} línea(s) de orden (${solesK(resumen.fueraPresupuesto.monto)}) están marcadas fuera del presupuesto.`,
      detalle: 'No restan nada, y está bien.',
    });
  }
  if (resumen.almacen?.ordenesCubiertas?.lineas > 0) {
    out.push({
      id: 'cubiertas', nivel: 'info',
      titulo: `${resumen.almacen.ordenesCubiertas.lineas} línea(s) de órdenes recibidas no se suman.`,
      detalle: 'Lo que llegó ya está en las entradas del almacén: sumar las dos contaría lo mismo dos veces.',
    });
  }
  // ── Lo ya ejecutado (tanda 3.5) ─────────────────────────────────
  const av = resumen.avance;
  if (av && !av.activo && av.partidas > 0 && av.monto > 0) {
    out.push({
      id: 'avance-sin-usar', nivel: 'info', accion: 'ajustes', boton: 'Restar lo ejecutado',
      titulo: `${av.partidas} partida(s) tienen avance reportado (${solesK(av.monto)} del comprable ya ejecutado) y el plan no lo resta.`,
      detalle: 'Si el avance está al día, prendé «Lo ya ejecutado» en ⚙ Ajustes finos: sale del plan, y lo que entró al almacén y se usó en eso no se descuenta dos veces.',
    });
  }
  if (av?.activo && av.monto > 0) {
    const partes = [
      av.lineasCompletas > 0 ? `${av.lineasCompletas} línea(s) estaban hechas enteras y no se piden` : '',
      av.adelantadas > 0 ? `${av.adelantadas} partida(s) van adelantadas y lo hecho sale de meses que todavía no llegaron` : '',
      av.absorbido?.monto > 0 ? `${solesK(av.absorbido.monto)} de lo ya comprado lo explica lo ejecutado y no se resta otra vez (${av.absorbido.insumos} insumo(s))` : '',
    ].filter(Boolean);
    out.push({
      id: 'avance', nivel: 'info',
      titulo: `Se sacó lo ya ejecutado de ${av.partidas} partida(s): ${solesK(av.monto)}.`,
      detalle: partes.length ? `${partes.join('. ')}.` : 'Sale de los meses más viejos de cada partida: lo que la obra hizo primero.',
    });
  }
  if (av?.activo && av.vencidasSinAvance?.partidas > 0) {
    out.push({
      id: 'vencidas-sin-avance', nivel: 'ambar',
      titulo: `${av.vencidasSinAvance.partidas} partida(s) que el cronograma ya da por terminadas no tienen avance reportado (${solesK(av.vencidasSinAvance.monto)}).`,
      detalle: 'Lo suyo se trae al mes actual como atrasado. Si ya se hicieron, lo que falta es reportar su avance; si no, está bien que se pidan.',
    });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// UN CHIP DE LA TIRA DE NAVEGACIÓN (tanda 2.4)
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// CIERRE DE MESES (tanda 4.3, §16.3)
//
// Una franja sola, arriba de las pestañas: qué meses están cerrados (con lo
// que se escribió al cerrarlos), cuál toca cerrar ahora, y reabrir el último.
// No va dentro de una pestaña porque cerrar un mes es sobre la corrida
// entera: materiales, herramientas y servicios a la vez.
// ═══════════════════════════════════════════════════════════════════

function CierreMeses({ mesACerrar, cerrados = [], cierres = {}, cierre = null, reparto, onCerrar, onReabrir }) {
  const ultimo = cerrados[cerrados.length - 1] || null;
  const reprog = cierre?.reprogramado;
  return (
    <div className="card card-p" style={{ marginBottom: 12, display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <b style={{ fontSize: 13 }}>🔒 Cierre de meses</b>
        {cerrados.map(m => {
          const c = cierres[m] || {};
          return (
            <span key={m} className="badge b-gray" style={{ fontSize: 11 }}
              title={`Cerrado el ${c.fecha || '—'}: ${c.requisiciones || 0} requisición(es), ${c.lineas || 0} línea(s) por ${soles(c.monto)}.`}>
              🔒 {etiquetaPeriodo(m)}{c.requisiciones ? ` · ${c.requisiciones} req.` : ''}
            </span>
          );
        })}
        {ultimo && (
          <button className="btn btn-sm btn-ghost" onClick={() => onReabrir(ultimo)}
            title="Solo se reabre el último mes cerrado: lo que se había reprogramado vuelve a ese mes.">
            Reabrir {etiquetaPeriodo(ultimo)}
          </button>
        )}
        {mesACerrar && (
          <button className="btn btn-sm btn-amber" style={{ marginLeft: 'auto' }} onClick={onCerrar}
            title="Escribe lo aceptado de las órdenes que se emiten ese mes como requisiciones, congela el mes y reprograma lo que no se pidió.">
            🔒 Cerrar {etiquetaPeriodo(mesACerrar)}
          </button>
        )}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>
        {mesACerrar
          ? <>Cerrar <b>{etiquetaPeriodo(mesACerrar)}</b> escribe lo aceptado de sus órdenes (todas las pestañas) como requisiciones
            y congela el mes. Lo rechazado, lo que quede sin decidir y lo de una orden que después se anule se reprograma {reparto}.
            Los meses se cierran en orden.</>
          : 'No quedan meses con órdenes por cerrar.'}
        {reprog?.lineas > 0 && (
          <> · Reprogramado de los meses cerrados: <b>{solesK(reprog.monto)}</b> en {reprog.lineas} línea(s).</>
        )}
      </div>
    </div>
  );
}

function ChipPeriodo({ c, onClick, chico, principal }) {
  const pctDecidido = c.ordenes > 0 ? Math.round((c.decididas / c.ordenes) * 100) : 0;
  const colorPct = pctDecidido === 100 ? 'var(--green)' : pctDecidido > 0 ? 'var(--blue)' : 'var(--tm)';
  const etiqueta = chico ? c.etiqueta.replace(/^semana (\d+) de \d{4}$/, 'sem. $1') : c.etiqueta;
  return (
    <button className="btn btn-sm btn-ghost" onClick={onClick}
      title={`${c.etiqueta} · ${solesK(c.monto)} · ${c.ordenes} orden(es) · ${pctDecidido}% decidido`}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, textAlign: 'left',
        padding: chico ? '3px 7px' : '5px 10px', fontSize: chico ? 10 : 11.5, lineHeight: 1.3,
        minWidth: chico ? 58 : 82,
      }}>
      <b style={{ fontWeight: principal ? 700 : 500 }}>{etiqueta}</b>
      <span style={{ color: 'var(--tm)' }}>{solesK(c.monto)} · {c.ordenes} ord.</span>
      <span style={{ color: colorPct }}>{pctDecidido}% decidido</span>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════
// UNA ORDEN PROPUESTA
// ═══════════════════════════════════════════════════════════════════

function PropuestaCard({ p, mezcla, abierta, onToggle, onDecidir, onDecidirLinea, onEditar, onLimpiar, onCompra, onProveedorOrden, resolverProveedor, yaEscrita, sugeridos, stock, editando, setEditando, tope, onVerMas, onEnsenar, listId, opciones }) {
  const visibles = abierta ? p.lineas.slice(0, tope) : [];
  // «Clasificar» por ORDEN (tanda 4.1, §16.1 #3): todos los nombres distintos
  // que el motor no reconoció, para enseñarlos de una sola vez con el mismo
  // código — es lo más común, porque una orden repite el mismo insumo en
  // varias entregas.
  const [clasifOrden, setClasifOrden] = uS(false);
  const nombresSinClasificar = onEnsenar
    ? [...new Set(p.lineas.filter(l => l.iupc?.codigo === 'sin_clasificar').map(l => l.nombre))]
    : [];
  // El proveedor de la orden es el que tienen TODAS sus líneas. Si hay más de
  // uno (porque alguien pisó una línea suelta) el campo queda vacío y se dice
  // abajo: mostrar uno de los dos haría creer que la orden va entera a él.
  const provsDistintos = [...new Set(p.lineas.map(l => l.proveedor_nombre || ''))];
  const provOrden = provsDistintos.length === 1 ? provsDistintos[0] : '';
  return (
    <div className="card" style={{ marginBottom: 8, borderLeft: `3px solid ${COLOR_DECISION[p.estado]}` }}>
      <div className="card-p" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', cursor: 'pointer' }} onClick={onToggle}>
        <JxIcon name={abierta ? 'chevD' : 'chevR'} size={14} />
        <div style={{ minWidth: 200 }}>
          <b>{p.rubroIcono ? `${p.rubroIcono} ` : ''}{p.titulo}</b>
          <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
            {p.lineas.length} línea(s)
            {/* Emitir no es entregar (tanda 2.3): la orden sale una vez, con
                la primera necesidad, y trae adentro cuándo va cada parte. */}
            {(p.periodos || []).length > 1 && (
              <span title={`Se emite en ${p.etiquetaPeriodo} y se entrega por partes: ${p.periodos.map(etiquetaCorta).join(', ')}`}>
                {' · '}se emite en {p.etiquetaPeriodo} · {p.periodos.length} entregas
              </span>
            )}
            {p.juntadaPorMonto && (
              <span title="Alguna de sus entregas, sola, no llegaba al monto mínimo por orden: se juntó con la del período siguiente (o con la anterior, si era la última del rubro).">
                {' · '}juntada por monto mínimo
              </span>
            )}
            {p.bajoMinimo && <span style={{ color: 'var(--amber)' }}> · por debajo del mínimo aun juntando todo su rubro</span>}
            {p.lineas.some(l => l.reprogramadaSinDecidir) && (
              <span style={{ color: 'var(--amber)' }}
                title="Recibió cantidad reprogramada de un mes cerrado. Esa cantidad es nueva y nace sin decidir: hasta que la línea se vuelva a decidir, no se entrega.">
                {' · '}{p.lineas.filter(l => l.reprogramadaSinDecidir).length} línea(s) con lo reprogramado por decidir
              </span>
            )}
            {p.lineas.some(l => l.decisionMixta && !l.reprogramadaSinDecidir) && (
              <span style={{ color: 'var(--amber)' }}
                title="Estas entregas se decidieron por separado cuando eran órdenes sueltas, y no dicen lo mismo. Hasta que se vuelvan a decidir no se entregan.">
                {' · '}{p.lineas.filter(l => l.decisionMixta && !l.reprogramadaSinDecidir).length} línea(s) con decisiones distintas por entrega
              </span>
            )}
            {p.lineas.some(l => (l.reprogramadoDe || []).length) && (
              <span title="Trae lo que quedó sin pedir en un mes cerrado (rechazado, sin decidir o de una orden anulada).">
                {' · '}incluye reprogramado de {[...new Set(p.lineas.flatMap(l => l.reprogramadoDe || []))].map(m => etiquetaPeriodo(m)).join(', ')}
              </span>
            )}
            {/* La orden va entera a la pestaña de lo que más pesa: si trae
                líneas de otra categoría, se dice (tanda 3.1). */}
            {mezcla && Object.keys(mezcla).length > 0 && (
              <span title="Se le emite a UN proveedor, así que no se parte entre pestañas: va a la categoría que más plata pesa adentro.">
                {' · incluye '}{Object.entries(mezcla).map(([c, n]) => `${n} de ${(CATEGORIA_SIMULADOR_LABEL[c] || c).toLowerCase()}`).join(', ')}
              </span>
            )}
            {p.lineas.some(l => l.tramoLargo) && ' · con tramo largo repartido'}
            {p.lineas.some(l => l.arrastrado) && ' · incluye atrasado arrastrado'}
            {p.tieneMontoIncompleto && ' · hay líneas sin precio'}
          </div>
          {/* Ya es un documento: la tarjeta lo dice antes de que alguien la
              vuelva a aceptar. Aceptar dos veces la misma propuesta es el
              doble pedido que el §7 viene a evitar. */}
          {yaEscrita && (
            <div style={{ fontSize: 10.5, color: yaEscrita.ordenada ? 'var(--green)' : 'var(--blue)', marginTop: 2 }}>
              {yaEscrita.ordenada
                ? `✓ Ya emitida como ${yaEscrita.requisicion.oc_codigo || 'orden'}`
                : `📄 Ya escrita como requisición · ${yaEscrita.items.length} línea(s) por ${soles(yaEscrita.monto)}`}
            </div>
          )}
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <b>{soles(p.montoEditado)}</b>
          {p.desvio !== 0 && (
            <div style={{ fontSize: 10.5, color: p.desvio > 0 ? 'var(--red)' : 'var(--green)' }}>
              {p.desvio > 0 ? '+' : ''}{soles(p.desvio)} vs. expediente
            </div>
          )}
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: COLOR_DECISION[p.estado], minWidth: 84, textAlign: 'right' }}>
          {ESTADO_LABEL[p.estado]}
          {p.estado === 'parcial' && <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--tm)' }}>{p.lineasAceptadas}/{p.lineas.length}</div>}
        </span>
        <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
          <button className={`btn btn-sm ${p.decision === 'aceptada' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => onDecidir('aceptada')} title="Aceptar la orden entera">
            <JxIcon name="check" size={12} />
          </button>
          <button className={`btn btn-sm ${p.decision === 'rechazada' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => onDecidir('rechazada')} title="Rechazar la orden entera">
            <JxIcon name="x" size={12} />
          </button>
          {nombresSinClasificar.length > 0 && (
            <button className={`btn btn-sm ${clasifOrden ? 'btn-amber' : 'btn-ghost'}`}
              title={`${nombresSinClasificar.length} nombre(s) sin clasificar en esta orden`}
              onClick={() => setClasifOrden(v => !v)}>
              Clasificar ({nombresSinClasificar.length})
            </button>
          )}
        </div>
      </div>

      {clasifOrden && (
        <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}
          onClick={e => e.stopPropagation()}>
          <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>
            Qué son los {nombresSinClasificar.length} nombre(s) sin clasificar de esta orden:
          </span>
          <SelectorClasificacion listId={listId} opciones={opciones} value="" permitirVacio
            placeholder="Elegí qué es…" style={{ fontSize: 12, padding: '3px 6px', maxWidth: 260 }}
            onChange={(cod) => { if (!cod) return; setClasifOrden(false); onEnsenar(nombresSinClasificar, cod); }} />
        </div>
      )}

      {abierta && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <div style={{ padding: '10px 12px', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>Proveedor de esta orden:</span>
            <input className="fi" list={DATALIST_PROVEEDORES} style={{ maxWidth: 300, fontSize: 12, padding: '4px 8px' }}
              placeholder={provsDistintos.length > 1 ? `${provsDistintos.filter(Boolean).length} proveedores distintos` : 'Buscá por nombre…'}
              defaultValue={provOrden} key={`${p.id}|${provOrden}`}
              onChange={e => onProveedorOrden(e.target.value)} />
            <span style={{ fontSize: 11, color: 'var(--tm)' }}>
              Se aplica a las {p.lineas.length} líneas. Una línea suelta se pisa desde su ✎.
            </span>
          </div>

          {/* ── A QUIÉN PEDIRLE (§6) ─────────────────────────────────
              La sugerencia sale de lo que cada proveedor FACTURÓ, no de un
              rubro declarado (lo traen 28 de 577 candidatos). Y no trae
              precio a propósito: el emparejamiento por palabras acierta el
              proveedor y erra el precio por órdenes de magnitud — ver el
              encabezado de `simulador-proveedor.js`. */}
          {sugeridos?.candidatos?.length > 0 && (
            <div style={{ padding: '0 12px 10px' }}>
              <div style={{ fontSize: 11, color: 'var(--tm)', marginBottom: 4 }}>
                Ya te vendieron cosas parecidas ({sugeridos.alcance.conCandidato} de {sugeridos.alcance.lineas} líneas tienen antecedente):
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {sugeridos.candidatos.map(c => (
                  <button key={c.clave} className="btn btn-sm btn-ghost"
                    style={{ fontSize: 11.5 }}
                    title={`${porQueEsteProveedor(c)}\n\n${c.ejemplos.map(e => `pedís «${e.pedido}» — te vendió «${e.vendio || '?'}»`).join('\n')}\n\nEl precio sigue siendo el del expediente: el historial dice a quién, no a cuánto.`}
                    onClick={() => onProveedorOrden(c.nombre)}>
                    {c.nombre}
                    <span style={{ color: 'var(--tm)', marginLeft: 6 }}>{c.lineasCubiertas} línea(s)</span>
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 4 }}>
                Sale de las facturas del grupo, no de un rubro declarado. <b>No trae precio</b>: el que aparece en la
                tabla es el del expediente, porque emparejar por nombre acierta el proveedor pero no el diámetro.
              </div>
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Insumo</th>
                <th style={{ textAlign: 'right', width: 130 }}>Cantidad a pedir</th>
                <th style={{ textAlign: 'right', width: 110 }}>Precio</th>
                <th style={{ textAlign: 'right', width: 120 }}>Monto</th>
                <th style={{ width: 170 }}>Proveedor</th>
                <th style={{ width: 110 }}>Decisión</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map(l => (
                <LineaFila
                  key={l.ref} l={l}
                  enEdicion={editando === l.ref}
                  onEdicion={(v) => setEditando(v ? l.ref : null)}
                  onDecidir={(d) => onDecidirLinea(l, d)}
                  onEditar={(patch) => onEditar(l, patch)}
                  onLimpiar={() => onLimpiar(l)}
                  onCompra={(patch) => onCompra?.(l.clave, patch)}
                  resolverProveedor={resolverProveedor}
                  stock={stock?.get(l.clave) || null}
                  onEnsenar={onEnsenar}
                  listId={listId}
                  opciones={opciones}
                />
              ))}
            </tbody>
          </table>
          </div>
          {p.lineas.length > visibles.length && (
            <div style={{ padding: 8, textAlign: 'center' }}>
              <button className="btn btn-sm btn-ghost" onClick={onVerMas}>
                Ver más ({p.lineas.length - visibles.length} restantes)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LineaFila({ l, enEdicion, onEdicion, onDecidir, onEditar, onLimpiar, onCompra, resolverProveedor, stock = null, onEnsenar, listId, opciones }) {
  const [clasificando, setClasificando] = uS(false);
  const sinClasificar = l.iupc?.codigo === 'sin_clasificar';
  // El clasificador SÍ reconoció el nombre, pero es una clasificación PROPIA
  // sin rubro asignado (§16.1 #3 — `rubroDeCompra` manda ahí a TODO lo
  // propio): no es «no sé qué es», es «no tiene a qué proveedor mandarla», y
  // eso no se arregla enseñando al diccionario sino poniéndole rubro en el
  // Catálogo, así que no ofrece el mismo botón «Clasificar».
  const rubroSinAsignar = !sinClasificar && !!l.iupc && l.rubro === 'sin_clasificar';
  const color = COLOR_DECISION[l.decision];
  const factor = num(l.factor) > 0 ? num(l.factor) : 1;
  const unidadExp = l.unidadExpediente || l.unidad;
  const equivale = r4ui(num(l.cantidad) * factor);
  // Lo que se pide de más por redondear a enteros (en unidades del
  // expediente). Solo tiene sentido contra la cantidad que propuso el motor:
  // si alguien la corrigió a mano, la diferencia ya no es redondeo.
  const redondeo = l.necesidad != null && num(l.cantidad) === num(l.cantidadOriginal)
    ? r4ui(num(l.cantidadOriginal) * factor - num(l.necesidad)) : 0;
  return (
    <>
    <tr style={{ opacity: l.decision === 'rechazada' ? 0.5 : 1 }}>
      <td className="col-p">
        {enEdicion ? (
          <input className="fi" style={{ fontSize: 12, padding: '3px 6px' }} value={l.nombre}
            onChange={e => onEditar({ nombre: e.target.value })} />
        ) : (
          <div style={{ fontWeight: 600, fontSize: 12.5 }}>{l.nombre}</div>
        )}
        <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
          {l.insumo_codigo || 'sin código'} · expediente en {unidadExp}
          {/* QUÉ ES, que es lo que explica por qué está en ESTA orden. Sin
              esto el rubro es una caja negra y una línea mal clasificada no
              se puede discutir: se ve rara y no se sabe por qué entró. */}
          {l.iupc && (
            <span style={{ color: sinClasificar || rubroSinAsignar ? 'var(--amber)' : 'var(--tm)' }}
              title={sinClasificar
                ? 'El clasificador no reconoció este nombre: por eso cayó en «Sin clasificar».'
                : rubroSinAsignar
                  ? 'Es una clasificación propia sin rubro de proveedor: por eso se agrupa como «Sin clasificar» al armar la orden. Se corrige poniéndole un código oficial en el Catálogo.'
                  : `Por esto entró en esta orden · ${Math.round((l.iupc.score || 0) * 100)}% de coincidencia`}>
              {' · '}{sinClasificar ? 'sin clasificar' : l.iupc.etiqueta}
              {rubroSinAsignar && ' (sin rubro de proveedor)'}
            </span>
          )}
          {sinClasificar && onEnsenar && !clasificando && (
            <button className="btn btn-sm btn-ghost" style={{ fontSize: 9.5, padding: '0 4px', marginLeft: 4 }}
              onClick={() => setClasificando(true)}>
              Clasificar
            </button>
          )}
          {l.tramoLargo && <span title="Viene de una partida de tramo largo: esta cantidad es la parte que toca a este período"> · repartido</span>}
          {l.arrastrado && (
            <span style={{ color: 'var(--amber)' }}
              title={`Venía de un período ya vencido y se arrastró acá${(l.arrastradoDe || []).length ? `. La decisión que tenía en ${(l.arrastradoDe || []).map(etiquetaPeriodo).join(', ')} se sigue respetando.` : ''}`}>
              {' · '}atrasado{(l.arrastradoDe || []).length ? ` de ${(l.arrastradoDe || []).map(etiquetaPeriodo).join(', ')}` : ''}
            </span>
          )}
          {(l.reprogramadoDe || []).length > 0 && (
            <span style={{ color: 'var(--blue)' }} title="Lo que quedó sin pedir en un mes cerrado, reprogramado acá según la estrategia de reparto del escenario. Monto del expediente, antes del redondeo.">
              {' · '}reprogramado de {(l.reprogramadoDe || []).map(etiquetaPeriodo).join(', ')} (≈ {solesK(l.montoReprogramado)})
            </span>
          )}
          {!l.montoConocido && <span style={{ color: 'var(--amber)' }}> · sin precio en el expediente</span>}
          {l.nombre !== l.nombreOriginal && <span style={{ color: 'var(--blue)' }}> · era «{l.nombreOriginal}»</span>}
        </div>
        {clasificando && (
          <div style={{ marginTop: 4, display: 'flex', gap: 4, alignItems: 'center' }}>
            <SelectorClasificacion listId={listId} opciones={opciones} value="" permitirVacio
              placeholder="Elegí qué es…" style={{ fontSize: 11, padding: '2px 6px', maxWidth: 220 }}
              onChange={(cod) => { setClasificando(false); if (cod) onEnsenar(l.nombre, cod); }} />
          </div>
        )}
        {stock && <StockDeLinea s={stock} />}
      </td>
      <td style={{ textAlign: 'right' }}>
        {enEdicion ? (
          <input className="fi" type="number" min="0" step="any" style={{ width: 92, padding: '3px 6px', fontSize: 12, textAlign: 'right' }}
            value={l.cantidad} onChange={e => onEditar({ cantidad: e.target.value })} />
        ) : <b>{cant(l.cantidad)}</b>}
        <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>{l.unidad}</div>
        {/* Contra qué se compara: lo pedido en la unidad del expediente, y
            cuánto hacía falta de verdad. Sin esto «28 tubos» no se puede
            revisar contra el presupuesto. */}
        {factor !== 1 && (
          <div style={{ fontSize: 10, color: 'var(--tm)' }}>= {cant(equivale)} {unidadExp}</div>
        )}
        {redondeo > 0.005 && (
          <div style={{ fontSize: 10, color: 'var(--tm)' }}
            title="Se pide en enteros de la unidad de compra. El redondeo es acumulado: lo que sobra este mes cubre el que sigue, así que el total de la obra nunca se pasa en más de una unidad.">
            hace falta {cant(l.necesidad)} {unidadExp}
          </div>
        )}
        {num(l.colchonPct) > 0 && (
          <div style={{ fontSize: 10, color: 'var(--blue)' }}>con {cant(l.colchonPct)}% de colchón</div>
        )}
        {/* Cuándo se entrega cada parte (tanda 2.3). Con la cantidad tocada a
            mano la tabla es la del plan y ya no suma lo pedido: se dice. */}
        {(l.entregas || []).length > 1 && (
          <div style={{ fontSize: 10, color: 'var(--tm)', textAlign: 'right' }}
            title={l.cantidadEditada ? 'Es el cronograma del plan: la cantidad se corrigió a mano y las entregas se coordinan aparte.' : 'Cuánto se entrega en cada período'}>
            {l.entregas.map(e => `${etiquetaCorta(e.periodo)} ${cant(e.cantidad)}`).join(' · ')}
            {l.cantidadEditada && <span style={{ color: 'var(--amber)' }}> (del plan)</span>}
          </div>
        )}
        {l.edicionOtroAgrupamiento && (
          <div style={{ fontSize: 10, color: 'var(--amber)' }}
            title="La cantidad se corrigió cuando esta línea tenía otras entregas (la orden se juntó o se separó después). No se aplica: el número ya no significa lo mismo.">
            tu cantidad era para otras entregas: volvé a corregirla
          </div>
        )}
        {l.etiquetaAlcanzaHasta && (
          <div style={{ fontSize: 10, color: 'var(--green)' }}
            title="Lo que se pide acá, redondeado, también cubre los meses siguientes: por eso ese insumo no aparece en sus órdenes.">
            alcanza hasta {l.etiquetaAlcanzaHasta}
          </div>
        )}
        {l.edicionOtraUnidad && (
          <div style={{ fontSize: 10, color: 'var(--amber)' }}
            title="La corrección de cantidad o precio se hizo en otra unidad y no se aplica: el número ya no significa lo mismo.">
            tu corrección era en {l.edicionOtraUnidad}: volvé a hacerla
          </div>
        )}
      </td>
      <td style={{ textAlign: 'right' }}>
        {enEdicion ? (
          <input className="fi" type="number" min="0" step="any" style={{ width: 92, padding: '3px 6px', fontSize: 12, textAlign: 'right' }}
            value={l.precio_unitario ?? ''} placeholder="sin precio"
            onChange={e => onEditar({ precio_unitario: e.target.value })} />
        ) : (l.precio_unitario == null ? <span style={{ color: 'var(--amber)' }}>—</span> : cant(l.precio_unitario))}
        {l.precioOriginal != null && l.precio_unitario !== l.precioOriginal && (
          <div style={{ fontSize: 10, color: 'var(--tm)' }}>expediente: {cant(l.precioOriginal)}</div>
        )}
      </td>
      <td style={{ textAlign: 'right', fontWeight: 600 }}>
        {l.montoConocido ? soles(l.monto) : <span style={{ color: 'var(--amber)' }} title="El expediente no trae precio para esta línea">sin monto</span>}
        {l.desvio !== 0 && l.montoConocido && (
          <div style={{ fontSize: 10, color: l.desvio > 0 ? 'var(--red)' : 'var(--green)' }}>
            {l.desvio > 0 ? '+' : ''}{soles(l.desvio)}
          </div>
        )}
      </td>
      <td style={{ fontSize: 11.5 }}>
        {enEdicion ? (
          <input className="fi" list={DATALIST_PROVEEDORES} style={{ fontSize: 11.5, padding: '3px 6px' }}
            placeholder="solo para esta línea" defaultValue={l.proveedor_nombre || ''}
            onChange={e => {
              const prov = resolverProveedor(e.target.value);
              onEditar({ proveedor_id: prov.id, proveedor_nombre: prov.nombre || null });
            }} />
        ) : (l.proveedor_nombre || <span style={{ color: 'var(--tm)' }}>— sin proveedor —</span>)}
      </td>
      <td>
        <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
          <button className={`btn btn-sm ${l.decision === 'aceptada' ? 'btn-amber' : 'btn-ghost'}`}
            style={{ padding: '2px 6px' }} title="Aceptar esta línea" onClick={() => onDecidir(l.decision === 'aceptada' ? 'pendiente' : 'aceptada')}>
            <JxIcon name="check" size={11} />
          </button>
          <button className={`btn btn-sm ${l.decision === 'rechazada' ? 'btn-amber' : 'btn-ghost'}`}
            style={{ padding: '2px 6px' }} title="Rechazar esta línea" onClick={() => onDecidir(l.decision === 'rechazada' ? 'pendiente' : 'rechazada')}>
            <JxIcon name="x" size={11} />
          </button>
          <button className={`btn btn-sm ${enEdicion ? 'btn-amber' : 'btn-ghost'}`} style={{ padding: '2px 6px' }}
            title="Corregir descripción, cantidad o precio" onClick={() => onEdicion(!enEdicion)}>
            <JxIcon name="edit" size={11} />
          </button>
          {l.editada && (
            <button className="btn btn-sm btn-ghost" style={{ padding: '2px 6px' }} title="Volver a los valores del expediente" onClick={onLimpiar}>
              <JxIcon name="refresh" size={11} />
            </button>
          )}
        </div>
        <div style={{ fontSize: 10, color: l.decisionMixta ? 'var(--amber)' : color, marginTop: 2 }}>
          {l.reprogramadaSinDecidir
            ? 'Lo reprogramado está sin decidir'
            : l.decisionMixta
            ? 'Decidida distinto por entrega'
            : <>{ESTADO_LABEL[l.decision]}{l.decisionHeredada && l.decision !== 'pendiente' ? ' (de la orden)' : ''}</>}
        </div>
      </td>
    </tr>
    {enEdicion && onCompra && (
      <tr>
        <td colSpan={6} style={{ background: 'var(--tint-neutral)' }}>
          <CompraEditor l={l} onCompra={onCompra} />
        </td>
      </tr>
    )}
    </>
  );
}

const r4ui = (n) => Math.round(num(n) * 10000) / 10000;

// «oct», «sem 41»: la tabla de entregas va en una línea, y «octubre 2026 ·
// noviembre 2026 · diciembre 2026» no entra en la columna de cantidad.
const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];
function etiquetaCorta(periodo) {
  const p = String(periodo || '');
  const sem = /^\d{4}-W(\d{2})$/.exec(p);
  if (sem) return `sem ${+sem[1]}`;
  const mes = /^\d{4}-(\d{2})$/.exec(p);
  if (mes) return MES_CORTO[+mes[1] - 1] || p;
  return p;
}

/**
 * Cómo se compra ESTE insumo (tanda 2.2): unidad de compra, lote y colchón.
 *
 * No es una corrección de la línea: vale para el insumo en todos los meses y
 * todos los escenarios de la obra, y así lo dice. La unidad y su factor se
 * aplican juntos con un botón —cambiar solo uno de los dos a medio escribir
 * recalcularía la obra entera con «1 tubo = 0 m»—; lote y colchón, al salir
 * del campo.
 *
 * El colchón arranca vacío (0%) y no se sugiere ningún valor: es decisión de
 * Gabriel, insumo por insumo (24-set-2026).
 */
function CompraEditor({ l, onCompra }) {
  const unidadExp = l.unidadExpediente || l.unidad;
  const [unidad, setUnidad] = React.useState(l.unidad || '');
  const [factor, setFactor] = React.useState(String(num(l.factor) > 0 ? l.factor : 1));
  React.useEffect(() => { setUnidad(l.unidad || ''); setFactor(String(num(l.factor) > 0 ? l.factor : 1)); }, [l.unidad, l.factor]);
  const factorValido = Number(factor) > 0;
  const cambiado = unidad.trim() !== String(l.unidad || '') || Number(factor) !== num(l.factor || 1);
  const campo = { className: 'fi', style: { width: 80, padding: '3px 6px', fontSize: 12 } };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', fontSize: 11.5, padding: '4px 2px' }}>
      <b style={{ fontSize: 11.5 }}>Cómo se compra este insumo</b>
      <span style={{ color: 'var(--tm)' }}>(vale para todos los meses y escenarios de esta obra)</span>
      <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        se pide por
        <input {...campo} style={{ ...campo.style, width: 130 }} value={unidad} onChange={e => setUnidad(e.target.value)} placeholder={unidadExp} />
        · 1 = <input {...campo} type="number" min="0" step="any" value={factor} onChange={e => setFactor(e.target.value)} /> {unidadExp}
        <button className="btn btn-sm btn-ghost" disabled={!factorValido || !cambiado}
          onClick={() => onCompra({ unidadCompra: unidad.trim() || unidadExp, factor: Number(factor) })}>Aplicar</button>
      </span>
      <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}
        title="Se pide de a esta cantidad (en la unidad de compra). Un mes que no llega se junta con el anterior.">
        de a
        <input {...campo} type="number" min="0" step="any" defaultValue={num(l.lote) > 0 ? l.lote : 1} key={`lote|${l.lote}`}
          onBlur={e => onCompra({ lote: Number(e.target.value) > 0 && Number(e.target.value) !== 1 ? Number(e.target.value) : null })} />
      </span>
      <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}
        title="Por robo, rotura o merma. 0% salvo que lo pongas vos. Esa plata se muestra aparte y no cuenta como presupuesto cubierto.">
        colchón
        <input {...campo} style={{ ...campo.style, width: 60 }} type="number" min="0" max="100" step="any" placeholder="0"
          defaultValue={num(l.colchonPct) > 0 ? l.colchonPct : ''} key={`colchon|${l.colchonPct}`}
          onBlur={e => onCompra({ colchonPct: Number(e.target.value) > 0 ? Number(e.target.value) : null })} /> %
      </span>
      <div style={{ flexBasis: '100%', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', color: 'var(--tm)', fontSize: 10.5 }}>
        <span>{l.compraOrigen === 'nombre' ? '📐 ' : ''}{l.compraMotivo}</span>
        {(l.compraOrigen === 'nombre' || num(l.factor) !== 1) && (
          <button className="btn btn-sm btn-ghost" style={{ fontSize: 10.5 }}
            onClick={() => onCompra({ unidadCompra: unidadExp, factor: 1 })}>
            Pedir en {unidadExp}
          </button>
        )}
        {(l.compraOrigen === 'manual' || num(l.lote) !== 1 || num(l.colchonPct) > 0) && (
          <button className="btn btn-sm btn-ghost" style={{ fontSize: 10.5 }}
            onClick={() => onCompra({ factor: null, lote: null, colchonPct: null })}>
            Quitar lo fijado a mano
          </button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SOBRES (§4.1): un techo de plata, no una lista de insumos
// ═══════════════════════════════════════════════════════════════════

/**
 * QUÉ ES el sobre, según la clasificación oficial (IUPC para insumos, S01-S13
 * para servicios). Es lo que deja mandar cada grupo al proveedor que
 * corresponde: el flete al transportista, la herramienta manual a la
 * ferretería, las publicaciones a la imprenta.
 *
 * Cuando el clasificador NO reconoce el nombre, el badge dice «sin clasificar»
 * en gris y sin porcentaje: sugerir «no sé» con un badge verde al lado es lo
 * mismo que no sugerir nada, y encima se lee como una respuesta.
 */
function BadgeIUPC({ iupc }) {
  const sinClasificar = iupc.codigo === 'sin_clasificar';
  const info = bandaConfianza(iupc.score);
  return (
    <div style={{ marginTop: 4 }}>
      <span className={`badge ${sinClasificar ? 'b-gray' : info.color}`}
        title={sinClasificar
          ? 'El clasificador no reconoció este nombre. Se resuelve en «Clasificación de insumos y servicios».'
          : `${info.label} (${Math.round(iupc.score * 100)}%) · agrupa por tipo de proveedor`}>
        {sinClasificar ? 'sin clasificar' : iupc.etiqueta}
      </span>
    </div>
  );
}

/**
 * LOS GRUPOS, que es para lo que sirve clasificar: los tres fletes juntos son
 * un pedido a un transportista, no tres decisiones sueltas. Sin agrupar, la
 * lista son doce nombres de expediente y hay que leerlos de a uno para darse
 * cuenta de que la mitad se le compra a la misma clase de proveedor.
 *
 * No lleva `uM`: son doce sobres y esta vista tiene un early return arriba
 * —un hook acá abajo rompería la regla de orden de hooks (React #310)—.
 */
function GruposIUPC({ sobres }) {
  const grupos = new Map();
  for (const s of sobres) {
    if (!s.iupc) continue;
    const g = grupos.get(s.iupc.codigo) || { etiqueta: s.iupc.etiqueta, codigo: s.iupc.codigo, n: 0, techo: 0 };
    g.n += 1;
    g.techo += Number(s.techo) || 0;
    grupos.set(s.iupc.codigo, g);
  }
  const lista = [...grupos.values()].sort((a, b) => b.techo - a.techo);
  if (lista.length < 2) return null;
  return (
    <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--tm)', marginBottom: 6 }}>
        Por lo que ES cada sobre — de acá salen los grupos que se le pueden pedir a un mismo proveedor:
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {lista.map(g => (
          <span key={g.codigo} className="badge b-gray" title={`${g.n} sobre(s) · ${soles(g.techo)}`}>
            {g.codigo === 'sin_clasificar' ? 'sin clasificar' : g.etiqueta} · {g.n} · {solesK(g.techo)}
          </span>
        ))}
      </div>
    </div>
  );
}

function SobresVista({ sobres, simulacion = false, stockSobre = null, resolverProveedor, onDecidir, onAgregar, onEditar, onQuitar, onProveedor, onIrAPartida }) {
  if (!sobres.length) {
    return (
      <div className="card card-p" style={{ textAlign: 'center', color: 'var(--tm)', padding: 24 }}>
        Este presupuesto no tiene partidas-sobre con estos parámetros.
      </div>
    );
  }
  return (
    <>
      <div className="card card-p" style={{ marginBottom: 12, borderLeft: '3px solid var(--blue)' }}>
        <b>Un sobre es un monto reservado sin decir qué se compra.</b>
        <p style={{ fontSize: 12, color: 'var(--tm)', margin: '6px 0 0' }}>
          «HERRAMIENTAS MANUALES» y los globales sueltos (movilización, tijeral) no traen lista de insumos: el
          expediente aparta una plata y después se compra contra ella, como una caja chica con tope. Acá se le escribe
          la orden a mano —3 combas, 5 picos— y la pantalla muestra cuánto del sobre queda.
        </p>
        <GruposIUPC sobres={sobres} />
      </div>
      {sobres.map(s => (
        <div key={s.clave} className="card" style={{ marginBottom: 10, borderLeft: `3px solid ${COLOR_DECISION[s.decision]}` }}>
          <div className="card-p" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <div style={{ minWidth: 220 }}>
              <b>{s.nombre}</b>
              <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                {s.unidad} · en {s.enPartidas} partida(s) · {SUBCATEGORIA_LABEL[s.subcategoria] || s.subcategoria}
              </div>
              {s.iupc && <BadgeIUPC iupc={s.iupc} />}
              {s.partidaIds?.length > 0 && (
                <button className="btn btn-sm btn-ghost" style={{ marginTop: 4, padding: '2px 6px', fontSize: 11 }}
                  onClick={() => onIrAPartida(s)}
                  title="Si es un insumo o mano de obra sin desglosar, corregilo desde ahí">
                  <JxIcon name="list" size={11} /> Corregir en Partidas
                </button>
              )}
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--tm)' }}>Techo del sobre</div>
              <b>{soles(s.techo)}</b>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--tm)' }}>Escrito acá</div>
              <b>{soles(s.usado)}</b>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--tm)' }}>Queda</div>
              <b style={{ color: s.excedido ? 'var(--red)' : 'var(--green)' }}>{soles(s.restante)}</b>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              <button className={`btn btn-sm ${s.decision === 'aceptada' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => onDecidir(s.clave, s.decision === 'aceptada' ? 'pendiente' : 'aceptada')}>
                <JxIcon name="check" size={12} /> Aceptar
              </button>
              <button className={`btn btn-sm ${s.decision === 'rechazada' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => onDecidir(s.clave, s.decision === 'rechazada' ? 'pendiente' : 'rechazada')}>
                <JxIcon name="x" size={12} />
              </button>
            </div>
          </div>

          {/* En Simulación la obra arranca de cero: el sobre está entero por
              definición, y el aviso de «nadie informó lo gastado» no aplica. */}
          {/* Tanda 3.5: con «lo ya ejecutado» prendido, lo gastado se estima
              con el avance de sus partidas cuando nadie informó más. Es un
              piso, no un dato: se dice. */}
          {s.consumoPorAvance && !simulacion && (
            <p style={{ fontSize: 11.5, color: 'var(--blue)', margin: '0 12px 10px' }}>
              ℹ Lo gastado ({soles(s.ejecutado)}) se estimó con el avance de sus partidas
              {s.consumido != null ? `: es más que lo informado por órdenes y requisiciones (${soles(s.consumido)})` : ': nadie informó compras contra este sobre'}.
              «Queda» se mide contra eso.
            </p>
          )}
          {stockSobre && stockSobre.clave === s.clave && stockSobre.items.length > 0 && (
            <StockDelSobre items={stockSobre.items} />
          )}
          {/* Desde la 4.2 la Simulación también recibe lo gastado de cada
              sobre: el aviso vale en los dos modos. */}
          {!s.techoFirme && (
            <p style={{ fontSize: 11.5, color: 'var(--amber)', margin: '0 12px 10px' }}>
              ⚠ Nadie informó todavía cuánto de este sobre ya se gastó, así que «queda» se calcula contra el techo
              entero. Creerlo intacto cuando ya se usó la mitad es exactamente el doble gasto que hay que evitar.
            </p>
          )}
          {s.excedido && (
            <p style={{ fontSize: 11.5, color: 'var(--red)', margin: '0 12px 10px' }}>
              ⚠ Lo escrito se pasa del techo del sobre. No se bloquea —el expediente puede quedarse corto— pero queda dicho.
            </p>
          )}

          <div style={{ padding: '0 12px 12px' }}>
            {s.lineas.length > 0 && (
              <table className="tbl" style={{ marginBottom: 8 }}>
                <thead>
                  <tr>
                    <th>Qué se compra</th>
                    <th style={{ width: 80 }}>Unidad</th>
                    <th style={{ width: 90, textAlign: 'right' }}>Cantidad</th>
                    <th style={{ width: 100, textAlign: 'right' }}>Precio</th>
                    <th style={{ width: 110, textAlign: 'right' }}>Monto</th>
                    <th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {s.lineas.map(l => (
                    <tr key={l.id}>
                      <td><input className="fi" style={{ fontSize: 12, padding: '3px 6px' }} placeholder="ej. 3 combas de 4 lb"
                        value={l.descripcion} onChange={e => onEditar(s.clave, l.id, { descripcion: e.target.value })} /></td>
                      <td><input className="fi" style={{ fontSize: 12, padding: '3px 6px' }} value={l.unidad}
                        onChange={e => onEditar(s.clave, l.id, { unidad: e.target.value })} /></td>
                      <td><input className="fi" type="number" min="0" step="any" style={{ fontSize: 12, padding: '3px 6px', textAlign: 'right' }}
                        value={l.cantidad} onChange={e => onEditar(s.clave, l.id, { cantidad: e.target.value })} /></td>
                      <td><input className="fi" type="number" min="0" step="any" style={{ fontSize: 12, padding: '3px 6px', textAlign: 'right' }}
                        value={l.precio} onChange={e => onEditar(s.clave, l.id, { precio: e.target.value })} /></td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{soles(l.monto)}</td>
                      <td>
                        <button className="btn btn-sm btn-ghost" style={{ padding: '2px 6px' }} onClick={() => onQuitar(s.clave, l.id)}>
                          <JxIcon name="trash" size={11} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <button className="btn btn-sm btn-ghost" onClick={() => onAgregar(s.clave)}>
                <JxIcon name="plus" size={12} /> Agregar una línea
              </button>
              <input className="fi" list={DATALIST_PROVEEDORES} style={{ maxWidth: 280, fontSize: 11.5, padding: '3px 6px' }}
                placeholder="Proveedor del sobre…" defaultValue={s.proveedor_nombre || ''}
                onChange={e => onProveedor(s.clave, resolverProveedor(e.target.value))} />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
// LO QUE YA HAY EN EL ALMACÉN (tanda 3.5, §15.2 E)
//
// Tres niveles: debajo de cada línea de herramienta o EPP, en el sobre de
// herramientas (lo que no tiene línea propia) y un resumen arriba de la
// pestaña. NADA de esto resta: resta lo imputado, y eso ya lo hizo el motor.
// ═══════════════════════════════════════════════════════════════════

const TOPE_ITEMS_STOCK = 4;
const itemStock = (i) => `${i.nombre} (${cant(i.stock)}${i.unidad ? ` ${String(i.unidad).trim().toLowerCase()}` : ''})`;

/** Debajo de una línea: lo imputado (ya restado) y lo parecido (sin restar). */
function StockDeLinea({ s }) {
  const imp = s.imputados.filter(i => num(i.stock) > 0);
  if (!imp.length && !s.parecidos.length) return null;
  const lista = (arr) => {
    const vis = arr.slice(0, TOPE_ITEMS_STOCK).map(itemStock).join(', ');
    return arr.length > TOPE_ITEMS_STOCK ? `${vis} y ${arr.length - TOPE_ITEMS_STOCK} más` : vis;
  };
  return (
    <div style={{ fontSize: 10.5, marginTop: 2 }}>
      {imp.length > 0 && (
        <div style={{ color: 'var(--green)' }}
          title="Estos ítems del almacén están imputados a este insumo: el plan los resta según lo que diga «Del almacén, restar» en ⚙ (con «Nada», no).">
          🏬 En el almacén: {lista(imp)} · imputado: lo resta «Del almacén, restar»
        </div>
      )}
      {s.parecidos.length > 0 && (
        <div style={{ color: 'var(--blue)' }}
          title={`Se parecen por nombre y no están imputados, así que el plan NO los resta.\n${s.parecidos.map(i => `${itemStock(i)} · ${Math.round(num(i.score) * 100)}%`).join('\n')}\n\nSi son lo mismo, imputalos en «Imputar lo ya comprado» (Logística) o rechazá la línea.`}>
          🏬 Parecido en el almacén: {lista(s.parecidos)} · sin imputar, no se restó
        </div>
      )}
    </div>
  );
}

/** Arriba de la pestaña de herramientas y EPPs, en modo real. */
function StockAlmacenResumen({ stock, onImputar }) {
  const r = stock.resumen;
  if (!r.conStock && !r.imputados) return null;
  const epps = stock.sueltas.epps;
  return (
    <div className="card card-p" style={{ marginBottom: 12, borderLeft: '3px solid var(--blue)', fontSize: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <b>🏬 Lo que ya hay en el almacén de la obra</b>
        <span style={{ color: 'var(--tm)' }}>
          {r.conStock} herramienta(s) y EPP(s) con stock
          {r.lineasConStock > 0 && <> · {r.lineasConStock} línea(s) del plan tienen algo igual o parecido (se ve debajo de cada una)</>}
          {stock.sueltas.herramientas.length > 0 && stock.sobreHerramientas && <> · {stock.sueltas.herramientas.length} herramienta(s) sin línea propia, en el sobre de herramientas</>}
        </span>
        <button className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }} onClick={onImputar}>Imputar el almacén →</button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 4 }}>
        Es una comparación, no un descuento: el plan solo resta lo IMPUTADO a un insumo. Lo parecido por nombre se muestra
        para que decidas si rechazar la línea o imputarlo.
      </div>
      {epps.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ cursor: 'pointer', fontSize: 11.5 }}>{epps.length} EPP(s) con stock que no se parecen a ninguna línea del plan</summary>
          <div style={{ fontSize: 11.5, color: 'var(--tm)', marginTop: 4 }}>{epps.map(itemStock).join(' · ')}</div>
        </details>
      )}
    </div>
  );
}

/** Dentro del sobre de herramientas: lo que ya está en obra y no tiene línea propia. */
function StockDelSobre({ items }) {
  const vis = items.slice(0, 12);
  return (
    <div style={{ fontSize: 11.5, margin: '0 12px 10px', color: 'var(--tm)' }}
      title="Herramientas del almacén con stock que no son una línea del presupuesto: salen de este sobre. No tienen precio en el almacén, así que no se descuentan del techo.">
      🏬 <b style={{ color: 'var(--tp)' }}>En el almacén ya hay:</b> {vis.map(itemStock).join(' · ')}
      {items.length > vis.length && (
        <details style={{ display: 'inline' }}>
          <summary style={{ display: 'inline', cursor: 'pointer' }}> · y {items.length - vis.length} más</summary>
          {' '}{items.slice(vis.length).map(itemStock).join(' · ')}
        </details>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MANO DE OBRA: los dos sentidos, SOLO como referencia (§5)
// ═══════════════════════════════════════════════════════════════════

function DotacionVista({ d, params, onParam }) {
  const plan = uM(() => (d ? planDeContratacion(d) : []), [d]);
  // La foto que contesta «¿cuánta gente hay que tener?» sin mirar el padrón.
  // Va en un uM antes del early return (regla de hooks: React #310).
  const cuantaGente = uM(() => {
    const ps = (d?.periodos || []).filter(p => num(p.personasNecesarias) > 0);
    if (!ps.length) return { pico: { personas: 0, etiqueta: '' }, promedio: 0, conDemanda: 0 };
    const top = ps.reduce((a, b) => (num(b.personasNecesarias) > num(a.personasNecesarias) ? b : a));
    const suma = ps.reduce((s, p) => s + num(p.personasNecesarias), 0);
    return {
      pico: { personas: Math.ceil(num(top.personasNecesarias)), etiqueta: top.etiquetaPeriodo },
      promedio: Math.round(suma / ps.length),
      conDemanda: ps.length,
    };
  }, [d]);
  if (!d) return <div className="card card-p" style={{ textAlign: 'center', color: 'var(--tm)' }}>Calculando…</div>;

  const pico = cuantaGente.pico;
  const promedioPersonas = cuantaGente.promedio;
  const periodosConDemanda = cuantaGente.conDemanda;
  const esSemanal = d.resumen?.granularidad === 'semana';

  const { resumen, periodos, cargos, padron, sinCargo } = d;
  return (
    <>
      <div className="card card-p" style={{ marginBottom: 12, borderLeft: '3px solid var(--blue)' }}>
        <b>Esto NO genera ningún registro.</b>
        <p style={{ fontSize: 12, color: 'var(--tm)', margin: '6px 0 0' }}>
          No da de alta a nadie, no le pide gente a RRHH y no emite ninguna orden: es el número de referencia para
          comparar lo que pide el cronograma contra la gente que hay. La oferta sale del <b>padrón</b> (cuánta gente
          está cargada), no de horas realmente trabajadas — la asistencia todavía no tiene filas contra las cuales medir.
        </p>
      </div>

      <div className="card card-p" style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
        <label style={{ fontSize: 12 }}>
          <span className="flabel">Horas por día</span>
          <input className="fi" type="number" min="1" max="24" style={{ width: 80 }}
            value={params.jornada.horasPorDia}
            onChange={e => onParam({ jornada: { ...params.jornada, horasPorDia: e.target.value } })} />
        </label>
        <label style={{ fontSize: 12 }}>
          <span className="flabel">Rendimiento efectivo</span>
          <input className="fi" type="number" min="0.1" max="1" step="0.05" style={{ width: 80 }}
            value={params.jornada.factorEfectivo}
            onChange={e => onParam({ jornada: { ...params.jornada, factorEfectivo: e.target.value } })} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={params.contarSubcontratos}
            onChange={e => onParam({ contarSubcontratos: e.target.checked })} />
          Contar al personal de subcontrato
        </label>
        <span style={{ fontSize: 11, color: 'var(--tm)' }}>
          La capacidad se cuenta por días laborables reales de cada mes (lun-sáb), no con un «208 h/mes» fijo.
        </span>
      </div>

      {/* PRIMERO LA SIMULACIÓN, DESPUÉS LA COMPARACIÓN (22-set). Antes esta
          pestaña abría con «cobertura 10%» contra el padrón, que es lo que
          la simulación NO es: Gabriel pidió «que quede como simulador — acá
          no sale cuánta gente se estima contratar en el mes, ni el monto».
          El padrón sigue estando, una fila más abajo y dicho como lo que es:
          un contraste con la obra real, no el resultado. */}
      <div className="card card-p" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--tm)' }}>Costo de la planilla en el plan</div>
            <b style={{ fontSize: 16 }}>{solesK(resumen.montoTotalManoObra)}</b>
            <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>{cant(resumen.hhTotalManoObra)} HH del expediente</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--tm)' }}>Pico de gente que pide el plan</div>
            <b style={{ fontSize: 16 }}>{pico.personas || '—'}</b>
            <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
              {pico.etiqueta ? `en ${pico.etiqueta}` : 'sin período con demanda'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--tm)' }}>Promedio por {esSemanal ? 'semana' : 'mes'}</div>
            <b style={{ fontSize: 16 }}>{promedioPersonas || '—'}</b>
            <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>{periodosConDemanda} período(s) con trabajo</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--tm)' }}>HH que pide el cronograma</div>
            <b style={{ fontSize: 16 }}>{cant(resumen.hhRequeridas)}</b>
          </div>
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--tm)', margin: '10px 0 0' }}>
          Esto es <b>lo que el expediente pide</b>, período por período, con la jornada de arriba. Es la simulación:
          todavía no se compara con nadie.
        </p>
      </div>

      <div className="card card-p" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11.5, color: 'var(--tm)', marginBottom: 8 }}>
          Y recién acá, el contraste con la obra real:
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
          <div><div style={{ fontSize: 11, color: 'var(--tm)' }}>HH que rinde el padrón</div><b>{cant(resumen.hhDisponibles)}</b></div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--tm)' }}>Cobertura</div>
            <b style={{ color: resumen.cobertura >= 0.95 ? 'var(--green)' : 'var(--red)' }}>{pct(resumen.cobertura)}</b>
          </div>
          <div><div style={{ fontSize: 11, color: 'var(--tm)' }}>Personas en el padrón</div><b>{padron.total}</b></div>
        </div>
      </div>

      {plan.length > 0 && (
        <div className="card card-p" style={{ marginBottom: 12, borderLeft: '3px solid var(--red)' }}>
          <b>Falta gente para cumplir el cronograma.</b>
          <p style={{ fontSize: 11.5, color: 'var(--tm)', margin: '4px 0 8px' }}>
            En orden de urgencia. No es un semáforo: en Miraflores la brecha es de un orden de magnitud, no de ajuste fino.
          </p>
          <table className="tbl">
            <thead><tr><th>Período</th><th>Cargo</th><th style={{ textAlign: 'right' }}>Hay</th><th style={{ textAlign: 'right' }}>Faltan</th><th>Buscar desde</th></tr></thead>
            <tbody>
              {plan.slice(0, 40).map((r, i) => (
                <tr key={`${r.periodo}-${r.cargo}-${i}`}>
                  <td>{r.etiquetaPeriodo}</td>
                  <td>{r.label}</td>
                  <td style={{ textAlign: 'right' }}>{r.hayHoy}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--red)' }}>{r.faltan}</td>
                  <td style={{ fontSize: 11.5, color: 'var(--tm)' }}>{r.avisarDesde || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ marginBottom: 12, overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Período</th><th style={{ textAlign: 'right' }}>Días útiles</th>
              <th style={{ textAlign: 'right' }}>HH pedidas</th><th style={{ textAlign: 'right' }}>Gente necesaria</th>
              <th style={{ textAlign: 'right' }}>Gente disponible</th><th style={{ textAlign: 'right' }}>Brecha</th>
              <th>Qué alcanza</th>
            </tr>
          </thead>
          <tbody>
            {periodos.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20, color: 'var(--tm)' }}>
                El presupuesto no tiene mano de obra fechada con estos parámetros.
              </td></tr>
            ) : periodos.map(p => (
              <tr key={p.periodo}>
                <td className="col-p">
                  <b>{p.etiquetaPeriodo}</b>
                  {p.periodoParcial && <div style={{ fontSize: 10, color: 'var(--tm)' }}>parcial: cuenta desde hoy</div>}
                </td>
                <td style={{ textAlign: 'right' }}>{p.diasLaborables}</td>
                <td style={{ textAlign: 'right' }}>{cant(p.hhRequeridas)}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{cant(p.personasNecesarias)}</td>
                <td style={{ textAlign: 'right' }}>{p.personasDisponibles}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: p.brechaPersonas > 0 ? 'var(--red)' : 'var(--green)' }}>
                  {p.brechaPersonas > 0 ? `faltan ${Math.ceil(p.brechaPersonas)}` : 'cubierto'}
                </td>
                <td style={{ fontSize: 11.5 }}>
                  {p.alcanceDisponible
                    ? <>{p.resumenAlcance.completas} completas · {p.resumenAlcance.parciales} a medias · {p.resumenAlcance.sinGente} sin gente</>
                    : <span style={{ color: 'var(--tm)' }}>sin detalle por partida</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cargos.length > 0 && (
        <div className="card" style={{ marginBottom: 12, overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>Cargo</th><th style={{ textAlign: 'right' }}>HH del presupuesto</th><th style={{ textAlign: 'right' }}>Monto</th><th style={{ textAlign: 'right' }}>En el padrón</th><th style={{ textAlign: 'right' }}>Peor brecha</th></tr></thead>
            <tbody>
              {cargos.map(c => (
                <tr key={c.cargo}>
                  <td className="col-p">{c.label}</td>
                  <td style={{ textAlign: 'right' }}>{cant(c.hhRequeridas)}</td>
                  <td style={{ textAlign: 'right' }}>{solesK(c.monto)}</td>
                  <td style={{ textAlign: 'right', color: c.enPadron === 0 ? 'var(--red)' : undefined }}>
                    {c.enPadron === 0 ? 'nadie' : c.enPadron}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {c.maxBrechaPersonas > 0
                      ? <span style={{ color: 'var(--red)' }}>faltan {Math.ceil(c.maxBrechaPersonas)} en {c.maxBrechaPeriodo}</span>
                      : <span style={{ color: 'var(--green)' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(padron.sinEncajar.length > 0 || sinCargo.length > 0 || padron.sinFechaIngreso > 0) && (
        <div className="card card-p" style={{ borderLeft: '3px solid var(--amber)' }}>
          <b>Lo que quedó afuera de la cuenta, y por qué.</b>
          <ul style={{ fontSize: 12, color: 'var(--tm)', margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
            {padron.resumenSinEncajar.map(r => (
              <li key={r.motivo}><b>{r.personas}</b> persona(s): {r.label}.</li>
            ))}
            {padron.sinFechaIngreso > 0 && (
              <li><b>{padron.sinFechaIngreso}</b> sin fecha de ingreso cargada. Cuentan igual —están activas hoy—
                pero no se les puede decir desde cuándo.</li>
            )}
            {sinCargo.length > 0 && (
              <li><b>{sinCargo.length}</b> línea(s) de mano de obra ({cant(resumen.hhSinCargo)} HH) cuyo cargo no se
                reconoce. No se reparten entre los cargos conocidos: eso distorsionaría justo la brecha del peón,
                que es la que decide la contratación.</li>
            )}
          </ul>
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
// LO QUE NO SE PUDO PLANIFICAR — y el motivo de cada línea
// ═══════════════════════════════════════════════════════════════════

function PendientesVista({ pendientes }) {
  const porMotivo = uM(() => {
    const m = new Map();
    for (const p of pendientes) {
      const g = m.get(p.motivo) || { motivo: p.motivo, lineas: [], monto: 0 };
      g.lineas.push(p); g.monto += num(p.monto);
      m.set(p.motivo, g);
    }
    return [...m.values()].sort((a, b) => b.monto - a.monto);
  }, [pendientes]);

  if (!pendientes.length) {
    return (
      <div className="card card-p" style={{ textAlign: 'center', color: 'var(--green)', padding: 24 }}>
        Todas las líneas del presupuesto se pudieron ubicar en un período.
      </div>
    );
  }
  return (
    <>
      <div className="card card-p" style={{ marginBottom: 12, borderLeft: '3px solid var(--amber)' }}>
        <b>Estas líneas no entraron al plan, y acá está el motivo de cada una.</b>
        <p style={{ fontSize: 12, color: 'var(--tm)', margin: '6px 0 0' }}>
          El motor no las reparte «parejo» para que el total cierre: una línea que dice «no sé cuándo» se arregla; una
          repartida a ojo se pierde entre las buenas y nadie la vuelve a mirar.
        </p>
      </div>
      {porMotivo.map(g => (
        <div key={g.motivo} className="card" style={{ marginBottom: 10 }}>
          <div className="card-p" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <b>{MOTIVO_PENDIENTE_LABEL[g.motivo] || g.motivo}</b>
            <span style={{ fontSize: 11.5, color: 'var(--tm)', marginLeft: 'auto' }}>
              {g.lineas.length} línea(s) · {solesK(g.monto)}
            </span>
          </div>
          <div style={{ overflowX: 'auto', borderTop: '1px solid var(--border)' }}>
            <table className="tbl">
              <thead><tr><th>Insumo</th><th>Categoría</th><th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ textAlign: 'right' }}>Monto</th></tr></thead>
              <tbody>
                {g.lineas.slice(0, 50).map((l, i) => (
                  <tr key={`${l.insumo_codigo || l.nombre}-${i}`}>
                    <td className="col-p">
                      <div style={{ fontSize: 12.5 }}>{l.nombre}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>{l.insumo_codigo || 'sin código'} · {l.unidad}</div>
                    </td>
                    <td style={{ fontSize: 11.5 }}>{SUBCATEGORIA_LABEL[l.subcategoria] || l.subcategoria}</td>
                    <td style={{ textAlign: 'right' }}>{cant(l.cantidad)}</td>
                    <td style={{ textAlign: 'right' }}>{soles(l.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {g.lineas.length > 50 && (
              <div style={{ padding: 8, fontSize: 11.5, color: 'var(--tm)', textAlign: 'center' }}>
                …y {g.lineas.length - 50} más con el mismo motivo.
              </div>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
// YA PEDIDO — lo que el plan escribió en la base (tanda 4, §7)
//
// Es la única pestaña donde se emite un documento, y se emite de a UNA.
// La lista de acá arriba puede tener 30 tarjetas; un botón de «emitir todo»
// quemaría 30 correlativos de la ejecutora en un click, y un correlativo
// gastado no se recupera aunque la orden se anule (ver `ordenes.js`).
// ═══════════════════════════════════════════════════════════════════

function DocumentosVista({ yaEscrito, ordenes, titular, permiso, emitiendo, onEmitir }) {
  const filas = uM(() => [...yaEscrito.values()]
    .sort((a, b) => String(a.requisicion.fecha_necesidad || '').localeCompare(String(b.requisicion.fecha_necesidad || ''))),
  [yaEscrito]);

  const porId = uM(() => new Map((ordenes || []).map(o => [o.id, o])), [ordenes]);

  if (!filas.length) {
    return (
      <div className="card card-p" style={{ textAlign: 'center', color: 'var(--tm)', padding: 24 }}>
        Todavía no se convirtió ninguna propuesta. Aceptá lo que corresponda arriba y usá «Convertir en requisiciones».
      </div>
    );
  }

  const pendientes = filas.filter(f => !f.ordenada);
  const emitidas = filas.filter(f => f.ordenada);
  const montoPend = pendientes.reduce((s, f) => s + num(f.monto), 0);

  return (
    <>
      <div className="card card-p" style={{ marginBottom: 12, borderLeft: '3px solid var(--blue)' }}>
        <b>{pendientes.length} requisición(es) por {soles(montoPend)} esperando orden · {emitidas.length} ya emitida(s).</b>
        <p style={{ fontSize: 12, color: 'var(--tm)', margin: '6px 0 0' }}>
          Una requisición se puede editar y borrar desde Compras. La <b>orden</b> toma un número correlativo de{' '}
          {titular ? <b>{titular.name || titular.legal_name}</b> : 'la ejecutora del trabajo'} que queda gastado aunque
          después se anule — por eso se emite de a una, con el proveedor puesto a mano.
        </p>
        {!permiso.ok && (
          <p style={{ fontSize: 11.5, color: 'var(--amber)', margin: '6px 0 0' }}>
            ⚠ {MOTIVO_NO_EMITE_LABEL[permiso.motivo]}
          </p>
        )}
      </div>

      {filas.map(f => (
        <RequisicionFila
          key={f.requisicion.id} f={f}
          orden={f.ordenada ? porId.get(f.requisicion.oc_id) : null}
          puedeEmitir={permiso.ok}
          ocupado={emitiendo === f.requisicion.id}
          onEmitir={(texto) => onEmitir(f.requisicion, texto)}
        />
      ))}
    </>
  );
}

function RequisicionFila({ f, orden, puedeEmitir, ocupado, onEmitir }) {
  const [abierta, setAbierta] = uS(false);
  // El proveedor que el escenario dejó anotado en las líneas, como punto de
  // partida. Se puede pisar: la orden se emite a quien la firma, no a quien
  // sugirió una pantalla.
  const sugerido = uM(() => {
    const m = /Proveedor sugerido:\s*(.+)$/.exec(f.items.find(it => it.notas)?.notas || '');
    return m ? m[1].trim() : '';
  }, [f.items]);
  const [prov, setProv] = uS(sugerido);
  const r = f.requisicion;

  return (
    <div className="card" style={{ marginBottom: 8, borderLeft: `3px solid ${f.ordenada ? 'var(--green)' : 'var(--blue)'}` }}>
      <div className="card-p" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', cursor: 'pointer' }}
        onClick={() => setAbierta(v => !v)}>
        <JxIcon name={abierta ? 'chevD' : 'chevR'} size={14} />
        <div style={{ minWidth: 200 }}>
          <b>{r.descripcion || r.origen_ref}</b>
          <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
            {f.items.length} línea(s) · creada el {String(r.fecha || '').slice(0, 10)}
            {r.fecha_necesidad && ` · se necesita para el ${r.fecha_necesidad}`}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <b>{soles(f.monto)}</b>
          <div style={{ fontSize: 10.5, color: f.ordenada ? 'var(--green)' : 'var(--tm)' }}>
            {f.ordenada ? (r.oc_codigo || 'orden emitida') : 'sin orden'}
          </div>
        </div>
      </div>

      {abierta && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {!f.ordenada && (
            <div style={{ padding: '10px 12px', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}
              onClick={e => e.stopPropagation()}>
              <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>Emitir a:</span>
              <input className="fi" list={DATALIST_PROVEEDORES} style={{ maxWidth: 300, fontSize: 12, padding: '4px 8px' }}
                placeholder="Buscá por nombre…" value={prov} onChange={e => setProv(e.target.value)} />
              <button className="btn btn-sm btn-amber"
                disabled={!puedeEmitir || ocupado || !prov.trim()}
                title={!puedeEmitir ? 'Solo la entidad ejecutora del trabajo puede emitir' : 'Toma el próximo correlativo de la ejecutora'}
                onClick={() => onEmitir(prov)}>
                <JxIcon name="file" size={13} /> {ocupado ? 'Emitiendo…' : 'Emitir la orden'}
              </button>
            </div>
          )}
          {f.ordenada && orden && (
            <div style={{ padding: '10px 12px', fontSize: 11.5, color: 'var(--tm)' }}>
              {orden.codigo} · {orden.proveedor_nombre || 'sin proveedor'} · {soles(orden.monto_total)}
              {' '}(valor de venta {soles(orden.monto_subtotal)} + IGV {soles(orden.monto_igv)}).
              {' '}Se ve y se imprime desde Órdenes de Compra.
            </div>
          )}
          <div style={{ overflowX: 'auto', borderTop: '1px solid var(--border)' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Insumo</th>
                  <th style={{ textAlign: 'right', width: 110 }}>Cantidad</th>
                  <th style={{ textAlign: 'right', width: 110 }}>Precio</th>
                  <th style={{ textAlign: 'right', width: 120 }}>Monto</th>
                </tr>
              </thead>
              <tbody>
                {f.items.slice(0, LINEAS_POR_TANDA).map(it => (
                  <tr key={it.id}>
                    <td className="col-p">
                      <div style={{ fontSize: 12.5 }}>{it.nombre || it.nombre_libre}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                        {it.insumo_codigo || 'sin código'} · {it.unidad || '—'} · {SUBCATEGORIA_LABEL[it.tipo_insumo] || it.tipo_insumo}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>{cant(it.cantidad)}</td>
                    <td style={{ textAlign: 'right' }}>{cant(it.precio_estimado)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{soles(num(it.cantidad) * num(it.precio_estimado))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {f.items.length > LINEAS_POR_TANDA && (
              <div style={{ padding: 8, fontSize: 11.5, color: 'var(--tm)', textAlign: 'center' }}>
                …y {f.items.length - LINEAS_POR_TANDA} línea(s) más. El detalle completo está en Compras.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// IMPUTAR LO YA COMPRADO se mudó a su propia página (tanda 3.2, ronda 3):
// `jx-simulador-imputar.jsx` (`ImputarComprasPage`). Acá solo queda lo que
// SÍ es del escenario: qué resta el almacén y, en modo personalizado,
// insumo por insumo (`PersonalizadoAlmacen`, más abajo).
// ═══════════════════════════════════════════════════════════════════

// Modo «personalizado»: insumo por insumo, qué resta el almacén.
function PersonalizadoAlmacen({ cubiertos, porInsumo, onParam }) {
  const set = (cod, cfg) => {
    const nuevo = { ...porInsumo };
    if (!cfg || cfg.modo === 'entradas') delete nuevo[cod]; else nuevo[cod] = cfg;
    onParam({ almacenPorInsumo: nuevo });
  };
  const LBL = { entradas: 'Lo que entró', stock: 'Lo que hay', nada: 'Nada', cantidad: 'Una cantidad' };
  if (!cubiertos.length) {
    return (
      <div className="card card-p" style={{ marginBottom: 10, fontSize: 12, color: 'var(--tm)' }}>
        Modo personalizado: todavía no hay ítems del almacén imputados. Imputá primero, y acá vas a poder elegir
        insumo por insumo qué se resta.
      </div>
    );
  }
  return (
    <div className="card" style={{ marginBottom: 10, overflowX: 'auto' }}>
      <table className="tbl" style={{ width: '100%', fontSize: 12 }}>
        <thead>
          <tr>
            <th className="col-p">Insumo del presupuesto</th>
            <th style={{ textAlign: 'right' }}>Pide</th>
            <th style={{ textAlign: 'right' }}>Entró</th>
            <th style={{ textAlign: 'right' }}>Hay</th>
            <th>Restar</th>
          </tr>
        </thead>
        <tbody>
          {cubiertos.map(c => {
            const cfg = porInsumo[c.codigo] || { modo: 'entradas' };
            return (
              <tr key={c.codigo}>
                <td className="col-p">{c.nombre} <span style={{ color: 'var(--tm)' }}>[{c.unidad}]</span></td>
                <td style={{ textAlign: 'right' }}>{c.necesita != null ? cant(c.necesita) : '—'}</td>
                <td style={{ textAlign: 'right' }}>{cant(c.entradas)}</td>
                <td style={{ textAlign: 'right' }}>{cant(c.stock)}</td>
                <td>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <select className="fi" style={{ fontSize: 11.5, padding: '2px 6px', maxWidth: 140 }} value={cfg.modo}
                      onChange={e => set(c.codigo, e.target.value === 'cantidad'
                        ? { modo: 'cantidad', cantidad: c.entradas }
                        : { modo: e.target.value })}>
                      {ALMACEN_MODOS_INSUMO.map(m => <option key={m} value={m}>{LBL[m]}</option>)}
                    </select>
                    {cfg.modo === 'cantidad' && (
                      <input className="fi" type="number" min="0" step="any" style={{ width: 90, fontSize: 11.5 }}
                        value={cfg.cantidad ?? ''} onChange={e => set(c.codigo, { modo: 'cantidad', cantidad: e.target.value })} />
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// LA HISTORIA DEL ESCENARIO (ronda 3, tanda 3.3 — doc §15.2 C)
//
// El cronograma «aleatorio por escenario» no se entiende mirando fechas de
// 1.718 partidas: se entiende con la historia contada, sus tramos con el
// ritmo de cada uno, y la curva de plata por mes contra el Gantt. Lo que
// dice esta tarjeta sale entero de `cronogramaPorEscenario()` y de
// `curvaDeCarga()`: acá no se calcula nada.
// ═══════════════════════════════════════════════════════════════════

function HistoriaDelEscenario({
  historia, curva, reparto, onRepartoEscenario, onOtra,
  relatoIA = null, preocupacion = '', onPreocupacion, onPedirIA, pidiendoIA = false, motivoIA = null,
}) {
  const h = historia.historia;
  if (!historia.activo) {
    return (
      <div className="card card-p" style={{ marginBottom: 12, borderLeft: '3px solid var(--amber)', fontSize: 12 }}>
        <b>{h.icono} {h.etiqueta}</b>
        <div style={{ color: 'var(--amber)', marginTop: 4 }}>
          ⚠ {MOTIVO_SIN_HISTORIA_LABEL[historia.motivo] || 'No se pudo armar la historia: se usan las fechas del Gantt.'}
        </div>
      </div>
    );
  }
  // El color del tramo es su ESTADO de caja, con ícono y rótulo al lado:
  // nunca solo el color.
  const fondoTramo = (t) => (t.caja === 'apretada' ? 'var(--red-l)' : t.ritmo > 1.005 ? 'var(--green-l)' : 'var(--tint-neutral)');
  const iconoTramo = (t) => (t.caja === 'apretada' ? '💸' : t.ritmo > 1.005 ? '⏩' : '▶');

  return (
    <div className="card card-p" style={{ marginBottom: 12, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <b style={{ fontSize: 14 }}>{h.icono} {h.etiqueta}</b>
        <span style={{ fontSize: 11, color: 'var(--tm)' }}>
          {historia.azar ? 'salió al azar · ' : ''}sorteo n.º {historia.semilla}
        </span>
        <button className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }} onClick={onOtra}
          title="Otra semilla: otra historia (si está «al azar») u otra intensidad de la misma">
          🎲 Otro
        </button>
      </div>

      {/* Tanda 3.4: el relato de la IA, si esta historia la eligió ella. Va
          ARRIBA del relato del sistema y dicho como lo que es: la IA eligió
          y contó; las fechas y la plata de abajo son del motor. */}
      {relatoIA && (
        <div style={{ fontSize: 12, border: '1px solid var(--border-a)', borderRadius: 6, padding: 10, display: 'grid', gap: 4 }}>
          <b style={{ fontSize: 11.5 }}>🤖 Cómo la cuenta la IA</b>
          {relatoIA.relato && <p style={{ margin: 0, color: 'var(--ts)' }}>{relatoIA.relato}</p>}
          {relatoIA.porQue && <p style={{ margin: 0, color: 'var(--tm)' }}><b>Por qué ésta:</b> {relatoIA.porQue}</p>}
          <p style={{ margin: 0, fontSize: 10.5, color: 'var(--tm)' }}>
            La IA eligió la historia y sus perillas; las fechas, los ritmos y la plata de abajo los calculó el sistema.
            {relatoIA.model ? ` · ${relatoIA.model}` : ''}
          </p>
        </div>
      )}

      <div style={{ fontSize: 12, color: 'var(--ts)', display: 'grid', gap: 4 }}>
        {historia.relato.map((frase, i) => <p key={i} style={{ margin: 0 }}>{frase}</p>)}
      </div>

      {onPedirIA && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <input className="fi" style={{ flex: '1 1 260px' }} maxLength={LARGO_PREOCUPACION}
            placeholder="¿Qué te preocupa de esta obra? (opcional) — ej.: la entidad paga tarde a fin de año"
            value={preocupacion} onChange={e => onPreocupacion?.(e.target.value)} />
          <button className="btn btn-sm btn-amber" disabled={pidiendoIA || !curva} onClick={onPedirIA}
            title="La IA lee la plata por mes y lo que escribiste, elige una historia del catálogo y la cuenta. Nunca pone una fecha.">
            {pidiendoIA ? 'Pensando…' : '🤖 Que la IA elija la historia'}
          </button>
          {motivoIA && (
            <span style={{ fontSize: 11.5, color: 'var(--tm)', flexBasis: '100%' }}>
              No se consiguió una historia de la IA ({motivoIA}). Sigue puesta la del sorteo.
            </span>
          )}
        </div>
      )}

      {/* Los tramos, a escala de días: dónde se frena y dónde se acelera. */}
      <div>
        <div style={{ display: 'flex', gap: 2, borderRadius: 6, overflow: 'hidden' }}>
          {historia.tramos.map((t, i) => (
            <div key={i} title={`${t.nombre}: del ${fechaCorta(t.desde)} al ${fechaCorta(t.hasta)}, al ${Math.round(t.ritmo * 100)} % del Gantt`}
              style={{
                flex: `${t.dias} 1 0`, minWidth: 34, background: fondoTramo(t), padding: '6px 4px',
                fontSize: 11, fontWeight: 600, color: 'var(--tp)', textAlign: 'center', whiteSpace: 'nowrap',
              }}>
              {iconoTramo(t)} {Math.round(t.ritmo * 100)} %
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gap: 2, marginTop: 6 }}>
          {historia.tramos.map((t, i) => (
            <div key={i} style={{ fontSize: 11, color: 'var(--tm)' }}>
              {iconoTramo(t)} {fechaCorta(t.desde)} → {fechaCorta(t.hasta)} · <b style={{ color: 'var(--ts)' }}>{Math.round(t.ritmo * 100)} %</b> del ritmo del Gantt
              {' '}· {t.nombre}
              {t.calculado && !historia.estira && ' (calculado para terminar en fecha)'}
              {t.caja === 'apretada' && (t.carasEsperan ? ' · caja apretada: las partidas caras esperan' : ' · caja apretada')}
            </div>
          ))}
        </div>
      </div>

      {historia.estira && (
        <div style={{ fontSize: 12, color: 'var(--amber)' }}>
          ⚠ Esta historia ESTIRA el fin {historia.diasEstirados} días: la obra termina el {fechaCorta(historia.finNuevo)} en vez del {fechaCorta(historia.fin)}.
          Es la única del catálogo que mueve la fecha de fin; el resto la respeta.
        </div>
      )}

      {reparto !== 'escenario' && (
        <div style={{ fontSize: 11.5, color: 'var(--tm)', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span style={{ flex: '1 1 300px' }}>
            Los tramos largos se reparten «{REPARTO_LABEL[reparto] || reparto}»: adentro de una partida larga no se ve
            el ritmo de la historia (un mes de frenazo pide lo mismo que uno normal).
          </span>
          <button className="btn btn-sm btn-ghost" onClick={onRepartoEscenario}>Repartir según el escenario</button>
        </div>
      )}

      <CurvaDeCargaGrafico curva={curva} />
    </div>
  );
}

/**
 * La curva de carga: la plata que pide el plan cada mes, con el Gantt (gris,
 * contexto) y con la historia (ámbar, lo que se mira). Columnas finas, una
 * leyenda, el pico de la historia rotulado, el valor de cada mes al pasar o
 * con el teclado, y la tabla entera abajo para quien no quiera leer barras.
 */
function CurvaDeCargaGrafico({ curva }) {
  const [foco, setFoco] = uS(null);
  if (!curva?.filas?.length) {
    return <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>Calculando la curva de carga…</div>;
  }
  const ALTO = 120;
  const max = curva.maximo || 1;
  const alto = (v) => (v > 0 ? Math.max(2, Math.round((v / max) * ALTO)) : 0);
  const pico = curva.picoEscenario?.mes;
  const f = foco ? curva.filas.find(x => x.mes === foco) : null;
  const variacion = (x) => (x.base > 0 ? Math.round(((x.escenario - x.base) / x.base) * 100) : null);
  const etiquetaX = (mes, i) => {
    const anio = mes.slice(2, 4);
    return `${etiquetaCorta(mes)}${i === 0 || mes.endsWith('-01') ? ` ${anio}` : ''}`;
  };
  const muestra = (color) => <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: color, marginRight: 4, verticalAlign: -1 }} />;

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'baseline', marginBottom: 8 }}>
        <b style={{ fontSize: 12.5 }}>Plata que pide el plan cada mes</b>
        <span style={{ fontSize: 11, color: 'var(--ts)' }}>{muestra('var(--tm)')}Gantt, sin la historia</span>
        <span style={{ fontSize: 11, color: 'var(--ts)' }}>{muestra('var(--amber-d)')}Con esta historia</span>
        <span style={{ fontSize: 10.5, color: 'var(--tm)', marginLeft: 'auto' }}>escala: 0 a {solesK(max)}</span>
      </div>

      <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', borderBottom: '1px solid var(--border-h)', paddingTop: 16 }}>
        {curva.filas.map((x) => (
          <div key={x.mes} tabIndex={0}
            aria-label={`${x.etiqueta}: Gantt ${solesK(x.base)}, con esta historia ${solesK(x.escenario)}`}
            onMouseEnter={() => setFoco(x.mes)} onMouseLeave={() => setFoco(null)}
            onFocus={() => setFoco(x.mes)} onBlur={() => setFoco(null)}
            style={{
              flex: '1 1 0', minWidth: 0, height: ALTO, position: 'relative', cursor: 'default', outline: 'none',
              display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 2,
              background: foco === x.mes ? 'var(--row-hover)' : 'transparent', borderRadius: '4px 4px 0 0',
            }}>
            <div style={{ width: 'min(16px, 42%)', height: alto(x.base), background: 'var(--tm)', borderRadius: '4px 4px 0 0' }} />
            <div style={{ width: 'min(16px, 42%)', height: alto(x.escenario), background: 'var(--amber-d)', borderRadius: '4px 4px 0 0', position: 'relative' }}>
              {x.mes === pico && (
                <span style={{
                  position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 2,
                  fontSize: 10, fontWeight: 600, color: 'var(--tp)', whiteSpace: 'nowrap',
                }}>{solesK(x.escenario)}</span>
              )}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        {curva.filas.map((x, i) => (
          <div key={x.mes} style={{ flex: '1 1 0', minWidth: 0, textAlign: 'center', fontSize: 10.5, color: 'var(--tm)', whiteSpace: 'nowrap', overflow: 'visible' }}>
            {etiquetaX(x.mes, i)}
          </div>
        ))}
      </div>

      {/* Lo que se lee al pasar (o al enfocar con el teclado); sin foco, los picos. */}
      <div style={{ fontSize: 11.5, color: 'var(--ts)', marginTop: 8, minHeight: 17 }}>
        {f ? (
          <><b style={{ color: 'var(--tp)' }}>{solesK(f.escenario)}</b> con esta historia · {solesK(f.base)} con el Gantt
            {variacion(f) != null && <> ({variacion(f) > 0 ? '+' : ''}{variacion(f)} %)</>} — {f.etiqueta}</>
        ) : (
          <>Pico con el Gantt: {curva.picoBase?.etiqueta} ({solesK(curva.picoBase?.base)}) · con esta historia: {curva.picoEscenario?.etiqueta} ({solesK(curva.picoEscenario?.escenario)}).
            {' '}La historia mueve la plata, no la cambia: {solesK(curva.totalEscenario)} contra {solesK(curva.totalBase)} en total.</>
        )}
      </div>

      <details style={{ marginTop: 6 }}>
        <summary style={{ fontSize: 11.5, cursor: 'pointer', color: 'var(--tm)' }}>Ver la tabla mes por mes</summary>
        <table style={{ width: '100%', fontSize: 11.5, marginTop: 6, borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr style={{ color: 'var(--tm)', textAlign: 'right' }}>
              <th style={{ textAlign: 'left', fontWeight: 500, padding: '2px 4px' }}>Mes</th>
              <th style={{ fontWeight: 500, padding: '2px 4px' }}>Gantt</th>
              <th style={{ fontWeight: 500, padding: '2px 4px' }}>Con esta historia</th>
              <th style={{ fontWeight: 500, padding: '2px 4px' }}>Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {curva.filas.map(x => (
              <tr key={x.mes} style={{ borderTop: '1px solid var(--border)', textAlign: 'right' }}>
                <td style={{ textAlign: 'left', padding: '2px 4px' }}>{x.etiqueta}</td>
                <td style={{ padding: '2px 4px' }}>{soles(x.base)}</td>
                <td style={{ padding: '2px 4px' }}>{soles(x.escenario)}</td>
                <td style={{ padding: '2px 4px' }}>{x.escenario - x.base >= 0 ? '+' : ''}{soles(x.escenario - x.base)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ESCENARIOS SUGERIDOS (tanda 2.6, OPCIONAL)
//
// Tres combinaciones de las perillas que ya existen (reparto, anticipación,
// frecuencia, monto mínimo), corridas con el motor REAL. Elegir un enfoque es
// lo mismo que cambiar esas perillas a mano en el panel de arriba — no hay
// nada que este archivo calcule distinto. La IA es un botón aparte: opina
// sobre los tres números ya calculados, nunca inventa uno nuevo.
// ═══════════════════════════════════════════════════════════════════

function EnfoquesVista({ enfoques, params, onUsar, recoIA, pidiendoIA, onPedirIA }) {
  if (!enfoques) {
    return <div className="card card-p" style={{ textAlign: 'center', color: 'var(--tm)' }}>Corriendo los tres enfoques…</div>;
  }
  const actuales = { reparto: params.reparto, anticipacionDias: params.anticipacionDias, frecuencia: params.frecuencia, montoMinimoOrden: params.montoMinimoOrden };
  const yaAplicado = (c) => Object.entries(c.overrides).every(([k, v]) => actuales[k] === v);

  return (
    <div>
      <div style={{ fontSize: 11.5, color: 'var(--tm)', margin: '4px 0 10px' }}>
        Tres combinaciones de reparto, anticipación, frecuencia y monto mínimo —las perillas de este mismo panel—,
        corridas con el motor real. Elegir uno cambia esas perillas; no hay ninguna cantidad ni precio que
        salga distinto de lo que el motor ya calcula. El colchón por insumo no lo toca ningún enfoque: eso lo seguís
        decidiendo vos, insumo por insumo.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <button className="btn btn-sm btn-amber" disabled={pidiendoIA} onClick={onPedirIA}>
          {pidiendoIA ? 'Pidiendo…' : '🤖 Pedir recomendación a la IA'}
        </button>
        {recoIA && !recoIA.recomendado && (
          <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>
            No se consiguió opinión de la IA{recoIA.motivo ? ` (${recoIA.motivo})` : ''} — los tres enfoques de abajo
            son igual de reales sin ella.
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        {enfoques.map(c => (
          <EnfoqueCard key={c.id} c={c} destacado={recoIA?.recomendado === c.id} recoIA={recoIA?.recomendado === c.id ? recoIA : null}
            aplicado={yaAplicado(c)} onUsar={() => onUsar(c.overrides)} />
        ))}
      </div>
    </div>
  );
}

function EnfoqueCard({ c, destacado, recoIA, aplicado, onUsar }) {
  const r = c.corrida.resumen;
  return (
    <div className="card card-p" style={{ borderLeft: `3px solid ${destacado ? 'var(--amber)' : 'var(--border)'}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 18 }}>{c.icono}</span>
        <b style={{ fontSize: 13.5 }}>{c.nombre}</b>
        {destacado && <span style={{ fontSize: 10.5, color: 'var(--amber)', fontWeight: 600, marginLeft: 'auto' }}>🤖 recomendado</span>}
      </div>
      <p style={{ fontSize: 12, color: 'var(--tm)', margin: '0 0 8px' }}>{c.resumenTexto}</p>

      <div style={{ display: 'flex', gap: 12, fontSize: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <div><b>{c.corrida.propuestas.length}</b> orden(es)</div>
        <div><b>{pct(r.cobertura)}</b> cobertura</div>
        <div><b>{solesK(r.montoPropuesto)}</b></div>
      </div>

      <p style={{ fontSize: 11.5, color: 'var(--tm)', margin: '0 0 10px' }}>{c.porQue}</p>

      {recoIA && (
        <div style={{ fontSize: 11.5, background: 'var(--bg-p)', border: '1px solid var(--amber)', borderRadius: 6, padding: 8, marginBottom: 10 }}>
          <b>Por qué la IA eligió éste:</b> {recoIA.explicacion}
          {recoIA.riesgo && <div style={{ marginTop: 4, color: 'var(--tm)' }}>⚠ {recoIA.riesgo}</div>}
        </div>
      )}

      <button className="btn btn-sm btn-ghost" disabled={aplicado} onClick={onUsar} style={{ width: '100%' }}>
        {aplicado ? '✓ Ya aplicado' : 'Usar este enfoque'}
      </button>
    </div>
  );
}

window.SimuladorOrdenesPage = SimuladorOrdenesPage;
export { SimuladorOrdenesPage };
export default SimuladorOrdenesPage;
