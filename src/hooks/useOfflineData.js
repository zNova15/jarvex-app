import { useState, useEffect, useCallback, useRef } from 'react';
import { db, newId, newIdempotencyKey, SYNC_STATUS } from '../db/jarvex.db';
import { useAuth } from './useAuth';

// ── Hook genérico para CRUD offline-first ────────────────────────────
// Lee de Dexie, escribe a Dexie + encola para sync
// `deps` se usa para re-fetch cuando cambien (ej: obra_id)

export function useOfflineData(tabla, queryFn = null, deps = []) {
  const { profile } = useAuth();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  // Guardar queryFn más reciente sin re-disparar el efecto
  const queryFnRef = useRef(queryFn);
  queryFnRef.current = queryFn;

  const refresh = useCallback(() => setTick(t => t + 1), []);

  // Refresh externo: importaciones masivas y sync remoto disparan
  // 'jx_data_changed' (con detail.tabla) o 'jx_sync_pull' (sin detail).
  useEffect(() => {
    const onChange = (e) => {
      const t = e?.detail?.tabla;
      if (!t || t === tabla) refresh();
    };
    window.addEventListener('jx_data_changed', onChange);
    window.addEventListener('jx_sync_pull', refresh);
    return () => {
      window.removeEventListener('jx_data_changed', onChange);
      window.removeEventListener('jx_sync_pull', refresh);
    };
  }, [tabla, refresh]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const fn = queryFnRef.current;
    (async () => {
      try {
        const query = db[tabla];
        const result = fn ? await fn(query) : await query.toArray();
        if (!cancelled) setData(result);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabla, tick, ...deps]);

  // ── Crear registro ────────────────────────────────────────────────

  const create = useCallback(async (fields) => {
    const now = new Date().toISOString();
    const id = newId();
    const userId = profile?.id ?? 'offline';

    const record = {
      ...fields,
      id,
      created_by: userId,
      updated_by: userId,
      created_at: now,
      updated_at: now,
      version: 1,
      sync_status: SYNC_STATUS.PENDING_CREATE,
      last_synced_at: null,
      idempotency_key: fields.idempotency_key ?? newIdempotencyKey(userId, tabla),
    };

    await db[tabla].add(record);
    await refresh();
    return record;
  }, [tabla, profile, refresh]);

  // ── Actualizar registro ───────────────────────────────────────────

  const update = useCallback(async (id, fields) => {
    const now = new Date().toISOString();
    const existing = await db[tabla].get(id);
    if (!existing) throw new Error(`Registro ${id} no encontrado en ${tabla}`);

    const wasAlreadyPending = existing.sync_status === SYNC_STATUS.PENDING_CREATE;

    await db[tabla].update(id, {
      ...fields,
      updated_by: profile?.id ?? 'offline',
      updated_at: now,
      version: (existing.version ?? 0) + 1,
      sync_status: wasAlreadyPending ? SYNC_STATUS.PENDING_CREATE : SYNC_STATUS.PENDING_UPDATE,
    });

    await refresh();
  }, [tabla, profile, refresh]);

  // ── Eliminar registro (soft delete) ──────────────────────────────

  const remove = useCallback(async (id) => {
    const existing = await db[tabla].get(id);
    if (!existing) return;

    if (existing.sync_status === SYNC_STATUS.PENDING_CREATE) {
      // Nunca llegó al servidor → borrar directamente
      await db[tabla].delete(id);
    } else {
      await db[tabla].update(id, {
        deleted_at: new Date().toISOString(),
        sync_status: SYNC_STATUS.PENDING_DELETE,
      });
    }

    await refresh();
  }, [tabla, refresh]);

  return { data, loading, refresh, create, update, remove };
}

// ── Hooks específicos por módulo ──────────────────────────────────────

export function useObras() {
  return useOfflineData('obras', q => q.filter(o => !o.deleted_at).toArray(), []);
}

export function usePersonal(obra_id) {
  return useOfflineData('personal', q =>
    obra_id
      ? q.where('obra_id').equals(obra_id).filter(p => !p.deleted_at).toArray()
      : q.filter(p => !p.deleted_at).toArray()
  , [obra_id]);
}

export function useMateriales(obra_id) {
  return useOfflineData('materiales', q =>
    obra_id
      ? q.where('obra_id').equals(obra_id).filter(m => !m.deleted_at).toArray()
      : q.filter(m => !m.deleted_at).toArray()
  , [obra_id]);
}

export function useHerramientas(obra_id) {
  return useOfflineData('herramientas', q =>
    obra_id
      ? q.where('obra_id').equals(obra_id).filter(h => !h.deleted_at).toArray()
      : q.filter(h => !h.deleted_at).toArray()
  , [obra_id]);
}

export function useMovimientosMateriales(obra_id) {
  return useOfflineData('movimientos_materiales', q =>
    obra_id ? q.where('obra_id').equals(obra_id).toArray() : q.toArray()
  , [obra_id]);
}

export function useMovimientosHerramientas(obra_id) {
  return useOfflineData('movimientos_herramientas', q =>
    obra_id ? q.where('obra_id').equals(obra_id).toArray() : q.toArray()
  , [obra_id]);
}

export function useAsistencia(obra_id) {
  return useOfflineData('asistencia', q =>
    obra_id ? q.where('obra_id').equals(obra_id).toArray() : q.toArray()
  , [obra_id]);
}

export function usePartidas(obra_id) {
  return useOfflineData('partidas', q =>
    obra_id
      ? q.where('obra_id').equals(obra_id).filter(p => !p.deleted_at).toArray()
      : q.filter(p => !p.deleted_at).toArray()
  , [obra_id]);
}

export function useAvanceObra(obra_id) {
  return useOfflineData('avance_obra', q =>
    obra_id ? q.where('obra_id').equals(obra_id).toArray() : q.toArray()
  , [obra_id]);
}

export function useIncidencias(obra_id) {
  return useOfflineData('incidencias', q =>
    obra_id ? q.where('obra_id').equals(obra_id).toArray() : q.toArray()
  , [obra_id]);
}

export function useEvidencias(obra_id) {
  return useOfflineData('evidencias', q =>
    obra_id ? q.where('obra_id').equals(obra_id).toArray() : q.toArray()
  , [obra_id]);
}

export function useConflicts() {
  const [conflicts, setConflicts] = useState([]);

  useEffect(() => {
    db.sync_conflicts
      .where('estado').equals('pendiente')
      .toArray()
      .then(setConflicts);
  }, []);

  return conflicts;
}
