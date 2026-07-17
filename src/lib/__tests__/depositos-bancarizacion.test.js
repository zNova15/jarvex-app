import { describe, it, expect } from 'vitest';
import {
  validarVinculoDeposito, saldoDeposito, mismoPar, parMovimiento, parDeposito,
  movimientoBancarizado, terceroKey,
} from '../depositos-bancarizacion.js';

// Escenario de Gabriel: 3 facturas (3,000 + 7,000 + 10,000) al MISMO
// proveedor, cubiertas por UNA transferencia de 20,000.
const deposito = {
  id: 'dep-1', company_id: 'emp-A', clase: 'compra',
  tercero_ruc: '20512345678', tercero_nombre: 'PROVEEDOR SAC',
  monto_total: 20000, moneda: 'PEN',
};
const factura = (id, amount) => ({
  id, company_id: 'emp-A', clase: 'compra', type: 'cost',
  third_party_ruc: '20512345678', third_party_name: 'Proveedor S.A.C.',
  amount, currency: 'PEN',
});
const parte = (id, monto, depositoId = 'dep-1') => ({ id, monto, deposito_id: depositoId });

describe('escenario 20,000 cubre 3,000 + 7,000 + 10,000', () => {
  it('primer vínculo (3,000): ok, quedan 17,000', () => {
    const r = validarVinculoDeposito({ deposito, partesDeposito: [], movimiento: factura('f1', 3000), monto: 3000 });
    expect(r.ok).toBe(true);
    expect(r.saldoRestante).toBe(17000);
  });

  it('segundo (7,000): ok, quedan 10,000', () => {
    const r = validarVinculoDeposito({ deposito, partesDeposito: [parte('p1', 3000)], movimiento: factura('f2', 7000), monto: 7000 });
    expect(r.ok).toBe(true);
    expect(r.saldoRestante).toBe(10000);
  });

  it('tercero exacto (10,000): ok, saldo 0', () => {
    const r = validarVinculoDeposito({ deposito, partesDeposito: [parte('p1', 3000), parte('p2', 7000)], movimiento: factura('f3', 10000), monto: 10000 });
    expect(r.ok).toBe(true);
    expect(r.saldoRestante).toBe(0);
  });

  it('RECHAZA aplicar 11,000 cuando solo quedan 10,000 (el caso del enunciado)', () => {
    const r = validarVinculoDeposito({ deposito, partesDeposito: [parte('p1', 3000), parte('p2', 7000)], movimiento: factura('f4', 11000), monto: 11000 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/[Ss]aldo/);
  });

  it('las partes borradas no consumen saldo', () => {
    const borrada = { ...parte('p9', 15000), deleted_at: '2026-07-01' };
    expect(saldoDeposito(deposito, [borrada, parte('p1', 3000)])).toBe(17000);
  });

  it('partes de OTRO depósito no consumen este saldo', () => {
    expect(saldoDeposito(deposito, [parte('px', 9999, 'dep-OTRO')])).toBe(20000);
  });
});

describe('regla mismo pagador → mismo cobrador', () => {
  it('RECHAZA cubrir la factura de un tercero distinto (A→B no paga lo de C→A)', () => {
    const facturaDeC = { ...factura('f5', 3000), third_party_ruc: '20699999999', third_party_name: 'EMPRESA C' };
    const r = validarVinculoDeposito({ deposito, partesDeposito: [], movimiento: facturaDeC, monto: 3000 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/pagador/);
  });

  it('RECHAZA si la empresa del grupo es otra', () => {
    const otraEmpresa = { ...factura('f6', 3000), company_id: 'emp-B' };
    expect(validarVinculoDeposito({ deposito, partesDeposito: [], movimiento: otraEmpresa, monto: 3000 }).ok).toBe(false);
  });

  it('RECHAZA cruzar dirección: depósito de compra no cubre una venta', () => {
    const venta = { ...factura('f7', 3000), clase: 'venta', type: 'income' };
    expect(validarVinculoDeposito({ deposito, partesDeposito: [], movimiento: venta, monto: 3000 }).ok).toBe(false);
  });

  it('RECHAZA moneda distinta', () => {
    const enDolares = { ...factura('f8', 3000), currency: 'USD' };
    expect(validarVinculoDeposito({ deposito, partesDeposito: [], movimiento: enDolares, monto: 3000 }).ok).toBe(false);
  });

  it('el RUC matchea aunque venga con formato distinto', () => {
    const conFormato = { ...factura('f9', 3000), third_party_ruc: '20-51234567-8' };
    expect(mismoPar(parDeposito(deposito), parMovimiento(conFormato))).toBe(true);
  });

  it('sin RUC cae al nombre normalizado', () => {
    expect(terceroKey(null, '  Proveedor   sac ')).toBe('PROVEEDOR SAC');
  });
});

describe('movimientoBancarizado', () => {
  const depositos = new Map([['dep-1', deposito]]);

  it('evidencia directa manda (flujo clásico)', () => {
    expect(movimientoBancarizado({ mov: factura('f1', 5000), tieneEvidenciaDirecta: true, partes: [], depositosById: depositos })).toBe(true);
  });

  it('cubierto por partes de depósito = bancarizado', () => {
    expect(movimientoBancarizado({
      mov: factura('f1', 3000), tieneEvidenciaDirecta: false,
      partes: [parte('p1', 3000)], depositosById: depositos,
    })).toBe(true);
  });

  it('cobertura parcial NO es bancarizado', () => {
    expect(movimientoBancarizado({
      mov: factura('f1', 3000), tieneEvidenciaDirecta: false,
      partes: [parte('p1', 1000)], depositosById: depositos,
    })).toBe(false);
  });

  it('parte que apunta a un depósito inexistente NO cuenta como respaldada', () => {
    expect(movimientoBancarizado({
      mov: factura('f1', 3000), tieneEvidenciaDirecta: false,
      partes: [parte('p1', 3000, 'dep-borrado')], depositosById: depositos,
    })).toBe(false);
  });

  it('sin partes ni evidencia → falta bancarización', () => {
    expect(movimientoBancarizado({ mov: factura('f1', 3000), tieneEvidenciaDirecta: false, partes: [], depositosById: depositos })).toBe(false);
  });
});
