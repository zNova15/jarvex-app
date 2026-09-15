// ═══════════════════════════════════════════════════════════════════
// JARVEX — BUSCAR UNA CLASIFICACIÓN POR SU DICCIONARIO (tanda 8, 15-set-2026).
//
// EL DEFECTO QUE ARREGLA. Gabriel, probando la pantalla: «quería buscar
// "Clavos" en el diccionario ley para poder guiarme de la ley que colocamos,
// cuando busqué no me salió». Y no salía: el buscador de «Clasificaciones y
// diccionario» solo miraba el NOMBRE y el CÓDIGO de cada clasificación. Como
// ninguna de las 95 se llama «clavos» —la que los contiene se llama
// «[26] Clavos» en el IUPC, pero «clavo de acero», «clavo de calamina» y las
// otras 930 palabras del Anexo 2 son TÉRMINOS, no nombres—, escribir una
// palabra de factura devolvía cero resultados. El diccionario era invisible
// justo para la pregunta que la gente hace: «¿en qué índice cae esto?».
//
// POR QUÉ ES UNA CASILLA Y NO SIEMPRE. Pedido explícito: «quisiera un pequeño
// check a marcar puesto que solo lo requeriría en ciertas circunstancias».
// Buscar en el diccionario devuelve MUCHAS clasificaciones por una palabra
// común ("acero" toca ocho índices), y quien está buscando «[83] Implemento de
// seguridad» por su nombre no quiere ocho. Entonces: apagada por defecto, y
// cuando la búsqueda por nombre no encuentra nada PERO el diccionario sí, la
// pantalla lo dice y ofrece prenderla — que es exactamente el caso de «clavos».
//
// CÓMO MATCHEA UN TÉRMINO. Por TOKENS, no por substring crudo: «clavos» tiene
// que encontrar «Clavo de acero» (singular) y «llave» tiene que encontrar
// «Llave stillson». Un `includes()` a secas falla en las dos. La regla es: una
// palabra de la búsqueda matchea una palabra del término cuando una empieza con
// la otra y la más corta tiene al menos 4 letras (así «clavo»/«clavos» y
// «tuberia»/«tuberias» matchean, pero «cal» no se lleva puesto «calamina»).
// ═══════════════════════════════════════════════════════════════════
import { normIUPC } from './indices-unificados-iupc.js';

/** El mínimo de letras para que un prefijo cuente. Debajo de eso son ruido. */
const MIN_PREFIJO = 4;

const tokens = (s) => normIUPC(s).split(' ').filter(Boolean);

/** ¿La palabra buscada y la palabra del término son la misma cosa? */
function palabrasCoinciden(buscada, palabra) {
  if (!buscada || !palabra) return false;
  if (buscada === palabra) return true;
  const [corta, larga] = buscada.length <= palabra.length ? [buscada, palabra] : [palabra, buscada];
  return corta.length >= MIN_PREFIJO && larga.startsWith(corta);
}

/**
 * ¿Este término del diccionario responde a lo que se buscó?
 * TODAS las palabras de la búsqueda tienen que aparecer en el término: buscar
 * «clavo calamina» no puede devolver todo lo que tenga «clavo».
 */
export function terminoCoincide(busqueda, termino) {
  const q = tokens(busqueda);
  if (!q.length) return false;
  const t = tokens(termino);
  if (!t.length) return false;
  return q.every(b => t.some(p => palabrasCoinciden(b, p)));
}

/** ¿El nombre o el código de la clasificación contienen lo buscado? */
export function nombreCoincide(busqueda, cat) {
  const q = normIUPC(busqueda);
  if (!q) return true;
  const label = normIUPC(cat?.label || cat?.nombre || '');
  const cod = normIUPC(cat?.codigo || '');
  return label.includes(q) || cod.includes(q);
}

/**
 * Las clasificaciones que responden a una búsqueda.
 *
 * @param q               lo que se escribió.
 * @param cats            las clasificaciones visibles (ya filtradas por árbol).
 * @param diccPorCodigo   Map código → [{termino, origen}] — el diccionario ya
 *                        armado por la pantalla (se calcula una sola vez para
 *                        las 95, ver `diccPorCodigo` en jx-catalogo-canonico).
 * @param enDiccionario   si la casilla está marcada.
 * @param maxTerminos     cuántos términos coincidentes se muestran por fila.
 * @returns [{ ...cat, porNombre, terminos[] }] — el nombre primero, después las
 *          que solo aparecen por diccionario, ordenadas por cuántos términos
 *          coincidieron.
 */
export function buscarClasificaciones({ q = '', cats = [], diccPorCodigo = null, enDiccionario = false, maxTerminos = 5 } = {}) {
  const texto = String(q || '').trim();
  if (!texto) return (cats || []).map(c => ({ ...c, porNombre: true, terminos: [] }));

  const salida = [];
  for (const c of (cats || [])) {
    const porNombre = nombreCoincide(texto, c);
    let coincidentes = [];
    if (enDiccionario && diccPorCodigo) {
      const dicc = diccPorCodigo.get(c.codigo) || [];
      coincidentes = dicc.filter(t => terminoCoincide(texto, t?.termino));
    }
    if (!porNombre && !coincidentes.length) continue;
    salida.push({ ...c, porNombre, terminos: coincidentes.slice(0, maxTerminos), nCoincidencias: coincidentes.length });
  }

  return salida.sort((a, b) => (b.porNombre ? 1 : 0) - (a.porNombre ? 1 : 0)
    || (b.nCoincidencias || 0) - (a.nCoincidencias || 0)
    || String(a.codigo).localeCompare(String(b.codigo), 'es'));
}

/**
 * EL EMPUJÓN. Cuántas clasificaciones encontraría la búsqueda si se mirara el
 * diccionario — para poder decir «"clavos" no nombra ninguna clasificación,
 * pero está en el diccionario de 3» en vez de dejar la lista vacía sin explicar
 * por qué. Devuelve 0 cuando la casilla ya está marcada (no hay nada que
 * ofrecer) o cuando la búsqueda por nombre ya encontró algo.
 */
export function cuantasEnDiccionario({ q = '', cats = [], diccPorCodigo = null } = {}) {
  const texto = String(q || '').trim();
  if (!texto || !diccPorCodigo) return 0;
  let n = 0;
  for (const c of (cats || [])) {
    if (nombreCoincide(texto, c)) continue;
    const dicc = diccPorCodigo.get(c.codigo) || [];
    if (dicc.some(t => terminoCoincide(texto, t?.termino))) n += 1;
  }
  return n;
}
