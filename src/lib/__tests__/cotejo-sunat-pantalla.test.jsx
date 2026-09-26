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
    // El cerco de las operaciones entre empresas: una pata de un par
    // REGISTRADO no se toca desde el escáner. Vacío = nada bloqueado.
    useIntercompanyTransactions: () => ({ data: globalThis.__INTERCO_TX || [], loading: false }),
    useAnticipoAplicaciones: () => ({ data: globalThis.__ANTICIPOS || [], loading: false }),
  };
}

let Pantalla;
beforeAll(async () => {
  montarBrowserFalso();
  Pantalla = await import('../../components/jx-cotejo-sunat.jsx');
});

afterEach(() => {
  globalThis.__CORTES = []; globalThis.__DECISIONES = [];
  globalThis.__INTERCO_TX = []; globalThis.__ANTICIPOS = [];
});

const renderComparativa = (movs = [MOV_CARGADO]) => renderToString(
  React.createElement(Pantalla.ComparativaSunat, {
    company: COMPANIES[0], companies: COMPANIES, movs,
    anio: 2026, mes: 7, showToast: () => {}, userId: 'u1',
  }));

// El render del servidor mete comentarios entre nodos de texto
// (`Dar de baja<!-- --> y su espejo`), asi que las frases se miran en el texto
// plano.
const plano = (html) => html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

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

// ── LOS DOS ARREGLOS QUE FALTABAN (17-set-2026) ────────────────────
// Gabriel, probando la ventana del escáner desde el Registro: «las
// incoherencias me salen en una ventana adicional tal y como lo pedí pero no
// me ofrecen soluciones... si hay facturas duplicadas, permitirme borrar un
// comprobante». Los cuatro hallazgos que estaba mirando —abril de GASOMI, S/
// 54.874 en facturas anuladas que seguían contando— eran justo los dos únicos
// graves que no tenían botón.

const FACTURA_ANULADA_VIVA = {
  id: 'f-koplast', company_id: JARVEX, clase: 'compra', type: 'cost',
  document_type: 'factura', document_number: 'F003-3409',
  third_party_ruc: '20100047218', third_party_name: 'KOPLAST INDUSTRIAL S.A.C',
  amount: 19518.72, date: '2026-04-13', created_at: '2026-04-13T10:00:00Z',
  payment_status: 'pending',
};
const NOTA_QUE_LA_ANULA = {
  ...FACTURA_ANULADA_VIVA, id: 'nc-koplast', document_type: 'nota_credito',
  document_number: 'FC03-187', amount: -19518.72, date: '2026-04-20',
  created_at: '2026-04-20T10:00:00Z', related_movement_id: 'f-koplast',
};

const DUPLICADO_ORIGINAL = {
  id: 'd-1', company_id: JARVEX, clase: 'compra', type: 'cost',
  document_type: 'factura', document_number: 'FF01-11086',
  third_party_ruc: '20602691591', third_party_name: 'AUTOMANIA PERU S.A.C.',
  amount: 330, date: '2026-04-27', created_at: '2026-04-27T10:00:00Z',
};
const DUPLICADO_COPIA = { ...DUPLICADO_ORIGINAL, id: 'd-2', created_at: '2026-04-28T09:00:00Z' };

// 25-set-2026: Gabriel decidió que factura y nota quedan LAS DOS vigentes,
// como en el RCE. La «factura anulada que sigue contando» dejó de ser un
// hallazgo y el botón «Dar de baja» se fue: darla de baja restaba la nota dos
// veces. Lo que se reclama ahora es lo contrario.
describe('Factura y nota de crédito: las dos vigentes', () => {
  it('🔴 la factura anulada por su nota y VIVA ya no es incoherencia ni ofrece darla de baja', () => {
    const html = renderEscaner([FACTURA_ANULADA_VIVA, NOTA_QUE_LA_ANULA]);
    expect(html).not.toContain('Factura anulada que sigue contando');
    expect(html).not.toContain('Dar de baja');
  });

  it('la factura DADA DE BAJA con su nota viva se reclama, sin botón de baja', () => {
    const html = plano(renderEscaner([{ ...FACTURA_ANULADA_VIVA, payment_status: 'cancelled' }, NOTA_QUE_LA_ANULA]));
    expect(html).toContain('Factura dada de baja con su nota de crédito viva');
    expect(html).toContain('las dos quedan vigentes');
    expect(html).not.toContain('Dar de baja');
  });
});

describe('El escáner permite borrar la copia de un comprobante duplicado', () => {
  it('ofrece borrar la copia, y aclara que se queda la original', () => {
    const html = renderEscaner([DUPLICADO_ORIGINAL, DUPLICADO_COPIA]);
    expect(html).toContain('El mismo comprobante, dos veces');
    expect(html).toContain('Borrar esta copia');
    expect(html).toContain('cargó DESPUÉS');
  });

  it('el hallazgo apunta a la COPIA, no a la original: es la que se borra', () => {
    // Si apuntara a la primera, el boton borraria el comprobante que si venia
    // de la captura original.
    const html = renderEscaner([DUPLICADO_ORIGINAL, DUPLICADO_COPIA]);
    expect(html).toContain('FF01-11086');
    expect(html).toContain('está cargado 2 veces');
  });
});

// ── LA ANULACIÓN EN CASCADA (tanda 9, 17-set-2026) — RETIRADA el 25-set ──
// La E001-43 de S/ 9.000 está cargada DOS VECES —venta en una empresa, compra
// en la otra— y la misma nota anula las dos. Con la regla nueva las cuatro
// patas quedan vigentes y no hay nada que reclamar.
const VENTA_ANULADA_INTERCO = {
  id: 'f-venta-43', company_id: JARVEX, clase: 'venta', type: 'income',
  document_type: 'factura', document_number: 'E001-43', date: '2026-07-07',
  amount: 9000, currency: 'PEN', payment_status: 'pending',
  is_intercompany: true, related_movement_id: 'f-compra-43',
  created_at: '2026-07-07T10:00:00Z',
};
const COMPRA_ESPEJO_43 = {
  ...VENTA_ANULADA_INTERCO, id: 'f-compra-43', company_id: INCA,
  clase: 'compra', type: 'cost', payment_status: 'paid',
  related_movement_id: 'f-venta-43',
};
const NOTA_43_VENTA = {
  ...VENTA_ANULADA_INTERCO, id: 'nc-43-v', document_type: 'nota_credito',
  document_number: 'E001-5', date: '2026-07-20', amount: -9000,
  related_movement_id: 'f-venta-43', created_at: '2026-07-20T10:00:00Z',
};
const NOTA_43_COMPRA = {
  ...NOTA_43_VENTA, id: 'nc-43-c', company_id: INCA, clase: 'compra', type: 'cost',
  related_movement_id: 'f-compra-43',
};
const CASCADA = [VENTA_ANULADA_INTERCO, COMPRA_ESPEJO_43, NOTA_43_VENTA, NOTA_43_COMPRA];

describe('Ya no hay baja en cascada ni lote de anuladas', () => {
  it('el par interco anulado por sus notas no ofrece darlo de baja', () => {
    const html = plano(renderEscaner([...CASCADA, FACTURA_ANULADA_VIVA, NOTA_QUE_LA_ANULA]));
    expect(html).not.toMatch(/Dar de baja/);
  });
});
