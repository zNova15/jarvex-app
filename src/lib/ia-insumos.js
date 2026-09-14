// ═══════════════════════════════════════════════════════════════════
// JARVEX — LAS TRES AYUDAS DE IA DEL PANEL DE INSUMOS (14-sep-2026).
//
// Clasificar · Correlacionar · Mapear. Tres preguntas distintas sobre lo
// mismo, un solo motor: OpenRouter GRATIS (el que ya lee las facturas en
// Captura Mágica). Sin respaldo pago — pedido de Gabriel: si el gratuito no
// responde, se avisa y el botón queda listo para reintentar.
//
// POR QUÉ HACEN FALTA, con los tres casos reales que las pidieron:
//  · CLASIFICAR — "PANTALON Y CAMISACO DE DRILL OBRERO AZUL CON CINTA
//    REFLECTIVA" salía como [37] Herramienta manual. Es EPP: el motor local
//    mira palabras, no significados.
//  · CORRELACIONAR — "REDUCCION 1\" X 1/2" se proponía junto a "REDUCCION
//    2 1/2\" A 1". Escritas se parecen; son dos piezas distintas.
//  · MAPEAR — el mismo fierro escrito como lo escribe el proveedor y como lo
//    escribe el expediente técnico.
//
// Las tres van a /api/sugerir-cuenta-pcge (un endpoint más multiplexado, no
// uno nuevo) y NINGUNA aplica nada sola: devuelven una propuesta con su
// razonamiento y la persona decide.
// ═══════════════════════════════════════════════════════════════════
import { apiFetch } from './api-client.js';

const ENDPOINT = '/api/sugerir-cuenta-pcge';

// La misma pregunta no cambia de respuesta: cachear evita repetir el viaje
// (y la espera) por algo ya preguntado. localStorage, por dispositivo.
const CACHE_KEY = 'jx_ia_insumos_v1';
const TTL = 30 * 24 * 60 * 60 * 1000;
const TOPE_CACHE = 2000;   // 700+ descripciones por empresa, y hay varias

const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; } }
function writeCache(c) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch {} }

function cacheLeer(clave) {
  const c = readCache();
  const hit = c[clave];
  return (hit && (Date.now() - hit.t) < TTL) ? hit.v : null;
}

function cacheGuardar(clave, v) {
  const c = readCache();
  c[clave] = { t: Date.now(), v };
  const keys = Object.keys(c);
  if (keys.length > TOPE_CACHE) {
    keys.sort((a, b) => (c[a].t || 0) - (c[b].t || 0));
    for (const k of keys.slice(0, keys.length - TOPE_CACHE)) delete c[k];
  }
  writeCache(c);
}

async function postIA(payload) {
  const resp = await apiFetch(ENDPOINT, {
    method: 'POST', timeout: 35000, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    let e; try { e = await resp.json(); } catch {}
    throw new Error(e?.error || `HTTP ${resp.status}`);
  }
  return resp.json();
}

// ── 1. CLASIFICAR ─────────────────────────────────────────────────
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
  const clave = `clasif::${norm(desc)}`;
  const hit = cacheLeer(clave);
  if (hit) return { ...hit, _cached: true };

  const v = await postIA({
    action: 'clasificar_insumo_iupc',
    descripcion: desc,
    unidad: unidad || '',
    candidatos: candidatos.map(c => ({ codigo: String(c.codigo), nombre: String(c.nombre || c.label || '') })),
  });
  cacheGuardar(clave, v);
  return v;
}

// ── 2. CORRELACIONAR ──────────────────────────────────────────────
/**
 * variantes: los nombres a comparar — DOS para un par suelto, N para un grupo.
 * → { result: { mismas:[...], fuera:[...], canonico }, confianza, razonamiento }
 * `fuera` siempre es el complemento exacto de `mismas` (lo arma el server).
 */
export async function correlacionarConIA({ variantes }) {
  const lista = [...new Set((variantes || []).map(v => String(v || '').trim()).filter(Boolean))];
  if (lista.length < 2) return { result: null, razonamiento: '' };

  // La pregunta es el CONJUNTO, no el orden en que llegó.
  const clave = `corr::${[...lista].map(norm).sort().join('|')}`;
  const hit = cacheLeer(clave);
  if (hit) return { ...hit, _cached: true };

  const v = await postIA({ action: 'correlacionar_insumos', variantes: lista });
  cacheGuardar(clave, v);
  return v;
}

// ── 3. MAPEAR AL PRESUPUESTO ──────────────────────────────────────
/**
 * candidatos: [{codigo, nombre, unidad, clasificacion}] del presupuesto del
 * trabajo (una preselección — el server los usa como única lista válida).
 * → { result: {codigo_sugerido, alternativas} | null, confianza, razonamiento }
 */
export async function mapearInsumoConIA({ insumo, unidad = '', clasificacion = '', candidatos, obraId = '' }) {
  const nombre = String(insumo || '').trim();
  if (!nombre || !Array.isArray(candidatos) || !candidatos.length) {
    return { result: null, razonamiento: '' };
  }
  // El presupuesto es por obra: la misma pregunta en otra obra es otra pregunta.
  const clave = `mapeo::${obraId || ''}::${norm(nombre)}`;
  const hit = cacheLeer(clave);
  if (hit) return { ...hit, _cached: true };

  const v = await postIA({
    action: 'mapear_insumo_presupuesto',
    insumo: nombre,
    unidad: unidad || '',
    clasificacion: clasificacion || '',
    candidatos: candidatos.slice(0, 60).map(c => ({
      codigo: String(c.codigo),
      nombre: String(c.nombre || ''),
      unidad: c.unidad || '',
      clasificacion: c.clasificacion || '',
    })),
  });
  cacheGuardar(clave, v);
  return v;
}
