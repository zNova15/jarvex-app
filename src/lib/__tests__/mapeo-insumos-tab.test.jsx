// ═══════════════════════════════════════════════════════════════════
// ¿ABRE la pestaña «Mapeo al presupuesto»?
//
// pantallas-montan.test.jsx monta las PANTALLAS registradas, y esta vive
// adentro de Análisis de Insumos como PESTAÑA: la página abre en «Comparador»
// y el cuerpo del mapeo no se renderiza nunca en ese test. O sea que un TDZ
// acá pasaría el green gate exactamente igual que el que dejó Movimientos
// Contables muerto el 3-sep. Este test cierra ese agujero: renderiza el cuerpo
// de la pestaña, vacío y con datos, y verifica que dibuje.
//
// 13-set-2026: la pantalla cambió de pregunta. Ya no mapea DESCRIPCIONES DE
// FACTURA contra el presupuesto —2.220 decisiones que no se terminan nunca—
// sino los insumos del CATÁLOGO de la empresa contra los del presupuesto del
// trabajo, prefiriendo los de la misma clasificación. Los tests siguen ese
// cambio; los datos son los reales de la obra de agua.
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
  // Stub que SÍ pinta la opción elegida: si devolviera null, el test no podría
  // ver qué código se está proponiendo, que es justo lo que hay que verificar.
  g.SearchableSelect = ({ value, options }) =>
    React.createElement('span', { 'data-sel': value || '' },
      (options || []).find(o => o.value === value)?.label || '—');
  const datos = {
    useObras: () => ({ data: [{ id: 'o1', nombre_obra: 'MEJORAMIENTO DEL SERVICIO DE AGUA POTABLE', tipo_trabajo: 'obra_ejecucion' }], loading: false }),
    useConsorcios: () => ({ data: [], loading: false }),
    useInsumosPartida: () => ({ data: globalThis.__PRESUPUESTO_VACIO ? [] : PRESUPUESTO, loading: false }),
    useCatalogoInsumos: () => ({ data: globalThis.__CATALOGO ?? CATALOGO, loading: false, refresh: async () => {} }),
    useClasificacionTerminos: () => ({ data: [], loading: false }),
    useInsumoTrabajoMapeos: () => ({ data: globalThis.__MAPEOS || [], loading: false, refresh: async () => {} }),
    useCompanies: () => ({ data: [{ id: 'gasomi', name: 'GASOMI INGENIEROS E.I.R.L.' }], loading: false }),
  };
  g.__hooks = new Proxy({}, {
    get: (_, k) => datos[k] || (() => ({ data: [], loading: false, refresh: async () => {} })),
  });
}

// Presupuesto textual de producción, recortado.
const PRESUPUESTO = [
  { id: 'a', obra_id: 'o1', insumo_codigo: '210020001', nombre_insumo: 'CEMENTO PORTLAND TIPO I (42.5 kg)', unidad: 'bol', tipo_insumo: 'material', cantidad_presupuestada: 11269.2, costo_presupuestado: 353851 },
  { id: 'b', obra_id: 'o1', insumo_codigo: '30020002', nombre_insumo: 'ACERO CORRUGADO fy = 4200 kg/cm2 GRADO 60', unidad: 'kg', tipo_insumo: 'material', cantidad_presupuestada: 29856, costo_presupuestado: 103600 },
  { id: 'c', obra_id: 'o1', insumo_codigo: '660020050', nombre_insumo: 'TUBERIA PVC UF S25 DE 8"(200mm) x 6m ISO 4435', unidad: 'm', tipo_insumo: 'material', cantidad_presupuestada: 14088.72, costo_presupuestado: 450839 },
];

const cat = (id, nombre, unidad, familia, tipo = 'insumo') => ({
  id, nombre, norm: normMapeo(nombre), unidad, familia, tipo,
  origen: 'xlsx', activo: true, company_id: null,
});

// El catálogo de la empresa, con la clasificación YA decidida.
const CATALOGO = [
  cat('c1', 'CEMENTO PORTLAND TIPO I (42.5 kg)', 'bolsa', '21'),
  // En [72] a propósito: el catálogo dice «redes interiores» y el estándar
  // deriva [66]. Es el cruce entre clasificaciones que se ofrece marcado.
  cat('c2', 'TUBERIA PVC UF S25 DE 8"(200mm) x 6m ISO 4435', 'm', '72'),
  cat('c3', 'GUANTES ANTICORTE', 'par', '83'),
  cat('c4', 'INSUMO RARO QUE NADIE CLASIFICO', 'und', 'sin_clasificar'),
];

let MapeoInsumosTab;
beforeAll(async () => {
  montarBrowserFalso();
  ({ MapeoInsumosTab } = await import('../../components/jx-mapeo-insumos.jsx'));
}, 30000);

const pintar = (props = {}) => renderToString(
  React.createElement(MapeoInsumosTab, { showToast: () => {}, ...props }));

describe('la pestaña de mapeo abre', () => {
  it('con el catálogo vacío no revienta', () => {
    globalThis.__CATALOGO = [];
    expect(() => pintar()).not.toThrow();
    globalThis.__CATALOGO = undefined;
  });

  it('sin presupuesto cargado lo dice, no muestra una tabla vacía sin explicar', () => {
    globalThis.__PRESUPUESTO_VACIO = true;
    const html = pintar();
    globalThis.__PRESUPUESTO_VACIO = false;
    expect(html).toContain('no tiene presupuesto cargado');
  });

  it('nunca imprime «undefined» ni «NaN» en pantalla', () => {
    const h = pintar();
    expect(h).not.toContain('undefined');
    expect(h).not.toContain('NaN');
  });

  it('dice que NO vincula compras — es el cambio de pregunta', () => {
    const h = pintar();
    expect(h).toContain('no se vinculan compras ni facturas');
  });
});

describe('lo primero que se pidió ver: cuánto falta clasificar de los dos lados', () => {
  it('muestra las dos barras, la del trabajo y la de la empresa', () => {
    const h = pintar();
    expect(h).toContain('Insumos del presupuesto de este trabajo');
    expect(h).toContain('Insumos y servicios de la empresa');
    expect(h).toContain('Antes de mapear: ¿está clasificado?');
  });

  it('el catálogo de ejemplo tiene 3 de 4 clasificados y lo dice', () => {
    const h = pintar();
    expect(h).toMatch(/3<!-- --> de <!-- -->4<!-- --> clasificados/);
  });
});

describe('la compuerta de clasificación', () => {
  const h = () => pintar();

  it('el cemento de la empresa encuentra el cemento del presupuesto', () => {
    expect(h()).toContain('data-sel="210020001"');
  });

  it('🔴 la tubería se encuentra AUNQUE los dos lados la clasifiquen distinto', () => {
    // El catálogo la tiene en [72] «redes interiores» y el estándar la deriva
    // a [66] «red de agua potable y alcantarillado». Es la misma tubería. Con
    // la compuerta como muro no se encontraban nunca; como preferencia se
    // ofrece igual, marcada para que alguien la mire.
    const html = h();
    expect(html).toContain('data-sel="660020050"');
    expect(html).toContain('otra clasificación');
  });

  it('🔴 el EPP no recibe nada: en este presupuesto no hay NADA que se le parezca', () => {
    const html = h();
    expect(html).toContain('GUANTES ANTICORTE');
    // No es que se filtre por clasificación: es que el motor no encuentra un
    // solo candidato. Se dice con todas las letras.
    expect(html).toContain('Nada parecido en este presupuesto');
  });

  it('lo que falta clasificar se cuenta aparte y tiene su propio filtro', () => {
    const html = h();
    // La vista «Por decidir» NO los muestra a propósito: no son decidibles
    // hasta que se los clasifique, y mezclarlos sería pedir una decisión
    // imposible. Se cuentan y tienen su filtro.
    expect(html).toContain('falta clasificarlos:');
    expect(html).toContain('Falta clasificar el insumo');
  });

  it('la rama «falta clasificarlo» de la fila se dibuja y no ofrece decidir', async () => {
    const { FilaMapeo } = await import('../../components/jx-mapeo-insumos.jsx');
    const html = renderToString(React.createElement(FilaMapeo, {
      f: {
        norm: 'x', nombre: 'INSUMO RARO QUE NADIE CLASIFICO', unidad: 'und',
        clasificacionNombre: 'Sin clasificar — revisar a mano', tipo: 'insumo',
        estado: 'sin_clasificar', decision: null, presupuesto: null, sug: null,
      },
      opciones: [], elegido: '', onElegir: () => {}, destino: null,
      onAceptar: () => {}, onNoEsta: () => {}, onDeshacer: () => {},
    }));
    expect(html).toContain('Falta clasificarlo');
    expect(html).toContain('no puede compararse con el presupuesto');
    expect(html).not.toContain('Es este');
  });
});

describe('la vista inversa: qué necesita el trabajo', () => {
  it('ofrece la pestaña con la cuenta de cobertura', () => {
    expect(pintar()).toContain('Qué necesita el trabajo');
  });
});

describe('la fila ya decidida (su propia rama, que el filtro por defecto esconde)', () => {
  let FilaMapeo;
  beforeAll(async () => {
    ({ FilaMapeo } = await import('../../components/jx-mapeo-insumos.jsx'));
  });

  const pintarFila = (f) => renderToString(React.createElement(FilaMapeo, {
    f, opciones: [], elegido: '', onElegir: () => {}, destino: null,
    onAceptar: () => {}, onNoEsta: () => {}, onDeshacer: () => {},
  }));

  it('«es este» muestra el insumo del presupuesto y ofrece deshacer', () => {
    const h = pintarFila({
      norm: 'x', nombre: 'CEMENTO PORTLAND TIPO I (42.5 kg)', unidad: 'bolsa',
      clasificacionNombre: '[21] Cemento Portland e hidráulico', tipo: 'insumo',
      estado: 'decididas',
      decision: { decision: 'mapeado', insumo_nombre: 'CEMENTO PORTLAND TIPO I (42.5 kg)', factor: null },
      presupuesto: { nombre: 'CEMENTO PORTLAND TIPO I (42.5 kg)' },
    });
    expect(h).toContain('Deshacer');
    expect(h).not.toContain('undefined');
  });

  it('🔴 decidida contra un insumo del presupuesto que ya no está no revienta', () => {
    // El presupuesto se reimporta y los códigos pueden desaparecer. El nombre
    // congelado en la decisión es lo que salva la fila.
    const h = pintarFila({
      norm: 'y', nombre: 'TUBERIA QUE YA NO ESTA', unidad: 'm',
      clasificacionNombre: '[66] Tubería de PVC', tipo: 'insumo',
      estado: 'decididas',
      decision: { decision: 'mapeado', insumo_nombre: 'TUBERIA VIEJA', factor: null },
      presupuesto: null,
    });
    expect(h).toContain('TUBERIA VIEJA');
    expect(h).not.toContain('undefined');
  });

  it('«no está» se ve resuelta y también ofrece deshacer', () => {
    const h = pintarFila({
      norm: 'z', nombre: 'LAPTOP', unidad: 'und',
      clasificacionNombre: '[93] Bienes y servicios auxiliares', tipo: 'insumo',
      estado: 'decididas',
      decision: { decision: 'no_esta', insumo_codigo: null },
      presupuesto: null,
    });
    expect(h).toContain('No está en el presupuesto de este trabajo');
    expect(h).toContain('Deshacer');
  });
});
