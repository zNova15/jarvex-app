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

  it('ofrece cómo se juntan las órdenes, con el monto mínimo en 0 (tanda 2.3)', () => {
    const html = render();
    expect(html).toContain('Cada cuánto se emite una orden');
    expect(html).toContain('Monto mínimo por orden');
    expect(html).toContain('0 = sin mínimo');
    expect(html).toContain('Frecuencia distinta por rubro');
  });

  it('nombra a la ejecutora: es la única que puede emitir la orden (§7)', () => {
    expect(render()).toContain('CONSORCIO EL INCA');
  });

  it('DICE que el escenario vive en el navegador hasta que se convierta (tanda 4)', () => {
    const html = render();
    expect(html).toContain('queda guardado en este navegador');
    // Desde la tanda 4 la pantalla SÍ escribe, pero en dos pasos separados: la
    // requisición se deshace, la orden quema un correlativo. Que eso esté
    // dicho es lo que evita que alguien crea que aceptar ya emitió.
    expect(html).toContain('Son dos pasos');
    expect(html).toContain('Convertir en requisiciones');
    expect(html).toContain('correlativo');
  });

  it('el botón de convertir arranca APAGADO: sin nada aceptado no hay qué escribir', () => {
    const html = render();
    const i = html.indexOf('Convertir en requisiciones');
    expect(i).toBeGreaterThan(0);
    // El `disabled` va en el mismo <button> que el rótulo.
    expect(html.slice(Math.max(0, i - 260), i)).toContain('disabled');
  });

  it('la cobertura se mide contra lo COMPRABLE, no contra el presupuesto total', () => {
    const html = render();
    expect(html).toContain('Presupuesto comprable');
    expect(html).toContain('es planilla');
    expect(html).toContain('la planilla no se cubre con órdenes');
  });

  it('arma órdenes por período y por RUBRO, y NUNCA una de mano de obra', () => {
    const html = render();
    // Desde el 22-set el título de una orden es «Rubro de proveedor —
    // período»: el cemento con la arena en una, la tubería en otra. Antes las
    // tres caían juntas en «Materiales — octubre 2026», que es la orden
    // mezclada que Gabriel no podía mandarle a nadie.
    expect(html).toContain('Concreto, agregados y aditivos — octubre 2026');
    expect(html).toContain('Tubería, válvulas y accesorios — noviembre 2026');
    expect(html).not.toContain('Materiales — octubre 2026');
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

  // ── Los tres pedidos de Gabriel del 22-set ────────────────────────
  it('hay un botón para pedir una recomendación nueva', () => {
    // «No hay botón para solicitar nueva recomendación, solo cambia cambiando
    // los filtros de arriba». El plan se recalculaba solo con una perilla o
    // con un sync, y no había forma de decir «volvé a mirar».
    const html = render();
    expect(html).toContain('Nueva recomendación');
  });

  it('la pestaña de mano de obra abre con la SIMULACIÓN, no con el padrón', () => {
    const html = render({ vistaInicial: 'dotacion' });
    // Lo que el plan dice por su cuenta: cuánto cuesta y cuánta gente pide.
    expect(html).toContain('Costo de la planilla en el plan');
    expect(html).toContain('Pico de gente que pide el plan');
    expect(html).toContain('Promedio por');
    // 8.000 HH × S/ 20 = S/ 160 k de planilla, que antes no se mostraba.
    expect(html).toContain('S/ 160 k');
    // El padrón sigue, pero DESPUÉS y dicho como lo que es.
    expect(html).toContain('Y recién acá, el contraste con la obra real');
    expect(html.indexOf('Costo de la planilla en el plan'))
      .toBeLessThan(html.indexOf('Personas en el padrón'));
  });

  it('ofrece qué resta el almacén, con «todo lo que entró» por defecto (tanda 2.5)', () => {
    const html = render();
    expect(html).toContain('Del almacén, restar');
    expect(html).toMatch(/<option value="entradas" selected="">Todo lo que entró<\/option>/);
    expect(html).toContain('Solo lo que hay hoy');
    expect(html).toContain('Personalizado por insumo');
    expect(html).toContain('Imputar lo ya comprado');
  });

  it('la bandeja de imputación DICE que nada se imputa solo (tanda 2.5)', () => {
    const html = render({ vistaInicial: 'imputar' });
    expect(html).toContain('Para que el plan no vuelva a pedir lo que ya se compró');
    expect(html).toContain('Nada se imputa solo');
    expect(html).toContain('Órdenes ya emitidas');
    expect(html).toContain('Almacén de la obra');
    // Nunca un botón de aceptar en lote.
    expect(html).not.toMatch(/Aceptar todas<\/button>|Imputar todas/);
  });

  it('ofrece la pestaña de escenarios sugeridos, con los tres corridos por el motor real (tanda 2.6, opcional)', () => {
    const html = render({ vistaInicial: 'enfoques' });
    expect(html).toContain('Pedir recomendación a la IA');
    expect(html).toContain('Caja ajustada');
    expect(html).toContain('Cero desabastecimiento');
    expect(html).toContain('Pocas órdenes');
    // Ninguna cantidad ni precio nuevo: solo las perillas que ya existen.
    expect(html).toContain('El colchón por insumo no lo toca ningún enfoque');
    expect(html).toContain('Usar este enfoque');
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
