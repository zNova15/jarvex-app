// Sugerencia por IA del insumo PRESUPUESTADO que corresponde a un ítem COMPRADO.
// Resuelve los nombres distintos del mismo insumo entre factura y expediente técnico.
// Reusa el endpoint /api/sugerir-cuenta-pcge con action:'sugerir_insumo' (límite 12 funciones).
import { apiFetch } from './api-client.js';

const CACHE_KEY = 'jx_insumo_match_v1';
const TTL = 24 * 60 * 60 * 1000; // 24h
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; } }
function writeCache(c) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch {} }

// payload: { itemName, insumos: [{codigo, nombre, unidad}], category?, third_party_name?, obraId? }
// Devuelve: { result: { coincidencias: [{codigo, confianza, razon}] }, razonamiento, _cached? }
export async function sugerirInsumoMatch(payload) {
  const itemName = payload?.itemName || '';
  const insumos = Array.isArray(payload?.insumos) ? payload.insumos : [];
  if (!itemName || !insumos.length) return { result: { coincidencias: [] }, razonamiento: '' };

  // Cache por (obra | ítem): los insumos del presupuesto de una obra son estables.
  const key = `${payload.obraId || ''}::${norm(itemName)}`;
  const cache = readCache();
  const hit = cache[key];
  if (hit && (Date.now() - hit.t) < TTL) return { ...hit.v, _cached: true };

  const resp = await apiFetch('/api/sugerir-cuenta-pcge', {
    method: 'POST', timeout: 35000, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'sugerir_insumo',
      itemName,
      category: payload.category || '',
      third_party_name: payload.third_party_name || '',
      insumos: insumos.slice(0, 60).map(x => ({ codigo: String(x.codigo), nombre: String(x.nombre || ''), unidad: x.unidad || '', enEjecucion: !!x.enEjecucion })),
    }),
  });
  if (!resp.ok) { let e; try { e = await resp.json(); } catch {} throw new Error(e?.error || `HTTP ${resp.status}`); }
  const v = await resp.json();

  cache[key] = { t: Date.now(), v };
  const keys = Object.keys(cache);
  if (keys.length > 150) { keys.sort((a, b) => (cache[a].t || 0) - (cache[b].t || 0)); for (const k of keys.slice(0, keys.length - 150)) delete cache[k]; }
  writeCache(cache);
  return v;
}
