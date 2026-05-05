import { describe, it, expect } from 'vitest';
import {
  CATALOGO_EPP,
  epppTipo,
  epppVidaTexto,
  sumarDiasISO,
} from '../epp-utils.js';

// ──────────────────────────────────────────────────────────
// sumarDiasISO
// ──────────────────────────────────────────────────────────
describe('sumarDiasISO', () => {
  it('2026-01-15 + 30 días = 2026-02-14', () => {
    expect(sumarDiasISO('2026-01-15', 30)).toBe('2026-02-14');
  });

  it('cruza fin de año: 2026-12-31 + 1 = 2027-01-01', () => {
    expect(sumarDiasISO('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('+0 días devuelve la misma fecha', () => {
    expect(sumarDiasISO('2026-05-03', 0)).toBe('2026-05-03');
  });

  it('null como fecha → null', () => {
    expect(sumarDiasISO(null, 30)).toBeNull();
    expect(sumarDiasISO('', 30)).toBeNull();
  });

  it('null como días → null', () => {
    expect(sumarDiasISO('2026-01-15', null)).toBeNull();
  });

  it('+365 días (vida útil de un casco)', () => {
    // 2026 es bisiesto → 2026-01-01 + 365 = 2027-01-01 (si NO bisiesto sería 2026-12-31)
    // 2025 NO es bisiesto: 2025-01-01 + 365 = 2026-01-01
    expect(sumarDiasISO('2025-01-01', 365)).toBe('2026-01-01');
  });
});

// ──────────────────────────────────────────────────────────
// epppVidaTexto
// ──────────────────────────────────────────────────────────
describe('epppVidaTexto', () => {
  it('null → "—"', () => {
    expect(epppVidaTexto(null)).toBe('—');
  });

  it('1 día → "1 día" (singular)', () => {
    expect(epppVidaTexto(1)).toBe('1 día');
  });

  it('3 días → "3 días" (plural)', () => {
    expect(epppVidaTexto(3)).toBe('3 días');
  });

  it('15 días → "2 sem"', () => {
    expect(epppVidaTexto(15)).toBe('2 sem');
  });

  it('7 días → "1 sem"', () => {
    expect(epppVidaTexto(7)).toBe('1 sem');
  });

  it('30 días → "1 meses"', () => {
    // Conserva el comportamiento actual del componente original.
    expect(epppVidaTexto(30)).toBe('1 meses');
  });

  it('90 días → "3 meses"', () => {
    expect(epppVidaTexto(90)).toBe('3 meses');
  });

  it('365 días → "1 año" (singular)', () => {
    expect(epppVidaTexto(365)).toBe('1 año');
  });

  it('730 días → "2 años" (plural)', () => {
    expect(epppVidaTexto(730)).toBe('2 años');
  });
});

// ──────────────────────────────────────────────────────────
// Catálogo EPP
// ──────────────────────────────────────────────────────────
describe('CATALOGO_EPP / epppTipo', () => {
  it('Casco: vida útil 365 días', () => {
    expect(epppTipo('Casco')).toEqual({
      tipo: 'Casco', vida_util_dias: 365, costo_ref: 25,
    });
  });

  it('Mascarilla: vida útil 1 día (descartable)', () => {
    expect(epppTipo('Mascarilla').vida_util_dias).toBe(1);
  });

  it('"Otro" tiene vida_util null', () => {
    expect(epppTipo('Otro').vida_util_dias).toBeNull();
  });

  it('tipo desconocido → null', () => {
    expect(epppTipo('Botiquin')).toBeNull();
  });

  it('CATALOGO_EPP contiene los 10 tipos esperados', () => {
    expect(CATALOGO_EPP).toHaveLength(10);
  });
});
