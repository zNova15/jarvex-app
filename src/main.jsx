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
  useCompanies, useAccountingMovements, useIntercompanyTransactions,
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
  useCompanies, useAccountingMovements, useIntercompanyTransactions,
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

// ── Importar componentes (se auto-registran en window.*) ─────────────
import './components/jx-icons.jsx';
import './components/jx-sidebar.jsx';
import './components/jx-solicitudes.jsx';
import './components/jx-dashboard.jsx';
import './components/jx-almacen.jsx';
import './components/jx-obra.jsx';
import './components/jx-evidencias.jsx';
import './components/jx-reportes.jsx';
import './components/jx-movimientos.jsx';
import './components/jx-gestion.jsx';
import './components/jx-admin.jsx';
import './components/jx-importar.jsx';
import './components/jx-contabilidad.jsx';
import './components/jx-compras.jsx';
import './components/jx-valorizaciones.jsx';
import './components/jx-tesoreria.jsx';
import './components/jx-activos.jsx';
import './components/jx-ssoma.jsx';
import './components/jx-ssoma-extra.jsx';
import './components/jx-subcontratos.jsx';
import './components/jx-subcontratos-val.jsx';
import './components/jx-planillas.jsx';
import './components/jx-personal-contratos.jsx';
import './components/jx-dashboard-ejecutivo.jsx';
import './components/jx-conflicts.jsx';
import './jx-app.jsx';

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
