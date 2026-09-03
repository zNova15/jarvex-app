import React from "react";
import { planoDe } from "../lib/nav-planos.js";
import { esRolGlobal } from "../lib/obras-asignadas.js";
import "../lib/tema.js"; // expone window.__jxTema (no exporta componentes, solo el side-effect)
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
  // ── TRABAJOS: la entrada de primer nivel (tanda 2, entrega A) ──
  // Va primera porque es donde arranca el trabajo diario. Antes el camino a una
  // obra pasaba por la sección de Empresas, que no tiene nada que ver.
  { section: 'TRABAJOS', area: 'trabajos' },
  { id: 'trabajos', label: 'Todos los trabajos', icon: 'hardHat' },
  { id: 'obras', label: 'Obras / Proyectos', icon: 'building' },
  { id: 'bienes-servicios', label: 'Bienes y Servicios', icon: 'package' },

  // ── EMPRESAS: bloque hermano de Contabilidad, con área propia ──
  // Entrar al catálogo de empresas mostraba las 22 secciones contables en el
  // menú. El catálogo es su propio bloque: empresas y las entidades externas
  // con las que operan.
  { section: 'EMPRESAS', area: 'empresas' },
  { id: 'empresas', label: 'Todas las empresas', icon: 'building' },
  { id: 'proveedores', label: 'Proveedores', icon: 'truck' },

  // ── DENTRO DE UNA EMPRESA (tanda 2F) ──────────────────────────────
  // Con una empresa activa, estas MISMAS páginas son su contabilidad, no la
  // del grupo: el menú lo dice y no ofrece el resto. Los ids se repiten a
  // propósito con la sección de abajo — el filtro por área muestra una u
  // otra, nunca las dos (mismo recurso que usa 'movimientos-contables' para
  // vivir en los dos planos).
  { section: 'CONTABILIDAD DE ESTA EMPRESA', area: 'empresa' },
  { id: 'empresas', label: '← Volver a la empresa', icon: 'building' },
  { id: 'cont-dashboard', label: 'Dashboard contable', icon: 'dashboard' },
  { id: 'movimientos-contables', label: 'Movimientos', icon: 'dollar', plano: 'general' },
  { id: 'comprobantes', label: 'Comprobantes electrónicos', icon: 'file' },
  { id: 'guias-remision', label: 'Guías de Remisión', icon: 'truck' },
  { id: 'compras-categoria', label: 'Compras por Categoría', icon: 'layers' },
  { id: 'libro-diario', label: 'Libro Diario / Asientos', icon: 'list' },
  { id: 'plan-cuentas', label: 'Plan de Cuentas (PCGE)', icon: 'list' },
  { id: 'estado-resultados', label: 'Estado de Resultados', icon: 'chart' },
  { id: 'balance-general', label: 'Balance General', icon: 'chart' },
  { id: 'libros-electronicos', label: 'Libros Electrónicos PLE', icon: 'file' },
  { id: 'flujo-caja', label: 'Flujo de Caja / Pagos', icon: 'calendar' },
  { id: 'intercompany', label: 'Operaciones entre Empresas', icon: 'compare' },

  { section: 'GENERAL', area: 'general' },
  { id: 'captura-magica', label: '✨ Captura Mágica', icon: 'upload' },
  { id: 'captura-campo', label: '📸 Subir Factura (campo)', icon: 'camera' },
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'reportes', label: 'Reportes', icon: 'chart' },

  // ── EL WORKSPACE DE UN TRABAJO (tanda 2, entrega B) ────────────────
  // Las secciones del plano OBRA agrupadas como Gabriel las nombró. Antes eran
  // 11 encabezados (almacén, compras, maquinaria, ingeniería, gestión,
  // contabilidad, ssoma, ambiental, calidad, social, rrhh): entrar a una obra
  // no mostraba "la obra", mostraba el menú entero. El orden y la pertenencia
  // los define src/lib/desglose-obra.js — un test falla si una página de obra
  // queda sin grupo, porque desaparecería del Panel del trabajo sin avisar.
  { section: 'ESTE TRABAJO' },
  { id: 'panel-obra', label: 'Panel del trabajo', icon: 'hardHat' },

  { section: 'ALMACÉN' },
  { id: 'materiales', label: 'Materiales', icon: 'package' },
  { id: 'mov-materiales', label: 'Mov. de Materiales', icon: 'arrowIn' },
  { id: 'herramientas', label: 'Herramientas', icon: 'tool' },
  { id: 'mov-herramientas', label: 'Mov. Herramientas', icon: 'arrowOut' },
  { id: 'ubicaciones', label: 'Ubicaciones de Obra', icon: 'map' },
  { id: 'compras-pendientes', label: 'Vinculación de Compras', icon: 'arrowIn' },
  { id: 'caja-chica', label: 'Caja Chica', icon: 'dollar' },
  { id: 'evidencias', label: 'Evidencias', icon: 'camera' },
  { id: 'plantillas', label: 'Plantillas', icon: 'file' },

  { section: 'LOGÍSTICA' },
  { id: 'solicitud-residente', label: 'Solicitud de Insumos', icon: 'plus' },
  { id: 'requisiciones', label: 'Requisiciones', icon: 'list' },
  { id: 'ordenes-compra', label: 'Órdenes de Compra', icon: 'package' },

  { section: 'DIRECCIÓN', area: 'direccion' },
  { id: 'dashboard-ejecutivo', label: 'Dashboard Ejecutivo', icon: 'dashboard' },
  { id: 'kpis-obra', label: 'KPIs por Obra', icon: 'trending' },
  { id: 'cumplimiento-cronograma', label: 'Cumplimiento Cronograma', icon: 'calendar' },
  { id: 'alertas', label: 'Centro de Alertas', icon: 'bell' },
  { id: 'busqueda', label: 'Búsqueda Global', icon: 'search' },

  // Gestión de obra incluye maquinaria y la ingeniería de frente: es la misma
  // obra mirada desde el frente, no un área aparte (el rol `ingeniero` ve acá
  // sus 9 pantallas y nada más, igual que antes).
  { section: 'GESTIÓN DE OBRA' },
  { id: 'dashboard-gestion', label: 'Dashboard Gestión de Obra', icon: 'dashboard' },
  { id: 'panel-residente', label: 'Panel del Residente', icon: 'hardHat' },
  { id: 'importar', label: 'Importar Presupuesto', icon: 'upload' },
  { id: 'partidas', label: 'Partidas', icon: 'list' },
  { id: 'insumos', label: 'Insumos por Partida', icon: 'layers' },
  { id: 'control-consumo', label: 'Control de Consumo', icon: 'trending' },
  { id: 'versiones', label: 'Versiones de Presupuesto', icon: 'compare' },
  { id: 'cronograma', label: 'Cronograma / Gantt', icon: 'gantt' },
  { id: 'avance', label: 'Avance de Obra', icon: 'hardHat' },
  { id: 'movimientos-insumos', label: 'Movimientos de Insumos', icon: 'inbox' },
  { id: 'comparativo', label: 'Planificado vs Real', icon: 'compare' },
  { id: 'costos', label: 'Costos', icon: 'dollar' },
  { id: 'valorizaciones', label: 'Valorizaciones', icon: 'dollar' },
  { id: 'incidencias', label: 'Incidencias', icon: 'alert' },
  { id: 'activos-pesados', label: 'Equipos Pesados', icon: 'tool' },
  { id: 'mantenimiento-programado', label: 'Mantenimiento Programado', icon: 'tool' },

  // Los INGENIEROS DE CAMPO (civiles que siguen el avance por zonas y frentes,
  // y lideran el frente que se apertura) tienen bloque propio desde el
  // 3-sep-2026: es un nivel distinto del de los especialistas, que miran la
  // obra entera. El orden y la pertenencia los define desglose-obra.js.
  { section: 'INGENIEROS Y FRENTES' },
  { id: 'frentes', label: 'Frentes de Trabajo', icon: 'flag' },
  { id: 'dashboard-tecnico', label: 'Dashboard Técnico', icon: 'dashboard' },
  { id: 'mis-partidas', label: 'Partidas del Proyecto', icon: 'list' },
  { id: 'cronograma-frente', label: 'Cronograma de mis Partidas', icon: 'calendar' },
  { id: 'salidas-frente', label: 'Vinculación de insumos', icon: 'link' },
  { id: 'vinculacion-salidas', label: 'Vinculación de Salidas', icon: 'link' },
  { id: 'reporte-diario', label: 'Reporte Diario', icon: 'edit' },
  { id: 'borradores-reporte', label: 'Borradores', icon: 'copy' },
  { id: 'mis-reportes', label: 'Mis Reportes', icon: 'list' },
  { id: 'plan-real', label: 'Plan vs Real', icon: 'trending' },
  { id: 'emitir-alerta', label: 'Emitir Alerta', icon: 'alert' },
  { id: 'aprobaciones-reporte', label: 'Aprobación de Frentes', icon: 'flag' },
  { id: 'rendimiento-ingenieros', label: 'Rendimiento de Ingenieros', icon: 'trendUp' },

  { section: 'PERSONAL Y SUBCONTRATOS' },
  { id: 'personal', label: 'Personal', icon: 'users' },
  { id: 'asistencia', label: 'Asistencia', icon: 'calendar' },
  { id: 'personal-contratos', label: 'Contratos Laborales', icon: 'shield' },
  { id: 'planillas', label: 'Planillas / Sueldos', icon: 'user' },
  { id: 'cts', label: 'CTS', icon: 'dollar' },
  { id: 'gratificaciones', label: 'Gratificaciones', icon: 'dollar' },
  { id: 'plame', label: 'PLAME / T-Registro SUNAT', icon: 'list' },
  { id: 'subcontratistas', label: 'Subcontratistas', icon: 'users' },
  { id: 'subcontratos', label: 'Subcontratos', icon: 'package' },
  { id: 'subcontrato-valorizaciones', label: 'Valorizaciones de Subcontrato', icon: 'dollar' },

  // Seguridad, ambiental, calidad y social bajo un solo encabezado: cada
  // especialista ve SOLO sus páginas (el gate por rol no cambió), pero el
  // trabajo ya no aparenta tener cuatro áreas separadas.
  { section: 'SECCIONES ESPECIALES' },
  { id: 'reporte-especialidad', label: 'Reporte Diario (especialidad)', icon: 'edit' },
  { id: 'charlas-plan', label: 'Planificador de Charlas', icon: 'calendar' },
  { id: 'sctr-personal', label: 'SCTR del Personal', icon: 'shield' },
  { id: 'inducciones', label: 'Inducciones', icon: 'check' },
  { id: 'charlas-seguridad', label: 'Charlas de 5 minutos', icon: 'alert' },
  { id: 'iperc', label: 'IPERC (riesgos)', icon: 'alert' },
  { id: 'inspecciones-seguridad', label: 'Inspecciones', icon: 'shield' },
  { id: 'capacitaciones', label: 'Capacitaciones', icon: 'users' },
  { id: 'epps-inventario', label: 'EPPs (inventario)', icon: 'shield' },
  { id: 'mov-epp', label: 'Mov. de EPPs', icon: 'arrowOut' },
  { id: 'epp', label: 'Entregas EPP', icon: 'check' },
  { id: 'insumos-persona', label: 'Insumos por Persona', icon: 'users' },
  { id: 'insumos-emergencia', label: 'Insumos de Emergencia', icon: 'package' },
  { id: 'gestion-ambiental', label: 'Gestión Ambiental (ISO 14001)', icon: 'map' },
  { id: 'gestion-calidad', label: 'Gestión de Calidad (Certificados)', icon: 'checkCircle' },
  { id: 'gestion-social', label: 'Gestión Social (Comunidad)', icon: 'users' },

  { section: 'CONTABILIDAD DE LA OBRA' },
  { id: 'movimientos-contables', label: 'Movimientos de esta obra', icon: 'dollar', plano: 'obra' },
  { id: 'conciliacion-insumos', label: 'Conciliación de Insumos', icon: 'compare' },
  { id: 'pagos', label: 'Pagos', icon: 'dollar' },

  // La cadena proveedor → empresas del grupo → ejecutora es DE UNA OBRA: vivía
  // en el bloque general de contabilidad, donde nunca se usó (0 filas).
  { section: 'CADENAS INTERCOMPANY' },
  { id: 'trazabilidad', label: 'Cadenas de esta obra', icon: 'compare' },

  { section: 'EMPRESAS Y CONTABILIDAD', area: 'contabilidad' },
  // Primero el resumen por entidad (tanda 2D): es la puerta del bloque, y desde
  // ahí se entra a la contabilidad de cada empresa y de cada trabajo.
  { id: 'contabilidad', label: 'Resumen por entidad', icon: 'list' },
  { id: 'cont-dashboard', label: 'Dashboard Contable', icon: 'dashboard' },

  { id: 'movimientos-contables', label: 'Movimientos (todas / por obra)', icon: 'dollar', plano: 'general' },
  { id: 'guias-remision', label: 'Guías de Remisión', icon: 'truck' },
  { id: 'intercompany', label: 'Operaciones entre Empresas', icon: 'compare' },
  { id: 'compras-categoria', label: 'Compras por Categoría', icon: 'layers' },
  { id: 'analisis-insumos', label: 'Análisis de Insumos', icon: 'compare' },
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

  { section: 'LICITACIONES', area: 'licitaciones' },
  { id: 'profesionales', label: 'Registro Profesional', icon: 'users' },

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
    // Antes: COUNT al server cada 30 s (~1.000-2.900 req/día por admin).
    // Ahora: recontar solo cuando cambian las solicitudes (evento local o
    // realtime) con debounce, y un fallback lento de 5 min por si algo se pierde.
    let deb = null;
    const onCambio = (e) => {
      const t = e?.detail?.tabla;
      if (t && t !== 'change_requests') return;
      clearTimeout(deb);
      deb = setTimeout(poll, 2000);
    };
    window.addEventListener('jx_data_changed', onCambio);
    const id = setInterval(poll, 300000);
    return () => { cancelled = true; clearInterval(id); clearTimeout(deb); window.removeEventListener('jx_data_changed', onCambio); };
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
    background: 'var(--bg-header)',
    borderRight: '1px solid var(--border)',
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
    background: 'var(--bg-header)',
    borderRight: '1px solid var(--border)',
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
      <div style={{ padding: navCollapsed ? '14px 8px' : '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: navCollapsed ? 'center' : 'flex-start', gap: 12, minHeight: 64 }}>
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
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--tp)', letterSpacing: -.4, lineHeight: 1.1 }}>JARVEX</div>
            <div style={{ fontSize: 9.5, color: 'var(--tm)', fontWeight: 500, letterSpacing: .04, lineHeight: 1.3, marginTop: 2 }}>TECNOLOGÍA · INGENIERÍA</div>
          </div>
        )}
        {isMobile && !navCollapsed && (
          <button onClick={onToggle} aria-label="Cerrar menú"
                  style={{ background: 'none', border: 'none', color: 'var(--tm)', cursor: 'pointer', padding: 6, display: 'flex' }}>
            <JxIcon name="x" size={16} />
          </button>
        )}
      </div>

      {/* Filtra items por permisos del rol y oculta secciones que quedan vacías */}
      {(() => null)()}
      {/* Volver a la pantalla principal — SIEMPRE visible (tanda 2, entrega A).
          El sidebar muestra solo el área en la que estás; sin una salida fija,
          volver a los bloques de primer nivel dependía de adivinar. */}
      {/* Un usuario de OBRA no tiene nada que hacer en la pantalla de bloques
          del grupo: de los cinco solo puede abrir uno. Su "arriba" es la lista
          de SUS trabajos (tanda 2D). Para los roles globales no cambia nada. */}
      {(() => {
        // El rol `campo` (cuenta compartida con PIN) no tiene "arriba": su
        // única pantalla es el portal de captura.
        if (profile?.rol === 'campo') return null;
        const global = esRolGlobal(profile?.rol);
        const destino = global ? 'inicio' : 'trabajos';
        const label = global ? 'Pantalla principal' : 'Mis trabajos';
        if (current === destino) return null;
        return (
        <button type="button" onClick={() => onNav?.(destino, 'general')}
          title={global ? 'Volver a la pantalla principal' : 'Volver a la lista de mis trabajos'}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            padding: collapsed ? '10px 0' : '10px 14px',
            justifyContent: collapsed ? 'center' : 'flex-start',
            background: 'none', border: 0, borderBottom: '1px solid var(--border)',
            color: 'var(--tm)', cursor: 'pointer', fontSize: 12, fontWeight: 600,
          }}>
          <JxIcon name="chevL" size={14}/>
          {!collapsed && <span>{label}</span>}
        </button>
        );
      })()}

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
            if (navCollapsed) return <div key={i} style={{ height: 1, background: 'var(--tint-neutral)', margin: '8px 10px' }} />;
            return (
              <div key={i} style={{ padding: '14px 16px 5px', fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--tm)' }}>
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
                background: isActive ? 'var(--amber-l)' : isHov ? 'var(--tint-neutral)' : 'transparent',
                border: 'none',
                borderLeft: isActive ? '2.5px solid var(--amber)' : '2.5px solid transparent',
                borderRadius: navCollapsed ? 0 : '0 6px 6px 0',
                padding: navCollapsed ? '10px 0' : (isMobile ? '12px 16px' : '9px 14px'),
                cursor: 'pointer',
                color: isActive ? 'var(--amber)' : isHov ? 'var(--ts)' : 'var(--tm)',
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
              <JxIcon name={item.icon} size={isMobile ? 17 : 15} color={isActive ? 'var(--amber)' : isHov ? 'var(--ts)' : 'var(--tm)'} />
              {!navCollapsed && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>}
              {item.id === 'solicitudes' && esRevisorSolic && pendingReqCount > 0 && !navCollapsed && (
                <span style={{ marginLeft: 'auto', minWidth: 18, height: 18, borderRadius: 9, background: 'var(--amber)', color: '#0D1822', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px', flexShrink: 0 }}>
                  {pendingReqCount > 99 ? '99+' : pendingReqCount}
                </span>
              )}
              {item.id === 'solicitudes' && esRevisorSolic && pendingReqCount > 0 && navCollapsed && (
                <span style={{ position: 'absolute', top: 6, right: 8, minWidth: 14, height: 14, borderRadius: 7, background: 'var(--amber)', color: '#0D1822', fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>
                  {pendingReqCount > 9 ? '9+' : pendingReqCount}
                </span>
              )}
              {item.id === 'alertas' && alertasCount > 0 && !navCollapsed && (
                <span style={{ marginLeft: 'auto', minWidth: 18, height: 18, borderRadius: 9, background: 'var(--red)', color: '#fff', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px', flexShrink: 0 }}>
                  {alertasCount > 99 ? '99+' : alertasCount}
                </span>
              )}
              {item.id === 'alertas' && alertasCount > 0 && navCollapsed && (
                <span style={{ position: 'absolute', top: 6, right: 8, minWidth: 14, height: 14, borderRadius: 7, background: 'var(--red)', color: '#fff', fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>
                  {alertasCount > 9 ? '9+' : alertasCount}
                </span>
              )}
              {item.id !== 'solicitudes' && item.id !== 'alertas' && !navCollapsed && isActive && <div style={{ marginLeft: 'auto', width: 5, height: 5, borderRadius: '50%', background: 'var(--amber)', flexShrink: 0 }} />}
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
              color: isPrueba ? 'var(--purple)' : undefined,
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
                background: superAdmin ? 'rgba(231,76,60,0.18)' : 'var(--tint-neutral)',
                color: superAdmin ? 'var(--red)' : 'var(--tm)',
                border: superAdmin ? '1px solid rgba(231,76,60,0.5)' : '1px dashed var(--border-h)',
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
              color: 'var(--red)',
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
                  color: 'var(--red)',
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
        <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)' }}>
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
      <div style={{ padding: navCollapsed ? '12px 8px' : '12px 14px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,var(--bg-c2),var(--bg-c))', border: '1.5px solid rgba(242,183,5,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--amber)', flexShrink: 0 }}>
          {initials}
        </div>
        {!navCollapsed && (
          <>
            {/* Rol campo (cuenta COMPARTIDA con PIN): sin "Mi Perfil" — cualquiera
                podría cambiar la contraseña y dejar fuera al resto del personal
                (hallazgo de Gabriel, 31-ago). Solo nombre visible + Cerrar sesión. */}
            {profile?.rol === 'campo' ? (
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ts)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fullName}</span>
                <span style={{ display: 'block', fontSize: 10.5, color: 'var(--tm)' }}>Cuenta de campo</span>
              </div>
            ) : (
            <>
            <button
              onClick={() => setShowPerfil(true)}
              style={{ flex: 1, overflow: 'hidden', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
              title="Mi perfil — editar mis datos">
              <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ts)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={profile?.email}>{fullName}</span>
              <span style={{ display: 'block', fontSize: 10.5, color: 'var(--tm)', textTransform: 'capitalize' }}>{rolLabel}</span>
            </button>
            <button
              onClick={() => setShowPerfil(true)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tm)', padding: 4, display: 'flex' }}
              title="Editar mis datos"
              onMouseEnter={e => e.currentTarget.style.color = 'var(--amber)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--tm)'}>
              <JxIcon name="user" size={14} />
            </button>
            </>
            )}
            <button
              onClick={() => auth?.logout?.()}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tm)', padding: 4, display: 'flex' }}
              title="Cerrar sesión"
              onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--tm)'}>
              <JxIcon name="logout" size={14} />
            </button>
          </>
        )}
      </div>
    </aside>
    {showPerfil && profile?.rol !== 'campo' && <MiPerfilModal profile={profile} onClose={() => setShowPerfil(false)} />}
    </>
  );
}

// ─── MiPerfilModal ─────────────────────────────────────────────────
// Auto-edición de datos personales (nombres/apellidos) + cambio de contraseña
// propia. Disponible para CUALQUIER rol desde el chip de usuario. RLS permite a
// un usuario editar su propia fila de profiles; el cambio de contraseña usa
// supabase.auth.updateUser (sesión propia). Tras guardar nombres recargamos para
// refrescar el profile cacheado (useAuth no expone refresh).
// ── Toggle de tema (🌙/☀️) ─────────────────────────────────────────────
// Una sola implementación para los dos lugares donde se cambia el tema:
// Mi Perfil (segmentado, con las dos opciones a la vista) y la cabecera del
// Inicio (compacto — ahí no hay sidebar ni Mi Perfil, pedido de Gabriel 1-sep).
// Se expone en window.TemaToggle porque jx-sidebar es EAGER: los chunks lazy
// (jx-inicio) lo consumen como global, sin import cruzado que parta un chunk
// nuevo (regla crítica 1 del repo).
function TemaToggle({ compacto = false }) {
  const [tema, setTemaUI] = useState(() => (window.__jxTema?.get?.() || 'dark'));
  const elegir = (t) => {
    if (t === tema) return;
    setTemaUI(t);              // feedback inmediato; cambiarTema recarga a los 150ms
    window.__jxTema?.cambiar?.(t);
  };

  if (compacto) {
    const otro = tema === 'light' ? 'dark' : 'light';
    return (
      <button className="btn btn-ghost btn-sm" onClick={() => elegir(otro)}
              title={`Cambiar al tema ${otro === 'light' ? 'claro' : 'oscuro'}`}>
        {tema === 'light' ? '🌙 Oscuro' : '☀️ Claro'}
      </button>
    );
  }

  return (
    <div style={{ display:'flex', gap:8, background:'var(--tint-neutral)', borderRadius:8, padding:4 }}>
      {[{ v:'dark', lbl:'🌙 Oscuro' }, { v:'light', lbl:'☀️ Claro' }].map(op => (
        <button key={op.v} onClick={() => elegir(op.v)}
          style={{
            flex:1, padding:'8px 10px', borderRadius:6, border:'none', cursor:'pointer',
            fontSize:12.5, fontWeight:600, fontFamily:'inherit',
            background: tema === op.v ? 'var(--amber)' : 'transparent',
            color: tema === op.v ? '#0c1118' : 'var(--tm)',
          }}>
          {op.lbl}
        </button>
      ))}
    </div>
  );
}

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
      <div style={{ width:'100%', maxWidth:440, background:'var(--bg-c)', border:'1px solid var(--border-h)', borderRadius:14, padding:'24px 26px 20px', boxShadow:'0 24px 80px rgba(0,0,0,0.6)' }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <div style={{ fontSize:17, fontWeight:800, color:'var(--tp)' }}>Mi Perfil</div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--tm)', cursor:'pointer', padding:4 }}><JxIcon name="x" size={16}/></button>
        </div>
        <div style={{ fontSize:12, color:'var(--tm)', marginBottom:16 }}>{profile?.email}</div>

        {err && <div style={{ background:'rgba(231,76,60,0.1)', border:'1px solid rgba(231,76,60,0.25)', borderRadius:8, padding:'9px 13px', fontSize:12.5, color:'var(--red)', marginBottom:12 }}>{err}</div>}
        {msg && <div style={{ background:'rgba(46,204,113,0.08)', border:'1px solid rgba(46,204,113,0.25)', borderRadius:8, padding:'9px 13px', fontSize:12.5, color:'var(--green)', marginBottom:12 }}>{msg}</div>}

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
          <div><label className="flabel">Nombres</label>
            <input className="fi" value={nombres} onChange={e=>setNombres(e.target.value)} autoFocus/></div>
          <div><label className="flabel">Apellidos</label>
            <input className="fi" value={apellidos} onChange={e=>setApellidos(e.target.value)}/></div>
        </div>
        <button className="btn btn-amber" disabled={busy} onClick={guardarDatos} style={{ width:'100%', justifyContent:'center', padding:'11px', marginBottom:18 }}>
          {busy ? 'Guardando…' : 'Guardar datos'}
        </button>

        <div style={{ borderTop:'1px solid var(--border)', paddingTop:14, marginBottom:18 }}>
          <div style={{ fontSize:12.5, fontWeight:700, color:'var(--ts)', marginBottom:10 }}>Apariencia</div>
          <TemaToggle />
        </div>

        <div style={{ borderTop:'1px solid var(--border)', paddingTop:14 }}>
          <div style={{ fontSize:12.5, fontWeight:700, color:'var(--ts)', marginBottom:10 }}>Cambiar mi contraseña</div>
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
    connected:  { icon: '🟢', label: 'EN VIVO',         bg: 'rgba(46,204,113,0.12)',  fg: 'var(--green)',  border: 'rgba(46,204,113,0.4)',  title: 'Realtime conectado. Los cambios entre dispositivos llegan al instante.' },
    connecting: { icon: '🟡', label: 'CONECTANDO…',     bg: 'rgba(242,183,5,0.12)',   fg: 'var(--amber)',  border: 'rgba(242,183,5,0.4)',   title: 'Suscribiendo al canal de cambios en vivo…' },
    error:      { icon: '🔴', label: 'SIN REALTIME',    bg: 'rgba(231,76,60,0.12)',   fg: 'var(--red)',  border: 'rgba(231,76,60,0.4)',   title: 'El canal cayó. Los cambios pueden tardar hasta 30s. Click para reintentar.' },
    offline:    { icon: '⚪', label: 'SIN CONEXIÓN',    bg: 'rgba(149,165,166,0.12)', fg: 'var(--tm)',  border: 'rgba(149,165,166,0.4)', title: 'Tu dispositivo está offline. Los cambios se sincronizan al volver online.' },
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

Object.assign(window, { Sidebar, NAV, TemaToggle });