// ═══════════════════════════════════════════════════════════════════
// JARVEX — STOCK COMPROMETIDO: qué hay, qué ya tiene dueño, qué falta comprar.
//
// Motor PURO (sin React, sin Dexie, sin IA) que contesta la pregunta que la
// pantalla de Solicitud de Insumos no sabía contestar: cuando llegan tres
// requerimientos del mismo insumo y en el almacén hay menos de lo que suman,
// ¿cuánto hay que comprar REALMENTE?
//
// ── EL CASO QUE LO ORIGINA (Gabriel, 23-set-2026) ─────────────────
// En obra hay 10 unidades. Llegan tres requerimientos: 18, 6 y 28.
// Sumar los tres y restar el stock una sola vez da 42 — y ese número es
// correcto. Lo que NO es correcto es mostrarle a cada uno de los tres «tenés
// 10 disponibles»: las mismas 10 unidades no pueden cubrir tres pedidos.
// El primero que se aprueba se las lleva; los otros dos ven cero.
//
// ── LA REGLA (decidida por Gabriel el 23-set-2026) ────────────────
// · La requisición APROBADA reserva en firme. El material todavía está en el
//   almacén, pero ya tiene dueño.
// · La requisición PENDIENTE **no** reserva — todavía puede rechazarse, y
//   congelar material por una solicitud que después se cae es peor que el
//   problema que resuelve. Pero SÍ se informa aparte (`enCola`), para que
//   quien revisa la tercera solicitud vea que las dos anteriores ya se
//   anotaron para lo mismo.
// · El reparto es FIFO por fecha de revisión: se aprobó primero, se lo lleva
//   primero. No es una preferencia estética — es la única regla que da el
//   mismo resultado sin importar en qué orden se abran las pantallas.
//
// ── POR QUÉ NO SE GUARDA EN NINGUNA TABLA ─────────────────────────
// Lo comprometido es una CONSECUENCIA de las requisiciones que ya existen,
// no un dato nuevo. Materializarlo obligaría a mantenerlo en espejo en cada
// aprobación, cada rechazo y cada edición — tres lugares donde se desincroniza
// en silencio. Se calcula al leer, que es barato y no puede mentir.
//
// ── EL LÍMITE HONESTO DE ESTA VERSIÓN ─────────────────────────────
// Hoy nada ata una salida de almacén a la requisición que la motivó. Por eso
// la reserva se suelta por ESTADO (ver `RESERVAN`), no por entrega. Entre que
// la almacenera entrega el material y que la requisición se cierra, lo
// entregado se cuenta dos veces: baja el `stock_actual` y además sigue
// reservado. Es a propósito: el error conservador hace comprar de más, y el
// otro deja la obra parada.
// ═══════════════════════════════════════════════════════════════════

// 🔴 SIN IMPORTS A PROPÓSITO. `normNombre` vive en `insumos-catalogo.js`, pero
// ese archivo importa Dexie (`db` de jarvex.db) — importarlo desde acá metía la
// base de datos entera dentro de un motor que dice ser puro, y Rollup lo
// partía en un chunk compartido junto con Dexie. Son cuatro líneas: se copian
// y un test verifica que las dos versiones dan siempre lo mismo, para que no
// se separen con el tiempo.
export function normNombre(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/\s+/g, ' ');
}

const vivos = (arr) => (Array.isArray(arr) ? arr.filter(x => x && !x.deleted_at) : []);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;

/** Estados en los que una requisición RESERVA el stock que hay en obra. */
export const RESERVAN = new Set(['aprobada', 'aprobada_parcial', 'ordenada']);

/** Estados en los que la solicitud todavía no reserva, pero ya se anunció. */
export const EN_COLA = new Set(['pendiente', 'pendiente_aprobacion', 'solicitada']);

/**
 * Clave con la que dos líneas son «el mismo insumo».
 *
 * Con insumo real manda el id: dos filas que apuntan al mismo material son
 * el mismo material aunque estén escritas distinto. Sin insumo real (el
 * catálogo PENDIENTE de `insumos-catalogo.js`) se cae al nombre normalizado
 * dentro de su tipo — «CEMENTO SOL» y «Cemento Sol» son uno solo, pero un
 * EPP y un material que se llaman igual no se mezclan nunca.
 */
export function claveInsumo({ tipo_insumo, tipo, insumo_id, nombre } = {}) {
  const t = String(tipo_insumo || tipo || 'material');
  if (insumo_id) return `${t}|${insumo_id}`;
  const n = normNombre(nombre);
  return n ? `${t}|~${n}` : '';
}

/**
 * Reparte el stock físico entre las requisiciones que ya lo reservaron.
 *
 * @param {Object}  opts
 * @param {Array}   opts.requisiciones    filas de `requisiciones` de la obra
 * @param {Array}   opts.requisicionItems filas de `requisicion_items`
 * @param {Map|Object} opts.stock         clave de insumo → cantidad física en obra
 * @param {string}  [opts.excluirReqId]   requisición a ignorar (la que se edita)
 * @returns {{porInsumo: Map<string, Object>}}
 */
export function repartirStock({ requisiciones = [], requisicionItems = [], stock = new Map(), excluirReqId = null } = {}) {
  const stockDe = (k) => num(stock instanceof Map ? stock.get(k) : stock[k]);

  // ── Qué requisiciones reservan y cuáles solo hacen cola ──
  const reservan = new Map();   // id → fila
  const cola = new Map();
  for (const r of vivos(requisiciones)) {
    if (excluirReqId && r.id === excluirReqId) continue;
    // Una requisición que ya tiene su orden de compra emitida sigue
    // reservando: la orden cubre lo que hay que COMPRAR, no lo que se saca
    // del almacén. Recién `recibida` (o cancelada/rechazada) la suelta.
    if (RESERVAN.has(r.estado)) reservan.set(r.id, r);
    else if (EN_COLA.has(r.estado)) cola.set(r.id, r);
  }

  const porInsumo = new Map();
  const tocar = (k) => {
    if (!porInsumo.has(k)) porInsumo.set(k, {
      hay: r2(stockDe(k)), comprometido: 0, disponible: 0,
      enCola: 0, faltaComprar: 0, reservas: [], cola: [],
    });
    return porInsumo.get(k);
  };

  const lineasReserva = [];
  const lineasCola = [];
  for (const it of vivos(requisicionItems)) {
    const k = claveInsumo(it);
    if (!k) continue;
    const r = reservan.get(it.requisicion_id);
    if (r) {
      // La cantidad APROBADA manda sobre la pedida: si de 100 bolsas se
      // aprobaron 60, lo reservado son 60. Misma regla que `coberturaPrevia()`
      // en `simulador-ordenes.js` — no se reinventa acá.
      const cant = num(it.cantidad_aprobada != null ? it.cantidad_aprobada : it.cantidad);
      if (cant > 0) lineasReserva.push({ k, cant, req: r });
      continue;
    }
    const c = cola.get(it.requisicion_id);
    if (c) {
      const cant = num(it.cantidad);
      if (cant > 0) lineasCola.push({ k, cant, req: c });
    }
  }

  // FIFO: la que se revisó primero se lleva el stock. Sin `revisado_at` cae
  // a `updated_at` y por último al id, para que el orden sea estable y no
  // dependa de cómo vino el array de Dexie.
  const cuando = (r) => `${String(r?.revisado_at || r?.updated_at || r?.created_at || '')}|${String(r?.id || '')}`;
  lineasReserva.sort((a, b) => cuando(a.req).localeCompare(cuando(b.req)));

  const restante = new Map();
  for (const { k, cant, req } of lineasReserva) {
    const e = tocar(k);
    if (!restante.has(k)) restante.set(k, e.hay);
    const libre = restante.get(k);
    const cubierto = Math.min(libre, cant);      // lo que sale del almacén
    const comprar = r2(cant - cubierto);         // lo que hay que comprar sí o sí
    restante.set(k, r2(libre - cubierto));
    e.comprometido = r2(e.comprometido + cubierto);
    e.faltaComprar = r2(e.faltaComprar + comprar);
    e.reservas.push({
      requisicion_id: req.id, codigo: req.codigo || '',
      cubierto: r2(cubierto), comprar,
    });
  }

  for (const { k, cant, req } of lineasCola) {
    const e = tocar(k);
    e.enCola = r2(e.enCola + cant);
    e.cola.push({ requisicion_id: req.id, codigo: req.codigo || '', cantidad: r2(cant) });
  }

  for (const [k, e] of porInsumo) {
    e.disponible = r2(Math.max(0, restante.has(k) ? restante.get(k) : e.hay));
  }
  return { porInsumo };
}

/**
 * Lo que necesita UNA línea que se está escribiendo ahora mismo.
 *
 * Contesta las tres frases que la almacenera necesita leer sin pensar:
 * «lo tenemos», «lo tenemos a medias», «no tenemos nada».
 *
 * @returns {{hay:number, comprometido:number, disponible:number, enCola:number,
 *            pedido:number, cubre:number, comprar:number,
 *            cobertura:'completa'|'parcial'|'ninguna', avisoCola:boolean}}
 */
export function coberturaDeLinea({ reparto, clave, cantidad, stockSuelto = 0 } = {}) {
  const e = (clave && reparto?.porInsumo?.get(clave)) || null;
  // Un insumo que nadie requirió todavía no figura en el reparto: su stock
  // está entero y disponible. `stockSuelto` es ese caso.
  const hay = e ? num(e.hay) : num(stockSuelto);
  const disponible = e ? num(e.disponible) : hay;
  const pedido = num(cantidad);
  const cubre = r2(Math.min(disponible, pedido));
  const comprar = r2(Math.max(0, pedido - cubre));
  return {
    hay: r2(hay),
    comprometido: r2(e?.comprometido),
    disponible: r2(disponible),
    enCola: r2(e?.enCola),
    pedido: r2(pedido),
    cubre, comprar,
    cobertura: pedido <= 0 ? 'ninguna' : (comprar === 0 ? 'completa' : (cubre > 0 ? 'parcial' : 'ninguna')),
    // El aviso que pidió Gabriel: hay cosas anotadas para este insumo que
    // todavía nadie aprobó. Quien revisa tiene que saberlo ANTES de decidir.
    avisoCola: num(e?.enCola) > 0,
  };
}
