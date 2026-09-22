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
// Testeado en __tests__/simulador-ordenes.test.js
// ═══════════════════════════════════════════════════════════════════

import {
  clasificarInsumoDePresupuesto, CATEGORIAS_SIMULADOR,
  SUBCATEGORIA_LABEL, normUnidad,
} from './insumo-clasificador.js';
import { hoyLocal } from './fecha.js';

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
export const REPARTOS = ['parejo', 'inicio', 'cuadrilla', 'manual'];
export const REPARTO_LABEL = {
  parejo: 'Parejo entre los períodos del tramo',
  inicio: 'Todo al inicio del tramo',
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

  if (reparto === 'manual') {
    const fijado = repartoManual?.[partidaId];
    const entradas = Object.entries(fijado || {}).filter(([, f]) => num(f) > 0);
    if (!entradas.length) return { error: 'falta_reparto_manual' };
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

/**
 * Cuánto de cada insumo ya está comprado o comprometido por una orden viva.
 *
 * Una orden ANULADA libera lo que reservaba. Una orden que ya tiene
 * comprobante vinculado no se cuenta acá si el caller pasó `yaComprado`:
 * esa cantidad ya viene por el lado de la factura y restarla dos veces
 * borraría material que sí hay que pedir. Es la misma regla de
 * `abastecimientoDeObra`.
 *
 * @returns {{cubierto:Map<string,number>, sinImputar:{lineas:number, monto:number}}}
 */
export function coberturaPrevia({ ordenes = [], ocItems = [], yaComprado = null } = {}) {
  const cubierto = new Map();
  const suma = (cod, cant) => cubierto.set(cod, (cubierto.get(cod) || 0) + num(cant));

  const previas = yaComprado instanceof Map ? [...yaComprado] : Object.entries(yaComprado || {});
  for (const [cod, cant] of previas) if (cod) suma(String(cod), cant);

  const vivas = new Map();
  for (const o of vivos(ordenes)) {
    if (o.estado === 'anulada' || o.estado === 'cancelada') continue;
    // Con `yaComprado` en mano, la orden ya facturada se cuenta por la
    // factura. Sin él, es la única señal que hay y sí se cuenta.
    if (yaComprado && o.accounting_movement_id) continue;
    vivas.set(o.id, o);
  }

  const sinImputar = { lineas: 0, monto: 0 };
  for (const it of vivos(ocItems)) {
    if (!vivas.has(it.orden_compra_id)) continue;
    const cod = it.insumo_codigo && String(it.insumo_codigo).trim();
    if (!cod) {
      // Sin código no se puede descontar de ninguna línea del presupuesto.
      // Se cuenta aparte y se dice: en Miraflores esto es el 100% (62/62).
      sinImputar.lineas += 1;
      sinImputar.monto += num(it.subtotal) || num(it.cantidad) * num(it.precio_unitario);
      continue;
    }
    suma(cod, it.cantidad);
  }
  sinImputar.monto = r2(sinImputar.monto);
  return { cubierto, sinImputar };
}

// ═══════════════════════════════════════════════════════════════════
// EL MOTOR
// ═══════════════════════════════════════════════════════════════════

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
 * @param {'parejo'|'inicio'|'cuadrilla'|'manual'} [o.reparto='parejo']    §3.3
 * @param {Array<string>|null} [o.categorias=null]  null = todas.            §3.4
 * @param {Object}  [o.reprogramacion]       partida_id → {inicio, fin}.
 * @param {Array}   [o.cuadrillas]           [{fecha, personas}].
 * @param {Object}  [o.repartoManual]        partida_id → {periodo: fracción}.
 * @param {Object}  [o.plazo]                {inicio, fin} del trabajo.
 * @param {number}  [o.umbralTramoLargoDias=30]
 * @param {number}  [o.anticipacionDias=0]   adelanta el pedido N días antes
 *                  del tramo. Default 0: sin pedirlo, no cambia nada.
 * @param {Array}   [o.ordenes] @param {Array} [o.ocItems]   lo ya pedido.
 * @param {Map|Object|null} [o.yaComprado]   código → cantidad ya comprada.
 * @param {Object}  [o.consumoSobres]        clave de sobre → monto ya gastado.
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
  consumoSobres = null,
} = {}) {
  const gran = GRANULARIDADES.includes(granularidad) ? granularidad : 'mes';
  const anc = ANCLAJES.includes(anclaje) ? anclaje : 'hoy';
  const cron = CRONOGRAMAS.includes(cronograma) ? cronograma : 'gantt';
  const rep = REPARTOS.includes(reparto) ? reparto : 'parejo';
  const filtro = Array.isArray(categorias) && categorias.length ? new Set(categorias) : null;
  const hoyYmd = hoy || hoyLocal();
  const periodoActual = periodoDe(hoyYmd, gran);

  const porId = new Map(vivos(partidas).map(p => [p.id, p]));

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
    descontado: { insumos: 0, cantidad: 0, monto: 0 },
    ocSinImputar: { lineas: 0, monto: 0 },
    consumoSobresInformado: consumoSobres != null,
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
      const clave = `${String(ip.nombre_insumo || '').trim().toLowerCase()}|${normUnidad(ip.unidad)}`;
      let s = sobres.get(clave);
      if (!s) {
        s = {
          clave, nombre: ip.nombre_insumo || '', unidad: ip.unidad || '',
          categoria: cls.categoria, subcategoria: cls.subcategoria,
          techo: 0, enPartidas: 0, porPeriodo: new Map(),
        };
        sobres.set(clave, s);
      }
      s.techo += montoCrudo;
      s.enPartidas += 1;
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
        c = {
          periodo, clave, insumo_codigo: ip.insumo_codigo || null,
          nombre: ip.nombre_insumo || '', unidad: ip.unidad || '',
          categoria: cls.categoria, subcategoria: cls.subcategoria,
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

  // ── 2) restar lo ya comprado / ya ordenado ────────────────────────
  // El descuento se aplica de los períodos MÁS VIEJOS hacia adelante: lo que
  // ya está en obra cubre primero las necesidades más cercanas.
  const { cubierto, sinImputar } = coberturaPrevia({ ordenes, ocItems, yaComprado });
  resumen.ocSinImputar = sinImputar;

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

  // ── 4) armar las propuestas ───────────────────────────────────────
  // Una propuesta = un período × una subcategoría. Es la unidad que se
  // acepta o se rechaza entera en la pantalla (tanda 3).
  const grupos = new Map();
  for (const c of celdas.values()) {
    if (c.cantidad <= 0.0001 && c.monto <= 0.004) continue;   // quedó cubierto
    const k = `${c.periodo}|${c.subcategoria}`;
    let g = grupos.get(k);
    if (!g) {
      g = {
        id: k, periodo: c.periodo, etiquetaPeriodo: etiquetaPeriodo(c.periodo),
        categoria: c.categoria, subcategoria: c.subcategoria,
        titulo: '', lineas: [], monto: 0, tieneMontoIncompleto: false,
      };
      grupos.set(k, g);
    }
    g.lineas.push({
      // Aditivo para la tanda 3: la clave con la que la pantalla guarda la
      // decisión y la corrección de ESTA línea. Tiene que salir de acá y no
      // recalcularse allá — el código de insumo falta en buena parte del
      // expediente y el reemplazo (nombre+unidad) depende de `normUnidad`,
      // que es de este módulo. Dos derivaciones paralelas se desincronizan y
      // el día que lo hagan, una decisión aceptada se pierde sin aviso.
      clave: c.clave,
      insumo_codigo: c.insumo_codigo, nombre: c.nombre, unidad: c.unidad,
      cantidad: r4(c.cantidad), monto: r2(c.monto),
      precio_unitario: c.cantidad > 0 ? r4(c.monto / c.cantidad) : null,
      montoConocido: c.montoConocido, tramoLargo: c.tramoLargo,
      arrastrado: c.arrastrado, partidas: [...c.partidas],
      categoria: c.categoria, subcategoria: c.subcategoria,
    });
    g.monto += c.monto;
    if (!c.montoConocido) g.tieneMontoIncompleto = true;
  }

  const propuestas = [...grupos.values()].sort((a, b) =>
    (a.periodo < b.periodo ? -1 : a.periodo > b.periodo ? 1 : 0)
    || (b.monto - a.monto));

  // El título: «EPPs — primera dotación» para la PRIMERA tanda de EPPs (el
  // ejemplo del §1 del plan), y «Subcategoría — período» para el resto.
  const primerPeriodoEpp = propuestas.find(p => p.subcategoria === 'epp')?.periodo;
  for (const g of propuestas) {
    const etiqueta = SUBCATEGORIA_LABEL[g.subcategoria] || g.subcategoria;
    g.titulo = (g.subcategoria === 'epp' && g.periodo === primerPeriodoEpp)
      ? 'EPPs — primera dotación'
      : `${etiqueta} — ${g.etiquetaPeriodo}`;
    g.monto = r2(g.monto);
    g.lineas.sort((a, b) => b.monto - a.monto);
    resumen.montoPropuesto += g.monto;
  }

  // ── 5) los sobres ─────────────────────────────────────────────────
  // `consumido` es lo que ya se gastó del sobre. Si el caller no lo informó
  // NO se asume 0 en silencio: `consumoInformado` lo dice y `disponible`
  // queda en null. Un sobre que se cree entero cuando ya se gastó la mitad
  // es exactamente el doble gasto que el §7 viene a evitar.
  const sobresOut = [...sobres.values()].map(s => {
    const informado = consumoSobres != null && consumoSobres[s.clave] != null;
    const consumido = informado ? r2(consumoSobres[s.clave]) : null;
    return {
      clave: s.clave, nombre: s.nombre, unidad: s.unidad,
      categoria: s.categoria, subcategoria: s.subcategoria,
      techo: r2(s.techo), enPartidas: s.enPartidas,
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
    'montoSobres', 'montoPropuesto', 'montoArrastrado', 'montoOmitidoPorPasado']) {
    resumen[k] = r2(resumen[k]);
  }
  resumen.descontado.cantidad = r4(resumen.descontado.cantidad);
  resumen.descontado.monto = r2(resumen.descontado.monto);

  // La barra de cobertura de la pantalla apunta a ESTO y no al presupuesto
  // total: el 47% de Miraflores es planilla y nunca va a cubrirse con
  // órdenes (§2 del plan).
  resumen.montoPlanificado = r2(resumen.montoPropuesto + resumen.montoSobres);
  resumen.cobertura = resumen.montoComprable > 0
    ? Math.min(1, r4(resumen.montoPlanificado / resumen.montoComprable))
    : 0;

  return { propuestas, sobres: sobresOut, manoObra: manoObraOut, pendientes, resumen };
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
};
