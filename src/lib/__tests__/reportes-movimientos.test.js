import { describe, it, expect } from 'vitest';
import { dirMovimiento, agregarMovimientos } from '../reportes-movimientos.js';

// Catálogo sintético (2 materiales, 1 herramienta, 1 epp).
const catalogo = [
  { cat: 'material', id: 'm1', nombre: 'Cemento', unidad: 'bls', stock: 0,   stockMin: 10, precio: 25 },
  { cat: 'material', id: 'm2', nombre: 'Arena',   unidad: 'm3',  stock: 5,   stockMin: 10, precio: 40 },
  { cat: 'material', id: 'm3', nombre: 'Clavos',  unidad: 'kg',  stock: 100, stockMin: 5,  precio: 8  },
  { cat: 'herramienta', id: 'h1', nombre: 'Taladro', unidad: 'und', stock: 2, stockMin: 1, precio: 0 },
];
const personalById = new Map([
  ['p1', { nombres: 'Juan', apellidos: 'Pérez' }],
  ['p2', { nombres: 'Ana', apellidos: 'Gómez' }],
]);
const subById = new Map([['s1', { razon_social: 'Subcon SAC' }]]);
const frenteById = new Map([['f1', 'Losa N3'], ['f2', 'Cimientos']]);

// Movimientos sintéticos.
const M = (o) => ({ cantidad: 1, dir: 'salida', cat: 'material', fecha: '2026-07-10', insumoId: 'm1', insumoNombre: 'Cemento', unidad: 'bls', frenteId: null, personaId: null, subId: null, ...o });
const movimientos = [
  M({ id: 'x1', insumoId: 'm1', insumoNombre: 'Cemento', cantidad: 20, personaId: 'p1', frenteId: 'f1', fecha: '2026-07-10' }),
  M({ id: 'x2', insumoId: 'm1', insumoNombre: 'Cemento', cantidad: 10, personaId: 'p2', frenteId: 'f1', fecha: '2026-07-11' }),
  M({ id: 'x3', insumoId: 'm2', insumoNombre: 'Arena',   cantidad: 8,  subId: 's1',    frenteId: 'f2', fecha: '2026-07-11' }),
  M({ id: 'x4', insumoId: 'm3', insumoNombre: 'Clavos',  cantidad: 3,  personaId: 'p1', frenteId: null, fecha: '2026-07-12' }),
  M({ id: 'e1', insumoId: 'm2', insumoNombre: 'Arena',   cantidad: 50, dir: 'entrada', fecha: '2026-07-10' }),
  M({ id: 'd1', insumoId: 'm3', insumoNombre: 'Clavos',  cantidad: 1,  dir: 'devolucion', personaId: 'p1', fecha: '2026-07-12' }),
  // fuera de rango (no debe contar en el período 2026-07-10..2026-07-12)
  M({ id: 'old', insumoId: 'm1', insumoNombre: 'Cemento', cantidad: 99, personaId: 'p1', fecha: '2026-06-01' }),
];

const base = { movimientos, catalogo, personalById, subById, frenteById, tipo: 'todos', from: '2026-07-10', to: '2026-07-12', topN: 10 };

describe('dirMovimiento', () => {
  it('materiales: usa tipo_movimiento', () => {
    expect(dirMovimiento('material', { tipo_movimiento: 'salida' })).toBe('salida');
    expect(dirMovimiento('material', { tipo_movimiento: 'entrada' })).toBe('entrada');
    expect(dirMovimiento('material', { tipo_movimiento: 'ajuste' })).toBe('otro');
  });
  it('herramientas: accion + tipo_movimiento (ingreso=entrada)', () => {
    expect(dirMovimiento('herramienta', { accion: 'salida' })).toBe('salida');
    expect(dirMovimiento('herramienta', { tipo_movimiento: 'ingreso' })).toBe('entrada');
    expect(dirMovimiento('herramienta', { tipo_movimiento: 'devolucion' })).toBe('devolucion');
  });
  it('reverso gana sobre todo', () => {
    expect(dirMovimiento('material', { tipo_movimiento: 'salida', reverses_id: 'z' })).toBe('reverso');
  });
});

describe('agregarMovimientos — KPIs', () => {
  const r = agregarMovimientos(base);
  it('suma salidas del período (excluye fuera de rango)', () => {
    expect(r.kpis.totalSalidas).toBe(20 + 10 + 8 + 3); // 41 (no incluye old=99)
  });
  it('cuenta entradas y devoluciones por separado', () => {
    expect(r.kpis.totalEntradas).toBe(50);
    expect(r.kpis.totalDevoluciones).toBe(1);
  });
  it('valorSalidas usa precio del catálogo (cemento 25, arena 40, clavos 8)', () => {
    expect(r.kpis.valorSalidas).toBe(20 * 25 + 10 * 25 + 8 * 40 + 3 * 8); // 500+250+320+24 = 1094
  });
  it('insumosDistintos = cuántos insumos tuvieron salida', () => {
    expect(r.kpis.insumosDistintos).toBe(3); // m1, m2, m3
  });
  it('nMovimientos incluye entradas/devoluciones del período pero no fuera de rango', () => {
    expect(r.kpis.nMovimientos).toBe(6); // x1..x4 + e1 + d1 (old excluido)
  });
});

describe('agregarMovimientos — TOPs', () => {
  const r = agregarMovimientos(base);
  it('topInsumos ordenado por cantidad de salida', () => {
    expect(r.topInsumos[0].nombre).toBe('Cemento'); // 30
    expect(r.topInsumos[0].cantidad).toBe(30);
    expect(r.topInsumos[1].nombre).toBe('Arena');   // 8
  });
  it('topPersonal agrupa persona y subcontrato', () => {
    const juan = r.topPersonal.find(p => p.nombre === 'Juan Pérez');
    expect(juan.cantidad).toBe(20 + 3); // 23
    const sub = r.topPersonal.find(p => p.nombre.includes('Subcon SAC'));
    expect(sub.cantidad).toBe(8);
    expect(sub.nombre).toContain('(subc.)');
  });
  it('topFrentes agrupa por frente y marca "Sin frente"', () => {
    const losa = r.topFrentes.find(f => f.nombre === 'Losa N3');
    expect(losa.cantidad).toBe(30); // x1+x2
    const sin = r.topFrentes.find(f => f.nombre === 'Sin frente');
    expect(sin.cantidad).toBe(3); // x4 (clavos sin frente)
  });
});

describe('agregarMovimientos — porAgotarse', () => {
  const r = agregarMovimientos(base);
  it('agotado (stock 0) primero, luego crítico', () => {
    expect(r.porAgotarse[0].nombre).toBe('Cemento'); // stock 0 → agotado
    expect(r.porAgotarse[0].estado).toBe('agotado');
    expect(r.porAgotarse[1].nombre).toBe('Arena');   // stock 5 ≤ min 10 → critico
    expect(r.porAgotarse[1].estado).toBe('critico');
  });
  it('los que salieron pero tienen stock sano quedan "ok" al final', () => {
    const clavos = r.porAgotarse.find(x => x.nombre === 'Clavos');
    expect(clavos.estado).toBe('ok'); // stock 100 > min 5
  });
});

describe('agregarMovimientos — filtro por tipo', () => {
  it("tipo='herramienta' excluye materiales", () => {
    const movs2 = [...movimientos, M({ id: 'ht', cat: 'herramienta', insumoId: 'h1', insumoNombre: 'Taladro', cantidad: 2, dir: 'salida', personaId: 'p2', fecha: '2026-07-11' })];
    const r = agregarMovimientos({ ...base, movimientos: movs2, tipo: 'herramienta' });
    expect(r.kpis.totalSalidas).toBe(2);
    expect(r.topInsumos.map(i => i.nombre)).toEqual(['Taladro']);
  });
});

describe('agregarMovimientos — robustez', () => {
  it('sin datos no revienta', () => {
    const r = agregarMovimientos({});
    expect(r.kpis.totalSalidas).toBe(0);
    expect(r.topInsumos).toEqual([]);
    expect(r.detalle).toEqual([]);
  });
  it('sin rango de fechas cuenta todo', () => {
    const r = agregarMovimientos({ ...base, from: null, to: null });
    expect(r.kpis.totalSalidas).toBe(41 + 99); // incluye el old
  });
});
