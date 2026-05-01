// Smoke test: login, dashboard carga, globals expuestos, 0 errores.
import { launchBrowser, login, waitForRoot, getCreds, close, assert } from './setup.mjs';

export async function run() {
  const { email, pass } = getCreds();
  const { browser, page } = await launchBrowser();

  try {
    await login(page, email, pass);
    const root = await waitForRoot(page);

    // 1. Dashboard cargó (no error boundary visible)
    const errBoundary = await page.locator('text=/Algo salió mal|Error inesperado|Application error/i').count();
    await assert(page, errBoundary === 0, 'no-error-boundary-en-dashboard');

    // 2. window.__db.verno === 10
    await assert(page, root.verno === 10, `verno-igual-a-10 (got ${root.verno})`);

    // 3. window.__hooks definido y con varias keys
    await assert(page, root.hasHooks, 'window.__hooks-presente');
    await assert(page, root.hookKeys.length >= 5, `hooks-tienen-keys (got ${root.hookKeys.length})`);

    // 4. Páginas registradas en window — al menos las explícitas (PlamePage, BusquedaGlobalPage, etc.)
    await assert(page, root.hasPlame, 'window.PlamePage-existe');
    await assert(page, root.hasBusqueda, 'window.BusquedaGlobalPage-existe');
    await assert(
      page,
      root.pageGlobals.length >= 5,
      `páginas-registradas-en-window (>= 5, got ${root.pageGlobals.length})`
    );

    // 5. 0 errores de consola / página
    const cErrs = page.__consoleErrors.filter(e =>
      // Filtrar warnings benignos
      !/Failed to load resource.*favicon/i.test(e) &&
      !/DevTools/i.test(e) &&
      !/Manifest.*icon/i.test(e)
    );
    if (cErrs.length > 0) console.log('  [smoke] console errors:\n   - ' + cErrs.join('\n   - '));
    if (page.__pageErrors.length > 0) console.log('  [smoke] page errors:\n   - ' + page.__pageErrors.join('\n   - '));

    await assert(page, cErrs.length === 0, `0-console-errors (got ${cErrs.length})`);
    await assert(page, page.__pageErrors.length === 0, `0-page-errors (got ${page.__pageErrors.length})`);

    return {
      ok: true,
      details: {
        verno: root.verno,
        hooks: root.hookKeys.length,
        pageGlobals: root.pageGlobals.length,
      }
    };
  } finally {
    await close(browser);
  }
}

// Permitir correrlo standalone con: node tests/e2e/01-smoke.test.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  run().then(r => {
    console.log('Smoke test:', JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }).catch(e => {
    console.error('Smoke test FAILED:', e.message);
    process.exit(1);
  });
}
