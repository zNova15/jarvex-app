import { describe, it, expect } from 'vitest';
import {
  itemsDeFactura, estadoRecepcionDeItems, resumenRecepcion,
  itemSinCostos, referenciaSinCostos, puntuarCruce,
  rankearIngresosParaItem, rankearFacturasParaIngreso, reporteRecepcion,
} from '../cruce-recepcion.js';

// Ayuda: un movimiento contable "compra" con items_factura en notas (JSON).
const factura = (items, extra = {}) => ({
  id: extra.id || 'f1', clase: 'compra', type: 'cost',
  document_type: 'factura', document_number: 'F001-123',
  third_party_name: 'FERRETERIA HUAMAN EIRL', proveedor_id: 'prov1',
  obra_id: 'obraA', date: '2026-07-10',
  notas: JSON.stringify({ subtotal: 1000, igv: 180, items_factura: items }),
  ...extra,
});

describe('cruce-recepcion — items y estado', () => {
  it('itemsDeFactura parsea notas JSON y tolera basura', () => {
    expect(itemsDeFactura(factura([{ descripcion: 'x' }]))).toHaveLength(1);
    expect(itemsDeFactura({ notas: 'no-json' })).toEqual([]);
    expect(itemsDeFactura({})).toEqual([]);
  });

  it('estadoRecepcionDeItems: pendiente / parcial / recibido / no_recepcionado', () => {
    expect(estadoRecepcionDeItems([{ cantidad: 10, recibido: 0 }])).toBe('pendiente_recepcion');
    expect(estadoRecepcionDeItems([{ cantidad: 10, recibido: 4 }])).toBe('parcial');
    expect(estadoRecepcionDeItems([{ cantidad: 10, recibido: 10 }])).toBe('recibido');
    expect(estadoRecepcionDeItems([{ cantidad: 10, recibido: 0, rechazado: true }])).toBe('no_recepcionado');
    // servicio / destino empresa cuentan como resueltos sin recibir stock
    expect(estadoRecepcionDeItems([{ cantidad: 10, tipo_insumo: 'servicio' }])).toBe('recibido');
    expect(estadoRecepcionDeItems([{ cantidad: 10, destino: 'empresa' }])).toBe('recibido');
  });
});

describe('cruce-recepcion — semáforo (resumenRecepcion)', () => {
  it('una VENTA no aplica al almacén', () => {
    const r = resumenRecepcion({ clase: 'venta', type: 'income', notas: '{}' });
    expect(r.estado).toBe('no_aplica');
    expect(r.aplica).toBe(false);
  });
  it('recepcion_status="no_aplica" no aplica', () => {
    expect(resumenRecepcion({ recepcion_status: 'no_aplica', notas: '{}' }).estado).toBe('no_aplica');
  });
  it('todos los ítems de empresa/obra_general → consumo_empresa', () => {
    const r = resumenRecepcion(factura([{ cantidad: 5, destino: 'empresa' }, { cantidad: 2, destino: 'obra_general' }]));
    expect(r.estado).toBe('consumo_empresa');
    expect(r.emoji).toBe('🏢');
  });
  it('recibido / parcial / sin_confirmar / no_recibido con emoji y tono', () => {
    expect(resumenRecepcion(factura([{ cantidad: 10, recibido: 10, destino: 'obra' }])).estado).toBe('recibido');
    const parcial = resumenRecepcion(factura([{ cantidad: 10, recibido: 3, destino: 'obra' }, { cantidad: 5, recibido: 0, destino: 'obra' }]));
    expect(parcial.estado).toBe('parcial');
    expect(parcial.total).toBe(2);
    expect(parcial.recibidos).toBe(0); // ninguno completo aún
    expect(resumenRecepcion(factura([{ cantidad: 10, recibido: 0, destino: 'obra' }])).estado).toBe('sin_confirmar');
    expect(resumenRecepcion(factura([{ cantidad: 10, recibido: 0, destino: 'obra', rechazado: true }])).estado).toBe('no_recibido');
  });
  it('recepcion_status del server manda sobre la derivación', () => {
    const mov = factura([{ cantidad: 10, recibido: 0, destino: 'obra' }], { recepcion_status: 'recibido' });
    expect(resumenRecepcion(mov).estado).toBe('recibido');
  });
});

describe('cruce-recepcion — referencia SIN COSTOS (rol almacén)', () => {
  it('itemSinCostos jamás filtra precio/subtotal', () => {
    const it = itemSinCostos({ descripcion: 'Cemento', cantidad: 20, unidad: 'bls', precio_unitario: 28.5, subtotal: 570 });
    expect(it).toEqual({ descripcion: 'Cemento', cantidad: 20, unidad: 'bls' });
    expect(it).not.toHaveProperty('precio_unitario');
    expect(it).not.toHaveProperty('subtotal');
  });
  it('referenciaSinCostos entrega insumo/cantidad/unidad/proveedor/N° pero NINGÚN monto', () => {
    const mov = factura([
      { descripcion: 'Cemento Portland', cantidad: 20, unidad: 'bls', precio_unitario: 28.5 },
      { descripcion: 'Arena gruesa', cantidad: 3, unidad: 'm3', precio_unitario: 60 },
    ]);
    const ref = referenciaSinCostos(mov);
    expect(ref.documento).toBe('factura F001-123');
    expect(ref.proveedor).toBe('FERRETERIA HUAMAN EIRL');
    expect(ref.fecha).toBe('2026-07-10');
    expect(ref.insumos).toEqual([
      { descripcion: 'Cemento Portland', cantidad: 20, unidad: 'bls' },
      { descripcion: 'Arena gruesa', cantidad: 3, unidad: 'm3' },
    ]);
    // ningún costo se filtra en toda la referencia serializada
    expect(JSON.stringify(ref)).not.toMatch(/precio|subtotal|igv|28\.5|monto/i);
  });
  it('referenciaSinCostos con itemIdx refiere una sola línea', () => {
    const mov = factura([{ descripcion: 'Cemento', cantidad: 20, unidad: 'bls' }, { descripcion: 'Arena', cantidad: 3, unidad: 'm3' }]);
    const ref = referenciaSinCostos(mov, 1);
    expect(ref.item_idx).toBe(1);
    expect(ref.insumos).toEqual([{ descripcion: 'Arena', cantidad: 3, unidad: 'm3' }]);
  });
});

describe('cruce-recepcion — matcher determinista', () => {
  const ctx = { proveedor_id: 'prov1', third_party_name: 'FERRETERIA HUAMAN', obra_id: 'obraA', fecha: '2026-07-10' };

  it('material_id igual = coincidencia fuerte con motivo', () => {
    const item = { descripcion: 'lo que sea', material_id: 'matX', cantidad: 20, unidad: 'bls' };
    const ingreso = { id: 'g1', material_id: 'matX', materialNombre: 'otro nombre', cantidad: 20, unidad: 'bls', fecha: '2026-07-10', proveedor_id: 'prov1', obra_id: 'obraA' };
    const { score, motivos } = puntuarCruce(item, ctx, ingreso);
    expect(score).toBeGreaterThan(0.9);
    expect(motivos).toContain('mismo insumo del catálogo');
  });

  it('nombre parecido + misma fecha/cantidad/proveedor puntúa alto sin material_id', () => {
    const item = { descripcion: 'Cemento Portland tipo I', cantidad: 20, unidad: 'bls' };
    const ingreso = { id: 'g1', materialNombre: 'Cemento Portland', cantidad: 20, unidad: 'bls', fecha: '2026-07-10', proveedor_id: 'prov1', obra_id: 'obraA' };
    const { score } = puntuarCruce(item, ctx, ingreso);
    expect(score).toBeGreaterThan(0.6);
  });

  it('fecha lejana y nombre distinto puntúa bajo (bajo el umbral)', () => {
    const item = { descripcion: 'Clavos de 3 pulgadas', cantidad: 5, unidad: 'kg' };
    const ingreso = { id: 'g1', materialNombre: 'Cemento', cantidad: 20, unidad: 'bls', fecha: '2026-01-01', proveedor_id: 'otro', obra_id: 'obraB' };
    const { score } = puntuarCruce(item, ctx, ingreso);
    expect(score).toBeLessThan(0.35);
  });

  it('rankearIngresosParaItem ordena por score y filtra bajo el umbral', () => {
    const item = { descripcion: 'Cemento Portland', material_id: 'matX', cantidad: 20, unidad: 'bls' };
    const ingresos = [
      { id: 'bueno', material_id: 'matX', materialNombre: 'Cemento', cantidad: 20, unidad: 'bls', fecha: '2026-07-10', proveedor_id: 'prov1', obra_id: 'obraA' },
      { id: 'malo', materialNombre: 'Fierro corrugado', cantidad: 100, unidad: 'var', fecha: '2026-01-01', proveedor_id: 'z', obra_id: 'z' },
      { id: 'medio', materialNombre: 'Cemento Portland', cantidad: 18, unidad: 'bls', fecha: '2026-07-12', proveedor_id: 'prov1', obra_id: 'obraA' },
    ];
    const r = rankearIngresosParaItem(item, ctx, ingresos);
    expect(r.map(c => c.ingreso.id)).toEqual(['bueno', 'medio']); // 'malo' filtrado
    expect(r[0].score).toBeGreaterThanOrEqual(r[1].score);
  });
});

describe('cruce-recepcion — reverso (almacén → factura), sin costos', () => {
  it('rankearFacturasParaIngreso ignora ítems ya resueltos y trae referencia sin costos', () => {
    const ingreso = { id: 'g1', materialNombre: 'Cemento Portland', cantidad: 20, unidad: 'bls', fecha: '2026-07-10', proveedor_id: 'prov1', obra_id: 'obraA' };
    const facturas = [
      factura([
        { descripcion: 'Cemento Portland', material_id: 'matX', cantidad: 20, unidad: 'bls', precio_unitario: 28.5 }, // candidato
        { descripcion: 'Arena', cantidad: 3, unidad: 'm3', recibido: 3, precio_unitario: 60 }, // ya recibido → se ignora
      ], { id: 'fa', proveedor_id: 'prov1', obra_id: 'obraA', date: '2026-07-10' }),
      factura([{ descripcion: 'Fierro', cantidad: 100, unidad: 'var', precio_unitario: 20 }],
        { id: 'fb', proveedor_id: 'zzz', obra_id: 'obraZ', date: '2026-01-01' }), // no matchea
    ];
    const r = rankearFacturasParaIngreso(ingreso, facturas);
    expect(r).toHaveLength(1);
    expect(r[0].facturaId).toBe('fa');
    expect(r[0].item_idx).toBe(0);
    // la referencia que verá la almacenera NO trae ningún costo
    expect(JSON.stringify(r[0].referencia)).not.toMatch(/precio|subtotal|28\.5/i);
    expect(r[0].referencia.insumos[0]).toEqual({ descripcion: 'Cemento Portland', cantidad: 20, unidad: 'bls' });
  });
});

describe('cruce-recepcion — reporteRecepcion (facturado / recibido / faltante / destino)', () => {
  it('agrega por insumo, consolida por nombre y separa obra de consumo empresa', () => {
    const movs = [
      factura([
        { descripcion: 'Cemento', unidad: 'bls', cantidad: 100, recibido: 80, destino: 'obra' },
        { descripcion: 'Café', unidad: 'kg', cantidad: 5, recibido: 0, destino: 'empresa' },
      ], { id: 'f1' }),
      factura([
        { descripcion: 'cemento', unidad: 'bls', cantidad: 50, recibido: 50, destino: 'obra' },
      ], { id: 'f2', document_number: 'F001-124' }),
      // venta: NO cuenta
      { id: 'v1', clase: 'venta', type: 'income', notas: JSON.stringify({ items_factura: [{ descripcion: 'x', cantidad: 1 }] }) },
    ];
    const rep = reporteRecepcion(movs);
    const cem = rep.porInsumo.find(i => /cemento/i.test(i.nombre));
    expect(cem.facturado).toBe(150);
    expect(cem.recibido).toBe(130);
    expect(cem.faltante).toBe(20);
    expect(cem.aObra).toBe(150);
    expect(cem.pctRecibido).toBe(87);          // 130/150
    expect(cem.nFacturas).toBe(2);
    const cafe = rep.porInsumo.find(i => /caf/i.test(i.nombre));
    expect(cafe.aEmpresa).toBe(5);
    expect(cafe.faltante).toBe(0);             // consumo empresa: no "falta" en obra
    expect(rep.totales).toMatchObject({ faltante: 20, aEmpresa: 5, aObra: 150 });
    expect(rep.nFacturas).toBe(2);             // la venta se ignora
  });

  it('un ítem servicio/rechazado no genera faltante', () => {
    const rep = reporteRecepcion([
      factura([
        { descripcion: 'Flete', unidad: 'srv', cantidad: 1, recibido: 0, tipo_insumo: 'servicio' },
        { descripcion: 'Clavos', unidad: 'kg', cantidad: 10, recibido: 4, destino: 'obra' },
      ]),
    ]);
    expect(rep.totales.faltante).toBe(6);      // solo clavos (10 − 4)
  });
});
