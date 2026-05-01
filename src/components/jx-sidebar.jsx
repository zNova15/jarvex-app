import React from "react";
const { useState, useEffect } = React;

// Hook: detecta si el viewport es móvil (≤ 768px)
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return isMobile;
}

// Hook: gestiona el prompt de instalación PWA del navegador.
// Retorna { canInstall, isInstalled, promptInstall }.
function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(() => {
    if (typeof window === 'undefined') return false;
    // standalone (Android/Chrome) o navigator.standalone (iOS Safari)
    return window.matchMedia?.('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
  });

  useEffect(() => {
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const onAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const promptInstall = async () => {
    if (!deferredPrompt) return false;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    return outcome === 'accepted';
  };

  return {
    canInstall: !!deferredPrompt && !isInstalled,
    isInstalled,
    promptInstall,
  };
}

const NAV = [
  { section: 'GENERAL' },
  { id: 'importar', label: 'Importar Datos', icon: 'upload' },
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'obras', label: 'Obras / Proyectos', icon: 'building' },
  { id: 'reportes', label: 'Reportes', icon: 'chart' },

  { section: 'CONTROL DE ALMACÉN' },
  { id: 'materiales', label: 'Materiales', icon: 'package' },
  { id: 'mov-materiales', label: 'Mov. de Materiales', icon: 'arrowIn' },
  { id: 'herramientas', label: 'Herramientas', icon: 'tool' },
  { id: 'mov-herramientas', label: 'Mov. Herramientas', icon: 'arrowOut' },
  { id: 'proveedores', label: 'Proveedores', icon: 'truck' },
  { id: 'evidencias', label: 'Evidencias', icon: 'camera' },

  { section: 'COMPRAS / LOGÍSTICA' },
  { id: 'requisiciones', label: 'Requisiciones', icon: 'list' },
  { id: 'ordenes-compra', label: 'Órdenes de Compra', icon: 'package' },

  { section: 'MAQUINARIA' },
  { id: 'activos-pesados', label: 'Equipos Pesados', icon: 'tool' },
  { id: 'mantenimiento-programado', label: 'Mantenimiento Programado', icon: 'tool' },

  { section: 'EJECUTIVO' },
  { id: 'dashboard-ejecutivo', label: 'Dashboard Ejecutivo', icon: 'dashboard' },
  { id: 'kpis-obra', label: 'KPIs por Obra', icon: 'trending' },
  { id: 'cumplimiento-cronograma', label: 'Cumplimiento Cronograma', icon: 'calendar' },
  { id: 'alertas', label: 'Centro de Alertas', icon: 'bell' },
  { id: 'busqueda', label: 'Búsqueda Global', icon: 'search' },

  { section: 'GESTIÓN DE OBRA' },
  { id: 'partidas', label: 'Partidas', icon: 'list' },
  { id: 'insumos', label: 'Insumos por Partida', icon: 'layers' },
  { id: 'versiones', label: 'Versiones de Presupuesto', icon: 'compare' },
  { id: 'cronograma', label: 'Cronograma / Gantt', icon: 'gantt' },
  { id: 'avance', label: 'Avance de Obra', icon: 'hardHat' },
  { id: 'comparativo', label: 'Planificado vs Real', icon: 'compare' },
  { id: 'costos', label: 'Costos', icon: 'dollar' },
  { id: 'valorizaciones', label: 'Valorizaciones', icon: 'dollar' },
  { id: 'subcontratistas', label: 'Subcontratistas', icon: 'users' },
  { id: 'subcontratos', label: 'Subcontratos', icon: 'package' },
  { id: 'subcontrato-valorizaciones', label: 'Valorizaciones de Subcontrato', icon: 'dollar' },
  { id: 'incidencias', label: 'Incidencias', icon: 'alert' },

  { section: 'SSOMA / SEGURIDAD' },
  { id: 'charlas-seguridad', label: 'Charlas de 5 minutos', icon: 'alert' },
  { id: 'iperc', label: 'IPERC (riesgos)', icon: 'alert' },
  { id: 'epp', label: 'Entregas EPP', icon: 'check' },
  { id: 'inspecciones-seguridad', label: 'Inspecciones', icon: 'shield' },
  { id: 'capacitaciones', label: 'Capacitaciones', icon: 'users' },

  { section: 'RRHH' },
  { id: 'personal', label: 'Personal', icon: 'users' },
  { id: 'asistencia', label: 'Asistencia', icon: 'calendar' },
  { id: 'personal-contratos', label: 'Contratos Laborales', icon: 'shield' },
  { id: 'planillas', label: 'Planillas / Sueldos', icon: 'user' },
  { id: 'cts', label: 'CTS', icon: 'dollar' },
  { id: 'gratificaciones', label: 'Gratificaciones', icon: 'dollar' },
  { id: 'plame', label: 'PLAME / T-Registro SUNAT', icon: 'list' },

  { section: 'CONTABILIDAD' },
  { id: 'cont-dashboard', label: 'Dashboard Contable', icon: 'dashboard' },
  { id: 'empresas', label: 'Empresas', icon: 'building' },
  { id: 'movimientos-contables', label: 'Movimientos', icon: 'dollar' },
  { id: 'intercompany', label: 'Operaciones entre Empresas', icon: 'compare' },
  { id: 'consolidado', label: 'Consolidado', icon: 'list' },
  { id: 'cuentas-bancarias', label: 'Cuentas Bancarias', icon: 'dollar' },
  { id: 'flujo-caja', label: 'Flujo de Caja / Pagos', icon: 'calendar' },
  { id: 'plan-cuentas', label: 'Plan de Cuentas (PCGE)', icon: 'list' },
  { id: 'libro-diario', label: 'Libro Diario / Asientos', icon: 'list' },
  { id: 'balance-general', label: 'Balance General', icon: 'compare' },
  { id: 'estado-resultados', label: 'Estado de Resultados', icon: 'dollar' },
  { id: 'comprobantes', label: 'Comprobantes Electrónicos SUNAT', icon: 'list' },
  { id: 'libros-electronicos', label: 'Libros Electrónicos PLE / PDT', icon: 'list' },
  { id: 'config-sunat', label: 'Configuración SUNAT', icon: 'settings' },
  { id: 'flujo-proyectado', label: 'Flujo de Caja Proyectado', icon: 'calendar' },
  { id: 'comparativo-periodos', label: 'Comparativo Periodos', icon: 'compare' },

  { section: 'ADMINISTRACIÓN' },
  { id: 'usuarios', label: 'Usuarios', icon: 'user' },
  { id: 'roles', label: 'Roles y Permisos', icon: 'shield' },
  { id: 'solicitudes', label: 'Solicitudes', icon: 'shield' },
  { id: 'configuracion', label: 'Configuración', icon: 'settings' },
  { id: 'conflictos', label: 'Conflictos Sync', icon: 'alert' },
  { id: 'audit-log', label: 'Auditoría', icon: 'shield' },
];

function Sidebar({ current, onNav, collapsed, onToggle }) {
  const appMode = window.__useAppMode ? window.__useAppMode() : { isPrueba: true };
  const { isPrueba } = appMode;
  const [hovered, setHovered] = useState(null);
  const isMobile = useIsMobile();
  const pwa = usePwaInstall();
  const auth = window.__useAuth ? window.__useAuth() : null;
  const profile = auth?.profile;
  const isAdmin = profile?.rol === 'admin';

  // Poll de solicitudes pendientes (solo admin)
  const [pendingReqCount, setPendingReqCount] = useState(0);
  useEffect(() => {
    if (!isAdmin) { setPendingReqCount(0); return; }
    let cancelled = false;
    const poll = async () => {
      try {
        const n = await window.__changeRequests?.countPending?.();
        if (!cancelled) setPendingReqCount(n || 0);
      } catch (e) { /* ignore */ }
    };
    poll();
    const id = setInterval(poll, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [isAdmin]);

  // Conteo de alertas críticas (badge en sidebar → "Centro de Alertas")
  const [alertasCount, setAlertasCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const recompute = async () => {
      try {
        const [mats, pagos, contratos, ipercs, conflicts] = await Promise.all([
          window.__db.materiales.filter(x => !x.deleted_at).toArray().catch(() => []),
          window.__db.cronograma_pagos.filter(x => !x.deleted_at).toArray().catch(() => []),
          window.__db.personal_contrato.filter(x => !x.deleted_at).toArray().catch(() => []),
          window.__db.iperc.filter(x => !x.deleted_at).toArray().catch(() => []),
          window.__db.sync_conflicts.filter(x => x.estado === 'pendiente').toArray().catch(() => []),
        ]);
        const hoy = new Date().toISOString().slice(0, 10);
        let n = 0;
        n += mats.filter(m => {
          const min = Number(m.stock_minimo || m.alerta_minima || 0);
          return min > 0 && Number(m.stock_actual || 0) <= min;
        }).length;
        n += pagos.filter(p => p.estado === 'vencido' || (p.estado === 'programado' && p.fecha_programada && p.fecha_programada < hoy)).length;
        n += contratos.filter(c => {
          if (c.estado !== 'vigente' && c.estado !== 'activo') return false;
          if (!c.fecha_fin) return false;
          const d = new Date(c.fecha_fin);
          const diff = (d - new Date()) / 86400000;
          return diff >= 0 && diff <= 30;
        }).length;
        n += ipercs.filter(i => {
          const c = String(i.clasificacion || '').toLowerCase();
          return ['alto', 'critico', 'importante', 'intolerable'].includes(c) && i.estado !== 'controlado';
        }).length;
        n += conflicts.length;
        if (!cancelled) setAlertasCount(n);
      } catch { if (!cancelled) setAlertasCount(0); }
    };
    recompute();
    const id = setInterval(recompute, 60000);
    const onChange = () => recompute();
    window.addEventListener('jx_data_changed', onChange);
    return () => { cancelled = true; clearInterval(id); window.removeEventListener('jx_data_changed', onChange); };
  }, []);
  const initials = profile
    ? ((profile.nombres?.[0] || '') + (profile.apellidos?.[0] || '')).toUpperCase() || (profile.email?.[0] || '?').toUpperCase()
    : '··';
  const fullName = profile
    ? `${profile.nombres || ''} ${profile.apellidos || ''}`.trim() || profile.email
    : 'Usuario';
  const ROL_LABEL = {
    admin: 'Administrador', gerente: 'Gerente', ingeniero_residente: 'Ing. Residente',
    supervisor: 'Supervisor', almacenero: 'Almacenero', asistente_admin: 'Asist. Admin',
    solo_lectura: 'Solo lectura',
  };
  const rolLabel = ROL_LABEL[profile?.rol] || profile?.rol || '—';

  // En móvil, `collapsed` significa "drawer cerrado" (totalmente oculto).
  // En desktop, `collapsed` significa "sidebar reducido a iconos".
  const sideStyle = isMobile ? {
    width: 280,
    minWidth: 280,
    background: '#0D1822',
    borderRight: '1px solid rgba(255,255,255,0.06)',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    position: 'fixed',
    top: 0, left: 0,
    transform: collapsed ? 'translateX(-100%)' : 'translateX(0)',
    transition: 'transform .26s cubic-bezier(.4,0,.2,1)',
    overflow: 'hidden',
    zIndex: 1000,
    boxShadow: collapsed ? 'none' : '0 0 40px rgba(0,0,0,0.6)',
  } : {
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

  // En móvil, los items de nav se ven siempre con etiqueta (no colapsados).
  const navCollapsed = isMobile ? false : collapsed;

  // Cierra el drawer al hacer click en un nav item (solo móvil)
  const handleNav = (id) => {
    onNav(id);
    if (isMobile) onToggle();
  };

  return (
    <>
      {isMobile && !collapsed && (
        <div
          onClick={onToggle}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(2px)', zIndex: 999, animation: 'fadeIn .2s ease',
          }}
        />
      )}
    <aside style={sideStyle}>
      {/* Logo */}
      <div style={{ padding: navCollapsed ? '14px 8px' : '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: navCollapsed ? 'center' : 'flex-start', gap: 12, minHeight: 64 }}>
        <img
          src="/jarvex-icon.png"
          alt="JARVEX"
          onClick={navCollapsed ? onToggle : undefined}
          style={{
            height: navCollapsed ? 32 : 40,
            width: 'auto',
            objectFit: 'contain',
            flexShrink: 0,
            cursor: navCollapsed ? 'pointer' : 'default',
          }}
          title={navCollapsed ? 'Expandir' : ''}
        />
        {!navCollapsed && (
          <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#F0F2F5', letterSpacing: -.4, lineHeight: 1.1 }}>JARVEX</div>
            <div style={{ fontSize: 9.5, color: '#6B7A8D', fontWeight: 500, letterSpacing: .04, lineHeight: 1.3, marginTop: 2 }}>TECNOLOGÍA · INGENIERÍA</div>
          </div>
        )}
        {isMobile && !navCollapsed && (
          <button onClick={onToggle} aria-label="Cerrar menú"
                  style={{ background: 'none', border: 'none', color: '#6B7A8D', cursor: 'pointer', padding: 6, display: 'flex' }}>
            <JxIcon name="x" size={16} />
          </button>
        )}
      </div>

      {/* Nav items */}
      <nav style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '8px 0' }}>
        {NAV.map((item, i) => {
          if (item.section) {
            if (navCollapsed) return <div key={i} style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '8px 10px' }} />;
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
              onClick={() => handleNav(item.id)}
              onMouseEnter={() => setHovered(item.id)}
              onMouseLeave={() => setHovered(null)}
              title={navCollapsed ? item.label : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                background: isActive ? 'rgba(242,183,5,0.1)' : isHov ? 'rgba(255,255,255,0.04)' : 'transparent',
                border: 'none',
                borderLeft: isActive ? '2.5px solid #F2B705' : '2.5px solid transparent',
                borderRadius: navCollapsed ? 0 : '0 6px 6px 0',
                padding: navCollapsed ? '10px 0' : (isMobile ? '12px 16px' : '9px 14px'),
                cursor: 'pointer',
                color: isActive ? '#F2B705' : isHov ? '#BFC7D1' : '#7A8A9A',
                fontSize: isMobile ? 13.5 : 12.5,
                fontWeight: isActive ? 600 : 400,
                fontFamily: 'inherit',
                textAlign: 'left',
                transition: 'all .15s',
                whiteSpace: 'nowrap',
                justifyContent: navCollapsed ? 'center' : 'flex-start',
                margin: '1px 0',
                position: 'relative',
              }}
            >
              <JxIcon name={item.icon} size={isMobile ? 17 : 15} color={isActive ? '#F2B705' : isHov ? '#BFC7D1' : '#556070'} />
              {!navCollapsed && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>}
              {item.id === 'solicitudes' && isAdmin && pendingReqCount > 0 && !navCollapsed && (
                <span style={{ marginLeft: 'auto', minWidth: 18, height: 18, borderRadius: 9, background: '#F2B705', color: '#0D1822', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px', flexShrink: 0 }}>
                  {pendingReqCount > 99 ? '99+' : pendingReqCount}
                </span>
              )}
              {item.id === 'solicitudes' && isAdmin && pendingReqCount > 0 && navCollapsed && (
                <span style={{ position: 'absolute', top: 6, right: 8, minWidth: 14, height: 14, borderRadius: 7, background: '#F2B705', color: '#0D1822', fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>
                  {pendingReqCount > 9 ? '9+' : pendingReqCount}
                </span>
              )}
              {item.id === 'alertas' && alertasCount > 0 && !navCollapsed && (
                <span style={{ marginLeft: 'auto', minWidth: 18, height: 18, borderRadius: 9, background: '#E74C3C', color: '#fff', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px', flexShrink: 0 }}>
                  {alertasCount > 99 ? '99+' : alertasCount}
                </span>
              )}
              {item.id === 'alertas' && alertasCount > 0 && navCollapsed && (
                <span style={{ position: 'absolute', top: 6, right: 8, minWidth: 14, height: 14, borderRadius: 7, background: '#E74C3C', color: '#fff', fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>
                  {alertasCount > 9 ? '9+' : alertasCount}
                </span>
              )}
              {item.id !== 'solicitudes' && item.id !== 'alertas' && !navCollapsed && isActive && <div style={{ marginLeft: 'auto', width: 5, height: 5, borderRadius: '50%', background: '#F2B705', flexShrink: 0 }} />}
            </button>
          );
        })}
      </nav>

      {/* Mode badge */}
      {!navCollapsed && (
        <div style={{ padding: '8px 14px 0' }}>
          <div
            className={`badge ${isPrueba ? 'b-amber' : 'b-green'}`}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: 0.5,
              padding: '5px 8px',
            }}
            title={isPrueba ? 'Modo edición activo' : 'Modo producción activo'}>
            {isPrueba ? '✏️ MODO EDICIÓN' : '🔒 PRODUCCIÓN'}
          </div>
        </div>
      )}

      {/* PWA install — solo si el browser lo permite y no está instalada */}
      {pwa.canInstall && !navCollapsed && (
        <div style={{ padding: '8px 14px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <button
            onClick={async () => { await pwa.promptInstall(); }}
            className="btn btn-amber btn-sm"
            style={{ width: '100%', justifyContent: 'center', fontSize: 11.5 }}
            title="Instala JARVEX como app nativa">
            <JxIcon name="download" size={12}/> Instalar JARVEX
          </button>
        </div>
      )}

      {/* User profile */}
      <div style={{ padding: navCollapsed ? '12px 8px' : '12px 14px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#223247,#1C2D40)', border: '1.5px solid rgba(242,183,5,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#F2B705', flexShrink: 0 }}>
          {initials}
        </div>
        {!navCollapsed && (
          <>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#BFC7D1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={profile?.email}>{fullName}</div>
              <div style={{ fontSize: 10.5, color: '#4A5A6A', textTransform: 'capitalize' }}>{rolLabel}</div>
            </div>
            <button
              onClick={() => auth?.logout?.()}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4A5A6A', padding: 4, display: 'flex' }}
              title="Cerrar sesión"
              onMouseEnter={e => e.currentTarget.style.color = '#E74C3C'}
              onMouseLeave={e => e.currentTarget.style.color = '#4A5A6A'}>
              <JxIcon name="logout" size={14} />
            </button>
          </>
        )}
      </div>
    </aside>
    </>
  );
}

Object.assign(window, { Sidebar, NAV });