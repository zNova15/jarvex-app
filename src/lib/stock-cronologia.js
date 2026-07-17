// ═══════════════════════════════════════════════════════════════════
// JARVEX — Validación CRONOLÓGICA de salidas de almacén.
//
// Caso real (rotomartillos, jul 2026): se registraron con fechas retroactivas
// una entrada el 15/05 y una salida el 11/05 — la salida ocurre ANTES de que
// la mercadería exista. La validación clásica solo mira el stock PRESENTE, así
// que el cruce pasó. Esta lib reconstruye la línea de tiempo del ítem y
// rechaza una salida si, en su fecha, no había stock suficiente — y también si
// insertarla dejaría negativo algún punto POSTERIOR de la línea de tiempo
// (ej: entrada 10/05 +5, salida 20/05 −5 → una salida retro del 12/05 por 3
// dejaría el 20/05 en −3, aunque "al 12/05" hubiera 5).
//
// TOLERANCIA al stock sin historial: ítems importados o con stock inicial no
// tienen movimientos que lo respalden (stock_actual > balance del historial).
// Esa diferencia se asume existente DESDE SIEMPRE (baseline) — si no, se
// bloquearían salidas legítimas de ítems migrados. Con historial completo el
// baseline es 0 y el chequeo es estricto.
// ═══════════════════════════════════════════════════════════════════

// Efecto (+entra / −sale) de un movimiento genérico de almacén. Usa el
// tipo_movimiento fino si existe; si no, la accion (herramientas viejas).
const EFECTO = {
  entrada: +1, ingreso: +1, devolucion: +1, reposicion: +1, ajuste: +1,
  salida: -1, merma: -1, baja: -1,
  mantenimiento: 0, traspaso: 0,
};
export function efectoMovimiento(m) {
  const t = m?.tipo_movimiento ?? m?.accion;
  return EFECTO[t] ?? 0;
}

const keyDe = (fecha, hora) => `${fecha || '0000-00-00'}T${hora || '00:00:00'}`;

/**
 * Valida una SALIDA contra la línea de tiempo del ítem.
 * @param movimientos  historial del ítem (vivos y borrados; los borrados se filtran acá)
 * @param fecha/hora   fecha/hora de la salida nueva (hora opcional → fin del día)
 * @param cantidad     unidades a sacar
 * @param stockActualHoy  stock presente del ítem (para el baseline sin historial)
 * @param efectoDe     opcional: función (mov) → +1|-1|0 (default efectoMovimiento)
 * @returns { ok, disponible }  disponible = lo máximo que se puede sacar en esa fecha
 */
export function validarSalidaCronologica({ movimientos, fecha, hora, cantidad, stockActualHoy, efectoDe }) {
  const efecto = efectoDe || efectoMovimiento;
  const kIns = keyDe(fecha, hora || '23:59:59');
  const evs = (movimientos || [])
    .filter(m => m && !m.deleted_at)
    .map(m => ({ k: keyDe(m.fecha, m.hora), d: efecto(m) * (Number(m.cantidad) || 0) }))
    .filter(e => e.d !== 0)
    .sort((a, b) => a.k.localeCompare(b.k));

  // Balance al momento de la salida y mínimo del balance de ahí en adelante
  // (la salida retro descuenta TODOS los puntos posteriores).
  let bal = 0;
  for (const e of evs) if (e.k <= kIns) bal += e.d;
  let minDesde = bal;
  let balFinal = bal;
  for (const e of evs) {
    if (e.k > kIns) {
      balFinal += e.d;
      if (balFinal < minDesde) minDesde = balFinal;
    }
  }
  // Baseline: stock presente no respaldado por el historial (imports / stock
  // inicial) — existió desde siempre, así que suma en todos los puntos.
  const baseline = Math.max(0, (Number(stockActualHoy) || 0) - balFinal);
  const disponible = Math.max(0, minDesde + baseline);
  const cant = Number(cantidad) || 0;
  return { ok: disponible + 1e-9 >= cant, disponible };
}

/** Agrupa items de un lote {itemId, cantidad} sumando cantidades por ítem
 *  (una salida con 2 filas del mismo ítem se valida como una sola). */
export function agruparCantidades(items, idDe) {
  const m = new Map();
  for (const it of items || []) {
    const id = idDe(it);
    if (!id) continue;
    m.set(id, (m.get(id) || 0) + (Number(it.cantidad) || 0));
  }
  return m;
}
