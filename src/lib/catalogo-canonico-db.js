// ═══════════════════════════════════════════════════════════════════
// JARVEX — ESCRITURA DEL CATÁLOGO CANÓNICO (tanda 14, entrega 2).
//
// La lógica —leer el xlsx, decidir familias, calcular el diff— vive en
// `catalogo-canonico.js`, que es pura y tiene tests. Acá solo está el
// aterrizaje en Dexie, que es lo único que no se puede testear sin navegador.
//
// LA IMPORTACIÓN SE APLICA EN UNA SOLA TRANSACCIÓN. Son ~480 filas: si a la
// mitad se corta (pestaña cerrada, memoria, un error de Dexie), el catálogo
// quedaría con la mitad del archivo viejo y la mitad del nuevo, y nadie tendría
// forma de saber cuál es cuál. O entra todo o no entra nada.
//
// AISLAMIENTO DEL MODO PRUEBA: la tabla es GLOBAL (sin obra), así que las filas
// demo y las reales conviven separadas solo por `demo: true`. Toda ruta —leer,
// importar, desactivar— scopea por modo, y las demo nunca entran a la cola de
// push. Misma disciplina que `clasificar-items.js`.
// ═══════════════════════════════════════════════════════════════════
import { db, newId, newIdempotencyKey, SYNC_STATUS } from '../db/jarvex.db';
import { getCurrentMode } from './app-mode-core.js';
import { resolverCatalogo, diffCatalogo } from './catalogo-canonico.js';

const esModoPrueba = () => { try { return getCurrentMode() === 'prueba'; } catch { return false; } };
const filaDelModo = (r, esPrueba) => (esPrueba ? r.demo === true : r.demo !== true);

const ahora = () => new Date().toISOString();

/** Las filas del catálogo del modo activo, sin resolver duplicados. */
export async function leerCatalogoCrudo() {
  const esPrueba = esModoPrueba();
  try {
    return await db.catalogo_insumos
      .filter(r => !r.deleted_at && filaDelModo(r, esPrueba)).toArray();
  } catch { return []; }
}

/**
 * El catálogo ya resuelto (una fila por `norm`) y solo lo activo, en el ámbito
 * pedido: `companyId: null` es el catálogo GENERAL del grupo; con valor, el de
 * esa entidad más el general como base (mig 193).
 */
export async function leerCatalogo({ incluirInactivos = false, companyId = null } = {}) {
  const filas = resolverCatalogo(await leerCatalogoCrudo(), { companyId });
  return incluirInactivos ? filas : filas.filter(r => r.activo !== false);
}

export async function leerDisgregacion() {
  const esPrueba = esModoPrueba();
  try {
    return await db.catalogo_disgregacion
      .filter(r => !r.deleted_at && r.activo !== false && filaDelModo(r, esPrueba)).toArray();
  } catch { return []; }
}

/**
 * Qué haría importar este archivo, SIN escribir nada. La pantalla lo muestra
 * y recién entonces Gabriel decide. Importar a ciegas un xlsx editado mal es de
 * las pocas cosas que pueden ensuciar el catálogo entero de una sola pasada.
 */
export async function previsualizarImportacion(importados, { companyId = null } = {}) {
  return diffCatalogo(await leerCatalogoCrudo(), importados || [], { companyId });
}

const campoNuevo = (fila, esPrueba, userId, companyId = null) => ({
  id: newId(),
  company_id: companyId,
  tipo: fila.tipo || 'insumo',
  nombre: fila.nombre,
  norm: fila.norm,
  unidad: fila.unidad || null,
  familia: fila.familia || 'otros',
  origen: 'xlsx',
  activo: true,
  created_by: userId || null, updated_by: userId || null,
  created_at: ahora(), updated_at: ahora(),
  version: 1,
  idempotency_key: newIdempotencyKey(userId || 'anon', 'catalogo_insumos'),
  ...(esPrueba ? { demo: true, sync_status: SYNC_STATUS.SYNCED } : { sync_status: SYNC_STATUS.PENDING_CREATE }),
});

const parcheDeUpdate = (fila, prev, esPrueba, userId) => ({
  ...fila,
  updated_by: userId || null,
  updated_at: ahora(),
  version: (prev?.version ?? 0) + 1,
  sync_status: esPrueba ? SYNC_STATUS.SYNCED
    : (prev?.sync_status === SYNC_STATUS.PENDING_CREATE ? SYNC_STATUS.PENDING_CREATE : SYNC_STATUS.PENDING_UPDATE),
});

/**
 * Aplica una importación ya previsualizada.
 *
 * @param {object} diff — lo que devolvió `previsualizarImportacion`.
 * @param {Array}  disgregacion — las filas de la hoja DISGREGADOS.
 * @param {object} opts — { userId, desactivarAusentes }
 *
 * `desactivarAusentes` es una DECISIÓN, no un default: si Gabriel importa una
 * hoja recortada (solo la familia que estaba corrigiendo), desactivar todo lo
 * que falta sería un desastre silencioso. La pantalla lo pregunta con el
 * número adelante.
 *
 * `companyId` es el DESTINO (mig 193): null = el catálogo general del grupo,
 * con valor = el catálogo propio de esa entidad.
 */
export async function aplicarImportacion(diff, disgregacion, { userId = null, desactivarAusentes = false, companyId = null } = {}) {
  const esPrueba = esModoPrueba();
  const hecho = { altas: 0, cambios: 0, reactivados: 0, desactivados: 0, disgregacion: 0 };

  await db.transaction('rw', db.catalogo_insumos, db.catalogo_disgregacion, async () => {
    for (const f of diff?.altas || []) {
      await db.catalogo_insumos.add(campoNuevo(f, esPrueba, userId, companyId));
      hecho.altas++;
    }
    for (const f of diff?.cambios || []) {
      const prev = await db.catalogo_insumos.get(f.id);
      if (!prev) continue;
      await db.catalogo_insumos.update(f.id, parcheDeUpdate({
        nombre: f.nombre, unidad: f.unidad || null, familia: f.familia, tipo: f.tipo,
      }, prev, esPrueba, userId));
      hecho.cambios++;
    }
    for (const f of diff?.reactivar || []) {
      const prev = await db.catalogo_insumos.get(f.id);
      if (!prev) continue;
      await db.catalogo_insumos.update(f.id, parcheDeUpdate({
        nombre: f.nombre, unidad: f.unidad || null, familia: f.familia, tipo: f.tipo, activo: true,
      }, prev, esPrueba, userId));
      hecho.reactivados++;
    }
    if (desactivarAusentes) {
      for (const f of diff?.ausentes || []) {
        const prev = await db.catalogo_insumos.get(f.id);
        if (!prev) continue;
        await db.catalogo_insumos.update(f.id, parcheDeUpdate({ activo: false }, prev, esPrueba, userId));
        hecho.desactivados++;
      }
    }

    // La disgregación se rehace entera: son cuatro filas, no hay nada que
    // preservar y comparar par por par costaría más de lo que vale. Lo que la
    // contadora haya corregido a mano (`origen: 'manual'`) se respeta.
    for (const d of disgregacion || []) {
      const previas = await db.catalogo_disgregacion
        .filter(r => !r.deleted_at && r.padre_norm === d.padre_norm && r.hijo_norm === d.hijo_norm
          && (r.company_id || null) === companyId && filaDelModo(r, esPrueba)).toArray();
      const manual = previas.find(r => r.origen === 'manual' || r.factor_fuente === 'manual');
      if (manual) continue;                       // lo que ella grabó, manda
      const prev = previas[0];
      if (prev) {
        await db.catalogo_disgregacion.update(prev.id, parcheDeUpdate({
          padre_nombre: d.padre_nombre, padre_unidad: d.padre_unidad || null,
          hijo_nombre: d.hijo_nombre, hijo_unidad: d.hijo_unidad || null,
          factor: d.factor, factor_fuente: d.factor_fuente || null, nota: d.nota || null,
          activo: true,
        }, prev, esPrueba, userId));
      } else {
        await db.catalogo_disgregacion.add({
          id: newId(),
          company_id: companyId,
          padre_norm: d.padre_norm, padre_nombre: d.padre_nombre, padre_unidad: d.padre_unidad || null,
          hijo_norm: d.hijo_norm, hijo_nombre: d.hijo_nombre, hijo_unidad: d.hijo_unidad || null,
          factor: d.factor, factor_fuente: d.factor_fuente || null, nota: d.nota || null,
          origen: 'xlsx', activo: true,
          created_by: userId || null, updated_by: userId || null,
          created_at: ahora(), updated_at: ahora(),
          version: 1,
          idempotency_key: newIdempotencyKey(userId || 'anon', 'catalogo_disgregacion'),
          ...(esPrueba ? { demo: true, sync_status: SYNC_STATUS.SYNCED } : { sync_status: SYNC_STATUS.PENDING_CREATE }),
        });
      }
      hecho.disgregacion++;
    }
  });

  return hecho;
}

/**
 * Corrige a mano una entrada del catálogo (familia, unidad o nombre). Marca la
 * fila como `origen: 'manual'` — desde ahí la importación deja de pisarla: el
 * archivo no manda sobre lo que una persona corrigió mirando la realidad.
 */
export async function corregirEntrada(id, cambios, { userId = null } = {}) {
  const prev = await db.catalogo_insumos.get(id);
  if (!prev) return false;
  const esPrueba = esModoPrueba();
  await db.catalogo_insumos.update(id, parcheDeUpdate({ ...cambios, origen: 'manual' }, prev, esPrueba, userId));
  return true;
}

/** Un factor de disgregación grabado por una persona: pasa a `manual` y ya no
 *  se vuelve a proponer solo. */
export async function corregirFactor(id, factor, { userId = null } = {}) {
  const prev = await db.catalogo_disgregacion.get(id);
  if (!prev) return false;
  const esPrueba = esModoPrueba();
  const n = Number(factor);
  await db.catalogo_disgregacion.update(id, parcheDeUpdate({
    factor: Number.isFinite(n) && n > 0 ? n : null,
    factor_fuente: Number.isFinite(n) && n > 0 ? 'manual' : null,
    origen: 'manual',
  }, prev, esPrueba, userId));
  return true;
}

/**
 * Corrige VARIAS entradas de una vez (familia, unidad o lo que sea).
 *
 * Existe porque son 444 filas y Gabriel dijo lo que hay que oír: «no es que
 * esté perfecto, hace falta una revisión». Revisar de a una fila no se hace
 * nunca; marcar veinte y decir «todas estas son ferretería» sí. Todas quedan
 * `origen: 'manual'` y ninguna importación las vuelve a pisar.
 */
export async function corregirEnLote(ids, cambios, { userId = null } = {}) {
  const esPrueba = esModoPrueba();
  let n = 0;
  await db.transaction('rw', db.catalogo_insumos, async () => {
    for (const id of ids || []) {
      const prev = await db.catalogo_insumos.get(id);
      if (!prev) continue;
      await db.catalogo_insumos.update(id, parcheDeUpdate({ ...cambios, origen: 'manual' }, prev, esPrueba, userId));
      n++;
    }
  });
  return n;
}

/**
 * Copia una entrada del catálogo GENERAL al catálogo de una entidad, para
 * poder corregirla ahí sin tocar la del grupo. Es lo que hace que «cada empresa
 * maneje su base»: la entidad se queda con SU versión y el general no se mueve.
 */
export async function adoptarEnEntidad(id, companyId, cambios = {}, { userId = null } = {}) {
  const base = await db.catalogo_insumos.get(id);
  if (!base || !companyId) return null;
  if ((base.company_id || null) === companyId) {          // ya es suya: se corrige
    await corregirEntrada(id, cambios, { userId });
    return id;
  }
  const esPrueba = esModoPrueba();
  const fila = {
    ...campoNuevo({ tipo: base.tipo, nombre: base.nombre, norm: base.norm, unidad: base.unidad, familia: base.familia }, esPrueba, userId, companyId),
    ...cambios,
    origen: 'manual',
  };
  await db.catalogo_insumos.add(fila);
  return fila.id;
}

// ── EL MAPEO DE CATEGORÍAS ENTRE ENTIDADES (mig 193) ───────────────

/**
 * Guarda que la familia local de una entidad equivale a una del grupo, o que es
 * PROPIA y no equivale a ninguna. Las dos son respuestas y las dos se recuerdan
 * — sin guardar el «es propia», la pregunta vuelve en cada visita y la pantalla
 * se abandona (la lección de mig 183).
 */
export async function decidirEquivalencia(companyId, familiaLocal, { familiaCanonica = null, decision = 'mapeada', userId = null } = {}) {
  if (!companyId || !familiaLocal) return null;
  if (decision === 'mapeada' && !familiaCanonica) return null;
  const esPrueba = esModoPrueba();
  const previas = await db.catalogo_familia_mapeo
    .filter(r => !r.deleted_at && r.company_id === companyId && r.familia_local === familiaLocal
      && filaDelModo(r, esPrueba)).toArray();
  const campos = {
    familia_canonica: decision === 'mapeada' ? familiaCanonica : null,
    decision,
  };
  const prev = previas[0];
  if (prev) {
    await db.catalogo_familia_mapeo.update(prev.id, parcheDeUpdate(campos, prev, esPrueba, userId));
    return prev.id;
  }
  const id = newId();
  await db.catalogo_familia_mapeo.add({
    id, company_id: companyId, familia_local: familiaLocal, ...campos,
    created_by: userId || null, updated_by: userId || null,
    created_at: ahora(), updated_at: ahora(),
    version: 1,
    idempotency_key: newIdempotencyKey(userId || 'anon', 'catalogo_familia_mapeo'),
    ...(esPrueba ? { demo: true, sync_status: SYNC_STATUS.SYNCED } : { sync_status: SYNC_STATUS.PENDING_CREATE }),
  });
  return id;
}

/** Deshace una equivalencia: vuelve a quedar pendiente de decidir. */
export async function olvidarEquivalencia(id) {
  const prev = await db.catalogo_familia_mapeo.get(id);
  if (!prev) return false;
  if (prev.sync_status === SYNC_STATUS.PENDING_CREATE) await db.catalogo_familia_mapeo.delete(id);
  else await db.catalogo_familia_mapeo.update(id, { deleted_at: ahora(), sync_status: SYNC_STATUS.PENDING_DELETE });
  return true;
}
