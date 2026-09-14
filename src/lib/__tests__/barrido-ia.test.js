import { describe, it, expect, vi } from 'vitest';
import { ejecutarBarridoIA } from '../barrido-ia.js';

describe('ejecutarBarridoIA', () => {
  it('procesa todos los ítems y cuenta aplicadas/saltadas', async () => {
    const items = ['a', 'b', 'c'];
    const procesarItem = vi.fn(async (x) => (x === 'b' ? 'saltada' : 'aplicada'));
    const estado = await ejecutarBarridoIA({ items, procesarItem, pausaMs: 0 });
    expect(estado).toMatchObject({ total: 3, i: 3, aplicadas: 2, saltadas: 1, errores: 0, cancelado: false });
    expect(procesarItem).toHaveBeenCalledTimes(3);
  });

  it('un ítem que lanza cuenta como error y NO frena el recorrido', async () => {
    const items = [1, 2, 3];
    const procesarItem = vi.fn(async (x) => { if (x === 2) throw new Error('boom'); return 'aplicada'; });
    const estado = await ejecutarBarridoIA({ items, procesarItem, pausaMs: 0 });
    expect(estado).toMatchObject({ total: 3, aplicadas: 2, saltadas: 0, errores: 1 });
    expect(procesarItem).toHaveBeenCalledTimes(3); // los tres se intentaron
  });

  it('respeta debeCancelar: para ANTES del siguiente ítem, sin deshacer lo ya aplicado', async () => {
    const items = [1, 2, 3, 4, 5];
    let cancelarDesde = 2;
    const procesarItem = vi.fn(async () => 'aplicada');
    const estado = await ejecutarBarridoIA({
      items, procesarItem, pausaMs: 0,
      debeCancelar: () => procesarItem.mock.calls.length >= cancelarDesde,
    });
    expect(estado.cancelado).toBe(true);
    expect(procesarItem).toHaveBeenCalledTimes(2);
    expect(estado.aplicadas).toBe(2);
  });

  it('llama a onProgreso después de cada ítem con el acumulado hasta ahí', async () => {
    const items = ['x', 'y'];
    const progresos = [];
    await ejecutarBarridoIA({
      items, pausaMs: 0,
      procesarItem: async () => 'aplicada',
      onProgreso: (p) => progresos.push({ ...p }),
    });
    expect(progresos).toHaveLength(2);
    expect(progresos[0]).toMatchObject({ i: 1, aplicadas: 1 });
    expect(progresos[1]).toMatchObject({ i: 2, aplicadas: 2 });
  });

  it('lista vacía: no llama a procesarItem y devuelve un estado en cero', async () => {
    const procesarItem = vi.fn();
    const estado = await ejecutarBarridoIA({ items: [], procesarItem, pausaMs: 0 });
    expect(procesarItem).not.toHaveBeenCalled();
    expect(estado).toMatchObject({ total: 0, i: 0, aplicadas: 0, saltadas: 0, errores: 0 });
  });

  it('espera `pausaMs` entre ítems pero no después del último (no demora de más)', async () => {
    vi.useFakeTimers();
    try {
      const items = [1, 2];
      const promesa = ejecutarBarridoIA({ items, procesarItem: async () => 'aplicada', pausaMs: 1000 });
      await vi.advanceTimersByTimeAsync(0);
      // primer ítem ya procesado, esperando la pausa antes del segundo
      await vi.advanceTimersByTimeAsync(1000);
      const estado = await promesa;
      expect(estado.total).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
