// ═══════════════════════════════════════════════════════════════════
// JARVEX — LA PASADA DE TIPOS DE CAMBIO, aterrizada: internet + Dexie.
//
// El plan puro está en `tipo-cambio-pasada.js` con sus tests. Acá está lo que
// no se puede testear sin un navegador: pedirle la tasa a SUNAT por nuestro
// proxy y escribir las dos cosas que la pasada escribe.
//
// ── DOS ESCRITURAS, Y NO SON LA MISMA (mig 222) ───────────────────
// 1. La fila de `tipos_cambio`: la tasa de ESA FECHA. Se pide una vez en la
//    vida; el device que la pidió la deja para el otro y para todos los meses
//    que vengan.
// 2. El campo `tipo_cambio` de cada comprobante de esa fecha: la tasa CON LA
//    QUE SE DECLARA. Queda congelada a propósito — si mañana alguien corrige
//    la tasa de una fecha, lo ya declarado no se mueve solo.
//
// ── POR QUÉ SE ESPACIAN LOS PEDIDOS ──────────────────────────────
// Medido el 17-set-2026: la API gratuita devuelve 429 al tercer pedido seguido
// desde la misma IP. Con 23 fechas y sin pausa, la pasada muere a la tercera.
// Con una pausa corta entre fechas, entra. Y si igual aparece un 429, la
// pasada NO sigue golpeando: corta, dice hasta dónde llegó y deja lo hecho
// guardado, porque cada fecha ya quedó en la base y la próxima corrida arranca
// desde ahí.
// ═══════════════════════════════════════════════════════════════════
import { db, SYNC_STATUS } from '../db/jarvex.db';
import { apiFetch } from './api-client';
import { planDePasada, validarTasaManual } from './tipo-cambio-pasada.js';

const avisar = (tabla) => {
  try {
    window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla } }));
  } catch { /* SSR / tests */ }
};

const dormir = (ms) => new Promise(r => setTimeout(r, ms));

/** Pausa entre fechas. Corta para que 23 fechas no sean una espera eterna, y
 *  suficiente para no chocar con el rate limit del proveedor gratuito. */
export const PAUSA_ENTRE_FECHAS_MS = 1200;

/**
 * Le pide a SUNAT la tasa de UNA fecha, por nuestro proxy.
 *
 * Va por `/api/sunat?tipoCambio=` y no directo a la API pública porque ésa no
 * manda cabeceras CORS: desde el navegador el fetch moría en silencio.
 *
 * @returns {Promise<{ok:boolean, compra?:number, venta?:number, status?:number, error?:string}>}
 */
export async function consultarTasaSunat(fecha) {
  if (!navigator?.onLine) return { ok: false, error: 'Sin conexión: la tasa se puede cargar a mano.', status: 0 };
  let res;
  try {
    res = await apiFetch(`/api/sunat?tipoCambio=${encodeURIComponent(fecha)}`, { timeout: 12000 });
  } catch (e) {
    return { ok: false, error: e?.name === 'AbortError' ? 'SUNAT tardó demasiado.' : 'No se pudo conectar.', status: 0 };
  }
  let body = null;
  try { body = await res.json(); } catch { /* sin cuerpo */ }
  if (!res.ok) {
    return { ok: false, status: res.status, error: body?.error || `El servicio respondió ${res.status}` };
  }
  const venta = Number(body?.venta);
  if (!(venta > 0)) return { ok: false, status: 200, error: 'La respuesta no trajo tipo de cambio.' };
  return { ok: true, compra: Number(body.compra) || venta, venta, fuente: 'sunat' };
}

/**
 * Guarda la tasa de una fecha.
 *
 * No busca ni actualiza una fila previa: inserta. La mig 222 no pone UNIQUE
 * sobre `fecha` a propósito (dos PCs offline pidiendo el mismo día no pueden
 * romper el push por un caso benigno), y `tasaVigente()` resuelve al leer.
 */
export async function guardarTasa({ fecha, compra, venta, fuente = 'sunat', nota = '', moneda = 'USD' }, { userId = null } = {}) {
  const v = validarTasaManual(venta);
  if (!v.ok) return { ok: false, error: v.error };
  const c = compra != null && compra !== '' ? validarTasaManual(compra) : { ok: true, valor: v.valor };
  if (!c.ok) return { ok: false, error: `Tipo de cambio de compra: ${c.error}` };

  const id = window.__newId ? window.__newId() : crypto.randomUUID();
  const ahora = new Date().toISOString();
  await db.tipos_cambio.add({
    id,
    fecha: String(fecha).slice(0, 10),
    moneda: String(moneda || 'USD').toUpperCase(),
    compra: c.valor,
    venta: v.valor,
    fuente,
    nota: nota || null,
    created_by: userId, updated_by: userId,
    created_at: ahora, updated_at: ahora,
    version: 1,
    deleted_at: null,
    idempotency_key: `${userId || 'anon'}_tc_${fecha}_${fuente}`,
    last_synced_at: null,
    sync_status: SYNC_STATUS.PENDING_CREATE,
  });
  try {
    await window.__logAudit?.({
      action: 'insert', table: 'tipos_cambio', recordId: id,
      newData: { fecha, compra: c.valor, venta: v.valor, fuente },
      reason: fuente === 'manual'
        ? `Tipo de cambio del ${fecha} cargado a mano desde el portal de SUNAT`
        : `Tipo de cambio del ${fecha} traído de SUNAT`,
    });
  } catch { /* la auditoría no puede impedir guardar la tasa */ }
  avisar('tipos_cambio');
  return { ok: true, id, compra: c.valor, venta: v.valor };
}

/**
 * Estampa la tasa en los comprobantes de una fecha.
 *
 * La de VENTA para las compras (es la que se paga) y la de COMPRA para las
 * ventas — el mismo criterio que `tasaDeComprobante()`.
 */
export async function estamparEnComprobantes(ids = [], { compra, venta }, { userId = null } = {}) {
  let ok = 0;
  const fallaron = [];
  for (const id of ids) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const fresh = await db.accounting_movements.get(id);
      if (!fresh) { fallaron.push({ id, error: 'no está en este dispositivo' }); continue; }
      if (Number(fresh.tipo_cambio) > 0) continue;        // ya tiene: no se pisa
      const esVenta = (fresh.clase || (fresh.type === 'income' ? 'venta' : 'compra')) === 'venta';
      const valor = esVenta ? (Number(compra) || Number(venta)) : Number(venta);
      if (!(valor > 0)) { fallaron.push({ id, error: 'tasa inválida' }); continue; }
      const ahora = new Date().toISOString();
      // eslint-disable-next-line no-await-in-loop
      await db.accounting_movements.update(id, {
        tipo_cambio: valor,
        updated_at: ahora, updated_by: userId,
        version: (fresh.version ?? 0) + 1,
        sync_status: fresh.sync_status === SYNC_STATUS.PENDING_CREATE
          ? SYNC_STATUS.PENDING_CREATE
          : SYNC_STATUS.PENDING_UPDATE,
      });
      ok++;
    } catch (e) {
      fallaron.push({ id, error: e?.message || String(e) });
    }
  }
  if (ok) avisar('accounting_movements');
  return { ok, fallaron };
}

/**
 * LA PASADA: recorre las fechas que faltan, pide cada una UNA vez, la guarda y
 * estampa sus comprobantes.
 *
 * @param {object} args
 *  · `movs`   los movimientos a mirar (los de la empresa/período, o todos)
 *  · `tasas`  las tasas ya guardadas (del hook)
 *  · `onProgreso` (parcial) => void — para la barra de la pantalla
 *  · `traer`  inyectable para los tests; por defecto `consultarTasaSunat`
 * @returns {Promise<{fechasTraidas, fechasYaEstaban, comprobantes, fallaron, cortada}>}
 */
export async function ejecutarPasada({ movs = [], tasas = [], userId = null, onProgreso = null, traer = consultarTasaSunat } = {}) {
  const plan = planDePasada(movs, tasas);
  const out = {
    total: plan.fechas.length, fechasTraidas: 0, fechasYaEstaban: 0,
    comprobantes: 0, fallaron: [], cortada: null,
  };

  for (let i = 0; i < plan.fechas.length; i++) {
    const f = plan.fechas[i];
    onProgreso?.({ ...out, fecha: f.fecha, hecho: i, de: plan.fechas.length });

    let tasa = f.tasa ? { compra: Number(f.tasa.compra), venta: Number(f.tasa.venta) } : null;

    if (!tasa) {
      // eslint-disable-next-line no-await-in-loop
      const r = await traer(f.fecha);
      if (!r.ok) {
        out.fallaron.push({ fecha: f.fecha, error: r.error, status: r.status });
        // Un 429 no se reintenta en bucle: se corta y se dice hasta dónde
        // llegó. Lo hecho quedó guardado, así que la próxima corrida sigue.
        if (r.status === 429) { out.cortada = 'limite'; break; }
        // eslint-disable-next-line no-await-in-loop
        await dormir(PAUSA_ENTRE_FECHAS_MS);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const g = await guardarTasa({ fecha: f.fecha, compra: r.compra, venta: r.venta, fuente: 'sunat', moneda: f.moneda }, { userId });
      if (!g.ok) { out.fallaron.push({ fecha: f.fecha, error: g.error }); continue; }
      tasa = { compra: g.compra, venta: g.venta };
      out.fechasTraidas++;
      // eslint-disable-next-line no-await-in-loop
      await dormir(PAUSA_ENTRE_FECHAS_MS);
    } else {
      out.fechasYaEstaban++;
    }

    // eslint-disable-next-line no-await-in-loop
    const e = await estamparEnComprobantes(f.ids, tasa, { userId });
    out.comprobantes += e.ok;
    if (e.fallaron.length) out.fallaron.push(...e.fallaron.map(x => ({ ...x, fecha: f.fecha })));
  }

  onProgreso?.({ ...out, hecho: plan.fechas.length, de: plan.fechas.length });
  return out;
}

export default {
  consultarTasaSunat, guardarTasa, estamparEnComprobantes, ejecutarPasada,
  PAUSA_ENTRE_FECHAS_MS,
};
