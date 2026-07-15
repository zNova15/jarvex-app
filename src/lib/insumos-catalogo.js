// ═══════════════════════════════════════════════════════════════════
// JARVEX — Catálogo unificado de insumos para "Solicitud de Insumos".
//
// Un pedido puede tener insumos de 5 tipos (materiales, herramientas, EPPs,
// insumos de emergencia, maquinaria). Cuando el nombre pedido NO existe en la
// tabla REAL de la obra, NO lo creamos ahí (ensuciaría el inventario con
// nombres que quizá nunca se usen): lo guardamos en `insumos_pendientes`, un
// catálogo SEPARADO que además alimenta las RECOMENDACIONES de nombres. Se
// "promueve" al inventario real recién cuando la compra se recibe.
// ═══════════════════════════════════════════════════════════════════
import { db, newId } from '../db/jarvex.db';

// tipo → tabla real + columna de nombre + etiqueta.
export const TIPOS_INSUMO = {
  material:    { tabla: 'materiales',         nombreCol: 'nombre_material',    label: 'Material',      icon: 'package' },
  herramienta: { tabla: 'herramientas',       nombreCol: 'nombre_herramienta', label: 'Herramienta',   icon: 'tool' },
  epp:         { tabla: 'epps',               nombreCol: 'nombre_epp',         label: 'EPP',           icon: 'shield' },
  emergencia:  { tabla: 'insumos_emergencia', nombreCol: 'nombre',             label: 'Emergencia',    icon: 'package' },
  maquinaria:  { tabla: 'activos_pesados',    nombreCol: 'nombre',             label: 'Maquinaria',    icon: 'tool' },
};
export const TIPO_INSUMO_KEYS = Object.keys(TIPOS_INSUMO);

/** minúsculas sin acentos ni espacios extremos (para dedup y match). */
export function normNombre(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Nombre "canónico" de un insumo real según su tipo. */
export function nombreDeInsumo(tipo, row) {
  const col = TIPOS_INSUMO[tipo]?.nombreCol;
  return (col && row?.[col]) || row?.nombre || row?.nombre_material || '';
}

/**
 * Lee el inventario REAL de un tipo para una obra (materiales/herramientas/…).
 * activos_pesados no tiene obra_id (son globales) → no filtra por obra.
 */
export async function leerInventarioReal(tipo, obraId) {
  const meta = TIPOS_INSUMO[tipo];
  if (!meta || !db[meta.tabla]) return [];
  try {
    const all = await db[meta.tabla].filter(x => !x.deleted_at).toArray();
    // maquinaria (activos_pesados) es global; el resto se scopea a la obra.
    const scoped = tipo === 'maquinaria' ? all : all.filter(x => !obraId || x.obra_id === obraId);
    return scoped.map(row => ({
      id: row.id,
      nombre: nombreDeInsumo(tipo, row),
      unidad: row.unidad || (tipo === 'maquinaria' ? 'und' : ''),
      categoria: row.categoria || null,
      stock_actual: row.stock_actual,
      real: true,
    }));
  } catch { return []; }
}

/** Lee los pendientes (catálogo separado) de un tipo para una obra. */
export async function leerPendientes(tipo, obraId) {
  if (!db.insumos_pendientes) return [];
  try {
    const all = await db.insumos_pendientes.filter(x => !x.deleted_at && x.tipo_insumo === tipo).toArray();
    return all
      .filter(x => !obraId || !x.obra_id || x.obra_id === obraId)
      .map(x => ({ id: x.id, nombre: x.nombre, unidad: x.unidad || '', categoria: x.categoria || null, veces: x.veces_solicitado || 1, real: false }));
  } catch { return []; }
}

/**
 * Recomendaciones de nombres para un tipo: inventario real PRIMERO (marcado
 * real:true) + los pendientes ya solicitados (real:false), deduplicados por
 * nombre normalizado. Solo son SUGERENCIAS — el usuario puede tipear cualquier
 * nombre/unidad. Devuelve [{ id, nombre, unidad, real, ... }].
 */
export async function recomendacionesInsumo(tipo, obraId) {
  const [reales, pend] = await Promise.all([leerInventarioReal(tipo, obraId), leerPendientes(tipo, obraId)]);
  const vistos = new Set(reales.map(r => normNombre(r.nombre)));
  const out = [...reales];
  for (const p of pend) {
    const k = normNombre(p.nombre);
    if (k && !vistos.has(k)) { vistos.add(k); out.push(p); }
  }
  return out.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/** Busca un insumo real por nombre exacto (normalizado) en un tipo. */
export async function matchInsumoReal(tipo, nombre, obraId) {
  const n = normNombre(nombre);
  if (!n) return null;
  const reales = await leerInventarioReal(tipo, obraId);
  return reales.find(r => normNombre(r.nombre) === n) || null;
}

/**
 * Registra (o incrementa) un nombre de insumo en el catálogo PENDIENTE.
 * Idempotente por (obra, tipo, nombre_norm): si ya existe suma veces_solicitado
 * y actualiza la unidad. Devuelve el id del pendiente. NO toca el inventario real.
 */
export async function registrarInsumoPendiente({ obraId, tipo, nombre, unidad, categoria, userId = 'offline' }) {
  const nombreLimpio = String(nombre || '').trim();
  const norm = normNombre(nombreLimpio);
  if (!norm) return null;
  const now = new Date().toISOString();
  try {
    const existentes = await db.insumos_pendientes
      .filter(x => !x.deleted_at && x.tipo_insumo === tipo && x.nombre_norm === norm && (!obraId || !x.obra_id || x.obra_id === obraId))
      .toArray();
    if (existentes.length) {
      const ex = existentes[0];
      await db.insumos_pendientes.update(ex.id, {
        veces_solicitado: (Number(ex.veces_solicitado) || 1) + 1,
        unidad: unidad || ex.unidad || null,
        categoria: categoria || ex.categoria || null,
        updated_at: now, updated_by: userId,
        version: (ex.version ?? 0) + 1,
        sync_status: ex.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      return ex.id;
    }
    const id = newId();
    await db.insumos_pendientes.add({
      id, obra_id: obraId || null,
      tipo_insumo: tipo, nombre: nombreLimpio, nombre_norm: norm,
      unidad: unidad || null, categoria: categoria || null,
      veces_solicitado: 1, promovido_a_id: null,
      created_by: userId, updated_by: userId,
      created_at: now, updated_at: now,
      version: 1, sync_status: 'pending_create', last_synced_at: null,
      idempotency_key: `${userId}_inspend_${id}`,
    });
    return id;
  } catch { return null; }
}
