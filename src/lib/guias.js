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
