// ═══════════════════════════════════════════════════════════════════
// JARVEX — Búsqueda multi-palabra (tokens AND)
//
// Bug real: buscar "Tubo 1/2" no encontraba "TUBO PVC SAP 1/2" porque el filtro
// exigía la SUBCADENA exacta "tubo 1/2". Ahora cada PALABRA del query debe
// aparecer en el texto (en cualquier orden/posición): "Tubo 1/2" → contiene
// "tubo" Y "1/2". Query vacío = coincide con todo.
// ═══════════════════════════════════════════════════════════════════

/** Tokeniza un query en palabras (minúsculas, sin vacíos). */
export function tokensDe(query) {
  return String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * ¿El texto contiene TODAS las palabras del query? (coincidencia AND).
 * @param {string} texto  el "haystack" (puede ser la concatenación de varios campos)
 * @param {string} query  lo que tecleó el usuario
 */
export function coincideTokens(texto, query) {
  const toks = tokensDe(query);
  if (!toks.length) return true;
  const hay = String(texto || '').toLowerCase();
  return toks.every(t => hay.includes(t));
}
