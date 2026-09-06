import { describe, it, expect } from 'vitest';
import {
  movimientosConParRegistrado,
  puedeEditarMovimiento,
  puedeEliminarMovimiento,
  avisoDeEspejo,
} from '../interco-edicion.js';

// Datos con la forma de producción: la venta interna y su espejo AUTO.
const venta = { id: 'v1', company_id: 'gasomi', type: 'income', is_intercompany: true, amount: 45000 };
const espejo = { id: 'c1', company_id: 'jheenseg', type: 'cost', is_intercompany: true, amount: 45000, related_movement_id: 'v1' };

describe('movimientosConParRegistrado', () => {
  it('junta las dos patas de cada transacción', () => {
    const ids = movimientosConParRegistrado([
      { id: 't1', seller_movement_id: 'v1', buyer_movement_id: 'c1' },
    ]);
    expect([...ids].sort()).toEqual(['c1', 'v1']);
  });

  it('ignora las transacciones borradas', () => {
    const ids = movimientosConParRegistrado([
      { id: 't1', seller_movement_id: 'v1', buyer_movement_id: 'c1', deleted_at: '2026-01-01' },
    ]);
    expect(ids.size).toBe(0);
  });

  it('tolera patas nulas: una transacción a medio armar no rompe', () => {
    const ids = movimientosConParRegistrado([{ id: 't1', seller_movement_id: 'v1', buyer_movement_id: null }]);
    expect([...ids]).toEqual(['v1']);
  });

  it('sin transacciones devuelve un Set vacío, no null', () => {
    expect(movimientosConParRegistrado(undefined).size).toBe(0);
    expect(movimientosConParRegistrado([]).size).toBe(0);
  });
});

describe('puedeEditarMovimiento — el caso REAL de producción', () => {
  // El escenario del 6-sep: 171 movimientos marcados is_intercompany y
  // intercompany_transactions en CERO filas.
  const sinPares = movimientosConParRegistrado([]);

  it('un movimiento marcado is_intercompany SIN par registrado SÍ se edita', () => {
    // Esto es lo que destraba los 171 (76 ventas por S/ 2.188.404,52).
    expect(puedeEditarMovimiento(venta, sinPares)).toEqual({ puede: true, motivo: null });
    expect(puedeEditarMovimiento(espejo, sinPares).puede).toBe(true);
  });

  it('el flag is_intercompany por sí solo NO bloquea nada', () => {
    // Es un atributo contable que pone Captura Mágica, no la prueba de un par.
    const soloFlag = { id: 'x', is_intercompany: true };
    expect(puedeEditarMovimiento(soloFlag, sinPares).puede).toBe(true);
  });

  it('con par registrado SÍ se bloquea, y dice por qué', () => {
    const conPar = movimientosConParRegistrado([{ seller_movement_id: 'v1', buyer_movement_id: 'c1' }]);
    const r = puedeEditarMovimiento(venta, conPar);
    expect(r.puede).toBe(false);
    expect(r.motivo).toMatch(/dos lados se muevan juntos/);
    expect(puedeEditarMovimiento(espejo, conPar).puede).toBe(false);
  });

  it('un movimiento que NO es pata del par se edita aunque existan pares de otros', () => {
    const conPar = movimientosConParRegistrado([{ seller_movement_id: 'otro1', buyer_movement_id: 'otro2' }]);
    expect(puedeEditarMovimiento(venta, conPar).puede).toBe(true);
  });

  it('un movimiento borrado no se edita', () => {
    expect(puedeEditarMovimiento({ ...venta, deleted_at: 'x' }, sinPares).puede).toBe(false);
  });

  it('sin movimiento no explota', () => {
    expect(puedeEditarMovimiento(null, sinPares).puede).toBe(false);
  });

  it('si no le pasan el Set, falla CERRADO hacia el permiso (no bloquea de más)', () => {
    // Un Set ausente significa "no sé de pares", y con la tabla en 0 lo correcto
    // es dejar editar. Lo que NO puede pasar es que un undefined tire excepción.
    expect(() => puedeEditarMovimiento(venta, undefined)).not.toThrow();
    expect(puedeEditarMovimiento(venta, undefined).puede).toBe(true);
  });
});

describe('puedeEliminarMovimiento', () => {
  const conPar = movimientosConParRegistrado([{ seller_movement_id: 'v1', buyer_movement_id: 'c1' }]);

  it('el espejo AUTO se borra siempre — es un reflejo, no un comprobante emitido', () => {
    // Comportamiento que ya existía y se conserva tal cual.
    expect(puedeEliminarMovimiento(espejo, conPar, { esEspejoAuto: true }).puede).toBe(true);
  });

  it('sin par registrado se borra', () => {
    expect(puedeEliminarMovimiento(venta, movimientosConParRegistrado([]), {}).puede).toBe(true);
  });

  it('con par registrado y sin ser espejo auto, no se borra', () => {
    expect(puedeEliminarMovimiento(venta, conPar, { esEspejoAuto: false }).puede).toBe(false);
  });
});

describe('avisoDeEspejo — informa, no bloquea', () => {
  const movsById = new Map([['v1', venta], ['c1', espejo]]);
  const nombre = (id) => ({ gasomi: 'GASOMI INGENIEROS', jheenseg: 'JHEENSEG INGENIEROS' }[id] || null);

  it('avisa con el nombre de la empresa del otro lado', () => {
    const a = avisoDeEspejo(espejo, movsById, nombre);
    expect(a).toMatch(/GASOMI INGENIEROS/);
    expect(a).toMatch(/NO se copia/);
  });

  it('sin espejo no avisa', () => {
    expect(avisoDeEspejo(venta, movsById, nombre)).toBeNull();
  });

  it('si el espejo está borrado, no avisa', () => {
    const conBorrado = new Map([['v1', { ...venta, deleted_at: 'x' }]]);
    expect(avisoDeEspejo(espejo, conBorrado, nombre)).toBeNull();
  });

  it('si la empresa no se resuelve, avisa igual con un genérico', () => {
    expect(avisoDeEspejo(espejo, movsById, () => null)).toMatch(/la otra empresa/);
  });

  it('sin Map no explota', () => {
    expect(avisoDeEspejo(espejo, null, nombre)).toBeNull();
  });
});
