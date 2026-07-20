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
import { getCurrentMode } from './app-mode-core.js';

// Predicado de modo — espejo de filterByMode (useOfflineData.js): en 'prueba'
// solo registros demo (demo === true); en 'edicion'/'produccion' solo reales.
// Lo usan los botones "Exportar Excel" de las páginas (porModo: true) para que
// el Excel coincida con lo que la página muestra. La pestaña Exportar y el
// backup completo de Super Admin NO lo pasan: siguen exportando todo.
function pasaModoActual() {
  const mode = getCurrentMode();
  if (mode === 'prueba') return (r) => r.demo === true;
  return (r) => !r.demo;
}

// Path dentro del bucket 'evidencias' (para createSignedUrl). Igual que jx-evidencias.
function pathFromUrl(url) {
  if (!url) return null;
  const idx = url.indexOf('/evidencias/');
  if (idx === -1) return null;
  return url.slice(idx + '/evidencias/'.length);
}
const extDe = (nombre, mime) => {
  const m = String(nombre || '').match(/\.([a-z0-9]{2,5})$/i); if (m) return m[1].toLowerCase();
  const t = String(mime || '');
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
  if (t.includes('png')) return 'png'; if (t.includes('webp')) return 'webp';
  if (t.includes('pdf')) return 'pdf'; if (t.includes('heic')) return 'heic';
  return 'bin';
};

const tipoLabel = (t) => (
  t === 'entrada' || t === 'ingreso' ? 'Ingreso'
  : t === 'salida' ? 'Salida'
  : t === 'devolucion' ? 'Devolución'
  : t === 'reverso' ? 'Reverso'
  : (t || '')
);
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
// opts.porModo: filtra demo/real según el modo actual (ver pasaModoActual).
async function cargarContexto(obraId, { porModo = false } = {}) {
  const pasaModo = porModo ? pasaModoActual() : () => true;
  const porObra = (t) => db[t].where('obra_id').equals(obraId).filter((r) => !r.deleted_at && pasaModo(r)).toArray();
  // Para tablas con obra_id pero SIN índice obra_id (ej. consumos_combustible),
  // filtramos en memoria — where('obra_id') sobre keypath no indexado rechaza.
  const porObraSinIndice = (t) => db[t].filter((r) => !r.deleted_at && r.obra_id === obraId && pasaModo(r)).toArray();
  const todos = (t) => db[t].filter((r) => !r.deleted_at && pasaModo(r)).toArray();
  const [
    movMat, movHerr, movEpp, movMaq, movEmer,
    mantsAll, horas, comb, caja, asist,
    mats, herrs, epps, activos, insEmer,
    personal, subs, provs, ubic, evid, fren, pcb,
    partidas, companies, accMovs, avances, obra,
  ] = await Promise.all([
    porObra('movimientos_materiales'), porObra('movimientos_herramientas'), porObra('movimientos_epp'),
    porObra('movimientos_maquinaria'), porObra('movimientos_insumos_emergencia'),
    todos('mantenimientos_maquinaria').catch(() => []), porObra('horas_maquina').catch(() => []),
    porObraSinIndice('consumos_combustible').catch(() => []), porObra('caja_chica_movimientos').catch(() => []),
    porObra('asistencia').catch(() => []),
    porObra('materiales'), porObra('herramientas'), porObra('epps'), todos('activos_pesados'), porObra('insumos_emergencia'),
    porObra('personal'), todos('subcontratistas'), todos('proveedores'), porObra('ubicaciones_obra'),
    porObra('evidencias').catch(() => []), porObra('frentes_obra').catch(() => []),
    porObra('personal_cuentas_bancarias').catch(() => []),
    // accounting_movements NO está indexado por obra_id → porObraSinIndice.
    porObra('partidas').catch(() => []), todos('companies').catch(() => []),
    porObraSinIndice('accounting_movements').catch(() => []), porObra('avance_obra').catch(() => []),
    db.obras.get(obraId).catch(() => null),
  ]);
  // mantenimientos_maquinaria NO tiene obra_id → lo scopeamos a los activos de
  // esta obra (asignados a la obra o que tienen movimientos en ella).
  const activoIdsObra = new Set([
    ...activos.filter((a) => a.obra_actual_id === obraId || a.obra_id === obraId).map((a) => a.id),
    ...movMaq.map((m) => m.activo_id),
  ].filter(Boolean));
  const mants = (mantsAll || []).filter((m) => activoIdsObra.has(m.activo_id));
  // Cuentas bancarias de los trabajadores agrupadas por persona.
  const pcbByPersonal = new Map();
  (pcb || []).forEach((c) => {
    if (!pcbByPersonal.has(c.personal_id)) pcbByPersonal.set(c.personal_id, []);
    pcbByPersonal.get(c.personal_id).push(c);
  });
  return {
    movMat, movHerr, movEpp, movMaq, movEmer, mants, horas, comb, caja, asist,
    mats, herrs, epps, activos, insEmer, personal, subs, provs, ubic, evid, fren, pcb,
    partidas, companies, accMovs, avances, obra,
    matById: byId(mats), herrById: byId(herrs), eppById: byId(epps), activoById: byId(activos),
    insEmerById: byId(insEmer), personalById: byId(personal), subsById: byId(subs),
    provById: byId(provs), ubicById: byId(ubic), frenById: byId(fren), pcbByPersonal,
    partById: byId(partidas), companyById: byId(companies),
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
      // scope: roles con scope exportan SOLO su alcance (Obrero+Profesionales+
      // Subcontratos vía scopeFiltro; compat con el viejo esObrero por cargo).
      if (f?.soloObreros && typeof f?.scopeFiltro === 'function') list = list.filter((p) => f.scopeFiltro(p));
      else if (f?.soloObreros && f?.esObrero) list = list.filter((p) => f.esObrero(p.cargo));
      if (f?.responsable && !f.responsable.startsWith('sub:')) { const id = f.responsable.startsWith('p:') ? f.responsable.slice(2) : f.responsable; list = list.filter((p) => p.id === id); }
      if (f?.responsable && f.responsable.startsWith('sub:')) { const id = f.responsable.slice(4); list = list.filter((p) => p.subcontratista_id === id); }
      if (q) list = list.filter((p) => `${p.nombres} ${p.apellidos} ${p.dni}`.toLowerCase().includes(q));
      list.sort((a, b) => `${a.apellidos} ${a.nombres}`.localeCompare(`${b.apellidos} ${b.nombres}`));
      // Headers ASCII (sin tildes) para que el round-trip con el importador
      // genérico (autoMap normaliza quitando acentos) y el restore funcionen.
      // La cuenta PRINCIPAL y la CTS van inline (como la plantilla de import);
      // si hay más cuentas, están completas en el dataset "Cuentas bancarias".
      const rows = list.map((p) => {
        // sinBancos: el caller no tiene permiso de "Cuentas Bancarias" → las 7
        // columnas bancarias salen vacías (headers intactos para el round-trip).
        const ctas = f?.sinBancos ? [] : (c.pcbByPersonal?.get(p.id) || []);
        const ppal = ctas.find((x) => x.principal) || ctas.find((x) => x.tipo_cuenta !== 'cts') || null;
        const cts = ctas.find((x) => x.tipo_cuenta === 'cts') || null;
        return [p.nombres || '', p.apellidos || '', p.alias || '', p.tipo_documento || 'dni', p.dni || '', p.cargo || '', p.area || '',
          p.frente_id ? (c.frenById.get(p.frente_id)?.nombre || '') : '', p.estado || 'activo',
          p.subcontratista_id ? 'Subcontrato' : 'Directo', p.subcontratista_id ? (c.subsById.get(p.subcontratista_id)?.razon_social || '') : '',
          p.es_jefe_subcontrato ? 'Sí' : '', p.seguro_a_cargo || '', p.fecha_ingreso || '', p.fecha_nacimiento || '', p.telefono || '',
          p.email || '', p.direccion || '', p.contacto_emergencia || '', p.telefono_emergencia || '', p.regimen_pension || '',
          ppal?.banco || '', ppal?.tipo_cuenta || '', ppal?.numero_cuenta || '', ppal?.cci || '', ppal?.moneda || '',
          cts?.banco || '', cts?.numero_cuenta || ''];
      });
      return { headers: ['Nombres', 'Apellidos', 'Alias', 'Tipo Documento', 'DNI', 'Cargo', 'Area', 'Frente', 'Estado', 'Vínculo', 'Subcontrato', 'Jefe Subcontrato', 'Seguro a cargo', 'Fecha Ingreso', 'Fecha Nacimiento', 'Telefono', 'Email', 'Direccion', 'Contacto Emergencia', 'Telefono Emergencia', 'Regimen Pension', 'Banco', 'Tipo Cuenta', 'Numero Cuenta', 'CCI', 'Moneda', 'Banco CTS', 'Cuenta CTS'], rows };
    } },
  { id: 'personal_cuentas', label: 'Cuentas bancarias (personal)', icon: 'dollar', color: '#16A085', grupo: 'RRHH', filtrable: false,
    build: (c, f) => {
      const q = (f?.q || '').toLowerCase();
      let list = (c.pcb || []).slice();
      if (q) list = list.filter((x) => { const p = c.personalById.get(x.personal_id); return `${p?.nombres || ''} ${p?.apellidos || ''} ${p?.dni || ''} ${x.banco || ''}`.toLowerCase().includes(q); });
      list.sort((a, b) => { const pa = c.personalById.get(a.personal_id), pb = c.personalById.get(b.personal_id); return `${pa?.apellidos || ''} ${pa?.nombres || ''}`.localeCompare(`${pb?.apellidos || ''} ${pb?.nombres || ''}`); });
      return { headers: ['Nombres', 'Apellidos', 'DNI', 'Banco', 'Tipo Cuenta', 'Numero Cuenta', 'CCI', 'Moneda', 'Principal', 'Observaciones'],
        rows: list.map((x) => { const p = c.personalById.get(x.personal_id); return [p?.nombres || '', p?.apellidos || '', p?.dni || '', x.banco || '', x.tipo_cuenta || '', x.numero_cuenta || '', x.cci || '', x.moneda || 'PEN', x.principal ? 'Sí' : '', x.observaciones || '']; }) };
    } },
  { id: 'frentes', label: 'Frentes de Trabajo', icon: 'flag', color: '#D35400', grupo: 'RRHH', filtrable: false,
    build: (c) => ({ headers: ['Frente', 'Descripción', 'Ingeniero a cargo', 'Orden', 'Activo'],
      rows: (c.fren || []).slice().sort((a, b) => Number(a.orden ?? 99) - Number(b.orden ?? 99)).map((f) => [f.nombre || '', f.descripcion || '', nombrePersona(c.personalById.get(f.ingeniero_id)), f.orden ?? '', f.activo !== false ? 'Sí' : 'No']) }) },
  { id: 'proveedores', label: 'Proveedores', icon: 'truck', color: '#2C3E50', grupo: 'Maestros', filtrable: false,
    build: (c, f) => { const q = (f?.q || '').toLowerCase(); let list = (c.provs || []); if (q) list = list.filter((p) => `${p.razon_social || ''} ${p.ruc || ''}`.toLowerCase().includes(q)); list = list.slice().sort((a, b) => (a.razon_social || '').localeCompare(b.razon_social || ''));
      return { headers: ['Razón social', 'RUC', 'Contacto', 'Teléfono', 'Correo', 'Tipo', 'Dirección'], rows: list.map((p) => [p.razon_social || '', p.ruc || '', p.contacto || '', p.telefono || '', p.correo || p.email || '', p.tipo_proveedor || '', p.direccion || '']) }; } },
  { id: 'subcontratistas', label: 'Subcontratistas', icon: 'users', color: '#8E44AD', grupo: 'Maestros', filtrable: false,
    build: (c, f) => { const q = (f?.q || '').toLowerCase(); let list = (c.subs || []); if (q) list = list.filter((s) => `${s.razon_social || ''} ${s.ruc || ''}`.toLowerCase().includes(q)); list = list.slice().sort((a, b) => (a.razon_social || '').localeCompare(b.razon_social || ''));
      return { headers: ['Razón social', 'RUC', 'Contacto', 'Teléfono', 'Correo', 'Dirección', 'Especialidad', 'Estado', 'Seguro a cargo'], rows: list.map((s) => [s.razon_social || '', s.ruc || '', s.contacto || '', s.telefono || '', s.correo || s.email || '', s.direccion || '', s.especialidad || '', s.estado || '', s.seguro_a_cargo || '']) }; } },
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
  { id: 'evidencias', label: 'Evidencias (registro)', icon: 'image', color: '#7F8C8D', grupo: 'Evidencias', filtrable: true,
    build: (c, f) => {
      let rows = (c.evid || []);
      const { desde, hasta, q } = f || {};
      if (desde) rows = rows.filter((e) => isoFecha(e.fecha) >= desde);
      if (hasta) rows = rows.filter((e) => isoFecha(e.fecha) <= hasta);
      if (q) rows = rows.filter((e) => `${e.nombre_archivo || ''} ${e.observaciones || ''}`.toLowerCase().includes(q.toLowerCase()));
      rows = rows.slice().sort((a, b) => isoFecha(a.fecha).localeCompare(isoFecha(b.fecha)));
      return { headers: ['Tipo', 'Módulo', 'Registro ID', 'Nombre archivo', 'Fecha', 'Observaciones', 'Estado', 'MIME', 'Tamaño (KB)', 'URL / Path'],
        rows: rows.map((e) => [e.tipo_evidencia || '', e.modulo_relacionado || '', e.registro_relacionado_id || '', e.nombre_archivo || '', isoFecha(e.fecha), e.observaciones || '', e.sync_status || '', e.mime_type || '', e.tamano_bytes ? Math.round(e.tamano_bytes / 1024) : '', e.url_archivo || e.local_path_temporal || '']) };
    } },

  // ── Movimientos contables (accounting_movements) con el máximo de datos ──
  { id: 'accounting', label: 'Movimientos Contables', icon: 'dollar', color: '#16A085', grupo: 'Contabilidad', filtrable: true,
    build: (c, f) => {
      const cn = (id) => c.companyById.get(id)?.name || c.companyById.get(id)?.legal_name || '';
      let rows = (c.accMovs || []);
      const { desde, hasta, q } = f || {};
      if (desde) rows = rows.filter((m) => isoFecha(m.date) >= desde);
      if (hasta) rows = rows.filter((m) => isoFecha(m.date) <= hasta);
      if (q) { const t = q.toLowerCase(); rows = rows.filter((m) => `${m.description || ''} ${m.third_party_name || ''} ${m.document_number || ''}`.toLowerCase().includes(t)); }
      rows = rows.slice().sort((a, b) => isoFecha(a.date).localeCompare(isoFecha(b.date)));
      return { headers: ['ID', 'Fecha', 'Tipo', 'Categoría', 'Descripción', 'Monto', 'Moneda', 'Empresa', 'Contraparte', 'RUC Contraparte', 'Estado Pago', 'Tipo Doc', 'N° Documento', 'Método Pago', 'Cuenta PCGE', 'Intercompany', 'Empresa Relacionada', 'Obra', 'Proveedor', 'Estado Factura', 'Recepción', 'Notas', 'Creado'],
        rows: rows.map((m) => [m.id, isoFecha(m.date), m.type || '', m.category || '', m.description || '', n2(m.amount), m.currency || 'PEN', cn(m.company_id), m.third_party_name || '', m.third_party_ruc || '', m.payment_status || '', m.document_type || '', m.document_number || '', m.metodo_pago || '', m.cuenta_pcge || '', m.is_intercompany ? 'Sí' : '', cn(m.related_company_id), c.obra?.nombre_obra || '', c.provById.get(m.proveedor_id)?.razon_social || '', m.estado_factura || '', m.recepcion_status || '', m.notas || '', isoFecha(m.created_at)]) };
    } },

  // ── Reportes de avance de los ingenieros (avance_obra origen='reporte') ──
  { id: 'reportes_avance', label: 'Reportes de Ingenieros', icon: 'edit', color: '#3498DB', grupo: 'Avance de Obra', filtrable: true,
    build: (c, f) => {
      let rows = (c.avances || []).filter((a) => a.origen === 'reporte');
      const { desde, hasta, q } = f || {};
      if (desde) rows = rows.filter((a) => isoFecha(a.fecha) >= desde);
      if (hasta) rows = rows.filter((a) => isoFecha(a.fecha) <= hasta);
      if (q) { const t = q.toLowerCase(); rows = rows.filter((a) => `${a.descripcion || ''}`.toLowerCase().includes(t)); }
      rows = rows.slice().sort((a, b) => isoFecha(a.fecha).localeCompare(isoFecha(b.fecha)));
      const nEvi = (aid) => (c.evid || []).filter((e) => e.modulo_relacionado === 'avance_obra' && String(e.registro_relacionado_id) === String(aid)).length;
      return { headers: ['ID', 'Fecha', 'Semana', 'Código Partida', 'Partida', 'Frente', 'Ingeniero', 'Metrado Ejecutado', '% Avance Acum.', 'Personal', 'Sobre-reporte', 'Motivo Sobre-reporte', 'Descripción', 'N° Fotos'],
        rows: rows.map((a) => { const p = c.partById.get(a.partida_id); return [a.id, isoFecha(a.fecha), a.semana || '', p?.codigo_delfin || '', p?.nombre_partida || '', c.frenById.get(a.frente_id)?.nombre || '', nombrePersona(c.personalById.get(a.responsable_id)), n2(a.metrado_ejecutado), a.porcentaje_avance_reportado != null ? Number(a.porcentaje_avance_reportado) : '', n2(a.personal_asignado), a.sobre_reporte ? 'Sí' : '', a.motivo_sobrereporte || '', a.descripcion || '', nEvi(a.id)]; }) };
    } },

  // ── Vinculaciones de insumos (salidas que el ingeniero vinculó a partida/frente) ──
  { id: 'vinculaciones_insumos', label: 'Vinculaciones de Insumos (Ingeniero)', icon: 'link', color: '#E67E22', grupo: 'Avance de Obra', filtrable: true,
    build: (c, f) => {
      const nombre = (m) => c.matById.get(m.material_id)?.nombre_material || '';
      const vinc = (c.movMat || []).filter((m) => m.tipo_movimiento === 'salida' && (m.partida_id || m.vinculacion_general));
      const rows = filtrarMovs(vinc, f, nombre).map((m) => {
        const d = destino(m, c.personalById, c.subsById);
        const p = c.partById.get(m.partida_id);
        return [isoFecha(m.fecha), nombre(m) || '(eliminado)', n2(m.cantidad), m.unidad || '', tipoLabel(m.tipo_movimiento),
          c.frenById.get(m.frente_id)?.nombre || '', m.vinculacion_general ? '(General al frente)' : (p?.codigo_delfin || ''), m.vinculacion_general ? '' : (p?.nombre_partida || ''),
          d.responsable, d.subcontrato, nombrePersona(c.personalById.get(m.partida_asignada_por)), isoFecha(m.partida_asignada_at), m.observaciones || ''];
      });
      return { headers: ['Fecha', 'Material', 'Cantidad', 'Unidad', 'Tipo', 'Frente', 'Código Partida', 'Partida', 'Responsable', 'Subcontrato', 'Vinculada por', 'Fecha vinculación', 'Observaciones'], rows };
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
// opts.porModo: true → respeta el modo demo/real actual (botones de página).
export async function exportarDataset(datasetId, obraId, obraNombre = 'obra', filtros = {}, opts = {}) {
  if (!obraId) throw new Error('No hay una obra activa para exportar.');
  const d = DATASET_BY_ID.get(datasetId);
  if (!d) throw new Error('Dataset desconocido: ' + datasetId);
  const XLSX = await import('xlsx');
  const c = await cargarContexto(obraId, opts);
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

// Descarga las EVIDENCIAS (fotos/PDF) reales en un .zip + manifiesto.csv.
// Trae cada archivo desde Supabase Storage (signed URL) si está subido, o del
// blob local (evidencias_blobs) si aún no se subió. onProgress(hechas, total).
export async function exportarFotosZip(obraId, obraNombre = 'obra', filtros = {}, onProgress) {
  if (!obraId) throw new Error('No hay una obra activa.');
  const c = await cargarContexto(obraId);
  let evid = (c.evid || []);
  const { desde, hasta, q } = filtros || {};
  if (desde) evid = evid.filter((e) => isoFecha(e.fecha) >= desde);
  if (hasta) evid = evid.filter((e) => isoFecha(e.fecha) <= hasta);
  if (q) evid = evid.filter((e) => `${e.nombre_archivo || ''} ${e.observaciones || ''}`.toLowerCase().includes(q.toLowerCase()));
  if (!evid.length) throw new Error('No hay evidencias para exportar con esos filtros.');

  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const manifest = [['archivo_en_zip', 'tipo', 'modulo', 'registro_id', 'fecha', 'nombre_original', 'estado', 'observaciones']];
  let ok = 0, fail = 0;
  for (let i = 0; i < evid.length; i++) {
    const e = evid[i];
    let blob = null;
    try {
      if ((e.sync_status === 'uploaded' || e.sync_status === 'synced') && e.url_archivo) {
        const path = pathFromUrl(e.url_archivo);
        if (path) {
          const { data } = await window.__supabase.storage.from('evidencias').createSignedUrl(path, 3600);
          if (data?.signedUrl) { const resp = await fetch(data.signedUrl); if (resp.ok) blob = await resp.blob(); }
        }
      }
      if (!blob) { const entry = await window.__db.evidencias_blobs.get(e.id); if (entry?.blob) blob = entry.blob; }
    } catch { /* sigue, cuenta como fail abajo */ }
    if (!blob) {
      fail++;
      manifest.push(['(no disponible)', e.tipo_evidencia || '', e.modulo_relacionado || '', e.registro_relacionado_id || '', isoFecha(e.fecha), e.nombre_archivo || '', e.sync_status || '', String(e.observaciones || '').replace(/\s+/g, ' ')]);
    } else {
      const ext = extDe(e.nombre_archivo, e.mime_type);
      const carpeta = slug(e.modulo_relacionado || 'evidencias');
      const fname = `${carpeta}/${slug(e.tipo_evidencia || 'foto')}_${isoFecha(e.fecha) || 'sf'}_${String(e.id).slice(0, 8)}.${ext}`;
      zip.file(fname, blob);
      manifest.push([fname, e.tipo_evidencia || '', e.modulo_relacionado || '', e.registro_relacionado_id || '', isoFecha(e.fecha), e.nombre_archivo || '', e.sync_status || '', String(e.observaciones || '').replace(/\s+/g, ' ')]);
      ok++;
    }
    if (onProgress) onProgress(i + 1, evid.length);
  }
  const csv = '﻿' + manifest.map((r) => r.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  zip.file('_manifiesto.csv', csv);
  const content = await zip.generateAsync({ type: 'blob' });
  const fecha = new Date().toISOString().slice(0, 10);
  const archivo = `JARVEX_evidencias_${slug(obraNombre)}_${fecha}.zip`;
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url; a.download = archivo; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  return { archivo, ok, fail, total: evid.length };
}

// Compat: el nombre viejo apunta al export completo.
export const exportarHistoricoExcel = exportarTodo;
