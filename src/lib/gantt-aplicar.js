// ═══════════════════════════════════════════════════════════════════
// JARVEX — Decisiones PURAS de la importación del Cronograma Gantt.
// Qué campos de cronograma escribir en una partida y qué estado dejar, según
// el archivo y el estado actual. Sin Dexie ni React → unit-testeable.
// Lo usan importGantt y aplicarSugerenciasGantt (mismo criterio, sin divergir).
// ═══════════════════════════════════════════════════════════════════

/**
 * Campos de cronograma a actualizar en una partida desde una tarea del Gantt.
 * - replaceAll=false (default): SALTAR vacíos → solo escribe lo que el archivo trae;
 *   no pisa fecha/duración/predecesora existente con un vacío.
 * - replaceAll=true: REEMPLAZAR todo (incluso vaciar) → el archivo es la fuente de
 *   verdad; una celda vacía borra el valor existente.
 * Devuelve un objeto PARCIAL (solo las claves a escribir).
 */
export function camposCronograma(t = {}, replaceAll = false) {
  const upd = {};
  if (replaceAll) {
    upd.fecha_inicio_planificada = t.fecha_inicio ?? null;
    upd.fecha_fin_planificada = t.fecha_fin ?? null;
    upd.duracion_dias = t.duracion_dias ?? null;
    upd.predecesoras = t.predecesoras ?? null;
  } else {
    if (t.fecha_inicio) upd.fecha_inicio_planificada = t.fecha_inicio;
    if (t.fecha_fin) upd.fecha_fin_planificada = t.fecha_fin;
    if (t.duracion_dias != null) upd.duracion_dias = t.duracion_dias;
    if (t.predecesoras != null) upd.predecesoras = t.predecesoras;
  }
  return upd;
}

/**
 * Estado resultante de una partida según el % de avance del Gantt y su estado actual.
 * - avance ≥ 100 → 'terminado' (PERO respeta 'observado': no pisa esa marca deliberada).
 * - 0 < avance < 100 y estaba 'pendiente' → 'en_ejecucion'.
 * - Nunca DEGRADA un estado ya avanzado.
 * Devuelve undefined si no corresponde cambiar el estado.
 * NOTA: NUNCA toca porcentaje_avance (ese lo maneja el reporte diario del ingeniero).
 */
export function decidirEstadoGantt(avance, estadoActual) {
  const av = Number(avance) || 0;
  if (av >= 100) return estadoActual === 'observado' ? undefined : 'terminado';
  if (av > 0 && estadoActual === 'pendiente') return 'en_ejecucion';
  return undefined;
}

/**
 * Update de DOMINIO (sin metadata de sync) para una partida-hoja desde el Gantt:
 * campos de cronograma + estado. Vacío si nada cambia respecto a `p`.
 */
export function updateDominioGantt(p = {}, t = {}, replaceAll = false) {
  const dom = camposCronograma(t, replaceAll);
  const est = decidirEstadoGantt(t.porcentaje_avance, p.estado);
  if (est) dom.estado = est;
  return dom;
}

/** ¿El update de dominio cambia algo realmente respecto a la partida actual? */
export function hayCambioDominio(p = {}, dom = {}) {
  return Object.keys(dom).some(k => p[k] !== dom[k]);
}
