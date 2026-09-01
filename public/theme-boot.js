/* Anti-FOUC del tema claro: setea data-theme en <html> ANTES del primer paint.
 *
 * ⚠ ESTE ARCHIVO EXISTE POR EL CSP. No lo vuelvas a poner inline en index.html:
 * vercel.json sirve `script-src 'self' 'wasm-unsafe-eval'` (sin 'unsafe-inline'
 * ni nonce/hash), así que un <script> inline queda BLOQUEADO por el navegador
 * en cualquier deploy. En `npm run dev` sí corre —Vite no aplica los headers de
 * vercel.json—, por eso el bug era invisible en local: el tema se guardaba en
 * localStorage y el toggle se veía en "Claro", pero al recargar nunca se
 * aplicaba el atributo y la app volvía a oscuro.
 *
 * Se carga como <script src="/theme-boot.js"></script> SÍNCRONO en el <head>
 * (sin defer/async y sin type="module", que difieren la ejecución hasta después
 * del paint y traerían de vuelta el flash). Fuente de verdad: localStorage
 * `jx_theme`, en espejo con src/lib/tema.js.
 */
(function () {
  try {
    if (localStorage.getItem('jx_theme') === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      var m = document.querySelector('meta[name="theme-color"]');
      if (m) m.setAttribute('content', '#F4F5F7');
    }
  } catch (e) { /* localStorage bloqueado (modo privado): queda el tema oscuro */ }
})();
