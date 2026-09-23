// ═══════════════════════════════════════════════════════════════════
// LA VISTA DE SOBRES DEL SIMULADOR, DIBUJADA DE VERDAD.
//
// Los dos barridos de `pantallas-montan*.test.jsx` no llegan hasta acá: el
// simulador corta en su `SinObraEmpty` cuando no hay obra activa, así que con
// datos vacíos renderiza el string vacío y cualquier cosa que se rompa DENTRO
// de la vista de sobres pasa el gate sin que nada la toque. Eso incluye todo
// lo que se agregó el 22-set-2026 a pedido de Gabriel: el badge de
// clasificación, la tira de grupos y el botón que salta a Partidas.
//
// Este test monta la pantalla CON una obra y con los doce sobres reales de
// Miraflores (leídos de producción el 22-set) y verifica lo que la pantalla
// tiene que DECIR:
//
//  1. que se pueda bajar (la raíz trae el scrollport),
//  2. que cada sobre diga QUÉ ES —de ahí salen los grupos por proveedor—,
//  3. que ofrezca ir a corregir el desglose que falta.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeAll } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

const OBRA = 'o1';
const EL_INCA = 'c-inca';

// Los sobres tal como están en el expediente: unidad `glb` o `%mo`, que es lo
// que los hace sobres, y el nombre sin retocar.
const sobre = (id, nombre, unidad, tipo = 'material', precio = 1000) => ({
  id, obra_id: OBRA, partida_id: 'p1', nombre_insumo: nombre, unidad,
  tipo_insumo: tipo, cantidad_presupuestada: 1, precio_presupuestado: precio,
});

const PRESUPUESTO = [
  sobre('s1', 'ACARREO DE MATERIAL A MANO O ACEMILA AGUA PC Y SC', 'glb', 'material', 152031.1),
  sobre('s2', 'HERRAMIENTAS MANUALES', '%mo', 'equipo', 132492.92),
  sobre('s3', 'FLETE TERRESTRE SANEAMIENTO PM YSC', 'glb', 'material', 59742.27),
  sobre('s4', 'PUBLICACIONES', 'glb', 'material', 250),
];

const PARTIDAS = [{
  id: 'p1', obra_id: OBRA, codigo_delfin: '01.01.01', nombre_partida: 'ACARREO DE MATERIAL',
  fecha_inicio_planificada: '2026-06-01', fecha_fin_planificada: '2026-08-30',
}];

function montarBrowserFalso() {
  const store = {};
  const g = globalThis;
  g.window = g;
  g.innerWidth = 1400;
  g.location = { href: 'http://localhost/', hash: '', search: '' };
  g.addEventListener = () => {}; g.removeEventListener = () => {}; g.dispatchEvent = () => {};
  g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  g.getComputedStyle = () => ({ getPropertyValue: () => '' });
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
  g.CustomEvent = class { constructor(t, o) { this.type = t; Object.assign(this, o); } };
  g.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  g.JxIcon = () => null;
  g.SinObraEmpty = () => null;
  g.__newId = () => 'id-falso';
  g.__getObraActivaId = () => OBRA;
  g.__useAuth = () => ({ profile: { rol: 'admin', id: 'u1' }, loading: false });
  g.__hasPerm = () => true;
  g.__fecha = { hoyLocal: () => '2026-09-22', horaLocal: () => '12:00', getTZ: () => 'America/Lima' };
  const vacio = { data: [], loading: false, error: null, refetch: () => {} };
  const hooks = {
    useObras: () => ({ ...vacio, data: [{ id: OBRA, nombre_obra: 'PLAN MIRAFLORES', fecha_inicio: '2026-06-01', fecha_fin_estimada: '2026-12-30' }] }),
    useCompanies: () => ({ ...vacio, data: [{ id: EL_INCA, name: 'CONSORCIO EL INCA' }] }),
    useConsorcios: () => ({ ...vacio, data: [{ id: 'k1', obra_id: OBRA, company_id: EL_INCA }] }),
    useInsumosPartida: () => ({ ...vacio, data: PRESUPUESTO }),
    usePartidas: () => ({ ...vacio, data: PARTIDAS }),
    useClasificacionTerminos: () => ({ ...vacio, data: globalThis.__TERMINOS || [] }),
  };
  g.__hooks = new Proxy(hooks, { get: (t, k) => (k in t ? t[k] : () => vacio) });
}

const render = () => renderToString(React.createElement(globalThis.SimuladorOrdenesPage, {
  showToast: () => {}, vistaInicial: 'sobres',
}));

let html = '';
beforeAll(async () => {
  montarBrowserFalso();
  await import('../../components/jx-simulador-ordenes.jsx');
  html = render();
});

describe('la vista de sobres del simulador', () => {
  it('se puede bajar: la raíz trae el scrollport', () => {
    // La queja de Gabriel del 22-set. El shell de la app es overflow:hidden,
    // así que sin `.page-wrap` en la raíz la pantalla no scrollea y no hay
    // forma de llegar al sobre número 12.
    expect(html).toMatch(/^<div class="page-wrap"/);
  });

  it('dibuja los sobres del expediente', () => {
    expect(html).toContain('HERRAMIENTAS MANUALES');
    expect(html).toContain('PUBLICACIONES');
  });

  it('cada sobre dice QUÉ ES, no solo en qué cajón cae', () => {
    // Los tres cuelgan de «servicios»/«herramientas» para el simulador, pero
    // se le compran a tres proveedores distintos: transportista, ferretería
    // e imprenta. Ese es el dato que el badge pone en pantalla.
    expect(html).toContain('Flete y transporte');
    expect(html).toContain('Herramienta manual');
    expect(html).toMatch(/publicaciones/i);
  });

  it('muestra los grupos, que es para lo que sirve clasificar', () => {
    expect(html).toContain('de acá salen los grupos que se le pueden pedir a un mismo proveedor');
  });

  it('ofrece ir a corregir el desglose que le falta a la partida', () => {
    expect(html).toContain('Corregir en Partidas');
  });

  it('el diccionario propio llega hasta la pantalla', () => {
    // La pantalla no clasifica por su cuenta: le pasa al motor los términos
    // que Gabriel escribió en el Catálogo. Si ese cable se corta, el sobre
    // sigue mostrando la clasificación de la norma y la corrección deliberada
    // no se ve en ningún lado.
    //
    // OJO con el caso elegido: un nombre que coincide EXACTO con el árbol
    // oficial (`PUBLICACIONES` → S12, capa `oficial-exacto`) NO se pisa ni
    // con un término propio; eso es del clasificador y es anterior a esta
    // pantalla. Por eso se prueba con un nombre de expediente, que es donde
    // el diccionario propio manda.
    globalThis.__TERMINOS = [{ termino: 'FLETE TERRESTRE SANEAMIENTO PM YSC', clasificacion_codigo: '37' }];
    try {
      const conTermino = render();
      // Ese flete pasa a contarse con las herramientas: ahora son DOS sobres
      // de herramienta manual y uno solo de flete.
      expect(conTermino).toContain('title="2 sobre(s) · S/ 192,235.19"');
    } finally {
      globalThis.__TERMINOS = [];
    }
  });
});
