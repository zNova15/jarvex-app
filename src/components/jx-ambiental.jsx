// ═══════════════════════════════════════════════════════════════════
// JARVEX — Fase 3: Gestión Ambiental (ISO 14001 / reglamento ambiental).
//
// Archivo de cumplimiento: la ing. ambiental sube evidencia por CATEGORÍA fija
// (residuos, monitoreos, permisos, incidentes, capacitación, inspecciones) y
// la MATRIZ MENSUAL se arma sola — qué categorías tienen evidencia cada mes.
// "Capacitación" se autocompleta con charlas ambientales realizadas (charlas_plan)
// y las inducciones ambientales de la Fase 2.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { hoyLocal } from "../lib/fecha.js";
import { CATEGORIAS_AMBIENTALES, mesesRango, matrizCumplimiento } from "../lib/ambiental.js";
import { getCurrentMode } from "../lib/app-mode-core.js";
const { useState: uS, useMemo: uM, useEffect: uE } = React;

const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);
const esPrueba = () => getCurrentMode() === 'prueba';
const filtraModo = (rows) => (esPrueba() ? rows.filter(r => r.demo === true) : rows.filter(r => !r.demo));
const CAT_META = Object.fromEntries(CATEGORIAS_AMBIENTALES.map(c => [c.key, c]));
const MES_LBL = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];
const lblMes = (ym) => { const [y, m] = ym.split('-'); return `${MES_LBL[Number(m) - 1]} ${y.slice(2)}`; };

function useObraActivaLocal() {
  const [obraId, setObraId] = uS(() => window.__getObraActivaId?.() || null);
  uE(() => {
    const on = () => setObraId(window.__getObraActivaId?.() || null);
    window.addEventListener('obra_activa_change', on);
    return () => window.removeEventListener('obra_activa_change', on);
  }, []);
  return obraId;
}

function AmbientalPage({ showToast }) {
  const toast = showToast || window.__showToast || (() => {});
  const auth = window.__useAuth ? window.__useAuth() : {};
  const rol = auth?.profile?.rol || '';
  const userId = auth?.profile?.id || 'offline';
  const obraId = useObraActivaLocal();
  const canW = rol === 'admin' || (window.__hasPerm?.(rol, 'Gestión Ambiental', 'w') ?? false);

  const [nMeses, setNMeses] = uS(6);
  const [datos, setDatos] = uS({ registros: [], charlas: [], inducciones: [] });
  // mesHoy se refresca en cada recarga: si la pestaña queda abierta al cruzar de
  // mes, el rango de la matriz salta al mes nuevo en la primera recarga de datos.
  const [mesHoy, setMesHoy] = uS(() => hoyLocal().slice(0, 7));
  const recargar = async () => {
    setMesHoy(hoyLocal().slice(0, 7));
    if (!obraId) return;
    try {
      const [regs, charlas, induc] = await Promise.all([
        window.__db.ambiental_registros.where('obra_id').equals(obraId).filter(r => !r.deleted_at).toArray().catch(() => []),
        window.__db.charlas_plan.where('obra_id').equals(obraId).filter(c => !c.deleted_at && c.area === 'ambiental' && c.estado === 'realizada').toArray().catch(() => []),
        window.__db.inducciones.where('obra_id').equals(obraId).filter(i => !i.deleted_at && i.tipo === 'ambiental').toArray().catch(() => []),
      ]);
      setDatos({ registros: filtraModo(regs), charlas: filtraModo(charlas), inducciones: filtraModo(induc) });
    } catch {}
  };
  uE(() => {
    recargar();
    let deb; const on = (e) => { const t = e?.detail?.tabla; if (t && !['ambiental_registros', 'charlas_plan', 'inducciones', 'evidencias'].includes(t)) return; clearTimeout(deb); deb = setTimeout(recargar, 400); };
    window.addEventListener('jx_data_changed', on); window.addEventListener('jarvex_master_updated', on);
    return () => { clearTimeout(deb); window.removeEventListener('jx_data_changed', on); window.removeEventListener('jarvex_master_updated', on); };
  }, [obraId]);

  const meses = uM(() => mesesRango(hoyLocal(), nMeses), [nMeses, mesHoy]);
  const matriz = uM(() => matrizCumplimiento({ registros: datos.registros, charlasAmbientales: datos.charlas, induccionesAmbientales: datos.inducciones, meses }), [datos, meses]);

  const [catFiltro, setCatFiltro] = uS('todas');
  const [mesFiltro, setMesFiltro] = uS('todos');
  const listaRegistros = uM(() => {
    let f = [...datos.registros];
    if (catFiltro !== 'todas') f = f.filter(r => r.categoria === catFiltro);
    if (mesFiltro !== 'todos') f = f.filter(r => String(r.fecha).slice(0, 7) === mesFiltro);
    return f.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  }, [datos.registros, catFiltro, mesFiltro]);

  // La celda de Capacitación suma charlas/inducciones automáticas que NO viven en
  // ambiental_registros: sin esta nota, una celda verde con lista vacía parece bug.
  const autoCap = uM(() => {
    if (catFiltro !== 'capacitacion') return null;
    const enMes = (f) => mesFiltro === 'todos' || String(f).slice(0, 7) === mesFiltro;
    return { nCh: datos.charlas.filter(c => enMes(c.fecha)).length, nIn: datos.inducciones.filter(i => enMes(i.fecha)).length };
  }, [catFiltro, mesFiltro, datos]);

  // Evidencias adjuntas por registro
  const [evidencias, setEvidencias] = uS(() => new Map());
  uE(() => {
    let cancel = false;
    (async () => {
      try {
        const evs = await window.__db.evidencias.filter(e => !e.deleted_at && e.modulo_relacionado === 'ambiental_registros' && e.registro_relacionado_id).toArray();
        if (cancel) return;
        const m = new Map();
        for (const e of evs) { const a = m.get(e.registro_relacionado_id) || []; a.push(e); m.set(e.registro_relacionado_id, a); }
        setEvidencias(m);
      } catch {}
    })();
    return () => { cancel = true; };
  }, [datos.registros]);

  const [modal, setModal] = uS(false);
  const [form, setForm] = uS({});
  const [busy, setBusy] = uS(false);
  const abrirNuevo = (categoria = '') => { setForm({ categoria: categoria || 'residuos', fecha: hoyLocal(), descripcion: '', archivos: [] }); setModal(true); };

  const guardar = async () => {
    if (!canW) { toast('Tu rol no puede registrar evidencias ambientales', 'red'); return; }
    if (!form.categoria) { toast('Elegí la categoría', 'red'); return; }
    if (!form.fecha) { toast('Indicá la fecha', 'red'); return; }
    if ((form.descripcion || '').trim().length < 5) { toast('Describí la evidencia (mín. 5 caracteres)', 'red'); return; }
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const id = window.__newId();
      await window.__db.ambiental_registros.add({
        id, obra_id: obraId, categoria: form.categoria, fecha: form.fecha,
        descripcion: form.descripcion.trim(), responsable_id: userId,
        created_by: userId, updated_by: userId, created_at: now, updated_at: now,
        version: 1, last_synced_at: null, idempotency_key: `${userId}_ambreg_${id}`,
        ...(esPrueba() ? { sync_status: 'synced', demo: true } : { sync_status: 'pending_create' }),
      });
      // En modo prueba NO se suben archivos: __saveEvidenciaLocal siempre crea la
      // evidencia PENDING y el uploader la subiría al bucket real apuntando a un
      // registro demo que nunca llega al server (huérfana + egress real).
      let subidas = 0;
      const prueba = esPrueba();
      if (!prueba) for (const f of (form.archivos || [])) {
        try {
          await window.__saveEvidenciaLocal?.({
            id: window.__newId(), obra_id: obraId,
            tipo_evidencia: 'evidencia_ambiental', modulo_relacionado: 'ambiental_registros', registro_relacionado_id: id,
            nombre_archivo: f.name, mime_type: f.type, blob: f,
            fecha: form.fecha, observaciones: `${CAT_META[form.categoria]?.label || form.categoria} · ${form.fecha}`,
            created_by: userId,
          });
          subidas++;
        } catch {}
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'ambiental_registros' } })); } catch {}
      try { window.dispatchEvent(new Event('online')); } catch {}
      if (prueba && form.archivos?.length) toast('✓ Evidencia registrada · en modo prueba los archivos no se suben', 'amber');
      else toast(`✓ Evidencia registrada${form.archivos?.length ? ` · ${subidas}/${form.archivos.length} archivo(s)` : ''}`, 'green');
      setModal(false); recargar();
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };

  const verArchivo = async (ev) => {
    try {
      const { getEvidenciaSrc } = await import('../lib/evidencias-url.js');
      const src = await getEvidenciaSrc(ev);
      if (src?.url) window.open(src.url, '_blank'); else toast('Archivo no disponible', 'red');
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
  };

  const Modal = window.Modal;
  if (!obraId) return <div className="page-wrap"><div className="empty-state"><JxIcon name="map" size={32} color="var(--tm)" /><p>Selecciona una obra activa.</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Gestión Ambiental</div>
          <div className="pg-sub">Archivo de cumplimiento ISO 14001 · evidencia por categoría × mes</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select className="fi" value={nMeses} onChange={e => setNMeses(Number(e.target.value))} style={{ width: 'auto' }}>
            <option value={6}>Últimos 6 meses</option>
            <option value={12}>Últimos 12 meses</option>
          </select>
          {canW ? <button className="btn btn-amber btn-sm" onClick={() => abrirNuevo()}><JxIcon name="plus" size={13} /> Registrar evidencia</button>
            : <span className="badge b-gray" title="Tu rol es de solo lectura">Solo lectura</span>}
        </div>
      </div>

      {matriz.pendientesMesActual.length > 0 && (
        <div className="card card-p" style={{ marginBottom: 14, background: 'rgba(242,183,5,0.07)', border: '1px solid rgba(242,183,5,0.35)' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--amber)', marginBottom: 4 }}>⚠ Este mes aún sin evidencia en {matriz.pendientesMesActual.length} categoría(s)</div>
          <div style={{ fontSize: 11.5, color: 'var(--ts)' }}>{matriz.pendientesMesActual.join(' · ')}</div>
        </div>
      )}

      {/* ── Matriz de cumplimiento ── */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, color: 'var(--tp)', borderBottom: '1px solid var(--border)' }}>
          Matriz de cumplimiento mensual <span style={{ fontWeight: 400, color: 'var(--tm)', fontSize: 11 }}>· click en una celda para filtrar</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr>
              <th>Categoría</th>
              {meses.map(m => <th key={m} style={{ textAlign: 'center' }}>{lblMes(m)}</th>)}
              <th style={{ textAlign: 'right' }}>Total</th>
            </tr></thead>
            <tbody>
              {matriz.porCategoria.map(c => (
                <tr key={c.key}>
                  <td className="col-p" title={CAT_META[c.key]?.hint}>
                    <JxIcon name={CAT_META[c.key]?.icon || 'file'} size={12} color="var(--amber)" /> {c.label}
                  </td>
                  {c.meses.map(f => (
                    <td key={f.mes} style={{ textAlign: 'center', cursor: 'pointer' }}
                      title={`${c.label} · ${lblMes(f.mes)} · ${f.n} evidencia(s)`}
                      onClick={() => { setCatFiltro(c.key); setMesFiltro(f.mes); }}>
                      {f.ok
                        ? <span className="badge b-green" style={{ minWidth: 26, display: 'inline-block' }}>{f.n}</span>
                        : <span style={{ color: 'var(--tm)' }}>—</span>}
                    </td>
                  ))}
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{c.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Registros ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className={`btn btn-sm ${catFiltro === 'todas' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => { setCatFiltro('todas'); setMesFiltro('todos'); }}>Todas</button>
        {CATEGORIAS_AMBIENTALES.map(c => (
          <button key={c.key} className={`btn btn-sm ${catFiltro === c.key ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setCatFiltro(c.key)}>{c.label}</button>
        ))}
        {mesFiltro !== 'todos' && <span className="badge b-blue">{lblMes(mesFiltro)} <span style={{ cursor: 'pointer', marginLeft: 4 }} onClick={() => setMesFiltro('todos')}>✕</span></span>}
      </div>

      {autoCap && (autoCap.nCh > 0 || autoCap.nIn > 0) && (
        <div className="card card-p" style={{ marginBottom: 10, fontSize: 11.5, color: 'var(--ts)' }}>
          ℹ El conteo de la matriz incluye {autoCap.nCh > 0 ? `${autoCap.nCh} charla(s) ambiental(es) realizada(s)` : ''}{autoCap.nCh > 0 && autoCap.nIn > 0 ? ' y ' : ''}{autoCap.nIn > 0 ? `${autoCap.nIn} inducción(es) ambiental(es)` : ''} (se gestionan en Planificador de Charlas e Inducciones). Abajo solo se listan los registros manuales.
        </div>
      )}

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 460px)' }}>
          <table className="tbl">
            <thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th>Archivos</th></tr></thead>
            <tbody>
              {listaRegistros.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 22, color: 'var(--tm)' }}>
                  Sin evidencias {catFiltro !== 'todas' ? `de ${CAT_META[catFiltro]?.label}` : ''} {mesFiltro !== 'todos' ? `en ${lblMes(mesFiltro)}` : ''}.
                  {canW && <div style={{ marginTop: 8 }}><button className="btn btn-ghost btn-sm" onClick={() => abrirNuevo(catFiltro !== 'todas' ? catFiltro : '')}>+ Registrar la primera</button></div>}
                </td></tr>
              ) : listaRegistros.map(r => {
                const evs = evidencias.get(r.id) || [];
                return (
                  <tr key={r.id}>
                    <td className="col-m">{r.fecha}</td>
                    <td><span className="badge b-green">{CAT_META[r.categoria]?.label || r.categoria}</span></td>
                    <td style={{ maxWidth: 380, whiteSpace: 'normal', fontSize: 12.5 }}>{r.descripcion}</td>
                    <td>
                      {evs.length === 0 ? <span style={{ color: 'var(--tm)', fontSize: 11 }}>—</span>
                        : evs.map(ev => (
                          <button key={ev.id} className="btn btn-ghost btn-xs" style={{ marginRight: 4 }} onClick={() => verArchivo(ev)}>📄 {String(ev.nombre_archivo || 'archivo').slice(0, 24)}</button>
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {modal && Modal && (
        <Modal title="Registrar evidencia ambiental" icon="map" onClose={() => setModal(false)}>
          <div className="g2">
            <div>
              <label className="flabel">Categoría *</label>
              <select className="fi" value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })}>
                {CATEGORIAS_AMBIENTALES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              {CAT_META[form.categoria]?.hint && <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 3 }}>{CAT_META[form.categoria].hint}</div>}
            </div>
            <div><label className="flabel">Fecha *</label><input className="fi" type="date" value={form.fecha || ''} max={hoyLocal()} onChange={e => setForm({ ...form, fecha: e.target.value })} /></div>
            <div style={{ gridColumn: '1/-1' }}>
              <label className="flabel">Descripción *</label>
              <textarea className="fi" rows={2} value={form.descripcion || ''} onChange={e => setForm({ ...form, descripcion: e.target.value })}
                placeholder="Ej: Manifiesto de residuos peligrosos N° 0421 — EPS-RS Ecología SAC" />
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <label className="flabel">Archivos (PDF / fotos)</label>
              <input className="fi" type="file" accept="application/pdf,image/*" multiple onChange={e => setForm({ ...form, archivos: [...(e.target.files || [])] })} />
              {form.archivos?.length > 0 && <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 4 }}>{form.archivos.length} archivo(s)</div>}
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" disabled={busy} onClick={() => setModal(false)}>Cancelar</button>
            <button className="btn btn-amber" disabled={busy} onClick={guardar}><JxIcon name="check" size={13} /> {busy ? 'Guardando…' : 'Registrar'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { AmbientalPage });
