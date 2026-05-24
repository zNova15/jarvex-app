import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'app_mode';
const ROLE_KEY = 'jx_user_role';
const EVENT_NAME = 'app_mode_change';

// ── Super Admin (edición de fechas históricas) ──
// Toggle que SOLO el admin real puede activar. Desbloquea la edición de
// fechas de movimientos (materiales/herramientas/EPP) y la fecha de
// registro de los insumos. Pensado para cargar registros de días pasados
// al arrancar una obra. Se persiste en localStorage y se refleja en
// window.__superAdmin para módulos no-React.
const SUPER_ADMIN_KEY = 'jx_super_admin';
const SUPER_ADMIN_EVENT = 'jx_super_admin_change';

function readSuperAdmin() {
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
const MODOS_VALIDOS = new Set(['prueba', 'edicion', 'produccion']);
const MODOS_ADMIN_ONLY = new Set(['prueba', 'edicion']);

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

function readUserRole() {
  try { return localStorage.getItem(ROLE_KEY) || ''; }
  catch { return ''; }
}

function readMode() {
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

export function useAppMode() {
  const [mode, setModeState] = useState(readMode);
  const [superAdmin, setSuperAdminState] = useState(readSuperAdmin);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY || e.key === ROLE_KEY || e.key === 'jx_role_override') setModeState(readMode());
      if (e.key === SUPER_ADMIN_KEY || e.key === ROLE_KEY) setSuperAdminState(readSuperAdmin());
    };
    const onCustom = () => setModeState(readMode());
    const onSuper = () => setSuperAdminState(readSuperAdmin());
    window.addEventListener('storage', onStorage);
    window.addEventListener(EVENT_NAME, onCustom);
    window.addEventListener('jx_role_override_change', onCustom);
    window.addEventListener(SUPER_ADMIN_EVENT, onSuper);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(EVENT_NAME, onCustom);
      window.removeEventListener('jx_role_override_change', onCustom);
      window.removeEventListener(SUPER_ADMIN_EVENT, onSuper);
    };
  }, []);

  // Toggle de super admin — solo admin real. Persiste + dispara evento.
  const setSuperAdmin = useCallback((on) => {
    try {
      const rolReal = localStorage.getItem('jx_user_role_real') || readUserRole();
      if (rolReal !== 'admin') return;
      if (on) localStorage.setItem(SUPER_ADMIN_KEY, '1');
      else localStorage.removeItem(SUPER_ADMIN_KEY);
      window.dispatchEvent(new Event(SUPER_ADMIN_EVENT));
      setSuperAdminState(readSuperAdmin());
    } catch {}
  }, []);

  const setMode = useCallback((newMode) => {
    if (!MODOS_VALIDOS.has(newMode)) return;
    // Bloquea: no-admin no puede cambiar a prueba/edicion
    // Para validar usamos el rol REAL (no el override). Si hay override en
    // localStorage, leemos también jx_user_role_real.
    try {
      const rolReal = localStorage.getItem('jx_user_role_real') || readUserRole();
      if (MODOS_ADMIN_ONLY.has(newMode) && rolReal !== 'admin') return;
    } catch {}
    try { localStorage.setItem(STORAGE_KEY, newMode); } catch (e) {}
    // Si salimos de modo prueba → limpiar role override automáticamente
    if (newMode !== 'prueba') {
      try {
        if (localStorage.getItem('jx_role_override')) {
          localStorage.removeItem('jx_role_override');
          // Restaurar el rol real efectivo
          const rolReal = localStorage.getItem('jx_user_role_real');
          if (rolReal) localStorage.setItem('jx_user_role', rolReal);
          window.dispatchEvent(new Event('jx_role_override_change'));
        }
      } catch {}
    }
    setModeState(newMode);
    try { window.dispatchEvent(new Event(EVENT_NAME)); } catch (e) {}
  }, []);

  // Helpers para impersonar rol (solo válido si mode='prueba' y user real es admin)
  const setRoleOverride = useCallback((rol) => {
    try {
      const rolReal = localStorage.getItem('jx_user_role_real');
      if (rolReal !== 'admin') return; // solo admin real puede impersonar
      const m = localStorage.getItem(STORAGE_KEY);
      if (m !== 'prueba') return; // solo en modo prueba
      if (rol && rol !== 'admin') {
        localStorage.setItem('jx_role_override', rol);
        localStorage.setItem('jx_user_role', rol);
      } else {
        localStorage.removeItem('jx_role_override');
        localStorage.setItem('jx_user_role', 'admin');
      }
      window.dispatchEvent(new Event('jx_role_override_change'));
      window.dispatchEvent(new Event('app_mode_change'));
    } catch {}
  }, []);

  const clearRoleOverride = useCallback(() => setRoleOverride(null), [setRoleOverride]);

  const rol = readUserRole();
  const rolReal = (() => { try { return localStorage.getItem('jx_user_role_real') || rol; } catch { return rol; } })();
  const isAdmin = rol === 'admin';
  const isAdminReal = rolReal === 'admin';
  const roleOverride = (() => { try { return localStorage.getItem('jx_role_override') || null; } catch { return null; } })();
  const isImpersonating = !!roleOverride && mode === 'prueba' && isAdminReal;

  return {
    mode,
    setMode,
    isPrueba: mode === 'prueba',
    isEdicion: mode === 'edicion',
    isProduccion: mode === 'produccion',
    canSwitchMode: isAdminReal,
    userRole: rol,
    userRoleReal: rolReal,
    roleOverride,
    isImpersonating,
    setRoleOverride,
    clearRoleOverride,
    // Super Admin (edición de fechas históricas) — solo admin real
    superAdmin: superAdmin && isAdminReal,
    setSuperAdmin,
    canSuperAdmin: isAdminReal,
  };
}

// Helper sincrónico para usar en hooks de datos (no-hook)
export function getCurrentMode() { return readMode(); }
