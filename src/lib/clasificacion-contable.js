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
//    NIVEL 2 (se DERIVA de la vinculación; se puede AJUSTAR a mano)
//        egreso vinculado a una OBRA            → 'cost'    (costo de obra)
//        egreso a GASTOS GENERALES de la empresa → 'expense' (gasto)
//        egreso a contabilidad neta / sin clasificar / sin destino → 'cost'
//        ingreso                                 → 'income'
//
//    Override manual (`clasificacion_manual`, mig 163): la contadora puede
//    forzar costo o gasto sin tocar la vinculación — para los casos que la
//    vinculación no puede expresar (una compra DE OBRA que igual es un gasto
//    administrativo). Vale para el egreso; en intercompany se ignora.
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

/**
 * El selector "Destino de la factura" de Captura Mágica usa valores
 * especiales para las opciones sin obra. Traducirlos al `destino_contable`
 * real vivía SUELTO dentro del handler de confirmación; extraerlo acá evita
 * que la sugerencia de costo/gasto (que necesita el mismo mapeo para saber qué
 * type produciría la elección) se desincronice de lo que se termina guardando.
 *
 * @param {string} valor  el value del <select>
 * @param {(id:string)=>boolean} obraExiste  para no vincular a una obra borrada
 * @returns {{destino_contable:string, obra_id:string}}
 */
export function destinoDesdeSelector(valor, obraExiste = () => true) {
  const dest = valor ?? '';
  if (dest === '__empresa__') return { destino_contable: 'gastos_generales', obra_id: '' };
  if (dest === '__otros__')   return { destino_contable: 'contabilidad_neta', obra_id: '' };
  if (dest === '__nose__')    return { destino_contable: 'sin_clasificar', obra_id: '' };
  const valida = !!dest && obraExiste(dest);
  if (valida) return { destino_contable: 'obra', obra_id: dest };
  // Una obra elegida que ya no existe cae a contabilidad neta, no a "obra"
  // sin obra — eso sería una vinculación que no vincula.
  return { destino_contable: dest ? 'contabilidad_neta' : 'obra', obra_id: '' };
}

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
 * Override manual válido de un movimiento (columna `clasificacion_manual`,
 * mig 163), o null. La contadora la usa para los casos que la vinculación no
 * puede expresar: una compra DE OBRA que igual es un gasto administrativo
 * (útiles de oficina de la obra, comida de una reunión). Antes la única forma
 * de marcarla gasto era desvincularla de la obra — y se perdía la atribución.
 */
export function overrideManual(mov) {
  const v = mov?.clasificacion_manual;
  return (v === 'cost' || v === 'expense') ? v : null;
}

/**
 * NIVEL 2: valor definitivo de la columna `type`.
 * Es LA función que deben usar todos los puntos que crean o reclasifican un
 * accounting_movement — así el select de arriba y la vinculación no pueden
 * quedar contradictorios.
 *
 * Orden de precedencia:
 *   1. clase = venta                → 'income'  (no hay costo/gasto que elegir)
 *   2. is_intercompany              → 'cost'    (REGLA DURA, ver cabecera)
 *   3. clasificacion_manual         → lo que dijo la contadora
 *   4. destino_contable / obra_id   → DESTINO_A_TYPE
 *
 * @param {object} mov  { clase, type, destino_contable, obra_id, is_intercompany, clasificacion_manual }
 * @returns {'income'|'cost'|'expense'}
 */
export function derivarTypeContable(mov) {
  const m = mov || {};
  if (nivelUno(m) === INGRESO) return 'income';
  // REGLA DURA: operación interna del grupo → siempre costo, incluso con
  // override manual (si no, el Consolidado deja de cuadrar).
  if (m.is_intercompany === true) return 'cost';
  const manual = overrideManual(m);
  if (manual) return manual;
  const destino = destinoEfectivo(m);
  return DESTINO_A_TYPE[destino] || 'cost';
}

/**
 * ¿El override manual está haciendo algo, o coincide con lo que la vinculación
 * habría dicho igual? Sirve para mostrar el badge "manual" solo cuando importa.
 */
export function overrideEfectivo(mov) {
  const manual = overrideManual(mov);
  if (!manual) return false;
  if (nivelUno(mov) === INGRESO) return false;
  if (mov?.is_intercompany === true) return false;   // la regla dura lo ignora
  return manual !== (DESTINO_A_TYPE[destinoEfectivo(mov)] || 'cost');
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
    const extra = overrideManual(m)
      ? ' (el ajuste manual NO se aplica en operaciones internas).'
      : '.';
    return 'Operación entre empresas del grupo → siempre COSTO (el Consolidado las elimina de a pares; marcarla gasto rompería la eliminación)' + extra;
  }
  const manual = overrideManual(m);
  if (manual) {
    const auto = DESTINO_A_TYPE[destinoEfectivo(m)] || 'cost';
    return manual === auto
      ? `Ajustado a mano como ${manual === 'expense' ? 'GASTO' : 'COSTO'} — coincide con lo que decía la vinculación.`
      : `Ajustado a mano como ${manual === 'expense' ? 'GASTO' : 'COSTO'} (por la vinculación habría sido ${auto === 'expense' ? 'GASTO' : 'COSTO'}). Volvé a "Automático" para que mande la vinculación.`;
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
  destinoEfectivo, nivelUno, derivarTypeContable, motivoClasificacion, typeIncoherente, destinoDesdeSelector,
  overrideManual, overrideEfectivo,
};
