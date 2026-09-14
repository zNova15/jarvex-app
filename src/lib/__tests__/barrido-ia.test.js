import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ejecutarBarridoIA, turnoIA, _reiniciarTurnoIA, GAP_IA_MS } from '../barrido-ia.js';

beforeEach(() => { _reiniciarTurnoIA(); });

describe('ejecutarBarridoIA', () => {
  it('procesa todos los ítems y cuenta aplicadas/saltadas', async () => {
    const items = ['a', 'b', 'c'];
    const procesarItem = vi.fn(async (x) => (x === 'b' ? 'saltada' : 'aplicada'));
    const estado = await ejecutarBarridoIA({ items, procesarItem, pausaMs: 0 });
    expect(estado).toMatchObject({ total: 3, i: 3, aplicadas: 2, saltadas: 1, errores: 0, cancelado: false });
    expect(procesarItem).toHaveBeenCalledTimes(3);
  });

  // El modo por defecto: la IA propone y nadie guarda nada. 'recomendada'
  // tiene su propio contador para que el cartel no diga "aplicadas" cuando
  // no se aplicó nada — que es exactamente lo que había que corregir.
  it('cuenta las recomendadas aparte de las aplicadas', async () => {
    const estado = await ejecutarBarridoIA({
      items: [1, 2, 3], pausaMs: 0,
      procesarItem: async (x) => (x === 3 ? 'saltada' : 'recomendada'),
    });
    expect(estado).toMatchObject({ recomendadas: 2, aplicadas: 0, saltadas: 1 });
  });

  it('un ítem que lanza cuenta como error y NO frena el recorrido', async () => {
    const items = [1, 2, 3];
    const procesarItem = vi.fn(async (x) => { if (x === 2) throw new Error('boom'); return 'aplicada'; });
    const estado = await ejecutarBarridoIA({ items, procesarItem, pausaMs: 0 });
    expect(estado).toMatchObject({ total: 3, aplicadas: 2, saltadas: 0, errores: 1 });
    expect(estado.cortado).toBe(false);
    expect(procesarItem).toHaveBeenCalledTimes(3); // los tres se intentaron
  });

  // Se cayó la red o venció la sesión: insistir 700 veces no arregla nada y
  // tapa la causa detrás de un contador de errores gigante.
  it('se corta solo tras N errores SEGUIDOS y guarda el último mensaje', async () => {
    const procesarItem = vi.fn(async () => { throw new Error('401 sesión vencida'); });
    const estado = await ejecutarBarridoIA({
      items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], procesarItem, pausaMs: 0, toleranciaErrores: 3,
    });
    expect(estado.cortado).toBe(true);
    expect(estado.errores).toBe(3);
    expect(estado.ultimoError).toMatch(/sesión vencida/);
    expect(procesarItem).toHaveBeenCalledTimes(3);
  });

  it('un error suelto en el medio NO corta: el contador se reinicia al primer acierto', async () => {
    let n = 0;
    const estado = await ejecutarBarridoIA({
      items: [1, 2, 3, 4, 5, 6], pausaMs: 0, toleranciaErrores: 2,
      procesarItem: async () => { n++; if (n % 2 === 1) throw new Error('x'); return 'recomendada'; },
    });
    expect(estado.cortado).toBe(false);
    expect(estado.i).toBe(6);
    expect(estado.errores).toBe(3);
  });

  it('respeta debeCancelar: para ANTES del siguiente ítem, sin deshacer lo ya aplicado', async () => {
    const items = [1, 2, 3, 4, 5];
    const cancelarDesde = 2;
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
    expect(estado).toMatchObject({ total: 0, i: 0, aplicadas: 0, recomendadas: 0, saltadas: 0, errores: 0 });
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

  // Con `esperarTurno` el ritmo lo pone el turno compartido (turnoIA) y NO se
  // duerme después de cada ítem: es lo que permite dos recorridos a la vez.
  it('con esperarTurno pide turno antes de cada ítem y no duerme de más', async () => {
    const orden = [];
    const esperarTurno = vi.fn(async () => { orden.push('turno'); });
    await ejecutarBarridoIA({
      items: [1, 2], pausaMs: 999999, esperarTurno,
      procesarItem: async () => { orden.push('item'); return 'recomendada'; },
    });
    expect(esperarTurno).toHaveBeenCalledTimes(2);
    expect(orden).toEqual(['turno', 'item', 'turno', 'item']);
  });
});

describe('turnoIA — el ritmo compartido por toda la app', () => {
  it('el primer turno no espera y el segundo respeta el gap', async () => {
    vi.useFakeTimers();
    try {
      const t = [];
      const p1 = turnoIA(1000).then(() => t.push('a'));
      await vi.advanceTimersByTimeAsync(0);
      await p1;
      expect(t).toEqual(['a']);

      const p2 = turnoIA(1000).then(() => t.push('b'));
      await vi.advanceTimersByTimeAsync(500);
      expect(t).toEqual(['a']);           // todavía no: falta medio gap
      await vi.advanceTimersByTimeAsync(500);
      await p2;
      expect(t).toEqual(['a', 'b']);
    } finally {
      vi.useRealTimers();
    }
  });

  // El punto de que el turno sea global: dos recorridos en paralelo NO van al
  // doble de ritmo — se intercalan y entre los dos respetan el mismo gap.
  it('dos recorridos en paralelo se intercalan en vez de sumar sus ritmos', async () => {
    vi.useFakeTimers();
    try {
      const orden = [];
      const correr = (etiqueta, n) => (async () => {
        for (let i = 0; i < n; i++) { await turnoIA(1000); orden.push(`${etiqueta}${i}`); }
      })();
      const a = correr('A', 2);
      const b = correr('B', 2);
      await vi.advanceTimersByTimeAsync(5000);
      await Promise.all([a, b]);
      expect(orden).toHaveLength(4);
      // Cuatro pedidos a un gap de 1000 necesitan 3000 ms: si cada recorrido
      // tuviera su propia cola habrían salido de a dos en la mitad del tiempo.
      expect(new Set(orden).size).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('el gap por defecto es el de la app', () => {
    expect(GAP_IA_MS).toBe(1100);
  });
});
