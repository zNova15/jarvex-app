// ═══════════════════════════════════════════════════════════════════
// JARVEX — EL RECORRIDO COMPLETO CON IA (14-sep-2026).
//
// Gabriel: «agregaste los botones de IA para cada insumo individualmente,
// la idea era que también se tenga un botón que se encargue de dar una
// pasada completa a todos los insumos sin clasificar, lo mismo para
// correlaciones y mapeo». Es el MISMO recorrido para las tres secciones —
// una tarea a la vez, con una pausa entre cada una para no pasar el límite
// del endpoint (60 req/min) — y lo único que cambia es qué hace cada
// `procesarItem`. Por eso vive acá, aparte, y cada pantalla solo aporta su
// lógica de un ítem (la misma que ya usa el botón individual).
//
// A diferencia de los botones de a uno (que SIEMPRE muestran la propuesta y
// esperan un clic para aplicarla), el barrido SÍ aplica solo cuando la
// confianza es alta — es la única forma de que 700+ descripciones no se
// despachen de a un click. Lo que queda por debajo del umbral se salta y
// sigue esperando en la lista, para decidirlo a mano o de a una con el botón
// individual.
// ═══════════════════════════════════════════════════════════════════

// Mismo umbral en las tres secciones: 0.75 es más exigente que "alta"
// (≥0.70 en bandaConfianza) porque acá NADIE mira antes de guardar.
export const UMBRAL_BARRIDO_IA = 0.75;

/**
 * Corre `items` uno por uno contra `procesarItem`, con una pausa entre cada
 * uno. `procesarItem(item)` debe devolver 'aplicada' (la IA fue confiable y
 * se guardó la decisión) o 'saltada' (confianza baja, o sin resultado —
 * queda para revisar a mano); si lanza, se cuenta como error y el barrido
 * SIGUE con el siguiente ítem — uno que falla no puede frenar los 700 que
 * quedan detrás.
 *
 * `onProgreso(estado)` se llama después de cada ítem con el conteo
 * acumulado. `debeCancelar()` se consulta ANTES de cada ítem — lo ya
 * aplicado hasta el momento de cancelar queda guardado, no se deshace nada.
 */
export async function ejecutarBarridoIA({ items, procesarItem, onProgreso, debeCancelar, pausaMs = 1100 }) {
  const lista = items || [];
  const estado = { total: lista.length, i: 0, aplicadas: 0, saltadas: 0, errores: 0, cancelado: false };
  for (let i = 0; i < lista.length; i++) {
    if (debeCancelar?.()) { estado.cancelado = true; break; }
    try {
      const r = await procesarItem(lista[i]);
      if (r === 'aplicada') estado.aplicadas++; else estado.saltadas++;
    } catch (e) {
      estado.errores++;
      console.warn('[barrido-ia] un ítem falló, sigue con el siguiente:', e?.message || e);
    }
    estado.i = i + 1;
    onProgreso?.({ ...estado });
    if (i < lista.length - 1 && pausaMs > 0) await new Promise(res => setTimeout(res, pausaMs));
  }
  return estado;
}
