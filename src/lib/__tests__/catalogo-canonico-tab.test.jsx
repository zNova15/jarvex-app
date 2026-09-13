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

// La pestaña abre en «Clasificaciones y diccionario», que es lo que pidió
// Gabriel. La lista plana sigue existiendo como segunda vista; para pintarla
// en un test —renderToString no corre eventos, así que no se puede clickear el
// switch— se le pasa la vista inicial.
const pintar = (vistaInicial) => renderToString(
  React.createElement(CatalogoCanonicoTab, { showToast: () => {}, ...(vistaInicial ? { vistaInicial } : {}) }));

const conVista = (vistaInicial, cat = CATALOGO, disg = DISGREGACION, eq = []) => {
  globalThis.__CATALOGO = cat; globalThis.__DISGREGACION = disg; globalThis.__EQUIVALENCIAS = eq;
  try { return pintar(vistaInicial); } finally { globalThis.__CATALOGO = []; globalThis.__DISGREGACION = []; globalThis.__EQUIVALENCIAS = []; }
};

/** La vista por defecto: clasificaciones + diccionario. */
const conDatosClas = (cat = CATALOGO, disg = DISGREGACION, eq = []) => conVista(undefined, cat, disg, eq);
/** La lista completa de los 483, con su tabla y sus lotes. */
const conDatos = (cat = CATALOGO, disg = DISGREGACION, eq = []) => conVista('lista', cat, disg, eq);

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

describe('la revisión recommendativa del catálogo (IUPC / INEI)', () => {
  const MAL = [
    { id: 'r1', tipo: 'insumo', nombre: 'CEMENTO PORTLAND TIPO I (42.5 kg)', norm: 'cemento portland tipo i 42 5 kg', unidad: 'bolsa', familia: 'ferreteria', origen: 'xlsx', activo: true },
    { id: 'r2', tipo: 'insumo', nombre: 'TRANSPORTE DE RESIDUOS DE OBRA DURANTE LA EJECUCION', norm: 'transporte de residuos de obra durante la ejecucion', unidad: 'glb', familia: 'seguridad', origen: 'xlsx', activo: true },
    { id: 'r3', tipo: 'insumo', nombre: 'CASCOS DE SEGURIDAD', norm: 'casco de seguridad', unidad: 'und', familia: '83', origen: 'xlsx', activo: true },
  ];

  it('avisa cuántos tienen recomendación oficial, con el destino IUPC a la vista', () => {
    const h = conDatos(MAL, []);
    expect(h).toContain('con recomendación de categoría');
    expect(h).toContain('CEMENTO PORTLAND TIPO I');
    expect(h).toContain('Cemento Portland');
    expect(h).toContain('Servicios');
  });

  it('dice cuántas faltan reclasificar del vocabulario viejo', () => {
    // r1 y r2 tienen familia legacy ('ferreteria', 'seguridad'); r3 ya tiene
    // su código IUPC. El contador tiene que decir «faltan 2 de 3».
    expect(conDatos(MAL, [])).toContain('faltan reclasificar');
  });

  it('deja marcar POR BANDA y no ofrece un «marcar todas»', () => {
    // Reclasificar el catálogo entero de un click es justo lo que no se quiere:
    // el lote se acota a lo que el estándar reconoce con confianza alta.
    const h = conDatos(MAL, []);
    expect(h).not.toContain('Marcar todas');
    expect(h).toContain('Marcar las');
  });

  it('las opciones del desplegable de categoría NO salen vacías', () => {
    // El JSX pedía `c.nombreCompleto`, un campo que nunca existió en
    // `listarCategoriasDisponibles()` → 80 opciones en blanco y el
    // desplegable inservible. Esto lo agarra si vuelve a pasar.
    const h = conDatos(MAL, []);
    expect(h).toContain('Acero de construcción corrugado');
    expect(h).toMatch(/<optgroup[^>]*label="[^"]*IUPC del Estado Peruano"/);
    expect(h).not.toMatch(/<option value="[^"]+"><\/option>/);
  });

  it('la fila con familia vieja MUESTRA cuál tiene, deshabilitada', () => {
    // Las 413 filas sin reclasificar tienen un valor que ya no está entre las
    // opciones: sin esto el <select> se vería en blanco y se perdería de vista
    // qué categoría tienen puesta hoy. Se lee, pero no se puede volver a elegir.
    const h = conDatos(MAL, []);
    expect(h).toContain('Categoría actual (vocabulario viejo)');
    expect(h).toMatch(/<option value="ferreteria" disabled/);
  });

  it('lo que está bien puesto con su código oficial NO aparece como recomendación', () => {
    const h = conDatos([MAL[2]], []);
    expect(h).not.toContain('con recomendación de categoría');
  });

  it('lo ya revisado deja de proponerse', () => {
    const h = conDatos([{ ...MAL[0], revisado: true }], []);
    expect(h).not.toContain('con recomendación de categoría');
  });

  it('cumple la regla rectora: una sola clasificación y NO subfamilias', () => {
    const h = conDatos(MAL, []);
    expect(h).not.toContain('Subfamilia');
    expect(h).toContain('Categoría (IUPC / Estándar)');
  });
});

describe('el Catálogo abre en las clasificaciones y su diccionario', () => {
  it('la vista por defecto son las clasificaciones, no la lista plana', () => {
    const h = conDatosClas();
    expect(h).toContain('Clasificaciones y diccionario');
    expect(h).toContain('Insumos y servicios (');
    // El diccionario es el punto de la pantalla; la tabla de 483 filas no.
    expect(h).toContain('diccionario');
  });

  // 13-set: «Categorizar» dejó de ser una pestaña aparte. Las tres vistas
  // —clasificaciones, insumos y servicios, nombres por reconocer— viven en la
  // misma sección, y el encabezado explica por qué sus números no coinciden.
  it('la sección ofrece las TRES vistas y explica los dos números', () => {
    const h = conDatosClas();
    expect(h).toContain('Nombres de factura por reconocer');
    expect(h).toContain('única sección donde se clasifican');
    expect(h).toContain('Nunca van a ser el mismo número');
  });

  it('tiene los DOS árboles: insumos y servicios', () => {
    const h = conDatosClas();
    expect(h).toContain('Insumos');
    expect(h).toContain('Servicios');
    expect(h).toContain('Nueva clasificación');
  });

  it('lista las clasificaciones del árbol de insumos con su código', () => {
    const h = conDatosClas();
    expect(h).toContain('Acero de construcción corrugado');
    expect(h).toContain('Agregado fino');
  });

  it('no revienta ni imprime undefined/NaN en la vista nueva', () => {
    const h = conDatosClas();
    const i = h.indexOf('undefined'); const j = h.indexOf('NaN');
    const ctx = i >= 0 ? h.slice(Math.max(0, i - 300), i + 80) : (j >= 0 ? h.slice(Math.max(0, j - 300), j + 80) : '');
    expect(i, `undefined en: ${ctx}`).toBe(-1);
    expect(j, `NaN en: ${ctx}`).toBe(-1);
  });

  it('cuenta, por clasificación, cuántos insumos y cuántos términos tiene', () => {
    // Los contadores son lo que convierte la lista en algo navegable: se ve de
    // un vistazo dónde hay trabajo y dónde no.
    const h = conDatosClas();
    expect(h).toContain('📦');
    expect(h).toContain('📖');
  });
});
