// ═══════════════════════════════════════════════════════════════════
// JARVEX — SIMULADOR DE ÓRDENES, TANDA 4: EL PUENTE AL DOCUMENTO REAL.
//
// Diseño en `docs/plan-simulador-ordenes.md` §7. Las tandas 1-3 dejaron el
// plan: qué comprar, cuándo, agrupado en qué orden, y aceptado o rechazado
// tramo por tramo. Todo eso vive en el localStorage de una persona. Este
// archivo es el único lugar donde ese plan se convierte en una fila.
//
// ── EL CAMINO, Y POR QUÉ TIENE DOS TRAMOS Y NO UNO ────────────────
//
//   líneas aceptadas ──▶ requisiciones ──▶ orden de compra / servicio
//                        (se edita, se       (quema un correlativo,
//                         borra, se rehace)   va a SUNAT, no se deshace)
//
// El simulador escribe REQUISICIONES, no órdenes. Aceptar una tarjeta en la
// pantalla es decir «esto hay que pedirlo en octubre», no «emitile el
// documento a este proveedor hoy». Meter las dos cosas en un botón haría que
// aceptar 30 tarjetas queme 30 correlativos de la ejecutora — números que,
// como dice el encabezado de `ordenes.js`, no se arreglan después.
//
// El segundo tramo se hace de a una, con el proveedor ya elegido y la
// ejecutora a la vista.
//
// ── POR QUÉ NO HAY TABLA NUEVA (§7) ───────────────────────────────
// `requisiciones` + `requisicion_items` ya tienen todo: obra, partida,
// fecha_necesidad, prioridad, estado, y el puente a la orden en los dos
// sentidos (`requisiciones.oc_id`/`oc_codigo`, `oc_items.requisicion_item_id`).
// Tenían 4 y 12 filas el 22-set-2026: estaban sin usar, no mal diseñadas.
// La mig 226 les suma tres cosas chicas — `origen`, `origen_ref`,
// `requisicion_items.insumo_codigo` — y abre el CHECK de `tipo_insumo` para
// que un alquiler entre (el 23% de la plata comprable de Miraflores).
//
// ── LA INVARIANTE: NADA SE PIDE DOS VECES ─────────────────────────
// Es la razón de ser de `origen_ref` y de `insumo_codigo`. Una vez que la
// línea «TUBERÍA PVC 4"» de octubre se escribió como requisición, la corrida
// de noviembre tiene que restarla. `yaRequisado()` arma ese descuento y se lo
// pasa a `simularOrdenes({ requisiciones, requisicionItems })`.
//
// Y con el mismo criterio de «cero silencioso» de `abastecimiento.js`: una
// línea de requisición SIN código de insumo no se puede descontar de nada, y
// entonces NO se descuenta — se cuenta aparte, en `sinImputar`, para que la
// pantalla lo diga. Restarla a ojo borraría material que sí hay que pedir.
//
// Puro: sin React, sin Dexie. Testeado en __tests__/simulador-puente.test.js
// ═══════════════════════════════════════════════════════════════════

import { hoyLocal } from './fecha.js';
// El período ya sabe convertirse en fechas y ese cálculo vive en un solo
// lugar desde la tanda 2. Derivarlo de nuevo acá es justo lo que la tanda 3
// evitó con `clave`: dos derivaciones paralelas se desincronizan en silencio.
import { rangoDePeriodo } from './simulador-dotacion.js';
import { textosDeTipo, proximoCodigo, totalesDesdeItems } from './ordenes.js';
import { titularContableDeObra } from './consorcio.js';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;
const r4 = (n) => Math.round((num(n) + Number.EPSILON) * 10000) / 10000;
const vivos = (arr) => (Array.isArray(arr) ? arr : []).filter(x => x && !x.deleted_at);

/**
 * `factor_presupuesto` (mig 228): cuántas unidades del expediente trae cada
 * unidad pedida — un tubo de 6 m son 6 m. Es lo que deja que la corrida
 * siguiente descuente en la unidad del presupuesto (`coberturaPrevia`).
 *
 * Solo se escribe cuando NO es 1. Con factor 1 la columna es redundante
 * (NULL ya significa «misma unidad»), y así una requisición común no depende
 * de que la migración esté aplicada: el push de una columna que el servidor
 * no conoce rechaza la fila entera.
 */
const conFactor = (factor) => {
  const f = Number(factor);
  return Number.isFinite(f) && f > 0 && Math.abs(f - 1) > 1e-9 ? { factor_presupuesto: r4(f) } : {};
};

let seq = 0;
const idPorDefecto = () => {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* entorno sin crypto */ }
  seq += 1;
  return `sim-${Date.now().toString(36)}-${seq}`;
};

// ═══════════════════════════════════════════════════════════════════
// VOCABULARIO: la subcategoría del simulador → el `tipo_insumo` de la tabla
// ═══════════════════════════════════════════════════════════════════

/**
 * El CHECK de `requisicion_items.tipo_insumo` admite exactamente estos seis
 * (los cinco de siempre más 'servicio', que abrió la mig 226). Dexie NO
 * valida CHECKs: una fila con un valor de más se guarda local y rebota en el
 * push con un 23514, dejando el sync en reintento eterno — el mismo modo de
 * falla que la regla 9 de CLAUDE.md describe para `insumo_categoria`.
 */
export const TIPOS_INSUMO_REQUISICION = ['material', 'herramienta', 'epp', 'emergencia', 'maquinaria', 'servicio'];

/**
 * A qué `tipo_insumo` va cada subcategoría del simulador.
 *
 * `mano_obra` no está y no puede estar: la planilla no se requisa (§5). Si
 * llega una línea así, `armarRequisiciones()` la manda a `omitidas` en vez de
 * traducirla al valor más parecido.
 */
export const TIPO_INSUMO_DE_SUBCATEGORIA = {
  material: 'material',
  herramienta: 'herramienta',
  epp: 'epp',
  maquinaria: 'maquinaria',
  servicio: 'servicio',
};

export function tipoInsumoDeSubcategoria(subcategoria) {
  return TIPO_INSUMO_DE_SUBCATEGORIA[String(subcategoria || '')] || null;
}

/**
 * Una orden de SERVICIO cuando lo que se pide es un servicio o un alquiler;
 * de COMPRA cuando es algo que entra al almacén. Es la única diferencia real
 * entre los dos documentos del modelo (ver `ordenes.js`).
 */
export function tipoDeOrdenDeSubcategoria(subcategoria) {
  return subcategoria === 'servicio' ? 'servicio' : 'compra';
}

export const ORIGENES_SIMULADOR = ['simulador', 'simulador_sobre'];
export const esDelSimulador = (r) => ORIGENES_SIMULADOR.includes(String(r?.origen || ''));

// ═══════════════════════════════════════════════════════════════════
// PLAN ACEPTADO → REQUISICIONES
// ═══════════════════════════════════════════════════════════════════

/**
 * La fecha en la que se necesita lo de un período.
 *
 * El primer día del mes (o el lunes de la semana), NO el día de hoy: una
 * requisición de diciembre con fecha de necesidad de septiembre se lee como
 * atrasada desde el momento en que se crea. Si el período no se entiende, se
 * devuelve null y la columna queda vacía — inventar una fecha es peor.
 */
export function fechaNecesidadDePeriodo(periodo) {
  return rangoDePeriodo(periodo)?.inicio || null;
}

/**
 * Las requisiciones que corresponden a un plan aceptado.
 *
 * Una propuesta del simulador («Materiales — octubre 2026») es UNA
 * requisición con sus N ítems: es la misma unidad que se acepta o se rechaza
 * en la pantalla, y la misma que después se convierte en una orden.
 *
 * @param {Object}   o
 * @param {Array}    o.lineas        lo que devuelve `lineasAceptadas().lineas`.
 * @param {string}   o.obraId
 * @param {string}   [o.hoy]         'YYYY-MM-DD'.
 * @param {Object}   [o.escenario]   para dejar dicho de qué corrida salió.
 * @param {Object}   [o.solicitante] { id, nombre } de quien la pide.
 * @param {Array}    [o.yaEscritas]  requisiciones vivas de la obra: las que
 *                                   ya tengan el mismo `origen_ref` NO se
 *                                   vuelven a escribir (salen por `duplicadas`).
 * @param {Array}    [o.yaEscritasItems] sus ítems. Con ellos el freno es por
 *                                   LÍNEA y no por propuesta (tanda 2.3).
 * @param {Function} [o.nuevoId]
 *
 * @returns {{requisiciones:Array<{requisicion:Object, items:Array}>,
 *            omitidas:Array, duplicadas:Array, resumen:Object}}
 */
export function armarRequisiciones({
  lineas = [],
  obraId = null,
  hoy = null,
  escenario = null,
  solicitante = null,
  yaEscritas = [],
  yaEscritasItems = null,
  nuevoId = idPorDefecto,
} = {}) {
  const fecha = hoy || hoyLocal();
  const omitidas = [], duplicadas = [];

  const reqsEscritas = vivos(yaEscritas)
    .filter(r => !REQUISICION_MUERTA.has(String(r.estado || '')) && r.origen_ref);
  const refsEscritas = new Set(reqsEscritas.map(r => String(r.origen_ref)));

  // ── EL FRENO POR LÍNEA (tanda 2.3) ────────────────────────────────
  // Hasta la 2.2 bastaba con mirar el `origen_ref`: si la propuesta
  // «2026-10|concreto» ya tenía requisición, nada de ella se volvía a
  // escribir. Con la consolidación eso se come líneas NUEVAS: si octubre se
  // escribió a medias y después la orden de octubre pasa a juntar noviembre,
  // el cemento de noviembre lleva el mismo `origen_ref` y se salteaba en
  // silencio, contado como «ya escrito».
  //
  // Con los ítems a la vista la pregunta es la correcta: ¿ESTA línea ya está
  // escrita? Una línea con código lo está si bajo ese mismo `origen_ref` hay
  // un ítem con el mismo código y la misma cantidad — el caso del segundo
  // click antes de que la corrida se recalcule. Si la cantidad cambió, lo
  // escrito ya se descontó en `coberturaPrevia()` y lo que queda es nuevo.
  // Una línea SIN código no se puede descontar de nada (sale por
  // `reqSinImputar`), así que para ella el freno sigue siendo el de antes: si
  // su propuesta ya se escribió, no se vuelve a escribir.
  const itemsPorRef = yaEscritasItems ? new Map() : null;
  if (itemsPorRef) {
    const refDeReq = new Map(reqsEscritas.map(r => [r.id, String(r.origen_ref)]));
    for (const it of vivos(yaEscritasItems)) {
      const ref = refDeReq.get(it.requisicion_id);
      const cod = it.insumo_codigo && String(it.insumo_codigo).trim();
      if (!ref || !cod) continue;
      const set = itemsPorRef.get(ref) || new Set();
      set.add(`${cod}|${r4(it.cantidad)}`);
      itemsPorRef.set(ref, set);
    }
  }
  const yaEscrita = (ref, l) => {
    if (!refsEscritas.has(ref)) return false;
    const cod = l.insumo_codigo && String(l.insumo_codigo).trim();
    if (!itemsPorRef || !cod) return true;
    return !!itemsPorRef.get(ref)?.has(`${cod}|${r4(l.cantidad)}`);
  };

  // ── agrupar por propuesta, conservando el orden en que vinieron ──
  const grupos = new Map();
  for (const l of (lineas || [])) {
    const sub = String(l?.subcategoria || '');
    const tipoInsumo = tipoInsumoDeSubcategoria(sub);
    if (!tipoInsumo) {
      // Mano de obra, o una subcategoría que nadie enseñó a traducir. No se
      // adivina el valor más parecido: el CHECK del servidor la rebotaría, y
      // una requisición de planilla no existe como concepto (§5).
      omitidas.push({ linea: l, motivo: sub === 'mano_obra' ? 'mano_obra_no_se_requisa' : 'subcategoria_desconocida' });
      continue;
    }
    if (num(l.cantidad) <= 0) {
      omitidas.push({ linea: l, motivo: 'sin_cantidad' });
      continue;
    }
    const ref = String(l.propuesta_id || '');
    if (!ref) { omitidas.push({ linea: l, motivo: 'sin_propuesta' }); continue; }
    if (yaEscrita(ref, l)) { duplicadas.push(l); continue; }
    const g = grupos.get(ref) || {
      ref, lineas: [], periodo: l.periodo || null,
      // Desde la 2.3 una orden puede entregar en varios períodos: el título
      // nombra la ventana entera («octubre a diciembre 2026»), no solo el
      // mes en que se emite.
      etiquetaPeriodo: l.etiquetaVentana || l.etiquetaPeriodo || '',
    };
    g.lineas.push({ ...l, tipoInsumo });
    grupos.set(ref, g);
  }

  const requisiciones = [];
  let montoTotal = 0, itemsTotal = 0;

  for (const g of grupos.values()) {
    const reqId = nuevoId();
    const esSobre = String(g.lineas[0].origen || '') === 'simulador_sobre';
    // La partida solo se anota si TODA la requisición es de la misma: el
    // campo es uno solo y «Materiales — octubre» junta 167 insumos de decenas
    // de partidas. Poner la de la primera línea sería una media verdad que
    // después alguien lee como la verdad entera.
    const partidas = new Set(g.lineas.flatMap(l => (l.partidas || [])));
    const monto = r2(g.lineas.reduce((s, l) => s + num(l.monto), 0));
    montoTotal += monto;
    itemsTotal += g.lineas.length;

    const requisicion = {
      id: reqId,
      obra_id: obraId,
      codigo: null,
      fecha,
      fecha_necesidad: fechaNecesidadDePeriodo(g.periodo),
      fecha_requerida: fechaNecesidadDePeriodo(g.periodo),
      partida_id: partidas.size === 1 ? [...partidas][0] : null,
      prioridad: 'normal',
      estado: 'borrador',
      descripcion: tituloDeGrupo(g, esSobre),
      notas: notaDeOrigen(g, escenario, monto),
      razon: escenario?.nombre ? `Simulador — escenario «${escenario.nombre}»` : 'Simulador de órdenes',
      solicitante_id: solicitante?.id || null,
      solicitante_nombre: solicitante?.nombre || null,
      origen: esSobre ? 'simulador_sobre' : 'simulador',
      origen_ref: g.ref,
    };

    const items = g.lineas.map(l => ({
      id: nuevoId(),
      requisicion_id: reqId,
      material_id: null,
      insumo_id: null,
      insumo_pendiente_id: null,
      // La llave del PRESUPUESTO, que es contra la que se descuenta. Puede
      // faltar —buena parte del expediente no la trae— y entonces queda NULL
      // y la línea sale por `sinImputar` en la corrida siguiente.
      insumo_codigo: l.insumo_codigo || null,
      tipo_insumo: l.tipoInsumo,
      nombre: l.descripcion || '',
      nombre_libre: l.descripcion || '',
      descripcion: l.descripcion || '',
      unidad: l.unidad || null,
      cantidad: r4(l.cantidad),
      precio_estimado: l.precio_unitario != null ? r4(l.precio_unitario) : null,
      // `requisicion_items` no tiene una fecha por línea, y agregar una tabla
      // de entregas para esto sería el esquema nuevo que el §7 pide no crear.
      // El cronograma viaja en la observación, con un formato que este mismo
      // archivo sabe volver a leer (`periodosDeEntregas`).
      observacion: [textoDeEntregas(l), l.nota].filter(Boolean).join(' · ') || null,
      notas: l.proveedor_nombre ? `Proveedor sugerido: ${l.proveedor_nombre}` : null,
      ...conFactor(l.factor),
    }));

    requisiciones.push({ requisicion, items });
  }

  return {
    requisiciones,
    omitidas,
    duplicadas,
    resumen: {
      requisiciones: requisiciones.length,
      items: itemsTotal,
      monto: r2(montoTotal),
      omitidas: omitidas.length,
      duplicadas: duplicadas.length,
    },
  };
}

// ── LAS ENTREGAS (tanda 2.3) ──────────────────────────────────────
// Una orden consolidada se emite una vez y se entrega por partes. La
// requisición dice cuánto va en cada período en la observación de cada línea;
// la orden lo resume en `fecha_entrega_ref`, que ya existe para eso («Según
// necesidad en campo», mig 179). Escritor y lector viven acá, juntos, para
// que el formato no se desincronice.

export const PREFIJO_ENTREGAS = 'Entregas —';
export const ENTREGAS_A_COORDINAR = 'Entregas a coordinar: la cantidad se corrigió a mano';

/**
 * «Entregas — octubre 2026: 10; noviembre 2026: 12 (bol)». Null con una sola
 * entrega: una línea que llega toda junta no necesita cronograma.
 */
export function textoDeEntregas(l) {
  if (l?.entregas === null && (l?.periodos || []).length > 1) return ENTREGAS_A_COORDINAR;
  const es = Array.isArray(l?.entregas) ? l.entregas.filter(e => num(e.cantidad) > 0) : [];
  if (es.length <= 1) return null;
  const partes = es.map(e => `${e.etiquetaPeriodo || e.periodo}: ${r4(e.cantidad)}`);
  return `${PREFIJO_ENTREGAS} ${partes.join('; ')}${l.unidad ? ` (${l.unidad})` : ''}`;
}

/** Los períodos que nombra una observación escrita por `textoDeEntregas`. */
export function periodosDeEntregas(observacion) {
  const t = String(observacion || '');
  const i = t.indexOf(PREFIJO_ENTREGAS);
  if (i < 0) return [];
  const cuerpo = t.slice(i + PREFIJO_ENTREGAS.length).split(' · ')[0].replace(/\s*\([^)]*\)\s*$/, '');
  return cuerpo.split(';').map(s => s.split(':')[0].trim()).filter(Boolean);
}

/**
 * Cómo se entrega la orden entera, para `ordenes_compra.fecha_entrega_ref`.
 * Null si todo llega de una vez: la fecha de entrega de la cabecera ya lo dice.
 */
export function referenciaDeEntregas(items = []) {
  const periodos = [];
  let aCoordinar = false;
  for (const it of vivos(items)) {
    const obs = String(it.observacion || '');
    if (obs.includes(ENTREGAS_A_COORDINAR)) aCoordinar = true;
    for (const p of periodosDeEntregas(obs)) if (!periodos.includes(p)) periodos.push(p);
  }
  if (periodos.length > 1) return `Entregas parciales: ${periodos.join(', ')} (cantidades por línea en la requisición)`;
  if (aCoordinar) return 'Entregas parciales a coordinar con obra';
  return null;
}

function tituloDeGrupo(g, esSobre) {
  const etiqueta = g.etiquetaPeriodo || g.periodo || '';
  if (esSobre) {
    const nombre = String(g.lineas[0]?.sobre || '').split('|')[0].trim();
    const cabeza = nombre ? `Sobre «${nombre}»` : 'Sobre';
    return etiqueta ? `${cabeza} — ${etiqueta}` : cabeza;
  }
  return etiqueta ? `Plan de obra — ${etiqueta}` : 'Plan de obra';
}

function notaDeOrigen(g, escenario, monto) {
  const plata = monto.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const partes = [
    'Generada por el simulador de órdenes a partir del presupuesto del trabajo.',
    `Propuesta: ${g.ref}.`,
    `${g.lineas.length} línea(s) por S/ ${plata}.`,
  ];
  if (escenario?.nombre) partes.push(`Escenario «${escenario.nombre}».`);
  partes.push('Los precios son los del expediente, no una cotización.');
  return partes.join(' ');
}

export const MOTIVO_OMITIDA_LABEL = {
  mano_obra_no_se_requisa: 'La mano de obra no se pide con una requisición: va por planilla.',
  subcategoria_desconocida: 'No se sabe a qué tipo de insumo corresponde.',
  sin_cantidad: 'La línea no tiene cantidad.',
  sin_propuesta: 'La línea no dice de qué orden propuesta salió.',
};

// ═══════════════════════════════════════════════════════════════════
// LO YA REQUISADO (§7 — nada se pide dos veces)
// ═══════════════════════════════════════════════════════════════════

/** Una requisición que ya no reserva nada: se canceló o se rechazó. */
const REQUISICION_MUERTA = new Set(['cancelada', 'rechazada']);

// El DESCUENTO de lo ya requisado NO vive acá: vive en `coberturaPrevia()`,
// en `simulador-ordenes.js`, junto al de las órdenes. Son la misma pregunta
// («qué parte de esta línea ya está reservada») con las mismas dos reglas
// —la muerta no reserva, la que ya es orden no se cuenta dos veces—, y
// tenerlas en dos archivos es cómo se desincronizan. La pantalla le pasa
// `requisiciones` y `requisicionItems` directo al motor.

/**
 * Cuánto se lleva gastado de cada sobre (§4.1), para que el motor deje de
 * decir que el techo está intacto.
 *
 * La tanda 1 dejó `consumido` en `null` a propósito mientras nadie lo
 * informara — «creer un sobre intacto cuando ya se gastó la mitad es el mismo
 * doble gasto que el §7 viene a evitar». Esto es quien lo informa: la suma de
 * lo requisado contra ese sobre.
 *
 * @returns {Object} clave del sobre → monto ya comprometido.
 */
export function consumoDeSobres({ requisiciones = [], requisicionItems = [] } = {}) {
  const porReq = new Map();
  for (const r of vivos(requisiciones)) {
    if (REQUISICION_MUERTA.has(String(r.estado || ''))) continue;
    if (String(r.origen || '') !== 'simulador_sobre') continue;
    // `origen_ref` de un sobre es `sobre:<clave>` — lo arma `lineasAceptadas()`.
    const ref = String(r.origen_ref || '');
    if (!ref.startsWith('sobre:')) continue;
    porReq.set(r.id, ref.slice('sobre:'.length));
  }
  const out = {};
  for (const it of vivos(requisicionItems)) {
    const clave = porReq.get(it.requisicion_id);
    if (!clave) continue;
    const monto = num(it.cantidad_aprobada != null ? it.cantidad_aprobada : it.cantidad) * num(it.precio_estimado);
    out[clave] = r2((out[clave] || 0) + monto);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// REQUISICIÓN → ORDEN (§7 — solo la emite la ejecutora)
// ═══════════════════════════════════════════════════════════════════

export const MOTIVO_NO_EMITE_LABEL = {
  sin_obra: 'No hay trabajo elegido.',
  sin_ejecutora: 'Este trabajo no tiene una entidad ejecutora declarada. Cargala en Consorcios antes de emitir.',
  no_es_ejecutora: 'Las órdenes de este trabajo solo las puede emitir su entidad ejecutora.',
  sin_lineas: 'La requisición no tiene ninguna línea con cantidad y precio.',
  sin_proveedor: 'Falta elegir a quién se le emite la orden.',
  ya_ordenada: 'Esta requisición ya se convirtió en una orden.',
};

/**
 * ¿Puede ESTA empresa emitir la orden de ESTE trabajo?
 *
 * Restricción dura del §7, confirmada por Gabriel: en Miraflores únicamente
 * CONSORCIO EL INCA. No es una advertencia de pantalla — es la regla que
 * decide si se escribe la fila, y por eso vive en una función pura que se
 * puede testear y no en un `if` adentro de un onClick.
 *
 * @returns {{ok:boolean, ejecutoraId:string|null, motivo:string|null}}
 */
export function puedeEmitirOrden({ obra = null, consorcios = [], companyId = null } = {}) {
  if (!obra) return { ok: false, ejecutoraId: null, motivo: 'sin_obra' };
  const ejecutoraId = titularContableDeObra(obra, consorcios || []);
  if (!ejecutoraId) return { ok: false, ejecutoraId: null, motivo: 'sin_ejecutora' };
  // Sin empresa pedida, la respuesta es «sí, la ejecutora»: la pantalla no
  // tiene que elegirla, la hereda del trabajo.
  if (!companyId) return { ok: true, ejecutoraId, motivo: null };
  if (companyId !== ejecutoraId) return { ok: false, ejecutoraId, motivo: 'no_es_ejecutora' };
  return { ok: true, ejecutoraId, motivo: null };
}

/**
 * El borrador de orden que corresponde a una requisición del simulador.
 *
 * Reusa `ordenes.js` entero: el correlativo por empresa/tipo/año, el prefijo
 * de documento y los totales con IGV salen de ahí. Acá solo se arma el cuerpo.
 *
 * Los totales van por `totalesDesdeItems`: esta orden NACE de un plan, no
 * respalda un comprobante que ya existe, así que el valor de venta se suma de
 * las líneas y el IGV se agrega arriba. (`totalesDesdeTotal` es para el otro
 * caso, el retroactivo — ver el encabezado de `ordenes.js`.)
 *
 * @returns {{ok:boolean, motivo:string|null, orden:Object|null, items:Array}}
 */
export function borradorDeOrdenDesdeRequisicion({
  requisicion = null,
  items = [],
  obra = null,
  consorcios = [],
  company = null,
  proveedor = null,
  ordenes = [],
  igvPct = 18,
  hoy = null,
  nuevoId = idPorDefecto,
} = {}) {
  if (!requisicion) return { ok: false, motivo: 'sin_lineas', orden: null, items: [] };
  if (requisicion.oc_id) return { ok: false, motivo: 'ya_ordenada', orden: null, items: [] };

  const permiso = puedeEmitirOrden({ obra, consorcios, companyId: company?.id || null });
  if (!permiso.ok) return { ok: false, motivo: permiso.motivo, orden: null, items: [] };
  if (!proveedor || (!proveedor.id && !String(proveedor.nombre || '').trim())) {
    return { ok: false, motivo: 'sin_proveedor', orden: null, items: [] };
  }

  const usables = vivos(items).filter(it => num(it.cantidad) > 0 && num(it.precio_estimado) > 0);
  if (!usables.length) return { ok: false, motivo: 'sin_lineas', orden: null, items: [] };

  // El tipo de documento lo decide lo que se está pidiendo. Una requisición
  // mezclada (un alquiler entre materiales) no puede existir: el simulador
  // agrupa por subcategoría, así que todas sus líneas son del mismo tipo.
  const tipo = usables.every(it => it.tipo_insumo === 'servicio') ? 'servicio' : 'compra';
  const T = textosDeTipo(tipo);

  const fecha = hoy || requisicion.fecha || hoyLocal();
  const anio = Number(String(fecha).slice(0, 4)) || new Date().getFullYear();
  const { correlativo, codigo } = proximoCodigo(ordenes, { company, tipo, anio });

  const lineas = usables.map(it => ({
    cantidad: num(it.cantidad),
    precio_unitario: num(it.precio_estimado),
    subtotal: r2(num(it.cantidad) * num(it.precio_estimado)),
  }));
  const totales = totalesDesdeItems(lineas, { igvPct });

  const ordenId = nuevoId();
  const orden = {
    id: ordenId,
    codigo, correlativo, anio,
    tipo,
    company_id: permiso.ejecutoraId,
    obra_id: requisicion.obra_id || obra?.id || null,
    trabajo_id: obra?.id || null,
    requisicion_id: requisicion.id,
    requisicion_codigo: requisicion.codigo || null,
    proveedor_id: proveedor.id || null,
    proveedor_nombre: proveedor.nombre || null,
    proveedor_ruc: proveedor.ruc || null,
    proveedor_direccion: proveedor.direccion || null,
    fecha,
    fecha_entrega: requisicion.fecha_necesidad || null,
    // Una orden consolidada (tanda 2.3) se entrega por partes: la cabecera
    // lo dice, y el detalle por línea queda en la requisición.
    ...(referenciaDeEntregas(usables) ? { fecha_entrega_ref: referenciaDeEntregas(usables) } : {}),
    moneda: 'PEN',
    // Nace en BORRADOR, no en 'recibida': lo que se pide todavía no llegó.
    // Las órdenes retroactivas de `jx-ordenes` nacen recibidas porque
    // respaldan algo que ya pasó; ésta es lo contrario.
    estado: 'borrador',
    titulo: requisicion.descripcion || T.titulo,
    obra_descripcion: obra?.nombre_obra || obra?.nombre || null,
    igv_pct: num(igvPct),
    monto_subtotal: totales.valorVenta,
    monto_igv: totales.igv,
    monto_total: totales.total,
    emitida_retroactiva: false,
    observaciones: `Del plan del simulador · requisición ${requisicion.origen_ref || requisicion.id}. Precios del expediente, sujetos a cotización.`,
  };

  const ocItems = usables.map(it => {
    const cantidad = num(it.cantidad);
    const precio = num(it.precio_estimado);
    return {
      id: nuevoId(),
      orden_compra_id: ordenId,
      // El otro lado del puente que ya existía y nadie usaba. Sin esto la
      // requisición y su orden quedan sueltas y no se puede saber qué línea
      // del plan cubrió qué.
      requisicion_item_id: it.id,
      tipo_insumo: it.tipo_insumo || (tipo === 'servicio' ? 'servicio' : 'material'),
      material_id: null, insumo_id: null, insumo_pendiente_id: null,
      // Acá sí viaja el código: es lo que deja que `coberturaPrevia()`
      // descuente esta orden en la corrida siguiente. Las 62 líneas de las
      // órdenes retroactivas de Miraflores no lo tienen y por eso no se
      // pueden descontar (salen por `resumen.ocSinImputar`).
      insumo_codigo: it.insumo_codigo || null,
      proveedor_company_id: null,
      nombre: it.nombre || it.nombre_libre || '',
      nombre_libre: it.nombre || it.nombre_libre || '',
      unidad: it.unidad || T.unidadPorDefecto,
      cantidad,
      cantidad_recibida: 0,
      precio_unitario: r4(precio),
      subtotal: r2(cantidad * precio),
      // La orden hereda el factor de su requisición: una vez emitida, es ella
      // la que descuenta en `coberturaPrevia()`, y en la misma unidad.
      ...conFactor(it.factor_presupuesto),
    };
  });

  return { ok: true, motivo: null, orden, items: ocItems };
}

/**
 * Los campos con los que se cierra la requisición cuando su orden se emitió.
 * Es el otro sentido del puente (`requisiciones.oc_id` / `oc_codigo`), el que
 * hace que el plan deje de proponer lo que ya es un documento.
 */
export function cierreDeRequisicion(orden) {
  return {
    oc_id: orden?.id || null,
    oc_codigo: orden?.codigo || null,
    estado: 'ordenada',
  };
}

// ═══════════════════════════════════════════════════════════════════
// LO QUE EL PLAN YA ESCRIBIÓ, PARA MOSTRARLO
// ═══════════════════════════════════════════════════════════════════

/**
 * El estado de cada propuesta del plan respecto de lo ya escrito: si ya tiene
 * requisición, si esa requisición ya es una orden, y por cuánto.
 *
 * La pantalla lo necesita para no ofrecer «convertir» una tarjeta que ya es
 * un documento: aceptar dos veces la misma propuesta es exactamente el doble
 * pedido que el §7 viene a evitar.
 *
 * @returns {Map<string, {requisicion:Object, items:Array, monto:number, ordenada:boolean}>}
 */
export function estadoDelPlan({ requisiciones = [], requisicionItems = [] } = {}) {
  const porRef = new Map();
  const itemsPorReq = new Map();
  for (const it of vivos(requisicionItems)) {
    const arr = itemsPorReq.get(it.requisicion_id) || [];
    arr.push(it);
    itemsPorReq.set(it.requisicion_id, arr);
  }
  for (const r of vivos(requisiciones)) {
    if (!esDelSimulador(r) || !r.origen_ref) continue;
    if (REQUISICION_MUERTA.has(String(r.estado || ''))) continue;
    const items = itemsPorReq.get(r.id) || [];
    const monto = r2(items.reduce((s, it) => s + num(it.cantidad) * num(it.precio_estimado), 0));
    porRef.set(String(r.origen_ref), { requisicion: r, items, monto, ordenada: !!r.oc_id });
  }
  return porRef;
}
