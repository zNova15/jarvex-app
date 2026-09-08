import { describe, it, expect } from 'vitest';
import {
  indexarMovs, punteroDeDesglose, origenDelDesglose, itemsConHerencia, conDesgloseHeredado,
} from '../desglose-heredado.js';
import { itemsDeFactura } from '../cruce-recepcion.js';
import { tipoSugerido, igvSugeridoDesdeItems, borradorDesdeMovimiento } from '../ordenes.js';

// El caso real que reportó la contadora el 8-set-2026: la factura E001-4 de
// JARVEX a CONSORCIO EL INCA. La VENTA (libro de JARVEX) trae los 14 ítems que
// se ven en el PDF; el ESPEJO (libro de EL INCA) nace sin ítems y con el
// puntero — y es el que aparece en «Sin respaldo».
const JARVEX = 'c-jarvex';
const INCA = 'c-inca';

const ITEMS = [
  { descripcion: 'CINTA AISLANTE 3M', unidad: 'und', cantidad: 21, precio_unitario: 4, tipo_insumo: 'material' },
  { descripcion: 'DISCO DE CORTE DE 7 PULGADAS PARA FIERRO', unidad: 'und', cantidad: 50, precio_unitario: 10, tipo_insumo: 'material' },
];

const venta = (o = {}) => ({
  id: 'v1', company_id: JARVEX, type: 'income', clase: 'venta',
  document_type: 'factura', document_number: 'E001-4', amount: 4184.28, currency: 'PEN',
  date: '2026-07-07', is_intercompany: true, related_company_id: INCA,
  notas: JSON.stringify({ subtotal: 3546, igv: 638.28, items_factura: ITEMS }),
  ...o,
});

const espejo = (o = {}) => ({
  id: 'e1', company_id: INCA, type: 'cost', clase: 'compra',
  document_type: 'factura', document_number: 'E001-4', amount: 4184.28, currency: 'PEN',
  date: '2026-07-07', is_intercompany: true, related_company_id: JARVEX,
  related_movement_id: 'v1',
  third_party_name: 'JARVEX INGENIERIA', third_party_ruc: '20615646505',
  notas: JSON.stringify({
    subtotal: 3546, igv: 638.28, intercompany_auto: true,
    desglose_heredado_de: 'v1', intercompany_mirror_of: 'v1',
  }),
  ...o,
});

describe('el puntero al desglose', () => {
  it('lo lee de desglose_heredado_de', () => {
    expect(punteroDeDesglose(espejo())).toBe('v1');
  });

  it('cae en intercompany_mirror_of cuando no está el explícito', () => {
    const m = espejo({ notas: JSON.stringify({ intercompany_mirror_of: 'v9' }) });
    expect(punteroDeDesglose(m)).toBe('v9');
  });

  it('usa related_movement_id solo si el comprobante es interco', () => {
    expect(punteroDeDesglose({ notas: '{}', related_movement_id: 'x', is_intercompany: true })).toBe('x');
    expect(punteroDeDesglose({ notas: '{}', related_movement_id: 'x' })).toBe(null);
  });

  it('sin notas ni vínculo no hay puntero', () => {
    expect(punteroDeDesglose({ id: 'm' })).toBe(null);
    expect(punteroDeDesglose(null)).toBe(null);
  });
});

describe('las guardas del origen', () => {
  const idx = (movs) => indexarMovs(movs);

  it('el caso bueno: el espejo encuentra su venta', () => {
    expect(origenDelDesglose(espejo(), idx([venta(), espejo()]))?.id).toBe('v1');
  });

  it('funciona también con un arreglo en vez de un Map', () => {
    expect(origenDelDesglose(espejo(), [venta(), espejo()])?.id).toBe('v1');
  });

  it('no hereda de un movimiento del MISMO libro (es el caso nota → factura)', () => {
    const notaCredito = {
      id: 'nc1', company_id: JARVEX, type: 'income', document_type: 'nota_credito',
      document_number: 'E001-1', amount: -12920, is_intercompany: true,
      related_movement_id: 'f1', notas: '{}',
    };
    const factura = venta({ id: 'f1', document_number: 'E001-1', amount: 12920 });
    expect(origenDelDesglose(notaCredito, idx([factura, notaCredito]))).toBe(null);
  });

  it('no hereda de OTRO comprobante aunque el puntero apunte ahí', () => {
    const otra = venta({ id: 'v1', document_number: 'E001-9' });
    expect(origenDelDesglose(espejo(), idx([otra]))).toBe(null);
  });

  it('no hereda de un origen borrado', () => {
    expect(origenDelDesglose(espejo(), idx([venta({ deleted_at: '2026-08-01' })]))).toBe(null);
  });

  it('no hereda si el origen tampoco tiene ítems', () => {
    expect(origenDelDesglose(espejo(), idx([venta({ notas: '{}' })]))).toBe(null);
  });

  it('un puntero a sí mismo no cuenta', () => {
    const m = espejo({ notas: JSON.stringify({ desglose_heredado_de: 'e1' }) });
    expect(origenDelDesglose(m, idx([m]))).toBe(null);
  });
});

describe('los ítems, propios o heredados', () => {
  it('los PROPIOS mandan siempre', () => {
    const conPropios = espejo({ notas: JSON.stringify({ desglose_heredado_de: 'v1', items_factura: [{ descripcion: 'LO MÍO' }] }) });
    const r = itemsConHerencia(conPropios, indexarMovs([venta()]));
    expect(r.items).toHaveLength(1);
    expect(r.items[0].descripcion).toBe('LO MÍO');
    expect(r.heredadoDe).toBe(null);
  });

  it('sin propios trae los de la venta y DICE de dónde', () => {
    const r = itemsConHerencia(espejo(), indexarMovs([venta()]));
    expect(r.items).toHaveLength(2);
    expect(r.items[0].descripcion).toBe('CINTA AISLANTE 3M');
    expect(r.heredadoDe).toBe('v1');
  });

  it('sin nada que heredar devuelve vacío, no inventa', () => {
    const r = itemsConHerencia(espejo(), indexarMovs([]));
    expect(r.items).toEqual([]);
    expect(r.heredadoDe).toBe(null);
  });
});

describe('el movimiento hidratado alimenta a las funciones de órdenes', () => {
  const movs = [venta(), espejo()];

  it('conDesgloseHeredado deja los ítems donde itemsDeFactura los busca', () => {
    const h = conDesgloseHeredado(espejo(), indexarMovs(movs));
    expect(itemsDeFactura(h)).toHaveLength(2);
    expect(h.__desglose_heredado_de).toBe('v1');
  });

  it('no toca el movimiento cuando no hay nada que heredar', () => {
    const suelto = espejo({ notas: '{}', related_movement_id: null });
    expect(conDesgloseHeredado(suelto, indexarMovs(movs))).toBe(suelto);
  });

  it('no escribe los ítems en el original (el espejo sigue sin ítems propios)', () => {
    const e = espejo();
    conDesgloseHeredado(e, indexarMovs(movs));
    expect(itemsDeFactura(e)).toEqual([]);
  });

  it('la orden retroactiva nace con las LÍNEAS REALES, no con «Insumos y materiales»', () => {
    const crudo = borradorDesdeMovimiento(espejo());
    expect(crudo.lineas).toHaveLength(1);
    expect(crudo.lineas[0].nombre).toBe('Insumos y materiales');

    const b = borradorDesdeMovimiento(conDesgloseHeredado(espejo(), indexarMovs(movs)));
    expect(b.lineas).toHaveLength(2);
    expect(b.lineas.map(l => l.nombre)).toContain('CINTA AISLANTE 3M');
    // Y siguen cuadrando contra el comprobante que respaldan.
    expect(b.lineas.reduce((s, l) => s + l.subtotal, 0)).toBeCloseTo(b.valorVenta, 2);
  });

  it('el tipo y el IGV se deciden con los ítems heredados', () => {
    const h = conDesgloseHeredado(espejo(), indexarMovs(movs));
    expect(tipoSugerido(h)).toBe('compra');
    // 3.546 de ítems contra 4.184,28 de total → hay IGV, no es exonerada.
    expect(igvSugeridoDesdeItems(h)).toBe(null);
  });
});
