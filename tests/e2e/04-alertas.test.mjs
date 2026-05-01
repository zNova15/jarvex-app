// Centro de Alertas: carga sin errores y muestra cards de severidad.
import { launchBrowser, login, waitForRoot, getCreds, close, assert, capture } from './setup.mjs';

export async function run() {
  const { email, pass } = getCreds();
  const { browser, page } = await launchBrowser();

  try {
    await login(page, email, pass);
    await waitForRoot(page);

    await page.evaluate(() => { window.location.hash = '#/alertas'; });
    await page.waitForTimeout(1500);

    // Sin error boundary
    const errBoundary = await page.locator('text=/Algo salió mal|Error inesperado|Something went wrong/i').count();
    await assert(page, errBoundary === 0, 'alertas-no-error-boundary');

    // Body con contenido sustantivo
    const bodyText = await page.evaluate(() => document.body.innerText || '');
    await assert(page, bodyText.length > 100, `alertas-body-con-contenido (${bodyText.length} chars)`);

    // Cards de severidad: "Críticas", "Altas", "Medias"
    const tieneCriticas = /Cr[íi]ticas?/i.test(bodyText);
    const tieneAltas    = /\bAltas?\b/i.test(bodyText);
    const tieneMedias   = /\bMedias?\b/i.test(bodyText);

    if (!tieneCriticas || !tieneAltas || !tieneMedias) {
      await capture(page, 'alertas-faltan-severidades');
    }

    await assert(page, tieneCriticas, 'alertas-card-Criticas');
    await assert(page, tieneAltas,    'alertas-card-Altas');
    await assert(page, tieneMedias,   'alertas-card-Medias');

    const cErrs = page.__consoleErrors.filter(e =>
      !/Failed to load resource.*favicon/i.test(e) &&
      !/DevTools/i.test(e) &&
      !/Manifest.*icon/i.test(e)
    );
    if (cErrs.length > 0) console.log('  [alertas] console errors:\n   - ' + cErrs.join('\n   - '));

    await assert(page, page.__pageErrors.length === 0, `alertas-0-page-errors (got ${page.__pageErrors.length})`);

    return {
      ok: true,
      details: { criticas: tieneCriticas, altas: tieneAltas, medias: tieneMedias }
    };
  } finally {
    await close(browser);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then(r => {
    console.log('Alertas test:', JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }).catch(e => {
    console.error('Alertas test FAILED:', e.message);
    process.exit(1);
  });
}
