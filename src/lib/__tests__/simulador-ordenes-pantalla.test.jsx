// ═══════════════════════════════════════════════════════════════════
// ¿QUÉ DICE la pantalla del Simulador de Órdenes?
//
// `pantallas-montan.test.jsx` verifica que ABRA con datos vacíos. Lo que hay
// que proteger acá es otra cosa: que NO PROMETA de más. Esta pantalla muestra
// un plan de compras de millones de soles armado por un motor, y tiene tres
// frenos que son el producto, no un adorno:
//
//   1. la cobertura va contra el presupuesto COMPRABLE, no contra el total
//      (el 47% de Miraflores es planilla y nunca se cubre con órdenes);
//   2. la mano de obra dice, con todas las letras, que NO genera ningún
//      registro — ni un alta, ni un pedido a RRHH, ni una orden;
//   3. nada de lo que se acepte es todavía un documento.
//
// Si alguien los borra refactorizando, este test lo dice.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeAll } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

const OBRA = 'o1';
const EL_INCA = 'c-inca';

const PARTIDAS = [
  { id: 'pa1', obra_id: OBRA, codigo: '01.01', descripcion: 'MUROS DE LADRILLO',
    fecha_inicio_planificada: '2026-10-05', fecha_fin_planificada: '2026-10-22' },
  { id: 'pa2', obra_id: OBRA, codigo: '01.02', descripcion: 'INSTALACIONES',
    fecha_inicio_planificada: '2026-11-03', fecha_fin_planificada: '2026-11-28' },
  // Sin fechas: su línea tiene que salir por «Sin planificar», no repartida a ojo.
  { id: 'pa3', obra_id: OBRA, codigo: '01.03', descripcion: 'VARIOS' },
];

const PRESUPUESTO = [
  { id: 'ip1', obra_id: OBRA, partida_id: 'pa1', insumo_codigo: '210020001',
    nombre_insumo: 'CEMENTO PORTLAND TIPO I', unidad: 'bol', tipo_insumo: 'material',
    cantidad_presupuestada: 400, precio_presupuestado: 30, costo_presupuestado: 12000 },
  { id: 'ip2', obra_id: OBRA, partida_id: 'pa2', insumo_codigo: '210030001',
    nombre_insumo: 'TUBERIA PVC 4"', unidad: 'm', tipo_insumo: 'material',
    cantidad_presupuestada: 500, precio_presupuestado: 12, costo_presupuestado: 6000 },
  // Un sobre: el expediente aparta plata sin decir qué se compra (§4.1).
  { id: 'ip3', obra_id: OBRA, partida_id: 'pa1', insumo_codigo: null,
    nombre_insumo: 'HERRAMIENTAS MANUALES', unidad: '%mo', tipo_insumo: 'equipo',
    cantidad_presupuestada: 1, precio_presupuestado: 5000, costo_presupuestado: 5000 },
  // Mano de obra: NO se compra. Nunca puede salir como una orden.
  { id: 'ip4', obra_id: OBRA, partida_id: 'pa1', insumo_codigo: '470010001',
    nombre_insumo: 'PEON', unidad: 'hh', tipo_insumo: 'mano_obra',
    cantidad_presupuestada: 8000, precio_presupuestado: 20, costo_presupuestado: 160000 },
  // Sin fecha de partida → «Sin planificar» con su motivo.
  { id: 'ip5', obra_id: OBRA, partida_id: 'pa3', insumo_codigo: '210040001',
    nombre_insumo: 'ARENA GRUESA', unidad: 'm3', tipo_insumo: 'material',
    cantidad_presupuestada: 50, precio_presupuestado: 40, costo_presupuestado: 2000 },
];

const PERSONAL = [
  { id: 'pe1', obra_id: OBRA, nombre_completo: 'JUAN PEREZ', cargo: 'PEON', estado: 'activo' },
  { id: 'pe2', obra_id: OBRA, nombre_completo: 'LUIS RAMOS', cargo: 'Subcontrato MOSHCO', estado: 'activo' },
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
  g.SinObraEmpty = () => null;
  g.__newId = () => 'id-falso';
  g.__getObraActivaId = () => OBRA;
  g.__fecha = { hoyLocal: () => '2026-10-01', getTZ: () => 'America/Lima' };
  g.__hooks = {
    useObras: () => ({ data: [{ id: OBRA, nombre_obra: 'PLAN MIRAFLORES', fecha_inicio: '2026-04-30', fecha_fin_estimada: '2026-12-30' }], loading: false }),
    useCompanies: () => ({ data: [{ id: EL_INCA, name: 'CONSORCIO EL INCA', rubro: 'ejecutora_obra' }], loading: false }),
    useConsorcios: () => ({ data: [{ id: 'k1', obra_id: OBRA, company_id: EL_INCA }], loading: false }),
    useInsumosPartida: () => ({ data: PRESUPUESTO, loading: false }),
    usePartidas: () => ({ data: PARTIDAS, loading: false }),
    usePersonal: () => ({ data: PERSONAL, loading: false }),
  };
}

const render = (props = {}) => renderToString(
  React.createElement(globalThis.SimuladorOrdenesPage, { showToast: () => {}, ...props })
);

beforeAll(async () => {
  montarBrowserFalso();
  await import('../../components/jx-simulador-ordenes.jsx');
});

describe('la pantalla del Simulador de Órdenes', () => {
  it('queda expuesta como window.SimuladorOrdenesPage', () => {
    expect(typeof globalThis.SimuladorOrdenesPage).toBe('function');
  });

  it('nombra a la ejecutora: es la única que puede emitir la orden (§7)', () => {
    expect(render()).toContain('CONSORCIO EL INCA');
  });

  it('DICE que no emite nada y que el escenario vive en el navegador', () => {
    const html = render();
    expect(html).toContain('queda guardado en este navegador');
    expect(html).toContain('Nada de esto es todav');   // «…todavía un documento»
  });

  it('la cobertura se mide contra lo COMPRABLE, no contra el presupuesto total', () => {
    const html = render();
    expect(html).toContain('Presupuesto comprable');
    expect(html).toContain('es planilla');
    expect(html).toContain('la planilla no se cubre con órdenes');
  });

  it('arma órdenes por período y NUNCA una de mano de obra', () => {
    const html = render();
    // El título de una orden es «Subcategoría — período» (§1 del plan).
    expect(html).toContain('Materiales — octubre 2026');
    expect(html).toContain('Materiales — noviembre 2026');
    // La planilla no se compra: no puede aparecer como una orden propuesta.
    expect(html).not.toContain('Mano de obra — octubre 2026');
  });

  it('los proveedores van en UN datalist compartido, no en un select por fila', () => {
    // Producción tiene 549 proveedores + 28 empresas = 577 candidatos. Un
    // <select> por línea son 577 <option> por fila: con una orden abierta de
    // 167 insumos eso son ~96.000 nodos de DOM. El datalist se dibuja una
    // sola vez y se filtra escribiendo.
    const html = render();
    expect(html.match(/<datalist/g) || []).toHaveLength(1);
    expect(html).toContain('id="jx-sim-proveedores"');
  });

  it('avisa cuando el reparto elegido necesita un dato que no existe', () => {
    // Por defecto es «parejo», que no lo necesita: el aviso NO debe estar.
    expect(render()).not.toContain('necesita un dato que todavía no se carga');
  });

  it('la pestaña de sobres explica el techo y NO lo da por firme', () => {
    const html = render({ vistaInicial: 'sobres' });
    expect(html).toContain('HERRAMIENTAS MANUALES');
    expect(html).toContain('un monto reservado sin decir qué se compra');
    // Nadie informó cuánto del sobre ya se gastó: el aviso tiene que estar.
    expect(html).toContain('cuánto de este sobre ya se gastó');
  });

  it('la pestaña de mano de obra lleva la leyenda del §5, sin excusas', () => {
    const html = render({ vistaInicial: 'dotacion' });
    expect(html).toContain('NO genera ningún registro');
    expect(html).toContain('no le pide gente a RRHH');
    // La oferta sale del padrón, no de horas realmente trabajadas.
    expect(html).toContain('no de horas realmente trabajadas');
    // Los días laborables reales, no un divisor fijo.
    expect(html).toContain('208 h/mes');
  });

  it('el subcontrato NO se suma a los peones: sale con su motivo', () => {
    const html = render({ vistaInicial: 'dotacion' });
    expect(html).toContain('Lo que quedó afuera de la cuenta');
    expect(html).toContain('subcontrato');
  });

  it('lo que no se pudo ubicar en un período sale con el motivo, no repartido', () => {
    const html = render({ vistaInicial: 'pendientes' });
    expect(html).toContain('ARENA GRUESA');
    expect(html).toContain('no tiene fecha de inicio planificada');
    expect(html).toContain('no las reparte «parejo» para que el total cierre');
  });

  it('sin obra activa no revienta: muestra el vacío', () => {
    const antes = globalThis.__getObraActivaId;
    const antesHooks = globalThis.__hooks.useObras;
    globalThis.__getObraActivaId = () => null;
    globalThis.__hooks = { ...globalThis.__hooks, useObras: () => ({ data: [], loading: false }) };
    try {
      expect(() => render()).not.toThrow();
    } finally {
      globalThis.__getObraActivaId = antes;
      globalThis.__hooks = { ...globalThis.__hooks, useObras: antesHooks };
    }
  });
});
