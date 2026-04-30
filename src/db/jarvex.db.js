import Dexie from 'dexie';

export const db = new Dexie('JarvexDB');

// Nota: las tablas movimientos_materiales y movimientos_herramientas pueden contener
// además de los campos indexados, los siguientes (sin índice — Dexie los acepta como
// propiedades regulares):
//   - reverses_id: string | null    → id del movimiento original que este reverso cancela
//   - reversed_by_id: string | null → id del movimiento de reverso que cancela este movimiento
// Versión 8: módulo Contabilidad (companies + accounting_movements +
// intercompany_transactions). Permite manejar la contabilidad básica
// de varias empresas y ver consolidados con/sin operaciones internas.
db.version(8).stores({
  obras:                    'id, estado, deleted_at, sync_status',
  personal:                 'id, obra_id, dni, estado, deleted_at, sync_status',
  materiales:               'id, obra_id, categoria, alerta, deleted_at, sync_status',
  herramientas:             'id, obra_id, estado_actual, disponible, deleted_at, sync_status',
  proveedores:              'id, ruc, deleted_at, sync_status',
  partidas:                 'id, obra_id, estado, deleted_at, sync_status',
  insumos_partida:          'id, obra_id, partida_id, sync_status',
  cronograma:               'id, obra_id, partida_id, sync_status',
  profiles:                 'id, rol',

  presupuestos_versiones:        'id, obra_id, numero, deleted_at, sync_status',
  partidas_versionadas:          'id, version_id, obra_id, codigo, deleted_at, sync_status',
  insumos_partida_versionadas:   'id, version_id, partida_versionada_id, obra_id, deleted_at, sync_status',
  material_precios_historial:    'id, material_id, obra_id, fecha, deleted_at, sync_status',

  // ── Contabilidad (NUEVO en v8) ──
  companies:                 'id, ruc, status, deleted_at, sync_status',
  accounting_movements:      'id, company_id, type, date, payment_status, is_intercompany, related_movement_id, deleted_at, sync_status',
  intercompany_transactions: 'id, seller_company_id, buyer_company_id, date, deleted_at, sync_status',

  asistencia:               'id, obra_id, personal_id, fecha, sync_status, idempotency_key',
  movimientos_materiales:   'id, obra_id, material_id, fecha, sync_status, idempotency_key',
  movimientos_herramientas: 'id, obra_id, herramienta_id, fecha, sync_status, idempotency_key',
  avance_obra:              'id, obra_id, partida_id, fecha, sync_status, idempotency_key',
  incidencias:              'id, obra_id, estado, sync_status',
  evidencias:               'id, obra_id, modulo_relacionado, registro_relacionado_id, sync_status',
  evidencias_blobs:         'id',

  sync_queue:               '++local_seq, tabla, registro_id, operacion, sync_status, created_at',
  sync_conflicts:           '++local_seq, tabla, registro_id, estado, created_at',
  sync_metadata:            'tabla',
  audit_log_pending:        'id, table_name, record_id, user_id, synced, created_at',
  change_requests_pending:  'id, target_table, target_record_id, requester_id, synced, created_at',
  auth_cache:               'key',
});

// Versión 7: material_precios_historial
db.version(7).stores({
  // ── Maestras ──
  obras:                    'id, estado, deleted_at, sync_status',
  personal:                 'id, obra_id, dni, estado, deleted_at, sync_status',
  materiales:               'id, obra_id, categoria, alerta, deleted_at, sync_status',
  herramientas:             'id, obra_id, estado_actual, disponible, deleted_at, sync_status',
  proveedores:              'id, ruc, deleted_at, sync_status',
  partidas:                 'id, obra_id, estado, deleted_at, sync_status',
  insumos_partida:          'id, obra_id, partida_id, sync_status',
  cronograma:               'id, obra_id, partida_id, sync_status',
  profiles:                 'id, rol',

  // ── Presupuestos versionados ──
  presupuestos_versiones:        'id, obra_id, numero, deleted_at, sync_status',
  partidas_versionadas:          'id, version_id, obra_id, codigo, deleted_at, sync_status',
  insumos_partida_versionadas:   'id, version_id, partida_versionada_id, obra_id, deleted_at, sync_status',

  // ── Historial de precios (NUEVO en v7) ──
  material_precios_historial:    'id, material_id, obra_id, fecha, deleted_at, sync_status',

  // ── Transaccionales ──
  asistencia:               'id, obra_id, personal_id, fecha, sync_status, idempotency_key',
  movimientos_materiales:   'id, obra_id, material_id, fecha, sync_status, idempotency_key',
  movimientos_herramientas: 'id, obra_id, herramienta_id, fecha, sync_status, idempotency_key',
  avance_obra:              'id, obra_id, partida_id, fecha, sync_status, idempotency_key',
  incidencias:              'id, obra_id, estado, sync_status',
  evidencias:               'id, obra_id, modulo_relacionado, registro_relacionado_id, sync_status',
  evidencias_blobs:         'id',

  // ── Control + colas ──
  sync_queue:               '++local_seq, tabla, registro_id, operacion, sync_status, created_at',
  sync_conflicts:           '++local_seq, tabla, registro_id, estado, created_at',
  sync_metadata:            'tabla',
  audit_log_pending:        'id, table_name, record_id, user_id, synced, created_at',
  change_requests_pending:  'id, target_table, target_record_id, requester_id, synced, created_at',
  auth_cache:               'key',
});

// Versión 6: insumos_partida_versionadas
db.version(6).stores({
  // ── Maestras ──
  obras:                    'id, estado, deleted_at, sync_status',
  personal:                 'id, obra_id, dni, estado, deleted_at, sync_status',
  materiales:               'id, obra_id, categoria, alerta, deleted_at, sync_status',
  herramientas:             'id, obra_id, estado_actual, disponible, deleted_at, sync_status',
  proveedores:              'id, ruc, deleted_at, sync_status',
  partidas:                 'id, obra_id, estado, deleted_at, sync_status',
  insumos_partida:          'id, obra_id, partida_id, sync_status',
  cronograma:               'id, obra_id, partida_id, sync_status',
  profiles:                 'id, rol',

  // ── Presupuestos versionados ──
  presupuestos_versiones:        'id, obra_id, numero, deleted_at, sync_status',
  partidas_versionadas:          'id, version_id, obra_id, codigo, deleted_at, sync_status',
  insumos_partida_versionadas:   'id, version_id, partida_versionada_id, obra_id, deleted_at, sync_status',

  // ── Transaccionales ──
  asistencia:               'id, obra_id, personal_id, fecha, sync_status, idempotency_key',
  movimientos_materiales:   'id, obra_id, material_id, fecha, sync_status, idempotency_key',
  movimientos_herramientas: 'id, obra_id, herramienta_id, fecha, sync_status, idempotency_key',
  avance_obra:              'id, obra_id, partida_id, fecha, sync_status, idempotency_key',
  incidencias:              'id, obra_id, estado, sync_status',
  evidencias:               'id, obra_id, modulo_relacionado, registro_relacionado_id, sync_status',
  evidencias_blobs:         'id',

  // ── Control + colas ──
  sync_queue:               '++local_seq, tabla, registro_id, operacion, sync_status, created_at',
  sync_conflicts:           '++local_seq, tabla, registro_id, estado, created_at',
  sync_metadata:            'tabla',
  audit_log_pending:        'id, table_name, record_id, user_id, synced, created_at',
  change_requests_pending:  'id, target_table, target_record_id, requester_id, synced, created_at',
  auth_cache:               'key',
});

// Versión 5: agregamos presupuestos_versiones y partidas_versionadas
db.version(5).stores({
  // ── Maestras ──
  obras:                    'id, estado, deleted_at, sync_status',
  personal:                 'id, obra_id, dni, estado, deleted_at, sync_status',
  materiales:               'id, obra_id, categoria, alerta, deleted_at, sync_status',
  herramientas:             'id, obra_id, estado_actual, disponible, deleted_at, sync_status',
  proveedores:              'id, ruc, deleted_at, sync_status',
  partidas:                 'id, obra_id, estado, deleted_at, sync_status',
  insumos_partida:          'id, obra_id, partida_id, sync_status',
  cronograma:               'id, obra_id, partida_id, sync_status',
  profiles:                 'id, rol',

  // ── Presupuestos versionados (NUEVO en v5) ──
  presupuestos_versiones:   'id, obra_id, numero, deleted_at, sync_status',
  partidas_versionadas:     'id, version_id, obra_id, codigo, deleted_at, sync_status',

  // ── Transaccionales ──
  asistencia:               'id, obra_id, personal_id, fecha, sync_status, idempotency_key',
  movimientos_materiales:   'id, obra_id, material_id, fecha, sync_status, idempotency_key',
  movimientos_herramientas: 'id, obra_id, herramienta_id, fecha, sync_status, idempotency_key',
  avance_obra:              'id, obra_id, partida_id, fecha, sync_status, idempotency_key',
  incidencias:              'id, obra_id, estado, sync_status',
  evidencias:               'id, obra_id, modulo_relacionado, registro_relacionado_id, sync_status',
  evidencias_blobs:         'id',

  // ── Control + colas ──
  sync_queue:               '++local_seq, tabla, registro_id, operacion, sync_status, created_at',
  sync_conflicts:           '++local_seq, tabla, registro_id, estado, created_at',
  sync_metadata:            'tabla',
  audit_log_pending:        'id, table_name, record_id, user_id, synced, created_at',
  change_requests_pending:  'id, target_table, target_record_id, requester_id, synced, created_at',
  auth_cache:               'key',
});

// Versión 4: agregamos sync_status como índice a TODAS las master tables.
db.version(4).stores({
  // ── Maestras (con índice sync_status para que el push las recorra) ──
  obras:                    'id, estado, deleted_at, sync_status',
  personal:                 'id, obra_id, dni, estado, deleted_at, sync_status',
  materiales:               'id, obra_id, categoria, alerta, deleted_at, sync_status',
  herramientas:             'id, obra_id, estado_actual, disponible, deleted_at, sync_status',
  proveedores:              'id, ruc, deleted_at, sync_status',
  partidas:                 'id, obra_id, estado, deleted_at, sync_status',
  insumos_partida:          'id, obra_id, partida_id, sync_status',
  cronograma:               'id, obra_id, partida_id, sync_status',
  profiles:                 'id, rol',

  // ── Transaccionales ──
  asistencia:               'id, obra_id, personal_id, fecha, sync_status, idempotency_key',
  movimientos_materiales:   'id, obra_id, material_id, fecha, sync_status, idempotency_key',
  movimientos_herramientas: 'id, obra_id, herramienta_id, fecha, sync_status, idempotency_key',
  avance_obra:              'id, obra_id, partida_id, fecha, sync_status, idempotency_key',
  incidencias:              'id, obra_id, estado, sync_status',
  evidencias:               'id, obra_id, modulo_relacionado, registro_relacionado_id, sync_status',
  evidencias_blobs:         'id',

  // ── Control + colas ──
  sync_queue:               '++local_seq, tabla, registro_id, operacion, sync_status, created_at',
  sync_conflicts:           '++local_seq, tabla, registro_id, estado, created_at',
  sync_metadata:            'tabla',
  audit_log_pending:        'id, table_name, record_id, user_id, synced, created_at',
  change_requests_pending:  'id, target_table, target_record_id, requester_id, synced, created_at',
  auth_cache:               'key',
});

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
