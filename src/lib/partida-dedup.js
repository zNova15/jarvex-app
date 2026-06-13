// ═══════════════════════════════════════════════════════════════════
// JARVEX — Deduplicación de PARTIDAS por código normalizado
//
// Importar Delphin son TRES flujos que insertan partidas (presupuesto, Gantt,
// auto-costeo) y cada uno deduplica solo contra su propio snapshot en memoria,
// sin un índice de unicidad compartido. La misma partida "01.01" puede nacer
// como hoja en un flujo y como capítulo en otro (formatos "01.01" vs "1.01",
// que normalizan al mismo código) → quedan 2-3 filas del mismo código, una con
// el desglose de insumos y otras vacías.
//
// Este módulo colapsa esos duplicados: por cada grupo de código normalizado
// elige UN superviviente (el que tiene insumos; si ninguno, el que tiene datos
// de Gantt; si empata, el más antiguo), le fusiona los campos que solo tengan
// las copias, re-apunta los insumos de las copias al superviviente y soft-borra
// las copias (local-first → el SyncEngine propaga los tombstones).
// ═══════════════════════════════════════════════════════════════════

import { normalizeCodigo } from './match-helpers.js';

// Campos de texto/fecha que se fusionan al superviviente si él los tiene vacíos.
const CAMPOS_TEXTO = ['unidad', 'categoria', 'duracion_dias', 'fecha_inicio_planificada', 'fecha_fin_planificada', 'predecesoras'];
// Campos numéricos que se fusionan si el superviviente los tiene en 0/nulo.
const CAMPOS_NUM = ['metrado_contratado', 'precio_unitario_pres', 'costo_total_presupuestado'];

const tieneGantt = (p) => p.duracion_dias != null || !!p.fecha_inicio_planificada || !!p.fecha_fin_planificada;
const vacio = (v) => v == null || v === '';

/**
 * Plan PURO de deduplicación (sin tocar la BD — testeable).
 * @param partidas filas vivas [{id, codigo_delfin, deleted_at?, created_at, version, sync_status, ...campos}]
 * @param insumoCountById { [partidaId]: number } cuántos insumos vivos tiene cada partida
 * @returns [{ survivorId, loserIds:[], merges:{campo:valor} }] solo para grupos con duplicados
 */
export function planDedupePartidas(partidas, insumoCountById = {}) {
  const grupos = new Map(); // ncode → [partida]
  for (const p of partidas || []) {
    if (p.deleted_at) continue;
    const k = normalizeCodigo(p.codigo_delfin);
    if (!k) continue; // sin código no se puede agrupar con seguridad
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(p);
  }

  const plan = [];
  for (const arr of grupos.values()) {
    if (arr.length < 2) continue;
    // Superviviente: más insumos → con Gantt → más antiguo → id estable.
    const ordenadas = [...arr].sort((a, b) => {
      const ia = insumoCountById[a.id] || 0, ib = insumoCountById[b.id] || 0;
      if (ia !== ib) return ib - ia;
      const ga = tieneGantt(a) ? 1 : 0, gb = tieneGantt(b) ? 1 : 0;
      if (ga !== gb) return gb - ga;
      const ca = String(a.created_at || ''), cb = String(b.created_at || '');
      if (ca !== cb) return ca < cb ? -1 : 1;
      return String(a.id).localeCompare(String(b.id));
    });
    const survivor = ordenadas[0];
    const losers = ordenadas.slice(1);

    const merges = {};
    for (const f of CAMPOS_TEXTO) {
      if (vacio(survivor[f])) {
        const v = losers.map(l => l[f]).find(x => !vacio(x));
        if (v != null) merges[f] = v;
      }
    }
    for (const f of CAMPOS_NUM) {
      if (!(Number(survivor[f]) > 0)) {
        const v = losers.map(l => Number(l[f])).find(x => x > 0);
        if (v != null) merges[f] = v;
      }
    }
    plan.push({ survivorId: survivor.id, loserIds: losers.map(l => l.id), merges });
  }
  return plan;
}

/**
 * Aplica el plan sobre Dexie (local-first). Re-apunta insumos de las copias al
 * superviviente y soft-borra las copias (pending_delete; hard-delete si nunca
 * sincronizaron). Devuelve conteos. Idempotente: si no hay duplicados, no-op.
 */
export async function dedupePartidasLocal(db, obraId, userId) {
  if (!db || !obraId) return { grupos: 0, borradas: 0, insumosReapuntados: 0 };
  const partidas = await db.partidas.where('obra_id').equals(obraId).filter(p => !p.deleted_at).toArray();
  const counts = {};
  await db.insumos_partida.where('obra_id').equals(obraId).filter(i => !i.deleted_at).each(i => {
    counts[i.partida_id] = (counts[i.partida_id] || 0) + 1;
  });
  const plan = planDedupePartidas(partidas, counts);
  if (!plan.length) return { grupos: 0, borradas: 0, insumosReapuntados: 0 };

  const now = new Date().toISOString();
  let borradas = 0, reap = 0;
  for (const g of plan) {
    if (Object.keys(g.merges).length) {
      const surv = await db.partidas.get(g.survivorId);
      if (surv) {
        await db.partidas.update(g.survivorId, {
          ...g.merges, updated_at: now, updated_by: userId,
          version: (surv.version ?? 0) + 1,
          sync_status: surv.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
      }
    }
    // Re-apuntar insumos de las copias al superviviente (los duplicados suelen
    // tener 0, pero por las dudas no se pierde ninguno).
    const insLoser = await db.insumos_partida.where('partida_id').anyOf(g.loserIds).filter(i => !i.deleted_at).toArray();
    for (const ins of insLoser) {
      await db.insumos_partida.update(ins.id, {
        partida_id: g.survivorId, updated_at: now, updated_by: userId,
        version: (ins.version ?? 0) + 1,
        sync_status: ins.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      reap++;
    }
    for (const lid of g.loserIds) {
      const lp = await db.partidas.get(lid);
      if (!lp) continue;
      if (lp.sync_status === 'pending_create') {
        await db.partidas.delete(lid); // nunca llegó al server → borrado local directo
      } else {
        await db.partidas.update(lid, {
          deleted_at: now, updated_at: now, updated_by: userId,
          version: (lp.version ?? 0) + 1, sync_status: 'pending_delete',
        });
      }
      borradas++;
    }
  }
  // El dedup re-apunta insumos_partida (partida_id de las copias → superviviente),
  // así que también hay que avisar de esa tabla: la Comparativa Presupuestado
  // (jx-gestion.jsx) solo refresca con tabla 'insumos_partida'. Sin esto, el
  // botón "Reparar partidas duplicadas" del admin no refresca esa vista (los
  // flujos de import ya disparan 'insumos_partida' aparte y lo enmascaraban).
  try {
    window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'partidas' } }));
    window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'insumos_partida' } }));
  } catch {}
  return { grupos: plan.length, borradas, insumosReapuntados: reap };
}
