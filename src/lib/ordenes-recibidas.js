// ═══════════════════════════════════════════════════════════════════
// JARVEX — EL BUZÓN DE ÓRDENES RECIBIDAS (tanda 8, entrega 3). Mig 186.
//
// EL PEDIDO (Gabriel, 6-set-2026):
//   «tenemos que tener una sección de órdenes de compra y servicio donde diga
//    ORDEN RECIBIDA, y podamos ver las órdenes recibidas para cada una de
//    nuestras empresas, como si fuera su propio buzón de la empresa, y tengamos
//    la opción de revisar, en este caso, cruzar con nuestro inventario de la
//    empresa, corroborar que tenemos los insumos, tal vez no con el mismo
//    nombre, pero podemos enlazarlos […] y facilitarles la opción de generar la
//    factura. Tal vez con la edición del detalle del insumo con un nombre un
//    poquito distinto, tal vez no tenga todo, tal vez tenga más».
//
// ── LA MITAD QUE FALTABA ──────────────────────────────────────────
// Hasta acá una orden era un papel de UN solo lado: quien la emite la ve, la
// descarga y la firma. Pero cuando el destinatario es una de nuestras ocho
// empresas, esa orden es un PEDIDO que le llega — y la app no se lo decía a
// nadie. La contadora de GASOMI se enteraba por WhatsApp de que EL INCA le
// había emitido una orden, y facturaba mirando un PDF.
//
// El buzón es esa mitad: la misma fila de `ordenes_compra`, leída desde el otro
// lado (`proveedor_company_id`), con su propio carril de estado
// (`respuesta_estado`) para que las dos partes no se pisen.
//
// ── LO QUE ESTE ARCHIVO NO HACE, Y ES A PROPÓSITO ─────────────────
// No decide si la empresa PUEDE atender el pedido. Cruza, mide y avisa; la
// contadora decide. Tres razones, todas medidas:
//
//   1. El «inventario» de una empresa del grupo no es un almacén: es lo que
//      dicen sus facturas (comprado − vendido). Nadie descuenta consumo de obra
//      ahí, así que un «disponible» puede ser optimista.
//   2. Los nombres no coinciden — es literalmente lo que pidió Gabriel
//      («tal vez no con el mismo nombre»). Un match por texto es una PROPUESTA.
//   3. Una empresa puede facturar algo que todavía no compró (lo compra para
//      atender la orden). Bloquear por «no tienes stock» sería falso.
//
// ── EL CERO SILENCIOSO, OTRA VEZ ──────────────────────────────────
// Si una línea no encuentra nada en el inventario, esto NO devuelve
// `disponible: 0`. Devuelve `mejor: null` y la pantalla dice «no encontré nada
// parecido», que es la verdad. Un 0 se lee como «no tienes», y la diferencia
// entre «no tienes» y «no sé» es la que hace que alguien rechace un pedido que
// sí podía atender. Es la misma regla que ya está escrita en abastecimiento.js.
//
// Puro: sin React, sin Dexie. Testeado en __tests__/ordenes-recibidas.test.js
// ═══════════════════════════════════════════════════════════════════

import { itemsDeFactura } from './cruce-recepcion.js';
import { esCompraMov, esVentaMov } from './costo-obra.js';
import { normMapeo, tokensDe, buscarMapeo } from './mapeo-insumos.js';
import { totalesConModoIgv } from './precios-igv.js';

const vivos = (arr) => (Array.isArray(arr) ? arr.filter(x => x && !x.deleted_at) : []);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;

// ── EL CARRIL DE LA QUE RECIBE ─────────────────────────────────────
export const ESTADOS_RESPUESTA = ['pendiente', 'en_revision', 'aceptada', 'facturada', 'rechazada'];

export const RESPUESTA_LABEL = {
  pendiente: 'Sin revisar',
  en_revision: 'En revisión',
  aceptada: 'Aceptada',
  facturada: 'Facturada',
  rechazada: 'Rechazada',
};

export const RESPUESTA_BADGE = {
  pendiente: 'b-amber', en_revision: 'b-blue', aceptada: 'b-green',
  facturada: 'b-green', rechazada: 'b-red',
};

/** NULL en la base = nadie la tocó = pendiente. Ver el porqué en la mig 186. */
export function estadoRespuesta(orden) {
  const e = orden?.respuesta_estado;
  return ESTADOS_RESPUESTA.includes(e) ? e : 'pendiente';
}

/** Una orden ya cerrada del lado de la receptora no vuelve a pedir atención. */
export const respuestaCerrada = (o) => ['facturada', 'rechazada'].includes(estadoRespuesta(o));

/**
 * EL BUZÓN: las órdenes que le emitieron a esta empresa.
 *
 * Una orden ANULADA por quien la emitió desaparece del buzón aunque la
 * receptora no la haya tocado: pedirle que atienda un pedido retirado sería
 * hacerle perder el tiempo. Si ya la había facturado, en cambio, se queda —
 * ahí hay una factura emitida que alguien tiene que mirar.
 */
export function buzonDeEmpresa({
  ordenes = [], companyId = null, incluirCerradas = true, tipo = 'todos', texto = '',
} = {}) {
  if (!companyId) return [];
  const q = String(texto || '').trim().toLowerCase();
  const out = [];
  for (const o of vivos(ordenes)) {
    if (o.proveedor_company_id !== companyId) continue;
    const est = estadoRespuesta(o);
    const anuladaPorEmisor = ['anulada', 'cancelada'].includes(o.estado);
    if (anuladaPorEmisor && est !== 'facturada') continue;
    if (!incluirCerradas && respuestaCerrada(o)) continue;
    if (tipo !== 'todos' && (o.tipo || 'compra') !== tipo) continue;
    if (q && !(
      String(o.codigo || '').toLowerCase().includes(q)
      || String(o.titulo || '').toLowerCase().includes(q)
      || String(o.obra_descripcion || '').toLowerCase().includes(q)
    )) continue;
    out.push({ ...o, respuestaEstado: est, anuladaPorEmisor });
  }
  // Lo que espera respuesta primero; dentro de cada grupo, lo más reciente.
  const rango = { pendiente: 0, en_revision: 1, aceptada: 2, facturada: 3, rechazada: 4 };
  out.sort((a, b) => rango[a.respuestaEstado] - rango[b.respuestaEstado]
    || String(b.fecha || '').localeCompare(String(a.fecha || '')));
  return out;
}

/** Contadores del buzón, para el encabezado y el badge de la pestaña. */
export function resumenBuzon(ordenes = [], companyId = null) {
  const base = { total: 0, pendiente: 0, en_revision: 0, aceptada: 0, facturada: 0, rechazada: 0, montoPorAtender: 0 };
  if (!companyId) return base;
  for (const o of buzonDeEmpresa({ ordenes, companyId })) {
    base.total += 1;
    base[o.respuestaEstado] += 1;
    if (!respuestaCerrada(o)) base.montoPorAtender += num(o.monto_total);
  }
  base.montoPorAtender = r2(base.montoPorAtender);
  return base;
}

/**
 * EL INVENTARIO DE LA EMPRESA, LEÍDO DE SUS FACTURAS.
 *
 * No hay tabla de stock por empresa: el almacén es de OBRA. Lo que una empresa
 * «tiene» sale de restarle a sus compras lo que ya vendió — el mismo criterio
 * que usa el cuadro de abastecimiento, y por la misma razón: nadie puede
 * ofrecer dos veces la misma bolsa.
 *
 * `ultimoCosto` es lo que permite avisar «estarías vendiendo por debajo de lo
 * que te costó», que es el aviso que más plata cuida de todos los de acá.
 *
 * @returns Map(normMapeo(desc) → { descripcion, unidad, comprado, vendido, disponible, ultimoCosto, ultimaFecha, veces })
 */
export function inventarioTextualDeEmpresa({ movs = [], companyId = null } = {}) {
  const idx = new Map();
  if (!companyId) return idx;
  for (const m of vivos(movs)) {
    if (m.company_id !== companyId) continue;
    if (m.payment_status === 'cancelled') continue;
    const compra = esCompraMov(m), venta = esVentaMov(m);
    if (!compra && !venta) continue;
    for (const it of itemsDeFactura(m)) {
      const desc = String(it?.descripcion || '').trim();
      if (!desc) continue;
      const k = normMapeo(desc);
      if (!k) continue;
      let e = idx.get(k);
      if (!e) {
        e = {
          norm: k, descripcion: desc, unidad: it.unidad || '',
          comprado: 0, vendido: 0, veces: 0,
          ultimoCosto: null, ultimaFecha: '',
        };
        idx.set(k, e);
      }
      e.veces += 1;
      if (!e.unidad && it.unidad) e.unidad = it.unidad;
      if (compra) {
        e.comprado += num(it.cantidad);
        const p = num(it.precio_unitario);
        if (p > 0 && String(m.date || '') >= e.ultimaFecha) {
          e.ultimoCosto = r2(p);
          e.ultimaFecha = String(m.date || '');
        }
      } else {
        e.vendido += num(it.cantidad);
      }
    }
  }
  for (const e of idx.values()) {
    e.comprado = r2(e.comprado);
    e.vendido = r2(e.vendido);
    e.disponible = r2(Math.max(0, e.comprado - e.vendido));
  }
  return idx;
}

/**
 * ¿Qué tan parecidos son dos nombres de insumo?
 *
 * Jaccard sobre los tokens con contenido (`tokensDe` ya saca las palabras de
 * relleno y los números sueltos). Es deliberadamente simple: el motor bueno
 * —`puntuar()` de mapeo-insumos.js, con familias, magnitudes e IDF— trabaja
 * contra el CATÁLOGO CANÓNICO, y acá los dos lados son texto libre de factura.
 * Para «CEMENTO PORTLAND TIPO I» vs «CEMENTO SOL TIPO I 42.5KG» alcanza.
 *
 * @returns 0..1
 */
export function parecido(a, b) {
  const ta = new Set(tokensDe(normMapeo(a)));
  const tb = new Set(tokensDe(normMapeo(b)));
  if (!ta.size || !tb.size) return 0;
  let comunes = 0;
  for (const t of ta) if (tb.has(t)) comunes += 1;
  return comunes / (ta.size + tb.size - comunes);
}

// Debajo de esto no se propone nada: una coincidencia de un token suelto
// («SERVICIO», «ACERO») engancharía cualquier cosa con cualquier cosa.
export const UMBRAL_PARECIDO = 0.34;

/**
 * CRUZAR LA ORDEN CON EL INVENTARIO DE LA RECEPTORA.
 *
 * Por cada línea de la orden: qué tiene la empresa que se le parezca, cuánto,
 * y a qué le costó. Devuelve PROPUESTAS ordenadas, no una decisión — el enlace
 * lo confirma la contadora, y ese enlace es también una decisión de mapeo
 * (igual que al armar la orden: el mapeo se aprende trabajando).
 *
 * `mapeos` es opcional. Cuando está, dos descripciones que resuelven al MISMO
 * código canónico son un match duro y le ganan a cualquier parecido de texto:
 * ahí alguien ya dijo, a mano, que son lo mismo.
 *
 * @returns [{ item, candidatos, mejor, disponible, cubre, faltante }]
 */
export function cruzarOrdenConInventario({
  items = [], inventario = new Map(), mapeos = null, grupoDe = null, porGrupo = null, limite = 4,
} = {}) {
  const inv = [...inventario.values()];
  return (items || []).map(it => {
    const nombre = it.nombre || it.nombre_libre || '';
    const pedido = num(it.cantidad);
    const codigoPedido = it.insumo_codigo
      || (mapeos ? buscarMapeo(nombre, mapeos, grupoDe, porGrupo)?.fila?.insumo_codigo : null)
      || null;

    const candidatos = [];
    for (const e of inv) {
      const mismoCodigo = !!(codigoPedido && mapeos
        && buscarMapeo(e.descripcion, mapeos, grupoDe, porGrupo)?.fila?.insumo_codigo === codigoPedido);
      const sim = parecido(nombre, e.descripcion);
      if (!mismoCodigo && sim < UMBRAL_PARECIDO) continue;
      candidatos.push({
        ...e,
        parecido: r2(sim),
        porCodigo: mismoCodigo,
        // Solo tiene sentido hablar de «alcanza» si las dos hablan de la misma
        // unidad. Distinta unidad no es falta de stock: es que no sabemos.
        mismaUnidad: !e.unidad || !it.unidad
          ? null
          : String(e.unidad).toLowerCase() === String(it.unidad).toLowerCase(),
      });
    }
    candidatos.sort((a, b) => (b.porCodigo ? 1 : 0) - (a.porCodigo ? 1 : 0)
      || b.parecido - a.parecido || b.disponible - a.disponible);

    const mejor = candidatos[0] || null;
    const disponible = mejor ? mejor.disponible : null;
    return {
      item: it,
      nombre,
      pedido,
      candidatos: candidatos.slice(0, limite),
      mejor,
      disponible,
      // null = «no sé» (no encontré nada, o las unidades no se comparan).
      cubre: mejor && mejor.mismaUnidad !== false && pedido > 0
        ? disponible >= pedido
        : null,
      faltante: mejor && mejor.mismaUnidad !== false && pedido > 0
        ? r2(Math.max(0, pedido - disponible))
        : null,
    };
  });
}

/**
 * EL BORRADOR DE LA FACTURA que la receptora va a emitir.
 *
 * Arranca siendo la orden tal cual —eso es lo que le pidieron— y desde ahí se
 * edita: cambiar el nombre por el que la empresa usa, ajustar cantidades,
 * quitar lo que no puede atender, agregar lo que va de más. Todo eso lo pidió
 * Gabriel textualmente, y todo eso es EDICIÓN de este borrador, no otra pantalla.
 *
 * `nombreOrden` se conserva aparte de `nombre` a propósito: cuando la contadora
 * renombra una línea, hay que poder seguir mostrando qué decía el pedido. Sin
 * eso, quien reciba la factura no puede cuadrarla contra su propia orden.
 */
export function borradorDeFacturaDesdeOrden({ orden = null, items = [], cruce = null } = {}) {
  const porItem = new Map((cruce || []).map(c => [c.item?.id ?? c.item, c]));
  const lineas = (items || []).map((it, i) => {
    const c = porItem.get(it.id) || null;
    const nombreOrden = it.nombre || it.nombre_libre || '';
    return {
      key: it.id || `l${i}`,
      incluir: true,
      nombreOrden,
      // El nombre que la empresa usa, si ya lo enlazamos con su inventario.
      nombre: c?.mejor?.descripcion || nombreOrden,
      enlazadoA: c?.mejor?.norm || null,
      unidad: it.unidad || c?.mejor?.unidad || 'UND',
      cantidad: num(it.cantidad),
      cantidadPedida: num(it.cantidad),
      precio_unitario: num(it.precio_unitario),
      costoUnitario: c?.mejor?.ultimoCosto ?? null,
      disponible: c?.disponible ?? null,
      insumo_codigo: it.insumo_codigo || null,
    };
  });
  return {
    ordenId: orden?.id || null,
    codigoOrden: orden?.codigo || null,
    igvPct: Number(orden?.igv_pct ?? 18),
    fecha: null,
    lineas,
  };
}

/**
 * Totales del borrador. Solo cuentan las líneas incluidas.
 *
 * `igvIncluido` (tanda 9) dice si los precios que la contadora está escribiendo
 * ya traen IGV. Es la misma pregunta que en la orden, y por la misma razón: hay
 * proveedores que cotizan con IGV y otros sin él, y asumir uno corre el total un
 * 18 %.
 */
export function totalesDeBorrador(borrador) {
  return totalesConModoIgv(
    (borrador?.lineas || []).filter(l => l.incluir),
    { igvPct: Number(borrador?.igvPct ?? 18), preciosIncluyenIgv: !!borrador?.igvIncluido }
  );
}

/**
 * LO QUE HAY QUE MIRAR ANTES DE EMITIR.
 *
 * Avisos, no bloqueos. Ninguno impide facturar: los tres casos «raros» que
 * detectan son legítimos y pasan todo el tiempo (se compra para atender el
 * pedido, se factura de más porque el cliente pidió más, se vende al costo
 * dentro del grupo). Lo que no puede pasar es que ocurran SIN QUE NADIE LOS VEA.
 *
 * @returns [{ nivel:'alto'|'medio'|'info', clave, texto }]
 */
export function avisosDeFactura({ borrador = null, orden = null } = {}) {
  const avisos = [];
  const lineas = (borrador?.lineas || []).filter(l => l.incluir);
  const t = totalesDeBorrador(borrador);
  const totalOrden = num(orden?.monto_total);

  if (!lineas.length) {
    avisos.push({ nivel: 'alto', clave: 'sin_lineas', texto: 'No queda ninguna línea incluida: no hay nada que facturar.' });
    return avisos;
  }

  const sinEnlace = lineas.filter(l => !l.enlazadoA);
  if (sinEnlace.length) {
    avisos.push({
      nivel: 'info', clave: 'sin_enlace',
      texto: `${sinEnlace.length} línea(s) no se pudieron enlazar con nada que esta empresa haya comprado. No es un impedimento —se puede comprar para atender el pedido—, pero conviene mirarlas: ${sinEnlace.slice(0, 3).map(l => l.nombre).join(', ')}${sinEnlace.length > 3 ? '…' : ''}.`,
    });
  }

  const cortas = lineas.filter(l => l.disponible != null && l.cantidad > l.disponible);
  if (cortas.length) {
    avisos.push({
      nivel: 'medio', clave: 'sin_stock',
      texto: `${cortas.length} línea(s) piden más de lo que figura disponible según las facturas de esta empresa (${cortas.slice(0, 2).map(l => `${l.nombre}: piden ${l.cantidad}, hay ${l.disponible}`).join(' · ')}). El disponible sale de comprado − vendido, así que puede estar desactualizado.`,
    });
  }

  // ⚠️ El costo guardado es valor de venta; si la contadora está escribiendo
  // precios CON IGV, hay que comparar peras con peras o el aviso saltaría en
  // toda línea con margen menor al 18 %.
  const f = borrador?.igvIncluido ? 1 + Math.max(0, num(borrador?.igvPct ?? 18)) / 100 : 1;
  const bajoCosto = lineas.filter(l => l.costoUnitario != null && l.costoUnitario > 0
    && l.precio_unitario > 0 && (l.precio_unitario / f) < l.costoUnitario);
  if (bajoCosto.length) {
    avisos.push({
      nivel: 'alto', clave: 'bajo_costo',
      texto: `${bajoCosto.length} línea(s) se facturarían por DEBAJO del último costo de compra (${bajoCosto.slice(0, 2).map(l => `${l.nombre}: vendes a ${l.precio_unitario}, te costó ${l.costoUnitario}`).join(' · ')}). Vender a pérdida dentro del grupo se puede hacer, pero tiene que ser una decisión, no un descuido.`,
    });
  }

  const cambioNombre = lineas.filter(l => l.nombre !== l.nombreOrden);
  if (cambioNombre.length) {
    avisos.push({
      nivel: 'info', clave: 'nombre_distinto',
      texto: `${cambioNombre.length} línea(s) van a la factura con un nombre distinto al de la orden. Es normal —cada empresa nombra sus insumos como los tiene cargados— y el nombre del pedido queda guardado al lado para poder cuadrar los dos papeles.`,
    });
  }

  if (totalOrden > 0 && Math.abs(t.total - totalOrden) > 0.5) {
    const mas = t.total > totalOrden;
    avisos.push({
      nivel: 'medio', clave: 'monto_distinto',
      texto: `La factura sale por ${t.total.toFixed(2)} y la orden pedía ${totalOrden.toFixed(2)} — ${mas ? 'más' : 'menos'} de lo pedido. Quien emitió la orden va a tener que aceptar la diferencia.`,
    });
  }

  return avisos;
}

/**
 * Las líneas del borrador, listas para `items_factura` del movimiento.
 *
 * El precio se guarda SIN IGV pase lo que pase con el checkbox: de acá comen el
 * inventario, el abastecimiento y el historial de precios, y si la mitad de las
 * líneas estuvieran con IGV, comparar dos compras del mismo insumo dependería
 * de cómo estaba el checkbox ese día.
 */
export function itemsFacturaDeBorrador(borrador) {
  const f = borrador?.igvIncluido ? 1 + Math.max(0, num(borrador?.igvPct ?? 18)) / 100 : 1;
  return (borrador?.lineas || []).filter(l => l.incluir).map(l => ({
    descripcion: l.nombre,
    // Qué decía el pedido. Es lo que después permite cuadrar los dos papeles.
    descripcion_orden: l.nombreOrden !== l.nombre ? l.nombreOrden : undefined,
    unidad: l.unidad || 'UND',
    cantidad: num(l.cantidad),
    precio_unitario: Math.round((num(l.precio_unitario) / f + Number.EPSILON) * 1e6) / 1e6,
    precio_ingresado: f !== 1 ? num(l.precio_unitario) : undefined,
    tipo_insumo: l.tipo_insumo || undefined,
    insumo_codigo: l.insumo_codigo || undefined,
  }));
}

/**
 * ¿LE ESTOY PIDIENDO MÁS DE LO QUE TIENE? (tanda 9)
 *
 * Gabriel, 7-set-2026: «Qué pasa si hago una orden de compra por una cantidad
 * superior a la que se sabe que se tiene de dicho insumo en la empresa de
 * nuestro grupo (solo para el caso de empresas del grupo, terceros no). No es
 * que la orden no se pueda emitir, se emitirá, pero nos arrojará un aviso.»
 *
 * ── SOLO PARA EMPRESAS DEL GRUPO, Y ES LA PARTE IMPORTANTE ────────
 * De un tercero no sabemos —ni tenemos por qué saber— qué stock tiene: sus
 * facturas de compra no están en nuestros libros. Avisar «la ferretería no
 * tiene 500 kg de clavos» sería inventar un dato. Por eso esta función devuelve
 * lista vacía sin `companyId`, y la pantalla no muestra nada.
 *
 * Avisa, no bloquea. La orden se emite igual: comprar para atender el pedido es
 * lo normal, no la excepción.
 *
 * @returns [{ descripcion, pedido, disponible, faltante, unidad }]
 */
export function lineasQueExcedenElStock({ lineas = [], inventario = new Map(), mapeos = null } = {}) {
  if (!inventario || !inventario.size) return [];
  const items = (lineas || [])
    .filter(l => String(l.descripcion || l.nombre || '').trim() && num(l.cantidad) > 0)
    .map((l, i) => ({
      id: l.key ?? l.id ?? `l${i}`,
      nombre: l.descripcion || l.nombre,
      unidad: l.unidad || '',
      cantidad: num(l.cantidad),
      insumo_codigo: l.insumo_codigo || null,
    }));
  const cruce = cruzarOrdenConInventario({ items, inventario, mapeos });
  return cruce
    .filter(c => c.cubre === false)      // false = «medí y no alcanza». null = «no sé», y no se avisa.
    .map(c => ({
      descripcion: c.nombre,
      unidad: c.item.unidad || c.mejor?.unidad || '',
      pedido: c.pedido,
      disponible: c.disponible,
      faltante: c.faltante,
      seLlama: c.mejor?.descripcion || null,
    }));
}
