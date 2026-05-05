import { describe, it, expect } from 'vitest';
import { calcAlerta } from '../stock-utils.js';

describe('calcAlerta — niveles de alerta de stock', () => {
  it('mínimo <= 0 → "ok" (no se monitoriza)', () => {
    expect(calcAlerta(100, 0)).toBe('ok');
    expect(calcAlerta(0, 0)).toBe('ok');
    expect(calcAlerta(50, -5)).toBe('ok');
  });

  it('stock 0 con mínimo > 0 → "agotado"', () => {
    expect(calcAlerta(0, 50)).toBe('agotado');
  });

  it('stock <= 50% del mínimo → "critico"', () => {
    // mínimo 100 → crítico si stock <= 50
    expect(calcAlerta(50, 100)).toBe('critico');
    expect(calcAlerta(25, 100)).toBe('critico');
    expect(calcAlerta(1,  100)).toBe('critico');
  });

  it('stock entre 50% y 100% del mínimo → "reponer"', () => {
    expect(calcAlerta(51, 100)).toBe('reponer');
    expect(calcAlerta(80, 100)).toBe('reponer');
    expect(calcAlerta(100, 100)).toBe('reponer'); // exactamente el mínimo
  });

  it('stock entre 100% y 120% del mínimo → "cerca"', () => {
    expect(calcAlerta(110, 100)).toBe('cerca');
    expect(calcAlerta(120, 100)).toBe('cerca');
  });

  it('stock > 120% del mínimo → "ok"', () => {
    expect(calcAlerta(121, 100)).toBe('ok');
    expect(calcAlerta(500, 100)).toBe('ok');
  });

  it('strings numéricos se castean correctamente', () => {
    expect(calcAlerta('25', '100')).toBe('critico');
    expect(calcAlerta('150', '100')).toBe('ok');
  });

  it('valores undefined / null se tratan como 0', () => {
    expect(calcAlerta(undefined, 100)).toBe('agotado');
    expect(calcAlerta(null, 100)).toBe('agotado');
  });
});
