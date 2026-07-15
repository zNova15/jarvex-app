import React from "react";
import { planoDe } from "../lib/nav-planos.js";
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
  { section: 'GENERAL', area: 'general' },
  { id: 'captura-magica', label: '✨ Captura Mágica', icon: 'upload' },
  { id: 'proveedores', label: 'Proveedores', icon: 'truck' },
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'obras', label: 'Obras / Proyectos', icon: 'building' },
  { id: 'reportes', label: 'Reportes', icon: 'chart' },

  { section: 'CONTROL DE ALMACÉN' },
  { id: 'materiales', label: 'Materiales', icon: 'package' },
  { id: 'mov-materiales', label: 'Mov. de Materiales', icon: 'arrowIn' },
  { id: 'herramientas', label: 'Herramientas', icon: 'tool' },
  { id: 'mov-herramientas', label: 'Mov. Herramientas', icon: 'arrowOut' },
  { id: 'caja-chica', label: 'Caja Chica', icon: 'dollar' },
  { id: 'ubicaciones', label: 'Ubicaciones de Obra', icon: 'map' },
  { id: 'compras-pendientes', label: 'Vinculación de Compras', icon: 'arrowIn' },
  { id: 'evidencias', label: 'Evidencias', icon: 'camera' },
  { id: 'plantillas', label: 'Plantillas', icon: 'file' },

  { section: 'COMPRAS / LOGÍSTICA' },
  { id: 'solicitud-residente', label: 'Solicitud de Insumos', icon: 'plus' },
  { id: 'requisiciones', label: 'Requisiciones', icon: 'list' },
  { id: 'ordenes-compra', label: 'Órdenes de Compra', icon: 'package' },

  { section: 'MAQUINARIA' },
  { id: 'activos-pesados', label: 'Equipos Pesados', icon: 'tool' },
  { id: 'mantenimiento-programado', label: 'Mantenimiento Programado', icon: 'tool' },

  { section: 'DIRECCIÓN', area: 'direccion' },
  { id: 'dashboard-ejecutivo', label: 'Dashboard Ejecutivo', icon: 'dashboard' },
  { id: 'kpis-obra', label: 'KPIs por Obra', icon: 'trending' },
  { id: 'cumplimiento-cronograma', label: 'Cumplimiento Cronograma', icon: 'calendar' },
  { id: 'alertas', label: 'Centro de Alertas', icon: 'bell' },
  { id: 'busqueda', label: 'Búsqueda Global', icon: 'search' },

  { section: 'INGENIERÍA' },
  { id: 'dashboard-tecnico', label: 'Dashboard Técnico', icon: 'dashboard' },
  { id: 'mis-partidas', label: 'Partidas del Proyecto', icon: 'list' },
  { id: 'cronograma-frente', label: 'Cronograma de mis Partidas', icon: 'calendar' },
  { id: 'salidas-frente', label: 'Vinculación de insumos', icon: 'link' },
  { id: 'reporte-diario', label: 'Reporte Diario', icon: 'edit' },
  { id: 'mis-reportes', label: 'Mis Reportes', icon: 'list' },
  { id: 'borradores-reporte', label: 'Borradores', icon: 'copy' },
  { id: 'plan-real', label: 'Plan vs Real', icon: 'trending' },
  { id: 'emitir-alerta', label: 'Emitir Alerta', icon: 'alert' },
  { id: 'vinculacion-salidas', label: 'Vinculación de Salidas', icon: 'link' },

  { section: 'GESTIÓN DE OBRA' },
  { id: 'dashboard-gestion', label: 'Dashboard Gestión de Obra', icon: 'dashboard' },
  { id: 'importar', label: 'Importar Presupuesto', icon: 'upload' },
  { id: 'partidas', label: 'Partidas', icon: 'list' },
  { id: 'control-consumo', label: 'Control de Consumo', icon: 'trending' },
  { id: 'insumos', label: 'Insumos por Partida', icon: 'layers' },
  { id: 'versiones', label: 'Versiones de Presupuesto', icon: 'compare' },
  { id: 'cronograma', label: 'Cronograma / Gantt', icon: 'gantt' },
  { id: 'avance', label: 'Avance de Obra', icon: 'hardHat' },
  { id: 'aprobaciones-reporte', label: 'Aprobación de Frentes', icon: 'flag' },
  { id: 'rendimiento-ingenieros', label: 'Rendimiento de Ingenieros', icon: 'trendUp' },
  { id: 'comparativo', label: 'Planificado vs Real', icon: 'compare' },
  { id: 'costos', label: 'Costos', icon: 'dollar' },
  { id: 'valorizaciones', label: 'Valorizaciones', icon: 'dollar' },
  { id: 'subcontratistas', label: 'Subcontratistas', icon: 'users' },
  { id: 'subcontratos', label: 'Subcontratos', icon: 'package' },
  { id: 'subcontrato-valorizaciones', label: 'Valorizaciones de Subcontrato', icon: 'dollar' },
  { id: 'incidencias', label: 'Incidencias', icon: 'alert' },
  { id: 'movimientos-insumos', label: 'Movimientos de Insumos', icon: 'inbox' },

  { section: 'CONTABILIDAD DE LA OBRA' },
  { id: 'movimientos-contables', label: 'Movimientos', icon: 'dollar', plano: 'obra' },
  { id: 'conciliacion-insumos', label: 'Conciliación de Insumos', icon: 'compare' },
  { id: 'pagos', label: 'Pagos', icon: 'dollar' },

  { section: 'SSOMA / SEGURIDAD' },
  { id: 'charlas-seguridad', label: 'Charlas de 5 minutos', icon: 'alert' },
  { id: 'iperc', label: 'IPERC (riesgos)', icon: 'alert' },
  { id: 'epps-inventario', label: 'EPPs (inventario)', icon: 'shield' },
  { id: 'epp', label: 'Entregas EPP', icon: 'check' },
  { id: 'insumos-persona', label: 'Insumos por Persona', icon: 'users' },
  { id: 'inspecciones-seguridad', label: 'Inspecciones', icon: 'shield' },
  { id: 'capacitaciones', label: 'Capacitaciones', icon: 'users' },
  { id: 'insumos-emergencia', label: 'Insumos de Emergencia', icon: 'package' },

  { section: 'RRHH' },
  { id: 'personal', label: 'Personal', icon: 'users' },
  { id: 'frentes', label: 'Frentes de Trabajo', icon: 'flag' },
  { id: 'asistencia', label: 'Asistencia', icon: 'calendar' },
  { id: 'personal-contratos', label: 'Contratos Laborales', icon: 'shield' },
  { id: 'planillas', label: 'Planillas / Sueldos', icon: 'user' },
  { id: 'cts', label: 'CTS', icon: 'dollar' },
  { id: 'gratificaciones', label: 'Gratificaciones', icon: 'dollar' },
  { id: 'plame', label: 'PLAME / T-Registro SUNAT', icon: 'list' },

  { section: 'EMPRESAS Y CONTABILIDAD', area: 'contabilidad' },
  { id: 'cont-dashboard', label: 'Dashboard Contable', icon: 'dashboard' },
  { id: 'empresas', label: 'Empresas', icon: 'building' },
  { id: 'movimientos-contables', label: 'Movimientos (todas / por obra)', icon: 'dollar', plano: 'general' },
  { id: 'guias-remision', label: 'Guías de Remisión', icon: 'truck' },
  { id: 'intercompany', label: 'Operaciones entre Empresas', icon: 'compare' },
  { id: 'trazabilidad', label: 'Trazabilidad de Cadenas', icon: 'compare' },
  { id: 'compras-categoria', label: 'Compras por Categoría', icon: 'layers' },
  { id: 'ordenes-intercompany', label: 'Órdenes Intercompany', icon: 'list' },
  { id: 'consolidado', label: 'Consolidado', icon: 'list' },
  { id: 'cuentas-bancarias', label: 'Cuentas Bancarias', icon: 'dollar' },
  { id: 'flujo-caja', label: 'Flujo de Caja / Pagos', icon: 'calendar' },
  { id: 'flujo-proyectado', label: 'Flujo de Caja Proyectado', icon: 'calendar' },
  { id: 'plan-cuentas', label: 'Plan de Cuentas (PCGE)', icon: 'list' },
  { id: 'libro-diario', label: 'Libro Diario / Asientos', icon: 'list' },
  { id: 'balance-general', label: 'Balance General', icon: 'compare' },
  { id: 'estado-resultados', label: 'Estado de Resultados', icon: 'dollar' },
  { id: 'comprobantes', label: 'Comprobantes Electrónicos SUNAT', icon: 'list' },
  { id: 'libros-electronicos', label: 'Libros Electrónicos PLE / PDT', icon: 'list' },
  { id: 'config-sunat', label: 'Configuración SUNAT', icon: 'settings' },
  { id: 'comparativo-periodos', label: 'Comparativo Periodos', icon: 'compare' },

  { section: 'ADMINISTRACIÓN', area: 'admin' },
  { id: 'usuarios', label: 'Usuarios', icon: 'user' },
  { id: 'roles', label: 'Roles y Permisos', icon: 'shield' },
  { id: 'solicitudes', label: 'Solicitudes', icon: 'shield' },
  { id: 'configuracion', label: 'Configuración', icon: 'settings' },
  { id: 'conflictos', label: 'Conflictos Sync', icon: 'alert' },
  { id: 'audit-log', label: 'Auditoría', icon: 'shield' },
];

function Sidebar({ current, onNav, collapsed, onToggle, realtimeStatus = 'idle', onReconnectRealtime, plano = 'obra', area = null }) {
  const appMode = window.__useAppMode ? window.__useAppMode() : { mode: 'edicion', isPrueba: false, isEdicion: true, isProduccion: false, isImpersonating: false, roleOverride: null, clearRoleOverride: ()=>{}, superAdmin: false, setSuperAdmin: ()=>{}, canSuperAdmin: false };
  const { mode, isPrueba, isEdicion, isProduccion, isImpersonating, roleOverride, clearRoleOverride, superAdmin, setSuperAdmin, canSuperAdmin } = appMode;
  const [hovered, setHovered] = useState(null);
  const isMobile = useIsMobile();
  const pwa = usePwaInstall();
  const auth = window.__useAuth ? window.__useAuth() : null;
  const profile = auth?.profile;
  const isAdmin = profile?.rol === 'admin';
  // Revisores de solicitudes de cambio (ven el contador de pendientes): admin + Contador Jefe.
  const esRevisorSolic = isAdmin || profile?.rol === 'contador';

  // Modal "Mi Perfil" (auto-edición de nombres/apellidos, cualquier rol)
  const [showPerfil, setShowPerfil] = useState(false);

  // Re-render cuando admin cambia overrides de permisos
  const [permTick, setPermTick] = useState(0);
  useEffect(() => {
    const onPerms = () => setPermTick(t => t + 1);
    window.addEventListener('jx_perms_changed', onPerms);
    return () => window.removeEventListener('jx_perms_changed', onPerms);
  }, []);

  // Poll de solicitudes pendientes (solo admin)
  const [pendingReqCount, setPendingReqCount] = useState(0);
  useEffect(() => {
    if (!esRevisorSolic) { setPendingReqCount(0); return; }
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
  }, [esRevisorSolic]);

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
  // Pasa el PLANO del ítem clickeado (it.plano explícito o planoDe) para que el
  // shell sepa en qué plano renderizar — clave para los ítems duales como
  // 'movimientos-contables' (aparece en obra y en general).
  const handleNav = (id, planoItem) => {
    onNav(id, planoItem);
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

      {/* Filtra items por permisos del rol y oculta secciones que quedan vacías */}
      {(() => null)()}
      {/* Nav items */}
      <nav style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '8px 0' }}>
        {(() => {
          const userRol = profile?.rol;
          // Filtro de PLANO: cada ítem muestra en su plano (it.plano explícito, p.ej.
          // movimientos-contables aparece en obra Y en general; si no, planoDe(id)).
          // Filtro de ÁREA: solo en el plano general — cuando `area` viene seteada,
          // el sidebar muestra SOLO las secciones de esa área (Contabilidad ≠
          // Administración). Filtro de PERMISO: admin/sin-rol todo; resto via helper.
          const esPlano = (it) => (it.plano || planoDe(it.id)) === plano;
          const canSee = (!userRol || userRol === 'admin')
            ? (() => true)
            : ((id) => window.__canSeeSidebarItem?.(userRol, id) ?? true);
          const items = [];
          let curSecArea;   // área de la sección en curso (solo definida en el plano general)
          for (let i = 0; i < NAV.length; i++) {
            const it = NAV[i];
            if (it.section) {
              curSecArea = it.area;
              if (area && curSecArea !== area) continue;   // sección de otra área → oculta (con sus ítems)
              // Mirar adelante hasta la próxima sección — si hay >=1 ítem visible, agrego.
              let hasVisible = false;
              for (let j = i + 1; j < NAV.length && !NAV[j].section; j++) {
                if (esPlano(NAV[j]) && canSee(NAV[j].id)) { hasVisible = true; break; }
              }
              if (hasVisible) items.push({ ...it, _idx: i });
            } else {
              if (area && curSecArea !== area) continue;   // ítem de otra área
              if (esPlano(it) && canSee(it.id)) items.push({ ...it, _idx: i });
            }
          }
          return items;
        })().map((item) => {
          const i = item._idx;
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
              onClick={() => handleNav(item.id, item.plano || planoDe(item.id))}
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
              {item.id === 'solicitudes' && esRevisorSolic && pendingReqCount > 0 && !navCollapsed && (
                <span style={{ marginLeft: 'auto', minWidth: 18, height: 18, borderRadius: 9, background: '#F2B705', color: '#0D1822', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px', flexShrink: 0 }}>
                  {pendingReqCount > 99 ? '99+' : pendingReqCount}
                </span>
              )}
              {item.id === 'solicitudes' && esRevisorSolic && pendingReqCount > 0 && navCollapsed && (
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
            className={`badge ${isPrueba ? 'b-purple' : isEdicion ? 'b-amber' : 'b-green'}`}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: 0.5,
              padding: '5px 8px',
              background: isPrueba ? 'rgba(155,89,182,0.18)' : undefined,
              color: isPrueba ? '#9B59B6' : undefined,
              border: isPrueba ? '1px solid rgba(155,89,182,0.4)' : undefined,
            }}
            title={isPrueba ? 'Modo prueba — datos demo' : isEdicion ? 'Modo edición sobre data real' : 'Modo producción'}>
            {isPrueba ? '🧪 MODO PRUEBA' : isEdicion ? '✏️ EDICIÓN' : '🔒 PRODUCCIÓN'}
          </div>

          {/* Indicador de estado realtime */}
          <RealtimeStatusBadge status={realtimeStatus} onReconnect={onReconnectRealtime} />

          {/* Super Admin — toggle de edición de fechas históricas. Solo admin real. */}
          {canSuperAdmin && (
            <button
              onClick={() => {
                if (superAdmin) { setSuperAdmin(false); return; }
                if (confirm(
                  '⚡ ACTIVAR SUPER ADMIN\n\n' +
                  'Vas a poder editar FECHAS de movimientos (materiales, herramientas, EPP) ' +
                  'y la fecha de registro de los insumos.\n\n' +
                  'Usalo solo para cargar registros de días pasados al arrancar la obra. ' +
                  'Cada cambio queda en auditoría.\n\n' +
                  '¿Activar?'
                )) setSuperAdmin(true);
              }}
              style={{
                marginTop: 6, width: '100%', cursor: 'pointer',
                padding: '6px 8px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4,
                background: superAdmin ? 'rgba(231,76,60,0.18)' : 'rgba(255,255,255,0.04)',
                color: superAdmin ? '#E74C3C' : '#7A8A9A',
                border: superAdmin ? '1px solid rgba(231,76,60,0.5)' : '1px dashed rgba(255,255,255,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
              title={superAdmin ? 'Super Admin ACTIVO — click para desactivar' : 'Activar edición de fechas históricas'}>
              {superAdmin ? '⚡ SUPER ADMIN — fechas editables' : '🔓 Activar Super Admin'}
            </button>
          )}
          {/* Banner impersonación: visible cuando admin está viendo como otro rol */}
          {isImpersonating && (
            <div style={{
              marginTop: 6,
              padding: '6px 10px',
              background: 'rgba(231,76,60,0.15)',
              border: '1px solid rgba(231,76,60,0.5)',
              borderRadius: 6,
              fontSize: 10.5,
              color: '#E74C3C',
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              <div style={{ fontWeight:700, display:'flex', alignItems:'center', gap:6 }}>
                <span>🎭</span>
                <span>Viendo como <strong>{(roleOverride || '').replace('_', ' ')}</strong></span>
              </div>
              <button
                onClick={() => clearRoleOverride()}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(231,76,60,0.6)',
                  color: '#E74C3C',
                  fontSize: 10,
                  padding: '3px 6px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}>
                ← Volver a Admin
              </button>
            </div>
          )}
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
            <button
              onClick={() => setShowPerfil(true)}
              style={{ flex: 1, overflow: 'hidden', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
              title="Mi perfil — editar mis datos">
              <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#BFC7D1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={profile?.email}>{fullName}</span>
              <span style={{ display: 'block', fontSize: 10.5, color: '#4A5A6A', textTransform: 'capitalize' }}>{rolLabel}</span>
            </button>
            <button
              onClick={() => setShowPerfil(true)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4A5A6A', padding: 4, display: 'flex' }}
              title="Editar mis datos"
              onMouseEnter={e => e.currentTarget.style.color = '#F2B705'}
              onMouseLeave={e => e.currentTarget.style.color = '#4A5A6A'}>
              <JxIcon name="user" size={14} />
            </button>
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
    {showPerfil && <MiPerfilModal profile={profile} onClose={() => setShowPerfil(false)} />}
    </>
  );
}

// ─── MiPerfilModal ─────────────────────────────────────────────────
// Auto-edición de datos personales (nombres/apellidos) + cambio de contraseña
// propia. Disponible para CUALQUIER rol desde el chip de usuario. RLS permite a
// un usuario editar su propia fila de profiles; el cambio de contraseña usa
// supabase.auth.updateUser (sesión propia). Tras guardar nombres recargamos para
// refrescar el profile cacheado (useAuth no expone refresh).
function MiPerfilModal({ profile, onClose }) {
  const [nombres, setNombres] = useState(profile?.nombres || '');
  const [apellidos, setApellidos] = useState(profile?.apellidos || '');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const toast = (m, type) => { try { window.__showToast?.(m, type); } catch {} };

  const guardarDatos = async () => {
    setErr(''); setMsg('');
    const n = (nombres || '').trim(); const a = (apellidos || '').trim();
    if (!n && !a) { setErr('Indicá al menos un nombre o apellido.'); return; }
    setBusy(true);
    try {
      const sb = window.__supabase;
      if (!sb || !profile?.id) throw new Error('Sesión no disponible.');
      // SOLO nombres/apellidos (el trigger protect_profile_rol bloquea rol/activo).
      const { data, error } = await sb.from('profiles')
        .update({ nombres: n || null, apellidos: a || null })
        .eq('id', profile.id).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('No se pudo guardar (permisos).');
      toast('Datos actualizados', 'green');
      setTimeout(() => window.location.reload(), 600);
    } catch (e) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  const cambiarPass = async () => {
    setErr(''); setMsg('');
    if (!pass || pass.length < 8) { setErr('La contraseña debe tener al menos 8 caracteres.'); return; }
    if (pass !== pass2) { setErr('Las contraseñas no coinciden.'); return; }
    setBusy(true);
    try {
      const sb = window.__supabase;
      if (!sb) throw new Error('Sesión no disponible (offline).');
      const { error } = await sb.auth.updateUser({ password: pass });
      if (error) throw error;
      setPass(''); setPass2(''); setMsg('Contraseña actualizada.');
      toast('Contraseña actualizada', 'green');
    } catch (e) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(8,12,18,0.7)', backdropFilter:'blur(6px)', zIndex:9000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }} onClick={onClose}>
      <div style={{ width:'100%', maxWidth:440, background:'#1C2D40', border:'1px solid rgba(255,255,255,0.1)', borderRadius:14, padding:'24px 26px 20px', boxShadow:'0 24px 80px rgba(0,0,0,0.6)' }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <div style={{ fontSize:17, fontWeight:800, color:'#F0F2F5' }}>Mi Perfil</div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'#5A6A7A', cursor:'pointer', padding:4 }}><JxIcon name="x" size={16}/></button>
        </div>
        <div style={{ fontSize:12, color:'#5A6A7A', marginBottom:16 }}>{profile?.email}</div>

        {err && <div style={{ background:'rgba(231,76,60,0.1)', border:'1px solid rgba(231,76,60,0.25)', borderRadius:8, padding:'9px 13px', fontSize:12.5, color:'#EF6B5E', marginBottom:12 }}>{err}</div>}
        {msg && <div style={{ background:'rgba(46,204,113,0.08)', border:'1px solid rgba(46,204,113,0.25)', borderRadius:8, padding:'9px 13px', fontSize:12.5, color:'#7BD99B', marginBottom:12 }}>{msg}</div>}

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
          <div><label className="flabel">Nombres</label>
            <input className="fi" value={nombres} onChange={e=>setNombres(e.target.value)} autoFocus/></div>
          <div><label className="flabel">Apellidos</label>
            <input className="fi" value={apellidos} onChange={e=>setApellidos(e.target.value)}/></div>
        </div>
        <button className="btn btn-amber" disabled={busy} onClick={guardarDatos} style={{ width:'100%', justifyContent:'center', padding:'11px', marginBottom:18 }}>
          {busy ? 'Guardando…' : 'Guardar datos'}
        </button>

        <div style={{ borderTop:'1px solid rgba(255,255,255,0.08)', paddingTop:14 }}>
          <div style={{ fontSize:12.5, fontWeight:700, color:'#BFC7D1', marginBottom:10 }}>Cambiar mi contraseña</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
            <div><label className="flabel">Nueva (mín 8)</label>
              <input className="fi" type="password" value={pass} onChange={e=>setPass(e.target.value)}/></div>
            <div><label className="flabel">Repetir</label>
              <input className="fi" type="password" value={pass2} onChange={e=>setPass2(e.target.value)}/></div>
          </div>
          <button className="btn btn-ghost" disabled={busy} onClick={cambiarPass} style={{ width:'100%', justifyContent:'center', padding:'10px' }}>
            {busy ? 'Aplicando…' : 'Actualizar contraseña'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── RealtimeStatusBadge ───────────────────────────────────────────
// Muestra el estado del canal Supabase Realtime debajo del badge de modo.
// connected → 🟢 EN VIVO (cambios llegan al instante)
// connecting → 🟡 CONECTANDO… (suscripción en curso)
// error      → 🔴 SIN REALTIME (canal cayó, click para reconectar)
// offline    → ⚪ SIN CONEXIÓN (browser sin red)
// idle       → no se renderiza (todavía no hay user)
function RealtimeStatusBadge({ status, onReconnect }) {
  if (!status || status === 'idle') return null;
  const cfg = {
    connected:  { icon: '🟢', label: 'EN VIVO',         bg: 'rgba(46,204,113,0.12)',  fg: '#2ECC71',  border: 'rgba(46,204,113,0.4)',  title: 'Realtime conectado. Los cambios entre dispositivos llegan al instante.' },
    connecting: { icon: '🟡', label: 'CONECTANDO…',     bg: 'rgba(242,183,5,0.12)',   fg: '#F2B705',  border: 'rgba(242,183,5,0.4)',   title: 'Suscribiendo al canal de cambios en vivo…' },
    error:      { icon: '🔴', label: 'SIN REALTIME',    bg: 'rgba(231,76,60,0.12)',   fg: '#E74C3C',  border: 'rgba(231,76,60,0.4)',   title: 'El canal cayó. Los cambios pueden tardar hasta 30s. Click para reintentar.' },
    offline:    { icon: '⚪', label: 'SIN CONEXIÓN',    bg: 'rgba(149,165,166,0.12)', fg: '#95A5A6',  border: 'rgba(149,165,166,0.4)', title: 'Tu dispositivo está offline. Los cambios se sincronizan al volver online.' },
  }[status] || null;
  if (!cfg) return null;
  const clickable = status === 'error' && typeof onReconnect === 'function';
  return (
    <div
      onClick={clickable ? onReconnect : undefined}
      title={cfg.title + (clickable ? ' (Click para reconectar)' : '')}
      style={{
        marginTop: 6,
        padding: '4px 8px',
        background: cfg.bg,
        color: cfg.fg,
        border: `1px solid ${cfg.border}`,
        borderRadius: 6,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.4,
        textAlign: 'center',
        cursor: clickable ? 'pointer' : 'default',
        userSelect: 'none',
      }}>
      {cfg.icon} {cfg.label}
    </div>
  );
}

Object.assign(window, { Sidebar, NAV });