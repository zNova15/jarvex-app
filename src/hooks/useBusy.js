// ═══════════════════════════════════════════════════════════════════
// JARVEX — useBusy
//
// Hook reusable para evitar doble submit en handlers async. Wrappea
// cualquier handler para que mientras está corriendo el botón quede
// disabled, y libera el flag siempre via try/finally — incluso si el
// handler tira excepción.
//
// Incluye un timeout de seguridad: si el handler nunca resuelve (ej:
// fetch que cuelga sin reject), libera el flag a los 30s para que el
// botón no quede bloqueado para siempre.
//
// Uso típico:
//
//   const [busy, runBusy] = useBusy();
//   const handleSubmit = runBusy(async () => {
//     await api.guardar(...);
//     showToast('Guardado');
//   });
//
//   <button disabled={busy} onClick={handleSubmit}>
//     {busy ? 'Guardando…' : 'Guardar'}
//   </button>
//
// Alternativa: control manual de las fases (pre-validación, etc):
//
//   const [busy, , setBusy] = useBusy();
//   const handleSubmit = async () => {
//     if (busy) return; // doble click guard
//     if (!validar()) return;
//     setBusy(true);
//     try { await api.guardar(...); }
//     finally { setBusy(false); }
//   };
// ═══════════════════════════════════════════════════════════════════
import { useState, useRef, useCallback, useEffect } from 'react';

const DEFAULT_TIMEOUT_MS = 30_000;

export function useBusy(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const [busy, setBusyState] = useState(false);
  const safetyTimerRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (safetyTimerRef.current) {
        clearTimeout(safetyTimerRef.current);
        safetyTimerRef.current = null;
      }
    };
  }, []);

  const setBusy = useCallback((value) => {
    if (!mountedRef.current) return;
    if (safetyTimerRef.current) {
      clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }
    setBusyState(value);
    if (value) {
      // Si el handler no termina en timeoutMs, liberar el flag para que el
      // botón no quede bloqueado eternamente. Útil para fetch que cuelga.
      safetyTimerRef.current = setTimeout(() => {
        if (mountedRef.current) {
          console.warn('[useBusy] timeout safety triggered after', timeoutMs, 'ms — liberando flag');
          setBusyState(false);
        }
        safetyTimerRef.current = null;
      }, timeoutMs);
    }
  }, [timeoutMs]);

  // runBusy: wrapper para handlers async. Devuelve una función que se
  // puede pasar directo a onClick. Si está busy, ignora el click.
  const runBusy = useCallback((handler) => {
    return async (...args) => {
      if (busy) return; // doble click guard — el primer click sigue ganando
      setBusy(true);
      try {
        return await handler(...args);
      } finally {
        if (mountedRef.current) setBusy(false);
      }
    };
  }, [busy, setBusy]);

  return [busy, runBusy, setBusy];
}
