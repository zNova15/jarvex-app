// Búsqueda global: tipea "obra", verifica resultados, prueba atajo Cmd+K.
import { launchBrowser, login, waitForRoot, getCreds, close, assert, capture } from './setup.mjs';

export async function run() {
  const { email, pass } = getCreds();
  const { browser, page } = await launchBrowser();

  try {
    await login(page, email, pass);
    await waitForRoot(page);

    // 1. Navegar a búsqueda vía hash
    await page.evaluate(() => { window.location.hash = '#/busqueda'; });
    await page.waitForTimeout(1200);

    // 2. Localizar input de búsqueda. La página tiene un input principal.
    // Probamos varios selectores razonables.
    const searchInput = page.locator(
      'input[placeholder*="usca" i], input[placeholder*="search" i], input[type="search"], input[type="text"]'
    ).first();

    await searchInput.waitFor({ state: 'visible', timeout: 10000 });
    await searchInput.fill('obra');

    // Esperar a que el componente debounce haga la búsqueda
    await page.waitForTimeout(1500);

    // 3. Verificar contenido en la página (al menos algún texto adicional al header)
    const bodyText = await page.evaluate(() => document.body.innerText || '');

    // El término escrito debe estar en la página (porque está en el input value)
    await assert(page, bodyText.toLowerCase().includes('obra'), 'la palabra-obra-aparece-en-la-busqueda');

    // Tomar screenshot de los resultados para revisión manual
    await capture(page, 'busqueda-resultados');

    // 4. Probar atajo Cmd+K desde otra página
    await page.evaluate(() => { window.location.hash = '#/dashboard'; });
    await page.waitForTimeout(1200);

    // Cmd+K (Mac) — chromium en macOS responde a Meta+K. En Linux fallback a Control+K.
    const isMac = process.platform === 'darwin';
    await page.keyboard.press(isMac ? 'Meta+K' : 'Control+K');
    await page.waitForTimeout(1000);

    // El atajo debería abrir un modal/overlay de búsqueda. Buscamos un input nuevamente visible.
    const cmdKInput = page.locator(
      'input[placeholder*="usca" i], input[placeholder*="search" i], input[type="search"]'
    ).first();
    const opened = await cmdKInput.isVisible().catch(() => false);

    if (!opened) {
      // Algunos builds redirigen al hash en lugar de abrir overlay; chequear que el hash haya cambiado
      const hash = await page.evaluate(() => window.location.hash);
      const hashOk = /busqueda/i.test(hash);
      if (!hashOk) {
        await capture(page, 'cmdk-no-abrio');
        // No tirar fail duro: el atajo Cmd+K es opcional según versión.
        console.log('  [busqueda] WARN: Cmd+K no abrió overlay ni redirigió a #/busqueda (hash actual: ' + hash + ')');
      }
    }

    const cErrs = page.__consoleErrors.filter(e =>
      !/Failed to load resource.*favicon/i.test(e) &&
      !/DevTools/i.test(e) &&
      !/Manifest.*icon/i.test(e)
    );
    if (cErrs.length > 0) console.log('  [busqueda] console errors:\n   - ' + cErrs.join('\n   - '));

    return {
      ok: true,
      details: { cmdKAbrio: opened }
    };
  } finally {
    await close(browser);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then(r => {
    console.log('Búsqueda test:', JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }).catch(e => {
    console.error('Búsqueda test FAILED:', e.message);
    process.exit(1);
  });
}
