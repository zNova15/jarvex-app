// ═══════════════════════════════════════════════════════════════════
// JARVEX — DE UN COMPROBANTE A SU(S) CUENTA(S) DEL PCGE.
//
// `pcge-puente.js` contesta «la familia S03 va a la 631». Esto contesta la
// pregunta que se hace el Libro Diario: «esta FACTURA, ¿a qué cuenta va?».
//
// ── DOS CAPAS, EN ESTE ORDEN ──────────────────────────────────────
// 1. EL CATÁLOGO DE LA EMPRESA. Si alguien ya decidió que «TRANSPORTE DE
//    MOBILIARIO SEGÚN GUÍA» es S03, esa decisión manda. Es una persona que
//    miró la factura.
// 2. EL CLASIFICADOR IUPC sobre el texto, con el diccionario propio encima
//    del oficial. Es el mismo motor de la bandeja de «nombres por reconocer».
//
// Medido el 17-set-2026 sobre los 3.609 ítems de producción: la capa 1 sola
// resuelve el 23,6 %; con la capa 2, el 77,1 % de los ítems y el 98,3 % del
// dinero. Lo que no resuelve NINGUNA de las dos no se inventa: sale marcado.
//
// ── POR QUÉ EL ASIENTO SE PARTE ───────────────────────────────────
// Una factura de ferretería trae materiales y herramientas: 602 y 656, que ni
// siquiera son la misma cuenta de dos dígitos. Medido el 17-set: el 8,8 % de
// los comprobantes cae en más de una cuenta, y cuando pasa, la segunda pesa
// una MEDIANA DEL 23,9 % del comprobante. Eso no se absorbe — absorberlo sería
// repetir en chico el error que estamos arreglando. Así que el asiento lleva
// una línea de gasto por cuenta, prorrateada por lo que pesa cada ítem.
//
// Lo único que se absorbe es lo que no llega a un sol: una línea de S/ 0,40 no
// le dice nada a nadie y ensucia el libro.
//
// Funciones puras. Testeadas en __tests__/cuenta-de-comprobante.test.js.
// ═══════════════════════════════════════════════════════════════════

import { claveMapeo } from './mapeo-insumos.js';
import { resolverCategorias } from './bandeja-categorizacion.js';
import { clasificarConIUPC } from './indices-unificados-iupc.js';
import { cuentaDeFamilia, CUENTA_PROVISIONAL } from './pcge-puente.js';
import { cuentaMadreDe } from './pcge.js';
import { esVentaMov } from './costo-obra.js';
import { esFamiliaFlete, cuentaDeFlete } from './flete-compra.js';

/** Debajo de esto, una línea propia no aporta nada y se absorbe en la mayor. */
export const MINIMO_LINEA = 1;

/** De dónde salió la familia, de más confiable a menos. */
export const ORIGEN = {
  catalogo: 'catalogo',       // alguien lo decidió mirando la factura
  clasificador: 'clasificador',
  ninguno: 'ninguno',
};

/** Bandas de confianza del clasificador, las mismas que usa la bandeja. */
export const banda = (score) => (score >= 0.75 ? 'alta' : score >= 0.5 ? 'media' : 'baja');

/**
 * Arma la función que traduce una descripción de factura a su familia.
 *
 * Se construye UNA vez por pantalla (con lo que hay en Dexie) y se le pasa a
 * `cuentasDeComprobante` para cada movimiento: clasificar 3.600 ítems contra
 * un diccionario que se rearma en cada llamada es la diferencia entre una
 * pantalla que abre y una que se cuelga.
 *
 * @param {object} opts
 *   catalogo        filas de `catalogo_insumos`
 *   alias           filas de `insumo_categoria` (las decisiones por descripción)
 *   terminosCustom  filas de `clasificacion_terminos` TAL CUAL salen de la
 *                   base: el clasificador espera `{termino, clasificacion_codigo}`
 *                   y descarta en silencio lo que no los traiga, así que un
 *                   diccionario traducido a otra forma no falla — simplemente
 *                   no se aplica, y el diccionario propio deja de ganarle al
 *                   oficial sin que nadie se entere (regla 8 del CLAUDE.md).
 *   companyId       para que la decisión de la propia empresa pese más
 * @returns {(descripcion:string) => {familia:string|null, origen:string, score:number,
 *            via:string, catalogoId:string|null, catalogoNombre:string|null,
 *            catalogoNorm:string|null, catalogoGlobal:boolean}}
 *
 * `via` y `catalogo*` dicen DÓNDE vive la clasificación (tanda 3 del destino):
 *   · 'alias'        la descripción tiene una decisión que la apunta a un
 *                    insumo del catálogo, y la familia es la de ESE insumo;
 *   · 'nombre'       la descripción ES un insumo del catálogo (mismo nombre);
 *   · 'clasificador' nadie decidió nada: lo dedujo el motor del texto.
 * La ventana de consecuencias lo necesita para corregir la causa en el lugar
 * donde está: cambiar la familia de un insumo mueve a todas las descripciones
 * que apuntan a él, y cambiar una descripción suelta no mueve a nadie más.
 */
export function crearResolvedorDeFamilia({
  catalogo = [], alias = [], terminosCustom = null, companyId = null, demo = false,
} = {}) {
  const catPorId = new Map();
  const catPorNorm = new Map();
  for (const c of catalogo) {
    if (!c || c.deleted_at) continue;
    catPorId.set(c.id, c);
    const n = c.norm || claveMapeo(c.nombre);
    if (n && !catPorNorm.has(n)) catPorNorm.set(n, c);
  }
  // `resolverCategorias` ya sabe resolver el duplicado benigno de dos PCs
  // offline y la jerarquía de ámbito (la decisión de esta empresa pesa más que
  // la global, y la manual más que la automática). No se reimplementa acá.
  const aliasPorNorm = resolverCategorias(alias, { companyId, demo });

  const cache = new Map();
  const SIN_CATALOGO = { catalogoId: null, catalogoNombre: null, catalogoNorm: null, catalogoGlobal: false };
  const deCatalogo = (c) => (c ? {
    catalogoId: c.id || null,
    catalogoNombre: c.nombre || null,
    catalogoNorm: c.norm || claveMapeo(c.nombre) || null,
    catalogoGlobal: !c.company_id,
  } : SIN_CATALOGO);

  return function familiaDe(descripcion) {
    const texto = String(descripcion ?? '').trim();
    if (!texto) return { familia: null, origen: ORIGEN.ninguno, score: 0, via: 'ninguna', ...SIN_CATALOGO };
    if (cache.has(texto)) return cache.get(texto);

    let out = null;
    const n = claveMapeo(texto);

    // ── Capa 1: lo que ya se decidió ──
    const a = n ? aliasPorNorm.get(n) : null;
    if (a) {
      const delCatalogo = a.catalogo_insumo_id ? catPorId.get(a.catalogo_insumo_id) : null;
      const familia = delCatalogo?.familia || a.familia || null;
      if (familia && familia !== 'sin_clasificar') {
        out = {
          familia, origen: ORIGEN.catalogo, score: 1, via: 'alias',
          // Si el insumo no trae familia, la que manda es la de la decisión:
          // no hay fila del catálogo donde corregirla.
          ...(delCatalogo?.familia ? deCatalogo(delCatalogo) : SIN_CATALOGO),
        };
      }
    }
    if (!out && n) {
      const c = catPorNorm.get(n);
      if (c?.familia && c.familia !== 'sin_clasificar') {
        out = { familia: c.familia, origen: ORIGEN.catalogo, score: 1, via: 'nombre', ...deCatalogo(c) };
      }
    }

    // ── Capa 2: el clasificador sobre el texto ──
    if (!out) {
      const rec = clasificarConIUPC(texto, { terminosCustom });
      const familia = rec?.codigo && rec.codigo !== 'sin_clasificar' ? rec.codigo : null;
      out = familia
        ? { familia, origen: ORIGEN.clasificador, score: Number(rec?.score) || 0, via: 'clasificador', ...SIN_CATALOGO }
        : { familia: null, origen: ORIGEN.ninguno, score: 0, via: 'ninguna', ...SIN_CATALOGO };
    }

    cache.set(texto, out);
    return out;
  };
}

/** Los ítems que Captura Mágica guardó en el JSON de `notas`. */
export function itemsDe(mov) {
  const crudo = mov?.notas;
  if (!crudo) return [];
  let n = crudo;
  if (typeof crudo === 'string') {
    try { n = JSON.parse(crudo); } catch { return []; }
  }
  return Array.isArray(n?.items_factura) ? n.items_factura : [];
}

const importeDeItem = (it) => {
  const cant = Number(it?.cantidad);
  const pu = Number(it?.precio_unitario);
  const v = (isFinite(cant) ? cant : 1) * (isFinite(pu) ? pu : 0);
  return isFinite(v) ? Math.abs(v) : 0;
};

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * El reparto de un comprobante entre cuentas del PCGE.
 *
 * Devuelve PORCIONES, no importes: quién sabe cuál es la base imponible es el
 * generador de asientos (que ya desglosa el IGV real del comprobante), y
 * calcularla dos veces en dos archivos es pedir que se desincronicen.
 *
 * @param {object} mov        el accounting_movement
 * @param {object} opts       { familiaDe } — el resolvedor de arriba
 * @returns {{
 *   lineas: Array<{cuenta, cuentaMadre, porcion, familias, origen, confianza, revisar, porque}>,
 *   provisional: boolean,   // no se pudo determinar: la cuenta es un lugar donde ponerlo
 *   origen: string,         // la peor capa que se usó (es la que hay que mirar)
 *   confianza: string,      // ídem con la banda
 *   revisar: boolean,
 *   itemsSinResolver: number,
 * }}
 */
export function cuentasDeComprobante(mov, { familiaDe } = {}) {
  const esVenta = esVentaMov(mov);
  const items = itemsDe(mov);
  const resolver = typeof familiaDe === 'function' ? familiaDe : () => ({ familia: null, origen: ORIGEN.ninguno, score: 0 });

  // Agrupado por SUBCUENTA (3 dígitos), que es el detalle del puente.
  const porSub = new Map();
  let sinResolver = 0;
  let totalImporte = 0;

  // Primera pasada: la familia de cada ítem. Hace falta ANTES de asentar
  // porque un flete depende de lo que se compró en el resto del comprobante.
  const resueltos = items.map(it => {
    const fam = resolver(it?.descripcion);
    return { it, imp: importeDeItem(it), ...fam };
  });
  // El detalle por ítem: qué cuenta le tocó a cada descripción y de dónde salió
  // su familia. Lo lee la ventana de consecuencias para ofrecer corregir la
  // CAUSA (la clasificación) y no solo el síntoma (la cuenta del asiento).
  const detalleItems = [];

  // La compra (60x) que más pesa entre los ítems que NO son flete: si el
  // flete viene en la misma factura, es el costo de traer ESO (tanda 2 del
  // destino, `flete-compra.js`).
  let compraDelComprobante = null;
  if (!esVenta) {
    const pesoCompra = new Map();
    for (const x of resueltos) {
      if (!x.familia || esFamiliaFlete(x.familia)) continue;
      const c = cuentaDeFamilia(x.familia)?.cuenta;
      if (c && c.startsWith('60')) pesoCompra.set(c, (pesoCompra.get(c) || 0) + x.imp);
    }
    compraDelComprobante = [...pesoCompra.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }

  for (const x of resueltos) {
    const { it, imp, familia, origen, score } = x;
    let r = familia ? cuentaDeFamilia(familia, { esVenta }) : null;
    // El flete de una compra no es un gasto de viaje: va a la 609. Solo en
    // compras — el flete que la empresa FACTURA es un ingreso y va a la 704.
    if (r && !esVenta && esFamiliaFlete(familia)) {
      r = cuentaDeFlete(it?.descripcion, { familiaDe: resolver, compraDelMismoComprobante: compraDelComprobante });
    }
    detalleItems.push({
      descripcion: String(it?.descripcion ?? '').trim(),
      norm: claveMapeo(it?.descripcion),
      unidad: it?.unidad || null,
      importe: imp,
      familia: familia || null,
      origen, score,
      via: x.via || null,
      catalogoId: x.catalogoId || null,
      catalogoNombre: x.catalogoNombre || null,
      catalogoNorm: x.catalogoNorm || null,
      catalogoGlobal: x.catalogoGlobal === true,
      cuenta: r?.cuenta || null,
    });
    if (!r) { sinResolver++; continue; }
    totalImporte += imp;
    const prev = porSub.get(r.cuenta) || {
      cuenta: r.cuenta, importe: 0, familias: new Set(),
      revisar: false, porque: r.porque, peorScore: 1, peorOrigen: ORIGEN.catalogo,
    };
    prev.importe += imp;
    prev.familias.add(familia);
    prev.revisar = prev.revisar || r.revisar;
    if (origen === ORIGEN.clasificador) {
      prev.peorOrigen = ORIGEN.clasificador;
      prev.peorScore = Math.min(prev.peorScore, score);
    }
    porSub.set(r.cuenta, prev);
  }

  // ── Nada resuelto: se dice, no se inventa ──
  if (!porSub.size) {
    const cuenta = CUENTA_PROVISIONAL[esVenta ? 'venta' : 'compra'];
    return {
      lineas: [{
        cuenta,
        cuentaMadre: cuentaMadreDe(cuenta)?.codigo || cuenta,
        porcion: 1,
        familias: [],
        origen: ORIGEN.ninguno,
        confianza: 'ninguna',
        revisar: true,
        porque: items.length
          ? 'No se reconoció ninguno de los ítems del comprobante: la cuenta es provisional, hay que elegirla a mano.'
          : 'El comprobante no tiene detalle de ítems, así que no hay de dónde deducir la cuenta.',
      }],
      provisional: true,
      origen: ORIGEN.ninguno,
      confianza: 'ninguna',
      revisar: true,
      itemsSinResolver: sinResolver,
      items: detalleItems,
    };
  }

  // ── Reparto proporcional ──
  // Si TODOS los ítems resueltos importan cero (pasa cuando el detalle no
  // trae precios), se reparte en partes iguales: es lo único honesto, y sigue
  // siendo mejor que mandar todo a una sola cuenta elegida al azar.
  const entradas = [...porSub.values()];
  const suma = entradas.reduce((s, e) => s + e.importe, 0);
  const pesos = suma > 0
    ? entradas.map(e => e.importe / suma)
    : entradas.map(() => 1 / entradas.length);

  // `cuenta` es la que SE ASIENTA: la subcuenta de tres dígitos, que es el
  // detalle que el puente puede afirmar y el que el PCGE espera en el libro.
  // `cuentaMadre` es la de dos, para agrupar y para los reportes — pero el
  // asiento no puede llevar solo ésa: una capacitación (624) y la planilla
  // (62) son las dos «62», y confundirlas le quita el IGV a la factura del
  // instituto y se la debe al trabajador en vez de al proveedor.
  let lineas = entradas.map((e, i) => ({
    cuenta: e.cuenta,
    cuentaMadre: cuentaMadreDe(e.cuenta)?.codigo || e.cuenta,
    porcion: pesos[i],
    familias: [...e.familias],
    origen: e.peorOrigen,
    confianza: e.peorOrigen === ORIGEN.catalogo ? 'catalogo' : banda(e.peorScore),
    revisar: e.revisar,
    porque: e.porque,
    _importe: e.importe,
  })).sort((a, b) => b.porcion - a.porcion);

  // Las migajas se absorben en la línea mayor: una línea de menos de un sol
  // no le dice nada a nadie.
  const totalMov = Math.abs(Number(mov?.amount) || 0);
  if (lineas.length > 1 && totalMov > 0) {
    const grandes = lineas.filter(l => r2(l.porcion * totalMov) >= MINIMO_LINEA);
    if (grandes.length && grandes.length < lineas.length) {
      const absorbido = lineas.filter(l => !grandes.includes(l)).reduce((s, l) => s + l.porcion, 0);
      grandes[0] = { ...grandes[0], porcion: grandes[0].porcion + absorbido };
      lineas = grandes;
    }
  }

  // Renormaliza por las dudas (redondeos, absorciones): las porciones tienen
  // que sumar 1 o el asiento no cuadra.
  const sumaPorciones = lineas.reduce((s, l) => s + l.porcion, 0) || 1;
  lineas = lineas.map(({ _importe, ...l }) => ({ ...l, porcion: l.porcion / sumaPorciones }));

  const hayClasificador = lineas.some(l => l.origen === ORIGEN.clasificador);
  const peorBanda = lineas.reduce((peor, l) => {
    const orden = { catalogo: 3, alta: 2, media: 1, baja: 0 };
    return (orden[l.confianza] ?? 0) < (orden[peor] ?? 9) ? l.confianza : peor;
  }, 'catalogo');

  return {
    lineas,
    provisional: false,
    origen: hayClasificador ? ORIGEN.clasificador : ORIGEN.catalogo,
    confianza: peorBanda,
    revisar: lineas.some(l => l.revisar) || sinResolver > 0,
    itemsSinResolver: sinResolver,
    items: detalleItems,
  };
}

export default {
  MINIMO_LINEA, ORIGEN, banda,
  crearResolvedorDeFamilia, itemsDe, cuentasDeComprobante,
};
