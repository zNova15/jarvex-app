import { describe, it, expect } from 'vitest';
import { hijosDirectos, cadenaBreadcrumb } from '../partida-arbol.js';

const P = (codigo_delfin, extra = {}) => ({ id: 'id_' + codigo_delfin, codigo_delfin, nombre_partida: 'P ' + codigo_delfin, ...extra });

const ARBOL = [
  P('01'), P('01.01'), P('01.02'),
  P('02'), P('02.01'), P('02.01.01'), P('02.01.02'), P('02.02'),
];

describe('hijosDirectos — navegación por carpetas', () => {
  it('raíz ("" o null) → nodos de nivel 1', () => {
    const r = hijosDirectos(ARBOL, '');
    expect(r.map(n => n.code)).toEqual(['01', '02']);
    expect(r.every(n => n.esFolder)).toBe(true); // ambos tienen hijos
    expect(hijosDirectos(ARBOL, null).map(n => n.code)).toEqual(['01', '02']);
  });

  it('hijos directos de un capítulo (no nietos)', () => {
    const r = hijosDirectos(ARBOL, '02');
    expect(r.map(n => n.code)).toEqual(['02.01', '02.02']);
    expect(r.find(n => n.code === '02.01').esFolder).toBe(true);  // tiene 02.01.01/02
    expect(r.find(n => n.code === '02.02').esFolder).toBe(false); // hoja
  });

  it('hijos hoja traen su fila de partida', () => {
    const r = hijosDirectos(ARBOL, '02.01');
    expect(r.map(n => n.code)).toEqual(['02.01.01', '02.01.02']);
    expect(r[0].esFolder).toBe(false);
    expect(r[0].partida.id).toBe('id_02.01.01');
  });

  it('capítulo sin hijos → []', () => {
    expect(hijosDirectos(ARBOL, '02.02')).toEqual([]);
  });

  it('soporta intermedios SIN fila propia (carpeta sin partida)', () => {
    const sinIntermedio = [P('03.01.01'), P('03.01.02')]; // no existe fila "03" ni "03.01"
    const raiz = hijosDirectos(sinIntermedio, '');
    expect(raiz.map(n => n.code)).toEqual(['03']);
    expect(raiz[0].esFolder).toBe(true);
    expect(raiz[0].partida).toBeNull();
    const n1 = hijosDirectos(sinIntermedio, '03');
    expect(n1.map(n => n.code)).toEqual(['03.01']);
    expect(n1[0].esFolder).toBe(true);
  });

  it('ignora partidas borradas', () => {
    const r = hijosDirectos([P('05'), P('05.01', { deleted_at: '2026-01-01' }), P('05.02')], '05');
    expect(r.map(n => n.code)).toEqual(['05.02']);
  });

  it('ordena numéricamente (10 después de 2)', () => {
    const r = hijosDirectos([P('07.2'), P('07.10'), P('07.1')], '07');
    expect(r.map(n => n.code)).toEqual(['07.1', '07.2', '07.10']);
  });
});

describe('cadenaBreadcrumb', () => {
  it('raíz → … → código', () => {
    expect(cadenaBreadcrumb('02.01.01')).toEqual(['', '02', '02.01', '02.01.01']);
  });
  it('código vacío → solo raíz', () => {
    expect(cadenaBreadcrumb('')).toEqual(['']);
    expect(cadenaBreadcrumb(null)).toEqual(['']);
  });
});
