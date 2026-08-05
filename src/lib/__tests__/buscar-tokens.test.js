import { describe, it, expect } from 'vitest';
import { coincideTokens, tokensDe } from '../buscar-tokens.js';

describe('buscar-tokens — coincidencia multi-palabra (AND)', () => {
  it('cada palabra debe aparecer, en cualquier orden/posición', () => {
    expect(coincideTokens('TUBO PVC SAP 1/2" C-10', 'Tubo 1/2')).toBe(true);   // el caso reportado
    expect(coincideTokens('TUBO PVC SAP 1/2"', '1/2 tubo')).toBe(true);        // orden inverso
    expect(coincideTokens('TUBO PVC SAP 3/4"', 'Tubo 1/2')).toBe(false);       // falta "1/2"
    expect(coincideTokens('CODO 1/2"', 'Tubo 1/2')).toBe(false);              // falta "tubo"
  });
  it('query vacío coincide con todo; texto vacío no coincide salvo query vacío', () => {
    expect(coincideTokens('cualquier cosa', '')).toBe(true);
    expect(coincideTokens('cualquier cosa', '   ')).toBe(true);
    expect(coincideTokens('', 'tubo')).toBe(false);
    expect(coincideTokens(null, '')).toBe(true);
  });
  it('es case-insensitive y tolera espacios múltiples', () => {
    expect(coincideTokens('Cemento Sol 42.5', 'CEMENTO   sol')).toBe(true);
    expect(tokensDe('  Tubo   1/2  ')).toEqual(['tubo', '1/2']);
  });
});
