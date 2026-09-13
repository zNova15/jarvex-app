import { describe, it, expect } from 'vitest';
import {
  normInsumo, parClave, resolverPares, construirGrupos, claveGrupoDe,
  scoreNombres, sugerirPares, sugerirClusters, crearParesDeCluster,
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
  it('sugiere pares cruzados entre insumos de compra y de venta con descripciones similares', () => {
    const listaCruzada = ['Fierro Corrugado 1/2 pulg', 'Fierro Corrugado de 1/2'];
    const s = sugerirPares(listaCruzada, new Map(), new Map());
    expect(s.length).toBe(1);
    expect(s[0].nombre_a).toBe(normInsumo(listaCruzada[0]));
  });
});

describe('sugerirClusters — Correlaciones Multi-Insumo (N a N)', () => {
  it('agrupa 3 o más variantes del mismo insumo en un solo cluster', () => {
    const variantes = [
      'Clavos N3',
      'Clavos numero 3',
      'Clavos de 3',
      'Clavo 3 pulg',
      'Pintura látex blanca',
    ];
    const clusters = sugerirClusters(variantes, new Map(), new Map());
    expect(clusters.length).toBeGreaterThanOrEqual(1);
    const clusterClavos = clusters.find(c => c.variantes.some(v => v.includes('clavo')));
    expect(clusterClavos).toBeDefined();
    expect(clusterClavos.totalVariantes).toBeGreaterThanOrEqual(3);
    expect(clusterClavos.canonico).toBeTruthy();
  });

  it('crearParesDeCluster genera los enlaces de equivalencia completos para el grupo', () => {
    const vars = ['clavos n3', 'clavos numero 3', 'clavos de 3'];
    const pares = crearParesDeCluster(vars, 'Clavos de 3 pulgadas', 'mismo');
    // Para 3 elementos: combinatoria C(3,2) = 3 pares
    expect(pares.length).toBe(3);
    expect(pares.every(p => p.canonico === normInsumo('Clavos de 3 pulgadas'))).toBe(true);
    expect(pares.every(p => p.relacion === 'mismo')).toBe(true);
  });
});

describe('sacar una variante del grupo antes de aceptarlo', () => {
  it('con un subconjunto genera solo los enlaces de las que quedan', () => {
    const todas = ['clavos n3', 'clavos numero 3', 'clavos de 3', 'clavo 3 pulg'];
    // La tarjeta deja destildar una: al aceptar entran solo las otras tres.
    const dentro = todas.filter(v => v !== 'clavo 3 pulg');
    const pares = crearParesDeCluster(dentro, 'clavos numero 3', 'mismo');
    expect(pares).toHaveLength(3);                       // C(3,2)
    const nombres = new Set(pares.flatMap(p => [p.nombre_a, p.nombre_b]));
    expect(nombres.has(normInsumo('clavo 3 pulg'))).toBe(false);
    // La que se saca NO queda marcada como distinta: no se escribe nada sobre
    // ella, así que vuelve a proponerse como par suelto.
    expect(pares.every(p => p.relacion === 'mismo')).toBe(true);
  });

  it('con menos de dos variantes no hay nada que enlazar', () => {
    expect(crearParesDeCluster(['clavos n3'], 'clavos n3', 'mismo')).toEqual([]);
    expect(crearParesDeCluster([], null, 'mismo')).toEqual([]);
  });

  it('el canónico puede ser el de las que quedan, no el del grupo entero', () => {
    const pares = crearParesDeCluster(['clavos n3', 'clavos de 3'], 'clavos de 3', 'mismo');
    expect(pares.every(p => p.canonico === normInsumo('clavos de 3'))).toBe(true);
  });
});
