import React from "react";
import { puedeVerEvidencia, TIPOS_CONTABLES as TIPOS_CONTABLES_LIB } from "../lib/evidencias-visibilidad.js";
const { useState: uSE, useMemo: uME, useEffect: uEE, useRef: uRE, useCallback: uCB } = React;

// ─── CONFIG ─────────────────────────────────────────────
const TIPO_META = {
  foto_asistencia:        { lbl:'Foto Asistencia',   cls:'b-blue',   cat:'asistencia',  icon:'camera' },
  foto_avance:            { lbl:'Foto de Avance',    cls:'b-green',  cat:'avance',      icon:'camera' },
  foto_sin_avance:        { lbl:'Sin Avance',        cls:'b-amber',  cat:'avance',      icon:'camera' },
  recibo_honorarios:      { lbl:'Recibo x Honorarios', cls:'b-orange', cat:'documentos', icon:'file' },
  pago_evidencia:         { lbl:'Constancia de Pago',  cls:'b-orange', cat:'documentos', icon:'dollar' },
  guia_remision:          { lbl:'Guía de Remisión',  cls:'b-amber',  cat:'materiales',  icon:'truck'  },
  factura:                { lbl:'Factura',           cls:'b-orange', cat:'materiales',  icon:'file'   },
  comprobante_captura:    { lbl:'Comprobante',       cls:'b-orange', cat:'documentos',  icon:'file'   },
  bancarizacion:          { lbl:'Bancarización',     cls:'b-orange', cat:'documentos',  icon:'dollar' },
  pdf_formato_firmado:    { lbl:'Formato Firmado',   cls:'b-blue',   cat:'documentos',  icon:'clipboard' },
  foto_herramienta_danada:{ lbl:'Herr. Dañada',      cls:'b-red',    cat:'herramientas',icon:'tool'   },
  foto_herramienta:       { lbl:'Foto Herramienta',  cls:'b-blue',   cat:'herramientas',icon:'tool'   },
  foto_estado:            { lbl:'Estado de Herr.',   cls:'b-blue',   cat:'herramientas',icon:'tool'   },
  foto_material:          { lbl:'Foto de Material',  cls:'b-green',  cat:'materiales',  icon:'camera' },
  registro_diario_materiales: { lbl:'Registro Diario', cls:'b-blue', cat:'materiales',  icon:'clipboard' },
  foto_epp:               { lbl:'Foto EPP',          cls:'b-amber',  cat:'documentos',  icon:'camera' },
  firma_epp:              { lbl:'Firma EPP',         cls:'b-amber',  cat:'documentos',  icon:'clipboard' },
  sctr:                   { lbl:'SCTR (certificado)', cls:'b-red',   cat:'documentos',  icon:'file'   },
  sctr_cotizacion:        { lbl:'SCTR · Cotización', cls:'b-orange', cat:'documentos',  icon:'file'   },
  sctr_pago:              { lbl:'SCTR · Pago',       cls:'b-orange', cat:'documentos',  icon:'dollar' },
  sctr_factura:           { lbl:'SCTR · Factura',    cls:'b-orange', cat:'documentos',  icon:'file'   },
  sctr_otro:              { lbl:'SCTR · Otro',       cls:'b-gray',   cat:'documentos',  icon:'file'   },
  ficha_induccion:        { lbl:'Ficha Inducción',   cls:'b-red',    cat:'documentos',  icon:'clipboard' },
  foto_especialidad:      { lbl:'Reporte Especialidad', cls:'b-purple', cat:'documentos', icon:'camera' },
  evidencia_ambiental:    { lbl:'Ambiental',         cls:'b-green',  cat:'documentos',  icon:'camera' },
  certificado_calidad:    { lbl:'Cert. Calidad',     cls:'b-blue',   cat:'documentos',  icon:'file'   },
  movimiento_maquinaria:  { lbl:'Maquinaria',        cls:'b-gray',   cat:'documentos',  icon:'camera' },
  oc_firmada:             { lbl:'OC Firmada',        cls:'b-orange', cat:'documentos',  icon:'clipboard' },
  acta:                   { lbl:'Acta',              cls:'b-gray',   cat:'documentos',  icon:'file'   },
  documento_general:      { lbl:'Documento',         cls:'b-gray',   cat:'documentos',  icon:'file'   },
};

const CATS = [
  { id:'todos',       lbl:'Todos'        },
  { id:'asistencia',  lbl:'Asistencia'   },
  { id:'avance',      lbl:'Avance'       },
  { id:'materiales',  lbl:'Materiales'   },
  { id:'herramientas',lbl:'Herramientas' },
  { id:'documentos',  lbl:'Documentos'   },
];

const MAX_BYTES = 8 * 1024 * 1024;

// ─── HELPERS ────────────────────────────────────────────
function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatFecha(f) {
  if (!f) return '—';
  try {
    const d = new Date(f);
    if (isNaN(d.getTime())) return f;
    return d.toLocaleDateString('es-PE', { day:'2-digit', month:'2-digit', year:'numeric' });
  } catch { return f; }
}

function pathFromUrl(url) {
  if (!url) return null;
  const idx = url.indexOf('/evidencias/');
  if (idx === -1) return null;
  return url.slice(idx + '/evidencias/'.length);
}

const SYNC_BADGE = {
  uploaded:       { cls:'b-green',  lbl:'✓ Subido'    },
  // 'synced' = registro bajado de otro dispositivo por el SyncEngine (que
  // estampa ese valor al pullear) — con URL presente, el archivo está subido.
  synced:         { cls:'b-green',  lbl:'✓ Subido'    },
  pending_upload: { cls:'b-amber',  lbl:'⏱ Pendiente' },
  failed:         { cls:'b-red',    lbl:'⚠ Falló'     },
};

// Badge HONESTO: "✓ Subido" solo si de verdad hay archivo en el server. Una fila
// 'uploaded'/'synced' con url_archivo=null NO está realmente subida (el blob no
// llegó al Storage o la metadata entró sin url) → mostrarlo como subido engaña a
// contabilidad. En ese caso avisamos "⚠ Sin archivo".
function syncBadgeDe(ev) {
  const st = ev?.sync_status;
  if ((st === 'uploaded' || st === 'synced') && !ev?.url_archivo) {
    return { cls:'b-red', lbl:'⚠ Sin archivo' };
  }
  return SYNC_BADGE[st] || SYNC_BADGE.pending_upload;
}

// ─── THUMBNAIL ──────────────────────────────────────────
function Thumb({ ev, signedRef, blobUrlRef, onClick }) {
  const [src, setSrc] = uSE(null);
  const [err, setErr] = uSE(false);
  const isImg = (ev.mime_type || '').startsWith('image/');
  const isPdf = (ev.mime_type || '').includes('pdf');

  uEE(() => {
    let cancelled = false;
    async function load() {
      if (!isImg) return;
      try {
        if ((ev.sync_status === 'uploaded' || ev.sync_status === 'synced') && ev.url_archivo) {
          if (signedRef.current[ev.id]) {
            setSrc(signedRef.current[ev.id]);
            return;
          }
          const path = pathFromUrl(ev.url_archivo);
          if (!path) { setErr(true); return; }
          const { data, error } = await window.__supabase
            .storage.from('evidencias').createSignedUrl(path, 3600);
          if (error || cancelled) { if (!cancelled) setErr(true); return; }
          signedRef.current[ev.id] = data.signedUrl;
          setSrc(data.signedUrl);
        } else if (ev.sync_status === 'pending_upload') {
          if (blobUrlRef.current[ev.id]) {
            setSrc(blobUrlRef.current[ev.id]);
            return;
          }
          const entry = await window.__db.evidencias_blobs.get(ev.id);
          if (cancelled) return;
          if (!entry?.blob) { setErr(true); return; }
          const url = URL.createObjectURL(entry.blob);
          blobUrlRef.current[ev.id] = url;
          setSrc(url);
        }
      } catch {
        if (!cancelled) setErr(true);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [ev.id, ev.sync_status, ev.url_archivo, isImg]);

  const baseStyle = {
    width:'100%', height:160, borderRadius:'10px 10px 0 0',
    background:'var(--bg-elev)', display:'flex', alignItems:'center', justifyContent:'center',
    overflow:'hidden', cursor:'pointer', position:'relative', flexDirection:'column', gap:6,
    borderBottom:'1px solid var(--border)',
  };

  if (isImg && src && !err) {
    return (
      <div style={baseStyle} onClick={onClick}>
        <img src={src} alt={ev.nombre_archivo}
             style={{ width:'100%', height:'100%', objectFit:'cover' }}
             onError={()=>setErr(true)}/>
      </div>
    );
  }
  if (isImg && !src && !err) {
    return <div style={baseStyle}><JxIcon name="image" size={32} color="var(--tm)"/><span style={{fontSize:10,color:'var(--tm)'}}>Cargando…</span></div>;
  }
  if (isPdf) {
    return (
      <div style={baseStyle} onClick={onClick}>
        <JxIcon name="file" size={48} color="var(--red)"/>
        <span style={{fontSize:11, fontWeight:700, color:'var(--red)', letterSpacing:.05}}>PDF</span>
      </div>
    );
  }
  return (
    <div style={baseStyle} onClick={onClick}>
      <JxIcon name="file" size={48} color="var(--tm)"/>
      <span style={{fontSize:10, color:'var(--tm)'}}>{(ev.mime_type||'archivo').split('/').pop()}</span>
    </div>
  );
}

// ─── EVIDENCIAS PAGE ────────────────────────────────────
// Visibilidad por ROL (pedido 20-jul-2026): cada rol ve SOLO lo pertinente a
// su función — el almacenero lo de almacén/EPP/asistencia, cada especialista
// lo suyo, y lo CONTABLE (facturas, comprobantes, bancarización y AHORA
// también guías de remisión) únicamente contabilidad + admin. La matriz vive
// en lib/evidencias-visibilidad (espejo del RLS del server, migs 136 + 143);
// acá se filtra también lo que ya quedó cacheado en el IndexedDB local.
const TIPOS_CONTABLES = new Set(TIPOS_CONTABLES_LIB);

function EvidenciasPage({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const myRol = auth?.profile?.rol;
  const myId = auth?.profile?.id || null;
  const isAdmin = myRol === 'admin';
  const canWrite = isAdmin || (window.__hasPerm?.(myRol, 'Evidencias', 'w') ?? false);
  const puedeVerContable = isAdmin || myRol === 'contador' || myRol === 'ayudante_contador';
  const [obraId, setObraId] = uSE(null);

  // Detectar obra activa
  uEE(() => {
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

  const { data: evidencias, loading, refresh } = window.__hooks.useEvidencias(obraId);

  const [q, setQ]         = uSE('');
  const [cat, setCat]     = uSE('todos');
  const [tipoF, setTipoF] = uSE('todos');   // filtro fino por TIPO de evidencia (pedido 20-jul)
  const [modal, setModal] = uSE(false);
  const [plantillasOpen, setPlantillasOpen] = uSE(false);
  const [light, setLight] = uSE(null); // evidencia seleccionada

  // Refs para URLs
  const signedRef  = uRE({}); // id → signedUrl
  const blobUrlRef = uRE({}); // id → object URL

  // Cleanup blob URLs on unmount
  uEE(() => () => {
    Object.values(blobUrlRef.current).forEach(u => {
      try { URL.revokeObjectURL(u); } catch {}
    });
    blobUrlRef.current = {};
  }, []);

  // Visibles según el rol: cada rol ve solo lo de su función y lo contable
  // queda FUERA para quien no corresponde (antes de stats y de filtered, así
  // ni el contador de totales lo delata). El autor siempre ve lo suyo.
  const visibles = uME(() => evidencias.filter(e =>
    puedeVerEvidencia({ rol: myRol, userId: myId, ev: e })
  ), [evidencias, myRol, myId]);

  const stats = uME(() => {
    const total = visibles.length;
    const pendientes = visibles.filter(e => e.sync_status === 'pending_upload').length;
    return { total, pendientes };
  }, [visibles]);

  // Tipos presentes en lo VISIBLE para este rol, con conteo (ordena la galería:
  // p. ej. filtrar solo "Firma EPP" cuando hay decenas de firmas mezcladas).
  const tiposDisponibles = uME(() => {
    const m = new Map();
    for (const e of visibles) m.set(e.tipo_evidencia, (m.get(e.tipo_evidencia) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [visibles]);

  const filtered = uME(() => {
    return visibles
      .slice()
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      .filter(e => {
        const meta = TIPO_META[e.tipo_evidencia] || TIPO_META.documento_general;
        const matchCat = cat === 'todos' || meta.cat === cat;
        const matchTipo = tipoF === 'todos' || e.tipo_evidencia === tipoF;
        const matchQ = !q || (e.nombre_archivo||'').toLowerCase().includes(q.toLowerCase())
                          || (e.observaciones||'').toLowerCase().includes(q.toLowerCase());
        return matchCat && matchTipo && matchQ;
      });
  }, [visibles, cat, tipoF, q]);

  if (!obraId) return <SinObraEmpty icon="image"/>;
  if (loading) {
    return <div className="page-wrap"><div className="empty-state"><JxIcon name="image" size={32} color="var(--tm)"/><p>Cargando evidencias…</p></div></div>;
  }

  return (
    <div className="page-wrap">
      {/* Header */}
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Evidencias</div>
          <div className="pg-sub">{stats.total} archivos · {stats.pendientes} pendientes de subir</div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-ghost btn-sm" onClick={()=>setPlantillasOpen(true)}>
            <JxIcon name="fileText" size={13}/>Plantillas
          </button>
          {canWrite ? (
            <button className="btn btn-amber btn-sm" onClick={()=>setModal(true)}>
              <JxIcon name="upload" size={13}/>Subir Archivo
            </button>
          ) : (
            <span className="badge b-gray" title="Tu rol es solo lectura para Evidencias">Solo lectura</span>
          )}
        </div>
      </div>

      {/* Filters */}
      <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap', alignItems:'center' }}>
        {CATS.map(c => (
          <button key={c.id}
                  className={`btn ${cat === c.id ? 'btn-amber' : 'btn-ghost btn-sm'}`}
                  onClick={()=>setCat(c.id)}>
            {c.lbl}
          </button>
        ))}
        {/* Filtro FINO por tipo exacto (con conteo) — ordena galerías con
            muchos archivos del mismo tipo (p. ej. decenas de firmas EPP). */}
        <select className="fi" value={tipoF} onChange={e=>setTipoF(e.target.value)}
          style={{ minWidth:170, maxWidth:240 }} title="Filtrar por el tipo exacto de evidencia">
          <option value="todos">Tipo: todos</option>
          {tiposDisponibles.map(([t, n]) => (
            <option key={t} value={t}>{(TIPO_META[t]?.lbl || t)} ({n})</option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom:16 }}>
        <div className="search-bar">
          <JxIcon name="search" size={14} color="var(--tm)"/>
          <input placeholder="Buscar por nombre de archivo u observación…"
                 value={q} onChange={e=>setQ(e.target.value)}/>
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="image" size={40} color="var(--tm)"/>
          <p>{visibles.length === 0
                ? 'Aún no hay evidencias registradas. Click en "Subir Archivo" para comenzar.'
                : 'No se encontraron evidencias con los filtros aplicados.'}</p>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:14 }}>
          {filtered.map(ev => {
            const meta = TIPO_META[ev.tipo_evidencia] || TIPO_META.documento_general;
            const sync = syncBadgeDe(ev);
            const isPdf = (ev.mime_type || '').includes('pdf');
            const handleThumbClick = () => {
              if ((ev.mime_type||'').startsWith('image/')) {
                setLight(ev);
              } else if (isPdf) {
                if (ev.url_archivo) {
                  const path = pathFromUrl(ev.url_archivo);
                  if (path) {
                    window.__supabase.storage.from('evidencias').createSignedUrl(path, 3600)
                      .then(({ data }) => { if (data?.signedUrl) window.open(data.signedUrl, '_blank'); });
                    return;
                  }
                  window.open(ev.url_archivo, '_blank');
                } else {
                  // pendiente: abrir blob local
                  window.__db.evidencias_blobs.get(ev.id).then(entry => {
                    if (entry?.blob) {
                      const url = URL.createObjectURL(entry.blob);
                      window.open(url, '_blank');
                    }
                  });
                }
              }
            };
            return (
              <div key={ev.id} className="card card-hover" style={{ padding:0, overflow:'hidden', display:'flex', flexDirection:'column' }}>
                <Thumb ev={ev} signedRef={signedRef} blobUrlRef={blobUrlRef} onClick={handleThumbClick}/>
                <div style={{ padding:'10px 12px', display:'flex', flexDirection:'column', gap:6 }}>
                  <div style={{ fontSize:12.5, fontWeight:600, color:'var(--tp)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}
                       title={ev.nombre_archivo}>
                    {ev.nombre_archivo}
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--tm)' }}>
                    <span>{formatSize(ev.tamano_bytes)}</span>
                    <span>{formatFecha(ev.fecha)}</span>
                  </div>
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:2 }}>
                    <span className={`badge ${meta.cls}`} style={{ fontSize:10 }}>{meta.lbl}</span>
                    <span className={`badge ${sync.cls}`} style={{ fontSize:10 }}>{sync.lbl}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload modal */}
      {modal && (
        <UploadModal
          obraId={obraId}
          onClose={()=>setModal(false)}
          onSaved={()=>{ refresh(); showToast?.('Evidencia guardada localmente · se subirá al sincronizar', 'green'); setModal(false); }}
          showToast={showToast}
        />
      )}

      {/* Plantillas modal */}
      {plantillasOpen && (
        <PlantillasModal
          obraId={obraId}
          onClose={()=>setPlantillasOpen(false)}
          showToast={showToast}
        />
      )}

      {/* Lightbox */}
      {light && (
        <Lightbox
          ev={light}
          signedRef={signedRef}
          blobUrlRef={blobUrlRef}
          onClose={()=>setLight(null)}
        />
      )}
    </div>
  );
}

// ─── UPLOAD MODAL ───────────────────────────────────────
function UploadModal({ obraId, onClose, onSaved, showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : { user: null };
  const userId = auth?.user?.id || auth?.profile?.id || null;

  const [file, setFile]     = uSE(null);
  const [preview, setPreview] = uSE(null);
  const [tipo, setTipo]     = uSE('documento_general');
  const [fecha, setFecha]   = uSE(new Date().toISOString().slice(0,10));
  const [obs, setObs]       = uSE('');
  const [drag, setDrag]     = uSE(false);
  const [busy, setBusy]     = uSE(false);
  const inputRef = uRE(null);

  uEE(() => () => { if (preview) try { URL.revokeObjectURL(preview); } catch {} }, [preview]);

  const setFileSafe = (f) => {
    if (!f) return;
    if (f.size > MAX_BYTES) {
      showToast?.(`Archivo muy grande (${(f.size/1024/1024).toFixed(1)} MB). Máximo 8 MB.`, 'red');
      return;
    }
    setFile(f);
    if (f.type?.startsWith('image/')) {
      if (preview) try { URL.revokeObjectURL(preview); } catch {}
      setPreview(URL.createObjectURL(f));
    } else {
      setPreview(null);
    }
    // Sugerir tipo
    if (f.type?.includes('pdf') && tipo === 'documento_general') setTipo('pdf_formato_firmado');
    if (f.type?.startsWith('image/') && tipo === 'documento_general') setTipo('foto_avance');
  };

  const handleDrop = (e) => {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files?.[0];
    setFileSafe(f);
  };

  const handleSubmit = async () => {
    if (!file) { showToast?.('Selecciona un archivo', 'red'); return; }
    if (!obraId) { showToast?.('No hay obra activa', 'red'); return; }
    setBusy(true);
    try {
      const meta = TIPO_META[tipo] || TIPO_META.documento_general;
      await window.__saveEvidenciaLocal({
        id: window.__newId(),
        obra_id: obraId,
        tipo_evidencia: tipo,
        modulo_relacionado: meta.cat,
        registro_relacionado_id: null,
        nombre_archivo: file.name,
        mime_type: file.type || 'application/octet-stream',
        blob: file,
        fecha,
        created_by: userId,
        observaciones: obs || null,
      });
      onSaved?.();
    } catch (e) {
      showToast?.('Error: ' + e.message, 'red');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Subir Nueva Evidencia" icon="upload" onClose={onClose}>
      {/* Drop area */}
      <div
        onClick={()=>inputRef.current?.click()}
        onDragOver={e=>{e.preventDefault(); setDrag(true);}}
        onDragLeave={()=>setDrag(false)}
        onDrop={handleDrop}
        style={{
          border:`2px dashed ${drag ? 'var(--amber)' : 'var(--border-h)'}`,
          borderRadius:10, padding:'24px 20px', textAlign:'center',
          color:'var(--tm)', cursor:'pointer', transition:'all .15s',
          background: drag ? 'rgba(242,183,5,0.06)' : 'transparent',
        }}>
        {preview ? (
          <img src={preview} alt="preview" style={{ maxHeight:180, maxWidth:'100%', borderRadius:8 }}/>
        ) : file ? (
          <div>
            <JxIcon name="file" size={28} color="var(--amber)"/>
            <div style={{ marginTop:8, fontSize:13, fontWeight:600, color:'var(--tp)' }}>{file.name}</div>
            <div style={{ marginTop:4, fontSize:11 }}>{formatSize(file.size)} · {file.type || 'archivo'}</div>
          </div>
        ) : (
          <>
            <JxIcon name="upload" size={28} color="var(--tm)"/>
            <div style={{ marginTop:8, fontSize:13, fontWeight:500 }}>Arrastra un archivo aquí o haz clic</div>
            <div style={{ marginTop:4, fontSize:11 }}>JPG, PNG, PDF — Máx. 8 MB</div>
          </>
        )}
        <input ref={inputRef} type="file" accept="image/*,application/pdf"
               onChange={e=>setFileSafe(e.target.files?.[0])}
               style={{ display:'none' }}/>
      </div>

      <div className="g2" style={{ marginTop:14 }}>
        <div>
          <label className="flabel">Tipo de Evidencia</label>
          <select className="fi" value={tipo} onChange={e=>setTipo(e.target.value)}>
            {Object.entries(TIPO_META).map(([k,v]) => <option key={k} value={k}>{v.lbl}</option>)}
          </select>
        </div>
        <div>
          <label className="flabel">Fecha</label>
          <input className="fi" type="date" value={fecha} onChange={e=>setFecha(e.target.value)}/>
        </div>
      </div>

      <div style={{ marginTop:12 }}>
        <label className="flabel">Observaciones</label>
        <textarea className="fi" value={obs} onChange={e=>setObs(e.target.value)}
                  placeholder="Descripción de la evidencia (opcional)…"/>
      </div>

      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn btn-amber" onClick={handleSubmit} disabled={busy || !file}>
          <JxIcon name="upload" size={13}/>{busy ? 'Guardando…' : 'Guardar Evidencia'}
        </button>
      </div>
    </Modal>
  );
}

// ─── LIGHTBOX ───────────────────────────────────────────
function Lightbox({ ev, signedRef, blobUrlRef, onClose }) {
  const [src, setSrc] = uSE(null);

  uEE(() => {
    let cancelled = false;
    async function load() {
      try {
        if ((ev.sync_status === 'uploaded' || ev.sync_status === 'synced') && ev.url_archivo) {
          if (signedRef.current[ev.id]) { setSrc(signedRef.current[ev.id]); return; }
          const path = pathFromUrl(ev.url_archivo);
          if (!path) return;
          const { data } = await window.__supabase
            .storage.from('evidencias').createSignedUrl(path, 3600);
          if (cancelled || !data?.signedUrl) return;
          signedRef.current[ev.id] = data.signedUrl;
          setSrc(data.signedUrl);
        } else {
          if (blobUrlRef.current[ev.id]) { setSrc(blobUrlRef.current[ev.id]); return; }
          const entry = await window.__db.evidencias_blobs.get(ev.id);
          if (cancelled || !entry?.blob) return;
          const url = URL.createObjectURL(entry.blob);
          blobUrlRef.current[ev.id] = url;
          setSrc(url);
        }
      } catch {}
    }
    load();
    return () => { cancelled = true; };
  }, [ev.id]);

  const handleDownload = () => {
    if (!src) return;
    const a = document.createElement('a');
    a.href = src;
    a.download = ev.nombre_archivo || 'evidencia';
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const meta = TIPO_META[ev.tipo_evidencia] || TIPO_META.documento_general;

  return (
    <div
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position:'fixed', inset:0, background:'rgba(0,0,0,0.95)', zIndex:9999,
        display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
        padding:'40px 20px',
      }}>
      {/* Top bar */}
      <div style={{ position:'absolute', top:16, right:16, display:'flex', gap:8 }}>
        <button onClick={handleDownload}
                style={{ background:'rgba(255,255,255,0.12)', color:'white', border:'1px solid rgba(255,255,255,0.2)',
                         borderRadius:8, padding:'8px 14px', cursor:'pointer', display:'flex', alignItems:'center', gap:6, fontSize:13 }}>
          <JxIcon name="download" size={14} color="white"/> Descargar
        </button>
        <button onClick={onClose}
                style={{ background:'rgba(255,255,255,0.12)', color:'white', border:'1px solid rgba(255,255,255,0.2)',
                         borderRadius:8, width:38, height:38, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <JxIcon name="x" size={16} color="white"/>
        </button>
      </div>

      {/* Image */}
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', maxWidth:'90vw', maxHeight:'80vh', overflow:'hidden' }}>
        {src ? (
          <img src={src} alt={ev.nombre_archivo}
               style={{ maxWidth:'90vw', maxHeight:'80vh', objectFit:'contain', borderRadius:8 }}/>
        ) : (
          <div style={{ color:'rgba(255,255,255,0.6)', fontSize:14 }}>Cargando…</div>
        )}
      </div>

      {/* Info */}
      <div style={{ marginTop:18, color:'white', textAlign:'center', maxWidth:'80vw' }}>
        <div style={{ fontSize:15, fontWeight:600 }}>{ev.nombre_archivo}</div>
        <div style={{ marginTop:6, fontSize:12, color:'rgba(255,255,255,0.65)', display:'flex', justifyContent:'center', gap:14, flexWrap:'wrap' }}>
          <span>{formatFecha(ev.fecha)}</span>
          <span className={`badge ${meta.cls}`} style={{ fontSize:10 }}>{meta.lbl}</span>
          <span>{formatSize(ev.tamano_bytes)}</span>
        </div>
        {ev.observaciones && (
          <div style={{ marginTop:10, fontSize:12.5, color:'rgba(255,255,255,0.85)', fontStyle:'italic' }}>
            "{ev.observaciones}"
          </div>
        )}
      </div>
    </div>
  );
}

// ─── PLANTILLAS MODAL ──────────────────────────────────────────────
// Lista todas las plantillas disponibles. Cada una se expande con sus
// opciones (fecha, persona que firma/recibe). Al confirmar, descarga
// el PDF con el nombre y datos prellenados de la obra activa.
const PLANTILLAS_DEF = [
  {
    id: 'ingresoMateriales',
    titulo: 'Ingreso de materiales',
    descripcion: 'Registro de materiales que llegan al almacén (con guía).',
    grupo: 'Materiales',
    campos: ['fecha', 'recibidoPor', 'firma'],
  },
  {
    id: 'salidaMateriales',
    titulo: 'Salida de materiales',
    descripcion: 'Vale de salida con firma de quien retira.',
    grupo: 'Materiales',
    campos: ['fecha', 'retiraPor', 'firma'],
  },
  {
    id: 'diarioMateriales',
    titulo: 'Diario de materiales (ingreso + salida)',
    descripcion: 'Plantilla combinada: 1 hoja para todo el día.',
    grupo: 'Materiales',
    campos: ['fecha', 'recibidoPor', 'firma'],
  },
  {
    id: 'ingresoHerramientas',
    titulo: 'Ingreso de herramientas',
    descripcion: 'Registro de herramientas que ingresan al almacén.',
    grupo: 'Herramientas',
    campos: ['fecha', 'recibidoPor', 'firma'],
  },
  {
    id: 'salidaHerramientas',
    titulo: 'Salida de herramientas',
    descripcion: 'Préstamo de herramientas con firma de quien retira.',
    grupo: 'Herramientas',
    campos: ['fecha', 'retiraPor', 'firma'],
  },
  {
    id: 'diarioHerramientas',
    titulo: 'Diario de herramientas (ingreso + salida)',
    descripcion: 'Plantilla combinada del día.',
    grupo: 'Herramientas',
    campos: ['fecha', 'recibidoPor', 'firma'],
  },
  {
    id: 'parteDiarioMaquinaria',
    titulo: 'Parte diario de maquinaria',
    descripcion: 'Operador, hora inicio/fin, horas trabajadas, combustible.',
    grupo: 'Maquinaria',
    campos: ['fecha', 'firma'],
    cargaActivos: true,
  },
  {
    id: 'ingresoEpps',
    titulo: 'Ingreso de EPPs',
    descripcion: 'Recepción de EPPs al almacén SSOMA.',
    grupo: 'EPPs / SSOMA',
    campos: ['fecha', 'recibidoPor', 'firma'],
  },
  {
    id: 'salidaEpps',
    titulo: 'Entrega de EPPs (SUNAFIL)',
    descripcion: 'Acta de entrega con firma del trabajador. Conservar 5 años.',
    grupo: 'EPPs / SSOMA',
    campos: ['fecha', 'firma'],
    cargaPersonal: true,
  },
  {
    id: 'asistencia',
    titulo: 'Asistencia diaria',
    descripcion: 'Hoja con personal pre-cargado para marcar V/F/A/T.',
    grupo: 'Personal',
    campos: ['fecha'],
    cargaPersonal: true,
  },
];

function PlantillasModal({ obraId, onClose, showToast, embedded = false }) {
  const [expanded, setExpanded]   = uSE(null);
  const [loading, setLoading]     = uSE(false);
  const [obraNombre, setObraNombre] = uSE('—');
  const [opts, setOpts]           = uSE({}); // por id: { fecha, persona, firma }

  // ── Branding panel: company ejecutora de la obra (logo + nombre + código) ──
  // Se muestra arriba del listado para que el user vea de inmediato cuál
  // empresa va a aparecer en las plantillas y pueda editarla sin tener que
  // buscar la empresa en Contabilidad.
  const [empresa, setEmpresa] = uSE(null);   // company entera (o null si no hay)
  const [brandingEdit, setBrandingEdit] = uSE(false);
  const [brandingForm, setBrandingForm] = uSE({ logo_dataurl: null, nombre_corto: '', codigo_doc_prefix: '' });
  const [brandingSaving, setBrandingSaving] = uSE(false);
  const auth = window.__useAuth?.();
  const isAdmin = auth?.profile?.rol === 'admin';

  const loadEmpresa = uCB(async () => {
    try {
      const obra = obraId ? await window.__db.obras.get(obraId) : null;
      let companyId = obra?.ejecutora_company_id || null;
      if (!companyId && Array.isArray(obra?.consorcio_miembros) && obra.consorcio_miembros.length) {
        const first = obra.consorcio_miembros[0];
        companyId = typeof first === 'string' ? first : (first?.company_id || null);
      }
      if (!companyId) { setEmpresa(null); return; }
      const c = await window.__db.companies.get(companyId);
      if (c && !c.deleted_at) {
        setEmpresa(c);
        setBrandingForm({
          logo_dataurl: c.logo_dataurl || null,
          nombre_corto: c.nombre_corto || '',
          codigo_doc_prefix: c.codigo_doc_prefix || '',
        });
      } else {
        setEmpresa(null);
      }
    } catch (e) {
      console.warn('[plantillas] no se pudo cargar empresa ejecutora:', e?.message);
      setEmpresa(null);
    }
  }, [obraId]);

  uEE(() => {
    let cancelled = false;
    (async () => {
      try {
        const o = await window.__db.obras.get(obraId);
        if (!cancelled && o) setObraNombre(o.nombre_obra || '—');
      } catch {}
      if (!cancelled) await loadEmpresa();
    })();
    return () => { cancelled = true; };
  }, [obraId, loadEmpresa]);

  // ── Handlers de branding ─────────────────────────────────────────
  const onPickLogo = async (file) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showToast?.('Logo demasiado grande — máximo 2MB', 'red');
      return;
    }
    try {
      const url = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result); r.onerror = rej;
        r.readAsDataURL(file);
      });
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      const maxDim = 320;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const compressed = canvas.toDataURL('image/jpeg', 0.85);
      setBrandingForm(prev => ({ ...prev, logo_dataurl: compressed }));
    } catch (err) {
      showToast?.('Error procesando imagen: ' + (err.message || err), 'red');
    }
  };

  const guardarBranding = async () => {
    if (!empresa) return;
    setBrandingSaving(true);
    try {
      const now = new Date().toISOString();
      await window.__db.companies.update(empresa.id, {
        logo_dataurl: brandingForm.logo_dataurl || null,
        nombre_corto: brandingForm.nombre_corto?.trim() || null,
        codigo_doc_prefix: brandingForm.codigo_doc_prefix?.trim() || null,
        updated_at: now,
        version: (empresa.version ?? 0) + 1,
        sync_status: empresa.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'companies' } })); } catch {}
      try { window.dispatchEvent(new Event('online')); } catch {}
      await loadEmpresa();
      setBrandingEdit(false);
      showToast?.('Branding actualizado — las plantillas ya lo usan', 'green');
    } catch (e) {
      showToast?.('Error al guardar: ' + (e.message || e), 'red');
    } finally {
      setBrandingSaving(false);
    }
  };

  const updateOpt = (id, patch) => setOpts(prev => ({
    ...prev,
    [id]: { ...(prev[id] || {}), ...patch },
  }));

  const getOpts = (def) => {
    const cur = opts[def.id] || {};
    return {
      fecha: cur.fecha || new Date().toISOString().slice(0, 10),
      persona: cur.persona || '',
      firma: cur.firma !== false, // default true
    };
  };

  const descargar = async (def) => {
    setLoading(true);
    try {
      const fn = window.__plantillas?.[def.id];
      if (!fn) { showToast?.('Plantilla no disponible', 'red'); return; }
      const o = getOpts(def);
      const args = { obraNombre, fecha: o.fecha };

      // Branding por empresa ejecutora: si la obra tiene una ejecutora
      // con logo o nombre comercial, las plantillas lo usan en el header.
      // Si la obra está en consorcio, se toma el primer miembro como
      // ejecutora de facto. Si nada está configurado, cae a JARVEX.
      try {
        const obra = obraId ? await window.__db.obras.get(obraId) : null;
        let companyId = obra?.ejecutora_company_id || null;
        if (!companyId && Array.isArray(obra?.consorcio_miembros) && obra.consorcio_miembros.length) {
          const first = obra.consorcio_miembros[0];
          companyId = typeof first === 'string' ? first : (first?.company_id || null);
        }
        if (companyId) {
          const empresa = await window.__db.companies.get(companyId);
          if (empresa && !empresa.deleted_at) {
            args.empresaBrand = {
              nombre: empresa.nombre_corto || empresa.name || '',
              logoDataUrl: empresa.logo_dataurl || null,
              codigoDocPrefix: empresa.codigo_doc_prefix || null,
            };
          }
        }
      } catch (e) {
        console.warn('[plantillas] no se pudo cargar branding empresa:', e?.message || e);
      }

      if (def.campos.includes('recibidoPor')) args.recibidoSugerido = o.persona;
      if (def.campos.includes('retiraPor'))   args.retiraSugerido   = o.persona;
      if (def.campos.includes('recibidoPor') && def.id === 'ingresoMateriales')
        args.proveedorSugerido = o.persona;
      if (def.cargaPersonal) {
        try {
          const personal = await window.__db.personal
            .where('obra_id').equals(obraId)
            .filter(p => !p.deleted_at && p.estado === 'activo')
            .toArray();
          args.personal = personal;
        } catch {}
      }
      if (def.cargaActivos) {
        try {
          const maquinarias = await window.__db.activos_pesados
            ?.where('obra_id').equals(obraId)
            .filter(a => !a.deleted_at)
            .toArray();
          args.maquinarias = maquinarias || [];
        } catch {}
      }
      await fn(args);
      showToast?.(`✓ ${def.titulo} descargada`, 'green');
    } catch (e) {
      console.error('[plantillas] error:', e);
      showToast?.('Error al generar PDF: ' + (e.message || e), 'red');
    } finally {
      setLoading(false);
    }
  };

  const grupos = uME(() => {
    const g = {};
    for (const p of PLANTILLAS_DEF) {
      g[p.grupo] = g[p.grupo] || [];
      g[p.grupo].push(p);
    }
    return g;
  }, []);

  // Contenido principal (header + scroll). Se reusa tanto en modo modal
  // (con backdrop) como en modo `embedded` (página standalone vía sidebar
  // "Plantillas").
  const contenido = (
    <>
      <div className={embedded ? '' : 'modal-hd'}
           style={embedded
             ? { padding:'14px 18px', borderBottom:'1px solid var(--bd)' }
             : {}}>
        <div>
          <div style={{ fontWeight:700, fontSize:embedded ? 18 : 15 }}>Plantillas para imprimir</div>
          <div style={{ fontSize:11.5, color:'var(--tm)', marginTop:2 }}>
            Hojas en PDF para llenar a mano en obra y subir como evidencia después.
          </div>
        </div>
        {!embedded && <button className="btn btn-ghost btn-sm" onClick={onClose}>Cerrar</button>}
      </div>

      <div style={{ overflow:'auto', padding:'12px 16px', flex: embedded ? 1 : undefined }}>
          {/* ── Branding panel: lo que va a salir como cabecera de los PDFs ── */}
          <div style={{
            marginBottom:16,
            padding:'12px 14px',
            background:'rgba(242,183,5,0.06)',
            border:'1px dashed rgba(242,183,5,0.3)',
            borderRadius:8,
          }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, marginBottom:8 }}>
              <div>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--amber)', textTransform:'uppercase', letterSpacing:0.4, marginBottom:3 }}>
                  Branding del header de las plantillas
                </div>
                <div style={{ fontSize:11, color:'var(--tm)', lineHeight:1.5 }}>
                  Estos datos aparecen en la parte superior de los PDFs. Se aplican a las {Object.keys(grupos).reduce((n,g)=>n+grupos[g].length,0)} plantillas de esta obra.
                </div>
              </div>
              {!brandingEdit && isAdmin && (
                <button className="btn btn-ghost btn-sm" onClick={()=>setBrandingEdit(true)} style={{ flexShrink:0 }}>
                  <JxIcon name="edit" size={12}/> {empresa ? 'Editar' : 'Configurar'}
                </button>
              )}
            </div>

            {!brandingEdit && (
              <div style={{ display:'flex', alignItems:'center', gap:14 }}>
                <div style={{ width:90, minHeight:50, background:'#fff', borderRadius:6, padding:6, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  {empresa?.logo_dataurl ? (
                    <img src={empresa.logo_dataurl} alt="logo" style={{ maxHeight:42, maxWidth:78, objectFit:'contain' }}/>
                  ) : (
                    <div style={{ fontSize:10, color:'#999', textAlign:'center', padding:4 }}>Sin logo</div>
                  )}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:'var(--tp)' }}>
                    {empresa ? (empresa.nombre_corto || empresa.name) : 'JARVEX'}
                  </div>
                  <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:2 }}>
                    {empresa
                      ? <>Empresa ejecutora · Código: <strong>{empresa.codigo_doc_prefix || 'F-SSO-05'}</strong></>
                      : 'La obra no tiene empresa ejecutora asignada — se usa "JARVEX" por default. Asigná la ejecutora en Obras / Proyectos.'}
                  </div>
                  {empresa && !isAdmin && (
                    <div style={{ fontSize:10, color:'var(--tm)', marginTop:4, fontStyle:'italic' }}>
                      Solo admin puede modificar el branding.
                    </div>
                  )}
                </div>
              </div>
            )}

            {brandingEdit && empresa && (
              <div style={{ display:'grid', gridTemplateColumns:'110px 1fr', gap:12, marginTop:6 }}>
                <div>
                  <div style={{ width:'100%', minHeight:70, background:'#fff', borderRadius:6, padding:6, display:'flex', alignItems:'center', justifyContent:'center', marginBottom:6 }}>
                    {brandingForm.logo_dataurl ? (
                      <img src={brandingForm.logo_dataurl} alt="logo" style={{ maxHeight:60, maxWidth:90, objectFit:'contain' }}/>
                    ) : (
                      <div style={{ fontSize:10, color:'#999' }}>Sin logo</div>
                    )}
                  </div>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    id="branding-logo-input"
                    style={{ display:'none' }}
                    onChange={(e) => { onPickLogo(e.target.files?.[0]); e.target.value=''; }}
                  />
                  <button type="button" className="btn btn-ghost btn-sm" style={{ width:'100%', marginBottom:4 }}
                    onClick={()=>document.getElementById('branding-logo-input').click()}>
                    <JxIcon name="upload" size={11}/> {brandingForm.logo_dataurl ? 'Cambiar' : 'Subir logo'}
                  </button>
                  {brandingForm.logo_dataurl && (
                    <button type="button" className="btn btn-ghost btn-sm" style={{ width:'100%', color:'var(--red)' }}
                      onClick={()=>setBrandingForm(prev => ({ ...prev, logo_dataurl: null }))}>
                      Quitar logo
                    </button>
                  )}
                </div>
                <div style={{ display:'grid', gap:8 }}>
                  <div>
                    <label style={{ fontSize:10.5, color:'var(--tm)', display:'block', marginBottom:3 }}>Nombre corto</label>
                    <input className="input" style={{ width:'100%' }}
                      placeholder={empresa.name || 'CONSORCIO EL INCA'}
                      value={brandingForm.nombre_corto}
                      maxLength={80}
                      onChange={e=>setBrandingForm(prev => ({ ...prev, nombre_corto: e.target.value }))}/>
                    <div style={{ fontSize:9.5, color:'var(--tm)', marginTop:2 }}>Vacío = "{empresa.name}"</div>
                  </div>
                  <div>
                    <label style={{ fontSize:10.5, color:'var(--tm)', display:'block', marginBottom:3 }}>Código de formato</label>
                    <input className="input" style={{ width:'100%' }}
                      placeholder="F-SSO-05"
                      value={brandingForm.codigo_doc_prefix}
                      maxLength={20}
                      onChange={e=>setBrandingForm(prev => ({ ...prev, codigo_doc_prefix: e.target.value }))}/>
                  </div>
                  <div style={{ display:'flex', gap:6, marginTop:2 }}>
                    <button className="btn btn-amber btn-sm" onClick={guardarBranding} disabled={brandingSaving}>
                      <JxIcon name="check" size={12}/> {brandingSaving ? 'Guardando…' : 'Guardar'}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={()=>{
                      setBrandingForm({
                        logo_dataurl: empresa.logo_dataurl || null,
                        nombre_corto: empresa.nombre_corto || '',
                        codigo_doc_prefix: empresa.codigo_doc_prefix || '',
                      });
                      setBrandingEdit(false);
                    }} disabled={brandingSaving}>Cancelar</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {Object.entries(grupos).map(([grupo, lista]) => (
            <div key={grupo} style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, color:'var(--tm)', fontWeight:600, marginBottom:6, letterSpacing:0.5, textTransform:'uppercase' }}>
                {grupo}
              </div>
              {lista.map(def => {
                const open = expanded === def.id;
                const o = getOpts(def);
                return (
                  <div key={def.id} style={{ border:'1px solid var(--bd)', borderRadius:6, marginBottom:6, background:'var(--bg2)' }}>
                    <button
                      onClick={()=>setExpanded(open ? null : def.id)}
                      style={{ width:'100%', textAlign:'left', padding:'10px 12px', display:'flex', alignItems:'center', justifyContent:'space-between', background:'none', border:'none', color:'var(--ts)', cursor:'pointer' }}>
                      <div>
                        <div style={{ fontSize:13, fontWeight:600 }}>{def.titulo}</div>
                        <div style={{ fontSize:11, color:'var(--tm)', marginTop:1 }}>{def.descripcion}</div>
                      </div>
                      <JxIcon name={open ? 'chevronUp' : 'chevronDown'} size={14} color="var(--tm)"/>
                    </button>
                    {open && (
                      <div style={{ padding:'10px 12px 12px', borderTop:'1px solid var(--bd)', display:'flex', flexDirection:'column', gap:8 }}>
                        {def.campos.includes('fecha') && (
                          <label style={{ fontSize:11.5, color:'var(--tm)', display:'flex', alignItems:'center', gap:8 }}>
                            <span style={{ minWidth:80 }}>Fecha:</span>
                            <input type="date" className="input"
                              value={o.fecha}
                              onChange={e => updateOpt(def.id, { fecha: e.target.value })}
                              style={{ flex:1 }}/>
                          </label>
                        )}
                        {(def.campos.includes('recibidoPor') || def.campos.includes('retiraPor')) && (
                          <label style={{ fontSize:11.5, color:'var(--tm)', display:'flex', alignItems:'center', gap:8 }}>
                            <span style={{ minWidth:80 }}>
                              {def.campos.includes('recibidoPor') ? 'Recibe / Proveedor:' : 'Quien retira:'}
                            </span>
                            <input type="text" className="input"
                              placeholder="Nombre (opcional, queda en blanco si no se llena)"
                              value={o.persona}
                              onChange={e => updateOpt(def.id, { persona: e.target.value })}
                              style={{ flex:1 }}/>
                          </label>
                        )}
                        {def.campos.includes('firma') && (
                          <label style={{ fontSize:11.5, color:'var(--tm)', display:'flex', alignItems:'center', gap:8 }}>
                            <input type="checkbox"
                              checked={o.firma}
                              onChange={e => updateOpt(def.id, { firma: e.target.checked })}/>
                            <span>Incluir columna de firma (default sí — siempre se incluye en estas plantillas)</span>
                          </label>
                        )}
                        <div style={{ marginTop:4 }}>
                          <button className="btn btn-amber btn-sm"
                            disabled={loading}
                            onClick={() => descargar(def)}>
                            <JxIcon name="download" size={12}/>
                            {loading ? 'Generando…' : 'Descargar PDF'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
      </div>
    </>
  );

  // Modo página standalone (desde sidebar "Plantillas"): tarjeta a ancho
  // completo, sin backdrop. Modo modal (desde Evidencias): backdrop + modal.
  if (embedded) {
    return (
      <div className="card" style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
        {contenido}
      </div>
    );
  }
  return (
    <div className="modal-backdrop" onClick={onClose} style={{ background:'rgba(0,0,0,0.7)' }}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{ maxWidth:640, width:'92%', maxHeight:'88vh', display:'flex', flexDirection:'column' }}>
        {contenido}
      </div>
    </div>
  );
}

// ─── PLANTILLAS PAGE ────────────────────────────────────────────────
// Acceso directo desde el sidebar a las plantillas imprimibles, sin
// pasar por Evidencias. Auto-detecta la obra activa.
function PlantillasPage({ showToast }) {
  const [obraId, setObraId] = uSE(null);

  uEE(() => {
    let cancelled = false;
    let attempts = 0;
    const find = async () => {
      attempts++;
      const obras = await window.__db.obras.toArray();
      const stored = window.__getObraActivaId?.();
      const activa = (stored && obras.find(o => o.id === stored && !o.deleted_at))
                  || obras.find(o => !o.deleted_at);
      if (activa) { if (!cancelled) setObraId(activa.id); return; }
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

  if (!obraId) {
    return (
      <div className="card card-p" style={{ textAlign:'center', color:'var(--tm)', padding:40 }}>
        <JxIcon name="building" size={36} color="var(--tm)"/>
        <div style={{ marginTop:12 }}>Seleccioná una obra para ver las plantillas.</div>
      </div>
    );
  }

  return (
    <div style={{ height:'calc(100vh - 100px)', display:'flex', flexDirection:'column' }}>
      <PlantillasModal obraId={obraId} showToast={showToast} embedded onClose={()=>{}}/>
    </div>
  );
}

Object.assign(window, { EvidenciasPage, PlantillasPage });
