// ═══════════════════════════════════════════════════════════════════
// JARVEX — LOS MESES QUE YA SE LE PRESENTARON A SUNAT (18-set-2026).
//
// ── POR QUÉ ───────────────────────────────────────────────────────
// Desde esta tanda la contadora puede escribir el destino de un asiento. Eso
// cambia el Libro Diario, y el Libro Diario se le presenta a SUNAT por el PLE.
// Corregir en silencio un mes ya presentado deja el libro de la empresa
// diciendo una cosa y el que tiene SUNAT diciendo otra — y el que queda mal
// parado es el que declaró.
//
// Gabriel, 18-set-2026, cuando se le preguntó si había que bloquearlo:
// «Bloquearlo, pero no por completo, en caso muy raro que se quiera cambiar un
// dato de un comprobante antiguo se podría, pero no creo que pase. Hasta el
// momento se tiene presentados varios comprobantes por lo menos hasta el mes
// de julio del 2026.»
//
// Así que no es una pared: es un freno con salida, y la salida deja rastro. Es
// el mismo patrón que la caja sobre el umbral de bancarización (tanda 3.1): la
// app no le prohíbe a nadie hacer lo que tiene que hacer, le prohíbe hacerlo
// sin que quede escrito por qué.
//
// ── CÓMO SE MUEVE LA FECHA ────────────────────────────────────────
// Cada mes que se declara, el cierre avanza. Por eso el valor NO está clavado
// en el código: sale de `app_config` con la clave `periodo_cerrado_hasta`, que
// ya viaja por el sync y se edita sin deploy. La constante de acá es el
// fallback para cuando esa fila todavía no existe.
//
// Funciones puras. Testeadas en __tests__/destino-asiento.test.js.
// ═══════════════════════════════════════════════════════════════════

/** La fila de `app_config` donde vive la fecha de cierre. */
export const CLAVE_CONFIG = 'periodo_cerrado_hasta';

/**
 * Último día ya presentado, mientras nadie cargue la config.
 * Julio 2026, que es lo que Gabriel confirmó el 18-set-2026.
 */
export const CERRADO_HASTA_DEFAULT = '2026-07-31';

/** La fecha del comprobante, en 'YYYY-MM-DD' y sin hora. */
export function fechaDe(movimiento) {
  const m = movimiento || {};
  const cruda = m.date || m.fecha || m.created_at || '';
  return String(cruda).slice(0, 10);
}

/**
 * ¿Esta fecha cae en un período ya presentado?
 *
 * Compara strings 'YYYY-MM-DD', que en ese formato ordenan igual que las
 * fechas. Nada de `new Date()`: en Perú (UTC−5) parsear 'YYYY-MM-DD' devuelve
 * el día anterior, y acá el día importa (regla 7 del CLAUDE.md).
 */
export function periodoCerrado(fecha, hasta = CERRADO_HASTA_DEFAULT) {
  const f = String(fecha ?? '').slice(0, 10);
  const h = String(hasta ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || !/^\d{4}-\d{2}-\d{2}$/.test(h)) return false;
  return f <= h;
}

/** Lo mismo, pero preguntándoselo al movimiento. */
export const movEnPeriodoCerrado = (movimiento, hasta = CERRADO_HASTA_DEFAULT) =>
  periodoCerrado(fechaDe(movimiento), hasta);

/**
 * El texto que ve la contadora antes de forzar el cambio. Devuelve null si el
 * período está abierto y no hay nada que advertir.
 */
export function avisoPeriodoCerrado(movimiento, hasta = CERRADO_HASTA_DEFAULT) {
  if (!movEnPeriodoCerrado(movimiento, hasta)) return null;
  const doc = movimiento?.document_number || 'Este comprobante';
  return `${doc} es del ${fechaDe(movimiento)}, dentro del período ya presentado a SUNAT `
    + `(cerrado hasta el ${hasta}). Cambiarlo deja el Libro Diario de la empresa distinto `
    + 'del que se declaró.';
}

/** El motivo que se guarda en auditoría cuando alguien fuerza el cambio. */
export function motivoForzado(movimiento, hasta = CERRADO_HASTA_DEFAULT) {
  return `Libro Diario · se modifica ${movimiento?.document_number || 'un comprobante'} `
    + `del ${fechaDe(movimiento)}, dentro del período cerrado (hasta ${hasta}), a sabiendas`;
}

export default {
  CLAVE_CONFIG, CERRADO_HASTA_DEFAULT, fechaDe, periodoCerrado,
  movEnPeriodoCerrado, avisoPeriodoCerrado, motivoForzado,
};
