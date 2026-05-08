import { db, SYNC_STATUS, getLastSync, setLastSync } from '../db/jarvex.db';
import { supabase } from '../lib/supabase';
import { syncPendingAuditLogs } from '../lib/audit';
import { syncPendingChangeRequests } from '../lib/changeRequests';
import { captureException, captureMessage } from '../instrument.js';

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

async function pushTablePending(tabla) {
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

async function pushCreate(tabla, record) {
  const { sync_status, last_synced_at, ...serverRecord } = record;

  const { error } = await supabase.from(tabla).insert(serverRecord);

  if (!error) {
    await db[tabla].update(record.id, {
      sync_status: SYNC_STATUS.SYNCED,
      last_synced_at: new Date().toISOString(),
    });
  } else if (error.code === '23505') {
    // Unique constraint → ya existe en servidor (idempotency_key duplicado)
    await db[tabla].update(record.id, { sync_status: SYNC_STATUS.SYNCED });
  } else {
    await handleSyncError(tabla, record, 'create', error);
  }
}

async function pushUpdate(tabla, record) {
  const { sync_status, last_synced_at, ...serverRecord } = record;

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
}

async function pushDelete(tabla, record) {
  const { error } = await supabase
    .from(tabla)
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', record.id);

  if (!error) {
    await db[tabla].delete(record.id);
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
      const lastSync = await getLastSync(tabla);
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
    // Sentry: warning crítico (NO error full porque la app sigue OK).
    captureMessage(
      `[SyncEngine] RLS bloqueando ${tabla}/${operacion}: ${error.message}`,
      'warning'
    );
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
