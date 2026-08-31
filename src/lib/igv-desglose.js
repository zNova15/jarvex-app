// ─────────────────────────────────────────────────────────────
//  DESGLOSE REAL DE BASE IMPONIBLE E IGV DE UN MOVIMIENTO
//
//  Hallazgo de las contadoras (31-ago-2026): el Libro Diario INVENTABA el
//  desglose. `accounting_movements` no tiene columnas subtotal/igv_amount, así
//  que el generador de asientos hacía siempre `base = total / 1.18` y repartía
//  70 / 4011 al 18 %. Con la factura E001-263 (total S/3,109) eso asentaba
//  S/2,634.75 a ventas y S/474.25 de IGV cuando el IGV REAL del comprobante
//  era S/9.00.
//
//  El desglose real YA ESTABA: Captura Mágica lo guarda dentro del JSON de
//  `notas` ({ subtotal, igv }) desde el primer día — 1,132 de 1,212 movimientos
//  de producción lo tienen. Esta lib lo lee y lo prefiere SIEMPRE por encima
//  del 18 % inventado.
//
//  Por qué importa (confirmado por las contadoras): las facturas de COMIDA en
//  Perú van con tasa especial —8 % IGV + 2 % IPM = 10 % del total— y en
//  producción hay 54 comprobantes al 10/10.5 % y 58 sin IGV. Asentarlos al
//  18 % inflaba el crédito fiscal y ensuciaba la repartición 70/4011.
//
//  REGLA DE ORO CUANDO EL COMPROBANTE TRAE IGV REAL:
//      IGV      = el del comprobante (tal cual)
//      base     = total − IGV
//  La base absorbe lo NO gravado (exonerado, inafecto, ICBPER, bolsa) — que es
//  exactamente lo correcto en PCGE: las cuentas 60/63/70 llevan el valor de la
//  operación sea gravada o no. Así el asiento SIEMPRE cuadra sin falsear el
//  tributo, que es la línea que la contadora manda a SUNAT.
//
//  Funciones puras. Testeadas en __tests__/igv-desglose.test.js.
// ─────────────────────────────────────────────────────────────

export const IGV_RATE = 0.18;
const TOL = 0.02;

function r2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * `notas` es text: a veces JSON (Captura Mágica, comprobantes electrónicos,
 * facturas internas) y a veces texto suelto (valorizaciones, subcontratos).
 * Nunca debe reventar.
 */
export function parseNotasSeguro(notas) {
  if (!notas) return {};
  if (typeof notas === 'object') return notas;
  const s = String(notas).trim();
  if (!s.startsWith('{')) return {};
  try {
    const o = JSON.parse(s);
    return (o && typeof o === 'object') ? o : {};
  } catch { return {}; }
}

/**
 * Candidatos de desglose, en orden de prioridad. El primero que sea USABLE gana.
 * - columnas explícitas subtotal/igv_amount (no existen hoy en la tabla, pero
 *   el generador ya las leía y algún día podrían agregarse)
 * - notas.subtotal / notas.igv        → Captura Mágica y comprobantes emitidos
 * - notas.factura.{subtotal,igv}      → facturas internas (cadenas intercompany)
 * - factura_interna_meta.{subtotal,igv} → misma info, en su columna jsonb
 */
function candidatos(mov) {
  const m = mov || {};
  const n = parseNotasSeguro(m.notas);
  const fi = (m.factura_interna_meta && typeof m.factura_interna_meta === 'object') ? m.factura_interna_meta : {};
  const nf = (n.factura && typeof n.factura === 'object') ? n.factura : {};
  return [
    { sub: num(m.subtotal), igv: num(m.igv_amount) },
    { sub: num(n.subtotal), igv: num(n.igv) },
    { sub: num(nf.subtotal), igv: num(nf.igv) },
    { sub: num(fi.subtotal), igv: num(fi.igv) },
  ];
}

/**
 * Desglosa un movimiento en base imponible + IGV.
 *
 * @param {object} mov accounting_movements row
 * @returns {{
 *   total:number, subtotal:number, igv:number,
 *   tasaPct:number,
 *   origen:'comprobante'|'estimado'|'no_gravado',
 *   baseGravada:number|null, noGravado:number,
 *   estimado:boolean
 * }}
 *   Los tres montos conservan el SIGNO de `amount` (una nota de crédito
 *   devuelve valores negativos), aunque el desglose guardado en `notas` venga
 *   siempre positivo. `tasaPct` es la tasa real del comprobante (0, 10, 18…).
 */
export function desglosarIgv(mov) {
  const m = mov || {};
  const total = r2(Number(m.amount || 0));
  const signo = total < 0 ? -1 : 1;
  const absTotal = Math.abs(total);

  const salida = (igvAbs, origen, baseGravadaAbs) => {
    const igvFinal = r2(Math.min(Math.max(igvAbs, 0), absTotal));
    const subFinal = r2(absTotal - igvFinal);
    const base = (baseGravadaAbs != null && baseGravadaAbs > 0) ? r2(baseGravadaAbs) : null;
    const refBase = base != null ? base : subFinal;
    return {
      total,
      subtotal: r2(subFinal * signo),
      igv: r2(igvFinal * signo),
      tasaPct: refBase > 0 ? Math.round((igvFinal / refBase) * 1000) / 10 : 0,
      origen,
      baseGravada: base != null ? r2(base * signo) : null,
      // Parte del total que NO paga IGV (exonerado / inafecto / ICBPER):
      // solo se puede afirmar cuando el comprobante trajo su base gravada.
      noGravado: (base != null && subFinal - base > TOL) ? r2((subFinal - base) * signo) : 0,
      estimado: origen === 'estimado',
    };
  };

  for (const c of candidatos(m)) {
    if (c.sub == null && c.igv == null) continue;
    // Ambos en cero = el OCR no leyó nada (no es un comprobante exonerado:
    // ese trae subtotal = total con igv 0). No sirve como desglose.
    if ((c.sub || 0) === 0 && (c.igv || 0) === 0) continue;
    const subAbs = c.sub == null ? null : Math.abs(c.sub);
    const igvAbs = c.igv != null ? Math.abs(c.igv)
      : (subAbs != null ? Math.max(absTotal - subAbs, 0) : null);
    if (igvAbs == null) continue;
    return salida(igvAbs, 'comprobante', subAbs);
  }

  // Sin desglose guardado. Operación marcada como no gravada → IGV 0.
  if (m.tax_exemption_code && String(m.tax_exemption_code) !== '10') {
    return salida(0, 'no_gravado', null);
  }

  // Último recurso: estimar al 18 %. Queda MARCADO como estimado para que el
  // Libro Diario lo muestre y nadie lo confunda con el dato del comprobante.
  return salida(r2(absTotal - absTotal / (1 + IGV_RATE)), 'estimado', null);
}

/** "10% (del comprobante)" / "18% estimado" / "sin IGV" — para glosas y badges. */
export function describirIgv(d) {
  if (!d) return '';
  if (d.origen === 'estimado') return `${Math.round(IGV_RATE * 100)}% estimado`;
  if (Math.abs(d.igv) < 0.005) return 'sin IGV';
  const t = Number(d.tasaPct || 0);
  const txt = Number.isInteger(t) ? String(t) : t.toFixed(1);
  return `${txt}% del comprobante`;
}

/**
 * ¿Vale la pena avisarle a la contadora? Solo cuando el desglose es estimado
 * (no vino en el comprobante) o cuando la tasa real NO es la general del 18 %.
 * Evita ensuciar el Libro Diario con un badge en cada una de las 988 facturas
 * normales.
 */
export function igvDestacable(d) {
  if (!d) return false;
  if (d.origen === 'estimado') return true;
  return Math.abs(Number(d.tasaPct || 0) - 18) > 0.5;
}

export default { IGV_RATE, desglosarIgv, describirIgv, igvDestacable, parseNotasSeguro };
