// ═══════════════════════════════════════════════════════════════════
// JARVEX — ESCRITURA DE LA BANDEJA (tanda 14, entrega 4).
//
// La lógica —armar las filas, proponer, agrupar en lotes, contar el avance—
// vive en `bandeja-categorizacion.js`, que es pura y tiene tests. Acá solo está
// el aterrizaje en Dexie.
//
// UNA DECISIÓN ESCRIBE EN DOS LUGARES, Y ESO ES EL PUNTO DE LA ENTREGA:
//   1. `insumo_categoria` (mig 195) — qué insumo del catálogo es.
//   2. `clasificacion_catalogo` vía `aprenderClasificacion()` — en qué
//      categoría de gasto cae, que es el vocabulario que ve la contadora.
// Es el puente de la entrega 2 (`tipoInsumoDe` / `categoriaItemDe`) puesto a
// trabajar: una sola pasada contesta las dos preguntas. Medido, la contadora
// tiene 111 clasificaciones de las que 110 las puso la IA y UNA sola una
// persona; cada fila que salga de acá entra como `manual` y pisa a la IA para
// siempre.
//
// EL SEGUNDO PASO NO PUEDE VOLTEAR EL PRIMERO. `aprenderClasificacion` tiene su
// propia transacción; si falla (una fila corrupta, la tabla llena), la decisión
// de la bandeja ya está grabada y NO se revierte. Al revés sería peor: perder
// la respuesta que la persona acaba de dar por un problema en una tabla de
// conveniencia. Por eso va fuera de la transacción y con su try/catch.
//
// AISLAMIENTO DEL MODO PRUEBA: la tabla es GLOBAL (sin obra), así que las filas
// demo y las reales conviven separadas solo por `demo: true`. Toda ruta scopea
// por modo y las demo nunca entran a la cola de push.
// ═══════════════════════════════════════════════════════════════════
import { db, newId, newIdempotencyKey, SYNC_STATUS } from '../db/jarvex.db';
import { getCurrentMode } from './app-mode-core.js';
import { aprenderClasificacion } from './clasificar-items.js';
import { aprendizajeParaContadora, filaNuevaDeCatalogo } from './bandeja-categorizacion.js';

const esModoPrueba = () => { try { return getCurrentMode() === 'prueba'; } catch { return false; } };
const filaDelModo = (r, esPrueba) => (esPrueba ? r.demo === true : r.demo !== true);
const ahora = () => new Date().toISOString();

const parcheDeUpdate = (campos, prev, esPrueba, userId) => ({
  ...campos,
  updated_by: userId || null,
  updated_at: ahora(),
  version: (prev?.version ?? 0) + 1,
  sync_status: esPrueba ? SYNC_STATUS.SYNCED
    : (prev?.sync_status === SYNC_STATUS.PENDING_CREATE ? SYNC_STATUS.PENDING_CREATE : SYNC_STATUS.PENDING_UPDATE),
});

const filaNueva = (campos, esPrueba, userId) => ({
  id: newId(),
  ...campos,
  created_by: userId || null, updated_by: userId || null,
  created_at: ahora(), updated_at: ahora(),
  version: 1,
  idempotency_key: newIdempotencyKey(userId || 'anon', 'insumo_categoria'),
  ...(esPrueba ? { demo: true, sync_status: SYNC_STATUS.SYNCED } : { sync_status: SYNC_STATUS.PENDING_CREATE }),
});

/** Todas las decisiones del modo activo, sin resolver duplicados
 *  (`resolverCategorias()` elige cuál manda al leer). */
export async function leerCategorias() {
  const esPrueba = esModoPrueba();
  try {
    return await db.insumo_categoria
      .filter(r => !r.deleted_at && filaDelModo(r, esPrueba)).toArray();
  } catch { return []; }
}

/**
 * Graba UNA decisión. Si ya había una para esa descripción en el mismo ámbito,
 * se actualiza en vez de agregar otra: la llave lógica es (company_id, norm) y
 * la tabla no tiene UNIQUE a propósito (mig 195), así que el que escribe es el
 * que tiene que no duplicar dentro de su propio device.
 */
export async function decidir(cuerpo, { userId = null } = {}) {
  const esPrueba = esModoPrueba();
  const scope = cuerpo.company_id || null;
  const previas = await db.insumo_categoria
    .filter(r => !r.deleted_at && r.norm === cuerpo.norm
      && (r.company_id || null) === scope && filaDelModo(r, esPrueba)).toArray();
  const prev = previas[0];
  if (prev) {
    await db.insumo_categoria.update(prev.id, parcheDeUpdate(cuerpo, prev, esPrueba, userId));
    return prev.id;
  }
  const fila = filaNueva(cuerpo, esPrueba, userId);
  await db.insumo_categoria.add(fila);
  return fila.id;
}

/**
 * Graba VARIAS decisiones de un golpe — el lote, que es lo que hace usable la
 * pantalla. Medido: hacen falta 200 decisiones para cubrir el 83,5% del gasto y
 * la cola son 1.473 descripciones baratas; de a una no se termina nunca.
 *
 * Todo en UNA transacción: o entra el lote entero o no entra nada. Un lote a
 * medias dejaría a quien lo aceptó sin saber cuáles quedaron decididas.
 */
export async function decidirEnLote(cuerpos, { userId = null } = {}) {
  const esPrueba = esModoPrueba();
  let n = 0;
  await db.transaction('rw', db.insumo_categoria, async () => {
    for (const cuerpo of cuerpos || []) {
      if (!cuerpo?.norm) continue;
      const scope = cuerpo.company_id || null;
      const previas = await db.insumo_categoria
        .filter(r => !r.deleted_at && r.norm === cuerpo.norm
          && (r.company_id || null) === scope && filaDelModo(r, esPrueba)).toArray();
      const prev = previas[0];
      if (prev) await db.insumo_categoria.update(prev.id, parcheDeUpdate(cuerpo, prev, esPrueba, userId));
      else await db.insumo_categoria.add(filaNueva(cuerpo, esPrueba, userId));
      n++;
    }
  });
  return n;
}

/**
 * Lo que la decisión le enseña al clasificador de la contadora. Va aparte de la
 * transacción y con su propio try/catch a propósito: ver el encabezado.
 * `filas` son pares { fila, catalogoFila } — la descripción y el insumo elegido.
 */
export async function enseñarALaContadora(pares, { userId = null, equivalencias = null } = {}) {
  let n = 0;
  for (const { fila, catalogoFila } of pares || []) {
    const ap = aprendizajeParaContadora(fila, catalogoFila, equivalencias);
    if (!ap) continue;
    try {
      await aprenderClasificacion({
        descripcion: ap.descripcion, categoria: ap.categoria,
        subcategoria: ap.subcategoria, fuente: 'manual', userId,
      });
      n++;
    } catch { /* la decisión de la bandeja ya está grabada; esto es de más */ }
  }
  return n;
}

/**
 * «Esto falta en el catálogo»: crea la fila del catálogo Y la decisión que la
 * apunta, en una sola transacción.
 *
 * Es la respuesta correcta para el 45% de la plata que hoy no tiene candidato
 * porque la fila NO EXISTE —el acero corrugado hasta la mig 195, la pintura
 * entera, los perfiles comerciales— y es la idea de Gabriel de que el mapeo se
 * aprende trabajando: el catálogo crece con el trabajo del día, no en una tarea
 * aparte. Las dos escrituras van juntas porque una fila de catálogo creada sin
 * su decisión dejaría la descripción igual de pendiente y nadie entendería por
 * qué apareció un insumo nuevo que no resolvió nada.
 */
export async function agregarAlCatalogoYDecidir(fila, { companyId = null, familia = null, unidad = null, nombre = null, userId = null } = {}) {
  const esPrueba = esModoPrueba();
  const nueva = filaNuevaDeCatalogo(fila, { companyId, familia, unidad, nombre });
  let creado = null;
  await db.transaction('rw', db.catalogo_insumos, db.insumo_categoria, async () => {
    // Si alguien ya creó ese mismo nombre (la otra PC, o dos filas de la misma
    // bandeja que se resuelven al mismo insumo), se reusa en vez de duplicar.
    const previas = await db.catalogo_insumos
      .filter(r => !r.deleted_at && r.norm === nueva.norm
        && (r.company_id || null) === (companyId || null) && filaDelModo(r, esPrueba)).toArray();
    if (previas.length) creado = previas[0];
    else {
      creado = {
        id: newId(), ...nueva,
        created_by: userId || null, updated_by: userId || null,
        created_at: ahora(), updated_at: ahora(),
        version: 1,
        idempotency_key: newIdempotencyKey(userId || 'anon', 'catalogo_insumos'),
        ...(esPrueba ? { demo: true, sync_status: SYNC_STATUS.SYNCED } : { sync_status: SYNC_STATUS.PENDING_CREATE }),
      };
      await db.catalogo_insumos.add(creado);
    }
    const cuerpo = {
      norm: fila.norm, muestra: fila.muestra, decision: 'catalogo',
      catalogo_insumo_id: creado.id,
      familia: creado.familia, subfamilia: creado.subfamilia || null,
      unidad_origen: [...(fila.unidades || [])][0] || null,
      unidad_destino: creado.unidad || null,
      factor: null, factor_fuente: null,
      fuente: 'manual', score: null, nota: 'Alta desde la bandeja',
      company_id: companyId || null, deleted_at: null,
    };
    const yaDecidida = await db.insumo_categoria
      .filter(r => !r.deleted_at && r.norm === fila.norm
        && (r.company_id || null) === (companyId || null) && filaDelModo(r, esPrueba)).toArray();
    if (yaDecidida.length) await db.insumo_categoria.update(yaDecidida[0].id, parcheDeUpdate(cuerpo, yaDecidida[0], esPrueba, userId));
    else await db.insumo_categoria.add(filaNueva(cuerpo, esPrueba, userId));
  });
  return creado;
}

/** Deshace una decisión: la descripción vuelve a la lista de pendientes. */
export async function reabrir(norm, { companyId = null } = {}) {
  const esPrueba = esModoPrueba();
  const previas = await db.insumo_categoria
    .filter(r => !r.deleted_at && r.norm === norm
      && (r.company_id || null) === (companyId || null) && filaDelModo(r, esPrueba)).toArray();
  let n = 0;
  for (const prev of previas) {
    if (prev.sync_status === SYNC_STATUS.PENDING_CREATE || esPrueba) await db.insumo_categoria.delete(prev.id);
    else await db.insumo_categoria.update(prev.id, { deleted_at: ahora(), sync_status: SYNC_STATUS.PENDING_DELETE });
    n++;
  }
  return n;
}
