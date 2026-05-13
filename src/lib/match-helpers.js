// ═══════════════════════════════════════════════════════════════════
// JARVEX — Helpers de match: códigos jerárquicos + fuzzy de descripciones
//
// Usado por:
//   - jx-importar.jsx (import Gantt: match contra partidas existentes)
//   - jx-obra.jsx (Comparativo con Presupuesto: match contra Excel)
// ═══════════════════════════════════════════════════════════════════

/**
 * Normaliza un código jerárquico quitando ceros de padding por segmento.
 *   '01.01.05'        → '1.1.5'
 *   '1.01'            → '1.1'
 *   '02.01.01.01.01'  → '2.1.1.1.1'
 * Útil para matchear códigos que vinieron con/sin padding entre fuentes
 * distintas (S10 vs Excel vs MS Project).
 */
export function normalizeCodigo(codigo) {
  if (codigo == null) return '';
  return String(codigo).trim().split('.').map(seg => {
    const n = parseInt(seg, 10);
    return Number.isNaN(n) ? seg : String(n);
  }).join('.');
}

/** Normaliza texto para fuzzy match: NFD + minúsculas + solo alfanumérico. */
export function normTxt(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * % de palabras compartidas (≥3 chars) entre dos descripciones.
 * Score en [0..1]. 1 = mismas palabras. 0 = ninguna palabra en común.
 */
export function fuzzyScore(a, b) {
  const A = new Set(normTxt(a).split(' ').filter(w => w.length > 2));
  const B = new Set(normTxt(b).split(' ').filter(w => w.length > 2));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.max(A.size, B.size);
}
