import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

export function useRealtimeNotifications() {
  const { profile } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const channelRef = useRef(null);

  useEffect(() => {
    if (!profile?.id) return;

    // Cargar notificaciones leídas/no leídas de localStorage
    const stored = JSON.parse(localStorage.getItem('jarvex_notifs') || '[]');
    setNotifications(stored);
    setUnreadCount(stored.filter(n => !n.leida).length);

    // Subscribe a cambios en tablas clave
    const channel = supabase
      .channel('jarvex-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'incidencias' },
        (payload) => addNotif({
          tipo: 'incidencia', icon: 'alert', color: '#E74C3C',
          titulo: 'Nueva incidencia', descripcion: payload.new.descripcion,
          severidad: payload.new.severidad,
        }))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'materiales',
            filter: 'alerta=eq.critico' },
        (payload) => addNotif({
          tipo: 'stock_critico', icon: 'package', color: '#F28C28',
          titulo: 'Material en estado crítico',
          descripcion: `${payload.new.nombre_material} · stock: ${payload.new.stock_actual}`,
        }))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'movimientos_materiales' },
        (payload) => {
          if (payload.new.created_by === profile.id) return; // ignorar propios
          addNotif({
            tipo: 'movimiento', icon: payload.new.tipo_movimiento === 'entrada' ? 'arrowIn' : 'arrowOut',
            color: payload.new.tipo_movimiento === 'entrada' ? '#2ECC71' : '#F28C28',
            titulo: `${payload.new.tipo_movimiento === 'entrada' ? 'Ingreso' : 'Salida'} de material`,
            descripcion: `${payload.new.cantidad} ${payload.new.unidad}`,
          });
        })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'avance_obra' },
        (payload) => {
          if (payload.new.created_by === profile.id) return;
          addNotif({
            tipo: 'avance', icon: 'hardHat', color: '#F2B705',
            titulo: 'Nuevo avance registrado',
            descripcion: `${payload.new.metrado_ejecutado} ejecutado · semana ${payload.new.semana || ''}`,
          });
        })
      .subscribe();

    channelRef.current = channel;
    return () => { channel.unsubscribe(); };
  }, [profile?.id]);

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
