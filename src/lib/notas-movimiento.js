// ═══════════════════════════════════════════════════════════════════
// JARVEX — EL CAMPO "NOTAS" DE UN COMPROBANTE NO ES UNA NOTA (tanda 7).
//
// Gabriel, 6-sep-2026:
//   «He tratado en varias ocasiones de ir a editar un comprobante y no tengo la
//    posibilidad de editar el tema del doce por ciento. En Captura Mágica lo
//    puedo hacer, pero una vez que lo subo y me voy a editarlo, ya no puedo, o
//    en la parte baja se ve un montón de código y no puedo ver dónde cambiarlo.»
//
// Ese "montón de código" es JSON. Medido contra producción: de los 1.402
// movimientos vivos, **1.402 tienen JSON en `notas` y NINGUNO texto plano**.
// Adentro viaja lo que sostiene media app:
//
//   items_factura · igv · subtotal · confianza · advertencias · captura_magica
//   intercompany_auto · intercompany_mirror_of · intercompany_respaldada
//   oc_vinculada · materiales_creados · movs_creados · desglose_heredado_de
//   backfill · backfill_fecha · nota
//
// El formulario de edición lo volcaba crudo en un <textarea rows={2}> rotulado
// "Notas" y al guardar escribía de vuelta lo que quedara ahí. O sea que editar
// un comprobante y tocar ese campo **borraba los ítems de la factura** — y con
// ellos la recepción del almacén, el inventario de la empresa y el agrupamiento
// de órdenes. Sin aviso y sin vuelta atrás.
//
// Este módulo separa las dos cosas que estaban mezcladas:
//   · la NOTA HUMANA (la clave `nota`), que es lo único que una persona escribe;
//   · el PAYLOAD ESTRUCTURADO, que la app mantiene y nadie debe teclear.
//
// Puro: sin React, sin Dexie, sin imports.
// ═══════════════════════════════════════════════════════════════════

/** El objeto de `notas`, o {} si no es JSON. Nunca lanza. */
export function parsearNotas(notasRaw) {
  if (notasRaw && typeof notasRaw === 'object') return notasRaw;
  if (typeof notasRaw !== 'string' || !notasRaw.trim()) return {};
  try {
    const j = JSON.parse(notasRaw);
    return (j && typeof j === 'object' && !Array.isArray(j)) ? j : {};
  } catch { return {}; }
}

/** ¿`notas` trae datos estructurados (y no solo una nota suelta)? */
export function tieneEstructura(notasRaw) {
  const j = parsearNotas(notasRaw);
  return Object.keys(j).some(k => k !== 'nota');
}

/**
 * Lo que una persona escribió, y lo ÚNICO que el formulario debe dejar editar.
 *
 * Si `notas` no era JSON (comprobantes viejos cargados a mano), el texto entero
 * ES la nota: no se pierde.
 */
export function notaHumana(notasRaw) {
  if (notasRaw == null) return '';
  if (typeof notasRaw === 'object') {
    return typeof notasRaw.nota === 'string' ? notasRaw.nota : '';
  }
  if (typeof notasRaw !== 'string') return '';
  const txt = notasRaw.trim();
  if (!txt) return '';
  // ¿Es un objeto JSON? Entonces la nota es su clave `nota`, y nada más.
  try {
    const j = JSON.parse(txt);
    if (j && typeof j === 'object' && !Array.isArray(j)) {
      return typeof j.nota === 'string' ? j.nota : '';
    }
  } catch { /* no es JSON */ }
  // Comprobante viejo cargado a mano: el texto entero ES la nota. No se pierde.
  return notasRaw;
}

/**
 * Escribe la nota humana CONSERVANDO todo lo demás.
 *
 * Es la función que evita la pérdida de datos: el formulario nunca vuelve a
 * mandar el JSON entero, solo el texto, y acá se vuelve a pegar encima del
 * payload que ya estaba.
 *
 * @returns el string que va a `accounting_movements.notas`, o null si queda vacío.
 */
export function fusionarNota(notasRaw, textoNuevo) {
  const j = { ...parsearNotas(notasRaw) };
  const txt = typeof textoNuevo === 'string' ? textoNuevo.trim() : '';
  if (txt) j.nota = txt; else delete j.nota;
  // Comprobante viejo sin estructura y sin nota: no dejamos un "{}" inútil.
  if (Object.keys(j).length === 0) return null;
  return JSON.stringify(j);
}

/**
 * Qué trae el payload, en una línea legible, para mostrarla DEBAJO del campo.
 *
 * Sin esto el usuario no tiene forma de saber que el comprobante carga datos
 * que no está viendo — y esa ceguera es la que hacía que tocar el textarea
 * pareciera inofensivo.
 *
 * @returns string vacío si no hay nada estructurado que anunciar.
 */
export function resumenEstructurado(notasRaw) {
  const j = parsearNotas(notasRaw);
  const partes = [];
  if (Array.isArray(j.items_factura) && j.items_factura.length) {
    partes.push(`${j.items_factura.length} ítem(s) de la factura`);
  }
  if (j.igv != null || j.subtotal != null) partes.push('desglose de IGV');
  if (j.intercompany_auto) partes.push('espejo automático entre empresas');
  else if (j.intercompany_mirror_of) partes.push('vínculo con su contraparte');
  if (j.oc_vinculada) partes.push('orden de compra vinculada');
  if (Array.isArray(j.materiales_creados) && j.materiales_creados.length) {
    partes.push(`${j.materiales_creados.length} material(es) creado(s)`);
  }
  if (j.captura_magica) partes.push('lectura de Captura Mágica');
  if (!partes.length) return '';
  return `Este comprobante guarda ${partes.join(', ')}. Se conserva al guardar: no hace falta tocarlo.`;
}
