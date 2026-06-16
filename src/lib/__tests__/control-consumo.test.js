import { describe, it, expect } from 'vitest';
import { calcularControlConsumo, UMBRAL } from '../control-consumo.js';

const partida = (over) => ({ id: 'p1', obra_id: 'o1', nombre_partida: 'P1', codigo_delfin: '01', porcentaje_avance: 0, costo_total_presupuestado: 0, costo_real_acumulado: 0, ...over });
const ip = (over) => ({ id: 'i1', partida_id: 'p1', obra_id: 'o1', nombre_insumo: 'Alambre', unidad: 'rollo', cantidad_presupuestada: 0, cantidad_real_usada: 0, costo_presupuestado: 0, costo_real: 0, ...over });

describe('calcularControlConsumo', () => {
  it('alambre: 80% consumido pero 50% de avance → rojo (índice 1.6)', () => {
    const r = calcularControlConsumo({
      partidas: [partida({ porcentaje_avance: 50 })],
      insumosPartida: [ip({ cantidad_presupuestada: 100, cantidad_real_usada: 80 })],
    });
    expect(r[0].insumos[0].indice).toBeCloseTo(1.6, 5);
    expect(r[0].insumos[0].estado).toBe('rojo');
    expect(r[0].estado).toBe('rojo');
  });

  it('verde: 40% consumido con 50% de avance', () => {
    const r = calcularControlConsumo({
      partidas: [partida({ porcentaje_avance: 50 })],
      insumosPartida: [ip({ cantidad_presupuestada: 100, cantidad_real_usada: 40 })],
    });
    expect(r[0].insumos[0].estado).toBe('verde');
    expect(r[0].estado).toBe('verde');
  });

  it('ámbar por consumo cuando no hay avance reportado (90% del presupuesto)', () => {
    const r = calcularControlConsumo({
      partidas: [partida({ porcentaje_avance: 0 })],
      insumosPartida: [ip({ cantidad_presupuestada: 100, cantidad_real_usada: 90 })],
    });
    expect(r[0].insumos[0].indice).toBeNull();
    expect(r[0].insumos[0].estado).toBe('ambar');
  });

  it('rojo por consumo cuando supera el presupuesto (110%) sin avance', () => {
    const r = calcularControlConsumo({
      partidas: [partida({ porcentaje_avance: 0 })],
      insumosPartida: [ip({ cantidad_presupuestada: 100, cantidad_real_usada: 110 })],
    });
    expect(r[0].insumos[0].estado).toBe('rojo');
  });

  it('sin_presupuesto cuando la cantidad presupuestada es 0', () => {
    const r = calcularControlConsumo({
      partidas: [partida()],
      insumosPartida: [ip({ cantidad_presupuestada: 0, cantidad_real_usada: 5 })],
    });
    expect(r[0].insumos[0].estado).toBe('sin_presupuesto');
    expect(r[0].estado).toBe('verde'); // sin_presupuesto no escala el estado de la partida
  });

  it('ignora insumos y partidas borradas (deleted_at)', () => {
    const r = calcularControlConsumo({
      partidas: [partida(), partida({ id: 'p2', deleted_at: '2026-01-01' })],
      insumosPartida: [
        ip({ cantidad_presupuestada: 100, cantidad_real_usada: 200 }),
        ip({ id: 'i2', cantidad_presupuestada: 100, cantidad_real_usada: 999, deleted_at: '2026-01-01' }),
      ],
    });
    expect(r).toHaveLength(1);
    expect(r[0].insumos).toHaveLength(1);
  });

  it('ordena peor-primero (rojo antes que verde)', () => {
    const r = calcularControlConsumo({
      partidas: [
        partida({ id: 'pVerde', porcentaje_avance: 50 }),
        partida({ id: 'pRojo', porcentaje_avance: 50 }),
      ],
      insumosPartida: [
        ip({ id: 'iv', partida_id: 'pVerde', cantidad_presupuestada: 100, cantidad_real_usada: 30 }),
        ip({ id: 'ir', partida_id: 'pRojo', cantidad_presupuestada: 100, cantidad_real_usada: 200 }),
      ],
    });
    expect(r[0].partida.id).toBe('pRojo');
    expect(r[1].partida.id).toBe('pVerde');
  });

  it('UMBRAL expone los cortes configurables', () => {
    expect(UMBRAL.consumoRojo).toBe(1.0);
    expect(UMBRAL.indiceRojo).toBe(1.25);
  });
});
