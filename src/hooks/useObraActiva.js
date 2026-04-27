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

  // Cargar lista de obras y refrescar periódicamente
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const all = await window.__db.obras.toArray();
        const visibles = all.filter(o => !o.deleted_at);
        if (cancelled) return;
        setObras(visibles);
        // Si no hay obra activa guardada, usar la primera
        const stored = getObraActivaIdSync();
        if (!stored && visibles.length > 0) {
          setObraId(visibles[0].id);
        } else if (stored && !visibles.find(o => o.id === stored) && visibles.length > 0) {
          // La obra guardada ya no existe → fallback a la primera
          setObraId(visibles[0].id);
        } else if (stored) {
          setObraId(stored);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 3000);
    return () => { cancelled = true; clearInterval(interval); };
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
