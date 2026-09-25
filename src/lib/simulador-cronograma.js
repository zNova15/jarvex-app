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
// La tanda 3.3 suma acá el cronograma aleatorio por escenario (curvas de
// ritmo por tramo), que es otro generador del mismo `reprogramacion`.
//
// Testeado en __tests__/simulador-cronograma.test.js
// ═══════════════════════════════════════════════════════════════════

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
