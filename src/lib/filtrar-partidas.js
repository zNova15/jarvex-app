// JARVEX — Buscador de partidas del Reporte Diario (mejora móvil, sep-2026).
//
// Lógica PURA del filtro/orden de sugerencias:
//  · Tolerante a TILDES y mayúsculas: "excavacion" encuentra "EXCAVACIÓN"
//    (el buscador viejo usaba includes() crudo y en un presupuesto real casi
//    todo lleva tilde — en el celular nadie tipea tildes).
//  · Multi-palabra AND, mismo criterio que buscar-tokens.js: "concreto columna"
//    encuentra "COLUMNAS DE CONCRETO F'C=210" sin importar el orden.
//  · Sin query: primero las partidas que ESTE usuario reportó más recientemente
//    (en obra se reporta casi siempre sobre las mismas partidas de la semana).

// Nota deliberada: la ñ se aplana a n (NFD la descompone y el strip de
// diacríticos se lleva la virgulilla). En el teclado del celular nadie tipea
// la ñ con guantes: "banos" DEBE encontrar "BAÑOS". Ambos lados del match
// pasan por esta misma función, así que es consistente.
export const normPartidaTxt = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

// hojas: [{id, codigo_delfin, nombre_partida}] · query: texto del input ·
// opts.ultimaFechaPorPartida: Map(id → 'YYYY-MM-DD' del último avance propio) ·
// opts.excluirIds: Set de partidas ya agregadas · opts.max: tope de sugerencias.
export function filtrarPartidasReporte(hojas, query, opts = {}) {
  const { ultimaFechaPorPartida = null, excluirIds = null, max = 25 } = opts;
  const lista = (hojas || []).filter(p => p && !(excluirIds && excluirIds.has(p.id)));
  const toks = normPartidaTxt(query).split(' ').filter(Boolean);

  const coincidentes = toks.length
    ? lista.filter(p => {
        const s = normPartidaTxt(`${p.codigo_delfin || ''} ${p.nombre_partida || ''}`);
        return toks.every(t => s.includes(t));
      })
    : lista;

  // Recientes propias primero (fecha desc) TAMBIÉN con query — desempate
  // estable: el resto conserva el orden del presupuesto.
  if (ultimaFechaPorPartida && ultimaFechaPorPartida.size) {
    return coincidentes
      .map((p, i) => ({ p, i, f: ultimaFechaPorPartida.get(p.id) || '' }))
      .sort((a, b) => (a.f === b.f ? a.i - b.i : (a.f > b.f ? -1 : 1)))
      .map(x => x.p)
      .slice(0, max);
  }
  return coincidentes.slice(0, max);
}

// Al reusar la descripción del último avance como arranque, quitarle el prefijo
// administrativo "[Reporte tardío subido ... motivo: ...]" si lo tuviera.
export function limpiarDescripcionReuso(desc) {
  return String(desc || '').replace(/^\[[^\]]*\]\s*/, '').trim();
}
