// ═══════════════════════════════════════════════════════════════════
// JARVEX — ESCRITURA DEL MAPEO EMPRESA ↔ TRABAJO (mig 206).
//
// La lógica —clasificar los dos lados, proponer dentro de la misma
// clasificación, contar el avance y la cobertura— vive en `mapeo-trabajo.js`,
// que es pura y tiene tests. Acá solo está el aterrizaje en Dexie.
//
// LA LLAVE LÓGICA ES (obra_id, company_id, norm) y la tabla NO tiene UNIQUE,
// por lo de siempre: dos PCs offline decidiendo el mismo par generarían un
// 23505 que el SyncEngine manda a conflictos manuales por un caso benigno. El
// que escribe es el que tiene que no duplicar dentro de su propio device;
// entre devices lo resuelve `resolverMapeosTrabajo()` al leer.
//
// AISLAMIENTO DEL MODO PRUEBA: la tabla es global, así que las filas demo
// conviven con las reales separadas solo por `demo: true`. Toda ruta scopea por
// modo y las demo nunca entran a la cola de push.
// ═══════════════════════════════════════════════════════════════════
import { db, newId, newIdempotencyKey, SYNC_STATUS } from '../db/jarvex.db';
import { getCurrentMode } from './app-mode-core.js';

const esModoPrueba = () => { try { return getCurrentMode() === 'prueba'; } catch { return false; } };
const filaDelModo = (r, esPrueba) => (esPrueba ? r.demo === true : r.demo !== true);
const ahora = () => new Date().toISOString();

/**
 * Avisar a los hooks que la tabla cambió. `useOfflineData` se refresca con
 * `jx_data_changed`; sin esto, escribir en Dexie no movería la pantalla hasta
 * el siguiente pull del SyncEngine y parecería que el botón no hace nada — es
 * exactamente el bug que se arregló en el cotejo (ver cotejo-sunat-db.js).
 */
const avisarCambio = () => {
  try {
    window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'insumo_trabajo_mapeo' } }));
  } catch { /* SSR / tests */ }
};

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
  idempotency_key: newIdempotencyKey(userId || 'anon', 'insumo_trabajo_mapeo'),
  ...(esPrueba ? { demo: true, sync_status: SYNC_STATUS.SYNCED } : { sync_status: SYNC_STATUS.PENDING_CREATE }),
});

const mismasLlaves = (r, cuerpo, esPrueba) =>
  !r.deleted_at
  && r.norm === cuerpo.norm
  && r.obra_id === cuerpo.obra_id
  && (r.company_id || null) === (cuerpo.company_id || null)
  && filaDelModo(r, esPrueba);

/** Todas las decisiones del modo activo, sin resolver duplicados
 *  (`resolverMapeosTrabajo()` elige cuál manda al leer). */
export async function leerMapeosTrabajo() {
  const esPrueba = esModoPrueba();
  try {
    return await db.insumo_trabajo_mapeo
      .filter(r => !r.deleted_at && filaDelModo(r, esPrueba)).toArray();
  } catch { return []; }
}

/** Graba UNA decisión. Si ya había una para ese par en el mismo ámbito, se
 *  actualiza en vez de agregar otra. */
export async function decidirMapeo(cuerpo, { userId = null } = {}) {
  if (!cuerpo?.obra_id) throw new Error('decidirMapeo: falta obra_id — los códigos del presupuesto son de UNA obra.');
  const esPrueba = esModoPrueba();
  const previas = await db.insumo_trabajo_mapeo
    .filter(r => mismasLlaves(r, cuerpo, esPrueba)).toArray();
  const prev = previas[0];
  let id;
  if (prev) {
    await db.insumo_trabajo_mapeo.update(prev.id, parcheDeUpdate(cuerpo, prev, esPrueba, userId));
    id = prev.id;
  } else {
    const fila = filaNueva(cuerpo, esPrueba, userId);
    await db.insumo_trabajo_mapeo.add(fila);
    id = fila.id;
  }
  avisarCambio();
  return id;
}

/**
 * Graba VARIAS de un golpe — el lote de «aceptar todas las de coincidencia
 * alta», que es lo que hace que 484 insumos se puedan despachar.
 *
 * Todo en UNA transacción: o entra el lote entero o no entra nada. Un lote a
 * medias dejaría a quien lo aceptó sin saber cuáles quedaron decididas.
 */
export async function decidirMapeoEnLote(cuerpos, { userId = null } = {}) {
  const esPrueba = esModoPrueba();
  let n = 0;
  await db.transaction('rw', db.insumo_trabajo_mapeo, async () => {
    for (const cuerpo of cuerpos || []) {
      if (!cuerpo?.norm || !cuerpo?.obra_id) continue;
      const previas = await db.insumo_trabajo_mapeo
        .filter(r => mismasLlaves(r, cuerpo, esPrueba)).toArray();
      const prev = previas[0];
      if (prev) await db.insumo_trabajo_mapeo.update(prev.id, parcheDeUpdate(cuerpo, prev, esPrueba, userId));
      else await db.insumo_trabajo_mapeo.add(filaNueva(cuerpo, esPrueba, userId));
      n++;
    }
  });
  avisarCambio();
  return n;
}

/** Deshace una decisión: el insumo vuelve a la lista de pendientes de ese
 *  trabajo. */
export async function reabrirMapeo(norm, { obraId, companyId = null } = {}) {
  const esPrueba = esModoPrueba();
  const previas = await db.insumo_trabajo_mapeo
    .filter(r => !r.deleted_at && r.norm === norm && r.obra_id === obraId
      && (r.company_id || null) === (companyId || null) && filaDelModo(r, esPrueba)).toArray();
  let n = 0;
  for (const prev of previas) {
    if (prev.sync_status === SYNC_STATUS.PENDING_CREATE || esPrueba) {
      await db.insumo_trabajo_mapeo.delete(prev.id);
    } else {
      await db.insumo_trabajo_mapeo.update(prev.id, { deleted_at: ahora(), sync_status: SYNC_STATUS.PENDING_DELETE });
    }
    n++;
  }
  avisarCambio();
  return n;
}
