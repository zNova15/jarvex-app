// ═══════════════════════════════════════════════════════════════════
// SIMULADOR DE ÓRDENES — RONDA 4, TANDA 4.2: QUÉ CUENTA COMO YA COMPRADO.
// Doc `docs/plan-simulador-ordenes.md` §16.1 (#4, #6, #7) y §16.2.
//
// Datos de producción medidos el 25-set-2026: 14 órdenes `recibida`
// numeradas, las 14 con `accounting_movement_id`; 16 comprobantes con
// `orden_compra_id`; 1 orden anulada; ninguna requisición ni orden escrita
// todavía por el simulador.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  coberturaPrevia, simularOrdenes,
  ordenesQueCuentan, ordenesFacturadas, ordenEmitida, ordenMuerta,
  aplicarAnulaciones, esRequisicionDelPlan,
  COMPRADO_MODOS, COMPRADO_DEFAULT,
} from '../simulador-ordenes.js';
import { liberacionPorAnulacion } from '../ordenes.js';
import {
  armarRequisiciones, estadoDelPlan, consumoDeSobres,
  liberacionPorAnulacion as liberacionDesdePuente,
} from '../simulador-puente.js';
import {
  PARAMS_DEFAULT, normalizarParams, paramsDeMotor, almacenModoDe, claveAlmacenModo,
} from '../simulador-escenarios.js';

const CEM = 'CEM';
// Una orden emitida de verdad: con número, viva.
const emitida = (id, over = {}) => ({ id, estado: 'por_confirmar', correlativo: 3, codigo: `EI-OC-00${id}-2026`, monto_total: 1000, ...over });
const item = (oc, cant, over = {}) => ({ id: `i-${oc}-${cant}`, orden_compra_id: oc, insumo_codigo: CEM, cantidad: cant, subtotal: cant * 10, ...over });
const reqPlan = (id, over = {}) => ({ id, estado: 'borrador', origen: 'simulador', origen_ref: '2026-04|concreto', ...over });
const reqItem = (rid, cant) => ({ id: `ri-${rid}-${cant}`, requisicion_id: rid, insumo_codigo: CEM, cantidad: cant, precio_estimado: 10 });

describe('qué es una orden emitida', () => {
  it('numerada, viva y que no sea borrador', () => {
    expect(ordenEmitida(emitida('1'))).toBe(true);
    expect(ordenEmitida({ id: 'b', estado: 'borrador', correlativo: null })).toBe(false);
    // §16.1 #7: el puente viejo guardaba borrador CON número. No es emitida.
    expect(ordenEmitida({ id: 'b', estado: 'borrador', correlativo: 5 })).toBe(false);
    expect(ordenEmitida(emitida('1', { estado: 'anulada' }))).toBe(false);
    expect(ordenEmitida(emitida('1', { deleted_at: '2026-09-25' }))).toBe(false);
  });

  it('muerta = anulada, cancelada o borrada', () => {
    expect(ordenMuerta({ estado: 'anulada' })).toBe(true);
    expect(ordenMuerta({ estado: 'cancelada' })).toBe(true);
    expect(ordenMuerta({ estado: 'recibida', deleted_at: 'x' })).toBe(true);
    expect(ordenMuerta({ estado: 'recibida' })).toBe(false);
  });
});

describe('la factura se reconoce por los DOS lados del vínculo', () => {
  it('por la orden (`accounting_movement_id`) y por el comprobante (`orden_compra_id`)', () => {
    const ordenes = [emitida('a', { accounting_movement_id: 'm1' }), emitida('b'), emitida('c')];
    const movs = [{ id: 'm1' }, { id: 'm2', orden_compra_id: 'b' }];
    expect([...ordenesFacturadas(ordenes, movs)].sort()).toEqual(['a', 'b']);
  });

  it('un comprobante anulado o borrado no cuenta como factura', () => {
    const ordenes = [emitida('a', { accounting_movement_id: 'm1' }), emitida('b')];
    const movs = [
      { id: 'm1', estado_factura: 'anulada' },
      { id: 'm2', orden_compra_id: 'b', deleted_at: '2026-09-01' },
    ];
    expect(ordenesFacturadas(ordenes, movs).size).toBe(0);
  });

  it('si el comprobante de la orden todavía no bajó, se le cree al vínculo de la orden', () => {
    expect(ordenesFacturadas([emitida('a', { accounting_movement_id: 'm-no-bajo' })], []).has('a')).toBe(true);
  });

  it('la factura cuenta UNA vez: vinculada por los dos lados, o con tres facturas, la orden resta sus líneas una sola vez', () => {
    const ordenes = [emitida('a', { accounting_movement_id: 'm1' })];
    const movs = [
      { id: 'm1', orden_compra_id: 'a' },
      { id: 'm2', orden_compra_id: 'a' },
      { id: 'm3', orden_compra_id: 'a' },
    ];
    const { cubierto } = coberturaPrevia({ ordenes, ocItems: [item('a', 40)], movimientos: movs, comprado: 'con_factura' });
    expect(cubierto.get(CEM)).toBe(40);
  });
});

describe('la perilla «qué cuenta como ya comprado» (§16.2, decisión 1)', () => {
  const ordenes = [
    emitida('fact', { accounting_movement_id: 'm1' }),
    emitida('sinf'),
    { id: 'borr', estado: 'borrador', correlativo: null, monto_total: 500 },
    emitida('anul', { estado: 'anulada' }),
  ];
  const ocItems = [item('fact', 10), item('sinf', 20), item('borr', 40), item('anul', 80)];

  it('el default es «con factura»', () => {
    expect(COMPRADO_DEFAULT).toBe('con_factura');
    expect(COMPRADO_MODOS).toEqual(['con_factura', 'emitidas']);
  });

  it('con factura: solo la emitida facturada. La sin factura y el borrador quedan afuera, y se dice', () => {
    const r = coberturaPrevia({ ordenes, ocItems, comprado: 'con_factura' });
    expect(r.cubierto.get(CEM)).toBe(10);
    expect(r.comprado.sinFactura).toEqual({ ordenes: 1, monto: 1000 });
    expect(r.comprado.borradores).toEqual({ ordenes: 1, monto: 500 });
  });

  it('todas las emitidas: también la sin factura. El borrador NUNCA', () => {
    const r = coberturaPrevia({ ordenes, ocItems, comprado: 'emitidas' });
    expect(r.cubierto.get(CEM)).toBe(30);
    expect(r.comprado.borradores.ordenes).toBe(1);
    expect(r.comprado.sinFactura.ordenes).toBe(0);
  });

  it('sin perilla (null) es lo de antes: toda orden no anulada, borrador incluido', () => {
    const r = coberturaPrevia({ ordenes, ocItems });
    expect(r.cubierto.get(CEM)).toBe(70);
    expect(r.comprado.modo).toBe(null);
  });

  it('una perilla desconocida no rompe: se comporta como sin perilla', () => {
    expect(ordenesQueCuentan({ ordenes, comprado: 'cualquiera' }).resumen.modo).toBe(null);
  });
});

describe('la regla derivada: lo que sale de ESTE plan cuenta SIEMPRE (§16.2)', () => {
  it('la orden emitida desde una requisición del plan cuenta sin factura, con el default «con factura»', () => {
    const r = coberturaPrevia({
      ordenes: [emitida('oc1', { requisicion_id: 'r1' })],
      ocItems: [item('oc1', 40)],
      requisiciones: [reqPlan('r1', { estado: 'ordenada', oc_id: 'oc1' })],
      requisicionItems: [reqItem('r1', 40)],
      comprado: 'con_factura',
    });
    // Una sola vez: la orden cuenta, su requisición no se suma encima.
    expect(r.cubierto.get(CEM)).toBe(40);
    expect(r.comprado.delPlan).toBe(1);
    expect(r.comprado.sinFactura.ordenes).toBe(0);
  });

  it('también el «borrador con número» del puente viejo (§16.1 #7), si salió del plan', () => {
    const r = coberturaPrevia({
      ordenes: [{ id: 'oc1', estado: 'borrador', correlativo: 4, requisicion_id: 'r1' }],
      ocItems: [item('oc1', 40)],
      requisiciones: [reqPlan('r1', { estado: 'ordenada', oc_id: 'oc1' })],
      requisicionItems: [reqItem('r1', 40)],
      comprado: 'con_factura',
    });
    expect(r.cubierto.get(CEM)).toBe(40);
  });

  it('la requisición del plan (pre-orden) cuenta con cualquier perilla', () => {
    for (const comprado of COMPRADO_MODOS) {
      const r = coberturaPrevia({ requisiciones: [reqPlan('r1')], requisicionItems: [reqItem('r1', 25)], comprado });
      expect(r.cubierto.get(CEM)).toBe(25);
    }
  });

  it('una orden que NO es del plan y la perilla deja afuera tampoco se cuenta por su requisición', () => {
    const r = coberturaPrevia({
      ordenes: [emitida('oc1', { requisicion_id: 'rm' })],
      ocItems: [item('oc1', 40)],
      requisiciones: [{ id: 'rm', estado: 'ordenada', oc_id: 'oc1', origen: null }],
      requisicionItems: [reqItem('rm', 40)],
      comprado: 'con_factura',
    });
    expect(r.cubierto.has(CEM)).toBe(false);
  });

  it('si la orden de la requisición todavía no bajó, cuenta la requisición: pide lo mismo', () => {
    const r = coberturaPrevia({
      requisiciones: [reqPlan('r1', { estado: 'ordenada', oc_id: 'oc-no-bajo' })],
      requisicionItems: [reqItem('r1', 40)],
      comprado: 'con_factura',
    });
    expect(r.cubierto.get(CEM)).toBe(40);
  });

  it('de punta a punta, en Simulación: la orden de abril sin factura no se vuelve a proponer en mayo', () => {
    const partidas = [
      { id: 'p1', fecha_inicio_planificada: '2026-04-06', fecha_fin_planificada: '2026-04-10' },
      { id: 'p2', fecha_inicio_planificada: '2026-05-04', fecha_fin_planificada: '2026-05-08' },
    ];
    const insumosPartida = ['p1', 'p2'].map(pid => ({
      id: `ip-${pid}`, partida_id: pid, tipo_insumo: 'material',
      nombre_insumo: 'CEMENTO PORTLAND TIPO I', unidad: 'bls', insumo_codigo: CEM,
      cantidad_presupuestada: 100, precio_presupuestado: 28.5, costo_presupuestado: 2850,
    }));
    const r = simularOrdenes({
      insumosPartida, partidas, hoy: '2026-09-25', anclaje: 'cero', comprado: 'con_factura',
      ordenes: [emitida('oc1', { requisicion_id: 'r1' })],
      ocItems: [item('oc1', 100)],
      requisiciones: [reqPlan('r1', { estado: 'ordenada', oc_id: 'oc1' })],
      requisicionItems: [reqItem('r1', 100)],
    });
    const cantidades = r.propuestas.flatMap(p => p.lineas).filter(l => l.insumo_codigo === CEM).map(l => l.cantidad);
    expect(cantidades.reduce((s, c) => s + c, 0)).toBe(100);
    expect(r.resumen.descontado.cantidad).toBe(100);
  });
});

describe('anular una orden la devuelve al plan (§16.1 #6, §16.2 decisión 4)', () => {
  const ordenes = [emitida('oc1', { estado: 'anulada', requisicion_id: 'r1' })];
  const requisiciones = [reqPlan('r1', { estado: 'ordenada', oc_id: 'oc1', oc_codigo: 'EI-OC-001-2026' })];
  const requisicionItems = [reqItem('r1', 40)];

  it('aplicarAnulaciones: la del plan sale `cancelada`, sin tocar la fila original', () => {
    const [r] = aplicarAnulaciones({ requisiciones, ordenes });
    expect(r.estado).toBe('cancelada');
    expect(requisiciones[0].estado).toBe('ordenada');
  });

  it('aplicarAnulaciones: una que no es del plan, o cuya orden no bajó, queda igual', () => {
    const ajena = { id: 'rm', estado: 'ordenada', oc_id: 'oc1', origen: null };
    const huerfana = reqPlan('r2', { estado: 'ordenada', oc_id: 'oc-x' });
    const out = aplicarAnulaciones({ requisiciones: [ajena, huerfana], ordenes });
    expect(out[0]).toBe(ajena);
    expect(out[1]).toBe(huerfana);
  });

  it('el motor ya no la cuenta: la cantidad vuelve a proponerse', () => {
    const r = coberturaPrevia({ ordenes, ocItems: [item('oc1', 40)], requisiciones, requisicionItems, comprado: 'con_factura' });
    expect(r.cubierto.has(CEM)).toBe(false);
  });

  it('una requisición ajena cuya orden se anuló vuelve a reservar (como la libera Compras)', () => {
    const r = coberturaPrevia({
      ordenes, requisiciones: [{ id: 'rm', estado: 'ordenada', oc_id: 'oc1', origen: null }],
      requisicionItems: [reqItem('rm', 15)], comprado: 'con_factura',
    });
    expect(r.cubierto.get(CEM)).toBe(15);
  });

  it('la pantalla deja de decir «✓ Ya emitida» y se puede volver a escribir', () => {
    const vigentes = aplicarAnulaciones({ requisiciones, ordenes });
    expect(estadoDelPlan({ requisiciones: vigentes, requisicionItems }).size).toBe(0);
    const plan = armarRequisiciones({
      lineas: [{
        propuesta_id: '2026-04|concreto', periodo: '2026-04', subcategoria: 'material',
        insumo_codigo: CEM, descripcion: 'CEMENTO', unidad: 'bls', cantidad: 40, precio_unitario: 10, monto: 400,
        origen: 'simulador',
      }],
      obraId: 'o', yaEscritas: vigentes, yaEscritasItems: requisicionItems, nuevoId: (() => { let n = 0; return () => `n${++n}`; })(),
    });
    expect(plan.duplicadas).toHaveLength(0);
    expect(plan.requisiciones).toHaveLength(1);
  });

  it('un sobre cuya orden se anuló deja de contar como gastado', () => {
    const sobre = [{ id: 's1', estado: 'ordenada', oc_id: 'oc1', origen: 'simulador_sobre', origen_ref: 'sobre:herramientas manuales|%mo' }];
    const its = [{ id: 'x', requisicion_id: 's1', cantidad: 2, precio_estimado: 50 }];
    expect(consumoDeSobres({ requisiciones: sobre, requisicionItems: its })).toEqual({ 'herramientas manuales|%mo': 100 });
    expect(consumoDeSobres({ requisiciones: aplicarAnulaciones({ requisiciones: sobre, ordenes }), requisicionItems: its })).toEqual({});
  });
});

describe('liberacionPorAnulacion — el parche que escriben Órdenes y Compras', () => {
  const orden = { id: 'oc1', estado: 'anulada' };

  it('la del plan pasa a cancelada y conserva el rastro de la orden', () => {
    expect(liberacionPorAnulacion(reqPlan('r1', { estado: 'ordenada', oc_id: 'oc1' }), orden)).toEqual({ estado: 'cancelada' });
  });

  it('cualquier otra vuelve a aprobada, sin orden', () => {
    expect(liberacionPorAnulacion({ id: 'rm', estado: 'ordenada', oc_id: 'oc1' }, orden))
      .toEqual({ oc_id: null, oc_codigo: null, estado: 'aprobada' });
  });

  it('no toca lo ajeno ni lo que ya está muerto', () => {
    expect(liberacionPorAnulacion(reqPlan('r1', { oc_id: 'otra' }), orden)).toBe(null);
    expect(liberacionPorAnulacion(reqPlan('r1', { oc_id: 'oc1', estado: 'rechazada' }), orden)).toBe(null);
    expect(liberacionPorAnulacion(null, orden)).toBe(null);
  });

  it('el puente la re-exporta: es la misma función, no una copia', () => {
    expect(liberacionDesdePuente).toBe(liberacionPorAnulacion);
    expect(esRequisicionDelPlan({ origen: 'simulador_sobre' })).toBe(true);
    expect(esRequisicionDelPlan({ origen: 'manual' })).toBe(false);
  });
});

describe('los parámetros del escenario', () => {
  it('«qué cuenta como comprado» arranca en «con factura» y un valor raro vuelve al default', () => {
    expect(PARAMS_DEFAULT.comprado).toBe('con_factura');
    expect(normalizarParams({}).comprado).toBe('con_factura');
    expect(normalizarParams({ comprado: 'emitidas' }).comprado).toBe('emitidas');
    expect(normalizarParams({ comprado: 'todo' }).comprado).toBe('con_factura');
    expect(paramsDeMotor({ comprado: 'emitidas' }).comprado).toBe('emitidas');
  });

  it('el almacén tiene una perilla por modo: en Simulación arranca en «nada»', () => {
    expect(almacenModoDe({ modo: 'simulacion' })).toBe('nada');
    expect(almacenModoDe({ modo: 'real' })).toBe('entradas');
    expect(paramsDeMotor({ modo: 'simulacion' }).almacenModo).toBe('nada');
    expect(paramsDeMotor({ modo: 'real' }).almacenModo).toBe('entradas');
    expect(claveAlmacenModo({ modo: 'simulacion' })).toBe('almacenModoSimulacion');
    expect(claveAlmacenModo({ modo: 'real' })).toBe('almacenModo');
  });

  it('elegir en un modo no le cambia al otro lo que eligió', () => {
    const p = normalizarParams({ modo: 'simulacion', almacenModo: 'stock', almacenModoSimulacion: 'entradas' });
    expect(paramsDeMotor(p).almacenModo).toBe('entradas');
    expect(paramsDeMotor({ ...p, modo: 'real' }).almacenModo).toBe('stock');
  });

  it('un escenario de Simulación guardado antes de la 4.2 se abre sin almacén, como restaba hasta entonces', () => {
    // Se guardaban normalizados: traen `almacenModo: 'entradas'` y nada más.
    const viejo = normalizarParams({ modo: 'simulacion', almacenModo: 'entradas' });
    expect(viejo.almacenModoSimulacion).toBe('nada');
    expect(paramsDeMotor(viejo).almacenModo).toBe('nada');
  });
});
