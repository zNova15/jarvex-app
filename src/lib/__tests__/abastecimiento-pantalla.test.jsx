// ═══════════════════════════════════════════════════════════════════
// ¿QUÉ DICE la pantalla de Abastecimiento cuando todavía no hay mapeos?
//
// `pantallas-montan.test.jsx` verifica que ABRA, con datos vacíos. Eso no
// alcanza acá: lo que hay que proteger de esta pantalla es que NO MIENTA. Con
// `insumo_mapeo` en 0 filas —que es el estado real de producción al 6-sep-2026—
// la columna «disponible en el grupo» sale en cero para todo, y una tabla de
// ceros se lee como «el grupo no tiene nada» cuando la verdad es «todavía no
// sabemos». Ese cartel es el producto, no un adorno; si alguien lo borra
// refactorizando, este test lo dice.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeAll } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { normMapeo } from '../mapeo-insumos.js';

const OBRA = 'o1';
const EL_INCA = 'c-inca';
const GASOMI = 'c-gasomi';

const PRESUPUESTO = [
  { id: 'ip1', obra_id: OBRA, insumo_codigo: '210020001', nombre_insumo: 'CEMENTO PORTLAND TIPO I (42.5 kg)', unidad: 'bol', cantidad_presupuestada: 11269.16, tipo_insumo: 'material' },
];

const MOVS = [
  {
    id: 'm1', company_id: GASOMI, clase: 'compra', type: 'cost',
    notas: JSON.stringify({ items_factura: [{ descripcion: 'CEMENTO PORTLAND TIPO I', cantidad: 318, unidad: 'und', precio_unitario: 27.5 }] }),
  },
];

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
  g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.JxIcon = () => null;
  g.__newId = () => 'id-falso';
  g.__getObraActivaId = () => OBRA;
  g.__hooks = {
    useObras: () => ({ data: [{ id: OBRA, nombre_obra: 'PLAN MIRAFLORES' }], loading: false }),
    useAccountingMovements: () => ({ data: globalThis.__MOVS || [], loading: false }),
    useInsumoMapeos: () => ({ data: globalThis.__MAPEOS || [], loading: false }),
    useInsumoCorrelaciones: () => ({ data: [], loading: false }),
    useCompanies: () => ({ data: [
      { id: EL_INCA, name: 'CONSORCIO EL INCA' },
      { id: GASOMI, name: 'GASOMI INGENIEROS E.I.R.L.' },
    ], loading: false }),
    useConsorcios: () => ({ data: [{ id: 'k1', obra_id: OBRA, company_id: EL_INCA }], loading: false }),
    useInsumosPartida: () => ({ data: globalThis.__PRESUPUESTO || [], loading: false }),
  };
}

const render = () => renderToString(React.createElement(globalThis.AbastecimientoPage, { showToast: () => {} }));

beforeAll(async () => {
  montarBrowserFalso();
  await import('../../components/jx-abastecimiento.jsx');
});

describe('la pantalla de Abastecimiento', () => {
  it('queda expuesta como window.AbastecimientoPage', () => {
    expect(typeof globalThis.AbastecimientoPage).toBe('function');
  });

  it('sin mapeos AVISA en vez de mostrar ceros como si fueran datos', () => {
    globalThis.__PRESUPUESTO = PRESUPUESTO;
    globalThis.__MOVS = MOVS;
    globalThis.__MAPEOS = [];
    const html = render();
    expect(html).toContain('no hay ningún insumo mapeado al presupuesto');
    expect(html).toContain('Mapeo al presupuesto');
  });

  it('con el mapeo confirmado desaparece el aviso y aparece el stock del grupo', () => {
    globalThis.__PRESUPUESTO = PRESUPUESTO;
    globalThis.__MOVS = MOVS;
    globalThis.__MAPEOS = [{
      id: 'mp1', norm: normMapeo('CEMENTO PORTLAND TIPO I'), decision: 'mapeado',
      insumo_codigo: '210020001', factor: 1, fuente: 'manual', demo: false,
    }];
    const html = render();
    expect(html).not.toContain('no hay ningún insumo mapeado al presupuesto');
    expect(html).toContain('GASOMI INGENIEROS E.I.R.L.');
    expect(html).toContain('318');
  });

  it('avisa cuando una línea mapeada no tiene factor de conversión', () => {
    globalThis.__PRESUPUESTO = PRESUPUESTO;
    globalThis.__MOVS = MOVS;
    globalThis.__MAPEOS = [{
      id: 'mp1', norm: normMapeo('CEMENTO PORTLAND TIPO I'), decision: 'mapeado',
      insumo_codigo: '210020001', factor: null, fuente: 'manual', demo: false,
    }];
    const html = render();
    expect(html).toContain('sin factor de conversión');
  });

  it('nombra a la ejecutora, que es lo que da sentido a las columnas', () => {
    globalThis.__PRESUPUESTO = PRESUPUESTO;
    globalThis.__MOVS = [];
    globalThis.__MAPEOS = [];
    expect(render()).toContain('CONSORCIO EL INCA');
  });

  it('el interruptor de propuestas arranca APAGADO', () => {
    globalThis.__PRESUPUESTO = PRESUPUESTO;
    globalThis.__MOVS = MOVS;
    globalThis.__MAPEOS = [];
    const html = render();
    expect(html).toContain('Incluir propuestas del motor');
    // Sin `checked` en el HTML servidor = arranca apagado.
    expect(html).not.toContain('checked=""');
  });
});
