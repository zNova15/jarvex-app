import { useEffect, useRef, useState } from 'react';
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
// ───────────────────────────────────────────────────────────────────────────

export function useRealtimeNotifications() {
  const { profile } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const channelRef = useRef(null);
  const [obraActivaId, setObraActivaId] = useState(
    () => localStorage.getItem('obra_activa_id') || null
  );

  // Re-leer obra activa cuando cambia (mismo tab via custom event, otro tab via storage)
  useEffect(() => {
    const refresh = () => setObraActivaId(localStorage.getItem('obra_activa_id') || null);
    // Escucha ambos nombres por compat: el oficial dispatched por useObraActiva
    // es 'obra_activa_change' (underscore). 'obra-activa-changed' (dash) se
    // mantiene como alias por si algún flujo legado lo emite.
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

  useEffect(() => {
    if (!profile?.id) return;

    // Cargar notificaciones leídas/no leídas de localStorage
    const stored = JSON.parse(localStorage.getItem('jarvex_notifs') || '[]');
    setNotifications(stored);
    setUnreadCount(stored.filter(n => !n.leida).length);

    const isAdmin = profile.rol === 'admin';
    const obraFilter = obraActivaId ? `obra_id=eq.${obraActivaId}` : null;

    // Canal único — nombre incluye obra para que se recree al cambiar de obra
    const channelName = `jarvex-realtime-${profile.id}-${obraActivaId || 'all'}`;
    const channel = supabase.channel(channelName);

    // ── Incidencias (filtradas por obra si hay una activa) ──
    channel.on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'incidencias', ...(obraFilter ? { filter: obraFilter } : {}) },
      (payload) => addNotif({
        tipo: 'incidencia', icon: 'alert', color: '#E74C3C',
        titulo: 'Nueva incidencia', descripcion: payload.new.descripcion,
        severidad: payload.new.severidad,
      }));

    // ── Materiales en estado crítico (no se filtra por obra: materiales son del catálogo global) ──
    channel.on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'materiales', filter: 'alerta=eq.critico' },
      (payload) => addNotif({
        tipo: 'stock_critico', icon: 'package', color: '#F28C28',
        titulo: 'Material en estado crítico',
        descripcion: `${payload.new.nombre_material} · stock: ${payload.new.stock_actual}`,
      }));

    // ── Movimientos de materiales (filtrados por obra) ──
    channel.on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'movimientos_materiales', ...(obraFilter ? { filter: obraFilter } : {}) },
      (payload) => {
        if (payload.new.created_by === profile.id) return;
        addNotif({
          tipo: 'movimiento', icon: payload.new.tipo_movimiento === 'entrada' ? 'arrowIn' : 'arrowOut',
          color: payload.new.tipo_movimiento === 'entrada' ? '#2ECC71' : '#F28C28',
          titulo: `${payload.new.tipo_movimiento === 'entrada' ? 'Ingreso' : 'Salida'} de material`,
          descripcion: `${payload.new.cantidad} ${payload.new.unidad}`,
        });
      });

    // ── Movimientos de herramientas (filtrados por obra) ──
    channel.on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'movimientos_herramientas', ...(obraFilter ? { filter: obraFilter } : {}) },
      (payload) => {
        if (payload.new.created_by === profile.id) return;
        addNotif({
          tipo: 'mov_herramienta', icon: 'tool', color: '#F2B705',
          titulo: `${payload.new.tipo_movimiento || 'Movimiento'} de herramienta`,
          descripcion: `Cantidad: ${payload.new.cantidad || 1}`,
        });
      });

    // ── Asistencia (filtrada por obra) ──
    channel.on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'asistencia', ...(obraFilter ? { filter: obraFilter } : {}) },
      (payload) => {
        if (payload.new.created_by === profile.id) return;
        addNotif({
          tipo: 'asistencia', icon: 'users', color: '#2ECC71',
          titulo: 'Nueva marca de asistencia',
          descripcion: `Estado: ${payload.new.estado || '—'} · ${payload.new.fecha || ''}`,
        });
      });

    // ── Avance de obra (filtrado por obra) ──
    channel.on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'avance_obra', ...(obraFilter ? { filter: obraFilter } : {}) },
      (payload) => {
        if (payload.new.created_by === profile.id) return;
        addNotif({
          tipo: 'avance', icon: 'hardHat', color: '#F2B705',
          titulo: 'Nuevo avance registrado',
          descripcion: `${payload.new.metrado_ejecutado} ejecutado · semana ${payload.new.semana || ''}`,
        });
      });

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
          });
      } catch (e) {
        // La tabla puede no existir todavía si la migración 009 no se aplicó
        console.warn('[realtime] change_requests no disponible aún:', e?.message || e);
      }
    }

    channel.subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[realtime] estado canal:', status);
      }
    });

    channelRef.current = channel;
    return () => {
      try { channel.unsubscribe(); } catch (e) {}
      try { supabase.removeChannel(channel); } catch (e) {}
      channelRef.current = null;
    };
  }, [profile?.id, profile?.rol, obraActivaId]);

  const addNotif = (n) => {
    const notif = { id: crypto.randomUUID(), ...n, fecha: new Date().toISOString(), leida: false };
    setNotifications(prev => {
      const next = [notif, ...prev].slice(0, 50);
      localStorage.setItem('jarvex_notifs', JSON.stringify(next));
      return next;
    });
    setUnreadCount(c => c + 1);

    // Browser notification si tiene permiso
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

  return { notifications, unreadCount, markAllRead, clearAll, requestPermission };
}
