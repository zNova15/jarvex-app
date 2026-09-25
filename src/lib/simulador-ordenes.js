// ═══════════════════════════════════════════════════════════════════
// JARVEX — SIMULADOR DE ÓRDENES POR PRESUPUESTO (tanda 1: el motor)
//
// Diseño completo en `docs/plan-simulador-ordenes.md`. Este archivo es el
// §10/tanda 1: el motor PURO de reparto. Sin React, sin Dexie, sin IA.
//
// ── QUÉ PREGUNTA CONTESTA ─────────────────────────────────────────
// `abastecimiento.js` ya dice CUÁNTO falta de cada insumo. Lo que faltaba es
// CUÁNDO conviene pedirlo. Este motor toma el presupuesto de un trabajo
// (`insumos_partida`) y el cronograma de sus partidas, y devuelve propuestas
// de orden agrupadas por período (mes o semana) y por tipo de cosa —
// «EPPs — primera dotación», «Servicios y alquileres — octubre 2026».
//
// Es un SIMULADOR de escenarios: cada corrida se define por cuatro ejes
// (§3.1-§3.4 del plan) y no pisa nada. Nada de lo que devuelve es un
// documento: convertirlo en requisición/orden real es la tanda 4.
//
// ── LOS NÚMEROS QUE LO GOBIERNAN (Miraflores, medido el 22-set-2026) ──
//   1.718 partidas · 6.722 líneas de presupuesto · S/ 9.590.291
//   Mano de obra   S/ 4.474.595 (47%) → NO se compra: sale por `manoObra`
//   Comprable real S/ 4.977.696        → es contra ESTO que va la cobertura
//
//   6.325 de las 6.722 líneas viven en partidas de menos de 30 días: el
//   cronograma las fecha con precisión de semana y no hace falta repartir.
//   Las otras 397 (S/ 3,16 M comprables) están en tramos largos — y ahí el
//   reparto NO es un detalle de EPPs: la tubería PVC de una partida de 73
//   días son S/ 450.839 en una sola línea. Poner todo eso en el mes de
//   inicio o repartirlo en tres cambia el flujo de caja de la obra.
//
// ── LA REGLA QUE MÁS IMPORTA: NADA SE PIDE DOS VECES ──────────────
// Si una línea ya se compró o ya está en una orden viva, los períodos
// siguientes tienen que restarla. Pero el descuento solo se puede hacer por
// `insumo_codigo`, y las 62 líneas de las 14 órdenes ya emitidas en
// Miraflores tienen **`insumo_codigo` NULL en el 100%** (medido el
// 22-set-2026): son órdenes retroactivas que respaldan facturas ya pagadas.
//
// Frente a eso el motor NO asume cero. Cuenta esas líneas aparte, en
// `resumen.ocSinImputar`, para que la pantalla diga «hay 62 líneas ya
// ordenadas que no se pueden descontar porque no tienen código de insumo».
// Es el mismo cero silencioso que ya evita `abastecimiento.js`: un cero
// callado acá se traduce en comprar dos veces.
//
// ── DESDE LA RONDA 2 (tanda 2.2): SE PIDE EN LO QUE SE COMPRA ─────
// Las líneas salen en unidades de COMPRA (tubos, piezas) y en enteros,
// redondeadas acumulado por insumo (pasos 1b y 3b, `simulador-compra.js`).
// Lo del expediente viaja al lado (`necesidad`, `unidadExpediente`,
// `factor`) y el descuento de lo ya pedido sigue siendo en la unidad del
// expediente, gracias a `factor_presupuesto` (mig 228).
//
// Testeado en __tests__/simulador-ordenes.test.js
// ═══════════════════════════════════════════════════════════════════

import {
  clasificarInsumoDePresupuesto, CATEGORIAS_SIMULADOR,
  SUBCATEGORIA_LABEL, normUnidad,
} from './insumo-clasificador.js';
import {
  clasificarConIUPC, etiquetaCategoria, tipoDeCategoria,
  rubroDeCompra, RUBRO_COMPRA_POR_ID, ordenDeRubro,
} from './indices-unificados-iupc.js';
import { hoyLocal } from './fecha.js';
import { resolverCompra, cantidadesDeCompra } from './simulador-compra.js';
import { consolidarOrdenes, FRECUENCIA_DEFAULT } from './simulador-consolidacion.js';

/**
 * La clasificación IUPC de un sobre. Se pasa por `clasificarConIUPC` con el
 * diccionario propio, que es la capa que corrige la norma — con una salvedad
 * que NO es de acá sino del clasificador: un nombre que coincide EXACTO con
 * el Anexo 2 o con el árbol de servicios (capa `oficial-exacto`) no se pisa
 * ni con un término propio.
 *
 * Devuelve SIEMPRE un objeto — cuando el clasificador no reconoce el nombre,
 * el código es `sin_clasificar` y la banda lo dice. No se inventa un código
 * plausible: una fila que dice «no sé» se filtra y se resuelve; una con un
 * código inventado se pierde entre las buenas.
 */
function clasificacionDe(nombre, terminosCustom) {
  const rec = clasificarConIUPC(nombre || '', { terminosCustom });
  return {
    codigo: rec.codigo,
    etiqueta: etiquetaCategoria(rec.codigo),
    tipo: tipoDeCategoria(rec.codigo),
    banda: rec.banda,
    score: r2(rec.score),
  };
}

const vivos = (arr) => (Array.isArray(arr) ? arr.filter(x => x && !x.deleted_at) : []);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;
const r4 = (n) => Math.round((num(n) + Number.EPSILON) * 10000) / 10000;
const p2 = (n) => String(n).padStart(2, '0');

// ── LOS CUATRO EJES DE UNA CORRIDA (§3 del plan) ──────────────────

/** §3.1 — desde dónde se planifica. */
export const ANCLAJES = ['hoy', 'restante', 'cero'];
export const ANCLAJE_LABEL = {
  // Lo atrasado no desaparece: se arrastra al período actual, porque en el
  // pasado ya no se puede emitir una orden. Es el caso «regularizando».
  hoy: 'Desde hoy (arrastra lo atrasado al período actual)',
  // Los períodos vencidos se descartan. Se informa cuánto se descartó.
  restante: 'Solo los períodos que faltan',
  // Reconstruye el plan desde el inicio del expediente, sin restar nada de
  // lo ya comprado. Sirve para auditar qué DEBIÓ comprarse, no para emitir.
  cero: 'Asumiendo cero órdenes previas (auditoría)',
};

/** §3.2 — de dónde salen las fechas. */
export const CRONOGRAMAS = ['gantt', 'reprogramado', 'sin_cronograma'];
export const CRONOGRAMA_LABEL = {
  gantt: 'Gantt del expediente',
  reprogramado: 'Reprogramado a mano',
  sin_cronograma: 'Sin cronograma (parejo en todo el plazo)',
};

/** §3.3 — cómo se reparte un insumo de tramo largo. */
export const REPARTOS = ['parejo', 'inicio', 'escenario', 'cuadrilla', 'manual'];
export const REPARTO_LABEL = {
  parejo: 'Parejo entre los períodos del tramo',
  inicio: 'Todo al inicio del tramo',
  // Ronda 3, tanda 3.3: lo que avanza la obra en cada período según el
  // cronograma del escenario (por días con el Gantt; con una historia, un mes
  // de frenazo lleva menos). El dato lo arma `repartoSegunEscenario()` de
  // simulador-cronograma.js y llega por `repartoManual`.
  escenario: 'Según el escenario (lo que avanza la obra cada mes)',
  cuadrilla: 'Por cuadrilla que entra',
  manual: 'Manual, partida por partida',
};

export const GRANULARIDADES = ['mes', 'semana'];

/**
 * Debajo de esto el cronograma ya fecha el insumo con precisión de semana y
 * no hay nada que repartir. 30 días deja 6.325 de las 6.722 líneas de
 * Miraflores del lado simple.
 */
export const UMBRAL_TRAMO_LARGO_DIAS = 30;

export { CATEGORIAS_SIMULADOR };

// ═══════════════════════════════════════════════════════════════════
// PERÍODOS
//
// Todo el cálculo de fechas pasa por Date.UTC y NUNCA por `new Date('...')`
// de una fecha suelta: en Perú (UTC−5) eso devuelve el día anterior. Es el
// mismo bug que `fecha.js` documenta para el Libro Diario.
// ═══════════════════════════════════════════════════════════════════

const DIA_MS = 86400000;

const aUTC = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
};
const deUTC = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
};

/** Suma días a 'YYYY-MM-DD' sin tocar la zona horaria local. */
export function sumarDias(ymd, dias) {
  const ms = aUTC(ymd);
  return ms == null ? '' : deUTC(ms + num(dias) * DIA_MS);
}

/** Días calendario entre dos 'YYYY-MM-DD' (b − a). Null si falta alguna. */
export function diasEntre(a, b) {
  const x = aUTC(a), y = aUTC(b);
  return (x == null || y == null) ? null : Math.round((y - x) / DIA_MS);
}

/** Semana ISO de una fecha como 'YYYY-Www' (el año es el año-semana ISO). */
export function semanaISO(ymd) {
  const ms = aUTC(ymd);
  if (ms == null) return '';
  const dow = (new Date(ms).getUTCDay() + 6) % 7;        // lunes = 0
  const jueves = ms + (3 - dow) * DIA_MS;                // el jueves manda el año ISO
  const anio = new Date(jueves).getUTCFullYear();
  const ene4 = Date.UTC(anio, 0, 4);
  const dowEne4 = (new Date(ene4).getUTCDay() + 6) % 7;
  const lunesSemana1 = ene4 - dowEne4 * DIA_MS;
  const n = Math.round((jueves - lunesSemana1) / (7 * DIA_MS)) + 1;
  return `${anio}-W${p2(n)}`;
}

/** El período al que cae una fecha: 'YYYY-MM' o 'YYYY-Www'. */
export function periodoDe(ymd, granularidad = 'mes') {
  if (!ymd) return '';
  return granularidad === 'semana' ? semanaISO(ymd) : String(ymd).slice(0, 7);
}

/**
 * Todos los períodos que toca el tramo [desde, hasta], en orden.
 * Si `hasta` es anterior a `desde` devuelve solo el de `desde`: un tramo
 * invertido es un dato malo del expediente, no una razón para no planificar.
 */
export function periodosEntre(desde, hasta, granularidad = 'mes') {
  const a = aUTC(desde);
  if (a == null) return [];
  const b = aUTC(hasta);
  const fin = (b == null || b < a) ? a : b;
  const out = [];
  if (granularidad === 'semana') {
    const lunes = (ms) => ms - ((new Date(ms).getUTCDay() + 6) % 7) * DIA_MS;
    for (let ms = lunes(a); ms <= lunes(fin); ms += 7 * DIA_MS) out.push(semanaISO(deUTC(ms)));
    return out;
  }
  const d = new Date(a);
  let y = d.getUTCFullYear(), m = d.getUTCMonth();
  const df = new Date(fin);
  const yf = df.getUTCFullYear(), mf = df.getUTCMonth();
  while (y < yf || (y === yf && m <= mf)) {
    out.push(`${y}-${p2(m + 1)}`);
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return out;
}

/** Primer y último día de un período 'YYYY-MM' o 'YYYY-Www'. */
export function rangoDePeriodo(periodo) {
  const p = String(periodo || '');
  const mes = /^(\d{4})-(\d{2})$/.exec(p);
  if (mes) {
    const y = +mes[1], m = +mes[2];
    if (m < 1 || m > 12) return null;
    return { inicio: `${y}-${p2(m)}-01`, fin: deUTC(Date.UTC(y, m, 1) - DIA_MS) };
  }
  const sem = /^(\d{4})-W(\d{2})$/.exec(p);
  if (sem) {
    const anio = +sem[1], n = +sem[2];
    const ene4 = Date.UTC(anio, 0, 4);
    const lunesS1 = ene4 - ((new Date(ene4).getUTCDay() + 6) % 7) * DIA_MS;
    const lunes = lunesS1 + (n - 1) * 7 * DIA_MS;
    return { inicio: deUTC(lunes), fin: deUTC(lunes + 6 * DIA_MS) };
  }
  return null;
}

/**
 * El mes calendario al que pertenece un período. Una semana cae en el mes de
 * su JUEVES, igual que el año de la semana ISO: la semana del lunes 28-set al
 * domingo 4-oct tiene cuatro días en octubre y es de octubre.
 */
export function mesDePeriodo(periodo) {
  const p = String(periodo || '');
  if (/^\d{4}-\d{2}$/.test(p)) return p;
  const r = rangoDePeriodo(p);
  return r ? sumarDias(r.inicio, 3).slice(0, 7) : '';
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];

/** '2026-10' → 'octubre 2026' · '2026-W41' → 'semana 41 de 2026'. */
export function etiquetaPeriodo(periodo) {
  const p = String(periodo || '');
  const sem = /^(\d{4})-W(\d{2})$/.exec(p);
  if (sem) return `semana ${+sem[2]} de ${sem[1]}`;
  const mes = /^(\d{4})-(\d{2})$/.exec(p);
  if (mes) return `${MESES[+mes[2] - 1] || mes[2]} ${mes[1]}`;
  return p;
}

// ═══════════════════════════════════════════════════════════════════
// EL TRAMO DE UNA LÍNEA
// ═══════════════════════════════════════════════════════════════════

/**
 * De dónde salen las fechas de una línea, según el eje §3.2.
 *
 * `reprogramado` cae de vuelta al Gantt para las partidas que Gabriel NO
 * movió: mover 1.718 partidas a mano para simular una no es un flujo real.
 */
function tramoDeLinea(partida, { cronograma, reprogramacion, plazo }) {
  if (cronograma === 'sin_cronograma') {
    if (!plazo?.inicio) return { error: 'sin_plazo' };
    return { inicio: plazo.inicio, fin: plazo.fin || plazo.inicio, fuente: 'plazo' };
  }
  if (cronograma === 'reprogramado' && partida) {
    const re = reprogramacion?.[partida.id];
    if (re?.inicio) return { inicio: re.inicio, fin: re.fin || re.inicio, fuente: 'reprogramado' };
  }
  if (!partida) return { error: 'sin_partida' };
  const ini = partida.fecha_inicio_planificada;
  if (!ini) return { error: 'sin_fecha' };
  return { inicio: String(ini).slice(0, 10), fin: String(partida.fecha_fin_planificada || ini).slice(0, 10), fuente: 'gantt' };
}

/**
 * Cómo se reparte un tramo entre sus períodos.
 * @returns {{periodos:Array<{periodo:string,fraccion:number}>}|{error:string}}
 *
 * Dos estrategias pueden NO tener con qué contestar (`cuadrilla` sin la
 * dotación cargada, `manual` sin el reparto fijado). En ese caso devuelven
 * un error y la línea sale por `pendientes` — NUNCA por un «parejo» de
 * consuelo: repartir con una regla que nadie eligió es inventar un número.
 */
function repartirTramo(tramo, periodos, { reparto, cuadrillas, repartoManual, partidaId, granularidad }) {
  if (periodos.length <= 1) return { periodos: [{ periodo: periodos[0], fraccion: 1 }] };

  if (reparto === 'inicio') return { periodos: [{ periodo: periodos[0], fraccion: 1 }] };

  // 'escenario' usa el mismo dato que 'manual' —partida → {período: fracción}—
  // pero no lo carga nadie a mano: lo arma el cronograma del escenario para
  // TODAS las partidas fechadas. Si igual falta, la línea va a pendientes con
  // su propio motivo; nunca a un parejo de consuelo.
  if (reparto === 'manual' || reparto === 'escenario') {
    const fijado = repartoManual?.[partidaId];
    const entradas = Object.entries(fijado || {}).filter(([, f]) => num(f) > 0);
    if (!entradas.length) return { error: reparto === 'escenario' ? 'falta_reparto_escenario' : 'falta_reparto_manual' };
    const total = entradas.reduce((s, [, f]) => s + num(f), 0);
    return { periodos: entradas.map(([periodo, f]) => ({ periodo, fraccion: num(f) / total })) };
  }

  if (reparto === 'cuadrilla') {
    // Cada ingreso de gente pesa por su cantidad de personas y aterriza en
    // el período de su fecha, recortada al tramo (nadie compra antes de que
    // la partida arranque). El dato lo carga la pantalla: hoy no existe en
    // ninguna tabla.
    const dentro = [];
    for (const c of (cuadrillas || [])) {
      const personas = num(c?.personas);
      if (personas <= 0 || !c?.fecha) continue;
      const f = String(c.fecha).slice(0, 10);
      if (aUTC(f) > aUTC(tramo.fin)) continue;
      const efectiva = aUTC(f) < aUTC(tramo.inicio) ? tramo.inicio : f;
      const periodo = periodoDe(efectiva, granularidad);
      if (!periodos.includes(periodo)) continue;
      dentro.push({ periodo, personas });
    }
    if (!dentro.length) return { error: 'falta_cuadrillas' };
    const total = dentro.reduce((s, d) => s + d.personas, 0);
    const porPeriodo = new Map();
    for (const d of dentro) porPeriodo.set(d.periodo, (porPeriodo.get(d.periodo) || 0) + d.personas);
    return { periodos: [...porPeriodo].map(([periodo, personas]) => ({ periodo, fraccion: personas / total })) };
  }

  // 'parejo' — igual en cada período que toca el tramo. «Parejo mes a mes»
  // es literal: no se prorratea por días, porque un mes con 3 días de tramo
  // igual necesita su compra.
  const f = 1 / periodos.length;
  return { periodos: periodos.map(periodo => ({ periodo, fraccion: f })) };
}

// ═══════════════════════════════════════════════════════════════════
// LO YA CUBIERTO (§7 — nada se pide dos veces)
// ═══════════════════════════════════════════════════════════════════

/** Unidades del expediente que trae cada unidad pedida de un ítem (default 1). */
export const factorDeItem = (it) => {
  const f = Number(it?.factor_presupuesto);
  return Number.isFinite(f) && f > 0 ? f : 1;
};

/**
 * Cuánto de cada insumo ya está comprado o comprometido por una orden viva.
 *
 * Una orden ANULADA libera lo que reservaba. Una orden que ya tiene
 * comprobante vinculado no se cuenta acá si el caller pasó `yaComprado`:
 * esa cantidad ya viene por el lado de la factura y restarla dos veces
 * borraría material que sí hay que pedir. Es la misma regla de
 * `abastecimientoDeObra`.
 *
 * ── LAS REQUISICIONES TAMBIÉN RESERVAN (tanda 4) ─────────────────
 * Desde que el simulador escribe requisiciones (§7, `simulador-puente.js`),
 * una línea del plan deja de ser un plan en cuanto se convierte en fila: la
 * corrida siguiente tiene que restarla o va a proponer de nuevo, en
 * noviembre, todo lo que ya se requisó en octubre.
 *
 * Se cuenta con las mismas dos reglas que las órdenes, y por los mismos
 * motivos:
 *   · la requisición cancelada o rechazada NO reserva nada;
 *   · la que ya tiene `oc_id` tampoco se cuenta acá — su orden ya la cuenta
 *     el bloque de arriba, y restarla dos veces borraría material que sí hay
 *     que pedir.
 * Y la línea SIN código de insumo no se descuenta de nada: sale por
 * `reqSinImputar`, igual que las 62 líneas de las órdenes retroactivas de
 * Miraflores salen por `sinImputar`.
 *
 * ── LA CANTIDAD PEDIDA NO ESTÁ EN LA UNIDAD DEL PRESUPUESTO (tanda 2.2) ──
 * Desde la ronda 2 el plan pide en unidades de COMPRA: 28 tubos, no 164 m.
 * Restar «28» de los metros del presupuesto dejaría 136 m por pedir que ya
 * están pedidos. Por eso cada ítem escrito por el plan lleva
 * `factor_presupuesto` (mig 228) —cuántas unidades del expediente trae cada
 * unidad pedida— y el descuento se hace en unidades del expediente. Sin la
 * columna el factor es 1: todo lo escrito antes de la 2.2 ya estaba en la
 * unidad del expediente.
 *
 * ── EL ALMACÉN (ronda 2, tanda 2.5) ───────────────────────────────
 * En Miraflores lo comprado casi nunca pasó por una orden: el almacén
 * registró 3.140 bolsas de cemento entradas y las órdenes explican 2.250.
 * Cada ítem del almacén que alguien imputó a un insumo del presupuesto
 * (`imputacion='insumo'`, ver `simulador-imputacion.js`) resta según
 * `almacenModo`, decidido por Gabriel el 24-set como perilla del escenario:
 *   · 'entradas' — todo lo que ENTRÓ (default). Es lo coherente con este
 *     motor, que mira la necesidad desde el inicio de la obra: lo que entró y
 *     ya se gastó cubrió meses pasados, y no restarlo lo volvería a pedir.
 *   · 'stock'    — lo que HAY hoy. Vuelve a pedir lo que ya se consumió; la
 *     pantalla lo advierte.
 *   · 'nada'     — el almacén no resta.
 *   · 'personalizado' — insumo por insumo (`almacenPorInsumo`): entradas,
 *     stock, nada o una cantidad fija en unidades del presupuesto.
 *
 * Y **manda el almacén** (Gabriel, 24-set): en un insumo que el almacén ya
 * cubre, una orden RECIBIDA no se suma — lo que llegó ya está en las
 * entradas, y sumarla contaría el mismo cemento dos veces. La que todavía no
 * llegó sí se suma. Se decide por insumo y no por fila porque solo 21 de las
 * 716 entradas de Miraflores están atadas a una factura: emparejar orden con
 * entrada una por una no es posible.
 *
 * ── LO QUE NO ES UN INSUMO (tanda 2.5) ────────────────────────────
 * Una línea de orden imputada a un SOBRE (`imputacion='sobre'`, las
 * herramientas de OC-002 contra «HERRAMIENTAS MANUALES») no resta cantidad:
 * gasta plata del sobre, y sale por `consumoSobre` (código → monto). Una
 * imputada como FUERA del presupuesto (los estudios del documento de
 * trabajo) sale por `fueraPresupuesto` — ya no es «no se sabe», es «no
 * corresponde», y la pantalla lo dice distinto.
 *
 * @returns {{cubierto:Map<string,number>,
 *            sinImputar:{lineas:number, monto:number},
 *            reqSinImputar:{lineas:number, monto:number},
 *            consumoSobre:Map<string,number>,
 *            fueraPresupuesto:{lineas:number, monto:number},
 *            almacen:Object}}
 */
export function coberturaPrevia({
  ordenes = [], ocItems = [], yaComprado = null,
  requisiciones = [], requisicionItems = [],
  almacen = [], almacenModo = 'entradas', almacenPorInsumo = null,
} = {}) {
  const cubierto = new Map();
  const suma = (cod, cant) => cubierto.set(cod, (cubierto.get(cod) || 0) + num(cant));

  const previas = yaComprado instanceof Map ? [...yaComprado] : Object.entries(yaComprado || {});
  for (const [cod, cant] of previas) if (cod) suma(String(cod), cant);

  // ── lo que entró al almacén (tanda 2.5) ──────────────────────────
  const alm = aporteDelAlmacen(almacen, { modo: almacenModo, porInsumo: almacenPorInsumo });
  for (const [cod, cant] of alm.porCodigo) suma(cod, cant);

  const vivas = new Map();
  for (const o of vivos(ordenes)) {
    if (o.estado === 'anulada' || o.estado === 'cancelada') continue;
    // Con `yaComprado` en mano, la orden ya facturada se cuenta por la
    // factura. Sin él, es la única señal que hay y sí se cuenta.
    if (yaComprado && o.accounting_movement_id) continue;
    vivas.set(o.id, o);
  }

  const sinImputar = { lineas: 0, monto: 0 };
  const fueraPresupuesto = { lineas: 0, monto: 0 };
  const consumoSobre = new Map();
  const cubiertasPorAlmacen = { lineas: 0, monto: 0 };
  for (const it of vivos(ocItems)) {
    const orden = vivas.get(it.orden_compra_id);
    if (!orden) continue;
    const monto = num(it.subtotal) || num(it.cantidad) * num(it.precio_unitario);
    if (it.imputacion === 'fuera') {
      fueraPresupuesto.lineas += 1;
      fueraPresupuesto.monto += monto;
      continue;
    }
    const cod = it.insumo_codigo && String(it.insumo_codigo).trim();
    if (!cod) {
      // Sin código no se puede descontar de ninguna línea del presupuesto.
      // Se cuenta aparte y se dice: en Miraflores esto era el 100% (62/62)
      // hasta la tanda 2.5.
      sinImputar.lineas += 1;
      sinImputar.monto += monto;
      continue;
    }
    if (it.imputacion === 'sobre') {
      consumoSobre.set(cod, (consumoSobre.get(cod) || 0) + monto);
      continue;
    }
    // Manda el almacén: lo que ya llegó está en sus entradas.
    let cantidad = num(it.cantidad);
    if (alm.gobierna.has(cod)) {
      if (orden.estado === 'recibida') {
        cubiertasPorAlmacen.lineas += 1;
        cubiertasPorAlmacen.monto += monto;
        continue;
      }
      if (orden.estado === 'recibida_parcial') cantidad = Math.max(0, cantidad - num(it.cantidad_recibida));
    }
    suma(cod, cantidad * factorDeItem(it));
  }
  sinImputar.monto = r2(sinImputar.monto);
  fueraPresupuesto.monto = r2(fueraPresupuesto.monto);
  cubiertasPorAlmacen.monto = r2(cubiertasPorAlmacen.monto);
  for (const [k, v] of consumoSobre) consumoSobre.set(k, r2(v));

  // ── lo ya pedido por una requisición viva (tanda 4) ──────────────
  const reqVivas = new Set();
  for (const r of vivos(requisiciones)) {
    if (r.estado === 'cancelada' || r.estado === 'rechazada') continue;
    if (r.oc_id) continue;
    reqVivas.add(r.id);
  }
  const reqSinImputar = { lineas: 0, monto: 0 };
  for (const it of vivos(requisicionItems)) {
    if (!reqVivas.has(it.requisicion_id)) continue;
    // La cantidad APROBADA manda sobre la pedida cuando existe: si de 100
    // bolsas se aprobaron 60, lo reservado son 60 y las otras 40 siguen
    // haciendo falta.
    const cantidad = num(it.cantidad_aprobada != null ? it.cantidad_aprobada : it.cantidad);
    const cod = it.insumo_codigo && String(it.insumo_codigo).trim();
    if (!cod) {
      reqSinImputar.lineas += 1;
      reqSinImputar.monto += cantidad * num(it.precio_estimado);
      continue;
    }
    suma(cod, cantidad * factorDeItem(it));
  }
  reqSinImputar.monto = r2(reqSinImputar.monto);

  return {
    cubierto, sinImputar, reqSinImputar, consumoSobre, fueraPresupuesto,
    almacen: { ...alm.resumen, ordenesCubiertas: cubiertasPorAlmacen },
  };
}

/** Qué resta el almacén en cada modo (ver `coberturaPrevia`). */
export const ALMACEN_MODOS = ['entradas', 'stock', 'nada', 'personalizado'];
export const ALMACEN_MODO_LABEL = {
  entradas: 'Todo lo que entró',
  stock: 'Solo lo que hay hoy',
  nada: 'Nada',
  personalizado: 'Personalizado por insumo',
};
/** Lo que se puede elegir para UN insumo en el modo personalizado. */
export const ALMACEN_MODOS_INSUMO = ['entradas', 'stock', 'nada', 'cantidad'];

/**
 * Cuánto resta el almacén de cada código del presupuesto, en unidades del
 * presupuesto. Solo cuentan los ítems imputados a un insumo
 * (`imputacion='insumo'`): lo no imputado no se resta a ojo, se cuenta en
 * `resumen.sinImputar` para que la pantalla lo diga.
 *
 * `gobierna` son los códigos donde el almacén efectivamente aporta: en esos,
 * las órdenes recibidas ya están contadas por sus entradas.
 *
 * @param {Array} filas  salida de `existenciasDelAlmacen()` (simulador-imputacion.js)
 */
export function aporteDelAlmacen(filas = [], { modo = 'entradas', porInsumo = null } = {}) {
  const m = ALMACEN_MODOS.includes(modo) ? modo : 'entradas';
  const porCodigo = new Map();
  const gobierna = new Set();
  const resumen = {
    modo: m, items: 0, itemsImputados: 0, itemsFuera: 0, insumos: 0,
    sinImputar: { items: 0 },
  };
  const fijos = new Map();   // código → cantidad fija (personalizado)
  const modoDe = (cod) => {
    if (m !== 'personalizado') return m;
    const cfg = porInsumo && porInsumo[cod];
    const mi = cfg && ALMACEN_MODOS_INSUMO.includes(cfg.modo) ? cfg.modo : 'entradas';
    if (mi === 'cantidad') fijos.set(cod, Math.max(0, num(cfg.cantidad)));
    return mi;
  };
  for (const f of (filas || [])) {
    if (!f || f.deleted_at || f.es_grupo) continue;
    const entradas = num(f.entradas);
    const stock = num(f.stock);
    // Un ítem que nunca recibió nada no es algo que imputar.
    if (!(entradas > 0) && !(stock > 0)) continue;
    resumen.items += 1;
    if (f.imputacion === 'fuera') { resumen.itemsFuera += 1; continue; }
    const cod = f.imputacion === 'insumo' && f.insumo_codigo ? String(f.insumo_codigo).trim() : '';
    if (!cod) { resumen.sinImputar.items += 1; continue; }
    resumen.itemsImputados += 1;
    const mi = modoDe(cod);
    if (mi === 'nada') continue;
    gobierna.add(cod);
    if (mi === 'cantidad') continue;       // se suma una vez por código, abajo
    const cant = (mi === 'stock' ? stock : entradas) * factorDeItem(f);
    porCodigo.set(cod, (porCodigo.get(cod) || 0) + cant);
  }
  for (const [cod, cant] of fijos) {
    if (!gobierna.has(cod)) continue;
    porCodigo.set(cod, cant);
  }
  resumen.insumos = gobierna.size;
  return { porCodigo, gobierna, resumen };
}

// ═══════════════════════════════════════════════════════════════════
// EL MOTOR
// ═══════════════════════════════════════════════════════════════════

/**
 * La clave de un sobre: por nombre y unidad, no por código — así venía desde
 * la tanda 1 y es con lo que el plan escribe `origen_ref = 'sobre:<clave>'`.
 * Exportada para que la bandeja de imputación (tanda 2.5) no la re-derive.
 */
export const claveDeSobre = (ip) => `${String(ip?.nombre_insumo || ip?.nombre || '').trim().toLowerCase()}|${normUnidad(ip?.unidad)}`;

/** Clave con la que se juntan dos líneas que son el mismo insumo. */
const claveInsumo = (ip) => (ip.insumo_codigo && String(ip.insumo_codigo).trim())
  || `~${String(ip.nombre_insumo || '').trim().toLowerCase()}|${normUnidad(ip.unidad)}`;

/**
 * Simula las órdenes de un trabajo.
 *
 * @param {Object}  o
 * @param {Array}   o.insumosPartida         presupuesto del trabajo.
 * @param {Array}   o.partidas               para el cronograma.
 * @param {string}  [o.hoy]                  'YYYY-MM-DD'; default `hoyLocal()`.
 * @param {'mes'|'semana'} [o.granularidad='mes']
 * @param {'hoy'|'restante'|'cero'} [o.anclaje='hoy']            §3.1
 * @param {'gantt'|'reprogramado'|'sin_cronograma'} [o.cronograma='gantt'] §3.2
 * @param {'parejo'|'inicio'|'escenario'|'cuadrilla'|'manual'} [o.reparto='parejo']    §3.3
 * @param {Array<string>|null} [o.categorias=null]  null = todas.            §3.4
 * @param {Object}  [o.reprogramacion]       partida_id → {inicio, fin}.
 * @param {Array}   [o.cuadrillas]           [{fecha, personas}].
 * @param {Object}  [o.repartoManual]        partida_id → {periodo: fracción}
 *                  (con 'manual' y con 'escenario').
 * @param {Object}  [o.plazo]                {inicio, fin} del trabajo.
 * @param {number}  [o.umbralTramoLargoDias=30]
 * @param {number}  [o.anticipacionDias=0]   adelanta el pedido N días antes
 *                  del tramo. Default 0: sin pedirlo, no cambia nada.
 * @param {Array}   [o.ordenes] @param {Array} [o.ocItems]   lo ya pedido.
 * @param {Array}   [o.requisiciones] @param {Array} [o.requisicionItems]
 *                  lo ya requisado — incluido lo que escribió este mismo
 *                  simulador en una corrida anterior (tanda 4, §7).
 * @param {Map|Object|null} [o.yaComprado]   código → cantidad ya comprada.
 * @param {Object}  [o.consumoSobres]        clave de sobre → monto ya gastado.
 * @param {Object}  [o.compras]              clave de línea → cómo se compra ese
 *                  insumo `{unidadCompra, factor, lote, colchonPct}` (tanda 2.2,
 *                  ver `simulador-compra.js`). Lo que no venga se deduce del
 *                  nombre o queda en la unidad del expediente, sin colchón.
 * @param {string}  [o.frecuencia='mensual'] cada cuánto se emite una orden
 *                  (tanda 2.3, ver `simulador-consolidacion.js`).
 * @param {Object}  [o.frecuenciaPorRubro]   rubro → frecuencia, pisa la general.
 * @param {number}  [o.montoMinimoOrden=0]   una orden por debajo se junta con
 *                  la siguiente del mismo rubro. 0 = no se junta.
 * @param {Array}   [o.almacen]              ítems del almacén de la obra con su
 *                  imputación (tanda 2.5, `existenciasDelAlmacen()`).
 * @param {string}  [o.almacenModo='entradas'] qué resta el almacén — ver
 *                  `coberturaPrevia`.
 * @param {Object}  [o.almacenPorInsumo]     código → {modo, cantidad}, solo en
 *                  el modo 'personalizado'.
 *
 * @returns {{propuestas:Array, sobres:Array, manoObra:Array, pendientes:Array, resumen:Object}}
 */
export function simularOrdenes({
  insumosPartida = [], partidas = [],
  hoy = null,
  granularidad = 'mes',
  anclaje = 'hoy',
  cronograma = 'gantt',
  reparto = 'parejo',
  categorias = null,
  reprogramacion = {},
  cuadrillas = [],
  repartoManual = {},
  plazo = null,
  umbralTramoLargoDias = UMBRAL_TRAMO_LARGO_DIAS,
  anticipacionDias = 0,
  ordenes = [], ocItems = [], yaComprado = null,
  requisiciones = [], requisicionItems = [],
  consumoSobres = null,
  terminosCustom = null,
  compras = null,
  frecuencia = FRECUENCIA_DEFAULT,
  frecuenciaPorRubro = null,
  montoMinimoOrden = 0,
  almacen = [],
  almacenModo = 'entradas',
  almacenPorInsumo = null,
} = {}) {
  const gran = GRANULARIDADES.includes(granularidad) ? granularidad : 'mes';
  const anc = ANCLAJES.includes(anclaje) ? anclaje : 'hoy';
  const cron = CRONOGRAMAS.includes(cronograma) ? cronograma : 'gantt';
  const rep = REPARTOS.includes(reparto) ? reparto : 'parejo';
  const filtro = Array.isArray(categorias) && categorias.length ? new Set(categorias) : null;
  const hoyYmd = hoy || hoyLocal();
  const periodoActual = periodoDe(hoyYmd, gran);

  const porId = new Map(vivos(partidas).map(p => [p.id, p]));

  // La clasificación se hace UNA VEZ POR NOMBRE, no por línea: Miraflores
  // tiene 6.722 líneas de insumo y 432 nombres distintos, y `clasificarConIUPC`
  // recorre el diccionario del Anexo 2 en cada llamada. Sin este memo, la
  // corrida entera se repite en cada cambio de perilla.
  const memoIUPC = new Map();
  const clasificarNombre = (nombre) => {
    const k = String(nombre || '');
    let v = memoIUPC.get(k);
    if (!v) { v = clasificacionDe(k, terminosCustom); memoIUPC.set(k, v); }
    return v;
  };

  // acumuladores
  const celdas = new Map();     // `${periodo}|${clave}` → línea acumulada
  const sobres = new Map();     // clave de sobre → { …, porPeriodo:Map }
  const manoObra = new Map();   // `${periodo}|${clave}` → línea acumulada
  const pendientes = [];
  const resumen = {
    granularidad: gran, anclaje: anc, cronograma: cron, reparto: rep,
    categorias: filtro ? [...filtro] : [...CATEGORIAS_SIMULADOR],
    hoy: hoyYmd, periodoActual, umbralTramoLargoDias, anticipacionDias,
    lineasPresupuesto: 0, lineasSimuladas: 0, lineasTramoLargo: 0,
    lineasFiltradas: 0, lineasSinPrecio: 0,
    montoPresupuesto: 0, montoComprable: 0, montoManoObra: 0,
    montoFiltrado: 0, montoSobres: 0, montoPropuesto: 0,
    montoArrastrado: 0, montoOmitidoPorPasado: 0,
    // Plata que el plan pide POR ENCIMA del expediente, y por qué. Las dos
    // son decisiones de compra, no del presupuesto: la cobertura se mide sin
    // ellas o un colchón del 10% se leería como «ya planificaste el 110%».
    montoColchon: 0, montoRedondeo: 0, insumosConColchon: 0,
    descontado: { insumos: 0, cantidad: 0, monto: 0 },
    ocSinImputar: { lineas: 0, monto: 0 },
    reqSinImputar: { lineas: 0, monto: 0 },
    fueraPresupuesto: { lineas: 0, monto: 0 },
    almacen: null,
    consumoSobresInformado: consumoSobres != null,
    // Consolidación (tanda 2.3): cuántas órdenes habría sin juntar, cuántas
    // se juntaron por monto y cuántas quedan chicas igual.
    frecuencia, montoMinimoOrden: num(montoMinimoOrden),
    ordenesSinConsolidar: 0, ordenesJuntadasPorMonto: 0, ordenesBajoMinimo: 0,
  };

  // ── 1) repartir cada línea del presupuesto en sus períodos ────────
  for (const ip of vivos(insumosPartida)) {
    resumen.lineasPresupuesto += 1;

    const cantidad = num(ip.cantidad_presupuestada);
    const precio = num(ip.precio_presupuestado);
    const montoCrudo = ip.costo_presupuestado != null ? num(ip.costo_presupuestado) : cantidad * precio;
    const montoConocido = ip.costo_presupuestado != null || precio > 0;
    if (!montoConocido) resumen.lineasSinPrecio += 1;
    resumen.montoPresupuesto += montoCrudo;

    const cls = clasificarInsumoDePresupuesto(ip);
    if (cls.categoria === 'mano_obra') resumen.montoManoObra += montoCrudo;
    else resumen.montoComprable += montoCrudo;

    if (filtro && !filtro.has(cls.categoria)) {
      resumen.lineasFiltradas += 1;
      resumen.montoFiltrado += montoCrudo;
      continue;
    }

    const partida = porId.get(ip.partida_id) || null;
    const tramo = tramoDeLinea(partida, { cronograma: cron, reprogramacion, plazo });
    if (tramo.error) {
      pendientes.push({
        motivo: tramo.error, insumo_codigo: ip.insumo_codigo || null,
        nombre: ip.nombre_insumo || '', unidad: ip.unidad || '',
        partida_id: ip.partida_id || null, cantidad: r4(cantidad), monto: r2(montoCrudo),
        categoria: cls.categoria, subcategoria: cls.subcategoria,
      });
      continue;
    }

    // La anticipación adelanta el tramo entero: si hay que pedir 15 días
    // antes, también el último período del tramo se corre.
    const inicio = anticipacionDias ? sumarDias(tramo.inicio, -anticipacionDias) : tramo.inicio;
    const fin = anticipacionDias ? sumarDias(tramo.fin, -anticipacionDias) : tramo.fin;
    const dur = diasEntre(inicio, fin) ?? 0;
    const tramoLargo = dur > umbralTramoLargoDias;
    if (tramoLargo) resumen.lineasTramoLargo += 1;

    const periodos = periodosEntre(inicio, fin, gran);
    // Un tramo corto no se reparte aunque cruce el borde del mes: se pide
    // para cuando arranca. Repartir 4 días entre dos meses es ruido.
    const plan = tramoLargo
      ? repartirTramo({ inicio, fin }, periodos, { reparto: rep, cuadrillas, repartoManual, partidaId: ip.partida_id, granularidad: gran })
      : { periodos: [{ periodo: periodos[0], fraccion: 1 }] };

    if (plan.error) {
      pendientes.push({
        motivo: plan.error, insumo_codigo: ip.insumo_codigo || null,
        nombre: ip.nombre_insumo || '', unidad: ip.unidad || '',
        partida_id: ip.partida_id || null, cantidad: r4(cantidad), monto: r2(montoCrudo),
        categoria: cls.categoria, subcategoria: cls.subcategoria,
        tramo: { inicio, fin, dias: dur },
      });
      continue;
    }

    resumen.lineasSimuladas += 1;

    // Un SOBRE no es una lista de insumos: es un techo de plata. Va por su
    // propio carril y nunca entra a una propuesta con cantidad (§4.1).
    if (cls.esSobre) {
      const clave = claveDeSobre(ip);
      let s = sobres.get(clave);
      if (!s) {
        s = {
          clave, nombre: ip.nombre_insumo || '', unidad: ip.unidad || '',
          categoria: cls.categoria, subcategoria: cls.subcategoria,
          techo: 0, enPartidas: 0, partidaIds: new Set(), porPeriodo: new Map(),
          codigos: new Set(),
        };
        sobres.set(clave, s);
      }
      s.techo += montoCrudo;
      s.enPartidas += 1;
      // El código deja imputarle una línea de orden (tanda 2.5): la clave del
      // sobre es por nombre, pero la orden se imputa por código.
      if (ip.insumo_codigo) s.codigos.add(String(ip.insumo_codigo).trim());
      if (ip.partida_id) s.partidaIds.add(ip.partida_id);
      for (const { periodo, fraccion } of plan.periodos) {
        s.porPeriodo.set(periodo, (s.porPeriodo.get(periodo) || 0) + montoCrudo * fraccion);
      }
      resumen.montoSobres += montoCrudo;
      continue;
    }

    const destino = cls.categoria === 'mano_obra' ? manoObra : celdas;
    const clave = claveInsumo(ip);
    for (const { periodo, fraccion } of plan.periodos) {
      const k = `${periodo}|${clave}`;
      let c = destino.get(k);
      if (!c) {
        const iupc = clasificarNombre(ip.nombre_insumo);
        c = {
          periodo, clave, insumo_codigo: ip.insumo_codigo || null,
          nombre: ip.nombre_insumo || '', unidad: ip.unidad || '',
          categoria: cls.categoria, subcategoria: cls.subcategoria,
          iupc, rubro: rubroDeCompra(iupc.codigo),
          cantidad: 0, monto: 0, montoConocido: true,
          partidas: new Set(), porPartida: new Map(),
          tramoLargo: false, arrastrado: false,
        };
        destino.set(k, c);
      }
      c.cantidad += cantidad * fraccion;
      c.monto += montoCrudo * fraccion;
      if (!montoConocido) c.montoConocido = false;
      if (ip.partida_id) {
        c.partidas.add(ip.partida_id);
        // Aditivo para la tanda 2: el desglose por partida es lo que deja
        // contestar «con la gente que tengo, qué partidas alcanzo este mes».
        // Agregado, `partidas` solo dice cuáles, no cuánto de cada una.
        const pp = c.porPartida.get(ip.partida_id) || { cantidad: 0, monto: 0 };
        pp.cantidad += cantidad * fraccion;
        pp.monto += montoCrudo * fraccion;
        c.porPartida.set(ip.partida_id, pp);
      }
      if (tramoLargo) c.tramoLargo = true;
    }
  }

  // ── 1b) cómo se compra cada insumo, y su colchón (tanda 2.2) ──────
  // Se resuelve UNA vez por insumo. El colchón va ANTES del descuento: es
  // parte de lo que la obra necesita pedir, así que lo ya pedido se resta de
  // la necesidad con colchón. Al revés, una corrida posterior volvería a
  // proponer el colchón que ya se requisó.
  const compraPorClave = new Map();
  const compraDe = (c) => {
    let v = compraPorClave.get(c.clave);
    if (!v) {
      v = resolverCompra(compras?.[c.clave], { nombre: c.nombre, unidad: c.unidad });
      compraPorClave.set(c.clave, v);
    }
    return v;
  };
  const conColchon = new Set();
  for (const c of celdas.values()) {
    const { colchonPct } = compraDe(c);
    if (!(colchonPct > 0)) continue;
    const extra = colchonPct / 100;
    c.cantidad *= 1 + extra;
    c.monto *= 1 + extra;
    conColchon.add(c.clave);
  }
  resumen.insumosConColchon = conColchon.size;

  // ── 2) restar lo ya comprado / ya ordenado ────────────────────────
  // El descuento se aplica de los períodos MÁS VIEJOS hacia adelante: lo que
  // ya está en obra cubre primero las necesidades más cercanas.
  const {
    cubierto, sinImputar, reqSinImputar, consumoSobre, fueraPresupuesto, almacen: almResumen,
  } = coberturaPrevia({
    ordenes, ocItems, yaComprado, requisiciones, requisicionItems,
    almacen, almacenModo, almacenPorInsumo,
  });
  resumen.ocSinImputar = sinImputar;
  resumen.reqSinImputar = reqSinImputar;
  resumen.fueraPresupuesto = fueraPresupuesto;
  resumen.almacen = almResumen;

  if (anc !== 'cero' && cubierto.size) {
    const porClave = new Map();
    for (const c of celdas.values()) {
      if (!c.insumo_codigo) continue;      // sin código no hay contra qué restar
      const arr = porClave.get(c.insumo_codigo) || [];
      arr.push(c);
      porClave.set(c.insumo_codigo, arr);
    }
    for (const [cod, arr] of porClave) {
      let resta = num(cubierto.get(cod));
      if (resta <= 0) continue;
      let algo = false;
      arr.sort((a, b) => (a.periodo < b.periodo ? -1 : a.periodo > b.periodo ? 1 : 0));
      for (const c of arr) {
        if (resta <= 0) break;
        const baja = Math.min(c.cantidad, resta);
        if (baja <= 0) continue;
        const precioUnit = c.cantidad > 0 ? c.monto / c.cantidad : 0;
        c.cantidad -= baja;
        c.monto -= baja * precioUnit;
        resta -= baja;
        algo = true;
        resumen.descontado.cantidad += baja;
        resumen.descontado.monto += baja * precioUnit;
      }
      if (algo) resumen.descontado.insumos += 1;
    }
  }

  // ── 3) aplicar el anclaje (§3.1) ──────────────────────────────────
  const aplicarAnclaje = (mapa) => {
    if (anc === 'cero') return;
    for (const [k, c] of [...mapa]) {
      if (c.periodo >= periodoActual) continue;
      mapa.delete(k);
      if (anc === 'restante') {
        // No desaparece en silencio: se informa cuánto se dejó afuera.
        resumen.montoOmitidoPorPasado += c.monto;
        continue;
      }
      // 'hoy': lo atrasado se arrastra al período actual, porque una orden
      // no se puede emitir con fecha del mes pasado.
      const destino = `${periodoActual}|${c.clave}`;
      const ya = mapa.get(destino);
      resumen.montoArrastrado += c.monto;
      if (ya) {
        ya.cantidad += c.cantidad; ya.monto += c.monto;
        ya.arrastrado = true;
        ya.tramoLargo = ya.tramoLargo || c.tramoLargo;
        for (const p of c.partidas) ya.partidas.add(p);
        for (const [pid, pp] of c.porPartida) {
          const acum = ya.porPartida.get(pid) || { cantidad: 0, monto: 0 };
          acum.cantidad += pp.cantidad; acum.monto += pp.monto;
          ya.porPartida.set(pid, acum);
        }
        if (!c.montoConocido) ya.montoConocido = false;
      } else {
        mapa.set(destino, { ...c, periodo: periodoActual, arrastrado: true });
      }
    }
  };
  aplicarAnclaje(celdas);
  aplicarAnclaje(manoObra);

  // ── 3b) llevar a cantidades que se pueden pedir (tanda 2.2) ───────
  // Va DESPUÉS del descuento y del anclaje, porque se redondea lo que
  // efectivamente queda por pedir, período por período y acumulado (ver
  // `cantidadesDeCompra`). La mano de obra no pasa por acá: son HH de
  // referencia y el motor de dotación las necesita con sus decimales.
  const seriePorClave = new Map();
  for (const c of celdas.values()) {
    // Una celda sin cantidad (cubierta entera, o un costo sin cantidad en el
    // expediente) no se redondea: no hay nada que llevar a unidades.
    if (!(c.cantidad > 0.0001)) continue;
    const arr = seriePorClave.get(c.clave) || [];
    arr.push(c);
    seriePorClave.set(c.clave, arr);
  }
  for (const [clave, arr] of seriePorClave) {
    arr.sort((a, b) => (a.periodo < b.periodo ? -1 : a.periodo > b.periodo ? 1 : 0));
    const compra = compraDe(arr[0]);
    const pedidas = cantidadesDeCompra(arr.map(c => c.cantidad), compra);
    arr.forEach((c, i) => {
      const { cantidad, alcanzaHasta } = pedidas[i];
      // El precio de la unidad del expediente de ESTA celda: puede variar de
      // un mes a otro si el insumo tiene precios distintos en distintas
      // partidas, y promediarlo entre meses movería plata de un mes a otro.
      const precioExp = c.monto / c.cantidad;
      const montoNuevo = cantidad * compra.factor * precioExp;
      // La parte del colchón se mide sobre lo que QUEDÓ por pedir, después
      // del descuento y del anclaje: si lo ya pedido cubrió el mes entero,
      // ese colchón no es plata del plan.
      if (compra.colchonPct > 0) resumen.montoColchon += c.monto * (compra.colchonPct / (100 + compra.colchonPct));
      resumen.montoRedondeo += montoNuevo - c.monto;
      c.necesidad = c.cantidad;             // lo que de verdad hace falta este período
      c.cantidadCompra = cantidad;
      c.monto = montoNuevo;
      c.compra = compra;
      c.alcanzaHasta = alcanzaHasta > i ? arr[alcanzaHasta].periodo : null;
      // Lo que pedía este período ya lo cubrió el redondeo de uno anterior:
      // sale de la orden en vez de quedar como una línea de cero.
      if (cantidad <= 0) celdas.delete(`${c.periodo}|${clave}`);
    });
  }

  // ── 4) armar las propuestas ───────────────────────────────────────
  // Una propuesta = un período × un RUBRO DE PROVEEDOR. Es la unidad que se
  // acepta o se rechaza entera en la pantalla (tanda 3).
  //
  // HASTA EL 22-SET ERA «período × subcategoría», y con cuatro cajones el
  // resultado era una orden sola de 58 líneas donde convivían los exámenes
  // médicos preocupacionales, los monitoreos de calidad de agua, una
  // gigantografía y el cemento. Gabriel: «vamos a generar una orden con cosas
  // súper mezcladas, que es ilógico». No se le puede mandar a nadie.
  //
  // El rubro sale de la clasificación oficial (`rubroDeCompra`), así que la
  // orden agrupa lo que UN proveedor vende: el cemento con sus aditivos y sus
  // agregados, las señales con los cachacos y los EPPs, los cuatro monitoreos
  // juntos. Salen MÁS órdenes por mes y cada una se puede mandar.
  //
  // ── DESDE LA TANDA 2.3: «PERÍODO × RUBRO» ES UNA ENTREGA, NO UNA ORDEN ──
  // Lo que hasta acá era la orden ahora es un ÁTOMO: lo que un rubro necesita
  // en un período. `consolidarOrdenes()` junta los átomos en órdenes según la
  // frecuencia del rubro y el monto mínimo, y cada línea de la orden lleva la
  // tabla de ENTREGAS por período. El id del átomo es el mismo que tenía la
  // orden antes (`2026-10|concreto`), y es contra él que el escenario guarda
  // las decisiones: reagrupar no borra nada de lo ya decidido.
  const atomos = new Map();
  for (const c of celdas.values()) {
    if (c.cantidad <= 0.0001 && c.monto <= 0.004) continue;   // quedó cubierto
    const k = `${c.periodo}|${c.rubro}`;
    let a = atomos.get(k);
    if (!a) {
      a = { id: k, periodo: c.periodo, rubro: c.rubro, mes: mesDePeriodo(c.periodo), monto: 0, celdas: [] };
      atomos.set(k, a);
    }
    a.celdas.push(c);
    a.monto += c.monto;
  }

  const consolidadas = consolidarOrdenes([...atomos.values()], {
    frecuencia, frecuenciaPorRubro, montoMinimo: montoMinimoOrden,
  });
  resumen.ordenesSinConsolidar = atomos.size;
  resumen.ordenesJuntadasPorMonto = consolidadas.filter(g => g.juntadaPorMonto).length;
  resumen.ordenesBajoMinimo = consolidadas.filter(g => g.bajoMinimo).length;

  const propuestas = consolidadas.map(g => {
    const primera = atomos.get(g.atomos[0]).celdas[0];
    const rubroInfo = RUBRO_COMPRA_POR_ID.get(g.rubro);
    const p = {
      id: g.id, periodo: g.periodo, etiquetaPeriodo: etiquetaPeriodo(g.periodo),
      // Los períodos que ENTREGA esta orden, y cómo se nombra la ventana:
      // «octubre a diciembre 2026». Con una sola entrega es el período.
      periodos: g.periodos,
      etiquetaVentana: etiquetaVentana(g.periodos),
      // De qué átomos está hecha: es contra esto que se decide (ver arriba).
      atomos: g.atomos.map((id, i) => ({ id, periodo: g.periodos[i] })),
      frecuencia: g.frecuencia,
      juntadaPorMonto: g.juntadaPorMonto, bajoMinimo: g.bajoMinimo,
      categoria: primera.categoria, subcategoria: primera.subcategoria,
      rubro: g.rubro, rubroNombre: rubroInfo?.nombre || g.rubro,
      rubroIcono: rubroInfo?.icono || '',
      titulo: '', lineas: [], monto: 0, tieneMontoIncompleto: false,
    };

    // Las celdas de un mismo insumo, de todos los períodos de la orden, en
    // orden cronológico: se vuelven UNA línea con sus entregas.
    const porClave = new Map();
    for (const atomoId of g.atomos) {
      for (const c of atomos.get(atomoId).celdas) {
        const arr = porClave.get(c.clave) || [];
        arr.push({ c, atomoId });
        porClave.set(c.clave, arr);
      }
    }
    for (const arr of porClave.values()) {
      p.lineas.push(lineaDePropuesta(arr, compraDe));
      for (const { c } of arr) {
        p.monto += c.monto;
        if (!c.montoConocido) p.tieneMontoIncompleto = true;
      }
    }
    return p;
  });

  // Dentro de un mismo período las órdenes salen en el orden de los rubros
  // (los de obra antes que los de gasto), no por monto: así la lista de un mes
  // se lee siempre igual y se encuentra la orden que uno busca.
  propuestas.sort((a, b) =>
    (a.periodo < b.periodo ? -1 : a.periodo > b.periodo ? 1 : 0)
    || (ordenDeRubro(a.rubro) - ordenDeRubro(b.rubro))
    || (b.monto - a.monto));

  // El título: «Seguridad y señalización — primera dotación» para la PRIMERA
  // tanda del rubro de seguridad (el ejemplo del §1 del plan, que hablaba de
  // EPPs), y «Rubro — ventana» para el resto.
  const primerPeriodoSeguridad = propuestas.find(p => p.rubro === 'seguridad')?.periodo;
  for (const g of propuestas) {
    g.titulo = (g.rubro === 'seguridad' && g.periodo === primerPeriodoSeguridad && g.periodos.length === 1)
      ? `${g.rubroNombre} — primera dotación`
      : `${g.rubroNombre} — ${g.etiquetaVentana}`;
    g.monto = r2(g.monto);
    g.lineas.sort((a, b) => b.monto - a.monto);
    resumen.montoPropuesto += g.monto;
  }

  // ── 5) los sobres ─────────────────────────────────────────────────
  // Cada sobre viaja con su clasificación IUPC además de la subcategoría del
  // simulador. Las dos contestan preguntas distintas y por eso conviven: la
  // subcategoría dice en qué cajón del filtro cae (4 cajones), y el IUPC dice
  // QUÉ ES (82 códigos + los servicios). Lo segundo es lo que deja agrupar
  // los sobres por el tipo de proveedor que los atiende — el flete con el
  // transportista, la herramienta manual con la ferretería, las publicaciones
  // con la imprenta— que con «servicios» a secas no se puede.
  //
  // `consumido` es lo que ya se gastó del sobre. Si el caller no lo informó
  // NO se asume 0 en silencio: `consumoInformado` lo dice y `disponible`
  // queda en null. Un sobre que se cree entero cuando ya se gastó la mitad
  // es exactamente el doble gasto que el §7 viene a evitar.
  const sobresOut = [...sobres.values()].map(s => {
    // Lo gastado sale de dos lados: lo que el plan ya requisó contra el sobre
    // (por clave) y las órdenes imputadas a él (por código, tanda 2.5).
    let deOrdenes = 0, hayDeOrdenes = false;
    for (const cod of s.codigos) {
      if (consumoSobre.has(cod)) { deOrdenes += consumoSobre.get(cod); hayDeOrdenes = true; }
    }
    const deReq = consumoSobres != null && consumoSobres[s.clave] != null;
    const informado = deReq || hayDeOrdenes;
    const consumido = informado ? r2((deReq ? num(consumoSobres[s.clave]) : 0) + deOrdenes) : null;
    return {
      clave: s.clave, nombre: s.nombre, unidad: s.unidad,
      categoria: s.categoria, subcategoria: s.subcategoria,
      iupc: clasificacionDe(s.nombre, terminosCustom),
      techo: r2(s.techo), enPartidas: s.enPartidas, partidaIds: [...s.partidaIds],
      codigos: [...s.codigos],
      consumidoPorOrdenes: hayDeOrdenes ? r2(deOrdenes) : 0,
      consumido, consumoInformado: informado,
      disponible: informado ? r2(s.techo - consumido) : null,
      porPeriodo: [...s.porPeriodo]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([periodo, monto]) => ({ periodo, etiquetaPeriodo: etiquetaPeriodo(periodo), monto: r2(monto) })),
      // Un sobre se ordena por DESCRIPCIÓN LIBRE contra su techo: no tiene
      // lista de insumos que ofrecer.
      descripcionLibre: true,
    };
  }).sort((a, b) => b.techo - a.techo);

  // ── 6) mano de obra: solo referencia, nunca una orden (§5) ────────
  const manoObraOut = [...manoObra.values()]
    .filter(c => c.cantidad > 0.0001)
    .map(c => ({
      periodo: c.periodo, etiquetaPeriodo: etiquetaPeriodo(c.periodo),
      insumo_codigo: c.insumo_codigo, nombre: c.nombre, unidad: c.unidad,
      cantidad: r4(c.cantidad), monto: r2(c.monto),
      partidas: [...c.partidas], tramoLargo: c.tramoLargo, arrastrado: c.arrastrado,
      // HH y plata de ESTA línea en CADA partida del período. Lo consume
      // `simulador-dotacion.js` (tanda 2) para el ranking de partidas
      // alcanzables; sin esto solo se sabe cuáles, no cuánto pesa cada una.
      porPartida: [...c.porPartida]
        .map(([partida_id, pp]) => ({ partida_id, cantidad: r4(pp.cantidad), monto: r2(pp.monto) }))
        .sort((a, b) => b.cantidad - a.cantidad),
      esReferencia: true,
    }))
    .sort((a, b) => (a.periodo < b.periodo ? -1 : a.periodo > b.periodo ? 1 : 0) || (b.monto - a.monto));

  const periodos = [...new Set([
    ...propuestas.map(p => p.periodo),
    ...sobresOut.flatMap(s => s.porPeriodo.map(x => x.periodo)),
    ...manoObraOut.map(m => m.periodo),
  ])].sort();

  resumen.periodos = periodos;
  resumen.propuestas = propuestas.length;
  resumen.lineasPendientes = pendientes.length;
  resumen.sobres = sobresOut.length;
  for (const k of ['montoPresupuesto', 'montoComprable', 'montoManoObra', 'montoFiltrado',
    'montoSobres', 'montoPropuesto', 'montoArrastrado', 'montoOmitidoPorPasado',
    'montoColchon', 'montoRedondeo']) {
    resumen[k] = r2(resumen[k]);
  }
  resumen.descontado.cantidad = r4(resumen.descontado.cantidad);
  resumen.descontado.monto = r2(resumen.descontado.monto);

  // La barra de cobertura de la pantalla apunta a ESTO y no al presupuesto
  // total: el 47% de Miraflores es planilla y nunca va a cubrirse con
  // órdenes (§2 del plan). Y se mide SIN el colchón ni el redondeo (tanda
  // 2.2): son plata de más que se decidió pedir, no presupuesto cubierto.
  resumen.montoPlanificado = r2(resumen.montoPropuesto + resumen.montoSobres);
  const planificadoDelExpediente = resumen.montoPlanificado - resumen.montoColchon - resumen.montoRedondeo;
  resumen.cobertura = resumen.montoComprable > 0
    ? Math.min(1, Math.max(0, r4(planificadoDelExpediente / resumen.montoComprable)))
    : 0;

  return { propuestas, sobres: sobresOut, manoObra: manoObraOut, pendientes, resumen };
}

/**
 * Cómo se nombra la ventana de una orden: «octubre 2026» si entrega en un solo
 * mes (aunque sean cuatro semanas), «octubre a diciembre 2026» si cruza meses.
 */
export function etiquetaVentana(periodos = []) {
  const ps = [...(periodos || [])].filter(Boolean).sort();
  if (!ps.length) return '';
  if (ps.length === 1) return etiquetaPeriodo(ps[0]);
  const primero = mesDePeriodo(ps[0]), ultimo = mesDePeriodo(ps[ps.length - 1]);
  if (!primero || !ultimo) return `${etiquetaPeriodo(ps[0])} a ${etiquetaPeriodo(ps[ps.length - 1])}`;
  if (primero === ultimo) return etiquetaPeriodo(primero);
  const [a1, m1] = primero.split('-'), [a2, m2] = ultimo.split('-');
  const mes = (m) => MESES[+m - 1] || m;
  return a1 === a2 ? `${mes(m1)} a ${mes(m2)} ${a2}` : `${mes(m1)} ${a1} a ${mes(m2)} ${a2}`;
}

/**
 * UNA línea de una orden a partir de las celdas de un mismo insumo en los
 * períodos que entrega esa orden (tanda 2.3).
 *
 * Con una sola entrega la línea sale idéntica a la de antes: los campos de
 * siempre más `entregas` con un solo elemento. Con varias, la cantidad y el
 * monto son la suma y `entregas` dice cuánto va en cada período — que es lo
 * que tiene que figurar en la orden para que el proveedor sepa cuándo llevar
 * qué.
 */
function lineaDePropuesta(arr, compraDe) {
  const { c } = arr[0];
  const compra = c.compra || compraDe(c);
  // Sin pasar por 3b (celda sin cantidad) se muestra tal cual vino.
  const cantidadDe = (x) => (x.cantidadCompra != null ? x.cantidadCompra : x.cantidad);
  const conCompra = c.cantidadCompra != null;
  let cantidad = 0, monto = 0, necesidad = 0;
  let montoConocido = true, tramoLargo = false, arrastrado = false;
  const partidas = new Set();
  const entregas = arr.map(({ c: x, atomoId }) => {
    const q = cantidadDe(x);
    cantidad += q; monto += x.monto;
    necesidad += x.necesidad != null ? x.necesidad : x.cantidad;
    if (!x.montoConocido) montoConocido = false;
    if (x.tramoLargo) tramoLargo = true;
    if (x.arrastrado) arrastrado = true;
    for (const pid of x.partidas) partidas.add(pid);
    return {
      periodo: x.periodo, etiquetaPeriodo: etiquetaPeriodo(x.periodo),
      // La orden de antes, ahora átomo: la decisión de esta entrega se guarda
      // contra `${propuestaId}::${clave}`.
      propuestaId: atomoId,
      cantidad: r4(q), monto: r2(x.monto),
      necesidad: r4(x.necesidad != null ? x.necesidad : x.cantidad),
      alcanzaHasta: x.alcanzaHasta || null,
      etiquetaAlcanzaHasta: x.alcanzaHasta ? etiquetaPeriodo(x.alcanzaHasta) : null,
    };
  });
  const ultima = entregas[entregas.length - 1];
  return {
    // Aditivo para la tanda 3: la clave con la que la pantalla guarda la
    // decisión y la corrección de ESTA línea. Tiene que salir de acá y no
    // recalcularse allá — el código de insumo falta en buena parte del
    // expediente y el reemplazo (nombre+unidad) depende de `normUnidad`,
    // que es de este módulo. Dos derivaciones paralelas se desincronizan y
    // el día que lo hagan, una decisión aceptada se pierde sin aviso.
    clave: c.clave,
    insumo_codigo: c.insumo_codigo, nombre: c.nombre,
    // Desde la tanda 2.2 la cantidad está en la unidad de COMPRA (28 tubos,
    // no 164 m) y el precio es el de esa unidad. Lo del expediente viaja al
    // lado para que siempre se pueda ver contra qué se compara.
    unidad: conCompra ? compra.unidadCompra : c.unidad,
    cantidad: r4(cantidad), monto: r2(monto),
    precio_unitario: cantidad > 0 ? r4(monto / cantidad) : null,
    unidadExpediente: c.unidad,
    factor: conCompra ? compra.factor : 1,
    // Lo que de verdad hace falta en los períodos de esta orden, en unidades
    // del expediente y con el colchón ya puesto. La diferencia con
    // `cantidad × factor` es el redondeo.
    necesidad: r4(necesidad),
    lote: compra.lote, colchonPct: compra.colchonPct,
    compraOrigen: compra.origen, compraMotivo: compra.motivo,
    // Lo pedido en la última entrega cubre también los períodos siguientes
    // hasta éste: sus líneas no aparecen porque el redondeo ya las pidió.
    alcanzaHasta: ultima.alcanzaHasta,
    etiquetaAlcanzaHasta: ultima.etiquetaAlcanzaHasta,
    entregas,
    montoConocido, tramoLargo, arrastrado, partidas: [...partidas],
    categoria: c.categoria, subcategoria: c.subcategoria,
    // QUÉ ES esta línea, para que se vea por qué está en esta orden y se
    // pueda discutir. Sin esto, el rubro es una caja negra.
    iupc: c.iupc, rubro: c.rubro,
  };
}

/**
 * Los motivos por los que una línea queda sin planificar, en texto.
 * La pantalla tiene que poder decir por qué, no solo cuántas.
 */
export const MOTIVO_PENDIENTE_LABEL = {
  sin_fecha: 'La partida no tiene fecha de inicio planificada',
  sin_partida: 'El insumo no está enganchado a ninguna partida viva',
  sin_plazo: 'El trabajo no tiene plazo cargado y el reparto es sin cronograma',
  falta_cuadrillas: 'Falta cargar cuántas personas entran y cuándo',
  falta_reparto_manual: 'Falta fijar a mano el reparto de esta partida',
  falta_reparto_escenario: 'El escenario no trae cómo avanza esta partida',
};
