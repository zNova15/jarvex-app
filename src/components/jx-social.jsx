// ═══════════════════════════════════════════════════════════════════
// JARVEX — Fase 5: Gestión Social (obra ↔ comunidad).
//  · Compromisos: actas con la comunidad, vencimiento + semáforo (lib/social).
//  · Quejas/reclamos: seguimiento hasta el cierre, con evidencia de cierre.
//  · Padrón de actores: autoridades, dirigentes, instituciones, vecinos.
// Las charlas comunitarias viven en el Planificador compartido (área social).
// Actas y cierres van como evidencias (modulo 'social_compromisos'/'social_quejas').
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { hoyLocal } from "../lib/fecha.js";
import { estadoCompromiso, diasAbierta, kpisSocial, COMPROMISO_META, QUEJA_META, ACTOR_META, ESTADOS_COMPROMISO, TIPOS_QUEJA, ESTADOS_QUEJA, TIPOS_ACTOR } from "../lib/social.js";
import { getCurrentMode } from "../lib/app-mode-core.js";
const { useState: uS, useMemo: uM, useEffect: uE } = React;

const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);
const syncKick = (tabla) => { try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla } })); } catch {} try { window.dispatchEvent(new Event('online')); } catch {} };
const esPrueba = () => getCurrentMode() === 'prueba';
const camposCreate = () => (esPrueba() ? { sync_status: 'synced', demo: true } : { sync_status: 'pending_create' });
const syncUpdate = (row) => (esPrueba() ? 'synced' : (row?.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'));
const filtraModo = (rows) => (esPrueba() ? rows.filter(r => r.demo === true) : rows.filter(r => !r.demo));
const MAX_ARCHIVO = 8 * 1024 * 1024;

function useObraActivaLocal() {
  const [obraId, setObraId] = uS(() => window.__getObraActivaId?.() || null);
  uE(() => {
    const on = () => setObraId(window.__getObraActivaId?.() || null);
    window.addEventListener('obra_activa_change', on);
    return () => window.removeEventListener('obra_activa_change', on);
  }, []);
  return obraId;
}

function SocialPage({ showToast }) {
  const toast = showToast || window.__showToast || (() => {});
  const auth = window.__useAuth ? window.__useAuth() : {};
  const rol = auth?.profile?.rol || '';
  const userId = auth?.profile?.id || 'offline';
  const obraId = useObraActivaLocal();
  const canW = rol === 'admin' || (window.__hasPerm?.(rol, 'Gestión Social', 'w') ?? false);

  const [tab, setTab] = uS('compromisos');
  const [datos, setDatos] = uS({ compromisos: [], quejas: [], actores: [] });
  // hoy se refresca en cada recarga: el semáforo vencido/por_vencer no debe
  // quedar congelado si la pestaña cruza de día abierta (lección Fase 3).
  const [hoy, setHoy] = uS(() => hoyLocal());
  const recargar = async () => {
    setHoy(hoyLocal());
    if (!obraId) return;
    try {
      const [comp, quej, act] = await Promise.all([
        window.__db.social_compromisos.where('obra_id').equals(obraId).filter(r => !r.deleted_at).toArray().catch(() => []),
        window.__db.social_quejas.where('obra_id').equals(obraId).filter(r => !r.deleted_at).toArray().catch(() => []),
        window.__db.social_actores.where('obra_id').equals(obraId).filter(r => !r.deleted_at).toArray().catch(() => []),
      ]);
      setDatos({ compromisos: filtraModo(comp), quejas: filtraModo(quej), actores: filtraModo(act) });
    } catch {}
  };
  uE(() => {
    recargar();
    let deb; const on = (e) => { const t = e?.detail?.tabla; if (t && !['social_compromisos', 'social_quejas', 'social_actores', 'evidencias'].includes(t)) return; clearTimeout(deb); deb = setTimeout(recargar, 400); };
    window.addEventListener('jx_data_changed', on); window.addEventListener('jarvex_master_updated', on);
    return () => { clearTimeout(deb); window.removeEventListener('jx_data_changed', on); window.removeEventListener('jarvex_master_updated', on); };
  }, [obraId]);

  const kpis = uM(() => kpisSocial(datos, hoy), [datos, hoy]);
  const actoresById = uM(() => new Map(datos.actores.map(a => [a.id, a])), [datos.actores]);

  // Evidencias por registro (actas de compromisos + cierres de quejas)
  const [evidencias, setEvidencias] = uS(() => new Map());
  uE(() => {
    let cancel = false;
    (async () => {
      try {
        const evs = await window.__db.evidencias.filter(e => !e.deleted_at && ['social_compromisos', 'social_quejas'].includes(e.modulo_relacionado) && e.registro_relacionado_id).toArray();
        if (cancel) return;
        const m = new Map();
        for (const e of evs) { const a = m.get(e.registro_relacionado_id) || []; a.push(e); m.set(e.registro_relacionado_id, a); }
        setEvidencias(m);
      } catch {}
    })();
    return () => { cancel = true; };
  }, [datos.compromisos, datos.quejas]);

  const verArchivo = async (ev) => {
    try {
      const { getEvidenciaSrc, abrirUrlEvidencia } = await import('../lib/evidencias-url.js');
      const src = await getEvidenciaSrc(ev);
      if (src?.url) abrirUrlEvidencia(src.url); else toast('Archivo no disponible', 'red');
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
  };

  // Guardar evidencia con éxito parcial (lección F4): valida tamaño ANTES en el
  // caller; acá try/catch propio y aviso ámbar si falla.
  const guardarEvidencia = async ({ modulo, registroId, archivo, fecha, obs }) => {
    if (!archivo || esPrueba()) return { ok: true, prueba: esPrueba() && !!archivo };
    try {
      await window.__saveEvidenciaLocal?.({
        id: window.__newId(), obra_id: obraId,
        tipo_evidencia: modulo === 'social_compromisos' ? 'acta_compromiso' : 'evidencia_queja',
        modulo_relacionado: modulo, registro_relacionado_id: registroId,
        nombre_archivo: archivo.name, mime_type: archivo.type, blob: archivo,
        fecha, observaciones: obs, created_by: userId,
      });
      return { ok: true };
    } catch (e) { return { ok: false, err: e?.message || String(e) }; }
  };

  const [busy, setBusy] = uS(false);

  // ── Compromisos ──
  const [modalComp, setModalComp] = uS(false);
  const [editComp, setEditComp] = uS(null);
  const [formComp, setFormComp] = uS({});
  const abrirComp = (c = null) => {
    setEditComp(c);
    // Actor soft-deleteado del padrón: el select lo mostraría como "sin actor"
    // pero el id se re-persistiría — mejor que lo mostrado sea lo guardado.
    const actorVivo = (id) => (id && actoresById.has(id) ? id : '');
    setFormComp(c ? { fecha_acta: c.fecha_acta, descripcion: c.descripcion, comunidad: c.comunidad || '', actor_id: actorVivo(c.actor_id), fecha_limite: c.fecha_limite || '', estado: c.estado, notas: c.notas || '', archivo: null }
      : { fecha_acta: hoyLocal(), descripcion: '', comunidad: '', actor_id: '', fecha_limite: '', estado: 'pendiente', notas: '', archivo: null });
    setModalComp(true);
  };
  const guardarComp = async () => {
    if (!canW) { toast('Tu rol no puede editar compromisos', 'red'); return; }
    if (!formComp.fecha_acta) { toast('Indicá la fecha del acta', 'red'); return; }
    if (formComp.fecha_acta > hoyLocal()) { toast('La fecha del acta no puede ser futura', 'red'); return; }
    if (formComp.fecha_limite && formComp.fecha_limite < formComp.fecha_acta) { toast('La fecha límite no puede ser anterior al acta', 'red'); return; }
    if ((formComp.descripcion || '').trim().length < 5) { toast('Describí el compromiso (mín. 5 caracteres)', 'red'); return; }
    if (formComp.archivo && formComp.archivo.size > MAX_ARCHIVO) { toast('El archivo pesa más de 8 MB', 'red'); return; }
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const campos = {
        fecha_acta: formComp.fecha_acta, descripcion: formComp.descripcion.trim(),
        comunidad: formComp.comunidad?.trim() || null, actor_id: formComp.actor_id || null,
        fecha_limite: formComp.fecha_limite || null, estado: formComp.estado || 'pendiente',
        fecha_cumplimiento: formComp.estado === 'cumplido' ? (editComp?.fecha_cumplimiento || hoyLocal()) : null,
        notas: formComp.notas?.trim() || null, updated_at: now, updated_by: userId,
      };
      let id = editComp?.id;
      if (editComp) {
        await window.__db.social_compromisos.update(editComp.id, { ...campos, version: (editComp.version ?? 0) + 1, sync_status: syncUpdate(editComp) });
      } else {
        id = window.__newId();
        await window.__db.social_compromisos.add({
          id, obra_id: obraId, ...campos, responsable_id: userId, created_by: userId, created_at: now,
          version: 1, last_synced_at: null, idempotency_key: `${userId}_soccomp_${id}`, ...camposCreate(),
        });
      }
      const ev = await guardarEvidencia({ modulo: 'social_compromisos', registroId: id, archivo: formComp.archivo, fecha: formComp.fecha_acta, obs: `Acta compromiso · ${formComp.fecha_acta}` });
      syncKick('social_compromisos');
      if (ev.err) toast(`Compromiso guardado, pero el acta no se pudo adjuntar: ${ev.err}`, 'amber');
      else if (ev.prueba) toast('✓ Compromiso guardado · en modo prueba el archivo no se sube', 'amber');
      else toast(editComp ? '✓ Compromiso actualizado' : '✓ Compromiso registrado', 'green');
      setModalComp(false); recargar();
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };
  const cambiarEstadoComp = async (c, estado) => {
    if (!canW) { toast('Tu rol no puede editar compromisos', 'red'); return; }
    try {
      const now = new Date().toISOString();
      await window.__db.social_compromisos.update(c.id, {
        estado, fecha_cumplimiento: estado === 'cumplido' ? hoyLocal() : null,
        updated_at: now, updated_by: userId, version: (c.version ?? 0) + 1, sync_status: syncUpdate(c),
      });
      syncKick('social_compromisos'); recargar();
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
  };

  const [filtroComp, setFiltroComp] = uS('todos');
  const listaComp = uM(() => datos.compromisos
    .map(c => ({ ...c, _estado: estadoCompromiso(c, hoy) }))
    .filter(c => filtroComp === 'todos' || c._estado === filtroComp)
    .sort((a, b) => String(a.fecha_limite || '9999').localeCompare(String(b.fecha_limite || '9999'))),
    [datos.compromisos, filtroComp, hoy]);

  // ── Quejas ──
  const [modalQueja, setModalQueja] = uS(false);
  const [editQueja, setEditQueja] = uS(null);
  const [formQueja, setFormQueja] = uS({});
  const abrirQueja = (q = null) => {
    setEditQueja(q);
    const actorVivo = (id) => (id && actoresById.has(id) ? id : '');
    setFormQueja(q ? { fecha: q.fecha, tipo: q.tipo, descripcion: q.descripcion, reclamante: q.reclamante || '', actor_id: actorVivo(q.actor_id), estado: q.estado, respuesta: q.respuesta || '', archivo: null }
      : { fecha: hoyLocal(), tipo: 'queja', descripcion: '', reclamante: '', actor_id: '', estado: 'abierta', respuesta: '', archivo: null });
    setModalQueja(true);
  };
  const guardarQueja = async () => {
    if (!canW) { toast('Tu rol no puede registrar quejas', 'red'); return; }
    if (!formQueja.fecha) { toast('Indicá la fecha', 'red'); return; }
    if (formQueja.fecha > hoyLocal()) { toast('La fecha no puede ser futura', 'red'); return; }
    if ((formQueja.descripcion || '').trim().length < 5) { toast('Describí la queja/reclamo (mín. 5 caracteres)', 'red'); return; }
    if (formQueja.estado === 'cerrada' && !(formQueja.respuesta || '').trim()) { toast('Para cerrar, registrá la respuesta/acciones tomadas', 'red'); return; }
    if (formQueja.archivo && formQueja.archivo.size > MAX_ARCHIVO) { toast('El archivo pesa más de 8 MB', 'red'); return; }
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const campos = {
        fecha: formQueja.fecha, tipo: formQueja.tipo || 'queja', descripcion: formQueja.descripcion.trim(),
        reclamante: formQueja.reclamante?.trim() || null, actor_id: formQueja.actor_id || null,
        estado: formQueja.estado || 'abierta', respuesta: formQueja.respuesta?.trim() || null,
        fecha_cierre: formQueja.estado === 'cerrada' ? (editQueja?.fecha_cierre || hoyLocal()) : null,
        updated_at: now, updated_by: userId,
      };
      let id = editQueja?.id;
      if (editQueja) {
        await window.__db.social_quejas.update(editQueja.id, { ...campos, version: (editQueja.version ?? 0) + 1, sync_status: syncUpdate(editQueja) });
      } else {
        id = window.__newId();
        await window.__db.social_quejas.add({
          id, obra_id: obraId, ...campos, responsable_id: userId, created_by: userId, created_at: now,
          version: 1, last_synced_at: null, idempotency_key: `${userId}_socquej_${id}`, ...camposCreate(),
        });
      }
      const ev = await guardarEvidencia({ modulo: 'social_quejas', registroId: id, archivo: formQueja.archivo, fecha: formQueja.fecha, obs: `${formQueja.tipo} · ${formQueja.fecha}` });
      syncKick('social_quejas');
      if (ev.err) toast(`Guardado, pero el archivo no se pudo adjuntar: ${ev.err}`, 'amber');
      else if (ev.prueba) toast('✓ Guardado · en modo prueba el archivo no se sube', 'amber');
      else toast(editQueja ? '✓ Queja actualizada' : '✓ Queja registrada', 'green');
      setModalQueja(false); recargar();
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };

  const [filtroQueja, setFiltroQueja] = uS('todos');
  const listaQuejas = uM(() => datos.quejas
    .filter(q => filtroQueja === 'todos' || q.estado === filtroQueja)
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))),
    [datos.quejas, filtroQueja]);

  // ── Actores ──
  const [modalActor, setModalActor] = uS(false);
  const [editActor, setEditActor] = uS(null);
  const [formActor, setFormActor] = uS({});
  const abrirActor = (a = null) => {
    setEditActor(a);
    setFormActor(a ? { nombre: a.nombre, tipo: a.tipo || 'dirigente', organizacion: a.organizacion || '', cargo: a.cargo || '', telefono: a.telefono || '', comunidad: a.comunidad || '', notas: a.notas || '' }
      : { nombre: '', tipo: 'dirigente', organizacion: '', cargo: '', telefono: '', comunidad: '', notas: '' });
    setModalActor(true);
  };
  const guardarActor = async () => {
    if (!canW) { toast('Tu rol no puede editar el padrón', 'red'); return; }
    if (!(formActor.nombre || '').trim()) { toast('Indicá el nombre', 'red'); return; }
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const campos = {
        nombre: formActor.nombre.trim(), tipo: formActor.tipo || 'otro',
        organizacion: formActor.organizacion?.trim() || null, cargo: formActor.cargo?.trim() || null,
        telefono: formActor.telefono?.trim() || null, comunidad: formActor.comunidad?.trim() || null,
        notas: formActor.notas?.trim() || null, updated_at: now, updated_by: userId,
      };
      if (editActor) {
        await window.__db.social_actores.update(editActor.id, { ...campos, version: (editActor.version ?? 0) + 1, sync_status: syncUpdate(editActor) });
      } else {
        const id = window.__newId();
        await window.__db.social_actores.add({
          id, obra_id: obraId, ...campos, created_by: userId, created_at: now,
          version: 1, last_synced_at: null, idempotency_key: `${userId}_socact_${id}`, ...camposCreate(),
        });
      }
      syncKick('social_actores');
      toast(editActor ? '✓ Actor actualizado' : '✓ Actor agregado', 'green');
      setModalActor(false); recargar();
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };
  const eliminarActor = async (a) => {
    if (!canW) { toast('Tu rol no puede editar el padrón', 'red'); return; }
    const enUso = datos.compromisos.some(c => c.actor_id === a.id) || datos.quejas.some(q => q.actor_id === a.id);
    if (!window.confirm(enUso ? `${a.nombre} está vinculado a compromisos/quejas (quedarán sin actor). ¿Eliminar del padrón?` : `¿Eliminar a ${a.nombre} del padrón?`)) return;
    try {
      const now = new Date().toISOString();
      await window.__db.social_actores.update(a.id, { deleted_at: now, updated_at: now, updated_by: userId, version: (a.version ?? 0) + 1, sync_status: syncUpdate(a) });
      syncKick('social_actores'); toast('✓ Eliminado del padrón', 'green'); recargar();
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
  };

  const [qActor, setQActor] = uS('');
  const listaActores = uM(() => {
    const nq = qActor.trim().toLowerCase();
    return datos.actores
      .filter(a => !nq || `${a.nombre} ${a.organizacion || ''} ${a.comunidad || ''} ${a.cargo || ''}`.toLowerCase().includes(nq))
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  }, [datos.actores, qActor]);

  const nombreActor = (id) => (id && actoresById.get(id)?.nombre) || null;
  const Modal = window.Modal;
  if (!obraId) return <div className="page-wrap"><div className="empty-state"><JxIcon name="users" size={32} color="var(--tm)" /><p>Selecciona una obra activa.</p></div></div>;

  const selActor = (valor, onChange) => (
    <select className="fi" value={valor || ''} onChange={onChange}>
      <option value="">— sin actor del padrón —</option>
      {datos.actores.slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre))).map(a => (
        <option key={a.id} value={a.id}>{a.nombre}{a.organizacion ? ` (${a.organizacion})` : ''}</option>
      ))}
    </select>
  );

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Gestión Social</div>
          <div className="pg-sub">Compromisos con la comunidad · quejas y reclamos · padrón de actores</div>
        </div>
        {!canW && <span className="badge b-gray" title="Tu rol es de solo lectura">Solo lectura</span>}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 14 }}>
        {[['Compromisos', kpis.compromisos.total, 'var(--tp)'], ['Vencidos', kpis.compromisos.vencidos, 'var(--red)'], ['Por vencer (7d)', kpis.compromisos.por_vencer, 'var(--amber)'], ['Cumplidos', kpis.compromisos.cumplidos, 'var(--green)'], ['Quejas abiertas', kpis.quejas.abiertas + kpis.quejas.en_atencion, 'var(--red)'], ['Quejas cerradas', kpis.quejas.cerradas, 'var(--green)']].map(([lbl, n, color]) => (
          <div key={lbl} className="card card-p" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color }}>{n}</div>
            <div style={{ fontSize: 11, color: 'var(--ts)' }}>{lbl}</div>
          </div>
        ))}
      </div>

      {/* Pestañas */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {[['compromisos', 'Compromisos'], ['quejas', 'Quejas y reclamos'], ['actores', 'Padrón de actores']].map(([k, lbl]) => (
          <button key={k} className={`btn btn-sm ${tab === k ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab(k)}>{lbl}</button>
        ))}
      </div>

      {/* ── TAB Compromisos ── */}
      {tab === 'compromisos' && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--tp)' }}>Compromisos de actas</span>
            <select className="fi" value={filtroComp} onChange={e => setFiltroComp(e.target.value)} style={{ width: 'auto', marginLeft: 'auto' }}>
              <option value="todos">Todos</option>
              {['vencido', 'por_vencer', 'pendiente', 'en_proceso', 'cumplido'].map(k => <option key={k} value={k}>{COMPROMISO_META[k].label}</option>)}
            </select>
            {canW && <button className="btn btn-amber btn-sm" onClick={() => abrirComp()}><JxIcon name="plus" size={13} /> Compromiso</button>}
          </div>
          <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 420px)' }}>
            <table className="tbl">
              <thead><tr><th>Acta</th><th>Compromiso</th><th>Comunidad / actor</th><th>Límite</th><th>Estado</th><th>Archivos</th>{canW && <th>Marcar</th>}</tr></thead>
              <tbody>
                {listaComp.length === 0 ? (
                  <tr><td colSpan={canW ? 7 : 6} style={{ textAlign: 'center', padding: 22, color: 'var(--tm)' }}>Sin compromisos {filtroComp !== 'todos' ? 'en ese estado' : 'registrados'}.</td></tr>
                ) : listaComp.map(c => {
                  const evs = evidencias.get(c.id) || [];
                  return (
                    <tr key={c.id} onClick={() => canW && abrirComp(c)} style={{ cursor: canW ? 'pointer' : 'default' }}>
                      <td className="col-m">{c.fecha_acta}</td>
                      <td style={{ maxWidth: 320, whiteSpace: 'normal', fontSize: 12.5 }}>{c.descripcion}{c.notas ? <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>{c.notas}</div> : null}</td>
                      <td style={{ fontSize: 11.5 }}>{c.comunidad || '—'}{nombreActor(c.actor_id) ? <div style={{ color: 'var(--tm)', fontSize: 10.5 }}>{nombreActor(c.actor_id)}</div> : null}</td>
                      <td className="col-m">{c.fecha_limite || '—'}{c._estado === 'cumplido' && c.fecha_cumplimiento ? <div style={{ fontSize: 10.5, color: 'var(--green)' }}>✓ {c.fecha_cumplimiento}</div> : null}</td>
                      <td><span className={`badge ${COMPROMISO_META[c._estado].badge}`}>{COMPROMISO_META[c._estado].label}</span></td>
                      <td onClick={e => e.stopPropagation()}>{evs.length === 0 ? <span style={{ color: 'var(--tm)', fontSize: 11 }}>—</span>
                        : evs.map(ev => <button key={ev.id} className="btn btn-ghost btn-xs" onClick={() => verArchivo(ev)}>📄 {String(ev.nombre_archivo || 'archivo').slice(0, 16)}</button>)}</td>
                      {canW && <td onClick={e => e.stopPropagation()}>
                        {c.estado !== 'cumplido'
                          ? <button className="btn btn-ghost btn-xs" onClick={() => cambiarEstadoComp(c, 'cumplido')}>✓ Cumplido</button>
                          : <button className="btn btn-ghost btn-xs" onClick={() => cambiarEstadoComp(c, 'pendiente')}>↩ Reabrir</button>}
                      </td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB Quejas ── */}
      {tab === 'quejas' && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--tp)' }}>Quejas, reclamos y sugerencias</span>
            <select className="fi" value={filtroQueja} onChange={e => setFiltroQueja(e.target.value)} style={{ width: 'auto', marginLeft: 'auto' }}>
              <option value="todos">Todas</option>
              {ESTADOS_QUEJA.map(k => <option key={k} value={k}>{QUEJA_META[k].label}</option>)}
            </select>
            {canW && <button className="btn btn-amber btn-sm" onClick={() => abrirQueja()}><JxIcon name="plus" size={13} /> Registrar</button>}
          </div>
          <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 420px)' }}>
            <table className="tbl">
              <thead><tr><th>Fecha</th><th>Tipo</th><th>Descripción</th><th>Reclamante</th><th>Estado</th><th>Días</th><th>Archivos</th></tr></thead>
              <tbody>
                {listaQuejas.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 22, color: 'var(--tm)' }}>Sin registros {filtroQueja !== 'todos' ? 'en ese estado' : ''}.</td></tr>
                ) : listaQuejas.map(qj => {
                  const evs = evidencias.get(qj.id) || [];
                  const dias = diasAbierta(qj, hoy);
                  return (
                    <tr key={qj.id} onClick={() => canW && abrirQueja(qj)} style={{ cursor: canW ? 'pointer' : 'default' }}>
                      <td className="col-m">{qj.fecha}</td>
                      <td><span className="badge b-gray">{qj.tipo}</span></td>
                      <td style={{ maxWidth: 300, whiteSpace: 'normal', fontSize: 12.5 }}>{qj.descripcion}{qj.respuesta ? <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>↳ {qj.respuesta}</div> : null}</td>
                      <td style={{ fontSize: 11.5 }}>{qj.reclamante || nombreActor(qj.actor_id) || '—'}</td>
                      <td><span className={`badge ${QUEJA_META[qj.estado]?.badge || 'b-gray'}`}>{QUEJA_META[qj.estado]?.label || qj.estado}</span></td>
                      <td style={{ textAlign: 'center', color: qj.estado !== 'cerrada' && dias > 14 ? 'var(--red)' : 'var(--ts)', fontWeight: qj.estado !== 'cerrada' && dias > 14 ? 700 : 400 }}>{dias ?? '—'}</td>
                      <td onClick={e => e.stopPropagation()}>{evs.length === 0 ? <span style={{ color: 'var(--tm)', fontSize: 11 }}>—</span>
                        : evs.map(ev => <button key={ev.id} className="btn btn-ghost btn-xs" onClick={() => verArchivo(ev)}>📄 {String(ev.nombre_archivo || 'archivo').slice(0, 16)}</button>)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB Padrón ── */}
      {tab === 'actores' && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--tp)' }}>Padrón de actores sociales</span>
            <input className="fi" placeholder="Buscar…" value={qActor} onChange={e => setQActor(e.target.value)} style={{ marginLeft: 'auto', maxWidth: 200 }} />
            {canW && <button className="btn btn-amber btn-sm" onClick={() => abrirActor()}><JxIcon name="plus" size={13} /> Actor</button>}
          </div>
          <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 420px)' }}>
            <table className="tbl">
              <thead><tr><th>Nombre</th><th>Tipo</th><th>Organización / cargo</th><th>Comunidad</th><th>Teléfono</th>{canW && <th></th>}</tr></thead>
              <tbody>
                {listaActores.length === 0 ? (
                  <tr><td colSpan={canW ? 6 : 5} style={{ textAlign: 'center', padding: 22, color: 'var(--tm)' }}>Padrón vacío — registrá autoridades, dirigentes y actores clave de la zona.</td></tr>
                ) : listaActores.map(a => (
                  <tr key={a.id}>
                    <td className="col-p">{a.nombre}{a.notas ? <div style={{ fontSize: 10.5, color: 'var(--tm)', fontWeight: 400 }}>{a.notas}</div> : null}</td>
                    <td><span className="badge b-blue">{ACTOR_META[a.tipo]?.label || a.tipo || '—'}</span></td>
                    <td style={{ fontSize: 11.5 }}>{[a.organizacion, a.cargo].filter(Boolean).join(' · ') || '—'}</td>
                    <td style={{ fontSize: 11.5 }}>{a.comunidad || '—'}</td>
                    <td className="col-m">{a.telefono || '—'}</td>
                    {canW && <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost btn-xs" onClick={() => abrirActor(a)}>✎</button>
                      <button className="btn btn-ghost btn-xs" onClick={() => eliminarActor(a)}>🗑</button>
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Modal compromiso ── */}
      {modalComp && Modal && (
        <Modal title={editComp ? 'Editar compromiso' : 'Nuevo compromiso con la comunidad'} icon="flag" onClose={() => setModalComp(false)}>
          <div className="g2">
            <div><label className="flabel">Fecha del acta *</label>
              <input className="fi" type="date" value={formComp.fecha_acta || ''} max={hoyLocal()} onChange={e => setFormComp({ ...formComp, fecha_acta: e.target.value })} /></div>
            <div><label className="flabel">Fecha límite</label>
              <input className="fi" type="date" value={formComp.fecha_limite || ''} min={formComp.fecha_acta || undefined} onChange={e => setFormComp({ ...formComp, fecha_limite: e.target.value })} /></div>
            <div style={{ gridColumn: '1/-1' }}><label className="flabel">Compromiso *</label>
              <textarea className="fi" rows={2} value={formComp.descripcion || ''} onChange={e => setFormComp({ ...formComp, descripcion: e.target.value })}
                placeholder="Ej: Contratar 5 trabajadores de la comunidad para el frente 2" /></div>
            <div><label className="flabel">Comunidad / sector</label>
              <input className="fi" value={formComp.comunidad || ''} onChange={e => setFormComp({ ...formComp, comunidad: e.target.value })} /></div>
            <div><label className="flabel">Actor del padrón</label>{selActor(formComp.actor_id, e => setFormComp({ ...formComp, actor_id: e.target.value }))}</div>
            <div><label className="flabel">Estado</label>
              <select className="fi" value={formComp.estado || 'pendiente'} onChange={e => setFormComp({ ...formComp, estado: e.target.value })}>
                {ESTADOS_COMPROMISO.map(x => <option key={x} value={x}>{COMPROMISO_META[x].label}</option>)}
              </select></div>
            <div><label className="flabel">Acta / evidencia (PDF o foto)</label>
              <input className="fi" type="file" accept="application/pdf,image/*" onChange={e => setFormComp({ ...formComp, archivo: e.target.files?.[0] || null })} /></div>
            <div style={{ gridColumn: '1/-1' }}><label className="flabel">Notas</label>
              <input className="fi" value={formComp.notas || ''} onChange={e => setFormComp({ ...formComp, notas: e.target.value })} /></div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" disabled={busy} onClick={() => setModalComp(false)}>Cancelar</button>
            <button className="btn btn-amber" disabled={busy} onClick={guardarComp}><JxIcon name="check" size={13} /> {busy ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </Modal>
      )}

      {/* ── Modal queja ── */}
      {modalQueja && Modal && (
        <Modal title={editQueja ? 'Actualizar queja / reclamo' : 'Registrar queja / reclamo'} icon="alert" onClose={() => setModalQueja(false)}>
          <div className="g2">
            <div><label className="flabel">Fecha *</label>
              <input className="fi" type="date" value={formQueja.fecha || ''} max={hoyLocal()} onChange={e => setFormQueja({ ...formQueja, fecha: e.target.value })} /></div>
            <div><label className="flabel">Tipo</label>
              <select className="fi" value={formQueja.tipo || 'queja'} onChange={e => setFormQueja({ ...formQueja, tipo: e.target.value })}>
                {TIPOS_QUEJA.map(x => <option key={x} value={x}>{x}</option>)}
              </select></div>
            <div style={{ gridColumn: '1/-1' }}><label className="flabel">Descripción *</label>
              <textarea className="fi" rows={2} value={formQueja.descripcion || ''} onChange={e => setFormQueja({ ...formQueja, descripcion: e.target.value })}
                placeholder="Ej: Polvo excesivo en el tramo frente a la escuela" /></div>
            <div><label className="flabel">Reclamante</label>
              <input className="fi" value={formQueja.reclamante || ''} onChange={e => setFormQueja({ ...formQueja, reclamante: e.target.value })} /></div>
            <div><label className="flabel">Actor del padrón</label>{selActor(formQueja.actor_id, e => setFormQueja({ ...formQueja, actor_id: e.target.value }))}</div>
            <div><label className="flabel">Estado</label>
              <select className="fi" value={formQueja.estado || 'abierta'} onChange={e => setFormQueja({ ...formQueja, estado: e.target.value })}>
                {ESTADOS_QUEJA.map(x => <option key={x} value={x}>{QUEJA_META[x].label}</option>)}
              </select></div>
            <div><label className="flabel">Evidencia (PDF o foto)</label>
              <input className="fi" type="file" accept="application/pdf,image/*" onChange={e => setFormQueja({ ...formQueja, archivo: e.target.files?.[0] || null })} /></div>
            <div style={{ gridColumn: '1/-1' }}><label className="flabel">Respuesta / acciones tomadas {formQueja.estado === 'cerrada' ? '*' : ''}</label>
              <textarea className="fi" rows={2} value={formQueja.respuesta || ''} onChange={e => setFormQueja({ ...formQueja, respuesta: e.target.value })}
                placeholder="Obligatoria para cerrar la queja" /></div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" disabled={busy} onClick={() => setModalQueja(false)}>Cancelar</button>
            <button className="btn btn-amber" disabled={busy} onClick={guardarQueja}><JxIcon name="check" size={13} /> {busy ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </Modal>
      )}

      {/* ── Modal actor ── */}
      {modalActor && Modal && (
        <Modal title={editActor ? 'Editar actor' : 'Nuevo actor social'} icon="users" onClose={() => setModalActor(false)}>
          <div className="g2">
            <div style={{ gridColumn: '1/-1' }}><label className="flabel">Nombre *</label>
              <input className="fi" value={formActor.nombre || ''} onChange={e => setFormActor({ ...formActor, nombre: e.target.value })} /></div>
            <div><label className="flabel">Tipo</label>
              <select className="fi" value={formActor.tipo || 'dirigente'} onChange={e => setFormActor({ ...formActor, tipo: e.target.value })}>
                {TIPOS_ACTOR.map(x => <option key={x} value={x}>{ACTOR_META[x].label}</option>)}
              </select></div>
            <div><label className="flabel">Teléfono</label>
              <input className="fi" value={formActor.telefono || ''} onChange={e => setFormActor({ ...formActor, telefono: e.target.value })} /></div>
            <div><label className="flabel">Organización</label>
              <input className="fi" value={formActor.organizacion || ''} onChange={e => setFormActor({ ...formActor, organizacion: e.target.value })} placeholder="Ej: Junta vecinal, Municipalidad" /></div>
            <div><label className="flabel">Cargo</label>
              <input className="fi" value={formActor.cargo || ''} onChange={e => setFormActor({ ...formActor, cargo: e.target.value })} /></div>
            <div><label className="flabel">Comunidad / sector</label>
              <input className="fi" value={formActor.comunidad || ''} onChange={e => setFormActor({ ...formActor, comunidad: e.target.value })} /></div>
            <div style={{ gridColumn: '1/-1' }}><label className="flabel">Notas</label>
              <input className="fi" value={formActor.notas || ''} onChange={e => setFormActor({ ...formActor, notas: e.target.value })} /></div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" disabled={busy} onClick={() => setModalActor(false)}>Cancelar</button>
            <button className="btn btn-amber" disabled={busy} onClick={guardarActor}><JxIcon name="check" size={13} /> {busy ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { SocialPage });
