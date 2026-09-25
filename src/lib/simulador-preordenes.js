// ═══════════════════════════════════════════════════════════════════
// JARVEX — SIMULADOR DE ÓRDENES, RONDA 4, TANDA 4.4: EDITAR LAS PRE-ÓRDENES.
//
// Diseño en `docs/plan-simulador-ordenes.md` §16.3. «Cerrar mes» (4.3) y
// «Convertir en requisiciones» escriben lo aceptado como requisiciones del
// plan: las PRE-ÓRDENES. Entre eso y emitir la orden (que quema un
// correlativo y no se deshace) está el único momento en que el pedido se
// corrige barato: descripción, unidad, cantidad, precio, proveedor y fecha.
// Hasta esta tanda eso no se podía: la pantalla de Compras solo deja editar
// las requisiciones propias, una vez, y no conoce ni el factor ni el precio.
//
// ── LO QUE UNA EDICIÓN LE HACE AL PLAN ────────────────────────────
// Nada que haya que programar aparte. El descuento que evita pedir dos veces
// (`coberturaPrevia()`) resta código × cantidad × factor de cada requisición
// viva, así que:
//   · BAJAR una cantidad devuelve la diferencia al plan (si su mes está
//     cerrado, `reprogramarCerrados` la manda a los meses abiertos);
//   · SUBIRLA la descuenta de los meses que vienen;
//   · DESCARTAR la pre-orden la deja `cancelada` y vuelve entera al plan,
//     igual que una orden anulada (4.2).
//
// ── LA UNIDAD Y EL FACTOR VAN JUNTOS ──────────────────────────────
// La cantidad pedida está en unidades de COMPRA (28 tubos) y el descuento se
// hace en las del PRESUPUESTO (168 m) con `factor_presupuesto` (mig 228).
// Cambiar la unidad sin cambiar el factor deja al plan contando cada metro
// como un tubo de 6 m: pide seis veces menos de lo que falta. Por eso la
// unidad nunca se edita sola — la pantalla propone el factor cuando lo sabe
// (`factorPropuesto`, el mismo de «Imputar lo ya comprado») y avisa cuando no.
//
// Puro: sin React, sin Dexie. Testeado en __tests__/simulador-preordenes.test.js
// ═══════════════════════════════════════════════════════════════════

import { esRequisicionDelPlan } from './ordenes.js';
import { PREFIJO_ENTREGAS, ENTREGAS_A_COORDINAR } from './simulador-puente.js';
import { factorDeItem } from './simulador-ordenes.js';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;
const r4 = (n) => Math.round((num(n) + Number.EPSILON) * 10000) / 10000;
const vivos = (arr) => (Array.isArray(arr) ? arr : []).filter(x => x && !x.deleted_at);
const texto = (v) => String(v ?? '').trim();
const igual = (a, b) => Math.abs(num(a) - num(b)) < 1e-9;

/**
 * Lo que se escribe en un campo numérico, a número. Vacío → null (no cero:
 * un precio vacío es «no sé», y cero es «gratis»). Acepta la coma decimal
 * que se tipea en Perú («1,5»), pero no el separador de miles: «1.500» es
 * uno y medio, como lo lee cualquier input numérico.
 */
export function aNumero(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = String(v).trim().replace(/\s+/g, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 'YYYY-MM-DD' que existe en el calendario (no 2026-02-30). */
export function esFechaValida(f) {
  if (!FECHA_RE.test(String(f || ''))) return false;
  const [y, m, d] = String(f).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Las que ya no se editan: la muerta volvió al plan y la ordenada ya es un
// documento con correlativo — se corrige en Órdenes, no acá.
const NO_EDITABLES = new Set(['cancelada', 'rechazada', 'ordenada', 'recibida', 'recibida_parcial']);

/**
 * ¿Se puede editar esta requisición como pre-orden?
 * Solo las del PLAN (el simulador las escribió), vivas y sin orden.
 * Las que carga el residente a mano tienen su propio circuito en Compras
 * (una edición, con revisor) y no se tocan desde acá.
 */
export function esPreordenEditable(requisicion) {
  if (!requisicion || requisicion.deleted_at) return false;
  if (!esRequisicionDelPlan(requisicion)) return false;
  if (requisicion.oc_id) return false;
  return !NO_EDITABLES.has(String(requisicion.estado || ''));
}

/**
 * El proveedor que el escenario dejó anotado en las líneas
 * («Proveedor sugerido: X», lo escribe `armarRequisiciones`). Es el punto de
 * partida cuando la pre-orden todavía no tiene uno elegido.
 */
export function proveedorSugeridoDeItems(items = []) {
  for (const it of vivos(items)) {
    const m = /Proveedor sugerido:\s*(.+)$/.exec(String(it.notas || ''));
    if (m) return m[1].trim();
  }
  return '';
}

/** El nombre de una línea, venga de la columna que venga. */
const nombreDeItem = (it) => it?.nombre || it?.nombre_libre || it?.descripcion || '';

/**
 * El estado inicial del editor: lo que hay hoy en la base, en texto (lo que
 * muestran los inputs). Guarda al lado lo ORIGINAL de la unidad y el factor,
 * para poder avisar cuando se cambió uno sin el otro.
 */
export function edicionInicial({ requisicion = null, items = [] } = {}) {
  const r = requisicion || {};
  return {
    cabecera: {
      descripcion: r.descripcion || '',
      fecha_necesidad: r.fecha_necesidad || r.fecha_requerida || '',
      proveedor_id: r.proveedor_id || null,
      proveedor_nombre: r.proveedor_nombre || proveedorSugeridoDeItems(items),
    },
    lineas: vivos(items).map(it => ({
      id: it.id,
      insumo_codigo: it.insumo_codigo || null,
      descripcion: nombreDeItem(it),
      unidad: it.unidad || '',
      factor: String(r4(factorDeItem(it))),
      cantidad: String(r4(it.cantidad)),
      precio: it.precio_estimado == null ? '' : String(r4(it.precio_estimado)),
      fecha_entrega: it.fecha_entrega || '',
      quitar: false,
      unidadOriginal: it.unidad || '',
      factorOriginal: r4(factorDeItem(it)),
    })),
  };
}

/**
 * La cantidad que pide LO MISMO del presupuesto en otra unidad.
 * 28 tubos de 6 m → 168 m; 164 m → 27,33 tubos, que se piden 28.
 *
 * @returns {{exacta:number, redondeada:number}|null} null si falta un factor.
 */
export function cantidadEquivalente(cantidad, factorViejo, factorNuevo) {
  const c = aNumero(cantidad), fv = aNumero(factorViejo), fn = aNumero(factorNuevo);
  if (c == null || !(fv > 0) || !(fn > 0)) return null;
  const exacta = r4((c * fv) / fn);
  // Hacia arriba: pedir de menos por redondear es el desabastecimiento que
  // el plan viene a evitar. El 1e-9 es para que 168/6 no dé 28,0000001 → 29.
  return { exacta, redondeada: Math.ceil(exacta - 1e-9) };
}

/**
 * Qué está mal (no deja guardar) y qué conviene mirar (deja).
 *
 * @returns {{ok:boolean, errores:Array<{id:string|null, campo:string, texto:string}>,
 *            avisos:Array<{id:string|null, texto:string}>}}
 */
export function validarPreorden(edicion, { hoy = null } = {}) {
  const errores = [], avisos = [];
  const cab = edicion?.cabecera || {};
  const lineas = Array.isArray(edicion?.lineas) ? edicion.lineas : [];

  const fechaCab = texto(cab.fecha_necesidad);
  if (fechaCab && !esFechaValida(fechaCab)) {
    errores.push({ id: null, campo: 'fecha_necesidad', texto: 'La fecha de la pre-orden no es una fecha válida.' });
  }
  if (!fechaCab) avisos.push({ id: null, texto: 'La pre-orden no dice para cuándo se necesita: la orden saldría sin fecha de entrega.' });
  else if (hoy && esFechaValida(fechaCab) && fechaCab < hoy) {
    avisos.push({ id: null, texto: `La pre-orden se necesitaba para el ${fechaCab}, que ya pasó.` });
  }

  const quedan = lineas.filter(l => !l.quitar);
  if (!quedan.length) {
    errores.push({ id: null, campo: 'lineas', texto: 'No puede quedar sin líneas. Para devolver la pre-orden entera al plan, usá «Descartar».' });
  }

  for (const l of quedan) {
    const nombre = texto(l.descripcion) || l.insumo_codigo || 'una línea';
    const c = aNumero(l.cantidad);
    if (c == null || c <= 0) {
      errores.push({ id: l.id, campo: 'cantidad', texto: `«${nombre}»: la cantidad tiene que ser mayor que cero. Para sacarla, usá «Quitar».` });
    }
    const p = aNumero(l.precio);
    if (texto(l.precio) && p == null) {
      errores.push({ id: l.id, campo: 'precio', texto: `«${nombre}»: el precio no es un número.` });
    } else if (p != null && p < 0) {
      errores.push({ id: l.id, campo: 'precio', texto: `«${nombre}»: el precio no puede ser negativo.` });
    } else if (p == null || p === 0) {
      avisos.push({ id: l.id, texto: `«${nombre}» no tiene precio: no entra en la orden hasta que lo tenga.` });
    }
    if (!texto(l.unidad)) {
      errores.push({ id: l.id, campo: 'unidad', texto: `«${nombre}»: falta la unidad.` });
    }
    const f = aNumero(l.factor);
    if (f == null || f <= 0) {
      errores.push({ id: l.id, campo: 'factor', texto: `«${nombre}»: falta cuánto del presupuesto trae cada unidad (tiene que ser mayor que cero).` });
    } else if (l.insumo_codigo
      && texto(l.unidad).toLowerCase() !== texto(l.unidadOriginal).toLowerCase()
      && igual(f, l.factorOriginal)) {
      // No es un error: «und» → «pza» trae lo mismo. Pero tubo → m con el
      // factor del tubo haría que el plan cuente cada metro como 6.
      avisos.push({ id: l.id, texto: `«${nombre}»: cambiaste la unidad (${l.unidadOriginal || '—'} → ${texto(l.unidad)}) pero no cuánto trae cada una. El plan sigue contando cada ${texto(l.unidad)} como ${r4(f)} del presupuesto.` });
    }
    const fe = texto(l.fecha_entrega);
    if (fe && !esFechaValida(fe)) {
      errores.push({ id: l.id, campo: 'fecha_entrega', texto: `«${nombre}»: la fecha de entrega no es una fecha válida.` });
    } else if (fe && hoy && fe < hoy) {
      avisos.push({ id: l.id, texto: `«${nombre}» se necesitaba para el ${fe}, que ya pasó.` });
    }
  }

  return { ok: errores.length === 0, errores, avisos };
}

/**
 * La observación de una línea cuando su cantidad (o su unidad) se corrigió a
 * mano: el cronograma «Entregas — octubre: 10; noviembre: 12» ya no suma lo
 * que dice la línea, y dejarlo haría que alguien entregue 22 de 30. Se
 * reemplaza por el mismo aviso que usa la 2.3 cuando se corrige una línea
 * consolidada (`ENTREGAS_A_COORDINAR`); lo demás de la observación queda.
 */
function observacionTrasCorregir(observacion) {
  const partes = String(observacion || '').split(' · ');
  if (!partes.some(p => p.startsWith(PREFIJO_ENTREGAS))) return null;
  return partes.map(p => (p.startsWith(PREFIJO_ENTREGAS) ? ENTREGAS_A_COORDINAR : p)).join(' · ');
}

const montoDe = (cantidad, precio) => num(cantidad) * num(precio);

/**
 * Lo que hay que escribir para guardar una edición: SOLO los campos que
 * cambiaron. Un campo que se manda igual igual cuesta una versión y un push,
 * y pisa lo que otra computadora haya cambiado en otro campo.
 *
 * @param {Object} o
 * @param {Object} o.requisicion   la fila de la base.
 * @param {Array}  o.items         sus ítems de la base.
 * @param {Object} o.edicion       el estado del editor (`edicionInicial` + cambios).
 * @param {string} [o.hoy]
 *
 * @returns {{ok:boolean, errores:Array, avisos:Array,
 *            cabecera:Object|null, items:Array<{id:string, patch:Object}>,
 *            quitados:Array<string>, montoAntes:number, montoDespues:number,
 *            cambios:number}}
 */
export function cambiosDePreorden({ requisicion = null, items = [], edicion = null, hoy = null } = {}) {
  const vacio = { cabecera: null, items: [], quitados: [], montoAntes: 0, montoDespues: 0, cambios: 0 };
  if (!esPreordenEditable(requisicion)) {
    return {
      ok: false, avisos: [], ...vacio,
      errores: [{ id: null, campo: 'requisicion', texto: 'Esta requisición ya no se puede editar: ya es una orden, se descartó o no es del plan.' }],
    };
  }
  const v = validarPreorden(edicion, { hoy });
  if (!v.ok) return { ...v, ...vacio };

  // ── la cabecera ──────────────────────────────────────────────────
  const cab = edicion.cabecera || {};
  const cabecera = {};
  const desc = texto(cab.descripcion) || null;
  if (desc !== (requisicion.descripcion || null)) cabecera.descripcion = desc;
  const fecha = texto(cab.fecha_necesidad) || null;
  if (fecha !== (requisicion.fecha_necesidad || null)) {
    cabecera.fecha_necesidad = fecha;
    // `fecha_requerida` es el nombre viejo de la misma fecha (Compras escribe
    // las dos): si quedan distintas, cada pantalla muestra una.
    cabecera.fecha_requerida = fecha;
  }
  const provNombre = texto(cab.proveedor_nombre) || null;
  const provId = provNombre ? (cab.proveedor_id || null) : null;
  // Sin proveedor elegido, el editor arranca con el SUGERIDO (el de las
  // notas). Dejarlo tal cual no es elegirlo: abrir y guardar sin tocar no
  // tiene que escribir nada.
  const provAntes = requisicion.proveedor_nombre || null;
  const esElSugerido = !provAntes && provNombre
    && provNombre.toLowerCase() === proveedorSugeridoDeItems(items).toLowerCase();
  if (!esElSugerido && (provNombre !== provAntes || provId !== (requisicion.proveedor_id || null))) {
    cabecera.proveedor_nombre = provNombre;
    cabecera.proveedor_id = provId;
  }

  // ── las líneas ───────────────────────────────────────────────────
  const porId = new Map(vivos(items).map(it => [it.id, it]));
  const cambiosItems = [], quitados = [];
  let montoAntes = 0, montoDespues = 0;
  for (const it of porId.values()) montoAntes += montoDe(it.cantidad, it.precio_estimado);

  for (const l of edicion.lineas || []) {
    const it = porId.get(l.id);
    if (!it) continue;   // la borró otra computadora mientras se editaba
    if (l.quitar) { quitados.push(it.id); continue; }

    const patch = {};
    const nombre = texto(l.descripcion);
    if (nombre && nombre !== nombreDeItem(it)) {
      // Las tres columnas dicen lo mismo y cada pantalla lee una distinta
      // (Compras `nombre_libre`, la orden `nombre`, el PDF `descripcion`).
      patch.nombre = nombre;
      patch.nombre_libre = nombre;
      patch.descripcion = nombre;
    }
    const unidad = texto(l.unidad);
    if (unidad !== (it.unidad || '')) patch.unidad = unidad;

    const factor = aNumero(l.factor);
    if (!igual(factor, factorDeItem(it))) {
      // NULL = 1 (mig 228). Volver a 1 escribe NULL, no 1: así una línea
      // corregida de vuelta queda igual que una que nunca tuvo factor.
      patch.factor_presupuesto = igual(factor, 1) ? null : r4(factor);
    }

    const cantidad = r4(aNumero(l.cantidad));
    if (!igual(cantidad, r4(it.cantidad))) patch.cantidad = cantidad;

    const precioTxt = texto(l.precio);
    const precio = precioTxt ? r4(aNumero(precioTxt)) : null;
    const precioAntes = it.precio_estimado == null ? null : r4(it.precio_estimado);
    if (precio === null ? precioAntes !== null : (precioAntes === null || !igual(precio, precioAntes))) {
      patch.precio_estimado = precio;
    }

    // La fecha de la línea igual a la de la pre-orden se guarda como NULL:
    // «la de la cabecera». Así, si después se mueve la pre-orden entera, la
    // línea se mueve con ella en vez de quedar clavada en la fecha vieja.
    const fechaCab = fecha || requisicion.fecha_necesidad || null;
    let fe = texto(l.fecha_entrega) || null;
    if (fe && fe === fechaCab) fe = null;
    if (fe !== (it.fecha_entrega || null)) patch.fecha_entrega = fe;

    if ('cantidad' in patch || 'unidad' in patch || 'factor_presupuesto' in patch) {
      const obs = observacionTrasCorregir(it.observacion);
      if (obs !== null && obs !== it.observacion) patch.observacion = obs;
    }

    montoDespues += montoDe(
      'cantidad' in patch ? patch.cantidad : it.cantidad,
      'precio_estimado' in patch ? patch.precio_estimado : it.precio_estimado,
    );
    if (Object.keys(patch).length) cambiosItems.push({ id: it.id, patch });
  }
  // Las líneas que el editor no conocía (llegaron por sync mientras se
  // editaba) siguen en la pre-orden: cuentan en el monto de después.
  const enEdicion = new Set((edicion.lineas || []).map(l => l.id));
  for (const it of porId.values()) {
    if (!enEdicion.has(it.id)) montoDespues += montoDe(it.cantidad, it.precio_estimado);
  }

  const tieneCab = Object.keys(cabecera).length > 0;
  return {
    ok: true,
    errores: [],
    avisos: v.avisos,
    cabecera: tieneCab ? cabecera : null,
    items: cambiosItems,
    quitados,
    montoAntes: r2(montoAntes),
    montoDespues: r2(montoDespues),
    cambios: (tieneCab ? 1 : 0) + cambiosItems.length + quitados.length,
  };
}

export const MOTIVO_DESCARTE = 'Descartada desde el simulador de órdenes: lo suyo vuelve al plan.';

/**
 * Descartar una pre-orden entera: pasa a `cancelada`, el mismo estado que
 * deja una orden anulada (4.2). `coberturaPrevia()` deja de descontarla y la
 * próxima corrida vuelve a proponer lo suyo; si su mes está cerrado,
 * `reprogramarCerrados` lo reparte en los meses abiertos.
 *
 * No se borra: la fila queda como rastro de que se pidió y se descartó.
 *
 * @returns {Object|null} el patch, o null si no es una pre-orden editable.
 */
export function descarteDePreorden(requisicion) {
  if (!esPreordenEditable(requisicion)) return null;
  return { estado: 'cancelada', motivo_rechazo: MOTIVO_DESCARTE };
}
