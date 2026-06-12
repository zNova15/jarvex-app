// ═══════════════════════════════════════════════════════════════════
// JARVEX — Aplicar nombres reales a las partidas desde un Excel de presupuesto
//
// El consolidado de partidas que se importa como APU trae SOLO las hojas
// (partidas específicas). Los capítulos/títulos (OBRAS PROVISIONALES,
// PLAN MIRAFLORES…) no vienen como fila, así que el árbol los muestra como
// "Capítulo 01", "Capítulo 02"…
//
// El Excel del presupuesto completo (Delphin/S10) SÍ trae los capítulos con
// sus nombres reales. Esta función toma esas partidas parseadas y:
//   1) Actualiza el nombre de las HOJAS existentes cuya descripción difiere.
//   2) CREA las filas de capítulo que faltan (las que son prefijo de alguna
//      hoja), con su nombre real y costo 0 (el árbol agrega el presupuesto
//      desde las hojas — un costo propio lo duplicaría).
//
// Match por código: exacto → normalizado (tolera padding de ceros).
// Reusado por: import APU (auto al cargar Excel de márgenes) y el
// "Comparativo con presupuesto".
// ═══════════════════════════════════════════════════════════════════

import { db, newId } from '../db/jarvex.db';
import { normalizeCodigo } from './match-helpers.js';

/**
 * @param {Object} opts
 * @param {string} opts.obraId
 * @param {Array}  opts.partidasExcel - [{codigo, descripcion}] del Excel
 * @param {string} opts.userId
 * @param {boolean} [opts.soloDistintos=true] - solo tocar nombres que difieren
 * @returns {Promise<{actualizadas:number, creadas:number}>}
 */
export async function aplicarNombresDesdePartidas({ obraId, partidasExcel, userId, soloDistintos = true }) {
  if (!obraId || !Array.isArray(partidasExcel) || !partidasExcel.length) {
    return { actualizadas: 0, creadas: 0 };
  }

  const vivas = await db.partidas.where('obra_id').equals(obraId).filter(p => !p.deleted_at).toArray();
  const porCodigo = new Map(vivas.map(p => [String(p.codigo_delfin || ''), p]));
  // First-wins (mismo tie-break que el comparador de importAPU): si la BD
  // trae duplicados legacy por código normalizado ("01.07" y "1.7" vivas a
  // la vez), Fase 1 (reemplazar) y este renombrado deben tocar la MISMA fila
  // — con new Map(vivas.map(...)) (last-wins) cada fase actualizaba un
  // duplicado distinto. El guard k&& además evita matchear por clave vacía.
  const porCodigoNorm = new Map();
  for (const p of vivas) {
    const k = normalizeCodigo(p.codigo_delfin);
    if (k && !porCodigoNorm.has(k)) porCodigoNorm.set(k, p);
  }

  // Prefijos jerárquicos de las hojas → capítulos que deberían existir.
  const nodeCodeByNorm = new Map();
  for (const p of vivas) {
    const segs = String(p.codigo_delfin || '').split('.').filter(Boolean);
    for (let i = 1; i < segs.length; i++) {
      const pref = segs.slice(0, i).join('.');
      const k = normalizeCodigo(pref);
      if (!nodeCodeByNorm.has(k)) nodeCodeByNorm.set(k, pref);
    }
  }

  const now = new Date().toISOString();
  let actualizadas = 0;
  const aCrear = [];
  const capitulosCreados = new Set(); // evita duplicar capítulos si vienen 2x

  for (const pe of partidasExcel) {
    const desc = String(pe.descripcion || '').trim();
    if (!desc) continue;
    const norm = normalizeCodigo(pe.codigo);
    const existente = porCodigo.get(String(pe.codigo)) || porCodigoNorm.get(norm) || null;

    if (existente) {
      const difiere = (existente.nombre_partida || '').trim().toUpperCase() !== desc.toUpperCase();
      if (!soloDistintos || difiere) {
        await db.partidas.update(existente.id, {
          nombre_partida: desc,
          updated_at: now, updated_by: userId,
          version: (existente.version ?? 0) + 1,
          sync_status: existente.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
        if (difiere) actualizadas++;
      }
      continue;
    }

    // No existe como partida → ¿es un capítulo (prefijo de alguna hoja)?
    const canonico = nodeCodeByNorm.get(norm);
    if (canonico && !capitulosCreados.has(norm)) {
      const segs = String(canonico).split('.').filter(Boolean);
      const id = newId();
      aCrear.push({
        id, obra_id: obraId,
        codigo_delfin: canonico,
        nombre_partida: desc,
        unidad: null,
        metrado_contratado: 0,
        precio_unitario_pres: 0,
        costo_total_presupuestado: 0,
        estado: 'pendiente',
        nivel: segs.length,
        parent_codigo: segs.length > 1 ? segs.slice(0, -1).join('.') : null,
        orden: 0,
        created_by: userId, updated_by: userId,
        created_at: now, updated_at: now,
        version: 1, sync_status: 'pending_create', last_synced_at: null,
        idempotency_key: `${userId}_partidas_${id}`,
      });
      capitulosCreados.add(norm);
    }
  }

  if (aCrear.length) await db.partidas.bulkPut(aCrear);

  return { actualizadas, creadas: aCrear.length };
}
