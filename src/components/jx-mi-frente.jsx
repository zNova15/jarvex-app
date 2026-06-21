// ═══════════════════════════════════════════════════════════════════
// JARVEX — INGENIERÍA DE FRENTE: 5 módulos independientes del ingeniero.
// DashboardTecnicoPage · MisPartidasPage · SalidasFrentePage ·
// ReporteDiarioPage · PlanRealPage. Comparten MiFrenteShell (datos + scope por
// frentesDeUsuario/partidasDeFrente). Sin información monetaria (solo metrados
// y cantidades). El semáforo de rendimiento sale de rendimientoPartida.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { frentesDeUsuario, partidasDeFrente } from "../lib/frente-partidas.js";
import { resumenFrente, planVsReal, rollupMensual, rendimientoPartida } from "../lib/mi-frente.js";
import { hijosDirectos, cadenaBreadcrumb } from "../lib/partida-arbol.js";
import { solicitudActiva, solicitudesPendientes, construirAvancesDeSolicitud, solEstadoInfo } from "../lib/solicitudes-reporte.js";
import { getEvidenciaSrc } from "../lib/evidencias-url.js";
import { hoyLocal } from "../lib/fecha.js";

const { useState: uS, useMemo: uM, useEffect: uE, useRef: uR } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);
const hoyISO = () => hoyLocal();
const num = (x) => Number(x || 0).toLocaleString('es-PE');
const SEM = { verde: 'var(--green)', ambar: 'var(--amber)', rojo: 'var(--red)', sin_dato: 'var(--tm)' };
const SEM_LBL = { verde: 'En ritmo', ambar: 'Atención', rojo: 'Atrasado', sin_dato: 's/plan' };

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

  const solHook = window.__hooks.useSolicitudesReporte(obraId);
  const { data: solicitudes } = solHook;

  const misFrentes = uM(() => frentesDeUsuario(userId, { frentes: frentes || [] }), [userId, frentes]);
  // Ver otros frentes activos (solo lectura, salvo reporte con permiso aprobado).
  const [verOtros, setVerOtros] = uS(false);
  const frentesVisibles = uM(() => verOtros ? (frentes || []).filter(f => !f.deleted_at) : misFrentes, [verOtros, frentes, misFrentes]);
  const [frenteSelId, setFrenteSelId] = uS(null);
  const frenteActivo = uM(() => frentesVisibles.find(f => f.id === frenteSelId) || misFrentes[0] || frentesVisibles[0] || null, [frentesVisibles, frenteSelId, misFrentes]);
  const esMiFrente = uM(() => !!frenteActivo && misFrentes.some(f => f.id === frenteActivo.id), [frenteActivo, misFrentes]);
  const partidasDelFrente = uM(() => frenteActivo
    ? partidasDeFrente(frenteActivo.id, { frentePartidas: frentePartidas || [], partidas: partidas || [] })
    : [], [frenteActivo, frentePartidas, partidas]);

  const resumen = uM(() => frenteActivo
    ? resumenFrente({ partidasDelFrente, movimientos: movs || [], avances: avances || [], frenteId: frenteActivo.id })
    : { nPartidas: 0, avancePromedio: 0, nSalidas: 0, metradoReal: 0 }, [frenteActivo, partidasDelFrente, movs, avances]);

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
  // Todos los códigos "carpeta" (con descendientes) → para expandir todo de inicio.
  const foldersTodos = uM(() => {
    const s = new Set();
    for (const p of partidasDelFrente) { const segs = String(p.codigo_delfin || '').split('.').filter(Boolean); for (let i = 1; i < segs.length; i++) s.add(segs.slice(0, i).join('.')); }
    return s;
  }, [partidasDelFrente]);
  const autoExpRef = uR(false);
  uE(() => { if (!autoExpRef.current && partidasDelFrente.length) { autoExpRef.current = true; setExpandidos(new Set(foldersTodos)); } }, [partidasDelFrente, foldersTodos]);
  const partidasFiltradas = uM(() => {
    const q = filtroPart.trim().toLowerCase();
    if (!q) return null;
    return partidasDelFrente.filter(p => String(p.codigo_delfin || '').toLowerCase().includes(q) || String(p.nombre_partida || '').toLowerCase().includes(q));
  }, [partidasDelFrente, filtroPart]);
  // Gantt: orden + filtro.
  const [ganttSort, setGanttSort] = uS('fecha');   // 'fecha' | 'codigo' | 'rendimiento'
  const [ganttFiltro, setGanttFiltro] = uS('');

  // ── Reporte diario (multi-partida + % automático + borradores) ────
  const [repLineas, setRepLineas] = uS([]);   // [{partida_id, descripcion, metrado, foto}]
  const [addPartSel, setAddPartSel] = uS('');
  const [busyRep, setBusyRep] = uS(false);
  const draftKey = obraId && frenteActivo ? `jx_repdraft_${obraId}_${frenteActivo.id}_${hoy}` : '';
  const [hayBorrador, setHayBorrador] = uS(false);
  uE(() => { if (!draftKey) { setHayBorrador(false); return; } try { setHayBorrador(!!localStorage.getItem(draftKey)); } catch { setHayBorrador(false); } }, [draftKey]);
  const agregarLinea = (pid) => { if (!pid) return; setRepLineas(prev => prev.some(l => l.partida_id === pid) ? prev : [...prev, { partida_id: pid, descripcion: '', metrado: '', foto: null }]); setAddPartSel(''); };
  const quitarLinea = (pid) => setRepLineas(prev => prev.filter(l => l.partida_id !== pid));
  const setLinea = (pid, campo, val) => setRepLineas(prev => prev.map(l => l.partida_id === pid ? { ...l, [campo]: val } : l));
  // % acumulado calculado solo desde el metrado real (no editable por el ingeniero).
  const calcAcum = (pid, metradoHoy) => {
    const p = partById.get(pid); if (!p) return null;
    const mc = Number(p.metrado_contratado) || 0;
    const r = rendimientoPartida(p, avances || [], hoy);
    const real = (r.realAcum || 0) + (Number(metradoHoy) || 0);
    if (mc <= 0) return { mc: 0, real, pct: null, falta: null };
    const pct = Math.max(0, Math.min(100, (real / mc) * 100));
    return { mc, real, pct, falta: Math.max(0, mc - real) };
  };
  const guardarBorrador = () => {
    if (!draftKey) return;
    try { localStorage.setItem(draftKey, JSON.stringify(repLineas.map(({ foto, ...l }) => l))); setHayBorrador(true); showToast('Borrador guardado (las fotos se vuelven a adjuntar al terminar)', 'amber'); }
    catch { showToast('No se pudo guardar el borrador', 'red'); }
  };
  const cargarBorrador = (keyOverride) => { const k = keyOverride || draftKey; try { const d = JSON.parse(localStorage.getItem(k) || '[]'); if (Array.isArray(d)) setRepLineas(d.map(l => ({ partida_id: l.partida_id, descripcion: l.descripcion || '', metrado: l.metrado ?? '', foto: null }))); } catch {} };
  const descartarBorrador = () => { try { localStorage.removeItem(draftKey); } catch {} setHayBorrador(false); };
  const [draftTick, setDraftTick] = uS(0);   // fuerza recálculo de la lista de Borradores tras eliminar
  const guardarReporte = async () => {
    if (!frenteActivo) return;
    const lineas = repLineas.filter(l => l.partida_id && (l.metrado !== '' || (l.descripcion || '').trim() || l.foto));
    if (!lineas.length) { showToast('Agregá al menos una partida con avance', 'red'); return; }
    setBusyRep(true);
    try {
      for (const l of lineas) {
        const ac = calcAcum(l.partida_id, l.metrado);
        const id = window.__newId();
        await avanceHook.create({
          id, obra_id: obraId, partida_id: l.partida_id, frente_id: frenteActivo.id, fecha: hoy,
          porcentaje_avance_reportado: ac && ac.pct != null ? Math.round(ac.pct * 10) / 10 : null,
          metrado_ejecutado: l.metrado !== '' ? Number(l.metrado) : null,
          descripcion: l.descripcion || null, responsable_id: userId,
        });
        if (ac && ac.pct != null && partidasHook.update) { try { await partidasHook.update(l.partida_id, { porcentaje_avance: Math.round(ac.pct * 10) / 10 }); } catch {} }
        if (l.foto) {
          try {
            await window.__saveEvidenciaLocal({
              id: window.__newId(), obra_id: obraId, tipo_evidencia: 'foto_avance', modulo_relacionado: 'avance_obra',
              registro_relacionado_id: id, nombre_archivo: l.foto.name, mime_type: l.foto.type || 'image/jpeg',
              blob: l.foto, fecha: hoy, created_by: userId, observaciones: 'Foto de avance diario',
            });
          } catch (e) { console.warn('[mi-frente foto]', e?.message); }
        }
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'avance_obra' } })); } catch {}
      showToast(`Reporte guardado · ${lineas.length} partida(s)`, 'green');
      setRepLineas([]); descartarBorrador();
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
    finally { setBusyRep(false); }
  };

  // ── Reporte de FRENTE AJENO (con permiso del admin/gerente) ───────
  const solActiva = uM(() => solicitudActiva(solicitudes || [], { frenteId: frenteActivo?.id, fecha: hoy, userId }),
    [solicitudes, frenteActivo, hoy, userId]);
  const [motivoSol, setMotivoSol] = uS('');
  const solicitarPermiso = async () => {
    if (!frenteActivo) return;
    if (!motivoSol.trim()) { showToast('Indicá el motivo (ej. ing. titular ausente)', 'red'); return; }
    try {
      await solHook.create({
        id: window.__newId(), obra_id: obraId, frente_id: frenteActivo.id, solicitante_user_id: userId,
        fecha: hoy, motivo: motivoSol.trim(), estado: 'solicitado', reporte_payload: null, created_by: userId,
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'solicitudes_reporte' } })); } catch {}
      showToast('Permiso solicitado al administrador/gerente', 'green'); setMotivoSol('');
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };
  const cancelarSolicitud = async () => {
    if (!solActiva) return;
    try { await solHook.remove(solActiva.id); try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'solicitudes_reporte' } })); } catch {} showToast('Solicitud cancelada', 'amber'); }
    catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };
  const enviarReporteAjeno = async () => {
    if (!frenteActivo) return;
    const lineas = repLineas.filter(l => l.partida_id && (l.metrado !== '' || (l.descripcion || '').trim() || l.foto));
    if (!lineas.length) { showToast('Agregá al menos una partida con avance', 'red'); return; }
    setBusyRep(true);
    try {
      const payload = lineas.map(l => ({ partida_id: l.partida_id, descripcion: l.descripcion || null, metrado: l.metrado !== '' ? Number(l.metrado) : null, tiene_foto: !!l.foto }));
      // Crear-o-actualizar la solicitud directamente como 'enviado' (el permiso previo es opcional).
      let solId = solActiva?.id;
      if (solId) {
        await solHook.update(solId, { estado: 'enviado', updated_by: userId, reporte_payload: payload, motivo: solActiva.motivo || motivoSol || null });
      } else {
        solId = window.__newId();
        await solHook.create({ id: solId, obra_id: obraId, frente_id: frenteActivo.id, solicitante_user_id: userId, fecha: hoy, motivo: motivoSol || null, estado: 'enviado', reporte_payload: payload, created_by: userId });
      }
      // Fotos como evidencia ligada a la SOLICITUD (el avance_obra todavía no existe; se crea al aceptar).
      for (const l of lineas) {
        if (!l.foto) continue;
        try {
          await window.__saveEvidenciaLocal({
            id: window.__newId(), obra_id: obraId, tipo_evidencia: 'foto_avance', modulo_relacionado: 'solicitudes_reporte',
            registro_relacionado_id: solId, nombre_archivo: l.foto.name, mime_type: l.foto.type || 'image/jpeg',
            blob: l.foto, fecha: hoy, created_by: userId,
            observaciones: `Foto avance frente ajeno · partida ${partById.get(l.partida_id)?.codigo_delfin || ''}`,
          });
        } catch (e) { console.warn('[ajeno foto]', e?.message); }
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'solicitudes_reporte' } })); } catch {}
      showToast('Reporte enviado — esperando aceptación del admin/gerente', 'green');
      setRepLineas([]); descartarBorrador(); setMotivoSol('');
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
    finally { setBusyRep(false); }
  };
  // Al cambiar de frente, limpiar el editor (no contaminar partidas entre frentes).
  const frenteRef = uR(null);
  uE(() => {
    const fid = frenteActivo?.id || null;
    if (frenteRef.current === fid) return;
    frenteRef.current = fid;
    setRepLineas([]); setFiltroPart(''); setAddPartSel('');
  }, [frenteActivo]);

  // ── Menú anti-click sobre partidas (árbol + Gantt) ────────────────
  const [ctx, setCtx] = uS(null);   // {x, y, partida}
  uE(() => { if (!ctx) return; const close = () => setCtx(null); window.addEventListener('click', close); window.addEventListener('scroll', close, true); return () => { window.removeEventListener('click', close); window.removeEventListener('scroll', close, true); }; }, [ctx]);
  // Intent cross-módulo: anti-click "ir al costo unitario" / "generar reporte" navega y aplica al montar.
  const intentRef = uR(null);
  uE(() => {
    const it = window.__miFrenteIntent;
    if (!it || intentRef.current === it.ts) return;
    // Si el frente objetivo no es el activo, cambiarlo (activando "ver otros" si es ajeno) y re-entrar.
    if (it.frenteId && frenteActivo && it.frenteId !== frenteActivo.id) {
      if (!misFrentes.some(f => f.id === it.frenteId)) setVerOtros(true);
      setFrenteSelId(it.frenteId); return;
    }
    if (it.tipo === 'borrador' && vista === 'reporte') {
      cargarBorrador(`jx_repdraft_${obraId}_${it.frenteId}_${it.fecha}`);
      intentRef.current = it.ts; window.__miFrenteIntent = null;
      return;
    }
    if (!partidasDelFrente.length) return;
    const p = partidasDelFrente.find(x => x.id === it.partidaId);
    if (it.tipo === 'costo' && vista === 'partidas') {
      if (p) { setFiltroPart(p.codigo_delfin || ''); setExpandidos(prev => new Set(prev).add(p.codigo_delfin)); }
      intentRef.current = it.ts; window.__miFrenteIntent = null;
    } else if (it.tipo === 'reporte' && vista === 'reporte') {
      if (p) setRepLineas(prev => prev.some(l => l.partida_id === p.id) ? prev : [...prev, { partida_id: p.id, descripcion: '', metrado: '', foto: null }]);
      intentRef.current = it.ts; window.__miFrenteIntent = null;
    }
  }, [vista, partidasDelFrente, frenteActivo]);

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

  // ── Salidas: vincular a partida ───────────────────────────────────
  const [vincSel, setVincSel] = uS({});
  const vincularSalida = async (m) => {
    const pid = vincSel[m.id];
    if (!pid) { showToast('Elegí una partida', 'red'); return; }
    try {
      await movHook.update(m.id, { partida_id: pid });
      try {
        const { aplicarConsumoPartida } = await import('../lib/partida-allocation.js');
        const material = materialesById.get(m.material_id);
        await aplicarConsumoPartida({ mov: { ...m, partida_id: pid }, partida_id: pid, material, userId });
      } catch (e) { console.warn('[vincular salida]', e?.message); }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'movimientos_materiales' } })); } catch {}
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
    const ini = Math.min(...ganttPartidas.map(p => new Date(p.fecha_inicio_planificada).getTime()));
    const fin = Math.max(...ganttPartidas.map(p => new Date(p.fecha_fin_planificada).getTime()));
    return { ini, fin, span: Math.max(1, fin - ini) };
  }, [ganttPartidas]);

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

  const TITULOS = { dashboard: 'Dashboard Técnico', partidas: 'Mis Partidas', cronograma: 'Cronograma de mis Partidas', salidas: 'Salidas a mi Frente', reporte: 'Reporte Diario', plan: 'Plan vs Real', borradores: 'Borradores' };

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
  const ctxBtn = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'none', border: 'none', color: 'var(--tx)', padding: '9px 11px', fontSize: 12.5, textAlign: 'left', cursor: 'pointer' };

  // Editor multi-partida reutilizado por el reporte propio (con foto) y el ajeno (sin foto).
  const editorLineas = (showFoto) => {
    const leaf = partidasDelFrente.filter(p => !hijosDirectos(partidasDelFrente, p.codigo_delfin).length);
    const yaIds = new Set(repLineas.map(l => l.partida_id));
    const disponibles = leaf.filter(p => !yaIds.has(p.id));
    return (
      <>
        <div className="card card-p">
          <div className="frow-sb" style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Partidas avanzadas · {hoy}</div>
            <span style={{ fontSize: 11, color: 'var(--tm)' }}>{repLineas.length} partida(s)</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="fi" style={{ maxWidth: 380 }} value={addPartSel} onChange={e => setAddPartSel(e.target.value)}>
              <option value="">— Agregar una partida que avanzaste hoy —</option>
              {disponibles.map(p => <option key={p.id} value={p.id}>{nombrePart(p)}</option>)}
            </select>
            <button className="btn btn-amber btn-sm" disabled={!addPartSel} onClick={() => agregarLinea(addPartSel)}>+ Agregar</button>
          </div>
          {repLineas.length === 0 && <div style={{ color: 'var(--tm)', fontStyle: 'italic', fontSize: 12, marginTop: 10 }}>Agregá las partidas que avanzaste hoy. Podés cargar varias en un mismo reporte; el % acumulado se calcula solo.</div>}
        </div>
        {repLineas.map(l => {
          const p = partById.get(l.partida_id);
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
              <div className={showFoto ? 'g2' : ''} style={{ marginTop: 8 }}>
                <div><label className="flabel">Metrado avanzado hoy ({p?.unidad || 'und'})</label><input className="fi" type="number" step="0.01" value={l.metrado} onChange={e => setLinea(l.partida_id, 'metrado', e.target.value)} /></div>
                {showFoto && <div><label className="flabel">Foto (evidencia)</label><input className="fi" type="file" accept="image/*" onChange={e => setLinea(l.partida_id, 'foto', e.target.files?.[0] || null)} /></div>}
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
  const renderNodos = (code, depth) => {
    const filas = [];
    for (const nodo of hijosDirectos(partidasDelFrente, code)) {
      const open = expandidos.has(nodo.code);
      const p = nodo.partida;
      const r = p ? rendimientoPartida(p, avances || [], hoy) : null;
      const ins = p ? (insumosPorPartida.get(p.id) || []) : [];
      const puedeExpandir = nodo.esFolder || ins.length > 0;
      filas.push(
        <tr key={nodo.code} onContextMenu={p ? (e) => openCtx(e, p) : undefined} style={p ? { cursor: 'context-menu' } : undefined}>
          <td style={{ paddingLeft: 6 + depth * 16, whiteSpace: 'nowrap' }}>
            {puedeExpandir
              ? <button className="btn btn-ghost btn-xs" onClick={() => toggleExp(nodo.code)} style={{ padding: '0 4px' }}>{open ? '▾' : '▸'}</button>
              : <span style={{ display: 'inline-block', width: 18 }} />}
            <span style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{nodo.code}</span>
          </td>
          <td>{p ? (p.nombre_partida || '—') : <span style={{ color: 'var(--tm)' }}>capítulo</span>}</td>
          <td style={{ textAlign: 'right' }}>{p ? `${num(p.metrado_contratado)} ${p.unidad || ''}` : ''}</td>
          <td style={{ textAlign: 'right' }}>{p ? `${Number(p.porcentaje_avance) || 0}%` : ''}</td>
          <td>{r ? <SemBadge s={r.semaforo} /> : ''}</td>
          <td style={{ textAlign: 'right' }}>{p && <button className="btn btn-ghost btn-xs" onClick={() => generarReporteDe(p)}>Reportar</button>}</td>
        </tr>
      );
      if (open) {
        if (nodo.esFolder) filas.push(...renderNodos(nodo.code, depth + 1));
        if (ins.length) {
          filas.push(
            <tr key={nodo.code + '_ins'} style={{ background: 'rgba(245,180,40,0.05)' }}>
              <td></td>
              <td colSpan={5} style={{ paddingLeft: 6 + (depth + 1) * 16 }}>
                <div style={{ fontSize: 10.5, color: 'var(--tm)', margin: '2px 0' }}>Insumos a utilizar:</div>
                <table style={{ width: '100%', fontSize: 11 }}><tbody>
                  {ins.map(i => (
                    <tr key={i.id}>
                      <td style={{ width: 96, color: 'var(--tm)' }}>{i.tipo_insumo}</td>
                      <td>{i.nombre_insumo}</td>
                      <td style={{ textAlign: 'right', width: 130 }}>{num(i.cantidad_presupuestada)} {i.unidad || ''}</td>
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
            {frenteActivo?.nombre || '—'} · {resumen.nPartidas} partidas · {Math.round(resumen.avancePromedio)}% avance prom.
            {!esMiFrente && frenteActivo && <span style={{ color: 'var(--amber)' }}> · frente ajeno (solo lectura)</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {frentesVisibles.length > 1 && (
            <select className="fi" style={{ maxWidth: 240 }} value={frenteActivo?.id || ''} onChange={e => setFrenteSelId(e.target.value)}>
              {frentesVisibles.map(f => <option key={f.id} value={f.id}>{f.nombre}{misFrentes.some(m => m.id === f.id) ? '' : ' · ajeno'}</option>)}
            </select>
          )}
          <label style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 5, color: 'var(--tm)', cursor: 'pointer' }}>
            <input type="checkbox" checked={verOtros} onChange={e => { setVerOtros(e.target.checked); if (!e.target.checked && !esMiFrente) setFrenteSelId(misFrentes[0]?.id || null); }} />
            Ver otros frentes
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

      {vista === 'partidas' && (
        <div className="card" style={{ overflow: 'auto' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px', flexWrap: 'wrap' }}>
            <input className="fi" style={{ maxWidth: 300 }} placeholder="Buscar por nombre o número (ej. 3.02.07.06)…" value={filtroPart} onChange={e => setFiltroPart(e.target.value)} />
            {!partidasFiltradas && (<>
              <button className="btn btn-ghost btn-xs" onClick={() => setExpandidos(new Set(foldersTodos))}>Expandir todo</button>
              <button className="btn btn-ghost btn-xs" onClick={() => setExpandidos(new Set())}>Colapsar todo</button>
            </>)}
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--tm)' }}>{partidasFiltradas ? `${partidasFiltradas.length} coinciden` : `${partidasDelFrente.length} partidas`}</span>
          </div>
          <table className="tbl" style={{ fontSize: 12 }}>
            <thead><tr><th>Código</th><th>Partida</th><th style={{ textAlign: 'right' }}>Metrado</th><th style={{ textAlign: 'right' }}>% Avance</th><th>Rendimiento</th><th></th></tr></thead>
            <tbody>
              {partidasFiltradas ? partidasFiltradas.flatMap(p => {
                const r = rendimientoPartida(p, avances || [], hoy);
                const ins = insumosPorPartida.get(p.id) || [];
                const open = expandidos.has(p.codigo_delfin);
                const rows = [
                  <tr key={p.id} onContextMenu={(e) => openCtx(e, p)} style={{ cursor: 'context-menu' }}>
                    <td style={{ whiteSpace: 'nowrap' }}>{ins.length ? <button className="btn btn-ghost btn-xs" onClick={() => toggleExp(p.codigo_delfin)} style={{ padding: '0 4px' }}>{open ? '▾' : '▸'}</button> : <span style={{ display: 'inline-block', width: 18 }} />}<span style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{p.codigo_delfin}</span></td>
                    <td>{p.nombre_partida || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{num(p.metrado_contratado)} {p.unidad || ''}</td>
                    <td style={{ textAlign: 'right' }}>{Number(p.porcentaje_avance) || 0}%</td>
                    <td><SemBadge s={r.semaforo} /></td>
                    <td style={{ textAlign: 'right' }}><button className="btn btn-ghost btn-xs" onClick={() => generarReporteDe(p)}>Reportar</button></td>
                  </tr>,
                ];
                if (open && ins.length) rows.push(<tr key={p.id + '_ins'} style={{ background: 'rgba(245,180,40,0.05)' }}><td></td><td colSpan={5}><div style={{ fontSize: 10.5, color: 'var(--tm)', margin: '2px 0' }}>Insumos a utilizar:</div><table style={{ width: '100%', fontSize: 11 }}><tbody>{ins.map(i => <tr key={i.id}><td style={{ width: 96, color: 'var(--tm)' }}>{i.tipo_insumo}</td><td>{i.nombre_insumo}</td><td style={{ textAlign: 'right', width: 130 }}>{num(i.cantidad_presupuestada)} {i.unidad || ''}</td></tr>)}</tbody></table></td></tr>);
                return rows;
              }) : renderNodos('', 0)}
              {partidasDelFrente.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>Tu frente no tiene partidas asignadas.</td></tr>}
              {partidasFiltradas && partidasFiltradas.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>Ninguna partida coincide con “{filtroPart}”.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

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
                  {hoyPct != null ? <span style={{ color: 'var(--amber)' }}> · ▼ hoy {new Date(hoy).toLocaleDateString('es-PE')}</span> : ' · hoy fuera del rango'}
                  {' '}· tocá una barra para ir a Mis Partidas
                </div>
                <div style={{ display: 'grid', gap: 4 }}>
                  {ganttPartidas.map(p => {
                    const ini = new Date(p.fecha_inicio_planificada).getTime();
                    const fin = new Date(p.fecha_fin_planificada).getTime();
                    const left = ((ini - ganttRango.ini) / ganttRango.span) * 100;
                    const width = Math.max(1.5, ((fin - ini) / ganttRango.span) * 100);
                    const r = rendimientoPartida(p, avances || [], hoy);
                    const atrasada = hoyMs > fin && (Number(p.porcentaje_avance) || 0) < 100;
                    return (
                      <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 8, alignItems: 'center', cursor: 'pointer' }} onClick={() => window.__navTo?.('mis-partidas')} onContextMenu={(e) => openCtx(e, p)}>
                        <div style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${p.codigo_delfin} · ${p.nombre_partida}`}>
                          <span style={{ fontFamily: 'monospace', color: 'var(--tm)' }}>{p.codigo_delfin}</span> {p.nombre_partida}{atrasada ? <span style={{ color: 'var(--red)' }}> ⚠</span> : null}
                        </div>
                        <div style={{ position: 'relative', height: 18, background: 'rgba(255,255,255,0.04)', borderRadius: 4 }}>
                          <div style={{ position: 'absolute', left: left + '%', width: width + '%', top: 2, bottom: 2, background: SEM[r.semaforo], borderRadius: 3, opacity: 0.9 }}
                            title={`${num(p.metrado_contratado)} ${p.unidad || ''} · ${p.fecha_inicio_planificada} → ${p.fecha_fin_planificada}`} />
                          {hoyPct != null && <div style={{ position: 'absolute', left: hoyPct + '%', top: -1, bottom: -1, width: 2, background: 'var(--amber)', zIndex: 1 }} title="Hoy" />}
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

      {vista === 'salidas' && (
        <div className="card" style={{ overflow: 'auto' }}>
          <table className="tbl" style={{ fontSize: 12 }}>
            <thead><tr><th>Fecha</th><th>Material</th><th style={{ textAlign: 'right' }}>Cantidad</th><th>Responsable</th><th>Partida</th><th></th></tr></thead>
            <tbody>
              {salidasDelFrente.map(m => {
                const yaVinc = m.partida_id;
                return (
                  <tr key={m.id}>
                    <td>{m.fecha || '—'}</td><td>{materialesById.get(m.material_id)?.nombre_material || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{num(m.cantidad)} {m.unidad || ''}</td>
                    <td>{(() => { const p = personalById.get(m.responsable_id); return p ? `${p.nombres} ${p.apellidos || ''}`.trim() : '—'; })()}</td>
                    <td>{yaVinc ? <span className="badge b-green" style={{ fontSize: 9 }}>{partById.get(m.partida_id) ? partById.get(m.partida_id).codigo_delfin : '✓'}</span> : <span style={{ color: 'var(--tm)' }}>—</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {!yaVinc && esMiFrente && (<>
                        <select className="fi" style={{ display: 'inline-block', width: 150, fontSize: 11 }} value={vincSel[m.id] || ''} onChange={e => setVincSel({ ...vincSel, [m.id]: e.target.value })}>
                          <option value="">— Partida —</option>
                          {partidasDelFrente.map(p => <option key={p.id} value={p.id}>{nombrePart(p)}</option>)}
                        </select>
                        <button className="btn btn-amber btn-xs" style={{ marginLeft: 4 }} onClick={() => vincularSalida(m)}>Vincular</button>
                      </>)}
                    </td>
                  </tr>
                );
              })}
              {salidasDelFrente.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>No hay salidas de almacén vinculadas a tu frente.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {vista === 'reporte' && esMiFrente && (
        <div style={{ display: 'grid', gap: 12, maxWidth: 700 }}>
          {hayBorrador && repLineas.length === 0 && (
            <div className="card card-p" style={{ background: 'rgba(245,180,40,0.08)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--amber)', display: 'inline-block' }} />
              <span style={{ fontSize: 12.5 }}>Tenés un borrador de hoy sin terminar.</span>
              <button className="btn btn-amber btn-xs" onClick={cargarBorrador}>Cargar borrador</button>
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

      {vista === 'reporte' && !esMiFrente && frenteActivo && (() => {
        const info = solActiva ? solEstadoInfo(solActiva.estado) : null;
        const yaAceptado = solActiva?.estado === 'aceptado';
        const tienePayload = Array.isArray(solActiva?.reporte_payload) && solActiva.reporte_payload.length > 0;
        return (
          <div style={{ display: 'grid', gap: 12, maxWidth: 700 }}>
            <div className="card card-p" style={{ background: 'rgba(245,180,40,0.06)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Reportar un frente ajeno · {frenteActivo.nombre}</div>
              <div style={{ fontSize: 12, color: 'var(--tm)' }}>Este frente no es tuyo. Llená el reporte igual que el tuyo (descripción, metrado y foto por partida) y mandalo a aprobación: el avance recién queda registrado cuando el administrador o gerente lo acepta.</div>
              {info && <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><span className="badge" style={{ background: info.color, color: '#000', fontSize: 10 }}>{info.label}</span>{solActiva.motivo && <span style={{ fontSize: 11, color: 'var(--tm)' }}>Motivo: {solActiva.motivo}</span>}</div>}
              {solActiva?.nota_decision && <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--red)' }}>Nota del admin: {solActiva.nota_decision}</div>}
            </div>

            {yaAceptado ? (
              <div className="card card-p" style={{ fontSize: 12.5 }}>El reporte fue aceptado y los avances ya se aplicaron al frente. ✓</div>
            ) : (<>
              {!solActiva && (
                <div className="card card-p" style={{ display: 'grid', gap: 6 }}>
                  <div style={{ fontSize: 12, color: 'var(--tm)' }}>Opcional: avisá al admin/gerente antes de empezar (no hace falta para poder enviar).</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input className="fi" style={{ maxWidth: 360 }} value={motivoSol} onChange={e => setMotivoSol(e.target.value)} placeholder="Motivo (ej. el ingeniero titular no asistió hoy)" />
                    <button className="btn btn-ghost btn-sm" onClick={solicitarPermiso}>Solicitar permiso primero</button>
                  </div>
                </div>
              )}
              {solActiva?.estado === 'solicitado' && (
                <div className="card card-p" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12.5 }}>
                  <span>Pediste permiso (esperando respuesta). Igual podés llenar y enviar el reporte directamente.</span>
                  <button className="btn btn-ghost btn-xs" onClick={cancelarSolicitud}>Cancelar solicitud</button>
                </div>
              )}

              {hayBorrador && repLineas.length === 0 && (
                <div className="card card-p" style={{ background: 'rgba(245,180,40,0.08)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--amber)', display: 'inline-block' }} />
                  <span style={{ fontSize: 12.5 }}>Tenés un borrador de hoy sin terminar.</span>
                  <button className="btn btn-amber btn-xs" onClick={() => cargarBorrador()}>Cargar borrador</button>
                  <button className="btn btn-ghost btn-xs" onClick={descartarBorrador}>Descartar</button>
                </div>
              )}
              {(solActiva?.estado === 'enviado' || solActiva?.estado === 'devuelto') && tienePayload && repLineas.length === 0 && (
                <div className="card card-p" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12.5 }}>{solActiva.estado === 'devuelto' ? 'El admin te devolvió el reporte para corregir.' : 'Ya enviaste un reporte (esperando aceptación). Podés editarlo y reenviarlo.'}</span>
                  <button className="btn btn-amber btn-xs" onClick={() => setRepLineas(solActiva.reporte_payload.map(l => ({ partida_id: l.partida_id, descripcion: l.descripcion || '', metrado: l.metrado ?? '', foto: null })))}>Cargar lo enviado</button>
                </div>
              )}

              {editorLineas(true)}
              {repLineas.length > 0 && (
                <div className="modal-actions" style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-amber" disabled={busyRep} onClick={enviarReporteAjeno}><JxIcon name="check" size={13} />{solActiva?.estado === 'enviado' ? 'Reenviar para aprobación' : 'Enviar para aprobación'}</button>
                  <button className="btn btn-ghost" disabled={busyRep} onClick={guardarBorrador}>Guardar como borrador</button>
                </div>
              )}
            </>)}
          </div>
        );
      })()}

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
        const _tick = draftTick;   // re-evaluar al eliminar
        const prefix = `jx_repdraft_${obraId}_`;
        const rx = /^jx_repdraft_(.+)_(.+)_(\d{4}-\d{2}-\d{2})$/;
        const items = [];
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k || !k.startsWith(prefix)) continue;
            const m = k.match(rx);
            if (!m) continue;
            const [, oid, fid, fecha] = m;
            if (oid !== obraId) continue;
            let lineas = []; try { lineas = JSON.parse(localStorage.getItem(k) || '[]'); } catch {}
            items.push({ key: k, frenteId: fid, fecha, n: Array.isArray(lineas) ? lineas.length : 0 });
          }
        } catch {}
        items.sort((a, b) => b.fecha.localeCompare(a.fecha));
        const frNombre = (id) => (frentes || []).find(f => f.id === id)?.nombre || '—';
        const esPropio = (id) => misFrentes.some(f => f.id === id);
        const retomar = (it) => { window.__miFrenteIntent = { tipo: 'borrador', frenteId: it.frenteId, fecha: it.fecha, ts: Date.now() }; window.__navTo?.('reporte-diario'); };
        const eliminar = (it) => { try { localStorage.removeItem(it.key); } catch {} if (it.key === draftKey) setHayBorrador(false); setDraftTick(t => t + 1); };
        return (
          <div className="card" style={{ overflow: 'auto' }}>
            <div style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 600 }}>Borradores guardados ({items.length})</div>
            <div style={{ padding: '0 12px 8px', fontSize: 11, color: 'var(--tm)' }}>Reportes que dejaste a medias. Retomá uno para terminarlo o eliminalo. Las fotos no se guardan en el borrador; se vuelven a adjuntar al terminar.</div>
            <table className="tbl" style={{ fontSize: 12 }}>
              <thead><tr><th>Frente</th><th>Día</th><th style={{ textAlign: 'right' }}>Partidas</th><th></th></tr></thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.key}>
                    <td>{frNombre(it.frenteId)} {esPropio(it.frenteId) ? <span className="badge b-green" style={{ fontSize: 9 }}>mío</span> : <span className="badge" style={{ background: 'var(--amber)', color: '#000', fontSize: 9 }}>ajeno</span>}</td>
                    <td>{it.fecha}</td>
                    <td style={{ textAlign: 'right' }}>{it.n}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-amber btn-xs" onClick={() => retomar(it)}>Retomar</button>
                      <button className="btn btn-ghost btn-xs" style={{ marginLeft: 4 }} onClick={() => eliminar(it)}>Eliminar</button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>No tenés borradores guardados.</td></tr>}
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

// Miniatura de evidencia (resuelve blob local o signed URL del bucket).
function EviThumb({ ev }) {
  const [src, setSrc] = uS(null);
  uE(() => { let c = false; getEvidenciaSrc(ev).then(s => { if (!c) setSrc(s); }).catch(() => {}); return () => { c = true; }; }, [ev?.id]);
  if (!src) return <span style={{ width: 46, height: 46, borderRadius: 4, background: 'rgba(255,255,255,0.06)', display: 'inline-block' }} />;
  return <a href={src} target="_blank" rel="noreferrer"><img src={src} alt="" style={{ width: 46, height: 46, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--bd)' }} /></a>;
}

// Bandeja del ADMIN/GERENTE: aprobar permisos y aceptar reportes de frente ajeno.
function AprobacionesReportePage({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const userId = auth?.profile?.id || null;
  const obraHook = window.__useObraActiva ? window.__useObraActiva() : { obraId: null };
  const obraId = obraHook?.obraId || null;
  const solHook = window.__hooks.useSolicitudesReporte(obraId);
  const { data: solicitudes } = solHook;
  const { data: frentes } = window.__hooks.useFrentesObra(obraId);
  const partidasHook = window.__hooks.usePartidas(obraId);
  const { data: partidas } = partidasHook;
  const avanceHook = window.__hooks.useAvanceObra(obraId);
  const { data: avances } = avanceHook;
  const { data: evidencias } = window.__hooks.useEvidencias(obraId);
  const fotosDeSol = (solId) => (evidencias || []).filter(e => !e.deleted_at && e.modulo_relacionado === 'solicitudes_reporte' && e.registro_relacionado_id === solId);
  const [usuarios, setUsuarios] = uS([]);
  uE(() => { window.__db.profiles.toArray().then(setUsuarios).catch(() => {}); }, []);
  const usuariosById = uM(() => { const m = new Map(); (usuarios || []).forEach(u => m.set(u.id, u)); return m; }, [usuarios]);
  const nombreUsuario = (id) => { const u = usuariosById.get(id); return u ? (`${u.nombres || ''} ${u.apellidos || ''}`.trim() || u.email || '—') : '—'; };
  const frentesById = uM(() => { const m = new Map(); (frentes || []).forEach(f => m.set(f.id, f)); return m; }, [frentes]);
  const partById = uM(() => { const m = new Map(); (partidas || []).forEach(p => m.set(p.id, p)); return m; }, [partidas]);
  const [busy, setBusy] = uS(false);

  const pend = uM(() => solicitudesPendientes(solicitudes || []), [solicitudes]);
  const histo = uM(() => (solicitudes || []).filter(s => !s.deleted_at && ['aprobado', 'rechazado', 'aceptado', 'devuelto'].includes(s.estado))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 30), [solicitudes]);

  const decidir = async (sol, patch, okMsg) => {
    setBusy(true);
    try {
      await solHook.update(sol.id, { ...patch, decidido_por: userId, decidido_at: new Date().toISOString(), updated_by: userId });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'solicitudes_reporte' } })); } catch {}
      showToast(okMsg, 'green');
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };
  const aprobar = (sol) => decidir(sol, { estado: 'aprobado', nota_decision: null }, 'Permiso aprobado');
  const rechazar = (sol) => { const nota = window.prompt('Motivo del rechazo (opcional):') ?? ''; decidir(sol, { estado: 'rechazado', nota_decision: nota || null }, 'Solicitud rechazada'); };
  const devolver = (sol) => { const nota = window.prompt('¿Qué hay que corregir? (se le muestra al ingeniero)') ?? ''; decidir(sol, { estado: 'devuelto', nota_decision: nota || null }, 'Reporte devuelto al ingeniero'); };
  const aceptar = async (sol) => {
    setBusy(true);
    try {
      const { avanceRows, partidaUpdates } = construirAvancesDeSolicitud(sol, { partidas: partidas || [], avances: avances || [], newId: window.__newId });
      for (const row of avanceRows) { try { await avanceHook.create(row); } catch (e) { console.warn('[aceptar avance]', e?.message); } }
      for (const u of partidaUpdates) { if (partidasHook.update) { try { await partidasHook.update(u.id, { porcentaje_avance: u.porcentaje_avance }); } catch {} } }
      await solHook.update(sol.id, { estado: 'aceptado', decidido_por: userId, decidido_at: new Date().toISOString(), updated_by: userId });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'avance_obra' } })); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'solicitudes_reporte' } })); } catch {}
      showToast(`Reporte aceptado · ${avanceRows.length} avance(s) aplicado(s)`, 'green');
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };

  if (!obraId) return <div className="page-wrap"><div className="card card-p empty-state"><p>Seleccioná una obra activa.</p></div></div>;
  return (
    <div className="page-wrap">
      <div className="pg-hd"><div className="pg-title">Aprobaciones de Reporte</div><div className="pg-sub">Permisos y reportes de frente ajeno que esperan tu decisión.</div></div>
      <div className="card" style={{ overflow: 'auto', marginBottom: 14 }}>
        <div style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 600 }}>Pendientes ({pend.length})</div>
        {pend.length === 0 && <div style={{ padding: '0 12px 12px', color: 'var(--tm)', fontStyle: 'italic', fontSize: 12 }}>No hay solicitudes pendientes.</div>}
        {pend.map(sol => {
          const f = frentesById.get(sol.frente_id);
          return (
            <div key={sol.id} className="card card-p" style={{ margin: '0 12px 12px' }}>
              <div className="frow-sb" style={{ flexWrap: 'wrap', gap: 6 }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{f?.nombre || sol.frente_id} · {sol.fecha}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>Solicita: {nombreUsuario(sol.solicitante_user_id)} · {sol.motivo || '—'}</div>
                </div>
                <span className="badge" style={{ background: solEstadoInfo(sol.estado).color, color: '#000', fontSize: 10, height: 'fit-content' }}>{solEstadoInfo(sol.estado).label}</span>
              </div>
              {sol.estado === 'enviado' && Array.isArray(sol.reporte_payload) && (
                <table className="tbl" style={{ fontSize: 11.5, marginTop: 8 }}>
                  <thead><tr><th>Partida</th><th>Descripción</th><th style={{ textAlign: 'right' }}>Metrado</th></tr></thead>
                  <tbody>
                    {sol.reporte_payload.map((l, i) => { const p = partById.get(l.partida_id); return (
                      <tr key={i}><td>{p ? `${p.codigo_delfin} · ${p.nombre_partida}` : l.partida_id}{l.tiene_foto ? ' 📷' : ''}</td><td>{l.descripcion || '—'}</td><td style={{ textAlign: 'right' }}>{num(l.metrado)} {p?.unidad || ''}</td></tr>
                    ); })}
                  </tbody>
                </table>
              )}
              {sol.estado === 'enviado' && (() => { const fotos = fotosDeSol(sol.id); return fotos.length > 0 ? (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, color: 'var(--tm)', marginBottom: 4 }}>Fotos del avance ({fotos.length}):</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{fotos.map(e => <EviThumb key={e.id} ev={e} />)}</div>
                </div>
              ) : null; })()}
              <div className="modal-actions" style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {sol.estado === 'solicitado' && <>
                  <button className="btn btn-green btn-sm" disabled={busy} onClick={() => aprobar(sol)}>Aprobar permiso</button>
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => rechazar(sol)}>Rechazar</button>
                </>}
                {sol.estado === 'enviado' && <>
                  <button className="btn btn-green btn-sm" disabled={busy} onClick={() => aceptar(sol)}>Aceptar y aplicar avances</button>
                  <button className="btn btn-amber btn-sm" disabled={busy} onClick={() => devolver(sol)}>Devolver para corregir</button>
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => rechazar(sol)}>Rechazar</button>
                </>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="card" style={{ overflow: 'auto' }}>
        <div style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 600 }}>Historial reciente</div>
        <table className="tbl" style={{ fontSize: 12 }}>
          <thead><tr><th>Frente</th><th>Fecha</th><th>Solicita</th><th>Estado</th></tr></thead>
          <tbody>
            {histo.map(sol => <tr key={sol.id}><td>{frentesById.get(sol.frente_id)?.nombre || '—'}</td><td>{sol.fecha}</td><td>{nombreUsuario(sol.solicitante_user_id)}</td><td><span className="badge" style={{ background: solEstadoInfo(sol.estado).color, color: '#000', fontSize: 9 }}>{solEstadoInfo(sol.estado).label}</span></td></tr>)}
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
