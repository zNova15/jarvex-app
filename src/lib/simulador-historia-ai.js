// ═══════════════════════════════════════════════════════════════════
// JARVEX — CLIENTE: que la IA elija y cuente la historia del cronograma
// del simulador de órdenes (ronda 3, tanda 3.4 — doc §15.2 C).
//
// La única pieza con red. Le manda al endpoint lo que arma
// `contextoParaHistoria()` (plata por mes con el Gantt, plazo, lo que
// preocupa) y vuelve con un id del catálogo, sus perillas y el relato — que
// se vuelven a sanear acá con la misma lib que usa el servidor: lo que llega
// por la red no se aplica sin pasar por el catálogo real.
//
// Si la IA no está configurada, falla o tarda, no bloquea nada: la historia
// del sorteo sigue puesta y la pantalla dice por qué no hubo respuesta.
// ═══════════════════════════════════════════════════════════════════
import { apiFetch, apiParse } from './api-client.js';
import { sanearHistoriaIA } from './simulador-historias.js';

const ENDPOINT = '/api/asistente-solicitud';
const TIMEOUT_MS = 30_000;

/**
 * @param contexto  la salida de `contextoParaHistoria()`.
 * @returns {{historia:string, ajustes:Object, relato:string, porQue:string,
 *            model:string|null}|{historia:null, motivo:string}}
 */
export async function elegirHistoriaConIA(contexto = {}) {
  const sinIA = (motivo) => ({ historia: null, motivo });
  if (!Array.isArray(contexto?.meses) || !contexto.meses.length) return sinIA('todavía no está la plata por mes del plan');
  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) return sinIA('sin conexión');

  let resp;
  try {
    resp = await apiFetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'elegir_historia_simulador', contexto }),
      timeout: TIMEOUT_MS,
    });
  } catch (e) {
    return sinIA(e?.name === 'AbortError' ? 'el servidor tardó demasiado' : 'no se pudo conectar con el servidor');
  }

  const data = await apiParse(resp);
  if (resp.status >= 500) return sinIA(`el servidor respondió ${resp.status}`);
  if (!resp.ok || data?.error) return sinIA(data?.error || `el servidor respondió ${resp.status}`);
  if (!data?.result?.historia) return sinIA(data?.motivo || 'la IA no eligió ninguna historia');

  const limpio = sanearHistoriaIA(data.result);
  if (!limpio) return sinIA('la IA eligió una historia que no está en el catálogo');
  return { ...limpio, model: data.model || null };
}
