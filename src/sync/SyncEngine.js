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
  'personal',
  'materiales',
  'herramientas',
  'proveedores',
  'partidas',
  'insumos_partida',
  'presupuestos_versiones',
  'partidas_versionadas',
  'insumos_partida_versionadas',
  'material_precios_historial',
  'companies',
  'accounting_movements',
  'intercompany_transactions',
  // Compras
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
  'incidencias',
  'evidencias',
  // Trazabilidad
  'trazabilidad_cadenas',
  // Ubicaciones de almacenaje (catálogo per-obra)
  'ubicaciones_obra',
  // EPPs (catálogo + movimientos con firma) — separados de materiales
  'epps',
  'movimientos_epp',
];

// Tablas maestras que se descargan del servidor en cada sync.
const MASTER_TABLES = [
  { tabla: 'obras',                  query: () => supabase.from('obras').select('*').is('deleted_at', null) },
  { tabla: 'personal',               query: () => supabase.from('personal').select('*').is('deleted_at', null) },
  { tabla: 'materiales',             query: () => supabase.from('materiales').select('*').is('deleted_at', null) },
  { tabla: 'herramientas',           query: () => supabase.from('herramientas').select('*').is('deleted_at', null) },
  { tabla: 'proveedores',            query: () => supabase.from('proveedores').select('*').is('deleted_at', null) },
  { tabla: 'partidas',               query: () => supabase.from('partidas').select('*').is('deleted_at', null) },
  { tabla: 'insumos_partida',        query: () => supabase.from('insumos_partida').select('*') },
  { tabla: 'presupuestos_versiones', query: () => supabase.from('presupuestos_versiones').select('*').is('deleted_at', null) },
  { tabla: 'partidas_versionadas',         query: () => supabase.from('partidas_versionadas').select('*').is('deleted_at', null) },
  { tabla: 'insumos_partida_versionadas',  query: () => supabase.from('insumos_partida_versionadas').select('*').is('deleted_at', null) },
  { tabla: 'material_precios_historial',   query: () => supabase.from('material_precios_historial').select('*').is('deleted_at', null) },
  { tabla: 'companies',                    query: () => supabase.from('companies').select('*').is('deleted_at', null) },
  { tabla: 'accounting_movements',         query: () => supabase.from('accounting_movements').select('*').is('deleted_at', null) },
  { tabla: 'intercompany_transactions',    query: () => supabase.from('intercompany_transactions').select('*').is('deleted_at', null) },
  // Compras
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

    const pending = await getPendingCount();
    const ms = Math.round(performance.now() - t0);
    console.log(`[SyncEngine] ✓ syncAll OK en ${ms}ms · pending=${pending}`);
    emit({ syncing: false, pending, lastSync: new Date(), error: null });
  } catch (err) {
    console.error('[SyncEngine] ✗ Error en syncAll:', err);
    emit({ syncing: false, error: err.message });
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
  asistencia: 'Asistencia',
  avance_obra: 'Avance',
  incidencias: 'Incidencias',
  evidencias: 'Evidencias',
  ubicaciones_obra: 'Ubicaciones',
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
  movimientos_materiales:    [{ campo: 'material_id', tabla: 'materiales' }],
  movimientos_herramientas:  [{ campo: 'herramienta_id', tabla: 'herramientas' }],
  movimientos_epp:           [{ campo: 'epp_id', tabla: 'epps' }],
  asistencia:                [{ campo: 'personal_id', tabla: 'personal' }],
  recepcion_items:           [{ campo: 'recepcion_id', tabla: 'recepciones' }],
  oc_items:                  [{ campo: 'oc_id', tabla: 'ordenes_compra' }],
  cotizacion_items:          [{ campo: 'cotizacion_id', tabla: 'cotizaciones' }],
  requisicion_items:         [{ campo: 'requisicion_id', tabla: 'requisiciones' }],
};

// True si todas las FKs del record están sincronizadas (o no hay FKs).
async function fkDepsReady(tabla, record) {
  const deps = FK_DEPS[tabla];
  if (!deps) return true;
  for (const { campo, tabla: tablaRef } of deps) {
    const id = record[campo];
    if (!id) continue; // FK opcional
    const ref = await db[tablaRef].get(id);
    if (!ref) return false; // referencia rota — no pushear
    if (ref.sync_status && ref.sync_status !== SYNC_STATUS.SYNCED) {
      return false; // todavía pendiente
    }
  }
  return true;
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
    .filter(r => r._last_error_code === 'PGRST204'
                 && /column of/i.test(r._last_error || ''))
    .toArray();
  for (const r of stuckByPGRST204) {
    await db[tabla].update(r.id, {
      sync_status: SYNC_STATUS.PENDING_UPDATE,
      _sync_retries: 0,
    });
    console.info(`[SyncEngine] self-heal PGRST204: ${tabla}/${r.id} reset a PENDING_UPDATE`);
  }

  // Self-heal #2: records FAILED por causas NO permanentes (no RLS, no
  // schema cache) que llevan más de 10 min en FAILED. Probablemente fue
  // un error transitorio de red/server y vale la pena reintentar. Sin
  // este reset, un blip de Supabase deja records en FAILED para siempre.
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
    await db[tabla].update(r.id, {
      sync_status: SYNC_STATUS.PENDING_UPDATE,
      _sync_retries: 0,
    });
    console.info(`[SyncEngine] self-heal transient: ${tabla}/${r.id} reset (FAILED >10min)`);
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

  for (const record of pendingCreates) {
    await pushCreate(tabla, record);
  }

  const pendingUpdates = (await db[tabla]
    .where('sync_status').equals(SYNC_STATUS.PENDING_UPDATE)
    .toArray()).filter(noEsDemo);

  for (const record of pendingUpdates) {
    await pushUpdate(tabla, record);
  }

  const pendingDeletes = (await db[tabla]
    .where('sync_status').equals(SYNC_STATUS.PENDING_DELETE)
    .toArray()).filter(noEsDemo);

  for (const record of pendingDeletes) {
    await pushDelete(tabla, record);
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
const TRIGGER_MANAGED_FIELDS = {
  materiales: new Set([
    'stock_actual', 'total_entradas', 'total_salidas',
    'precio_unitario_real_prom', 'alerta',
  ]),
  herramientas: new Set([
    'disponible', 'ubicacion_actual', 'ultimo_responsable_id',
    'estado_actual',
  ]),
  epps: new Set([
    'stock_actual', 'total_entradas', 'total_salidas', 'alerta',
  ]),
};

// Quita campos que solo viven en Dexie y nunca deben mandarse al server.
// Convención: cualquier prop con prefijo `_` (ej: _last_error, _sync_retries)
// es metadato local. Sin este filtro, PostgREST devuelve PGRST204
// "Could not find the '_last_error' column" y el record se queda
// permanentemente en pending — lo vimos en producción (Sentry JARVEX-APP-4).
function stripLocalFields(record, tabla) {
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
    // Unique constraint → ya existe en servidor (idempotency_key duplicado)
    await db[tabla].update(record.id, { sync_status: SYNC_STATUS.SYNCED });
    trackEvent('record_pushed', { tabla, operacion: 'create_dedup' });
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
  const { error: selectErr, data: existing } = await supabase
    .from(tabla)
    .select('version')
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
    .select('id');

  if (updateError) {
    await handleSyncError(tabla, record, 'update', updateError);
    return;
  }

  if (!actualizadas || actualizadas.length === 0) {
    // 0 rows affected: la version del cliente no matchea la del server.
    // Probablemente otro cliente actualizó este record entre nuestro pull
    // anterior y este push. Marcamos como conflicto para resolver manual.
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

  // Update exitoso — marcar como synced
  await db[tabla].update(record.id, {
    sync_status: SYNC_STATUS.SYNCED,
    last_synced_at: new Date().toISOString(),
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

async function pullMasterTables() {
  for (const { tabla, query } of MASTER_TABLES) {
    if (TABLAS_NO_EN_SERVER.has(tabla) || _tablasCon404.has(tabla)) {
      continue; // skip silencioso
    }
    try {
      let lastSync = await getLastSync(tabla);
      // Auto-recovery: si Dexie tiene 0 records de esta tabla pero hay
      // lastSync grabado, ignoramos lastSync y hacemos full pull. Pasa
      // cuando IndexedDB se borró parcialmente (quota, "Clear cache" pero
      // no "Clear cookies", crash del browser) y los datos viejos
      // quedaron inalcanzables porque su updated_at < lastSync. Sin esto,
      // el almacenero ve 0 partidas para siempre aunque el server tenga
      // 9145.
      if (lastSync && db[tabla]) {
        try {
          const localCount = await db[tabla].count();
          if (localCount === 0) {
            console.warn(`[SyncEngine] ${tabla}: Dexie vacío con lastSync grabado → full pull (recovery)`);
            lastSync = null;
          }
        } catch {}
      }
      let q = query();
      if (lastSync) {
        q = q.gte('updated_at', lastSync);
      }

      const { data, error } = await q;
      if (error) {
        // Detectar tabla inexistente (404 / PGRST205): la marcamos para
        // skip durante esta sesión y NO romper el resto del sync.
        const code = error.code || '';
        const msg = String(error.message || '').toLowerCase();
        if (code === 'PGRST205' || msg.includes('could not find the table') || msg.includes('not found')) {
          _tablasCon404.add(tabla);
          console.warn(`[SyncEngine] tabla "${tabla}" no existe en Supabase remoto — se omitirá hasta el próximo reload. Correr migrations.sql para crearla.`);
          continue;
        }
        console.warn(`[SyncEngine] pull ${tabla} ERROR:`, error.message, '— posible causa: RLS o falta de permisos');
        continue;
      }
      if (!data?.length) {
        console.log(`[SyncEngine] pull ${tabla}: 0 registros nuevos`);
        continue;
      }

      console.log(`[SyncEngine] pull ${tabla}: ${data.length} registros recibidos`);
      await db[tabla].bulkPut(data);
      await setLastSync(tabla, new Date().toISOString());
    } catch (e) {
      // Network errors u otros — no romper sync entero
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

async function pullTransactionalChanges() {
  const userId = (await supabase.auth.getUser())?.data?.user?.id;
  if (!userId) return;

  await hydrateNoCreatedByCache();
  let cacheChanged = false;

  for (const tabla of TRANSACTIONAL_TABLES) {
    const lastSync = await getLastSync(`${tabla}_pull`);
    const baseQuery = () =>
      supabase
        .from(tabla)
        .select('*')
        .gte('updated_at', lastSync ?? '2020-01-01T00:00:00Z');

    let q = baseQuery();
    const skipCreatedBy = tableSkipsCreatedBy(tabla);
    if (!skipCreatedBy) {
      q = q.neq('created_by', userId); // No traer lo que yo mismo creé
    }

    let { data, error } = await q;

    // Auto-retry: si el error es por columna created_by inexistente,
    // reintentamos sin el filtro y cacheamos el resultado para futuras syncs.
    if (error && !skipCreatedBy && isMissingCreatedByError(error)) {
      console.warn(
        `[SyncEngine] pull ${tabla}: columna created_by ausente — ` +
        `reintentando sin filtro y cacheando.`
      );
      _runtimeNoCreatedBy.add(tabla);
      cacheChanged = true;
      ({ data, error } = await baseQuery());
    }

    if (error || !data?.length) continue;

    // Solo insertar/actualizar si el registro local NO tiene cambios pendientes
    for (const serverRecord of data) {
      const local = await db[tabla].get(serverRecord.id);
      if (local && local.sync_status !== SYNC_STATUS.SYNCED) continue;

      await db[tabla].put({ ...serverRecord, sync_status: SYNC_STATUS.SYNCED });
    }

    await setLastSync(`${tabla}_pull`, new Date().toISOString());
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
  return code === '42501'
    || code === 'PGRST301'
    || msg.includes('row-level security')
    || msg.includes('insufficient_privilege')
    || msg.includes('row level security')
    || msg.includes('new row violates');
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
