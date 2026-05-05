// ═══════════════════════════════════════════════════════════════════
// JARVEX — Validador pre-SUNAT de comprobantes con IA (Claude Haiku)
// Wrapper liviano sobre el endpoint serverless /api/validar-comprobante-ai.
// Si la IA falla (red, cuota, timeout) lanzamos un Error legible — el
// caller decide si saltar la validación o bloquear la emisión.
// ═══════════════════════════════════════════════════════════════════

const ENDPOINT = '/api/validar-comprobante-ai';
const REQ_TIMEOUT_MS = 15000;

/**
 * Llama al validador IA y devuelve el JSON normalizado.
 * Estructura de la respuesta:
 *   { result: { valid, errors:[{campo,mensaje,severidad}], warnings:[] },
 *     confianza: 0..1, razonamiento, advertencias }
 *
 * Lanza Error con mensaje legible si la red falla, hay timeout, cuota
 * agotada, o la API responde con error. El caller debe atrapar y decidir
 * si continúa sin validación IA (registrando el skip en audit_log).
 */
export async function validarComprobanteAI(comprobante) {
  if (!comprobante || typeof comprobante !== 'object') {
    throw new Error('Comprobante vacío o inválido para validar');
  }
  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
    throw new Error('Sin conexión — no se puede validar con IA');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQ_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comprobante }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('La validación IA tardó demasiado (>15s)');
    throw new Error('No se pudo conectar al validador IA');
  }
  clearTimeout(timer);

  if (!res.ok) {
    let body = null;
    try { body = await res.json(); } catch (_) { /* ignore */ }
    if (res.status === 429) throw new Error('Cuota IA agotada — pedile al admin renovar el plan Anthropic');
    if (res.status === 503) throw new Error(body?.error || 'Validador IA no configurado');
    throw new Error(body?.error || `Validador IA respondió ${res.status}`);
  }

  let data;
  try { data = await res.json(); }
  catch (_) { throw new Error('Respuesta inválida del validador IA'); }

  if (!data || !data.result) throw new Error('Respuesta sin campo "result" del validador IA');
  return data;
}

export default validarComprobanteAI;
