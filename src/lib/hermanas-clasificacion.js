// ═══════════════════════════════════════════════════════════════════
// JARVEX — «SUS HERMANAS YA SE DECIDIERON, Y DISTINTO» (tanda 3, 15-set-2026).
//
// EL PROBLEMA, con el caso que lo pidió. «TUBO E. CUAD. 3/4IN * 1.2» y
// «TUBO E. CUAD. 3/4IN * 1.5» son el mismo tubo en dos espesores. Se deciden
// con tres días de diferencia, por dos personas, y quedan en dos
// clasificaciones distintas. Nadie se entera: son dos filas de 900 que no se
// ven juntas nunca —el orden por defecto es por plata, no alfabético— y el
// costo de la obra queda repartido entre dos códigos que después no cierran.
//
// Lo mismo, medido en producción (tanda 1): las cinco maneras de escribir
// ABRAZADERA habían quedado en cinco clasificaciones distintas.
//
// LA RESPUESTA ES UN AVISO, NO UN AUTOMATISMO. Acá no se corrige nada solo:
// la fila muestra «3 hermanas ya decididas como [03]» al lado de una propuesta
// que dice [65], y quien decide elige. Arreglar la contradicción a espaldas de
// la persona sería repetir el error del recorrido con IA que aplicaba solo.
//
// ── POR QUÉ LA RAÍZ ES ASÍ DE ESTRICTA ────────────────────────────
// Dos descripciones son hermanas cuando dicen LA MISMA COSA en distinta
// medida: se les sacan los números, las unidades y la marca, y lo que queda
// tiene que ser idéntico. Es a propósito más angosto que el motor de
// correlación (`insumo-correlacion.js`, que puntúa parecidos): un aviso que
// salta de más se vuelve invisible a la segunda vez que alguien lo lee y no es
// cierto. Se prefiere avisar de menos.
//   «TUBO E. CUAD. 3/4IN * 1.2»  → raíz «cuad tubo»   ┐ hermanas
//   «TUBO E. CUAD. 3/4IN * 1.5»  → raíz «cuad tubo»   ┘
//   «TUBO PVC 2"»                → raíz «pvc tubo»    ← otra familia
//
// Lib PURA: sin React, sin Dexie, sin fetch.
// ═══════════════════════════════════════════════════════════════════

const ACENTOS = /[̀-ͯ]/g;

// Palabras que no distinguen una descripción de otra: conectores, unidades y
// los rótulos con los que el proveedor adorna («marca», «color», «tipo»).
const VACIAS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'con', 'para', 'por', 'en', 'y', 'a', 'un', 'una',
  'al', 'su', 'o', 'e', 'x', 'tipo', 'clase', 'marca', 'medida', 'color', 'modelo', 'serie',
  'mm', 'cm', 'mts', 'mt', 'm', 'ml', 'm2', 'm3', 'kg', 'kgs', 'gr', 'grs', 'lt', 'lts', 'gl',
  'und', 'unid', 'unidad', 'unidades', 'pza', 'pzas', 'pulg', 'in', 'ft', 'pie', 'pies',
  'bls', 'bolsa', 'bolsas', 'caja', 'cajas', 'rollo', 'rollos', 'par', 'pares', 'juego',
]);

/**
 * La raíz de una descripción: lo que queda después de sacarle las medidas.
 *
 * Devuelve '' cuando no alcanza para decir que dos cosas son la misma —menos
 * de dos palabras con contenido— y entonces la fila no tiene hermanas. Un aviso
 * basado en la palabra «tubo» sola sería ruido puro.
 */
export function raizDeDescripcion(texto) {
  const norm = String(texto || '')
    .normalize('NFD').replace(ACENTOS, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!norm) return '';
  const crudos = norm.split(' ');
  const utiles = [];
  for (let i = 0; i < crudos.length; i++) {
    const t = crudos[i];
    // La palabra que viene DESPUÉS de «marca» es la marca, y la marca no
    // cambia qué es la cosa: «MESA DE MELAMINE MARCA QUADRA» y «MESA DE
    // MELAMINE 1.20» son la misma mesa.
    if (crudos[i - 1] === 'marca') continue;
    if (t.length < 3) continue;          // «e», «cm», «x», «3»
    if (/\d/.test(t)) continue;          // «14mm», «3/4in» (ya sin barra), «1200»
    if (VACIAS.has(t)) continue;
    utiles.push(t);
  }
  const unicos = [...new Set(utiles)].sort();
  return unicos.length >= 2 ? unicos.join(' ') : '';
}

/** La identidad de una descripción: para no contar dos veces la misma. */
export const normTexto = (s) => String(s || '')
  .normalize('NFD').replace(ACENTOS, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * El índice de lo YA decidido, agrupado por raíz.
 *
 * @param decididas [{texto, codigo}] — una entrada por descripción decidida.
 *                  `texto` es la descripción como salió de la factura y
 *                  `codigo` la clasificación con la que quedó. Las que no
 *                  tienen código (por ejemplo «no es un insumo») no entran:
 *                  no contradicen a nadie. Si la misma descripción llega dos
 *                  veces —la decisión de la bandeja Y el término que esa misma
 *                  decisión le enseñó al diccionario— cuenta UNA: gana la
 *                  primera, así que pasá las decisiones antes que el diccionario.
 * @returns Map(raíz → Map(codigo → {codigo, items:[{norm, texto}]}))
 */
export function indiceDeHermanas(decididas) {
  const idx = new Map();
  const vistos = new Set();
  for (const d of (decididas || [])) {
    const codigo = String(d?.codigo || '').trim();
    if (!codigo || codigo === 'sin_clasificar') continue;
    const clave = normTexto(d?.texto);
    if (!clave || vistos.has(clave)) continue;
    const raiz = raizDeDescripcion(d?.texto);
    if (!raiz) continue;
    vistos.add(clave);
    let porCodigo = idx.get(raiz);
    if (!porCodigo) { porCodigo = new Map(); idx.set(raiz, porCodigo); }
    const item = { norm: clave, texto: String(d?.texto || '') };
    const prev = porCodigo.get(codigo);
    if (prev) prev.items.push(item);
    else porCodigo.set(codigo, { codigo, items: [item] });
  }
  return idx;
}

/**
 * Las hermanas ya decididas de esta descripción, de la más repetida a la menos.
 * `null` si no tiene ninguna (que es el caso normal).
 *
 * 🔴 UNA FILA NO ES HERMANA DE SÍ MISMA. Una descripción ya decidida está en el
 * índice, así que sin sacarse a sí misma su propio código siempre aparecería
 * entre los de las hermanas y NUNCA se avisaría de la contradicción — que es
 * justo el caso que hay que ver: la que quedó sola en otro código.
 */
export function hermanasDe(texto, indice) {
  const raiz = raizDeDescripcion(texto);
  if (!raiz || !indice) return null;
  const porCodigo = indice.get(raiz);
  if (!porCodigo || !porCodigo.size) return null;
  const yo = normTexto(texto);
  const codigos = [];
  for (const c of porCodigo.values()) {
    const otras = c.items.filter(i => i.norm !== yo);
    if (!otras.length) continue;
    codigos.push({ codigo: c.codigo, veces: otras.length, ejemplo: otras[0].texto });
  }
  if (!codigos.length) return null;
  codigos.sort((a, b) => b.veces - a.veces);
  return { raiz, codigos, total: codigos.reduce((s, c) => s + c.veces, 0) };
}

/**
 * El aviso, si hay contradicción: esta propuesta dice una cosa y las hermanas
 * ya decididas dicen otra.
 *
 * Devuelve `null` cuando no hay nada que avisar — incluido el caso de que el
 * código propuesto YA sea uno de los que eligieron las hermanas, aunque no sea
 * el más repetido: si a alguien le pareció bien dos veces, no es una
 * contradicción, es una familia que se decidió con criterios distintos y eso lo
 * resuelve el panel de auditoría, no un cartel por fila.
 */
export function avisoDeContradiccion(codigoPropuesto, hermanas) {
  const cod = String(codigoPropuesto || '').trim();
  if (!cod || !hermanas?.codigos?.length) return null;
  if (hermanas.codigos.some(c => c.codigo === cod)) return null;
  const dominante = hermanas.codigos[0];
  return {
    codigo: dominante.codigo,
    veces: dominante.veces,
    ejemplo: dominante.ejemplo,
    total: hermanas.total,
    // Cuando las hermanas dicen todas lo mismo, el aviso es una afirmación;
    // cuando ya venían divididas, es una advertencia más floja y se dice así.
    unanime: hermanas.codigos.length === 1,
  };
}
