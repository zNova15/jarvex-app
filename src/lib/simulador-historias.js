// ═══════════════════════════════════════════════════════════════════
// JARVEX — SIMULADOR DE ÓRDENES: EL CATÁLOGO DE HISTORIAS (ronda 3).
//
// Las historias con que se cuenta el cronograma «aleatorio por escenario»
// (tanda 3.3, doc §15.2 C). El motor que las convierte en fechas vive en
// `simulador-cronograma.js`; acá está SOLO el catálogo, lo que se puede
// guardar de él y lo que la IA puede elegir (tanda 3.4).
//
// ── POR QUÉ UNA LIB HOJA (SIN IMPORTS) ─────────────────────────────
// El endpoint `api/asistente-solicitud.js` la importa para validar lo que
// devuelve la IA contra el catálogo REAL — no contra una copia que mande el
// cliente — y no puede arrastrar el motor de órdenes ni el diccionario del
// IUPC a una función de Vercel. Mismo caso que `match-solicitud.js`.
//
// ── LO QUE LA IA PUEDE Y NO PUEDE (tanda 3.4) ───────────────────────
// Elige un id del catálogo y valores para sus perillas; cuenta la historia.
// Un id fuera de la lista se descarta ENTERO; un valor fuera de rango se
// recorta al rango y se pega al paso; una perilla que la historia no tiene
// se tira. Nunca pone una fecha: las fechas salen siempre del motor.
//
// Testeado en __tests__/simulador-historias.test.js
// ═══════════════════════════════════════════════════════════════════

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const redondear = (n, d = 2) => { const f = 10 ** d; return Math.round((num(n) + Number.EPSILON) * f) / f; };

export const HISTORIA_AZAR = 'azar';

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

/** Una semilla válida: entero de 1 a 2.147.483.647. Cualquier otra cosa es 1. */
export function semillaValida(s) {
  const n = Math.floor(Number(s));
  return Number.isFinite(n) && n >= 1 && n <= 2147483647 ? n : 1;
}

/** Un valor dentro de un rango, pegado a su paso. Null si no es un número. */
export function valorEnRango(v, { min, max, paso }) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const c = Math.min(max, Math.max(min, n));
  return redondear(min + Math.round((c - min) / paso) * paso, 4);
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
    const v = valorEnRango(ajustes[clave], rango);
    if (v != null) out.push([clave, v]);
  }
  return Object.fromEntries(out);
}


// ═══════════════════════════════════════════════════════════════════
// TANDA 3.4 — LA IA ELIGE Y CUENTA LA HISTORIA (doc §15.2 C)
// ═══════════════════════════════════════════════════════════════════

export const LARGO_RELATO_IA = 700;
export const LARGO_PORQUE_IA = 300;
export const LARGO_PREOCUPACION = 300;

// Una fecha puntual en el relato («el 15 de octubre», «15/10», «2027») sería
// la IA poniendo fechas, que es lo único que no puede hacer: las fechas las
// calcula el motor y la tarjeta ya las muestra. La oración que trae una se
// tira entera. Nombrar un MES sí se permite: la IA ve la plata mes por mes y
// «la carga se amontona en noviembre» es leer lo que se le dio.
const FECHA_PUNTUAL_RE = /\b\d{1,2}\s*(de\s+)?(ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)[a-záéíóú]*\b|\b\d{1,2}[/-]\d{1,2}\b|\b(19|20)\d\d\b/i;

/** El texto sin las oraciones que ponen una fecha puntual, recortado. */
export function sinFechasPuntuales(texto, largo) {
  const oraciones = String(texto || '').replace(/\s+/g, ' ').trim()
    .split(/(?<=[.!?])\s+/)
    .filter(o => o && !FECHA_PUNTUAL_RE.test(o));
  return oraciones.join(' ').slice(0, largo).trim();
}

/**
 * Lo que devolvió la IA, saneado. Null si no eligió una historia del
 * catálogo: una historia inventada no se puede aplicar, y aplicar otra que la
 * que contó sería peor que no aplicar nada (misma regla que el id inventado
 * de la tanda 2.6).
 *
 * @returns {{historia:string, ajustes:Object, relato:string, porQue:string}|null}
 */
export function sanearHistoriaIA(crudo) {
  const id = crudo && typeof crudo.historia === 'string' ? crudo.historia.trim() : '';
  if (!HISTORIA_POR_ID.has(id)) return null;
  return {
    historia: id,
    ajustes: normalizarAjustesHistoria(id, crudo.ajustes),
    relato: sinFechasPuntuales(crudo.relato, LARGO_RELATO_IA),
    porQue: sinFechasPuntuales(crudo.porQue ?? crudo.por_que, LARGO_PORQUE_IA),
  };
}

/**
 * Lo que la IA ve de la obra, y NADA más: el nombre, el plazo, desde cuándo
 * corre la historia, cuánto es lo comprable y la plata que pide el plan cada
 * mes con el Gantt (la curva de base de la tanda 3.3). Nunca una partida, un
 * insumo ni una fecha que tenga que copiar. Los montos van en miles para que
 * no haya decimales que citar mal.
 */
export function contextoParaHistoria({
  obraNombre = '', plazo = null, desde = null, modo = 'simulacion',
  curva = null, montoComprable = null, preocupacion = '',
} = {}) {
  const meses = (curva?.filas || [])
    .map(f => ({ mes: f.mes, miles: Math.round(num(f.base) / 1000) }));
  return {
    obra: String(obraNombre || '').slice(0, 160),
    plazoInicio: plazo?.inicio || null,
    plazoFin: plazo?.fin || null,
    desde: desde || null,
    modo: modo === 'real' ? 'real' : 'simulacion',
    comprableMiles: montoComprable != null ? Math.round(num(montoComprable) / 1000) : null,
    meses,
    preocupacion: String(preocupacion || '').replace(/\s+/g, ' ').trim().slice(0, LARGO_PREOCUPACION),
  };
}

/**
 * El relato de la IA se guarda con el escenario, pero solo vale mientras el
 * escenario siga contando ESA historia con ESAS perillas. Si alguien tocó
 * «🎲 Otro» o eligió otra, el relato ya habla de otra cosa y no se muestra.
 */
export function relatoIAVigente(relatoIA, params) {
  if (!relatoIA || !params) return false;
  if (relatoIA.historia !== params.historia) return false;
  const a = normalizarAjustesHistoria(relatoIA.historia, relatoIA.ajustes);
  const b = normalizarAjustesHistoria(params.historia, params.historiaAjustes);
  return JSON.stringify(a) === JSON.stringify(b) && Object.keys(a).length > 0;
}

/** Un relato de la IA leído del localStorage, saneado (o null). */
export function normalizarRelatoIA(r) {
  const s = sanearHistoriaIA(r);
  if (!s) return null;
  return {
    ...s,
    model: typeof r.model === 'string' ? r.model.slice(0, 120) : null,
    fecha: typeof r.fecha === 'string' ? r.fecha.slice(0, 10) : null,
  };
}
