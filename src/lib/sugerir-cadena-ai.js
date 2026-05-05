// Wrapper de /api/sugerir-cadena-trazabilidad — Claude Sonnet sugiere
// distribución de precios entre eslabones intercompany.
//
// payload: {
//   precio_compra, precio_objetivo, cantidad, moneda?,
//   eslabones: [{ company_id, name, rol_grupo?, margen_objetivo_pct?, posicion: 'primaria'|'secundaria'|'ejecutora' }],
//   item_nombre?
// }
//
// returns: { result: { pasos[], resumen }, confianza, razonamiento, advertencias }

export async function sugerirCadenaTrazabilidad(payload) {
  if (!navigator.onLine) throw new Error('Necesitás conexión a Internet');
  if (!payload?.precio_compra) throw new Error('Falta precio_compra');
  if (!payload?.precio_objetivo) throw new Error('Falta precio_objetivo');
  if (!Array.isArray(payload?.eslabones) || payload.eslabones.length < 2) {
    throw new Error('Faltan eslabones (mín. 2: primaria + ejecutora)');
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 35000);
  let resp;
  try {
    resp = await fetch('/api/sugerir-cadena-trazabilidad', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('La IA tardó demasiado en responder');
    throw new Error('No se pudo consultar la IA: ' + (e.message || e));
  }
  clearTimeout(timer);

  if (!resp.ok) {
    let body = null;
    try { body = await resp.json(); } catch {}
    if (resp.status === 429) throw new Error('Cuota de IA agotada. Probá más tarde.');
    if (resp.status === 503) throw new Error('ANTHROPIC_API_KEY no configurada en el servidor');
    if (resp.status === 504) throw new Error('La IA tardó demasiado');
    throw new Error(body?.error || `Sugerencia de cadena falló (${resp.status})`);
  }

  const data = await resp.json();
  if (!data?.result?.pasos) throw new Error('Respuesta inválida del endpoint (sin pasos)');
  return data;
}
