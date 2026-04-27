import Dexie from 'dexie';

export const db = new Dexie('JarvexDB');

// Nota: las tablas movimientos_materiales y movimientos_herramientas pueden contener
// además de los campos indexados, los siguientes (sin índice — Dexie los acepta como
// propiedades regulares):
//   - reverses_id: string | null    → id del movimiento original que este reverso cancela
//   - reversed_by_id: string | null → id del movimiento de reverso que cancela este movimiento
db.version(3).stores({
  // ── Maestras (sync periódico, solo lectura offline) ──────────────────
  obras:                    'id, estado, deleted_at',
  personal:                 'id, obra_id, dni, estado, deleted_at',
  materiales:               'id, obra_id, categoria, alerta, deleted_at',
  herramientas:             'id, obra_id, estado_actual, disponible, deleted_at',
  proveedores:              'id, ruc, deleted_at',
  partidas:                 'id, obra_id, estado, deleted_at',
  insumos_partida:          'id, obra_id, partida_id',
  cronograma:               'id, obra_id, partida_id',
  profiles:                 'id, rol',

  // ── Transaccionales (escritura offline + cola de sync) ───────────────
  asistencia:               'id, obra_id, personal_id, fecha, sync_status, idempotency_key',
  movimientos_materiales:   'id, obra_id, material_id, fecha, sync_status, idempotency_key',
  movimientos_herramientas: 'id, obra_id, herramienta_id, fecha, sync_status, idempotency_key',
  avance_obra:              'id, obra_id, partida_id, fecha, sync_status, idempotency_key',
  incidencias:              'id, obra_id, estado, sync_status',

  // ── Evidencias (blob local + metadata) ──────────────────────────────
  evidencias:               'id, obra_id, modulo_relacionado, registro_relacionado_id, sync_status',
  evidencias_blobs:         'id',

  // ── Control de sincronización ────────────────────────────────────────
  sync_queue:               '++local_seq, tabla, registro_id, operacion, sync_status, created_at',
  sync_conflicts:           '++local_seq, tabla, registro_id, estado, created_at',
  sync_metadata:            'tabla',

  // ── Auditoría (cola offline) ─────────────────────────────────────────
  audit_log_pending:        'id, table_name, record_id, user_id, synced, created_at',

  // ── Solicitudes de cambio (cola offline) ─────────────────────────────
  change_requests_pending:  'id, target_table, target_record_id, requester_id, synced, created_at',

  // ── Auth offline ─────────────────────────────────────────────────────
  auth_cache:               'key',
});

db.version(2).stores({
  // ── Maestras (sync periódico, solo lectura offline) ──────────────────
  obras:                    'id, estado, deleted_at',
  personal:                 'id, obra_id, dni, estado, deleted_at',
  materiales:               'id, obra_id, categoria, alerta, deleted_at',
  herramientas:             'id, obra_id, estado_actual, disponible, deleted_at',
  proveedores:              'id, ruc, deleted_at',
  partidas:                 'id, obra_id, estado, deleted_at',
  insumos_partida:          'id, obra_id, partida_id',
  cronograma:               'id, obra_id, partida_id',
  profiles:                 'id, rol',

  // ── Transaccionales (escritura offline + cola de sync) ───────────────
  asistencia:               'id, obra_id, personal_id, fecha, sync_status, idempotency_key',
  movimientos_materiales:   'id, obra_id, material_id, fecha, sync_status, idempotency_key',
  movimientos_herramientas: 'id, obra_id, herramienta_id, fecha, sync_status, idempotency_key',
  avance_obra:              'id, obra_id, partida_id, fecha, sync_status, idempotency_key',
  incidencias:              'id, obra_id, estado, sync_status',

  // ── Evidencias (blob local + metadata) ──────────────────────────────
  evidencias:               'id, obra_id, modulo_relacionado, registro_relacionado_id, sync_status',
  evidencias_blobs:         'id',

  // ── Control de sincronización ────────────────────────────────────────
  sync_queue:               '++local_seq, tabla, registro_id, operacion, sync_status, created_at',
  sync_conflicts:           '++local_seq, tabla, registro_id, estado, created_at',
  sync_metadata:            'tabla',

  // ── Auditoría (cola offline) ─────────────────────────────────────────
  audit_log_pending:        'id, table_name, record_id, user_id, synced, created_at',

  // ── Auth offline ─────────────────────────────────────────────────────
  auth_cache:               'key',
});

db.version(1).stores({
  // ── Maestras (sync periódico, solo lectura offline) ──────────────────
  obras:                    'id, estado, deleted_at',
  personal:                 'id, obra_id, dni, estado, deleted_at',
  materiales:               'id, obra_id, categoria, alerta, deleted_at',
  herramientas:             'id, obra_id, estado_actual, disponible, deleted_at',
  proveedores:              'id, ruc, deleted_at',
  partidas:                 'id, obra_id, estado, deleted_at',
  insumos_partida:          'id, obra_id, partida_id',
  cronograma:               'id, obra_id, partida_id',
  profiles:                 'id, rol',

  // ── Transaccionales (escritura offline + cola de sync) ───────────────
  asistencia:               'id, obra_id, personal_id, fecha, sync_status, idempotency_key',
  movimientos_materiales:   'id, obra_id, material_id, fecha, sync_status, idempotency_key',
  movimientos_herramientas: 'id, obra_id, herramienta_id, fecha, sync_status, idempotency_key',
  avance_obra:              'id, obra_id, partida_id, fecha, sync_status, idempotency_key',
  incidencias:              'id, obra_id, estado, sync_status',

  // ── Evidencias (blob local + metadata) ──────────────────────────────
  evidencias:               'id, obra_id, modulo_relacionado, registro_relacionado_id, sync_status',
  evidencias_blobs:         'id',

  // ── Control de sincronización ────────────────────────────────────────
  sync_queue:               '++local_seq, tabla, registro_id, operacion, sync_status, created_at',
  sync_conflicts:           '++local_seq, tabla, registro_id, estado, created_at',
  sync_metadata:            'tabla',

  // ── Auth offline ─────────────────────────────────────────────────────
  auth_cache:               'key',
});

// ── Helpers ──────────────────────────────────────────────────────────────

export const SYNC_STATUS = {
  SYNCED:          'synced',
  PENDING_CREATE:  'pending_create',
  PENDING_UPDATE:  'pending_update',
  PENDING_DELETE:  'pending_delete',
  CONFLICT:        'conflict',
  FAILED:          'failed',
};

export const UPLOAD_STATUS = {
  PENDING:  'pending_upload',
  UPLOADED: 'uploaded',
  FAILED:   'failed',
};

export function newId() {
  return crypto.randomUUID();
}

export function newIdempotencyKey(userId, tabla) {
  return `${userId}_${tabla}_${crypto.randomUUID()}`;
}

export async function getLastSync(tabla) {
  const meta = await db.sync_metadata.get(tabla);
  return meta?.last_synced_at ?? null;
}

export async function setLastSync(tabla, ts) {
  await db.sync_metadata.put({ tabla, last_synced_at: ts });
}
