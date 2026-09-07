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

// ═══════════════════════════════════════════════════════════════════
//  SOBREGIRO ABSORBIDO POR EL SERVIDOR (caso ZAPATOS 38, 7-sep-2026)
//
//  Los triggers de Postgres que mantienen el snapshot hacen
//  `stock_actual = GREATEST(0, stock_actual + delta)`. Ese GREATEST es un
//  candado sano (el snapshot nunca queda negativo) pero DESTRUYE información:
//  cuando entra una salida que no alcanza el stock, el déficit se pierde y el
//  snapshot queda por ENCIMA del historial para siempre.
//
//  Caso real: ZAPATOS 38 recibió el 13-jul tres salidas duplicadas por
//  multi-click (misma persona, mismo día, 200 ms entre sí). El historial bajó
//  a −1; el snapshot se clampó en 0. El 5-sep la almacenera registró el
//  ingreso de 1 par: snapshot 1, historial 0. Al intentar la salida, la
//  pantalla de EPPs calculaba el stock SOLO desde los movimientos, veía 0 y
//  decía "no hay stock" — con el par físicamente en el almacén.
//
//  `saldoMinimoHistorico` detecta esa huella: si el saldo acumulado pasó por
//  debajo de cero en algún punto, hubo un sobregiro que el servidor absorbió y
//  el snapshot es la señal buena.
// ═══════════════════════════════════════════════════════════════════

const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

/** Movimientos vivos ordenados cronológicamente (fecha, luego created_at). */
function vivosOrdenados(movimientos) {
  return (movimientos || [])
    .filter(m => m && !m.deleted_at && !m.reverses_id && !m.reversed_by_id)
    .sort((a, b) =>
      String(a.fecha || '').localeCompare(String(b.fecha || '')) ||
      String(a.created_at || '').localeCompare(String(b.created_at || '')));
}

/**
 * El punto MÁS BAJO por el que pasó el saldo del ítem según su historial.
 * < 0 ⇒ hubo salidas sin respaldo (duplicados, huecos, entradas nunca
 * registradas) y el servidor se comió ese déficit con su GREATEST(0, …).
 * @returns {{ minimo:number, fecha:(string|null) }}
 */
export function saldoMinimoHistorico(movimientos) {
  let saldo = 0, minimo = 0, fecha = null;
  for (const m of vivosOrdenados(movimientos)) {
    saldo += efectoMovimiento(m) * (Number(m.cantidad) || 0);
    if (saldo < minimo) { minimo = saldo; fecha = m.fecha || null; }
  }
  return { minimo, fecha };
}

/**
 * Diagnóstico COMPLETO del stock de un ítem: qué número mostrar, si hay
 * descuadre y —lo importante para la usuaria— POR QUÉ.
 *
 * Devuelve `conciliarStock` más:
 *   - stock:        el número que la pantalla debe mostrar y validar
 *   - huboSobregiro / fechaSobregiro: el historial pasó por negativo
 *   - faltante:     unidades que el historial no explica (snapshot − historial)
 *   - explicacion:  frase lista para mostrar, o null si está todo cuadrado
 */
export function diagnosticoStock({ stockActual, movimientos, umbral = 0.001 } = {}) {
  const c = conciliarStock({ stockActual, movimientos, umbral });
  const vivos = vivosOrdenados(movimientos);
  const { minimo, fecha } = saldoMinimoHistorico(movimientos);
  const huboSobregiro = minimo < -umbral;
  // Sin historial (ítem importado o con stock inicial) el snapshot es lo único
  // que hay: no es un descuadre, es que nunca hubo movimientos que lo respalden.
  const sinHistorial = vivos.length === 0;
  const stock = sinHistorial ? c.snapshot : stockDisponibleConfiable({ stockActual, movimientos, umbral });
  let explicacion = null;
  if (!sinHistorial && c.snapshotAlto) {
    explicacion = huboSobregiro
      ? `El almacén tiene ${c.snapshot} pero el historial solo suma ${c.rawSegunMovs}: el ${fecha || 'algún día'} se registraron salidas sin stock que las respaldara (salidas duplicadas, o un ingreso que nunca se registró). Se toma el stock del almacén.`
      : `El almacén tiene ${c.snapshot} pero el historial solo suma ${c.rawSegunMovs}. Falta registrar el ingreso de ${round3(c.diff)} unidad(es).`;
  } else if (!sinHistorial && c.snapshotBajo) {
    explicacion = `El historial respalda ${c.segunMovs} pero el almacén guardó ${c.snapshot}: el contador quedó atrás (sincronización). Se toma el historial; "Recalcular stocks" lo cuadra.`;
  }
  return {
    ...c,
    stock,
    sinHistorial,
    huboSobregiro,
    fechaSobregiro: fecha,
    faltante: round3(c.diff),
    explicacion,
  };
}
