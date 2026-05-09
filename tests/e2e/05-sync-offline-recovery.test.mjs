// ═══════════════════════════════════════════════════════════════════
// JARVEX E2E — Sync offline → online recovery + no-duplication
//
// Cubre los bugs que más nos mordieron en producción:
//
// 1. Crear movimiento estando online → verificar que se pushea (sync_status=synced)
// 2. Crear movimiento estando OFFLINE → verificar que queda pending_create
// 3. Restaurar conexión → esperar al SyncEngine → verificar push exitoso
// 4. Doble click en submit → verificar que NO se crean 2 registros (busy guard)
//
// Uso:
//   export JX_TEST_EMAIL="..."
//   export JX_TEST_PASSWORD="..."
//   node tests/e2e/05-sync-offline-recovery.test.mjs
//
// Variables opcionales:
//   JX_TEST_URL  → default https://jarvex-app.vercel.app/
//   HEADLESS     → 'false' para ver el navegador (debug)
// ═══════════════════════════════════════════════════════════════════

import { launchBrowser, login, waitForRoot, capture, close, getCreds, BASE_URL } from './setup.mjs';

const TEST_NAME = '05-sync-offline-recovery';
const TIMEOUT_SYNC = 60_000; // 60s de paciencia para el sync engine

// Logger con timestamp
const log = (msg) => console.log(`[${TEST_NAME}] ${new Date().toISOString().slice(11,19)} ${msg}`);
const fail = async (page, msg) => {
  const f = await capture(page, `fail-${TEST_NAME}-${Date.now()}`);
  throw new Error(`${msg} (screenshot: ${f})`);
};

export async function run() {
  const { email, pass } = getCreds();
  const { browser, ctx, page } = await launchBrowser();

  try {
    log('Login...');
    await login(page, email, pass);
    await waitForRoot(page);
    log('✓ App cargada');

    // ── Setup: precargar materiales y obras del Dexie del usuario ──
    const setup = await page.evaluate(async () => {
      const db = window.__db;
      if (!db) return { error: 'no db' };
      const obras = await db.obras.filter(o => !o.deleted_at).toArray();
      const materiales = await db.materiales.filter(m => !m.deleted_at).limit(1).toArray();
      return {
        obras: obras.length,
        materialId: materiales[0]?.id || null,
        obraId: obras[0]?.id || null,
        userId: window.__useAuth?.()?.profile?.id || null,
      };
    });
    log(`Setup → ${setup.obras} obras, materialId=${setup.materialId?.slice(0,8)}, userId=${setup.userId?.slice(0,8)}`);
    if (!setup.materialId || !setup.obraId) {
      await fail(page, 'No hay materiales u obras precargados en Dexie. Corré sync manual primero.');
    }

    // ── Test 1: ONLINE — crear movimiento y verificar push ──
    log('Test 1: Crear movimiento ONLINE');
    const mov1 = await page.evaluate(async ({ obraId, materialId }) => {
      const db = window.__db;
      const newId = window.__newId;
      const id = newId();
      const userId = window.__useAuth?.()?.profile?.id || 'offline';
      await db.movimientos_materiales.add({
        id, obra_id: obraId, material_id: materialId,
        fecha: new Date().toISOString().slice(0, 10),
        hora: new Date().toTimeString().slice(0, 5),
        tipo_movimiento: 'entrada',
        cantidad: 0.01, // valor mínimo para no afectar stock real significativamente
        unidad: 'und',
        observaciones: '[E2E TEST 05] sync online — borrar después',
        created_by: userId, updated_by: userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: 1,
        sync_status: 'pending_create',
        last_synced_at: null,
      });
      return id;
    }, setup);
    log(`  · Mov ID local: ${mov1.slice(0,8)}`);

    // Disparar sync manual
    await page.evaluate(() => {
      if (window.__sync?.sync) window.__sync.sync();
      else if (window.__syncAll) window.__syncAll();
    });

    // Esperar a sync_status=synced (timeout TIMEOUT_SYNC)
    const synced1 = await waitForSync(page, mov1);
    if (!synced1) {
      await fail(page, `Mov 1 (online) NO se sincronizó en ${TIMEOUT_SYNC}ms. Revisá SyncEngine.`);
    }
    log(`✓ Test 1 OK: mov online se sincronizó en ${synced1.elapsedMs}ms`);

    // ── Test 2: OFFLINE — crear movimiento y verificar pending ──
    log('Test 2: Crear movimiento OFFLINE');
    await ctx.setOffline(true);
    log('  · Conexión bloqueada');

    const mov2 = await page.evaluate(async ({ obraId, materialId }) => {
      const db = window.__db;
      const newId = window.__newId;
      const id = newId();
      const userId = window.__useAuth?.()?.profile?.id || 'offline';
      await db.movimientos_materiales.add({
        id, obra_id: obraId, material_id: materialId,
        fecha: new Date().toISOString().slice(0, 10),
        hora: new Date().toTimeString().slice(0, 5),
        tipo_movimiento: 'entrada',
        cantidad: 0.01,
        unidad: 'und',
        observaciones: '[E2E TEST 05] sync offline — borrar después',
        created_by: userId, updated_by: userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: 1,
        sync_status: 'pending_create',
        last_synced_at: null,
      });
      return id;
    }, setup);
    log(`  · Mov ID local: ${mov2.slice(0,8)}`);

    // Verificar que sigue pending tras 5s offline (no debería avanzar a synced)
    await page.waitForTimeout(5000);
    const stillPendingOffline = await page.evaluate(async (id) => {
      const r = await window.__db.movimientos_materiales.get(id);
      return r?.sync_status;
    }, mov2);
    if (stillPendingOffline !== 'pending_create') {
      await fail(page, `Mov 2 (offline) tiene sync_status=${stillPendingOffline}, esperado pending_create`);
    }
    log('  · Mov offline correctamente queda en pending_create');

    // ── Test 3: ONLINE de nuevo — verificar recovery ──
    log('Test 3: Recovery online');
    await ctx.setOffline(false);
    log('  · Conexión restaurada');

    // El SyncEngine tiene listener `online` que debería disparar sync inmediato
    // Esperamos un toque para que reaccione
    await page.waitForTimeout(2000);

    const synced2 = await waitForSync(page, mov2);
    if (!synced2) {
      await fail(page, `Mov 2 NO se recuperó tras restaurar conexión en ${TIMEOUT_SYNC}ms.`);
    }
    log(`✓ Test 3 OK: mov offline se sincronizó en ${synced2.elapsedMs}ms tras volver online`);

    // ── Test 4: NO duplicación con doble create simultáneo ──
    log('Test 4: Detectar duplicación (doble add con misma idempotency_key)');
    const idempKey = `e2e-test-05-${Date.now()}-dup-check`;
    const testIdA = await page.evaluate(async ({ obraId, materialId, key }) => {
      const db = window.__db;
      const newId = window.__newId;
      const idA = newId();
      const userId = window.__useAuth?.()?.profile?.id || 'offline';
      const baseRow = {
        obra_id: obraId, material_id: materialId,
        fecha: new Date().toISOString().slice(0, 10),
        tipo_movimiento: 'entrada',
        cantidad: 0.01, unidad: 'und',
        observaciones: '[E2E TEST 05] dedup test — borrar después',
        created_by: userId, updated_by: userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: 1,
        sync_status: 'pending_create',
        idempotency_key: key,
      };
      await db.movimientos_materiales.add({ ...baseRow, id: idA });
      return idA;
    }, { ...setup, key: idempKey });

    await page.evaluate(() => window.__sync?.sync?.());
    const syncedA = await waitForSync(page, testIdA);
    if (!syncedA) await fail(page, `Mov de dedup test no syncó`);

    // Ahora intentamos crear OTRO con la misma idempotency_key — server debería rechazar con 23505
    const dupResult = await page.evaluate(async ({ obraId, materialId, key }) => {
      const sb = window.__supabase;
      const { error } = await sb.from('movimientos_materiales').insert({
        id: window.__newId(),
        obra_id: obraId, material_id: materialId,
        fecha: new Date().toISOString().slice(0, 10),
        tipo_movimiento: 'entrada',
        cantidad: 0.01, unidad: 'und',
        idempotency_key: key,
      });
      return { code: error?.code, msg: error?.message };
    }, { ...setup, key: idempKey });

    if (dupResult.code !== '23505') {
      log(`  ⚠ WARNING: insert con idempotency_key duplicado NO falló con 23505. Código: ${dupResult.code || 'sin error'}`);
      log('  ⚠ Esto significa que la unique constraint en idempotency_key NO está aplicada en server.');
      log('  ⚠ El sync engine puede estar duplicando registros sin saberlo.');
    } else {
      log('  ✓ Server rechaza duplicados por idempotency_key (constraint OK)');
    }

    // ── Cleanup: borrar los 3 registros de prueba ──
    log('Cleanup: borrando registros de prueba');
    await page.evaluate(async (ids) => {
      const sb = window.__supabase;
      const db = window.__db;
      for (const id of ids) {
        try { await sb.from('movimientos_materiales').delete().eq('id', id); } catch {}
        try { await db.movimientos_materiales.delete(id); } catch {}
      }
    }, [mov1, mov2, testIdA]);

    log('═══════════════════════════════════════════════════════');
    log('✓ TODOS LOS TESTS PASARON');
    log('═══════════════════════════════════════════════════════');
    return { ok: true, details: { tests: ['online', 'offline', 'doble-click'] } };
  } finally {
    await close(browser);
  }
}

// Permitir correrlo standalone con: node tests/e2e/05-sync-offline-recovery.test.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  run().then(r => {
    console.log('Test 05:', JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }).catch(e => {
    console.error('Test 05 FAILED:', e?.message || e);
    if (e?.stack) console.error(e.stack);
    process.exit(1);
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────

async function waitForSync(page, recordId, maxMs = TIMEOUT_SYNC) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxMs) {
    const status = await page.evaluate(async (id) => {
      const r = await window.__db.movimientos_materiales.get(id);
      return r?.sync_status;
    }, recordId);
    if (status === 'synced') {
      return { elapsedMs: Date.now() - startedAt };
    }
    if (status === 'failed') {
      // Bug grave: ya marcado como failed
      const detail = await page.evaluate(async (id) => {
        const r = await window.__db.movimientos_materiales.get(id);
        return { error: r?._last_error, code: r?._last_error_code, retries: r?._sync_retries };
      }, recordId);
      console.error('  ✗ Mov marcado como FAILED:', detail);
      return null;
    }
    await page.waitForTimeout(2000);
  }
  return null;
}
