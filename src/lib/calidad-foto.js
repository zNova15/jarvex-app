// ═══════════════════════════════════════════════════════════════════
// JARVEX — ¿Esta foto de comprobante sirve para leerla?
//
// POR QUÉ EXISTE (17-set-2026). Dos facturas del portal de campo se subieron
// como un JPEG BLANCO de 720×1600 y 7.508 bytes. Nadie se enteró hasta que la
// contadora quiso leerlas DÍAS DESPUÉS — y para entonces el comprobante de
// papel ya no estaba. Ese es el daño real: no que la lectura falle, sino que
// falle tarde, cuando ya no se puede volver a sacar la foto.
//
// La única persona que puede arreglar una foto mala es la que la sacó, y solo
// mientras tiene el papel en la mano. Por eso este chequeo corre EN EL
// TELÉFONO, al momento de capturar, sin señal y sin costo.
//
// ── LA MEDIDA: BITS POR PÍXEL ────────────────────────────────────────
// Un JPEG pesa en proporción al DETALLE que tiene adentro: es lo que hace la
// compresión. Un comprobante es casi todo texto y bordes —entropía altísima—;
// una hoja en blanco, una foto velada o con el lente tapado no tienen nada que
// comprimir y salen ridículamente livianas para su tamaño.
//
// No hace falta decodificar ni leer píxeles: el peso del archivo y sus
// dimensiones ya son la medida, y las dos están a mano apenas se comprime.
//
// ── EL UMBRAL ESTÁ MEDIDO, NO ELEGIDO ────────────────────────────────
// Las 49 fotos reales del portal de campo, bajadas de R2 y medidas el
// 17-set-2026:
//
//   fotos legibles (46)     0,5402 … 3,0533 bits/píxel
//   las dos en blanco        0,0521           bits/píxel
//
// Entre la PEOR foto buena y las malas hay un factor de 10,4. El umbral se
// pone en 0,15: queda 3,6× por debajo de la peor foto que sí se pudo leer y
// 2,9× por encima de las que no tenían nada. Ese margen importa porque el
// portal BLOQUEA la subida (decisión de Gabriel, 17-set): un falso positivo
// deja a alguien en la obra sin poder mandar su comprobante, así que el
// chequeo solo puede atrapar lo que está inequívocamente muerto.
export const BPP_MINIMO = 0.15;

// Una miniatura no se lee por más nítida que esté. Las fotos reales llegan
// acá con el lado mayor en 1600 px (el techo de optimizar-imagen); 640 es un
// piso muy por debajo, solo para atrapar miniaturas y avatares.
export const LADO_MINIMO = 640;

/**
 * ¿La imagen que se va a guardar tiene algo adentro?
 *
 * @param medida  { bytes, ancho, alto } del archivo TAL COMO SE VA A GUARDAR
 *                (después de optimizar, no el original que eligió la persona:
 *                el blanco del 16-set lo produjo justamente la optimización).
 * @returns { ok, motivo, bpp }  `motivo` es el texto que ve el usuario.
 */
export function evaluarCalidadComprobante(medida) {
  const bytes = Number(medida?.bytes);
  const ancho = Number(medida?.ancho);
  const alto = Number(medida?.alto);

  // Sin datos no se juzga. Pasa lo que no se pudo medir (un PDF, un HEIC que
  // este teléfono no sabe decodificar): bloquear por no haber podido mirar
  // sería el peor de los dos errores.
  if (!Number.isFinite(bytes) || !Number.isFinite(ancho) || !Number.isFinite(alto)
    || bytes <= 0 || ancho <= 0 || alto <= 0) {
    return { ok: true, motivo: null, bpp: null };
  }

  const ladoMayor = Math.max(ancho, alto);
  if (ladoMayor < LADO_MINIMO) {
    return {
      ok: false,
      bpp: (bytes * 8) / (ancho * alto),
      motivo: `Esta imagen es demasiado chica (${ancho}×${alto}) para leer un comprobante. `
        + 'Sacá la foto con la cámara en vez de mandar una miniatura o una captura reducida.',
    };
  }

  const bpp = (bytes * 8) / (ancho * alto);
  if (bpp < BPP_MINIMO) {
    return {
      ok: false,
      bpp,
      motivo: 'Esta foto salió en blanco o sin nada legible (puede haber quedado velada, '
        + 'muy oscura o con el lente tapado). Sacala de nuevo apuntando al comprobante, '
        + 'con buena luz y sin mover el teléfono.',
    };
  }

  return { ok: true, motivo: null, bpp };
}
