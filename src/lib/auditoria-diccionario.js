// ═══════════════════════════════════════════════════════════════════
// JARVEX — AUDITORÍA DEL DICCIONARIO APRENDIDO (tanda 5, 15-sep-2026).
// Lib PURA.
//
// POR QUÉ EXISTE. La mig 212 partió el diccionario en tres capas y le puso
// `origen` a cada término, pero no dejó dónde MIRARLOS. El panel de
// Clasificaciones muestra el diccionario de a una clasificación por vez: para
// encontrar los 365 huérfanos de septiembre hubo que consultar la base a mano.
// Lo que se aprende solo (una decisión, un recorrido con IA) tiene que poder
// revisarse igual de rápido que se aprendió — si no, el próximo error se
// entierra igual que el anterior y cada tanda vuelve a arrancar envenenada.
//
// LAS TRES PREGUNTAS QUE CONTESTA, y que el panel dibuja:
//
//   1. ¿DE DÓNDE SALIÓ CADA TÉRMINO? — `resumenPorOrigen`. Un diccionario con
//      600 términos de los cuales 500 los dejó un recorrido automático no es
//      lo mismo que uno con 500 escritos a mano, aunque el total sea igual.
//   2. ¿HAY DOS QUE SE PELEAN? — `conflictosDeCodigo`. El mismo texto
//      apuntando a dos clasificaciones distintas: cuál gana depende del orden
//      en que se indexen, o sea, del azar.
//   3. ¿CUÁL CONTRADICE A LA NORMA? — `contradiceALaNorma`. El término dice
//      una cosa y el Anexo 2 de la R.J. 016-2026 dice otra. NO es
//      necesariamente un error (una corrección deliberada sobre la norma es
//      exactamente para lo que existe la capa propia), pero es la lista corta
//      donde miran primero los ojos de alguien.
//
// 🔴 ESTA LIB NO BORRA NADA Y NO DECIDE NADA. Ordena, cuenta y marca. Sacar un
// término del diccionario sigue siendo un clic de una persona sobre una fila
// que puede leer — igual que en todo el resto del módulo. Un «limpiar todo lo
// de la IA» automático sería el mismo error del 365, con el signo cambiado.
//
// Puro: sin React, sin Dexie, sin fetch.
// ═══════════════════════════════════════════════════════════════════
import { clasificarConIUPC, etiquetaCategoria, bandaConfianza } from './indices-unificados-iupc.js';

/** Los orígenes de la mig 212, en el orden en que importa revisarlos. */
export const ORIGENES = [
  {
    slug: 'ia',
    label: 'Lo dejó un recorrido con IA',
    corto: 'de la IA',
    badge: 'b-purple',
    ayuda: 'Nadie lo miró cuando se guardó. Es lo primero que conviene revisar.',
  },
  {
    slug: 'decision',
    label: 'Lo aprendió de una decisión',
    corto: 'aprendido',
    badge: 'b-amber',
    ayuda: 'Salió de clasificar una fila en la bandeja. Vale, pero después de la norma, y desclasificar esa fila lo borra.',
  },
  {
    slug: 'manual',
    label: 'Lo escribiste vos',
    corto: 'tuyo',
    badge: 'b-green',
    ayuda: 'Una corrección deliberada sobre la norma: le gana al Anexo 2 y solo se saca desde acá.',
  },
];

const ORIGEN_VALIDO = new Set(ORIGENES.map(o => o.slug));

/** El `origen` efectivo de una fila. Las viejas, sin columna, son 'decision'. */
export const origenDe = (t) => (ORIGEN_VALIDO.has(t?.origen) ? t.origen : 'decision');

const vivo = (t, demo) => t && !t.deleted_at && !!t.demo === !!demo && !!t.termino;

const sinTildes = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Qué dice la NORMA sobre este término, ignorando el diccionario propio.
 *
 * 🔴 Se consulta SIN `terminosCustom` a propósito. Con el diccionario delante,
 * el término se encontraría a sí mismo con score 0,99 y contestaría siempre
 * «coincide»: sería preguntarle al acusado si es culpable. Lo que se quiere
 * saber es qué diría la R.J. 016-2026 sola.
 */
export function veredictoDeLaNorma(termino) {
  const rec = clasificarConIUPC(String(termino || ''), { terminosCustom: null });
  return {
    codigo: rec?.codigo || 'sin_clasificar',
    score: rec?.score || 0,
    motivos: rec?.motivos || [],
  };
}

/**
 * ¿Este término contradice a la norma?
 *
 * Solo cuenta como contradicción si la norma tiene una opinión CON FUERZA
 * (banda alta o media) y esa opinión es otro código. Cuando el Anexo 2 no
 * reconoce el texto —que es el caso más común y justamente por lo que existe
 * el diccionario propio— no hay contradicción: hay un vacío que el término
 * viene a llenar. Marcar eso como sospechoso llenaría la lista de ruido y
 * nadie la miraría.
 */
export function contradiceALaNorma(termino, codigo) {
  const v = veredictoDeLaNorma(termino);
  if (!v.codigo || v.codigo === 'sin_clasificar') return null;
  if (String(v.codigo) === String(codigo)) return null;
  // `bandaConfianza` devuelve un OBJETO ({slug,label,color}), no un string:
  // compararlo contra 'alta' daba false siempre y la lista salía vacía.
  const banda = bandaConfianza(v.score);
  if (banda.slug !== 'alta' && banda.slug !== 'media') return null;
  return { codigo: v.codigo, score: v.score, banda: banda.slug, color: banda.color, motivos: v.motivos };
}

/**
 * Las filas del panel: un término por fila, con todo lo que hace falta para
 * decidir si se queda o se va.
 *
 * `conNorma: false` saltea el contraste contra el Anexo 2. Es para cuando la
 * pantalla solo necesita contar: el contraste clasifica cada término de nuevo
 * y con ~600 términos eso es trabajo real que no hay por qué hacer dos veces.
 */
export function filasDeAuditoria(terminos, { demo = false, conNorma = true } = {}) {
  return (terminos || [])
    .filter(t => vivo(t, demo))
    .map(t => {
      const codigo = String(t.clasificacion_codigo || '');
      const origen = origenDe(t);
      const contra = conNorma ? contradiceALaNorma(t.termino, codigo) : null;
      return {
        id: t.id,
        termino: String(t.termino),
        norm: String(t.norm || ''),
        codigo,
        etiqueta: etiquetaCategoria(codigo),
        origen,
        companyId: t.company_id || null,
        updatedAt: String(t.updated_at || ''),
        contra,
      };
    })
    .sort((a, b) => String(a.termino).localeCompare(String(b.termino), 'es'));
}

/** Cuántos términos dejó cada capa. Es el titular del panel. */
export function resumenPorOrigen(filas) {
  const m = new Map(ORIGENES.map(o => [o.slug, 0]));
  for (const f of (filas || [])) m.set(f.origen, (m.get(f.origen) || 0) + 1);
  return ORIGENES.map(o => ({ ...o, n: m.get(o.slug) || 0 }));
}

/**
 * Los términos que se pelean entre sí: el MISMO texto normalizado apuntando a
 * dos clasificaciones distintas.
 *
 * Es el defecto más silencioso del diccionario, porque cuál gana depende del
 * orden en que se indexen y no de ninguna decisión. `agregarTermino` ya lo
 * impide desde el panel, pero nada lo impedía entre dos equipos escribiendo
 * a la vez, ni entre un recorrido con IA y una decisión de la bandeja.
 */
export function conflictosDeCodigo(filas) {
  const porNorm = new Map();
  for (const f of (filas || [])) {
    if (!f.norm) continue;
    if (!porNorm.has(f.norm)) porNorm.set(f.norm, []);
    porNorm.get(f.norm).push(f);
  }
  const out = [];
  for (const [norm, grupo] of porNorm.entries()) {
    const codigos = new Set(grupo.map(f => f.codigo));
    if (codigos.size < 2) continue;
    out.push({
      norm,
      termino: grupo[0].termino,
      filas: [...grupo].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
      codigos: [...codigos],
    });
  }
  return out.sort((a, b) => b.filas.length - a.filas.length);
}

/** Los filtros del panel. `null`/'' en cualquiera significa «no filtra». */
export function filtrarAuditoria(filas, { origen = null, codigo = null, busca = '', soloContradicciones = false, soloConflictos = false } = {}) {
  const q = sinTildes(busca).trim();
  const enConflicto = soloConflictos
    ? new Set(conflictosDeCodigo(filas).flatMap(c => c.filas.map(f => f.id)))
    : null;
  return (filas || []).filter(f => {
    if (origen && f.origen !== origen) return false;
    if (codigo && f.codigo !== codigo) return false;
    if (soloContradicciones && !f.contra) return false;
    if (enConflicto && !enConflicto.has(f.id)) return false;
    if (q && !sinTildes(f.termino).includes(q) && !sinTildes(f.etiqueta).includes(q)) return false;
    return true;
  });
}

/** Las clasificaciones que HOY tienen términos propios, para el desplegable. */
export function codigosConTerminos(filas) {
  const m = new Map();
  for (const f of (filas || [])) m.set(f.codigo, (m.get(f.codigo) || 0) + 1);
  return [...m.entries()]
    .map(([codigo, n]) => ({ codigo, n, etiqueta: etiquetaCategoria(codigo) }))
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'));
}
