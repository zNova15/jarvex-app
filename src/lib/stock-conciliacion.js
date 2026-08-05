// ═══════════════════════════════════════════════════════════════════
// JARVEX — Conciliación de stock: snapshot (materiales.stock_actual) vs. la
// VERDAD según el historial de movimientos.
//
// Problema real (almacén, ago 2026): `stock_actual` es un CONTADOR snapshot que
// se guarda por separado de los movimientos y se sincroniza por last-write-wins.
// Cuando dos dispositivos editan el mismo material offline, o cuando el push del
// snapshot falla/se congela, el contador QUEDA DESFASADO del historial: una
// entrada de +5 aparece en Movimientos pero el formulario de salida muestra
// stock 0 y BLOQUEA una salida legítima. La almacenera cree que "no hay stock"
// (o que le robaron) cuando el material sí ingresó.
//
// Esta lib recomputa el stock desde los movimientos (la fuente de verdad, misma
// regla que el botón "Recalcular stocks") y detecta la discrepancia para poder
// avisar y/o desbloquear. Usa el MISMO mapa de efecto que la validación
// cronológica (efectoMovimiento) — así entrada/devolución/reposición/ajuste
// suman y salida/merma/baja restan, sin el bug de contar la devolución como
// salida.
// ═══════════════════════════════════════════════════════════════════

import { efectoMovimiento } from './stock-cronologia.js';

/**
 * Stock según el historial de movimientos (entradas − salidas, excluyendo
 * reversas y movimientos reversados). Puede dar negativo si el historial está
 * incompleto; el consumidor decide si lo clampa a 0.
 * @param {Array} movimientos  movimientos del ítem (se filtran borrados/reversas)
 */
export function stockSegunMovimientos(movimientos) {
  let s = 0;
  for (const m of movimientos || []) {
    if (!m || m.deleted_at || m.reverses_id || m.reversed_by_id) continue;
    s += efectoMovimiento(m) * (Number(m.cantidad) || 0);
  }
  return s;
}

/**
 * Concilia el snapshot con el historial.
 * @returns {{
 *   snapshot: number,        // stock_actual guardado
 *   segunMovs: number,       // stock derivado de movimientos (clampeado a ≥0)
 *   rawSegunMovs: number,    // idem sin clampear (puede ser negativo)
 *   diff: number,            // snapshot − segunMovs
 *   discrepa: boolean,       // |diff| supera el umbral
 *   snapshotBajo: boolean,   // el snapshot es MENOR que el historial (bloquea de más)
 *   snapshotAlto: boolean,   // el snapshot es MAYOR (stock inflado/fantasma)
 * }}
 */
export function conciliarStock({ stockActual, movimientos, umbral = 0.001 } = {}) {
  const rawSegunMovs = stockSegunMovimientos(movimientos);
  const segunMovs = Math.max(0, rawSegunMovs);
  const snapshot = Number(stockActual) || 0;
  const diff = snapshot - segunMovs;
  const discrepa = Math.abs(diff) > umbral;
  return {
    snapshot,
    segunMovs,
    rawSegunMovs,
    diff,
    discrepa,
    snapshotBajo: diff < -umbral,   // hay MÁS según movimientos que en el snapshot
    snapshotAlto: diff > umbral,    // el snapshot dice MÁS de lo que respaldan los movimientos
  };
}

/**
 * Stock disponible "confiable" para validar una salida: cuando el snapshot está
 * por DEBAJO de lo que respaldan los movimientos (el caso que BLOQUEA de más),
 * usamos el historial para no impedir una salida legítima. Cuando el snapshot es
 * mayor (stock inflado), nos quedamos con el snapshot para NO habilitar salidas
 * que el historial no respalda (conservador en ambas direcciones).
 */
export function stockDisponibleConfiable({ stockActual, movimientos, umbral = 0.001 } = {}) {
  const c = conciliarStock({ stockActual, movimientos, umbral });
  return c.snapshotBajo ? c.segunMovs : c.snapshot;
}
