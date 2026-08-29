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

// candidatas: [{ key, tabla, watermark, localCount, excluida, sinServer }]
// → { entries: [{k,t,w}], legacy: [key...] }
//   · excluida (sync por rol) o sinServer → no va a ningún lado.
//   · watermark + datos locales → incremental normal vía RPC.
//   · sin watermark y SIN datos locales → primer pull vía RPC desde el epoch.
//   · watermark con Dexie vacío (recovery) o datos locales sin watermark
//     (full pull con reconcile sweep) → pull legacy: esa lógica vive allá.
export function planPullRpc(candidatas) {
  const entries = [];
  const legacy = [];
  for (const c of candidatas || []) {
    if (!c || !c.key || !c.tabla) continue;
    if (c.excluida || c.sinServer) continue;
    if (c.watermark && c.localCount > 0) {
      entries.push({ k: c.key, t: c.tabla, w: c.watermark });
    } else if (!c.watermark && !(c.localCount > 0)) {
      entries.push({ k: c.key, t: c.tabla, w: EPOCH_WATERMARK });
    } else {
      legacy.push(c.key);
    }
  }
  return { entries, legacy };
}

// entries: las [{k,t,w}] que se ENVIARON. resp: el jsonb devuelto por el RPC.
// → { aplicar: [{key, rows}], fallback: [key...], sinCambios: [key...] }
//   · rows array con filas → aplicar.
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
      if (val.rows.length) aplicar.push({ key: e.k, rows: val.rows });
      else sinCambios.push(e.k);
    } else {
      fallback.push(e.k);
    }
  }
  return { aplicar, fallback, sinCambios };
}

// Claves compuestas para distinguir el pull MASTER del TRANSACCIONAL de una
// misma tabla (ambos loops existen hoy y usan watermarks distintos).
export const KEY_MASTER = (tabla) => `m:${tabla}`;
export const KEY_TX = (tabla) => `t:${tabla}`;
export function tablaDeKey(key) {
  return typeof key === 'string' ? key.slice(2) : '';
}
export function esKeyMaster(key) {
  return typeof key === 'string' && key.startsWith('m:');
}
