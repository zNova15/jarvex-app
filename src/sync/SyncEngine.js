import { db, SYNC_STATUS, getLastSync, setLastSync } from '../db/jarvex.db';
import { supabase } from '../lib/supabase';

// Tablas transaccionales que participan en la cola de sync
const TRANSACTIONAL_TABLES = [
  'asistencia',
  'movimientos_materiales',
  'movimientos_herramientas',
  'avance_obra',
  'incidencias',
  'evidencias',
];

// Tablas maestras que se descargan del servidor (pull-only en Fase 1)
const MASTER_TABLES = [
  { tabla: 'obras',       query: () => supabase.from('obras').select('*').is('deleted_at', null) },
  { tabla: 'personal',    query: () => supabase.from('personal').select('*').is('deleted_at', null) },
  { tabla: 'materiales',  query: () => supabase.from('materiales').select('*').is('deleted_at', null) },
  { tabla: 'herramientas',query: () => supabase.from('herramientas').select('*').is('deleted_at', null) },
  { tabla: 'proveedores', query: () => supabase.from('proveedores').select('*').is('deleted_at', null) },
  { tabla: 'partidas',    query: () => supabase.from('partidas').select('*').is('deleted_at', null) },
  { tabla: 'profiles',    query: () => supabase.from('profiles').select('*') },
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

  try {
    await pushPendingOperations();
    await pullMasterTables();
    await pullTransactionalChanges();

    const pending = await getPendingCount();
    emit({ syncing: false, pending, lastSync: new Date(), error: null });
  } catch (err) {
    console.error('[SyncEngine] Error:', err);
    emit({ syncing: false, error: err.message });
  } finally {
    syncInProgress = false;
  }
}

// ── PUSH: local → Supabase ────────────────────────────────────────────

async function pushPendingOperations() {
  for (const tabla of TRANSACTIONAL_TABLES) {
    const pendingCreates = await db[tabla]
      .where('sync_status').equals(SYNC_STATUS.PENDING_CREATE)
      .toArray();

    for (const record of pendingCreates) {
      await pushCreate(tabla, record);
    }

    const pendingUpdates = await db[tabla]
      .where('sync_status').equals(SYNC_STATUS.PENDING_UPDATE)
      .toArray();

    for (const record of pendingUpdates) {
      await pushUpdate(tabla, record);
    }

    const pendingDeletes = await db[tabla]
      .where('sync_status').equals(SYNC_STATUS.PENDING_DELETE)
      .toArray();

    for (const record of pendingDeletes) {
      await pushDelete(tabla, record);
    }
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

  const { error, data: existing } = await supabase
    .from(tabla)
    .select('version')
    .eq('id', record.id)
    .single();

  if (!error && existing && existing.version > record.version) {
    // Conflicto: el servidor tiene una versión más nueva
    await markConflict(tabla, record, existing);
    return;
  }

  const { error: updateError } = await supabase
    .from(tabla)
    .update(serverRecord)
    .eq('id', record.id)
    .eq('version', record.version - 1); // optimistic concurrency

  if (!updateError) {
    await db[tabla].update(record.id, {
      sync_status: SYNC_STATUS.SYNCED,
      last_synced_at: new Date().toISOString(),
    });
  } else {
    await handleSyncError(tabla, record, 'update', updateError);
  }
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

async function pullMasterTables() {
  for (const { tabla, query } of MASTER_TABLES) {
    const lastSync = await getLastSync(tabla);
    let q = query();
    if (lastSync) {
      q = q.gte('updated_at', lastSync);
    }

    const { data, error } = await q;
    if (error) continue;
    if (!data?.length) continue;

    await db[tabla].bulkPut(data);
    await setLastSync(tabla, new Date().toISOString());
  }
}

async function pullTransactionalChanges() {
  const userId = (await supabase.auth.getUser())?.data?.user?.id;
  if (!userId) return;

  for (const tabla of TRANSACTIONAL_TABLES) {
    const lastSync = await getLastSync(`${tabla}_pull`);
    const q = supabase
      .from(tabla)
      .select('*')
      .gte('updated_at', lastSync ?? '2020-01-01T00:00:00Z')
      .neq('created_by', userId); // No traer lo que yo mismo creé

    const { data, error } = await q;
    if (error || !data?.length) continue;

    // Solo insertar/actualizar si el registro local NO tiene cambios pendientes
    for (const serverRecord of data) {
      const local = await db[tabla].get(serverRecord.id);
      if (local && local.sync_status !== SYNC_STATUS.SYNCED) continue;

      await db[tabla].put({ ...serverRecord, sync_status: SYNC_STATUS.SYNCED });
    }

    await setLastSync(`${tabla}_pull`, new Date().toISOString());
  }
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

async function handleSyncError(tabla, record, operacion, error) {
  const retries = (record._sync_retries ?? 0) + 1;
  const newStatus = retries >= 5 ? SYNC_STATUS.FAILED : record.sync_status;

  await db[tabla].update(record.id, {
    sync_status: newStatus,
    _sync_retries: retries,
    _last_error: error.message,
  });

  console.warn(`[SyncEngine] ${tabla}/${operacion} failed (attempt ${retries}):`, error.message);
}

// ── Auto-sync al recuperar internet ──────────────────────────────────

window.addEventListener('online', () => {
  console.log('[SyncEngine] Online — syncing...');
  setTimeout(syncAll, 1000); // pequeño delay para estabilizar la conexión
});
