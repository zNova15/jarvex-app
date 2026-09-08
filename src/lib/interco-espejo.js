// ═══════════════════════════════════════════════════════════════════
// JARVEX — LA COMPRA ESPEJO QUE NUNCA SE CREÓ (tanda 15).
//
// EL PEDIDO, de la jefa de contabilidad (8-set-2026): «JARVEX emitió 4 facturas
// a CONSORCIO EL INCA, de las cuales la E001-1 está anulada por su nota de
// crédito. Quedan la E001-2, la E001-3 y la E001-4. En Órdenes de Compra y
// Servicio de la obra Miraflores, pestaña "Sin respaldo", solo salen 2: falta
// la E001-2. Problema ahí con la intercompany automática».
//
// LA CAUSA: en «Sin respaldo» se listan las COMPRAS del consorcio ejecutor. La
// venta de JARVEX vive en el libro de JARVEX; la compra de EL INCA es el
// ESPEJO, y ese espejo no existe. Sin espejo no hay compra que respaldar, y la
// factura desaparece de la pestaña sin decir por qué.
//
// Medido contra producción antes de tocar código (8-set-2026): de todas las
// ventas internas del grupo, exactamente DOS no tienen su espejo —
// JARVEX → EL INCA E001-1 (S/ 12.920, ANULADA por su nota de crédito) y
// E001-2 (S/ 19.028,68, viva). Las hermanas E001-3 y E001-4 sí lo tienen: se
// las creó el backfill del 7-ago-2026 y estas dos quedaron afuera.
// El SQL de la migración 176 hacía exactamente esto, pero nunca se corrió — y
// además creaba también el espejo de la ANULADA, que le habría metido a EL
// INCA S/ 12.920 de costo que no debe.
//
// POR QUÉ ESTO VIVE EN LA APP Y NO EN UN SQL SUELTO: el hueco se vuelve a
// abrir cada vez que una venta interna se carga sin su contraparte (el
// auto-espejo de Captura Mágica solo corre al confirmar una captura). Una
// pantalla que lo detecta y lo repara sirve para la próxima; un SQL corrido a
// mano, para esta vez nomás.
//
// LO QUE NO SE ESPEJA, y por qué:
//   · Las ventas ANULADAS por nota de crédito. La operación quedó sin efecto:
//     el comprador no tiene nada que registrar ni que respaldar.
//   · Las notas de crédito y débito en sí. Son el otro lado de un espejo que
//     ya existe o de una operación anulada, no una compra nueva.
//   · Las ventas contra una entidad que el catálogo llama TERCERO. El catálogo
//     MANDA sobre el flag de la factura (decisión de Gabriel del 5-set-2026:
//     ESPERANZA y SAMADAY son terceros aunque la factura diga interco).
//   · Lo que ya tiene espejo, mire por donde se mire: por el vínculo, por el
//     puntero de las notas, o por el mismo comprobante cargado a mano en el
//     libro del comprador. El ancla es la VENDEDORA — sin ella, una compra
//     externa del comprador con la misma serie-correlativo taparía el hueco.
//
// Puro: sin React, sin Dexie. Testeado en __tests__/interco-espejo.test.js
// ═══════════════════════════════════════════════════════════════════

import { normalizarComprobante, normalizarRuc } from './doc-id.js';
import { parseNotas } from './cruce-recepcion.js';
import { notasPorFactura } from './notas-credito.js';
import { derivarTypeContable } from './clasificacion-contable.js';

const TIPOS_NOTA = new Set(['nota_credito', 'nota_debito']);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Los ids de las entidades que SON del grupo, según el catálogo. */
export function idsDelGrupo(companies) {
  const s = new Set();
  for (const c of companies || []) {
    if (!c?.id || c.deleted_at) continue;
    if ((c.tipo_entidad || 'propia') !== 'tercero') s.add(c.id);
  }
  return s;
}

/** ¿Este movimiento es una VENTA interna del grupo con contraparte conocida? */
export function esVentaInterna(mov, idsGrupo) {
  if (!mov || mov.deleted_at) return false;
  if (mov.is_intercompany !== true) return false;
  if (mov.type !== 'income' && (mov.clase || '') !== 'venta') return false;
  if (TIPOS_NOTA.has(mov.document_type || '')) return false;
  if (!mov.related_company_id || mov.related_company_id === mov.company_id) return false;
  if (num(mov.amount) <= 0) return false;
  const g = idsGrupo instanceof Set ? idsGrupo : new Set(idsGrupo || []);
  // Las dos patas tienen que ser del grupo: el catálogo manda sobre el flag.
  return g.has(mov.company_id) && g.has(mov.related_company_id);
}

/**
 * La compra espejo de una venta, si ya está cargada en el libro del comprador.
 * Devuelve el movimiento encontrado o `null`.
 */
export function espejoDeVenta(venta, movs, { rucVendedora = null } = {}) {
  if (!venta) return null;
  const comprobante = normalizarComprobante(venta.document_number);
  const rucVend = normalizarRuc(rucVendedora);
  for (const m of movs || []) {
    if (!m || m.deleted_at || m.id === venta.id) continue;
    if (m.company_id !== venta.related_company_id) continue;
    if (m.type !== 'cost' && m.type !== 'expense') continue;
    // 1) El vínculo explícito, por cualquiera de los dos caminos que la app usa.
    if (m.related_movement_id === venta.id) return m;
    const j = parseNotas(m.notas);
    if (j.intercompany_mirror_of === venta.id || j.desglose_heredado_de === venta.id) return m;
    // 2) El mismo comprobante, ANCLADO a la vendedora (mismo dedupe que Captura
    //    Mágica): o el RUC del tercero es el de ella, o ya está enlazada a ella.
    if (comprobante && normalizarComprobante(m.document_number) === comprobante) {
      const porRuc = rucVend && normalizarRuc(m.third_party_ruc) === rucVend;
      const porVinculo = m.is_intercompany === true && m.related_company_id === venta.company_id;
      if (porRuc || porVinculo) return m;
    }
  }
  return null;
}

/**
 * Las ventas internas a las que les falta el espejo en el libro del comprador.
 *
 * @param movs           todos los accounting_movements visibles
 * @param opts.companies el catálogo de entidades (decide quién es del grupo)
 * @param opts.compradorIds  acota a los libros que importan (el ámbito de la
 *                       pantalla: la ejecutora de la obra, o los consorcios)
 * @param opts.obraId    acota a una obra
 * @returns [{ venta, compradorId, vendedorId, documento, monto, fecha, obraId }]
 *          ordenadas por monto descendente (donde más pesa el hueco).
 */
export function ventasSinEspejo(movs, { companies = [], compradorIds = null, obraId = null } = {}) {
  const grupo = idsDelGrupo(companies);
  const rucPorEmpresa = new Map((companies || []).map(c => [c.id, c?.ruc || null]));
  const limite = compradorIds ? new Set(compradorIds) : null;
  const anuladas = notasPorFactura(movs);

  const out = [];
  for (const v of movs || []) {
    if (!esVentaInterna(v, grupo)) continue;
    if (limite && !limite.has(v.related_company_id)) continue;
    if (obraId && v.obra_id !== obraId) continue;
    // Anulada por su nota de crédito: la operación quedó sin efecto y el
    // comprador no tiene qué registrar. (Es el caso de la E001-1.)
    if (anuladas.get(v.id)?.anulada) continue;
    if (espejoDeVenta(v, movs, { rucVendedora: rucPorEmpresa.get(v.company_id) })) continue;
    out.push({
      venta: v,
      compradorId: v.related_company_id,
      vendedorId: v.company_id,
      documento: [v.document_type, v.document_number].filter(Boolean).join(' ').trim() || '—',
      monto: num(v.amount),
      moneda: v.currency || 'PEN',
      fecha: v.date || null,
      obraId: v.obra_id || null,
    });
  }
  return out.sort((a, b) => b.monto - a.monto);
}

/**
 * Los campos de la compra espejo que hay que crear a partir de la venta.
 *
 * Calcado del auto-espejo de Captura Mágica, que es lo que tienen los 95
 * espejos vivos de producción (todos `payment_status: 'paid'` y
 * `recepcion_status: 'no_aplica'`): una operación interna del grupo no se
 * bancariza como una compra externa ni entra a la bandeja de recepción del
 * almacén. Cambiarlo acá dejaría dos convenciones distintas para el mismo
 * documento según qué pantalla lo creó.
 *
 * SIN `items_factura`, también a propósito: el desglose se hereda por
 * `desglose_heredado_de` (ver desglose-heredado.js) y así el almacén del
 * comprador no cuenta dos veces los mismos materiales.
 *
 * Devuelve solo los campos de negocio: el id, las marcas de sincronización y
 * las fechas las pone quien escribe en Dexie.
 */
export function datosDelEspejo(venta, { vendedora = null, compradora = null } = {}) {
  const j = parseNotas(venta?.notas);
  const etiqueta = venta?.category || 'Factura';
  const destino = venta?.destino_contable || (venta?.obra_id ? 'obra' : null);
  const base = {
    company_id: venta?.related_company_id || compradora?.id || null,
    obra_id: venta?.obra_id || null,
    trabajo_id: venta?.trabajo_id || null,
    destino_contable: destino,
    clase: 'compra',
    is_intercompany: true,
    related_company_id: venta?.company_id || vendedora?.id || null,
    related_movement_id: venta?.id || null,
    date: venta?.date || null,
    category: etiqueta,
    description: `${etiqueta} ${venta?.document_number || ''} · ${vendedora?.name || ''} (espejo de operación interna)`.replace(/\s+/g, ' ').trim(),
    amount: num(venta?.amount),
    currency: venta?.currency || 'PEN',
    third_party_name: vendedora?.name || null,
    third_party_ruc: vendedora?.ruc || null,
    payment_status: 'paid',
    recepcion_status: 'no_aplica',
    document_type: venta?.document_type || 'factura',
    document_number: venta?.document_number || null,
    proveedor_id: null,
    orden_compra_id: null,
    metodo_pago: null,
    detraccion_aplica: false,
    notas: JSON.stringify({
      intercompany_auto: true,
      intercompany_mirror_of: venta?.id || null,
      // Mismo comprobante que la venta → mismo desglose real de base e IGV.
      // Sin esto el Libro Diario del espejo inventa un 18% que contradice a la
      // venta por la MISMA factura.
      subtotal: j.subtotal ?? null,
      igv: j.igv ?? null,
      desglose_heredado_de: venta?.id || null,
      nota: 'Compra espejo de una venta interna del grupo, creada desde «Sin respaldo» porque faltaba. Se puede reemplazar subiendo el comprobante real.',
    }),
  };
  // La regla dura: una operación interna es SIEMPRE costo (si no, el
  // Consolidado deja de cuadrar al eliminar los pares).
  base.type = derivarTypeContable(base);
  return base;
}
