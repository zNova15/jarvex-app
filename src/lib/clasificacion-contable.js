// ─────────────────────────────────────────────────────────────
//  CLASIFICACIÓN CONTABLE DE UN MOVIMIENTO — DOS NIVELES
//
//  Pedido de las contadoras (31-ago-2026). Hasta hoy la columna `type`
//  (income|cost|expense) se elegía a mano en un select y NADIE elegía
//  'expense': Captura Mágica forzaba 'cost' y el formulario manual lo
//  dejaba en 'cost' por defecto → 0 filas 'expense' en producción y el
//  Estado de Resultados mostraba S/0 de gastos con S/264 mil de gastos
//  generales escondidos dentro de "Costos".
//
//  MODELO NUEVO — la contadora decide DOS cosas, no tres:
//
//    NIVEL 1 (lo que se elige arriba, en `clase`)
//        venta  → INGRESO
//        compra → EGRESO
//
//    NIVEL 2 (NO se elige: se DERIVA de la vinculación del movimiento)
//        egreso vinculado a una OBRA            → 'cost'    (costo de obra)
//        egreso a GASTOS GENERALES de la empresa → 'expense' (gasto)
//        egreso a contabilidad neta / sin clasificar / sin destino → 'cost'
//        ingreso                                 → 'income'
//
//  ⚠ REGLA DURA — INTERCOMPANY SIEMPRE 'cost'.
//  El Consolidado (jx-contabilidad, bloque ConsolidadoPage) elimina las
//  operaciones internas del grupo sumando SOLO income+cost del lado
//  is_intercompany. Un movimiento interno marcado 'expense' NO se elimina
//  y tampoco entra en los externos: se evapora de los dos lados y el
//  consolidado deja de cuadrar. Lo mismo vale para el par de
//  facturas-internas.js (byStep.cost). Por eso el intercompany se fuerza a
//  'cost' ANTES de mirar el destino.
//
//  Funciones puras, sin dependencias. Testeadas en
//  __tests__/clasificacion-contable.test.js.
// ─────────────────────────────────────────────────────────────

export const INGRESO = 'ingreso';
export const EGRESO  = 'egreso';

/**
 * Destino contable (columna `destino_contable`, mig 139) → nivel 2 del egreso.
 * Solo 'gastos_generales' es GASTO; el resto es COSTO.
 *
 * `contabilidad_neta` y `sin_clasificar` quedan en 'cost' A PROPÓSITO: son
 * bolsas de "todavía no sabemos" (sin_clasificar cae a la bandeja de la
 * Contadora Jefe) y moverlas a gasto cambiaría S/245 mil de dinero histórico
 * que nadie autorizó. Si las contadoras deciden que 'contabilidad_neta' es
 * gasto, se cambia ACÁ y se corre un backfill equivalente al de las 276.
 */
export const DESTINO_A_TYPE = {
  obra:              'cost',
  gastos_generales:  'expense',
  contabilidad_neta: 'cost',
  sin_clasificar:    'cost',
};

export const TYPE_LABEL  = { income: 'Ingreso', cost: 'Costo', expense: 'Gasto' };
export const NIVEL1_LABEL = { [INGRESO]: 'Ingreso', [EGRESO]: 'Egreso' };

/** Etiqueta larga, para tooltips y ayuda. */
export const TYPE_LABEL_LARGO = {
  income:  'Ingreso',
  cost:    'Costo de obra',
  expense: 'Gasto general de la empresa',
};

/**
 * Destino efectivo de un movimiento. Los movimientos históricos (anteriores a
 * la mig 139) tienen destino_contable NULL y su clasificación era implícita
 * por obra_id — se respeta esa lectura.
 * @returns {'obra'|'gastos_generales'|'contabilidad_neta'|'sin_clasificar'|null}
 */
export function destinoEfectivo(mov) {
  const m = mov || {};
  if (m.destino_contable) return m.destino_contable;
  return m.obra_id ? 'obra' : null;
}

/**
 * NIVEL 1: ¿ingreso o egreso?
 * Manda `clase` (venta/compra). Si viene vacía —22 filas históricas en
 * producción— se cae al `type` que ya tenga la fila (income = ingreso).
 */
export function nivelUno(mov) {
  const m = mov || {};
  const clase = String(m.clase || '').toLowerCase();
  if (clase === 'venta') return INGRESO;
  if (clase === 'compra') return EGRESO;
  return m.type === 'income' ? INGRESO : EGRESO;
}

/**
 * NIVEL 2: valor definitivo de la columna `type`.
 * Es LA función que deben usar todos los puntos que crean o reclasifican un
 * accounting_movement — así el select de arriba y la vinculación no pueden
 * quedar contradictorios.
 *
 * @param {object} mov  { clase, type, destino_contable, obra_id, is_intercompany }
 * @returns {'income'|'cost'|'expense'}
 */
export function derivarTypeContable(mov) {
  const m = mov || {};
  if (nivelUno(m) === INGRESO) return 'income';
  // REGLA DURA: operación interna del grupo → siempre costo (ver cabecera).
  if (m.is_intercompany === true) return 'cost';
  const destino = destinoEfectivo(m);
  return DESTINO_A_TYPE[destino] || 'cost';
}

/**
 * Explicación en lenguaje de contadora de POR QUÉ un movimiento quedó
 * costo o gasto. Se muestra bajo el selector de tipo (Movimientos Contables)
 * para que nadie pelee con un campo que ya no se elige a mano.
 */
export function motivoClasificacion(mov) {
  const m = mov || {};
  const t = derivarTypeContable(m);
  if (t === 'income') return 'Es una VENTA → cuenta como ingreso.';
  if (m.is_intercompany === true) {
    return 'Operación entre empresas del grupo → siempre COSTO (el Consolidado las elimina de a pares; marcarla gasto rompería la eliminación).';
  }
  const destino = destinoEfectivo(m);
  if (destino === 'obra') return 'Vinculado a una OBRA → COSTO de obra.';
  if (destino === 'gastos_generales') return 'Vinculado a GASTOS GENERALES de la empresa → GASTO.';
  if (destino === 'contabilidad_neta') return 'Vinculado a Contabilidad Neta → se trata como COSTO (cambiá la vinculación a Gastos Generales si es un gasto de la empresa).';
  if (destino === 'sin_clasificar') return 'Sin clasificar (bandeja de la Contadora Jefe) → provisionalmente COSTO hasta que se le asigne destino.';
  return 'Sin vinculación → se trata como COSTO. Elegí obra o Gastos Generales para clasificarlo bien.';
}

/**
 * ¿La fila guardada contradice a la derivación? Sirve para auditar datos
 * viejos (y para el before/after del backfill).
 */
export function typeIncoherente(mov) {
  const m = mov || {};
  if (!m.type) return false;
  return m.type !== derivarTypeContable(m);
}

export default {
  INGRESO, EGRESO,
  DESTINO_A_TYPE, TYPE_LABEL, TYPE_LABEL_LARGO, NIVEL1_LABEL,
  destinoEfectivo, nivelUno, derivarTypeContable, motivoClasificacion, typeIncoherente,
};
