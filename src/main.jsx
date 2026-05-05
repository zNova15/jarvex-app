import React from 'react';
import ReactDOM from 'react-dom/client';
import Chart from 'chart.js/auto';
import { AuthContext, useAuthProvider, useAuth } from './hooks/useAuth';
import { useSync } from './hooks/useSync';
import { useOnline } from './hooks/useOnline';
import { useAppMode } from './hooks/useAppMode';
import { useRealtimeNotifications } from './hooks/useRealtimeNotifications';
import { useObraActiva, getObraActivaIdSync, setObraActivaId } from './hooks/useObraActiva';
import {
  useObras, usePersonal, useMateriales, useHerramientas,
  useMovimientosMateriales, useMovimientosHerramientas,
  useAsistencia, usePartidas, useAvanceObra, useIncidencias,
  useEvidencias, useConflicts,
  usePresupuestosVersiones, usePartidasVersionadas,
  useMaterialPreciosHistorial,
  useCompanies, useAccountingMovements, useIntercompanyTransactions, useTrazabilidadCadenas,
  useRequisiciones, useOrdenesCompra,
  useValorizaciones,
  useCuentasBancarias, useCronogramaPagos, useMovimientosBancarios,
  useActivosPesados, useHorasMaquina,
  useCharlasSeguridad, useIperc, useEppEntregas, useInspeccionesSeguridad, useCapacitaciones,
  useSubcontratistas, useSubcontratos, useSubcontratoValorizaciones,
  usePersonalContrato, usePlanillas, usePlanillaBoletas,
} from './hooks/useOfflineData';
import { syncAll } from './sync/SyncEngine';
import { uploadPendingEvidencias, saveEvidenciaLocal } from './sync/EvidenceUploader';
import { db, newId } from './db/jarvex.db';
import { supabase } from './lib/supabase';
import { generatePDF, downloadPDF, generateExcel } from './lib/reports';
import * as contabilidadPdfs from './lib/contabilidad-pdfs';
import { parseExcelFile, downloadTemplate, MODULES as IMPORT_MODULES } from './lib/excel';
import { parseAPUFile, parseS10File, enrichJerarquia, buildArbol, parseAPU, parseInsumosList, parseGantt, detectS10Type, excelDateToISO } from './lib/apuParser';
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

// Chart.js + DB + hooks expuestos globalmente para los componentes JSX heredados
window.Chart = Chart;
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
  useMovimientosMateriales, useMovimientosHerramientas,
  useAsistencia, usePartidas, useAvanceObra, useIncidencias,
  useEvidencias, useConflicts,
  usePresupuestosVersiones, usePartidasVersionadas,
  useMaterialPreciosHistorial,
  useCompanies, useAccountingMovements, useIntercompanyTransactions, useTrazabilidadCadenas,
  useRequisiciones, useOrdenesCompra,
  useValorizaciones,
  useCuentasBancarias, useCronogramaPagos, useMovimientosBancarios,
  useActivosPesados, useHorasMaquina,
  useCharlasSeguridad, useIperc, useEppEntregas, useInspeccionesSeguridad, useCapacitaciones,
  useSubcontratistas, useSubcontratos, useSubcontratoValorizaciones,
  usePersonalContrato, usePlanillas, usePlanillaBoletas,
};
window.__saveEvidenciaLocal = saveEvidenciaLocal;
window.__reports = { generatePDF, downloadPDF, generateExcel };
window.__pdfs = { ...(window.__pdfs || {}), ...contabilidadPdfs };
window.__excel = { parseExcelFile, downloadTemplate, MODULES: IMPORT_MODULES };
window.__apu = {
  parseAPUFile, parseS10File, enrichJerarquia, buildArbol,
  parseAPU, parseInsumosList, parseGantt, detectS10Type, excelDateToISO,
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
// - dashboard: página de aterrizaje + ChartLine/Bar/Doughnut usados por gestión.
// - almacen: define el componente Modal usado por DECENAS de páginas como
//   identificador libre (resuelve a window.Modal). DEBE estar disponible
//   antes de renderizar cualquier otra página.
// - jx-app: define window.App, el árbol React raíz.
import './components/jx-icons.jsx';
import './components/jx-tooltip.jsx';
import './components/jx-sidebar.jsx';
import './components/jx-solicitudes.jsx';
import './components/jx-dashboard.jsx';
import './components/jx-almacen.jsx';
import './jx-app.jsx';

// ── Componentes LAZY (se cargan on-demand al navegar a la página) ────
// Mapeo: chunkName → loader. window.__loadChunk(name) ejecuta la carga
// y la memoiza en window.__loadedChunks. El componente <LazyPage/> en
// jx-app.jsx llama a esto antes de renderizar la página.
const PAGE_CHUNKS = {
  'jx-obra':                  () => import('./components/jx-obra.jsx'),
  'jx-evidencias':            () => import('./components/jx-evidencias.jsx'),
  'jx-reportes':              () => import('./components/jx-reportes.jsx'),
  'jx-movimientos':           () => import('./components/jx-movimientos.jsx'),
  'jx-gestion':               () => import('./components/jx-gestion.jsx'),
  'jx-admin':                 () => import('./components/jx-admin.jsx'),
  'jx-importar':              () => import('./components/jx-importar.jsx'),
  'jx-captura-magica':        () => import('./components/jx-captura-magica.jsx'),
  'jx-contabilidad':          () => import('./components/jx-contabilidad.jsx'),
  'jx-compras':               () => import('./components/jx-compras.jsx'),
  'jx-valorizaciones':        () => import('./components/jx-valorizaciones.jsx'),
  'jx-tesoreria':             () => import('./components/jx-tesoreria.jsx'),
  'jx-activos':               () => import('./components/jx-activos.jsx'),
  'jx-ssoma':                 () => import('./components/jx-ssoma.jsx'),
  'jx-ssoma-extra':           () => import('./components/jx-ssoma-extra.jsx'),
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
    <AuthContext.Provider value={auth}>
      <App />
    </AuthContext.Provider>
  );
}

// Dar un tick para que todos los window.* estén registrados
requestAnimationFrame(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>
  );
});
