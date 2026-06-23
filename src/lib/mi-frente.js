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

/**
 * Rendimiento de una partida (O4 / control de rendimiento): meta diaria
 * (metrado_contratado ÷ días planificados) vs avance real. Devuelve un semáforo.
 * `hoy` = fecha ISO de referencia (se pasa para testeabilidad).
 */
export function rendimientoPartida(partida = {}, avances = [], hoy = null) {
  const metrado = Number(partida.metrado_contratado) || 0;
  const ini = partida.fecha_inicio_planificada;
  const fin = partida.fecha_fin_planificada;
  const dias = (a, b) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
  const diasPlan = (ini && fin) ? Math.max(1, dias(ini, fin) + 1) : 0;
  const metaDiaria = diasPlan > 0 ? metrado / diasPlan : 0;
  const realAcum = avances
    .filter(a => a && !a.deleted_at && a.partida_id === partida.id)
    .reduce((s, a) => s + (Number(a.metrado_ejecutado) || 0), 0);
  const diasTrans = (ini && hoy) ? Math.max(0, Math.min(diasPlan, dias(ini, hoy) + 1)) : 0;
  const esperadoAcum = Math.min(metrado, metaDiaria * diasTrans);
  const indice = esperadoAcum > 0 ? realAcum / esperadoAcum : null; // <1 = atrasado
  const semaforo = indice == null ? 'sin_dato' : indice >= 0.95 ? 'verde' : indice >= 0.75 ? 'ambar' : 'rojo';
  return { metrado, diasPlan, metaDiaria, realAcum, esperadoAcum, indice, semaforo };
}

/**
 * Ventana de ejecución planificada de una partida: fechas de inicio/fin + días
 * (inclusive, mismo criterio que rendimientoPartida.diasPlan). `completa` es false
 * si le falta alguna de las dos fechas (no se importó del cronograma Delphin).
 */
export function ventanaPartida(p = {}) {
  const ini = p.fecha_inicio_planificada || null;
  const fin = p.fecha_fin_planificada || null;
  if (!ini || !fin) return { ini, fin, dias: null, completa: false };
  const ms = new Date(fin).getTime() - new Date(ini).getTime();
  if (!Number.isFinite(ms)) return { ini, fin, dias: null, completa: false };   // fecha truthy pero no parseable (ej. "pendiente") → tratar como sin fechas
  const dias = Math.max(1, Math.round(ms / 86400000) + 1);
  return { ini, fin, dias, completa: true };
}

/**
 * Rendimiento CONJUNTO de un grupo de partidas (un frente, un ingeniero o la obra
 * entera): índice ponderado por metrado esperado = Σ realAcum ÷ Σ esperadoAcum
 * sobre las partidas con plan. Dedup por id (una partida puede caer en 2 frentes).
 * Devuelve el semáforo agregado + conteo por color (mismas reglas que rendimientoPartida).
 */
export function rendimientoConjunto(partidas = [], avances = [], hoy = null) {
  let realAcum = 0, esperadoAcum = 0, conDato = 0;
  const conteo = { verde: 0, ambar: 0, rojo: 0, sin_dato: 0 };
  const vistos = new Set();
  for (const p of partidas) {
    if (!p || vistos.has(p.id)) continue;
    vistos.add(p.id);
    const r = rendimientoPartida(p, avances, hoy);
    conteo[r.semaforo] = (conteo[r.semaforo] || 0) + 1;
    if (r.indice != null) { realAcum += r.realAcum; esperadoAcum += r.esperadoAcum; conDato++; }
  }
  const indice = esperadoAcum > 0 ? realAcum / esperadoAcum : null;
  const semaforo = indice == null ? 'sin_dato' : indice >= 0.95 ? 'verde' : indice >= 0.75 ? 'ambar' : 'rojo';
  return { nPartidas: vistos.size, conDato, realAcum, esperadoAcum, indice, semaforo, conteo };
}

/**
 * Avance roll-up por CAPÍTULO: para cada código que es prefijo de otro (capítulo/título),
 * el % de avance ponderado de sus partidas HOJA descendientes. Peso = costo_total_presupuestado
 * (o metrado_contratado, o 1 equiponderado). Una pasada O(n×profundidad). Las hojas no se
 * incluyen (su % ya vive en porcentaje_avance). Devuelve Map<codigo_capitulo, avancePct>.
 */
export function rollupAvancePorCodigo(partidas = []) {
  const vivas = partidas.filter(p => p && !p.deleted_at && p.codigo_delfin);
  const codes = vivas.map(p => String(p.codigo_delfin).trim());
  const prefijos = new Set();
  for (const c of codes) { const s = c.split('.'); for (let i = 1; i < s.length; i++) prefijos.add(s.slice(0, i).join('.')); }
  const acc = new Map();   // codigo_ancestro -> { peso, sum }
  for (const p of vivas) {
    const c = String(p.codigo_delfin).trim();
    if (prefijos.has(c)) continue;   // solo las HOJAS aportan (un código que es prefijo de otro es capítulo)
    const peso = (Number(p.costo_total_presupuestado) || Number(p.metrado_contratado) || 0) || 1;
    const pct = Number(p.porcentaje_avance) || 0;
    const segs = c.split('.');
    for (let i = 1; i < segs.length; i++) {
      const anc = segs.slice(0, i).join('.');
      const e = acc.get(anc) || { peso: 0, sum: 0 }; e.peso += peso; e.sum += pct * peso; acc.set(anc, e);
    }
  }
  const m = new Map();
  for (const [code, e] of acc) m.set(code, e.peso > 0 ? e.sum / e.peso : 0);
  return m;
}

/** Rollup mensual: metrado real sumado por partida en el mes 'YYYY-MM'. Solo partidas con avance. */
export function rollupMensual({ partidasDelFrente = [], avances = [], mes = null } = {}) {
  return partidasDelFrente.map(p => {
    const as = avances.filter(a => a && !a.deleted_at && a.partida_id === p.id && (!mes || String(a.fecha || '').startsWith(mes)));
    const metradoMes = as.reduce((s, a) => s + (Number(a.metrado_ejecutado) || 0), 0);
    return { partida: p, metradoMes };
  }).filter(r => r.metradoMes > 0);
}
