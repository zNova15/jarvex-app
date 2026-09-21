// ═══════════════════════════════════════════════════════════════════
// JARVEX — EDITAR EL DETALLE DE UNA FACTURA YA GUARDADA (22-set-2026).
//
// Gabriel, dos veces (6-sep y ahora): no podía corregir el IGV ni los ítems
// de un comprobante después de guardarlo — «quise editar un movimiento
// contable como administrador y no me deja cambiar nada de vales de IGV,
// montos, anticipos». El 6-sep se resolvió la MITAD del problema (dejar de
// BORRAR el detalle sin querer — ver `notas-movimiento.js`, cuyo textarea
// pasó a ser solo la nota humana); esta lib resuelve la otra mitad: cómo
// TOCAR el detalle sin romper lo que cuelga de él.
//
// ── POR QUÉ NO SE PUEDE REORDENAR NI BORRAR DEL MEDIO ─────────────
// Un ítem de `items_factura` NO tiene id propio: el almacén lo referencia por
// ÍNDICE del array (`items_factura[idx].recibido`, `.mov_vinculado_id` — ver
// jx-contabilidad.jsx, la fase de recepción). Borrar o mover una línea corre
// el índice de TODAS las líneas siguientes y desconecta la recepción que ya
// se registró contra ellas — silenciosamente, porque el índice sigue siendo
// un número válido, solo que ahora apunta a otra cosa.
//
// La regla, entonces:
//   · Editar una línea EXISTENTE (descripción/cantidad/unidad/precio) no
//     mueve nada: mismo índice, se conservan `material_id`, `recibido`,
//     `mov_vinculado_id`, `tipo_insumo` tal cual estaban.
//   · Agregar SIEMPRE va al final: los índices de abajo no existen todavía,
//     así que no hay nada que desconectar.
//   · "Quitar" una línea la VACÍA (cantidad y precio en 0) en vez de sacarla
//     del array: deja de valer, pero el índice sigue ahí para quien lo
//     referencia.
//
// El PRECIO se guarda SIEMPRE sin IGV (valor de venta) — así lo escribe
// Captura Mágica (`precioSinIgv`, jx-captura-magica.jsx) y de ahí comen el
// inventario, el abastecimiento y el historial de precios. Esta lib no
// cambia esa convención: `cantidad × precio_unitario` es la BASE IMPONIBLE
// de la línea, no el total con IGV.
//
// Puro: sin React, sin Dexie, sin fetch.
// ═══════════════════════════════════════════════════════════════════

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Los `items_factura` de un movimiento. Acepta `notas` cruda (string u objeto). */
export function itemsFacturaDe(notasRaw) {
  let n = notasRaw;
  if (typeof n === 'string') {
    if (!n.trim()) return [];
    try { n = JSON.parse(n); } catch { return []; }
  }
  return Array.isArray(n?.items_factura) ? n.items_factura : [];
}

/** Cuánto vale una línea: cantidad × precio unitario (base, sin IGV). */
export function valorLinea(item) {
  const cant = Number(item?.cantidad) || 0;
  const pu = Number(item?.precio_unitario) || 0;
  return r2(cant * pu);
}

/**
 * ¿Esta línea tiene una recepción de almacén o un movimiento vinculado
 * enganchados? No bloquea nada — es para AVISAR antes de vaciarla: la
 * decisión final es de quien edita, pero sin el aviso se corre el riesgo de
 * apagar una línea que el almacén ya usó para recibir mercadería.
 */
export function tieneRecepcionLigada(item) {
  return !!((Number(item?.recibido) || 0) > 0 || item?.mov_vinculado_id);
}

/**
 * Aplica cambios a UNA línea existente, por índice. Solo toca los campos que
 * una persona puede escribir desde este editor; todo lo demás (material_id,
 * recibido, mov_vinculado_id, tipo_insumo, precio_ingresado…) queda
 * EXACTAMENTE como estaba — el editor genérico no sabe de esos campos y no
 * debe inventar un valor para ellos.
 *
 * Índice fuera de rango: no hace nada (devuelve el array sin tocar).
 */
export function editarLinea(items, idx, cambios = {}) {
  const arr = Array.isArray(items) ? items.slice() : [];
  if (!Number.isInteger(idx) || idx < 0 || idx >= arr.length) return arr;
  const actual = arr[idx] || {};
  arr[idx] = {
    ...actual,
    ...(cambios.descripcion !== undefined ? { descripcion: String(cambios.descripcion || '') } : {}),
    ...(cambios.unidad !== undefined ? { unidad: String(cambios.unidad || '') || 'und' } : {}),
    ...(cambios.cantidad !== undefined ? { cantidad: Number(cambios.cantidad) || 0 } : {}),
    ...(cambios.precio_unitario !== undefined ? { precio_unitario: Number(cambios.precio_unitario) || 0 } : {}),
  };
  return arr;
}

/**
 * Agrega una línea nueva AL FINAL — nunca en el medio ni al principio, por la
 * misma razón que no se borra del medio: los índices de las líneas que YA
 * existen no se pueden mover.
 */
export function agregarLinea(items, { descripcion = '', unidad = 'und', cantidad = 1, precio_unitario = 0 } = {}) {
  const arr = Array.isArray(items) ? items.slice() : [];
  arr.push({
    descripcion: String(descripcion || ''),
    unidad: String(unidad || 'und') || 'und',
    cantidad: Number(cantidad) || 0,
    precio_unitario: Number(precio_unitario) || 0,
    tipo_insumo: 'material',
    material_id: null,
    // Marca que esta línea la escribió una persona en el editor de detalle,
    // no el OCR — mismo uso que le da Captura Mágica a `manual: true`.
    manual: true,
  });
  return arr;
}

/** "Quita" una línea SIN correr los índices de las demás: la deja en cero. */
export function vaciarLinea(items, idx) {
  return editarLinea(items, idx, { cantidad: 0, precio_unitario: 0 });
}

/** La suma de todas las líneas — para comparar contra el total del comprobante. */
export function totalDeLineas(items) {
  return r2((items || []).reduce((acc, it) => acc + valorLinea(it), 0));
}
