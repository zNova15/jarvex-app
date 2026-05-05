import { describe, it, expect } from 'vitest';
import {
  calcMesesComputables,
  rangoPeriodo,
  calcRemuneracionComputable,
  calcCTS,
  calcGratificacion,
} from '../payroll-utils.js';

// ──────────────────────────────────────────────────────────
// rangoPeriodo
// ──────────────────────────────────────────────────────────
describe('rangoPeriodo', () => {
  it('CTS mayo: noviembre año-1 → abril año', () => {
    expect(rangoPeriodo('cts', 'mayo', 2026)).toEqual({
      startYear: 2025, startMonth: 11, endYear: 2026, endMonth: 4,
    });
  });

  it('CTS noviembre: mayo → octubre del mismo año', () => {
    expect(rangoPeriodo('cts', 'noviembre', 2026)).toEqual({
      startYear: 2026, startMonth: 5, endYear: 2026, endMonth: 10,
    });
  });

  it('Grati julio: enero → junio', () => {
    expect(rangoPeriodo('grati', 'julio', 2026)).toEqual({
      startYear: 2026, startMonth: 1, endYear: 2026, endMonth: 6,
    });
  });

  it('Grati diciembre: julio → diciembre', () => {
    expect(rangoPeriodo('grati', 'diciembre', 2026)).toEqual({
      startYear: 2026, startMonth: 7, endYear: 2026, endMonth: 12,
    });
  });
});

// ──────────────────────────────────────────────────────────
// calcMesesComputables
// ──────────────────────────────────────────────────────────
describe('calcMesesComputables', () => {
  const ranGratiJulio = rangoPeriodo('grati', 'julio', 2026);
  const ranCtsMayo    = rangoPeriodo('cts', 'mayo', 2026);

  it('fechaIngreso vacía → 0 meses', () => {
    expect(calcMesesComputables(null, ranGratiJulio)).toBe(0);
    expect(calcMesesComputables('', ranGratiJulio)).toBe(0);
  });

  it('trabajador con 6 meses completos en grati julio 2026', () => {
    // Ingreso antes del periodo → 6 meses completos
    expect(calcMesesComputables('2025-12-01', ranGratiJulio)).toBe(6);
    expect(calcMesesComputables('2026-01-01', ranGratiJulio)).toBe(6);
  });

  it('ingreso 2026-03-15 → cuenta marzo (17 días) + abr+may+jun = 4 meses', () => {
    expect(calcMesesComputables('2026-03-15', ranGratiJulio)).toBe(4);
  });

  it('ingreso 2026-04-16 → abril cuenta (15 días) + may + jun = 3 meses', () => {
    expect(calcMesesComputables('2026-04-16', ranGratiJulio)).toBe(3);
  });

  it('ingreso 2026-04-17 → abril NO cuenta (14 días < 15) + may + jun = 2 meses', () => {
    expect(calcMesesComputables('2026-04-17', ranGratiJulio)).toBe(2);
  });

  it('ingreso 2026-06-20 → junio solo 11 días (< 15) → 0 meses', () => {
    expect(calcMesesComputables('2026-06-20', ranGratiJulio)).toBe(0);
  });

  it('ingreso posterior al periodo → 0 meses', () => {
    expect(calcMesesComputables('2027-01-01', ranGratiJulio)).toBe(0);
  });

  it('CTS mayo 2026: 6 meses completos si ingresó antes', () => {
    expect(calcMesesComputables('2025-11-01', ranCtsMayo)).toBe(6);
    expect(calcMesesComputables('2025-01-01', ranCtsMayo)).toBe(6);
  });
});

// ──────────────────────────────────────────────────────────
// calcRemuneracionComputable
// ──────────────────────────────────────────────────────────
describe('calcRemuneracionComputable', () => {
  it('básico + asignación + bonos (sin sexto grati)', () => {
    expect(calcRemuneracionComputable({
      sueldo_basico: 1500, asignacion_familiar: 102.5, bonificaciones_fijas: 0,
    })).toBe(1602.5);
  });

  it('con sexto grati: básico 1500 + grati 1500 / 6 = 1750', () => {
    expect(calcRemuneracionComputable({
      sueldo_basico: 1500, asignacion_familiar: 0, bonificaciones_fijas: 0,
      ultima_gratificacion: 1500,
    }, { incluirSextoGrati: true })).toBe(1750);
  });

  it('sin ultima_gratificacion usa básico+asig como fallback', () => {
    // 1500 + 0 + 0 + (1500+0)/6 = 1750
    expect(calcRemuneracionComputable({
      sueldo_basico: 1500, asignacion_familiar: 0, bonificaciones_fijas: 0,
    }, { incluirSextoGrati: true })).toBe(1750);
  });

  it('contrato vacío/undefined → 0', () => {
    expect(calcRemuneracionComputable(null)).toBe(0);
    expect(calcRemuneracionComputable({})).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────
// calcCTS  (remComp × meses / 12)
// ──────────────────────────────────────────────────────────
describe('calcCTS', () => {
  it('6 meses con remComp 1750 → 875 (semestre completo)', () => {
    expect(calcCTS(1750, 6)).toBe(875);
  });

  it('3 meses con remComp 1750 → 437.5', () => {
    expect(calcCTS(1750, 3)).toBe(437.5);
  });

  it('0 meses → 0', () => {
    expect(calcCTS(1750, 0)).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────
// calcGratificacion  (remComp × meses / 6) + 9% bonif.
// ──────────────────────────────────────────────────────────
describe('calcGratificacion', () => {
  it('semestre completo (6 meses) con remComp 1500 → grati 1500 + 9% bonif', () => {
    const r = calcGratificacion(1500, 6);
    expect(r.grati).toBe(1500);
    expect(r.bonif).toBe(135);   // 1500 × 0.09
    expect(r.total).toBe(1635);
  });

  it('3 meses con remComp 1500 → grati 750 + bonif 67.5 = 817.5', () => {
    const r = calcGratificacion(1500, 3);
    expect(r.grati).toBe(750);
    expect(r.bonif).toBe(67.5);
    expect(r.total).toBe(817.5);
  });

  it('sin bonificación EsSalud (régimen sin EsSalud) → bonif 0', () => {
    const r = calcGratificacion(1500, 6, { aplicaBonifEsSalud: false });
    expect(r.grati).toBe(1500);
    expect(r.bonif).toBe(0);
    expect(r.total).toBe(1500);
  });

  it('0 meses → grati 0', () => {
    const r = calcGratificacion(1500, 0);
    expect(r.grati).toBe(0);
    expect(r.bonif).toBe(0);
    expect(r.total).toBe(0);
  });
});
