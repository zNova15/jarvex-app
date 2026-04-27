import { useState, useEffect, useCallback } from 'react';
import { syncAll, onSyncChange, getPendingCount } from '../sync/SyncEngine';

export function useSync() {
  const [state, setState] = useState({
    syncing: false,
    pending: 0,
    lastSync: null,
    error: null,
  });

  useEffect(() => {
    const unsub = onSyncChange((newState) => setState(s => ({ ...s, ...newState })));

    // Obtener pendientes iniciales
    getPendingCount().then(pending => setState(s => ({ ...s, pending })));

    return unsub;
  }, []);

  const sync = useCallback(() => syncAll(), []);

  return { ...state, sync };
}
