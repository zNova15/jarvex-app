// El autocompletado del detalle: que «cem» traiga el cemento, que el precio
// que se ofrece tenga fecha, y que nunca se autocomplete solo.
import { describe, it, expect } from 'vitest';
import {
  corpusDeDescripciones, buscarDescripcion, origenPrincipal,
} from '../sugerir-descripcion.js';

const OC_ITEMS = [
  { id: 'i1', nombre: 'CEMENTO PORTLAND TIPO I 42.5 KG', unidad: 'BOL', precio_unitario: 28.5, created_at: '2026-08-01' },
  { id: 'i2', nombre: 'SERVICIO DE TRANSPORTE DE AGREGADOS', unidad: 'VJE', precio_unitario: 900, created_at: '2026-08-02', tipo_insumo: 'servicio' },
];

const INSUMOS_PARTIDA = [
  { id: 'ip1', insumo_codigo: '210020001', nombre_insumo: 'CEMENTO PORTLAND TIPO I', unidad: 'bol', precio_unitario: 27, tipo_insumo: 'material' },
  { id: 'ip2', insumo_codigo: '30020002', nombre_insumo: 'ACERO CORRUGADO FY=4200', unidad: 'kg', tipo_insumo: 'material' },
];

const mov = (o) => ({ type: 'cost', clase: 'compra', deleted_at: null, ...o });

const MOVS = [
  mov({ id: 'm1', company_id: 'c-1', date: '2026-03-10', notas: JSON.stringify({ items_factura: [
    { descripcion: 'CEMENTO SOL TIPO I', unidad: 'BOL', cantidad: 100, precio_unitario: 26 },
    { descripcion: 'CLAVOS DE 3 PULGADAS', unidad: 'KG', cantidad: 20, precio_unitario: 6 },
  ] }) }),
  mov({ id: 'm2', company_id: 'c-1', date: '2026-07-20', notas: JSON.stringify({ items_factura: [
    { descripcion: 'CEMENTO SOL TIPO I', unidad: 'BOL', cantidad: 50, precio_unitario: 29.9 },
  ] }) }),
  // Una VENTA no describe una compra: no entra al corpus.
  mov({ id: 'm3', type: 'income', clase: 'venta', company_id: 'c-1', date: '2026-07-21',
    notas: JSON.stringify({ items_factura: [{ descripcion: 'ALQUILER DE ANDAMIO', cantidad: 1, precio_unitario: 400 }] }) }),
  mov({ id: 'm4', company_id: 'c-1', date: '2026-07-22', payment_status: 'cancelled',
    notas: JSON.stringify({ items_factura: [{ descripcion: 'CEMENTO ANULADO', cantidad: 1, precio_unitario: 1 }] }) }),
];

const corpus = (opts = {}) => corpusDeDescripciones({
  ocItems: OC_ITEMS, movs: MOVS, insumosPartida: INSUMOS_PARTIDA, companyId: 'c-1', ...opts,
});

describe('corpusDeDescripciones', () => {
  it('junta órdenes, presupuesto y facturas', () => {
    const c = corpus();
    const origenes = new Set(c.flatMap(e => e.origenes));
    expect(origenes).toEqual(new Set(['orden', 'presupuesto', 'factura']));
  });

  it('la misma descripción en dos facturas es UNA entrada, contada dos veces', () => {
    const sol = corpus().filter(e => e.descripcion === 'CEMENTO SOL TIPO I');
    expect(sol).toHaveLength(1);
    expect(sol[0].veces).toBe(2);
  });

  it('🔴 el precio que se ofrece es el ÚLTIMO, con su fecha — no el promedio', () => {
    const sol = corpus().find(e => e.descripcion === 'CEMENTO SOL TIPO I');
    expect(sol.precio).toBe(29.9);
    expect(sol.precioFecha).toBe('2026-07-20');
  });

  it('una venta no entra: describe lo que vendimos, no lo que compramos', () => {
    expect(corpus().find(e => /ANDAMIO/.test(e.descripcion))).toBeUndefined();
  });

  it('un comprobante anulado tampoco', () => {
    expect(corpus().find(e => /ANULADO/.test(e.descripcion))).toBeUndefined();
  });

  it('lo del presupuesto llega con su código canónico: es lo que deja mapeo', () => {
    const acero = corpus().find(e => /ACERO/.test(e.descripcion));
    expect(acero.insumoCodigo).toBe('30020002');
  });

  it('los servicios están en el mismo corpus: el texto tipeado es el filtro', () => {
    // No se acota por tipo de orden a propósito — `tipo_insumo` está cargado en
    // algunas líneas y en casi ninguna de factura, y un filtro a medias esconde
    // sin explicar. Ver el encabezado de sugerir-descripcion.js.
    expect(buscarDescripcion(corpus(), 'transporte')).toHaveLength(1);
    expect(buscarDescripcion(corpus(), 'transporte')[0].descripcion).toMatch(/TRANSPORTE/);
  });

  it('descarta el ruido: menos de 3 caracteres no es una descripción', () => {
    const c = corpusDeDescripciones({ ocItems: [{ id: 'x', nombre: 'AB' }], movs: [], insumosPartida: [] });
    expect(c).toHaveLength(0);
  });
});

describe('buscarDescripcion', () => {
  it('«cem» trae los cementos — el caso textual que pidió Gabriel', () => {
    const r = buscarDescripcion(corpus(), 'cem');
    expect(r.length).toBeGreaterThan(0);
    expect(r.every(s => /CEMENTO/i.test(s.descripcion))).toBe(true);
  });

  it('lo que EMPIEZA por el texto va antes que lo que lo tiene en el medio', () => {
    const c = [
      { norm: 'bolsa de cemento', descripcion: 'BOLSA DE CEMENTO', veces: 9, origenes: ['factura'], unidad: '', precio: null, precioFecha: '', insumoCodigo: null, empresas: [], propio: false },
      { norm: 'cemento portland', descripcion: 'CEMENTO PORTLAND', veces: 1, origenes: ['factura'], unidad: '', precio: null, precioFecha: '', insumoCodigo: null, empresas: [], propio: false },
    ];
    expect(buscarDescripcion(c, 'cem')[0].descripcion).toBe('CEMENTO PORTLAND');
  });

  it('con una sola letra no dispara: sería ruido y recorrer todo el corpus', () => {
    expect(buscarDescripcion(corpus(), 'c')).toHaveLength(0);
  });

  it('busca también en el medio: «portland» encuentra al cemento', () => {
    expect(buscarDescripcion(corpus(), 'portland').length).toBeGreaterThan(0);
  });

  it('exige todos los tokens', () => {
    expect(buscarDescripcion(corpus(), 'cemento inexistente')).toHaveLength(0);
  });

  it('respeta el límite pedido', () => {
    expect(buscarDescripcion(corpus(), 'cemento', { limite: 1 })).toHaveLength(1);
  });
});

describe('origenPrincipal', () => {
  it('la orden manda sobre el presupuesto, y el presupuesto sobre la factura', () => {
    expect(origenPrincipal({ origenes: ['factura', 'orden'] })).toBe('orden');
    expect(origenPrincipal({ origenes: ['factura', 'presupuesto'] })).toBe('presupuesto');
    expect(origenPrincipal({ origenes: ['factura'] })).toBe('factura');
  });
});
