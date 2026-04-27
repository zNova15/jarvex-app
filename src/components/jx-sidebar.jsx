import React from "react";
const { useState } = React;

const NAV = [
  { section: 'GENERAL' },
  { id: 'importar', label: 'Importar Datos', icon: 'upload' },
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'obras', label: 'Obras / Proyectos', icon: 'building' },
  { id: 'reportes', label: 'Reportes', icon: 'chart' },

  { section: 'CONTROL DE ALMACÉN' },
  { id: 'personal', label: 'Personal', icon: 'users' },
  { id: 'asistencia', label: 'Asistencia', icon: 'calendar' },
  { id: 'materiales', label: 'Materiales', icon: 'package' },
  { id: 'mov-materiales', label: 'Mov. de Materiales', icon: 'arrowIn' },
  { id: 'herramientas', label: 'Herramientas', icon: 'tool' },
  { id: 'mov-herramientas', label: 'Mov. Herramientas', icon: 'arrowOut' },
  { id: 'proveedores', label: 'Proveedores', icon: 'truck' },
  { id: 'evidencias', label: 'Evidencias', icon: 'camera' },

  { section: 'GESTIÓN DE OBRA' },
  { id: 'partidas', label: 'Partidas', icon: 'list' },
  { id: 'insumos', label: 'Insumos por Partida', icon: 'layers' },
  { id: 'cronograma', label: 'Cronograma / Gantt', icon: 'gantt' },
  { id: 'avance', label: 'Avance de Obra', icon: 'hardHat' },
  { id: 'comparativo', label: 'Planificado vs Real', icon: 'compare' },
  { id: 'costos', label: 'Costos', icon: 'dollar' },
  { id: 'incidencias', label: 'Incidencias', icon: 'alert' },

  { section: 'ADMINISTRACIÓN' },
  { id: 'usuarios', label: 'Usuarios', icon: 'user' },
  { id: 'roles', label: 'Roles y Permisos', icon: 'shield' },
  { id: 'configuracion', label: 'Configuración', icon: 'settings' },
  { id: 'conflictos', label: 'Conflictos Sync', icon: 'alert' },
];

function Sidebar({ current, onNav, collapsed, onToggle }) {
  const [hovered, setHovered] = useState(null);

  const sideStyle = {
    width: collapsed ? 58 : 252,
    minWidth: collapsed ? 58 : 252,
    background: '#0D1822',
    borderRight: '1px solid rgba(255,255,255,0.06)',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    transition: 'width .22s cubic-bezier(.4,0,.2,1), min-width .22s cubic-bezier(.4,0,.2,1)',
    overflow: 'hidden',
    zIndex: 10,
    position: 'relative',
  };

  return (
    <aside style={sideStyle}>
      {/* Logo */}
      <div style={{ padding: collapsed ? '14px 8px' : '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', gap: 10, minHeight: 64 }}>
        <img
          src="/jarvex-logo.png"
          alt="JARVEX"
          onClick={collapsed ? onToggle : undefined}
          style={{
            height: collapsed ? 36 : 46,
            width: 'auto',
            objectFit: 'contain',
            flexShrink: 0,
            cursor: collapsed ? 'pointer' : 'default',
          }}
          title={collapsed ? 'Expandir' : ''}
        />
      </div>

      {/* Nav items */}
      <nav style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '8px 0' }}>
        {NAV.map((item, i) => {
          if (item.section) {
            if (collapsed) return <div key={i} style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '8px 10px' }} />;
            return (
              <div key={i} style={{ padding: '14px 16px 5px', fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: '#405060' }}>
                {item.section}
              </div>
            );
          }

          const isActive = current === item.id;
          const isHov = hovered === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onNav(item.id)}
              onMouseEnter={() => setHovered(item.id)}
              onMouseLeave={() => setHovered(null)}
              title={collapsed ? item.label : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                background: isActive ? 'rgba(242,183,5,0.1)' : isHov ? 'rgba(255,255,255,0.04)' : 'transparent',
                border: 'none',
                borderLeft: isActive ? '2.5px solid #F2B705' : '2.5px solid transparent',
                borderRadius: collapsed ? 0 : '0 6px 6px 0',
                padding: collapsed ? '10px 0' : '9px 14px',
                cursor: 'pointer',
                color: isActive ? '#F2B705' : isHov ? '#BFC7D1' : '#7A8A9A',
                fontSize: 12.5,
                fontWeight: isActive ? 600 : 400,
                fontFamily: 'inherit',
                textAlign: 'left',
                transition: 'all .15s',
                whiteSpace: 'nowrap',
                justifyContent: collapsed ? 'center' : 'flex-start',
                margin: '1px 0',
              }}
            >
              <JxIcon name={item.icon} size={15} color={isActive ? '#F2B705' : isHov ? '#BFC7D1' : '#556070'} />
              {!collapsed && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>}
              {!collapsed && isActive && <div style={{ marginLeft: 'auto', width: 5, height: 5, borderRadius: '50%', background: '#F2B705', flexShrink: 0 }} />}
            </button>
          );
        })}
      </nav>

      {/* User profile */}
      <div style={{ padding: collapsed ? '12px 8px' : '12px 14px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#223247,#1C2D40)', border: '1.5px solid rgba(242,183,5,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#F2B705', flexShrink: 0 }}>
          MG
        </div>
        {!collapsed && (
          <>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#BFC7D1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Ing. Miguel García</div>
              <div style={{ fontSize: 10.5, color: '#4A5A6A' }}>Administrador</div>
            </div>
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4A5A6A', padding: 4, display: 'flex' }} title="Cerrar sesión">
              <JxIcon name="logout" size={14} />
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

Object.assign(window, { Sidebar, NAV });