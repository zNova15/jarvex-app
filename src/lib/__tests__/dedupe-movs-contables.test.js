import { describe, it, expect } from 'vitest';
import { claveComprobante, claveSinRuc, detectarDuplicados, elegirConservado, claseDe } from '../dedupe-movs-contables.js';

const ventaBase = {
  id: 'v1', clase: 'venta', type: 'income', company_id: 'emp-A',
  document_number: 'E001-134', third_party_ruc: '20601234567',
  third_party_name: 'CONSORCIO SAMADAY', amount: 5000, date: '2026-01-28',
  created_at: '2026-01-28T10:00:00Z', sync_status: 'synced',
};

describe('claveComprobante', () => {
  it('venta: empresa emisora + serie normalizada (el RUC del tercero NO participa)', () => {
    expect(claveComprobante(ventaBase)).toBe('venta|emp-A|comprobante|E001-134');
    // El mismo doc escrito distinto (ceros a la izquierda) → misma clave.
    expect(claveComprobante({ ...ventaBase, document_number: 'E001-00000134' }))
      .toBe('venta|emp-A|comprobante|E001-134');
  });

  it('compra: proveedor (RUC) + serie', () => {
    const compra = { ...ventaBase, id: 'c1', clase: 'compra', type: 'cost' };
    expect(claveComprobante(compra)).toBe('compra|20601234567|comprobante|E001-134');
  });

  it('compra sin RUC cae al nombre normalizado', () => {
    const compra = { ...ventaBase, clase: 'compra', third_party_ruc: null, third_party_name: '  Ferretería  El Sol ' };
    expect(claveComprobante(compra)).toBe('compra|FERRETERÍA EL SOL|comprobante|E001-134');
  });

  it('sin document_number o borrado → null (no participa)', () => {
    expect(claveComprobante({ ...ventaBase, document_number: '' })).toBe(null);
    expect(claveComprobante({ ...ventaBase, deleted_at: '2026-01-01' })).toBe(null);
  });

  // Tanda C (25-set-2026): la venta E001-1 y su nota de crédito E001-1 son
  // dos papeles válidos (SUNAT numera por tipo). Antes caían en el mismo
  // grupo y el fusionador borraba la NOTA.
  it('🔴 una nota de crédito NUNCA comparte llave con la factura del mismo número', () => {
    const nota = { ...ventaBase, id: 'n1', document_type: 'nota_credito', amount: -5000 };
    expect(claveComprobante(nota)).toBe('venta|emp-A|nota_credito|E001-134');
    expect(claveComprobante(nota)).not.toBe(claveComprobante(ventaBase));
    const grupos = detectarDuplicados([ventaBase, nota]);
    expect(grupos).toHaveLength(0);
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

// ── LA SEGUNDA LLAVE: EL MISMO PAPEL CON OTRO RUC ──────────────────
// El caso PACÍFICO SEGUROS medido en GASOMI (23-set-2026): la misma factura
// cargada dos veces, una con el RUC de Pacífico y otra con el de MAPFRE.
const pacifico = {
  id: 'p1', clase: 'compra', type: 'expense', company_id: 'gasomi',
  document_number: 'F087-1234177', document_type: 'factura',
  third_party_ruc: '20332970411', third_party_name: 'PACÍFICO COMPAÑÍA DE SEGUROS Y REASEGUROS',
  amount: 254.28, currency: 'PEN', date: '2026-02-26',
  created_at: '2026-09-13T21:55:00Z', sync_status: 'synced',
};
const pacificoRucMalo = {
  ...pacifico, id: 'p2', third_party_ruc: '20418896915',
  created_at: '2026-08-13T17:28:00Z',
};

describe('claveSinRuc', () => {
  it('ignora el RUC pero exige empresa, lado, comprobante, fecha, importe y moneda', () => {
    expect(claveSinRuc(pacifico)).toBe(claveSinRuc(pacificoRucMalo));
    expect(claveSinRuc(pacifico))
      .toBe('sinruc|compra|gasomi|comprobante|F087-1234177|2026-02-26|254.28|PEN');
  });

  it('el signo del importe no la parte (una nota cargada en positivo y en negativo)', () => {
    expect(claveSinRuc({ ...pacifico, amount: -254.28 })).toBe(claveSinRuc(pacifico));
  });

  it('sin fecha o sin importe devuelve null: sin esos dos no sostiene nada', () => {
    expect(claveSinRuc({ ...pacifico, date: null })).toBe(null);
    expect(claveSinRuc({ ...pacifico, amount: 0 })).toBe(null);
    expect(claveSinRuc({ ...pacifico, company_id: null })).toBe(null);
  });

  it('una nota de crédito nunca comparte llave con la factura que modifica', () => {
    const nota = { ...pacifico, id: 'p3', document_type: 'nota_credito' };
    expect(claveSinRuc(nota)).not.toBe(claveSinRuc(pacifico));
  });
});

describe('detectarDuplicados · mismo comprobante con RUC distinto', () => {
  it('agrupa el par de PACÍFICO que la llave con RUC no veía', () => {
    const grupos = detectarDuplicados([pacifico, pacificoRucMalo]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].rucsDistintos).toBe(true);
    expect(grupos[0].rucs.sort()).toEqual(['20332970411', '20418896915']);
    expect(grupos[0].miembros.map(m => m.id).sort()).toEqual(['p1', 'p2']);
  });

  it('NO agrupa las E001-1 de proveedores distintos (los 29 falsos positivos)', () => {
    const a = { ...pacifico, id: 'a', document_number: 'E001-1', third_party_ruc: '20111111111',
      date: '2026-03-24', amount: 19230 };
    const b = { ...pacifico, id: 'b', document_number: 'E001-1', third_party_ruc: '20222222222',
      date: '2026-03-27', amount: 8030 };
    expect(detectarDuplicados([a, b])).toHaveLength(0);
  });

  it('mismo comprobante y mismo RUC pero distinta fecha e importe tampoco se agrupa por la 2ª llave', () => {
    const a = { ...pacifico, id: 'a', third_party_ruc: '', third_party_name: '', document_number: 'E001-1', date: '2026-03-24', amount: 100 };
    const b = { ...pacifico, id: 'b', third_party_ruc: '', third_party_name: '', document_number: 'E001-1', date: '2026-05-01', amount: 900 };
    expect(detectarDuplicados([a, b])).toHaveLength(0);
  });

  it('el mismo comprobante en empresas distintas del grupo no es duplicado', () => {
    expect(detectarDuplicados([pacifico, { ...pacificoRucMalo, company_id: 'el-inca' }])).toHaveLength(0);
  });

  it('rucsDistintos es false cuando las dos copias traen el mismo RUC (AUTOMANIA)', () => {
    const otra = { ...pacifico, id: 'p9', document_number: 'FF01-11086', third_party_ruc: '20570848985' };
    const [g] = detectarDuplicados([otra, { ...otra, id: 'p10' }]);
    expect(g.rucsDistintos).toBe(false);
  });

  it('tres copias: dos con un RUC y una con otro caen TODAS en el mismo grupo', () => {
    const tercera = { ...pacifico, id: 'p3', created_at: '2026-09-20T00:00:00Z' };
    const g = detectarDuplicados([pacifico, pacificoRucMalo, tercera]);
    expect(g).toHaveLength(1);
    expect(g[0].miembros).toHaveLength(3);
    expect(g[0].duplicados).toHaveLength(2);
  });
});

describe('elegirConservado', () => {
  it('cambia el sobreviviente sin mutar el grupo original', () => {
    const [g] = detectarDuplicados([pacifico, pacificoRucMalo]);
    const elegido = elegirConservado(g, 'p1');
    expect(elegido.conservar.id).toBe('p1');
    expect(elegido.duplicados.map(m => m.id)).toEqual(['p2']);
    expect(elegido.miembros).toHaveLength(2);
    expect(g.conservar.id).toBe(g.conservar.id);   // el original sigue entero
    expect(g.miembros).toHaveLength(2);
  });

  it('un id que no es del grupo lo deja como estaba', () => {
    const [g] = detectarDuplicados([pacifico, pacificoRucMalo]);
    expect(elegirConservado(g, 'no-existe')).toBe(g);
  });
});
