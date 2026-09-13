// ═══════════════════════════════════════════════════════════════════
// JARVEX — ESCRITURA DE LAS APLICACIONES DE ANTICIPO (mig 207).
//
// La lógica —identificar los anticipos, calcular el saldo, proponer contra qué
// factura se aplican— vive en `anticipos.js`, que es pura y tiene tests. Acá
// solo está el aterrizaje en Dexie.
//
// LA LLAVE LÓGICA ES (anticipo, factura) y la tabla NO tiene UNIQUE, por lo de
// siempre: dos PCs offline aplicando el mismo par generarían un 23505 que el
// SyncEngine manda a conflictos por un caso benigno. El que escribe no duplica
// dentro de su device; entre devices lo resuelve `resolverAplicaciones()`.
//
// AISLAMIENTO DEL MODO PRUEBA: las filas demo conviven con las reales
// separadas solo por `demo: true`, y nunca entran a la cola de push.
// ═══════════════════════════════════════════════════════════════════
import { db, newId, newIdempotencyKey, SYNC_STATUS } from '../db/jarvex.db';
import { getCurrentMode } from './app-mode-core.js';

const esModoPrueba = () => { try { return getCurrentMode() === 'prueba'; } catch { return false; } };
const filaDelModo = (r, esPrueba) => (esPrueba ? r.demo === true : r.demo !== true);
const ahora = () => new Date().toISOString();

const avisarCambio = () => {
  try {
    window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'anticipo_aplicaciones' } }));
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
  idempotency_key: newIdempotencyKey(userId || 'anon', 'anticipo_aplicaciones'),
  ...(esPrueba ? { demo: true, sync_status: SYNC_STATUS.SYNCED } : { sync_status: SYNC_STATUS.PENDING_CREATE }),
});

const mismoPar = (r, cuerpo, esPrueba) =>
  !r.deleted_at
  && r.anticipo_movimiento_id === cuerpo.anticipo_movimiento_id
  && r.factura_movimiento_id === cuerpo.factura_movimiento_id
  && filaDelModo(r, esPrueba);

/** Todas las aplicaciones del modo activo, sin resolver duplicados
 *  (`resolverAplicaciones()` elige cuál manda al leer). */
export async function leerAplicaciones() {
  const esPrueba = esModoPrueba();
  try {
    return await db.anticipo_aplicaciones
      .filter(r => !r.deleted_at && filaDelModo(r, esPrueba)).toArray();
  } catch { return []; }
}

/** Aplica un anticipo a una factura. Si ya había una fila para ese par, se
 *  actualiza en vez de agregar otra. */
export async function aplicarAnticipo(cuerpo, { userId = null } = {}) {
  if (!cuerpo?.anticipo_movimiento_id || !cuerpo?.factura_movimiento_id) {
    throw new Error('aplicarAnticipo: falta el anticipo o la factura.');
  }
  if (cuerpo.anticipo_movimiento_id === cuerpo.factura_movimiento_id) {
    throw new Error('aplicarAnticipo: un anticipo no se aplica a sí mismo.');
  }
  const esPrueba = esModoPrueba();
  const previas = await db.anticipo_aplicaciones.filter(r => mismoPar(r, cuerpo, esPrueba)).toArray();
  const prev = previas[0];
  let id;
  if (prev) {
    await db.anticipo_aplicaciones.update(prev.id, parcheDeUpdate(cuerpo, prev, esPrueba, userId));
    id = prev.id;
  } else {
    const fila = filaNueva(cuerpo, esPrueba, userId);
    await db.anticipo_aplicaciones.add(fila);
    id = fila.id;
  }
  avisarCambio();
  return id;
}

/**
 * Acepta VARIAS propuestas de una. Todo en UNA transacción: o entra el lote
 * entero o no entra nada — un lote a medias dejaría el saldo mostrando un
 * número que nadie pidió.
 */
export async function aplicarEnLote(cuerpos, { userId = null } = {}) {
  const esPrueba = esModoPrueba();
  let n = 0;
  await db.transaction('rw', db.anticipo_aplicaciones, async () => {
    for (const cuerpo of cuerpos || []) {
      if (!cuerpo?.anticipo_movimiento_id || !cuerpo?.factura_movimiento_id) continue;
      if (cuerpo.anticipo_movimiento_id === cuerpo.factura_movimiento_id) continue;
      const previas = await db.anticipo_aplicaciones.filter(r => mismoPar(r, cuerpo, esPrueba)).toArray();
      const prev = previas[0];
      if (prev) await db.anticipo_aplicaciones.update(prev.id, parcheDeUpdate(cuerpo, prev, esPrueba, userId));
      else await db.anticipo_aplicaciones.add(filaNueva(cuerpo, esPrueba, userId));
      n++;
    }
  });
  avisarCambio();
  return n;
}

/** Quita una aplicación: el saldo del anticipo vuelve a subir. */
export async function quitarAplicacion(id) {
  const esPrueba = esModoPrueba();
  const prev = await db.anticipo_aplicaciones.get(id);
  if (!prev) return 0;
  if (prev.sync_status === SYNC_STATUS.PENDING_CREATE || esPrueba) {
    await db.anticipo_aplicaciones.delete(id);
  } else {
    await db.anticipo_aplicaciones.update(id, { deleted_at: ahora(), sync_status: SYNC_STATUS.PENDING_DELETE });
  }
  avisarCambio();
  return 1;
}
