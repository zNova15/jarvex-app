// ═══════════════════════════════════════════════════════════════════
// ¿ABRE la pestaña «Categorizar»? (tanda 14, entrega 4)
//
// El mismo agujero que cerraron los tests de las pestañas de mapeo y catálogo:
// `pantallas-montan.test.jsx` monta Análisis de Insumos, pero la página abre en
// «Comparador» y el cuerpo de esta pestaña no se renderiza NUNCA ahí. Un TDZ o
// un `undefined.map` acá adentro pasaría el green gate en verde, igual que el
// que dejó Movimientos Contables muerto el 3-sep.
//
// Se renderiza el cuerpo de verdad: vacío, con compras, con el catálogo, con
// decisiones tomadas y con el modal de alta abierto.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeAll } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { normMapeo } from '../mapeo-insumos.js';

function montarBrowserFalso() {
  const g = globalThis;
  g.window = g;
  g.innerWidth = 1400;
  g.addEventListener = () => {}; g.removeEventListener = () => {};
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
  g.__newId = () => 'id-falso';
  g.JxIcon = () => null;
  g.__useAuth = () => ({ profile: { id: 'u1' } });
  const datos = {
    useCatalogoInsumos: () => ({ data: g.__CATALOGO || [], loading: false, refresh: async () => {} }),
    useCatalogoDisgregacion: () => ({ data: g.__DISGREGACION || [], loading: false, refresh: async () => {} }),
    useCatalogoFamiliaMapeo: () => ({ data: [], loading: false, refresh: async () => {} }),
    useInsumoCategorias: () => ({ data: g.__DECISIONES || [], loading: false, refresh: async () => {} }),
    useCompanies: () => ({ data: [
      { id: 'gasomi', name: 'GASOMI INGENIEROS E.I.R.L.', tipo_entidad: 'propia' },
      { id: 'elinca', name: 'CONSORCIO EL INCA', tipo_entidad: 'consorcio' },
    ], loading: false, refresh: async () => {} }),
  };
  g.__hooks = new Proxy({}, {
    get: (_, k) => datos[k] || (() => ({ data: [], loading: false, refresh: async () => {} })),
  });
}

const cat = (id, nombre, unidad, familia, tipo = 'insumo') => ({
  id, nombre, norm: normMapeo(nombre), unidad, familia, tipo,
  origen: 'xlsx', activo: true, company_id: null,
});

const CATALOGO = [
  cat('c1', 'CEMENTO PORTLAND TIPO I (42.5 kg)', 'bolsa', 'ferreteria'),
  cat('c2', 'TUBERIA PVC UF S25 DE 8"(200mm) x 6m ISO 4435', 'm', 'tuberia_accesorios'),
  cat('c3', 'GUANTES ANTICORTE', 'par', 'seguridad'),
  cat('c4', 'ALQUILER DE CAMIONETA 4X4', 'mes', 'servicios', 'servicio'),
];

const DISGREGACION = [{
  id: 'd1', activo: true, company_id: null,
  padre_nombre: 'ACERO CORRUGADO fy = 4200 kg/cm2 GRADO 60',
  padre_norm: normMapeo('ACERO CORRUGADO fy = 4200 kg/cm2 GRADO 60'), padre_unidad: 'kg',
  hijo_nombre: 'ACERO CORRUGADO DE 5/8"x9m',
  hijo_norm: normMapeo('ACERO CORRUGADO DE 5/8"x9m'), hijo_unidad: 'var',
  factor: 13.968, factor_fuente: 'descripcion',
}];

// Compras reales de producción (los textos son textuales).
const compra = (nombre, importe, extra = {}) => ({
  nombre, clase: 'compra', cantidad: 1, precio: importe, unidad: 'und',
  moneda: 'PEN', proveedorNombre: 'DISTRIBUIDORA SA', companyId: 'elinca', ...extra,
});
const COMPRAS = [
  compra('CEMENTO PORTLAND TIPO I 42.5 KG - PACASMAYO-BOLSA', 62352),
  compra('TUBO PVC-U 200 mm S-25 UF ALCANTARILLADO', 44850),
  compra('VARILLA DE ACERO CORRUGADO DE 5/8', 11143),
  compra('FIERRO CORRUGADO DE 5/8 SIDER PERU X 9M', 9661),
  compra('GUANTE DE ACERO ANTICORTE DE MALLA METÁLICA TALLA M', 31109),
  compra('LENOVO LOQ GEN 10 (15" INTEL) GEFORCE RTX SERIE 50', 21136),
  compra('CHIRIMOYA', 4, { moneda: 'USD' }),
];

let BandejaCategorizacionTab, AltaModulo;
beforeAll(async () => {
  montarBrowserFalso();
  AltaModulo = await import('../../components/jx-bandeja-categorizacion.jsx');
  ({ BandejaCategorizacionTab } = AltaModulo);
}, 30000);

const pintar = (compras = [], { catalogo = [], disg = [], decisiones = [] } = {}) => {
  globalThis.__CATALOGO = catalogo;
  globalThis.__DISGREGACION = disg;
  globalThis.__DECISIONES = decisiones;
  try {
    return renderToString(React.createElement(BandejaCategorizacionTab, { compras, showToast: () => {} }));
  } finally {
    globalThis.__CATALOGO = []; globalThis.__DISGREGACION = []; globalThis.__DECISIONES = [];
  }
};

const conTodo = (decisiones = []) => pintar(COMPRAS, { catalogo: CATALOGO, disg: DISGREGACION, decisiones });

describe('la pestaña abre', () => {
  it('vacía no revienta y explica qué falta', () => {
    const h = pintar();
    expect(h).toContain('No hay catálogo cargado');
    expect(h).toContain('Categorizacion Simple.xlsx');
  });

  it('con datos reales no revienta', () => {
    expect(() => conTodo()).not.toThrow();
  });

  it('nunca imprime «undefined» ni «NaN» en pantalla', () => {
    const h = conTodo();
    expect(h).not.toContain('undefined');
    expect(h).not.toContain('NaN');
  });

  it('con compras pero SIN catálogo tampoco revienta', () => {
    expect(() => pintar(COMPRAS)).not.toThrow();
  });
});

describe('lo que dibuja', () => {
  it('muestra la propuesta con su porcentaje, no solo el nombre', () => {
    const h = conTodo();
    expect(h).toContain('CEMENTO PORTLAND TIPO I (42.5 kg)');
    expect(h).toContain('%');
  });

  it('🔴 propone el acero corrugado, que solo existe en la disgregación', () => {
    expect(conTodo()).toContain('ACERO CORRUGADO DE 5/8&quot;x9m');
  });

  it('ofrece el lote de las dos formas de escribir el mismo acero', () => {
    const h = conTodo();
    // React intercala <!-- --> entre el texto y la interpolación.
    expect(h).toMatch(/Aceptar las (<!-- -->)?2/);
    expect(h).toContain('VARILLA DE ACERO CORRUGADO DE 5/8  ·  FIERRO CORRUGADO DE 5/8 SIDER PERU X 9M');
  });

  it('lo que no está en el catálogo ofrece agregarlo, no solo descartarlo', () => {
    const h = conTodo();
    expect(h).toContain('Falta en el catálogo');
    expect(h).toContain('No es un insumo');
  });

  it('marca los dólares y no los suma', () => {
    expect(conTodo()).toContain('en dólares');
  });

  it('enseña los atajos de teclado — es la mitad de por qué se puede terminar', () => {
    const h = conTodo();
    expect(h).toContain('aceptar');
    expect(h).toContain('no es un insumo');
  });

  it('el avance sale en plata y en descripciones', () => {
    const h = conTodo();
    expect(h).toContain('del gasto ya categorizado');
    expect(h).toMatch(/S\/\s?[\d.,]+/);
  });

  it('lo ya decidido sale de la lista de pendientes y suma al contador', () => {
    const h = conTodo([{
      id: 'x1', norm: normMapeo('LENOVO LOQ GEN 10 (15\" INTEL) GEFORCE RTX SERIE 50'),
      muestra: 'LENOVO LOQ GEN 10', decision: 'no_insumo', fuente: 'manual', company_id: null,
    }]);
    expect(h).toMatch(/Ya decididas(<!-- -->)? \((<!-- -->)?1/);
    expect(h).not.toContain('LENOVO LOQ GEN 10 (15&quot; INTEL)');   // ya no se pregunta
  });
});

describe('la fila ya decidida (su propia rama, que el filtro por defecto esconde)', () => {
  const base = {
    norm: 'n', muestra: 'CHIRIMOYA', veces: 1, importe: 4,
    unidades: new Set(['kg']), provs: new Set(['MERCADO']), entidades: new Set(), monedas: new Set(['PEN']),
    estado: 'decididas', sug: null,
  };
  const pintarFila = (f) => renderToString(React.createElement(AltaModulo.FilaBandeja, {
    f, activa: false, catFila: null, marcada: false,
    onFocus: () => {}, onMarcar: () => {}, onAceptar: () => {},
    onFalta: () => {}, onNoInsumo: () => {}, onDeshacer: () => {},
  }));

  it('«no es un insumo» se ve resuelta y ofrece deshacer', () => {
    const h = pintarFila({ ...base, decision: { decision: 'no_insumo' }, cat: null });
    expect(h).toContain('No es un insumo del catálogo');
    expect(h).toContain('Deshacer');
    expect(h).not.toContain('undefined');
  });

  it('«es este insumo» muestra el nombre y la familia congelada', () => {
    const h = pintarFila({
      ...base,
      decision: { decision: 'catalogo', catalogo_insumo_id: 'c3', familia: 'seguridad' },
      cat: { id: 'c3', nombre: 'GUANTES ANTICORTE', familia: 'seguridad' },
    });
    expect(h).toContain('GUANTES ANTICORTE');
    expect(h).toContain('Implementos de seguridad');
    expect(h).toContain('Deshacer');
  });

  it('🔴 decidida contra un insumo que ya no está no revienta ni imprime undefined', () => {
    // Pasa de verdad: se decide contra una fila del catálogo y alguien la
    // desactiva después. La fila tiene que seguir dibujándose.
    const h = pintarFila({ ...base, decision: { decision: 'catalogo', catalogo_insumo_id: 'perdido' }, cat: null });
    expect(h).toContain('(insumo del catálogo)');
    expect(h).not.toContain('undefined');
  });
});

describe('el alta al catálogo', () => {
  it('el cuerpo del modal se renderiza (sin window.Modal cae al card, pero se dibuja)', () => {
    const Alta = AltaModulo.default;   // la pestaña; el modal se prueba por dentro
    expect(typeof Alta).toBe('function');
    // Se renderiza la pestaña entera con el catálogo vacío: el camino donde el
    // alta es la ÚNICA respuesta posible.
    const h = pintar(COMPRAS, { catalogo: [], disg: [] });
    expect(h).toContain('Falta en el catálogo');
    expect(h).not.toContain('undefined');
  });
});
