import { describe, it, expect } from 'vitest';
import { calcularEstadoPago, validarParte, evidenciasRequeridas, checklistPago } from '../pagos.js';

describe('calcularEstadoPago', () => {
  it('caso de Gabriel: 7000 = 900 + 3200 + 2900 → pagado', () => {
    const r = calcularEstadoPago(7000, [{ monto: 900 }, { monto: 3200 }, { monto: 2900 }]);
    expect(r.pagado).toBe(7000);
    expect(r.falta).toBe(0);
    expect(r.estado).toBe('pagado');
    expect(r.pct).toBe(100);
  });

  it('parcial: 7000 con 900 + 3200 → faltan 2900', () => {
    const r = calcularEstadoPago(7000, [{ monto: 900 }, { monto: 3200 }]);
    expect(r.pagado).toBe(4100);
    expect(r.falta).toBe(2900);
    expect(r.estado).toBe('parcial');
  });

  it('sin partes → pendiente', () => {
    const r = calcularEstadoPago(7000, []);
    expect(r.estado).toBe('pendiente');
    expect(r.falta).toBe(7000);
    expect(r.pct).toBe(0);
  });

  it('ignora partes soft-deleted', () => {
    const r = calcularEstadoPago(1000, [{ monto: 600 }, { monto: 400, deleted_at: '2026-01-01' }]);
    expect(r.pagado).toBe(600);
    expect(r.estado).toBe('parcial');
  });

  it('tolera céntimos de redondeo (3×33.33 + 0.01 sobre 100)', () => {
    const r = calcularEstadoPago(100, [{ monto: 33.33 }, { monto: 33.33 }, { monto: 33.34 }]);
    expect(r.estado).toBe('pagado');
    expect(r.falta).toBe(0);
  });

  it('exceso queda registrado sin negativizar falta', () => {
    const r = calcularEstadoPago(1000, [{ monto: 1200 }]);
    expect(r.estado).toBe('pagado');
    expect(r.falta).toBe(0);
    expect(r.exceso).toBe(200);
  });

  it('monto acordado 0 con partes → pagado (pago sin monto pre-acordado)', () => {
    const r = calcularEstadoPago(0, [{ monto: 500 }]);
    expect(r.pagado).toBe(500);
    expect(r.estado).toBe('pagado');
  });

  it('montos no numéricos y null no rompen', () => {
    const r = calcularEstadoPago('7000', [{ monto: 'abc' }, { monto: null }, { monto: 100 }]);
    expect(r.pagado).toBe(100);
    expect(r.estado).toBe('parcial');
  });
});

describe('validarParte', () => {
  const base = { monto: 100, fecha: '2026-07-10', metodo: 'transferencia' };
  it('parte válida → sin errores', () => {
    expect(validarParte(base, { faltante: 500 })).toEqual([]);
  });
  it('monto 0 / vacío / negativo → error', () => {
    expect(validarParte({ ...base, monto: 0 }).length).toBeGreaterThan(0);
    expect(validarParte({ ...base, monto: '' }).length).toBeGreaterThan(0);
    expect(validarParte({ ...base, monto: -5 }).length).toBeGreaterThan(0);
  });
  it('sin fecha o sin método → error', () => {
    expect(validarParte({ ...base, fecha: '' }).length).toBe(1);
    expect(validarParte({ ...base, metodo: '' }).length).toBe(1);
  });
  it('exceder lo faltante → aviso (no error duro)', () => {
    const errs = validarParte({ ...base, monto: 600 }, { faltante: 500 });
    expect(errs.length).toBe(1);
    expect(errs[0]).toMatch(/^AVISO_EXCESO:100/);
  });
  it('faltante null (sin tope) no genera aviso', () => {
    expect(validarParte({ ...base, monto: 999999 }, { faltante: null })).toEqual([]);
  });
});

describe('evidenciasRequeridas', () => {
  it('rxh exige recibo + constancia', () => {
    const tipos = evidenciasRequeridas('rxh').map(r => r.tipo);
    expect(tipos).toContain('recibo_honorarios');
    expect(tipos).toContain('pago_evidencia');
  });
  it('planilla/otro/subcontrato exigen solo constancia', () => {
    for (const m of ['planilla', 'otro', 'subcontrato', null]) {
      expect(evidenciasRequeridas(m).map(r => r.tipo)).toEqual(['pago_evidencia']);
    }
  });
});

describe('checklistPago (simulación integral)', () => {
  it('pago rxh completo: dinero pagado + recibo + constancias por parte', () => {
    const pago = { id: 'p1', modo_pago: 'rxh', monto_acordado: 1500 };
    const partes = [
      { id: 'a', monto: 1000, metodo: 'transferencia', evidencia_id: 'ev1' },
      { id: 'b', monto: 500, metodo: 'deposito', evidencia_id: 'ev2' },
    ];
    const evidencias = [
      { id: 'ev1', tipo_evidencia: 'pago_evidencia', registro_relacionado_id: 'a' },
      { id: 'ev2', tipo_evidencia: 'pago_evidencia', registro_relacionado_id: 'b' },
      { id: 'ev3', tipo_evidencia: 'recibo_honorarios', registro_relacionado_id: 'p1' },
    ];
    const c = checklistPago(pago, partes, evidencias);
    expect(c.dinero.estado).toBe('pagado');
    expect(c.items.every(i => i.ok)).toBe(true);
    expect(c.partesSinEvidencia).toBe(0);
    expect(c.completo).toBe(true);
  });

  it('rxh sin el recibo emitido → incompleto aunque el dinero esté pagado', () => {
    const pago = { id: 'p1', modo_pago: 'rxh', monto_acordado: 500 };
    const partes = [{ id: 'a', monto: 500, metodo: 'transferencia', evidencia_id: 'ev1' }];
    const evidencias = [{ id: 'ev1', tipo_evidencia: 'pago_evidencia', registro_relacionado_id: 'a' }];
    const c = checklistPago(pago, partes, evidencias);
    expect(c.dinero.estado).toBe('pagado');
    expect(c.completo).toBe(false);
  });

  it('parte por transferencia sin comprobante → cuenta como faltante', () => {
    const pago = { id: 'p1', modo_pago: 'planilla', monto_acordado: 500 };
    const partes = [{ id: 'a', monto: 500, metodo: 'transferencia' }];
    const c = checklistPago(pago, partes, [{ id: 'x', tipo_evidencia: 'pago_evidencia', registro_relacionado_id: 'p1' }]);
    expect(c.partesSinEvidencia).toBe(1);
    expect(c.completo).toBe(false);
  });

  it('parte en efectivo sin comprobante NO bloquea', () => {
    const pago = { id: 'p1', modo_pago: 'otro', monto_acordado: 300 };
    const partes = [{ id: 'a', monto: 300, metodo: 'efectivo' }];
    const evidencias = [{ id: 'e', tipo_evidencia: 'pago_evidencia', registro_relacionado_id: 'p1' }];
    const c = checklistPago(pago, partes, evidencias);
    expect(c.partesSinEvidencia).toBe(0);
    expect(c.completo).toBe(true);
  });
});
