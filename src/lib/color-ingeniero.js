// Color determinístico por ingeniero (responsable_id) para la barra de avance
// multicolor. Mismo id → mismo color, sin configurar nada. Se deriva un matiz
// (hue) del id; saturación/luz fijas para buen contraste sobre fondo oscuro.
export function hueDeId(id) {
  const s = String(id || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}
export function colorIngeniero(id) {
  if (!id || id === 'sin') return '#7a7a82';
  return `hsl(${hueDeId(id)}, 65%, 52%)`;
}

/**
 * Segmenta el avance de una partida por ingeniero (quién avanzó cuánto).
 * @param {Object} partida  con metrado_contratado, porcentaje_avance
 * @param {Array} avancesPartida  filas de avance_obra de ESA partida (responsable_id, metrado_ejecutado)
 * @returns {{ segmentos: Array<{uid,metrado,pct}>, pctTotal:number, base:number, totalReal:number }}
 */
export function segmentarAvance(partida, avancesPartida = []) {
  const mc = Number(partida?.metrado_contratado) || 0;
  const porIng = new Map();
  let totalReal = 0;
  for (const a of avancesPartida) {
    if (!a || a.deleted_at) continue;
    const m = Number(a.metrado_ejecutado) || 0;
    if (!m) continue;
    const uid = a.responsable_id || 'sin';
    porIng.set(uid, (porIng.get(uid) || 0) + m);
    totalReal += m;
  }
  const base = mc > 0 ? mc : totalReal;
  const segmentos = [...porIng.entries()].map(([uid, metrado]) => ({
    uid, metrado, pct: base > 0 ? Math.min(100, (metrado / base) * 100) : 0,
  }));
  const pctTotal = base > 0 ? Math.min(100, (totalReal / base) * 100) : (Number(partida?.porcentaje_avance) || 0);
  return { segmentos, pctTotal, base, totalReal };
}
