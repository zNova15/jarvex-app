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
import { clasificarInsumo, TIPO_INSUMO_LABEL } from './insumo-clasificador.js';
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
      const c = e.porEmpresa.get(ck) || { company_id: m.company_id || null, comprado: 0, vendido: 0, compras: [] };
      if (esCompra) {
        c.comprado += num(it.cantidad);
        // El DETALLE que pidió Gabriel: «un desplegable de detalles, como la
        // fecha de las facturas que compraron cemento y también el precio
        // unitario». Solo de las COMPRAS: el precio al que la empresa lo
        // compró es lo que sirve para negociar; a cuánto se lo vendió a otro
        // es su margen, y no es asunto de quien está armando la orden.
        c.compras.push({
          fecha: String(m.date || ''),
          documento: m.document_number || null,
          cantidad: num(it.cantidad),
          precio_unitario: num(it.precio_unitario) || null,
          descripcion: desc,
        });
      } else c.vendido += num(it.cantidad);
      e.porEmpresa.set(ck, c);
    }
  }

  const out = [];
  for (const e of porDesc.values()) {
    const porEmpresa = [...e.porEmpresa.values()]
      .map(c => {
        // Lo más reciente primero: el precio que sirve es el último, no el
        // promedio de dos años (mismo criterio que sugerir-descripcion.js).
        const compras = c.compras.slice().sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
        const conPrecio = compras.find(x => x.precio_unitario > 0) || null;
        return {
          ...c,
          compras,
          ultimoPrecio: conPrecio ? r2(conPrecio.precio_unitario) : null,
          ultimoPrecioFecha: conPrecio ? conPrecio.fecha : '',
          ultimaFecha: compras[0]?.fecha || '',
          nombre: nombreEmpresa.get(c.company_id) || '(sin empresa)',
          comprado: r2(c.comprado), vendido: r2(c.vendido),
          disponible: Math.max(0, r2(c.comprado - c.vendido)),
        };
      })
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

/**
 * LO MISMO, PERO VISTO POR EMPRESA (tanda 9).
 *
 * Gabriel, 7-set-2026: «me gustaría que se pudiera mostrar por bloque (opción
 * seleccionable) de tal manera que me salgan el bloque de cemento que compró
 * GASOMI (aunque sean con diferentes nombres), y un desplegable de detalles,
 * como la fecha de las facturas que compraron cemento y también el precio
 * unitario».
 *
 * `buscarComprasDelGrupo` devuelve una fila por DESCRIPCIÓN, y en producción el
 * mismo cemento está escrito de cuatro formas: la lista sale con «CEMENTO SOL»,
 * «CEMENTO HOLCIM», «CEMENTO INKA» y «cemento extra forte» sueltas, cada una con
 * su chip de empresa. Para decidir a quién comprarle eso está al revés: la
 * pregunta es «¿cuánto cemento tiene GASOMI, se llame como se llame?».
 *
 * Esto pivotea. NO cambia ni un número: agrupa lo que ya vino. Y las
 * descripciones NO se fusionan entre sí —siguen listadas una por una dentro de
 * cada empresa— porque decir que cuatro nombres son el mismo insumo es una
 * decisión de mapeo, y ésa la toma una persona (ver mapeoImplicito). Sumar el
 * total por empresa es distinto: ahí sí se suma lo que el buscador ya dijo que
 * se parece a lo mismo, y por eso el total viaja como `disponibleBusqueda` —
 * «de lo que buscaste», no «de este insumo».
 *
 * @returns [{ company_id, nombre, disponibleBusqueda, items:[...], ultimaFecha }]
 */
export function ofertaPorEmpresa(resultados = []) {
  const porEmpresa = new Map();
  for (const r of (resultados || [])) {
    for (const c of (r.porEmpresa || [])) {
      const k = c.company_id || 'sin_empresa';
      let e = porEmpresa.get(k);
      if (!e) {
        e = { company_id: c.company_id || null, nombre: c.nombre, disponibleBusqueda: 0, items: [], ultimaFecha: '' };
        porEmpresa.set(k, e);
      }
      e.disponibleBusqueda += num(c.disponible);
      if (c.ultimaFecha > e.ultimaFecha) e.ultimaFecha = c.ultimaFecha;
      e.items.push({
        descripcion: r.descripcion,
        unidad: r.unidad || '',
        obraVinculada: !!r.obraVinculada,
        comprado: c.comprado, vendido: c.vendido, disponible: c.disponible,
        ultimoPrecio: c.ultimoPrecio, ultimoPrecioFecha: c.ultimoPrecioFecha,
        compras: c.compras || [],
      });
    }
  }
  const out = [...porEmpresa.values()];
  for (const e of out) {
    e.disponibleBusqueda = r2(e.disponibleBusqueda);
    e.items.sort((a, b) => b.disponible - a.disponible);
  }
  // La que más tiene primero: es a la que más sentido tiene pedirle.
  return out.sort((a, b) => b.disponibleBusqueda - a.disponibleBusqueda);
}

// ═══════════════════════════════════════════════════════════════════
//  EL CATÁLOGO DEL GRUPO, POR EMPRESA Y POR FAMILIA (tanda 13)
//
//  EL PEDIDO (Gabriel, 7-set-2026): «me gustaría que le agreguemos la parte de
//  ordenarlo por empresa: ¿qué tiene JARVEX? De tal manera que veamos, ah,
//  mira, JARVEX ha comprado un montón de herramientas […] entonces ya podemos
//  decir, ok, vamos a hacerle una orden a JARVEX por todo lo que es
//  herramientas».
//
//  Lo que había (tanda 9) pivoteaba por empresa PERO seguía colgado del
//  buscador: sin escribir una palabra el bloque decía «escribe qué estás
//  buscando», y para descubrir que JARVEX tiene herramientas hay que saber
//  antes que las tiene. Esto invierte la pregunta: primero se ve el inventario
//  del grupo entero, empresa por empresa y familia por familia, y recién ahí
//  se elige.
//
//  MEDIDO CONTRA PRODUCCIÓN el 7-set-2026 (2.863 líneas de factura vivas):
//    JARVEX  → herramienta 54 líneas, material 176, servicio 72, maquinaria 4
//    GASOMI  → material 586, servicio 91, herramienta 19, epp 25
//  o sea que el `tipo_insumo` que ya viaja en cada línea alcanza para armar
//  esto sin pedirle nada nuevo a nadie. Cuando la línea no lo trae (facturas
//  viejas), se cae a `clasificarInsumo(descripcion)`, el mismo criterio que usa
//  el almacén.
//
//  ⚠️ LAS CANTIDADES NO SE SUMAN ENTRE FAMILIAS NI DENTRO DE ELLAS: 30 palanas
//  y 12 galones de aceite no son 42 de nada (misma regla que
//  inventario-empresa.js). Lo que sí se suma a nivel familia es la PLATA, y por
//  eso el bloque se ordena y se rotula en soles. Las cantidades viven donde
//  significan algo: en cada ítem, con su unidad al lado.
// ═══════════════════════════════════════════════════════════════════

// El orden en que se muestran: primero lo que se compra por cantidad y termina
// en un almacén, al final lo que no tiene stock que ofrecer.
const FAMILIAS = ['material', 'herramienta', 'epp', 'maquinaria', 'servicio'];
const ORDEN_FAMILIA = new Map(FAMILIAS.map((f, i) => [f, i]));

/** La familia de una línea de factura: la que trae, o la que dice su nombre. */
export function familiaDeItem(it) {
  const t = String(it?.tipo_insumo || '').trim();
  if (ORDEN_FAMILIA.has(t)) return t;
  return clasificarInsumo(it?.descripcion || '');
}

/**
 * TODO lo que tienen las empresas del grupo, sin buscar nada.
 *
 * Mismo criterio de disponible que `buscarComprasDelGrupo` —comprado menos
 * vendido, nunca negativo— y mismas exclusiones: anulados fuera, y la ejecutora
 * de la obra no se ofrece a sí misma (lo suyo ya está en «ya comprado»).
 *
 * @param {Object} o
 * @param {Array}  o.movs        comprobantes del grupo CON sus ítems.
 * @param {Array}  [o.companies] catálogo, para poner nombres.
 * @param {string} [o.titularId] la ejecutora de la obra, que se excluye.
 * @param {string} [o.obraId]    para marcar lo que ya está vinculado a la obra.
 * @param {string} [o.companyId] acotar a UNA empresa (la destinataria elegida).
 * @param {number} [o.minMonto]  ruido de fondo: ítems por debajo no se listan.
 *
 * @returns [{ company_id, nombre, montoDisponible, nItems, familias:[
 *             { familia, label, montoDisponible, nItems, items:[...] } ] }]
 */
export function catalogoDelGrupo({
  movs = [], companies = [], titularId = null, obraId = null,
  companyId = null, minMonto = 0,
} = {}) {
  const nombreEmpresa = new Map(vivos(companies).map(c => [c.id, c.name || c.legal_name || '(sin nombre)']));
  // `${companyId}|${descripcion normalizada}` → acumulado
  const porItem = new Map();

  for (const m of vivos(movs)) {
    if (m.payment_status === 'cancelled') continue;
    const esCompra = esCompraMov(m), esVenta = esVentaMov(m);
    if (!esCompra && !esVenta) continue;
    if (titularId && m.company_id === titularId) continue;
    if (companyId && m.company_id !== companyId) continue;
    for (const it of itemsDeFactura(m)) {
      const desc = String(it?.descripcion || '').trim();
      if (!desc) continue;
      const k = `${m.company_id || 'sin_empresa'}|${normBusca(desc)}`;
      let e = porItem.get(k);
      if (!e) {
        e = {
          company_id: m.company_id || null, descripcion: desc, unidad: it.unidad || '',
          familia: familiaDeItem(it), comprado: 0, vendido: 0, compras: [], obraVinculada: false,
        };
        porItem.set(k, e);
      }
      if (obraId && m.obra_id === obraId) e.obraVinculada = true;
      if (esCompra) {
        e.comprado += num(it.cantidad);
        e.compras.push({
          fecha: String(m.date || ''),
          documento: m.document_number || null,
          cantidad: num(it.cantidad),
          precio_unitario: num(it.precio_unitario) || null,
          descripcion: desc,
        });
      } else e.vendido += num(it.cantidad);
    }
  }

  const porEmpresa = new Map();
  for (const e of porItem.values()) {
    const disponible = Math.max(0, r2(e.comprado - e.vendido));
    if (disponible <= 0) continue;
    // Lo más reciente primero: el precio que sirve es el último, no el promedio
    // de dos años (mismo criterio que sugerir-descripcion.js).
    const compras = e.compras.slice().sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    const conPrecio = compras.find(x => x.precio_unitario > 0) || null;
    const ultimoPrecio = conPrecio ? r2(conPrecio.precio_unitario) : null;
    // Valorizado al último precio conocido. Sin precio NO se inventa un cero
    // disfrazado: el ítem se lista igual, marcado `sinPrecio`, porque existe.
    const montoDisponible = ultimoPrecio != null ? r2(disponible * ultimoPrecio) : 0;
    if (minMonto && montoDisponible < minMonto) continue;
    const item = {
      descripcion: e.descripcion, unidad: e.unidad, familia: e.familia,
      comprado: r2(e.comprado), vendido: r2(e.vendido), disponible,
      ultimoPrecio, ultimoPrecioFecha: conPrecio ? conPrecio.fecha : '',
      ultimaFecha: compras[0]?.fecha || '',
      sinPrecio: ultimoPrecio == null,
      montoDisponible, obraVinculada: e.obraVinculada, compras,
    };
    const ck = e.company_id || 'sin_empresa';
    let emp = porEmpresa.get(ck);
    if (!emp) {
      emp = {
        company_id: e.company_id || null,
        nombre: nombreEmpresa.get(e.company_id) || '(sin empresa)',
        montoDisponible: 0, nItems: 0, familias: new Map(),
      };
      porEmpresa.set(ck, emp);
    }
    let fam = emp.familias.get(e.familia);
    if (!fam) {
      fam = { familia: e.familia, label: TIPO_INSUMO_LABEL[e.familia] || e.familia, montoDisponible: 0, nItems: 0, items: [] };
      emp.familias.set(e.familia, fam);
    }
    fam.items.push(item);
    fam.nItems += 1;
    fam.montoDisponible += montoDisponible;
    emp.nItems += 1;
    emp.montoDisponible += montoDisponible;
  }

  const out = [...porEmpresa.values()].map(emp => ({
    ...emp,
    montoDisponible: r2(emp.montoDisponible),
    familias: [...emp.familias.values()]
      .map(f => ({ ...f, montoDisponible: r2(f.montoDisponible), items: f.items.sort((a, b) => b.montoDisponible - a.montoDisponible) }))
      .sort((a, b) => (ORDEN_FAMILIA.get(a.familia) ?? 9) - (ORDEN_FAMILIA.get(b.familia) ?? 9)),
  }));
  // La que más tiene primero: es a la que más sentido tiene pedirle.
  return out.sort((a, b) => b.montoDisponible - a.montoDisponible);
}

/**
 * Un bloque entero (todas las herramientas de JARVEX) convertido en líneas de
 * orden, ya enlazadas al insumo del presupuesto que la persona eligió.
 *
 * La cantidad arranca en TODO lo disponible y el precio en el último conocido:
 * las dos son editables en el detalle. El `insumo_codigo` es lo que hace que
 * esta orden después cuente como consumo del presupuesto — es el mapeo que se
 * aprende trabajando, no una tarea aparte.
 */
export function lineasDeFamilia(items = [], { companyId = null, insumo = null } = {}) {
  return (items || []).map(it => ({
    descripcion: it.descripcion,
    unidad: it.unidad || 'UND',
    cantidad: it.disponible,
    precio_unitario: it.ultimoPrecio != null ? it.ultimoPrecio : '',
    origen_company_id: companyId ?? it.company_id ?? null,
    origen_descripcion: it.descripcion,
    origen_unidad: it.unidad || null,
    tope: it.disponible,
    insumo_codigo: insumo?.codigo || null,
    insumo_nombre: insumo?.nombre || null,
    insumo_unidad: insumo?.unidad || null,
  }));
}

// ═══════════════════════════════════════════════════════════════════
//  LOS INSUMOS QUE EL PRESUPUESTO MIDE EN PLATA, NO EN CANTIDAD
//
//  Gabriel: «si revisas dentro de los insumos del presupuesto de Miraflores,
//  sale herramientas manuales; entonces ahí como que cuadra, y se va rellenando
//  una parte del consumo de lo que se está presupuestando».
//
//  Cuadra, pero NO por cantidad. Medido en producción el 7-set-2026, el insumo
//  370020009 «HERRAMIENTAS MANUALES» de Miraflores está en 1.115 partidas con
//  unidad **%mo** —un porcentaje de la mano de obra, el 3% del análisis de
//  precios unitarios— y la suma de sus cantidades da 33,34, que no son 33
//  martillos ni 33 de nada. Sumarlas y mostrar «necesita 33,34 %mo» es
//  aritmética sin sentido puesta en pantalla.
//
//  Lo que SÍ significa algo es la plata: esas 1.115 filas presupuestan
//  S/ 132.492,97 sobre una mano de obra de S/ 4.474.595,11. Contra eso se
//  compara una orden de herramientas a JARVEX, y por eso el avance de estos
//  insumos se mide en soles.
// ═══════════════════════════════════════════════════════════════════

/** ¿La unidad de este insumo es un porcentaje (%mo, %MO, %EQ)? */
export const esUnidadPorcentual = (u) => /^\s*%/.test(String(u || ''));

/**
 * Los insumos del presupuesto que se controlan por MONTO, con lo que ya está
 * cubierto por órdenes emitidas.
 *
 * `cubierto` sale de las ÓRDENES, no de las facturas, y a propósito: medido el
 * 7-set-2026, ninguna de las 2.863 líneas de factura de la base trae
 * `insumo_codigo` —la factura la escribe el proveedor, no el presupuesto— y en
 * cambio la orden nace acá adentro con el insumo ya elegido. Es lo que hace que
 * el cuadro se llene desde la primera orden que se emita así.
 *
 * @returns [{ codigo, nombre, unidad, presupuestado, cubierto, falta, partidas }]
 */
export function insumosPorMonto({
  insumosPartida = [], ordenes = [], ocItems = [], obraId = null,
} = {}) {
  const porCodigo = new Map();
  for (const ip of vivos(insumosPartida)) {
    const cod = ip.insumo_codigo && String(ip.insumo_codigo).trim();
    if (!cod || !esUnidadPorcentual(ip.unidad)) continue;
    const e = porCodigo.get(cod) || {
      codigo: cod, nombre: ip.nombre_insumo || cod, unidad: ip.unidad || '',
      tipo_insumo: ip.tipo_insumo || null, presupuestado: 0, partidas: 0,
    };
    e.presupuestado += num(ip.costo_presupuestado);
    e.partidas += 1;
    porCodigo.set(cod, e);
  }
  if (!porCodigo.size) return [];

  // Mismo criterio de «orden viva» que el cuadro de abastecimiento: una anulada
  // no cubre nada, y una que ya tiene su factura tampoco cuenta dos veces.
  const vivas = new Set(
    vivos(ordenes)
      .filter(o => o.estado !== 'anulada' && o.estado !== 'cancelada')
      .filter(o => !obraId || o.obra_id === obraId)
      .map(o => o.id)
  );
  const cubierto = new Map();
  for (const it of vivos(ocItems)) {
    if (!vivas.has(it.orden_compra_id)) continue;
    const cod = it.insumo_codigo && String(it.insumo_codigo).trim();
    if (!cod || !porCodigo.has(cod)) continue;
    cubierto.set(cod, (cubierto.get(cod) || 0) + num(it.cantidad) * num(it.precio_unitario));
  }

  return [...porCodigo.values()].map(e => {
    const cub = r2(cubierto.get(e.codigo) || 0);
    const presupuestado = r2(e.presupuestado);
    return {
      ...e, presupuestado, cubierto: cub,
      falta: Math.max(0, r2(presupuestado - cub)),
      avance: presupuestado > 0 ? Math.min(1, cub / presupuestado) : 0,
    };
  }).sort((a, b) => b.presupuestado - a.presupuestado);
}

// Qué familia de compra le corresponde a cada insumo por monto, para
// proponerlo solo: «herramientas manuales» ↔ las herramientas del grupo.
const FAMILIA_POR_NOMBRE = [
  [/herramienta/i, 'herramienta'],
  [/equipo|maquinaria|maquina/i, 'maquinaria'],
  [/epp|seguridad|implemento/i, 'epp'],
];

/** El insumo por monto que mejor le calza a una familia de compras, si hay. */
export function insumoParaFamilia(familia, insumosMonto = []) {
  for (const ins of (insumosMonto || [])) {
    for (const [re, fam] of FAMILIA_POR_NOMBRE) {
      if (fam === familia && re.test(ins.nombre || '')) return ins;
    }
  }
  return null;
}
