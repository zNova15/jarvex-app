// ═══════════════════════════════════════════════════════════════════
// JARVEX — M2: guard de stock NEGATIVO (helper PURO, unit-testeable).
//
// Reconstruye el saldo cronológico de un (item, almacén) y verifica que un
// borrado o una edición de cantidad no dejen el stock negativo en ningún punto
// posterior. Sin Dexie ni React. Aplica a tipos con stock por cantidad
// (materiales/herramientas/epp/emergencia); maquinaria es serializada y se exime.
// ═══════════════════════════════════════════════════════════════════

/** Delta con signo de un movimiento sobre SU almacén (ubicacion_id). */
export function deltaPorAlmacen(mov) {
  const c = Number(mov?.cantidad) || 0;
  switch (mov?.tipo_movimiento) {
    case 'entrada':
    case 'devolucion': return c;
    case 'salida':
    case 'merma':      return -c;
    default:           return 0; // ajuste / reverso no mueven cantidad neta
  }
}

/**
 * Simula un CAMBIO sobre el movimiento `movId`: nuevoDelta=0 ⇒ borrado;
 * nuevoDelta=<número con signo> ⇒ edición (reemplaza su contribución).
 * Recorre el saldo cronológico y detecta cualquier prefijo negativo.
 * @param {Object} opts
 * @param {Array}  opts.movimientos filas del MISMO tipo, item y ubicacion_id
 * @param {string} opts.movId
 * @param {number} [opts.nuevoDelta=0]
 * @returns {{seguro:boolean, minSaldo:number, fechaViolacion:(string|null)}}
 */
export function simularCambio({ movimientos = [], movId, nuevoDelta = 0 }) {
  const vivos = movimientos
    .filter(m => m && !m.deleted_at && !m.reverses_id && !m.reversed_by_id)
    .sort((a, b) =>
      String(a.fecha).localeCompare(String(b.fecha)) ||
      String(a.created_at || '').localeCompare(String(b.created_at || '')));
  let saldo = 0, min = 0, fechaViol = null;
  for (const m of vivos) {
    const d = m.id === movId ? Number(nuevoDelta) || 0 : deltaPorAlmacen(m);
    saldo += d;
    if (saldo < min) { min = saldo; fechaViol = m.fecha; }
  }
  return { seguro: min >= 0, minSaldo: min, fechaViolacion: fechaViol };
}

/** Borrado = cambiar la contribución del movimiento a 0. */
export const simularBorrado = ({ movimientos, movId }) =>
  simularCambio({ movimientos, movId, nuevoDelta: 0 });
