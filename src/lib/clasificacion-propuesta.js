// ═══════════════════════════════════════════════════════════════════
// JARVEX — CREAR LA CLASIFICACIÓN QUE PROPONE LA IA, SIN DUPLICAR
// (tanda 8, 15-set-2026).
//
// EL PEDIDO. Gabriel: «sería buena idea que si la IA me recomienda, tener la
// facilidad de darle a aceptar y que la IA me lo cree pero bien (cuidado
// duplique, me pareció que recomendó crear una clasificación que ya existía),
// recomendando el nombre de la clasificación y si ingresa dentro de materiales,
// servicios, etc.»
//
// HASTA ACÁ el aviso «la IA propone crear "Pinturas, barnices y recubrimientos
// químicos anticorrosivos"» era solo texto: había que ir a otra vista, escribir
// el nombre a mano y elegir el código. Con 875 descripciones por decidir, eso
// no se hace: se elige cualquier otra clasificación y se sigue.
//
// 🔴 EL DUPLICADO ES EL RIESGO REAL, NO LA COMODIDAD. La IA propone el nombre
// mirando UNA descripción, sin ver qué clasificaciones ya existen; si el botón
// creara a ciegas, tres facturas de pintura dejarían tres clasificaciones casi
// iguales y el catálogo quedaría peor que antes. Por eso acá, antes de crear:
//   1. Si ya existe una con ese nombre (normalizado), NO se crea: se ofrece la
//      que hay. Vale también contra la base oficial — si la norma ya tiene
//      «[51] Pinturas», crear una propia para lo mismo es partir el dato.
//   2. Si hay parecidas, se muestran para que la persona elija antes de crear.
//   3. El código se propone con prefijo (`PI-` / `PS-`) y, si choca con uno
//      existente, se numera. Nunca pisa el espacio oficial: eso lo valida
//      `validarClasificacion()`, que sigue siendo la última palabra.
// ═══════════════════════════════════════════════════════════════════
import { normIUPC, codigoSugerido, esCodigoOficial } from './indices-unificados-iupc.js';

const STOP = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'o', 'u', 'para', 'con', 'en', 'por', 'a']);

const palabras = (s) => normIUPC(s).split(' ').filter(w => w && !STOP.has(w));

/** Parecido de nombres por palabras compartidas (0..1). */
export function parecidoNombres(a, b) {
  const A = new Set(palabras(a));
  const B = new Set(palabras(b));
  if (!A.size || !B.size) return 0;
  let comunes = 0;
  for (const w of A) if (B.has(w)) comunes++;
  return comunes / Math.min(A.size, B.size);
}

// Las palabras que delatan un SERVICIO cuando la IA no dice a qué árbol va.
// Son las mismas que reconoce `detectarServicio()` para las descripciones de
// factura; acá se aplican al NOMBRE de la clasificación propuesta.
const PISTAS_SERVICIO = [
  'servicio', 'servicios', 'alquiler', 'alquileres', 'flete', 'fletes', 'transporte',
  'mantenimiento', 'reparacion', 'asesoria', 'consultoria', 'honorarios', 'capacitacion',
  'gestion', 'estudio', 'estudios', 'supervision', 'financiero', 'financieros', 'bancario',
  'bancarios', 'interes', 'intereses', 'seguro', 'seguros', 'publicidad', 'licencia', 'licencias',
];

/** A qué árbol va una clasificación nueva, si nadie lo dijo. */
export function arbolDeNombre(nombre) {
  const ws = new Set(palabras(nombre));
  return PISTAS_SERVICIO.some(p => ws.has(p)) ? 'servicio' : 'insumo';
}

/** El nombre, limpio y presentable, tal como va a quedar guardado. */
export function limpiarNombre(nombre) {
  const txt = String(nombre || '').replace(/\s+/g, ' ').trim().replace(/^[«"']|[»"'.]+$/g, '').trim();
  if (!txt) return '';
  return (txt[0].toUpperCase() + txt.slice(1)).slice(0, 80);
}

/**
 * Un código libre a partir del nombre. Si el sugerido ya está tomado se numera
 * (`PI-PINT-BARN-2`): dos clasificaciones distintas con el mismo código dejarían
 * a las filas del catálogo apuntando a dos cosas según qué capa gane al resolver.
 */
export function codigoLibre(nombre, arbol, cats = []) {
  const tomados = new Set((cats || []).map(c => String(c.codigo || '').trim()));
  const base = codigoSugerido(nombre, arbol);
  if (!tomados.has(base) && !esCodigoOficial(base)) return base;
  for (let i = 2; i <= 99; i++) {
    const cand = `${base}-${i}`;
    if (!tomados.has(cand) && !esCodigoOficial(cand)) return cand;
  }
  return `${base}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

/**
 * Todo lo que hace falta para decidir si se crea o se reusa.
 *
 * @param nombre  el que propuso la IA.
 * @param arbol   'insumo' | 'servicio' si la IA lo dijo; si no, se infiere.
 * @param cats    TODAS las clasificaciones que hay hoy (oficiales + propias).
 * @param umbral  desde qué parecido se considera «casi la misma» (0..1).
 * @returns {{ ok, error?, nombre, codigo, arbol, yaExiste, parecidas }}
 *          `yaExiste` es la clasificación que ya cubre esto: cuando viene, NO
 *          hay que crear nada — se usa ésa.
 */
export function prepararClasificacionNueva({ nombre, arbol = null, cats = [], umbral = 0.75 } = {}) {
  const nom = limpiarNombre(nombre);
  if (!nom) return { ok: false, error: 'La IA no dio un nombre usable.' };
  const arb = arbol === 'servicio' || arbol === 'insumo' ? arbol : arbolDeNombre(nom);

  const mismoArbol = (c) => {
    const a = c?.arbol === 'servicio' ? 'servicio' : 'insumo';
    // Las complementarias (administrativos, servicios en general) se ofrecen
    // en el árbol de insumos, igual que en la pantalla: son el cajón de lo que
    // la norma no contempla y compiten con cualquier propuesta nueva.
    return a === arb || (arb === 'insumo' && c?.arbol === 'complementaria');
  };

  const nNom = normIUPC(nom);
  const candidatas = (cats || []).filter(mismoArbol);
  const exacta = candidatas.find(c => normIUPC(c.nombre || c.label) === nNom) || null;

  const parecidas = exacta ? [] : candidatas
    .map(c => ({ cat: c, score: parecidoNombres(nom, c.nombre || c.label) }))
    .filter(x => x.score >= umbral)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return {
    ok: true,
    nombre: nom,
    arbol: arb,
    codigo: codigoLibre(nom, arb, cats),
    yaExiste: exacta,
    parecidas,
  };
}
