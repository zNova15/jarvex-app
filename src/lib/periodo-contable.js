// ═══════════════════════════════════════════════════════════════════
// JARVEX — LOS MESES QUE YA SE LE PRESENTARON A SUNAT (18-set-2026).
//
// ── POR QUÉ ───────────────────────────────────────────────────────
// La contadora puede escribir la cuenta y el destino de un asiento. Eso cambia
// el Libro Diario, y el Libro Diario se le presenta a SUNAT por el PLE.
// Corregir un mes ya presentado deja el libro de la empresa diciendo una cosa
// y el que tiene SUNAT diciendo otra — y el que queda mal parado es el que
// declaró. Por eso hace falta SABER cuándo está pasando.
//
// ── 🔴 YA NO BLOQUEA NADA (22-set-2026) ───────────────────────────
// Nació el 18-set como un freno con escape, porque Gabriel dijo entonces:
// «Bloquearlo, pero no por completo, en caso muy raro que se quiera cambiar un
// dato de un comprobante antiguo se podría, PERO NO CREO QUE PASE».
//
// Pasa, y no es raro. Gabriel, 22-set-2026: «quiero que desbloquees el libro
// diario para modificaciones de cualquier fecha, así ya esté presentada. Me
// dijeron las asistentes de contabilidad que eso se utiliza para el anual de
// contabilidad».
//
// El supuesto que estaba mal era «corregir algo viejo es la excepción». El
// cierre anual es exactamente lo contrario: se revisa el ejercicio ENTERO y se
// reclasifica hacia atrás, y el 94 % de los comprobantes (1.697 de 1.806,
// medido el 18-set) es de un mes ya presentado. Un freno que se dispara en el
// 94 % de los casos no protege de nada: enseña a marcar la casilla sin leerla,
// que es peor que no tenerla.
//
// Así que el candado se saca y queda el REGISTRO, que es la parte que siempre
// tuvo el valor: `avisoPeriodoCerrado` sigue diciéndolo en pantalla antes de
// guardar, y `motivoForzado` sigue escribiéndolo en la auditoría. La app
// nunca le prohibió a nadie hacer su trabajo; lo que no deja es hacerlo sin
// que quede escrito, y eso no cambió.
//
// 🔴 NO BORRAR ESTE ARCHIVO. La fecha sigue haciendo falta para tres cosas
// vivas: el aviso de pantalla, el motivo de auditoría y el «cruzó un cierre»
// del costo atrapado en existencias (`existencias-balance.js`), que es lo que
// distingue un inventario normal de una renta pagada de más.
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

// ── LA FECHA VIGENTE (tanda C, 25-set-2026) ─────────────────────────
// El encabezado lo prometía desde el 18-set («sale de `app_config`… se edita
// sin deploy») y no era cierto: NADIE leía la fila. La fecha estaba clavada en
// el 31-jul en las cuatro libs que la usan, y cuando se declare agosto el aviso
// y la auditoría iban a seguir diciendo julio.
//
// Ahora la app la carga al arrancar y en cada sync (`useAuth.js`, junto con el
// resto de `app_config`) y la deja acá. Las funciones la toman como valor por
// defecto, así que ninguna pantalla tiene que acordarse de pasarla; los tests
// y quien quiera otra fecha la siguen pasando explícita.
let cerradoHastaVigente = CERRADO_HASTA_DEFAULT;

/** Fija la fecha que vino de `app_config`. Devuelve false si no es una fecha. */
export function fijarCerradoHasta(valor) {
  const f = String(valor ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return false;
  cerradoHastaVigente = f;
  return true;
}

/** La fecha de cierre vigente: la de `app_config`, o la de por defecto. */
export function cerradoHastaActual() {
  return cerradoHastaVigente;
}

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
export function periodoCerrado(fecha, hasta = cerradoHastaActual()) {
  const f = String(fecha ?? '').slice(0, 10);
  const h = String(hasta ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || !/^\d{4}-\d{2}-\d{2}$/.test(h)) return false;
  return f <= h;
}

/** Lo mismo, pero preguntándoselo al movimiento. */
export const movEnPeriodoCerrado = (movimiento, hasta = cerradoHastaActual()) =>
  periodoCerrado(fechaDe(movimiento), hasta);

/**
 * El texto que ve la contadora antes de guardar. Devuelve null si el período
 * está abierto y no hay nada que advertir.
 *
 * Desde el 22-set-2026 esto AVISA, no frena (ver el encabezado). El botón de
 * guardar queda habilitado igual.
 */
export function avisoPeriodoCerrado(movimiento, hasta = cerradoHastaActual()) {
  if (!movEnPeriodoCerrado(movimiento, hasta)) return null;
  const doc = movimiento?.document_number || 'Este comprobante';
  return `${doc} es del ${fechaDe(movimiento)}, dentro del período ya presentado a SUNAT `
    + `(cerrado hasta el ${hasta}). Cambiarlo deja el Libro Diario de la empresa distinto `
    + 'del que se declaró.';
}

/**
 * El motivo que se guarda en auditoría cuando el cambio toca un mes declarado.
 *
 * Desde que el candado no frena (22-set-2026), ESTA es la única huella que
 * queda de que se modificó un período presentado. Se escribe siempre, sin que
 * nadie tenga que pedirlo, y se concatena aunque venga otro motivo: es el dato
 * que alguien va a buscar dentro de un año.
 */
export function motivoForzado(movimiento, hasta = cerradoHastaActual()) {
  return `Libro Diario · se modifica ${movimiento?.document_number || 'un comprobante'} `
    + `del ${fechaDe(movimiento)}, dentro del período ya presentado (hasta ${hasta})`;
}

export default {
  CLAVE_CONFIG, CERRADO_HASTA_DEFAULT, fechaDe, periodoCerrado,
  movEnPeriodoCerrado, avisoPeriodoCerrado, motivoForzado,
  fijarCerradoHasta, cerradoHastaActual,
};
