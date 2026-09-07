// ═══════════════════════════════════════════════════════════════════
// JARVEX — Cuántas líneas de detalle trae este comprobante (según el OCR).
//
// El número importa por una sola razón: fija el techo de tokens de la
// respuesta. Si se estima de menos, el modelo se queda sin presupuesto a
// mitad del JSON, la respuesta llega cortada y la fila termina en
// «Este comprobante tiene demasiadas líneas de detalle».
//
// Hasta hoy la estimación era una sola señal: contar las filas de la TABLA
// MARKDOWN que devuelve Mistral OCR (`| … | … |`). Eso funciona con un PDF
// nativo, donde el OCR reconoce la grilla. Con una FOTO no: el OCR devuelve
// el detalle como texto corrido, no encuentra tabla, la cuenta da 0 y el
// presupuesto cae al piso — justo en el documento que más necesita.
//
// Ese es el caso que reportó Gabriel el 7-sep-2026: una `image.jpg` de 894 KB
// con muchas líneas, fallando con "demasiadas líneas de detalle".
//
// Por eso acá se miran VARIAS señales y se toma la mayor: sobreestimar cuesta
// nada (el techo es un tope, no una reserva), subestimar cuesta la lectura
// entera y una llamada quemada.
// ═══════════════════════════════════════════════════════════════════

// Unidades de medida que aparecen en el detalle de un comprobante peruano.
const RX_UNIDAD = /\b(unidad(?:es)?|und|un|pza|pieza|kg|kgs|kilo(?:gramo)?s?|gr|tn|ton|m2|m3|ml|mts?|metros?|gal(?:[oó]n(?:es)?)?|lt|lts|litros?|bls|bolsas?|cja|caja|jgo|juego|par|rollo|balde|cil|cilindro|serv(?:icio)?|glb)\b/gi;

/**
 * Filas de una tabla markdown, sin encabezado ni separador.
 * (La señal original: sirve tal cual para los PDF con grilla.)
 */
export function filasTablaMarkdown(texto) {
  const filas = (String(texto || '').match(/^\s*\|.*\|\s*$/gm) || []).length;
  // Menos encabezado y línea de separación.
  return Math.max(0, filas - 2);
}

/**
 * Líneas que PARECEN un ítem en texto corrido: arrancan con una cantidad
 * (entero o decimal) y siguen con texto. Es la forma en que el OCR devuelve
 * el detalle de una foto.
 *   "40.00 UNIDAD PICOS 30.50"
 *   "2 CILINDROS VACIOS 67.79"
 */
export function lineasConCantidad(texto) {
  let n = 0;
  for (const linea of String(texto || '').split('\n')) {
    const l = linea.trim();
    if (l.length < 4) continue;
    // Una cantidad al principio + al menos una palabra de 3+ letras después.
    if (/^\d{1,5}([.,]\d{1,3})?\s+\S/.test(l) && /[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}/.test(l)) n++;
  }
  return n;
}

/** Cuántas veces aparece una unidad de medida (una por línea de detalle). */
export function ocurrenciasDeUnidad(texto) {
  return (String(texto || '').match(RX_UNIDAD) || []).length;
}

/**
 * La estimación que usa el endpoint: la MAYOR de las señales.
 *
 * @param texto  el markdown/texto que devolvió el OCR
 * @returns número de líneas de detalle estimadas (≥ 0)
 */
export function estimarItems(texto) {
  if (!texto) return 0;
  return Math.max(
    filasTablaMarkdown(texto),
    lineasConCantidad(texto),
    // Las unidades sobrecuentan cuando el encabezado dice "Unidad Medida", así
    // que se las descuenta un poco antes de competir con las otras señales.
    Math.max(0, ocurrenciasDeUnidad(texto) - 2),
  );
}
