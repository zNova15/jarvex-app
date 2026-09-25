// ═══════════════════════════════════════════════════════════════════
// JARVEX — SIMULADOR DE ÓRDENES: ESCENARIOS Y DECISIONES (tanda 3).
//
// Diseño completo en `docs/plan-simulador-ordenes.md`. La tanda 1 hizo el
// motor de reparto y la 2 el de dotación; los dos son funciones puras que
// leen el presupuesto y devuelven una corrida. Lo que falta —y es lo que
// vive acá— es lo ÚNICO que el usuario aporta y el motor no puede deducir:
//
//   · con QUÉ PARÁMETROS quiere correr la simulación, guardado con nombre
//     para poder comparar «con Gantt» contra «regularizando desde hoy» sin
//     recalcular a mano (§3 del plan);
//   · QUÉ ACEPTA y QUÉ RECHAZA de lo que el motor propuso, por orden, por
//     línea o por tramo entero;
//   · QUÉ CORRIGE a mano — descripción, cantidad, precio, proveedor.
//
// Esto es estado de PERSONA, no de la obra: no hay tabla ni sync. Vive en el
// localStorage del navegador, por obra. La tanda 4 lo lee para escribir las
// requisiciones de verdad — recién ahí algo toca la base.
//
// ── POR QUÉ ESTÁ EN UNA LIB Y NO EN EL JSX ────────────────────────
// Porque una decisión tiene que SOBREVIVIR a que se vuelva a correr la
// simulación. Cambiar el anclaje o la granularidad reconstruye las propuestas
// desde cero: si las decisiones estuvieran atadas al objeto que devolvió el
// motor, cada cambio de parámetro las borraría en silencio. Por eso se
// guardan contra CLAVES ESTABLES (período + subcategoría para la orden,
// código de insumo —o nombre+unidad si no hay código— para la línea) y se
// re-aplican sobre la corrida nueva. Eso se puede testear; un `useState` no.
//
// ── LA REGLA QUE NO SE NEGOCIA: NADA SE TOTALIZA A CIEGAS ─────────
// Una línea sin precio presupuestado (el motor la marca `montoConocido:
// false`) NO entra al monto aceptado como cero. Se cuenta aparte, en
// `resumen.lineasSinPrecio`, para que la pantalla diga «hay N líneas
// aceptadas cuyo monto todavía no se sabe» en vez de mostrar un total que
// miente por abajo. Mismo criterio que el cero silencioso de
// `abastecimiento.js` y que el `consumido: null` de los sobres.
//
// Testeado en __tests__/simulador-escenarios.test.js
// ═══════════════════════════════════════════════════════════════════

import {
  GRANULARIDADES,
  CATEGORIAS_SIMULADOR, UMBRAL_TRAMO_LARGO_DIAS,
  ALMACEN_MODOS, ALMACEN_MODOS_INSUMO,
} from './simulador-ordenes.js';
import { CATEGORIA_DE_SUBCATEGORIA } from './insumo-clasificador.js';
import { JORNADA_DEFAULT } from './simulador-dotacion.js';
import { normalizarCompra } from './simulador-compra.js';
import { FRECUENCIAS, FRECUENCIA_DEFAULT } from './simulador-consolidacion.js';
import { RUBRO_COMPRA_POR_ID } from './indices-unificados-iupc.js';
import { hoyLocal } from './fecha.js';
import {
  HISTORIA_AZAR, HISTORIA_IDS, semillaValida, normalizarAjustesHistoria, normalizarRelatoIA,
} from './simulador-historias.js';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;
const r4 = (n) => Math.round((num(n) + Number.EPSILON) * 10000) / 10000;

/** Las tres respuestas posibles a una propuesta. */
export const DECISIONES = ['pendiente', 'aceptada', 'rechazada'];
export const DECISION_LABEL = {
  pendiente: 'Sin decidir',
  aceptada: 'Aceptada',
  rechazada: 'Rechazada',
};

export const STORAGE_PREFIX = 'jx_sim_ordenes_v1';

// ═══════════════════════════════════════════════════════════════════
// LOS PARÁMETROS DE UNA CORRIDA
// ═══════════════════════════════════════════════════════════════════

// ── LOS DOS MODOS (ronda 3, tanda 3.1 — doc §15.2 A) ─────────────
// La pantalla contestaba dos preguntas con un solo selector de «anclaje»:
// «¿cómo compraría esta obra si…?» y «¿qué me falta pedir según lo que ya
// pasó?». Ahora son dos modos, y el anclaje del motor sale de ellos:
//   · 'simulacion' → anclaje 'cero': presupuesto + cronograma, sin restar
//     nada real. No sirve para emitir.
//   · 'real'       → anclaje 'hoy': resta órdenes, requisiciones y almacén,
//     y arrastra lo atrasado al período actual.
// El anclaje 'restante' se retiró (nadie lo usaba y confundía): un escenario
// guardado con él se abre en modo real.
export const MODOS = ['real', 'simulacion'];
export const MODO_LABEL = {
  real: '📍 Según lo real',
  simulacion: '🧪 Simulación',
};

/**
 * En modo Simulación, desde cuándo arranca la obra (decisión de Gabriel del
 * 24-set, §15.3): las fechas del Gantt por defecto, o el cronograma entero
 * corrido para que empiece hoy o en una fecha elegida. El corrimiento lo hace
 * `desplazarCronograma` (simulador-cronograma.js); acá solo se guarda qué se
 * eligió.
 */
export const ARRANQUES = ['gantt', 'hoy', 'fecha'];
export const ARRANQUE_LABEL = {
  gantt: 'En las fechas del Gantt',
  hoy: 'Como si empezara hoy',
  fecha: 'En una fecha que elijo',
};

/**
 * Lo que la pantalla ofrece de los ejes del motor. «Reprogramado a mano» y
 * los repartos «por cuadrilla» y «manual» pedían un dato que nadie va a
 * cargar (fechas o reparto de 1.718 partidas) y terminaban en «Sin
 * planificar» (§15.1 punto 4). Se retiran de la pantalla; un escenario
 * guardado con ellos se abre con el default.
 *
 * Tanda 3.3 (§15.2 C y D): en su lugar, el cronograma «aleatorio por
 * escenario» —una historia de la obra, ver `simulador-cronograma.js`— y el
 * reparto «según el escenario». El motor no los conoce con ese nombre: la
 * historia le llega como `reprogramacion` (cronograma 'reprogramado') y el
 * reparto como `repartoManual`; la traducción es `armarCronograma()`.
 */
export const CRONOGRAMAS_PANTALLA = ['gantt', 'escenario', 'sin_cronograma'];
export const CRONOGRAMA_PANTALLA_LABEL = {
  gantt: 'Gantt del expediente',
  escenario: '🎲 Aleatorio por escenario (una historia de la obra)',
  sin_cronograma: 'Sin cronograma (parejo en todo el plazo)',
};
export const REPARTOS_PANTALLA = ['parejo', 'inicio', 'escenario'];

const esYmd = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * El default NO incluye `mano_obra` en las categorías: la mano de obra no se
 * compra (§5 del plan) y tiene su propia pestaña, alimentada por
 * `simulador-dotacion.js`. Meterla en el filtro de órdenes la mostraría como
 * si fuera algo que se le puede emitir a un proveedor.
 *
 * `reparto: 'parejo'` y no `'inicio'` por lo que midió la tanda 1: el tramo
 * largo son 397 líneas por S/ 5,6 M, no un detalle de EPPs. Poner todo eso en
 * el mes de arranque desfigura el flujo de caja de la obra entera.
 *
 * Consolidación (tanda 2.3): `frecuencia: 'mensual'` deja el plan mes a mes
 * como estaba y junta el semanal en órdenes mensuales con entregas semanales.
 * `montoMinimoOrden: 0` no junta nada por monto: el umbral lo fija Gabriel —
 * mismo criterio que el colchón, ningún número de oficio.
 */
export const PARAMS_DEFAULT = {
  granularidad: 'mes',
  modo: 'real',
  arranque: 'gantt',
  arranqueFecha: null,
  cronograma: 'gantt',
  // Tanda 3.3 — la historia del cronograma «aleatorio por escenario»: un id
  // del catálogo o 'azar' (la sortea la semilla). La semilla hace que el
  // mismo escenario dé siempre el mismo cronograma; «🎲 Otro» la cambia.
  // `historiaAjustes` son perillas fijadas dentro de los rangos de la
  // historia (las va a usar la IA de la tanda 3.4); vacío = las de la semilla.
  historia: HISTORIA_AZAR,
  semilla: 1,
  historiaAjustes: {},
  reparto: 'parejo',
  categorias: ['materiales', 'herramientas', 'servicios'],
  anticipacionDias: 0,
  umbralTramoLargoDias: UMBRAL_TRAMO_LARGO_DIAS,
  jornada: { ...JORNADA_DEFAULT },
  contarSubcontratos: false,
  frecuencia: FRECUENCIA_DEFAULT,
  frecuenciaPorRubro: {},
  montoMinimoOrden: 0,
  // Tanda 2.5 — qué resta el almacén de la obra (ver `coberturaPrevia`). Es
  // del ESCENARIO a propósito: «¿y si solo cuento lo que hay?» es una
  // pregunta que se compara contra «todo lo que entró».
  almacenModo: 'entradas',
  almacenPorInsumo: {},
};

const enLista = (v, lista, def) => (lista.includes(v) ? v : def);

/** Un entero acotado. Un parámetro fuera de rango se recorta, no rompe. */
const entre = (v, min, max, def) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.round(n)));
};

/**
 * Deja los parámetros en un estado que el motor pueda comer.
 *
 * Nunca tira: un escenario guardado hace tres meses con un valor que ya no
 * existe tiene que poder abrirse igual, con el default en su lugar. Un
 * escenario que revienta al cargarse es un escenario perdido.
 */
export function normalizarParams(p = {}) {
  const cats = Array.isArray(p.categorias)
    ? p.categorias.filter(c => CATEGORIAS_SIMULADOR.includes(c))
    : PARAMS_DEFAULT.categorias;
  const jor = p.jornada || {};
  const dias = Array.isArray(jor.diasSemana)
    ? [...new Set(jor.diasSemana.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : [...JORNADA_DEFAULT.diasSemana];
  return {
    granularidad: enLista(p.granularidad, GRANULARIDADES, PARAMS_DEFAULT.granularidad),
    // Los escenarios de antes de la ronda 3 no traen `modo`: se deduce del
    // anclaje que tenían. 'cero' era la auditoría, que es una simulación.
    modo: MODOS.includes(p.modo) ? p.modo : (p.anclaje === 'cero' ? 'simulacion' : 'real'),
    arranque: enLista(p.arranque, ARRANQUES, PARAMS_DEFAULT.arranque),
    // «Una fecha» sin fecha todavía es válido (se acaba de elegir y falta
    // escribirla): el corrimiento no hace nada hasta que llegue una.
    arranqueFecha: esYmd(p.arranqueFecha) ? p.arranqueFecha : null,
    cronograma: enLista(p.cronograma, CRONOGRAMAS_PANTALLA, PARAMS_DEFAULT.cronograma),
    // Una historia que ya no está en el catálogo se abre «al azar»: el
    // escenario sigue teniendo un cronograma, no revienta.
    historia: HISTORIA_IDS.includes(p.historia) ? p.historia : HISTORIA_AZAR,
    semilla: semillaValida(p.semilla),
    historiaAjustes: normalizarAjustesHistoria(p.historia, p.historiaAjustes),
    reparto: enLista(p.reparto, REPARTOS_PANTALLA, PARAMS_DEFAULT.reparto),
    // Sin ninguna categoría no hay nada que simular: se vuelve al default en
    // vez de devolver una pantalla vacía que parece un error de datos.
    categorias: cats.length ? cats : [...PARAMS_DEFAULT.categorias],
    anticipacionDias: entre(p.anticipacionDias, 0, 365, 0),
    umbralTramoLargoDias: entre(p.umbralTramoLargoDias, 1, 3650, UMBRAL_TRAMO_LARGO_DIAS),
    jornada: {
      horasPorDia: Math.min(24, Math.max(1, num(jor.horasPorDia) || JORNADA_DEFAULT.horasPorDia)),
      diasSemana: dias.length ? dias : [...JORNADA_DEFAULT.diasSemana],
      factorEfectivo: Math.min(1, Math.max(0.1, num(jor.factorEfectivo) || 1)),
    },
    contarSubcontratos: !!p.contarSubcontratos,
    frecuencia: enLista(p.frecuencia, FRECUENCIAS, FRECUENCIA_DEFAULT),
    // Solo rubros que existen y frecuencias válidas. Las claves van ordenadas
    // para que `mismosParams` no vea dos escenarios distintos por el orden en
    // que se tocaron los rubros.
    frecuenciaPorRubro: Object.fromEntries(Object.entries(p.frecuenciaPorRubro || {})
      .filter(([r, f]) => RUBRO_COMPRA_POR_ID.has(r) && FRECUENCIAS.includes(f))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    montoMinimoOrden: entre(p.montoMinimoOrden, 0, 10000000, 0),
    almacenModo: enLista(p.almacenModo, ALMACEN_MODOS, PARAMS_DEFAULT.almacenModo),
    almacenPorInsumo: normalizarAlmacenPorInsumo(p.almacenPorInsumo),
  };
}

/**
 * La elección por insumo del modo personalizado, saneada: solo modos que
 * existen, y la cantidad solo cuando el modo es «cantidad» (≥ 0). Las claves
 * ordenadas, por lo mismo que `frecuenciaPorRubro`.
 */
export function normalizarAlmacenPorInsumo(obj) {
  const out = [];
  for (const [cod, cfg] of Object.entries(obj || {})) {
    if (!cod || !cfg || !ALMACEN_MODOS_INSUMO.includes(cfg.modo)) continue;
    if (cfg.modo === 'cantidad') {
      const c = Number(cfg.cantidad);
      if (!Number.isFinite(c) || c < 0) continue;
      out.push([cod, { modo: 'cantidad', cantidad: Math.round(c * 10000) / 10000 }]);
    } else if (cfg.modo !== 'entradas') {
      // 'entradas' es el default de un insumo: no hace falta guardarlo.
      out.push([cod, { modo: cfg.modo }]);
    }
  }
  return Object.fromEntries(out.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Los parámetros que van al motor de órdenes, tal cual los espera.
 *
 * El cronograma «escenario» sale como 'gantt': la historia y el arranque los
 * traduce `armarCronograma()` (simulador-cronograma.js) a `reprogramacion`, y
 * la pantalla pisa estos ejes con lo que devuelve. Sin esa traducción, el
 * motor corre el Gantt — nunca una historia a medias.
 */
export function paramsDeMotor(params) {
  const p = normalizarParams(params);
  return {
    granularidad: p.granularidad,
    anclaje: p.modo === 'simulacion' ? 'cero' : 'hoy',
    cronograma: p.cronograma === 'escenario' ? 'gantt' : p.cronograma,
    reparto: p.reparto,
    categorias: p.categorias,
    anticipacionDias: p.anticipacionDias,
    umbralTramoLargoDias: p.umbralTramoLargoDias,
    frecuencia: p.frecuencia,
    frecuenciaPorRubro: p.frecuenciaPorRubro,
    montoMinimoOrden: p.montoMinimoOrden,
    almacenModo: p.almacenModo,
    almacenPorInsumo: p.almacenPorInsumo,
  };
}

/** ¿Dos corridas son la misma pregunta? Para avisar «ya tenés este escenario». */
export function mismosParams(a, b) {
  return JSON.stringify(normalizarParams(a)) === JSON.stringify(normalizarParams(b));
}

/**
 * En qué pestaña de categoría va una orden (tanda 3.1, §15.2 E).
 *
 * La orden se arma por RUBRO de proveedor, y un rubro puede mezclar
 * categorías: «Seguridad y señalización» trae las señales (materiales) con
 * los EPPs (herramientas y EPPs). Partir la orden entre dos pestañas la
 * rompería — se le emite a UN proveedor —, así que va entera a la categoría
 * que más plata pesa adentro. Empate o sin montos: la de la primera línea,
 * que es lo que el motor ya ponía en `p.categoria`.
 *
 * @returns {{categoria:string, mezcla:Object<string,number>}} `mezcla` cuenta
 *          las líneas de OTRAS categorías, para que la tarjeta lo diga.
 */
export function categoriaDePropuesta(p = {}) {
  const peso = new Map();
  const lineasPor = new Map();
  for (const l of (p.lineas || [])) {
    const cat = l.categoria || CATEGORIA_DE_SUBCATEGORIA[l.subcategoria] || p.categoria || 'materiales';
    peso.set(cat, (peso.get(cat) || 0) + num(l.monto));
    lineasPor.set(cat, (lineasPor.get(cat) || 0) + 1);
  }
  let categoria = p.categoria || CATEGORIA_DE_SUBCATEGORIA[p.subcategoria] || null;
  let mejor = categoria != null && peso.has(categoria) ? peso.get(categoria) : -Infinity;
  for (const [cat, m] of peso) {
    if (m > mejor) { categoria = cat; mejor = m; }
  }
  if (!categoria) categoria = 'materiales';
  const mezcla = {};
  for (const [cat, n] of lineasPor) if (cat !== categoria) mezcla[cat] = n;
  return { categoria, mezcla };
}

// ═══════════════════════════════════════════════════════════════════
// CLAVES ESTABLES
//
// Son lo que permite que una decisión sobreviva a volver a correr el motor.
// Tienen que derivar SOLO de lo que no cambia entre corridas.
// ═══════════════════════════════════════════════════════════════════

/**
 * La clave de una línea dentro de su propuesta.
 *
 * El motor ya la calcula (`clave`) con el código del insumo, o nombre+unidad
 * si no hay código — que es el caso de buena parte del expediente. Se la
 * vuelve a derivar acá solo si no vino, para no depender del orden en que se
 * desplieguen las tandas.
 */
export function claveLinea(linea = {}) {
  if (linea.clave) return String(linea.clave);
  const cod = linea.insumo_codigo && String(linea.insumo_codigo).trim();
  if (cod) return cod;
  const nom = String(linea.nombreOriginal || linea.nombre || '').trim().toLowerCase();
  const uni = String(linea.unidad || '').trim().toLowerCase();
  return `~${nom}|${uni}`;
}

/** Dónde se guarda la decisión/edición de una línea. */
export const refLinea = (propuestaId, clave) => `${propuestaId}::${clave}`;

// ── ÁTOMOS (tanda 2.3) ────────────────────────────────────────────
// Desde la consolidación, una orden puede juntar varios períodos de un rubro
// («Concreto — octubre a diciembre»). Lo que antes era la orden —período ×
// rubro, con el mismo id `2026-10|concreto`— ahora es un ÁTOMO, y las
// decisiones se guardan contra los átomos: juntar o separar órdenes cambiando
// la frecuencia o el monto mínimo no borra nada de lo decidido, y los
// escenarios guardados antes de la 2.3 se leen tal cual.
//
// Las funciones de acá aceptan la propuesta ENTERA o solo su id: con el id
// suelto se comportan como antes (un átomo = la orden).

const idDe = (p) => (p && typeof p === 'object' ? p.id : p);

/** Los átomos de una propuesta: los suyos si los trae, si no ella misma. */
const atomosDe = (p) => (p && typeof p === 'object' && Array.isArray(p.atomos) && p.atomos.length
  ? p.atomos.map(a => a.id)
  : [idDe(p)]);

/** Los átomos en los que entrega una línea (uno por entrega). */
const atomosDeLinea = (propuestaId, linea) => {
  const ids = Array.isArray(linea?.entregas) && linea.entregas.length
    ? linea.entregas.map(e => e.propuestaId || propuestaId)
    : [propuestaId];
  return [...new Set(ids)];
};

/** La firma de las entregas de una línea: contra qué se corrigió la cantidad. */
const firmaEntregas = (linea) => (Array.isArray(linea?.entregas) && linea.entregas.length
  ? linea.entregas.map(e => e.periodo).join(',')
  : null);

// ═══════════════════════════════════════════════════════════════════
// EL ESCENARIO
// ═══════════════════════════════════════════════════════════════════

let seq = 0;
const nuevoId = (pref) => {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${pref}_${crypto.randomUUID()}`;
  } catch { /* entorno sin crypto */ }
  seq += 1;
  return `${pref}_${Date.now().toString(36)}_${seq}`;
};

/**
 * Un escenario nuevo, vacío de decisiones.
 *
 * @param {Object} o
 * @param {string} o.nombre    cómo lo va a reconocer Gabriel en la lista.
 * @param {Object} [o.params]  los ejes de la corrida.
 * @param {string} [o.obraId]
 */
export function nuevoEscenario({ nombre = '', params = null, obraId = null, hoy = null } = {}) {
  const ahora = hoy || hoyLocal();
  return {
    id: nuevoId('esc'),
    obra_id: obraId || null,
    nombre: String(nombre || '').trim() || `Escenario ${ahora}`,
    params: normalizarParams(params || PARAMS_DEFAULT),
    creado: ahora,
    actualizado: ahora,
    // decisión a nivel ORDEN (período × subcategoría) y a nivel LÍNEA.
    // La de la línea gana sobre la de su orden: aceptar 18 de 20 líneas es
    // el caso normal, no la excepción.
    decisiones: { propuestas: {}, lineas: {} },
    ediciones: {},
    // Los sobres (§4.1) no tienen lista de insumos: se les escribe una a
    // mano contra su techo. Por eso llevan su propio carril.
    sobres: {},
    notas: '',
    // Tanda 3.4: el relato de la historia que eligió la IA. Va con el
    // escenario y no en sus params: no es una perilla, es lo que se dijo
    // sobre ellas (y solo se muestra mientras sigan siendo ésas).
    relatoIA: null,
  };
}

/** Un escenario leído de localStorage, saneado. */
export function normalizarEscenario(e = {}, { obraId = null } = {}) {
  const dec = e.decisiones || {};
  const limpiar = (obj) => {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
      if (DECISIONES.includes(v) && v !== 'pendiente') out[k] = v;
    }
    return out;
  };
  const sobres = {};
  for (const [k, s] of Object.entries(e.sobres || {})) {
    if (!s) continue;
    sobres[k] = {
      decision: DECISIONES.includes(s.decision) ? s.decision : 'pendiente',
      proveedor_id: s.proveedor_id || null,
      proveedor_nombre: s.proveedor_nombre || '',
      lineas: Array.isArray(s.lineas) ? s.lineas.filter(Boolean).map(l => ({
        id: l.id || nuevoId('sl'),
        descripcion: String(l.descripcion || ''),
        unidad: String(l.unidad || ''),
        cantidad: num(l.cantidad),
        precio: num(l.precio),
      })) : [],
    };
  }
  return {
    id: e.id || nuevoId('esc'),
    obra_id: e.obra_id || obraId || null,
    nombre: String(e.nombre || '').trim() || 'Escenario sin nombre',
    params: normalizarParams(e.params),
    creado: e.creado || hoyLocal(),
    actualizado: e.actualizado || e.creado || hoyLocal(),
    decisiones: { propuestas: limpiar(dec.propuestas), lineas: limpiar(dec.lineas) },
    ediciones: (e.ediciones && typeof e.ediciones === 'object') ? { ...e.ediciones } : {},
    sobres,
    notas: String(e.notas || ''),
    relatoIA: normalizarRelatoIA(e.relatoIA),
  };
}

/**
 * Aplica lo que eligió la IA (tanda 3.4): la historia y TODAS sus perillas
 * pasan a los params — así la semilla ya no decide nada de esa historia — y
 * el relato queda guardado al lado. `valores` son las perillas completas
 * (lo que la IA no fijó, completado con el sorteo), para que el relato
 * describa exactamente lo que se simula.
 */
export function conHistoriaIA(esc, { historia, valores, relato = '', porQue = '', model = null, fecha = null } = {}) {
  const relatoIA = normalizarRelatoIA({ historia, ajustes: valores, relato, porQue, model, fecha: fecha || hoyLocal() });
  if (!relatoIA) return esc;
  return tocado({
    ...esc,
    params: normalizarParams({ ...esc.params, cronograma: 'escenario', historia, historiaAjustes: relatoIA.ajustes }),
    relatoIA,
  });
}

const tocado = (esc) => ({ ...esc, actualizado: hoyLocal() });

/** Cambia los parámetros SIN perder las decisiones ya tomadas. */
export function conParams(esc, params) {
  return tocado({ ...esc, params: normalizarParams({ ...esc.params, ...params }) });
}

/**
 * Decide una orden entera: todos sus átomos (tanda 2.3).
 *
 * Al decidir la orden se limpian las decisiones de SUS líneas: si no, «acepto
 * todo» dejaría adentro una línea rechazada hace diez minutos y el total de
 * arriba no cerraría contra lo que se ve abajo.
 *
 * @param {Object|string} propuesta  la propuesta (con `atomos`) o su id.
 */
export function decidirPropuesta(esc, propuesta, decision) {
  const d = DECISIONES.includes(decision) ? decision : 'pendiente';
  const props = { ...esc.decisiones.propuestas };
  const lin = { ...esc.decisiones.lineas };
  for (const id of atomosDe(propuesta)) {
    if (d === 'pendiente') delete props[id];
    else props[id] = d;
    for (const k of Object.keys(lin)) if (k.startsWith(`${id}::`)) delete lin[k];
  }
  return tocado({ ...esc, decisiones: { propuestas: props, lineas: lin } });
}

/**
 * Decide UNA línea, en todas sus entregas. Gana sobre la decisión de su orden.
 *
 * @param {Object|string} propuesta  la propuesta o su id.
 */
export function decidirLinea(esc, propuesta, linea, decision) {
  const d = DECISIONES.includes(decision) ? decision : 'pendiente';
  const lin = { ...esc.decisiones.lineas };
  const clave = claveLinea(linea);
  for (const id of atomosDeLinea(idDe(propuesta), linea)) {
    const k = refLinea(id, clave);
    if (d === 'pendiente') delete lin[k];
    else lin[k] = d;
  }
  return tocado({ ...esc, decisiones: { ...esc.decisiones, lineas: lin } });
}

/** Decide TODAS las órdenes que se emiten en un período: el «tramo» del §10. */
export function decidirPeriodo(esc, periodo, decision, propuestas = []) {
  let out = esc;
  for (const p of propuestas) {
    if (p.periodo !== periodo) continue;
    out = decidirPropuesta(out, p, decision);
  }
  return out;
}

/**
 * Corrige una línea a mano.
 *
 * `null` en un campo lo devuelve al valor del presupuesto — no lo pone en
 * cero. Borrar una corrección y ponerla en cero son cosas distintas y la
 * segunda sería una orden de S/ 0.
 */
export function editarLinea(esc, propuesta, linea, patch = {}) {
  const propuestaId = idDe(propuesta);
  const k = refLinea(propuestaId, claveLinea(linea));
  const ed = { ...(esc.ediciones[k] || {}) };
  for (const [campo, valor] of Object.entries(patch)) {
    if (valor === null || valor === undefined || valor === '') delete ed[campo];
    else if (campo === 'cantidad' || campo === 'precio_unitario') {
      const n = Number(valor);
      if (!Number.isFinite(n) || n < 0) delete ed[campo];
      else ed[campo] = n;
    } else ed[campo] = valor;
  }
  // Una cantidad o un precio corregidos valen EN UNA UNIDAD. Si después se
  // cambia cómo se compra el insumo (de metros a tubos de 6 m), «164» deja de
  // significar lo mismo: `aplicarEscenario` compara contra esto y no aplica
  // la corrección vieja en vez de pedir 164 tubos.
  if (ed.cantidad != null || ed.precio_unitario != null) ed.unidad_edicion = String(linea.unidad || '');
  else delete ed.unidad_edicion;
  // Y una cantidad corregida vale para UNAS entregas (tanda 2.3): «20» sobre
  // la línea de octubre no son 20 cuando la orden pasa a juntar octubre y
  // noviembre. Se guarda contra cuáles se hizo, y `aplicarEscenario` no la
  // aplica si la orden se reagrupó. El precio no depende de eso.
  const firma = firmaEntregas(linea);
  if (ed.cantidad != null && firma) ed.periodos_edicion = firma;
  else delete ed.periodos_edicion;
  const eds = { ...esc.ediciones };
  if (Object.keys(ed).length) eds[k] = ed;
  else delete eds[k];
  return tocado({ ...esc, ediciones: eds });
}

/**
 * El proveedor de TODA una orden propuesta.
 *
 * Una orden se le emite a UN proveedor: ése es el caso normal y el que el §6
 * describe. El proveedor se sigue guardando por línea —la tanda 4 puede
 * necesitar partir una orden en dos— pero se elige una sola vez, arriba.
 *
 * `soloAceptadas` deja pisar únicamente lo que se va a emitir: asignarle
 * proveedor a una línea rechazada no cambia nada y ensucia la comparación.
 */
export function proveedorDePropuesta(esc, propuesta, lineas = [], { id = null, nombre = '' } = {}, { soloAceptadas = false } = {}) {
  let out = esc;
  for (const l of lineas) {
    if (soloAceptadas && l.decision !== 'aceptada') continue;
    out = editarLinea(out, propuesta, l, {
      proveedor_id: id || null,
      proveedor_nombre: nombre || null,
    });
  }
  return out;
}

/**
 * Deshace todas las correcciones de una línea — también las que se hicieron
 * cuando sus entregas eran órdenes sueltas: si quedaran, `aplicarEscenario`
 * las volvería a encontrar y el botón «volver al expediente» no haría nada.
 */
export function limpiarEdicion(esc, propuesta, linea) {
  const eds = { ...esc.ediciones };
  const propuestaId = idDe(propuesta);
  const clave = claveLinea(linea);
  delete eds[refLinea(propuestaId, clave)];
  for (const id of atomosDeLinea(propuestaId, linea)) delete eds[refLinea(id, clave)];
  return tocado({ ...esc, ediciones: eds });
}

// ── SOBRES (§4.1): órdenes de descripción libre contra un techo ──

const sobreDe = (esc, clave) => esc.sobres[clave]
  || { decision: 'pendiente', proveedor_id: null, proveedor_nombre: '', lineas: [] };

export function decidirSobre(esc, clave, decision) {
  const d = DECISIONES.includes(decision) ? decision : 'pendiente';
  const s = { ...sobreDe(esc, clave), decision: d };
  return tocado({ ...esc, sobres: { ...esc.sobres, [clave]: s } });
}

export function agregarLineaSobre(esc, clave, linea = {}) {
  const s = sobreDe(esc, clave);
  const nueva = {
    id: nuevoId('sl'),
    descripcion: String(linea.descripcion || ''),
    unidad: String(linea.unidad || ''),
    cantidad: num(linea.cantidad),
    precio: num(linea.precio),
  };
  return tocado({ ...esc, sobres: { ...esc.sobres, [clave]: { ...s, lineas: [...s.lineas, nueva] } } });
}

export function editarLineaSobre(esc, clave, lineaId, patch = {}) {
  const s = sobreDe(esc, clave);
  const lineas = s.lineas.map(l => (l.id !== lineaId ? l : {
    ...l,
    ...(patch.descripcion !== undefined ? { descripcion: String(patch.descripcion) } : {}),
    ...(patch.unidad !== undefined ? { unidad: String(patch.unidad) } : {}),
    ...(patch.cantidad !== undefined ? { cantidad: num(patch.cantidad) } : {}),
    ...(patch.precio !== undefined ? { precio: num(patch.precio) } : {}),
  }));
  return tocado({ ...esc, sobres: { ...esc.sobres, [clave]: { ...s, lineas } } });
}

export function quitarLineaSobre(esc, clave, lineaId) {
  const s = sobreDe(esc, clave);
  return tocado({ ...esc, sobres: { ...esc.sobres, [clave]: { ...s, lineas: s.lineas.filter(l => l.id !== lineaId) } } });
}

export function proveedorDeSobre(esc, clave, { id = null, nombre = '' } = {}) {
  const s = sobreDe(esc, clave);
  return tocado({ ...esc, sobres: { ...esc.sobres, [clave]: { ...s, proveedor_id: id, proveedor_nombre: nombre } } });
}

// ═══════════════════════════════════════════════════════════════════
// APLICAR EL ESCENARIO SOBRE UNA CORRIDA
// ═══════════════════════════════════════════════════════════════════

/**
 * Cruza lo que devolvió `simularOrdenes()` con lo que la persona decidió y
 * corrigió, y devuelve lo mismo pero decorado.
 *
 * Lo que NO hace: tocar la corrida. El motor sigue siendo la verdad de
 * «cuánto pide el expediente»; las ediciones viajan al lado (`montoOriginal`,
 * `desvio`) para que siempre se pueda ver contra qué se está comparando. Ése
 * es el punto del §6 del plan: el precio por defecto es el del expediente, no
 * el del mercado, porque la gracia es medir el desvío.
 *
 * @returns {{propuestas:Array, sobres:Array, resumen:Object}}
 */
export function aplicarEscenario({ propuestas = [], sobres = [] } = {}, escenario = null) {
  const esc = escenario ? normalizarEscenario(escenario) : nuevoEscenario({});
  const resumen = {
    ordenes: propuestas.length,
    ordenesAceptadas: 0, ordenesRechazadas: 0, ordenesParciales: 0, ordenesPendientes: 0,
    lineas: 0, lineasAceptadas: 0, lineasRechazadas: 0, lineasPendientes: 0,
    lineasEditadas: 0, lineasSinPrecio: 0, lineasSinProveedor: 0, lineasMixtas: 0,
    montoAceptado: 0, montoRechazado: 0, montoPendiente: 0,
    montoOriginalAceptado: 0, desvio: 0,
    sobres: sobres.length, sobresAceptados: 0,
    montoSobresAceptado: 0, montoSobresTecho: 0, sobresExcedidos: 0,
    periodosAceptados: [],
  };

  const periodosConAceptado = new Set();

  const decAtomo = (id) => esc.decisiones.propuestas[id] || 'pendiente';

  const propuestasOut = propuestas.map(p => {
    // La decisión de la orden es la de sus átomos, si todos dicen lo mismo.
    // Si no (se decidieron por separado y después la orden los juntó), la
    // orden queda sin decidir arriba y cada línea dice lo suyo abajo.
    const decsProp = atomosDe(p).map(decAtomo);
    const decProp = decsProp.every(d => d === decsProp[0]) ? decsProp[0] : 'pendiente';
    let nAcept = 0, nRech = 0, nPend = 0;
    let montoAcept = 0, montoOrigAcept = 0, montoRech = 0, montoPend = 0;
    let sinPrecioAcept = 0;

    const lineas = (p.lineas || []).map(l => {
      const clave = claveLinea(l);
      const ref = refLinea(p.id, clave);
      const atomosL = atomosDeLinea(p.id, l);
      // La corrección se busca primero en la orden y después en las órdenes
      // sueltas que eran sus entregas antes de juntarse: el proveedor, el
      // nombre o el precio que se le puso a noviembre siguen valiendo cuando
      // noviembre pasa a ser una entrega de la orden de octubre.
      let ed = esc.ediciones[ref] || null;
      if (!ed) for (const id of atomosL) { if (esc.ediciones[refLinea(id, clave)]) { ed = esc.ediciones[refLinea(id, clave)]; break; } }

      // La decisión, entrega por entrega. Si difieren, la línea NO se da por
      // aceptada: se entrega entera o no se entrega, y pedir la mitad de algo
      // porque dos decisiones viejas se juntaron es inventar una cantidad.
      const decsL = atomosL.map(id => esc.decisiones.lineas[refLinea(id, clave)] || decAtomo(id));
      const decisionMixta = !decsL.every(d => d === decsL[0]);
      const decision = decisionMixta ? 'pendiente' : decsL[0];
      const decisionPropia = atomosL.some(id => esc.decisiones.lineas[refLinea(id, clave)]);

      const cantidadOriginal = num(l.cantidad);
      const precioOriginal = l.precio_unitario == null ? null : num(l.precio_unitario);
      const montoOriginal = num(l.monto);

      // ¿La corrección se hizo en la unidad en que hoy sale la línea? Una
      // corrección de antes de la tanda 2.2 no trae la unidad: se hizo en la
      // del expediente. Si no coincide, NO se aplica — «164» en metros no son
      // 164 tubos — y la línea lo dice para que se vuelva a corregir.
      const tieneNumeros = !!(ed && (ed.cantidad != null || ed.precio_unitario != null));
      const unidadEd = ed && ed.unidad_edicion != null ? ed.unidad_edicion : (l.unidadExpediente ?? l.unidad);
      const edicionOtraUnidad = tieneNumeros && String(unidadEd || '') !== String(l.unidad || '');
      const edNum = edicionOtraUnidad ? null : ed;

      // ¿Y sobre las mismas entregas? (tanda 2.3). Una cantidad corregida
      // antes de la consolidación no trae la firma: se hizo sobre una sola
      // entrega, así que vale solo si la línea sigue teniendo una.
      const firma = firmaEntregas(l);
      const firmaEd = edNum && edNum.periodos_edicion != null
        ? String(edNum.periodos_edicion)
        : (Array.isArray(l.entregas) && l.entregas.length > 1 ? '(una sola entrega)' : firma);
      const edicionOtroAgrupamiento = !!(edNum && edNum.cantidad != null && firma && firmaEd !== firma);
      const cantEd = edNum && edNum.cantidad != null && !edicionOtroAgrupamiento ? num(edNum.cantidad) : null;

      const cantidad = cantEd != null ? cantEd : cantidadOriginal;
      const precio = edNum && edNum.precio_unitario != null ? num(edNum.precio_unitario) : precioOriginal;
      const editadaCant = cantEd != null && cantEd !== cantidadOriginal;
      const editadaPrec = !!(edNum && edNum.precio_unitario != null && edNum.precio_unitario !== precioOriginal);

      // El monto solo se recalcula si alguien tocó cantidad o precio. Si no,
      // manda el del expediente: `costo_presupuestado` no siempre es
      // cantidad × precio y pisarlo cambiaría el presupuesto sin que nadie
      // lo pidiera.
      const recalcula = editadaCant || editadaPrec;
      const montoConocido = recalcula ? precio != null : !!l.montoConocido;
      const monto = recalcula ? r2(cantidad * num(precio)) : montoOriginal;

      const out = {
        ...l,
        clave, ref,
        nombreOriginal: l.nombre,
        nombre: (ed && ed.nombre) ? ed.nombre : l.nombre,
        cantidad: r4(cantidad), cantidadOriginal: r4(cantidadOriginal),
        precio_unitario: precio == null ? null : r4(precio),
        precioOriginal: precioOriginal == null ? null : r4(precioOriginal),
        monto, montoOriginal: r2(montoOriginal),
        desvio: r2(monto - montoOriginal),
        montoConocido,
        proveedor_id: (ed && ed.proveedor_id) || null,
        proveedor_nombre: (ed && ed.proveedor_nombre) || '',
        nota: (ed && ed.nota) || '',
        editada: !!ed,
        // La unidad en que se había corregido, si ya no es la de la línea.
        edicionOtraUnidad: edicionOtraUnidad ? String(unidadEd || '') : null,
        // La cantidad corregida era para otras entregas: no se aplicó.
        edicionOtroAgrupamiento,
        // Con la cantidad tocada a mano, la tabla de entregas del plan ya no
        // suma lo que se pide: se sigue mostrando, pero no se entrega así.
        cantidadEditada: editadaCant,
        decision,
        decisionMixta,
        decisionHeredada: !decisionPropia,
      };

      resumen.lineas += 1;
      if (ed) resumen.lineasEditadas += 1;
      if (decisionMixta) resumen.lineasMixtas += 1;
      if (decision === 'aceptada') {
        nAcept += 1; montoAcept += monto; montoOrigAcept += montoOriginal;
        if (!montoConocido) { sinPrecioAcept += 1; resumen.lineasSinPrecio += 1; }
        if (!out.proveedor_id) resumen.lineasSinProveedor += 1;
      } else if (decision === 'rechazada') { nRech += 1; montoRech += monto; }
      else { nPend += 1; montoPend += monto; }
      return out;
    });

    const estado = nAcept && !nRech && !nPend ? 'aceptada'
      : nRech && !nAcept && !nPend ? 'rechazada'
        : nAcept || nRech ? 'parcial' : 'pendiente';

    if (estado === 'aceptada') resumen.ordenesAceptadas += 1;
    else if (estado === 'rechazada') resumen.ordenesRechazadas += 1;
    else if (estado === 'parcial') resumen.ordenesParciales += 1;
    else resumen.ordenesPendientes += 1;

    resumen.lineasAceptadas += nAcept;
    resumen.lineasRechazadas += nRech;
    resumen.lineasPendientes += nPend;
    resumen.montoAceptado += montoAcept;
    resumen.montoOriginalAceptado += montoOrigAcept;
    resumen.montoRechazado += montoRech;
    resumen.montoPendiente += montoPend;
    if (nAcept) periodosConAceptado.add(p.periodo);

    return {
      ...p,
      lineas,
      decision: decProp,
      estado,
      lineasAceptadas: nAcept, lineasRechazadas: nRech, lineasPendientes: nPend,
      montoAceptado: r2(montoAcept),
      montoOriginal: r2(p.monto),
      desvio: r2(montoAcept - montoOrigAcept),
      // El monto de la orden después de las correcciones, decida lo que
      // decida: es lo que se ve en el encabezado de la tarjeta.
      montoEditado: r2(lineas.reduce((s, l) => s + num(l.monto), 0)),
      lineasAceptadasSinPrecio: sinPrecioAcept,
      proveedores: [...new Set(lineas.filter(l => l.decision === 'aceptada' && l.proveedor_nombre)
        .map(l => l.proveedor_nombre))],
    };
  });

  const sobresOut = sobres.map(s => {
    const est = sobreDe(esc, s.clave);
    const lineas = est.lineas.map(l => ({ ...l, monto: r2(num(l.cantidad) * num(l.precio)) }));
    const usado = r2(lineas.reduce((t, l) => t + l.monto, 0));
    // `consumido` viene del motor y es null mientras nadie informe cuánto se
    // gastó ya del sobre (lo llena la tanda 4). El techo disponible se mide
    // contra lo que se SABE, no contra un cero supuesto.
    const baseDisponible = s.consumoInformado ? num(s.disponible) : num(s.techo);
    const restante = r2(baseDisponible - usado);
    if (est.decision === 'aceptada') {
      resumen.sobresAceptados += 1;
      resumen.montoSobresAceptado += usado;
      resumen.montoSobresTecho += num(s.techo);
      if (restante < -0.004) resumen.sobresExcedidos += 1;
    }
    return {
      ...s, ...est, lineas,
      usado, restante,
      excedido: restante < -0.004,
      // El techo que se está usando como referencia y si es firme o no. Sin
      // esto la pantalla no puede distinguir «te quedan S/ 80.000» de «te
      // quedarían S/ 80.000 si nadie hubiera gastado nada todavía».
      techoFirme: !!s.consumoInformado,
    };
  });

  resumen.periodosAceptados = [...periodosConAceptado].sort();
  for (const k of ['montoAceptado', 'montoRechazado', 'montoPendiente',
    'montoOriginalAceptado', 'montoSobresAceptado', 'montoSobresTecho']) {
    resumen[k] = r2(resumen[k]);
  }
  resumen.desvio = r2(resumen.montoAceptado - resumen.montoOriginalAceptado);
  resumen.montoAceptadoTotal = r2(resumen.montoAceptado + resumen.montoSobresAceptado);

  return { propuestas: propuestasOut, sobres: sobresOut, resumen };
}

/**
 * Lo aceptado, listo para que la tanda 4 lo convierta en requisición.
 *
 * Una línea aceptada SIN precio no sale de acá: una requisición con un monto
 * inventado es peor que una línea que falta, porque nadie la vuelve a mirar.
 * Salen aparte, en `sinPrecio`, para que la pantalla las reclame.
 */
export function lineasAceptadas({ propuestas = [], sobres = [] } = {}) {
  const listas = [], sinPrecio = [];
  for (const p of propuestas) {
    for (const l of (p.lineas || [])) {
      if (l.decision !== 'aceptada') continue;
      const fila = {
        propuesta_id: p.id, periodo: p.periodo, etiquetaPeriodo: p.etiquetaPeriodo,
        categoria: l.categoria, subcategoria: l.subcategoria,
        insumo_codigo: l.insumo_codigo || null, clave: l.clave,
        descripcion: l.nombre, unidad: l.unidad,
        cantidad: l.cantidad, precio_unitario: l.precio_unitario, monto: l.monto,
        // Cuántas unidades del expediente trae cada unidad pedida (tanda 2.2).
        // Viaja a la requisición como `factor_presupuesto`: sin él, la corrida
        // siguiente restaría «28 tubos» de los metros del presupuesto.
        factor: num(l.factor) > 0 ? num(l.factor) : 1,
        unidadExpediente: l.unidadExpediente || l.unidad,
        proveedor_id: l.proveedor_id || null, proveedor_nombre: l.proveedor_nombre || '',
        partidas: l.partidas || [], nota: l.nota || '',
        // Cuándo se entrega cada parte (tanda 2.3). Con la cantidad corregida
        // a mano la tabla del plan ya no suma lo pedido: va `null` y la
        // requisición dice que las entregas se coordinan, en vez de escribir
        // un cronograma que no cierra con la cantidad.
        entregas: (l.cantidadEditada || !Array.isArray(l.entregas)) ? null
          : l.entregas.map(e => ({ periodo: e.periodo, etiquetaPeriodo: e.etiquetaPeriodo, cantidad: e.cantidad })),
        periodos: p.periodos || [p.periodo],
        etiquetaVentana: p.etiquetaVentana || p.etiquetaPeriodo,
        origen: 'simulador',
      };
      if (!l.montoConocido) sinPrecio.push(fila); else listas.push(fila);
    }
  }
  for (const s of sobres) {
    if (s.decision !== 'aceptada') continue;
    for (const l of (s.lineas || [])) {
      if (!String(l.descripcion || '').trim()) continue;
      listas.push({
        propuesta_id: `sobre:${s.clave}`,
        periodo: s.porPeriodo?.[0]?.periodo || null,
        etiquetaPeriodo: s.porPeriodo?.[0]?.etiquetaPeriodo || '',
        categoria: s.categoria, subcategoria: s.subcategoria,
        insumo_codigo: null, clave: `${s.clave}|${l.id}`,
        descripcion: l.descripcion, unidad: l.unidad,
        cantidad: num(l.cantidad), precio_unitario: num(l.precio), monto: num(l.monto),
        factor: 1, unidadExpediente: l.unidad,
        proveedor_id: s.proveedor_id || null, proveedor_nombre: s.proveedor_nombre || '',
        partidas: [], nota: `Contra el sobre «${s.nombre}» (techo S/ ${s.techo})`,
        origen: 'simulador_sobre', sobre: s.clave,
      });
    }
  }
  return { lineas: listas, sinPrecio };
}

// ═══════════════════════════════════════════════════════════════════
// PERSISTENCIA (localStorage, por obra)
//
// No es una tabla y no se sincroniza: un escenario es un borrador de una
// persona, no un hecho de la obra. Lo que sí queda en la base es lo que la
// tanda 4 escriba cuando se convierta en requisición.
// ═══════════════════════════════════════════════════════════════════

const almacen = (storage) => {
  if (storage) return storage;
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
};

export const claveStorage = (obraId) => `${STORAGE_PREFIX}:${obraId || 'sin_obra'}`;

/** Los escenarios guardados de una obra, del más nuevo al más viejo. */
export function leerEscenarios(obraId, storage = null) {
  const st = almacen(storage);
  if (!st) return [];
  try {
    const crudo = st.getItem(claveStorage(obraId));
    if (!crudo) return [];
    const arr = JSON.parse(crudo);
    if (!Array.isArray(arr)) return [];
    return arr.map(e => normalizarEscenario(e, { obraId }))
      .sort((a, b) => (a.actualizado < b.actualizado ? 1 : a.actualizado > b.actualizado ? -1 : 0));
  } catch {
    // Un JSON roto no puede dejar la pantalla muerta: se arranca de cero.
    return [];
  }
}

export function guardarEscenarios(obraId, lista, storage = null) {
  const st = almacen(storage);
  if (!st) return false;
  try {
    st.setItem(claveStorage(obraId), JSON.stringify((lista || []).map(e => normalizarEscenario(e, { obraId }))));
    return true;
  } catch { return false; }
}

/** Inserta o reemplaza un escenario en la lista de esa obra. */
export function guardarEscenario(obraId, escenario, storage = null) {
  const lista = leerEscenarios(obraId, storage);
  const e = normalizarEscenario({ ...escenario, obra_id: obraId }, { obraId });
  const i = lista.findIndex(x => x.id === e.id);
  if (i >= 0) lista[i] = e; else lista.unshift(e);
  guardarEscenarios(obraId, lista, storage);
  return lista;
}

export function borrarEscenario(obraId, escenarioId, storage = null) {
  const lista = leerEscenarios(obraId, storage).filter(e => e.id !== escenarioId);
  guardarEscenarios(obraId, lista, storage);
  return lista;
}

// ═══════════════════════════════════════════════════════════════════
// CÓMO SE COMPRA CADA INSUMO (tanda 2.2) — por OBRA, no por escenario
//
// Que el tubo de 8" venga de 6 m, que la arena se pida de a 1 m³ o que el
// cemento lleve un 3% de colchón no es una hipótesis que se compara entre
// escenarios: es cómo se compra ese insumo en esa obra. Guardarlo adentro de
// cada escenario obligaría a volver a cargarlo en cada «Guardar como…», y dos
// escenarios con factores distintos para el mismo tubo no comparan nada.
//
// Mismo criterio de persistencia que los escenarios: es un borrador de una
// persona, vive en el localStorage y no justifica una tabla sincronizada. Lo
// que sí llega a la base es el factor de cada línea que se convierte en
// requisición (`requisicion_items.factor_presupuesto`, mig 228).
// ═══════════════════════════════════════════════════════════════════

export const claveStorageCompras = (obraId) => `${STORAGE_PREFIX}:compras:${obraId || 'sin_obra'}`;

/** clave de línea → `{unidadCompra, factor, lote, colchonPct}` de esa obra. */
export function leerCompras(obraId, storage = null) {
  const st = almacen(storage);
  if (!st) return {};
  try {
    const obj = JSON.parse(st.getItem(claveStorageCompras(obraId)) || '{}');
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const n = normalizarCompra(v);
      if (Object.keys(n).length) out[k] = n;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Cambia cómo se compra UN insumo. `null` en un campo lo devuelve al default
 * (lo que dice el nombre, o la unidad del expediente; lote 1; colchón 0%).
 * `unidadCompra` y `factor` se borran juntos: uno sin el otro no se puede
 * leer.
 */
export function guardarCompra(obraId, clave, patch = {}, storage = null) {
  const todas = leerCompras(obraId, storage);
  const actual = { ...(todas[clave] || {}) };
  for (const [campo, valor] of Object.entries(patch || {})) {
    if (valor === null || valor === undefined || valor === '') {
      delete actual[campo];
      if (campo === 'factor') delete actual.unidadCompra;
      if (campo === 'unidadCompra') delete actual.factor;
    } else actual[campo] = valor;
  }
  const n = normalizarCompra(actual);
  if (Object.keys(n).length) todas[clave] = n; else delete todas[clave];
  const st = almacen(storage);
  if (st) {
    try { st.setItem(claveStorageCompras(obraId), JSON.stringify(todas)); } catch { /* lleno o bloqueado */ }
  }
  return todas;
}
