// ═══════════════════════════════════════════════════════════════════
// JARVEX — SIMULADOR DE ÓRDENES: CÓMO SE COMPRA CADA INSUMO (ronda 2, tanda 2.2)
//
// Diseño en `docs/plan-simulador-ordenes.md` §12-§13. El presupuesto está en
// la unidad del EXPEDIENTE y nadie compra así: la tubería viene en metros y se
// pide por tubo, la madera en pies² y se pide por pieza, el reparto parejo
// deja «3,37 bol» de cemento en un mes. Este módulo contesta, por insumo:
//
//   · en qué unidad se PIDE y cuántas unidades del expediente trae cada una
//     (el `factor`: un tubo de 6 m = 6 m);
//   · de a cuánto se pide (el `lote`, en unidades de compra; default 1);
//   · cuánto colchón se le pone por robo, rotura o merma (0% por defecto).
//
// ── DE DÓNDE SALE EL DEFAULT: DEL NOMBRE, NO DE UNA TABLA ─────────
// Medido en Miraflores el 24-set-2026: el propio expediente dice la
// presentación en el nombre del insumo — «TUBERIA PVC UF S25 DE 8" x 6m»,
// «TUBERIA PVC SAL 2" x 3 m», «MADERA TORNILLO 1"x 8"x8'». Leer eso NO es
// inventar: es el dato que el ingeniero ya escribió. Donde el nombre no lo
// dice («MADERA TORNILLO PARA ENCOFRADO», «ACERO CORRUGADO fy=4200» sin
// diámetro) la unidad de compra es la del expediente, 1:1, y lo único que
// cambia es que se pide en enteros.
//
// La única tabla de este archivo es la de pesos de la varilla corrugada
// (NTP 341.031 / ASTM A615, varilla de 9 m): es la norma, no una
// estimación. Y solo se usa cuando el nombre trae el diámetro.
//
// ── EL COLCHÓN NO TIENE DEFAULT, A PROPÓSITO ──────────────────────
// Decisión de Gabriel (24-set-2026): 0% salvo que él lo ponga, insumo por
// insumo. No hay «5% para agregados» de oficio: un porcentaje sugerido por el
// motor es plata que nadie decidió gastar.
//
// ── EL REDONDEO ES ACUMULADO, NO POR PERÍODO ──────────────────────
// Redondear cada mes hacia arriba sobrepide todos los meses. Medido en
// Miraflores: redondear período por período costaba S/ 149.692 de más;
// acumulado, S/ 8.048 en toda la obra. Se pide lo que falta para llegar al
// entero de arriba de lo necesitado HASTA ESE PERÍODO, así que el total nunca
// se pasa por más de un lote, y un período que no llega al lote (0,39 m³ de
// arena) se junta con el anterior en vez de pedir otro metro cúbico.
//
// Testeado en __tests__/simulador-compra.test.js
// ═══════════════════════════════════════════════════════════════════

import { normUnidad } from './insumo-clasificador.js';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r4 = (n) => Math.round((num(n) + Number.EPSILON) * 10000) / 10000;
// Las fracciones del reparto parejo (1/3, 1/7…) sumadas dan 15,9999999 o
// 16,0000001. Sin esto, 16 bolsas exactas se piden como 17.
const r6 = (n) => Math.round(num(n) * 1e6) / 1e6;

const decimal = (s) => Number(String(s).replace(',', '.'));
const fmt = (n) => String(r4(n)).replace('.', ',');

/**
 * Kilos por metro de la varilla corrugada, por diámetro nominal.
 * NTP 341.031 / ASTM A615 — la varilla comercial es de 9 m.
 */
export const KG_POR_METRO_VARILLA = {
  '6mm': 0.222, '8mm': 0.395, '3/8"': 0.560, '12mm': 0.888,
  '1/2"': 0.994, '5/8"': 1.552, '3/4"': 2.235, '1"': 3.973,
};
export const LARGO_VARILLA_M = 9;

const UNIDADES_METRO = new Set(['m', 'ml', 'mts', 'mt']);
const UNIDADES_PIE2 = new Set(['p²', 'p2', 'pie2', 'pies2', 'pt', 'p2.']);

/**
 * La presentación de compra que el NOMBRE del insumo declara, o null.
 *
 * @returns {{unidadCompra:string, factor:number, motivo:string}|null}
 */
export function sugerirUnidadCompra(nombre, unidad) {
  const n = String(nombre || '');
  const u = normUnidad(unidad);

  // Tubería por largo de tubo: «… x 6m», «X 5 m». Solo si el nombre ARRANCA
  // con tubo/tubería: «SOPORTE … x0.70m» es otra cosa.
  if (UNIDADES_METRO.has(u) && /^\s*tub(o|er[ií]a)\b/i.test(n)) {
    const m = /\bx\s*(\d+(?:[.,]\d+)?)\s*m\b/i.exec(n);
    const largo = m ? decimal(m[1]) : NaN;
    if (Number.isFinite(largo) && largo >= 1 && largo <= 12) {
      return {
        unidadCompra: `tubo de ${fmt(largo)} m`,
        factor: r4(largo),
        motivo: `El nombre dice «${m[0].trim()}»: se pide por tubo de ${fmt(largo)} m.`,
      };
    }
  }

  // Madera por pieza: «1"x 8"x8'» son pies tablares (pulgada × pulgada × pie / 12).
  if (UNIDADES_PIE2.has(u)) {
    const m = /(\d+(?:[.,]\d+)?)\s*"\s*x\s*(\d+(?:[.,]\d+)?)\s*"\s*x\s*(\d+(?:[.,]\d+)?)\s*'/i.exec(n);
    if (m) {
      const [a, b, c] = [m[1], m[2], m[3]].map(decimal);
      const pies = r4((a * b * c) / 12);
      if (pies > 0) {
        return {
          unidadCompra: `pieza de ${fmt(a)}"x${fmt(b)}"x${fmt(c)}'`,
          factor: pies,
          motivo: `El nombre dice ${fmt(a)}"×${fmt(b)}"×${fmt(c)}': cada pieza son ${fmt(pies)} p².`,
        };
      }
    }
  }

  // Varilla corrugada: solo con el diámetro en el nombre. «ACERO CORRUGADO
  // fy=4200» a secas no dice qué varilla es, y adivinarla sería inventar.
  if (u === 'kg' && /(acero|fierro)\s+corrugado|varilla/i.test(n)) {
    // «1 3/8"» no es la de 3/8": el entero delante la vuelve otra varilla,
    // que no está en la tabla. Sin lookbehind a propósito — un navegador
    // viejo lo rechaza al parsear y el módulo entero no carga.
    const pulg = /(^|[^\d/])(\d\s+)?(3\/8|1\/2|5\/8|3\/4|1)\s*"/.exec(n);
    const mm = /\b(6|8|12)\s*mm\b/i.exec(n);
    const diam = (pulg && !pulg[2]) ? `${pulg[3]}"` : mm ? `${mm[1]}mm` : null;
    const kgm = diam ? KG_POR_METRO_VARILLA[diam] : null;
    if (kgm) {
      const kg = r4(kgm * LARGO_VARILLA_M);
      return {
        unidadCompra: `varilla de ${diam} x ${LARGO_VARILLA_M} m`,
        factor: kg,
        motivo: `Varilla de ${diam}: ${fmt(kgm)} kg/m × ${LARGO_VARILLA_M} m = ${fmt(kg)} kg (NTP 341.031).`,
      };
    }
  }

  return null;
}

/**
 * Lo que la persona fijó a mano para un insumo, saneado. Nunca tira: una
 * configuración vieja o rota vuelve a los defaults.
 *
 * `unidadCompra` y `factor` van JUNTOS: una unidad sin su factor no dice
 * cuánto del presupuesto cubre, y un factor sin su unidad no se puede leer.
 */
export function normalizarCompra(cfg) {
  if (!cfg || typeof cfg !== 'object') return {};
  const out = {};
  const f = Number(cfg.factor);
  if (Number.isFinite(f) && f > 0) {
    out.factor = r4(f);
    const uc = String(cfg.unidadCompra || '').trim();
    if (uc) out.unidadCompra = uc;
  }
  const l = Number(cfg.lote);
  if (Number.isFinite(l) && l > 0) out.lote = r4(l);
  const c = Number(cfg.colchonPct);
  if (Number.isFinite(c) && c > 0) out.colchonPct = Math.min(100, r4(c));
  return out;
}

/**
 * Cómo se compra un insumo: lo fijado a mano, o lo que dice su nombre, o la
 * unidad del expediente 1:1 — en ese orden.
 *
 * @returns {{unidadExpediente:string, unidadCompra:string, factor:number,
 *            lote:number, colchonPct:number,
 *            origen:'manual'|'nombre'|'expediente', motivo:string,
 *            sugerida:Object|null}}
 */
export function resolverCompra(cfg, { nombre = '', unidad = '' } = {}) {
  const c = normalizarCompra(cfg);
  const sugerida = sugerirUnidadCompra(nombre, unidad);
  const unidadExpediente = String(unidad || '');
  let unidadCompra = unidadExpediente, factor = 1, origen = 'expediente';
  let motivo = 'Se pide en la unidad del expediente, en enteros.';
  if (c.factor != null) {
    factor = c.factor;
    unidadCompra = c.unidadCompra || unidadExpediente;
    origen = 'manual';
    motivo = factor === 1 && unidadCompra === unidadExpediente
      ? 'Fijado a mano: en la unidad del expediente.'
      : `Fijado a mano: 1 ${unidadCompra} = ${fmt(factor)} ${unidadExpediente}.`;
  } else if (sugerida) {
    ({ unidadCompra, factor, motivo } = sugerida);
    origen = 'nombre';
  }
  return {
    unidadExpediente, unidadCompra, factor,
    lote: c.lote || 1,
    colchonPct: c.colchonPct || 0,
    origen, motivo, sugerida,
  };
}

/**
 * Lleva una serie de necesidades por período (en unidades del EXPEDIENTE, ya
 * en orden cronológico) a cantidades que se pueden pedir.
 *
 * Redondeo ACUMULADO: en cada período se pide lo que falta para que lo pedido
 * hasta ahí llegue al lote de arriba de lo necesitado hasta ahí. Un período
 * cuya necesidad ya quedó cubierta por el redondeo de uno anterior pide 0 —
 * quien llame lo saca de la orden—, y `alcanzaHasta` dice hasta qué período
 * alcanza lo que se pide en cada uno.
 *
 * @param {Array<number>} necesidades   en unidades del expediente, ≥ 0.
 * @param {{factor?:number, lote?:number}} o
 * @returns {Array<{cantidad:number, alcanzaHasta:number}>}
 *   `cantidad` en unidades de COMPRA; `alcanzaHasta` es un índice de la serie.
 */
export function cantidadesDeCompra(necesidades = [], { factor = 1, lote = 1 } = {}) {
  const f = num(factor) > 0 ? num(factor) : 1;
  const L = num(lote) > 0 ? num(lote) : 1;
  const acumNecesidad = [];
  let C = 0;
  for (const x of necesidades) { C += Math.max(0, num(x)) / f; acumNecesidad.push(r6(C)); }

  const out = [];
  let pedido = 0;
  for (let i = 0; i < acumNecesidad.length; i++) {
    const objetivo = r6(Math.ceil(r6(acumNecesidad[i] / L)) * L);
    const cantidad = Math.max(0, r6(objetivo - pedido));
    pedido = Math.max(pedido, objetivo);
    let hasta = i;
    while (hasta + 1 < acumNecesidad.length && acumNecesidad[hasta + 1] <= pedido + 1e-6) hasta += 1;
    out.push({ cantidad: r4(cantidad), alcanzaHasta: hasta });
  }
  return out;
}
