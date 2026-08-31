// Tests del generador del Libro Diario (src/lib/asientos.js).
// Nace con el fix del descuadre por notas de crédito (31-ago-2026): la NC
// E001-64 de GASOMI (amount −3,109.00) descuadraba el Diario en S/474.25
// porque `if (igv > 0)` omitía la línea 4011 con IGV negativo.
import { describe, it, expect } from 'vitest';
import { generarAsiento, generarAsientosBatch, explicarDescuadre } from '../asientos.js';

const sumaDebe = (a) => a.partidas.reduce((s, p) => s + p.debe, 0);
const sumaHaber = (a) => a.partidas.reduce((s, p) => s + p.haber, 0);

describe('generarAsiento — ingresos', () => {
  it('venta pagada cuadra: caja al debe, 70 + 4011 al haber', () => {
    const a = generarAsiento({
      id: 'x1', type: 'income', amount: 5343, payment_status: 'paid',
      metodo_pago: 'transferencia', description: 'Factura E001-261',
      document_number: 'E001-261', date: '2026-01-27',
    });
    expect(a.cuadra).toBe(true);
    expect(a.delta).toBe(0);
    expect(a.extorno).toBe(false);
    expect(a.partidas[0].cuenta).toBe('104');           // metodo_pago (columna real) sí se lee
    expect(a.glosa).toContain('E001-261');              // document_number sí llega a la glosa
    const igvLinea = a.partidas.find(p => p.cuenta === '4011');
    expect(igvLinea.haber).toBeCloseTo(815.03, 2);
  });

  it('venta pendiente usa 121', () => {
    const a = generarAsiento({ id: 'x2', type: 'income', amount: 1180, payment_status: 'pending' });
    expect(a.partidas[0].cuenta).toBe('121');
    expect(a.cuadra).toBe(true);
  });
});

describe('generarAsiento — nota de crédito / monto negativo (extorno)', () => {
  // El caso REAL del descuadre: NC E001-64 · CONSORCIO SAMADAY, −3,109.00.
  const nc = {
    id: 'nc1', type: 'income', amount: -3109, payment_status: 'paid',
    document_type: 'nota_credito', document_number: 'E001-64',
    description: 'Nota de Crédito E001-64 · CONSORCIO SAMADAY', date: '2026-06-15',
  };

  it('la NC de ingreso CUADRA (antes descuadraba en el IGV: Δ 474.25)', () => {
    const a = generarAsiento(nc);
    expect(a.cuadra).toBe(true);
    expect(a.delta).toBe(0);
    expect(a.extorno).toBe(true);
    // Extorno ortodoxo: montos POSITIVOS con debe↔haber invertidos.
    a.partidas.forEach(p => { expect(p.debe).toBeGreaterThanOrEqual(0); expect(p.haber).toBeGreaterThanOrEqual(0); });
    const l70 = a.partidas.find(p => p.cuenta === '70');
    const l4011 = a.partidas.find(p => p.cuenta === '4011');
    const l121 = a.partidas.find(p => p.cuenta === '121');
    expect(l70.debe).toBeCloseTo(2634.75, 2);           // ventas revierte al DEBE
    expect(l4011.debe).toBeCloseTo(474.25, 2);          // la línea de IGV que antes se OMITÍA
    expect(l121.haber).toBeCloseTo(3109, 2);            // contrapartida 121, NUNCA caja
    expect(a.partidas.find(p => p.cuenta === '101' || p.cuenta === '104' || p.cuenta === '10')).toBeUndefined();
  });

  it('la NC de compra (costo negativo) también cuadra con extorno espejo', () => {
    const a = generarAsiento({
      id: 'nc2', type: 'cost', amount: -1180, payment_status: 'paid',
      document_type: 'nota_credito', category: 'materiales',
    });
    expect(a.cuadra).toBe(true);
    expect(a.extorno).toBe(true);
    const l60 = a.partidas.find(p => p.cuenta === '60');
    const l4011 = a.partidas.find(p => p.cuenta === '4011');
    const l42 = a.partidas.find(p => p.cuenta === '42');
    expect(l60.haber).toBeCloseTo(1000, 2);             // el gasto revierte al HABER
    expect(l4011.haber).toBeCloseTo(180, 2);
    expect(l42.debe).toBeCloseTo(1180, 2);              // contrapartida 42, no caja
  });

  it('reproduce el batch de GASOMI: factura + su NC suman Debe = Haber', () => {
    const factura = {
      id: 'f1', type: 'income', amount: 3109, payment_status: 'pending',
      document_number: 'E001-263', date: '2026-01-30',
    };
    const asientos = generarAsientosBatch([factura, nc]);
    const totDebe = asientos.reduce((s, a) => s + sumaDebe(a), 0);
    const totHaber = asientos.reduce((s, a) => s + sumaHaber(a), 0);
    expect(totDebe).toBeCloseTo(totHaber, 2);           // el Δ 474.25 desaparece
  });
});

describe('generarAsiento — planilla y redondeo', () => {
  it('planilla (62): sin línea de IGV, el total va al gasto', () => {
    const a = generarAsiento({ id: 'p1', type: 'cost', amount: 2500, category: 'planilla', payment_status: 'pending' });
    expect(a.cuadra).toBe(true);
    expect(a.partidas.find(p => p.cuenta === '4011')).toBeUndefined();
    expect(a.partidas.find(p => p.cuenta === '62').debe).toBeCloseTo(2500, 2);
    expect(a.partidas.find(p => p.cuenta === '41').haber).toBeCloseTo(2500, 2);
  });

  it('montos con céntimos raros cuadran por el ajuste de redondeo', () => {
    const a = generarAsiento({ id: 'r1', type: 'income', amount: 1133.11, payment_status: 'paid' });
    expect(a.cuadra).toBe(true);
  });
});

describe('explicarDescuadre', () => {
  it('devuelve null si cuadra', () => {
    const a = generarAsiento({ id: 'ok', type: 'income', amount: 118, payment_status: 'paid' });
    expect(explicarDescuadre(a, { amount: 118 })).toBeNull();
  });

  it('explica base + IGV inconsistentes con el total', () => {
    // subtotal e igv_amount explícitos que NO suman el total → descuadre real.
    const mov = { id: 'bad', type: 'income', amount: 1000, subtotal: 900, igv_amount: 50, payment_status: 'paid' };
    const a = generarAsiento(mov);
    expect(a.cuadra).toBe(false);
    const txt = explicarDescuadre(a, mov);
    expect(txt).toMatch(/base imponible/i);
    expect(txt).toMatch(/IGV/);
  });
});
