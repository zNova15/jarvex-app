// ═══════════════════════════════════════════════════════════════════
// JARVEX — Fase 2 Seguridad (SSOMA):
//  · CharlasPlanPage: planificador de charlas (compartido seguridad/ambiental/
//    social) con import desde el Excel de las ingenieras.
//  · SctrPage: SCTR por trabajador obrero — vencimiento, semáforo, evidencia.
//  · InduccionesPage: fichas de inducción (seguridad/ambiental) del personal
//    NUEVO DIRECTO (no subcontrato), con la ficha escaneada como evidencia.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { hoyLocal } from "../lib/fecha.js";
import { estadoSctr, parseCharlasExcel } from "../lib/seguridad.js";
import { esGestionableSeguridad } from "../lib/personal-categoria.js";
import { SearchableSelect } from "./jx-searchable-select.jsx";
import { getCurrentMode } from "../lib/app-mode-core.js";
const { useState: uS, useMemo: uM, useEffect: uE } = React;

const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);
const AREA_POR_ROL = { prevencionista: 'seguridad', ing_ambiental: 'ambiental', ing_social: 'social' };
const AREAS_PLAN = [
  { key: 'seguridad', label: 'Seguridad', color: '#E74C3C' },
  { key: 'ambiental', label: 'Ambiental', color: '#2ECC71' },
  { key: 'social', label: 'Social', color: '#9B59B6' },
];
const AREA_META = Object.fromEntries(AREAS_PLAN.map(a => [a.key, a]));
const EST_CHARLA = { programada: { cls: 'b-amber', lbl: 'Programada' }, realizada: { cls: 'b-green', lbl: 'Realizada' }, cancelada: { cls: 'b-gray', lbl: 'Cancelada' } };
const EST_SCTR = { sin: { cls: 'b-gray', lbl: 'Sin SCTR' }, vencido: { cls: 'b-red', lbl: '⛔ Vencido' }, por_vencer: { cls: 'b-amber', lbl: '⚠ Por vencer' }, vigente: { cls: 'b-green', lbl: '✓ Vigente' } };

function useObraActivaLocal() {
  const [obraId, setObraId] = uS(() => window.__getObraActivaId?.() || null);
  uE(() => {
    const on = () => setObraId(window.__getObraActivaId?.() || null);
    window.addEventListener('obra_activa_change', on);
    return () => window.removeEventListener('obra_activa_change', on);
  }, []);
  return obraId;
}

const syncKick = (tabla) => { try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla } })); } catch {} try { window.dispatchEvent(new Event('online')); } catch {} };
// Modo prueba: lo creado se marca demo:true y NO se pushea (patrón useOfflineData).
const esPrueba = () => getCurrentMode() === 'prueba';
const camposCreate = () => (esPrueba() ? { sync_status: 'synced', demo: true } : { sync_status: 'pending_create' });
const syncUpdate = (row) => (esPrueba() ? 'synced' : (row?.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'));
const filtraModo = (rows) => (esPrueba() ? rows.filter(r => r.demo === true) : rows.filter(r => !r.demo));
// Gate de escritura por módulo de la matriz (la página es visible con 'r').
const puedeW = (rol, modulo) => rol === 'admin' || (window.__hasPerm?.(rol, modulo, 'w') ?? false);
const ESTADOS_NO_ACTIVOS = new Set(['inactivo', 'suspendido', 'retirado', 'inhabilitado']);

// ── Planificador de Charlas ─────────────────────────────────────────
function CharlasPlanPage({ showToast }) {
  const toast = showToast || window.__showToast || (() => {});
  const auth = window.__useAuth ? window.__useAuth() : {};
  const rol = auth?.profile?.rol || '';
  const userId = auth?.profile?.id || 'offline';
  const obraId = useObraActivaLocal();
  const canW = puedeW(rol, 'Charlas Seguridad');
  const miArea = AREA_POR_ROL[rol] || null;        // especialista → su área por defecto
  const [areaFiltro, setAreaFiltro] = uS(miArea || 'todas');

  const [charlas, setCharlas] = uS([]);
  const recargar = async () => { if (!obraId) return; try { setCharlas(filtraModo(await window.__db.charlas_plan.where('obra_id').equals(obraId).filter(c => !c.deleted_at).toArray())); } catch {} };
  uE(() => {
    recargar();
    let deb; const on = (e) => { const t = e?.detail?.tabla; if (t && t !== 'charlas_plan') return; clearTimeout(deb); deb = setTimeout(recargar, 400); };
    window.addEventListener('jx_data_changed', on); window.addEventListener('jarvex_master_updated', on);
    return () => { clearTimeout(deb); window.removeEventListener('jx_data_changed', on); window.removeEventListener('jarvex_master_updated', on); };
  }, [obraId]);

  const [modal, setModal] = uS(false);
  const [editando, setEditando] = uS(null);
  const [form, setForm] = uS({});
  const [busy, setBusy] = uS(false);
  // Import Excel
  const [importPreview, setImportPreview] = uS(null); // { charlas, errores }

  const lista = uM(() => {
    let f = [...charlas];
    if (areaFiltro !== 'todas') f = f.filter(c => c.area === areaFiltro);
    return f.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  }, [charlas, areaFiltro]);
  const proximas = uM(() => lista.filter(c => c.estado === 'programada' && c.fecha >= hoyLocal()).length, [lista]);

  const abrirNueva = () => { setEditando(null); setForm({ fecha: hoyLocal(), tema: '', area: miArea || 'seguridad', expositor: '', notas: '' }); setModal(true); };
  const abrirEditar = (c) => { setEditando(c); setForm({ fecha: c.fecha, tema: c.tema, area: c.area, expositor: c.expositor || '', notas: c.notas || '' }); setModal(true); };

  const guardar = async () => {
    if (!form.tema?.trim()) { toast('Indicá el tema de la charla', 'red'); return; }
    if (!form.fecha) { toast('Indicá la fecha', 'red'); return; }
    setBusy(true);
    try {
      const now = new Date().toISOString();
      if (editando) {
        await window.__db.charlas_plan.update(editando.id, { fecha: form.fecha, tema: form.tema.trim(), area: form.area, expositor: form.expositor?.trim() || null, notas: form.notas?.trim() || null, updated_at: now, updated_by: userId, version: (editando.version ?? 0) + 1, sync_status: syncUpdate(editando) });
      } else {
        const id = window.__newId();
        await window.__db.charlas_plan.add({ id, obra_id: obraId, area: form.area, fecha: form.fecha, tema: form.tema.trim(), expositor: form.expositor?.trim() || null, estado: 'programada', notas: form.notas?.trim() || null, responsable_id: userId, created_by: userId, updated_by: userId, created_at: now, updated_at: now, version: 1, last_synced_at: null, idempotency_key: `${userId}_charplan_${id}`, ...camposCreate() });
      }
      syncKick('charlas_plan');
      toast(editando ? 'Charla actualizada' : '✓ Charla programada', 'green');
      setModal(false); recargar();
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };

  const cambiarEstado = async (c, estado) => {
    try {
      await window.__db.charlas_plan.update(c.id, { estado, updated_at: new Date().toISOString(), updated_by: userId, version: (c.version ?? 0) + 1, sync_status: syncUpdate(c) });
      syncKick('charlas_plan'); recargar();
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
  };

  const importarExcel = async (file) => {
    if (!file) return;
    try {
      const { parseExcelFile } = await import('../lib/excel.js');
      const { headers, rows } = await parseExcelFile(file);
      const res = parseCharlasExcel({ headers, rows, areaDefault: miArea || 'seguridad' });
      if (!res.charlas.length && res.errores.length) { toast(res.errores[0], 'red'); return; }
      setImportPreview(res);
    } catch (e) { toast('No se pudo leer el Excel: ' + (e.message || e), 'red'); }
  };

  const confirmarImport = async () => {
    if (!importPreview?.charlas?.length) return;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      // Dedup por contenido: re-importar el mismo Excel no duplica charlas.
      const existentes = new Set(charlas.map(c => `${c.fecha}|${String(c.tema).trim().toLowerCase()}|${c.area}`));
      let nuevas = 0, saltadas = 0;
      for (const ch of importPreview.charlas) {
        const key = `${ch.fecha}|${ch.tema.trim().toLowerCase()}|${ch.area}`;
        if (existentes.has(key)) { saltadas++; continue; }
        existentes.add(key);
        const id = window.__newId();
        await window.__db.charlas_plan.add({ id, obra_id: obraId, area: ch.area, fecha: ch.fecha, tema: ch.tema, expositor: ch.expositor, estado: 'programada', notas: ch.notas, responsable_id: userId, created_by: userId, updated_by: userId, created_at: now, updated_at: now, version: 1, last_synced_at: null, idempotency_key: `${userId}_charplan_${id}`, ...camposCreate() });
        nuevas++;
      }
      syncKick('charlas_plan');
      toast(`✓ ${nuevas} charla(s) importadas${saltadas ? ` · ${saltadas} ya existían` : ''}`, 'green');
      setImportPreview(null); recargar();
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };

  const Modal = window.Modal;
  if (!obraId) return <div className="page-wrap"><div className="empty-state"><JxIcon name="calendar" size={32} color="var(--tm)" /><p>Selecciona una obra activa.</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Planificador de Charlas</div>
          <div className="pg-sub">{proximas} charla(s) programadas próximas · seguridad, ambiental y social</div>
        </div>
        {canW ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
              <JxIcon name="upload" size={13} /> Importar Excel
              <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => { importarExcel(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            <button className="btn btn-amber btn-sm" onClick={abrirNueva}><JxIcon name="plus" size={13} /> Programar charla</button>
          </div>
        ) : <span className="badge b-gray" title="Tu rol es de solo lectura">Solo lectura</span>}
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${areaFiltro === 'todas' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setAreaFiltro('todas')}>Todas</button>
        {AREAS_PLAN.map(a => <button key={a.key} className={`btn btn-sm ${areaFiltro === a.key ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setAreaFiltro(a.key)}>{a.label}</button>)}
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 300px)' }}>
          <table className="tbl">
            <thead><tr><th>Fecha</th><th>Tema</th><th>Área</th><th>Expositor</th><th>Estado</th><th>Notas</th><th style={{ textAlign: 'center' }}>Acciones</th></tr></thead>
            <tbody>
              {lista.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 22, color: 'var(--tm)' }}>Sin charlas planificadas. Programá una o importá tu cronograma de Excel.</td></tr>
              ) : lista.map(c => {
                const am = AREA_META[c.area] || {};
                const est = EST_CHARLA[c.estado] || EST_CHARLA.programada;
                const pasada = c.estado === 'programada' && c.fecha < hoyLocal();
                return (
                  <tr key={c.id} style={pasada ? { background: 'rgba(231,76,60,0.05)' } : undefined}>
                    <td className="col-m">{c.fecha}{pasada && <div style={{ fontSize: 10, color: 'var(--red)' }}>vencida sin registrar</div>}</td>
                    <td className="col-p" style={{ maxWidth: 300, whiteSpace: 'normal' }}>{c.tema}</td>
                    <td><span className="badge" style={{ background: `${am.color}22`, color: am.color, border: `1px solid ${am.color}55` }}>{am.label || c.area}</span></td>
                    <td style={{ fontSize: 12 }}>{c.expositor || '—'}</td>
                    <td><span className={`badge ${est.cls}`}>{est.lbl}</span></td>
                    <td style={{ fontSize: 11.5, maxWidth: 220, whiteSpace: 'normal', color: 'var(--ts)' }}>{c.notas || '—'}</td>
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {canW && c.estado === 'programada' && (<>
                        <button className="btn btn-green btn-xs" title="Marcar como realizada (registrá la charla con asistentes en Charlas de 5 minutos)" onClick={() => cambiarEstado(c, 'realizada')}>✓</button>
                        <button className="btn btn-ghost btn-xs" title="Editar" onClick={() => abrirEditar(c)} style={{ marginLeft: 4 }}><JxIcon name="edit" size={11} /></button>
                        <button className="btn btn-ghost btn-xs" title="Cancelar charla" onClick={() => cambiarEstado(c, 'cancelada')} style={{ marginLeft: 4, color: 'var(--tm)' }}><JxIcon name="x" size={11} /></button>
                      </>)}
                      {c.estado === 'realizada' && (
                        <button className="btn btn-ghost btn-xs" title="Registrar la charla dictada (asistentes/firmas)" onClick={() => window.__navTo?.('charlas-seguridad')}>Registrar dictado →</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {modal && Modal && (
        <Modal title={editando ? 'Editar charla' : 'Programar charla'} icon="calendar" onClose={() => setModal(false)}>
          <div className="g2">
            <div><label className="flabel">Fecha *</label><input className="fi" type="date" value={form.fecha || ''} onChange={e => setForm({ ...form, fecha: e.target.value })} /></div>
            <div>
              <label className="flabel">Área</label>
              <select className="fi" value={form.area} onChange={e => setForm({ ...form, area: e.target.value })}>
                {AREAS_PLAN.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1/-1' }}><label className="flabel">Tema *</label><input className="fi" value={form.tema || ''} onChange={e => setForm({ ...form, tema: e.target.value })} placeholder="Ej: Trabajos en altura — uso de arnés" /></div>
            <div><label className="flabel">Expositor</label><input className="fi" value={form.expositor || ''} onChange={e => setForm({ ...form, expositor: e.target.value })} /></div>
            <div style={{ gridColumn: '1/-1' }}><label className="flabel">Notas</label><textarea className="fi" rows={2} value={form.notas || ''} onChange={e => setForm({ ...form, notas: e.target.value })} /></div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" disabled={busy} onClick={() => setModal(false)}>Cancelar</button>
            <button className="btn btn-amber" disabled={busy} onClick={guardar}><JxIcon name="check" size={13} /> {busy ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </Modal>
      )}

      {importPreview && Modal && (
        <Modal title={`Importar cronograma (${importPreview.charlas.length} charlas)`} icon="upload" onClose={() => setImportPreview(null)} wide>
          {importPreview.errores.length > 0 && (
            <div style={{ background: 'rgba(242,183,5,0.08)', border: '1px solid rgba(242,183,5,0.3)', borderRadius: 6, padding: '8px 12px', fontSize: 11.5, color: 'var(--ts)', marginBottom: 10 }}>
              ⚠ {importPreview.errores.length} fila(s) con problemas se saltarán:<br />{importPreview.errores.slice(0, 5).join(' · ')}{importPreview.errores.length > 5 ? '…' : ''}
            </div>
          )}
          <div style={{ overflowX: 'auto', maxHeight: 320, border: '1px solid var(--border)', borderRadius: 6 }}>
            <table className="tbl" style={{ fontSize: 11.5 }}>
              <thead><tr><th>Fecha</th><th>Tema</th><th>Área</th><th>Expositor</th><th>Notas</th></tr></thead>
              <tbody>{importPreview.charlas.map((c, i) => (<tr key={i}><td>{c.fecha}</td><td>{c.tema}</td><td>{AREA_META[c.area]?.label || c.area}</td><td>{c.expositor || '—'}</td><td>{c.notas || '—'}</td></tr>))}</tbody>
            </table>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" disabled={busy} onClick={() => setImportPreview(null)}>Cancelar</button>
            <button className="btn btn-amber" disabled={busy} onClick={confirmarImport}><JxIcon name="check" size={13} /> {busy ? 'Importando…' : `Importar ${importPreview.charlas.length} charla(s)`}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── SCTR del personal obrero ────────────────────────────────────────
function SctrPage({ showToast }) {
  const toast = showToast || window.__showToast || (() => {});
  const auth = window.__useAuth ? window.__useAuth() : {};
  const userId = auth?.profile?.id || 'offline';
  const obraId = useObraActivaLocal();
  const rol = auth?.profile?.rol || '';
  // SUBIR el SCTR (vencimiento/aseguradora/evidencia) lo hace SOLO la contadora
  // jefe + admin (pedido de Gabriel). La ing. de seguridad / almacenera VEN los
  // vencimientos para advertir y CREAN personal (en la página Personal), pero NO
  // suben el SCTR acá.
  const puedeSubir = rol === 'admin' || rol === 'contador';
  const { data: personal } = window.__hooks.usePersonal(obraId);
  const hoy = hoyLocal();

  // SCTR del personal en scope (Obrero + Profesionales + Subcontratos, NO "Otros")
  // DIRECTO o asegurado por la empresa (el de subcontrato con seguro a cargo del
  // subcontrato lo cubre el subcontrato; NULL='empresa' → también se lista).
  const elegibles = uM(() => (personal || []).filter(p => !p.deleted_at && esGestionableSeguridad(p) && (!p.subcontratista_id || (p.seguro_a_cargo || 'empresa') === 'empresa')), [personal]);
  const conEstado = uM(() => elegibles.map(p => ({ ...p, _sctr: estadoSctr(p.sctr_vencimiento, hoy) }))
    .sort((a, b) => ({ vencido: 0, sin: 1, por_vencer: 2, vigente: 3 }[a._sctr] - { vencido: 0, sin: 1, por_vencer: 2, vigente: 3 }[b._sctr]) || String(a.apellidos || '').localeCompare(String(b.apellidos || ''))), [elegibles, hoy]);
  // KPIs SOLO sobre personal activo (un retirado con SCTR vencido no es alerta).
  const activos = uM(() => conEstado.filter(p => !ESTADOS_NO_ACTIVOS.has(p.estado)), [conEstado]);
  const kpis = uM(() => ({
    vencidos: activos.filter(p => p._sctr === 'vencido').length,
    sin: activos.filter(p => p._sctr === 'sin').length,
    porVencer: activos.filter(p => p._sctr === 'por_vencer').length,
    vigentes: activos.filter(p => p._sctr === 'vigente').length,
  }), [activos]);

  const [editando, setEditando] = uS(null);
  const [form, setForm] = uS({});
  const [busy, setBusy] = uS(false);
  const [evidencias, setEvidencias] = uS(() => new Map());

  uE(() => {
    let cancel = false;
    (async () => {
      try {
        const evs = await window.__db.evidencias.filter(e => e.modulo_relacionado === 'personal' && e.tipo_evidencia === 'sctr' && e.registro_relacionado_id).toArray();
        if (cancel) return;
        const m = new Map();
        for (const e of evs.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))) if (!m.has(e.registro_relacionado_id)) m.set(e.registro_relacionado_id, e);
        setEvidencias(m);
      } catch {}
    })();
    return () => { cancel = true; };
  }, [personal]);

  const abrirEditar = (p) => { setEditando(p); setForm({ sctr_vencimiento: p.sctr_vencimiento || '', sctr_aseguradora: p.sctr_aseguradora || '', archivo: null }); };

  const guardar = async () => {
    if (!editando) return;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      if (!puedeSubir) { toast('Solo la Contadora Jefe o el Admin pueden subir el SCTR', 'red'); setBusy(false); return; }
      await window.__db.personal.update(editando.id, {
        sctr_vencimiento: form.sctr_vencimiento || null,
        sctr_aseguradora: form.sctr_aseguradora?.trim() || null,
        updated_at: now, updated_by: userId,
        version: (editando.version ?? 0) + 1,
        sync_status: syncUpdate(editando),
      });
      // En modo prueba no se suben archivos (la evidencia PENDING iría al bucket real).
      if (form.archivo && !esPrueba()) {
        await window.__saveEvidenciaLocal?.({
          id: window.__newId(), obra_id: editando.obra_id,
          tipo_evidencia: 'sctr', modulo_relacionado: 'personal', registro_relacionado_id: editando.id,
          nombre_archivo: form.archivo.name, mime_type: form.archivo.type, blob: form.archivo,
          fecha: hoy, observaciones: `SCTR ${editando.nombres || ''} ${editando.apellidos || ''} · vence ${form.sctr_vencimiento || '—'}`,
          created_by: userId,
        });
      }
      try { await window.__logAudit?.({ action: 'update', table: 'personal', recordId: editando.id, newData: { sctr_vencimiento: form.sctr_vencimiento, sctr_aseguradora: form.sctr_aseguradora }, reason: 'Actualización de SCTR' }); } catch {}
      syncKick('personal');
      toast('✓ SCTR actualizado', 'green');
      setEditando(null);
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };

  const verEvidencia = async (p) => {
    const ev = evidencias.get(p.id);
    if (!ev) { toast('Sin evidencia individual — el certificado del grupo está en la pestaña Documentos', 'amber'); return; }
    try {
      const { getEvidenciaSrc } = await import('../lib/evidencias-url.js');
      const src = await getEvidenciaSrc(ev);
      if (src?.url) window.open(src.url, '_blank'); else toast('Archivo no disponible', 'red');
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
  };

  // ── VENTANA "DOCUMENTOS" (pedido 21-jul): la contadora sube UN PDF del
  // trámite completo (cotización + constancia + pago + factura); la IA lo
  // clasifica por páginas, se SEPARA con pdf-lib (visibilidad por rol: la ing.
  // de seguridad SOLO ve el certificado) y se corrobora la lista de asegurados
  // contra el personal para vincular vigencia/aseguradora de un golpe. ──
  const [tab, setTab] = uS('trabajadores'); // 'trabajadores' | 'documentos'
  const [docs, setDocs] = uS([]);           // evidencias modulo 'sctr_docs' de la obra
  const [procesando, setProcesando] = uS(null); // null | texto de progreso
  const [preview, setPreview] = uS(null);   // resultado IA para corroborar antes de guardar
  const puedeVerDocs = puedeSubir || rol === 'prevencionista';

  const cargarDocs = React.useCallback(async () => {
    if (!obraId) return;
    try {
      const evs = await window.__db.evidencias.filter(e => e.modulo_relacionado === 'sctr_docs' && !e.deleted_at && e.obra_id === obraId).toArray();
      setDocs(evs.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))));
    } catch {}
  }, [obraId]);
  uE(() => { cargarDocs(); }, [cargarDocs]);
  uE(() => {
    const on = (e) => { const t = e?.detail?.tabla; if (!t || t === 'evidencias') cargarDocs(); };
    window.addEventListener('jx_data_changed', on);
    return () => window.removeEventListener('jx_data_changed', on);
  }, [cargarDocs]);

  // Paquetes agrupados (registro_relacionado_id = id del paquete subido).
  const paquetes = uM(() => {
    const m = new Map();
    for (const e of docs) { const a = m.get(e.registro_relacionado_id) || []; a.push(e); m.set(e.registro_relacionado_id, a); }
    const ORDEN = { sctr_cotizacion: 0, sctr: 1, sctr_pago: 2, sctr_factura: 3, sctr_otro: 4 };
    return [...m.entries()].map(([id, evs]) => ({
      id,
      evs: evs.sort((a, b) => (ORDEN[a.tipo_evidencia] ?? 9) - (ORDEN[b.tipo_evidencia] ?? 9)),
      fecha: evs[0]?.fecha || String(evs[0]?.created_at || '').slice(0, 10),
      resumen: evs.find(e => e.tipo_evidencia === 'sctr')?.observaciones || null,
    }));
  }, [docs]);

  const procesarPaquete = async (file) => {
    if (!file) return;
    if (esPrueba()) { toast('En modo PRUEBA no se procesan documentos reales', 'amber'); return; }
    setProcesando('Analizando con IA…');
    try {
      const { analizarPaqueteSctr, validarSecciones, matchAsegurados } = await import('../lib/sctr-paquete.js');
      const bytes = await file.arrayBuffer();
      const { PDFDocument } = await import('pdf-lib');
      const totalPaginas = (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
      const ia = await analizarPaqueteSctr(file);
      const secciones = validarSecciones(ia.secciones, totalPaginas);
      const matches = matchAsegurados(ia.certificado?.asegurados || [], personal || []);
      setPreview({
        bytes, totalPaginas, secciones,
        certificado: ia.certificado || null,
        confianza: ia.confianza || 'baja',
        advertencias: ia.advertencias || [],
        matches,
        sel: new Set(matches.filter(x => x.persona).map(x => x.persona.id)),
      });
    } catch (e) { toast('No se pudo analizar el paquete: ' + (e.message || e), 'red'); }
    finally { setProcesando(null); }
  };

  const confirmarPaquete = async () => {
    if (!preview) return;
    setProcesando('Separando y guardando…');
    try {
      const { separarPdf, TIPOS_DOC_SCTR } = await import('../lib/sctr-paquete.js');
      const partes = await separarPdf(preview.bytes, preview.secciones);
      const paqueteId = window.__newId();
      const cert = preview.certificado;
      for (const parte of partes) {
        const meta = TIPOS_DOC_SCTR[parte.tipo] || TIPOS_DOC_SCTR.otro;
        const obs = parte.tipo === 'certificado' && cert
          ? `Constancia ${cert.constancia_numero || 's/n'} · ${cert.aseguradora || 'aseguradora ¿?'} · vigencia ${cert.vigencia_desde || '¿?'} → ${cert.vigencia_hasta || '¿?'} · ${(cert.asegurados || []).length} asegurado(s)`
          : `${meta.lbl} · paquete SCTR del ${hoy}`;
        await window.__saveEvidenciaLocal?.({
          id: window.__newId(), obra_id: obraId,
          tipo_evidencia: meta.tipo_evidencia, modulo_relacionado: 'sctr_docs', registro_relacionado_id: paqueteId,
          nombre_archivo: `SCTR_${parte.tipo}_${hoy}.pdf`, mime_type: 'application/pdf', blob: parte.blob,
          fecha: hoy, observaciones: obs, created_by: userId,
        });
      }
      // Vincular vigencia/aseguradora a los trabajadores corroborados.
      let aplicados = 0;
      if (cert?.vigencia_hasta) {
        const asegTxt = [cert.aseguradora, cert.poliza_pension && `póliza ${cert.poliza_pension}`, cert.constancia_numero && `constancia ${cert.constancia_numero}`].filter(Boolean).join(' · ');
        const now = new Date().toISOString();
        for (const m of preview.matches) {
          if (!m.persona || !preview.sel.has(m.persona.id)) continue;
          await window.__db.personal.update(m.persona.id, {
            sctr_vencimiento: cert.vigencia_hasta,
            sctr_aseguradora: asegTxt || cert.aseguradora || null,
            updated_at: now, updated_by: userId,
            version: (m.persona.version ?? 0) + 1,
            sync_status: syncUpdate(m.persona),
          });
          aplicados++;
        }
      }
      try { await window.__logAudit?.({ action: 'insert', table: 'evidencias', recordId: paqueteId, reason: `Paquete SCTR procesado con IA · ${partes.length} documento(s) · ${aplicados} trabajador(es) vinculados` }); } catch {}
      syncKick('personal');
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'evidencias' } })); } catch {}
      toast(`✓ Paquete guardado (${partes.length} documentos) · ${aplicados} trabajador(es) vinculados`, 'green');
      setPreview(null);
      cargarDocs();
    } catch (e) { toast('Error guardando el paquete: ' + (e.message || e), 'red'); }
    finally { setProcesando(null); }
  };

  const verDoc = async (ev) => {
    try {
      const { getEvidenciaSrc } = await import('../lib/evidencias-url.js');
      const src = await getEvidenciaSrc(ev);
      if (src?.url) window.open(src.url, '_blank'); else toast('Archivo aún subiendo — probá en unos segundos', 'amber');
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
  };

  const Modal = window.Modal;
  if (!obraId) return <div className="page-wrap"><div className="empty-state"><JxIcon name="shield" size={32} color="var(--tm)" /><p>Selecciona una obra activa.</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">SCTR del Personal</div>
          <div className="pg-sub">Personal en obra (Obrero / Profesionales / Subcontratos) directo o asegurado por la empresa · evidencia y vencimientos{!puedeSubir ? ' · solo lectura (la Contadora Jefe sube el SCTR)' : ''}</div>
        </div>
        {puedeVerDocs && (
          <div style={{ display: 'flex', gap: 4 }}>
            <button className={`btn btn-sm ${tab === 'trabajadores' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('trabajadores')}>Trabajadores</button>
            <button className={`btn btn-sm ${tab === 'documentos' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('documentos')}>
              Documentos{paquetes.length > 0 ? ` (${paquetes.length})` : ''}
            </button>
          </div>
        )}
      </div>

      {tab === 'documentos' && puedeVerDocs && (
        <>
          {puedeSubir ? (
            <div className="card card-p" style={{ marginBottom: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 240, fontSize: 12, color: 'var(--tm)' }}>
                Subí el <strong style={{ color: 'var(--ts)' }}>PDF del trámite completo</strong> (cotización + constancia + pago + factura, todo junto):
                la IA lo separa en documentos, extrae los asegurados y la vigencia, y te deja <strong style={{ color: 'var(--ts)' }}>corroborar</strong> antes de vincular a los trabajadores.
              </div>
              <label className="btn btn-amber btn-sm" style={{ cursor: procesando ? 'wait' : 'pointer', opacity: procesando ? 0.6 : 1 }}>
                <JxIcon name="upload" size={13} /> {procesando || '✨ Subir paquete SCTR (PDF)'}
                <input type="file" accept="application/pdf" style={{ display: 'none' }} disabled={!!procesando}
                  onChange={e => { const f = e.target.files?.[0]; if (f) procesarPaquete(f); e.target.value = ''; }} />
              </label>
            </div>
          ) : (
            <div className="card card-p" style={{ marginBottom: 14, fontSize: 12, color: 'var(--tm)' }}>
              Consulta de <strong>certificados/constancias</strong> del SCTR (los demás documentos del trámite son del área contable).
            </div>
          )}
          {paquetes.length === 0 ? (
            <div className="card card-p empty-state"><JxIcon name="shield" size={32} color="var(--tm)" /><p>Aún no hay documentos de SCTR subidos.</p></div>
          ) : paquetes.map(pq => {
            const visibles = pq.evs.filter(e => puedeSubir || e.tipo_evidencia === 'sctr');
            if (!visibles.length) return null;
            return (
              <div key={pq.id} className="card card-p" style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: pq.resumen ? 4 : 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--tp)' }}>📦 Paquete del {pq.fecha || '—'}</span>
                  {visibles.map(ev => (
                    <button key={ev.id} className="btn btn-ghost btn-xs" title={`${ev.observaciones || ev.nombre_archivo} — click para ver`} onClick={() => verDoc(ev)}>
                      {ev.tipo_evidencia === 'sctr_cotizacion' ? '📋 Cotización' : ev.tipo_evidencia === 'sctr' ? '🛡️ Certificado' : ev.tipo_evidencia === 'sctr_pago' ? '💳 Pago' : ev.tipo_evidencia === 'sctr_factura' ? '🧾 Factura' : '📄 Otro'}
                      <JxIcon name="eye" size={10} />
                    </button>
                  ))}
                  {pq.evs.some(e => e.sync_status === 'pending_upload') && <span className="badge b-amber" style={{ fontSize: 9 }}>⏱ subiendo</span>}
                </div>
                {pq.resumen && <div style={{ fontSize: 11, color: 'var(--tm)' }}>{pq.resumen}</div>}
              </div>
            );
          })}
        </>
      )}

      {tab === 'trabajadores' && (<>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
        {[['VENCIDOS', kpis.vencidos, 'var(--red)'], ['SIN SCTR', kpis.sin, 'var(--tm)'], ['POR VENCER (30d)', kpis.porVencer, 'var(--amber)'], ['VIGENTES', kpis.vigentes, 'var(--green)']].map(([l, v, c], i) => (
          <div key={i} className="card card-p" style={{ borderLeft: `3px solid ${c}` }}>
            <div style={{ fontSize: 10.5, color: 'var(--tm)', letterSpacing: '.05em' }}>{l}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: c, marginTop: 4 }}>{v}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
          <table className="tbl">
            <thead><tr><th>Trabajador</th><th>Cargo</th><th>Aseguradora</th><th>Vence</th><th>Estado</th><th>Evidencia</th><th style={{ textAlign: 'center' }}>Acciones</th></tr></thead>
            <tbody>
              {conEstado.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 22, color: 'var(--tm)' }}>No hay personal en obra para SCTR.</td></tr>
              ) : conEstado.map(p => {
                const est = EST_SCTR[p._sctr];
                return (
                  <tr key={p.id} style={ESTADOS_NO_ACTIVOS.has(p.estado) ? { opacity: 0.55 } : undefined}>
                    <td className="col-p">{p.nombres} {p.apellidos}{ESTADOS_NO_ACTIVOS.has(p.estado) && <span style={{ fontSize: 10, color: 'var(--tm)' }}> · {p.estado}</span>}</td>
                    <td style={{ fontSize: 12 }}>{p.cargo || '—'}</td>
                    <td style={{ fontSize: 12 }}>{p.sctr_aseguradora || '—'}</td>
                    <td className="col-m">{p.sctr_vencimiento || '—'}</td>
                    <td><span className={`badge ${est.cls}`}>{est.lbl}</span></td>
                    <td>{evidencias.has(p.id) ? <button className="btn btn-ghost btn-xs" onClick={() => verEvidencia(p)}>📄 Ver</button> : <span style={{ color: 'var(--tm)', fontSize: 11 }}>—</span>}</td>
                    <td style={{ textAlign: 'center' }}>
                      {puedeSubir ? <button className="btn btn-amber btn-xs" onClick={() => abrirEditar(p)}><JxIcon name="edit" size={11} /> SCTR</button> : <span style={{ color: 'var(--tm)', fontSize: 11 }}>solo lectura</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      </>)}

      {/* Corroboración del paquete analizado por IA (antes de guardar nada) */}
      {preview && Modal && (
        <Modal title="✨ Corroborar paquete SCTR" icon="shield" onClose={() => !procesando && setPreview(null)} size="xl">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, fontSize: 11.5 }}>
            <span className={`badge ${preview.confianza === 'alta' ? 'b-green' : preview.confianza === 'media' ? 'b-amber' : 'b-red'}`}>confianza {preview.confianza}</span>
            <span style={{ color: 'var(--tm)' }}>{preview.totalPaginas} página(s) → {preview.secciones.length} documento(s):</span>
            {preview.secciones.map((s, i) => (
              <span key={i} className="badge b-blue" style={{ fontSize: 10 }}>
                {s.tipo} · pág. {s.desde}{s.hasta !== s.desde ? `–${s.hasta}` : ''}
              </span>
            ))}
          </div>
          {preview.advertencias.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--amber)', marginBottom: 8 }}>⚠ {preview.advertencias.join(' · ')}</div>
          )}
          {preview.certificado ? (
            <div style={{ padding: '8px 10px', background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 12, marginBottom: 10 }}>
              <strong>{preview.certificado.aseguradora || 'Aseguradora ¿?'}</strong>
              {preview.certificado.constancia_numero && <> · constancia {preview.certificado.constancia_numero}</>}
              {preview.certificado.poliza_pension && <> · póliza {preview.certificado.poliza_pension}</>}
              <span style={{ color: 'var(--green)', fontWeight: 700 }}> · vigencia {preview.certificado.vigencia_desde || '¿?'} → {preview.certificado.vigencia_hasta || '¿?'}</span>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10 }}>No se detectó la constancia/certificado en el PDF — se guardarán los documentos pero no se vinculará a nadie.</div>
          )}
          {preview.matches.length > 0 && (
            <div style={{ border: '1px solid var(--bd)', borderRadius: 6, overflow: 'auto', maxHeight: 300, marginBottom: 10 }}>
              <table className="tbl" style={{ fontSize: 12 }}>
                <thead><tr><th style={{ width: 34 }}></th><th>Asegurado (según constancia)</th><th style={{ width: 110 }}>Documento</th><th>Trabajador en JARVEX</th></tr></thead>
                <tbody>
                  {preview.matches.map((m, i) => (
                    <tr key={i}>
                      <td style={{ textAlign: 'center' }}>
                        {m.persona ? (
                          <input type="checkbox" checked={preview.sel.has(m.persona.id)}
                            onChange={() => setPreview(pv => { const sel = new Set(pv.sel); sel.has(m.persona.id) ? sel.delete(m.persona.id) : sel.add(m.persona.id); return { ...pv, sel }; })} />
                        ) : '—'}
                      </td>
                      <td>{m.asegurado.nombre}</td>
                      <td className="col-m" style={{ fontSize: 11 }}>{m.asegurado.tipo_doc} {m.asegurado.documento}</td>
                      <td style={{ fontSize: 12 }}>
                        {m.persona
                          ? <span style={{ color: 'var(--green)' }}>✓ {m.persona.nombres} {m.persona.apellidos}{m.persona.cargo ? ` (${m.persona.cargo})` : ''}</span>
                          : <span style={{ color: 'var(--amber)' }}>sin match — creá/corregí el personal y volvé a subir, o vinculalo a mano</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ fontSize: 11.5, color: 'var(--tm)', marginBottom: 6 }}>
            Al confirmar: se guardan los documentos separados en la pestaña Documentos y los trabajadores marcados quedan con vencimiento <strong>{preview.certificado?.vigencia_hasta || '—'}</strong> y su aseguradora/póliza.
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" disabled={!!procesando} onClick={() => setPreview(null)}>Cancelar</button>
            <button className="btn btn-amber" disabled={!!procesando} onClick={confirmarPaquete}>
              <JxIcon name="check" size={13} /> {procesando || `Guardar y vincular ${preview.sel.size} trabajador(es)`}
            </button>
          </div>
        </Modal>
      )}

      {editando && Modal && (
        <Modal title={`SCTR · ${editando.nombres || ''} ${editando.apellidos || ''}`} icon="shield" onClose={() => setEditando(null)}>
          <div className="g2">
            <div><label className="flabel">Vencimiento del SCTR</label><input className="fi" type="date" value={form.sctr_vencimiento || ''} onChange={e => setForm({ ...form, sctr_vencimiento: e.target.value })} /></div>
            <div><label className="flabel">Aseguradora</label><input className="fi" value={form.sctr_aseguradora || ''} onChange={e => setForm({ ...form, sctr_aseguradora: e.target.value })} placeholder="Ej: Rímac, Pacífico…" /></div>
            <div style={{ gridColumn: '1/-1' }}>
              <label className="flabel">Constancia / póliza (PDF o foto)</label>
              <input className="fi" type="file" accept="application/pdf,image/*" onChange={e => setForm({ ...form, archivo: e.target.files?.[0] || null })} />
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" disabled={busy} onClick={() => setEditando(null)}>Cancelar</button>
            <button className="btn btn-amber" disabled={busy} onClick={guardar}><JxIcon name="check" size={13} /> {busy ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Fichas de inducción (seguridad / ambiental) ─────────────────────
function InduccionesPage({ showToast }) {
  const toast = showToast || window.__showToast || (() => {});
  const auth = window.__useAuth ? window.__useAuth() : {};
  const rol = auth?.profile?.rol || '';
  const userId = auth?.profile?.id || 'offline';
  const obraId = useObraActivaLocal();
  const canW = puedeW(rol, 'Charlas Seguridad');
  const { data: personal } = window.__hooks.usePersonal(obraId);
  const tipoDefault = rol === 'ing_ambiental' ? 'ambiental' : 'seguridad';

  const [inducciones, setInducciones] = uS([]);
  const recargar = async () => { if (!obraId) return; try { setInducciones(filtraModo(await window.__db.inducciones.where('obra_id').equals(obraId).filter(i => !i.deleted_at).toArray())); } catch {} };
  uE(() => {
    recargar();
    let deb; const on = (e) => { const t = e?.detail?.tabla; if (t && t !== 'inducciones') return; clearTimeout(deb); deb = setTimeout(recargar, 400); };
    window.addEventListener('jx_data_changed', on); window.addEventListener('jarvex_master_updated', on);
    return () => { clearTimeout(deb); window.removeEventListener('jx_data_changed', on); window.removeEventListener('jarvex_master_updated', on); };
  }, [obraId]);

  // Personal DIRECTO activo (la inducción es del personal nuevo directo, no subcontrato).
  // 'Activo' estricto: estado admite inactivo/suspendido/retirado/inhabilitado.
  const directos = uM(() => (personal || []).filter(p => !p.deleted_at && !p.subcontratista_id && p.estado === 'activo'), [personal]);
  const personalById = uM(() => new Map((personal || []).map(p => [p.id, p])), [personal]);
  const inductadosPorTipo = uM(() => {
    const m = { seguridad: new Set(), ambiental: new Set() };
    for (const i of inducciones) if (m[i.tipo]) m[i.tipo].add(i.personal_id);
    return m;
  }, [inducciones]);
  const pendientes = uM(() => directos.filter(p => !inductadosPorTipo[tipoDefault].has(p.id)), [directos, inductadosPorTipo, tipoDefault]);

  const [modal, setModal] = uS(false);
  const [form, setForm] = uS({});
  const [busy, setBusy] = uS(false);

  const abrirNueva = (personalId = '') => { setForm({ personal_id: personalId, tipo: tipoDefault, fecha: hoyLocal(), observaciones: '', archivo: null }); setModal(true); };

  const guardar = async () => {
    if (!canW) { toast('Tu rol no puede registrar inducciones', 'red'); return; }
    if (!form.personal_id) { toast('Elegí al trabajador', 'red'); return; }
    if (!form.fecha) { toast('Indicá la fecha', 'red'); return; }
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const id = window.__newId();
      await window.__db.inducciones.add({ id, obra_id: obraId, personal_id: form.personal_id, tipo: form.tipo, fecha: form.fecha, observaciones: form.observaciones?.trim() || null, responsable_id: userId, created_by: userId, updated_by: userId, created_at: now, updated_at: now, version: 1, last_synced_at: null, idempotency_key: `${userId}_induc_${id}`, ...camposCreate() });
      // En modo prueba no se suben archivos (la evidencia PENDING iría al bucket real).
      if (form.archivo && !esPrueba()) {
        await window.__saveEvidenciaLocal?.({ id: window.__newId(), obra_id: obraId, tipo_evidencia: 'ficha_induccion', modulo_relacionado: 'inducciones', registro_relacionado_id: id, nombre_archivo: form.archivo.name, mime_type: form.archivo.type, blob: form.archivo, fecha: form.fecha, observaciones: `Ficha inducción ${form.tipo}`, created_by: userId });
      }
      syncKick('inducciones');
      toast('✓ Inducción registrada', 'green');
      setModal(false); recargar();
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };

  const [evidenciasInd, setEvidenciasInd] = uS(() => new Map());
  uE(() => {
    let cancel = false;
    (async () => {
      try {
        const evs = await window.__db.evidencias.filter(e => e.modulo_relacionado === 'inducciones' && e.registro_relacionado_id).toArray();
        if (!cancel) setEvidenciasInd(new Map(evs.map(e => [e.registro_relacionado_id, e])));
      } catch {}
    })();
    return () => { cancel = true; };
  }, [inducciones]);

  const verFicha = async (ind) => {
    const ev = evidenciasInd.get(ind.id);
    if (!ev) { toast('Sin ficha adjunta', 'amber'); return; }
    try {
      const { getEvidenciaSrc } = await import('../lib/evidencias-url.js');
      const src = await getEvidenciaSrc(ev);
      if (src?.url) window.open(src.url, '_blank'); else toast('Archivo no disponible', 'red');
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
  };

  const lista = uM(() => [...inducciones].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))), [inducciones]);
  const opcionesPersonal = uM(() => directos.map(p => ({ value: p.id, label: `${p.nombres || ''} ${p.apellidos || ''}`.trim() + (p.cargo ? ` · ${p.cargo}` : '') })), [directos]);

  const Modal = window.Modal;
  if (!obraId) return <div className="page-wrap"><div className="empty-state"><JxIcon name="check" size={32} color="var(--tm)" /><p>Selecciona una obra activa.</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Inducciones</div>
          <div className="pg-sub">Personal directo nuevo · ficha de inducción de seguridad y ambiental como evidencia</div>
        </div>
        {canW ? <button className="btn btn-amber btn-sm" onClick={() => abrirNueva()}><JxIcon name="plus" size={13} /> Registrar inducción</button> : <span className="badge b-gray" title="Tu rol es de solo lectura">Solo lectura</span>}
      </div>

      {pendientes.length > 0 && (
        <div className="card card-p" style={{ marginBottom: 14, background: 'rgba(242,183,5,0.07)', border: '1px solid rgba(242,183,5,0.35)' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--amber)', marginBottom: 6 }}>⚠ {pendientes.length} trabajador(es) directo(s) sin inducción de {tipoDefault}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {pendientes.slice(0, 12).map(p => (
              <button key={p.id} className="btn btn-ghost btn-xs" disabled={!canW} title={canW ? 'Registrar su inducción' : 'Solo lectura'} onClick={() => canW && abrirNueva(p.id)}>
                {p.nombres} {p.apellidos} +
              </button>
            ))}
            {pendientes.length > 12 && <span style={{ fontSize: 11, color: 'var(--tm)' }}>+{pendientes.length - 12} más</span>}
          </div>
        </div>
      )}

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 340px)' }}>
          <table className="tbl">
            <thead><tr><th>Fecha</th><th>Trabajador</th><th>Tipo</th><th>Observaciones</th><th>Ficha</th></tr></thead>
            <tbody>
              {lista.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 22, color: 'var(--tm)' }}>Sin inducciones registradas.</td></tr>
              ) : lista.map(i => {
                const p = personalById.get(i.personal_id);
                return (
                  <tr key={i.id}>
                    <td className="col-m">{i.fecha}</td>
                    <td className="col-p">{p ? `${p.nombres || ''} ${p.apellidos || ''}`.trim() : '(trabajador)'}</td>
                    <td><span className={`badge ${i.tipo === 'ambiental' ? 'b-green' : 'b-red'}`}>{i.tipo === 'ambiental' ? 'Ambiental' : 'Seguridad'}</span></td>
                    <td style={{ fontSize: 11.5, maxWidth: 260, whiteSpace: 'normal', color: 'var(--ts)' }}>{i.observaciones || '—'}</td>
                    <td>{evidenciasInd.has(i.id) ? <button className="btn btn-ghost btn-xs" onClick={() => verFicha(i)}>📄 Ver ficha</button> : <span style={{ color: 'var(--tm)', fontSize: 11 }}>—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {modal && Modal && (
        <Modal title="Registrar inducción" icon="check" onClose={() => setModal(false)}>
          <div className="g2">
            <div style={{ gridColumn: '1/-1' }}>
              <label className="flabel">Trabajador (directo) *</label>
              <SearchableSelect value={form.personal_id} onChange={v => setForm({ ...form, personal_id: v })} options={opcionesPersonal} placeholder="Buscar trabajador…" />
            </div>
            <div>
              <label className="flabel">Tipo</label>
              <select className="fi" value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>
                <option value="seguridad">Seguridad</option>
                <option value="ambiental">Ambiental</option>
              </select>
            </div>
            <div><label className="flabel">Fecha *</label><input className="fi" type="date" value={form.fecha || ''} max={hoyLocal()} onChange={e => setForm({ ...form, fecha: e.target.value })} /></div>
            <div style={{ gridColumn: '1/-1' }}>
              <label className="flabel">Ficha firmada (PDF o foto)</label>
              <input className="fi" type="file" accept="application/pdf,image/*" onChange={e => setForm({ ...form, archivo: e.target.files?.[0] || null })} />
            </div>
            <div style={{ gridColumn: '1/-1' }}><label className="flabel">Observaciones</label><textarea className="fi" rows={2} value={form.observaciones || ''} onChange={e => setForm({ ...form, observaciones: e.target.value })} /></div>
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

Object.assign(window, { CharlasPlanPage, SctrPage, InduccionesPage });
