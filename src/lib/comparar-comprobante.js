// ═══════════════════════════════════════════════════════════════════
// JARVEX — Comparación NATURAL de números de comprobante (serie-correlativo).
//
// 'E001-9' debe ir ANTES que 'E001-10' (el número se compara como NÚMERO, no
// como texto), y las series se agrupan por su prefijo. Se usa como DESEMPATE
// estable al ordenar facturas dentro de una misma fecha: sin esto, tras un
// resync las facturas del mismo día quedaban en orden de `id` (uuid aleatorio)
// → la contadora las veía "desordenadas". Con este desempate, dentro de cada
// fecha salen en orden de comprobante, consistente en todos los dispositivos.
// ═══════════════════════════════════════════════════════════════════

/** Comparador natural ascendente de dos números de comprobante. */
export function cmpComprobante(a, b) {
  // Trozos alternados de dígitos / no-dígitos: "E001-10" → ["E","001","-","10"].
  const ra = String(a ?? '').toUpperCase().match(/\d+|\D+/g) || [];
  const rb = String(b ?? '').toUpperCase().match(/\d+|\D+/g) || [];
  const n = Math.max(ra.length, rb.length);
  for (let i = 0; i < n; i++) {
    const xa = ra[i], xb = rb[i];
    if (xa === undefined) return -1; // el más corto va primero
    if (xb === undefined) return 1;
    const na = /^\d+$/.test(xa), nb = /^\d+$/.test(xb);
    if (na && nb) {
      // Ambos numéricos → comparar como número (9 < 10). Sin exponer NaN.
      const d = Number(xa) - Number(xb);
      if (d) return d < 0 ? -1 : 1;
    } else {
      const c = xa.localeCompare(xb);
      if (c) return c;
    }
  }
  return 0;
}
