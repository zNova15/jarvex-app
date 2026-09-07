// El toggle «los precios ya traen IGV»: que el total cuadre con el papel que
// la persona tiene delante, en las dos direcciones.
import { describe, it, expect } from 'vitest';
import {
  totalesConModoIgv, precioSinIgv, precioConIgv, lineasNormalizadas,
} from '../precios-igv.js';

const L = [{ cantidad: 10, precio_unitario: 100 }];

describe('totalesConModoIgv', () => {
  it('sin IGV incluido: el precio es valor de venta y el IGV se suma', () => {
    const t = totalesConModoIgv(L, { igvPct: 18 });
    expect(t.valorVenta).toBe(1000);
    expect(t.igv).toBe(180);
    expect(t.total).toBe(1180);
  });

  it('🔴 con IGV incluido: el TOTAL es lo tipeado y la base se despeja', () => {
    const t = totalesConModoIgv(L, { igvPct: 18, preciosIncluyenIgv: true });
    expect(t.total).toBe(1000);
    expect(t.valorVenta).toBe(847.46);
    expect(t.igv).toBe(152.54);
    // Y cuadra exacto: la base absorbe el redondeo, nunca el tributo.
    expect(t.valorVenta + t.igv).toBe(t.total);
  });

  it('con IGV en 0 las dos ramas dan lo mismo y no hay NaN', () => {
    const a = totalesConModoIgv(L, { igvPct: 0 });
    const b = totalesConModoIgv(L, { igvPct: 0, preciosIncluyenIgv: true });
    expect(a).toMatchObject({ valorVenta: 1000, igv: 0, total: 1000 });
    expect(b.total).toBe(1000);
    expect(b.valorVenta).toBe(1000);
  });

  it('la tasa especial de comida (10%) funciona igual', () => {
    const t = totalesConModoIgv([{ cantidad: 1, precio_unitario: 110 }], { igvPct: 10, preciosIncluyenIgv: true });
    expect(t.total).toBe(110);
    expect(t.valorVenta).toBe(100);
    expect(t.igv).toBe(10);
  });

  it('sin líneas no revienta', () => {
    expect(totalesConModoIgv([], {}).total).toBe(0);
    expect(totalesConModoIgv(null, {}).total).toBe(0);
  });

  it('una línea borrada no suma', () => {
    expect(totalesConModoIgv([...L, { cantidad: 5, precio_unitario: 9, deleted_at: 'x' }], {}).valorVenta).toBe(1000);
  });
});

describe('precioSinIgv / precioConIgv', () => {
  it('sin el toggle el precio pasa tal cual', () => {
    expect(precioSinIgv(100, { igvPct: 18 })).toBe(100);
  });

  it('con el toggle despeja, y guarda 6 decimales para que el total no descuadre', () => {
    const p = precioSinIgv(29.9, { igvPct: 18, preciosIncluyenIgv: true });
    expect(p).toBeCloseTo(25.338983, 6);
    // 🔴 A dos decimales, 11.269 bolsas descuadran el documento en soles.
    expect(Math.abs(11269 * p * 1.18 - 11269 * 29.9)).toBeLessThan(0.05);
  });

  it('ida y vuelta devuelve el mismo número', () => {
    const sin = precioSinIgv(59, { igvPct: 18, preciosIncluyenIgv: true });
    expect(precioConIgv(sin, { igvPct: 18 })).toBeCloseTo(59, 4);
  });
});

describe('lineasNormalizadas', () => {
  it('lo que se GUARDA siempre es valor de venta, pase lo que pase con el toggle', () => {
    const [l] = lineasNormalizadas(L, { igvPct: 18, preciosIncluyenIgv: true });
    expect(l.precio_unitario).toBeCloseTo(84.745763, 6);
    // Queda rastro de lo que la persona escribió, para poder explicarlo.
    expect(l.precio_ingresado).toBe(100);
    expect(l.precio_incluia_igv).toBe(true);
  });

  it('sin el toggle no ensucia la línea con campos que no hacen falta', () => {
    const [l] = lineasNormalizadas(L, { igvPct: 18 });
    expect(l.precio_unitario).toBe(100);
    expect(l.precio_ingresado).toBeUndefined();
    expect(l.precio_incluia_igv).toBeUndefined();
  });
});
