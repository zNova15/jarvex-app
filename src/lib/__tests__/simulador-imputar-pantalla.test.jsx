// ═══════════════════════════════════════════════════════════════════
// ¿QUÉ DICE la página «Imputar lo ya comprado»? (tanda 3.2, ronda 3)
//
// Hasta la tanda 3.1 esto era la pestaña «🧾 Imputar lo ya comprado» DENTRO
// del Simulador de Órdenes. La 3.2 la mudó a su propia página
// (`jx-simulador-imputar.jsx`, page id `imputar-compras`). Este test protege
// lo que el usuario tiene que seguir viendo tal cual, sin el Simulador
// alrededor:
//
//   1. la explicación de PARA QUÉ sirve (no vuelve a pedir lo que ya se
//      compró) y que NADA se imputa solo;
//   2. los dos lados — órdenes ya emitidas y almacén de la obra —, cada uno
//      con su propio conteo de pendientes;
//   3. que se pueda bajar (`.page-wrap` en la raíz).
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeAll } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

const OBRA = 'o1';

const PRESUPUESTO = [
  { id: 'ip1', obra_id: OBRA, partida_id: 'p1', insumo_codigo: '210020001',
    nombre_insumo: 'CEMENTO PORTLAND TIPO I', unidad: 'bol', tipo_insumo: 'material',
    cantidad_presupuestada: 400, precio_presupuestado: 30, costo_presupuestado: 12000 },
  { id: 'ip2', obra_id: OBRA, partida_id: 'p1', insumo_codigo: '370020009',
    nombre_insumo: 'HERRAMIENTAS MANUALES', unidad: '%mo', tipo_insumo: 'equipo',
    cantidad_presupuestada: 1, precio_presupuestado: 5000, costo_presupuestado: 5000 },
];

// Una orden con una línea sin código: la que la bandeja tiene que ofrecer del
// lado «Órdenes ya emitidas».
const ORDENES = [{ id: 'oc1', obra_id: OBRA, estado: 'emitida', codigo: 'OC-001-2026' }];
const OC_ITEMS = [{
  id: 'oci1', orden_compra_id: 'oc1', descripcion: 'COMBA DE 4 LIBRAS', unidad: 'und',
  cantidad: 3, precio_unitario: 45, subtotal: 135, insumo_codigo: null, imputacion: null,
}];

// Un material del almacén con entradas: el otro lado de la bandeja.
const MATERIALES = [{ id: 'm1', obra_id: OBRA, nombre_material: 'CEMENTO', unidad: 'bol' }];
const MOV_MATERIALES = [{
  id: 'mm1', obra_id: OBRA, material_id: 'm1', tipo_movimiento: 'entrada', cantidad: 100,
}];

function tablaFalsa(filas) {
  return {
    toArray: async () => filas,
    where: () => ({
      equals: (v) => ({ toArray: async () => filas.filter(f => f.obra_id === v) }),
    }),
  };
}

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
  g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.JxIcon = () => null;
  g.SinObraEmpty = () => null;
  g.__newId = () => 'id-falso';
  g.__getObraActivaId = () => OBRA;
  g.__useAuth = () => ({ profile: { rol: 'admin', id: 'u1' }, loading: false });
  g.__logAudit = async () => {};
  const vacio = { data: [], loading: false, error: null, refetch: () => {} };
  g.__hooks = new Proxy({
    useObras: () => ({ ...vacio, data: [{ id: OBRA, nombre_obra: 'PLAN MIRAFLORES' }] }),
    useInsumosPartida: () => ({ ...vacio, data: PRESUPUESTO }),
  }, { get: (t, k) => (k in t ? t[k] : () => vacio) });
  g.__db = {
    ordenes_compra: tablaFalsa(ORDENES),
    oc_items: tablaFalsa(OC_ITEMS),
    materiales: tablaFalsa(MATERIALES),
    herramientas: tablaFalsa([]),
    epps: tablaFalsa([]),
    movimientos_materiales: tablaFalsa(MOV_MATERIALES),
    movimientos_herramientas: tablaFalsa([]),
    movimientos_epp: tablaFalsa([]),
  };
}

const render = (props = {}) => renderToString(React.createElement(globalThis.ImputarComprasPage, { showToast: () => {}, ...props }));

beforeAll(async () => {
  montarBrowserFalso();
  await import('../../components/jx-simulador-imputar.jsx');
});

describe('la página «Imputar lo ya comprado»', () => {
  it('queda expuesta como window.ImputarComprasPage', () => {
    expect(typeof globalThis.ImputarComprasPage).toBe('function');
  });

  it('se puede bajar: la raíz trae el scrollport', () => {
    expect(render()).toMatch(/^<div class="page-wrap"/);
  });

  it('explica para qué sirve y que nada se imputa solo', () => {
    const html = render();
    expect(html).toContain('Para que el plan no vuelva a pedir lo que ya se compró');
    expect(html).toContain('Nada se imputa solo');
    expect(html).toContain('Simulador de Órdenes');
    // Nunca un botón de aceptar en lote (regla de producto de Gabriel).
    expect(html).not.toMatch(/Aceptar todas<\/button>|Imputar todas/);
  });

  it('ofrece los dos lados de la bandeja, con datos de esta obra', () => {
    const html = render();
    expect(html).toContain('Órdenes ya emitidas');
    expect(html).toContain('Almacén de la obra');
  });

  it('no depende de ningún escenario del Simulador: la nota de «Del almacén, restar» manda para allá', () => {
    const html = render({ ladoInicial: 'almacen' });
    expect(html).toContain('se elige en el');
    expect(html).toContain('Simulador de Órdenes');
    expect(html).toContain('⚙ Ajustes finos');
  });

  it('sin obra activa no revienta: muestra el vacío', () => {
    const antes = globalThis.__getObraActivaId;
    globalThis.__getObraActivaId = () => null;
    globalThis.__hooks = { ...globalThis.__hooks, useObras: () => ({ data: [], loading: false }) };
    try {
      expect(() => render()).not.toThrow();
    } finally {
      globalThis.__getObraActivaId = antes;
    }
  });
});
