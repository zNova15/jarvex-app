// Wrapper de /api/analizar-coherencia-cadena
//
// Pregunta a Claude Sonnet si la cadena de trazabilidad tiene sentido
// económico/fiscal: si los rubros de las empresas coinciden con los items
// que pasan por la cadena, si el markup tiene sentido, etc.
//
// Returns: {
//   resultado: 'ok' | 'advertencia' | 'incoherente',
//   confianza: number,
//   resumen: string,
//   hallazgos: [{ severidad, empresa, material, motivo, sugerencia }],
//   advertencias_sunat: [string]
// }

import { apiFetch } from './api-client';

export async function analizarCoherenciaCadena(payload) {
  if (!navigator.onLine) throw new Error('Necesitás conexión a Internet');
  if (!Array.isArray(payload?.eslabones) || payload.eslabones.length < 2) {
    throw new Error('Faltan eslabones (mín. 2)');
  }
  if (!Array.isArray(payload?.items) || payload.items.length === 0) {
    throw new Error('Faltan items en la cadena');
  }

  let resp;
  try {
    resp = await apiFetch('/api/analizar-coherencia-cadena', {
      method: 'POST',
      timeout: 35000,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('La IA tardó demasiado en responder');
    throw new Error('No se pudo consultar la IA: ' + (e.message || e));
  }

  if (!resp.ok) {
    let body = null;
    try { body = await resp.json(); } catch {}
    if (resp.status === 429) throw new Error('Cuota de IA agotada — esperá un momento.');
    if (resp.status === 503) throw new Error('Servicio de IA no configurado en el servidor');
    throw new Error(body?.error || `Análisis falló (${resp.status})`);
  }

  return resp.json();
}
