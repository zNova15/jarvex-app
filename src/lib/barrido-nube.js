// ═══════════════════════════════════════════════════════════════════
// JARVEX — LAS RECOMENDACIONES DE IA, EN LA BASE (mig 217, 15-set-2026).
//
// EL DEFECTO, CONTADO POR GABRIEL. «Quiero que las recomendaciones de IA que
// me salían en Staging se mantengan en Main, pues actualmente probé en la PC
// de la Contadora en Jefe y a ella no le salen las recomendaciones por IA por
// las que pagué.»
//
// Y no era un problema de ramas. `barrido-store.js` guardaba todo en
// localStorage, que está atado al NAVEGADOR y al DOMINIO: lo recorrido en la
// PC de Gabriel no existe en la de la contadora, y lo recorrido en el preview
// de staging no cruza a producción aunque se promueva el código. El código
// viaja; los datos no.
//
// ── POR QUÉ ESTE MÓDULO EXISTE APARTE ─────────────────────────────
// `barrido-store.js` tiene una API SÍNCRONA (`leerRecomendaciones()` devuelve
// el objeto, no una promesa) de la que dependen el hook y las tres pantallas.
// Volverla asíncrona sería reescribir esa cadena entera por un cambio de
// almacenamiento. Entonces: localStorage se queda como CACHÉ DE LECTURA
// síncrona —que es para lo que sirve— y esto es el espejo en la base, que se
// escribe sin esperar y se lee una vez al arrancar.
//
// Resultado: la pantalla sigue viendo todo al instante, y lo que se pagó
// aparece en cualquier PC que abra la app.
//
// 🔴 NUNCA LANZA. Si Dexie no está (un test puro, un render en el server),
// cada función falla en silencio y el recorrido sigue funcionando exactamente
// como antes, contra localStorage. Guardar en la nube es una MEJORA de lo que
// ya andaba, no un requisito nuevo para que ande.
// ═══════════════════════════════════════════════════════════════════
import { db, newId, newIdempotencyKey, SYNC_STATUS } from '../db/jarvex.db';
import { getCurrentMode } from './app-mode-core.js';

const esModoPrueba = () => { try { return getCurrentMode() === 'prueba'; } catch { return false; } };
const filaDelModo = (r, esPrueba) => (esPrueba ? r.demo === true : r.demo !== true);
const ahora = () => new Date().toISOString();

// __useAuth ES el hook de React y esto corre desde handlers, nunca en render:
// el try lo tapaba devolviendo null, así que TODA fila de ia_recomendaciones
// quedaba sin `created_by`. El Provider espeja el id en window para esto.
const quienSoy = () => {
  try { return window.__currentUserId || null; } catch { return null; }
};

/** La tabla existe? (una versión vieja de Dexie abierta no la tiene todavía) */
const tabla = () => {
  try { return db?.ia_recomendaciones || null; } catch { return null; }
};

/**
 * Todo lo guardado, en el mismo formato que usa el mapa de `barrido-store`:
 * `{ 'seccion::ambito::id': { ...datos, t } }`.
 *
 * `t` sale de `updated_at` para que el TTL de 15 días siga midiendo lo mismo
 * de los dos lados.
 */
export async function leerTodas() {
  const t = tabla();
  if (!t) return {};
  try {
    const esPrueba = esModoPrueba();
    const filas = await t.filter(r => r && !r.deleted_at && filaDelModo(r, esPrueba)).toArray();
    const out = {};
    for (const f of filas) {
      const k = `${f.seccion}::${f.ambito || '-'}::${f.item_id}`;
      out[k] = { ...(f.datos || {}), t: Date.parse(f.updated_at || '') || Date.now() };
    }
    return out;
  } catch { return {}; }
}

/** La fila viva de una propuesta, o null. */
async function filaDe(t, seccion, ambito, itemId, esPrueba) {
  try {
    return await t.filter(r => r && !r.deleted_at
      && r.seccion === seccion && r.ambito === String(ambito || '-')
      && r.item_id === String(itemId) && filaDelModo(r, esPrueba)).first() || null;
  } catch { return null; }
}

/**
 * Guarda (o pisa) UNA propuesta. Fire-and-forget: quien llama no espera.
 *
 * `datos` va tal cual, sin el `t` de la caché local: la marca de tiempo de la
 * base es `updated_at`, y tener dos relojes para lo mismo es cómo se fabrican
 * los desacuerdos entre las dos PCs.
 */
export async function guardar(seccion, ambito, itemId, datos, { modelo = null } = {}) {
  const t = tabla();
  if (!t) return;
  try {
    const esPrueba = esModoPrueba();
    const userId = quienSoy();
    const { t: _descartar, ...cuerpo } = (datos || {});
    const prev = await filaDe(t, seccion, ambito, itemId, esPrueba);
    if (prev) {
      await t.update(prev.id, {
        datos: cuerpo,
        modelo: modelo || prev.modelo || null,
        updated_by: userId, updated_at: ahora(),
        version: (prev.version ?? 0) + 1,
        sync_status: esPrueba ? SYNC_STATUS.SYNCED
          : (prev.sync_status === SYNC_STATUS.PENDING_CREATE
            ? SYNC_STATUS.PENDING_CREATE : SYNC_STATUS.PENDING_UPDATE),
      });
      return;
    }
    await t.add({
      id: newId(),
      seccion, ambito: String(ambito || '-'), item_id: String(itemId),
      datos: cuerpo, modelo: modelo || null,
      created_by: userId, updated_by: userId,
      created_at: ahora(), updated_at: ahora(),
      version: 1,
      idempotency_key: newIdempotencyKey(userId || 'anon', 'ia_recomendaciones'),
      deleted_at: null,
      ...(esPrueba ? { demo: true, sync_status: SYNC_STATUS.SYNCED } : { sync_status: SYNC_STATUS.PENDING_CREATE }),
    });
  } catch { /* la propuesta ya está en localStorage; esto es el espejo */ }
}

/** Borra una propuesta (se aceptó o se descartó: ya cumplió). */
export async function olvidar(seccion, ambito, itemId) {
  const t = tabla();
  if (!t) return;
  try {
    const esPrueba = esModoPrueba();
    const prev = await filaDe(t, seccion, ambito, itemId, esPrueba);
    if (!prev) return;
    await borrarFila(t, prev, esPrueba);
  } catch { /* ídem */ }
}

/** Borra TODAS las de una sección + ámbito («descartar las propuestas»). */
export async function limpiar(seccion, ambito) {
  const t = tabla();
  if (!t) return;
  try {
    const esPrueba = esModoPrueba();
    const filas = await t.filter(r => r && !r.deleted_at
      && r.seccion === seccion && r.ambito === String(ambito || '-')
      && filaDelModo(r, esPrueba)).toArray();
    for (const f of filas) await borrarFila(t, f, esPrueba);
  } catch { /* ídem */ }
}

/**
 * Lo que nunca llegó al server se borra de verdad; lo que ya viajó va por baja
 * lógica, para que el borrado llegue a la otra PC como tombstone en vez de
 * reaparecer en el próximo pull.
 */
async function borrarFila(t, prev, esPrueba) {
  if (prev.sync_status === SYNC_STATUS.PENDING_CREATE || esPrueba) {
    await t.delete(prev.id);
    return;
  }
  await t.update(prev.id, {
    deleted_at: ahora(),
    updated_by: quienSoy(), updated_at: ahora(),
    version: (prev.version ?? 0) + 1,
    sync_status: SYNC_STATUS.PENDING_DELETE,
  });
}

/**
 * EL RESCATE DE LO QUE YA SE PAGÓ (15-set-2026).
 *
 * Sube a la base lo que está en localStorage y todavía no llegó. Es lo que
 * hace que las 549 propuestas del recorrido de GASOMI —hechas en el preview de
 * staging, en la PC de Gabriel— aparezcan en producción y en la PC de la
 * Contadora Jefe sin volver a pagarlas. Corre una sola vez por sesión, después
 * de hidratar, y solo sube lo que falta: lo que ya está en la base no se pisa.
 *
 * Devuelve cuántas subió, para poder decirlo.
 */
export async function subirFaltantes(mapaLocal, { yaEnLaNube = {} } = {}) {
  const t = tabla();
  if (!t || !mapaLocal) return 0;
  let n = 0;
  for (const [k, v] of Object.entries(mapaLocal)) {
    if (yaEnLaNube[k]) continue;
    // La clave es `seccion::ambito::id` y el id puede traer '::' adentro (los
    // candidatos de correlación se identifican por su contenido), así que se
    // parte por los DOS primeros separadores y el resto es el id.
    const i1 = k.indexOf('::');
    if (i1 < 0) continue;
    const i2 = k.indexOf('::', i1 + 2);
    if (i2 < 0) continue;
    const seccion = k.slice(0, i1);
    const ambito = k.slice(i1 + 2, i2);
    const itemId = k.slice(i2 + 2);
    if (!seccion || !itemId) continue;
    await guardar(seccion, ambito, itemId, v);
    n++;
  }
  return n;
}
