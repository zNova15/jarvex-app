// ═══════════════════════════════════════════════════════════════════
// JARVEX — Módulo de Exportación de datos (solo Super Admin)
//
// Exporta los DATOS REALES de la obra activa a Excel, organizados parte por
// parte (un dataset por categoría) con columnas ricas y filtros (fecha, nombre,
// personal/subcontratista). Los movimientos salen en columnas re-importables
// por el importador de Migración histórica (item, tipo, cantidad, responsable
// por nombre); las columnas extra son de referencia.
// ═══════════════════════════════════════════════════════════════════

import { db } from '../db/jarvex.db.js';

const tipoLabel = (t) => (t === 'entrada' ? 'Ingreso' : t === 'salida' ? 'Salida' : (t || ''));
const isoFecha = (f) => (f ? String(f).slice(0, 10) : '');
const hhmm = (h) => (h ? String(h).slice(0, 5) : '');
const n2 = (v) => (v == null || v === '' ? '' : Number(v));
const byId = (rows) => { const m = new Map(); for (const r of (rows || [])) m.set(r.id, r); return m; };
const slug = (s) => String(s || 'obra').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'obra';
const nombrePersona = (p) => p ? `${p.nombres || ''} ${p.apellidos || ''}`.trim() : '';

// Destino de un movimiento: persona o subcontrato (para columna "Responsable",
// re-resuelto por el importador por nombre). Devuelve { responsable, subcontrato }.
function destino(m, personalById, subsById) {
  if (m.subcontratista_id) {
    const s = subsById.get(m.subcontratista_id);
    return { responsable: s?.razon_social || '', subcontrato: s?.razon_social || '' };
  }
  const pid = m.responsable_id || m.personal_id;
  if (pid) return { responsable: nombrePersona(personalById.get(pid)), subcontrato: '' };
  return { responsable: '', subcontrato: '' };
}

// ── Carga única del contexto de la obra (tablas + mapas) ──
async function cargarContexto(obraId) {
  const porObra = (t) => db[t].where('obra_id').equals(obraId).filter((r) => !r.deleted_at).toArray();
  // Para tablas con obra_id pero SIN índice obra_id (ej. consumos_combustible),
  // filtramos en memoria — where('obra_id') sobre keypath no indexado rechaza.
  const porObraSinIndice = (t) => db[t].filter((r) => !r.deleted_at && r.obra_id === obraId).toArray();
  const todos = (t) => db[t].filter((r) => !r.deleted_at).toArray();
  const [
    movMat, movHerr, movEpp, movMaq, movEmer,
    mantsAll, horas, comb, caja, asist,
    mats, herrs, epps, activos, insEmer,
    personal, subs, provs, ubic,
  ] = await Promise.all([
    porObra('movimientos_materiales'), porObra('movimientos_herramientas'), porObra('movimientos_epp'),
    porObra('movimientos_maquinaria'), porObra('movimientos_insumos_emergencia'),
    todos('mantenimientos_maquinaria').catch(() => []), porObra('horas_maquina').catch(() => []),
    porObraSinIndice('consumos_combustible').catch(() => []), porObra('caja_chica_movimientos').catch(() => []),
    porObra('asistencia').catch(() => []),
    porObra('materiales'), porObra('herramientas'), porObra('epps'), todos('activos_pesados'), porObra('insumos_emergencia'),
    porObra('personal'), todos('subcontratistas'), todos('proveedores'), porObra('ubicaciones_obra'),
  ]);
  // mantenimientos_maquinaria NO tiene obra_id → lo scopeamos a los activos de
  // esta obra (asignados a la obra o que tienen movimientos en ella).
  const activoIdsObra = new Set([
    ...activos.filter((a) => a.obra_actual_id === obraId || a.obra_id === obraId).map((a) => a.id),
    ...movMaq.map((m) => m.activo_id),
  ].filter(Boolean));
  const mants = (mantsAll || []).filter((m) => activoIdsObra.has(m.activo_id));
  return {
    movMat, movHerr, movEpp, movMaq, movEmer, mants, horas, comb, caja, asist,
    mats, herrs, epps, activos, insEmer, personal, subs, provs, ubic,
    matById: byId(mats), herrById: byId(herrs), eppById: byId(epps), activoById: byId(activos),
    insEmerById: byId(insEmer), personalById: byId(personal), subsById: byId(subs),
    provById: byId(provs), ubicById: byId(ubic),
  };
}

// ── Filtro genérico de movimientos por fecha / nombre / responsable ──
// filtros = { desde, hasta, q, responsable } donde responsable = 'p:<id>' | 'sub:<id>'
function filtrarMovs(rows, filtros, nombreItem) {
  let out = rows || [];
  const { desde, hasta, q, responsable } = filtros || {};
  if (desde) out = out.filter((m) => isoFecha(m.fecha) >= desde);
  if (hasta) out = out.filter((m) => isoFecha(m.fecha) <= hasta);
  if (q) { const t = q.toLowerCase(); out = out.filter((m) => (nombreItem(m) || '').toLowerCase().includes(t)); }
  if (responsable) {
    if (responsable.startsWith('sub:')) { const id = responsable.slice(4); out = out.filter((m) => m.subcontratista_id === id); }
    else { const id = responsable.startsWith('p:') ? responsable.slice(2) : responsable; out = out.filter((m) => (m.responsable_id === id || m.personal_id === id)); }
  }
  return out.slice().sort((a, b) => isoFecha(a.fecha).localeCompare(isoFecha(b.fecha)) || String(a.hora || '').localeCompare(String(b.hora || '')));
}

const sumImporte = (cant, precio) => (cant != null && precio != null && precio !== '') ? Number(cant) * Number(precio) : '';

// ── DATASETS: cada uno define cómo construir su hoja desde el contexto ──
// build(ctx, filtros) → { headers, rows }
export const DATASETS = [
  { id: 'mov_materiales', label: 'Movimientos de Materiales', icon: 'package', color: '#3498DB', grupo: 'Movimientos', filtrable: true,
    build: (c, f) => {
      const nombre = (m) => c.matById.get(m.material_id)?.nombre_material || '';
      const rows = filtrarMovs(c.movMat, f, nombre).map((m, i) => {
        const d = destino(m, c.personalById, c.subsById);
        const mat = c.matById.get(m.material_id);
        return [i + 1, isoFecha(m.fecha), hhmm(m.hora), nombre(m) || '(eliminado)', mat?.categoria || '', m.unidad || mat?.unidad || '', n2(m.cantidad), tipoLabel(m.tipo_movimiento),
          c.ubicById.get(m.ubicacion_id)?.nombre || '', c.provById.get(m.proveedor_id)?.razon_social || '', d.responsable, d.subcontrato, m.frente_zona || '', m.documento_asociado || '', n2(m.precio_unitario_real), sumImporte(m.cantidad, m.precio_unitario_real), m.observaciones || ''];
      });
      return { headers: ['ID', 'Fecha de Movimiento', 'Hora', 'Material', 'Categoría', 'Unidad', 'Cantidad', 'Tipo de Movimiento', 'Almacén', 'Proveedor', 'Responsable', 'Subcontrato', 'Frente / Zona', 'Documento', 'Precio Unit. (S/)', 'Importe (S/)', 'Observaciones'], rows };
    } },
  { id: 'mov_herramientas', label: 'Movimientos de Herramientas', icon: 'tool', color: '#F28C28', grupo: 'Movimientos', filtrable: true,
    build: (c, f) => {
      const nombre = (m) => c.herrById.get(m.herramienta_id)?.nombre_herramienta || '';
      const rows = filtrarMovs(c.movHerr, f, nombre).map((m, i) => {
        const d = destino(m, c.personalById, c.subsById);
        return [i + 1, isoFecha(m.fecha), hhmm(m.hora), nombre(m) || '(eliminado)', m.estado_salida || m.estado_devolucion || '', n2(m.cantidad), tipoLabel(m.tipo_movimiento || m.accion),
          c.ubicById.get(m.ubicacion_id)?.nombre || '', c.provById.get(m.proveedor_id)?.razon_social || '', d.responsable, d.subcontrato, m.frente_zona || '', m.observaciones || ''];
      });
      return { headers: ['ID', 'Fecha de Movimiento', 'Hora', 'Herramientas', 'Estado', 'Cantidad', 'Tipo de Movimiento', 'Almacén', 'Proveedor', 'Responsable', 'Subcontrato', 'Frente / Zona', 'Observaciones'], rows };
    } },
  { id: 'mov_epp', label: 'Movimientos de EPP', icon: 'shield', color: '#2ECC71', grupo: 'Movimientos', filtrable: true,
    build: (c, f) => {
      const nombre = (m) => c.eppById.get(m.epp_id)?.nombre_epp || '';
      const rows = filtrarMovs(c.movEpp, f, nombre).map((m, i) => {
        const d = destino(m, c.personalById, c.subsById);
        return [i + 1, isoFecha(m.fecha), hhmm(m.hora), nombre(m) || '(eliminado)', m.unidad || '', n2(m.cantidad), tipoLabel(m.tipo_movimiento),
          c.ubicById.get(m.ubicacion_id)?.nombre || '', c.provById.get(m.proveedor_id)?.razon_social || '', d.responsable, d.subcontrato, m.motivo || '', m.documento_asociado || '', n2(m.precio_unitario_real), m.observaciones || ''];
      });
      return { headers: ['ID', 'Fecha de Movimiento', 'Hora', 'EPP', 'Unidad', 'Cantidad', 'Tipo de Movimiento', 'Almacén', 'Proveedor', 'Responsable', 'Subcontrato', 'Motivo', 'Documento', 'Precio Unit. (S/)', 'Observaciones'], rows };
    } },
  { id: 'mov_maquinaria', label: 'Movimientos de Maquinaria', icon: 'tool', color: '#8E44AD', grupo: 'Movimientos', filtrable: true,
    build: (c, f) => {
      const nombre = (m) => c.activoById.get(m.activo_id)?.nombre || c.activoById.get(m.activo_id)?.placa || '';
      const rows = filtrarMovs(c.movMaq, f, nombre).map((m, i) => {
        const d = destino(m, c.personalById, c.subsById);
        return [i + 1, isoFecha(m.fecha), hhmm(m.hora), nombre(m) || '(eliminado)', m.estado || '', n2(m.cantidad), tipoLabel(m.tipo_movimiento),
          c.ubicById.get(m.ubicacion_id)?.nombre || '', c.provById.get(m.proveedor_id)?.razon_social || '', d.responsable, d.subcontrato, m.frente_zona || '', m.documento_asociado || '', m.observaciones || ''];
      });
      return { headers: ['ID', 'Fecha de Movimiento', 'Hora', 'Maquinaria', 'Estado', 'Cantidad', 'Tipo de Movimiento', 'Almacén', 'Proveedor', 'Responsable', 'Subcontrato', 'Frente / Zona', 'Documento', 'Observaciones'], rows };
    } },
  { id: 'mov_emergencia', label: 'Movimientos de Insumos de Emergencia', icon: 'shield', color: '#9B59B6', grupo: 'Movimientos', filtrable: true,
    build: (c, f) => {
      const nombre = (m) => c.insEmerById.get(m.insumo_emergencia_id)?.nombre || '';
      const rows = filtrarMovs(c.movEmer, f, nombre).map((m, i) => {
        const d = destino(m, c.personalById, c.subsById);
        return [i + 1, isoFecha(m.fecha), hhmm(m.hora), nombre(m) || '(eliminado)', m.unidad || '', n2(m.cantidad), tipoLabel(m.tipo_movimiento),
          c.provById.get(m.proveedor_id)?.razon_social || '', d.responsable, d.subcontrato, m.frente_zona || '', m.documento_asociado || '', m.observaciones || ''];
      });
      return { headers: ['ID', 'Fecha de Movimiento', 'Hora', 'Insumo de Emergencia', 'Unidad', 'Cantidad', 'Tipo de Movimiento', 'Proveedor', 'Responsable', 'Subcontrato', 'Frente / Zona', 'Documento', 'Observaciones'], rows };
    } },
  { id: 'mantenimientos', label: 'Mantenimientos de Maquinaria', icon: 'tool', color: '#E67E22', grupo: 'Maquinaria', filtrable: true,
    build: (c, f) => {
      const equipo = (m) => c.activoById.get(m.activo_id)?.nombre || c.activoById.get(m.activo_id)?.placa || '';
      const rows = filtrarMovs(c.mants, f, equipo).map((m, i) => [i + 1, isoFecha(m.fecha), equipo(m) || '(eliminado)', m.tipo || '', n2(m.hm_actuales), m.descripcion || '', n2(m.costo_repuestos), n2(m.costo_mano_obra), n2(m.costo_total), m.taller || '', m.mecanico || '', n2(m.duracion_horas), m.observaciones || '']);
      return { headers: ['ID', 'Fecha', 'Equipo', 'Tipo', 'HM Actuales', 'Descripción', 'Costo Repuestos (S/)', 'Costo Mano de Obra (S/)', 'Costo Total (S/)', 'Taller', 'Mecánico', 'Duración (h)', 'Observaciones'], rows };
    } },
  { id: 'horas_maquina', label: 'Horas Máquina', icon: 'tool', color: '#16A085', grupo: 'Maquinaria', filtrable: true,
    build: (c, f) => {
      const equipo = (m) => c.activoById.get(m.activo_id)?.nombre || c.activoById.get(m.activo_id)?.placa || '';
      const rows = filtrarMovs(c.horas, f, equipo).map((m, i) => [i + 1, isoFecha(m.fecha), equipo(m) || '(eliminado)', n2(m.horas_trabajadas), n2(m.hm_inicial), n2(m.hm_final), nombrePersona(c.personalById.get(m.operador_id)), m.actividad || '', m.observaciones || '']);
      return { headers: ['ID', 'Fecha', 'Equipo', 'Horas Trabajadas', 'HM Inicial', 'HM Final', 'Operador', 'Actividad', 'Observaciones'], rows };
    } },
  { id: 'combustible', label: 'Consumos de Combustible', icon: 'tool', color: '#C0392B', grupo: 'Maquinaria', filtrable: true,
    build: (c, f) => {
      const equipo = (m) => c.activoById.get(m.activo_id)?.nombre || c.activoById.get(m.activo_id)?.placa || '';
      const rows = filtrarMovs(c.comb, f, equipo).map((m, i) => [i + 1, isoFecha(m.fecha), equipo(m) || '(eliminado)', n2(m.galones), n2(m.precio_galon), n2(m.total), m.surtidor || '', nombrePersona(c.personalById.get(m.operador_id)), n2(m.hm_actuales), m.observaciones || '']);
      return { headers: ['ID', 'Fecha', 'Equipo', 'Galones', 'Precio/Galón (S/)', 'Total (S/)', 'Surtidor', 'Operador', 'HM Actuales', 'Observaciones'], rows };
    } },
  { id: 'inventario_general', label: 'Inventario general (todos los insumos)', icon: 'package', color: '#2980B9', grupo: 'Inventario', filtrable: false,
    build: (c, f) => {
      const q = (f?.q || '').toLowerCase();
      const fila = (cat, nombre, unidad, stock, min, alerta, estado, ubic, precio) => [cat, nombre, unidad || '', n2(stock), n2(min), alerta || '', estado || '', ubic || '', n2(precio)];
      let rows = [
        ...c.mats.map((x) => fila('Material', x.nombre_material, x.unidad, x.stock_actual, x.stock_minimo, x.alerta, x.estado, c.ubicById.get(x.ubicacion_id)?.nombre, x.precio_unitario_estimado)),
        ...c.herrs.map((x) => fila('Herramienta', x.nombre_herramienta, x.unidad, x.stock_actual, x.stock_minimo, x.alerta, x.estado_actual, c.ubicById.get(x.ubicacion_id)?.nombre, '')),
        ...c.epps.map((x) => fila('EPP', x.nombre_epp, x.unidad, x.stock_actual, x.stock_minimo, x.alerta, x.estado, c.ubicById.get(x.ubicacion_id)?.nombre, '')),
        ...c.activos.map((x) => fila('Maquinaria', x.nombre || x.placa, x.unidad, x.stock_actual, '', '', x.estado, '', '')),
        ...c.insEmer.map((x) => fila('Insumo emergencia', x.nombre, x.unidad, x.stock_actual, x.stock_minimo, x.alerta, x.estado, '', '')),
      ];
      if (q) rows = rows.filter((r) => String(r[1] || '').toLowerCase().includes(q));
      rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])));
      return { headers: ['Categoría', 'Insumo', 'Unidad', 'Stock Actual', 'Stock Mínimo', 'Alerta', 'Estado', 'Ubicación', 'Precio Unit. (S/)'], rows };
    } },
  { id: 'personal', label: 'Personal (trabajadores)', icon: 'users', color: '#27AE60', grupo: 'RRHH', filtrable: false,
    build: (c, f) => {
      const q = (f?.q || '').toLowerCase();
      let list = c.personal.slice();
      if (f?.responsable && !f.responsable.startsWith('sub:')) { const id = f.responsable.startsWith('p:') ? f.responsable.slice(2) : f.responsable; list = list.filter((p) => p.id === id); }
      if (f?.responsable && f.responsable.startsWith('sub:')) { const id = f.responsable.slice(4); list = list.filter((p) => p.subcontratista_id === id); }
      if (q) list = list.filter((p) => `${p.nombres} ${p.apellidos} ${p.dni}`.toLowerCase().includes(q));
      list.sort((a, b) => `${a.apellidos} ${a.nombres}`.localeCompare(`${b.apellidos} ${b.nombres}`));
      const rows = list.map((p) => [p.nombres || '', p.apellidos || '', p.dni || '', p.cargo || '', p.area || '', p.estado || 'activo', p.subcontratista_id ? 'Subcontrato' : 'Directo', p.subcontratista_id ? (c.subsById.get(p.subcontratista_id)?.razon_social || '') : '', p.es_jefe_subcontrato ? 'Sí' : '', p.seguro_a_cargo || '', p.fecha_ingreso || '', p.fecha_nacimiento || '', p.telefono || '']);
      return { headers: ['Nombres', 'Apellidos', 'DNI', 'Cargo', 'Área', 'Estado', 'Vínculo', 'Subcontrato', 'Jefe Subcontrato', 'Seguro a cargo', 'Fecha Ingreso', 'Fecha Nac.', 'Teléfono'], rows };
    } },
  { id: 'asistencia', label: 'Asistencia', icon: 'calendar', color: '#1ABC9C', grupo: 'RRHH', filtrable: true,
    build: (c, f) => {
      const nombre = (m) => nombrePersona(c.personalById.get(m.personal_id));
      let rows = (c.asist || []);
      const { desde, hasta, q, responsable } = f || {};
      if (desde) rows = rows.filter((m) => isoFecha(m.fecha) >= desde);
      if (hasta) rows = rows.filter((m) => isoFecha(m.fecha) <= hasta);
      if (q) rows = rows.filter((m) => (nombre(m) || '').toLowerCase().includes(q.toLowerCase()));
      if (responsable && !responsable.startsWith('sub:')) { const id = responsable.startsWith('p:') ? responsable.slice(2) : responsable; rows = rows.filter((m) => m.personal_id === id); }
      rows = rows.slice().sort((a, b) => isoFecha(a.fecha).localeCompare(isoFecha(b.fecha)));
      return { headers: ['Fecha', 'Trabajador', 'Hora Ingreso', 'Hora Salida', 'Horas', 'Estado', 'Observaciones'], rows: rows.map((m) => [isoFecha(m.fecha), nombre(m), hhmm(m.hora_ingreso), hhmm(m.hora_salida), n2(m.horas_trabajadas), m.estado_asistencia || '', m.observaciones || '']) };
    } },
  { id: 'caja_chica', label: 'Caja Chica', icon: 'dollar', color: '#F39C12', grupo: 'Almacén', filtrable: true,
    build: (c, f) => {
      let rows = (c.caja || []);
      const { desde, hasta, q, responsable } = f || {};
      if (desde) rows = rows.filter((m) => isoFecha(m.fecha) >= desde);
      if (hasta) rows = rows.filter((m) => isoFecha(m.fecha) <= hasta);
      if (q) rows = rows.filter((m) => `${m.concepto || ''} ${m.proveedor || ''}`.toLowerCase().includes(q.toLowerCase()));
      if (responsable && !responsable.startsWith('sub:')) { const id = responsable.startsWith('p:') ? responsable.slice(2) : responsable; rows = rows.filter((m) => m.responsable_id === id); }
      rows = rows.slice().sort((a, b) => isoFecha(a.fecha).localeCompare(isoFecha(b.fecha)) || String(a.hora || '').localeCompare(String(b.hora || '')));
      return { headers: ['ID', 'Fecha', 'Hora', 'Tipo', 'Monto (S/)', 'Concepto', 'Responsable', 'Proveedor', 'Documento', 'Observaciones'], rows: rows.map((m, i) => [i + 1, isoFecha(m.fecha), hhmm(m.hora), m.tipo_movimiento === 'entrada' ? 'Ingreso' : 'Gasto', n2(m.monto), m.concepto || '', nombrePersona(c.personalById.get(m.responsable_id)), m.proveedor || '', m.documento_asociado || '', m.observaciones || '']) };
    } },
];

const DATASET_BY_ID = new Map(DATASETS.map((d) => [d.id, d]));

// Cuenta de registros por dataset (para mostrar en las tarjetas). Liviano.
export async function contarDatasets(obraId) {
  if (!obraId) return {};
  const c = await cargarContexto(obraId);
  const out = {};
  for (const d of DATASETS) {
    try { out[d.id] = d.build(c, {}).rows.length; } catch { out[d.id] = 0; }
  }
  return out;
}

function escribirWorkbook(XLSX, hojas, archivo) {
  const wb = XLSX.utils.book_new();
  for (const { nombre, headers, rows } of hojas) {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = headers.map((h) => ({ wch: Math.max(10, Math.min(40, String(h).length + 2)) }));
    XLSX.utils.book_append_sheet(wb, ws, String(nombre).slice(0, 31));
  }
  XLSX.writeFile(wb, archivo);
}

// Exporta UN dataset (un Excel de una hoja) con los filtros dados.
export async function exportarDataset(datasetId, obraId, obraNombre = 'obra', filtros = {}) {
  if (!obraId) throw new Error('No hay una obra activa para exportar.');
  const d = DATASET_BY_ID.get(datasetId);
  if (!d) throw new Error('Dataset desconocido: ' + datasetId);
  const XLSX = await import('xlsx');
  const c = await cargarContexto(obraId);
  const { headers, rows } = d.build(c, filtros);
  const fecha = new Date().toISOString().slice(0, 10);
  const archivo = `JARVEX_${datasetId}_${slug(obraNombre)}_${fecha}.xlsx`;
  escribirWorkbook(XLSX, [{ nombre: d.label, headers, rows }], archivo);
  return { archivo, filas: rows.length };
}

// Exporta TODO en un único workbook (una hoja por dataset).
export async function exportarTodo(obraId, obraNombre = 'obra', filtros = {}) {
  if (!obraId) throw new Error('No hay una obra activa para exportar.');
  const XLSX = await import('xlsx');
  const c = await cargarContexto(obraId);
  const hojas = DATASETS.map((d) => { const { headers, rows } = d.build(c, filtros); return { nombre: d.label, headers, rows }; });
  const total = hojas.reduce((s, h) => s + h.rows.length, 0);
  const fecha = new Date().toISOString().slice(0, 10);
  const archivo = `JARVEX_historico_completo_${slug(obraNombre)}_${fecha}.xlsx`;
  escribirWorkbook(XLSX, hojas, archivo);
  return { archivo, hojas: hojas.length, total };
}

// Compat: el nombre viejo apunta al export completo.
export const exportarHistoricoExcel = exportarTodo;
