// ═══════════════════════════════════════════════════════════════════
// JARVEX — «ESTOS TRES PARECEN EL MISMO» DENTRO DEL INVENTARIO
// (16-set-2026). Lib PURA.
//
// ── DE DÓNDE SALE ─────────────────────────────────────────────────
// De mirar las 32 correlaciones que Gabriel hizo el 16-set a mano, que son
// la mejor descripción que hay de cómo piensa el inventario:
//
//   llave stillson 36" ↔ 24" ↔ 18" ↔ 12" ↔ 8"      → el MISMO insumo
//   comba ↔ comba de mano 2kg ↔ comba 20 lb 9 kg   → el MISMO insumo
//   hacha 4 lb truper ↔ hacha leñadora 4 1/2 lbs   → el MISMO insumo
//   cincel sds max dewalt ↔ cinceles ↔ cincel 3/4  → el MISMO insumo
//   pico de construcción ↔ zapapico ↔ picos        → el MISMO insumo
//   perno hex 3/8-16 x 2 ↔ tuerca hex 3/8-16       → DISTINTOS
//   martillo de bola ↔ martillo demoledor          → DISTINTOS
//
// Para las HERRAMIENTAS, la medida no separa y la marca tampoco: lo que
// decide es la primera palabra —la CABEZA— porque el inventario de una
// ferretería se lleva por tipo de herramienta, no por SKU. Y cuando la cabeza
// cambia (perno/tuerca, martillo/martillo demoledor), son cosas distintas
// aunque compartan todos los números.
//
// ── POR QUÉ ESTO NO VA EN EL SCORER GLOBAL ────────────────────────
// 🔴 Lo medí antes de escribirlo. Meter «misma cabeza relaja la medida» en
// `scoreDeTokens` sube el recall contra las decisiones de Gabriel de 76% a
// 84% (recupera 17 pares reales)… y genera **15.648 pares nuevos** en el
// resto de la base. Resucita los cuatro controles adversariales de la lib
// (clavo de 8 ↔ clavo de 4, aceite 10W30 ↔ 20W50, codo x45 ↔ x90, reducción
// 1"x1/2 ↔ 2-1/2"a1"), que están en cero A PROPÓSITO: para los CONSUMIBLES la
// medida ES el insumo. Una cola de 15.000 preguntas no es una mejora.
//
// La misma regla que es inservible sobre 2.000 descripciones es excelente
// sobre las 4 que quedan después de escribir «marti» en el buscador: ahí el
// contexto ya lo puso la persona, y lo único que falta es ahorrarle los
// clics. Por eso vive acá y se aplica SOLO a lo que la pantalla está
// mostrando.
// ═══════════════════════════════════════════════════════════════════
import { normInsumo } from './insumo-correlacion.js';

// Las mismas stopwords del scorer, más las que solo estorban en un nombre de
// ferretería (la marca y la presentación no son la cabeza).
const RUIDO = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'con', 'para', 'por', 'en', 'y', 'a',
  'un', 'una', 'x', 'm', 'marca', 'tipo',
]);

/**
 * La CABEZA de un nombre: su primera palabra con significado.
 * «LLAVE STILSON DE 18 PULGADAS M/STANLEY» → «llave»
 * «MARTILLO DEMOLEDOR TOTAL 1700KW»        → «martillo»
 */
export function cabezaDe(nombre) {
  const t = normInsumo(nombre).split(' ').filter(w => w && !RUIDO.has(w) && !/^\d/.test(w));
  return t[0] || null;
}

/**
 * La cabeza de DOS palabras, cuando la primera sola no alcanza para separar.
 * «martillo demoledor» ≠ «martillo de bola»: Gabriel los marcó distintos, así
 * que proponer un grupo con los dos adentro sería proponerle algo que ya
 * contestó que no. Se usa para PARTIR un grupo grande, nunca para juntar.
 */
export function cabezaLarga(nombre) {
  const t = normInsumo(nombre).split(' ').filter(w => w && !RUIDO.has(w) && !/^\d/.test(w));
  return t.slice(0, 2).join(' ') || null;
}

/**
 * Los grupos de insumos VISIBLES que comparten cabeza y todavía no están
 * unidos entre sí.
 *
 * @param insumos  las filas que la pantalla está mostrando (ya filtradas).
 * @param opts.grupoDe   Map de `construirGrupos()`: lo ya unido no se propone.
 * @param opts.resueltos Map de `resolverPares()`: un par ya contestado
 *                       «distinto» no se vuelve a proponer.
 * @param opts.max       tope de filas visibles para molestarse en sugerir.
 * @returns [{ cabeza, insumos: [...] }] — solo grupos de 2 o más.
 */
export function sugerirPorCabeza(insumos, { grupoDe = null, resueltos = null, max = 40 } = {}) {
  const filas = (insumos || []).filter(Boolean);
  // Sobre una lista larga esto es ruido: la sugerencia vale porque la persona
  // ya acotó con el buscador y está mirando esas filas.
  if (!filas.length || filas.length > max) return [];

  // 🔴 SINGULAR Y PLURAL SON LA MISMA CABEZA. Lo destapó el test: «CINCELES»
  // y «CINCEL SDS MAX DEWALT» no se agrupaban por comparar las cabezas con
  // ===. Se canoniza cada cabeza a la MÁS CORTA de las presentes que sea su
  // prefijo —el mismo criterio de `tokenMatch` del scorer, con su piso de 4
  // letras— así que cincel/cinceles, brocha/brochas y palana/palanas caen en
  // el mismo cajón sin una lista de plurales que mantener.
  const crudas = filas.map(i => cabezaDe(i.display));
  const raices = [...new Set(crudas.filter(c => c && c.length >= 3))].sort((a, b) => a.length - b.length);
  const canonica = (c) => {
    if (!c) return null;
    for (const r of raices) {
      if (r.length >= 4 && r.length < c.length && c.startsWith(r)) return r;
    }
    return c;
  };

  const porCabeza = new Map();
  filas.forEach((ins, i) => {
    const c = canonica(crudas[i]);
    if (!c || c.length < 3) return;
    if (!porCabeza.has(c)) porCabeza.set(c, []);
    porCabeza.get(c).push(ins);
  });

  const claveGrupo = (ins) => {
    const n = normInsumo(ins.display);
    return (grupoDe && grupoDe.get(n)) || n;
  };
  const yaDistintos = (a, b) => {
    if (!resueltos) return false;
    const k = [normInsumo(a.display), normInsumo(b.display)].sort().join('|');
    return resueltos.get(k)?.relacion === 'distinto';
  };

  const salida = [];
  for (const [cabeza, miembros] of porCabeza) {
    if (miembros.length < 2) continue;
    // Ya unidos entre sí: no hay nada que proponer.
    if (new Set(miembros.map(claveGrupo)).size < 2) continue;

    // Partir por cabeza larga cuando adentro hay un par ya marcado DISTINTO
    // («martillo de bola» vs «martillo demoledor»): proponer el grupo entero
    // sería repreguntar algo contestado.
    const hayChoque = miembros.some((a, i) =>
      miembros.slice(i + 1).some(b => yaDistintos(a, b)));
    const bloques = hayChoque
      ? [...miembros.reduce((m, ins) => {
          const k = cabezaLarga(ins.display) || cabeza;
          if (!m.has(k)) m.set(k, []);
          m.get(k).push(ins);
          return m;
        }, new Map())].map(([k, v]) => ({ cabeza: k, insumos: v }))
      : [{ cabeza, insumos: miembros }];

    for (const b of bloques) {
      if (b.insumos.length < 2) continue;
      if (new Set(b.insumos.map(claveGrupo)).size < 2) continue;
      if (b.insumos.some((a, i) => b.insumos.slice(i + 1).some(x => yaDistintos(a, x)))) continue;
      salida.push(b);
    }
  }
  // Primero los que resuelven más filas de un golpe.
  salida.sort((a, b) => b.insumos.length - a.insumos.length);
  return salida;
}
