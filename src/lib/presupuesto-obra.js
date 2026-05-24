// ═══════════════════════════════════════════════════════════════════
// JARVEX — Cálculo del presupuesto de obra (modelo Delphin/S10 peruano)
//
// A partir del Costo Directo (suma de partidas) y los porcentajes /
// otros gastos configurados en la obra, deriva todas las capas:
//
//   Costo Directo (CD)
//   + Utilidades         = CD × utilidad_pct%
//   + Gastos Generales   = CD × gastos_generales_pct%
//   = Sub Total
//   + IGV                = Sub Total × igv_pct%
//   = Valor Referencial
//   + Otros gastos       = Σ otros_gastos[].monto
//   = Costo Total del Proyecto
//
// Reutilizado en: form de obra (preview), import APU (auto-completar),
// comparativo con presupuesto (aplicar tabla del Excel).
// ═══════════════════════════════════════════════════════════════════

/**
 * @param {Object} p
 * @param {number} p.costoDirecto       - suma de totales de las partidas
 * @param {number} [p.utilidadPct=15]   - % utilidad sobre CD
 * @param {number} [p.gastosPct=15]     - % gastos generales sobre CD
 * @param {number} [p.igvPct=18]        - % IGV sobre subtotal
 * @param {Array}  [p.otrosGastos=[]]   - [{concepto, monto}]
 * @returns {{costoDirecto, utilidades, gastosGenerales, subTotal, igv,
 *            valorReferencial, totalOtrosGastos, costoTotal}}
 */
export function calcularPresupuesto({
  costoDirecto = 0,
  utilidadPct = 15,
  gastosPct = 15,
  igvPct = 18,
  otrosGastos = [],
} = {}) {
  const cd = Number(costoDirecto) || 0;
  const uPct = Number(utilidadPct) || 0;
  const gPct = Number(gastosPct) || 0;
  const iPct = Number(igvPct) || 0;

  const utilidades = cd * (uPct / 100);
  const gastosGenerales = cd * (gPct / 100);
  const subTotal = cd + utilidades + gastosGenerales;
  const igv = subTotal * (iPct / 100);
  const valorReferencial = subTotal + igv;
  const totalOtrosGastos = (Array.isArray(otrosGastos) ? otrosGastos : [])
    .reduce((s, g) => s + (Number(g?.monto) || 0), 0);
  const costoTotal = valorReferencial + totalOtrosGastos;

  return {
    costoDirecto: cd,
    utilidades,
    gastosGenerales,
    subTotal,
    igv,
    valorReferencial,
    totalOtrosGastos,
    costoTotal,
  };
}

/** Formato S/ con separador de miles y 2 decimales. */
export function fmtSoles(n) {
  return 'S/ ' + Number(n || 0).toLocaleString('es-PE', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}
