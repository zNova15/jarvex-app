// ═══════════════════════════════════════════════════════════════════
// JARVEX — Migración histórica (SuperAdmin)
//
// Sub-flujo del wizard de Importar. La obra arrancó antes de tener JARVEX,
// así que meses de movimientos quedaron en Excel. Acá se cargan masivamente
// respetando las fechas reales. Solo visible/activo con SuperAdmin ON.
//
// Maneja los 5 formatos (ver migracion-parser.js):
//   • Insumos Totales  → crea Materiales/Herramientas/Maquinaria/EPP (catálogo,
//                        sin stock ni movimientos)
//   • Mov. Materiales  → movimientos con fecha histórica + stock por ubicación
//   • Mov. EPP         → movimientos EPP con fecha histórica
//   • Mov. Herramientas / Maquinaria → requieren unificar el modelo a stock
//                        por cantidad (fase siguiente); por ahora informa.
//
// Local-first: escribe a Dexie con created_at controlado (SuperAdmin permite
// fechas pasadas) y deja que el SyncEngine pushee al server.
// ═══════════════════════════════════════════════════════════════════

import React from "react";
import { getCurrentMode } from "../hooks/useAppMode.js";
import { detectarEPP } from "../lib/epp-utils.js";
import { calcAlerta } from "../lib/stock-utils.js";
import { aplicarDelta } from "../lib/stock-ubicaciones.js";
import { detectarSugerencias, detectarDuplicados, fusionarInsumos } from "../lib/variantes.js";
import {
  detectFormato, FORMATOS,
  parseInsumosTotales, parseInsumosEmergencia, parseMovimientos, parseMovMaquinariaAsignacion, resumenMovimientos,
  normTxt,
} from "../lib/migracion-parser.js";

// Plantillas descargables por formato (headers + 1 fila de ejemplo).
export const TEMPLATES = {
  insumos_emergencia: { headers: ['ID', 'Insumo de Emergencia', 'Categoría', 'Unidad', 'Fecha de creacion'], sample: ['1', 'Botiquín portátil', 'Primeros auxilios', 'kit', '25/05/2026'] },
  mov_materiales:     { headers: ['ID', 'Fecha de Movimiento', 'Material', 'Unidad', 'Cantidad', 'Tipo de Movimiento', 'Proveedor/Almacen de Salida', 'Resposable (Salida)', 'Lugar llega / Frente'], sample: ['1', '21/05/2026', 'Yeso 7kg', 'Bolsa', '20', 'Ingreso', 'Ferretería X', '', 'Almacen Central'] },
  mov_epp:            { headers: ['ID', 'Fecha de Movimiento', 'EPP', 'Unidad', 'Cantidad', 'Tipo de Movimiento', 'Proveedor/Responsable', 'Lugar de llegada'], sample: ['1', '21/05/2026', 'Casco Blanco', 'Unidad', '20', 'Ingreso', '', 'Almacen Central'] },
  mov_herramientas:   { headers: ['ID', 'Fecha de Movimiento', 'Herramientas', 'Estado', 'Cantidad', 'Tipo de Movimiento', 'Proveedor/Responsible', 'Lugar llega / Frente'], sample: ['1', '21/05/2026', 'Palas rectas', 'Nuevo', '12', 'Ingreso', 'Almacenero', 'Almacen Central'] },
  mov_maquinaria:     { headers: ['ID', 'Fecha de Movimiento', 'Maquinaria', 'Estado', 'Cantidad', 'Tipo de Movimiento', 'Proveedor/Responsable', 'Lugar de llegada'], sample: ['1', '21/05/2026', 'Rotomartillo', 'Nuevo', '1', 'Ingreso', '', 'Almacen Central'] },
  mov_emergencia:     { headers: ['ID', 'Fecha de Movimiento', 'Insumo de Emergencia', 'Unidad', 'Cantidad', 'Tipo de Movimiento', 'Proveedor/Responsable', 'Lugar de llegada'], sample: ['1', '21/05/2026', 'Extintor PQS 6kg', 'Und', '4', 'Ingreso', 'Seguridad SAC', 'Almacen Central'] },
  mov_maquinaria_asignacion: { headers: ['ID', 'Fecha', 'Equipo', 'Movimiento', 'Tipo destino', 'Asignado a', 'Observación'], sample: ['1', '21/05/2026', 'Excavadora CAT 320', 'Salida', 'Personal', 'Juan Pérez', 'Frente A'] },
};

export async function descargarPlantilla(formato) {
  const t = TEMPLATES[formato];
  if (!t) return;
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet([t.headers, t.sample]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Plantilla');
  XLSX.writeFile(wb, `plantilla_${formato}.xlsx`);
}

const { useState: uS, useMemo: uM, useCallback: uC } = React;

const STEPS_MIG = ['Aviso', 'Archivo', 'Revisar', 'Insumos', 'Resultado'];

// Tabla donde "vive" cada formato de movimiento (a dónde van los insumos).
const TABLA_POR_FORMATO = {
  mov_materiales: 'materiales',
  mov_epp: 'epps',
  mov_herramientas: 'herramientas',
  mov_maquinaria: 'activos_pesados',
  mov_emergencia: 'insumos_emergencia',
  mov_maquinaria_asignacion: 'activos_pesados',
};
const COL_NOMBRE = {
  materiales: 'nombre_material',
  epps: 'nombre_epp',
  herramientas: 'nombre_herramienta',
  activos_pesados: 'nombre',
  insumos_emergencia: 'nombre',
};
const LABEL_TABLA = {
  materiales: 'Materiales',
  epps: 'EPP',
  herramientas: 'Herramientas',
  activos_pesados: 'Maquinaria',
  insumos_emergencia: 'Insumos de Emergencia',
};

// Escanea los items únicos del archivo de movimientos contra TODAS las tablas
// de inventario (materiales/epps/herramientas/activos/emergencia). Clasifica:
//   same   — ya existe en la tabla esperada con la misma unidad → no toca catálogo.
//   diff   — existe en la tabla esperada con UNIDAD distinta → preguntar.
//   other  — no existe en la esperada pero SÍ en otra → preguntar (evitar duplicado).
//   new    — no existe en ninguna → preguntar (crear o saltar).
async function escanearMovs(movs, formato, obraId) {
  const expectedTabla = TABLA_POR_FORMATO[formato];
  const itemsExcel = new Map(); // normNombre → { nombre, unidades:Set, count }
  for (const m of movs || []) {
    const k = normTxt(m.nombreItem || m.equipo);
    if (!k) continue;
    if (!itemsExcel.has(k)) itemsExcel.set(k, { nombre: m.nombreItem || m.equipo, unidades: new Set(), count: 0 });
    const v = itemsExcel.get(k);
    if (m.unidad) v.unidades.add(String(m.unidad).trim());
    v.count++;
  }
  // Carga índice de cada tabla por nombre normalizado.
  const dbIdx = {};
  for (const t of Object.keys(COL_NOMBRE)) {
    const q = window.__db[t];
    let rows;
    if (t === 'activos_pesados') rows = await q.filter(r => !r.deleted_at).toArray();
    else rows = await q.where('obra_id').equals(obraId).filter(r => !r.deleted_at).toArray();
    const m = new Map();
    for (const r of rows) { const k = normTxt(r[COL_NOMBRE[t]]); if (k && !m.has(k)) m.set(k, { id: r.id, unidad: r.unidad || null, nombre: r[COL_NOMBRE[t]] }); }
    dbIdx[t] = m;
  }
  const out = [];
  for (const [k, info] of itemsExcel) {
    const unidadExcel = info.unidades.size === 1 ? [...info.unidades][0] : null;
    const existsExpected = dbIdx[expectedTabla]?.get(k) || null;
    const existsOther = [];
    for (const [t, m] of Object.entries(dbIdx)) {
      if (t === expectedTabla) continue;
      if (m.has(k)) existsOther.push({ tabla: t, ...m.get(k) });
    }
    let status, existing = null;
    if (existsExpected) {
      const matchUnidad = !unidadExcel || normTxt(unidadExcel) === normTxt(existsExpected.unidad || '');
      status = matchUnidad ? 'same' : 'diff';
      existing = { tabla: expectedTabla, ...existsExpected };
    } else if (existsOther.length) {
      status = 'other';
      existing = existsOther[0];
    } else {
      status = 'new';
    }
    out.push({ key: k, nombre: info.nombre, unidadExcel, count: info.count, status, expectedTabla, existing, otrosEnDb: existsOther });
  }
  return out.sort((a, b) => {
    const ord = { new: 0, diff: 1, other: 2, same: 3 };
    return (ord[a.status] - ord[b.status]) || a.nombre.localeCompare(b.nombre);
  });
}

// Nombre de la persona responsable de un movimiento (col. G en salidas /
// "Asignado a" en asignaciones). Vacío si el movimiento no lleva responsable.
function nombrePersonaDeMov(m, formato) {
  if (formato === 'mov_maquinaria_asignacion') return m.tipo === 'salida' ? (m.destinoNombre || '') : '';
  if (m.tipo !== 'salida') return '';
  if (formato === 'mov_materiales') return m.responsable || '';
  return m.responsable || m.origen || ''; // epp / herramientas / maquinaria / emergencia
}

// Escanea los responsables únicos de las salidas y los clasifica contra
// `personal` (de la obra) y `subcontratistas`. Devuelve filas para revisión:
//   matched_personal / matched_sub / new (no existe en ninguno).
async function escanearResponsables(movs, formato, obraId) {
  const nombres = new Map(); // norm → { nombre, count, sugSub }
  for (const m of movs || []) {
    const n = nombrePersonaDeMov(m, formato);
    const k = normTxt(n);
    if (!k) continue;
    if (!nombres.has(k)) nombres.set(k, { nombre: n.trim(), count: 0, sugSub: false });
    const v = nombres.get(k);
    v.count++;
    if (formato === 'mov_maquinaria_asignacion' && m.destinoTipo === 'subcontratista') v.sugSub = true;
  }
  const personal = obraId ? await window.__db.personal.where('obra_id').equals(obraId).filter(p => !p.deleted_at).toArray() : [];
  const subs = await window.__db.subcontratistas.filter(s => !s.deleted_at).toArray();
  const idxPers = new Map(); for (const p of personal) { const k = normTxt(`${p.nombres || ''} ${p.apellidos || ''}`); if (k) idxPers.set(k, p); }
  const idxSub = new Map(); for (const s of subs) { const k = normTxt(s.razon_social); if (k) idxSub.set(k, s); }
  const out = [];
  for (const [k, info] of nombres) {
    const pMatch = idxPers.get(k) || personal.find(p => { const f = normTxt(`${p.nombres || ''} ${p.apellidos || ''}`); return f && (f.includes(k) || k.includes(f)); });
    const sMatch = idxSub.get(k) || subs.find(s => { const r = normTxt(s.razon_social); return r && (r.includes(k) || k.includes(r)); });
    let status, existing = null;
    if (pMatch) { status = 'matched_personal'; existing = { tipo: 'personal', id: pMatch.id }; }
    else if (sMatch) { status = 'matched_sub'; existing = { tipo: 'subcontratista', id: sMatch.id }; }
    else status = 'new';
    out.push({ key: k, nombre: info.nombre, count: info.count, status, existing, sugSub: info.sugSub });
  }
  return out.sort((a, b) => { const o = { new: 0, matched_sub: 1, matched_personal: 2 }; return (o[a.status] - o[b.status]) || a.nombre.localeCompare(b.nombre); });
}
function accionPersonaDefault(row) {
  if (row.status === 'matched_personal') return 'usar_personal';
  if (row.status === 'matched_sub') return 'usar_sub';
  return row.sugSub ? 'crear_sub' : 'crear_personal'; // new
}

// Aplica las decisiones de responsables: crea personal/subcontratistas según
// corresponda y devuelve Map(normNombre → {tipo, id}).
async function aplicarDecisionesPersonas(scan, decisiones, obraId, userId) {
  const map = new Map();
  let creadosPers = 0, creadosSub = 0;
  for (const row of scan) {
    const acc = decisiones.get(row.key) || accionPersonaDefault(row);
    if (acc === 'ignorar') continue;
    if (acc === 'usar_personal' && row.existing) { map.set(row.key, { tipo: 'personal', id: row.existing.id }); continue; }
    if (acc === 'usar_sub' && row.existing) { map.set(row.key, { tipo: 'subcontratista', id: row.existing.id }); continue; }
    if (acc === 'crear_personal') {
      const partes = row.nombre.split(/\s+/);
      const nombres = partes.slice(0, Math.ceil(partes.length / 2)).join(' ') || row.nombre;
      const apellidos = partes.slice(Math.ceil(partes.length / 2)).join(' ') || '—';
      // dni es NOT NULL + UNIQUE(dni, obra_id): placeholder único por nombre.
      const dni = `MIG-${row.key.slice(0, 16)}`;
      const rec = await addRecord('personal', { obra_id: obraId, nombres, apellidos, dni, cargo: 'Obrero', estado: 'activo' }, userId);
      map.set(row.key, { tipo: 'personal', id: rec.id }); creadosPers++;
    } else if (acc === 'crear_sub') {
      const rec = await addRecord('subcontratistas', { razon_social: row.nombre, ruc: null, estado: 'activo' }, userId);
      map.set(row.key, { tipo: 'subcontratista', id: rec.id }); creadosSub++;
    }
  }
  return { map, creadosPers, creadosSub };
}

// Decide la acción por defecto para una fila del scan.
function accionDefault(row) {
  if (row.status === 'same') return 'mantener';
  if (row.status === 'diff') return 'saltar';
  if (row.status === 'other') return 'saltar';
  return 'crear'; // new
}

// Aplica las decisiones (crear/reemplazar/saltar) y devuelve el Map de items
// resueltos (clave normNombre → {id, tabla, unidad}). Los items que se saltan
// no entran al map → el loader saltará sus movimientos.
async function aplicarDecisiones(scan, decisiones, formato, obraId, userId) {
  const expectedTabla = TABLA_POR_FORMATO[formato];
  const resolved = new Map();
  let creados = 0, reemplazados = 0, mantenidos = 0, saltados = 0;
  for (const row of scan) {
    const acc = decisiones.get(row.key) || accionDefault(row);
    if (acc === 'saltar') { saltados++; continue; }
    if (acc === 'mantener') {
      if (row.existing) {
        resolved.set(row.key, { id: row.existing.id, tabla: row.existing.tabla, unidad: row.existing.unidad || row.unidadExcel || 'Und' });
        mantenidos++;
      }
      continue;
    }
    if (acc === 'reemplazar' && row.existing) {
      const nuevaUnidad = row.unidadExcel || row.existing.unidad || 'Und';
      try {
        const tablaExist = row.existing.tabla;
        await window.__db[tablaExist].update(row.existing.id, {
          unidad: nuevaUnidad,
          updated_at: new Date().toISOString(), updated_by: userId,
          sync_status: 'pending_update',
        });
      } catch {}
      resolved.set(row.key, { id: row.existing.id, tabla: row.existing.tabla, unidad: nuevaUnidad });
      reemplazados++;
      continue;
    }
    if (acc === 'crear') {
      // Crea en la tabla esperada del formato.
      const rec = await crearItemEnTabla(expectedTabla, row.nombre, row.unidadExcel || 'Und', obraId, userId);
      if (rec) { resolved.set(row.key, { id: rec.id, tabla: expectedTabla, unidad: row.unidadExcel || 'Und' }); creados++; }
      continue;
    }
  }
  return { resolved, creados, reemplazados, mantenidos, saltados };
}

// Crea un item nuevo en la tabla esperada con el shape mínimo correcto.
async function crearItemEnTabla(tabla, nombre, unidad, obraId, userId) {
  // Guard: nunca crear insumos sin nombre (filas del Excel con celda vacía /
  // sin ID). Devuelve null → el caller saltará sus movimientos.
  if (!nombre || !String(nombre).trim()) return null;
  const ahora = new Date().toISOString();
  const id = window.__newId();
  const isPrueba = getCurrentMode() === 'prueba';
  const meta = {
    id, created_by: userId, updated_by: userId, created_at: ahora, updated_at: ahora,
    version: 1, sync_status: isPrueba ? 'synced' : 'pending_create', last_synced_at: null,
    idempotency_key: `${userId || 'x'}_${tabla}_${id}`,
    ...(isPrueba ? { demo: true } : {}),
  };
  let body;
  if (tabla === 'materiales') body = { obra_id: obraId, nombre_material: nombre.trim(), categoria: null, unidad, stock_inicial: 0, stock_actual: 0, stock_minimo: 0, total_entradas: 0, total_salidas: 0, alerta: 'ok', estado: 'activo' };
  else if (tabla === 'epps') body = { obra_id: obraId, nombre_epp: nombre.trim(), tipo_epp: detectarEPP(nombre) || 'Otro', unidad, stock_inicial: 0, stock_actual: 0, stock_minimo: 0, alerta: 'ok', estado: 'activo' };
  else if (tabla === 'herramientas') body = { obra_id: obraId, nombre_herramienta: nombre.trim(), tipo_herramienta: 'manual', estado_actual: 'bueno', ubicacion_actual: 'almacen', disponible: true, maneja_cantidad: true, unidad, stock_actual: 0, stock_minimo: 0, alerta: 'ok' };
  else if (tabla === 'activos_pesados') body = { nombre: nombre.trim(), tipo: 'maquinaria', estado: 'operativo', obra_actual_id: obraId, obra_id: obraId, maneja_cantidad: false, unidad, stock_actual: 0, stock_minimo: 0, alerta: 'ok', notas: 'Migración histórica' };
  else if (tabla === 'insumos_emergencia') body = { obra_id: obraId, nombre: nombre.trim(), categoria: null, unidad, stock_inicial: 0, stock_actual: 0, stock_minimo: 0, alerta: 'ok', estado: 'activo' };
  else return null;
  const rec = { ...body, ...meta };
  await window.__db[tabla].add(rec);
  return rec;
}

// ── Creación local-first con control de created_at + demo ───────────────
function buildRecord(tabla, fields, userId, createdAtISO) {
  const now = new Date().toISOString();
  const id = window.__newId();
  const isPrueba = getCurrentMode() === 'prueba';
  // created_at es timestamptz; la fecha del Excel es YYYY-MM-DD → mediodía UTC.
  const createdAt = createdAtISO ? `${createdAtISO}T12:00:00.000Z` : now;
  return {
    ...fields,
    id,
    created_by: userId, updated_by: userId,
    created_at: createdAt, updated_at: now,
    version: 1,
    sync_status: isPrueba ? 'synced' : 'pending_create',
    last_synced_at: null,
    idempotency_key: fields.idempotency_key ?? `${userId || 'x'}_${tabla}_${id}`,
    ...(isPrueba ? { demo: true } : {}),
  };
}
async function addRecord(tabla, fields, userId, createdAtISO) {
  const rec = buildRecord(tabla, fields, userId, createdAtISO);
  await window.__db[tabla].add(rec);
  return rec;
}

// Movimiento de migración IDEMPOTENTE: la idempotency_key se deriva de una
// firma estable (obra+formato+fila+item+fecha+tipo+cantidad). Si ya existe un
// movimiento con esa clave (re-subida del mismo archivo), NO se crea de nuevo
// → re-importar el mismo Excel es un no-op (no duplica ni genera errores de
// sync). Devuelve { rec } si se creó, o { dup:true } si ya existía.
async function addMovIdem(tabla, fields, userId, createdAtISO, sig) {
  const key = `mig_${sig}`;
  try {
    const yaExiste = await window.__db[tabla].where('idempotency_key').equals(key).first();
    if (yaExiste) return { dup: true };
  } catch {}
  const rec = await addRecord(tabla, { ...fields, idempotency_key: key }, userId, createdAtISO);
  return { rec };
}
// Firma estable de una fila de movimiento para la idempotencia (clave server).
function sigMov(obraId, formato, m) {
  const nombre = normTxt(m.nombreItem || m.equipo || '');
  return `${(obraId || '').slice(0, 8)}_${formato}_${m.idx}_${nombre}_${m.fecha || ''}_${m.tipo || ''}_${m.cantidad ?? ''}`;
}

// Dedup por CONTENIDO (robusto entre versiones / claves distintas). Construye
// un multiset de los movimientos de migración YA existentes de una tabla,
// contados por (item, fecha, tipo, cantidad). Al importar, cada fila del Excel
// "consume" una coincidencia preexistente: si ya hay tantas como en el archivo,
// no se crea ninguna nueva → re-subir el mismo archivo no duplica, aunque la
// idempotency_key sea distinta. Solo mira movimientos marcados "Migración
// histórica" para no chocar con movimientos manuales idénticos.
async function cargarFirmasMigracion(movTabla, obraId, fk) {
  const rows = await window.__db[movTabla].where('obra_id').equals(obraId).toArray();
  const count = new Map();
  for (const mv of rows) {
    if (mv.deleted_at) continue;
    if (!String(mv.observaciones || '').includes('Migración histórica')) continue;
    const s = `${mv[fk]}__${mv.fecha || ''}__${mv.tipo_movimiento || ''}__${mv.cantidad ?? ''}`;
    count.set(s, (count.get(s) || 0) + 1);
  }
  return count;
}
// Devuelve true (y consume 1) si ya existe un movimiento idéntico preexistente.
function consumirFirma(firmas, itemId, fecha, tipo, cantidad) {
  const s = `${itemId}__${fecha || ''}__${tipo || ''}__${cantidad ?? ''}`;
  const c = firmas.get(s) || 0;
  if (c > 0) { firmas.set(s, c - 1); return true; }
  return false;
}

// Limpieza de basura local de migraciones rotas anteriores: insumos sin nombre
// y movimientos huérfanos (su item no existe). SOLO borra registros que NUNCA
// sincronizaron (pending_create/failed) — los que ya están en el server no se
// tocan. Es local-first: el server queda intacto. Devuelve conteos.
async function limpiarBasuraMigracion() {
  const db = window.__db;
  const noSync = (r) => r.sync_status === 'pending_create' || r.sync_status === 'failed';
  let itemsBorrados = 0, movsBorrados = 0;
  const INV = [
    { tabla: 'materiales', col: 'nombre_material', movTabla: 'movimientos_materiales', fk: 'material_id' },
    { tabla: 'herramientas', col: 'nombre_herramienta', movTabla: 'movimientos_herramientas', fk: 'herramienta_id' },
    { tabla: 'epps', col: 'nombre_epp', movTabla: 'movimientos_epp', fk: 'epp_id' },
    { tabla: 'activos_pesados', col: 'nombre', movTabla: 'movimientos_maquinaria', fk: 'activo_id' },
    { tabla: 'insumos_emergencia', col: 'nombre', movTabla: 'movimientos_insumos_emergencia', fk: 'insumo_emergencia_id' },
  ];
  for (const { tabla, col, movTabla, fk } of INV) {
    // 1) Insumos sin nombre que nunca sincronizaron → borrar.
    const items = await db[tabla].toArray();
    const idsBorrar = new Set();
    for (const it of items) {
      if (!String(it[col] || '').trim() && noSync(it)) { idsBorrar.add(it.id); }
    }
    for (const id of idsBorrar) { try { await db[tabla].delete(id); itemsBorrados++; } catch {} }
    // 2) Movimientos cuyo item no existe (huérfanos) y que nunca sincronizaron.
    const idsVivos = new Set((await db[tabla].toArray()).filter(r => !r.deleted_at).map(r => r.id));
    const movs = await db[movTabla].toArray();
    for (const mv of movs) {
      if (!idsVivos.has(mv[fk]) && noSync(mv)) { try { await db[movTabla].delete(mv.id); movsBorrados++; } catch {} }
    }
  }
  for (const t of ['materiales','herramientas','epps','activos_pesados','insumos_emergencia','movimientos_materiales','movimientos_herramientas','movimientos_epp','movimientos_maquinaria','movimientos_insumos_emergencia']) {
    try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: t } })); } catch {}
  }
  return { itemsBorrados, movsBorrados };
}

// Quita movimientos de migración DUPLICADOS (mismo item+fecha+tipo+cantidad,
// marcados "Migración histórica"), dejando uno solo. Borra el resto: si nunca
// sincronizó → hard delete local; si ya está en server → soft delete
// (deleted_at + pending_delete) para que el SyncEngine lo borre también.
// Después recalcula el stock de los items afectados.
async function quitarMovsDuplicadosMigracion(obraId, userId) {
  const db = window.__db;
  const now = new Date().toISOString();
  const MOVS = [
    { tabla: 'movimientos_materiales', fk: 'material_id', itemTabla: 'materiales' },
    { tabla: 'movimientos_epp', fk: 'epp_id', itemTabla: 'epps' },
    { tabla: 'movimientos_herramientas', fk: 'herramienta_id', itemTabla: 'herramientas' },
    { tabla: 'movimientos_maquinaria', fk: 'activo_id', itemTabla: 'activos_pesados' },
    { tabla: 'movimientos_insumos_emergencia', fk: 'insumo_emergencia_id', itemTabla: 'insumos_emergencia' },
  ];
  let borrados = 0;
  const afectadosPorTabla = {};
  for (const { tabla, fk, itemTabla } of MOVS) {
    const rows = (await db[tabla].where('obra_id').equals(obraId).toArray())
      .filter(mv => !mv.deleted_at && String(mv.observaciones || '').includes('Migración histórica'));
    // Agrupar por firma de contenido.
    const grupos = new Map();
    for (const mv of rows) {
      const sig = mv.cantidad == null
        ? `${mv[fk]}__${mv.fecha || ''}__${mv.tipo_movimiento || ''}__${mv.destino_tipo || ''}` // asignación
        : `${mv[fk]}__${mv.fecha || ''}__${mv.tipo_movimiento || ''}__${mv.cantidad}`;
      if (!grupos.has(sig)) grupos.set(sig, []);
      grupos.get(sig).push(mv);
    }
    const afectados = new Set();
    for (const lista of grupos.values()) {
      if (lista.length <= 1) continue;
      lista.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')); // conservar el más viejo
      for (let i = 1; i < lista.length; i++) {
        const mv = lista[i];
        try {
          if (mv.sync_status === 'pending_create') await db[tabla].delete(mv.id);
          else await db[tabla].update(mv.id, { deleted_at: now, sync_status: 'pending_delete' });
          borrados++; afectados.add(mv[fk]);
        } catch {}
      }
    }
    afectadosPorTabla[itemTabla] = afectados;
    try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla } })); } catch {}
  }
  // Recalcular stock de los items afectados, leyendo movimientos VIVOS.
  for (const [itemTabla, afectados] of Object.entries(afectadosPorTabla)) {
    if (!afectados.size) continue;
    if (itemTabla === 'materiales') await recalcularStockMateriales(obraId, afectados, userId);
    else if (itemTabla === 'epps') await recalcularStockEpp(obraId, afectados, userId);
    else if (itemTabla === 'herramientas') await recalcularStockHerramientas(obraId, afectados, userId);
    else if (itemTabla === 'activos_pesados') await recalcularStockMaquinaria(obraId, afectados, userId);
    else if (itemTabla === 'insumos_emergencia') await recalcularStockEmergencia(obraId, afectados, userId);
    try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: itemTabla } })); } catch {}
  }
  return { borrados };
}

// activos_pesados.tipo tiene un CHECK que solo admite estos valores.
// Cualquier otro Tipo del Excel se mapea a 'otro' para no romper el sync.
const ACTIVOS_TIPOS = new Set([
  'excavadora','retroexcavadora','volquete','cargador','tractor','motoniveladora',
  'rodillo','grua','pavimentadora','bulldozer','camion','maquinaria','equipo','otro',
]);
function normaTipoActivo(raw) {
  const t = String(raw || '').toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  return ACTIVOS_TIPOS.has(t) ? t : 'otro';
}

const fireChanged = (...tablas) => {
  for (const t of tablas) {
    try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: t } })); } catch {}
  }
};

// ── Índices en memoria (para resolver/crear sin requery por fila) ───────
async function cargarIndice(tabla, obraId, campoNombre, { porObra = true } = {}) {
  const q = window.__db[tabla];
  const rows = porObra && obraId
    ? await q.where('obra_id').equals(obraId).filter(r => !r.deleted_at).toArray()
    : await q.filter(r => !r.deleted_at).toArray();
  const map = new Map();
  for (const r of rows) {
    const k = normTxt(r[campoNombre]);
    if (k && !map.has(k)) map.set(k, r);
  }
  return { rows, map };
}

// Match best-effort de un nombre de persona contra el padrón de personal.
function matchPersonal(termino, personal) {
  const t = normTxt(termino);
  if (!t) return null;
  for (const p of personal) {
    const full = normTxt(`${p.nombres || ''} ${p.apellidos || ''}`);
    if (full && (full === t || full.includes(t) || t.includes(full))) return p.id;
  }
  // overlap por palabra
  const words = t.match(/[a-z0-9]+/gi) || [];
  for (const p of personal) {
    const full = normTxt(`${p.nombres || ''} ${p.apellidos || ''}`);
    if (words.some(w => w.length >= 4 && full.includes(w))) return p.id;
  }
  return null;
}
function matchProveedor(termino, proveedores) {
  const t = normTxt(termino);
  if (!t) return null;
  for (const p of proveedores) {
    const rs = normTxt(p.razon_social);
    if (rs && (rs === t || rs.includes(t) || t.includes(rs))) return p.id;
  }
  return null;
}

// Estado de herramienta del Excel ("Nuevo"/"Bueno") → valor válido del CHECK.
const ESTADOS_HERR = ['nuevo', 'bueno', 'regular', 'malo', 'mantenimiento', 'inhabilitado', 'baja'];
const normEstadoHerr = (v) => { const n = normTxt(v); return ESTADOS_HERR.find(e => e === n) || 'bueno'; };

// ── Config de variantes/dedup por tabla de inventario ───────────────
const ORG_CONFIG = {
  materiales:         { nombre: 'nombre_material',    movTabla: 'movimientos_materiales',           fk: 'material_id',           itemTipo: 'material',    etiqueta: 'materiales' },
  epps:               { nombre: 'nombre_epp',         movTabla: 'movimientos_epp',                  fk: 'epp_id',                itemTipo: 'epp',         etiqueta: 'EPP' },
  herramientas:       { nombre: 'nombre_herramienta', movTabla: 'movimientos_herramientas',          fk: 'herramienta_id',        itemTipo: 'herramienta', etiqueta: 'herramientas' },
  insumos_emergencia: { nombre: 'nombre',             movTabla: 'movimientos_insumos_emergencia',   fk: 'insumo_emergencia_id',  itemTipo: null,          etiqueta: 'insumos de emergencia' },
};

// Panel post-import: detecta variantes (genéricos) y duplicados del inventario
// recién cargado y deja agruparlos / fusionarlos sin salir del importador.
function OrganizacionSugerida({ tabla, obraId, userId, showToast }) {
  const cfg = ORG_CONFIG[tabla];
  const [items, setItems] = uS([]);
  const [descartadas, setDescartadas] = uS(() => new Set());
  const [busy, setBusy] = uS(false);
  const recargar = React.useCallback(async () => {
    if (!cfg || !obraId) return;
    try {
      const rows = await window.__db[tabla].where('obra_id').equals(obraId).filter(r => !r.deleted_at).toArray();
      setItems(rows);
    } catch (e) { console.warn('[org sugerida]', e?.message); }
  }, [tabla, obraId, cfg]);
  React.useEffect(() => { recargar(); }, [recargar]);
  if (!cfg) return null;

  const sugerencias = detectarSugerencias(items, cfg.nombre).filter(s => !descartadas.has(s.clave));
  const dups = detectarDuplicados(items, cfg.nombre).filter(d => !descartadas.has('dup-' + d.clave));
  if (!sugerencias.length && !dups.length) return null;

  const nombreDe = (it) => it[cfg.nombre];
  const crearGrupo = async (titulo, lista) => {
    if (busy) return; setBusy(true);
    try {
      const base = lista[0] || {};
      const padreBody = { obra_id: obraId, [cfg.nombre]: titulo.trim(), unidad: base.unidad || 'und', es_grupo: true, stock_inicial: 0, stock_actual: 0, stock_minimo: 0, alerta: 'ok', estado: 'activo' };
      if (tabla === 'epps') padreBody.tipo_epp = base.tipo_epp || 'Otro';
      if (tabla === 'herramientas') { padreBody.tipo_herramienta = base.tipo_herramienta || 'manual'; padreBody.estado_actual = 'bueno'; padreBody.ubicacion_actual = 'almacen'; padreBody.disponible = true; padreBody.maneja_cantidad = true; }
      const padre = await addRecord(tabla, padreBody, userId);
      for (const it of lista) await window.__db[tabla].update(it.id, { padre_id: padre.id, updated_at: new Date().toISOString(), version: (it.version ?? 0) + 1, sync_status: it.sync_status === 'pending_create' ? 'pending_create' : 'pending_update' });
      fireChanged(tabla);
      showToast?.(`✓ "${titulo}" con ${lista.length} variantes`, 'green'); await recargar();
    } catch (e) { showToast?.('Error: ' + (e.message || e), 'red'); } finally { setBusy(false); }
  };
  const agregar = async (grupo, lista) => {
    if (busy) return; setBusy(true);
    try {
      for (const it of lista) await window.__db[tabla].update(it.id, { padre_id: grupo.id, updated_at: new Date().toISOString(), version: (it.version ?? 0) + 1, sync_status: it.sync_status === 'pending_create' ? 'pending_create' : 'pending_update' });
      fireChanged(tabla);
      showToast?.(`✓ ${lista.length} agregado(s) a "${nombreDe(grupo)}"`, 'green'); await recargar();
    } catch (e) { showToast?.('Error: ' + (e.message || e), 'red'); } finally { setBusy(false); }
  };
  const fusionar = async (grupo) => {
    if (busy) return;
    if (!confirm(`¿Fusionar ${grupo.items.length} "${grupo.nombre}" en uno? Se reasignan los movimientos y se suma el stock al primero.`)) return;
    setBusy(true);
    try {
      const survivorId = grupo.items[0].id;
      const dupIds = grupo.items.slice(1).map(i => i.id);
      const r = await fusionarInsumos({ db: window.__db, tabla, movTabla: cfg.movTabla, fk: cfg.fk, itemTipoStock: cfg.itemTipo, userId, calcAlerta }, survivorId, dupIds);
      fireChanged(tabla, cfg.movTabla);
      showToast?.(`✓ Fusionado · ${r.movidos} movimientos · stock ${r.stockFinal}`, 'green'); await recargar();
    } catch (e) { showToast?.('Error: ' + (e.message || e), 'red'); } finally { setBusy(false); }
  };

  return (
    <div style={{ width: '100%', maxWidth: 640, textAlign: 'left', marginTop: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tp)', marginBottom: 8 }}>Organización sugerida — {cfg.etiqueta}</div>
      {sugerencias.map(s => (
        <div key={'sug-' + s.clave} style={{ marginBottom: 8, padding: '10px 12px', background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 300px', fontSize: 12, color: 'var(--ts)' }}>
            {s.tipo === 'add'
              ? <>💡 <strong>{s.items.length}</strong> parecen variantes de <strong>“{nombreDe(s.grupo)}”</strong>. ¿Agregar al grupo?</>
              : <>💡 <strong>{s.items.length}</strong> empiezan con <strong>“{s.titulo}”</strong>. ¿Agrupar como variantes?</>}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {s.tipo === 'add'
              ? <button className="btn btn-amber btn-sm" disabled={busy} onClick={() => agregar(s.grupo, s.items)}>Agregar</button>
              : <button className="btn btn-amber btn-sm" disabled={busy} onClick={() => crearGrupo(s.titulo, s.items)}>Agrupar</button>}
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setDescartadas(d => new Set(d).add(s.clave))}>No</button>
          </div>
        </div>
      ))}
      {dups.map(d => (
        <div key={'dup-' + d.clave} style={{ marginBottom: 8, padding: '10px 12px', background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 300px', fontSize: 12, color: 'var(--ts)' }}>⚠ <strong>{d.items.length}</strong> con el mismo nombre <strong>“{d.nombre}”</strong> (duplicado). ¿Fusionar?</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-red btn-sm" disabled={busy} onClick={() => fusionar(d)}>Fusionar</button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setDescartadas(s => new Set(s).add('dup-' + d.clave))}>No</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
export function MigracionFlow({ obraId, userId, showToast, onReset, superAdmin }) {
  const [step, setStep] = uS(0);
  const [file, setFile] = uS(null);
  const [parsed, setParsed] = uS(null);   // { headers, rows }
  const [parseErr, setParseErr] = uS(null);
  const [formato, setFormato] = uS(null);  // id detectado (editable)
  const [importing, setImp] = uS(false);
  const [progress, setProgress] = uS({ current: 0, total: 0 });
  const [result, setResult] = uS(null);
  const [plantillaSel, setPlantillaSel] = uS('mov_materiales');   // formato para "Descargar plantilla"
  // Paso "Insumos": revisión item-por-item antes de cargar movimientos.
  const [scanRows, setScanRows] = uS(null);    // Array<{ key, nombre, status, existing, ... }>
  const [decisiones, setDecisiones] = uS(() => new Map()); // Map<key, accion>
  const [scanPersonas, setScanPersonas] = uS(null);          // responsables a revisar
  const [decisionesPersonas, setDecisionesPersonas] = uS(() => new Map());
  const [scanning, setScanning] = uS(false);
  const [limpiando, setLimpiando] = uS(false);

  const fmtMeta = formato ? FORMATOS[formato] : null;
  const esInsumos = formato === 'insumos_totales';
  const esInsumosEmergencia = formato === 'insumos_emergencia';
  const esMov = formato && formato.startsWith('mov_');
  const esAsignacion = formato === 'mov_maquinaria_asignacion';
  const movHabilitado = formato === 'mov_materiales' || formato === 'mov_epp' || formato === 'mov_herramientas' || formato === 'mov_maquinaria' || formato === 'mov_emergencia' || esAsignacion;

  // Preview derivado del parse
  const preview = uM(() => {
    if (!parsed || !formato) return null;
    if (esInsumos) {
      const items = parseInsumosTotales(parsed.rows);
      const porTipo = { materiales: 0, herramientas: 0, activos_pesados: 0, epps: 0, insumos_emergencia: 0, desconocido: 0 };
      for (const it of items) porTipo[it.tipo || 'desconocido']++;
      return { tipo: 'insumos', items, porTipo, total: items.length };
    }
    if (esInsumosEmergencia) {
      const items = parseInsumosEmergencia(parsed.rows);
      return { tipo: 'insumos_emergencia', items, total: items.length };
    }
    if (esAsignacion) {
      const movs = parseMovMaquinariaAsignacion(parsed.rows);
      return {
        tipo: 'mov_asignacion', movs,
        salidas: movs.filter(m => m.tipo === 'salida').length,
        devoluciones: movs.filter(m => m.tipo === 'entrada').length,
        sinTipo: movs.filter(m => !m.tipo).length,
        equipos: new Set(movs.map(m => normTxt(m.equipo))).size,
        total: movs.length,
      };
    }
    const movs = parseMovimientos(parsed.rows, formato);
    return { tipo: 'mov', movs, resumen: resumenMovimientos(movs) };
  }, [parsed, formato, esInsumos, esInsumosEmergencia, esAsignacion]);

  // Validación de calidad del archivo de movimientos (por cantidad):
  //  · unidades: un insumo no puede tener 2 unidades distintas (ej. clavos en
  //    Kg y en cajas) → se bloquea el insumo entero.
  //  · stock negativo: una salida no puede dejar el stock bajo 0 (faltan
  //    entradas o el dato está mal) → se marca esa fila.
  // Las filas/insumos con problema NO se importan; se muestran para corregir
  // el Excel. (No aplica a asignaciones de maquinaria, que no llevan cantidad.)
  const validacionMov = uM(() => {
    if (!esMov || esAsignacion || !preview?.movs?.length) return null;
    const movs = preview.movs;
    // 1) unidades por insumo
    const unidades = new Map();
    for (const m of movs) {
      const k = normTxt(m.nombreItem || ''); if (!k) continue;
      const u = (m.unidad || '').trim(); if (!u) continue;
      if (!unidades.has(k)) unidades.set(k, { nombre: m.nombreItem, set: new Set() });
      unidades.get(k).set.add(u);
    }
    const conflictoUnidad = []; const itemsConConflicto = new Set();
    for (const [k, v] of unidades) if (v.set.size > 1) { conflictoUnidad.push({ key: k, nombre: v.nombre, unidades: [...v.set] }); itemsConConflicto.add(k); }
    // 2) stock negativo simulado en orden de fecha
    const ordenadas = [...movs].sort((a, b) => (a.fecha || '') < (b.fecha || '') ? -1 : 1);
    const saldo = new Map(); const stockNeg = []; const idxNeg = new Set();
    for (const m of ordenadas) {
      const k = normTxt(m.nombreItem || ''); if (!k || !m.tipo || !(m.cantidad > 0)) continue;
      const s = saldo.get(k) || 0;
      if (m.tipo === 'entrada') saldo.set(k, s + m.cantidad);
      else {
        const ns = s - m.cantidad;
        if (ns < 0) { stockNeg.push({ idx: m.idx, nombre: m.nombreItem, fecha: m.fecha, cantidad: m.cantidad, disponible: s }); idxNeg.add(m.idx); }
        else saldo.set(k, ns);
      }
    }
    return { conflictoUnidad, itemsConConflicto, stockNeg, idxNeg };
  }, [preview, esMov, esAsignacion]);

  // ¿Esta fila del Excel queda excluida por validación de calidad?
  const esFilaInvalida = (m) => {
    if (!validacionMov) return false;
    if (validacionMov.idxNeg.has(m.idx)) return true;
    if (validacionMov.itemsConConflicto.has(normTxt(m.nombreItem || ''))) return true;
    return false;
  };

  const onFile = uC((f) => {
    setFile(f); setParsed(null); setParseErr(null); setFormato(null); setResult(null);
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { setParseErr('El archivo excede 10 MB'); return; }
    window.__excel.parseExcelFile(f)
      .then(p => {
        setParsed(p);
        const det = detectFormato(p.headers);
        setFormato(det);
        if (!det) setParseErr('No reconozco el formato. Revisá que sea uno de los 5 formatos de migración.');
      })
      .catch(e => setParseErr(e.message || 'Error al leer el archivo'));
  }, []);

  // ── Cargas ────────────────────────────────────────────────────────
  const runInsumos = async () => {
    const items = preview.items;
    let creados = 0, saltados = 0, errores = 0;
    const errorList = [];
    const idx = {
      materiales: (await cargarIndice('materiales', obraId, 'nombre_material')).map,
      herramientas: (await cargarIndice('herramientas', obraId, 'nombre_herramienta')).map,
      epps: (await cargarIndice('epps', obraId, 'nombre_epp')).map,
      activos_pesados: (await cargarIndice('activos_pesados', obraId, 'nombre', { porObra: false })).map,
      insumos_emergencia: (await cargarIndice('insumos_emergencia', obraId, 'nombre')).map,
    };
    setProgress({ current: 0, total: items.length });
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      try {
        if (!it.tipo) { errores++; errorList.push({ row: it.idx, error: `Tipo desconocido: "${it.tipoRaw}"` }); }
        else if (idx[it.tipo].has(normTxt(it.nombre))) { saltados++; }
        else {
          let rec;
          if (it.tipo === 'materiales') {
            rec = await addRecord('materiales', {
              obra_id: obraId, nombre_material: it.nombre, categoria: null,
              unidad: it.unidad || 'Und', stock_inicial: 0, stock_actual: 0, stock_minimo: 0,
              total_entradas: 0, total_salidas: 0, alerta: 'ok', estado: 'activo',
            }, userId, it.fechaCreacion);
          } else if (it.tipo === 'herramientas') {
            rec = await addRecord('herramientas', {
              obra_id: obraId, nombre_herramienta: it.nombre, tipo_herramienta: 'manual',
              estado_actual: 'bueno', ubicacion_actual: 'almacen', disponible: true,
              maneja_cantidad: true, unidad: it.unidad || 'Und',
              stock_inicial: 0, stock_actual: 0, stock_minimo: 0, alerta: 'ok',
            }, userId, it.fechaCreacion);
          } else if (it.tipo === 'epps') {
            rec = await addRecord('epps', {
              obra_id: obraId, nombre_epp: it.nombre, tipo_epp: detectarEPP(it.nombre) || 'Otro',
              unidad: it.unidad || 'Und', stock_inicial: 0, stock_actual: 0, stock_minimo: 0,
              alerta: 'ok', estado: 'activo',
            }, userId, it.fechaCreacion);
          } else if (it.tipo === 'activos_pesados') {
            rec = await addRecord('activos_pesados', {
              nombre: it.nombre, tipo: normaTipoActivo(it.tipoRaw || 'maquinaria'),
              estado: 'operativo', obra_actual_id: obraId, obra_id: obraId,
              maneja_cantidad: true, unidad: it.unidad || 'Und',
              stock_actual: 0, stock_minimo: 0, alerta: 'ok',
              notas: 'Migración histórica',
            }, userId, it.fechaCreacion);
          } else if (it.tipo === 'insumos_emergencia') {
            rec = await addRecord('insumos_emergencia', {
              obra_id: obraId, nombre: it.nombre, categoria: it.tipoRaw || null,
              unidad: it.unidad || 'Und', stock_inicial: 0, stock_actual: 0, stock_minimo: 0,
              alerta: 'ok', estado: 'activo',
            }, userId, it.fechaCreacion);
          }
          if (rec) { idx[it.tipo].set(normTxt(it.nombre), rec); creados++; }
        }
      } catch (e) { errores++; errorList.push({ row: it.idx, error: e.message || String(e) }); }
      if (i % 20 === 0) { setProgress({ current: i + 1, total: items.length }); await new Promise(r => setTimeout(r, 0)); }
    }
    fireChanged('materiales', 'herramientas', 'epps', 'activos_pesados', 'insumos_emergencia');
    return { ok: creados, saltados, errors: errores, errorList,
      detalle: `${creados} insumos creados · ${saltados} ya existían · ${errores} con error` };
  };

  const runMovMateriales = async (resolvedItems = null, rp = null) => {
    const movs = [...preview.movs].sort((a, b) => (a.fecha || '') < (b.fecha || '') ? -1 : 1);
    const matIdx = await cargarIndice('materiales', obraId, 'nombre_material');
    if (resolvedItems) { for (const [k, info] of resolvedItems) matIdx.map.set(k, { id: info.id, unidad: info.unidad }); }
    const ubicIdx = await cargarIndice('ubicaciones_obra', obraId, 'nombre');
    const personal = (await window.__db.personal.where('obra_id').equals(obraId).filter(p => !p.deleted_at).toArray());
    const proveedores = (await window.__db.proveedores.filter(p => !p.deleted_at).toArray());

    const resolverMaterial = async (nombre, unidad) => {
      const k = normTxt(nombre);
      if (matIdx.map.has(k)) return matIdx.map.get(k);
      if (resolvedItems) return null; // ítem no aprobado en revisión → saltar
      const rec = await addRecord('materiales', {
        obra_id: obraId, nombre_material: String(nombre).trim(), categoria: null,
        unidad: unidad || 'Und', stock_inicial: 0, stock_actual: 0, stock_minimo: 0,
        total_entradas: 0, total_salidas: 0, alerta: 'ok', estado: 'activo',
      }, userId);
      matIdx.map.set(k, rec); return rec;
    };
    const resolverUbic = async (nombre) => {
      const k = normTxt(nombre);
      if (!k) return null;
      if (ubicIdx.map.has(k)) return ubicIdx.map.get(k).id;
      const rec = await addRecord('ubicaciones_obra', {
        obra_id: obraId, nombre: String(nombre).trim(), descripcion: 'Creada en migración histórica',
        orden: ubicIdx.map.size + 1, activo: true,
      }, userId);
      ubicIdx.map.set(k, rec); return rec.id;
    };

    const firmas = await cargarFirmasMigracion('movimientos_materiales', obraId, 'material_id');
    let okCount = 0, errores = 0, itemsCreados = 0, ubicCreadas = 0, saltadosNoAprobados = 0, duplicados = 0;
    const errorList = [];
    const afectados = new Set();
    const prevMat = matIdx.map.size, prevUbic = ubicIdx.map.size;
    setProgress({ current: 0, total: movs.length });

    for (let i = 0; i < movs.length; i++) {
      const m = movs[i];
      try {
        if (!m.tipo) throw new Error(`Tipo de movimiento no reconocido`);
        if (!(m.cantidad > 0)) throw new Error(`Cantidad inválida`);
        if (!String(m.nombreItem || '').trim()) { saltadosNoAprobados++; continue; }
        if (esFilaInvalida(m)) { saltadosNoAprobados++; continue; }
        const mat = await resolverMaterial(m.nombreItem, m.unidad);
        if (!mat) { saltadosNoAprobados++; continue; }
        const fechaMov = m.fecha || new Date().toISOString().slice(0, 10);
        if (consumirFirma(firmas, mat.id, fechaMov, m.tipo, m.cantidad)) { duplicados++; continue; }
        afectados.add(mat.id);
        const obsExtra = [];
        let proveedor_id = null, responsable_id = null, frente = null, ubicId = null;

        if (m.tipo === 'entrada') {
          if (m.origen) { proveedor_id = matchProveedor(m.origen, proveedores); if (!proveedor_id) obsExtra.push(`Proveedor: ${m.origen}`); }
          if (m.lugar) ubicId = await resolverUbic(m.lugar);
        } else {
          if (m.origen) ubicId = await resolverUbic(m.origen);
          if (m.responsable) {
            const rpHit = rp?.get(normTxt(m.responsable));
            if (rpHit?.tipo === 'personal') responsable_id = rpHit.id;
            else if (rpHit?.tipo === 'subcontratista') obsExtra.push(`Subcontrato: ${m.responsable}`);
            else { responsable_id = matchPersonal(m.responsable, personal); if (!responsable_id) obsExtra.push(`Responsable: ${m.responsable}`); }
          }
          if (m.lugar) frente = m.lugar;
        }
        const obs = ['Migración histórica', ...obsExtra].join(' · ');
        const r = await addMovIdem('movimientos_materiales', {
          obra_id: obraId, material_id: mat.id, fecha: m.fecha || new Date().toISOString().slice(0, 10),
          hora: null, tipo_movimiento: m.tipo, cantidad: m.cantidad,
          unidad: m.unidad || mat.unidad || 'Und',
          responsable_id, proveedor_id, frente_zona: frente, partida_id: null, ubicacion_id: ubicId,
          documento_asociado: null, precio_unitario_real: null, observaciones: obs,
        }, userId, null, sigMov(obraId, 'mov_materiales', m));
        if (r.dup) { duplicados++; continue; }

        if (ubicId) {
          try { await aplicarDelta({ obraId, itemTipo: 'material', itemId: mat.id, ubicacionId: ubicId, delta: m.tipo === 'entrada' ? m.cantidad : -m.cantidad, userId }); } catch {}
        }
        okCount++;
      } catch (e) { errores++; errorList.push({ row: m.idx, error: e.message || String(e) }); }
      if (i % 20 === 0) { setProgress({ current: i + 1, total: movs.length }); await new Promise(r => setTimeout(r, 0)); }
    }

    itemsCreados = matIdx.map.size - prevMat;
    ubicCreadas = ubicIdx.map.size - prevUbic;
    await recalcularStockMateriales(obraId, afectados, userId);
    fireChanged('materiales', 'movimientos_materiales', 'ubicaciones_obra', 'stock_ubicaciones');
    return { ok: okCount, errors: errores, saltadosNoAprobados, errorList,
      detalle: `${okCount} movimientos cargados · ${ubicCreadas} ubicaciones creadas${duplicados ? ` · ${duplicados} ya existían (re-subida)` : ''}${saltadosNoAprobados ? ` · ${saltadosNoAprobados} saltados (no aprobados)` : ''} · ${errores} con error` };
  };

  const runMovEpp = async (resolvedItems = null, rp = null) => {
    const movs = [...preview.movs].sort((a, b) => (a.fecha || '') < (b.fecha || '') ? -1 : 1);
    const eppIdx = await cargarIndice('epps', obraId, 'nombre_epp');
    if (resolvedItems) { for (const [k, info] of resolvedItems) eppIdx.map.set(k, { id: info.id, unidad: info.unidad }); }
    const ubicIdx = await cargarIndice('ubicaciones_obra', obraId, 'nombre');
    const personal = (await window.__db.personal.where('obra_id').equals(obraId).filter(p => !p.deleted_at).toArray());
    const proveedores = (await window.__db.proveedores.filter(p => !p.deleted_at).toArray());

    const resolverEpp = async (nombre, unidad) => {
      const k = normTxt(nombre);
      if (eppIdx.map.has(k)) return eppIdx.map.get(k);
      if (resolvedItems) return null; // no aprobado en revisión
      const rec = await addRecord('epps', {
        obra_id: obraId, nombre_epp: String(nombre).trim(), tipo_epp: detectarEPP(nombre) || 'Otro',
        unidad: unidad || 'Und', stock_inicial: 0, stock_actual: 0, stock_minimo: 0, alerta: 'ok', estado: 'activo',
      }, userId);
      eppIdx.map.set(k, rec); return rec;
    };
    const resolverUbic = async (nombre) => {
      const k = normTxt(nombre);
      if (!k) return null;
      if (ubicIdx.map.has(k)) return ubicIdx.map.get(k).id;
      const rec = await addRecord('ubicaciones_obra', {
        obra_id: obraId, nombre: String(nombre).trim(), descripcion: 'Creada en migración histórica',
        orden: ubicIdx.map.size + 1, activo: true,
      }, userId);
      ubicIdx.map.set(k, rec); return rec.id;
    };

    const firmas = await cargarFirmasMigracion('movimientos_epp', obraId, 'epp_id');
    let okCount = 0, errores = 0, saltadosNoAprobados = 0, duplicados = 0;
    const errorList = [];
    const afectados = new Set();
    const prevEpp = eppIdx.map.size;
    setProgress({ current: 0, total: movs.length });

    for (let i = 0; i < movs.length; i++) {
      const m = movs[i];
      try {
        if (!m.tipo) throw new Error('Tipo de movimiento no reconocido');
        if (!(m.cantidad > 0)) throw new Error('Cantidad inválida');
        if (!String(m.nombreItem || '').trim()) { saltadosNoAprobados++; continue; }
        if (esFilaInvalida(m)) { saltadosNoAprobados++; continue; }
        const epp = await resolverEpp(m.nombreItem, m.unidad);
        if (!epp) { saltadosNoAprobados++; continue; }
        const fechaMov = m.fecha || new Date().toISOString().slice(0, 10);
        if (consumirFirma(firmas, epp.id, fechaMov, m.tipo, m.cantidad)) { duplicados++; continue; }
        afectados.add(epp.id);
        const obsExtra = [];
        let proveedor_id = null, personal_id = null, subcontratista_id = null, destino_tipo = null, ubicId = null;

        if (m.tipo === 'entrada') {
          if (m.origen) { proveedor_id = matchProveedor(m.origen, proveedores); if (!proveedor_id) obsExtra.push(`Proveedor: ${m.origen}`); }
          if (m.lugar) ubicId = await resolverUbic(m.lugar);
        } else {
          const quien = m.responsable || m.origen;
          if (quien) {
            const rpHit = rp?.get(normTxt(quien));
            if (rpHit?.tipo === 'personal') { personal_id = rpHit.id; destino_tipo = 'personal'; }
            else if (rpHit?.tipo === 'subcontratista') { subcontratista_id = rpHit.id; destino_tipo = 'subcontratista'; }
            else { personal_id = matchPersonal(quien, personal); destino_tipo = personal_id ? 'personal' : null; if (!personal_id) obsExtra.push(`Entregado a: ${quien}`); }
          }
          if (m.lugar) obsExtra.push(`Lugar: ${m.lugar}`);
          ubicId = epp.ubicacion_id || (ubicIdx.rows[0]?.id ?? null);
        }
        const obs = ['Migración histórica', ...obsExtra].join(' · ');
        const r = await addMovIdem('movimientos_epp', {
          obra_id: obraId, epp_id: epp.id, fecha: m.fecha || new Date().toISOString().slice(0, 10),
          hora: null, tipo_movimiento: m.tipo, cantidad: m.cantidad, unidad: m.unidad || epp.unidad || 'Und',
          personal_id, subcontratista_id, destino_tipo, proveedor_id, ubicacion_id: ubicId, motivo: m.tipo === 'entrada' ? 'reposicion' : 'dotacion', observaciones: obs,
        }, userId, null, sigMov(obraId, 'mov_epp', m));
        if (r.dup) { duplicados++; continue; }

        if (ubicId) {
          try { await aplicarDelta({ obraId, itemTipo: 'epp', itemId: epp.id, ubicacionId: ubicId, delta: m.tipo === 'entrada' ? m.cantidad : -m.cantidad, userId }); } catch {}
        }
        okCount++;
      } catch (e) { errores++; errorList.push({ row: m.idx, error: e.message || String(e) }); }
      if (i % 20 === 0) { setProgress({ current: i + 1, total: movs.length }); await new Promise(r => setTimeout(r, 0)); }
    }

    await recalcularStockEpp(obraId, afectados, userId);
    fireChanged('epps', 'movimientos_epp', 'ubicaciones_obra', 'stock_ubicaciones');
    return { ok: okCount, errors: errores, saltadosNoAprobados, errorList,
      detalle: `${okCount} movimientos EPP cargados${duplicados ? ` · ${duplicados} ya existían (re-subida)` : ''}${saltadosNoAprobados ? ` · ${saltadosNoAprobados} saltados (no aprobados)` : ''} · ${errores} con error` };
  };

  const runMovHerramientas = async (resolvedItems = null, rp = null) => {
    const movs = [...preview.movs].sort((a, b) => (a.fecha || '') < (b.fecha || '') ? -1 : 1);
    const herrIdx = await cargarIndice('herramientas', obraId, 'nombre_herramienta');
    if (resolvedItems) { for (const [k, info] of resolvedItems) herrIdx.map.set(k, { id: info.id, unidad: info.unidad }); }
    const ubicIdx = await cargarIndice('ubicaciones_obra', obraId, 'nombre');
    const personal = (await window.__db.personal.where('obra_id').equals(obraId).filter(p => !p.deleted_at).toArray());
    const proveedores = (await window.__db.proveedores.filter(p => !p.deleted_at).toArray());

    const resolverHerr = async (nombre, unidad, estado) => {
      const k = normTxt(nombre);
      if (herrIdx.map.has(k)) return herrIdx.map.get(k);
      if (resolvedItems) return null; // no aprobado en revisión
      const rec = await addRecord('herramientas', {
        obra_id: obraId, nombre_herramienta: String(nombre).trim(), tipo_herramienta: 'manual',
        estado_actual: normEstadoHerr(estado), ubicacion_actual: 'almacen', disponible: true,
        maneja_cantidad: true, unidad: unidad || 'Und',
        stock_inicial: 0, stock_actual: 0, stock_minimo: 0, alerta: 'ok',
      }, userId);
      herrIdx.map.set(k, rec); return rec;
    };
    const resolverUbic = async (nombre) => {
      const k = normTxt(nombre);
      if (!k) return null;
      if (ubicIdx.map.has(k)) return ubicIdx.map.get(k).id;
      const rec = await addRecord('ubicaciones_obra', {
        obra_id: obraId, nombre: String(nombre).trim(), descripcion: 'Creada en migración histórica',
        orden: ubicIdx.map.size + 1, activo: true,
      }, userId);
      ubicIdx.map.set(k, rec); return rec.id;
    };

    const firmas = await cargarFirmasMigracion('movimientos_herramientas', obraId, 'herramienta_id');
    let okCount = 0, errores = 0, saltadosNoAprobados = 0, duplicados = 0;
    const errorList = [];
    const afectados = new Set();
    const prevHerr = herrIdx.map.size;
    setProgress({ current: 0, total: movs.length });

    for (let i = 0; i < movs.length; i++) {
      const m = movs[i];
      try {
        if (!m.tipo) throw new Error('Tipo de movimiento no reconocido');
        if (!(m.cantidad > 0)) throw new Error('Cantidad inválida');
        if (!String(m.nombreItem || '').trim()) { saltadosNoAprobados++; continue; }
        if (esFilaInvalida(m)) { saltadosNoAprobados++; continue; }
        const herr = await resolverHerr(m.nombreItem, m.unidad, m.estado);
        if (!herr) { saltadosNoAprobados++; continue; }
        const fechaMov = m.fecha || new Date().toISOString().slice(0, 10);
        if (consumirFirma(firmas, herr.id, fechaMov, m.tipo, m.cantidad)) { duplicados++; continue; }
        afectados.add(herr.id);
        const obsExtra = [];
        let proveedor_id = null, responsable_id = null, frente = null, ubicId = null;

        if (m.tipo === 'entrada') {
          if (m.origen) { proveedor_id = matchProveedor(m.origen, proveedores); if (!proveedor_id) obsExtra.push(`Proveedor: ${m.origen}`); }
          if (m.lugar) ubicId = await resolverUbic(m.lugar);
        } else {
          const quien = m.responsable || m.origen;
          if (quien) {
            const rpHit = rp?.get(normTxt(quien));
            if (rpHit?.tipo === 'personal') responsable_id = rpHit.id;
            else if (rpHit?.tipo === 'subcontratista') obsExtra.push(`Subcontrato: ${quien}`);
            else { responsable_id = matchPersonal(quien, personal); if (!responsable_id) obsExtra.push(`Responsable: ${quien}`); }
          }
          if (m.lugar) frente = m.lugar;
        }
        const obs = ['Migración histórica', ...obsExtra].join(' · ');
        // accion = tipo_movimiento (valores válidos del CHECK legacy).
        const r = await addMovIdem('movimientos_herramientas', {
          obra_id: obraId, herramienta_id: herr.id, fecha: m.fecha || new Date().toISOString().slice(0, 10),
          hora: null, accion: m.tipo, tipo_movimiento: m.tipo, cantidad: m.cantidad,
          responsable_id, proveedor_id, frente_zona: frente, ubicacion_id: ubicId, observaciones: obs,
        }, userId, null, sigMov(obraId, 'mov_herramientas', m));
        if (r.dup) { duplicados++; continue; }

        if (ubicId) {
          try { await aplicarDelta({ obraId, itemTipo: 'herramienta', itemId: herr.id, ubicacionId: ubicId, delta: m.tipo === 'entrada' ? m.cantidad : -m.cantidad, userId }); } catch {}
        }
        okCount++;
      } catch (e) { errores++; errorList.push({ row: m.idx, error: e.message || String(e) }); }
      if (i % 20 === 0) { setProgress({ current: i + 1, total: movs.length }); await new Promise(r => setTimeout(r, 0)); }
    }

    await recalcularStockHerramientas(obraId, afectados, userId);
    fireChanged('herramientas', 'movimientos_herramientas', 'ubicaciones_obra', 'stock_ubicaciones');
    return { ok: okCount, errors: errores, saltadosNoAprobados, errorList,
      detalle: `${okCount} movimientos de herramientas cargados${duplicados ? ` · ${duplicados} ya existían (re-subida)` : ''}${saltadosNoAprobados ? ` · ${saltadosNoAprobados} saltados (no aprobados)` : ''} · ${errores} con error` };
  };

  const runMovMaquinaria = async (resolvedItems = null, rp = null) => {
    const movs = [...preview.movs].sort((a, b) => (a.fecha || '') < (b.fecha || '') ? -1 : 1);
    const actIdx = await cargarIndice('activos_pesados', obraId, 'nombre', { porObra: false });
    if (resolvedItems) { for (const [k, info] of resolvedItems) actIdx.map.set(k, { id: info.id, unidad: info.unidad }); }
    const ubicIdx = await cargarIndice('ubicaciones_obra', obraId, 'nombre');
    const personal = (await window.__db.personal.where('obra_id').equals(obraId).filter(p => !p.deleted_at).toArray());
    const proveedores = (await window.__db.proveedores.filter(p => !p.deleted_at).toArray());

    const resolverActivo = async (nombre, unidad, estado) => {
      const k = normTxt(nombre);
      if (actIdx.map.has(k)) return actIdx.map.get(k);
      if (resolvedItems) return null; // no aprobado en revisión
      const rec = await addRecord('activos_pesados', {
        nombre: String(nombre).trim(), tipo: 'maquinaria', estado: 'operativo',
        obra_actual_id: obraId, obra_id: obraId, maneja_cantidad: true, unidad: unidad || 'Und',
        stock_actual: 0, stock_minimo: 0, alerta: 'ok', notas: 'Migración histórica',
      }, userId);
      actIdx.map.set(k, rec); return rec;
    };
    const resolverUbic = async (nombre) => {
      const k = normTxt(nombre);
      if (!k) return null;
      if (ubicIdx.map.has(k)) return ubicIdx.map.get(k).id;
      const rec = await addRecord('ubicaciones_obra', {
        obra_id: obraId, nombre: String(nombre).trim(), descripcion: 'Creada en migración histórica',
        orden: ubicIdx.map.size + 1, activo: true,
      }, userId);
      ubicIdx.map.set(k, rec); return rec.id;
    };

    const firmas = await cargarFirmasMigracion('movimientos_maquinaria', obraId, 'activo_id');
    let okCount = 0, errores = 0, saltadosNoAprobados = 0, duplicados = 0;
    const errorList = [];
    const afectados = new Set();
    const prevAct = actIdx.map.size;
    setProgress({ current: 0, total: movs.length });

    for (let i = 0; i < movs.length; i++) {
      const m = movs[i];
      try {
        if (!m.tipo) throw new Error('Tipo de movimiento no reconocido');
        if (!(m.cantidad > 0)) throw new Error('Cantidad inválida');
        if (!String(m.nombreItem || '').trim()) { saltadosNoAprobados++; continue; }
        if (esFilaInvalida(m)) { saltadosNoAprobados++; continue; }
        const act = await resolverActivo(m.nombreItem, m.unidad, m.estado);
        if (!act) { saltadosNoAprobados++; continue; }
        const fechaMov = m.fecha || new Date().toISOString().slice(0, 10);
        if (consumirFirma(firmas, act.id, fechaMov, m.tipo, m.cantidad)) { duplicados++; continue; }
        afectados.add(act.id);
        const obsExtra = [];
        let proveedor_id = null, responsable_id = null, subcontratista_id = null, frente = null, ubicId = null;

        if (m.tipo === 'entrada') {
          if (m.origen) { proveedor_id = matchProveedor(m.origen, proveedores); if (!proveedor_id) obsExtra.push(`Proveedor: ${m.origen}`); }
          if (m.lugar) ubicId = await resolverUbic(m.lugar);
        } else {
          const quien = m.responsable || m.origen;
          if (quien) {
            const rpHit = rp?.get(normTxt(quien));
            if (rpHit?.tipo === 'personal') responsable_id = rpHit.id;
            else if (rpHit?.tipo === 'subcontratista') subcontratista_id = rpHit.id;
            else { responsable_id = matchPersonal(quien, personal); if (!responsable_id) obsExtra.push(`Responsable: ${quien}`); }
          }
          if (m.lugar) frente = m.lugar;
        }
        const obs = ['Migración histórica', ...obsExtra].join(' · ');
        const r = await addMovIdem('movimientos_maquinaria', {
          obra_id: obraId, activo_id: act.id, fecha: m.fecha || new Date().toISOString().slice(0, 10),
          hora: null, tipo_movimiento: m.tipo, cantidad: m.cantidad, unidad: m.unidad || act.unidad || 'Und',
          responsable_id, subcontratista_id, proveedor_id, estado: m.estado || null, frente_zona: frente, observaciones: obs,
        }, userId, null, sigMov(obraId, 'mov_maquinaria', m));
        if (r.dup) { duplicados++; continue; }

        if (ubicId) {
          try { await aplicarDelta({ obraId, itemTipo: 'maquinaria', itemId: act.id, ubicacionId: ubicId, delta: m.tipo === 'entrada' ? m.cantidad : -m.cantidad, userId }); } catch {}
        }
        okCount++;
      } catch (e) { errores++; errorList.push({ row: m.idx, error: e.message || String(e) }); }
      if (i % 20 === 0) { setProgress({ current: i + 1, total: movs.length }); await new Promise(r => setTimeout(r, 0)); }
    }

    await recalcularStockMaquinaria(obraId, afectados, userId);
    fireChanged('activos_pesados', 'movimientos_maquinaria', 'ubicaciones_obra', 'stock_ubicaciones');
    return { ok: okCount, errors: errores, saltadosNoAprobados, errorList,
      detalle: `${okCount} movimientos de maquinaria cargados${duplicados ? ` · ${duplicados} ya existían (re-subida)` : ''}${saltadosNoAprobados ? ` · ${saltadosNoAprobados} saltados (no aprobados)` : ''} · ${errores} con error` };
  };

  const runInsumosEmergencia = async () => {
    const items = preview.items;
    let creados = 0, saltados = 0, errores = 0;
    const errorList = [];
    const idx = (await cargarIndice('insumos_emergencia', obraId, 'nombre')).map;
    setProgress({ current: 0, total: items.length });
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      try {
        if (idx.has(normTxt(it.nombre))) { saltados++; }
        else {
          const rec = await addRecord('insumos_emergencia', {
            obra_id: obraId, nombre: it.nombre, categoria: it.categoria || null, unidad: it.unidad || 'Und',
            stock_inicial: 0, stock_actual: 0, stock_minimo: 0, alerta: 'ok', estado: 'activo',
          }, userId, it.fechaCreacion);
          idx.set(normTxt(it.nombre), rec); creados++;
        }
      } catch (e) { errores++; errorList.push({ row: it.idx, error: e.message || String(e) }); }
      if (i % 20 === 0) { setProgress({ current: i + 1, total: items.length }); await new Promise(r => setTimeout(r, 0)); }
    }
    fireChanged('insumos_emergencia');
    return { ok: creados, saltados, errors: errores, errorList,
      detalle: `${creados} insumos de emergencia creados · ${saltados} ya existían · ${errores} con error` };
  };

  const runMovEmergencia = async (resolvedItems = null, rp = null) => {
    const movs = [...preview.movs].sort((a, b) => (a.fecha || '') < (b.fecha || '') ? -1 : 1);
    const insIdx = await cargarIndice('insumos_emergencia', obraId, 'nombre');
    if (resolvedItems) { for (const [k, info] of resolvedItems) insIdx.map.set(k, { id: info.id, unidad: info.unidad }); }
    const personal = (await window.__db.personal.where('obra_id').equals(obraId).filter(p => !p.deleted_at).toArray());
    const proveedores = (await window.__db.proveedores.filter(p => !p.deleted_at).toArray());

    const resolverInsumo = async (nombre, unidad) => {
      const k = normTxt(nombre);
      if (insIdx.map.has(k)) return insIdx.map.get(k);
      if (resolvedItems) return null;
      const rec = await addRecord('insumos_emergencia', {
        obra_id: obraId, nombre: String(nombre).trim(), categoria: null, unidad: unidad || 'Und',
        stock_inicial: 0, stock_actual: 0, stock_minimo: 0, alerta: 'ok', estado: 'activo',
      }, userId);
      insIdx.map.set(k, rec); return rec;
    };

    const firmas = await cargarFirmasMigracion('movimientos_insumos_emergencia', obraId, 'insumo_emergencia_id');
    let okCount = 0, errores = 0, saltadosNoAprobados = 0, duplicados = 0;
    const errorList = [];
    const afectados = new Set();
    const prevIns = insIdx.map.size;
    setProgress({ current: 0, total: movs.length });

    for (let i = 0; i < movs.length; i++) {
      const m = movs[i];
      try {
        if (!m.tipo) throw new Error('Tipo de movimiento no reconocido');
        if (!(m.cantidad > 0)) throw new Error('Cantidad inválida');
        if (!String(m.nombreItem || '').trim()) { saltadosNoAprobados++; continue; }
        if (esFilaInvalida(m)) { saltadosNoAprobados++; continue; }
        const ins = await resolverInsumo(m.nombreItem, m.unidad);
        if (!ins) { saltadosNoAprobados++; continue; }
        const fechaMov = m.fecha || new Date().toISOString().slice(0, 10);
        if (consumirFirma(firmas, ins.id, fechaMov, m.tipo, m.cantidad)) { duplicados++; continue; }
        afectados.add(ins.id);
        const obsExtra = [];
        let proveedor_id = null, responsable_id = null;
        if (m.tipo === 'entrada') {
          if (m.origen) { proveedor_id = matchProveedor(m.origen, proveedores); if (!proveedor_id) obsExtra.push(`Proveedor: ${m.origen}`); }
        } else {
          const quien = m.responsable || m.origen;
          if (quien) {
            const rpHit = rp?.get(normTxt(quien));
            if (rpHit?.tipo === 'personal') responsable_id = rpHit.id;
            else if (rpHit?.tipo === 'subcontratista') obsExtra.push(`Subcontrato: ${quien}`);
            else { responsable_id = matchPersonal(quien, personal); if (!responsable_id) obsExtra.push(`Responsable: ${quien}`); }
          }
        }
        if (m.lugar) obsExtra.push(`Lugar: ${m.lugar}`);
        const obs = ['Migración histórica', ...obsExtra].join(' · ');
        const r = await addMovIdem('movimientos_insumos_emergencia', {
          obra_id: obraId, insumo_emergencia_id: ins.id, fecha: m.fecha || new Date().toISOString().slice(0, 10),
          hora: null, tipo_movimiento: m.tipo, cantidad: m.cantidad, unidad: m.unidad || ins.unidad || 'Und',
          responsable_id, proveedor_id, observaciones: obs,
        }, userId, null, sigMov(obraId, 'mov_emergencia', m));
        if (r.dup) { duplicados++; continue; }
        okCount++;
      } catch (e) { errores++; errorList.push({ row: m.idx, error: e.message || String(e) }); }
      if (i % 20 === 0) { setProgress({ current: i + 1, total: movs.length }); await new Promise(r => setTimeout(r, 0)); }
    }

    await recalcularStockEmergencia(obraId, afectados, userId);
    fireChanged('insumos_emergencia', 'movimientos_insumos_emergencia');
    return { ok: okCount, errors: errores, saltadosNoAprobados, errorList,
      detalle: `${okCount} movimientos de emergencia cargados${duplicados ? ` · ${duplicados} ya existían (re-subida)` : ''}${saltadosNoAprobados ? ` · ${saltadosNoAprobados} saltados (no aprobados)` : ''} · ${errores} con error` };
  };

  const runMovMaquinariaAsignacionLoad = async (resolvedItems = null, rp = null) => {
    const movs = [...preview.movs].sort((a, b) => (a.fecha || '') < (b.fecha || '') ? -1 : 1);
    const actIdx = await cargarIndice('activos_pesados', obraId, 'nombre', { porObra: false });
    if (resolvedItems) { for (const [k, info] of resolvedItems) actIdx.map.set(k, { id: info.id, unidad: info.unidad }); }
    const personal = (await window.__db.personal.where('obra_id').equals(obraId).filter(p => !p.deleted_at).toArray());
    const subcontratistas = (await window.__db.subcontratistas.filter(s => !s.deleted_at).toArray());

    const resolverActivo = async (nombre) => {
      const k = normTxt(nombre);
      if (actIdx.map.has(k)) return actIdx.map.get(k);
      if (resolvedItems) return null;
      const rec = await addRecord('activos_pesados', {
        nombre: String(nombre).trim(), tipo: 'maquinaria', estado: 'operativo',
        obra_actual_id: obraId, obra_id: obraId, maneja_cantidad: false, notas: 'Migración histórica · custodia',
      }, userId);
      actIdx.map.set(k, rec); return rec;
    };
    const matchPers = (nombre) => matchPersonal(nombre, personal);
    const matchSub = (nombre) => {
      const t = normTxt(nombre); if (!t) return null;
      const s = subcontratistas.find(x => { const r = normTxt(x.razon_social); return r && (r === t || r.includes(t) || t.includes(r)); });
      return s?.id || null;
    };

    // Firmas existentes de asignaciones de migración (activo+fecha+tipo+destino).
    const firmasAsig = new Map();
    {
      const rows = await window.__db.movimientos_maquinaria.where('obra_id').equals(obraId).toArray();
      for (const mv of rows) {
        if (mv.deleted_at || mv.cantidad != null) continue; // cantidad null = asignación
        if (!String(mv.observaciones || '').includes('Migración histórica')) continue;
        const s = `${mv.activo_id}__${mv.fecha || ''}__${mv.tipo_movimiento || ''}__${mv.destino_tipo || ''}`;
        firmasAsig.set(s, (firmasAsig.get(s) || 0) + 1);
      }
    }
    let okCount = 0, errores = 0, saltadosNoAprobados = 0, duplicados = 0;
    const errorList = [];
    const prevAct = actIdx.map.size;
    // custodia final por activo (último movimiento gana, ya que vienen asc)
    const custodia = new Map();
    setProgress({ current: 0, total: movs.length });

    for (let i = 0; i < movs.length; i++) {
      const m = movs[i];
      try {
        if (!m.tipo) throw new Error('Movimiento no reconocido (usá Salida/Devolución)');
        if (!String(m.equipo || '').trim()) { saltadosNoAprobados++; continue; }
        const act = await resolverActivo(m.equipo);
        if (!act) { saltadosNoAprobados++; continue; }
        const obsExtra = [];
        let responsable_id = null, subcontratista_id = null, destino_tipo = null, destino_nombre = null;
        if (m.tipo === 'salida') {
          destino_tipo = m.destinoTipo || 'personal';
          const rpHit = rp?.get(normTxt(m.destinoNombre || ''));
          if (rpHit?.tipo === 'subcontratista') { subcontratista_id = rpHit.id; destino_tipo = 'subcontratista'; }
          else if (rpHit?.tipo === 'personal') { responsable_id = rpHit.id; destino_tipo = 'personal'; }
          else if (destino_tipo === 'subcontratista') {
            subcontratista_id = matchSub(m.destinoNombre);
            if (!subcontratista_id && m.destinoNombre) obsExtra.push(`Subcontrato: ${m.destinoNombre}`);
          } else {
            responsable_id = matchPers(m.destinoNombre);
            if (!responsable_id && m.destinoNombre) obsExtra.push(`Asignado a: ${m.destinoNombre}`);
          }
          destino_nombre = m.destinoNombre || null;
        }
        const fechaMov = m.fecha || new Date().toISOString().slice(0, 10);
        const firmaA = `${act.id}__${fechaMov}__${m.tipo}__${m.tipo === 'salida' ? (destino_tipo || '') : ''}`;
        if ((firmasAsig.get(firmaA) || 0) > 0) { firmasAsig.set(firmaA, firmasAsig.get(firmaA) - 1); duplicados++; continue; }
        const obs = ['Migración histórica', m.observaciones, ...obsExtra].filter(Boolean).join(' · ');
        const sigA = `${(obraId || '').slice(0, 8)}_asig_${m.idx}_${normTxt(m.equipo)}_${m.fecha || ''}_${m.tipo}_${normTxt(m.destinoNombre || '')}`;
        const r = await addMovIdem('movimientos_maquinaria', {
          obra_id: obraId, activo_id: act.id, fecha: m.fecha || new Date().toISOString().slice(0, 10),
          hora: null, tipo_movimiento: m.tipo, cantidad: null, unidad: null,
          responsable_id, subcontratista_id, destino_tipo, observaciones: obs,
        }, userId, null, sigA);
        if (r.dup) { duplicados++; continue; }
        // custodia final
        custodia.set(act.id, m.tipo === 'salida'
          ? { tipo: destino_tipo, id: responsable_id || subcontratista_id || null, nombre: destino_nombre, fecha: m.fecha }
          : null);
        okCount++;
      } catch (e) { errores++; errorList.push({ row: m.idx, error: e.message || String(e) }); }
      if (i % 20 === 0) { setProgress({ current: i + 1, total: movs.length }); await new Promise(r => setTimeout(r, 0)); }
    }

    // Aplicar custodia final a cada equipo afectado
    const now = new Date().toISOString();
    for (const [activoId, c] of custodia) {
      const a = await window.__db.activos_pesados.get(activoId);
      if (!a) continue;
      await window.__db.activos_pesados.update(activoId, {
        asignado_a_tipo: c?.tipo || null, asignado_a_id: c?.id || null,
        asignado_a_nombre: c?.nombre || null, fecha_asignacion: c?.fecha || null,
        updated_at: now, updated_by: userId, version: (a.version ?? 0) + 1,
        sync_status: a.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
    }
    fireChanged('activos_pesados', 'movimientos_maquinaria');
    return { ok: okCount, errors: errores, saltadosNoAprobados, errorList,
      detalle: `${okCount} asignaciones cargadas${duplicados ? ` · ${duplicados} ya existían (re-subida)` : ''}${saltadosNoAprobados ? ` · ${saltadosNoAprobados} saltados (no aprobados)` : ''} · ${errores} con error` };
  };

  // Llamado desde el paso "Revisar". Para movimientos lanza el escaneo de
  // items y salta al paso "Insumos"; los formatos de catálogo (insumos_emergencia)
  // se ejecutan directo a Resultado (no necesitan revisión).
  const ejecutar = async () => {
    if (!obraId) { showToast('No hay obra activa', 'red'); return; }
    if (!superAdmin) { showToast('Activá Super Admin para migrar históricos', 'red'); return; }
    if (esInsumosEmergencia) {
      setImp(true);
      try { const res = await runInsumosEmergencia(); setResult(res); setStep(4); showToast(res.detalle, res.errors ? 'amber' : 'green'); }
      catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
      finally { setImp(false); }
      return;
    }
    if (!esMov || !preview?.movs?.length) { showToast('No hay movimientos para procesar', 'red'); return; }
    setScanning(true);
    try {
      const rows = await escanearMovs(preview.movs, formato, obraId);
      const d = new Map();
      for (const r of rows) d.set(r.key, accionDefault(r));
      setScanRows(rows); setDecisiones(d);
      // Escaneo de responsables (col. G en salidas / "Asignado a").
      const pers = await escanearResponsables(preview.movs, formato, obraId);
      const dp = new Map();
      for (const r of pers) dp.set(r.key, accionPersonaDefault(r));
      setScanPersonas(pers); setDecisionesPersonas(dp);
      setStep(3); // Paso "Insumos"
    } catch (e) {
      showToast('Error al escanear: ' + (e.message || e), 'red');
    } finally { setScanning(false); }
  };

  // Llamado desde el paso "Insumos" — aplica decisiones y corre el loader.
  const confirmarYCargar = async () => {
    setImp(true);
    try {
      const dec = await aplicarDecisiones(scanRows, decisiones, formato, obraId, userId);
      const per = await aplicarDecisionesPersonas(scanPersonas || [], decisionesPersonas, obraId, userId);
      const rp = per.map; // Map(normNombre → {tipo, id})
      let res;
      if (formato === 'mov_materiales') res = await runMovMateriales(dec.resolved, rp);
      else if (formato === 'mov_epp') res = await runMovEpp(dec.resolved, rp);
      else if (formato === 'mov_herramientas') res = await runMovHerramientas(dec.resolved, rp);
      else if (formato === 'mov_maquinaria') res = await runMovMaquinaria(dec.resolved, rp);
      else if (formato === 'mov_emergencia') res = await runMovEmergencia(dec.resolved, rp);
      else if (esAsignacion) res = await runMovMaquinariaAsignacionLoad(dec.resolved, rp);
      else { setImp(false); return; }
      const persMsg = (per.creadosPers || per.creadosSub) ? ` · ${per.creadosPers} personal + ${per.creadosSub} subcontratos creados` : '';
      res = { ...res, detalle: `${res.detalle} · ${dec.creados} insumos creados · ${dec.reemplazados} actualizados · ${dec.saltados} insumos saltados${persMsg}` };
      setResult(res);
      setStep(4);
      showToast(res.detalle, res.errors ? 'amber' : 'green');
    } catch (e) {
      showToast('Error en la migración: ' + (e.message || e), 'red');
    } finally { setImp(false); }
  };

  const reiniciar = () => {
    setStep(0); setFile(null); setParsed(null); setParseErr(null); setFormato(null); setResult(null);
    setProgress({ current: 0, total: 0 });
    setScanRows(null); setDecisiones(new Map());
    setScanPersonas(null); setDecisionesPersonas(new Map());
  };

  // Acciones globales del paso "Insumos".
  const accionGlobal = (modo) => {
    if (!scanRows) return;
    const next = new Map(decisiones);
    for (const r of scanRows) {
      if (modo === 'crear_nuevos' && r.status === 'new') next.set(r.key, 'crear');
      else if (modo === 'saltar_nuevos' && r.status === 'new') next.set(r.key, 'saltar');
      else if (modo === 'reemplazar_dif' && r.status === 'diff') next.set(r.key, 'reemplazar');
      else if (modo === 'saltar_dif' && r.status === 'diff') next.set(r.key, 'saltar');
      else if (modo === 'crear_otros' && r.status === 'other') next.set(r.key, 'crear');
      else if (modo === 'saltar_otros' && r.status === 'other') next.set(r.key, 'saltar');
    }
    setDecisiones(next);
  };

  // ── RENDER ──────────────────────────────────────────────────────────
  return (
    <div>
      <Steps current={step} steps={STEPS_MIG} onJump={(i) => i < step && !importing ? setStep(i) : null} />

      {/* Step 0 — Aviso */}
      {step === 0 && (
        <div>
          <div className="card card-p" style={{ background: 'rgba(155,89,182,0.08)', border: '1px solid rgba(155,89,182,0.3)', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <JxIcon name="alert" size={18} color="#9B59B6" />
              <span style={{ fontSize: 15, fontWeight: 800, color: '#9B59B6' }}>Migración histórica (Super Admin)</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--ts)', lineHeight: 1.65 }}>
              Carga masiva de los movimientos que la obra registró en papel/Excel antes de usar JARVEX, <strong>respetando las fechas reales</strong>.
              <br /><br />
              <strong>Cómo funciona:</strong>
              <ol style={{ margin: '6px 0 0 18px', padding: 0 }}>
                <li>Subís cada archivo de <strong>Movimientos</strong> (Materiales, Herramientas, EPP, Maquinaria, Emergencia).</li>
                <li>Antes de cargar, una <strong>revisión de insumos</strong> te muestra cuáles existen, cuáles son nuevos y cuáles ya están en otro inventario — vos decidís crear, reemplazar o saltar.</li>
                <li>Re-subir el mismo archivo es seguro: los movimientos ya cargados <strong>no se duplican</strong>.</li>
              </ol>
            </div>
          </div>
          {superAdmin && (
            <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn btn-ghost btn-sm" disabled={limpiando} onClick={async () => {
                if (!confirm('Limpieza local: borra de ESTE dispositivo los insumos sin nombre y los movimientos huérfanos de migraciones anteriores que nunca se sincronizaron. El servidor no se toca. ¿Continuar?')) return;
                setLimpiando(true);
                try { const r = await limpiarBasuraMigracion(); showToast(`Limpieza: ${r.itemsBorrados} insumos + ${r.movsBorrados} movimientos corruptos borrados`, 'green'); }
                catch (e) { showToast('Error en limpieza: ' + (e.message || e), 'red'); }
                finally { setLimpiando(false); }
              }}>
                <JxIcon name="trash" size={13} />{limpiando ? 'Limpiando…' : 'Limpiar registros corruptos (locales)'}
              </button>
              <button className="btn btn-ghost btn-sm" disabled={limpiando} onClick={async () => {
                if (!obraId) { showToast('No hay obra activa', 'red'); return; }
                if (!confirm('Quita los movimientos de migración DUPLICADOS (mismo insumo, fecha, tipo y cantidad), dejando uno solo, y recalcula el stock. Los que ya están en el servidor se borran también al sincronizar. ¿Continuar?')) return;
                setLimpiando(true);
                try { const r = await quitarMovsDuplicadosMigracion(obraId, userId); showToast(`${r.borrados} movimientos duplicados quitados · stock recalculado`, 'green'); }
                catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
                finally { setLimpiando(false); }
              }}>
                <JxIcon name="trash" size={13} />Quitar movimientos duplicados
              </button>
              <span style={{ fontSize: 11, color: 'var(--tm)' }}>Limpieza de imports anteriores: insumos sin nombre, movimientos huérfanos y duplicados.</span>
            </div>
          )}
          {!superAdmin && (
            <div className="alert-banner" style={{ marginBottom: 14, background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.3)', color: 'var(--red)' }}>
              <JxIcon name="alert" size={14} color="var(--red)" />
              <span>Super Admin está <strong>desactivado</strong>. Activalo (engranaje → Super Admin) para poder cargar fechas históricas.</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button className="btn btn-ghost" onClick={onReset}><JxIcon name="chevL" size={14} />Volver al inicio</button>
            <button className="btn btn-amber" disabled={!superAdmin} onClick={() => setStep(1)} style={{ opacity: superAdmin ? 1 : .4 }}>
              Empezar <JxIcon name="chevR" size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Step 1 — Archivo */}
      {step === 1 && (
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--tp)', marginBottom: 4 }}>Subí el archivo Excel</div>
          <div style={{ fontSize: 12.5, color: 'var(--tm)', marginBottom: 12 }}>Detecto automáticamente el formato por sus columnas. ¿No tenés el archivo? Descargá la plantilla del tipo que vas a cargar:</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
            <select className="fi" style={{ width: 'auto', flex: '1 1 280px' }} value={plantillaSel} onChange={(e) => setPlantillaSel(e.target.value)}>
              {Object.values(FORMATOS).map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
            <button className="btn btn-ghost btn-sm" onClick={() => descargarPlantilla(plantillaSel)}><JxIcon name="file" size={13} />Descargar plantilla</button>
          </div>
          <label style={{ display: 'block', border: '2px dashed var(--border)', borderRadius: 10, padding: '28px 20px', textAlign: 'center', cursor: 'pointer', background: 'var(--bg-c)' }}>
            <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0] || null)} />
            <JxIcon name="file" size={28} color="var(--amber)" />
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tp)', marginTop: 8 }}>{file ? file.name : 'Elegí un archivo .xlsx / .xls'}</div>
            <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 4 }}>Máx. 10 MB</div>
          </label>

          {parseErr && <div className="alert-banner" style={{ marginTop: 12, background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.3)', color: 'var(--red)' }}><JxIcon name="alert" size={14} color="var(--red)" /><span>{parseErr}</span></div>}

          {parsed && formato && (
            <div className="card card-p" style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--tm)', marginBottom: 6 }}>Formato detectado</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <JxIcon name={fmtMeta.icon} size={18} color="var(--amber)" />
                <select value={formato} onChange={(e) => setFormato(e.target.value)} className="fi" style={{ fontWeight: 700, width: 'auto', flex: 1 }}>
                  {Object.values(FORMATOS).map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              </div>
              <div style={{ fontSize: 12, color: 'var(--tm)' }}>{fmtMeta.desc}</div>
              <div style={{ fontSize: 11.5, color: 'var(--ts)', marginTop: 8 }}>{parsed.rows.length} filas · columnas: {parsed.headers.join(' · ')}</div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18 }}>
            <button className="btn btn-ghost" onClick={() => setStep(0)}><JxIcon name="chevL" size={14} />Atrás</button>
            <button className="btn btn-amber" disabled={!parsed || !formato} onClick={() => setStep(2)} style={{ opacity: (parsed && formato) ? 1 : .4 }}>Revisar <JxIcon name="chevR" size={14} /></button>
          </div>
        </div>
      )}

      {/* Step 2 — Revisar */}
      {step === 2 && preview && (
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--tp)', marginBottom: 12 }}>Revisá antes de cargar</div>

          {preview.tipo === 'insumos' && (
            <div className="card card-p" style={{ marginBottom: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12 }}>
                {[['Materiales', preview.porTipo.materiales, '#3498DB'], ['Herramientas', preview.porTipo.herramientas, '#F28C28'], ['Maquinaria', preview.porTipo.activos_pesados, '#8E44AD'], ['EPP', preview.porTipo.epps, '#2ECC71'], ['Emergencia', preview.porTipo.insumos_emergencia, '#9B59B6']].map(([lbl, n, c]) => (
                  <div key={lbl} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: c }}>{n}</div>
                    <div style={{ fontSize: 11, color: 'var(--tm)' }}>{lbl}</div>
                  </div>
                ))}
              </div>
              {preview.porTipo.desconocido > 0 && (
                <div style={{ fontSize: 12, color: 'var(--amber)', marginTop: 10 }}>⚠️ {preview.porTipo.desconocido} fila(s) con Tipo no reconocido (no se crearán).</div>
              )}
              <div style={{ fontSize: 12, color: 'var(--tm)', marginTop: 10 }}>Se crea el catálogo sin stock ni movimientos. Los insumos que ya existan (por nombre) se saltan.</div>
            </div>
          )}

          {preview.tipo === 'insumos_emergencia' && (
            <div className="card card-p" style={{ marginBottom: 14 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#2ECC71' }}>{preview.total}</div>
                <div style={{ fontSize: 11, color: 'var(--tm)' }}>Insumos de emergencia</div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--tm)', marginTop: 10 }}>Se crean en el inventario de Seguridad → Insumos de Emergencia, sin stock ni movimientos. Los que ya existan (por nombre) se saltan.</div>
            </div>
          )}

          {preview.tipo === 'mov' && (
            <div className="card card-p" style={{ marginBottom: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 24, fontWeight: 800, color: 'var(--green)' }}>{preview.resumen.entradas}</div><div style={{ fontSize: 11, color: 'var(--tm)' }}>Ingresos</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 24, fontWeight: 800, color: 'var(--red)' }}>{preview.resumen.salidas}</div><div style={{ fontSize: 11, color: 'var(--tm)' }}>Salidas</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 24, fontWeight: 800, color: 'var(--tp)' }}>{preview.resumen.itemsUnicos}</div><div style={{ fontSize: 11, color: 'var(--tm)' }}>Insumos distintos</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 24, fontWeight: 800, color: 'var(--amber)' }}>{preview.resumen.sinTipo + preview.resumen.sinFecha + preview.resumen.sinCantidad}</div><div style={{ fontSize: 11, color: 'var(--tm)' }}>A revisar</div></div>
              </div>
              {(preview.resumen.sinTipo || preview.resumen.sinFecha || preview.resumen.sinCantidad) > 0 && (
                <div style={{ fontSize: 12, color: 'var(--amber)', marginTop: 10 }}>
                  ⚠️ {preview.resumen.sinTipo} sin tipo · {preview.resumen.sinFecha} sin fecha (usan hoy) · {preview.resumen.sinCantidad} sin cantidad válida.
                </div>
              )}
            </div>
          )}

          {preview.tipo === 'mov_asignacion' && (
            <div className="card card-p" style={{ marginBottom: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 24, fontWeight: 800, color: 'var(--amber)' }}>{preview.salidas}</div><div style={{ fontSize: 11, color: 'var(--tm)' }}>Salidas (asignaciones)</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 24, fontWeight: 800, color: 'var(--green)' }}>{preview.devoluciones}</div><div style={{ fontSize: 11, color: 'var(--tm)' }}>Devoluciones</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 24, fontWeight: 800, color: 'var(--tp)' }}>{preview.equipos}</div><div style={{ fontSize: 11, color: 'var(--tm)' }}>Equipos distintos</div></div>
              </div>
              {preview.sinTipo > 0 && <div style={{ fontSize: 12, color: 'var(--amber)', marginTop: 10 }}>⚠️ {preview.sinTipo} fila(s) sin Movimiento reconocido (usá "Salida" o "Devolución").</div>}
              <div style={{ fontSize: 12, color: 'var(--tm)', marginTop: 10 }}>Aplica la custodia en orden de fecha; el último movimiento define quién tiene cada equipo. Equipos/personas que no existan se crean o quedan anotados en observaciones.</div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button className="btn btn-ghost" onClick={() => setStep(1)} disabled={importing}><JxIcon name="chevL" size={14} />Atrás</button>
            <button className="btn btn-amber" disabled={importing || scanning || (esMov && !movHabilitado)} onClick={ejecutar}>
              {scanning ? 'Escaneando insumos…' : importing ? `Cargando… ${progress.current}/${progress.total}` : <>{esMov ? 'Revisar insumos' : 'Cargar a JARVEX'} <JxIcon name="chevR" size={14} /></>}
            </button>
          </div>
          {importing && progress.total > 0 && (
            <div style={{ height: 6, background: 'var(--bg-s)', borderRadius: 4, marginTop: 12, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.round(progress.current / progress.total * 100)}%`, background: 'var(--amber)', transition: 'width .2s' }} />
            </div>
          )}
        </div>
      )}

      {/* Step 3 — Insumos (revisión item-por-item antes de cargar) */}
      {step === 3 && scanRows && (() => {
        const cuentas = { new: 0, diff: 0, other: 0, same: 0 };
        for (const r of scanRows) cuentas[r.status]++;
        const STATUS_META = {
          new:   { label: 'Nuevos', color: '#3498DB', desc: 'No existen en ningún inventario' },
          diff:  { label: 'Con diferencias', color: '#F2B705', desc: 'Existen pero con otra unidad' },
          other: { label: 'En otro inventario', color: '#9B59B6', desc: 'Existen pero en otra tabla' },
          same:  { label: 'Iguales', color: '#2ECC71', desc: 'Ya existen — se usan como están' },
        };
        const ordenStatus = ['new', 'diff', 'other', 'same'];
        return (
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--tp)', marginBottom: 6 }}>Revisar insumos detectados</div>
            <div style={{ fontSize: 12.5, color: 'var(--tm)', marginBottom: 14 }}>Buscamos cada item en Materiales, Herramientas, EPP, Maquinaria e Insumos de Emergencia. Decidí qué hacer con cada uno antes de cargar los movimientos.</div>

            {/* Problemas de calidad del archivo (no se importan, corregí el Excel) */}
            {validacionMov && (validacionMov.conflictoUnidad.length > 0 || validacionMov.stockNeg.length > 0) && (
              <div className="card card-p" style={{ marginBottom: 14, background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.35)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <JxIcon name="alert" size={16} color="var(--red)" />
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--red)' }}>Problemas en el archivo — estas filas NO se importarán</span>
                </div>
                {validacionMov.conflictoUnidad.length > 0 && (
                  <div style={{ marginBottom: validacionMov.stockNeg.length ? 10 : 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ts)', marginBottom: 4 }}>Unidades inconsistentes ({validacionMov.conflictoUnidad.length})</div>
                    <div style={{ fontSize: 11.5, color: 'var(--tm)', marginBottom: 6 }}>Un insumo no puede tener dos unidades distintas (ej. clavos en Kg y en cajas). Corregí el Excel para que cada insumo use una sola unidad.</div>
                    {validacionMov.conflictoUnidad.map(c => (
                      <div key={c.key} style={{ fontSize: 12, color: 'var(--ts)', padding: '3px 0' }}>• <strong>{c.nombre}</strong>: usa {c.unidades.map(u => `"${u}"`).join(' y ')}</div>
                    ))}
                  </div>
                )}
                {validacionMov.stockNeg.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ts)', marginBottom: 4 }}>Salidas que dejarían stock negativo ({validacionMov.stockNeg.length})</div>
                    <div style={{ fontSize: 11.5, color: 'var(--tm)', marginBottom: 6 }}>No se puede sacar más de lo que entró. Revisá si falta una entrada previa o si la cantidad está mal.</div>
                    <div style={{ maxHeight: 160, overflow: 'auto' }}>
                      {validacionMov.stockNeg.map((s, i) => (
                        <div key={i} style={{ fontSize: 12, color: 'var(--ts)', padding: '3px 0' }}>• Fila {s.idx} · <strong>{s.nombre}</strong> · {s.fecha || 'sin fecha'}: salida de {s.cantidad}, pero solo hay {s.disponible} disponible.</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 14 }}>
              {ordenStatus.map(s => (
                <div key={s} className="card card-p" style={{ textAlign: 'center', borderLeft: `3px solid ${STATUS_META[s].color}` }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: STATUS_META[s].color }}>{cuentas[s]}</div>
                  <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 2 }}>{STATUS_META[s].label}</div>
                </div>
              ))}
            </div>
            {/* Acciones globales */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {cuentas.new > 0 && <><button className="btn btn-ghost btn-xs" onClick={() => accionGlobal('crear_nuevos')}>Crear todos los nuevos</button><button className="btn btn-ghost btn-xs" onClick={() => accionGlobal('saltar_nuevos')}>Saltar todos los nuevos</button></>}
              {cuentas.diff > 0 && <><button className="btn btn-ghost btn-xs" onClick={() => accionGlobal('reemplazar_dif')}>Reemplazar todas las diferencias</button><button className="btn btn-ghost btn-xs" onClick={() => accionGlobal('saltar_dif')}>Saltar todas las diferencias</button></>}
              {cuentas.other > 0 && <><button className="btn btn-ghost btn-xs" onClick={() => accionGlobal('crear_otros')}>Crear todos los de otro inventario</button><button className="btn btn-ghost btn-xs" onClick={() => accionGlobal('saltar_otros')}>Saltar todos los de otro inventario</button></>}
            </div>
            {/* Lista de items agrupada por status */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '50vh', overflow: 'auto', paddingRight: 6 }}>
              {ordenStatus.filter(s => cuentas[s] > 0).map(s => (
                <div key={s}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: STATUS_META[s].color, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.04em' }}>{STATUS_META[s].label} · {cuentas[s]} <span style={{ color: 'var(--tm)', fontWeight: 400, textTransform: 'none' }}>· {STATUS_META[s].desc}</span></div>
                  <div className="card" style={{ overflow: 'hidden' }}>
                    {scanRows.filter(r => r.status === s).map((r, idx) => {
                      const acc = decisiones.get(r.key) || accionDefault(r);
                      const opciones = r.status === 'same' ? [['mantener', 'Usar existente']]
                        : r.status === 'diff' ? [['saltar', 'Saltar (mantener catálogo)'], ['reemplazar', `Reemplazar (unidad → ${r.unidadExcel || '?'})`]]
                        : r.status === 'other' ? [['saltar', 'Saltar'], ['crear', `Crear nuevo en ${LABEL_TABLA[r.expectedTabla]}`]]
                        : [['crear', `Crear en ${LABEL_TABLA[r.expectedTabla]}`], ['saltar', 'Saltar']];
                      return (
                        <div key={r.key} style={{ padding: '8px 12px', borderTop: idx > 0 ? '1px solid var(--border)' : 'none', display: 'grid', gridTemplateColumns: '1.6fr 1fr 1.2fr', gap: 10, alignItems: 'center' }}>
                          <div>
                            <div style={{ fontSize: 12.5, color: 'var(--tp)', fontWeight: 600 }}>{r.nombre}</div>
                            <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 2 }}>{r.count} movimiento{r.count !== 1 ? 's' : ''} · unidad: {r.unidadExcel || '—'}</div>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--tm)' }}>
                            {r.existing ? <>📌 {LABEL_TABLA[r.existing.tabla]}{r.existing.unidad ? ` · ${r.existing.unidad}` : ''}</> : '—'}
                          </div>
                          <select className="fi" style={{ fontSize: 12, padding: '6px 10px' }} value={acc} onChange={e => { const next = new Map(decisiones); next.set(r.key, e.target.value); setDecisiones(next); }}>
                            {opciones.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Responsables (col. G en salidas / "Asignado a") */}
            {scanPersonas && scanPersonas.length > 0 && (() => {
              const nuevos = scanPersonas.filter(r => r.status === 'new');
              return (
                <div style={{ marginTop: 18 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tp)', marginBottom: 4 }}>Responsables de salidas <span style={{ color: 'var(--tm)', fontWeight: 400 }}>· {scanPersonas.length} distintos{nuevos.length ? ` · ${nuevos.length} no existen` : ''}</span></div>
                  <div style={{ fontSize: 12, color: 'var(--tm)', marginBottom: 8 }}>A quién se le entregó/asignó. Los que no existen podés crearlos como Personal o Subcontratista, o ignorarlos (quedan anotados en observaciones).</div>
                  {nuevos.length > 1 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                      <button className="btn btn-ghost btn-xs" onClick={() => { const n = new Map(decisionesPersonas); for (const r of scanPersonas) if (r.status === 'new') n.set(r.key, 'crear_personal'); setDecisionesPersonas(n); }}>Crear todos como Personal</button>
                      <button className="btn btn-ghost btn-xs" onClick={() => { const n = new Map(decisionesPersonas); for (const r of scanPersonas) if (r.status === 'new') n.set(r.key, 'crear_sub'); setDecisionesPersonas(n); }}>Crear todos como Subcontrato</button>
                      <button className="btn btn-ghost btn-xs" onClick={() => { const n = new Map(decisionesPersonas); for (const r of scanPersonas) if (r.status === 'new') n.set(r.key, 'ignorar'); setDecisionesPersonas(n); }}>Ignorar todos</button>
                    </div>
                  )}
                  <div className="card" style={{ overflow: 'hidden', maxHeight: '32vh', overflowY: 'auto' }}>
                    {scanPersonas.map((r, idx) => {
                      const acc = decisionesPersonas.get(r.key) || accionPersonaDefault(r);
                      const opciones = r.status === 'matched_personal' ? [['usar_personal', 'Usar (personal existente)'], ['ignorar', 'Ignorar']]
                        : r.status === 'matched_sub' ? [['usar_sub', 'Usar (subcontrato existente)'], ['ignorar', 'Ignorar']]
                        : [['crear_personal', 'Crear como Personal'], ['crear_sub', 'Crear como Subcontrato'], ['ignorar', 'Ignorar']];
                      const badge = r.status === 'new' ? { t: 'No existe', c: '#3498DB' } : r.status === 'matched_sub' ? { t: 'Subcontrato', c: '#9B59B6' } : { t: 'Personal', c: '#2ECC71' };
                      return (
                        <div key={r.key} style={{ padding: '8px 12px', borderTop: idx > 0 ? '1px solid var(--border)' : 'none', display: 'grid', gridTemplateColumns: '1.6fr 0.8fr 1.4fr', gap: 10, alignItems: 'center' }}>
                          <div>
                            <div style={{ fontSize: 12.5, color: 'var(--tp)', fontWeight: 600 }}>{r.nombre}</div>
                            <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 2 }}>{r.count} salida{r.count !== 1 ? 's' : ''}</div>
                          </div>
                          <span style={{ fontSize: 10.5, color: badge.c, fontWeight: 700 }}>{badge.t}</span>
                          <select className="fi" style={{ fontSize: 12, padding: '6px 10px' }} value={acc} onChange={e => { const next = new Map(decisionesPersonas); next.set(r.key, e.target.value); setDecisionesPersonas(next); }}>
                            {opciones.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              <button className="btn btn-ghost" onClick={() => setStep(2)} disabled={importing}><JxIcon name="chevL" size={14} />Atrás</button>
              <button className="btn btn-amber" disabled={importing} onClick={confirmarYCargar}>
                {importing ? `Cargando… ${progress.current}/${progress.total}` : <>Confirmar y cargar <JxIcon name="chevR" size={14} /></>}
              </button>
            </div>
            {importing && progress.total > 0 && (
              <div style={{ height: 6, background: 'var(--bg-s)', borderRadius: 4, marginTop: 12, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.round(progress.current / progress.total * 100)}%`, background: 'var(--amber)', transition: 'width .2s' }} />
              </div>
            )}
          </div>
        );
      })()}

      {/* Step 4 — Resultado */}
      {step === 4 && result && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '30px 20px', gap: 16, textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: result.errors ? 'rgba(242,183,5,0.15)' : 'rgba(46,204,113,0.15)', border: `2px solid ${result.errors ? 'var(--amber)' : 'var(--green)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <JxIcon name={result.errors ? 'alert' : 'checkCircle'} size={28} color={result.errors ? 'var(--amber)' : 'var(--green)'} />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--tp)', marginBottom: 6 }}>{result.errors ? 'Migración con advertencias' : 'Migración completada'}</div>
            <div style={{ fontSize: 13, color: 'var(--ts)' }}>{result.detalle}</div>
          </div>
          {result.errorList?.length > 0 && (
            <details style={{ width: '100%', maxWidth: 560, textAlign: 'left' }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--amber)', fontWeight: 600, padding: '8px 0' }}>Ver {result.errorList.length} con error</summary>
              <div style={{ maxHeight: 240, overflow: 'auto', background: 'var(--bg-c)', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                {result.errorList.map((e, i) => (
                  <div key={i} style={{ fontSize: 11.5, padding: '4px 0', borderBottom: '1px solid var(--border)', color: 'var(--ts)' }}>
                    <strong style={{ color: 'var(--red)' }}>Fila {e.row}:</strong> {e.error}
                  </div>
                ))}
              </div>
            </details>
          )}
          {/* Organización post-import: variantes (genéricos) y duplicados */}
          {ORG_CONFIG[TABLA_POR_FORMATO[formato]] && (
            <OrganizacionSugerida tabla={TABLA_POR_FORMATO[formato]} obraId={obraId} userId={userId} showToast={showToast} />
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" onClick={reiniciar}><JxIcon name="arrowIn" size={13} />Migrar otro archivo</button>
            <button className="btn btn-amber" onClick={onReset}><JxIcon name="check" size={13} />Terminar</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Indicador de pasos local (mismo look que el wizard principal).
function Steps({ current, steps, onJump }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24 }}>
      {steps.map((s, i) => {
        const done = i < current, active = i === current;
        return (
          <React.Fragment key={i}>
            <div onClick={done ? () => onJump(i) : undefined} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: done ? 'pointer' : 'default' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700,
                background: active ? 'var(--amber)' : done ? 'rgba(46,204,113,0.18)' : 'var(--bg-s)',
                color: active ? '#0c1118' : done ? 'var(--green)' : 'var(--tm)',
                border: `1.5px solid ${active ? 'var(--amber)' : done ? 'var(--green)' : 'var(--border)'}` }}>
                {done ? <JxIcon name="check" size={14} color="var(--green)" /> : i + 1}
              </div>
              <span style={{ fontSize: 11, color: active ? 'var(--tp)' : 'var(--tm)', fontWeight: active ? 700 : 500 }}>{s}</span>
            </div>
            {i < steps.length - 1 && <div style={{ flex: 1, height: 2, background: i < current ? 'var(--green)' : 'var(--border)', margin: '0 8px', marginBottom: 18 }} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Recálculo de stock desde movimientos (igual que el botón "Recalcular") ──
async function recalcularStockMateriales(obraId, idsAfectados, userId) {
  if (!idsAfectados?.size) return;
  const movs = await window.__db.movimientos_materiales.where('obra_id').equals(obraId).toArray();
  const sums = new Map(); const ent = new Map(); const sal = new Map();
  for (const mv of movs) {
    if (mv.reverses_id || mv.reversed_by_id || mv.deleted_at) continue;
    if (!idsAfectados.has(mv.material_id)) continue;
    const c = Number(mv.cantidad || 0);
    if (mv.tipo_movimiento === 'entrada') { sums.set(mv.material_id, (sums.get(mv.material_id) || 0) + c); ent.set(mv.material_id, (ent.get(mv.material_id) || 0) + c); }
    else if (mv.tipo_movimiento === 'salida') { sums.set(mv.material_id, (sums.get(mv.material_id) || 0) - c); sal.set(mv.material_id, (sal.get(mv.material_id) || 0) + c); }
  }
  const now = new Date().toISOString();
  for (const id of idsAfectados) {
    const mat = await window.__db.materiales.get(id);
    if (!mat) continue;
    const stock = Math.max(0, sums.get(id) || 0);
    await window.__db.materiales.update(id, {
      stock_actual: stock, total_entradas: ent.get(id) || 0, total_salidas: sal.get(id) || 0,
      alerta: calcAlerta(stock, Number(mat.stock_minimo || 0)),
      updated_at: now, updated_by: userId,
      version: (mat.version ?? 0) + 1,
      sync_status: mat.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
    });
  }
}

async function recalcularStockHerramientas(obraId, idsAfectados, userId) {
  if (!idsAfectados?.size) return;
  const movs = await window.__db.movimientos_herramientas.where('obra_id').equals(obraId).toArray();
  const sums = new Map();
  for (const mv of movs) {
    if (mv.reverses_id || mv.reversed_by_id || mv.deleted_at) continue;
    if (!idsAfectados.has(mv.herramienta_id)) continue;
    // Solo movimientos de cantidad (la migración los crea con cantidad+tipo).
    if (mv.cantidad == null) continue;
    const c = Number(mv.cantidad || 0);
    const tipo = mv.tipo_movimiento || mv.accion;
    if (tipo === 'entrada') sums.set(mv.herramienta_id, (sums.get(mv.herramienta_id) || 0) + c);
    else if (tipo === 'salida') sums.set(mv.herramienta_id, (sums.get(mv.herramienta_id) || 0) - c);
  }
  const now = new Date().toISOString();
  for (const id of idsAfectados) {
    const h = await window.__db.herramientas.get(id);
    if (!h) continue;
    const stock = Math.max(0, sums.get(id) || 0);
    await window.__db.herramientas.update(id, {
      stock_actual: stock, alerta: calcAlerta(stock, Number(h.stock_minimo || 0)),
      updated_at: now, updated_by: userId,
      version: (h.version ?? 0) + 1,
      sync_status: h.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
    });
  }
}

async function recalcularStockMaquinaria(obraId, idsAfectados, userId) {
  if (!idsAfectados?.size) return;
  const movs = await window.__db.movimientos_maquinaria.where('obra_id').equals(obraId).toArray();
  const sums = new Map();
  for (const mv of movs) {
    if (mv.reverses_id || mv.reversed_by_id || mv.deleted_at) continue;
    if (!idsAfectados.has(mv.activo_id)) continue;
    const c = Number(mv.cantidad || 0);
    if (mv.tipo_movimiento === 'entrada') sums.set(mv.activo_id, (sums.get(mv.activo_id) || 0) + c);
    else if (mv.tipo_movimiento === 'salida') sums.set(mv.activo_id, (sums.get(mv.activo_id) || 0) - c);
  }
  const now = new Date().toISOString();
  for (const id of idsAfectados) {
    const a = await window.__db.activos_pesados.get(id);
    if (!a) continue;
    const stock = Math.max(0, sums.get(id) || 0);
    await window.__db.activos_pesados.update(id, {
      stock_actual: stock, alerta: calcAlerta(stock, Number(a.stock_minimo || 0)),
      updated_at: now, updated_by: userId,
      version: (a.version ?? 0) + 1,
      sync_status: a.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
    });
  }
}

async function recalcularStockEmergencia(obraId, idsAfectados, userId) {
  if (!idsAfectados?.size) return;
  const movs = await window.__db.movimientos_insumos_emergencia.where('obra_id').equals(obraId).toArray();
  const sums = new Map();
  for (const mv of movs) {
    if (mv.reverses_id || mv.reversed_by_id || mv.deleted_at) continue;
    if (!idsAfectados.has(mv.insumo_emergencia_id)) continue;
    const c = Number(mv.cantidad || 0);
    if (mv.tipo_movimiento === 'entrada') sums.set(mv.insumo_emergencia_id, (sums.get(mv.insumo_emergencia_id) || 0) + c);
    else if (mv.tipo_movimiento === 'salida') sums.set(mv.insumo_emergencia_id, (sums.get(mv.insumo_emergencia_id) || 0) - c);
  }
  const now = new Date().toISOString();
  for (const id of idsAfectados) {
    const ins = await window.__db.insumos_emergencia.get(id);
    if (!ins) continue;
    const stock = Math.max(0, sums.get(id) || 0);
    await window.__db.insumos_emergencia.update(id, {
      stock_actual: stock, alerta: calcAlerta(stock, Number(ins.stock_minimo || 0)),
      updated_at: now, updated_by: userId,
      version: (ins.version ?? 0) + 1,
      sync_status: ins.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
    });
  }
}

async function recalcularStockEpp(obraId, idsAfectados, userId) {
  if (!idsAfectados?.size) return;
  const movs = await window.__db.movimientos_epp.where('obra_id').equals(obraId).toArray();
  const sums = new Map();
  for (const mv of movs) {
    if (mv.deleted_at) continue;
    if (!idsAfectados.has(mv.epp_id)) continue;
    const c = Number(mv.cantidad || 0);
    if (mv.tipo_movimiento === 'entrada') sums.set(mv.epp_id, (sums.get(mv.epp_id) || 0) + c);
    else if (mv.tipo_movimiento === 'salida') sums.set(mv.epp_id, (sums.get(mv.epp_id) || 0) - c);
  }
  const now = new Date().toISOString();
  for (const id of idsAfectados) {
    const epp = await window.__db.epps.get(id);
    if (!epp) continue;
    const stock = Math.max(0, sums.get(id) || 0);
    await window.__db.epps.update(id, {
      stock_actual: stock, alerta: calcAlerta(stock, Number(epp.stock_minimo || 0)),
      updated_at: now, updated_by: userId,
      version: (epp.version ?? 0) + 1,
      sync_status: epp.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
    });
  }
}

Object.assign(window, { MigracionFlow });
