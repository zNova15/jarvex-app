import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'app_mode';
const ROLE_KEY = 'jx_user_role';
const EVENT_NAME = 'app_mode_change';

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
    if (MODOS_VALIDOS.has(v)) {
      // Si el modo guardado requiere admin pero el rol actual no lo es,
      // forzar 'produccion'. NO sobrescribimos localStorage aquí — eso
      // podría perder el modo del admin si el rol no se carga aún.
      if (MODOS_ADMIN_ONLY.has(v) && !isAdmin) return 'produccion';
      return v;
    }
  } catch (e) {}
  // Default: admin → edicion, no-admin → produccion
  return readUserRole() === 'admin' ? 'edicion' : 'produccion';
}

export function useAppMode() {
  const [mode, setModeState] = useState(readMode);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY || e.key === ROLE_KEY) setModeState(readMode());
    };
    const onCustom = () => setModeState(readMode());
    window.addEventListener('storage', onStorage);
    window.addEventListener(EVENT_NAME, onCustom);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(EVENT_NAME, onCustom);
    };
  }, []);

  const setMode = useCallback((newMode) => {
    if (!MODOS_VALIDOS.has(newMode)) return;
    // Bloquea: no-admin no puede cambiar a prueba/edicion
    if (MODOS_ADMIN_ONLY.has(newMode) && readUserRole() !== 'admin') return;
    try { localStorage.setItem(STORAGE_KEY, newMode); } catch (e) {}
    setModeState(newMode);
    try { window.dispatchEvent(new Event(EVENT_NAME)); } catch (e) {}
  }, []);

  const rol = readUserRole();
  const isAdmin = rol === 'admin';

  return {
    mode,
    setMode,
    isPrueba: mode === 'prueba',
    isEdicion: mode === 'edicion',
    isProduccion: mode === 'produccion',
    canSwitchMode: isAdmin,
    userRole: rol,
  };
}

// Helper sincrónico para usar en hooks de datos (no-hook)
export function getCurrentMode() { return readMode(); }
