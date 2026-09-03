import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'obra_activa_id';
const EVT_NAME = 'obra_activa_change';

// Helper standalone para que cualquier código (ej. legacy en window) pueda
// resolver la obra activa actual sin pasar por React.
export function getObraActivaIdSync() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

export function setObraActivaId(id) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent(EVT_NAME, { detail: { id } }));
  } catch {}
}

// Hook centralizado: retorna { obraId, obra, obras, setObraActiva, loading }
export function useObraActiva() {
  const [obras, setObras] = useState([]);
  const [obraId, setObraId] = useState(() => getObraActivaIdSync());
  const [loading, setLoading] = useState(true);

  // Cargar lista de obras. Antes hacía polling cada 3s — N componentes
  // usando el hook = N × queries cada 3s. Ahora reactivo a eventos:
  //  · jx_data_changed (tabla='obras') cuando otro proceso escribe
  //  · jx_sync_pull cuando SyncEngine trae nuevas obras
  //  · jarvex_master_updated (legacy)
  // Fallback de 60s para casos edge.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (cancelled) return;
      // AISLAMIENTO POR OBRA (tanda 2D): mientras no sepamos qué obras tiene
      // designadas el usuario, NO se lista ninguna y el hook queda en loading.
      // Antes se leía `?? null` = sin restricción, así que en cada arranque
      // había una ventana en la que un almacenero veía todas las obras del
      // grupo (bug reportado por Gabriel, 3-sep-2026). El flag lo mantiene
      // main.jsx, que vuelve a disparar 'obras_permitidas_change' al resolver.
      // Va ANTES del try a propósito: el finally apagaría el loading.
      if (window.__obrasPermitidasCargando) return;
      try {
        const all = await window.__db.obras.toArray();
        // null = rol global (ve todas). Un Set (aunque esté vacío) restringe.
        const permitidas = window.__obrasPermitidas === undefined ? new Set() : window.__obrasPermitidas;
        const visibles = all.filter(o => !o.deleted_at && (!permitidas || permitidas.has(o.id)));
        if (cancelled) return;
        setObras(visibles);
        const stored = getObraActivaIdSync();
        if (!stored && visibles.length > 0) {
          // Persistimos: si solo guardamos el state local, otros consumers
          // (window.__getObraActivaId, captura mágica, etc.) leen null.
          setObraActivaId(visibles[0].id);
          setObraId(visibles[0].id);
        } else if (stored && !visibles.find(o => o.id === stored) && visibles.length > 0) {
          setObraActivaId(visibles[0].id);
          setObraId(visibles[0].id);
        } else if (stored) {
          setObraId(stored);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const onChange = (e) => {
      const t = e?.detail?.tabla;
      if (!t || t === 'obras') load();
    };
    window.addEventListener('jx_data_changed', onChange);
    window.addEventListener('jx_sync_pull', load);
    window.addEventListener('jarvex_master_updated', load);
    window.addEventListener('obras_permitidas_change', load);
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.removeEventListener('jx_data_changed', onChange);
      window.removeEventListener('jx_sync_pull', load);
      window.removeEventListener('jarvex_master_updated', load);
      window.removeEventListener('obras_permitidas_change', load);
      clearInterval(interval);
    };
  }, []);

  // Escuchar cambios de obra activa emitidos por el header u otros componentes
  useEffect(() => {
    const onChange = (e) => {
      const newId = e?.detail?.id ?? getObraActivaIdSync();
      setObraId(newId);
    };
    window.addEventListener(EVT_NAME, onChange);
    return () => window.removeEventListener(EVT_NAME, onChange);
  }, []);

  const setObraActiva = useCallback((id) => {
    setObraActivaId(id);
    setObraId(id);
  }, []);

  const obra = obras.find(o => o.id === obraId) || null;

  return { obraId, obra, obras, setObraActiva, loading };
}
