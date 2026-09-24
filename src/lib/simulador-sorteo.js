// ═══════════════════════════════════════════════════════════════════
// JARVEX — SIMULADOR DE ÓRDENES: ESCENARIOS SUGERIDOS (ronda 2, tanda 2.6,
// OPCIONAL — 24-set-2026, docs/plan-simulador-ordenes.md §13).
//
// El motor de `simulador-ordenes.js` corre con los parámetros que la persona
// elige a mano. Esta lib corre el MISMO motor tres veces, con tres
// combinaciones de perillas pensadas para tres prioridades distintas —caja,
// desabastecimiento, administración— y devuelve los tres resultados REALES
// (cobertura, plata, número de órdenes) para comparar uno al lado del otro.
//
// ── NUNCA INVENTA CANTIDADES ───────────────────────────────────────
// Un «enfoque» es SOLO una combinación de las perillas que ya existen y que
// la persona ya puede tocar a mano (reparto, anticipación, frecuencia, monto
// mínimo). No hay una cantidad, un precio ni una línea que este archivo
// escriba: elige una combinación, la corre con el motor real y devuelve lo
// que el motor devolvió. Elegir un enfoque es lo mismo que cambiar esas
// perillas en el panel de la pantalla.
//
// ── EL COLCHÓN QUEDA AFUERA A PROPÓSITO ────────────────────────────
// El plan original (§13) listaba el colchón entre las perillas que un enfoque
// podía tocar. Se saca: CLAUDE.md §8 (decisión de Gabriel, tanda 2.2) es
// explícito en que el colchón por robo/merma NO es una perilla global ni una
// tabla que el motor sugiera por rubro — lo decide Gabriel, insumo por
// insumo. Un enfoque que le subiera el colchón a «cemento, agregados, etc.»
// sería exactamente esa tabla inventada que CLAUDE.md prohíbe.
//
// ── SIEMPRE DISPONIBLE, SIN IA ─────────────────────────────────────
// `sortearEnfoques()` es determinístico y gratis: no llama a ningún modelo.
// La IA (ver `simulador-sorteo-ai.js` y el endpoint) se suma ENCIMA, solo si
// se pide, para elegir uno de los tres y explicar el porqué mirando el
// contexto de la obra — nunca para tocar un número.
//
// ── QUÉ NO SE TOCA ──────────────────────────────────────────────────
// Cada enfoque respeta el anclaje, el cronograma, las categorías y el modo
// del almacén que la persona ya eligió: son la PREGUNTA (§3.1, §3.2, §3.4 del
// plan; almacenModo de la tanda 2.5), no una respuesta que un enfoque decida
// por ella. Tampoco toca `frecuenciaPorRubro`: si la persona ya le puso una
// frecuencia distinta a un rubro, esa decisión sobrevive.
// Y NUNCA elige `reparto:'cuadrilla'` ni `'manual'` — la tanda 1 ya dejó
// escrito que esas dos estrategias «pueden no tener con qué contestar» sin
// datos que hoy no siempre existen (dotación de cuadrilla, reparto fijado a
// mano); un enfoque automático no puede caer ahí.
//
// Puro: sin React, sin Dexie, sin red. Solo importa el motor que ya existe.
// Testeado en __tests__/simulador-sorteo.test.js
// ═══════════════════════════════════════════════════════════════════

import { simularOrdenes } from './simulador-ordenes.js';
import { paramsDeMotor } from './simulador-escenarios.js';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;

export const ENFOQUES_SORTEO = ['caja_ajustada', 'cero_desabastecimiento', 'pocas_ordenes'];

export const ENFOQUE_LABEL = {
  caja_ajustada: 'Caja ajustada',
  cero_desabastecimiento: 'Cero desabastecimiento',
  pocas_ordenes: 'Pocas órdenes',
};

export const ENFOQUE_ICONO = {
  caja_ajustada: '💰',
  cero_desabastecimiento: '🛡️',
  pocas_ordenes: '📦',
};

export const ENFOQUE_RESUMEN = {
  caja_ajustada: 'Pide lo justo, cuando toca: nunca compra antes de tiempo ni junta meses en una orden grande.',
  cero_desabastecimiento: 'Pide con anticipación y lleva el tramo largo al inicio: llega antes de que haga falta.',
  pocas_ordenes: 'Junta órdenes chicas del mismo rubro cada trimestre: menos documentos que emitir y seguir.',
};

// El reparto NUNCA sale de acá en 'cuadrilla' ni 'manual' (ver encabezado):
// esas dos estrategias pueden quedar sin datos con qué contestar y un enfoque
// automático no puede elegir una que no tiene con qué responder.
const REPARTO_SORTEO = new Set(['parejo', 'inicio']);
const repartoDeBase = (r) => (REPARTO_SORTEO.has(r) ? r : 'parejo');

/**
 * Las perillas de cada enfoque, por ENCIMA de la base (anclaje, cronograma,
 * categorías, frecuenciaPorRubro, almacén… siguen siendo las de la base).
 * `montoMinimoOrden` de 'pocas_ordenes' se completa en `sortearEnfoques` con
 * un número medido de la propia obra, no un valor de oficio.
 */
function overridesDe(enfoque, base, montoMinimoSugerido) {
  const repartoBase = repartoDeBase(base.reparto);
  switch (enfoque) {
    case 'caja_ajustada':
      // Ni antes de tiempo ni junto: lo que se pide es exactamente lo que se
      // necesita ese mes, así que nunca hay que pagar de más de una vez.
      return { reparto: repartoBase, anticipacionDias: 0, frecuencia: 'mensual', montoMinimoOrden: 0 };
    case 'cero_desabastecimiento':
      // El tramo largo entero al inicio (no repartido) + 15 días de
      // anticipación: el material está en obra antes de que la partida lo pida.
      return { reparto: 'inicio', anticipacionDias: 15, frecuencia: 'mensual', montoMinimoOrden: 0 };
    case 'pocas_ordenes':
      // Trimestral + el mínimo medido de esta obra: junta lo que antes salía
      // en 3 órdenes chicas del mismo rubro en 1 sola.
      return { reparto: repartoBase, anticipacionDias: 0, frecuencia: 'trimestral', montoMinimoOrden: montoMinimoSugerido };
    default:
      return {};
  }
}

/**
 * El monto mínimo que separa una orden «chica» en ESTA obra, medido contra
 * sus propios átomos (no un número de oficio). Se corre una vez con
 * frecuencia mensual y monto mínimo 0 —ahí una propuesta es prácticamente un
 * átomo sin juntar— y se toma 1,5× la mediana de sus montos, redondeada a la
 * centena. Con menos de 4 propuestas no hay con qué medir una mediana que
 * signifique algo: el mínimo queda en 0 (no junta nada), igual que el default
 * del motor.
 */
export function montoMinimoSugerido(args) {
  // Mismo freno que los enfoques: si la base venía en 'cuadrilla' o 'manual'
  // sin los datos que esas estrategias necesitan, la corrida de medición no
  // puede heredar ese vacío — mediría una mediana de casi nada.
  const reparto = repartoDeBase(args.reparto);
  const { propuestas } = simularOrdenes({ ...args, reparto, frecuencia: 'mensual', montoMinimoOrden: 0 });
  const montos = propuestas.map(p => p.monto).filter(m => m > 0).sort((a, b) => a - b);
  if (montos.length < 4) return 0;
  const mediana = montos.length % 2
    ? montos[(montos.length - 1) / 2]
    : (montos[montos.length / 2 - 1] + montos[montos.length / 2]) / 2;
  return Math.max(0, Math.round((mediana * 1.5) / 100) * 100);
}

/**
 * Corre el motor tres veces, una por enfoque, y devuelve los tres resultados
 * REALES uno al lado del otro. Todos los argumentos son los mismos que recibe
 * `simularOrdenes` — se pasan tal cual, y cada enfoque solo pisa sus 4
 * perillas (ver `overridesDe`).
 *
 * @returns {Array<{id, nombre, icono, resumenTexto, overrides, params,
 *   corrida:{propuestas, sobres, resumen}, porQue}>}
 */
export function sortearEnfoques(args = {}) {
  const base = paramsDeMotor(args);
  const minimoSugerido = montoMinimoSugerido({ ...args, ...base });

  return ENFOQUES_SORTEO.map(id => {
    const overrides = overridesDe(id, base, minimoSugerido);
    const params = { ...base, ...overrides };
    const corrida = simularOrdenes({ ...args, ...params });
    return {
      id,
      nombre: ENFOQUE_LABEL[id],
      icono: ENFOQUE_ICONO[id],
      resumenTexto: ENFOQUE_RESUMEN[id],
      overrides,
      params,
      corrida: {
        propuestas: corrida.propuestas,
        sobres: corrida.sobres,
        resumen: corrida.resumen,
      },
      porQue: porQueDe(id, corrida, overrides),
    };
  });
}

/** La explicación determinística: solo números que salieron de ESTA corrida. */
function porQueDe(id, corrida, overrides) {
  const r = corrida.resumen;
  const nOrdenes = corrida.propuestas.length;
  const cobertura = Math.round((r.cobertura || 0) * 100);
  switch (id) {
    case 'caja_ajustada':
      return `Reparte el gasto parejo mes a mes y no compra antes de tiempo: ${nOrdenes} orden(es), `
        + `${cobertura}% de cobertura, sin plata adelantada por anticipación ni por juntar meses.`;
    case 'cero_desabastecimiento':
      return `Pide con ${overrides.anticipacionDias} días de anticipación y lleva el tramo largo al inicio del tramo: `
        + `${nOrdenes} orden(es), ${cobertura}% de cobertura. Tiene más material esperando en obra antes de usarse.`;
    case 'pocas_ordenes':
      return overrides.montoMinimoOrden > 0
        ? `Junta órdenes por trimestre y por monto mínimo (S/ ${overrides.montoMinimoOrden.toLocaleString('es-PE')}, medido en esta obra): `
          + `${nOrdenes} orden(es) en vez de una por mes, ${cobertura}% de cobertura.`
        : `Junta órdenes por trimestre: ${nOrdenes} orden(es), ${cobertura}% de cobertura. `
          + 'Esta obra no tiene suficientes órdenes chicas como para que un mínimo por monto sume algo.';
    default:
      return '';
  }
}
