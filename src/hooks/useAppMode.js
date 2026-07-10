// ═══════════════════════════════════════════════════════════════════
// JARVEX — Hook React del modo de app (prueba/edicion/produccion).
//
// ⚠ La lógica pura (getCurrentMode, readMode, super admin, migración)
// vive en src/lib/app-mode-core.js — SIN React. NO la muevas de vuelta
// acá: este hook usa React y solo lo importa main.jsx (inline en el
// entry); si un módulo compartido entry+lazy importara React del entry
// se re-crea el ciclo de chunks que dejaba la app EN BLANCO en arranque
// frío ("TypeError: n is not a function"). Los consumidores de solo
// getCurrentMode/isSuperAdminActive deben importar de app-mode-core.
// ═══════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback } from 'react';
import {
  readMode, readSuperAdmin, readUserRole,
  MODOS_VALIDOS, MODOS_ADMIN_ONLY,
  APP_MODE_STORAGE_KEY as STORAGE_KEY, APP_MODE_EVENT as EVENT_NAME,
  SUPER_ADMIN_KEY, SUPER_ADMIN_EVENT,
} from '../lib/app-mode-core.js';

// Re-export de compatibilidad (código viejo importaba esto desde acá).
export { getCurrentMode, isSuperAdminActive } from '../lib/app-mode-core.js';

const ROLE_KEY = 'jx_user_role';

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
