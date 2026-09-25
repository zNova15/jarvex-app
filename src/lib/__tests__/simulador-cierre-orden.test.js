// ═══════════════════════════════════════════════════════════════════
// SIMULADOR DE ÓRDENES — CERRAR ORDEN (25-set, corrección de Gabriel a la 4.3)
// «No es cerrar mes, sino cerrar orden dentro de los meses propuestos.»
// Y, en el mismo pedido: «Según lo real» tiene que dejar elegir desde cuándo.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { simularOrdenes, mesDePeriodo } from '../simulador-ordenes.js';
import {
  nuevoEscenario, normalizarEscenario, motorDeCierres,
  cerrarOrden, reabrirOrden, ordenCerrable, ordenReabrible, ordenesCerradasDe,
  resumenDeCierreOrden, normalizarCierresOrden, hoyDelPlan, normalizarParams,
} from '../simulador-escenarios.js';

// Cemento (concreto) y fierro (acero): dos rubros, una partida por mes.
const MESES = ['2026-04', '2026-05', '2026-06', '2026-07'];
const partidas = MESES.map((m, i) => ({
  id: `p${i}`, fecha_inicio_planificada: `${m}-06`, fecha_fin_planificada: `${m}-10`,
}));
const insumo = (pid, cod, nombre, unidad, precio, cant = 100) => ({
  id: `ip-${pid}-${cod}`, partida_id: pid, tipo_insumo: 'material',
  nombre_insumo: nombre, unidad, insumo_codigo: cod,
  cantidad_presupuestada: cant, precio_presupuestado: precio, costo_presupuestado: cant * precio,
});
const todos = partidas.flatMap(p => [
  insumo(p.id, 'CEM', 'CEMENTO PORTLAND TIPO I', 'bls', 10),
  insumo(p.id, 'FIE', 'ACERO CORRUGADO FY=4200 KG/CM2 GRADO 60', 'kg', 5),
]);
const correr = (x = {}) => simularOrdenes({
  insumosPartida: todos, partidas, hoy: '2026-09-25', anclaje: 'cero', ...x,
});
const porRubroYMes = (r) => {
  const out = {};
  for (const p of r.propuestas) {
    for (const l of p.lineas) {
      for (const e of l.entregas) {
        const k = `${p.rubro}|${mesDePeriodo(e.periodo)}`;
        out[k] = (out[k] || 0) + e.cantidad;
      }
    }
  }
  return out;
};

describe('el motor: una orden cerrada reprograma solo lo de SU rubro', () => {
  const base = correr();
  const cem = base.propuestas.find(p => p.periodo === '2026-04' && p.lineas.some(l => l.insumo_codigo === 'CEM'));
  const fie = base.propuestas.find(p => p.periodo === '2026-04' && p.lineas.some(l => l.insumo_codigo === 'FIE'));

  it('el cemento y el fierro son órdenes de rubros distintos (si no, el test no prueba nada)', () => {
    expect(cem && fie).toBeTruthy();
    expect(cem.rubro).not.toBe(fie.rubro);
  });

  it('cerrar la orden de cemento de abril la saca de abril y la reparte en los meses siguientes de cemento', () => {
    const r = correr({ atomosCerrados: cem.atomos.map(a => a.id), reparto: 'inicio' });
    const q = porRubroYMes(r);
    expect(q[`${cem.rubro}|2026-04`]).toBeUndefined();
    expect(q[`${cem.rubro}|2026-05`]).toBe(200);          // lo suyo + lo reprogramado de abril
    // El fierro de abril sigue en abril: su orden no se cerró.
    expect(q[`${fie.rubro}|2026-04`]).toBe(100);
    expect(r.resumen.cierre.reprogramado.monto).toBe(1000);
  });

  it('no cae en otra orden cerrada del mismo rubro: la salta', () => {
    const may = base.propuestas.find(p => p.periodo === '2026-05' && p.rubro === cem.rubro);
    const r = correr({ atomosCerrados: [...cem.atomos, ...may.atomos].map(a => a.id), reparto: 'inicio' });
    const q = porRubroYMes(r);
    expect(q[`${cem.rubro}|2026-05`]).toBeUndefined();
    expect(q[`${cem.rubro}|2026-06`]).toBe(300);
  });

  it('el total no cambia: se mueve, no se pierde', () => {
    const tot = (r) => Object.values(porRubroYMes(r)).reduce((a, b) => a + b, 0);
    expect(tot(correr({ atomosCerrados: cem.atomos.map(a => a.id) }))).toBe(tot(base));
  });

  it('lo escrito al cerrar se descuenta: con abril pedido entero no queda nada para reprogramar', () => {
    const r = correr({
      atomosCerrados: cem.atomos.map(a => a.id),
      requisiciones: [{ id: 'rq', origen: 'simulador', estado: 'borrador' }],
      requisicionItems: [{ id: 'i', requisicion_id: 'rq', insumo_codigo: 'CEM', cantidad: 100 }],
    });
    const q = porRubroYMes(r);
    expect(q[`${cem.rubro}|2026-04`]).toBeUndefined();
    expect(q[`${cem.rubro}|2026-05`]).toBe(100);
    expect(r.resumen.cierre.reprogramado.lineas).toBe(0);
  });

  it('en modo real, lo atrasado de un rubro con la orden de este mes cerrada va al mes siguiente; el otro rubro no', () => {
    const hoy = '2026-05-15';
    const may = correr({ anclaje: 'hoy', hoy }).propuestas.find(p => p.periodo === '2026-05' && p.rubro === cem.rubro);
    const r = correr({ anclaje: 'hoy', hoy, atomosCerrados: may.atomos.map(a => a.id), reparto: 'inicio' });
    const q = porRubroYMes(r);
    expect(q[`${cem.rubro}|2026-05`]).toBeUndefined();
    expect(q[`${cem.rubro}|2026-06`]).toBeGreaterThanOrEqual(200);
    expect(q[`${fie.rubro}|2026-05`]).toBe(200);            // abril arrastrado + mayo
  });
});

describe('el escenario: cerrar y reabrir órdenes', () => {
  const p = (periodo, rubro, extra = {}) => ({
    id: `${periodo}|${rubro}`, periodo, rubro, titulo: `Orden ${rubro}`,
    atomos: [{ id: `${periodo}|${rubro}`, periodo }], lineas: [], ...extra,
  });

  it('se cierra la orden más temprana ABIERTA de cada rubro; la de otro rubro no molesta', () => {
    const props = [p('2026-04', 'concreto'), p('2026-05', 'concreto'), p('2026-04', 'acero')];
    expect(ordenCerrable(props[0], props).ok).toBe(true);
    const r = ordenCerrable(props[1], props);
    expect(r.ok).toBe(false);
    expect(r.antes.id).toBe('2026-04|concreto');
    expect(ordenCerrable(props[2], props).ok).toBe(true);
  });

  it('cerrar guarda los átomos; el motor los recibe junto con lo sin código', () => {
    const esc = cerrarOrden(nuevoEscenario({}), p('2026-04', 'concreto'), {
      categoria: 'materiales', requisiciones: 1, lineas: 3, monto: 1200, sinCodigo: ['2026-04|~x|m'],
    });
    expect(ordenesCerradasDe(esc)).toHaveLength(1);
    expect(motorDeCierres(esc)).toEqual({
      mesesCerrados: [], atomosCerrados: ['2026-04|concreto'], pedidoSinCodigo: ['2026-04|~x|m'],
    });
  });

  it('una orden consolidada cierra TODOS sus períodos', () => {
    const cons = p('2026-04', 'concreto', { atomos: [{ id: '2026-04|concreto' }, { id: '2026-05|concreto' }] });
    const esc = cerrarOrden(nuevoEscenario({}), cons);
    expect(motorDeCierres(esc).atomosCerrados).toEqual(['2026-04|concreto', '2026-05|concreto']);
  });

  it('solo se reabre la ÚLTIMA cerrada de su rubro', () => {
    let esc = cerrarOrden(nuevoEscenario({}), p('2026-04', 'concreto'));
    esc = cerrarOrden(esc, p('2026-05', 'concreto'));
    esc = cerrarOrden(esc, p('2026-04', 'acero'));
    expect(ordenReabrible(esc, '2026-04|concreto')).toBe(false);
    expect(ordenReabrible(esc, '2026-05|concreto')).toBe(true);
    expect(ordenReabrible(esc, '2026-04|acero')).toBe(true);
    expect(reabrirOrden(esc, '2026-04|concreto')).toBe(esc);            // no hace nada
    const r = reabrirOrden(esc, '2026-05|concreto');
    expect(ordenesCerradasDe(r).map(o => o.id)).toEqual(['2026-04|acero', '2026-04|concreto']);
  });

  it('sobrevive a guardar y leer (localStorage) y descarta lo mal formado', () => {
    const esc = cerrarOrden(nuevoEscenario({}), p('2026-04', 'concreto'), { monto: 50 });
    const leido = normalizarEscenario(JSON.parse(JSON.stringify(esc)));
    expect(leido.cierresOrden['2026-04|concreto'].monto).toBe(50);
    expect(normalizarCierresOrden({ malo: { atomos: ['sin-barra'] }, nada: null })).toEqual({});
  });

  it('el resumen separa lo aceptado de lo que se reprograma', () => {
    const orden = {
      id: 'o', periodo: '2026-04', rubro: 'concreto', atomos: [{ id: '2026-04|concreto' }],
      lineas: [
        { clave: 'a', decision: 'aceptada', cantidad: 10, precio_unitario: 5, monto: 50, subcategoria: 'material', insumo_codigo: 'A', entregas: [] },
        { clave: 'b', decision: 'rechazada', cantidad: 10, precio_unitario: 3, monto: 30 },
        { clave: 'c', decision: 'pendiente', cantidad: 1, precio_unitario: 7, monto: 7 },
      ],
    };
    const r = resumenDeCierreOrden(orden);
    expect(r.rechazadas).toBe(1);
    expect(r.sinDecidir).toBe(1);
    expect(r.montoNoAceptado).toBe(37);
  });
});

describe('«Según lo real»: desde cuándo se pide', () => {
  it('por defecto, desde hoy', () => {
    expect(hoyDelPlan(normalizarParams({ modo: 'real' }), '2026-09-25')).toBe('2026-09-25');
  });
  it('con una fecha elegida, esa hace de «hoy» para el plan', () => {
    const params = normalizarParams({ modo: 'real', desdeReal: 'fecha', desdeRealFecha: '2026-11-01' });
    expect(hoyDelPlan(params, '2026-09-25')).toBe('2026-11-01');
  });
  it('«una fecha» sin fecha todavía, o en Simulación, sigue siendo hoy', () => {
    expect(hoyDelPlan(normalizarParams({ modo: 'real', desdeReal: 'fecha' }), '2026-09-25')).toBe('2026-09-25');
    expect(hoyDelPlan(normalizarParams({ modo: 'simulacion', desdeReal: 'fecha', desdeRealFecha: '2026-11-01' }), '2026-09-25')).toBe('2026-09-25');
  });
  it('en el motor: pedir desde noviembre trae a noviembre todo lo pendiente de antes', () => {
    const r = correr({ anclaje: 'hoy', hoy: '2026-06-15' });
    const meses = new Set(r.propuestas.map(p => mesDePeriodo(p.periodo)));
    expect(meses.has('2026-04')).toBe(false);
    expect(meses.has('2026-06')).toBe(true);
  });
});
