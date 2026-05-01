// Navegación: visita 15 páginas críticas vía hash y verifica render sin errores.
import { launchBrowser, login, waitForRoot, getCreds, close, assert, capture } from './setup.mjs';

const PAGES = [
  'dashboard',
  'materiales',
  'personal',
  'planillas',
  'valorizaciones',
  'requisiciones',
  'ordenes-compra',
  'asistencia',
  'contabilidad',
  'alertas',
  'busqueda',
  'kpis-obra',
  'libro-diario',
  'comparativo-periodos',
  'flujo-proyectado',
];

export async function run() {
  const { email, pass } = getCreds();
  const { browser, page } = await launchBrowser();

  try {
    await login(page, email, pass);
    await waitForRoot(page);

    const failures = [];

    for (const slug of PAGES) {
      // Navegar vía hash. El listener `hashchange` en jx-app.jsx lee el hash y setea page.
      await page.evaluate((s) => {
        window.location.hash = '#/' + s;
      }, slug);

      // Pequeño wait para que React renderice
      await page.waitForTimeout(800);

      // Verificar que NO hay error boundary
      const errBoundary = await page.locator('text=/Algo salió mal|Error inesperado|Application error|Something went wrong/i').count();
      if (errBoundary > 0) {
        await capture(page, `nav-fail-${slug}`);
        failures.push(`[${slug}] error boundary visible`);
        continue;
      }

      // Verificar que el body tiene contenido (no página en blanco)
      const bodyText = await page.evaluate(() => (document.body.innerText || '').length);
      if (bodyText < 50) {
        await capture(page, `nav-empty-${slug}`);
        failures.push(`[${slug}] body casi vacío (${bodyText} chars)`);
        continue;
      }
    }

    const cErrs = page.__consoleErrors.filter(e =>
      !/Failed to load resource.*favicon/i.test(e) &&
      !/DevTools/i.test(e) &&
      !/Manifest.*icon/i.test(e)
    );

    if (cErrs.length > 0) console.log('  [nav] console errors:\n   - ' + cErrs.join('\n   - '));
    if (page.__pageErrors.length > 0) console.log('  [nav] page errors:\n   - ' + page.__pageErrors.join('\n   - '));

    await assert(page, failures.length === 0, `15-páginas-sin-error-boundary (failures: ${failures.join(' | ')})`);
    await assert(page, cErrs.length === 0, `0-console-errors-tras-navegacion (got ${cErrs.length})`);
    await assert(page, page.__pageErrors.length === 0, `0-page-errors-tras-navegacion (got ${page.__pageErrors.length})`);

    return {
      ok: true,
      details: { paginasVisitadas: PAGES.length, fallos: failures.length }
    };
  } finally {
    await close(browser);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then(r => {
    console.log('Navegación test:', JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }).catch(e => {
    console.error('Navegación test FAILED:', e.message);
    process.exit(1);
  });
}
