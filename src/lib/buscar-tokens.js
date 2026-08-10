// ═══════════════════════════════════════════════════════════════════
// JARVEX — Búsqueda multi-palabra (tokens AND)
//
// Bug real: buscar "Tubo 1/2" no encontraba "TUBO PVC SAP 1/2" porque el filtro
// exigía la SUBCADENA exacta "tubo 1/2". Ahora cada PALABRA del query debe
// aparecer en el texto (en cualquier orden/posición): "Tubo 1/2" → contiene
// "tubo" Y "1/2". Query vacío = coincide con todo.
// ═══════════════════════════════════════════════════════════════════

// Minúsculas + SIN TILDES: "Ácido" y "acido" deben coincidir — los catálogos
// reales mezclan nombres con y sin acento y la búsqueda fallaba según cómo lo
// tipeara la usuaria. La Ñ se PROTEGE antes del plegado NFD (ñ se descompone en
// n + tilde combinante U+0303 y quedaría plegada a "n": caño ≠ cano).
const plegar = (s) => String(s || '')
  .toLowerCase()
  .replace(/\u00f1/g, '\u0001')                     // proteger ñ
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar tildes combinantes
  .replace(/\u0001/g, '\u00f1');                    // restaurar ñ

/** Tokeniza un query en palabras (minúsculas, sin tildes, sin vacíos). */
export function tokensDe(query) {
  return plegar(query).trim().split(/\s+/).filter(Boolean);
}

/**
 * ¿El texto contiene TODAS las palabras del query? (coincidencia AND,
 * insensible a mayúsculas y tildes).
 * @param {string} texto  el "haystack" (puede ser la concatenación de varios campos)
 * @param {string} query  lo que tecleó el usuario
 */
export function coincideTokens(texto, query) {
  const toks = tokensDe(query);
  if (!toks.length) return true;
  const hay = plegar(texto);
  return toks.every(t => hay.includes(t));
}
