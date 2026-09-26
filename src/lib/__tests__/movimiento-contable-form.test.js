// Las reglas del formulario de comprobantes (tanda D, 25-set-2026).
import { describe, it, expect } from 'vitest';
import {
  validarComprobante, necesitaBancarizacion, consecuenciasDeEditar, planDeBorrado,
} from '../movimiento-contable-form.js';
import { notasPorFactura } from '../notas-credito.js';

const base = { company_id: 'c1', date: '2026-09-10', currency: 'PEN', document_type: 'factura' };

describe('validarComprobante', () => {
  it('🔴 una nota de crédito se guarda NEGATIVA aunque se escriba en positivo', () => {
    const r = validarComprobante({ ...base, document_type: 'nota_credito', amount: '1000' });
    expect(r.ok).toBe(true);
    expect(r.monto).toBe(-1000);
    expect(r.avisos[0]).toMatch(/NEGATIVO/);
  });
  it('🔴 la nota ya negativa se edita sin trabas (antes «Monto inválido»)', () => {
    expect(validarComprobante({ ...base, document_type: 'nota_credito', amount: -3109 }).monto).toBe(-3109);
  });
  it('🔴 una factura en CERO se puede guardar, con aviso', () => {
    const r = validarComprobante({ ...base, amount: 0 });
    expect(r.ok).toBe(true);
    expect(r.monto).toBe(0);
    expect(r.avisos[0]).toMatch(/anticipo/);
  });
  it('una factura negativa no: eso es una nota de crédito', () => {
    expect(validarComprobante({ ...base, amount: -5 }).ok).toBe(false);
  });
  it('monto vacío no pasa', () => {
    expect(validarComprobante({ ...base, amount: '' }).ok).toBe(false);
  });
  it('🔴 en dólares exige el tipo de cambio y con forma de tipo de cambio', () => {
    expect(validarComprobante({ ...base, currency: 'USD', amount: 100 }).ok).toBe(false);
    expect(validarComprobante({ ...base, currency: 'USD', amount: 100, tipo_cambio: '34' }).ok).toBe(false);
    const r = validarComprobante({ ...base, currency: 'USD', amount: 100, tipo_cambio: '3,412' });
    expect(r.ok).toBe(true);
    expect(r.tipoCambio).toBe(3.412);
  });
  it('RUC de 11 o DNI de 8; otra cosa no', () => {
    expect(validarComprobante({ ...base, amount: 1, third_party_ruc: '2060123456' }).ok).toBe(false);
    expect(validarComprobante({ ...base, amount: 1, third_party_ruc: '20601234567' }).ok).toBe(true);
    expect(validarComprobante({ ...base, amount: 1, third_party_ruc: '45678912' }).ok).toBe(true);
  });
  it('fecha futura avisa, no bloquea', () => {
    const r = validarComprobante({ ...base, amount: 1, date: '2026-12-01' }, { hoy: '2026-09-25' });
    expect(r.ok).toBe(true);
    expect(r.avisos.join(' ')).toMatch(/posterior a hoy/);
  });
});

describe('necesitaBancarizacion — UNA sola regla', () => {
  it('🔴 S/ 2.000,00 exactos SÍ (desde, no «más de»)', () => {
    expect(necesitaBancarizacion({ id: 'a', amount: 2000, currency: 'PEN' })).toBe(true);
    expect(necesitaBancarizacion({ id: 'a', amount: 1999.99, currency: 'PEN' })).toBe(false);
  });
  it('🔴 US$ 500 o más SÍ (antes la fila en dólares decía «opcional»)', () => {
    expect(necesitaBancarizacion({ id: 'a', amount: 600, currency: 'USD', tipo_cambio: 3.4 })).toBe(true);
  });
  it('una nota de crédito o una anulada no', () => {
    expect(necesitaBancarizacion({ id: 'n', amount: -9000, currency: 'PEN', document_type: 'nota_credito' })).toBe(false);
    const movs = [{ id: 'f', amount: 9000 }, { id: 'n', amount: -9000, document_type: 'nota_credito', related_movement_id: 'f' }];
    expect(necesitaBancarizacion({ id: 'f', amount: 9000, currency: 'PEN' }, { notasMap: notasPorFactura(movs) })).toBe(false);
  });
});

describe('consecuenciasDeEditar', () => {
  const orig = { id: 'm', amount: 10000, currency: 'PEN', company_id: 'c1', detraccion_aplica: true, detraccion_pct: 12, detraccion_monto: 1200, detraccion_estado: 'pendiente' };
  it('🔴 bajar el monto recalcula la detracción pendiente', () => {
    const r = consecuenciasDeEditar(orig, { ...orig, amount: 8000 });
    expect(r.patch.detraccion_monto).toBe(960);
  });
  it('si la detracción ya está depositada no se toca: se avisa', () => {
    const r = consecuenciasDeEditar({ ...orig, detraccion_estado: 'depositada' }, { ...orig, amount: 8000 });
    expect(r.patch.detraccion_monto).toBeUndefined();
    expect(r.confirmar[0]).toMatch(/DEPOSITADA/);
  });
  it('🔴 no se baja por debajo de lo ya pagado', () => {
    const r = consecuenciasDeEditar(orig, { ...orig, amount: 500 }, { partes: [{ id: 'p', monto: 3000 }] });
    expect(r.bloqueos[0]).toMatch(/pagos de bancarización/);
  });
  it('cambiar la moneda con anticipo vinculado se bloquea', () => {
    const r = consecuenciasDeEditar(orig, { ...orig, currency: 'USD', tipo_cambio: 3.4 }, { aplicaciones: [{ id: 'x', monto: 10 }] });
    expect(r.bloqueos.join(' ')).toMatch(/anticipo/);
  });
});

describe('planDeBorrado', () => {
  const f = { id: 'f', document_number: 'F001-1' };
  it('🔴 una nota que la modifica frena el borrado', () => {
    const r = planDeBorrado(f, { movs: [f, { id: 'n', document_type: 'nota_credito', related_movement_id: 'f', document_number: 'FC01-9' }] });
    expect(r.bloqueos[0]).toMatch(/FC01-9/);
  });
  it('🔴 lista lo que hay que desvincular', () => {
    const r = planDeBorrado(f, {
      movs: [f, { id: 'e', related_movement_id: 'f' }],
      partes: [{ id: 'p1', accounting_movement_id: 'f' }],
      guiaFactura: [{ id: 'g1', accounting_movement_id: 'f' }],
      recepciones: [{ id: 'r1', accounting_movement_id: 'f' }],
      aplicaciones: [{ id: 'a1', factura_movimiento_id: 'f' }],
    });
    expect(r.bloqueos).toHaveLength(0);
    expect(r.acciones).toMatchObject({ partes: ['p1'], guiaFactura: ['g1'], recepciones: ['r1'], aplicaciones: ['a1'], espejos: ['e'] });
    expect(r.resumen).toHaveLength(5);
  });
});
