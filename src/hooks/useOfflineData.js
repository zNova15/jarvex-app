import { useState, useEffect, useCallback, useRef } from 'react';
import { db, newId, newIdempotencyKey, SYNC_STATUS } from '../db/jarvex.db';
import { useAuth } from './useAuth';
import { getCurrentMode } from './useAppMode';

// Filtra registros según el modo actual:
//   'prueba'    → solo registros con demo === true
//   'edicion'   → solo registros sin demo (data real)
//   'produccion'→ solo registros sin demo (data real)
function filterByMode(rows) {
  const mode = getCurrentMode();
  if (!Array.isArray(rows)) return rows;
  if (mode === 'prueba') return rows.filter(r => r && r.demo === true);
  return rows.filter(r => !r || !r.demo);
}

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
    const onModeChange = () => refresh();
    window.addEventListener('jx_data_changed', onChange);
    window.addEventListener('jx_sync_pull', refresh);
    window.addEventListener('app_mode_change', onModeChange);
    return () => {
      window.removeEventListener('jx_data_changed', onChange);
      window.removeEventListener('jx_sync_pull', refresh);
      window.removeEventListener('app_mode_change', onModeChange);
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
        // Filtra por modo (prueba/edicion/produccion) — separa data demo de real
        if (!cancelled) setData(filterByMode(result));
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
    // Si estamos en modo prueba, todo lo creado se marca demo:true
    const isPrueba = getCurrentMode() === 'prueba';

    const record = {
      ...fields,
      id,
      created_by: userId,
      updated_by: userId,
      created_at: now,
      updated_at: now,
      version: 1,
      sync_status: isPrueba ? SYNC_STATUS.SYNCED : SYNC_STATUS.PENDING_CREATE,
      last_synced_at: null,
      idempotency_key: fields.idempotency_key ?? newIdempotencyKey(userId, tabla),
      ...(isPrueba ? { demo: true } : {}),
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

export function usePresupuestosVersiones(obra_id) {
  return useOfflineData('presupuestos_versiones', q =>
    obra_id
      ? q.where('obra_id').equals(obra_id).filter(v => !v.deleted_at).toArray()
      : q.filter(v => !v.deleted_at).toArray()
  , [obra_id]);
}

export function usePartidasVersionadas(version_id) {
  return useOfflineData('partidas_versionadas', q =>
    version_id
      ? q.where('version_id').equals(version_id).filter(p => !p.deleted_at).toArray()
      : []
  , [version_id]);
}

export function useMaterialPreciosHistorial(material_id) {
  return useOfflineData('material_precios_historial', q =>
    material_id
      ? q.where('material_id').equals(material_id).filter(p => !p.deleted_at).toArray()
      : q.filter(p => !p.deleted_at).toArray()
  , [material_id]);
}

// ── Contabilidad ─────────────────────────────────────────────────────
export function useCompanies() {
  return useOfflineData('companies', q =>
    q.filter(c => !c.deleted_at).toArray()
  , []);
}

export function useAccountingMovements(company_id) {
  return useOfflineData('accounting_movements', q =>
    company_id
      ? q.where('company_id').equals(company_id).filter(m => !m.deleted_at).toArray()
      : q.filter(m => !m.deleted_at).toArray()
  , [company_id]);
}

export function useIntercompanyTransactions() {
  return useOfflineData('intercompany_transactions', q =>
    q.filter(t => !t.deleted_at).toArray()
  , []);
}

// ── Compras ──────────────────────────────────────────────────────────
export function useRequisiciones(obra_id) {
  return useOfflineData('requisiciones', q =>
    obra_id
      ? q.where('obra_id').equals(obra_id).filter(r => !r.deleted_at).toArray()
      : q.filter(r => !r.deleted_at).toArray()
  , [obra_id]);
}

export function useOrdenesCompra(obra_id) {
  return useOfflineData('ordenes_compra', q =>
    obra_id
      ? q.where('obra_id').equals(obra_id).filter(o => !o.deleted_at).toArray()
      : q.filter(o => !o.deleted_at).toArray()
  , [obra_id]);
}

// ── Valorizaciones ──────────────────────────────────────────────────
export function useValorizaciones(obra_id) {
  return useOfflineData('valorizaciones', q =>
    obra_id
      ? q.where('obra_id').equals(obra_id).filter(v => !v.deleted_at).toArray()
      : q.filter(v => !v.deleted_at).toArray()
  , [obra_id]);
}

// ── Tesorería ───────────────────────────────────────────────────────
export function useCuentasBancarias(company_id) {
  return useOfflineData('cuentas_bancarias', q =>
    company_id
      ? q.where('company_id').equals(company_id).filter(c => !c.deleted_at).toArray()
      : q.filter(c => !c.deleted_at).toArray()
  , [company_id]);
}

export function useCronogramaPagos(company_id) {
  return useOfflineData('cronograma_pagos', q =>
    company_id
      ? q.where('company_id').equals(company_id).filter(p => !p.deleted_at).toArray()
      : q.filter(p => !p.deleted_at).toArray()
  , [company_id]);
}

export function useMovimientosBancarios(cuenta_id) {
  return useOfflineData('movimientos_bancarios', q =>
    cuenta_id
      ? q.where('cuenta_id').equals(cuenta_id).filter(m => !m.deleted_at).toArray()
      : q.filter(m => !m.deleted_at).toArray()
  , [cuenta_id]);
}

// ── Activos pesados ─────────────────────────────────────────────────
export function useActivosPesados() {
  return useOfflineData('activos_pesados', q =>
    q.filter(a => !a.deleted_at).toArray()
  , []);
}

export function useHorasMaquina(activo_id) {
  return useOfflineData('horas_maquina', q =>
    activo_id
      ? q.where('activo_id').equals(activo_id).filter(h => !h.deleted_at).toArray()
      : q.filter(h => !h.deleted_at).toArray()
  , [activo_id]);
}

// ── SSOMA ───────────────────────────────────────────────────────────
export function useCharlasSeguridad(obra_id) {
  return useOfflineData('charlas_seguridad', q =>
    obra_id
      ? q.where('obra_id').equals(obra_id).filter(c => !c.deleted_at).toArray()
      : q.filter(c => !c.deleted_at).toArray()
  , [obra_id]);
}

export function useIperc(obra_id) {
  return useOfflineData('iperc', q =>
    obra_id
      ? q.where('obra_id').equals(obra_id).filter(i => !i.deleted_at).toArray()
      : q.filter(i => !i.deleted_at).toArray()
  , [obra_id]);
}

export function useEppEntregas(obra_id) {
  return useOfflineData('epp_entregas', q =>
    obra_id
      ? q.where('obra_id').equals(obra_id).filter(e => !e.deleted_at).toArray()
      : q.filter(e => !e.deleted_at).toArray()
  , [obra_id]);
}

export function useInspeccionesSeguridad(obra_id) {
  return useOfflineData('inspecciones_seguridad', q =>
    obra_id
      ? q.where('obra_id').equals(obra_id).filter(i => !i.deleted_at).toArray()
      : q.filter(i => !i.deleted_at).toArray()
  , [obra_id]);
}

export function useCapacitaciones(obra_id) {
  return useOfflineData('capacitaciones', q =>
    obra_id
      ? q.where('obra_id').equals(obra_id).filter(c => !c.deleted_at).toArray()
      : q.filter(c => !c.deleted_at).toArray()
  , [obra_id]);
}

// ── Subcontratos ────────────────────────────────────────────────────
export function useSubcontratistas() {
  return useOfflineData('subcontratistas', q => q.filter(s => !s.deleted_at).toArray(), []);
}

export function useSubcontratos(obra_id) {
  return useOfflineData('subcontratos', q =>
    obra_id
      ? q.where('obra_id').equals(obra_id).filter(s => !s.deleted_at).toArray()
      : q.filter(s => !s.deleted_at).toArray()
  , [obra_id]);
}

export function useSubcontratoValorizaciones(subcontrato_id) {
  return useOfflineData('subcontrato_valorizaciones', q =>
    subcontrato_id
      ? q.where('subcontrato_id').equals(subcontrato_id).filter(v => !v.deleted_at).toArray()
      : q.filter(v => !v.deleted_at).toArray()
  , [subcontrato_id]);
}

// ── Planillas ───────────────────────────────────────────────────────
export function usePersonalContrato(personal_id) {
  return useOfflineData('personal_contrato', q =>
    personal_id
      ? q.where('personal_id').equals(personal_id).filter(p => !p.deleted_at).toArray()
      : q.filter(p => !p.deleted_at).toArray()
  , [personal_id]);
}

export function usePlanillas(obra_id) {
  return useOfflineData('planillas', q =>
    obra_id
      ? q.where('obra_id').equals(obra_id).filter(p => !p.deleted_at).toArray()
      : q.filter(p => !p.deleted_at).toArray()
  , [obra_id]);
}

export function usePlanillaBoletas(planilla_id) {
  return useOfflineData('planilla_boletas', q =>
    planilla_id
      ? q.where('planilla_id').equals(planilla_id).filter(b => !b.deleted_at).toArray()
      : q.filter(b => !b.deleted_at).toArray()
  , [planilla_id]);
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
