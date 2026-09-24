// ═══════════════════════════════════════════════════════════════════
// JARVEX — SIMULADOR DE DOTACIÓN (tanda 2 del simulador de órdenes)
//
// Diseño completo en `docs/plan-simulador-ordenes.md`, §5. Este archivo NO
// compra nada y NO escribe nada: convierte HH ↔ personas en los dos
// sentidos y las cruza contra el padrón real de `personal`.
//
// ── LA DECISIÓN QUE DEFINE ESTE ARCHIVO ───────────────────────────
// Gabriel, 22-set-2026: **aceptar una simulación de mano de obra no genera
// NINGÚN registro** — ni alta en `personal`, ni pedido a RRHH, ni orden. Es
// un número de referencia para mirar al lado de la dotación real. Por eso
// acá no hay Dexie, no hay React y no hay nada que devuelva un id: todo lo
// que sale es para leer. Si algún día eso cambia, es una tanda aparte.
//
// ── LOS DOS SENTIDOS (§5) ─────────────────────────────────────────
//  1. Cronograma → dotación necesaria:  HH del período ÷ horas por persona.
//  2. Dotación disponible → avance posible:  con la gente que HAY, cuántas
//     HH se cubren y **qué partidas alcanzan** ese mes.
//
// El reparto por período NO se recalcula acá: entra ya hecho, por el
// `manoObra` que devuelve `simularOrdenes()`. Así los cuatro ejes de la
// corrida (anclaje, cronograma, reparto, granularidad) valen igual para la
// gente que para los materiales, que es justo lo que pide el §5.
//
// ── LO QUE SE MIDIÓ EN MIRAFLORES (22-set-2026) ───────────────────
// El presupuesto pide, repartido parejo por mes sobre el Gantt (las
// personas salen de dividir por los días laborables REALES de cada mes
// a 8 h, lun-sáb — ver «LA JORNADA» más abajo):
//
//     mes      días   HH peón   peones     HH operario   operarios
//     2026-07   27      9.427     43,6         1.303         6,0
//     2026-09   26     10.097     48,5         2.569        12,3
//     2026-10   27     37.081    171,7         7.863        36,4
//     2026-11   25     40.216    201,1        10.773        53,9
//
// El padrón de esa obra tiene **15 peones, 2 operarios y 1 oficial**. La
// brecha de noviembre es de 186 peones — no es un ajuste fino, es la
// pregunta central que la pantalla tiene que poner sobre la mesa. Y
// noviembre pide MÁS gente que octubre con menos HH, porque tiene dos días
// laborables menos: por eso el divisor no puede ser un 208 fijo.
//
// ── LOS TRES SILENCIOS QUE HAY QUE ROMPER ─────────────────────────
// Un cero callado acá se lee como «tengo la gente» y se planifica en falso.
// Los tres casos reales, medidos:
//
//  · **29 de las 86 personas son de subcontrato** y su cargo dice
//    «Subcontrato MOSHCO», no qué oficio hacen. NO se pueden contar como
//    peones. Salen por `padron.sinEncajar` con motivo `subcontrato`.
//  · **55 de 86 no tienen `fecha_ingreso`** (64%). No se las descarta por
//    eso — están activas hoy — pero `padron.sinFechaIngreso` lo dice.
//  · **`asistencia` tiene 0 filas** en esa obra: no hay horas realmente
//    trabajadas contra las cuales medir. La oferta sale del padrón (cuánta
//    gente hay), no de horas reales, y `resumen.fuenteOferta` lo declara.
//
// Testeado en __tests__/simulador-dotacion.test.js
// ═══════════════════════════════════════════════════════════════════

import { etiquetaPeriodo, periodoDe, sumarDias, rangoDePeriodo } from './simulador-ordenes.js';
import { hoyLocal } from './fecha.js';

const vivos = (arr) => (Array.isArray(arr) ? arr.filter(x => x && !x.deleted_at) : []);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;
const r4 = (n) => Math.round((num(n) + Number.EPSILON) * 10000) / 10000;
const p2 = (n) => String(n).padStart(2, '0');
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// ═══════════════════════════════════════════════════════════════════
// CARGOS: UN SOLO VOCABULARIO PARA LOS DOS LADOS
//
// El presupuesto dice «PEON» y el padrón dice «Peón»; el presupuesto dice
// «OPERADOR DE EQUIPO LIVIANO» y el padrón (cuando lo tenga) dirá «Operador
// de equipo». La MISMA función normaliza los dos lados, así que no hace
// falta ninguna tabla de mapeo que después quede desincronizada.
//
// Los cinco primeros son los cargos reales del expediente de Miraflores
// (`tipo_insumo='mano_obra'`, unidad `hh`, un `insumo_codigo` limpio cada
// uno). Maestro y capataz no están en ese presupuesto pero sí en el padrón:
// existen acá para que la pantalla los pueda nombrar en vez de tirarlos al
// cajón de «no encaja».
// ═══════════════════════════════════════════════════════════════════

export const CARGOS_OBRA = [
  { key: 'peon',            label: 'Peón',               codigos: ['470020004'] },
  { key: 'oficial',         label: 'Oficial',            codigos: ['470020001'] },
  { key: 'operario',        label: 'Operario',           codigos: ['470020003'] },
  { key: 'operador_equipo', label: 'Operador de equipo', codigos: ['470020002'] },
  { key: 'topografo',       label: 'Topógrafo',          codigos: ['450020005'] },
  { key: 'maestro',         label: 'Maestro de obra',    codigos: [] },
  { key: 'capataz',         label: 'Capataz',            codigos: [] },
];
export const CARGO_LABEL = Object.fromEntries(CARGOS_OBRA.map(c => [c.key, c.label]));
export const CARGO_KEYS = CARGOS_OBRA.map(c => c.key);
const CARGO_POR_CODIGO = new Map(
  CARGOS_OBRA.flatMap(c => c.codigos.map(cod => [cod, c.key])));
/** Orden de despacho estable: el mismo con el que se listan los cargos. */
const ORDEN_CARGO = Object.fromEntries(CARGO_KEYS.map((k, i) => [k, i]));

// «Oficial de Seguridad» es la prevencionista, no una obrera: el mismo
// blocklist que ya protege a `personal-scope.js`. Se comprueba ANTES que
// los prefijos, porque «oficial de seguridad» empieza con «oficial».
const STAFF_BLOCKLIST = [
  /^oficial de (seguridad|cumplimiento|oficina)\b/,
  /^oficial administrativ/,
];

// El orden importa: el operador de equipo se reconoce antes que el operario
// para que «OPERADOR DE EQUIPO LIVIANO» no caiga en `operario`.
const CARGO_RE = [
  ['operador_equipo', /^operador(a|es)?\b/],
  ['maestro',         /^maestro\b/],
  ['capataz',         /^capataz(es)?\b/],
  ['topografo',       /^topograf/],
  ['peon',            /^peon(es)?\b/],
  ['oficial',         /^oficial(es)?\b/],
  ['operario',        /^operario(s)?\b/],
];

/**
 * El cargo canónico de un texto libre — sirve igual para el nombre de un
 * insumo del presupuesto («PEON») que para el cargo de una persona
 * («Peón», «Operario Civil», «Oficial Encofrador»).
 *
 * Devuelve `null` cuando no reconoce nada. **`null` NO es «peón»**: una
 * persona que no encaja se cuenta aparte, nunca se reparte entre los
 * cargos que sí se reconocen. Es el cero silencioso de `abastecimiento.js`
 * aplicado a la gente.
 */
export function cargoCanonico(texto) {
  const t = norm(texto);
  if (!t) return null;
  if (STAFF_BLOCKLIST.some(re => re.test(t))) return null;
  for (const [key, re] of CARGO_RE) if (re.test(t)) return key;
  return null;
}

/** El cargo de una línea de presupuesto: el código manda, el nombre respalda. */
export function cargoDeInsumo(linea = {}) {
  const cod = linea.insumo_codigo && String(linea.insumo_codigo).trim();
  if (cod && CARGO_POR_CODIGO.has(cod)) return CARGO_POR_CODIGO.get(cod);
  return cargoCanonico(linea.nombre);
}

// ═══════════════════════════════════════════════════════════════════
// LA JORNADA
//
// La conversión HH ↔ personas depende enteramente de cuántas horas rinde
// una persona en un período, y eso NO es una constante universal: en
// construcción civil peruana la jornada es de 48 h semanales (8 h × 6
// días, lunes a sábado), pero un mes con feriados rinde menos y una semana
// de Fiestas Patrias rinde la mitad.
//
// Por eso la capacidad se calcula contando los DÍAS LABORABLES REALES de
// cada período, no con un «208 h/mes» fijo que estaría mal casi siempre.
// `factorEfectivo` deja bajar eso por ausentismo sin tocar la jornada.
// ═══════════════════════════════════════════════════════════════════

export const JORNADA_DEFAULT = {
  horasPorDia: 8,
  /** 0 = domingo. Construcción civil trabaja de lunes a sábado. */
  diasSemana: [1, 2, 3, 4, 5, 6],
  /** 1 = nadie falta nunca. Bajarlo modela ausentismo, no achica la jornada. */
  factorEfectivo: 1,
};

const DIA_MS = 86400000;
const aUTC = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
};
const deUTC = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
};

// `rangoDePeriodo` vive en `simulador-ordenes.js`, con el resto de las
// funciones de período, desde la tanda 2.3: la consolidación de órdenes lo
// necesita y desde acá se habría armado un import circular. Se re-exporta
// para que nadie que lo importe de acá se rompa.
export { rangoDePeriodo };

/** Días laborables entre dos fechas, según la jornada y los feriados. */
export function diasLaborables(desde, hasta, jornada = JORNADA_DEFAULT, feriados = []) {
  const a = aUTC(desde), b = aUTC(hasta);
  if (a == null || b == null || b < a) return 0;
  const dias = new Set(jornada?.diasSemana || JORNADA_DEFAULT.diasSemana);
  const libres = new Set((feriados || []).map(f => String(f).slice(0, 10)));
  let n = 0;
  for (let ms = a; ms <= b; ms += DIA_MS) {
    if (!dias.has(new Date(ms).getUTCDay())) continue;
    if (libres.has(deUTC(ms))) continue;
    n += 1;
  }
  return n;
}

/**
 * Cuántas horas rinde UNA persona en un período.
 * @returns {{horas:number, diasLaborables:number, parcial:boolean, pasado:boolean}}
 *
 * El período que contiene a `hoy` se recorta: el 22 de setiembre ya no se
 * puede trabajar el 3 de setiembre. Contar el mes entero sería prometer una
 * capacidad que ya no existe.
 */
export function capacidadDePeriodo(periodo, {
  jornada = JORNADA_DEFAULT, feriados = [], hoy = null, recortarActual = true,
} = {}) {
  const rango = rangoDePeriodo(periodo);
  if (!rango) return { horas: 0, diasLaborables: 0, parcial: false, pasado: false };
  const hoyYmd = hoy || hoyLocal();
  const pasado = rango.fin < hoyYmd;
  let desde = rango.inicio;
  let parcial = false;
  if (recortarActual && !pasado && rango.inicio < hoyYmd && hoyYmd <= rango.fin) {
    desde = hoyYmd;
    parcial = true;
  }
  const d = diasLaborables(desde, rango.fin, jornada, feriados);
  const horas = d * num(jornada?.horasPorDia ?? JORNADA_DEFAULT.horasPorDia)
    * num(jornada?.factorEfectivo ?? 1);
  return { horas: r2(horas), diasLaborables: d, parcial, pasado };
}

// ═══════════════════════════════════════════════════════════════════
// EL PADRÓN: QUIÉN CUENTA COMO OFERTA
// ═══════════════════════════════════════════════════════════════════

export const MOTIVO_SIN_ENCAJAR_LABEL = {
  inactivo: 'No está activo en el padrón',
  subcontrato: 'Es de un subcontrato: el cargo no dice qué oficio hace',
  cargo_no_obra: 'El cargo no ejecuta horas-hombre del presupuesto',
};

/**
 * Clasifica el padrón de `personal` en cargos de obra.
 *
 * Tres razones por las que alguien NO cuenta como oferta, y las tres se
 * informan una por una en vez de desaparecer:
 *  · `inactivo`      — el estado no es 'activo'.
 *  · `subcontrato`   — tiene `subcontratista_id`: su cargo dice de qué
 *                      subcontrato es, no qué oficio hace. 29 de 86 en
 *                      Miraflores. Contarlos como peones sería inventar.
 *  · `cargo_no_obra` — ingeniero, almacenero, administrador: no ejecutan
 *                      HH del presupuesto.
 *
 * @param {Array} personal
 * @param {Object} [opts]
 * @param {boolean} [opts.contarSubcontratos=false]  si el subcontrato SÍ
 *        declara el oficio en el cargo, el caller lo puede pedir.
 */
export function clasificarPadron(personal = [], { contarSubcontratos = false } = {}) {
  const porCargo = new Map(CARGO_KEYS.map(k => [k, []]));
  const sinEncajar = [];
  let sinFechaIngreso = 0;
  let total = 0;

  for (const p of vivos(personal)) {
    total += 1;
    const base = {
      id: p.id, nombre: `${p.nombres || ''} ${p.apellidos || ''}`.trim(),
      cargo: p.cargo || '', fecha_ingreso: p.fecha_ingreso || null,
    };
    if (p.estado && p.estado !== 'activo') {
      sinEncajar.push({ ...base, motivo: 'inactivo' });
      continue;
    }
    if (p.subcontratista_id && !contarSubcontratos) {
      sinEncajar.push({ ...base, motivo: 'subcontrato', subcontratista_id: p.subcontratista_id });
      continue;
    }
    const cargo = cargoCanonico(p.cargo);
    if (!cargo) {
      sinEncajar.push({ ...base, motivo: 'cargo_no_obra' });
      continue;
    }
    if (!p.fecha_ingreso) sinFechaIngreso += 1;
    porCargo.get(cargo).push({ ...base, cargoKey: cargo });
  }

  return { porCargo, sinEncajar, sinFechaIngreso, total };
}

/**
 * Cuánta gente de un cargo hay disponible en un período.
 *
 * Quien no tiene `fecha_ingreso` cuenta igual — está activa hoy y es el 64%
 * del padrón real; descartarla por un dato que nadie cargó dejaría la
 * oferta casi en cero. Quien sí la tiene, cuenta desde que entró.
 */
function disponiblesEn(lista, periodo) {
  const rango = rangoDePeriodo(periodo);
  if (!rango) return lista.length;
  return lista.filter(p => !p.fecha_ingreso
    || String(p.fecha_ingreso).slice(0, 10) <= rango.fin).length;
}

// ═══════════════════════════════════════════════════════════════════
// EL SENTIDO INVERSO: QUÉ PARTIDAS ALCANZA LA GENTE QUE HAY
// ═══════════════════════════════════════════════════════════════════

export const ESTADO_PARTIDA_LABEL = {
  completa: 'Alcanza con la gente que hay',
  parcial: 'Alcanza a medias',
  sin_gente: 'Sin gente para al menos un cargo',
};

/**
 * Reparte las HH disponibles de cada cargo entre las partidas del período y
 * dice cuáles quedan completas, cuáles a medias y cuáles sin gente.
 *
 * Criterio de prioridad: **la que arranca antes**, y a igualdad, la más
 * chica en HH — terminar dos partidas cortas rinde más avance que dejar una
 * grande a medio hacer. Sin las fechas de las partidas cae a HH ascendente
 * y lo declara en `ordenadoPor`.
 *
 * Una partida solo está `completa` si TODOS sus cargos alcanzaron: una
 * cuadrilla sin operario no levanta un muro aunque sobren peones.
 */
function alcanceDePartidas(demandaPorPartida, horasLibres, partidasById) {
  const conFechas = partidasById && partidasById.size > 0;
  const filas = [...demandaPorPartida.entries()].map(([partida_id, d]) => {
    const p = conFechas ? partidasById.get(partida_id) : null;
    return {
      partida_id,
      nombre: p?.nombre_partida || p?.descripcion || '',
      codigo: p?.codigo || p?.item || null,
      inicio: p?.fecha_inicio_planificada ? String(p.fecha_inicio_planificada).slice(0, 10) : null,
      porCargo: d.porCargo, hh: d.hh, monto: d.monto,
    };
  });
  const ordenadoPor = filas.some(f => f.inicio) ? 'fecha_inicio' : 'hh';
  filas.sort((a, b) => {
    if (ordenadoPor === 'fecha_inicio') {
      const ai = a.inicio || '9999-12-31', bi = b.inicio || '9999-12-31';
      if (ai !== bi) return ai < bi ? -1 : 1;
    }
    return a.hh - b.hh;
  });

  const libres = new Map(horasLibres);
  const out = [];
  for (const f of filas) {
    let cubierta = 0, pedida = 0, algoEnCero = false, algoIncompleto = false;
    const detalle = [];
    for (const [cargo, hh] of [...f.porCargo].sort((a, b) => ORDEN_CARGO[a[0]] - ORDEN_CARGO[b[0]])) {
      const libre = num(libres.get(cargo));
      const usa = Math.max(0, Math.min(hh, libre));
      libres.set(cargo, libre - usa);
      pedida += hh; cubierta += usa;
      if (hh > 0 && usa <= 0) algoEnCero = true;
      else if (usa + 0.0001 < hh) algoIncompleto = true;
      detalle.push({ cargo, label: CARGO_LABEL[cargo] || cargo, hh: r2(hh), cubiertas: r2(usa) });
    }
    const estado = algoEnCero ? 'sin_gente' : (algoIncompleto ? 'parcial' : 'completa');
    out.push({
      partida_id: f.partida_id, nombre: f.nombre, codigo: f.codigo, inicio: f.inicio,
      hh: r2(f.hh), monto: r2(f.monto),
      porCargo: detalle,
      hhCubiertas: r2(cubierta),
      cobertura: pedida > 0 ? r4(Math.min(1, cubierta / pedida)) : 1,
      estado,
    });
  }
  return { partidas: out, ordenadoPor };
}

// ═══════════════════════════════════════════════════════════════════
// EL MOTOR
// ═══════════════════════════════════════════════════════════════════

/**
 * Simula la dotación de mano de obra de un trabajo. **No escribe nada.**
 *
 * @param {Object} o
 * @param {Array}  o.manoObra      el `manoObra` que devolvió `simularOrdenes()`.
 * @param {Array}  [o.personal]    padrón de la obra.
 * @param {Array}  [o.partidas]    para nombrar y ordenar las partidas alcanzables.
 * @param {Object} [o.jornada]     {horasPorDia, diasSemana, factorEfectivo}.
 * @param {Array}  [o.feriados]    'YYYY-MM-DD' que no se trabajan.
 * @param {string} [o.hoy]         'YYYY-MM-DD'; default `hoyLocal()`.
 * @param {Object} [o.dotacionManual]  cargo → {periodo: personas}. Override de
 *        la oferta, para simular «¿y si contrato 60 peones en octubre?».
 *        Pisa al padrón para ese cargo y período, y queda marcado.
 * @param {boolean} [o.contarSubcontratos=false]
 * @param {boolean} [o.recortarActual=true]
 *
 * @returns {{periodos:Array, cargos:Array, sinCargo:Array, padron:Object, resumen:Object}}
 */
export function simularDotacion({
  manoObra = [],
  personal = [],
  partidas = [],
  jornada = null,
  feriados = [],
  hoy = null,
  dotacionManual = null,
  contarSubcontratos = false,
  recortarActual = true,
} = {}) {
  const jor = { ...JORNADA_DEFAULT, ...(jornada || {}) };
  const hoyYmd = hoy || hoyLocal();
  const padron = clasificarPadron(personal, { contarSubcontratos });
  const partidasById = new Map(vivos(partidas).map(p => [p.id, p]));

  // ── 1) la demanda, tal como la repartió la tanda 1 ────────────────
  const porPeriodo = new Map();   // periodo → { cargos:Map, porPartida:Map, … }
  const sinCargo = [];            // líneas de `hh` cuyo cargo no se reconoce
  let hhTotal = 0, montoTotal = 0;

  for (const linea of (manoObra || [])) {
    if (!linea || !linea.periodo) continue;
    const hh = num(linea.cantidad);
    const monto = num(linea.monto);
    const cargo = cargoDeInsumo(linea);
    hhTotal += hh; montoTotal += monto;

    if (!cargo) {
      // Una línea de mano de obra de cargo desconocido NO se reparte entre
      // los conocidos: distorsionaría la brecha del peón, que es la que
      // decide la contratación.
      sinCargo.push({
        periodo: linea.periodo, insumo_codigo: linea.insumo_codigo || null,
        nombre: linea.nombre || '', unidad: linea.unidad || '',
        hh: r4(hh), monto: r2(monto),
      });
      continue;
    }

    let P = porPeriodo.get(linea.periodo);
    if (!P) {
      P = { periodo: linea.periodo, cargos: new Map(), porPartida: new Map(), conDetalle: true };
      porPeriodo.set(linea.periodo, P);
    }
    const c = P.cargos.get(cargo) || { hh: 0, monto: 0, arrastrado: false };
    c.hh += hh; c.monto += monto;
    if (linea.arrastrado) c.arrastrado = true;
    P.cargos.set(cargo, c);

    // El desglose por partida es lo único que permite contestar el sentido
    // inverso a nivel partida. Si el caller trae un `manoObra` viejo sin
    // `porPartida`, se dice (`alcanceDisponible:false`) en vez de repartir
    // a ojo.
    const detalle = Array.isArray(linea.porPartida) ? linea.porPartida : null;
    if (!detalle || !detalle.length) {
      if (linea.partidas?.length) P.conDetalle = false;
      continue;
    }
    for (const d of detalle) {
      if (!d?.partida_id) continue;
      const acum = P.porPartida.get(d.partida_id) || { hh: 0, monto: 0, porCargo: new Map() };
      acum.hh += num(d.cantidad);
      acum.monto += num(d.monto);
      acum.porCargo.set(cargo, num(acum.porCargo.get(cargo)) + num(d.cantidad));
      P.porPartida.set(d.partida_id, acum);
    }
  }

  // ── 2) los dos sentidos, período por período ──────────────────────
  const periodosOut = [];
  const acumCargo = new Map();          // cargo → totales del horizonte
  let hhRequeridasTot = 0, hhDisponiblesTot = 0, hhCubiertasTot = 0;
  let montoRequeridoTot = 0, montoCubiertoTot = 0;

  for (const periodo of [...porPeriodo.keys()].sort()) {
    const P = porPeriodo.get(periodo);
    const cap = capacidadDePeriodo(periodo, { jornada: jor, feriados, hoy: hoyYmd, recortarActual });
    const horasPorPersona = cap.horas;

    const cargosOut = [];
    const horasLibres = new Map();
    let hhReq = 0, hhDisp = 0, hhCub = 0, montoReq = 0, montoCub = 0;
    let personasNecesarias = 0, personasDisponibles = 0;

    for (const [cargo, d] of [...P.cargos].sort((a, b) => ORDEN_CARGO[a[0]] - ORDEN_CARGO[b[0]])) {
      // SENTIDO 1 — cronograma → dotación necesaria.
      // Sin horas por persona (un período sin días laborables: todo feriado,
      // o el mes en curso ya terminado) la división no existe: se devuelve
      // null, no un Infinity disfrazado de número.
      const necesarias = horasPorPersona > 0 ? d.hh / horasPorPersona : null;

      // SENTIDO 2 — dotación disponible → avance posible.
      const manual = dotacionManual?.[cargo]?.[periodo];
      const esManual = manual != null && Number.isFinite(Number(manual));
      const disponibles = esManual
        ? num(manual)
        : disponiblesEn(padron.porCargo.get(cargo) || [], periodo);
      const hhDisponibles = r2(disponibles * horasPorPersona);
      const hhCubiertas = Math.min(d.hh, hhDisponibles);
      const precioHH = d.hh > 0 ? d.monto / d.hh : 0;

      horasLibres.set(cargo, hhDisponibles);
      hhReq += d.hh; hhDisp += hhDisponibles; hhCub += hhCubiertas;
      montoReq += d.monto; montoCub += hhCubiertas * precioHH;
      if (necesarias != null) personasNecesarias += necesarias;
      personasDisponibles += disponibles;

      cargosOut.push({
        cargo, label: CARGO_LABEL[cargo] || cargo,
        hhRequeridas: r2(d.hh), monto: r2(d.monto), precioHH: r2(precioHH),
        personasNecesarias: necesarias == null ? null : r2(necesarias),
        personasDisponibles: disponibles, dotacionManual: esManual,
        hhDisponibles, hhCubiertas: r2(hhCubiertas),
        // La brecha en PERSONAS es el número que se lleva a una decisión de
        // contratación. Negativa = sobra gente para ese cargo ese período.
        brechaPersonas: necesarias == null ? null : r2(necesarias - disponibles),
        brechaHH: r2(d.hh - hhDisponibles),
        cobertura: d.hh > 0 ? r4(Math.min(1, hhDisponibles / d.hh)) : 1,
        arrastrado: !!d.arrastrado,
      });

      const A = acumCargo.get(cargo) || {
        cargo, label: CARGO_LABEL[cargo] || cargo,
        hhRequeridas: 0, monto: 0, hhDisponibles: 0, hhCubiertas: 0,
        periodos: 0, periodosConBrecha: 0, maxBrechaPersonas: 0, maxBrechaPeriodo: null,
        enPadron: (padron.porCargo.get(cargo) || []).length,
      };
      A.hhRequeridas += d.hh; A.monto += d.monto;
      A.hhDisponibles += hhDisponibles; A.hhCubiertas += hhCubiertas;
      A.periodos += 1;
      if (necesarias != null && necesarias - disponibles > 0.005) {
        A.periodosConBrecha += 1;
        if (necesarias - disponibles > A.maxBrechaPersonas) {
          A.maxBrechaPersonas = necesarias - disponibles;
          A.maxBrechaPeriodo = periodo;
        }
      }
      acumCargo.set(cargo, A);
    }

    const alcance = P.porPartida.size
      ? alcanceDePartidas(P.porPartida, horasLibres, partidasById)
      : { partidas: [], ordenadoPor: null };

    periodosOut.push({
      periodo, etiquetaPeriodo: etiquetaPeriodo(periodo),
      diasLaborables: cap.diasLaborables, horasPorPersona,
      periodoParcial: cap.parcial, periodoPasado: cap.pasado,
      cargos: cargosOut,
      hhRequeridas: r2(hhReq), hhDisponibles: r2(hhDisp), hhCubiertas: r2(hhCub),
      monto: r2(montoReq), montoCubierto: r2(montoCub),
      personasNecesarias: r2(personasNecesarias),
      personasDisponibles,
      brechaPersonas: r2(personasNecesarias - personasDisponibles),
      cobertura: hhReq > 0 ? r4(Math.min(1, hhDisp / hhReq)) : 1,
      alcance: alcance.partidas,
      alcanceOrdenadoPor: alcance.ordenadoPor,
      // Sin el desglose por partida no se puede decir qué alcanza: se dice
      // que no se sabe, en vez de armar un ranking inventado.
      alcanceDisponible: P.conDetalle && P.porPartida.size > 0,
      resumenAlcance: {
        completas: alcance.partidas.filter(p => p.estado === 'completa').length,
        parciales: alcance.partidas.filter(p => p.estado === 'parcial').length,
        sinGente: alcance.partidas.filter(p => p.estado === 'sin_gente').length,
      },
    });

    hhRequeridasTot += hhReq; hhDisponiblesTot += hhDisp; hhCubiertasTot += hhCub;
    montoRequeridoTot += montoReq; montoCubiertoTot += montoCub;
  }

  const cargos = [...acumCargo.values()]
    .map(A => ({
      ...A,
      hhRequeridas: r2(A.hhRequeridas), monto: r2(A.monto),
      hhDisponibles: r2(A.hhDisponibles), hhCubiertas: r2(A.hhCubiertas),
      maxBrechaPersonas: r2(A.maxBrechaPersonas),
      cobertura: A.hhRequeridas > 0 ? r4(Math.min(1, A.hhDisponibles / A.hhRequeridas)) : 1,
    }))
    .sort((a, b) => b.hhRequeridas - a.hhRequeridas);

  const esSemanal = String(periodosOut[0]?.periodo || '').includes('W');
  const resumen = {
    hoy: hoyYmd,
    granularidad: esSemanal ? 'semana' : 'mes',
    periodoActual: periodoDe(hoyYmd, esSemanal ? 'semana' : 'mes'),
    jornada: jor,
    feriados: (feriados || []).length,
    periodos: periodosOut.map(p => p.periodo),
    // De dónde sale la OFERTA. `asistencia` tiene 0 filas en Miraflores: no
    // hay horas realmente trabajadas contra las cuales medir, así que la
    // oferta es el padrón. Declararlo evita leer esto como horas reales.
    fuenteOferta: 'padron',
    hhRequeridas: r2(hhRequeridasTot),
    hhDisponibles: r2(hhDisponiblesTot),
    hhCubiertas: r2(hhCubiertasTot),
    monto: r2(montoRequeridoTot),
    montoCubierto: r2(montoCubiertoTot),
    cobertura: hhRequeridasTot > 0 ? r4(Math.min(1, hhDisponiblesTot / hhRequeridasTot)) : 0,
    hhTotalManoObra: r2(hhTotal),
    montoTotalManoObra: r2(montoTotal),
    lineasSinCargo: sinCargo.length,
    hhSinCargo: r2(sinCargo.reduce((s, l) => s + num(l.hh), 0)),
    dotacionManual: dotacionManual ? Object.keys(dotacionManual) : [],
    contarSubcontratos,
    // La leyenda que la pantalla TIENE que mostrar (§5): esto no genera
    // ningún registro. Vive acá y no en el JSX para que ningún caller la
    // pierda de vista.
    soloReferencia: true,
  };

  return {
    periodos: periodosOut,
    cargos,
    sinCargo,
    padron: {
      total: padron.total,
      sinFechaIngreso: padron.sinFechaIngreso,
      porCargo: CARGO_KEYS
        .map(k => ({ cargo: k, label: CARGO_LABEL[k], personas: (padron.porCargo.get(k) || []).length }))
        .filter(x => x.personas > 0),
      sinEncajar: padron.sinEncajar,
      resumenSinEncajar: ['inactivo', 'subcontrato', 'cargo_no_obra']
        .map(m => ({
          motivo: m, label: MOTIVO_SIN_ENCAJAR_LABEL[m],
          personas: padron.sinEncajar.filter(p => p.motivo === m).length,
        }))
        .filter(x => x.personas > 0),
    },
    resumen,
  };
}

/**
 * Cuánta gente hay que sumar, y cuándo, para que no quede brecha.
 *
 * Es la lectura ejecutiva de `periodos`: un renglón por cargo y período con
 * brecha, en orden de urgencia (lo más cercano primero). NO es un pedido a
 * RRHH ni genera nada — es lo que Gabriel mira para decidir a mano (§5).
 */
export function planDeContratacion({ periodos = [] } = {}, { minimo = 1 } = {}) {
  const out = [];
  for (const p of (periodos || [])) {
    for (const c of (p.cargos || [])) {
      if (c.brechaPersonas == null || c.brechaPersonas < minimo) continue;
      out.push({
        periodo: p.periodo, etiquetaPeriodo: p.etiquetaPeriodo,
        cargo: c.cargo, label: c.label,
        faltan: Math.ceil(c.brechaPersonas),
        brechaPersonas: c.brechaPersonas,
        hayHoy: c.personasDisponibles,
        hhSinCubrir: c.brechaHH,
        // Contratar no es instantáneo: el aviso vale desde el arranque del
        // período, no desde el día en que ya falta la gente.
        avisarDesde: rangoDePeriodo(p.periodo)?.inicio || null,
      });
    }
  }
  return out.sort((a, b) => (a.periodo < b.periodo ? -1 : a.periodo > b.periodo ? 1 : 0)
    || (b.brechaPersonas - a.brechaPersonas));
}

/** Fecha en la que conviene empezar a buscar gente para un período. */
export function fechaDeAviso(periodo, diasAnticipacion = 15) {
  const r = rangoDePeriodo(periodo);
  return r ? sumarDias(r.inicio, -Math.abs(num(diasAnticipacion))) : '';
}
