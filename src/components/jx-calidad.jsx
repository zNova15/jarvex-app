// ═══════════════════════════════════════════════════════════════════
// JARVEX — Fase 4: Gestión de Calidad (certificados vs expediente).
//
// El expediente técnico exige specs mínimas por insumo (requisitos, importables
// desde Excel). El ing. de calidad sube el certificado PDF/foto del insumo
// comprado y la IA (api/captura-magica tipo 'certificado_calidad') lo compara
// → semáforo cumple / observado / no cumple. El ing. puede corregir el
// veredicto a mano (resultado_manual pisa a la IA). El archivo queda como
// evidencia (modulo 'calidad_certificados').
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { hoyLocal } from "../lib/fecha.js";
import { resumenCumplimiento, resultadoEfectivo, parseRequisitosExcel, claveRequisito, RESULTADOS_CERT, RESULTADO_META } from "../lib/calidad.js";
import { getCurrentMode } from "../lib/app-mode-core.js";
const { useState: uS, useMemo: uM, useEffect: uE } = React;

const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);
const syncKick = (tabla) => { try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla } })); } catch {} try { window.dispatchEvent(new Event('online')); } catch {} };
const esPrueba = () => getCurrentMode() === 'prueba';
const camposCreate = () => (esPrueba() ? { sync_status: 'synced', demo: true } : { sync_status: 'pending_create' });
const syncUpdate = (row) => (esPrueba() ? 'synced' : (row?.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'));
const filtraModo = (rows) => (esPrueba() ? rows.filter(r => r.demo === true) : rows.filter(r => !r.demo));

const Badge = ({ estado }) => {
  const m = RESULTADO_META[estado] || RESULTADO_META.sin_certificado;
  return <span className={`badge ${m.badge}`}>{m.label}</span>;
};

function useObraActivaLocal() {
  const [obraId, setObraId] = uS(() => window.__getObraActivaId?.() || null);
  uE(() => {
    const on = () => setObraId(window.__getObraActivaId?.() || null);
    window.addEventListener('obra_activa_change', on);
    return () => window.removeEventListener('obra_activa_change', on);
  }, []);
  return obraId;
}

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).replace(/^data:[^;]+;base64,/, ''));
  r.onerror = () => reject(new Error('No se pudo leer el archivo'));
  r.readAsDataURL(file);
});

function CalidadPage({ showToast }) {
  const toast = showToast || window.__showToast || (() => {});
  const auth = window.__useAuth ? window.__useAuth() : {};
  const rol = auth?.profile?.rol || '';
  const userId = auth?.profile?.id || 'offline';
  const obraId = useObraActivaLocal();
  const canW = rol === 'admin' || (window.__hasPerm?.(rol, 'Gestión Calidad', 'w') ?? false);

  const [datos, setDatos] = uS({ requisitos: [], certificados: [] });
  const recargar = async () => {
    if (!obraId) return;
    try {
      const [reqs, certs] = await Promise.all([
        window.__db.calidad_requisitos.where('obra_id').equals(obraId).filter(r => !r.deleted_at).toArray().catch(() => []),
        window.__db.calidad_certificados.where('obra_id').equals(obraId).filter(c => !c.deleted_at).toArray().catch(() => []),
      ]);
      setDatos({ requisitos: filtraModo(reqs), certificados: filtraModo(certs) });
    } catch {}
  };
  uE(() => {
    recargar();
    let deb; const on = (e) => { const t = e?.detail?.tabla; if (t && !['calidad_requisitos', 'calidad_certificados', 'evidencias'].includes(t)) return; clearTimeout(deb); deb = setTimeout(recargar, 400); };
    window.addEventListener('jx_data_changed', on); window.addEventListener('jarvex_master_updated', on);
    return () => { clearTimeout(deb); window.removeEventListener('jx_data_changed', on); window.removeEventListener('jarvex_master_updated', on); };
  }, [obraId]);

  const resumen = uM(() => resumenCumplimiento(datos.requisitos, datos.certificados), [datos]);

  const [q, setQ] = uS('');
  const [estFiltro, setEstFiltro] = uS('todos');
  const listaReqs = uM(() => {
    const nq = q.trim().toLowerCase();
    return datos.requisitos
      .filter(r => !nq || `${r.insumo_nombre} ${r.norma || ''} ${r.especificacion}`.toLowerCase().includes(nq))
      .filter(r => estFiltro === 'todos' || resumen.porRequisito.get(r.id)?.estado === estFiltro)
      .sort((a, b) => String(a.insumo_nombre).localeCompare(String(b.insumo_nombre)));
  }, [datos.requisitos, q, estFiltro, resumen]);

  // Evidencias (archivos) por certificado
  const [evidencias, setEvidencias] = uS(() => new Map());
  uE(() => {
    let cancel = false;
    (async () => {
      try {
        const evs = await window.__db.evidencias.filter(e => !e.deleted_at && e.modulo_relacionado === 'calidad_certificados' && e.registro_relacionado_id).toArray();
        if (cancel) return;
        const m = new Map();
        for (const e of evs) { const a = m.get(e.registro_relacionado_id) || []; a.push(e); m.set(e.registro_relacionado_id, a); }
        setEvidencias(m);
      } catch {}
    })();
    return () => { cancel = true; };
  }, [datos.certificados]);

  const verArchivo = async (ev) => {
    try {
      const { getEvidenciaSrc } = await import('../lib/evidencias-url.js');
      const src = await getEvidenciaSrc(ev);
      if (src?.url) window.open(src.url, '_blank'); else toast('Archivo no disponible', 'red');
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
  };

  // ── Requisito: crear / editar / eliminar ──
  const [modalReq, setModalReq] = uS(false);
  const [editReq, setEditReq] = uS(null);
  const [formReq, setFormReq] = uS({});
  const [busy, setBusy] = uS(false);
  const abrirReq = (r = null) => {
    setEditReq(r);
    setFormReq(r ? { insumo_nombre: r.insumo_nombre, norma: r.norma || '', especificacion: r.especificacion, fuente: r.fuente || '' }
      : { insumo_nombre: '', norma: '', especificacion: '', fuente: '' });
    setModalReq(true);
  };
  const guardarReq = async () => {
    if (!canW) { toast('Tu rol no puede editar requisitos', 'red'); return; }
    if (!(formReq.insumo_nombre || '').trim()) { toast('Indicá el insumo/material', 'red'); return; }
    if (!(formReq.especificacion || '').trim()) { toast('Indicá la especificación del expediente', 'red'); return; }
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const campos = {
        insumo_nombre: formReq.insumo_nombre.trim(), norma: formReq.norma?.trim() || null,
        especificacion: formReq.especificacion.trim(), fuente: formReq.fuente?.trim() || null,
        updated_at: now, updated_by: userId,
      };
      if (editReq) {
        await window.__db.calidad_requisitos.update(editReq.id, { ...campos, version: (editReq.version ?? 0) + 1, sync_status: syncUpdate(editReq) });
      } else {
        const id = window.__newId();
        await window.__db.calidad_requisitos.add({
          id, obra_id: obraId, ...campos, created_by: userId, created_at: now,
          version: 1, last_synced_at: null, idempotency_key: `${userId}_calreq_${id}`, ...camposCreate(),
        });
      }
      syncKick('calidad_requisitos');
      toast(editReq ? '✓ Requisito actualizado' : '✓ Requisito agregado', 'green');
      setModalReq(false); recargar();
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };
  const eliminarReq = async (r) => {
    if (!canW) { toast('Tu rol no puede eliminar requisitos', 'red'); return; }
    const nCerts = resumen.porRequisito.get(r.id)?.nCerts || 0;
    const ok = window.confirm(nCerts > 0
      ? `Este requisito tiene ${nCerts} certificado(s) asociado(s) que también se eliminarán de la vista. ¿Eliminar igualmente?`
      : `¿Eliminar el requisito de "${r.insumo_nombre}"?`);
    if (!ok) return;
    try {
      const now = new Date().toISOString();
      await window.__db.calidad_requisitos.update(r.id, { deleted_at: now, updated_at: now, updated_by: userId, version: (r.version ?? 0) + 1, sync_status: syncUpdate(r) });
      syncKick('calidad_requisitos');
      toast('✓ Requisito eliminado', 'green');
      if (sel?.id === r.id) setSel(null);
      recargar();
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
  };

  // ── Import Excel de requisitos ──
  const [importPreview, setImportPreview] = uS(null);
  const importarExcel = async (file) => {
    if (!file) return;
    try {
      const { parseExcelFile } = await import('../lib/excel.js');
      const { headers, rows } = await parseExcelFile(file);
      const r = parseRequisitosExcel({ headers, rows });
      const existentes = new Set(datos.requisitos.map(claveRequisito));
      const nuevos = [];
      let duplicados = 0;
      for (const req of r.requisitos) {
        const k = claveRequisito(req);
        if (existentes.has(k)) { duplicados++; continue; }
        existentes.add(k);
        nuevos.push(req);
      }
      setImportPreview({ nuevos, duplicados, errores: r.errores });
    } catch (e) { toast('No pude leer el Excel: ' + (e.message || e), 'red'); }
  };
  const confirmarImport = async () => {
    if (!canW || !importPreview?.nuevos?.length) { setImportPreview(null); return; }
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const filas = importPreview.nuevos.map(req => {
        const id = window.__newId();
        return {
          id, obra_id: obraId, ...req, created_by: userId, updated_by: userId,
          created_at: now, updated_at: now, version: 1, last_synced_at: null,
          idempotency_key: `${userId}_calreq_${id}`, ...camposCreate(),
        };
      });
      await window.__db.calidad_requisitos.bulkAdd(filas);
      syncKick('calidad_requisitos');
      toast(`✓ ${filas.length} requisito(s) importados`, 'green');
      setImportPreview(null); recargar();
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };

  // ── Detalle de un requisito + certificados ──
  const [sel, setSel] = uS(null);
  const selReq = uM(() => sel && datos.requisitos.find(r => r.id === sel.id), [sel, datos.requisitos]);
  const certsDeSel = uM(() => !selReq ? [] : datos.certificados
    .filter(c => c.requisito_id === selReq.id)
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || String(b.created_at || '').localeCompare(String(a.created_at || ''))),
    [selReq, datos.certificados]);

  // ── Certificado nuevo: subir + analizar con IA + guardar ──
  const [modalCert, setModalCert] = uS(false);
  const [formCert, setFormCert] = uS({});
  const [ia, setIa] = uS(null);          // resultado del análisis
  const [analizando, setAnalizando] = uS(false);
  const abrirCert = () => { setFormCert({ fecha: hoyLocal(), descripcion: '', proveedor: '', archivo: null, resultado_manual: '' }); setIa(null); setModalCert(true); };

  const analizarIA = async () => {
    if (!formCert.archivo) { toast('Adjuntá el certificado (PDF o foto) para analizarlo', 'red'); return; }
    setAnalizando(true); setIa(null);
    try {
      const base64 = await fileToBase64(formCert.archivo);
      const { apiFetch } = await import('../lib/api-client');
      const resp = await apiFetch('/api/captura-magica', {
        method: 'POST', timeout: 90000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file: base64, mimeType: formCert.archivo.type, tipo: 'certificado_calidad',
          requisito: { insumo: selReq.insumo_nombre, norma: selReq.norma || '', especificacion: selReq.especificacion },
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || data.detail || `HTTP ${resp.status}`);
      const ex = data.extracted || {};
      if (!RESULTADOS_CERT.includes(ex.veredicto)) ex.veredicto = 'observado';
      setIa(ex);
      if (ex.proveedor || ex.emisor) setFormCert(f => ({ ...f, proveedor: f.proveedor || ex.emisor || '' }));
    } catch (e) { toast('IA: ' + (e.message || e), 'red'); }
    finally { setAnalizando(false); }
  };

  const guardarCert = async () => {
    if (!canW) { toast('Tu rol no puede registrar certificados', 'red'); return; }
    if (!formCert.fecha) { toast('Indicá la fecha', 'red'); return; }
    if (!ia && !formCert.resultado_manual) { toast('Analizá con IA o elegí el resultado manualmente', 'red'); return; }
    // Validar tamaño ANTES de insertar nada: la evidencia rechaza >8MB y el
    // certificado ya estaría guardado sin archivo.
    if (formCert.archivo && formCert.archivo.size > 8 * 1024 * 1024) { toast('El archivo pesa más de 8 MB — comprimilo o exportá el PDF más liviano', 'red'); return; }
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const id = window.__newId();
      await window.__db.calidad_certificados.add({
        id, obra_id: obraId, requisito_id: selReq.id, fecha: formCert.fecha,
        descripcion: formCert.descripcion?.trim() || null,
        proveedor: formCert.proveedor?.trim() || null,
        resultado: ia?.veredicto || null,
        resultado_manual: formCert.resultado_manual || null,
        resumen_ia: ia?.resumen || null,
        detalle_ia: ia ? JSON.stringify({ comparacion: ia.comparacion || [], producto: ia.producto || null, normas: ia.normas_mencionadas || [], confianza: ia.confianza || null, advertencias: ia.advertencias || [], es_certificado: ia.es_certificado !== false }) : null,
        responsable_id: userId, created_by: userId, updated_by: userId,
        created_at: now, updated_at: now, version: 1, last_synced_at: null,
        idempotency_key: `${userId}_calcert_${id}`, ...camposCreate(),
      });
      // En modo prueba no se suben archivos (la evidencia PENDING iría al bucket real).
      // try/catch propio: si la evidencia falla, el certificado (ya insertado)
      // queda registrado con éxito parcial en vez de un 'Error' engañoso.
      const prueba = esPrueba();
      let evidenciaErr = null;
      if (formCert.archivo && !prueba) {
        try {
          await window.__saveEvidenciaLocal?.({
            id: window.__newId(), obra_id: obraId,
            tipo_evidencia: 'certificado_calidad', modulo_relacionado: 'calidad_certificados', registro_relacionado_id: id,
            nombre_archivo: formCert.archivo.name, mime_type: formCert.archivo.type, blob: formCert.archivo,
            fecha: formCert.fecha, observaciones: `Certificado ${selReq.insumo_nombre} · ${formCert.fecha}`,
            created_by: userId,
          });
        } catch (e) { evidenciaErr = e?.message || String(e); }
      }
      syncKick('calidad_certificados');
      if (evidenciaErr) toast(`Certificado registrado, pero el archivo no se pudo adjuntar: ${evidenciaErr}`, 'amber');
      else if (prueba && formCert.archivo) toast('✓ Certificado registrado · en modo prueba el archivo no se sube', 'amber');
      else toast('✓ Certificado registrado', 'green');
      setModalCert(false); recargar();
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };

  const overrideManual = async (cert, valor) => {
    if (!canW) { toast('Tu rol no puede corregir el veredicto', 'red'); return; }
    // Sin veredicto IA no hay a qué "volver": quitarle el manual dejaría al
    // certificado sin resultado y el requisito caería a 'Sin certificado'.
    if (!valor && !cert.resultado) { toast('Este certificado no tiene análisis IA — elegí un resultado', 'red'); return; }
    try {
      const now = new Date().toISOString();
      await window.__db.calidad_certificados.update(cert.id, {
        resultado_manual: valor || null, updated_at: now, updated_by: userId,
        version: (cert.version ?? 0) + 1, sync_status: syncUpdate(cert),
      });
      syncKick('calidad_certificados');
      recargar();
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
  };

  const [verDetalle, setVerDetalle] = uS(null); // cert con detalle_ia abierto
  const detalleParsed = uM(() => {
    if (!verDetalle?.detalle_ia) return null;
    try { return JSON.parse(verDetalle.detalle_ia); } catch { return null; }
  }, [verDetalle]);

  const Modal = window.Modal;
  if (!obraId) return <div className="page-wrap"><div className="empty-state"><JxIcon name="checkCircle" size={32} color="var(--tm)" /><p>Selecciona una obra activa.</p></div></div>;

  const kpi = resumen.kpis;
  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Gestión de Calidad</div>
          <div className="pg-sub">Requisitos del expediente técnico vs certificados de los insumos comprados · comparación con IA</div>
        </div>
        {canW ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
              <JxIcon name="upload" size={13} /> Importar Excel
              <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => { importarExcel(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            <button className="btn btn-amber btn-sm" onClick={() => abrirReq()}><JxIcon name="plus" size={13} /> Requisito</button>
          </div>
        ) : <span className="badge b-gray" title="Tu rol es de solo lectura">Solo lectura</span>}
      </div>

      {/* ── KPIs semáforo ── */}
      <div className="kpi-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
        {[['total', 'Requisitos', 'var(--tp)'], ['cumple', 'Cumplen', 'var(--green)'], ['observado', 'Observados', 'var(--amber)'], ['no_cumple', 'No cumplen', 'var(--red)'], ['sin_certificado', 'Sin certificado', 'var(--tm)']].map(([k, lbl, color]) => (
          <div key={k} className="card card-p" style={{ textAlign: 'center', cursor: k === 'total' ? 'default' : 'pointer', outline: estFiltro === k ? '1px solid var(--amber)' : 'none' }}
            onClick={() => k !== 'total' && setEstFiltro(estFiltro === k ? 'todos' : k)}>
            <div style={{ fontSize: 22, fontWeight: 800, color }}>{kpi[k]}</div>
            <div style={{ fontSize: 11, color: 'var(--ts)' }}>{lbl}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: sel ? 'minmax(0,1fr) minmax(0,1fr)' : '1fr', gap: 14 }}>
        {/* ── Requisitos ── */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--tp)' }}>Requisitos del expediente</span>
            <input className="fi" placeholder="Buscar insumo / norma…" value={q} onChange={e => setQ(e.target.value)} style={{ marginLeft: 'auto', maxWidth: 220 }} />
          </div>
          <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 360px)' }}>
            <table className="tbl">
              <thead><tr><th>Insumo</th><th>Norma</th><th>Especificación</th><th>Estado</th><th>Certs.</th>{canW && <th></th>}</tr></thead>
              <tbody>
                {listaReqs.length === 0 ? (
                  <tr><td colSpan={canW ? 6 : 5} style={{ textAlign: 'center', padding: 22, color: 'var(--tm)' }}>
                    {datos.requisitos.length === 0 ? 'Sin requisitos aún — agregalos a mano o importá el Excel del expediente.' : 'Nada que coincida con el filtro.'}
                  </td></tr>
                ) : listaReqs.map(r => {
                  const st = resumen.porRequisito.get(r.id) || { estado: 'sin_certificado', nCerts: 0 };
                  return (
                    <tr key={r.id} onClick={() => setSel({ id: r.id })} style={{ cursor: 'pointer', background: sel?.id === r.id ? 'rgba(242,183,5,0.06)' : undefined }}>
                      <td className="col-p" style={{ maxWidth: 180, whiteSpace: 'normal' }}>{r.insumo_nombre}</td>
                      <td className="col-m" style={{ fontSize: 11.5 }}>{r.norma || '—'}</td>
                      <td style={{ maxWidth: 260, whiteSpace: 'normal', fontSize: 12 }}>{r.especificacion}</td>
                      <td><Badge estado={st.estado} /></td>
                      <td style={{ textAlign: 'center' }}>{st.nCerts}</td>
                      {canW && <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-ghost btn-xs" onClick={e => { e.stopPropagation(); abrirReq(r); }}>✎</button>
                        <button className="btn btn-ghost btn-xs" onClick={e => { e.stopPropagation(); eliminarReq(r); }}>🗑</button>
                      </td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Detalle: certificados del requisito ── */}
        {sel && selReq && (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tp)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selReq.insumo_nombre}</div>
                <div style={{ fontSize: 11, color: 'var(--tm)' }}>{selReq.norma ? `${selReq.norma} · ` : ''}{selReq.fuente || 'expediente'}</div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                {canW && <button className="btn btn-amber btn-sm" onClick={abrirCert}><JxIcon name="plus" size={13} /> Certificado</button>}
                <button className="btn btn-ghost btn-sm" onClick={() => setSel(null)}>✕</button>
              </div>
            </div>
            <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--ts)', borderBottom: '1px solid var(--border)', whiteSpace: 'pre-wrap' }}>{selReq.especificacion}</div>
            <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 430px)' }}>
              <table className="tbl">
                <thead><tr><th>Fecha</th><th>Resultado</th><th>Resumen IA</th><th>Archivo</th>{canW && <th>Corregir</th>}</tr></thead>
                <tbody>
                  {certsDeSel.length === 0 ? (
                    <tr><td colSpan={canW ? 5 : 4} style={{ textAlign: 'center', padding: 20, color: 'var(--tm)' }}>
                      Sin certificados para este requisito.
                      {canW && <div style={{ marginTop: 8 }}><button className="btn btn-ghost btn-sm" onClick={abrirCert}>+ Subir el primero</button></div>}
                    </td></tr>
                  ) : certsDeSel.map(c => {
                    const evs = evidencias.get(c.id) || [];
                    const efectivo = resultadoEfectivo(c) || 'sin_certificado';
                    return (
                      <tr key={c.id}>
                        <td className="col-m">{c.fecha}{c.proveedor ? <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>{c.proveedor}</div> : null}</td>
                        <td>
                          <Badge estado={efectivo} />
                          {c.resultado_manual && c.resultado && c.resultado_manual !== c.resultado &&
                            <div style={{ fontSize: 10, color: 'var(--tm)', marginTop: 2 }}>IA dijo: {RESULTADO_META[c.resultado]?.label}</div>}
                        </td>
                        <td style={{ maxWidth: 240, whiteSpace: 'normal', fontSize: 11.5 }}>
                          {c.resumen_ia || c.descripcion || '—'}
                          {c.detalle_ia && <div><button className="btn btn-ghost btn-xs" onClick={() => setVerDetalle(c)}>ver comparación</button></div>}
                        </td>
                        <td>{evs.length === 0 ? <span style={{ color: 'var(--tm)', fontSize: 11 }}>—</span>
                          : evs.map(ev => <button key={ev.id} className="btn btn-ghost btn-xs" onClick={() => verArchivo(ev)}>📄 {String(ev.nombre_archivo || 'archivo').slice(0, 18)}</button>)}
                        </td>
                        {canW && <td>
                          <select className="fi" style={{ fontSize: 11, padding: '2px 6px' }} value={c.resultado_manual || ''} onChange={e => overrideManual(c, e.target.value)}>
                            {c.resultado ? <option value="">= IA</option> : <option value="" disabled>— sin análisis IA —</option>}
                            {RESULTADOS_CERT.map(x => <option key={x} value={x}>{RESULTADO_META[x].label}</option>)}
                          </select>
                        </td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Modal requisito ── */}
      {modalReq && Modal && (
        <Modal title={editReq ? 'Editar requisito' : 'Nuevo requisito del expediente'} icon="checkCircle" onClose={() => setModalReq(false)}>
          <div className="g2">
            <div style={{ gridColumn: '1/-1' }}><label className="flabel">Insumo / material *</label>
              <input className="fi" value={formReq.insumo_nombre || ''} onChange={e => setFormReq({ ...formReq, insumo_nombre: e.target.value })} placeholder="Ej: Cemento Portland Tipo I" /></div>
            <div><label className="flabel">Norma</label>
              <input className="fi" value={formReq.norma || ''} onChange={e => setFormReq({ ...formReq, norma: e.target.value })} placeholder="Ej: NTP 334.009" /></div>
            <div><label className="flabel">Fuente (sección del expediente)</label>
              <input className="fi" value={formReq.fuente || ''} onChange={e => setFormReq({ ...formReq, fuente: e.target.value })} placeholder="Ej: ET-03 Concreto" /></div>
            <div style={{ gridColumn: '1/-1' }}><label className="flabel">Especificación mínima *</label>
              <textarea className="fi" rows={3} value={formReq.especificacion || ''} onChange={e => setFormReq({ ...formReq, especificacion: e.target.value })}
                placeholder="Ej: Resistencia a compresión ≥ 42.5 MPa a 28 días; finura Blaine ≥ 2800 cm²/g" /></div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" disabled={busy} onClick={() => setModalReq(false)}>Cancelar</button>
            <button className="btn btn-amber" disabled={busy} onClick={guardarReq}><JxIcon name="check" size={13} /> {busy ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </Modal>
      )}

      {/* ── Modal preview de import ── */}
      {importPreview && Modal && (
        <Modal title="Importar requisitos del expediente" icon="upload" onClose={() => setImportPreview(null)}>
          <div style={{ fontSize: 12.5, color: 'var(--ts)', marginBottom: 8 }}>
            {importPreview.nuevos.length} nuevo(s){importPreview.duplicados ? ` · ${importPreview.duplicados} duplicado(s) omitido(s)` : ''}
          </div>
          {importPreview.errores.length > 0 && (
            <div className="card card-p" style={{ marginBottom: 8, border: '1px solid rgba(231,76,60,0.4)', maxHeight: 120, overflowY: 'auto' }}>
              {importPreview.errores.map((e, i) => <div key={i} style={{ fontSize: 11.5, color: 'var(--red)' }}>{e}</div>)}
            </div>
          )}
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            <table className="tbl">
              <thead><tr><th>Insumo</th><th>Norma</th><th>Especificación</th></tr></thead>
              <tbody>{importPreview.nuevos.map((r, i) => (
                <tr key={i}><td style={{ whiteSpace: 'normal' }}>{r.insumo_nombre}</td><td className="col-m">{r.norma || '—'}</td><td style={{ whiteSpace: 'normal', fontSize: 11.5 }}>{r.especificacion}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" disabled={busy} onClick={() => setImportPreview(null)}>Cancelar</button>
            <button className="btn btn-amber" disabled={busy || !importPreview.nuevos.length} onClick={confirmarImport}>
              <JxIcon name="check" size={13} /> {busy ? 'Importando…' : `Importar ${importPreview.nuevos.length}`}</button>
          </div>
        </Modal>
      )}

      {/* ── Modal certificado nuevo ── */}
      {modalCert && Modal && selReq && (
        <Modal title={`Certificado — ${selReq.insumo_nombre}`} icon="file" onClose={() => !analizando && setModalCert(false)}>
          <div className="g2">
            <div><label className="flabel">Fecha *</label>
              <input className="fi" type="date" value={formCert.fecha || ''} max={hoyLocal()} onChange={e => setFormCert({ ...formCert, fecha: e.target.value })} /></div>
            <div><label className="flabel">Proveedor / fabricante</label>
              <input className="fi" value={formCert.proveedor || ''} onChange={e => setFormCert({ ...formCert, proveedor: e.target.value })} /></div>
            <div style={{ gridColumn: '1/-1' }}><label className="flabel">Descripción</label>
              <input className="fi" value={formCert.descripcion || ''} onChange={e => setFormCert({ ...formCert, descripcion: e.target.value })} placeholder="Ej: Certificado de calidad lote 0421" /></div>
            <div style={{ gridColumn: '1/-1' }}>
              <label className="flabel">Certificado (PDF o foto)</label>
              <input className="fi" type="file" accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={e => { setFormCert({ ...formCert, archivo: e.target.files?.[0] || null }); setIa(null); }} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0' }}>
            <button className="btn btn-blue btn-sm" disabled={analizando || !formCert.archivo} onClick={analizarIA}>
              <JxIcon name="zap" size={13} /> {analizando ? 'Analizando…' : 'Analizar con IA'}
            </button>
            <span style={{ fontSize: 11, color: 'var(--tm)' }}>compara el certificado contra la especificación del expediente</span>
          </div>

          {ia && (
            <div className="card card-p" style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <Badge estado={ia.veredicto} />
                <span style={{ fontSize: 11, color: 'var(--tm)' }}>confianza {ia.confianza || '—'}{ia.es_certificado === false ? ' · ⚠ no parece un certificado' : ''}</span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ts)', marginBottom: 6 }}>{ia.resumen}</div>
              {(ia.comparacion || []).length > 0 && (
                <table className="tbl" style={{ fontSize: 11.5 }}>
                  <thead><tr><th>Exigencia</th><th>Certificado</th><th>¿Cumple?</th></tr></thead>
                  <tbody>{ia.comparacion.map((x, i) => (
                    <tr key={i}>
                      <td style={{ whiteSpace: 'normal' }}>{x.exigencia}</td>
                      <td style={{ whiteSpace: 'normal' }}>{x.valor_certificado || '—'}{x.comentario ? <div style={{ color: 'var(--tm)', fontSize: 10.5 }}>{x.comentario}</div> : null}</td>
                      <td>{x.cumple === 'si' ? '✅' : x.cumple === 'no' ? '❌' : '❔'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
              {(ia.advertencias || []).length > 0 && <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 6 }}>⚠ {ia.advertencias.join(' · ')}</div>}
            </div>
          )}

          <div className="g2">
            <div>
              <label className="flabel">Resultado manual {ia ? '(opcional — pisa a la IA)' : '(si no usás la IA)'}</label>
              <select className="fi" value={formCert.resultado_manual || ''} onChange={e => setFormCert({ ...formCert, resultado_manual: e.target.value })}>
                <option value="">{ia ? `Usar veredicto IA (${RESULTADO_META[ia.veredicto]?.label})` : '— elegir —'}</option>
                {RESULTADOS_CERT.map(x => <option key={x} value={x}>{RESULTADO_META[x].label}</option>)}
              </select>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" disabled={busy || analizando} onClick={() => setModalCert(false)}>Cancelar</button>
            <button className="btn btn-amber" disabled={busy || analizando} onClick={guardarCert}><JxIcon name="check" size={13} /> {busy ? 'Guardando…' : 'Registrar'}</button>
          </div>
        </Modal>
      )}

      {/* ── Modal detalle IA de un certificado guardado ── */}
      {verDetalle && Modal && (
        <Modal title="Comparación IA" icon="zap" onClose={() => setVerDetalle(null)}>
          {!detalleParsed ? <div style={{ color: 'var(--tm)', fontSize: 12 }}>Sin detalle guardado.</div> : (
            <div>
              <div style={{ fontSize: 12, color: 'var(--ts)', marginBottom: 6 }}>
                {detalleParsed.producto ? `Producto: ${detalleParsed.producto} · ` : ''}confianza {detalleParsed.confianza || '—'}
                {detalleParsed.es_certificado === false ? ' · ⚠ el documento no parecía un certificado' : ''}
              </div>
              {verDetalle.resumen_ia && <div style={{ fontSize: 12.5, color: 'var(--ts)', marginBottom: 8 }}>{verDetalle.resumen_ia}</div>}
              <table className="tbl" style={{ fontSize: 11.5 }}>
                <thead><tr><th>Exigencia</th><th>Certificado</th><th>¿Cumple?</th></tr></thead>
                <tbody>{(detalleParsed.comparacion || []).map((x, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: 'normal' }}>{x.exigencia}</td>
                    <td style={{ whiteSpace: 'normal' }}>{x.valor_certificado || '—'}{x.comentario ? <div style={{ color: 'var(--tm)', fontSize: 10.5 }}>{x.comentario}</div> : null}</td>
                    <td>{x.cumple === 'si' ? '✅' : x.cumple === 'no' ? '❌' : '❔'}</td>
                  </tr>
                ))}</tbody>
              </table>
              {(detalleParsed.advertencias || []).length > 0 && <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 6 }}>⚠ {detalleParsed.advertencias.join(' · ')}</div>}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { CalidadPage });
