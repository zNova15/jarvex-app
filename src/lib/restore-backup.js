// ═══════════════════════════════════════════════════════════════════
// JARVEX — Restaurar backup (Super Admin)
//
// Re-importación ORQUESTADA del workbook que produce el Export histórico, para
// rearmar la operación tras un "borre general". NO es un clon 1:1 por ID (el
// export es por nombre): restaura re-resolviendo nombres, en orden de FK, con
// dedup por clave natural (idempotente → re-correr es no-op, sin duplicar).
//
// Orden: Frentes → Proveedores → Subcontratistas → Inventario (catálogos) →
// Personal → Movimientos (5 formatos). Las fotos se restauran como galería por
// categoría (el vínculo foto→registro no se conserva: ver restaurarFotosZip).
//
// Fuera de scope (se informa): mantenimientos, horas máquina, combustible,
// asistencia, caja chica, partidas, OC/cotizaciones, valorizaciones.
// ═══════════════════════════════════════════════════════════════════

import { db } from '../db/jarvex.db.js';
import { normTxt } from './match-helpers.js';
import { detectFormato, parseMovimientos } from './migracion-parser.js';
import { calcAlerta } from './stock-utils.js';

const H = (sheet) => (sheet.headers || []).map((h) => normTxt(h));
const tiene = (sheet, ...cols) => cols.every((c) => H(sheet).some((h) => h === normTxt(c)));
const num = (v) => { if (v == null || String(v).trim() === '') return null; const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : null; };

// Getter por nombre de columna (exacto, tolerante a acentos/espacios vía normTxt).
function rowGet(row) {
  const idx = {}; for (const k of Object.keys(row || {})) idx[normTxt(k)] = k;
  return (...cands) => { for (const c of cands) { const key = idx[normTxt(c)]; if (key != null) { const v = row[key]; if (v != null && String(v).trim() !== '') return v; } } return null; };
}

function meta(userId, isPrueba) {
  const id = window.__newId(); const now = new Date().toISOString();
  return { id, created_by: userId, updated_by: userId, created_at: now, updated_at: now, version: 1,
    sync_status: isPrueba ? 'synced' : 'pending_create', last_synced_at: null,
    idempotency_key: `${userId}_restore_${id}`, ...(isPrueba ? { demo: true } : {}) };
}

// ── Clasificación de hojas por HEADERS (no por nombre, que se trunca a 31) ──
function clasificar(sheet) {
  if (tiene(sheet, 'Nombres', 'Apellidos', 'DNI')) return { tipo: 'personal' };
  if (tiene(sheet, 'Frente', 'Orden') || tiene(sheet, 'Frente', 'Ingeniero a cargo')) return { tipo: 'frentes' };
  if (tiene(sheet, 'Categoría', 'Insumo')) return { tipo: 'inventario' };
  if (tiene(sheet, 'Razón social') && tiene(sheet, 'Especialidad')) return { tipo: 'subcontratistas' };
  if (tiene(sheet, 'Razón social')) return { tipo: 'proveedores' };
  const fmt = detectFormato(sheet.headers);
  if (fmt && fmt.startsWith('mov_')) return { tipo: 'mov', formato: fmt };
  return { tipo: null };
}

const CAT_TABLA = { material: 'materiales', materiales: 'materiales', herramienta: 'herramientas', herramientas: 'herramientas', epp: 'epps', maquinaria: 'activos_pesados', 'insumo emergencia': 'insumos_emergencia', 'insumo de emergencia': 'insumos_emergencia', emergencia: 'insumos_emergencia' };
const CAT_NOMBRE = { materiales: 'nombre_material', herramientas: 'nombre_herramienta', epps: 'nombre_epp', activos_pesados: 'nombre', insumos_emergencia: 'nombre' };
const MOV_CFG = {
  mov_materiales: { tabla: 'movimientos_materiales', cat: 'materiales', itemFk: 'material_id', nombreCat: 'nombre_material', persFk: 'responsable_id' },
  mov_herramientas: { tabla: 'movimientos_herramientas', cat: 'herramientas', itemFk: 'herramienta_id', nombreCat: 'nombre_herramienta', persFk: 'responsable_id' },
  mov_epp: { tabla: 'movimientos_epp', cat: 'epps', itemFk: 'epp_id', nombreCat: 'nombre_epp', persFk: 'personal_id' },
  mov_maquinaria: { tabla: 'movimientos_maquinaria', cat: 'activos_pesados', itemFk: 'activo_id', nombreCat: 'nombre', persFk: 'responsable_id' },
  mov_emergencia: { tabla: 'movimientos_insumos_emergencia', cat: 'insumos_emergencia', itemFk: 'insumo_emergencia_id', nombreCat: 'nombre', persFk: 'responsable_id' },
};

/**
 * Restaura el workbook de backup. Devuelve un resumen por categoría.
 * onProgress(fase, hechas, total).
 */
export async function restaurarBackup(file, { userId = 'offline', obraId, isPrueba = false, onProgress } = {}) {
  if (!obraId) throw new Error('No hay obra activa.');
  if (!file) throw new Error('Elegí el archivo .xlsx del backup.');
  const parsed = await window.__excel.parseExcelFile(file);
  const sheets = (parsed.sheets || []).map((s) => ({ ...s, clase: clasificar(s) }));
  const resumen = { frentes: 0, proveedores: 0, subcontratistas: 0, inventario: 0, personal: 0, movimientos: 0, saltados: 0, errores: 0, ignoradas: [] };

  // Índices por clave natural (para dedup + resolución de FKs por nombre).
  const frentes = await db.frentes_obra.where('obra_id').equals(obraId).filter((r) => !r.deleted_at).toArray();
  const provs = await db.proveedores.filter((r) => !r.deleted_at).toArray();
  const subs = await db.subcontratistas.filter((r) => !r.deleted_at).toArray();
  const personal = await db.personal.where('obra_id').equals(obraId).filter((r) => !r.deleted_at).toArray();
  const ubic = await db.ubicaciones_obra.where('obra_id').equals(obraId).filter((r) => !r.deleted_at).toArray();
  const cats = {};
  for (const t of ['materiales', 'herramientas', 'epps', 'activos_pesados', 'insumos_emergencia']) {
    const rows = t === 'activos_pesados' ? await db[t].filter((r) => !r.deleted_at).toArray() : await db[t].where('obra_id').equals(obraId).filter((r) => !r.deleted_at).toArray();
    cats[t] = new Map(rows.map((r) => [normTxt(r[CAT_NOMBRE[t]]), r]));
  }
  const frenteMap = new Map(frentes.map((f) => [normTxt(f.nombre), f.id]));
  const provMap = new Map(provs.map((p) => [normTxt(p.razon_social), p.id]));
  const subMap = new Map(subs.map((s) => [normTxt(s.razon_social), s.id]));
  const persMap = new Map(personal.map((p) => [normTxt(`${p.nombres} ${p.apellidos || ''}`), p.id]));
  const persByDni = new Map(personal.map((p) => [String(p.dni || ''), p.id]));
  const ubicMap = new Map(ubic.map((u) => [normTxt(u.nombre), u.id]));
  let ordenUbic = ubic.reduce((m, u) => Math.max(m, Number(u.orden) || 0), 0);

  const add = async (tabla, fields) => { const rec = { ...fields, ...meta(userId, isPrueba) }; await db[tabla].add(rec); return rec; };
  const resolverUbic = async (nombre) => {
    const k = normTxt(nombre); if (!k) return null;
    if (ubicMap.has(k)) return ubicMap.get(k);
    const rec = await add('ubicaciones_obra', { obra_id: obraId, nombre: String(nombre).trim(), descripcion: 'Restaurada de backup', orden: ++ordenUbic, activo: true });
    ubicMap.set(k, rec.id); return rec.id;
  };

  // ── Orden FK ──
  const porTipo = (t) => sheets.filter((s) => s.clase.tipo === t);

  // 1) Frentes
  for (const sh of porTipo('frentes')) for (const row of sh.rows) {
    try { const g = rowGet(row); const nombre = (g('Frente', 'Nombre') || '').toString().trim(); if (!nombre) continue;
      if (frenteMap.has(normTxt(nombre))) { resumen.saltados++; continue; }
      const rec = await add('frentes_obra', { obra_id: obraId, nombre, descripcion: g('Descripción', 'Descripcion') || null, ingeniero_id: null, orden: num(g('Orden')) || 0, activo: String(g('Activo') || 'Sí').toLowerCase() !== 'no' });
      frenteMap.set(normTxt(nombre), rec.id); resumen.frentes++;
    } catch { resumen.errores++; }
  }
  // 2) Proveedores
  for (const sh of porTipo('proveedores')) for (const row of sh.rows) {
    try { const g = rowGet(row); const rs = (g('Razón social', 'Razon social') || '').toString().trim(); if (!rs) continue;
      const ruc = (g('RUC') || '').toString().trim();
      if (provMap.has(normTxt(rs)) || (ruc && provs.some((p) => p.ruc === ruc))) { resumen.saltados++; continue; }
      const rec = await add('proveedores', { razon_social: rs, ruc: ruc || null, contacto: g('Contacto') || null, telefono: g('Teléfono', 'Telefono') || null, correo: g('Correo', 'Email') || null, tipo_proveedor: g('Tipo') || null, direccion: g('Dirección', 'Direccion') || null, estado: 'activo' });
      provMap.set(normTxt(rs), rec.id); resumen.proveedores++;
    } catch { resumen.errores++; }
  }
  // 3) Subcontratistas
  for (const sh of porTipo('subcontratistas')) for (const row of sh.rows) {
    try { const g = rowGet(row); const rs = (g('Razón social', 'Razon social') || '').toString().trim(); if (!rs) continue;
      if (subMap.has(normTxt(rs))) { resumen.saltados++; continue; }
      const rec = await add('subcontratistas', { razon_social: rs, ruc: (g('RUC') || '').toString().trim() || null, contacto: g('Contacto') || null, telefono: g('Teléfono', 'Telefono') || null, email: g('Correo', 'Email') || null, direccion: g('Dirección', 'Direccion') || null, especialidad: g('Especialidad') || null, estado: g('Estado') || 'activo', seguro_a_cargo: g('Seguro a cargo') || 'empresa' });
      subMap.set(normTxt(rs), rec.id); resumen.subcontratistas++;
    } catch { resumen.errores++; }
  }
  // 4) Inventario (catálogos por Categoría)
  for (const sh of porTipo('inventario')) for (const row of sh.rows) {
    try { const g = rowGet(row); const nombre = (g('Insumo', 'Nombre') || '').toString().trim(); if (!nombre) continue;
      const cat = normTxt(g('Categoría', 'Categoria') || '');
      const tabla = CAT_TABLA[cat]; if (!tabla) { resumen.saltados++; continue; }
      if (cats[tabla].has(normTxt(nombre))) { resumen.saltados++; continue; }
      const unidad = g('Unidad') || 'Und'; const stock = num(g('Stock Actual', 'Stock')) || 0; const minimo = num(g('Stock Mínimo', 'Stock Minimo')) || 0;
      let body;
      if (tabla === 'materiales') body = { obra_id: obraId, nombre_material: nombre, categoria: null, unidad, stock_inicial: 0, stock_actual: stock, stock_minimo: minimo, total_entradas: 0, total_salidas: 0, alerta: calcAlerta(stock, minimo), estado: 'activo' };
      else if (tabla === 'herramientas') body = { obra_id: obraId, nombre_herramienta: nombre, tipo_herramienta: 'manual', estado_actual: 'bueno', ubicacion_actual: 'almacen', disponible: true, maneja_cantidad: true, unidad, stock_inicial: 0, stock_actual: stock, stock_minimo: minimo, alerta: calcAlerta(stock, minimo) };
      else if (tabla === 'epps') body = { obra_id: obraId, nombre_epp: nombre, tipo_epp: 'Otro', unidad, stock_inicial: 0, stock_actual: stock, stock_minimo: minimo, alerta: calcAlerta(stock, minimo), estado: 'activo' };
      else if (tabla === 'activos_pesados') body = { nombre, tipo: 'maquinaria', estado: 'operativo', obra_actual_id: obraId, obra_id: obraId, maneja_cantidad: true, unidad, stock_actual: stock, stock_minimo: minimo, alerta: calcAlerta(stock, minimo) };
      else body = { obra_id: obraId, nombre, categoria: null, unidad, stock_inicial: 0, stock_actual: stock, stock_minimo: minimo, alerta: calcAlerta(stock, minimo), estado: 'activo' };
      const rec = await add(tabla, body); cats[tabla].set(normTxt(nombre), rec); resumen.inventario++;
    } catch { resumen.errores++; }
  }
  // 5) Personal (dedup por DNI; resuelve frente/subcontrato por nombre)
  for (const sh of porTipo('personal')) for (const row of sh.rows) {
    try { const g = rowGet(row); const dni = (g('DNI') || '').toString().replace(/\D/g, '');
      const nombres = (g('Nombres') || '').toString().trim(); if (!nombres) continue;
      const apellidos = (g('Apellidos') || '').toString().trim();
      const nomKey = normTxt(`${nombres} ${apellidos}`);
      // Dedup por DNI; si no hay DNI, por nombre completo (evita duplicar al re-correr).
      if ((dni && persByDni.has(dni)) || (!dni && persMap.has(nomKey))) { resumen.saltados++; continue; }
      const subNom = g('Subcontrato'); const subId = subNom ? subMap.get(normTxt(subNom)) || null : null;
      const frNom = g('Frente'); const frId = frNom ? frenteMap.get(normTxt(frNom)) || null : null;
      const rec = await add('personal', { obra_id: obraId, nombres, apellidos, dni: dni || `RES-${normTxt(nombres + apellidos).slice(0, 14)}`,
        cargo: g('Cargo') || null, area: g('Área', 'Area') || null, estado: g('Estado') || 'activo',
        subcontratista_id: subId, es_jefe_subcontrato: String(g('Jefe Subcontrato') || '').toLowerCase().startsWith('s'), seguro_a_cargo: g('Seguro a cargo') || (subId ? 'empresa' : null), frente_id: frId,
        fecha_ingreso: g('Fecha Ingreso') || null, fecha_nacimiento: g('Fecha Nac.', 'Fecha Nacimiento') || null, telefono: (g('Teléfono', 'Telefono') || '').toString() || null });
      if (dni) persByDni.set(dni, rec.id); persMap.set(normTxt(`${nombres} ${apellidos}`), rec.id); resumen.personal++;
    } catch { resumen.errores++; }
  }

  // 6) Movimientos (idempotente por contenido) + recalc de stock
  const itemsTocados = {}; // tabla → Set(itemId)
  for (const sh of porTipo('mov')) {
    const cfg = MOV_CFG[sh.clase.formato]; if (!cfg) continue;
    const movs = parseMovimientos(sh.rows, sh.clase.formato);
    // Firmas existentes como MULTISET (re-run no duplica, pero NO descarta
    // movimientos legítimamente idénticos: 2 salidas iguales el mismo día se
    // restauran ambas en una obra vacía; al re-correr se saltan las que ya están).
    const existentes = await db[cfg.tabla].where('obra_id').equals(obraId).filter((r) => !r.deleted_at).toArray();
    const firmas = new Map();
    for (const r of existentes) { const k = `${r[cfg.itemFk]}|${(r.fecha || '').slice(0, 10)}|${r.tipo_movimiento}|${r.cantidad}`; firmas.set(k, (firmas.get(k) || 0) + 1); }
    for (const m of movs) {
      try {
        if (!m.tipo || !(m.cantidad > 0) || !String(m.nombreItem || '').trim()) { resumen.saltados++; continue; }
        // Resolver item (debe existir del inventario; si no, crearlo mínimo).
        let item = cats[cfg.cat].get(normTxt(m.nombreItem));
        if (!item) {
          const body = cfg.cat === 'materiales' ? { obra_id: obraId, nombre_material: m.nombreItem.trim(), unidad: m.unidad || 'Und', stock_inicial: 0, stock_actual: 0, stock_minimo: 0, total_entradas: 0, total_salidas: 0, alerta: 'ok', estado: 'activo' }
            : cfg.cat === 'herramientas' ? { obra_id: obraId, nombre_herramienta: m.nombreItem.trim(), tipo_herramienta: 'manual', estado_actual: 'bueno', ubicacion_actual: 'almacen', disponible: true, maneja_cantidad: true, unidad: m.unidad || 'Und', stock_actual: 0, stock_minimo: 0, alerta: 'ok' }
            : cfg.cat === 'epps' ? { obra_id: obraId, nombre_epp: m.nombreItem.trim(), tipo_epp: 'Otro', unidad: m.unidad || 'Und', stock_actual: 0, stock_minimo: 0, alerta: 'ok', estado: 'activo' }
            : cfg.cat === 'activos_pesados' ? { nombre: m.nombreItem.trim(), tipo: 'maquinaria', estado: 'operativo', obra_actual_id: obraId, obra_id: obraId, maneja_cantidad: true, unidad: m.unidad || 'Und', stock_actual: 0, stock_minimo: 0, alerta: 'ok' }
            : { obra_id: obraId, nombre: m.nombreItem.trim(), unidad: m.unidad || 'Und', stock_actual: 0, stock_minimo: 0, alerta: 'ok', estado: 'activo' };
          item = await add(cfg.cat, body); cats[cfg.cat].set(normTxt(m.nombreItem), item); resumen.inventario++;
        }
        const fecha = (m.fecha || new Date().toISOString().slice(0, 10)).slice(0, 10);
        const firma = `${item.id}|${fecha}|${m.tipo}|${m.cantidad}`;
        if ((firmas.get(firma) || 0) > 0) { firmas.set(firma, firmas.get(firma) - 1); resumen.saltados++; continue; }
        // Resolver destino (persona o subcontrato) + ubicación + proveedor.
        const quien = m.responsable || m.subcontrato || m.origen;
        let persId = null, subcontratistaId = null, destino_tipo = null;
        if (m.tipo === 'salida' && quien) {
          const k = normTxt(quien);
          if (subMap.has(k)) { subcontratistaId = subMap.get(k); destino_tipo = 'subcontratista'; }
          else if (persMap.has(k)) { persId = persMap.get(k); destino_tipo = 'personal'; }
        }
        const prov = m.proveedor || m.origen;
        const proveedorId = m.tipo === 'entrada' && prov ? (provMap.get(normTxt(prov)) || null) : null;
        const alm = m.almacen || (m.tipo === 'entrada' ? m.lugar : m.origen);
        // Solo materiales/herramientas/epp guardan ubicacion_id (evita crear
        // ubicaciones espurias para maquinaria/emergencia que no la usan).
        const usaUbic = cfg.cat === 'materiales' || cfg.cat === 'herramientas' || cfg.cat === 'epps';
        const ubicacionId = (usaUbic && alm) ? await resolverUbic(alm) : null;
        const base = { obra_id: obraId, [cfg.itemFk]: item.id, fecha, hora: m.hora || null, tipo_movimiento: m.tipo, cantidad: m.cantidad,
          unidad: m.unidad || item.unidad || 'Und', proveedor_id: proveedorId, subcontratista_id: subcontratistaId, destino_tipo,
          observaciones: ['Restaurado de backup', m.observaciones].filter(Boolean).join(' · ') };
        // Campos específicos por tabla
        if (cfg.cat === 'epps') Object.assign(base, { personal_id: persId, ubicacion_id: ubicacionId, motivo: m.tipo === 'entrada' ? 'reposicion' : 'dotacion' });
        else Object.assign(base, { [cfg.persFk]: persId, frente_zona: m.frente || m.lugar || null });
        if (cfg.cat === 'materiales') base.ubicacion_id = ubicacionId;
        if (cfg.cat === 'herramientas') { base.ubicacion_id = ubicacionId; base.accion = m.tipo; base.estado_salida = m.estado || null; }
        if (cfg.cat === 'activos_pesados') { base.estado = m.estado || null; }
        if (cfg.cat === 'materiales' || cfg.cat === 'epps') base.precio_unitario_real = (m.precio ?? null);
        // documento_asociado: existe en todas MENOS movimientos_herramientas.
        if (cfg.cat !== 'herramientas') base.documento_asociado = m.documento || null;
        await add(cfg.tabla, base);
        (itemsTocados[cfg.cat] = itemsTocados[cfg.cat] || new Set()).add(item.id);
        resumen.movimientos++;
      } catch { resumen.errores++; }
    }
    if (onProgress) onProgress('movimientos', resumen.movimientos, movs.length);
  }

  // 7) Recalcular stock de los ítems tocados (suma entradas − salidas).
  for (const cat of Object.keys(itemsTocados)) {
    const cfg = Object.values(MOV_CFG).find((c) => c.cat === cat); if (!cfg) continue;
    for (const itemId of itemsTocados[cat]) {
      try {
        const movs = await db[cfg.tabla].where('obra_id').equals(obraId).filter((r) => !r.deleted_at && r[cfg.itemFk] === itemId).toArray();
        let ent = 0, sal = 0; for (const r of movs) { if (r.tipo_movimiento === 'entrada') ent += Number(r.cantidad) || 0; else if (r.tipo_movimiento === 'salida') sal += Number(r.cantidad) || 0; }
        const item = await db[cat].get(itemId); if (!item) continue;
        // El "Stock Actual" exportado es la verdad del saldo actual. Back-calculamos
        // el saldo inicial implícito (snap − delta de movimientos) para PRESERVAR
        // ese saldo aunque la obra haya tenido stock de apertura no registrado como
        // movimiento. Para ítems creados on-the-fly (snap=0) → stock = ent − sal.
        const snap = Number(item.stock_actual) || 0;
        const ini = Math.max(0, snap - (ent - sal));
        const stock = ini + ent - sal;
        const patch = { stock_inicial: ini, stock_actual: stock, alerta: calcAlerta(stock, item.stock_minimo || 0), updated_at: new Date().toISOString(), sync_status: item.sync_status === 'pending_create' ? 'pending_create' : 'pending_update' };
        if (cat === 'materiales') { patch.total_entradas = ent; patch.total_salidas = sal; }
        await db[cat].update(itemId, patch);
      } catch {}
    }
  }

  // Hojas que existen pero no se restauran (informativo).
  for (const sh of sheets) if (sh.clase.tipo === null) resumen.ignoradas.push(sh.name);
  try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { source: 'restore' } })); } catch {}
  try { window.dispatchEvent(new CustomEvent('jarvex_master_updated')); } catch {}
  return resumen;
}

// ── Restaurar FOTOS desde el .zip (galería por categoría) ──
// El vínculo foto→registro NO se conserva (registro_relacionado_id queda null).
export async function restaurarFotosZip(zipFile, { userId = 'offline', obraId, isPrueba = false, onProgress } = {}) {
  if (!obraId) throw new Error('No hay obra activa.');
  if (!zipFile) throw new Error('Elegí el .zip de fotos.');
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(zipFile);
  // Dedup: evidencias ya presentes por nombre_archivo + fecha.
  const existentes = await db.evidencias.where('obra_id').equals(obraId).filter((r) => !r.deleted_at).toArray();
  const yaHay = new Set(existentes.map((e) => `${normTxt(e.nombre_archivo)}|${(e.fecha || '').slice(0, 10)}`));
  // Manifiesto opcional (mapea archivo → metadata).
  const manif = {};
  const mf = zip.file('_manifiesto.csv');
  if (mf) {
    const txt = await mf.async('string');
    const lines = txt.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
    const parseCsv = (l) => l.match(/("([^"]|"")*"|[^,]*)/g).filter((_, i, a) => i < a.length - 1).map((c) => c.replace(/^"|"$/g, '').replace(/""/g, '"'));
    for (let i = 1; i < lines.length; i++) { const c = parseCsv(lines[i]); if (c[0]) manif[c[0]] = { tipo: c[1], modulo: c[2], fecha: c[4], obs: c[7] }; }
  }
  const archivos = Object.keys(zip.files).filter((n) => !zip.files[n].dir && n !== '_manifiesto.csv');
  let ok = 0, saltados = 0, errores = 0;
  for (let i = 0; i < archivos.length; i++) {
    const path = archivos[i];
    try {
      const blob = await zip.files[path].async('blob');
      const nombre = path.split('/').pop();
      const meta1 = manif[path] || {};
      if (yaHay.has(`${normTxt(nombre)}|${(meta1.fecha || '').slice(0, 10)}`)) { saltados++; continue; }
      const id = window.__newId(); const now = new Date().toISOString();
      const mime = nombre.match(/\.(jpe?g)$/i) ? 'image/jpeg' : nombre.match(/\.png$/i) ? 'image/png' : nombre.match(/\.webp$/i) ? 'image/webp' : nombre.match(/\.pdf$/i) ? 'application/pdf' : 'application/octet-stream';
      const ev = { id, obra_id: obraId, tipo_evidencia: 'documento_general', modulo_relacionado: meta1.modulo || 'restore', registro_relacionado_id: null,
        nombre_archivo: nombre, url_archivo: null, mime_type: mime, tamano_bytes: blob.size || null, fecha: (meta1.fecha || now.slice(0, 10)),
        observaciones: meta1.obs || 'Restaurada de backup', created_by: userId, created_at: now, updated_at: now, version: 1,
        sync_status: isPrueba ? 'synced' : 'pending_upload', upload_retries: 0, idempotency_key: `${userId}_restore_${id}` };
      await db.evidencias.add(ev);
      await db.evidencias_blobs.put({ id, blob });
      yaHay.add(`${normTxt(nombre)}|${(meta1.fecha || '').slice(0, 10)}`); ok++;
    } catch { errores++; }
    if (onProgress) onProgress('fotos', i + 1, archivos.length);
  }
  try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'evidencias' } })); } catch {}
  return { ok, saltados, errores, total: archivos.length };
}
