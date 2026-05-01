// Helper común para tests E2E de JARVEX
// Uso: import { launchBrowser, login, waitForRoot, capture } from './setup.mjs';

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

export const BASE_URL =
  process.env.JX_TEST_URL || 'https://jarvex-app.vercel.app/';

export const SCREENSHOTS_DIR = join(__dirname, '..', 'screenshots');
try { mkdirSync(SCREENSHOTS_DIR, { recursive: true }); } catch {}

/**
 * Lanza un browser Playwright. headless por default.
 * Forzar headed con HEADLESS=false o pasando { headless: false }.
 */
export async function launchBrowser(opts = {}) {
  const headless =
    typeof opts.headless === 'boolean'
      ? opts.headless
      : (process.env.HEADLESS !== 'false');

  const browser = await chromium.launch({
    headless,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'es-PE',
    timezoneId: 'America/Lima',
  });
  const page = await ctx.newPage();

  // Capturar errores de consola y de página para que los tests puedan inspeccionarlos
  page.__consoleErrors = [];
  page.__pageErrors    = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') page.__consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    page.__pageErrors.push(String(err?.stack || err?.message || err));
  });

  return { browser, ctx, page };
}

/**
 * Realiza el flujo completo de login y espera a que el perfil esté disponible.
 */
export async function login(page, email, password) {
  if (!email || !password) {
    throw new Error('login(): faltan credenciales (JX_TEST_EMAIL / JX_TEST_PASSWORD)');
  }

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  // Esperá a que aparezca el LoginScreen (input email visible)
  await page.waitForSelector('input[type="email"]', { timeout: 30000 });

  // Limpiar el valor preset 'admin@jarvex.pe'
  await page.fill('input[type="email"]', '');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);

  // Click en el botón principal del form de login
  // Tiene icono "lock" + texto "Ingresar al Sistema"
  const btn = page.locator('button:has-text("Ingresar al Sistema")').first();
  await btn.click();

  // Esperar a que useAuth tenga profile
  await page.waitForFunction(
    () => {
      try {
        const auth = window.__useAuth?.();
        return !!auth?.profile?.id;
      } catch { return false; }
    },
    { timeout: 30000 }
  );

  // Pequeño wait para que el sync inicial corra
  await page.waitForTimeout(3000);
}

/**
 * Espera a que las globals principales de JARVEX estén disponibles.
 * Devuelve un summary { db, hooks, pagesFound, verno }.
 */
export async function waitForRoot(page, timeout = 30000) {
  await page.waitForFunction(
    () => !!(window.__db && window.__hooks && window.__supabase),
    { timeout }
  );

  return await page.evaluate(() => {
    const pageGlobals = Object.keys(window).filter(k => /Page$/.test(k));
    return {
      hasDb:     !!window.__db,
      hasHooks:  !!window.__hooks,
      hasSupabase: !!window.__supabase,
      verno:     window.__db?.verno ?? null,
      hookKeys:  Object.keys(window.__hooks || {}),
      pageGlobals,
      hasPlame:  typeof window.PlamePage === 'function',
      hasBusqueda: typeof window.BusquedaGlobalPage === 'function',
    };
  });
}

/**
 * Toma screenshot. Devuelve la ruta absoluta.
 */
export async function capture(page, name) {
  const safe = String(name).replace(/[^a-z0-9_-]/gi, '_');
  const file = join(SCREENSHOTS_DIR, `${safe}-${Date.now()}.png`);
  try { await page.screenshot({ path: file, fullPage: true }); } catch {}
  return file;
}

/**
 * Helper de assert con captura automática en caso de fallo.
 */
export async function assert(page, cond, message) {
  if (!cond) {
    const f = await capture(page, `fail-${message}`);
    throw new Error(`Assert failed: ${message}  (screenshot: ${f})`);
  }
}

/**
 * Cierra browser de forma segura.
 */
export async function close(browser) {
  try { await browser?.close(); } catch {}
}

/**
 * Lee credenciales del environment.
 */
export function getCreds() {
  const email = process.env.JX_TEST_EMAIL;
  const pass  = process.env.JX_TEST_PASSWORD;
  if (!email || !pass) {
    console.error('\n[setup] Faltan credenciales: exportá JX_TEST_EMAIL y JX_TEST_PASSWORD');
    console.error('[setup] Ejemplo:');
    console.error('  export JX_TEST_EMAIL="grabieljesusjulcasalazar@gmail.com"');
    console.error('  export JX_TEST_PASSWORD="********"');
    process.exit(2);
  }
  return { email, pass };
}
