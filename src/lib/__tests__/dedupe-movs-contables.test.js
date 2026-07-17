import { describe, it, expect } from 'vitest';
import { claveComprobante, detectarDuplicados, claseDe } from '../dedupe-movs-contables.js';

const ventaBase = {
  id: 'v1', clase: 'venta', type: 'income', company_id: 'emp-A',
  document_number: 'E001-134', third_party_ruc: '20601234567',
  third_party_name: 'CONSORCIO SAMADAY', amount: 5000, date: '2026-01-28',
  created_at: '2026-01-28T10:00:00Z', sync_status: 'synced',
};

describe('claveComprobante', () => {
  it('venta: empresa emisora + serie normalizada (el RUC del tercero NO participa)', () => {
    expect(claveComprobante(ventaBase)).toBe('venta|emp-A|E001-134');
    // El mismo doc escrito distinto (ceros a la izquierda) → misma clave.
    expect(claveComprobante({ ...ventaBase, document_number: 'E001-00000134' }))
      .toBe('venta|emp-A|E001-134');
  });

  it('compra: proveedor (RUC) + serie', () => {
    const compra = { ...ventaBase, id: 'c1', clase: 'compra', type: 'cost' };
    expect(claveComprobante(compra)).toBe('compra|20601234567|E001-134');
  });

  it('compra sin RUC cae al nombre normalizado', () => {
    const compra = { ...ventaBase, clase: 'compra', third_party_ruc: null, third_party_name: '  Ferretería  El Sol ' };
    expect(claveComprobante(compra)).toBe('compra|FERRETERÍA EL SOL|E001-134');
  });

  it('sin document_number o borrado → null (no participa)', () => {
    expect(claveComprobante({ ...ventaBase, document_number: '' })).toBe(null);
    expect(claveComprobante({ ...ventaBase, deleted_at: '2026-01-01' })).toBe(null);
  });

  it('clase se infiere del type cuando falta', () => {
    expect(claseDe({ type: 'income' })).toBe('venta');
    expect(claseDe({ type: 'cost' })).toBe('compra');
  });
});

describe('detectarDuplicados', () => {
  it('detecta el caso real: la misma venta E001-134 registrada dos veces', () => {
    const dup = { ...ventaBase, id: 'v2', sync_status: 'synced', created_at: '2026-01-28T11:00:00Z' };
    const otros = { ...ventaBase, id: 'v3', document_number: 'E001-135' };
    const grupos = detectarDuplicados([ventaBase, dup, otros]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].conservar.id).toBe('v1');           // el más antiguo sobrevive
    expect(grupos[0].duplicados.map(m => m.id)).toEqual(['v2']);
    expect(grupos[0].montosDistintos).toBe(false);
  });

  it('prefiere conservar el SINCRONIZADO aunque sea más nuevo', () => {
    const local = { ...ventaBase, id: 'v1', sync_status: 'pending_create', created_at: '2026-01-28T10:00:00Z' };
    const synced = { ...ventaBase, id: 'v2', sync_status: 'synced', created_at: '2026-01-28T11:00:00Z' };
    const [g] = detectarDuplicados([local, synced]);
    expect(g.conservar.id).toBe('v2');
    expect(g.duplicados.map(m => m.id)).toEqual(['v1']);
  });

  it('mismo número emitido por EMPRESAS DISTINTAS no es duplicado', () => {
    const otraEmpresa = { ...ventaBase, id: 'v2', company_id: 'emp-B' };
    expect(detectarDuplicados([ventaBase, otraEmpresa])).toHaveLength(0);
  });

  it('venta y compra con el mismo número no se cruzan', () => {
    const compra = { ...ventaBase, id: 'c1', clase: 'compra', type: 'cost' };
    expect(detectarDuplicados([ventaBase, compra])).toHaveLength(0);
  });

  it('marca montosDistintos cuando el OCR leyó totales diferentes', () => {
    const dup = { ...ventaBase, id: 'v2', amount: 5500, created_at: '2026-01-28T11:00:00Z' };
    const [g] = detectarDuplicados([ventaBase, dup]);
    expect(g.montosDistintos).toBe(true);
  });

  it('ignora los ya borrados', () => {
    const dup = { ...ventaBase, id: 'v2', deleted_at: '2026-02-01' };
    expect(detectarDuplicados([ventaBase, dup])).toHaveLength(0);
  });

  it('triplicado: conserva uno y fusiona dos', () => {
    const d2 = { ...ventaBase, id: 'v2', created_at: '2026-01-28T11:00:00Z' };
    const d3 = { ...ventaBase, id: 'v3', created_at: '2026-01-28T12:00:00Z' };
    const [g] = detectarDuplicados([ventaBase, d2, d3]);
    expect(g.conservar.id).toBe('v1');
    expect(g.duplicados.map(m => m.id).sort()).toEqual(['v2', 'v3']);
  });
});
