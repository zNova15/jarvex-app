// ═══════════════════════════════════════════════════════════════════
// JARVEX — LA SERIE Y EL CORRELATIVO DE UN COMPROBANTE (tanda 9).
//
// EL PEDIDO (Gabriel, 7-set-2026):
//   «El correlativo quiero que me recomiendes cómo debería ser, pues puede
//    suceder que la empresa que emitirá la factura con dicha orden de compra ya
//    tenga otra factura que emitió. ¿O es que acaso eso se ve cuando se
//    configure bien el sistema de la SUNAT de cada empresa?»
//
// ── LA RESPUESTA CORTA: LAS DOS COSAS, Y EN ESTE ORDEN ────────────
// La SERIE la asigna SUNAT y se configura una vez por empresa (`companies.
// serie_factura`, mig 187). El CORRELATIVO lo lleva el CONTRIBUYENTE, no SUNAT:
// SUNAT solo valida que no se repita y que no salte hacia atrás. O sea que el
// «siguiente número» lo tiene que saber la app, y lo puede saber HOY, sin
// certificado digital ni clave SOL, mirando lo que esa empresa ya emitió.
//
// ── DE DÓNDE SALE EL «YA EMITIÓ» ──────────────────────────────────
// De `accounting_movements`: las ventas de esa empresa cuyo `document_number`
// tiene forma `SERIE-NNNNNNNN`. Es el mismo mecanismo que `proximoCodigo()`
// usa para las órdenes, y por la misma razón: el correlativo es un dato
// DERIVADO de lo que existe, no un contador guardado que se puede desincronizar.
//
// ⚠️ SE MIRA POR SERIE, NO SOLO POR EMPRESA. Una empresa puede tener F001 para
// facturas y B001 para boletas corriendo a la vez, y cada una lleva su propia
// cuenta. Mezclarlas daría un número ya usado en la otra.
//
// ⚠️ Y SOLO LAS VENTAS. Las compras también tienen `document_number` —el de la
// factura del proveedor— y contarlas haría que el correlativo de JARVEX salte
// al de la ferretería.
//
// ── LO QUE ESTO NO ES ─────────────────────────────────────────────
// No es la emisión electrónica. Esto propone un número; que ese número exista
// para SUNAT requiere firmar el XML con el certificado y mandarlo, que es otro
// asunto (ver `sunat-sender.js` y la pantalla de Configuración SUNAT). Por eso
// la factura que emite el buzón nace como BORRADOR: el número es una propuesta
// hasta que alguien la declara.
//
// Puro: sin React, sin Dexie. Testeado en __tests__/serie-comprobante.test.js
// ═══════════════════════════════════════════════════════════════════

import { esVentaMov } from './costo-obra.js';

const vivos = (arr) => (Array.isArray(arr) ? arr.filter(x => x && !x.deleted_at) : []);

/** Serie válida: una letra + 3 dígitos (F001, B001, FC01, T001…). */
export const SERIE_RE = /^[A-Z][A-Z0-9]{3}$/;

export const SERIE_POR_DEFECTO = {
  factura: 'F001',
  boleta: 'B001',
  nota_credito: 'FC01',
  nota_debito: 'FD01',
};

/** La serie que usa esta empresa, o la de por defecto. */
export function serieDeEmpresa(company, tipo = 'factura') {
  const propia = String(company?.[`serie_${tipo}`] || company?.serie_factura || '').trim().toUpperCase();
  if (SERIE_RE.test(propia)) return propia;
  return SERIE_POR_DEFECTO[tipo] || SERIE_POR_DEFECTO.factura;
}

/** Parte `F001-00000123` en sus dos mitades. null si no tiene esa forma. */
export function partirDocumento(documento) {
  const m = /^\s*([A-Za-z][A-Za-z0-9]{3})\s*-\s*(\d{1,8})\s*$/.exec(String(documento || ''));
  if (!m) return null;
  return { serie: m[1].toUpperCase(), correlativo: Number(m[2]) };
}

export const formatearDocumento = (serie, correlativo) =>
  `${String(serie || '').toUpperCase()}-${String(Math.max(1, Number(correlativo) || 1)).padStart(8, '0')}`;

/**
 * El siguiente comprobante que le toca emitir a esta empresa en esta serie.
 *
 * @returns { serie, correlativo, documento, ultimo, usados }
 *   `ultimo` = el mayor correlativo ya visto (0 si es el primero).
 *   `usados` = cuántos comprobantes de esa serie hay, para poder decir en
 *              pantalla de dónde salió el número en vez de mostrarlo pelado.
 */
export function siguienteComprobante(movs = [], { companyId = null, company = null, serie = null, tipo = 'factura' } = {}) {
  const s = (serie && SERIE_RE.test(String(serie).toUpperCase()))
    ? String(serie).toUpperCase()
    : serieDeEmpresa(company, tipo);
  const cid = companyId || company?.id || null;

  let ultimo = 0, usados = 0;
  if (cid) {
    for (const m of vivos(movs)) {
      if (m.company_id !== cid) continue;
      if (!esVentaMov(m)) continue;                 // una compra lleva el número del proveedor
      if (m.payment_status === 'cancelled') continue;
      const p = partirDocumento(m.document_number);
      if (!p || p.serie !== s) continue;
      usados += 1;
      if (p.correlativo > ultimo) ultimo = p.correlativo;
    }
  }
  const correlativo = ultimo + 1;
  return { serie: s, correlativo, documento: formatearDocumento(s, correlativo), ultimo, usados };
}

/**
 * ¿Ese número ya está usado por esta empresa?
 *
 * La contadora puede escribir el correlativo a mano —porque ya lo emitió en el
 * sistema del contador externo— y ahí hay que avisar antes de duplicarlo, no
 * después. Devuelve el movimiento que lo tiene, o null.
 */
export function documentoYaUsado(movs = [], { companyId, documento }) {
  const p = partirDocumento(documento);
  if (!p || !companyId) return null;
  for (const m of vivos(movs)) {
    if (m.company_id !== companyId) continue;
    if (!esVentaMov(m)) continue;
    if (m.payment_status === 'cancelled') continue;
    const q = partirDocumento(m.document_number);
    if (q && q.serie === p.serie && q.correlativo === p.correlativo) return m;
  }
  return null;
}
