import { describe, it, expect } from 'vitest';
import { hoyLocal, horaLocal, getTZ, setTZ, etiquetaTZ, ZONAS_HORARIAS, TZ_DEFAULT } from '../fecha.js';

describe('fecha (zona horaria)', () => {
  it('hoyLocal devuelve formato YYYY-MM-DD', () => {
    expect(hoyLocal('America/Lima')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(hoyLocal('UTC')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('horaLocal devuelve formato HH:MM', () => {
    expect(horaLocal('America/Lima')).toMatch(/^\d{2}:\d{2}$/);
  });
  it('default es America/Lima; getTZ/setTZ no lanzan sin localStorage', () => {
    expect(TZ_DEFAULT).toBe('America/Lima');
    expect(() => setTZ('UTC')).not.toThrow();
    expect(typeof getTZ()).toBe('string');   // sin localStorage cae al default
  });
  it('etiquetaTZ resuelve conocidas y desconocidas', () => {
    expect(etiquetaTZ('America/Lima')).toContain('Perú');
    expect(etiquetaTZ('Marte/Olympus')).toBe('Marte/Olympus');
  });
  it('Lima y UTC pueden diferir de día cerca de medianoche (rango válido)', () => {
    // Ambos son fechas válidas; el punto del helper es que Lima no salta de día por UTC.
    const lima = hoyLocal('America/Lima');
    const utc = hoyLocal('UTC');
    expect(ZONAS_HORARIAS.some(z => z.id === 'America/Lima')).toBe(true);
    // La diferencia entre Lima y UTC es a lo sumo de 1 día.
    const dl = new Date(lima + 'T00:00:00Z').getTime();
    const du = new Date(utc + 'T00:00:00Z').getTime();
    expect(Math.abs(dl - du)).toBeLessThanOrEqual(24 * 3600 * 1000);
  });
});
