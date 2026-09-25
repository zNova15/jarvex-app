// ═══════════════════════════════════════════════════════════════════
// SIMULADOR DE ÓRDENES — RONDA 4, TANDA 4.3: CERRAR MES.
// Doc `docs/plan-simulador-ordenes.md` §16.1 #5, §16.2 (decisiones 3 y 4) y
// §16.3.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  simularOrdenes, pesosDeReprogramacion, primerPeriodoAbierto, atomosDeCelda,
  mesDePeriodo, reprogramacionLabel,
} from '../simulador-ordenes.js';
import {
  nuevoEscenario, aplicarEscenario, decidirPropuesta, decidirLinea,
  cerrarMes, reabrirMes, mesPorCerrar, mesesCerradosDe, motorDeCierres,
  normalizarCierres, normalizarEscenario, resumenDeCierre, sinCodigoDeLineas,
  esAtomoReprogramado,
} from '../simulador-escenarios.js';

const CEM = 'CEM';
// Una partida corta por mes (cinco días): no es tramo largo, así que su
// cantidad cae entera en su mes.
const MESES = ['2026-04', '2026-05', '2026-06', '2026-07'];
const partidas = MESES.map((m, i) => ({
  id: `p${i}`, fecha_inicio_planificada: `${m}-06`, fecha_fin_planificada: `${m}-10`,
}));
const cemento = (pid, cant = 100) => ({
  id: `ip-${pid}`, partida_id: pid, tipo_insumo: 'material',
  nombre_insumo: 'CEMENTO PORTLAND TIPO I', unidad: 'bls', insumo_codigo: CEM,
  cantidad_presupuestada: cant, precio_presupuestado: 10, costo_presupuestado: cant * 10,
});
const todos = partidas.map(p => cemento(p.id));

const correr = (x = {}) => simularOrdenes({
  insumosPartida: todos, partidas, hoy: '2026-09-25', anclaje: 'cero', ...x,
});
const cantidadPorMes = (r) => {
  const out = {};
  for (const p of r.propuestas) {
    for (const l of p.lineas) {
      for (const e of l.entregas) out[mesDePeriodo(e.periodo)] = (out[mesDePeriodo(e.periodo)] || 0) + e.cantidad;
    }
  }
  return out;
};
const total = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);

describe('las piezas del cierre', () => {
  it('los pesos: inicio al primero, escenario por carga, el resto parejo', () => {
    expect(pesosDeReprogramacion(['a', 'b', 'c'], 'inicio')).toEqual([1, 0, 0]);
    expect(pesosDeReprogramacion(['a', 'b'], 'parejo')).toEqual([0.5, 0.5]);
    const carga = new Map([['a', 0], ['b', 300], ['c', 100]]);
    expect(pesosDeReprogramacion(['a', 'b', 'c'], 'escenario', carga)).toEqual([0, 0.75, 0.25]);
    // Sin carga, el escenario cae a parejo en vez de no mandar nada a ningún lado.
    expect(pesosDeReprogramacion(['a', 'b'], 'escenario', new Map())).toEqual([0.5, 0.5]);
    expect(pesosDeReprogramacion([], 'parejo')).toEqual([]);
  });

  it('el primer período abierto salta los meses cerrados, también en semanas', () => {
    const cerrado = (p) => ['2026-06', '2026-07'].includes(mesDePeriodo(p));
    expect(primerPeriodoAbierto('2026-06', 'mes', cerrado)).toBe('2026-08');
    expect(primerPeriodoAbierto('2026-05', 'mes', cerrado)).toBe('2026-05');
    expect(mesDePeriodo(primerPeriodoAbierto('2026-W24', 'semana', cerrado))).toBe('2026-08');
  });

  it('los átomos de decisión: el propio, el de origen del arrastre y el de lo reprogramado', () => {
    expect(atomosDeCelda({ rubro: 'r', periodo: '2026-06' }, '2026-06|r')).toEqual(['2026-06|r']);
    expect(atomosDeCelda({ rubro: 'r', periodo: '2026-06', propio: false, origenes: new Set(['2026-04']) }, '2026-06|r'))
      .toEqual(['2026-04|r']);
    expect(atomosDeCelda({ rubro: 'r', periodo: '2026-06', reprogramado: 5 }, '2026-06|r'))
      .toEqual(['2026-06|r', '2026-06|r|reprogramado']);
    expect(esAtomoReprogramado('2026-06|r|reprogramado')).toBe(true);
  });

  it('dice adónde va lo reprogramado con cada reparto', () => {
    expect(reprogramacionLabel('inicio')).toContain('primer mes');
    expect(reprogramacionLabel('parejo')).toContain('parejo');
  });
});

describe('cerrar un mes reprograma lo que NO se pidió en él (§16.2, decisión 3)', () => {
  it('sin cierres no cambia nada: los átomos de decisión son los de siempre', () => {
    const r = correr();
    expect(r.resumen.cierre.reprogramado.lineas).toBe(0);
    for (const p of r.propuestas) expect(p.atomosDecision).toEqual(p.atomos.map(a => a.id));
  });

  it('parejo: lo de abril se reparte entre mayo, junio y julio, y abril queda vacío', () => {
    const r = correr({ mesesCerrados: ['2026-04'] });
    const porMes = cantidadPorMes(r);
    expect(porMes['2026-04']).toBeUndefined();
    expect(total(porMes)).toBeGreaterThanOrEqual(400);
    expect(total(porMes)).toBeLessThanOrEqual(401);
    expect(porMes['2026-05']).toBeGreaterThan(100);
    expect(r.resumen.cierre.reprogramado.lineas).toBe(1);
    expect(r.resumen.cierre.reprogramado.porMes).toEqual({ '2026-04': 1000 });
  });

  it('todo al inicio: va entero al primer mes abierto', () => {
    const r = correr({ mesesCerrados: ['2026-04'], reparto: 'inicio' });
    expect(cantidadPorMes(r)['2026-05']).toBe(200);
    expect(cantidadPorMes(r)['2026-06']).toBe(100);
  });

  it('según el escenario: en proporción a lo que la obra pide cada mes (un mes sin carga no recibe)', () => {
    const sinMayo = [cemento('p0'), cemento('p2'), cemento('p3', 300)];
    const r = simularOrdenes({
      insumosPartida: sinMayo, partidas, hoy: '2026-09-25', anclaje: 'cero',
      mesesCerrados: ['2026-04'], reparto: 'escenario',
    });
    const porMes = cantidadPorMes(r);
    expect(porMes['2026-05']).toBeUndefined();
    expect(porMes['2026-06']).toBe(125);
    expect(porMes['2026-07']).toBe(375);
  });

  it('lo aceptado y escrito como requisición se descuenta y NO se reprograma', () => {
    const r = correr({
      mesesCerrados: ['2026-04'],
      requisiciones: [{ id: 'r1', estado: 'borrador', origen: 'simulador', origen_ref: '2026-04|x' }],
      requisicionItems: [{ id: 'i1', requisicion_id: 'r1', insumo_codigo: CEM, cantidad: 100, precio_estimado: 10 }],
    });
    expect(r.resumen.cierre.reprogramado.lineas).toBe(0);
    expect(total(cantidadPorMes(r))).toBe(300);
  });

  it('una orden de un mes cerrado que se anula vuelve a los meses abiertos (§16.2, decisión 4)', () => {
    const r = correr({
      mesesCerrados: ['2026-04'], reparto: 'inicio', comprado: 'con_factura',
      ordenes: [{ id: 'oc1', estado: 'anulada', correlativo: 1, requisicion_id: 'r1' }],
      ocItems: [{ id: 'x', orden_compra_id: 'oc1', insumo_codigo: CEM, cantidad: 100 }],
      requisiciones: [{ id: 'r1', estado: 'ordenada', oc_id: 'oc1', origen: 'simulador', origen_ref: '2026-04|x' }],
      requisicionItems: [{ id: 'i1', requisicion_id: 'r1', insumo_codigo: CEM, cantidad: 100, precio_estimado: 10 }],
    });
    expect(r.resumen.cierre.reprogramado.lineas).toBe(1);
    expect(cantidadPorMes(r)['2026-05']).toBe(200);
  });

  it('sin ningún mes abierto después, no se inventa un destino: queda en «Sin planificar»', () => {
    const r = correr({ mesesCerrados: MESES });
    expect(r.propuestas).toHaveLength(0);
    expect(r.pendientes.filter(p => p.motivo === 'sin_mes_abierto')).toHaveLength(4);
    expect(r.resumen.cierre.sinMesAbierto.lineas).toBe(4);
  });

  it('el plazo del trabajo abre meses después de la última partida', () => {
    const r = correr({ mesesCerrados: MESES, plazo: { inicio: '2026-04-01', fin: '2026-08-31' } });
    expect(Object.keys(cantidadPorMes(r))).toEqual(['2026-08']);
  });

  it('lo SIN código ya pedido al cerrar sale del plan (no se puede descontar por código)', () => {
    const arena = { ...cemento('p0'), id: 'ar', insumo_codigo: null, nombre_insumo: 'ARENA GRUESA', unidad: 'm3' };
    const base = simularOrdenes({ insumosPartida: [arena], partidas, hoy: '2026-09-25', anclaje: 'cero' });
    const clave = base.propuestas[0].lineas[0].clave;
    expect(clave.startsWith('~')).toBe(true);
    const r = simularOrdenes({
      insumosPartida: [arena], partidas, hoy: '2026-09-25', anclaje: 'cero',
      mesesCerrados: ['2026-04'], pedidoSinCodigo: [`2026-04|${clave}`],
    });
    expect(r.propuestas).toHaveLength(0);
    expect(r.resumen.cierre.yaPedidoSinCodigo.lineas).toBe(1);
    expect(r.resumen.cierre.reprogramado.lineas).toBe(0);
  });

  it('en semana a semana se cierra el mes entero, con todas sus semanas', () => {
    const r = correr({ granularidad: 'semana', mesesCerrados: ['2026-04'], reparto: 'inicio' });
    expect(Object.keys(cantidadPorMes(r))).not.toContain('2026-04');
    expect(total(cantidadPorMes(r))).toBe(400);
  });
});

describe('la cantidad reprogramada se vuelve a decidir', () => {
  it('un mayo ya aceptado que recibe lo de abril queda «lo reprogramado sin decidir»; decidir la línea lo resuelve', () => {
    const antes = correr();
    const mayo = antes.propuestas.find(p => p.periodo === '2026-05');
    let esc = decidirPropuesta(nuevoEscenario({}), mayo, 'aceptada');
    expect(aplicarEscenario(antes, esc).propuestas.find(p => p.periodo === '2026-05').estado).toBe('aceptada');

    const despues = correr({ mesesCerrados: ['2026-04'], reparto: 'inicio' });
    const dec = aplicarEscenario(despues, esc).propuestas.find(p => p.periodo === '2026-05');
    const l = dec.lineas[0];
    expect(l.reprogramadoDe).toEqual(['2026-04']);
    expect(l.montoReprogramado).toBe(1000);
    expect(l.reprogramadaSinDecidir).toBe(true);
    expect(l.decision).toBe('pendiente');

    esc = decidirLinea(esc, dec, l, 'aceptada');
    expect(aplicarEscenario(despues, esc).propuestas.find(p => p.periodo === '2026-05').lineas[0].decision).toBe('aceptada');
  });
});

describe('identidad estable: lo arrastrado conserva su decisión (§16.1 #5)', () => {
  // El 15 de abril Gabriel acepta abril, mayo y junio en modo real. El 15 de junio
  // abril ya pasó y su cemento se arrastra a junio: antes, esa decisión se
  // perdía porque junio es OTRO átomo.
  const enAbril = simularOrdenes({ insumosPartida: todos, partidas, hoy: '2026-04-15', anclaje: 'hoy' });
  const abril = enAbril.propuestas.find(p => p.periodo === '2026-04');
  const junio = enAbril.propuestas.find(p => p.periodo === '2026-06');
  const enJunio = simularOrdenes({ insumosPartida: todos, partidas, hoy: '2026-06-15', anclaje: 'hoy' });

  const mayo = enAbril.propuestas.find(p => p.periodo === '2026-05');

  it('con abril, mayo y junio aceptados, la línea arrastrada a junio sigue aceptada', () => {
    let esc = decidirPropuesta(nuevoEscenario({}), abril, 'aceptada');
    esc = decidirPropuesta(esc, mayo, 'aceptada');
    esc = decidirPropuesta(esc, junio, 'aceptada');
    const p = aplicarEscenario(enJunio, esc).propuestas.find(x => x.periodo === '2026-06');
    expect(p.lineas[0].arrastradoDe).toEqual(['2026-04', '2026-05']);
    expect(p.lineas[0].decision).toBe('aceptada');
  });

  it('si solo se había aceptado abril, no se pierde: la línea queda mixta, no «sin decidir» a secas', () => {
    const esc = decidirPropuesta(nuevoEscenario({}), abril, 'aceptada');
    const l = aplicarEscenario(enJunio, esc).propuestas.find(x => x.periodo === '2026-06').lineas[0];
    expect(l.decisionMixta).toBe(true);
  });

  it('si el mes actual está cerrado, lo atrasado va al siguiente abierto', () => {
    const r = simularOrdenes({ insumosPartida: todos, partidas, hoy: '2026-06-15', anclaje: 'hoy', mesesCerrados: ['2026-06'] });
    expect([...new Set(r.propuestas.map(p => p.periodo))]).toEqual(['2026-07']);
    expect(total(cantidadPorMes(r))).toBe(400);
  });
});

describe('el escenario guarda los cierres', () => {
  it('cerrar, listar y reabrir: solo se reabre el último', () => {
    let esc = nuevoEscenario({});
    expect(esc.cierres).toEqual({});
    esc = cerrarMes(esc, '2026-04', { requisiciones: 2, lineas: 5, monto: 1234.567, fecha: '2026-09-25' });
    esc = cerrarMes(esc, '2026-05', {});
    expect(mesesCerradosDe(esc)).toEqual(['2026-04', '2026-05']);
    expect(esc.cierres['2026-04']).toMatchObject({ requisiciones: 2, lineas: 5, monto: 1234.57, fecha: '2026-09-25' });
    expect(esc.cierres['2026-05'].fecha).toBeTruthy();
    expect(mesesCerradosDe(reabrirMes(esc, '2026-04'))).toEqual(['2026-04', '2026-05']);
    expect(mesesCerradosDe(reabrirMes(esc, '2026-05'))).toEqual(['2026-04']);
    expect(cerrarMes(esc, 'abril')).toBe(esc);
  });

  it('se conserva al leer el escenario guardado, y lo roto se descarta', () => {
    const e = normalizarEscenario({
      cierres: {
        '2026-04': { requisiciones: 1, sinCodigo: ['2026-04|~arena|m3', 'basura', '2026-04|CEM'] },
        'no-es-mes': { requisiciones: 3 },
        '2026-05': null,
      },
    });
    expect(Object.keys(e.cierres)).toEqual(['2026-04']);
    expect(e.cierres['2026-04'].sinCodigo).toEqual(['2026-04|~arena|m3']);
    expect(normalizarCierres(undefined)).toEqual({});
  });

  it('lo que va al motor', () => {
    const esc = cerrarMes(cerrarMes(nuevoEscenario({}), '2026-05', { sinCodigo: ['2026-05|~b|m'] }), '2026-04', { sinCodigo: ['2026-04|~a|m'] });
    expect(motorDeCierres(esc)).toEqual({ mesesCerrados: ['2026-04', '2026-05'], pedidoSinCodigo: ['2026-04|~a|m', '2026-05|~b|m'] });
  });

  it('el mes que toca cerrar es el primero con órdenes que no está cerrado', () => {
    const props = [{ periodo: '2026-06' }, { periodo: '2026-W15' }, { periodo: '2026-05' }];
    expect(mesPorCerrar(props, nuevoEscenario({}))).toBe('2026-04');
    expect(mesPorCerrar(props, cerrarMes(nuevoEscenario({}), '2026-04'))).toBe('2026-05');
    expect(mesPorCerrar([], nuevoEscenario({}))).toBe(null);
  });

  it('el resumen de un cierre separa lo aceptado (con y sin precio) de lo que se reprograma', () => {
    const r = correr();
    const abril = r.propuestas.find(p => p.periodo === '2026-04');
    const mayo = r.propuestas.find(p => p.periodo === '2026-05');
    let esc = decidirPropuesta(nuevoEscenario({}), abril, 'aceptada');
    esc = decidirPropuesta(esc, mayo, 'rechazada');
    const dec = aplicarEscenario(r, esc);
    const ab = resumenDeCierre(dec, '2026-04');
    expect(ab.lineas).toHaveLength(1);
    expect(ab.montoAceptado).toBe(1000);
    expect(ab.rechazadas + ab.sinDecidir).toBe(0);
    const my = resumenDeCierre(dec, '2026-05');
    expect(my.lineas).toHaveLength(0);
    expect(my.rechazadas).toBe(1);
    expect(my.montoNoAceptado).toBe(1000);
  });

  it('lo sin código que queda pedido se anota en cada mes en que entrega', () => {
    expect(sinCodigoDeLineas([
      { clave: '~arena|m3', insumo_codigo: null, entregas: [{ periodo: '2026-04' }, { periodo: '2026-W20' }] },
      { clave: '~yeso|bls', insumo_codigo: null, entregas: null, periodos: ['2026-06'] },
      { clave: CEM, insumo_codigo: CEM, entregas: [{ periodo: '2026-04' }] },
    ])).toEqual(['2026-04|~arena|m3', '2026-05|~arena|m3', '2026-06|~yeso|bls']);
  });
});
