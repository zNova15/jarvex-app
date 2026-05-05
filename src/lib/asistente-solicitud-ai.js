// Wrapper para /api/asistente-solicitud-mat — convierte una descripción
// libre del residente en una solicitud de materiales estructurada usando
// Claude Sonnet, matchando contra el catálogo de la obra activa.

const TIMEOUT_MS = 90 * 1000;  // Sonnet con catálogos grandes puede tardar

/**
 * Llama al asistente IA de Solicitud de Materiales.
 * @param {object} payload {descripcion, materiales_obra, historico_solicitudes?, partidas_obra?, proveedores?, fecha_actual?, nombre_obra?}
 * @returns {Promise<{result: {items, descripcion_estructurada, fecha_necesidad_sugerida, prioridad_sugerida}, confianza, razonamiento, advertencias}>}
 */
export async function asistenteSolicitudMaterialesAI(payload) {
  if (!payload?.descripcion || String(payload.descripcion).trim().length < 5) {
    throw new Error('Descripción muy corta (mín 5 caracteres)');
  }
  if (!Array.isArray(payload.materiales_obra)) {
    throw new Error('Falta el catálogo de materiales de la obra');
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Sin conexión — el asistente IA requiere internet');
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  let resp;
  try {
    resp = await fetch('/api/asistente-solicitud-mat', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    clearTimeout(timer);
    if (e?.name === 'AbortError') throw new Error('El asistente tardó demasiado en responder');
    throw new Error('No se pudo consultar al asistente: ' + (e?.message || e));
  }
  clearTimeout(timer);

  if (!resp.ok) {
    let body = null;
    try { body = await resp.json(); } catch {}
    const msg = body?.error || `Asistente falló (${resp.status})`;
    if (resp.status === 429) throw new Error('Cuota IA agotada o rate limit — esperá 1 min');
    if (resp.status === 503) throw new Error('Asistente IA no disponible — verificá ANTHROPIC_API_KEY en Vercel');
    if (resp.status === 504) throw new Error('Asistente tardó demasiado — descripción muy larga');
    throw new Error(msg);
  }

  const data = await resp.json();
  if (!data?.result?.items) {
    throw new Error('Respuesta inválida del asistente (sin items)');
  }
  return data;
}
