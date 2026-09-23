// ═══════════════════════════════════════════════════════════════════
// La vista «Clasificación de los insumos» dentro de Insumos por Partida.
//
// La lógica está testeada aparte (`clasificacion-presupuesto.test.js`). Lo que
// falta cubrir es que la PANTALLA abra: es nueva, es la primera que Gabriel va
// a mirar, y `pantallas-montan` solo la monta en su vista de siempre — la de
// clasificación ni se dibuja si nadie prende el toggle.
//
// OJO CON EL ALCANCE: `renderToString` no corre efectos. `InsumosPage` resuelve
// la obra activa en uno, así que montada entera nunca pasa de su «Cargando
// insumos…» — por eso se monta el PANEL, que recibe la obra por prop. Lo que
// se cubre es el armado (que se dibuje, que diga qué hace mientras lee, que
// ofrezca el paso a lo comprado); la tabla con datos vive de
// `resumirInsumosDePresupuesto`, testeada contra los nombres reales.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeAll } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

const OBRA = 'o1';

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
  g.SinObraEmpty = () => null;
  g.__newId = () => 'id-falso';
  g.__getObraActivaId = () => OBRA;
  g.__useAuth = () => ({ profile: { rol: 'admin', id: 'u1' }, loading: false });
  g.__fecha = { hoyLocal: () => '2026-09-22', getTZ: () => 'America/Lima' };
  g.__db = {
    insumos_partida: { where: () => ({ equals: () => ({ filter: () => ({ toArray: async () => [] }) }) }) },
  };
  const vacio = { data: [], loading: false, error: null, refresh: () => {} };
  g.__hooks = new Proxy({
    usePartidas: () => ({ ...vacio, data: [{ id: 'p1', obra_id: OBRA, codigo_delfin: '01.01', nombre_partida: 'MUROS' }] }),
  }, { get: (t, k) => (k in t ? t[k] : () => vacio) });
}

let Panel = null;
const render = (props = {}) => renderToString(
  React.createElement(Panel, { obraId: OBRA, showToast: () => {}, ...props })
);

beforeAll(async () => {
  montarBrowserFalso();
  const mod = await import('../../components/jx-gestion.jsx');
  Panel = mod.ClasificacionPresupuesto;
});

describe('el panel de clasificación del presupuesto', () => {
  it('se monta sin reventar', () => {
    expect(() => render()).not.toThrow();
  });

  it('mientras lee el presupuesto lo DICE, en vez de mostrar una tabla vacía', () => {
    // Una tabla vacía se lee como «no hay nada que clasificar», que es
    // exactamente lo contrario de lo que pasa.
    expect(render()).toContain('Leyendo el presupuesto');
  });

  it('sin obra no intenta leer nada', () => {
    expect(() => render({ obraId: null })).not.toThrow();
  });
});
