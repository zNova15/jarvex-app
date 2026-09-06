// ═══════════════════════════════════════════════════════════════════
// JARVEX — Reimputar un comprobante (cambiarle la vinculación).
//
// EL PEDIDO (Gabriel, 5-sep-2026): «fui a movimientos, puse imputaciones
// cruzadas y quise editarlo para cambiar la vinculación de la obra Miraflores
// a contabilidad neta. Pero no me deja, y por eso mismo no puedo corregirla
// tampoco, y me sigue molestando».
//
// EL BUG, medido contra producción: los 17 comprobantes con imputación cruzada
// tienen TODOS `is_intercompany = true`, y `openEditar()` corta al entrar con
// «se editan desde Operaciones entre empresas». O sea: la app señalaba un
// problema y bloqueaba justo la pantalla que lo arregla. La alerta se volvía
// una molestia permanente, que es exactamente lo que él describió.
//
// 🔴 POR QUÉ REIMPUTAR SÍ ES SEGURO EN UN INTERCOMPANY
// El bloqueo del editor completo tiene razón de ser: una operación interna
// tiene DOS lados que deben moverse juntos, y editarle el monto o la empresa
// de un lado descuadra el par. Pero la VINCULACIÓN no es parte del par:
//
//   1. El Consolidado elimina las operaciones internas cruzando empresa y
//      contraparte (`company_id` / `related_company_id`), NO la obra. Mover un
//      comprobante de una obra a otra no cambia qué se elimina con qué.
//   2. `derivarTypeContable()` fuerza 'cost' cuando `is_intercompany`, y
//      'income' cuando la clase es venta — las dos ANTES de mirar el destino.
//      Así que en un intercompany el destino NO puede mover el `type`, que es
//      lo que el Consolidado necesita estable. Hay un test que lo ata.
//
// Por eso esto es una acción ACOTADA —solo obra y destino— y no el editor
// completo. El editor completo sigue bloqueado para intercompany, como estaba.
//
// Puro: sin React, sin Dexie.
// ═══════════════════════════════════════════════════════════════════

import { derivarTypeContable, DESTINO_A_TYPE } from './clasificacion-contable.js';

/** Destinos que se pueden elegir al reimputar, con su explicación. */
export const DESTINOS_REIMPUTACION = [
  { v: 'obra', label: '🏗 Una obra', ayuda: 'El costo pertenece a un trabajo concreto.' },
  { v: 'gastos_generales', label: '🏢 Gastos Generales', ayuda: 'Gasto de la empresa, no de una obra (oficina, contabilidad, servicios).' },
  { v: 'contabilidad_neta', label: '📄 Contabilidad Neta', ayuda: 'Es un movimiento real de la empresa que no pertenece a ninguna obra del grupo — por ejemplo una venta a un tercero de afuera.' },
  { v: 'sin_clasificar', label: '🤔 Sin clasificar', ayuda: 'A la bandeja de la Contadora Jefe para que ella lo decida.' },
];

/**
 * ¿Qué le falta a esta reimputación para poder guardarse?
 * @returns {string|null} el motivo, o null si es válida.
 */
export function validarReimputacion({ destino_contable, obra_id } = {}) {
  if (!destino_contable) return 'Elegí un destino contable.';
  if (!DESTINOS_REIMPUTACION.some(d => d.v === destino_contable)) return 'Destino contable desconocido.';
  // El destino 'obra' sin obra sería una vinculación que no vincula: la fila
  // diría "es de una obra" y ninguna pantalla de obra la mostraría.
  if (destino_contable === 'obra' && !obra_id) return 'Elegí a qué obra pertenece, o cambiá el destino.';
  return null;
}

/**
 * El parche a guardar. Devuelve SOLO los campos de vinculación (más el `type`
 * recalculado), nunca monto/empresa/fecha — eso es lo que hace segura la
 * acción sobre un intercompany.
 *
 * @param {object} mov  el movimiento actual
 * @param {object} destinoNuevo  { destino_contable, obra_id }
 * @returns {object|null} el parche, o null si no cambia nada
 */
export function cambiosDeReimputacion(mov, { destino_contable, obra_id } = {}) {
  const m = mov || {};
  // Sacarle la obra cuando el destino ya no es 'obra': dejarla puesta haría
  // que la obra siga sumando el comprobante en sus totales aunque la fila diga
  // "contabilidad neta" — el error que veníamos a arreglar, al revés.
  const obraFinal = destino_contable === 'obra' ? (obra_id || null) : null;
  const siguiente = { ...m, destino_contable, obra_id: obraFinal };
  const typeNuevo = derivarTypeContable(siguiente);

  const patch = {};
  if ((m.destino_contable || null) !== destino_contable) patch.destino_contable = destino_contable;
  if ((m.obra_id || null) !== obraFinal) patch.obra_id = obraFinal;
  if (m.type !== typeNuevo) patch.type = typeNuevo;
  return Object.keys(patch).length ? patch : null;
}

/**
 * Explicación de qué va a pasar, para mostrarla ANTES de guardar. La contadora
 * tiene que poder anticipar el efecto sobre los libros, no descubrirlo después.
 */
export function explicarReimputacion(mov, { destino_contable, obra_id } = {}, nombreObra = () => null) {
  const m = mov || {};
  const patch = cambiosDeReimputacion(m, { destino_contable, obra_id });
  if (!patch) return 'No hay cambios: ya está así.';
  const partes = [];
  if ('obra_id' in patch) {
    partes.push(patch.obra_id
      ? `Pasa a la obra «${nombreObra(patch.obra_id) || patch.obra_id}».`
      : `Deja de estar imputado a «${nombreObra(m.obra_id) || 'la obra actual'}» — deja de sumar en los totales de esa obra.`);
  }
  if ('destino_contable' in patch) {
    const d = DESTINOS_REIMPUTACION.find(x => x.v === patch.destino_contable);
    if (d) partes.push(`Destino: ${d.label.replace(/^\S+\s/, '')}. ${d.ayuda}`);
  }
  if ('type' in patch) {
    partes.push(`Su clasificación pasa de ${m.type} a ${patch.type}.`);
  } else if (m.is_intercompany) {
    partes.push('Su clasificación NO cambia: es una operación entre empresas del grupo y esas quedan fijas para que el Consolidado siga cuadrando.');
  }
  return partes.join(' ');
}

export default { DESTINOS_REIMPUTACION, validarReimputacion, cambiosDeReimputacion, explicarReimputacion, DESTINO_A_TYPE };
