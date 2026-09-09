// Tests de lib/sesion-ocupada.js — el registro que impide que la sesión se
// cierre en medio de una lectura de bases de media hora.
//
// Lo que se prueba es el CONTRATO que consume useAuth: mientras haya un
// trabajo vivo, `hayTrabajoEnCurso()` dice que sí; cuando se suelta el último,
// dice que no. Y el vencimiento, que es la red de seguridad para que un
// `finally` que no corrió no deje la sesión abierta para siempre.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ocupar, hayTrabajoEnCurso, trabajosEnCurso, _reiniciar, MAX_MS } from '../sesion-ocupada.js';

describe('sesion-ocupada', () => {
  beforeEach(() => { _reiniciar(); });
  afterEach(() => { _reiniciar(); vi.useRealTimers(); });

  it('sin trabajos, la sesión se puede cerrar', () => {
    expect(hayTrabajoEnCurso()).toBe(false);
    expect(trabajosEnCurso()).toEqual([]);
  });

  it('un trabajo vivo bloquea el cierre y su motivo se puede leer', () => {
    const liberar = ocupar('Análisis de bases con IA');
    expect(hayTrabajoEnCurso()).toBe(true);
    expect(trabajosEnCurso().map(t => t.motivo)).toEqual(['Análisis de bases con IA']);
    liberar();
    expect(hayTrabajoEnCurso()).toBe(false);
  });

  it('dos trabajos a la vez: hace falta soltar los dos', () => {
    const a = ocupar('bases');
    const b = ocupar('currículum');
    expect(trabajosEnCurso()).toHaveLength(2);
    a();
    expect(hayTrabajoEnCurso()).toBe(true);      // todavía queda el otro
    b();
    expect(hayTrabajoEnCurso()).toBe(false);
  });

  it('soltar dos veces el mismo trabajo no libera el de otro', () => {
    const a = ocupar('bases');
    const b = ocupar('currículum');
    a(); a(); a();
    expect(hayTrabajoEnCurso()).toBe(true);
    expect(trabajosEnCurso().map(t => t.motivo)).toEqual(['currículum']);
    b();
    expect(hayTrabajoEnCurso()).toBe(false);
  });

  it('un token que nadie suelta vence solo: la sesión no queda abierta para siempre', () => {
    vi.useFakeTimers();
    ocupar('lectura colgada');                    // sin liberar a propósito
    expect(hayTrabajoEnCurso()).toBe(true);
    vi.setSystemTime(new Date(Date.now() + MAX_MS + 1000));
    expect(hayTrabajoEnCurso()).toBe(false);
  });

  it('un trabajo largo pero razonable NO vence antes de tiempo', () => {
    vi.useFakeTimers();
    ocupar('lectura de 94 páginas, dos pasadas');
    vi.setSystemTime(new Date(Date.now() + 50 * 60 * 1000));   // 50 minutos
    expect(hayTrabajoEnCurso()).toBe(true);
  });
});
