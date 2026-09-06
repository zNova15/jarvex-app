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
import { buscarMapeo, cantidadCanonica } from './mapeo-insumos.js';
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
  // que las descontaría llega después. Sin restarlas acá, volver a esta
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
