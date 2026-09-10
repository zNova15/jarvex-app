// El 9-sep-2026 Supabase cortó el proyecto entero (402 exceed_egress_quota) y
// nadie pudo entrar. La causa no fue el tráfico de la gente: fue el pull
// incremental re-descargando tablas completas cada 30 segundos.
//
// El pull filtraba .gte('updated_at', watermark) y avanzaba el watermark a
// MAX(updated_at). Con una tabla importada de golpe —todas sus filas con el
// MISMO updated_at— el .gte devuelve la tabla entera en cada ciclo, para
// siempre. Medido en producción: insumos_partida_versionadas devolvía sus 6.722
// filas (5,14 MB) cada 30 s y por dispositivo.
//
// Estos tests fijan el cursor compuesto (updated_at, id) que lo corrige.
import { describe, it, expect } from 'vitest';
import { filtroIncremental, idDelBorde } from '../../sync/cursor-incremental';

// Doble del query builder de PostgREST: sólo anota qué filtro se pidió.
function queryFalso() {
  return {
    filtros: [],
    gte(col, val) { this.filtros.push({ tipo: 'gte', col, val }); return this; },
    or(expr)      { this.filtros.push({ tipo: 'or', expr }); return this; },
  };
}

const SELLO = '2026-06-11T23:31:03.022+00:00';

describe('filtroIncremental — el cursor compuesto', () => {
  it('sin sello no filtra nada (full pull)', () => {
    const q = queryFalso();
    expect(filtroIncremental(q, null, null).filtros).toEqual([]);
  });

  it('con sello pero sin id cae al .gte de siempre (watermark de una versión vieja)', () => {
    const q = filtroIncremental(queryFalso(), SELLO, null);
    expect(q.filtros).toEqual([{ tipo: 'gte', col: 'updated_at', val: SELLO }]);
  });

  it('con sello e id pide lo posterior MÁS lo del mismo sello aún no visto', () => {
    const id = '25002e0a-c6d2-48f1-85d3-467cf7d2b8a6';
    const q = filtroIncremental(queryFalso(), SELLO, id);
    expect(q.filtros).toHaveLength(1);
    expect(q.filtros[0].tipo).toBe('or');
    expect(q.filtros[0].expr).toBe(
      `updated_at.gt.${SELLO},and(updated_at.eq.${SELLO},id.gt.${id})`,
    );
  });

  it('NO usa .gte cuando hay cursor: ese era exactamente el derroche', () => {
    const q = filtroIncremental(queryFalso(), SELLO, 'abc');
    expect(q.filtros.some(f => f.tipo === 'gte')).toBe(false);
  });
});

describe('idDelBorde — la segunda mitad del cursor', () => {
  it('toma el id más alto ENTRE LOS QUE COMPARTEN el sello máximo', () => {
    const filas = [
      { id: 'z', updated_at: '2026-01-01T00:00:00+00:00' }, // sello viejo: se ignora
      { id: 'b', updated_at: SELLO },
      { id: 'm', updated_at: SELLO },
      { id: 'c', updated_at: SELLO },
    ];
    expect(idDelBorde(filas, SELLO)).toBe('m');
  });

  it('devuelve null si nada empata con el sello (repliegue a .gte, nunca pérdida)', () => {
    expect(idDelBorde([{ id: 'a', updated_at: '2020-01-01T00:00:00+00:00' }], SELLO)).toBe(null);
  });

  it('aguanta filas sin id o vacías sin romper el ciclo de sync', () => {
    expect(idDelBorde([], SELLO)).toBe(null);
    expect(idDelBorde([{ updated_at: SELLO }, null], SELLO)).toBe(null);
  });
});

describe('el caso real que tumbó producción', () => {
  // Las 6.722 filas de insumos_partida_versionadas compartían UN solo sello.
  const tabla = Array.from({ length: 6722 }, (_, i) => ({
    id: String(i).padStart(5, '0'),
    updated_at: SELLO,
  }));

  it('el cursor avanza dentro del bloque de sellos iguales en vez de repetirlo', () => {
    const cursor = idDelBorde(tabla, SELLO);
    expect(cursor).toBe('06721'); // el id más alto del bloque

    // Con ese cursor, el siguiente ciclo ya no pide "todo lo del sello para
    // arriba" sino sólo lo que quede por encima del último id visto.
    const q = filtroIncremental(queryFalso(), SELLO, cursor);
    expect(q.filtros[0].expr).toContain(`id.gt.${cursor}`);
    expect(q.filtros[0].expr).not.toMatch(/^updated_at\.gte/);
  });
});
