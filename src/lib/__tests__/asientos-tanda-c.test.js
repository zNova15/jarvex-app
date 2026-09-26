// Tanda C de la revisión (25-set-2026): el dinero en el Libro Diario.
// Antes de esta tanda NINGÚN test asentaba un movimiento en dólares, una
// factura de anticipo, una factura en cero ni una nota de crédito con su
// factura dada de baja (lo dice el informe `ola1-contabilidad-libs.md`). Los
// cuatro casos están acá, con los números reales de producción.
import { describe, it, expect } from 'vitest';
import { generarAsiento, generarAsientosBatch, cumpleEstadoCuenta } from '../asientos.js';
import { contextoDeAsientos } from '../asientos-contexto.js';
import { movimientosQueCuentan, notaSinEfecto } from '../notas-credito.js';

const linea = (a, cuenta) => a.partidas.filter(p => p.cuenta === cuenta);
const debeDe = (a, cuenta) => linea(a, cuenta).reduce((s, p) => s + p.debe, 0);
const haberDe = (a, cuenta) => linea(a, cuenta).reduce((s, p) => s + p.haber, 0);

// KOPLAST → GASOMI, datos del 25-set-2026.
const ANTICIPO = {
  id: 'ant-3384', type: 'cost', clase: 'compra', currency: 'USD', amount: 80000, tipo_cambio: 3.495,
  payment_status: 'paid', metodo_pago: 'transferencia', date: '2026-03-31',
  document_number: 'F003-3384', third_party_ruc: '20100000001', company_id: 'gasomi',
  description: 'Factura F003-3384 · KOPLAST',
  notas: JSON.stringify({ subtotal: 67796.61, igv: 12203.39, items_factura: [{ descripcion: 'ANTICIPO DE CLIENTE', cantidad: 1, precio_unitario: 67796.61 }] }),
};
const ENTREGA_EN_CERO = {
  id: 'f-3388', type: 'cost', clase: 'compra', currency: 'USD', amount: 0, tipo_cambio: 3.495,
  payment_status: 'paid', date: '2026-03-31', document_number: 'F003-3388',
  third_party_ruc: '20100000001', company_id: 'gasomi', description: 'Factura F003-3388 · KOPLAST',
  notas: JSON.stringify({ subtotal: 0, igv: 0, items_factura: [{ descripcion: 'TUBERIA PVC', cantidad: 100, precio_unitario: 78.7661 }] }),
};
const APLICACION = { id: 'ap1', anticipo_movimiento_id: 'ant-3384', factura_movimiento_id: 'f-3388', monto: 9294.4, moneda: 'USD', fuente: 'manual' };

describe('el Libro Diario se lleva en SOLES (Gabriel, 25-set-2026)', () => {
  it('🔴 una factura en dólares se asienta en soles al TC del comprobante', () => {
    const a = generarAsiento({
      id: 'u1', type: 'cost', clase: 'compra', currency: 'USD', amount: 1000, tipo_cambio: 3.5,
      payment_status: 'pending', date: '2026-06-10', notas: JSON.stringify({ subtotal: 847.46, igv: 152.54 }),
    });
    expect(a.moneda).toBe('PEN');
    expect(a.sinTipoCambio).toBe(false);
    expect(haberDe(a, '42')).toBeCloseTo(3500, 2);
    expect(debeDe(a, '4011')).toBeCloseTo(533.89, 2);   // 152,54 × 3,5
    expect(a.cuadra).toBe(true);
    expect(a.conversion).toEqual({ moneda: 'USD', total: 1000, tc: 3.5, origenTc: 'comprobante' });
  });

  it('sin tasa en el comprobante, usa la de SUNAT para su fecha de emisión', () => {
    const a = generarAsiento(
      { id: 'u2', type: 'cost', currency: 'USD', amount: 100, payment_status: 'pending', date: '2026-06-04' },
      { tasaDe: () => 3.417 },
    );
    expect(haberDe(a, '42')).toBeCloseTo(341.7, 2);
    expect(a.conversion.origenTc).toBe('fecha');
  });

  it('🔴 sin NINGUNA tasa no inventa: queda en dólares, marcado y aislable', () => {
    const a = generarAsiento({ id: 'u3', type: 'cost', currency: 'USD', amount: 36.88, payment_status: 'paid', date: '2026-06-04' });
    expect(a.sinTipoCambio).toBe(true);
    expect(a.moneda).toBe('USD');
    expect(a.cuadra).toBe(true);
    expect(cumpleEstadoCuenta(a, 'sin_tipo_cambio')).toBe(true);
    expect(a.conversion.tc).toBe(null);
  });

  it('un comprobante en soles no cambia en nada', () => {
    const a = generarAsiento({ id: 'p1', type: 'cost', amount: 118, payment_status: 'pending', date: '2026-06-04' });
    expect(a.moneda).toBe('PEN');
    expect(a.conversion).toBe(null);
    expect(haberDe(a, '42')).toBe(118);
  });

  it('la nota de crédito en dólares se extorna en soles', () => {
    const a = generarAsiento({
      id: 'nc-usd', type: 'cost', clase: 'compra', currency: 'USD', amount: -1000, tipo_cambio: 3.4,
      document_type: 'nota_credito', payment_status: 'paid', date: '2026-05-06',
    });
    expect(a.extorno).toBe(true);
    expect(debeDe(a, '42')).toBeCloseTo(3400, 2);
    expect(a.cuadra).toBe(true);
  });
});

describe('anticipos a proveedores: 422 (Gabriel, 25-set-2026)', () => {
  const ctx = contextoDeAsientos({ movimientos: [ANTICIPO, ENTREGA_EN_CERO], aplicaciones: [APLICACION] });

  it('🔴 la factura de anticipo va a la 422 con su IGV, en soles, y sin destino', () => {
    const a = generarAsiento(ANTICIPO, ctx);
    expect(a.esAnticipo).toBe(true);
    expect(debeDe(a, '422')).toBeCloseTo(236949.15, 2);   // 67.796,61 × 3,495
    expect(debeDe(a, '4011')).toBeCloseTo(42650.85, 2);   // 12.203,39 × 3,495
    expect(debeDe(a, '422') + debeDe(a, '4011')).toBeCloseTo(279600, 2);
    expect(linea(a, '60')).toHaveLength(0);
    expect(a.cuentas.destino).toBe(null);
    expect(a.cuentas.provisional).toBe(false);
    expect(a.cuadra).toBe(true);
  });

  it('🔴 la entrega EN CERO lleva la mercadería a la 60 contra la 422, sin IGV', () => {
    const a = generarAsiento(ENTREGA_EN_CERO, ctx);
    // 9.294,40 × (67.796,61 / 80.000) = 7.876,61 dólares de base, al TC del ANTICIPO
    const base = Math.round(9294.4 * (67796.61 / 80000) * 100) / 100;
    expect(haberDe(a, '422')).toBeCloseTo(Math.round(base * 3.495 * 100) / 100, 2);
    expect(debeDe(a, '4011')).toBe(0);
    expect(a.anticipo.aplicado).toBeCloseTo(haberDe(a, '422'), 2);
    expect(a.enCero).toBe(false);
    expect(a.cuadra).toBe(true);
    // Ni «Pago de …» ni «Cuenta por pagar» de S/ 0,00.
    expect(a.partidas.some(p => /^Pago de|^Cuenta por pagar/.test(p.descripcion))).toBe(false);
  });

  it('la 422 se cancela exacta en soles aunque la entrega tenga otra tasa (NIC 21)', () => {
    const entregaOtraTasa = { ...ENTREGA_EN_CERO, tipo_cambio: 3.438 };
    const ctx2 = contextoDeAsientos({ movimientos: [ANTICIPO, entregaOtraTasa], aplicaciones: [APLICACION] });
    const a = generarAsiento(entregaOtraTasa, ctx2);
    const base = Math.round(9294.4 * (67796.61 / 80000) * 100) / 100;
    expect(haberDe(a, '422')).toBeCloseTo(Math.round(base * 3.495 * 100) / 100, 2);
  });

  it('una factura en cero SIN anticipo vinculado queda aislable, no «cuadrada» en silencio', () => {
    const a = generarAsiento(ENTREGA_EN_CERO, contextoDeAsientos({ movimientos: [ENTREGA_EN_CERO] }));
    expect(a.enCero).toBe(true);
    expect(cumpleEstadoCuenta(a, 'en_cero')).toBe(true);
  });

  it('una cuenta puesta a mano le gana a la 422', () => {
    const a = generarAsiento({ ...ANTICIPO, cuenta_pcge: '1673' }, ctx);
    expect(linea(a, '422')).toHaveLength(0);
    expect(debeDe(a, '1673')).toBeGreaterThan(0);
  });
});

describe('nota de crédito y factura: las DOS vivas (Gabriel, 25-set-2026)', () => {
  const factura = { id: 'f1', type: 'cost', clase: 'compra', amount: 9000, payment_status: 'pending', date: '2026-07-07', document_number: 'E001-5' };
  const nota = { id: 'n1', type: 'cost', clase: 'compra', amount: -9000, payment_status: 'paid', date: '2026-07-08', document_type: 'nota_credito', related_movement_id: 'f1' };

  it('con las dos vivas, el par neto es cero en el libro', () => {
    const as = generarAsientosBatch([factura, nota]);
    expect(as).toHaveLength(2);
    const neto42 = as.reduce((s, a) => s + haberDe(a, '42') - debeDe(a, '42'), 0);
    expect(Math.abs(neto42)).toBeLessThan(0.01);
  });

  it('🔴 si la factura quedó dada de baja, la nota NO resta sola (antes restaba dos veces)', () => {
    const baja = { ...factura, payment_status: 'cancelled' };
    const as = generarAsientosBatch([baja, nota]);
    expect(as).toHaveLength(0);
  });

  it('la factura dada de baja se reconoce aunque sea de otro mes (referencia)', () => {
    const baja = { ...factura, payment_status: 'cancelled' };
    // La pantalla filtra el período ANTES: la factura de julio no está en la lista de agosto.
    const as = generarAsientosBatch([{ ...nota, date: '2026-08-02' }], { referencia: [baja, nota] });
    expect(as).toHaveLength(0);
    expect(notaSinEfecto(nota, new Map([[baja.id, baja]]))).toBe(true);
  });

  it('una comunicación de baja sin nota sigue sin sumar, y una nota parcial sobre factura viva resta', () => {
    const parcial = { ...nota, amount: -100 };
    expect(movimientosQueCuentan([factura, parcial]).map(m => m.id)).toEqual(['f1', 'n1']);
    expect(movimientosQueCuentan([{ ...factura, payment_status: 'cancelled' }])).toHaveLength(0);
  });
});

describe('detracción en el asiento (Gabriel, 25-set-2026)', () => {
  it('🔴 venta cobrada con detracción depositada: esa parte va a la 1071, no al banco', () => {
    const a = generarAsiento({
      id: 'v1', type: 'income', clase: 'venta', amount: 10000, payment_status: 'paid', metodo_pago: 'transferencia',
      detraccion_aplica: true, detraccion_estado: 'depositada', detraccion_pct: 12, detraccion_monto: 1200, date: '2026-07-01',
    });
    expect(debeDe(a, '1071')).toBe(1200);
    expect(debeDe(a, '104')).toBe(8800);
    expect(a.cuadra).toBe(true);
  });

  it('venta con la detracción todavía pendiente: no se parte nada', () => {
    const a = generarAsiento({
      id: 'v2', type: 'income', clase: 'venta', amount: 10000, payment_status: 'pending',
      detraccion_aplica: true, detraccion_estado: 'pendiente', detraccion_monto: 1200, date: '2026-07-01',
    });
    expect(linea(a, '1071')).toHaveLength(0);
    expect(debeDe(a, '121')).toBe(10000);
  });

  it('compra pendiente con la detracción ya depositada: 42 por el saldo y 104 por la detracción', () => {
    const a = generarAsiento({
      id: 'c1', type: 'cost', clase: 'compra', amount: 10000, payment_status: 'pending',
      detraccion_aplica: true, detraccion_estado: 'depositada', detraccion_monto: 400, date: '2026-07-01',
    });
    expect(haberDe(a, '42')).toBe(9600);
    expect(haberDe(a, '104')).toBe(400);
    expect(a.cuadra).toBe(true);
  });

  it('en una venta en dólares la detracción (que está en soles) se descuenta en soles', () => {
    const a = generarAsiento({
      id: 'v3', type: 'income', clase: 'venta', currency: 'USD', amount: 432, tipo_cambio: 3.352, payment_status: 'paid',
      metodo_pago: 'transferencia', detraccion_aplica: true, detraccion_estado: 'depositada', detraccion_monto: 173.75, date: '2026-08-28',
    });
    expect(debeDe(a, '1071')).toBe(173.75);
    expect(debeDe(a, '104')).toBeCloseTo(1448.06 - 173.75, 2);
    expect(a.cuadra).toBe(true);
  });
});

describe('clase manda sobre type', () => {
  it('una venta con type incoherente igual se asienta como venta', () => {
    const a = generarAsiento({ id: 'k1', clase: 'venta', type: 'cost', amount: 1180, payment_status: 'pending', date: '2026-07-01' });
    expect(debeDe(a, '121')).toBe(1180);
    expect(linea(a, '42')).toHaveLength(0);
  });
});
