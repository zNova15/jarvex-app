// ═══════════════════════════════════════════════════════════════════
// JARVEX — EL RECORRIDO COMPLETO CON IA (14-sep-2026).
//
// Gabriel: «agregaste los botones de IA para cada insumo individualmente,
// la idea era que también se tenga un botón que se encargue de dar una
// pasada completa a todos los insumos sin clasificar, lo mismo para
// correlaciones y mapeo». Es el MISMO recorrido para las tres secciones y
// lo único que cambia es qué hace cada `procesarItem`. Por eso vive acá,
// aparte, y cada pantalla solo aporta su lógica de un ítem (la misma que ya
// usa el botón individual).
//
// 🔴 EL RECORRIDO NO DECIDE: RECOMIENDA (corrección del 14-sep, misma tarde).
// La primera versión aplicaba sola todo lo que pasara el umbral. Gabriel:
// «se supone que es una sugerencia con IA, pero veo que lo está aplicando,
// es decir lo categoriza todo automáticamente, la idea no era esa [...] la
// idea era tener la recomendación normal que irá mejorando y para casos
// iniciales la recomendación de IA, de tal manera que simplemente vaya
// pasando y dando un vistazo [...] pero aplicándolo o aceptándolo yo mismo o
// la contadora en jefe».
// Entonces el modo por defecto es 'recomendar': el recorrido DEJA la
// propuesta al lado de cada fila y no toca la base. El modo 'aplicar' sigue
// existiendo («me gustaría que la dejes, por si acaso») pero hay que
// elegirlo a mano en el mismo botón.
//
// DOS RECORRIDOS A LA VEZ («¿puedo lanzar la recomendación de clasificación
// y correlación al mismo tiempo?» — sí). El límite no es de la app sino del
// endpoint: ~60 pedidos por minuto. Si cada recorrido esperara SU propia
// pausa, dos en paralelo irían al doble y empezarían a rebotar. Por eso el
// turno es GLOBAL (`turnoIA`): una sola fila para toda la app, así dos (o
// tres) recorridos se intercalan y entre todos nunca pasan del ritmo.
// ═══════════════════════════════════════════════════════════════════

// El umbral de «confianza alta». Ya NO es el permiso para guardar sin
// mirar —eso solo pasa en el modo 'aplicar', que se elige a mano— sino el
// corte para destacar una recomendación como firme.
export const UMBRAL_BARRIDO_IA = 0.75;

/** La pausa entre dos pedidos a la IA, para toda la app junta. */
export const GAP_IA_MS = 1100;

// ── EL TURNO GLOBAL ───────────────────────────────────────────────
// Una sola cola de promesas: cada quien se encola, espera lo que falte para
// que hayan pasado `gap` ms desde el pedido anterior de CUALQUIER recorrido,
// y sella su propio momento. Sin locks ni timers compartidos.
let ultimoPedido = 0;
let colaDeTurnos = Promise.resolve();

export function turnoIA(gap = GAP_IA_MS) {
  colaDeTurnos = colaDeTurnos.then(async () => {
    const falta = gap - (Date.now() - ultimoPedido);
    if (falta > 0) await new Promise(res => setTimeout(res, falta));
    ultimoPedido = Date.now();
  });
  return colaDeTurnos;
}

/** Solo para los tests: deja la cola como recién arrancada. */
export function _reiniciarTurnoIA() {
  ultimoPedido = 0;
  colaDeTurnos = Promise.resolve();
}

/**
 * Corre `items` uno por uno contra `procesarItem`, respetando el ritmo.
 *
 * `procesarItem(item)` devuelve:
 *   · 'recomendada' — la IA contestó y la propuesta quedó guardada para que
 *     una persona la mire (el modo por defecto).
 *   · 'aplicada'    — se guardó la decisión (solo en modo 'aplicar').
 *   · 'saltada'     — sin respuesta usable, o confianza baja.
 * Si lanza, se cuenta como error y el recorrido SIGUE con el siguiente —
 * uno que falla no puede frenar los 700 que quedan detrás.
 *
 * 🔴 CORTE POR ERRORES SEGUIDOS. Si se cae la red, vence la sesión o el
 * endpoint empieza a rebotar, insistir 700 veces no arregla nada y tapa la
 * causa detrás de un contador de errores gigante. A los `toleranciaErrores`
 * fallos CONSECUTIVOS el recorrido se corta solo (`cortado: true`) y deja el
 * último mensaje a la vista. Un error suelto en el medio no cuenta: el
 * contador se reinicia con el primer ítem que sale bien.
 *
 * `onProgreso(estado)` se llama después de cada ítem con el acumulado.
 * `debeCancelar()` se consulta ANTES de cada ítem — lo ya hecho hasta el
 * momento de cancelar queda, no se deshace nada.
 *
 * `esperarTurno`: si viene, se llama ANTES de cada ítem en vez de dormir
 * después (es `turnoIA`, el ritmo compartido). Sin él se usa la pausa
 * propia — es lo que hacen los tests, que no quieren ritmo compartido.
 */
export async function ejecutarBarridoIA({
  items, procesarItem, onProgreso, debeCancelar,
  pausaMs = GAP_IA_MS, esperarTurno = null, toleranciaErrores = 8,
}) {
  const lista = items || [];
  const estado = {
    total: lista.length, i: 0,
    recomendadas: 0, aplicadas: 0, saltadas: 0, errores: 0,
    cancelado: false, cortado: false, ultimoError: null,
  };
  let seguidos = 0;
  for (let i = 0; i < lista.length; i++) {
    if (debeCancelar?.()) { estado.cancelado = true; break; }
    if (esperarTurno) await esperarTurno();
    if (debeCancelar?.()) { estado.cancelado = true; break; }
    try {
      const r = await procesarItem(lista[i]);
      if (r === 'aplicada') estado.aplicadas++;
      else if (r === 'recomendada') estado.recomendadas++;
      else estado.saltadas++;
      seguidos = 0;
    } catch (e) {
      estado.errores++;
      seguidos++;
      estado.ultimoError = e?.message || String(e);
      console.warn('[barrido-ia] un ítem falló, sigue con el siguiente:', estado.ultimoError);
    }
    estado.i = i + 1;
    onProgreso?.({ ...estado });
    if (seguidos >= toleranciaErrores) {
      estado.cortado = true;
      console.warn(`[barrido-ia] cortado: ${seguidos} errores seguidos.`);
      break;
    }
    if (!esperarTurno && i < lista.length - 1 && pausaMs > 0) {
      await new Promise(res => setTimeout(res, pausaMs));
    }
  }
  return estado;
}
