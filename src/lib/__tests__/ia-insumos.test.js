import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clasificarInsumoConIA, correlacionarConIA, mapearInsumoConIA } from '../ia-insumos.js';

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

beforeEach(() => {
  setupLocalStorage();
  vi.restoreAllMocks();
});

describe('clasificarInsumoConIA', () => {
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

  it('propaga el error del endpoint (para poder reintentar con el botón)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 503,
      json: async () => ({ error: 'El modelo gratuito no respondió (suele estar saturado unos segundos). Tocá el botón otra vez.' }),
    });
    await expect(
      clasificarInsumoConIA({ descripcion: 'Cemento', candidatos: CANDIDATOS })
    ).rejects.toThrow(/gratuito no respondió/i);
  });

  it('cuando la IA propone algo fuera de la lista, result viene null (no se inventa nada)', async () => {
    const respMock = { result: null, razonamiento: 'La IA propuso un código fuera de la lista ("99") — no se aplicó nada.' };
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => respMock });
    const r = await clasificarInsumoConIA({ descripcion: 'Algo raro', candidatos: CANDIDATOS });
    expect(r.result).toBeNull();
    expect(r.razonamiento).toMatch(/fuera de la lista/);
  });
});

describe('correlacionarConIA', () => {
  it('con menos de dos variantes no llama al endpoint', async () => {
    globalThis.fetch = vi.fn();
    expect(await correlacionarConIA({ variantes: ['uno'] })).toEqual({ result: null, razonamiento: '' });
    expect(await correlacionarConIA({ variantes: ['x', 'x'] })).toEqual({ result: null, razonamiento: '' }); // duplicada
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('manda las variantes y devuelve mismas/fuera', async () => {
    const respMock = {
      result: { mismas: ['Clavo N3', 'Clavo numero 3'], fuera: ['Clavo de 4'], canonico: 'Clavo numero 3' },
      confianza: 0.9, razonamiento: 'Mismo clavo, distinta escritura; el de 4 es otra medida.',
    };
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => respMock });
    const r = await correlacionarConIA({ variantes: ['Clavo N3', 'Clavo numero 3', 'Clavo de 4'] });
    expect(r.result.mismas).toHaveLength(2);
    expect(r.result.fuera).toEqual(['Clavo de 4']);
    const [, opts] = globalThis.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.action).toBe('correlacionar_insumos');
    expect(body.variantes).toHaveLength(3);
  });

  it('la clave de cache es el CONJUNTO, no el orden', async () => {
    const respMock = { result: { mismas: [], fuera: ['a', 'b'], canonico: null }, confianza: 0.4, razonamiento: 'distintos' };
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => respMock });
    await correlacionarConIA({ variantes: ['Tubo A', 'Tubo B'] });
    const r2 = await correlacionarConIA({ variantes: ['Tubo B', 'Tubo A'] });
    expect(r2._cached).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('mapearInsumoConIA', () => {
  const PRESU = [
    { codigo: 'I001', nombre: 'ACERO CORRUGADO fy=4200 Ø 1/2"', unidad: 'kg', clasificacion: '[03] Acero corrugado' },
    { codigo: 'I002', nombre: 'CEMENTO PORTLAND TIPO I', unidad: 'bls', clasificacion: '[21] Cemento' },
  ];

  it('sin insumo o sin candidatos, no llama al endpoint', async () => {
    globalThis.fetch = vi.fn();
    expect(await mapearInsumoConIA({ insumo: '', candidatos: PRESU })).toEqual({ result: null, razonamiento: '' });
    expect(await mapearInsumoConIA({ insumo: 'Fierro', candidatos: [] })).toEqual({ result: null, razonamiento: '' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('manda el insumo con sus candidatos del presupuesto', async () => {
    const respMock = { result: { codigo_sugerido: 'I001', alternativas: [] }, confianza: 0.88, razonamiento: 'Mismo fierro de 1/2.' };
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => respMock });
    const r = await mapearInsumoConIA({
      insumo: 'FIERRO CORRUGADO 1/2', unidad: 'var', clasificacion: '[03] Acero corrugado',
      candidatos: PRESU, obraId: 'obra-1',
    });
    expect(r.result.codigo_sugerido).toBe('I001');
    const [, opts] = globalThis.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.action).toBe('mapear_insumo_presupuesto');
    expect(body.candidatos[0]).toEqual({ codigo: 'I001', nombre: PRESU[0].nombre, unidad: 'kg', clasificacion: PRESU[0].clasificacion });
  });

  it('la cache distingue por obra: el mismo insumo en otro presupuesto se pregunta de nuevo', async () => {
    const respMock = { result: { codigo_sugerido: 'I001', alternativas: [] }, confianza: 0.8, razonamiento: 'ok' };
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => respMock });
    await mapearInsumoConIA({ insumo: 'FIERRO 1/2', candidatos: PRESU, obraId: 'obra-1' });
    const r2 = await mapearInsumoConIA({ insumo: 'FIERRO 1/2', candidatos: PRESU, obraId: 'obra-1' });
    expect(r2._cached).toBe(true);
    const r3 = await mapearInsumoConIA({ insumo: 'FIERRO 1/2', candidatos: PRESU, obraId: 'obra-2' });
    expect(r3._cached).toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
