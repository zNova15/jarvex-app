import { describe, it, expect } from 'vitest';
import {
  buscarCodigoSpot, tasaOficialSpot, etiquetaCodigoSpot, tasaCorrespondeAlCodigo,
} from '../codigos-spot.js';

// 🔴 25-set-2026: el catálogo tenía la construcción en el 037. En el Anexo 3
// de SUNAT la construcción es el 030 (4 %) y el 037 son los demás servicios
// gravados (12 %).
describe('CATALOGO_SPOT', () => {
  it('🔴 contratos de construcción es el 030, al 4%', () => {
    const c = buscarCodigoSpot('030');
    expect(c.nombre).toMatch(/construcción/i);
    expect(c.tasa).toBe(4);
  });

  it('🔴 el 037 son los demás servicios gravados, al 12% — no la construcción', () => {
    const c = buscarCodigoSpot('037');
    expect(c.nombre).toMatch(/demás servicios/i);
    expect(c.tasa).toBe(12);
  });

  it('normaliza códigos ingresados con o sin ceros a la izquierda', () => {
    expect(buscarCodigoSpot('30')?.codigo).toBe('030');
    expect(buscarCodigoSpot('019')?.codigo).toBe('019');
    expect(buscarCodigoSpot(' 27 ')?.codigo).toBe('027');
    expect(buscarCodigoSpot('999')).toBeNull();
  });

  it('tasaOficialSpot devuelve la tasa correcta', () => {
    expect(tasaOficialSpot('030')).toBe(4);
    expect(tasaOficialSpot('022')).toBe(12);
    expect(tasaOficialSpot('019')).toBe(10);
    expect(tasaOficialSpot('027')).toBe(4);
    expect(tasaOficialSpot('026')).toBe(10);
    expect(tasaOficialSpot('invalido')).toBeNull();
  });

  it('tasaCorrespondeAlCodigo: el alquiler admite 10% y 4%; el 037 al 4% no', () => {
    expect(tasaCorrespondeAlCodigo('019', 4)).toBe(true);
    expect(tasaCorrespondeAlCodigo('019', 10)).toBe(true);
    expect(tasaCorrespondeAlCodigo('037', 4)).toBe(false);
    expect(tasaCorrespondeAlCodigo('999', 4)).toBe(null);
  });

  it('etiquetaCodigoSpot genera una cadena legible', () => {
    const et = etiquetaCodigoSpot('030');
    expect(et).toContain('030');
    expect(et).toContain('Contratos de construcción');
    expect(et).toContain('4%');
  });
});
