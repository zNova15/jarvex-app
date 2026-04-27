import React from 'react';
import ReactDOM from 'react-dom/client';
import Chart from 'chart.js/auto';
import { AuthContext, useAuthProvider, useAuth } from './hooks/useAuth';
import { useSync } from './hooks/useSync';
import { useOnline } from './hooks/useOnline';
import { useAppMode } from './hooks/useAppMode';
import { useRealtimeNotifications } from './hooks/useRealtimeNotifications';
import {
  useObras, usePersonal, useMateriales, useHerramientas,
  useMovimientosMateriales, useMovimientosHerramientas,
  useAsistencia, usePartidas, useAvanceObra, useIncidencias,
  useEvidencias, useConflicts,
} from './hooks/useOfflineData';
import { syncAll } from './sync/SyncEngine';
import { uploadPendingEvidencias, saveEvidenciaLocal } from './sync/EvidenceUploader';
import { db, newId } from './db/jarvex.db';
import { supabase } from './lib/supabase';
import { generatePDF, downloadPDF, generateExcel } from './lib/reports';
import { parseExcelFile, downloadTemplate, MODULES as IMPORT_MODULES } from './lib/excel';
import { consultarRUC, consultarDNI } from './lib/identity';
import { logAudit } from './lib/audit';
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
window.__hooks = {
  useObras, usePersonal, useMateriales, useHerramientas,
  useMovimientosMateriales, useMovimientosHerramientas,
  useAsistencia, usePartidas, useAvanceObra, useIncidencias,
  useEvidencias, useConflicts,
};
window.__saveEvidenciaLocal = saveEvidenciaLocal;
window.__reports = { generatePDF, downloadPDF, generateExcel };
window.__excel = { parseExcelFile, downloadTemplate, MODULES: IMPORT_MODULES };
window.__identity = { consultarRUC, consultarDNI };
window.__logAudit = logAudit;

// ── Importar componentes (se auto-registran en window.*) ─────────────
import './components/jx-icons.jsx';
import './components/jx-sidebar.jsx';
import './components/jx-dashboard.jsx';
import './components/jx-almacen.jsx';
import './components/jx-obra.jsx';
import './components/jx-evidencias.jsx';
import './components/jx-reportes.jsx';
import './components/jx-movimientos.jsx';
import './components/jx-gestion.jsx';
import './components/jx-admin.jsx';
import './components/jx-importar.jsx';
import './components/jx-conflicts.jsx';
import './jx-app.jsx';

function Root() {
  const auth = useAuthProvider();

  React.useEffect(() => {
    if (navigator.onLine) {
      syncAll();
      uploadPendingEvidencias();
    }
  }, []);

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
