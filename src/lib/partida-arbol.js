// ═══════════════════════════════════════════════════════════════════
// JARVEX — Navegación jerárquica de PARTIDAS por código (carpetas)
//
// El árbol de partidas se infiere de los prefijos de `codigo_delfin`
// ("02" ⊃ "02.01" ⊃ "02.01.01"…). Estas funciones puras alimentan la vista de
// carpetas de "Insumos por Partida": desde un capítulo se ven sus hijos
// directos (carpetas o partidas hoja) y se baja hasta una hoja con su desglose.
// ═══════════════════════════════════════════════════════════════════

/**
 * Hijos DIRECTOS de un capítulo. `foco` = código del capítulo ('' o null = raíz,
 * nivel 1). Devuelve nodos: { code, partida|null, esFolder }. Un nodo es CARPETA
 * (esFolder) si tiene descendientes; si no, es una partida HOJA (tiene `partida`).
 * Soporta intermedios sin fila propia (aparecen igual como carpeta).
 */
export function hijosDirectos(partidas, foco) {
  const f = foco == null ? '' : String(foco);
  const lista = (partidas || []).filter(p => p && !p.deleted_at && p.codigo_delfin);
  const fp = f ? f + '.' : '';
  const depthF = f ? f.split('.').filter(Boolean).length : 0;
  const map = new Map();
  for (const p of lista) {
    const c = String(p.codigo_delfin).trim();
    if (f && !(c === f || c.startsWith(fp))) continue;
    const segs = c.split('.').filter(Boolean);
    if (segs.length <= depthF) continue; // el propio foco / ancestros
    const childCode = segs.slice(0, depthF + 1).join('.');
    if (!map.has(childCode)) map.set(childCode, { code: childCode, partida: null, esFolder: false });
    const node = map.get(childCode);
    if (c === childCode) node.partida = p;
    if (segs.length > depthF + 1) node.esFolder = true;
  }
  return [...map.values()].sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }));
}

/**
 * Cadena de códigos ancestros para el breadcrumb, de la raíz al código dado.
 * Devuelve ['', '02', '02.01', '02.01.01'] para '02.01.01'.
 */
export function cadenaBreadcrumb(codigo) {
  const segs = String(codigo || '').split('.').filter(Boolean);
  const out = [''];
  for (let i = 1; i <= segs.length; i++) out.push(segs.slice(0, i).join('.'));
  return out;
}
