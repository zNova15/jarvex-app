import { describe, it, expect } from 'vitest';
import { deltaPorAlmacen, simularCambio, simularBorrado, stockTrasBorrar, stockTrasEditar, dejaNegativo } from '../stock-guard.js';

const mov = (id, fecha, tipo, cantidad, extra = {}) => ({ id, fecha, tipo_movimiento: tipo, cantidad, ...extra });

describe('deltaPorAlmacen', () => {
  it('signo por tipo de movimiento', () => {
    expect(deltaPorAlmacen(mov('a', '2026-01-01', 'entrada', 5))).toBe(5);
    expect(deltaPorAlmacen(mov('a', '2026-01-01', 'devolucion', 5))).toBe(5);
    expect(deltaPorAlmacen(mov('a', '2026-01-01', 'salida', 5))).toBe(-5);
    expect(deltaPorAlmacen(mov('a', '2026-01-01', 'merma', 5))).toBe(-5);
    expect(deltaPorAlmacen(mov('a', '2026-01-01', 'ajuste', 5))).toBe(0);
    expect(deltaPorAlmacen(mov('a', '2026-01-01', 'reverso', 5))).toBe(0);
  });
});

// El ejemplo de Gabriel: ingreso de 15 el día 13, consumo de 10 el día 14, stock previo 0.
const BASE = [
  mov('e13', '2026-01-13', 'entrada', 15),
  mov('s14', '2026-01-14', 'salida', 10),
];

describe('simularBorrado', () => {
  it('borrar el ingreso del día 13 → inseguro (el consumo del 14 deja negativo)', () => {
    const r = simularBorrado({ movimientos: BASE, movId: 'e13' });
    expect(r.seguro).toBe(false);
    expect(r.fechaViolacion).toBe('2026-01-14');
    expect(r.minSaldo).toBe(-10);
  });
  it('borrar una salida → siempre seguro (sube el saldo)', () => {
    expect(simularBorrado({ movimientos: BASE, movId: 's14' }).seguro).toBe(true);
  });
  it('cadena sin violación → seguro', () => {
    // borrar un ingreso que no deja a nadie en negativo
    const movs = [mov('e1', '2026-01-10', 'entrada', 100), ...BASE];
    expect(simularBorrado({ movimientos: movs, movId: 'e13' }).seguro).toBe(true);
  });
});

describe('simularCambio (edición de cantidad)', () => {
  it('reducir un ingreso del que ya se consumió → inseguro', () => {
    const r = simularCambio({ movimientos: BASE, movId: 'e13', nuevoDelta: 5 }); // de 15 a 5
    expect(r.seguro).toBe(false);
    expect(r.minSaldo).toBe(-5);
  });
  it('subir la cantidad → seguro', () => {
    expect(simularCambio({ movimientos: BASE, movId: 'e13', nuevoDelta: 20 }).seguro).toBe(true);
  });
});

describe('chequeo confiable por stock real (bloqueo duro)', () => {
  it('stockTrasBorrar: borrar un ingreso resta del stock real', () => {
    // ingreso de 4, stock real 1 → quedaría 1 - 4 = -3
    const r = stockTrasBorrar(1, mov('e', '2026-01-13', 'entrada', 4));
    expect(r).toBe(-3);
    expect(dejaNegativo(r)).toBe(true);
  });
  it('stockTrasBorrar: borrar una salida suma de vuelta (nunca negativo)', () => {
    expect(stockTrasBorrar(5, mov('s', '2026-01-13', 'salida', 4))).toBe(9);
  });
  it('stockTrasEditar: subir una salida puede dejar negativo', () => {
    // salida de 10, stock 5 → editar a 20: 5 + 10 - 20 = -5
    const r = stockTrasEditar(5, mov('s', '2026-01-13', 'salida', 10), 20);
    expect(r).toBe(-5);
    expect(dejaNegativo(r)).toBe(true);
  });
  it('stockTrasEditar: bajar una salida es seguro', () => {
    expect(stockTrasEditar(5, mov('s', '2026-01-13', 'salida', 10), 12)).toBe(3);
  });
  it('dejaNegativo: tolera epsilon de redondeo', () => {
    expect(dejaNegativo(0)).toBe(false);
    expect(dejaNegativo(-0.0000000001)).toBe(false);
    expect(dejaNegativo(-0.5)).toBe(true);
  });
});

describe('exclusiones y orden', () => {
  it('ignora movimientos borrados y reversados', () => {
    const movs = [
      ...BASE,
      mov('del', '2026-01-12', 'salida', 999, { deleted_at: '2026-01-20' }),
      mov('rev', '2026-01-12', 'salida', 999, { reversed_by_id: 'x' }),
    ];
    // sigue seguro borrar la salida s14 pese al ruido de movimientos muertos
    expect(simularBorrado({ movimientos: movs, movId: 's14' }).seguro).toBe(true);
  });
  it('ordena por fecha aunque vengan desordenados', () => {
    const desordenado = [BASE[1], BASE[0]]; // salida primero
    const r = simularBorrado({ movimientos: desordenado, movId: 'e13' });
    expect(r.seguro).toBe(false);
    expect(r.fechaViolacion).toBe('2026-01-14');
  });
});
