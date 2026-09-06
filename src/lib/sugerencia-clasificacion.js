// ═══════════════════════════════════════════════════════════════════
// JARVEX — La sugerencia de COSTO vs GASTO, y cuándo vale la pena mostrarla.
//
// EL PEDIDO (Gabriel, 5-sep-2026): «a veces no se llega a hacer bien» la
// clasificación de las compras entre costo y gasto.
//
// ── POR QUÉ NO ALCANZABA LA HERRAMIENTA QUE YA EXISTÍA ────────────
// `sugerirClasificacionContable()` existe desde el 31-ago y funciona. Su
// problema no era la calidad: era que vive en un BOTÓN que hay que acordarse
// de apretar. Medido el 5-sep: **0 de 1.395** movimientos tienen
// `clasificacion_manual`, y el audit log (4.141 filas desde junio) no registra
// una sola pulsación. Una ayuda que hay que ir a buscar no es una ayuda.
//
// ── LA IDEA: NO SUGERIR, CONTRADECIR ──────────────────────────────
// Mostrar «la IA opina COSTO» junto a una vinculación que ya dice costo es
// ruido: confirma lo que la pantalla ya muestra, y a la décima vez nadie lo
// lee. Lo único que aporta información es el DESACUERDO — cuando lo que la
// asistente eligió y lo que el documento parece decir no coinciden.
//
// Por eso esta librería no devuelve «la sugerencia»: devuelve si hay que
// INTERRUMPIR, y con qué texto. En el caso normal (coinciden) no se muestra
// nada más que una marca discreta.
//
// ── Y POR QUÉ IMPORTA, QUE NO ES LO QUE GABRIEL CREÍA ─────────────
// No es un tema de IGV ni de Renta: costo y gasto son AMBOS deducibles, y el
// crédito fiscal depende del comprobante y del destino gravado, no de esta
// etiqueta. Lo que se arruina al equivocarse es INTERNO y no lo avisa nadie:
// una obra que parece menos rentable de lo que es porque carga gastos de
// oficina, y un Estado de Resultados con los gastos escondidos dentro de los
// costos (pasó: S/ 264 mil).
//
// Puro: sin React, sin fetch.
// ═══════════════════════════════════════════════════════════════════

import { derivarTypeContable, TYPE_LABEL_LARGO } from './clasificacion-contable.js';

/** Confianza mínima para molestar a la usuaria. Por debajo, la IA no sabe. */
export const CONFIANZA_MINIMA = 0.6;

/** ¿Tiene sentido pedirle una opinión a la IA sobre este comprobante? */
export function valeLaPenaConsultar(mov) {
  const m = mov || {};
  // Una VENTA no se clasifica en costo/gasto: es ingreso y punto.
  if ((m.clase || (m.type === 'income' ? 'venta' : 'compra')) === 'venta') return false;
  // En una operación interna del grupo el tipo está forzado a 'cost' por la
  // regla del Consolidado: preguntar sería ofrecer algo que no se puede aplicar.
  if (m.is_intercompany === true) return false;
  // Sin nada que leer, la IA adivinaría.
  const hayTexto = !!(m.description || m.category || m.third_party_name
    || (Array.isArray(m.items) && m.items.length));
  return hayTexto;
}

/**
 * Compara lo que la IA dice con lo que la vinculación elegida produce.
 *
 * @param {object} mov  el movimiento tal como está armado en el formulario
 * @param {object} sug  { result:{clasificacion}, confianza, razonamiento }
 * @returns {{
 *   estado: 'coincide'|'contradice'|'sin_confianza'|'no_aplica',
 *   actual: string, sugerido: string|null,
 *   titulo: string, detalle: string,
 *   accion: {destino_contable:string, clasificacion_manual:string}|null
 * }}
 */
export function compararSugerencia(mov, sug) {
  const m = mov || {};
  if (!valeLaPenaConsultar(m) || !sug) {
    return { estado: 'no_aplica', actual: null, sugerido: null, titulo: '', detalle: '', accion: null };
  }
  const actual = derivarTypeContable(m);
  const sugerido = sug?.result?.clasificacion === 'expense' ? 'expense'
    : sug?.result?.clasificacion === 'cost' ? 'cost' : null;
  const confianza = Number(sug?.confianza || 0);
  const razon = String(sug?.razonamiento || '').trim();

  if (!sugerido) {
    return { estado: 'no_aplica', actual, sugerido: null, titulo: '', detalle: '', accion: null };
  }
  if (confianza < CONFIANZA_MINIMA) {
    return {
      estado: 'sin_confianza', actual, sugerido,
      titulo: 'La IA no está segura de si es costo o gasto',
      detalle: razon || 'El concepto es ambiguo — decidilo vos.',
      accion: null,
    };
  }
  if (sugerido === actual) {
    return {
      estado: 'coincide', actual, sugerido,
      titulo: `Coincide: ${TYPE_LABEL_LARGO[actual] || actual}`,
      detalle: razon, accion: null,
    };
  }
  // El desacuerdo: lo único que justifica interrumpir.
  const accion = sugerido === 'expense'
    // Pasar a gasto = sacarlo de la obra y mandarlo a Gastos Generales.
    ? { destino_contable: 'gastos_generales', clasificacion_manual: '' }
    // Pasar a costo sin tocar la obra elegida: override manual.
    : { destino_contable: m.destino_contable || (m.obra_id ? 'obra' : 'sin_clasificar'), clasificacion_manual: 'cost' };

  return {
    estado: 'contradice', actual, sugerido,
    titulo: sugerido === 'expense'
      ? 'Esto parece un GASTO de la empresa, no un costo de la obra'
      : 'Esto parece un COSTO de obra, no un gasto de la empresa',
    detalle: razon || (sugerido === 'expense'
      ? 'El concepto no se consume en la obra.'
      : 'El concepto se consume en la obra.'),
    accion,
  };
}

export default { CONFIANZA_MINIMA, valeLaPenaConsultar, compararSugerencia };
