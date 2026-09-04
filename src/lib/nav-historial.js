// ═══════════════════════════════════════════════════════════════════
// JARVEX — Historial de navegación para el botón «← Volver» del Header.
//
// La app no tenía pila de navegación: cada pantalla escribía su propio
// "volver" a mano, o no lo escribía. Ejemplo real (Gabriel, 4-sep-2026):
// desde «Resumen por entidad» entrar a una empresa y volver aterrizaba
// siempre en el catálogo de Empresas — nunca en Resumen por entidad —
// porque no había memoria de dónde venía. Ese patrón se repite en cada
// pantalla que hoy hardcodea su propio destino de "volver".
//
// Esta librería es SOLO la pila: qué entra, qué sale, con qué tope. Vive
// en jx-app.jsx: el ÚNICO lugar donde ya se navega es `irAPagina` (todo —
// sidebar, atajos, CustomEvents, hash, "Volver al inicio" — pasa por ahí),
// así que empujar ahí cubre a la app entera de una vez, sin tocar cada
// pantalla una por una.
//
// Puro: sin React, sin Dexie.
// ═══════════════════════════════════════════════════════════════════

const TOPE_MAX = 30; // cota para no crecer sin límite en una sesión larga

/**
 * Pila con `entrada` empujada al final. `entrada` = { page, plano } — la
 * pantalla que se está DEJANDO, para poder volver a ella.
 * No empuja `entrada` inválida (sin `page`): eso deja la pila intacta en vez
 * de dejar un "volver" que no lleva a ningún lado.
 */
export function empujarHistorial(pila, entrada) {
  if (!entrada || !entrada.page) return pila || [];
  const siguiente = [...(pila || []), entrada];
  return siguiente.length > TOPE_MAX ? siguiente.slice(siguiente.length - TOPE_MAX) : siguiente;
}

/**
 * La entrada del tope de la pila, y la pila sin ella.
 * `entrada: null` cuando está vacía — el llamador no debe navegar, no hay
 * a dónde volver (y por eso el botón no se muestra: ver `puedeVolver`).
 */
export function sacarHistorial(pila) {
  if (!pila || pila.length === 0) return { entrada: null, pila: [] };
  return { entrada: pila[pila.length - 1], pila: pila.slice(0, -1) };
}

/** Hay a dónde volver. Lo que decide si el Header muestra el botón. */
export function puedeVolver(pila) {
  return !!(pila && pila.length > 0);
}
