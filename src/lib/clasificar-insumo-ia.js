// ═══════════════════════════════════════════════════════════════════
// JARVEX — Clasificación de insumo/servicio CON RAZONAMIENTO de IA (14-sep).
//
// Gabriel: el parecido de palabras solo se equivoca con cosas como "PANTALON
// Y CAMISACO DE DRILL OBRERO AZUL CON CINTA REFLECTIVA" → salía "herramienta
// manual" cuando es EPP clarísimo. Con 700+ descripciones por decidir en la
// primera empresa, un botón que le pida una segunda opinión a una IA (gratis,
// vía OpenRouter — el mismo motor que ya lee las facturas) agiliza la cola
// sin sacar el motor local, que sigue siendo el primero y no usa red.
//
// Reusa /api/sugerir-cuenta-pcge con action:'clasificar_insumo_iupc' — un
// endpoint más multiplexado, no uno nuevo (mismo criterio del repo).
// ═══════════════════════════════════════════════════════════════════
import { apiFetch } from './api-client.js';

// La misma descripción no cambia de significado: cachear 30 días evita
// pagarle a la IA de nuevo por algo ya preguntado (localStorage, por
// dispositivo — no es plata compartida, es solo no repetir el viaje).
const CACHE_KEY = 'jx_clasif_insumo_ia_v1';
const TTL = 30 * 24 * 60 * 60 * 1000;
const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; } }
function writeCache(c) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch {} }

/**
 * candidatos: [{codigo, nombre|label}] — pasale la MISMA lista que ofrece el
 * selector (categoriasParaElegir()): así la IA nunca puede sugerir algo que
 * el desplegable no tiene, y la validación anti-alucinación del server tiene
 * contra qué validar.
 * → { result: {codigo_sugerido, alternativas} | null, confianza, razonamiento, _cached? }
 */
export async function clasificarInsumoConIA({ descripcion, unidad = '', candidatos }) {
  const desc = String(descripcion || '').trim();
  if (!desc || !Array.isArray(candidatos) || !candidatos.length) {
    return { result: null, razonamiento: '' };
  }
  const key = norm(desc);
  const cache = readCache();
  const hit = cache[key];
  if (hit && (Date.now() - hit.t) < TTL) return { ...hit.v, _cached: true };

  const resp = await apiFetch('/api/sugerir-cuenta-pcge', {
    method: 'POST', timeout: 35000, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'clasificar_insumo_iupc',
      descripcion: desc,
      unidad: unidad || '',
      candidatos: candidatos.map(c => ({ codigo: String(c.codigo), nombre: String(c.nombre || c.label || '') })),
    }),
  });
  if (!resp.ok) {
    let e; try { e = await resp.json(); } catch {}
    throw new Error(e?.error || `HTTP ${resp.status}`);
  }
  const v = await resp.json();

  cache[key] = { t: Date.now(), v };
  const keys = Object.keys(cache);
  // Tope generoso: son 700+ descripciones por empresa y varias empresas.
  if (keys.length > 2000) {
    keys.sort((a, b) => (cache[a].t || 0) - (cache[b].t || 0));
    for (const k of keys.slice(0, keys.length - 2000)) delete cache[k];
  }
  writeCache(cache);
  return v;
}
