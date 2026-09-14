// ═══════════════════════════════════════════════════════════════════
// ¿ABRE el panel de anticipos?
//
// Vive DENTRO del bloque «Inventario» de una empresa, o sea que
// `pantallas-montan.test.jsx` no lo renderiza nunca: el detalle de empresa abre
// en el panel de secciones y hay que entrar a Inventario para verlo. Un TDZ o
// un `undefined.map` acá pasaría el green gate en verde, igual que el que dejó
// Movimientos Contables muerto el 3-sep.
//
// Los datos son los reales de KOPLAST contra GASOMI.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeAll } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

function montarBrowserFalso() {
  const g = globalThis;
  g.window = g;
  g.addEventListener = () => {}; g.removeEventListener = () => {};
  g.__newId = () => 'id-falso';
  g.JxIcon = () => null;
  g.__useAuth = () => ({ profile: { id: 'u1' } });
  g.__hooks = new Proxy({}, { get: () => (() => ({ data: [], loading: false, refresh: async () => {} })) });
}

const GASOMI = 'gasomi-id';
const KOPLAST = '20505543174';

const mov = (id, doc, fecha, amount, extra = {}) => ({
  id, company_id: GASOMI, date: fecha, document_number: doc,
  document_type: 'factura', clase: 'compra', type: 'cost',
  third_party_ruc: KOPLAST, third_party_name: 'KOPLAST INDUSTRIAL S.A.C',
  currency: 'USD', amount, payment_status: 'paid', deleted_at: null, ...extra,
});
const conItems = (items) => ({ notas: JSON.stringify({ items_factura: items }) });

const MOVS = [
  mov('a1', 'F003-3384', '2026-03-31', 80000, conItems([
    { descripcion: 'ANTICIPO DE CLIENTE', cantidad: 1, precio_unitario: 67796.61, unidad: 'und', tipo_insumo: 'material' },
  ])),
  mov('f1', 'F003-3409', '2026-04-13', 19518.72),
  mov('n1', 'FC03-187', '2026-05-06', -19518.72, { document_type: 'nota_credito', related_movement_id: 'f1' }),
  mov('f4', 'F003-3478', '2026-05-06', 0),
];

let PanelAnticipos, DetalleAnticipo;
beforeAll(async () => {
  montarBrowserFalso();
  ({ PanelAnticipos, DetalleAnticipo } = await import('../../components/jx-anticipos.jsx'));
}, 30000);

const pintar = (props = {}) => renderToString(React.createElement(PanelAnticipos, {
  movs: MOVS, aplicaciones: [], companyId: GASOMI, ...props,
}));

describe('el panel abre', () => {
  it('sin un solo movimiento no dibuja nada (y no revienta)', () => {
    expect(renderToString(React.createElement(PanelAnticipos, { movs: [], aplicaciones: [] }))).toBe('');
  });

  it('sin anticipos tampoco dibuja: la mayoría de las empresas no tiene ninguno', () => {
    const sinAnticipo = MOVS.filter(m => m.id !== 'a1');
    expect(renderToString(React.createElement(PanelAnticipos, { movs: sinAnticipo, aplicaciones: [], companyId: GASOMI }))).toBe('');
  });

  it('con el anticipo de KOPLAST dibuja el saldo y no imprime undefined ni NaN', () => {
    const h = pintar();
    expect(h).toContain('Anticipos a proveedores');
    expect(h).toContain('KOPLAST INDUSTRIAL S.A.C');
    expect(h).toContain('F003-3384');
    expect(h).not.toContain('undefined');
    expect(h).not.toContain('NaN');
  });

  it('🔴 el saldo se dice en DÓLARES, no en soles', () => {
    const h = pintar();
    expect(h).toContain('USD 80,000.00');
    expect(h).not.toContain('S/ 80,000.00');
  });

  it('con aplicaciones cargadas muestra el avance', () => {
    const h = pintar({
      aplicaciones: [{ id: 'ap1', anticipo_movimiento_id: 'a1', factura_movimiento_id: 'f1', monto: 19518.72, moneda: 'USD', fuente: 'manual' }],
    });
    expect(h).toContain('USD 19,518.72');
    expect(h).toContain('a favor');
  });

  it('un anticipo cerrado se ve cerrado', () => {
    const h = pintar({
      aplicaciones: [{ id: 'ap1', anticipo_movimiento_id: 'a1', factura_movimiento_id: 'f1', monto: 80000, moneda: 'USD', fuente: 'manual' }],
    });
    expect(h).toContain('cerrado');
  });

  it('🔴 8 facturas normales de US$ 10.000 no revientan el panel (el picker manual viaja de punta a punta)', () => {
    const ocho = Array.from({ length: 8 }, (_, i) => mov(`f10k-${i}`, `F003-91${i}`, '2026-04-01', 10000));
    const h = pintar({ movs: [...MOVS, ...ocho] });
    expect(h).toContain('Anticipos a proveedores');
    expect(h).not.toContain('undefined');
    expect(h).not.toContain('NaN');
  });
});

describe('el detalle (su propia rama, que el panel esconde hasta que se abre)', () => {
  const pintarDetalle = (a) => renderToString(React.createElement(DetalleAnticipo, {
    a, montos: {}, setMontos: () => {}, onAplicar: () => {}, onAplicarLasAnuladas: () => {}, onQuitar: () => {},
  }));

  it('la propuesta con importe ofrece aplicarla y explica por qué', () => {
    const h = pintarDetalle({
      id: 'a1', moneda: 'USD', cerrado: false, aplicaciones: [],
      propuestas: [{ facturaId: 'f1', documento: 'F003-3409', fecha: '2026-04-13', monto: 19518.72, moneda: 'USD', motivo: 'Una nota de crédito anuló F003-3409 por completo: la mercadería llegó y el anticipo la cubrió.' }],
    });
    expect(h).toContain('F003-3409');
    expect(h).toContain('nota de crédito');
    expect(h).toContain('que una nota de crédito anuló');
  });

  it('🔴 la entrega en CERO pide el importe en vez de inventarlo', () => {
    const h = pintarDetalle({
      id: 'a1', moneda: 'USD', cerrado: false, aplicaciones: [],
      propuestas: [{ facturaId: 'f4', documento: 'F003-3478', fecha: '2026-05-06', monto: 0, moneda: 'USD', pideMonto: true, motivo: 'F003-3478 vino en CERO: es una entrega ya descontada del anticipo. El importe está en el PDF — escribilo.' }],
    });
    expect(h).toContain('monto en USD');     // el input, no un número inventado
    expect(h).toContain('está en el PDF');
    // Y NO hay botón de lote: eso solo aplica a las que una NC anuló.
    expect(h).not.toContain('que una nota de crédito anuló');
  });

  it('🔴 una aplicación contra un comprobante que no está cargado no revienta', () => {
    const h = pintarDetalle({
      id: 'a1', moneda: 'USD', cerrado: false, propuestas: [],
      aplicaciones: [{ id: 'ap1', monto: 100, moneda: 'USD', facturaDocumento: '(comprobante no cargado)', facturaFecha: '', motivo: null }],
    });
    expect(h).toContain('(comprobante no cargado)');
    expect(h).not.toContain('undefined');
  });

  it('sin nada que proponer y con saldo abierto, sugiere mirar contra SUNAT', () => {
    const h = pintarDetalle({ id: 'a1', moneda: 'USD', cerrado: false, aplicaciones: [], propuestas: [] });
    expect(h).toContain('Libros Electrónicos');
  });

  it('🔴 un `a` sin `manuales` (caller viejo, o un test) no revienta la pantalla', () => {
    // El campo es nuevo (13-set) — sin este resguardo, undefined.length tumbaba
    // el detalle apenas se abría un anticipo. Ver la nota en jx-anticipos.jsx.
    expect(() => pintarDetalle({ id: 'a1', moneda: 'USD', cerrado: false, aplicaciones: [], propuestas: [] }))
      .not.toThrow();
  });

  it('con facturas normales (sin señal automática) ofrece el picker manual, no "no hay más facturas"', () => {
    // El caso de Gabriel: 8 facturas de US$ 10.000 contra un anticipo de
    // US$ 80.000, sin nota de crédito ni total en cero — nada que proponer
    // sola, pero SÍ hay contra qué aplicar a mano.
    const manuales = Array.from({ length: 8 }, (_, i) => ({
      id: `f10k-${i}`, fecha: '2026-04-01', documento: `F003-91${i}`, monto: 10000, moneda: 'USD', enCero: false,
    }));
    const h = pintarDetalle({ id: 'a1', moneda: 'USD', cerrado: false, aplicaciones: [], propuestas: [], manuales });
    expect(h).toContain('Aplicar otra factura a este anticipo');
    expect(h).toContain('F003-910');
    expect(h).not.toContain('No hay más facturas');
    expect(h).not.toContain('undefined');
    expect(h).not.toContain('NaN');
  });

  it('sin candidatas manuales ni propuestas, no se dibuja el picker', () => {
    const h = pintarDetalle({ id: 'a1', moneda: 'USD', cerrado: false, aplicaciones: [], propuestas: [], manuales: [] });
    expect(h).not.toContain('Aplicar otra factura a este anticipo');
  });
});
