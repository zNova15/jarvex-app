import { describe, it, expect } from 'vitest';
import { extraerComprasDeFacturas, extraerLineasDeFacturas, agruparComprasPorInsumo, proveedorMasBarato, seriePrecios } from '../analisis-insumos';
import { resolverPares, construirGrupos } from '../insumo-correlacion';

const MOVS = [
  {
    id: 'm1', date: '2026-07-10', currency: 'PEN', proveedor_id: 'p1', third_party_name: 'FERRETERIA A',
    document_number: 'F001-100',
    notas: JSON.stringify({ items_factura: [
      { descripcion: 'Clavo 8 pulg', unidad: 'kg', cantidad: 10, precio_unitario: 6.5 },
      { descripcion: 'Arena gruesa', unidad: 'm3', cantidad: 2, precio_unitario: 55 },
      { descripcion: 'Ítem sin precio', unidad: 'und', cantidad: 1, precio_unitario: 0 },
    ] }),
  },
  {
    id: 'm2', date: '2026-08-20', currency: 'PEN', proveedor_id: 'p2', third_party_name: 'FERRETERIA B',
    document_number: 'F002-200',
    notas: { items_factura: [{ descripcion: "Clavos de 8''", unidad: 'kg', cantidad: 5, precio_unitario: 5.9 }] },
  },
  { id: 'm3', date: '2026-08-21', currency: 'PEN', demo: true, notas: { items_factura: [{ descripcion: 'Clavo 8 pulg', cantidad: 1, precio_unitario: 9 }] } },
  { id: 'm4', date: '2026-08-22', currency: 'PEN', notas: 'json roto {{{' },
  // VENTA y NOTA DE CRÉDITO: llevan items_factura pero NO son compras.
  { id: 'm5', date: '2026-08-23', currency: 'PEN', type: 'income', third_party_name: 'CLIENTE X', notas: { items_factura: [{ descripcion: 'Clavo 8 pulg', cantidad: 1, precio_unitario: 99 }] } },
  { id: 'm6', date: '2026-08-24', currency: 'PEN', document_type: 'nota_credito', notas: { items_factura: [{ descripcion: 'Clavo 8 pulg', cantidad: 1, precio_unitario: 6.5 }] } },
];

describe('extraerComprasDeFacturas', () => {
  it('extrae líneas con precio, parsea notas string u objeto, salta demo/ventas/NC y JSON roto', () => {
    const compras = extraerComprasDeFacturas(MOVS);
    expect(compras.length).toBe(3);   // 2 de m1 (sin el precio 0) + 1 de m2
    expect(compras[0]).toMatchObject({ nombre: 'Clavo 8 pulg', proveedorId: 'p1', moneda: 'PEN', doc: 'F001-100' });
  });

  it('en modo prueba (opts.demo) entrega SOLO las filas demo — el panel funciona para entrenar', () => {
    const compras = extraerComprasDeFacturas(MOVS, { demo: true });
    expect(compras.length).toBe(1);
    expect(compras[0].movId).toBe('m3');
  });
});

describe('extraerLineasDeFacturas (base del inventario por empresa)', () => {
  it('devuelve TODAS las líneas —ventas, NC y sin precio incluidas— marcadas', () => {
    const lineas = extraerLineasDeFacturas(MOVS);
    expect(lineas.length).toBe(6);   // 3 de m1 (con la de precio 0) + m2 + venta + NC
    const venta = lineas.find(l => l.movId === 'm5');
    expect(venta).toMatchObject({ clase: 'venta', esNota: false });
    expect(lineas.find(l => l.movId === 'm6')).toMatchObject({ clase: 'compra', esNota: true });
    expect(lineas.filter(l => l.precio === 0)).toHaveLength(1);
  });

  it('la clase sale de `clase` y cae a `type` solo si falta (filas viejas)', () => {
    const movs = [
      { id: 'a', clase: 'venta', type: 'cost', notas: { items_factura: [{ descripcion: 'X', cantidad: 1, precio_unitario: 1 }] } },
      { id: 'b', type: 'cost', notas: { items_factura: [{ descripcion: 'Y', cantidad: 1, precio_unitario: 1 }] } },
    ];
    const lineas = extraerLineasDeFacturas(movs);
    expect(lineas.map(l => l.clase)).toEqual(['venta', 'compra']);
    // …y por eso esa venta mal tipada NO contamina el comparador de precios.
    expect(extraerComprasDeFacturas(movs).map(l => l.nombre)).toEqual(['Y']);
  });
});

describe('agruparComprasPorInsumo + proveedorMasBarato', () => {
  const compras = extraerComprasDeFacturas(MOVS);
  const resueltos = resolverPares([
    { relacion: 'mismo', nombre_a: 'Clavo 8 pulg', nombre_b: "Clavos de 8''", fuente: 'manual', updated_at: '1', canonico: 'Clavo de 8"' },
  ]);
  const { grupoDe, grupos } = construirGrupos(resueltos);

  it('las dos variantes confirmadas caen en el MISMO grupo, cada proveedor con sus números', () => {
    const porInsumo = agruparComprasPorInsumo(compras, grupoDe, grupos);
    const clavos = [...porInsumo.values()].find(i => i.display === 'Clavo de 8"');
    expect(clavos).toBeDefined();
    expect(clavos.variantes).toEqual(['Clavo 8 pulg', "Clavos de 8''"]);
    expect(clavos.porProveedor.size).toBe(2);
    const b = clavos.porProveedor.get('p2');
    expect(b.ultimoPrecio).toBe(5.9);
    const masBarato = proveedorMasBarato(clavos);
    expect(masBarato.proveedorNombre).toBe('FERRETERIA B');
  });

  it('sin correlación confirmada, cada nombre es su propio insumo', () => {
    const porInsumo = agruparComprasPorInsumo(compras, new Map(), new Map());
    expect([...porInsumo.keys()]).toContain('clavo 8 pulg');
    expect([...porInsumo.keys()]).toContain('clavos de 8');
  });

  it('no declara "más barato" si las monedas o unidades difieren', () => {
    const mezcla = agruparComprasPorInsumo(extraerComprasDeFacturas([
      MOVS[0],
      { ...MOVS[1], currency: 'USD' },
    ]), grupoDe, grupos);
    const clavos = [...mezcla.values()].find(i => i.display === 'Clavo de 8"');
    expect(proveedorMasBarato(clavos)).toBe(null);
  });

  it('seriePrecios sale cronológica', () => {
    const porInsumo = agruparComprasPorInsumo(compras, grupoDe, grupos);
    const clavos = [...porInsumo.values()].find(i => i.display === 'Clavo de 8"');
    const serie = seriePrecios(clavos);
    expect(serie.map(s => s.fecha)).toEqual(['2026-07-10', '2026-08-20']);
  });
});
