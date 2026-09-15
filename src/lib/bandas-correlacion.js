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
//                   sinónimo de escritura) y las MEDIDAS son idénticas. No se
//                   pregunta: se deja una propuesta local con su motivo.
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
// El criterio de qué palabra empareja con cuál NO se reescribe acá: se importa
// `tokenMatch`/`tokensParaScore` de `insumo-correlacion.js`, el mismo que
// calcula el score que puso a estos dos nombres juntos. Dos definiciones de
// «parecido» serían dos pantallas contando historias distintas del mismo par.
// ═══════════════════════════════════════════════════════════════════
import { tokensParaScore, tokenMatch } from './insumo-correlacion.js';

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

/**
 * En qué banda cae un PAR de nombres.
 * → { banda: 'obvio'|'consultar', razon, motivo, sobrantes: { a: [], b: [] } }
 *
 * `razon` es para la pantalla, no para decidir:
 *   · 'identico' — no sobra nada: es la banda `obvio`.
 *   · 'medida'   — lo que sobra incluye una medida (la diferencia más cara de
 *                  equivocar: 1/2 no es 3/4).
 *   · 'palabra'  — sobra una palabra: material, marca, presentación… ahí la IA
 *                  aporta de verdad.
 */
export function bandaDePar(a, b) {
  const ta = tokensDeBanda(a);
  const tb = tokensDeBanda(b);
  if (!ta.length || !tb.length) {
    return {
      banda: 'consultar', razon: 'palabra',
      motivo: 'Uno de los dos nombres no tiene palabras con las que comparar.',
      sobrantes: { a: ta, b: tb },
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
    return {
      banda: 'obvio', razon: 'identico',
      motivo: 'Los dos nombres dicen lo mismo: las mismas palabras y las mismas medidas, escritas distinto.',
      sobrantes: { a: [], b: [] },
    };
  }

  const hayMedida = sobranA.some(esMedida) || sobranB.some(esMedida);
  const lista = (xs) => xs.map(x => `«${x}»`).join(', ');
  return {
    banda: 'consultar',
    razon: hayMedida ? 'medida' : 'palabra',
    motivo: hayMedida
      ? `Una trae una medida que la otra no: ${lista([...sobranA, ...sobranB].filter(esMedida))}.`
      : `Se diferencian en ${lista([...sobranA, ...sobranB])}.`,
    sobrantes: { a: sobranA, b: sobranB },
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
 */
export function bandaDeGrupo(variantes) {
  const lista = [...new Set((variantes || []).map(v => String(v || '').trim()).filter(Boolean))];
  if (lista.length < 2) {
    return { banda: 'consultar', razon: 'palabra', motivo: 'Hacen falta al menos dos variantes.', dudosos: [] };
  }
  const dudosos = [];
  for (let i = 0; i < lista.length; i++) {
    for (let j = i + 1; j < lista.length; j++) {
      const r = bandaDePar(lista[i], lista[j]);
      if (r.banda !== 'obvio') dudosos.push({ a: lista[i], b: lista[j], ...r });
    }
  }
  if (!dudosos.length) {
    return {
      banda: 'obvio', razon: 'identico', dudosos: [],
      motivo: `Las ${lista.length} variantes dicen lo mismo: las mismas palabras y las mismas medidas, escritas distinto.`,
    };
  }
  const ejemplo = dudosos.find(d => d.razon === 'medida') || dudosos[0];
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
