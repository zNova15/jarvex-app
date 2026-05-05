import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sugerirCuentaPcge, clearCuentaPcgeCache } from '../sugerir-cuenta-pcge.js';

// localStorage mock simple para Node
function setupLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

describe('sugerirCuentaPcge', () => {
  beforeEach(() => {
    setupLocalStorage();
    clearCuentaPcgeCache();
    vi.restoreAllMocks();
  });

  it('lanza error si falta type', async () => {
    await expect(sugerirCuentaPcge({ description: 'cemento' })).rejects.toThrow(/type/i);
  });

  it('lanza error si faltan description y category', async () => {
    await expect(sugerirCuentaPcge({ type: 'cost' })).rejects.toThrow(/description o category/i);
  });

  it('llama al endpoint y devuelve la sugerencia', async () => {
    const respMock = {
      result: {
        cuenta_sugerida: '60',
        descripcion_cuenta: 'Compras',
        alternativas: [{ cuenta: '63', descripcion: 'Servicios' }],
      },
      confianza: 0.92,
      razonamiento: 'Es claramente compra de material',
      advertencias: [],
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => respMock,
    });
    const r = await sugerirCuentaPcge({ type: 'cost', description: 'Cemento Sol' });
    expect(r.result.cuenta_sugerida).toBe('60');
    expect(r.confianza).toBe(0.92);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('cachea respuestas: segunda llamada con misma desc no llama al endpoint', async () => {
    const respMock = {
      result: { cuenta_sugerida: '63', descripcion_cuenta: 'Servicios', alternativas: [] },
      confianza: 0.88,
      razonamiento: 'Servicio',
      advertencias: [],
    };
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => respMock });
    const r1 = await sugerirCuentaPcge({ type: 'expense', description: 'Alquiler camión' });
    expect(r1._cached).toBeUndefined();
    const r2 = await sugerirCuentaPcge({ type: 'expense', description: 'Alquiler camión' });
    expect(r2._cached).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('normaliza description (case + espacios) en el cache', async () => {
    const respMock = {
      result: { cuenta_sugerida: '60', descripcion_cuenta: 'Compras', alternativas: [] },
      confianza: 0.9,
      razonamiento: '...',
      advertencias: [],
    };
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => respMock });
    await sugerirCuentaPcge({ type: 'cost', description: 'Fierro 1/2' });
    const r2 = await sugerirCuentaPcge({ type: 'cost', description: '  FIERRO 1/2  ' });
    expect(r2._cached).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('lanza error si el endpoint responde 4xx/5xx', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: 'API key faltante' }),
    });
    await expect(
      sugerirCuentaPcge({ type: 'cost', description: 'Cemento' })
    ).rejects.toThrow(/API key/i);
  });

  it('lanza error si el endpoint devuelve respuesta inválida', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ /* sin result.cuenta_sugerida */ confianza: 0.5 }),
    });
    await expect(
      sugerirCuentaPcge({ type: 'cost', description: 'Cemento' })
    ).rejects.toThrow(/inv[aá]lida/i);
  });
});
