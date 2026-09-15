// ═══════════════════════════════════════════════════════════════════
// JARVEX — ¿ESTO ES UN INSUMO, UN SERVICIO, O NINGUNA DE LAS DOS?
// (tanda 3, 15-set-2026). Lib PURA.
//
// ── EL PEDIDO ──────────────────────────────────────────────────────
// Gabriel, 15-set-2026: «la separación entre insumo y servicios parece ser
// pésima, encontré en insumos varias descripciones que no son insumos, por
// ejemplo "gastos administrativos del centro del proceso arbitral seguido
// entre el consorcio santa y la municipaldad distrital de nuevo chimbote exp
// nro 044 2023 coar pago en via de subrogacion"».
//
// Ese ítem existe: está dos veces en producción (E001-209 y E001-210, a
// S/ 7.000 cada uno) y aparecía en la pestaña 🧱 Insumos de Correlaciones.
//
// ── POR QUÉ LLEGABA AHÍ ────────────────────────────────────────────
// La pantalla preguntaba UNA sola cosa: qué dice el estándar IUPC. Y cuando
// el IUPC no reconoce un texto devuelve `sin_clasificar`, que caía del lado
// de los insumos —a propósito, para no separar a una descripción de su
// gemela: si una forma de escribir un servicio no se reconoce y su gemela sí,
// quedarían en pestañas distintas y no se podrían correlacionar nunca—.
// El precio de esa decisión correcta era que TODO lo no reconocido terminaba
// en Insumos, y ahí caen los arbitrajes, los SCTR y las valorizaciones.
//
// ── LAS TRES SEÑALES, Y POR QUÉ EN ESTE ORDEN ──────────────────────
// Ninguna alcanza sola; las tres juntas, sí. Medido sobre las 3.517 líneas
// de `items_factura` de producción el 15-set-2026:
//
//  1. EL ESTÁNDAR IUPC + el diccionario propio. Es la taxonomía oficial y la
//     regla 8 del CLAUDE.md dice que manda: cuando reconoce algo se le hace
//     caso, porque es el único que distingue un tipo de insumo de otro y no
//     solo «bien contra servicio». Con UNA excepción, que está documentada
//     abajo en `TEXTO_LE_GANA_AL_ESTANDAR` y salió de un test que falló al
//     escribirlo: los patrones cerrados de lo contractual y lo financiero
//     (anticipo, valorización, arbitraje, detracción) van antes, porque el
//     IUPC engancha alguna palabra suelta y devuelve 'insumo' para un
//     «ANTICIPO DE CLIENTE» que no es un insumo de ninguna manera.
//
//  2. EL TEXTO DE LA FACTURA (`clasificarLineaPorTexto`, que ya existía en
//     inventario-empresa.js y nadie estaba llamando desde acá). Cubre justo
//     el agujero del IUPC: lo contractual y lo financiero. Valorizaciones,
//     liquidaciones, anticipos, alquileres, arbitrajes, seguros, intereses,
//     detracciones. Va SEGUNDO —solo cuando el IUPC no supo— porque sus
//     patrones son amplios a propósito y no tienen por qué ganarle a un
//     código reconocido: «KIT DE MANTENIMIENTO» es una herramienta, aunque
//     diga «mantenimiento».
//
//  3. `tipo_insumo`, lo que la IA de Captura Mágica anotó al leer la factura.
//     Está en el 100% de las líneas (material 2.758 · servicio 480 ·
//     herramienta 140 · epp 120 · maquinaria 19) y es la última porque se
//     equivoca de maneras que se pueden nombrar: «alquiler de equipos
//     topográficos» → material, «valorización n° 06 de la obra» →
//     herramienta, «sctr salud» → material. Los tres ya los atrapa la señal 2
//     antes de llegar acá.
//
// 🔴 `material` NO CUENTA COMO SEÑAL POSITIVA de nada más que insumo, y es a
// propósito que sí cuente para eso: es el cajón por defecto de la IA (el 78%
// de las líneas) y por eso no puede decidir contra las otras dos, pero cuando
// las otras dos callaron es lo único que hay — y para un material de verdad
// acierta. Lo que NO puede pasar es que un `material` mal puesto tape un
// código IUPC o un patrón de texto: por eso llega último.
//
// ── LA CUARTA RESPUESTA: 'otro' ────────────────────────────────────
// Un arbitraje no es un insumo NI un servicio de construcción que uno quiera
// correlacionar con otro. Es plata que se movió. Forzarlo a una de las dos
// pestañas es lo que produjo el problema original, así que tiene la suya.
// Y `desconocido` sigue existiendo aparte: «no es ninguna» y «no sé» son
// respuestas distintas, y confundirlas es lo que hace que una pantalla mienta.
// ═══════════════════════════════════════════════════════════════════
import { clasificarConIUPC, tipoDeCategoria } from './indices-unificados-iupc.js';
import { clasificarLineaPorTexto } from './inventario-empresa.js';
import { normInsumo } from './insumo-correlacion.js';

/** A qué árbol va cada tipo que devuelve `clasificarLineaPorTexto`. */
const ARBOL_POR_TEXTO = {
  servicio: 'servicio',
  servicio_obra: 'servicio',   // lo que se factura ES la obra: un servicio, el más grande
  anticipo: 'otro',            // plata adelantada: no hay nada que inventariar todavía
  financiero: 'otro',          // arbitrajes, seguros, intereses, detracciones, penalidades
};

// 🔴 LOS DOS PATRONES QUE LE GANAN AL ESTÁNDAR, Y POR QUÉ SOLO ESTOS.
//
// Salió de un test que falló al escribirlo: «ANTICIPO DE CLIENTE» volvía
// 'insumo', porque el IUPC engancha alguna de sus palabras y la señal 1 va
// primero. Un anticipo no es un insumo por más que el estándar crea reconocer
// algo ahí.
//
// La línea que separa un caso del otro es cuán CERRADO es el patrón:
//
//  · `anticipo`, `servicio_obra` y `financiero` se disparan con palabras que
//    solo existen en su contexto: ANTICIPO, VALORIZACIÓN, ARBITRAL, SCTR,
//    DETRACCIÓN, PENALIDAD. Si una de esas aparece en la descripción, la
//    línea ES eso, diga lo que diga el resto del texto. Por eso ganan.
//
//  · `servicio` se dispara con palabras amplias que un PRODUCTO puede
//    contener perfectamente: ALQUILER, TRANSPORTE, MANTENIMIENTO, ASESORÍA.
//    «KIT DE MANTENIMIENTO» es una herramienta y «CINTA DE TRANSPORTE» una
//    faja. Esas no pueden pisar un código que el estándar reconoció: van
//    después, como red de contención de lo que el IUPC no supo.
const TEXTO_LE_GANA_AL_ESTANDAR = new Set(['anticipo', 'servicio_obra', 'financiero']);

/** Los `tipo_insumo` que la IA usa para cosas que SÍ son un bien. */
const TIPOS_DE_BIEN = new Set(['material', 'herramienta', 'epp', 'maquinaria']);

/**
 * El árbol al que pertenece una descripción de factura.
 *
 * @param {object} linea   una línea de `extraerLineasDeFacturas` — se usan
 *                         `nombre` y `tipoInsumo`. También acepta un string
 *                         suelto (entonces solo corren las señales 1 y 2).
 * @param {object} opts    { terminosCustom } — el diccionario propio de la
 *                         empresa. 🔴 NO es opcional en la práctica: le gana a
 *                         la base oficial (regla 8) y sin pasarlo esta
 *                         pregunta se contestaría distinto que en el resto de
 *                         la app.
 * @returns {'insumo'|'servicio'|'otro'|'desconocido'}
 */
export function arbolDeNombre(linea, opts = {}) {
  const nombre = typeof linea === 'string' ? linea : String(linea?.nombre || '');
  const tipoInsumo = typeof linea === 'string' ? null : (linea?.tipoInsumo || null);
  if (!nombre.trim()) return 'desconocido';

  const porTexto = clasificarLineaPorTexto(nombre);

  // 0. Lo contractual y lo financiero le ganan al estándar: ver
  //    `TEXTO_LE_GANA_AL_ESTANDAR`. Son patrones cerrados y el IUPC no tiene
  //    nada que decir sobre un anticipo o una detracción.
  if (porTexto && TEXTO_LE_GANA_AL_ESTANDAR.has(porTexto)) return ARBOL_POR_TEXTO[porTexto];

  // 1. El estándar (con el diccionario propio encima).
  const cod = clasificarConIUPC(nombre, { terminosCustom: opts.terminosCustom }).codigo;
  if (cod && cod !== 'sin_clasificar') {
    return tipoDeCategoria(cod) === 'servicio' ? 'servicio' : 'insumo';
  }

  // 2. El texto de la factura, para lo que el estándar no cubre.
  if (porTexto && ARBOL_POR_TEXTO[porTexto]) return ARBOL_POR_TEXTO[porTexto];

  // 3. Lo que anotó la IA al leer la factura.
  if (tipoInsumo === 'servicio') return 'servicio';
  if (TIPOS_DE_BIEN.has(String(tipoInsumo || ''))) return 'insumo';

  return 'desconocido';
}

/**
 * El árbol de cada nombre único de una lista de líneas.
 * → Map(nombreNorm → 'insumo'|'servicio'|'otro'|'desconocido')
 *
 * Un nombre se clasifica UNA vez (son miles de líneas y clasificar de más es
 * regalado). Gana la primera línea que lo trae: dos líneas con la misma
 * descripción y distinto `tipo_insumo` son el mismo artículo mal tipeado una
 * de las dos veces, no dos artículos.
 */
export function arbolPorNombre(lineas, opts = {}) {
  const m = new Map();
  for (const l of (lineas || [])) {
    const k = l?.nombreNorm || normInsumo(l?.nombre);
    if (!k || m.has(k)) continue;
    m.set(k, arbolDeNombre(l, opts));
  }
  return m;
}

// ── LAS SUB-PESTAÑAS DE CORRELACIONES ──────────────────────────────
/**
 * ¿Un nombre de este árbol entra en la pestaña `pestania`?
 *
 * 🔴 LO `desconocido` ENTRA EN LAS TRES. Es la regla que ya existía y hay que
 * conservarla: si una forma de escribir algo no se reconoce, su gemela puede
 * estar en cualquiera de los tres lados, y dejarla en una sola pestaña la
 * condenaría a no poder correlacionarse nunca — que es justo el par que más
 * falta hace unir. Lo que cambió es que ahora `desconocido` significa «no sé»
 * de verdad: lo que el sistema SÍ sabe que no es ni insumo ni servicio va a
 * 'otro', y 'otro' vive en UNA sola pestaña.
 */
export function entraEnPestania(arbol, pestania) {
  if (arbol === 'desconocido') return true;
  return arbol === pestania;
}

/** Cuántos nombres cayeron en cada árbol (para los contadores de pantalla). */
export function contarArboles(arbolPorNombre) {
  const out = { insumo: 0, servicio: 0, otro: 0, desconocido: 0 };
  for (const v of (arbolPorNombre?.values?.() || [])) {
    if (out[v] != null) out[v]++;
  }
  return out;
}

// ── «ESTO NO VA AL INVENTARIO» ─────────────────────────────────────
// La tercera respuesta que faltaba, y la única que saca una descripción de la
// pantalla para siempre.
//
// Gabriel puede marcar una descripción como «no es un insumo» y deja de
// aparecer: ni en Correlaciones, ni contando cantidades en el inventario de
// la empresa. Va por DESCRIPCIÓN y no por par, porque marcar un par no sirve
// de nada — la misma descripción vuelve a aparecer mañana contra otro nombre.
//
// Vive en `cotejo_decisiones` (mig 196) con ámbito 'inventario': es la tabla
// genérica de «esto ya lo contestó una persona», tiene índice [ambito+llave],
// sincroniza sola y `decidirCotejo(..., decision: null)` ya sabe deshacer. Una
// tabla nueva para guardar un sí/no por descripción sería una migración, una
// entrada en el SyncEngine y un hook, para lo mismo.
export const AMBITO_NO_INVENTARIO = 'inventario';
export const DECISION_NO_INVENTARIO = 'no_inventariable';

/** La llave con la que se guarda la decisión de una descripción. */
export const llaveNoInventario = (nombre) => normInsumo(nombre);

/**
 * El conjunto de descripciones marcadas «no va al inventario».
 * @param filas  `cotejo_decisiones` tal como las entrega el hook
 * @returns Set(nombreNorm)
 */
export function noInventariables(filas) {
  const out = new Set();
  for (const f of (filas || [])) {
    if (!f || f.deleted_at) continue;
    if (f.ambito !== AMBITO_NO_INVENTARIO) continue;
    if (f.decision !== DECISION_NO_INVENTARIO) continue;
    if (f.llave) out.add(String(f.llave));
  }
  return out;
}
