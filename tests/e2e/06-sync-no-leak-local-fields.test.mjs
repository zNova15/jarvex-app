// ═══════════════════════════════════════════════════════════════════
// JARVEX E2E — Regression test: el SyncEngine NO debe mandar campos
// locales (_*) al server.
//
// Bug original (Sentry JARVEX-APP-4, 2026-05-09):
//   handleSyncError grababa _last_error y _sync_retries en Dexie como
//   metadatos locales. pushUpdate solo strippeaba sync_status y
//   last_synced_at antes de mandar al server. Si un push fallaba, el
//   record quedaba con _last_error dentro y los siguientes reintentos
//   fallaban con PGRST204 "Could not find the '_last_error' column",
//   atrapando el record en FAILED para siempre.
//
// Fix: stripLocalFields() filtra TODOS los campos con prefijo `_`.
//
// Este test simula el escenario:
//   1. Crear un movimiento en Dexie con _last_error y _sync_retries
//      ya seteados (como si hubiera fallado antes).
//   2. Correr el SyncEngine.
//   3. Verificar que el push fue exitoso (sync_status=synced) y NO
//      devolvió PGRST204.
//
// Si alguien refactoriza pushUpdate y vuelve a meter los campos
// locales en el payload, este test FALLA y atrapa la regresión.
// ═══════════════════════════════════════════════════════════════════

import { launchBrowser, login, waitForRoot, capture, close, getCreds } from './setup.mjs';

const TEST_NAME = '06-sync-no-leak-local-fields';
const SYNC_TIMEOUT_MS = 60_000;
const log = (m) => console.log(`[${TEST_NAME}] ${new Date().toISOString().slice(11,19)} ${m}`);

export async function run() {
  const { email, pass } = getCreds();
  const { browser, page } = await launchBrowser();

  try {
    log('Login...');
    await login(page, email, pass);
    await waitForRoot(page);

    // 1. Buscar un material y obra disponibles
    const setup = await page.evaluate(async () => {
      const db = window.__db;
      if (!db) return { error: 'no db' };
      const obras = await db.obras.filter(o => !o.deleted_at).toArray();
      const materiales = await db.materiales.filter(m => !m.deleted_at).limit(1).toArray();
      return {
        obraId: obras[0]?.id || null,
        materialId: materiales[0]?.id || null,
        userId: window.__useAuth?.()?.profile?.id || null,
      };
    });
    if (!setup.obraId || !setup.materialId || !setup.userId) {
      throw new Error('Falta data en Dexie (obras/materiales/user). Corré sync inicial primero.');
    }

    // 2. Crear un movimiento "envenenado" — incluyendo _last_error,
    //    _sync_retries y otros campos locales, simulando un record
    //    que había fallado antes del fix.
    log('Insertando record envenenado con _last_error en Dexie...');
    const insertResult = await page.evaluate(async ({ obraId, materialId, userId }) => {
      const db = window.__db;
      const newId = window.__newId;
      const id = newId();
      await db.movimientos_materiales.add({
        id,
        obra_id: obraId,
        material_id: materialId,
        fecha: new Date().toISOString().slice(0, 10),
        hora: new Date().toTimeString().slice(0, 5),
        tipo_movimiento: 'entrada',
        cantidad: 0.001,
        unidad: 'und',
        observaciones: '[E2E TEST 06] regression _last_error — borrar después',
        created_by: userId,
        updated_by: userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: 1,
        sync_status: 'pending_create',
        // Campos LOCALES — si stripLocalFields los deja pasar al server,
        // PostgREST devolverá PGRST204 y este test falla.
        _last_error: 'simulated previous failure',
        _last_error_code: 'PGRST204',
        _last_error_is_rls: false,
        _sync_retries: 2,
      });
      return { id };
    }, setup);

    log(`Record envenenado insertado: ${insertResult.id.slice(0, 8)}...`);

    // 3. Forzar un sync ahora
    log('Disparando syncAll()...');
    const syncResult = await page.evaluate(async () => {
      try {
        if (typeof window.__syncAll === 'function') {
          await window.__syncAll();
          return { ok: true, method: '__syncAll' };
        }
        // Fallback: emitir evento online para que SyncEngine reaccione
        window.dispatchEvent(new Event('online'));
        await new Promise(r => setTimeout(r, 5000));
        return { ok: true, method: 'online-event' };
      } catch (e) {
        return { ok: false, err: String(e?.message || e) };
      }
    });
    log(`Sync disparado vía ${syncResult.method || syncResult.err}`);

    // 4. Esperar a que el record alcance estado synced (o falle).
    const deadline = Date.now() + SYNC_TIMEOUT_MS;
    let finalState = null;
    while (Date.now() < deadline) {
      finalState = await page.evaluate(async (id) => {
        const r = await window.__db.movimientos_materiales.get(id);
        return r ? {
          sync_status: r.sync_status,
          _last_error_code: r._last_error_code,
          _last_error: r._last_error,
        } : null;
      }, insertResult.id);

      if (!finalState) break; // record borrado → algo raro
      if (finalState.sync_status === 'synced') break;
      if (finalState.sync_status === 'failed') break;
      await page.waitForTimeout(2000);
    }

    log(`Estado final: ${JSON.stringify(finalState)}`);

    // 5. Aserciones del fix
    if (!finalState) {
      await capture(page, 'regression-record-desaparecido');
      throw new Error('El record envenenado desapareció de Dexie sin sincronizarse.');
    }

    // El bug original dejaba _last_error_code === 'PGRST204'
    // mencionando '_last_error' como columna desconocida.
    if (
      finalState.sync_status === 'failed' &&
      finalState._last_error_code === 'PGRST204' &&
      /_[a-z_]+' column/.test(finalState._last_error || '')
    ) {
      await capture(page, 'regression-pgrst204-_last_error');
      throw new Error(
        'REGRESSION: el bug del _last_error volvió. ' +
        `Error: ${finalState._last_error}`
      );
    }

    if (finalState.sync_status !== 'synced') {
      await capture(page, 'regression-no-synced');
      throw new Error(
        `El record no llegó a synced. Estado final: ${finalState.sync_status}, ` +
        `error: ${finalState._last_error || 'ninguno'}`
      );
    }

    // 6. Cleanup: borrar el test record en server (best-effort)
    try {
      await page.evaluate(async (id) => {
        const sb = window.__supabase;
        if (sb) await sb.from('movimientos_materiales').delete().eq('id', id);
        await window.__db.movimientos_materiales.delete(id);
      }, insertResult.id);
      log('✓ Cleanup completado');
    } catch (e) {
      log(`⚠ Cleanup falló: ${e.message} (no crítico)`);
    }

    return {
      ok: true,
      details: {
        recordId: insertResult.id.slice(0, 8),
        finalStatus: finalState.sync_status,
      },
    };
  } finally {
    await close(browser);
  }
}

// Permitir correrlo standalone con: node tests/e2e/06-sync-no-leak-local-fields.test.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  run().then(r => {
    console.log('Test 06:', JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }).catch(e => {
    console.error('Test 06 FAILED:', e.message);
    process.exit(1);
  });
}
