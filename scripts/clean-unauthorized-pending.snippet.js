// ═══════════════════════════════════════════════════════════════════
// JARVEX — Snippet para limpiar records pending_create de tablas que
// el rol del user actual NO puede pushear (RLS los rechaza).
//
// Ejecutar UNA VEZ en la consola del browser del almacenero.
// Marca los records como 'synced' (en realidad ya están en server,
// vinieron por el pull masivo) para que el SyncEngine deje de
// intentar pushearlos.
//
// USO: F12 → Console → pegar este código → Enter.
// ═══════════════════════════════════════════════════════════════════
(async () => {
  const db = window.__db;
  if (!db) { console.error('window.__db no disponible'); return; }

  const auth = window.__useAuth?.();
  const rol = auth?.profile?.rol;
  console.log(`[cleanup] rol actual: ${rol}`);
  if (rol === 'admin') {
    console.log('[cleanup] sos admin, no se necesita limpieza.');
    return;
  }

  // Tablas cuyo write requiere permiso que el almacenero NO tiene
  // (según la matriz RLS-033). Si el record local está en pending_create
  // o pending_update, lo marcamos synced — viene del pull masivo, ya
  // está en server, no hay que pushearlo.
  const tablasBloqueadas = [
    'partidas', 'insumos_partida',
    'partidas_versionadas', 'insumos_partida_versionadas',
    'presupuestos_versiones', 'cronograma',
    'planillas', 'planilla_boletas', 'personal_contrato',
    'cuentas_bancarias', 'movimientos_bancarios', 'cronograma_pagos',
    'accounting_movements', 'intercompany_transactions',
    'companies', 'subcontratos', 'subcontrato_valorizaciones',
    'valorizaciones', 'valorizacion_partidas', 'valorizacion_adicionales',
    'iperc', 'inspecciones_seguridad', 'capacitaciones',
    'charlas_seguridad', 'charla_asistentes',
  ];

  let total = 0;
  for (const t of tablasBloqueadas) {
    if (!db[t]) continue;
    try {
      const pendientes = await db[t]
        .filter(r => r.sync_status === 'pending_create' ||
                     r.sync_status === 'pending_update' ||
                     r.sync_status === 'failed')
        .toArray();
      if (pendientes.length === 0) continue;
      console.log(`  ${t}: ${pendientes.length} pendientes → marcando synced`);
      for (const r of pendientes) {
        await db[t].update(r.id, {
          sync_status: 'synced',
          _sync_retries: 0,
          _last_error: null,
          _last_error_code: null,
        });
        total++;
      }
    } catch (e) {
      console.warn(`  ${t} falló: ${e.message}`);
    }
  }

  console.log(`\n[cleanup] ✓ ${total} records limpiados. El SyncEngine ya no intentará pushearlos.`);
  console.log('Refrescá la app para confirmar.');
})();
