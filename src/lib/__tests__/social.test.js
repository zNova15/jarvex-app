import { describe, it, expect } from 'vitest';
import { estadoCompromiso, diasAbierta, diasEntre, kpisSocial } from '../social.js';

const HOY = '2026-07-16';

describe('diasEntre', () => {
  it('cuenta días y tolera basura', () => {
    expect(diasEntre('2026-07-16', '2026-07-23')).toBe(7);
    expect(diasEntre('2026-07-16', '2026-07-10')).toBe(-6);
    expect(diasEntre('x', '2026-07-10')).toBeNull();
  });
});

describe('estadoCompromiso', () => {
  it('cumplido manda aunque el límite haya pasado', () => {
    expect(estadoCompromiso({ estado: 'cumplido', fecha_limite: '2026-01-01' }, HOY)).toBe('cumplido');
  });
  it('límite pasado → vencido; ≤7 días → por_vencer; lejos → estado guardado', () => {
    expect(estadoCompromiso({ estado: 'pendiente', fecha_limite: '2026-07-15' }, HOY)).toBe('vencido');
    expect(estadoCompromiso({ estado: 'en_proceso', fecha_limite: '2026-07-20' }, HOY)).toBe('por_vencer');
    expect(estadoCompromiso({ estado: 'en_proceso', fecha_limite: '2026-09-01' }, HOY)).toBe('en_proceso');
  });
  it('sin fecha límite o estado raro → estado guardado / pendiente', () => {
    expect(estadoCompromiso({ estado: 'en_proceso' }, HOY)).toBe('en_proceso');
    expect(estadoCompromiso({ estado: 'rarísimo', fecha_limite: null }, HOY)).toBe('pendiente');
    expect(estadoCompromiso(null, HOY)).toBe('pendiente');
  });
  it('vence HOY → por_vencer (0 días), no vencido', () => {
    expect(estadoCompromiso({ estado: 'pendiente', fecha_limite: HOY }, HOY)).toBe('por_vencer');
  });
});

describe('diasAbierta', () => {
  it('abierta cuenta hasta hoy; cerrada hasta su fecha de cierre', () => {
    expect(diasAbierta({ fecha: '2026-07-01', estado: 'abierta' }, HOY)).toBe(15);
    expect(diasAbierta({ fecha: '2026-07-01', estado: 'cerrada', fecha_cierre: '2026-07-05' }, HOY)).toBe(4);
    expect(diasAbierta({ estado: 'abierta' }, HOY)).toBeNull();
  });
});

describe('kpisSocial', () => {
  it('clasifica compromisos por estado efectivo y quejas por estado', () => {
    const r = kpisSocial({
      compromisos: [
        { estado: 'cumplido' },
        { estado: 'pendiente', fecha_limite: '2026-07-01' },   // vencido
        { estado: 'pendiente', fecha_limite: '2026-07-18' },   // por_vencer (y abierto)
        { estado: 'en_proceso', fecha_limite: '2026-12-01' },  // abierto
      ],
      quejas: [
        { estado: 'abierta' }, { estado: 'en_atencion' }, { estado: 'cerrada' }, { estado: '' },
      ],
    }, HOY);
    expect(r.compromisos).toEqual({ total: 4, cumplidos: 1, vencidos: 1, por_vencer: 1, abiertos: 2 });
    expect(r.quejas).toEqual({ total: 4, abiertas: 2, en_atencion: 1, cerradas: 1 });
  });
  it('sin datos no revienta', () => {
    expect(kpisSocial({}, HOY).compromisos.total).toBe(0);
    expect(kpisSocial(undefined, HOY).quejas.total).toBe(0);
  });
});
