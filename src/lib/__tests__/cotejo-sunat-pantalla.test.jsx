// ═══════════════════════════════════════════════════════════════════
// ¿SOBREVIVE EL COTEJO A CAMBIAR DE PESTAÑA? (tanda 18, entrega B)
//
// El pedido de Gabriel (9-set-2026): «agregué los csv del mes de julio para la
// empresa de Jarvex, luego cambié de pestaña y se borró, ya no me sale lo que
// falta o incoherencias».
//
// La causa era de una línea: los CSV vivían en un `useState` del componente.
// Cambiar de pestaña lo desmonta, y con él se iba el archivo. El arreglo —las
// filas viajan con el corte en la base (mig 202)— se rompe sin que nadie lo
// note si alguien vuelve a poner el archivo en el estado local: `pantallas-
// montan` seguiría en verde y la contadora perdería el trabajo otra vez.
//
// Y del escáner: «no tiene botón para analizar nuevamente. No propone
// soluciones». Acá se verifica que el botón esté, que la solución aparezca
// donde se puede aplicar, y —lo más importante— que NO aparezca donde
// aplicarla sería un error.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

const JARVEX = 'c-jarvex', INCA = 'c-inca';
const COMPANIES = [
  { id: JARVEX, name: 'JARVEX INGENIERIA', ruc: '20615646505', tipo_entidad: 'propia' },
  { id: INCA, name: 'CONSORCIO EL INCA', ruc: '20615346081', tipo_entidad: 'consorcio' },
];

// Las filas tal como quedan guardadas en el corte (ya podadas).
const FILA_QUE_FALTA = {
  linea: 2, fecha: '2026-07-18', tipoCp: '01', tipoNombre: 'factura',
  serie: 'F001', numero: 170359, documento: 'F001-170359',
  contraparteRuc: '20614539756', contraparteNombre: 'FRONTIER S.A.C.',
  base: 14364.07, igv: 2585.53, noGravado: 0, total: 16949.60, moneda: 'PEN',
};
const FILA_QUE_CUADRA = {
  linea: 3, fecha: '2026-07-24', tipoCp: '01', tipoNombre: 'factura',
  serie: 'F001', numero: 6742, documento: 'F001-6742',
  contraparteRuc: '20608291181', contraparteNombre: 'SAUKOS CHICKEN S.A.C',
  base: 166.02, igv: 29.88, noGravado: 0, total: 195.90, moneda: 'PEN',
};

const CORTE = {
  id: 'corte-1', company_id: JARVEX, periodo: '202607', libro: 'compras',
  archivo: 'RC-20615646505-202607-propuesta.csv',
  created_at: '2026-09-09T10:25:00Z',
  filas: [FILA_QUE_FALTA, FILA_QUE_CUADRA], avisos_detalle: [], avisos: 0,
  filas_archivo: 2, resumen: { total: 2, cuadran: 1, brecha: 16949.60 },
};

const MOV_CARGADO = {
  id: 'm-saukos', company_id: JARVEX, clase: 'compra', type: 'cost',
  document_type: 'factura', document_number: 'F001-6742',
  third_party_ruc: '20608291181', third_party_name: 'SAUKOS CHICKEN',
  amount: 195.90, date: '2026-07-24',
};

// Escáner: una venta interna VIVA sin espejo (se puede crear) y una ANULADA
// por su nota de crédito (no se puede ni se debe).
const VENTA_VIVA = {
  id: 'v-viva', company_id: JARVEX, clase: 'venta', type: 'income',
  document_type: 'factura', document_number: 'E001-2',
  third_party_ruc: '20615346081', third_party_name: 'CONSORCIO EL INCA',
  amount: 19028.68, date: '2026-07-06', is_intercompany: true,
  related_company_id: INCA, created_at: '2026-07-06T10:00:00Z',
};
const VENTA_ANULADA = {
  ...VENTA_VIVA, id: 'v-anulada', document_number: 'E001-1', amount: 12920,
};
const NOTA_DE_LA_ANULADA = {
  ...VENTA_ANULADA, id: 'nc-anula', document_type: 'nota_credito',
  amount: -12920, related_movement_id: 'v-anulada',
};
const FACTURA_PROVEEDOR = {
  id: 'f-prov', company_id: JARVEX, clase: 'compra', type: 'cost',
  document_type: 'factura', document_number: 'F748-100',
  third_party_ruc: '20112273922', third_party_name: 'TIENDAS DEL MEJORAMIENTO',
  amount: 1019.90, date: '2026-05-10', created_at: '2026-05-10T10:00:00Z',
};
const NOTA_HUERFANA = {
  id: 'nc-huerfana', company_id: JARVEX, clase: 'compra', type: 'cost',
  document_type: 'nota_credito', document_number: 'F748-7773',
  third_party_ruc: '20112273922', third_party_name: 'TIENDAS DEL MEJORAMIENTO',
  amount: -1019.90, date: '2026-05-12', created_at: '2026-05-12T10:00:00Z',
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
  g.__fecha = { hoyLocal: () => '2026-09-09' };
  const tabla = () => ({ filter: () => ({ toArray: async () => [] }), toArray: async () => [] });
  g.__db = new Proxy({}, { get: tabla });
  g.__hooks = {
    useCotejoDecisiones: () => ({ data: globalThis.__DECISIONES || [], loading: false }),
    useSunatCortes: () => ({ data: globalThis.__CORTES || [], loading: false }),
  };
}

let Pantalla;
beforeAll(async () => {
  montarBrowserFalso();
  Pantalla = await import('../../components/jx-cotejo-sunat.jsx');
});

afterEach(() => { globalThis.__CORTES = []; globalThis.__DECISIONES = []; });

const renderComparativa = (movs = [MOV_CARGADO]) => renderToString(
  React.createElement(Pantalla.ComparativaSunat, {
    company: COMPANIES[0], companies: COMPANIES, movs,
    anio: 2026, mes: 7, showToast: () => {}, userId: 'u1',
  }));

const renderEscaner = (movs) => renderToString(
  React.createElement(Pantalla.EscanerIncoherencias, {
    company: COMPANIES[0], companies: COMPANIES, movs,
    showToast: () => {}, userId: 'u1', empresaFija: null,
  }));

describe('SUNAT vs JARVEX — el corte sobrevive a cambiar de pestaña', () => {
  it('🔴 con el corte guardado, la comparativa aparece sin volver a cargar el CSV', () => {
    globalThis.__CORTES = [CORTE];
    const html = renderComparativa();
    // La factura que SUNAT tiene y JARVEX no: es el resultado del cruce, o sea
    // que las filas guardadas se cruzaron de verdad al montar.
    expect(html).toContain('F001-170359');
    expect(html).toContain('Falta en JARVEX');
    // Y dice de dónde salió y cuándo.
    expect(html).toContain('RC-20615646505-202607-propuesta.csv');
    expect(html).toContain('2 comprobantes');
  });

  it('sin ningún corte guardado, no inventa una tabla vacía', () => {
    globalThis.__CORTES = [];
    const html = renderComparativa();
    expect(html).toContain('sin cargar');
    expect(html).not.toContain('Falta en JARVEX');
  });

  it('el corte de OTRA empresa o de OTRO mes no se muestra acá', () => {
    globalThis.__CORTES = [
      { ...CORTE, id: 'otra', company_id: INCA },
      { ...CORTE, id: 'otromes', periodo: '202606' },
    ];
    const html = renderComparativa();
    expect(html).toContain('sin cargar');
    expect(html).not.toContain('F001-170359');
  });

  it('un corte dado de baja no revive', () => {
    globalThis.__CORTES = [{ ...CORTE, deleted_at: '2026-09-09T11:00:00Z' }];
    expect(renderComparativa()).toContain('sin cargar');
  });

  it('un corte viejo (sin filas) lo dice en vez de mostrarse vacío', () => {
    // Los dos cortes de julio que Gabriel cargó antes de la mig 202 quedaron
    // así: con el resumen y sin la lista.
    globalThis.__CORTES = [{ ...CORTE, filas: [] }];
    const html = renderComparativa();
    expect(html).toContain('guardado sin el detalle');
    expect(html).toContain('Cargá el CSV de nuevo');
  });

  it('el corte se puede quitar y volver a cotejar', () => {
    globalThis.__CORTES = [CORTE];
    const html = renderComparativa();
    expect(html).toContain('Volver a cotejar');
    expect(html).toContain('Quitar');
  });

  it('cuando una factura tiene la serie distinta ofrece botón para reparar en Movimientos Contables', () => {
    const filaSerieDistinta = {
      linea: 4, fecha: '2026-07-20', tipoCp: '01', tipoNombre: 'factura',
      serie: 'FA01', numero: 5101, documento: 'FA01-5101',
      contraparteRuc: '20501234567', contraparteNombre: 'CHIFA MONTEORO',
      base: 113.56, igv: 20.44, noGravado: 0, total: 134.00, moneda: 'PEN',
    };
    const movConSerieMal = {
      id: 'm-chifa', company_id: JARVEX, clase: 'compra', type: 'cost',
      document_type: 'factura', document_number: 'F001-5101',
      third_party_ruc: '20501234567', third_party_name: 'CHIFA MONTEORO',
      amount: 134.00, date: '2026-07-20',
    };
    globalThis.__CORTES = [{
      ...CORTE,
      filas: [filaSerieDistinta],
      resumen: { total: 1, cuadran: 0, brecha: 0 },
    }];
    const html = renderComparativa([movConSerieMal]);
    expect(html).toContain('Serie distinta');
    expect(html).toContain('F001-5101');
    expect(html).toContain('Reparar en Movimientos');
  });
});

describe('El escáner propone soluciones', () => {
  it('tiene el botón de analizar de nuevo', () => {
    expect(renderEscaner([])).toContain('Analizar de nuevo');
  });

  it('🔴 a una venta interna sin espejo le ofrece crear la compra del otro lado', () => {
    const html = renderEscaner([VENTA_VIVA]);
    // El SSR mete un comentario entre el texto y la interpolación, por eso las
    // dos mitades se buscan por separado.
    expect(html).toContain('Crear la compra espejo en');
    expect(html).toContain('Falta el otro lado en CONSORCIO EL INCA');
  });

  it('🔴 a una venta ANULADA no le ofrece nada: no la reclama siquiera', () => {
    // Los dos únicos hallazgos vivos de esa familia el 9-set-2026 eran esto.
    const html = renderEscaner([VENTA_ANULADA, NOTA_DE_LA_ANULADA]);
    expect(html).not.toContain('Crear la compra espejo');
    expect(html).not.toContain('Falta el otro lado');
  });

  it('a una COMPRA interco sin su venta NO le ofrece crear nada, y explica por qué', () => {
    // Del otro lado iría una venta de EL INCA: lleva correlativo propio y se
    // emite. Fabricarla desde acá sería inventar un comprobante.
    const compraInterco = {
      id: 'c-interco', company_id: JARVEX, clase: 'compra', type: 'cost',
      document_type: 'factura', document_number: 'E001-90',
      third_party_ruc: '20615346081', third_party_name: 'CONSORCIO EL INCA',
      amount: 5000, date: '2026-07-06', is_intercompany: true,
      related_company_id: INCA, created_at: '2026-07-06T10:00:00Z',
    };
    const html = renderEscaner([compraInterco]);
    expect(html).toContain('Falta el otro lado en CONSORCIO EL INCA');
    expect(html).not.toContain('Crear la compra espejo');
    expect(html).toContain('lleva su propio correlativo');
  });

  it('a una nota huérfana le propone la factura a la que puede apuntar', () => {
    const html = renderEscaner([FACTURA_PROVEEDOR, NOTA_HUERFANA]);
    expect(html).toContain('Nota de crédito sin factura');
    expect(html).toContain('Enlazar a esta factura');
    expect(html).toContain('F748-100');
    expect(html).toContain('mismo importe');
  });

  it('sin ninguna factura candidata NO ofrece enlazar: manda a buscarla a mano', () => {
    const html = renderEscaner([NOTA_HUERFANA]);
    expect(html).toContain('Nota de crédito sin factura');
    expect(html).not.toContain('Enlazar a esta factura');
    expect(html).toContain('hay que buscarla a mano');
  });
});
