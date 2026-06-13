import { describe, it, expect } from 'vitest';
import { planDedupePartidas } from '../partida-dedup.js';

const P = (id, codigo_delfin, extra = {}) => ({
  id, codigo_delfin, created_at: extra.created_at || '2026-01-01T00:00:00Z',
  version: 1, sync_status: 'synced', ...extra,
});

describe('planDedupePartidas — colapsa duplicados por código normalizado', () => {
  it('grupo único (sin duplicados) → plan vacío', () => {
    const plan = planDedupePartidas([P('a', '01.01'), P('b', '01.02')], { a: 5, b: 3 });
    expect(plan).toEqual([]);
  });

  it('01.01 y 1.01 normalizan igual → un grupo; sobrevive la que tiene insumos', () => {
    const parts = [
      P('vacia1', '01.01', { created_at: '2026-06-11T23:27:00Z' }),
      P('vacia2', '1.01', { created_at: '2026-06-11T23:28:00Z' }),
      P('conins', '01.01', { created_at: '2026-06-11T23:31:00Z' }),
    ];
    const plan = planDedupePartidas(parts, { conins: 11, vacia1: 0, vacia2: 0 });
    expect(plan).toHaveLength(1);
    expect(plan[0].survivorId).toBe('conins');
    expect(plan[0].loserIds.sort()).toEqual(['vacia1', 'vacia2']);
  });

  it('si ninguna tiene insumos, sobrevive la que tiene Gantt', () => {
    const parts = [
      P('sinGantt', '02.01', { created_at: '2026-01-01T00:00:00Z' }),
      P('conGantt', '2.01', { created_at: '2026-01-02T00:00:00Z', duracion_dias: 5, fecha_inicio_planificada: '2026-03-01' }),
    ];
    const plan = planDedupePartidas(parts, {});
    expect(plan[0].survivorId).toBe('conGantt');
    expect(plan[0].loserIds).toEqual(['sinGantt']);
  });

  it('sin insumos ni Gantt → sobrevive la más antigua', () => {
    const parts = [
      P('nueva', '03.01', { created_at: '2026-02-01T00:00:00Z' }),
      P('vieja', '3.01', { created_at: '2026-01-01T00:00:00Z' }),
    ];
    const plan = planDedupePartidas(parts, {});
    expect(plan[0].survivorId).toBe('vieja');
  });

  it('fusiona al superviviente la unidad/gantt que solo tiene el loser', () => {
    const parts = [
      P('surv', '04.01', { created_at: '2026-01-02T00:00:00Z', unidad: null }),
      P('los', '4.01', { created_at: '2026-01-01T00:00:00Z', unidad: 'm³', duracion_dias: 7, fecha_inicio_planificada: '2026-03-05' }),
    ];
    // surv gana por insumos pese a ser más nuevo
    const plan = planDedupePartidas(parts, { surv: 3, los: 0 });
    expect(plan[0].survivorId).toBe('surv');
    expect(plan[0].merges.unidad).toBe('m³');
    expect(plan[0].merges.duracion_dias).toBe(7);
    expect(plan[0].merges.fecha_inicio_planificada).toBe('2026-03-05');
  });

  it('no fusiona campos que el superviviente ya tiene', () => {
    const parts = [
      P('surv', '05.01', { unidad: 'und' }),
      P('los', '5.01', { unidad: 'm³' }),
    ];
    const plan = planDedupePartidas(parts, { surv: 2 });
    expect(plan[0].merges.unidad).toBeUndefined();
  });

  it('ignora partidas soft-deleted y sin código', () => {
    const parts = [
      P('a', '06.01'),
      P('b', '6.01', { deleted_at: '2026-01-01T00:00:00Z' }),
      P('c', null),
    ];
    const plan = planDedupePartidas(parts, { a: 1 });
    expect(plan).toEqual([]); // b está borrada, c sin código → 'a' queda sola
  });

  it('el cero final es significativo: 01.10 ≠ 01.01', () => {
    const plan = planDedupePartidas([P('x', '01.10'), P('y', '01.01')], {});
    expect(plan).toEqual([]); // normalizan distinto (1.10 vs 1.1)
  });
});
