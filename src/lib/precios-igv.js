// ═══════════════════════════════════════════════════════════════════
// JARVEX — ¿LOS PRECIOS QUE ESTOY ESCRIBIENDO YA TRAEN EL IGV? (tanda 9)
//
// EL PEDIDO (Gabriel, 7-set-2026):
//   «quiero que me agregues un cuadrito seleccionable que habilite o
//    deshabilite si los montos son con IGV o sin ellos. Me ha pasado que a
//    veces hay facturas donde te las generan con costo sin IGV y se lo agregan
//    al final, y en otras ocasiones colocan los precios con IGV y simplemente
//    al final sale el desagregado.»
//
// Las dos cosas son verdad y las dos aparecen en producción. Lo que NO puede
// pasar es que la app asuma una y la persona esté tipeando la otra: ahí el
// total sale 18 % arriba o 18 % abajo y nadie se entera hasta que el proveedor
// reclama.
//
// ── LA REGLA ──────────────────────────────────────────────────────
//   preciosIncluyenIgv = false (por defecto, como hasta hoy)
//       precio tipeado = VALOR DE VENTA unitario
//       valorVenta = Σ(cantidad × precio)        total = valorVenta × (1+t)
//
//   preciosIncluyenIgv = true
//       precio tipeado = PRECIO DE VENTA unitario (ya con IGV)
//       total = Σ(cantidad × precio)             valorVenta = total / (1+t)
//
// ── POR QUÉ EL TOTAL MANDA CUANDO EL PRECIO YA TRAE IGV ───────────
// Porque es el número que la persona tiene delante, en el papel. Despejar
// hacia atrás y quedarse con un valor de venta con decimales raros es correcto;
// hacerlo al revés —redondear el precio unitario sin IGV y multiplicar— hace
// que el total no cuadre con la factura por unos céntimos, y esos céntimos son
// exactamente lo que la contadora tiene que explicar. Es el mismo criterio de
// `totalesDesdeTotal()` en ordenes.js: el total existe, el desglose se despeja.
//
// ── CON IGV EN 0 NO SE DIVIDE POR NADA ────────────────────────────
// Un recibo por honorarios o un proveedor del RUS no tienen IGV. Con `igvPct`
// en 0 las dos ramas dan lo mismo y el toggle deja de importar — pero la
// división por (1+0) tiene que seguir dando el mismo número, no un NaN.
//
// Puro: sin React, sin Dexie. Testeado en __tests__/precios-igv.test.js
// ═══════════════════════════════════════════════════════════════════

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;
const r6 = (n) => Math.round((num(n) + Number.EPSILON) * 1e6) / 1e6;

/**
 * Totales de un conjunto de líneas, según si los precios ya traen IGV.
 *
 * @param lineas  [{ cantidad, precio_unitario }]
 * @param opts.igvPct               18 por defecto
 * @param opts.preciosIncluyenIgv   false por defecto (compatible con todo lo ya cargado)
 * @returns { valorVenta, igv, total, igvPct, preciosIncluyenIgv }
 */
export function totalesConModoIgv(lineas, { igvPct = 18, preciosIncluyenIgv = false } = {}) {
  const pct = Math.max(0, num(igvPct));
  const f = 1 + pct / 100;
  let bruto = 0;
  for (const l of (lineas || [])) {
    if (!l || l.deleted_at) continue;
    bruto += num(l.cantidad) * num(l.precio_unitario);
  }
  if (preciosIncluyenIgv) {
    const total = r2(bruto);
    const valorVenta = r2(total / f);
    return { valorVenta, igv: r2(total - valorVenta), total, igvPct: pct, preciosIncluyenIgv: true };
  }
  const valorVenta = r2(bruto);
  const igv = r2(valorVenta * (pct / 100));
  return { valorVenta, igv, total: r2(valorVenta + igv), igvPct: pct, preciosIncluyenIgv: false };
}

/**
 * El precio unitario SIN IGV de una línea, que es el que se guarda.
 *
 * La app entera —`oc_items.precio_unitario`, `items_factura.precio_unitario`,
 * el historial de precios, el cuadro de abastecimiento— trabaja con el valor de
 * venta. El toggle es de ENTRADA: cambia lo que la persona escribe, no lo que
 * se guarda. Guardar unas líneas con IGV y otras sin él haría que comparar dos
 * compras del mismo insumo dependa de cómo estaba el checkbox ese día.
 *
 * Se redondea a 6 decimales, no a 2: en `oc_items` el subtotal se recalcula
 * multiplicando, y cortar el unitario a céntimos descuadra el total del
 * documento cuando la cantidad es grande (11.269 bolsas de cemento).
 */
export function precioSinIgv(precio, { igvPct = 18, preciosIncluyenIgv = false } = {}) {
  const p = num(precio);
  if (!preciosIncluyenIgv) return p;
  const pct = Math.max(0, num(igvPct));
  return r6(p / (1 + pct / 100));
}

/** El de arriba al revés: para MOSTRAR con IGV algo que está guardado sin él. */
export function precioConIgv(precio, { igvPct = 18 } = {}) {
  return r6(num(precio) * (1 + Math.max(0, num(igvPct)) / 100));
}

/**
 * Las líneas normalizadas a valor de venta, listas para guardar.
 * `precio_ingresado` queda al lado para poder explicar de dónde salió el número.
 */
export function lineasNormalizadas(lineas, { igvPct = 18, preciosIncluyenIgv = false } = {}) {
  return (lineas || []).map(l => {
    const sin = precioSinIgv(l.precio_unitario, { igvPct, preciosIncluyenIgv });
    return {
      ...l,
      precio_unitario: sin,
      precio_ingresado: preciosIncluyenIgv ? num(l.precio_unitario) : undefined,
      precio_incluia_igv: preciosIncluyenIgv || undefined,
      subtotal: r2(num(l.cantidad) * sin),
    };
  });
}

export const ETIQUETA_MODO_IGV = {
  true: 'Los precios que escribo YA incluyen IGV',
  false: 'Los precios que escribo son SIN IGV',
};
