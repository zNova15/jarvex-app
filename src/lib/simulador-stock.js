// ═══════════════════════════════════════════════════════════════════
// JARVEX — SIMULADOR DE ÓRDENES: HERRAMIENTAS Y EPP CONTRA EL STOCK
// (ronda 3, tanda 3.5 de docs/plan-simulador-ordenes.md, §15.2 E)
//
// En modo «📍 Según lo real», antes de pedir 120 pares de zapatos o de
// escribir contra el sobre «HERRAMIENTAS MANUALES», la pantalla tiene que
// poder decir «ya hay 12 conos en el almacén». Esta lib arma esa comparación.
// PURA: sin React, sin Dexie.
//
// ── LO QUE SE MIDIÓ EN MIRAFLORES (24-set-2026) ───────────────────
//   · Herramientas del almacén: 87 ítems (palas, picos, conos, baldes…).
//     Ninguno es una línea del presupuesto: son la plata del sobre
//     «HERRAMIENTAS MANUALES» (S/ 132.493, 3% de la mano de obra).
//   · EPPs del almacén: 58 ítems, por TALLA o color («ZAPATOS 41», «CASCOS
//     AZULES») contra líneas genéricas del presupuesto («ZAPATOS PUNTA DE
//     ACERO», 120 pares).
//   · Imputados a un insumo: 0 de los 145. El almacén todavía no resta nada.
//
// ── TRES CAJONES, Y SOLO UNO RESTA ────────────────────────────────
//   imputado — el ítem dice a qué insumo del presupuesto corresponde
//              (`imputacion='insumo'`). El motor YA lo resta, según «Del
//              almacén, restar». Acá solo se muestra.
//   parecido — no está imputado, pero el nombre se parece a una línea del
//              plan Y comparte su palabra principal («zapatos», «cascos»).
//              NO se resta: es un «fijate», con el camino a imputarlo. Restar
//              por parecido de nombre es exactamente lo que la bandeja de
//              imputación evita («VÁLVULA DE 1/2" PARA MEDIDOR» → «VÁLVULA
//              CHECK»).
//   suelto   — tiene stock y no se parece a ninguna línea: las herramientas
//              van al sobre de herramientas (es lo que el expediente dice que
//              son, §4.1), los EPPs se listan aparte.
//
// El parecido reusa el match del asistente de solicitudes
// (`match-solicitud.js`), con el piso de sus alternativas (`UMBRAL_PARECIDO`), más
// una condición: la PRIMERA palabra tiene que coincidir. Sin ella, «PUNTA» (una
// punta de barreta) salía parecida a «ZAPATOS PUNTA DE ACERO».
//
// Testeado en __tests__/simulador-stock.test.js
// ═══════════════════════════════════════════════════════════════════

import {
  prepararCatalogo, recomendarInsumos, decidirSugerencia, tokensInsumo, coincide,
  UMBRAL_ALTERNATIVA,
} from './match-solicitud.js';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r4 = (n) => Math.round((num(n) + Number.EPSILON) * 10000) / 10000;

/** Las tablas del almacén que tienen herramientas y EPPs. */
const TABLAS_HERRAMIENTAS = new Set(['herramientas', 'epps']);

/**
 * Por debajo de esto el match no se muestra ni como parecido. Es el piso de
 * las ALTERNATIVAS del match (no el de sugerir): la talla («ZAPATOS 41») es
 * una medida que la línea genérica no tiene y baja el puntaje —0,37 contra
 * «ZAPATOS PUNTA DE ACERO»—. Lo que frena el ruido es la palabra principal.
 */
export const UMBRAL_PARECIDO = UMBRAL_ALTERNATIVA;

const primeraPalabra = (nombre) => tokensInsumo(nombre).palabras[0] || '';

const itemDe = (f, extra = {}) => ({
  id: f.id, tabla: f.tabla, nombre: f.nombre, unidad: f.unidad || '',
  stock: r4(f.stock), entradas: r4(f.entradas), ...extra,
});

/**
 * Lo que el almacén de la obra ya tiene, contra las líneas de herramientas y
 * EPPs del plan y contra el sobre de herramientas.
 *
 * @param {Object} o
 * @param {Array}  o.almacen  salida de `existenciasDelAlmacen()` (todas las tablas)
 * @param {Array}  o.lineas   líneas del plan (de cualquier propuesta); solo se
 *                            miran las de categoría 'herramientas'
 * @param {Array}  [o.sobres] sobres del plan, para saber cuál es el de herramientas
 * @returns {{porClave:Map<string,{imputados:Array, parecidos:Array, stockImputado:number}>,
 *            sueltas:{herramientas:Array, epps:Array},
 *            sobreHerramientas:string|null,
 *            resumen:Object}}
 */
export function stockContraPlan({ almacen = [], lineas = [], sobres = [] } = {}) {
  // Una línea por insumo: el mismo insumo aparece en varias órdenes (una por
  // período) y la comparación es contra el insumo, no contra la entrega.
  const porClaveLinea = new Map();
  const porCodigo = new Map();
  for (const l of (lineas || [])) {
    if (!l || l.categoria !== 'herramientas' || !l.clave || porClaveLinea.has(l.clave)) continue;
    porClaveLinea.set(l.clave, l);
    if (l.insumo_codigo) porCodigo.set(String(l.insumo_codigo).trim(), l.clave);
  }
  const prep = prepararCatalogo([...porClaveLinea.values()].map(l => ({ id: l.clave, nombre: l.nombre, unidad: l.unidad })));

  const porClave = new Map();
  const de = (clave) => {
    let e = porClave.get(clave);
    if (!e) { e = { imputados: [], parecidos: [], stockImputado: 0 }; porClave.set(clave, e); }
    return e;
  };
  const sueltas = { herramientas: [], epps: [] };
  const resumen = { items: 0, conStock: 0, imputados: 0, parecidos: 0, sueltas: 0, lineas: porClaveLinea.size, lineasConStock: 0 };

  for (const f of (almacen || [])) {
    if (!f || f.es_grupo) continue;
    if (f.imputacion === 'fuera') continue;
    const stock = num(f.stock);

    // ── imputado a un insumo del plan: el motor ya lo resta ─────────
    if (f.imputacion === 'insumo' && f.insumo_codigo) {
      const clave = porCodigo.get(String(f.insumo_codigo).trim());
      if (!clave) continue;          // imputado a otro insumo (un material): no es de acá
      if (!(stock > 0) && !(num(f.entradas) > 0)) continue;
      const e = de(clave);
      e.imputados.push(itemDe(f));
      e.stockImputado += stock * (num(f.factor_presupuesto) > 0 ? num(f.factor_presupuesto) : 1);
      resumen.imputados += 1;
      continue;
    }

    if (!TABLAS_HERRAMIENTAS.has(f.tabla)) continue;
    resumen.items += 1;
    // «Ya hay» es lo que HAY: lo que entró y se entregó no está para usar.
    if (!(stock > 0)) continue;
    resumen.conStock += 1;

    // ── parecido por nombre: se muestra, NO se resta ────────────────
    const cabeza = primeraPalabra(f.nombre);
    const cands = prep.filas.length && cabeza
      ? recomendarInsumos(f.nombre, prep, { max: 6, min: UMBRAL_PARECIDO })
        .filter(c => coincide(cabeza, primeraPalabra(c.nombre)))
      : [];
    if (cands.length) {
      // Con un ganador claro, solo ése; con empate («GUANTES» contra «GUANTES
      // DE JEBE» y «GUANTES DE CUERO»), en todas las que empatan: elegir una
      // sería inventar.
      const d = decidirSugerencia(cands);
      const elegidos = d.elegido ? [d.elegido] : cands.filter(c => cands[0].score - c.score < 0.05);
      for (const c of elegidos) de(c.id).parecidos.push(itemDe(f, { score: c.score }));
      resumen.parecidos += 1;
      continue;
    }

    // ── suelto ───────────────────────────────────────────────────────
    (f.tabla === 'epps' ? sueltas.epps : sueltas.herramientas).push(itemDe(f));
    resumen.sueltas += 1;
  }

  const porStock = (a, b) => (b.stock - a.stock) || String(a.nombre).localeCompare(String(b.nombre), 'es');
  for (const e of porClave.values()) {
    e.imputados.sort(porStock);
    e.parecidos.sort((a, b) => (b.score - a.score) || porStock(a, b));
    e.stockImputado = r4(e.stockImputado);
  }
  sueltas.herramientas.sort(porStock);
  sueltas.epps.sort(porStock);
  resumen.lineasConStock = [...porClave.values()]
    .filter(e => e.parecidos.length || e.imputados.some(i => i.stock > 0)).length;

  // El sobre al que van las herramientas sueltas: el mismo criterio que la
  // bandeja de imputación usa para sugerir una línea de orden de herramienta.
  const sobre = (sobres || []).find(s => /herramienta/i.test(String(s?.nombre || '')));

  return { porClave, sueltas, sobreHerramientas: sobre ? sobre.clave : null, resumen };
}
