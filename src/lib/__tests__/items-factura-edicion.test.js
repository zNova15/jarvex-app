import { describe, it, expect } from 'vitest';
import {
  itemsFacturaDe, valorLinea, tieneRecepcionLigada,
  editarLinea, agregarLinea, vaciarLinea, totalDeLineas,
} from '../items-factura-edicion.js';

describe('itemsFacturaDe', () => {
  it('lee items_factura de un objeto notas ya parseado', () => {
    const items = itemsFacturaDe({ items_factura: [{ descripcion: 'X' }] });
    expect(items).toEqual([{ descripcion: 'X' }]);
  });

  it('lee items_factura de una notas string (columna text con JSON adentro)', () => {
    const items = itemsFacturaDe(JSON.stringify({ items_factura: [{ descripcion: 'Y' }] }));
    expect(items).toEqual([{ descripcion: 'Y' }]);
  });

  it('sin items_factura, o notas rota, devuelve [] y no rompe', () => {
    expect(itemsFacturaDe({})).toEqual([]);
    expect(itemsFacturaDe(null)).toEqual([]);
    expect(itemsFacturaDe('')).toEqual([]);
    expect(itemsFacturaDe('esto no es JSON')).toEqual([]);
    expect(itemsFacturaDe({ items_factura: 'no es array' })).toEqual([]);
  });
});

describe('valorLinea — cantidad × precio_unitario, la base sin IGV', () => {
  it('multiplica cantidad por precio', () => {
    expect(valorLinea({ cantidad: 3, precio_unitario: 10.5 })).toBe(31.5);
  });
  it('sin cantidad o precio válidos, vale 0', () => {
    expect(valorLinea({})).toBe(0);
    expect(valorLinea({ cantidad: 'x', precio_unitario: 10 })).toBe(0);
  });
});

describe('tieneRecepcionLigada — el aviso antes de vaciar', () => {
  it('true si ya recibió mercadería', () => {
    expect(tieneRecepcionLigada({ recibido: 5 })).toBe(true);
  });
  it('true si tiene un movimiento de almacén vinculado', () => {
    expect(tieneRecepcionLigada({ mov_vinculado_id: 'abc' })).toBe(true);
  });
  it('false para una línea nueva, sin nada enganchado', () => {
    expect(tieneRecepcionLigada({ recibido: 0 })).toBe(false);
    expect(tieneRecepcionLigada({})).toBe(false);
  });
});

describe('editarLinea — el corazón de la regla: NUNCA mueve índices', () => {
  const base = [
    { descripcion: 'Cemento', cantidad: 10, precio_unitario: 20, material_id: 'mat-1', recibido: 5, tipo_insumo: 'material' },
    { descripcion: 'Fierro', cantidad: 4, precio_unitario: 30, material_id: 'mat-2' },
  ];

  it('cambia solo los campos pedidos, en el MISMO índice', () => {
    const out = editarLinea(base, 0, { cantidad: 12 });
    expect(out[0].cantidad).toBe(12);
    expect(out[1]).toEqual(base[1]);        // la otra línea, intacta
  });

  it('preserva material_id, recibido, tipo_insumo — lo que el editor no toca', () => {
    const out = editarLinea(base, 0, { descripcion: 'Cemento Sol Tipo I', precio_unitario: 22.5 });
    expect(out[0].material_id).toBe('mat-1');
    expect(out[0].recibido).toBe(5);
    expect(out[0].tipo_insumo).toBe('material');
    expect(out[0].descripcion).toBe('Cemento Sol Tipo I');
    expect(out[0].precio_unitario).toBe(22.5);
  });

  it('NO muta el array original (inmutable)', () => {
    const copia = JSON.parse(JSON.stringify(base));
    editarLinea(base, 0, { cantidad: 999 });
    expect(base).toEqual(copia);
  });

  it('índice fuera de rango no hace nada', () => {
    expect(editarLinea(base, 5, { cantidad: 1 })).toEqual(base);
    expect(editarLinea(base, -1, { cantidad: 1 })).toEqual(base);
  });

  it('sin items no rompe', () => {
    expect(editarLinea(null, 0, { cantidad: 1 })).toEqual([]);
  });

  it('unidad vacía cae a "und", no queda vacía', () => {
    const out = editarLinea(base, 1, { unidad: '' });
    expect(out[1].unidad).toBe('und');
  });
});

describe('agregarLinea — SIEMPRE al final', () => {
  it('agrega una línea nueva sin material_id (no finge un vínculo que no existe)', () => {
    const base = [{ descripcion: 'Cemento', cantidad: 10, precio_unitario: 20 }];
    const out = agregarLinea(base, { descripcion: 'ANTICIPO DE CLIENTE', cantidad: 1, precio_unitario: 150000 });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(base[0]);        // la existente, en su lugar
    expect(out[1].descripcion).toBe('ANTICIPO DE CLIENTE');
    expect(out[1].material_id).toBeNull();
    expect(out[1].manual).toBe(true);
  });

  it('con valores por defecto si no se pasa nada', () => {
    const out = agregarLinea([], {});
    expect(out[0]).toMatchObject({ descripcion: '', unidad: 'und', cantidad: 1, precio_unitario: 0 });
  });

  it('no muta el array original', () => {
    const base = [{ descripcion: 'X' }];
    agregarLinea(base, { descripcion: 'Y' });
    expect(base).toHaveLength(1);
  });
});

describe('vaciarLinea — "quitar" sin correr los índices de las demás', () => {
  it('pone cantidad y precio en 0, conserva el resto', () => {
    const base = [{ descripcion: 'Cemento', cantidad: 10, precio_unitario: 20, material_id: 'mat-1' }];
    const out = vaciarLinea(base, 0);
    expect(out[0].cantidad).toBe(0);
    expect(out[0].precio_unitario).toBe(0);
    expect(out[0].material_id).toBe('mat-1');   // sigue ahí — el índice no se movió
    expect(out).toHaveLength(1);                // NO se saca del array
  });
});

describe('totalDeLineas', () => {
  it('suma el valor de todas las líneas', () => {
    const items = [
      { cantidad: 2, precio_unitario: 10 },
      { cantidad: 3, precio_unitario: 5 },
    ];
    expect(totalDeLineas(items)).toBe(35);
  });
  it('sin items, 0', () => {
    expect(totalDeLineas(null)).toBe(0);
    expect(totalDeLineas([])).toBe(0);
  });
});

describe('el caso real: KOPLAST — arreglar un anticipo mal guardado', () => {
  it('agregar la línea de anticipo que faltaba en una factura en cero', () => {
    // La factura llegó con un solo ítem de mercadería y el anticipo de
    // US$ 10.000 nunca se guardó como línea — exactamente el caso que Gabriel
    // reportó el 22-set.
    const items = [{ descripcion: 'PLANCHA METALICA 1/16"', cantidad: 1, precio_unitario: 0 }];
    const conAnticipo = agregarLinea(items, { descripcion: 'ANTICIPO DE CLIENTE', cantidad: 1, precio_unitario: 10000 });
    expect(conAnticipo).toHaveLength(2);
    expect(valorLinea(conAnticipo[1])).toBe(10000);
    // La línea original, intacta — el índice 0 sigue siendo la plancha.
    expect(conAnticipo[0]).toEqual(items[0]);
  });
});
