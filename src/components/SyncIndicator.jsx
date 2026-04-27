import { useSync } from '../hooks/useSync';
import { useOnline } from '../hooks/useOnline';

const styles = {
  wrap: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '4px 10px', borderRadius: 20,
    fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
    transition: 'background 0.2s',
    userSelect: 'none',
  },
  dot: (color) => ({
    width: 7, height: 7, borderRadius: '50%', background: color,
    flexShrink: 0,
  }),
};

export function SyncIndicator({ onClick }) {
  const online = useOnline();
  const { syncing, pending, lastSync, error } = useSync();

  let color, label, bg;

  if (!online) {
    color = '#F59E0B'; label = 'Sin conexión'; bg = 'rgba(245,158,11,0.12)';
  } else if (error) {
    color = '#EF4444'; label = 'Error sync'; bg = 'rgba(239,68,68,0.12)';
  } else if (syncing) {
    color = '#60A5FA'; label = 'Sincronizando…'; bg = 'rgba(96,165,250,0.12)';
  } else if (pending > 0) {
    color = '#F59E0B'; label = `${pending} pendiente${pending > 1 ? 's' : ''}`; bg = 'rgba(245,158,11,0.12)';
  } else {
    color = '#34D399'; label = 'Sincronizado'; bg = 'rgba(52,211,153,0.1)';
  }

  const title = lastSync
    ? `Última sync: ${new Date(lastSync).toLocaleTimeString('es-PE')}`
    : 'Sin sincronizar aún';

  return (
    <div style={{ ...styles.wrap, background: bg }} onClick={onClick} title={title}>
      <div style={{
        ...styles.dot(color),
        ...(syncing ? { animation: 'pulse 1.2s ease-in-out infinite' } : {}),
      }} />
      <span style={{ color }}>{label}</span>
      {pending > 0 && !syncing && (
        <span style={{
          background: '#F59E0B', color: '#0E1620',
          borderRadius: '50%', width: 16, height: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, fontWeight: 800,
        }}>
          {pending > 99 ? '99+' : pending}
        </span>
      )}
    </div>
  );
}
