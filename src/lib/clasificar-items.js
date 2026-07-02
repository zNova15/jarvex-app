// ═══════════════════════════════════════════════════════════════════
// JARVEX — Clasificador de ÍTEMS DE FACTURA (Conciliación → Insumos Comprados)
//
// Dos niveles: categoría principal cerrada (materiales, herramientas,
// maquinaria, epp, insumos_emergencia, gastos_generales, otros) +
// subcategoría corta libre (fierro, tubería, cemento, herramienta manual,
// guantes, alimentación…).
//
// Cómo "aprende": el catálogo `clasificacion_catalogo` (Dexie + Supabase,
// global entre devices) es la memoria. El flujo es catálogo-first:
//   1) descripción normalizada → hit del catálogo (manual > ia) = gratis,
//      instantáneo y estable;
//   2) solo las descripciones DESCONOCIDAS van a la IA
//      (/api/categorize type:'factura', Haiku batch);
//   3) lo que la IA responde se guarda como fuente='ia';
//   4) cada corrección de la contadora se guarda como fuente='manual' y
//      PISA a la IA para siempre → la próxima compra igual se clasifica
//      sola y bien. Así el clasificador mejora con el uso.
// ═══════════════════════════════════════════════════════════════════
import { db, newId, newIdempotencyKey, SYNC_STATUS } from '../db/jarvex.db';
import { apiFetch } from './api-client.js';
import { getCurrentMode } from '../hooks/useAppMode';

export const CATEGORIAS_ITEM = [
  'materiales', 'herramientas', 'maquinaria', 'epp',
  'insumos_emergencia', 'gastos_generales', 'otros',
];
export const CATEGORIA_ITEM_LABEL = {
  materiales: 'Materiales',
  herramientas: 'Herramientas',
  maquinaria: 'Maquinaria',
  epp: 'EPP',
  insumos_emergencia: 'Emergencia',
  gastos_generales: 'Gastos generales',
  otros: 'Otros',
};

export const normDesc = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Normalización canónica de subcategoría (la MISMA en ítem, catálogo y server):
// sin esto el mismo grupo aparecería como "Fierro " y "fierro" y el Excel de la
// contadora jefe agruparía mal.
export const normSubcat = (s) => (String(s || '').trim().toLowerCase().slice(0, 40)) || null;

// Aislamiento de MODO PRUEBA: el catálogo es GLOBAL (sin obra_id), así que las
// filas demo y reales conviven en la misma tabla separadas solo por demo:true.
// TODAS las rutas (lookup, aprendizaje, sugerencias) deben scopear por modo:
// en prueba solo se leen/escriben filas demo (sync 'synced', nunca pushean);
// en real solo filas no-demo. Sin esto, jugar en modo prueba contaminaba el
// catálogo compartido o dejaba correcciones reales atrapadas en filas demo.
const esModoPrueba = () => { try { return getCurrentMode() === 'prueba'; } catch { return false; } };
const filaDelModo = (r, esPrueba) => (esPrueba ? r.demo === true : r.demo !== true);

// Catálogo como Map<desc_normalizada, {categoria, subcategoria, fuente}>.
// Puede haber más de una fila por descripción (aprendida en 2 devices offline):
// la canónica se resuelve acá — 'manual' pisa 'ia'; a igual fuente gana la más
// reciente. (Se itera de menor a mayor prioridad y la última escritura queda.)
export async function cargarCatalogo() {
  let rows = [];
  const esPrueba = esModoPrueba();
  try {
    rows = await db.clasificacion_catalogo.filter(r => !r.deleted_at && filaDelModo(r, esPrueba)).toArray();
  } catch { return new Map(); }
  rows.sort((a, b) =>
    a.fuente !== b.fuente
      ? (a.fuente === 'manual' ? 1 : -1)
      : String(a.updated_at || '').localeCompare(String(b.updated_at || '')));
  const m = new Map();
  for (const r of rows) {
    if (!r.descripcion_normalizada) continue;
    m.set(r.descripcion_normalizada, { categoria: r.categoria, subcategoria: r.subcategoria || null, fuente: r.fuente });
  }
  return m;
}

// Subcategorías ya usadas para una categoría (para el datalist del editor).
export async function subcategoriasDe(categoria) {
  try {
    const esPrueba = esModoPrueba();
    const rows = await db.clasificacion_catalogo
      .where('categoria').equals(categoria)
      .filter(r => !r.deleted_at && !!r.subcategoria && filaDelModo(r, esPrueba)).toArray();
    return [...new Set(rows.map(r => r.subcategoria))].sort();
  } catch { return []; }
}

// Guarda un aprendizaje. 'ia' NUNCA pisa una entrada 'manual'; 'manual' pisa todo.
export async function aprenderClasificacion({ descripcion, categoria, subcategoria, fuente, userId }) {
  const dn = normDesc(descripcion);
  if (!dn || !CATEGORIAS_ITEM.includes(categoria)) return;
  const esPrueba = esModoPrueba();
  // Solo las filas del MODO actual cuentan (demo↔real jamás se mezclan: ni para
  // decidir el target del update ni para el guard "manual manda").
  const existentes = await db.clasificacion_catalogo
    .where('descripcion_normalizada').equals(dn)
    .filter(r => !r.deleted_at && filaDelModo(r, esPrueba)).toArray();
  const manual = existentes.find(r => r.fuente === 'manual');
  if (fuente === 'ia' && manual) return;              // lo corregido a mano manda
  const target = fuente === 'manual'
    ? (manual || existentes[0])
    : existentes.find(r => r.fuente === 'ia');
  const now = new Date().toISOString();
  const sub = normSubcat(subcategoria);
  if (target) {
    if (target.categoria === categoria && (target.subcategoria || null) === sub && target.fuente === fuente) return;
    await db.clasificacion_catalogo.update(target.id, {
      categoria, subcategoria: sub, fuente,
      updated_at: now, updated_by: userId || null,
      version: (target.version ?? 0) + 1,
      // Las filas demo NUNCA entran a la cola de push (quedan 'synced').
      sync_status: esPrueba ? SYNC_STATUS.SYNCED
        : (target.sync_status === SYNC_STATUS.PENDING_CREATE ? SYNC_STATUS.PENDING_CREATE : SYNC_STATUS.PENDING_UPDATE),
    });
  } else {
    await db.clasificacion_catalogo.add({
      id: newId(),
      descripcion_normalizada: dn,
      categoria, subcategoria: sub, fuente,
      created_by: userId || null, updated_by: userId || null,
      created_at: now, updated_at: now,
      version: 1,
      idempotency_key: newIdempotencyKey(userId || 'anon', 'clasificacion_catalogo'),
      ...(esPrueba ? { demo: true, sync_status: SYNC_STATUS.SYNCED } : { sync_status: SYNC_STATUS.PENDING_CREATE }),
    });
  }
}

// Clasifica una lista de descripciones (con duplicados) → Map<desc_norm, entry>.
// Catálogo primero; solo lo desconocido va a la IA (chunks de 100). Lo que la
// IA devuelve se aprende como fuente 'ia'. onProgress(clasificadas, total).
export async function clasificarDescripciones(descripciones, { userId, onProgress } = {}) {
  const catalogo = await cargarCatalogo();
  const resultado = new Map();
  const pendientes = [];
  const vistos = new Set();
  for (const d of descripciones) {
    const dn = normDesc(d);
    if (!dn || vistos.has(dn)) continue;
    vistos.add(dn);
    const hit = catalogo.get(dn);
    if (hit) resultado.set(dn, hit);
    else pendientes.push({ dn, original: String(d).slice(0, 200) });
  }
  const total = vistos.size;
  onProgress?.(resultado.size, total);

  const CHUNK = 100;
  for (let i = 0; i < pendientes.length; i += CHUNK) {
    const chunk = pendientes.slice(i, i + CHUNK);
    const resp = await apiFetch('/api/categorize', {
      method: 'POST', timeout: 65000, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'factura', items: chunk.map((c, j) => ({ id: String(j), nombre: c.original })) }),
    });
    if (!resp.ok) { let e; try { e = await resp.json(); } catch {} throw new Error(e?.error || `HTTP ${resp.status}`); }
    const data = await resp.json();
    for (const r of (data.results || [])) {
      const c = chunk[Number(r.id)];
      if (!c || !CATEGORIAS_ITEM.includes(r.categoria)) continue;
      const entry = { categoria: r.categoria, subcategoria: r.subcategoria || null, fuente: 'ia' };
      resultado.set(c.dn, entry);
      try { await aprenderClasificacion({ descripcion: c.dn, categoria: entry.categoria, subcategoria: entry.subcategoria, fuente: 'ia', userId }); } catch {}
    }
    onProgress?.(resultado.size, total);
  }
  return resultado;
}
