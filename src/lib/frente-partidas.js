// ═══════════════════════════════════════════════════════════════════
// JARVEX — F1: vínculo Frentes ↔ Partidas (helpers PUROS, unit-testeables).
//
// Una asignación guarda el NODO (codigo_delfin: capítulo '02', subcapítulo
// '02.01' o ítem '02.01.01.01'); la expansión a las partidas hijas se calcula
// aquí, por prefijo de segmentos (mismo criterio que partida-arbol.js, que evita
// que '02.1' matchee '02.10'). Muchos-a-muchos. Sin Dexie ni React.
// ═══════════════════════════════════════════════════════════════════

/**
 * ¿El nodo asignado `a` cubre la partida de código `c`? (ancestro-o-sí-mismo).
 * Prefijo por SEGMENTOS: '02' cubre '02' y '02.01'; '02.1' NO cubre '02.10'.
 */
export const cubre = (a, c) => {
  if (a == null || c == null) return false;
  const A = String(a).trim();
  const C = String(c).trim();
  if (!A || !C) return false;
  return C === A || C.startsWith(A + '.');
};

/**
 * Partidas cubiertas por un frente (expande los nodos asignados por jerarquía).
 * Devuelve TODAS las partidas (filas) bajo los nodos asignados, sin duplicar.
 * @param {string} frenteId
 * @param {Object} ctx { frentePartidas, partidas }
 * @returns {Array} filas de `partidas`
 */
export function partidasDeFrente(frenteId, { frentePartidas = [], partidas = [] } = {}) {
  const codigos = frentePartidas
    .filter(fp => fp && fp.frente_id === frenteId && !fp.deleted_at && fp.codigo_delfin)
    .map(fp => String(fp.codigo_delfin).trim());
  if (!codigos.length) return [];
  return partidas.filter(p =>
    p && !p.deleted_at && p.codigo_delfin &&
    codigos.some(a => cubre(a, String(p.codigo_delfin).trim()))
  );
}

/**
 * Frentes que cubren una partida dada (inverso; para el caso de partida compartida).
 * @param {string} partidaId
 * @param {Object} ctx { frentePartidas, partidas }
 * @returns {Array<string>} ids de frente, sin duplicar
 */
export function frentesDePartida(partidaId, { frentePartidas = [], partidas = [] } = {}) {
  const p = partidas.find(x => x && x.id === partidaId && !x.deleted_at);
  if (!p || !p.codigo_delfin) return [];
  const c = String(p.codigo_delfin).trim();
  const ids = new Set();
  for (const fp of frentePartidas) {
    if (fp && !fp.deleted_at && fp.codigo_delfin && cubre(String(fp.codigo_delfin).trim(), c)) {
      ids.add(fp.frente_id);
    }
  }
  return [...ids];
}

/**
 * F2: frentes (filas) donde `userId` es el ingeniero a cargo (soporta varios).
 * Filtra activos y no borrados.
 * @param {string} userId  profiles.id del usuario logueado
 * @param {Object} ctx { frentes }  filas de frentes_obra
 * @returns {Array} filas de frentes_obra
 */
export function frentesDeUsuario(userId, { frentes = [] } = {}) {
  if (!userId) return [];
  return frentes.filter(f => f && !f.deleted_at && f.activo !== false && f.ingeniero_user_id === userId);
}
