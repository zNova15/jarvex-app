import { describe, it, expect } from 'vitest';
import {
  normInsumo, parClave, resolverPares, construirGrupos, claveGrupoDe,
  scoreNombres, sugerirPares,
} from '../insumo-correlacion';

describe('normInsumo / parClave', () => {
  it('normaliza tildes, ñ, puntuación y espacios', () => {
    expect(normInsumo("Clavos de 8''")).toBe('clavos de 8');
    expect(normInsumo('CAÑERÍA  Ø 1/2"')).toBe('caneria 1 2');
  });
  it('el par es canónico sin importar el orden', () => {
    expect(parClave('Clavo 8', 'clavos de 8')).toBe(parClave('CLAVOS DE 8', 'clavo 8'));
  });
});

describe('resolverPares', () => {
  const base = { deleted_at: null, demo: false, relacion: 'mismo' };
  it('manual pisa a sugerido; a igual fuente gana el más reciente', () => {
    const filas = [
      { ...base, nombre_a: 'clavo 8', nombre_b: 'clavos de 8', fuente: 'sugerido', relacion: 'mismo', updated_at: '2026-09-02' },
      { ...base, nombre_a: 'clavos de 8', nombre_b: 'clavo 8', fuente: 'manual', relacion: 'distinto', updated_at: '2026-09-01' },
    ];
    const r = resolverPares(filas);
    expect(r.size).toBe(1);
    expect([...r.values()][0].relacion).toBe('distinto');   // manual ganó pese a ser más viejo
  });
  it('excluye deleted, demo y nombres vacíos', () => {
    const r = resolverPares([
      { ...base, nombre_a: 'a b c', nombre_b: 'x y', deleted_at: '2026-01-01' },
      { ...base, nombre_a: 'a b c', nombre_b: 'x y', demo: true },
      { ...base, nombre_a: '', nombre_b: 'x y' },
    ]);
    expect(r.size).toBe(0);
  });
});

describe('construirGrupos', () => {
  it('agrupa por transitividad (a=b, b=c → {a,b,c}) y respeta los distintos', () => {
    const pares = resolverPares([
      { relacion: 'mismo', nombre_a: 'clavo 8', nombre_b: 'clavos de 8', fuente: 'manual', updated_at: '1' },
      { relacion: 'mismo', nombre_a: 'clavos de 8', nombre_b: 'clavo 8 pulgadas', fuente: 'manual', updated_at: '2', canonico: 'Clavo de 8"' },
      { relacion: 'distinto', nombre_a: 'clavo 8', nombre_b: 'clavo 4', fuente: 'manual', updated_at: '3' },
    ]);
    const { grupoDe, grupos } = construirGrupos(pares);
    const gid = grupoDe.get('clavo 8');
    expect(gid).toBeDefined();
    expect(grupoDe.get('clavos de 8')).toBe(gid);
    expect(grupoDe.get('clavo 8 pulgadas')).toBe(gid);
    expect(grupoDe.get('clavo 4')).toBeUndefined();          // 'distinto' no agrupa
    expect(grupos.get(gid).canonico).toBe('Clavo de 8"');    // el fijado manualmente
    expect(claveGrupoDe('CLAVOS DE 8', grupoDe)).toBe(gid);
    expect(claveGrupoDe('cemento sol', grupoDe)).toBe('cemento sol');  // suelto → él mismo
  });
});

describe('scoreNombres', () => {
  it('el caso bandera: "Clavo 8 pulg" ≈ "Clavos de 8"', () => {
    expect(scoreNombres('Clavo 8 pulg', "Clavos de 8''")).toBeGreaterThanOrEqual(0.55);
  });
  it('medidas distintas = 0 (clavo de 8 vs clavo de 4 NO son el mismo insumo)', () => {
    expect(scoreNombres('clavo de 8', 'clavo de 4')).toBe(0);
  });
  it('prefijo corto no matchea (tub ≠ tuerca), plural sí (tubo ≈ tubos)', () => {
    expect(scoreNombres('tubo pvc', 'tubos pvc')).toBe(1);
    expect(scoreNombres('tue', 'tuerca')).toBe(0);
  });
});

describe('sugerirPares', () => {
  const nombres = ['Clavo 8 pulg', "Clavos de 8''", 'Cemento Sol tipo I', 'CEMENTO SOL TIPO I x 42.5kg', 'Arena gruesa'];
  it('propone los similares y omite los ya decididos o ya agrupados', () => {
    const sinDecidir = sugerirPares(nombres, new Map(), new Map());
    const claves = sinDecidir.map(p => parClave(p.nombre_a, p.nombre_b));
    expect(claves).toContain(parClave('clavo 8 pulg', 'clavos de 8'));

    const resueltos = resolverPares([
      { relacion: 'mismo', nombre_a: 'Clavo 8 pulg', nombre_b: "Clavos de 8''", fuente: 'manual', updated_at: '1' },
    ]);
    const { grupoDe } = construirGrupos(resueltos);
    const luego = sugerirPares(nombres, resueltos, grupoDe);
    expect(luego.map(p => parClave(p.nombre_a, p.nombre_b)))
      .not.toContain(parClave('clavo 8 pulg', 'clavos de 8'));
  });
  it('nunca propone un par marcado DISTINTO (no vuelve a preguntar)', () => {
    const resueltos = resolverPares([
      { relacion: 'distinto', nombre_a: 'Cemento Sol tipo I', nombre_b: 'CEMENTO SOL TIPO I x 42.5kg', fuente: 'manual', updated_at: '1' },
    ]);
    const s = sugerirPares(nombres, resueltos, new Map());
    expect(s.map(p => parClave(p.nombre_a, p.nombre_b)))
      .not.toContain(parClave('cemento sol tipo i', 'cemento sol tipo i x 42 5kg'));
  });
});
