// ═══════════════════════════════════════════════════════════════════
// JARVEX — LAS BANDAS DE UNA CORRELACIÓN (tanda 4, 15-sep-2026). Lib PURA.
//
// POR QUÉ EXISTE. El recorrido con IA de Correlaciones le pregunta a la IA
// por CADA par y CADA grupo que propone el motor local. Contra la base real
// eso es del orden de mil preguntas por entidad, a 1,1 s de turno cada una:
// media hora de espera, y buena parte gastada en cosas que no son una duda.
// «CLAVO N 3» contra «CLAVOS NRO 3» no necesita una IA: son la misma frase
// escrita por dos personas distintas.
//
// QUÉ HACE. Parte los candidatos en DOS bandas, antes de gastar nada:
//
//   · `obvio`     — los dos nombres dicen EXACTAMENTE lo mismo: cada palabra
//                   de uno tiene su par en el otro (plural, abreviatura o
//                   sinónimo de escritura), las MEDIDAS son idénticas y se
//                   facturan en la MISMA unidad. No se pregunta: se deja una
//                   propuesta local con su motivo.
//   · `consultar` — sobra algo de un lado: una palabra que el otro no tiene,
//                   o una medida que solo aparece en uno. AHÍ sí vale pagar la
//                   IA, porque es exactamente donde el parecido de texto
//                   engaña («CEMENTO SOL» contra «CEMENTO SOL X 42.5 KG»).
//
// 🔴 `obvio` ES ESTRICTO A PROPÓSITO: exige que NO sobre NADA de ninguno de
// los dos lados. Es la única definición que no puede colar una diferencia
// real. Errar hacia `consultar` cuesta 1,1 s y una fracción de centavo; errar
// hacia `obvio` pone una propuesta verde al lado de dos insumos distintos, que
// es como se fabrica un inventario que no cuadra. Ante la duda, se consulta.
//
// 🔴 Y `obvio` TAMPOCO DECIDE: deja una propuesta, igual que la IA. El botón
// «Unir» lo sigue apretando una persona. Lo que se ahorra es la pregunta, no
// la revisión.
//
// ── LA UNIDAD ENTRA A DECIDIR (tanda 2, 15-set-2026) ───────────────
// Hasta hoy esto comparaba SOLO texto, igual que el motor. Medido sobre los
// 160 pares ya decididos: trece «mismo insumo» tienen unidades incompatibles
// (alambre en kg contra alambre en und, tubo en m contra tubo en und, botas
// en par contra botas en und). Varios de esos caían en `obvio` —las palabras
// coinciden al 100%— y se proponían sin preguntar. Ahora un choque de unidad
// manda el par a `consultar`: ver `unidadesEnConflicto` abajo, que explica por
// qué eso NO es lo mismo que marcarlos «distintos».
//
// El criterio de qué palabra empareja con cuál NO se reescribe acá: se importa
// `tokenMatch`/`tokensParaScore` de `insumo-correlacion.js`, el mismo que
// calcula el score que puso a estos dos nombres juntos. Dos definiciones de
// «parecido» serían dos pantallas contando historias distintas del mismo par.
// Con la unidad pasa igual: `normUnidad` viene de `inventario-empresa.js`, que
// es donde vive la tabla de sinónimos del OCR ("und"/"unidad"/"each") y la que
// usa el inventario para decidir qué cantidades se pueden sumar.
// ═══════════════════════════════════════════════════════════════════
import { tokensParaScore, tokenMatch } from './insumo-correlacion.js';
import { normUnidad, labelUnidad } from './inventario-empresa.js';

// ── SINÓNIMOS DE ESCRITURA, no de significado ─────────────────────
// Solo entran formas que son LA MISMA PALABRA abreviada o en plural, tal como
// aparecen en las facturas peruanas. NO entran equivalencias de criterio
// («fierro» ≈ «acero», una marca contra el genérico): esas son justamente la
// pregunta que se le hace a la IA, y contestarlas acá sería contestar por ella.
//
// Tampoco entran unidades de MAGNITUD distinta: mm no es cm y kg no es g.
// Confundirlas es la falla que esta lib tiene que evitar, no cometer.
const SINONIMOS = new Map(Object.entries({
  // número
  n: 'n', nro: 'n', nros: 'n', num: 'n', nume: 'n', numero: 'n', numeros: 'n', no: 'n',
  // pulgada
  pulg: 'pulg', pulgs: 'pulg', plg: 'pulg', pulgada: 'pulg', pulgadas: 'pulg',
  // unidad / pieza suelta
  und: 'und', unds: 'und', unid: 'und', unidad: 'und', unidades: 'und',
  pza: 'und', pzas: 'und', pieza: 'und', piezas: 'und',
  // kilo
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogramo: 'kg', kilogramos: 'kg',
  // metro
  m: 'm', mt: 'm', mts: 'm', metro: 'm', metros: 'm',
  // galón
  gal: 'gal', gln: 'gal', galon: 'gal', galones: 'gal',
  // litro
  lt: 'lt', lts: 'lt', litro: 'lt', litros: 'lt',
  // bolsa
  bls: 'bolsa', bolsa: 'bolsa', bolsas: 'bolsa',
  // caja
  cja: 'caja', caja: 'caja', cajas: 'caja',
  // millar
  mll: 'millar', millar: 'millar', millares: 'millar',
  // juego
  jgo: 'juego', jgos: 'juego', juego: 'juego', juegos: 'juego',
  // par
  par: 'par', pares: 'par',
}));

// Palabras que no dicen nada del artículo y aparecen sueltas de un solo lado.
// `insumo-correlacion.js` ya saca las suyas (de, del, con, para, x…); acá se
// suman las que solo se ven en descripciones de factura.
const RUIDO = new Set(['por', 'aprox', 'aprx', 'aproximadamente', 'cu', 'c', 'marca']);

const esMedida = (t) => /^\d/.test(t);
const canon = (t) => SINONIMOS.get(t) || t;

/** Los tokens con los que ESTA lib compara: canonizados y sin ruido. */
export function tokensDeBanda(nombre) {
  return tokensParaScore(nombre).map(canon).filter(t => t && !RUIDO.has(t));
}

// ── LA UNIDAD, QUE ESTABA AHÍ Y NADIE MIRABA (tanda 2, 15-set-2026) ─
/**
 * ¿Las dos líneas se facturan en unidades que NO son la misma magnitud?
 *
 * 🔴 EL HALLAZGO (medido el 15-set sobre los 160 pares ya decididos): TRECE
 * pares aceptados como «mismo insumo» tienen unidades incompatibles.
 *   · «ALAMBRE DE AMARRE 16» (und)  =  «ALAMBRE NEGRO 16» (kg)
 *   · «TUBO HDPE … 110 mm» (und)    =  «TUBO HDPE … 110 mm» (m)
 *   · «BOTAS DE SEGURIDAD…» (und)   =  «BOTAS DE SEGURIDAD…» (par)
 *   · «TARUGO PVC 3/8» (und)        =  «TARUGOS 3/8» (docena)
 * Unir und con kg no junta dos filas: las deja como dos cantidades que nadie
 * puede sumar, y encima APAGA el comparador de precios —`proveedorMasBarato`
 * devuelve null en cuanto ve dos unidades— sin decir por qué.
 *
 * Gabriel, 15-set: «no compara unidades».
 *
 * 🔴 PERO UNA UNIDAD DISTINTA NO ES UN «SON DISTINTOS». Es, casi siempre, el
 * MISMO insumo en otra presentación, y eso se resuelve con un factor de
 * conversión, no con un rechazo — es la misma regla que el prompt de MAPEAR
 * ya usa contra el presupuesto («kg contra varilla no descarta la
 * coincidencia»). Por eso esto NO baja el score ni decide nada: solo saca el
 * par de la banda `obvio`, que es la que se resuelve sin preguntar. Un par
 * cuyas palabras coinciden al 100% pero se factura en kg y en und es
 * exactamente el caso que hay que mirar.
 *
 * Una unidad vacía o desconocida no acusa nada: en producción las 3.517
 * líneas traen unidad, pero una fila cargada a mano puede no tenerla y
 * fabricar una duda donde no la hay.
 */
export function unidadesEnConflicto(ua, ub) {
  const a = normUnidad(ua), b = normUnidad(ub);
  if (!a || !b) return null;
  if (a === b) return null;
  return { a, b, labelA: labelUnidad(a), labelB: labelUnidad(b) };
}

const motivoUnidad = (u) =>
  `Se facturan en unidades distintas: «${u.labelA}» contra «${u.labelB}». `
  + 'Puede ser el mismo insumo en otra presentación (hace falta un factor), o dos cosas distintas.';

/**
 * En qué banda cae un PAR de nombres.
 * → { banda: 'obvio'|'consultar', razon, motivo, sobrantes: { a: [], b: [] } }
 *
 * `razon` es para la pantalla, no para decidir:
 *   · 'identico' — no sobra nada: es la banda `obvio`.
 *   · 'unidad'   — dicen lo mismo pero se facturan en unidades de magnitud
 *                  distinta (kg contra und). Ver `unidadesEnConflicto`.
 *   · 'medida'   — lo que sobra incluye una medida (la diferencia más cara de
 *                  equivocar: 1/2 no es 3/4).
 *   · 'palabra'  — sobra una palabra: material, marca, presentación… ahí la IA
 *                  aporta de verdad.
 *
 * opts.unidadA / opts.unidadB: la unidad de la factura de cada nombre, tal
 * como la escribió el OCR ("und", "UNIDAD", "kg", "each"…) — se canoniza acá.
 */
export function bandaDePar(a, b, opts = {}) {
  const ta = tokensDeBanda(a);
  const tb = tokensDeBanda(b);
  const conflictoU = unidadesEnConflicto(opts.unidadA, opts.unidadB);
  if (!ta.length || !tb.length) {
    return {
      banda: 'consultar', razon: 'palabra',
      motivo: 'Uno de los dos nombres no tiene palabras con las que comparar.',
      sobrantes: { a: ta, b: tb }, unidades: conflictoU,
    };
  }

  const usados = new Set();
  const sobranA = [];
  for (const t of ta) {
    const j = tb.findIndex((u, i) => !usados.has(i) && tokenMatch(t, u));
    if (j >= 0) usados.add(j);
    else sobranA.push(t);
  }
  const sobranB = tb.filter((_, i) => !usados.has(i));

  if (!sobranA.length && !sobranB.length) {
    // Las palabras dicen lo mismo. Si además la unidad coincide, no hay nada
    // que preguntar. Si NO coincide, esto deja de ser evidente: es el par
    // «ALAMBRE 16 en kg» contra «ALAMBRE 16 en und».
    if (conflictoU) {
      return {
        banda: 'consultar', razon: 'unidad',
        motivo: `Las palabras dicen lo mismo, pero ${motivoUnidad(conflictoU).charAt(0).toLowerCase()}${motivoUnidad(conflictoU).slice(1)}`,
        sobrantes: { a: [], b: [] }, unidades: conflictoU,
      };
    }
    return {
      banda: 'obvio', razon: 'identico',
      motivo: 'Los dos nombres dicen lo mismo: las mismas palabras y las mismas medidas, escritas distinto.',
      sobrantes: { a: [], b: [] }, unidades: null,
    };
  }

  const hayMedida = sobranA.some(esMedida) || sobranB.some(esMedida);
  const lista = (xs) => xs.map(x => `«${x}»`).join(', ');
  const motivoTexto = hayMedida
    ? `Una trae una medida que la otra no: ${lista([...sobranA, ...sobranB].filter(esMedida))}.`
    : `Se diferencian en ${lista([...sobranA, ...sobranB])}.`;
  return {
    banda: 'consultar',
    razon: hayMedida ? 'medida' : 'palabra',
    // La medida sigue siendo la razón principal (es la más cara de
    // equivocar), pero si además las unidades chocan se dice: son dos cosas
    // que la persona tiene que mirar, no una.
    motivo: conflictoU ? `${motivoTexto} Y ${motivoUnidad(conflictoU).charAt(0).toLowerCase()}${motivoUnidad(conflictoU).slice(1)}` : motivoTexto,
    sobrantes: { a: sobranA, b: sobranB },
    unidades: conflictoU,
  };
}

/**
 * En qué banda cae un GRUPO de N variantes.
 *
 * Es `obvio` solo si TODOS los pares de adentro lo son. Con que uno solo sea
 * dudoso, el grupo entero va a la IA: la pregunta que se le hace es «cuáles de
 * estas N son la misma», y no tiene sentido contestar media pregunta sola.
 *
 * O(n²), con n ≤ 20 (el tope de `sugerirClusters`): 190 comparaciones en el
 * peor caso, nada al lado de un viaje a la red.
 *
 * opts.unidadDe(nombre) → la unidad de factura de esa variante (tanda 2). Es
 * una función y no un mapa porque el llamador ya tiene el índice armado
 * (`muestraDe`) y copiarlo a un objeto sería un paso de más por cada grupo.
 */
export function bandaDeGrupo(variantes, opts = {}) {
  const lista = [...new Set((variantes || []).map(v => String(v || '').trim()).filter(Boolean))];
  const unidadDe = typeof opts.unidadDe === 'function' ? opts.unidadDe : () => '';
  if (lista.length < 2) {
    return { banda: 'consultar', razon: 'palabra', motivo: 'Hacen falta al menos dos variantes.', dudosos: [] };
  }
  const dudosos = [];
  for (let i = 0; i < lista.length; i++) {
    for (let j = i + 1; j < lista.length; j++) {
      const r = bandaDePar(lista[i], lista[j], {
        unidadA: unidadDe(lista[i]), unidadB: unidadDe(lista[j]),
      });
      if (r.banda !== 'obvio') dudosos.push({ a: lista[i], b: lista[j], ...r });
    }
  }
  if (!dudosos.length) {
    return {
      banda: 'obvio', razon: 'identico', dudosos: [],
      motivo: `Las ${lista.length} variantes dicen lo mismo: las mismas palabras, las mismas medidas y la misma unidad, escritas distinto.`,
    };
  }
  // El ejemplo que se muestra es el más caro de equivocar: primero una medida
  // que no cuadra, después una unidad que no cuadra, y al final una palabra.
  const ejemplo = dudosos.find(d => d.razon === 'medida')
    || dudosos.find(d => d.razon === 'unidad')
    || dudosos[0];
  return {
    banda: 'consultar',
    razon: ejemplo.razon,
    motivo: `${dudosos.length} ${dudosos.length === 1 ? 'par del grupo no es evidente' : 'pares del grupo no son evidentes'}. Por ejemplo: ${ejemplo.motivo}`,
    dudosos,
  };
}

/** La confianza con la que se muestra una propuesta local de banda `obvio`. */
export const CONFIANZA_OBVIO = 0.96;

/**
 * Cuántos de una lista de bandas ya calculadas se resuelven sin gastar IA.
 * Lo usa el botón del recorrido para decir, ANTES de arrancar, cuántas
 * preguntas se van a hacer de verdad.
 */
export function contarPorBanda(bandas) {
  let obvios = 0, consultas = 0;
  for (const b of (bandas || [])) {
    if (b?.banda === 'obvio') obvios++;
    else consultas++;
  }
  return { obvios, consultas, total: obvios + consultas };
}
