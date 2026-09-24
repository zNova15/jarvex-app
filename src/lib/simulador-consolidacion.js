// ═══════════════════════════════════════════════════════════════════
// JARVEX — SIMULADOR DE ÓRDENES: CONSOLIDACIÓN (ronda 2, tanda 2.3).
//
// Diseño en `docs/plan-simulador-ordenes.md` §12.1 punto 4 y §12.3. Hasta la
// 2.2, una orden propuesta era «un período × un rubro»: el motor proponía una
// orden de concreto en octubre, otra en noviembre, otra en diciembre… aunque
// la de noviembre fuera de S/ 787 con cinco líneas. Medido en Miraflores el
// 24-set-2026: 149 órdenes mes a mes (47 de menos de S/ 1.000) y 501 semana a
// semana. Nadie emite 501 órdenes para una obra de nueve meses.
//
// ── LO QUE CAMBIA: EMITIR NO ES ENTREGAR ──────────────────────────
// Una orden se EMITE una vez y se ENTREGA por partes. El motor sigue
// calculando la necesidad período por período —eso no se toca: es lo que dice
// cuándo tiene que estar el material en obra—, pero ahora esos períodos son
// ENTREGAS dentro de una orden, no órdenes sueltas:
//
//   antes:   Concreto — oct  │ Concreto — nov  │ Concreto — dic
//   ahora:   Concreto — octubre a diciembre 2026
//              entregas: oct 120 bol · nov 80 bol · dic 40 bol
//
// Dos perillas deciden cómo se juntan:
//
//   · FRECUENCIA, por rubro: cada cuánto se emite una orden de ese rubro.
//     No todo se compra al mismo ritmo: el cemento puede ir mes a mes y los
//     EPPs en una sola orden para toda la obra. La ventana se ABRE con la
//     primera necesidad del rubro y cubre N meses calendario desde ahí. Nunca
//     antes: una ventana alineada al calendario de la obra obligaría a emitir
//     en meses en que ese rubro no necesita nada.
//
//   · MONTO MÍNIMO: una orden por debajo del umbral se junta con la SIGUIENTE
//     del mismo rubro, y la orden juntada se emite en la fecha de la MÁS
//     TEMPRANA. Juntar hacia adelante sin adelantar la emisión dejaría la obra
//     esperando el material del mes chico hasta el mes siguiente — el mismo
//     error que la 2.2 evitó con el lote mínimo («se junta con el ANTERIOR,
//     no con el siguiente, que dejaría la obra corta»). Si la última orden del
//     rubro queda chica, se suma a la anterior: su entrega sigue siendo en su
//     fecha, adentro de una orden emitida antes.
//
// ── POR QUÉ LAS DECISIONES NO SE PIERDEN AL REAGRUPAR ─────────────
// Cada orden consolidada dice de qué «átomos» (período × rubro) está hecha, y
// el id de la orden es el de su primer átomo. Un átomo es exactamente lo que
// hasta la 2.2 era una orden, con el mismo id: `2026-10|concreto`. Las
// decisiones del escenario se guardan contra los átomos
// (`simulador-escenarios.js`), así que juntar o separar órdenes cambiando una
// perilla no borra lo que Gabriel ya aceptó — y los escenarios guardados antes
// de esta tanda se leen tal cual.
//
// Puro: sin React, sin Dexie, sin imports. El motor le pasa el mes calendario
// de cada período (`mesDePeriodo`), así este archivo no depende del motor y no
// se arma un import circular.
//
// Testeado en __tests__/simulador-consolidacion.test.js
// ═══════════════════════════════════════════════════════════════════

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;

/** Cada cuánto se emite una orden de un rubro. */
export const FRECUENCIAS = ['periodo', 'mensual', 'bimestral', 'trimestral', 'unica'];

/**
 * El default es MENSUAL. Con el plan mes a mes eso deja las órdenes como
 * estaban (una por mes y rubro); con el plan semana a semana es lo que el
 * §12.3 pide: «una orden mensual con una tabla de entregas semanales adentro
 * resuelve el caso semanal sin proponer 36 órdenes».
 */
export const FRECUENCIA_DEFAULT = 'mensual';

export const FRECUENCIA_LABEL = {
  periodo: 'Una por período (cada mes, o cada semana)',
  mensual: 'Una por mes',
  bimestral: 'Una cada dos meses',
  trimestral: 'Una cada tres meses',
  unica: 'Una sola para toda la obra',
};

/** Cuántos meses calendario cubre la ventana de cada frecuencia. */
const MESES_VENTANA = { mensual: 1, bimestral: 2, trimestral: 3 };

/** La frecuencia que rige para un rubro: la suya si tiene, si no la general. */
export function frecuenciaDeRubro(rubro, { frecuencia = FRECUENCIA_DEFAULT, frecuenciaPorRubro = null } = {}) {
  const propia = frecuenciaPorRubro?.[rubro];
  if (FRECUENCIAS.includes(propia)) return propia;
  return FRECUENCIAS.includes(frecuencia) ? frecuencia : FRECUENCIA_DEFAULT;
}

/** 'YYYY-MM' → índice de mes corrido, para poder sumar meses sin fechas. */
const indiceMes = (ym) => {
  const m = /^(\d{4})-(\d{2})/.exec(String(ym || ''));
  return m ? (+m[1]) * 12 + (+m[2] - 1) : null;
};

const cmpPeriodo = (a, b) => (a.periodo < b.periodo ? -1 : a.periodo > b.periodo ? 1 : 0);

/** Un grupo nuevo a partir de su primer átomo. */
const abrir = (a, frecuencia) => ({
  id: a.id, rubro: a.rubro, periodo: a.periodo,
  atomos: [a], monto: num(a.monto), frecuencia,
  juntadaPorMonto: false,
});

const juntar = (destino, origen) => {
  destino.atomos.push(...origen.atomos);
  destino.atomos.sort(cmpPeriodo);
  destino.monto += origen.monto;
  destino.juntadaPorMonto = true;
  return destino;
};

/**
 * Junta los átomos (período × rubro) en órdenes.
 *
 * @param {Array<{id:string, periodo:string, rubro:string, monto:number, mes:string}>} atomos
 *        `mes` es el mes calendario del período ('YYYY-MM'); para una semana,
 *        el de su jueves (`mesDePeriodo`).
 * @param {Object}  o
 * @param {string}  [o.frecuencia='mensual']   la general.
 * @param {Object}  [o.frecuenciaPorRubro]     rubro → frecuencia, pisa la general.
 * @param {number}  [o.montoMinimo=0]          en soles; 0 = no se junta por monto.
 *
 * @returns {Array<{id:string, rubro:string, periodo:string, periodos:string[],
 *                  atomos:string[], monto:number, frecuencia:string,
 *                  juntadaPorMonto:boolean, bajoMinimo:boolean}>}
 *   `periodo` es el de EMISIÓN (el más temprano); `periodos`, las entregas.
 *   `bajoMinimo` marca la orden que ni juntando todo su rubro llega al
 *   mínimo: se propone igual —la obra la necesita— pero se dice.
 */
export function consolidarOrdenes(atomos = [], {
  frecuencia = FRECUENCIA_DEFAULT,
  frecuenciaPorRubro = null,
  montoMinimo = 0,
} = {}) {
  const minimo = Math.max(0, num(montoMinimo));
  const porRubro = new Map();
  for (const a of (atomos || [])) {
    if (!a || !a.id || !a.periodo) continue;
    const arr = porRubro.get(a.rubro) || [];
    arr.push(a);
    porRubro.set(a.rubro, arr);
  }

  const salida = [];
  for (const [rubro, lista] of porRubro) {
    lista.sort(cmpPeriodo);
    const frec = frecuenciaDeRubro(rubro, { frecuencia, frecuenciaPorRubro });

    // ── 1) ventanas de emisión por frecuencia ────────────────────────
    let ventanas = [];
    if (frec === 'unica') {
      const g = abrir(lista[0], frec);
      for (const a of lista.slice(1)) { g.atomos.push(a); g.monto += num(a.monto); }
      ventanas = [g];
    } else if (frec === 'periodo') {
      ventanas = lista.map(a => abrir(a, frec));
    } else {
      const largo = MESES_VENTANA[frec] || 1;
      let actual = null, tope = null;
      for (const a of lista) {
        const im = indiceMes(a.mes || a.periodo);
        // Un período sin mes legible no se junta con nada: mejor una orden de
        // más que meter una entrega en la ventana equivocada.
        if (im == null) { ventanas.push(abrir(a, frec)); actual = null; continue; }
        if (actual && im < tope) {
          actual.atomos.push(a);
          actual.monto += num(a.monto);
          continue;
        }
        actual = abrir(a, frec);
        tope = im + largo;
        ventanas.push(actual);
      }
    }

    // ── 2) monto mínimo: la chica se junta con la siguiente ──────────
    let grupos = ventanas;
    if (minimo > 0 && ventanas.length > 1) {
      grupos = [];
      let acum = null;
      for (const v of ventanas) {
        if (!acum) { acum = v; continue; }
        if (acum.monto < minimo) { juntar(acum, v); continue; }
        grupos.push(acum);
        acum = v;
      }
      if (acum) {
        // La última quedó chica: se suma a la anterior, que se emite antes.
        // Su entrega sigue en su fecha; lo que cambia es en qué orden va.
        if (acum.monto < minimo && grupos.length) juntar(grupos[grupos.length - 1], acum);
        else grupos.push(acum);
      }
    }

    for (const g of grupos) {
      salida.push({
        id: g.id,
        rubro,
        periodo: g.atomos[0].periodo,
        periodos: g.atomos.map(a => a.periodo),
        atomos: g.atomos.map(a => a.id),
        monto: r2(g.monto),
        frecuencia: frec,
        juntadaPorMonto: g.juntadaPorMonto,
        bajoMinimo: minimo > 0 && g.monto < minimo,
      });
    }
  }
  return salida;
}
