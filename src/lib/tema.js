// Tema claro/oscuro de toda la app. Fuente de verdad: localStorage `jx_theme`
// + atributo `data-theme` en <html>. El PRIMER seteo del atributo (anti-FOUC)
// lo hace `public/theme-boot.js`, cargado síncrono desde el <head> — corre
// ANTES de que este módulo (o cualquier import de React) llegue a ejecutarse,
// así que acá solo hace falta mantenerlos sincronizados cuando el usuario
// cambia de tema en caliente.
//
// ⚠ Ese boot NO puede ser un <script> inline: el CSP de vercel.json
// (script-src 'self', sin 'unsafe-inline') lo bloquea en todo deploy. Fue
// exactamente el bug del 1-sep: guardaba el tema pero nunca lo aplicaba.
export const TEMA_KEY = 'jx_theme';

export function getTema() {
  try { return localStorage.getItem(TEMA_KEY) === 'light' ? 'light' : 'dark'; }
  catch { return 'dark'; }
}

export function setTema(t) {
  const val = t === 'light' ? 'light' : 'dark';
  try { localStorage.setItem(TEMA_KEY, val); } catch { /* ignore (privado/bloqueado) */ }
  aplicarTema(val);
}

// Aplica el tema al DOM sin tocar localStorage. Idempotente.
export function aplicarTema(t) {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const val = t === 'light' ? 'light' : 'dark';
  if (val === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  // Barra de estado del móvil / PWA en espejo con el fondo real.
  try {
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', val === 'light' ? '#F4F5F7' : '#0E1620');
  } catch { /* ignore */ }
}

// Lee una CSS var del tema activo en runtime — para Chart.js, que no entiende
// var(--x) y necesita el color ya resuelto al crear cada gráfico.
export function cssVar(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch { return fallback; }
}

if (typeof window !== 'undefined') {
  window.__jxTema = { get: getTema, set: setTema, cssVar };
  // Red de seguridad: si theme-boot.js no llegó a correr (404, red caída, un
  // CSP más estricto mañana), aplicamos igual el tema guardado al cargar este
  // módulo. Es idempotente — en el camino normal el atributo ya está puesto y
  // esto no hace nada. Peor caso: un parpadeo breve, en vez de que el tema
  // quede roto en silencio.
  aplicarTema(getTema());
}
