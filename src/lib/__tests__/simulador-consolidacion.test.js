// ═══════════════════════════════════════════════════════════════════
// Tests de la consolidación de órdenes (ronda 2, tanda 2.3).
//
// Lo que protegen, y no es obvio:
//   1. Juntar órdenes NO mueve plata: la suma de lo propuesto es la misma con
//      cualquier frecuencia y cualquier monto mínimo, y las entregas de cada
//      línea suman la línea.
//   2. Nada llega TARDE: una orden juntada se emite en la fecha de la entrega
//      más temprana, nunca en la de la más tardía.
//   3. Lo ya decidido sobrevive a reagrupar: las decisiones viven en los
//      átomos (período × rubro), que tienen el mismo id que la orden de antes.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  consolidarOrdenes, frecuenciaDeRubro, FRECUENCIAS, FRECUENCIA_DEFAULT,
} from '../simulador-consolidacion.js';
import { simularOrdenes, etiquetaVentana, mesDePeriodo, rangoDePeriodo } from '../simulador-ordenes.js';
import { rangoDePeriodo as rangoDesdeDotacion } from '../simulador-dotacion.js';
import {
  PARAMS_DEFAULT, normalizarParams, paramsDeMotor, mismosParams, nuevoEscenario,
  decidirPropuesta, decidirLinea, decidirPeriodo, editarLinea, limpiarEdicion,
  aplicarEscenario, lineasAceptadas, refLinea,
} from '../simulador-escenarios.js';
import {
  armarRequisiciones, borradorDeOrdenDesdeRequisicion,
  textoDeEntregas, periodosDeEntregas, referenciaDeEntregas, ENTREGAS_A_COORDINAR,
} from '../simulador-puente.js';

const atomo = (periodo, rubro, monto) => ({ id: `${periodo}|${rubro}`, periodo, rubro, monto, mes: mesDePeriodo(periodo) });

// ═══════════════════════════════════════════════════════════════════
describe('consolidarOrdenes — el módulo puro', () => {
  const concreto = [atomo('2026-10', 'concreto', 5000), atomo('2026-11', 'concreto', 787), atomo('2026-12', 'concreto', 3000)];

  it('mensual con plan mes a mes deja todo como estaba: una orden por mes, mismo id', () => {
    const g = consolidarOrdenes(concreto);
    expect(g.map(x => x.id)).toEqual(['2026-10|concreto', '2026-11|concreto', '2026-12|concreto']);
    expect(g.every(x => x.periodos.length === 1 && !x.juntadaPorMonto)).toBe(true);
  });

  it('bimestral abre la ventana con la primera necesidad y cubre dos meses calendario', () => {
    const g = consolidarOrdenes(concreto, { frecuencia: 'bimestral' });
    expect(g.map(x => x.periodos)).toEqual([['2026-10', '2026-11'], ['2026-12']]);
    expect(g[0].id).toBe('2026-10|concreto');   // el id es el del primer átomo
    expect(g[0].monto).toBe(5787);
  });

  it('la ventana no se alinea al calendario de la obra: abre cuando el rubro necesita', () => {
    // Nada en octubre: la ventana trimestral arranca en noviembre, no en octubre.
    const g = consolidarOrdenes([atomo('2026-11', 'acero', 10), atomo('2027-01', 'acero', 10), atomo('2027-02', 'acero', 10)],
      { frecuencia: 'trimestral' });
    expect(g.map(x => x.periodos)).toEqual([['2026-11', '2027-01'], ['2027-02']]);
  });

  it('«una sola» junta todo el rubro, y cada rubro va por separado', () => {
    const g = consolidarOrdenes([...concreto, atomo('2026-10', 'acero', 100)], { frecuencia: 'unica' });
    expect(g).toHaveLength(2);
    expect(g.find(x => x.rubro === 'concreto').periodos).toEqual(['2026-10', '2026-11', '2026-12']);
  });

  it('la frecuencia por rubro pisa la general', () => {
    const opts = { frecuencia: 'mensual', frecuenciaPorRubro: { seguridad: 'unica' } };
    expect(frecuenciaDeRubro('seguridad', opts)).toBe('unica');
    expect(frecuenciaDeRubro('concreto', opts)).toBe('mensual');
    expect(frecuenciaDeRubro('concreto', { frecuencia: 'cualquiera' })).toBe(FRECUENCIA_DEFAULT);
    const g = consolidarOrdenes([...concreto, atomo('2026-10', 'seguridad', 1), atomo('2026-12', 'seguridad', 1)], opts);
    expect(g.filter(x => x.rubro === 'seguridad')).toHaveLength(1);
    expect(g.filter(x => x.rubro === 'concreto')).toHaveLength(3);
  });

  it('monto mínimo: la chica se junta con la SIGUIENTE y se emite en la fecha de la primera', () => {
    const g = consolidarOrdenes([atomo('2026-10', 'concreto', 787), atomo('2026-11', 'concreto', 5000)], { montoMinimo: 3000 });
    expect(g).toHaveLength(1);
    expect(g[0].periodo).toBe('2026-10');       // nada llega tarde
    expect(g[0].periodos).toEqual(['2026-10', '2026-11']);
    expect(g[0].juntadaPorMonto).toBe(true);
  });

  it('monto mínimo: sigue juntando hasta llegar', () => {
    const g = consolidarOrdenes([atomo('2026-09', 'x', 500), atomo('2026-10', 'x', 500), atomo('2026-11', 'x', 2500), atomo('2026-12', 'x', 4000)],
      { montoMinimo: 3000 });
    expect(g.map(x => x.periodos)).toEqual([['2026-09', '2026-10', '2026-11'], ['2026-12']]);
  });

  it('monto mínimo: la última chica se suma a la ANTERIOR (que se emite antes)', () => {
    const g = consolidarOrdenes(concreto, { montoMinimo: 4000 });
    // oct 5000 ✓ · nov 787 + dic 3000 = 3787 < 4000 → se suma a octubre.
    expect(g).toHaveLength(1);
    expect(g[0].periodo).toBe('2026-10');
    expect(g[0].periodos).toEqual(['2026-10', '2026-11', '2026-12']);
  });

  it('un rubro que ni junto llega al mínimo se propone igual, marcado', () => {
    const g = consolidarOrdenes([atomo('2026-10', 'x', 100), atomo('2026-11', 'x', 100)], { montoMinimo: 3000 });
    expect(g).toHaveLength(1);
    expect(g[0].bajoMinimo).toBe(true);
  });

  it('el monto mínimo nunca junta rubros distintos', () => {
    const g = consolidarOrdenes([atomo('2026-10', 'a', 10), atomo('2026-10', 'b', 10)], { montoMinimo: 3000 });
    expect(g).toHaveLength(2);
  });

  it('las constantes que ofrece la pantalla', () => {
    expect(FRECUENCIAS).toEqual(['periodo', 'mensual', 'bimestral', 'trimestral', 'unica']);
    expect(FRECUENCIA_DEFAULT).toBe('mensual');
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('períodos que la consolidación necesita', () => {
  it('una semana es del mes de su jueves', () => {
    expect(mesDePeriodo('2026-10')).toBe('2026-10');
    expect(mesDePeriodo('2026-W40')).toBe('2026-10');   // 28-set → 4-oct: el jueves es 1-oct
    expect(mesDePeriodo('2026-W39')).toBe('2026-09');
    expect(mesDePeriodo('basura')).toBe('');
  });

  it('rangoDePeriodo se mudó al motor y dotación lo sigue exportando igual', () => {
    expect(rangoDePeriodo('2026-W41')).toEqual({ inicio: '2026-10-05', fin: '2026-10-11' });
    expect(rangoDesdeDotacion).toBe(rangoDePeriodo);
  });

  it('la ventana se nombra por meses', () => {
    expect(etiquetaVentana(['2026-10'])).toBe('octubre 2026');
    expect(etiquetaVentana(['2026-10', '2026-12'])).toBe('octubre a diciembre 2026');
    expect(etiquetaVentana(['2026-12', '2027-01'])).toBe('diciembre 2026 a enero 2027');
    expect(etiquetaVentana(['2026-W41', '2026-W42', '2026-W43'])).toBe('octubre 2026');
  });
});

// ═══════════════════════════════════════════════════════════════════
// EL MOTOR
// ═══════════════════════════════════════════════════════════════════

const PARTIDAS = [
  { id: 'p-oct', fecha_inicio_planificada: '2026-10-05', fecha_fin_planificada: '2026-10-10' },
  { id: 'p-nov', fecha_inicio_planificada: '2026-11-03', fecha_fin_planificada: '2026-11-08' },
  { id: 'p-dic', fecha_inicio_planificada: '2026-12-01', fecha_fin_planificada: '2026-12-06' },
];
const ip = (partida_id, codigo, nombre, unidad, cantidad, precio) => ({
  id: `${partida_id}-${codigo}`, partida_id, insumo_codigo: codigo, nombre_insumo: nombre, unidad,
  tipo_insumo: 'material', cantidad_presupuestada: cantidad, precio_presupuestado: precio,
  costo_presupuestado: cantidad * precio,
});
const INSUMOS = [
  ip('p-oct', 'CEM', 'CEMENTO PORTLAND TIPO I', 'bol', 100, 30),
  ip('p-nov', 'CEM', 'CEMENTO PORTLAND TIPO I', 'bol', 20, 30),
  ip('p-nov', 'ARE', 'ARENA GRUESA', 'm3', 5, 50),
  ip('p-dic', 'CEM', 'CEMENTO PORTLAND TIPO I', 'bol', 60, 30),
];
const correr = (extra = {}) => simularOrdenes({
  insumosPartida: INSUMOS, partidas: PARTIDAS, hoy: '2026-09-24', anclaje: 'cero', ...extra,
});
const deConcreto = (r) => r.propuestas.filter(p => p.rubro === 'concreto');

describe('el motor con consolidación', () => {
  it('sin tocar nada, mes a mes queda como antes y cada línea trae una entrega', () => {
    const r = correr();
    const c = deConcreto(r);
    expect(c.map(p => p.id)).toEqual(['2026-10|concreto', '2026-11|concreto', '2026-12|concreto']);
    for (const p of c) {
      expect(p.atomos).toEqual([{ id: p.id, periodo: p.periodo }]);
      for (const l of p.lineas) expect(l.entregas).toHaveLength(1);
    }
    expect(r.resumen.ordenesSinConsolidar).toBe(r.propuestas.length);
  });

  it('juntar no mueve plata y las entregas suman la línea', () => {
    const base = correr().resumen.montoPropuesto;
    for (const extra of [{ frecuencia: 'unica' }, { frecuencia: 'bimestral' }, { montoMinimoOrden: 2000 }]) {
      const r = correr(extra);
      expect(r.resumen.montoPropuesto).toBeCloseTo(base, 1);
      for (const p of r.propuestas) {
        for (const l of p.lineas) {
          expect(l.entregas.reduce((s, e) => s + e.cantidad, 0)).toBeCloseTo(l.cantidad, 3);
          expect(l.entregas.reduce((s, e) => s + e.monto, 0)).toBeCloseTo(l.monto, 1);
        }
      }
    }
  });

  it('«una sola»: UNA orden de concreto, el cemento en una línea con tres entregas', () => {
    const r = correr({ frecuencia: 'unica' });
    const [p] = deConcreto(r);
    expect(deConcreto(r)).toHaveLength(1);
    expect(p.id).toBe('2026-10|concreto');
    expect(p.titulo).toBe(`${p.rubroNombre} — octubre a diciembre 2026`);
    const cem = p.lineas.find(l => l.clave === 'CEM');
    expect(cem.cantidad).toBe(180);
    expect(cem.entregas.map(e => [e.periodo, e.cantidad])).toEqual([['2026-10', 100], ['2026-11', 20], ['2026-12', 60]]);
    // Cada entrega sabe de qué átomo viene: contra eso se guarda la decisión.
    expect(cem.entregas.map(e => e.propuestaId)).toEqual(['2026-10|concreto', '2026-11|concreto', '2026-12|concreto']);
    // La arena solo entrega en noviembre.
    expect(p.lineas.find(l => l.clave === 'ARE').entregas.map(e => e.periodo)).toEqual(['2026-11']);
  });

  it('monto mínimo: noviembre (S/ 850) se junta con diciembre y la orden sale en noviembre', () => {
    const r = correr({ montoMinimoOrden: 1000 });
    const c = deConcreto(r);
    expect(c.map(p => p.periodos)).toEqual([['2026-10'], ['2026-11', '2026-12']]);
    expect(c[1].id).toBe('2026-11|concreto');
    expect(c[1].juntadaPorMonto).toBe(true);
    expect(r.resumen.ordenesJuntadasPorMonto).toBe(1);
  });

  it('semana a semana, por defecto una orden por mes con las semanas como entregas', () => {
    const insumos = [ip('p-oct', 'CEM', 'CEMENTO PORTLAND TIPO I', 'bol', 100, 30)];
    const partidas = [{ id: 'p-oct', fecha_inicio_planificada: '2026-10-05', fecha_fin_planificada: '2026-11-20' }];
    const r = simularOrdenes({ insumosPartida: insumos, partidas, hoy: '2026-09-24', anclaje: 'cero', granularidad: 'semana' });
    expect(r.propuestas.map(p => p.etiquetaVentana)).toEqual(['octubre 2026', 'noviembre 2026']);
    expect(r.resumen.ordenesSinConsolidar).toBeGreaterThan(r.propuestas.length);
    // Con «una por período» vuelve a ser una por semana.
    const r2 = simularOrdenes({ insumosPartida: insumos, partidas, hoy: '2026-09-24', anclaje: 'cero', granularidad: 'semana', frecuencia: 'periodo' });
    expect(r2.propuestas.length).toBe(r.resumen.ordenesSinConsolidar);
  });
});

// ═══════════════════════════════════════════════════════════════════
// LAS DECISIONES SOBREVIVEN A REAGRUPAR
// ═══════════════════════════════════════════════════════════════════

describe('las decisiones viven en los átomos', () => {
  it('aceptar la orden juntada acepta cada mes; separarla después los deja aceptados', () => {
    const junta = correr({ frecuencia: 'unica' });
    const p = deConcreto(junta)[0];
    let esc = decidirPropuesta(nuevoEscenario({}), p, 'aceptada');
    expect(Object.keys(esc.decisiones.propuestas).sort())
      .toEqual(['2026-10|concreto', '2026-11|concreto', '2026-12|concreto']);

    const separada = aplicarEscenario(correr(), esc);
    for (const q of separada.propuestas.filter(x => x.rubro === 'concreto')) expect(q.estado).toBe('aceptada');
  });

  it('un escenario de antes de la 2.3 (decisión por id suelto) se lee sobre la orden juntada', () => {
    let esc = nuevoEscenario({});
    for (const id of ['2026-10|concreto', '2026-11|concreto', '2026-12|concreto']) esc = decidirPropuesta(esc, id, 'aceptada');
    const d = aplicarEscenario(correr({ frecuencia: 'unica' }), esc);
    const p = d.propuestas.find(x => x.rubro === 'concreto');
    expect(p.decision).toBe('aceptada');
    expect(p.estado).toBe('aceptada');
  });

  it('decidir UNA línea de la orden juntada la decide en todas sus entregas', () => {
    const d0 = aplicarEscenario(correr({ frecuencia: 'unica' }), nuevoEscenario({}));
    const p = d0.propuestas.find(x => x.rubro === 'concreto');
    const cem = p.lineas.find(l => l.clave === 'CEM');
    const esc = decidirLinea(nuevoEscenario({}), p, cem, 'rechazada');
    expect(Object.keys(esc.decisiones.lineas).sort()).toEqual([
      refLinea('2026-10|concreto', 'CEM'), refLinea('2026-11|concreto', 'CEM'), refLinea('2026-12|concreto', 'CEM'),
    ]);
    // Y separada, cada mes sigue con el cemento rechazado.
    const sep = aplicarEscenario(correr(), esc);
    for (const q of sep.propuestas.filter(x => x.rubro === 'concreto')) {
      expect(q.lineas.find(l => l.clave === 'CEM').decision).toBe('rechazada');
    }
  });

  it('entregas decididas distinto: la línea NO se entrega hasta volver a decidirla', () => {
    // Octubre aceptado, noviembre rechazado, cuando eran órdenes sueltas…
    let esc = decidirPropuesta(nuevoEscenario({}), '2026-10|concreto', 'aceptada');
    esc = decidirPropuesta(esc, '2026-11|concreto', 'rechazada');
    // …y después se juntan.
    const d = aplicarEscenario(correr({ frecuencia: 'unica' }), esc);
    const p = d.propuestas.find(x => x.rubro === 'concreto');
    const cem = p.lineas.find(l => l.clave === 'CEM');
    expect(cem.decisionMixta).toBe(true);
    expect(cem.decision).toBe('pendiente');
    expect(p.decision).toBe('pendiente');
    expect(d.resumen.lineasMixtas).toBeGreaterThan(0);
    expect(lineasAceptadas(d).lineas.find(l => l.clave === 'CEM')).toBeUndefined();
  });

  it('decidirPeriodo decide las órdenes que se EMITEN ese período, con todos sus átomos', () => {
    const r = correr({ frecuencia: 'unica' });
    const esc = decidirPeriodo(nuevoEscenario({}), '2026-10', 'aceptada', r.propuestas);
    expect(esc.decisiones.propuestas['2026-12|concreto']).toBe('aceptada');
  });
});

describe('una cantidad corregida vale para SUS entregas', () => {
  it('corregida sobre la orden juntada, no se aplica si la orden se separa', () => {
    const d0 = aplicarEscenario(correr({ frecuencia: 'unica' }), nuevoEscenario({}));
    const p = d0.propuestas.find(x => x.rubro === 'concreto');
    const cem = p.lineas.find(l => l.clave === 'CEM');
    const esc = editarLinea(nuevoEscenario({}), p, cem, { cantidad: 150 });
    expect(esc.ediciones[refLinea(p.id, 'CEM')].periodos_edicion).toBe('2026-10,2026-11,2026-12');

    const junta = aplicarEscenario(correr({ frecuencia: 'unica' }), esc).propuestas.find(x => x.rubro === 'concreto');
    expect(junta.lineas.find(l => l.clave === 'CEM').cantidad).toBe(150);
    expect(junta.lineas.find(l => l.clave === 'CEM').cantidadEditada).toBe(true);

    const oct = aplicarEscenario(correr(), esc).propuestas.find(x => x.id === '2026-10|concreto');
    const l = oct.lineas.find(x => x.clave === 'CEM');
    expect(l.cantidad).toBe(100);                 // la del plan, no 150
    expect(l.edicionOtroAgrupamiento).toBe(true);
  });

  it('una corrección de antes de la 2.3 (sin firma) vale mientras la línea tenga una sola entrega', () => {
    const esc = { ...nuevoEscenario({}), ediciones: { [refLinea('2026-10|concreto', 'CEM')]: { cantidad: 90, unidad_edicion: 'bol' } } };
    const sola = aplicarEscenario(correr(), esc).propuestas.find(x => x.id === '2026-10|concreto');
    expect(sola.lineas.find(l => l.clave === 'CEM').cantidad).toBe(90);
    const junta = aplicarEscenario(correr({ frecuencia: 'unica' }), esc).propuestas.find(x => x.rubro === 'concreto');
    const l = junta.lineas.find(x => x.clave === 'CEM');
    expect(l.cantidad).toBe(180);
    expect(l.edicionOtroAgrupamiento).toBe(true);
  });

  it('el proveedor y el nombre puestos a un mes suelto siguen valiendo al juntarse', () => {
    const d0 = aplicarEscenario(correr(), nuevoEscenario({}));
    const nov = d0.propuestas.find(x => x.id === '2026-11|concreto');
    const esc = editarLinea(nuevoEscenario({}), nov, nov.lineas.find(l => l.clave === 'ARE'), { proveedor_nombre: 'AGREGADOS SAC' });
    const junta = aplicarEscenario(correr({ frecuencia: 'unica' }), esc).propuestas.find(x => x.rubro === 'concreto');
    expect(junta.lineas.find(l => l.clave === 'ARE').proveedor_nombre).toBe('AGREGADOS SAC');
  });

  it('«volver al expediente» borra también las correcciones de los meses sueltos', () => {
    const d0 = aplicarEscenario(correr(), nuevoEscenario({}));
    const nov = d0.propuestas.find(x => x.id === '2026-11|concreto');
    let esc = editarLinea(nuevoEscenario({}), nov, nov.lineas.find(l => l.clave === 'ARE'), { nombre: 'ARENA' });
    const junta = aplicarEscenario(correr({ frecuencia: 'unica' }), esc).propuestas.find(x => x.rubro === 'concreto');
    esc = limpiarEdicion(esc, junta, junta.lineas.find(l => l.clave === 'ARE'));
    expect(esc.ediciones).toEqual({});
  });
});

describe('los parámetros del escenario', () => {
  it('defaults: mensual, sin frecuencias propias y SIN monto mínimo', () => {
    expect(PARAMS_DEFAULT.frecuencia).toBe('mensual');
    expect(PARAMS_DEFAULT.frecuenciaPorRubro).toEqual({});
    expect(PARAMS_DEFAULT.montoMinimoOrden).toBe(0);
  });

  it('un escenario viejo sin estos campos se abre con los defaults', () => {
    const p = normalizarParams({ granularidad: 'mes' });
    expect(p.frecuencia).toBe('mensual');
    expect(p.montoMinimoOrden).toBe(0);
  });

  it('se sanea: rubro inexistente, frecuencia inventada y monto negativo', () => {
    const p = normalizarParams({
      frecuencia: 'diaria', montoMinimoOrden: -5,
      frecuenciaPorRubro: { concreto: 'unica', marciano: 'unica', acero: 'semanal' },
    });
    expect(p.frecuencia).toBe('mensual');
    expect(p.montoMinimoOrden).toBe(0);
    expect(p.frecuenciaPorRubro).toEqual({ concreto: 'unica' });
  });

  it('el orden en que se tocaron los rubros no hace dos escenarios distintos', () => {
    expect(mismosParams(
      { frecuenciaPorRubro: { concreto: 'unica', acero: 'bimestral' } },
      { frecuenciaPorRubro: { acero: 'bimestral', concreto: 'unica' } },
    )).toBe(true);
  });

  it('llegan al motor', () => {
    const m = paramsDeMotor({ frecuencia: 'bimestral', montoMinimoOrden: 2500, frecuenciaPorRubro: { concreto: 'unica' } });
    expect(m).toMatchObject({ frecuencia: 'bimestral', montoMinimoOrden: 2500, frecuenciaPorRubro: { concreto: 'unica' } });
  });
});

// ═══════════════════════════════════════════════════════════════════
// EL PUENTE: la requisición lleva el cronograma
// ═══════════════════════════════════════════════════════════════════

describe('las entregas llegan a la requisición y a la orden', () => {
  const aceptadoJunto = () => {
    const r = correr({ frecuencia: 'unica' });
    const p = r.propuestas.find(x => x.rubro === 'concreto');
    const esc = decidirPropuesta(nuevoEscenario({}), p, 'aceptada');
    return lineasAceptadas(aplicarEscenario(r, esc));
  };

  it('lineasAceptadas trae la tabla de entregas y la ventana', () => {
    const cem = aceptadoJunto().lineas.find(l => l.clave === 'CEM');
    expect(cem.entregas.map(e => e.cantidad)).toEqual([100, 20, 60]);
    expect(cem.etiquetaVentana).toBe('octubre a diciembre 2026');
    expect(cem.periodo).toBe('2026-10');
  });

  it('la observación de cada ítem dice cuánto va en cada mes, y se vuelve a leer', () => {
    const { requisiciones } = armarRequisiciones({ lineas: aceptadoJunto().lineas, obraId: 'o1', hoy: '2026-09-24' });
    expect(requisiciones).toHaveLength(1);
    const { requisicion, items } = requisiciones[0];
    expect(requisicion.fecha_necesidad).toBe('2026-10-01');       // la primera entrega
    expect(requisicion.descripcion).toBe('Plan de obra — octubre a diciembre 2026');
    const cem = items.find(it => it.insumo_codigo === 'CEM');
    expect(cem.observacion).toBe('Entregas — octubre 2026: 100; noviembre 2026: 20; diciembre 2026: 60 (bol)');
    expect(periodosDeEntregas(cem.observacion)).toEqual(['octubre 2026', 'noviembre 2026', 'diciembre 2026']);
    // La arena llega toda junta: sin cronograma.
    expect(items.find(it => it.insumo_codigo === 'ARE').observacion).toBe(null);
  });

  it('la orden emitida lo dice en su cabecera (fecha_entrega_ref)', () => {
    const { requisiciones } = armarRequisiciones({ lineas: aceptadoJunto().lineas, obraId: 'o1', hoy: '2026-09-24' });
    const { requisicion, items } = requisiciones[0];
    const b = borradorDeOrdenDesdeRequisicion({
      requisicion, items,
      obra: { id: 'o1', ejecutora_company_id: 'c1', ejecutora_tipo: 'empresa' },
      company: { id: 'c1', name: 'EJECUTORA' },
      proveedor: { nombre: 'FERRETERÍA' },
      hoy: '2026-09-24',
    });
    expect(b.ok).toBe(true);
    expect(b.orden.fecha_entrega_ref).toBe('Entregas parciales: octubre 2026, noviembre 2026, diciembre 2026 (cantidades por línea en la requisición)');
  });

  describe('el freno contra escribir dos veces es por línea', () => {
    const escrita = { id: 'r1', origen_ref: '2026-10|concreto', estado: 'borrador', origen: 'simulador' };
    const item = { id: 'ri1', requisicion_id: 'r1', insumo_codigo: 'CEM', cantidad: 100 };
    const linea = (over) => ({
      propuesta_id: '2026-10|concreto', periodo: '2026-10', subcategoria: 'material',
      insumo_codigo: 'CEM', descripcion: 'CEMENTO', unidad: 'bol', cantidad: 100, precio_unitario: 30, monto: 3000, ...over,
    });

    it('la misma línea, con la misma cantidad, ya está escrita (el segundo click)', () => {
      const r = armarRequisiciones({ lineas: [linea()], obraId: 'o1', yaEscritas: [escrita], yaEscritasItems: [item] });
      expect(r.duplicadas).toHaveLength(1);
      expect(r.requisiciones).toHaveLength(0);
    });

    it('una entrega NUEVA que cayó en la orden ya escrita a medias SÍ se escribe', () => {
      // Octubre se escribió; después noviembre y diciembre se juntaron con
      // octubre y lo que queda del cemento son 80 bolsas nuevas.
      const r = armarRequisiciones({ lineas: [linea({ cantidad: 80 })], obraId: 'o1', yaEscritas: [escrita], yaEscritasItems: [item] });
      expect(r.duplicadas).toHaveLength(0);
      expect(r.requisiciones).toHaveLength(1);
    });

    it('una línea SIN código no se puede descontar: si su propuesta ya se escribió, no se repite', () => {
      const r = armarRequisiciones({ lineas: [linea({ insumo_codigo: null, cantidad: 80 })], obraId: 'o1', yaEscritas: [escrita], yaEscritasItems: [item] });
      expect(r.duplicadas).toHaveLength(1);
    });

    it('sin los ítems, el freno es el de siempre: por propuesta', () => {
      const r = armarRequisiciones({ lineas: [linea({ cantidad: 80 })], obraId: 'o1', yaEscritas: [escrita] });
      expect(r.duplicadas).toHaveLength(1);
    });

    it('una requisición cancelada no frena nada', () => {
      const r = armarRequisiciones({ lineas: [linea()], obraId: 'o1', yaEscritas: [{ ...escrita, estado: 'cancelada' }], yaEscritasItems: [item] });
      expect(r.requisiciones).toHaveLength(1);
    });
  });

  it('con una sola entrega no se escribe cronograma ni referencia', () => {
    expect(textoDeEntregas({ entregas: [{ periodo: '2026-10', cantidad: 5 }], unidad: 'bol' })).toBe(null);
    expect(referenciaDeEntregas([{ observacion: 'Proveedor sugerido: X' }])).toBe(null);
  });

  it('cantidad corregida a mano: las entregas se coordinan, no se escribe un cronograma que no suma', () => {
    const l = { entregas: null, periodos: ['2026-10', '2026-11'], unidad: 'bol' };
    expect(textoDeEntregas(l)).toBe(ENTREGAS_A_COORDINAR);
    expect(referenciaDeEntregas([{ observacion: ENTREGAS_A_COORDINAR }])).toBe('Entregas parciales a coordinar con obra');
  });
});
