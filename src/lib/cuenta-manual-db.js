// ═══════════════════════════════════════════════════════════════════
// JARVEX — CORREGIR A MANO LA CUENTA DE UN ASIENTO (mig 220).
//
// Pedido de las contadoras: «actualmente no es editable, y eso está mal. Las
// contadoras tienen el criterio del estado peruano mucho más claro, está súper
// bien tener las recomendaciones de la IA pero en caso se crea que se debe
// cambiar el código se debería poder».
//
// ── QUÉ SE GUARDA, Y POR QUÉ NO EL ASIENTO ────────────────────────
// El Libro Diario NO se persiste: se deriva de los movimientos cada vez. Si
// «editar el asiento» guardara el asiento, quedaría una foto congelada que no
// se actualiza cuando cambia el movimiento —el importe, la fecha, el IGV— y a
// la semana el libro y los comprobantes dirían cosas distintas.
//
// Lo que se guarda es la DECISIÓN, en el movimiento:
//   · `cuenta_pcge`               → la cuenta del gasto o del ingreso
//   · `cuenta_pcge_contrapartida` → caja / bancos / por pagar / por cobrar
// y el asiento se sigue derivando, ahora respetándolas.
//
// ── LA DECISIÓN HUMANA LE GANA A LA MÁQUINA, Y SE PUEDE DESHACER ──
// Elegir una cuenta a mano la fija para siempre; «Volver a automático» la
// borra y el reparto vuelve a mandar. Las dos cosas quedan en auditoría: una
// cuenta que le gana al sistema sin que se sepa quién la puso es una cuenta
// que dentro de seis meses nadie se anima ni a confirmar ni a cambiar.
//
// La lógica pura —qué cuentas existen, cuál corresponde— vive en `pcge.js` y
// `pcge-puente.js`, con sus tests. Acá solo está el aterrizaje en Dexie.
// ═══════════════════════════════════════════════════════════════════
import { db, SYNC_STATUS } from '../db/jarvex.db';
import { esCuentaValida, cuenta as cuentaPcge } from './pcge.js';

const avisar = () => {
  try {
    window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'accounting_movements' } }));
  } catch { /* SSR / tests */ }
};

/**
 * Las cuentas que tienen sentido como CONTRAPARTIDA de un asiento.
 *
 * No es una restricción dura —se puede elegir cualquiera del plan— sino lo que
 * se ofrece primero: son las cinco que aparecen en el 99 % de los asientos y
 * tenerlas a un clic evita buscarlas entre 1.792.
 */
export const CONTRAPARTIDAS_FRECUENTES = [
  { codigo: '101', cuando: 'Se pagó o se cobró en efectivo, de la caja.' },
  { codigo: '104', cuando: 'Salió o entró por el banco (transferencia, cheque, Yape).' },
  { codigo: '42',  cuando: 'Queda a deber a un proveedor.' },
  { codigo: '41',  cuando: 'Queda a deber al personal (planilla).' },
  { codigo: '121', cuando: 'Se le factura a un cliente y todavía no cobró.' },
];

/** ¿Se puede guardar esta cuenta? Misma forma que valida el CHECK de la mig 220. */
export function validarCuentaManual(codigo) {
  const c = String(codigo ?? '').trim();
  if (!c) return { ok: true, codigo: null };          // vaciar = volver a automático
  if (!/^[0-9]{2,5}$/.test(c)) {
    return { ok: false, error: 'Una cuenta del PCGE son de 2 a 5 dígitos (63, 631, 6311, 63111).' };
  }
  if (!esCuentaValida(c)) {
    return { ok: false, error: `La cuenta ${c} no existe en el Plan Contable General Empresarial.` };
  }
  return { ok: true, codigo: c, nombre: cuentaPcge(c)?.nombre || '' };
}

/**
 * Fija (o borra) la cuenta de un movimiento.
 *
 * @param {string} movimientoId
 * @param {object} cambios   { cuenta, contrapartida } — `null` en cualquiera
 *                           de los dos la devuelve a automático; `undefined`
 *                           la deja como está.
 * @param {object} ctx       { userId, motivo }
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function fijarCuentaManual(movimientoId, cambios = {}, { userId = null, motivo = '' } = {}) {
  if (!movimientoId) return { ok: false, error: 'Falta el movimiento.' };

  const campos = {};
  for (const [clave, columna] of [['cuenta', 'cuenta_pcge'], ['contrapartida', 'cuenta_pcge_contrapartida']]) {
    if (!(clave in cambios)) continue;
    const v = validarCuentaManual(cambios[clave]);
    if (!v.ok) return { ok: false, error: v.error };
    campos[columna] = v.codigo;
  }
  if (!Object.keys(campos).length) return { ok: false, error: 'No hay nada que cambiar.' };

  // Se lee fresco antes de escribir: `version` tiene que salir de lo que está
  // en el disco, no de la copia que la pantalla tenga en memoria.
  const fresh = await db.accounting_movements.get(movimientoId);
  if (!fresh) return { ok: false, error: 'El comprobante no está en este dispositivo — sincronizá.' };

  const vuelveAAutomatico = Object.values(campos).every(v => v === null);
  const ahora = new Date().toISOString();

  await db.accounting_movements.update(movimientoId, {
    ...campos,
    // La firma se borra junto con la última cuenta manual: si no queda ninguna
    // decisión, tampoco tiene que quedar el rastro de quién la tomó.
    cuenta_pcge_por: vuelveAAutomatico ? null : (userId || fresh.cuenta_pcge_por || null),
    cuenta_pcge_at: vuelveAAutomatico ? null : ahora,
    updated_at: ahora,
    updated_by: userId,
    version: (fresh.version ?? 0) + 1,
    sync_status: fresh.sync_status === SYNC_STATUS.PENDING_CREATE
      ? SYNC_STATUS.PENDING_CREATE
      : SYNC_STATUS.PENDING_UPDATE,
  });

  try {
    await window.__logAudit?.({
      action: 'update',
      table: 'accounting_movements',
      recordId: movimientoId,
      oldData: {
        cuenta_pcge: fresh.cuenta_pcge ?? null,
        cuenta_pcge_contrapartida: fresh.cuenta_pcge_contrapartida ?? null,
      },
      newData: campos,
      reason: motivo
        || (vuelveAAutomatico
          ? `Libro Diario · ${fresh.document_number || 'el comprobante'} vuelve a la cuenta automática`
          : `Libro Diario · cuenta corregida a mano en ${fresh.document_number || 'el comprobante'}`),
    });
  } catch { /* la auditoría no puede impedir la corrección */ }

  avisar();
  return { ok: true, vuelveAAutomatico };
}

/**
 * La misma corrección sobre VARIOS movimientos.
 *
 * Es lo que hace usable la pila de «cuentas por definir»: son 345 en
 * producción y muchas se repiten por proveedor —treinta facturas del mismo
 * grifo son todas 603—. De a una serían treinta decisiones idénticas.
 *
 * Devuelve cuántas se aplicaron y cuáles fallaron; NO aborta al primer error,
 * porque dejar la mitad hecha sin decir cuál es peor que seguir.
 */
export async function fijarCuentaEnLote(ids = [], cambios = {}, ctx = {}) {
  const out = { ok: 0, fallaron: [] };
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    const r = await fijarCuentaManual(id, cambios, ctx);
    if (r.ok) out.ok++; else out.fallaron.push({ id, error: r.error });
  }
  return out;
}

export default { CONTRAPARTIDAS_FRECUENTES, validarCuentaManual, fijarCuentaManual, fijarCuentaEnLote };
