import { describe, it, expect } from 'vitest';
import {
  planPullRpc, interpretarRespuestaPull, EPOCH_WATERMARK, ID_MINIMO, SIN_WATERMARK,
  marcaVaciaCoincide, errorGlobalDelPull,
  KEY_MASTER, KEY_TX, tablaDeKey, esKeyMaster,
} from '../pull-rpc';

describe('planPullRpc', () => {
  const base = { watermark: '2026-08-28T10:00:00+00:00', localCount: 5, excluida: false, sinServer: false };

  it('tabla incremental sana → entrada del RPC con el cursor compuesto (w, i)', () => {
    const { entries, legacy } = planPullRpc([{ key: 'm:obras', tabla: 'obras', ...base, watermarkId: 'abc' }]);
    expect(entries).toEqual([{ k: 'm:obras', t: 'obras', w: base.watermark, i: 'abc' }]);
    expect(legacy).toEqual([]);
  });

  it('watermark grabado SIN id (versión vieja) → el id mínimo: equivale al >= de antes, una sola vez', () => {
    const { entries } = planPullRpc([{ key: 'm:obras', tabla: 'obras', ...base }]);
    expect(entries).toEqual([{ k: 'm:obras', t: 'obras', w: base.watermark, i: ID_MINIMO }]);
  });

  it('el primer pull desde el epoch NO lleva i: completo o trunc → legacy sin tombstones', () => {
    const { entries } = planPullRpc([{ key: 'm:x', tabla: 'x', ...base, watermark: null, localCount: 0 }]);
    expect(entries[0]).not.toHaveProperty('i');
  });

  it('datos locales SIN watermark → legacy: el full pull con reconcile sweep vive allá', () => {
    const { entries, legacy } = planPullRpc([{ key: 'm:obras', tabla: 'obras', ...base, watermark: null }]);
    expect(entries).toEqual([]);
    expect(legacy).toEqual(['m:obras']);
  });

  it('vacía local y sin watermark → primer pull vía RPC desde el epoch', () => {
    const { entries, legacy } = planPullRpc([
      { key: 'm:subcontratos', tabla: 'subcontratos', ...base, watermark: null, localCount: 0 },
    ]);
    expect(entries).toEqual([{ k: 'm:subcontratos', t: 'subcontratos', w: EPOCH_WATERMARK }]);
    expect(legacy).toEqual([]);
  });

  it('Dexie vacío con watermark grabado (recovery) → legacy', () => {
    const { entries, legacy } = planPullRpc([{ key: 't:asistencia', tabla: 'asistencia', ...base, localCount: 0 }]);
    expect(entries).toEqual([]);
    expect(legacy).toEqual(['t:asistencia']);
  });

  it('recovery que YA volvió vacío con este watermark → RPC incremental (fin del bucle de GET vacíos)', () => {
    const { entries, legacy } = planPullRpc([
      { key: 'm:iperc', tabla: 'iperc', ...base, localCount: 0, vaciaEn: base.watermark, watermarkId: 'z' },
    ]);
    expect(legacy).toEqual([]);
    expect(entries).toEqual([{ k: 'm:iperc', t: 'iperc', w: base.watermark, i: 'z' }]);
  });

  it('la marca de vacía de OTRO watermark no vale: el cursor se movió → recovery de nuevo', () => {
    const { legacy } = planPullRpc([
      { key: 'm:iperc', tabla: 'iperc', ...base, localCount: 0, vaciaEn: '2026-01-01T00:00:00+00:00' },
    ]);
    expect(legacy).toEqual(['m:iperc']);
  });

  it('solo filas de modo prueba y sin watermark, con el full pull ya vacío → epoch por el RPC', () => {
    const { entries, legacy } = planPullRpc([
      { key: 'm:planillas', tabla: 'planillas', ...base, watermark: null, localCount: 3, vaciaEn: SIN_WATERMARK },
    ]);
    expect(legacy).toEqual([]);
    expect(entries).toEqual([{ k: 'm:planillas', t: 'planillas', w: EPOCH_WATERMARK }]);
  });

  it('excluida por rol o inexistente en server → no viaja a ningún lado', () => {
    const { entries, legacy } = planPullRpc([
      { key: 'm:pagos', tabla: 'pagos', ...base, excluida: true },
      { key: 'm:x', tabla: 'x', ...base, sinServer: true },
    ]);
    expect(entries).toEqual([]);
    expect(legacy).toEqual([]);
  });

  it('tolera candidatas malformadas y listas nulas', () => {
    expect(planPullRpc(null)).toEqual({ entries: [], legacy: [] });
    expect(planPullRpc([null, {}, { key: 'a' }])).toEqual({ entries: [], legacy: [] });
  });
});

describe('interpretarRespuestaPull', () => {
  const entries = [
    { k: 'm:obras', t: 'obras', w: 'w1' },
    { k: 't:asistencia', t: 'asistencia', w: 'w2' },
  ];

  it('rows con filas → aplicar; rows vacío → sinCambios (watermark quieto)', () => {
    const r = interpretarRespuestaPull(entries, {
      'm:obras': { rows: [{ id: '1' }] },
      't:asistencia': { rows: [] },
    });
    expect(r.aplicar).toEqual([{ key: 'm:obras', rows: [{ id: '1' }], mas: false }]);
    expect(r.sinCambios).toEqual(['t:asistencia']);
    expect(r.fallback).toEqual([]);
  });

  it('trunc / err / skip / clave ausente / forma inválida → fallback a legacy', () => {
    const casos = [
      { 'm:obras': { trunc: true } },
      { 'm:obras': { err: 'boom' } },
      { 'm:obras': { skip: true } },
      {},
      { 'm:obras': { rows: 'no-array' } },
    ];
    for (const resp of casos) {
      const r = interpretarRespuestaPull([entries[0]], resp);
      expect(r.aplicar).toEqual([]);
      expect(r.fallback).toEqual(['m:obras']);
    }
  });

  it('respuesta nula, no-objeto o con __err global → TODO a fallback', () => {
    for (const resp of [null, undefined, [], 'x', { __err: 'entradas_invalidas' }]) {
      const r = interpretarRespuestaPull(entries, resp);
      expect(r.fallback).toEqual(['m:obras', 't:asistencia']);
      expect(r.aplicar).toEqual([]);
    }
  });
});

describe('cursor compuesto: páginas y errores globales', () => {
  it('página llena del keyset → aplicar con mas:true (se pide otra ronda)', () => {
    const r = interpretarRespuestaPull([{ k: 'm:ipv', t: 'ipv', w: 'w', i: 'i' }], {
      __yo: { rol: 'admin' },
      'm:ipv': { rows: [{ id: 'a' }], mas: true },
    });
    expect(r.aplicar).toEqual([{ key: 'm:ipv', rows: [{ id: 'a' }], mas: true }]);
  });

  it('usuario desactivado → error global, no datos', () => {
    expect(errorGlobalDelPull({ __err: 'usuario_inactivo' })).toBe('usuario_inactivo');
    expect(errorGlobalDelPull({ __yo: {}, 'm:x': { rows: [] } })).toBe(null);
    expect(errorGlobalDelPull(null)).toBe(null);
  });

  it('marcaVaciaCoincide', () => {
    expect(marcaVaciaCoincide(undefined, 'w')).toBe(false);
    expect(marcaVaciaCoincide('w', 'w')).toBe(true);
    expect(marcaVaciaCoincide(SIN_WATERMARK, null)).toBe(true);
    expect(marcaVaciaCoincide(SIN_WATERMARK, 'w')).toBe(false);
  });
});

describe('claves compuestas', () => {
  it('separa el pull master del transaccional de una misma tabla', () => {
    expect(KEY_MASTER('obras')).toBe('m:obras');
    expect(KEY_TX('obras')).toBe('t:obras');
    expect(tablaDeKey('m:obras')).toBe('obras');
    expect(tablaDeKey('t:obras')).toBe('obras');
    expect(esKeyMaster('m:obras')).toBe(true);
    expect(esKeyMaster('t:obras')).toBe(false);
  });
});
