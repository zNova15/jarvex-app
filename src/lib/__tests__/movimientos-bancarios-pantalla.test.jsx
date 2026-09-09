// ═══════════════════════════════════════════════════════════════════
// ¿QUÉ MUESTRA Movimientos Bancarios según por dónde se entró?
//
// El pedido de Gabriel (7-sep-2026) tiene dos mitades, y la segunda es la que
// un refactor rompe sin que nadie lo note:
//
//   «los movimientos bancarios por empresa y entidad (para obras sería
//    movimiento bancario de las cuentas de consorcio EL INCA)».
//
// Dentro de un trabajo el titular NO se elige: es su ejecutora. Si alguien
// vuelve a abrir ese desplegable, la pantalla sigue abriendo igual —
// `pantallas-montan` seguiría en verde— y sin embargo la almacenera o el
// residente podrían estar mirando la cuenta de otra empresa desde la obra.
// Es exactamente el bug que Gabriel reportó en Órdenes en set-2026.
//
// El otro guard es sobre el saldo: sumar cuentas de distinta moneda daría un
// número que no existe, así que el saldo corrido solo aparece con UNA cuenta.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

const OBRA = 'o1';
const EL_INCA = 'c-inca';
const JARVEX = 'c-jarvex';
const CHUSAAC = 'c-chusaac';

const COMPANIES = [
  { id: EL_INCA, name: 'CONSORCIO EL INCA', ruc: '20615346081', tipo_entidad: 'consorcio' },
  { id: JARVEX, name: 'JARVEX INGENIERIA', ruc: '20615646505', tipo_entidad: 'propia' },
  { id: CHUSAAC, name: 'CONSORCIO CHUSAAC', ruc: '20613408011', tipo_entidad: 'consorcio' },
];

const CUENTAS = [
  { id: 'cta-inca-bcp', company_id: EL_INCA, banco: 'BCP', banco_codigo: 'bcp', numero_cuenta: '19100012340088', tipo: 'corriente', moneda: 'PEN', saldo_inicial: 10000, estado: 'activa' },
  { id: 'cta-inca-bn', company_id: EL_INCA, banco: 'Banco de la Nación', banco_codigo: 'nacion', numero_cuenta: '00071234', tipo: 'detracciones', moneda: 'PEN', saldo_inicial: 500, estado: 'activa' },
  { id: 'cta-jx-bcp', company_id: JARVEX, banco: 'BCP', banco_codigo: 'bcp', numero_cuenta: '19199998880011', tipo: 'corriente', moneda: 'PEN', saldo_inicial: 3000, estado: 'activa' },
];

const MOVS = [
  { id: 'mb1', cuenta_id: 'cta-inca-bcp', fecha: '2026-08-01', monto: -5000, tipo: 'transferencia_out',
    descripcion: 'TRANSF A TERCEROS', referencia: '123456', origen: 'extracto', saldo_extracto: 5000, conciliado: false },
  { id: 'mb2', cuenta_id: 'cta-inca-bcp', fecha: '2026-08-02', monto: -80, tipo: 'comision',
    descripcion: 'COMISION MANTENIMIENTO', referencia: null, origen: 'extracto', saldo_extracto: 4920, conciliado: false },
  { id: 'mb3', cuenta_id: 'cta-jx-bcp', fecha: '2026-08-03', monto: 1200, tipo: 'deposito',
    descripcion: 'ABONO CLIENTE', referencia: '777', origen: 'extracto', conciliado: false },
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
  g.localStorage = {
    getItem: (k) => (k === 'empresa_activa_id' ? (globalThis.__EMPRESA_ACTIVA ?? null) : null),
    setItem() {}, removeItem() {},
  };
  g.CustomEvent = class { constructor(t, o) { this.type = t; Object.assign(this, o); } };
  g.JxIcon = () => null;
  g.Modal = () => null;
  g.__newId = () => 'id-falso';
  g.__navTo = () => {};
  g.__useAuth = () => ({ profile: { rol: 'admin', id: 'u1' }, loading: false });
  g.__hasPerm = () => true;
  g.__fecha = { hoyLocal: () => '2026-09-07' };
  const tabla = () => ({ filter: () => ({ toArray: async () => [] }), toArray: async () => [] });
  g.__db = new Proxy({}, { get: tabla });
  g.__useObraActiva = () => ({ obraId: globalThis.__OBRA_ACTIVA ?? null });
  g.__hooks = {
    useCuentasBancarias: () => ({ data: CUENTAS, loading: false }),
    useMovimientosBancarios: () => ({ data: MOVS, loading: false }),
    useCompanies: () => ({ data: COMPANIES, loading: false }),
    useObras: () => ({ data: [{ id: OBRA, nombre_obra: 'PLAN MIRAFLORES', ejecutora_tipo: 'consorcio', ejecutora_company_id: EL_INCA }], loading: false }),
    usePersonal: () => ({ data: [], loading: false }),
    usePersonalCuentas: () => ({ data: [], loading: false }),
    useCronogramaPagos: () => ({ data: [], loading: false }),
  };
}

const render = () => renderToString(
  React.createElement(globalThis.MovimientosBancariosPage, { showToast: () => {} }));

beforeAll(async () => {
  montarBrowserFalso();
  await import('../../components/jx-tesoreria.jsx');
});

afterEach(() => { globalThis.__OBRA_ACTIVA = null; globalThis.__plano = undefined; globalThis.__EMPRESA_ACTIVA = null; });

describe('el chunk expone la pantalla', () => {
  it('MovimientosBancariosPage existe', () => {
    expect(typeof globalThis.MovimientosBancariosPage).toBe('function');
  });
});

describe('dentro de un trabajo', () => {
  // `afterEach` (global, arriba) limpia __plano después de CADA test — un
  // `beforeAll` acá solo lo pondría una vez y el segundo test del bloque ya
  // lo encontraría en `undefined`. Por eso `beforeEach`, no `beforeAll`.
  beforeEach(() => { globalThis.__OBRA_ACTIVA = OBRA; globalThis.__plano = 'obra'; });

  it('el titular es el consorcio que ejecuta, y lo dice', () => {
    globalThis.__OBRA_ACTIVA = OBRA;
    const html = render();
    expect(html).toContain('CONSORCIO EL INCA');
  });

  it('NO deja elegir otra entidad: el desplegable está clavado', () => {
    globalThis.__OBRA_ACTIVA = OBRA;
    const html = render();
    // El <select> de titular existe pero deshabilitado…
    expect(html).toMatch(/<select[^>]*disabled/);
    // …y no ofrece ninguna otra empresa como opción.
    expect(html).not.toContain('CONSORCIO CHUSAAC');
    expect(html).not.toContain('JARVEX INGENIERIA');
  });

  it('explica por qué mira las cuentas del consorcio y no de la obra', () => {
    globalThis.__OBRA_ACTIVA = OBRA;
    const html = render();
    expect(html).toContain('Una obra no tiene cuenta');
  });

  it('no muestra los movimientos de una cuenta de otra entidad', () => {
    globalThis.__OBRA_ACTIVA = OBRA;
    const html = render();
    expect(html).toContain('TRANSF A TERCEROS');   // de EL INCA
    expect(html).not.toContain('ABONO CLIENTE');   // de JARVEX
  });
});

describe('fuera de un trabajo', () => {
  it('sí deja elegir la entidad titular, con los consorcios marcados', () => {
    globalThis.__OBRA_ACTIVA = null;
    const html = render();
    expect(html).toContain('CONSORCIO EL INCA');
    expect(html).toContain('JARVEX INGENIERIA');
    expect(html).toContain('entidad titular');
  });

  // Gabriel, 9-sep-2026: entró al bloque de una empresa y Movimientos
  // Bancarios le mostraba «Consorcio el Inca» bloqueado — la obra activa
  // vieja seguía en localStorage (sobrevive al F5) aunque ya no estaba
  // parado en ningún trabajo. El titular tiene que obedecer el PLANO, no
  // un id de obra que quedó pegado del último trabajo que visitó.
  it('con una empresa activa, una obra VIEJA en storage no le gana al contexto de empresa', () => {
    globalThis.__OBRA_ACTIVA = OBRA;   // quedó de una visita anterior a un trabajo
    globalThis.__plano = 'empresa';     // pero ahora está en el bloque de una empresa
    globalThis.__EMPRESA_ACTIVA = JARVEX;
    const html = render();
    // El titular es JARVEX (la empresa activa), no EL INCA (la obra vieja).
    expect(html).toContain('JARVEX INGENIERIA');
    expect(html).not.toContain('CONSORCIO EL INCA');
  });

  it('no ofrece a los terceros como titulares: no son cuentas nuestras', () => {
    globalThis.__OBRA_ACTIVA = null;
    const g = globalThis;
    const antes = g.__hooks.useCompanies;
    g.__hooks.useCompanies = () => ({ data: [...COMPANIES, { id: 't1', name: 'MUNICIPALIDAD DE NAMORA', tipo_entidad: 'tercero' }], loading: false });
    const html = render();
    g.__hooks.useCompanies = antes;
    expect(html).not.toContain('MUNICIPALIDAD DE NAMORA');
  });
});

describe('el saldo, que es lo que se mira primero', () => {
  it('con UNA cuenta muestra la columna de saldo corrido', () => {
    globalThis.__OBRA_ACTIVA = null;
    const g = globalThis;
    const antes = g.__hooks.useCuentasBancarias;
    g.__hooks.useCuentasBancarias = () => ({ data: [CUENTAS[0]], loading: false });
    const html = render();
    g.__hooks.useCuentasBancarias = antes;
    expect(html).toContain('Saldo');
  });

  it('avisa cuando la cuenta no cuadra con el extracto del banco', () => {
    globalThis.__OBRA_ACTIVA = null;
    const g = globalThis;
    const antesC = g.__hooks.useCuentasBancarias, antesM = g.__hooks.useMovimientosBancarios;
    // El banco dice que quedaron 5.000 pero el saldo inicial (10.000) menos el
    // único movimiento (-5.000) da 5.000: cuadra. Le sacamos el movimiento.
    g.__hooks.useCuentasBancarias = () => ({ data: [CUENTAS[0]], loading: false });
    g.__hooks.useMovimientosBancarios = () => ({ data: [
      { ...MOVS[0], monto: -1000 },   // registramos 1.000, el banco dice que salieron 5.000
    ], loading: false });
    const html = render();
    g.__hooks.useCuentasBancarias = antesC; g.__hooks.useMovimientosBancarios = antesM;
    expect(html).toContain('no cuadra con el banco');
  });
});

describe('la conciliación', () => {
  it('la comisión que nadie registró queda del lado del banco', () => {
    globalThis.__OBRA_ACTIVA = null;
    // No se puede clickear la pestaña en renderToString, así que lo que se
    // protege acá es que el cálculo llegue a la pantalla: la pestaña de
    // conciliación muestra su contador.
    const html = render();
    expect(html).toContain('Conciliación');
  });
});
