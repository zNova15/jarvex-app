import { describe, it, expect, beforeAll } from 'vitest';

let DATASETS;

beforeAll(async () => {
  if (typeof window === 'undefined') {
    globalThis.window = {
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  }
  const mod = await import('../export-historico.js');
  DATASETS = mod.DATASETS;
});

describe('export-historico datasets for EPPs and inventory', () => {
  it('includes epps dataset with observaciones header and data', () => {
    const d = DATASETS.find(ds => ds.id === 'epps');
    expect(d).toBeDefined();

    const fakeCtx = {
      epps: [
        {
          id: 'epp-1',
          nombre_epp: 'Casco 3M Blanco',
          tipo_epp: 'Casco',
          marca: '3M',
          modelo: 'H-700',
          talla: 'M',
          unidad: 'Und',
          stock_actual: 15,
          stock_minimo: 5,
          vida_util_dias: 365,
          precio_unitario_estimado: 45.5,
          ubicacion_id: 'u1',
          alerta: 'ok',
          estado: 'activo',
          observaciones: 'Lote con certificación ANSI Z89.1',
        },
      ],
      ubicById: new Map([['u1', { nombre: 'Almacén Central' }]]),
    };

    const { headers, rows } = d.build(fakeCtx);
    expect(headers).toContain('Observaciones');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('Lote con certificación ANSI Z89.1');
    expect(rows[0]).toContain('Almacén Central');
  });

  it('includes observaciones in inventario_general dataset', () => {
    const d = DATASETS.find(ds => ds.id === 'inventario_general');
    expect(d).toBeDefined();

    const fakeCtx = {
      mats: [{ nombre_material: 'Cemento', unidad: 'bls', stock_actual: 50, stock_minimo: 10, alerta: 'ok', estado: 'activo', observaciones: 'Guardar bajo techo' }],
      herrs: [{ nombre_herramienta: 'Taladro', unidad: 'und', stock_actual: 2, stock_minimo: 1, alerta: 'ok', estado_actual: 'operativo', observaciones: 'Requiere carbones' }],
      epps: [{ nombre_epp: 'Lentes', unidad: 'und', stock_actual: 20, stock_minimo: 5, alerta: 'ok', estado: 'activo', observaciones: 'Anti-empañante' }],
      activos: [],
      insEmer: [],
      ubicById: new Map(),
    };

    const { headers, rows } = d.build(fakeCtx);
    expect(headers).toContain('Observaciones');
    expect(rows).toHaveLength(3);
    const obsIndex = headers.indexOf('Observaciones');
    expect(rows.some(r => r[obsIndex] === 'Anti-empañante')).toBe(true);
    expect(rows.some(r => r[obsIndex] === 'Guardar bajo techo')).toBe(true);
  });
});
