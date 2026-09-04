import { describe, it, expect } from 'vitest';
import { empujarHistorial, sacarHistorial, puedeVolver } from '../nav-historial.js';

describe('empujarHistorial', () => {
  it('empuja una entrada válida al final', () => {
    const p1 = empujarHistorial([], { page: 'contabilidad', plano: 'general' });
    expect(p1).toEqual([{ page: 'contabilidad', plano: 'general' }]);
    const p2 = empujarHistorial(p1, { page: 'empresas', plano: 'general' });
    expect(p2).toEqual([
      { page: 'contabilidad', plano: 'general' },
      { page: 'empresas', plano: 'general' },
    ]);
  });

  it('ignora una entrada sin page (deja la pila intacta)', () => {
    expect(empujarHistorial([{ page: 'a' }], null)).toEqual([{ page: 'a' }]);
    expect(empujarHistorial([{ page: 'a' }], {})).toEqual([{ page: 'a' }]);
    expect(empujarHistorial([{ page: 'a' }], { plano: 'obra' })).toEqual([{ page: 'a' }]);
  });

  it('pila null/undefined se trata como vacía', () => {
    expect(empujarHistorial(null, { page: 'a' })).toEqual([{ page: 'a' }]);
    expect(empujarHistorial(undefined, { page: 'a' })).toEqual([{ page: 'a' }]);
  });

  it('tiene tope: no crece sin límite en una sesión larga', () => {
    let pila = [];
    for (let i = 0; i < 40; i++) pila = empujarHistorial(pila, { page: `p${i}` });
    expect(pila.length).toBe(30);
    // Se conservan las 30 más recientes, no las primeras.
    expect(pila[0].page).toBe('p10');
    expect(pila[pila.length - 1].page).toBe('p39');
  });
});

describe('sacarHistorial', () => {
  it('devuelve la entrada del tope y la pila sin ella', () => {
    const pila = [{ page: 'a' }, { page: 'b' }, { page: 'c' }];
    const { entrada, pila: resto } = sacarHistorial(pila);
    expect(entrada).toEqual({ page: 'c' });
    expect(resto).toEqual([{ page: 'a' }, { page: 'b' }]);
  });

  it('pila vacía o ausente devuelve entrada null sin lanzar', () => {
    expect(sacarHistorial([])).toEqual({ entrada: null, pila: [] });
    expect(sacarHistorial(null)).toEqual({ entrada: null, pila: [] });
    expect(sacarHistorial(undefined)).toEqual({ entrada: null, pila: [] });
  });

  it('no muta la pila original', () => {
    const pila = [{ page: 'a' }, { page: 'b' }];
    sacarHistorial(pila);
    expect(pila).toEqual([{ page: 'a' }, { page: 'b' }]);
  });
});

describe('puedeVolver', () => {
  it('true solo con al menos una entrada', () => {
    expect(puedeVolver([{ page: 'a' }])).toBe(true);
    expect(puedeVolver([])).toBe(false);
    expect(puedeVolver(null)).toBe(false);
    expect(puedeVolver(undefined)).toBe(false);
  });
});

describe('flujo real: entrar a una empresa desde Resumen por entidad y volver', () => {
  it('vuelve a Resumen por entidad, no al catálogo de Empresas', () => {
    let pila = [];
    // Estaba en 'contabilidad' (Resumen por entidad), navega a 'empresas'.
    pila = empujarHistorial(pila, { page: 'contabilidad', plano: 'general' });
    expect(puedeVolver(pila)).toBe(true);

    // Click en «← Volver» desde el detalle de la empresa.
    const { entrada, pila: resto } = sacarHistorial(pila);
    expect(entrada).toEqual({ page: 'contabilidad', plano: 'general' });
    expect(puedeVolver(resto)).toBe(false);
  });
});
