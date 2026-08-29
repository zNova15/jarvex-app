import { describe, it, expect } from 'vitest';
import {
  planPullRpc, interpretarRespuestaPull, EPOCH_WATERMARK,
  KEY_MASTER, KEY_TX, tablaDeKey, esKeyMaster,
} from '../pull-rpc';

describe('planPullRpc', () => {
  const base = { watermark: '2026-08-28T10:00:00+00:00', localCount: 5, excluida: false, sinServer: false };

  it('tabla incremental sana → entrada del RPC', () => {
    const { entries, legacy } = planPullRpc([{ key: 'm:obras', tabla: 'obras', ...base }]);
    expect(entries).toEqual([{ k: 'm:obras', t: 'obras', w: base.watermark }]);
    expect(legacy).toEqual([]);
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
    expect(r.aplicar).toEqual([{ key: 'm:obras', rows: [{ id: '1' }] }]);
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
