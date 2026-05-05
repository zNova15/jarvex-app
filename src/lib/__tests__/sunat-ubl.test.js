import { describe, it, expect } from 'vitest';
import { calcularTotalesIGV } from '../sunat-ubl.js';

describe('calcularTotalesIGV — IGV peruano (18%)', () => {
  it('1 item gravado: subtotal 100 → IGV 18 → total 118', () => {
    const r = calcularTotalesIGV([
      { cantidad: 1, precio_unitario: 100, igv_pct: 18, tax_exemption_code: '10' },
    ]);
    expect(r.total_gravado).toBe(100);
    expect(r.total_igv).toBe(18);
    expect(r.total_venta).toBe(118);
    expect(r.lineas[0].subtotal).toBe(100);
    expect(r.lineas[0].igv).toBe(18);
    expect(r.lineas[0].total_linea).toBe(118);
  });

  it('subtotal 0 → IGV 0 → total 0', () => {
    const r = calcularTotalesIGV([
      { cantidad: 0, precio_unitario: 100, igv_pct: 18, tax_exemption_code: '10' },
    ]);
    expect(r.total_gravado).toBe(0);
    expect(r.total_igv).toBe(0);
    expect(r.total_venta).toBe(0);
  });

  it('lista vacía → todos los totales en 0', () => {
    const r = calcularTotalesIGV([]);
    expect(r.total_gravado).toBe(0);
    expect(r.total_igv).toBe(0);
    expect(r.total_venta).toBe(0);
    expect(r.lineas).toHaveLength(0);
  });

  it('decimales: 33.33 × 1 a 18% → IGV redondeado a 6.00', () => {
    // 33.33 * 0.18 = 5.9994 → round2 = 6.00
    const r = calcularTotalesIGV([
      { cantidad: 1, precio_unitario: 33.33, igv_pct: 18, tax_exemption_code: '10' },
    ]);
    expect(r.total_gravado).toBe(33.33);
    expect(r.total_igv).toBe(6);
    expect(r.total_venta).toBe(39.33);
  });

  it('item exonerado (code=20) no genera IGV pero sí venta', () => {
    const r = calcularTotalesIGV([
      { cantidad: 2, precio_unitario: 50, igv_pct: 18, tax_exemption_code: '20' },
    ]);
    expect(r.total_gravado).toBe(0);
    expect(r.total_exonerado).toBe(100);
    expect(r.total_igv).toBe(0);
    expect(r.total_venta).toBe(100);
    expect(r.lineas[0].igv).toBe(0);
    expect(r.lineas[0].igv_pct).toBe(0);
  });

  it('item inafecto (code=30) no genera IGV', () => {
    const r = calcularTotalesIGV([
      { cantidad: 1, precio_unitario: 200, tax_exemption_code: '30' },
    ]);
    expect(r.total_gravado).toBe(0);
    expect(r.total_inafecto).toBe(200);
    expect(r.total_igv).toBe(0);
    expect(r.total_venta).toBe(200);
  });

  it('combinación: gravado + exonerado en una factura', () => {
    const r = calcularTotalesIGV([
      { cantidad: 1, precio_unitario: 100, igv_pct: 18, tax_exemption_code: '10' }, // grav
      { cantidad: 1, precio_unitario: 50,  tax_exemption_code: '20' },              // exo
    ]);
    expect(r.total_gravado).toBe(100);
    expect(r.total_exonerado).toBe(50);
    expect(r.total_igv).toBe(18);
    expect(r.total_venta).toBe(168);
  });

  it('default: sin tax_exemption_code es gravado al 18%', () => {
    const r = calcularTotalesIGV([
      { cantidad: 1, precio_unitario: 100 },
    ]);
    expect(r.total_gravado).toBe(100);
    expect(r.total_igv).toBe(18);
    expect(r.total_venta).toBe(118);
  });
});
