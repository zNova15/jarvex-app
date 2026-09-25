// ═══════════════════════════════════════════════════════════════════
// JARVEX — SIMULADOR DE ÓRDENES: DE DÓNDE SALEN LAS FECHAS (ronda 3).
//
// Diseño en `docs/plan-simulador-ordenes.md` §15. El motor de órdenes ya
// acepta `reprogramacion` (partida_id → {inicio, fin}) y cae al Gantt para
// las partidas que no vengan ahí. Esta lib es un GENERADOR de ese dato: no
// toca el motor.
//
// Tanda 3.1 — el ARRANQUE en modo Simulación (decisión de Gabriel del
// 24-set, §15.3): «además de las fechas del expediente se puede elegir
// "como si empezara hoy" o una fecha; se corre el cronograma entero». Es un
// corrimiento rígido: todas las partidas y el plazo se mueven los mismos
// días, así que la forma del Gantt (qué va antes, cuánto dura cada cosa y el
// plazo total) queda idéntica.
//
// Tanda 3.3 — el cronograma ALEATORIO POR ESCENARIO (§15.2 C y D): otro
// generador del mismo `reprogramacion`, más el `repartoManual` que usa el
// reparto «según el escenario», y la curva de carga que lo hace legible. Ver
// el bloque de más abajo.
//
// Testeado en __tests__/simulador-cronograma.test.js
// ═══════════════════════════════════════════════════════════════════

import {
  periodosEntre, rangoDePeriodo, mesDePeriodo, etiquetaPeriodo,
} from './simulador-ordenes.js';
import { hoyLocal } from './fecha.js';

const DIA_MS = 86400000;
const esYmd = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);

// En UTC a propósito: con la hora local, un cambio de horario o el huso de
// Lima corren el día y el Gantt se desplaza uno de más.
const aDia = (ymd) => {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DIA_MS;
};
const deDia = (n) => new Date(n * DIA_MS).toISOString().slice(0, 10);
const sumarDias = (ymd, dias) => deDia(aDia(ymd) + dias);

/**
 * El primer día del Gantt: el inicio del plazo del trabajo si lo tiene, si no
 * la partida que arranca primero. Es contra esto que se mide el corrimiento.
 */
export function inicioDelCronograma({ partidas = [], plazo = null } = {}) {
  if (esYmd(plazo?.inicio)) return String(plazo.inicio).slice(0, 10);
  let min = null;
  for (const p of partidas) {
    if (!p || p.deleted_at || !esYmd(p.fecha_inicio_planificada)) continue;
    const f = String(p.fecha_inicio_planificada).slice(0, 10);
    if (!min || f < min) min = f;
  }
  return min;
}

/**
 * Corre el cronograma entero para que la obra arranque en otra fecha.
 *
 * @param {Object} o
 * @param {Array}  o.partidas
 * @param {Object} [o.plazo]          {inicio, fin} del trabajo.
 * @param {'gantt'|'hoy'|'fecha'} [o.arranque='gantt']
 * @param {string} [o.arranqueFecha]  'YYYY-MM-DD', solo con arranque 'fecha'.
 * @param {string} o.hoy              'YYYY-MM-DD'.
 *
 * @returns {{activo:boolean, deltaDias:number, inicioOriginal:string|null,
 *            inicioNuevo:string|null, reprogramacion:Object, plazo:Object|null,
 *            motivo?:string}}
 *          Con `activo:false` el caller corre el Gantt tal cual. `motivo`
 *          dice por qué no se corrió cuando se pidió correrlo.
 */
export function desplazarCronograma({ partidas = [], plazo = null, arranque = 'gantt', arranqueFecha = null, hoy } = {}) {
  const inicioOriginal = inicioDelCronograma({ partidas, plazo });
  const quieto = (motivo) => ({
    activo: false, deltaDias: 0, inicioOriginal, inicioNuevo: inicioOriginal,
    reprogramacion: {}, plazo, ...(motivo ? { motivo } : {}),
  });

  if (arranque !== 'hoy' && arranque !== 'fecha') return quieto();
  const destino = arranque === 'hoy' ? hoy : arranqueFecha;
  if (!esYmd(destino)) return quieto('sin_fecha');
  if (!inicioOriginal) return quieto('sin_cronograma');

  const deltaDias = aDia(destino) - aDia(inicioOriginal);
  if (deltaDias === 0) return quieto();

  const reprogramacion = {};
  for (const p of partidas) {
    if (!p || p.deleted_at || !p.id || !esYmd(p.fecha_inicio_planificada)) continue;
    const ini = String(p.fecha_inicio_planificada).slice(0, 10);
    const fin = esYmd(p.fecha_fin_planificada) ? String(p.fecha_fin_planificada).slice(0, 10) : ini;
    reprogramacion[p.id] = { inicio: sumarDias(ini, deltaDias), fin: sumarDias(fin, deltaDias) };
  }

  const plazoNuevo = plazo ? {
    ...plazo,
    inicio: esYmd(plazo.inicio) ? sumarDias(plazo.inicio, deltaDias) : plazo.inicio,
    fin: esYmd(plazo.fin) ? sumarDias(plazo.fin, deltaDias) : plazo.fin,
  } : null;

  return {
    activo: true, deltaDias, inicioOriginal,
    inicioNuevo: sumarDias(inicioOriginal, deltaDias),
    reprogramacion, plazo: plazoNuevo,
  };
}

export const MOTIVO_SIN_DESPLAZAR_LABEL = {
  sin_fecha: 'Falta elegir la fecha de arranque: mientras tanto se usan las fechas del Gantt.',
  sin_cronograma: 'El trabajo no tiene plazo ni partidas con fecha: no hay cronograma que correr.',
};

// ═══════════════════════════════════════════════════════════════════
// TANDA 3.3 — EL CRONOGRAMA «ALEATORIO POR ESCENARIO» (§15.2 C, §15.3)
//
// «Reprogramado a mano» pedía fechar 1.718 partidas y nadie lo iba a hacer.
// Gabriel pidió que esa opción fuera ALEATORIO POR ESCENARIO: no fechas al
// azar, sino un cronograma plausible armado sobre una HISTORIA de la obra
// («arranca con buena caja, en los meses intermedios no pagan y se baja la
// marcha, después pagan y se acelera al final») y que diga qué historia tomó.
//
// ── EL FRENTE DE OBRA ─────────────────────────────────────────────
// Una historia es una curva de RITMO por tramos del plazo: 100 % es el ritmo
// del Gantt, 55 % es que en un mes se hace lo que el Gantt hacía en medio. Con
// esa curva se arma el FRENTE: para cada día del escenario (t), hasta qué día
// del Gantt (τ) llegó la obra. Con ritmo 100 % todo el plazo, el frente es la
// identidad y el escenario es el Gantt.
//
// Cada partida arranca el día en que el frente llega a su inicio del Gantt y
// termina el día en que llega a su fin. Como TODAS se leen contra el mismo
// frente, lo que empezaba antes sigue empezando antes — el orden del Gantt se
// respeta sin tener que mirarlo partida por partida.
//
// ¿Y las predecesoras? `partidas.predecesoras` trae 1.158 textos estilo MS
// Project en Miraflores («1462;1477», «915CC», «187FC+5 días»), pero los
// números NO resuelven contra las partidas: 219 de 881 referencias no existen
// y, de las que resuelven por `orden`, 262 «fin-comienzo» contradicen las
// fechas del propio Gantt (medido el 24-set-2026). No se pueden usar. El
// orden del Gantt sigue siendo el mejor proxy, como decía el §15.2.
//
// ── EL FIN DE OBRA SE RESPETA (Gabriel, §15.3) ─────────────────────
// El ritmo del último tramo (o de los tramos marcados `ritmo: null`) NO es
// un dato de la historia: se calcula para que el frente llegue al fin del
// plazo el último día. Lo que un frenazo atrasa se recupera acelerando. Solo
// una historia EXPLÍCITA del catálogo (`atraso_todo`, «pagos atrasados todo
// el plazo») estira el fin, y el resultado lo dice (`estira`, `finNuevo`).
//
// ── LAS PARTIDAS CARAS ESPERAN (§15.2 C) ────────────────────────────
// «Cuando la caja aprieta, sigue con las partidas de menor costo por día y
// posterga las caras.» Las caras tienen su PROPIO frente: quieto mientras
// dura un tramo de caja apretada, y que alcanza al general al final del
// siguiente tramo con plata. Una cara que tocaba arrancar durante el frenazo
// arranca cuando vuelve la plata; lo que no es caro sigue al frente general.
// Las caras nunca arrancan ANTES que en el frente general, y terminan a tiempo
// porque los dos frentes llegan juntos al fin.
//
// «Cara» se mide contra la propia obra, no con un número de oficio: las
// partidas de más costo por día que juntas suman `cuotaCaras` de la plata. En
// Miraflores, el 30 % de la plata son 13 partidas (más de S/ 6.893 por día) y
// el 50 % son 47 (más de S/ 3.025). La pantalla muestra el umbral en soles.
//
// ── LA SEMILLA ─────────────────────────────────────────────────────
// Cada historia tiene RANGOS para cada perilla (cuándo empieza el frenazo,
// cuánto dura, a qué ritmo). La semilla elige un valor de cada rango: el
// mismo escenario da siempre el mismo cronograma, y «🎲 Otro» cambia la
// semilla — con «Al azar» sortea otra historia; con una elegida, varía su
// intensidad dentro de los rangos. Los rangos están armados para que el
// cierre calculado nunca pase del 160 % ni baje del 50 % (hay un test que
// barre todas las esquinas).
//
// ── LA IA NUNCA PONE UNA FECHA (tanda 3.4) ──────────────────────────
// Lo que la IA puede elegir es un id del catálogo y valores dentro de los
// rangos (`ajustes`). Un id fuera de la lista se descarta; un valor fuera de
// rango se recorta al rango. Las fechas las pone siempre esta lib.
// ═══════════════════════════════════════════════════════════════════

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const redondear = (n, d = 2) => { const f = 10 ** d; return Math.round((num(n) + Number.EPSILON) * f) / f; };
const vivas = (arr) => (Array.isArray(arr) ? arr.filter(x => x && !x.deleted_at) : []);

export const HISTORIA_AZAR = 'azar';

/** Ningún tramo (fijo o calculado) puede quedar fuera de esto. */
export const RITMO_MIN = 0.3;
export const RITMO_MAX = 2;

/**
 * El catálogo CERRADO de historias. Cada una:
 *   · `rangos`: las perillas que la semilla (o la IA) elige, con su paso;
 *   · `tramos(v)`: la curva de ritmo, en fracciones del plazo del escenario
 *     (`hasta` crece hasta 1). `ritmo: null` = se calcula para cerrar en fecha.
 *     `caja: 'apretada'` = las caras esperan (si hay plata más adelante).
 *   · `estira: true` solo en la que mueve el fin.
 */
export const HISTORIAS = [
  {
    id: 'frenazo',
    etiqueta: 'Frenazo a mitad de obra',
    icono: '🛑',
    resumen: 'Arranca con buena caja; a mitad de obra se atrasan los pagos y se baja la marcha; cuando pagan, se acelera para terminar en fecha.',
    rangos: {
      inicio: { min: 0.25, max: 0.40, paso: 0.05, que: 'cuándo empieza el frenazo (fracción del plazo)' },
      duracion: { min: 0.20, max: 0.30, paso: 0.05, que: 'cuánto dura el frenazo (fracción del plazo)' },
      ritmo: { min: 0.45, max: 0.70, paso: 0.05, que: 'ritmo durante el frenazo (1 = el del Gantt)' },
      cuotaCaras: { min: 0.30, max: 0.50, paso: 0.05, que: 'qué parte de la plata cuenta como partidas caras' },
    },
    tramos: (v) => [
      { hasta: v.inicio, ritmo: 1, caja: 'normal', nombre: 'Arranque al ritmo del Gantt' },
      { hasta: v.inicio + v.duracion, ritmo: v.ritmo, caja: 'apretada', nombre: 'Frenazo: no pagan' },
      { hasta: 1, ritmo: null, caja: 'normal', nombre: 'Pagan: se recupera' },
    ],
  },
  {
    id: 'arranque_lento',
    etiqueta: 'Arranque lento',
    icono: '🐢',
    resumen: 'El adelanto no llega a tiempo (o los permisos, o la movilización): los primeros meses se avanza despacio y después hay que recuperar.',
    rangos: {
      hasta: { min: 0.15, max: 0.30, paso: 0.05, que: 'hasta dónde dura el arranque lento (fracción del plazo)' },
      ritmo: { min: 0.40, max: 0.70, paso: 0.05, que: 'ritmo del arranque (1 = el del Gantt)' },
      cuotaCaras: { min: 0.30, max: 0.50, paso: 0.05, que: 'qué parte de la plata cuenta como partidas caras' },
    },
    tramos: (v) => [
      { hasta: v.hasta, ritmo: v.ritmo, caja: 'apretada', nombre: 'Arranque lento' },
      { hasta: 1, ritmo: null, caja: 'normal', nombre: 'Llega la plata: se recupera' },
    ],
  },
  {
    id: 'tirones',
    etiqueta: 'Pagos a los tirones',
    icono: '📶',
    resumen: 'Cada valorización se paga tarde: la obra se frena unas semanas cada vez y retoma cuando entra la plata, un poco más rápido para no quedar atrás.',
    rangos: {
      cortes: { min: 2, max: 3, paso: 1, que: 'cuántas veces se corta la plata' },
      duracion: { min: 0.06, max: 0.10, paso: 0.01, que: 'cuánto dura cada corte (fracción del plazo)' },
      ritmo: { min: 0.30, max: 0.60, paso: 0.05, que: 'ritmo durante cada corte (1 = el del Gantt)' },
      cuotaCaras: { min: 0.30, max: 0.50, paso: 0.05, que: 'qué parte de la plata cuenta como partidas caras' },
    },
    tramos: (v) => {
      const n = Math.round(v.cortes);
      const out = [];
      for (let k = 1; k <= n; k += 1) {
        const centro = k / (n + 1);
        out.push({ hasta: centro - v.duracion / 2, ritmo: k === 1 ? 1 : null, caja: 'normal', nombre: k === 1 ? 'Arranque al ritmo del Gantt' : 'Entra la plata: retoma' });
        out.push({ hasta: centro + v.duracion / 2, ritmo: v.ritmo, caja: 'apretada', nombre: `Corte ${k}: la valorización no se paga` });
      }
      out.push({ hasta: 1, ritmo: null, caja: 'normal', nombre: 'Entra la plata: cierre' });
      return out;
    },
  },
  {
    id: 'adelantada',
    etiqueta: 'Obra adelantada',
    icono: '🚀',
    resumen: 'Se entra fuerte al principio para no amontonar el final: los primeros meses se avanza más rápido que el Gantt y el cierre queda holgado.',
    rangos: {
      hasta: { min: 0.30, max: 0.50, paso: 0.05, que: 'hasta dónde dura el arranque fuerte (fracción del plazo)' },
      ritmo: { min: 1.20, max: 1.50, paso: 0.05, que: 'ritmo del arranque fuerte (1 = el del Gantt)' },
    },
    tramos: (v) => [
      { hasta: v.hasta, ritmo: v.ritmo, caja: 'normal', nombre: 'Arranque fuerte' },
      { hasta: 1, ritmo: null, caja: 'normal', nombre: 'Cierre holgado' },
    ],
  },
  {
    id: 'cierre_apurado',
    etiqueta: 'Todo para el final',
    icono: '⏰',
    resumen: 'La obra va tranquila la mayor parte del plazo y se aprieta en los últimos meses para llegar.',
    rangos: {
      hasta: { min: 0.55, max: 0.70, paso: 0.05, que: 'hasta dónde va tranquila (fracción del plazo)' },
      ritmo: { min: 0.80, max: 0.90, paso: 0.05, que: 'ritmo de la marcha tranquila (1 = el del Gantt)' },
    },
    tramos: (v) => [
      { hasta: v.hasta, ritmo: v.ritmo, caja: 'normal', nombre: 'Marcha tranquila' },
      { hasta: 1, ritmo: null, caja: 'normal', nombre: 'Cierre apurado' },
    ],
  },
  {
    id: 'atraso_todo',
    etiqueta: 'Pagos atrasados todo el plazo',
    icono: '📉',
    estira: true,
    resumen: 'Los pagos llegan tarde de principio a fin y la obra no alcanza a recuperar: avanza más lento todo el tiempo y el fin se estira. Es la única historia que mueve la fecha de fin.',
    rangos: {
      ritmo: { min: 0.70, max: 0.90, paso: 0.05, que: 'ritmo de toda la obra (1 = el del Gantt)' },
    },
    tramos: (v) => [
      { hasta: 1, ritmo: v.ritmo, caja: 'apretada', nombre: 'Todo el plazo, más lento' },
    ],
  },
];

export const HISTORIA_IDS = HISTORIAS.map(h => h.id);
export const HISTORIA_POR_ID = new Map(HISTORIAS.map(h => [h.id, h]));

export const MOTIVO_SIN_HISTORIA_LABEL = {
  sin_cronograma: 'El trabajo no tiene plazo ni partidas con fecha: no hay cronograma sobre el cual contar una historia.',
  plazo_vencido: 'La obra ya pasó su fecha de fin: no queda plazo por delante para contar una historia. Se usan las fechas del Gantt.',
  historia_imposible: 'Con esos valores el cierre tendría que ir a un ritmo imposible. Se usan las fechas del Gantt.',
};

// ── Semilla ───────────────────────────────────────────────────────

/** Una semilla válida: entero de 1 a 2.147.483.647. Cualquier otra cosa es 1. */
export function semillaValida(s) {
  const n = Math.floor(Number(s));
  return Number.isFinite(n) && n >= 1 && n <= 2147483647 ? n : 1;
}

// FNV-1a de 32 bits + mulberry32: chico, determinístico y sin dependencias.
// No es criptográfico ni hace falta: solo tiene que dar lo mismo dos veces.
function hashTexto(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function generador(texto) {
  let a = hashTexto(texto);
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Un valor dentro de un rango, pegado a su paso. Null si no es un número. */
function alRango(v, { min, max, paso }) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const c = Math.min(max, Math.max(min, n));
  return redondear(min + Math.round((c - min) / paso) * paso, 4);
}

/**
 * Qué historia cuenta el escenario. Un id del catálogo manda; «al azar» (o un
 * id que ya no existe) la sortea con la semilla.
 */
export function elegirHistoria(historiaId, semilla = 1) {
  if (HISTORIA_POR_ID.has(historiaId)) return HISTORIA_POR_ID.get(historiaId);
  const rnd = generador(`${semillaValida(semilla)}|${HISTORIA_AZAR}`);
  return HISTORIAS[Math.min(HISTORIAS.length - 1, Math.floor(rnd() * HISTORIAS.length))];
}

/**
 * Los valores de las perillas de una historia: los sortea la semilla y los
 * pisan los `ajustes` que vengan (recortados al rango). La semilla se sortea
 * con el id de la historia, así «al azar» con la semilla 7 da exactamente lo
 * mismo que elegir a mano la historia que salió con la semilla 7.
 */
export function valoresDeHistoria(historia, semilla = 1, ajustes = null) {
  const rnd = generador(`${semillaValida(semilla)}|${historia.id}`);
  const valores = {};
  const ajustados = [];
  for (const [clave, rango] of Object.entries(historia.rangos)) {
    // El sorteo se hace SIEMPRE, aunque un ajuste lo pise: si no, ajustar una
    // perilla cambiaría lo que la semilla le da a las siguientes.
    const pasos = Math.round((rango.max - rango.min) / rango.paso);
    const sorteado = redondear(rango.min + Math.min(pasos, Math.floor(rnd() * (pasos + 1))) * rango.paso, 4);
    const pedido = alRango(ajustes?.[clave], rango);
    if (pedido != null) { valores[clave] = pedido; ajustados.push(clave); } else valores[clave] = sorteado;
  }
  return { valores, ajustados };
}

/**
 * Los ajustes guardables de una historia: solo perillas que existen, dentro
 * de su rango. Con «al azar» no hay ajustes (no se sabe de qué historia).
 */
export function normalizarAjustesHistoria(historiaId, ajustes) {
  const h = HISTORIA_POR_ID.get(historiaId);
  if (!h || !ajustes || typeof ajustes !== 'object') return {};
  const out = [];
  for (const [clave, rango] of Object.entries(h.rangos)) {
    const v = alRango(ajustes[clave], rango);
    if (v != null) out.push([clave, v]);
  }
  return Object.fromEntries(out);
}

// ── El frente ─────────────────────────────────────────────────────
// Un frente es una lista de puntos [t, τ] (días como números, continuos),
// no decreciente, con interpolación lineal y pendiente 1 fuera de los
// extremos: antes de la historia y después de ella el escenario va al ritmo
// del Gantt.

/** τ(t): hasta qué día del Gantt llegó la obra el día t del escenario. */
export function evaluarFrente(frente, t) {
  if (!frente?.length) return t;
  if (t <= frente[0][0]) return frente[0][1] - (frente[0][0] - t);
  for (let i = 1; i < frente.length; i += 1) {
    const [t1, y1] = frente[i];
    if (t <= t1) {
      const [t0, y0] = frente[i - 1];
      return t1 === t0 ? y1 : y0 + ((y1 - y0) * (t - t0)) / (t1 - t0);
    }
  }
  const [tl, yl] = frente[frente.length - 1];
  return yl + (t - tl);
}

/** t(τ): el PRIMER día del escenario en que la obra llega al día τ del Gantt. */
export function invertirFrente(frente, tau) {
  if (!frente?.length) return tau;
  if (tau <= frente[0][1]) return frente[0][0] - (frente[0][1] - tau);
  for (let i = 1; i < frente.length; i += 1) {
    const [t1, y1] = frente[i];
    if (tau <= y1) {
      const [t0, y0] = frente[i - 1];
      return y1 === y0 ? t0 : t0 + ((t1 - t0) * (tau - y0)) / (y1 - y0);
    }
  }
  const [tl, yl] = frente[frente.length - 1];
  return tl + (tau - yl);
}

/**
 * Los dos frentes de una historia sobre la ventana [desde, fin].
 * @returns {{D0, D1, finDia, cierre, tramos, frente, frenteCaras}|{error}}
 */
export function frentesDeHistoria(historia, valores, { desde, fin }) {
  const D0 = aDia(desde);
  const D1 = aDia(fin) + 1;          // fin continuo: el día `fin` entero cuenta
  const L = D1 - D0;

  const secs = [];
  let prev = 0, fijo = 0, libre = 0;
  for (const tr of historia.tramos(valores)) {
    const hasta = Math.min(1, Math.max(prev, num(tr.hasta)));
    if (hasta - prev > 1e-9) {
      secs.push({ ...tr, a: prev, b: hasta });
      if (tr.ritmo == null) libre += hasta - prev; else fijo += tr.ritmo * (hasta - prev);
    }
    prev = hasta;
  }
  if (prev < 1 - 1e-9) {            // una historia mal cerrada no deja un hueco
    secs.push({ hasta: 1, ritmo: null, caja: 'normal', nombre: 'Cierre', a: prev, b: 1 });
    libre += 1 - prev;
  }

  let cierre = null;
  let Lt = L;                        // largo del escenario, en días
  if (historia.estira) {
    if (libre > 1e-9 || !(fijo >= RITMO_MIN && fijo <= 1)) return { error: 'historia_imposible' };
    Lt = L / fijo;
  } else if (libre > 1e-9) {
    cierre = (1 - fijo) / libre;
    if (!(cierre >= RITMO_MIN && cierre <= RITMO_MAX)) return { error: 'historia_imposible', cierre };
  } else if (Math.abs(fijo - 1) > 1e-6) {
    return { error: 'historia_imposible' };
  }

  const tramos = [];
  const frente = [[D0, D0]];
  let tau = D0;
  for (const s of secs) {
    const ritmo = s.ritmo == null ? cierre : s.ritmo;
    const t0 = D0 + s.a * Lt, t1 = D0 + s.b * Lt;
    tau += ritmo * (t1 - t0);
    frente.push([t1, tau]);
    tramos.push({ t0, t1, ritmo, calculado: s.ritmo == null, caja: s.caja || 'normal', nombre: s.nombre || '' });
  }
  // Exacto: la historia llega al fin prometido (o al estirado) sin el error de
  // coma flotante de sumar tramos.
  frente[frente.length - 1][1] = D1;

  // El frente de las caras: quieto en cada tramo de caja apretada que tenga
  // plata más adelante, y alcanzando al general al final del tramo siguiente.
  const plataDespues = (k) => tramos.slice(k + 1).some(t => t.caja !== 'apretada');
  let frenteCaras = null;
  if (tramos.some((t, k) => t.caja === 'apretada' && plataDespues(k))) {
    frenteCaras = [[D0, D0]];
    let tauE = D0;
    tramos.forEach((t, k) => {
      if (t.caja === 'apretada' && plataDespues(k)) {
        frenteCaras.push([t.t1, tauE]);
        t.carasEsperan = true;
      } else {
        tauE = frente[k + 1][1];
        frenteCaras.push([t.t1, tauE]);
      }
    });
  }

  return { D0, D1, finDia: D0 + Lt, cierre, tramos, frente, frenteCaras };
}

// ── Las fechas de partida de las que se parte ─────────────────────

/** partida_id → {s, e} en días: el corrimiento del arranque si lo hay, si no el Gantt. */
function fechasBase(partidas, base) {
  const out = new Map();
  for (const p of vivas(partidas)) {
    if (!p.id) continue;
    const b = base?.[p.id];
    const ini = b?.inicio || p.fecha_inicio_planificada;
    if (!esYmd(ini)) continue;
    const fin = b ? (b.fin || b.inicio) : (p.fecha_fin_planificada || ini);
    const s = aDia(ini);
    const e = esYmd(fin) ? Math.max(s, aDia(fin)) : s;
    out.set(p.id, { s, e });
  }
  return out;
}

/**
 * Las partidas CARAS: las de más costo por día que juntas suman `cuota` de la
 * plata de la obra. El costo es el de sus insumos (todos: la planilla también
 * es caja) y los días, los de su tramo en el Gantt.
 */
export function clasificarCaras({ fechas, insumosPartida = [], cuota = 0 }) {
  const costo = new Map();
  for (const ip of vivas(insumosPartida)) {
    if (!ip.partida_id) continue;
    const m = ip.costo_presupuestado != null
      ? num(ip.costo_presupuestado)
      : num(ip.cantidad_presupuestada) * num(ip.precio_presupuestado);
    if (m > 0) costo.set(ip.partida_id, (costo.get(ip.partida_id) || 0) + m);
  }
  const filas = [];
  let total = 0;
  for (const [id, { s, e }] of fechas) {
    const c = costo.get(id) || 0;
    if (c <= 0) continue;
    filas.push({ id, c, cd: c / (e - s + 1) });
    total += c;
  }
  if (!filas.length || !(cuota > 0)) return { ids: new Set(), umbralDia: null, monto: 0, total, costo };
  filas.sort((a, b) => (b.cd - a.cd) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let acum = 0, umbral = filas[0].cd;
  for (const f of filas) {
    acum += f.c;
    umbral = f.cd;
    if (acum >= cuota * total - 1e-6) break;
  }
  const ids = new Set();
  let monto = 0;
  for (const f of filas) if (f.cd >= umbral) { ids.add(f.id); monto += f.c; }
  return { ids, umbralDia: umbral, monto, total, costo };
}

const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];
/** '2026-07-13' → '13 jul 2026'. */
export function fechaCorta(ymd) {
  if (!esYmd(ymd)) return '';
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  return `${d} ${MES_CORTO[m - 1]} ${y}`;
}
const pct = (r) => `${Math.round(num(r) * 100)} %`;
const soles = (n) => `S/ ${Math.round(num(n)).toLocaleString('es-PE')}`;

/**
 * El cronograma de un escenario contado por una historia.
 *
 * @param {Object} o
 * @param {Array}  o.partidas
 * @param {Array}  [o.insumosPartida]  para medir qué partidas son caras.
 * @param {Object} [o.plazo]           {inicio, fin} ya corrido por el arranque.
 * @param {Object} [o.base]            partida_id → {inicio, fin} de partida (el
 *                                     corrimiento del arranque); si falta, el Gantt.
 * @param {string} [o.historia='azar'] id del catálogo o 'azar'.
 * @param {number} [o.semilla=1]
 * @param {Object} [o.ajustes]         perillas que pisan el sorteo (tanda 3.4).
 * @param {string} [o.desde]           desde cuándo corre la historia (modo real:
 *                                     hoy). Antes de eso, el Gantt tal cual.
 *
 * @returns {{activo:boolean, motivo?:string, historia?:Object, azar?:boolean,
 *   semilla?:number, valores?:Object, ajustados?:Array, inicio?:string,
 *   fin?:string, finNuevo?:string, estira?:boolean, diasEstirados?:number,
 *   tramos?:Array, cierre?:number|null, caras?:Object|null,
 *   reprogramacion:Object, plazo:Object|null, relato?:Array<string>,
 *   frente?:Array, frenteCaras?:Array|null, carasIds?:Set}}
 */
export function cronogramaPorEscenario({
  partidas = [], insumosPartida = [], plazo = null, base = null,
  historia = HISTORIA_AZAR, semilla = 1, ajustes = null, desde = null,
} = {}) {
  const sem = semillaValida(semilla);
  const azar = !HISTORIA_POR_ID.has(historia);
  const h = elegirHistoria(historia, sem);
  const quieto = (motivo) => ({
    activo: false, motivo, historia: infoHistoria(h), azar, semilla: sem,
    reprogramacion: {}, plazo,
  });

  const fechas = fechasBase(partidas, base);
  let inicio = esYmd(plazo?.inicio) ? String(plazo.inicio).slice(0, 10) : null;
  let fin = esYmd(plazo?.fin) ? String(plazo.fin).slice(0, 10) : null;
  if (!inicio || !fin) {
    let lo = null, hi = null;
    for (const { s, e } of fechas.values()) {
      if (lo == null || s < lo) lo = s;
      if (hi == null || e > hi) hi = e;
    }
    if (!inicio && lo != null) inicio = deDia(lo);
    if (!fin && hi != null) fin = deDia(hi);
  }
  if (!inicio || !fin || fin < inicio) return quieto('sin_cronograma');

  // En modo real la historia corre desde hoy: lo que ya pasó, pasó como pasó.
  const desdeYmd = esYmd(desde) && String(desde).slice(0, 10) > inicio ? String(desde).slice(0, 10) : inicio;
  if (desdeYmd > fin) return quieto('plazo_vencido');

  const { valores, ajustados } = valoresDeHistoria(h, sem, HISTORIA_POR_ID.has(historia) ? ajustes : null);
  const fr = frentesDeHistoria(h, valores, { desde: desdeYmd, fin });
  if (fr.error) return quieto(fr.error);

  const caras = fr.frenteCaras
    ? clasificarCaras({ fechas, insumosPartida, cuota: valores.cuotaCaras || 0 })
    : null;
  const carasIds = caras?.ids || new Set();

  // Qué caras ESPERAN y cuáles se PARAN: la que tocaba arrancar durante un
  // tramo de caja apretada arranca cuando vuelve la plata; la que ya estaba
  // en marcha cuando se cortó la plata se para hasta entonces. Las demás caras
  // solo se aprietan un poco en la recuperación, y eso no se cuenta como
  // «esperar» (sería inflar el relato).
  const esperas = fr.tramos.filter(t => t.carasEsperan);
  const reprogramacion = {};
  let postergadas = 0, montoPostergado = 0, pausadas = 0, montoPausado = 0;
  for (const [id, { s, e }] of fechas) {
    const esCara = !!fr.frenteCaras && carasIds.has(id);
    const f = esCara ? fr.frenteCaras : fr.frente;
    const ts = invertirFrente(f, s);
    const te = invertirFrente(f, e + 1);
    const ini = Math.round(ts);
    const fn = Math.max(ini, Math.round(te) - 1);
    reprogramacion[id] = { inicio: deDia(ini), fin: deDia(fn) };
    if (esCara && esperas.length) {
      const tsG = invertirFrente(fr.frente, s), teG = invertirFrente(fr.frente, e + 1);
      if (esperas.some(w => tsG >= w.t0 && tsG < w.t1)) {
        postergadas += 1;
        montoPostergado += caras.costo.get(id) || 0;
      } else if (esperas.some(w => tsG < w.t0 && teG > w.t0)) {
        pausadas += 1;
        montoPausado += caras.costo.get(id) || 0;
      }
    }
  }

  const finNuevo = deDia(Math.round(fr.finDia) - 1);
  const diasEstirados = aDia(finNuevo) - aDia(fin);
  const plazoNuevo = h.estira
    ? { ...(plazo || {}), inicio: (plazo?.inicio ?? inicio), fin: finNuevo }
    : plazo;

  const tramos = fr.tramos.map(t => ({
    desde: deDia(Math.round(t.t0)),
    hasta: deDia(Math.max(Math.round(t.t0), Math.round(t.t1) - 1)),
    ritmo: redondear(t.ritmo, 2),
    calculado: t.calculado,
    caja: t.caja,
    nombre: t.nombre,
    carasEsperan: !!t.carasEsperan,
    dias: Math.max(1, Math.round(t.t1) - Math.round(t.t0)),
  }));

  const out = {
    activo: true,
    historia: infoHistoria(h), azar, semilla: sem, valores, ajustados,
    inicio: desdeYmd, fin, finNuevo, estira: !!h.estira, diasEstirados,
    desdeHoy: desdeYmd > inicio,
    tramos,
    cierre: fr.cierre == null ? null : redondear(fr.cierre, 2),
    caras: caras ? {
      cuota: valores.cuotaCaras, umbralDia: redondear(caras.umbralDia, 2),
      partidas: caras.ids.size, monto: redondear(caras.monto, 2),
      postergadas, montoPostergado: redondear(montoPostergado, 2),
      pausadas, montoPausado: redondear(montoPausado, 2),
    } : null,
    reprogramacion, plazo: plazoNuevo,
    frente: fr.frente, frenteCaras: fr.frenteCaras, carasIds,
  };
  out.relato = relatoDe(out);
  return out;
}

const infoHistoria = (h) => ({ id: h.id, etiqueta: h.etiqueta, icono: h.icono, resumen: h.resumen, estira: !!h.estira });

/**
 * El relato determinístico: qué pasa, cuándo, y qué le hace a las fechas.
 * Solo dice lo que salió de ESTA corrida. (La tanda 3.4 puede sumar el de la
 * IA, pero éste queda siempre como el que no inventa nada.)
 */
function relatoDe(e) {
  const out = [e.historia.resumen];
  if (e.desdeHoy) out.push(`La historia corre desde hoy (${fechaCorta(e.inicio)}): lo anterior queda como estaba en el Gantt.`);
  for (const t of e.tramos) {
    if (t.calculado || Math.abs(t.ritmo - 1) < 0.005) continue;
    out.push(`Del ${fechaCorta(t.desde)} al ${fechaCorta(t.hasta)} la obra avanza al ${pct(t.ritmo)} del ritmo del Gantt (${t.nombre.toLowerCase()}).`);
  }
  if (e.caras && (e.caras.postergadas > 0 || e.caras.pausadas > 0)) {
    const partes = [];
    const { postergadas: np, pausadas: nq } = e.caras;
    if (np > 0) partes.push(`${np} que tocaba arrancar (${soles(e.caras.montoPostergado)}) ${np === 1 ? 'arranca' : 'arrancan'} recién cuando vuelve la plata`);
    if (nq > 0) partes.push(`${nq} que ya ${nq === 1 ? 'estaba' : 'estaban'} en marcha (${soles(e.caras.montoPausado)}) ${nq === 1 ? 'se para' : 'se paran'} hasta entonces`);
    out.push(`Mientras la caja aprieta, las partidas de más de ${soles(e.caras.umbralDia)} por día esperan: ${partes.join(' y ')}. Lo más barato sigue.`);
  }
  const calculado = e.tramos.find(t => t.calculado);
  if (calculado && calculado.ritmo > 1.005) {
    out.push(`Desde el ${fechaCorta(calculado.desde)} hay que ir al ${pct(calculado.ritmo)} del ritmo del Gantt para terminar en fecha.`);
  } else if (calculado && calculado.ritmo < 0.995) {
    out.push(`Con lo adelantado, desde el ${fechaCorta(calculado.desde)} alcanza con el ${pct(calculado.ritmo)} del ritmo del Gantt.`);
  }
  out.push(e.estira
    ? `El fin se estira ${e.diasEstirados} días: del ${fechaCorta(e.fin)} al ${fechaCorta(e.finNuevo)}. Es la única historia que mueve la fecha de fin.`
    : `Termina el ${fechaCorta(e.fin)}, en la fecha del plazo: lo que se frena se recupera acelerando.`);
  return out;
}

// ── El reparto «según el escenario» (§15.2 D) ─────────────────────

/**
 * Qué parte de una partida se hace en cada período, según el frente: lo que
 * avanza la obra en ese período. Con el frente del Gantt (null) es por días;
 * con una historia, un mes de frenazo lleva menos y uno de recuperación más.
 *
 * Los períodos son EXACTAMENTE los que va a mirar el motor: los del tramo
 * corrido por la anticipación. Por eso la fracción de cada período se mide en
 * el tramo sin correr (el período más la anticipación).
 */
function fraccionesDe(frente, ini, fin, granularidad, anticipacionDias) {
  const a = anticipacionDias;
  const periodos = periodosEntre(deDia(ini - a), deDia(fin - a), granularidad);
  if (periodos.length <= 1) return null;
  const tA = ini, tB = fin + 1;
  const total = evaluarFrente(frente, tB) - evaluarFrente(frente, tA);
  const out = {};
  let suma = 0;
  for (const p of periodos) {
    const r = rangoDePeriodo(p);
    if (!r) continue;
    const p0 = Math.max(tA, aDia(r.inicio) + a);
    const p1 = Math.min(tB, aDia(r.fin) + 1 + a);
    if (p1 <= p0) continue;
    const f = total > 1e-9
      ? (evaluarFrente(frente, p1) - evaluarFrente(frente, p0)) / total
      : (p1 - p0) / (tB - tA);
    if (f > 1e-9) { out[p] = f; suma += f; }
  }
  if (!(suma > 0)) return null;
  for (const p of Object.keys(out)) out[p] = redondear(out[p] / suma, 6);
  return out;
}

/**
 * `repartoManual` para el motor (partida_id → {período: fracción}) según el
 * escenario. Se arma para TODAS las partidas con más de un período: el motor
 * solo lo mira en los tramos largos, y cuál es largo depende de una perilla
 * que puede cambiar sin que haga falta rearmar esto.
 */
export function repartoSegunEscenario({
  partidas = [], reprogramacion = {}, escenario = null,
  granularidad = 'mes', anticipacionDias = 0,
} = {}) {
  const a = Math.max(0, Math.round(num(anticipacionDias)));
  const gran = granularidad === 'semana' ? 'semana' : 'mes';
  const conHistoria = !!escenario?.activo;
  const out = {};
  for (const p of vivas(partidas)) {
    if (!p.id) continue;
    // Las mismas fechas que va a leer el motor, con la misma regla.
    const re = reprogramacion?.[p.id];
    const iniY = re?.inicio || p.fecha_inicio_planificada;
    if (!esYmd(iniY)) continue;
    const finY = re ? (re.fin || re.inicio) : (p.fecha_fin_planificada || iniY);
    const ini = aDia(iniY);
    const fin = esYmd(finY) ? Math.max(ini, aDia(finY)) : ini;
    const frente = conHistoria
      ? (escenario.frenteCaras && escenario.carasIds?.has(p.id) ? escenario.frenteCaras : escenario.frente)
      : null;
    const fr = fraccionesDe(frente, ini, fin, gran, a);
    if (fr) out[p.id] = fr;
  }
  return out;
}

// ── Todo junto, para la pantalla ──────────────────────────────────

/**
 * Traduce los ejes de la PANTALLA (modo, arranque, cronograma con historia,
 * reparto «según el escenario») a los del motor: `cronograma`
 * 'gantt' | 'reprogramado' | 'sin_cronograma', `reprogramacion`, `plazo`,
 * `reparto` y `repartoManual`.
 *
 * Devuelve además `motorSinHistoria` — los mismos ejes SIN la historia (pero
 * con el arranque) — para correr la línea de base de la curva de carga, y
 * `null` cuando no hay historia activa.
 */
export function armarCronograma({
  partidas = [], insumosPartida = [], plazo = null, hoy = null,
  modo = 'real', arranque = 'gantt', arranqueFecha = null,
  cronograma = 'gantt',
  historia = HISTORIA_AZAR, semilla = 1, historiaAjustes = null,
  reparto = 'parejo', granularidad = 'mes', anticipacionDias = 0,
} = {}) {
  const hoyYmd = esYmd(hoy) ? String(hoy).slice(0, 10) : hoyLocal();
  const simulacion = modo === 'simulacion';
  const desplazado = simulacion
    ? desplazarCronograma({ partidas, plazo, arranque, arranqueFecha, hoy: hoyYmd })
    : { activo: false, deltaDias: 0, reprogramacion: {}, plazo };

  const notas = [];
  const sinCronograma = cronograma === 'sin_cronograma';
  let repartoMotor = reparto;
  if (reparto === 'escenario' && sinCronograma) {
    // Sin fechas por partida no hay avance que seguir: todo el plazo es un
    // solo tramo parejo.
    repartoMotor = 'parejo';
    notas.push('reparto_sin_cronograma');
  }

  let escenario = null;
  if (cronograma === 'escenario') {
    escenario = cronogramaPorEscenario({
      partidas, insumosPartida, plazo: desplazado.plazo, base: desplazado.reprogramacion,
      historia, semilla, ajustes: historiaAjustes,
      desde: simulacion ? null : hoyYmd,
    });
  }
  const conHistoria = !!escenario?.activo;

  const ejes = ({ reprogramacion, plazo: pl, esc }) => ({
    cronograma: sinCronograma ? 'sin_cronograma' : (Object.keys(reprogramacion).length ? 'reprogramado' : 'gantt'),
    reprogramacion,
    plazo: pl,
    reparto: repartoMotor,
    repartoManual: repartoMotor === 'escenario'
      ? repartoSegunEscenario({ partidas, reprogramacion, escenario: esc, granularidad, anticipacionDias })
      : {},
  });

  const sinHistoria = { reprogramacion: desplazado.reprogramacion, plazo: desplazado.plazo, esc: null };
  const motor = conHistoria
    ? ejes({ reprogramacion: escenario.reprogramacion, plazo: escenario.plazo, esc: escenario })
    : ejes(sinHistoria);

  return {
    motor,
    motorSinHistoria: conHistoria ? ejes(sinHistoria) : null,
    desplazado,
    escenario,
    notas,
  };
}

export const NOTA_CRONOGRAMA_LABEL = {
  reparto_sin_cronograma: 'Sin cronograma no hay avance por partida que seguir: los tramos largos se reparten parejo.',
};

// ── La curva de carga (§15.2 C) ───────────────────────────────────

/**
 * La plata que el plan pide cada MES, en la corrida de base (el Gantt) y en
 * la del escenario. Es lo que hace legible una historia: dónde se hunde el
 * gasto, dónde se amontona.
 *
 * Se suma por ENTREGA (lo que cada mes necesita), no por la fecha en que se
 * emite la orden: la frecuencia de emisión es otra perilla y juntaría meses
 * que la historia separa. Los sobres entran con lo que reparten por mes. En
 * semana a semana, las semanas van a su mes (`mesDePeriodo`).
 */
export function curvaDeCarga(base, escenario) {
  const sumar = (corrida) => {
    const m = new Map();
    const add = (periodo, monto) => {
      const mes = mesDePeriodo(periodo);
      if (!mes || !num(monto)) return;
      m.set(mes, (m.get(mes) || 0) + num(monto));
    };
    for (const p of corrida?.propuestas || []) {
      for (const l of p.lineas || []) {
        if (Array.isArray(l.entregas) && l.entregas.length) for (const e of l.entregas) add(e.periodo, e.monto);
        else add(p.periodo, l.monto);
      }
    }
    for (const s of corrida?.sobres || []) for (const x of s.porPeriodo || []) add(x.periodo, x.monto);
    return m;
  };
  const a = sumar(base), b = sumar(escenario);
  const meses = [...new Set([...a.keys(), ...b.keys()])].sort();
  const filas = meses.map(mes => ({
    mes, etiqueta: etiquetaPeriodo(mes),
    base: redondear(a.get(mes) || 0), escenario: redondear(b.get(mes) || 0),
  }));
  const pico = (k) => filas.reduce((best, f) => (f[k] > (best ? best[k] : -1) ? f : best), null);
  const total = (k) => redondear(filas.reduce((s, f) => s + f[k], 0));
  return {
    filas,
    totalBase: total('base'), totalEscenario: total('escenario'),
    picoBase: pico('base'), picoEscenario: pico('escenario'),
    maximo: filas.reduce((mx, f) => Math.max(mx, f.base, f.escenario), 0),
  };
}
