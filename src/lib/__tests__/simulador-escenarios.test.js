// ═══════════════════════════════════════════════════════════════════
// Tests del estado de la pantalla del simulador (tanda 3).
//
// Lo que estos tests protegen, y no es obvio: una decisión tiene que
// sobrevivir a que se vuelva a correr el motor. Gabriel va a mirar el plan
// «desde hoy», aceptar medio octubre, cambiar a «solo lo que falta» para
// comparar y volver. Si las decisiones se perdieran en ese viaje, la
// pantalla sería inusable justo para lo que existe (§3 del plan: comparar
// escenarios sin recalcular a mano).
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { simularOrdenes } from '../simulador-ordenes.js';
import {
  PARAMS_DEFAULT, normalizarParams, paramsDeMotor, mismosParams,
  nuevoEscenario, normalizarEscenario, conParams,
  claveLinea, refLinea,
  decidirPropuesta, decidirLinea, decidirPeriodo,
  editarLinea, limpiarEdicion, proveedorDePropuesta,
  decidirSobre, agregarLineaSobre, editarLineaSobre, quitarLineaSobre, proveedorDeSobre,
  aplicarEscenario, lineasAceptadas,
  leerEscenarios, guardarEscenario, guardarEscenarios, borrarEscenario, claveStorage,
  leerCompras, guardarCompra, claveStorageCompras,
  categoriaDePropuesta,
} from '../simulador-escenarios.js';

// ── Un localStorage de mentira, para no depender del browser ──
function storageFalso() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}

// ── Un presupuesto chico pero con los tres casos que importan ──
const PARTIDAS = [
  { id: 'p1', codigo: '01.01', descripcion: 'Muros de ladrillo',
    fecha_inicio_planificada: '2026-10-05', fecha_fin_planificada: '2026-10-20' },
  { id: 'p2', codigo: '01.02', descripcion: 'Instalaciones sanitarias',
    fecha_inicio_planificada: '2026-11-02', fecha_fin_planificada: '2026-11-25' },
];

const INSUMOS = [
  { id: 'i1', partida_id: 'p1', insumo_codigo: 'MAT-001', nombre_insumo: 'CEMENTO PORTLAND TIPO I',
    unidad: 'bls', tipo_insumo: 'material', cantidad_presupuestada: 100, precio_presupuestado: 30,
    costo_presupuestado: 3000 },
  { id: 'i2', partida_id: 'p1', insumo_codigo: 'MAT-002', nombre_insumo: 'LADRILLO KING KONG',
    unidad: 'und', tipo_insumo: 'material', cantidad_presupuestada: 2000, precio_presupuestado: 1.5,
    costo_presupuestado: 3000 },
  { id: 'i3', partida_id: 'p2', insumo_codigo: 'MAT-003', nombre_insumo: 'TUBERIA PVC 4"',
    unidad: 'm', tipo_insumo: 'material', cantidad_presupuestada: 500, precio_presupuestado: 12,
    costo_presupuestado: 6000 },
  // Desde el 22-set las órdenes se agrupan por RUBRO DE PROVEEDOR, no por
  // subcategoría: cemento y ladrillo ya no caen juntos («concreto» vs
  // «acabados»). La arena va con el cemento y es lo que deja probar la
  // decisión por LÍNEA, que necesita una orden con más de una.
  { id: 'i4', partida_id: 'p1', insumo_codigo: 'MAT-004', nombre_insumo: 'ARENA GRUESA',
    unidad: 'm3', tipo_insumo: 'material', cantidad_presupuestada: 40, precio_presupuestado: 50,
    costo_presupuestado: 2000 },
];

/** La orden con más de una línea, que es donde se puede decidir por línea. */
const conVariasLineas = (c) => c.propuestas.find(p => p.lineas.length > 1);

const corrida = (extra = {}) => simularOrdenes({
  insumosPartida: INSUMOS, partidas: PARTIDAS,
  hoy: '2026-10-01', ...paramsDeMotor(PARAMS_DEFAULT), ...extra,
});

describe('normalizarParams — un escenario viejo siempre se puede abrir', () => {
  it('sin nada devuelve los defaults', () => {
    expect(normalizarParams()).toEqual(PARAMS_DEFAULT);
  });

  it('un valor que ya no existe cae al default en vez de romper', () => {
    const p = normalizarParams({ modo: 'lo_que_sea', cronograma: 'ninguno', reparto: 'xx', granularidad: 'dia' });
    expect(p.modo).toBe('real');
    expect(p.cronograma).toBe('gantt');
    expect(p.reparto).toBe('parejo');
    expect(p.granularidad).toBe('mes');
  });

  it('la mano de obra NO entra al filtro de órdenes por defecto (§5)', () => {
    expect(PARAMS_DEFAULT.categorias).not.toContain('mano_obra');
  });

  it('una categoría inventada se descarta y si no queda ninguna vuelve al default', () => {
    expect(normalizarParams({ categorias: ['materiales', 'humo'] }).categorias).toEqual(['materiales']);
    expect(normalizarParams({ categorias: ['humo'] }).categorias).toEqual(PARAMS_DEFAULT.categorias);
    expect(normalizarParams({ categorias: [] }).categorias).toEqual(PARAMS_DEFAULT.categorias);
  });

  it('los números fuera de rango se recortan, no explotan', () => {
    expect(normalizarParams({ anticipacionDias: -40 }).anticipacionDias).toBe(0);
    expect(normalizarParams({ anticipacionDias: 99999 }).anticipacionDias).toBe(365);
    expect(normalizarParams({ anticipacionDias: 'quince' }).anticipacionDias).toBe(0);
    expect(normalizarParams({ umbralTramoLargoDias: 0 }).umbralTramoLargoDias).toBe(1);
  });

  it('la jornada se sanea sin dejarla en cero horas', () => {
    const j = normalizarParams({ jornada: { horasPorDia: 0, diasSemana: [9, 1, 1], factorEfectivo: 5 } }).jornada;
    expect(j.horasPorDia).toBe(8);
    expect(j.diasSemana).toEqual([1]);
    expect(j.factorEfectivo).toBe(1);
  });

  it('paramsDeMotor no le manda al motor lo que el motor no entiende', () => {
    expect(Object.keys(paramsDeMotor(PARAMS_DEFAULT)).sort()).toEqual([
      // tanda 2.5: qué resta el almacén
      'almacenModo', 'almacenPorInsumo',
      'anclaje', 'anticipacionDias', 'categorias', 'cronograma',
      // tanda 2.3: cómo se juntan las órdenes
      'frecuencia', 'frecuenciaPorRubro',
      'granularidad', 'montoMinimoOrden', 'reparto', 'umbralTramoLargoDias',
    ]);
  });

  it('mismosParams compara la pregunta, no el objeto', () => {
    expect(mismosParams(PARAMS_DEFAULT, { ...PARAMS_DEFAULT })).toBe(true);
    expect(mismosParams(PARAMS_DEFAULT, { ...PARAMS_DEFAULT, modo: 'simulacion' })).toBe(false);
  });
});

describe('ronda 3 — los dos modos y la migración de los escenarios guardados (tanda 3.1)', () => {
  it('el modo manda el anclaje del motor: simulación = cero, real = desde hoy', () => {
    expect(paramsDeMotor({ modo: 'simulacion' }).anclaje).toBe('cero');
    expect(paramsDeMotor({ modo: 'real' }).anclaje).toBe('hoy');
    expect(paramsDeMotor(PARAMS_DEFAULT).anclaje).toBe('hoy');
  });

  it('un escenario de antes de la ronda 3 se abre en el modo que le corresponde', () => {
    // 'cero' era la auditoría: una simulación. 'hoy' y el retirado
    // 'restante' preguntaban por lo real.
    expect(normalizarParams({ anclaje: 'cero' }).modo).toBe('simulacion');
    expect(normalizarParams({ anclaje: 'hoy' }).modo).toBe('real');
    expect(normalizarParams({ anclaje: 'restante' }).modo).toBe('real');
    expect(normalizarParams({ anclaje: 'cero' })).not.toHaveProperty('anclaje');
  });

  it('las opciones que pedían un dato que nadie carga se abren con el default', () => {
    // «Reprogramado a mano», «por cuadrilla» y «manual» terminaban en «Sin
    // planificar» (§15.1 punto 4): la pantalla ya no las ofrece.
    expect(normalizarParams({ cronograma: 'reprogramado' }).cronograma).toBe('gantt');
    expect(normalizarParams({ reparto: 'cuadrilla' }).reparto).toBe('parejo');
    expect(normalizarParams({ reparto: 'manual' }).reparto).toBe('parejo');
    expect(normalizarParams({ reparto: 'inicio' }).reparto).toBe('inicio');
    expect(normalizarParams({ cronograma: 'sin_cronograma' }).cronograma).toBe('sin_cronograma');
  });

  it('el cronograma «aleatorio por escenario» guarda su historia y su semilla (tanda 3.3)', () => {
    expect(PARAMS_DEFAULT).toMatchObject({ historia: 'azar', semilla: 1, historiaAjustes: {} });
    const p = normalizarParams({ cronograma: 'escenario', historia: 'frenazo', semilla: 482913, reparto: 'escenario' });
    expect(p).toMatchObject({ cronograma: 'escenario', historia: 'frenazo', semilla: 482913, reparto: 'escenario' });
    // Una historia que salió del catálogo se abre «al azar»; una semilla rota es 1.
    expect(normalizarParams({ historia: 'la-de-ayer', semilla: 'x' })).toMatchObject({ historia: 'azar', semilla: 1 });
    // Los ajustes se recortan a los rangos de SU historia, y sin historia no hay.
    expect(normalizarParams({ historia: 'frenazo', historiaAjustes: { ritmo: 0.1, basura: 3 } }).historiaAjustes).toEqual({ ritmo: 0.45 });
    expect(normalizarParams({ historia: 'azar', historiaAjustes: { ritmo: 0.5 } }).historiaAjustes).toEqual({});
  });

  it('el motor no conoce «escenario» como cronograma: sin la traducción de la pantalla corre el Gantt', () => {
    // La historia llega como `reprogramacion` desde armarCronograma(); acá no
    // hay de dónde sacarla, y un cronograma a medias sería peor que el Gantt.
    expect(paramsDeMotor({ cronograma: 'escenario' }).cronograma).toBe('gantt');
    expect(paramsDeMotor({ reparto: 'escenario' }).reparto).toBe('escenario');
  });

  it('el arranque arranca en el Gantt, y «una fecha» sin fecha todavía no se pierde', () => {
    expect(PARAMS_DEFAULT.arranque).toBe('gantt');
    const p = normalizarParams({ arranque: 'fecha', arranqueFecha: 'mañana' });
    expect(p.arranque).toBe('fecha');
    expect(p.arranqueFecha).toBe(null);
    expect(normalizarParams({ arranque: 'fecha', arranqueFecha: '2027-01-04' }).arranqueFecha).toBe('2027-01-04');
    expect(normalizarParams({ arranque: 'ayer' }).arranque).toBe('gantt');
  });

  it('cambiar de modo NO borra lo decidido', () => {
    const c = corrida();
    const p0 = c.propuestas[0];
    let e = decidirPropuesta(nuevoEscenario({}), p0, 'aceptada');
    e = conParams(e, { modo: 'simulacion' });
    const c2 = corrida(paramsDeMotor(e.params));
    expect(aplicarEscenario(c2, e).propuestas.find(p => p.id === p0.id)?.estado).toBe('aceptada');
  });
});

describe('categoriaDePropuesta — en qué pestaña va una orden (tanda 3.1)', () => {
  it('va entera a la categoría que más plata pesa, y dice qué más trae', () => {
    const r = categoriaDePropuesta({
      categoria: 'materiales',
      lineas: [
        { categoria: 'materiales', monto: 100 },
        { categoria: 'herramientas', monto: 900 },
        { categoria: 'herramientas', monto: 50 },
      ],
    });
    expect(r.categoria).toBe('herramientas');
    expect(r.mezcla).toEqual({ materiales: 1 });
  });

  it('empate o sin montos: la de la orden (la de su primera línea)', () => {
    expect(categoriaDePropuesta({ categoria: 'servicios', lineas: [
      { categoria: 'servicios', monto: 0 }, { categoria: 'materiales', monto: 0 },
    ] }).categoria).toBe('servicios');
  });

  it('una orden pura no trae mezcla', () => {
    const c = corrida();
    for (const p of c.propuestas) {
      const r = categoriaDePropuesta(p);
      expect(r.categoria).toBe('materiales');
      expect(r.mezcla).toEqual({});
    }
  });
});

describe('claves estables', () => {
  it('la del motor manda si vino', () => {
    expect(claveLinea({ clave: 'MAT-001', nombre: 'otra cosa' })).toBe('MAT-001');
  });
  it('sin clave usa el código del insumo', () => {
    expect(claveLinea({ insumo_codigo: 'MAT-009' })).toBe('MAT-009');
  });
  it('sin código cae a nombre+unidad, normalizado', () => {
    expect(claveLinea({ nombre: '  Cemento  ', unidad: 'BLS' })).toBe('~cemento|bls');
  });
  it('el motor devuelve la clave en cada línea (contrato con la tanda 1)', () => {
    const { propuestas } = corrida();
    for (const p of propuestas) for (const l of p.lineas) expect(l.clave).toBeTruthy();
  });
});

describe('decidir — la decisión sobrevive a volver a correr el motor', () => {
  it('aceptar una orden marca todas sus líneas', () => {
    const c = corrida();
    const p0 = c.propuestas[0];
    const esc = decidirPropuesta(nuevoEscenario({}), p0.id, 'aceptada');
    const { propuestas, resumen } = aplicarEscenario(c, esc);
    const d = propuestas.find(p => p.id === p0.id);
    expect(d.estado).toBe('aceptada');
    expect(d.lineas.every(l => l.decision === 'aceptada')).toBe(true);
    expect(resumen.lineasAceptadas).toBe(p0.lineas.length);
    expect(resumen.montoAceptado).toBeCloseTo(p0.monto, 2);
  });

  it('la decisión de la línea le gana a la de su orden', () => {
    const c = corrida();
    const p0 = conVariasLineas(c);
    let esc = decidirPropuesta(nuevoEscenario({}), p0.id, 'aceptada');
    esc = decidirLinea(esc, p0.id, p0.lineas[0], 'rechazada');
    const { propuestas, resumen } = aplicarEscenario(c, esc);
    const d = propuestas.find(p => p.id === p0.id);
    expect(d.estado).toBe('parcial');
    expect(d.lineas[0].decision).toBe('rechazada');
    expect(d.lineas[0].decisionHeredada).toBe(false);
    expect(d.lineas[1].decisionHeredada).toBe(true);
    expect(resumen.montoAceptado).toBeCloseTo(p0.monto - p0.lineas[0].monto, 2);
  });

  it('re-decidir la orden limpia las excepciones de sus líneas', () => {
    // Si no lo hiciera, «acepto todo» dejaría adentro una línea rechazada
    // hace diez minutos y el total de arriba no cerraría con lo de abajo.
    const c = corrida();
    const p0 = c.propuestas[0];
    let esc = decidirLinea(nuevoEscenario({}), p0.id, p0.lineas[0], 'rechazada');
    esc = decidirPropuesta(esc, p0.id, 'aceptada');
    const d = aplicarEscenario(c, esc).propuestas.find(p => p.id === p0.id);
    expect(d.estado).toBe('aceptada');
  });

  it('decidir un período decide todas las órdenes de ese tramo', () => {
    const c = corrida();
    const periodo = c.propuestas[0].periodo;
    const esc = decidirPeriodo(nuevoEscenario({}), periodo, 'aceptada', c.propuestas);
    const { propuestas } = aplicarEscenario(c, esc);
    for (const p of propuestas) {
      expect(p.estado).toBe(p.periodo === periodo ? 'aceptada' : 'pendiente');
    }
  });

  it('LO QUE MÁS IMPORTA: cambiar de parámetros no borra lo decidido', () => {
    const c1 = corrida();
    const p0 = c1.propuestas[0];
    const esc = decidirPropuesta(nuevoEscenario({}), p0.id, 'aceptada');

    // La misma obra, otra granularidad y otro anclaje: el motor reconstruye
    // todo. La propuesta de ese mes sigue llamándose igual porque su id es
    // `período|subcategoría`, y la decisión la vuelve a encontrar.
    const c2 = corrida({ anclaje: 'cero' });
    const d = aplicarEscenario(c2, esc).propuestas.find(p => p.id === p0.id);
    expect(d, 'la propuesta del mismo período/subcategoría tiene que existir').toBeTruthy();
    expect(d.estado).toBe('aceptada');
  });

  it('volver a «pendiente» borra la decisión, no la guarda como tal', () => {
    const c = corrida();
    const p0 = c.propuestas[0];
    let esc = decidirPropuesta(nuevoEscenario({}), p0.id, 'aceptada');
    esc = decidirPropuesta(esc, p0.id, 'pendiente');
    expect(esc.decisiones.propuestas[p0.id]).toBeUndefined();
    expect(aplicarEscenario(c, esc).resumen.lineasAceptadas).toBe(0);
  });
});

describe('editar — el expediente es el punto de partida, el desvío se ve', () => {
  it('cambiar el precio recalcula el monto y muestra contra qué', () => {
    const c = corrida();
    const p0 = c.propuestas[0];
    const l0 = p0.lineas[0];
    let esc = decidirPropuesta(nuevoEscenario({}), p0.id, 'aceptada');
    esc = editarLinea(esc, p0.id, l0, { precio_unitario: l0.precio_unitario * 2 });
    const d = aplicarEscenario(c, esc).propuestas.find(p => p.id === p0.id);
    const ed = d.lineas.find(l => l.clave === l0.clave);
    expect(ed.monto).toBeCloseTo(l0.cantidad * l0.precio_unitario * 2, 2);
    expect(ed.montoOriginal).toBeCloseTo(l0.monto, 2);
    expect(ed.desvio).toBeCloseTo(ed.monto - l0.monto, 2);
    expect(ed.editada).toBe(true);
  });

  it('SIN edición el monto es el del expediente, no cantidad × precio', () => {
    // `costo_presupuestado` no siempre es cantidad × precio; pisarlo cambiaría
    // el presupuesto sin que nadie lo pidiera.
    const insumos = [{ ...INSUMOS[0], costo_presupuestado: 3333 }];
    const c = simularOrdenes({ insumosPartida: insumos, partidas: PARTIDAS, hoy: '2026-10-01' });
    const d = aplicarEscenario(c, nuevoEscenario({})).propuestas[0];
    expect(d.lineas[0].monto).toBeCloseTo(3333, 2);
  });

  it('renombrar guarda el nombre original al lado', () => {
    const c = corrida();
    const p0 = c.propuestas[0];
    const esc = editarLinea(nuevoEscenario({}), p0.id, p0.lineas[0], { nombre: 'Cemento sol' });
    const d = aplicarEscenario(c, esc).propuestas.find(p => p.id === p0.id);
    expect(d.lineas[0].nombre).toBe('Cemento sol');
    expect(d.lineas[0].nombreOriginal).toBe(p0.lineas[0].nombre);
  });

  it('vaciar un campo VUELVE al presupuesto, no lo pone en cero', () => {
    const c = corrida();
    const p0 = c.propuestas[0];
    const l0 = p0.lineas[0];
    let esc = editarLinea(nuevoEscenario({}), p0.id, l0, { cantidad: 7 });
    esc = editarLinea(esc, p0.id, l0, { cantidad: '' });
    const d = aplicarEscenario(c, esc).propuestas.find(p => p.id === p0.id);
    expect(d.lineas[0].cantidad).toBeCloseTo(l0.cantidad, 4);
    expect(d.lineas[0].editada).toBe(false);
  });

  it('una cantidad negativa no se guarda', () => {
    const c = corrida();
    const p0 = c.propuestas[0];
    const esc = editarLinea(nuevoEscenario({}), p0.id, p0.lineas[0], { cantidad: -5 });
    expect(Object.keys(esc.ediciones)).toEqual([]);
  });

  it('limpiarEdicion deshace todo lo corregido de esa línea', () => {
    const c = corrida();
    const p0 = c.propuestas[0];
    let esc = editarLinea(nuevoEscenario({}), p0.id, p0.lineas[0], { nombre: 'X', precio_unitario: 99 });
    esc = limpiarEdicion(esc, p0.id, p0.lineas[0]);
    expect(esc.ediciones[refLinea(p0.id, claveLinea(p0.lineas[0]))]).toBeUndefined();
  });

  it('el proveedor se elige UNA vez para toda la orden', () => {
    // Es el caso normal (§6): una orden se le emite a un proveedor. Elegirlo
    // línea por línea en una orden de 167 insumos no lo hace nadie.
    const c = corrida();
    const p0 = c.propuestas[0];
    let esc = decidirPropuesta(nuevoEscenario({}), p0.id, 'aceptada');
    esc = proveedorDePropuesta(esc, p0.id, p0.lineas, { id: 'c1', nombre: 'FERRETERÍA SAC' });
    const { propuestas, resumen } = aplicarEscenario(c, esc);
    const d = propuestas.find(p => p.id === p0.id);
    expect(d.lineas.every(l => l.proveedor_id === 'c1')).toBe(true);
    expect(resumen.lineasSinProveedor).toBe(0);
  });

  it('y se puede pisar en una línea suelta sin tocar el resto', () => {
    const c = corrida();
    const p0 = conVariasLineas(c);
    let esc = decidirPropuesta(nuevoEscenario({}), p0.id, 'aceptada');
    esc = proveedorDePropuesta(esc, p0.id, p0.lineas, { id: 'c1', nombre: 'FERRETERÍA SAC' });
    esc = editarLinea(esc, p0.id, p0.lineas[0], { proveedor_id: 'c2', proveedor_nombre: 'OTRA SAC' });
    const d = aplicarEscenario(c, esc).propuestas.find(p => p.id === p0.id);
    expect(d.lineas[0].proveedor_nombre).toBe('OTRA SAC');
    expect(d.lineas[1].proveedor_nombre).toBe('FERRETERÍA SAC');
  });

  it('con `soloAceptadas` no le pone proveedor a lo que no se va a emitir', () => {
    const c = corrida();
    const p0 = conVariasLineas(c);
    let esc = decidirLinea(nuevoEscenario({}), p0.id, p0.lineas[0], 'aceptada');
    const conDecision = aplicarEscenario(c, esc).propuestas.find(p => p.id === p0.id);
    esc = proveedorDePropuesta(esc, p0.id, conDecision.lineas, { id: 'c1', nombre: 'FERRE' }, { soloAceptadas: true });
    const d = aplicarEscenario(c, esc).propuestas.find(p => p.id === p0.id);
    expect(d.lineas[0].proveedor_id).toBe('c1');
    expect(d.lineas[1].proveedor_id).toBeNull();
  });

  it('elegir «— ninguno —» borra el proveedor de toda la orden', () => {
    const c = corrida();
    const p0 = c.propuestas[0];
    let esc = proveedorDePropuesta(nuevoEscenario({}), p0.id, p0.lineas, { id: 'c1', nombre: 'FERRE' });
    esc = proveedorDePropuesta(esc, p0.id, p0.lineas, { id: null, nombre: '' });
    const d = aplicarEscenario(c, esc).propuestas.find(p => p.id === p0.id);
    expect(d.lineas.every(l => l.proveedor_id === null)).toBe(true);
    expect(d.lineas.every(l => l.editada === false)).toBe(true);
  });

  it('un proveedor escrito a mano que no está en el catálogo se guarda igual', () => {
    // El catálogo tiene 549 proveedores y no todos están: obligarlo a elegir
    // de la lista dejaría el plan sin proveedor justo en los casos nuevos.
    const c = corrida();
    const p0 = c.propuestas[0];
    const esc = proveedorDePropuesta(nuevoEscenario({}), p0.id, p0.lineas, { id: null, nombre: 'FERRETERÍA DEL BARRIO' });
    const d = aplicarEscenario(c, esc).propuestas.find(p => p.id === p0.id);
    expect(d.lineas[0].proveedor_nombre).toBe('FERRETERÍA DEL BARRIO');
    expect(d.lineas[0].proveedor_id).toBeNull();
  });

  it('el proveedor se guarda por línea y se cuenta lo que no lo tiene', () => {
    const c = corrida();
    const p0 = c.propuestas[0];
    let esc = decidirPropuesta(nuevoEscenario({}), p0.id, 'aceptada');
    esc = editarLinea(esc, p0.id, p0.lineas[0], { proveedor_id: 'c1', proveedor_nombre: 'FERRETERÍA SAC' });
    const { propuestas, resumen } = aplicarEscenario(c, esc);
    const d = propuestas.find(p => p.id === p0.id);
    expect(d.proveedores).toEqual(['FERRETERÍA SAC']);
    expect(resumen.lineasSinProveedor).toBe(p0.lineas.length - 1);
  });
});

describe('lo que no se sabe no se totaliza', () => {
  const sinPrecio = [{
    id: 'x1', partida_id: 'p1', insumo_codigo: 'MAT-404', nombre_insumo: 'INSUMO SIN PRECIO',
    unidad: 'und', tipo_insumo: 'material', cantidad_presupuestada: 10, precio_presupuestado: 0,
  }];

  it('una línea aceptada sin precio se cuenta aparte, no como cero', () => {
    const c = simularOrdenes({ insumosPartida: sinPrecio, partidas: PARTIDAS, hoy: '2026-10-01' });
    const p0 = c.propuestas[0];
    const esc = decidirPropuesta(nuevoEscenario({}), p0.id, 'aceptada');
    const { resumen, propuestas } = aplicarEscenario(c, esc);
    expect(resumen.lineasSinPrecio).toBe(1);
    expect(propuestas[0].lineasAceptadasSinPrecio).toBe(1);
  });

  it('y NO se entrega a la tanda 4: sale por `sinPrecio`', () => {
    const c = simularOrdenes({ insumosPartida: sinPrecio, partidas: PARTIDAS, hoy: '2026-10-01' });
    const esc = decidirPropuesta(nuevoEscenario({}), c.propuestas[0].id, 'aceptada');
    const out = lineasAceptadas(aplicarEscenario(c, esc));
    expect(out.lineas).toEqual([]);
    expect(out.sinPrecio).toHaveLength(1);
  });

  it('ponerle precio a mano la vuelve entregable', () => {
    const c = simularOrdenes({ insumosPartida: sinPrecio, partidas: PARTIDAS, hoy: '2026-10-01' });
    const p0 = c.propuestas[0];
    let esc = decidirPropuesta(nuevoEscenario({}), p0.id, 'aceptada');
    esc = editarLinea(esc, p0.id, p0.lineas[0], { precio_unitario: 25 });
    const out = lineasAceptadas(aplicarEscenario(c, esc));
    expect(out.sinPrecio).toEqual([]);
    expect(out.lineas[0].monto).toBeCloseTo(250, 2);
  });
});

describe('sobres — descripción libre contra un techo (§4.1)', () => {
  const conSobre = [{
    id: 's1', partida_id: 'p1', insumo_codigo: null, nombre_insumo: 'HERRAMIENTAS MANUALES',
    unidad: '%mo', tipo_insumo: 'equipo', cantidad_presupuestada: 1, precio_presupuestado: 1000,
    costo_presupuestado: 1000,
  }];
  const cs = () => simularOrdenes({ insumosPartida: conSobre, partidas: PARTIDAS, hoy: '2026-10-01' });

  it('el motor lo saca por `sobres`, no por una propuesta con cantidad', () => {
    const c = cs();
    expect(c.sobres).toHaveLength(1);
    expect(c.sobres[0].descripcionLibre).toBe(true);
  });

  it('se le escriben líneas a mano y se ve cuánto queda del techo', () => {
    const c = cs();
    const clave = c.sobres[0].clave;
    let esc = decidirSobre(nuevoEscenario({}), clave, 'aceptada');
    esc = agregarLineaSobre(esc, clave, { descripcion: '3 combas', unidad: 'und', cantidad: 3, precio: 100 });
    const { sobres, resumen } = aplicarEscenario(c, esc);
    expect(sobres[0].usado).toBeCloseTo(300, 2);
    expect(sobres[0].restante).toBeCloseTo(700, 2);
    expect(sobres[0].excedido).toBe(false);
    expect(resumen.montoSobresAceptado).toBeCloseTo(300, 2);
  });

  it('pasarse del techo se avisa, no se bloquea', () => {
    const c = cs();
    const clave = c.sobres[0].clave;
    let esc = decidirSobre(nuevoEscenario({}), clave, 'aceptada');
    esc = agregarLineaSobre(esc, clave, { descripcion: 'de todo', cantidad: 1, precio: 5000 });
    const { sobres, resumen } = aplicarEscenario(c, esc);
    expect(sobres[0].excedido).toBe(true);
    expect(resumen.sobresExcedidos).toBe(1);
  });

  it('el techo NO se declara firme mientras nadie informe lo ya gastado', () => {
    const c = cs();
    const esc = decidirSobre(nuevoEscenario({}), c.sobres[0].clave, 'aceptada');
    expect(aplicarEscenario(c, esc).sobres[0].techoFirme).toBe(false);
  });

  it('con el consumo informado, el disponible se mide contra ÉL', () => {
    const c = simularOrdenes({
      insumosPartida: conSobre, partidas: PARTIDAS, hoy: '2026-10-01',
      consumoSobres: { 'herramientas manuales|%mo': 600 },
    });
    const clave = c.sobres[0].clave;
    let esc = decidirSobre(nuevoEscenario({}), clave, 'aceptada');
    esc = agregarLineaSobre(esc, clave, { descripcion: 'palas', cantidad: 1, precio: 300 });
    const s = aplicarEscenario(c, esc).sobres[0];
    expect(s.techoFirme).toBe(true);
    expect(s.restante).toBeCloseTo(100, 2);   // 1000 − 600 ya gastado − 300 nuevo
  });

  it('editar y quitar líneas del sobre', () => {
    const c = cs();
    const clave = c.sobres[0].clave;
    let esc = agregarLineaSobre(nuevoEscenario({}), clave, { descripcion: 'picos', cantidad: 2, precio: 50 });
    const id = esc.sobres[clave].lineas[0].id;
    esc = editarLineaSobre(esc, clave, id, { cantidad: 4 });
    expect(esc.sobres[clave].lineas[0].cantidad).toBe(4);
    esc = quitarLineaSobre(esc, clave, id);
    expect(esc.sobres[clave].lineas).toEqual([]);
  });

  it('una línea de sobre sin descripción no se entrega a la tanda 4', () => {
    const c = cs();
    const clave = c.sobres[0].clave;
    let esc = decidirSobre(nuevoEscenario({}), clave, 'aceptada');
    esc = proveedorDeSobre(esc, clave, { id: 'c9', nombre: 'FERRE SAC' });
    esc = agregarLineaSobre(esc, clave, { descripcion: '   ', cantidad: 1, precio: 10 });
    esc = agregarLineaSobre(esc, clave, { descripcion: 'comba', cantidad: 1, precio: 10 });
    const out = lineasAceptadas(aplicarEscenario(c, esc));
    expect(out.lineas).toHaveLength(1);
    expect(out.lineas[0].descripcion).toBe('comba');
    expect(out.lineas[0].proveedor_nombre).toBe('FERRE SAC');
    expect(out.lineas[0].origen).toBe('simulador_sobre');
  });
});

describe('lineasAceptadas — el paquete que va a recibir la tanda 4', () => {
  it('solo sale lo aceptado, con su período y su origen marcado', () => {
    const c = corrida();
    const p0 = c.propuestas[0];
    const esc = decidirPropuesta(nuevoEscenario({}), p0.id, 'aceptada');
    const out = lineasAceptadas(aplicarEscenario(c, esc));
    expect(out.lineas).toHaveLength(p0.lineas.length);
    for (const l of out.lineas) {
      expect(l.origen).toBe('simulador');
      expect(l.periodo).toBe(p0.periodo);
      expect(l.descripcion).toBeTruthy();
    }
  });

  it('sin nada aceptado devuelve vacío, no todo', () => {
    const out = lineasAceptadas(aplicarEscenario(corrida(), nuevoEscenario({})));
    expect(out.lineas).toEqual([]);
  });

  it('sin argumentos no explota', () => {
    expect(lineasAceptadas()).toEqual({ lineas: [], sinPrecio: [] });
    expect(aplicarEscenario().resumen.ordenes).toBe(0);
  });
});

describe('persistencia — el borrador de una persona, por obra', () => {
  it('se guarda y se vuelve a leer igual', () => {
    const st = storageFalso();
    const e = nuevoEscenario({ nombre: 'Regularizando', obraId: 'obra-1' });
    guardarEscenario('obra-1', e, st);
    const [leido] = leerEscenarios('obra-1', st);
    expect(leido.id).toBe(e.id);
    expect(leido.nombre).toBe('Regularizando');
    expect(leido.params).toEqual(PARAMS_DEFAULT);
  });

  it('cada obra tiene su propia lista', () => {
    const st = storageFalso();
    guardarEscenario('obra-1', nuevoEscenario({ nombre: 'A' }), st);
    guardarEscenario('obra-2', nuevoEscenario({ nombre: 'B' }), st);
    expect(leerEscenarios('obra-1', st).map(e => e.nombre)).toEqual(['A']);
    expect(leerEscenarios('obra-2', st).map(e => e.nombre)).toEqual(['B']);
    expect(claveStorage('obra-1')).not.toBe(claveStorage('obra-2'));
  });

  it('guardar el mismo id reemplaza, no duplica', () => {
    const st = storageFalso();
    const e = nuevoEscenario({ nombre: 'Uno' });
    guardarEscenario('o', e, st);
    guardarEscenario('o', { ...e, nombre: 'Uno corregido' }, st);
    const lista = leerEscenarios('o', st);
    expect(lista).toHaveLength(1);
    expect(lista[0].nombre).toBe('Uno corregido');
  });

  it('las decisiones y las correcciones viajan al storage', () => {
    const st = storageFalso();
    const c = corrida();
    const p0 = c.propuestas[0];
    let e = decidirPropuesta(nuevoEscenario({ nombre: 'Con decisiones' }), p0.id, 'aceptada');
    e = editarLinea(e, p0.id, p0.lineas[0], { precio_unitario: 99 });
    guardarEscenario('o', e, st);
    const [leido] = leerEscenarios('o', st);
    const d = aplicarEscenario(c, leido).propuestas.find(p => p.id === p0.id);
    expect(d.estado).toBe('aceptada');
    expect(d.lineas.find(l => l.clave === p0.lineas[0].clave).precio_unitario).toBe(99);
  });

  it('un JSON roto NO deja la pantalla muerta', () => {
    const st = storageFalso();
    st.setItem(claveStorage('o'), '{esto no es json');
    expect(leerEscenarios('o', st)).toEqual([]);
  });

  it('un storage que no deja escribir devuelve false en vez de tirar', () => {
    const roto = { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); } };
    expect(guardarEscenarios('o', [nuevoEscenario({})], roto)).toBe(false);
  });

  it('borrar saca solo ese escenario', () => {
    const st = storageFalso();
    const a = nuevoEscenario({ nombre: 'A' }), b = nuevoEscenario({ nombre: 'B' });
    guardarEscenario('o', a, st); guardarEscenario('o', b, st);
    const resto = borrarEscenario('o', a.id, st);
    expect(resto.map(e => e.nombre)).toEqual(['B']);
    expect(leerEscenarios('o', st).map(e => e.nombre)).toEqual(['B']);
  });

  it('normalizarEscenario limpia una decisión que ya no existe', () => {
    const e = normalizarEscenario({ decisiones: { propuestas: { x: 'tal_vez', y: 'aceptada' } } });
    expect(e.decisiones.propuestas).toEqual({ y: 'aceptada' });
  });

  it('conParams cambia los ejes SIN perder lo decidido', () => {
    const c = corrida();
    const p0 = c.propuestas[0];
    let e = decidirPropuesta(nuevoEscenario({}), p0.id, 'aceptada');
    e = conParams(e, { modo: 'simulacion' });
    expect(e.params.modo).toBe('simulacion');
    expect(e.decisiones.propuestas[p0.id]).toBe('aceptada');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Tanda 2.2 — cómo se compra cada insumo, y las correcciones que quedaron
// en otra unidad.
// ═══════════════════════════════════════════════════════════════════
describe('cómo se compra cada insumo (tanda 2.2)', () => {
  // Un insumo que el nombre dice «x 6m»: sale en tubos.
  const TUBO = { id: 't1', partida_id: 'p2', insumo_codigo: 'MAT-009',
    nombre_insumo: 'TUBERIA PVC UF S25 DE 8"(200mm) x 6m ISO 4435', unidad: 'm', tipo_insumo: 'material',
    cantidad_presupuestada: 120, precio_presupuestado: 30, costo_presupuestado: 3600 };
  const conTubo = (compras = null) => simularOrdenes({
    insumosPartida: [TUBO], partidas: PARTIDAS, hoy: '2026-10-01',
    ...paramsDeMotor(PARAMS_DEFAULT), compras,
  });

  it('se guarda por OBRA y aparte de los escenarios', () => {
    const st = storageFalso();
    guardarCompra('o', 'MAT-009', { unidadCompra: 'tubo de 5 m', factor: 5 }, st);
    guardarCompra('o', 'MAT-001', { colchonPct: 3 }, st);
    expect(leerCompras('o', st)).toEqual({
      'MAT-009': { unidadCompra: 'tubo de 5 m', factor: 5 },
      'MAT-001': { colchonPct: 3 },
    });
    expect(claveStorageCompras('o')).not.toBe(claveStorage('o'));
    expect(leerEscenarios('o', st)).toEqual([]);
    expect(leerCompras('otra', st)).toEqual({});
  });

  it('vaciar un campo lo devuelve al default, y la unidad se va con su factor', () => {
    const st = storageFalso();
    guardarCompra('o', 'MAT-009', { unidadCompra: 'tubo de 5 m', factor: 5, colchonPct: 2 }, st);
    guardarCompra('o', 'MAT-009', { factor: null }, st);
    expect(leerCompras('o', st)).toEqual({ 'MAT-009': { colchonPct: 2 } });
    guardarCompra('o', 'MAT-009', { colchonPct: null }, st);
    expect(leerCompras('o', st)).toEqual({});
  });

  it('un JSON roto no deja la pantalla muerta', () => {
    const st = storageFalso();
    st.setItem(claveStorageCompras('o'), '{roto');
    expect(leerCompras('o', st)).toEqual({});
    st.setItem(claveStorageCompras('o'), '[1,2]');
    expect(leerCompras('o', st)).toEqual({});
  });

  it('una corrección de cantidad guarda en qué unidad se hizo', () => {
    const c = conTubo();
    const p = c.propuestas[0];
    const l = p.lineas[0];
    expect(l.unidad).toBe('tubo de 6 m');
    const e = editarLinea(nuevoEscenario({}), p.id, l, { cantidad: 25 });
    // Desde la 2.3 también guarda sobre qué entregas se corrigió.
    expect(e.ediciones[refLinea(p.id, l.clave)]).toEqual({ cantidad: 25, unidad_edicion: 'tubo de 6 m', periodos_edicion: p.periodo });
    const d = aplicarEscenario(c, e).propuestas[0].lineas[0];
    expect(d.cantidad).toBe(25);
    expect(d.edicionOtraUnidad).toBe(null);
  });

  it('si después cambia la unidad de compra, la corrección vieja NO se aplica: 25 tubos no son 25 metros', () => {
    const c6 = conTubo();
    const p = c6.propuestas[0];
    const e = editarLinea(nuevoEscenario({}), p.id, p.lineas[0], { cantidad: 25, precio_unitario: 170 });
    const cm = conTubo({ 'MAT-009': { unidadCompra: 'm', factor: 1 } });
    const d = aplicarEscenario(cm, e).propuestas[0].lineas[0];
    expect(d.unidad).toBe('m');
    expect(d.cantidad).toBe(120);
    expect(d.precio_unitario).toBe(30);
    expect(d.edicionOtraUnidad).toBe('tubo de 6 m');
  });

  it('una corrección de ANTES de la 2.2 (sin unidad) se hizo en la del expediente', () => {
    const c = conTubo();
    const p = c.propuestas[0];
    const l = p.lineas[0];
    // Tal como quedó guardada en el localStorage el 22-set: sin unidad.
    const vieja = { ...nuevoEscenario({}), ediciones: { [refLinea(p.id, l.clave)]: { cantidad: 110, nota: 'ojo' } } };
    const d = aplicarEscenario(c, vieja).propuestas[0].lineas[0];
    expect(d.cantidad).toBe(20);                // los 20 tubos del motor, no 110
    expect(d.edicionOtraUnidad).toBe('m');
    expect(d.nota).toBe('ojo');                 // lo que no es un número se conserva
    // Y en un insumo que no cambió de unidad, la corrección vieja sigue valiendo.
    const cc = corrida();
    const pc = cc.propuestas.find(x => x.lineas.some(y => y.insumo_codigo === 'MAT-002'));
    const lc = pc.lineas.find(y => y.insumo_codigo === 'MAT-002');
    const v2 = { ...nuevoEscenario({}), ediciones: { [refLinea(pc.id, lc.clave)]: { cantidad: 1800 } } };
    const d2 = aplicarEscenario(cc, v2).propuestas.find(x => x.id === pc.id).lineas.find(y => y.insumo_codigo === 'MAT-002');
    expect(d2.cantidad).toBe(1800);
    expect(d2.edicionOtraUnidad).toBe(null);
  });

  it('lineasAceptadas entrega el factor: es lo que la requisición necesita para no pedir dos veces', () => {
    const c = conTubo();
    const p = c.propuestas[0];
    const e = decidirPropuesta(nuevoEscenario({}), p.id, 'aceptada');
    const { lineas } = lineasAceptadas(aplicarEscenario(c, e));
    expect(lineas[0]).toMatchObject({ unidad: 'tubo de 6 m', cantidad: 20, factor: 6, unidadExpediente: 'm' });
  });
});
