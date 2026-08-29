import { describe, it, expect } from 'vitest';
import { normPartidaTxt, filtrarPartidasReporte, limpiarDescripcionReuso } from '../filtrar-partidas';

const HOJAS = [
  { id: 'a', codigo_delfin: '01.02.01', nombre_partida: 'EXCAVACIÓN MASIVA C/MAQUINARIA' },
  { id: 'b', codigo_delfin: '02.01.03', nombre_partida: "COLUMNAS DE CONCRETO F'C=210" },
  { id: 'c', codigo_delfin: '02.01.04', nombre_partida: 'ACERO EN COLUMNAS Ø 1/2"' },
];

describe('normPartidaTxt', () => {
  it('quita tildes, baja a minúsculas y aplana la ñ a n ("banos" encuentra BAÑOS)', () => {
    expect(normPartidaTxt('EXCAVACIÓN')).toBe('excavacion');
    expect(normPartidaTxt('ALBAÑILERÍA')).toBe('albanileria');
    expect(normPartidaTxt("F'C=210")).toBe('f c 210');
  });
});

describe('filtrarPartidasReporte', () => {
  it('"excavacion" (sin tilde) encuentra EXCAVACIÓN', () => {
    const r = filtrarPartidasReporte(HOJAS, 'excavacion');
    expect(r.map(p => p.id)).toEqual(['a']);
  });

  it('multi-palabra AND sin importar el orden: "concreto columna"', () => {
    const r = filtrarPartidasReporte(HOJAS, 'concreto columna');
    expect(r.map(p => p.id)).toEqual(['b']);
  });

  it('también matchea por código', () => {
    expect(filtrarPartidasReporte(HOJAS, '02.01.04').map(p => p.id)).toEqual(['c']);
  });

  it('excluye las ya agregadas y respeta el tope', () => {
    const r = filtrarPartidasReporte(HOJAS, '', { excluirIds: new Set(['a']), max: 1 });
    expect(r.map(p => p.id)).toEqual(['b']);
  });

  it('sin query: mis partidas reportadas recientemente van primero (orden estable el resto)', () => {
    const ultima = new Map([['c', '2026-08-28'], ['b', '2026-08-20']]);
    const r = filtrarPartidasReporte(HOJAS, '', { ultimaFechaPorPartida: ultima });
    expect(r.map(p => p.id)).toEqual(['c', 'b', 'a']);
  });

  it('CON query, la recencia también manda entre las coincidencias', () => {
    const ultima = new Map([['c', '2026-08-28']]);
    // "columna" matchea b y c; c (reportada ayer) debe ir primero.
    const r = filtrarPartidasReporte(HOJAS, 'columna', { ultimaFechaPorPartida: ultima });
    expect(r.map(p => p.id)).toEqual(['c', 'b']);
  });

  it('tolera listas nulas y filas rotas', () => {
    expect(filtrarPartidasReporte(null, 'x')).toEqual([]);
    expect(filtrarPartidasReporte([null, HOJAS[0]], 'excavacion').length).toBe(1);
  });
});

describe('limpiarDescripcionReuso', () => {
  it('quita el prefijo administrativo de reporte tardío', () => {
    expect(limpiarDescripcionReuso('[Reporte tardío subido 2026-08-29 · motivo: sin señal] Se vació concreto en columnas'))
      .toBe('Se vació concreto en columnas');
    expect(limpiarDescripcionReuso('Avance normal del día')).toBe('Avance normal del día');
  });
});
