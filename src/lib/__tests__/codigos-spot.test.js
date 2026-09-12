import { describe, it, expect } from 'vitest';
import {
  CATALOGO_SPOT, buscarCodigoSpot, tasaOficialSpot, etiquetaCodigoSpot,
} from '../codigos-spot.js';

describe('CATALOGO_SPOT', () => {
  it('contiene el código 037 de contratos de construcción al 4%', () => {
    const c037 = buscarCodigoSpot('037');
    expect(c037).not.toBeNull();
    expect(c037.nombre).toMatch(/construcción/i);
    expect(c037.tasa).toBe(4);
  });

  it('normaliza códigos ingresados con o sin ceros a la izquierda', () => {
    expect(buscarCodigoSpot('37')?.codigo).toBe('037');
    expect(buscarCodigoSpot('019')?.codigo).toBe('019');
    expect(buscarCodigoSpot(' 27 ')?.codigo).toBe('027');
    expect(buscarCodigoSpot('999')).toBeNull();
  });

  it('tasaOficialSpot devuelve la tasa correcta', () => {
    expect(tasaOficialSpot('037')).toBe(4);
    expect(tasaOficialSpot('022')).toBe(12);
    expect(tasaOficialSpot('019')).toBe(10);
    expect(tasaOficialSpot('027')).toBe(4);
    expect(tasaOficialSpot('invalido')).toBeNull();
  });

  it('etiquetaCodigoSpot genera una cadena legible', () => {
    const et = etiquetaCodigoSpot('037');
    expect(et).toContain('037');
    expect(et).toContain('Contratos de construcción');
    expect(et).toContain('4%');
  });
});
