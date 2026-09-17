// ═══════════════════════════════════════════════════════════════════
// JARVEX — ANULACIÓN EN CASCADA POR NOTA DE CRÉDITO (tanda 9).
//
// Decisión de Gabriel (17-set-2026): «la anulación en cascada por nota de
// crédito va a la tanda 9». Es la última del plan de contabilidad y la que
// cierra el círculo: la tanda 5 le puso un botón para dar de baja UNA factura;
// esto contesta la pregunta completa —¿qué más deja de ser cierto cuando una
// factura se anula?— y lo aplica de una vez.
//
// ── LO MEDIDO EN PRODUCCIÓN (17-set-2026) ─────────────────────────
// 22 facturas tienen nota de crédito. 21 están ANULADAS (las notas cubren el
// importe entero) y las 21 siguen VIVAS en el sistema, en 6 empresas y desde
// 2023: S/ 1.724.651,07 y US$ 54.874,04 sumando sin deber. Lo que eso venía
// costando, contado:
//   · 8 tienen detracción PENDIENTE — la app reclama el depósito de un
//     comprobante que ya no existe. Una es de S/ 478.808,08.
//   · 11 figuran PAGADAS: el asiento les acredita caja o banco por plata que
//     volvió (o que nunca salió).
//   · 1 tiene recepción pendiente en almacén y 1 tiene orden de compra.
//   · Y el caso que da nombre a la tanda: la E001-43 de S/ 9.000 está cargada
//     DOS VECES —venta en AGENCIA DE VIAJES, compra en CONSORCIO EL INCA— y la
//     misma nota anula las dos. Dar de baja una sola deja al grupo declarando
//     una compra que del otro lado no existe.
//
// ── QUÉ SE ESCRIBE Y QUÉ ES DERIVADO ──────────────────────────────
// Se escribe UN campo por comprobante: `payment_status = 'cancelled'`. Nada
// más. El asiento, el registro, el PLE, el costo de obra y los reportes ya
// filtran por ese estado, así que la cascada de verdad es que TODO eso se
// acomoda solo. Esta lib no inventa tablas ni columnas: lo que hace es decir,
// antes de tocar nada, qué va a cambiar — y frenar cuando hay plata en el
// medio, porque un pago aplicado no se desanula solo.
// ═══════════════════════════════════════════════════════════════════

import { notasPorFactura, esNota } from './notas-credito.js';
import { requiereBancarizacion } from './tipo-cambio.js';

const abs = (n) => Math.abs(Number(n) || 0);
const vivo = (m) => m && !m.deleted_at;
const fmt = (n, moneda = 'PEN') =>
  `${moneda === 'USD' ? 'US$' : 'S/'} ${abs(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * El ESPEJO intercompany de una factura: el mismo comprobante visto desde el
 * otro libro.
 *
 * `related_movement_id` se usa para dos cosas distintas en esta tabla: en una
 * NOTA apunta a la factura que modifica; en una FACTURA apunta a su espejo. Se
 * distingue por lo que hay del otro lado — si es una nota, o si es de la misma
 * empresa, no es un espejo.
 */
export function espejoDe(factura, movimientos) {
  if (!factura?.related_movement_id) return null;
  const par = (movimientos || []).find(m => m.id === factura.related_movement_id);
  if (!vivo(par)) return null;
  if (esNota(par)) return null;                          // es la nota, no el espejo
  if (par.company_id === factura.company_id) return null; // el espejo vive en OTRA empresa
  return par;
}

/**
 * El plan de dar de baja una factura anulada por su nota de crédito.
 *
 * @param {string} facturaId
 * @param {object} ctx
 *  · `movimientos`  todos los movimientos (el espejo vive en otra empresa)
 *  · `pagosPartes`  filas de pagos_partes (la plata ya aplicada)
 *  · `anticipos`    filas de anticipo_aplicaciones
 *  · `idsConPar`    Set de movimientos con par interco REGISTRADO
 *  · `empresaDe`    (company_id) => nombre, para poder decirlo en palabras
 * @returns {{
 *   factura, espejo, notas, etiqueta, yaAnulada, anulada,
 *   aCancelar: string[], bloqueos: string[], consecuencias: string[], avisos: string[]
 * }}
 */
export function planDeAnulacion(facturaId, {
  movimientos = [], pagosPartes = [], anticipos = [], idsConPar = null, empresaDe = null,
} = {}) {
  const movs = (movimientos || []).filter(vivo);
  const factura = movs.find(m => m.id === facturaId) || null;
  const vacio = {
    factura: null, espejo: null, notas: [], etiqueta: '', yaAnulada: false, anulada: false,
    aCancelar: [], bloqueos: [], consecuencias: [], avisos: [],
  };
  if (!factura) return { ...vacio, bloqueos: ['El comprobante no está en este dispositivo — sincronizá.'] };

  const info = notasPorFactura(movs).get(factura.id) || null;
  const nombre = (id) => (typeof empresaDe === 'function' ? empresaDe(id) : null) || 'la otra empresa';
  const moneda = String(factura.currency || 'PEN').toUpperCase();

  const out = {
    factura,
    espejo: espejoDe(factura, movs),
    notas: info?.notas || [],
    etiqueta: info?.etiqueta || '',
    yaAnulada: factura.payment_status === 'cancelled',
    anulada: !!info?.anulada,
    aCancelar: [],
    bloqueos: [],
    consecuencias: [],
    avisos: [],
  };

  if (!info || !info.anulada) {
    out.bloqueos.push(info?.parcial
      ? `Las notas de crédito rebajan ${fmt(info.totalNotas, moneda)} de ${fmt(info.totalFactura, moneda)}: la factura NO está anulada, solo rebajada. Una factura rebajada sigue siendo válida y tiene que seguir contando.`
      : 'Esta factura no tiene notas de crédito que la anulen.');
    return out;
  }

  // ── LO QUE FRENA (hay plata de verdad en el medio) ───────────────
  const conPar = idsConPar instanceof Set ? idsConPar : new Set();
  const candidatos = [factura, out.espejo].filter(Boolean);
  for (const m of candidatos) {
    if (conPar.has(m.id)) {
      out.bloqueos.push(
        `${m.document_number || 'El comprobante'} es una de las dos patas de una operación entre empresas registrada: `
        + 'se da de baja desde «Operaciones entre empresas», para que los dos lados se muevan juntos.');
    }
    const partes = (pagosPartes || []).filter(p => vivo(p) && p.accounting_movement_id === m.id);
    if (partes.length) {
      const total = partes.reduce((t, p) => t + abs(p.monto), 0);
      out.bloqueos.push(
        `${m.document_number || 'El comprobante'} tiene ${partes.length} pago${partes.length === 1 ? '' : 's'} aplicado${partes.length === 1 ? '' : 's'} por ${fmt(total, moneda)}. `
        + 'Deshacelos primero: la plata que ya salió no se desanula sola.');
    }
    const aplic = (anticipos || []).filter(a => vivo(a) && a.factura_movimiento_id === m.id);
    if (aplic.length) {
      const total = aplic.reduce((t, a) => t + abs(a.monto), 0);
      out.bloqueos.push(
        `${m.document_number || 'El comprobante'} consumió ${fmt(total, moneda)} de un anticipo. `
        + 'Hay que liberar esa aplicación antes, o el saldo del anticipo queda mal.');
    }
  }

  // ── QUÉ SE VA A DAR DE BAJA ─────────────────────────────────────
  if (!out.yaAnulada) out.aCancelar.push(factura.id);
  if (out.espejo && out.espejo.payment_status !== 'cancelled') out.aCancelar.push(out.espejo.id);

  // ── QUÉ DEJA DE SER CIERTO (todo derivado: no se escribe nada) ──
  out.consecuencias.push(
    `${fmt(factura.amount, moneda)} dejan de sumar en los reportes de ${nombre(factura.company_id)} — en el Libro Diario, el Registro de Compras y Ventas y el PLE que se declara.`);

  if (out.espejo) {
    const claseEspejo = (out.espejo.clase || (out.espejo.type === 'income' ? 'venta' : 'compra'));
    out.consecuencias.push(
      `También se da de baja su espejo: la ${claseEspejo} ${out.espejo.document_number || 's/n'} de `
      + `${nombre(out.espejo.company_id)}. Es el MISMO comprobante visto del otro lado — dar de baja uno solo `
      + 'dejaría al grupo declarando algo que la otra empresa ya no declara.');
  } else if (factura.is_intercompany) {
    out.avisos.push(
      'Está marcada como operación entre empresas pero no tiene su espejo cargado: revisá el otro libro a mano, '
      + 'porque ahí puede quedar viva.');
  }

  if (factura.detraccion_aplica && factura.detraccion_estado !== 'depositada') {
    out.consecuencias.push(
      `Deja de exigirse el depósito de detracción${factura.detraccion_monto ? ` de ${fmt(factura.detraccion_monto, moneda)}` : ''}: `
      + 'no se deposita la detracción de un comprobante anulado.');
  }
  if (factura.payment_status === 'paid'
      && requiereBancarizacion(abs(factura.amount), moneda, factura.tipo_cambio, factura.date)) {
    out.consecuencias.push('Deja de exigirse la constancia de bancarización.');
  }
  if (factura.recepcion_status && !['no_aplica', 'completada'].includes(factura.recepcion_status)) {
    out.consecuencias.push(
      'La recepción pendiente en Almacén deja de tener sentido: no se recibe la mercadería de una factura anulada. '
      + 'Si la mercadería SÍ llegó, entonces la factura no estaba anulada — revisá la nota de crédito.');
  }
  if (factura.orden_compra_id) {
    out.consecuencias.push('Su orden de compra vuelve a quedar sin factura: si la compra se rehízo, va a hacer falta cargar la nueva.');
  }

  // ── LO QUE HAY QUE MIRAR CON LOS OJOS ──────────────────────────
  if (factura.payment_status === 'paid') {
    out.avisos.push(
      'Figuraba como PAGADA. Si el proveedor devolvió la plata, el extorno de la nota ya lo refleja; '
      + 'si no la devolvió, eso es un saldo a favor y hay que registrarlo — la baja de la factura no lo hace sola.');
  }
  if (out.yaAnulada && out.aCancelar.length === 0) {
    out.avisos.push('Ya estaba dada de baja: no hay nada que cambiar.');
  }

  return out;
}

/**
 * Todas las facturas anuladas por nota de crédito que siguen vivas.
 *
 * Es la lista de la pasada: en producción son 21, en 6 empresas y desde 2023.
 * Ordenadas por importe descendente, que es el orden en que conviene mirarlas
 * —la primera son S/ 508.745,84— y no por fecha.
 */
export function facturasAnuladasVivas({ movimientos = [], companyId = null } = {}) {
  const movs = (movimientos || []).filter(vivo);
  const porId = new Map(movs.map(m => [m.id, m]));
  const notas = notasPorFactura(movs);
  const out = [];
  for (const [facturaId, info] of notas.entries()) {
    if (!info.anulada) continue;
    const f = porId.get(facturaId);
    if (!f || f.payment_status === 'cancelled') continue;
    if (companyId && f.company_id !== companyId) continue;
    out.push({
      id: f.id,
      documento: f.document_number || 's/n',
      fecha: f.date || '',
      companyId: f.company_id || null,
      monto: abs(f.amount),
      moneda: String(f.currency || 'PEN').toUpperCase(),
      etiqueta: info.etiqueta,
      notas: info.notas.map(n => n.document_number).filter(Boolean),
    });
  }
  return out.sort((a, b) => b.monto - a.monto);
}

export default { planDeAnulacion, facturasAnuladasVivas, espejoDe };
