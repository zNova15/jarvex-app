import { describe, it, expect } from 'vitest';
import {
  armarRequisiciones, borradorDeOrdenDesdeRequisicion, cierreDeRequisicion,
  consumoDeSobres, estadoDelPlan, puedeEmitirOrden,
  fechaNecesidadDePeriodo, tipoInsumoDeSubcategoria, tipoDeOrdenDeSubcategoria,
  esDelSimulador, TIPOS_INSUMO_REQUISICION, TIPO_INSUMO_DE_SUBCATEGORIA,
  MOTIVO_NO_EMITE_LABEL, MOTIVO_OMITIDA_LABEL,
} from '../simulador-puente.js';
import { coberturaPrevia, simularOrdenes } from '../simulador-ordenes.js';

// ── LOS DATOS SON LOS REALES ──────────────────────────────────────
// Medidos contra producción el 22-set-2026 (Plan Miraflores,
// obra_id 984bacda-97ae-4744-bf5f-a8ab03f48d8d):
//
//   · `requisiciones` / `requisicion_items`: 4 y 12 filas, sin usar.
//   · Las 14 órdenes emitidas: 62 líneas, `insumo_codigo` NULL en el 100%.
//   · El CHECK de `requisicion_items.tipo_insumo` NO admitía 'servicio', y
//     los servicios son ~S/ 1,15 M de los ~S/ 4,98 M comprables (el 23%).
//   · La ejecutora de Miraflores es CONSORCIO EL INCA, y es la única que
//     puede emitir.

const OBRA_ID = 'obra-miraflores';
const EJECUTORA = 'co-el-inca';
const OTRA = 'co-jarvex';

const obra = { id: OBRA_ID, nombre_obra: 'PLAN MIRAFLORES', ejecutora_company_id: EJECUTORA, ejecutora_tipo: 'consorcio' };

// Una línea tal como la devuelve `lineasAceptadas()` de simulador-escenarios.
const linea = (over = {}) => ({
  propuesta_id: '2026-10|material',
  periodo: '2026-10',
  etiquetaPeriodo: 'octubre 2026',
  categoria: 'materiales',
  subcategoria: 'material',
  insumo_codigo: '210020001',
  clave: '210020001',
  descripcion: 'CEMENTO PORTLAND TIPO I (42.5 kg)',
  unidad: 'bls',
  cantidad: 100,
  precio_unitario: 28.5,
  monto: 2850,
  proveedor_id: null,
  proveedor_nombre: '',
  partidas: ['p1'],
  nota: '',
  origen: 'simulador',
  ...over,
});

// Ids deterministas: un test que compara contra un uuid random no compara nada.
const contador = () => { let n = 0; return () => `id-${++n}`; };

describe('vocabulario: subcategoría → tipo_insumo de la tabla', () => {
  it('todos los valores que produce caben en el CHECK del servidor', () => {
    for (const v of Object.values(TIPO_INSUMO_DE_SUBCATEGORIA)) {
      expect(TIPOS_INSUMO_REQUISICION).toContain(v);
    }
  });

  it('el servicio tiene su propio tipo (es el 23% de la plata comprable)', () => {
    expect(tipoInsumoDeSubcategoria('servicio')).toBe('servicio');
    expect(TIPOS_INSUMO_REQUISICION).toContain('servicio');
  });

  it('la mano de obra NO se traduce: la planilla no se requisa (§5)', () => {
    expect(tipoInsumoDeSubcategoria('mano_obra')).toBe(null);
  });

  it('una subcategoría desconocida no cae en el valor más parecido', () => {
    expect(tipoInsumoDeSubcategoria('lo_que_sea')).toBe(null);
    expect(tipoInsumoDeSubcategoria(null)).toBe(null);
  });

  it('un alquiler va como orden de SERVICIO, un material como orden de COMPRA', () => {
    expect(tipoDeOrdenDeSubcategoria('servicio')).toBe('servicio');
    expect(tipoDeOrdenDeSubcategoria('material')).toBe('compra');
    expect(tipoDeOrdenDeSubcategoria('epp')).toBe('compra');
  });
});

describe('la fecha de necesidad sale del período, no de hoy', () => {
  it('un mes arranca el día 1', () => {
    expect(fechaNecesidadDePeriodo('2026-10')).toBe('2026-10-01');
  });
  it('una semana arranca el lunes', () => {
    expect(fechaNecesidadDePeriodo('2026-W40')).toBe('2026-09-28');
  });
  it('un período que no se entiende deja la columna vacía en vez de inventar', () => {
    expect(fechaNecesidadDePeriodo('cualquiera')).toBe(null);
    expect(fechaNecesidadDePeriodo(null)).toBe(null);
  });
});

describe('armarRequisiciones', () => {
  it('una propuesta es UNA requisición con sus N ítems', () => {
    const r = armarRequisiciones({
      lineas: [linea(), linea({ insumo_codigo: '020005001', descripcion: 'TUBERIA PVC', clave: '020005001', monto: 1000, cantidad: 10, precio_unitario: 100 })],
      obraId: OBRA_ID, hoy: '2026-09-22', nuevoId: contador(),
    });
    expect(r.requisiciones).toHaveLength(1);
    expect(r.requisiciones[0].items).toHaveLength(2);
    expect(r.resumen.monto).toBe(3850);
  });

  it('dos períodos son dos requisiciones distintas', () => {
    const r = armarRequisiciones({
      lineas: [linea(), linea({ propuesta_id: '2026-11|material', periodo: '2026-11', etiquetaPeriodo: 'noviembre 2026' })],
      obraId: OBRA_ID, hoy: '2026-09-22', nuevoId: contador(),
    });
    expect(r.requisiciones).toHaveLength(2);
    expect(r.requisiciones.map(x => x.requisicion.fecha_necesidad)).toEqual(['2026-10-01', '2026-11-01']);
  });

  it('la fecha de necesidad es la del período, NO la de hoy', () => {
    const r = armarRequisiciones({ lineas: [linea()], obraId: OBRA_ID, hoy: '2026-09-22', nuevoId: contador() });
    const req = r.requisiciones[0].requisicion;
    expect(req.fecha).toBe('2026-09-22');
    expect(req.fecha_necesidad).toBe('2026-10-01');
  });

  it('el código de insumo viaja al ítem: es contra lo que se descuenta después', () => {
    const r = armarRequisiciones({ lineas: [linea()], obraId: OBRA_ID, nuevoId: contador() });
    expect(r.requisiciones[0].items[0].insumo_codigo).toBe('210020001');
  });

  it('una línea sin código se escribe igual, con el código en NULL', () => {
    const r = armarRequisiciones({ lineas: [linea({ insumo_codigo: null })], obraId: OBRA_ID, nuevoId: contador() });
    expect(r.requisiciones[0].items[0].insumo_codigo).toBe(null);
    expect(r.requisiciones[0].items[0].nombre).toBe('CEMENTO PORTLAND TIPO I (42.5 kg)');
  });

  it('queda marcada con su origen y con la propuesta de la que salió', () => {
    const r = armarRequisiciones({
      lineas: [linea()], obraId: OBRA_ID,
      escenario: { nombre: 'Regularizando desde hoy' }, nuevoId: contador(),
    });
    const req = r.requisiciones[0].requisicion;
    expect(req.origen).toBe('simulador');
    expect(req.origen_ref).toBe('2026-10|material');
    expect(req.razon).toContain('Regularizando desde hoy');
    expect(esDelSimulador(req)).toBe(true);
  });

  it('nace en borrador: todavía no es un pedido firme', () => {
    const r = armarRequisiciones({ lineas: [linea()], obraId: OBRA_ID, nuevoId: contador() });
    expect(r.requisiciones[0].requisicion.estado).toBe('borrador');
    expect(r.requisiciones[0].requisicion.oc_id).toBeUndefined();
  });

  it('la partida solo se anota si TODA la requisición es de la misma', () => {
    const unaSola = armarRequisiciones({ lineas: [linea({ partidas: ['p1'] })], obraId: OBRA_ID, nuevoId: contador() });
    expect(unaSola.requisiciones[0].requisicion.partida_id).toBe('p1');

    const mezclada = armarRequisiciones({
      lineas: [linea({ partidas: ['p1'] }), linea({ clave: 'x', insumo_codigo: 'x', partidas: ['p2'] })],
      obraId: OBRA_ID, nuevoId: contador(),
    });
    // Poner la de la primera línea sería una media verdad que después alguien
    // lee como la verdad entera.
    expect(mezclada.requisiciones[0].requisicion.partida_id).toBe(null);
  });

  it('la mano de obra NO se escribe: sale por omitidas, con su motivo', () => {
    const r = armarRequisiciones({
      lineas: [linea(), linea({ subcategoria: 'mano_obra', descripcion: 'PEON' })],
      obraId: OBRA_ID, nuevoId: contador(),
    });
    expect(r.requisiciones[0].items).toHaveLength(1);
    expect(r.omitidas).toHaveLength(1);
    expect(r.omitidas[0].motivo).toBe('mano_obra_no_se_requisa');
    expect(MOTIVO_OMITIDA_LABEL[r.omitidas[0].motivo]).toBeTruthy();
  });

  it('una línea sin cantidad no se escribe con un cero inventado', () => {
    const r = armarRequisiciones({ lineas: [linea({ cantidad: 0 })], obraId: OBRA_ID, nuevoId: contador() });
    expect(r.requisiciones).toHaveLength(0);
    expect(r.omitidas[0].motivo).toBe('sin_cantidad');
  });

  it('NADA SE PIDE DOS VECES: lo que ya tiene requisición no se vuelve a escribir', () => {
    const yaEscritas = [{ id: 'r-vieja', obra_id: OBRA_ID, estado: 'borrador', origen: 'simulador', origen_ref: '2026-10|material' }];
    const r = armarRequisiciones({ lineas: [linea()], obraId: OBRA_ID, yaEscritas, nuevoId: contador() });
    expect(r.requisiciones).toHaveLength(0);
    expect(r.duplicadas).toHaveLength(1);
    expect(r.resumen.duplicadas).toBe(1);
  });

  it('pero una requisición RECHAZADA libera su propuesta: se puede volver a pedir', () => {
    const yaEscritas = [{ id: 'r-vieja', obra_id: OBRA_ID, estado: 'rechazada', origen: 'simulador', origen_ref: '2026-10|material' }];
    const r = armarRequisiciones({ lineas: [linea()], obraId: OBRA_ID, yaEscritas, nuevoId: contador() });
    expect(r.requisiciones).toHaveLength(1);
  });

  it('el servicio se escribe como servicio y no rebota contra el CHECK', () => {
    const r = armarRequisiciones({
      lineas: [linea({ subcategoria: 'servicio', categoria: 'servicios', descripcion: 'ALQUILER DE COMPRESORA NEUMATICA', unidad: 'hm' })],
      obraId: OBRA_ID, nuevoId: contador(),
    });
    expect(r.requisiciones[0].items[0].tipo_insumo).toBe('servicio');
  });

  it('el proveedor elegido queda anotado, pero la requisición no se lo impone a nadie', () => {
    const r = armarRequisiciones({
      lineas: [linea({ proveedor_nombre: 'FERNANDEZ CHAVEZ OLINDA GREGORIANA' })],
      obraId: OBRA_ID, nuevoId: contador(),
    });
    expect(r.requisiciones[0].items[0].notas).toContain('FERNANDEZ CHAVEZ');
  });
});

describe('puedeEmitirOrden (§7: solo la ejecutora)', () => {
  it('sin trabajo no hay orden', () => {
    expect(puedeEmitirOrden({}).motivo).toBe('sin_obra');
  });

  it('un trabajo sin ejecutora declarada no emite, y lo dice', () => {
    const r = puedeEmitirOrden({ obra: { id: 'o', ejecutora_company_id: null } });
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('sin_ejecutora');
    expect(MOTIVO_NO_EMITE_LABEL[r.motivo]).toContain('Consorcios');
  });

  it('la ejecutora sí', () => {
    expect(puedeEmitirOrden({ obra, companyId: EJECUTORA })).toEqual({ ok: true, ejecutoraId: EJECUTORA, motivo: null });
  });

  it('otra empresa del grupo NO, por más propia que sea', () => {
    const r = puedeEmitirOrden({ obra, companyId: OTRA });
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('no_es_ejecutora');
  });

  it('sin empresa pedida, la respuesta es la ejecutora del trabajo', () => {
    expect(puedeEmitirOrden({ obra }).ejecutoraId).toBe(EJECUTORA);
  });

  it('el consorcio le gana a `ejecutora_company_id`', () => {
    const consorcios = [{ id: 'c1', company_id: 'co-consorcio', obra_id: OBRA_ID, deleted_at: null }];
    const r = puedeEmitirOrden({ obra, consorcios, companyId: 'co-consorcio' });
    expect(r.ok).toBe(true);
  });
});

describe('borradorDeOrdenDesdeRequisicion', () => {
  const company = { id: EJECUTORA, name: 'CONSORCIO EL INCA', codigo_doc_prefix: 'EI' };
  const base = () => {
    const { requisiciones } = armarRequisiciones({
      lineas: [linea()], obraId: OBRA_ID, hoy: '2026-09-22', nuevoId: contador(),
    });
    return requisiciones[0];
  };

  it('arma la orden con el correlativo de la ejecutora', () => {
    const { requisicion, items } = base();
    const b = borradorDeOrdenDesdeRequisicion({
      requisicion, items, obra, company,
      proveedor: { id: 'pv1', nombre: 'FERRETERIA CALDERON' },
      ordenes: [], nuevoId: contador(),
    });
    expect(b.ok).toBe(true);
    expect(b.orden.codigo).toBe('EI-OC-001-2026');
    expect(b.orden.company_id).toBe(EJECUTORA);
  });

  it('sigue el correlativo que ya venía, sin repetir número', () => {
    const { requisicion, items } = base();
    const previas = [{ id: 'o', company_id: EJECUTORA, tipo: 'compra', anio: 2026, correlativo: 27 }];
    const b = borradorDeOrdenDesdeRequisicion({
      requisicion, items, obra, company,
      proveedor: { nombre: 'X' }, ordenes: previas, nuevoId: contador(),
    });
    expect(b.orden.correlativo).toBe(28);
  });

  it('los totales se suman hacia ARRIBA: la orden nace de un plan, no de una factura', () => {
    const { requisicion, items } = base();
    const b = borradorDeOrdenDesdeRequisicion({
      requisicion, items, obra, company, proveedor: { nombre: 'X' }, nuevoId: contador(),
    });
    expect(b.orden.monto_subtotal).toBe(2850);
    expect(b.orden.monto_igv).toBe(513);
    expect(b.orden.monto_total).toBe(3363);
    expect(b.orden.emitida_retroactiva).toBe(false);
  });

  it('nace en BORRADOR, no en «recibida»: lo que se pide todavía no llegó', () => {
    const { requisicion, items } = base();
    const b = borradorDeOrdenDesdeRequisicion({ requisicion, items, obra, company, proveedor: { nombre: 'X' }, nuevoId: contador() });
    expect(b.orden.estado).toBe('borrador');
  });

  it('el código de insumo viaja al oc_item: sin eso la orden no se puede descontar', () => {
    const { requisicion, items } = base();
    const b = borradorDeOrdenDesdeRequisicion({ requisicion, items, obra, company, proveedor: { nombre: 'X' }, nuevoId: contador() });
    expect(b.items[0].insumo_codigo).toBe('210020001');
    expect(b.items[0].requisicion_item_id).toBe(items[0].id);
  });

  it('una requisición de puros alquileres sale como ORDEN DE SERVICIO', () => {
    const { requisiciones } = armarRequisiciones({
      lineas: [linea({ subcategoria: 'servicio', descripcion: 'ALQUILER DE COMPRESORA', unidad: 'hm' })],
      obraId: OBRA_ID, nuevoId: contador(),
    });
    const b = borradorDeOrdenDesdeRequisicion({
      ...requisiciones[0], obra, company, proveedor: { nombre: 'X' }, nuevoId: contador(),
    });
    expect(b.orden.tipo).toBe('servicio');
    expect(b.orden.codigo).toContain('OS');
  });

  it('otra empresa no la emite, aunque tenga todo lo demás', () => {
    const { requisicion, items } = base();
    const b = borradorDeOrdenDesdeRequisicion({
      requisicion, items, obra,
      company: { id: OTRA, name: 'JARVEX' },
      proveedor: { nombre: 'X' }, nuevoId: contador(),
    });
    expect(b.ok).toBe(false);
    expect(b.motivo).toBe('no_es_ejecutora');
    expect(b.orden).toBe(null);
  });

  it('sin proveedor no se emite: una orden se le emite a alguien', () => {
    const { requisicion, items } = base();
    const b = borradorDeOrdenDesdeRequisicion({ requisicion, items, obra, company, proveedor: null, nuevoId: contador() });
    expect(b.motivo).toBe('sin_proveedor');
  });

  it('una línea sin precio NO entra a la orden: un monto inventado no lo mira nadie', () => {
    const { requisicion, items } = base();
    const sinPrecio = [...items, { id: 'x', requisicion_id: requisicion.id, cantidad: 5, precio_estimado: null, nombre: 'ALGO', tipo_insumo: 'material' }];
    const b = borradorDeOrdenDesdeRequisicion({ requisicion, items: sinPrecio, obra, company, proveedor: { nombre: 'X' }, nuevoId: contador() });
    expect(b.items).toHaveLength(1);
    expect(b.orden.monto_subtotal).toBe(2850);
  });

  it('si ninguna línea sirve, no se arma una orden en cero', () => {
    const { requisicion } = base();
    const b = borradorDeOrdenDesdeRequisicion({
      requisicion, items: [{ id: 'x', requisicion_id: requisicion.id, cantidad: 0, precio_estimado: 0 }],
      obra, company, proveedor: { nombre: 'X' }, nuevoId: contador(),
    });
    expect(b.ok).toBe(false);
    expect(b.motivo).toBe('sin_lineas');
  });

  it('una requisición que ya es orden no se emite de nuevo', () => {
    const { requisicion, items } = base();
    const b = borradorDeOrdenDesdeRequisicion({
      requisicion: { ...requisicion, oc_id: 'oc-1' }, items, obra, company,
      proveedor: { nombre: 'X' }, nuevoId: contador(),
    });
    expect(b.motivo).toBe('ya_ordenada');
  });

  it('el cierre deja el puente hecho en los dos sentidos', () => {
    expect(cierreDeRequisicion({ id: 'oc-9', codigo: 'EI-OC-009-2026' }))
      .toEqual({ oc_id: 'oc-9', oc_codigo: 'EI-OC-009-2026', estado: 'ordenada' });
  });
});

describe('la corrida siguiente descuenta lo ya requisado (§7)', () => {
  const req = (id, over = {}) => ({ id, obra_id: OBRA_ID, estado: 'borrador', origen: 'simulador', origen_ref: '2026-10|material', ...over });
  const item = (rid, codigo, cantidad, precio = 10) => ({
    id: `it-${rid}-${codigo}-${cantidad}`, requisicion_id: rid, insumo_codigo: codigo, cantidad, precio_estimado: precio,
  });

  it('lo pedido se suma a lo cubierto', () => {
    const { cubierto } = coberturaPrevia({
      requisiciones: [req('r1')], requisicionItems: [item('r1', 'CEM', 40)],
    });
    expect(cubierto.get('CEM')).toBe(40);
  });

  it('una requisición cancelada no reserva nada', () => {
    const { cubierto } = coberturaPrevia({
      requisiciones: [req('r1', { estado: 'cancelada' })], requisicionItems: [item('r1', 'CEM', 40)],
    });
    expect(cubierto.has('CEM')).toBe(false);
  });

  it('la que ya es orden NO se cuenta dos veces: la cuenta su orden', () => {
    const ordenes = [{ id: 'oc1', estado: 'borrador' }];
    const ocItems = [{ orden_compra_id: 'oc1', insumo_codigo: 'CEM', cantidad: 40, subtotal: 400 }];
    const { cubierto } = coberturaPrevia({
      ordenes, ocItems,
      requisiciones: [req('r1', { oc_id: 'oc1' })], requisicionItems: [item('r1', 'CEM', 40)],
    });
    expect(cubierto.get('CEM')).toBe(40);
  });

  it('la cantidad APROBADA manda sobre la pedida', () => {
    const { cubierto } = coberturaPrevia({
      requisiciones: [req('r1')],
      requisicionItems: [{ ...item('r1', 'CEM', 100), cantidad_aprobada: 60 }],
    });
    expect(cubierto.get('CEM')).toBe(60);
  });

  it('sin código no se descuenta a ojo: se cuenta aparte y se dice', () => {
    const { cubierto, reqSinImputar } = coberturaPrevia({
      requisiciones: [req('r1')], requisicionItems: [item('r1', null, 40, 25)],
    });
    expect(cubierto.size).toBe(0);
    expect(reqSinImputar).toEqual({ lineas: 1, monto: 1000 });
  });

  it('de punta a punta: lo requisado deja de proponerse en la corrida siguiente', () => {
    const partidas = [{ id: 'p1', obra_id: OBRA_ID, fecha_inicio_planificada: '2026-10-05', fecha_fin_planificada: '2026-10-10' }];
    const insumosPartida = [{
      id: 'ip1', obra_id: OBRA_ID, partida_id: 'p1', tipo_insumo: 'material',
      nombre_insumo: 'CEMENTO PORTLAND TIPO I', unidad: 'bls', insumo_codigo: 'CEM',
      cantidad_presupuestada: 100, precio_presupuestado: 28.5, costo_presupuestado: 2850,
    }];
    const antes = simularOrdenes({ insumosPartida, partidas, hoy: '2026-09-22', anclaje: 'restante' });
    expect(antes.propuestas[0].lineas[0].cantidad).toBe(100);

    const despues = simularOrdenes({
      insumosPartida, partidas, hoy: '2026-09-22', anclaje: 'restante',
      requisiciones: [req('r1')], requisicionItems: [item('r1', 'CEM', 60)],
    });
    expect(despues.propuestas[0].lineas[0].cantidad).toBe(40);
    expect(despues.resumen.descontado.cantidad).toBe(60);
  });

  it('en modo auditoría («asumiendo cero órdenes previas») no se descuenta nada', () => {
    const partidas = [{ id: 'p1', obra_id: OBRA_ID, fecha_inicio_planificada: '2026-10-05', fecha_fin_planificada: '2026-10-10' }];
    const insumosPartida = [{
      id: 'ip1', obra_id: OBRA_ID, partida_id: 'p1', tipo_insumo: 'material',
      nombre_insumo: 'CEMENTO', unidad: 'bls', insumo_codigo: 'CEM',
      cantidad_presupuestada: 100, precio_presupuestado: 28.5, costo_presupuestado: 2850,
    }];
    const r = simularOrdenes({
      insumosPartida, partidas, hoy: '2026-09-22', anclaje: 'cero',
      requisiciones: [req('r1')], requisicionItems: [item('r1', 'CEM', 60)],
    });
    expect(r.propuestas[0].lineas[0].cantidad).toBe(100);
  });
});

describe('consumoDeSobres — quien informa cuánto se gastó del techo', () => {
  it('suma lo requisado contra un sobre, por su clave', () => {
    const requisiciones = [{ id: 'r1', estado: 'borrador', origen: 'simulador_sobre', origen_ref: 'sobre:herramientas manuales|%mo' }];
    const requisicionItems = [
      { id: 'i1', requisicion_id: 'r1', cantidad: 3, precio_estimado: 45 },
      { id: 'i2', requisicion_id: 'r1', cantidad: 5, precio_estimado: 20 },
    ];
    expect(consumoDeSobres({ requisiciones, requisicionItems })).toEqual({ 'herramientas manuales|%mo': 235 });
  });

  it('una requisición normal no consume ningún sobre', () => {
    const requisiciones = [{ id: 'r1', estado: 'borrador', origen: 'simulador', origen_ref: '2026-10|material' }];
    expect(consumoDeSobres({ requisiciones, requisicionItems: [{ id: 'i1', requisicion_id: 'r1', cantidad: 1, precio_estimado: 99 }] })).toEqual({});
  });

  it('el motor lo usa y deja de decir que el techo está intacto', () => {
    const partidas = [{ id: 'p1', obra_id: OBRA_ID, fecha_inicio_planificada: '2026-05-01', fecha_fin_planificada: '2026-12-25' }];
    const insumosPartida = [{
      id: 'ip1', obra_id: OBRA_ID, partida_id: 'p1', tipo_insumo: 'equipo',
      nombre_insumo: 'HERRAMIENTAS MANUALES', unidad: '%mo',
      cantidad_presupuestada: 1, precio_presupuestado: 132493, costo_presupuestado: 132493,
    }];
    const sinInformar = simularOrdenes({ insumosPartida, partidas, hoy: '2026-05-01', anclaje: 'cero' });
    expect(sinInformar.sobres[0].consumido).toBe(null);
    expect(sinInformar.sobres[0].consumoInformado).toBe(false);

    const clave = sinInformar.sobres[0].clave;
    const informado = simularOrdenes({
      insumosPartida, partidas, hoy: '2026-05-01', anclaje: 'cero',
      consumoSobres: { [clave]: 12000 },
    });
    expect(informado.sobres[0].consumido).toBe(12000);
    expect(informado.sobres[0].disponible).toBe(120493);
  });
});

describe('estadoDelPlan — qué propuesta ya es un documento', () => {
  const requisiciones = [
    { id: 'r1', estado: 'borrador', origen: 'simulador', origen_ref: '2026-10|material' },
    { id: 'r2', estado: 'ordenada', origen: 'simulador', origen_ref: '2026-11|material', oc_id: 'oc1', oc_codigo: 'EI-OC-002-2026' },
    { id: 'r3', estado: 'borrador', origen: null, origen_ref: null },
    { id: 'r4', estado: 'cancelada', origen: 'simulador', origen_ref: '2026-12|material' },
  ];
  const requisicionItems = [
    { id: 'i1', requisicion_id: 'r1', cantidad: 10, precio_estimado: 5 },
    { id: 'i2', requisicion_id: 'r2', cantidad: 2, precio_estimado: 100 },
  ];

  it('indexa por la propuesta que la originó', () => {
    const m = estadoDelPlan({ requisiciones, requisicionItems });
    expect(m.get('2026-10|material').monto).toBe(50);
    expect(m.get('2026-10|material').ordenada).toBe(false);
    expect(m.get('2026-11|material').ordenada).toBe(true);
  });

  it('la cargada a mano no entra: no salió de ninguna propuesta', () => {
    expect(estadoDelPlan({ requisiciones, requisicionItems }).size).toBe(2);
  });

  it('una cancelada libera su propuesta', () => {
    expect(estadoDelPlan({ requisiciones, requisicionItems }).has('2026-12|material')).toBe(false);
  });
});

describe('el factor viaja con lo pedido (tanda 2.2, mig 228)', () => {
  const company = { id: EJECUTORA, name: 'CONSORCIO EL INCA', codigo_doc_prefix: 'EI' };
  const tubos = linea({
    insumo_codigo: '020005001', clave: '020005001',
    descripcion: 'TUBERIA PVC UF S25 DE 8"(200mm) x 6m ISO 4435',
    unidad: 'tubo de 6 m', cantidad: 28, precio_unitario: 192, monto: 5376,
    factor: 6, unidadExpediente: 'm',
  });

  it('la requisición en tubos guarda cuántos metros trae cada tubo', () => {
    const { requisiciones } = armarRequisiciones({ lineas: [tubos], obraId: OBRA_ID, hoy: '2026-09-24', nuevoId: contador() });
    expect(requisiciones[0].items[0]).toMatchObject({ unidad: 'tubo de 6 m', cantidad: 28, factor_presupuesto: 6 });
  });

  it('con factor 1 la columna NO se escribe: la requisición común no depende de la migración', () => {
    const { requisiciones } = armarRequisiciones({ lineas: [linea({ factor: 1 })], obraId: OBRA_ID, hoy: '2026-09-24', nuevoId: contador() });
    expect('factor_presupuesto' in requisiciones[0].items[0]).toBe(false);
    const sinFactor = armarRequisiciones({ lineas: [linea()], obraId: OBRA_ID, hoy: '2026-09-24', nuevoId: contador() });
    expect('factor_presupuesto' in sinFactor.requisiciones[0].items[0]).toBe(false);
  });

  it('la orden hereda el factor de su requisición', () => {
    const { requisiciones } = armarRequisiciones({ lineas: [tubos], obraId: OBRA_ID, hoy: '2026-09-24', nuevoId: contador() });
    const { requisicion, items } = requisiciones[0];
    const b = borradorDeOrdenDesdeRequisicion({ requisicion, items, obra, company, proveedor: { nombre: 'X' }, nuevoId: contador() });
    expect(b.items[0]).toMatchObject({ cantidad: 28, factor_presupuesto: 6 });
  });

  it('IDA Y VUELTA: lo requisado en tubos se descuenta en metros en la corrida siguiente', () => {
    const { requisiciones } = armarRequisiciones({ lineas: [tubos], obraId: OBRA_ID, hoy: '2026-09-24', nuevoId: contador() });
    const { cubierto } = coberturaPrevia({
      requisiciones: requisiciones.map(r => r.requisicion),
      requisicionItems: requisiciones.flatMap(r => r.items),
    });
    expect(cubierto.get('020005001')).toBe(168);
  });
});
