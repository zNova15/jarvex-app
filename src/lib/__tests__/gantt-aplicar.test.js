import { describe, it, expect } from 'vitest';
import { camposCronograma, decidirEstadoGantt, updateDominioGantt, hayCambioDominio } from '../gantt-aplicar.js';

describe('camposCronograma', () => {
  const t = { fecha_inicio: '2026-06-02', fecha_fin: '2026-06-11', duracion_dias: 10, predecesoras: '02.01' };
  it('escribe los campos presentes', () => {
    expect(camposCronograma(t)).toEqual({
      fecha_inicio_planificada: '2026-06-02', fecha_fin_planificada: '2026-06-11',
      duracion_dias: 10, predecesoras: '02.01',
    });
  });
  it('saltar vacíos (default): NO incluye claves vacías (no pisa lo existente)', () => {
    const r = camposCronograma({ fecha_inicio: null, fecha_fin: '2026-06-11', duracion_dias: null, predecesoras: null });
    expect(r).toEqual({ fecha_fin_planificada: '2026-06-11' });
    expect('fecha_inicio_planificada' in r).toBe(false);
    expect('duracion_dias' in r).toBe(false);
  });
  it('replaceAll: escribe incluso vacíos (borra) → null explícito', () => {
    const r = camposCronograma({ fecha_inicio: null, fecha_fin: '2026-06-11', duracion_dias: null, predecesoras: null }, true);
    expect(r).toEqual({ fecha_inicio_planificada: null, fecha_fin_planificada: '2026-06-11', duracion_dias: null, predecesoras: null });
  });
});

describe('decidirEstadoGantt', () => {
  it('avance ≥ 100 → terminado', () => {
    expect(decidirEstadoGantt(100, 'pendiente')).toBe('terminado');
    expect(decidirEstadoGantt(120, 'en_ejecucion')).toBe('terminado');
    expect(decidirEstadoGantt(100, 'atrasado')).toBe('terminado');
  });
  it('respeta el flag "observado" (no lo pisa a terminado)', () => {
    expect(decidirEstadoGantt(100, 'observado')).toBe(undefined);
  });
  it('0 < avance < 100 desde pendiente → en_ejecucion', () => {
    expect(decidirEstadoGantt(60, 'pendiente')).toBe('en_ejecucion');
  });
  it('NO degrada un estado avanzado', () => {
    expect(decidirEstadoGantt(60, 'terminado')).toBe(undefined);
    expect(decidirEstadoGantt(60, 'en_ejecucion')).toBe(undefined);
    expect(decidirEstadoGantt(0, 'terminado')).toBe(undefined);
  });
  it('avance 0 → sin cambio', () => {
    expect(decidirEstadoGantt(0, 'pendiente')).toBe(undefined);
  });
});

describe('updateDominioGantt + hayCambioDominio', () => {
  it('combina cronograma + estado y NO incluye porcentaje_avance', () => {
    const dom = updateDominioGantt({ estado: 'pendiente' }, { fecha_inicio: '2026-06-02', fecha_fin: '2026-06-11', duracion_dias: 10, porcentaje_avance: 100 });
    expect(dom.estado).toBe('terminado');
    expect(dom.fecha_inicio_planificada).toBe('2026-06-02');
    expect('porcentaje_avance' in dom).toBe(false);
  });
  it('detecta cuando NO hay cambio real (re-import idéntico)', () => {
    const p = { estado: 'terminado', fecha_inicio_planificada: '2026-06-02', fecha_fin_planificada: '2026-06-11', duracion_dias: 10 };
    const dom = updateDominioGantt(p, { fecha_inicio: '2026-06-02', fecha_fin: '2026-06-11', duracion_dias: 10, porcentaje_avance: 100 });
    expect(hayCambioDominio(p, dom)).toBe(false);
  });
  it('detecta cambio cuando una fecha difiere', () => {
    const p = { estado: 'en_ejecucion', fecha_inicio_planificada: '2026-06-01', fecha_fin_planificada: '2026-06-11', duracion_dias: 10 };
    const dom = updateDominioGantt(p, { fecha_inicio: '2026-06-02', fecha_fin: '2026-06-11', duracion_dias: 10, porcentaje_avance: 60 });
    expect(hayCambioDominio(p, dom)).toBe(true);
  });
});
