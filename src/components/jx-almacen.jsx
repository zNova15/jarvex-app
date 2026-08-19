import React from "react";
import { calcAlerta } from "../lib/stock-utils.js";
import { ocrAsistencia } from "../lib/ocr-asistencia.js";
import { detectarEPP, esProbablementeEPP } from "../lib/epp-utils.js";
import { usePagination } from "../hooks/usePagination.js";
import { useBusy } from "../hooks/useBusy.js";
import { TablePagination } from "./jx-pagination.jsx";
import { SearchableSelect } from "./jx-searchable-select.jsx";
import { opcionesDestinoFlat, splitDestino } from "../lib/destino-mov.js";
import { getDesgloseBulk, aplicarDelta, traspasar, baseSalidaUbicacion } from "../lib/stock-ubicaciones.js";
import { validarSalidaCronologica, agruparCantidades } from "../lib/stock-cronologia.js";
import { stockDisponibleConfiable, stockSegunMovimientos } from "../lib/stock-conciliacion.js";
import { DesglosePopup, TraspasoStockModal, ubicacionAutoOrigen } from "./jx-stock-ubic.jsx";
import { hoyLocal, horaLocal } from "../lib/fecha.js";
import { rolScopeObrero } from "../lib/personal-scope.js";
import { categoriaDe, esGestionableSeguridad, CATEGORIAS, CATEGORIA_LABEL, CATEGORIA_BADGE, CARGOS_GESTIONABLES_CANONICOS, categoriasParaRol, cargosParaRol } from "../lib/personal-categoria.js";
import { EstadosModal } from "./jx-stock-estados.jsx";
import { FusionPersonasModal } from "./jx-fusion-personas.jsx";
import { getEstadosBulk, ESTADOS_COND, ESTADO_LABEL, aplicarDeltaEstado } from "../lib/stock-estados.js";
import { detectarSugerencias, detectarDuplicados, fusionarInsumos } from "../lib/variantes.js";
import { compararNombresReniec, titleCaseNombre } from "../lib/migracion-parser.js";
import { exportarDataset } from "../lib/export-historico.js";
import { PrecioHistorialModal } from "./jx-precio-historial.jsx";
import { registrarSoloHistorial } from "../lib/precio-historial.js";
import { coincideTokens } from "../lib/buscar-tokens.js";
import { useFotosEvidencias, FotoInsumoCell } from "./jx-foto-insumo.jsx";
import { getCurrentMode } from "../lib/app-mode-core.js";
const { useState: uS, useMemo: uM, useEffect: uE, useCallback: uCB, useRef: uR } = React;

// ─── DATA ───────────────────────────────────────────────
const MAT_DATA = [
  { id:'MAT-001', nombre:'Cemento Portland Tipo I', cat:'Aglomerantes', unidad:'Bolsa', stock:8, minimo:50, entradas:480, salidas:472, estado:'critico', proveedor:'PACASMAYO SAC', obs:'' },
  { id:'MAT-002', nombre:'Fierro 3/8" x 9m', cat:'Acero', unidad:'Barra', stock:12, minimo:100, entradas:350, salidas:338, estado:'critico', proveedor:'Aceros Arequipa', obs:'' },
  { id:'MAT-003', nombre:'Fierro 1/2" x 9m', cat:'Acero', unidad:'Barra', stock:64, minimo:80, entradas:200, salidas:136, estado:'reponer', proveedor:'Aceros Arequipa', obs:'' },
  { id:'MAT-004', nombre:'Ladrillo King Kong 18H', cat:'Albañilería', unidad:'Millar', stock:4.5, minimo:2, entradas:12, salidas:7.5, estado:'ok', proveedor:'Ladrillos Fortes', obs:'' },
  { id:'MAT-005', nombre:'Arena Gruesa', cat:'Agregados', unidad:'M³', stock:22, minimo:10, entradas:80, salidas:58, estado:'ok', proveedor:'Canteras del Sur', obs:'' },
  { id:'MAT-006', nombre:'Piedra Chancada 1/2"', cat:'Agregados', unidad:'M³', stock:18, minimo:15, entradas:60, salidas:42, estado:'ok', proveedor:'Canteras del Sur', obs:'' },
  { id:'MAT-007', nombre:'Agua Destilada', cat:'Insumos', unidad:'Litro', stock:0, minimo:100, entradas:500, salidas:500, estado:'sinstock', proveedor:'—', obs:'Solicitar urgente' },
  { id:'MAT-008', nombre:'Tubo PVC 4" Desagüe', cat:'Sanitario', unidad:'Und', stock:35, minimo:20, entradas:80, salidas:45, estado:'ok', proveedor:'Mexichem Perú', obs:'' },
  { id:'MAT-009', nombre:'Cable TW 2.5mm²', cat:'Eléctrico', unidad:'Metro', stock:420, minimo:200, entradas:800, salidas:380, estado:'ok', proveedor:'Indeco SA', obs:'' },
  { id:'MAT-010', nombre:'Madera Tornillo 2x3', cat:'Encofrado', unidad:'Pie²', stock:210, minimo:300, entradas:600, salidas:390, estado:'reponer', proveedor:'Madereras Lima', obs:'Reordenar esta semana' },
  { id:'MAT-011', nombre:'Alambre #16', cat:'Acero', unidad:'Kg', stock:85, minimo:50, entradas:200, salidas:115, estado:'ok', proveedor:'Aceros Arequipa', obs:'' },
  { id:'MAT-012', nombre:'Pintura Látex Blanco', cat:'Acabados', unidad:'Galón', stock:28, minimo:20, entradas:60, salidas:32, estado:'ok', proveedor:'Sherwin Williams', obs:'' },
];

const HERR_DATA = [
  { id:'HRR-001', nombre:'Amoladora Bosch 7"', tipo:'Eléctrica', estado:'bueno', ubicacion:'en-uso', disponible:false, responsable:'Carlos Quispe', fecha:'26/04/2026', obs:'' },
  { id:'HRR-002', nombre:'Amoladora Dewalt 4.5"', tipo:'Eléctrica', estado:'regular', ubicacion:'almacen', disponible:true, responsable:'—', fecha:'24/04/2026', obs:'Disco desgastado' },
  { id:'HRR-003', nombre:'Taladro Percutor Bosch', tipo:'Eléctrica', estado:'nuevo', ubicacion:'en-uso', disponible:false, responsable:'Juan Flores', fecha:'26/04/2026', obs:'' },
  { id:'HRR-004', nombre:'Nivel Láser NL-200', tipo:'Medición', estado:'bueno', ubicacion:'almacen', disponible:true, responsable:'—', fecha:'23/04/2026', obs:'' },
  { id:'HRR-005', nombre:'Andamio Tubular x4', tipo:'Estructura', estado:'regular', ubicacion:'en-uso', disponible:false, responsable:'Frente B', fecha:'20/04/2026', obs:'' },
  { id:'HRR-006', nombre:'Mezcladora 200L', tipo:'Maquinaria', estado:'mantenimiento', ubicacion:'mantenimiento', disponible:false, responsable:'—', fecha:'22/04/2026', obs:'Cambio de faja' },
  { id:'HRR-007', nombre:'Vibradora de Concreto', tipo:'Maquinaria', estado:'bueno', ubicacion:'en-uso', disponible:false, responsable:'Pedro Lima', fecha:'26/04/2026', obs:'' },
  { id:'HRR-008', nombre:'Compactadora Manual', tipo:'Maquinaria', estado:'bueno', ubicacion:'almacen', disponible:true, responsable:'—', fecha:'18/04/2026', obs:'' },
  { id:'HRR-009', nombre:'Cortadora de Fierro', tipo:'Eléctrica', estado:'malo', ubicacion:'baja', disponible:false, responsable:'—', fecha:'10/04/2026', obs:'Requiere reparación mayor' },
  { id:'HRR-010', nombre:'Plancha Compactadora', tipo:'Maquinaria', estado:'bueno', ubicacion:'almacen', disponible:true, responsable:'—', fecha:'21/04/2026', obs:'' },
];

const PERS_DATA = [
  { id:'PER-001', nombre:'Carlos Quispe Mamani', dni:'42158736', cargo:'Operario Eléctrico', area:'Instalaciones', ingreso:'15/01/2026', estado:'activo', tel:'946-112-334', obs:'' },
  { id:'PER-002', nombre:'Juan Flores Ramos', dni:'38421567', cargo:'Operario Civil', area:'Estructura', ingreso:'15/01/2026', estado:'activo', tel:'912-445-678', obs:'' },
  { id:'PER-003', nombre:'Pedro Lima Torres', dni:'51234789', cargo:'Oficial', area:'Estructura', ingreso:'20/01/2026', estado:'activo', tel:'965-332-190', obs:'' },
  { id:'PER-004', nombre:'Roberto Vargas Cruz', dni:'47895123', cargo:'Peón', area:'General', ingreso:'01/02/2026', estado:'activo', tel:'978-556-321', obs:'' },
  { id:'PER-005', nombre:'Luis Mamani Quispe', dni:'33215678', cargo:'Peón', area:'Almacén', ingreso:'01/02/2026', estado:'activo', tel:'934-221-009', obs:'' },
  { id:'PER-006', nombre:'Miguel Torres Huanca', dni:'62451239', cargo:'Operario Civil', area:'Estructura', ingreso:'15/02/2026', estado:'activo', tel:'948-673-450', obs:'' },
  { id:'PER-007', nombre:'Sofía Ríos Mendoza', dni:'74123568', cargo:'Asistente Admin', area:'Administración', ingreso:'15/01/2026', estado:'activo', tel:'901-224-781', obs:'' },
  { id:'PER-008', nombre:'Fernando Castro López', dni:'58123490', cargo:'Electricista', area:'Instalaciones', ingreso:'20/02/2026', estado:'suspendido', tel:'916-889-302', obs:'Suspendido 3 días' },
  { id:'PER-009', nombre:'Ana Gutiérrez Ponce', dni:'66874532', cargo:'Almacenera', area:'Almacén', ingreso:'15/01/2026', estado:'activo', tel:'975-441-223', obs:'' },
  { id:'PER-010', nombre:'Jorge Salas Mendoza', dni:'43872156', cargo:'Capataz', area:'Estructura', ingreso:'15/01/2026', estado:'activo', tel:'988-112-774', obs:'' },
];

const ASIST_DATA = [
  { id:'PER-001', nombre:'Carlos Quispe Mamani', cargo:'Operario Eléctrico', entrada:'07:58', salida:'17:02', horas:9.1, estado:'asistio' },
  { id:'PER-002', nombre:'Juan Flores Ramos', cargo:'Operario Civil', entrada:'07:45', salida:'17:00', horas:9.3, estado:'asistio' },
  { id:'PER-003', nombre:'Pedro Lima Torres', cargo:'Oficial', entrada:'08:25', salida:'17:00', horas:8.6, estado:'tardanza' },
  { id:'PER-004', nombre:'Roberto Vargas Cruz', cargo:'Peón', entrada:'—', salida:'—', horas:0, estado:'falta' },
  { id:'PER-005', nombre:'Luis Mamani Quispe', cargo:'Peón', entrada:'07:55', salida:'17:00', horas:9.1, estado:'asistio' },
  { id:'PER-006', nombre:'Miguel Torres Huanca', cargo:'Operario Civil', entrada:'07:50', salida:'17:05', horas:9.2, estado:'asistio' },
  { id:'PER-007', nombre:'Sofía Ríos Mendoza', cargo:'Asistente Admin', entrada:'08:00', salida:'17:00', horas:9.0, estado:'asistio' },
  { id:'PER-008', nombre:'Fernando Castro López', cargo:'Electricista', entrada:'—', salida:'—', horas:0, estado:'permiso' },
  { id:'PER-009', nombre:'Ana Gutiérrez Ponce', cargo:'Almacenera', entrada:'07:52', salida:'17:00', horas:9.1, estado:'asistio' },
  { id:'PER-010', nombre:'Jorge Salas Mendoza', cargo:'Capataz', entrada:'07:40', salida:'17:10', horas:9.5, estado:'asistio' },
];

// ─── HELPERS ────────────────────────────────────────────
const MAT_EST  = { ok:'b-green', reponer:'b-yellow', critico:'b-red', sinstock:'b-gray' };
const MAT_ELBL = { ok:'Stock OK', reponer:'Por Reponer', critico:'Crítico', sinstock:'Sin Stock' };
const HERR_EST = { nuevo:'b-blue', bueno:'b-green', regular:'b-yellow', malo:'b-red', mantenimiento:'b-orange', baja:'b-gray' };
const HERR_UBI = { 'en-uso':'b-amber', almacen:'b-blue', mantenimiento:'b-orange', baja:'b-gray', perdida:'b-red' };
const HERR_ULB = { 'en-uso':'En Uso', almacen:'Almacén', mantenimiento:'Mantenimiento', baja:'Dado de Baja', perdida:'Perdida' };
const ASIST_EST= { asistio:'b-green', tardanza:'b-yellow', falta:'b-red', permiso:'b-blue', descanso:'b-gray' };
const ASIST_LBL= { asistio:'Asistió', tardanza:'Tardanza', falta:'Falta', permiso:'Permiso', descanso:'Descanso' };
const PERS_EST = { activo:'b-green', inactivo:'b-gray', suspendido:'b-yellow', retirado:'b-red', inhabilitado:'b-red' };

// ─── MODAL wrapper ──────────────────────────────────────
function Modal({ title, icon, onClose, children, wide }) {
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { maxWidth: 700 } : {}}>
        <div className="modal-hd">
          <div className="modal-hd-left">
            {icon && <div style={{ width:32,height:32,borderRadius:8,background:'rgba(242,183,5,.12)',display:'flex',alignItems:'center',justifyContent:'center' }}><JxIcon name={icon} size={15} color="var(--amber)" /></div>}
            <span>{title}</span>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-icon"><JxIcon name="x" size={15} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── MATERIALES PAGE ────────────────────────────────────
// ── Categorías de materiales: built-in + custom (localStorage) ──
const CATEGORIAS_BUILTIN = [
  'Cemento','Acero','Albañilería','Agregados',
  'Ferretería','Eléctrico','Sanitario','Acabados','Otro',
  // Las que la IA puede usar también
  'General',
];
const CATS_STORAGE_KEY = 'jx_categorias_materiales_v1';
function loadCustomCats() {
  try { return JSON.parse(localStorage.getItem(CATS_STORAGE_KEY) || '[]'); }
  catch { return []; }
}
function saveCustomCats(list) {
  try { localStorage.setItem(CATS_STORAGE_KEY, JSON.stringify(list)); } catch {}
  try { window.dispatchEvent(new CustomEvent('jx_categorias_changed', { detail:list })); } catch {}
}
function getAllCategorias() {
  const base = new Set(CATEGORIAS_BUILTIN);
  loadCustomCats().forEach(c => base.add(c));
  return Array.from(base).sort();
}
window.__categoriasMat = { loadCustomCats, saveCustomCats, getAllCategorias };

// ─── Cargos de personal: lista por defecto + personalizables (localStorage) ───
const CARGOS_BUILTIN = [
  'Ingeniero Residente', 'Ingeniero', 'Ingeniero de Campo', 'Asistente de Ingeniería',
  'Maestro de Obra', 'Capataz', 'Operario', 'Oficial', 'Peón',
  'Almacenero', 'Supervisor SST', 'Prevencionista', 'Topógrafo', 'Administrador de Obra', 'Otro',
];
const CARGOS_STORAGE_KEY = 'jx_cargos_personal_v1';
function loadCustomCargos() { try { return JSON.parse(localStorage.getItem(CARGOS_STORAGE_KEY) || '[]'); } catch { return []; } }
function saveCustomCargos(list) {
  try { localStorage.setItem(CARGOS_STORAGE_KEY, JSON.stringify(list)); } catch {}
  try { window.dispatchEvent(new CustomEvent('jx_cargos_changed', { detail: list })); } catch {}
}
function getAllCargos() { const base = new Set(CARGOS_BUILTIN); loadCustomCargos().forEach(c => base.add(c)); return Array.from(base); }
window.__cargosPersonal = { loadCustomCargos, saveCustomCargos, getAllCargos };

function MaterialesPage({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const myRol = auth?.profile?.rol;
  const isAdmin = myRol === 'admin';
  // Gerencia/contabilidad/admin actualizan precios — almacenero NO
  const puedeActualizarPrecios = isAdmin || ['gerente','asistente_admin'].includes(myRol);
  // Roles sin dinero (residente/especialistas/etc.): no ven precios en el catálogo.
  const veDinero = window.__rolVeDinero ? window.__rolVeDinero(myRol) : true;
  const appMode = window.__useAppMode ? window.__useAppMode() : { isPrueba: true };
  const canDelete = isAdmin && (appMode.isEdicion || appMode.isPrueba);
  const superAdmin = !!appMode.superAdmin;
  // Respeta la matriz de Roles y Permisos. Si el admin marcó al rol
  // como solo-lectura en "Materiales" desde la UI, oculta acciones de
  // escritura.
  const canWrite = isAdmin || (window.__hasPerm?.(myRol, 'Materiales', 'w') ?? false);
  const canWriteMov = isAdmin || (window.__hasPerm?.(myRol, 'Mov. Materiales', 'w') ?? false);
  // Adjuntar foto del catálogo es LIBRE para el almacenero: gobierna el
  // permiso de Evidencias, no el de Materiales (que ahora es solo-admin para
  // editar campos). userId para firmar la evidencia.
  const userId = auth?.profile?.id ?? null;
  const canFoto = canWrite || (window.__hasPerm?.(myRol, 'Evidencias', 'w') ?? false);
  // Doble-click guard para "Registrar Salida/Ingreso" en lote.
  // Sin esto, un click ansioso del almacenero crea 2 movimientos
  // duplicados (mismo timestamp). Se vio en producción: arenas y
  // tubos duplicados que dejaron stock en -45.
  const [busyMovLote, , setBusyMovLote] = useBusy();
  const [q, setQ] = uS(() => { try { const v = window.__almMatBuscar; if (v) { delete window.__almMatBuscar; return v; } } catch {} return ''; }); // pre-filtro desde Solicitudes (Ir al registro)
  const [modal, setModal] = uS(null); // 'ingreso' | 'salida' | 'nuevo' | 'editar' | 'sync' | 'reposicion'
  const [reposicionForm, setReposicionForm] = uS(null); // { mat, cantidad, motivo, prioridad }
  const [editingId, setEditingId] = uS(null); // id del material en edición
  const [obraId, setObraId] = uS(null);
  const [requestTarget, setRequestTarget] = uS(null); // material para "Solicitar Cambio"
  const [partidasObra, setPartidasObra] = uS([]);     // partidas de la obra (para sugerir)
  const [insumosObra, setInsumosObra] = uS([]);       // insumos_partida de la obra
  const [syncPreview, setSyncPreview] = uS(null);     // preview de sincronización con APU
  const [precioTarget, setPrecioTarget] = uS(null);   // material en edición de precio
  const [precioForm, setPrecioForm] = uS({ precio_nuevo:'', motivo:'manual', documento_ref:'', notas:'' });
  const [historialTarget, setHistorialTarget] = uS(null); // material para ver historial
  const [historialData, setHistorialData] = uS([]);
  // Foto del material en edición/creación: { blob, url } — url es objectURL
  // local para preview, se revoca al limpiar el modal o reemplazarla.
  const [foto, setFoto] = uS(null);
  // Map<material_id, { url_archivo?, blob_url? }>: fotos de cada material
  // para mostrar thumbnail en la lista. url_archivo es la URL pública en
  // Supabase Storage (cuando ya se subió); blob_url es objectURL local
  // mientras está pendiente. Se rellena al cargar materiales/evidencias.
  const [fotosMap, setFotosMap] = uS(() => new Map());
  // Foto de catálogo libre por fila (adjuntar/reemplazar sin abrir el modal),
  // vía el componente compartido FotoInsumoCell. Usa su propio tipo_evidencia
  // ('foto_material') para no chocar con la foto del formulario.
  const fotosCatMap = useFotosEvidencias(obraId, 'foto_material');
  // Flag busy para deshabilitar el botón Guardar mientras se procesa el
  // submit. Sin esto, doble click podía disparar 2 submits simultáneos
  // (1 update + 1 create si el primer await ya había reset editingId).
  const [busyMat, setBusyMat] = uS(false);
  // Filtros + categorías custom
  const [filtroCategoria, setFiltroCategoria] = uS('todas');
  const [filtroEstado, setFiltroEstado] = uS('todos');
  const [customCats, setCustomCats] = uS(loadCustomCats());

  // Detectar obra activa con tope de reintentos + reanudar al recibir
  // 'jarvex_master_updated' o 'obra_activa_change'.
  uE(() => {
    let cancelled = false;
    let attempts = 0;
    const findObra = async () => {
      attempts++;
      const obras = await window.__db.obras.toArray();
      const stored = window.__getObraActivaId?.();
      const activa = (stored && obras.find(o => o.id === stored && !o.deleted_at))
                  || obras.find(o => !o.deleted_at);
      if (activa) { if (!cancelled) setObraId(activa.id); return; }
      if (cancelled || attempts >= 10) return;
      setTimeout(findObra, 500);
    };
    findObra();
    const onChange = () => { attempts = 0; findObra(); };
    window.addEventListener('jarvex_master_updated', onChange);
    window.addEventListener('obra_activa_change', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('jarvex_master_updated', onChange);
      window.removeEventListener('obra_activa_change', onChange);
    };
  }, []);

  // Hook real de materiales
  const { data: materiales, loading, create: createMaterial, update: updateMaterial, refresh } = window.__hooks.useMateriales(obraId);
  // Subcontratistas para atribuir salidas a un subcontrato (Fase B)
  const { data: subcontratistas } = window.__hooks.useSubcontratistas();

  // Cargar partidas + insumos_partida de la obra (para sugerir partida en salida)
  uE(() => {
    if (!obraId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [parts, inss] = await Promise.all([
          window.__db.partidas.where('obra_id').equals(obraId).toArray(),
          window.__db.insumos_partida.where('obra_id').equals(obraId).toArray(),
        ]);
        if (!cancelled) {
          setPartidasObra((parts || []).filter(p => !p.deleted_at && p.estado !== 'terminado'));
          // Excluir soft-deleted: tras un re-import (Fase 1b) los insumos del
          // APU viejo quedan deleted_at hasta que el push los purga — sin este
          // filtro contaminan sugerencias de partida y el sync de precios.
          setInsumosObra((inss || []).filter(i => !i.deleted_at));
        }
      } catch (e) { /* tabla puede no existir aún */ }
    };
    load();
    const t = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, [obraId]);
  const { data: personal } = window.__hooks.usePersonal(obraId);
  const movHook = window.__hooks.useMovimientosMateriales(obraId);
  // Frentes de trabajo activos de la obra (para el picker opcional en la salida)
  const { data: frentes } = window.__hooks.useFrentesObra(obraId, { soloActivas: true });

  // Ubicaciones de almacenaje per-obra (para selector en modal y display en tabla)
  const { data: ubicaciones } = window.__hooks.useUbicacionesObra?.(obraId) || { data: [] };
  const ubicacionesActivas = uM(() => (ubicaciones || []).filter(u => u.activo !== false && !u.deleted_at), [ubicaciones]);
  const ubicacionesById = uM(() => {
    const map = new Map();
    (ubicaciones || []).forEach(u => map.set(u.id, u));
    return map;
  }, [ubicaciones]);

  // Desglose de stock por ubicación: Map(material_id → Map(ubic_id → cant)).
  // Se recarga cuando cambian materiales o llega un cambio en stock_ubicaciones.
  const [desgloseUbic, setDesgloseUbic] = uS(() => new Map());
  const [popupMat, setPopupMat] = uS(null); // material para el popup de desglose por ubicación
  const cargarDesglose = uCB(async () => {
    try {
      const ids = (materiales || []).map(m => m.id);
      const m = await getDesgloseBulk('material', ids);
      setDesgloseUbic(m);
    } catch {}
  }, [materiales]);
  uE(() => {
    cargarDesglose();
    const onCh = (e) => { const t = e?.detail?.tabla || e?.detail?.table; if (!t || t === 'stock_ubicaciones') cargarDesglose(); };
    window.addEventListener('jx_data_changed', onCh);
    return () => window.removeEventListener('jx_data_changed', onCh);
  }, [cargarDesglose]);

  // Modal de traspaso entre ubicaciones
  const [traspasoOpen, setTraspasoOpen] = uS(false);

  // Proveedores desde Dexie directamente
  const [provs, setProvs] = uS([]);
  uE(() => { window.__db.proveedores.toArray().then(setProvs); }, [obraId]);

  // Carga fotos de materiales (evidencias tipo 'foto_material' para esta obra)
  // y construye el Map material_id → URL para mostrar thumbnails. Se actualiza
  // cuando el sync trae cambios o cuando se guarda una nueva foto.
  uE(() => {
    if (!obraId) return;
    let cancelled = false;
    const blobUrlsLocales = []; // para revocar al desmontar
    const cargar = async () => {
      try {
        const evidencias = await window.__db.evidencias
          .where('obra_id').equals(obraId)
          .filter(e => e.tipo_evidencia === 'foto_material' && !e.deleted_at && e.registro_relacionado_id)
          .toArray();
        // Si hay varias fotos por material, usamos la más reciente
        evidencias.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        const map = new Map();
        const { getEvidenciaSrc } = await import('../lib/evidencias-url.js');
        for (const ev of evidencias) {
          if (map.has(ev.registro_relacionado_id)) continue;
          // getEvidenciaSrc resuelve blob local o FIRMA el path del bucket
          // privado (url_archivo cruda es /public/ y da 400 → imagen rota).
          try {
            const r = await getEvidenciaSrc(ev);
            if (r?.url) {
              if (r.isBlob) blobUrlsLocales.push(r.url);
              map.set(ev.registro_relacionado_id, { url: r.url, isRemote: !r.isBlob });
            }
          } catch {}
        }
        if (!cancelled) setFotosMap(map);
      } catch (e) {
        console.warn('[fotos materiales]', e?.message || e);
      }
    };
    cargar();
    const onChange = (e) => {
      const t = e?.detail?.tabla || e?.detail?.table;
      if (!t || t === 'evidencias' || t === 'materiales') cargar();
    };
    window.addEventListener('jx_data_changed', onChange);
    window.addEventListener('jarvex_master_updated', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('jx_data_changed', onChange);
      window.removeEventListener('jarvex_master_updated', onChange);
      blobUrlsLocales.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
    };
  }, [obraId]);

  // Estado del form
  const [form, setForm] = uS({});

  // Categorías disponibles (built-in + custom + las que ya existen en BD)
  const categoriasDisponibles = uM(() => {
    const set = new Set(getAllCategorias());
    (materiales || []).forEach(m => { if (m.categoria) set.add(m.categoria); });
    return Array.from(set).sort();
  }, [materiales, customCats]);

  const matchMat = (m) => {
    if (q) {
      // Multi-palabra (AND): "Tubo 1/2" encuentra "TUBO PVC 1/2", no solo la frase exacta.
      const hay = `${m.nombre_material || ''} ${m.categoria || ''} ${m.codigo_s10 || ''}`;
      if (!coincideTokens(hay, q)) return false;
    }
    if (filtroCategoria !== 'todas' && m.categoria !== filtroCategoria) return false;
    if (filtroEstado !== 'todos') {
      if (filtroEstado === 'sin_unidad' && m.unidad && m.unidad !== 'und') return false;
      if (filtroEstado === 'sin_unidad' && !m.unidad) {} // pasa
      else if (filtroEstado !== 'sin_unidad' && m.alerta !== filtroEstado) return false;
    }
    return true;
  };
  // ── Variantes padre-hijo (SKU) ──────────────────────────────
  const childrenByPadre = uM(() => {
    const map = new Map();
    for (const m of (materiales || [])) { if (!m.deleted_at && m.padre_id) { const a = map.get(m.padre_id) || []; a.push(m); map.set(m.padre_id, a); } }
    return map;
  }, [materiales]);
  const variantesDe = (g) => childrenByPadre.get(g.id) || [];
  const stockDeNodo = (m) => m.es_grupo ? variantesDe(m).reduce((s, c) => s + Number(c.stock_actual || 0), 0) : Number(m.stock_actual || 0);
  const alertaDeNodo = (m) => m.es_grupo ? calcAlerta(stockDeNodo(m), Number(m.stock_minimo || 0)) : m.alerta;
  const [expandedGroups, setExpandedGroups] = uS(() => new Set());
  const toggleGroup = (id) => setExpandedGroups(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const sugerencias = uM(() => detectarSugerencias(materiales, 'nombre_material'), [materiales]);
  const dups = uM(() => detectarDuplicados(materiales, 'nombre_material'), [materiales]);
  const [descartadas, setDescartadas] = uS(() => new Set());
  const [sugerenciasOpen, setSugerenciasOpen] = uS(false);   // desplegable: no invadir la pantalla con banners
  const [grupoModal, setGrupoModal] = uS(null);
  const [dupModal, setDupModal] = uS(null);
  const [varBusy, setVarBusy] = uS(false);

  const filtered = uM(() => {
    if (!materiales) return [];
    const top = materiales.filter(m => !m.deleted_at && !m.padre_id);
    return top.filter(m => m.es_grupo ? (matchMat(m) || variantesDe(m).some(matchMat)) : matchMat(m));
  }, [q, materiales, filtroCategoria, filtroEstado, childrenByPadre]);

  // Paginación de materiales — antes se renderizaban TODOS de golpe.
  // Con 500+ materiales en una obra, el filtro/scroll se sentía pesado.
  const matPg = usePagination(filtered, 50);

  const crearGrupoMat = async (titulo, items) => {
    const nombre = (titulo || '').trim();
    if (!nombre || !items?.length || varBusy) return;
    setVarBusy(true);
    try {
      const padre = await createMaterial({ obra_id: obraId, nombre_material: nombre, categoria: items[0]?.categoria || null, unidad: items[0]?.unidad || 'und', es_grupo: true, stock_inicial: 0, stock_actual: 0, stock_minimo: 0, total_entradas: 0, total_salidas: 0, alerta: 'ok', estado: 'activo' });
      for (const it of items) await updateMaterial(it.id, { padre_id: padre.id });
      setExpandedGroups(s => new Set(s).add(padre.id));
      showToast(`✓ "${nombre}" con ${items.length} variantes`, 'green'); setGrupoModal(null); refresh?.();
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); } finally { setVarBusy(false); }
  };
  const agregarAGrupoMat = async (grupo, items) => {
    try { for (const it of items) await updateMaterial(it.id, { padre_id: grupo.id }); setExpandedGroups(s => new Set(s).add(grupo.id)); showToast(`✓ ${items.length} agregado(s) a "${grupo.nombre_material}"`, 'green'); refresh?.(); }
    catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };
  const eliminarGrupoMat = async (g) => {
    const hijos = variantesDe(g);
    if (!confirm(`¿Deshacer el grupo "${g.nombre_material}"? Sus ${hijos.length} variantes vuelven a sueltas.`)) return;
    try { for (const h of hijos) await updateMaterial(h.id, { padre_id: null }); await updateMaterial(g.id, { deleted_at: new Date().toISOString() }); showToast('Grupo deshecho', 'amber'); refresh?.(); }
    catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };
  const fusionarDupMat = async () => {
    if (!dupModal?.survivorId || varBusy) return;
    setVarBusy(true);
    try {
      const userId = auth?.profile?.id ?? 'offline';
      const dupIds = dupModal.grupo.items.map(i => i.id).filter(id => id !== dupModal.survivorId);
      const r = await fusionarInsumos({ db: window.__db, tabla: 'materiales', movTabla: 'movimientos_materiales', fk: 'material_id', itemTipoStock: 'material', userId, calcAlerta }, dupModal.survivorId, dupIds);
      showToast(`✓ Fusionado · ${r.movidos} movimientos · stock ${r.stockFinal}`, 'green'); setDupModal(null); refresh?.();
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); } finally { setVarBusy(false); }
  };

  // Fila de material (ítem suelto o variante anidada). Se define como función
  // para poder reutilizarla en las variantes dentro de un grupo.
  const filaMat = (m, esHijo) => {
    const a = ALERTA_STYLE[m.alerta] || ALERTA_STYLE.ok;
    const stockColor = m.alerta === 'critico' ? 'var(--red)'
      : m.alerta === 'sin_stock' ? 'var(--tm)'
      : m.alerta === 'reponer' ? 'var(--yellow)' : 'var(--tp)';
    return (
      <tr key={m.id} style={esHijo ? { background: 'rgba(255,255,255,0.015)' } : undefined}>
        <td className="col-p" style={esHijo ? { paddingLeft: 26 } : undefined}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            {esHijo && <span style={{ color:'var(--tm)' }}>└</span>}
            <FotoInsumoCell obraId={obraId} tipoEvidencia="foto_material" modulo="materiales"
              registroId={m.id} nombre={m.nombre_material} foto={fotosCatMap.get(m.id)}
              canFoto={canFoto} userId={userId} showToast={showToast}/>
            <span>{m.nombre_material}</span>
          </div>
        </td>
        <td><span className="tag">{m.categoria || '—'}</span></td>
        <td style={{ fontSize:11 }}>
          {(() => {
            const dg = desgloseUbic.get(m.id);
            const entradas = dg ? Array.from(dg.entries()).filter(([,c]) => Number(c) > 0) : [];
            if (entradas.length) {
              const resumen = entradas.length === 1 ? (ubicacionesById.get(entradas[0][0])?.nombre || 'Almacén') : `${entradas.length} almacenes`;
              return <button className="btn btn-ghost btn-xs" title="Ver stock por ubicación" onClick={()=>setPopupMat(m)}><JxIcon name="map" size={11}/> {resumen}</button>;
            }
            if (m.ubicacion_id) {
              const u = ubicacionesById.get(m.ubicacion_id);
              return u
                ? <span style={{ color: u.activo === false ? 'var(--tm)' : 'var(--tp)' }}>{u.nombre}{u.activo === false ? ' (inactiva)' : ''}</span>
                : <span style={{ color:'var(--tm)' }}>—</span>;
            }
            return <span style={{ color:'var(--tm)' }}>—</span>;
          })()}
        </td>
        <td className="col-m">{m.unidad}</td>
        {veDinero && <td style={{textAlign:'right'}} className="col-num">
          {Number(m.precio_unitario_estimado || 0) > 0
            ? <span>S/ {Number(m.precio_unitario_estimado).toFixed(2)}</span>
            : <span style={{ color:'var(--tm)' }}>—</span>}
        </td>}
        <td style={{textAlign:'right'}} className="col-num">
          <span style={{ color: stockColor, fontWeight: 600 }}>{Number(m.stock_actual ?? 0).toLocaleString('es-PE')}</span>
        </td>
        <td style={{textAlign:'right'}} className="col-num">{Number(m.stock_minimo ?? 0).toLocaleString('es-PE')}</td>
        <td style={{textAlign:'right'}} className="col-num"><span style={{color:'var(--green)'}}>{Number(m.total_entradas ?? 0).toLocaleString('es-PE')}</span></td>
        <td style={{textAlign:'right'}} className="col-num"><span style={{color:'var(--orange)'}}>{Number(m.total_salidas ?? 0).toLocaleString('es-PE')}</span></td>
        <td><span className={`badge ${a.class}`}>{a.label}</span></td>
        <td>{m.sync_status && m.sync_status !== 'synced'
          ? <span className="badge b-amber" title={m.sync_status}>⏱ pendiente</span>
          : <span style={{color:'var(--green)',fontSize:11}}>✓</span>}
        </td>
        <td style={{textAlign:'center', whiteSpace:'nowrap'}}>
          {['critico','reponer','agotado','sin_stock','cerca'].includes(m.alerta) && (
            <button className="btn btn-xs" title="Crear requisición de reposición rápida" onClick={()=>solicitarReposicion(m)}
              style={{ marginRight:4, background: m.alerta === 'critico' || m.alerta === 'agotado' || m.alerta === 'sin_stock' ? 'var(--red)' : 'var(--amber)', color:'#fff', borderColor:'transparent' }}>
              <JxIcon name="plus" size={11}/> Reponer
            </button>
          )}
          <button className="btn btn-ghost btn-xs" title="Ver TODOS los movimientos (entradas/salidas) de este material" onClick={()=>{ try { window.__movMatBuscar = m.nombre_material || ''; } catch {} window.__navTo?.('mov-materiales'); }} style={{ marginRight:4 }}>
            <JxIcon name="list" size={11}/>
          </button>
          {veDinero && <button className="btn btn-ghost btn-xs" title="Ver historial de precios" onClick={()=>verHistorialPrecios(m)} style={{ marginRight:4 }}>
            <JxIcon name="dollar" size={11}/>
          </button>}
          {puedeActualizarPrecios && (
            <button className="btn btn-ghost btn-xs" title="Actualizar precio (gerencia/contabilidad)" onClick={()=>abrirModalPrecio(m)} style={{ marginRight:4, color:'var(--amber)' }}>
              <JxIcon name="edit" size={11}/>$
            </button>
          )}
          {/* Editar campos del catálogo = SOLO admin. El almacenero (no-admin)
              no edita el nombre/unidad directo: pide "Solicitar cambio" que el
              admin aprueba. La FOTO sí es libre (FotoInsumoCell en la celda de
              nombre, permiso de Evidencias). Mover a EPP y eliminar son admin. */}
          {isAdmin ? (
            <>
              <button className="btn btn-ghost btn-xs" title="Editar material" onClick={()=>openEditMaterial(m)}>
                <JxIcon name="edit" size={11}/>
              </button>
              {isAdmin && (() => {
                const tipoEpp = detectarEPP(m.nombre_material);
                if (!tipoEpp || m.categoria === 'EPP') return null;
                return (
                  <button className="btn btn-amber btn-xs" title={`Detectado como ${tipoEpp} — mover al inventario de EPPs`} onClick={() => moverMaterialAEpps(m)} style={{ marginLeft:4 }}>🦺</button>
                );
              })()}
              {canDelete && (
                <button className="btn btn-red btn-xs" title="Eliminar (solo modo edición)" onClick={()=>handleDeleteMaterial(m)} style={{ marginLeft:4 }}>
                  <JxIcon name="trash" size={11}/>
                </button>
              )}
            </>
          ) : (
            <button className="btn btn-ghost btn-xs" title="Solicitar cambio" onClick={()=>setRequestTarget(m)}>
              <JxIcon name="alert" size={11}/>
            </button>
          )}
        </td>
      </tr>
    );
  };

  const alertasCount = uM(() =>
    materiales?.filter(m => m.alerta === 'critico' || m.alerta === 'sin_stock').length ?? 0,
  [materiales]);

  // Crear nueva categoría custom
  const crearCategoriaCustom = (nombre) => {
    const n = (nombre || '').trim();
    if (!n) return false;
    if (categoriasDisponibles.includes(n)) {
      showToast(`La categoría "${n}" ya existe`, 'amber');
      return false;
    }
    const next = [...customCats, n];
    setCustomCats(next);
    saveCustomCats(next);
    showToast(`Categoría "${n}" creada`, 'green');
    return true;
  };

  // ── Sincronización de unidades + precios desde APU (insumos_partida) ──
  // Cruza por código y aplica unidad y/o precio según el modo elegido.
  const [syncMode, setSyncMode] = uS('ambos'); // 'unidades' | 'precios' | 'ambos'

  const escanearSyncDesdeAPU = () => {
    if (!materiales || !insumosObra) {
      showToast('No hay datos para sincronizar', 'red');
      return;
    }
    // Normalizador de nombre para matching robusto: uppercase, sin acentos,
    // colapsa espacios y caracteres especiales.
    const normalizar = (s) => (s || '')
      .toString()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, ' ')
      .trim();

    // Mapa código → datos del APU
    const apuPorCodigo = new Map();
    // Mapa nombre normalizado → datos del APU (fallback)
    const apuPorNombre = new Map();

    insumosObra.forEach(ip => {
      const u = (ip.unidad || '').trim();
      const p = Number(ip.precio_presupuestado) || 0;
      const data = { unidad: u, precio: p, tipo: ip.tipo_insumo, nombre: ip.nombre_insumo };

      if (ip.insumo_codigo) {
        const cur = apuPorCodigo.get(ip.insumo_codigo);
        if (!cur) apuPorCodigo.set(ip.insumo_codigo, { ...data });
        else {
          if (!cur.unidad && u) cur.unidad = u;
          if (!cur.precio && p) cur.precio = p;
        }
      }
      // Indexar también por nombre como fallback
      const nomKey = normalizar(ip.nombre_insumo);
      if (nomKey) {
        const cur = apuPorNombre.get(nomKey);
        if (!cur) apuPorNombre.set(nomKey, { ...data });
        else {
          if (!cur.unidad && u) cur.unidad = u;
          if (!cur.precio && p) cur.precio = p;
        }
      }
    });

    console.log('[Sync APU] Insumos APU indexados:', insumosObra.length,
      '· por código:', apuPorCodigo.size, '· por nombre:', apuPorNombre.size);

    const cambios = [];
    const sinMatch = [];
    let matchPorCodigo = 0, matchPorNombre = 0;

    materiales.forEach(m => {
      // 1) Intentar match por código primero
      let apu = m.codigo_s10 ? apuPorCodigo.get(m.codigo_s10) : null;
      if (apu) matchPorCodigo++;
      // 2) Fallback: match por nombre normalizado
      if (!apu) {
        const nomKey = normalizar(m.nombre_material);
        if (nomKey) apu = apuPorNombre.get(nomKey);
        if (apu) matchPorNombre++;
      }
      if (!apu) {
        sinMatch.push({ m, motivo: m.codigo_s10 ? 'no_encontrado' : 'sin_codigo' });
        return;
      }
      const patches = {};
      // Unidad
      if ((syncMode === 'unidades' || syncMode === 'ambos') && apu.unidad && apu.unidad !== m.unidad && (m.unidad === 'und' || !m.unidad)) {
        patches.unidad = apu.unidad;
      }
      // Precio
      const precioActual = Number(m.precio_unitario_estimado || 0);
      if ((syncMode === 'precios' || syncMode === 'ambos') && apu.precio > 0 && Math.abs(apu.precio - precioActual) > 0.01) {
        patches.precio_unitario_estimado = apu.precio;
      }
      if (Object.keys(patches).length > 0) {
        cambios.push({ id: m.id, nombre: m.nombre_material, codigo: m.codigo_s10 || '(sin código)',
          actual:{ unidad: m.unidad, precio: precioActual },
          nuevo: patches,
        });
      }
    });

    console.log('[Sync APU] Resultado:', {
      total: materiales.length,
      matchPorCodigo, matchPorNombre,
      cambios: cambios.length,
      sinMatch: sinMatch.length,
    });

    setSyncPreview({
      total: materiales.length,
      conMatch: matchPorCodigo + matchPorNombre,
      matchPorCodigo, matchPorNombre,
      sinMatch: sinMatch.length,
      sinCodigo: sinMatch.filter(x => x.motivo === 'sin_codigo').length,
      cambios,
      apuVacio: insumosObra.length === 0,
      modo: syncMode,
    });
    setModal('sync');
  };

  // ── Traspaso entre ubicaciones ──────────────────────────────────
  // Mueve stock de una ubicación a otra. El total del material no cambia.
  // Registra 2 movimientos (salida + entrada) marcados como traspaso para
  // que quede el rastro en el historial.
  const ejecutarTraspaso = async ({ material_id, origenId, destinoId, cantidad }) => {
    const mat = materiales.find(m => m.id === material_id);
    if (!mat) { showToast('Material no encontrado', 'red'); return false; }
    const userId = auth?.profile?.id || null;
    // MISMA marca de tiempo (hora de Lima) para las DOS patas del traspaso: antes
    // se guardaba en UTC (+5h) y podía divergir de otros caminos → salida y
    // entrada con horas distintas. Ver lib/fecha.js.
    const fecha = hoyLocal();
    const hora = horaLocal();
    const cant = Number(cantidad) || 0;
    try {
      await traspasar({ obraId, itemTipo: 'material', itemId: material_id, origenId, destinoId, cantidad: cant, userId });
      const uO = ubicacionesById.get(origenId)?.nombre || 'origen';
      const uD = ubicacionesById.get(destinoId)?.nombre || 'destino';
      const obsTraspaso = `Traspaso ${uO} → ${uD}`;
      // 2 movimientos para trazabilidad (no cambian el stock total — por eso
      // NO tocamos materiales.stock_actual acá). Mismo formato estándar que
      // el traspaso de herramientas/EPPs: ubicacion_id propio + el otro lado
      // en observaciones ('Traspaso → X' / 'Traspaso ← Y').
      const key = `traspaso-${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
      await movHook.create({
        obra_id: obraId, material_id, fecha, hora,
        tipo_movimiento: 'salida', cantidad: cant, unidad: mat.unidad,
        ubicacion_id: origenId, observaciones: `Traspaso → ${uD}`, partida_id: null,
        idempotency_key: `${key}_out`,
      });
      await movHook.create({
        obra_id: obraId, material_id, fecha, hora,
        tipo_movimiento: 'entrada', cantidad: cant, unidad: mat.unidad,
        ubicacion_id: destinoId, observaciones: `Traspaso ← ${uO}`, partida_id: null,
        idempotency_key: `${key}_in`,
      });
      try { await window.__logAudit?.({ action:'update', table:'stock_ubicaciones', recordId: material_id,
        newData:{ origen: origenId, destino: destinoId, cantidad: cant }, reason: obsTraspaso }); } catch {}
      showToast(`✓ Traspaso: ${cant} ${mat.unidad} de ${mat.nombre_material} (${uO} → ${uD})`, 'green');
      cargarDesglose();
      return true;
    } catch (e) {
      showToast('Error en traspaso: ' + (e.message || e), 'red');
      return false;
    }
  };

  // ── Recalcular stocks desde movimientos ─────────────────────────
  // Para cada material de la obra activa, suma entradas - salidas
  // (excluyendo reversas y reversadas) y actualiza stock_actual.
  // Útil cuando hubo desajuste por movs duplicados, fuerzas históricas
  // o el seed inicial. Solo admin.
  const [recalculandoStock, setRecalculandoStock] = uS(false);
  const recalcularStocks = async () => {
    if (!obraId || !materiales?.length) return;
    if (!confirm(
      `¿Recalcular el stock de los ${materiales.length} materiales de esta obra?\n\n` +
      `El sistema recorrerá los movimientos (entradas − salidas, excluyendo reversas) ` +
      `y reescribirá stock_actual de cada material.\n\n` +
      `No toca movimientos — solo el snapshot stock_actual.`
    )) return;
    setRecalculandoStock(true);
    // Con conexión: recalcular EN EL SERVER (RPC recalcular_stock_obra, mig 150).
    // El recálculo local solo no servía: stock_actual está excluido del push
    // (campo manejado por triggers del server), así que la corrección jamás
    // llegaba al server y el siguiente pull la REVERTÍA en este mismo equipo.
    // En modo PRUEBA (demo) los materiales son solo locales → siempre recálculo local.
    const esDemoLocal = (() => { try { return window.__appMode?.isPrueba || getCurrentMode?.() === 'prueba'; } catch { return false; } })();
    if (navigator.onLine && window.__supabase && !esDemoLocal) {
      try {
        const { data, error } = await window.__supabase.rpc('recalcular_stock_obra', { p_obra_id: obraId });
        if (error) throw error;
        try { await window.__logAudit?.({ action:'alert', table:'materiales', reason:`Recálculo de stock EN SERVER obra ${obraId}: ${data ?? '?'} materiales ajustados` }); } catch {}
        // Traer el resultado AHORA (antes solo se emitía 'online' y este equipo
        // seguía mostrando el snapshot viejo hasta el próximo ciclo de sync).
        try { await window.__syncAll?.(); } catch {}
        try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'materiales' } })); } catch {}
        refresh?.();
        showToast(`✓ Stock recalculado en el SERVIDOR: ${data ?? 0} ajustado(s) — ya actualizado acá y llega al resto con su próximo sync`, 'green');
        setRecalculandoStock(false);
        return;
      } catch (e) {
        console.warn('[recalcular] RPC del server falló — sigo con recálculo local:', e?.message);
      }
    }
    let ajustados = 0;
    let iguales = 0;
    let errores = 0;
    try {
      const movs = await window.__db.movimientos_materiales
        .where('obra_id').equals(obraId)
        .toArray();
      // Agrupar por material_id y sumar con la MISMA regla canónica que la
      // validación (stockSegunMovimientos: entrada/devolución/ajuste suman,
      // salida/merma/baja restan; excluye borrados y reversas). Antes esta
      // función contaba TODO lo no-entrada como resta (la devolución bajaba
      // stock) y NO excluía los borrados → recálculo divergente del validador.
      const movsPorMat = new Map();
      for (const mov of movs) {
        if (!movsPorMat.has(mov.material_id)) movsPorMat.set(mov.material_id, []);
        movsPorMat.get(mov.material_id).push(mov);
      }
      const sums = new Map();
      for (const [mid, lista] of movsPorMat) {
        sums.set(mid, stockSegunMovimientos(lista));
      }
      const now = new Date().toISOString();
      const userId = auth?.profile?.id || 'admin';
      for (const mat of materiales) {
        try {
          // Sin movimientos NO se toca: un material importado con stock inicial
          // (baseline sin historial) quedaría en 0. Mismo criterio que el RPC
          // del server (solo ajusta materiales presentes en los movimientos).
          if (!sums.has(mat.id)) { iguales++; continue; }
          const calculado = Math.max(0, sums.get(mat.id) || 0);
          const actual = Number(mat.stock_actual ?? 0);
          if (Math.abs(calculado - actual) < 0.001) { iguales++; continue; }
          const minimo = Number(mat.stock_minimo || 0);
          const nuevaAlerta = calculado <= 0 ? 'agotado'
            : minimo > 0 && calculado <= minimo * 0.5 ? 'critico'
            : minimo > 0 && calculado <= minimo ? 'reponer'
            : minimo > 0 && calculado <= minimo * 1.2 ? 'cerca'
            : 'ok';
          await window.__db.materiales.update(mat.id, {
            stock_actual: calculado,
            alerta: nuevaAlerta,
            updated_at: now, updated_by: userId,
            version: (mat.version ?? 0) + 1,
            sync_status: mat.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
          });
          ajustados++;
        } catch (e) {
          console.warn('[recalcular] error en', mat.nombre_material, e?.message);
          errores++;
        }
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'materiales' } })); } catch {}
      try { window.dispatchEvent(new Event('online')); } catch {}
      try { await window.__logAudit?.({ action:'alert', table:'materiales', reason:`Recálculo masivo de stock obra ${obraId}: ${ajustados} ajustados, ${iguales} ya correctos, ${errores} fallidos` }); } catch {}
      showToast(`✓ Recálculo LOCAL: ${ajustados} ajustados · ${iguales} sin cambios${errores ? ` · ${errores} errores` : ''}. Sin conexión se aplicó solo en este dispositivo — repetilo con internet para corregir el servidor.`, ajustados > 0 ? 'green' : 'amber');
    } catch (e) {
      showToast('Error: ' + (e.message || e), 'red');
    } finally {
      setRecalculandoStock(false);
    }
  };

  // ── Categorización por IA (Claude vía /api/categorize) ──
  const [iaModal, setIaModal] = uS(null); // null | 'preview' | 'running' | 'done'
  const [iaResults, setIaResults] = uS([]);
  const [iaProgress, setIaProgress] = uS({ current:0, total:0 });

  const ejecutarCategorizacionIA = async () => {
    if (!materiales || !materiales.length) {
      showToast('No hay materiales para categorizar', 'red');
      return;
    }
    const aClasificar = materiales.filter(m => !m.categoria || m.categoria === 'General');
    if (!aClasificar.length) {
      showToast('Todos los materiales ya tienen categoría asignada', 'amber');
      return;
    }
    setIaModal('running');
    setIaProgress({ current:0, total: aClasificar.length });

    // Optimización: batches grandes (100) en paralelo (6 a la vez).
    // Para 376 items: 4 batches de 100, pero solo 4 en flight → 1-2 min en lugar de 8.
    const BATCH = 100;
    const PARALLEL = 6;
    const chunks = [];
    for (let i = 0; i < aClasificar.length; i += BATCH) {
      chunks.push(aClasificar.slice(i, i + BATCH));
    }

    const all = [];
    let errorMsg = null;
    let completados = 0;

    const procesarChunk = async (chunk) => {
      try {
        const { apiFetch } = await import('../lib/api-client');
        const resp = await apiFetch('/api/categorize', {
          method: 'POST',
          timeout: 60000,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'material',
            items: chunk.map(m => ({ id: m.id, nombre: m.nombre_material })),
          }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        all.push(...(data.results || []));
        completados += chunk.length;
        setIaProgress({ current: Math.min(completados, aClasificar.length), total: aClasificar.length });
      } catch (e) {
        if (!errorMsg) errorMsg = e.message;
      }
    };

    // Pool de promesas: máximo PARALLEL concurrentes
    let nextIdx = 0;
    const workers = Array(Math.min(PARALLEL, chunks.length)).fill(0).map(async () => {
      while (nextIdx < chunks.length && !errorMsg) {
        const myIdx = nextIdx++;
        await procesarChunk(chunks[myIdx]);
      }
    });
    await Promise.all(workers);

    if (errorMsg) {
      setIaModal(null);
      showToast('Error IA: ' + errorMsg, 'red');
      return;
    }

    const cambios = all.map(r => {
      const m = materiales.find(x => x.id === r.id);
      return m ? {
        id: m.id, nombre: m.nombre_material,
        actual: m.categoria || 'General',
        nuevo: r.categoria,
      } : null;
    }).filter(Boolean);
    setIaResults(cambios);
    setIaModal('preview');
  };

  const aplicarCategorizacionIA = async () => {
    console.log('[IA Materiales] Aplicar click. iaResults:', iaResults?.length);
    if (!iaResults || !iaResults.length) {
      showToast('No hay cambios para aplicar', 'amber');
      return;
    }
    const now = new Date().toISOString();
    const userId = auth?.profile?.id ?? 'offline';

    let materialesFresh;
    try {
      materialesFresh = await window.__db.materiales.toArray();
    } catch (e) {
      console.error('[IA Materiales] No se pudo leer DB:', e);
      showToast('Error leyendo materiales: ' + (e.message||e), 'red');
      return;
    }
    const byId = new Map(materialesFresh.map(m => [m.id, m]));

    // Construir registros a actualizar (skip no-ops y no-encontrados)
    const records = [];
    let saltados = 0;
    for (const c of iaResults) {
      const m = byId.get(c.id);
      if (!m) { saltados++; continue; }
      if (m.categoria === c.nuevo) { saltados++; continue; }
      records.push({
        ...m,
        categoria: c.nuevo,
        updated_at: now,
        updated_by: userId,
        version: (m.version ?? 0) + 1,
        sync_status: m.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
    }

    if (!records.length) {
      showToast(`Nada que aplicar · ${saltados} sin cambios`, 'amber');
      setIaModal(null);
      setIaResults([]);
      return;
    }

    // bulkPut en una sola transacción → MUCHO más rápido que update individual
    let aplicados = 0;
    try {
      await window.__db.materiales.bulkPut(records);
      aplicados = records.length;
    } catch (e) {
      console.error('[IA Materiales] bulkPut fallo:', e);
      showToast('Error al guardar: ' + (e.message||e), 'red');
      return;
    }

    // Audit log en background (no bloquea la UI)
    setTimeout(() => {
      Promise.all(records.map(r => {
        const orig = byId.get(r.id);
        return window.__logAudit?.({
          action: 'update', table: 'materiales', recordId: r.id,
          oldData: { categoria: orig?.categoria || 'General' },
          newData: { categoria: r.categoria },
          reason: 'Categorización IA (Claude)',
        }).catch(() => {});
      }));
    }, 0);

    try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'materiales' } })); } catch {}
    try { window.dispatchEvent(new Event('online')); } catch {}

    showToast(`${aplicados} materiales categorizados${saltados ? ` · ${saltados} sin cambios` : ''}`, 'green');
    setIaModal(null);
    setIaResults([]);
  };

  // ── Actualizar precio + grabar en historial ──────────────────────
  const abrirModalPrecio = (m) => {
    setPrecioTarget(m);
    setPrecioForm({
      precio_nuevo: Number(m.precio_unitario_estimado || 0).toFixed(2),
      motivo: 'manual',
      documento_ref: '',
      notas: '',
    });
  };

  const guardarNuevoPrecio = async () => {
    if (!precioTarget) return;
    const precioNuevo = parseFloat(precioForm.precio_nuevo);
    if (!Number.isFinite(precioNuevo) || precioNuevo < 0) {
      showToast('Precio inválido', 'red');
      return;
    }
    const precioAnterior = Number(precioTarget.precio_unitario_estimado || 0);
    if (Math.abs(precioNuevo - precioAnterior) < 0.0001) {
      showToast('El precio no cambió', 'amber');
      return;
    }
    const now = new Date().toISOString();
    const userId = auth?.profile?.id ?? 'offline';
    const histId = window.__newId();

    try {
      // 1) Insertar en historial
      await window.__db.material_precios_historial.add({
        id: histId,
        material_id: precioTarget.id,
        obra_id: precioTarget.obra_id,
        precio_anterior: precioAnterior,
        precio_nuevo: precioNuevo,
        fecha: now.slice(0,10),
        motivo: precioForm.notas || precioForm.motivo,
        documento_ref: precioForm.documento_ref || null,
        fuente: precioForm.motivo === 'manual' ? 'manual' : precioForm.motivo,
        origen_movimiento_id: null,
        created_by: userId, updated_by: userId,
        created_at: now, updated_at: now,
        version: 1, sync_status: 'pending_create', last_synced_at: null,
        idempotency_key: `${userId}_mph_${histId}`,
      });

      // 2) Actualizar material
      await window.__db.materiales.update(precioTarget.id, {
        precio_unitario_estimado: precioNuevo,
        updated_at: now,
        updated_by: userId,
        version: (precioTarget.version ?? 0) + 1,
        sync_status: precioTarget.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });

      try { await window.__logAudit?.({ action:'update', table:'materiales', recordId: precioTarget.id,
        oldData:{ precio_unitario_estimado: precioAnterior },
        newData:{ precio_unitario_estimado: precioNuevo, motivo: precioForm.notas, doc: precioForm.documento_ref },
        reason:`Cambio de precio: S/${precioAnterior.toFixed(2)} → S/${precioNuevo.toFixed(2)}` }); } catch {}

      try {
        window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'materiales' } }));
        window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'material_precios_historial' } }));
        window.dispatchEvent(new Event('online'));
      } catch {}

      const delta = precioNuevo - precioAnterior;
      const pct = precioAnterior > 0 ? (delta/precioAnterior*100).toFixed(1) : '∞';
      showToast(`${precioTarget.nombre_material}: S/${precioAnterior.toFixed(2)} → S/${precioNuevo.toFixed(2)} (${delta>=0?'+':''}${pct}%)`, 'green');
      setPrecioTarget(null);
    } catch (e) {
      console.error('[precio update]', e);
      showToast('Error: ' + (e.message||e), 'red');
    }
  };

  const verHistorialPrecios = async (m) => {
    setHistorialTarget(m);
    try {
      const rows = await window.__db.material_precios_historial
        .where('material_id').equals(m.id)
        .filter(r => !r.deleted_at)
        .toArray();
      rows.sort((a,b) => (b.fecha || '').localeCompare(a.fecha || ''));
      setHistorialData(rows);
    } catch (e) {
      console.error('[historial]', e);
      setHistorialData([]);
    }
  };

  const aplicarSyncDesdeAPU = async () => {
    if (!syncPreview || !syncPreview.cambios.length) return;
    const now = new Date().toISOString();
    let aplicados = 0, errores = 0;
    for (const c of syncPreview.cambios) {
      try {
        const m = materiales.find(x => x.id === c.id);
        if (!m) continue;
        await window.__db.materiales.update(c.id, {
          ...c.nuevo,
          updated_at: now,
          updated_by: auth?.profile?.id ?? 'offline',
          version: (m.version ?? 0) + 1,
          sync_status: m.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
        try { await window.__logAudit?.({ action:'update', table:'materiales', recordId: c.id,
          oldData: c.actual, newData: c.nuevo, reason:'Sincronización desde APU' }); } catch {}
        aplicados++;
      } catch (e) { errores++; }
    }
    try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'materiales' } })); } catch {}
    try { window.dispatchEvent(new Event('online')); } catch {}
    showToast(`${aplicados} materiales actualizados${errores ? ` · ${errores} con error` : ''}`, 'green');
    setModal(null);
    setSyncPreview(null);
  };

  const openModal = (type) => {
    setForm({
      fecha: hoyLocal(),
      hora: horaLocal(),
      tipo_movimiento: type === 'ingreso' ? 'entrada' : 'salida',
    });
    // Reseteamos el lote cada vez que se abre un modal de mov.
    setLoteItems([{ id: window.__newId?.() || crypto.randomUUID(), material_id:'', cantidad:'', precio:'', proveedor_id:null, responsable_id:null }]);
    setLoteComunes({ usarMismoProveedor: true, usarMismaPersona: true, proveedor_id: null, responsable_id: null, sinFactura: false, observacionesAlmacen: '' });
    setFrenteSalida('');
    setFrentePendiente(false);
    setModal(type);
  };

  // Estado del lote: items[] + flags "todos del mismo proveedor / persona".
  // Cuando el flag está activo, la columna individual se desactiva y se usa
  // el valor global de loteComunes.{proveedor_id, responsable_id}.
  const [loteItems, setLoteItems] = uS([]);
  const [loteComunes, setLoteComunes] = uS({ usarMismoProveedor: true, usarMismaPersona: true, proveedor_id: null, responsable_id: null, sinFactura: false, observacionesAlmacen: '' });
  // Frente de trabajo (OBLIGATORIO) común a toda la salida del lote, con
  // escape "lo completo después" → queda marcado como pendiente.
  const [frenteSalida, setFrenteSalida] = uS('');
  const [frentePendiente, setFrentePendiente] = uS(false);
  // Facturas pendientes de recepción (cargadas por contadora vía captura
  // mágica). Cuando el almacenero abre el modal de "Registrar Ingreso",
  // se le muestra un banner con la lista. Click → pre-rellena items.
  const [facturasPendientes, setFacturasPendientes] = uS([]);
  const [facturaVinculadaId, setFacturaVinculadaId] = uS(null);

  // Carga reactiva de facturas pendientes de recepción
  // Pendientes = 'pendiente_recepcion' o 'parcial' (las que todavía
  // necesitan al menos una entrega o un cierre manual). 'recibido' y
  // 'no_aplica' ya no aparecen.
  const PENDIENTE_STATUSES = ['pendiente_recepcion', 'parcial'];

  // Mapa accounting_movement_id → suma de cantidad ingresada (todos los
  // movs vinculados). Usado para mostrar "800/2000 recibidos" en el banner.
  const [progresoPorFactura, setProgresoPorFactura] = uS(new Map());

  // Modal de cierre manual: la almacenera marca una factura como "entrega
  // completa" con observación (ej. "completo", "proveedor adeuda 5 ud").
  const [cerrarRecepcionFactura, setCerrarRecepcionFactura] = uS(null);

  uE(() => {
    if (!obraId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await window.__db.accounting_movements
          .where('obra_id').equals(obraId)
          .filter(m => PENDIENTE_STATUSES.includes(m.recepcion_status) && !m.deleted_at)
          .toArray();
        rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

        // Cargar progreso: para cada factura, sumar cantidad ingresada.
        const facturaIds = rows.map(r => r.id);
        const progresoMap = new Map();
        if (facturaIds.length) {
          const movsLinkeados = await window.__db.movimientos_materiales
            .where('obra_id').equals(obraId)
            .filter(m => m.tipo_movimiento === 'entrada'
                      && facturaIds.includes(m.accounting_movement_id))
            .toArray();
          for (const mov of movsLinkeados) {
            const key = mov.accounting_movement_id;
            const cur = progresoMap.get(key) || { items: 0, qty: 0 };
            cur.items += 1;
            cur.qty += Number(mov.cantidad || 0);
            progresoMap.set(key, cur);
          }
        }

        if (!cancelled) {
          setFacturasPendientes(rows);
          setProgresoPorFactura(progresoMap);
        }
      } catch {}
    };
    load();
    const onChange = (e) => {
      const t = e?.detail?.tabla || e?.detail?.table;
      if (!t || t === 'accounting_movements' || t === 'movimientos_materiales') load();
    };
    window.addEventListener('jx_data_changed', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('jx_data_changed', onChange);
    };
  }, [obraId]);

  // Helper: aplicar items de una factura al lote actual
  const vincularFactura = (facturaId) => {
    const factura = facturasPendientes.find(f => f.id === facturaId);
    if (!factura) return;
    let items = [];
    try {
      const j = JSON.parse(factura.notas || '{}');
      items = Array.isArray(j.items_factura) ? j.items_factura : [];
    } catch {}
    if (!items.length) {
      showToast('Esa factura no tiene items detallados', 'amber');
      return;
    }
    const itemsConMaterial = items.filter(it => it.material_id);
    if (!itemsConMaterial.length) {
      showToast('Los items de la factura no están vinculados al catálogo. Pedile a gerencia que los cree primero.', 'red');
      return;
    }
    // Pre-rellenar el lote
    setLoteItems(itemsConMaterial.map((it, idx) => ({
      id: `factura_${idx}_${Date.now()}`,
      material_id: it.material_id,
      cantidad: String(it.cantidad ?? ''),
      precio: String(it.precio_unitario ?? ''),
      proveedor_id: factura.proveedor_id || null,
      ubicacion_id: null,
    })));
    setLoteComunes(c => ({
      ...c,
      usarMismoProveedor: true,
      proveedor_id: factura.proveedor_id || null,
    }));
    setForm(f => ({
      ...f,
      documento: factura.document_number || f.documento,
    }));
    setFacturaVinculadaId(facturaId);
    showToast(`✓ Vinculado a factura ${factura.document_number} — ${itemsConMaterial.length} item(s) cargados`, 'green');
  };

  // Cierre manual de la recepción de una factura. Marca `recepcion_status`
  // como 'recibido' y persiste la observación obligatoria. Esto cierra el
  // aviso aunque las cantidades no estén completas (la observación explica
  // por qué — ej. "proveedor adeuda 5 ud").
  const cerrarRecepcion = async (factura, observacion) => {
    if (!observacion || observacion.trim().length < 5) {
      showToast('Escribí una observación (mín 5 caracteres)', 'red');
      return;
    }
    try {
      const now = new Date().toISOString();
      const userId = auth?.profile?.id || null;
      await window.__db.accounting_movements.update(factura.id, {
        recepcion_status: 'recibido',
        recepcion_observaciones: observacion.trim(),
        recepcion_completada_at: now,
        recepcion_completada_por: userId,
        updated_at: now,
        updated_by: userId,
        version: (factura.version ?? 0) + 1,
        sync_status: factura.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      try { await window.__logAudit?.({
        action: 'update', table: 'accounting_movements', recordId: factura.id,
        oldData: { recepcion_status: factura.recepcion_status },
        newData: { recepcion_status: 'recibido', recepcion_observaciones: observacion.trim() },
        reason: `Recepción cerrada manualmente: ${observacion.trim()}`,
      }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'accounting_movements' } })); } catch {}
      try { window.dispatchEvent(new Event('online')); } catch {}
      showToast(`✓ Recepción cerrada · factura ${factura.document_number || ''}`, 'green');
      setCerrarRecepcionFactura(null);
    } catch (e) {
      showToast('Error al cerrar: ' + (e.message || e), 'red');
    }
  };

  const updateLoteItem = (id, patch) => {
    setLoteItems(items => items.map(it => it.id === id ? { ...it, ...patch } : it));
  };
  const addLoteItem = () => {
    setLoteItems(items => [...items, { id: window.__newId?.() || crypto.randomUUID(), material_id:'', cantidad:'', precio:'', proveedor_id:null, responsable_id:null }]);
  };
  const removeLoteItem = (id) => {
    setLoteItems(items => items.length > 1 ? items.filter(it => it.id !== id) : items);
  };

  const openEditMaterial = (m) => {
    setForm({
      nombre_material: m.nombre_material || '',
      categoria: m.categoria || '',
      unidad: m.unidad || '',
      stock_inicial: m.stock_inicial ?? '',
      stock_minimo: m.stock_minimo ?? '',
      precio: m.precio_unitario_estimado ?? '',
      proveedor_id: m.proveedor_principal_id || null,
      ubicacion_id: m.ubicacion_id || '',
      // Super Admin: fecha de registro editable (created_at → fecha YYYY-MM-DD)
      fecha_registro: (m.created_at || '').slice(0, 10),
    });
    setEditingId(m.id);
    setModal('editar');
    // Foto: reseteamos. La existente del material se ve en la lista (thumbnail);
    // si el user adjunta una nueva, reemplaza a la anterior al guardar.
    if (foto?.url) try { URL.revokeObjectURL(foto.url); } catch {}
    setFoto(null);
  };

  // Mueve un material existente a la tabla EPPs (clona + soft-delete).
  // Usable desde el modal de edición Y desde el botón inline en la fila
  // (cuando el detector identifica el material como EPP).
  const moverMaterialAEpps = async (mat, opts = {}) => {
    if (!mat?.id) return;
    const tipoEpp = detectarEPP(mat.nombre_material) || 'Otro';
    const skipConfirm = opts.skipConfirm === true;
    if (!skipConfirm) {
      if (!confirm(`¿Mover "${mat.nombre_material}" a la base de EPPs?\n\nSe creará un EPP nuevo (tipo "${tipoEpp}") con el stock actual. El material original queda marcado como eliminado pero sus movimientos históricos se mantienen.`)) {
        return;
      }
    }
    try {
      const nuevoEppId = window.__newId();
      const stockInicial = Number(mat.stock_actual ?? 0);
      const stockMinimo = Number(mat.stock_minimo ?? 0);
      await window.__db.epps.add({
        id: nuevoEppId,
        obra_id: mat.obra_id,
        nombre_epp: mat.nombre_material,
        tipo_epp: tipoEpp,
        marca: null,
        modelo: null,
        talla: null,
        vida_util_dias: null,
        unidad: mat.unidad || 'Und',
        stock_inicial: stockInicial,
        stock_actual: stockInicial,
        stock_minimo: stockMinimo,
        precio_unitario_estimado: mat.precio_unitario_estimado || null,
        proveedor_principal_id: mat.proveedor_principal_id || null,
        ubicacion_id: mat.ubicacion_id || null,
        alerta: mat.alerta || calcAlerta(stockInicial, stockMinimo),
        estado: 'activo',
        material_origen_id: mat.id,
        created_by: auth?.profile?.id || null,
        updated_by: auth?.profile?.id || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: 1,
        sync_status: 'pending_create',
        last_synced_at: null,
        idempotency_key: window.__newIdempotencyKey?.(auth?.profile?.id || 'offline', 'epps') || null,
      });
      await updateMaterial(mat.id, { deleted_at: new Date().toISOString() });
      try { await window.__logAudit?.({
        action: 'update', table: 'materiales', recordId: mat.id, oldData: mat,
        newData: { migrado_a_epp: nuevoEppId },
        reason: `Migrado a EPPs (tipo ${tipoEpp}, id ${nuevoEppId})`,
      }); } catch {}
      showToast(`✓ "${mat.nombre_material}" movido a EPPs (${tipoEpp})`, 'green');
      return nuevoEppId;
    } catch (e) {
      showToast('Error al mover: ' + (e?.message || e), 'red');
      return null;
    }
  };

  const handleFotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Solo se permiten imágenes', 'red');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      showToast('La foto supera los 8 MB', 'red');
      return;
    }
    if (foto?.url) try { URL.revokeObjectURL(foto.url); } catch {}
    setFoto({ blob: file, url: URL.createObjectURL(file) });
  };

  const closeModalMaterial = () => {
    if (foto?.url) try { URL.revokeObjectURL(foto.url); } catch {}
    setFoto(null);
    setModal(null);
    setEditingId(null);
    setForm({});
  };

  const handleDeleteMaterial = async (m) => {
    if (!canDelete) return;
    if (!confirm(`¿Eliminar el material "${m.nombre_material}"?\n\nEsta acción se sincronizará al servidor. Los movimientos históricos no se verán afectados.`)) return;
    try {
      await updateMaterial(m.id, { deleted_at: new Date().toISOString() });
      try { await window.__logAudit?.({ action:'delete', table:'materiales', recordId:m.id, oldData:m, reason:'Eliminación manual (modo edición)' }); } catch(e) {}
      showToast(`Material "${m.nombre_material}" eliminado`, 'amber');
    } catch (e) { showToast('Error al eliminar: ' + (e.message||e), 'red'); }
  };

  const handleSubmitMaterial = async () => {
    if (busyMat) return; // doble click guard
    if (!form.nombre_material || !form.unidad) {
      showToast('Completa nombre y unidad', 'red');
      return;
    }
    setBusyMat(true);
    try {
      // Helper de alerta vive en src/lib/stock-utils.js (testeable, reusable).

      let materialId = editingId;
      if (editingId) {
        // EDITAR — preserva stock_actual pero recalcula alerta con nuevos parámetros
        const oldData = materiales.find(m => m.id === editingId);
        const stockActual = Number(oldData?.stock_actual ?? 0);
        const stockMinimo = parseFloat(form.stock_minimo) || 0;
        const newFields = {
          nombre_material: form.nombre_material,
          categoria: form.categoria || 'General',
          unidad: form.unidad,
          stock_inicial: parseFloat(form.stock_inicial) || 0,
          stock_minimo: stockMinimo,
          precio_unitario_estimado: parseFloat(form.precio) || null,
          proveedor_principal_id: form.proveedor_id || null,
          ubicacion_id: form.ubicacion_id || null,
          alerta: calcAlerta(stockActual, stockMinimo),
          padre_id: form.padre_id || null,
        };
        // Super Admin: permitir corregir la fecha de registro (created_at).
        // Útil al cargar materiales que existían desde antes del sistema.
        if (superAdmin && form.fecha_registro && form.fecha_registro !== (oldData?.created_at || '').slice(0, 10)) {
          newFields.created_at = new Date(form.fecha_registro + 'T12:00:00').toISOString();
        }
        await updateMaterial(editingId, newFields);
        try { await window.__logAudit?.({ action:'update', table:'materiales', recordId:editingId, oldData, newData:newFields }); } catch(e) {}
        showToast(`Material "${form.nombre_material}" actualizado`, 'green');
      } else {
        const stockInicial = parseFloat(form.stock_inicial) || 0;
        const stockMinimo = parseFloat(form.stock_minimo) || 0;
        const alertaInicial = calcAlerta(stockInicial, stockMinimo);
        const created = await createMaterial({
          obra_id: obraId,
          nombre_material: form.nombre_material,
          categoria: form.categoria || 'General',
          unidad: form.unidad,
          stock_inicial: stockInicial,
          stock_actual: stockInicial,
          stock_minimo: stockMinimo,
          precio_unitario_estimado: parseFloat(form.precio) || null,
          proveedor_principal_id: form.proveedor_id || null,
          ubicacion_id: form.ubicacion_id || null,
          alerta: alertaInicial,
          estado: 'activo',
          padre_id: form.padre_id || null,
        });
        materialId = created?.id;
        // Toast adicional si nace con alerta para que el usuario lo sepa
        if (alertaInicial === 'agotado') showToast(`⚠ "${form.nombre_material}" creado SIN STOCK — abajo del mínimo`, 'red');
        else if (alertaInicial === 'critico') showToast(`⚠ "${form.nombre_material}" en estado CRÍTICO desde el inicio`, 'red');
        else if (alertaInicial === 'reponer') showToast(`⚠ "${form.nombre_material}" requiere reposición ya`, 'amber');
        else if (alertaInicial === 'cerca') showToast(`"${form.nombre_material}" cerca del stock mínimo`, 'amber');
        else showToast(`Material "${form.nombre_material}" creado`, 'green');
        try { await window.__logAudit?.({ action:'insert', table:'materiales', recordId:created?.id, newData:created }); } catch(e) {}
      }

      // Foto: si el user adjuntó una, la guardamos como evidencia vinculada al
      // material. EvidenceUploader (gatillado por SyncEngine) la subirá a
      // Supabase Storage en el siguiente ciclo y poblará url_archivo.
      if (foto?.blob && materialId) {
        try {
          await window.__saveEvidenciaLocal?.({
            id: window.__newId(),
            obra_id: obraId,
            tipo_evidencia: 'foto_material',
            modulo_relacionado: 'materiales',
            registro_relacionado_id: materialId,
            nombre_archivo: foto.blob.name || `material_${materialId}.jpg`,
            mime_type: foto.blob.type || 'image/jpeg',
            blob: foto.blob,
            observaciones: `Foto referencial del material ${form.nombre_material}`,
            fecha: new Date().toISOString().slice(0, 10),
            created_by: auth?.profile?.id || null,
          });
        } catch (e) {
          showToast('Material guardado, pero la foto falló: ' + (e?.message || e), 'amber');
        }
      }

      closeModalMaterial();
    } catch (e) {
      showToast('Error: ' + e.message, 'red');
    } finally {
      setBusyMat(false);
    }
  };

  const handleSubmitMovimiento = async (tipo) => {
    if (!form.material_id || !form.cantidad) {
      showToast('Selecciona material y cantidad', 'red');
      return;
    }
    const material = materiales.find(m => m.id === form.material_id);
    const cantNum = parseFloat(form.cantidad) || 0;

    // ── Validaciones de sentido común ───────────────────────────
    if (cantNum <= 0) {
      showToast('La cantidad debe ser mayor a 0', 'red');
      return;
    }
    const hoy = new Date().toISOString().slice(0, 10);
    if (form.fecha && form.fecha > hoy) {
      showToast('No podés registrar un movimiento con fecha futura', 'red');
      return;
    }
    // Si hay responsable, validar que ya haya ingresado a la fecha del mov
    if (form.responsable_id) {
      const resp = personal?.find(p => p.id === form.responsable_id);
      if (resp?.fecha_ingreso && form.fecha && String(resp.fecha_ingreso) > form.fecha) {
        showToast(`${resp.nombres} aún no había ingresado a la obra el ${form.fecha} (ingreso: ${resp.fecha_ingreso})`, 'red');
        return;
      }
    }

    // ── Validación de stock para SALIDA ─────────────────────────
    // BLOQUEO ESTRICTO para todos los roles. No es posible sacar lo que
    // no existe — viola conservación de masa y rompe la trazabilidad.
    // Si el almacenero ve que físicamente sí está pero el sistema dice
    // que no, primero hay que registrar el INGRESO faltante (avisar a
    // contabilidad si no hay factura → flujo Paquete A).
    if (tipo === 'salida') {
      const stockActual = Number(material.stock_actual ?? 0);
      if (cantNum > stockActual) {
        const faltante = cantNum - stockActual;
        showToast(
          `❌ Stock insuficiente: ${material.nombre_material} tiene ${stockActual} ${material.unidad}, ` +
          `pediste ${cantNum} ${material.unidad} (faltan ${faltante}). ` +
          `Registrá primero el ingreso pendiente o consultá a contabilidad si falta sustento.`,
          'red'
        );
        return;
      }
    }
    const stockForzado = false; // legacy — ya no se usa, pero el audit log lo referencia abajo

    try {
      const movCreated = await movHook.create({
        obra_id: obraId,
        material_id: form.material_id,
        fecha: form.fecha,
        hora: form.hora,
        tipo_movimiento: tipo === 'ingreso' ? 'entrada' : 'salida',
        cantidad: cantNum,
        unidad: material.unidad,
        // Destino (persona o subcontrato) — consistente con el lote (Fase B)
        ...splitDestino(form.responsable_id),
        proveedor_id: form.proveedor_id || null,
        documento_asociado: form.documento || null,
        // partida_id SIEMPRE null al crear desde almacén (Paquete C).
        // El ingeniero la asigna después desde su inbox.
        partida_id: null,
        precio_unitario_real: parseFloat(form.precio) || null,
        observaciones: form.observaciones || null,
      });
      try { await window.__logAudit?.({ action:'insert', table:'movimientos_materiales', recordId:movCreated?.id, newData:movCreated, reason:`${tipo} de ${cantNum} ${material.unidad} de ${material.nombre_material}${stockForzado ? ' (STOCK FORZADO — quedó negativo)' : ''}` }); } catch(e) {}

      // Audit log especial cuando se fuerza salida sin stock
      if (stockForzado) {
        try { await window.__logAudit?.({ action:'alert', table:'movimientos_materiales', recordId: movCreated?.id,
          oldData:{ stock_actual: Number(material.stock_actual ?? 0) },
          newData:{ cantidad_salida: cantNum, faltante: cantNum - Number(material.stock_actual ?? 0), forzado_por: auth?.profile?.id },
          reason:`⚠ Salida FORZADA sin stock: ${material.nombre_material} — quedó en negativo` }); } catch {}
        showToast(`⚠ Salida forzada registrada. Stock quedó en negativo.`, 'amber');
      }

      // Detección de discrepancia de precio (solo en ENTRADAS):
      // Si el precio real difiere >5% del estimado del material, levantar
      // alerta para que contabilidad/gerencia revise y actualice si toca.
      if (tipo === 'ingreso') {
        const precioReal = parseFloat(form.precio) || 0;
        const precioEstimado = Number(material.precio_unitario_estimado || 0);
        if (precioReal > 0 && precioEstimado > 0) {
          const diffPct = Math.abs(precioReal - precioEstimado) / precioEstimado * 100;
          if (diffPct >= 5) {
            try { await window.__logAudit?.({ action:'alert', table:'materiales', recordId: material.id,
              oldData:{ precio_estimado: precioEstimado },
              newData:{ precio_real_compra: precioReal, mov_id: movCreated?.id, doc: form.documento },
              reason:`⚠ Discrepancia precio: estimado S/${precioEstimado.toFixed(2)} vs real S/${precioReal.toFixed(2)} (${diffPct.toFixed(1)}%)` }); } catch {}
            const direccion = precioReal > precioEstimado ? 'subió' : 'bajó';
            showToast(`⚠ Precio real ${direccion} ${diffPct.toFixed(1)}% vs estimado. Avisa a contabilidad para actualizar.`, 'amber');
          }
        }
      }

      // NOTA: la imputación a partida (insumos_partida + costo_real_acumulado)
      // ya no ocurre acá. El ingeniero la asigna desde su inbox usando
      // aplicarConsumoPartida() en src/lib/partida-allocation.js. Paquete C.

      // Actualizar stock local optimistamente
      const delta = tipo === 'ingreso' ? parseFloat(form.cantidad) : -parseFloat(form.cantidad);
      const nuevoStock = (material.stock_actual ?? 0) + delta;
      const minimo = Number(material.stock_minimo || 0);
      const nuevaAlerta = nuevoStock <= 0 ? 'agotado'
        : minimo > 0 && nuevoStock <= minimo * 0.5 ? 'critico'
        : minimo > 0 && nuevoStock <= minimo ? 'reponer'
        : minimo > 0 && nuevoStock <= minimo * 1.2 ? 'cerca'
        : 'ok';
      await window.__db.materiales.update(form.material_id, {
        stock_actual: nuevoStock,
        alerta: nuevaAlerta,
      });
      refresh();
      const accionLabel = tipo === 'ingreso' ? 'Ingreso' : 'Salida';
      const sync = navigator.onLine ? 'sincronizando…' : 'guardado offline';
      // Toast principal + warning de estado si el stock quedó comprometido
      if (nuevaAlerta === 'agotado') {
        showToast(`⚠ ${accionLabel} registrado — stock AGOTADO de ${material.nombre_material}`, 'red');
      } else if (nuevaAlerta === 'critico') {
        showToast(`⚠ ${accionLabel} registrado — stock CRÍTICO (${nuevoStock} ≤ ${(minimo*0.5).toFixed(1)} mín·0.5)`, 'red');
      } else if (nuevaAlerta === 'reponer') {
        showToast(`⚠ ${accionLabel} registrado — alcanzó stock mínimo (${nuevoStock} / ${minimo}). Solicitar reposición`, 'amber');
      } else if (nuevaAlerta === 'cerca') {
        showToast(`${accionLabel} registrado — cerca del mínimo (${nuevoStock} / ${minimo}). Considerar reponer pronto`, 'amber');
      } else {
        showToast(`${accionLabel} registrado · ${sync}`, 'green');
      }
      setModal(null);
      setForm({});
    } catch (e) {
      showToast('Error: ' + e.message, 'red');
    }
  };

  // ── Handler de lote: registra N movimientos del mismo tipo en una sola
  // operación. Usa los campos comunes del form (fecha, hora, observaciones,
  // documento) + items individuales. Para proveedor/persona, si el flag
  // "usar mismo X" está activo, se aplica el valor global a todos.
  // Guard SÍNCRONO anti doble-click. El guard por estado (busyMovLote) tiene
  // una VENTANA DE CARRERA: setBusyMovLote(true) recién corre después de las
  // validaciones (que tienen awaits a Dexie) — dos clicks en esa ventana
  // pasaban AMBOS (duplicados del 22-jul: CEMENTO/ARENA/HORMIGÓN con 35-211ms
  // de delta). El ref corta el segundo click en el MISMO tick.
  const loteEnCursoRef = React.useRef(false);
  const handleSubmitMovLote = async (tipo) => {
    if (loteEnCursoRef.current) return;
    loteEnCursoRef.current = true;
    try { await handleSubmitMovLoteInner(tipo); }
    finally { loteEnCursoRef.current = false; }
  };
  const handleSubmitMovLoteInner = async (tipo) => {
    // Doble-click guard: si ya estamos procesando, ignorar clicks extra.
    // Bug en prod: ARENAS GRUESA / PIEDRA CHANCADA aparecieron 2x con
    // mismo timestamp 10:48 → stock cayó a -45. Causa: click rápido
    // doble en "Registrar Salida".
    if (busyMovLote) return;
    const itemsValidos = loteItems.filter(it => it.material_id && parseFloat(it.cantidad) > 0);
    if (itemsValidos.length === 0) {
      showToast('Agregá al menos un material con cantidad', 'red');
      return;
    }
    const hoy = new Date().toISOString().slice(0, 10);
    if (form.fecha && form.fecha > hoy) {
      showToast('No podés registrar un movimiento con fecha futura', 'red');
      return;
    }
    if (tipo === 'salida' && loteComunes.usarMismaPersona && !loteComunes.responsable_id) {
      // No es obligatorio responsable, pero advertir
    }

    // ── AVISO ANTI-DUPLICADO (22-jul): la otra mitad de los duplicados fueron
    // RE-REGISTROS humanos minutos después (TUBO PVC ×2 a 34 min, ENMALLADO
    // ×3). Si en las últimas 6 horas ya se registró un movimiento IDÉNTICO
    // (mismo material, tipo, cantidad y fecha), avisar antes de guardar.
    // Nunca bloquea: el confirm deja registrar si es legítimo.
    try {
      const hace6h = Date.now() - 6 * 3600 * 1000;
      const tipoMov = tipo === 'ingreso' ? 'entrada' : 'salida';
      const repetidos = [];
      for (const it of itemsValidos) {
        const cant = parseFloat(it.cantidad) || 0;
        const previos = await window.__db.movimientos_materiales
          .filter(m => !m.deleted_at && m.material_id === it.material_id && m.tipo_movimiento === tipoMov
            && Number(m.cantidad) === cant && m.fecha === form.fecha && Date.parse(m.created_at || 0) > hace6h)
          .count();
        if (previos > 0) {
          const mat = materiales.find(x => x.id === it.material_id);
          repetidos.push(`${mat?.nombre_material || 'material'} ×${cant}`);
        }
      }
      if (repetidos.length && !window.confirm(`⚠ POSIBLE DUPLICADO\n\nHoy ya registraste un movimiento IDÉNTICO de:\n• ${repetidos.join('\n• ')}\n\nSi solo estás verificando, cancelá — el registro anterior YA quedó guardado.\n\n¿Registrar OTRA VEZ de todos modos?`)) return;
    } catch { /* el aviso nunca debe romper el flujo */ }

    // ── Validación CUMULATIVA de stock para SALIDA ────────────────
    // Antes solo se chequeaba cada fila contra el stock actual, pero si
    // el lote tiene 3 filas del mismo material (3+5+10 unidades) cada
    // una pasaba si stock_actual >= esa fila individual. Ahora se
    // acumula el descuento proyectado por material y se rechaza si en
    // algún momento bajaría de 0. Esto impide TODO stock negativo
    // (sin permitir forzar), alineado con CHECK constraint del server.
    // Stock CONFIABLE por material: si el snapshot stock_actual quedó por DEBAJO
    // de lo que respaldan los MOVIMIENTOS (drift de sincronización — una entrada
    // que existe pero el contador snapshot no reflejó; el caso real "registré el
    // ingreso ayer y hoy me dice sin stock"), usamos el historial como base para
    // no bloquear una salida LEGÍTIMA. Nunca habilita MÁS de lo que los
    // movimientos respaldan (si el snapshot está inflado, se respeta el snapshot).
    const stockConfiablePorMat = new Map(); // mid → { confiable, segunMovs, tieneHist }
    if (tipo === 'salida') {
      const idsSal = [...new Set(itemsValidos.map(it => it.material_id).filter(Boolean))];
      for (const mid of idsSal) {
        const mat = materiales.find(m => m.id === mid);
        let hist = [];
        try { hist = await window.__db.movimientos_materiales.filter(m => m.material_id === mid).toArray(); } catch {}
        const snap = Number(mat?.stock_actual ?? 0);
        const vivos = hist.filter(m => !m.deleted_at && !m.reverses_id && !m.reversed_by_id);
        const segunMovs = Math.max(0, stockSegunMovimientos(hist));
        stockConfiablePorMat.set(mid, {
          confiable: stockDisponibleConfiable({ stockActual: snap, movimientos: hist }),
          segunMovs,
          tieneHist: vivos.length > 0,
        });
      }
    }

    if (tipo === 'salida') {
      const proyeccion = new Map(); // material_id → stock proyectado
      for (const it of itemsValidos) {
        const mat = materiales.find(m => m.id === it.material_id);
        if (!mat) continue;
        const cant = parseFloat(it.cantidad);
        const baseConfiable = stockConfiablePorMat.has(it.material_id)
          ? stockConfiablePorMat.get(it.material_id).confiable
          : Number(mat.stock_actual ?? 0);
        const stockBase = proyeccion.has(it.material_id)
          ? proyeccion.get(it.material_id)
          : baseConfiable;
        const stockProyectado = stockBase - cant;
        if (stockProyectado < 0) {
          const snapshot = Number(mat.stock_actual ?? 0);
          // Si el bloqueo lo causó el snapshot (menor que los movimientos), avisamos
          // que es un desajuste de datos, no falta de material.
          const hayDrift = baseConfiable > snapshot + 0.001;
          showToast(
            `❌ Stock insuficiente para ${mat.nombre_material}: disponible ${Math.max(0, stockBase)} ${mat.unidad}, pedís ${cant} ${mat.unidad}.` +
            (hayDrift
              ? ` (El stock guardado dice ${snapshot} pero los movimientos respaldan ${baseConfiable} — hay un desajuste; "Recalcular stocks" lo corrige.)`
              : ` Quitá filas, reducí la cantidad o registrá primero el ingreso.`),
            'red'
          );
          setBusyMovLote(false);
          return;
        }
        proyeccion.set(it.material_id, stockProyectado);
      }
    }

    // Origen obligatorio + validación POR UBICACIÓN (salida). Si el material
    // está distribuido por almacén, exige elegir de cuál sale y valida que ahí
    // haya stock. Materiales sin desglose siguen con la validación global de arriba.
    // reconciliacionesDrift: cuando el desglose quedó ATRÁS de stock_actual
    // (la fuente de verdad), la diferencia se acredita a la ubicación elegida
    // y se sanea la fila tras registrar la salida — sin esto, la salida
    // LEGÍTIMA de 8 con "Almacén Central: 7" se bloqueaba (caso reportado).
    const reconciliacionesDrift = [];
    if (tipo === 'salida' && ubicacionesActivas.length >= 1) {
      const proyecUbic = new Map();
      // El faltante (stock_actual − Σdesglose) es POR MATERIAL: si el mismo
      // material sale de DOS almacenes en el lote, solo la primera fila lo
      // acredita (sin esto se reconciliaba duplicado).
      const driftAcreditado = new Set();
      for (const it of itemsValidos) {
        const mat = materiales.find(m => m.id === it.material_id);
        const dgItem = desgloseUbic.get(it.material_id);
        const tieneDesglose = dgItem && Array.from(dgItem.values()).some(c => Number(c) > 0);
        if (!tieneDesglose) continue;
        // Auto-origen: si el material está en UN solo almacén con stock, se
        // resuelve solo. Solo si está repartido en ≥2 almacenes obligamos a
        // elegir de cuál sale (el selector aparece en la fila).
        const ubic = it.ubicacion_id || ubicacionAutoOrigen(dgItem) || null;
        if (!ubic) {
          showToast(`"${mat?.nombre_material}" está repartido en varios almacenes — elegí de cuál sale en la columna "Almacén de origen".`, 'red');
          setBusyMovLote(false); return;
        }
        const key = `${it.material_id}__${ubic}`;
        let base;
        if (proyecUbic.has(key)) {
          base = proyecUbic.get(key);
        } else if (driftAcreditado.has(it.material_id)) {
          // El faltante de este material ya se acreditó a OTRA ubicación del
          // mismo lote — esta fila valida contra su desglose puro.
          base = Number(dgItem.get(ubic) || 0);
        } else {
          // Base por almacén: el drift solo se acredita cuando lo RESPALDAN los
          // movimientos. Snapshot bajo → usar el historial (desbloquea la salida
          // legítima). Snapshot INFLADO (mayor que los movimientos) → cap en
          // min(snapshot, max(segunMovs, Σdesglose)): sin el cap, el "faltante"
          // fantasma se acreditaba a la ubicación y se propagaba al server como
          // stock que no existe. Sin historial (seed/import), snapshot manda.
          const stockRefUbic = (() => {
            const snap = Number(mat?.stock_actual ?? 0);
            const info = stockConfiablePorMat.get(it.material_id);
            if (!info || !info.tieneHist) return snap;
            if (info.segunMovs >= snap) return info.segunMovs;
            const sumaDesglose = dgItem ? Array.from(dgItem.values()).reduce((a, b) => a + (Number(b) || 0), 0) : 0;
            return Math.min(snap, Math.max(info.segunMovs, sumaDesglose));
          })();
          const r = baseSalidaUbicacion(dgItem, ubic, stockRefUbic);
          base = r.base;
          if (r.reconciliarDelta > 0) {
            reconciliacionesDrift.push({ itemTipo: 'material', itemId: it.material_id, ubicacionId: ubic, delta: r.reconciliarDelta });
            driftAcreditado.add(it.material_id);
          }
        }
        const cant = parseFloat(it.cantidad) || 0;
        if (base - cant < 0) {
          showToast(`❌ Stock insuficiente de "${mat?.nombre_material}" en ${ubicacionesById.get(ubic)?.nombre || 'ese almacén'}: hay ${base}, pedís ${cant}.`, 'red');
          setBusyMovLote(false); return;
        }
        proyecUbic.set(key, base - cant);
      }
    }

    // ── Validación CRONOLÓGICA (salida) ─────────────────────────────
    // No puede salir mercadería que a ESA fecha aún no había ingresado, ni
    // dejar negativo un punto posterior de la línea de tiempo (caso real
    // rotomartillos: salida retro 11/05 con la entrada recién el 15/05).
    if (tipo === 'salida' && form.fecha) {
      const porItem = agruparCantidades(itemsValidos, it => it.material_id);
      for (const [mid, cantTotal] of porItem) {
        const mat = materiales.find(m => m.id === mid);
        let hist = [];
        try { hist = await window.__db.movimientos_materiales.filter(m => m.material_id === mid).toArray(); } catch {}
        const rc = validarSalidaCronologica({ movimientos: hist, fecha: form.fecha, cantidad: cantTotal, stockActualHoy: Number(mat?.stock_actual ?? 0) });
        if (!rc.ok) {
          showToast(`❌ Incongruencia de fechas: al ${form.fecha}, "${mat?.nombre_material}" solo tenía ${rc.disponible} ${mat?.unidad || ''} disponible(s) — las entradas posteriores a esa fecha no cuentan. Corregí la fecha de la salida o la cantidad.`, 'red');
          setBusyMovLote(false); return;
        }
      }
    }

    // Frente OBLIGATORIO en salida: hay que elegir uno, o marcar
    // explícitamente "lo completo después" (queda pendiente).
    if (tipo === 'salida' && !frenteSalida && !frentePendiente) {
      showToast('Elegí el frente de trabajo, o marcá "lo completo después".', 'red');
      return;
    }

    // Idempotency a nivel LOTE: una clave por click → cada item usa
    // una sub-clave determinista. Si el browser dobla submit por
    // cualquier motivo (network glitch, react re-render anómalo), el
    // server rechaza por UNIQUE(idempotency_key) y no se crean duplicados.
    const loteKey = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? `lote-mov-mat-${crypto.randomUUID()}`
      : `lote-mov-mat-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Almacén TEMPORAL para ingresos sin lugar de llegada (mismo nombre que el
    // de la importación histórica). Se crea una sola vez por obra.
    const TEMPORAL_NOMBRE = 'Por asignar (temporal)';
    let enTemporalManual = 0;
    let temporalId = null;
    const resolverUbicTemporal = async () => {
      if (temporalId) return temporalId;
      const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      const existente = (ubicaciones || []).find(u => !u.deleted_at && norm(u.nombre) === norm(TEMPORAL_NOMBRE));
      if (existente) { temporalId = existente.id; return temporalId; }
      // La lista del hook puede estar desfasada (lote anterior recién creó el
      // temporal): consultamos Dexie directo antes de crear, para no duplicar.
      try {
        const enDb = await window.__db.ubicaciones_obra
          .filter(u => u.obra_id === obraId && !u.deleted_at && norm(u.nombre) === norm(TEMPORAL_NOMBRE))
          .first();
        if (enDb) { temporalId = enDb.id; return temporalId; }
      } catch {}
      try {
        const id = window.__newId();
        const now = new Date().toISOString();
        await window.__db.ubicaciones_obra.add({
          id, obra_id: obraId, nombre: TEMPORAL_NOMBRE,
          descripcion: 'Ingresos sin lugar de llegada — designar almacén real con un Traspaso',
          orden: 99, activo: true,
          created_by: auth?.profile?.id || null, updated_by: auth?.profile?.id || null,
          created_at: now, updated_at: now, version: 1,
          sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${auth?.profile?.id || 'x'}_ubic_${id}`,
        });
        try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'ubicaciones_obra' } })); } catch {}
        temporalId = id; return id;
      } catch { return null; }
    };

    setBusyMovLote(true);
    let exitosos = 0;
    let fallidos = 0;
    const errores = [];
    // Stock optimista ACUMULADO por material: con 2+ filas del MISMO material en
    // el lote, `materiales` (array de React, stale durante el loop) hacía que
    // cada fila recalculara desde el stock original y solo quedara el delta de
    // la ÚLTIMA (20−8−10 terminaba en 10 en vez de 2 → snapshot inflado que
    // luego AUTORIZABA salidas sin respaldo).
    const stockOptimista = new Map(); // material_id → stock proyectado

    try {
    for (let idx = 0; idx < itemsValidos.length; idx++) {
      const it = itemsValidos[idx];
      const material = materiales.find(m => m.id === it.material_id);
      if (!material) { fallidos++; continue; }
      const cantNum = parseFloat(it.cantidad) || 0;
      // Almacén del movimiento: en SALIDA se auto-resuelve si el material está
      // en un solo almacén; si está repartido usa el que eligió la fila. En
      // INGRESO es la ubicación elegida (o la principal del material) — y si NO
      // hay ninguna, va al almacén TEMPORAL "Por asignar": ningún material debe
      // ingresar sin saber a qué almacén llegó (recordatorio al final).
      let ubicMov = it.ubicacion_id
        || (tipo === 'salida' ? ubicacionAutoOrigen(desgloseUbic.get(it.material_id)) : null)
        || material.ubicacion_id || null;
      if (!ubicMov && tipo === 'ingreso') {
        ubicMov = await resolverUbicTemporal();
        if (ubicMov) enTemporalManual++;
      }
      const proveedor_id = tipo === 'ingreso'
        ? (loteComunes.usarMismoProveedor ? loteComunes.proveedor_id : it.proveedor_id) || null
        : null;
      // Destino combinado (persona o subcontrato). splitDestino lo separa en
      // responsable_id / subcontratista_id / destino_tipo (Fase B).
      const destinoVal = tipo === 'salida'
        ? (loteComunes.usarMismaPersona ? loteComunes.responsable_id : it.responsable_id) || null
        : null;
      const dest = splitDestino(destinoVal);
      try {
        const movCreated = await movHook.create({
          obra_id: obraId,
          material_id: it.material_id,
          fecha: form.fecha,
          hora: form.hora,
          tipo_movimiento: tipo === 'ingreso' ? 'entrada' : 'salida',
          cantidad: cantNum,
          unidad: material.unidad,
          responsable_id: dest.responsable_id,
          subcontratista_id: dest.subcontratista_id,
          destino_tipo: dest.destino_tipo,
          proveedor_id,
          documento_asociado: form.documento || null,
          // partida_id SIEMPRE null al crear desde almacén — la vinculación
          // material → partida la hace el rol "ingeniero" desde su inbox.
          // (Antes el almacenero la elegía con un dropdown, pero no tenía
          // contexto técnico para asignar bien — Paquete C del plan.)
          partida_id: null,
          // Frente de trabajo — mismo para todas las filas del lote.
          // Solo aplica en SALIDA; en ingreso queda null.
          frente_id: tipo === 'salida' ? (frenteSalida || null) : null,
          // Una salida que termina SIN frente es necesariamente diferida →
          // marcarla como pendiente. Ingreso → false.
          frente_pendiente: (tipo === 'salida' && !frenteSalida) ? true : false,
          // Almacén de origen (salida) / llegada (ingreso). Auditable en la fila.
          ubicacion_id: ubicMov,
          precio_unitario_real: parseFloat(it.precio) || null,
          observaciones: form.observaciones || null,
          // Idempotency determinista: si el browser re-envía, server
          // rechaza la fila duplicada por UNIQUE(idempotency_key).
          idempotency_key: `${loteKey}_${idx}_${it.material_id}`,
          // Flujo inverso almacén → contabilidad: si la almacenera marcó
          // "sin factura aún", el mov queda en cola de contabilidad
          // (pendiente_sustento=true). accounting_movement_id se setea
          // cuando la contadora vincule la factura desde su sección.
          ...(tipo === 'ingreso' && loteComunes.sinFactura ? {
            pendiente_sustento: true,
            observaciones_almacen: loteComunes.observacionesAlmacen?.trim() || null,
          } : {}),
          // Linkeo a factura vinculada: cada mov del lote queda asociado
          // a la factura. Sirve para calcular progreso "5/12 items"
          // (paquete B — entregas parciales) y para auditoría.
          ...(tipo === 'ingreso' && facturaVinculadaId && !loteComunes.sinFactura ? {
            accounting_movement_id: facturaVinculadaId,
          } : {}),
        });
        try { await window.__logAudit?.({ action:'insert', table:'movimientos_materiales', recordId:movCreated?.id, newData:movCreated, reason:`${tipo} en LOTE de ${cantNum} ${material.unidad} de ${material.nombre_material}` }); } catch {}

        // Saneo de DRIFT (una sola vez por lote): acreditar al desglose la
        // diferencia detectada contra stock_actual antes de restar la salida.
        while (reconciliacionesDrift.length) {
          const rec = reconciliacionesDrift.shift();
          try {
            await aplicarDelta({ obraId, itemTipo: rec.itemTipo, itemId: rec.itemId, ubicacionId: rec.ubicacionId, delta: rec.delta, userId: auth?.profile?.id || null });
            try { await window.__logAudit?.({ action: 'update', table: 'stock_ubicaciones', recordId: rec.itemId, reason: `Reconciliación de desglose (+${rec.delta}) — stock_actual manda` }); } catch {}
          } catch (e) { console.warn('[drift-reconciliar]', e?.message); }
        }
        // Stock por ubicación (desglose). INGRESO suma a la ubicación
        // elegida; SALIDA resta de la ubicación elegida (ya resuelta arriba
        // con auto-origen). Si no hay ubicación, solo cambia el stock global.
        if (ubicMov) {
          try {
            await aplicarDelta({
              obraId, itemTipo: 'material', itemId: it.material_id,
              ubicacionId: ubicMov,
              delta: tipo === 'ingreso' ? cantNum : -cantNum,
              userId: auth?.profile?.id || null,
            });
          } catch (e) { console.warn('[stock-ubic lote]', e?.message); }
        }
        // INGRESO: si el material no tenía ubicación principal, fijarla a la
        // primera donde ingresó (para que el desglose y los reportes sepan).
        if (tipo === 'ingreso' && it.ubicacion_id && it.ubicacion_id !== material.ubicacion_id) {
          try {
            await window.__db.materiales.update(it.material_id, {
              ubicacion_id: it.ubicacion_id,
              sync_status: material.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
              updated_at: new Date().toISOString(),
              version: (material.version ?? 0) + 1,
            });
          } catch {}
        }

        // NOTA: la imputación a partida (insumos_partida.cantidad_real_usada
        // + partidas.costo_real_acumulado) se ejecuta cuando el INGENIERO
        // vincula la salida desde su inbox, vía aplicarConsumoPartida()
        // en src/lib/partida-allocation.js. Almacén ya no se preocupa por
        // esto — Paquete C del plan.

        // Stock optimist (acumulado: base = proyección de las filas anteriores
        // del mismo material en este lote, no el array stale de React)
        const delta = tipo === 'ingreso' ? cantNum : -cantNum;
        const baseStock = stockOptimista.has(it.material_id)
          ? stockOptimista.get(it.material_id)
          : Number(material.stock_actual ?? 0);
        const nuevoStock = baseStock + delta;
        stockOptimista.set(it.material_id, nuevoStock);
        const minimo = Number(material.stock_minimo || 0);
        const nuevaAlerta = nuevoStock <= 0 ? 'agotado'
          : minimo > 0 && nuevoStock <= minimo * 0.5 ? 'critico'
          : minimo > 0 && nuevoStock <= minimo ? 'reponer'
          : minimo > 0 && nuevoStock <= minimo * 1.2 ? 'cerca'
          : 'ok';
        await window.__db.materiales.update(it.material_id, {
          stock_actual: nuevoStock,
          alerta: nuevaAlerta,
        });
        exitosos++;
      } catch (e) {
        fallidos++;
        errores.push(`${material?.nombre_material || it.material_id}: ${e?.message || e}`);
      }
    }
    refresh();

    // Si el lote estaba vinculado a una factura pendiente, marcarla como
    // recibida en el accounting_movement. Estado pasa a 'parcial' — la
    // almacenera lo cierra MANUALMENTE como 'recibido' con observación
    // cuando confirma que la entrega está completa (botón "Marcar entrega
    // completa" en el banner). Esto preserva el aviso para entregas
    // parciales (ej. factura por 2000 tubos en 3 tandas).
    // Además linkeamos cada mov del lote a la factura via accounting_movement_id
    // para poder mostrar progreso "800/2000 recibidos".
    if (tipo === 'ingreso' && facturaVinculadaId && exitosos > 0) {
      try {
        const factura = facturasPendientes.find(f => f.id === facturaVinculadaId);
        if (factura) {
          const userId = auth?.profile?.id || null;
          await window.__db.accounting_movements.update(facturaVinculadaId, {
            // 'parcial' = al menos 1 ingreso registrado, pero la almacenera
            // todavía no marcó "completa". El aviso queda visible.
            recepcion_status: 'parcial',
            recepcion_fecha: new Date().toISOString(),
            recepcion_por: userId,
            updated_at: new Date().toISOString(),
            updated_by: userId,
            version: (factura.version || 0) + 1,
            sync_status: factura.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
          });
          try { await window.__logAudit?.({
            action: 'update', table: 'accounting_movements', recordId: facturaVinculadaId,
            newData: { recepcion_status: 'parcial' },
            reason: `Recepción parcial registrada — ${exitosos} mov(s) ingreso · factura ${factura.document_number}`,
          }); } catch {}
          try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'accounting_movements' } })); } catch {}
        }
      } catch (e) {
        console.warn('[lote-ingreso] no se pudo marcar la factura como parcial:', e?.message);
      }
    }

    if (fallidos === 0) {
      showToast(`✓ Lote registrado: ${exitosos} ${tipo === 'ingreso' ? 'ingresos' : 'salidas'}`, 'green');
    } else if (exitosos === 0) {
      showToast(`✗ Falló el lote: ${errores[0] || 'sin detalles'}`, 'red');
    } else {
      showToast(`⚠ Lote parcial: ${exitosos} ok, ${fallidos} fallaron`, 'amber');
    }
    if (enTemporalManual > 0) {
      // Recordatorio: estos ingresos no dijeron a qué almacén llegaron.
      showToast(`📦 ${enTemporalManual} ingreso(s) quedaron en "${TEMPORAL_NOMBRE}" — designá su almacén real con un Traspaso`, 'amber');
      try {
        window.dispatchEvent(new CustomEvent('jarvex_new_notif', { detail: {
          tipo: 'almacen_temporal',
          titulo: `📦 ${enTemporalManual} ingreso(s) en "${TEMPORAL_NOMBRE}"`,
          descripcion: 'Hay materiales sin almacén designado. Usá Traspaso para moverlos a su almacén real.',
        } }));
      } catch {}
    }
    setModal(null);
    setForm({});
    setLoteItems([]);
    setFacturaVinculadaId(null);
    setFrenteSalida('');
    setFrentePendiente(false);
    } finally {
      // Liberamos SIEMPRE — aunque haya excepción en el loop, el usuario
      // debe poder reintentar sin recargar la app.
      setBusyMovLote(false);
    }
  };

  // Mapeo alerta → badge styling
  const ALERTA_STYLE = {
    ok:        { class: 'b-green',  label: 'OK' },
    cerca:     { class: 'b-yellow', label: 'Cerca mín' },
    reponer:   { class: 'b-yellow', label: 'Reponer' },
    critico:   { class: 'b-red',    label: 'Crítico' },
    sin_stock: { class: 'b-gray',   label: 'Sin stock' },
    agotado:   { class: 'b-red',    label: 'Agotado' },
  };

  // Crear requisición rápida desde alerta de stock — 1 click para almacenero
  const solicitarReposicion = (m) => {
    // Abre modal in-app para confirmar y permitir editar cantidad + motivo
    const cantidadSugerida = Math.max(0, Number(m.stock_minimo || 0) * 2 - Number(m.stock_actual || 0));
    const prioridad = m.alerta === 'agotado' || m.alerta === 'sin_stock' ? 'urgente'
                    : m.alerta === 'critico' ? 'alta' : 'media';
    setReposicionForm({
      mat: m,
      cantidad: cantidadSugerida.toFixed(2),
      motivo: m.alerta === 'agotado' || m.alerta === 'sin_stock'
        ? `Material AGOTADO. Necesario para continuar con obra. Stock actual: ${m.stock_actual} ${m.unidad}, mínimo: ${m.stock_minimo} ${m.unidad}.`
        : m.alerta === 'critico'
          ? `Stock CRÍTICO (≤50% del mínimo). Prevenir desabastecimiento. Stock: ${m.stock_actual}/${m.stock_minimo} ${m.unidad}.`
          : `Stock alcanzó el mínimo. Reposición preventiva. Stock: ${m.stock_actual}/${m.stock_minimo} ${m.unidad}.`,
      prioridad,
      busy: false,
    });
    setModal('reposicion');
  };

  const confirmarReposicion = async () => {
    if (!reposicionForm) return;
    const { mat: m, cantidad, motivo, prioridad } = reposicionForm;
    const cantNum = Number(cantidad);
    if (!Number.isFinite(cantNum) || cantNum <= 0) {
      showToast('La cantidad debe ser mayor a 0', 'red'); return;
    }
    if (!motivo?.trim() || motivo.trim().length < 10) {
      showToast('El motivo es obligatorio (mínimo 10 caracteres)', 'red'); return;
    }
    setReposicionForm(prev => ({ ...prev, busy: true }));
    try {
      const now = new Date().toISOString();
      const userIdLocal = auth?.profile?.id ?? 'offline';
      const reqId = window.__newId();
      const reqsObra = await window.__db.requisiciones.where('obra_id').equals(obraId).filter(r=>!r.deleted_at).toArray();
      const sigNum = (reqsObra.length || 0) + 1;
      const codigo = `REQ-${new Date().getFullYear()}-${String(sigNum).padStart(4, '0')}`;
      const descripcionLegible = `Reposición de stock · ${m.nombre_material} (${cantNum} ${m.unidad})`;
      await window.__db.requisiciones.add({
        id: reqId, obra_id: obraId,
        codigo, fecha: now.slice(0,10),
        descripcion: descripcionLegible,
        prioridad,
        estado: 'solicitada',
        solicitante_id: userIdLocal,
        notas: motivo.trim(),
        created_by: userIdLocal, updated_by: userIdLocal,
        created_at: now, updated_at: now,
        version: 1, sync_status: 'pending_create', last_synced_at: null,
        idempotency_key: `${userIdLocal}_requisiciones_${reqId}`,
      });
      const itemId = window.__newId();
      await window.__db.requisicion_items.add({
        id: itemId, requisicion_id: reqId,
        material_id: m.id,
        descripcion: m.nombre_material,
        unidad: m.unidad,
        cantidad: cantNum,
        precio_estimado: Number(m.precio_unitario_estimado || 0),
        notas: `Stock actual: ${m.stock_actual} ${m.unidad} / mínimo: ${m.stock_minimo} ${m.unidad}`,
        created_at: now, updated_at: now,
        sync_status: 'pending_create',
        idempotency_key: `${userIdLocal}_req_items_${itemId}`,
      });
      try { await window.__logAudit?.({ action:'insert', table:'requisiciones', recordId:reqId, newData:{ codigo, material: m.nombre_material, cantidad: cantNum }, reason: motivo.trim() }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'requisiciones' } })); } catch {}
      try { window.dispatchEvent(new CustomEvent('jarvex_new_notif', {
        detail: { tipo: 'requisicion', titulo: `Requisición ${codigo} creada (${prioridad})`, descripcion: descripcionLegible }
      })); } catch {}
      showToast(`✓ Requisición ${codigo} creada — ${descripcionLegible}`, 'green');
      setModal(null);
      setReposicionForm(null);
    } catch (e) {
      showToast('Error al crear requisición: ' + (e.message||e), 'red');
      setReposicionForm(prev => ({ ...prev, busy: false }));
    }
  };

  // ⚠️ Hooks SIEMPRE antes de cualquier early return (regla de React).
  // Calculamos matSeleccionado y partidasSugeridas aunque la página esté
  // cargando — son no-ops inofensivos en ese caso.
  const matSeleccionado = form.material_id && Array.isArray(materiales)
    ? materiales.find(m => m.id === form.material_id)
    : null;

  // Helper extraído: partidas sugeridas para CUALQUIER material (no solo
  // matSeleccionado). Usado tanto en el modal individual de "Nuevo movimiento"
  // como en cada fila del modal de "Salida (lote)" para que el almacenero
  // vea qué partida está consumiendo este material según el APU.
  const computarPartidasSugeridas = uCB((mat) => {
    if (!mat || !partidasObra.length || !insumosObra.length) return [];
    const palabras = String(mat.nombre_material || '')
      .toLowerCase()
      .split(/[^a-záéíóúñ0-9]+/)
      .filter(p => p.length >= 4);
    if (!palabras.length) return [];
    const matches = [];
    for (const p of partidasObra) {
      const insumosDeP = insumosObra.filter(i => i.partida_id === p.id && i.tipo_insumo === 'material');
      const insumoMatch = insumosDeP.find(i => {
        const nom = String(i.nombre_insumo || '').toLowerCase();
        return palabras.every(w => nom.includes(w));
      });
      if (insumoMatch) {
        const presup = Number(insumoMatch.cantidad_presupuestada || 0);
        const usado  = Number(insumoMatch.cantidad_real_usada || 0);
        const pct    = presup > 0 ? Math.min(100, (usado / presup) * 100) : 0;
        matches.push({ partida: p, insumo: insumoMatch, presup, usado, pct });
      }
    }
    return matches.sort((a, b) => b.pct - a.pct).slice(0, 8);
  }, [partidasObra, insumosObra]);

  const partidasSugeridas = uM(
    () => computarPartidasSugeridas(matSeleccionado),
    [matSeleccionado, computarPartidasSugeridas]
  );

  if (!obraId) return <SinObraEmpty icon="package"/>;
  if (loading) {
    return <div className="page-wrap"><div className="empty-state"><JxIcon name="package" size={32} color="var(--tm)"/><p>Cargando materiales…</p></div></div>;
  }

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Materiales</div>
          <div className="pg-sub">{materiales.length} materiales registrados · {alertasCount} alertas activas</div>
        </div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          {isAdmin && insumosObra.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={()=>setModal('syncOpts')}
              title="Cruza materiales con insumos del APU y aplica unidades y/o precios">
              <JxIcon name="refresh" size={13}/>Sincronizar desde APU
            </button>
          )}
          {isAdmin && (
            <button className="btn btn-ghost btn-sm" onClick={ejecutarCategorizacionIA}
              title="Usa Claude IA para categorizar materiales sin categoría asignada">
              <JxIcon name="settings" size={13}/>Categorizar con IA
            </button>
          )}
          {(isAdmin || canWriteMov) && (
            <button className="btn btn-ghost btn-sm" disabled={recalculandoStock} onClick={recalcularStocks}
              title="Recalcula el stock guardado sumando entradas − salidas de cada material (corrige desajustes por sincronización). No toca los movimientos, solo el número de stock.">
              <JxIcon name="refresh" size={13}/>{recalculandoStock ? 'Recalculando…' : 'Recalcular stocks'}
            </button>
          )}
          {canWriteMov && <button className="btn btn-ghost btn-sm" onClick={()=>openModal('salida')}><JxIcon name="arrowOut" size={13}/>Registrar Salida</button>}
          {canWriteMov && <button className="btn btn-ghost btn-sm" onClick={()=>openModal('ingreso')}><JxIcon name="arrowIn" size={13}/>Registrar Ingreso</button>}
          {canWriteMov && ubicacionesActivas.length >= 2 && <button className="btn btn-ghost btn-sm" onClick={()=>setTraspasoOpen(true)} title="Mover stock entre almacenes/ubicaciones"><JxIcon name="refresh" size={13}/>Traspaso</button>}
          {canWrite ? (
            <button className="btn btn-amber btn-sm" onClick={()=>{setForm({}); setModal('nuevo');}}><JxIcon name="plus" size={13}/>Nuevo Material</button>
          ) : (
            <span className="badge b-gray" title="Tu rol es solo lectura para Materiales">Solo lectura</span>
          )}
        </div>
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap', alignItems:'center' }}>
        <div className="search-bar" style={{ flex:'1 1 220px' }}><JxIcon name="search" size={14} color="var(--tm)"/><input placeholder="Buscar por nombre, código o categoría…" value={q} onChange={e=>setQ(e.target.value)}/></div>
        <select className="fi" value={filtroCategoria} onChange={e=>setFiltroCategoria(e.target.value)} style={{ minWidth:160 }}>
          <option value="todas">Todas las categorías</option>
          {categoriasDisponibles.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="fi" value={filtroEstado} onChange={e=>setFiltroEstado(e.target.value)} style={{ minWidth:140 }}>
          <option value="todos">Todos los estados</option>
          <option value="ok">✓ OK</option>
          <option value="reponer">⚠ Reponer</option>
          <option value="critico">🔴 Crítico</option>
          <option value="sin_stock">⚪ Sin stock</option>
          <option value="sin_unidad">⚠ Sin unidad detectada</option>
        </select>
        {(filtroCategoria !== 'todas' || filtroEstado !== 'todos' || q) && (
          <button className="btn btn-ghost btn-sm" onClick={()=>{ setQ(''); setFiltroCategoria('todas'); setFiltroEstado('todos'); }}>
            <JxIcon name="x" size={11}/> Limpiar
          </button>
        )}
        <span style={{ fontSize:11, color:'var(--tm)', marginLeft:4 }}>
          {filtered.length} de {materiales.length}
        </span>
      </div>

      {/* Sugerencias de agrupación + duplicados: DESPLEGABLE (antes eran N
          banners que invadían la pantalla — pedido de Gabriel). */}
      {isAdmin && (() => {
        const sugsVivas = sugerencias.filter(s => !descartadas.has(s.clave));
        const dupsVivos = dups.filter(d => !descartadas.has('dup-' + d.clave));
        if (!sugsVivas.length && !dupsVivos.length) return null;
        return (
          <div className="card card-p" style={{ marginBottom: 12, border: '1px solid rgba(245,158,11,0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setSugerenciasOpen(v => !v)} role="button">
              <span style={{ fontSize: 12.5, color: 'var(--ts)', flex: 1 }}>
                💡 <strong>{sugsVivas.length}</strong> sugerencia(s) de agrupación
                {dupsVivos.length > 0 && <> · ⚠ <strong style={{ color: 'var(--red)' }}>{dupsVivos.length}</strong> posible(s) duplicado(s)</>}
              </span>
              <button className="btn btn-ghost btn-xs">{sugerenciasOpen ? 'Ocultar ▴' : 'Ver ▾'}</button>
            </div>
          </div>
        );
      })()}
      {isAdmin && sugerenciasOpen && sugerencias.filter(s => !descartadas.has(s.clave)).map(s => (
        <div key={'sug-'+s.clave} className="card card-p" style={{ marginBottom:12, background:'rgba(245,158,11,0.07)', border:'1px solid rgba(245,158,11,0.3)', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <div style={{ flex:'1 1 320px', fontSize:12.5, color:'var(--ts)' }}>
            {s.tipo === 'add'
              ? <>💡 <strong>{s.items.length} material(es)</strong> suelto(s) parecen variantes de <strong>“{s.grupo.nombre_material}”</strong>. ¿Los agregás a ese grupo?</>
              : <>💡 <strong>{s.items.length} materiales</strong> empiezan con <strong>“{s.titulo}”</strong>. ¿Los agrupás como variantes?</>}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            {s.tipo === 'add'
              ? <button className="btn btn-amber btn-sm" onClick={()=>agregarAGrupoMat(s.grupo, s.items)}><JxIcon name="layers" size={13}/> Agregar a {s.grupo.nombre_material}</button>
              : <button className="btn btn-amber btn-sm" onClick={()=>setGrupoModal({ titulo:s.titulo, items:s.items })}><JxIcon name="layers" size={13}/> Agrupar</button>}
            <button className="btn btn-ghost btn-sm" onClick={()=>setDescartadas(d=>new Set(d).add(s.clave))}>Ahora no</button>
          </div>
        </div>
      ))}
      {/* Revisión de duplicados */}
      {isAdmin && sugerenciasOpen && dups.filter(d => !descartadas.has('dup-'+d.clave)).map(d => (
        <div key={'dup-'+d.clave} className="card card-p" style={{ marginBottom:12, background:'rgba(239,68,68,0.07)', border:'1px solid rgba(239,68,68,0.3)', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <div style={{ flex:'1 1 320px', fontSize:12.5, color:'var(--ts)' }}>⚠ <strong>{d.items.length} materiales</strong> con el mismo nombre <strong>“{d.nombre}”</strong> (probable duplicado). Conviene fusionarlos.</div>
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn btn-red btn-sm" onClick={()=>setDupModal({ grupo:d, survivorId:d.items[0].id })}><JxIcon name="compare" size={13}/> Fusionar</button>
            <button className="btn btn-ghost btn-sm" onClick={()=>setDescartadas(s=>new Set(s).add('dup-'+d.clave))}>Ahora no</button>
          </div>
        </div>
      ))}

      {materiales.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="package" size={40} color="var(--tm)"/>
          <p>No hay materiales registrados aún. Click en "Nuevo Material" para empezar.</p>
        </div>
      ) : (
      <div className="card" style={{ overflow:'hidden' }}>
        <div style={{ overflowX:'auto' }}>
          <table className="tbl">
            <thead><tr>
              <th>Material</th><th>Categoría</th><th>Ubicación</th><th>Unidad</th>
              {veDinero && <th style={{textAlign:'right'}}>Precio est.</th>}
              <th style={{textAlign:'right'}}>Stock Actual</th><th style={{textAlign:'right'}}>Stock Mín.</th>
              <th style={{textAlign:'right'}}>Entradas</th><th style={{textAlign:'right'}}>Salidas</th>
              <th>Estado</th><th>Sync</th><th style={{textAlign:'center'}}>Acciones</th>
            </tr></thead>
            <tbody>
              {matPg.pagedItems.map(m => {
                if (!m.es_grupo) return filaMat(m, false);
                const hijos = variantesDe(m);
                const hayFiltro = q || filtroCategoria !== 'todas' || filtroEstado !== 'todos';
                const hijosVis = hayFiltro ? hijos.filter(matchMat) : hijos;
                const abierto = expandedGroups.has(m.id);
                const aG = ALERTA_STYLE[alertaDeNodo(m)] || ALERTA_STYLE.ok;
                return (
                  <React.Fragment key={m.id}>
                    <tr style={{ background:'rgba(245,158,11,0.06)', cursor:'pointer' }} onClick={()=>toggleGroup(m.id)}>
                      <td className="col-p"><span style={{color:'var(--amber)',marginRight:6,fontWeight:700}}>{abierto?'▾':'▸'}</span><strong>{m.nombre_material}</strong> <span className="badge b-amber" style={{marginLeft:6}}>{hijos.length} variantes</span></td>
                      <td><span className="tag">{m.categoria || '—'}</span></td>
                      <td style={{ fontSize:11, color:'var(--tm)' }}>—</td>
                      <td className="col-m">{m.unidad}</td>
                      <td style={{textAlign:'right'}} className="col-num"><span style={{color:'var(--tm)'}}>—</span></td>
                      <td style={{textAlign:'right'}} className="col-num"><span style={{fontWeight:700}}>{stockDeNodo(m).toLocaleString('es-PE')}</span></td>
                      <td style={{textAlign:'right'}} className="col-num">{Number(m.stock_minimo ?? 0).toLocaleString('es-PE')}</td>
                      <td style={{textAlign:'right'}} className="col-num">—</td>
                      <td style={{textAlign:'right'}} className="col-num">—</td>
                      <td><span className={`badge ${aG.class}`}>{aG.label}</span></td>
                      <td>{m.sync_status && m.sync_status !== 'synced' ? <span className="badge b-amber">⏱</span> : <span style={{color:'var(--green)',fontSize:11}}>✓</span>}</td>
                      <td style={{textAlign:'center', whiteSpace:'nowrap'}}>
                        {isAdmin && <button className="btn btn-ghost btn-xs" title="Renombrar grupo" onClick={(ev)=>{ev.stopPropagation(); openEditMaterial(m);}}><JxIcon name="edit" size={11}/></button>}
                        {isAdmin && canDelete && <button className="btn btn-red btn-xs" title="Deshacer grupo" onClick={(ev)=>{ev.stopPropagation(); eliminarGrupoMat(m);}} style={{ marginLeft:4 }}><JxIcon name="trash" size={11}/></button>}
                      </td>
                    </tr>
                    {abierto && hijosVis.map(h => filaMat(h, true))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <TablePagination {...matPg} />
        <div style={{ padding:'8px 16px', fontSize:11, color:'var(--tm)' }}>
          {filtered.length} de {materiales.length} materiales (después de filtros)
        </div>
      </div>
      )}

      {/* Modal Ingreso (lote) — tabla de N materiales con datos comunes arriba */}
      {modal==='ingreso' && <Modal title="Registrar Ingreso de Materiales (lote)" icon="arrowIn" onClose={()=>setModal(null)} size="xl">
        {/* Banner facturas pendientes — la contadora cargó facturas en
            captura mágica y quedaron esperando recepción física. El
            almacenero las vincula con 1 click y se auto-rellena el lote. */}
        {facturasPendientes.length > 0 && (
          <div style={{
            marginBottom: 12,
            padding: '10px 12px',
            background: 'rgba(242,183,5,0.10)',
            border: '1px solid rgba(242,183,5,0.4)',
            borderRadius: 6,
          }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>🧾</span>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: '#F2B705' }}>
                  {facturasPendientes.length} factura(s) pendiente(s) de recepción
                </div>
                <div style={{ fontSize: 11, color: 'var(--tm)' }}>
                  Vinculá una para pre-rellenar los items. Si la entrega es parcial el aviso queda activo hasta que la cierres a mano.
                </div>
              </div>
              <select
                className="fi"
                value={facturaVinculadaId || ''}
                onChange={e => {
                  const id = e.target.value;
                  if (id) vincularFactura(id);
                  else setFacturaVinculadaId(null);
                }}
                style={{ minWidth: 240, maxWidth: 360, fontSize: 12 }}>
                <option value="">— Vincular factura —</option>
                {facturasPendientes.map(f => {
                  const prog = progresoPorFactura.get(f.id);
                  const sufijo = prog ? ` · ${prog.items} item(s) ingresados` : '';
                  const estadoTag = f.recepcion_status === 'parcial' ? ' [⏳ parcial]' : '';
                  return (
                    <option key={f.id} value={f.id}>
                      {f.document_number} · {f.third_party_name || '—'} · {f.date}{estadoTag}{sufijo}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Lista detallada de pendientes con progreso + botón "Marcar completa" */}
            <div style={{ marginTop:10, display:'flex', flexDirection:'column', gap:6 }}>
              {facturasPendientes.map(f => {
                const prog = progresoPorFactura.get(f.id) || { items: 0, qty: 0 };
                let itemsFactura = [];
                try {
                  const j = JSON.parse(f.notas || '{}');
                  itemsFactura = Array.isArray(j.items_factura) ? j.items_factura : [];
                } catch {}
                const totalItems = itemsFactura.length;
                const totalQty = itemsFactura.reduce((s, it) => s + Number(it.cantidad || 0), 0);
                const pctItems = totalItems > 0 ? Math.min(100, Math.round(prog.items / totalItems * 100)) : 0;
                const pctQty = totalQty > 0 ? Math.min(100, Math.round(prog.qty / totalQty * 100)) : 0;
                const pct = Math.max(pctItems, pctQty);
                return (
                  <div key={f.id} style={{ background:'rgba(0,0,0,0.18)', borderRadius:6, padding:'8px 10px', fontSize:11.5 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, marginBottom:6 }}>
                      <div>
                        <span style={{ fontWeight:700, color:'var(--tp)' }}>{f.document_number || 'sin nº'}</span>
                        <span style={{ color:'var(--tm)', marginLeft:6 }}>· {f.third_party_name || '—'}</span>
                        {f.recepcion_status === 'parcial' && (
                          <span className="b-amber" style={{ marginLeft:6, fontSize:10 }}>⏳ Parcial</span>
                        )}
                      </div>
                      <button
                        className="btn btn-amber btn-sm"
                        disabled={prog.items === 0}
                        onClick={()=>setCerrarRecepcionFactura(f)}
                        title={prog.items === 0 ? 'Registrá al menos 1 ingreso antes de cerrar' : 'Marcar la entrega como completa (con observación)'}>
                        <JxIcon name="check" size={11}/> Marcar completa
                      </button>
                    </div>
                    {totalItems > 0 && (
                      <>
                        <div style={{ display:'flex', justifyContent:'space-between', fontSize:10.5, color:'var(--tm)', marginBottom:3 }}>
                          <span>{prog.items} de {totalItems} items · {prog.qty.toLocaleString()} de {totalQty.toLocaleString()} cantidad</span>
                          <span style={{ color: pct >= 100 ? 'var(--green)' : 'var(--amber)' }}>{pct}%</span>
                        </div>
                        <div style={{ height:4, background:'rgba(255,255,255,0.06)', borderRadius:2, overflow:'hidden' }}>
                          <div style={{ width:`${pct}%`, height:'100%', background: pct >= 100 ? 'var(--green)' : 'var(--amber)', transition:'width 0.3s' }}/>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Banner "Sin factura aún" — solo aplica si no hay factura vinculada.
            La almacenera puede registrar el ingreso físico antes que llegue
            la factura. Queda en cola para que la contadora la suba después
            via Captura Mágica y la vincule a este ingreso. */}
        {!facturaVinculadaId && (
          <div style={{
            marginBottom: 12,
            padding: '10px 12px',
            background: loteComunes.sinFactura ? 'rgba(242,183,5,0.10)' : 'rgba(255,255,255,0.03)',
            border: loteComunes.sinFactura ? '1px solid rgba(242,183,5,0.4)' : '1px dashed rgba(255,255,255,0.15)',
            borderRadius: 6,
          }}>
            <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12.5, color:'var(--tp)', cursor:'pointer' }}>
              <input type="checkbox" checked={loteComunes.sinFactura}
                     onChange={e => setLoteComunes(c => ({ ...c, sinFactura: e.target.checked }))}/>
              <span><strong>📝 Sin factura aún</strong> — registrar ingreso físico ahora, contabilidad sube la factura después</span>
            </label>
            {loteComunes.sinFactura && (
              <div style={{ marginTop:8 }}>
                <div style={{ fontSize:11, color:'var(--tm)', marginBottom:6, lineHeight:1.5 }}>
                  Proveedor/guía son opcionales. La contadora verá este ingreso en su cola "Ingresos sin sustento" y lo vinculará a la factura cuando la suba.
                </div>
                <textarea
                  className="fi"
                  rows={2}
                  placeholder="Observación opcional (ej. proveedor entregó sin guía, marca XX, llegó solo parte del pedido…)"
                  value={loteComunes.observacionesAlmacen}
                  onChange={e => setLoteComunes(c => ({ ...c, observacionesAlmacen: e.target.value }))}
                  style={{ fontSize:12 }}/>
              </div>
            )}
          </div>
        )}

        <div className="g2">
          <div><label className="flabel">Fecha</label><input className="fi" type="date" max={new Date().toISOString().slice(0,10)} value={form.fecha||''} onChange={e=>setForm({...form, fecha:e.target.value})}/></div>
          <div><label className="flabel">Hora</label><input className="fi" type="time" value={form.hora||''} onChange={e=>setForm({...form, hora:e.target.value})}/></div>
          <div><label className="flabel">Documento / Guía (n°){loteComunes.sinFactura ? ' (opcional)' : ''}</label><input className="fi" placeholder={loteComunes.sinFactura ? 'Opcional — se puede llenar cuando llegue la factura' : 'N° guía o factura — se aplica a todos'} value={form.documento||''} onChange={e=>setForm({...form, documento:e.target.value})}/></div>
        </div>

        {/* Banner: proveedor común */}
        <div style={{ marginTop:12, padding:'10px 12px', background:'rgba(52,152,219,0.06)', border:'1px solid rgba(52,152,219,0.25)', borderRadius:6 }}>
          <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12.5, color:'var(--tp)', cursor:'pointer' }}>
            <input type="checkbox" checked={loteComunes.usarMismoProveedor}
                   onChange={e => setLoteComunes(c => ({ ...c, usarMismoProveedor: e.target.checked }))}/>
            <span><strong>Todos los materiales son del mismo proveedor</strong></span>
          </label>
          {loteComunes.usarMismoProveedor && (
            <div style={{ marginTop:8 }}>
              <SearchableSelect
                value={loteComunes.proveedor_id}
                onChange={v => setLoteComunes(c => ({ ...c, proveedor_id: v || null }))}
                options={[
                  { value: '', label: '— Selecciona proveedor —' },
                  ...provs.map(p => ({ value: p.id, label: p.razon_social })),
                ]}
                placeholder="— Selecciona proveedor —"/>
            </div>
          )}
          {!loteComunes.usarMismoProveedor && (
            <div style={{ fontSize:11, color:'var(--tm)', marginTop:4 }}>
              Cada fila tendrá su propio selector de proveedor.
            </div>
          )}
        </div>

        {/* Tabla de items */}
        <div style={{ marginTop:14 }}>
          <div style={{ fontSize:12, fontWeight:700, color:'var(--ts)', marginBottom:6, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span>Materiales a ingresar ({loteItems.length})</span>
            <button type="button" className="btn btn-ghost btn-xs" onClick={addLoteItem}>
              <JxIcon name="plus" size={11}/> Agregar fila
            </button>
          </div>
          <div style={{ overflowX:'auto' }}>
            <table className="tbl" style={{ fontSize:12 }}>
              <thead>
                <tr>
                  <th style={{ minWidth:240 }}>Material</th>
                  <th style={{ width:90 }}>Unidad</th>
                  <th style={{ width:110 }}>Cantidad *</th>
                  <th style={{ width:110 }}>Precio S/</th>
                  <th style={{ minWidth:160 }}>Ubicación</th>
                  {!loteComunes.usarMismoProveedor && <th style={{ minWidth:160 }}>Proveedor</th>}
                  <th style={{ width:40 }}></th>
                </tr>
              </thead>
              <tbody>
                {loteItems.map((it, idx) => {
                  const mat = materiales.find(m => m.id === it.material_id);
                  return (
                    <tr key={it.id}>
                      <td>
                        <SearchableSelect
                          value={it.material_id}
                          onChange={v => {
                            const newMat = materiales.find(m => m.id === v);
                            // Auto-origen: si el material está en un solo almacén, lo sugerimos.
                            const dg = desgloseUbic.get(v);
                            const conStock = dg ? Array.from(dg.entries()).filter(([, c]) => Number(c) > 0) : [];
                            const autoUbic = conStock.length === 1 ? conStock[0][0] : null;
                            updateLoteItem(it.id, {
                              material_id: v,
                              precio: newMat && !it.precio ? Number(newMat.precio_unitario_estimado || 0).toFixed(2) : it.precio,
                              ubicacion_id: it.ubicacion_id || autoUbic || newMat?.ubicacion_id || null,
                            });
                          }}
                          options={[
                            { value: '', label: '— Selecciona —' },
                            ...materiales.map(m => ({ value: m.id, label: m.nombre_material })),
                          ]}
                          fontSize={12}
                          placeholder="— Selecciona —"/>
                      </td>
                      <td style={{ color:'var(--tm)' }}>{mat?.unidad || '—'}</td>
                      <td><input className="fi" type="number" min="0" step="0.01" value={it.cantidad} style={{ fontSize:12 }}
                                 onChange={e => updateLoteItem(it.id, { cantidad: e.target.value })}/></td>
                      <td><input className="fi" type="number" step="0.01" placeholder="0.00" value={it.precio} style={{ fontSize:12 }}
                                 onChange={e => updateLoteItem(it.id, { precio: e.target.value })}/></td>
                      <td>
                        <SearchableSelect
                          value={it.ubicacion_id}
                          onChange={v => updateLoteItem(it.id, { ubicacion_id: v || null })}
                          options={[
                            { value: '', label: ubicacionesActivas.length ? '— Sin asignar —' : '— Sin ubicaciones definidas —' },
                            ...ubicacionesActivas.map(u => ({ value: u.id, label: u.nombre })),
                          ]}
                          fontSize={12}
                          placeholder="— Sin asignar —"/>
                      </td>
                      {!loteComunes.usarMismoProveedor && (
                        <td>
                          <SearchableSelect
                            value={it.proveedor_id}
                            onChange={v => updateLoteItem(it.id, { proveedor_id: v || null })}
                            options={[
                              { value: '', label: '—' },
                              ...provs.map(p => ({ value: p.id, label: p.razon_social })),
                            ]}
                            fontSize={12}
                            placeholder="—"/>
                        </td>
                      )}
                      <td>
                        {loteItems.length > 1 && (
                          <button type="button" className="btn btn-ghost btn-xs" title="Quitar fila"
                                  onClick={() => removeLoteItem(it.id)} style={{ color:'var(--red)' }}>
                            <JxIcon name="x" size={11}/>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ marginTop:14 }}>
          <label className="flabel">Observaciones (se aplica a todos)</label>
          <textarea className="fi" value={form.observaciones||''} onChange={e=>setForm({...form, observaciones:e.target.value})} placeholder="Notas adicionales del lote completo…"/>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" disabled={busyMovLote} onClick={()=>setModal(null)}>Cancelar</button>
          <button className="btn btn-amber" disabled={busyMovLote} onClick={()=>handleSubmitMovLote('ingreso')}>
            <JxIcon name="check" size={13}/>{busyMovLote ? 'Registrando…' : `Registrar Lote (${loteItems.filter(it => it.material_id && parseFloat(it.cantidad) > 0).length})`}
          </button>
        </div>
      </Modal>}

      {/* Modal Traspaso entre ubicaciones */}
      {traspasoOpen && (
        <TraspasoModal
          materiales={(materiales || []).filter(m => !m.deleted_at)}
          ubicaciones={ubicacionesActivas}
          ubicacionesById={ubicacionesById}
          getDesgloseDe={(mid) => desgloseUbic.get(mid)}
          onClose={()=>setTraspasoOpen(false)}
          onConfirm={async (payload) => { const ok = await ejecutarTraspaso(payload); if (ok) setTraspasoOpen(false); }}/>
      )}

      {/* Popup desglose por ubicación (material) */}
      {popupMat && (
        <DesglosePopup
          nombre={popupMat.nombre_material} unidad={popupMat.unidad}
          desglose={desgloseUbic.get(popupMat.id)} ubicacionesById={ubicacionesById}
          canTraspaso={canWriteMov && ubicacionesActivas.length >= 2}
          onTraspaso={()=>setTraspasoOpen(true)}
          onClose={()=>setPopupMat(null)}/>
      )}

      {/* Modal cerrar recepción manual — Paquete B */}
      {cerrarRecepcionFactura && (
        <CerrarRecepcionModal
          factura={cerrarRecepcionFactura}
          progreso={progresoPorFactura.get(cerrarRecepcionFactura.id)}
          onClose={()=>setCerrarRecepcionFactura(null)}
          onConfirm={(obs)=>cerrarRecepcion(cerrarRecepcionFactura, obs)}/>
      )}

      {/* Modal Salida (lote) — tabla de N materiales con persona común */}
      {modal==='salida' && (() => {
        const personalActivo = personal.filter(p => {
          if (p.estado !== 'activo') return false;
          const hoy = new Date().toISOString().slice(0, 10);
          if (p.fecha_ingreso && String(p.fecha_ingreso) > hoy) return false;
          if (p.obra_id && obraId && p.obra_id !== obraId) return false;
          return true;
        });
        // Destinos = personal activo + subcontratos (value 'sub:<id>'). Permite
        // atribuir la salida a una persona o a un subcontrato, sin texto libre.
        const destinoOpts = opcionesDestinoFlat(personalActivo, subcontratistas);
        return (
        <Modal title="Registrar Salida de Materiales (lote)" icon="arrowOut" onClose={()=>setModal(null)} size="xl">
          <div className="g2">
            <div><label className="flabel">Fecha</label><input className="fi" type="date" max={new Date().toISOString().slice(0,10)} value={form.fecha||''} onChange={e=>setForm({...form, fecha:e.target.value})}/></div>
            <div><label className="flabel">Hora</label><input className="fi" type="time" value={form.hora||''} onChange={e=>setForm({...form, hora:e.target.value})}/></div>
            <div><label className="flabel">Documento / Vale (n°)</label><input className="fi" placeholder="N° vale de salida" value={form.documento||''} onChange={e=>setForm({...form, documento:e.target.value})}/></div>
          </div>

          {/* Banner: persona/responsable común */}
          <div style={{ marginTop:12, padding:'10px 12px', background:'rgba(242,140,40,0.08)', border:'1px solid rgba(242,140,40,0.3)', borderRadius:6 }}>
            <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12.5, color:'var(--tp)', cursor:'pointer' }}>
              <input type="checkbox" checked={loteComunes.usarMismaPersona}
                     onChange={e => setLoteComunes(c => ({ ...c, usarMismaPersona: e.target.checked }))}/>
              <span><strong>Todos los materiales los retira la misma persona</strong></span>
            </label>
            {loteComunes.usarMismaPersona && (
              <div style={{ marginTop:8 }}>
                <SearchableSelect
                  value={loteComunes.responsable_id}
                  onChange={v => setLoteComunes(c => ({ ...c, responsable_id: v || null }))}
                  options={[
                    { value: '', label: '— Selecciona persona / subcontrato —' },
                    ...destinoOpts,
                  ]}
                  placeholder="— Selecciona persona / subcontrato —"/>
                <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:4 }}>
                  Trabajadores activos de la obra o un subcontrato. Sin nombres a mano.
                </div>
              </div>
            )}
            {!loteComunes.usarMismaPersona && (
              <div style={{ fontSize:11, color:'var(--tm)', marginTop:4 }}>
                Cada fila tendrá su propio selector de responsable.
              </div>
            )}
          </div>

          {/* Tabla de items */}
          <div style={{ marginTop:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--ts)', marginBottom:6, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span>Materiales a sacar ({loteItems.length})</span>
              <button type="button" className="btn btn-ghost btn-xs" onClick={addLoteItem}>
                <JxIcon name="plus" size={11}/> Agregar fila
              </button>
            </div>
            <div style={{ overflowX:'auto' }}>
              <table className="tbl" style={{ fontSize:12 }}>
                <thead>
                  <tr>
                    <th style={{ minWidth:240 }}>Material</th>
                    <th style={{ width:80 }}>Unidad</th>
                    <th style={{ width:100 }}>Cantidad *</th>
                    <th style={{ width:90 }}>Stock</th>
                    <th style={{ minWidth:160 }}>Almacén de origen</th>
                    {/* Columna "Partida" removida — el ingeniero la asigna después desde su inbox (Paquete C) */}
                    {!loteComunes.usarMismaPersona && <th style={{ minWidth:160 }}>Quien retira</th>}
                    <th style={{ width:40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {loteItems.map((it) => {
                    const mat = materiales.find(m => m.id === it.material_id);
                    const cantSolicitada = parseFloat(it.cantidad) || 0;
                    const stock = Number(mat?.stock_actual ?? 0);
                    const stockOk = stock >= cantSolicitada;
                    return (
                      <tr key={it.id}>
                        <td>
                          <SearchableSelect
                            value={it.material_id}
                            onChange={v => {
                              // Auto-origen: si el material está en un solo almacén
                              // con stock, lo fijamos; si está repartido (≥2) o sin
                              // desglose, queda null (la columna pedirá elegir o usará stock general).
                              const dg = desgloseUbic.get(v);
                              const conStock = dg ? Array.from(dg.entries()).filter(([, c]) => Number(c) > 0) : [];
                              updateLoteItem(it.id, { material_id: v, ubicacion_id: conStock.length === 1 ? conStock[0][0] : null });
                            }}
                            options={[
                              { value: '', label: '— Selecciona —' },
                              ...materiales.map(m => ({ value: m.id, label: m.nombre_material })),
                            ]}
                            fontSize={12}
                            placeholder="— Selecciona —"/>
                        </td>
                        <td style={{ color:'var(--tm)' }}>{mat?.unidad || '—'}</td>
                        <td><input className="fi" type="number" min="0" step="0.01" value={it.cantidad} style={{ fontSize:12 }}
                                   onChange={e => updateLoteItem(it.id, { cantidad: e.target.value })}/></td>
                        <td>
                          {mat ? (
                            <span style={{ color: stockOk ? 'var(--green)' : 'var(--red)', fontWeight: 600, fontSize: 11 }}>
                              {stockOk ? '✓' : '⚠'} {stock}
                            </span>
                          ) : <span style={{ color:'var(--tm)' }}>—</span>}
                        </td>
                        {/* Almacén de origen: auto si está en 1 solo, selector si repartido */}
                        <td>
                          {(() => {
                            if (!mat) return <span style={{ color:'var(--tm)' }}>—</span>;
                            const dg = desgloseUbic.get(it.material_id);
                            const conStock = dg ? Array.from(dg.entries()).filter(([, c]) => Number(c) > 0) : [];
                            if (conStock.length === 0)
                              return <span style={{ fontSize:11, color:'var(--tm)' }} title="Sin desglose por almacén — sale del stock general">Stock general</span>;
                            if (conStock.length === 1) {
                              const [uid, c] = conStock[0];
                              return <span style={{ fontSize:11, color:'var(--ts)' }} title="Único almacén con stock (automático)">📍 {ubicacionesById.get(uid)?.nombre || '—'} <span style={{ color:'var(--tm)' }}>({Number(c).toLocaleString('es-PE')})</span></span>;
                            }
                            return (
                              <SearchableSelect
                                value={it.ubicacion_id || ''}
                                onChange={v => updateLoteItem(it.id, { ubicacion_id: v || null })}
                                options={[
                                  { value: '', label: '— Elegí almacén —' },
                                  ...conStock.map(([uid, c]) => ({ value: uid, label: `${ubicacionesById.get(uid)?.nombre || '—'} · ${Number(c).toLocaleString('es-PE')} disp.` })),
                                ]}
                                fontSize={12}
                                placeholder="— Elegí almacén —"/>
                            );
                          })()}
                        </td>
                        {/* Columna "Partida" removida — el ingeniero la asigna después */}
                        {!loteComunes.usarMismaPersona && (
                          <td>
                            <SearchableSelect
                              value={it.responsable_id}
                              onChange={v => updateLoteItem(it.id, { responsable_id: v || null })}
                              options={[
                                { value: '', label: '—' },
                                ...destinoOpts,
                              ]}
                              fontSize={12}
                              placeholder="—"/>
                          </td>
                        )}
                        <td>
                          {loteItems.length > 1 && (
                            <button type="button" className="btn btn-ghost btn-xs" title="Quitar fila"
                                    onClick={() => removeLoteItem(it.id)} style={{ color:'var(--red)' }}>
                              <JxIcon name="x" size={11}/>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Frente de trabajo (OBLIGATORIO) — común a todo el lote de salida. Va
              después de la columna "Almacén de origen" de la tabla. Si no se sabe
              el frente todavía, se puede diferir marcando el checkbox. */}
          <div style={{ marginTop:14 }}>
            <label className="flabel">Frente de trabajo *</label>
            <select className="fi" value={frenteSalida} disabled={frentePendiente} onChange={e => setFrenteSalida(e.target.value)}>
              <option value="">— Sin frente —</option>
              {(frentes || []).map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
            </select>
            <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:11.5, marginTop:4, color:'var(--tm)' }}>
              <input type="checkbox" checked={frentePendiente} onChange={e => { setFrentePendiente(e.target.checked); if (e.target.checked) setFrenteSalida(''); }} />
              No sé el frente todavía — lo completo después (queda marcado como pendiente)
            </label>
          </div>

          <div style={{ marginTop:14 }}>
            <label className="flabel">Observaciones (se aplica a todos)</label>
            <textarea className="fi" value={form.observaciones||''} onChange={e=>setForm({...form, observaciones:e.target.value})} placeholder="Notas adicionales del lote…"/>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" disabled={busyMovLote} onClick={()=>setModal(null)}>Cancelar</button>
            <button className="btn btn-amber" disabled={busyMovLote} onClick={()=>handleSubmitMovLote('salida')}>
              <JxIcon name="check" size={13}/>{busyMovLote ? 'Registrando…' : `Registrar Salida (${loteItems.filter(it => it.material_id && parseFloat(it.cantidad) > 0).length})`}
            </button>
          </div>
        </Modal>);
      })()}

      {/* Modal: opciones de sincronización (paso previo) */}
      {modal === 'syncOpts' && (
        <Modal title="Sincronizar desde APU — opciones" icon="refresh" onClose={()=>setModal(null)}>
          <div style={{ fontSize:12.5, color:'var(--ts)', marginBottom:14 }}>
            Elige qué quieres sincronizar contra los insumos del APU (matching por código).
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {[
              { v:'unidades', label:'Solo unidades', desc:'Aplica unidad del APU si el material tiene "und" o vacío.' },
              { v:'precios',  label:'Solo precios',  desc:'Aplica precio_unitario_estimado del APU al material.' },
              { v:'ambos',    label:'Unidades + precios', desc:'Lo más completo. Recomendado tras importar APU nuevo.' },
            ].map(opt => (
              <label key={opt.v}
                style={{ display:'flex', gap:10, alignItems:'flex-start', padding:10, cursor:'pointer',
                  border:`1.5px solid ${syncMode===opt.v?'var(--amber)':'var(--border)'}`, borderRadius:8,
                  background: syncMode===opt.v?'rgba(242,183,5,0.06)':'transparent' }}>
                <input type="radio" checked={syncMode===opt.v} onChange={()=>setSyncMode(opt.v)}/>
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:'var(--tp)' }}>{opt.label}</div>
                  <div style={{ fontSize:11.5, color:'var(--tm)', marginTop:2 }}>{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>setModal(null)}>Cancelar</button>
            <button className="btn btn-amber" onClick={escanearSyncDesdeAPU}>
              <JxIcon name="refresh" size={13}/> Escanear y mostrar preview
            </button>
          </div>
        </Modal>
      )}

      {/* Modal: Actualizar precio */}
      {precioTarget && (
        <Modal title={`Actualizar precio — ${precioTarget.nombre_material}`} icon="dollar" onClose={()=>setPrecioTarget(null)}>
          <div style={{ background:'rgba(52,152,219,0.06)', border:'1px solid rgba(52,152,219,0.25)', borderRadius:8, padding:'10px 12px', marginBottom:14, fontSize:12, color:'var(--ts)' }}>
            <strong style={{ color:'var(--blue)' }}>Precio actual:</strong> S/ {Number(precioTarget.precio_unitario_estimado || 0).toFixed(2)} por {precioTarget.unidad || 'und'}
          </div>
          <div className="g2">
            <div>
              <label className="flabel">Nuevo precio unitario (S/) *</label>
              <input className="fi" type="number" min="0" step="0.0001" value={precioForm.precio_nuevo}
                onChange={e=>setPrecioForm({...precioForm, precio_nuevo:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Fuente</label>
              <select className="fi" value={precioForm.motivo} onChange={e=>setPrecioForm({...precioForm, motivo:e.target.value})}>
                <option value="manual">Cotización / cambio manual</option>
                <option value="movimiento">Detectado en compra real</option>
                <option value="apu">Sincronizado del APU</option>
                <option value="importacion">Importación / carga inicial</option>
              </select>
            </div>
            <div style={{ gridColumn:'1 / -1' }}>
              <label className="flabel">Documento de referencia (opcional)</label>
              <input className="fi" placeholder="N° factura, guía o cotización" value={precioForm.documento_ref}
                onChange={e=>setPrecioForm({...precioForm, documento_ref:e.target.value})}/>
            </div>
            <div style={{ gridColumn:'1 / -1' }}>
              <label className="flabel">Motivo / notas</label>
              <textarea className="fi" rows={2} value={precioForm.notas}
                placeholder="Por qué cambias el precio (ej: nueva cotización del proveedor X, fluctuación del mercado, etc.)"
                onChange={e=>setPrecioForm({...precioForm, notas:e.target.value})}/>
            </div>
          </div>
          <div style={{ marginTop:10, fontSize:11, color:'var(--tm)' }}>
            ✓ El cambio queda registrado en el historial. El precio anterior <strong>NO se borra</strong> — queda como referencia.
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>setPrecioTarget(null)}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardarNuevoPrecio}>
              <JxIcon name="check" size={13}/> Guardar nuevo precio
            </button>
          </div>
        </Modal>
      )}

      {/* Modal: Historial de precios */}
      {historialTarget && (
        <Modal title={`Historial de precios — ${historialTarget.nombre_material}`} icon="dollar"
          onClose={()=>{ setHistorialTarget(null); setHistorialData([]); }} wide>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:14 }}>
            <div className="card card-p" style={{ textAlign:'center' }}>
              <div style={{ fontSize:11, color:'var(--tm)' }}>Precio actual</div>
              <div style={{ fontSize:18, fontWeight:800, color:'var(--blue)' }}>
                S/ {Number(historialTarget.precio_unitario_estimado || 0).toFixed(2)}
              </div>
            </div>
            <div className="card card-p" style={{ textAlign:'center' }}>
              <div style={{ fontSize:11, color:'var(--tm)' }}>Cambios registrados</div>
              <div style={{ fontSize:18, fontWeight:800, color:'var(--amber)' }}>
                {historialData.length}
              </div>
            </div>
            <div className="card card-p" style={{ textAlign:'center' }}>
              <div style={{ fontSize:11, color:'var(--tm)' }}>Variación total</div>
              <div style={{ fontSize:18, fontWeight:800, color:'var(--green)' }}>
                {(() => {
                  if (historialData.length === 0) return '—';
                  const primero = historialData[historialData.length - 1];
                  const ultimoPrecio = Number(historialTarget.precio_unitario_estimado || 0);
                  const primerPrecio = Number(primero.precio_anterior || 0);
                  if (primerPrecio === 0) return '—';
                  const pct = ((ultimoPrecio - primerPrecio) / primerPrecio * 100);
                  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
                })()}
              </div>
            </div>
          </div>

          {historialData.length === 0 ? (
            <div className="card card-p empty-state">
              <JxIcon name="dollar" size={32} color="var(--tm)"/>
              <p>Sin historial de cambios. El primer cambio que hagas quedará registrado aquí.</p>
            </div>
          ) : (
            <div className="card" style={{ overflow:'auto', maxHeight:400 }}>
              <table className="tbl" style={{ fontSize:11 }}>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th style={{ textAlign:'right' }}>Anterior</th>
                    <th style={{ textAlign:'right' }}>Nuevo</th>
                    <th style={{ textAlign:'right' }}>Δ</th>
                    <th>Fuente</th>
                    <th>Documento</th>
                    <th>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {historialData.map(h => {
                    const ant = Number(h.precio_anterior || 0);
                    const nuevo = Number(h.precio_nuevo || 0);
                    const delta = nuevo - ant;
                    const pct = ant > 0 ? (delta/ant*100) : 0;
                    return (
                      <tr key={h.id}>
                        <td className="col-m">{h.fecha}</td>
                        <td style={{ textAlign:'right' }} className="col-num">S/ {ant.toFixed(2)}</td>
                        <td style={{ textAlign:'right', fontWeight:600 }} className="col-num">S/ {nuevo.toFixed(2)}</td>
                        <td style={{ textAlign:'right', color: delta>0?'var(--red)':'var(--green)' }} className="col-num">
                          {delta>0?'+':''}S/ {delta.toFixed(2)}<br/>
                          <span style={{ fontSize:9 }}>{pct>0?'+':''}{pct.toFixed(1)}%</span>
                        </td>
                        <td className="col-m"><span className="tag">{h.fuente || 'manual'}</span></td>
                        <td className="col-m" style={{ fontSize:10 }}>{h.documento_ref || '—'}</td>
                        <td style={{ fontSize:10.5, maxWidth:240 }}>{h.motivo || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}

      {/* Modal IA: corriendo */}
      {iaModal === 'running' && (
        <Modal title="Categorizando con IA…" icon="settings" onClose={()=>{}}>
          <div style={{ textAlign:'center', padding:'18px 8px' }}>
            <div style={{ display:'inline-block', width:24, height:24, borderRadius:'50%', border:'3px solid rgba(242,183,5,0.3)', borderTopColor:'var(--amber)', animation:'spin .8s linear infinite' }}/>
            <div style={{ fontSize:13, color:'var(--ts)', marginTop:14, marginBottom:6 }}>
              Claude está analizando los nombres y asignando categoría.
            </div>
            <div style={{ fontSize:11.5, color:'var(--tm)', marginBottom:10 }}>
              {iaProgress.current} / {iaProgress.total} materiales procesados
            </div>
            <div style={{ width:'100%', height:8, background:'var(--bg-c)', borderRadius:4, overflow:'hidden' }}>
              <div style={{ width:`${iaProgress.total ? (iaProgress.current/iaProgress.total*100) : 0}%`, height:'100%', background:'var(--amber)', transition:'width .2s' }}/>
            </div>
            <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:10 }}>
              No cierres esta ventana. Procesa en lotes de 50.
            </div>
          </div>
        </Modal>
      )}

      {/* Modal IA: preview de resultados */}
      {iaModal === 'preview' && iaResults.length > 0 && (
        <Modal title="Categorización IA — preview" icon="settings" onClose={()=>{ setIaModal(null); setIaResults([]); }} wide>
          <div style={{ fontSize:12.5, color:'var(--ts)', marginBottom:12 }}>
            Claude propone <strong>{iaResults.length} categorías</strong>. Revisa antes de aplicar.
          </div>
          <div className="card" style={{ overflow:'auto', maxHeight:400, marginBottom:12 }}>
            <table className="tbl" style={{ fontSize:11 }}>
              <thead><tr><th>Material</th><th>Actual</th><th>Sugerida</th></tr></thead>
              <tbody>
                {iaResults.slice(0, 200).map(c => (
                  <tr key={c.id}>
                    <td className="col-p">{c.nombre}</td>
                    <td className="col-m"><span className="tag">{c.actual}</span></td>
                    <td className="col-m"><span className="badge b-amber">{c.nuevo}</span></td>
                  </tr>
                ))}
                {iaResults.length > 200 && (
                  <tr><td colSpan={3} style={{ padding:10, textAlign:'center', color:'var(--tm)' }}>… {iaResults.length - 200} más</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>{ setIaModal(null); setIaResults([]); }}>Cancelar</button>
            <button className="btn btn-amber" onClick={aplicarCategorizacionIA}>
              <JxIcon name="check" size={13}/> Aplicar {iaResults.length} categorías
            </button>
          </div>
        </Modal>
      )}

      {/* Modal Sincronizar desde APU */}
      {modal === 'sync' && syncPreview && (
        <Modal title="Sincronizar materiales desde APU" icon="refresh" onClose={()=>{ setModal(null); setSyncPreview(null); }} wide>
          <div style={{ fontSize:12.5, color:'var(--ts)', marginBottom:14 }}>
            Cruza tus <strong>{syncPreview.total} materiales</strong> contra los <strong>insumos del APU</strong> de esta obra (matching por código).
            Aplica unidades del APU cuando el material tiene <code>und</code> o vacío, y sugiere categoría según la unidad.
          </div>

          {syncPreview.apuVacio && (
            <div style={{ background:'rgba(231,76,60,0.10)', border:'1px solid rgba(231,76,60,0.35)', borderRadius:8, padding:'10px 12px', marginBottom:12, fontSize:12, color:'var(--red)' }}>
              ⚠ Esta obra no tiene insumos importados desde APU. Importa primero el APU desde Delphin.
            </div>
          )}

          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:14 }}>
            <div className="card card-p" style={{ textAlign:'center' }}>
              <div style={{ fontSize:18, fontWeight:800, color:'var(--green)' }}>{syncPreview.conMatch}</div>
              <div style={{ fontSize:10.5, color:'var(--tm)' }}>match total</div>
              <div style={{ fontSize:9, color:'var(--tm)', marginTop:2 }}>
                {syncPreview.matchPorCodigo || 0} código · {syncPreview.matchPorNombre || 0} nombre
              </div>
            </div>
            <div className="card card-p" style={{ textAlign:'center' }}>
              <div style={{ fontSize:18, fontWeight:800, color:'var(--amber)' }}>{syncPreview.cambios.length}</div>
              <div style={{ fontSize:10.5, color:'var(--tm)' }}>se actualizarán</div>
            </div>
            <div className="card card-p" style={{ textAlign:'center' }}>
              <div style={{ fontSize:18, fontWeight:800, color:'var(--tm)' }}>{syncPreview.sinMatch}</div>
              <div style={{ fontSize:10.5, color:'var(--tm)' }}>sin match</div>
            </div>
            <div className="card card-p" style={{ textAlign:'center' }}>
              <div style={{ fontSize:18, fontWeight:800, color:'var(--tm)' }}>{syncPreview.sinCodigo}</div>
              <div style={{ fontSize:10.5, color:'var(--tm)' }}>sin código_s10</div>
            </div>
          </div>

          {syncPreview.cambios.length > 0 ? (
            <div className="card" style={{ overflow:'auto', maxHeight:340, marginBottom:12 }}>
              <table className="tbl" style={{ fontSize:11 }}>
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Código</th>
                    <th>Cambio</th>
                  </tr>
                </thead>
                <tbody>
                  {syncPreview.cambios.slice(0, 100).map(c => (
                    <tr key={c.id}>
                      <td className="col-p">{c.nombre}</td>
                      <td className="col-m" style={{ fontFamily:'monospace' }}>{c.codigo}</td>
                      <td className="col-m" style={{ fontSize:10.5 }}>
                        {c.nuevo.unidad && <span>unidad: <s style={{ color:'var(--tm)' }}>{c.actual.unidad || '—'}</s> → <strong style={{ color:'var(--green)' }}>{c.nuevo.unidad}</strong></span>}
                        {c.nuevo.unidad && c.nuevo.precio_unitario_estimado != null && <span> · </span>}
                        {c.nuevo.precio_unitario_estimado != null && <span>precio: <s style={{ color:'var(--tm)' }}>S/ {c.actual.precio?.toFixed(2) || '0.00'}</s> → <strong style={{ color:'var(--blue)' }}>S/ {c.nuevo.precio_unitario_estimado.toFixed(2)}</strong></span>}
                      </td>
                    </tr>
                  ))}
                  {syncPreview.cambios.length > 100 && (
                    <tr><td colSpan={3} style={{ padding:10, textAlign:'center', color:'var(--tm)' }}>… {syncPreview.cambios.length - 100} más</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ background:'rgba(46,204,113,0.08)', border:'1px solid rgba(46,204,113,0.3)', borderRadius:8, padding:'10px 12px', marginBottom:12, fontSize:12, color:'var(--green)' }}>
              Todo está al día — no hay cambios que aplicar.
            </div>
          )}

          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>{ setModal(null); setSyncPreview(null); }}>Cerrar</button>
            {syncPreview.cambios.length > 0 && (
              <button className="btn btn-amber" onClick={aplicarSyncDesdeAPU}>
                <JxIcon name="check" size={13}/> Aplicar {syncPreview.cambios.length} cambios
              </button>
            )}
          </div>
        </Modal>
      )}

      {/* Modal Nuevo / Editar Material */}
      {(modal==='nuevo' || modal==='editar') && (() => {
        const cat = window.__catalogos || {};
        const matsBase = cat.getMaterialesBase ? cat.getMaterialesBase() : [];
        const unidadesAll = cat.getAllUnidades ? cat.getAllUnidades() : [];
        const categoriasAll = cat.getAllCategorias ? cat.getAllCategorias() : categoriasDisponibles;
        // Sugerencias filtradas por nombre (datalist style)
        const sugerencias = (form.nombre_material || '').length >= 2
          ? matsBase.filter(m => m.nombre.toLowerCase().includes(form.nombre_material.toLowerCase())).slice(0, 8)
          : [];
        return (
        <Modal title={editingId ? 'Editar Material' : 'Nuevo Material'} icon="package" onClose={closeModalMaterial}>
        {/* Banner detector EPP — aparece cuando el nombre matchea palabras clave
            de EPP. Si el material todavía no se guardó (creación), sugiere
            cancelar y crearlo directamente como EPP en SSOMA → EPPs. Si ya
            existe (edición), ofrece "Mover a EPPs" — clona el registro a la
            tabla `epps` y soft-deletea el material. */}
        {(() => {
          const tipoEpp = detectarEPP(form.nombre_material);
          if (!tipoEpp || form.categoria === 'EPP') return null;
          const moverAEpps = async () => {
            if (!editingId) {
              showToast('Guardá primero el material; después se puede migrar', 'amber');
              return;
            }
            const mat = materiales.find(m => m.id === editingId);
            if (!mat) { showToast('Material no encontrado', 'red'); return; }
            const nuevoEppId = await moverMaterialAEpps(mat);
            if (nuevoEppId) closeModalMaterial();
          };
          return (
            <div style={{ marginBottom: 10, padding: '10px 12px', background: 'rgba(242,183,5,0.08)', border: '1px solid rgba(242,183,5,0.4)', borderRadius: 6, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>🦺</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: '#F2B705', marginBottom: 2 }}>
                  Esto parece un EPP ({tipoEpp})
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ts)', lineHeight: 1.4 }}>
                  Los EPPs tienen control de vida útil y se entregan con firma del trabajador (SUNAFIL).
                  {editingId
                    ? ' Click "Mover a EPPs" para migrar este registro al inventario separado de EPPs.'
                    : ' Recomendado: cancelá y creá el registro directamente en SSOMA → EPPs (Inventario).'}
                </div>
                <div style={{ display:'flex', gap:6, marginTop:6, flexWrap:'wrap' }}>
                  {editingId && (
                    <button type="button" className="btn btn-amber btn-xs" onClick={moverAEpps}>
                      <JxIcon name="arrowOut" size={11}/> Mover a EPPs
                    </button>
                  )}
                  <button type="button" className="btn btn-ghost btn-xs"
                    onClick={() => setForm({ ...form, categoria: 'EPP' })}>
                    Solo marcar categoría como "EPP"
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
        <div className="g2">
          <div style={{gridColumn:'1/-1', position:'relative'}}>
            <label className="flabel">Nombre del material *</label>
            <input className="fi" placeholder="Ej: Cemento Sol Tipo I (autocompletar desde catálogo)"
              value={form.nombre_material||''}
              onChange={e=>setForm({...form, nombre_material:e.target.value})}
              list="material-sugerencias-jx"/>
            <datalist id="material-sugerencias-jx">
              {matsBase.map((m, i) => <option key={i} value={m.nombre}/>)}
            </datalist>
            {sugerencias.length > 0 && !editingId && (
              <div style={{ marginTop:6, padding:8, background:'rgba(52,152,219,0.06)', border:'1px solid rgba(52,152,219,0.25)', borderRadius:6, maxHeight:140, overflow:'auto' }}>
                <div style={{ fontSize:10.5, color:'var(--tm)', marginBottom:4 }}>Click para autocompletar:</div>
                {sugerencias.map((s, i) => (
                  <button key={i} type="button" className="btn btn-ghost btn-xs" style={{ width:'100%', textAlign:'left', justifyContent:'flex-start', marginBottom:2 }}
                    onClick={()=>setForm({...form, nombre_material: s.nombre, unidad: s.unidad, categoria: s.categoria, precio: s.precio })}>
                    {s.nombre} <span style={{ color:'var(--tm)', marginLeft:6 }}>· {s.unidad} · S/ {Number(s.precio).toFixed(2)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div><label className="flabel">Categoría</label>
            <select className="fi" value={form.categoria||''} onChange={e=>setForm({...form, categoria: e.target.value})}>
              <option value="">— Selecciona —</option>
              {categoriasAll.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div><label className="flabel">Unidad *</label>
            <select className="fi" value={form.unidad||''} onChange={e=>setForm({...form, unidad:e.target.value})}>
              <option value="">— Selecciona —</option>
              {unidadesAll.map(u => <option key={u.codigo} value={u.codigo}>{u.codigo} — {u.nombre}</option>)}
            </select>
          </div>
          {!form.es_grupo && (
            <div><label className="flabel">Grupo (variante de)</label>
              <select className="fi" value={form.padre_id || ''} onChange={e=>setForm({...form, padre_id: e.target.value || null})}>
                <option value="">— Ítem suelto —</option>
                {(materiales||[]).filter(g => g.es_grupo && !g.deleted_at && g.id !== editingId).map(g => <option key={g.id} value={g.id}>{g.nombre_material}</option>)}
              </select>
            </div>
          )}
          <div>
            {window.JxFieldLabel
              ? <window.JxFieldLabel text="Stock inicial" hint="Cantidad que ingresa al almacén al crear el material. Si aún no llegó, dejalo en 0 y registrá un ingreso después."/>
              : <label className="flabel">Stock inicial</label>}
            <input className="fi" type="number" min="0" step="0.01" value={form.stock_inicial||''} onChange={e=>setForm({...form, stock_inicial:e.target.value})}/>
          </div>
          <div>
            {window.JxFieldLabel
              ? <window.JxFieldLabel text="Stock mínimo" hint="Por debajo de este nivel se dispara la alerta de reposición. Si baja al 50% se vuelve CRÍTICO. Recomendado: equivalente a 1-2 semanas de consumo."/>
              : <label className="flabel">Stock mínimo</label>}
            <input className="fi" type="number" min="0" step="0.01" value={form.stock_minimo||''} onChange={e=>setForm({...form, stock_minimo:e.target.value})}/>
          </div>
          <div>
            {window.JxFieldLabel
              ? <window.JxFieldLabel text="Precio estimado (S/)" hint="Precio unitario referencial sin IGV. Se usa para valorizar movimientos cuando no hay OC con precio real."/>
              : <label className="flabel">Precio estimado (S/)</label>}
            <input className="fi" type="number" step="0.01" placeholder="0.00" value={form.precio||''} onChange={e=>setForm({...form, precio:e.target.value})}/>
          </div>
          <div><label className="flabel">Proveedor principal</label>
            <select className="fi" value={form.proveedor_id||''} onChange={e=>setForm({...form, proveedor_id:e.target.value||null})}>
              <option value="">— sin especificar —</option>
              {provs.map(p => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
            </select>
          </div>
          <div style={{gridColumn:'1/-1'}}>
            <label className="flabel">Ubicación de almacenaje</label>
            <select className="fi" value={form.ubicacion_id||''} onChange={e=>setForm({...form, ubicacion_id:e.target.value||null})}>
              <option value="">— sin asignar —</option>
              {ubicacionesActivas.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              {/* Si en edición la ubicación actual está inactiva, dejarla seleccionable como tombstone */}
              {form.ubicacion_id && ubicacionesById.get(form.ubicacion_id) && ubicacionesById.get(form.ubicacion_id).activo === false && (
                <option value={form.ubicacion_id}>{ubicacionesById.get(form.ubicacion_id).nombre} (inactiva)</option>
              )}
            </select>
            {ubicacionesActivas.length === 0 && (
              <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:4 }}>
                No hay ubicaciones definidas para esta obra. Andá a "Ubicaciones de Obra" para crear el catálogo.
              </div>
            )}
          </div>
          {/* Foto referencial del material (opcional). Se sube como evidencia
              vinculada al material y aparece como thumbnail en la lista. */}
          {(() => {
            const fotoExistente = editingId ? fotosMap.get(editingId) : null;
            const tieneNueva = !!foto?.url;
            const tieneExistente = !!fotoExistente?.url && !tieneNueva;
            const labelBoton = tieneNueva
              ? 'Cambiar la nueva foto'
              : (fotoExistente ? 'Reemplazar foto guardada' : 'Adjuntar foto');
            return (
              <div style={{ gridColumn:'1/-1' }}>
                <label className="flabel">
                  Foto del material {fotoExistente && !tieneNueva && (
                    <span style={{ fontSize:11, color:'var(--green)', fontWeight:500 }}> · ya tiene foto</span>
                  )}
                </label>
                <div style={{ display:'flex', gap:10, alignItems:'flex-start', flexWrap:'wrap' }}>
                  <label className="btn btn-ghost btn-sm" style={{ cursor:'pointer' }}>
                    <JxIcon name="camera" size={13}/> {labelBoton}
                    <input type="file" accept="image/*" capture="environment" style={{ display:'none' }}
                           onChange={handleFotoChange}/>
                  </label>
                  {tieneNueva && (
                    <div style={{ position:'relative' }}>
                      <img src={foto.url} alt="nueva foto" style={{ width:80, height:80, objectFit:'cover', borderRadius:6, border:'2px solid var(--green)' }}/>
                      <div style={{ position:'absolute', bottom:-8, left:0, right:0, textAlign:'center', fontSize:9, color:'var(--green)', fontWeight:600 }}>NUEVA</div>
                      <button type="button" onClick={() => { if (foto.url) try { URL.revokeObjectURL(foto.url); } catch {} setFoto(null); }}
                        style={{ position:'absolute', top:-6, right:-6, width:20, height:20, borderRadius:'50%', background:'var(--red)', color:'white', border:'none', fontSize:11, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}
                        title="Cancelar nueva foto">×</button>
                    </div>
                  )}
                  {tieneExistente && (
                    <div style={{ position:'relative' }}>
                      <img src={fotoExistente.url} alt="foto actual" style={{ width:80, height:80, objectFit:'cover', borderRadius:6, border:'1px solid var(--bd)' }}/>
                      <div style={{ position:'absolute', bottom:-8, left:0, right:0, textAlign:'center', fontSize:9, color:'var(--tm)' }}>ACTUAL</div>
                    </div>
                  )}
                  {!tieneNueva && !fotoExistente && (
                    <span style={{ fontSize:11, color:'var(--tm)', alignSelf:'center' }}>
                      Sin foto. Adjuntá una para que el equipo la identifique más fácil.
                    </span>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
        {/* Super Admin: fecha de registro editable (solo en edición) */}
        {superAdmin && editingId && (
          <div style={{ marginTop:10, padding:'10px 12px', background:'rgba(231,76,60,0.06)', border:'1px solid rgba(231,76,60,0.3)', borderRadius:6 }}>
            <label className="flabel" style={{ color:'#E74C3C' }}>⚡ Fecha de registro (Super Admin)</label>
            <input className="fi" type="date" max={new Date().toISOString().slice(0,10)}
              value={form.fecha_registro || ''}
              onChange={e=>setForm({...form, fecha_registro:e.target.value})}/>
            <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:3 }}>
              Corrige la fecha de creación del material (created_at). Para cargar insumos que existían antes de empezar a usar el sistema.
            </div>
          </div>
        )}
        <div className="modal-actions" style={{ justifyContent: editingId ? 'space-between' : 'flex-end' }}>
          {editingId && (() => {
            const matEdit = materiales.find(x => x.id === editingId);
            const yaInactivo = matEdit?.estado === 'inactivo';
            return (
              <button
                className={`btn ${yaInactivo ? 'btn-ghost' : 'btn-ghost'}`}
                style={{ color: yaInactivo ? 'var(--green)' : 'var(--tm)' }}
                disabled={busyMat}
                onClick={async () => {
                  if (!matEdit) return;
                  const nuevoEstado = yaInactivo ? 'activo' : 'inactivo';
                  try {
                    await updateMaterial(editingId, {
                      estado: nuevoEstado,
                      updated_at: new Date().toISOString(),
                      sync_status: 'pending_update',
                    });
                    showToast(yaInactivo
                      ? `Material reactivado — vuelve a las alertas`
                      : `Material marcado inactivo — no genera más alertas`, 'green');
                    closeModalMaterial();
                  } catch (e) {
                    showToast('Error: ' + (e.message || e), 'red');
                  }
                }}>
                <JxIcon name={yaInactivo ? 'check' : 'archive'} size={13}/>
                {yaInactivo ? 'Reactivar' : 'Marcar inactivo'}
              </button>
            );
          })()}
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn btn-ghost" onClick={closeModalMaterial} disabled={busyMat}>Cancelar</button>
            <button className="btn btn-amber" onClick={handleSubmitMaterial} disabled={busyMat}>
              <JxIcon name="check" size={13}/>
              {busyMat ? 'Guardando…' : (editingId ? 'Guardar Cambios' : 'Crear Material')}
            </button>
          </div>
        </div>
      </Modal>);
      })()}

      {/* Modal confirmar agrupación (variantes SKU) */}
      {grupoModal && (
        <Modal title="Agrupar como variantes" icon="layers" onClose={() => setGrupoModal(null)}>
          <div style={{ fontSize: 12.5, color: 'var(--ts)', marginBottom: 12 }}>Se crea el grupo <strong>“{grupoModal.titulo}”</strong> y estos {grupoModal.items.length} materiales pasan a ser sus variantes.</div>
          <label className="flabel">Nombre del grupo</label>
          <input className="fi" value={grupoModal.titulo} onChange={e => setGrupoModal(g => ({ ...g, titulo: e.target.value }))} />
          <div style={{ maxHeight: 180, overflowY: 'auto', marginTop: 10, border: '1px solid var(--bd)', borderRadius: 6, padding: 8 }}>
            {grupoModal.items.map(it => <div key={it.id} style={{ fontSize: 12, padding: '3px 0', color: 'var(--ts)' }}>• {it.nombre_material} <span style={{ color: 'var(--tm)' }}>· stock {Number(it.stock_actual || 0)} {it.unidad}</span></div>)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={() => setGrupoModal(null)} disabled={varBusy}>Cancelar</button>
            <button className="btn btn-amber" onClick={() => crearGrupoMat(grupoModal.titulo, grupoModal.items)} disabled={varBusy}><JxIcon name="check" size={13} /> Crear grupo</button>
          </div>
        </Modal>
      )}

      {/* Modal fusionar duplicados */}
      {dupModal && (
        <Modal title="Fusionar materiales duplicados" icon="compare" onClose={() => setDupModal(null)}>
          <div style={{ fontSize: 12.5, color: 'var(--ts)', marginBottom: 12 }}>Elegí cuál se queda. Los demás se dan de baja y sus movimientos + stock pasan al sobreviviente.</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {dupModal.grupo.items.map(it => (
              <label key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid var(--bd)', borderRadius: 6, cursor: 'pointer', background: dupModal.survivorId === it.id ? 'rgba(46,204,113,0.08)' : 'transparent' }}>
                <input type="radio" name="dup-mat" checked={dupModal.survivorId === it.id} onChange={() => setDupModal(m => ({ ...m, survivorId: it.id }))} style={{ accentColor: 'var(--green)' }} />
                <span style={{ flex: 1, fontSize: 12.5 }}>{it.nombre_material}</span>
                <span style={{ fontSize: 11, color: 'var(--tm)' }}>stock {Number(it.stock_actual || 0)} {it.unidad}{it.categoria ? ` · ${it.categoria}` : ''}</span>
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={() => setDupModal(null)} disabled={varBusy}>Cancelar</button>
            <button className="btn btn-red" onClick={fusionarDupMat} disabled={varBusy}><JxIcon name="check" size={13} /> {varBusy ? 'Fusionando…' : 'Fusionar'}</button>
          </div>
        </Modal>
      )}

      {/* Modal Solicitar Reposición — con cantidad editable + motivo obligatorio */}
      {modal === 'reposicion' && reposicionForm && (
        <Modal title={`Solicitar reposición · ${reposicionForm.mat.nombre_material}`} icon="alert" onClose={()=>{ setModal(null); setReposicionForm(null); }} wide>
          <div style={{ marginBottom:14, padding:'10px 12px', background: reposicionForm.prioridad === 'urgente' ? 'rgba(231,76,60,0.10)' : 'rgba(242,183,5,0.10)', border:`1px solid ${reposicionForm.prioridad === 'urgente' ? 'rgba(231,76,60,0.4)' : 'rgba(242,183,5,0.4)'}`, borderRadius:8, fontSize:12.5, color:'var(--ts)' }}>
            <strong style={{ color: reposicionForm.prioridad === 'urgente' ? 'var(--red)' : 'var(--amber)' }}>
              Prioridad {reposicionForm.prioridad.toUpperCase()}
            </strong> ·
            Stock actual: <strong>{reposicionForm.mat.stock_actual} {reposicionForm.mat.unidad}</strong> ·
            Mínimo: <strong>{reposicionForm.mat.stock_minimo} {reposicionForm.mat.unidad}</strong>
          </div>
          <div className="g2">
            <div>
              <label className="flabel">Cantidad a solicitar *</label>
              <input className="fi" type="number" min="0.01" step="0.01"
                value={reposicionForm.cantidad}
                onChange={e=>setReposicionForm(prev => ({ ...prev, cantidad: e.target.value }))}/>
              <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:4 }}>
                Sugerida: 2× el mínimo menos stock actual = {(Math.max(0, Number(reposicionForm.mat.stock_minimo || 0) * 2 - Number(reposicionForm.mat.stock_actual || 0))).toFixed(2)} {reposicionForm.mat.unidad}
              </div>
            </div>
            <div>
              <label className="flabel">Prioridad</label>
              <select className="fi" value={reposicionForm.prioridad}
                onChange={e=>setReposicionForm(prev => ({ ...prev, prioridad: e.target.value }))}>
                <option value="baja">Baja</option>
                <option value="media">Media</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="flabel">Motivo / Justificación *</label>
              <textarea className="fi" rows={3}
                value={reposicionForm.motivo}
                onChange={e=>setReposicionForm(prev => ({ ...prev, motivo: e.target.value }))}
                placeholder="Mínimo 10 caracteres. Ej: necesario para vaciado losa nivel 4 esta semana"
                style={{ minHeight:80 }}/>
              <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:4 }}>
                Esto se guarda como nota de la requisición y queda visible para el aprobador.
              </div>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>{ setModal(null); setReposicionForm(null); }} disabled={reposicionForm.busy}>
              Cancelar
            </button>
            <button className="btn btn-amber" onClick={confirmarReposicion} disabled={reposicionForm.busy}>
              <JxIcon name="check" size={13}/>
              {reposicionForm.busy ? 'Creando…' : 'Crear requisición'}
            </button>
          </div>
        </Modal>
      )}

      {requestTarget && (
        <RequestChangeModal
          table="materiales"
          record={requestTarget}
          recordLabel={requestTarget.nombre_material}
          allowDelete
          fields={[
            { key: 'nombre_material', label: 'Nombre del material' },
            { key: 'categoria', label: 'Categoría' },
            { key: 'unidad', label: 'Unidad' },
            { key: 'stock_minimo', label: 'Stock mínimo', type: 'number' },
            { key: 'precio_unitario_estimado', label: 'Precio estimado (S/)', type: 'number' },
            {
              key: 'proveedor_principal_id',
              label: 'Proveedor principal',
              options: [
                { value: '', label: '— sin especificar —' },
                ...((provs || []).map(p => ({ value: p.id, label: p.razon_social || p.ruc || p.id }))),
              ],
            },
            {
              key: 'ubicacion_id',
              label: 'Ubicación de almacenaje',
              options: [
                { value: '', label: '— sin asignar —' },
                ...((ubicaciones || []).filter(u => !u.deleted_at).map(u => ({
                  value: u.id,
                  label: u.activo === false ? `${u.nombre} (inactiva)` : u.nombre,
                }))),
              ],
            },
          ]}
          showToast={showToast}
          onClose={() => setRequestTarget(null)}
        />
      )}
    </div>
  );
}

// ─── HERRAMIENTAS PAGE ──────────────────────────────────
function HerramientasPage({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const myRol = auth?.profile?.rol;
  const isAdmin = myRol === 'admin';
  const appMode = window.__useAppMode ? window.__useAppMode() : { isPrueba: true };
  const canDelete = isAdmin && (appMode.isEdicion || appMode.isPrueba);
  const superAdmin = !!appMode.superAdmin;
  const canWrite = isAdmin || (window.__hasPerm?.(myRol, 'Herramientas', 'w') ?? false);
  const canWriteMov = isAdmin || (window.__hasPerm?.(myRol, 'Mov. Herramientas', 'w') ?? false);
  // Foto del catálogo: libre para el almacenero (permiso de Evidencias), aunque
  // editar campos ahora sea solo-admin.
  const userId = auth?.profile?.id ?? null;
  const canFoto = canWrite || (window.__hasPerm?.(myRol, 'Evidencias', 'w') ?? false);
  const [q, setQ] = uS(() => { try { const v = window.__almHerrBuscar; if (v) { delete window.__almHerrBuscar; return v; } } catch {} return ''; }); // pre-filtro desde Solicitudes (Ir al registro)
  const [modal, setModal] = uS(null);
  const [form, setForm] = uS({});
  const [editingId, setEditingId] = uS(null);
  const [obraId, setObraId] = uS(null);
  // Foto en edición/creación: { blob, url } — url es objectURL local.
  const [foto, setFoto] = uS(null);
  // Map<herramienta_id, { url, isRemote }>: thumbnails para la lista.
  const [fotosMap, setFotosMap] = uS(() => new Map());
  // Foto de catálogo libre por fila (FotoInsumoCell compartido), con su propio
  // tipo_evidencia para no chocar con la foto del formulario.
  const fotosCatMap = useFotosEvidencias(obraId, 'foto_herramienta');
  // Doble click guard
  const [busyHerr, setBusyHerr] = uS(false);
  const [requestTarget, setRequestTarget] = uS(null);
  // Visor de historial de precios (insumo unificado, itemTipo="herramienta")
  const [histPrecioItem, setHistPrecioItem] = uS(null);

  uE(() => {
    let cancelled = false;
    let attempts = 0;
    const find = async () => {
      attempts++;
      const obras = await window.__db.obras.toArray();
      const stored = window.__getObraActivaId?.();
      const a = (stored && obras.find(o => o.id === stored && !o.deleted_at))
             || obras.find(o => !o.deleted_at);
      if (a) { if (!cancelled) setObraId(a.id); return; }
      if (cancelled || attempts >= 10) return;
      setTimeout(find, 500);
    };
    find();
    const onChange = () => { attempts = 0; find(); };
    window.addEventListener('jarvex_master_updated', onChange);
    window.addEventListener('obra_activa_change', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('jarvex_master_updated', onChange);
      window.removeEventListener('obra_activa_change', onChange);
    };
  }, []);

  const { data: herramientas, loading, create: createHerr, update: updateHerr, refresh } = window.__hooks.useHerramientas(obraId);
  const { data: personal } = window.__hooks.usePersonal(obraId);
  const { data: subcontratistas } = window.__hooks.useSubcontratistas();
  const movHook = window.__hooks.useMovimientosHerramientas(obraId);
  // Frentes de trabajo activos de la obra (para el picker opcional en la salida).
  const { data: frentes } = window.__hooks.useFrentesObra(obraId, { soloActivas: true });
  // Personal activo de la obra + subcontratos, para atribuir salidas (Fase B).
  const personalActivoHerr = uM(() => (personal || []).filter(p => p.estado === 'activo' && (!p.obra_id || !obraId || p.obra_id === obraId)), [personal, obraId]);
  const destinoOptsHerr = uM(() => opcionesDestinoFlat(personalActivoHerr, subcontratistas), [personalActivoHerr, subcontratistas]);

  // Stock por ubicación (solo aplica a herramientas maneja_cantidad).
  const [desgloseUbicH, setDesgloseUbicH] = uS(() => new Map()); // Map(herr_id → Map(ubic_id → cant))
  const [popupHerr, setPopupHerr] = uS(null);        // herramienta para el popup de desglose
  const [traspasoPreIdH, setTraspasoPreIdH] = uS('');// herr preseleccionada en traspaso
  const [loteCant, setLoteCant] = uS(null);          // 'ingreso' | 'salida' (modal lote por cantidad)
  const [loteCantItems, setLoteCantItems] = uS([]);
  const [loteCantForm, setLoteCantForm] = uS({});
  const [busyLoteCant, setBusyLoteCant] = uS(false);
  // Frente de trabajo (OBLIGATORIO) común a toda la salida del lote de
  // herramientas, con escape "lo completo después" → queda pendiente.
  const [frenteSalida, setFrenteSalida] = uS('');
  const [frentePendiente, setFrentePendiente] = uS(false);
  uE(() => {
    if (!obraId) return;
    let cancelled = false;
    const cargar = async () => {
      try {
        const ids = (herramientas || []).filter(h => h.maneja_cantidad).map(h => h.id);
        const m = await getDesgloseBulk('herramienta', ids);
        if (!cancelled) setDesgloseUbicH(m);
      } catch (e) { console.warn('[herr desglose]', e?.message); }
    };
    cargar();
    const onCh = (e) => { const t = e?.detail?.tabla || e?.detail?.table; if (!t || t === 'stock_ubicaciones') cargar(); };
    window.addEventListener('jx_data_changed', onCh);
    return () => { cancelled = true; window.removeEventListener('jx_data_changed', onCh); };
  }, [obraId, herramientas]);

  // Carga fotos de herramientas (evidencias tipo 'foto_herramienta')
  uE(() => {
    if (!obraId) return;
    let cancelled = false;
    const blobUrlsLocales = [];
    const cargar = async () => {
      try {
        const evidencias = await window.__db.evidencias
          .where('obra_id').equals(obraId)
          .filter(e => e.tipo_evidencia === 'foto_herramienta' && !e.deleted_at && e.registro_relacionado_id)
          .toArray();
        evidencias.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        const map = new Map();
        for (const ev of evidencias) {
          if (map.has(ev.registro_relacionado_id)) continue;
          if (ev.url_archivo) {
            map.set(ev.registro_relacionado_id, { url: ev.url_archivo, isRemote: true });
          } else {
            try {
              const row = await window.__db.evidencias_blobs.get(ev.id);
              if (row?.blob) {
                const url = URL.createObjectURL(row.blob);
                blobUrlsLocales.push(url);
                map.set(ev.registro_relacionado_id, { url, isRemote: false });
              }
            } catch {}
          }
        }
        if (!cancelled) setFotosMap(map);
      } catch (e) { console.warn('[fotos herramientas]', e?.message || e); }
    };
    cargar();
    const onChange = (e) => {
      const t = e?.detail?.tabla || e?.detail?.table;
      if (!t || t === 'evidencias' || t === 'herramientas') cargar();
    };
    window.addEventListener('jx_data_changed', onChange);
    window.addEventListener('jarvex_master_updated', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('jx_data_changed', onChange);
      window.removeEventListener('jarvex_master_updated', onChange);
      blobUrlsLocales.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
    };
  }, [obraId]);

  const { data: ubicacionesH } = window.__hooks.useUbicacionesObra?.(obraId) || { data: [] };
  const ubicacionesActivasH = uM(() => (ubicacionesH || []).filter(u => u.activo !== false && !u.deleted_at), [ubicacionesH]);
  const ubicacionesByIdH = uM(() => {
    const map = new Map();
    (ubicacionesH || []).forEach(u => map.set(u.id, u));
    return map;
  }, [ubicacionesH]);

  // ── Herramientas por cantidad: ingreso/salida en lote + traspaso ────
  const herrCantidad = uM(() => (herramientas || []).filter(h => h.maneja_cantidad && !h.deleted_at), [herramientas]);
  // Flujo unificado de movimientos: TODA herramienta suelta (no grupo) puede
  // moverse — ya no se separa "serializada" vs "por cantidad". Las pocas que
  // quedaron serializadas (creadas antes del fix) se sanan a cantidad en el submit.
  const herrMovibles = uM(() => (herramientas || []).filter(h => !h.deleted_at && !h.es_grupo), [herramientas]);
  const stockDeHerr = (h) => h?.maneja_cantidad ? Number(h?.stock_actual || 0) : (h?.disponible !== false ? 1 : 0);
  // "Fuera de almacén" = lo que el badge muestra En Uso (o no disponible). Es
  // lo que se puede devolver. Respeta el estado importado del registro histórico.
  const herrFueraDeAlmacen = uM(() => (herramientas || []).filter(h => !h.deleted_at && !h.es_grupo && (h.ubicacion_actual === 'en_uso' || h.ubicacion_actual === 'mantenimiento' || h.disponible === false)), [herramientas]);
  const ubicDefaultH = () => (ubicacionesActivasH.length === 1 ? ubicacionesActivasH[0].id : '');
  const updateLoteCantItem = (id, patch) => setLoteCantItems(items => items.map(it => it.id === id ? { ...it, ...patch } : it));
  // Cada fila lleva además `condicion` (estado de origen en salida / de retorno
  // en devolución) y `responsable_id` (quién devuelve, en devolución).
  const nuevaFilaCant = (tipo) => ({ id: window.__newId?.() || crypto.randomUUID(), herramienta_id: '', cantidad: '', condicion: tipo === 'devolucion' ? 'bueno' : '', responsable_id: '' });
  const addLoteCantItem = () => setLoteCantItems(items => [...items, nuevaFilaCant(loteCant)]);
  const removeLoteCantItem = (id) => setLoteCantItems(items => items.length > 1 ? items.filter(it => it.id !== id) : items);
  const openLoteCant = (tipo) => {
    // es_excepcion/motivo: la devolución la hace por defecto quien sacó la
    // herramienta; si la devuelve otra persona se marca la excepción + motivo.
    setLoteCantForm({ fecha: hoyLocal(), hora: horaLocal(), ubicacion_id: ubicDefaultH(), responsable_id: '', observaciones: '', es_excepcion: false, motivo_excepcion: '' });
    setLoteCantItems([nuevaFilaCant(tipo)]);
    setFrenteSalida('');
    setFrentePendiente(false);
    setLoteCant(tipo);
  };
  // Guard SÍNCRONO anti doble-click (22-jul): mismo patrón que el lote de
  // materiales — el estado busyLoteCant se activa tras validaciones con
  // awaits y un doble click en esa ventana creaba lotes duplicados.
  const loteHerrEnCursoRef = React.useRef(false);
  const submitLoteCant = async () => {
    if (loteHerrEnCursoRef.current) return;
    loteHerrEnCursoRef.current = true;
    try { await submitLoteCantInner(); }
    finally { loteHerrEnCursoRef.current = false; }
  };
  const submitLoteCantInner = async () => {
    if (busyLoteCant) return;
    const tipo = loteCant;                       // 'ingreso' | 'salida' | 'devolucion'
    const esEntrada = tipo !== 'salida';         // ingreso (compra) y devolución suman stock
    const itemsValidos = loteCantItems.filter(it => it.herramienta_id && parseFloat(it.cantidad) > 0);
    if (!itemsValidos.length) { showToast('Agregá al menos una herramienta con cantidad', 'red'); return; }
    const ubicMov = loteCantForm.ubicacion_id || null;
    // El almacén es obligatorio en las 3 acciones cuando hay almacenes definidos:
    // sin él, el desglose por ubicación (stock_ubicaciones) no se actualizaría y
    // quedaría inconsistente con el stock total. (Con 1 solo almacén se autocompleta.)
    if (ubicacionesActivasH.length >= 1 && !ubicMov) {
      showToast(tipo === 'salida' ? 'Elegí el almacén de origen de la salida' : 'Elegí el almacén de llegada', 'red');
      return;
    }
    // Validación de stock por ubicación SOLO en salida (no podés sacar más de lo que hay).
    if (tipo === 'salida' && ubicMov) {
      const proyec = new Map();
      for (const it of itemsValidos) {
        const h = herramientas.find(x => x.id === it.herramienta_id);
        const dgItem = desgloseUbicH.get(it.herramienta_id);
        const tieneDesglose = dgItem && Array.from(dgItem.values()).some(c => Number(c) > 0);
        const base = proyec.has(it.herramienta_id) ? proyec.get(it.herramienta_id) : (tieneDesglose ? baseSalidaUbicacion(dgItem, ubicMov, stockDeHerr(h)).base : stockDeHerr(h));
        const cant = parseFloat(it.cantidad) || 0;
        if (base - cant < 0) { showToast(`❌ Stock insuficiente de "${h?.nombre_herramienta}" en ${ubicacionesByIdH.get(ubicMov)?.nombre || 'ese almacén'}: hay ${base}, pedís ${cant}.`, 'red'); return; }
        proyec.set(it.herramienta_id, base - cant);
      }
    }
    // Resolvemos la CONDICIÓN de origen de cada fila de salida UNA sola vez (sobre
    // el snapshot estable de estadosMap), y la reusamos en validación y ejecución
    // para que no haya forma de que difieran. Auto si hay una sola fuente con stock.
    const condSalida = new Map();
    if (tipo === 'salida') {
      for (const it of itemsValidos) {
        const fuentes = fuentesSalidaHerr(it.herramienta_id);
        condSalida.set(it.id, it.condicion || (fuentes.length === 1 ? fuentes[0].key : ''));
      }
      // Validación por condición: hay que decir de cuál sale y que alcance.
      const proyecEst = new Map();
      for (const it of itemsValidos) {
        const h = herramientas.find(x => x.id === it.herramienta_id);
        const fuentes = fuentesSalidaHerr(it.herramienta_id);
        if (fuentes.length === 0) continue; // sin stock (lo atrapa la validación de almacén)
        const cond = condSalida.get(it.id);
        if (!cond) { showToast(`Elegí de qué condición sale "${h?.nombre_herramienta}" (está repartida en varias).`, 'red'); return; }
        const fuente = fuentes.find(f => f.key === cond);
        const k = `${it.herramienta_id}__${cond}`;
        const baseE = proyecEst.has(k) ? proyecEst.get(k) : Number(fuente?.qty || 0);
        const cant = parseFloat(it.cantidad) || 0;
        const lblCond = cond === '_sin' ? 'Sin clasificar' : (ESTADO_LABEL[cond] || cond);
        if (baseE - cant < 0) { showToast(`❌ De "${lblCond}" solo hay ${baseE} de "${h?.nombre_herramienta}", pedís ${cant}.`, 'red'); return; }
        proyecEst.set(k, baseE - cant);
      }
    }
    // ── Validación CRONOLÓGICA (salida) ─────────────────────────────
    // No puede salir mercadería que a ESA fecha aún no había ingresado, ni
    // dejar negativo un punto posterior de la línea de tiempo (caso real
    // rotomartillos: salida retro 11/05 con la entrada recién el 15/05).
    if (tipo === 'salida' && loteCantForm.fecha) {
      const porItem = agruparCantidades(itemsValidos, it => it.herramienta_id);
      for (const [hid, cantTotal] of porItem) {
        const h = herramientas.find(x => x.id === hid);
        let hist = [];
        try { hist = await window.__db.movimientos_herramientas.filter(m => m.herramienta_id === hid).toArray(); } catch {}
        const rc = validarSalidaCronologica({ movimientos: hist, fecha: loteCantForm.fecha, hora: loteCantForm.hora, cantidad: cantTotal, stockActualHoy: stockDeHerr(h) });
        if (!rc.ok) {
          showToast(`❌ Incongruencia de fechas: al ${loteCantForm.fecha}, "${h?.nombre_herramienta}" solo tenía ${rc.disponible} disponible(s) — las entradas posteriores a esa fecha no cuentan. Corregí la fecha de la salida o la cantidad.`, 'red');
          return;
        }
      }
    }
    // Devolución: el responsable es OBLIGATORIO. Por defecto la devuelve quien la
    // sacó (ultimo_responsable_id); si la devuelve otra persona → excepción + motivo.
    if (tipo === 'devolucion') {
      if (loteCantForm.es_excepcion && !(loteCantForm.motivo_excepcion || '').trim()) {
        showToast('Indicá el motivo: ¿por qué la devuelve otra persona?', 'red'); return;
      }
      for (const it of itemsValidos) {
        const h = herramientas.find(x => x.id === it.herramienta_id);
        const resp = loteCantForm.es_excepcion ? it.responsable_id : (h?.ultimo_responsable_id || it.responsable_id);
        if (!resp) {
          showToast(loteCantForm.es_excepcion
            ? `Elegí quién devuelve "${h?.nombre_herramienta}".`
            : `"${h?.nombre_herramienta}" no tiene responsable previo — marcá "La devuelve otra persona" y elegí quién.`, 'red');
          return;
        }
      }
    }
    // Observaciones: prefijo [Devolución] solo si hay texto real (evita guardar
    // un prefijo suelto o espacios en blanco).
    const obsLimpia = (loteCantForm.observaciones || '').trim();
    const obsFinal = tipo === 'devolucion'
      ? ['[Devolución]', obsLimpia, (loteCantForm.es_excepcion ? `Excepción (la devuelve otra persona): ${(loteCantForm.motivo_excepcion || '').trim()}` : '')].filter(Boolean).join(' · ')
      : (obsLimpia || null);
    // Frente OBLIGATORIO en salida: hay que elegir uno, o marcar
    // explícitamente "lo completo después" (queda pendiente).
    if (tipo === 'salida' && !frenteSalida && !frentePendiente) {
      showToast('Elegí el frente de trabajo, o marcá "lo completo después".', 'red');
      return;
    }
    // Idempotencia a nivel LOTE: una clave por click → sub-clave determinista por
    // item. Si el browser re-envía, el server rechaza el duplicado por UNIQUE.
    const loteKey = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? `lote-mov-herr-${crypto.randomUUID()}`
      : `lote-mov-herr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setBusyLoteCant(true);
    let ok = 0, fail = 0;
    try {
      for (let idx = 0; idx < itemsValidos.length; idx++) {
        const it = itemsValidos[idx];
        // Releemos la herramienta desde Dexie (no del closure de React) para que
        // el stock base sea el PERSISTIDO actual y no una copia vieja del render
        // — evita que un ingreso "no se refleje" si la lista estaba desfasada.
        const hDb = await window.__db.herramientas.get(it.herramienta_id).catch(() => null);
        if (!hDb) console.warn('[herr lote] no se pudo releer de Dexie; uso copia de pantalla', it.herramienta_id);
        const h = hDb || herramientas.find(x => x.id === it.herramienta_id);
        if (!h) { fail++; continue; }
        const cant = parseFloat(it.cantidad) || 0;
        // Atribución: salida usa el destino del lote; devolución usa el responsable
        // de la FILA (por defecto quien la sacó, o el de la excepción); ingreso no lleva.
        // OJO devolución: tomamos el ultimo_responsable del SNAPSHOT de pantalla
        // (no del re-read), porque al devolver se pone null y una devolución dividida
        // por condición (varias filas del mismo ítem) perdería el responsable.
        const ultimoOrig = herramientas.find(x => x.id === it.herramienta_id)?.ultimo_responsable_id || h.ultimo_responsable_id || null;
        const destRaw = tipo === 'ingreso' ? null
          : tipo === 'salida' ? loteCantForm.responsable_id
          : (loteCantForm.es_excepcion ? it.responsable_id : (ultimoOrig || it.responsable_id));
        const dest = tipo === 'ingreso' ? { responsable_id: null, subcontratista_id: null, destino_tipo: null } : splitDestino(destRaw);
        try {
          await movHook.create({
            obra_id: obraId, herramienta_id: it.herramienta_id, fecha: loteCantForm.fecha, hora: loteCantForm.hora,
            // accion respeta el CHECK del schema (entrada/salida); tipo_movimiento
            // lleva la semántica fina (ingreso ≠ devolución) para los reportes.
            accion: esEntrada ? 'entrada' : 'salida', tipo_movimiento: tipo, cantidad: cant,
            ...dest,
            // Frente de trabajo — mismo para todas las filas del lote.
            // Solo aplica en SALIDA; en ingreso/devolución queda null.
            frente_id: tipo === 'salida' ? (frenteSalida || null) : null,
            // Una salida que termina SIN frente es necesariamente diferida →
            // marcarla como pendiente. Ingreso/devolución → false.
            frente_pendiente: (tipo === 'salida' && !frenteSalida) ? true : false,
            ubicacion_id: ubicMov,
            // Condición del movimiento (columnas existentes, antes null en el
            // flujo por cantidad): salida = de qué condición salió; devolución =
            // en qué condición volvió. Sirve para revertir el bucket EXACTO de
            // stock_estados si el movimiento se elimina/reversa después.
            estado_salida: tipo === 'salida' ? (condSalida.get(it.id) || null) : null,
            estado_devolucion: tipo === 'devolucion' ? (it.condicion || 'bueno') : null,
            observaciones: obsFinal,
            idempotency_key: `${loteKey}_${idx}_${it.herramienta_id}`,
          });
          if (ubicMov) { try { await aplicarDelta({ obraId, itemTipo: 'herramienta', itemId: it.herramienta_id, ubicacionId: ubicMov, delta: esEntrada ? cant : -cant, userId: auth?.profile?.id || null }); } catch (err) { console.warn('[herr aplicarDelta]', err?.message); } }
          const base = stockDeHerr(h);
          const nuevoStock = Math.max(0, base + (esEntrada ? cant : -cant));
          // Saneo + estado: toda herramienta queda "por cantidad" y su badge
          // refleja la última acción (salida → En Uso, entrada → Almacén).
          await window.__db.herramientas.update(it.herramienta_id, {
            maneja_cantidad: true,
            stock_actual: nuevoStock,
            alerta: calcAlerta(nuevoStock, Number(h.stock_minimo || 0)),
            ubicacion_actual: esEntrada ? 'almacen' : 'en_uso',
            disponible: esEntrada ? true : nuevoStock > 0,
            ultimo_responsable_id: tipo === 'salida' ? (dest.responsable_id || null) : (tipo === 'devolucion' ? null : (h.ultimo_responsable_id || null)),
            fecha_ultimo_movimiento: loteCantForm.fecha,
            // Sync: marcar pending para que el cambio de stock/estado viaje al
            // servidor (el lote viejo usaba db.update "pelado" → NO sincronizaba).
            sync_status: h.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
            updated_at: new Date().toISOString(),
            updated_by: auth?.profile?.id || 'offline',
            version: (h.version ?? 0) + 1,
          });
          // Buckets por CONDICIÓN (stock_estados): ingreso → +Nuevo; salida →
          // −(condición de origen, auto si hay una sola); devolución → +(condición
          // de retorno). Mantiene la distribución por estado en sync automático.
          try {
            const uid = auth?.profile?.id || null;
            if (tipo === 'ingreso') {
              await aplicarDeltaEstado({ obraId, itemTipo: 'herramienta', itemId: it.herramienta_id, estado: 'nuevo', delta: cant, userId: uid });
            } else if (tipo === 'salida') {
              // Misma condición resuelta que en la validación (condSalida).
              const cond = condSalida.get(it.id);
              // '_sin' = sale de lo no clasificado → no toca ningún bucket.
              if (cond && cond !== '_sin') await aplicarDeltaEstado({ obraId, itemTipo: 'herramienta', itemId: it.herramienta_id, estado: cond, delta: -cant, userId: uid });
            } else if (tipo === 'devolucion') {
              await aplicarDeltaEstado({ obraId, itemTipo: 'herramienta', itemId: it.herramienta_id, estado: it.condicion || 'bueno', delta: cant, userId: uid });
            }
          } catch (err) { console.warn('[herr estado delta]', err?.message); }
          ok++;
        } catch (e) { fail++; }
      }
      refresh();
      const etq = tipo === 'ingreso' ? 'ingresos' : tipo === 'devolucion' ? 'devoluciones' : 'salidas';
      showToast(fail ? `⚠ ${ok} ok, ${fail} fallaron` : `✓ ${ok} ${etq}`, fail ? 'amber' : 'green');
      setLoteCant(null); setLoteCantItems([]); setLoteCantForm({}); setFrenteSalida(''); setFrentePendiente(false);
    } finally { setBusyLoteCant(false); }
  };
  const ejecutarTraspasoHerr = async ({ item_id, origenId, destinoId, cantidad }) => {
    try {
      await traspasar({ obraId, itemTipo: 'herramienta', itemId: item_id, origenId, destinoId, cantidad, userId: auth?.profile?.id || null });
      const h = herramientas.find(x => x.id === item_id);
      const uO = ubicacionesByIdH.get(origenId)?.nombre || 'origen';
      const uD = ubicacionesByIdH.get(destinoId)?.nombre || 'destino';
      const key = `traspaso-herr-${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
      // Misma fecha+hora de Lima para ambas patas (antes: fecha UTC, sin hora).
      const base = { obra_id: obraId, herramienta_id: item_id, fecha: hoyLocal(), hora: horaLocal(), cantidad, responsable_id: null };
      await movHook.create({ ...base, accion: 'salida', tipo_movimiento: 'salida', ubicacion_id: origenId, observaciones: `Traspaso → ${uD}`, idempotency_key: `${key}_out` });
      await movHook.create({ ...base, accion: 'entrada', tipo_movimiento: 'entrada', ubicacion_id: destinoId, observaciones: `Traspaso ← ${uO}`, idempotency_key: `${key}_in` });
      showToast(`Traspaso: ${cantidad} de ${uO} → ${uD}`, 'green');
      setModal(null); refresh();
    } catch (e) { showToast('Error en traspaso: ' + (e.message || e), 'red'); }
  };

  const matchHerr = (h) => {
    if (!q) return true;
    const ql = q.toLowerCase();
    return h.nombre_herramienta?.toLowerCase().includes(ql) || h.marca?.toLowerCase().includes(ql) || h.tipo_herramienta?.toLowerCase().includes(ql);
  };
  // ── Variantes padre-hijo (SKU) ──────────────────────────────
  const childrenByPadre = uM(() => {
    const map = new Map();
    for (const h of (herramientas || [])) { if (!h.deleted_at && h.padre_id) { const a = map.get(h.padre_id) || []; a.push(h); map.set(h.padre_id, a); } }
    return map;
  }, [herramientas]);
  const variantesDe = (g) => childrenByPadre.get(g.id) || [];
  const stockDeNodo = (h) => h.es_grupo ? variantesDe(h).reduce((s, c) => s + Number(c.stock_actual || 0), 0) : Number(h.stock_actual || 0);
  const [expandedGroups, setExpandedGroups] = uS(() => new Set());
  const toggleGroup = (id) => setExpandedGroups(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const sugerencias = uM(() => detectarSugerencias(herramientas, 'nombre_herramienta'), [herramientas]);
  const dups = uM(() => detectarDuplicados(herramientas, 'nombre_herramienta'), [herramientas]);
  const [descartadas, setDescartadas] = uS(() => new Set());
  const [sugerenciasOpen, setSugerenciasOpen] = uS(false);   // desplegable de sugerencias (no invadir)
  const [grupoModal, setGrupoModal] = uS(null);
  const [dupModal, setDupModal] = uS(null);
  const [varBusy, setVarBusy] = uS(false);

  // Estados/condición (buckets) por herramienta de cantidad.
  const [estadosItem, setEstadosItem] = uS(null);        // herramienta abierta en el modal
  const [estadosMap, setEstadosMap] = uS(() => new Map()); // id → Map(estado → cantidad)
  uE(() => {
    if (!herramientas?.length) return;
    let cancel = false;
    const cargar = async () => {
      try {
        const ids = herramientas.filter(h => h.maneja_cantidad && !h.es_grupo).map(h => h.id);
        const m = await getEstadosBulk('herramienta', ids);
        if (!cancel) setEstadosMap(m);
      } catch (e) { console.warn('[estados bulk]', e?.message); }
    };
    cargar();
    const onCh = (e) => { const t = e?.detail?.tabla || e?.detail?.table; if (!t || t === 'stock_estados') cargar(); };
    window.addEventListener('jx_data_changed', onCh);
    return () => { cancel = true; window.removeEventListener('jx_data_changed', onCh); };
  }, [herramientas]);

  // Fuentes de una SALIDA por condición: cada bucket con stock + "Sin clasificar"
  // (lo que el stock_actual tiene de más respecto a la suma de buckets). Así se
  // puede sacar de una condición concreta o de lo no clasificado sin que la suma
  // por estado quede inconsistente con el stock total.
  const fuentesSalidaHerr = (herrId) => {
    const h = herramientas.find(x => x.id === herrId);
    if (!h) return [];
    const em = estadosMap.get(herrId);
    const buckets = (em ? ESTADOS_COND.filter(e => Number(em.get(e.key) || 0) > 0) : [])
      .map(e => ({ key: e.key, label: e.label, badge: e.badge, qty: Number(em.get(e.key) || 0) }));
    const clasif = buckets.reduce((s, b) => s + b.qty, 0);
    const sinClasif = Math.max(0, stockDeHerr(h) - clasif);
    return sinClasif > 0 ? [...buckets, { key: '_sin', label: 'Sin clasificar', badge: 'b-gray', qty: sinClasif }] : buckets;
  };

  const filtered = uM(() => {
    if (!herramientas) return [];
    const top = herramientas.filter(h => !h.deleted_at && !h.padre_id);
    return top.filter(h => h.es_grupo ? (matchHerr(h) || variantesDe(h).some(matchHerr)) : matchHerr(h));
  }, [q, herramientas, childrenByPadre]);

  const herrPg = usePagination(filtered, 50);

  const crearGrupoHerr = async (titulo, items) => {
    const nombre = (titulo || '').trim();
    if (!nombre || !items?.length || varBusy) return;
    setVarBusy(true);
    try {
      const padre = await createHerr({ obra_id: obraId, nombre_herramienta: nombre, tipo_herramienta: items[0]?.tipo_herramienta || 'manual', estado_actual: 'bueno', ubicacion_actual: 'almacen', disponible: true, maneja_cantidad: true, unidad: items[0]?.unidad || 'und', es_grupo: true, stock_actual: 0, stock_minimo: 0, alerta: 'ok' });
      for (const it of items) await updateHerr(it.id, { padre_id: padre.id });
      setExpandedGroups(s => new Set(s).add(padre.id));
      showToast(`✓ "${nombre}" con ${items.length} variantes`, 'green'); setGrupoModal(null); refresh?.();
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); } finally { setVarBusy(false); }
  };
  const agregarAGrupoHerr = async (grupo, items) => {
    try { for (const it of items) await updateHerr(it.id, { padre_id: grupo.id }); setExpandedGroups(s => new Set(s).add(grupo.id)); showToast(`✓ ${items.length} agregado(s) a "${grupo.nombre_herramienta}"`, 'green'); refresh?.(); }
    catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };
  const eliminarGrupoHerr = async (g) => {
    const hijos = variantesDe(g);
    if (!confirm(`¿Deshacer el grupo "${g.nombre_herramienta}"? Sus ${hijos.length} variantes vuelven a sueltas.`)) return;
    try { for (const h of hijos) await updateHerr(h.id, { padre_id: null }); await updateHerr(g.id, { deleted_at: new Date().toISOString() }); showToast('Grupo deshecho', 'amber'); refresh?.(); }
    catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };
  const fusionarDupHerr = async () => {
    if (!dupModal?.survivorId || varBusy) return;
    setVarBusy(true);
    try {
      const userId = auth?.profile?.id ?? 'offline';
      const dupIds = dupModal.grupo.items.map(i => i.id).filter(id => id !== dupModal.survivorId);
      const r = await fusionarInsumos({ db: window.__db, tabla: 'herramientas', movTabla: 'movimientos_herramientas', fk: 'herramienta_id', itemTipoStock: 'herramienta', userId, calcAlerta }, dupModal.survivorId, dupIds);
      showToast(`✓ Fusionado · ${r.movidos} movimientos · stock ${r.stockFinal}`, 'green'); setDupModal(null); refresh?.();
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); } finally { setVarBusy(false); }
  };

  // Fila de herramienta (ítem suelto o variante anidada).
  const filaHerr = (h, esHijo) => {
    const e = ESTADO_STYLE[h.estado_actual] || ESTADO_STYLE.bueno;
    const u = UBIC_STYLE[h.ubicacion_actual] || UBIC_STYLE.almacen;
    const resp = personal.find(p => p.id === h.ultimo_responsable_id);
    const ubicCat = h.ubicacion_id ? ubicacionesByIdH.get(h.ubicacion_id) : null;
    return (
      <tr key={h.id} style={esHijo ? { background: 'rgba(255,255,255,0.015)' } : undefined}>
        <td className="col-p" style={esHijo ? { paddingLeft: 26 } : undefined}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            {esHijo && <span style={{ color:'var(--tm)' }}>└</span>}
            <FotoInsumoCell obraId={obraId} tipoEvidencia="foto_herramienta" modulo="herramientas"
              registroId={h.id} nombre={h.nombre_herramienta} foto={fotosCatMap.get(h.id)}
              canFoto={canFoto} userId={userId} showToast={showToast}/>
            <div>
              <div>{h.nombre_herramienta}</div>
              {ubicCat && <div style={{ fontSize:10.5, color: ubicCat.activo === false ? 'var(--tm)' : 'var(--amber)', marginTop:2 }}>📍 {ubicCat.nombre}{ubicCat.activo === false ? ' (inactiva)' : ''}</div>}
            </div>
          </div>
        </td>
        <td><span className="tag">{h.tipo_herramienta?.replace('_',' ') || '—'}</span></td>
        <td className="col-m">{[h.marca, h.modelo].filter(Boolean).join(' ') || '—'}</td>
        <td><span className={`badge ${e.class}`}>{e.label}</span></td>
        <td><span className={`badge ${u.class}`}>{u.label}</span></td>
        <td>{h.maneja_cantidad
          ? (() => {
              const st = Number(h.stock_actual ?? 0);
              const cls = (h.alerta === 'agotado' || h.alerta === 'critico') ? 'b-red'
                : (h.alerta === 'reponer' || h.alerta === 'cerca') ? 'b-amber' : 'b-green';
              const em = estadosMap.get(h.id);
              const resumen = em ? ESTADOS_COND.filter(e => Number(em.get(e.key) || 0) > 0) : [];
              return (
                <span style={{ display:'inline-flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                  <span className={`badge ${cls}`} title={`Stock por cantidad${h.stock_minimo ? ` · mín ${h.stock_minimo}` : ''}`}>{st.toLocaleString('es-PE')} {h.unidad || 'und'}</span>
                  <button className="btn btn-ghost btn-xs" title="Ver stock por ubicación" onClick={()=>setPopupHerr(h)}><JxIcon name="map" size={11}/></button>
                  <button className="btn btn-ghost btn-xs" title="Condición / estado de las unidades (nuevo, bueno, reparar, baja)" onClick={()=>setEstadosItem(h)}><JxIcon name="layers" size={11}/></button>
                  {resumen.length > 0 && (
                    <span style={{ display:'inline-flex', gap:3 }} title="Distribución por condición">
                      {resumen.map(e => <span key={e.key} className={`badge ${e.badge}`} style={{ fontSize:9, padding:'0 4px' }}>{e.label[0]}{Number(em.get(e.key) || 0)}</span>)}
                    </span>
                  )}
                </span>
              );
            })()
          : (h.disponible ? <span className="badge b-green">Sí</span> : <span className="badge b-gray">No</span>)}</td>
        <td className="col-m">{h.fecha_ultimo_movimiento || '—'}{resp ? ` · ${resp.nombres}` : ''}</td>
        <td>{h.sync_status && h.sync_status !== 'synced'
          ? <span className="badge b-amber">⏱</span>
          : <span style={{color:'var(--green)',fontSize:11}}>✓</span>}</td>
        <td style={{textAlign:'center', whiteSpace:'nowrap'}}>
          <button className="btn btn-ghost btn-xs" title="Historial de precios" onClick={()=>setHistPrecioItem(h)} style={{ marginRight:4 }}>
            <JxIcon name="dollar" size={11}/>
          </button>
          {/* Editar campos del catálogo = SOLO admin. El almacenero (no-admin)
              usa "Solicitar cambio". La FOTO sí es libre (FotoInsumoCell en la
              celda de nombre, permiso de Evidencias). */}
          {isAdmin ? (
            <>
              <button className="btn btn-ghost btn-xs" title="Editar herramienta" onClick={()=>openEditHerr(h)}>
                <JxIcon name="edit" size={11}/>
              </button>
              {canDelete && (
                <button className="btn btn-red btn-xs" title="Eliminar (solo modo edición)" onClick={()=>handleDeleteHerr(h)} style={{ marginLeft:4 }}>
                  <JxIcon name="trash" size={11}/>
                </button>
              )}
            </>
          ) : (
            <button className="btn btn-ghost btn-xs" title="Solicitar cambio" onClick={()=>setRequestTarget(h)}>
              <JxIcon name="alert" size={11}/>
            </button>
          )}
        </td>
      </tr>
    );
  };

  const enUso = herramientas?.filter(h => h.ubicacion_actual === 'en_uso').length ?? 0;
  const disponibles = herramientas?.filter(h => h.disponible).length ?? 0;

  // ── Categorización por IA (Claude vía /api/categorize) ──
  const [iaModalH, setIaModalH] = uS(null); // null | 'running' | 'preview'
  const [iaResultsH, setIaResultsH] = uS([]);
  const [iaProgressH, setIaProgressH] = uS({ current:0, total:0 });

  const ejecutarCategorizacionIAH = async () => {
    if (!herramientas || !herramientas.length) {
      showToast('No hay herramientas para categorizar', 'red');
      return;
    }
    const aClasificar = herramientas.filter(h => h.tipo_herramienta === 'maquinaria_liviana');
    if (!aClasificar.length) {
      showToast('Todas las herramientas ya tienen un tipo específico', 'amber');
      return;
    }
    setIaModalH('running');
    setIaProgressH({ current:0, total: aClasificar.length });

    // Batches grandes en paralelo
    const BATCH = 100;
    const PARALLEL = 6;
    const chunks = [];
    for (let i = 0; i < aClasificar.length; i += BATCH) {
      chunks.push(aClasificar.slice(i, i + BATCH));
    }
    const all = [];
    let errorMsg = null;
    let completados = 0;

    const procesarChunk = async (chunk) => {
      try {
        const { apiFetch } = await import('../lib/api-client');
        const resp = await apiFetch('/api/categorize', {
          method: 'POST',
          timeout: 60000,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'herramienta',
            items: chunk.map(h => ({ id: h.id, nombre: h.nombre_herramienta })),
          }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        all.push(...(data.results || []));
        completados += chunk.length;
        setIaProgressH({ current: Math.min(completados, aClasificar.length), total: aClasificar.length });
      } catch (e) { if (!errorMsg) errorMsg = e.message; }
    };

    let nextIdx = 0;
    const workers = Array(Math.min(PARALLEL, chunks.length)).fill(0).map(async () => {
      while (nextIdx < chunks.length && !errorMsg) {
        const myIdx = nextIdx++;
        await procesarChunk(chunks[myIdx]);
      }
    });
    await Promise.all(workers);

    if (errorMsg) {
      setIaModalH(null);
      showToast('Error IA: ' + errorMsg, 'red');
      return;
    }

    const cambios = all.map(r => {
      const h = herramientas.find(x => x.id === r.id);
      return h ? {
        id: h.id, nombre: h.nombre_herramienta,
        actual: h.tipo_herramienta,
        nuevo: r.categoria,
      } : null;
    }).filter(c => c && c.actual !== c.nuevo);

    setIaResultsH(cambios);
    setIaModalH('preview');
  };

  const aplicarCategorizacionIAH = async () => {
    if (!iaResultsH || !iaResultsH.length) {
      showToast('No hay cambios para aplicar', 'amber');
      return;
    }
    const now = new Date().toISOString();
    const userId = auth?.profile?.id ?? 'offline';

    let herramientasFresh;
    try {
      herramientasFresh = await window.__db.herramientas.toArray();
    } catch (e) {
      console.error('[IA Herr] No se pudo leer DB:', e);
      showToast('Error leyendo herramientas: ' + (e.message||e), 'red');
      return;
    }
    const byId = new Map(herramientasFresh.map(h => [h.id, h]));

    const records = [];
    let saltados = 0;
    for (const c of iaResultsH) {
      const h = byId.get(c.id);
      if (!h) { saltados++; continue; }
      if (h.tipo_herramienta === c.nuevo) { saltados++; continue; }
      records.push({
        ...h,
        tipo_herramienta: c.nuevo,
        updated_at: now,
        updated_by: userId,
        version: (h.version ?? 0) + 1,
        sync_status: h.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
    }

    if (!records.length) {
      showToast(`Nada que aplicar · ${saltados} sin cambios`, 'amber');
      setIaModalH(null);
      setIaResultsH([]);
      return;
    }

    try {
      await window.__db.herramientas.bulkPut(records);
    } catch (e) {
      console.error('[IA Herr] bulkPut fallo:', e);
      showToast('Error al guardar: ' + (e.message||e), 'red');
      return;
    }

    setTimeout(() => {
      Promise.all(records.map(r => {
        const orig = byId.get(r.id);
        return window.__logAudit?.({
          action:'update', table:'herramientas', recordId: r.id,
          oldData:{ tipo_herramienta: orig?.tipo_herramienta },
          newData:{ tipo_herramienta: r.tipo_herramienta },
          reason:'Categorización IA (Claude)',
        }).catch(() => {});
      }));
    }, 0);

    try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'herramientas' } })); } catch {}
    try { window.dispatchEvent(new Event('online')); } catch {}

    showToast(`${records.length} herramientas categorizadas${saltados ? ` · ${saltados} sin cambios` : ''}`, 'green');
    setIaModalH(null);
    setIaResultsH([]);
  };

  const ESTADO_STYLE = {
    nuevo:          { class:'b-green',  label:'Nuevo' },
    bueno:          { class:'b-green',  label:'Bueno' },
    regular:        { class:'b-yellow', label:'Regular' },
    malo:           { class:'b-red',    label:'Malo' },
    mantenimiento:  { class:'b-orange', label:'Mantenimiento' },
    inhabilitado:   { class:'b-gray',   label:'Inhabilitado' },
    baja:           { class:'b-gray',   label:'Baja' },
  };
  const UBIC_STYLE = {
    almacen:        { class:'b-blue',   label:'En Almacén' },
    en_uso:         { class:'b-amber',  label:'En Uso' },
    mantenimiento:  { class:'b-orange', label:'Mantenimiento' },
    perdida:        { class:'b-red',    label:'Pérdida' },
    baja:           { class:'b-gray',   label:'Baja' },
  };

  const openEditHerr = (h) => {
    setForm({
      nombre_herramienta: h.nombre_herramienta || '',
      tipo_herramienta: h.tipo_herramienta || 'manual',
      marca: h.marca || '',
      modelo: h.modelo || '',
      serie: h.serie || '',
      estado_actual: h.estado_actual || 'bueno',
      ubicacion_id: h.ubicacion_id || '',
      stock_minimo: h.stock_minimo ?? '',
      precio_unitario_estimado: h.precio_unitario_estimado ?? '',
      fecha_registro: (h.created_at || '').slice(0, 10),
    });
    setEditingId(h.id);
    setModal('editar');
    if (foto?.url) try { URL.revokeObjectURL(foto.url); } catch {}
    setFoto(null);
  };

  const handleFotoChangeHerr = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Solo imágenes', 'red'); return; }
    if (file.size > 8 * 1024 * 1024) { showToast('La foto supera 8 MB', 'red'); return; }
    if (foto?.url) try { URL.revokeObjectURL(foto.url); } catch {}
    setFoto({ blob: file, url: URL.createObjectURL(file) });
  };

  const closeModalHerr = () => {
    if (foto?.url) try { URL.revokeObjectURL(foto.url); } catch {}
    setFoto(null);
    setModal(null);
    setEditingId(null);
    setForm({});
  };

  const handleDeleteHerr = async (h) => {
    if (!canDelete) return;
    if (!confirm(`¿Eliminar la herramienta "${h.nombre_herramienta}"?\n\nEsta acción se sincronizará al servidor.`)) return;
    try {
      await updateHerr(h.id, { deleted_at: new Date().toISOString() });
      try { await window.__logAudit?.({ action:'delete', table:'herramientas', recordId:h.id, oldData:h, reason:'Eliminación manual (modo edición)' }); } catch(e) {}
      showToast(`Herramienta "${h.nombre_herramienta}" eliminada`, 'amber');
    } catch (e) { showToast('Error al eliminar: ' + (e.message||e), 'red'); }
  };

  const handleSubmitHerr = async () => {
    if (busyHerr) return; // doble click guard
    if (!form.nombre_herramienta) {
      showToast('Falta nombre', 'red');
      return;
    }
    setBusyHerr(true);
    try {
      let herramientaId = editingId;
      if (editingId) {
        const oldData = herramientas.find(h => h.id === editingId);
        const precioAnterior = Number(oldData?.precio_unitario_estimado || 0);
        const precioNuevo = form.precio_unitario_estimado === '' || form.precio_unitario_estimado == null
          ? null : parseFloat(form.precio_unitario_estimado);
        const newFields = {
          nombre_herramienta: form.nombre_herramienta,
          tipo_herramienta: form.tipo_herramienta || 'manual',
          marca: form.marca || null,
          modelo: form.modelo || null,
          serie: form.serie || null,
          estado_actual: form.estado_actual || 'bueno',
          ubicacion_id: form.ubicacion_id || null,
          stock_minimo: Number(form.stock_minimo || 0),
          precio_unitario_estimado: precioNuevo,
          padre_id: form.padre_id || null,
        };
        if (superAdmin && form.fecha_registro && form.fecha_registro !== (oldData?.created_at || '').slice(0, 10)) {
          newFields.created_at = new Date(form.fecha_registro + 'T12:00:00').toISOString();
        }
        await updateHerr(editingId, newFields);
        try { await window.__logAudit?.({ action:'update', table:'herramientas', recordId:editingId, oldData, newData:newFields }); } catch(e) {}
        // Historial de precios (solo si cambió y hay precio nuevo > 0)
        try {
          const registrado = await registrarSoloHistorial({
            itemTipo: 'herramienta', itemId: editingId, obraId,
            precioAnterior, precioNuevo,
            fuente: 'manual', motivo: 'Edición manual del precio',
            // demo-ness sigue al ítem (no al modo global): editar una herramienta
            // real sincroniza aunque estemos en prueba, y el historial igual.
            userId: auth?.profile?.id ?? 'offline',
            esDemo: oldData?.demo === true,
          });
          if (registrado) window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'insumo_precios_historial' } }));
        } catch (e) { console.error('[herr historial precio]', e); }
        showToast(`Herramienta "${form.nombre_herramienta}" actualizada`, 'green');
      } else {
        const created = await createHerr({
          obra_id: obraId,
          nombre_herramienta: form.nombre_herramienta,
          tipo_herramienta: form.tipo_herramienta || 'manual',
          marca: form.marca || null,
          modelo: form.modelo || null,
          serie: form.serie || null,
          estado_actual: form.estado_actual || 'bueno',
          ubicacion_actual: 'almacen',
          // Crear una herramienta = solo el catálogo. El almacén (ubicación)
          // se define al registrar su INGRESO, no acá. Toda herramienta nueva
          // se maneja por cantidad → entra al flujo unificado de movimientos
          // (antes quedaban "serializadas" y no aparecían para ingreso/salida).
          ubicacion_id: null,
          disponible: true,
          maneja_cantidad: true,
          unidad: form.unidad || 'Und',
          stock_actual: 0,
          stock_minimo: Number(form.stock_minimo || 0),
          precio_unitario_estimado: form.precio_unitario_estimado === '' || form.precio_unitario_estimado == null
            ? null : parseFloat(form.precio_unitario_estimado),
          alerta: 'ok',
          padre_id: form.padre_id || null,
        });
        herramientaId = created?.id;
        try { await window.__logAudit?.({ action:'insert', table:'herramientas', recordId:created?.id, newData:created }); } catch(e) {}
        showToast(`Herramienta "${form.nombre_herramienta}" creada`, 'green');
      }
      // Foto referencial (opcional)
      if (foto?.blob && herramientaId) {
        try {
          await window.__saveEvidenciaLocal?.({
            id: window.__newId(),
            obra_id: obraId,
            tipo_evidencia: 'foto_herramienta',
            modulo_relacionado: 'herramientas',
            registro_relacionado_id: herramientaId,
            nombre_archivo: foto.blob.name || `herramienta_${herramientaId}.jpg`,
            mime_type: foto.blob.type || 'image/jpeg',
            blob: foto.blob,
            observaciones: `Foto referencial · ${form.nombre_herramienta}`,
            fecha: new Date().toISOString().slice(0, 10),
            created_by: auth?.profile?.id || null,
          });
        } catch (e) {
          showToast('Herramienta guardada, pero la foto falló: ' + (e?.message || e), 'amber');
        }
      }
      closeModalHerr();
    } catch (e) {
      showToast('Error: ' + e.message, 'red');
    } finally {
      setBusyHerr(false);
    }
  };

  if (!obraId) return <SinObraEmpty icon="tool"/>;
  if (loading) {
    return <div className="page-wrap"><div className="empty-state"><JxIcon name="tool" size={32} color="var(--tm)"/><p>Cargando herramientas…</p></div></div>;
  }

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Herramientas</div>
          <div className="pg-sub">{herramientas.length} herramientas · {enUso} fuera de almacén · {disponibles} en almacén</div>
        </div>
        <div style={{display:'flex',gap:8, flexWrap:'wrap'}}>
          {isAdmin && (
            <button className="btn btn-ghost btn-sm" onClick={ejecutarCategorizacionIAH}
              title="Usa Claude IA para clasificar herramientas por tipo (manual/eléctrica/maquinaria/medición/seguridad)">
              <JxIcon name="settings" size={13}/>Categorizar con IA
            </button>
          )}
          {/* Flujo UNIFICADO: un solo botón por acción, sirve para 1 o varias
              herramientas (cualquiera, no solo "por cantidad"). */}
          {canWriteMov && <button className="btn btn-green btn-sm" onClick={()=>openLoteCant('ingreso')} title="Ingreso de herramientas (compra / llegada a almacén)"><JxIcon name="arrowIn" size={13}/>Registrar Ingreso</button>}
          {canWriteMov && <button className="btn btn-ghost btn-sm" onClick={()=>openLoteCant('salida')} title="Salida de herramientas (entrega a responsable)"><JxIcon name="arrowOut" size={13}/>Registrar Salida</button>}
          {canWriteMov && <button className="btn btn-blue btn-sm" onClick={()=>openLoteCant('devolucion')} title="Devolución de herramientas que están fuera de almacén"><JxIcon name="arrowIn" size={13}/>Registrar Devolución</button>}
          {canWriteMov && ubicacionesActivasH.length >= 2 && <button className="btn btn-ghost btn-sm" onClick={()=>{ setTraspasoPreIdH(''); setModal('traspaso-herr'); }} title="Mover stock entre almacenes"><JxIcon name="compare" size={13}/>Traspaso</button>}
          {canWrite ? (
            <button className="btn btn-amber btn-sm" onClick={()=>{setForm({}); setModal('nuevo');}}><JxIcon name="plus" size={13}/>Nueva Herramienta</button>
          ) : (
            <span className="badge b-gray" title="Tu rol es solo lectura para Herramientas">Solo lectura</span>
          )}
        </div>
      </div>

      <div style={{display:'flex',gap:8,marginBottom:14}}>
        <div className="search-bar"><JxIcon name="search" size={14} color="var(--tm)"/><input placeholder="Buscar herramienta…" value={q} onChange={e=>setQ(e.target.value)}/></div>
      </div>

      {/* Sugerencias de agrupación + duplicados: DESPLEGABLE (antes eran N
          banners que invadían la pantalla — pedido de Gabriel). */}
      {isAdmin && (() => {
        const sugsVivas = sugerencias.filter(s => !descartadas.has(s.clave));
        const dupsVivos = dups.filter(d => !descartadas.has('dup-' + d.clave));
        if (!sugsVivas.length && !dupsVivos.length) return null;
        return (
          <div className="card card-p" style={{ marginBottom: 12, border: '1px solid rgba(245,158,11,0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setSugerenciasOpen(v => !v)} role="button">
              <span style={{ fontSize: 12.5, color: 'var(--ts)', flex: 1 }}>
                💡 <strong>{sugsVivas.length}</strong> sugerencia(s) de agrupación
                {dupsVivos.length > 0 && <> · ⚠ <strong style={{ color: 'var(--red)' }}>{dupsVivos.length}</strong> posible(s) duplicado(s)</>}
              </span>
              <button className="btn btn-ghost btn-xs">{sugerenciasOpen ? 'Ocultar ▴' : 'Ver ▾'}</button>
            </div>
          </div>
        );
      })()}
      {isAdmin && sugerenciasOpen && sugerencias.filter(s => !descartadas.has(s.clave)).map(s => (
        <div key={'sug-'+s.clave} className="card card-p" style={{ marginBottom:12, background:'rgba(245,158,11,0.07)', border:'1px solid rgba(245,158,11,0.3)', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <div style={{ flex:'1 1 320px', fontSize:12.5, color:'var(--ts)' }}>
            {s.tipo === 'add'
              ? <>💡 <strong>{s.items.length} herramienta(s)</strong> suelta(s) parecen variantes de <strong>“{s.grupo.nombre_herramienta}”</strong>. ¿Las agregás a ese grupo?</>
              : <>💡 <strong>{s.items.length} herramientas</strong> empiezan con <strong>“{s.titulo}”</strong>. ¿Las agrupás como variantes?</>}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            {s.tipo === 'add'
              ? <button className="btn btn-amber btn-sm" onClick={()=>agregarAGrupoHerr(s.grupo, s.items)}><JxIcon name="layers" size={13}/> Agregar a {s.grupo.nombre_herramienta}</button>
              : <button className="btn btn-amber btn-sm" onClick={()=>setGrupoModal({ titulo:s.titulo, items:s.items })}><JxIcon name="layers" size={13}/> Agrupar</button>}
            <button className="btn btn-ghost btn-sm" onClick={()=>setDescartadas(d=>new Set(d).add(s.clave))}>Ahora no</button>
          </div>
        </div>
      ))}
      {/* Revisión de duplicados */}
      {isAdmin && sugerenciasOpen && dups.filter(d => !descartadas.has('dup-'+d.clave)).map(d => (
        <div key={'dup-'+d.clave} className="card card-p" style={{ marginBottom:12, background:'rgba(239,68,68,0.07)', border:'1px solid rgba(239,68,68,0.3)', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <div style={{ flex:'1 1 320px', fontSize:12.5, color:'var(--ts)' }}>⚠ <strong>{d.items.length} herramientas</strong> con el mismo nombre <strong>“{d.nombre}”</strong> (probable duplicado). Conviene fusionarlas.</div>
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn btn-red btn-sm" onClick={()=>setDupModal({ grupo:d, survivorId:d.items[0].id })}><JxIcon name="compare" size={13}/> Fusionar</button>
            <button className="btn btn-ghost btn-sm" onClick={()=>setDescartadas(s=>new Set(s).add('dup-'+d.clave))}>Ahora no</button>
          </div>
        </div>
      ))}

      {herramientas.length === 0 ? (
        <div className="card card-p empty-state"><JxIcon name="tool" size={40} color="var(--tm)"/><p>No hay herramientas registradas. Click en "Nueva Herramienta".</p></div>
      ) : (
      <div className="card" style={{overflow:'hidden'}}>
        <div style={{overflowX:'auto'}}>
          <table className="tbl">
            <thead><tr>
              <th>Herramienta</th><th>Tipo</th><th>Marca / Modelo</th><th>Estado</th>
              <th>Ubicación</th><th>Disponible / Stock</th><th>Últ. Movimiento</th><th>Sync</th>
              <th style={{textAlign:'center'}}>Acciones</th>
            </tr></thead>
            <tbody>
              {herrPg.pagedItems.map(h => {
                if (!h.es_grupo) return filaHerr(h, false);
                const hijos = variantesDe(h);
                const hijosVis = q ? hijos.filter(matchHerr) : hijos;
                const abierto = expandedGroups.has(h.id);
                return (
                  <React.Fragment key={h.id}>
                    <tr style={{ background:'rgba(245,158,11,0.06)', cursor:'pointer' }} onClick={()=>toggleGroup(h.id)}>
                      <td className="col-p"><span style={{color:'var(--amber)',marginRight:6,fontWeight:700}}>{abierto?'▾':'▸'}</span><strong>{h.nombre_herramienta}</strong> <span className="badge b-amber" style={{marginLeft:6}}>{hijos.length} variantes</span></td>
                      <td><span className="tag">{h.tipo_herramienta?.replace('_',' ') || '—'}</span></td>
                      <td className="col-m">—</td>
                      <td>—</td>
                      <td>—</td>
                      <td><span className="badge b-green" title="Total de las variantes">{stockDeNodo(h).toLocaleString('es-PE')} {h.unidad || 'und'}</span></td>
                      <td className="col-m">—</td>
                      <td>{h.sync_status && h.sync_status !== 'synced' ? <span className="badge b-amber">⏱</span> : <span style={{color:'var(--green)',fontSize:11}}>✓</span>}</td>
                      <td style={{textAlign:'center', whiteSpace:'nowrap'}}>
                        {isAdmin && <button className="btn btn-ghost btn-xs" title="Renombrar grupo" onClick={(ev)=>{ev.stopPropagation(); openEditHerr(h);}}><JxIcon name="edit" size={11}/></button>}
                        {isAdmin && canDelete && <button className="btn btn-red btn-xs" title="Deshacer grupo" onClick={(ev)=>{ev.stopPropagation(); eliminarGrupoHerr(h);}} style={{ marginLeft:4 }}><JxIcon name="trash" size={11}/></button>}
                      </td>
                    </tr>
                    {abierto && hijosVis.map(hh => filaHerr(hh, true))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <TablePagination {...herrPg} />
      </div>
      )}

      {/* Modal IA Herramientas: corriendo */}
      {iaModalH === 'running' && (
        <Modal title="Categorizando con IA…" icon="settings" onClose={()=>{}}>
          <div style={{ textAlign:'center', padding:'18px 8px' }}>
            <div style={{ display:'inline-block', width:24, height:24, borderRadius:'50%', border:'3px solid rgba(242,183,5,0.3)', borderTopColor:'var(--amber)', animation:'spin .8s linear infinite' }}/>
            <div style={{ fontSize:13, color:'var(--ts)', marginTop:14, marginBottom:6 }}>
              Claude está analizando los nombres y asignando tipo.
            </div>
            <div style={{ fontSize:11.5, color:'var(--tm)', marginBottom:10 }}>
              {iaProgressH.current} / {iaProgressH.total} herramientas procesadas
            </div>
            <div style={{ width:'100%', height:8, background:'var(--bg-c)', borderRadius:4, overflow:'hidden' }}>
              <div style={{ width:`${iaProgressH.total ? (iaProgressH.current/iaProgressH.total*100) : 0}%`, height:'100%', background:'var(--amber)', transition:'width .2s' }}/>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal IA Herramientas: preview */}
      {iaModalH === 'preview' && iaResultsH.length > 0 && (
        <Modal title="Categorización IA — preview" icon="settings" onClose={()=>{ setIaModalH(null); setIaResultsH([]); }} wide>
          <div style={{ fontSize:12.5, color:'var(--ts)', marginBottom:12 }}>
            Claude propone <strong>{iaResultsH.length} cambios de tipo</strong>. Revisa antes de aplicar.
          </div>
          <div className="card" style={{ overflow:'auto', maxHeight:400, marginBottom:12 }}>
            <table className="tbl" style={{ fontSize:11 }}>
              <thead><tr><th>Herramienta</th><th>Actual</th><th>Sugerido</th></tr></thead>
              <tbody>
                {iaResultsH.slice(0, 200).map(c => (
                  <tr key={c.id}>
                    <td className="col-p">{c.nombre}</td>
                    <td className="col-m"><span className="tag">{c.actual}</span></td>
                    <td className="col-m"><span className="badge b-amber">{c.nuevo}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>{ setIaModalH(null); setIaResultsH([]); }}>Cancelar</button>
            <button className="btn btn-amber" onClick={aplicarCategorizacionIAH}>
              <JxIcon name="check" size={13}/> Aplicar {iaResultsH.length} cambios
            </button>
          </div>
        </Modal>
      )}

      {/* Modal Nueva / Editar Herramienta */}
      {(modal==='nuevo' || modal==='editar') && <Modal title={editingId ? 'Editar Herramienta' : 'Nueva Herramienta'} icon="tool" onClose={closeModalHerr}>
        <div className="g2">
          <div style={{gridColumn:'1/-1'}}><label className="flabel">Nombre *</label><input className="fi" placeholder="Ej: Amoladora 7&quot;" value={form.nombre_herramienta||''} onChange={e=>setForm({...form, nombre_herramienta:e.target.value})}/></div>
          <div><label className="flabel">Tipo</label>
            <select className="fi" value={form.tipo_herramienta||''} onChange={e=>setForm({...form, tipo_herramienta:e.target.value})}>
              <option value="manual">Manual</option><option value="electrica">Eléctrica</option>
              <option value="maquinaria_liviana">Maquinaria Liviana</option><option value="maquinaria_pesada">Maquinaria Pesada</option>
              <option value="medicion">Medición</option><option value="seguridad">Seguridad</option>
            </select>
          </div>
          <div><label className="flabel">Estado actual</label>
            <select className="fi" value={form.estado_actual||''} onChange={e=>setForm({...form, estado_actual:e.target.value})}>
              <option value="nuevo">Nuevo</option><option value="bueno">Bueno</option>
              <option value="regular">Regular</option><option value="malo">Malo</option>
            </select>
          </div>
          <div><label className="flabel">Marca</label><input className="fi" placeholder="Ej: Bosch" value={form.marca||''} onChange={e=>setForm({...form, marca:e.target.value})}/></div>
          <div><label className="flabel">Modelo</label><input className="fi" placeholder="Ej: GA7020" value={form.modelo||''} onChange={e=>setForm({...form, modelo:e.target.value})}/></div>
          {!form.es_grupo && (
            <div><label className="flabel">Grupo (variante de)</label>
              <select className="fi" value={form.padre_id || ''} onChange={e=>setForm({...form, padre_id: e.target.value || null})}>
                <option value="">— Ítem suelto —</option>
                {(herramientas||[]).filter(g => g.es_grupo && !g.deleted_at && g.id !== editingId).map(g => <option key={g.id} value={g.id}>{g.nombre_herramienta}</option>)}
              </select>
            </div>
          )}
          <div><label className="flabel">N° Serie</label><input className="fi" placeholder="Ej: BS-2024-001" value={form.serie||''} onChange={e=>setForm({...form, serie:e.target.value})}/></div>
          <div><label className="flabel">Stock mínimo (alerta)</label><input className="fi" type="number" min="0" step="1" placeholder="0" value={form.stock_minimo ?? ''} onChange={e=>setForm({...form, stock_minimo:e.target.value})}/></div>
          <div><label className="flabel">Precio estimado (S/)</label><input className="fi" type="number" min="0" step="0.01" placeholder="0.00" value={form.precio_unitario_estimado ?? ''} onChange={e=>setForm({...form, precio_unitario_estimado:e.target.value})}/></div>
          <div style={{gridColumn:'1/-1', fontSize:11, color:'var(--tm)', background:'rgba(52,152,219,0.06)', border:'1px solid rgba(52,152,219,0.2)', borderRadius:6, padding:'8px 10px' }}>
            <JxIcon name="info" size={12} color="var(--blue)"/> El <strong>almacén</strong> de la herramienta se define al registrar su <strong>Ingreso</strong>, no acá. Esto es solo el catálogo.
          </div>
          {/* Foto referencial (opcional) — sube como evidencia */}
          {(() => {
            const fotoExistente = editingId ? fotosMap.get(editingId) : null;
            const tieneNueva = !!foto?.url;
            const tieneExistente = !!fotoExistente?.url && !tieneNueva;
            const labelBoton = tieneNueva
              ? 'Cambiar la nueva foto'
              : (fotoExistente ? 'Reemplazar foto guardada' : 'Adjuntar foto');
            return (
              <div style={{ gridColumn:'1/-1' }}>
                <label className="flabel">
                  Foto de la herramienta {fotoExistente && !tieneNueva && (
                    <span style={{ fontSize:11, color:'var(--green)', fontWeight:500 }}> · ya tiene foto</span>
                  )}
                </label>
                <div style={{ display:'flex', gap:10, alignItems:'flex-start', flexWrap:'wrap' }}>
                  <label className="btn btn-ghost btn-sm" style={{ cursor:'pointer' }}>
                    <JxIcon name="camera" size={13}/> {labelBoton}
                    <input type="file" accept="image/*" capture="environment" style={{ display:'none' }}
                           onChange={handleFotoChangeHerr}/>
                  </label>
                  {tieneNueva && (
                    <div style={{ position:'relative' }}>
                      <img src={foto.url} alt="nueva foto" style={{ width:80, height:80, objectFit:'cover', borderRadius:6, border:'2px solid var(--green)' }}/>
                      <div style={{ position:'absolute', bottom:-8, left:0, right:0, textAlign:'center', fontSize:9, color:'var(--green)', fontWeight:600 }}>NUEVA</div>
                      <button type="button" onClick={() => { if (foto.url) try { URL.revokeObjectURL(foto.url); } catch {} setFoto(null); }}
                        style={{ position:'absolute', top:-6, right:-6, width:20, height:20, borderRadius:'50%', background:'var(--red)', color:'white', border:'none', fontSize:11, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}
                        title="Cancelar nueva foto">×</button>
                    </div>
                  )}
                  {tieneExistente && (
                    <div style={{ position:'relative' }}>
                      <img src={fotoExistente.url} alt="foto actual" style={{ width:80, height:80, objectFit:'cover', borderRadius:6, border:'1px solid var(--bd)' }}/>
                      <div style={{ position:'absolute', bottom:-8, left:0, right:0, textAlign:'center', fontSize:9, color:'var(--tm)' }}>ACTUAL</div>
                    </div>
                  )}
                  {!tieneNueva && !fotoExistente && (
                    <span style={{ fontSize:11, color:'var(--tm)', alignSelf:'center' }}>
                      Sin foto. Adjuntá una para identificarla más rápido en obra.
                    </span>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
        {superAdmin && editingId && (
          <div style={{ marginTop:10, padding:'10px 12px', background:'rgba(231,76,60,0.06)', border:'1px solid rgba(231,76,60,0.3)', borderRadius:6 }}>
            <label className="flabel" style={{ color:'#E74C3C' }}>⚡ Fecha de registro (Super Admin)</label>
            <input className="fi" type="date" max={new Date().toISOString().slice(0,10)}
              value={form.fecha_registro || ''}
              onChange={e=>setForm({...form, fecha_registro:e.target.value})}/>
            <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:3 }}>
              Corrige la fecha de creación de la herramienta (created_at).
            </div>
          </div>
        )}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={closeModalHerr} disabled={busyHerr}>Cancelar</button>
          <button className="btn btn-amber" onClick={handleSubmitHerr} disabled={busyHerr}>
            <JxIcon name="check" size={13}/>
            {busyHerr ? 'Guardando…' : (editingId ? 'Guardar Cambios' : 'Crear Herramienta')}
          </button>
        </div>
      </Modal>}

      {/* Modal confirmar agrupación (variantes SKU) */}
      {grupoModal && (
        <Modal title="Agrupar como variantes" icon="layers" onClose={() => setGrupoModal(null)}>
          <div style={{ fontSize: 12.5, color: 'var(--ts)', marginBottom: 12 }}>Se crea el grupo <strong>“{grupoModal.titulo}”</strong> y estas {grupoModal.items.length} herramientas pasan a ser sus variantes.</div>
          <label className="flabel">Nombre del grupo</label>
          <input className="fi" value={grupoModal.titulo} onChange={e => setGrupoModal(g => ({ ...g, titulo: e.target.value }))} />
          <div style={{ maxHeight: 180, overflowY: 'auto', marginTop: 10, border: '1px solid var(--bd)', borderRadius: 6, padding: 8 }}>
            {grupoModal.items.map(it => <div key={it.id} style={{ fontSize: 12, padding: '3px 0', color: 'var(--ts)' }}>• {it.nombre_herramienta}</div>)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={() => setGrupoModal(null)} disabled={varBusy}>Cancelar</button>
            <button className="btn btn-amber" onClick={() => crearGrupoHerr(grupoModal.titulo, grupoModal.items)} disabled={varBusy}><JxIcon name="check" size={13} /> Crear grupo</button>
          </div>
        </Modal>
      )}

      {/* Modal fusionar duplicados */}
      {dupModal && (
        <Modal title="Fusionar herramientas duplicadas" icon="compare" onClose={() => setDupModal(null)}>
          <div style={{ fontSize: 12.5, color: 'var(--ts)', marginBottom: 12 }}>Elegí cuál se queda. Las demás se dan de baja y sus movimientos + stock pasan a la sobreviviente.</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {dupModal.grupo.items.map(it => (
              <label key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid var(--bd)', borderRadius: 6, cursor: 'pointer', background: dupModal.survivorId === it.id ? 'rgba(46,204,113,0.08)' : 'transparent' }}>
                <input type="radio" name="dup-herr" checked={dupModal.survivorId === it.id} onChange={() => setDupModal(m => ({ ...m, survivorId: it.id }))} style={{ accentColor: 'var(--green)' }} />
                <span style={{ flex: 1, fontSize: 12.5 }}>{it.nombre_herramienta}</span>
                <span style={{ fontSize: 11, color: 'var(--tm)' }}>{[it.marca, it.modelo].filter(Boolean).join(' ')}</span>
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={() => setDupModal(null)} disabled={varBusy}>Cancelar</button>
            <button className="btn btn-red" onClick={fusionarDupHerr} disabled={varBusy}><JxIcon name="check" size={13} /> {varBusy ? 'Fusionando…' : 'Fusionar'}</button>
          </div>
        </Modal>
      )}

      {/* Modal de condición/estado (buckets) de una herramienta de cantidad */}
      {estadosItem && (
        <EstadosModal
          itemTipo="herramienta"
          item={estadosItem}
          obraId={obraId}
          userId={auth?.profile?.id ?? 'offline'}
          showToast={showToast}
          onClose={() => setEstadosItem(null)}
          onDone={() => refresh?.()}
        />
      )}

      {histPrecioItem && (
        <PrecioHistorialModal
          itemTipo="herramienta"
          itemId={histPrecioItem.id}
          nombre={histPrecioItem.nombre_herramienta}
          precioActual={histPrecioItem.precio_unitario_estimado}
          onClose={() => setHistPrecioItem(null)}
        />
      )}

      {requestTarget && (
        <RequestChangeModal
          table="herramientas"
          record={requestTarget}
          recordLabel={requestTarget.nombre_herramienta}
          allowDelete
          fields={[
            { key: 'nombre_herramienta', label: 'Nombre' },
            { key: 'marca', label: 'Marca' },
            { key: 'modelo', label: 'Modelo' },
            { key: 'serie', label: 'N° Serie' },
            { key: 'estado_actual', label: 'Estado actual', options: [
              { value: 'nuevo', label: 'Nuevo' }, { value: 'bueno', label: 'Bueno' },
              { value: 'regular', label: 'Regular' }, { value: 'malo', label: 'Malo' },
            ]},
          ]}
          showToast={showToast}
          onClose={() => setRequestTarget(null)}
        />
      )}

      {/* Popup desglose por ubicación (herramientas por cantidad) */}
      {popupHerr && (
        <DesglosePopup
          nombre={popupHerr.nombre_herramienta} unidad={popupHerr.unidad}
          desglose={desgloseUbicH.get(popupHerr.id)} ubicacionesById={ubicacionesByIdH}
          canTraspaso={canWriteMov && ubicacionesActivasH.length >= 2}
          onTraspaso={() => { setTraspasoPreIdH(popupHerr.id); setModal('traspaso-herr'); }}
          onClose={() => setPopupHerr(null)} />
      )}

      {/* Traspaso entre almacenes (herramientas por cantidad) */}
      {modal === 'traspaso-herr' && (
        <TraspasoStockModal
          items={herrCantidad.map(h => ({ id: h.id, nombre: h.nombre_herramienta }))}
          ubicaciones={ubicacionesActivasH} ubicacionesById={ubicacionesByIdH}
          getDesgloseDe={(id) => desgloseUbicH.get(id)}
          itemLabel="Herramienta" preItemId={traspasoPreIdH}
          onClose={() => setModal(null)} onConfirm={ejecutarTraspasoHerr} />
      )}

      {/* Ingreso/Salida por cantidad (lote) */}
      {loteCant && (() => {
        const esSalida = loteCant === 'salida';
        const esDevol = loteCant === 'devolucion';
        // Lista de herramientas según la acción: salida/ingreso = todas;
        // devolución = solo las que están fuera de almacén (En Uso).
        const listaHerr = esDevol ? herrFueraDeAlmacen : herrMovibles;
        const tituloMov = esSalida ? 'Registrar Salida de Herramientas' : esDevol ? 'Registrar Devolución de Herramientas' : 'Registrar Ingreso de Herramientas';
        const labelAlmacen = esSalida ? 'Almacén de origen *' : esDevol ? 'Almacén de retorno *' : 'Almacén de llegada *';
        const mostrarStock = esSalida;
        return (
        <Modal title={tituloMov} icon={esSalida ? 'arrowOut' : 'arrowIn'} onClose={() => setLoteCant(null)} size="xl">
          {esDevol && listaHerr.length === 0 && (
            <div style={{ padding:'12px 14px', marginBottom:12, background:'rgba(242,183,5,0.08)', border:'1px solid rgba(242,183,5,0.3)', borderRadius:8, fontSize:12.5, color:'var(--ts)' }}>
              No hay herramientas marcadas como <strong>fuera de almacén</strong> (En Uso) para devolver. Si una salió pero figura en almacén, registrá primero su Salida.
            </div>
          )}
          <div className="g2">
            <div><label className="flabel">Fecha</label><input className="fi" type="date" max={new Date().toISOString().slice(0,10)} value={loteCantForm.fecha || ''} onChange={e=>setLoteCantForm(f=>({...f, fecha:e.target.value}))}/></div>
            <div><label className="flabel">Hora</label><input className="fi" type="time" value={loteCantForm.hora || ''} onChange={e=>setLoteCantForm(f=>({...f, hora:e.target.value}))}/></div>
            {ubicacionesActivasH.length > 0 && (
              <div><label className="flabel">{labelAlmacen}</label>
                {ubicacionesActivasH.length === 1 ? (
                  <div style={{ fontSize:12.5, color:'var(--tp)', padding:'8px 0' }}>📍 {ubicacionesActivasH[0].nombre} <span style={{ color:'var(--tm)' }}>(único)</span></div>
                ) : (
                  <select className="fi" value={loteCantForm.ubicacion_id || ''} onChange={e=>setLoteCantForm(f=>({...f, ubicacion_id:e.target.value}))}>
                    <option value="">{esSalida ? '— Selecciona origen —' : '— Selecciona almacén —'}</option>
                    {ubicacionesActivasH.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                  </select>
                )}
              </div>
            )}
            {esSalida && (
              <div>
                <label className="flabel">Frente de trabajo *</label>
                <select className="fi" value={frenteSalida} disabled={frentePendiente} onChange={e => setFrenteSalida(e.target.value)}>
                  <option value="">— Sin frente —</option>
                  {(frentes || []).map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
                </select>
                <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:11.5, marginTop:4, color:'var(--tm)' }}>
                  <input type="checkbox" checked={frentePendiente} onChange={e => { setFrentePendiente(e.target.checked); if (e.target.checked) setFrenteSalida(''); }} />
                  No sé el frente todavía — lo completo después (queda marcado como pendiente)
                </label>
              </div>
            )}
            {esSalida && (
              <div><label className="flabel">Destino — persona o subcontrato (opcional)</label>
                <select className="fi" value={loteCantForm.responsable_id || ''} onChange={e=>setLoteCantForm(f=>({...f, responsable_id:e.target.value}))}>
                  <option value="">—</option>
                  {destinoOptsHerr.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select></div>
            )}
          </div>
          {/* Devolución: por defecto la devuelve quien la sacó (columna Responsable
              de cada fila). Si la devuelve otra persona → excepción + motivo. */}
          {esDevol && (
            <div style={{ marginTop:12, padding:'10px 12px', background:'rgba(52,152,219,0.06)', border:'1px solid rgba(52,152,219,0.3)', borderRadius:6 }}>
              <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12.5, color:'var(--tp)', cursor:'pointer' }}>
                <input type="checkbox" checked={!!loteCantForm.es_excepcion}
                  onChange={e => setLoteCantForm(f => ({ ...f, es_excepcion: e.target.checked }))}/>
                <span><strong>La devuelve otra persona</strong> (no el responsable que la sacó)</span>
              </label>
              {loteCantForm.es_excepcion ? (
                <div style={{ marginTop:8 }}>
                  <input className="fi" placeholder="Motivo: ¿por qué la devuelve otra persona? *"
                    value={loteCantForm.motivo_excepcion || ''} onChange={e=>setLoteCantForm(f=>({...f, motivo_excepcion:e.target.value}))}
                    style={{ borderColor:'var(--amber)' }}/>
                  <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:4 }}>Elegí en cada fila quién la devuelve. Queda en auditoría.</div>
                </div>
              ) : (
                <div style={{ fontSize:11, color:'var(--tm)', marginTop:4 }}>Cada herramienta la devuelve automáticamente quien la sacó (se autocompleta).</div>
              )}
            </div>
          )}
          <div style={{ marginTop:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--ts)', marginBottom:6, display:'flex', justifyContent:'space-between' }}>
              <span>Herramientas ({loteCantItems.length})</span>
              <button type="button" className="btn btn-ghost btn-xs" onClick={addLoteCantItem}><JxIcon name="plus" size={11}/> Agregar fila</button>
            </div>
            <div style={{ overflowX:'auto' }}>
              <table className="tbl" style={{ fontSize:12 }}>
                <thead><tr>
                  <th style={{ minWidth:220 }}>Herramienta</th>
                  <th style={{ width:110 }}>Cantidad *</th>
                  {mostrarStock && <th style={{ width:80 }}>Stock</th>}
                  {(esSalida || esDevol) && <th style={{ minWidth:160 }}>{esSalida ? 'Condición (de la que sale)' : 'Condición (en que vuelve)'}</th>}
                  {esDevol && <th style={{ minWidth:170 }}>Quién devuelve *</th>}
                  <th style={{ width:40 }}></th>
                </tr></thead>
                <tbody>
                  {loteCantItems.map(it => {
                    const h = listaHerr.find(x => x.id === it.herramienta_id) || herrMovibles.find(x => x.id === it.herramienta_id);
                    const cant = parseFloat(it.cantidad) || 0;
                    // STOCK a mostrar: en SALIDA es el del ALMACÉN DE ORIGEN
                    // elegido (no el agregado). Antes mostraba el total (ej. "1")
                    // aunque el almacén de origen tuviera 0 → la almacenera creía
                    // que podía sacar y el guardia la rechazaba. Ahora coincide
                    // con lo que valida el guardia (baseSalidaUbicacion, la misma
                    // función de la validación de salida). Ingreso/devolución: total.
                    const ubicSelH = loteCantForm.ubicacion_id || (ubicacionesActivasH.length === 1 ? ubicacionesActivasH[0].id : null);
                    let stockCelda = stockDeHerr(h);
                    let faltaAlmacen = false;
                    if (esSalida && h) {
                      if (!ubicSelH) { faltaAlmacen = true; }
                      else {
                        const dgItem = desgloseUbicH.get(it.herramienta_id);
                        const tieneDg = dgItem && Array.from(dgItem.values()).some(c => Number(c) > 0);
                        stockCelda = tieneDg ? baseSalidaUbicacion(dgItem, ubicSelH, stockDeHerr(h)).base : stockDeHerr(h);
                      }
                    }
                    const stockOk = !faltaAlmacen && stockCelda >= cant;
                    const fuentes = esSalida && it.herramienta_id ? fuentesSalidaHerr(it.herramienta_id) : [];
                    const respAuto = h?.ultimo_responsable_id || '';
                    const respPers = respAuto ? personal?.find(p => p.id === respAuto) : null;
                    return (
                      <tr key={it.id}>
                        <td><SearchableSelect value={it.herramienta_id} onChange={v=>updateLoteCantItem(it.id,{herramienta_id:v, condicion: esDevol ? (it.condicion||'bueno') : ''})} options={[{value:'',label:'— Selecciona —'}, ...listaHerr.map(x=>({value:x.id,label:x.nombre_herramienta}))]} fontSize={12} placeholder="— Selecciona —"/></td>
                        <td><input className="fi" type="number" min="0" step="0.01" value={it.cantidad} style={{ fontSize:12 }} onChange={e=>updateLoteCantItem(it.id,{cantidad:e.target.value})}/></td>
                        {mostrarStock && <td>{h
                          ? (faltaAlmacen
                              ? <span style={{ fontSize:10.5, color:'var(--tm)' }} title="Elegí el almacén de origen para ver cuánto hay disponible ahí">elegí almacén</span>
                              : <span style={{ color: stockOk ? 'var(--green)' : 'var(--red)', fontWeight:600, fontSize:11 }} title={esSalida ? 'Stock en el almacén de origen elegido' : undefined}>{stockOk ? '✓' : '⚠'} {stockCelda}</span>)
                          : '—'}</td>}
                        {esSalida && (
                          <td>
                            {!h ? <span style={{ color:'var(--tm)' }}>—</span>
                              : fuentes.length === 0 ? <span style={{ fontSize:11, color:'var(--tm)' }}>—</span>
                              : fuentes.length === 1 ? (
                                  fuentes[0].key === '_sin'
                                    ? <span style={{ fontSize:11, color:'var(--tm)' }} title="Stock sin clasificar (automático)">Sin clasificar · {fuentes[0].qty}</span>
                                    : <span className={`badge ${fuentes[0].badge}`} title="Única condición con stock (automático)">{fuentes[0].label} · {fuentes[0].qty}</span>
                                )
                              : (
                                <select className="fi" value={it.condicion || ''} style={{ fontSize:12 }} onChange={ev=>updateLoteCantItem(it.id,{condicion:ev.target.value})}>
                                  <option value="">— Elegí de dónde sale —</option>
                                  {fuentes.map(f => <option key={f.key} value={f.key}>{f.label} · {f.qty} disp.</option>)}
                                </select>
                              )}
                          </td>
                        )}
                        {esDevol && (
                          <td>
                            <select className="fi" value={it.condicion || 'bueno'} style={{ fontSize:12 }} onChange={ev=>updateLoteCantItem(it.id,{condicion:ev.target.value})}>
                              {ESTADOS_COND.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}
                            </select>
                          </td>
                        )}
                        {esDevol && (
                          <td>
                            {loteCantForm.es_excepcion
                              ? <SearchableSelect value={it.responsable_id || ''} onChange={v=>updateLoteCantItem(it.id,{responsable_id:v||''})} options={[{value:'',label:'— Quién devuelve —'}, ...destinoOptsHerr]} fontSize={12} placeholder="— Quién devuelve —"/>
                              : respAuto
                                ? <span style={{ fontSize:11.5, color:'var(--ts)' }} title="Quien la sacó (automático)">{respPers ? `${respPers.nombres} ${respPers.apellidos}` : 'Responsable'}</span>
                                : <span style={{ fontSize:11, color:'var(--amber)' }} title="Sin responsable previo — marcá la excepción y elegí quién la devuelve">⚠ marcá excepción</span>}
                          </td>
                        )}
                        <td>{loteCantItems.length > 1 && <button type="button" className="btn btn-ghost btn-xs" onClick={()=>removeLoteCantItem(it.id)} style={{ color:'var(--red)' }}><JxIcon name="x" size={11}/></button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ marginTop:14 }}><label className="flabel">Observaciones</label><textarea className="fi" rows={2} value={loteCantForm.observaciones || ''} onChange={e=>setLoteCantForm(f=>({...f, observaciones:e.target.value}))}/></div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>setLoteCant(null)} disabled={busyLoteCant}>Cancelar</button>
            <button className={`btn ${esSalida ? 'btn-amber' : esDevol ? 'btn-blue' : 'btn-green'}`} onClick={submitLoteCant} disabled={busyLoteCant}>
              {busyLoteCant ? 'Guardando…' : (esSalida ? 'Registrar salida' : esDevol ? 'Registrar devolución' : 'Registrar ingreso')} ({loteCantItems.filter(it=>it.herramienta_id && parseFloat(it.cantidad)>0).length})
            </button>
          </div>
        </Modal>);
      })()}
    </div>
  );
}

// ─── PERSONAL PAGE ──────────────────────────────────────
// Modal de línea de tiempo individual del trabajador (cambios de cargo/frente/estado).
function HistorialPersonalModal({ persona, onClose }) {
  const { data: hist } = window.__hooks.useHistorialPersonal(persona?.id);
  const rows = uM(() => [...(hist || [])].sort((a, b) =>
    String(b.fecha || '').localeCompare(String(a.fecha || '')) || String(b.created_at || '').localeCompare(String(a.created_at || ''))
  ), [hist]);
  const TIPO = {
    alta: { label: 'Alta', cls: 'b-green' }, cargo: { label: 'Cargo', cls: 'b-blue' },
    frente: { label: 'Frente', cls: 'b-amber' }, estado: { label: 'Estado', cls: 'b-gray' },
    subcontrato: { label: 'Subcontrato', cls: 'b-gray' }, area: { label: 'Área', cls: 'b-gray' },
  };
  return (
    <Modal title={`Historial · ${persona?.nombres || ''} ${persona?.apellidos || ''}`.trim()} icon="clock" onClose={onClose}>
      {rows.length === 0 ? (
        <div className="empty-state" style={{ padding: 20 }}><JxIcon name="clock" size={28} color="var(--tm)" /><p style={{ marginTop: 8 }}>Sin cambios registrados todavía. Los cambios de cargo, frente o estado se irán registrando acá.</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map((h, i) => {
            const t = TIPO[h.tipo] || { label: h.tipo, cls: 'b-gray' };
            return (
              <div key={h.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: i < rows.length - 1 ? '1px solid var(--bd)' : 'none', alignItems: 'flex-start' }}>
                <div style={{ minWidth: 84, fontSize: 11, color: 'var(--tm)', fontFamily: 'monospace', paddingTop: 2 }}>{(h.fecha || '').slice(0, 10)}</div>
                <span className={`badge ${t.cls}`}>{t.label}</span>
                <div style={{ fontSize: 12.5, color: 'var(--ts)' }}>
                  {h.tipo === 'alta'
                    ? <>Ingresó como <strong>{h.valor_nuevo || '—'}</strong></>
                    : <><span style={{ color: 'var(--tm)' }}>{h.valor_anterior || '—'}</span> → <strong>{h.valor_nuevo || '—'}</strong></>}
                  {h.motivo && <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 2 }}>{h.motivo}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

function PersonalPage({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const myRol = auth?.profile?.rol;
  const isAdmin = myRol === 'admin';
  const appMode = window.__useAppMode ? window.__useAppMode() : { isPrueba: true };
  const canDelete = isAdmin && (appMode.isEdicion || appMode.isPrueba);
  const canWrite = isAdmin || (window.__hasPerm?.(myRol, 'Personal', 'w') ?? false);
  // SCOPE OBRERO (Gabriel): ing. de seguridad, almacenera y residente gestionan
  // SOLO personal con cargo Peón/Oficial/Operario — no ven al resto del personal.
  const scopeObrero = !isAdmin && rolScopeObrero(myRol);
  // Categorías que ESTE rol ve/gestiona bajo scope: seguridad/almacenera las 3
  // gestionables; el RESIDENTE solo Obrero + Subcontratos (pedido 20-jul).
  const catsScope = uM(() => categoriasParaRol(myRol), [myRol]);
  const superAdminP = !!appMode.superAdmin;
  const [fusionOpen, setFusionOpen] = uS(false);
  // Solicitar un SUBCONTRATO nuevo (pedido 20-jul): seguridad/almacenera piden,
  // el admin lo aprueba y crea (y otro con permisos asigna partidas/ingeniero);
  // después ellas ya pueden vincular personal a ese subcontrato.
  const [subSol, setSubSol] = uS(null); // null | { nombre, alcance, motivo }
  const enviarSolicitudSub = async () => {
    if (!subSol?.nombre?.trim()) { showToast('Poné la razón social del subcontratista', 'red'); return; }
    if (!subSol?.motivo || subSol.motivo.trim().length < 10) { showToast('Contá el motivo (mínimo 10 caracteres)', 'red'); return; }
    try {
      await window.__changeRequests?.create({
        table: 'subcontratos', recordId: null, recordLabel: subSol.nombre.trim(),
        proposedChanges: { __nuevo_subcontrato: { old: null, new: `${subSol.nombre.trim()}${subSol.alcance?.trim() ? ' — ' + subSol.alcance.trim() : ''}` } },
        reason: subSol.motivo.trim(),
      });
      try { await window.__logAudit?.({ action: 'insert', table: 'change_requests', recordId: null, reason: `Solicitud de subcontrato nuevo: ${subSol.nombre.trim()}` }); } catch {}
      showToast('Solicitud enviada — el admin la verá en "Solicitudes" y creará el subcontrato', 'green');
      setSubSol(null);
    } catch (e) { showToast('No se pudo enviar: ' + (e.message || e), 'red'); }
  };
  // Verificación masiva de DNIs del roster contra RENIEC (pacing 30/min).
  const [dniCheck, setDniCheck] = uS(null); // null | { running, current, total, resultados: Map(pid→{estado,reniec,mensaje}) }
  const dniAbort = uR({ stop: false }).current; // ref estable: el loop y "Pausar" comparten SIEMPRE el mismo objeto
  const [q, setQ] = uS(() => { try { const v = window.__personalBuscar; if (v) { delete window.__personalBuscar; return v; } } catch {} return ''; }); // pre-filtro desde Solicitudes (Ir al registro)
  const [modal, setModal] = uS(null);
  const [form, setForm] = uS({});
  const [editingId, setEditingId] = uS(null);
  const [reniecBusy, setReniecBusy] = uS(false);
  const [obraId, setObraId] = uS(null);
  const [requestTarget, setRequestTarget] = uS(null);
  const [filtroVinculo, setFiltroVinculo] = uS('todos'); // todos | directos | subcontratados | sub:<id>
  const [filtroEstado, setFiltroEstado] = uS('todos');   // todos | activos | inactivos
  const [filtroCategoria, setFiltroCategoria] = uS('todos'); // todos | obrero | profesionales | subcontratos | otros

  uE(() => {
    let cancelled = false;
    let attempts = 0;
    const find = async () => {
      attempts++;
      const obras = await window.__db.obras.toArray();
      const stored = window.__getObraActivaId?.();
      const a = (stored && obras.find(o => o.id === stored && !o.deleted_at))
             || obras.find(o => !o.deleted_at);
      if (a) { if (!cancelled) setObraId(a.id); return; }
      if (cancelled || attempts >= 10) return;
      setTimeout(find, 500);
    };
    find();
    const onChange = () => { attempts = 0; find(); };
    window.addEventListener('jarvex_master_updated', onChange);
    window.addEventListener('obra_activa_change', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('jarvex_master_updated', onChange);
      window.removeEventListener('obra_activa_change', onChange);
    };
  }, []);

  const { data: personal, loading, create: createPersonal, update: updatePersonal } = window.__hooks.usePersonal(obraId);
  const { data: obrasAll } = window.__hooks.useObras();
  const { data: herramientas } = window.__hooks.useHerramientas(obraId);
  const { data: subcontratistas } = window.__hooks.useSubcontratistas();
  const { data: frentes } = window.__hooks.useFrentesObra(obraId);
  const obrasActivas = uM(() => (obrasAll || []).filter(o => !o.deleted_at), [obrasAll]);
  const obraNombre = (id) => obrasActivas.find(o => o.id === id)?.nombre_obra || '—';
  // Subcontratistas para agrupar personal (cuadrillas). Map por id + lista activa.
  const subsById = uM(() => new Map((subcontratistas || []).map(s => [s.id, s])), [subcontratistas]);
  const subsActivos = uM(() => (subcontratistas || [])
    .filter(s => !s.deleted_at && s.estado !== 'bloqueado')
    .sort((a, b) => (a.razon_social || '').localeCompare(b.razon_social || '')), [subcontratistas]);
  const nombreSub = (id) => subsById.get(id)?.razon_social || (id ? '(subcontratista eliminado)' : null);
  // Frentes de trabajo (catálogo) + cargos personalizables.
  const frentesById = uM(() => new Map((frentes || []).map(f => [f.id, f])), [frentes]);
  const frentesActivos = uM(() => (frentes || []).filter(f => !f.deleted_at && f.activo !== false)
    .sort((a, b) => Number(a.orden ?? 99) - Number(b.orden ?? 99) || (a.nombre || '').localeCompare(b.nombre || '')), [frentes]);
  const nombreFrente = (id) => frentesById.get(id)?.nombre || null;
  const [customCargos, setCustomCargos] = uS(loadCustomCargos());
  const cargosDisponibles = uM(() => getAllCargos(), [customCargos]);
  const [filtroFrente, setFiltroFrente] = uS('todos'); // todos | <frente_id> | sin
  const [histTarget, setHistTarget] = uS(null);        // trabajador cuyo historial se ve

  const consultarRENIEC = async (dniOverride = null) => {
    // Sanitize tolerante: String() para números, replace para sacar
    // espacios/puntos/guiones/letras que el user pueda meter sin querer.
    // Sin esto, "12.345.678" o "1234 5678" fallaba el regex aunque el
    // user creía haber puesto 8 dígitos. Si después del replace NO da
    // 8 dígitos, ahí sí es input inválido.
    const dni = String(dniOverride ?? form.dni ?? '').replace(/\D/g, '');
    if (dni.length !== 8) {
      showToast(
        dni.length === 0
          ? 'Ingresa el DNI primero'
          : `DNI debe tener 8 dígitos (escribiste ${dni.length})`,
        'red'
      );
      return;
    }
    setReniecBusy(true);
    try {
      const data = await window.__identity.consultarDNI(dni);
      // Sobrescribir nombres/apellidos siempre — si el usuario está cambiando el DNI
      // (en edición), espera ver los nombres del nuevo DNI, no los anteriores.
      // fecha_nacimiento solo se rellena si el provider la devolvió (plan
      // premium con DECOLECTA_TOKEN) y solo si el campo está vacío, para
      // no pisar una fecha que el usuario ya corrigió a mano.
      // RENIEC devuelve MAYÚSCULAS → a Título para que quede como el resto.
      const tc = (s) => String(s || '').toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (c) => c.toUpperCase()).trim();
      setForm(prev => ({
        ...prev,
        nombres: tc(data.nombres),
        apellidos: tc(data.apellidos),
        fecha_nacimiento: data.fechaNacimiento || prev.fecha_nacimiento || '',
      }));
      const extras = data.fechaNacimiento ? ` · nac. ${data.fechaNacimiento}` : '';
      showToast(`RENIEC: ${data.nombreCompleto || 'datos cargados'}${extras}`, 'green');
      // El servicio gratuito (apis.net.pe v1) NO devuelve fecha de nacimiento
      // — avisarlo para que no parezca un bug del autocompletado.
      if (!data.fechaNacimiento && data._source === 'apis.net.pe/v1') {
        setTimeout(() => showToast('El servicio gratuito de RENIEC no trae fecha de nacimiento — completala a mano (con un token gratis de apis.net.pe en Vercel se autocompleta)', 'amber'), 1200);
      }
    } catch (e) {
      showToast(e.message || 'Error al consultar RENIEC', 'red');
    } finally {
      setReniecBusy(false);
    }
  };

  // Auto-fetch RENIEC cuando se cambia el DNI a uno nuevo válido (en edición).
  // Esperamos 600ms tras dejar de tipear para no spammear la API.
  const [lastDniFetched, setLastDniFetched] = uS(null);
  uE(() => {
    if (!editingId) return; // solo en modo edición
    const dni = String(form.dni ?? '').replace(/\D/g, '');
    if (dni.length !== 8) return;
    const original = personal?.find(p => p.id === editingId)?.dni;
    if (!original || dni === original) return; // mismo DNI → no consultar
    if (lastDniFetched === dni) return; // ya consultamos este
    const t = setTimeout(() => {
      setLastDniFetched(dni);
      consultarRENIEC(dni);
    }, 600);
    return () => clearTimeout(t);
  }, [form.dni, editingId, personal]);

  // Fuente única bajo scope obrero: lista, KPIs del header, Verificar DNIs y
  // export usan ESTE subconjunto (no `personal` completo) para no filtrar datos
  // de personal no-obrero a los roles con scope.
  const baseScoped = uM(() => {
    if (!personal) return [];
    // Roles con scope: ing. seguridad / almacenera gestionan Obrero +
    // Profesionales + Subcontratos; el residente SOLO Obrero + Subcontratos.
    return scopeObrero ? personal.filter(p => catsScope.includes(categoriaDe(p, subsById).categoria)) : personal;
  }, [personal, scopeObrero, subsById, catsScope]);

  const filtered = uM(() => {
    if (!personal) return [];
    let list = baseScoped;
    // Categoría (Obrero / Profesionales / Subcontratos / Otros — deriva del cargo/vínculo).
    if (filtroCategoria !== 'todos') list = list.filter(p => categoriaDe(p, subsById).categoria === filtroCategoria);
    // Vínculo: directos (sin subcontratista), subcontratados (con cualquiera), o uno específico
    if (filtroVinculo === 'directos') list = list.filter(p => !p.subcontratista_id);
    else if (filtroVinculo === 'subcontratados') list = list.filter(p => !!p.subcontratista_id);
    else if (filtroVinculo.startsWith('sub:')) {
      const id = filtroVinculo.slice(4);
      list = list.filter(p => p.subcontratista_id === id);
    }
    // Estado: activos vs el resto (inactivo/suspendido/retirado) por rotación
    if (filtroEstado === 'activos') list = list.filter(p => p.estado === 'activo');
    else if (filtroEstado === 'inactivos') list = list.filter(p => p.estado !== 'activo');
    // Frente de trabajo
    if (filtroFrente === 'sin') list = list.filter(p => !p.frente_id);
    else if (filtroFrente !== 'todos') list = list.filter(p => p.frente_id === filtroFrente);
    if (q) {
      const t = q.toLowerCase();
      list = list.filter(p =>
        `${p.nombres} ${p.apellidos}`.toLowerCase().includes(t) ||
        p.alias?.toLowerCase().includes(t) ||
        p.cargo?.toLowerCase().includes(t) ||
        p.dni?.includes(q) ||
        (p.subcontratista_id && (nombreSub(p.subcontratista_id) || '').toLowerCase().includes(t))
      );
    }
    return list;
  }, [q, personal, baseScoped, filtroCategoria, filtroVinculo, filtroEstado, filtroFrente, subsById]);

  const personalPg = usePagination(filtered, 50);

  const ESTADO_STYLE = {
    activo:     { class:'b-green',  label:'Activo' },
    inactivo:   { class:'b-gray',   label:'Inactivo' },
    suspendido: { class:'b-yellow', label:'Suspendido' },
    retirado:   { class:'b-red',    label:'Retirado' },
  };

  const openEditPersonal = (p) => {
    if (scopeObrero && !catsScope.includes(categoriaDe(p, subsById).categoria)) { showToast(`Tu rol gestiona: ${catsScope.map(c => CATEGORIA_LABEL[c]).join(', ')} — esta persona está fuera de tu alcance.`, 'red'); return; }
    setForm({
      nombres: p.nombres || '',
      apellidos: p.apellidos || '',
      alias: p.alias || '',
      dni: p.dni || '',
      tipo_documento: p.tipo_documento || 'dni',
      cargo: p.cargo || '',
      area: p.area || '',
      fecha_nacimiento: p.fecha_nacimiento || '',
      fecha_ingreso: p.fecha_ingreso || '',
      telefono: p.telefono || '',
      email: p.email || '',
      direccion: p.direccion || '',
      contacto_emergencia: p.contacto_emergencia || '',
      telefono_emergencia: p.telefono_emergencia || '',
      regimen_pension: p.regimen_pension || '',
      estado: p.estado || 'activo',
      obra_id: p.obra_id || obraId || '',
      subcontratista_id: p.subcontratista_id || '',
      es_jefe_subcontrato: !!p.es_jefe_subcontrato,
      seguro_a_cargo: p.seguro_a_cargo || '',
      frente_id: p.frente_id || '',
      categoria: p.categoria || '',
    });
    setEditingId(p.id);
    setModal('editar');
  };

  const handleDeletePersonal = async (p) => {
    if (!canDelete) return;
    // Personal TEMPORAL (migración histórica, dni MIG-…): si tiene movimientos
    // de inventario atribuidos, borrarlo los deja huérfanos. Lo correcto es
    // FUSIONARLO con la persona real (Personal → Fusionar nombres), que
    // re-apunta los movimientos. Avisamos fuerte antes de permitir el borrado.
    const esTemporal = String(p.dni || '').startsWith('MIG-') || /fusionar/i.test(p.observaciones || '');
    if (esTemporal) {
      let movs = 0;
      try {
        const db = window.__db, oid = p.obra_id;
        const [a, b, c, d] = await Promise.all([
          db.movimientos_epp.where('obra_id').equals(oid).filter(m => !m.deleted_at && m.personal_id === p.id).count(),
          db.movimientos_materiales.where('obra_id').equals(oid).filter(m => !m.deleted_at && m.responsable_id === p.id).count(),
          db.movimientos_herramientas.where('obra_id').equals(oid).filter(m => !m.deleted_at && m.responsable_id === p.id).count(),
          db.movimientos_insumos_emergencia.where('obra_id').equals(oid).filter(m => !m.deleted_at && m.responsable_id === p.id).count(),
        ]);
        movs = a + b + c + d;
      } catch {}
      if (movs > 0) {
        showToast(`"${p.nombres} ${p.apellidos}" es personal temporal con ${movs} movimiento(s) de inventario. No lo borres: FUSIONALO con la persona real (Personal → Fusionar nombres) para no dejar esos movimientos huérfanos.`, 'red');
        return;
      }
      if (!confirm(`"${p.nombres} ${p.apellidos}" es personal temporal de la migración (pendiente de fusión) y no tiene movimientos. ¿Eliminarlo igual?`)) return;
    } else {
      if (!confirm(`¿Eliminar al trabajador "${p.nombres} ${p.apellidos}"?\n\nLas asistencias y movimientos históricos no se borran.`)) return;
    }
    try {
      await updatePersonal(p.id, { deleted_at: new Date().toISOString() });
      try { await window.__logAudit?.({ action:'delete', table:'personal', recordId:p.id, oldData:p, reason:'Eliminación manual (modo edición)' }); } catch(e) {}
      showToast(`Trabajador "${p.nombres} ${p.apellidos}" eliminado`, 'amber');
    } catch (e) { showToast('Error al eliminar: ' + (e.message||e), 'red'); }
  };

  const handleSubmit = async () => {
    // Scope: estos roles crean/editan Obrero + Profesionales + Subcontratos (no "Otros").
    if (scopeObrero && !catsScope.includes(categoriaDe({ cargo: form.cargo, subcontratista_id: form.subcontratista_id, categoria: form.categoria }, subsById).categoria)) {
      showToast('Tu rol gestiona Obrero, Profesionales y Subcontratos — ese cargo cae en "Otros".', 'red');
      return;
    }
    const tipoDoc = form.tipo_documento || 'dni';
    // DNI: 8 dígitos. CE/Pasaporte: alfanumérico 5-12 (sin formato estricto —
    // los formatos varían por país y por serie de carnet).
    const dni = tipoDoc === 'dni'
      ? String(form.dni ?? '').replace(/\D/g, '')
      : String(form.dni ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (!form.nombres?.trim() || !form.apellidos?.trim() || !dni) {
      showToast('Faltan campos obligatorios (nombres, apellidos, documento)', 'red');
      return;
    }
    if (tipoDoc === 'dni' && !/^\d{8}$/.test(dni)) {
      showToast('El DNI debe tener exactamente 8 dígitos numéricos', 'red');
      return;
    }
    if (tipoDoc !== 'dni' && !/^[A-Z0-9]{5,12}$/.test(dni)) {
      showToast(`El ${tipoDoc === 'ce' ? 'carnet de extranjería' : 'pasaporte'} debe tener entre 5 y 12 caracteres alfanuméricos`, 'red');
      return;
    }
    // ── Validaciones de sentido común ───────────────────────────
    // DNI único: ningún otro registro activo (no eliminado) puede tener el mismo DNI
    const dupe = (personal || []).find(p =>
      p.dni === dni && !p.deleted_at && p.id !== editingId
    );
    if (dupe) {
      showToast(`Ya existe un trabajador con DNI ${dni}: ${dupe.nombres} ${dupe.apellidos}`, 'red');
      return;
    }
    // fecha_ingreso no puede ser anterior a fecha_nacimiento
    if (form.fecha_nacimiento && form.fecha_ingreso && form.fecha_ingreso < form.fecha_nacimiento) {
      showToast('La fecha de ingreso no puede ser anterior a la fecha de nacimiento', 'red');
      return;
    }
    // Edad mínima 18 años al ingresar
    if (form.fecha_nacimiento && form.fecha_ingreso) {
      const nac = new Date(form.fecha_nacimiento);
      const ing = new Date(form.fecha_ingreso);
      const edad = (ing - nac) / (365.25 * 86400 * 1000);
      if (edad < 18) {
        if (!confirm(`⚠ Edad al ingreso: ${edad.toFixed(1)} años. La ley peruana exige 18+ para construcción. ¿Registrar igualmente?`)) return;
      }
    }
    // Si está editando y cambia estado de 'activo' → 'inactivo'/'retirado', verificar herramientas pendientes
    if (editingId) {
      const original = personal.find(p => p.id === editingId);
      const dabaActivo = original?.estado === 'activo';
      const ahoraInactivo = form.estado === 'inactivo' || form.estado === 'retirado';
      if (dabaActivo && ahoraInactivo) {
        const herrPendientes = (herramientas || []).filter(h =>
          !h.deleted_at && h.ultimo_responsable_id === editingId && (h.disponible === false || h.ubicacion_actual === 'en_uso')
        );
        if (herrPendientes.length > 0) {
          const lista = herrPendientes.slice(0, 5).map(h => `· ${h.nombre_herramienta}`).join('\n');
          showToast(`No podés dar de baja: tiene ${herrPendientes.length} herramienta(s) sin devolver:\n${lista}`, 'red');
          return;
        }
      }
    }
    // ── Vínculo a subcontrato (cuadrilla) + frente de trabajo ───
    const subId = form.subcontratista_id || null;
    const esJefe = !!subId && !!form.es_jefe_subcontrato;            // jefe solo aplica a subcontratado
    const seguro = subId ? (form.seguro_a_cargo || 'empresa') : null; // directo → null (= empresa implícita)
    const frenteId = form.frente_id || null;

    // Historial individual: registra cambios de cargo/frente/estado/etc. Guarda
    // NOMBRES (no ids) para que la timeline sea legible aunque el frente se borre.
    const isPruebaP = !!appMode.isPrueba;
    const uidP = auth?.profile?.id || 'offline';
    const logHist = async (tipo, antes, despues, personalId) => {
      if (String(antes ?? '') === String(despues ?? '')) return;
      try {
        const id = window.__newId(); const now = new Date().toISOString();
        await window.__db.personal_historial.add({
          id, personal_id: personalId, obra_id: obraId, fecha: now.slice(0, 10), tipo,
          valor_anterior: (antes != null && antes !== '') ? String(antes) : null,
          valor_nuevo: (despues != null && despues !== '') ? String(despues) : null,
          motivo: null, created_by: uidP, updated_by: uidP, created_at: now, updated_at: now,
          version: 1, sync_status: isPruebaP ? 'synced' : 'pending_create', last_synced_at: null,
          idempotency_key: `${uidP}_phist_${id}`, ...(isPruebaP ? { demo: true } : {}),
        });
      } catch (e) { console.warn('[personal_historial] no se pudo registrar:', e?.message); }
    };
    // Aviso suave: lo normal es 1-2 jefes por subcontrato
    if (esJefe) {
      const jefes = (personal || []).filter(p =>
        p.subcontratista_id === subId && p.es_jefe_subcontrato && !p.deleted_at && p.id !== editingId
      );
      if (jefes.length >= 2) {
        const ls = jefes.map(j => `· ${j.nombres} ${j.apellidos}`).join('\n');
        if (!confirm(`Este subcontrato ya tiene ${jefes.length} jefes:\n${ls}\n\n¿Agregar otro jefe de todas formas?`)) return;
      }
    }
    try {
      if (editingId) {
        const oldData = personal.find(p => p.id === editingId);
        const newFields = {
          nombres: form.nombres.trim(),
          apellidos: form.apellidos.trim(),
          alias: form.alias?.trim() || null,
          dni,
          tipo_documento: tipoDoc,
          cargo: form.cargo || null,
          area: form.area || null,
          fecha_nacimiento: form.fecha_nacimiento || null,
          fecha_ingreso: form.fecha_ingreso || null,
          telefono: form.telefono?.trim() || null,
          email: form.email?.trim() || null,
          direccion: form.direccion?.trim() || null,
          contacto_emergencia: form.contacto_emergencia?.trim() || null,
          telefono_emergencia: form.telefono_emergencia?.trim() || null,
          regimen_pension: form.regimen_pension?.trim() || null,
          estado: form.estado || 'activo',
          subcontratista_id: subId,
          es_jefe_subcontrato: esJefe,
          seguro_a_cargo: seguro,
          frente_id: frenteId,
          // Override manual de categoría ('' = derivar del cargo/vínculo).
          categoria: form.categoria || null,
          // Forzar mantener la obra original — NUNCA cambiarla en edición
          // (preserva trazabilidad de asistencia y movimientos históricos)
          obra_id: oldData?.obra_id || obraId,
        };
        await updatePersonal(editingId, newFields);
        try { await window.__logAudit?.({ action:'update', table:'personal', recordId:editingId, oldData, newData:newFields }); } catch(e) {}
        // Historial individual: una fila por cada cambio relevante.
        await logHist('cargo', oldData?.cargo, newFields.cargo, editingId);
        await logHist('area', oldData?.area, newFields.area, editingId);
        await logHist('estado', oldData?.estado, newFields.estado, editingId);
        await logHist('frente', nombreFrente(oldData?.frente_id), nombreFrente(frenteId), editingId);
        await logHist('subcontrato', nombreSub(oldData?.subcontratista_id), nombreSub(subId), editingId);
        showToast(`Trabajador "${form.nombres} ${form.apellidos}" actualizado`, 'green');
      } else {
        const created = await createPersonal({
          obra_id: obraId,
          nombres: form.nombres.trim(),
          apellidos: form.apellidos.trim(),
          alias: form.alias?.trim() || null,
          dni,
          tipo_documento: tipoDoc,
          cargo: form.cargo || null,
          area: form.area || null,
          fecha_nacimiento: form.fecha_nacimiento || null,
          fecha_ingreso: form.fecha_ingreso || new Date().toISOString().slice(0,10),
          telefono: form.telefono?.trim() || null,
          email: form.email?.trim() || null,
          direccion: form.direccion?.trim() || null,
          contacto_emergencia: form.contacto_emergencia?.trim() || null,
          telefono_emergencia: form.telefono_emergencia?.trim() || null,
          regimen_pension: form.regimen_pension?.trim() || null,
          estado: 'activo',
          subcontratista_id: subId,
          es_jefe_subcontrato: esJefe,
          seguro_a_cargo: seguro,
          frente_id: frenteId,
          categoria: form.categoria || null,
        });
        try { await window.__logAudit?.({ action:'insert', table:'personal', recordId:created?.id, newData:created }); } catch(e) {}
        // Historial: alta del trabajador (cargo · frente inicial).
        await logHist('alta', null, `${form.cargo || 's/cargo'}${frenteId ? ' · ' + (nombreFrente(frenteId) || '') : ''}`, created?.id);
        showToast(`Trabajador "${form.nombres} ${form.apellidos}" registrado`, 'green');
      }
      setModal(null); setForm({}); setEditingId(null);
    } catch (e) {
      showToast('Error: ' + (e.message?.includes('UNIQUE') ? 'Ya existe un trabajador con ese DNI' : e.message), 'red');
    }
  };

  // ── Verificar los DNIs del roster contra RENIEC ──────────────────
  // Reusable también para reanudar tras el límite de 30/min: lo verificado
  // queda en el Map y solo se consultan los pendientes.
  const dniCandidatos = () => (baseScoped || []).filter(p =>
    !p.deleted_at && (p.tipo_documento || 'dni') === 'dni' &&
    /^\d{8}$/.test(String(p.dni || '')));
  // Pendiente = sin resultado, con error transitorio, o cuyo DNI cambió desde
  // la consulta (ej: salió "no encontrado" → el usuario corrigió el número →
  // el resultado viejo queda obsoleto y hay que re-consultar el DNI nuevo).
  const dniPendiente = (p, resultados) => {
    const r = resultados.get(p.id);
    // 'sin_datos' = el registro local no tenía nombres/apellidos comparables
    // (RENIEC sí respondió). Tras completarlos, "Continuar" lo re-verifica.
    return !r || r.estado === 'error' || r.estado === 'sin_datos' || r.dni !== p.dni;
  };
  const verificarDnisRoster = async () => {
    const candidatos = dniCandidatos();
    if (!candidatos.length) { showToast('No hay trabajadores con DNI de 8 dígitos para verificar (CE/pasaporte no se consultan)', 'amber'); return; }
    const resultados = dniCheck?.resultados ? new Map(dniCheck.resultados) : new Map();
    const pendientes = candidatos.filter(p => dniPendiente(p, resultados));
    if (!pendientes.length) { setDniCheck(prev => ({ ...(prev || {}), running: false, abierto: true, total: candidatos.length, resultados })); return; }
    dniAbort.stop = false;
    // Merge del Map local del loop con las correcciones aplicadas vía "Usar
    // nombre RENIEC" MIENTRAS corre la verificación (quedan marcadas
    // corregido:true en el estado): sin esto, el set de cada iteración pisaría
    // la corrección y la fila volvería a aparecer como "difiere".
    const conCorrecciones = (prev) => {
      const merged = new Map(resultados);
      if (prev?.resultados) for (const [k, v] of prev.resultados) { if (v?.corregido) merged.set(k, v); }
      return merged;
    };
    setDniCheck({ running: true, abierto: true, current: candidatos.length - pendientes.length, total: candidatos.length, resultados: new Map(resultados) });
    for (let i = 0; i < pendientes.length; i++) {
      if (dniAbort.stop) break;
      const p = pendientes[i];
      try {
        const rn = await window.__identity.consultarDNI(p.dni);
        const cmp = compararNombresReniec(p.nombres, p.apellidos, rn);
        resultados.set(p.id, { estado: cmp.estado, reniec: rn, ratio: cmp.ratio, dni: p.dni });
      } catch (e) {
        const msg = String(e?.message || e);
        if (/429|demasiadas/i.test(msg)) {
          showToast('Límite de RENIEC alcanzado (30/min) — esperá un minuto y tocá "Continuar" para verificar los que faltan', 'amber');
          break;
        }
        const noExiste = /404|no encontrado|not found|no existe/i.test(msg);
        resultados.set(p.id, { estado: noExiste ? 'no_encontrado' : 'error', mensaje: msg, dni: p.dni });
      }
      // Preservar `abierto` del estado previo: si el usuario cerró el modal
      // (X o "Editar") mientras corre el loop, NO reabrirlo solo — el progreso
      // sigue visible en el botón del header y se reabre desde ahí.
      setDniCheck(prev => ({ ...(prev || {}), running: true, current: candidatos.length - pendientes.length + i + 1, total: candidatos.length, resultados: conCorrecciones(prev) }));
      if (i < pendientes.length - 1) await new Promise(r => setTimeout(r, 2100));
    }
    setDniCheck(prev => { const r = conCorrecciones(prev); return { ...(prev || {}), running: false, current: r.size, total: candidatos.length, resultados: r }; });
  };

  // Aplicar el nombre de RENIEC a una persona (corrección sugerida).
  const aplicarNombreReniec = async (p, rn) => {
    if (scopeObrero && !catsScope.includes(categoriaDe(p, subsById).categoria)) { showToast(`Tu rol gestiona: ${catsScope.map(c => CATEGORIA_LABEL[c]).join(', ')} — esta persona está fuera de tu alcance.`, 'red'); return; }
    const nuevos = { nombres: titleCaseNombre(rn.nombres), apellidos: titleCaseNombre(rn.apellidos) };
    try {
      await updatePersonal(p.id, nuevos);
      try { await window.__logAudit?.({ action: 'update', table: 'personal', recordId: p.id, oldData: { nombres: p.nombres, apellidos: p.apellidos }, newData: nuevos, reason: 'Corrección de nombre según RENIEC (verificación de DNIs)' }); } catch {}
      setDniCheck(prev => {
        if (!prev) return prev;
        const r = new Map(prev.resultados);
        r.set(p.id, { ...(r.get(p.id) || {}), estado: 'ok', corregido: true });
        return { ...prev, resultados: r };
      });
      showToast(`✓ ${nuevos.nombres} ${nuevos.apellidos} — nombre corregido según RENIEC`, 'green');
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  if (!obraId) return <SinObraEmpty icon="users"/>;
  if (loading) {
    return <div className="page-wrap"><div className="empty-state"><JxIcon name="users" size={32} color="var(--tm)"/><p>Cargando personal…</p></div></div>;
  }

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div><div className="pg-title">Personal</div><div className="pg-sub">{baseScoped.length} trabajadores{scopeObrero ? ' (tu alcance)' : ''} · {baseScoped.filter(p=>p.estado==='activo').length} activos · {baseScoped.filter(p=>!p.subcontratista_id).length} directos · {baseScoped.filter(p=>!!p.subcontratista_id).length} en subcontrato</div></div>
        <div style={{display:'flex',gap:8}}>
          {superAdminP && (
            <button className="btn btn-sm" style={{ background:'rgba(231,76,60,0.12)', color:'#E74C3C', border:'1px solid rgba(231,76,60,0.3)' }}
              onClick={()=>setFusionOpen(true)} title="⚡ Super Admin: juntar dos nombres que son la misma persona (referencial de migración + nombre real)">
              <JxIcon name="compare" size={13}/>Fusionar nombres
            </button>
          )}
          <button className="btn btn-ghost btn-sm" title="Descargar el Excel del personal de esta obra (solo exporta — no modifica nada)"
            onClick={async () => {
              try {
                const obra = await window.__db.obras.get(obraId);
                // La página Personal nunca muestra datos bancarios (viven en
                // Tesorería → Cuentas Bancarias). Si el rol no tiene ese módulo
                // al menos en lectura, el export sale con las columnas bancarias
                // vacías — si no, el botón sería un bypass de permisos. OJO: no
                // alcanza con canWrite (rrhh / residente tienen Personal 'w'
                // pero Cuentas Bancarias 'x').
                const sinBancos = !(isAdmin || (window.__hasPerm?.(myRol, 'Cuentas Bancarias', 'r') ?? false));
                const r = await exportarDataset('personal', obraId, obra?.nombre_obra || obra?.nombre || 'obra', { sinBancos, soloObreros: scopeObrero, scopeFiltro: (p) => catsScope.includes(categoriaDe(p, subsById).categoria) }, { porModo: true });
                showToast(`Exportado: ${r.filas} trabajadores → ${r.archivo}`, 'green');
              } catch (e) { showToast('Error al exportar: ' + (e.message || e), 'red'); }
            }}>
            <JxIcon name="download" size={13}/>Exportar Excel
          </button>
          {canWrite && (
            // Si corre el loop → solo reabrir el modal. Si NO corre → re-evaluar
            // pendientes (DNIs corregidos, trabajadores nuevos); sin pendientes
            // solo reabre el modal con el total fresco, sin tocar la API.
            <button className="btn btn-ghost btn-sm" onClick={() => (dniCheck?.running ? setDniCheck(prev => ({ ...prev, abierto: true })) : verificarDnisRoster())}
              title="Consulta cada DNI del roster en RENIEC y avisa si el nombre no coincide o el DNI no existe">
              <JxIcon name="search" size={13}/>Verificar DNIs{dniCheck?.running ? ` ${dniCheck.current}/${dniCheck.total}` : ''}
            </button>
          )}
          {canWrite && scopeObrero && (
            <button className="btn btn-ghost btn-sm" title="Pedile al admin crear un subcontrato nuevo — cuando lo cree vas a poder vincularle personal"
              onClick={()=>setSubSol({ nombre:'', alcance:'', motivo:'' })}>
              <JxIcon name="plus" size={13}/>Solicitar subcontrato
            </button>
          )}
          {canWrite ? (
            <button className="btn btn-amber btn-sm" onClick={()=>{setForm({}); setModal('nuevo');}}><JxIcon name="plus" size={13}/>Nuevo Trabajador</button>
          ) : (
            <span className="badge b-gray" title="Tu rol es solo lectura para Personal">Solo lectura</span>
          )}
        </div>
      </div>
      {/* ⚡ Nombres temporales de la migración (dni MIG-/RES-): pendientes de fusión */}
      {superAdminP && (() => {
        const temporales = (personal || []).filter(p => !p.deleted_at && /^(MIG-|RES-)/.test(String(p.dni || '')));
        if (!temporales.length) return null;
        return (
          <div style={{ marginBottom:12, padding:'10px 14px', background:'rgba(231,76,60,0.08)', border:'1px solid rgba(231,76,60,0.3)', borderRadius:8, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <span style={{ fontSize:12.5, color:'var(--ts)' }}>
              👥 <strong>{temporales.length} nombre(s) temporales</strong> de la importación histórica pendientes de fusionar con el personal real:
            </span>
            {temporales.slice(0, 8).map(p => (
              <button key={p.id} className="tag" title="Buscar en la lista" style={{ cursor:'pointer', border:'1px solid rgba(231,76,60,0.35)' }}
                onClick={()=>setQ(`${p.nombres} ${p.apellidos}`.trim())}>
                {p.nombres} {p.apellidos}
              </button>
            ))}
            {temporales.length > 8 && <span style={{ fontSize:11.5, color:'var(--tm)' }}>+{temporales.length - 8} más</span>}
            <button className="btn btn-sm" style={{ marginLeft:'auto', background:'rgba(231,76,60,0.15)', color:'#E74C3C', border:'1px solid rgba(231,76,60,0.35)' }} onClick={()=>setFusionOpen(true)}>
              <JxIcon name="compare" size={12}/> Fusionar ahora
            </button>
          </div>
        );
      })()}

      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
        <div className="search-bar" style={{flex:'1 1 220px'}}><JxIcon name="search" size={14} color="var(--tm)"/><input placeholder="Buscar por nombre, alias, cargo, DNI o subcontrato…" value={q} onChange={e=>setQ(e.target.value)}/></div>
        <select className="fi" style={{width:'auto',minWidth:170}} value={filtroVinculo} onChange={e=>{setFiltroVinculo(e.target.value); personalPg.setPage?.(1);}} title="Filtrar por vínculo laboral">
          <option value="todos">Vínculo: todos</option>
          <option value="directos">Directos (empresa)</option>
          <option value="subcontratados">En subcontrato</option>
          {subsActivos.length > 0 && <option disabled>──────────</option>}
          {subsActivos.map(s => <option key={s.id} value={`sub:${s.id}`}>{s.razon_social}</option>)}
        </select>
        <select className="fi" style={{width:'auto',minWidth:170}} value={filtroCategoria} onChange={e=>{setFiltroCategoria(e.target.value); personalPg.setPage?.(1);}} title="Filtrar por categoría de personal">
          <option value="todos">Categoría: todas</option>
          {CATEGORIAS.filter(c => !scopeObrero || c.key !== 'otros').map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <select className="fi" style={{width:'auto',minWidth:150}} value={filtroEstado} onChange={e=>setFiltroEstado(e.target.value)} title="Filtrar por estado">
          <option value="todos">Estado: todos</option>
          <option value="activos">Solo activos</option>
          <option value="inactivos">Inactivos / baja</option>
        </select>
        {frentesActivos.length > 0 && (
          <select className="fi" style={{width:'auto',minWidth:160}} value={filtroFrente} onChange={e=>setFiltroFrente(e.target.value)} title="Filtrar por frente de trabajo">
            <option value="todos">Frente: todos</option>
            <option value="sin">Sin frente</option>
            {frentesActivos.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
          </select>
        )}
      </div>
      {personal.length === 0 ? (
        <div className="card card-p empty-state"><JxIcon name="users" size={40} color="var(--tm)"/><p>No hay personal registrado. Click en "Nuevo Trabajador".</p></div>
      ) : (
      <div className="card" style={{overflow:'hidden'}}>
        <table className="tbl">
          <thead><tr>
            <th>Nombre Completo</th><th>DNI</th><th>Cargo</th><th>Categoría</th><th>Frente</th><th>Área</th><th>Vínculo</th>
            <th>F. Ingreso</th><th>Estado</th><th>Teléfono</th><th>Sync</th>
            <th style={{textAlign:'center'}}>Acciones</th>
          </tr></thead>
          <tbody>
            {personalPg.pagedItems.map(p => {
              const e = ESTADO_STYLE[p.estado] || ESTADO_STYLE.activo;
              return (
                <tr key={p.id}>
                  <td className="col-p">{p.nombres} {p.apellidos}{p.alias ? <span style={{color:'var(--tm)',fontWeight:400}}> «{p.alias}»</span> : null}</td>
                  <td className="col-m">{p.dni}</td>
                  <td>{p.cargo || '—'}</td>
                  <td>{(() => { const { categoria, sub } = categoriaDe(p, subsById); return (
                    <span style={{display:'inline-flex',flexDirection:'column',gap:2,alignItems:'flex-start'}}>
                      <span className={`badge ${CATEGORIA_BADGE[categoria]}`} title={p.categoria ? 'Categoría fijada a mano' : 'Categoría derivada del cargo/vínculo'}>{CATEGORIA_LABEL[categoria]}{p.categoria ? ' ✎' : ''}</span>
                      {sub && <span style={{fontSize:10,color:'var(--tm)'}}>{sub}</span>}
                    </span>
                  ); })()}</td>
                  <td>{p.frente_id ? <span className="badge b-amber" title="Frente de trabajo">{nombreFrente(p.frente_id) || '(frente)'}</span> : <span style={{color:'var(--tm)',fontSize:12}}>—</span>}</td>
                  <td><span className="tag">{p.area || '—'}</span></td>
                  <td>
                    {p.subcontratista_id ? (
                      <span style={{display:'inline-flex',gap:4,alignItems:'center',flexWrap:'wrap'}}>
                        <span className="tag" title="Subcontrato">{nombreSub(p.subcontratista_id)}</span>
                        {p.es_jefe_subcontrato && <span className="badge b-blue" title="Jefe de subcontrato">Jefe</span>}
                        {p.seguro_a_cargo === 'subcontrato'
                          ? <span className="badge b-gray" title="Seguro / SCTR a cargo del subcontrato">seg: sub</span>
                          : <span className="badge b-green" title="Seguro / SCTR a cargo de la empresa">seg: emp</span>}
                      </span>
                    ) : <span style={{color:'var(--tm)',fontSize:12}}>Directo</span>}
                  </td>
                  <td className="col-m">{p.fecha_ingreso || '—'}</td>
                  <td><span className={`badge ${e.class}`}>{e.label}</span></td>
                  <td className="col-m">{p.telefono || '—'}</td>
                  <td>{p.sync_status && p.sync_status !== 'synced'
                    ? <span className="badge b-amber">⏱</span>
                    : <span style={{color:'var(--green)',fontSize:11}}>✓</span>}</td>
                  <td style={{textAlign:'center', whiteSpace:'nowrap'}}>
                    <button className="btn btn-ghost btn-xs" title="Ver historial del trabajador" onClick={()=>setHistTarget(p)}>
                      <JxIcon name="clock" size={11}/>
                    </button>
                    {isAdmin ? (
                      <>
                        <button className="btn btn-ghost btn-xs" title="Editar trabajador" onClick={()=>openEditPersonal(p)} style={{ marginLeft:4 }}>
                          <JxIcon name="edit" size={11}/>
                        </button>
                        {canDelete && (
                          <button className="btn btn-red btn-xs" title="Eliminar (solo modo edición)" onClick={()=>handleDeletePersonal(p)} style={{ marginLeft:4 }}>
                            <JxIcon name="trash" size={11}/>
                          </button>
                        )}
                      </>
                    ) : (
                      <button className="btn btn-ghost btn-xs" title="Solicitar cambio" onClick={()=>setRequestTarget(p)} style={{ marginLeft:4 }}>
                        <JxIcon name="alert" size={11}/>
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <TablePagination {...personalPg} />
      </div>
      )}

      {dniCheck?.abierto && (() => {
        const porId = new Map((personal || []).map(p => [p.id, p]));
        const rs = [...dniCheck.resultados.entries()].map(([pid, r]) => ({ p: porId.get(pid), r })).filter(x => x.p);
        const cnt = (e) => rs.filter(x => x.r.estado === e).length;
        const problemas = rs.filter(x => x.r.estado !== 'ok');
        // Pendientes contra el roster FRESCO (no dniCheck.total del run viejo):
        // cubre trabajadores agregados y DNIs corregidos después de verificar.
        const pendientesN = dniCandidatos().filter(p => dniPendiente(p, dniCheck.resultados)).length;
        return (
          <Modal title="Verificación de DNIs contra RENIEC" icon="search" size="wide" onClose={() => { dniAbort.stop = true; setDniCheck(prev => prev ? { ...prev, abierto: false } : prev); }}>
            {dniCheck.running ? (
              <div style={{ fontSize: 12.5, color: 'var(--ts)', marginBottom: 12 }}>
                Consultando RENIEC… {dniCheck.current}/{dniCheck.total} (≈2 seg por DNI para respetar el límite del servicio)
                <div style={{ width: '100%', height: 6, background: 'var(--bg-c)', borderRadius: 3, overflow: 'hidden', marginTop: 6 }}>
                  <div style={{ width: `${dniCheck.total ? (dniCheck.current / dniCheck.total * 100) : 0}%`, height: '100%', background: 'var(--blue)', transition: 'width .2s' }}/>
                </div>
                <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => { dniAbort.stop = true; }}>Pausar</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
                <span className="badge b-green">✓ {cnt('ok')} coinciden</span>
                {cnt('difiere') > 0 && <span className="badge b-amber">⚠ {cnt('difiere')} con nombre distinto</span>}
                {(cnt('no_coincide') + cnt('no_encontrado')) > 0 && <span className="badge b-red">✖ {cnt('no_coincide') + cnt('no_encontrado')} DNIs a revisar</span>}
                {cnt('sin_datos') > 0 && <span className="badge b-amber">{cnt('sin_datos')} con datos incompletos</span>}
                {cnt('error') > 0 && <span className="badge b-gray">{cnt('error')} sin respuesta</span>}
                {pendientesN > 0 && (
                  <button className="btn btn-blue btn-sm" onClick={verificarDnisRoster}>↻ Continuar ({pendientesN} pendientes)</button>
                )}
              </div>
            )}
            {!dniCheck.running && problemas.length === 0 && dniCheck.resultados.size > 0 && (
              <div style={{ padding: '10px 12px', background: 'rgba(39,174,96,0.08)', border: '1px solid rgba(39,174,96,0.3)', borderRadius: 8, fontSize: 12.5, color: 'var(--ts)' }}>
                ✓ Todos los DNIs verificados coinciden con RENIEC.
              </div>
            )}
            {problemas.length > 0 && (
              <div style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {problemas.slice(0, 100).map(({ p, r }) => {
                  if (r.estado === 'difiere' && r.reniec) {
                    return (
                      <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 10px', background: 'rgba(242,183,5,0.06)', border: '1px solid rgba(242,183,5,0.3)', borderRadius: 8, fontSize: 12 }}>
                        <span style={{ flex: '1 1 280px' }}>
                          DNI {p.dni} — registrado: <span style={{ color: 'var(--red)' }}>{p.nombres} {p.apellidos}</span> · RENIEC: <span style={{ color: 'var(--green)' }}>{titleCaseNombre(r.reniec.nombres)} {titleCaseNombre(r.reniec.apellidos)}</span>
                        </span>
                        <button className="btn btn-green btn-xs" onClick={() => aplicarNombreReniec(p, r.reniec)}>Usar nombre RENIEC</button>
                        <button className="btn btn-ghost btn-xs" onClick={() => { setDniCheck(prev => ({ ...prev, abierto: false })); openEditPersonal(p); }}>Editar</button>
                      </div>
                    );
                  }
                  // 'no_coincide': RENIEC SÍ encontró el DNI pero el nombre es
                  // completamente distinto — el DNI tipeado pertenece a OTRA
                  // persona. Se muestra el nombre RENIEC pero NO se ofrece
                  // "Usar nombre RENIEC": pisar el registro con el nombre de un
                  // tercero sería peor; lo correcto es corregir el DNI (Editar).
                  const esOtraPersona = r.estado === 'no_coincide' && r.reniec;
                  const esNoEnc = r.estado === 'no_encontrado' || (r.estado === 'no_coincide' && !r.reniec);
                  // 'sin_datos': RENIEC respondió bien, pero el registro local no
                  // tiene nombres/apellidos comparables (vacíos o solo iniciales).
                  const esSinDatos = r.estado === 'sin_datos';
                  const esRojo = esNoEnc || esOtraPersona;
                  return (
                    <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 10px', background: esRojo ? 'rgba(231,76,60,0.06)' : esSinDatos ? 'rgba(242,183,5,0.06)' : 'rgba(127,140,141,0.08)', border: `1px solid ${esRojo ? 'rgba(231,76,60,0.3)' : esSinDatos ? 'rgba(242,183,5,0.3)' : 'var(--border)'}`, borderRadius: 8, fontSize: 12 }}>
                      <span style={{ flex: '1 1 280px' }}>
                        <strong>{p.nombres} {p.apellidos}</strong> · DNI {p.dni} — {esOtraPersona
                          ? <>RENIEC dice que ese DNI es de <span style={{ color: 'var(--red)', fontWeight: 600 }}>{titleCaseNombre(r.reniec.nombres)} {titleCaseNombre(r.reniec.apellidos)}</span> (otra persona). El número probablemente está mal escrito — corregí el DNI con Editar.</>
                          : esNoEnc
                          ? 'no encontrado: el número puede estar mal escrito (o es un DNI reciente que el servicio gratuito no tiene). Revisalo y corregilo.'
                          : esSinDatos
                            ? `faltan nombres/apellidos en el registro para comparar${r.reniec?.nombres ? ` (RENIEC dice: ${titleCaseNombre(r.reniec.nombres)} ${titleCaseNombre(r.reniec.apellidos)})` : ''} — completalos con Editar y tocá Continuar`
                            : `sin respuesta del servicio (${(r.mensaje || '').slice(0, 80)})`}
                      </span>
                      <button className="btn btn-amber btn-xs" onClick={() => { setDniCheck(prev => ({ ...prev, abierto: false })); openEditPersonal(p); }}>Revisar / Editar</button>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ fontSize: 11.5, color: 'var(--tm)', marginTop: 12 }}>
              Solo se consultan DNIs de 8 dígitos (CE y pasaporte no aplican). El servicio gratuito tiene base desactualizada y sin fecha de nacimiento — un "no encontrado" puede ser un DNI real reciente.
            </div>
          </Modal>
        );
      })()}
      {fusionOpen && (
        <FusionPersonasModal personal={personal} showToast={showToast}
          onClose={()=>setFusionOpen(false)} onDone={()=>{ /* el hook se refresca solo vía jx_data_changed */ }}/>
      )}
      {subSol && (
        <div style={{ position:'fixed', inset:0, zIndex:400, background:'rgba(0,0,0,0.55)', display:'flex', alignItems:'center', justifyContent:'center' }} onClick={()=>setSubSol(null)}>
          <div className="card card-p" style={{ width:'min(480px, 92vw)' }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:15, fontWeight:800, color:'var(--tp)', marginBottom:6 }}>Solicitar nuevo subcontrato</div>
            <div style={{ fontSize:11.5, color:'var(--tm)', marginBottom:12 }}>
              El admin ve la solicitud en <strong>Solicitudes</strong>, crea el subcontrato y le asigna partidas e ingeniero.
              Cuando esté creado vas a poder vincularle personal desde "Nuevo Trabajador".
            </div>
            <label className="flabel">Subcontratista (razón social) *</label>
            <input className="fi" value={subSol.nombre} onChange={e=>setSubSol({ ...subSol, nombre: e.target.value })} placeholder="Ej: Subcontrato JR S.A.C."/>
            <label className="flabel" style={{ marginTop:8 }}>Alcance / trabajos que haría</label>
            <textarea className="fi" rows={2} value={subSol.alcance} onChange={e=>setSubSol({ ...subSol, alcance: e.target.value })} placeholder="Ej: excavación de zanjas del sector Cashaloma"/>
            <label className="flabel" style={{ marginTop:8 }}>Motivo *</label>
            <textarea className="fi" rows={2} value={subSol.motivo} onChange={e=>setSubSol({ ...subSol, motivo: e.target.value })} placeholder="Por qué se necesita este subcontrato (mín. 10 caracteres)"/>
            <div className="modal-actions" style={{ marginTop:12 }}>
              <button className="btn btn-ghost" onClick={()=>setSubSol(null)}>Cancelar</button>
              <button className="btn btn-amber" onClick={enviarSolicitudSub}><JxIcon name="check" size={13}/> Enviar solicitud</button>
            </div>
          </div>
        </div>
      )}

      {(modal === 'nuevo' || modal === 'editar') && <Modal title={editingId ? 'Editar Trabajador' : 'Nuevo Trabajador'} icon="user" onClose={()=>{setModal(null); setEditingId(null); setForm({});}}>
        <div className="g2">
          <div><label className="flabel">Nombres *</label><input className="fi" value={form.nombres||''} onChange={e=>setForm({...form, nombres:e.target.value})}/></div>
          <div><label className="flabel">Apellidos *</label><input className="fi" value={form.apellidos||''} onChange={e=>setForm({...form, apellidos:e.target.value})}/></div>
          <div><label className="flabel">Alias / apodo</label><input className="fi" placeholder='Como lo conocen en obra: "Coco", "Chato"…' value={form.alias||''} onChange={e=>setForm({...form, alias:e.target.value})}/></div>
          <div>
            <label className="flabel">Documento *</label>
            <div style={{ display:'flex', gap:6 }}>
              {/* No todos tienen DNI: hay personal extranjero con carnet de
                  extranjería o pasaporte. RENIEC solo aplica a DNI. */}
              <select className="fi" value={form.tipo_documento||'dni'} style={{ width:110, flexShrink:0 }}
                onChange={e=>{
                  const t = e.target.value;
                  // Al cambiar de tipo, re-sanitizar el número con la regla del tipo nuevo.
                  const num = t === 'dni' ? String(form.dni||'').replace(/\D/g,'').slice(0,8) : String(form.dni||'').replace(/[^a-zA-Z0-9]/g,'').toUpperCase().slice(0,12);
                  setForm({...form, tipo_documento:t, dni:num});
                }}>
                <option value="dni">DNI</option>
                <option value="ce">C. Extranjería</option>
                <option value="pasaporte">Pasaporte</option>
              </select>
              <input className="fi" style={{ flex:1 }}
                placeholder={(form.tipo_documento||'dni')==='dni' ? '8 dígitos' : 'N° de documento'}
                inputMode={(form.tipo_documento||'dni')==='dni' ? 'numeric' : 'text'}
                maxLength={(form.tipo_documento||'dni')==='dni' ? 8 : 12}
                value={form.dni||''}
                onChange={e=>setForm({...form, dni:(form.tipo_documento||'dni')==='dni' ? e.target.value.replace(/\D/g,'').slice(0,8) : e.target.value.replace(/[^a-zA-Z0-9]/g,'').toUpperCase().slice(0,12)})}/>
              {(form.tipo_documento||'dni')==='dni' && (
                <button type="button" className="btn btn-blue btn-sm" disabled={reniecBusy || (form.dni||'').length !== 8} onClick={() => consultarRENIEC()} title="Consultar datos en RENIEC">
                  <JxIcon name="search" size={12}/>{reniecBusy ? '...' : 'RENIEC'}
                </button>
              )}
            </div>
          </div>
          <div><label className="flabel">Teléfono</label><input className="fi" placeholder="9 dígitos" inputMode="numeric" maxLength={9} value={form.telefono||''} onChange={e=>setForm({...form, telefono:e.target.value.replace(/\D/g,'').slice(0,9)})}/></div>
          <div><label className="flabel">Email</label><input className="fi" type="email" placeholder="correo@gmail.com" value={form.email||''} onChange={e=>setForm({...form, email:e.target.value})}/></div>
          <div style={{gridColumn:'1/-1'}}><label className="flabel">Dirección</label><input className="fi" placeholder="Jr./Av./Caserío…" value={form.direccion||''} onChange={e=>setForm({...form, direccion:e.target.value})}/></div>
          <div><label className="flabel">Contacto de emergencia</label><input className="fi" placeholder="Nombre del familiar" value={form.contacto_emergencia||''} onChange={e=>setForm({...form, contacto_emergencia:e.target.value})}/></div>
          <div><label className="flabel">Teléfono de emergencia</label><input className="fi" placeholder="9 dígitos" inputMode="numeric" maxLength={9} value={form.telefono_emergencia||''} onChange={e=>setForm({...form, telefono_emergencia:e.target.value.replace(/\D/g,'').slice(0,9)})}/></div>
          <div><label className="flabel">Régimen de pensión</label>
            <input className="fi" list="regimenes-pension" placeholder="ONP / AFP Integra…" value={form.regimen_pension||''} onChange={e=>setForm({...form, regimen_pension:e.target.value})}/>
            <datalist id="regimenes-pension"><option value="ONP"/><option value="AFP Integra"/><option value="AFP Prima"/><option value="AFP Profuturo"/><option value="AFP Habitat"/><option value="Sin régimen"/></datalist>
          </div>
          <div><label className="flabel">Cargo</label>
            <select className="fi" value={form.cargo||''} onChange={e=>{
              const v = e.target.value;
              if (v === '__add__') {
                const n = (prompt('Nuevo cargo (ej. Ingeniero Sanitario, Topógrafo Jr.)') || '').trim();
                if (n && !cargosDisponibles.includes(n)) { const next = [...customCargos, n]; setCustomCargos(next); saveCustomCargos(next); }
                if (n) setForm({...form, cargo:n});
                return;
              }
              setForm({...form, cargo:v});
            }}>
              <option value="">— Selecciona —</option>
              {form.cargo && !(scopeObrero ? cargosParaRol(myRol) : cargosDisponibles).includes(form.cargo) && <option value={form.cargo}>{form.cargo}</option>}
              {(scopeObrero ? cargosParaRol(myRol) : cargosDisponibles).map(c => <option key={c} value={c}>{c}</option>)}
              {!scopeObrero && <option value="__add__">+ Agregar cargo…</option>}
            </select>
            {scopeObrero && <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:3 }}>Tu rol gestiona: {catsScope.map(c => CATEGORIA_LABEL[c]).join(', ')}.</div>}
          </div>
          <div><label className="flabel">Categoría</label>
            <select className="fi" value={form.categoria || ''} onChange={e=>setForm({...form, categoria:e.target.value})}
              disabled={scopeObrero}
              title={scopeObrero ? 'La categoría se deriva sola del cargo/subcontratista — el override manual es del admin.' : 'Se deriva del cargo/vínculo. Fijala a mano solo si querés forzar otra.'}>
              <option value="">Automática (según cargo / subcontrato)</option>
              {scopeObrero
                ? (form.categoria && <option value={form.categoria}>{CATEGORIA_LABEL[form.categoria]}</option>)
                : CATEGORIAS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            {(() => { const der = categoriaDe({ cargo: form.cargo, subcontratista_id: form.subcontratista_id }, subsById).categoria; return (
              <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:3 }}>
                {form.categoria ? `Fijada a mano: ${CATEGORIA_LABEL[form.categoria]}.` : `Se clasificará como: ${CATEGORIA_LABEL[der]}.`}
              </div>
            ); })()}
          </div>
          <div><label className="flabel">Área</label>
            <select className="fi" value={form.area||''} onChange={e=>setForm({...form, area:e.target.value})}>
              <option value="">— Selecciona —</option>
              <option>Estructuras</option><option>Acabados</option><option>Instalaciones Sanitarias</option>
              <option>Instalaciones Eléctricas</option><option>Almacén</option><option>Seguridad</option>
              <option>Topografía</option><option>Administración</option>
            </select>
          </div>
          <div><label className="flabel">Fecha de nacimiento</label><input className="fi" type="date" value={form.fecha_nacimiento||''} onChange={e=>setForm({...form, fecha_nacimiento:e.target.value})}/></div>
          <div><label className="flabel">Fecha de ingreso</label><input className="fi" type="date" value={form.fecha_ingreso||''} onChange={e=>setForm({...form, fecha_ingreso:e.target.value})}/></div>
          <div style={{ gridColumn:'1 / -1', borderTop:'1px solid var(--bd)', paddingTop:10, marginTop:2 }}>
            <label className="flabel" style={{ fontWeight:600 }}><JxIcon name="flag" size={11}/> Frente de trabajo y vínculo</label>
            <div className="g2" style={{ marginTop:6 }}>
              <div>
                <label className="flabel">Frente de trabajo</label>
                <select className="fi" value={form.frente_id || ''} onChange={e=>setForm({...form, frente_id:e.target.value})}>
                  <option value="">— Sin frente —</option>
                  {frentesActivos.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
                </select>
                {frentesActivos.length === 0 && <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:3 }}>Creá frentes en <strong>Frentes de Trabajo</strong> (menú RRHH).</div>}
                {form.subcontratista_id && (() => {
                  const fs = [...new Set((personal||[]).filter(p=>p.subcontratista_id===form.subcontratista_id && p.frente_id && !p.deleted_at).map(p=>p.frente_id))].map(id=>nombreFrente(id)).filter(Boolean);
                  return fs.length ? <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:3 }}>Este subcontrato trabaja en: {fs.join(', ')}.</div> : null;
                })()}
              </div>
              <div>
                <label className="flabel">Pertenece a</label>
                <select className="fi" value={form.subcontratista_id || ''} onChange={e=>{
                  const v = e.target.value;
                  const sub = subsById.get(v);
                  setForm(f => ({
                    ...f,
                    subcontratista_id: v,
                    seguro_a_cargo: v ? (f.seguro_a_cargo || sub?.seguro_a_cargo || 'empresa') : '',
                    es_jefe_subcontrato: v ? f.es_jefe_subcontrato : false,
                  }));
                }}>
                  <option value="">Directo de la empresa</option>
                  {subsActivos.map(s => <option key={s.id} value={s.id}>{s.razon_social}{s.especialidad ? ` · ${s.especialidad}` : ''}</option>)}
                </select>
              </div>
              {form.subcontratista_id ? (
                <div>
                  <label className="flabel">Seguro / SCTR a cargo de</label>
                  <select className="fi" value={form.seguro_a_cargo || 'empresa'} onChange={e=>setForm({...form, seguro_a_cargo:e.target.value})}>
                    <option value="empresa">Empresa ejecutora (lo compramos nosotros)</option>
                    <option value="subcontrato">El subcontrato</option>
                  </select>
                </div>
              ) : <div/>}
              {form.subcontratista_id && (
                <div style={{ gridColumn:'1 / -1', display:'flex', alignItems:'center', gap:8 }}>
                  <input id="es_jefe_sub" type="checkbox" checked={!!form.es_jefe_subcontrato} onChange={e=>setForm({...form, es_jefe_subcontrato:e.target.checked})}/>
                  <label htmlFor="es_jefe_sub" style={{ fontSize:13, cursor:'pointer' }}>Es <strong>jefe</strong> de este subcontrato (lo normal: 1-2 por grupo)</label>
                </div>
              )}
            </div>
            {subsActivos.length === 0 && (
              <div style={{ fontSize:11, color:'var(--tm)', marginTop:6 }}>Para agrupar bajo un subcontrato, primero crea el subcontratista en la sección <strong>Subcontratistas</strong>.</div>
            )}
          </div>
          {editingId && (
            <div><label className="flabel">Estado</label>
              <select className="fi" value={form.estado||'activo'} onChange={e=>setForm({...form, estado:e.target.value})}>
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
                <option value="suspendido">Suspendido</option>
                <option value="retirado">Retirado</option>
              </select>
            </div>
          )}
          {editingId && isAdmin && (
            <div style={{ gridColumn:'1 / -1' }}>
              <label className="flabel">
                <JxIcon name="building" size={11}/> Obra asignada {editingId ? '(no editable — el trabajador queda fijo en su obra)' : '*'}
              </label>
              <select className="fi"
                value={form.obra_id || ''}
                disabled={!!editingId}
                onChange={e=>setForm({...form, obra_id:e.target.value})}
                style={editingId ? { opacity:0.6, cursor:'not-allowed' } : undefined}>
                {obrasActivas.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.nombre_obra || o.nombre || '(sin nombre)'}{o.cliente ? ` — ${o.cliente}` : ''}
                  </option>
                ))}
              </select>
              <div style={{ fontSize:11, color: editingId ? 'var(--amber)' : 'var(--tm)', marginTop:4 }}>
                {editingId
                  ? '⚠ La obra del trabajador NO se puede cambiar para mantener trazabilidad de asistencia/herramientas. Si necesita ir a otra obra, dale baja en esta y créalo de nuevo en la otra.'
                  : 'Una vez creado, el trabajador queda fijo en esta obra (no se puede cambiar después).'}
              </div>
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={()=>{setModal(null); setEditingId(null); setForm({});}}>Cancelar</button>
          <button className="btn btn-amber" onClick={handleSubmit}><JxIcon name="check" size={13}/>{editingId ? 'Guardar Cambios' : 'Registrar Trabajador'}</button>
        </div>
      </Modal>}

      {requestTarget && (
        <RequestChangeModal
          table="personal"
          record={requestTarget}
          recordLabel={`${requestTarget.nombres || ''} ${requestTarget.apellidos || ''}`.trim() || requestTarget.dni}
          allowDelete
          fields={[
            { key: 'nombres', label: 'Nombres' },
            { key: 'apellidos', label: 'Apellidos' },
            { key: 'alias', label: 'Alias / apodo' },
            { key: 'dni', label: 'DNI' },
            { key: 'cargo', label: 'Cargo' },
            { key: 'area', label: 'Área' },
            { key: 'telefono', label: 'Teléfono' },
            { key: 'estado', label: 'Estado', options: [
              { value: 'activo', label: 'Activo' }, { value: 'inactivo', label: 'Inactivo' },
              { value: 'suspendido', label: 'Suspendido' }, { value: 'retirado', label: 'Retirado' },
            ]},
            { key: 'subcontratista_id', label: 'Pertenece a (subcontrato)', options: [
              { value: '', label: 'Directo de la empresa' },
              ...subsActivos.map(s => ({ value: s.id, label: s.razon_social })),
            ]},
            { key: 'seguro_a_cargo', label: 'Seguro a cargo de', options: [
              { value: 'empresa', label: 'Empresa ejecutora' },
              { value: 'subcontrato', label: 'El subcontrato' },
            ]},
          ]}
          showToast={showToast}
          onClose={() => setRequestTarget(null)}
        />
      )}

      {histTarget && <HistorialPersonalModal persona={histTarget} onClose={()=>setHistTarget(null)} />}
    </div>
  );
}

// ─── ASISTENCIA PAGE ─────────────────────────────────────
function AsistenciaPage({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const myRol = auth?.profile?.rol;
  const isAdmin = myRol === 'admin';
  const canWrite = isAdmin || (window.__hasPerm?.(myRol, 'Asistencia', 'w') ?? false);
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = uS(today);
  const [modal, setModal] = uS(null); // null | 'masivo' | 'editar'
  const [editingAsist, setEditingAsist] = uS(null); // asistencia individual en edición
  const [editForm, setEditForm] = uS({}); // form del modal de edición individual
  const [rows, setRows] = uS([]); // estado de las filas en el modal masivo
  const [photoBlob, setPhotoBlob] = uS(null);
  const [photoUrl, setPhotoUrl] = uS(null);
  const [obraId, setObraId] = uS(null);
  const [busy, setBusy] = uS(false);
  const [ocrBusy, setOcrBusy] = uS(false);

  uE(() => {
    let cancelled = false;
    let attempts = 0;
    const find = async () => {
      attempts++;
      const obras = await window.__db.obras.toArray();
      const stored = window.__getObraActivaId?.();
      const a = (stored && obras.find(o => o.id === stored && !o.deleted_at))
             || obras.find(o => !o.deleted_at);
      if (a) { if (!cancelled) setObraId(a.id); return; }
      if (cancelled || attempts >= 10) return;
      setTimeout(find, 500);
    };
    find();
    const onChange = () => { attempts = 0; find(); };
    window.addEventListener('jarvex_master_updated', onChange);
    window.addEventListener('obra_activa_change', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('jarvex_master_updated', onChange);
      window.removeEventListener('obra_activa_change', onChange);
    };
  }, []);

  const { data: personal } = window.__hooks.usePersonal(obraId);
  const { data: asistencias, loading, create: createAsistencia, update: updateAsistencia, refresh } = window.__hooks.useAsistencia(obraId);

  // Asistencia del día seleccionado
  const delDia = uM(() => asistencias?.filter(a => a.fecha === date) ?? [], [asistencias, date]);

  // Trabajadores con fecha_ingreso ≤ fecha seleccionada (excluye los que aún no ingresaron)
  const yaIngresoEnFecha = (p) => !p.fecha_ingreso || String(p.fecha_ingreso) <= date;

  // KPIs del día
  const kpis = uM(() => {
    const total = personal?.filter(p => p.estado === 'activo' && yaIngresoEnFecha(p)).length ?? 0;
    const presentes = delDia.filter(a => a.estado_asistencia === 'asistio').length;
    const tardanzas = delDia.filter(a => a.estado_asistencia === 'tardanza').length;
    const faltas    = delDia.filter(a => a.estado_asistencia === 'falta').length;
    const permisos  = delDia.filter(a => a.estado_asistencia === 'permiso').length;
    const horas     = delDia.reduce((s, a) => s + Number(a.horas_trabajadas || 0), 0);
    return { total, presentes, tardanzas, faltas, permisos, horas };
  }, [delDia, personal]);

  const ESTADO_STYLE = {
    asistio:  { class:'b-green',  label:'Asistió' },
    tardanza: { class:'b-yellow', label:'Tardanza' },
    falta:    { class:'b-red',    label:'Falta' },
    permiso:  { class:'b-blue',   label:'Permiso' },
    descanso: { class:'b-gray',   label:'Descanso' },
  };

  // Mapear personal activo con su asistencia del día
  // Excluye trabajadores cuya fecha_ingreso es posterior a la fecha seleccionada
  // (no se les puede tomar asistencia antes de ingresar oficialmente)
  const personalConAsistencia = uM(() => {
    if (!personal) return [];
    return personal
      .filter(p => p.estado === 'activo' && yaIngresoEnFecha(p))
      .map(p => {
        const reg = delDia.find(a => a.personal_id === p.id);
        return { ...p, asistencia: reg };
      });
  }, [personal, delDia, date]);

  const calcularHoras = (entrada, salida) => {
    if (!entrada || !salida) return 0;
    const [h1, m1] = entrada.split(':').map(Number);
    const [h2, m2] = salida.split(':').map(Number);
    const diff = (h2 + m2/60) - (h1 + m1/60);
    return Math.max(0, Math.round(diff * 100) / 100);
  };

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { showToast('Foto muy grande (máx 8 MB)', 'red'); return; }
    setPhotoBlob(file);
    setPhotoUrl(URL.createObjectURL(file));
  };

  // ── MODAL MASIVO ────────────────────────────────────────
  const openMasivo = () => {
    // Pre-llenar las filas con personal activo, marcando "asistio" por defecto
    // o el estado existente si ya hay asistencia para esa fecha
    const initialRows = personalConAsistencia.map(p => {
      const a = p.asistencia;
      return {
        personal_id: p.id,
        nombre: `${p.nombres || ''} ${p.apellidos || ''}`.trim(),
        cargo: p.cargo || '—',
        existing_id: a?.id || null,
        estado_asistencia: a?.estado_asistencia || 'asistio',
        hora_ingreso: a?.hora_ingreso || '07:00',
        hora_salida:  a?.hora_salida  || '17:00',
        observaciones: a?.observaciones || '',
      };
    });
    setRows(initialRows);
    setPhotoBlob(null);
    setPhotoUrl(null);
    setModal('masivo');
  };

  const updateRow = (idx, patch) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  };

  const aplicarATodos = (estado) => {
    setRows(prev => prev.map(r => ({ ...r, estado_asistencia: estado })));
  };

  // ── OCR del parte físico ─────────────────────────────────
  // Lee una foto/PDF del parte de asistencia con Claude Sonnet Vision,
  // matchea contra el personal activo y precarga el state `rows`.
  // NUNCA guarda solo: el usuario revisa y luego clickea "Guardar".
  const handleOcrPicked = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permitir reintentar mismo archivo
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { showToast('Archivo muy grande (máx 8 MB)', 'red'); return; }

    setOcrBusy(true);
    try {
      const personalConocido = (personalConAsistencia || []).map(p => ({
        id: p.id,
        nombres: p.nombres || '',
        apellidos: p.apellidos || '',
        dni: p.dni || null,
      }));

      const out = await ocrAsistencia(file, personalConocido, date);
      const filas = out?.result?.fila_detectada || [];
      const confianza = typeof out?.confianza === 'number' ? out.confianza : 0;

      // Aplicar al state: para cada fila con match_id, setear horas+estado.
      // Para filas sin match → agregar al final con flag is_nuevo.
      setRows(prev => {
        const next = prev.map(r => ({ ...r }));
        const nuevos = [];
        for (const f of filas) {
          const idx = f.match_id_o_null
            ? next.findIndex(r => r.personal_id === f.match_id_o_null)
            : -1;
          const obs = f.observaciones || '';
          if (idx >= 0) {
            const isFalta = f.estado === 'falta';
            next[idx] = {
              ...next[idx],
              estado_asistencia: f.estado || next[idx].estado_asistencia,
              hora_ingreso: !isFalta && f.hora_entrada ? f.hora_entrada : next[idx].hora_ingreso,
              hora_salida:  !isFalta && f.hora_salida_o_null ? f.hora_salida_o_null : next[idx].hora_salida,
              observaciones: obs ? (next[idx].observaciones ? `${next[idx].observaciones} · ${obs}` : obs) : next[idx].observaciones,
              ocr_confianza: f.confianza_fila,
            };
          } else {
            nuevos.push({
              personal_id: `__nuevo_${nuevos.length}_${Date.now()}`,
              nombre: f.nombre_detectado || '(sin nombre)',
              cargo: f.dni_detectado_o_null ? `DNI ${f.dni_detectado_o_null}` : '—',
              existing_id: null,
              estado_asistencia: f.estado || 'asistio',
              hora_ingreso: f.hora_entrada || '07:00',
              hora_salida:  f.hora_salida_o_null || '17:00',
              observaciones: obs || '(detectado por OCR · revisar)',
              is_nuevo: true,
              ocr_confianza: f.confianza_fila,
            });
          }
        }
        return [...next, ...nuevos];
      });

      const n = filas.length;
      if (confianza >= 0.85) {
        (window.__showToast || showToast)?.(`✓ ${n} filas detectadas, listas para revisar`, 'green');
      } else {
        (window.__showToast || showToast)?.(`⚠ Confianza baja (${(confianza*100).toFixed(0)}%) · revisar fila por fila`, 'amber');
      }

      // Audit log de la sugerencia IA
      try {
        await window.__logAudit?.({
          action: 'insert',
          table: 'audit',
          recordId: 'ocr-asistencia',
          tag: 'ai-suggestion',
          reason: `OCR parte asistencia · ${n} filas · confianza ${confianza.toFixed(2)}`,
        });
      } catch (e) {}
    } catch (err) {
      console.warn('[ocr-asistencia]', err);
      const msg = err?.status === 503
        ? 'OCR no disponible: falta ANTHROPIC_API_KEY en el server'
        : (err?.message || 'No se pudo leer el parte');
      showToast(msg, 'red');
    } finally {
      setOcrBusy(false);
    }
  };

  const handleSubmitMasivo = async () => {
    if (rows.length === 0) {
      showToast('No hay personal activo para registrar', 'red');
      return;
    }
    // No permitir asistencia con fecha futura
    const hoy = new Date().toISOString().slice(0, 10);
    if (date > hoy) {
      showToast('No podés registrar asistencia de una fecha futura', 'red');
      return;
    }
    setBusy(true);
    try {
      // 1. Subir UNA evidencia compartida si hay foto
      let evidId = null;
      if (photoBlob) {
        evidId = window.__newId();
        await window.__saveEvidenciaLocal({
          id: evidId,
          obra_id: obraId,
          tipo_evidencia: 'foto_asistencia',
          modulo_relacionado: 'asistencia',
          registro_relacionado_id: null, // diaria, no atada a un solo trabajador
          nombre_archivo: `asistencia_diaria_${date}.jpg`,
          mime_type: photoBlob.type || 'image/jpeg',
          blob: photoBlob,
          fecha: date,
          created_by: auth?.profile?.id || 'offline',
        });
      }

      // 2. Crear o actualizar cada asistencia
      let okCount = 0;
      let errCount = 0;
      let skipNuevos = 0;
      for (const r of rows) {
        // Filas detectadas por OCR sin match contra personal real → no se pueden guardar
        // sin crear primero al trabajador; el usuario debe darlos de alta en Personal.
        if (r.is_nuevo) { skipNuevos++; continue; }
        try {
          const horas = r.estado_asistencia === 'falta' ? 0 : calcularHoras(r.hora_ingreso, r.hora_salida);
          const payload = {
            obra_id: obraId,
            personal_id: r.personal_id,
            fecha: date,
            hora_ingreso: r.estado_asistencia === 'falta' ? null : r.hora_ingreso,
            hora_salida:  r.estado_asistencia === 'falta' ? null : r.hora_salida,
            horas_trabajadas: horas,
            estado_asistencia: r.estado_asistencia,
            observaciones: r.observaciones?.trim() || null,
            evidencia_id: evidId || null,
          };
          if (r.existing_id) {
            await updateAsistencia(r.existing_id, payload);
          } else {
            await createAsistencia(payload);
          }
          okCount++;
        } catch (e) {
          errCount++;
          console.warn('asistencia row failed', r.personal_id, e);
        }
      }
      refresh();
      // Audit: una sola entrada por sesión masiva — el detalle queda en new_data
      try {
        await window.__logAudit?.({
          action: 'insert',
          table: 'asistencia',
          recordId: null,
          newData: {
            fecha: date,
            ok: okCount,
            errores: errCount,
            evidencia_id: evidId,
            registros: rows.map(r => ({ personal_id: r.personal_id, estado: r.estado_asistencia, ingreso: r.hora_ingreso, salida: r.hora_salida })),
          },
          reason: `Asistencia diaria masiva (${okCount} trabajadores)`,
        });
      } catch (e) {}
      showToast(
        `Asistencia diaria guardada · ${okCount} registros${errCount ? ` · ${errCount} con error` : ''}${skipNuevos ? ` · ${skipNuevos} fila(s) OCR nuevas omitidas (registralas primero en Personal)` : ''}`,
        (errCount || skipNuevos) ? 'amber' : 'green'
      );
      setModal(null); setPhotoBlob(null); setPhotoUrl(null); setRows([]);
    } catch (e) {
      showToast('Error: ' + e.message, 'red');
    } finally {
      setBusy(false);
    }
  };

  // ── MODAL EDITAR INDIVIDUAL ─────────────────────────────
  const openEditar = (asistencia, p) => {
    setEditingAsist(asistencia);
    setEditForm({
      personal_nombre: `${p.nombres} ${p.apellidos}`.trim(),
      estado_asistencia: asistencia.estado_asistencia || 'asistio',
      hora_ingreso: asistencia.hora_ingreso || '07:00',
      hora_salida:  asistencia.hora_salida  || '17:00',
      observaciones: asistencia.observaciones || '',
    });
    setModal('editar');
  };

  const handleSubmitEditar = async () => {
    if (!editingAsist) return;
    setBusy(true);
    try {
      const horas = editForm.estado_asistencia === 'falta'
        ? 0
        : calcularHoras(editForm.hora_ingreso, editForm.hora_salida);
      const newFields = {
        estado_asistencia: editForm.estado_asistencia,
        hora_ingreso: editForm.estado_asistencia === 'falta' ? null : editForm.hora_ingreso,
        hora_salida:  editForm.estado_asistencia === 'falta' ? null : editForm.hora_salida,
        horas_trabajadas: horas,
        observaciones: editForm.observaciones?.trim() || null,
      };
      await updateAsistencia(editingAsist.id, newFields);
      try { await window.__logAudit?.({ action:'update', table:'asistencia', recordId:editingAsist.id, oldData:editingAsist, newData:newFields, reason:`Corrección manual de asistencia (${editForm.personal_nombre})` }); } catch(e) {}
      refresh();
      showToast('Asistencia actualizada', 'green');
      setModal(null); setEditingAsist(null); setEditForm({});
    } catch (e) {
      showToast('Error: ' + e.message, 'red');
    } finally {
      setBusy(false);
    }
  };

  if (!obraId) return <SinObraEmpty icon="calendar"/>;
  if (loading) {
    return <div className="page-wrap"><div className="empty-state"><JxIcon name="calendar" size={32} color="var(--tm)"/><p>Cargando asistencia…</p></div></div>;
  }

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div><div className="pg-title">Control de Asistencia</div><div className="pg-sub">Registro diario masivo · 1 evidencia por día</div></div>
        <div style={{display:'flex',gap:8,alignItems:'center', flexWrap:'wrap'}}>
          <input className="fi" type="date" max={new Date().toISOString().slice(0,10)} value={date} onChange={e=>setDate(e.target.value)} style={{width:'auto'}}/>
          {canWrite ? (
            <button className="btn btn-amber btn-sm" onClick={openMasivo}>
              <JxIcon name="users" size={13}/>Registrar Asistencia Diaria
            </button>
          ) : (
            <span className="badge b-gray" title="Tu rol es solo lectura para Asistencia">Solo lectura</span>
          )}
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
        {[
          {label:'Total Personal',val:kpis.total,color:'var(--blue)'},
          {label:'Presentes',val:kpis.presentes,color:'var(--green)'},
          {label:'Tardanzas',val:kpis.tardanzas,color:'var(--yellow)'},
          {label:'Faltas/Permisos',val:kpis.faltas + kpis.permisos,color:'var(--red)'},
        ].map((s,i)=>(
          <div key={i} className="card card-p" style={{borderColor:s.color+'30'}}>
            <div style={{fontSize:11,color:'var(--tm)',fontWeight:500}}>{s.label}</div>
            <div style={{fontSize:28,fontWeight:800,color:s.color,lineHeight:1.1,margin:'6px 0 2px'}}>{s.val}</div>
            <div className="progress-bar"><div className="progress-fill" style={{width:`${kpis.total ? (s.val/kpis.total)*100 : 0}%`,background:s.color}}/></div>
          </div>
        ))}
      </div>

      <div className="card" style={{overflow:'hidden'}}>
        <table className="tbl">
          <thead><tr>
            <th>Trabajador</th><th>Cargo</th><th>H. Ingreso</th>
            <th>H. Salida</th><th>Hrs. Trabajadas</th><th>Estado</th><th>Evidencia</th><th>Acciones</th>
          </tr></thead>
          <tbody>
            {personalConAsistencia.length === 0 ? (
              <tr><td colSpan={8} style={{textAlign:'center', padding:32, color:'var(--tm)'}}>No hay personal registrado en esta obra</td></tr>
            ) : personalConAsistencia.map(p => {
              const a = p.asistencia;
              const e = a ? ESTADO_STYLE[a.estado_asistencia] : null;
              return (
                <tr key={p.id}>
                  <td className="col-p">{p.nombres} {p.apellidos}</td>
                  <td>{p.cargo || '—'}</td>
                  <td className="col-num">{a?.hora_ingreso || '—'}</td>
                  <td className="col-num">{a?.hora_salida || '—'}</td>
                  <td className="col-num"><span style={{color:a?.horas_trabajadas>0?'var(--tp)':'var(--tm)',fontWeight:600}}>{a?.horas_trabajadas>0 ? Number(a.horas_trabajadas).toFixed(1)+' h' : '—'}</span></td>
                  <td>{e ? <span className={`badge ${e.class}`}>{e.label}</span> : <span className="badge b-gray">Sin marcar</span>}</td>
                  <td>{a?.evidencia_id ? <span className="badge b-blue"><JxIcon name="camera" size={10}/> Foto</span> : <span className="col-m">—</span>}</td>
                  <td>
                    {a && (
                      <button className="btn btn-ghost btn-xs" title="Editar asistencia" onClick={()=>openEditar(a, p)}>
                        <JxIcon name="edit" size={11}/>
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{padding:'12px 16px',borderTop:'1px solid var(--border)',fontSize:11.5,color:'var(--tm)'}}>
          <span>Total horas trabajadas: <strong style={{color:'var(--tp)'}}>{kpis.horas.toFixed(1)} hrs</strong></span>
        </div>
      </div>

      {/* ── MODAL MASIVO — registro diario de toda la cuadrilla ── */}
      {modal === 'masivo' && <Modal title={`Asistencia Diaria · ${date}`} icon="users" onClose={()=>{setModal(null); setPhotoBlob(null); setPhotoUrl(null); setRows([]);}}>
        {rows.length === 0 ? (
          <div style={{padding:'30px 0', textAlign:'center', color:'var(--tm)'}}>
            <JxIcon name="users" size={32} color="var(--tm)"/>
            <p style={{fontSize:13, marginTop:8}}>No hay personal activo en esta obra. Registra trabajadores primero.</p>
          </div>
        ) : (
        <>
          <div style={{display:'flex', gap:8, marginBottom:10, flexWrap:'wrap', alignItems:'center', padding:'10px 12px', border:'1px dashed var(--border-h)', borderRadius:8, background:'var(--bg-soft, transparent)'}}>
            <span style={{fontSize:11.5, color:'var(--tm)', fontWeight:600}}>Acelerá con IA:</span>
            <label className={`btn btn-amber btn-sm ${ocrBusy ? 'disabled' : ''}`} style={{cursor: ocrBusy ? 'wait' : 'pointer', opacity: ocrBusy ? 0.7 : 1}}>
              <JxIcon name="camera" size={13}/>
              {ocrBusy ? 'Leyendo parte…' : '📷 Cargar parte (OCR)'}
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={ocrBusy}
                     onChange={handleOcrPicked} style={{display:'none'}}/>
            </label>
            <span style={{fontSize:10.5, color:'var(--tm)'}}>Foto/PDF del parte físico · Claude Sonnet Vision</span>
          </div>
          <div style={{display:'flex', gap:8, marginBottom:12, flexWrap:'wrap', alignItems:'center'}}>
            <span style={{fontSize:11.5, color:'var(--tm)'}}>Aplicar a todos:</span>
            <button className="btn btn-green btn-xs" onClick={()=>aplicarATodos('asistio')}>✓ Asistió</button>
            <button className="btn btn-ghost btn-xs" onClick={()=>aplicarATodos('tardanza')}>Tardanza</button>
            <button className="btn btn-red btn-xs" onClick={()=>aplicarATodos('falta')}>Falta</button>
            <button className="btn btn-blue btn-xs" onClick={()=>aplicarATodos('permiso')}>Permiso</button>
            <button className="btn btn-ghost btn-xs" onClick={()=>aplicarATodos('descanso')}>Descanso</button>
          </div>

          <div style={{maxHeight:'45vh', overflowY:'auto', border:'1px solid var(--border)', borderRadius:8}}>
            <table className="tbl" style={{minWidth:560}}>
              <thead><tr>
                <th>Trabajador</th><th>Estado</th><th>Ingreso</th><th>Salida</th><th>Observaciones</th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const isFalta = r.estado_asistencia === 'falta';
                  return (
                    <tr key={r.personal_id} style={r.is_nuevo ? {background:'rgba(245,158,11,0.08)'} : undefined}>
                      <td className="col-p" style={{fontSize:12}}>
                        {r.nombre}
                        {r.is_nuevo && <span className="badge b-yellow" style={{marginLeft:6, fontSize:9.5}}>NUEVO · OCR</span>}
                        {!r.is_nuevo && typeof r.ocr_confianza === 'number' && (
                          <span className="badge b-blue" style={{marginLeft:6, fontSize:9.5}}>OCR {(r.ocr_confianza*100).toFixed(0)}%</span>
                        )}
                        {r.cargo !== '—' && <div style={{fontSize:10.5, color:'var(--tm)'}}>{r.cargo}</div>}
                      </td>
                      <td>
                        <select className="fi" style={{padding:'5px 8px', fontSize:11.5}}
                                value={r.estado_asistencia}
                                onChange={e=>updateRow(i, { estado_asistencia: e.target.value })}>
                          <option value="asistio">Asistió</option>
                          <option value="tardanza">Tardanza</option>
                          <option value="falta">Falta</option>
                          <option value="permiso">Permiso</option>
                          <option value="descanso">Descanso</option>
                        </select>
                      </td>
                      <td>
                        <input className="fi" type="time" disabled={isFalta} style={{padding:'5px 8px', fontSize:11.5, opacity: isFalta ? 0.4 : 1}}
                               value={r.hora_ingreso}
                               onChange={e=>updateRow(i, { hora_ingreso: e.target.value })}/>
                      </td>
                      <td>
                        <input className="fi" type="time" disabled={isFalta} style={{padding:'5px 8px', fontSize:11.5, opacity: isFalta ? 0.4 : 1}}
                               value={r.hora_salida}
                               onChange={e=>updateRow(i, { hora_salida: e.target.value })}/>
                      </td>
                      <td>
                        <input className="fi" placeholder="—" style={{padding:'5px 8px', fontSize:11.5}}
                               value={r.observaciones}
                               onChange={e=>updateRow(i, { observaciones: e.target.value })}/>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{marginTop:16}}>
            <label className="flabel">Evidencia diaria (foto del formato físico firmado)</label>
            {photoUrl ? (
              <div style={{position:'relative', display:'inline-block'}}>
                <img src={photoUrl} alt="evidencia diaria" style={{maxHeight:180, borderRadius:8, border:'1px solid var(--border)'}}/>
                <button onClick={()=>{setPhotoBlob(null); setPhotoUrl(null);}}
                        style={{position:'absolute', top:6, right:6, background:'rgba(231,76,60,0.9)', color:'white', border:'none', borderRadius:'50%', width:24, height:24, cursor:'pointer'}}>×</button>
              </div>
            ) : (
              <label style={{display:'block', border:'1.5px dashed var(--border-h)', borderRadius:8, padding:'16px', textAlign:'center', color:'var(--tm)', fontSize:12, cursor:'pointer'}}>
                <JxIcon name="camera" size={20} color="var(--tm)"/>
                <div style={{marginTop:6}}>Subir foto del formato firmado del día</div>
                <div style={{marginTop:2, fontSize:10.5}}>(Una sola foto para toda la cuadrilla)</div>
                <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} style={{display:'none'}}/>
              </label>
            )}
          </div>
        </>
        )}

        <div className="modal-actions">
          <button className="btn btn-ghost" disabled={busy} onClick={()=>{setModal(null); setPhotoBlob(null); setPhotoUrl(null); setRows([]);}}>Cancelar</button>
          <button className="btn btn-amber" disabled={busy || rows.length === 0} onClick={handleSubmitMasivo}>
            <JxIcon name="check" size={13}/>{busy ? 'Guardando…' : `Guardar ${rows.length} registros`}
          </button>
        </div>
      </Modal>}

      {/* ── MODAL EDITAR INDIVIDUAL ── */}
      {modal === 'editar' && <Modal title={`Editar Asistencia · ${editForm.personal_nombre || ''}`} icon="edit" onClose={()=>{setModal(null); setEditingAsist(null); setEditForm({});}}>
        <div className="g2">
          <div style={{gridColumn:'1/-1'}}><label className="flabel">Estado</label>
            <select className="fi" value={editForm.estado_asistencia||'asistio'} onChange={e=>setEditForm({...editForm, estado_asistencia:e.target.value})}>
              <option value="asistio">Asistió</option>
              <option value="tardanza">Tardanza</option>
              <option value="falta">Falta</option>
              <option value="permiso">Permiso</option>
              <option value="descanso">Descanso</option>
            </select>
          </div>
          {editForm.estado_asistencia !== 'falta' && <>
            <div><label className="flabel">Hora ingreso</label><input className="fi" type="time" value={editForm.hora_ingreso||''} onChange={e=>setEditForm({...editForm, hora_ingreso:e.target.value})}/></div>
            <div><label className="flabel">Hora salida</label><input className="fi" type="time" value={editForm.hora_salida||''} onChange={e=>setEditForm({...editForm, hora_salida:e.target.value})}/></div>
          </>}
          <div style={{gridColumn:'1/-1'}}><label className="flabel">Observaciones</label>
            <textarea className="fi" value={editForm.observaciones||''} onChange={e=>setEditForm({...editForm, observaciones:e.target.value})} placeholder="Opcional..."/>
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" disabled={busy} onClick={()=>{setModal(null); setEditingAsist(null); setEditForm({});}}>Cancelar</button>
          <button className="btn btn-amber" disabled={busy} onClick={handleSubmitEditar}>
            <JxIcon name="check" size={13}/>{busy ? 'Guardando…' : 'Guardar Cambios'}
          </button>
        </div>
      </Modal>}
    </div>
  );
}

// ── Modal de cierre manual de recepción (Paquete B) ────────────────
// La almacenera lo abre desde el banner de facturas pendientes. Calcula
// items recibidos vs facturados y obliga a escribir una observación
// (ej. "completo", "proveedor adeuda 5 ud", "faltante por devolución").
function CerrarRecepcionModal({ factura, progreso, onClose, onConfirm }) {
  const [observacion, setObservacion] = uS('');
  const [saving, setSaving] = uS(false);
  let itemsFactura = [];
  try {
    const j = JSON.parse(factura.notas || '{}');
    itemsFactura = Array.isArray(j.items_factura) ? j.items_factura : [];
  } catch {}
  const totalItems = itemsFactura.length;
  const totalQty = itemsFactura.reduce((s, it) => s + Number(it.cantidad || 0), 0);
  const prog = progreso || { items: 0, qty: 0 };
  const incompleta = totalItems > 0 && (prog.items < totalItems || prog.qty < totalQty);
  const placeholder = incompleta
    ? 'Ej: Proveedor quedó debiendo 5 unidades · Faltante justificado por devolución'
    : 'Ej: Entrega completa · Todo recibido OK';

  const submit = async () => {
    setSaving(true);
    try { await onConfirm(observacion); }
    finally { setSaving(false); }
  };

  return (
    <Modal title="Marcar recepción completa" icon="check" onClose={onClose}>
      <div style={{ fontSize:12.5, color:'var(--ts)', marginBottom:10, lineHeight:1.5 }}>
        Cerrando recepción de <strong>{factura.document_number || 'sin nº'}</strong> · {factura.third_party_name || '—'}.
      </div>
      {totalItems > 0 && (
        <div style={{ padding:10, background:'rgba(0,0,0,0.18)', borderRadius:6, marginBottom:12, fontSize:11.5 }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
            <span style={{ color:'var(--tm)' }}>Items recibidos</span>
            <span style={{ color: prog.items >= totalItems ? 'var(--green)' : 'var(--amber)' }}>
              {prog.items} de {totalItems}
            </span>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between' }}>
            <span style={{ color:'var(--tm)' }}>Cantidad total</span>
            <span style={{ color: prog.qty >= totalQty ? 'var(--green)' : 'var(--amber)' }}>
              {prog.qty.toLocaleString()} de {totalQty.toLocaleString()}
            </span>
          </div>
          {incompleta && (
            <div style={{ marginTop:8, padding:'6px 8px', background:'rgba(231,76,60,0.10)', border:'1px solid rgba(231,76,60,0.3)', borderRadius:4, color:'var(--red)', fontSize:11 }}>
              ⚠ La entrega no está completa. La observación es obligatoria para justificar el cierre.
            </div>
          )}
        </div>
      )}
      <div style={{ marginBottom:10 }}>
        <label className="flabel">Observación (mín 5 caracteres)</label>
        <textarea className="fi" rows={3}
          placeholder={placeholder}
          value={observacion}
          onChange={e=>setObservacion(e.target.value)}/>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-amber" onClick={submit} disabled={saving || observacion.trim().length < 5}>
          <JxIcon name="check" size={13}/> {saving ? 'Cerrando…' : 'Cerrar recepción'}
        </button>
      </div>
    </Modal>
  );
}

// ── Modal de Traspaso entre ubicaciones ────────────────────────────
// Elegí material → ubicación origen (muestra cuánto hay) → destino →
// cantidad. Mueve stock entre almacenes sin cambiar el total.
function TraspasoModal({ materiales, ubicaciones, ubicacionesById, getDesgloseDe, onClose, onConfirm }) {
  const [materialId, setMaterialId] = uS('');
  const [origenId, setOrigenId] = uS('');
  const [destinoId, setDestinoId] = uS('');
  const [cantidad, setCantidad] = uS('');
  const [saving, setSaving] = uS(false);

  const dg = materialId ? getDesgloseDe(materialId) : null;
  // Ubicaciones donde HAY stock de este material (para el origen).
  const origenes = dg ? Array.from(dg.entries()).filter(([,c]) => Number(c) > 0) : [];
  const dispoOrigen = origenId && dg ? Number(dg.get(origenId) || 0) : 0;
  const cant = Number(cantidad) || 0;
  const valido = materialId && origenId && destinoId && origenId !== destinoId && cant > 0 && cant <= dispoOrigen;

  const submit = async () => {
    setSaving(true);
    try { await onConfirm({ material_id: materialId, origenId, destinoId, cantidad: cant }); }
    finally { setSaving(false); }
  };

  return (
    <Modal title="Traspaso entre ubicaciones" icon="refresh" onClose={onClose}>
      <div style={{ fontSize:12, color:'var(--tm)', marginBottom:12, lineHeight:1.5 }}>
        Mové stock de un almacén a otro. Se registra como salida + entrada y el stock total del material no cambia.
      </div>
      <div style={{ marginBottom:10 }}>
        <label className="flabel">Material</label>
        <SearchableSelect
          value={materialId}
          onChange={v => { setMaterialId(v); setOrigenId(''); setDestinoId(''); }}
          options={[{ value:'', label:'— Selecciona —' }, ...materiales.map(m => ({ value:m.id, label:m.nombre_material }))]}
          placeholder="— Selecciona material —"/>
      </div>
      {materialId && (
        <>
          {origenes.length === 0 ? (
            <div style={{ padding:'10px 12px', background:'rgba(242,183,5,0.08)', border:'1px solid rgba(242,183,5,0.3)', borderRadius:6, fontSize:12, color:'var(--ts)' }}>
              Este material no tiene stock distribuido por ubicación todavía. Registrá un ingreso eligiendo la ubicación primero.
            </div>
          ) : (
            <div className="g2">
              <div>
                <label className="flabel">Desde (origen)</label>
                <select className="fi" value={origenId} onChange={e=>setOrigenId(e.target.value)}>
                  <option value="">— Origen —</option>
                  {origenes.map(([uid, c]) => (
                    <option key={uid} value={uid}>{ubicacionesById.get(uid)?.nombre || '—'} · {Number(c).toLocaleString('es-PE')} disp.</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="flabel">Hacia (destino)</label>
                <select className="fi" value={destinoId} onChange={e=>setDestinoId(e.target.value)}>
                  <option value="">— Destino —</option>
                  {ubicaciones.filter(u => u.id !== origenId).map(u => (
                    <option key={u.id} value={u.id}>{u.nombre}</option>
                  ))}
                </select>
              </div>
              <div style={{ gridColumn:'1/-1' }}>
                <label className="flabel">Cantidad a traspasar {origenId ? `(máx ${dispoOrigen})` : ''}</label>
                <input className="fi" type="number" min="0" step="0.01" max={dispoOrigen}
                  value={cantidad} onChange={e=>setCantidad(e.target.value)} placeholder="0"/>
                {cant > dispoOrigen && <div style={{ fontSize:10.5, color:'var(--red)', marginTop:3 }}>No podés traspasar más de lo disponible en el origen.</div>}
              </div>
            </div>
          )}
        </>
      )}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-amber" onClick={submit} disabled={!valido || saving}>
          <JxIcon name="refresh" size={13}/> {saving ? 'Traspasando…' : 'Confirmar traspaso'}
        </button>
      </div>
    </Modal>
  );
}

// Modal vive ahora en jx-modal.jsx (eager). Acá solo exponemos las páginas.
Object.assign(window, { MaterialesPage, HerramientasPage, PersonalPage, AsistenciaPage });