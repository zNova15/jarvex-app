// ═══════════════════════════════════════════════════════════════════
// JARVEX — LAS CORRELACIONES QUE APARECEN DESPUÉS DE CLASIFICAR
// (tanda 9, 15-set-2026).
//
// ── EL PEDIDO ─────────────────────────────────────────────────────
// Gabriel: «mientras estaba clasificando con la ayuda de la IA vi varios
// insumos que creería yo se correlacionan. Acabé las recomendaciones y pensé
// que eso sería todo pero después de ir clasificando me parece que hace falta
// correlacionar más.»
//
// ── POR QUÉ SE ACABAN LAS RECOMENDACIONES Y SIGUE FALTANDO ────────
// `sugerirCandidatos()` propone por PARECIDO DE TEXTO (umbral 0,55). Eso deja
// afuera todo par que sea la misma cosa escrita de dos maneras que no se
// parecen. Pero al clasificar aparece una señal que antes no existía: DOS
// DESCRIPCIONES PEGADAS AL MISMO INSUMO DEL CATÁLOGO. Esa decisión ya la tomó
// una persona, y dice algo mucho más fuerte que el parecido de letras.
//
// Medido en producción el 15-set: 307 decisiones apuntan a 199 insumos →
// 184 pares comparten insumo y 170 NUNCA se preguntaron. Ejemplos textuales:
//   · «DIESEL B5 UV» / «DISEL B5 S50»  (un typo: el texto no los acerca)
//   · «TUB GAL RED 2 PULG…***PAGO ANTICIPADO***» / «…***Pago Anticipado***»
//     (¡solo difieren en mayúsculas dentro del asterisco!)
//   · «CHICHA MORADA FROZEN JARRA 1LT» / «CHICHA MORADA JARRA 1LT»
//
// ── Y SIRVE PARA LO CONTRARIO, QUE VALE IGUAL ─────────────────────
// La misma lista destapa MAPEOS MALOS, que hoy no tienen quién los encuentre:
//   · «PAPEL BIBE X 100 PLIEGOS», «PAPELOTE X 100 PLIEGOS» y «PAPEL COPYTINTA
//     AMARILLO», los tres pegados a PAPEL BOND.
//   · «ALAMBRE GALVANIZADO PRODAC» y «ALAMBRE NEGRO # 8» → ALAMBRE DE PUAS.
//   · «TUB. GAL RECT. 40×60×1.2» y «40×80×1.5» juntas: medidas distintas.
// Contestar «son distintos» sobre uno de esos pares no es una correlación
// perdida: es la señal de que una de las dos está mal clasificada. Por eso
// estos candidatos se marcan con `motivo: 'mismo_insumo'` y la pantalla lo
// dice — la pregunta que hay que hacerse acá no es la misma que ante dos
// nombres parecidos.
//
// 🔴 NO SE AUTO-CORRELACIONA NADA. Compartir insumo del catálogo es una
// PREGUNTA, no una respuesta: el catálogo tiene filas genéricas («PAPEL BOND»,
// «ALAMBRE DE PUAS») a las que se pegó de todo. Unir automáticamente lo que
// cae en una de ésas fusionaría en el inventario cosas que no son la misma, y
// eso no se deshace mirando el resultado.
//
// Puro: sin React, sin Dexie.
// ═══════════════════════════════════════════════════════════════════
import { normInsumo, parClave } from './insumo-correlacion.js';

/** El tope de nombres que entran en UN candidato. */
const MAX_POR_INSUMO = 8;

/**
 * Los candidatos de correlación que salen de las decisiones de clasificación.
 *
 * @param decisiones      filas vivas de `insumo_categoria` (decision:'catalogo').
 * @param nombresVisibles los nombres que la pestaña está mostrando hoy — se
 *                        usan para no proponer sobre descripciones de otra
 *                        entidad o de otro árbol, y para recuperar el nombre
 *                        CRUDO (las decisiones guardan `muestra`, que puede
 *                        venir de otra entidad con otra grafía).
 * @param paresResueltos  Map de `resolverPares()`: lo ya contestado no vuelve.
 * @param grupoDe         Map de `construirGrupos()`: lo ya unido tampoco.
 * @param nombresCatalogo Map catalogo_insumo_id → nombre, para poder decir
 *                        «los dos quedaron en PAPEL BOND».
 * @returns [{ id, variantes, canonico, score, esGrupo, motivo, insumo }]
 */
export function candidatosPorMismoInsumo({
  decisiones = [], nombresVisibles = [], paresResueltos = null, grupoDe = null,
  nombresCatalogo = null, maxPorInsumo = MAX_POR_INSUMO, max = 60,
} = {}) {
  // El nombre crudo tal como lo muestra la pestaña, por su forma normalizada.
  const crudoPorNorm = new Map();
  for (const n of nombresVisibles) {
    const k = normInsumo(n);
    if (k && !crudoPorNorm.has(k)) crudoPorNorm.set(k, n);
  }
  if (!crudoPorNorm.size) return [];

  // 1. Agrupar las descripciones decididas por el insumo al que apuntan.
  const porInsumo = new Map();
  for (const d of (decisiones || [])) {
    if (!d || d.deleted_at) continue;
    if (d.decision !== 'catalogo' || !d.catalogo_insumo_id) continue;
    const nombre = String(d.muestra || '').trim();
    if (!nombre) continue;
    const k = normInsumo(nombre);
    // Solo lo que esta pestaña está mostrando: una descripción de otra entidad
    // (o de otro árbol) no se puede correlacionar desde acá.
    if (!crudoPorNorm.has(k)) continue;
    if (!porInsumo.has(d.catalogo_insumo_id)) porInsumo.set(d.catalogo_insumo_id, new Map());
    porInsumo.get(d.catalogo_insumo_id).set(k, crudoPorNorm.get(k));
  }

  const salida = [];
  for (const [insumoId, miembros] of porInsumo.entries()) {
    if (miembros.size < 2) continue;

    // 2. Sacar lo que ya está unido: si TODOS pertenecen al mismo grupo
    //    confirmado, la pregunta ya está contestada.
    const norms = [...miembros.keys()];
    if (grupoDe) {
      const grupos = new Set(norms.map(n => grupoDe.get(n) || `solo:${n}`));
      if (grupos.size === 1 && !String([...grupos][0]).startsWith('solo:')) continue;
    }

    // 3. Y sacar los pares ya contestados. Un candidato solo sobrevive si
    //    queda al menos UN par sin decidir entre sus miembros: si todos los
    //    pares ya se contestaron (aunque sea «distinto»), no hay nada que
    //    preguntar de nuevo.
    const nombres = norms.map(n => miembros.get(n));
    let hayPregunta = false;
    for (let i = 0; i < nombres.length && !hayPregunta; i++) {
      for (let j = i + 1; j < nombres.length; j++) {
        if (!paresResueltos || !paresResueltos.has(parClave(nombres[i], nombres[j]))) {
          hayPregunta = true;
          break;
        }
      }
    }
    if (!hayPregunta) continue;

    const variantes = nombres.slice(0, maxPorInsumo);
    // El representante es el nombre más largo: suele ser el más descriptivo, y
    // es el mismo criterio que usa `sugerirCandidatos` para un par.
    const canonico = [...variantes].sort((a, b) => b.length - a.length)[0];
    salida.push({
      // MISMA FORMA DE ID que `sugerirCandidatos`: el contenido ordenado. Es lo
      // que hace que un candidato que llegó por los dos caminos sea UNO solo y
      // que la recomendación de IA guardada lo siga encontrando.
      id: variantes.length === 2
        ? `par:${[...variantes].sort().join('|')}`
        : `grp:${[...variantes].sort().join('|')}`,
      variantes,
      canonico,
      // No hay puntaje de texto acá: la señal es la decisión de una persona.
      // Se deja alto para que estos candidatos no queden al final de la lista,
      // pero NO es un parecido medido y la pantalla no lo muestra como tal.
      score: 1,
      esGrupo: variantes.length >= 3,
      pares: [],
      motivo: 'mismo_insumo',
      insumo: nombresCatalogo?.get(insumoId) || null,
    });
    if (salida.length >= max) break;
  }
  return salida;
}

/**
 * Junta las dos fuentes de candidatos sin repetir preguntas.
 *
 * Los de TEXTO van primero: son los que el motor ya venía proponiendo y su
 * `score` significa algo. Los de MISMO INSUMO se agregan detrás, y solo los
 * que no estaban: el id es el contenido ordenado, así que un candidato que
 * llegó por los dos caminos se detecta sin comparar nombre por nombre.
 */
export function unirCandidatos(porTexto = [], porInsumo = []) {
  const vistos = new Set((porTexto || []).map(c => c.id));
  const extra = (porInsumo || []).filter(c => !vistos.has(c.id));
  return [...porTexto, ...extra];
}
