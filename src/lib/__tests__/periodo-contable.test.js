// La fecha de cierre contable sale de `app_config` (tanda C, 25-set-2026).
// Hasta hoy la fila existía y nadie la leía: el aviso de «mes ya presentado»
// iba a decir julio para siempre.
import { describe, it, expect, afterEach } from 'vitest';
import {
  CERRADO_HASTA_DEFAULT, fijarCerradoHasta, cerradoHastaActual,
  periodoCerrado, movEnPeriodoCerrado, avisoPeriodoCerrado,
} from '../periodo-contable.js';

afterEach(() => { fijarCerradoHasta(CERRADO_HASTA_DEFAULT); });

describe('la fecha de cierre vigente', () => {
  it('sin config, rige la de por defecto (julio 2026)', () => {
    expect(cerradoHastaActual()).toBe('2026-07-31');
    expect(periodoCerrado('2026-08-05')).toBe(false);
  });

  it('🔴 lo que viene de app_config manda sobre el default, sin que nadie lo pase', () => {
    expect(fijarCerradoHasta('2026-08-31')).toBe(true);
    expect(periodoCerrado('2026-08-05')).toBe(true);
    expect(movEnPeriodoCerrado({ date: '2026-08-20' })).toBe(true);
    expect(avisoPeriodoCerrado({ date: '2026-08-20', document_number: 'F001-9' })).toMatch(/cerrado hasta el 2026-08-31/);
  });

  it('un valor que no es fecha no pisa la vigente', () => {
    fijarCerradoHasta('2026-08-31');
    expect(fijarCerradoHasta('agosto')).toBe(false);
    expect(fijarCerradoHasta(null)).toBe(false);
    expect(cerradoHastaActual()).toBe('2026-08-31');
  });

  it('pasarla explícita sigue ganando', () => {
    fijarCerradoHasta('2026-08-31');
    expect(periodoCerrado('2026-08-05', '2026-07-31')).toBe(false);
  });
});
