import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validarComprobanteAI } from '../validar-comprobante-ai.js';

// Comprobante mínimo válido para no fallar las validaciones cliente-side del wrapper
const baseComprobante = () => ({
  tipo: '01',
  serie: 'F001',
  correlativo: 1,
  fecha: '2026-05-03',
  moneda: 'PEN',
  emisor: { ruc: '20123456789', razon_social: 'CONSTRUCTORA DEMO SAC' },
  cliente: { tipo_doc: '6', documento: '20987654321', razon_social: 'CLIENTE DEMO SAC', direccion: 'AV. SIEMPRE VIVA 123' },
  items: [{ descripcion: 'Servicio', cantidad: 1, precio_unitario: 100, igv_pct: 18, tax_exemption_code: '10' }],
  totales: { subtotal: 100, igv: 18, total: 118 },
});

beforeEach(() => {
  // navigator.onLine asumido true por defecto. globalThis.navigator
  // puede no existir en environment node — lo stubeamos cuando hace falta.
  vi.stubGlobal('navigator', { onLine: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('validarComprobanteAI — wrapper cliente del endpoint /api/validar-comprobante-ai', () => {
  it('caso happy path: valid:true, confianza alta, sin errors', async () => {
    const fakeResp = {
      result: { valid: true, errors: [], warnings: [] },
      confianza: 0.92,
      razonamiento: 'Todo correcto',
      advertencias: [],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => fakeResp,
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await validarComprobanteAI(baseComprobante());
    expect(out.result.valid).toBe(true);
    expect(out.result.errors).toEqual([]);
    expect(out.confianza).toBeGreaterThanOrEqual(0.85);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/validar-comprobante-ai');
    expect(opts.method).toBe('POST');
    const sentBody = JSON.parse(opts.body);
    expect(sentBody.comprobante.serie).toBe('F001');
  });

  it('caso invalid: trae errors con severidad high y valid:false', async () => {
    const fakeResp = {
      result: {
        valid: false,
        errors: [
          { campo: 'emisor.ruc', mensaje: 'RUC no empieza en 10/15/16/17/20', severidad: 'high' },
          { campo: 'totales.igv', mensaje: 'IGV no coincide con subtotal × 0.18', severidad: 'high' },
        ],
        warnings: [],
      },
      confianza: 0.95,
      razonamiento: 'Errores críticos detectados',
      advertencias: [],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => fakeResp,
    }));

    const out = await validarComprobanteAI(baseComprobante());
    expect(out.result.valid).toBe(false);
    expect(out.result.errors).toHaveLength(2);
    expect(out.result.errors[0].severidad).toBe('high');
  });

  it('error de red → throw con mensaje legible', async () => {
    const netErr = new TypeError('Failed to fetch');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(netErr));

    await expect(validarComprobanteAI(baseComprobante())).rejects.toThrow(/no se pudo conectar/i);
  });

  it('429 cuota agotada → throw con mensaje claro de cuota', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: 'rate limited' }),
    }));

    await expect(validarComprobanteAI(baseComprobante())).rejects.toThrow(/cuota ia agotada/i);
  });

  it('AbortError (timeout) → throw con mensaje de tardó demasiado', async () => {
    const abortErr = new Error('Aborted');
    abortErr.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortErr));

    await expect(validarComprobanteAI(baseComprobante())).rejects.toThrow(/tardó demasiado/i);
  });

  it('sin conexión (navigator.onLine === false) → throw sin pegarle al endpoint', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(validarComprobanteAI(baseComprobante())).rejects.toThrow(/sin conexión/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('comprobante vacío/null → throw inmediato', async () => {
    await expect(validarComprobanteAI(null)).rejects.toThrow(/vacío|inválido/i);
    await expect(validarComprobanteAI(undefined)).rejects.toThrow(/vacío|inválido/i);
  });

  it('respuesta sin campo result → throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ confianza: 0.5 }),
    }));
    await expect(validarComprobanteAI(baseComprobante())).rejects.toThrow(/result/i);
  });
});
