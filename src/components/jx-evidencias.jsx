import React from "react";
const { useState: uSE, useMemo: uME, useEffect: uEE, useRef: uRE } = React;

// ─── CONFIG ─────────────────────────────────────────────
const TIPO_META = {
  foto_asistencia:        { lbl:'Foto Asistencia',   cls:'b-blue',   cat:'asistencia',  icon:'camera' },
  foto_avance:            { lbl:'Foto de Avance',    cls:'b-green',  cat:'avance',      icon:'camera' },
  guia_remision:          { lbl:'Guía de Remisión',  cls:'b-amber',  cat:'materiales',  icon:'truck'  },
  factura:                { lbl:'Factura',           cls:'b-orange', cat:'materiales',  icon:'file'   },
  pdf_formato_firmado:    { lbl:'Formato Firmado',   cls:'b-blue',   cat:'documentos',  icon:'clipboard' },
  foto_herramienta_danada:{ lbl:'Herr. Dañada',      cls:'b-red',    cat:'herramientas',icon:'tool'   },
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
  pending_upload: { cls:'b-amber',  lbl:'⏱ Pendiente' },
  failed:         { cls:'b-red',    lbl:'⚠ Falló'     },
};

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
        if (ev.sync_status === 'uploaded' && ev.url_archivo) {
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
function EvidenciasPage({ showToast }) {
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

  const stats = uME(() => {
    const total = evidencias.length;
    const pendientes = evidencias.filter(e => e.sync_status === 'pending_upload').length;
    return { total, pendientes };
  }, [evidencias]);

  const filtered = uME(() => {
    return evidencias
      .slice()
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      .filter(e => {
        const meta = TIPO_META[e.tipo_evidencia] || TIPO_META.documento_general;
        const matchCat = cat === 'todos' || meta.cat === cat;
        const matchQ = !q || (e.nombre_archivo||'').toLowerCase().includes(q.toLowerCase())
                          || (e.observaciones||'').toLowerCase().includes(q.toLowerCase());
        return matchCat && matchQ;
      });
  }, [evidencias, cat, q]);

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
          <button className="btn btn-amber btn-sm" onClick={()=>setModal(true)}>
            <JxIcon name="upload" size={13}/>Subir Archivo
          </button>
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
          <p>{evidencias.length === 0
                ? 'Aún no hay evidencias registradas. Click en "Subir Archivo" para comenzar.'
                : 'No se encontraron evidencias con los filtros aplicados.'}</p>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:14 }}>
          {filtered.map(ev => {
            const meta = TIPO_META[ev.tipo_evidencia] || TIPO_META.documento_general;
            const sync = SYNC_BADGE[ev.sync_status] || SYNC_BADGE.pending_upload;
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
        if (ev.sync_status === 'uploaded' && ev.url_archivo) {
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

function PlantillasModal({ obraId, onClose, showToast }) {
  const [expanded, setExpanded]   = uSE(null);
  const [loading, setLoading]     = uSE(false);
  const [obraNombre, setObraNombre] = uSE('—');
  const [opts, setOpts]           = uSE({}); // por id: { fecha, persona, firma }

  uEE(() => {
    let cancelled = false;
    (async () => {
      try {
        const o = await window.__db.obras.get(obraId);
        if (!cancelled && o) setObraNombre(o.nombre_obra || '—');
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [obraId]);

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

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ background:'rgba(0,0,0,0.7)' }}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{ maxWidth:640, width:'92%', maxHeight:'88vh', display:'flex', flexDirection:'column' }}>
        <div className="modal-hd">
          <div>
            <div style={{ fontWeight:700, fontSize:15 }}>Plantillas para imprimir</div>
            <div style={{ fontSize:11.5, color:'var(--tm)', marginTop:2 }}>
              Hojas en PDF para llenar a mano en obra y subir como evidencia después.
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cerrar</button>
        </div>

        <div style={{ overflow:'auto', padding:'12px 16px' }}>
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
      </div>
    </div>
  );
}

Object.assign(window, { EvidenciasPage });
