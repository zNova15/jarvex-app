// ═══════════════════════════════════════════════════════════════════
// JARVEX — Fusión de personas (Super Admin)
//
// La migración histórica crea personas con nombres referenciales ("Ing
// Elvis") porque así estaban anotadas las salidas en el Excel. Cuando después
// se importa el roster real ("Elvis Ivan Huatay Quiliche", con DNI), quedan
// DOS personas para el mismo humano. La fusión re-atribuye todo lo del que
// SE VA hacia el que QUEDA y borra (soft) al primero.
//
// Modos (eligen qué pasa con los MOVIMIENTOS de ambos):
//   union        → el que queda se lleva TODO (los duplicados exactos —
//                  mismo insumo+fecha+tipo+cantidad — se unifican en 1).
//   interseccion → solo quedan los movimientos que estaban bajo AMBOS
//                  nombres (duplicados exactos); el resto se elimina.
//   solo_destino → solo quedan los movimientos del que QUEDA; los del que
//                  se va se eliminan.
// Los PUNTEROS (asistencia, cuentas bancarias, custodias, frentes, etc.) se
// re-apuntan SIEMPRE al que queda, en cualquier modo.
//
// Todo es soft-delete / update con sync_status para que viaje a Supabase.
// Una fusión es encadenable: el que queda puede volver a fusionarse.
// ═══════════════════════════════════════════════════════════════════

import { db } from '../db/jarvex.db';

// ── Tablas de MOVIMIENTOS (con firma para detectar duplicados exactos) ──
const fBase = (item) => (m) => `${m[item] || ''}|${String(m.fecha || '').slice(0, 10)}|${m.tipo_movimiento || m.accion || ''}|${Number(m.cantidad || 0)}`;
export const TABLAS_MOV = [
  { tabla: 'movimientos_materiales',          campo: 'responsable_id', label: 'Mov. Materiales',   firma: fBase('material_id') },
  { tabla: 'movimientos_herramientas',        campo: 'responsable_id', label: 'Mov. Herramientas', firma: fBase('herramienta_id') },
  { tabla: 'movimientos_epp',                 campo: 'personal_id',    label: 'Mov. EPP',          firma: fBase('epp_id') },
  { tabla: 'movimientos_maquinaria',          campo: 'responsable_id', label: 'Mov. Maquinaria',   firma: fBase('activo_id') },
  { tabla: 'movimientos_insumos_emergencia',  campo: 'responsable_id', label: 'Mov. Emergencia',   firma: fBase('insumo_emergencia_id') },
  { tabla: 'caja_chica_movimientos',          campo: 'responsable_id', label: 'Caja Chica',        firma: (m) => `${String(m.fecha || '').slice(0, 10)}|${m.tipo_movimiento || ''}|${Number(m.monto || 0)}` },
  { tabla: 'asistencia',                      campo: 'personal_id',    label: 'Asistencia',        firma: (m) => String(m.fecha || '').slice(0, 10) },
];

// ── Punteros simples: siempre se re-apuntan al que queda ──
// (best-effort: si la tabla/campo no existe en este Dexie, se salta)
export const TABLAS_PUNTERO = [
  { tabla: 'personal_cuentas_bancarias', campo: 'personal_id',          label: 'Cuentas bancarias' },
  { tabla: 'personal_historial',         campo: 'personal_id',          label: 'Historial' },
  { tabla: 'herramientas',               campo: 'ultimo_responsable_id', label: 'Herramientas en uso' },
  { tabla: 'activos_pesados',            campo: 'asignado_a_id',        label: 'Maquinaria en custodia' },
  { tabla: 'activos_pesados',            campo: 'operador_principal_id', label: 'Operador principal' },
  { tabla: 'frentes_obra',               campo: 'ingeniero_id',         label: 'Frentes a cargo' },
  { tabla: 'horas_maquina',              campo: 'operador_id',          label: 'Horas máquina' },
  { tabla: 'consumos_combustible',       campo: 'operador_id',          label: 'Combustible' },
  { tabla: 'epp_entregas',               campo: 'personal_id',          label: 'Entregas EPP (legacy)' },
  { tabla: 'charlas_seguridad',          campo: 'facilitador_id',       label: 'Charlas (facilitador)' },
  { tabla: 'charla_asistentes',          campo: 'personal_id',          label: 'Charlas (asistente)' },
  { tabla: 'iperc',                      campo: 'responsable_id',       label: 'IPERC' },
  { tabla: 'inspecciones_seguridad',     campo: 'inspector_id',         label: 'Inspecciones' },
  { tabla: 'inspecciones_seguridad',     campo: 'responsable_cierre_id', label: 'Inspecciones (cierre)' },
  { tabla: 'avance_obra',                campo: 'responsable_id',       label: 'Avance de obra' },
  { tabla: 'personal_contrato',          campo: 'personal_id',          label: 'Contratos' },
  { tabla: 'planilla_boletas',           campo: 'personal_id',          label: 'Boletas' },
];

const rowsDe = async (tabla, campo, personalId) => {
  try {
    return (await db[tabla].filter((r) => r[campo] === personalId && !r.deleted_at).toArray());
  } catch { return []; }
};

/** Multiset de firmas (firma → cuántas veces). */
const multiset = (rows, firma) => {
  const m = new Map();
  for (const r of rows) { const k = firma(r); m.set(k, (m.get(k) || 0) + 1); }
  return m;
};

/**
 * Preview de la fusión: por cada tabla de movimientos, cuántos tiene cada uno,
 * cuántos son duplicados exactos, y cuántos quedarían según cada modo.
 */
export async function previewFusion(fromId, toId) {
  const movs = [];
  for (const cfg of TABLAS_MOV) {
    const [a, b] = await Promise.all([rowsDe(cfg.tabla, cfg.campo, fromId), rowsDe(cfg.tabla, cfg.campo, toId)]);
    if (!a.length && !b.length) continue;
    const msB = multiset(b, cfg.firma);
    let dups = 0;
    const visto = new Map();
    for (const r of a) {
      const k = cfg.firma(r);
      const usados = visto.get(k) || 0;
      if (usados < (msB.get(k) || 0)) { dups++; visto.set(k, usados + 1); }
    }
    movs.push({
      ...cfg, deA: a.length, deB: b.length, duplicados: dups,
      union: a.length + b.length - dups,
      interseccion: dups,
      solo_destino: b.length,
    });
  }
  const punteros = [];
  for (const cfg of TABLAS_PUNTERO) {
    const a = await rowsDe(cfg.tabla, cfg.campo, fromId);
    if (a.length) punteros.push({ ...cfg, deA: a.length });
  }
  return { movs, punteros };
}

const bump = (r, extra, userId) => ({
  ...extra,
  updated_at: new Date().toISOString(),
  updated_by: userId || 'offline',
  version: (r.version ?? 0) + 1,
  sync_status: r.sync_status === 'pending_create' ? 'pending_create' : (extra.deleted_at ? 'pending_delete' : 'pending_update'),
});

/**
 * Ejecuta la fusión. `modo` ∈ union | interseccion | solo_destino.
 * Devuelve resumen { reatribuidos, unificados, eliminados, punteros }.
 */
export async function fusionarPersonas({ fromId, toId, modo = 'union', userId = null }) {
  if (!fromId || !toId || fromId === toId) throw new Error('Elegí dos personas distintas');
  const from = await db.personal.get(fromId);
  const to = await db.personal.get(toId);
  if (!from || !to) throw new Error('Persona no encontrada');

  let reatribuidos = 0, unificados = 0, eliminados = 0, punteros = 0;

  for (const cfg of TABLAS_MOV) {
    const [a, b] = await Promise.all([rowsDe(cfg.tabla, cfg.campo, fromId), rowsDe(cfg.tabla, cfg.campo, toId)]);
    if (!a.length && !b.length) continue;
    const msB = multiset(b, cfg.firma);
    const usadosB = new Map();
    const esDup = (r) => {
      const k = cfg.firma(r);
      const u = usadosB.get(k) || 0;
      if (u < (msB.get(k) || 0)) { usadosB.set(k, u + 1); return true; }
      return false;
    };
    const softDel = async (r) => { await db[cfg.tabla].update(r.id, bump(r, { deleted_at: new Date().toISOString() }, userId)); eliminados++; };
    const reapuntar = async (r) => { await db[cfg.tabla].update(r.id, bump(r, { [cfg.campo]: toId }, userId)); reatribuidos++; };

    if (modo === 'union') {
      // A → B; el duplicado exacto se unifica (queda la copia de B).
      for (const r of a) { if (esDup(r)) { await softDel(r); unificados++; eliminados--; } else await reapuntar(r); }
    } else if (modo === 'interseccion') {
      // Queda SOLO lo que estaba bajo ambos nombres (la copia de B).
      for (const r of a) await softDel(r);
      const usadosA = new Map();
      const msAmbos = multiset(a, cfg.firma);
      for (const r of b) {
        const k = cfg.firma(r);
        const u = usadosA.get(k) || 0;
        if (u < Math.min(msAmbos.get(k) || 0, msB.get(k) || 0)) { usadosA.set(k, u + 1); continue; } // se queda
        await softDel(r);
      }
    } else { // solo_destino
      for (const r of a) await softDel(r);
    }
  }

  // Punteros: SIEMPRE al que queda (con dedupe en cuentas bancarias).
  const nombreTo = `${to.nombres} ${to.apellidos || ''}`.trim();
  for (const cfg of TABLAS_PUNTERO) {
    const a = await rowsDe(cfg.tabla, cfg.campo, fromId);
    if (!a.length) continue;
    // Cuentas del que queda: una sola carga (dedupe y principal única).
    const deB = cfg.tabla === 'personal_cuentas_bancarias' ? await rowsDe(cfg.tabla, cfg.campo, toId) : null;
    let yaPrincipal = deB ? deB.some((c) => c.principal) : false;
    for (const r of a) {
      if (cfg.tabla === 'personal_cuentas_bancarias') {
        const dup = deB.find((c) => (r.numero_cuenta && c.numero_cuenta === r.numero_cuenta) || (r.cci && c.cci === r.cci));
        if (dup) { await db[cfg.tabla].update(r.id, bump(r, { deleted_at: new Date().toISOString() }, userId)); continue; }
        await db[cfg.tabla].update(r.id, bump(r, { [cfg.campo]: toId, ...(yaPrincipal && r.principal ? { principal: false } : {}) }, userId));
        if (r.principal && !yaPrincipal) yaPrincipal = true;
      } else if (cfg.tabla === 'activos_pesados' && cfg.campo === 'asignado_a_id') {
        // El nombre denormalizado de la custodia debe seguir al puntero —
        // si no, la máquina seguiría mostrando el nombre eliminado.
        await db[cfg.tabla].update(r.id, bump(r, { [cfg.campo]: toId, asignado_a_nombre: nombreTo }, userId));
      } else {
        await db[cfg.tabla].update(r.id, bump(r, { [cfg.campo]: toId }, userId));
      }
      punteros++;
    }
  }

  // Completar campos VACÍOS del que queda con los del que se va (cargo,
  // contacto, etc.) — datos que solo el placeholder tenía no se pierden.
  const RELLENABLES = ['cargo', 'area', 'telefono', 'email', 'direccion', 'contacto_emergencia',
    'telefono_emergencia', 'regimen_pension', 'fecha_ingreso', 'fecha_nacimiento',
    'subcontratista_id', 'frente_id', 'seguro_a_cargo'];
  const patchTo = {};
  for (const k of RELLENABLES) {
    const vTo = to[k], vFrom = from[k];
    if ((vTo === null || vTo === undefined || vTo === '') && vFrom !== null && vFrom !== undefined && vFrom !== '') patchTo[k] = vFrom;
  }
  // Jefatura de cuadrilla: si el que se va era jefe de SU subcontrato y el
  // que queda termina en ese mismo subcontrato, hereda la jefatura.
  const subFinal = patchTo.subcontratista_id || to.subcontratista_id || null;
  if (from.es_jefe_subcontrato && !to.es_jefe_subcontrato && subFinal && subFinal === from.subcontratista_id) {
    patchTo.es_jefe_subcontrato = true;
  }
  const nota = `Fusión ${new Date().toISOString().slice(0, 10)}: absorbió a "${from.nombres} ${from.apellidos}" (${from.dni || 's/doc'}) · modo ${modo}`;
  patchTo.observaciones = [to.observaciones, nota].filter(Boolean).join(' · ');
  await db.personal.update(toId, bump(to, patchTo, userId));

  // El que se va: soft-delete (sus referencias ya apuntan al que queda).
  await db.personal.update(fromId, bump(from, {
    deleted_at: new Date().toISOString(),
    observaciones: [from.observaciones, `Fusionado en "${to.nombres} ${to.apellidos}" (${to.dni || 's/doc'})`].filter(Boolean).join(' · '),
  }, userId));

  try { await window.__logAudit?.({ action: 'update', table: 'personal', recordId: toId, reason: nota }); } catch {}
  try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'personal' } })); } catch {}
  return { reatribuidos, unificados, eliminados, punteros };
}

/**
 * Sugerencias de fusión: personas con DNI placeholder (MIG-/RES-) o nombre
 * corto cuyos tokens aparecen dentro del nombre completo de otra persona con
 * documento real. "Ing Elvis" → "Elvis Ivan Huatay Quiliche".
 */
export function sugerirFusiones(personal) {
  const vivos = (personal || []).filter((p) => !p.deleted_at);
  const esPlaceholder = (p) => /^(MIG-|RES-)/.test(String(p.dni || '')) || !p.dni;
  const RUIDO = new Set(['ing', 'sr', 'sra', 'don', 'dona', 'tec', 'maestro', 'el', 'la', 'de', 'del']);
  const tokens = (p) => normTxtTokens(`${p.nombres} ${p.apellidos || ''}`).filter((t) => !RUIDO.has(t));
  const out = [];
  const placeholders = vivos.filter(esPlaceholder);
  const reales = vivos.filter((p) => !esPlaceholder(p));
  for (const ph of placeholders) {
    const tks = tokens(ph);
    if (!tks.length) continue;
    let mejor = null;
    for (const r of reales) {
      const rt = new Set(tokens(r));
      const hits = tks.filter((t) => rt.has(t)).length;
      const score = hits / tks.length;
      if (hits >= 1 && score >= 0.5 && (!mejor || score > mejor.score)) mejor = { from: ph, to: r, score };
    }
    if (mejor) out.push(mejor);
  }
  return out.sort((a, b) => b.score - a.score);
}

function normTxtTokens(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zñ ]/g, ' ').split(/\s+/).filter((t) => t.length >= 2);
}
