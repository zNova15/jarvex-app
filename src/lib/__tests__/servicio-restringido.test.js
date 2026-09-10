// El 9-set-2026 Supabase cortó el proyecto (402 exceed_egress_quota) y la app
// se portó de la peor manera: dejaba al usuario adentro sin rol, y a los 30
// minutos de inactividad lo deslogueaba BORRANDO la sesión cacheada — con lo
// que ya no podía volver a entrar, porque para entrar hace falta el servidor.
//
// La distinción que faltaba: `navigator.onLine` es TRUE durante un 402. Hay
// internet perfecto; el que dice que no es el servidor. Para la app tiene que
// valer lo mismo que estar sin señal.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  esErrorDeServicioRestringido, registrarSiEsRestriccion, hayServicioRestringido,
  limpiarServicioRestringido, estamosSinServidor, servicioRestringido,
} from '../servicio-restringido';

beforeEach(() => { limpiarServicioRestringido(); });

describe('reconocer el 402 venga como venga', () => {
  it('lo reconoce por el status del error de auth', () => {
    expect(esErrorDeServicioRestringido({ status: 402, message: 'x' })).toBe(true);
  });

  it('lo reconoce por el code del PostgrestError', () => {
    expect(esErrorDeServicioRestringido({ code: '402', message: 'x' })).toBe(true);
  });

  it('lo reconoce por el texto literal que manda el gateway', () => {
    const err = new Error(
      'Service for this project is restricted due to the following violations: ' +
      'exceed_egress_quota. The project owner must upgrade their plan or remove spend caps to restore service.',
    );
    expect(esErrorDeServicioRestringido(err)).toBe(true);
  });

  it('también reconoce la restricción por tamaño de base', () => {
    expect(esErrorDeServicioRestringido(new Error('violations: exceed_db_size_quota'))).toBe(true);
  });

  it('NO confunde una contraseña mala con el servicio caído', () => {
    expect(esErrorDeServicioRestringido({ status: 400, message: 'Invalid login credentials' })).toBe(false);
  });

  it('NO confunde una RLS con el servicio caído', () => {
    expect(esErrorDeServicioRestringido({ code: '42501', message: 'permission denied for table evidencias' })).toBe(false);
  });

  it('aguanta null/undefined sin romper el ciclo de sync', () => {
    expect(esErrorDeServicioRestringido(null)).toBe(false);
    expect(esErrorDeServicioRestringido(undefined)).toBe(false);
  });
});

describe('la bandera de estado', () => {
  it('arranca limpia', () => {
    expect(hayServicioRestringido()).toBe(false);
  });

  it('registrarSiEsRestriccion la levanta solo con un 402', () => {
    expect(registrarSiEsRestriccion({ status: 400, message: 'Invalid login credentials' })).toBe(false);
    expect(hayServicioRestringido()).toBe(false);

    expect(registrarSiEsRestriccion({ status: 402, message: 'exceed_egress_quota' })).toBe(true);
    expect(hayServicioRestringido()).toBe(true);
  });

  it('guarda desde cuándo, para poder decirlo en el cartel', () => {
    registrarSiEsRestriccion({ status: 402, message: 'exceed_egress_quota' });
    expect(servicioRestringido().desde).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('se limpia cuando el servicio vuelve', () => {
    registrarSiEsRestriccion({ status: 402, message: 'x' });
    expect(limpiarServicioRestringido()).toBe(true);
    expect(hayServicioRestringido()).toBe(false);
    expect(limpiarServicioRestringido()).toBe(false); // ya estaba limpia
  });
});

describe('estamosSinServidor — la distinción que faltaba', () => {
  it('un 402 cuenta como sin servidor AUNQUE navigator.onLine sea true', () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(estamosSinServidor()).toBe(false);
    registrarSiEsRestriccion({ status: 402, message: 'exceed_egress_quota' });
    expect(estamosSinServidor()).toBe(true);
    vi.unstubAllGlobals();
  });

  it('sin señal también cuenta, como siempre', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(estamosSinServidor()).toBe(true);
    vi.unstubAllGlobals();
  });
});
