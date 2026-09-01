// Tema claro/oscuro de toda la app. Fuente de verdad: localStorage `jx_theme`
// + atributo `data-theme` en <html>. El PRIMER seteo del atributo (anti-FOUC)
// lo hace un script inline en index.html — corre ANTES de que este módulo (o
// cualquier import de React) llegue a ejecutarse, así que acá solo hace falta
// mantenerlos sincronizados cuando el usuario cambia de tema en caliente.
export const TEMA_KEY = 'jx_theme';

export function getTema() {
  try { return localStorage.getItem(TEMA_KEY) === 'light' ? 'light' : 'dark'; }
  catch { return 'dark'; }
}

export function setTema(t) {
  const val = t === 'light' ? 'light' : 'dark';
  try { localStorage.setItem(TEMA_KEY, val); } catch { /* ignore (privado/bloqueado) */ }
  if (typeof document !== 'undefined' && document.documentElement) {
    if (val === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
  }
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
}
