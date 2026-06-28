import { describe, it, expect, beforeEach, vi } from 'vitest';
import { editarCantidadMovimiento } from '../eliminar-movimiento.js';

// Fake mínimo de Dexie: get/update por tabla, registrando los patches.
function makeDb({ mov, material }) {
  const patches = { movimientos_materiales: [], materiales: [] };
  const db = {
    movimientos_materiales: {
      get: vi.fn(async () => mov),
      update: vi.fn(async (id, p) => { patches.movimientos_materiales.push(p); Object.assign(mov, p); }),
    },
    materiales: {
      get: vi.fn(async () => material),
      update: vi.fn(async (id, p) => { patches.materiales.push(p); Object.assign(material, p); }),
    },
  };
  return { db, patches };
}

describe('editarCantidadMovimiento — ajusta el stock con el signo correcto', () => {
  beforeEach(() => {
    globalThis.window = { __logAudit: async () => {}, dispatchEvent: () => {} };
  });

  it('salida 3→5 (consume 2 más) baja el stock en 2', async () => {
    const mov = { id: 'mv1', material_id: 'm1', tipo_movimiento: 'salida', cantidad: 3, version: 1 };
    const material = { id: 'm1', stock_actual: 10, stock_minimo: 2, version: 1 };
    const { db, patches } = makeDb({ mov, material });
    window.__db = db;
    const r = await editarCantidadMovimiento({ tabla: 'movimientos_materiales', movId: 'mv1', nuevaCantidad: 5, userId: 'u1' });
    expect(patches.materiales[0].stock_actual).toBe(8);     // 10 - (5-3)
    expect(patches.movimientos_materiales[0].cantidad).toBe(5);
    expect(r.newData.cantidad).toBe(5);
  });

  it('entrada 10→4 (entró 6 menos) baja el stock en 6', async () => {
    const mov = { id: 'mv2', material_id: 'm1', tipo_movimiento: 'entrada', cantidad: 10, version: 1 };
    const material = { id: 'm1', stock_actual: 10, stock_minimo: 2, version: 1 };
    const { db, patches } = makeDb({ mov, material });
    window.__db = db;
    await editarCantidadMovimiento({ tabla: 'movimientos_materiales', movId: 'mv2', nuevaCantidad: 4, userId: 'u1' });
    expect(patches.materiales[0].stock_actual).toBe(4);     // 10 - (10-4)
  });

  it('bloquea si dejaría stock negativo (STOCK_NEGATIVO)', async () => {
    const mov = { id: 'mv3', material_id: 'm1', tipo_movimiento: 'salida', cantidad: 3, version: 1 };
    const material = { id: 'm1', stock_actual: 1, stock_minimo: 2, version: 1 };
    const { db } = makeDb({ mov, material });
    window.__db = db;
    // salida 3→10 consumiría 7 más; stock 1 - 7 = -6 → bloquea.
    await expect(editarCantidadMovimiento({ tabla: 'movimientos_materiales', movId: 'mv3', nuevaCantidad: 10 }))
      .rejects.toMatchObject({ code: 'STOCK_NEGATIVO' });
  });

  it('cantidad igual = no-op (no toca stock)', async () => {
    const mov = { id: 'mv4', material_id: 'm1', tipo_movimiento: 'salida', cantidad: 3, version: 1 };
    const material = { id: 'm1', stock_actual: 10, version: 1 };
    const { db, patches } = makeDb({ mov, material });
    window.__db = db;
    await editarCantidadMovimiento({ tabla: 'movimientos_materiales', movId: 'mv4', nuevaCantidad: 3 });
    expect(patches.materiales.length).toBe(0);
    expect(patches.movimientos_materiales.length).toBe(0);
  });
});
