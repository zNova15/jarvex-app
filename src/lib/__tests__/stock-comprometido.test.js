import { describe, it, expect } from 'vitest';
import { repartirStock, coberturaDeLinea, claveInsumo, RESERVAN, EN_COLA, normNombre } from '../stock-comprometido.js';
import { normNombre as normNombreCatalogo } from '../insumos-catalogo.js';

// La copia local existe para no arrastrar Dexie a un motor puro (ver el
// encabezado del archivo). Este test es el que impide que las dos se separen.
describe('normNombre — la copia local no puede divergir de la canónica', () => {
  const casos = ['Cemento Sol', '  CEMENTO   SOL  ', 'Triplay 30x55', 'ÁNGULO Ø1/2"', 'Señalización', '', null, undefined, 'ñandú Ñ'];
  it('da exactamente lo mismo que la de insumos-catalogo.js', () => {
    for (const c of casos) expect(normNombre(c)).toBe(normNombreCatalogo(c));
  });
  it('normaliza acentos, mayúsculas y espacios de más', () => {
    expect(normNombre('  CEMENTO   SOL  ')).toBe('cemento sol');
    expect(normNombre('Señalización')).toBe('senalizacion');
  });
});

// ── Helpers de armado ──
const req = (id, estado, revisado_at, extra = {}) => ({ id, codigo: id.toUpperCase(), estado, revisado_at, ...extra });
const item = (requisicion_id, cantidad, extra = {}) => ({
  id: `${requisicion_id}_${cantidad}`, requisicion_id, tipo_insumo: 'material',
  insumo_id: 'CEM', nombre: 'Cemento Sol', cantidad, ...extra,
});

describe('claveInsumo', () => {
  it('con insumo real manda el id, no el nombre', () => {
    expect(claveInsumo({ tipo_insumo: 'material', insumo_id: 'CEM', nombre: 'Cemento Sol' }))
      .toBe(claveInsumo({ tipo_insumo: 'material', insumo_id: 'CEM', nombre: 'CEMENTO  SOL TIPO I' }));
  });

  it('sin insumo real, el nombre normalizado junta las variantes de escritura', () => {
    expect(claveInsumo({ tipo_insumo: 'material', nombre: 'Triplay 30x55' }))
      .toBe(claveInsumo({ tipo_insumo: 'material', nombre: '  TRIPLAY 30X55  ' }));
  });

  it('un EPP y un material que se llaman igual NO se mezclan', () => {
    expect(claveInsumo({ tipo_insumo: 'epp', nombre: 'Guantes' }))
      .not.toBe(claveInsumo({ tipo_insumo: 'material', nombre: 'Guantes' }));
  });

  it('una línea sin id y sin nombre no tiene clave (no contamina a nadie)', () => {
    expect(claveInsumo({ tipo_insumo: 'material', nombre: '   ' })).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════
// EL CASO DE GABRIEL (23-set-2026): stock 10, tres pedidos de 18, 6 y 28.
// ═══════════════════════════════════════════════════════════════════
describe('el caso de los tres requerimientos', () => {
  const stock = new Map([['material|CEM', 10]]);

  it('aprobadas en orden A(18) → B(6) → C(28): A se lleva las 10, hay que comprar 42', () => {
    const { porInsumo } = repartirStock({
      requisiciones: [
        req('a', 'aprobada', '2026-09-20T10:00:00Z'),
        req('b', 'aprobada', '2026-09-21T10:00:00Z'),
        req('c', 'aprobada', '2026-09-22T10:00:00Z'),
      ],
      requisicionItems: [item('a', 18), item('b', 6), item('c', 28)],
      stock,
    });
    const e = porInsumo.get('material|CEM');
    expect(e.hay).toBe(10);
    expect(e.comprometido).toBe(10);        // las 10 unidades tienen dueño
    expect(e.disponible).toBe(0);           // no queda nada libre
    expect(e.faltaComprar).toBe(42);        // 18+6+28 − 10
    // A cubre 10 de sus 18 y compra 8; B y C compran todo.
    expect(e.reservas).toEqual([
      { requisicion_id: 'a', codigo: 'A', cubierto: 10, comprar: 8 },
      { requisicion_id: 'b', codigo: 'B', cubierto: 0, comprar: 6 },
      { requisicion_id: 'c', codigo: 'C', cubierto: 0, comprar: 28 },
    ]);
  });

  it('el total a comprar NO depende del orden en que lleguen las solicitudes', () => {
    const items = [item('a', 18), item('b', 6), item('c', 28)];
    const reqs = [
      req('a', 'aprobada', '2026-09-20T10:00:00Z'),
      req('b', 'aprobada', '2026-09-21T10:00:00Z'),
      req('c', 'aprobada', '2026-09-22T10:00:00Z'),
    ];
    const normal = repartirStock({ requisiciones: reqs, requisicionItems: items, stock });
    const alReves = repartirStock({
      requisiciones: [...reqs].reverse(),
      requisicionItems: [...items].reverse(),
      stock,
    });
    expect(alReves.porInsumo.get('material|CEM').faltaComprar)
      .toBe(normal.porInsumo.get('material|CEM').faltaComprar);
    // Y el reparto individual también es el mismo: manda `revisado_at`.
    expect(alReves.porInsumo.get('material|CEM').reservas)
      .toEqual(normal.porInsumo.get('material|CEM').reservas);
  });

  it('si C se aprueba PRIMERO, C se lleva las 10 (FIFO por revisión, no por carga)', () => {
    const { porInsumo } = repartirStock({
      requisiciones: [
        req('a', 'aprobada', '2026-09-22T10:00:00Z'),
        req('b', 'aprobada', '2026-09-23T10:00:00Z'),
        req('c', 'aprobada', '2026-09-20T10:00:00Z'),   // revisada antes
      ],
      requisicionItems: [item('a', 18), item('b', 6), item('c', 28)],
      stock,
    });
    const e = porInsumo.get('material|CEM');
    expect(e.reservas[0]).toEqual({ requisicion_id: 'c', codigo: 'C', cubierto: 10, comprar: 18 });
    expect(e.faltaComprar).toBe(42);        // el total no cambia
  });
});

describe('quién reserva y quién no', () => {
  const stock = new Map([['material|CEM', 10]]);

  it('la PENDIENTE no reserva, pero sale en la cola con su cantidad', () => {
    const { porInsumo } = repartirStock({
      requisiciones: [req('p', 'pendiente', null)],
      requisicionItems: [item('p', 18)],
      stock,
    });
    const e = porInsumo.get('material|CEM');
    expect(e.comprometido).toBe(0);
    expect(e.disponible).toBe(10);          // sigue libre: todavía puede rechazarse
    expect(e.enCola).toBe(18);
    expect(e.cola).toEqual([{ requisicion_id: 'p', codigo: 'P', cantidad: 18 }]);
  });

  it('rechazada, cancelada y recibida sueltan el stock', () => {
    for (const estado of ['rechazada', 'cancelada', 'recibida']) {
      const { porInsumo } = repartirStock({
        requisiciones: [req('x', estado, '2026-09-20T10:00:00Z')],
        requisicionItems: [item('x', 18)],
        stock,
      });
      expect(porInsumo.get('material|CEM')).toBeUndefined();   // ni siquiera figura
    }
  });

  it('la ordenada sigue reservando: la OC cubre lo que se compra, no lo que sale del almacén', () => {
    const { porInsumo } = repartirStock({
      requisiciones: [req('o', 'ordenada', '2026-09-20T10:00:00Z')],
      requisicionItems: [item('o', 18)],
      stock,
    });
    expect(porInsumo.get('material|CEM').comprometido).toBe(10);
    expect(porInsumo.get('material|CEM').disponible).toBe(0);
  });

  it('una requisición borrada (deleted_at) no reserva nada', () => {
    const { porInsumo } = repartirStock({
      requisiciones: [req('d', 'aprobada', '2026-09-20T10:00:00Z', { deleted_at: '2026-09-21' })],
      requisicionItems: [item('d', 18)],
      stock,
    });
    expect(porInsumo.get('material|CEM')).toBeUndefined();
  });

  it('los estados que reservan y los que hacen cola no se pisan', () => {
    for (const e of RESERVAN) expect(EN_COLA.has(e)).toBe(false);
  });
});

describe('aceptación parcial', () => {
  it('la cantidad APROBADA manda sobre la pedida', () => {
    const { porInsumo } = repartirStock({
      requisiciones: [req('a', 'aprobada_parcial', '2026-09-20T10:00:00Z')],
      requisicionItems: [item('a', 100, { cantidad_aprobada: 60 })],
      stock: new Map([['material|CEM', 10]]),
    });
    const e = porInsumo.get('material|CEM');
    expect(e.comprometido).toBe(10);
    expect(e.faltaComprar).toBe(50);        // 60 aprobadas − 10 que hay
  });

  it('cantidad_aprobada = 0 no reserva (el revisor la bajó a cero)', () => {
    const { porInsumo } = repartirStock({
      requisiciones: [req('a', 'aprobada_parcial', '2026-09-20T10:00:00Z')],
      requisicionItems: [item('a', 100, { cantidad_aprobada: 0 })],
      stock: new Map([['material|CEM', 10]]),
    });
    expect(porInsumo.get('material|CEM')).toBeUndefined();
  });
});

describe('excluirReqId — la requisición que se está editando no se reserva a sí misma', () => {
  it('sin excluir, su propia línea se come el stock y se ve 0 disponible', () => {
    const base = {
      requisiciones: [req('a', 'aprobada', '2026-09-20T10:00:00Z')],
      requisicionItems: [item('a', 18)],
      stock: new Map([['material|CEM', 10]]),
    };
    expect(repartirStock(base).porInsumo.get('material|CEM').disponible).toBe(0);
    expect(repartirStock({ ...base, excluirReqId: 'a' }).porInsumo.get('material|CEM')).toBeUndefined();
  });
});

describe('coberturaDeLinea', () => {
  const reparto = repartirStock({
    requisiciones: [req('a', 'aprobada', '2026-09-20T10:00:00Z'), req('p', 'pendiente', null)],
    requisicionItems: [item('a', 4), item('p', 7)],
    stock: new Map([['material|CEM', 10]]),
  });

  it('lo tenemos: el pedido entra entero en lo disponible', () => {
    const c = coberturaDeLinea({ reparto, clave: 'material|CEM', cantidad: 6 });
    expect(c.disponible).toBe(6);           // 10 − 4 que ya reservó A
    expect(c.cobertura).toBe('completa');
    expect(c.comprar).toBe(0);
  });

  it('lo tenemos a medias: cubre parte y el resto se compra', () => {
    const c = coberturaDeLinea({ reparto, clave: 'material|CEM', cantidad: 15 });
    expect(c.cubre).toBe(6);
    expect(c.comprar).toBe(9);
    expect(c.cobertura).toBe('parcial');
  });

  it('avisa que hay pedidos en cola sin aprobar todavía', () => {
    const c = coberturaDeLinea({ reparto, clave: 'material|CEM', cantidad: 1 });
    expect(c.enCola).toBe(7);
    expect(c.avisoCola).toBe(true);
  });

  it('un insumo que nadie requirió usa su stock suelto y no avisa nada', () => {
    const c = coberturaDeLinea({ reparto, clave: 'material|ARENA', cantidad: 3, stockSuelto: 20 });
    expect(c.hay).toBe(20);
    expect(c.disponible).toBe(20);
    expect(c.cobertura).toBe('completa');
    expect(c.avisoCola).toBe(false);
  });

  it('sin stock no cubre nada', () => {
    const c = coberturaDeLinea({ reparto, clave: 'material|ARENA', cantidad: 3, stockSuelto: 0 });
    expect(c.cobertura).toBe('ninguna');
    expect(c.comprar).toBe(3);
  });

  it('una línea sin cantidad todavía no pide nada', () => {
    const c = coberturaDeLinea({ reparto, clave: 'material|CEM', cantidad: '' });
    expect(c.cobertura).toBe('ninguna');
    expect(c.comprar).toBe(0);
  });
});

describe('decimales', () => {
  it('no arrastra el error de coma flotante', () => {
    const { porInsumo } = repartirStock({
      requisiciones: [req('a', 'aprobada', '2026-09-20T10:00:00Z')],
      requisicionItems: [item('a', 0.3)],
      stock: new Map([['material|CEM', 0.1]]),
    });
    const e = porInsumo.get('material|CEM');
    expect(e.comprometido).toBe(0.1);
    expect(e.faltaComprar).toBe(0.2);       // no 0.19999999999999998
  });
});
