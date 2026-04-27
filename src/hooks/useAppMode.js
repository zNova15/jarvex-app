import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'app_mode';
const EVENT_NAME = 'app_mode_change';

function readMode() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'prueba' || v === 'produccion') return v;
  } catch (e) {}
  return 'prueba';
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
    if (newMode !== 'prueba' && newMode !== 'produccion') return;
    try { localStorage.setItem(STORAGE_KEY, newMode); } catch (e) {}
    setModeState(newMode);
    try { window.dispatchEvent(new Event(EVENT_NAME)); } catch (e) {}
  }, []);

  return { mode, setMode, isPrueba: mode === 'prueba' };
}
