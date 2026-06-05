// ═══════════════════════════════════════════════════════════════════
// JARVEX — Export histórico a Excel (solo Super Admin)
//
// Genera UN workbook .xlsx con una hoja por categoría, en el MISMO formato
// que leen los importadores existentes, para que sea un backup re-importable
// tras un "borre general":
//   • Hojas MOV * (movimientos) → formato del importador de Migración histórica
//     (jx-migracion-import.jsx / migracion-parser.js TEMPLATES).
//   • Hojas CAT * (catálogos) y Personal → formato del importador genérico
//     (jx-importar.jsx / excel.js MODULES + downloadTemplate).
//
// El responsable de cada salida se exporta por NOMBRE (persona) o razón social
// (subcontrato), que es lo que el importador re-resuelve. Por eso conviene
// restaurar primero los catálogos/personal y luego los movimientos.
// ═══════════════════════════════════════════════════════════════════

import { db } from '../db/jarvex.db.js';

// Headers EXACTOS que esperan los importadores (mantener en sync con
// jx-migracion-import.jsx TEMPLATES y excel.js MODULES/downloadTemplate).
const H = {
  mov_materiales:  ['ID', 'Fecha de Movimiento', 'Material', 'Unidad', 'Cantidad', 'Tipo de Movimiento', 'Proveedor/Almacen de Salida', 'Resposable (Salida)', 'Lugar llega / Frente'],
  mov_herramientas:['ID', 'Fecha de Movimiento', 'Herramientas', 'Estado', 'Cantidad', 'Tipo de Movimiento', 'Proveedor/Responsible', 'Lugar llega / Frente'],
  mov_epp:         ['ID', 'Fecha de Movimiento', 'EPP', 'Unidad', 'Cantidad', 'Tipo de Movimiento', 'Proveedor/Responsable', 'Lugar de llegada'],
  mov_maquinaria:  ['ID', 'Fecha de Movimiento', 'Maquinaria', 'Estado', 'Cantidad', 'Tipo de Movimiento', 'Proveedor/Responsable', 'Lugar de llegada'],
  mov_emergencia:  ['ID', 'Fecha de Movimiento', 'Insumo de Emergencia', 'Unidad', 'Cantidad', 'Tipo de Movimiento', 'Proveedor/Responsable', 'Lugar de llegada'],
  // Catálogos / roster (importador genérico). Se agregan columnas extra de
  // referencia que el importador ignora (estado, subcontrato, etc.).
  personal:        ['nombres', 'apellidos', 'dni', 'cargo', 'area', 'fecha_nacimiento', 'fecha_ingreso', 'telefono', 'estado', 'subcontrato', 'es_jefe_subcontrato', 'seguro_a_cargo'],
  cat_materiales:  ['nombre_material', 'categoria', 'unidad', 'stock_inicial', 'stock_minimo', 'precio_unitario_estimado', 'stock_actual'],
  cat_herramientas:['nombre_herramienta', 'tipo_herramienta', 'marca', 'modelo', 'serie', 'estado_actual', 'maneja_cantidad', 'stock_actual', 'unidad'],
  cat_epp:         ['nombre_epp', 'tipo_epp', 'unidad', 'talla', 'stock_actual', 'stock_minimo'],
  cat_maquinaria:  ['placa', 'marca', 'modelo', 'tipo', 'año_fabricacion', 'propietario', 'estado', 'nombre'],
  cat_emergencia:  ['nombre', 'categoria', 'unidad', 'stock_actual', 'stock_minimo'],
  proveedores:     ['razon_social', 'ruc', 'contacto', 'telefono', 'correo', 'tipo_proveedor', 'direccion'],
  subcontratistas: ['razon_social', 'ruc', 'contacto', 'telefono', 'correo', 'direccion', 'especialidad', 'estado', 'seguro_a_cargo'],
};

const tipoLabel = (t) => (t === 'entrada' ? 'Ingreso' : 'Salida');
const isoFecha = (f) => (f ? String(f).slice(0, 10) : '');
const byId = (rows) => { const m = new Map(); for (const r of (rows || [])) m.set(r.id, r); return m; };
const slug = (s) => String(s || 'obra').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'obra';

// Nombre del destino de un movimiento: persona o subcontrato (sin sufijo, para
// que el importador lo re-matchee contra personal/subcontratistas por nombre).
function destinoNombre(m, personalById, subsById) {
  if (m.subcontratista_id) return subsById.get(m.subcontratista_id)?.razon_social || '';
  const pid = m.responsable_id || m.personal_id;
  if (pid) { const p = personalById.get(pid); return p ? `${p.nombres || ''} ${p.apellidos || ''}`.trim() : ''; }
  return '';
}

/**
 * Construye y descarga el workbook de respaldo histórico de la obra.
 * Devuelve { archivo, hojas: [{ nombre, filas }] } para feedback.
 */
export async function exportarHistoricoExcel(obraId, obraNombre = 'obra') {
  if (!obraId) throw new Error('No hay una obra activa para exportar.');
  const XLSX = await import('xlsx');

  const porObra = (t) => db[t].where('obra_id').equals(obraId).filter((r) => !r.deleted_at).toArray();
  const todos = (t) => db[t].filter((r) => !r.deleted_at).toArray();

  const [
    movMat, movHerr, movEpp, movMaq, movEmer,
    mats, herrs, epps, activos, insEmer,
    personal, subs, provs, ubic,
  ] = await Promise.all([
    porObra('movimientos_materiales'),
    porObra('movimientos_herramientas'),
    porObra('movimientos_epp'),
    porObra('movimientos_maquinaria'),
    porObra('movimientos_insumos_emergencia'),
    porObra('materiales'),
    porObra('herramientas'),
    porObra('epps'),
    todos('activos_pesados'),
    porObra('insumos_emergencia'),
    porObra('personal'),
    todos('subcontratistas'),
    todos('proveedores'),
    porObra('ubicaciones_obra'),
  ]);

  const matById = byId(mats), herrById = byId(herrs), eppById = byId(epps);
  const activoById = byId(activos), insEmerById = byId(insEmer);
  const personalById = byId(personal), subsById = byId(subs);
  const provById = byId(provs), ubicById = byId(ubic);

  const ordFecha = (a, b) => String(a.fecha || '').localeCompare(String(b.fecha || ''));

  // ── Filas por categoría (orden de columnas = H[*]) ──
  const filasMat = movMat.slice().sort(ordFecha).map((m, i) => [
    i + 1, isoFecha(m.fecha), matById.get(m.material_id)?.nombre_material || '(insumo eliminado)',
    m.unidad || '', m.cantidad ?? '', tipoLabel(m.tipo_movimiento),
    m.tipo_movimiento === 'entrada' ? (provById.get(m.proveedor_id)?.razon_social || '') : (ubicById.get(m.ubicacion_id)?.nombre || ''),
    m.tipo_movimiento === 'salida' ? destinoNombre(m, personalById, subsById) : '',
    m.tipo_movimiento === 'entrada' ? (ubicById.get(m.ubicacion_id)?.nombre || '') : (m.frente_zona || ''),
  ]);

  const filasHerr = movHerr.slice().sort(ordFecha).map((m, i) => [
    i + 1, isoFecha(m.fecha), herrById.get(m.herramienta_id)?.nombre_herramienta || '(insumo eliminado)',
    m.estado_salida || m.estado_devolucion || '', m.cantidad ?? '', tipoLabel(m.tipo_movimiento),
    m.tipo_movimiento === 'entrada' ? (provById.get(m.proveedor_id)?.razon_social || '') : destinoNombre(m, personalById, subsById),
    m.tipo_movimiento === 'entrada' ? (ubicById.get(m.ubicacion_id)?.nombre || '') : (m.frente_zona || ''),
  ]);

  const filasEpp = movEpp.slice().sort(ordFecha).map((m, i) => [
    i + 1, isoFecha(m.fecha), eppById.get(m.epp_id)?.nombre_epp || '(insumo eliminado)',
    m.unidad || '', m.cantidad ?? '', tipoLabel(m.tipo_movimiento),
    m.tipo_movimiento === 'entrada' ? (provById.get(m.proveedor_id)?.razon_social || '') : destinoNombre(m, personalById, subsById),
    ubicById.get(m.ubicacion_id)?.nombre || '',
  ]);

  const filasMaq = movMaq.slice().sort(ordFecha).map((m, i) => [
    i + 1, isoFecha(m.fecha), activoById.get(m.activo_id)?.nombre || '(equipo eliminado)',
    m.estado || '', m.cantidad ?? '', tipoLabel(m.tipo_movimiento),
    m.tipo_movimiento === 'entrada' ? (provById.get(m.proveedor_id)?.razon_social || '') : destinoNombre(m, personalById, subsById),
    m.tipo_movimiento === 'entrada' ? (ubicById.get(m.ubicacion_id)?.nombre || '') : (m.frente_zona || ''),
  ]);

  const filasEmer = movEmer.slice().sort(ordFecha).map((m, i) => [
    i + 1, isoFecha(m.fecha), insEmerById.get(m.insumo_emergencia_id)?.nombre || '(insumo eliminado)',
    m.unidad || '', m.cantidad ?? '', tipoLabel(m.tipo_movimiento),
    m.tipo_movimiento === 'entrada' ? (provById.get(m.proveedor_id)?.razon_social || '') : destinoNombre(m, personalById, subsById),
    '',
  ]);

  // Roster + catálogos
  const filasPersonal = personal.slice().sort((a, b) => `${a.apellidos} ${a.nombres}`.localeCompare(`${b.apellidos} ${b.nombres}`)).map((p) => [
    p.nombres || '', p.apellidos || '', p.dni || '', p.cargo || '', p.area || '',
    p.fecha_nacimiento || '', p.fecha_ingreso || '', p.telefono || '', p.estado || 'activo',
    p.subcontratista_id ? (subsById.get(p.subcontratista_id)?.razon_social || '') : '',
    p.es_jefe_subcontrato ? 'Sí' : '', p.seguro_a_cargo || '',
  ]);

  const filasCatMat = mats.map((x) => [x.nombre_material || '', x.categoria || '', x.unidad || '', x.stock_inicial ?? 0, x.stock_minimo ?? 0, x.precio_unitario_estimado ?? '', x.stock_actual ?? 0]);
  const filasCatHerr = herrs.map((x) => [x.nombre_herramienta || '', x.tipo_herramienta || '', x.marca || '', x.modelo || '', x.serie || '', x.estado_actual || '', x.maneja_cantidad ? 'Sí' : '', x.stock_actual ?? '', x.unidad || '']);
  const filasCatEpp = epps.map((x) => [x.nombre_epp || '', x.tipo_epp || '', x.unidad || '', x.talla || '', x.stock_actual ?? 0, x.stock_minimo ?? 0]);
  const filasCatMaq = activos.map((x) => [x.placa || '', x.marca || '', x.modelo || '', x.tipo || '', x.año_fabricacion || '', x.propietario || '', x.estado || '', x.nombre || '']);
  const filasCatEmer = insEmer.map((x) => [x.nombre || '', x.categoria || '', x.unidad || '', x.stock_actual ?? 0, x.stock_minimo ?? 0]);
  const filasProv = provs.map((x) => [x.razon_social || '', x.ruc || '', x.contacto || '', x.telefono || '', x.correo || x.email || '', x.tipo_proveedor || '', x.direccion || '']);
  const filasSub = subs.map((x) => [x.razon_social || '', x.ruc || '', x.contacto || '', x.telefono || '', x.correo || x.email || '', x.direccion || '', x.especialidad || '', x.estado || '', x.seguro_a_cargo || '']);

  // ── Armar workbook ──
  const wb = XLSX.utils.book_new();
  const hojas = [];
  const addSheet = (nombre, headers, filas) => {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...filas]);
    ws['!cols'] = headers.map((h) => ({ wch: Math.max(12, String(h).length + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, nombre.slice(0, 31)); // Excel: máx 31 chars
    hojas.push({ nombre, filas: filas.length });
  };

  // Movimientos (importador de Migración histórica)
  addSheet('MOV Materiales', H.mov_materiales, filasMat);
  addSheet('MOV Herramientas', H.mov_herramientas, filasHerr);
  addSheet('MOV EPP', H.mov_epp, filasEpp);
  addSheet('MOV Maquinaria', H.mov_maquinaria, filasMaq);
  addSheet('MOV Emergencia', H.mov_emergencia, filasEmer);
  // Roster + catálogos (importador genérico)
  addSheet('Personal', H.personal, filasPersonal);
  addSheet('CAT Materiales', H.cat_materiales, filasCatMat);
  addSheet('CAT Herramientas', H.cat_herramientas, filasCatHerr);
  addSheet('CAT EPP', H.cat_epp, filasCatEpp);
  addSheet('CAT Maquinaria', H.cat_maquinaria, filasCatMaq);
  addSheet('CAT Emergencia', H.cat_emergencia, filasCatEmer);
  addSheet('Proveedores', H.proveedores, filasProv);
  addSheet('Subcontratistas', H.subcontratistas, filasSub);

  const fecha = new Date().toISOString().slice(0, 10);
  const archivo = `JARVEX_historico_${slug(obraNombre)}_${fecha}.xlsx`;
  XLSX.writeFile(wb, archivo);

  return {
    archivo,
    hojas,
    totalMovs: filasMat.length + filasHerr.length + filasEpp.length + filasMaq.length + filasEmer.length,
  };
}
