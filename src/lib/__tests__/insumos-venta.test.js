import { describe, it, expect } from 'vitest';
import { itemAplicaAlmacen, pendienteDeIngreso, candidatosSinIngreso, poolParaVenta, vendidosVenta, estadoConsultaItem } from '../insumos-venta.js';

const factura = (id, items, extra = {}) => ({
  id, clase: 'compra', type: 'cost', recepcion_status: 'parcial',
  document_number: `E001-${id}`, date: '2026-07-01', third_party_name: 'PROV SAC',
  notas: JSON.stringify({ items_factura: items }), ...extra,
});
const IT = (over = {}) => ({ descripcion: 'TUBO PVC 1/2"', unidad: 'und', cantidad: 40, precio_unitario: 8.5, tipo_insumo: 'material', ...over });

describe('insumos-venta — detección de candidatos', () => {
  it('un ítem sin nada recibido es candidato con todo pendiente', () => {
    const c = candidatosSinIngreso([factura('a', [IT()])]);
    expect(c).toHaveLength(1);
    expect(c[0].pendiente).toBe(40);
    expect(c[0].doc).toBe('E001-a');
  });
  it('recepción parcial: el candidato es el remanente', () => {
    const c = candidatosSinIngreso([factura('a', [IT({ recibido: 30 })])]);
    expect(c[0].pendiente).toBe(10);
  });
  it('recibido completo, servicios y consumo empresa NO son candidatos', () => {
    const c = candidatosSinIngreso([factura('a', [
      IT({ recibido: 40 }),                          // completo
      IT({ tipo_insumo: 'servicio' }),               // servicio
      IT({ destino: 'empresa' }),                    // consumo empresa
    ])]);
    expect(c).toHaveLength(0);
  });
  it('ventas, notas y facturas sin almacén quedan fuera', () => {
    const c = candidatosSinIngreso([
      factura('v', [IT()], { clase: 'venta', type: 'income' }),
      factura('n', [IT()], { recepcion_status: 'no_aplica' }),
      factura('d', [IT()], { deleted_at: '2026-08-01' }),
    ]);
    expect(c).toHaveLength(0);
  });
  it('un ítem ya separado deja de ser candidato', () => {
    const c = candidatosSinIngreso([factura('a', [IT({ venta_status: 'para_venta' })])]);
    expect(c).toHaveLength(0);
  });
  it('helpers: itemAplicaAlmacen / pendienteDeIngreso', () => {
    expect(itemAplicaAlmacen(IT())).toBe(true);
    expect(itemAplicaAlmacen(IT({ destino: 'general' }))).toBe(false);
    expect(pendienteDeIngreso(IT({ cantidad: 5, recibido: 7 }))).toBe(0); // nunca negativo
  });
});

describe('insumos-venta — pool y vendidos', () => {
  it('el pool lista los separados con costo total', () => {
    const p = poolParaVenta([factura('a', [IT({ venta_status: 'para_venta', venta_cantidad: 10 })])]);
    expect(p).toHaveLength(1);
    expect(p[0].cantidad).toBe(10);
    expect(p[0].costoTotal).toBeCloseTo(85);
  });
  it('vendidos resuelve la factura de venta vinculada', () => {
    const compra = factura('a', [IT({ venta_status: 'vendido', venta_cantidad: 10, venta_mov_id: 'v1' })]);
    const venta = { id: 'v1', clase: 'venta', type: 'income', document_number: 'E001-301', date: '2026-08-10', amount: 120, notas: '{}' };
    const v = vendidosVenta([compra, venta]);
    expect(v).toHaveLength(1);
    expect(v[0].ventaDoc).toBe('E001-301');
    expect(v[0].ventaMonto).toBe(120);
  });
});

describe('insumos-venta — estadoConsultaItem', () => {
  const cons = (over = {}) => ({ accounting_movement_id: 'a', item_idx: 0, respuesta_tipo: null, updated_at: '2026-08-01', ...over });
  it('sin consulta / esperando / respondida', () => {
    expect(estadoConsultaItem([], 'a', 0).estado).toBe('sin_consulta');
    expect(estadoConsultaItem([cons()], 'a', 0).estado).toBe('esperando');
    expect(estadoConsultaItem([cons({ respuesta_tipo: 'no' })], 'a', 0).estado).toBe('no');
  });
  it('la respuesta más reciente manda', () => {
    const r = estadoConsultaItem([
      cons({ respuesta_tipo: 'si', updated_at: '2026-08-01' }),
      cons({ respuesta_tipo: 'no', updated_at: '2026-08-05' }),
    ], 'a', 0);
    expect(r.estado).toBe('no');
  });
  it('no cruza ítems ni facturas', () => {
    expect(estadoConsultaItem([cons({ item_idx: 1, respuesta_tipo: 'no' })], 'a', 0).estado).toBe('sin_consulta');
  });
});
