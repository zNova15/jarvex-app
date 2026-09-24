// ═══════════════════════════════════════════════════════════════════
// JARVEX — CLIENTE: pedirle a la IA que elija uno de los tres enfoques del
// simulador de órdenes (ronda 2, tanda 2.6, OPCIONAL — 24-set-2026).
//
// `simulador-sorteo.js` es puro y YA corrió los tres enfoques con el motor
// real. Este archivo es la única pieza con red: le manda al endpoint los
// TRES RESÚMENES ya calculados (nunca el presupuesto ni el cronograma) y
// vuelve con cuál recomienda y por qué. Si la IA no está configurada, falla o
// tarda, no bloquea nada — la pantalla ya tenía los tres enfoques antes de
// pedir esto, y sigue teniéndolos igual.
// ═══════════════════════════════════════════════════════════════════
import { apiFetch, apiParse } from './api-client.js';

const ENDPOINT = '/api/asistente-solicitud';
const TIMEOUT_MS = 25_000;

/** Lo mínimo que necesita el endpoint de cada enfoque: nunca las líneas. */
const resumenDeEnfoque = (c) => ({
  id: c.id,
  nombre: c.nombre,
  resumenTexto: c.resumenTexto,
  resumen: {
    ordenes: c.corrida?.propuestas?.length ?? null,
    cobertura: c.corrida?.resumen?.cobertura ?? null,
    montoPropuesto: c.corrida?.resumen?.montoPropuesto ?? null,
  },
});

/**
 * @param enfoques   la salida de `sortearEnfoques()` (los 3 candidatos).
 * @param contexto   {obra_nombre, plazo_fin, mesesRestantes, montoComprable,
 *                    categoriasActivas, lineasTramoLargo, almacenModo}
 * @returns {{recomendado:string|null, explicacion:string, riesgo:string,
 *            model:string|null, motivo?:string}}
 */
export async function recomendarEnfoque(enfoques = [], contexto = {}) {
  const sinIA = (motivo) => ({ recomendado: null, explicacion: '', riesgo: '', model: null, motivo });
  if (!enfoques.length) return sinIA('no hay enfoques calculados');
  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
    return sinIA('sin conexión');
  }

  let resp;
  try {
    resp = await apiFetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'recomendar_enfoque_simulador',
        candidatos: enfoques.map(resumenDeEnfoque),
        contexto,
      }),
      timeout: TIMEOUT_MS,
    });
  } catch (e) {
    return sinIA(e?.name === 'AbortError' ? 'el servidor tardó demasiado' : 'no se pudo conectar con el servidor');
  }

  const data = await apiParse(resp);
  if (resp.status >= 500) return sinIA(`el servidor respondió ${resp.status}`);
  if (!resp.ok || data?.error) return sinIA(data?.error || `el servidor respondió ${resp.status}`);
  if (!data?.result) return sinIA('el servidor no devolvió un resultado legible');
  if (!data.result.recomendado) return sinIA(data.motivo || 'la IA no pudo recomendar ninguno');

  return { ...data.result, model: data.model || null };
}
