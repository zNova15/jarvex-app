import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { asistenteSolicitudMaterialesAI } from '../asistente-solicitud-ai.js';

const baseMaterialesObra = () => ([
  { id: 'm1', nombre_material: 'Cemento Sol', unidad: 'bls', stock_actual: 50, precio_unitario_estimado: 28 },
  { id: 'm2', nombre_material: 'Fierro 1/2', unidad: 'kg', stock_actual: 200, precio_unitario_estimado: 5 },
]);

const okPayload = () => ({
  descripcion: 'Necesito cemento y fierro para vaciado de losa',
  materiales_obra: baseMaterialesObra(),
});

beforeEach(() => {
  vi.stubGlobal('navigator', { onLine: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('asistenteSolicitudMaterialesAI', () => {
  it('rechaza descripción muy corta', async () => {
    await expect(
      asistenteSolicitudMaterialesAI({ descripcion: 'ok', materiales_obra: [] })
    ).rejects.toThrow(/corta/i);
  });

  it('rechaza si materiales_obra no es array', async () => {
    await expect(
      asistenteSolicitudMaterialesAI({ descripcion: 'cemento y fierro' })
    ).rejects.toThrow(/cat[aá]logo/i);
  });

  it('rechaza si está offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    await expect(
      asistenteSolicitudMaterialesAI(okPayload())
    ).rejects.toThrow(/conexi[oó]n/i);
  });

  it('happy path devuelve items + confianza', async () => {
    const respMock = {
      result: {
        items: [
          { material_id: 'm1', nombre_match: 'Cemento Sol', cantidad: 100, unidad: 'bls', precio_estimado: 28, accion: 'usar_existente' },
          { material_id: 'm2', nombre_match: 'Fierro 1/2', cantidad: 500, unidad: 'kg', precio_estimado: 5, accion: 'usar_existente' },
        ],
        descripcion_estructurada: 'Materiales para vaciado de losa',
        fecha_necesidad_sugerida: '2026-05-10',
        prioridad_sugerida: 'alta',
      },
      confianza: 0.92,
      razonamiento: 'Ambos materiales en catálogo',
      advertencias: [],
    };
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => respMock });
    const r = await asistenteSolicitudMaterialesAI(okPayload());
    expect(r.result.items).toHaveLength(2);
    expect(r.confianza).toBe(0.92);
    expect(r.result.prioridad_sugerida).toBe('alta');
  });

  it('error 429 da mensaje de cuota', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 429,
      json: async () => ({ error: 'Cuota agotada' }),
    });
    await expect(asistenteSolicitudMaterialesAI(okPayload())).rejects.toThrow(/cuota/i);
  });

  it('error 503 da mensaje de API key', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 503,
      json: async () => ({ error: 'sin api key' }),
    });
    await expect(asistenteSolicitudMaterialesAI(okPayload())).rejects.toThrow(/ANTHROPIC_API_KEY/i);
  });

  it('error 504 da mensaje de timeout server', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 504,
      json: async () => ({ error: 'timeout' }),
    });
    await expect(asistenteSolicitudMaterialesAI(okPayload())).rejects.toThrow(/tard/i);
  });

  it('respuesta sin result.items lanza error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ confianza: 0.5 }),
    });
    await expect(asistenteSolicitudMaterialesAI(okPayload())).rejects.toThrow(/inv[aá]lida|items/i);
  });

  it('AbortError client-side da mensaje claro', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await expect(asistenteSolicitudMaterialesAI(okPayload())).rejects.toThrow(/tard/i);
  });
});
