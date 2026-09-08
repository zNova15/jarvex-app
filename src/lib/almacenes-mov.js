// ═══════════════════════════════════════════════════════════════════
// JARVEX — Lectura de un movimiento de almacén: de qué almacén salió, a
// cuál llegó, y qué dice realmente su observación.
//
// POR QUÉ ESTÁ ACÁ Y NO DENTRO DE LA PANTALLA (8-set-2026)
// Estas dos funciones vivían dentro de `jx-movimientos.jsx`, así que las
// tablas de Mov. de Materiales / Herramientas mostraban «Almacén salida» y
// «Almacén llegada» pero el Excel de esos mismos movimientos exportaba una
// sola columna «Almacén» — la ubicación cruda de la fila. En un TRASPASO,
// donde el otro lado está codificado en la observación, el Excel perdía la
// mitad del dato y la observación salía con el ruido del traspaso adentro.
// Ése es uno de los «no trae todos los datos» que reportó la almacenera.
//
// Puro: sin React, sin Dexie. Testeado en __tests__/almacenes-mov.test.js
// ═══════════════════════════════════════════════════════════════════

/**
 * Almacenes de una fila de movimiento (materiales / herramientas / EPP).
 *
 * La fila guarda UNA ubicación (salida = de dónde sale; entrada/devolución =
 * a dónde llega). Si es pata de un TRASPASO, el otro lado viene anotado en
 * observaciones ('Traspaso → X' / 'Traspaso ← Y'). Formato legado del
 * traspaso de materiales: 'Traspaso Origen → Destino' (ambos lados en la
 * observación, fila sin ubicacion_id).
 *
 * @param m           el movimiento
 * @param ubicNombre  Map(ubicacion_id → nombre)
 * @returns { salida, llegada, esTraspaso }
 */
export function almacenesDeMov(m, ubicNombre) {
  const ubic = m.ubicacion_id ? ((ubicNombre && ubicNombre.get(m.ubicacion_id)) || null) : null;
  const obs = String(m.observaciones || '');
  const haciaTr = obs.match(/Traspaso → ([^·]+)/);
  const desdeTr = obs.match(/Traspaso ← ([^·]+)/);
  if (!haciaTr && !desdeTr) {
    const par = obs.match(/Traspaso ([^·→←]+) → ([^·]+)/);
    if (par) return { salida: par[1].trim(), llegada: par[2].trim(), esTraspaso: true };
  }
  const tipo = m.accion || m.tipo_movimiento;
  // 'baja' y 'mantenimiento' (acciones legales del CHECK de herramientas,
  // hoy solo en data legacy/reversos) también son stock que SALE del almacén.
  const esSalida = tipo === 'salida' || tipo === 'merma' || tipo === 'baja' || tipo === 'mantenimiento';
  return {
    salida: esSalida ? ubic : (desdeTr ? desdeTr[1].trim() : null),
    llegada: !esSalida ? ubic : (haciaTr ? haciaTr[1].trim() : null),
    esTraspaso: !!(haciaTr || desdeTr),
  };
}

/**
 * La observación legible de un movimiento: saca la codificación de traspaso
 * ('Traspaso A → B' / 'Traspaso → X' / 'Traspaso ← Y'), que ya se ve en las
 * columnas de almacén, y deja la nota humana que escribió quien lo registró.
 */
export function obsLegible(m) {
  let s = String(m?.observaciones || '');
  s = s.replace(/Traspaso\s+[^·→←]*→\s*[^·]+/g, '')
       .replace(/Traspaso\s*→\s*[^·]+/g, '')
       .replace(/Traspaso\s*←\s*[^·]+/g, '');
  return s.split('·').map(x => x.trim()).filter(Boolean).join(' · ');
}

export default { almacenesDeMov, obsLegible };
