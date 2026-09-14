import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clasificarInsumoConIA } from '../clasificar-insumo-ia.js';

function setupLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

const CANDIDATOS = [
  { codigo: '37', nombre: '[37] Herramienta manual' },
  { codigo: '83', nombre: '[83] Implemento y accesorio de seguridad' },
];

describe('clasificarInsumoConIA', () => {
  beforeEach(() => {
    setupLocalStorage();
    vi.restoreAllMocks();
  });

  it('sin descripción o sin candidatos, no llama al endpoint', async () => {
    globalThis.fetch = vi.fn();
    expect(await clasificarInsumoConIA({ descripcion: '', candidatos: CANDIDATOS })).toEqual({ result: null, razonamiento: '' });
    expect(await clasificarInsumoConIA({ descripcion: 'algo', candidatos: [] })).toEqual({ result: null, razonamiento: '' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('llama al endpoint con action clasificar_insumo_iupc y devuelve la sugerencia', async () => {
    const respMock = {
      result: { codigo_sugerido: '83', alternativas: [] },
      confianza: 0.92,
      razonamiento: 'Es ropa de trabajo con cinta reflectiva: EPP, no herramienta.',
    };
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => respMock });
    const r = await clasificarInsumoConIA({
      descripcion: 'PANTALON Y CAMISACO DE DRILL OBRERO AZUL CON CINTA REFLECTIVA',
      candidatos: CANDIDATOS,
    });
    expect(r.result.codigo_sugerido).toBe('83');
    expect(r.confianza).toBe(0.92);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [, opts] = globalThis.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.action).toBe('clasificar_insumo_iupc');
    expect(body.candidatos).toEqual(CANDIDATOS.map(c => ({ codigo: c.codigo, nombre: c.nombre })));
  });

  it('cachea por descripción: segunda llamada no repite el request', async () => {
    const respMock = { result: { codigo_sugerido: '37', alternativas: [] }, confianza: 0.7, razonamiento: 'ok' };
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => respMock });
    const r1 = await clasificarInsumoConIA({ descripcion: 'Llave stillson', candidatos: CANDIDATOS });
    expect(r1._cached).toBeUndefined();
    const r2 = await clasificarInsumoConIA({ descripcion: '  LLAVE STILLSON  ', candidatos: CANDIDATOS });
    expect(r2._cached).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('propaga el error del endpoint', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'No hay motor de IA configurado' }) });
    await expect(
      clasificarInsumoConIA({ descripcion: 'Cemento', candidatos: CANDIDATOS })
    ).rejects.toThrow(/motor de IA/i);
  });

  it('cuando la IA propone algo fuera de la lista, result viene null (no se inventa nada)', async () => {
    const respMock = { result: null, razonamiento: 'La IA propuso un código fuera de la lista ("99") — no se aplicó nada.' };
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => respMock });
    const r = await clasificarInsumoConIA({ descripcion: 'Algo raro', candidatos: CANDIDATOS });
    expect(r.result).toBeNull();
    expect(r.razonamiento).toMatch(/fuera de la lista/);
  });
});
