// ═══════════════════════════════════════════════════════════════════
// JARVEX — Snippet para rescatar materiales/herramientas huérfanos
//
// CONTEXTO: El bug `_last_error` (Sentry JARVEX-APP-4) dejaba records
// en sync_status=FAILED y nunca se pusheaban al server. Otros devices
// no podían verlos. Aunque ya está arreglado en código, los records
// FAILED siguen atrapados localmente.
//
// USO:
//   1. Abrí JARVEX en el browser donde registraste los movs huérfanos.
//   2. Login normal.
//   3. F12 (DevTools) → tab Console.
//   4. Pegá TODO este snippet y dale Enter.
//
// El snippet:
//   - Cuenta cuántos records hay en cada estado por tabla
//   - Resetea los FAILED y PENDING_CREATE a "listo para push"
//   - Dispara un sync manual
//   - Reporta resultados
// ═══════════════════════════════════════════════════════════════════

(async () => {
  const db = window.__db;
  if (!db) {
    console.error('✗ window.__db no disponible. ¿Estás logueado?');
    return;
  }

  const tablas = [
    'materiales', 'herramientas', 'epps',
    'movimientos_materiales', 'movimientos_herramientas', 'movimientos_epp',
    'evidencias', 'incidencias',
    'obras', 'personal', 'proveedores',
    'asistencia', 'avance_obra',
  ];

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('JARVEX — Rescate de records huérfanos');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let totalReseteados = 0;
  const detalle = [];

  for (const t of tablas) {
    if (!db[t]) continue;
    const stats = { synced: 0, pending_create: 0, pending_update: 0, pending_delete: 0, failed: 0, otros: 0 };
    const rows = await db[t].toArray();
    for (const r of rows) {
      const s = r.sync_status || 'otros';
      stats[s] = (stats[s] || 0) + 1;
    }

    if (stats.failed > 0 || stats.pending_create > 0 || stats.pending_update > 0) {
      console.log(`📋 ${t}: ${rows.length} total → ${JSON.stringify(stats)}`);

      // Reset FAILED a estado correcto según operación original
      const failedRecords = rows.filter(r => r.sync_status === 'failed');
      for (const r of failedRecords) {
        // Si _last_error menciona columna inexistente o RLS, igual reseteamos
        // — pushUpdate detecta si existe en server y reroutea a CREATE.
        await db[t].update(r.id, {
          sync_status: 'pending_update',
          _sync_retries: 0,
        });
        totalReseteados++;
      }

      detalle.push({ tabla: t, ...stats, reseteados: failedRecords.length });
    }
  }

  if (totalReseteados === 0) {
    console.log('✓ No hay records FAILED para rescatar.\n');
  } else {
    console.log(`\n✓ ${totalReseteados} records reseteados a pending_update.\n`);
  }

  // Disparar sync ahora
  console.log('▶ Disparando syncAll()...');
  if (typeof window.__syncAll === 'function') {
    try {
      await window.__syncAll();
      console.log('✓ syncAll completado.');
    } catch (e) {
      console.error('✗ syncAll falló:', e?.message);
    }
  } else {
    console.log('⚠ window.__syncAll no expuesto, esperando al próximo ciclo (~30s).');
    window.dispatchEvent(new Event('online'));
  }

  // Re-leer estados después del sync
  await new Promise(r => setTimeout(r, 3000));
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Estado DESPUÉS del rescate:');
  for (const t of tablas) {
    if (!db[t]) continue;
    const rows = await db[t].toArray();
    const stats = { synced: 0, pending_create: 0, pending_update: 0, failed: 0 };
    for (const r of rows) {
      const s = r.sync_status || 'otros';
      stats[s] = (stats[s] || 0) + 1;
    }
    if (stats.pending_create > 0 || stats.pending_update > 0 || stats.failed > 0) {
      console.log(`  ${t}: ${JSON.stringify(stats)}`);
    }
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Si quedan PENDING o FAILED, esperá 60s y volvé a correr este snippet.');
  console.log('Si después de 3 corridas no bajan, hay un problema de RLS o conexión.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
})();
