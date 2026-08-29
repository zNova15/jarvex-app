// ═══════════════════════════════════════════════════════════════════
// JARVEX — INGENIERÍA DE FRENTE: 5 módulos independientes del ingeniero.
// DashboardTecnicoPage · MisPartidasPage · SalidasFrentePage ·
// ReporteDiarioPage · PlanRealPage. Comparten MiFrenteShell (datos + scope por
// frentesDeUsuario/partidasDeFrente). Sin información monetaria (solo metrados
// y cantidades). El semáforo de rendimiento sale de rendimientoPartida.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { frentesDeUsuario, partidasDeFrente, frentesDePartida } from "../lib/frente-partidas.js";
import { resumenFrente, planVsReal, rollupMensual, rendimientoPartida, rendimientoConjunto, ventanaPartida, rollupAvancePorCodigo, hojasDeCapitulo, consolidarInsumos } from "../lib/mi-frente.js";
import { hijosDirectos, cadenaBreadcrumb } from "../lib/partida-arbol.js";
import { hoyLocal, fmtFechaCorta } from "../lib/fecha.js";
import { colorIngeniero, segmentarAvance } from "../lib/color-ingeniero.js";
import { SearchableSelect } from "./jx-searchable-select.jsx";
import { filtrarPartidasReporte, limpiarDescripcionReuso } from "../lib/filtrar-partidas.js";

const { useState: uS, useMemo: uM, useEffect: uE, useRef: uR } = React;

// Los inputs del reporte llevan fontSize 16: iOS Safari hace ZOOM automático al
// enfocar cualquier input con fuente <16px (el global .fi queda en 14px en móvil)
// — con 4+ campos por partida el viewport saltaba en cada tap.
const FI16 = { fontSize: 16 };

// ── Campo de fotos móvil-first (mejora sep-2026) ─────────────────────
// Reemplaza el input file crudo: dos botones grandes ("Tomar foto" abre la
// cámara directo vía capture=environment; "Galería" abre el picker) +
// miniaturas reales con botón de quitar. Los inputs viven ocultos dentro de
// cada label — sin refs ni ids. El submit sigue siendo de quien lo usa.
function ThumbFoto({ file, onQuitar }) {
  const [url, setUrl] = uS(null);
  uE(() => {
    let u = null;
    try { u = URL.createObjectURL(file); setUrl(u); } catch { setUrl(null); }
    return () => { if (u) { try { URL.revokeObjectURL(u); } catch {} } };
  }, [file]);
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      {url
        ? <img src={url} alt={file?.name || 'foto'} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--bd)', display: 'block' }} />
        : <span style={{ width: 64, height: 64, borderRadius: 6, border: '1px solid var(--bd)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>📷</span>}
      <button onClick={onQuitar} title="Quitar foto"
        style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', border: 'none', background: 'var(--red)', color: '#fff', fontSize: 11, lineHeight: '20px', padding: 0, cursor: 'pointer' }}>✕</button>
    </span>
  );
}

function FotosField({ fotos, max, onAdd, onQuitar }) {
  const lleno = (fotos || []).length >= max;
  const recibir = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) onAdd(files);
    e.target.value = '';   // permite re-elegir el mismo archivo
  };
  const btnStyle = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 14px', fontSize: 13, cursor: lleno ? 'not-allowed' : 'pointer', opacity: lleno ? 0.5 : 1 };
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label className="btn btn-ghost" style={btnStyle}>
          📷 Tomar foto
          <input type="file" accept="image/*" capture="environment" disabled={lleno} onChange={recibir} style={{ display: 'none' }} />
        </label>
        <label className="btn btn-ghost" style={btnStyle}>
          🖼️ Galería
          <input type="file" accept="image/*" multiple disabled={lleno} onChange={recibir} style={{ display: 'none' }} />
        </label>
      </div>
      {(fotos || []).length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
          {fotos.map((f, i) => <ThumbFoto key={i} file={f} onQuitar={() => onQuitar(i)} />)}
        </div>
      )}
    </div>
  );
}
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);
const Modal = (p) => (window.Modal ? <window.Modal {...p} /> : null);
const hoyISO = () => hoyLocal();
const num = (x) => Number(x || 0).toLocaleString('es-PE');
const SEM = { verde: 'var(--green)', ambar: 'var(--amber)', rojo: 'var(--red)', sin_dato: 'var(--tm)' };
const SEM_LBL = { verde: 'En ritmo', ambar: 'Atención', rojo: 'Atrasado', sin_dato: 's/plan' };
// Badge de semáforo de rendimiento (a nivel de módulo: lo usan MiFrenteShell y RendimientoIngenierosPage).
const SemBadge = ({ s }) => <span className="badge" style={{ background: SEM[s], color: '#000', fontSize: 9 }}>{SEM_LBL[s]}</span>;
// Barra de avance simple (un solo %): para capítulos (roll-up ponderado de sus hojas).
const BarraSimple = ({ pct }) => {
  const v = Math.max(0, Math.min(100, Number(pct) || 0));
  const color = v >= 100 ? 'var(--green)' : v > 0 ? 'var(--blue)' : 'var(--tm)';
  return (
    <div style={{ minWidth: 96 }}>
      <div style={{ height: 10, borderRadius: 5, overflow: 'hidden', background: 'rgba(255,255,255,0.08)' }}>
        <div style={{ width: v + '%', height: '100%', background: color }} />
      </div>
      <div style={{ fontSize: 10, color: 'var(--tm)', marginTop: 2 }}>{Math.round(v)}% <span style={{ opacity: 0.7 }}>· capítulo</span></div>
    </div>
  );
};
// Plazo planificado de una partida: inicio→fin · N días, o aviso si no se importó del cronograma.
const PlazoMini = ({ p }) => {
  const v = ventanaPartida(p || {});
  if (!v.completa) return <span className="badge b-red" style={{ fontSize: 9 }} title="Sin fechas de ejecución importadas del cronograma">⚠ sin fechas</span>;
  return (
    <div style={{ fontSize: 10, lineHeight: 1.3 }} title={`${v.ini} → ${v.fin} (${v.dias} días)`}>
      <div style={{ color: 'var(--tm)' }}>{fmtFechaCorta(v.ini)} → {fmtFechaCorta(v.fin)}</div>
      <div style={{ color: 'var(--amber)', fontWeight: 600 }}>{v.dias} días</div>
    </div>
  );
};

// Barra de avance multicolor: cada segmento = lo que avanzó un ingeniero (color por id).
function BarraAvance({ partida, avancesPartida, nombreUsuario }) {
  const { segmentos, pctTotal } = segmentarAvance(partida, avancesPartida || []);
  return (
    <div style={{ minWidth: 96 }}>
      <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: 'rgba(255,255,255,0.08)' }}>
        {segmentos.map((s, i) => (
          <div key={i} title={`${nombreUsuario ? nombreUsuario(s.uid) : 'ingeniero'} · ${num(s.metrado)} ${partida.unidad || ''}`}
            style={{ width: s.pct + '%', background: colorIngeniero(s.uid) }} />
        ))}
      </div>
      <div style={{ fontSize: 10, color: 'var(--tm)', marginTop: 2 }}>{Math.round(pctTotal)}%{segmentos.length > 1 ? ` · ${segmentos.length} ing.` : ''}</div>
    </div>
  );
}

function MiFrenteShell({ showToast, vista }) {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const userId = auth?.profile?.id || null;
  const obraHook = window.__useObraActiva ? window.__useObraActiva() : { obraId: null };
  const obraId = obraHook?.obraId || null;

  const { data: frentes } = window.__hooks.useFrentesObra(obraId, { soloActivas: true });
  const { data: frentePartidas } = window.__hooks.useFrentePartidas(obraId);
  const partidasHook = window.__hooks.usePartidas(obraId);
  const { data: partidas } = partidasHook;
  const movHook = window.__hooks.useMovimientosMateriales(obraId);
  const { data: movs } = movHook;
  const { data: materiales } = window.__hooks.useMateriales(obraId);
  const { data: personal } = window.__hooks.usePersonal(obraId);
  const avanceHook = window.__hooks.useAvanceObra(obraId);
  const { data: avances } = avanceHook;
  const metasHook = window.__hooks.useAvanceMetas(obraId);
  const { data: metas } = metasHook;

  const materialesById = uM(() => { const m = new Map(); (materiales || []).forEach(x => m.set(x.id, x)); return m; }, [materiales]);
  const personalById = uM(() => { const m = new Map(); (personal || []).forEach(x => m.set(x.id, x)); return m; }, [personal]);
  // Usuarios (profiles) para el nombre del ingeniero en la barra de avance multicolor.
  const [usuarios, setUsuarios] = uS([]);
  uE(() => { window.__db.profiles.toArray().then(setUsuarios).catch(() => {}); }, []);
  const usuariosById = uM(() => { const m = new Map(); (usuarios || []).forEach(u => m.set(u.id, u)); return m; }, [usuarios]);
  const nombreUsuario = (id) => { if (!id || id === 'sin') return '—'; const u = usuariosById.get(id); return u ? (`${u.nombres || ''} ${u.apellidos || ''}`.trim() || u.email || 'ingeniero') : 'ingeniero'; };
  const avancesPorPartida = uM(() => { const m = new Map(); for (const a of (avances || [])) { if (a.deleted_at) continue; const arr = m.get(a.partida_id) || []; arr.push(a); m.set(a.partida_id, arr); } return m; }, [avances]);

  const solFrenteHook = window.__hooks.useSolicitudesFrente(obraId);
  const { data: solicitudesFrente } = solFrenteHook;
  const solFrentePend = (pid) => (solicitudesFrente || []).some(s => !s.deleted_at && s.partida_id === pid && s.estado === 'solicitado');

  const misFrentes = uM(() => frentesDeUsuario(userId, { frentes: frentes || [] }), [userId, frentes]);
  // "Habilitar otros frentes y partidas": desbloquea seleccionar cualquier frente
  // activo y la vista "Todas las partidas" (incluidas las que no están en ningún frente).
  const [verOtros, setVerOtros] = uS(false);
  const frentesVisibles = uM(() => verOtros ? (frentes || []).filter(f => !f.deleted_at) : misFrentes, [verOtros, frentes, misFrentes]);
  const [frenteSelId, setFrenteSelId] = uS(null);   // id de frente | '__todas'
  const esTodas = verOtros && frenteSelId === '__todas';
  const frenteActivo = uM(() => esTodas ? null : (frentesVisibles.find(f => f.id === frenteSelId) || misFrentes[0] || frentesVisibles[0] || null), [esTodas, frentesVisibles, frenteSelId, misFrentes]);
  const esMiFrente = uM(() => !!frenteActivo && misFrentes.some(f => f.id === frenteActivo.id), [frenteActivo, misFrentes]);
  const allPartidas = uM(() => (partidas || []).filter(p => !p.deleted_at), [partidas]);
  // Conjunto de partidas mostrado/operado: todas (incl. sin frente) o las del frente activo.
  const partidasDelFrente = uM(() => esTodas
    ? allPartidas
    : (frenteActivo ? partidasDeFrente(frenteActivo.id, { frentePartidas: frentePartidas || [], partidas: partidas || [] }) : []),
    [esTodas, allPartidas, frenteActivo, frentePartidas, partidas]);
  const fNomById = uM(() => new Map((frentes || []).map(f => [f.id, f.nombre])), [frentes]);
  // Nombres de frente(s) que cubren una partida (para badges); frente principal (para atribuir el avance).
  const frentesNombresDe = (pid) => frentesDePartida(pid, { frentePartidas: frentePartidas || [], partidas: partidas || [] }).map(id => fNomById.get(id)).filter(Boolean);
  const frenteDePartida = (pid) => { const ids = frentesDePartida(pid, { frentePartidas: frentePartidas || [], partidas: partidas || [] }); return ids[0] || null; };
  const partByIdAll = uM(() => { const m = new Map(); allPartidas.forEach(p => m.set(p.id, p)); return m; }, [allPartidas]);
  // Avance roll-up por capítulo (las barras de los capítulos se llenan con el avance ponderado de sus hojas).
  const rollupAvanceMap = uM(() => rollupAvancePorCodigo(allPartidas), [allPartidas]);

  const resumen = uM(() => resumenFrente({ partidasDelFrente, movimientos: movs || [], avances: avances || [], frenteId: frenteActivo?.id }),
    [frenteActivo, partidasDelFrente, movs, avances]);

  const hoy = hoyISO();
  const rendimientos = uM(() => partidasDelFrente.map(p => ({ p, r: rendimientoPartida(p, avances || [], hoy) })), [partidasDelFrente, avances, hoy]);
  const semConteo = uM(() => rendimientos.reduce((a, x) => { a[x.r.semaforo] = (a[x.r.semaforo] || 0) + 1; return a; }, {}), [rendimientos]);

  const salidasDelFrente = uM(() => frenteActivo
    ? (movs || []).filter(m => !m.deleted_at && m.tipo_movimiento === 'salida' && m.frente_id === frenteActivo.id)
        .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')))
    : [], [frenteActivo, movs]);

  const nombrePart = (p) => `${p.codigo_delfin ? p.codigo_delfin + ' · ' : ''}${p.nombre_partida || '—'}`;
  const partById = uM(() => { const m = new Map(); partidasDelFrente.forEach(p => m.set(p.id, p)); return m; }, [partidasDelFrente]);

  // ── Mis Partidas: árbol desplegable + insumos (SIN costos) ────────
  const [insumosObra, setInsumosObra] = uS([]);
  uE(() => {
    if (!obraId) { setInsumosObra([]); return; }
    let c = false;
    const load = () => window.__db.insumos_partida.where('obra_id').equals(obraId).filter(i => !i.deleted_at).toArray().then(r => { if (!c) setInsumosObra(r); }).catch(() => {});
    load();
    const on = (e) => { const t = e?.detail?.tabla; if (!t || t === 'insumos_partida') load(); };
    window.addEventListener('jx_data_changed', on);
    return () => { c = true; window.removeEventListener('jx_data_changed', on); };
  }, [obraId]);
  const insumosPorPartida = uM(() => { const m = new Map(); for (const i of insumosObra) { const a = m.get(i.partida_id) || []; a.push(i); m.set(i.partida_id, a); } return m; }, [insumosObra]);
  const [expandidos, setExpandidos] = uS(() => new Set());
  const toggleExp = (code) => setExpandidos(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n; });
  const [filtroPart, setFiltroPart] = uS('');
  // Pestañas de "Partidas del Proyecto": Mis partidas vs Otras partidas.
  const [partidasTab, setPartidasTab] = uS('mias');   // 'mias' | 'otras'
  const [otrasScope, setOtrasScope] = uS('todas');    // 'todas' | frenteId
  const misPartidas = uM(() => {
    const m = new Map();
    for (const f of misFrentes) for (const p of partidasDeFrente(f.id, { frentePartidas: frentePartidas || [], partidas: partidas || [] })) m.set(p.id, p);
    return [...m.values()];
  }, [misFrentes, frentePartidas, partidas]);
  const misPartidasIds = uM(() => new Set(misPartidas.map(p => p.id)), [misPartidas]);
  const otrasPartidas = uM(() => otrasScope !== 'todas'
    ? partidasDeFrente(otrasScope, { frentePartidas: frentePartidas || [], partidas: partidas || [] })
    : allPartidas.filter(p => !misPartidasIds.has(p.id)), [otrasScope, allPartidas, misPartidasIds, frentePartidas, partidas]);
  // Códigos "carpeta" (con descendientes) de un conjunto → expandir/colapsar todo.
  const foldersDe = (parts) => { const s = new Set(); for (const p of parts) { const segs = String(p.codigo_delfin || '').split('.').filter(Boolean); for (let i = 1; i < segs.length; i++) s.add(segs.slice(0, i).join('.')); } return s; };
  const autoExpRef = uR(false);
  uE(() => { if (!autoExpRef.current && misPartidas.length) { autoExpRef.current = true; setExpandidos(foldersDe(misPartidas)); } }, [misPartidas]);
  // Gantt: orden + filtro.
  const [ganttSort, setGanttSort] = uS('fecha');   // 'fecha' | 'codigo' | 'rendimiento'
  const [ganttFiltro, setGanttFiltro] = uS('');

  // ── Reporte diario GENERAL del ingeniero (no por frente; cualquier partida) ──
  // Buffer en memoria (window) del reporte EN CURSO: sobrevive al desmontar/montar
  // que ocurre al navegar entre páginas (cada página es un MiFrenteShell nuevo, ver
  // jx-app.jsx key={page}). Así, al ir a "Partidas del Proyecto", agregar otra partida
  // y volver, NO se pierden las partidas ya cargadas (ni las fotos adjuntadas, que son
  // File en memoria y no caben en el borrador de localStorage).
  const repLiveKey = (obraId && userId) ? `${obraId}_${userId}` : '';
  const repLiveInit = repLiveKey ? (window.__miFrenteRepLive?.[repLiveKey] || null) : null;
  const [repLineas, setRepLineas] = uS(() => Array.isArray(repLiveInit?.lineas) ? repLiveInit.lineas : []);   // [{partida_id, descripcion, metrado, fotos:[File]}]
  const [addPartQuery, setAddPartQuery] = uS('');   // buscador de partidas a agregar
  const [busyRep, setBusyRep] = uS(false);
  const [repTodas, setRepTodas] = uS(false);   // alcance del buscador del reporte (mis partidas vs todas) — local al reporte
  const [repFecha, setRepFecha] = uS(() => repLiveInit?.fecha || hoy);     // día que se reporta (default hoy; permite días pasados con motivo)
  const [repMotivoTardio, setRepMotivoTardio] = uS(() => repLiveInit?.motivo || '');
  const MAX_FOTOS = 5;
  const REP_MIN_PALABRAS = 5;   // mínimo de palabras en la descripción de cada partida reportada
  const [confirmRep, setConfirmRep] = uS(null);   // [{linea, partida}] validadas, a confirmar antes de subir
  // Espejar el reporte en curso al buffer en cada cambio (incluye los File de las fotos).
  uE(() => {
    if (!repLiveKey) return;
    window.__miFrenteRepLive = window.__miFrenteRepLive || {};
    window.__miFrenteRepLive[repLiveKey] = { lineas: repLineas, fecha: repFecha, motivo: repMotivoTardio };
  }, [repLiveKey, repLineas, repFecha, repMotivoTardio]);
  // Candidatas a reportar: todas las partidas o solo las de mis frentes (toggle propio del reporte).
  const partidasReporteBase = uM(() => {
    if (repTodas) return allPartidas;
    const m = new Map();
    for (const f of misFrentes) for (const p of partidasDeFrente(f.id, { frentePartidas: frentePartidas || [], partidas: partidas || [] })) m.set(p.id, p);
    return [...m.values()];
  }, [repTodas, allPartidas, misFrentes, frentePartidas, partidas]);
  // Solo partidas específicas (hojas, no capítulos) y NO terminadas (las terminadas ya no
  // se sugieren para reportar; si igual se reportan vía "Agregar reporte" se avisa + motivo).
  const hojasReporte = uM(() => {
    const folders = new Set();
    for (const p of partidasReporteBase) { const segs = String(p.codigo_delfin || '').split('.').filter(Boolean); for (let i = 1; i < segs.length; i++) folders.add(segs.slice(0, i).join('.')); }
    return partidasReporteBase.filter(p => !folders.has(String(p.codigo_delfin || '')) && p.estado !== 'terminado');
  }, [partidasReporteBase]);
  // Borrador por USUARIO + DÍA reportado (no por-frente).
  const draftKey = obraId && userId ? `jx_repdraft_${obraId}_${userId}_${repFecha}` : '';
  const [hayBorrador, setHayBorrador] = uS(false);
  // Borrador PENDIENTE = existe en localStorage y el usuario aún no lo cargó ni
  // descartó. Mientras esté pendiente el autosave NO escribe (lo protege de ser
  // pisado por una línea nueva — p.ej. la que inyecta "Agregar reporte" desde
  // Partidas) y el banner se muestra aunque ya haya líneas (ofrece fusionar).
  const [draftPendiente, setDraftPendiente] = uS(false);
  uE(() => {
    if (!draftKey) { setHayBorrador(false); setDraftPendiente(false); return; }
    try { const hay = !!localStorage.getItem(draftKey); setHayBorrador(hay); setDraftPendiente(hay); }
    catch { setHayBorrador(false); setDraftPendiente(false); }
  }, [draftKey]);
  // Mi último avance por partida (fecha + descripción): ordena las sugerencias
  // del buscador (lo que reporté esta semana va primero) y alimenta el chip
  // "↺ Última descripción".
  const miUltimoAvance = uM(() => {
    const m = new Map();
    for (const a of (avances || [])) {
      if (a.deleted_at || a.responsable_id !== userId || !a.partida_id) continue;
      const prev = m.get(a.partida_id);
      const f = a.fecha || '';
      if (!prev || f > prev.fecha) m.set(a.partida_id, { fecha: f, descripcion: a.descripcion || '' });
    }
    return m;
  }, [avances, userId]);
  const miUltimaFechaPorPartida = uM(() => {
    const m = new Map();
    for (const [pid, v] of miUltimoAvance) m.set(pid, v.fecha);
    return m;
  }, [miUltimoAvance]);
  // AUTOSAVE del borrador (solo texto/metrado — las fotos son File en RAM):
  // en móvil el SO mata la PWA sin aviso y el botón manual no alcanzaba.
  // Debounce 1.5s. Guardas (hallazgos de la revisión adversarial):
  //  · lista vacía → no escribe (vaciar es decisión explícita; enviar descarta);
  //  · borrador PENDIENTE (no cargado/descartado) → no escribe (no pisarlo);
  //  · cambio de fecha con líneas cargadas = MOVER el borrador: se borra la
  //    clave de la fecha anterior — sin esto quedaba un duplicado huérfano que,
  //    tras enviar, invitaba a re-enviar lo mismo (avances duplicados).
  const draftKeyPrevRef = uR(draftKey);
  uE(() => {
    if (!draftKey || !repLineas.length || draftPendiente) return;
    const t = setTimeout(() => {
      try {
        if (draftKeyPrevRef.current && draftKeyPrevRef.current !== draftKey) {
          try { localStorage.removeItem(draftKeyPrevRef.current); } catch {}
        }
        draftKeyPrevRef.current = draftKey;
        localStorage.setItem(draftKey, JSON.stringify(repLineas.map(({ fotos, ...l }) => l)));
        setHayBorrador(true);
      } catch {}
    }, 1500);
    return () => clearTimeout(t);
  }, [draftKey, repLineas, draftPendiente]);

  // ── "DÍA SIN AVANCE" + recordatorio de días no reportados ──────────────
  // Si un día no se avanzó metrado, igual SE REPORTA: motivo + foto (pedido de
  // Gabriel: que todos los ingenieros reporten TODOS los días). El registro va
  // a reportes_dia (tabla propia — avance_obra exige partida y dispara el
  // trigger de metrados). El recordatorio lista los días de los últimos 14 sin
  // reporte propio (ni avance ni sin-avance) desde que hay datos.
  const [sinAvanceOpen, setSinAvanceOpen] = uS(null);   // { fecha } — modal abierto
  const [misReportesDia, setMisReportesDia] = uS([]);   // reportes_dia propios (obra)
  const [misDiasAvance, setMisDiasAvance] = uS(new Set());
  const [busySinAvance, setBusySinAvance] = uS(false);
  uE(() => {
    if (!obraId || !userId) return;
    let cancel = false;
    const load = async () => {
      try {
        const [rd, av] = await Promise.all([
          window.__db.reportes_dia.where('obra_id').equals(obraId)
            .filter(r => !r.deleted_at && r.responsable_id === userId).toArray(),
          window.__db.avance_obra.where('obra_id').equals(obraId)
            .filter(a => !a.deleted_at && a.responsable_id === userId).toArray(),
        ]);
        if (cancel) return;
        setMisReportesDia(rd);
        setMisDiasAvance(new Set(av.map(a => a.fecha).filter(Boolean)));
      } catch { /* tabla nueva puede no existir aún en un build viejo */ }
    };
    load();
    const on = (e) => { const t = e?.detail?.tabla; if (!t || t === 'reportes_dia' || t === 'avance_obra') load(); };
    window.addEventListener('jx_data_changed', on);
    window.addEventListener('jarvex_master_updated', on);
    return () => { cancel = true; window.removeEventListener('jx_data_changed', on); window.removeEventListener('jarvex_master_updated', on); };
  }, [obraId, userId]);
  // Días pendientes: desde hace 14 días (o el primer dato propio) hasta AYER.
  // ANCLADO a `hoy` (hoyLocal, zona America/Lima) — con new Date().toISOString()
  // (UTC) a las 19:00 de Perú el "día" ya sería mañana y el banner correría fechas.
  const diasPendientes = uM(() => {
    const diasRep = new Set([...misDiasAvance, ...misReportesDia.map(r => r.fecha)]);
    if (!diasRep.size && !misFrentes.length) return [];   // sin actividad propia: no perseguir
    const out = [];
    const base = new Date(`${hoy}T00:00:00Z`);            // hoy LOCAL como ancla UTC-fija
    for (let i = 1; i <= 14; i++) {
      const dia = new Date(base); dia.setUTCDate(base.getUTCDate() - i);
      const iso = dia.toISOString().slice(0, 10);
      if (!diasRep.has(iso)) out.push(iso);
    }
    // Piso: ni días anteriores a su primer reporte NI a su ASIGNACIÓN a un
    // frente (a un ingeniero recién asignado no se le reclama el pasado ajeno).
    const primerRep = [...diasRep].sort()[0];
    const asignado = misFrentes.map(f => String(f.created_at || '').slice(0, 10)).filter(Boolean).sort()[0];
    const piso = [primerRep, asignado].filter(Boolean).sort()[0];
    return (piso ? out.filter(x => x >= piso) : out).sort();
  }, [misDiasAvance, misReportesDia, misFrentes, hoy]);

  const guardarSinAvance = async ({ fecha, motivo, fotos, frenteId }) => {
    if (busySinAvance) return;
    setBusySinAvance(true);
    try {
      const { newId, newIdempotencyKey, SYNC_STATUS } = await import('../db/jarvex.db');
      const { getCurrentMode } = await import('../lib/app-mode-core.js');
      const esPrueba = (() => { try { return getCurrentMode() === 'prueba'; } catch { return false; } })();
      const now = new Date().toISOString();
      const id = newId();
      await window.__db.reportes_dia.add({
        id, obra_id: obraId, frente_id: frenteId || null, fecha, motivo: motivo.trim(),
        responsable_id: userId, created_by: userId, updated_by: userId,
        created_at: now, updated_at: now, version: 1,
        idempotency_key: newIdempotencyKey(userId, 'reportes_dia'),
        ...(esPrueba ? { demo: true, sync_status: SYNC_STATUS.SYNCED } : { sync_status: SYNC_STATUS.PENDING_CREATE }),
      });
      let fotosOk = 0;
      for (const f of (fotos || []).slice(0, 3)) {
        try {
          await window.__saveEvidenciaLocal({
            id: window.__newId(), obra_id: obraId, tipo_evidencia: 'foto_sin_avance', modulo_relacionado: 'reportes_dia',
            registro_relacionado_id: id, nombre_archivo: f.name, mime_type: f.type || '',
            blob: f, fecha, created_by: userId, observaciones: `Sin avance: ${motivo.trim().slice(0, 80)}`,
          });
          fotosOk++;
        } catch (e) { console.warn('[sin-avance foto]', e?.message); }
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'reportes_dia' } })); } catch {}
      try { window.dispatchEvent(new Event('online')); } catch {}
      // El motivo quedó registrado igual, pero la foto es requisito del flujo:
      // si ninguna se pudo guardar (archivo >8MB indecodificable, cuota llena),
      // avisar en ámbar para que reintente desde la galería — no toast verde.
      if (fotosOk === 0 && (fotos || []).length > 0) {
        showToast(`Reportado ${fecha} sin avance, pero NINGUNA foto se pudo guardar — subila desde Evidencias`, 'amber');
      } else {
        showToast(`Reportado: ${fecha} sin avance de metrado (${fotosOk} foto(s))`, 'green');
      }
      setSinAvanceOpen(null);
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
    finally { setBusySinAvance(false); }
  };
  const agregarLinea = (pid) => { if (!pid) return; setRepLineas(prev => prev.some(l => l.partida_id === pid) ? prev : [...prev, { partida_id: pid, descripcion: '', metrado: '', fotos: [], motivo: '' }]); setAddPartQuery(''); };
  const quitarLinea = (pid) => setRepLineas(prev => prev.filter(l => l.partida_id !== pid));
  const setLinea = (pid, campo, val) => setRepLineas(prev => prev.map(l => l.partida_id === pid ? { ...l, [campo]: val } : l));
  const agregarFotos = (pid, files) => setRepLineas(prev => prev.map(l => l.partida_id === pid ? { ...l, fotos: [...(l.fotos || []), ...files].slice(0, MAX_FOTOS) } : l));
  const quitarFoto = (pid, idx) => setRepLineas(prev => prev.map(l => l.partida_id === pid ? { ...l, fotos: (l.fotos || []).filter((_, j) => j !== idx) } : l));
  // Validación por partida: metrado avanzado > 0, al menos 1 foto de evidencia y descripción ≥ REP_MIN_PALABRAS.
  const contarPalabras = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
  const estadoLinea = (l) => {
    const metr = Number(l.metrado) > 0;                 // cubre vacío, no-numérico, 0 y negativos
    const foto = (l.fotos || []).length >= 1;
    const palabras = contarPalabras(l.descripcion);
    const desc = palabras >= REP_MIN_PALABRAS;
    return { metr, foto, desc, palabras, ok: metr && foto && desc };
  };
  // % acumulado calculado solo desde el metrado real (no editable por el ingeniero).
  const calcAcum = (pid, metradoHoy) => {
    const p = partByIdAll.get(pid); if (!p) return null;
    const mc = Number(p.metrado_contratado) || 0;
    const r = rendimientoPartida(p, avances || [], hoy);
    const real = (r.realAcum || 0) + (Number(metradoHoy) || 0);
    if (mc <= 0) return { mc: 0, real, pct: null, falta: null };
    const pct = Math.max(0, Math.min(100, (real / mc) * 100));
    return { mc, real, pct, falta: Math.max(0, mc - real) };
  };
  // SOBRE-REPORTE: reportar avance en una partida ya terminada, o que con este reporte
  // pasaría el 100% del metrado contratado. Exige motivo y dispara alerta a gerentes/admins.
  const esSobreReporteLinea = (l) => {
    const p = partByIdAll.get(l.partida_id);
    if (!p) return false;
    if (p.estado === 'terminado') return true;
    const ac = calcAcum(l.partida_id, l.metrado);
    return !!(ac && ac.mc > 0 && ac.real > ac.mc);
  };
  // (guardarBorrador manual eliminado sep-2026: el borrador ahora se autoguarda
  //  con debounce en el uE de arriba — mismo formato y misma clave draftKey.)
  // Cargar FUSIONA con lo ya escrito (no reemplaza): si el usuario llegó con
  // una línea inyectada ("Agregar reporte") y encima tenía borrador, no se
  // pierde ninguno de los dos. Las partidas repetidas conservan lo actual.
  const cargarBorrador = (keyOverride) => {
    const k = keyOverride || draftKey;
    try {
      const d = JSON.parse(localStorage.getItem(k) || '[]');
      if (Array.isArray(d)) {
        setRepLineas(prev => {
          const ids = new Set(prev.map(l => l.partida_id));
          const nuevas = d.filter(l => l && l.partida_id && !ids.has(l.partida_id))
            .map(l => ({ partida_id: l.partida_id, descripcion: l.descripcion || '', metrado: l.metrado ?? '', fotos: [], motivo: l.motivo || '' }));
          return [...prev, ...nuevas];
        });
      }
    } catch {}
    setDraftPendiente(false);
  };
  const descartarBorrador = () => { try { localStorage.removeItem(draftKey); } catch {} setHayBorrador(false); setDraftPendiente(false); };
  const [draftTick, setDraftTick] = uS(0);   // fuerza recálculo de la lista de Borradores tras eliminar
  // Valida TODAS las partidas del reporte; recién si todo cumple abre el modal de confirmación.
  const nomLinea = (l) => { const p = partByIdAll.get(l.partida_id); return p ? `${p.codigo_delfin || ''} · ${p.nombre_partida || ''}`.trim().replace(/^· /, '') : 'una partida'; };
  const pedirConfirmReporte = () => {
    const lineas = repLineas.filter(l => l.partida_id);
    if (!lineas.length) { showToast('Agregá al menos una partida con avance', 'red'); return; }
    const esTardio = repFecha !== hoy;
    if (esTardio && !repMotivoTardio.trim()) { showToast('Indicá el motivo por el que subís el reporte de otro día', 'red'); return; }
    for (const l of lineas) {
      const st = estadoLinea(l);
      if (!st.metr) { showToast(`Indicá el metrado avanzado (mayor a 0) en: ${nomLinea(l)}`, 'red'); return; }
      if (!st.foto) { showToast(`Debés colocar al menos una foto de evidencia en: ${nomLinea(l)}`, 'red'); return; }
      if (!st.desc) { showToast(`La descripción de "${nomLinea(l)}" debe tener al menos ${REP_MIN_PALABRAS} palabras (tiene ${st.palabras})`, 'red'); return; }
      if (esSobreReporteLinea(l) && !(l.motivo || '').trim()) { showToast(`"${nomLinea(l)}" ya está al 100% / terminada — indicá el MOTIVO por el que reportás más avance (irá como alerta a gerencia)`, 'red'); return; }
    }
    setConfirmRep(lineas.map(l => ({ linea: l, partida: partByIdAll.get(l.partida_id) || null, sobre: esSobreReporteLinea(l) })));
  };
  const guardarReporte = async () => {
    const lineas = (confirmRep || []).map(c => c.linea).filter(l => l && l.partida_id);
    if (!lineas.length) { setConfirmRep(null); return; }
    const esTardio = repFecha !== hoy;
    setBusyRep(true);
    try {
      for (const l of lineas) {
        const ac = calcAcum(l.partida_id, l.metrado);
        const p = partByIdAll.get(l.partida_id);
        const sobre = esSobreReporteLinea(l);
        const id = window.__newId();
        const desc = esTardio
          ? `[Reporte tardío subido ${hoy} · motivo: ${repMotivoTardio.trim()}]${l.descripcion ? ' ' + l.descripcion : ''}`
          : (l.descripcion || null);
        // OJO: usar el id REALMENTE persistido (create lo devuelve) para enlazar
        // las fotos. Si el padre quedara con otro id, las fotos serían huérfanas.
        const avanceRec = await avanceHook.create({
          id, obra_id: obraId, partida_id: l.partida_id, frente_id: frenteDePartida(l.partida_id), fecha: repFecha,
          porcentaje_avance_reportado: ac && ac.pct != null ? Math.round(ac.pct * 10) / 10 : null,
          metrado_ejecutado: l.metrado !== '' ? Number(l.metrado) : null,
          descripcion: desc, responsable_id: userId, origen: 'reporte',
          sobre_reporte: sobre, motivo_sobrereporte: sobre ? (l.motivo || '').trim() || null : null,
        });
        const avanceId = avanceRec?.id || id;
        if (ac && ac.pct != null && partidasHook.update) {
          // Al llegar al 100% la partida se marca terminado (salvo 'observado', que se respeta).
          const nuevoEstado = (ac.pct >= 100 && p && p.estado !== 'observado' && p.estado !== 'terminado') ? { estado: 'terminado' } : {};
          try { await partidasHook.update(l.partida_id, { porcentaje_avance: Math.round(ac.pct * 10) / 10, ...nuevoEstado }); } catch {}
        }
        for (const f of (l.fotos || []).slice(0, MAX_FOTOS)) {
          try {
            await window.__saveEvidenciaLocal({
              id: window.__newId(), obra_id: obraId, tipo_evidencia: 'foto_avance', modulo_relacionado: 'avance_obra',
              registro_relacionado_id: avanceId, nombre_archivo: f.name, mime_type: f.type || '',
              blob: f, fecha: repFecha, created_by: userId, observaciones: 'Foto de avance diario',
            });
          } catch (e) { console.warn('[mi-frente foto]', e?.message); }
        }
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'avance_obra' } })); } catch {}
      if (lineas.some(l => (l.fotos || []).length)) { try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'evidencias' } })); } catch {} }
      showToast(`Reporte guardado · ${lineas.length} partida(s)`, 'green');
      setRepLineas([]); descartarBorrador(); setRepMotivoTardio(''); setConfirmRep(null);
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
    finally { setBusyRep(false); }
  };

  // (El reporte ya no es por-frente ni requiere aprobación: el ingeniero arma un único
  //  reporte del día con partidas de cualquier frente o sin frente; los avances acumulan
  //  y se trazan por color de ingeniero. La aprobación admin/gerente se reserva para crear
  //  un frente desde una partida huérfana. El editor NO se limpia al cambiar de alcance.)

  // ── Detalle de partida (vista 'detalle'): código de la partida/capítulo elegido ──
  const [detalleSel, setDetalleSel] = uS(null);
  const [detalleVerTodosIns, setDetalleVerTodosIns] = uS(false);
  // ── Menú anti-click sobre partidas (árbol + Gantt) ────────────────
  const [ctx, setCtx] = uS(null);   // {x, y, partida}
  uE(() => { if (!ctx) return; const close = () => setCtx(null); window.addEventListener('click', close); window.addEventListener('scroll', close, true); return () => { window.removeEventListener('click', close); window.removeEventListener('scroll', close, true); }; }, [ctx]);
  // Intent cross-módulo: anti-click "ir al costo unitario" / "generar reporte" navega y aplica al montar.
  const intentRef = uR(null);
  uE(() => {
    const it = window.__miFrenteIntent;
    if (!it || intentRef.current === it.ts) return;
    if (it.tipo === 'borrador' && vista === 'reporte') {
      if (it.fecha) setRepFecha(it.fecha);
      cargarBorrador(`jx_repdraft_${obraId}_${userId}_${it.fecha}`);
      intentRef.current = it.ts; window.__miFrenteIntent = null; return;
    }
    if (it.tipo === 'reporte' && vista === 'reporte') {
      const p = partByIdAll.get(it.partidaId);
      if (!p) return;   // partidas aún no cargaron de Dexie → NO consumir el intent; reintentar cuando partByIdAll cambie
      setRepLineas(prev => prev.some(l => l.partida_id === p.id) ? prev : [...prev, { partida_id: p.id, descripcion: '', metrado: '', fotos: [] }]);
      intentRef.current = it.ts; window.__miFrenteIntent = null; return;
    }
    if (it.tipo === 'detalle' && vista === 'detalle') {
      const cod = it.codigo || partByIdAll.get(it.partidaId)?.codigo_delfin || '';
      if (!cod && it.partidaId && partByIdAll.size === 0) return;   // datos aún no cargaron → reintentar
      setDetalleSel(cod);
      intentRef.current = it.ts; window.__miFrenteIntent = null; return;
    }
    if (it.tipo === 'costo' && vista === 'partidas') {
      const p = partByIdAll.get(it.partidaId);
      if (!p) return;
      // Ir a la pestaña donde está la partida: Mis partidas si es mía, si no Otras.
      if (misPartidasIds.has(p.id)) { setPartidasTab('mias'); }
      else { setPartidasTab('otras'); setOtrasScope('todas'); }
      setFiltroPart(p.codigo_delfin || ''); setExpandidos(prev => new Set(prev).add(p.codigo_delfin));
      intentRef.current = it.ts; window.__miFrenteIntent = null;
    }
  }, [vista, misPartidasIds, partByIdAll]);

  // ── Plan vs Real ──────────────────────────────────────────────────
  const [meta, setMeta] = uS({ partida_id: '', fecha: hoy, meta_metrado: '', meta_descripcion: '' });
  const guardarMeta = async () => {
    if (!frenteActivo) return;
    if (!meta.partida_id || !meta.fecha) { showToast('Partida y fecha requeridas', 'red'); return; }
    try {
      await metasHook.create({
        id: window.__newId(), obra_id: obraId, frente_id: frenteActivo.id, partida_id: meta.partida_id, fecha: meta.fecha,
        meta_metrado: meta.meta_metrado !== '' ? Number(meta.meta_metrado) : null,
        meta_descripcion: meta.meta_descripcion || null, created_by: userId,
      });
      showToast('Meta guardada', 'green');
      setMeta({ partida_id: '', fecha: hoy, meta_metrado: '', meta_descripcion: '' });
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };
  const [mes, setMes] = uS(hoy.slice(0, 7));
  const planFila = uM(() => planVsReal({ partidasDelFrente, metas: metas || [], avances: avances || [] }), [partidasDelFrente, metas, avances]);
  const rollup = uM(() => rollupMensual({ partidasDelFrente, avances: avances || [], mes }), [partidasDelFrente, avances, mes]);

  // ── Vinculación de insumos: salidas → partida ─────────────────────
  const [vincSel, setVincSel] = uS({});         // {movId: partidaId | '__general'}
  const [tabSalidas, setTabSalidas] = uS('mis'); // 'mis' | 'generales' | 'registro'
  const [filtroDiaSal, setFiltroDiaSal] = uS('');
  const [filtroPartSal, setFiltroPartSal] = uS('');
  const [solCambioVinc, setSolCambioVinc] = uS(null);   // salida a la que se solicita cambio de vinculación
  const [soloSinVincular, setSoloSinVincular] = uS(true); // por defecto, solo lo pendiente
  const [bulkBusy, setBulkBusy] = uS(false);
  const misFrentesIds = uM(() => new Set(misFrentes.map(f => f.id)), [misFrentes]);
  const salidasMisFrentes = uM(() => (movs || []).filter(m => !m.deleted_at && m.tipo_movimiento === 'salida' && m.frente_id && misFrentesIds.has(m.frente_id)).sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || ''))), [movs, misFrentesIds]);
  const salidasGenerales = uM(() => (movs || []).filter(m => !m.deleted_at && m.tipo_movimiento === 'salida').sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || ''))), [movs]);
  const partidaPorCodigo = uM(() => { const m = new Map(); allPartidas.forEach(p => { if (p.codigo_delfin) m.set(String(p.codigo_delfin).trim(), p.id); }); return m; }, [allPartidas]);
  // Núcleo SILENCIOSO (sin toast/dispatch) — reutilizable por el lote.
  const vincularSalidaCore = async (m, pid) => {
    const prevPid = m.partida_id || null;
    if (prevPid === pid) return false;   // no-op (evita doble conteo)
    await movHook.update(m.id, { partida_id: pid, vinculacion_general: false });
    try {
      const { aplicarConsumoPartida, revertirConsumoPartida } = await import('../lib/partida-allocation.js');
      const material = materialesById.get(m.material_id);
      // Re-vinculación: revertir el consumo de la partida ANTERIOR antes de aplicar el nuevo
      // (si no, queda doblemente imputado — mismo patrón que la aprobación en jx-solicitudes).
      if (prevPid) await revertirConsumoPartida({ mov: m, partida_id: prevPid, material, userId });
      await aplicarConsumoPartida({ mov: { ...m, partida_id: pid }, partida_id: pid, material, userId });
    } catch (e) { console.warn('[vincular salida]', e?.message); }
    return true;
  };
  const vincularSalidaSilent = async (m, pid) => { await vincularSalidaCore(m, pid); };
  // Núcleo de vinculación GENERAL (sin toast). Si venía de una partida,
  // revierte su consumo (si no, quedaba imputado a una partida ya desvinculada).
  const vincularGeneralCore = async (m) => {
    const prevPid = m.partida_id || null;
    await movHook.update(m.id, { vinculacion_general: true, partida_id: null });
    if (prevPid) {
      try {
        const { revertirConsumoPartida } = await import('../lib/partida-allocation.js');
        await revertirConsumoPartida({ mov: m, partida_id: prevPid, material: materialesById.get(m.material_id), userId });
      } catch (e) { console.warn('[vincular general]', e?.message); }
    }
  };
  // ── VINCULACIÓN EN LOTE manual (pedido 21-jul): marcar varias salidas con su
  // casilla y mandarlas a UNA partida (o "general") de un solo golpe; se repite
  // por grupo — "estas 3 a esta partida, estas 2 a esta otra". ──
  const [selVinc, setSelVinc] = uS(() => new Set());
  const [bulkPartida, setBulkPartida] = uS('');
  const vincularLote = async (listaVisible) => {
    const v = bulkPartida;
    if (!v) { showToast('Elegí la partida destino (o "general al frente") para el lote', 'red'); return; }
    const seleccion = (listaVisible || []).filter(m => selVinc.has(m.id));
    if (!seleccion.length) { showToast('Marcá al menos una salida con su casilla', 'amber'); return; }
    const destino = v === '__general' ? 'General al frente' : (partidaOpts.find(o => o.value === v)?.label || 'la partida elegida');
    if (!window.confirm(`¿Vincular ${seleccion.length} salida(s) a:\n${destino}?\n\nPodés re-vincular cualquiera después si alguna no corresponde.`)) return;
    setBulkBusy(true);
    let ok = 0;
    try {
      for (const m of seleccion) {
        try {
          if (v === '__general') await vincularGeneralCore(m); else await vincularSalidaCore(m, v);
          ok++;
        } catch (e) { console.warn('[lote vincular]', e?.message); }
      }
    } finally { setBulkBusy(false); }
    setSelVinc(new Set()); setBulkPartida('');
    try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'movimientos_materiales' } })); } catch {}
    showToast(`${ok} salida(s) vinculadas a ${destino}`, ok ? 'green' : 'amber');
  };
  const vincularSalida = async (m, pid) => {
    if (!pid) { showToast('Elegí una partida', 'red'); return; }
    if ((m.partida_id || null) === pid) { showToast('Ya está vinculada a esa partida', 'amber'); return; }
    try {
      await vincularSalidaCore(m, pid);
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'movimientos_materiales' } })); } catch {}
      setVincSel(prev => { const n = { ...prev }; delete n[m.id]; return n; });
      showToast('Salida vinculada a la partida', 'green');
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };
  // Vinculación GENERAL al frente: el insumo no corresponde a ninguna partida del
  // presupuesto (ej. bidón de agua). No imputa consumo a ninguna partida.
  const vincularGeneral = async (m) => {
    try {
      await vincularGeneralCore(m);
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'movimientos_materiales' } })); } catch {}
      setVincSel(prev => { const n = { ...prev }; delete n[m.id]; return n; });
      showToast('Salida vinculada en general al frente', 'green');
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };
  // Opciones de partida (hojas, no capítulos) para el selector buscable.
  const partidaOpts = uM(() => {
    const folders = new Set();
    for (const p of allPartidas) { const segs = String(p.codigo_delfin || '').split('.').filter(Boolean); for (let i = 1; i < segs.length; i++) folders.add(segs.slice(0, i).join('.')); }
    return allPartidas
      .filter(p => p.codigo_delfin && !folders.has(String(p.codigo_delfin).trim()))
      .sort((a, b) => String(a.codigo_delfin).localeCompare(String(b.codigo_delfin), 'es', { numeric: true }))
      .map(p => ({ value: p.id, label: `${p.codigo_delfin} · ${p.nombre_partida}` }));
  }, [allPartidas]);
  // ── SUGERENCIA AUTOMÁTICA de partida para una salida ──────────────
  // La mejor pista NO es el nombre de la partida (no se parece al material), sino
  // QUÉ partidas PRESUPUESTAN ese material (insumos_partida, por codigo_s10 o por
  // nombre). Entre esas, se prioriza la del frente de la salida y las en ejecución.
  const normTxtSug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const hojaIds = uM(() => new Set(partidaOpts.map(o => o.value)), [partidaOpts]);
  const partidasPorMaterial = uM(() => {
    const porCodigo = new Map(), porNombre = new Map();
    for (const ip of (insumosObra || [])) {
      if (!ip.partida_id || !hojaIds.has(ip.partida_id)) continue;
      const costo = Number(ip.costo_presupuestado) || (Number(ip.cantidad_presupuestada || 0) * Number(ip.precio_presupuestado || 0));
      const rec = { pid: ip.partida_id, costo };
      if (ip.insumo_codigo) { const k = String(ip.insumo_codigo).trim(); const a = porCodigo.get(k) || []; a.push(rec); porCodigo.set(k, a); }
      const nk = normTxtSug(ip.nombre_insumo); if (nk) { const a = porNombre.get(nk) || []; a.push(rec); porNombre.set(nk, a); }
    }
    return { porCodigo, porNombre };
  }, [insumosObra, hojaIds]);
  // Partidas de cada frente (set por frente) para priorizar la sugerencia.
  const partidasDeFrenteSet = uM(() => {
    const m = new Map();
    for (const f of (frentes || [])) { if (f.deleted_at) continue; try { m.set(f.id, new Set(partidasDeFrente(f.id, { frentePartidas: frentePartidas || [], partidas: partidas || [] }).map(p => p.id))); } catch {} }
    return m;
  }, [frentes, frentePartidas, partidas]);
  const sugerenciaDe = (m) => {
    const mat = materialesById.get(m.material_id);
    if (!mat) return null;
    let cand = (mat.codigo_s10 && partidasPorMaterial.porCodigo.get(String(mat.codigo_s10).trim())) || [];
    if (!cand.length) cand = partidasPorMaterial.porNombre.get(normTxtSug(mat.nombre_material)) || [];
    if (!cand.length) return null;
    const delFrente = partidasDeFrenteSet.get(m.frente_id || frenteActivo?.id) || new Set();
    const score = (c) => {
      const p = partByIdAll.get(c.pid);
      return (delFrente.has(c.pid) ? 1e6 : 0) + ((Number(p?.porcentaje_avance) || 0) > 0 ? 1e3 : 0) + Math.min(999, (c.costo || 0) / 1000);
    };
    const best = [...cand].sort((a, b) => score(b) - score(a))[0];
    const p = partByIdAll.get(best.pid);
    if (!p) return null;
    return { pid: best.pid, label: `${p.codigo_delfin} · ${p.nombre_partida}`, enFrente: delFrente.has(best.pid) };
  };

  // Aplicar sugerencias EN LOTE a una lista de salidas sin vincular.
  const aplicarSugerencias = async (listaSalidas) => {
    const conSug = (listaSalidas || []).filter(m => !m.partida_id && !m.vinculacion_general).map(m => ({ m, sug: sugerenciaDe(m) })).filter(x => x.sug);
    if (!conSug.length) { showToast('No hay sugerencias automáticas para las salidas pendientes', 'amber'); return; }
    if (!window.confirm(`Vincular ${conSug.length} salida(s) a su partida sugerida automáticamente?\nPodés re-vincular cualquiera después si alguna no corresponde.`)) return;
    setBulkBusy(true);
    let ok = 0;
    try { for (const { m, sug } of conSug) { try { await vincularSalidaSilent(m, sug.pid); ok++; } catch {} } }
    finally { setBulkBusy(false); }
    try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'movimientos_materiales' } })); } catch {}
    showToast(`${ok} salida(s) vinculadas a su partida sugerida`, ok ? 'green' : 'amber');
  };

  // Salidas YA vinculadas (a partida o general) — para la pestaña "Registro".
  const salidasVinculadas = uM(() => (movs || [])
    .filter(m => !m.deleted_at && m.tipo_movimiento === 'salida' && (m.partida_id || m.vinculacion_general))
    .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || ''))), [movs]);

  // Gantt del frente (HOOKS antes de cualquier return temprano — regla de hooks).
  const ganttPartidas = uM(() => {
    const q = ganttFiltro.trim().toLowerCase();
    let arr = partidasDelFrente.filter(p => p.fecha_inicio_planificada && p.fecha_fin_planificada);
    if (q) arr = arr.filter(p => String(p.codigo_delfin || '').toLowerCase().includes(q) || String(p.nombre_partida || '').toLowerCase().includes(q));
    const rank = { rojo: 0, ambar: 1, verde: 2, sin_dato: 3 };
    return [...arr].sort((a, b) => {
      if (ganttSort === 'codigo') return String(a.codigo_delfin || '').localeCompare(String(b.codigo_delfin || ''), 'es', { numeric: true });
      if (ganttSort === 'rendimiento') return rank[rendimientoPartida(a, avances || [], hoy).semaforo] - rank[rendimientoPartida(b, avances || [], hoy).semaforo];
      return String(a.fecha_inicio_planificada).localeCompare(String(b.fecha_inicio_planificada));
    });
  }, [partidasDelFrente, ganttFiltro, ganttSort, avances, hoy]);
  const ganttRango = uM(() => {
    if (!ganttPartidas.length) return null;
    const hoyMs = new Date(hoy).getTime();   // incluir HOY en el rango → la línea de hoy siempre se ve
    const ini = Math.min(hoyMs, ...ganttPartidas.map(p => new Date(p.fecha_inicio_planificada).getTime()));
    const fin = Math.max(hoyMs, ...ganttPartidas.map(p => new Date(p.fecha_fin_planificada).getTime()));
    return { ini, fin, span: Math.max(1, fin - ini) };
  }, [ganttPartidas, hoy]);

  if (!obraId) return <div className="page-wrap"><div className="card card-p empty-state"><p>Seleccioná una obra activa.</p></div></div>;
  if (misFrentes.length === 0) {
    return (
      <div className="page-wrap"><div className="card card-p empty-state" style={{ textAlign: 'center' }}>
        <JxIcon name="flag" size={36} color="var(--tm)" />
        <p style={{ marginTop: 8 }}><strong>Todavía no tenés un frente asignado.</strong></p>
        <p style={{ color: 'var(--tm)', fontSize: 13 }}>Pedile al administrador que te asigne uno en <em>Frentes de Trabajo</em>.</p>
      </div></div>
    );
  }

  const TITULOS = { dashboard: 'Dashboard Técnico', partidas: 'Partidas del Proyecto', cronograma: 'Cronograma de mis Partidas', salidas: 'Vinculación de insumos', reporte: 'Reporte Diario', plan: 'Plan vs Real', borradores: 'Borradores', detalle: 'Detalle de partida' };

  // Menú anti-click: abrir + acciones.
  const openCtx = (e, p) => { e.preventDefault(); e.stopPropagation(); setCtx({ x: e.clientX, y: e.clientY, partida: p }); };
  const irACostoUnitario = (p) => {
    if (vista === 'partidas') { setFiltroPart(p.codigo_delfin || ''); setExpandidos(prev => new Set(prev).add(p.codigo_delfin)); }
    else { window.__miFrenteIntent = { tipo: 'costo', partidaId: p.id, frenteId: frenteActivo?.id, ts: Date.now() }; window.__navTo?.('mis-partidas'); }
  };
  const generarReporteDe = (p) => {
    if (vista === 'reporte') { agregarLinea(p.id); }
    else { window.__miFrenteIntent = { tipo: 'reporte', partidaId: p.id, frenteId: frenteActivo?.id, ts: Date.now() }; window.__navTo?.('reporte-diario'); }
  };
  // Ir a "Detalle de partida" (cualquier partida: específica o capítulo). Navega y aplica al montar.
  const irADetalle = (p, codigo) => {
    window.__miFrenteIntent = { tipo: 'detalle', partidaId: p?.id || null, codigo: codigo || p?.codigo_delfin || '', ts: Date.now() };
    window.__navTo?.('detalle-partida');
  };
  // ¿Es capítulo? (tiene descendientes en TODA la obra → no es partida específica/hoja → no se reporta)
  const esCapitulo = (p) => { const c = String(p?.codigo_delfin || ''); return !!c && allPartidas.some(o => o.id !== p.id && String(o.codigo_delfin || '').startsWith(c + '.')); };
  // Partida huérfana → pedir al admin/gerente que cree/oficialice un frente para ella.
  const solicitarFrente = async (p) => {
    if (!p) return;
    if (solFrentePend(p.id)) { showToast('Ya hay una solicitud pendiente para esta partida', 'amber'); return; }
    const motivo = window.prompt(`Solicitar crear un frente para:\n${p.codigo_delfin} · ${p.nombre_partida}\n\nMotivo (opcional):`, '');
    if (motivo === null) return;   // canceló
    try {
      await solFrenteHook.create({ obra_id: obraId, partida_id: p.id, solicitante_user_id: userId, nombre_sugerido: p.nombre_partida || null, motivo: motivo || null, estado: 'solicitado', created_by: userId });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'solicitudes_frente' } })); } catch {}
      showToast('Solicitud enviada al administrador/gerente', 'green');
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };
  const ctxBtn = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'none', border: 'none', color: 'var(--tx)', padding: '9px 11px', fontSize: 12.5, textAlign: 'left', cursor: 'pointer' };

  // Editor multi-partida reutilizado por el reporte propio (con foto) y el ajeno (sin foto).
  const editorLineas = (showFoto) => {
    const yaIds = new Set(repLineas.map(l => l.partida_id));
    const q = addPartQuery.trim();
    // Tolerante a tildes + multi-palabra AND + recientes primero (lib pura con tests).
    const sugeridas = filtrarPartidasReporte(hojasReporte, q, {
      ultimaFechaPorPartida: miUltimaFechaPorPartida,
      excluirIds: yaIds,
      max: 25,
    });
    return (
      <>
        <div className="card card-p">
          <div className="frow-sb" style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Partidas avanzadas · {repFecha}{repFecha !== hoy ? ' (otro día)' : ''}</div>
            <span style={{ fontSize: 11, color: 'var(--tm)' }}>{repLineas.length} partida(s)</span>
          </div>
          <input className="fi" style={FI16} placeholder={repTodas ? 'Buscar cualquier partida por código o nombre…' : 'Buscar una partida de tus frentes…'} value={addPartQuery} onChange={e => setAddPartQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && q && sugeridas.length) { e.preventDefault(); agregarLinea(sugeridas[0].id); } }} />
          {(q || sugeridas.length > 0) && (
            <div style={{ marginTop: 6, maxHeight: 230, overflow: 'auto', border: '1px solid var(--bd)', borderRadius: 6 }}>
              {sugeridas.map(p => (
                <button key={p.id} onClick={() => agregarLinea(p.id)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid var(--bd)', color: 'var(--tx)', padding: '7px 10px', fontSize: 12, cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                  <span style={{ fontFamily: 'monospace', color: 'var(--tm)' }}>{p.codigo_delfin}</span> {p.nombre_partida}
                  {repTodas && (() => { const fs = frentesNombresDe(p.id); return fs.length ? <span className="badge b-amber" style={{ marginLeft: 6, fontSize: 9 }}>{fs.join(', ')}</span> : <span className="badge b-red" style={{ marginLeft: 6, fontSize: 9 }}>sin frente</span>; })()}
                </button>
              ))}
              {q && sugeridas.length === 0 && <div style={{ padding: '7px 10px', color: 'var(--tm)', fontStyle: 'italic', fontSize: 12 }}>Sin coincidencias.</div>}
            </div>
          )}
          {repLineas.length === 0 && <div style={{ color: 'var(--tm)', fontStyle: 'italic', fontSize: 12, marginTop: 10 }}>Buscá y agregá las partidas que avanzaste; el % acumulado se calcula solo.</div>}
        </div>
        {repLineas.map(l => {
          const p = partByIdAll.get(l.partida_id);
          const ac = calcAcum(l.partida_id, l.metrado);
          const pctPrev = p ? (Number(p.porcentaje_avance) || 0) : 0;
          const st = estadoLinea(l);
          const rend = p ? rendimientoPartida(p, avances || [], hoy) : null;   // ritmo requerido + semáforo acumulado
          const metHoy = Number(l.metrado) || 0;
          const idxDiario = rend && rend.metaDiaria > 0 ? metHoy / rend.metaDiaria : null;
          const semDiario = idxDiario == null ? 'sin_dato' : idxDiario >= 1 ? 'verde' : idxDiario >= 0.75 ? 'ambar' : 'rojo';
          const esSobre = esSobreReporteLinea(l);
          return (
            <div key={l.partida_id} className="card card-p" style={esSobre ? { border: '1px solid var(--red)' } : undefined}>
              <div className="frow-sb" style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}><span style={{ fontFamily: 'monospace', color: 'var(--tm)' }}>{p?.codigo_delfin}</span> {p?.nombre_partida || '—'}{p?.estado === 'terminado' && <span className="badge b-green" style={{ marginLeft: 6, fontSize: 9 }}>terminada</span>}</div>
                <button className="btn btn-ghost btn-xs" onClick={() => quitarLinea(l.partida_id)}>✕ Quitar</button>
              </div>
              {esSobre && (
                <div style={{ marginBottom: 8, padding: '8px 10px', borderRadius: 6, background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.3)' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--red)', marginBottom: 4 }}>⚠ Esta partida ya está al 100% / terminada</div>
                  <div style={{ fontSize: 11, color: 'var(--tm)', marginBottom: 6 }}>Si reportás más avance, se avisará a gerencia/administración para revisar (quizá no estaba realmente terminada). Indicá el motivo:</div>
                  <textarea className="fi" rows={2} value={l.motivo || ''} onChange={e => setLinea(l.partida_id, 'motivo', e.target.value)} placeholder="Motivo por el que reportás avance en una partida ya terminada…" style={!(l.motivo || '').trim() ? { borderColor: 'var(--red)' } : undefined} />
                </div>
              )}
              <label className="flabel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span>Descripción del avance (mín. {REP_MIN_PALABRAS} palabras) *</span>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: st.desc ? 'var(--green)' : 'var(--amber)' }}>{st.palabras}/{REP_MIN_PALABRAS} palabras</span>
              </label>
              {(() => {
                // Chips de arranque: teclear texto libre en obra es lo más costoso.
                // Solo con la descripción VACÍA — un chip jamás pisa texto tecleado.
                const vacia = !String(l.descripcion || '').trim();
                if (!vacia) return null;
                const ultima = limpiarDescripcionReuso(miUltimoAvance.get(l.partida_id)?.descripcion);
                return (
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 5 }}>
                    {ultima && (
                      <button className="btn btn-ghost btn-xs" style={{ fontSize: 10.5 }} title={ultima}
                        onClick={() => setLinea(l.partida_id, 'descripcion', ultima)}>↺ Última descripción</button>
                    )}
                    {['Se continuó con ', 'Se completó ', 'Se instaló '].map(f => (
                      <button key={f} className="btn btn-ghost btn-xs" style={{ fontSize: 10.5 }}
                        onClick={() => setLinea(l.partida_id, 'descripcion', f)}>{f.trim()}…</button>
                    ))}
                  </div>
                );
              })()}
              <textarea className="fi" style={FI16} rows={3} value={l.descripcion} onChange={e => setLinea(l.partida_id, 'descripcion', e.target.value)} placeholder={`Detallá qué se avanzó en esta partida (mínimo ${REP_MIN_PALABRAS} palabras)…`} />
              <div className="g2" style={{ marginTop: 8 }}>
                <div><label className="flabel">Metrado avanzado ({p?.unidad || 'und'}) *</label><input className="fi" type="number" step="0.01" min="0" value={l.metrado} onChange={e => setLinea(l.partida_id, 'metrado', e.target.value)} style={!st.metr ? { ...FI16, borderColor: 'var(--red)' } : FI16} /></div>
                <div>
                  <label className="flabel">Fotos de evidencia (1 a {MAX_FOTOS}) *</label>
                  <FotosField fotos={l.fotos || []} max={MAX_FOTOS}
                    onAdd={files => agregarFotos(l.partida_id, files)}
                    onQuitar={i => quitarFoto(l.partida_id, i)} />
                </div>
              </div>
              <div style={{ marginTop: 8, display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, fontWeight: 600 }}>
                {[['Metrado avanzado', st.metr], ['Foto de evidencia', st.foto], [`Descripción ≥ ${REP_MIN_PALABRAS} palabras`, st.desc]].map(([txt, ok]) => (
                  <span key={txt} style={{ color: ok ? 'var(--green)' : 'var(--red)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>{ok ? '✓' : '✗'} {txt}</span>
                ))}
              </div>
              <div style={{ marginTop: 8, padding: '7px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', fontSize: 11.5 }}>
                {ac && ac.pct != null ? (
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span>Avance acumulado: <strong>{pctPrev}%</strong> → <strong style={{ color: 'var(--amber)' }}>{Math.round(ac.pct * 10) / 10}%</strong></span>
                    <span style={{ color: 'var(--tm)' }}>real {num(ac.real)} / {num(ac.mc)} {p?.unidad || ''} · te falta {num(ac.falta)} {p?.unidad || ''}</span>
                  </div>
                ) : <span style={{ color: 'var(--tm)' }}>Esta partida no tiene metrado contratado: no se puede calcular el % automáticamente.</span>}
              </div>
              {rend && rend.metaDiaria > 0 ? (
                <div style={{ marginTop: 6, padding: '7px 10px', borderRadius: 6, background: 'rgba(58,163,255,0.07)', fontSize: 11.5, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span>📈 Rendimiento diario requerido: <strong>{num(rend.metaDiaria)} {p?.unidad || ''}/día</strong> <span style={{ color: 'var(--tm)' }}>({rend.diasPlan} días plan)</span></span>
                  {metHoy > 0 && <span>Hoy: <strong>{num(metHoy)} {p?.unidad || ''}</strong> → <SemBadge s={semDiario} /></span>}
                  <span style={{ color: 'var(--tm)' }}>Acumulado: <SemBadge s={rend.semaforo} /></span>
                </div>
              ) : (
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--tm)' }}>📈 Sin fechas planificadas: no se puede estimar el ritmo diario requerido de esta partida.</div>
              )}
            </div>
          );
        })}
      </>
    );
  };

  // Árbol desplegable de Mis Partidas (recursivo): nodo → hijos → insumos (sin costos).
  const TIPO_COLOR = { material: 'var(--green)', materiales: 'var(--green)', mano_obra: '#8e7cff', equipo: '#3aa3ff', equipos: '#3aa3ff', herramienta: '#ff9f43', subcontrato: '#ff6b9d' };
  const renderNodos = (code, depth, parts, mostrarFrente) => {
    const filas = [];
    for (const nodo of hijosDirectos(parts, code)) {
      const open = expandidos.has(nodo.code);
      const p = nodo.partida;
      const esCap = nodo.esFolder;            // capítulo/carpeta (tiene descendientes)
      const esHoja = !nodo.esFolder && !!p;   // partida específica (hoja)
      const r = p ? rendimientoPartida(p, avances || [], hoy) : null;
      const puedeExpandir = nodo.esFolder;
      filas.push(
        <tr key={nodo.code} onContextMenu={p ? (e) => openCtx(e, p) : undefined}
          onClick={() => irADetalle(p, nodo.code)}
          title="Ver detalle de la partida →"
          style={{ background: esCap ? 'rgba(245,180,40,0.06)' : (esHoja ? 'rgba(46,204,113,0.04)' : 'transparent'), cursor: 'pointer', borderLeft: esHoja ? '3px solid rgba(46,204,113,0.5)' : (esCap ? '3px solid rgba(245,180,40,0.5)' : '3px solid transparent') }}>
          <td style={{ paddingLeft: 6 + depth * 16, whiteSpace: 'nowrap' }}>
            {puedeExpandir
              ? <button className="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); toggleExp(nodo.code); }} style={{ padding: '0 4px', color: esCap ? 'var(--amber)' : 'var(--green)' }}>{open ? '▾' : '▸'}</button>
              : <span style={{ display: 'inline-block', width: 18 }} />}
            <span style={{ fontFamily: 'monospace', fontSize: 11.5, color: esCap ? 'var(--amber)' : (esHoja ? 'var(--green)' : 'var(--tx)'), fontWeight: esCap ? 700 : 500 }}>{esCap ? '📁 ' : '• '}{nodo.code}</span>
          </td>
          <td style={{ fontWeight: esCap ? 600 : 400 }}>{p ? <>{p.nombre_partida || '—'}{mostrarFrente && (() => { const fs = frentesNombresDe(p.id); return fs.length ? <span className="badge b-amber" style={{ marginLeft: 6, fontSize: 9 }} title="Frente(s)">{fs.join(', ')}</span> : <span className="badge b-red" style={{ marginLeft: 6, fontSize: 9 }} title="No pertenece a ningún frente">sin frente</span>; })()}</> : <span style={{ color: 'var(--tm)', fontStyle: 'italic' }}>capítulo</span>}</td>
          <td style={{ textAlign: 'right' }}>{p ? `${num(p.metrado_contratado)} ${p.unidad || ''}` : ''}</td>
          <td>{p ? <PlazoMini p={p} /> : ''}</td>
          <td>{esCap ? <BarraSimple pct={rollupAvanceMap.get(nodo.code) || 0} /> : (p ? <BarraAvance partida={p} avancesPartida={avancesPorPartida.get(p.id)} nombreUsuario={nombreUsuario} /> : '')}</td>
          <td>{r ? <div><SemBadge s={r.semaforo} />{r.metaDiaria > 0 && <div style={{ fontSize: 9.5, color: 'var(--tm)', marginTop: 2 }} title="Ritmo diario requerido (metrado ÷ días planificados)">{num(r.metaDiaria)} {p.unidad || ''}/día</div>}</div> : ''}</td>
          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{esHoja && <button className="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); generarReporteDe(p); }}>Agregar reporte</button>}<span style={{ color: 'var(--amber)', marginLeft: 6, opacity: 0.6 }}>›</span></td>
        </tr>
      );
      if (open && nodo.esFolder) filas.push(...renderNodos(nodo.code, depth + 1, parts, mostrarFrente));
    }
    return filas;
  };

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div className="pg-title">{TITULOS[vista]}</div>
          <div className="pg-sub">
            {vista === 'reporte' ? 'Reporte general del ingeniero (de todos tus frentes)'
              : vista === 'borradores' ? 'Tus reportes guardados a medias'
              : vista === 'partidas'
                ? <>{partidasTab === 'mias' ? 'Mis partidas' : 'Otras partidas'} · {(partidasTab === 'mias' ? misPartidas : otrasPartidas).length} partidas</>
                : esTodas
                  ? <>Todas las partidas · {partidasDelFrente.length} partidas (incl. sin frente)</>
                  : <>{frenteActivo?.nombre || '—'} · {resumen.nPartidas} partidas · {Math.round(resumen.avancePromedio)}% avance prom.{!esMiFrente && frenteActivo && <span style={{ color: 'var(--amber)' }}> · otro frente</span>}</>}
          </div>
        </div>
        <div style={{ display: vista === 'cronograma' ? 'flex' : 'none', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {(frentesVisibles.length > 1 || verOtros) && (
            <select className="fi" style={{ maxWidth: 280 }} value={esTodas ? '__todas' : (frenteActivo?.id || '')} onChange={e => setFrenteSelId(e.target.value)}>
              <optgroup label="Mis frentes">
                {misFrentes.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
              </optgroup>
              {verOtros && frentesVisibles.filter(f => !misFrentes.some(m => m.id === f.id)).length > 0 && (
                <optgroup label="Otros frentes">
                  {frentesVisibles.filter(f => !misFrentes.some(m => m.id === f.id)).map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
                </optgroup>
              )}
              {verOtros && <option value="__todas">★ Todas las partidas (incl. sin frente)</option>}
            </select>
          )}
          <label style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 5, color: 'var(--tm)', cursor: 'pointer' }}>
            <input type="checkbox" checked={verOtros} onChange={e => { const on = e.target.checked; setVerOtros(on); if (!on && (esTodas || !esMiFrente)) setFrenteSelId(misFrentes[0]?.id || null); }} />
            Habilitar otros frentes y partidas
          </label>
        </div>
      </div>

      {vista === 'dashboard' && (
        <div style={{ display: 'grid', gap: 12 }}>
          {/* Atajo directo: el reporte diario es LA tarea del día del ingeniero y
              estaba a 2-3 taps enterrado en menús — causa real de postergarlo. */}
          <div>
            <button className="btn btn-amber" style={{ padding: '10px 18px', fontSize: 13.5 }} onClick={() => window.__navTo?.('reporte-diario')}>
              📝 Reportar hoy
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
            {[['Partidas', resumen.nPartidas], ['Avance prom.', Math.round(resumen.avancePromedio) + '%'],
              ['Salidas a mi frente', resumen.nSalidas], ['Metrado real acum.', num(resumen.metradoReal)]].map(([t, v]) => (
              <div key={t} className="card card-p"><div style={{ fontSize: 11.5, color: 'var(--tm)' }}>{t}</div><div style={{ fontSize: 22, fontWeight: 700 }}>{v}</div></div>
            ))}
          </div>
          <div className="card card-p">
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Rendimiento (planificado vs real)</div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {['rojo', 'ambar', 'verde', 'sin_dato'].map(s => (
                <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: SEM[s], display: 'inline-block' }} />
                  <span style={{ fontSize: 12 }}>{SEM_LBL[s]}: <strong>{semConteo[s] || 0}</strong></span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 6 }}>Atrasado = avance real por debajo de la meta diaria (metrado ÷ días planificados).</div>
          </div>
          <div className="card" style={{ overflow: 'auto' }}>
            <div style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 600 }}>Partidas que requieren atención</div>
            <table className="tbl" style={{ fontSize: 12 }}>
              <thead><tr><th>Partida</th><th style={{ textAlign: 'right' }}>% Avance</th><th style={{ textAlign: 'right' }}>Meta/día</th><th style={{ textAlign: 'right' }}>Real acum.</th><th>Estado</th></tr></thead>
              <tbody>
                {rendimientos.filter(x => x.r.semaforo === 'rojo' || x.r.semaforo === 'ambar').slice(0, 12).map(({ p, r }) => (
                  <tr key={p.id}><td>{nombrePart(p)}</td><td style={{ textAlign: 'right' }}>{Number(p.porcentaje_avance) || 0}%</td>
                    <td style={{ textAlign: 'right' }}>{num(r.metaDiaria)}</td><td style={{ textAlign: 'right' }}>{num(r.realAcum)}</td><td><SemBadge s={r.semaforo} /></td></tr>
                ))}
                {rendimientos.filter(x => x.r.semaforo === 'rojo' || x.r.semaforo === 'ambar').length === 0 && <tr><td colSpan={5} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>Sin atrasos detectados (o faltan fechas planificadas en las partidas).</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {vista === 'partidas' && (() => {
        const parts = partidasTab === 'mias' ? misPartidas : otrasPartidas;
        const mostrarFrente = partidasTab === 'otras';
        const q = filtroPart.trim().toLowerCase();
        const filtradas = q ? parts.filter(p => String(p.codigo_delfin || '').toLowerCase().includes(q) || String(p.nombre_partida || '').toLowerCase().includes(q)) : null;
        const folderCodes = foldersDe(parts);   // códigos que son capítulo (prefijo de otra partida) → sin botón de reporte
        const otrosFrentesList = (frentes || []).filter(f => !f.deleted_at && !misFrentes.some(m => m.id === f.id));
        return (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className={`btn btn-sm ${partidasTab === 'mias' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setPartidasTab('mias')}>Mis partidas</button>
                <button className={`btn btn-sm ${partidasTab === 'otras' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setPartidasTab('otras')}>Otras partidas</button>
              </div>
              {partidasTab === 'otras' && (
                <select className="fi" style={{ maxWidth: 260 }} value={otrasScope} onChange={e => setOtrasScope(e.target.value)}>
                  <option value="todas">Todas las demás (incl. sin frente)</option>
                  {otrosFrentesList.map(f => <option key={f.id} value={f.id}>Frente: {f.nombre}</option>)}
                </select>
              )}
            </div>
            <div className="card" style={{ overflow: 'auto' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px', flexWrap: 'wrap' }}>
                <input className="fi" style={{ maxWidth: 300 }} placeholder="Buscar por nombre o número (ej. 3.02.07.06)…" value={filtroPart} onChange={e => setFiltroPart(e.target.value)} />
                {!filtradas && (<>
                  <button className="btn btn-ghost btn-xs" onClick={() => setExpandidos(prev => { const n = new Set(prev); foldersDe(parts).forEach(c => n.add(c)); return n; })}>Expandir todo</button>
                  <button className="btn btn-ghost btn-xs" onClick={() => setExpandidos(new Set())}>Colapsar todo</button>
                </>)}
                <span style={{ display: 'inline-flex', gap: 10, marginLeft: 8, fontSize: 10.5, color: 'var(--tm)' }}>
                  <span><span style={{ color: 'var(--amber)' }}>📁</span> capítulo</span>
                  <span><span style={{ color: 'var(--green)' }}>•</span> partida específica</span>
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--tm)' }}>{filtradas ? `${filtradas.length} coinciden` : `${parts.length} partidas`}</span>
              </div>
              <table className="tbl" style={{ fontSize: 12 }}>
                <thead><tr><th>Código</th><th>Partida</th><th style={{ textAlign: 'right' }}>Metrado</th><th>Plazo plan.</th><th>Avance (por ingeniero)</th><th>Rendimiento</th><th></th></tr></thead>
                <tbody>
                  {filtradas ? filtradas.map(p => {
                    const r = rendimientoPartida(p, avances || [], hoy);
                    const esCapF = folderCodes.has(p.codigo_delfin);
                    return (
                      <tr key={p.id} onContextMenu={(e) => openCtx(e, p)} onClick={() => irADetalle(p, p.codigo_delfin)} title="Ver detalle de la partida →"
                        style={{ cursor: 'pointer', background: esCapF ? 'rgba(245,180,40,0.06)' : 'rgba(46,204,113,0.04)', borderLeft: esCapF ? '3px solid rgba(245,180,40,0.5)' : '3px solid rgba(46,204,113,0.5)' }}>
                        <td style={{ whiteSpace: 'nowrap' }}><span style={{ display: 'inline-block', width: 18 }} /><span style={{ fontFamily: 'monospace', fontSize: 11.5, color: esCapF ? 'var(--amber)' : 'var(--green)', fontWeight: esCapF ? 700 : 500 }}>{esCapF ? '📁 ' : '• '}{p.codigo_delfin}</span></td>
                        <td>{p.nombre_partida || '—'}{mostrarFrente && (() => { const fs = frentesNombresDe(p.id); return fs.length ? <span className="badge b-amber" style={{ marginLeft: 6, fontSize: 9 }}>{fs.join(', ')}</span> : <span className="badge b-red" style={{ marginLeft: 6, fontSize: 9 }}>sin frente</span>; })()}</td>
                        <td style={{ textAlign: 'right' }}>{num(p.metrado_contratado)} {p.unidad || ''}</td>
                        <td><PlazoMini p={p} /></td>
                        <td>{esCapF ? <BarraSimple pct={rollupAvanceMap.get(p.codigo_delfin) || 0} /> : <BarraAvance partida={p} avancesPartida={avancesPorPartida.get(p.id)} nombreUsuario={nombreUsuario} />}</td>
                        <td><div><SemBadge s={r.semaforo} />{r.metaDiaria > 0 && <div style={{ fontSize: 9.5, color: 'var(--tm)', marginTop: 2 }} title="Ritmo diario requerido (metrado ÷ días planificados)">{num(r.metaDiaria)} {p.unidad || ''}/día</div>}</div></td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{!esCapF && <button className="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); generarReporteDe(p); }}>Agregar reporte</button>}<span style={{ color: 'var(--amber)', marginLeft: 6, opacity: 0.6 }}>›</span></td>
                      </tr>
                    );
                  }) : renderNodos('', 0, parts, mostrarFrente)}
                  {parts.length === 0 && <tr><td colSpan={7} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>{partidasTab === 'mias' ? 'No tenés partidas asignadas a tus frentes.' : 'No hay otras partidas en este alcance.'}</td></tr>}
                  {filtradas && filtradas.length === 0 && <tr><td colSpan={7} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>Ninguna partida coincide con “{filtroPart}”.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {vista === 'detalle' && (() => {
        const cod = detalleSel ? String(detalleSel).trim() : '';
        if (!cod) return <div className="card card-p empty-state"><p>Elegí una partida desde <strong>Partidas del Proyecto</strong> para ver su detalle.</p></div>;
        const p = allPartidas.find(x => String(x.codigo_delfin || '').trim() === cod) || null;
        const esCapitulo = rollupAvanceMap.has(cod);
        return (
          <div style={{ display: 'grid', gap: 12, maxWidth: 1100 }}>
            <div><button className="btn btn-ghost btn-sm" onClick={() => window.__navTo?.('mis-partidas')}><JxIcon name="chevL" size={13} />Volver a Partidas del Proyecto</button></div>
            <div className="card card-p">
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--tp)' }}>
                <span style={{ fontFamily: 'monospace', color: esCapitulo ? 'var(--amber)' : 'var(--green)' }}>{esCapitulo ? '📁 ' : '• '}{cod}</span> {p?.nombre_partida || 'Capítulo'}
                <span className={`badge ${esCapitulo ? 'b-amber' : 'b-green'}`} style={{ marginLeft: 8, fontSize: 9 }}>{esCapitulo ? 'capítulo' : 'partida específica'}</span>
              </div>
            </div>
            {esCapitulo ? (() => {
              const hojas = hojasDeCapitulo(cod, allPartidas);
              const rollupPct = rollupAvanceMap.get(cod) || 0;
              const vens = hojas.map(h => ventanaPartida(h)).filter(v => v.completa);
              const ini = vens.length ? vens.map(v => v.ini).sort()[0] : null;
              const fin = vens.length ? vens.map(v => v.fin).sort().slice(-1)[0] : null;
              const diasCap = (ini && fin) ? ventanaPartida({ fecha_inicio_planificada: ini, fecha_fin_planificada: fin }).dias : null;
              const insCons = consolidarInsumos(hojas.flatMap(h => insumosPorPartida.get(h.id) || []));
              const insMostrar = detalleVerTodosIns ? insCons : insCons.slice(0, 10);
              const hijos = hijosDirectos(allPartidas, cod);
              return (
                <>
                  <div className="card card-p">
                    <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Avance del capítulo (ponderado por sus partidas)</div>
                    <BarraSimple pct={rollupPct} />
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--tm)', marginTop: 8 }}>
                      <span>📁 {hojas.length} partidas específicas dentro</span>
                      {ini && fin ? <span>📅 {fmtFechaCorta(ini)} → {fmtFechaCorta(fin)} <span style={{ color: 'var(--ts)', fontWeight: 600 }}>({diasCap} días estimados)</span></span> : <span>📅 Sin fechas planificadas</span>}
                    </div>
                  </div>
                  <div className="card" style={{ overflow: 'auto' }}>
                    <div style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 600 }}>Subpartidas ({hijos.length}) · cómo avanza cada una</div>
                    <table className="tbl" style={{ fontSize: 12 }}>
                      <thead><tr><th>Código</th><th>Partida</th><th style={{ textAlign: 'right' }}>Metrado</th><th>Plazo</th><th>Avance</th></tr></thead>
                      <tbody>
                        {hijos.map(n => {
                          const np = n.partida; const nEsCap = rollupAvanceMap.has(n.code);
                          const npct = nEsCap ? (rollupAvanceMap.get(n.code) || 0) : (Number(np?.porcentaje_avance) || 0);
                          return (
                            <tr key={n.code} onClick={() => irADetalle(np, n.code)} title="Ver detalle →" style={{ cursor: 'pointer' }}>
                              <td style={{ fontFamily: 'monospace', fontSize: 11, color: nEsCap ? 'var(--amber)' : 'var(--green)', whiteSpace: 'nowrap' }}>{nEsCap ? '📁 ' : '• '}{n.code}</td>
                              <td>{np?.nombre_partida || 'Capítulo'}</td>
                              <td style={{ textAlign: 'right' }}>{np ? `${num(np.metrado_contratado)} ${np.unidad || ''}` : ''}</td>
                              <td>{np ? <PlazoMini p={np} /> : ''}</td>
                              <td><BarraSimple pct={npct} /></td>
                            </tr>
                          );
                        })}
                        {hijos.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>Sin subpartidas.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <div className="card" style={{ overflow: 'auto' }}>
                    <div className="frow-sb" style={{ padding: '8px 12px', flexWrap: 'wrap', gap: 6 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>Insumos consolidados ({insCons.length}) · suma de todas las partidas del capítulo</span>
                      {insCons.length > 10 && <button className="btn btn-ghost btn-xs" onClick={() => setDetalleVerTodosIns(v => !v)}>{detalleVerTodosIns ? 'Ver solo top 10' : `Ver todos (${insCons.length})`}</button>}
                    </div>
                    {!detalleVerTodosIns && insCons.length > 10 && <div style={{ padding: '0 12px 6px', fontSize: 11, color: 'var(--tm)' }}>Top 10 más relevantes (por presupuesto).</div>}
                    <table className="tbl" style={{ fontSize: 12 }}>
                      <thead><tr><th style={{ width: 110 }}>Tipo</th><th>Insumo</th><th style={{ textAlign: 'right' }}>Cantidad total</th><th style={{ textAlign: 'right' }}>En N partidas</th></tr></thead>
                      <tbody>
                        {insMostrar.map((i, k) => (
                          <tr key={i.codigo || i.nombre + k}>
                            <td><span className="badge" style={{ background: TIPO_COLOR[String(i.tipo || '').toLowerCase()] || 'var(--tm)', color: '#000', fontSize: 9 }}>{i.tipo}</span></td>
                            <td>{i.codigo ? <span style={{ fontFamily: 'monospace', color: 'var(--tm)', fontSize: 11 }}>{i.codigo}</span> : ''} {i.nombre}</td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{num(Math.round(i.cantidad * 1000) / 1000)} {i.unidad || ''}</td>
                            <td style={{ textAlign: 'right', color: 'var(--tm)' }}>{i.nPartidas}</td>
                          </tr>
                        ))}
                        {insCons.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>Las partidas de este capítulo no tienen insumos presupuestados (APU).</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </>
              );
            })() : (() => {
              if (!p) return <div className="card card-p empty-state"><p>No se encontró la partida {cod}.</p></div>;
              const ven = ventanaPartida(p);
              const rend = rendimientoPartida(p, avances || [], hoy);
              const ins = insumosPorPartida.get(p.id) || [];
              return (
                <>
                  <div className="card card-p">
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5, color: 'var(--tm)', marginBottom: 8 }}>
                      {ven.completa ? <>
                        <span>📅 {fmtFechaCorta(ven.ini)} → {fmtFechaCorta(ven.fin)} <span style={{ color: 'var(--ts)', fontWeight: 600 }}>({ven.dias} días)</span></span>
                        {rend.metaDiaria > 0 && <span>📈 Ritmo requerido: <strong style={{ color: 'var(--ts)' }}>{num(rend.metaDiaria)} {p.unidad || ''}/día</strong></span>}
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>Rendimiento: <SemBadge s={rend.semaforo} /></span>
                        <span>Falta <strong style={{ color: 'var(--ts)' }}>{num(Math.max(0, (Number(p.metrado_contratado) || 0) - (rend.realAcum || 0)))} {p.unidad || ''}</strong> de {num(p.metrado_contratado)}</span>
                      </> : <span>📅 Sin fechas de ejecución planificadas.</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--tm)', marginBottom: 4 }}>Avance (por ingeniero):</div>
                    <BarraAvance partida={p} avancesPartida={avancesPorPartida.get(p.id)} nombreUsuario={nombreUsuario} />
                    <div style={{ marginTop: 10 }}><button className="btn btn-amber btn-sm" onClick={() => generarReporteDe(p)}><JxIcon name="edit" size={12} />Agregar reporte de esta partida</button></div>
                  </div>
                  <div className="card" style={{ overflow: 'auto' }}>
                    <div style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 600 }}>Insumos a utilizar ({ins.length})</div>
                    <table className="tbl" style={{ fontSize: 12 }}>
                      <thead><tr><th style={{ width: 110 }}>Tipo</th><th>Insumo</th><th style={{ textAlign: 'right' }}>Cantidad</th></tr></thead>
                      <tbody>
                        {ins.map(i => (
                          <tr key={i.id}>
                            <td><span className="badge" style={{ background: TIPO_COLOR[String(i.tipo_insumo || '').toLowerCase()] || 'var(--tm)', color: '#000', fontSize: 9 }}>{i.tipo_insumo}</span></td>
                            <td>{i.insumo_codigo ? <span style={{ fontFamily: 'monospace', color: 'var(--tm)', fontSize: 11 }}>{i.insumo_codigo}</span> : ''} {i.nombre_insumo}</td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{num(i.cantidad_presupuestada)} {i.unidad || ''}</td>
                          </tr>
                        ))}
                        {ins.length === 0 && <tr><td colSpan={3} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>Esta partida no tiene insumos presupuestados (APU).</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </>
              );
            })()}
          </div>
        );
      })()}

      {vista === 'cronograma' && (
        <div className="card card-p">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <input className="fi" style={{ maxWidth: 240 }} placeholder="Filtrar partida…" value={ganttFiltro} onChange={e => setGanttFiltro(e.target.value)} />
            <select className="fi" style={{ maxWidth: 230 }} value={ganttSort} onChange={e => setGanttSort(e.target.value)}>
              <option value="fecha">Ordenar: fecha de inicio</option>
              <option value="codigo">Ordenar: código</option>
              <option value="rendimiento">Ordenar: atrasadas primero</option>
            </select>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--tm)' }}>{ganttPartidas.length} partidas</span>
          </div>
          {!ganttRango ? (
            <div style={{ color: 'var(--tm)', fontStyle: 'italic', fontSize: 12 }}>Tus partidas no tienen fechas planificadas cargadas todavía.</div>
          ) : (() => {
            const hoyMs = new Date(hoy).getTime();
            const hoyPct = (hoyMs >= ganttRango.ini && hoyMs <= ganttRango.fin) ? ((hoyMs - ganttRango.ini) / ganttRango.span) * 100 : null;
            return (
              <div>
                <div style={{ fontSize: 11.5, color: 'var(--tm)', marginBottom: 8 }}>
                  {new Date(ganttRango.ini).toLocaleDateString('es-PE')} → {new Date(ganttRango.fin).toLocaleDateString('es-PE')}
                  {hoyPct != null && <span style={{ color: 'var(--amber)' }}> · ▼ hoy {new Date(hoy).toLocaleDateString('es-PE')}</span>}
                  {' '}· la barra clara = plan, la rellena = avance · tocá una barra para ir a la partida
                </div>
                <div style={{ display: 'grid', gap: 4 }}>
                  {ganttPartidas.map(p => {
                    const ini = new Date(p.fecha_inicio_planificada).getTime();
                    const fin = new Date(p.fecha_fin_planificada).getTime();
                    const left = ((ini - ganttRango.ini) / ganttRango.span) * 100;
                    const width = Math.max(1.5, ((fin - ini) / ganttRango.span) * 100);
                    const r = rendimientoPartida(p, avances || [], hoy);
                    const pct = Math.max(0, Math.min(100, rollupAvanceMap.has(p.codigo_delfin) ? (rollupAvanceMap.get(p.codigo_delfin) || 0) : (Number(p.porcentaje_avance) || 0)));
                    const atrasada = hoyMs > fin && pct < 100;
                    const cFrente = colorIngeniero(frenteDePartida(p.id) || 'sin');
                    return (
                      <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 8, alignItems: 'center', cursor: 'pointer' }} onClick={() => { window.__miFrenteIntent = { tipo: 'costo', partidaId: p.id, ts: Date.now() }; window.__navTo?.('mis-partidas'); }} onContextMenu={(e) => openCtx(e, p)}>
                        <div style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${p.codigo_delfin} · ${p.nombre_partida} · frente ${(frentesNombresDe(p.id)[0] || 'sin')}`}>
                          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: cFrente, marginRight: 5 }} />
                          <span style={{ fontFamily: 'monospace', color: 'var(--tm)' }}>{p.codigo_delfin}</span> {p.nombre_partida}{atrasada ? <span style={{ color: 'var(--red)' }}> ⚠</span> : null}
                        </div>
                        <div style={{ position: 'relative', height: 18, background: 'rgba(255,255,255,0.04)', borderRadius: 4 }}>
                          {/* barra planificada (color del frente) */}
                          <div style={{ position: 'absolute', left: left + '%', width: width + '%', top: 2, bottom: 2, background: cFrente, opacity: 0.32, borderRadius: 3 }}
                            title={`${num(p.metrado_contratado)} ${p.unidad || ''} · ${p.fecha_inicio_planificada} → ${p.fecha_fin_planificada} · ${pct}% avance`} />
                          {/* avance real (color del semáforo) */}
                          {pct > 0 && <div style={{ position: 'absolute', left: left + '%', width: (width * pct / 100) + '%', top: 2, bottom: 2, background: SEM[r.semaforo], opacity: 0.95, borderRadius: 3 }} />}
                          {hoyPct != null && <div style={{ position: 'absolute', left: hoyPct + '%', top: -2, bottom: -2, width: 2, background: 'var(--amber)', zIndex: 2 }} title={`Hoy ${hoy}`} />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {vista === 'salidas' && (() => {
        const RCM = window.RequestChangeModal;
        // Opciones del selector buscable: la opción "general al frente" primero, luego las partidas (código · nombre).
        const opcionesVinc = [{ value: '__general', label: '⚑ Vinculación general al frente (fuera de presupuesto)' }, ...partidaOpts];
        const tabsHdr = (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <button className={`btn btn-sm ${tabSalidas === 'mis' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTabSalidas('mis')}>Insumos a mis Frentes</button>
            <button className={`btn btn-sm ${tabSalidas === 'generales' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTabSalidas('generales')}>Insumos generales</button>
            <button className={`btn btn-sm ${tabSalidas === 'registro' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTabSalidas('registro')}>Registro de vinculaciones</button>
          </div>
        );

        // ── Pestaña REGISTRO: salidas ya vinculadas + solicitar cambio al admin ──
        if (tabSalidas === 'registro') {
          const q = filtroPartSal.trim().toLowerCase();
          const lista = salidasVinculadas.filter(m => {
            if (filtroDiaSal && m.fecha !== filtroDiaSal) return false;
            if (q) {
              const p = partByIdAll.get(m.partida_id);
              const matName = (materialesById.get(m.material_id)?.nombre_material || '').toLowerCase();
              const pc = (p ? `${p.codigo_delfin} ${p.nombre_partida}` : '').toLowerCase();
              if (!pc.includes(q) && !matName.includes(q)) return false;
            }
            return true;
          });
          return (
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {tabsHdr}
                <input className="fi" type="date" style={{ maxWidth: 160 }} value={filtroDiaSal} onChange={e => setFiltroDiaSal(e.target.value)} title="Filtrar por día" />
                {filtroDiaSal && <button className="btn btn-ghost btn-xs" onClick={() => setFiltroDiaSal('')}>✕ día</button>}
                <input className="fi" style={{ maxWidth: 240 }} placeholder="Filtrar por partida o material…" value={filtroPartSal} onChange={e => setFiltroPartSal(e.target.value)} />
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--tm)' }}>{lista.length} vinculada(s)</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--tm)' }}>Los insumos que ya vinculaste. Si te equivocaste de partida, pedí al admin el cambio (con un motivo) — él lo aprueba y recalcula el consumo.</div>
              <div className="card" style={{ overflow: 'auto' }}>
                <table className="tbl" style={{ fontSize: 12 }}>
                  <thead><tr><th>Fecha</th><th>Material</th><th style={{ textAlign: 'right' }}>Cantidad</th><th>Frente</th><th>Vinculado a</th><th></th></tr></thead>
                  <tbody>
                    {lista.map(m => {
                      const p = partByIdAll.get(m.partida_id);
                      return (
                        <tr key={m.id}>
                          <td>{m.fecha || '—'}</td>
                          <td>{materialesById.get(m.material_id)?.nombre_material || '—'}</td>
                          <td style={{ textAlign: 'right' }}>{num(m.cantidad)} {m.unidad || ''}</td>
                          <td>{m.frente_id ? <span className="badge b-amber" style={{ fontSize: 9 }}>{fNomById.get(m.frente_id) || 'frente'}</span> : <span style={{ color: 'var(--tm)' }}>—</span>}</td>
                          <td>{m.vinculacion_general
                            ? <span className="badge b-blue" style={{ fontSize: 9 }}>General al frente</span>
                            : (p ? <><span style={{ fontFamily: 'monospace', color: 'var(--tm)' }}>{p.codigo_delfin}</span> {p.nombre_partida}</> : '—')}</td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{RCM && <button className="btn btn-ghost btn-xs" title="Solicitar al admin el cambio de vinculación (lo aprueba él)" onClick={() => setSolCambioVinc(m)}><JxIcon name="edit" size={11} /> Solicitar cambio</button>}</td>
                        </tr>
                      );
                    })}
                    {lista.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>Todavía no vinculaste ninguna salida.</td></tr>}
                  </tbody>
                </table>
              </div>
              {solCambioVinc && RCM && <RCM
                table="movimientos_materiales"
                record={solCambioVinc}
                recordLabel={`${materialesById.get(solCambioVinc.material_id)?.nombre_material || 'material'} · ${num(solCambioVinc.cantidad)} ${solCambioVinc.unidad || ''} · ${solCambioVinc.fecha || ''}`}
                fields={[{ key: 'partida_id', label: 'Partida vinculada', options: partidaOpts }]}
                onClose={() => setSolCambioVinc(null)} />}
            </div>
          );
        }

        // ── Pestañas MIS / GENERALES: vincular ──
        const base = tabSalidas === 'mis' ? salidasMisFrentes : salidasGenerales;
        const q = filtroPartSal.trim().toLowerCase();
        const lista = base.filter(m => {
          if (soloSinVincular && (m.partida_id || m.vinculacion_general)) return false;
          if (filtroDiaSal && m.fecha !== filtroDiaSal) return false;
          if (tabSalidas === 'generales' && q) {
            const p = partByIdAll.get(m.partida_id);
            const matName = (materialesById.get(m.material_id)?.nombre_material || '').toLowerCase();
            const pc = (p ? `${p.codigo_delfin} ${p.nombre_partida}` : '').toLowerCase();
            if (!pc.includes(q) && !matName.includes(q)) return false;
          }
          return true;
        });
        const colSpan = tabSalidas === 'generales' ? 8 : 7;
        const pendientesConSug = lista.filter(m => !m.partida_id && !m.vinculacion_general && sugerenciaDe(m)).length;
        return (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {tabsHdr}
              <input className="fi" type="date" style={{ maxWidth: 160 }} value={filtroDiaSal} onChange={e => setFiltroDiaSal(e.target.value)} title="Filtrar por día" />
              {filtroDiaSal && <button className="btn btn-ghost btn-xs" onClick={() => setFiltroDiaSal('')}>✕ día</button>}
              {tabSalidas === 'generales' && <input className="fi" style={{ maxWidth: 240 }} placeholder="Filtrar por partida o material…" value={filtroPartSal} onChange={e => setFiltroPartSal(e.target.value)} />}
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--ts)', cursor: 'pointer' }} title="Ocultar las que ya vinculaste">
                <input type="checkbox" checked={soloSinVincular} onChange={e => setSoloSinVincular(e.target.checked)} /> Solo sin vincular
              </label>
              {pendientesConSug > 0 && (
                <button className="btn btn-amber btn-sm" disabled={bulkBusy} onClick={() => aplicarSugerencias(lista)} title="Vincular automáticamente las salidas pendientes a la partida que las presupuesta">
                  ✨ Aplicar {pendientesConSug} sugerencia{pendientesConSug !== 1 ? 's' : ''}
                </button>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--tm)' }}>{lista.length} salida(s)</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--tm)' }}>
              {tabSalidas === 'mis'
                ? 'Salidas de almacén registradas a tus frentes. El sistema te SUGIERE la partida que presupuesta cada material (💡) — confirmá con un clic o elegí otra. Marcá varias con su casilla ☑ para vincularlas EN LOTE, o usá "✨ Aplicar sugerencias".'
                : 'Todas las salidas de la obra. Si un insumo salió a otro frente pero lo usaste en tu partida (incluso una sin frente), vinculalo acá. Marcá varias con su casilla ☑ para vincularlas en lote. La 💡 sugiere la partida que lo presupuesta.'}
            </div>
            {selVinc.size > 0 && (
              <div className="card card-p" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderLeft: '3px solid var(--amber)' }}>
                <strong style={{ fontSize: 12.5 }}>☑ {selVinc.size} seleccionada(s)</strong>
                <SearchableSelect value={bulkPartida} onChange={setBulkPartida} options={opcionesVinc}
                  placeholder="Partida destino del lote…" fontSize={11} style={{ minWidth: 260, display: 'inline-block' }} />
                <button className="btn btn-amber btn-sm" disabled={bulkBusy} onClick={() => vincularLote(lista)}>
                  {bulkBusy ? 'Vinculando…' : `Vincular las ${selVinc.size} →`}
                </button>
                <button className="btn btn-ghost btn-xs" disabled={bulkBusy} onClick={() => { setSelVinc(new Set()); setBulkPartida(''); }}>✕ limpiar</button>
              </div>
            )}
            <div className="card" style={{ overflow: 'auto' }}>
              <table className="tbl" style={{ fontSize: 12 }}>
                <thead><tr>
                  <th style={{ width: 30, textAlign: 'center' }}>
                    <input type="checkbox" title="Seleccionar / deseleccionar todas las visibles"
                      checked={lista.length > 0 && lista.every(m => selVinc.has(m.id))}
                      onChange={e => setSelVinc(e.target.checked
                        ? new Set([...selVinc, ...lista.map(m => m.id)])
                        : new Set([...selVinc].filter(id => !lista.some(m => m.id === id))))} />
                  </th>
                  <th>Fecha</th><th>Material</th><th style={{ textAlign: 'right' }}>Cantidad</th><th>Responsable</th>{tabSalidas === 'generales' && <th>Frente</th>}<th>Vinculado</th><th>Vincular a partida / frente</th></tr></thead>
                <tbody>
                  {lista.map(m => {
                    const yaVinc = m.partida_id || m.vinculacion_general;
                    const pv = m.partida_id ? partByIdAll.get(m.partida_id) : null;
                    const sug = !yaVinc ? sugerenciaDe(m) : null;   // partida que PRESUPUESTA este material
                    return (
                      <tr key={m.id} style={selVinc.has(m.id) ? { background: 'rgba(242,183,5,0.06)' } : undefined}>
                        <td style={{ textAlign: 'center' }}>
                          <input type="checkbox" checked={selVinc.has(m.id)}
                            onChange={() => setSelVinc(prev => { const n = new Set(prev); n.has(m.id) ? n.delete(m.id) : n.add(m.id); return n; })} />
                        </td>
                        <td>{m.fecha || '—'}</td>
                        <td>{materialesById.get(m.material_id)?.nombre_material || '—'}</td>
                        <td style={{ textAlign: 'right' }}>{num(m.cantidad)} {m.unidad || ''}</td>
                        <td>{(() => { const p = personalById.get(m.responsable_id); return p ? `${p.nombres} ${p.apellidos || ''}`.trim() : '—'; })()}</td>
                        {tabSalidas === 'generales' && <td>{m.frente_id ? <span className="badge b-amber" style={{ fontSize: 9 }}>{fNomById.get(m.frente_id) || 'frente'}</span> : <span style={{ color: 'var(--tm)' }}>—</span>}</td>}
                        <td>{m.vinculacion_general
                          ? <span className="badge b-blue" style={{ fontSize: 9 }} title="Usado en el frente, fuera de presupuesto">General</span>
                          : (pv ? <span className="badge b-green" style={{ fontSize: 9 }} title={`${pv.codigo_delfin} · ${pv.nombre_partida}`}>{pv.codigo_delfin}</span> : <span style={{ color: 'var(--tm)' }}>—</span>)}</td>
                        <td style={{ whiteSpace: 'nowrap', minWidth: 280 }}>
                          {sug && (
                            <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginBottom: 4 }}>
                              <span style={{ fontSize: 10.5, color: 'var(--tm)' }}>💡 Sugerido{sug.enFrente ? ' (de tu frente)' : ''}:</span>
                              <button className="btn btn-green btn-xs" disabled={bulkBusy} title={`Vincular a ${sug.label}`} onClick={() => vincularSalida(m, sug.pid)}>
                                ✓ {sug.label.length > 34 ? sug.label.slice(0, 33) + '…' : sug.label}
                              </button>
                            </div>
                          )}
                          <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                            <SearchableSelect value={vincSel[m.id] || ''} onChange={v => setVincSel({ ...vincSel, [m.id]: v })} options={opcionesVinc}
                              placeholder="Buscar partida…" fontSize={11} style={{ minWidth: 230, display: 'inline-block' }} />
                            <button className="btn btn-amber btn-xs" onClick={() => {
                              const v = vincSel[m.id];
                              if (!v) { showToast('Elegí una partida o "general al frente"', 'red'); return; }
                              if (v === '__general') vincularGeneral(m); else vincularSalida(m, v);
                            }}>{yaVinc ? 'Re-vincular' : 'Vincular'}</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {lista.length === 0 && <tr><td colSpan={colSpan} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>{soloSinVincular ? '✓ No tenés salidas pendientes de vincular' : 'No hay salidas'}{filtroDiaSal ? ` del ${filtroDiaSal}` : ''}{q ? ' que coincidan' : ''}.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {vista === 'reporte' && (
        <div style={{ display: 'grid', gap: 12, maxWidth: 700 }}>
          {/* Recordatorio: días sin reportar (ni avance ni "sin avance"). */}
          {diasPendientes.length > 0 && (
            <div className="card card-p" style={{ background: 'rgba(231,76,60,0.07)', border: '1px solid rgba(231,76,60,0.3)' }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--red)', marginBottom: 6 }}>
                ⏰ Te falta reportar {diasPendientes.length} día(s)
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--tm)', marginBottom: 8 }}>
                Todos los días se reporta — si no se avanzó metrado, indicá el motivo con una foto.
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {diasPendientes.slice(-7).map(d => (
                  <span key={d} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 11, background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 6, padding: '3px 6px' }}>
                    <strong>{d.slice(5)}</strong>
                    <button className="btn btn-ghost btn-xs" style={{ padding: '1px 5px', fontSize: 10 }} title="Reportar avance de ese día" onClick={() => setRepFecha(d)}>avance</button>
                    <button className="btn btn-ghost btn-xs" style={{ padding: '1px 5px', fontSize: 10, color: 'var(--amber)' }} title="Reportar que ese día no se avanzó" onClick={() => setSinAvanceOpen({ fecha: d })}>sin avance</button>
                  </span>
                ))}
                {diasPendientes.length > 7 && <span style={{ fontSize: 10.5, color: 'var(--tm)', alignSelf: 'center' }}>…y {diasPendientes.length - 7} día(s) más antiguos</span>}
              </div>
            </div>
          )}
          <div className="card card-p">
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div>
                <label className="flabel">Día del reporte</label>
                <input className="fi" type="date" max={hoy} style={{ maxWidth: 170 }} value={repFecha} onChange={e => setRepFecha(e.target.value || hoy)} />
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className={`btn btn-sm ${!repTodas ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setRepTodas(false)}>Mis partidas</button>
                <button className={`btn btn-sm ${repTodas ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setRepTodas(true)}>Todas las partidas</button>
              </div>
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', color: 'var(--amber)' }}
                title="Hoy (o el día elegido) no se avanzó metrado: reportalo con motivo y foto"
                onClick={() => setSinAvanceOpen({ fecha: repFecha })}>
                🚫 Sin avance este día
              </button>
            </div>
            {repFecha !== hoy && (
              <div style={{ marginTop: 10 }}>
                <label className="flabel" style={{ color: 'var(--amber)' }}>Motivo del reporte de otro día * (¿por qué no lo subiste ese día?)</label>
                <input className="fi" style={FI16} value={repMotivoTardio} onChange={e => setRepMotivoTardio(e.target.value)} placeholder="Ej. no tuve señal en obra / olvidé subirlo…" />
              </div>
            )}
          </div>
          {hayBorrador && draftPendiente && (
            <div className="card card-p" style={{ background: 'rgba(245,180,40,0.08)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--amber)', display: 'inline-block' }} />
              <span style={{ fontSize: 12.5 }}>Tenés un borrador del {repFecha} sin terminar.</span>
              <button className="btn btn-amber btn-xs" onClick={() => cargarBorrador()}>{repLineas.length ? 'Cargar (se suma a lo de abajo)' : 'Cargar borrador'}</button>
              <button className="btn btn-ghost btn-xs" onClick={descartarBorrador}>Descartar</button>
            </div>
          )}
          {/* Wrapper BLOCK a propósito (hallazgo de la revisión adversarial): como
              hijo directo del grid, el containing block de la barra sticky era su
              propia fila auto → sticky inerte. Dentro de este bloque alto sí tiene
              recorrido y se pega al fondo del scrollport (.page-wrap). */}
          <div>
            <div style={{ display: 'grid', gap: 12 }}>{editorLineas(true)}</div>
            {repLineas.length > 0 && (
              // Barra STICKY: en móvil, con 2-3 partidas cargadas el botón de enviar
              // quedaba a dos pantallas de scroll. El borrador ahora se guarda solo
              // (autosave con debounce) — ya no hace falta el botón manual.
              <div className="modal-actions" style={{ display: 'flex', gap: 10, alignItems: 'center', position: 'sticky', bottom: 0, zIndex: 5, background: 'var(--bg-p)', padding: '10px 0' }}>
                <button className="btn btn-amber" disabled={busyRep} onClick={pedirConfirmReporte} style={{ padding: '10px 16px' }}><JxIcon name="check" size={13} />Enviar reporte ({repLineas.length})</button>
                <span style={{ fontSize: 10.5, color: 'var(--tm)' }}>El borrador se guarda solo (las fotos se re-adjuntan al retomar)</span>
              </div>
            )}
          </div>
        </div>
      )}

      {vista === 'plan' && (
        <div style={{ display: 'grid', gap: 12 }}>
          {esMiFrente && (
          <div className="card card-p" style={{ maxWidth: 580 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Programar meta (lookahead)</div>
            <div className="g2">
              <div><label className="flabel">Partida *</label>
                <select className="fi" value={meta.partida_id} onChange={e => setMeta({ ...meta, partida_id: e.target.value })}>
                  <option value="">— Elegí —</option>
                  {partidasDelFrente.map(p => <option key={p.id} value={p.id}>{nombrePart(p)}</option>)}
                </select></div>
              <div><label className="flabel">Fecha *</label><input className="fi" type="date" value={meta.fecha} onChange={e => setMeta({ ...meta, fecha: e.target.value })} /></div>
              <div><label className="flabel">Meta de metrado</label><input className="fi" type="number" step="0.01" value={meta.meta_metrado} onChange={e => setMeta({ ...meta, meta_metrado: e.target.value })} /></div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}><button className="btn btn-amber btn-sm" onClick={guardarMeta}>Guardar meta</button></div>
            </div>
          </div>
          )}
          <div className="card" style={{ overflow: 'auto' }}>
            <div style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 600 }}>Plan vs Real (acumulado)</div>
            <table className="tbl" style={{ fontSize: 12 }}>
              <thead><tr><th>Partida</th><th style={{ textAlign: 'right' }}>Meta</th><th style={{ textAlign: 'right' }}>Real</th><th style={{ textAlign: 'right' }}>Desvío</th></tr></thead>
              <tbody>
                {planFila.filter(f => f.metaMetrado > 0 || f.realMetrado > 0).map(f => (
                  <tr key={f.partida.id}><td>{nombrePart(f.partida)}</td><td style={{ textAlign: 'right' }}>{num(f.metaMetrado)}</td>
                    <td style={{ textAlign: 'right' }}>{num(f.realMetrado)}</td>
                    <td style={{ textAlign: 'right', color: f.desvio < 0 ? 'var(--red)' : 'var(--green)' }}>{f.desvio >= 0 ? '+' : ''}{num(f.desvio)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card" style={{ overflow: 'auto' }}>
            <div style={{ padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>Rollup mensual (metrado real → referencia valorización)</span>
              <input className="fi" type="month" style={{ maxWidth: 160 }} value={mes} onChange={e => setMes(e.target.value)} />
            </div>
            <table className="tbl" style={{ fontSize: 12 }}>
              <thead><tr><th>Partida</th><th style={{ textAlign: 'right' }}>Metrado del mes</th></tr></thead>
              <tbody>
                {rollup.map(r => <tr key={r.partida.id}><td>{nombrePart(r.partida)}</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{num(r.metradoMes)}</td></tr>)}
                {rollup.length === 0 && <tr><td colSpan={2} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>Sin avances reportados este mes.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {vista === 'borradores' && (() => {
        void draftTick;   // re-evaluar al eliminar
        const prefix = `jx_repdraft_${obraId}_${userId}_`;
        const items = [];
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k || !k.startsWith(prefix)) continue;
            const fecha = k.slice(prefix.length);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) continue;
            let lineas = []; try { lineas = JSON.parse(localStorage.getItem(k) || '[]'); } catch {}
            items.push({ key: k, fecha, n: Array.isArray(lineas) ? lineas.length : 0 });
          }
        } catch {}
        items.sort((a, b) => b.fecha.localeCompare(a.fecha));
        const retomar = (it) => { window.__miFrenteIntent = { tipo: 'borrador', fecha: it.fecha, ts: Date.now() }; window.__navTo?.('reporte-diario'); };
        const eliminar = (it) => {
          try { localStorage.removeItem(it.key); } catch {}
          if (it.key === draftKey) { setHayBorrador(false); setDraftPendiente(false); }
          // Si ese borrador sigue VIVO en el editor (buffer en RAM), vaciarlo
          // también: si no, el autosave lo re-escribía a los 1.5s y "Eliminar"
          // no eliminaba nada.
          try {
            const live = window.__miFrenteRepLive?.[repLiveKey];
            if (live && (live.fecha || hoy) === it.fecha && Array.isArray(live.lineas) && live.lineas.length) {
              window.__miFrenteRepLive[repLiveKey] = { ...live, lineas: [] };
              setRepLineas([]);
            }
          } catch {}
          setDraftTick(t => t + 1);
        };
        return (
          <div className="card" style={{ overflow: 'auto' }}>
            <div style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 600 }}>Borradores guardados ({items.length})</div>
            <div style={{ padding: '0 12px 8px', fontSize: 11, color: 'var(--tm)' }}>Reportes que dejaste a medias. Retomá uno para terminarlo o eliminalo. Las fotos no se guardan en el borrador; se vuelven a adjuntar al terminar.</div>
            <table className="tbl" style={{ fontSize: 12 }}>
              <thead><tr><th>Día</th><th style={{ textAlign: 'right' }}>Partidas</th><th></th></tr></thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.key}>
                    <td>{it.fecha}{it.fecha === hoy ? <span className="badge b-green" style={{ marginLeft: 6, fontSize: 9 }}>hoy</span> : null}</td>
                    <td style={{ textAlign: 'right' }}>{it.n}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-amber btn-xs" onClick={() => retomar(it)}>Retomar</button>
                      <button className="btn btn-ghost btn-xs" style={{ marginLeft: 4 }} onClick={() => eliminar(it)}>Eliminar</button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td colSpan={3} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>No tenés borradores guardados.</td></tr>}
              </tbody>
            </table>
          </div>
        );
      })()}

      {ctx && (
        <div onClick={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()}
          style={{ position: 'fixed', left: Math.min(ctx.x, (window.innerWidth || 800) - 260), top: Math.min(ctx.y, (window.innerHeight || 600) - 110), zIndex: 9999, background: '#23232a', border: '1px solid var(--bd)', borderRadius: 8, boxShadow: '0 8px 28px rgba(0,0,0,.45)', minWidth: 240, overflow: 'hidden' }}>
          <div style={{ padding: '7px 11px', fontSize: 10.5, color: 'var(--tm)', borderBottom: '1px solid var(--bd)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>
            <span style={{ fontFamily: 'monospace' }}>{ctx.partida.codigo_delfin}</span> · {ctx.partida.nombre_partida}
          </div>
          <button style={ctxBtn} onClick={() => { irACostoUnitario(ctx.partida); setCtx(null); }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>📋 Ir al costo unitario de la partida</button>
          {!esCapitulo(ctx.partida) && (
            <button style={ctxBtn} onClick={() => { generarReporteDe(ctx.partida); setCtx(null); }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>📝 Agregar reporte de esta partida</button>
          )}
          {frentesNombresDe(ctx.partida.id).length === 0 && (
            <button style={{ ...ctxBtn, borderTop: '1px solid var(--bd)' }} onClick={() => { solicitarFrente(ctx.partida); setCtx(null); }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>🏗️ {solFrentePend(ctx.partida.id) ? 'Frente solicitado (pendiente)' : 'Solicitar crear frente para esta partida'}</button>
          )}
        </div>
      )}

      {sinAvanceOpen && (
        <SinAvanceModal
          fecha={sinAvanceOpen.fecha}
          hoy={hoy}
          misFrentes={misFrentes}
          busy={busySinAvance}
          onConfirm={guardarSinAvance}
          onClose={() => setSinAvanceOpen(null)}
        />
      )}

      {confirmRep && (
        <Modal title="Confirmar reporte diario" icon="check" onClose={() => !busyRep && setConfirmRep(null)}>
          <div style={{ fontSize: 12.5, color: 'var(--tm)', marginBottom: 4 }}>
            Vas a subir el reporte del <strong style={{ color: 'var(--tx)' }}>{repFecha}{repFecha !== hoy ? ' (otro día)' : ''}</strong> con avance en estas <strong style={{ color: 'var(--tx)' }}>{confirmRep.length}</strong> partida(s):
          </div>
          {/* Tarjetas apiladas en vez de tabla: la tabla obligaba a scroll
              HORIZONTAL en el celular justo en el paso final del envío. */}
          <div style={{ maxHeight: 320, overflow: 'auto', display: 'grid', gap: 6, marginTop: 8 }}>
            {confirmRep.map(({ linea, partida, sobre }) => (
              <div key={linea.partida_id} style={{ padding: '8px 10px', border: '1px solid var(--bd)', borderRadius: 6, background: 'rgba(255,255,255,0.03)' }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  <span style={{ fontFamily: 'monospace', color: 'var(--tm)' }}>{partida?.codigo_delfin}</span> {partida?.nombre_partida || '—'}
                  {sobre && <span className="badge b-red" style={{ marginLeft: 6, fontSize: 9 }} title="Reporte sobre una partida ya terminada → alerta a gerencia">⚠ sobre-reporte</span>}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--tm)', marginTop: 3 }}>
                  Metrado: <strong style={{ color: 'var(--tx)' }}>{num(linea.metrado)} {partida?.unidad || ''}</strong> · 📷 {(linea.fotos || []).length} foto(s)
                </div>
              </div>
            ))}
          </div>
          {confirmRep.some(c => c.sobre) && (
            <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--red)' }}>⚠ Hay reporte(s) sobre partidas ya terminadas — se enviará una alerta a gerencia/administración para revisar.</div>
          )}
          {repFecha !== hoy && repMotivoTardio.trim() && (
            <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--amber)' }}>Motivo del reporte tardío: {repMotivoTardio.trim()}</div>
          )}
          <div className="modal-actions">
            <button className="btn btn-ghost" disabled={busyRep} onClick={() => setConfirmRep(null)}>Cancelar</button>
            <button className="btn btn-amber" disabled={busyRep} onClick={guardarReporte}><JxIcon name="check" size={13} />{busyRep ? 'Subiendo…' : 'Confirmar y subir reporte'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Emitir Alerta técnica → crea una incidencia (el ingeniero no ve el listado global).
function EmitirAlertaPage({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const userId = auth?.profile?.id || null;
  const obraHook = window.__useObraActiva ? window.__useObraActiva() : { obraId: null };
  const obraId = obraHook?.obraId || null;
  const incHook = window.__hooks.useIncidencias(obraId);
  const { data: frentes } = window.__hooks.useFrentesObra(obraId, { soloActivas: true });
  const misFrentes = uM(() => frentesDeUsuario(userId, { frentes: frentes || [] }), [userId, frentes]);
  const [form, setForm] = uS({ tipo_incidencia: 'calidad', severidad: 'media', descripcion: '' });
  const [busy, setBusy] = uS(false);
  const emitir = async () => {
    if (!(form.descripcion || '').trim()) { showToast('Describí la alerta', 'red'); return; }
    setBusy(true);
    try {
      const frenteNom = misFrentes[0]?.nombre || '';
      await incHook.create({
        id: window.__newId(), obra_id: obraId, tipo_incidencia: form.tipo_incidencia, severidad: form.severidad,
        descripcion: (frenteNom ? `[Frente ${frenteNom}] ` : '') + form.descripcion,
        modulo_origen: 'ingenieria_frente', estado: 'abierta', creado_por: userId,
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'incidencias' } })); } catch {}
      showToast('Alerta emitida', 'green');
      setForm({ tipo_incidencia: 'calidad', severidad: 'media', descripcion: '' });
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };
  if (!obraId) return <div className="page-wrap"><div className="card card-p empty-state"><p>Seleccioná una obra activa.</p></div></div>;
  return (
    <div className="page-wrap">
      <div className="pg-hd"><div className="pg-title">Emitir Alerta</div><div className="pg-sub">Reportá una incidencia técnica de tu frente.</div></div>
      <div className="card card-p" style={{ maxWidth: 560 }}>
        <div className="g2">
          <div><label className="flabel">Tipo</label>
            <select className="fi" value={form.tipo_incidencia} onChange={e => setForm({ ...form, tipo_incidencia: e.target.value })}>
              {['seguridad', 'calidad', 'material', 'equipo', 'accidente'].map(t => <option key={t} value={t}>{t}</option>)}
            </select></div>
          <div><label className="flabel">Severidad</label>
            <select className="fi" value={form.severidad} onChange={e => setForm({ ...form, severidad: e.target.value })}>
              {['baja', 'media', 'alta', 'critica'].map(s => <option key={s} value={s}>{s}</option>)}
            </select></div>
        </div>
        <label className="flabel" style={{ marginTop: 8 }}>Descripción *</label>
        <textarea className="fi" rows={4} value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })} placeholder="Qué pasó, dónde, qué se necesita…" />
        <div className="modal-actions" style={{ marginTop: 12 }}>
          <button className="btn btn-amber" disabled={busy} onClick={emitir}><JxIcon name="alert" size={13} />Emitir alerta</button>
        </div>
      </div>
    </div>
  );
}

// Bandeja del ADMIN/GERENTE: oficializar partidas huérfanas como frente.
function AprobacionesReportePage({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const userId = auth?.profile?.id || null;
  const obraHook = window.__useObraActiva ? window.__useObraActiva() : { obraId: null };
  const obraId = obraHook?.obraId || null;
  const solFrenteHook = window.__hooks.useSolicitudesFrente(obraId);
  const { data: solicitudes } = solFrenteHook;
  const frentesHook = window.__hooks.useFrentesObra(obraId);
  const { data: frentes } = frentesHook;
  const fpHook = window.__hooks.useFrentePartidas(obraId);
  const partidasHook = window.__hooks.usePartidas(obraId);
  const { data: partidas } = partidasHook;
  const movHook = window.__hooks.useMovimientosMateriales(obraId);
  const { data: movs } = movHook;
  const avanceHook = window.__hooks.useAvanceObra(obraId);
  const { data: avances } = avanceHook;
  const { data: materiales } = window.__hooks.useMateriales(obraId);
  const materialesById = uM(() => { const m = new Map(); (materiales || []).forEach(x => m.set(x.id, x)); return m; }, [materiales]);
  const [usuarios, setUsuarios] = uS([]);
  uE(() => { window.__db.profiles.toArray().then(setUsuarios).catch(() => {}); }, []);
  const usuariosById = uM(() => { const m = new Map(); (usuarios || []).forEach(u => m.set(u.id, u)); return m; }, [usuarios]);
  const nombreUsuario = (id) => { const u = usuariosById.get(id); return u ? (`${u.nombres || ''} ${u.apellidos || ''}`.trim() || u.email || '—') : '—'; };
  const frentesById = uM(() => { const m = new Map(); (frentes || []).forEach(f => m.set(f.id, f)); return m; }, [frentes]);
  const partById = uM(() => { const m = new Map(); (partidas || []).forEach(p => m.set(p.id, p)); return m; }, [partidas]);
  const [busy, setBusy] = uS(false);
  const EST = { solicitado: { label: 'Pendiente', color: 'var(--amber)' }, aprobado: { label: 'Frente creado', color: 'var(--green)' }, rechazado: { label: 'Rechazada', color: 'var(--red)' } };
  const estInfo = (e) => EST[e] || { label: e || '—', color: 'var(--tm)' };

  const pend = uM(() => (solicitudes || []).filter(s => !s.deleted_at && s.estado === 'solicitado').sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''))), [solicitudes]);
  const histo = uM(() => (solicitudes || []).filter(s => !s.deleted_at && s.estado !== 'solicitado').sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 30), [solicitudes]);
  // Salidas vinculadas a la partida de la solicitud (insumos que se transferirán al nuevo frente).
  const insumosDeSol = (sol) => (movs || []).filter(m => !m.deleted_at && m.tipo_movimiento === 'salida' && m.partida_id === sol.partida_id);

  const rechazar = async (sol) => {
    const nota = window.prompt('Motivo del rechazo (opcional):') ?? '';
    setBusy(true);
    try {
      await solFrenteHook.update(sol.id, { estado: 'rechazado', nota_decision: nota || null, decidido_por: userId, decidido_at: new Date().toISOString(), updated_by: userId });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'solicitudes_frente' } })); } catch {}
      showToast('Solicitud rechazada', 'amber');
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };
  const crearFrente = async (sol, esPequeno) => {
    const p = partById.get(sol.partida_id);
    if (!p) { showToast('No encuentro la partida', 'red'); return; }
    const sugerido = esPequeno ? `Frente ${p.codigo_delfin}` : (sol.nombre_sugerido || p.nombre_partida || `Frente ${p.codigo_delfin}`);
    const nombre = window.prompt(esPequeno ? 'Oficializar como frente pequeño — nombre:' : 'Crear frente — nombre:', sugerido);
    if (nombre === null) return;
    if (!nombre.trim()) { showToast('Poné un nombre', 'red'); return; }
    setBusy(true);
    try {
      const fNuevo = await frentesHook.create({ obra_id: obraId, nombre: nombre.trim(), descripcion: esPequeno ? 'Frente pequeño (1 partida) oficializado desde una partida huérfana.' : (sol.motivo || null), ingeniero_user_id: sol.solicitante_user_id || null, orden: 999, activo: true });
      try { await fpHook.create({ obra_id: obraId, frente_id: fNuevo.id, codigo_delfin: p.codigo_delfin, partida_id: p.id, nivel: String(p.codigo_delfin || '').split('.').filter(Boolean).length }); } catch (e) { console.warn('[crearFrente fp]', e?.message); }
      for (const m of insumosDeSol(sol)) { try { await movHook.update(m.id, { frente_id: fNuevo.id, frente_pendiente: false }); } catch {} }
      for (const a of (avances || [])) { if (a.deleted_at || a.partida_id !== sol.partida_id || a.frente_id) continue; try { await avanceHook.update(a.id, { frente_id: fNuevo.id }); } catch {} }
      await solFrenteHook.update(sol.id, { estado: 'aprobado', es_pequeno: !!esPequeno, frente_creado_id: fNuevo.id, decidido_por: userId, decidido_at: new Date().toISOString(), updated_by: userId });
      for (const t of ['frentes_obra', 'frente_partidas', 'movimientos_materiales', 'avance_obra', 'solicitudes_frente']) { try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: t } })); } catch {} }
      showToast(`Frente "${nombre.trim()}" creado · ${nombreUsuario(sol.solicitante_user_id)} responsable`, 'green');
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };

  if (!obraId) return <div className="page-wrap"><div className="card card-p empty-state"><p>Seleccioná una obra activa.</p></div></div>;
  return (
    <div className="page-wrap">
      <div className="pg-hd"><div className="pg-title">Aprobación de Frentes</div><div className="pg-sub">Partidas sin frente que un ingeniero pide oficializar como frente de trabajo.</div></div>
      <div className="card" style={{ overflow: 'auto', marginBottom: 14 }}>
        <div style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 600 }}>Pendientes ({pend.length})</div>
        {pend.length === 0 && <div style={{ padding: '0 12px 12px', color: 'var(--tm)', fontStyle: 'italic', fontSize: 12 }}>No hay solicitudes pendientes.</div>}
        {pend.map(sol => {
          const p = partById.get(sol.partida_id);
          const insumos = insumosDeSol(sol);
          return (
            <div key={sol.id} className="card card-p" style={{ margin: '0 12px 12px' }}>
              <div className="frow-sb" style={{ flexWrap: 'wrap', gap: 6 }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{p ? <><span style={{ fontFamily: 'monospace', color: 'var(--tm)' }}>{p.codigo_delfin}</span> {p.nombre_partida}</> : sol.partida_id}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>Solicita: {nombreUsuario(sol.solicitante_user_id)}{sol.motivo ? ` · ${sol.motivo}` : ''}</div>
                </div>
                <span className="badge" style={{ background: estInfo(sol.estado).color, color: '#000', fontSize: 10, height: 'fit-content' }}>{estInfo(sol.estado).label}</span>
              </div>
              {insumos.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, color: 'var(--tm)', marginBottom: 4 }}>Insumos vinculados (se transferirán al frente): {insumos.length}</div>
                  <table className="tbl" style={{ fontSize: 11.5 }}><tbody>
                    {insumos.slice(0, 8).map(m => <tr key={m.id}><td>{m.fecha || '—'}</td><td>{materialesById.get(m.material_id)?.nombre_material || '—'}</td><td style={{ textAlign: 'right' }}>{num(m.cantidad)} {m.unidad || ''}</td><td>{frentesById.get(m.frente_id)?.nombre || <span style={{ color: 'var(--tm)' }}>sin frente</span>}</td></tr>)}
                  </tbody></table>
                  {insumos.length > 8 && <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>… y {insumos.length - 8} más</div>}
                </div>
              )}
              <div className="modal-actions" style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-green btn-sm" disabled={busy} onClick={() => crearFrente(sol, false)}>Crear frente</button>
                <button className="btn btn-amber btn-sm" disabled={busy} onClick={() => crearFrente(sol, true)}>Oficializar como frente pequeño</button>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => rechazar(sol)}>Rechazar</button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="card" style={{ overflow: 'auto' }}>
        <div style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 600 }}>Historial reciente</div>
        <table className="tbl" style={{ fontSize: 12 }}>
          <thead><tr><th>Partida</th><th>Solicita</th><th>Resultado</th><th>Frente</th></tr></thead>
          <tbody>
            {histo.map(sol => { const p = partById.get(sol.partida_id); return (
              <tr key={sol.id}><td>{p ? p.codigo_delfin : '—'}</td><td>{nombreUsuario(sol.solicitante_user_id)}</td><td><span className="badge" style={{ background: estInfo(sol.estado).color, color: '#000', fontSize: 9 }}>{estInfo(sol.estado).label}{sol.es_pequeno ? ' · pequeño' : ''}</span></td><td>{frentesById.get(sol.frente_creado_id)?.nombre || '—'}</td></tr>
            ); })}
            {histo.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>Sin historial.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Visor de fotos de un reporte (carga las firmas/blobs vía getEvidenciaSrc).
function EvidenciaViewer({ evidencias, onClose }) {
  const [srcs, setSrcs] = uS([]);
  const [cargando, setCargando] = uS(true);
  uE(() => {
    let c = false; const creadas = [];
    setCargando(true); setSrcs([]);
    (async () => {
      try {
        const { getEvidenciaSrc } = await import('../lib/evidencias-url.js');
        const out = [];
        for (const ev of (evidencias || [])) {
          const r = await getEvidenciaSrc(ev);
          if (c) { if (r?.isBlob) { try { URL.revokeObjectURL(r.url); } catch {} } break; }   // se cerró el modal mientras cargaba → revocar el blob recién creado y salir (sin fuga)
          if (r) { out.push({ ev, url: r.url }); if (r.isBlob) creadas.push(r.url); }
        }
        if (!c) { setSrcs(out); setCargando(false); }
      } catch { if (!c) setCargando(false); }
    })();
    return () => { c = true; creadas.forEach(u => { try { URL.revokeObjectURL(u); } catch {} }); };
  }, [evidencias]);
  return (
    <Modal title={`Fotos del reporte (${(evidencias || []).length})`} icon="image" onClose={onClose} size="wide">
      {cargando
        ? <div style={{ color: 'var(--tm)', fontStyle: 'italic', padding: 8 }}>Cargando fotos…</div>
        : srcs.length === 0
          ? <div style={{ color: 'var(--tm)', fontStyle: 'italic', padding: 8 }}>No se pudieron cargar las fotos de este reporte.</div>
          : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 10 }}>
              {srcs.map((s, i) => {
                // HEIC legacy (fotos de iPhone subidas ANTES del conversor):
                // ningún navegador de escritorio las renderiza — tarjeta de
                // descarga en vez de un <img> roto que solo mostraba el nombre.
                const esHeic = /\.hei[cf]$/i.test(String(s.ev.nombre_archivo || '')) || String(s.ev.mime_type || '').includes('hei');
                if (esHeic) return (
                  <a key={i} href={s.url} target="_blank" rel="noreferrer" download
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, height: 160, borderRadius: 8, border: '1px dashed var(--bd)', background: 'var(--bg2)', textDecoration: 'none' }}
                    title="Foto en formato HEIC (iPhone) — el navegador no la muestra; descargala para verla. Las fotos nuevas ya se convierten solas.">
                    <span style={{ fontSize: 22 }}>📷</span>
                    <span style={{ fontSize: 10.5, color: 'var(--ts)', textAlign: 'center', padding: '0 8px' }}>{String(s.ev.nombre_archivo || 'foto').slice(0, 28)}</span>
                    <span className="badge b-amber" style={{ fontSize: 9 }}>HEIC — descargar ⬇</span>
                  </a>
                );
                return (
                  <a key={i} href={s.url} target="_blank" rel="noreferrer" style={{ display: 'block' }} title={s.ev.nombre_archivo || 'foto'}>
                    <img src={s.url} alt={s.ev.nombre_archivo || 'foto'} style={{ width: '100%', height: 160, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--bd)' }}
                      onError={e => { e.currentTarget.outerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:160px;border:1px dashed #333;border-radius:8px;font-size:11px;color:#889">no se pudo mostrar — usá el link</div>'; }} />
                  </a>
                );
              })}
            </div>
          )}
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════
// RENDIMIENTO DE INGENIEROS (admin/gerente): desempeño por ingeniero y por
// frente (ritmo requerido del Gantt vs avance reportado) + bandeja de reportes
// diarios filtrable por ingeniero/fecha. Reusa rendimientoPartida/Conjunto.
// ═══════════════════════════════════════════════════════════════════
// ─── Mis Reportes (ingeniero): ve sus reportes y solicita cambios (aprueba admin) ───
function MisReportesPage() {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const userId = auth?.profile?.id || null;
  const obraHook = window.__useObraActiva ? window.__useObraActiva() : { obraId: null };
  const obraId = obraHook?.obraId || null;
  const { data: avances } = window.__hooks.useAvanceObra(obraId);
  const { data: partidas } = window.__hooks.usePartidas(obraId);
  const RCM = window.RequestChangeModal;
  const [solChange, setSolChange] = uS(null);   // avance al que se le solicita un cambio
  const [verFotos, setVerFotos] = uS(null);
  const [evis, setEvis] = uS([]);
  uE(() => {
    if (!obraId) { setEvis([]); return; }
    let c = false;
    const load = () => window.__db.evidencias.where('obra_id').equals(obraId)
      .filter(e => !e.deleted_at && e.modulo_relacionado === 'avance_obra').toArray()
      .then(r => { if (!c) setEvis(r); }).catch(() => {});
    load();
    const on = (e) => { const t = e?.detail?.tabla; if (!t || t === 'evidencias') load(); };
    window.addEventListener('jx_data_changed', on);
    return () => { c = true; window.removeEventListener('jx_data_changed', on); };
  }, [obraId]);
  const partById = uM(() => { const m = new Map(); (partidas || []).filter(p => !p.deleted_at).forEach(p => m.set(p.id, p)); return m; }, [partidas]);
  const eviPorAvance = uM(() => { const m = new Map(); for (const e of evis) { if (!e.registro_relacionado_id) continue; const a = m.get(e.registro_relacionado_id) || []; a.push(e); m.set(e.registro_relacionado_id, a); } return m; }, [evis]);
  const misReportes = uM(() => (avances || []).filter(a => !a.deleted_at && a.responsable_id === userId && a.origen !== 'importacion')
    .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || ''))), [avances, userId]);
  const labelPartida = (a) => { const p = partById.get(a.partida_id); return p ? `${p.codigo_delfin || ''} · ${p.nombre_partida || ''}`.trim().replace(/^· /, '') : 'partida'; };

  if (!obraId) return <div className="page-wrap"><div className="card card-p empty-state"><p>Seleccioná una obra activa.</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd">
        <div className="pg-title">Mis Reportes</div>
        <div className="pg-sub">Los avances que reportaste. Podés solicitar un cambio (fecha, descripción, metrado o fotos) con su justificación — lo aplica un administrador al aprobarlo.</div>
      </div>
      <div className="card" style={{ overflow: 'auto' }}>
        <table className="tbl" style={{ fontSize: 12 }}>
          <thead><tr><th>Fecha</th><th>Partida</th><th style={{ textAlign: 'right' }}>Metrado</th><th style={{ textAlign: 'right' }}>% acum.</th><th>Descripción</th><th style={{ textAlign: 'center' }}>Fotos</th><th></th></tr></thead>
          <tbody>
            {misReportes.map(a => { const p = partById.get(a.partida_id); const evs = eviPorAvance.get(a.id) || []; return (
              <tr key={a.id} style={a.sobre_reporte ? { background: 'rgba(231,76,60,0.06)' } : undefined}>
                <td style={{ whiteSpace: 'nowrap' }}>{a.fecha || '—'}</td>
                <td>{p ? <><span style={{ fontFamily: 'monospace', color: 'var(--tm)' }}>{p.codigo_delfin}</span> {p.nombre_partida}</> : '—'}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{num(a.metrado_ejecutado)} {p?.unidad || ''}</td>
                <td style={{ textAlign: 'right' }}>{a.porcentaje_avance_reportado != null ? Number(a.porcentaje_avance_reportado).toFixed(1) + '%' : '—'}</td>
                <td style={{ maxWidth: 320, fontSize: 11, color: 'var(--ts)' }}>{a.descripcion || <span style={{ color: 'var(--tm)', fontStyle: 'italic' }}>—</span>}</td>
                <td style={{ textAlign: 'center' }}>{evs.length > 0 ? <button className="btn btn-ghost btn-xs" onClick={() => setVerFotos(evs)}>📷 {evs.length}</button> : <span style={{ color: 'var(--tm)' }}>—</span>}</td>
                <td style={{ textAlign: 'right' }}><button className="btn btn-ghost btn-xs" title="Solicitar un cambio en este reporte (lo aprueba un admin)" onClick={() => setSolChange(a)} disabled={!RCM}><JxIcon name="edit" size={11} /> Solicitar cambio</button></td>
              </tr>
            ); })}
            {misReportes.length === 0 && <tr><td colSpan={7} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>Todavía no enviaste reportes. Andá a "Reporte Diario" para registrar tu primer avance.</td></tr>}
          </tbody>
        </table>
      </div>
      {verFotos && <EvidenciaViewer evidencias={verFotos} onClose={() => setVerFotos(null)} />}
      {solChange && RCM && <RCM
        table="avance_obra"
        record={solChange}
        recordLabel={`Reporte ${solChange.fecha || ''} · ${labelPartida(solChange)}`}
        fields={[
          { key: 'fecha', label: 'Fecha del reporte', type: 'date' },
          { key: 'descripcion', label: 'Descripción del avance' },
          { key: 'metrado_ejecutado', label: 'Metrado ejecutado', type: 'number' },
        ]}
        onClose={() => setSolChange(null)} />}
    </div>
  );
}

function RendimientoIngenierosPage() {
  const showToast = window.__showToast || (() => {});   // esta página no recibe showToast por prop
  const obraHook = window.__useObraActiva ? window.__useObraActiva() : { obraId: null };
  const obraId = obraHook?.obraId || null;
  const { data: frentes } = window.__hooks.useFrentesObra(obraId, { soloActivas: true });
  const { data: frentePartidas } = window.__hooks.useFrentePartidas(obraId);
  const { data: partidas } = window.__hooks.usePartidas(obraId);
  const { data: avances } = window.__hooks.useAvanceObra(obraId);
  const [usuarios, setUsuarios] = uS([]);
  uE(() => { window.__db.profiles.toArray().then(setUsuarios).catch(() => {}); }, []);
  // Evidencias de avance (para contar/mostrar las fotos de cada reporte).
  const [eviAvance, setEviAvance] = uS([]);
  uE(() => {
    if (!obraId) { setEviAvance([]); return; }
    let c = false;
    const load = () => window.__db.evidencias.where('obra_id').equals(obraId)
      .filter(e => !e.deleted_at && e.modulo_relacionado === 'avance_obra').toArray()
      .then(r => { if (!c) setEviAvance(r); }).catch(() => {});
    load();
    const on = (e) => { const t = e?.detail?.tabla; if (!t || t === 'evidencias') load(); };
    window.addEventListener('jx_data_changed', on);
    return () => { c = true; window.removeEventListener('jx_data_changed', on); };
  }, [obraId]);
  const [tab, setTab] = uS('ingenieros');   // 'ingenieros' | 'frentes'
  const [selIng, setSelIng] = uS('');        // filtro por ingeniero (reportes + drill-down)
  const [desde, setDesde] = uS('');
  const [hasta, setHasta] = uS('');
  const [verFotos, setVerFotos] = uS(null);  // evidencias del reporte abierto
  const [secOpen, setSecOpen] = uS({ reportes: true, partidas: true });  // secciones colapsables del detalle
  const [busqDetalle, setBusqDetalle] = uS('');  // búsqueda dentro del detalle de un ingeniero
  const [exportando, setExportando] = uS(false);

  const hoy = hoyISO();
  // Navegar a "Insumos por Partida" (admin) — mismo canal que jx-obra.jsx irAInsumos.
  const irAInsumosPartida = (p) => {
    if (!p) return;
    try {
      window.__insumosTargetPartida = p.id;
      window.__insumosTargetCodigo = p.codigo_delfin || '';
      window.__insumosTargetEsHoja = true;
      window.__insumosFromPartidas = true;
      window.__insumosFromGantt = false;
      window.dispatchEvent(new CustomEvent('jx_navigate', { detail: { page: 'insumos' } }));
    } catch {}
  };
  const usuariosById = uM(() => { const m = new Map(); (usuarios || []).forEach(u => m.set(u.id, u)); return m; }, [usuarios]);
  const nombreUsuario = (id) => { if (!id) return '—'; const u = usuariosById.get(id); return u ? (`${u.nombres || ''} ${u.apellidos || ''}`.trim() || u.email || '—') : '—'; };
  const activos = uM(() => (frentes || []).filter(f => !f.deleted_at), [frentes]);
  const allPartidas = uM(() => (partidas || []).filter(p => !p.deleted_at), [partidas]);
  const partById = uM(() => { const m = new Map(); allPartidas.forEach(p => m.set(p.id, p)); return m; }, [allPartidas]);
  const eviPorAvance = uM(() => {
    const m = new Map();
    const eviById = new Map();
    for (const e of eviAvance) {
      eviById.set(e.id, e);
      if (!e.registro_relacionado_id) continue;
      const a = m.get(String(e.registro_relacionado_id)) || []; a.push(e); m.set(String(e.registro_relacionado_id), a);
    }
    // Robustez: algunas fotos podrían estar enlazadas por el campo legacy
    // avance_obra.evidencia_id en vez de registro_relacionado_id.
    for (const av of (avances || [])) {
      if (!av.evidencia_id) continue;
      const ev = eviById.get(av.evidencia_id);
      if (!ev) continue;
      const a = m.get(String(av.id)) || [];
      if (!a.some(x => x.id === ev.id)) { a.push(ev); m.set(String(av.id), a); }
    }
    return m;
  }, [eviAvance, avances]);
  // Ingenieros = quienes están a cargo de un frente ∪ quienes han reportado avances.
  const ingenieros = uM(() => {
    const ids = new Set();
    activos.forEach(f => { if (f.ingeniero_user_id) ids.add(f.ingeniero_user_id); });
    (avances || []).forEach(a => { if (!a.deleted_at && a.responsable_id) ids.add(a.responsable_id); });
    return [...ids];
  }, [activos, avances]);
  const partidasDeIng = (id) => {
    const m = new Map();
    for (const f of activos.filter(f => f.ingeniero_user_id === id)) for (const p of partidasDeFrente(f.id, { frentePartidas: frentePartidas || [], partidas: partidas || [] })) m.set(p.id, p);
    return [...m.values()];
  };
  const idxOrd = (i) => (i == null ? Number.POSITIVE_INFINITY : i);   // sin_dato SIEMPRE al final al ordenar peor→mejor (aún detrás de índices >1)
  const statsIng = uM(() => ingenieros.map(id => {
    const ps = partidasDeIng(id);
    const rc = rendimientoConjunto(ps, avances || [], hoy);
    const sus = (avances || []).filter(a => !a.deleted_at && a.responsable_id === id);
    const metradoRep = sus.reduce((s, a) => s + (Number(a.metrado_ejecutado) || 0), 0);
    const ultimo = sus.reduce((mx, a) => (a.fecha && a.fecha > mx) ? a.fecha : mx, '');
    const nFrentes = activos.filter(f => f.ingeniero_user_id === id).length;
    const avgPct = ps.length ? ps.reduce((s, p) => s + (Number(p.porcentaje_avance) || 0), 0) / ps.length : 0;
    return { id, nombre: nombreUsuario(id), nFrentes, nPartidas: ps.length, avgPct, metradoRep, nReportes: sus.length, ultimo, rc };
  }).sort((a, b) => idxOrd(a.rc.indice) - idxOrd(b.rc.indice)), [ingenieros, activos, frentePartidas, partidas, avances, hoy, usuariosById]);
  const statsFrentes = uM(() => activos.map(f => {
    const ps = partidasDeFrente(f.id, { frentePartidas: frentePartidas || [], partidas: partidas || [] });
    const rc = rendimientoConjunto(ps, avances || [], hoy);
    const avgPct = ps.length ? ps.reduce((s, p) => s + (Number(p.porcentaje_avance) || 0), 0) / ps.length : 0;
    return { frente: f, ing: nombreUsuario(f.ingeniero_user_id), nPartidas: ps.length, avgPct, rc };
  }).sort((a, b) => idxOrd(a.rc.indice) - idxOrd(b.rc.indice)), [activos, frentePartidas, partidas, avances, hoy, usuariosById]);
  const partidasSel = uM(() => selIng ? partidasDeIng(selIng) : [], [selIng, activos, frentePartidas, partidas]);
  const reportes = uM(() => (avances || []).filter(a => !a.deleted_at && a.origen !== 'importacion'
      && (!selIng || a.responsable_id === selIng)
      && (!desde || (a.fecha || '') >= desde)
      && (!hasta || (a.fecha || '') <= hasta))
    .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || ''))), [avances, selIng, desde, hasta]);
  // Alertas de SOBRE-REPORTE: reportes hechos sobre partidas ya terminadas.
  const alertasSobre = uM(() => (avances || []).filter(a => !a.deleted_at && a.sobre_reporte)
    .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || ''))), [avances]);
  // Filtro de búsqueda dentro del detalle de un ingeniero (código/nombre de partida, descripción, fecha).
  const matchBusq = (p, extra) => {
    const q = busqDetalle.trim().toLowerCase();
    if (!q) return true;
    const hay = `${p?.codigo_delfin || ''} ${p?.nombre_partida || ''} ${extra || ''}`.toLowerCase();
    return q.split(/\s+/).every(t => hay.includes(t));
  };
  const reportesDetalle = uM(() => reportes.filter(a => matchBusq(partById.get(a.partida_id), `${a.descripcion || ''} ${a.fecha || ''}`)), [reportes, busqDetalle, partById]);
  const partidasSelFiltradas = uM(() => partidasSel.filter(p => matchBusq(p)), [partidasSel, busqDetalle]);

  // Export a Excel de los reportes (respeta los filtros activos: ingeniero/fechas).
  const exportarReportesExcel = async () => {
    if (!reportes.length) { showToast('No hay reportes para exportar', 'amber'); return; }
    setExportando(true);
    try {
      const XLSX = await import('xlsx');
      const headers = ['Fecha', 'Ingeniero', 'Frente', 'Codigo Partida', 'Partida', 'Unidad', 'Metrado', '% Acum', 'Descripcion', 'N Fotos', 'Sobre-reporte', 'Motivo sobre-reporte'];
      const rows = reportes.map(a => {
        const p = partById.get(a.partida_id);
        const fr = activos.find(f => f.id === a.frente_id);
        const evs = eviPorAvance.get(a.id) || [];
        return [a.fecha || '', nombreUsuario(a.responsable_id), fr?.nombre || '', p?.codigo_delfin || '', p?.nombre_partida || '', p?.unidad || '',
          a.metrado_ejecutado != null ? Number(a.metrado_ejecutado) : '', a.porcentaje_avance_reportado != null ? Number(a.porcentaje_avance_reportado) : '',
          a.descripcion || '', evs.length, a.sobre_reporte ? 'SI' : '', a.motivo_sobrereporte || ''];
      });
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      ws['!cols'] = headers.map((h, i) => ({ wch: Math.max(10, Math.min(48, i === 8 ? 40 : h.length + 4)) }));
      XLSX.utils.book_append_sheet(wb, ws, 'Reportes');
      XLSX.writeFile(wb, `JARVEX_reportes_avance_${hoy}.xlsx`);
      showToast(`${rows.length} reporte(s) exportados`, 'green');
    } catch (e) { showToast('Error al exportar: ' + (e.message || e), 'red'); }
    finally { setExportando(false); }
  };

  if (!obraId) return <div className="page-wrap"><div className="card card-p empty-state"><p>Seleccioná una obra activa.</p></div></div>;

  const conteoMini = (c) => <span style={{ fontSize: 9.5, color: 'var(--tm)' }}>{c.verde}🟢 {c.ambar}🟡 {c.rojo}🔴{c.sin_dato ? ` ${c.sin_dato}⚪` : ''}</span>;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div className="pg-title">Rendimiento de Ingenieros</div>
          <div className="pg-sub">Desempeño por ingeniero y por frente: ritmo requerido (del cronograma) vs avance reportado.</div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className={`btn btn-sm ${tab === 'ingenieros' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('ingenieros')}>Por ingeniero</button>
          <button className={`btn btn-sm ${tab === 'frentes' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('frentes')}>Por frente</button>
          <button className={`btn btn-sm ${tab === 'alertas' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('alertas')}>⚠ Alertas de avance{alertasSobre.length > 0 && <span className="badge b-red" style={{ marginLeft: 6, fontSize: 9 }}>{alertasSobre.length}</span>}</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--tm)', margin: '0 0 4px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><SemBadge s="verde" /> a ritmo o mejor</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><SemBadge s="ambar" /> cercano</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><SemBadge s="rojo" /> por debajo</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><SemBadge s="sin_dato" /> sin fechas plan</span>
        <span style={{ marginLeft: 'auto' }}>índice = real ÷ esperado a hoy (ponderado por metrado)</span>
      </div>

      {tab === 'ingenieros' && (
        <div className="card" style={{ overflow: 'auto' }}>
          <table className="tbl" style={{ fontSize: 12 }}>
            <thead><tr><th>Ingeniero</th><th>Rendimiento</th><th style={{ textAlign: 'right' }}>Frentes</th><th style={{ textAlign: 'right' }}>Partidas</th><th style={{ textAlign: 'right' }}>% avance</th><th style={{ textAlign: 'right' }}>Metrado rep.</th><th style={{ textAlign: 'right' }}>Reportes</th><th>Último</th><th></th></tr></thead>
            <tbody>
              {statsIng.map(s => (
                <tr key={s.id} style={{ background: selIng === s.id ? 'rgba(242,183,5,0.08)' : 'transparent' }}>
                  <td style={{ fontWeight: 600 }}>{s.nombre}</td>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><SemBadge s={s.rc.semaforo} />{s.rc.indice != null && <span style={{ fontSize: 10, color: 'var(--tm)' }}>{Math.round(s.rc.indice * 100)}%</span>}</div><div style={{ marginTop: 2 }}>{conteoMini(s.rc.conteo)}</div></td>
                  <td style={{ textAlign: 'right' }}>{s.nFrentes}</td>
                  <td style={{ textAlign: 'right' }}>{s.nPartidas}</td>
                  <td style={{ textAlign: 'right' }}>{Math.round(s.avgPct)}%</td>
                  <td style={{ textAlign: 'right' }}>{num(s.metradoRep)}</td>
                  <td style={{ textAlign: 'right' }}>{s.nReportes}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{s.ultimo || '—'}</td>
                  <td style={{ textAlign: 'right' }}><button className="btn btn-ghost btn-xs" onClick={() => setSelIng(selIng === s.id ? '' : s.id)}>{selIng === s.id ? 'Ocultar' : 'Ver detalle'}</button></td>
                </tr>
              ))}
              {statsIng.length === 0 && <tr><td colSpan={9} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>No hay ingenieros con frentes asignados ni reportes en esta obra.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'frentes' && (
        <div className="card" style={{ overflow: 'auto' }}>
          <table className="tbl" style={{ fontSize: 12 }}>
            <thead><tr><th>Frente</th><th>Ingeniero a cargo</th><th>Rendimiento</th><th style={{ textAlign: 'right' }}>Partidas</th><th style={{ textAlign: 'right' }}>% avance</th><th style={{ textAlign: 'right' }}>índice</th></tr></thead>
            <tbody>
              {statsFrentes.map(s => (
                <tr key={s.frente.id}>
                  <td style={{ fontWeight: 600 }}>{s.frente.nombre}</td>
                  <td>{s.ing}</td>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><SemBadge s={s.rc.semaforo} />{conteoMini(s.rc.conteo)}</div></td>
                  <td style={{ textAlign: 'right' }}>{s.nPartidas}</td>
                  <td style={{ textAlign: 'right' }}>{Math.round(s.avgPct)}%</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{s.rc.indice != null ? Math.round(s.rc.indice * 100) + '%' : '—'}</td>
                </tr>
              ))}
              {statsFrentes.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>No hay frentes en esta obra.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'alertas' && (
        <div className="card" style={{ overflow: 'auto' }}>
          <div style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 600 }}>⚠ Alertas de sobre-reporte ({alertasSobre.length})</div>
          <div style={{ padding: '0 12px 8px', fontSize: 11, color: 'var(--tm)' }}>Reportes de avance hechos sobre partidas que ya estaban al 100% / terminadas. Revisá el motivo: la partida puede no haber estado realmente lista.</div>
          <table className="tbl" style={{ fontSize: 12 }}>
            <thead><tr><th>Fecha</th><th>Ingeniero</th><th>Partida</th><th style={{ textAlign: 'right' }}>Metrado</th><th>Motivo</th><th style={{ textAlign: 'center' }}>Fotos</th></tr></thead>
            <tbody>
              {alertasSobre.map(a => { const p = partById.get(a.partida_id); const evs = eviPorAvance.get(a.id) || []; return (
                <tr key={a.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{a.fecha || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{nombreUsuario(a.responsable_id)}</td>
                  <td>{p ? <button className="lnk-partida" title="Ver en Insumos por Partida →" onClick={() => irAInsumosPartida(p)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--blue)', textAlign: 'left' }}><span style={{ fontFamily: 'monospace' }}>{p.codigo_delfin}</span> {p.nombre_partida} ›</button> : '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{num(a.metrado_ejecutado)} {p?.unidad || ''}</td>
                  <td style={{ maxWidth: 340, fontSize: 11, color: 'var(--ts)' }}>{a.motivo_sobrereporte || a.descripcion || <span style={{ color: 'var(--tm)', fontStyle: 'italic' }}>—</span>}</td>
                  <td style={{ textAlign: 'center' }}>{evs.length > 0 ? <button className="btn btn-ghost btn-xs" onClick={() => setVerFotos(evs)}>📷 {evs.length}</button> : <span style={{ color: 'var(--tm)' }}>—</span>}</td>
                </tr>
              ); })}
              {alertasSobre.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>Sin alertas de sobre-reporte. 👍</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Filtro + (detalle del ingeniero seleccionado | log global de reportes) */}
      <div className="card" style={{ overflow: 'auto' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{selIng ? `Detalle de ${nombreUsuario(selIng)}` : 'Reportes diarios'}</span>
          <select className="fi" style={{ maxWidth: 240 }} value={selIng} onChange={e => { setSelIng(e.target.value); setBusqDetalle(''); }}>
            <option value="">Todos los ingenieros</option>
            {ingenieros.map(id => <option key={id} value={id}>{nombreUsuario(id)}</option>)}
          </select>
          {selIng && <input className="fi" style={{ maxWidth: 220 }} placeholder="Buscar partida / descripción…" value={busqDetalle} onChange={e => setBusqDetalle(e.target.value)} />}
          <label style={{ fontSize: 11, color: 'var(--tm)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>Desde <input className="fi" type="date" style={{ maxWidth: 150 }} value={desde} onChange={e => setDesde(e.target.value)} /></label>
          <label style={{ fontSize: 11, color: 'var(--tm)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>Hasta <input className="fi" type="date" style={{ maxWidth: 150 }} value={hasta} onChange={e => setHasta(e.target.value)} /></label>
          {(desde || hasta || selIng || busqDetalle) && <button className="btn btn-ghost btn-xs" onClick={() => { setDesde(''); setHasta(''); setSelIng(''); setBusqDetalle(''); }}>Limpiar filtros</button>}
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} disabled={exportando || reportes.length === 0} onClick={exportarReportesExcel} title="Exportar a Excel los reportes (respeta los filtros)">
            <JxIcon name="download" size={12} /> {exportando ? 'Exportando…' : 'Exportar a Excel'}
          </button>
        </div>

        {selIng ? (
          <div style={{ padding: '0 4px 6px' }}>
            {/* Sección A: reportes del ingeniero (colapsable + buscable) */}
            <div style={{ borderTop: '1px solid var(--border)' }}>
              <button onClick={() => setSecOpen(s => ({ ...s, reportes: !s.reportes }))} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ts)', fontSize: 12.5, fontWeight: 600, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{secOpen.reportes ? '▾' : '▸'}</span> 📋 Reportes diarios <span style={{ color: 'var(--tm)', fontWeight: 400 }}>({reportesDetalle.length})</span>
              </button>
              {secOpen.reportes && (
                <table className="tbl" style={{ fontSize: 12 }}>
                  <thead><tr><th>Fecha</th><th>Partida</th><th style={{ textAlign: 'right' }}>Metrado</th><th>Descripción</th><th style={{ textAlign: 'center' }}>Fotos</th></tr></thead>
                  <tbody>
                    {reportesDetalle.slice(0, 300).map(a => { const p = partById.get(a.partida_id); const evs = eviPorAvance.get(a.id) || []; return (
                      <tr key={a.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{a.fecha || '—'}</td>
                        <td>{p ? <button className="lnk-partida" title="Ver en Insumos por Partida →" onClick={() => irAInsumosPartida(p)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--blue)', textAlign: 'left' }}><span style={{ fontFamily: 'monospace' }}>{p.codigo_delfin}</span> {p.nombre_partida} ›</button> : '—'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{num(a.metrado_ejecutado)} {p?.unidad || ''}</td>
                        <td style={{ maxWidth: 340, fontSize: 11, color: 'var(--ts)' }}>{a.descripcion || <span style={{ color: 'var(--tm)', fontStyle: 'italic' }}>—</span>}</td>
                        <td style={{ textAlign: 'center' }}>{evs.length > 0 ? <button className="btn btn-ghost btn-xs" onClick={() => setVerFotos(evs)}>📷 {evs.length}</button> : <span style={{ color: 'var(--tm)' }}>—</span>}</td>
                      </tr>
                    ); })}
                    {reportesDetalle.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>Sin reportes para el filtro elegido.</td></tr>}
                  </tbody>
                </table>
              )}
            </div>
            {/* Sección B: partidas del ingeniero + rendimiento estimado (colapsable + buscable) */}
            <div style={{ borderTop: '1px solid var(--border)' }}>
              <button onClick={() => setSecOpen(s => ({ ...s, partidas: !s.partidas }))} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ts)', fontSize: 12.5, fontWeight: 600, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{secOpen.partidas ? '▾' : '▸'}</span> 🎯 Partidas y rendimiento estimado <span style={{ color: 'var(--tm)', fontWeight: 400 }}>({partidasSelFiltradas.length})</span>
              </button>
              {secOpen.partidas && (
                <table className="tbl" style={{ fontSize: 12 }}>
                  <thead><tr><th>Código</th><th>Partida</th><th style={{ textAlign: 'right' }}>Metrado</th><th style={{ textAlign: 'right' }}>Ritmo req.</th><th style={{ textAlign: 'right' }}>Real / esperado</th><th>Rendimiento</th></tr></thead>
                  <tbody>
                    {partidasSelFiltradas.map(p => { const r = rendimientoPartida(p, avances || [], hoy); return (
                      <tr key={p.id}>
                        <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--tm)' }}>{p.codigo_delfin}</td>
                        <td><button className="lnk-partida" title="Ver en Insumos por Partida →" onClick={() => irAInsumosPartida(p)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--blue)', textAlign: 'left' }}>{p.nombre_partida} ›</button></td>
                        <td style={{ textAlign: 'right' }}>{num(p.metrado_contratado)} {p.unidad || ''}</td>
                        <td style={{ textAlign: 'right' }}>{r.metaDiaria > 0 ? `${num(r.metaDiaria)} ${p.unidad || ''}/día` : '—'}</td>
                        <td style={{ textAlign: 'right' }}>{r.indice != null ? `${num(r.realAcum)} / ${num(r.esperadoAcum)}` : '—'}</td>
                        <td><SemBadge s={r.semaforo} /></td>
                      </tr>
                    ); })}
                    {partidasSelFiltradas.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>{partidasSel.length === 0 ? 'Este ingeniero no tiene partidas en frentes asignados.' : 'Sin partidas para la búsqueda.'}</td></tr>}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : (
          <>
            <div style={{ padding: '0 12px 6px', fontSize: 11, color: 'var(--tm)' }}>{reportes.length} reporte(s) · elegí un ingeniero para ver su detalle (reportes + partidas).</div>
            <table className="tbl" style={{ fontSize: 12 }}>
              <thead><tr><th>Fecha</th><th>Ingeniero</th><th>Partida</th><th style={{ textAlign: 'right' }}>Metrado</th><th>Descripción</th><th style={{ textAlign: 'center' }}>Fotos</th></tr></thead>
              <tbody>
                {reportes.slice(0, 300).map(a => { const p = partById.get(a.partida_id); const evs = eviPorAvance.get(a.id) || []; return (
                  <tr key={a.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{a.fecha || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{nombreUsuario(a.responsable_id)}</td>
                    <td>{p ? <button className="lnk-partida" title="Ver en Insumos por Partida →" onClick={() => irAInsumosPartida(p)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--blue)', textAlign: 'left' }}><span style={{ fontFamily: 'monospace' }}>{p.codigo_delfin}</span> {p.nombre_partida} ›</button> : '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{num(a.metrado_ejecutado)} {p?.unidad || ''}</td>
                    <td style={{ maxWidth: 340, fontSize: 11, color: 'var(--ts)' }}>{a.descripcion || <span style={{ color: 'var(--tm)', fontStyle: 'italic' }}>—</span>}</td>
                    <td style={{ textAlign: 'center' }}>{evs.length > 0 ? <button className="btn btn-ghost btn-xs" onClick={() => setVerFotos(evs)}>📷 {evs.length}</button> : <span style={{ color: 'var(--tm)' }}>—</span>}</td>
                  </tr>
                ); })}
                {reportes.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>Sin reportes para el filtro elegido.</td></tr>}
              </tbody>
            </table>
            {reportes.length > 300 && <div style={{ padding: '6px 12px', fontSize: 11, color: 'var(--tm)' }}>Mostrando los 300 reportes más recientes. Afiná el filtro de fechas para ver más.</div>}
          </>
        )}
      </div>

      {verFotos && <EvidenciaViewer evidencias={verFotos} onClose={() => setVerFotos(null)} />}
    </div>
  );
}

// ─── Modal: reportar "día SIN avance de metrado" (motivo + foto) ──────────────
function SinAvanceModal({ fecha, hoy, misFrentes, busy, onConfirm, onClose }) {
  const [motivo, setMotivo] = uS('');
  const [frenteId, setFrenteId] = uS(misFrentes?.length === 1 ? misFrentes[0].id : '');
  const [fotos, setFotos] = uS([]);
  const MOTIVOS = ['Lluvia / clima', 'Falta de material', 'Falta de frente / interferencia', 'Paralización de la obra', 'Solo trabajos preliminares (sin metrado)'];
  const ok = motivo.trim().length >= 5 && fotos.length >= 1;
  return (
    <Modal title={`Sin avance · ${fecha}${fecha === hoy ? ' (hoy)' : ''}`} icon="alert" onClose={() => !busy && onClose()}>
      <div style={{ fontSize: 12, color: 'var(--tm)', marginBottom: 10 }}>
        Registrá por qué ese día no se avanzó metrado, con una foto del estado de la obra. Cuenta como reporte del día.
      </div>
      <label className="flabel">Motivo *</label>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 6 }}>
        {MOTIVOS.map(m => (
          <button key={m} className={`btn btn-xs ${motivo === m ? 'btn-amber' : 'btn-ghost'}`} style={{ fontSize: 10.5 }} onClick={() => setMotivo(m)}>{m}</button>
        ))}
      </div>
      <textarea className="fi" rows={2} value={motivo} onChange={e => setMotivo(e.target.value)}
        placeholder="Explicá el motivo (mínimo 5 caracteres)…" style={{ marginBottom: 10, resize: 'vertical', fontSize: 16 }} />
      {misFrentes?.length > 1 && (
        <div style={{ marginBottom: 10 }}>
          <label className="flabel">Frente (opcional)</label>
          <select className="fi" value={frenteId} onChange={e => setFrenteId(e.target.value)}>
            <option value="">— Todos mis frentes —</option>
            {misFrentes.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
          </select>
        </div>
      )}
      <label className="flabel">Foto del estado de la obra * (mín. 1, máx. 3)</label>
      <div style={{ marginBottom: 8 }}>
        <FotosField fotos={fotos} max={3}
          onAdd={files => setFotos(prev => [...prev, ...files].slice(0, 3))}
          onQuitar={i => setFotos(prev => prev.filter((_, j) => j !== i))} />
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn btn-amber" disabled={busy || !ok}
          title={ok ? undefined : 'Falta el motivo (≥5 caracteres) y al menos 1 foto'}
          onClick={() => onConfirm({ fecha, motivo, fotos, frenteId: frenteId || null })}>
          {busy ? 'Guardando…' : 'Reportar sin avance'}
        </button>
      </div>
    </Modal>
  );
}

const DashboardTecnicoPage = (p) => <MiFrenteShell {...p} vista="dashboard" />;
const MisPartidasPage = (p) => <MiFrenteShell {...p} vista="partidas" />;
const CronogramaFrentePage = (p) => <MiFrenteShell {...p} vista="cronograma" />;
const SalidasFrentePage = (p) => <MiFrenteShell {...p} vista="salidas" />;
const ReporteDiarioPage = (p) => <MiFrenteShell {...p} vista="reporte" />;
const PlanRealPage = (p) => <MiFrenteShell {...p} vista="plan" />;
const BorradoresPage = (p) => <MiFrenteShell {...p} vista="borradores" />;
const DetallePartidaPage = (p) => <MiFrenteShell {...p} vista="detalle" />;

Object.assign(window, { DashboardTecnicoPage, MisPartidasPage, CronogramaFrentePage, SalidasFrentePage, ReporteDiarioPage, PlanRealPage, BorradoresPage, DetallePartidaPage, MisReportesPage, EmitirAlertaPage, AprobacionesReportePage, RendimientoIngenierosPage, MiFrentePage: DashboardTecnicoPage });
