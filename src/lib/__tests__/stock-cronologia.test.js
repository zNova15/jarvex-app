import { describe, it, expect } from 'vitest';
import { validarSalidaCronologica, efectoMovimiento, agruparCantidades } from '../stock-cronologia.js';

const mov = (fecha, tipo, cantidad, extra = {}) => ({ fecha, tipo_movimiento: tipo, cantidad, ...extra });

describe('caso real ROTOMARTILLOS (salida retro antes de la entrada)', () => {
  // Historial real: +2 el 15/05, −2 el 11/05 (cruzado), +1 el 03/07. Stock hoy: 1.
  const historial = [
    mov('2026-05-15', 'ingreso', 2, { accion: 'entrada' }),
    mov('2026-05-11', 'salida', 2, { accion: 'salida' }),
    mov('2026-07-03', 'ingreso', 1, { accion: 'entrada' }),
  ];

  it('una salida el 11/05 (antes de toda entrada) se RECHAZA', () => {
    // Sin la salida cruzada ya registrada: al 11/05 no había entrado nada.
    const limpio = [mov('2026-05-15', 'ingreso', 2), mov('2026-07-03', 'ingreso', 1)];
    const r = validarSalidaCronologica({ movimientos: limpio, fecha: '2026-05-11', cantidad: 2, stockActualHoy: 3 });
    expect(r.ok).toBe(false);
    expect(r.disponible).toBe(0);
  });

  it('la misma salida el 16/05 (después de la entrada) se ACEPTA', () => {
    const limpio = [mov('2026-05-15', 'ingreso', 2), mov('2026-07-03', 'ingreso', 1)];
    const r = validarSalidaCronologica({ movimientos: limpio, fecha: '2026-05-16', cantidad: 2, stockActualHoy: 3 });
    expect(r.ok).toBe(true);
  });

  it('con el historial ya cruzado, hoy solo se puede sacar 1 (el stock real)', () => {
    const r = validarSalidaCronologica({ movimientos: historial, fecha: '2026-07-17', cantidad: 1, stockActualHoy: 1 });
    expect(r.ok).toBe(true);
    const r2 = validarSalidaCronologica({ movimientos: historial, fecha: '2026-07-17', cantidad: 2, stockActualHoy: 1 });
    expect(r2.ok).toBe(false);
  });
});

describe('protección de la línea de tiempo FUTURA', () => {
  it('rechaza una salida retro que dejaría negativo un punto posterior', () => {
    // +5 el 10/05, −5 el 20/05 (ya consumido todo). Una salida retro del 12/05
    // por 3 tendría "stock al 12/05 = 5", pero dejaría el 20/05 en −3.
    const hist = [mov('2026-05-10', 'entrada', 5), mov('2026-05-20', 'salida', 5)];
    const r = validarSalidaCronologica({ movimientos: hist, fecha: '2026-05-12', cantidad: 3, stockActualHoy: 0 });
    expect(r.ok).toBe(false);
    expect(r.disponible).toBe(0);
  });

  it('acepta la salida retro si el futuro la soporta', () => {
    const hist = [mov('2026-05-10', 'entrada', 5), mov('2026-05-20', 'salida', 2)];
    const r = validarSalidaCronologica({ movimientos: hist, fecha: '2026-05-12', cantidad: 3, stockActualHoy: 3 });
    expect(r.ok).toBe(true);
  });
});

describe('baseline: stock sin historial (imports / stock inicial)', () => {
  it('ítem migrado con stock 5 y CERO movimientos: salida de hoy se acepta', () => {
    const r = validarSalidaCronologica({ movimientos: [], fecha: '2026-07-17', cantidad: 3, stockActualHoy: 5 });
    expect(r.ok).toBe(true);
    expect(r.disponible).toBe(5);
  });

  it('el baseline también respalda fechas pasadas (existió desde siempre)', () => {
    const r = validarSalidaCronologica({ movimientos: [], fecha: '2026-01-01', cantidad: 5, stockActualHoy: 5 });
    expect(r.ok).toBe(true);
  });

  it('pero el baseline no inventa más de lo que hay hoy', () => {
    const r = validarSalidaCronologica({ movimientos: [], fecha: '2026-07-17', cantidad: 6, stockActualHoy: 5 });
    expect(r.ok).toBe(false);
  });
});

describe('detalles', () => {
  it('la hora ordena dentro del mismo día (entrada 09:00, salida 08:00 → rechaza)', () => {
    const hist = [mov('2026-06-01', 'entrada', 2, { hora: '09:00:00' })];
    const r = validarSalidaCronologica({ movimientos: hist, fecha: '2026-06-01', hora: '08:00:00', cantidad: 1, stockActualHoy: 2 });
    expect(r.ok).toBe(false);
    const r2 = validarSalidaCronologica({ movimientos: hist, fecha: '2026-06-01', hora: '10:00:00', cantidad: 1, stockActualHoy: 2 });
    expect(r2.ok).toBe(true);
  });

  it('los movimientos borrados no cuentan', () => {
    const hist = [mov('2026-06-01', 'entrada', 5, { deleted_at: '2026-06-02' })];
    const r = validarSalidaCronologica({ movimientos: hist, fecha: '2026-06-03', cantidad: 1, stockActualHoy: 0 });
    expect(r.ok).toBe(false);
  });

  it('efectoMovimiento: mapea tipos y acciones', () => {
    expect(efectoMovimiento({ tipo_movimiento: 'devolucion' })).toBe(1);
    expect(efectoMovimiento({ tipo_movimiento: 'merma' })).toBe(-1);
    expect(efectoMovimiento({ accion: 'entrada' })).toBe(1);
    expect(efectoMovimiento({ accion: 'mantenimiento' })).toBe(0);
    expect(efectoMovimiento({})).toBe(0);
  });

  it('agruparCantidades suma filas del mismo ítem', () => {
    const g = agruparCantidades([{ id: 'a', cantidad: 2 }, { id: 'a', cantidad: 3 }, { id: 'b', cantidad: 1 }], it => it.id);
    expect(g.get('a')).toBe(5);
    expect(g.get('b')).toBe(1);
  });
});
