import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ocrAsistencia, fileToBase64 } from '../ocr-asistencia.js';

// Helper: construir un "File-like" liviano apto para test sin depender del File real del DOM.
function fakeFile({ type = 'image/jpeg', size = 1024, content = 'parte físico de prueba' } = {}) {
  const enc = new TextEncoder().encode(content);
  return {
    type,
    size: typeof size === 'number' ? size : enc.length,
    arrayBuffer: async () => enc.buffer,
  };
}

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

describe('ocrAsistencia · wrapper export', () => {
  it('expone la función ocrAsistencia(file, personalConocido, fecha)', () => {
    expect(typeof ocrAsistencia).toBe('function');
    // 3 argumentos formales esperados (file, personalConocido, fecha)
    expect(ocrAsistencia.length).toBeGreaterThanOrEqual(1);
  });

  it('fileToBase64 produce un string base64 desde un File-like', async () => {
    const f = fakeFile({ content: 'hola' });
    const b64 = await fileToBase64(f);
    expect(typeof b64).toBe('string');
    // "hola" en base64 = "aG9sYQ=="
    expect(b64).toBe('aG9sYQ==');
  });
});

describe('ocrAsistencia · respuestas del endpoint', () => {
  it('respuesta exitosa con confianza alta devuelve el payload normalizado', async () => {
    const fake = {
      result: {
        fila_detectada: [
          { nombre_detectado: 'JUAN PEREZ', dni_detectado_o_null: '12345678', hora_entrada: '07:00', hora_salida_o_null: '17:00', estado: 'asistio', observaciones: null, match_id_o_null: 'p1', confianza_fila: 0.95 },
        ],
        fecha_detectada: '2026-05-03',
        total_personas: 1,
      },
      confianza: 0.92,
      razonamiento: 'Tabla limpia, firmas claras.',
      advertencias: [],
    };
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => fake,
    });

    const out = await ocrAsistencia(
      fakeFile({ type: 'image/jpeg' }),
      [{ id: 'p1', nombres: 'Juan', apellidos: 'Pérez', dni: '12345678' }],
      '2026-05-03'
    );

    expect(out.confianza).toBe(0.92);
    expect(out.result.total_personas).toBe(1);
    expect(out.result.fila_detectada[0].match_id_o_null).toBe('p1');

    // Verifica que llamó al endpoint correcto y mandó el body con campos esperados
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('/api/ocr-asistencia');
    const body = JSON.parse(opts.body);
    expect(body.mimeType).toBe('image/jpeg');
    expect(body.fecha).toBe('2026-05-03');
    expect(Array.isArray(body.personalConocido)).toBe(true);
    expect(typeof body.file).toBe('string');
    expect(body.file.length).toBeGreaterThan(0);
  });

  it('respuesta con baja confianza igual se devuelve (UI decide)', async () => {
    const fake = {
      result: {
        fila_detectada: [
          { nombre_detectado: 'ilegible', dni_detectado_o_null: null, hora_entrada: null, hora_salida_o_null: null, estado: 'asistio', observaciones: 'borroso', match_id_o_null: null, confianza_fila: 0.3 },
        ],
        fecha_detectada: null,
        total_personas: 1,
      },
      confianza: 0.42,
      razonamiento: 'Foto borrosa, varios nombres ilegibles.',
      advertencias: ['imagen borrosa', 'fila 3 cortada'],
    };
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => fake,
    });

    const out = await ocrAsistencia(fakeFile(), [], '2026-05-03');
    expect(out.confianza).toBeLessThan(0.85);
    expect(out.advertencias.length).toBe(2);
  });

  it('error 429 (rate limit) se propaga con status', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Too many requests' }),
    });

    await expect(ocrAsistencia(fakeFile(), [], '2026-05-03'))
      .rejects.toMatchObject({ status: 429 });
  });

  it('error 503 (sin ANTHROPIC_API_KEY) se propaga con mensaje claro', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: 'ANTHROPIC_API_KEY no configurada en Vercel.' }),
    });

    await expect(ocrAsistencia(fakeFile(), [], '2026-05-03'))
      .rejects.toMatchObject({ status: 503, message: expect.stringMatching(/ANTHROPIC_API_KEY/i) });
  });

  it('rechaza tipos MIME no soportados antes de llamar fetch', async () => {
    await expect(
      ocrAsistencia(fakeFile({ type: 'application/octet-stream' }), [], '2026-05-03')
    ).rejects.toThrow(/no permitido|Usa PDF/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
