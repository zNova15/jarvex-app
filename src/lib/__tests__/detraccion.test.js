// Las reglas de detracción de Gabriel (25-set-2026), en un solo lugar.
import { describe, it, expect } from 'vitest';
import {
  UMBRAL_DETRACCION, montoDetraccion, totalEnSoles, sujetaPorMonto, liquidarValorizacion, propuestaDetraccion,
} from '../detraccion.js';

describe('montoDetraccion', () => {
  it('en soles y a 2 decimales', () => {
    expect(montoDetraccion({ total: 12345.67, pct: 4 })).toBe(493.83);
  });
  it('🔴 en dólares se deposita en soles, al tipo de cambio', () => {
    // 432 × 3,352 = S/ 1.448,06 → 12 % = 173,77
    expect(montoDetraccion({ total: 432, moneda: 'USD', tipoCambio: 3.352, pct: 12 })).toBe(173.77);
  });
  it('en dólares sin tasa no hay monto', () => {
    expect(montoDetraccion({ total: 432, moneda: 'USD', pct: 12 })).toBe(null);
  });
  it('total en soles', () => {
    expect(totalEnSoles({ total: 100, moneda: 'USD', tipoCambio: 3.5 })).toBe(350);
    expect(totalEnSoles({ total: 100, moneda: 'USD' })).toBe(null);
  });
});

describe('umbral', () => {
  it('S/ 700 exactos NO están sujetos; S/ 700,01 sí', () => {
    expect(UMBRAL_DETRACCION).toBe(700);
    expect(sujetaPorMonto(700)).toBe(false);
    expect(sujetaPorMonto(700.01)).toBe(true);
  });
});

describe('liquidarValorizacion — se emite por el BRUTO (Gabriel, 25-set-2026)', () => {
  it('🔴 adelanto y garantía no achican la base ni el IGV; la detracción es 4 %', () => {
    const l = liquidarValorizacion({ bruto: 100000, adelantos: 10000, retenciones: 5000 });
    expect(l.base).toBe(100000);
    expect(l.igv).toBe(18000);
    expect(l.total).toBe(118000);
    expect(l.detraccion).toBe(4720);
    expect(l.neto).toBe(118000 - 4720 - 10000 - 5000);
  });
  it('una valorización chica (≤ S/ 700 con IGV) no lleva detracción', () => {
    expect(liquidarValorizacion({ bruto: 500 }).detraccion).toBe(0);
  });
  it('la penalidad se descuenta del neto, no de la base', () => {
    const l = liquidarValorizacion({ bruto: 10000, penalidad: 300, detraccionPct: 4 });
    expect(l.base).toBe(10000);
    expect(l.neto).toBe(11800 - 472 - 300);
  });
});

describe('propuestaDetraccion', () => {
  it('el código con tasa única manda sobre el texto', () => {
    const p = propuestaDetraccion({ amount: 1000, detraccion_codigo: '027', description: 'VALORIZACION' });
    expect(p.pct).toBe(4);
    expect(p.origen).toBe('codigo');
  });
  it('el 019 tiene dos tasas: el código no alcanza y se mira el texto', () => {
    const p = propuestaDetraccion({ amount: 1000, detraccion_codigo: '019', description: 'ALQUILER DE RETRO' });
    expect(p).toBe(null);
  });
});
