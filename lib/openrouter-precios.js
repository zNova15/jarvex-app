// ═══════════════════════════════════════════════════════════════════
// JARVEX — LOS PRECIOS DE VERDAD, TRAÍDOS DE OPENROUTER (tanda 19).
//
// «Que salga con sus costes reales», pidió Gabriel. Un precio escrito a mano en
// el código es real el día que se escribe y mentira tres meses después: el
// alias de Mistral se movió solo el 16-jul-2026 y DUPLICÓ el costo del OCR sin
// que nadie se enterara. Así que el número que se muestra sale del catálogo
// público de OpenRouter cada vez que se puede, y los medidos de
// lib/modelos-ia.js quedan de piso para cuando no.
//
// EL FILTRO `?zdr=true` NO ES UN DETALLE. Es el mismo que aplica cada llamada
// real de la app (`provider: { zdr: true }` en lib/openrouter.js): si se
// mostrara el precio sin filtrar, se estaría cotizando un proveedor barato al
// que esta app nunca le va a pedir nada.
//
// El endpoint es PÚBLICO (no lleva API key) y la respuesta se guarda en memoria
// del lambda: abrir la pantalla de configuración diez veces no son diez
// llamadas.
//
// Sin `export default`: vive en /lib para que Vercel no lo cuente como función.
// ═══════════════════════════════════════════════════════════════════

const URL_MODELOS = 'https://openrouter.ai/api/v1/models?zdr=true';
/** Un precio no cambia entre dos clics. Media hora es de sobra. */
export const CACHE_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 6000;

let cache = { en: 0, precios: null };

/** Solo para los tests. */
export function _limpiarCache() { cache = { en: 0, precios: null }; }

/**
 * { 'z-ai/glm-5.3-flash': { entrada: 0.07, salida: 0.233 }, … } en USD por
 * millón de tokens, o `null` si no se pudo consultar.
 *
 * NUNCA lanza: que no se puedan mostrar los precios en vivo no puede impedir
 * configurar la app ni, mucho menos, leer un documento.
 */
export async function preciosEnVivo(ids = [], { fetchImpl = fetch, ahora = Date.now } = {}) {
  const t = ahora();
  if (cache.precios && t - cache.en < CACHE_MS) return cache.precios;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let data = null;
    try {
      const r = await fetchImpl(URL_MODELOS, { signal: ctrl.signal });
      if (!r || !r.ok) return cache.precios;
      data = await r.json();
    } finally { clearTimeout(timer); }
    const lista = Array.isArray(data?.data) ? data.data : [];
    if (!lista.length) return cache.precios;
    const quiero = new Set(ids);
    const precios = {};
    for (const m of lista) {
      if (quiero.size && !quiero.has(m.id)) continue;
      const entrada = Number(m?.pricing?.prompt);
      const salida = Number(m?.pricing?.completion);
      if (!Number.isFinite(entrada) || !Number.isFinite(salida)) continue;
      // OpenRouter cotiza por TOKEN; se muestra por millón, que es como se
      // habla de esto en todos lados.
      precios[m.id] = {
        entrada: Number((entrada * 1e6).toFixed(4)),
        salida: Number((salida * 1e6).toFixed(4)),
      };
    }
    if (!Object.keys(precios).length) return cache.precios;
    cache = { en: t, precios };
    return precios;
  } catch {
    return cache.precios;      // sin red, con los medidos alcanza
  }
}
