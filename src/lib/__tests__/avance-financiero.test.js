import { describe, it, expect } from 'vitest';
import { calcAvanceFinanciero } from '../avance-financiero.js';

// Helpers para armar fixtures legibles.
const ip = (partida_id, insumo_codigo, costo) => ({ partida_id, insumo_codigo, costo_presupuestado: costo });
const vin = (insumo_codigo, cantidad, precio_unitario) => ({ insumo_codigo, cantidad, precio_unitario });
const partidas = (m) => new Map(Object.entries(m).map(([id, av]) => [id, { porcentaje_avance: av }]));

describe('calcAvanceFinanciero — reparto del facturado entre partidas en ejecución', () => {
  it('insumo en UNA partida en ejecución → atribución exacta', () => {
    const r = calcAvanceFinanciero({
      insumosPartida: [ip('p1', 'M1', 1000)],
      vinculos: [vin('M1', 3, 100)],            // facturado 300
      partidasById: partidas({ p1: 50 }),
    });
    expect(r.porPartida.get('p1').facturado).toBeCloseTo(300, 4);
    expect(r.porPartida.get('p1').pct).toBeCloseTo(30, 4);
    expect(r.porPartida.get('p1').estimado).toBe(false);
    expect(r.obraFacturado).toBeCloseTo(300, 4);
    expect(r.obraPct).toBeCloseTo(30, 4);
  });

  it('insumo en DOS partidas en ejecución → reparte ponderado por presupuesto y marca estimado', () => {
    const r = calcAvanceFinanciero({
      insumosPartida: [ip('p1', 'M1', 200), ip('p2', 'M1', 100)],
      vinculos: [vin('M1', 1, 300)],            // facturado 300
      partidasById: partidas({ p1: 10, p2: 80 }),
    });
    expect(r.porPartida.get('p1').facturado).toBeCloseTo(200, 4); // 300 * 200/300
    expect(r.porPartida.get('p2').facturado).toBeCloseTo(100, 4); // 300 * 100/300
    expect(r.porPartida.get('p1').estimado).toBe(true);
    expect(r.porPartida.get('p2').estimado).toBe(true);
  });

  it('una partida en ejecución y otra NO → todo va a la que está en ejecución', () => {
    const r = calcAvanceFinanciero({
      insumosPartida: [ip('p1', 'M1', 200), ip('p2', 'M1', 100)],
      vinculos: [vin('M1', 1, 300)],
      partidasById: partidas({ p1: 25, p2: 0 }),   // p2 no arrancó
    });
    expect(r.porPartida.get('p1').facturado).toBeCloseTo(300, 4);
    expect(r.porPartida.get('p2').facturado).toBeCloseTo(0, 4);
    expect(r.porPartida.get('p1').estimado).toBe(false); // fue a una sola → no estimado
  });

  it('NINGUNA partida del insumo en ejecución → fallback: reparte entre todas', () => {
    const r = calcAvanceFinanciero({
      insumosPartida: [ip('p1', 'M1', 100), ip('p2', 'M1', 100)],
      vinculos: [vin('M1', 1, 300)],
      partidasById: partidas({ p1: 0, p2: 0 }),
    });
    expect(r.porPartida.get('p1').facturado).toBeCloseTo(150, 4);
    expect(r.porPartida.get('p2').facturado).toBeCloseTo(150, 4);
  });

  it('facturado de un insumo que NO está presupuestado → suma a obra pero no a partidas', () => {
    const r = calcAvanceFinanciero({
      insumosPartida: [ip('p1', 'M1', 1000)],
      vinculos: [vin('M1', 1, 200), vin('XX', 1, 500)],  // XX no está en el presupuesto
      partidasById: partidas({ p1: 50 }),
    });
    expect(r.obraFacturado).toBeCloseTo(700, 4);
    expect(r.obraFacturadoAtribuido).toBeCloseTo(200, 4);
    expect(r.porPartida.get('p1').facturado).toBeCloseTo(200, 4);
  });

  it('vínculos con deleted_at o monto 0 se ignoran', () => {
    const r = calcAvanceFinanciero({
      insumosPartida: [ip('p1', 'M1', 1000)],
      vinculos: [
        { ...vin('M1', 2, 100), deleted_at: '2026-01-01' },
        vin('M1', 0, 100),
        vin('M1', 1, 100),
      ],
      partidasById: partidas({ p1: 50 }),
    });
    expect(r.obraFacturado).toBeCloseTo(100, 4);
  });
});
