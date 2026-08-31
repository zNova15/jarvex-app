// Wrapper para /api/sugerir-cuenta-pcge — sugiere la cuenta PCGE más
// apropiada para un movimiento contable usando Claude Haiku.
//
// Cachea respuestas en localStorage con TTL de 24h por (type, descripcion-clave)
// para evitar llamadas repetidas con la misma descripción y reducir costo.

const CACHE_KEY = 'jx_pcge_suggestions_v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function writeCache(obj) {
  try {
    // Limitar a 200 entries
    const entries = Object.entries(obj).sort((a, b) => (b[1].t || 0) - (a[1].t || 0)).slice(0, 200);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {}
}

function cacheKey({ type, description, category }) {
  // Normalizar para ignorar diferencias triviales (mayúsculas/espacios)
  const norm = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
  return `${type}::${norm(description)}::${norm(category)}`;
}

/**
 * Sugiere la cuenta PCGE para un movimiento contable.
 * @param {object} payload {type, description, category?, third_party_name?, third_party_ruc?, document_type?, sugerencia_actual?}
 * @returns {Promise<{result, confianza, razonamiento, advertencias, _cached?}>}
 */
export async function sugerirCuentaPcge(payload) {
  if (!payload?.type) throw new Error('Falta type (income/cost/expense)');
  if (!payload?.description && !payload?.category) {
    throw new Error('Falta description o category');
  }

  // Cache hit
  const key = cacheKey(payload);
  const cache = readCache();
  const hit = cache[key];
  if (hit && Date.now() - (hit.t || 0) < CACHE_TTL_MS) {
    return { ...hit.v, _cached: true };
  }

  // Llamada al endpoint con auth automática
  const { apiFetch } = await import('./api-client');
  let resp;
  try {
    resp = await apiFetch('/api/sugerir-cuenta-pcge', {
      method: 'POST',
      timeout: 35000,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('La sugerencia de cuenta tardó demasiado');
    throw new Error('No se pudo consultar la sugerencia: ' + (e.message || e));
  }

  if (!resp.ok) {
    let body = null;
    try { body = await resp.json(); } catch {}
    throw new Error(body?.error || `Sugerencia de cuenta falló (${resp.status})`);
  }

  const data = await resp.json();
  if (!data?.result?.cuenta_sugerida) {
    throw new Error('Respuesta inválida del endpoint de sugerencia de cuenta');
  }

  // Guardar en cache
  cache[key] = { v: data, t: Date.now() };
  writeCache(cache);

  return data;
}

/** Limpia el cache (útil después de cambiar la matriz contable, ej. para tests). */
export function clearCuentaPcgeCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch {}
}

// ─────────────────────────────────────────────────────────────
//  COSTO DE OBRA vs GASTO DE LA EMPRESA (pedido de Gabriel, 31-ago-2026)
//  Mismo endpoint (action='clasificar_costo_gasto'; Vercel Hobby está 12/12).
//  La respuesta NUNCA se aplica sola: alimenta el override manual que la
//  contadora confirma (columna clasificacion_manual, mig 163).
// ─────────────────────────────────────────────────────────────

const CACHE_KEY_CG = 'jx_costo_gasto_suggestions_v1';

function readCacheCG() {
  try {
    const raw = localStorage.getItem(CACHE_KEY_CG);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function writeCacheCG(obj) {
  try {
    const entries = Object.entries(obj).sort((a, b) => (b[1].t || 0) - (a[1].t || 0)).slice(0, 200);
    localStorage.setItem(CACHE_KEY_CG, JSON.stringify(Object.fromEntries(entries)));
  } catch {}
}

/**
 * Le pide a la IA si un comprobante de compra es COSTO DE OBRA o GASTO.
 * @param {object} payload {description, category?, third_party_name?, document_type?,
 *                          obra_nombre?, destino_contable?, items?: string[], amount?, currency?}
 * @returns {Promise<{result:{clasificacion:'cost'|'expense'}, confianza:number,
 *                    razonamiento:string, advertencias:string[], _cached?:boolean}>}
 */
export async function sugerirClasificacionContable(payload) {
  const p = payload || {};
  if (!p.description && !p.category && !(p.items || []).length) {
    throw new Error('Falta description, category o items');
  }

  const norm = (v) => String(v || '').toLowerCase().trim().replace(/\s+/g, ' ');
  // El proveedor y la obra cambian el criterio → entran en la clave del cache.
  const key = [norm(p.description), norm(p.category), norm(p.third_party_name), norm(p.obra_nombre)].join('::');
  const cache = readCacheCG();
  const hit = cache[key];
  if (hit && Date.now() - (hit.t || 0) < CACHE_TTL_MS) {
    return { ...hit.v, _cached: true };
  }

  const { apiFetch } = await import('./api-client');
  let resp;
  try {
    resp = await apiFetch('/api/sugerir-cuenta-pcge', {
      method: 'POST',
      timeout: 35000,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...p, action: 'clasificar_costo_gasto' }),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('La sugerencia tardó demasiado');
    throw new Error('No se pudo consultar la sugerencia: ' + (e.message || e));
  }

  if (!resp.ok) {
    let body = null;
    try { body = await resp.json(); } catch {}
    throw new Error(body?.error || `La sugerencia falló (${resp.status})`);
  }

  const data = await resp.json();
  const cl = data?.result?.clasificacion;
  if (cl !== 'cost' && cl !== 'expense') {
    throw new Error('Respuesta inválida del clasificador de costo/gasto');
  }

  cache[key] = { v: data, t: Date.now() };
  writeCacheCG(cache);
  return data;
}

/** Limpia el cache del clasificador costo/gasto. */
export function clearClasificacionCache() {
  try { localStorage.removeItem(CACHE_KEY_CG); } catch {}
}
