// ═══════════════════════════════════════════════════════════════════
// ¿ABRE la pestaña «Catálogo»? (tanda 14, entrega 2)
//
// Mismo agujero que cerró el test de la pestaña de mapeo:
// `pantallas-montan.test.jsx` monta Análisis de Insumos, pero la página abre
// en «Comparador» y el cuerpo de esta pestaña no se renderiza NUNCA ahí. Un
// TDZ o un `undefined.map` acá pasaría el green gate en verde, igual que el que
// dejó Movimientos Contables muerto el 3-sep. Este test renderiza el cuerpo:
// vacío, con catálogo y con disgregación.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeAll } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

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
  };
  g.__hooks = new Proxy({}, {
    get: (_, k) => datos[k] || (() => ({ data: [], loading: false, refresh: async () => {} })),
  });
}

// Filas como quedan en Dexie después de importar el xlsx real.
const CATALOGO = [
  { id: 'c1', tipo: 'insumo', nombre: 'TUBERIA PVC UF S25 DE 8"(200mm) x 6m ISO 4435', norm: 'tubo pvc uf s 25 de 8 plg 200 mm x 6 m iso 4435', unidad: 'm', familia: 'tuberia_accesorios', origen: 'xlsx', activo: true },
  { id: 'c2', tipo: 'insumo', nombre: 'TRAJE DE PROTECCION TYBEK', norm: 'traje de proteccion tybek', unidad: 'und', familia: 'seguridad', origen: 'xlsx', activo: true },
  { id: 'c3', tipo: 'insumo', nombre: 'RETROEXCAVADORA SOBRE LLANTAS 80-100 HP', norm: 'retroexcavadora sobre llantas 80 100 hp', unidad: 'hm', familia: 'equipos_herramientas', origen: 'xlsx', activo: true },
  { id: 'c4', tipo: 'servicio', nombre: 'ALQUILER DE CAMIONETA 4X4', norm: 'alquiler de camioneta 4 x 4', unidad: 'mes', familia: 'servicios', origen: 'xlsx', activo: true },
  { id: 'c5', tipo: 'insumo', nombre: 'CLAVO 3" QUE YA NO SE USA', norm: 'clavo 3 plg que ya no se usa', unidad: 'kg', familia: 'ferreteria', origen: 'xlsx', activo: false },
  { id: 'c6', tipo: 'insumo', nombre: 'GUANTES ANTICORTE', norm: 'guante anticorte', unidad: 'par', familia: 'seguridad', origen: 'manual', activo: true },
];

const DISGREGACION = [
  {
    id: 'd1', padre_norm: 'acero corrugado fy 4200 kg cm 2 grado 60',
    padre_nombre: 'ACERO CORRUGADO fy = 4200 kg/cm2 GRADO 60', padre_unidad: 'kg',
    hijo_norm: 'acero corrugado de 1_2 plg x 9 m', hijo_nombre: 'ACERO CORRUGADO DE 1/2"x9m',
    hijo_unidad: 'var', factor: 8.946, factor_fuente: 'descripcion',
    nota: 'Ø12.7 mm × 0.994 kg/m × 9 m (largo de la factura)', activo: true,
  },
  {
    id: 'd2', padre_norm: 'acero corrugado fy 4200 kg cm 2 grado 60',
    padre_nombre: 'ACERO CORRUGADO fy = 4200 kg/cm2 GRADO 60', padre_unidad: 'kg',
    hijo_norm: 'acero corrugado de 5_16 plg x 9 m', hijo_nombre: 'ACERO CORRUGADO DE 5/16"x9m',
    hijo_unidad: 'var', factor: null, factor_fuente: null, nota: null, activo: true,
  },
];

let CatalogoCanonicoTab;
beforeAll(async () => {
  montarBrowserFalso();
  ({ CatalogoCanonicoTab } = await import('../../components/jx-catalogo-canonico.jsx'));
}, 30000);

const pintar = () => renderToString(React.createElement(CatalogoCanonicoTab, { showToast: () => {} }));

const conDatos = (cat = CATALOGO, disg = DISGREGACION) => {
  globalThis.__CATALOGO = cat; globalThis.__DISGREGACION = disg;
  try { return pintar(); } finally { globalThis.__CATALOGO = []; globalThis.__DISGREGACION = []; }
};

describe('la pestaña del catálogo abre', () => {
  it('sin catálogo cargado explica qué hacer, no muestra una tabla vacía', () => {
    const h = pintar();
    expect(h).toContain('Todavía no hay catálogo cargado');
    expect(h).toContain('Categorizacion Simple.xlsx');
  });

  it('no revienta con el catálogo cargado', () => {
    expect(() => conDatos()).not.toThrow();
  });

  it('nunca imprime «undefined» ni «NaN» en pantalla', () => {
    const h = conDatos();
    expect(h).not.toContain('undefined');
    expect(h).not.toContain('NaN');
  });
});

describe('lo que la pestaña dibuja', () => {
  it('lista lo activo y esconde lo desactivado hasta que se pide verlo', () => {
    const h = conDatos();
    expect(h).toContain('TUBERIA PVC UF S25');
    expect(h).not.toContain('CLAVO 3&quot; QUE YA NO SE USA');
    // Pero avisa que hay uno guardado apagado.
    expect(h).toContain('Ver los desactivados');
  });

  it('dice a qué inventario iría cada cosa — es el puente que justifica la entrega', () => {
    const h = conDatos();
    expect(h).toContain('EPP');            // el tybek, por familia
    expect(h).toContain('Maquinaria');     // la retroexcavadora, por la unidad `hm`
    expect(h).toContain('Servicio / gasto');
  });

  it('muestra las familias con su conteo, sin las que no tienen nada', () => {
    const h = conDatos();
    expect(h).toContain('Implementos de seguridad');
    expect(h).toContain('Tubería y accesorios');
    expect(h).not.toContain('Agregados');   // ninguna fila activa cae ahí
  });

  it('marca lo corregido a mano para que se vea que la importación no lo pisa', () => {
    expect(conDatos()).toContain('tuyo');
  });

  it('la disgregación muestra el factor con su procedencia', () => {
    const h = conDatos();
    expect(h).toContain('8.946');
    expect(h).toContain('del nombre');
  });

  it('un factor que no se sabe se dice, no se rellena con un número inventado', () => {
    const h = conDatos();
    expect(h).toContain('sin factor');
    expect(h).not.toContain('1 var = 0 kg');
  });
});
