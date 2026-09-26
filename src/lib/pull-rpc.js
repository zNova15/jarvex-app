// JARVEX — Fase 2 del plan de consumo: pull incremental consolidado (RPC sync_pull).
//
// Lógica PURA (sin red, sin Dexie) para que el SyncEngine decida:
//  1) qué tablas viajan en el RPC consolidado y cuáles van al pull legacy
//     por-tabla de siempre (planPullRpc), y
//  2) qué hacer con cada clave de la respuesta del RPC (interpretarRespuestaPull):
//     aplicar filas, no hacer nada (sin cambios) o caer al pull legacy.
//
// Regla de oro: ante CUALQUIER duda (respuesta rara, truncada, con error, clave
// ausente) la tabla cae al pull legacy — el camino probado. El RPC solo puede
// AHORRAR requests, nunca dejar una tabla sin sincronizar.

// Watermark "época" para tablas vacías local y sin watermark: pedir el
// incremental desde el inicio de los tiempos equivale a su primer pull, pero
// viaja dentro del mismo request consolidado (mismo epoch que ya usa el pull
// transaccional legacy como base). Si la tabla tiene más filas que el tope del
// RPC, vuelve {trunc:true} y cae al full pull legacy paginado.
export const EPOCH_WATERMARK = '2020-01-01T00:00:00+00:00';

// ── CURSOR COMPUESTO EN EL RPC (tanda E, 26-set-2026) ─────────────────────
// Hasta la mig 231 el RPC filtraba `updated_at >= w` sin id: cada bloque de
// filas con el mismo sello (un pushCreatesBatch de 200 filas comparte el
// `now()` de su transacción) volvía a viajar ENTERO en cada ciclo, a cada
// dispositivo, y el techo de pull no lo veía porque solo medía la ruta legacy.
// Es la forma exacta del corte por egress del 9-sep, por otra puerta.
//
// Ahora toda entrada incremental lleva `i` y el RPC filtra
// (updated_at, id) > (w, i): lo posterior al sello MÁS lo del mismo sello que
// todavía no se vio. Si el watermark se grabó sin id (versiones viejas), el id
// más chico posible hace que la comparación sea exactamente el `>=` de antes
// — una sola vez, porque ese ciclo ya graba el id del borde.
// Todas las tablas de public tienen id uuid (medido el 26-set); si alguna no
// lo tuviera, el cast falla adentro del RPC, vuelve {err} y cae a legacy.
export const ID_MINIMO = '00000000-0000-0000-0000-000000000000';

// Marca de "vacía verificada" para un watermark nulo (no se puede usar null
// como valor en el mapa: se confundiría con "sin marca").
export const SIN_WATERMARK = '∅';

// candidatas: [{ key, tabla, watermark, watermarkId, localCount, vaciaEn,
//                excluida, sinServer }]
//   vaciaEn: el watermark (o SIN_WATERMARK) con el que un full pull de esta
//            clave ya volvió VACÍO. Ver marcaVaciaCoincide.
// → { entries: [{k,t,w,i?}], legacy: [key...] }
//   · excluida (sync por rol o frenada) o sinServer → no va a ningún lado.
//   · watermark + datos locales → incremental por cursor compuesto (con `i`).
//   · sin watermark y SIN datos locales → primer pull vía RPC desde el epoch.
//   · watermark con Dexie vacío (recovery) o datos locales sin watermark
//     (full pull con reconcile sweep) → pull legacy: esa lógica vive allá.
//     SALVO que ese mismo full pull ya se hizo con este watermark y volvió
//     vacío: entonces la tabla está al día (solo tiene filas borradas en el
//     server, o solo filas de modo prueba en local) y mandarla otra vez a
//     legacy era el bucle de 1-2 GET vacíos por tabla por ciclo, para siempre,
//     que se veía en los logs (~40 tablas de módulos probados y limpiados).
export function planPullRpc(candidatas) {
  const entries = [];
  const legacy = [];
  for (const c of candidatas || []) {
    if (!c || !c.key || !c.tabla) continue;
    if (c.excluida || c.sinServer) continue;
    const hayLocal = c.localCount > 0;
    const vaciaVerificada = marcaVaciaCoincide(c.vaciaEn, c.watermark);
    if (c.watermark && (hayLocal || vaciaVerificada)) {
      entries.push({ k: c.key, t: c.tabla, w: c.watermark, i: c.watermarkId || ID_MINIMO });
    } else if (!c.watermark && (!hayLocal || vaciaVerificada)) {
      entries.push({ k: c.key, t: c.tabla, w: EPOCH_WATERMARK });
    } else {
      legacy.push(c.key);
    }
  }
  return { entries, legacy };
}

// ¿La marca de "vacía" corresponde al watermark actual? Un watermark que se
// movió desde entonces (llegaron filas, se borraron) invalida la marca.
export function marcaVaciaCoincide(vaciaEn, watermark) {
  if (vaciaEn == null) return false;
  return vaciaEn === (watermark || SIN_WATERMARK);
}

// entries: las [{k,t,w,i?}] que se ENVIARON. resp: el jsonb devuelto por el RPC.
// → { aplicar: [{key, rows, mas}], fallback: [key...], sinCambios: [key...] }
//   · rows array con filas → aplicar. `mas` = la página del cursor compuesto
//     vino llena: hay más filas detrás de la última (el SyncEngine pide otra
//     ronda desde ahí; si no alcanza el ciclo, sigue el próximo — keyset no
//     pierde nada).
//   · rows array vacío → sinCambios (la tabla está al día; NO hay que hacer nada
//     y el watermark no se mueve — misma semántica que "0 registros nuevos").
//   · trunc / err / skip / clave ausente / forma inválida → fallback (legacy).
//   · resp nulo o con __err global → TODO a fallback.
export function interpretarRespuestaPull(entries, resp) {
  const aplicar = [];
  const fallback = [];
  const sinCambios = [];
  const lista = entries || [];
  if (!resp || typeof resp !== 'object' || Array.isArray(resp) || resp.__err) {
    return { aplicar, fallback: lista.map(e => e.k), sinCambios };
  }
  for (const e of lista) {
    const val = resp[e.k];
    if (val && Array.isArray(val.rows)) {
      if (val.rows.length) aplicar.push({ key: e.k, rows: val.rows, mas: val.mas === true });
      else sinCambios.push(e.k);
    } else {
      fallback.push(e.k);
    }
  }
  return { aplicar, fallback, sinCambios };
}

// Error GLOBAL del RPC que no es de una tabla. `usuario_inactivo` lo manda la
// mig 235 cuando profiles.activo = false (o el JWT no tiene perfil).
export function errorGlobalDelPull(resp) {
  if (resp && typeof resp === 'object' && !Array.isArray(resp) && typeof resp.__err === 'string') {
    return resp.__err;
  }
  return null;
}

// Claves compuestas para distinguir el pull MASTER del TRANSACCIONAL de una
// misma tabla. Desde la tanda E cada tabla viaja UNA sola vez por ciclo: las
// que están en MASTER_TABLES por la clave m:, y solo las transaccional-only
// (movimientos_materiales/herramientas, asistencia, avance_obra, incidencias,
// evidencias) por la t:. Antes las 109 tablas que figuraban en las dos listas
// se pedían dos veces, con dos watermarks.
export const KEY_MASTER = (tabla) => `m:${tabla}`;
export const KEY_TX = (tabla) => `t:${tabla}`;
export function tablaDeKey(key) {
  return typeof key === 'string' ? key.slice(2) : '';
}
export function esKeyMaster(key) {
  return typeof key === 'string' && key.startsWith('m:');
}
