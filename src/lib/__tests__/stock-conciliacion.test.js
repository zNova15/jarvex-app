import { describe, it, expect } from 'vitest';
import { stockSegunMovimientos, conciliarStock, stockDisponibleConfiable } from '../stock-conciliacion.js';

const ENT = (cantidad, extra = {}) => ({ tipo_movimiento: 'entrada', cantidad, ...extra });
const SAL = (cantidad, extra = {}) => ({ tipo_movimiento: 'salida', cantidad, ...extra });

describe('stock-conciliacion — stockSegunMovimientos', () => {
  it('suma entradas y resta salidas', () => {
    expect(stockSegunMovimientos([ENT(5), SAL(2)])).toBe(3);
  });
  it('la devolución SUMA (no se cuenta como salida)', () => {
    expect(stockSegunMovimientos([ENT(5), SAL(5), { tipo_movimiento: 'devolucion', cantidad: 2 }])).toBe(2);
  });
  it('merma y baja RESTAN', () => {
    expect(stockSegunMovimientos([ENT(10), { tipo_movimiento: 'merma', cantidad: 1 }, { tipo_movimiento: 'baja', cantidad: 2 }])).toBe(7);
  });
  it('excluye borrados, reversas y movimientos reversados', () => {
    expect(stockSegunMovimientos([
      ENT(5),
      ENT(3, { deleted_at: '2026-08-01' }),      // borrado → no cuenta
      ENT(4, { reverses_id: 'x' }),               // es una reversa → no cuenta
      ENT(7, { reversed_by_id: 'y' }),            // fue reversado → no cuenta
    ])).toBe(5);
  });
  it('lista vacía o nula = 0', () => {
    expect(stockSegunMovimientos([])).toBe(0);
    expect(stockSegunMovimientos(null)).toBe(0);
  });
});

describe('stock-conciliacion — conciliarStock (el bug del CODO)', () => {
  it('detecta snapshot BAJO: entrada de 5 visible pero stock_actual=0', () => {
    const c = conciliarStock({ stockActual: 0, movimientos: [ENT(5)] });
    expect(c.segunMovs).toBe(5);
    expect(c.snapshot).toBe(0);
    expect(c.discrepa).toBe(true);
    expect(c.snapshotBajo).toBe(true);   // bloquea de más
    expect(c.snapshotAlto).toBe(false);
  });
  it('detecta snapshot ALTO: sistema dice 130 pero movimientos respaldan 0 (Tubo fantasma)', () => {
    const c = conciliarStock({ stockActual: 130, movimientos: [] });
    expect(c.segunMovs).toBe(0);
    expect(c.discrepa).toBe(true);
    expect(c.snapshotAlto).toBe(true);
    expect(c.snapshotBajo).toBe(false);
  });
  it('sin discrepancia cuando snapshot coincide con el historial', () => {
    const c = conciliarStock({ stockActual: 3, movimientos: [ENT(5), SAL(2)] });
    expect(c.discrepa).toBe(false);
    expect(c.snapshotBajo).toBe(false);
    expect(c.snapshotAlto).toBe(false);
  });
  it('rawSegunMovs puede ser negativo (historial incompleto) pero segunMovs clampa a 0', () => {
    const c = conciliarStock({ stockActual: 0, movimientos: [SAL(3)] });
    expect(c.rawSegunMovs).toBe(-3);
    expect(c.segunMovs).toBe(0);
  });
});

describe('stock-conciliacion — stockDisponibleConfiable', () => {
  it('usa el historial cuando el snapshot bloquea de más (desbloquea salida legítima)', () => {
    // stock_actual=0 pero hay una entrada de 5 → disponible confiable = 5
    expect(stockDisponibleConfiable({ stockActual: 0, movimientos: [ENT(5)] })).toBe(5);
  });
  it('respeta el snapshot cuando está inflado (no habilita salidas sin respaldo)', () => {
    // snapshot 130, movimientos respaldan 0 → NO devolvemos 0 para no bloquear si
    // fuese stock inicial migrado; conservador = snapshot.
    expect(stockDisponibleConfiable({ stockActual: 130, movimientos: [] })).toBe(130);
  });
  it('coincidentes → devuelve el valor común', () => {
    expect(stockDisponibleConfiable({ stockActual: 3, movimientos: [ENT(5), SAL(2)] })).toBe(3);
  });
});

// ── Sobregiro absorbido por el GREATEST(0,…) del servidor ────────────
import { saldoMinimoHistorico, diagnosticoStock } from '../stock-conciliacion.js';

const F = (fecha) => ({ fecha, created_at: fecha + 'T00:00:00Z' });

describe('stock-conciliacion — saldoMinimoHistorico', () => {
  it('sin sobregiro el mínimo es 0', () => {
    expect(saldoMinimoHistorico([ENT(5, F('2026-01-01')), SAL(3, F('2026-01-02'))]).minimo).toBe(0);
  });
  it('detecta el punto más bajo y su fecha', () => {
    const r = saldoMinimoHistorico([
      ENT(9, F('2026-05-11')), SAL(2, F('2026-05-11')),
      SAL(5, F('2026-05-15')), SAL(3, F('2026-06-18')),
    ]);
    expect(r.minimo).toBe(-1);
    expect(r.fecha).toBe('2026-06-18');
  });
  it('ordena por fecha aunque lleguen desordenados', () => {
    const r = saldoMinimoHistorico([SAL(3, F('2026-06-18')), ENT(9, F('2026-05-11'))]);
    expect(r.minimo).toBe(0);   // la entrada es ANTERIOR: nunca hubo negativo
  });
  it('ignora borrados y reversados', () => {
    const r = saldoMinimoHistorico([ENT(1, F('2026-01-01')), SAL(5, { ...F('2026-01-02'), deleted_at: 'x' })]);
    expect(r.minimo).toBe(0);
  });
});

describe('stock-conciliacion — diagnosticoStock (caso ZAPATOS 38)', () => {
  // Historial real: 9 entran, 10 salen (3 de ellas duplicadas por multi-click),
  // el servidor clampa el snapshot en 0; después ingresa 1 par más.
  const zapatos38 = [
    ENT(9, F('2026-05-11')), SAL(1, F('2026-05-11')), SAL(1, F('2026-05-11')),
    SAL(1, F('2026-05-15')), SAL(1, F('2026-05-15')), SAL(1, F('2026-05-15')),
    SAL(1, F('2026-05-15')), SAL(1, F('2026-05-15')),
    SAL(1, F('2026-06-18')), SAL(1, F('2026-06-18')), SAL(1, F('2026-06-18')),
    ENT(1, F('2026-09-04')),
  ];
  it('el historial suma 0 pero el par ingresado SÍ está disponible', () => {
    const d = diagnosticoStock({ stockActual: 1, movimientos: zapatos38 });
    expect(d.rawSegunMovs).toBe(0);
    expect(d.snapshot).toBe(1);
    expect(d.stock).toBe(1);          // ← lo que desbloquea la salida
  });
  it('marca el sobregiro con su fecha y lo explica', () => {
    const d = diagnosticoStock({ stockActual: 1, movimientos: zapatos38 });
    expect(d.huboSobregiro).toBe(true);
    expect(d.fechaSobregiro).toBe('2026-06-18');
    expect(d.explicacion).toMatch(/salidas sin stock/);
  });
  it('sin historial el snapshot manda y NO se reporta descuadre', () => {
    const d = diagnosticoStock({ stockActual: 7, movimientos: [] });
    expect(d.stock).toBe(7);
    expect(d.sinHistorial).toBe(true);
    expect(d.explicacion).toBe(null);
  });
  it('snapshot atrasado → gana el historial (no bloquea la salida legítima)', () => {
    const d = diagnosticoStock({ stockActual: 0, movimientos: [ENT(5, F('2026-01-01'))] });
    expect(d.stock).toBe(5);
    expect(d.snapshotBajo).toBe(true);
    expect(d.explicacion).toMatch(/contador quedó atrás/);
  });
  it('cuadrado → sin explicación', () => {
    const d = diagnosticoStock({ stockActual: 3, movimientos: [ENT(5, F('2026-01-01')), SAL(2, F('2026-01-02'))] });
    expect(d.stock).toBe(3);
    expect(d.explicacion).toBe(null);
  });
});
