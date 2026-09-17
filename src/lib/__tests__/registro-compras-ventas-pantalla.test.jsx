// ═══════════════════════════════════════════════════════════════════
// EL REGISTRO DE COMPRAS Y VENTAS COMO PRIMER PLANO (tandas 4, 5 y 6)
//
// Pedido de Gabriel (17-set-2026): «la sección de Libros Electrónicos debería
// enfocarse en los registros de compra y venta como primer plano; conservá la
// exportación en PDF y Excel pero agregá la exportación a SIRE en .zip con un
// casillero al costado de cada comprobante; la pestaña de Reemplazo SIRE
// desaparece y se vuelve parte del Registro; lo mismo el escáner de
// incoherencias, como ventana emergente que proponga la solución rápida».
//
// Este test vigila que las dos pestañas mudadas sigan estando donde ahora
// viven. Lo que se perdería sin él es silencioso: el registro renderiza igual
// sin el botón del SIRE, y nadie se entera hasta que hay que presentar.
//
// Reemplaza a `reemplazo-sire-pantalla.test.jsx`, que probaba la pantalla que
// se fue. Lo que ese test cuidaba de verdad —el nombre reglamentario de 33
// caracteres, las 40/42 columnas, la selección por ids y el cruce contra lo ya
// presentado— está en `sunat-sire.test.js`, sobre la lib, que es donde
// corresponde.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

const JARVEX = 'c-jarvex', INCA = 'c-inca';
const COMPANIES = [
  { id: JARVEX, name: 'JARVEX INGENIERIA', legal_name: 'JARVEX INGENIERIA, TECNOLOGIA Y PROYECTOS E.I.R.L.', ruc: '20615646505', tipo_entidad: 'propia' },
  { id: INCA, name: 'CONSORCIO EL INCA', ruc: '20615346081', tipo_entidad: 'consorcio' },
];

const COMPRA = {
  id: 'm-compra', company_id: JARVEX, clase: 'compra', type: 'cost',
  document_type: 'factura', document_number: 'F001-00012345',
  third_party_ruc: '20498327031', third_party_name: 'AREQUIPA EXPRESO MARVISUR',
  description: 'TRANSPORTE NACIONAL', amount: 1180, currency: 'PEN',
  payment_status: 'paid', date: '2026-07-10',
  notas: JSON.stringify({ subtotal: 1000, igv: 180 }),
};

const VENTA = {
  id: 'm-venta', company_id: JARVEX, clase: 'venta', type: 'income',
  document_type: 'factura', document_number: 'E001-20',
  third_party_ruc: '20613434195', third_party_name: 'JADE CONSULTORIA',
  description: 'Valorización 03', amount: 30662, currency: 'PEN',
  payment_status: 'pending', date: '2026-07-15',
  notas: JSON.stringify({ subtotal: 25984.75, igv: 4677.25 }),
};

// Una venta interna marcada intercompany cuyo espejo NO existe: es la
// incoherencia que el escáner tiene que contar en ESTE período.
const VENTA_SIN_ESPEJO = {
  id: 'm-interco', company_id: JARVEX, clase: 'venta', type: 'income',
  document_type: 'factura', document_number: 'E001-2',
  third_party_ruc: '20615346081', third_party_name: 'CONSORCIO EL INCA',
  amount: 19028.68, currency: 'PEN', payment_status: 'pending',
  date: '2026-07-06', created_at: '2026-07-06T10:00:00Z',
  is_intercompany: true, related_company_id: INCA,
};

// La misma, pero de OTRO mes: sirve para probar que el contador del botón está
// acotado al período que se está cerrando.
const VENTA_SIN_ESPEJO_OTRO_MES = {
  ...VENTA_SIN_ESPEJO, id: 'm-interco-abril', document_number: 'E001-1',
  date: '2026-04-06', created_at: '2026-04-06T10:00:00Z',
};

function montarBrowserFalso() {
  const g = globalThis;
  g.window = g;
  g.innerWidth = 1400;
  g.addEventListener = () => {}; g.removeEventListener = () => {}; g.dispatchEvent = () => {};
  g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const nodo = () => ({
    style: { setProperty() {}, getPropertyValue: () => '' },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    appendChild() {}, removeChild() {}, dataset: {},
    classList: { add() {}, remove() {}, contains: () => false },
    getContext: () => null, addEventListener() {}, removeEventListener() {},
  });
  g.document = {
    documentElement: nodo(), body: nodo(), head: nodo(),
    createElement: nodo, addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
  };
  g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.CustomEvent = class { constructor(t, o) { this.type = t; Object.assign(this, o); } };
  g.JxIcon = () => null;
  g.__newId = () => 'id-falso';
  g.__useAuth = () => ({ profile: { rol: 'admin', id: 'u1' }, loading: false });
  g.__hasPerm = () => true;
  g.__fecha = { hoyLocal: () => '2026-09-17' };
  const tabla = () => ({ filter: () => ({ toArray: async () => [] }), toArray: async () => [] });
  g.__db = new Proxy({}, { get: tabla });
  g.__hooks = {
    useCotejoDecisiones: () => ({ data: globalThis.__DECISIONES || [], loading: false }),
    useSunatCortes: () => ({ data: globalThis.__CORTES || [], loading: false }),
  };
}

let Registro;
beforeAll(async () => {
  montarBrowserFalso();
  Registro = await import('../../components/jx-registro-compras-ventas.jsx');
});

afterEach(() => { globalThis.__CORTES = []; globalThis.__DECISIONES = []; });

const render = (movs = [COMPRA, VENTA], extra = {}) => renderToString(
  React.createElement(Registro.RegistroComprasVentas, {
    company: COMPANIES[0], companies: COMPANIES, movs,
    movsPeriodo: movs.filter(m => String(m.date).startsWith('2026-07')),
    movsById: new Map(movs.map(m => [m.id, m])),
    asientos: [], anio: 2026, mes: 7, showToast: () => {}, userId: 'u1',
    ...extra,
  }));

describe('el registro es la hoja de trabajo del mes', () => {
  it('lleva el encabezado del Excel modelo: período, RUC y razón social', () => {
    const html = render();
    expect(html).toContain('REGISTRO DE COMPRAS');
    expect(html).toContain('JULIO DEL 2026');
    expect(html).toContain('20615646505');
    expect(html).toContain('JARVEX INGENIERIA, TECNOLOGIA Y PROYECTOS E.I.R.L.');
  });

  it('muestra el comprobante con sus columnas de código de las Tablas SUNAT', () => {
    const html = render();
    expect(html).toContain('F001');
    expect(html).toContain('00012345');
    expect(html).toContain('TIPO (TABLA 10)');
    expect(html).toContain('TIPO (TABLA 2)');
    expect(html).toContain('20498327031');
  });

  it('cuenta las dos hojas por separado', () => {
    const html = render();
    expect(html).toContain('Compras (1)');
    expect(html).toContain('Ventas (1)');
  });
});

describe('las tres exportaciones conviven', () => {
  it('conserva Excel y PDF, y agrega la del SIRE en .zip', () => {
    const html = render();
    expect(html).toContain('Excel (las dos hojas)');
    expect(html).toContain('PDF de esta hoja');
    // La que se mudó desde la pestaña «Reemplazo SIRE (.zip)».
    expect(html).toContain('Exportar a SIRE (.zip)');
  });

  it('el casillero por comprobante NO estorba hasta que se pide exportar al SIRE', () => {
    // La selección es un modo: sin pedirla, la hoja se lee como una hoja.
    const html = render();
    expect(html).not.toContain('Marcar todos');
    expect(html).not.toContain('Quitar todos');
    expect(html).not.toContain('type="checkbox" checked');
  });
});

describe('el escáner de incoherencias, como ventana y por período', () => {
  it('el botón dice cuántas hay ANTES de abrirlo', () => {
    const html = render([COMPRA, VENTA, VENTA_SIN_ESPEJO]);
    expect(html).toContain('1 incoherencia');
  });

  it('cuenta solo las del período que se está cerrando', () => {
    // La de abril existe y es real, pero no es lo que se está declarando hoy.
    const html = render([COMPRA, VENTA, VENTA_SIN_ESPEJO, VENTA_SIN_ESPEJO_OTRO_MES]);
    expect(html).toContain('1 incoherencia');
    expect(html).not.toContain('2 incoherencias');
  });

  it('cuando no hay nada que mirar lo dice, en vez de invitar a entrar', () => {
    const html = render([COMPRA, VENTA]);
    expect(html).toContain('Sin incoherencias');
  });

  it('arranca cerrado: es una interrupción del trabajo del mes, no un lugar donde se vive', () => {
    const html = render([COMPRA, VENTA, VENTA_SIN_ESPEJO]);
    expect(html).not.toContain('Analizar de nuevo');
  });
});
