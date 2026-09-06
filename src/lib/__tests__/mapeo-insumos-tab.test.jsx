// ═══════════════════════════════════════════════════════════════════
// ¿ABRE la pestaña «Mapeo al presupuesto»?
//
// pantallas-montan.test.jsx monta las PANTALLAS registradas, y esta vive
// adentro de Análisis de Insumos como PESTAÑA: la página abre en «Comparador»
// y el cuerpo del mapeo no se renderiza nunca en ese test. O sea que un TDZ
// acá pasaría el green gate exactamente igual que el que dejó Movimientos
// Contables muerto el 3-sep. Este test cierra ese agujero: renderiza el cuerpo
// de la pestaña, vacío y con datos, y verifica que dibuje.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeAll } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { claveMapeo } from '../mapeo-insumos.js';

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
  // Stub que SÍ pinta la opción elegida: si devolviera null, el test no podría
  // ver qué código se está proponiendo, que es justo lo que hay que verificar.
  g.SearchableSelect = ({ value, options }) =>
    React.createElement('span', { 'data-sel': value || '' },
      (options || []).find(o => o.value === value)?.label || '—');
  const datos = {
    useInsumoMapeos: () => ({ data: globalThis.__FILAS_MAPEO || [], loading: false, create: async () => {}, update: async () => {} }),
    useObras: () => ({ data: [{ id: 'o1', nombre_obra: 'MIRAFLORES' }], loading: false }),
    useInsumosPartida: () => ({ data: globalThis.__PRESUPUESTO_VACIO ? [] : PRESUPUESTO, loading: false }),
  };
  g.__hooks = new Proxy({}, {
    get: (_, k) => datos[k] || (() => ({ data: [], loading: false, create: async () => {}, update: async () => {} })),
  });
}

// Presupuesto textual de producción, recortado.
const PRESUPUESTO = [
  { id: 'a', obra_id: 'o1', insumo_codigo: '210020001', nombre_insumo: 'CEMENTO PORTLAND TIPO I (42.5 kg)', unidad: 'bol', tipo_insumo: 'material', cantidad_presupuestada: 11269.2 },
  { id: 'b', obra_id: 'o1', insumo_codigo: '30020002', nombre_insumo: 'ACERO CORRUGADO fy = 4200 kg/cm2 GRADO 60', unidad: 'kg', tipo_insumo: 'material', cantidad_presupuestada: 29856 },
  { id: 'c', obra_id: 'o1', insumo_codigo: '660020050', nombre_insumo: 'TUBERIA PVC UF S25 DE 8"(200mm) x 6m ISO 4435', unidad: 'm', tipo_insumo: 'material', cantidad_presupuestada: 14088.72 },
];

// Compras como las entrega extraerComprasDeFacturas().
const COMPRAS = [
  { nombre: 'CEMENTO PORTLAND TIPO I 425 KG - PACASMAYO-BOLSA', cantidad: 2250, precio: 27.71, unidad: 'und', proveedorNombre: 'GASOMI', clase: 'compra' },
  { nombre: 'VARILLA DE ACERO CORRUGADO DE 1/2', cantidad: 592, precio: 29.4, unidad: 'und', proveedorNombre: 'GASOMI', clase: 'compra' },
  { nombre: 'POR EL SERVICIO DE TRANSPORTE DE TUBO HOPE 100', cantidad: 1, precio: 3000, unidad: 'und', proveedorNombre: 'X', clase: 'compra' },
  { nombre: 'LENOVO LOQ GEN 10 (15" INTEL)', cantidad: 2, precio: 5284, unidad: 'und', proveedorNombre: 'SIGLO XXII', clase: 'compra' },
];

let MapeoInsumosTab;
beforeAll(async () => {
  montarBrowserFalso();
  ({ MapeoInsumosTab } = await import('../../components/jx-mapeo-insumos.jsx'));
}, 30000);

const pintar = (props) => renderToString(React.createElement(MapeoInsumosTab, { showToast: () => {}, ...props }));

describe('la pestaña de mapeo abre', () => {
  it('sin una sola compra', () => {
    expect(() => pintar({ compras: [], grupoDe: new Map() })).not.toThrow();
  });
  it('sin grupos de correlación (grupoDe puede venir vacío o nulo)', () => {
    expect(() => pintar({ compras: COMPRAS, grupoDe: null })).not.toThrow();
  });
  it('sin presupuesto cargado lo dice, no muestra una tabla vacía sin explicar', () => {
    globalThis.__PRESUPUESTO_VACIO = true;
    const html = pintar({ compras: COMPRAS, grupoDe: new Map() });
    globalThis.__PRESUPUESTO_VACIO = false;
    expect(html).toContain('no tiene presupuesto cargado');
  });
});

describe('lo que la pestaña efectivamente dibuja', () => {
  const html = () => pintar({ compras: COMPRAS, grupoDe: new Map() });

  it('ordena por plata: el cemento (S/ 62 mil) va antes que las laptops', () => {
    const h = html();
    expect(h.indexOf('CEMENTO PORTLAND TIPO I 425 KG')).toBeGreaterThan(-1);
    expect(h.indexOf('CEMENTO PORTLAND TIPO I 425 KG')).toBeLessThan(h.indexOf('LENOVO LOQ'));
  });
  it('propone el código canónico del cemento y muestra a cuánto equivale', () => {
    const h = html();
    expect(h).toContain('CEMENTO PORTLAND TIPO I (42.5 kg)');
    expect(h).toContain('data-sel="210020001"');
    expect(h).toContain('bol');            // 2.250 und de factura = 2.250 bolsas
  });
  it('propone el código a granel del acero, no un código de tubería', () => {
    expect(html()).toContain('data-sel="30020002"');
  });
  it('lo que no está en el presupuesto no recibe propuesta y el botón queda apagado', () => {
    const h = html();
    expect(h).toContain('LENOVO LOQ');
    expect(h).toContain('disabled');
  });
  it('el factor del acero sale con su cuenta a la vista y marcado como supuesto', () => {
    const h = html();
    expect(h).toContain('8.946');           // 12,7 mm × 0,994 kg/m × 9 m
    expect(h).toContain('supuesto');        // el largo de 9 m no lo dice la factura
  });
  it('los servicios quedan aparte y NO estorban en «Por decidir»', () => {
    const h = html();
    // El transporte no aparece en la lista de trabajo; sí en su propio filtro.
    expect(h).not.toContain('SERVICIO DE TRANSPORTE DE TUBO HOPE');
    expect(h).toMatch(/Servicios<!-- --> <span style="opacity:0.7">\(<!-- -->1/);
  });
  it('muestra el avance en plata, no solo en cantidad de filas', () => {
    expect(html()).toMatch(/del gasto en compras ya está mapeado/);
  });
  it('una descripción ya decidida se pinta decidida y NO vuelve a preguntar', () => {
    globalThis.__FILAS_MAPEO = [{
      id: 'm1', norm: claveMapeo('CEMENTO PORTLAND TIPO I 425 KG - PACASMAYO-BOLSA'),
      decision: 'mapeado', insumo_codigo: '210020001', factor: 1, unidad_destino: 'bol',
      fuente: 'manual', demo: false,
    }];
    const h = pintar({ compras: COMPRAS, grupoDe: new Map() });
    globalThis.__FILAS_MAPEO = [];
    // Sale de la lista de trabajo y suma al avance en plata.
    expect(h).not.toContain('CEMENTO PORTLAND TIPO I 425 KG - PACASMAYO-BOLSA');
    expect(h).toContain('1<!-- --> descripciones decididas');
    expect(h).toContain('del gasto en compras ya está mapeado');
  });
  it('nunca imprime «undefined» ni «NaN» en pantalla', () => {
    const h = html();
    expect(h).not.toContain('undefined');
    expect(h).not.toContain('NaN');
  });
});
