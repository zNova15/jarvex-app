// ═══════════════════════════════════════════════════════════════════
// JARVEX — INGENIERÍA DE FRENTE: 5 módulos independientes del ingeniero.
// DashboardTecnicoPage · MisPartidasPage · SalidasFrentePage ·
// ReporteDiarioPage · PlanRealPage. Comparten MiFrenteShell (datos + scope por
// frentesDeUsuario/partidasDeFrente). Sin información monetaria (solo metrados
// y cantidades). El semáforo de rendimiento sale de rendimientoPartida.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { frentesDeUsuario, partidasDeFrente, frentesDePartida } from "../lib/frente-partidas.js";
import { resumenFrente, planVsReal, rollupMensual, rendimientoPartida } from "../lib/mi-frente.js";
import { hijosDirectos, cadenaBreadcrumb } from "../lib/partida-arbol.js";
import { hoyLocal } from "../lib/fecha.js";
import { colorIngeniero, segmentarAvance } from "../lib/color-ingeniero.js";

const { useState: uS, useMemo: uM, useEffect: uE, useRef: uR } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);
const hoyISO = () => hoyLocal();
const num = (x) => Number(x || 0).toLocaleString('es-PE');
const SEM = { verde: 'var(--green)', ambar: 'var(--amber)', rojo: 'var(--red)', sin_dato: 'var(--tm)' };
const SEM_LBL = { verde: 'En ritmo', ambar: 'Atención', rojo: 'Atrasado', sin_dato: 's/plan' };

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
  const [repLineas, setRepLineas] = uS([]);   // [{partida_id, descripcion, metrado, fotos:[File]}]
  const [addPartQuery, setAddPartQuery] = uS('');   // buscador de partidas a agregar
  const [busyRep, setBusyRep] = uS(false);
  const [repTodas, setRepTodas] = uS(false);   // alcance del buscador del reporte (mis partidas vs todas) — local al reporte
  const [repFecha, setRepFecha] = uS(hoy);     // día que se reporta (default hoy; permite días pasados con motivo)
  const [repMotivoTardio, setRepMotivoTardio] = uS('');
  const MAX_FOTOS = 5;
  // Candidatas a reportar: todas las partidas o solo las de mis frentes (toggle propio del reporte).
  const partidasReporteBase = uM(() => {
    if (repTodas) return allPartidas;
    const m = new Map();
    for (const f of misFrentes) for (const p of partidasDeFrente(f.id, { frentePartidas: frentePartidas || [], partidas: partidas || [] })) m.set(p.id, p);
    return [...m.values()];
  }, [repTodas, allPartidas, misFrentes, frentePartidas, partidas]);
  // Solo partidas específicas (hojas, no capítulos).
  const hojasReporte = uM(() => {
    const folders = new Set();
    for (const p of partidasReporteBase) { const segs = String(p.codigo_delfin || '').split('.').filter(Boolean); for (let i = 1; i < segs.length; i++) folders.add(segs.slice(0, i).join('.')); }
    return partidasReporteBase.filter(p => !folders.has(String(p.codigo_delfin || '')));
  }, [partidasReporteBase]);
  // Borrador por USUARIO + DÍA reportado (no por-frente).
  const draftKey = obraId && userId ? `jx_repdraft_${obraId}_${userId}_${repFecha}` : '';
  const [hayBorrador, setHayBorrador] = uS(false);
  uE(() => { if (!draftKey) { setHayBorrador(false); return; } try { setHayBorrador(!!localStorage.getItem(draftKey)); } catch { setHayBorrador(false); } }, [draftKey]);
  const agregarLinea = (pid) => { if (!pid) return; setRepLineas(prev => prev.some(l => l.partida_id === pid) ? prev : [...prev, { partida_id: pid, descripcion: '', metrado: '', fotos: [] }]); setAddPartQuery(''); };
  const quitarLinea = (pid) => setRepLineas(prev => prev.filter(l => l.partida_id !== pid));
  const setLinea = (pid, campo, val) => setRepLineas(prev => prev.map(l => l.partida_id === pid ? { ...l, [campo]: val } : l));
  const agregarFotos = (pid, files) => setRepLineas(prev => prev.map(l => l.partida_id === pid ? { ...l, fotos: [...(l.fotos || []), ...files].slice(0, MAX_FOTOS) } : l));
  const quitarFoto = (pid, idx) => setRepLineas(prev => prev.map(l => l.partida_id === pid ? { ...l, fotos: (l.fotos || []).filter((_, j) => j !== idx) } : l));
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
  const guardarBorrador = () => {
    if (!draftKey) return;
    try { localStorage.setItem(draftKey, JSON.stringify(repLineas.map(({ fotos, ...l }) => l))); setHayBorrador(true); showToast('Borrador guardado (las fotos se vuelven a adjuntar al terminar)', 'amber'); }
    catch { showToast('No se pudo guardar el borrador', 'red'); }
  };
  const cargarBorrador = (keyOverride) => { const k = keyOverride || draftKey; try { const d = JSON.parse(localStorage.getItem(k) || '[]'); if (Array.isArray(d)) setRepLineas(d.map(l => ({ partida_id: l.partida_id, descripcion: l.descripcion || '', metrado: l.metrado ?? '', fotos: [] }))); } catch {} };
  const descartarBorrador = () => { try { localStorage.removeItem(draftKey); } catch {} setHayBorrador(false); };
  const [draftTick, setDraftTick] = uS(0);   // fuerza recálculo de la lista de Borradores tras eliminar
  const guardarReporte = async () => {
    const lineas = repLineas.filter(l => l.partida_id && (l.metrado !== '' || (l.descripcion || '').trim() || (l.fotos && l.fotos.length)));
    if (!lineas.length) { showToast('Agregá al menos una partida con avance', 'red'); return; }
    const esTardio = repFecha !== hoy;
    if (esTardio && !repMotivoTardio.trim()) { showToast('Indicá el motivo por el que subís el reporte de otro día', 'red'); return; }
    setBusyRep(true);
    try {
      for (const l of lineas) {
        const ac = calcAcum(l.partida_id, l.metrado);
        const id = window.__newId();
        const desc = esTardio
          ? `[Reporte tardío subido ${hoy} · motivo: ${repMotivoTardio.trim()}]${l.descripcion ? ' ' + l.descripcion : ''}`
          : (l.descripcion || null);
        await avanceHook.create({
          id, obra_id: obraId, partida_id: l.partida_id, frente_id: frenteDePartida(l.partida_id), fecha: repFecha,
          porcentaje_avance_reportado: ac && ac.pct != null ? Math.round(ac.pct * 10) / 10 : null,
          metrado_ejecutado: l.metrado !== '' ? Number(l.metrado) : null,
          descripcion: desc, responsable_id: userId,
        });
        if (ac && ac.pct != null && partidasHook.update) { try { await partidasHook.update(l.partida_id, { porcentaje_avance: Math.round(ac.pct * 10) / 10 }); } catch {} }
        for (const f of (l.fotos || []).slice(0, MAX_FOTOS)) {
          try {
            await window.__saveEvidenciaLocal({
              id: window.__newId(), obra_id: obraId, tipo_evidencia: 'foto_avance', modulo_relacionado: 'avance_obra',
              registro_relacionado_id: id, nombre_archivo: f.name, mime_type: f.type || 'image/jpeg',
              blob: f, fecha: repFecha, created_by: userId, observaciones: 'Foto de avance diario',
            });
          } catch (e) { console.warn('[mi-frente foto]', e?.message); }
        }
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'avance_obra' } })); } catch {}
      showToast(`Reporte guardado · ${lineas.length} partida(s)`, 'green');
      setRepLineas([]); descartarBorrador(); setRepMotivoTardio('');
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
    finally { setBusyRep(false); }
  };

  // (El reporte ya no es por-frente ni requiere aprobación: el ingeniero arma un único
  //  reporte del día con partidas de cualquier frente o sin frente; los avances acumulan
  //  y se trazan por color de ingeniero. La aprobación admin/gerente se reserva para crear
  //  un frente desde una partida huérfana. El editor NO se limpia al cambiar de alcance.)

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
      if (p) setRepLineas(prev => prev.some(l => l.partida_id === p.id) ? prev : [...prev, { partida_id: p.id, descripcion: '', metrado: '', fotos: [] }]);
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
  const [vincSel, setVincSel] = uS({});         // {movId: textoCódigo}
  const [tabSalidas, setTabSalidas] = uS('mis'); // 'mis' | 'generales'
  const [filtroDiaSal, setFiltroDiaSal] = uS('');
  const [filtroPartSal, setFiltroPartSal] = uS('');
  const misFrentesIds = uM(() => new Set(misFrentes.map(f => f.id)), [misFrentes]);
  const salidasMisFrentes = uM(() => (movs || []).filter(m => !m.deleted_at && m.tipo_movimiento === 'salida' && m.frente_id && misFrentesIds.has(m.frente_id)).sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || ''))), [movs, misFrentesIds]);
  const salidasGenerales = uM(() => (movs || []).filter(m => !m.deleted_at && m.tipo_movimiento === 'salida').sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || ''))), [movs]);
  const partidaPorCodigo = uM(() => { const m = new Map(); allPartidas.forEach(p => { if (p.codigo_delfin) m.set(String(p.codigo_delfin).trim(), p.id); }); return m; }, [allPartidas]);
  const vincularSalida = async (m, pid) => {
    if (!pid) { showToast('Elegí una partida', 'red'); return; }
    try {
      await movHook.update(m.id, { partida_id: pid });
      try {
        const { aplicarConsumoPartida } = await import('../lib/partida-allocation.js');
        const material = materialesById.get(m.material_id);
        await aplicarConsumoPartida({ mov: { ...m, partida_id: pid }, partida_id: pid, material, userId });
      } catch (e) { console.warn('[vincular salida]', e?.message); }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'movimientos_materiales' } })); } catch {}
      setVincSel(prev => { const n = { ...prev }; delete n[m.id]; return n; });
      showToast('Salida vinculada a la partida', 'green');
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

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

  const TITULOS = { dashboard: 'Dashboard Técnico', partidas: 'Partidas del Proyecto', cronograma: 'Cronograma de mis Partidas', salidas: 'Vinculación de insumos', reporte: 'Reporte Diario', plan: 'Plan vs Real', borradores: 'Borradores' };

  const SemBadge = ({ s }) => <span className="badge" style={{ background: SEM[s], color: '#000', fontSize: 9 }}>{SEM_LBL[s]}</span>;

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
    const q = addPartQuery.trim().toLowerCase();
    const sugeridas = (q
      ? hojasReporte.filter(p => String(p.codigo_delfin || '').toLowerCase().includes(q) || String(p.nombre_partida || '').toLowerCase().includes(q))
      : hojasReporte
    ).filter(p => !yaIds.has(p.id)).slice(0, 25);
    return (
      <>
        <div className="card card-p">
          <div className="frow-sb" style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Partidas avanzadas · {repFecha}{repFecha !== hoy ? ' (otro día)' : ''}</div>
            <span style={{ fontSize: 11, color: 'var(--tm)' }}>{repLineas.length} partida(s)</span>
          </div>
          <input className="fi" placeholder={repTodas ? 'Buscar cualquier partida por código o nombre…' : 'Buscar una partida de tus frentes…'} value={addPartQuery} onChange={e => setAddPartQuery(e.target.value)} />
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
          return (
            <div key={l.partida_id} className="card card-p">
              <div className="frow-sb" style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}><span style={{ fontFamily: 'monospace', color: 'var(--tm)' }}>{p?.codigo_delfin}</span> {p?.nombre_partida || '—'}</div>
                <button className="btn btn-ghost btn-xs" onClick={() => quitarLinea(l.partida_id)}>✕ Quitar</button>
              </div>
              <label className="flabel">Descripción del avance</label>
              <textarea className="fi" rows={2} value={l.descripcion} onChange={e => setLinea(l.partida_id, 'descripcion', e.target.value)} placeholder="Qué se avanzó en esta partida…" />
              <div className="g2" style={{ marginTop: 8 }}>
                <div><label className="flabel">Metrado avanzado ({p?.unidad || 'und'})</label><input className="fi" type="number" step="0.01" value={l.metrado} onChange={e => setLinea(l.partida_id, 'metrado', e.target.value)} /></div>
                <div>
                  <label className="flabel">Fotos (hasta {MAX_FOTOS})</label>
                  <input className="fi" type="file" accept="image/*" multiple disabled={(l.fotos || []).length >= MAX_FOTOS} onChange={e => { agregarFotos(l.partida_id, Array.from(e.target.files || [])); e.target.value = ''; }} />
                  {(l.fotos || []).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                      {l.fotos.map((f, i) => (
                        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, background: 'rgba(255,255,255,0.06)', borderRadius: 4, padding: '2px 6px' }}>
                          📷 {(f.name || 'foto').slice(0, 14)}
                          <button onClick={() => quitarFoto(l.partida_id, i)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', padding: 0 }}>✕</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ marginTop: 8, padding: '7px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', fontSize: 11.5 }}>
                {ac && ac.pct != null ? (
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span>Avance acumulado: <strong>{pctPrev}%</strong> → <strong style={{ color: 'var(--amber)' }}>{Math.round(ac.pct * 10) / 10}%</strong></span>
                    <span style={{ color: 'var(--tm)' }}>real {num(ac.real)} / {num(ac.mc)} {p?.unidad || ''} · te falta {num(ac.falta)} {p?.unidad || ''}</span>
                  </div>
                ) : <span style={{ color: 'var(--tm)' }}>Esta partida no tiene metrado contratado: no se puede calcular el % automáticamente.</span>}
              </div>
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
      const ins = p ? (insumosPorPartida.get(p.id) || []) : [];
      const puedeExpandir = nodo.esFolder || ins.length > 0;
      filas.push(
        <tr key={nodo.code} onContextMenu={p ? (e) => openCtx(e, p) : undefined}
          style={{ background: esCap ? 'rgba(245,180,40,0.06)' : (esHoja ? 'rgba(46,204,113,0.04)' : 'transparent'), cursor: p ? 'context-menu' : 'default', borderLeft: esHoja ? '3px solid rgba(46,204,113,0.5)' : (esCap ? '3px solid rgba(245,180,40,0.5)' : '3px solid transparent') }}>
          <td style={{ paddingLeft: 6 + depth * 16, whiteSpace: 'nowrap' }}>
            {puedeExpandir
              ? <button className="btn btn-ghost btn-xs" onClick={() => toggleExp(nodo.code)} style={{ padding: '0 4px', color: esCap ? 'var(--amber)' : 'var(--green)' }}>{open ? '▾' : '▸'}</button>
              : <span style={{ display: 'inline-block', width: 18 }} />}
            <span style={{ fontFamily: 'monospace', fontSize: 11.5, color: esCap ? 'var(--amber)' : (esHoja ? 'var(--green)' : 'var(--tx)'), fontWeight: esCap ? 700 : 500 }}>{esCap ? '📁 ' : '• '}{nodo.code}</span>
          </td>
          <td style={{ fontWeight: esCap ? 600 : 400 }}>{p ? <>{p.nombre_partida || '—'}{mostrarFrente && (() => { const fs = frentesNombresDe(p.id); return fs.length ? <span className="badge b-amber" style={{ marginLeft: 6, fontSize: 9 }} title="Frente(s)">{fs.join(', ')}</span> : <span className="badge b-red" style={{ marginLeft: 6, fontSize: 9 }} title="No pertenece a ningún frente">sin frente</span>; })()}</> : <span style={{ color: 'var(--tm)', fontStyle: 'italic' }}>capítulo</span>}</td>
          <td style={{ textAlign: 'right' }}>{p ? `${num(p.metrado_contratado)} ${p.unidad || ''}` : ''}</td>
          <td>{p ? <BarraAvance partida={p} avancesPartida={avancesPorPartida.get(p.id)} nombreUsuario={nombreUsuario} /> : ''}</td>
          <td>{r ? <SemBadge s={r.semaforo} /> : ''}</td>
          <td style={{ textAlign: 'right' }}>{p && <button className="btn btn-ghost btn-xs" onClick={() => generarReporteDe(p)}>Reportar</button>}</td>
        </tr>
      );
      if (open) {
        if (nodo.esFolder) filas.push(...renderNodos(nodo.code, depth + 1, parts, mostrarFrente));
        if (ins.length) {
          filas.push(
            <tr key={nodo.code + '_ins'} style={{ background: 'rgba(46,204,113,0.05)' }}>
              <td></td>
              <td colSpan={5} style={{ paddingLeft: 6 + (depth + 1) * 16 }}>
                <div style={{ fontSize: 10.5, color: 'var(--green)', margin: '2px 0', fontWeight: 600 }}>🔧 Insumos a utilizar ({ins.length}):</div>
                <table style={{ width: '100%', fontSize: 11 }}><tbody>
                  {ins.map(i => (
                    <tr key={i.id}>
                      <td style={{ width: 110 }}><span className="badge" style={{ background: TIPO_COLOR[String(i.tipo_insumo || '').toLowerCase()] || 'var(--tm)', color: '#000', fontSize: 9 }}>{i.tipo_insumo}</span></td>
                      <td>{i.nombre_insumo}</td>
                      <td style={{ textAlign: 'right', width: 130, fontWeight: 600 }}>{num(i.cantidad_presupuestada)} {i.unidad || ''}</td>
                    </tr>
                  ))}
                </tbody></table>
              </td>
            </tr>
          );
        }
      }
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
                <thead><tr><th>Código</th><th>Partida</th><th style={{ textAlign: 'right' }}>Metrado</th><th>Avance (por ingeniero)</th><th>Rendimiento</th><th></th></tr></thead>
                <tbody>
                  {filtradas ? filtradas.flatMap(p => {
                    const r = rendimientoPartida(p, avances || [], hoy);
                    const ins = insumosPorPartida.get(p.id) || [];
                    const open = expandidos.has(p.codigo_delfin);
                    const rows = [
                      <tr key={p.id} onContextMenu={(e) => openCtx(e, p)} style={{ cursor: 'context-menu', background: 'rgba(46,204,113,0.04)', borderLeft: '3px solid rgba(46,204,113,0.5)' }}>
                        <td style={{ whiteSpace: 'nowrap' }}>{ins.length ? <button className="btn btn-ghost btn-xs" onClick={() => toggleExp(p.codigo_delfin)} style={{ padding: '0 4px', color: 'var(--green)' }}>{open ? '▾' : '▸'}</button> : <span style={{ display: 'inline-block', width: 18 }} />}<span style={{ fontFamily: 'monospace', fontSize: 11.5, color: 'var(--green)', fontWeight: 500 }}>• {p.codigo_delfin}</span></td>
                        <td>{p.nombre_partida || '—'}{mostrarFrente && (() => { const fs = frentesNombresDe(p.id); return fs.length ? <span className="badge b-amber" style={{ marginLeft: 6, fontSize: 9 }}>{fs.join(', ')}</span> : <span className="badge b-red" style={{ marginLeft: 6, fontSize: 9 }}>sin frente</span>; })()}</td>
                        <td style={{ textAlign: 'right' }}>{num(p.metrado_contratado)} {p.unidad || ''}</td>
                        <td><BarraAvance partida={p} avancesPartida={avancesPorPartida.get(p.id)} nombreUsuario={nombreUsuario} /></td>
                        <td><SemBadge s={r.semaforo} /></td>
                        <td style={{ textAlign: 'right' }}><button className="btn btn-ghost btn-xs" onClick={() => generarReporteDe(p)}>Reportar</button></td>
                      </tr>,
                    ];
                    if (open && ins.length) rows.push(<tr key={p.id + '_ins'} style={{ background: 'rgba(46,204,113,0.05)' }}><td></td><td colSpan={5}><div style={{ fontSize: 10.5, color: 'var(--green)', margin: '2px 0', fontWeight: 600 }}>🔧 Insumos a utilizar ({ins.length}):</div><table style={{ width: '100%', fontSize: 11 }}><tbody>{ins.map(i => <tr key={i.id}><td style={{ width: 110 }}><span className="badge" style={{ background: TIPO_COLOR[String(i.tipo_insumo || '').toLowerCase()] || 'var(--tm)', color: '#000', fontSize: 9 }}>{i.tipo_insumo}</span></td><td>{i.nombre_insumo}</td><td style={{ textAlign: 'right', width: 130, fontWeight: 600 }}>{num(i.cantidad_presupuestada)} {i.unidad || ''}</td></tr>)}</tbody></table></td></tr>);
                    return rows;
                  }) : renderNodos('', 0, parts, mostrarFrente)}
                  {parts.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>{partidasTab === 'mias' ? 'No tenés partidas asignadas a tus frentes.' : 'No hay otras partidas en este alcance.'}</td></tr>}
                  {filtradas && filtradas.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>Ninguna partida coincide con “{filtroPart}”.</td></tr>}
                </tbody>
              </table>
            </div>
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
                    const pct = Math.max(0, Math.min(100, Number(p.porcentaje_avance) || 0));
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
        const base = tabSalidas === 'mis' ? salidasMisFrentes : salidasGenerales;
        const q = filtroPartSal.trim().toLowerCase();
        const lista = base.filter(m => {
          if (filtroDiaSal && m.fecha !== filtroDiaSal) return false;
          if (tabSalidas === 'generales' && q) {
            const p = partByIdAll.get(m.partida_id);
            const matName = (materialesById.get(m.material_id)?.nombre_material || '').toLowerCase();
            const pc = (p ? `${p.codigo_delfin} ${p.nombre_partida}` : '').toLowerCase();
            if (!pc.includes(q) && !matName.includes(q)) return false;
          }
          return true;
        });
        const colSpan = tabSalidas === 'generales' ? 7 : 6;
        return (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className={`btn btn-sm ${tabSalidas === 'mis' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTabSalidas('mis')}>Insumos a mis Frentes</button>
                <button className={`btn btn-sm ${tabSalidas === 'generales' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTabSalidas('generales')}>Insumos generales</button>
              </div>
              <input className="fi" type="date" style={{ maxWidth: 160 }} value={filtroDiaSal} onChange={e => setFiltroDiaSal(e.target.value)} title="Filtrar por día" />
              {filtroDiaSal && <button className="btn btn-ghost btn-xs" onClick={() => setFiltroDiaSal('')}>✕ día</button>}
              {tabSalidas === 'generales' && <input className="fi" style={{ maxWidth: 240 }} placeholder="Filtrar por partida o material…" value={filtroPartSal} onChange={e => setFiltroPartSal(e.target.value)} />}
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--tm)' }}>{lista.length} salida(s)</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--tm)' }}>
              {tabSalidas === 'mis'
                ? 'Salidas de almacén registradas a tus frentes. Vinculá cada una a la partida en la que se usó.'
                : 'Todas las salidas de la obra. Si un insumo salió a otro frente pero lo usaste en tu partida (incluso una sin frente), vinculalo acá.'}
            </div>
            <div className="card" style={{ overflow: 'auto' }}>
              <datalist id="jx-vinc-partidas">{hojasReporte.slice(0, 2000).map(p => <option key={p.id} value={p.codigo_delfin}>{p.nombre_partida}</option>)}</datalist>
              <table className="tbl" style={{ fontSize: 12 }}>
                <thead><tr><th>Fecha</th><th>Material</th><th style={{ textAlign: 'right' }}>Cantidad</th><th>Responsable</th>{tabSalidas === 'generales' && <th>Frente</th>}<th>Partida</th><th>Vincular a partida</th></tr></thead>
                <tbody>
                  {lista.map(m => {
                    const yaVinc = m.partida_id;
                    const pv = yaVinc ? partByIdAll.get(m.partida_id) : null;
                    return (
                      <tr key={m.id}>
                        <td>{m.fecha || '—'}</td>
                        <td>{materialesById.get(m.material_id)?.nombre_material || '—'}</td>
                        <td style={{ textAlign: 'right' }}>{num(m.cantidad)} {m.unidad || ''}</td>
                        <td>{(() => { const p = personalById.get(m.responsable_id); return p ? `${p.nombres} ${p.apellidos || ''}`.trim() : '—'; })()}</td>
                        {tabSalidas === 'generales' && <td>{m.frente_id ? <span className="badge b-amber" style={{ fontSize: 9 }}>{fNomById.get(m.frente_id) || 'frente'}</span> : <span style={{ color: 'var(--tm)' }}>—</span>}</td>}
                        <td>{yaVinc ? <span className="badge b-green" style={{ fontSize: 9 }} title={pv ? `${pv.codigo_delfin} · ${pv.nombre_partida}` : ''}>{pv ? pv.codigo_delfin : '✓'}</span> : <span style={{ color: 'var(--tm)' }}>—</span>}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <input list="jx-vinc-partidas" className="fi" style={{ display: 'inline-block', width: 120, fontSize: 11 }} placeholder="código…" value={vincSel[m.id] || ''} onChange={e => setVincSel({ ...vincSel, [m.id]: e.target.value })} />
                          <button className="btn btn-amber btn-xs" style={{ marginLeft: 4 }} onClick={() => { const pid = partidaPorCodigo.get((vincSel[m.id] || '').trim()); if (!pid) { showToast('Escribí un código de partida válido', 'red'); return; } vincularSalida(m, pid); }}>{yaVinc ? 'Re-vincular' : 'Vincular'}</button>
                        </td>
                      </tr>
                    );
                  })}
                  {lista.length === 0 && <tr><td colSpan={colSpan} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>No hay salidas{filtroDiaSal ? ` del ${filtroDiaSal}` : ''}{q ? ' que coincidan' : ''}.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {vista === 'reporte' && (
        <div style={{ display: 'grid', gap: 12, maxWidth: 700 }}>
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
            </div>
            {repFecha !== hoy && (
              <div style={{ marginTop: 10 }}>
                <label className="flabel" style={{ color: 'var(--amber)' }}>Motivo del reporte de otro día * (¿por qué no lo subiste ese día?)</label>
                <input className="fi" value={repMotivoTardio} onChange={e => setRepMotivoTardio(e.target.value)} placeholder="Ej. no tuve señal en obra / olvidé subirlo…" />
              </div>
            )}
          </div>
          {hayBorrador && repLineas.length === 0 && (
            <div className="card card-p" style={{ background: 'rgba(245,180,40,0.08)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--amber)', display: 'inline-block' }} />
              <span style={{ fontSize: 12.5 }}>Tenés un borrador del {repFecha} sin terminar.</span>
              <button className="btn btn-amber btn-xs" onClick={() => cargarBorrador()}>Cargar borrador</button>
              <button className="btn btn-ghost btn-xs" onClick={descartarBorrador}>Descartar</button>
            </div>
          )}
          {editorLineas(true)}
          {repLineas.length > 0 && (
            <div className="modal-actions" style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-amber" disabled={busyRep} onClick={guardarReporte}><JxIcon name="check" size={13} />Guardar reporte</button>
              <button className="btn btn-ghost" disabled={busyRep} onClick={guardarBorrador}>Guardar como borrador</button>
            </div>
          )}
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
        const eliminar = (it) => { try { localStorage.removeItem(it.key); } catch {} if (it.key === draftKey) setHayBorrador(false); setDraftTick(t => t + 1); };
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
          <button style={ctxBtn} onClick={() => { generarReporteDe(ctx.partida); setCtx(null); }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>📝 Generar reporte diario de esta partida</button>
          {frentesNombresDe(ctx.partida.id).length === 0 && (
            <button style={{ ...ctxBtn, borderTop: '1px solid var(--bd)' }} onClick={() => { solicitarFrente(ctx.partida); setCtx(null); }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>🏗️ {solFrentePend(ctx.partida.id) ? 'Frente solicitado (pendiente)' : 'Solicitar crear frente para esta partida'}</button>
          )}
        </div>
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

const DashboardTecnicoPage = (p) => <MiFrenteShell {...p} vista="dashboard" />;
const MisPartidasPage = (p) => <MiFrenteShell {...p} vista="partidas" />;
const CronogramaFrentePage = (p) => <MiFrenteShell {...p} vista="cronograma" />;
const SalidasFrentePage = (p) => <MiFrenteShell {...p} vista="salidas" />;
const ReporteDiarioPage = (p) => <MiFrenteShell {...p} vista="reporte" />;
const PlanRealPage = (p) => <MiFrenteShell {...p} vista="plan" />;
const BorradoresPage = (p) => <MiFrenteShell {...p} vista="borradores" />;

Object.assign(window, { DashboardTecnicoPage, MisPartidasPage, CronogramaFrentePage, SalidasFrentePage, ReporteDiarioPage, PlanRealPage, BorradoresPage, EmitirAlertaPage, AprobacionesReportePage, MiFrentePage: DashboardTecnicoPage });
