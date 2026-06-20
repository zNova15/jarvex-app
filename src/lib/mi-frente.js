// ═══════════════════════════════════════════════════════════════════
// JARVEX — Rol Ingeniero: helpers PUROS de "Mi Frente" (O1/O2/O3).
// Operan sobre datos ya cargados (partidas del frente, movimientos, avances,
// metas). Sin Dexie ni React. Las partidas del frente salen de partidasDeFrente
// (F1); los frentes del usuario de frentesDeUsuario (F2).
// ═══════════════════════════════════════════════════════════════════

/** KPIs de un frente: # partidas, avance promedio, # salidas, metrado real. */
export function resumenFrente({ partidasDelFrente = [], movimientos = [], avances = [], frenteId = null } = {}) {
  const partidaIds = new Set(partidasDelFrente.map(p => p.id));
  const nPartidas = partidasDelFrente.length;
  const avancePromedio = nPartidas
    ? partidasDelFrente.reduce((s, p) => s + (Number(p.porcentaje_avance) || 0), 0) / nPartidas
    : 0;
  const nSalidas = movimientos.filter(m => m && !m.deleted_at && m.tipo_movimiento === 'salida'
    && (frenteId ? m.frente_id === frenteId : !!m.frente_id)).length;
  const metradoReal = avances
    .filter(a => a && !a.deleted_at && partidaIds.has(a.partida_id))
    .reduce((s, a) => s + (Number(a.metrado_ejecutado) || 0), 0);
  return { nPartidas, avancePromedio, nSalidas, metradoReal };
}

/** Plan (meta) vs real por partida. Si `fecha` se pasa, filtra a ese día; si no, acumulado. */
export function planVsReal({ partidasDelFrente = [], metas = [], avances = [], fecha = null } = {}) {
  return partidasDelFrente.map(p => {
    const ms = metas.filter(m => m && !m.deleted_at && m.partida_id === p.id && (!fecha || m.fecha === fecha));
    const as = avances.filter(a => a && !a.deleted_at && a.partida_id === p.id && (!fecha || a.fecha === fecha));
    const metaMetrado = ms.reduce((s, m) => s + (Number(m.meta_metrado) || 0), 0);
    const realMetrado = as.reduce((s, a) => s + (Number(a.metrado_ejecutado) || 0), 0);
    return { partida: p, metaMetrado, realMetrado, desvio: realMetrado - metaMetrado, pctAvance: Number(p.porcentaje_avance) || 0 };
  });
}

/** Rollup mensual: metrado real sumado por partida en el mes 'YYYY-MM'. Solo partidas con avance. */
export function rollupMensual({ partidasDelFrente = [], avances = [], mes = null } = {}) {
  return partidasDelFrente.map(p => {
    const as = avances.filter(a => a && !a.deleted_at && a.partida_id === p.id && (!mes || String(a.fecha || '').startsWith(mes)));
    const metradoMes = as.reduce((s, a) => s + (Number(a.metrado_ejecutado) || 0), 0);
    return { partida: p, metradoMes };
  }).filter(r => r.metradoMes > 0);
}
