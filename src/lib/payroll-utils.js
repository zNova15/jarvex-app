// ══════════════════════════════════════════════════════════════════════════
//  Payroll utils — CTS y Gratificaciones (Perú)
//  Extraídas de jx-cts-grati.jsx para que sean testeables.
//
//  Reglas peruanas resumidas:
//   • CTS:
//      - Periodo "mayo"      = 1-Nov año-1  →  30-Abr año
//      - Periodo "noviembre" = 1-May año    →  31-Oct año
//      - Mes computa si el trabajador estuvo ≥ 15 días en él.
//      - Remuneración computable = básico + asignación + bonos + 1/6 grati
//      - CTS = remComp × meses / 12
//   • Gratificación (Julio = ene-jun, Diciembre = jul-dic):
//      - remComp = básico + asignación + bonos (sin sexto de grati)
//      - Grati = remComp × meses / 6
//      - Bonificación extraordinaria 9% de la grati (Ley 30334).
// ══════════════════════════════════════════════════════════════════════════

// Calcula los meses computables (regla: ≥ 15 días en el mes ⇒ mes completo).
// rango = { startYear, startMonth (1-12), endYear, endMonth (1-12) }
// fechaIngreso: 'YYYY-MM-DD'
export function calcMesesComputables(fechaIngreso, rango) {
  if (!fechaIngreso) return 0;
  const ing = new Date(fechaIngreso + 'T00:00:00');
  if (Number.isNaN(ing.getTime())) return 0;
  let meses = 0;
  for (let y = rango.startYear, m = rango.startMonth; ; ) {
    const cy = y, cm = m;
    const inicioMes = new Date(cy, cm - 1, 1);
    const finMes    = new Date(cy, cm, 0);
    if (ing <= inicioMes) {
      meses += 1;
    } else if (ing > finMes) {
      // No cuenta nada
    } else {
      const dias = Math.floor((finMes - ing) / (1000*60*60*24)) + 1;
      if (dias >= 15) meses += 1;
    }
    if (cy === rango.endYear && cm === rango.endMonth) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    if (y > rango.endYear + 2) break; // safety
  }
  return meses;
}

// Devuelve el rango de meses para un periodo de CTS o Grati.
//   tipo:    'cts' | 'grati'
//   periodo: 'mayo' | 'noviembre' (cts) | 'julio' | 'diciembre' (grati)
export function rangoPeriodo(tipo, periodo, anio) {
  if (tipo === 'cts') {
    if (periodo === 'mayo')      return { startYear: anio - 1, startMonth: 11, endYear: anio,     endMonth: 4 };
    if (periodo === 'noviembre') return { startYear: anio,     startMonth: 5,  endYear: anio,     endMonth: 10 };
  } else {
    if (periodo === 'julio')     return { startYear: anio,     startMonth: 1,  endYear: anio,     endMonth: 6 };
    if (periodo === 'diciembre') return { startYear: anio,     startMonth: 7,  endYear: anio,     endMonth: 12 };
  }
  return { startYear: anio, startMonth: 1, endYear: anio, endMonth: 12 };
}

// Remuneración computable = sueldo básico + asignación familiar + bonificaciones permanentes.
// Para CTS suma además 1/6 de la última gratificación (opts.incluirSextoGrati).
export function calcRemuneracionComputable(contrato, opts = {}) {
  const basico = Number(contrato?.sueldo_basico || 0);
  const asig   = Number(contrato?.asignacion_familiar || 0);
  const bonos  = Number(contrato?.bonificaciones_fijas || 0);
  let base = basico + asig + bonos;
  if (opts.incluirSextoGrati) {
    const grati = Number(contrato?.ultima_gratificacion || (basico + asig));
    base += grati / 6;
  }
  return +base.toFixed(2);
}

// CTS = remComp × (meses / 12)
export function calcCTS(remComp, meses) {
  return +(Number(remComp || 0) * (Number(meses || 0) / 12)).toFixed(2);
}

// Gratificación = remComp × (meses / 6); bonif extraord 9% si aplica EsSalud.
// Devuelve { grati, bonif, total }.
export function calcGratificacion(remComp, meses, { aplicaBonifEsSalud = true } = {}) {
  const grati = +(Number(remComp || 0) * (Number(meses || 0) / 6)).toFixed(2);
  const bonif = aplicaBonifEsSalud ? +(grati * 0.09).toFixed(2) : 0;
  const total = +(grati + bonif).toFixed(2);
  return { grati, bonif, total };
}
