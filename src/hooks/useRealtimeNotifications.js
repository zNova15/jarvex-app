import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

// ─── JARVEX Realtime Notifications ────────────────────────────────────────
// Suscribe a cambios en Supabase realtime para tablas críticas.
// Filtra por obra activa cuando aplica (movimientos_*, avance_obra, asistencia,
// incidencias). Los admins reciben además change_requests sin filtro de obra.
// IMPORTANTE: la suscripción se reconstruye cuando cambia profile.id o la obra
// activa (evento 'obra-activa-changed'). Cleanup hace channel.unsubscribe()
// para evitar leaks.
//
// Realtime habilitado en migraciones:
//   006_enable_realtime.sql       → incidencias, materiales, movimientos_materiales, avance_obra
//   010_enable_realtime_extras.sql → movimientos_herramientas, asistencia, change_requests, obra_usuarios
//   013_realtime_master.sql        → obras, materiales, herramientas, personal, proveedores, partidas
//   031_realtime_movimientos_materiales.sql → movimientos_materiales (re-add idempotente)
// ───────────────────────────────────────────────────────────────────────────

// Tablas a las que se les aplica live-sync a Dexie cuando llega un evento
// realtime. Cada cambio que no sea eco del propio user dispara también
// 'jx_data_changed' para que useOfflineData refresque la pantalla.
const LIVE_SYNC_TABLES = [
  // Master
  'obras', 'materiales', 'herramientas', 'personal', 'proveedores', 'partidas',
  // Transaccionales
  'movimientos_materiales', 'movimientos_herramientas', 'asistencia',
  'avance_obra', 'incidencias', 'evidencias',
];

// Backoff para reintentar suscripción si el canal cae
const RECONNECT_DELAYS_MS = [5_000, 10_000, 30_000, 60_000];

export function useRealtimeNotifications() {
  const { profile } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  // Estado del canal: idle (sin suscribir), connecting, connected, error, offline
  const [realtimeStatus, setRealtimeStatus] = useState(
    typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'idle'
  );
  const channelRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const [obraActivaId, setObraActivaId] = useState(
    () => localStorage.getItem('obra_activa_id') || null
  );
  // Ticker para forzar re-suscripción manual (incrementa al pedir reconexión)
  const [resubscribeTick, setResubscribeTick] = useState(0);

  // Re-leer obra activa cuando cambia (mismo tab via custom event, otro tab via storage)
  useEffect(() => {
    const refresh = () => setObraActivaId(localStorage.getItem('obra_activa_id') || null);
    window.addEventListener('obra_activa_change', refresh);
    window.addEventListener('obra-activa-changed', refresh);
    const onStorage = (e) => { if (e.key === 'obra_activa_id') refresh(); };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('obra_activa_change', refresh);
      window.removeEventListener('obra-activa-changed', refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Trackear estado online/offline del browser
  useEffect(() => {
    const onOnline = () => {
      // Al volver online, intentamos reconectar inmediatamente
      reconnectAttemptRef.current = 0;
      setRealtimeStatus('connecting');
      setResubscribeTick(t => t + 1);
    };
    const onOffline = () => setRealtimeStatus('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    if (!profile?.id) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setRealtimeStatus('offline');
      return;
    }

    // Cargar notificaciones leídas/no leídas de localStorage
    const stored = JSON.parse(localStorage.getItem('jarvex_notifs') || '[]');
    setNotifications(stored);
    setUnreadCount(stored.filter(n => !n.leida).length);

    setRealtimeStatus('connecting');

    const isAdmin = profile.rol === 'admin';
    const obraFilter = obraActivaId ? `obra_id=eq.${obraActivaId}` : null;

    // Canal único — nombre incluye obra para que se recree al cambiar de obra
    const channelName = `jarvex-realtime-${profile.id}-${obraActivaId || 'all'}`;
    const channel = supabase.channel(channelName);

    // ── Aplica un cambio remoto a Dexie y notifica a la UI ─────
    // Si es eco del propio user, igual escribimos a Dexie (para que sync_status
    // quede 'synced'), pero NO disparamos jx_data_changed: el componente que
    // hizo el cambio ya actualizó su state local en su flujo de submit.
    const applyLiveSync = async (table, eventType, row) => {
      if (!row?.id) return;
      const isEcho = row.created_by === profile.id || row.updated_by === profile.id;
      try {
        const db = window.__db;
        if (db && db[table]) {
          if (eventType === 'DELETE') {
            await db[table].delete(row.id);
          } else if (row.deleted_at) {
            await db[table].delete(row.id);
          } else {
            await db[table].put({ ...row, sync_status: 'synced', last_synced_at: new Date().toISOString() });
          }
        }
      } catch (e) {
        console.warn('[realtime] live sync', table, e?.message || e);
        return;
      }
      // Disparar eventos UI sólo cuando es cambio remoto (no eco propio)
      if (!isEcho) {
        try {
          window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: table, source: 'realtime', eventType } }));
          window.dispatchEvent(new CustomEvent('jarvex_master_updated', { detail: { table, eventType, row } }));
        } catch {}
      }
    };

    // ── Incidencias (filtradas por obra si hay una activa) ──
    channel.on('postgres_changes',
      { event: '*', schema: 'public', table: 'incidencias', ...(obraFilter ? { filter: obraFilter } : {}) },
      (payload) => {
        const row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old;
        applyLiveSync('incidencias', payload.eventType || payload.event, row);
        if (payload.eventType === 'INSERT' && payload.new?.created_by !== profile.id) {
          addNotif({
            tipo: 'incidencia', icon: 'alert', color: '#E74C3C',
            titulo: 'Nueva incidencia', descripcion: payload.new.descripcion,
            severidad: payload.new.severidad,
          });
        }
      });

    // ── Materiales en estado crítico (catálogo global) ──
    channel.on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'materiales', filter: 'alerta=eq.critico' },
      (payload) => addNotif({
        tipo: 'stock_critico', icon: 'package', color: '#F28C28',
        titulo: 'Material en estado crítico',
        descripcion: `${payload.new.nombre_material} · stock: ${payload.new.stock_actual}`,
      }));

    // ── Movimientos de materiales (filtrados por obra) ──
    channel.on('postgres_changes',
      { event: '*', schema: 'public', table: 'movimientos_materiales', ...(obraFilter ? { filter: obraFilter } : {}) },
      (payload) => {
        const row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old;
        applyLiveSync('movimientos_materiales', payload.eventType || payload.event, row);
        if (payload.eventType === 'INSERT' && payload.new?.created_by !== profile.id) {
          addNotif({
            tipo: 'movimiento', icon: payload.new.tipo_movimiento === 'entrada' ? 'arrowIn' : 'arrowOut',
            color: payload.new.tipo_movimiento === 'entrada' ? '#2ECC71' : '#F28C28',
            titulo: `${payload.new.tipo_movimiento === 'entrada' ? 'Ingreso' : 'Salida'} de material`,
            descripcion: `${payload.new.cantidad} ${payload.new.unidad}`,
          });
        }
      });

    // ── Movimientos de herramientas (filtrados por obra) ──
    channel.on('postgres_changes',
      { event: '*', schema: 'public', table: 'movimientos_herramientas', ...(obraFilter ? { filter: obraFilter } : {}) },
      (payload) => {
        const row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old;
        applyLiveSync('movimientos_herramientas', payload.eventType || payload.event, row);
        if (payload.eventType === 'INSERT' && payload.new?.created_by !== profile.id) {
          addNotif({
            tipo: 'mov_herramienta', icon: 'tool', color: '#F2B705',
            titulo: `${payload.new.tipo_movimiento || 'Movimiento'} de herramienta`,
            descripcion: `Cantidad: ${payload.new.cantidad || 1}`,
          });
        }
      });

    // ── Asistencia (filtrada por obra) ──
    channel.on('postgres_changes',
      { event: '*', schema: 'public', table: 'asistencia', ...(obraFilter ? { filter: obraFilter } : {}) },
      (payload) => {
        const row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old;
        applyLiveSync('asistencia', payload.eventType || payload.event, row);
        if (payload.eventType === 'INSERT' && payload.new?.created_by !== profile.id) {
          addNotif({
            tipo: 'asistencia', icon: 'users', color: '#2ECC71',
            titulo: 'Nueva marca de asistencia',
            descripcion: `Estado: ${payload.new.estado || '—'} · ${payload.new.fecha || ''}`,
          });
        }
      });

    // ── Avance de obra (filtrado por obra) ──
    channel.on('postgres_changes',
      { event: '*', schema: 'public', table: 'avance_obra', ...(obraFilter ? { filter: obraFilter } : {}) },
      (payload) => {
        const row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old;
        applyLiveSync('avance_obra', payload.eventType || payload.event, row);
        if (payload.eventType === 'INSERT' && payload.new?.created_by !== profile.id) {
          addNotif({
            tipo: 'avance', icon: 'hardHat', color: '#F2B705',
            titulo: 'Nuevo avance registrado',
            descripcion: `${payload.new.metrado_ejecutado} ejecutado · semana ${payload.new.semana || ''}`,
          });
        }
      });

    // ── Sincronización LIVE de tablas que NO tienen suscripción específica
    // (las masters puras: obras, materiales, herramientas, personal, proveedores,
    // partidas, evidencias). Las que tienen handler dedicado arriba ya llaman
    // a applyLiveSync internamente.
    const tablasYaCubiertas = new Set([
      'incidencias', 'movimientos_materiales', 'movimientos_herramientas',
      'asistencia', 'avance_obra',
    ]);
    const tablasPendientes = LIVE_SYNC_TABLES.filter(t => !tablasYaCubiertas.has(t));

    for (const tabla of tablasPendientes) {
      try {
        channel.on('postgres_changes',
          { event: '*', schema: 'public', table: tabla },
          (payload) => {
            const row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old;
            applyLiveSync(tabla, payload.eventType || payload.event, row);

            // Notificación visible solo para obra recién creada (lo demás es ruidoso)
            if (tabla === 'obras' && payload.eventType === 'INSERT' && payload.new?.created_by !== profile.id) {
              addNotif({
                tipo: 'obra_nueva', icon: 'building', color: '#3498DB',
                titulo: 'Nueva obra registrada',
                descripcion: payload.new?.nombre_obra || '—',
              });
            }
          });
      } catch (e) {
        console.warn(`[realtime] no se pudo suscribir a ${tabla}:`, e?.message || e);
      }
    }

    // ── Change requests: sólo admins, sin filtro de obra ──
    if (isAdmin) {
      try {
        channel.on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'change_requests' },
          (payload) => {
            if (payload.new.requester_id === profile.id) return;
            addNotif({
              tipo: 'change_request', icon: 'edit', color: '#3498DB',
              titulo: 'Nueva solicitud de cambio',
              descripcion: `${payload.new.target_table}: ${payload.new.reason?.slice(0, 80) || '—'}`,
            });
            try {
              window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'change_requests', source: 'realtime' } }));
            } catch {}
          });
      } catch (e) {
        console.warn('[realtime] change_requests no disponible aún:', e?.message || e);
      }
    }

    // ── Subscribe + reconexión con backoff ──
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        reconnectAttemptRef.current = 0;
        setRealtimeStatus('connected');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        console.warn('[realtime] estado canal:', status);
        setRealtimeStatus('error');
        // Programar reintento con backoff (solo si seguimos online)
        if (typeof navigator === 'undefined' || navigator.onLine) {
          const idx = Math.min(reconnectAttemptRef.current, RECONNECT_DELAYS_MS.length - 1);
          const delay = RECONNECT_DELAYS_MS[idx];
          reconnectAttemptRef.current += 1;
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = setTimeout(() => {
            setRealtimeStatus('connecting');
            setResubscribeTick(t => t + 1);
          }, delay);
        }
      }
    });

    channelRef.current = channel;
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      try { channel.unsubscribe(); } catch (e) {}
      try { supabase.removeChannel(channel); } catch (e) {}
      channelRef.current = null;
    };
  }, [profile?.id, profile?.rol, obraActivaId, resubscribeTick]);

  const addNotif = (n) => {
    const notif = { id: crypto.randomUUID(), ...n, fecha: new Date().toISOString(), leida: false };
    setNotifications(prev => {
      const next = [notif, ...prev].slice(0, 50);
      localStorage.setItem('jarvex_notifs', JSON.stringify(next));
      return next;
    });
    setUnreadCount(c => c + 1);

    try {
      window.dispatchEvent(new CustomEvent('jarvex_new_notif', { detail: notif }));
    } catch (e) {}

    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification('JARVEX', { body: `${n.titulo} — ${n.descripcion}`, icon: '/icons/icon-192.png' });
    }
  };

  const markAllRead = () => {
    setNotifications(prev => {
      const next = prev.map(n => ({ ...n, leida: true }));
      localStorage.setItem('jarvex_notifs', JSON.stringify(next));
      return next;
    });
    setUnreadCount(0);
  };

  const clearAll = () => {
    setNotifications([]);
    setUnreadCount(0);
    localStorage.removeItem('jarvex_notifs');
  };

  const requestPermission = () => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  };

  // Permite a la UI forzar reconexión manual del channel
  const forceReconnect = useCallback(() => {
    reconnectAttemptRef.current = 0;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    setRealtimeStatus('connecting');
    setResubscribeTick(t => t + 1);
  }, []);

  return {
    notifications,
    unreadCount,
    markAllRead,
    clearAll,
    requestPermission,
    realtimeStatus,
    forceReconnect,
  };
}
