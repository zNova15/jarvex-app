// ═══════════════════════════════════════════════════════════════════
// JARVEX — Lógica PURA de guías de remisión (matching guía ↔ factura)
//
// La guía impresa trae "Doc. Ref.: F001-025131"; la factura vive en
// accounting_movements.document_number con formatos dispares
// ("F001-025131", "F001 - 25131", "f001-0025131"). El match normaliza
// serie + correlativo (sin ceros a la izquierda). Sin React ni Dexie.
// ═══════════════════════════════════════════════════════════════════

/** 'F001-025131' → { serie:'F001', correlativo:25131 } (null si no parsea). */
export function normalizarDoc(txt) {
  const s = String(txt || '').toUpperCase().trim();
  // serie alfanumérica (letra + dígitos) separada del correlativo por -, /, espacio
  const m = /([A-Z]{1,3}\s?\d{1,4})\s*[-/\s]\s*0*(\d{1,10})/.exec(s);
  if (!m) return null;
  return { serie: m[1].replace(/\s+/g, ''), correlativo: Number(m[2]) };
}

const rucLimpio = (r) => String(r || '').replace(/\D/g, '');

/**
 * Busca la factura que referencia la guía.
 * @param guia { doc_referencia, emisor_ruc }
 * @param movimientos filas de accounting_movements (con document_number, third_party_ruc, deleted_at)
 * @returns { mov, confianza: 'alta'|'media' } | null
 */
/**
 * ¿La guía la EMITIÓ una empresa del grupo (emitida) o un proveedor (recibida)?
 * 100% derivable por RUC del emisor contra los RUC de companies (pedido
 * contadoras 31-ago). NO usar guias_remision.company_id para esto: esa columna
 * significa "empresa destinataria" y casi nunca está poblada.
 * @param guia { emisor_ruc }
 * @param rucsGrupo Set<string> de RUCs (solo dígitos) de las empresas del grupo
 * @returns 'emitida' | 'recibida' | 'desconocida'
 */
export function clasificarOrigenGuia(guia, rucsGrupo) {
  const ruc = rucLimpio(guia?.emisor_ruc);
  if (!ruc) return 'desconocida';
  const set = rucsGrupo instanceof Set ? rucsGrupo : new Set(rucsGrupo || []);
  return set.has(ruc) ? 'emitida' : 'recibida';
}

/**
 * Facturas que DEBERÍAN tener guía de remisión y no la tienen (pedido
 * contadoras 31-ago). Heurística: factura (no NC/boleta/recibo) con al menos
 * un ítem que NO es servicio (los bienes se trasladan) y sin guía vinculada.
 * - COMPRAS: falta la guía del proveedor (reclamarla).
 * - VENTAS: falta la guía que NUESTRA empresa debió emitir (riesgo tributario
 *   propio — el caso que menos pueden dejar pasar).
 * - sinDatos: facturas sin ítems parseables — la heurística no puede opinar.
 * El override manual vive en accounting_movements.guia_estado (mig 161):
 * 'no_requiere' la saca de la lista para siempre; null = decide la heurística.
 * @param movs filas de accounting_movements
 * @param guias filas de guias_remision (para el set de vinculadas)
 * @param itemsDe (mov) => items — inyectado (itemsDeFactura de cruce-recepcion)
 * @param opts { esEspejoAuto?: (mov) => bool } — detectar la compra ESPEJO
 *   automática de una venta interco (notas.intercompany_auto): no es un
 *   comprobante con traslado propio, la guía vive en la venta original.
 */
export function facturasQueRequierenGuia(movs, guias, itemsDe, opts = {}) {
  const esEspejoAuto = opts.esEspejoAuto || (() => false);
  const vinculadas = new Set(
    (guias || []).filter(g => g && !g.deleted_at && g.accounting_movement_id).map(g => g.accounting_movement_id)
  );
  const compras = [], ventas = [], sinDatos = [];
  for (const m of (movs || [])) {
    if (!m || m.deleted_at) continue;
    if (m.document_type !== 'factura') continue;         // NC/boletas/recibos no llevan guía acá
    if (m.payment_status === 'cancelled') continue;
    if (m.guia_estado === 'no_requiere') continue;       // decisión manual persistente
    if (vinculadas.has(m.id)) continue;                  // ya tiene su guía
    // Par interco: el espejo automático no lleva guía propia, y si la OTRA
    // pata del par ya tiene la guía vinculada, este lado queda cubierto.
    if (esEspejoAuto(m)) continue;
    if (m.related_movement_id && vinculadas.has(m.related_movement_id)) continue;
    const items = (itemsDe ? itemsDe(m) : []) || [];
    const esVenta = (m.clase || (m.type === 'income' ? 'venta' : 'compra')) === 'venta';
    const forzada = m.guia_estado === 'requiere';
    // Sin ítems la heurística no puede opinar — salvo que la contadora la haya
    // forzado con "Sí requiere" (entonces entra a la lista real, no a sinDatos).
    if (!items.length && !forzada) { sinDatos.push(m); continue; }
    const tieneBienes = forzada || items.some(it => it && it.tipo_insumo !== 'servicio');
    if (!tieneBienes) continue;                          // solo servicios → sin traslado
    (esVenta ? ventas : compras).push(m);
  }
  return { compras, ventas, sinDatos };
}

/**
 * Guías candidatas para vincularle a UNA factura (el camino inverso de
 * matchFacturaDeGuia, para el panel "requieren guía"). Ordena: referencia
 * exacta primero. Cercos anti-vínculo-cruzado (las series F001-… se repiten
 * ENTRE emisores):
 * - COMPRA: descarta guías cuyo emisor contradice al proveedor de la factura.
 * - VENTA: el emisor de la guía debe ser NUESTRA empresa → solo guías cuyo
 *   RUC emisor esté en rucsGrupo (las recibidas de proveedores quedan fuera,
 *   aunque su doc_referencia coincida por casualidad).
 * @param rucsGrupo Set<string> de RUCs del grupo (obligatorio para ventas)
 */
export function sugerirGuiasParaFactura(mov, guiasSinVincular, rucsGrupo) {
  const doc = normalizarDoc(mov?.document_number);
  const rucMov = rucLimpio(mov?.third_party_ruc);
  const grupo = rucsGrupo instanceof Set ? rucsGrupo : new Set(rucsGrupo || []);
  const esVenta = (mov?.clase || (mov?.type === 'income' ? 'venta' : 'compra')) === 'venta';
  return (guiasSinVincular || [])
    .filter(g => g && !g.deleted_at && !g.accounting_movement_id)
    .map(g => {
      const ref = normalizarDoc(g.doc_referencia);
      const rucG = rucLimpio(g.emisor_ruc);
      if (esVenta) {
        if (!rucG || !grupo.has(rucG)) return null;   // solo guías EMITIDAS por el grupo
      } else if (rucG && rucMov && rucG !== rucMov) {
        return null;                                   // RUC contradicho en compras
      }
      let pri = 0;
      if (doc && ref && ref.correlativo === doc.correlativo) pri = ref.serie === doc.serie ? 3 : 2;
      else if (!esVenta && rucG && rucMov && rucG === rucMov) pri = 1;
      return { guia: g, pri };
    })
    .filter(Boolean)
    .sort((a, b) => b.pri - a.pri || String(b.guia.fecha_emision || '').localeCompare(String(a.guia.fecha_emision || '')));
}

export function matchFacturaDeGuia(guia, movimientos) {
  const ref = normalizarDoc(guia?.doc_referencia);
  if (!ref) return null;
  const rucGuia = rucLimpio(guia?.emisor_ruc);
  const candidatos = [];
  for (const mv of (movimientos || [])) {
    if (!mv || mv.deleted_at) continue;
    const doc = normalizarDoc(mv.document_number);
    if (!doc || doc.correlativo !== ref.correlativo) continue;
    const serieOk = doc.serie === ref.serie;
    const rucMov = rucLimpio(mv.third_party_ruc);
    const ambosRuc = !!rucGuia && !!rucMov;
    const rucOk = ambosRuc && rucGuia === rucMov;
    // RUC CONTRADICHO (ambos conocidos y distintos) → NO es candidato: las
    // series (F001-…) se repiten ENTRE emisores; sin este descarte, la guía
    // del proveedor A se auto-vinculaba a la factura F001-n del proveedor B.
    if (ambosRuc && !rucOk) continue;
    if (serieOk) candidatos.push({ mov: mv, score: rucOk ? 3 : 2 });
    else if (rucOk) candidatos.push({ mov: mv, score: 1 });
  }
  if (!candidatos.length) return null;
  candidatos.sort((a, b) => b.score - a.score);
  // Ambigüedad real (dos candidatos al tope con el mismo score) → mejor no auto-vincular.
  if (candidatos.length > 1 && candidatos[0].score === candidatos[1].score) return null;
  return { mov: candidatos[0].mov, confianza: candidatos[0].score >= 3 ? 'alta' : 'media' };
}
