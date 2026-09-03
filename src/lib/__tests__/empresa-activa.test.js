import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getEmpresaActivaId, setEmpresaActivaId, limpiarEmpresaActiva,
  filtroInicialEmpresa, enContextoDeEmpresa, EMPRESA_ACTIVA_KEY,
} from '../empresa-activa.js';

// localStorage + dispatchEvent de mentira (los tests corren en node).
beforeEach(() => {
  const store = new Map();
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  global.window = { dispatchEvent: vi.fn(), CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } } };
  global.CustomEvent = global.window.CustomEvent;
});

describe('empresa activa', () => {
  it('arranca sin empresa activa: se mira el grupo entero', () => {
    expect(getEmpresaActivaId()).toBe(null);
  });

  it('entrar a una empresa la deja activa y persiste', () => {
    setEmpresaActivaId('c1');
    expect(getEmpresaActivaId()).toBe('c1');
    expect(localStorage.getItem(EMPRESA_ACTIVA_KEY)).toBe('c1');
  });

  it('salir del contexto la borra', () => {
    setEmpresaActivaId('c1');
    limpiarEmpresaActiva();
    expect(getEmpresaActivaId()).toBe(null);
    expect(localStorage.getItem(EMPRESA_ACTIVA_KEY)).toBe(null);
  });

  it('avisa a las pantallas abiertas cuando cambia', () => {
    setEmpresaActivaId('c1');
    expect(window.dispatchEvent).toHaveBeenCalled();
    const ev = window.dispatchEvent.mock.calls[0][0];
    expect(ev.type).toBe('empresa_activa_change');
    expect(ev.detail.id).toBe('c1');
  });

  it('🔴 el filtro de una pantalla contable arranca en la empresa activa', () => {
    // Es lo que evita que entrar a Movimientos desde el desglose de una
    // empresa muestre los movimientos de TODAS.
    setEmpresaActivaId('c1');
    expect(filtroInicialEmpresa()).toBe('c1');
  });

  it('sin empresa activa, el filtro arranca en "todas" (como siempre)', () => {
    expect(filtroInicialEmpresa()).toBe('todas');
  });

  it('respeta el valor de "sin filtro" propio de cada pantalla', () => {
    expect(filtroInicialEmpresa(null)).toBe(null);
    expect(filtroInicialEmpresa('')).toBe('');
    setEmpresaActivaId('c9');
    expect(filtroInicialEmpresa(null)).toBe('c9');
  });

  it('enContextoDeEmpresa distingue el contexto de un filtro elegido a mano', () => {
    expect(enContextoDeEmpresa('c1')).toBe(false);   // no hay activa
    setEmpresaActivaId('c1');
    expect(enContextoDeEmpresa('c1')).toBe(true);
    // El usuario cambió el selector a otra empresa: ya no es el contexto.
    expect(enContextoDeEmpresa('c2')).toBe(false);
    expect(enContextoDeEmpresa('todas')).toBe(false);
  });

  it('un localStorage que explota no rompe la app', () => {
    global.localStorage = {
      getItem: () => { throw new Error('bloqueado'); },
      setItem: () => { throw new Error('bloqueado'); },
      removeItem: () => { throw new Error('bloqueado'); },
    };
    expect(getEmpresaActivaId()).toBe(null);
    expect(() => setEmpresaActivaId('c1')).not.toThrow();
    expect(filtroInicialEmpresa()).toBe('todas');
  });
});
