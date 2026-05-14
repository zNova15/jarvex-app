import { useState, useEffect, useCallback } from 'react';
import { syncAll, onSyncChange, getPendingCount, getFailedCount } from '../sync/SyncEngine';

export function useSync() {
  const [state, setState] = useState({
    syncing: false,
    pending: 0,
    failed: 0,
    lastSync: null,
    error: null,
  });

  useEffect(() => {
    const unsub = onSyncChange((newState) => setState(s => ({ ...s, ...newState })));

    // Obtener contadores iniciales (pendientes Y failed).
    Promise.all([getPendingCount(), getFailedCount()])
      .then(([pending, failed]) => setState(s => ({ ...s, pending, failed })));

    // Refresh defensivo cada 10s del contador FAILED. SyncEngine emite
    // tras cada tick, pero entre ticks un push puede pasar un record a
    // FAILED localmente; este refresh garantiza que el badge no mienta
    // por más de 10s.
    const interval = setInterval(() => {
      Promise.all([getPendingCount(), getFailedCount()])
        .then(([pending, failed]) => setState(s => ({ ...s, pending, failed })));
    }, 10_000);

    return () => { unsub(); clearInterval(interval); };
  }, []);

  const sync = useCallback(() => syncAll(), []);

  return { ...state, sync };
}
