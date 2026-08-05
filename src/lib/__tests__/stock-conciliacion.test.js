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
