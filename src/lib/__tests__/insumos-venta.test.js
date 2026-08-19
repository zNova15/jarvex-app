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
      IT({ destino: 'obra_general' }),               // gasto general de OBRA (valor canónico)
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
    expect(itemAplicaAlmacen(IT({ destino: 'obra_general' }))).toBe(false);
    expect(itemAplicaAlmacen(IT({ destino: 'obra' }))).toBe(true);
    expect(pendienteDeIngreso(IT({ cantidad: 5, recibido: 7 }))).toBe(0); // nunca negativo
  });
});

describe('insumos-venta — pool y vendidos', () => {
  it('el pool lista los separados con costo total', () => {
    const p = poolParaVenta([factura('a', [IT({ venta_status: 'para_venta', venta_cantidad: 10 })])]);
    expect(p).toHaveLength(1);
    expect(p[0].cantidad).toBe(10);
    expect(p[0].costoTotal).toBeCloseTo(85);
    expect(p[0].ingresoPosterior).toBe(0);
  });
  it('si tras separar el ítem se recepcionó, el pool lo refleja (ingresoPosterior)', () => {
    // separó 10 pendientes; luego almacén recepcionó 36 de 40 → pendiente real 4
    const p = poolParaVenta([factura('a', [IT({ venta_status: 'para_venta', venta_cantidad: 10, recibido: 36 })])]);
    expect(p[0].cantidad).toBe(4);
    expect(p[0].cantidadSeparada).toBe(10);
    expect(p[0].ingresoPosterior).toBe(6);
  });
  it('vendidos marca ventaBorrada cuando la venta vinculada ya no existe', () => {
    const compra = factura('a', [IT({ venta_status: 'vendido', venta_cantidad: 10, venta_mov_id: 'v-borrada' })]);
    const v = vendidosVenta([compra]);
    expect(v[0].ventaBorrada).toBe(true);
    expect(v[0].ventaDoc).toBeNull();
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
  const cons = (over = {}) => ({ accounting_movement_id: 'a', item_idx: 0, respuesta_tipo: null, updated_at: '2026-08-01', referencia: { flujo: 'venta' }, ...over });
  it('sin consulta / esperando / respondida', () => {
    expect(estadoConsultaItem([], 'a', 0).estado).toBe('sin_consulta');
    expect(estadoConsultaItem([cons()], 'a', 0).estado).toBe('esperando');
    expect(estadoConsultaItem([cons({ respuesta_tipo: 'no' })], 'a', 0).estado).toBe('no');
  });
  it('una confirmación de llegada (si/parcial/otra_fecha) BLOQUEA aunque haya un "no" más reciente', () => {
    const r = estadoConsultaItem([
      cons({ respuesta_tipo: 'si', updated_at: '2026-08-01' }),
      cons({ respuesta_tipo: 'no', updated_at: '2026-08-05' }),
    ], 'a', 0);
    expect(r.estado).toBe('si');
    expect(estadoConsultaItem([cons({ respuesta_tipo: 'otra_fecha' })], 'a', 0).estado).toBe('otra_fecha');
  });
  it('un "no" de la consulta vieja "¿llegó?" (sin flujo venta) NO habilita separar', () => {
    const r = estadoConsultaItem([cons({ respuesta_tipo: 'no', referencia: {} })], 'a', 0);
    expect(r.estado).toBe('no_otro_flujo');
    // referencia como string JSON también se entiende
    expect(estadoConsultaItem([cons({ respuesta_tipo: 'no', referencia: JSON.stringify({ flujo: 'venta' }) })], 'a', 0).estado).toBe('no');
  });
  it('no cruza ítems ni facturas', () => {
    expect(estadoConsultaItem([cons({ item_idx: 1, respuesta_tipo: 'no' })], 'a', 0).estado).toBe('sin_consulta');
  });
});
