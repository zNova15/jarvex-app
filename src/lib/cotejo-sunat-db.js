// ═══════════════════════════════════════════════════════════════════
// JARVEX — ESCRITURA DEL COTEJO (tanda 14, entregas 5 y 6).
//
// La lógica —leer el CSV, cruzar, escanear, resumir— vive en las libs PURAS
// `sunat-csv.js`, `comparativa-sunat.js` y `escaner-incoherencias.js`, que
// tienen tests. Acá solo está el aterrizaje en Dexie.
//
// ── EL CORTE SE REEMPLAZA, LA DECISIÓN NO ─────────────────────────
// Un mes cotejado tiene UNA fila viva por empresa+periodo+libro. Si Gabriel
// vuelve a cargar el CSV de julio —SUNAT actualiza la propuesta del RCE y la
// del día 20 no es la del día 7—, gana el archivo nuevo y el corte anterior se
// da de baja. Las DECISIONES no se tocan nunca en ese camino: son de la
// persona, no del archivo, y volver a cargar el mes no puede borrar el trabajo
// de haber revisado 40 diferencias.
//
// AISLAMIENTO DEL MODO PRUEBA: las dos tablas son globales, así que las filas
// demo conviven con las reales separadas solo por `demo: true`. Toda ruta
// scopea por modo y las demo nunca entran a la cola de push.
// ═══════════════════════════════════════════════════════════════════
import { db, newId, newIdempotencyKey, SYNC_STATUS } from '../db/jarvex.db';
import { getCurrentMode } from './app-mode-core.js';

const esModoPrueba = () => { try { return getCurrentMode() === 'prueba'; } catch { return false; } };
const filaDelModo = (r, esPrueba) => (esPrueba ? r.demo === true : r.demo !== true);
const ahora = () => new Date().toISOString();

const filaNueva = (tabla, campos, esPrueba, userId) => ({
  id: newId(),
  ...campos,
  created_by: userId || null, updated_by: userId || null,
  created_at: ahora(), updated_at: ahora(),
  version: 1,
  idempotency_key: newIdempotencyKey(userId || 'anon', tabla),
  ...(esPrueba ? { demo: true, sync_status: SYNC_STATUS.SYNCED } : { sync_status: SYNC_STATUS.PENDING_CREATE }),
});

const parcheUpdate = (campos, prev, esPrueba, userId) => ({
  ...campos,
  updated_by: userId || null,
  updated_at: ahora(),
  version: (prev?.version ?? 0) + 1,
  sync_status: esPrueba ? SYNC_STATUS.SYNCED
    : (prev?.sync_status === SYNC_STATUS.PENDING_CREATE ? SYNC_STATUS.PENDING_CREATE : SYNC_STATUS.PENDING_UPDATE),
});

/** Los cortes del modo activo, ya sin los dados de baja. */
export async function leerCortes() {
  const esPrueba = esModoPrueba();
  try {
    const filas = await db.sunat_cortes.toArray();
    return filas.filter(r => !r.deleted_at && filaDelModo(r, esPrueba));
  } catch { return []; }
}

/** Las decisiones del modo activo. Puede haber más de una por llave: las dos
 *  PCs deciden por separado y `aplicarDecisiones()` elige cuál manda al leer. */
export async function leerDecisiones(ambito = null) {
  const esPrueba = esModoPrueba();
  try {
    const filas = await db.cotejo_decisiones.toArray();
    return filas.filter(r => !r.deleted_at && filaDelModo(r, esPrueba)
      && (!ambito || r.ambito === ambito));
  } catch { return []; }
}

/**
 * Guarda cómo quedó un mes cotejado, reemplazando el corte anterior de esa
 * misma empresa+periodo+libro.
 *
 * El corte anterior se da de baja con `deleted_at` (baja lógica, como todo en
 * la app) en la MISMA transacción que crea el nuevo: si el guardado falla a
 * medias, no puede quedar el mes sin ningún corte ni con dos.
 */
export async function guardarCorte({ companyId, periodo, libro, archivo, resumen, filasArchivo = 0, avisos = 0 }, userId) {
  const esPrueba = esModoPrueba();
  const nuevo = filaNueva('sunat_cortes', {
    company_id: companyId,
    periodo: String(periodo || ''),
    libro,
    archivo: archivo || null,
    filas_archivo: filasArchivo,
    avisos,
    resumen: resumen || {},
    total: resumen?.total ?? 0,
    cuadran: resumen?.cuadran ?? 0,
    brecha: resumen?.brecha ?? 0,
  }, esPrueba, userId);

  await db.transaction('rw', db.sunat_cortes, async () => {
    const previos = (await db.sunat_cortes.toArray()).filter(r =>
      !r.deleted_at && filaDelModo(r, esPrueba)
      && r.company_id === companyId && r.periodo === String(periodo || '') && r.libro === libro);
    for (const p of previos) {
      await db.sunat_cortes.update(p.id, parcheUpdate({ deleted_at: ahora() }, p, esPrueba, userId));
    }
    await db.sunat_cortes.add(nuevo);
  });
  return nuevo;
}

/**
 * Marca una diferencia (o un hallazgo del escáner) como revisada o no aplicable.
 *
 * Si ya había una decisión para esa llave en ese ámbito, se ACTUALIZA en vez de
 * apilar otra: la pregunta es la misma y la respuesta nueva reemplaza a la
 * vieja. (Las decisiones apiladas que igual pueden aparecer son las de la otra
 * PC, y de esas se encarga `aplicarDecisiones()` al leer.)
 *
 * Con `decision = null` se DESHACE: la diferencia vuelve a la lista de
 * pendientes. Sin esto, un click equivocado sería para siempre.
 */
export async function decidirCotejo({ ambito, llave, decision, nota = '', companyId = null, periodo = null, libro = null, estado = null, documento = null, monto = null }, userId) {
  const esPrueba = esModoPrueba();
  const campos = {
    ambito, llave, decision, nota: nota || null,
    company_id: companyId, periodo, libro, estado, documento,
    monto: monto == null ? null : Number(monto) || 0,
  };

  return db.transaction('rw', db.cotejo_decisiones, async () => {
    const previas = (await db.cotejo_decisiones.toArray()).filter(r =>
      !r.deleted_at && filaDelModo(r, esPrueba) && r.ambito === ambito && r.llave === llave);

    if (!decision) {
      for (const p of previas) {
        await db.cotejo_decisiones.update(p.id, parcheUpdate({ deleted_at: ahora() }, p, esPrueba, userId));
      }
      return null;
    }

    const [primera, ...resto] = previas;
    // Las de más se dan de baja: una sola respuesta viva por pregunta.
    for (const p of resto) {
      await db.cotejo_decisiones.update(p.id, parcheUpdate({ deleted_at: ahora() }, p, esPrueba, userId));
    }
    if (primera) {
      await db.cotejo_decisiones.update(primera.id, parcheUpdate(campos, primera, esPrueba, userId));
      return { ...primera, ...campos };
    }
    const nueva = filaNueva('cotejo_decisiones', campos, esPrueba, userId);
    await db.cotejo_decisiones.add(nueva);
    return nueva;
  });
}

/** Decidir varias de una (el botón «marcar todas las seleccionadas»). */
export async function decidirCotejoLote(items = [], userId) {
  let n = 0;
  for (const it of items) {
    // Secuencial a propósito: cada una abre su transacción y una que falle no
    // puede llevarse puestas a las anteriores.
    try { await decidirCotejo(it, userId); n += 1; } catch { /* sigue con las demás */ }
  }
  return n;
}
