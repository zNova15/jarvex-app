import { describe, it, expect } from 'vitest';
import { hoyLocal, horaLocal, getTZ, setTZ, etiquetaTZ, ZONAS_HORARIAS, TZ_DEFAULT, fmtFechaLarga, ymdDe } from '../fecha.js';

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

  it('fmtFechaLarga formatea YYYY-MM-DD a DD/MM/YYYY sin corrimiento de zona horaria', () => {
    expect(fmtFechaLarga('2026-09-11')).toBe('11/09/2026');
    expect(fmtFechaLarga('2026-09-11T00:00:00.000Z')).toBe('11/09/2026');
    expect(fmtFechaLarga('2026-01-01')).toBe('01/01/2026');
    expect(fmtFechaLarga('2026-12-31')).toBe('31/12/2026');
    expect(fmtFechaLarga(null)).toBe('');
    expect(fmtFechaLarga('')).toBe('');
  });

  it('ymdDe extrae YYYY-MM-DD sin corrimiento de zona horaria', () => {
    expect(ymdDe('2026-09-11')).toBe('2026-09-11');
    expect(ymdDe('2026-09-11T00:00:00Z')).toBe('2026-09-11');
    expect(ymdDe('2026-05-05T01:00:00Z')).toBe('2026-05-04');
    expect(ymdDe(null)).toBe('');
  });

  it('fmtFechaLarga con ISO UTC de noche resuelve al día local de Perú (America/Lima)', () => {
    // 2026-05-05T01:00:00Z es 2026-05-04 20:00 en Perú (UTC-5)
    expect(fmtFechaLarga('2026-05-05T01:00:00.000Z')).toBe('04/05/2026');
  });
});

