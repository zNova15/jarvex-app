// ═══════════════════════════════════════════════════════════════════
// JARVEX — AUTOCOMPLETADO DEL DETALLE DE LA ORDEN (tanda 8, entrega 2).
//
// EL PEDIDO (Gabriel, 6-set-2026):
//   «lo que no me gusta es que, en caso yo quiera directamente sin ir a la
//    sección de qué tiene la empresa del grupo, colocando la descripción del
//    insumo […] no me sale recomendaciones. Si, por ejemplo, yo coloco "cem.."
//    no me sale recomendaciones de algún insumo que empiece por ese nombre.
//    Implementa eso para Órdenes de Compra o Servicio tanto para el de las
//    empresas como de los trabajos (obras, etc.)».
//
// POR QUÉ NO ALCANZABA CON LO QUE YA HABÍA: los dos bloques de ayuda
// (`buscarEnPresupuesto` y `buscarComprasDelGrupo`) contestan preguntas
// distintas y ninguna es ésta:
//
//   · «qué necesita la obra»  → solo existe DENTRO de una obra, y una empresa
//     comprándole a un tercero —el caso más común— no tiene presupuesto.
//   · «qué tienen las empresas del grupo» → filtra por `disponible > 0`, o sea
//     que esconde todo lo que se compró y ya se consumió. Para escribir la
//     descripción de una línea eso es exactamente lo que NO hay que esconder:
//     el texto sirve aunque no quede una sola bolsa en manos de nadie.
//
// Así que ésta es la tercera pregunta, la más simple: «de todo lo que esta app
// ya vio escrito, ¿qué se parece a lo que estoy tipeando?». Y responde con la
// UNIDAD y el ÚLTIMO PRECIO, que son las dos casillas de al lado.
//
// ── EL ORDEN DE LAS FUENTES NO ES ARBITRARIO ──────────────────────
//   1. ÓRDENES ya emitidas (`oc_items`) — es texto que alguien ya consideró
//      bueno para un documento firmado. Vale más que cualquier otro.
//   2. PRESUPUESTO (`insumos_partida`) — el nombre canónico de la obra. Trae
//      el `insumo_codigo`, que es lo que después deja el mapeo aprendido.
//   3. FACTURAS (`items_factura`) — el texto crudo del proveedor. Es el corpus
//      más grande y el más sucio; va último a propósito.
//
// ── EL PRECIO QUE SE SUGIERE ES EL ÚLTIMO, NO EL PROMEDIO ─────────
// Un promedio sobre dos años de cemento da un número que no es el de hoy y que
// nadie puede defender frente a un proveedor. El último precio con su fecha se
// puede mirar y decir «ah, eso fue en marzo». Por eso viaja `precioFecha`: sin
// la fecha, el precio sugerido sería una afirmación sin respaldo.
//
// Nunca se autocompleta el precio solo: la pantalla lo OFRECE y la persona lo
// acepta. Un precio metido a la fuerza en una orden que se firma es peor que
// una casilla vacía.
//
// ── CADA EMPRESA NOMBRA SUS INSUMOS COMO QUIERE (tanda 9) ─────────
// Gabriel, 7-set-2026: «ese autoguardado se llevaría para la base de datos de
// la empresa a la que se le emite la orden […] Otras empresas pueden variar un
// poco su descripción y guardarse en su propia base de datos».
//
// No hay «base de datos por empresa» ni hace falta inventarla: cada entrada del
// corpus ya sabe QUIÉN VENDIÓ eso (`proveedores`), y `buscarDescripcion` acepta
// un `proveedorId` que sube al tope lo que esa empresa ya vendió. GASOMI ve
// primero «CEMENTO SOL TIPO I» y JHEENSEG primero «CEMENTO INKA X 42.5 KG»,
// sobre el MISMO corpus.
//
// Se hace así y no con listas separadas porque el corpus separado envejece: una
// descripción nueva de GASOMI tendría que copiarse a mano a las otras el día que
// alguien más se la compra. Un solo corpus con preferencia no tiene ese problema
// — y sigue mostrando lo de las demás más abajo, que es lo correcto cuando la
// empresa recién arranca y su lista propia está vacía.
//
// ── POR QUÉ NO SE FILTRA POR TIPO DE ORDEN ────────────────────────
// La primera versión escondía los materiales en una orden de SERVICIO. Se cayó
// sola al probarla: `tipo_insumo` está cargado en algunas líneas de orden y
// casi en ninguna de factura, así que el filtro tapaba unas cosas y otras no —
// y un filtro que se aplica a medias es peor que ninguno, porque la persona no
// puede saber por qué no le aparece lo que está escribiendo. El texto que se
// tipea ya filtra: nadie que escriba «trans» va a recibir cemento.
//
// Puro: sin React, sin Dexie. Testeado en __tests__/sugerir-descripcion.test.js
// ═══════════════════════════════════════════════════════════════════

import { itemsDeFactura } from './cruce-recepcion.js';
import { esCompraMov } from './costo-obra.js';
import { normNombre } from './directorio-compra.js';

const vivos = (arr) => (Array.isArray(arr) ? arr.filter(x => x && !x.deleted_at) : []);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;

const PESO_ORIGEN = { orden: 300, presupuesto: 200, factura: 100 };

/**
 * El corpus de descripciones que la app ya vio escritas.
 *
 * Se arma UNA vez por pantalla (es un recorrido de todas las facturas) y se
 * consulta en cada tecla con `buscarDescripcion`, que solo filtra.
 *
 * @param opts.ocItems        filas de oc_items
 * @param opts.movs           accounting_movements
 * @param opts.insumosPartida insumos del presupuesto (solo dentro de una obra)
 * @param opts.companyId      la empresa que emite: lo suyo pesa más
 * @param opts.tipo           'compra' | 'servicio' — acota qué corpus mirar
 */
export function corpusDeDescripciones({
  ocItems = [], movs = [], insumosPartida = [], companyId = null,
} = {}) {
  const porNorm = new Map();

  const poner = (texto, { unidad, precio, fecha, origen, insumoCodigo, vendedorId, propio }) => {
    const desc = String(texto || '').trim();
    if (desc.length < 3) return;
    const k = normNombre(desc);
    if (!k) return;
    let e = porNorm.get(k);
    if (!e) {
      e = {
        norm: k, descripcion: desc, unidad: unidad || '', veces: 0,
        precio: null, precioFecha: '', insumoCodigo: null,
        // `proveedores` = quién VENDIÓ eso alguna vez. Es el vocabulario de esa
        // empresa, y lo que permite ordenar distinto según a quién le compras.
        origenes: new Set(), proveedores: new Set(), propio: false,
      };
      porNorm.set(k, e);
    }
    e.veces += 1;
    e.origenes.add(origen);
    if (propio) e.propio = true;
    if (vendedorId) e.proveedores.add(vendedorId);
    // El texto que se muestra es el de la fuente de MÁS peso; a igual peso,
    // el más largo (suele ser el que trae la especificación completa).
    if (!e.mejorPeso || PESO_ORIGEN[origen] > e.mejorPeso
      || (PESO_ORIGEN[origen] === e.mejorPeso && desc.length > e.descripcion.length)) {
      e.mejorPeso = PESO_ORIGEN[origen];
      e.descripcion = desc;
    }
    if (!e.unidad && unidad) e.unidad = unidad;
    if (!e.insumoCodigo && insumoCodigo) e.insumoCodigo = insumoCodigo;
    // Precio: gana el más reciente CON fecha. Una línea sin fecha nunca pisa a
    // una fechada, porque después no habría cómo explicar de dónde salió.
    const p = num(precio);
    if (p > 0 && fecha && (!e.precioFecha || String(fecha) > e.precioFecha)) {
      e.precio = r2(p);
      e.precioFecha = String(fecha);
    } else if (p > 0 && e.precio == null && !e.precioFecha) {
      e.precio = r2(p);
    }
  };

  // 1 — Órdenes ya emitidas.
  for (const it of vivos(ocItems)) {
    poner(it.nombre || it.nombre_libre, {
      unidad: it.unidad, precio: it.precio_unitario, fecha: it.created_at || '',
      origen: 'orden', insumoCodigo: it.insumo_codigo || null,
      // En una orden, quien vende es el destinatario: `proveedor_company_id`.
      vendedorId: it.proveedor_company_id || null,
      propio: false,
    });
  }

  // 2 — Presupuesto de la obra (si la hay).
  for (const ip of vivos(insumosPartida)) {
    const nombre = ip.nombre_insumo;
    if (!nombre) continue;
    poner(nombre, {
      unidad: ip.unidad, precio: ip.precio_unitario, fecha: '',
      origen: 'presupuesto', insumoCodigo: ip.insumo_codigo || null,
      vendedorId: null, propio: false,
    });
  }

  // 3 — Lo que dicen las facturas de compra.
  for (const m of vivos(movs)) {
    if (m.payment_status === 'cancelled') continue;
    if (!esCompraMov(m)) continue;
    const propio = !!(companyId && m.company_id === companyId);
    // ⚠️ En una COMPRA, `company_id` es quien COMPRÓ. El vocabulario que
    // interesa es el de quien VENDIÓ, y eso solo se sabe cuando la contraparte
    // es una empresa nuestra (`related_company_id` de una interna). Con un
    // tercero no hay a quién atribuírselo, y forzarlo con `company_id` diría lo
    // contrario de la verdad: que el comprador nombra así lo que vende.
    const vendedorId = m.is_intercompany ? (m.related_company_id || null) : null;
    for (const it of itemsDeFactura(m)) {
      poner(it?.descripcion, {
        unidad: it?.unidad, precio: it?.precio_unitario, fecha: m.date || '',
        origen: 'factura', insumoCodigo: null,
        vendedorId, propio,
      });
    }
  }

  return [...porNorm.values()].map(e => ({
    norm: e.norm,
    descripcion: e.descripcion,
    unidad: e.unidad || '',
    veces: e.veces,
    precio: e.precio,
    precioFecha: e.precioFecha,
    insumoCodigo: e.insumoCodigo,
    origenes: [...e.origenes],
    proveedores: [...e.proveedores],
    propio: e.propio,
  }));
}

/**
 * Filtra el corpus contra lo que se está tipeando.
 *
 * Gabriel pidió textualmente «algún insumo que EMPIECE por ese nombre», así
 * que el prefijo manda; pero no se descarta lo que coincide en el medio,
 * porque «portland» tiene que traer «CEMENTO PORTLAND TIPO I» y nadie escribe
 * los insumos por su primera palabra.
 *
 * Desde 2 caracteres: con uno solo el resultado es ruido y encima recorre todo
 * el corpus en cada tecla.
 */
export function buscarDescripcion(corpus = [], texto = '', { limite = 8, minimo = 2, proveedorId = null } = {}) {
  const q = normNombre(texto);
  if (q.length < minimo) return [];
  const tokens = q.split(' ').filter(Boolean);
  const out = [];

  for (const e of corpus) {
    let p = 0;
    let todos = true;
    for (const t of tokens) {
      const i = e.norm.indexOf(t);
      if (i < 0) { todos = false; break; }
      if (i === 0) p += 100;                                  // empieza por ahí
      else if (new RegExp(`(^| )${t}`).test(e.norm)) p += 60;  // empieza una palabra
      else p += 25;
    }
    if (!todos) continue;
    p += Math.min(40, e.veces);                 // lo muy usado, arriba
    p += Math.max(...e.origenes.map(o => PESO_ORIGEN[o] || 0)) / 10;
    if (e.propio) p += 30;                      // lo que compró ESTA empresa
    if (e.insumoCodigo) p += 15;                // trae código: deja mapeo
    // El vocabulario de la empresa a la que se le está comprando manda: es la
    // que va a emitir la factura y la que tiene el insumo con ESE nombre.
    const delProveedor = !!(proveedorId && e.proveedores.includes(proveedorId));
    if (delProveedor) p += 120;
    out.push({ ...e, puntaje: p, delProveedor });
  }

  out.sort((a, b) => b.puntaje - a.puntaje || b.veces - a.veces
    || a.descripcion.length - b.descripcion.length);
  return out.slice(0, limite);
}

/** El origen más fuerte de una sugerencia, para la etiqueta de la lista. */
export function origenPrincipal(sug) {
  const o = sug?.origenes || [];
  if (o.includes('orden')) return 'orden';
  if (o.includes('presupuesto')) return 'presupuesto';
  return 'factura';
}

export const ETIQUETA_ORIGEN = {
  orden: 'ya en una orden',
  presupuesto: 'del presupuesto',
  factura: 'de una factura',
};
