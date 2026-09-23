// ═══════════════════════════════════════════════════════════════════
// JARVEX — MOVER UN COMPROBANTE AL MES EN QUE SE DECLARA (mig 227).
//
// El aterrizaje en Dexie de lo que decide `periodo-declaracion.js`, que es la
// lib pura con las reglas y los tests. Acá solo está la escritura.
//
// ── LO QUE NO HACE, Y ES A PROPÓSITO ──────────────────────────────
// NO toca `date`. Mover un comprobante de febrero a junio no es cambiarle la
// fecha al papel: es decir en qué período se usa su crédito fiscal. El
// registro lleva las dos columnas y el PLE también. Cambiar la fecha «para que
// salga en el mes correcto» dejaría el registro cuadrado y el comprobante
// falseado, que es el peor de los dos mundos.
//
// ── EL MES YA PRESENTADO SE REGISTRA, NO SE FRENA ─────────────────
// Misma decisión que en `cuenta-manual-db.js` (22-set): el freno se disparaba
// casi siempre y solo enseñaba a marcar la casilla sin leerla. Lo que queda es
// que la auditoría diga que se tocó un mes declarado, que es el dato que
// alguien va a buscar dentro de un año.
// ═══════════════════════════════════════════════════════════════════
import { db, SYNC_STATUS } from '../db/jarvex.db';
import { validarPeriodoDeclarado, periodoDeEmision, humano } from './periodo-declaracion.js';
import { CERRADO_HASTA_DEFAULT, movEnPeriodoCerrado, motivoForzado } from './periodo-contable.js';

const avisar = () => {
  try {
    window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'accounting_movements' } }));
  } catch { /* SSR / tests */ }
};

/**
 * Fija (o vacía) el período en el que se declara un comprobante.
 *
 * @param {string} movimientoId
 * @param {string} periodo      'YYYYMM', o '' para volver al mes de emisión
 * @param {object} ctx          { userId, periodosPresentados, cerradoHasta }
 * @returns {{ ok:boolean, error?:string, avisos?:string[], periodo?:string|null }}
 */
export async function fijarPeriodoDeclarado(movimientoId, periodo, {
  userId = null, periodosPresentados = [], cerradoHasta = CERRADO_HASTA_DEFAULT,
} = {}) {
  if (!movimientoId) return { ok: false, error: 'Falta el comprobante.' };

  // Fresco del disco: `version` sale de lo que está guardado, no de la copia
  // que la pantalla tenga en memoria.
  const fresh = await db.accounting_movements.get(movimientoId);
  if (!fresh) return { ok: false, error: 'El comprobante no está en este dispositivo — sincronizá.' };

  const pedido = String(periodo || '').replace(/\D/g, '').slice(0, 6);
  const v = validarPeriodoDeclarado(fresh, pedido, { periodosPresentados });
  if (!v.ok) return { ok: false, error: v.error };

  // Guardar el mes de emisión en `periodo_declarado` sería guardar el caso
  // normal como si fuera una excepción: después no hay forma de saber cuáles
  // se movieron de verdad. Vacío = se declara donde se emitió.
  const emision = periodoDeEmision(fresh);
  const valor = (!pedido || pedido === emision) ? null : pedido;
  if ((fresh.periodo_declarado || null) === valor) {
    return { ok: true, avisos: v.avisos, periodo: valor, sinCambio: true };
  }

  const ahora = new Date().toISOString();
  await db.accounting_movements.update(movimientoId, {
    periodo_declarado: valor,
    updated_at: ahora,
    updated_by: userId,
    version: (fresh.version ?? 0) + 1,
    sync_status: fresh.sync_status === SYNC_STATUS.PENDING_CREATE
      ? SYNC_STATUS.PENDING_CREATE
      : SYNC_STATUS.PENDING_UPDATE,
  });

  try {
    const enCerrado = movEnPeriodoCerrado(fresh, cerradoHasta);
    await window.__logAudit?.({
      action: 'update',
      table: 'accounting_movements',
      recordId: movimientoId,
      oldData: { periodo_declarado: fresh.periodo_declarado ?? null },
      newData: { periodo_declarado: valor },
      reason: [
        valor
          ? `Registro de Compras y Ventas · ${fresh.document_number || 'el comprobante'} (emitido en ${humano(emision)}) pasa a declararse en ${humano(valor)}`
          : `Registro de Compras y Ventas · ${fresh.document_number || 'el comprobante'} vuelve a declararse en su mes de emisión (${humano(emision)})`,
        enCerrado ? motivoForzado(fresh, cerradoHasta) : '',
      ].filter(Boolean).join(' · '),
    });
  } catch { /* la auditoría no puede impedir la corrección */ }

  avisar();
  return { ok: true, avisos: v.avisos, periodo: valor };
}

export default { fijarPeriodoDeclarado };
