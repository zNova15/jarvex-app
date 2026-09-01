import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getTema, setTema, aplicarTema, cambiarTema, tomarPaginaTrasCambioDeTema, TEMA_KEY } from '../tema.js';

const raiz = resolve(__dirname, '../../..');
const leer = (p) => readFileSync(resolve(raiz, p), 'utf8');

// El entorno de vitest de este repo es 'node' (sin jsdom). Stubeamos lo
// mínimo — localStorage y el <html> — en vez de sumar una dependencia.
function stubDom() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  const sesion = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => (sesion.has(k) ? sesion.get(k) : null),
    setItem: (k, v) => sesion.set(k, String(v)),
    removeItem: (k) => sesion.delete(k),
    clear: () => sesion.clear(),
  };
  const attrs = new Map();
  globalThis.document = {
    documentElement: {
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      removeAttribute: (k) => attrs.delete(k),
    },
    querySelector: () => null, // no hay <meta theme-color> en el stub
  };
}

describe('tema — get/set/aplicar', () => {
  beforeEach(() => {
    stubDom();
  });

  it('default es oscuro (sin nada guardado)', () => {
    expect(getTema()).toBe('dark');
  });

  it('setTema("light") guarda y pinta el atributo', () => {
    setTema('light');
    expect(localStorage.getItem(TEMA_KEY)).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(getTema()).toBe('light');
  });

  it('setTema("dark") saca el atributo', () => {
    setTema('light');
    setTema('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe(null);
    expect(getTema()).toBe('dark');
  });

  it('un valor basura cae a oscuro (nunca deja el DOM a medias)', () => {
    setTema('arcoiris');
    expect(getTema()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe(null);
  });

  it('aplicarTema es idempotente y no toca localStorage', () => {
    localStorage.setItem(TEMA_KEY, 'light');
    aplicarTema('light');
    aplicarTema('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem(TEMA_KEY)).toBe('light');
  });
});

// ── Volver a la sección tras el cambio de tema (pedido 1-sep) ────────
// cambiarTema() recarga (los gráficos resuelven color al crearse), y la
// recarga arranca en 'inicio'. Guardamos dónde estabas para restaurarlo.
describe('tema — conservar la sección al recargar', () => {
  let recargas;
  beforeEach(() => {
    stubDom();
    recargas = 0;
    globalThis.window = {
      __pageActual: 'mov-materiales',
      __navPlanoActual: 'obra',
      location: { reload: () => { recargas++; } },
    };
  });

  it('guarda la sección actual y recarga', async () => {
    cambiarTema('light');
    expect(getTema()).toBe('light');
    await new Promise(r => setTimeout(r, 200));
    expect(recargas).toBe(1);
    expect(tomarPaginaTrasCambioDeTema()).toEqual({ page: 'mov-materiales', plano: 'obra' });
  });

  it('se consume UNA sola vez (una segunda carga ya no restaura nada)', async () => {
    cambiarTema('light');
    await new Promise(r => setTimeout(r, 200));   // dejar salir el reload diferido
    expect(tomarPaginaTrasCambioDeTema()).toBeTruthy();
    expect(tomarPaginaTrasCambioDeTema()).toBe(null);
  });

  it('desde el Inicio no guarda nada (ya es la página de arranque)', async () => {
    globalThis.window.__pageActual = 'inicio';
    cambiarTema('light');
    await new Promise(r => setTimeout(r, 200));
    expect(tomarPaginaTrasCambioDeTema()).toBe(null);
  });

  it('elegir el tema que ya está puesto no hace nada', async () => {
    cambiarTema('dark');
    await new Promise(r => setTimeout(r, 200));
    expect(recargas).toBe(0);
    expect(tomarPaginaTrasCambioDeTema()).toBe(null);
  });
});

// ── Regresión del bug del 1-sep ──────────────────────────────────────
// El anti-FOUC vivía como <script> INLINE en index.html. El CSP de
// vercel.json no permite inline (script-src 'self', sin 'unsafe-inline'),
// así que el navegador lo bloqueaba en TODO deploy: el tema se guardaba,
// el toggle mostraba "Claro", pero la app volvía a oscuro al recargar.
// En `npm run dev` no se veía porque Vite no aplica esos headers.
describe('CSP vs. scripts de index.html (regresión 1-sep)', () => {
  const csp = (() => {
    const vercel = JSON.parse(leer('vercel.json'));
    const global = (vercel.headers || []).find(h => h.source === '/(.*)');
    return (global?.headers || []).find(h => h.key === 'Content-Security-Policy')?.value || '';
  })();

  const scriptSrc = csp.split(';').map(s => s.trim()).find(s => s.startsWith('script-src')) || '';

  it('el CSP sigue prohibiendo scripts inline (si esto cambia, revisá el resto)', () => {
    expect(scriptSrc).toBeTruthy();
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it('index.html NO tiene ningún <script> inline: el CSP lo bloquearía', () => {
    const html = leer('index.html');
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/gi)];
    expect(inline.map(m => m[0])).toEqual([]);
  });

  it('el boot del tema se carga como archivo externo y síncrono desde el <head>', () => {
    const html = leer('index.html');
    const tag = html.match(/<script[^>]*src="\/theme-boot\.js"[^>]*>/i);
    expect(tag, 'falta <script src="/theme-boot.js"> en index.html').toBeTruthy();
    // defer/async/type=module correrían DESPUÉS del primer paint → vuelve el flash.
    expect(tag[0]).not.toMatch(/\b(defer|async)\b/i);
    expect(tag[0]).not.toMatch(/type=["']module["']/i);
    expect(html.indexOf(tag[0])).toBeLessThan(html.indexOf('</head>'));
  });

  it('theme-boot.js existe y usa la misma clave de localStorage que tema.js', () => {
    const boot = leer('public/theme-boot.js');
    expect(boot).toContain(TEMA_KEY);
    expect(boot).toContain('data-theme');
  });
});
