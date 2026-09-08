// ═══════════════════════════════════════════════════════════════════
// ¿QUÉ MUESTRA la pantalla de Órdenes según por dónde se entró?
//
// `pantallas-montan.test.jsx` verifica que ABRA. Lo que hay que proteger acá es
// otra cosa: que NO OFREZCA un control que no controla nada.
//
// Gabriel, 6-set-2026: «si se ingresa desde CONSORCIO LINKA o desde el trabajo
// de la obra donde LINKA es el ejecutor, debería salirme solamente LINKA, pero
// hay un desplegable que me muestra todas […] y creo que ni siquiera tiene una
// función directa. Si no funciona, deberías quitar eso».
//
// El desplegable volvería solo con cualquier refactor que toque la fila de
// filtros, y volvería SIN QUE NADIE LO NOTE: la pantalla sigue abriendo. Por
// eso el guard es sobre el HTML, no sobre una función.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeAll } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

const OBRA = 'o1';
const EL_INCA = 'c-inca';
const GASOMI = 'c-gasomi';
const JARVEX = 'c-jarvex';

const COMPANIES = [
  { id: EL_INCA, name: 'CONSORCIO EL INCA', ruc: '20615346081' },
  { id: GASOMI, name: 'GASOMI INGENIEROS', ruc: '20601234567' },
  { id: JARVEX, name: 'JARVEX INGENIERIA', ruc: '20615646505' },
];

const MOVS = [
  { id: 'm1', company_id: EL_INCA, clase: 'compra', type: 'cost', amount: 9000, date: '2026-08-01',
    third_party_name: 'FERRETERIA SAN MARTIN SAC', third_party_ruc: '20512345678',
    notas: JSON.stringify({ items_factura: [{ descripcion: 'CEMENTO SOL TIPO I', cantidad: 100, unidad: 'BOL', precio_unitario: 29 }] }) },
  { id: 'm2', company_id: GASOMI, clase: 'compra', type: 'cost', amount: 5000, date: '2026-08-02',
    third_party_name: 'DISTRIBUIDORA ANDINA SRL', third_party_ruc: '20477777777' },
];

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
  g.Modal = () => null;
  g.__newId = () => 'id-falso';
  g.__navTo = () => {};
  g.__useAuth = () => ({ profile: { rol: 'admin', id: 'u1' }, loading: false });
  g.__hasPerm = () => true;
  g.__fecha = { hoyLocal: () => '2026-09-06' };
  // La pantalla lee las órdenes de Dexie en un efecto; renderToString no corre
  // efectos, así que alcanza con que el objeto exista y no reviente.
  const tabla = () => ({ toArray: async () => [], where: () => ({ equals: () => ({ filter: () => ({ toArray: async () => [] }) }) }) });
  g.__db = new Proxy({}, { get: tabla });
  g.__getObraActivaId = () => globalThis.__OBRA_ACTIVA ?? null;
  g.__hooks = {
    useCompanies: () => ({ data: COMPANIES, loading: false }),
    useAccountingMovements: () => ({ data: MOVS, loading: false }),
    useObras: () => ({ data: [{ id: OBRA, nombre_obra: 'MEJORAMIENTO PLAN MIRAFLORES' }], loading: false }),
    useAppConfig: () => ({ data: [], loading: false }),
    useConsorcios: () => ({ data: [{ id: 'k1', obra_id: OBRA, company_id: EL_INCA }], loading: false }),
    useInsumosPartida: () => ({ data: [], loading: false }),
    useInsumoMapeos: () => ({ data: [], loading: false }),
    useCatalogoInsumos: () => ({ data: globalThis.__CATALOGO_ORD || [], loading: false, refresh: async () => {} }),
    useCatalogoDisgregacion: () => ({ data: globalThis.__DISG_ORD || [], loading: false, refresh: async () => {} }),
    resolverConfig: (_cfg, _k, def) => def,
  };
}

const render = () => renderToString(React.createElement(globalThis.OrdenesPage, { showToast: () => {} }));

beforeAll(async () => {
  montarBrowserFalso();
  await import('../../components/jx-ordenes.jsx');
});

describe('la pantalla de Órdenes', () => {
  it('queda expuesta como window.OrdenesPage', () => {
    expect(typeof globalThis.OrdenesPage).toBe('function');
  });

  it('desde el grupo SÍ ofrece elegir la empresa: ahí el filtro sirve', () => {
    globalThis.__plano = 'general';
    globalThis.__OBRA_ACTIVA = null;
    expect(render()).toContain('Todas las empresas');
  });

  it('🔴 dentro de una obra NO hay desplegable de empresas — muestra la ejecutora y basta', () => {
    globalThis.__plano = 'obra';
    globalThis.__OBRA_ACTIVA = OBRA;
    const html = render();
    expect(html).not.toContain('Todas las empresas');
    expect(html).toContain('CONSORCIO EL INCA');
  });

  it('dentro de una obra sigue diciendo en qué ámbito estás y cómo salir', () => {
    globalThis.__plano = 'obra';
    globalThis.__OBRA_ACTIVA = OBRA;
    const html = render();
    expect(html).toContain('MEJORAMIENTO PLAN MIRAFLORES');
    expect(html).toContain('Ver las de todo el grupo');
  });

  it('sin órdenes recibidas no aparece la pestaña del buzón: un buzón vacío que nadie usa es ruido', () => {
    globalThis.__plano = 'general';
    globalThis.__OBRA_ACTIVA = null;
    expect(render()).not.toContain('Recibidas');
  });
});
