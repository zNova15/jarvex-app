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
    useCatalogoFamiliaMapeo: () => ({ data: g.__EQUIVALENCIAS || [], loading: false, refresh: async () => {} }),
    useCompanies: () => ({ data: [
      { id: 'gasomi', name: 'GASOMI INGENIEROS E.I.R.L.', tipo_entidad: 'propia' },
      { id: 'elinca', name: 'CONSORCIO EL INCA', tipo_entidad: 'consorcio' },
      { id: 'tercero', name: 'PROVEEDOR CUALQUIERA', tipo_entidad: 'tercero' },
    ], loading: false, refresh: async () => {} }),
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

const conDatos = (cat = CATALOGO, disg = DISGREGACION, eq = []) => {
  globalThis.__CATALOGO = cat; globalThis.__DISGREGACION = disg; globalThis.__EQUIVALENCIAS = eq;
  try { return pintar(); } finally { globalThis.__CATALOGO = []; globalThis.__DISGREGACION = []; globalThis.__EQUIVALENCIAS = []; }
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

describe('el ámbito y las categorías entre entidades (mig 193)', () => {
  const DE_ENTIDADES = [
    ...CATALOGO,
    { id: 'e1', tipo: 'insumo', nombre: 'FIERRO 1/2', norm: 'fierro 1_2', unidad: 'var', familia: 'FIERROS Y ACEROS', origen: 'xlsx', activo: true, company_id: 'gasomi' },
    { id: 'e2', tipo: 'insumo', nombre: 'VARILLA', norm: 'varilla', unidad: 'var', familia: 'perfiles_metalicos', origen: 'xlsx', activo: true, company_id: 'elinca' },
  ];

  it('ofrece el catálogo general y el de cada entidad del grupo, no el de un tercero', () => {
    const h = conDatos(DE_ENTIDADES);
    expect(h).toContain('General del grupo');
    expect(h).toContain('GASOMI INGENIEROS E.I.R.L.');
    expect(h).toContain('CONSORCIO EL INCA');
    expect(h).not.toContain('PROVEEDOR CUALQUIERA');
  });

  it('dice cuántos insumos propios tiene ya cada entidad', () => {
    expect(conDatos(DE_ENTIDADES)).toContain('1 propios');
  });

  it('parado en el general NO se ven los catálogos de las entidades', () => {
    const h = conDatos(DE_ENTIDADES);
    expect(h).not.toContain('FIERRO 1/2');
    expect(h).not.toContain('VARILLA');
  });

  it('la matriz muestra quién usa cada categoría del grupo', () => {
    const h = conDatos(DE_ENTIDADES);
    expect(h).toContain('Cómo le dice cada uno a lo mismo');
    expect(h).toContain('Perfiles y estructuras metálicas');
  });

  it('avisa de las categorías propias que todavía no equivalen a ninguna', () => {
    const h = conDatos(DE_ENTIDADES);
    expect(h).toMatch(/categoría propia todavía no equivale/);
  });

  it('decidida la equivalencia, la categoría propia deja de figurar como pendiente', () => {
    const eq = [{ id: 'm1', company_id: 'gasomi', familia_local: 'FIERROS Y ACEROS', familia_canonica: 'perfiles_metalicos', decision: 'mapeada', updated_at: '2026-09-07' }];
    const h = conDatos(DE_ENTIDADES, DISGREGACION, eq);
    expect(h).not.toMatch(/categoría propia todavía no equivale/);
    expect(h).toContain('FIERROS Y ACEROS');   // sale en la matriz, como alias
  });
});

describe('la revisión del catálogo (mig 194)', () => {
  // Un catálogo con dos cosas mal puestas, como el archivo real.
  const MAL = [
    { id: 'r1', tipo: 'insumo', nombre: 'CEMENTO PORTLAND TIPO I (42.5 kg)', norm: 'cemento portland tipo i 42 5 kg', unidad: 'bolsa', familia: 'ferreteria', origen: 'xlsx', activo: true },
    { id: 'r2', tipo: 'insumo', nombre: 'TRANSPORTE DE RESIDUOS DE OBRA DURANTE LA EJECUCION', norm: 'transporte de residuos de obra durante la ejecucion', unidad: 'glb', familia: 'seguridad', origen: 'xlsx', activo: true },
    { id: 'r3', tipo: 'insumo', nombre: 'CASCOS DE SEGURIDAD', norm: 'casco de seguridad', unidad: 'und', familia: 'seguridad', origen: 'xlsx', activo: true },
  ];

  it('avisa cuántos parecen estar en otra familia, con el destino a la vista', () => {
    const h = conDatos(MAL, []);
    expect(h).toContain('parecen estar en otra familia');
    expect(h).toContain('CEMENTO PORTLAND TIPO I');
    expect(h).toContain('Agregados');
    expect(h).toContain('Servicios');
  });

  it('explica que son propuestas y no errores seguros', () => {
    expect(conDatos(MAL, [])).toContain('No son errores seguros');
  });

  it('lo que está bien puesto NO aparece como recomendación', () => {
    const h = conDatos([MAL[2]], []);
    expect(h).not.toContain('parecen estar en otra familia');
    expect(h).not.toContain('parece estar en otra familia');
  });

  it('lo ya revisado deja de proponerse', () => {
    const h = conDatos([{ ...MAL[0], revisado: true }], []);
    expect(h).not.toContain('parece estar en otra familia');
  });

  it('muestra la subfamilia de cada fila, que es el nivel que faltaba', () => {
    const h = conDatos(MAL, []);
    expect(h).toContain('Subfamilia');
    expect(h).toContain('EPP · cabeza');
  });

  it('deja filtrar por subfamilia y dice cuántas hay en uso', () => {
    const h = conDatos(MAL, []);
    expect(h).toMatch(/Subfamilia <span[^>]*>\(<!-- -->3<!-- --> en uso\)/);
    expect(h).toContain('Transporte y fletes');
  });
});
