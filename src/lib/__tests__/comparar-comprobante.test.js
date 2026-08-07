import { describe, it, expect } from 'vitest';
import { cmpComprobante } from '../comparar-comprobante.js';

const ordenar = (arr) => [...arr].sort(cmpComprobante);

describe('comparar-comprobante — orden natural', () => {
  it('compara el correlativo como NÚMERO, no como texto', () => {
    expect(cmpComprobante('E001-9', 'E001-10')).toBeLessThan(0);   // 9 antes que 10
    expect(cmpComprobante('E001-10', 'E001-9')).toBeGreaterThan(0);
    expect(cmpComprobante('E001-34', 'E001-34')).toBe(0);
  });
  it('ordena una serie completa en secuencia humana', () => {
    expect(ordenar(['E001-10', 'E001-2', 'E001-1', 'E001-100', 'E001-9']))
      .toEqual(['E001-1', 'E001-2', 'E001-9', 'E001-10', 'E001-100']);
  });
  it('agrupa por serie antes que por número', () => {
    expect(ordenar(['F001-5', 'E001-20', 'E001-3', 'F001-1']))
      .toEqual(['E001-3', 'E001-20', 'F001-1', 'F001-5']);
  });
  it('es case-insensitive y tolera nulos/vacíos', () => {
    expect(cmpComprobante('e001-5', 'E001-5')).toBe(0);
    expect(cmpComprobante(null, 'E001-1')).toBeLessThan(0);   // vacío primero
    expect(cmpComprobante('E001-1', undefined)).toBeGreaterThan(0);
    expect(cmpComprobante(null, null)).toBe(0);
  });
  it('el desempate es total (nunca 0 salvo iguales) para orden estable', () => {
    // Dos documentos distintos jamás devuelven 0 (evita el fallback a orden de id).
    expect(cmpComprobante('E001-1', 'E001-2')).not.toBe(0);
    expect(cmpComprobante('B002-1', 'E001-1')).not.toBe(0);
  });
});
