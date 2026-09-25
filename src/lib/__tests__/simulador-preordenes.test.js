import { describe, it, expect } from 'vitest';
import {
  aNumero, esFechaValida, esPreordenEditable, proveedorSugeridoDeItems,
  edicionInicial, cantidadEquivalente, validarPreorden, cambiosDePreorden,
  descarteDePreorden, MOTIVO_DESCARTE,
} from '../simulador-preordenes.js';
import {
  borradorDeOrdenDesdeRequisicion, referenciaDeEntregas, fechasDeEntrega,
  ENTREGAS_A_COORDINAR,
} from '../simulador-puente.js';
import { coberturaPrevia } from '../simulador-ordenes.js';

// ── LA PRE-ORDEN DE REFERENCIA ────────────────────────────────────
// Lo que escribe «Cerrar mes» para Miraflores (tanda 4.3): una requisición
// del plan con dos líneas — la tubería pedida en tubos de 6 m (factor 6) y el
// cemento en bolsas (factor 1, NULL en la base).

const req = (over = {}) => ({
  id: 'rq1', obra_id: 'obra', origen: 'simulador', origen_ref: '2026-10|tuberia',
  estado: 'borrador', descripcion: 'Plan de obra — octubre 2026',
  fecha_necesidad: '2026-10-01', fecha_requerida: '2026-10-01', oc_id: null,
  ...over,
});
const tubo = (over = {}) => ({
  id: 'it1', requisicion_id: 'rq1', insumo_codigo: '0210040010', tipo_insumo: 'material',
  nombre: 'TUBERIA PVC UF S25 DE 8" x 6m', nombre_libre: 'TUBERIA PVC UF S25 DE 8" x 6m',
  descripcion: 'TUBERIA PVC UF S25 DE 8" x 6m',
  unidad: 'tubo', cantidad: 28, precio_estimado: 120, factor_presupuesto: 6,
  observacion: 'Entregas — octubre 2026: 16; noviembre 2026: 12 (tubo)',
  notas: 'Proveedor sugerido: PLASTICOS SAC',
  ...over,
});
const cemento = (over = {}) => ({
  id: 'it2', requisicion_id: 'rq1', insumo_codigo: '0221000000', tipo_insumo: 'material',
  nombre: 'CEMENTO PORTLAND TIPO I', nombre_libre: 'CEMENTO PORTLAND TIPO I', descripcion: 'CEMENTO PORTLAND TIPO I',
  unidad: 'bol', cantidad: 100, precio_estimado: 30, factor_presupuesto: null,
  observacion: null, notas: null,
  ...over,
});

const editar = (fn, { r = req(), items = [tubo(), cemento()] } = {}) => {
  const e = edicionInicial({ requisicion: r, items });
  fn(e);
  return cambiosDePreorden({ requisicion: r, items, edicion: e, hoy: '2026-09-25' });
};
const linea = (e, id) => e.lineas.find(l => l.id === id);

describe('aNumero / esFechaValida', () => {
  it('vacío es null, no cero: un precio vacío es «no sé»', () => {
    expect(aNumero('')).toBe(null);
    expect(aNumero('  ')).toBe(null);
    expect(aNumero(null)).toBe(null);
    expect(aNumero('0')).toBe(0);
  });
  it('acepta la coma decimal', () => {
    expect(aNumero('1,5')).toBe(1.5);
    expect(aNumero(' 12 ')).toBe(12);
    expect(aNumero('abc')).toBe(null);
  });
  it('una fecha que no existe no es válida', () => {
    expect(esFechaValida('2026-10-01')).toBe(true);
    expect(esFechaValida('2026-02-30')).toBe(false);
    expect(esFechaValida('01/10/2026')).toBe(false);
    expect(esFechaValida('')).toBe(false);
  });
});

describe('esPreordenEditable', () => {
  it('la del plan, viva y sin orden, se edita', () => {
    expect(esPreordenEditable(req())).toBe(true);
    expect(esPreordenEditable(req({ origen: 'simulador_sobre', origen_ref: 'sobre:x' }))).toBe(true);
  });
  it('la que ya es orden, la descartada o la borrada, no', () => {
    expect(esPreordenEditable(req({ oc_id: 'oc1', estado: 'ordenada' }))).toBe(false);
    expect(esPreordenEditable(req({ oc_id: 'oc1' }))).toBe(false);
    expect(esPreordenEditable(req({ estado: 'cancelada' }))).toBe(false);
    expect(esPreordenEditable(req({ estado: 'rechazada' }))).toBe(false);
    expect(esPreordenEditable(req({ deleted_at: '2026-09-25' }))).toBe(false);
  });
  it('la que cargó el residente a mano tiene su circuito en Compras: no se toca desde acá', () => {
    expect(esPreordenEditable(req({ origen: null }))).toBe(false);
    expect(esPreordenEditable(null)).toBe(false);
  });
});

describe('edicionInicial', () => {
  it('trae lo de la base en texto, con la unidad y el factor originales al lado', () => {
    const e = edicionInicial({ requisicion: req(), items: [tubo(), cemento()] });
    expect(e.cabecera.fecha_necesidad).toBe('2026-10-01');
    const t = linea(e, 'it1');
    expect(t.cantidad).toBe('28');
    expect(t.factor).toBe('6');
    expect(t.unidadOriginal).toBe('tubo');
    expect(t.factorOriginal).toBe(6);
    expect(linea(e, 'it2').factor).toBe('1');   // NULL = 1
  });
  it('sin proveedor elegido, arranca con el sugerido por el escenario', () => {
    const e = edicionInicial({ requisicion: req(), items: [cemento(), tubo()] });
    expect(e.cabecera.proveedor_nombre).toBe('PLASTICOS SAC');
    expect(proveedorSugeridoDeItems([cemento()])).toBe('');
  });
  it('el proveedor ya elegido le gana al sugerido', () => {
    const e = edicionInicial({ requisicion: req({ proveedor_nombre: 'NICOLL PERU', proveedor_id: 'pv9' }), items: [tubo()] });
    expect(e.cabecera.proveedor_nombre).toBe('NICOLL PERU');
    expect(e.cabecera.proveedor_id).toBe('pv9');
  });
  it('las líneas borradas no aparecen', () => {
    const e = edicionInicial({ requisicion: req(), items: [tubo(), cemento({ deleted_at: 'x' })] });
    expect(e.lineas.map(l => l.id)).toEqual(['it1']);
  });
});

describe('cantidadEquivalente', () => {
  it('28 tubos de 6 m son 168 m: pasar a metros no cambia lo pedido', () => {
    expect(cantidadEquivalente(28, 6, 1)).toEqual({ exacta: 168, redondeada: 168 });
  });
  it('164 m en tubos de 6 m son 27,33: se piden 28, hacia arriba', () => {
    expect(cantidadEquivalente(164, 1, 6)).toEqual({ exacta: 27.3333, redondeada: 28 });
  });
  it('sin factor no hay equivalencia', () => {
    expect(cantidadEquivalente(10, 6, '')).toBe(null);
    expect(cantidadEquivalente('', 6, 1)).toBe(null);
  });
});

describe('validarPreorden', () => {
  const val = (fn) => {
    const e = edicionInicial({ requisicion: req(), items: [tubo(), cemento()] });
    fn(e);
    return validarPreorden(e, { hoy: '2026-09-25' });
  };

  it('tal como viene de la base, es válida', () => {
    expect(val(() => {}).ok).toBe(true);
  });
  it('cantidad cero o vacía no se guarda: para sacar una línea está «Quitar»', () => {
    const v = val(e => { linea(e, 'it1').cantidad = '0'; });
    expect(v.ok).toBe(false);
    expect(v.errores[0]).toMatchObject({ id: 'it1', campo: 'cantidad' });
    expect(val(e => { linea(e, 'it1').cantidad = ''; }).ok).toBe(false);
  });
  it('no puede quedar sin líneas: eso es «Descartar»', () => {
    const v = val(e => { e.lineas.forEach(l => { l.quitar = true; }); });
    expect(v.ok).toBe(false);
    expect(v.errores[0].campo).toBe('lineas');
  });
  it('una línea quitada no se valida (puede tener cantidad cero)', () => {
    expect(val(e => { const l = linea(e, 'it1'); l.quitar = true; l.cantidad = '0'; }).ok).toBe(true);
  });
  it('precio vacío deja guardar pero avisa: no entra en la orden', () => {
    const v = val(e => { linea(e, 'it2').precio = ''; });
    expect(v.ok).toBe(true);
    expect(v.avisos.some(a => a.id === 'it2' && /no tiene precio/.test(a.texto))).toBe(true);
  });
  it('precio negativo o que no es número, no', () => {
    expect(val(e => { linea(e, 'it2').precio = '-3'; }).ok).toBe(false);
    expect(val(e => { linea(e, 'it2').precio = 'treinta'; }).ok).toBe(false);
  });
  it('sin unidad o sin factor, no', () => {
    expect(val(e => { linea(e, 'it1').unidad = ' '; }).errores[0].campo).toBe('unidad');
    expect(val(e => { linea(e, 'it1').factor = '0'; }).errores[0].campo).toBe('factor');
    expect(val(e => { linea(e, 'it1').factor = ''; }).errores[0].campo).toBe('factor');
  });
  it('cambiar la unidad sin cambiar el factor avisa: el plan seguiría contando cada metro como 6', () => {
    const v = val(e => { linea(e, 'it1').unidad = 'm'; });
    expect(v.ok).toBe(true);
    expect(v.avisos.some(a => a.id === 'it1' && /no cuánto trae/.test(a.texto))).toBe(true);
    // Con el factor corregido, no avisa.
    const v2 = val(e => { const l = linea(e, 'it1'); l.unidad = 'm'; l.factor = '1'; l.cantidad = '168'; });
    expect(v2.avisos.some(a => /no cuánto trae/.test(a.texto))).toBe(false);
  });
  it('fechas inválidas no; fechas pasadas sí, con aviso', () => {
    expect(val(e => { e.cabecera.fecha_necesidad = '2026-13-01'; }).ok).toBe(false);
    expect(val(e => { linea(e, 'it1').fecha_entrega = '2026-02-30'; }).ok).toBe(false);
    const v = val(e => { e.cabecera.fecha_necesidad = '2026-04-01'; });
    expect(v.ok).toBe(true);
    expect(v.avisos.some(a => /ya pasó/.test(a.texto))).toBe(true);
  });
});

describe('cambiosDePreorden', () => {
  it('sin tocar nada, no escribe nada', () => {
    const c = editar(() => {});
    expect(c.ok).toBe(true);
    expect(c.cabecera).toBe(null);
    expect(c.items).toEqual([]);
    expect(c.quitados).toEqual([]);
    expect(c.cambios).toBe(0);
    expect(c.montoAntes).toBe(28 * 120 + 100 * 30);
    expect(c.montoDespues).toBe(c.montoAntes);
  });

  it('solo manda los campos que cambiaron', () => {
    const c = editar(e => { linea(e, 'it2').precio = '32,5'; });
    expect(c.items).toEqual([{ id: 'it2', patch: { precio_estimado: 32.5 } }]);
    expect(c.montoDespues).toBe(28 * 120 + 100 * 32.5);
  });

  it('la descripción va a las tres columnas: cada pantalla lee una distinta', () => {
    const c = editar(e => { linea(e, 'it2').descripcion = 'CEMENTO SOL TIPO I'; });
    expect(c.items[0].patch).toEqual({ nombre: 'CEMENTO SOL TIPO I', nombre_libre: 'CEMENTO SOL TIPO I', descripcion: 'CEMENTO SOL TIPO I' });
  });

  it('pasar de tubos a metros escribe unidad, factor y cantidad juntos, y el factor 1 va como NULL', () => {
    const c = editar(e => { const l = linea(e, 'it1'); l.unidad = 'm'; l.factor = '1'; l.cantidad = '168'; });
    const p = c.items[0].patch;
    expect(p.unidad).toBe('m');
    expect(p.factor_presupuesto).toBe(null);
    expect(p.cantidad).toBe(168);
  });

  it('corregir la cantidad de una línea con cronograma lo cambia por «a coordinar» (el cronograma ya no suma)', () => {
    const c = editar(e => { linea(e, 'it1').cantidad = '30'; });
    expect(c.items[0].patch.cantidad).toBe(30);
    expect(c.items[0].patch.observacion).toBe(ENTREGAS_A_COORDINAR);
  });
  it('corregir solo el precio no toca el cronograma', () => {
    const c = editar(e => { linea(e, 'it1').precio = '110'; });
    expect(c.items[0].patch).toEqual({ precio_estimado: 110 });
  });
  it('lo demás de la observación se conserva', () => {
    const it = tubo({ observacion: 'Entregas — octubre 2026: 16; noviembre 2026: 12 (tubo) · pedir con certificado' });
    const c = editar(e => { linea(e, 'it1').cantidad = '30'; }, { items: [it, cemento()] });
    expect(c.items[0].patch.observacion).toBe(`${ENTREGAS_A_COORDINAR} · pedir con certificado`);
  });

  it('vaciar el precio escribe NULL, no cero', () => {
    const c = editar(e => { linea(e, 'it2').precio = ''; });
    expect(c.items[0].patch).toEqual({ precio_estimado: null });
  });

  it('la fecha de la línea igual a la de la pre-orden se guarda NULL («la de la cabecera»)', () => {
    const c1 = editar(e => { linea(e, 'it1').fecha_entrega = '2026-10-15'; });
    expect(c1.items[0].patch).toEqual({ fecha_entrega: '2026-10-15' });
    const c2 = editar(e => { linea(e, 'it1').fecha_entrega = '2026-10-01'; });
    expect(c2.items).toEqual([]);
    // Una línea que tenía fecha propia y vuelve a la de la cabecera, la pierde.
    const c3 = editar(e => { linea(e, 'it1').fecha_entrega = '2026-10-01'; },
      { items: [tubo({ fecha_entrega: '2026-10-20' }), cemento()] });
    expect(c3.items[0].patch).toEqual({ fecha_entrega: null });
  });

  it('mover la pre-orden escribe las dos columnas de fecha', () => {
    const c = editar(e => { e.cabecera.fecha_necesidad = '2026-10-05'; });
    expect(c.cabecera).toEqual({ fecha_necesidad: '2026-10-05', fecha_requerida: '2026-10-05' });
  });

  it('el proveedor se guarda con su id si vino del catálogo, y solo con el nombre si se escribió a mano', () => {
    const c = editar(e => { e.cabecera.proveedor_nombre = 'NICOLL PERU'; e.cabecera.proveedor_id = 'pv9'; });
    expect(c.cabecera).toEqual({ proveedor_nombre: 'NICOLL PERU', proveedor_id: 'pv9' });
    const c2 = editar(e => { e.cabecera.proveedor_nombre = 'UN FERRETERO NUEVO'; e.cabecera.proveedor_id = null; });
    expect(c2.cabecera).toEqual({ proveedor_nombre: 'UN FERRETERO NUEVO', proveedor_id: null });
  });
  it('dejar el sugerido tal cual no es elegirlo: no se escribe (aunque la pantalla le haya encontrado el id)', () => {
    const c = editar(e => { e.cabecera.proveedor_id = 'pv-plasticos'; });
    expect(c.cabecera).toBe(null);
    const c2 = editar(e => { e.cabecera.descripcion = 'Tubería — octubre'; });
    expect(c2.cabecera).toEqual({ descripcion: 'Tubería — octubre' });
  });
  it('cambiar el que ya estaba elegido sí se escribe', () => {
    const r = req({ proveedor_nombre: 'NICOLL PERU', proveedor_id: 'pv9' });
    const items = [tubo()];
    const e = edicionInicial({ requisicion: r, items });
    e.cabecera.proveedor_nombre = 'PLASTICOS SAC';
    e.cabecera.proveedor_id = null;
    const c = cambiosDePreorden({ requisicion: r, items, edicion: e });
    expect(c.cabecera).toEqual({ proveedor_nombre: 'PLASTICOS SAC', proveedor_id: null });
  });

  it('quitar una línea la lista aparte y la saca del monto', () => {
    const c = editar(e => { linea(e, 'it2').quitar = true; });
    expect(c.quitados).toEqual(['it2']);
    expect(c.items).toEqual([]);
    expect(c.montoDespues).toBe(28 * 120);
    expect(c.cambios).toBe(1);
  });

  it('una edición inválida no devuelve nada que escribir', () => {
    const c = editar(e => { linea(e, 'it1').cantidad = '-1'; });
    expect(c.ok).toBe(false);
    expect(c.items).toEqual([]);
    expect(c.cabecera).toBe(null);
  });
  it('una pre-orden que ya es orden no se edita', () => {
    const r = req({ oc_id: 'oc1', estado: 'ordenada' });
    const e = edicionInicial({ requisicion: r, items: [tubo()] });
    linea(e, 'it1').cantidad = '10';
    const c = cambiosDePreorden({ requisicion: r, items: [tubo()], edicion: e });
    expect(c.ok).toBe(false);
    expect(c.errores[0].campo).toBe('requisicion');
  });
  it('una línea que llegó por sync mientras se editaba sigue contando en el monto', () => {
    const r = req();
    const e = edicionInicial({ requisicion: r, items: [tubo()] });
    const c = cambiosDePreorden({ requisicion: r, items: [tubo(), cemento()], edicion: e });
    expect(c.montoDespues).toBe(28 * 120 + 100 * 30);
  });
});

// ── LO QUE LA EDICIÓN LE HACE AL PLAN ─────────────────────────────
// No hay código aparte: el descuento es código × cantidad × factor. Estos
// tests lo fijan para que nadie «optimice» el descuento y rompa la edición.
describe('la edición y el descuento del plan (coberturaPrevia)', () => {
  const cubierto = (items, r = req()) =>
    coberturaPrevia({ requisiciones: [r], requisicionItems: items }).cubierto;
  const aplicar = (items, c) => items.map(it => {
    const p = c.items.find(x => x.id === it.id);
    const fuera = c.quitados.includes(it.id);
    return { ...it, ...(p ? p.patch : {}), ...(fuera ? { deleted_at: 'x' } : {}) };
  });

  it('pasar de tubos a metros con la cantidad equivalente descuenta lo mismo del presupuesto', () => {
    const items = [tubo(), cemento()];
    const antes = cubierto(items).get('0210040010');
    const c = editar(e => { const l = linea(e, 'it1'); l.unidad = 'm'; l.factor = '1'; l.cantidad = '168'; });
    const despues = cubierto(aplicar(items, c)).get('0210040010');
    expect(antes).toBe(168);
    expect(despues).toBe(168);
  });
  it('bajar una cantidad devuelve la diferencia al plan', () => {
    const items = [tubo(), cemento()];
    const c = editar(e => { linea(e, 'it2').cantidad = '60'; });
    expect(cubierto(aplicar(items, c)).get('0221000000')).toBe(60);
  });
  it('quitar una línea la devuelve entera', () => {
    const items = [tubo(), cemento()];
    const c = editar(e => { linea(e, 'it2').quitar = true; });
    expect(cubierto(aplicar(items, c)).has('0221000000')).toBe(false);
  });
  it('descartar la pre-orden la devuelve entera al plan', () => {
    const r = req();
    const patch = descarteDePreorden(r);
    expect(patch).toEqual({ estado: 'cancelada', motivo_rechazo: MOTIVO_DESCARTE });
    expect(cubierto([tubo(), cemento()], { ...r, ...patch }).size).toBe(0);
  });
  it('lo que no es pre-orden editable no se descarta desde acá', () => {
    expect(descarteDePreorden(req({ oc_id: 'oc1', estado: 'ordenada' }))).toBe(null);
    expect(descarteDePreorden(req({ origen: null }))).toBe(null);
  });
});

// ── LA ORDEN QUE SALE DE UNA PRE-ORDEN EDITADA ────────────────────
describe('borradorDeOrdenDesdeRequisicion con la pre-orden editada', () => {
  const obra = { id: 'obra', nombre_obra: 'PLAN MIRAFLORES', ejecutora_company_id: 'co-inca', ejecutora_tipo: 'consorcio' };
  const company = { id: 'co-inca', name: 'CONSORCIO EL INCA', codigo_doc_prefix: 'EI' };
  let n = 0;
  const nuevoId = () => `id-${++n}`;

  it('sin proveedor en la llamada, usa el que se eligió al editar', () => {
    const r = req({ proveedor_id: 'pv9', proveedor_nombre: 'NICOLL PERU' });
    const b = borradorDeOrdenDesdeRequisicion({ requisicion: r, items: [tubo(), cemento()], obra, company, nuevoId });
    expect(b.ok).toBe(true);
    expect(b.orden.proveedor_id).toBe('pv9');
    expect(b.orden.proveedor_nombre).toBe('NICOLL PERU');
  });
  it('el que se manda en la llamada le gana', () => {
    const r = req({ proveedor_nombre: 'NICOLL PERU' });
    const b = borradorDeOrdenDesdeRequisicion({ requisicion: r, items: [tubo()], obra, company, proveedor: { nombre: 'OTRO' }, nuevoId });
    expect(b.orden.proveedor_nombre).toBe('OTRO');
  });
  it('sin ninguno, sigue sin emitir', () => {
    const b = borradorDeOrdenDesdeRequisicion({ requisicion: req(), items: [tubo()], obra, company, nuevoId });
    expect(b.ok).toBe(false);
    expect(b.motivo).toBe('sin_proveedor');
  });

  it('con fechas por línea distintas, entrega cuando llega la primera y la cabecera las nombra', () => {
    const items = [tubo({ fecha_entrega: '2026-10-15', observacion: null }), cemento()];
    const b = borradorDeOrdenDesdeRequisicion({ requisicion: req(), items, obra, company, proveedor: { nombre: 'X' }, nuevoId });
    expect(b.orden.fecha_entrega).toBe('2026-10-01');
    expect(b.orden.fecha_entrega_ref).toBe('Entregas por línea: 01/10/2026 (1 línea), 15/10/2026 (1 línea) — la fecha de cada línea está en la requisición');
  });
  it('si todas las líneas se movieron al mismo día, ése es el de la entrega', () => {
    const items = [tubo({ fecha_entrega: '2026-10-20', observacion: null }), cemento({ fecha_entrega: '2026-10-20' })];
    const b = borradorDeOrdenDesdeRequisicion({ requisicion: req(), items, obra, company, proveedor: { nombre: 'X' }, nuevoId });
    expect(b.orden.fecha_entrega).toBe('2026-10-20');
    expect(b.orden.fecha_entrega_ref).toBeUndefined();
  });
  it('sin fechas por línea, todo sigue como antes (cronograma por período)', () => {
    const b = borradorDeOrdenDesdeRequisicion({ requisicion: req(), items: [tubo(), cemento()], obra, company, proveedor: { nombre: 'X' }, nuevoId });
    expect(b.orden.fecha_entrega).toBe('2026-10-01');
    expect(b.orden.fecha_entrega_ref).toBe('Entregas parciales: octubre 2026, noviembre 2026 (cantidades por línea en la requisición)');
  });
  it('la unidad y el factor editados viajan a la orden', () => {
    const items = [tubo({ unidad: 'm', cantidad: 168, precio_estimado: 20, factor_presupuesto: null })];
    const b = borradorDeOrdenDesdeRequisicion({ requisicion: req(), items, obra, company, proveedor: { nombre: 'X' }, nuevoId });
    expect(b.items[0].unidad).toBe('m');
    expect(b.items[0].cantidad).toBe(168);
    expect(b.items[0].factor_presupuesto).toBeUndefined();
  });
});

describe('fechasDeEntrega / referenciaDeEntregas', () => {
  it('agrupa por fecha y usa la de la cabecera para las líneas sin fecha propia', () => {
    const items = [{ id: 'a', fecha_entrega: '2026-10-15' }, { id: 'b' }, { id: 'c' }];
    expect(fechasDeEntrega(items, '2026-10-01')).toEqual([
      { fecha: '2026-10-01', lineas: 2 }, { fecha: '2026-10-15', lineas: 1 },
    ]);
  });
  it('sin cabecera ni fechas por línea, la referencia es la de siempre', () => {
    expect(referenciaDeEntregas([{ observacion: ENTREGAS_A_COORDINAR }])).toBe('Entregas parciales a coordinar con obra');
    expect(referenciaDeEntregas([{ observacion: null }])).toBe(null);
  });
});
