// ═══════════════════════════════════════════════════════════════════
// «ESTOS PARECEN EL MISMO» DENTRO DEL INVENTARIO (16-set-2026).
// Los casos son TEXTUALES de las 32 correlaciones que Gabriel hizo a mano
// ese día — son la definición de qué tiene que proponer y qué no.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { cabezaDe, cabezaLarga, sugerirPorCabeza } from '../sugerencia-inventario.js';
import { resolverPares, construirGrupos, normInsumo } from '../insumo-correlacion.js';

const ins = (display, variantes = null) => ({
  clave: normInsumo(display), display, variantes: variantes || [display],
});
const corr = (a, b, relacion) => ({
  id: `${a}|${b}`, nombre_a: normInsumo(a), nombre_b: normInsumo(b),
  relacion, fuente: 'manual', updated_at: '2026-09-16T06:00:00Z',
  deleted_at: null, demo: false,
});

describe('la cabeza de un nombre', () => {
  it.each([
    ['LLAVE STILSON DE 18 PULGADAS M/STANLEY', 'llave'],
    ['MARTILLO DEMOLEDOR TOTAL 1700KW', 'martillo'],
    ['COMBA 20 LB 9 KG OCTAGONAL MANGO DE MADERA', 'comba'],
    ['4 PULGADAS DE BROCHA', 'pulgadas'],      // el número nunca es la cabeza
  ])('%s → %s', (n, esperado) => expect(cabezaDe(n)).toBe(esperado));

  it('la cabeza larga separa lo que la corta junta', () => {
    expect(cabezaLarga('MARTILLO DEMOLEDOR TOTAL 1700KW')).toBe('martillo demoledor');
    expect(cabezaLarga('MARTILLO DE BOLA 350G DEXTER')).toBe('martillo bola');
  });
});

describe('🔴 las llaves stilson: cinco medidas, un solo insumo', () => {
  // Gabriel unió 36" · 24" · 18" · 12" · 8" el 16-set. El scorer las da en
  // CERO (medidas distintas) y por eso nunca se las propuso.
  const llaves = [
    ins('LLAVE STILLSON PARA CAÑOS 36" BAHCO'),
    ins('LLAVE STILSON DE 24 PULGADAS M/STANLEY'),
    ins('LLAVE STILSON DE 18 PULGADAS M/STANLEY'),
    ins('LLAVE STILSON DE 12 PULGADAS M/KAMASA'),
  ];
  it('las propone juntas', () => {
    const g = sugerirPorCabeza(llaves);
    expect(g).toHaveLength(1);
    expect(g[0].insumos).toHaveLength(4);
  });
  it('una vez unidas, deja de proponerlas', () => {
    const filas = [];
    for (let i = 0; i < llaves.length; i++)
      for (let j = i + 1; j < llaves.length; j++)
        filas.push(corr(llaves[i].display, llaves[j].display, 'mismo'));
    const { grupoDe } = construirGrupos(resolverPares(filas));
    expect(sugerirPorCabeza(llaves, { grupoDe })).toEqual([]);
  });
});

describe('🔴 lo que NO tiene que proponer', () => {
  it('perno y tuerca comparten todas las medidas y NO son lo mismo', () => {
    const g = sugerirPorCabeza([
      ins('PERNO HEX UNC G2 3/8-16 x 2'),
      ins('TUERCA HEX UNC G2 3/8-16NT'),
    ]);
    expect(g).toEqual([]);            // cabezas distintas: perno ≠ tuerca
  });

  it('no repregunta un par que ya se marcó DISTINTO', () => {
    const bola = ins('MARTILLO DE BOLA 350G 28MM MADERA DEXTER');
    const demo = ins('MARTILLO DEMOLEDOR TOTAL 1700KW');
    const resueltos = resolverPares([corr(bola.display, demo.display, 'distinto')]);
    expect(sugerirPorCabeza([bola, demo], { resueltos })).toEqual([]);
  });

  it('con un distinto adentro, parte el grupo por cabeza larga en vez de descartarlo', () => {
    // Los dos demoledores SÍ son el mismo (Gabriel los unió); el de bola no.
    const bola = ins('MARTILLO DE BOLA 350G 28MM MADERA DEXTER');
    const d1 = ins('MARTILLO DEMOLEDOR TOTAL 1700KW');
    const d2 = ins('MARTILLO DEMOLEDOR SDS HEXAGONAL 1700W 45J 16KG');
    const resueltos = resolverPares([corr(bola.display, d1.display, 'distinto')]);
    const g = sugerirPorCabeza([bola, d1, d2], { resueltos });
    expect(g).toHaveLength(1);
    expect(g[0].cabeza).toBe('martillo demoledor');
    expect(g[0].insumos.map(i => i.display)).toEqual([d1.display, d2.display]);
  });

  it('sobre una lista larga no sugiere nada: la persona no acotó', () => {
    const muchos = Array.from({ length: 60 }, (_, i) => ins(`TORNILLO NUMERO ${i}`));
    expect(sugerirPorCabeza(muchos)).toEqual([]);
  });
});

describe('primero lo que resuelve más filas', () => {
  it('ordena por tamaño de grupo', () => {
    const g = sugerirPorCabeza([
      ins('BROCHA DE 2"'), ins('BROCHA TUMI 2PG'),
      ins('CINCEL SDS MAX DEWALT'), ins('CINCELES'), ins('CINCEL DE 3/4 x 12'),
    ]);
    expect(g[0].cabeza).toBe('cincel');
    expect(g[0].insumos).toHaveLength(3);
    expect(g[1].insumos).toHaveLength(2);
  });
});

describe('🔴 LA BROCHA Y LA PRENSA (16-set-2026): el caso real que se coló', () => {
  // Se unieron por error «BROCHAS DE 4 PULGADAS» con «PRENSA DE 4 PULGADAS DE
  // FIERRO NODULAR» — compartían la medida y nada más. Ninguna de las dos
  // tenía clasificación todavía, así que el aviso de clasificaciones (que
  // compara lo YA decidido) no tenía nada que comparar. El aviso de cabezas
  // en jx-empresa-detalle.jsx usa exactamente esta función para frenarlo:
  // si hubiera existido antes, `cabezaDe` de las dos daba distinto y el
  // modal de unir habría mostrado el aviso en rojo.
  it('brocha y prensa NO comparten cabeza', () => {
    expect(cabezaDe('BROCHAS DE 4 PULGADAS')).toBe('brochas');
    expect(cabezaDe('PRENSA DE 4 PULGADAS DE FIERRO NODULAR')).toBe('prensa');
    expect(cabezaDe('BROCHAS DE 4 PULGADAS')).not.toBe(cabezaDe('PRENSA DE 4 PULGADAS DE FIERRO NODULAR'));
  });

  it('por eso tampoco se hubieran propuesto juntas en el buscador', () => {
    const g = sugerirPorCabeza([
      ins('BROCHAS DE 4 PULGADAS'),
      ins('PRENSA DE 4 PULGADAS DE FIERRO NODULAR'),
    ]);
    expect(g).toEqual([]);
  });
});
