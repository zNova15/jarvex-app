// ═══════════════════════════════════════════════════════════════════
// JARVEX — LAS REGLAS DEL FORMULARIO DE UN COMPROBANTE (tanda D, 25-set-2026).
// Lib PURA. Testeada en __tests__/movimiento-contable-form.test.js.
//
// La revisión Ola 1 encontró que el alta/edición de Movimientos Contables
// (`jx-contabilidad.jsx`) decidía todo en la pantalla y mal:
//   · una nota de crédito (monto NEGATIVO) o una factura en cero no se podían
//     editar — `!form.amount` cortaba el 0 y `monto < 0` el negativo — y el
//     rodeo natural (ponerla en positivo) convertía un crédito en un cargo;
//   · un comprobante en dólares se guardaba sin tipo de cambio (los 6 que
//     quedaron sin tasa salen de ahí);
//   · había tres definiciones distintas de «necesita bancarización» en la
//     misma pantalla (≥ S/ 2.000 o US$ 500 en la cabecera, > S/ 2.000 y solo
//     soles en la fila, el filtro y el modal);
//   · borrar era un soft-delete plano que dejaba colgando pagos, guías,
//     recepciones, aplicaciones de anticipo y el espejo;
//   · editar el monto no tocaba la detracción calculada sobre el monto viejo.
// Las reglas viven acá para que la pantalla solo pinte.
// ═══════════════════════════════════════════════════════════════════

import { requiereBancarizacion } from './tipo-cambio.js';
import { esNota, esNotaCredito, notasPorFactura } from './notas-credito.js';
import { validarTasaManual } from './tipo-cambio-pasada.js';
import { montoDetraccion } from './detraccion.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const vivo = (x) => x && !x.deleted_at;

/**
 * Valida el formulario y devuelve el monto CON SU SIGNO.
 *
 * Reglas (Gabriel, 25-set-2026: la nota de crédito resta en negativo):
 *   · nota de crédito → se guarda NEGATIVA, se haya escrito como se haya
 *     escrito (el papel dice 1.000; el libro, −1.000);
 *   · cualquier otro documento → no negativo; el CERO se acepta (la entrega
 *     cubierta por un anticipo viene así) pero se avisa;
 *   · dólares → tipo de cambio obligatorio y con forma de tipo de cambio;
 *   · RUC del tercero → 8 (DNI) u 11 dígitos, si se escribió;
 *   · fecha futura → aviso, no bloqueo.
 *
 * @returns {{ ok, error, monto, tipoCambio, avisos: string[] }}
 */
export function validarComprobante(form = {}, { hoy = null } = {}) {
  const avisos = [];
  if (!form.company_id || !form.date) return { ok: false, error: 'Empresa y fecha son requeridas.', avisos };
  const crudo = String(form.amount ?? '').trim().replace(',', '.');
  if (crudo === '') return { ok: false, error: 'El monto es requerido (puede ser 0).', avisos };
  const n = Number(crudo);
  if (!Number.isFinite(n)) return { ok: false, error: 'Monto inválido.', avisos };

  let monto;
  if (esNotaCredito(form)) {
    monto = -Math.abs(n);
    if (n > 0) avisos.push('Una nota de crédito se guarda en NEGATIVO: resta. Se guardó como ' + monto.toFixed(2) + '.');
  } else {
    if (n < 0) {
      return { ok: false, error: 'Un monto negativo solo corresponde a una nota de crédito. Si lo es, elegí ese tipo de documento.', avisos };
    }
    monto = n;
    if (n === 0) avisos.push('El comprobante queda en CERO: si es una entrega cubierta por un anticipo, vinculalo en Anticipos para que la mercadería llegue al libro.');
  }

  let tipoCambio = null;
  const moneda = String(form.currency || 'PEN').toUpperCase();
  if (moneda !== 'PEN') {
    const v = validarTasaManual(form.tipo_cambio);
    if (!v.ok) {
      return { ok: false, error: `Un comprobante en ${moneda} necesita el tipo de cambio de su fecha de emisión (el libro se lleva en soles). ${form.tipo_cambio ? v.error : ''}`.trim(), avisos };
    }
    tipoCambio = v.valor;
  }

  const ruc = String(form.third_party_ruc || '').replace(/\D/g, '');
  if (ruc && ruc.length !== 11 && ruc.length !== 8) {
    return { ok: false, error: `El documento del tercero tiene ${ruc.length} dígitos: un RUC tiene 11 y un DNI 8.`, avisos };
  }
  if (hoy && String(form.date) > String(hoy)) {
    avisos.push(`La fecha (${form.date}) es posterior a hoy (${hoy}). Revisala: un comprobante no se emite en el futuro.`);
  }
  return { ok: true, error: null, monto: r2(monto), tipoCambio, avisos };
}

/**
 * LA regla de bancarización de la pantalla (D.L. 1529): desde S/ 2.000 o
 * US$ 500. Una nota de crédito no se bancariza (no es un pago) y una factura
 * anulada entera por su nota tampoco (Gabriel, 25-set: quedan las dos vivas,
 * pero no hubo pago que bancarizar).
 *
 * @param notasMap  el Map de `notasPorFactura` (opcional)
 */
export function necesitaBancarizacion(m, { notasMap = null } = {}) {
  if (!vivo(m) || m.payment_status === 'cancelled' || esNota(m)) return false;
  if (notasMap instanceof Map && notasMap.get(m.id)?.anulada) return false;
  return requiereBancarizacion(Math.abs(Number(m.amount) || 0), m.currency || 'PEN', m.tipo_cambio, m.date);
}

/**
 * Lo que arrastra EDITAR un comprobante ya guardado.
 *
 * @param orig  la fila como estaba
 * @param nuevo los campos que se van a guardar (amount con signo, currency…)
 * @param ctx   { partes: pagos_partes vivas del mov, aplicaciones: anticipo_aplicaciones vivas }
 * @returns {{ bloqueos: string[], confirmar: string[], patch: object }}
 *   `patch` son campos extra a escribir (hoy: la detracción recalculada).
 */
export function consecuenciasDeEditar(orig = {}, nuevo = {}, { partes = [], aplicaciones = [] } = {}) {
  const bloqueos = [];
  const confirmar = [];
  const patch = {};
  const montoViejo = Math.abs(Number(orig.amount) || 0);
  const montoNuevo = Math.abs(Number(nuevo.amount) || 0);
  const cambioMonto = Math.abs(montoViejo - montoNuevo) > 0.005;
  const cambioMoneda = String(orig.currency || 'PEN').toUpperCase() !== String(nuevo.currency || 'PEN').toUpperCase();
  const cambioEmpresa = (orig.company_id || null) !== (nuevo.company_id || null);
  const cambioTc = Number(orig.tipo_cambio || 0) !== Number(nuevo.tipo_cambio || 0);

  // 1. La detracción se calculó sobre el monto viejo: se recalcula (si hay %).
  if (orig.detraccion_aplica && (cambioMonto || cambioMoneda || cambioTc) && Number(orig.detraccion_pct) > 0) {
    const m = montoDetraccion({ total: montoNuevo, moneda: nuevo.currency || 'PEN', tipoCambio: nuevo.tipo_cambio, pct: orig.detraccion_pct });
    if (m != null && Math.abs(m - Number(orig.detraccion_monto || 0)) > 0.005) {
      if (orig.detraccion_estado === 'depositada') {
        confirmar.push(`La detracción ya está DEPOSITADA por S/ ${Number(orig.detraccion_monto || 0).toFixed(2)}; con el monto nuevo serían S/ ${m.toFixed(2)}. No se cambia sola: revisá la constancia.`);
      } else {
        patch.detraccion_monto = m;
        confirmar.push(`La detracción se recalcula: S/ ${Number(orig.detraccion_monto || 0).toFixed(2)} → S/ ${m.toFixed(2)} (${orig.detraccion_pct}%).`);
      }
    }
  }

  // 2. Plata ya aplicada: no se puede bajar el monto por debajo de lo pagado.
  const pagado = r2((partes || []).filter(vivo).reduce((s, p) => s + Math.abs(Number(p.monto) || 0), 0));
  if (pagado > 0 && montoNuevo + 0.005 < pagado) {
    bloqueos.push(`Ya tiene pagos de bancarización por ${pagado.toFixed(2)}: el monto no puede quedar en ${montoNuevo.toFixed(2)}. Corregí o quitá primero esas partes.`);
  }
  if (pagado > 0 && cambioMoneda) {
    bloqueos.push('Tiene pagos de bancarización registrados en su moneda actual: cambiar la moneda los dejaría mal. Quitalos primero.');
  }
  const aplicado = r2((aplicaciones || []).filter(vivo).reduce((s, a) => s + Math.abs(Number(a.monto) || 0), 0));
  if (aplicado > 0 && cambioMoneda) {
    bloqueos.push('Está vinculado a un anticipo en su moneda actual: cambiar la moneda lo dejaría mal. Quitá primero la aplicación en Anticipos.');
  }

  // 3. Cambiar de empresa mueve el comprobante de libro con todo lo que cuelga.
  if (cambioEmpresa && (pagado > 0 || aplicado > 0)) {
    confirmar.push('Cambia de empresa un comprobante con pagos o anticipos vinculados: esos vínculos siguen apuntando a él, revisá que la otra empresa sea la correcta.');
  }
  if (orig.related_movement_id && (cambioMonto || cambioMoneda)) {
    confirmar.push('Tiene su espejo cargado en la otra empresa: el cambio NO se copia allá. Editá también la otra pata.');
  }
  return { bloqueos, confirmar, patch };
}

/**
 * Qué hay que desvincular antes de borrar un comprobante, y qué lo impide.
 *
 * Antes era un soft-delete plano: quedaban `pagos_partes` vivas contra un id
 * borrado (el depósito seguía consumido), `guia_factura` amparando nada, la
 * recepción de almacén «con factura», aplicaciones de anticipo consumiendo
 * saldo y el espejo apuntando a un comprobante muerto.
 *
 * @param mov  el comprobante a borrar
 * @param ctx  { movs, partes, guiaFactura, guias, recepciones, aplicaciones }
 * @returns {{ bloqueos: string[], resumen: string[], acciones: object }}
 */
export function planDeBorrado(mov, {
  movs = [], partes = [], guiaFactura = [], guias = [], recepciones = [], aplicaciones = [],
} = {}) {
  const bloqueos = [];
  const resumen = [];
  if (!mov) return { bloqueos: ['El comprobante no está en este dispositivo.'], resumen, acciones: {} };
  const id = mov.id;

  // Una nota que modifica ESTA factura quedaría huérfana: se reenlaza o se
  // borra primero (mismo criterio que el escáner al borrar una copia).
  const notas = (movs || []).filter(m => vivo(m) && m.id !== id && m.related_movement_id === id && esNota(m));
  if (notas.length) {
    bloqueos.push(`${notas.map(n => n.document_number || 's/n').join(', ')} modifica este comprobante: borrala o reenlazala primero, o queda una nota sin factura.`);
  }

  const acciones = {
    partes: (partes || []).filter(p => vivo(p) && p.accounting_movement_id === id).map(p => p.id),
    guiaFactura: (guiaFactura || []).filter(v => vivo(v) && v.accounting_movement_id === id).map(v => v.id),
    guias: (guias || []).filter(g => vivo(g) && g.accounting_movement_id === id).map(g => g.id),
    recepciones: (recepciones || []).filter(r => vivo(r) && r.accounting_movement_id === id).map(r => r.id),
    aplicaciones: (aplicaciones || []).filter(a => vivo(a) && (a.factura_movimiento_id === id || a.anticipo_movimiento_id === id)).map(a => a.id),
    // El espejo que apunta a este comprobante (no una nota): se le limpia el puntero.
    espejos: (movs || []).filter(m => vivo(m) && m.id !== id && m.related_movement_id === id && !esNota(m)).map(m => m.id),
  };
  const n = (k) => acciones[k].length;
  if (n('partes')) resumen.push(`${n('partes')} pago(s) de bancarización se dan de baja (el depósito vuelve a tener ese saldo libre)`);
  if (n('guiaFactura') || n('guias')) resumen.push(`${n('guiaFactura') + n('guias')} vínculo(s) con guías se sueltan (la guía vuelve a «requiere factura»)`);
  if (n('recepciones')) resumen.push(`${n('recepciones')} recepción(es) de almacén dejan de figurar «con factura»`);
  if (n('aplicaciones')) resumen.push(`${n('aplicaciones')} aplicación(es) de anticipo se quitan (el saldo del anticipo se libera)`);
  if (n('espejos')) resumen.push(`${n('espejos')} espejo(s) en la otra empresa dejan de apuntar acá (no se borran)`);
  return { bloqueos, resumen, acciones };
}

/** ¿El movimiento está anulado entero por su nota? (atajo para la pantalla) */
export const anuladaPorNota = (m, movs) => !!notasPorFactura(movs || []).get(m?.id)?.anulada;

export default { validarComprobante, necesitaBancarizacion, consecuenciasDeEditar, planDeBorrado, anuladaPorNota };
