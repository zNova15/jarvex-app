// ═══════════════════════════════════════════════════════════════════
// JARVEX — ELIMINAR Y FUSIONAR CLASIFICACIONES PROPIAS (tanda 8, 15-set-2026).
//
// DOS PEDIDOS DE GABRIEL QUE SON EL MISMO PROBLEMA.
//   · «Intenté crear nuevas clasificaciones, y en una me equivoqué y quise
//     eliminarla, no hay cómo; cuando puse desactivarla se volvió "Sin
//     clasificar".» Desactivar dejaba los insumos apuntando a un código muerto
//     — la pantalla los mostraba como sin clasificar y no había forma de
//     deshacer el error.
//   · «Resulta que la IA recomienda llamar a la clasificación de la misma
//     manera; ¿qué pasa si creo varias y podríamos convertirla en una?»
//
// Las dos se contestan con la misma operación: MOVER TODO LO QUE APUNTA A UNA
// CLASIFICACIÓN HACIA OTRA, y recién entonces dar de baja la vacía. Borrar sin
// mover es lo que fabricó el «sin clasificar» — una clasificación no es una
// etiqueta suelta, es el destino de tres tablas a la vez:
//   · `catalogo_insumos.familia`     — los insumos del vocabulario.
//   · `clasificacion_terminos`       — su diccionario.
//   · `insumo_categoria.familia`     — las decisiones ya tomadas en la bandeja.
// Mover una y olvidar las otras deja la pantalla diciendo cosas distintas según
// desde dónde se la mire, que es peor que no poder borrar.
//
// 🔴 LA BASE OFICIAL NO SE FUSIONA NI SE BORRA. El IUPC del INEI y el árbol de
// servicios son la ley (regla 8 del CLAUDE.md): viajan en el bundle y no tienen
// fila que borrar. Solo se opera sobre las PROPIAS — lo que creó Gabriel—, que
// es exactamente el alcance que él mismo puso: «hablo solo de las que yo armo,
// la base es ley». Una propia SÍ puede fusionarse HACIA una oficial: es la
// forma de arrepentirse de haber creado una que ya existía en la norma.
//
// Este módulo no toca Dexie: arma el PLAN (qué filas se mueven, cuáles se
// descartan por duplicadas, qué se puede y qué no) y lo devuelve para que la
// pantalla lo muestre ANTES de escribir. `clasificaciones-db.js` lo aplica.
// ═══════════════════════════════════════════════════════════════════
import { normIUPC } from './indices-unificados-iupc.js';

const vivas = (arr) => (arr || []).filter(r => r && !r.deleted_at);
const cod = (x) => String(x || '').trim();

/** Las filas que hoy apuntan a una clasificación, en las tres tablas. */
export function loQueApuntaA(codigo, { insumos = [], terminos = [], decisiones = [] } = {}) {
  const c = cod(codigo);
  return {
    insumos: vivas(insumos).filter(r => cod(r.familia) === c),
    terminos: vivas(terminos).filter(r => cod(r.clasificacion_codigo) === c),
    decisiones: vivas(decisiones).filter(r => cod(r.familia) === c),
  };
}

/**
 * ¿Se puede dar de baja esta clasificación, y qué arrastra?
 *
 * `vacia: true` es el caso de «me equivoqué al crearla»: nadie la usa todavía
 * y se borra sin preguntar a dónde va nada. Con contenido, la pantalla exige
 * destino — ver `planFusion`.
 */
export function planBaja({ codigo, cats = [], insumos = [], terminos = [], decisiones = [] } = {}) {
  const c = cod(codigo);
  const cat = (cats || []).find(x => cod(x.codigo) === c) || null;
  if (!cat) return { ok: false, error: 'Esa clasificación no existe.' };
  if (!cat.propia) {
    return { ok: false, error: 'Ésta es de la base oficial (el IUPC del INEI o el árbol de servicios): es la norma y no se borra. Solo se pueden eliminar las que creaste vos.' };
  }
  const usos = loQueApuntaA(c, { insumos, terminos, decisiones });
  const n = usos.insumos.length + usos.terminos.length + usos.decisiones.length;
  return {
    ok: true,
    cat,
    vacia: n === 0,
    nInsumos: usos.insumos.length,
    nTerminos: usos.terminos.length,
    nDecisiones: usos.decisiones.length,
    usos,
  };
}

/**
 * El plan para mandar TODO lo de una clasificación a otra.
 *
 * Los términos duplicados NO se mueven: si el destino ya tiene un término con
 * la misma normalización, el de origen se descarta en vez de viajar. Dos filas
 * con el mismo `norm` apuntando al mismo código son dos entradas del
 * diccionario peleando por la misma palabra — justo lo que `agregarTermino()`
 * evita al escribir a mano, y no hay razón para que una fusión lo permita.
 */
export function planFusion({ desde, hacia, cats = [], insumos = [], terminos = [], decisiones = [] } = {}) {
  const a = cod(desde);
  const b = cod(hacia);
  if (!a || !b) return { ok: false, error: 'Elegí a qué clasificación se van.' };
  if (a === b) return { ok: false, error: 'Es la misma clasificación.' };

  const base = planBaja({ codigo: a, cats, insumos, terminos, decisiones });
  if (!base.ok) return base;

  const destino = (cats || []).find(x => cod(x.codigo) === b) || null;
  if (!destino) return { ok: false, error: 'La clasificación de destino no existe.' };
  // Insumos y servicios son preguntas distintas y viven en árboles distintos:
  // mandar un insumo a un código de servicio (o al revés) cambia a qué tabla de
  // inventario va y cómo lo agrupa la contadora, sin que nadie lo haya pedido.
  const arbolDe = (x) => (x?.arbol === 'servicio' ? 'servicio' : 'insumo');
  if (arbolDe(base.cat) !== arbolDe(destino)) {
    return {
      ok: false,
      error: `«${base.cat.nombre}» es de ${arbolDe(base.cat) === 'servicio' ? 'servicios' : 'insumos'} y «${destino.nombre}» es de ${arbolDe(destino) === 'servicio' ? 'servicios' : 'insumos'}. No se mezclan los dos árboles.`,
    };
  }

  const normsDestino = new Set(
    vivas(terminos).filter(r => cod(r.clasificacion_codigo) === b)
      .map(r => r.norm || normIUPC(r.termino)),
  );
  const moverTerminos = [];
  const descartarTerminos = [];
  for (const t of base.usos.terminos) {
    const n = t.norm || normIUPC(t.termino);
    if (normsDestino.has(n)) descartarTerminos.push(t);
    else { normsDestino.add(n); moverTerminos.push(t); }
  }

  return {
    ok: true,
    desde: base.cat,
    hacia: destino,
    insumos: base.usos.insumos,
    decisiones: base.usos.decisiones,
    moverTerminos,
    descartarTerminos,
    /** Lo que se le dice a la persona antes de tocar nada. */
    resumen: [
      base.usos.insumos.length
        ? `${base.usos.insumos.length} ${base.usos.insumos.length === 1 ? 'insumo pasa' : 'insumos pasan'} a «${destino.nombre}»`
        : null,
      moverTerminos.length
        ? `${moverTerminos.length} ${moverTerminos.length === 1 ? 'término del diccionario se muda' : 'términos del diccionario se mudan'}`
        : null,
      descartarTerminos.length
        ? `${descartarTerminos.length} ${descartarTerminos.length === 1 ? 'término repetido se descarta' : 'términos repetidos se descartan'} (el destino ya los tiene)`
        : null,
      base.usos.decisiones.length
        ? `${base.usos.decisiones.length} ${base.usos.decisiones.length === 1 ? 'decisión ya tomada se reapunta' : 'decisiones ya tomadas se reapuntan'}`
        : null,
    ].filter(Boolean),
  };
}

/**
 * LAS CANDIDATAS A FUSIONARSE. Gabriel: «la IA recomienda llamar a la
 * clasificación de la misma manera, ¿qué pasa si creo varias?». Esto las
 * encuentra antes de que sean cinco: dos propias cuyos nombres normalizados
 * son iguales, o donde uno empieza con el otro («Pinturas» / «Pinturas y
 * barnices»). Solo mira las PROPIAS — la base oficial no se toca.
 */
export function parecidasEntreSi(cats = []) {
  const propias = (cats || []).filter(c => c?.propia);
  const pares = [];
  for (let i = 0; i < propias.length; i++) {
    for (let j = i + 1; j < propias.length; j++) {
      const a = propias[i];
      const b = propias[j];
      if ((a.arbol === 'servicio') !== (b.arbol === 'servicio')) continue;
      const na = normIUPC(a.nombre);
      const nb = normIUPC(b.nombre);
      if (!na || !nb) continue;
      if (na === nb || na.startsWith(nb) || nb.startsWith(na)) pares.push({ a, b, iguales: na === nb });
    }
  }
  return pares;
}
