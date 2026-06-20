import { describe, it, expect } from 'vitest';
import { resumenFrente, planVsReal, rollupMensual } from '../mi-frente.js';

const PART = [
  { id: 'p1', codigo_delfin: '02.01', porcentaje_avance: 40 },
  { id: 'p2', codigo_delfin: '02.02', porcentaje_avance: 60 },
];
const MOVS = [
  { id: 'm1', tipo_movimiento: 'salida', frente_id: 'F1' },
  { id: 'm2', tipo_movimiento: 'salida', frente_id: 'F1' },
  { id: 'm3', tipo_movimiento: 'salida', frente_id: 'F2' },   // otro frente
  { id: 'm4', tipo_movimiento: 'entrada', frente_id: 'F1' },  // no es salida
  { id: 'm5', tipo_movimiento: 'salida', frente_id: 'F1', deleted_at: 'x' },
];
const AV = [
  { id: 'a1', partida_id: 'p1', fecha: '2026-06-10', metrado_ejecutado: 5 },
  { id: 'a2', partida_id: 'p1', fecha: '2026-06-11', metrado_ejecutado: 3 },
  { id: 'a3', partida_id: 'p2', fecha: '2026-05-30', metrado_ejecutado: 7 },  // otro mes
  { id: 'a4', partida_id: 'p9', fecha: '2026-06-10', metrado_ejecutado: 99 }, // otra partida
];

describe('resumenFrente', () => {
  it('cuenta partidas, promedia avance, cuenta salidas del frente y suma metrado real', () => {
    const r = resumenFrente({ partidasDelFrente: PART, movimientos: MOVS, avances: AV, frenteId: 'F1' });
    expect(r.nPartidas).toBe(2);
    expect(r.avancePromedio).toBe(50);     // (40+60)/2
    expect(r.nSalidas).toBe(2);            // m1,m2 (no m3 otro frente, no m4 entrada, no m5 borrado)
    expect(r.metradoReal).toBe(15);        // 5+3 (p1) + 7 (p2); a4 es de otra partida
  });
});

describe('planVsReal', () => {
  const METAS = [
    { id: 'g1', partida_id: 'p1', fecha: '2026-06-10', meta_metrado: 4 },
    { id: 'g2', partida_id: 'p2', fecha: '2026-06-10', meta_metrado: 10 },
  ];
  it('compara meta vs real por partida en una fecha', () => {
    const r = planVsReal({ partidasDelFrente: PART, metas: METAS, avances: AV, fecha: '2026-06-10' });
    const p1 = r.find(x => x.partida.id === 'p1');
    expect(p1.metaMetrado).toBe(4);
    expect(p1.realMetrado).toBe(5);   // a1
    expect(p1.desvio).toBe(1);        // 5-4
    const p2 = r.find(x => x.partida.id === 'p2');
    expect(p2.metaMetrado).toBe(10);
    expect(p2.realMetrado).toBe(0);   // no hay avance de p2 ese día
    expect(p2.desvio).toBe(-10);
  });
});

describe('rollupMensual', () => {
  it('suma metrado real por partida del mes, ignora otros meses y partidas sin avance', () => {
    const r = rollupMensual({ partidasDelFrente: PART, avances: AV, mes: '2026-06' });
    expect(r.length).toBe(1);                 // solo p1 tiene avance en junio
    expect(r[0].partida.id).toBe('p1');
    expect(r[0].metradoMes).toBe(8);          // 5+3
  });
});
