// ═══════════════════════════════════════════════════════════════════
// JARVEX — Importadores de DATASETS del export histórico (round-trip).
//
// Todo lo que la pestaña Exportar produce debe poder re-importarse: caja
// chica, asistencia, mantenimientos, horas máquina y combustible. Los
// parsers (puros) viven en migracion-parser.js; acá están los LOADERS,
// a nivel de módulo para que los usen tanto el wizard de migración
// histórica (jx-migracion-import) como el restore de backup.
//
// Dedupe por CONTENIDO contra todas las filas vivas DEL MISMO MODO (demo
// vs real, igual que filterByMode): el caso típico es re-importar el Excel
// que se acaba de exportar de la misma obra — ninguna fila debe duplicarse.
// Pero un import en modo prueba (demo:true) NO debe bloquear el import
// real posterior del mismo Excel, ni al revés.
// ═══════════════════════════════════════════════════════════════════

import { normTxt } from './migracion-parser.js';
import { getCurrentMode } from './app-mode-core.js';

const hoyISO = () => new Date().toISOString().slice(0, 10);

// isPrueba viene del runner (snapshot al inicio del import) — NO se relee
// acá para que un toggle de modo a mitad de un lote no deje filas mixtas.
async function add(tabla, fields, userId, isPrueba) {
  const db = window.__db;
  const id = window.__newId();
  const now = new Date().toISOString();
  const rec = {
    ...fields,
    id,
    created_by: userId, updated_by: userId,
    created_at: now, updated_at: now,
    version: 1,
    sync_status: isPrueba ? 'synced' : 'pending_create',
    last_synced_at: null,
    idempotency_key: `${userId || 'x'}_${tabla}_${id}`,
    ...(isPrueba ? { demo: true } : {}),
  };
  await db[tabla].add(rec);
  return rec;
}

function fireChanged(...tablas) {
  try {
    for (const t of tablas) window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: t } }));
    window.dispatchEvent(new Event('online'));
  } catch {}
}

// Índice nombre-completo (y alias) → personal.id de la obra.
async function idxPersonal(obraId) {
  const rows = await window.__db.personal.where('obra_id').equals(obraId)
    .filter((p) => !p.deleted_at).toArray();
  const m = new Map();
  for (const p of rows) {
    const k = normTxt(`${p.nombres || ''} ${p.apellidos || ''}`);
    if (k && !m.has(k)) m.set(k, p.id);
    if (p.alias) { const ka = normTxt(p.alias); if (ka && !m.has(ka)) m.set(ka, p.id); }
  }
  return m;
}

// Índice nombre (y placa) → activos_pesados.id (los activos son globales).
async function idxActivos() {
  const rows = await window.__db.activos_pesados.filter((a) => !a.deleted_at).toArray();
  const m = new Map();
  for (const a of rows) {
    const k = normTxt(a.nombre || ''); if (k && !m.has(k)) m.set(k, a.id);
    const kp = normTxt(a.placa || ''); if (kp && !m.has(kp)) m.set(kp, a.id);
  }
  return m;
}

// Multiset de firmas: consumir una coincidencia = la fila ya existe.
function consumir(firmas, key) {
  const c = firmas.get(key) || 0;
  if (c > 0) { firmas.set(key, c - 1); return true; }
  return false;
}

// ── Caja chica ───────────────────────────────────────────────────────
export async function runCajaChicaImport({ obraId, userId, rows, isPrueba = getCurrentMode() === 'prueba' }) {
  const db = window.__db;
  const pers = await idxPersonal(obraId);
  const firmas = new Map();
  const existentes = await db.caja_chica_movimientos.where('obra_id').equals(obraId).toArray();
  for (const r of existentes) {
    if (r.deleted_at || !!r.demo !== !!isPrueba) continue;
    const k = `${r.fecha || ''}__${r.tipo_movimiento || ''}__${Number(r.monto) || 0}__${normTxt(r.concepto || '')}`;
    firmas.set(k, (firmas.get(k) || 0) + 1);
  }
  let ok = 0, duplicados = 0, errores = 0;
  const errorList = [];
  for (const m of rows || []) {
    try {
      if (!m.tipo) throw new Error('Tipo no reconocido (esperaba Ingreso/Gasto)');
      if (!(m.monto > 0)) throw new Error('Monto inválido');
      const fecha = m.fecha || hoyISO();
      if (consumir(firmas, `${fecha}__${m.tipo}__${Number(m.monto) || 0}__${normTxt(m.concepto || '')}`)) { duplicados++; continue; }
      const obsExtra = [];
      let responsable_id = null;
      if (m.responsable) {
        responsable_id = pers.get(normTxt(m.responsable)) || null;
        // "A OBRA" y similares no son personas: quedan anotados, no rompen.
        if (!responsable_id) obsExtra.push(`Responsable: ${m.responsable}`);
      }
      await add('caja_chica_movimientos', {
        obra_id: obraId, fecha, hora: m.hora || null,
        tipo_movimiento: m.tipo, monto: m.monto,
        concepto: m.concepto || null, responsable_id,
        proveedor: m.proveedor || null,
        documento_asociado: m.documento || null,
        observaciones: ['Migración histórica', ...(m.observaciones ? [m.observaciones] : []), ...obsExtra].join(' · '),
      }, userId, isPrueba);
      ok++;
    } catch (e) { errores++; errorList.push({ row: m.idx, error: e.message || String(e) }); }
  }
  fireChanged('caja_chica_movimientos');
  return { ok, errors: errores, errorList, duplicados,
    detalle: `${ok} movimientos de caja cargados${duplicados ? ` · ${duplicados} ya existían (re-subida)` : ''} · ${errores} con error` };
}

// ── Asistencia ───────────────────────────────────────────────────────
export async function runAsistenciaImport({ obraId, userId, rows, isPrueba = getCurrentMode() === 'prueba' }) {
  const db = window.__db;
  const pers = await idxPersonal(obraId);
  // El server tiene UNIQUE(personal_id, fecha): una fila por persona y día.
  const existentes = await db.asistencia.where('obra_id').equals(obraId).toArray();
  const vistos = new Set(existentes.filter((r) => !r.deleted_at && !!r.demo === !!isPrueba).map((r) => `${r.personal_id}__${r.fecha || ''}`));
  let ok = 0, duplicados = 0, errores = 0, sinPersona = 0;
  const errorList = [];
  for (const m of rows || []) {
    try {
      const pid = pers.get(normTxt(m.trabajador || ''));
      if (!pid) { sinPersona++; throw new Error(`"${m.trabajador}" no está en Personal — importá el roster primero o corregí el nombre`); }
      const fecha = m.fecha || hoyISO();
      const k = `${pid}__${fecha}`;
      if (vistos.has(k)) { duplicados++; continue; }
      vistos.add(k);
      await add('asistencia', {
        obra_id: obraId, personal_id: pid, fecha,
        hora_ingreso: m.horaIngreso || null, hora_salida: m.horaSalida || null,
        horas_trabajadas: m.horas ?? null,
        estado_asistencia: m.estado || 'asistio',
        observaciones: m.observaciones || null,
      }, userId, isPrueba);
      ok++;
    } catch (e) { errores++; errorList.push({ row: m.idx, error: e.message || String(e) }); }
  }
  fireChanged('asistencia');
  return { ok, errors: errores, errorList, duplicados, sinPersona,
    detalle: `${ok} asistencias cargadas${duplicados ? ` · ${duplicados} ya existían (persona+día)` : ''}${sinPersona ? ` · ${sinPersona} trabajadores no encontrados` : ''} · ${errores} con error` };
}

// ── Mantenimientos de maquinaria (OJO: la tabla NO tiene obra_id) ────
export async function runMantenimientosImport({ obraId, userId, rows, isPrueba = getCurrentMode() === 'prueba' }) {
  const db = window.__db;
  const acts = await idxActivos();
  const firmas = new Map();
  const existentes = await db.mantenimientos_maquinaria.toArray();
  for (const r of existentes) {
    if (r.deleted_at || !!r.demo !== !!isPrueba) continue;
    // Mismo fallback que la fila entrante (abajo): si costo_total es null con
    // parciales seteados, el export deja la celda vacía y al re-importar se
    // computa repuestos+manoObra — la firma existente debe computar igual.
    const tot = r.costo_total ?? ((Number(r.costo_repuestos) || 0) + (Number(r.costo_mano_obra) || 0));
    const k = `${r.fecha || ''}__${r.activo_id}__${normTxt(r.descripcion || '')}__${Number(tot) || 0}`;
    firmas.set(k, (firmas.get(k) || 0) + 1);
  }
  let ok = 0, duplicados = 0, errores = 0;
  const errorList = [];
  for (const m of rows || []) {
    try {
      const aid = acts.get(normTxt(m.equipo || ''));
      if (!aid) throw new Error(`Equipo "${m.equipo}" no está en Equipos Pesados — crealo primero`);
      const fecha = m.fecha || hoyISO();
      const costoTotal = m.costoTotal ?? ((m.costoRepuestos || 0) + (m.costoManoObra || 0));
      const desc = m.descripcion || '(sin descripción)';
      if (consumir(firmas, `${fecha}__${aid}__${normTxt(desc)}__${Number(costoTotal) || 0}`)) { duplicados++; continue; }
      await add('mantenimientos_maquinaria', {
        activo_id: aid, fecha, tipo: m.tipo || 'preventivo',
        hm_actuales: m.hmActuales ?? null, descripcion: desc,
        costo_repuestos: m.costoRepuestos ?? 0, costo_mano_obra: m.costoManoObra ?? 0,
        costo_total: costoTotal || 0,
        taller: m.taller || null, mecanico: m.mecanico || null,
        duracion_horas: m.duracion ?? null,
        observaciones: m.observaciones || null,
      }, userId, isPrueba);
      ok++;
    } catch (e) { errores++; errorList.push({ row: m.idx, error: e.message || String(e) }); }
  }
  fireChanged('mantenimientos_maquinaria');
  return { ok, errors: errores, errorList, duplicados,
    detalle: `${ok} mantenimientos cargados${duplicados ? ` · ${duplicados} ya existían (re-subida)` : ''} · ${errores} con error` };
}

// ── Horas máquina ────────────────────────────────────────────────────
export async function runHorasMaquinaImport({ obraId, userId, rows, isPrueba = getCurrentMode() === 'prueba' }) {
  const db = window.__db;
  const acts = await idxActivos();
  const pers = await idxPersonal(obraId);
  const firmas = new Map();
  const existentes = await db.horas_maquina.where('obra_id').equals(obraId).toArray();
  for (const r of existentes) {
    if (r.deleted_at || !!r.demo !== !!isPrueba) continue;
    const k = `${r.fecha || ''}__${r.activo_id}__${Number(r.horas_trabajadas) || 0}`;
    firmas.set(k, (firmas.get(k) || 0) + 1);
  }
  let ok = 0, duplicados = 0, errores = 0;
  const errorList = [];
  for (const m of rows || []) {
    try {
      const aid = acts.get(normTxt(m.equipo || ''));
      if (!aid) throw new Error(`Equipo "${m.equipo}" no está en Equipos Pesados — crealo primero`);
      // OJO: null >= 0 es true en JS — sin el check explícito, una fila con
      // "Horas Trabajadas" vacía pasaría y crearía un registro que el server
      // rechaza (horas_trabajadas NOT NULL) → pending_create que nunca sube.
      if (m.horas == null || !(m.horas >= 0)) throw new Error('Horas trabajadas inválidas (la columna "Horas Trabajadas" es obligatoria)');
      const fecha = m.fecha || hoyISO();
      if (consumir(firmas, `${fecha}__${aid}__${Number(m.horas) || 0}`)) { duplicados++; continue; }
      const obsExtra = [];
      let operador_id = null;
      if (m.operador) { operador_id = pers.get(normTxt(m.operador)) || null; if (!operador_id) obsExtra.push(`Operador: ${m.operador}`); }
      await add('horas_maquina', {
        activo_id: aid, obra_id: obraId, partida_id: null, fecha,
        horas_trabajadas: m.horas, hm_inicial: m.hmInicial ?? null, hm_final: m.hmFinal ?? null,
        operador_id, actividad: m.actividad || null,
        observaciones: [...(m.observaciones ? [m.observaciones] : []), ...obsExtra].join(' · ') || null,
      }, userId, isPrueba);
      ok++;
    } catch (e) { errores++; errorList.push({ row: m.idx, error: e.message || String(e) }); }
  }
  fireChanged('horas_maquina');
  return { ok, errors: errores, errorList, duplicados,
    detalle: `${ok} partes de horas cargados${duplicados ? ` · ${duplicados} ya existían (re-subida)` : ''} · ${errores} con error` };
}

// ── Consumos de combustible (Dexie no indexa obra_id: filtrar en memoria) ──
export async function runCombustibleImport({ obraId, userId, rows, isPrueba = getCurrentMode() === 'prueba' }) {
  const db = window.__db;
  const acts = await idxActivos();
  const pers = await idxPersonal(obraId);
  const firmas = new Map();
  const existentes = await db.consumos_combustible.filter((r) => r.obra_id === obraId).toArray();
  for (const r of existentes) {
    if (r.deleted_at || !!r.demo !== !!isPrueba) continue;
    // Mismo fallback que la fila entrante (abajo): si total es null con
    // precio_galon seteado, el export deja la celda vacía y al re-importar se
    // computa galones*precio — la firma existente debe computar igual.
    const tot = r.total ?? (r.precio_galon != null ? Math.round((Number(r.galones) || 0) * r.precio_galon * 100) / 100 : null);
    const k = `${r.fecha || ''}__${r.activo_id}__${Number(r.galones) || 0}__${Number(tot) || 0}`;
    firmas.set(k, (firmas.get(k) || 0) + 1);
  }
  let ok = 0, duplicados = 0, errores = 0;
  const errorList = [];
  for (const m of rows || []) {
    try {
      const aid = acts.get(normTxt(m.equipo || ''));
      if (!aid) throw new Error(`Equipo "${m.equipo}" no está en Equipos Pesados — crealo primero`);
      if (!(m.galones > 0)) throw new Error('Galones inválidos');
      const fecha = m.fecha || hoyISO();
      const total = m.total ?? (m.precioGalon != null ? Math.round(m.galones * m.precioGalon * 100) / 100 : null);
      if (consumir(firmas, `${fecha}__${aid}__${Number(m.galones) || 0}__${Number(total) || 0}`)) { duplicados++; continue; }
      const obsExtra = [];
      let operador_id = null;
      if (m.operador) { operador_id = pers.get(normTxt(m.operador)) || null; if (!operador_id) obsExtra.push(`Operador: ${m.operador}`); }
      await add('consumos_combustible', {
        activo_id: aid, obra_id: obraId, fecha,
        galones: m.galones, precio_galon: m.precioGalon ?? null, total,
        surtidor: m.surtidor || null, operador_id, hm_actuales: m.hmActuales ?? null,
        observaciones: [...(m.observaciones ? [m.observaciones] : []), ...obsExtra].join(' · ') || null,
      }, userId, isPrueba);
      ok++;
    } catch (e) { errores++; errorList.push({ row: m.idx, error: e.message || String(e) }); }
  }
  fireChanged('consumos_combustible');
  return { ok, errors: errores, errorList, duplicados,
    detalle: `${ok} consumos cargados${duplicados ? ` · ${duplicados} ya existían (re-subida)` : ''} · ${errores} con error` };
}
