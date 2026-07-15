import { db, SYNC_STATUS, getLastSync, setLastSync } from '../db/jarvex.db';
import { supabase } from '../lib/supabase';
import { syncPendingAuditLogs } from '../lib/audit';
import { syncPendingChangeRequests } from '../lib/changeRequests';
import { captureException, captureMessage } from '../instrument.js';
import { trackEvent } from '../lib/posthog.js';

// Tablas que el cliente PUSHEA al servidor cuando hay cambios locales.
// Antes solo eran las "transaccionales" (movimientos, asistencia, etc.)
// — eso causaba que las obras/materiales/herramientas/etc. CREADAS o
// EDITADAS localmente NUNCA llegaran a Supabase, así otros usuarios
// jamás las veían. Ahora todas las tablas con sync_status pendientes
// participan del push.
const TRANSACTIONAL_TABLES = [
  'obras',
  'frentes_obra',        // antes de personal (personal.frente_id depende de él)
  'personal',
  'personal_historial',
  'personal_cuentas_bancarias',   // después de personal (FK personal_id)
  'materiales',
  'herramientas',
  'proveedores',
  'partidas',
  'insumos_partida',
  'frente_partidas',     // F1: vínculo frente↔partida (después de frentes_obra y partidas)
  'presupuestos_versiones',
  'partidas_versionadas',
  'insumos_partida_versionadas',
  'material_precios_historial',
  'companies',
  'accounting_movements',
  'intercompany_transactions',
  // Compras
  'insumos_pendientes',
  'requisiciones', 'requisicion_items',
  'cotizaciones', 'cotizacion_items',
  'ordenes_compra', 'oc_items',
  'recepciones', 'recepcion_items',
  // Valorizaciones
  'valorizaciones', 'valorizacion_partidas', 'valorizacion_adicionales',
  // Tesorería
  'cuentas_bancarias', 'movimientos_bancarios', 'cronograma_pagos',
  // Activos pesados
  'activos_pesados', 'horas_maquina', 'consumos_combustible', 'mantenimientos_maquinaria',
  'movimientos_maquinaria',
  // SSOMA
  'charlas_seguridad', 'charla_asistentes', 'iperc',
  'epp_entregas', 'inspecciones_seguridad', 'capacitaciones',
  // Subcontratos
  'subcontratistas', 'subcontratos', 'subcontrato_valorizaciones',
  // Planillas
  'personal_contrato', 'planillas', 'planilla_boletas',
  'asistencia',
  'movimientos_materiales',
  'movimientos_herramientas',
  'avance_obra',
  'avance_metas',
  'solicitudes_reporte',
  'solicitudes_frente',
  'incidencias',
  'evidencias',
  // Trazabilidad
  'trazabilidad_cadenas',
  // Ubicaciones de almacenaje (catálogo per-obra)
  'ubicaciones_obra',
  // EPPs (catálogo + movimientos con firma) — separados de materiales
  'epps',
  'movimientos_epp',
  // Stock por ubicación (desglose material/herramienta/epp × ubicación)
  'stock_ubicaciones',
  // Stock por estado/condición (buckets nuevo/bueno/reparacion/baja)
  'stock_estados',
  // Caja chica (almacén) + Insumos de emergencia (SSOMA)
  'caja_chica_movimientos',
  'insumos_emergencia',
  'movimientos_insumos_emergencia',
  // Historial de precios unificado (herramienta/epp/emergencia). FK-less, así que
  // no necesita FK_DEPS ni un orden particular respecto de catálogos/movimientos.
  'insumo_precios_historial',
  // Conciliación Tripartita (Feature 4): vínculo factura↔presupuesto. Después de
  // accounting_movements (FK accounting_movement_id) y obras (FK obra_id).
  'conciliacion_vinculos',
  // Catálogo de aprendizaje del clasificador de ítems de factura. Global,
  // FK-less; correcciones 'manual' pisan a 'ia' (resolución al leer).
  'clasificacion_catalogo',
  // Reglas subcategoría → empresa emisora (panel Compras por Categoría).
  // Después de companies (FK company_id).
  'emision_reglas',
  // Órdenes intercompany (Fase 4). Después de obras + companies (FKs).
  'ordenes_intercompany',
  // Reporte "día sin avance" del ingeniero. Después de obras + frentes_obra.
  'reportes_dia',
  // Pagos (compromisos) y sus partes. Después de personal/subcontratos/
  // accounting_movements (FKs) y pagos_partes después de pagos.
  'pagos',
  'pagos_partes',
  // Guías de remisión: después de proveedores/companies/accounting_movements.
  'guias_remision',
];

// Tablas maestras que se descargan del servidor en cada sync.
const MASTER_TABLES = [
  { tabla: 'obras',                  query: () => supabase.from('obras').select('*').is('deleted_at', null) },
  { tabla: 'frentes_obra',           query: () => supabase.from('frentes_obra').select('*').is('deleted_at', null) },
  { tabla: 'personal',               query: () => supabase.from('personal').select('*').is('deleted_at', null) },
  { tabla: 'personal_historial',     query: () => supabase.from('personal_historial').select('*').is('deleted_at', null) },
  { tabla: 'personal_cuentas_bancarias', query: () => supabase.from('personal_cuentas_bancarias').select('*').is('deleted_at', null) },
  { tabla: 'materiales',             query: () => supabase.from('materiales').select('*').is('deleted_at', null) },
  { tabla: 'herramientas',           query: () => supabase.from('herramientas').select('*').is('deleted_at', null) },
  { tabla: 'proveedores',            query: () => supabase.from('proveedores').select('*').is('deleted_at', null) },
  { tabla: 'partidas',               query: () => supabase.from('partidas').select('*').is('deleted_at', null) },
  { tabla: 'insumos_partida',        query: () => supabase.from('insumos_partida').select('*') },
  { tabla: 'frente_partidas',        query: () => supabase.from('frente_partidas').select('*').is('deleted_at', null) },
  { tabla: 'avance_metas',           query: () => supabase.from('avance_metas').select('*').is('deleted_at', null) },
  { tabla: 'solicitudes_reporte',    query: () => supabase.from('solicitudes_reporte').select('*').is('deleted_at', null) },
  { tabla: 'solicitudes_frente',     query: () => supabase.from('solicitudes_frente').select('*').is('deleted_at', null) },
  { tabla: 'presupuestos_versiones', query: () => supabase.from('presupuestos_versiones').select('*').is('deleted_at', null) },
  { tabla: 'partidas_versionadas',         query: () => supabase.from('partidas_versionadas').select('*').is('deleted_at', null) },
  { tabla: 'insumos_partida_versionadas',  query: () => supabase.from('insumos_partida_versionadas').select('*').is('deleted_at', null) },
  { tabla: 'material_precios_historial',   query: () => supabase.from('material_precios_historial').select('*').is('deleted_at', null) },
  { tabla: 'companies',                    query: () => supabase.from('companies').select('*').is('deleted_at', null) },
  { tabla: 'accounting_movements',         query: () => supabase.from('accounting_movements').select('*').is('deleted_at', null) },
  { tabla: 'conciliacion_vinculos',        query: () => supabase.from('conciliacion_vinculos').select('*').is('deleted_at', null) },
  { tabla: 'clasificacion_catalogo',       query: () => supabase.from('clasificacion_catalogo').select('*').is('deleted_at', null) },
  { tabla: 'emision_reglas',               query: () => supabase.from('emision_reglas').select('*').is('deleted_at', null) },
  { tabla: 'ordenes_intercompany',         query: () => supabase.from('ordenes_intercompany').select('*').is('deleted_at', null) },
  { tabla: 'reportes_dia',                 query: () => supabase.from('reportes_dia').select('*').is('deleted_at', null) },
  { tabla: 'pagos',                        query: () => supabase.from('pagos').select('*').is('deleted_at', null) },
  { tabla: 'pagos_partes',                 query: () => supabase.from('pagos_partes').select('*').is('deleted_at', null) },
  { tabla: 'guias_remision',               query: () => supabase.from('guias_remision').select('*').is('deleted_at', null) },
  { tabla: 'intercompany_transactions',    query: () => supabase.from('intercompany_transactions').select('*').is('deleted_at', null) },
  // Compras
  { tabla: 'insumos_pendientes',    query: () => supabase.from('insumos_pendientes').select('*').is('deleted_at', null) },
  { tabla: 'requisiciones',         query: () => supabase.from('requisiciones').select('*').is('deleted_at', null) },
  { tabla: 'requisicion_items',     query: () => supabase.from('requisicion_items').select('*').is('deleted_at', null) },
  { tabla: 'cotizaciones',          query: () => supabase.from('cotizaciones').select('*').is('deleted_at', null) },
  { tabla: 'cotizacion_items',      query: () => supabase.from('cotizacion_items').select('*').is('deleted_at', null) },
  { tabla: 'ordenes_compra',        query: () => supabase.from('ordenes_compra').select('*').is('deleted_at', null) },
  { tabla: 'oc_items',              query: () => supabase.from('oc_items').select('*').is('deleted_at', null) },
  { tabla: 'recepciones',           query: () => supabase.from('recepciones').select('*').is('deleted_at', null) },
  { tabla: 'recepcion_items',       query: () => supabase.from('recepcion_items').select('*').is('deleted_at', null) },
  // Valorizaciones
  { tabla: 'valorizaciones',         query: () => supabase.from('valorizaciones').select('*').is('deleted_at', null) },
  { tabla: 'valorizacion_partidas',  query: () => supabase.from('valorizacion_partidas').select('*').is('deleted_at', null) },
  { tabla: 'valorizacion_adicionales', query: () => supabase.from('valorizacion_adicionales').select('*').is('deleted_at', null) },
  // Tesorería
  { tabla: 'cuentas_bancarias',      query: () => supabase.from('cuentas_bancarias').select('*').is('deleted_at', null) },
  { tabla: 'movimientos_bancarios',  query: () => supabase.from('movimientos_bancarios').select('*').is('deleted_at', null) },
  { tabla: 'cronograma_pagos',       query: () => supabase.from('cronograma_pagos').select('*').is('deleted_at', null) },
  // Activos pesados
  { tabla: 'activos_pesados',        query: () => supabase.from('activos_pesados').select('*').is('deleted_at', null) },
  { tabla: 'horas_maquina',          query: () => supabase.from('horas_maquina').select('*').is('deleted_at', null) },
  { tabla: 'consumos_combustible',   query: () => supabase.from('consumos_combustible').select('*').is('deleted_at', null) },
  { tabla: 'mantenimientos_maquinaria', query: () => supabase.from('mantenimientos_maquinaria').select('*').is('deleted_at', null) },
  // SSOMA
  { tabla: 'charlas_seguridad',         query: () => supabase.from('charlas_seguridad').select('*').is('deleted_at', null) },
  { tabla: 'charla_asistentes',         query: () => supabase.from('charla_asistentes').select('*').is('deleted_at', null) },
  { tabla: 'iperc',                     query: () => supabase.from('iperc').select('*').is('deleted_at', null) },
  { tabla: 'epp_entregas',              query: () => supabase.from('epp_entregas').select('*').is('deleted_at', null) },
  { tabla: 'inspecciones_seguridad',    query: () => supabase.from('inspecciones_seguridad').select('*').is('deleted_at', null) },
  { tabla: 'capacitaciones',            query: () => supabase.from('capacitaciones').select('*').is('deleted_at', null) },
  // Subcontratos
  { tabla: 'subcontratistas',           query: () => supabase.from('subcontratistas').select('*').is('deleted_at', null) },
  { tabla: 'subcontratos',              query: () => supabase.from('subcontratos').select('*').is('deleted_at', null) },
  { tabla: 'subcontrato_valorizaciones',query: () => supabase.from('subcontrato_valorizaciones').select('*').is('deleted_at', null) },
  // Planillas
  { tabla: 'personal_contrato',         query: () => supabase.from('personal_contrato').select('*').is('deleted_at', null) },
  { tabla: 'planillas',                 query: () => supabase.from('planillas').select('*').is('deleted_at', null) },
  { tabla: 'planilla_boletas',          query: () => supabase.from('planilla_boletas').select('*').is('deleted_at', null) },
  // Trazabilidad
  { tabla: 'trazabilidad_cadenas',      query: () => supabase.from('trazabilidad_cadenas').select('*').is('deleted_at', null) },
  // Ubicaciones de almacenaje (catálogo per-obra)
  { tabla: 'ubicaciones_obra',          query: () => supabase.from('ubicaciones_obra').select('*').is('deleted_at', null) },
  // EPPs (separados de materiales)
  { tabla: 'epps',                      query: () => supabase.from('epps').select('*').is('deleted_at', null) },
  { tabla: 'movimientos_epp',           query: () => supabase.from('movimientos_epp').select('*') },
  { tabla: 'movimientos_maquinaria',    query: () => supabase.from('movimientos_maquinaria').select('*') },
  { tabla: 'stock_ubicaciones',         query: () => supabase.from('stock_ubicaciones').select('*').is('deleted_at', null) },
  { tabla: 'stock_estados',             query: () => supabase.from('stock_estados').select('*').is('deleted_at', null) },
  // Caja chica + insumos de emergencia
  { tabla: 'caja_chica_movimientos',         query: () => supabase.from('caja_chica_movimientos').select('*') },
  { tabla: 'insumos_emergencia',             query: () => supabase.from('insumos_emergencia').select('*').is('deleted_at', null) },
  { tabla: 'movimientos_insumos_emergencia', query: () => supabase.from('movimientos_insumos_emergencia').select('*') },
  { tabla: 'insumo_precios_historial',       query: () => supabase.from('insumo_precios_historial').select('*').is('deleted_at', null) },
  { tabla: 'profiles',               query: () => supabase.from('profiles').select('*') },
];

let syncInProgress = false;
let listeners = [];

export function onSyncChange(cb) {
  listeners.push(cb);
  return () => { listeners = listeners.filter(l => l !== cb); };
}

function emit(state) {
  listeners.forEach(cb => cb(state));
}

/**
 * Resincronización forzada total: wipea las tablas que tenemos cacheadas
 * en Dexie y vuelve a bajar TODO del server. Es la opción nuclear cuando
 * algo se desincronizó y no sabemos cómo. Borra solo las tablas que no
 * tienen pending locales (para no perder ediciones offline).
 *
 * Retorna { wiped, kept, total } con conteos por tabla.
 */
export async function forceFullResync() {
  const wiped = [];
  const kept = [];

  // 1) Push de todo lo pendiente PRIMERO. Si hay algo en pending, lo
  // intentamos subir para no perderlo.
  if (navigator.onLine) {
    try {
      emit({ syncing: true, error: null });
      await pushPendingOperations();
    } catch (e) {
      console.warn('[forceFullResync] push falló (continuamos):', e?.message);
    }
  }

  // 2) Borrar las tablas master en Dexie + resetear lastSync por tabla
  // para que el próximo pull traiga TODO desde 0.
  for (const { tabla } of MASTER_TABLES) {
    try {
      // Verificar si quedan pendientes en esta tabla. Si sí, NO la
      // borramos — el user perdería trabajo no sincronizado.
      const pending = await db[tabla]
        .where('sync_status').anyOf([
          SYNC_STATUS.PENDING_CREATE,
          SYNC_STATUS.PENDING_UPDATE,
          SYNC_STATUS.PENDING_DELETE,
          SYNC_STATUS.FAILED,
        ]).count();
      if (pending > 0) {
        kept.push({ tabla, pending });
        continue;
      }
      const before = await db[tabla].count();
      await db[tabla].clear();
      await setLastSync(tabla, null);
      wiped.push({ tabla, count: before });
    } catch (e) {
      console.warn(`[forceFullResync] error wipeando ${tabla}:`, e?.message);
    }
  }

  // 2b) Resetear el watermark de pull de las tablas TRANSACCIONAL-ONLY. Antes el
  // resync solo tocaba MASTER_TABLES, así que el watermark `${tabla}_pull` de
  // movimientos_materiales/herramientas/asistencia/avance_obra quedaba intacto y
  // "Forzar resync" NO recuperaba esos movimientos perdidos. Las dual (MASTER +
  // TRANSACTIONAL) ya las limpió el loop de arriba, así que aquí solo van las
  // transaccional-only (evita doble-clear y doble-conteo). Respeta pendientes.
  for (const tabla of transactionalOnlyTables()) {
    try {
      const pending = await db[tabla]
        .where('sync_status').anyOf([
          SYNC_STATUS.PENDING_CREATE,
          SYNC_STATUS.PENDING_UPDATE,
          SYNC_STATUS.PENDING_DELETE,
          SYNC_STATUS.FAILED,
        ]).count();
      if (pending > 0) { kept.push({ tabla, pending }); continue; }
      const before = await db[tabla].count();
      await db[tabla].clear();
      await setLastSync(`${tabla}_pull`, null);
      wiped.push({ tabla, count: before });
    } catch (e) {
      console.warn(`[forceFullResync] error wipeando tx ${tabla}:`, e?.message);
    }
  }

  // 3) Re-pull completo.
  try {
    await pullMasterTables();
    await pullTransactionalChanges();
    emit({ syncing: false, lastSync: new Date(), error: null });
    try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { source: 'force-resync' } })); } catch {}
  } catch (e) {
    emit({ syncing: false, error: e?.message || 'pull tras wipe falló' });
    throw e;
  }

  const totalWiped = wiped.reduce((s, x) => s + x.count, 0);
  const totalKept = kept.reduce((s, x) => s + x.pending, 0);
  return { wiped, kept, total: totalWiped, keptTotal: totalKept };
}

export async function getPendingCount() {
  const counts = await Promise.all(
    TRANSACTIONAL_TABLES.map(t =>
      db[t].where('sync_status').anyOf([
        SYNC_STATUS.PENDING_CREATE,
        SYNC_STATUS.PENDING_UPDATE,
        SYNC_STATUS.PENDING_DELETE,
      ]).count()
    )
  );
  return counts.reduce((a, b) => a + b, 0);
}

/**
 * Cuenta records FAILED (push fracasó tras 5 retries o por RLS).
 * Antes el badge solo mostraba `pending` — si todo lo pendiente fallaba,
 * el contador volvía a 0 y la UI decía "Sincronizado" aunque hubieran
 * datos perdidos. La auditoría del consejo lo flageó como bug #1.
 */
export async function getFailedCount() {
  const counts = await Promise.all(
    TRANSACTIONAL_TABLES.map(t =>
      db[t].where('sync_status').equals(SYNC_STATUS.FAILED).count()
    )
  );
  return counts.reduce((a, b) => a + b, 0);
}

/**
 * Devuelve el desglose de records FAILED por tabla con info útil para
 * mostrar al usuario en el modal de detalle.
 */
// Nombre técnico de columna → etiqueta humana, para los mensajes de error de sync.
const CAMPO_HUMANO = {
  payment_status: 'estado de pago', status: 'estado', estado: 'estado', type: 'tipo',
  clase: 'clase', currency: 'moneda', amount: 'monto', document_type: 'tipo de documento',
  tipo_evidencia: 'tipo de evidencia', tipo_movimiento: 'tipo de movimiento', rol: 'rol',
  rol_obra: 'rol en la obra', seguro_a_cargo: 'seguro a cargo', metodo_pago: 'método de pago',
  obra_id: 'obra', company_id: 'empresa', proveedor_id: 'proveedor', personal_id: 'personal',
  cuenta_pcge: 'cuenta contable', fecha: 'fecha', date: 'fecha',
};
// Valores aceptados por campos con CHECK conocidos (para sugerir la corrección).
const VALORES_VALIDOS = {
  payment_status: 'pendiente, pagado o anulado',
  tipo_evidencia: 'foto, documento, bancarización, etc.',
};
// Dado un nombre de constraint (<tabla>_<campo>_check/_fkey/_key) y el record,
// halla la columna real: el sufijo más largo que sea una clave del record.
function campoDeConstraint(cons, r) {
  const base = String(cons || '').replace(/_(check|fkey|key|chk|excl|unique)\d*$/i, '');
  const parts = base.split('_');
  for (let i = 0; i < parts.length; i++) {
    const cand = parts.slice(i).join('_');
    if (cand && r && Object.prototype.hasOwnProperty.call(r, cand)) return cand;
  }
  return parts[parts.length - 1] || base;
}
// A partir del error de Postgres + el record FAILED, intenta extraer QUÉ campo y
// QUÉ valor incumplen la regla, en términos entendibles. Devuelve null si no aplica.
function explicarErrorRegla(r) {
  const msg = r?._last_error || '';
  const det = r?._last_error_details || '';
  let m = /violates check constraint "([^"]+)"/i.exec(msg);
  if (m) {
    const campo = campoDeConstraint(m[1], r);
    return { regla: 'check', campo, campoHumano: CAMPO_HUMANO[campo] || campo,
      valor: r?.[campo], validos: VALORES_VALIDOS[campo] || null };
  }
  m = /null value in column "([^"]+)"/i.exec(msg);
  if (m) {
    const campo = m[1];
    return { regla: 'not_null', campo, campoHumano: CAMPO_HUMANO[campo] || campo, valor: null, validos: null };
  }
  m = /Key \(([^)]+)\)=\(([^)]+)\)/i.exec(det) || /Key \(([^)]+)\)=\(([^)]+)\)/i.exec(msg);
  if (m) {
    const campo = m[1].trim();
    return { regla: /foreign key/i.test(msg) ? 'fk' : 'unique', campo,
      campoHumano: CAMPO_HUMANO[campo] || campo, valor: m[2], validos: null };
  }
  return null;
}

export async function getFailedDetails() {
  const out = [];
  // Precargar personal una vez para resolver nombres legibles (el error de
  // "personal duplicado" mostraba solo un fragmento del uuid — inútil para
  // ubicar a quién corregir). Mapea id → "Nombres Apellidos".
  let personalById = new Map();
  try {
    const ps = await db.personal.toArray();
    personalById = new Map(ps.map(p => [p.id, `${p.nombres || ''} ${p.apellidos || ''}`.trim() || '(sin nombre)']));
  } catch {}
  // Nombre legible de un registro FAILED según su tabla (para que el modal diga
  // "Juan Pérez · DNI X" en vez del uuid). Movimientos resuelven el responsable.
  const nombreLegible = (t, r) => {
    if (t === 'personal') return `${`${r.nombres || ''} ${r.apellidos || ''}`.trim() || '(sin nombre)'}${r.dni ? ` · DNI ${r.dni}` : ''}`;
    if (t === 'subcontratistas') return r.razon_social || r.nombre || '';
    if (t === 'frentes_obra' || t === 'ubicaciones_obra') return r.nombre || '';
    if (t === 'personal_cuentas_bancarias' || t === 'personal_historial') return personalById.get(r.personal_id) || '';
    if (t.startsWith('movimientos_')) {
      const ins = r.nombre_material || r.nombre_epp || r.nombre_herramienta || r.nombre_insumo || '';
      const quien = personalById.get(r.personal_id) || personalById.get(r.responsable_id) || '';
      return [ins, quien].filter(Boolean).join(' → ') || (r.tipo_movimiento ? `${r.tipo_movimiento}` : '');
    }
    return r.nombre_material || r.nombre_partida || r.descripcion || r.nombre_insumo || r.nombre || '';
  };
  for (const t of TRANSACTIONAL_TABLES) {
    const rows = await db[t].where('sync_status').equals(SYNC_STATUS.FAILED).toArray();
    if (rows.length === 0) continue;
    out.push({
      tabla: t,
      label: TABLA_TO_MODULO[t] || t,
      count: rows.length,
      rows: rows.slice(0, 50).map(r => ({
        id: r.id,
        codigo: r.codigo || r.codigo_delfin || r.serie_correlativo || r.id.slice(0, 8),
        // nombre humano (prioritario) + descripción de respaldo
        nombre: nombreLegible(t, r),
        descripcion: r.nombre_material || r.nombre_partida || r.descripcion || r.nombre_insumo || '',
        error: r._last_error || 'Error desconocido',
        errorCode: r._last_error_code || null,
        errorDetails: r._last_error_details || null,
        errorHint: r._last_error_hint || null,
        // Campo + valor concretos que incumplen la regla (parseados del error).
        regla: explicarErrorRegla(r),
        isRLS: !!r._last_error_is_rls,
        retries: r._sync_retries || 0,
        updatedAt: r.updated_at,
      })),
    });
  }
  return out;
}

/**
 * Resetea TODOS los records FAILED a su estado de pending correspondiente
 * (PENDING_CREATE si version<=1, PENDING_UPDATE si >1). El próximo tick
 * del SyncEngine los reintentará.
 *
 * Retorna { tablas, total } para feedback al usuario.
 */
export async function retryAllFailed() {
  let total = 0;
  const tablas = [];
  for (const t of TRANSACTIONAL_TABLES) {
    const rows = await db[t].where('sync_status').equals(SYNC_STATUS.FAILED).toArray();
    if (rows.length === 0) continue;
    for (const r of rows) {
      const restoreStatus = (Number(r.version) || 1) <= 1
        ? SYNC_STATUS.PENDING_CREATE
        : SYNC_STATUS.PENDING_UPDATE;
      await db[t].update(r.id, {
        sync_status: restoreStatus,
        _sync_retries: 0,
      });
      total++;
    }
    tablas.push({ tabla: t, count: rows.length });
  }
  // Disparar push inmediato
  if (total > 0 && navigator.onLine) {
    setTimeout(() => { syncAll().catch(()=>{}); }, 100);
  }
  return { tablas, total };
}

export async function syncAll() {
  if (syncInProgress || !navigator.onLine) return;
  syncInProgress = true;
  emit({ syncing: true, error: null });

  console.log('[SyncEngine] === syncAll() iniciado ===');
  const t0 = performance.now();

  try {
    console.log('[SyncEngine] 1/5 push de operaciones pendientes…');
    await pushPendingOperations();

    console.log('[SyncEngine] 2/5 push de audit logs…');
    await pushPendingAuditLogs();

    console.log('[SyncEngine] 3/5 push de change requests…');
    await pushPendingChangeRequests();

    console.log('[SyncEngine] 4/5 pull de master tables (obras, materiales, partidas, etc.)…');
    await pullMasterTables();

    console.log('[SyncEngine] 5/5 pull de transactional (movimientos, asistencia, evidencias)…');
    await pullTransactionalChanges();

    const [pending, failed] = await Promise.all([getPendingCount(), getFailedCount()]);
    const ms = Math.round(performance.now() - t0);
    console.log(`[SyncEngine] ✓ syncAll OK en ${ms}ms · pending=${pending} failed=${failed}`);
    emit({ syncing: false, pending, failed, lastSync: new Date(), error: null, phase: null, current: 0, total: 0 });
  } catch (err) {
    console.error('[SyncEngine] ✗ Error en syncAll:', err);
    emit({ syncing: false, error: err.message, phase: null, current: 0, total: 0 });
    // Sentry: syncAll completo falló (no un record individual). Es grave.
    captureException(err, {
      tags: { module: 'sync-engine', operation: 'syncAll' },
      level: 'error',
    });
  } finally {
    syncInProgress = false;
  }
}

// ── PUSH: audit logs pendientes ───────────────────────────────────────

async function pushPendingAuditLogs() {
  try {
    const n = await syncPendingAuditLogs();
    if (n > 0) console.log(`[SyncEngine] ${n} audit logs sincronizados`);
  } catch (e) {
    console.warn('[SyncEngine] pushPendingAuditLogs:', e?.message || e);
  }
}

// ── PUSH: solicitudes de cambio pendientes ────────────────────────────

async function pushPendingChangeRequests() {
  try {
    const n = await syncPendingChangeRequests();
    if (n > 0) console.log(`[SyncEngine] ${n} change requests sincronizadas`);
  } catch (e) {
    console.warn('[SyncEngine] pushPendingChangeRequests:', e?.message || e);
  }
}

// ── PUSH: local → Supabase ────────────────────────────────────────────

// Cuántas tablas pushear en paralelo. 5 es un balance razonable entre
// velocidad y no saturar Supabase / RLS / la conexión del cliente.
const PUSH_PARALLELISM = 5;

// Mapeo tabla → módulo de la matriz de permisos. Si el user actual no
// tiene 'w' en el módulo, skipeamos el push de esa tabla — sino el
// SyncEngine intenta crear records que el RLS server bloquea, gasta
// retries (5 por record) y spammea Sentry con warnings RLS sabidos.
//
// Caso real (Sentry JARVEX-APP-9/A/B): el almacenero tiene insumos de
// partidas en su Dexie (importados por el admin) marcados como
// pending_create por algún edge case del pull. El push falla 79 veces
// con RLS porque almacenero no tiene 'w' en Insumos/Partidas.
const TABLA_TO_MODULO = {
  obras: 'Obras',
  personal: 'Personal',
  personal_historial: 'Personal',
  personal_cuentas_bancarias: 'Personal',
  // frentes_obra: sin mapear a propósito → canPushTabla deja pasar (no existe
  // módulo 'Frentes' en la matriz de permisos; el CRUD ya gatea por rol).
  materiales: 'Materiales',
  herramientas: 'Herramientas',
  epps: 'EPP',
  proveedores: 'Proveedores',
  partidas: 'Partidas',
  insumos_partida: 'Insumos',
  partidas_versionadas: 'Versiones presupuesto',
  insumos_partida_versionadas: 'Versiones presupuesto',
  presupuestos_versiones: 'Versiones presupuesto',
  cronograma: 'Cronograma',
  movimientos_materiales: 'Mov. Materiales',
  movimientos_herramientas: 'Mov. Herramientas',
  movimientos_epp: 'EPP',
  movimientos_maquinaria: 'Mov. Maquinaria',
  caja_chica_movimientos: 'Caja Chica',
  // OJO: el módulo canónico en la matriz de permisos es 'Insumos de Emergencia'
  // (con "de"). Antes apuntaba a 'Insumos Emergencia' / 'Mov. Insumos Emergencia',
  // módulos que NO existen → __hasPerm devolvía false y el push quedaba
  // bloqueado para todo rol no-admin (prevencionista, y ahora almacenero).
  insumos_emergencia: 'Insumos de Emergencia',
  movimientos_insumos_emergencia: 'Insumos de Emergencia',
  asistencia: 'Asistencia',
  avance_obra: 'Avance',
  solicitudes_reporte: 'Avance',
  solicitudes_frente: 'Avance',
  incidencias: 'Incidencias',
  evidencias: 'Evidencias',
  ubicaciones_obra: 'Ubicaciones',
  insumos_pendientes: 'Requisiciones',
  requisiciones: 'Requisiciones',
  requisicion_items: 'Requisiciones',
  cotizaciones: 'Cotizaciones',
  cotizacion_items: 'Cotizaciones',
  ordenes_compra: 'Órdenes de Compra',
  oc_items: 'Órdenes de Compra',
  recepciones: 'Recepciones',
  recepcion_items: 'Recepciones',
  valorizaciones: 'Valorizaciones',
  valorizacion_partidas: 'Valorizaciones',
  valorizacion_adicionales: 'Valorizaciones',
  cuentas_bancarias: 'Cuentas Bancarias',
  movimientos_bancarios: 'Cuentas Bancarias',
  cronograma_pagos: 'Cuentas Bancarias',
  activos_pesados: 'Activos Pesados',
  horas_maquina: 'Horas Máquina',
  consumos_combustible: 'Horas Máquina',
  mantenimientos_maquinaria: 'Mantenimiento',
  charlas_seguridad: 'Charlas Seguridad',
  charla_asistentes: 'Charlas Seguridad',
  iperc: 'IPERC',
  epp_entregas: 'EPP',
  inspecciones_seguridad: 'Inspecciones SSOMA',
  capacitaciones: 'Capacitaciones',
  subcontratistas: 'Subcontratistas',
  subcontratos: 'Subcontratos',
  subcontrato_valorizaciones: 'Valor. Subcontrato',
  personal_contrato: 'Contratos Laborales',
  planillas: 'Planillas',
  planilla_boletas: 'Planillas',
  companies: 'Empresas',
  accounting_movements: 'Movs. Contables',
  // Catálogo del clasificador: lo escriben contadora jefe y ayudante (ambos
  // con Movs. Contables 'w') al clasificar/corregir ítems de factura.
  clasificacion_catalogo: 'Movs. Contables',
  // Reglas de emisión: designación entre empresas del grupo → solo quien tiene
  // Intercompany 'w' (contadora jefe/admin; el ayudante NO).
  emision_reglas: 'Intercompany',
  // Órdenes intercompany: las escriben jefe/admin (aprobación admin en UI).
  ordenes_intercompany: 'Intercompany',
  // Reporte "día sin avance": lo escribe el ingeniero (mismo módulo que avance_obra).
  reportes_dia: 'Avance',
  // Pagos de personal/subcontratos: área contable (contadora jefe/admin).
  pagos: 'Planillas',
  // Las PARTES también las registra el ayudante al bancarizar facturas
  // (tiene Movs. Contables 'w' pero Planillas 'x' — con 'Planillas' su push
  // quedaba bloqueado client-side y la parte en pending eterno).
  pagos_partes: 'Movs. Contables',
  // Guías de remisión: las sube Captura (contador/ayudante/admin con Captura-w).
  guias_remision: 'Movs. Contables',
  intercompany_transactions: 'Intercompany',
  trazabilidad_cadenas: 'Trazabilidad',
};

function canPushTabla(tabla) {
  try {
    // IMPORTANTE: leer del espejo `window.__currentRol` (publicado por
    // useAuth via efecto), NO invocar `useAuth()` desde acá. El
    // SyncEngine corre en setInterval, fuera del árbol React, y llamar
    // un hook ahí dispara "Invalid hook call" (Sentry JARVEX-APP-D).
    const rol = window.__currentRol;
    if (!rol) return true;          // sin rol todavía: dejar pasar
    if (rol === 'admin') return true;
    // companies es dependencia transversal de la contabilidad: si el rol puede
    // crear movimientos contables / intercompany, debe poder subir la empresa que
    // esos referencian. La RLS del server YA permite INSERT de companies a
    // cualquier autenticado (migs 030/034), el bloqueo era 100% client-side: un
    // contador con Captura Mágica sin módulo 'Empresas' dejaba la empresa PENDING
    // eterna y sus movimientos morían en 23503 (JARVEX-APP-8, 241x).
    if (tabla === 'companies') {
      const haceContab = window.__hasPerm?.(rol, 'Movs. Contables', 'w') === true
        || window.__hasPerm?.(rol, 'Intercompany', 'w') === true;
      if (haceContab) return true;
    }
    // proveedores: misma lógica que companies. Captura Mágica crea el proveedor
    // emisor de cada factura; quien puede hacer Captura debe poder subirlo, si no
    // el proveedor queda PENDING y sus movimientos mueren en 23503. La RLS del
    // server ya permite INSERT a cualquier autenticado (mig 030). Esto NO habilita
    // editar proveedores desde su página (esa gatea por 'Proveedores'-w aparte),
    // solo desbloquea el push de los que crea la Captura.
    if (tabla === 'proveedores') {
      if (window.__hasPerm?.(rol, 'Captura Mágica', 'w') === true) return true;
    }
    const modulo = TABLA_TO_MODULO[tabla];
    if (!modulo) return true;       // sin mapping: defensivo, dejar pasar
    return window.__hasPerm?.(rol, modulo, 'w') ?? true;
  } catch {
    return true;
  }
}

// Foreign keys que NO deben pushearse mientras la entidad referenciada
// esté pendiente de sync en local. Si el material X todavía es PENDING en
// Dexie, un movimiento que referencia X NO debe llegar al server primero,
// porque otros devices verían "(material no disponible)". Esperamos al
// próximo ciclo, cuando X ya esté SYNCED.
const FK_DEPS = {
  // OJO: gatear TODAS las FKs reales del server, no solo el insumo. La
  // migración histórica crea personas/subcontratistas pending y los
  // movimientos que los referencian salían antes que ellos → 23503 → FAILED
  // (los "24 registros no se pudieron subir" de la importación de herramientas).
  movimientos_materiales:    [{ campo: 'material_id', tabla: 'materiales' }, { campo: 'responsable_id', tabla: 'personal' }, { campo: 'subcontratista_id', tabla: 'subcontratistas' }, { campo: 'proveedor_id', tabla: 'proveedores' }, { campo: 'partida_id', tabla: 'partidas' }],
  movimientos_herramientas:  [{ campo: 'herramienta_id', tabla: 'herramientas' }, { campo: 'responsable_id', tabla: 'personal' }, { campo: 'subcontratista_id', tabla: 'subcontratistas' }],
  movimientos_epp:           [{ campo: 'epp_id', tabla: 'epps' }, { campo: 'personal_id', tabla: 'personal' }, { campo: 'subcontratista_id', tabla: 'subcontratistas' }],
  movimientos_maquinaria:    [{ campo: 'activo_id', tabla: 'activos_pesados' }, { campo: 'responsable_id', tabla: 'personal' }, { campo: 'subcontratista_id', tabla: 'subcontratistas' }, { campo: 'proveedor_id', tabla: 'proveedores' }],
  // Datasets de maquinaria + caja chica (import histórico/restore los crea en
  // el mismo lote que activos/personal pending; sin esto el INSERT hijo puede
  // ganarle la carrera al padre dentro del mismo batch paralelo → FK 23503).
  horas_maquina:             [{ campo: 'activo_id', tabla: 'activos_pesados' }, { campo: 'operador_id', tabla: 'personal' }],
  consumos_combustible:      [{ campo: 'activo_id', tabla: 'activos_pesados' }, { campo: 'operador_id', tabla: 'personal' }],
  mantenimientos_maquinaria: [{ campo: 'activo_id', tabla: 'activos_pesados' }],
  caja_chica_movimientos:    [{ campo: 'responsable_id', tabla: 'personal' }],
  // La regla de emisión referencia la empresa emisora + intermediarias (FKs reales).
  emision_reglas:            [{ campo: 'company_id', tabla: 'companies' }, { campo: 'intermediaria1_company_id', tabla: 'companies' }, { campo: 'intermediaria2_company_id', tabla: 'companies' }],
  ordenes_intercompany:      [{ campo: 'obra_id', tabla: 'obras' }, { campo: 'company_id', tabla: 'companies' }, { campo: 'intermediaria1_company_id', tabla: 'companies' }, { campo: 'intermediaria2_company_id', tabla: 'companies' }, { campo: 'ejecutora_company_id', tabla: 'companies' }],
  reportes_dia:              [{ campo: 'frente_id', tabla: 'frentes_obra' }],
  pagos:                     [{ campo: 'personal_id', tabla: 'personal' }, { campo: 'subcontrato_id', tabla: 'subcontratos' }],
  pagos_partes:              [{ campo: 'pago_id', tabla: 'pagos' }, { campo: 'accounting_movement_id', tabla: 'accounting_movements' }],
  guias_remision:            [{ campo: 'company_id', tabla: 'companies' }, { campo: 'proveedor_id', tabla: 'proveedores' }, { campo: 'accounting_movement_id', tabla: 'accounting_movements' }],
  movimientos_insumos_emergencia: [{ campo: 'insumo_emergencia_id', tabla: 'insumos_emergencia' }, { campo: 'responsable_id', tabla: 'personal' }, { campo: 'subcontratista_id', tabla: 'subcontratistas' }, { campo: 'proveedor_id', tabla: 'proveedores' }],
  asistencia:                [{ campo: 'personal_id', tabla: 'personal' }],
  // Un trabajador puede pertenecer a la cuadrilla de un subcontratista; si ese
  // subcontratista aún es PENDING local, esperamos a que sincronice primero
  // (FK opcional: se salta cuando subcontratista_id es null = personal directo).
  personal:                  [{ campo: 'subcontratista_id', tabla: 'subcontratistas' }, { campo: 'frente_id', tabla: 'frentes_obra' }],
  personal_historial:        [{ campo: 'personal_id', tabla: 'personal' }],
  personal_cuentas_bancarias: [{ campo: 'personal_id', tabla: 'personal' }],
  recepcion_items:           [{ campo: 'recepcion_id', tabla: 'recepciones' }],
  oc_items:                  [{ campo: 'orden_compra_id', tabla: 'ordenes_compra' }],
  cotizacion_items:          [{ campo: 'cotizacion_id', tabla: 'cotizaciones' }],
  requisicion_items:         [{ campo: 'requisicion_id', tabla: 'requisiciones' }],
  // El desglose de stock referencia la ubicación (FK real en server). El
  // item_id es polimórfico (sin FK), así que solo esperamos a la ubicación.
  stock_ubicaciones:         [{ campo: 'ubicacion_id', tabla: 'ubicaciones_obra' }],
  // partidas e insumos_partida van en el MISMO batch paralelo del push: sin
  // el gate, un insumo podía llegar al server antes que su partida → 23503.
  insumos_partida:           [{ campo: 'partida_id', tabla: 'partidas' }],
  frente_partidas:           [{ campo: 'frente_id', tabla: 'frentes_obra' }, { campo: 'partida_id', tabla: 'partidas' }],
  avance_metas:              [{ campo: 'partida_id', tabla: 'partidas' }],
  solicitudes_reporte:       [{ campo: 'frente_id', tabla: 'frentes_obra' }],
  solicitudes_frente:        [{ campo: 'partida_id', tabla: 'partidas' }],
  // Espejo versionado: el snapshot de versión (jx-gestion / jx-importar) crea
  // presupuestos_versiones + partidas_versionadas + insumos_partida_versionadas
  // pending_create en el MISMO lote, y las tres caen en el MISMO batch paralelo
  // del push (índices 10-12 con PUSH_PARALLELISM=5). Las FKs son NOT NULL
  // (migs 018/019): sin el gate, el INSERT hijo puede ganarle al padre →
  // 23503 tumba el chunk de 200 entero → fallback per-record (hasta 200
  // requests fallidos por chunk con un APU de 50k insumos). Misma patología
  // que insumos_partida → partidas, arriba.
  partidas_versionadas:        [{ campo: 'version_id', tabla: 'presupuestos_versiones' }],
  insumos_partida_versionadas: [{ campo: 'version_id', tabla: 'presupuestos_versiones' }, { campo: 'partida_versionada_id', tabla: 'partidas_versionadas' }],
  // El historial de precios referencia DOS FKs reales del server (mig 020):
  // material_id (NOT NULL) y origen_movimiento_id. La recepción de Compras
  // Pendientes ("crear insumo nuevo + registrar precio") crea el material, el
  // movimiento y la fila de historial en el MISMO lote pending. material_precios_historial
  // (idx 13 en TRANSACTIONAL_TABLES) pushea ANTES que movimientos_materiales
  // (idx ~52), así que sin gate la fila de historial llega al server antes que
  // su movimiento → 23503 garantizado en origen_movimiento_id (no es carrera:
  // el orden de las tablas lo determina). Gateamos ambos padres, igual que
  // personal_historial → personal.
  material_precios_historial:  [{ campo: 'material_id', tabla: 'materiales' }, { campo: 'origen_movimiento_id', tabla: 'movimientos_materiales' }, { campo: 'obra_id', tabla: 'obras' }],
  // insumo_precios_historial (herr/epp/emergencia) es FK-less respecto a
  // item_id/origen_movimiento_id (polimórfico, como stock_ubicaciones), pero
  // obra_id SÍ es FK NOT NULL real → la gateamos para no pushear el historial de
  // una obra recién creada offline antes que la obra (23503).
  insumo_precios_historial:    [{ campo: 'obra_id', tabla: 'obras' }],
  // Contabilidad: el movimiento (y la transacción intercompany) referencian la
  // empresa. Captura Mágica crea empresa + movimiento en el MISMO lote; companies
  // (idx 15) y accounting_movements (idx 16) caen en el MISMO batch paralelo del
  // push → el hijo le ganaba la carrera al padre → 23503
  // (accounting_movements_company_id_fkey), 5 retries → FAILED → 241 en Sentry
  // (JARVEX-APP-8). Constraints con naming default <tabla>_<campo>_fkey (verificado
  // en schema: company_id/related_company_id/related_movement_id/obra_id/proveedor_id
  // y seller_/buyer_company_id/movement_id), así el self-heal 23503 también aplica.
  // Las FKs null se saltan solas (guard `if (!id) continue` en fkDepsReady).
  accounting_movements:      [{ campo: 'company_id', tabla: 'companies' }, { campo: 'related_company_id', tabla: 'companies' }, { campo: 'related_movement_id', tabla: 'accounting_movements' }, { campo: 'obra_id', tabla: 'obras' }, { campo: 'proveedor_id', tabla: 'proveedores' }],
  intercompany_transactions: [{ campo: 'seller_company_id', tabla: 'companies' }, { campo: 'buyer_company_id', tabla: 'companies' }, { campo: 'seller_movement_id', tabla: 'accounting_movements' }, { campo: 'buyer_movement_id', tabla: 'accounting_movements' }],
};

// True si todas las FKs del record están sincronizadas (o no hay FKs).
async function fkDepsReady(tabla, record) {
  const deps = FK_DEPS[tabla];
  if (!deps) return true;
  for (const { campo, tabla: tablaRef } of deps) {
    const id = record[campo];
    if (!id) continue; // FK opcional
    const ref = await db[tablaRef].get(id);
    // Ausente de Dexie ≠ ausente del server: los soft-deletes BORRAN la
    // fila local del padre (tombstones del pull, reconcile sweep del full
    // pull, pushDeletesBatch) pero el server conserva la fila física con
    // deleted_at — la FK del hijo PASA. Bloquear acá dejaba el hijo en
    // pending ETERNO y silencioso (ej: editar un movimiento viejo cuyo
    // responsable fue dado de baja). Solo esperamos si el padre ESTÁ en
    // Dexie y aún no se sincronizó; si no está, push y que el server
    // decida — un 23503 real termina en FAILED visible y el self-heal #3
    // lo diagnostica.
    if (!ref) continue;
    if (ref.sync_status && ref.sync_status !== SYNC_STATUS.SYNCED) {
      return false; // todavía pendiente
    }
  }
  return true;
}

// Versión EN LOTE de fkDepsReady para pushCreatesBatch. Con FK_DEPS
// ampliado (hasta 5 padres por movimiento) el chequeo per-record hacía
// deps×N gets SECUENCIALES a IndexedDB repitiendo los MISMOS padres
// (un responsable aparece en cientos de movimientos) — en un import
// histórico de 50k filas eso son ~250k transacciones antes del primer
// INSERT y sin feedback de progreso. Acá cada padre único se resuelve
// UNA sola vez por pase (un bulkGet por tabla padre) y el filtro corre
// en memoria. Misma semántica que fkDepsReady record-por-record.
async function filtrarFkDepsListos(tabla, records) {
  const deps = FK_DEPS[tabla];
  if (!deps || !records.length) return records;
  // tablaRef → Map(id → record padre | undefined)
  const padresPorTabla = new Map();
  for (const { campo, tabla: tablaRef } of deps) {
    let mapa = padresPorTabla.get(tablaRef);
    if (!mapa) { mapa = new Map(); padresPorTabla.set(tablaRef, mapa); }
    for (const r of records) {
      const id = r[campo];
      if (id) mapa.set(id, undefined);
    }
  }
  for (const [tablaRef, mapa] of padresPorTabla) {
    const ids = [...mapa.keys()];
    if (!ids.length) continue;
    const padres = await db[tablaRef].bulkGet(ids);
    ids.forEach((id, i) => mapa.set(id, padres[i]));
  }
  return records.filter(r => deps.every(({ campo, tabla: tablaRef }) => {
    const id = r[campo];
    if (!id) return true; // FK opcional
    const ref = padresPorTabla.get(tablaRef).get(id);
    // Ausente de Dexie (padre soft-deleteado) → dejar pasar; el server
    // conserva la fila y la FK pasa. Ver comentario en fkDepsReady.
    if (!ref) return true;
    return !(ref.sync_status && ref.sync_status !== SYNC_STATUS.SYNCED);
  }));
}

// Columna de IDENTIDAD por tabla (espejo del guard de useRealtimeNotifications):
// una fila local que NI SIQUIERA tiene la propiedad no pertenece a esa tabla —
// es un "fantasma" que el bug de bindings desalineados de realtime ruteó a la
// tabla equivocada (caso 2026-06-12: fila de personal puesta en obras/
// herramientas/incidencias). Esas filas se ven como cards vacías y, si se
// editan/borran, intentan pushear columnas ajenas → PGRST204 en loop.
const COLUMNA_IDENTIDAD = {
  obras: 'nombre_obra', personal: 'nombres', materiales: 'nombre_material',
  herramientas: 'nombre_herramienta', epps: 'nombre_epp',
  proveedores: 'razon_social', subcontratistas: 'razon_social',
  partidas: 'nombre_partida', incidencias: 'descripcion',
  movimientos_materiales: 'material_id', movimientos_herramientas: 'herramienta_id',
  movimientos_epp: 'epp_id', asistencia: 'personal_id',
  insumos_emergencia: 'nombre', activos_pesados: 'nombre',
  caja_chica_movimientos: 'monto', ubicaciones_obra: 'nombre',
  // Las 3 tablas suscritas a realtime que faltaban (el mismo bug de bindings
  // pudo rutearles filas de personal). OJO: acá NO sirve obra_id como en
  // IDENTIDAD_TABLA del hook — personal.obra_id es NOT NULL, así que un
  // fantasma de personal SÍ trae obra_id. Se usan columnas que personal no
  // tiene y que toda fila legítima trae siempre (NOT NULL en server, seteadas
  // en todos los creates locales, y UUID/TEXT corto = nunca TOASTeadas):
  avance_obra: 'partida_id', evidencias: 'nombre_archivo',
  stock_ubicaciones: 'ubicacion_id',
};
const esFantasma = (tabla, fila) => {
  const ident = COLUMNA_IDENTIDAD[tabla];
  return !!(ident && fila && !(ident in fila));
};

// Solo estas tablas reciben escrituras desde realtime (LIVE_SYNC_TABLES +
// callbacks dedicados de useRealtimeNotifications — verificado en todo el
// historial git): son las únicas que pueden contener fantasmas. Las demás
// tablas de COLUMNA_IDENTIDAD jamás fueron escritas por applyLiveSync;
// escanearlas sería riesgo puro (borrar filas legítimas) sin beneficio.
// COLUMNA_IDENTIDAD se mantiene completa porque también la usa esFantasma
// en el self-heal PGRST204 (que solo toca filas FAILED).
const TABLAS_CON_FANTASMAS_POSIBLES = new Set([
  'obras', 'materiales', 'herramientas', 'personal', 'proveedores', 'partidas',
  'movimientos_materiales', 'movimientos_herramientas', 'asistencia', 'incidencias',
  // También realtime-escritas (callback dedicado avance_obra + loop dinámico
  // evidencias/stock_ubicaciones) — pudieron recibir fantasmas del incidente:
  'avance_obra', 'evidencias', 'stock_ubicaciones',
]);

// Limpieza ONE-SHOT de fantasmas ya creados por el bug de realtime (corre una
// vez por dispositivo; las defensas nuevas evitan que se creen más). Borrar
// local es seguro: el server nunca tuvo esas filas en esa tabla (entraron
// directo a Dexie como 'synced') y la fila REAL vive sana en su tabla correcta.
// Tablas CHICAS (cientos/pocos miles de filas): barrerlas en CADA pull es
// trivial y cura olas nuevas sin esperar flags — el caso real del 2026-06-12:
// un import masivo de APU generó miles de ecos de realtime en una build vieja
// (la PWA cachea) y aparecieron 94 "obras" fantasma de golpe. Las PESADAS
// (movimientos 50k+, asistencia, stock, evidencias) solo van en la pasada
// one-shot versionada para no escanearlas en cada sync.
const TABLAS_FANTASMA_LIGERAS = new Set([
  'obras', 'personal', 'herramientas', 'materiales', 'epps', 'incidencias',
  'proveedores', 'subcontratistas', 'activos_pesados', 'insumos_emergencia',
  'caja_chica_movimientos', 'ubicaciones_obra', 'partidas',
]);

async function limpiarFantasmas() {
  // Corre en CADA pull: las tablas LIGERAS se barren siempre (cura olas
  // nuevas al siguiente sync, sin flags); las PESADAS solo en la primera
  // pasada por dispositivo (flag v3 — bump para re-barrer dispositivos que
  // corrieron v1/v2 ANTES de la ola masiva del import de APU del 2026-06-12,
  // que dejó 94 obras fantasma en el device del admin).
  const FLAG = 'jx_fantasmas_realtime_v3';
  let completa = true;
  try { if (localStorage.getItem(FLAG)) completa = false; } catch {}
  let borrados = 0;
  let huboError = false;
  for (const [tabla, ident] of Object.entries(COLUMNA_IDENTIDAD)) {
    try {
      if (!TABLAS_CON_FANTASMAS_POSIBLES.has(tabla)) continue;
      if (!completa && !TABLAS_FANTASMA_LIGERAS.has(tabla)) continue;
      if (!db[tabla]) continue;
      // PENDING_CREATE se salta: un fantasma NUNCA entra como pending_create
      // (applyLiveSync los escribe 'synced'), pero una fila legítima creada
      // por una versión vieja de la app que no seteara la columna identidad
      // sería solo-local — borrarla aquí sería pérdida irreversible. Si un
      // fantasma llegara a pending_create (reset del push), su push fallará
      // → FAILED → el self-heal PGRST204 lo borra igual.
      // demo:true también se salta: un fantasma jamás es demo (applyLiveSync
      // no setea demo) y el seeder tiene filas con schema viejo — ej.
      // evidencias demo sin nombre_archivo — que son legítimas en modo prueba.
      const malas = await db[tabla]
        .filter(r => !(ident in r) && r.sync_status !== SYNC_STATUS.PENDING_CREATE && r.demo !== true)
        .toArray();
      for (const m of malas) {
        await db[tabla].delete(m.id);
        borrados++;
        console.warn(`[SyncEngine] fantasma realtime eliminado: ${tabla}/${String(m.id).slice(0, 8)} (sin '${ident}')`);
      }
    } catch (e) {
      huboError = true;
      console.warn(`[SyncEngine] limpieza de fantasmas falló en ${tabla} (reintenta próximo sync):`, e?.message);
    }
  }
  if (borrados) {
    try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { source: 'limpieza_fantasmas' } })); } catch {}
  }
  // El flag (solo en pasada completa) se marca tras una pasada COMPLETA sin
  // errores: si una tabla falló a mitad (Dexie cerrada por upgrade en otra
  // tab, etc.), reintentamos en el próximo pull. Si lo marcáramos igual, los
  // fantasmas SYNCED de esa tabla quedarían como cards vacías para siempre
  // los que el usuario edita/borra hasta FAILED.
  if (!huboError && completa) {
    try { localStorage.setItem(FLAG, new Date().toISOString()); } catch {}
  }
}

async function pushTablePending(tabla) {
  // Skip silencioso si el rol del user no tiene write permission a esta
  // tabla. Antes el SyncEngine intentaba pushear y gastaba 5 retries por
  // record antes de marcarlo FAILED, y por cada uno mandaba un warning
  // RLS a Sentry. Con un almacenero teniendo en Dexie 79 insumos del
  // admin, eso eran 79*5 = 395 intentos y 79 warnings. Spam puro.
  if (!canPushTabla(tabla)) {
    return;
  }

  // Self-heal #1: records FAILED por PGRST204 "Could not find the 'X'
  // column of 'tabla'" quedan bloqueados aunque la causa se haya resuelto
  // (ej: el admin corrió la migration que agrega la columna). Cubre dos
  // escenarios reales:
  //   a) Bug de columnas locales `_*` (Sentry JARVEX-APP-4): stripLocalFields
  //      ya las filtra, retry queda limpio.
  //   b) Schema desfasado entre cliente y server (Sentry JARVEX-APP-8):
  //      cliente manda columna nueva, server todavía no la tiene. Después
  //      de aplicar la migration, retry funciona.
  // En ambos: PGRST204 + mensaje "column of" → reset a PENDING_UPDATE.
  const stuckByPGRST204 = await db[tabla]
    .where('sync_status').equals(SYNC_STATUS.FAILED)
    .filter(r => (
      // a) PGRST204 + "column of" → schema cache desfasado
      (r._last_error_code === 'PGRST204' && /column of/i.test(r._last_error || ''))
      // b) Postgres 428C9 → "cannot insert a non-DEFAULT value into column X"
      //    (generated column). Después de agregar el campo a TRIGGER_MANAGED_FIELDS,
      //    el retry queda limpio. Sentry JARVEX-APP-8.
      || (r._last_error_code === '428C9')
    ))
    .toArray();
  for (const r of stuckByPGRST204) {
    // Fila FANTASMA (ruteada por realtime a la tabla equivocada): no tiene ni
    // la columna de identidad de su tabla. Reintentarla es un loop infinito
    // (PGRST204 por columnas ajenas y, si se pelaran, 23502 por NOT NULL).
    // Borrarla local es seguro: el server nunca la tuvo en esta tabla.
    if (esFantasma(tabla, r)) {
      try {
        await db[tabla].delete(r.id);
        console.warn(`[SyncEngine] self-heal PGRST204: fantasma ${tabla}/${String(r.id).slice(0, 8)} eliminado (fila de otra tabla)`);
      } catch {}
      continue;
    }
    // Si la columna que el server no reconoce VIVE en el record local
    // (columna LEGACY de un schema viejo — ej. obras.company_id de antes de
    // multi-empresa), re-encolar a ciegas es un loop infinito: el retry
    // manda la misma columna y vuelve a fallar. La quitamos del record
    // (preservando el valor en _legacy_<campo>, que el push siempre stripea)
    // — es la única forma de que la fila pueda sincronizar.
    const m = /could not find the '([A-Za-z0-9_]+)' column/i.exec(r._last_error || '');
    const campoLegacy = m && m[1];
    if (campoLegacy && campoLegacy !== 'id' && !campoLegacy.startsWith('_') &&
        Object.prototype.hasOwnProperty.call(r, campoLegacy)) {
      try {
        const fila = await db[tabla].get(r.id);
        if (fila && Object.prototype.hasOwnProperty.call(fila, campoLegacy)) {
          fila[`_legacy_${campoLegacy}`] = fila[campoLegacy];
          delete fila[campoLegacy];
          await db[tabla].put(fila);
          console.warn(`[SyncEngine] self-heal PGRST204: ${tabla}/${r.id} — columna legacy '${campoLegacy}' removida (el server no la tiene)`);
        }
      } catch (e) { console.warn('[SyncEngine] self-heal PGRST204 legacy:', e?.message); }
    }
    // Si nunca alcanzó server (version=1 ⇒ creación pendiente) volvemos a
    // PENDING_CREATE; si fue update fallido (version>1) volvemos a UPDATE.
    // Antes siempre se reseteaba a UPDATE — eso rompía creates porque el
    // pushUpdate no encontraba el record en server.
    const restoreStatus = (Number(r.version) || 1) <= 1
      ? SYNC_STATUS.PENDING_CREATE
      : SYNC_STATUS.PENDING_UPDATE;
    await db[tabla].update(r.id, {
      sync_status: restoreStatus,
      _sync_retries: 0,
    });
    console.info(`[SyncEngine] self-heal PGRST204: ${tabla}/${r.id} reset a ${restoreStatus}`);
  }

  // Self-heal #3: FAILED por FK (23503) — "falta el registro relacionado".
  // El re-encolado ciego del self-heal #2 nunca cura la CAUSA: el PADRE que
  // no está en el server. Acá se repara de verdad: por cada FAILED 23503 se
  // verifica cada padre (FK_DEPS) contra el SERVER; si el padre no existe
  // allá pero localmente dice synced (padre fantasma, ej. dedup 23505 por
  // DNI con otro id), se re-encola el PADRE; si todos los padres ya están
  // en el server, se re-encola el hijo (entra limpio al próximo pase).
  //
  // ORDEN CRÍTICO: este bloque DEBE correr ANTES del self-heal #2. #2
  // re-encola a ciegas cualquier FAILED no-RLS con updated_at >10min
  // (incluye 23503), y handleSyncError NO bumpea updated_at (queda el del
  // último edit de dominio). Si #2 corriera primero, todo 23503 viejo —
  // exactamente el backlog de imports que motiva este fix — se flipearía
  // a PENDING antes de que el query de acá lo vea, y la cura del padre
  // fantasma jamás ejecutaría (loop eterno reset→23503→5 retries→FAILED).
  const deps23503 = FK_DEPS[tabla];
  if (deps23503) {
    const failedFk = await db[tabla]
      .where('sync_status').equals(SYNC_STATUS.FAILED)
      .filter(r => String(r._last_error_code || '') === '23503')
      .limit(50)
      .toArray();
    for (const r of failedFk) {
      try {
        // ¿QUÉ FK falló? Postgres lo dice en el mensaje del 23503:
        // '... violates foreign key constraint "movimientos_materiales_obra_id_fkey"'.
        // Si la FK que falló NO está mapeada en FK_DEPS (obra_id, created_by,
        // updated_by — FKs reales del server que acá no gateamos), re-encolar
        // es inútil: el insert vuelve a fallar con el mismo 23503 → loop
        // caliente sin backoff (este self-heal corre cada pase, sin gate
        // temporal) + probes de padres que nunca son la causa. En ese caso
        // NO tocamos el record: queda FAILED y el self-heal #2 lo reintenta
        // con su gate de 10 min. Todas las FKs del schema son inline
        // REFERENCES → nombre default `<tabla>_<campo>_fkey`; si el mensaje
        // no trae constraint (record viejo sin _last_error), caemos al
        // chequeo completo de siempre.
        const mFk = /violates foreign key constraint "([^"]+)"/i.exec(r._last_error || '');
        if (mFk && !deps23503.some(d => mFk[1] === `${tabla}_${d.campo}_fkey`)) {
          continue; // FK no mapeada (obra_id, created_by, ...) — no re-encolar
        }
        // Si conocemos la FK culpable, probar SOLO esa — no las deps
        // inocentes. Probar deps inocentes puede flipear padres SANOS:
        // una policy de LECTURA que oculta la fila hace que el select
        // devuelva null SIN error (RLS filtra, no tira excepción) y acá
        // eso se lee como "no existe en server". Caso real del repo:
        // frentes_obra (mig 065) tiene SELECT USING (deleted_at IS NULL)
        // — un frente soft-deleted es invisible hasta para admin; el flip
        // lo re-INSERTa, choca 23505 (PK) y la verificación de duplicado
        // (ciega por la misma policy) lo deja FAILED con mensaje engañoso
        // en loop eterno con el self-heal #2. La FK culpable en cambio es
        // probe-confiable: si causó el 23503 es porque el server NO la
        // encontró al insertar (los checks de FK SÍ ven filas soft-deleted,
        // así que un padre soft-deleted nunca es la causa). Si hay OTRO
        // padre fantasma además, el re-push del hijo vuelve a fallar 23503
        // nombrando esa FK y se cura al pase siguiente (converge).
        const depsProbar = mFk
          ? deps23503.filter(d => mFk[1] === `${tabla}_${d.campo}_fkey`)
          : deps23503; // record viejo sin constraint en el mensaje → chequeo completo
        let padresOk = true;
        for (const { campo, tabla: tablaRef } of depsProbar) {
          const fkId = r[campo];
          if (!fkId) continue;
          const { data: padreServer, error: selErr } = await supabase
            .from(tablaRef).select('id').eq('id', fkId).maybeSingle();
          if (selErr) { padresOk = false; break; } // sin red/permiso — no tocar
          if (!padreServer) {
            padresOk = false;
            const padreLocal = await db[tablaRef].get(fkId);
            // Solo flipear el padre si este device PUEDE pushear esa tabla:
            // pushTablePending gatea por canPushTabla, así que en un rol sin
            // write-perm el flip nunca se sube — deja un PENDING_CREATE
            // imposible que encima bloquea hijos nuevos vía fkDepsReady.
            if (padreLocal && padreLocal.sync_status === SYNC_STATUS.SYNCED && !padreLocal.demo && canPushTabla(tablaRef)) {
              await db[tablaRef].update(fkId, { sync_status: SYNC_STATUS.PENDING_CREATE, _sync_retries: 0 });
              console.warn(`[SyncEngine] self-heal 23503: padre fantasma ${tablaRef}/${String(fkId).slice(0, 8)} re-encolado (decía synced pero no está en server)`);
            }
          }
        }
        if (padresOk) {
          await db[tabla].update(r.id, {
            sync_status: (Number(r.version) || 1) <= 1 ? SYNC_STATUS.PENDING_CREATE : SYNC_STATUS.PENDING_UPDATE,
            _sync_retries: 0,
          });
          console.info(`[SyncEngine] self-heal 23503: ${tabla}/${r.id.slice(0, 8)} re-encolado (padres ya en server)`);
        }
      } catch {}
    }
  }

  // Self-heal #2: records FAILED por causas NO permanentes (no RLS, no
  // schema cache) que llevan más de 10 min en FAILED. Probablemente fue
  // un error transitorio de red/server y vale la pena reintentar. Sin
  // este reset, un blip de Supabase deja records en FAILED para siempre.
  // (Corre DESPUÉS del self-heal #3 a propósito — ver comentario arriba.)
  const TEN_MIN = 10 * 60 * 1000;
  const ahora = Date.now();
  const stuckTransients = await db[tabla]
    .where('sync_status').equals(SYNC_STATUS.FAILED)
    .filter(r => {
      // No tocar si fue RLS — eso requiere intervención humana.
      if (r._last_error_is_rls) return false;
      // No tocar si lleva poco tiempo en FAILED (puede estar en proceso).
      const updatedAt = r.updated_at ? new Date(r.updated_at).getTime() : 0;
      return ahora - updatedAt > TEN_MIN;
    })
    .toArray();
  for (const r of stuckTransients) {
    // Mismo razonamiento: si nunca llegó al server, debe seguir como
    // pending_create. Sin esto, los retry transient hacían UPDATE sobre
    // un record inexistente y volvían a fallar.
    const restoreStatus = (Number(r.version) || 1) <= 1
      ? SYNC_STATUS.PENDING_CREATE
      : SYNC_STATUS.PENDING_UPDATE;
    await db[tabla].update(r.id, {
      sync_status: restoreStatus,
      _sync_retries: 0,
    });
    console.info(`[SyncEngine] self-heal transient: ${tabla}/${r.id} reset a ${restoreStatus} (FAILED >10min)`);
  }

  // Mantener el orden create → update → delete dentro de la misma tabla
  // para respetar dependencias (e.g. crear antes de actualizar).
  // FILTRO IMPORTANTE: records con `demo: true` (modo prueba) NO se pushean
  // — viven solo localmente. Sin este filtro, se intentaría updatear en el
  // server registros que nunca se insertaron, causando 0 rows affected
  // silencioso y pérdida de cambios.
  const noEsDemo = (r) => r && r.demo !== true;

  const pendingCreates = (await db[tabla]
    .where('sync_status').equals(SYNC_STATUS.PENDING_CREATE)
    .toArray()).filter(noEsDemo);

  // Movimientos: pushear en orden CRONOLÓGICO (fecha; mismo día entradas
  // antes que salidas). Dexie devuelve por índice (orden de UUID): si una
  // SALIDA llega al server antes que sus entradas, el trigger de stock deja
  // stock_actual < 0 y el CHECK del server (mig 044) la rechaza con 23514 —
  // el "error de stock negativo" tras importar una migración válida.
  if (pendingCreates.length > 1 && pendingCreates[0] && ('fecha' in pendingCreates[0]) && ('tipo_movimiento' in pendingCreates[0])) {
    // 'ingreso' = la entrada de herramientas (los 3 botones del flujo manual y
    // la migración la escriben así); sin él caía al ?? 5, DESPUÉS de las
    // salidas del mismo día.
    const rank = { entrada: 0, ingreso: 0, devolucion: 1, ajuste: 2, salida: 3, merma: 4 };
    pendingCreates.sort((a, b) => {
      const fa = a.fecha || '', fb = b.fecha || '';
      if (fa !== fb) return fa < fb ? -1 : 1;
      const ra = rank[a.tipo_movimiento] ?? 5, rb = rank[b.tipo_movimiento] ?? 5;
      if (ra !== rb) return ra - rb;
      return String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });
  }

  await pushCreatesBatch(tabla, pendingCreates);

  const pendingUpdates = (await db[tabla]
    .where('sync_status').equals(SYNC_STATUS.PENDING_UPDATE)
    .toArray()).filter(noEsDemo);

  for (const record of pendingUpdates) {
    await pushUpdate(tabla, record);
  }

  const pendingDeletes = (await db[tabla]
    .where('sync_status').equals(SYNC_STATUS.PENDING_DELETE)
    .toArray()).filter(noEsDemo);

  await pushDeletesBatch(tabla, pendingDeletes);
}

// Cuántos records por request al pushear en lote. Antes el push era
// record-por-record (1 request HTTP cada uno) — importar 50k insumos
// tomaba una eternidad. Con INSERT en lote, 50k insumos = ~250 requests.
const PUSH_BATCH_SIZE = 200;

// Push de PENDING_CREATE en lote: agrupa en chunks y hace un solo INSERT
// por chunk. Si el chunk falla (ej. un idempotency_key duplicado tumba
// todo el INSERT), cae a per-record para aislar el/los malo(s) sin perder
// los buenos.
async function pushCreatesBatch(tabla, records) {
  if (!records.length) return;
  // Filtrar los que tienen una FK todavía pendiente en local — esos
  // esperan al próximo ciclo (anti-fantasma). Para las tablas sin FK_DEPS
  // (partidas, materiales, etc.) devuelve el array tal cual. OJO:
  // insumos_partida SÍ tiene FK_DEPS (gate partida_id→partidas). Cada
  // padre único se lee UNA vez (bulkGet), no deps×N gets per-record.
  const listos = await filtrarFkDepsListos(tabla, records);
  if (!listos.length) return;

  for (let i = 0; i < listos.length; i += PUSH_BATCH_SIZE) {
    const chunk = listos.slice(i, i + PUSH_BATCH_SIZE);
    const serverRows = chunk.map(r => stripLocalFields(r, tabla));
    const { error } = await supabase.from(tabla).insert(serverRows);
    if (!error) {
      const now = new Date().toISOString();
      // bulkPut de los mismos records con sync_status actualizado — una
      // sola operación Dexie en vez de N updates.
      await db[tabla].bulkPut(chunk.map(r => ({
        ...r, sync_status: SYNC_STATUS.SYNCED, last_synced_at: now,
      })));
      trackEvent('record_pushed', { tabla, operacion: 'create_batch', count: chunk.length });
    } else {
      // El INSERT en lote falló entero — reintentar uno por uno para que
      // un solo record problemático no bloquee a los demás del chunk.
      console.warn(`[SyncEngine] batch create ${tabla} falló (${error.code || ''}) — fallback per-record`);
      for (const r of chunk) {
        await pushCreate(tabla, r);
      }
    }
    emit({ syncing: true, phase: `Subiendo ${tabla}`, current: Math.min(i + PUSH_BATCH_SIZE, listos.length), total: listos.length });
  }
}

// Push de PENDING_DELETE en lote: un solo UPDATE deleted_at por chunk de ids.
async function pushDeletesBatch(tabla, records) {
  if (!records.length) return;
  for (let i = 0; i < records.length; i += PUSH_BATCH_SIZE) {
    const chunk = records.slice(i, i + PUSH_BATCH_SIZE);
    const ids = chunk.map(r => r.id);
    const { error } = await supabase
      .from(tabla)
      .update({ deleted_at: new Date().toISOString() })
      .in('id', ids);
    if (!error) {
      await db[tabla].bulkDelete(ids);
      trackEvent('record_pushed', { tabla, operacion: 'delete_batch', count: chunk.length });
    } else {
      console.warn(`[SyncEngine] batch delete ${tabla} falló (${error.code || ''}) — fallback per-record`);
      for (const r of chunk) {
        await pushDelete(tabla, r);
      }
    }
    emit({ syncing: true, phase: `Borrando ${tabla}`, current: Math.min(i + PUSH_BATCH_SIZE, records.length), total: records.length });
  }
}

async function pushPendingOperations() {
  // Procesamos las tablas en lotes de PUSH_PARALLELISM en paralelo.
  // Usamos allSettled: si una tabla falla, las demás deben continuar.
  for (let i = 0; i < TRANSACTIONAL_TABLES.length; i += PUSH_PARALLELISM) {
    const batch = TRANSACTIONAL_TABLES.slice(i, i + PUSH_PARALLELISM);
    const results = await Promise.allSettled(batch.map(t => pushTablePending(t)));
    results.forEach((r, idx) => {
      if (r.status === 'rejected') {
        console.warn(`[SyncEngine] push ${batch[idx]} falló:`, r.reason?.message || r.reason);
      }
    });
  }
}

// Campos que ciertos triggers del server calculan automáticamente. El
// cliente NO debe pushearlos: si los manda, pisa el cálculo del trigger
// y crea inconsistencias (típicamente stock duplicado al ×2 cuando el
// cliente suma local + el trigger suma server).
//
// Caso real: handleSubmitMovLote actualizaba stock_actual local. El
// SyncEngine pushea materiales ANTES que movimientos_materiales, así
// que server recibía stock=30 (del cliente), después llegaba el mov,
// y el trigger hacía 30+30=60. Bug visible: ingresar 30, ver stock 60.
// Exportado: la bandeja de conflictos (jx-conflicts) lo usa para NO mostrar
// estos campos como "diferencias" — el server los recalcula por trigger, así
// que difieren casi siempre y la elección del usuario no los afecta
// (stripLocalFields los quita del push de "Forzar mis cambios").
export const TRIGGER_MANAGED_FIELDS = {
  materiales: new Set([
    'stock_actual', 'total_entradas', 'total_salidas',
    'precio_unitario_real_prom', 'alerta',
  ]),
  herramientas: new Set([
    'disponible', 'ubicacion_actual',
    'estado_actual',
    // OJO: 'ultimo_responsable_id' NO se striplea. El trigger del server lo
    // setea en cada INSERT de movimiento (misma fuente que el cliente), así
    // que pushearlo es inofensivo — y la FUSIÓN de personas necesita que el
    // re-apuntado llegue al server (si se stripleara, el server quedaría
    // apuntando al nombre eliminado).
  ]),
  epps: new Set([
    'stock_actual', 'total_entradas', 'total_salidas', 'alerta',
  ]),
  // Sentry JARVEX-APP-8: `costo_presupuestado` es una GENERATED COLUMN
  // en Postgres (cantidad_presupuestada * precio_presupuestado).
  // Mandarla en el INSERT tira código 428C9 ("cannot insert a non-DEFAULT
  // value into column 'costo_presupuestado'") y el record queda
  // permanentemente en FAILED tras 5 retries.
  insumos_partida: new Set([
    'costo_presupuestado', 'diferencia_cantidad',
  ]),
  insumos_partida_versionadas: new Set([
    'costo_presupuestado',
  ]),
  // `diferencia` es GENERATED (costo_real_acumulado - costo_total_presupuestado,
  // mig 001 línea 250). Mismo caso que insumos_partida.diferencia_cantidad: el
  // pull (select '*') la mete en Dexie y partida-allocation marca la partida
  // PENDING_UPDATE al imputar consumo → el push la mandaría → 428C9 ("column
  // can only be updated to DEFAULT"). Sin esta entrada, el self-heal #1 de
  // 428C9 resetearía esos FAILED en loop infinito (la columna nunca se
  // stripea y el regex de legacy no matchea ese mensaje). Nadie la lee
  // local: la UI recalcula desde las dos columnas base.
  partidas: new Set([
    'diferencia',
    // porcentaje_avance y metrado_ejecutado los calcula el trigger del server
    // (actualizar_avance_partida) sumando avance_obra no borrado. Si el cliente los
    // pushea (import del Gantt / reporte diario), choca con el valor del trigger ->
    // "Conflicto de sincronizacion - partidas". El trigger es la fuente de verdad.
    'porcentaje_avance', 'metrado_ejecutado',
  ]),
};

// Quita campos que solo viven en Dexie y nunca deben mandarse al server.
// Convención: cualquier prop con prefijo `_` (ej: _last_error, _sync_retries)
// es metadato local. Sin este filtro, PostgREST devuelve PGRST204
// "Could not find the '_last_error' column" y el record se queda
// permanentemente en pending — lo vimos en producción (Sentry JARVEX-APP-4).
export function stripLocalFields(record, tabla) {
  const triggerManaged = tabla ? TRIGGER_MANAGED_FIELDS[tabla] : null;
  const out = {};
  for (const k of Object.keys(record)) {
    if (k.startsWith('_')) continue;
    if (k === 'sync_status' || k === 'last_synced_at') continue;
    if (triggerManaged && triggerManaged.has(k)) continue;
    out[k] = record[k];
  }
  return out;
}

// Tablas locales que apuntan a un proveedor (para re-apuntar en una fusión).
const PROVEEDOR_REF_TABLAS = [
  'accounting_movements', 'cotizaciones', 'ordenes_compra',
  'movimientos_materiales', 'movimientos_herramientas', 'movimientos_epp',
  'movimientos_insumos_emergencia', 'movimientos_maquinaria',
  'guias_remision',
];

// El caso clásico: captura mágica crea un proveedor LOCAL por RUC que ya existe
// en el server (creado en otra sesión/dispositivo y aún no pulleado acá). El push
// del proveedor choca 23505 (UNIQUE ruc) y queda FAILED; peor: la factura que lo
// referencia (proveedor_id local) revienta 23503 porque ese id nunca entró al
// server. Acá ADOPTAMOS el id del proveedor que sí está en el server: re-apuntamos
// todas las referencias locales del id duplicado al id real, traemos el real a
// Dexie y borramos el duplicado local. Devuelve true si reconcilió.
async function reconciliarProveedorDuplicado(record) {
  const ruc = String(record?.ruc || '').trim();
  if (!ruc) return false;
  let serverProv = null;
  try {
    const { data, error } = await supabase.from('proveedores').select('*').eq('ruc', ruc).is('deleted_at', null).limit(1).maybeSingle();
    if (error || !data) return false;
    serverProv = data;
  } catch { return false; }
  if (!serverProv?.id || serverProv.id === record.id) return false;

  const now = new Date().toISOString();
  // Re-apuntar todas las referencias locales del id duplicado → id real. El dup
  // siempre es local-nuevo, así que sus referencias están PENDING: acotamos el
  // scan por sync_status (índice) en vez de barrer tablas de 50k+ filas enteras.
  for (const t of PROVEEDOR_REF_TABLAS) {
    if (!db[t]) continue;
    let rows = [];
    try {
      rows = await db[t].where('sync_status').anyOf([SYNC_STATUS.PENDING_CREATE, SYNC_STATUS.PENDING_UPDATE, SYNC_STATUS.FAILED])
        .filter(x => x.proveedor_id === record.id).toArray();
    } catch {
      // Sin índice sync_status en esa tabla → fallback al scan completo.
      try { rows = await db[t].filter(x => x.proveedor_id === record.id).toArray(); } catch { continue; }
    }
    for (const row of rows) {
      try {
        await db[t].update(row.id, {
          proveedor_id: serverProv.id, updated_at: now,
          version: (row.version || 0) + 1,
          sync_status: row.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
      } catch {}
    }
  }
  // Traer el proveedor real a Dexie (synced) y borrar el duplicado local.
  try { await db.proveedores.put({ ...serverProv, sync_status: SYNC_STATUS.SYNCED, last_synced_at: now }); } catch {}
  try { await db.proveedores.delete(record.id); } catch {}
  try {
    window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'proveedores' } }));
    window.dispatchEvent(new CustomEvent('jarvex_master_updated', { detail: { tabla: 'proveedores' } }));
  } catch {}
  console.info(`[SyncEngine] proveedor dup ${record.id.slice(0, 8)} reconciliado → ${serverProv.id.slice(0, 8)} (RUC ${ruc})`);
  return true;
}

// Tablas/columnas locales que apuntan a una empresa (companies) — para re-apuntar
// en una fusión de duplicado. A diferencia de proveedores, varias tablas tienen
// MÁS de una FK a companies (ej. accounting_movements: company_id + related_company_id).
const COMPANY_REF_TABLAS = [
  { tabla: 'accounting_movements', campos: ['company_id', 'related_company_id'] },
  { tabla: 'intercompany_transactions', campos: ['seller_company_id', 'buyer_company_id'] },
  { tabla: 'obras', campos: ['ejecutora_company_id'] },
  { tabla: 'guias_remision', campos: ['company_id'] },
];

// Análogo a reconciliarProveedorDuplicado pero para companies. Captura Mágica crea
// una empresa LOCAL por RUC que ya existe en el server (otra sesión/dispositivo, aún
// no pulleada): el push choca 23505 y la empresa queda con un id que el server nunca
// tuvo → sus movimientos revientan 23503 para siempre. companies NO tiene UNIQUE(ruc),
// solo idempotency_key global unique (mig 021), así que deduplicamos por ese key
// ('company_ruc_<ruc>', el mismo que arma jx-captura-magica). Adoptamos el id real,
// re-apuntamos las referencias locales pending y borramos el duplicado.
async function reconciliarCompanyDuplicado(record) {
  const key = String(record?.idempotency_key || '').trim();
  if (!key.startsWith('company_ruc_')) return false; // sin RUC el key es por-instancia → no dedup determinístico
  let serverCompany = null;
  try {
    const { data, error } = await supabase.from('companies').select('*').eq('idempotency_key', key).limit(1).maybeSingle();
    if (error || !data) return false;
    serverCompany = data;
  } catch { return false; }
  if (!serverCompany?.id || serverCompany.id === record.id) return false;

  const now = new Date().toISOString();
  for (const { tabla: t, campos } of COMPANY_REF_TABLAS) {
    if (!db[t]) continue;
    for (const campo of campos) {
      let rows = [];
      try {
        rows = await db[t].where('sync_status').anyOf([SYNC_STATUS.PENDING_CREATE, SYNC_STATUS.PENDING_UPDATE, SYNC_STATUS.FAILED])
          .filter(x => x[campo] === record.id).toArray();
      } catch {
        try { rows = await db[t].filter(x => x[campo] === record.id).toArray(); } catch { continue; }
      }
      for (const row of rows) {
        try {
          await db[t].update(row.id, {
            [campo]: serverCompany.id, updated_at: now,
            version: (row.version || 0) + 1,
            sync_status: row.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
          });
        } catch {}
      }
    }
  }
  try { await db.companies.put({ ...serverCompany, sync_status: SYNC_STATUS.SYNCED, last_synced_at: now }); } catch {}
  try { await db.companies.delete(record.id); } catch {}
  try {
    window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'companies' } }));
    window.dispatchEvent(new CustomEvent('jarvex_master_updated', { detail: { tabla: 'companies' } }));
  } catch {}
  console.info(`[SyncEngine] company dup ${record.id.slice(0, 8)} reconciliado → ${serverCompany.id.slice(0, 8)} (key ${key})`);
  return true;
}

async function pushCreate(tabla, record) {
  // Anti-fantasma: no pushear si una FK referenciada todavía está
  // pendiente en local. Si pusheamos el mov antes que el material,
  // el server queda con un mov huérfano y otros devices ven
  // "(material no disponible)". Esperamos al próximo ciclo —
  // cuando el material ya esté SYNCED, este record también se va.
  if (!(await fkDepsReady(tabla, record))) {
    console.info(`[SyncEngine] ${tabla}/${record.id.slice(0,8)} esperando FK ` +
                 `pendiente; skip por ahora`);
    return;
  }

  const serverRecord = stripLocalFields(record, tabla);

  const { error } = await supabase.from(tabla).insert(serverRecord);

  if (!error) {
    await db[tabla].update(record.id, {
      sync_status: SYNC_STATUS.SYNCED,
      last_synced_at: new Date().toISOString(),
    });
    trackEvent('record_pushed', { tabla, operacion: 'create' });
  } else if (error.code === '23505') {
    // Unique constraint. Caso normal: idempotency_key duplicado → la MISMA
    // fila ya está en el server → synced. PERO el 23505 también puede venir
    // de OTRA unique (ej. personal UNIQUE(dni, obra_id)): el server tiene
    // una fila equivalente con OTRO id. Marcar synced a ciegas crea un
    // "padre fantasma" — fkDepsReady lo ve synced, los hijos lo referencian
    // y revientan 23503 PARA SIEMPRE. Verificamos que el id real exista.
    const { data: enServer, error: selErr } = await supabase.from(tabla).select('id').eq('id', record.id).maybeSingle();
    if (enServer) {
      await db[tabla].update(record.id, { sync_status: SYNC_STATUS.SYNCED });
      trackEvent('record_pushed', { tabla, operacion: 'create_dedup' });
    } else if (selErr) {
      // El select de verificación FALLÓ (red caída a mitad de batch, timeout,
      // 5xx, RLS de lectura). enServer=null NO significa "no está" — no
      // sabemos. Diagnosticar "fila con OTRO id" acá sería un falso fantasma
      // con mensaje engañoso. Reintentamos con el 23505 original: el próximo
      // ciclo re-inserta → 23505 → select de nuevo, y con red sana cae en
      // el dedup de arriba.
      await handleSyncError(tabla, record, 'create', {
        ...error,
        message: `${error.message || '23505'} — verificación de duplicado no concluyente (select falló: ${selErr.message || selErr.code || 'error'})`,
      });
    } else if (tabla === 'proveedores' && await reconciliarProveedorDuplicado(record)) {
      // Proveedor duplicado por RUC: adoptamos el id del server, re-apuntamos las
      // referencias y borramos el duplicado local. Las facturas que lo apuntaban
      // quedan pending_update con el id real y suben solas en el próximo ciclo.
      trackEvent('record_pushed', { tabla, operacion: 'create_dedup_ruc' });
    } else if (tabla === 'companies' && await reconciliarCompanyDuplicado(record)) {
      // Empresa duplicada por RUC (idempotency_key): adoptamos el id del server,
      // re-apuntamos movimientos/intercompany/obras pending y borramos el dup local.
      trackEvent('record_pushed', { tabla, operacion: 'create_dedup_company' });
    } else {
      await handleSyncError(tabla, record, 'create', {
        ...error,
        message: `${error.message || '23505'} — el server tiene una fila equivalente con OTRO id (duplicado por DNI/nombre, no por idempotency_key). Resolvé el duplicado o fusioná.`,
      });
    }
  } else {
    await handleSyncError(tabla, record, 'create', error);
  }
}

async function pushUpdate(tabla, record) {
  // Anti-fantasma (igual que en pushCreate): si una FK referenciada
  // está pendiente en local, esperamos al próximo ciclo.
  if (!(await fkDepsReady(tabla, record))) {
    console.info(`[SyncEngine] ${tabla}/${record.id.slice(0,8)} update esperando FK; skip`);
    return;
  }

  const serverRecord = stripLocalFields(record, tabla);

  // 1. Chequear si el record existe en server. Si NO existe (PGRST116 = no
  //    rows o error similar), el record solo vive localmente — el cliente
  //    cree que está sincronizado pero el server nunca lo recibió. En ese
  //    caso, en lugar de intentar UPDATE (que daría 0 rows affected y
  //    perdería el cambio), reseteamos sync_status a PENDING_CREATE para
  //    que el próximo ciclo lo INSERTE. Resuelve casos donde almacenero
  //    creó offline y nunca completó push.
  // Se trae la fila COMPLETA (no solo version): si esto termina en conflicto,
  // la bandeja necesita el snapshot real del server para que "Mantener
  // servidor" funcione (antes guardaba {version: N} y quedaba inusable).
  const { error: selectErr, data: existing } = await supabase
    .from(tabla)
    .select('*')
    .eq('id', record.id)
    .maybeSingle();

  if (!existing && (!selectErr || selectErr.code === 'PGRST116')) {
    // Record no existe en server → reset a PENDING_CREATE.
    // Próximo ciclo hará INSERT con el id local (no duplica porque mantiene
    // el mismo id). Si el server no acepta el INSERT por unique constraint
    // (idempotency_key) marcará synced igual.
    console.warn(`[SyncEngine] ${tabla}/${record.id} no existe en server, reseteando a PENDING_CREATE`);
    await db[tabla].update(record.id, {
      sync_status: SYNC_STATUS.PENDING_CREATE,
    });
    return;
  }

  if (!selectErr && existing && existing.version > record.version) {
    // Conflicto: el servidor tiene una versión más nueva → resolver manual
    await markConflict(tabla, record, existing);
    return;
  }

  // 2. Hacer el UPDATE con .select() para saber cuántas filas se afectaron.
  //    Si 0 filas (porque la version local no matchea con server), no
  //    podemos asumir success — el record no se actualizó.
  const { data: actualizadas, error: updateError } = await supabase
    .from(tabla)
    .update(serverRecord)
    .eq('id', record.id)
    .eq('version', record.version - 1) // optimistic concurrency
    .select('id, version');

  if (updateError) {
    await handleSyncError(tabla, record, 'update', updateError);
    return;
  }

  if (!actualizadas || actualizadas.length === 0) {
    // 0 rows: la version local no es exactamente server+1. Dos casos:
    //  a) LOCAL NO VA DETRÁS (existing.version <= record.version): o el
    //     cliente hizo varias ediciones entre syncs (migración: create→
    //     recalc→ajuste bumpean >1), o hay EMPATE de versiones — el trigger
    //     del server (update_updated_at) bumpea version en CADA update, así
    //     que el server suele ir adelantado en exactamente los bumps que el
    //     local acaba de hacer (caso fusión de nombres: 159 falsos
    //     conflictos). En ambos casos la edición local es la intencional →
    //     forzamos por id y espejamos la version del server.
    //  b) SERVER VA ADELANTE (otro device editó más veces): conflicto manual.
    if (existing && Number(existing.version || 0) <= Number(record.version || 0)) {
      const tie = Number(existing.version || 0) === Number(record.version || 0);
      // Empate con último escritor DISTINTO = edición concurrente canónica
      // (dos usuarios partieron de la misma base) → conflicto manual. El
      // empate PROPIO (fusión, doble push, drift del trigger con el mismo
      // usuario) sí se fuerza — es el que generaba tormentas de falsos.
      if (tie && existing.updated_by && record.updated_by && existing.updated_by !== record.updated_by) {
        await markConflict(tabla, record, existing);
        return;
      }
      // CAS contra la version que acabamos de leer: si el server cambió entre
      // el select y este update (otro device empujó), 0 filas → reintentar.
      const { data: forzadas, error: forceErr } = await supabase
        .from(tabla).update(serverRecord).eq('id', record.id)
        .eq('version', Number(existing.version || 0))
        .select('version');
      if (forceErr) { await handleSyncError(tabla, record, 'update', forceErr); return; }
      if (!forzadas || forzadas.length === 0) {
        await db[tabla].update(record.id, { sync_status: SYNC_STATUS.PENDING_UPDATE });
        return;
      }
      await db[tabla].update(record.id, {
        sync_status: SYNC_STATUS.SYNCED,
        last_synced_at: new Date().toISOString(),
        // El trigger del server pisa version con OLD+1 — espejarla en local
        // para que el próximo edit no vuelva a desfasarse.
        ...(forzadas[0] && forzadas[0].version != null ? { version: forzadas[0].version } : {}),
      });
      trackEvent('record_pushed', { tabla, operacion: tie ? 'update_forced_version_tie' : 'update_forced_local_ahead' });
      return;
    }
    console.warn(`[SyncEngine] ${tabla}/${record.id} update afectó 0 filas (version desync) → marcando conflicto`);
    if (existing) {
      await markConflict(tabla, record, existing);
    } else {
      // Edge case: existing era null pero no tiramos PENDING_CREATE arriba
      // (raro). Resetear a PENDING_UPDATE para reintentar.
      await db[tabla].update(record.id, {
        sync_status: SYNC_STATUS.PENDING_UPDATE,
      });
    }
    return;
  }

  // Update exitoso — marcar como synced y espejar la version post-trigger
  // del server (el trigger update_updated_at la pisa con OLD+1; sin el
  // espejo, la version local queda crónicamente detrás y cualquier edición
  // futura cae en falso conflicto).
  await db[tabla].update(record.id, {
    sync_status: SYNC_STATUS.SYNCED,
    last_synced_at: new Date().toISOString(),
    ...(actualizadas[0] && actualizadas[0].version != null ? { version: actualizadas[0].version } : {}),
  });
  trackEvent('record_pushed', { tabla, operacion: 'update' });
}

async function pushDelete(tabla, record) {
  const { error } = await supabase
    .from(tabla)
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', record.id);

  if (!error) {
    await db[tabla].delete(record.id);
    trackEvent('record_pushed', { tabla, operacion: 'delete' });
  } else {
    await handleSyncError(tabla, record, 'delete', error);
  }
}

// ── PULL: Supabase → local ────────────────────────────────────────────

// Tablas que sabemos que NO existen en Supabase server (todavía). Se omiten
// del pull para evitar 404s en cada sync. El user debe correr la migración
// SQL de docs/migrations.sql para crearlas → luego sacarlas de esta lista.
const TABLAS_NO_EN_SERVER = new Set([
  // Si alguna tabla local todavía no fue creada en Supabase, agregala acá.
]);

// Cache de tablas que dieron 404 en este runtime → no las volvemos a pegar
// hasta que se recargue la página (evita spam de errores en consola).
const _tablasCon404 = new Set();

// Supabase/PostgREST corta cada respuesta a 1000 filas por defecto. Sin
// paginar, una tabla como insumos_partida (50k+ filas) sólo bajaba las
// primeras 1000 → el resto de los insumos "desaparecía" en cada device
// nuevo. fetchAllRows pagina con .range() hasta traer todo.
//
// buildQuery DEBE devolver un query nuevo en cada llamada (con sus filtros
// ya aplicados, pero sin .range()) — Supabase ejecuta el builder al await.
const PULL_PAGE_SIZE = 1000;
async function fetchAllRows(buildQuery) {
  let all = [];
  let from = 0;
  for (;;) {
    const { data, error } = await buildQuery().range(from, from + PULL_PAGE_SIZE - 1);
    if (error) return { data: all.length ? all : null, error };
    const batch = data || [];
    all = all.concat(batch);
    if (batch.length < PULL_PAGE_SIZE) break; // última página
    from += PULL_PAGE_SIZE;
  }
  return { data: all, error: null };
}

async function pullMasterTables() {
  for (const { tabla } of MASTER_TABLES) {
    if (TABLAS_NO_EN_SERVER.has(tabla) || _tablasCon404.has(tabla)) {
      continue; // skip silencioso
    }
    try {
      let lastSync = await getLastSync(tabla);
      // Auto-recovery: si Dexie tiene 0 records pero hay lastSync grabado,
      // ignoramos lastSync y hacemos full pull. Pasa cuando IndexedDB se
      // borró parcialmente.
      if (lastSync && db[tabla]) {
        try {
          const localCount = await db[tabla].count();
          if (localCount === 0) {
            console.warn(`[SyncEngine] ${tabla}: Dexie vacío con lastSync grabado → full pull (recovery)`);
            lastSync = null;
          }
        } catch {}
      }

      // CAMBIO CRÍTICO (bug de tombstones): antes el query() filtraba
      // .is('deleted_at', null) siempre. Eso significaba que si otro
      // device hacía un soft-delete (deleted_at = now), el record nunca
      // llegaba a este device — ni por incremental ni por full pull —
      // y se quedaba "fantasma" en Dexie aunque el server lo tuviera
      // marcado como borrado.
      //
      // Ahora:
      //  · Primer pull (sin lastSync): filtramos deleted_at IS NULL
      //    por eficiencia (no descargar tombstones históricos).
      //  · Incremental (con lastSync): traemos TODOS los updated desde
      //    entonces, incluidos los soft-deleted, y abajo separamos
      //    "vivos" de "tombstones" para hacer bulkPut + bulkDelete.
      const buildQuery = () => {
        let q = supabase.from(tabla).select('*');
        if (lastSync) q = q.gt('updated_at', lastSync);
        else q = q.is('deleted_at', null);
        return q;
      };

      const { data, error } = await fetchAllRows(buildQuery);
      if (error) {
        const code = error.code || '';
        const msg = String(error.message || '').toLowerCase();
        if (code === 'PGRST205' || msg.includes('could not find the table') || msg.includes('not found')) {
          _tablasCon404.add(tabla);
          console.warn(`[SyncEngine] tabla "${tabla}" no existe en Supabase remoto — omitida hasta próximo reload.`);
          continue;
        }
        // Si el error es por una columna inexistente (ej. deleted_at no existe
        // en esa tabla), intentamos un fallback sin ese filtro.
        if (code === '42703' || /column .* does not exist/i.test(msg)) {
          console.warn(`[SyncEngine] pull ${tabla}: fallback sin filtros (la tabla no tiene la columna del filtro)`);
          const { data: data2, error: error2 } = await fetchAllRows(() => supabase.from(tabla).select('*'));
          if (error2) {
            console.warn(`[SyncEngine] pull ${tabla} ERROR:`, error2.message);
            continue;
          }
          if (data2?.length) {
            await db[tabla].bulkPut(data2);
            await setLastSync(tabla, new Date().toISOString());
          }
          continue;
        }
        console.warn(`[SyncEngine] pull ${tabla} ERROR:`, error.message, '— posible causa: RLS o permisos');
        continue;
      }
      const dataArr = data || [];

      // ── RECONCILE SWEEP en FULL PULL ──
      // Caso típico: PC1 borró 100 partidas, PC2 hizo sync con código viejo
      // ANTES de este fix (lastSync se actualizó a un momento posterior al
      // delete). Después PC2 carga este código nuevo. La query incremental
      // `updated_at > lastSync` devuelve 0 tombstones (ya pasaron). Y PC2
      // sigue con las 100 partidas fantasma en Dexie.
      //
      // Fix: si estamos en full pull (lastSync era null), comparamos los
      // IDs vivos del server contra los SYNCED locales. Lo que está en
      // Dexie como SYNCED pero NO está en server → fue borrado, lo
      // eliminamos. Skip los locales con sync_status=pending_* (son
      // ediciones nuestras que aún no llegaron).
      if (!lastSync) {
        try {
          const serverIds = new Set(dataArr.map(r => r.id));
          const localesSynced = await db[tabla]
            .where('sync_status').equals(SYNC_STATUS.SYNCED)
            .toArray();
          const aReconciliar = localesSynced
            .filter(l => !serverIds.has(l.id))
            .map(l => l.id);
          if (aReconciliar.length) {
            await db[tabla].bulkDelete(aReconciliar);
            console.log(`[SyncEngine] reconcile ${tabla}: ${aReconciliar.length} records borrados (no estaban en server)`);
          }
        } catch (e) {
          console.warn(`[SyncEngine] reconcile ${tabla} skip:`, e?.message || e);
        }
      }

      if (!dataArr.length) {
        console.log(`[SyncEngine] pull ${tabla}: 0 registros nuevos`);
        await setLastSync(tabla, new Date().toISOString());
        continue;
      }

      // Separar tombstones (soft-deleted desde otro device) de los vivos.
      // Esto SOLO produce tombstones cuando estamos en incremental.
      const tombstones = dataArr.filter(r => r.deleted_at);
      const vivos      = dataArr.filter(r => !r.deleted_at);

      if (vivos.length) {
        // NO pisar registros con cambios locales pendientes/fallidos: el push
        // los va a subir y el server resolverá. Sin este filtro, un pull que
        // corre entre la edición local y su push borra el cambio local —
        // p.ej. el stock de un EPP recién recalculado volvía a 0 porque el
        // server aún tenía stock 0 y el bulkPut lo sobrescribía.
        const vivosIds = vivos.map(r => r.id);
        const pendLocal = new Set();
        try {
          const locs = await db[tabla].where('id').anyOf(vivosIds).toArray();
          for (const l of locs) {
            if (l.sync_status === SYNC_STATUS.PENDING_CREATE ||
                l.sync_status === SYNC_STATUS.PENDING_UPDATE ||
                l.sync_status === SYNC_STATUS.PENDING_DELETE ||
                l.sync_status === SYNC_STATUS.FAILED) {
              pendLocal.add(l.id);
            }
          }
        } catch {}
        const vivosAplicar = pendLocal.size ? vivos.filter(r => !pendLocal.has(r.id)) : vivos;
        if (vivosAplicar.length) await db[tabla].bulkPut(vivosAplicar);
        if (pendLocal.size) console.log(`[SyncEngine] pull ${tabla}: ${pendLocal.size} registros con cambios locales preservados (no pisados)`);
      }
      if (tombstones.length) {
        // Antes de borrar local: si tenemos cambios locales pendientes en
        // ese id (sync_status pending_*), NO los borramos — el SyncEngine
        // los va a pushear y el server resolverá conflicto.
        const ids = tombstones.map(t => t.id);
        const localesPendientes = new Set();
        try {
          const locales = await db[tabla].where('id').anyOf(ids).toArray();
          for (const l of locales) {
            if (l.sync_status === SYNC_STATUS.PENDING_CREATE ||
                l.sync_status === SYNC_STATUS.PENDING_UPDATE ||
                l.sync_status === SYNC_STATUS.PENDING_DELETE) {
              localesPendientes.add(l.id);
            }
          }
        } catch {}
        const idsBorrables = ids.filter(id => !localesPendientes.has(id));
        if (idsBorrables.length) {
          await db[tabla].bulkDelete(idsBorrables);
          console.log(`[SyncEngine] pull ${tabla}: ${idsBorrables.length} tombstones aplicados (${ids.length - idsBorrables.length} skip por pending local)`);
        }
      }
      console.log(`[SyncEngine] pull ${tabla}: ${vivos.length} vivos + ${tombstones.length} tombstones`);
      await setLastSync(tabla, new Date().toISOString());
    } catch (e) {
      console.warn(`[SyncEngine] pull ${tabla} excepción:`, e?.message || e);
    }
  }
}

// Tablas hijas/items que NO tienen columna created_by en el schema —
// el .neq('created_by', userId) provoca HTTP 400 (column does not exist).
// Esta lista es solo el seed inicial; tablas nuevas sin created_by se
// auto-detectan en runtime y se cachean en sync_metadata para no repetir
// el intento fallido en cada sync.
const TABLES_WITHOUT_CREATED_BY = new Set([
  'requisicion_items', 'cotizacion_items', 'oc_items', 'recepcion_items',
  'valorizacion_partidas', 'valorizacion_adicionales',
  'charla_asistentes',
  'insumos_partida', 'insumos_partida_versionadas',
]);

// Cache en memoria de tablas detectadas en runtime como sin created_by.
// Se hidrata desde sync_metadata al primer pull para que sobreviva reloads.
const _runtimeNoCreatedBy = new Set();
let _noCreatedByHydrated = false;

const NO_CREATED_BY_META_KEY = '_no_created_by_tables';

async function hydrateNoCreatedByCache() {
  if (_noCreatedByHydrated) return;
  _noCreatedByHydrated = true;
  try {
    const meta = await db.sync_metadata.get(NO_CREATED_BY_META_KEY);
    const list = meta?.tables;
    if (Array.isArray(list)) list.forEach(t => _runtimeNoCreatedBy.add(t));
  } catch (e) {
    console.warn('[SyncEngine] hydrateNoCreatedByCache:', e?.message || e);
  }
}

async function persistNoCreatedByCache() {
  try {
    await db.sync_metadata.put({
      tabla: NO_CREATED_BY_META_KEY,
      tables: Array.from(_runtimeNoCreatedBy),
      last_synced_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[SyncEngine] persistNoCreatedByCache:', e?.message || e);
  }
}

function isMissingCreatedByError(error) {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  // PostgREST: 42703 = undefined_column. También matcheamos por mensaje
  // por si el code no llega.
  return (
    error.code === '42703' ||
    msg.includes('column "created_by" does not exist') ||
    msg.includes("column 'created_by' does not exist") ||
    (msg.includes('created_by') && msg.includes('does not exist'))
  );
}

function tableSkipsCreatedBy(tabla) {
  return TABLES_WITHOUT_CREATED_BY.has(tabla) || _runtimeNoCreatedBy.has(tabla);
}

// Reparación única por device (client-side migration). El watermark de pull
// transaccional se grababa con el RELOJ DEL CLIENTE (new Date()), no con el
// MAX(updated_at) de lo traído. Un device que avanzó su watermark por delante
// del updated_at de filas que nunca llegó a traer (por el viejo filtro
// created_by, un ciclo que abortó, o skew de reloj) las salta para siempre con
// .gte('updated_at', watermark). Reseteamos UNA vez los watermarks `_pull` para
// forzar un full re-pull que ya se auto-corrige con la lógica nueva (watermark =
// max updated_at). No borra datos locales: el full pull re-aplica (put) sobre lo
// existente y el guard por-registro preserva ediciones locales sin sincronizar.
// Tablas que SOLO son transaccionales (pull incremental por watermark), no
// MASTER (pull completo cada sync). Son las ÚNICAS vulnerables al watermark
// envenenado: las que están también en MASTER se re-bajan enteras cada sync y
// nunca quedan "ciegas". En la práctica: movimientos_materiales,
// movimientos_herramientas, asistencia, avance_obra, incidencias, evidencias.
function transactionalOnlyTables() {
  return TRANSACTIONAL_TABLES.filter(t => !MASTER_TABLES.some(m => m.tabla === t));
}

const _TXWM_REPAIR_KEY = 'jx_txwm_repair_v1';
// Saneo one-shot: personas locales pendientes/failed con valores que violan
// los CHECK del server (seguro_a_cargo fuera de {empresa,subcontrato}, estado
// fuera de la whitelist). Pasaba con Excels de roster con texto libre
// ("Subcontratista", "Activo"); el push devolvía CHECK violation y el registro
// quedaba atascado en failed. Normaliza y re-encola.
// Corre en CADA sync (no one-shot): es idempotente y solo recorre las filas
// pendientes/failed (pocas). Así también sanea datos que meta un build viejo
// desde otro dispositivo.
async function repairPersonalChecksOnce() {
  try {
    const ESTADOS = ['activo', 'inactivo', 'suspendido', 'retirado'];
    const rows = await db.personal.filter(p =>
      p.sync_status === SYNC_STATUS.PENDING_CREATE ||
      p.sync_status === SYNC_STATUS.PENDING_UPDATE ||
      p.sync_status === SYNC_STATUS.FAILED).toArray();
    let arreglados = 0;
    for (const p of rows) {
      const patch = {};
      const seg = String(p.seguro_a_cargo || '').toLowerCase().trim();
      if (p.seguro_a_cargo != null && !['empresa', 'subcontrato'].includes(p.seguro_a_cargo)) {
        patch.seguro_a_cargo = seg.startsWith('emp') ? 'empresa' : seg.startsWith('sub') ? 'subcontrato' : null;
      }
      if (p.estado != null && !ESTADOS.includes(p.estado)) {
        const e = String(p.estado).toLowerCase().trim();
        patch.estado = ESTADOS.includes(e) ? e : 'activo';
      }
      if (p.sync_status === SYNC_STATUS.FAILED) {
        patch.sync_status = p.last_synced_at ? SYNC_STATUS.PENDING_UPDATE : SYNC_STATUS.PENDING_CREATE;
        patch._sync_retries = 0;
      }
      if (Object.keys(patch).length) { await db.personal.update(p.id, patch); arreglados++; }
    }
    if (arreglados) console.log(`[SyncEngine] repair personal CHECKs: ${arreglados} registros normalizados y re-encolados`);
  } catch (e) { console.warn('[SyncEngine] repair personal CHECKs:', e?.message || e); }
}

async function repairAccountingPaymentStatusOnce() {
  // Cura los movimientos contables con payment_status fuera del CHECK de la BD
  // (021_contabilidad: solo 'pending'|'paid'|'cancelled'). La app ofrecía un
  // estado 'credit' ("Crédito") que el server SIEMPRE rechazó (23514) → esos
  // movimientos quedaban FAILED y rebotaban en cada sync sin que se entendiera
  // por qué. 'Crédito' no es un estado de pago sino una forma de pago: una
  // compra al crédito sigue PENDIENTE de pago → la mapeamos a 'pending'.
  // Solo toca filas no-sincronizadas (una synced no puede tener 'credit', el
  // CHECK lo habría impedido), así que es auto-limitante sin flag.
  try {
    if (!db.accounting_movements) return;
    const VALIDOS = ['pending', 'paid', 'cancelled'];
    const rows = await db.accounting_movements.filter(m =>
      m.sync_status === SYNC_STATUS.PENDING_CREATE ||
      m.sync_status === SYNC_STATUS.PENDING_UPDATE ||
      m.sync_status === SYNC_STATUS.FAILED).toArray();
    let arreglados = 0;
    for (const m of rows) {
      if (m.payment_status == null || VALIDOS.includes(m.payment_status)) continue;
      const patch = { payment_status: 'pending', version: (m.version ?? 0) + 1, updated_at: new Date().toISOString() };
      if (m.sync_status === SYNC_STATUS.FAILED) {
        patch.sync_status = m.last_synced_at ? SYNC_STATUS.PENDING_UPDATE : SYNC_STATUS.PENDING_CREATE;
        patch._sync_retries = 0;
      }
      await db.accounting_movements.update(m.id, patch);
      arreglados++;
    }
    if (arreglados) {
      console.log(`[SyncEngine] repair accounting payment_status: ${arreglados} movimiento(s) normalizado(s) (estado inválido→pending) y re-encolado(s)`);
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { source: 'repair_payment_status' } })); } catch {}
    }
  } catch (e) { console.warn('[SyncEngine] repair accounting payment_status:', e?.message || e); }
}

async function repairTransactionalWatermarksOnce() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(_TXWM_REPAIR_KEY)) return;
    // Solo las transaccional-only (las únicas que el watermark puede ocultar).
    for (const tabla of transactionalOnlyTables()) {
      try { await setLastSync(`${tabla}_pull`, null); } catch {}
    }
    if (typeof localStorage !== 'undefined') localStorage.setItem(_TXWM_REPAIR_KEY, new Date().toISOString());
    console.warn('[SyncEngine] watermarks transaccional-only reseteados una vez (repair v1) → próximo pull es full re-pull de esas tablas');
  } catch (e) {
    console.warn('[SyncEngine] repair de watermarks transaccionales falló:', e?.message);
  }
}

async function pullTransactionalChanges() {
  const userId = (await supabase.auth.getUser())?.data?.user?.id;
  if (!userId) return;

  await hydrateNoCreatedByCache();
  // Cura una vez los devices con watermark transaccional "envenenado".
  await repairTransactionalWatermarksOnce();
  await limpiarFantasmas();
  await repairPersonalChecksOnce();
  await repairAccountingPaymentStatusOnce();
  let cacheChanged = false;

  for (const tabla of TRANSACTIONAL_TABLES) {
   try {
    let lastSync = await getLastSync(`${tabla}_pull`);

    // Auto-recovery: si Dexie está vacío pero hay lastSync grabado (típico tras
    // "Limpiar caché local" / "Forzar resync completo"), ignoramos el watermark
    // y hacemos full pull. Igual que pullMasterTables. Sin esto, las tablas
    // transaccionales NO se re-descargaban tras un cache-clear y quedaban
    // invisibles aunque existieran en el server.
    if (lastSync && db[tabla]) {
      try {
        if ((await db[tabla].count()) === 0) {
          console.warn(`[SyncEngine] ${tabla} (tx): Dexie vacío con lastSync grabado → full pull (recovery)`);
          lastSync = null;
        }
      } catch {}
    }

    const baseQuery = () =>
      supabase
        .from(tabla)
        .select('*')
        .gte('updated_at', lastSync ?? '2020-01-01T00:00:00Z');

    // ANTES filtrábamos .neq('created_by', userId) ("no traer lo que yo mismo
    // creé"). Eso causaba PÉRDIDA DE VISTA: tras un cache-clear, los registros
    // creados por el propio usuario (ej. 225 movimientos importados por el
    // admin) NUNCA se re-descargaban → invisibles localmente aunque el stock
    // (tabla maestra) sí volvía. Afectaba a TODAS las tablas transaccionales
    // (movimientos_*, caja_chica, asistencia, avance_obra...). Lo quitamos: el
    // guard por-registro de abajo (skip si sync_status !== synced) ya protege
    // las ediciones locales no sincronizadas, y la RLS del server es la fuente
    // de verdad de visibilidad.
    const skipCreatedBy = tableSkipsCreatedBy(tabla);
    // buildQuery devuelve un query nuevo en cada página (fetchAllRows lo
    // re-ejecuta con distintos .range()).
    const buildQuery = () => baseQuery();

    let { data, error } = await fetchAllRows(buildQuery);

    // Auto-retry: si el error es por columna created_by inexistente,
    // reintentamos sin el filtro y cacheamos el resultado para futuras syncs.
    if (error && !skipCreatedBy && isMissingCreatedByError(error)) {
      console.warn(
        `[SyncEngine] pull ${tabla}: columna created_by ausente — ` +
        `reintentando sin filtro y cacheando.`
      );
      _runtimeNoCreatedBy.add(tabla);
      cacheChanged = true;
      ({ data, error } = await fetchAllRows(baseQuery));
    }

    if (error || !data?.length) continue;

    // Loop: aplicar vivos (put) o tombstones (delete) según deleted_at,
    // respetando cambios locales pendientes (no sobreescribir nuestras
    // ediciones que todavía no se pushearon).
    let aplicados = 0, borrados = 0, skip = 0;
    // Watermark = MAX(updated_at) de lo traído (no el reloj del cliente).
    let maxUpd = lastSync || null;
    for (const serverRecord of data) {
      if (serverRecord.updated_at && (!maxUpd || serverRecord.updated_at > maxUpd)) maxUpd = serverRecord.updated_at;
      const local = await db[tabla].get(serverRecord.id);
      if (local && local.sync_status !== SYNC_STATUS.SYNCED) { skip++; continue; }
      // Ya tenemos esta versión exacta (re-pull de borde por .gte sobre el max
      // watermark) → no re-escribir Dexie en cada tick. Idempotente y barato.
      if (local && !serverRecord.deleted_at && local.updated_at === serverRecord.updated_at) { continue; }

      if (serverRecord.deleted_at) {
        // Tombstone — el record fue soft-deleted en otro device.
        // Antes lo guardábamos con sync_status=synced y deleted_at, lo
        // cual hacía que la UI lo filtrara pero Dexie crecía indefinido.
        // Ahora lo borramos localmente — está soft-deleted en server,
        // si vuelve un día llegará por updated_at otra vez.
        if (local) {
          await db[tabla].delete(serverRecord.id);
          borrados++;
        }
      } else {
        await db[tabla].put({ ...serverRecord, sync_status: SYNC_STATUS.SYNCED });
        aplicados++;
      }
    }
    if (aplicados || borrados || skip) {
      console.log(`[SyncEngine] pull tx ${tabla}: ${aplicados} aplicados, ${borrados} tombstones, ${skip} skip por pending local`);
    }

    // Avanzar el watermark al MAX(updated_at) realmente traído. NUNCA al reloj
    // del cliente: si éste iba por delante del updated_at de los datos, un pull
    // que no los trajera dejaba el watermark adelantado y .gte() los saltaba para
    // siempre (causa raíz de "no veo los movimientos importados").
    if (maxUpd) {
      await setLastSync(`${tabla}_pull`, maxUpd);
    } else if (data.length) {
      // Caso patológico: trajimos filas pero ninguna tiene updated_at. Sin
      // avanzar, esta tabla haría full re-pull cada sync. Avanzamos al reloj
      // como último recurso (en la práctica todas las filas tienen updated_at).
      await setLastSync(`${tabla}_pull`, new Date().toISOString());
    }
   } catch (e) {
     // Aislar el error por-tabla: antes un throw de Dexie en una tabla temprana
     // (ej. durante el upgrade a v21 que solapa el primer sync) abortaba TODO el
     // ciclo y movimientos_materiales (índice ~49) nunca se pulleaba. Igual que
     // pullMasterTables, seguimos con la siguiente tabla.
     console.warn(`[SyncEngine] pull tx ${tabla} falló (continúo con la siguiente):`, e?.message);
     continue;
   }
  }

  if (cacheChanged) await persistNoCreatedByCache();
}

// ── Conflictos ────────────────────────────────────────────────────────

async function markConflict(tabla, localRecord, serverRecord) {
  await db[tabla].update(localRecord.id, { sync_status: SYNC_STATUS.CONFLICT });
  await db.sync_conflicts.add({
    tabla,
    registro_id: localRecord.id,
    datos_local: localRecord,
    datos_servidor: serverRecord,
    estado: 'pendiente',
    created_at: new Date().toISOString(),
  });
}

// Detecta si un error de Supabase indica que las RLS bloquearon la operación
// (insufficient_privilege, row-level security, etc.). Si es así, el sync NUNCA
// va a tener éxito sin cambios server-side, así que disparamos un evento
// global para que la UI muestre un banner al usuario.
function esErrorRLS(error) {
  if (!error) return false;
  const code = error.code || '';
  const msg = String(error.message || '').toLowerCase();
  // OJO: NO matchear 'new row violates' a secas — los CHECK del server
  // (23514, ej. stock negativo transitorio por orden de llegada) dicen
  // "new row ... violates check constraint" y NO son RLS: clasificarlos
  // como RLS los mandaba a FAILED sin reintentos.
  return code === '42501'
    || code === 'PGRST301'
    || msg.includes('row-level security')
    || msg.includes('insufficient_privilege')
    || msg.includes('row level security')
    || msg.includes('violates row-level security');
}

let _ultimoEventoRLSEmitido = 0;
function emitirEventoRLS(tabla, operacion, error) {
  // Throttle: máximo 1 evento cada 5s para no spammear si hay muchas filas pendientes.
  const now = Date.now();
  if (now - _ultimoEventoRLSEmitido < 5000) return;
  _ultimoEventoRLSEmitido = now;
  try {
    window.dispatchEvent(new CustomEvent('jx_sync_blocked_rls', {
      detail: { tabla, operacion, message: error.message, code: error.code },
    }));
  } catch {}
}

// Dedup de warnings RLS a Sentry: solo mandamos 1 captureMessage por
// combinación tabla+operacion por sesión. Si el almacenero tiene 79
// insumos en pending_create de la importación del admin, antes
// generábamos 79 warnings idénticos en Sentry; ahora solo 1.
const _rlsLogged = new Set();

async function handleSyncError(tabla, record, operacion, error) {
  const retries = (record._sync_retries ?? 0) + 1;
  const isRLS = esErrorRLS(error);
  // Si es RLS, marcamos como FAILED inmediatamente — reintentar 5 veces no
  // va a cambiar nada y solo gasta cuota Supabase.
  const newStatus = isRLS || retries >= 5 ? SYNC_STATUS.FAILED : record.sync_status;

  await db[tabla].update(record.id, {
    sync_status: newStatus,
    _sync_retries: retries,
    _last_error: error.message,
    _last_error_code: error.code || null,
    _last_error_is_rls: isRLS,
    // details/hint de Postgres/PostgREST: suelen traer el dato concreto que falla
    // (ej. "Key (campo)=(valor) ...", o la sugerencia de corrección). El modal de
    // sync los usa para decir QUÉ campo y QUÉ valor incumplen la regla.
    _last_error_details: error.details || null,
    _last_error_hint: error.hint || null,
  });

  if (isRLS) {
    console.error(`[SyncEngine] ${tabla}/${operacion} BLOQUEADO POR RLS (sync no podrá completarse):`, error.message);
    emitirEventoRLS(tabla, operacion, error);
    // Sentry: solo el primer evento por tabla+op por sesión. Sin esto,
    // un import del admin propagado al Dexie del almacenero generaba
    // 79 warnings idénticos.
    const dedupKey = `${tabla}_${operacion}`;
    if (!_rlsLogged.has(dedupKey)) {
      _rlsLogged.add(dedupKey);
      captureMessage(
        `[SyncEngine] RLS bloqueando ${tabla}/${operacion}: ${error.message}`,
        'warning'
      );
    }
  } else {
    console.warn(`[SyncEngine] ${tabla}/${operacion} failed (attempt ${retries}):`, error.message);
    // Sentry: solo capturamos cuando ya marcamos como FAILED (5 retries).
    // Antes de eso es ruido — el siguiente intento puede arreglarlo.
    if (newStatus === SYNC_STATUS.FAILED) {
      captureException(error, {
        tags: { module: 'sync-engine', operation: operacion, table: tabla },
        extra: { recordId: record.id, retries, errorCode: error.code },
        level: 'error',
      });
    }
  }
}

// ── Auto-sync al recuperar internet ──────────────────────────────────

window.addEventListener('online', () => {
  console.log('[SyncEngine] Online — syncing...');
  setTimeout(syncAll, 1000); // pequeño delay para estabilizar la conexión
});

// ── Push agresivo al crear/editar localmente ─────────────────────────
// Cuando un componente UI escribe a Dexie, emite 'jx_data_changed'.
// Antes solo refrescábamos la UI; ahora también disparamos un push
// inmediato (debounced 1.5s) para que el record llegue al server YA, no
// 30s después. Esto es lo que hace que "agregar material → otro device
// lo ve" se sienta instantáneo.
let _pushDebounceId = null;
window.addEventListener('jx_data_changed', (e) => {
  // Solo nos interesan cambios LOCALES (source !== 'realtime'), porque
  // los de realtime ya vienen del server y no hay nada que pushear.
  const source = e?.detail?.source;
  if (source === 'realtime' || source === 'pull') return;
  if (!navigator.onLine) return; // si está offline, esperamos al evento online
  clearTimeout(_pushDebounceId);
  _pushDebounceId = setTimeout(() => {
    pushPendingOperations().catch(err => {
      console.warn('[SyncEngine] push agresivo falló:', err?.message);
    });
  }, 1500);
});

// ── Sync periódico cada 60s como respaldo del realtime ──────────────
// Aunque tenemos suscripciones realtime para obras/materiales/etc, hay
// casos en que el canal pierde mensajes (reconexión, latencia, sleep
// del navegador). Este intervalo asegura que como mucho cada minuto
// veamos lo que el resto del equipo ha hecho.
//
// Backoff exponencial: si syncAll falla N veces seguidas, esperamos más entre
// intentos (60s → 120s → 240s → ... → tope 600s). En cuanto un sync funciona,
// volvemos a 60s. Esto evita saturar la red cuando hay problemas de conectividad.
let _periodicId = null;
let _syncFailures = 0;
// Polling de fallback. Realtime cubre la mayoría de los casos en vivo;
// este interval solo tira datos pendientes en cola y cierra brechas si el
// canal Realtime cae. Bajamos a 30s (antes 60s) para que en el peor caso
// los cambios "lleguen tarde" igual se sientan rápidos.
const MIN_INTERVAL_MS = 30_000;
const MAX_INTERVAL_MS = 600_000;

function nextSyncDelay() {
  if (_syncFailures === 0) return MIN_INTERVAL_MS;
  return Math.min(MIN_INTERVAL_MS * Math.pow(2, _syncFailures), MAX_INTERVAL_MS);
}

function scheduleNextSync() {
  if (_periodicId) clearTimeout(_periodicId);
  _periodicId = setTimeout(async () => {
    _periodicId = null;
    if (!navigator.onLine) {
      scheduleNextSync();
      return;
    }
    if (document.visibilityState !== 'visible') {
      scheduleNextSync();
      return;
    }
    try {
      await syncAll();
      _syncFailures = 0;
    } catch (e) {
      _syncFailures = Math.min(_syncFailures + 1, 5);
      console.warn('[SyncEngine] sync failed, backoff:', _syncFailures, 'next in', nextSyncDelay() / 1000, 's');
    }
    scheduleNextSync();
  }, nextSyncDelay());
}

function startPeriodicSync() {
  if (_periodicId) return;
  scheduleNextSync();
}

// Arrancar al cargar el módulo
if (typeof window !== 'undefined') {
  startPeriodicSync();
  // Re-sincronizar cuando el usuario vuelve a la pestaña tras estar en otra
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      setTimeout(syncAll, 500);
    }
  });
  // Re-sincronizar cuando vuelve la conexión: pueden haber registros en
  // pending_create/update que no se subieron mientras estábamos offline,
  // y el server pudo recibir cambios que nuestra cola realtime perdió.
  window.addEventListener('online', () => {
    // Reset del backoff: el server ya no es el problema
    _syncFailures = 0;
    setTimeout(syncAll, 500);
  });
}
