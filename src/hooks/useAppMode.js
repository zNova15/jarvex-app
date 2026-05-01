import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'app_mode';
const EVENT_NAME = 'app_mode_change';

// 3 modos:
//   'prueba'    → muestra SOLO data demo (registros con flag demo:true)
//   'edicion'   → muestra SOLO data real (sin flag demo); permite editar/eliminar
//   'produccion'→ muestra SOLO data real; bloqueado borrado/edición destructiva
const MODOS_VALIDOS = new Set(['prueba', 'edicion', 'produccion']);

// Migración: antes "prueba" significaba "modo edición sobre data real".
// Ahora es "modo demo separado". Migramos una vez por sesión a 'edicion'
// para conservar el comportamiento previo, salvo que el usuario explícitamente
// haya cambiado a otro modo después de la actualización.
const MIGRATION_KEY = 'jx_appmode_migrated_v3';
function migrateOnce() {
  try {
    if (localStorage.getItem(MIGRATION_KEY)) return;
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'prueba') localStorage.setItem(STORAGE_KEY, 'edicion');
    localStorage.setItem(MIGRATION_KEY, '1');
  } catch (e) {}
}

function readMode() {
  try {
    migrateOnce();
    const v = localStorage.getItem(STORAGE_KEY);
    if (MODOS_VALIDOS.has(v)) return v;
  } catch (e) {}
  return 'edicion';
}

export function useAppMode() {
  const [mode, setModeState] = useState(readMode);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY) setModeState(readMode());
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
    try { localStorage.setItem(STORAGE_KEY, newMode); } catch (e) {}
    setModeState(newMode);
    try { window.dispatchEvent(new Event(EVENT_NAME)); } catch (e) {}
  }, []);

  return {
    mode,
    setMode,
    isPrueba: mode === 'prueba',
    isEdicion: mode === 'edicion',
    isProduccion: mode === 'produccion',
  };
}

// Helper sincrónico para usar en hooks de datos (no-hook)
export function getCurrentMode() { return readMode(); }
