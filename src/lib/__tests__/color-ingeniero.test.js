import { describe, it, expect } from 'vitest';
import { hueDeId, colorIngeniero, segmentarAvance } from '../color-ingeniero.js';

describe('color-ingeniero', () => {
  it('hue determinístico y en rango', () => {
    expect(hueDeId('u1')).toBe(hueDeId('u1'));
    expect(hueDeId('u1')).not.toBe(hueDeId('u2'));
    expect(hueDeId('u1')).toBeGreaterThanOrEqual(0);
    expect(hueDeId('u1')).toBeLessThan(360);
  });
  it('colorIngeniero: sin id → gris', () => {
    expect(colorIngeniero(null)).toBe('#7a7a82');
    expect(colorIngeniero('sin')).toBe('#7a7a82');
    expect(colorIngeniero('u1')).toMatch(/^hsl\(/);
  });
});

describe('segmentarAvance', () => {
  const P = { id: 'p1', metrado_contratado: 100 };
  it('segmenta por ingeniero y calcula % total acumulado', () => {
    const av = [
      { partida_id: 'p1', responsable_id: 'A', metrado_ejecutado: 30 },
      { partida_id: 'p1', responsable_id: 'B', metrado_ejecutado: 20 },
      { partida_id: 'p1', responsable_id: 'A', metrado_ejecutado: 10 },  // A acumula 40
    ];
    const r = segmentarAvance(P, av);
    expect(r.totalReal).toBe(60);
    expect(r.pctTotal).toBe(60);
    const a = r.segmentos.find(s => s.uid === 'A');
    const b = r.segmentos.find(s => s.uid === 'B');
    expect(a.metrado).toBe(40);
    expect(a.pct).toBe(40);
    expect(b.metrado).toBe(20);
    expect(b.pct).toBe(20);
  });
  it('sin metrado contratado → normaliza al real (lo avanzado = 100%)', () => {
    const r = segmentarAvance({ id: 'p2' }, [{ partida_id: 'p2', responsable_id: 'A', metrado_ejecutado: 5 }]);
    expect(r.base).toBe(5);
    expect(r.pctTotal).toBe(100);
  });
  it('ignora avances borrados y sin metrado', () => {
    const r = segmentarAvance(P, [
      { partida_id: 'p1', responsable_id: 'A', metrado_ejecutado: 10, deleted_at: 'x' },
      { partida_id: 'p1', responsable_id: 'B', metrado_ejecutado: 0 },
      { partida_id: 'p1', responsable_id: 'C', metrado_ejecutado: 25 },
    ]);
    expect(r.totalReal).toBe(25);
    expect(r.segmentos.length).toBe(1);
    expect(r.segmentos[0].uid).toBe('C');
  });
});
