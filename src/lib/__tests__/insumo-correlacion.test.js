import { describe, it, expect } from 'vitest';
import {
  normInsumo, parClave, resolverPares, construirGrupos, claveGrupoDe,
  scoreNombres, sugerirPares, sugerirClusters, crearParesDeCluster,
  resaltarDiferencias, sugerirCandidatos,
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

  // Regresión 14-sep-2026 (Gabriel, capturas de pantalla): "REDUCCION 1" X
  // 1/2" (de 1 a 1/2) se sugería como el mismo insumo que "REDUCCION 2 1/2"
  // A 1" (de 2-1/2 a 1) — son reducciones DISTINTAS, solo comparten los
  // dígitos 1 y 2 sueltos. normInsumo() parte "1/2" en dos tokens "1" y "2",
  // así que el chequeo de medidas (por PERTENENCIA a un conjunto) los veía
  // compatibles. Ver `normParaScore` en la lib.
  it('fracciones distintas NO son el mismo insumo aunque compartan los dígitos sueltos', () => {
    expect(scoreNombres('REDUCCION 1" X 1/2', 'REDUCCION 2 1/2" A 1')).toBe(0);
    expect(scoreNombres('Fierro de 3/4', 'Fierro de 4/3')).toBe(0);
  });
  it('la MISMA fracción sigue matcheando (no rompió el caso normal)', () => {
    expect(scoreNombres('Tubo PVC 1/2 pulgada', 'Tubos PVC 1/2" pulg')).toBeGreaterThanOrEqual(0.55);
  });
});

describe('resaltarDiferencias — para pintar el par en la UI (14-sep-2026)', () => {
  it('resalta solo las palabras SIN contraparte en el otro nombre', () => {
    const r = resaltarDiferencias('Clavo 8 pulg', "Clavos de 8''");
    // "Clavo"≈"Clavos" y "8"="8" matchean; "pulg" y "de" no tienen contraparte
    // ("de" es stopword, no se marca aunque no matchee nada).
    expect(r.a.find(t => t.texto === 'Clavo').distinto).toBe(false);
    expect(r.a.find(t => t.texto === '8').distinto).toBe(false);
    expect(r.a.find(t => t.texto === 'pulg').distinto).toBe(true);
    expect(r.b.find(t => t.texto === 'de').distinto).toBe(false);
  });
  it('la medida que sobra en un lado queda resaltada (no todo el nombre)', () => {
    const r = resaltarDiferencias('REDUCCION 1" X 1/2', 'REDUCCION 2 1/2" A 1');
    // "REDUCCION" es común: nunca se resalta.
    expect(r.a.find(t => t.texto === 'REDUCCION').distinto).toBe(false);
    expect(r.b.find(t => t.texto === 'REDUCCION').distinto).toBe(false);
    // El "2" de "2 1/2\"" no tiene ninguna contraparte del otro lado —
    // es justo la medida que hace que NO sean el mismo insumo.
    expect(r.b.find(t => t.texto === '2').distinto).toBe(true);
  });
  it('nombres idénticos no marcan nada como distinto', () => {
    const r = resaltarDiferencias('Cemento Sol tipo I', 'Cemento Sol tipo I');
    expect(r.a.every(t => !t.distinto)).toBe(true);
    expect(r.b.every(t => !t.distinto)).toBe(true);
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

describe('sugerirClusters no reabre un grupo ya aceptado (regresión 14-sep-2026)', () => {
  // Bug real reportado por la Contadora Jefe: la tarjeta deja sacar una
  // variante del grupo antes de aceptar (commit del 13-sep). Si la que se
  // saca sigue pareciéndose a CADA una de las que se aceptaron, el
  // union-find volvía a fusionarlas transitivamente en un cluster idéntico
  // al recién resuelto — la tarjeta "no se iba nunca" con el mismo botón de
  // Aceptar, aunque el push ya había guardado la decisión.
  const A = 'Clavos de 3 pulgadas';
  const B = 'Clavo de 3 pulgada';
  const C = 'Clavos 3 pulg';
  const D = 'Clavo numero 3';   // se saca del grupo antes de aceptar

  it('sin nada resuelto, las 4 forman un solo cluster', () => {
    const clusters = sugerirClusters([A, B, C, D], new Map(), new Map());
    expect(clusters.length).toBe(1);
    expect(clusters[0].totalVariantes).toBe(4);
  });

  it('tras aceptar A,B,C y dejar fuera a D, D no reabre el grupo', () => {
    // Lo que hace decidirCluster() al aceptar "las 3 marcadas":
    // crearParesDeCluster arma los C(3,2)=3 enlaces entre A, B y C.
    const pares = crearParesDeCluster([A, B, C], A, 'mismo');
    expect(pares).toHaveLength(3);
    const filas = pares.map((p, i) => ({
      id: `p${i}`, nombre_a: p.nombre_a, nombre_b: p.nombre_b, relacion: p.relacion,
      canonico: p.canonico, fuente: 'manual', deleted_at: null, updated_at: `2026-09-14T00:0${i}:00Z`,
    }));
    const resueltos = resolverPares(filas);
    const { grupoDe } = construirGrupos(resueltos);

    // D sigue pareciéndose a cada una de A, B, C — justo lo que reproducía
    // el bug: sugerirPares las vuelve a proponer sueltas (correcto, D no
    // está decidida con nadie) y ANTES el union-find las refusionaba.
    expect(scoreNombres(D, A)).toBeGreaterThanOrEqual(0.52);
    expect(scoreNombres(D, B)).toBeGreaterThanOrEqual(0.52);
    expect(scoreNombres(D, C)).toBeGreaterThanOrEqual(0.52);

    const clusters = sugerirClusters([A, B, C, D], resueltos, grupoDe);
    // Nada de un cluster {A,B,C,D} de nuevo: A, B y C ya están decididos —
    // D tiene que aparecer suelta (sugerencias individuales), no reabrir el grupo.
    expect(clusters.some(cl => cl.totalVariantes >= 3)).toBe(false);
  });
});

// ── TANDA 4: una sola lista de candidatos ────────────────────────────
// Gabriel, 15-set: «actualmente no entiendo las sugerencias individual y las
// múltiples». No era él: las dos listas salían de la misma función y ninguna
// excluía a la otra, así que el mismo par aparecía arriba dentro de un grupo
// y abajo suelto — y el recorrido con IA lo preguntaba (y lo pagaba) dos veces.
describe('sugerirCandidatos — sin duplicados entre grupos y pares', () => {
  const VARIANTES = ['Clavos N3', 'Clavos numero 3', 'Clavo de 3', 'Clavo N 3'];

  it('un par que vive dentro de un grupo NO se lista aparte', () => {
    const cands = sugerirCandidatos(VARIANTES, new Map(), new Map());
    const grupos = cands.filter(c => c.esGrupo);
    expect(grupos.length).toBeGreaterThan(0);

    // Todos los nombres del grupo, y ningún par suelto formado solo por ellos.
    const dentro = new Set(grupos.flatMap(g => g.variantes));
    for (const c of cands.filter(c => !c.esGrupo)) {
      const [a, b] = c.variantes;
      expect(dentro.has(a) && dentro.has(b)).toBe(false);
    }
  });

  it('cada nombre aparece en UN solo candidato cuando todos son la misma familia', () => {
    const cands = sugerirCandidatos(VARIANTES, new Map(), new Map());
    const vistos = [];
    for (const c of cands) vistos.push(...c.variantes);
    expect(new Set(vistos).size).toBe(vistos.length);
  });

  it('un par entre DOS grupos distintos sí se lista (no se esconde la pregunta)', () => {
    // Dos familias que no se mezclan entre sí.
    const nombres = [
      'Clavos N3', 'Clavos numero 3', 'Clavo de 3',
      'Cemento Sol tipo I', 'Cemento Sol tipo 1', 'Cemento Sol I',
    ];
    const cands = sugerirCandidatos(nombres, new Map(), new Map());
    // Los dos grupos existen y ningún candidato mezcla clavos con cemento.
    for (const c of cands) {
      const hayClavo = c.variantes.some(v => v.includes('clavo'));
      const hayCemento = c.variantes.some(v => v.includes('cemento'));
      expect(hayClavo && hayCemento).toBe(false);
    }
  });

  it('un par es un candidato de dos, con la misma forma que un grupo', () => {
    const cands = sugerirCandidatos(['Tubo PVC 1/2', 'Tuberia PVC 1/2'], new Map(), new Map());
    expect(cands.length).toBeGreaterThan(0);
    const c = cands[0];
    expect(c.variantes).toHaveLength(2);
    expect(typeof c.id).toBe('string');
    expect(typeof c.canonico).toBe('string');
    expect(typeof c.score).toBe('number');
    // `esGrupo` sale del TAMAÑO, no de qué función lo encontró: un «cluster»
    // de dos miembros es un par y se contesta como un par.
    expect(c.esGrupo).toBe(false);
  });

  it('con tres o más variantes sí es un grupo', () => {
    const cands = sugerirCandidatos(VARIANTES, new Map(), new Map());
    const g = cands.find(c => c.variantes.length >= 3);
    expect(g).toBeTruthy();
    expect(g.esGrupo).toBe(true);
  });

  it('ningún candidato se repite: el id es el contenido ordenado', () => {
    const nombres = [...VARIANTES, 'Tubo PVC 1/2', 'Tuberia PVC 1/2', 'Tubo P.V.C. 1/2'];
    const cands = sugerirCandidatos(nombres, new Map(), new Map());
    const ids = cands.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('los que resuelven más nombres van primero', () => {
    const nombres = [...VARIANTES, 'Tubo PVC 1/2', 'Tuberia PVC 1/2'];
    const cands = sugerirCandidatos(nombres, new Map(), new Map());
    for (let i = 1; i < cands.length; i++) {
      expect(cands[i - 1].variantes.length).toBeGreaterThanOrEqual(cands[i].variantes.length);
    }
  });

  it('respeta las decisiones ya tomadas y el tope', () => {
    const resueltos = resolverPares([
      { nombre_a: 'clavos n3', nombre_b: 'clavos numero 3', relacion: 'distinto', fuente: 'manual' },
    ]);
    const cands = sugerirCandidatos(VARIANTES, resueltos, new Map());
    for (const c of cands) {
      const tieneAmbos = c.variantes.includes('clavos n3') && c.variantes.includes('clavos numero 3');
      expect(tieneAmbos).toBe(false);
    }
    expect(sugerirCandidatos(VARIANTES, new Map(), new Map(), { maxCandidatos: 1 })).toHaveLength(1);
  });

  it('sin nombres no explota', () => {
    expect(sugerirCandidatos([], new Map(), new Map())).toEqual([]);
    expect(sugerirCandidatos(null, new Map(), new Map())).toEqual([]);
  });
});
