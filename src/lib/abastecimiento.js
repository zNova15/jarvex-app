// ═══════════════════════════════════════════════════════════════════
// JARVEX — ABASTECIMIENTO DE LA OBRA (tanda 7, entrega 6).
//
// EL PEDIDO (Gabriel, 6-sep-2026): «la obra necesita ~1.200 bolsas de cemento;
// GASOMI acumuló 700; se emite la orden por esas 700 y a GASOMI se le
// descuentan del inventario».
//
// El mecanismo era el correcto y los números eran otros. Medido contra
// producción el 6-sep-2026, Plan Miraflores necesita **11.269 bolsas** de
// CEMENTO PORTLAND TIPO I (código `210020001`, repartido en 191 partidas) y
// **29.856 kg** de ACERO CORRUGADO fy=4200 (`30020002`, en 33 partidas). El
// ejemplo se quedaba corto por un factor de diez, así que la pantalla no podía
// ser una lista corta: son 434 insumos canónicos.
//
// ── LAS CUATRO COLUMNAS, Y POR QUÉ ESAS ───────────────────────────
//
//   NECESITA   — del presupuesto (`insumos_partida`), sumado por código.
//   YA COMPRADO— lo que compró LA EJECUTORA. Es lo único que ya es costo de
//                la obra (modelo B — ver `costo-obra.js`).
//   DISPONIBLE — lo que tienen las OTRAS empresas del grupo y todavía no le
//                vendieron a la ejecutora. Es la oferta interna.
//   FALTA      — lo que no tiene nadie: necesita − comprado − disponible.
//
// ── POR QUÉ «DISPONIBLE» RESTA LAS VENTAS ─────────────────────────
// Una empresa no puede ofrecer dos veces la misma bolsa. Si GASOMI compró 318
// y ya le facturó 100 a la ejecutora, le quedan 218 — y esas 100 ya están
// contadas del otro lado, en «ya comprado». Sin esta resta, la pantalla
// invitaría a emitir una orden por cemento que ya se vendió, que es el mismo
// doble conteo que el modelo B vino a resolver. Hay 373 líneas de venta con
// ítems en producción, así que el dato existe para restarlo.
//
// ── LA REGLA QUE MÁS IMPORTA: EL CERO SILENCIOSO ──────────────────
// Una línea de factura solo entra si su descripción está MAPEADA a un código
// canónico Y el mapeo tiene factor de conversión. Si falta el factor no se
// asume 1: se cuenta aparte, en `sinFactor`. Un cero silencioso aquí diría «de
// este insumo no hay nada» cuando la verdad es «no sabemos cuánto hay», y la
// consecuencia sería comprar de más. Es la misma advertencia que ya dejó
// escrita `cantidadCanonica()` en mapeo-insumos.js.
//
// ── ARRANCA VACÍA, Y ESTÁ BIEN ────────────────────────────────────
// Al 6-sep-2026 `insumo_mapeo` tiene **0 filas**: la entrega 5 está en staging
// y nadie mapeó todavía. Entonces «disponible» arranca en cero para todo y la
// pantalla lo DICE, en vez de mostrar una tabla de ceros que se lee como «el
// grupo no tiene nada». `incluirPropuestas` deja ver además lo que el motor
// propone sin confirmar, marcado aparte y NUNCA sumado a las cifras firmes:
// son dos preguntas distintas y mezclarlas haría que se emitan órdenes contra
// un número que nadie confirmó.
//
// Puro: sin React, sin Dexie. Testeado en __tests__/abastecimiento.test.js
// ═══════════════════════════════════════════════════════════════════

import { itemsDeFactura } from './cruce-recepcion.js';
import { buscarMapeo, cantidadCanonica, normMapeo } from './mapeo-insumos.js';
import { esCompraMov, esVentaMov } from './costo-obra.js';

const vivos = (arr) => (Array.isArray(arr) ? arr.filter(x => x && !x.deleted_at) : []);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;

/**
 * La DEMANDA: cuánto pide el presupuesto de cada insumo canónico.
 *
 * Un mismo insumo vive en muchas partidas (el cemento de Miraflores está en
 * 191) y hay que sumarlas: la obra necesita el total, no el de una partida.
 * `en_partidas` se conserva porque es lo que explica de dónde sale un número
 * grande cuando alguien lo pone en duda.
 */
export function demandaDeObra(insumosPartida = [], { tipos = null } = {}) {
  const porCodigo = new Map();
  for (const ip of vivos(insumosPartida)) {
    const cod = ip.insumo_codigo && String(ip.insumo_codigo).trim();
    if (!cod) continue;
    if (tipos && !tipos.includes(ip.tipo_insumo)) continue;
    const e = porCodigo.get(cod) || {
      codigo: cod, nombre: ip.nombre_insumo || cod, unidad: ip.unidad || '',
      necesita: 0, enPartidas: 0, tipo_insumo: ip.tipo_insumo || null,
    };
    e.necesita += num(ip.cantidad_presupuestada);
    e.enPartidas += 1;
    if (!e.nombre && ip.nombre_insumo) e.nombre = ip.nombre_insumo;
    porCodigo.set(cod, e);
  }
  for (const e of porCodigo.values()) e.necesita = r2(e.necesita);
  return porCodigo;
}

/**
 * Una línea de comprobante llevada al catálogo canónico.
 * @returns {{codigo,cantidad,confirmado}|null|'sin_factor'}
 */
function lineaCanonica(it, mapeos, grupoDe, porGrupo, { incluirPropuestas = false } = {}) {
  const desc = it?.descripcion || '';
  if (!desc) return null;
  const hit = buscarMapeo(desc, mapeos, grupoDe, porGrupo);
  if (!hit) return null;
  const f = hit.fila;
  if (f.decision !== 'mapeado' || !f.insumo_codigo) return null;
  // Una propuesta del motor (`fuente: 'ia'|'regla'`) no cuenta como oferta
  // firme salvo que la pantalla lo pida explícitamente.
  const confirmado = f.fuente === 'manual';
  if (!confirmado && !incluirPropuestas) return null;
  const cant = cantidadCanonica(it.cantidad, f.factor);
  if (cant == null) return 'sin_factor';
  return { codigo: f.insumo_codigo, cantidad: cant, confirmado };
}

/**
 * El cuadro de abastecimiento de una obra.
 *
 * @param {Object} o
 * @param {Array}  o.insumosPartida  presupuesto de la obra.
 * @param {Array}  o.movs            comprobantes del grupo CON sus ítems.
 * @param {Map}    o.mapeos          `resolverMapeos(insumo_mapeo)`.
 * @param {Map}    [o.grupoDe]       correlaciones: norm → grupo.
 * @param {Map}    [o.porGrupo]      grupo → mapeo (para heredar decisiones).
 * @param {string} o.titularId       la ejecutora de la obra.
 * @param {Array}  [o.companies]     catálogo, para nombrar a quién tiene qué.
 * @param {boolean}[o.incluirPropuestas=false]
 *
 * @returns {{filas:Array, resumen:Object}}
 */
export function abastecimientoDeObra({
  insumosPartida = [], movs = [], mapeos = new Map(),
  grupoDe = null, porGrupo = null, titularId = null, companies = [],
  ordenes = [], ocItems = [],
  incluirPropuestas = false, tipos = ['material'],
} = {}) {
  const demanda = demandaDeObra(insumosPartida, { tipos });
  const nombreEmpresa = new Map(vivos(companies).map(c => [c.id, c.name || c.legal_name || '(sin nombre)']));

  // codigo → { comprado, porEmpresa: Map<companyId, {compro, vendio}> }
  const oferta = new Map();
  const getOf = (cod) => {
    let e = oferta.get(cod);
    if (!e) { e = { comprado: 0, porEmpresa: new Map() }; oferta.set(cod, e); }
    return e;
  };
  let sinFactor = 0, lineasLeidas = 0, lineasMapeadas = 0, lineasPropuestas = 0;

  for (const m of vivos(movs)) {
    if (m.payment_status === 'cancelled') continue;
    const esCompra = esCompraMov(m);
    const esVenta = esVentaMov(m);
    if (!esCompra && !esVenta) continue;
    const items = itemsDeFactura(m);
    if (!items.length) continue;

    for (const it of items) {
      lineasLeidas++;
      const c = lineaCanonica(it, mapeos, grupoDe, porGrupo, { incluirPropuestas });
      if (c === 'sin_factor') { sinFactor++; continue; }
      if (!c) continue;
      lineasMapeadas++;
      if (!c.confirmado) lineasPropuestas++;
      if (!demanda.has(c.codigo)) continue;   // el presupuesto no lo pide: no es abastecimiento

      const of = getOf(c.codigo);
      const esDelTitular = !!titularId && m.company_id === titularId;

      if (esDelTitular) {
        // La ejecutora comprando: suma a «ya comprado». Si la ejecutora
        // vendiera (raro), resta de lo suyo.
        of.comprado += esCompra ? c.cantidad : -c.cantidad;
        continue;
      }
      const k = m.company_id || 'sin_empresa';
      const e = of.porEmpresa.get(k) || { company_id: m.company_id || null, compro: 0, vendio: 0 };
      if (esCompra) e.compro += c.cantidad; else e.vendio += c.cantidad;
      of.porEmpresa.set(k, e);
    }
  }

  // ── LO YA COMPROMETIDO POR UNA ORDEN ────────────────────────────
  // Una orden emitida reserva unidades que TODAVÍA no se facturaron: la venta
  // que las descontaría llega después. Sin restarlas aquí, volver a esta
  // pantalla mostraría las mismas 318 bolsas de GASOMI como disponibles y la
  // siguiente orden las comprometería otra vez.
  //
  // Solo cuentan las órdenes VIVAS y SIN comprobante: una anulada libera lo
  // que reservaba (aunque no libere su número), y una que ya tiene factura
  // vinculada ya se está descontando por el lado de las ventas — restarla dos
  // veces haría desaparecer stock que sí existe.
  const comprometido = new Map();   // `${companyId}|${codigo}` → cantidad
  const ordenesVivas = new Set(
    vivos(ordenes)
      .filter(o => o.estado !== 'anulada' && o.estado !== 'cancelada' && !o.accounting_movement_id)
      .map(o => o.id)
  );
  for (const it of vivos(ocItems)) {
    if (!ordenesVivas.has(it.orden_compra_id)) continue;
    const cod = it.insumo_codigo && String(it.insumo_codigo).trim();
    const emp = it.proveedor_company_id;
    if (!cod || !emp) continue;   // línea de una orden retroactiva: no reserva stock
    const k = `${emp}|${cod}`;
    comprometido.set(k, (comprometido.get(k) || 0) + num(it.cantidad));
  }

  const filas = [];
  for (const d of demanda.values()) {
    const of = oferta.get(d.codigo) || { comprado: 0, porEmpresa: new Map() };
    const yaComprado = Math.max(0, r2(of.comprado));
    const porEmpresa = [...of.porEmpresa.values()]
      // Una empresa no puede ofrecer lo que ya vendió. Si vendió más de lo que
      // compró, su disponible es cero, no negativo: el faltante de esa empresa
      // no es oferta de otra.
      .map(e => ({
        ...e,
        nombre: nombreEmpresa.get(e.company_id) || '(sin empresa)',
        comprometido: r2(comprometido.get(`${e.company_id}|${d.codigo}`) || 0),
        disponible: Math.max(0, r2(e.compro - e.vendio - (comprometido.get(`${e.company_id}|${d.codigo}`) || 0))),
      }))
      .filter(e => e.disponible > 0)
      .sort((a, b) => b.disponible - a.disponible);
    const disponible = r2(porEmpresa.reduce((s, e) => s + e.disponible, 0));
    const falta = Math.max(0, r2(d.necesita - yaComprado - disponible));
    filas.push({ ...d, yaComprado, disponible, porEmpresa, falta, cubierto: d.necesita > 0 ? Math.min(1, (yaComprado + disponible) / d.necesita) : 0 });
  }

  filas.sort((a, b) => b.falta - a.falta || b.necesita - a.necesita);

  return {
    filas,
    resumen: {
      insumos: filas.length,
      conOferta: filas.filter(f => f.yaComprado > 0 || f.disponible > 0).length,
      conDisponibleEnGrupo: filas.filter(f => f.disponible > 0).length,
      sinFactor, lineasLeidas, lineasMapeadas, lineasPropuestas,
      ordenesQueReservan: ordenesVivas.size,
      // ── CUÁNTO FALTA MAPEAR ───────────────────────────────────────
      // Gabriel, 6-set-2026: «mapeé dos y luego ahora corroboro y ya no me
      // sale el mensaje de mapeo, y pienso que todavía me debería salir
      // porque es importante hacer el mapeo completo».
      //
      // Tenía razón y el error era mío: el cartel se apagaba con `mapeos.size
      // > 0`, o sea con UNA sola decisión. Lo que importa no es si hay
      // mapeos, es qué PROPORCIÓN de las líneas se está pudiendo leer. Con 2
      // de 1.875 descripciones, el cuadro sigue siendo casi todo ciego y hay
      // que decirlo.
      cobertura: lineasLeidas ? lineasMapeadas / lineasLeidas : 0,
      hayMapeos: mapeos instanceof Map ? mapeos.size > 0 : false,
      titularId,
    },
  };
}

/**
 * Lo que hay que pedirle a UNA empresa del grupo, a partir de lo seleccionado
 * en la pantalla. Es el puente hacia la orden que nace antes del comprobante.
 *
 * Nunca deja pedir más de lo que esa empresa tiene disponible: el tope es su
 * `disponible`, y lo que la obra todavía necesita. Sin este tope una orden
 * podría comprometer stock inexistente y el descuento del inventario quedaría
 * en negativo.
 */
export function lineasParaOrden(filas, seleccion = {}) {
  const out = [];
  for (const f of (filas || [])) {
    const sel = seleccion[f.codigo];
    if (!sel) continue;
    for (const [companyId, cantidadPedida] of Object.entries(sel)) {
      const e = (f.porEmpresa || []).find(x => (x.company_id || 'sin_empresa') === companyId);
      if (!e) continue;
      const tope = Math.min(e.disponible, Math.max(0, f.necesita - f.yaComprado));
      const cantidad = Math.min(num(cantidadPedida), tope);
      if (cantidad <= 0) continue;
      out.push({
        insumo_codigo: f.codigo,
        nombre: f.nombre,
        unidad: f.unidad,
        cantidad: r2(cantidad),
        company_id: e.company_id,
        empresa: e.nombre,
        topeDisponible: e.disponible,
      });
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// LOS DOS BLOQUES DE AYUDA PARA ARMAR UNA ORDEN (tanda 7, entrega 6d)
//
// EL PEDIDO, de la jefa de contabilidad a través de Gabriel (6-set-2026):
//
//   «Le gustaría que tenga una ventana de ayuda donde pueda visualizar qué se
//    está necesitando, y ella pueda ir agregando en el detalle de la compra un
//    insumo de la partida, que se cargue la descripción real, la unidad, y que
//    sea editable […] Por otro lado va a tener un cuadrito donde pueda buscar
//    cemento y que le haga las referencias de compras que más se vinculen con
//    el nombre.»
//
// ── LA IDEA QUE LO CAMBIA TODO ────────────────────────────────────
// Gabriel: «el mapeo lo vamos a lograr aquí cuando la contadora lo haga
// manualmente». Y tiene toda la razón: pedirle a alguien que se siente a mapear
// 1.875 descripciones sueltas es un trabajo que nadie termina. Pero mientras
// arma una orden, ella YA está haciendo esa decisión —«necesito CEMENTO
// PORTLAND del presupuesto y se lo compro a GASOMI, que tiene esto»— y el mapeo
// sale de regalo, sin una tarea aparte.
//
// Por eso estas dos búsquedas NO dependen del mapeo: si dependieran, no
// servirían justo cuando hacen falta (al 6-set-2026 el mapeo cubre el 1%).
// La de la izquierda lee el presupuesto; la de la derecha lee el texto crudo de
// las facturas. El mapeo es la CONSECUENCIA de usarlas, no su requisito.
// ═══════════════════════════════════════════════════════════════════

/** Normaliza para buscar: sin tildes, sin puntuación, en minúsculas. */
const normBusca = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Cuántas de las palabras buscadas aparecen en el texto (0..1). */
function relevancia(texto, palabras) {
  if (!palabras.length) return 1;
  const t = ` ${normBusca(texto)} `;
  let hits = 0;
  for (const p of palabras) if (t.includes(p)) hits++;
  return hits / palabras.length;
}

/**
 * BLOQUE IZQUIERDO — qué necesita la obra.
 *
 * Sale del cuadro de abastecimiento que ya se calcula, así que trae de una vez
 * cuánto pide el presupuesto, cuánto compró la ejecutora y cuánto falta. Lo
 * que se elige acá entra al detalle de la orden con la descripción del
 * PRESUPUESTO —que es la que la contadora reconoce— y editable, porque el
 * proveedor casi nunca la escribe igual.
 */
export function buscarEnPresupuesto(filas, texto = '', { limite = 12, soloFaltantes = false } = {}) {
  const palabras = normBusca(texto).split(' ').filter(Boolean);
  const out = [];
  for (const f of (filas || [])) {
    if (soloFaltantes && f.falta <= 0) continue;
    const r = relevancia(`${f.nombre} ${f.codigo}`, palabras);
    if (palabras.length && r === 0) continue;
    out.push({ ...f, relevancia: r });
  }
  // Lo más parecido primero; a igual parecido, lo que más falta.
  out.sort((a, b) => b.relevancia - a.relevancia || b.falta - a.falta);
  return out.slice(0, limite);
}

/**
 * BLOQUE DERECHO — qué compraron las empresas del grupo, por TEXTO.
 *
 * Deliberadamente NO usa `insumo_mapeo`: busca sobre la descripción cruda de
 * las facturas. Es lo que permite que sirva desde el primer día y que, al
 * elegir una, se pueda escribir el mapeo.
 *
 * Cada resultado es una DESCRIPCIÓN (no una factura): el mismo cemento aparece
 * en muchas facturas y lo que interesa es cuánto hay en total y en manos de
 * quién. Se descuenta lo vendido, igual que en el cuadro de abastecimiento:
 * nadie puede ofrecer dos veces la misma bolsa.
 *
 * @returns [{ descripcion, unidad, porEmpresa:[{company_id,nombre,disponible,comprado,vendido}],
 *             disponible, obraVinculada, relevancia }]
 */
export function buscarComprasDelGrupo({
  movs = [], texto = '', companies = [], titularId = null,
  obraId = null, limite = 12,
} = {}) {
  const palabras = normBusca(texto).split(' ').filter(Boolean);
  if (!palabras.length) return [];
  const nombreEmpresa = new Map(vivos(companies).map(c => [c.id, c.name || c.legal_name || '(sin nombre)']));
  // clave = descripción normalizada; se conserva un texto de muestra legible.
  const porDesc = new Map();

  for (const m of vivos(movs)) {
    if (m.payment_status === 'cancelled') continue;
    const esCompra = esCompraMov(m), esVenta = esVentaMov(m);
    if (!esCompra && !esVenta) continue;
    // La ejecutora no se ofrece a sí misma: lo suyo ya está en «ya comprado».
    if (titularId && m.company_id === titularId) continue;
    for (const it of itemsDeFactura(m)) {
      const desc = String(it?.descripcion || '').trim();
      if (!desc) continue;
      const r = relevancia(desc, palabras);
      if (r === 0) continue;
      const k = normBusca(desc);
      let e = porDesc.get(k);
      if (!e) {
        e = { descripcion: desc, unidad: it.unidad || '', relevancia: r, obraVinculada: false, porEmpresa: new Map() };
        porDesc.set(k, e);
      }
      if (r > e.relevancia) { e.relevancia = r; e.descripcion = desc; }
      // Que la compra esté vinculada a ESTA obra es una señal fuerte: alguien
      // ya dijo «esto es para acá», aunque todavía no haya papel que lo pruebe.
      if (obraId && m.obra_id === obraId) e.obraVinculada = true;
      const ck = m.company_id || 'sin_empresa';
      const c = e.porEmpresa.get(ck) || { company_id: m.company_id || null, comprado: 0, vendido: 0 };
      if (esCompra) c.comprado += num(it.cantidad); else c.vendido += num(it.cantidad);
      e.porEmpresa.set(ck, c);
    }
  }

  const out = [];
  for (const e of porDesc.values()) {
    const porEmpresa = [...e.porEmpresa.values()]
      .map(c => ({
        ...c,
        nombre: nombreEmpresa.get(c.company_id) || '(sin empresa)',
        comprado: r2(c.comprado), vendido: r2(c.vendido),
        disponible: Math.max(0, r2(c.comprado - c.vendido)),
      }))
      .filter(c => c.disponible > 0)
      .sort((a, b) => b.disponible - a.disponible);
    if (!porEmpresa.length) continue;
    out.push({
      descripcion: e.descripcion,
      unidad: e.unidad,
      relevancia: e.relevancia,
      obraVinculada: e.obraVinculada,
      porEmpresa,
      disponible: r2(porEmpresa.reduce((s, c) => s + c.disponible, 0)),
    });
  }
  // Lo más parecido primero; después lo que ya está vinculado a la obra (es
  // más probable que sea lo que se busca) y por último lo que más hay.
  out.sort((a, b) => b.relevancia - a.relevancia
    || (b.obraVinculada ? 1 : 0) - (a.obraVinculada ? 1 : 0)
    || b.disponible - a.disponible);
  return out.slice(0, limite);
}

/**
 * El mapeo que queda IMPLÍCITO cuando la contadora arma una línea eligiendo un
 * insumo del presupuesto y una compra del grupo.
 *
 * Devuelve la fila lista para `insumo_mapeo`, o null si falta una de las dos
 * mitades. La pantalla decide si escribirla; esta función solo dice qué diría.
 *
 * `fuente: 'manual'` a propósito: no es una propuesta de un motor, es la
 * decisión de una persona haciendo su trabajo — y por eso manda sobre
 * cualquier sugerencia automática al resolver (manual > ia > regla).
 */
export function mapeoImplicito({ descripcionCompra, insumoCodigo, unidadCompra, unidadInsumo, factor = null, nota = null } = {}) {
  const desc = String(descripcionCompra || '').trim();
  if (!desc || !insumoCodigo) return null;
  return {
    norm: normMapeo(desc),
    muestra: desc.slice(0, 200),
    decision: 'mapeado',
    insumo_codigo: String(insumoCodigo),
    factor: factor == null ? null : Number(factor),
    factor_fuente: factor == null ? null : 'manual',
    unidad_origen: unidadCompra || null,
    unidad_destino: unidadInsumo || null,
    fuente: 'manual',
    nota: nota || 'Decidido al armar una orden de compra',
  };
}
