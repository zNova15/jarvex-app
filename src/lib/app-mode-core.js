// ═══════════════════════════════════════════════════════════════════
// JARVEX — Núcleo PURO del modo de app (prueba/edicion/produccion).
//
// ⚠ ESTE MÓDULO NO DEBE IMPORTAR REACT NI NADA DEL ENTRY. Existe para
// romper un ciclo de chunks que dejaba la app EN BLANCO en arranque frío
// (tras "Clear site data"): getCurrentMode() lo consumen módulos del
// entry (useOfflineData, main) Y páginas lazy → el bundler extraía
// useAppMode a un chunk compartido; como ese chunk importaba React DEL
// ENTRY, el orden de evaluación circular (entry → chunk → entry) llamaba
// al init de React antes de existir → "TypeError: n is not a function"
// → pantalla blanca total. Las funciones puras viven acá; el hook React
// queda en src/hooks/useAppMode.js (solo lo importa main.jsx, inline en
// el entry). Si agregás helpers de modo SIN React, van acá.
// ═══════════════════════════════════════════════════════════════════

const STORAGE_KEY = 'app_mode';
const ROLE_KEY = 'jx_user_role';
export const APP_MODE_STORAGE_KEY = STORAGE_KEY;
export const APP_MODE_EVENT = 'app_mode_change';

// ── Super Admin (edición de fechas históricas) ──
export const SUPER_ADMIN_KEY = 'jx_super_admin';
export const SUPER_ADMIN_EVENT = 'jx_super_admin_change';

export function readSuperAdmin() {
  try {
    if (localStorage.getItem(SUPER_ADMIN_KEY) !== '1') return false;
    // Validar que el rol REAL sea admin (no override). Si no, se ignora.
    const rolReal = localStorage.getItem('jx_user_role_real') || localStorage.getItem(ROLE_KEY) || '';
    return rolReal === 'admin';
  } catch { return false; }
}

// Espejo en window para validar desde código no-React (handlers de edición).
export function isSuperAdminActive() { return readSuperAdmin(); }
if (typeof window !== 'undefined') {
  window.__isSuperAdmin = isSuperAdminActive;
}

// 3 modos (solo admin puede usar 'prueba' y 'edicion'):
//   'prueba'    → muestra SOLO data demo (registros con flag demo:true). Solo admin.
//   'edicion'   → muestra SOLO data real (sin flag demo); permite editar/eliminar. Solo admin.
//   'produccion'→ muestra SOLO data real; bloqueado borrado/edición destructiva. Cualquier rol.
export const MODOS_VALIDOS = new Set(['prueba', 'edicion', 'produccion']);
export const MODOS_ADMIN_ONLY = new Set(['prueba', 'edicion']);

// Migración: antes "prueba" significaba "modo edición sobre data real".
// Ahora es "modo demo separado". Migramos una vez por sesión a 'edicion'.
const MIGRATION_KEY = 'jx_appmode_migrated_v3';
function migrateOnce() {
  try {
    if (localStorage.getItem(MIGRATION_KEY)) return;
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'prueba') localStorage.setItem(STORAGE_KEY, 'edicion');
    localStorage.setItem(MIGRATION_KEY, '1');
  } catch (e) {}
}

export function readUserRole() {
  try { return localStorage.getItem(ROLE_KEY) || ''; }
  catch { return ''; }
}

export function readMode() {
  try {
    migrateOnce();
    const v = localStorage.getItem(STORAGE_KEY);
    const rol = readUserRole();
    const isAdmin = rol === 'admin';
    // Si admin está IMPERSONANDO otro rol (en modo prueba), el rol REAL
    // sigue siendo admin → debe poder mantener modos restringidos. Sin
    // este check, al impersonar como almacenero el modo bajaba a
    // 'produccion' y los datos demo desaparecían (filterByMode filtra
    // solo los registros sin demo).
    let rolReal = rol;
    try { rolReal = localStorage.getItem('jx_user_role_real') || rol; } catch {}
    const isAdminReal = rolReal === 'admin';
    if (MODOS_VALIDOS.has(v)) {
      // Si el modo guardado requiere admin pero ni el rol actual ni el
      // real son admin, forzar 'produccion'.
      if (MODOS_ADMIN_ONLY.has(v) && !isAdmin && !isAdminReal) return 'produccion';
      return v;
    }
  } catch (e) {}
  // Default: admin → edicion, no-admin → produccion
  return readUserRole() === 'admin' ? 'edicion' : 'produccion';
}

// Helper sincrónico para usar en hooks de datos (no-hook)
export function getCurrentMode() { return readMode(); }
