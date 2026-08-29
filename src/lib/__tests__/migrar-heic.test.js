import { describe, it, expect } from 'vitest';
import {
  esEvidenciaHeic, storagePathDeUrl, pathJpgDe, nombreJpgDe, migrarEvidenciasHeic,
} from '../migrar-heic';

describe('helpers HEIC', () => {
  it('esEvidenciaHeic detecta .heic/.heif (con o sin query) y nada más', () => {
    expect(esEvidenciaHeic({ url_archivo: 'https://x/storage/v1/object/public/evidencias/o/2026-07/a.heic' })).toBe(true);
    expect(esEvidenciaHeic({ url_archivo: 'https://x/e/a.HEIF?token=z' })).toBe(true);
    expect(esEvidenciaHeic({ url_archivo: 'https://x/e/a.jpg' })).toBe(false);
    expect(esEvidenciaHeic({ url_archivo: null })).toBe(false);
    expect(esEvidenciaHeic(null)).toBe(false);
  });

  it('storagePathDeUrl extrae el path dentro del bucket (público o no, con query)', () => {
    expect(storagePathDeUrl('https://p.supabase.co/storage/v1/object/public/evidencias/obra1/2026-07/id1.heic'))
      .toBe('obra1/2026-07/id1.heic');
    expect(storagePathDeUrl('https://p.supabase.co/storage/v1/object/evidencias/obra1/2026-07/id1.heic?download=1'))
      .toBe('obra1/2026-07/id1.heic');
    expect(storagePathDeUrl('https://p.supabase.co/storage/v1/object/public/otrobucket/a.heic')).toBe(null);
    expect(storagePathDeUrl('')).toBe(null);
  });

  it('pathJpgDe / nombreJpgDe re-extensionan conservando el resto', () => {
    expect(pathJpgDe('obra1/2026-07/id1.heic')).toBe('obra1/2026-07/id1.jpg');
    expect(pathJpgDe('obra1/2026-07/id1.HEIF')).toBe('obra1/2026-07/id1.jpg');
    expect(nombreJpgDe('IMG_0001.heic')).toBe('IMG_0001.jpg');
    expect(nombreJpgDe('sin-extension')).toBe('sin-extension.jpg');
    expect(nombreJpgDe('')).toBe('foto.jpg');
  });
});

// ── migración con dependencias falsas ────────────────────────────────

const URL_HEIC = (id) => `https://p.supabase.co/storage/v1/object/public/evidencias/obra1/2026-07/${id}.heic`;

function fakeEnv({ filas, rowUpdateError = null, removeError = null, decodifica = true }) {
  const llamadas = { uploads: [], removes: [], updates: [], dbUpdates: [] };
  const supabase = {
    from: (tabla) => ({
      select: () => ({ or: async () => ({ data: filas, error: null }) }),
      update: (patch) => ({ eq: async (col, val) => {
        llamadas.updates.push({ tabla, patch, val });
        return { error: rowUpdateError };
      } }),
    }),
    storage: { from: () => ({
      download: async (path) => ({ data: { size: 4_000_000, path }, error: null }),
      upload: async (path, blob, opts) => { llamadas.uploads.push({ path, opts }); return { error: null }; },
      getPublicUrl: (path) => ({ data: { publicUrl: `https://p.supabase.co/storage/v1/object/public/evidencias/${path}` } }),
      remove: async (paths) => { llamadas.removes.push(paths); return { error: removeError }; },
    }) },
  };
  const db = { evidencias: { update: async (id, patch) => { llamadas.dbUpdates.push({ id, patch }); } } };
  const optimizar = async (blob) => decodifica
    ? { convertida: true, blob: { size: 200_000 }, mime: 'image/jpeg' }
    : { convertida: false, blob };
  return { supabase, db, optimizar, llamadas };
}

describe('migrarEvidenciasHeic', () => {
  const fila = { id: 'e1', obra_id: 'obra1', nombre_archivo: 'IMG_1.heic', url_archivo: URL_HEIC('id1'), mime_type: 'application/octet-stream' };

  it('camino feliz: sube .jpg, actualiza fila, borra el .heic y suma el ahorro', async () => {
    const env = fakeEnv({ filas: [fila] });
    const r = await migrarEvidenciasHeic(env);
    expect(r.convertidas).toBe(1);
    expect(r.errores).toBe(0);
    expect(env.llamadas.uploads[0].path).toBe('obra1/2026-07/id1.jpg');
    expect(env.llamadas.uploads[0].opts.cacheControl).toBe('2592000');
    expect(env.llamadas.updates[0].patch.mime_type).toBe('image/jpeg');
    expect(env.llamadas.updates[0].patch.nombre_archivo).toBe('IMG_1.jpg');
    // El original se borra AL FINAL, y solo el original.
    expect(env.llamadas.removes).toEqual([['obra1/2026-07/id1.heic']]);
    expect(r.mbAhorrados).toBeGreaterThan(3);
  });

  it('si el UPDATE de la fila falla → rollback del .jpg y el original queda intacto', async () => {
    const env = fakeEnv({ filas: [fila], rowUpdateError: { message: 'RLS' } });
    const r = await migrarEvidenciasHeic(env);
    expect(r.convertidas).toBe(0);
    expect(r.errores).toBe(1);
    // Un solo remove: el del .jpg recién subido (rollback) — NUNCA el original.
    expect(env.llamadas.removes).toEqual([['obra1/2026-07/id1.jpg']]);
  });

  it('navegador sin decoder HEIC → cuenta noDecodificadas y NO toca nada', async () => {
    const env = fakeEnv({ filas: [fila], decodifica: false });
    const r = await migrarEvidenciasHeic(env);
    expect(r.noDecodificadas).toBe(1);
    expect(env.llamadas.uploads).toEqual([]);
    expect(env.llamadas.removes).toEqual([]);
  });

  it('si borrar el original falla, la conversión vale igual y se reporta aparte', async () => {
    const env = fakeEnv({ filas: [fila], removeError: { message: 'storage RLS' } });
    const r = await migrarEvidenciasHeic(env);
    expect(r.convertidas).toBe(1);
    expect(r.sinBorrarOriginal).toBe(1);
  });

  it('sin candidatas: termina limpio', async () => {
    const env = fakeEnv({ filas: [] });
    const r = await migrarEvidenciasHeic(env);
    expect(r).toMatchObject({ total: 0, convertidas: 0, errores: 0 });
  });
});
