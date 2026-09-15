// ═══════════════════════════════════════════════════════════════════
// BUSCAR POR EL DICCIONARIO — el caso exacto que reportó Gabriel el 15-set:
// escribió «clavos» en «Clasificaciones y diccionario» y no salió nada.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  buscarClasificaciones, cuantasEnDiccionario, terminoCoincide, nombreCoincide,
} from '../buscar-clasificacion.js';

const CATS = [
  { codigo: '26', nombre: 'Clavos', label: '[26] Clavos', arbol: 'insumo' },
  { codigo: '37', nombre: 'Herramienta manual', label: '[37] Herramienta manual', arbol: 'insumo' },
  { codigo: '21', nombre: 'Cemento Portland tipo I', label: '[21] Cemento Portland tipo I', arbol: 'insumo' },
  { codigo: '83', nombre: 'Implemento y accesorio de seguridad', label: '[83] Implemento y accesorio de seguridad', arbol: 'insumo' },
];

const DICC = new Map([
  ['26', [{ termino: 'Clavo de acero', origen: 'inei' }, { termino: 'Clavo de calamina', origen: 'inei' }]],
  ['37', [{ termino: 'Llave stillson', origen: 'inei' }, { termino: 'Llave francesa', origen: 'inei' }]],
  ['21', [{ termino: 'Cemento Portland puzolánico', origen: 'inei' }]],
  ['83', [{ termino: 'Chaleco de seguridad', origen: 'inei' }]],
]);

describe('coincidencia de un término', () => {
  it('«clavos» encuentra «Clavo de acero» (singular contra plural)', () => {
    expect(terminoCoincide('clavos', 'Clavo de acero')).toBe(true);
  });

  it('«llave» encuentra «Llave stillson»', () => {
    expect(terminoCoincide('llave', 'Llave stillson')).toBe(true);
  });

  it('no confunde prefijos cortos: «cal» no se lleva «Clavo de calamina»', () => {
    expect(terminoCoincide('cal', 'Clavo de calamina')).toBe(false);
  });

  it('ignora tildes y mayúsculas', () => {
    expect(terminoCoincide('PUZOLANICO', 'Cemento Portland puzolánico')).toBe(true);
  });

  it('exige TODAS las palabras buscadas', () => {
    expect(terminoCoincide('clavo calamina', 'Clavo de calamina')).toBe(true);
    expect(terminoCoincide('clavo calamina', 'Clavo de acero')).toBe(false);
  });
});

describe('el nombre y el código siguen funcionando como antes', () => {
  it('encuentra por nombre', () => {
    expect(nombreCoincide('herramienta', CATS[1])).toBe(true);
  });

  it('encuentra por código', () => {
    expect(nombreCoincide('83', CATS[3])).toBe(true);
  });

  it('con la búsqueda vacía entran todas', () => {
    expect(buscarClasificaciones({ q: '', cats: CATS })).toHaveLength(4);
  });
});

describe('la casilla del diccionario', () => {
  it('APAGADA, «llave» no encuentra nada — que es el defecto que se reportó', () => {
    const r = buscarClasificaciones({ q: 'llave', cats: CATS, diccPorCodigo: DICC, enDiccionario: false });
    expect(r).toHaveLength(0);
  });

  it('PRENDIDA, «llave» encuentra [37] por su diccionario y dice con qué término', () => {
    const r = buscarClasificaciones({ q: 'llave', cats: CATS, diccPorCodigo: DICC, enDiccionario: true });
    expect(r.map(x => x.codigo)).toEqual(['37']);
    expect(r[0].porNombre).toBe(false);
    expect(r[0].terminos.map(t => t.termino)).toContain('Llave stillson');
  });

  it('«clavos» encuentra la que se llama así Y la que lo tiene en el diccionario', () => {
    const r = buscarClasificaciones({ q: 'clavos', cats: CATS, diccPorCodigo: DICC, enDiccionario: true });
    expect(r[0].codigo).toBe('26');
    expect(r[0].porNombre).toBe(true);
    // [26] es la misma en los dos casos: matchea por nombre y por diccionario.
    expect(r[0].terminos.length).toBeGreaterThan(0);
  });

  it('las que matchean por nombre van primero', () => {
    const cats = [...CATS, { codigo: 'PI-X', nombre: 'Otra', label: '[PI-X] Otra', arbol: 'insumo', propia: true }];
    const dicc = new Map([...DICC, ['PI-X', [{ termino: 'Clavo especial', origen: 'manual' }]]]);
    const r = buscarClasificaciones({ q: 'clavos', cats, diccPorCodigo: dicc, enDiccionario: true });
    expect(r[0].codigo).toBe('26');
    expect(r.map(x => x.codigo)).toContain('PI-X');
  });
});

describe('el empujón que explica por qué no salió nada', () => {
  it('cuenta las que aparecerían si se mirara el diccionario', () => {
    expect(cuantasEnDiccionario({ q: 'llave', cats: CATS, diccPorCodigo: DICC })).toBe(1);
  });

  it('no cuenta las que ya se encuentran por nombre', () => {
    // «clavos» ya encuentra [26] por nombre: no hay nada nuevo que ofrecer.
    expect(cuantasEnDiccionario({ q: 'clavos', cats: CATS, diccPorCodigo: DICC })).toBe(0);
  });

  it('sin diccionario devuelve 0 en vez de romperse', () => {
    expect(cuantasEnDiccionario({ q: 'llave', cats: CATS, diccPorCodigo: null })).toBe(0);
  });
});
