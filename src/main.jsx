// IMPORTANTE: Sentry DEBE inicializar antes que cualquier otro código
// para capturar errores de imports y bootstrap. Por eso este import va
// PRIMERO. Ver src/instrument.js para la configuración.
import './instrument.js';
import * as Sentry from '@sentry/react';
// PostHog: telemetría de uso (qué pantallas se usan, clicks, flows).
// Se inicializa aquí también temprano para que capture el primer pageview.
import { initPostHog } from './lib/posthog.js';
initPostHog();

// Exponer Sentry en window para tests manuales desde DevTools.
// Útil para validar que la captura funciona:
//   window.Sentry.captureException(new Error('test'));
//   window.Sentry.captureMessage('hello sentry', 'info');
// El DSN ya está inicializado en instrument.js — solo expone el SDK.
if (typeof window !== 'undefined') {
  window.Sentry = Sentry;
}

import React from 'react';
import ReactDOM from 'react-dom/client';
// Chart.js se carga lazy via src/lib/chart-loader (-250 KB del bundle inicial)
import { AuthContext, useAuthProvider, useAuth } from './hooks/useAuth';
import { useSync } from './hooks/useSync';
import { useOnline } from './hooks/useOnline';
import { useAppMode } from './hooks/useAppMode';
import { useRealtimeNotifications } from './hooks/useRealtimeNotifications';
import { useObraActiva, getObraActivaIdSync, setObraActivaId } from './hooks/useObraActiva';
import {
  useObras, usePersonal, useMateriales, useHerramientas,
  useUbicacionesObra, useFrentesObra, useFrentePartidas,
  useMovimientosMateriales, useMovimientosHerramientas, useMovimientosMaquinaria,
  useAsistencia, usePartidas, useAvanceObra, useAvanceMetas, useIncidencias,
  useEvidencias, useConflicts,
  usePresupuestosVersiones, usePartidasVersionadas,
  useMaterialPreciosHistorial, useHistorialPersonal, usePersonalCuentas,
  useCompanies, useAccountingMovements, useIntercompanyTransactions, useTrazabilidadCadenas,
  useRequisiciones, useOrdenesCompra,
  useValorizaciones,
  useCuentasBancarias, useCronogramaPagos, useMovimientosBancarios,
  useActivosPesados, useHorasMaquina,
  useCharlasSeguridad, useIperc, useEppEntregas, useInspeccionesSeguridad, useCapacitaciones,
  useEpps, useMovimientosEpp,
  useCajaChica, useInsumosEmergencia, useMovInsumosEmergencia,
  useSubcontratistas, useSubcontratos, useSubcontratoValorizaciones,
  usePersonalContrato, usePlanillas, usePlanillaBoletas,
} from './hooks/useOfflineData';
import { syncAll } from './sync/SyncEngine';
import { uploadPendingEvidencias, saveEvidenciaLocal } from './sync/EvidenceUploader';
import { db, newId } from './db/jarvex.db';
import { supabase } from './lib/supabase';
// reports.js + excel.js ya hacen lazy load internamente de jsPDF y xlsx —
// importarlos acá NO trae las libs pesadas al bundle inicial.
import { generatePDF, downloadPDF, generateExcel } from './lib/reports';
import { parseExcelFile, downloadTemplate, MODULES as IMPORT_MODULES } from './lib/excel';
// contabilidad-pdfs / apuParser / pdfBudgetParser: imports estáticos. Vite
// los pondrá en su propio chunk porque sus deps (jsPDF, xlsx) ya son lazy
// desde reports.js, así que no engordan el bundle inicial.
import * as contabilidadPdfs from './lib/contabilidad-pdfs';
import { parseAPUFile, parseS10File, enrichJerarquia, buildArbol, parseAPU, parseInsumosList, parseGantt, detectS10Type, excelDateToISO, parseTablaCostos, parsePresupuestoObra } from './lib/apuParser';
import { parsePresupuestoPDF, extractTextFromPDF, parsePresupuestoLines, partidasToImportRows } from './lib/pdfBudgetParser';
import * as catalogos from './lib/catalogos';
import { seedDemoData, clearDemoData, countDemoRecords } from './lib/demoSeeder';
import { consultarRUC, consultarDNI } from './lib/identity';
import { logAudit } from './lib/audit';
import {
  createChangeRequest,
  listChangeRequests,
  approveChangeRequest,
  rejectChangeRequest,
  cancelChangeRequest,
  syncPendingChangeRequests,
  countPendingChangeRequests,
} from './lib/changeRequests';
import './index.css';

// DB + hooks expuestos globalmente para los componentes JSX heredados.
// (window.Chart ahora se setea lazy desde lib/chart-loader.js cuando algún
// componente con <canvas> lo necesita.)
window.__db = db;
window.__supabase = supabase;
window.__newId = newId;
window.__useAuth = useAuth;
window.__useSync = useSync;
window.__useOnline = useOnline;
window.__useAppMode = useAppMode;
window.__useRealtimeNotifications = useRealtimeNotifications;
window.__useObraActiva = useObraActiva;
window.__getObraActivaId = getObraActivaIdSync;
window.__setObraActivaId = setObraActivaId;
window.__hooks = {
  useObras, usePersonal, useMateriales, useHerramientas,
  useUbicacionesObra, useFrentesObra, useFrentePartidas,
  useMovimientosMateriales, useMovimientosHerramientas, useMovimientosMaquinaria,
  useAsistencia, usePartidas, useAvanceObra, useAvanceMetas, useIncidencias,
  useEvidencias, useConflicts,
  usePresupuestosVersiones, usePartidasVersionadas,
  useMaterialPreciosHistorial, useHistorialPersonal, usePersonalCuentas,
  useCompanies, useAccountingMovements, useIntercompanyTransactions, useTrazabilidadCadenas,
  useRequisiciones, useOrdenesCompra,
  useValorizaciones,
  useCuentasBancarias, useCronogramaPagos, useMovimientosBancarios,
  useActivosPesados, useHorasMaquina,
  useCharlasSeguridad, useIperc, useEppEntregas, useInspeccionesSeguridad, useCapacitaciones,
  useEpps, useMovimientosEpp,
  useCajaChica, useInsumosEmergencia, useMovInsumosEmergencia,
  useSubcontratistas, useSubcontratos, useSubcontratoValorizaciones,
  usePersonalContrato, usePlanillas, usePlanillaBoletas,
};
window.__saveEvidenciaLocal = saveEvidenciaLocal;
window.__reports = { generatePDF, downloadPDF, generateExcel };
// Plantillas imprimibles (PDF en blanco para llenar a mano en obra).
// Lazy-loaded: solo se carga jspdf al hacer click en "Descargar plantilla".
window.__plantillas = {
  async asistencia(args)        { const m = await import('./lib/plantillas-pdf.js'); const doc = await m.plantillaAsistencia(args); m.descargarPlantilla(doc, `plantilla-asistencia-${args.fecha || 'hoy'}.pdf`); },
  async ingresoMateriales(args) { const m = await import('./lib/plantillas-pdf.js'); const doc = await m.plantillaIngresoMateriales(args); m.descargarPlantilla(doc, `plantilla-ingreso-materiales-${args.fecha || 'hoy'}.pdf`); },
  async salidaMateriales(args)  { const m = await import('./lib/plantillas-pdf.js'); const doc = await m.plantillaSalidaMateriales(args); m.descargarPlantilla(doc, `plantilla-salida-materiales-${args.fecha || 'hoy'}.pdf`); },
  async diarioMateriales(args)  { const m = await import('./lib/plantillas-pdf.js'); const doc = await m.plantillaDiarioMateriales(args); m.descargarPlantilla(doc, `plantilla-diario-materiales-${args.fecha || 'hoy'}.pdf`); },
  async ingresoHerramientas(args) { const m = await import('./lib/plantillas-pdf.js'); const doc = await m.plantillaIngresoHerramientas(args); m.descargarPlantilla(doc, `plantilla-ingreso-herramientas-${args.fecha || 'hoy'}.pdf`); },
  async salidaHerramientas(args)  { const m = await import('./lib/plantillas-pdf.js'); const doc = await m.plantillaSalidaHerramientas(args); m.descargarPlantilla(doc, `plantilla-salida-herramientas-${args.fecha || 'hoy'}.pdf`); },
  async diarioHerramientas(args)  { const m = await import('./lib/plantillas-pdf.js'); const doc = await m.plantillaDiarioHerramientas(args); m.descargarPlantilla(doc, `plantilla-diario-herramientas-${args.fecha || 'hoy'}.pdf`); },
  async parteDiarioMaquinaria(args) { const m = await import('./lib/plantillas-pdf.js'); const doc = await m.plantillaParteDiarioMaquinaria(args); m.descargarPlantilla(doc, `plantilla-maquinaria-${args.fecha || 'hoy'}.pdf`); },
  async ingresoEpps(args)       { const m = await import('./lib/plantillas-pdf.js'); const doc = await m.plantillaIngresoEpps(args); m.descargarPlantilla(doc, `plantilla-ingreso-epps-${args.fecha || 'hoy'}.pdf`); },
  async salidaEpps(args)        { const m = await import('./lib/plantillas-pdf.js'); const doc = await m.plantillaSalidaEpps(args); m.descargarPlantilla(doc, `plantilla-entrega-epps-${args.fecha || 'hoy'}.pdf`); },
};
window.__pdfs = { ...(window.__pdfs || {}), ...contabilidadPdfs };
window.__excel = { parseExcelFile, downloadTemplate, MODULES: IMPORT_MODULES };
window.__apu = {
  parseAPUFile, parseS10File, enrichJerarquia, buildArbol,
  parseAPU, parseInsumosList, parseGantt, detectS10Type, excelDateToISO,
  parseTablaCostos, parsePresupuestoObra,
};
window.__pdfBudget = {
  parsePresupuestoPDF, extractTextFromPDF, parsePresupuestoLines, partidasToImportRows,
};
window.__catalogos = catalogos;
window.__demo = { seed: seedDemoData, clear: clearDemoData, count: countDemoRecords };
window.__identity = { consultarRUC, consultarDNI };
window.__logAudit = logAudit;
window.__changeRequests = {
  create: createChangeRequest,
  list: listChangeRequests,
  approve: approveChangeRequest,
  reject: rejectChangeRequest,
  cancel: cancelChangeRequest,
  sync: syncPendingChangeRequests,
  countPending: countPendingChangeRequests,
};

// ── Componentes ESENCIALES (eager, van al chunk principal) ───────────
// - icons / tooltip / sidebar: shell de la app, siempre visibles.
// - solicitudes: expone RequestChangeModal usado por almacén/movimientos.
// - dashboard: página de aterrizaje (lazy load Chart.js).
// - jx-modal: define window.Modal usado por DECENAS de páginas. ~30 líneas.
//   ANTES estaba dentro de jx-almacen.jsx (3500 líneas eager) — separado para
//   permitir que jx-almacen pase a lazy.
// - jx-admin: eager para __canSeeSidebarItem desde el primer render (security).
// - jx-app: define window.App, el árbol React raíz.
import './components/jx-icons.jsx';
import './components/jx-tooltip.jsx';
import './components/jx-modal.jsx';
import './components/jx-pagination.jsx';
import './components/jx-searchable-select.jsx';
import './components/jx-sidebar.jsx';
import './components/jx-solicitudes.jsx';
import './components/jx-dashboard.jsx';
import './components/jx-admin.jsx';
import './jx-app.jsx';

// ── Componentes LAZY (se cargan on-demand al navegar a la página) ────
// Mapeo: chunkName → loader. window.__loadChunk(name) ejecuta la carga
// y la memoiza en window.__loadedChunks. El componente <LazyPage/> en
// jx-app.jsx llama a esto antes de renderizar la página.
const PAGE_CHUNKS = {
  // jx-almacen ahora es lazy (antes era eager con 3500 líneas → afectaba
  // initial load ~150 KB gzip). Solo se carga al ir a Materiales/Herramientas/
  // Personal/Asistencia. window.Modal vive en jx-modal eager.
  'jx-almacen':               () => import('./components/jx-almacen.jsx'),
  'jx-obra':                  () => import('./components/jx-obra.jsx'),
  'jx-evidencias':            () => import('./components/jx-evidencias.jsx'),
  'jx-reportes':              () => import('./components/jx-reportes.jsx'),
  'jx-movimientos':           () => import('./components/jx-movimientos.jsx'),
  'jx-gestion':               () => import('./components/jx-gestion.jsx'),
  // jx-admin se carga eager arriba (`import './components/jx-admin.jsx'`)
  // — exponemos el chunk acá vacío para que __loadChunk('jx-admin')
  // siga funcionando sin disparar el warning de "ineffective dynamic import".
  'jx-admin':                 () => Promise.resolve(true),
  'jx-importar':              () => import('./components/jx-importar.jsx'),
  'jx-caja-chica':            () => import('./components/jx-caja-chica.jsx'),
  'jx-insumos-emergencia':    () => import('./components/jx-insumos-emergencia.jsx'),
  'jx-captura-magica':        () => import('./components/jx-captura-magica.jsx'),
  'jx-contabilidad':          () => import('./components/jx-contabilidad.jsx'),
  'jx-compras':               () => import('./components/jx-compras.jsx'),
  'jx-compras-pendientes':    () => import('./components/jx-compras-pendientes.jsx'),
  'jx-ingeniero':             () => import('./components/jx-ingeniero.jsx'),
  'jx-control-consumo':       () => import('./components/jx-control-consumo.jsx'),
  'jx-valorizaciones':        () => import('./components/jx-valorizaciones.jsx'),
  'jx-tesoreria':             () => import('./components/jx-tesoreria.jsx'),
  'jx-activos':               () => import('./components/jx-activos.jsx'),
  'jx-ssoma':                 () => import('./components/jx-ssoma.jsx'),
  'jx-ssoma-extra':           () => import('./components/jx-ssoma-extra.jsx'),
  'jx-epps':                  () => import('./components/jx-epps.jsx'),
  'jx-insumos-persona':       () => import('./components/jx-insumos-persona.jsx'),
  'jx-subcontratos':          () => import('./components/jx-subcontratos.jsx'),
  'jx-subcontratos-val':      () => import('./components/jx-subcontratos-val.jsx'),
  'jx-planillas':             () => import('./components/jx-planillas.jsx'),
  'jx-personal-contratos':    () => import('./components/jx-personal-contratos.jsx'),
  'jx-dashboard-ejecutivo':   () => import('./components/jx-dashboard-ejecutivo.jsx'),
  'jx-mantenimiento':         () => import('./components/jx-mantenimiento.jsx'),
  'jx-cts-grati':             () => import('./components/jx-cts-grati.jsx'),
  'jx-plame':                 () => import('./components/jx-plame.jsx'),
  'jx-plan-cuentas':          () => import('./components/jx-plan-cuentas.jsx'),
  'jx-asientos':              () => import('./components/jx-asientos.jsx'),
  'jx-alertas':               () => import('./components/jx-alertas.jsx'),
  'jx-reportes-financieros':  () => import('./components/jx-reportes-financieros.jsx'),
  'jx-busqueda':              () => import('./components/jx-busqueda.jsx'),
  'jx-kpis-obra':             () => import('./components/jx-kpis-obra.jsx'),
  'jx-cumplimiento-cronograma': () => import('./components/jx-cumplimiento-cronograma.jsx'),
  'jx-solicitud-residente':   () => import('./components/jx-solicitud-residente.jsx'),
  'jx-audit-log':             () => import('./components/jx-audit-log.jsx'),
  'jx-comprobantes':          () => import('./components/jx-comprobantes.jsx'),
  'jx-libros-electronicos':   () => import('./components/jx-libros-electronicos.jsx'),
  'jx-config-sunat':          () => Promise.all([
    import('./lib/sunat-ubl.js'),
    import('./components/jx-config-sunat.jsx'),
  ]),
  'jx-conflicts':             () => import('./components/jx-conflicts.jsx'),
  'jx-ubicaciones':           () => import('./components/jx-ubicaciones.jsx'),
  'jx-frentes':               () => import('./components/jx-frentes.jsx'),
};

window.__loadedChunks = new Set();
const __chunkPromises = new Map();
window.__loadChunk = (name) => {
  if (!PAGE_CHUNKS[name]) return Promise.resolve(false);
  if (window.__loadedChunks.has(name)) return Promise.resolve(true);
  if (__chunkPromises.has(name)) return __chunkPromises.get(name);
  const p = PAGE_CHUNKS[name]()
    .then(() => { window.__loadedChunks.add(name); return true; })
    .catch((err) => { console.error('[__loadChunk] failed:', name, err); throw err; });
  __chunkPromises.set(name, p);
  return p;
};

// Error Boundary — atrapa cualquier error de render que rompa el árbol y
// muestra una pantalla de fallback en vez de pantalla negra. El user puede
// recargar (limpia caches) o ver el detalle del error.
class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('[AppErrorBoundary]', error, info);
    // En prod podemos enviarlo a un endpoint de logging si lo configuramos.
  }
  hardReload = async () => {
    try {
      // Limpia caches del SW + service worker registrations
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
    } catch {}
    // Cache-bust del HTML
    window.location.replace(window.location.pathname + '?cb=' + Date.now());
  };
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', background: '#0D1520', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ maxWidth: 520, background: 'rgba(28,45,64,0.85)', border: '1px solid rgba(231,76,60,0.4)', borderRadius: 12, padding: '32px 28px', color: '#F0F2F5' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#EF6B5E', marginBottom: 10 }}>⚠ La app encontró un error</div>
            <div style={{ fontSize: 13, color: '#BFC7D1', marginBottom: 20, lineHeight: 1.5 }}>
              Algo se rompió al cargar la pantalla. Suele resolverse limpiando el cache y recargando.
              Si persiste, copiá el detalle abajo y avisanos.
            </div>
            <details style={{ fontSize: 11, color: '#7A8A9A', background: 'rgba(0,0,0,0.3)', padding: 10, borderRadius: 6, marginBottom: 16, maxHeight: 200, overflow: 'auto' }}>
              <summary style={{ cursor: 'pointer', marginBottom: 6 }}>Ver detalle técnico</summary>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
                {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
              </pre>
            </details>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={this.hardReload}
                style={{ background: '#F2B705', color: '#0D1520', border: 'none', padding: '10px 18px', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>
                🔄 Limpiar cache y recargar
              </button>
              <button onClick={() => window.location.reload()}
                style={{ background: 'transparent', color: '#BFC7D1', border: '1px solid rgba(255,255,255,0.15)', padding: '10px 18px', borderRadius: 8, cursor: 'pointer' }}>
                Recargar simple
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function Root() {
  const auth = useAuthProvider();

  // Sync inicial al montar (puede no traer datos si aún no hay sesión)
  React.useEffect(() => {
    if (navigator.onLine) {
      syncAll();
      uploadPendingEvidencias();
    }
  }, []);

  // Re-sync cuando se completa el login (obtenemos sesión + RLS pasa a traer todo)
  React.useEffect(() => {
    if (auth?.profile?.id && navigator.onLine) {
      // pequeño delay para que la sesión Supabase termine de propagarse
      setTimeout(() => {
        syncAll();
        uploadPendingEvidencias();
      }, 500);
    }
  }, [auth?.profile?.id]);

  const App = window.App;
  if (!App) return <div style={{ color: '#fff', padding: 20 }}>Cargando JARVEX...</div>;

  return (
    <AppErrorBoundary>
      <AuthContext.Provider value={auth}>
        <App />
      </AuthContext.Provider>
    </AppErrorBoundary>
  );
}

// ── Auto-reload cuando el Service Worker se actualiza ─────────────
// El SW está configurado con skipWaiting+clientsClaim, pero la página
// abierta sigue corriendo el bundle viejo hasta un reload manual.
// 'controllerchange' dispara cuando el SW nuevo toma control → forzamos
// recarga para que el usuario reciba la versión nueva sin tener que
// pulsar Ctrl+Shift+R.
if ('serviceWorker' in navigator) {
  let swReloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swReloaded) return;
    swReloaded = true;
    console.log('[SW] Nueva versión activa — recargando...');
    window.location.reload();
  });
}

// Dar un tick para que todos los window.* estén registrados
requestAnimationFrame(() => {
  // React 19 + Sentry: pasamos reactErrorHandler() para que Sentry capture
  // errores de render que el ErrorBoundary built-in no atrapa (ej: errores
  // en useEffect cleanups, suspended trees, etc.). Esto es complementario
  // al AppErrorBoundary que ya tenemos para mostrar UI de fallback.
  ReactDOM.createRoot(document.getElementById('root'), {
    onUncaughtError:    Sentry.reactErrorHandler(),
    onCaughtError:      Sentry.reactErrorHandler(),
    onRecoverableError: Sentry.reactErrorHandler(),
  }).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>
  );
});
