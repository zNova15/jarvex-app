import React from "react";
const { useState: uSM, useMemo: uMM, useEffect: uEM } = React;

// Helper formato moneda
const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const JxIconRF = (props) => {
  const I = window.JxIcon;
  return I ? <I {...props}/> : null;
};

// ═══════════════════════════════════════════════════════════════════
// VISUALIZADOR DE REGISTRO FÍSICO
// Modal compartido para movimientos de materiales y herramientas.
// Lee evidencias con modulo_relacionado='movimientos_materiales' o
// 'movimientos_herramientas', muestra thumbnails y permite:
//   - Filtrar por fecha y por nombre (responsable o material/herramienta)
//   - Click en thumbnail → ver foto en grande
//   - Almacenero/operador: 'Solicitar cambio' (crea change_request)
//   - Admin: ver todo + ir directo al movimiento para editar
// ═══════════════════════════════════════════════════════════════════
function RegistroFisicoModal({ modulo, obraId, onClose, showToast }) {
  const auth = window.__useAuth?.();
  const rol = auth?.profile?.rol || '';
  const isAdmin = rol === 'admin';
  const [evidencias, setEvidencias] = uSM([]);
  const [movs, setMovs] = uSM([]);
  const [items, setItems] = uSM([]); // materiales / herramientas
  const [personal, setPersonal] = uSM([]);
  const [thumbs, setThumbs] = uSM({}); // { evidId: dataUrl }
  const [fDesde, setFDesde] = uSM('');
  const [fHasta, setFHasta] = uSM('');
  const [fNombre, setFNombre] = uSM('');
  const [photoOpen, setPhotoOpen] = uSM(null); // dataUrl
  const [solicitudOpen, setSolicitudOpen] = uSM(null); // {evidencia, mov, motivo}
  const [loading, setLoading] = uSM(true);

  const tabla = modulo === 'movimientos_materiales' ? 'movimientos_materiales' : 'movimientos_herramientas';
  const itemsTabla = modulo === 'movimientos_materiales' ? 'materiales' : 'herramientas';
  const itemNameField = modulo === 'movimientos_materiales' ? 'nombre_material' : 'nombre_herramienta';

  uEM(() => {
    let cancelled = false;
    (async () => {
      try {
        const [evs, allMovs, allItems, allPers] = await Promise.all([
          window.__db.evidencias.filter(e => !e.deleted_at && e.modulo_relacionado === modulo && (!obraId || e.obra_id === obraId)).toArray(),
          window.__db[tabla].filter(m => !m.deleted_at && (!obraId || m.obra_id === obraId)).toArray(),
          window.__db[itemsTabla].filter(x => !x.deleted_at).toArray(),
          window.__db.personal.filter(p => !p.deleted_at).toArray(),
        ]);
        if (cancelled) return;
        setEvidencias(evs.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')));
        setMovs(allMovs);
        setItems(allItems);
        setPersonal(allPers);
        // Cargar thumbnails (limit 30 para no saturar)
        const thumbsMap = {};
        for (const ev of evs.slice(0, 30)) {
          try {
            const blobEntry = await window.__db.evidencias_blobs.get(ev.id);
            if (blobEntry?.blob) thumbsMap[ev.id] = URL.createObjectURL(blobEntry.blob);
          } catch {}
        }
        if (!cancelled) setThumbs(thumbsMap);
      } catch (e) { console.error('[regfisico]', e); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => {
      cancelled = true;
      // Revoke object URLs
      Object.values(thumbs).forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
    };
  }, [modulo, obraId]);

  const lookup = (arr, id, field) => arr.find(x => x.id === id)?.[field] || '—';

  const filtered = uMM(() => {
    return evidencias.filter(ev => {
      if (fDesde && (ev.fecha || '') < fDesde) return false;
      if (fHasta && (ev.fecha || '') > fHasta) return false;
      if (fNombre) {
        const q = fNombre.toLowerCase();
        const mov = movs.find(m => m.id === ev.registro_relacionado_id);
        const item = mov ? items.find(i => i.id === (mov.material_id || mov.herramienta_id)) : null;
        const resp = mov ? personal.find(p => p.id === mov.responsable_id) : null;
        const buf = [
          item?.[itemNameField] || '',
          resp ? `${resp.nombres} ${resp.apellidos}` : '',
          ev.observaciones || '',
        ].join(' ').toLowerCase();
        if (!buf.includes(q)) return false;
      }
      return true;
    });
  }, [evidencias, fDesde, fHasta, fNombre, movs, items, personal]);

  const verFoto = async (ev) => {
    try {
      const blobEntry = await window.__db.evidencias_blobs.get(ev.id);
      if (blobEntry?.blob) {
        setPhotoOpen({
          url: URL.createObjectURL(blobEntry.blob),
          ev,
        });
      } else {
        showToast?.('Foto no disponible localmente', 'amber');
      }
    } catch (e) {
      showToast?.('Error: ' + e.message, 'red');
    }
  };

  const enviarSolicitud = async () => {
    const { evidencia, mov, motivo } = solicitudOpen;
    if (!motivo || motivo.trim().length < 10) {
      showToast?.('El motivo debe tener al menos 10 caracteres', 'red');
      return;
    }
    try {
      const item = mov ? items.find(i => i.id === (mov.material_id || mov.herramienta_id)) : null;
      const itemName = item?.[itemNameField] || '(item)';
      await window.__changeRequests.create({
        table: tabla,
        recordId: mov?.id,
        recordLabel: `${mov?.fecha || ''} · ${itemName}`,
        proposedChanges: {
          revisar: { old: 'registro original', new: 'verificar y corregir según foto adjunta' },
          motivo_solicitante: { old: '', new: motivo.trim() },
          evidencia_id: { old: '', new: evidencia.id },
        },
        reason: motivo.trim(),
      });
      showToast?.('✓ Solicitud enviada al administrador', 'green');
      setSolicitudOpen(null);
    } catch (e) {
      showToast?.('Error: ' + e.message, 'red');
    }
  };

  return (
    <>
      <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}
        style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:20 }}>
        <div className="card card-p" style={{ width:'100%', maxWidth:1100, maxHeight:'92vh', overflow:'hidden', display:'flex', flexDirection:'column', background:'#1A2333', border:'1px solid var(--bd)', borderRadius:10 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <div style={{ fontSize:15, fontWeight:700 }}>
              <JxIconRF name="camera" size={16} color="var(--amber)"/>{' '}
              Visualización de Registro Físico — {modulo === 'movimientos_materiales' ? 'Materiales' : 'Herramientas'}
            </div>
            <button className="btn btn-ghost btn-sm" onClick={onClose}><JxIconRF name="x" size={13}/></button>
          </div>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:12 }}>
            <div><label className="flabel" style={{ fontSize:10 }}>Desde</label>
              <input className="fi" type="date" value={fDesde} onChange={e=>setFDesde(e.target.value)} style={{ fontSize:12, padding:'6px 8px' }}/>
            </div>
            <div><label className="flabel" style={{ fontSize:10 }}>Hasta</label>
              <input className="fi" type="date" value={fHasta} onChange={e=>setFHasta(e.target.value)} style={{ fontSize:12, padding:'6px 8px' }}/>
            </div>
            <div style={{ flex:1, minWidth:200 }}>
              <label className="flabel" style={{ fontSize:10 }}>Buscar (responsable / item / observación)</label>
              <input className="fi" value={fNombre} onChange={e=>setFNombre(e.target.value)} placeholder="ej: Carlos Quispe, cemento..." style={{ fontSize:12, padding:'6px 8px' }}/>
            </div>
            <div style={{ display:'flex', alignItems:'flex-end' }}>
              <span style={{ fontSize:11, color:'var(--tm)' }}>{filtered.length} registros con foto</span>
            </div>
          </div>
          <div style={{ flex:1, overflow:'auto', border:'1px solid var(--bd)', borderRadius:6 }}>
            {loading ? (
              <div style={{ padding:30, textAlign:'center', color:'var(--tm)' }}>Cargando…</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding:30, textAlign:'center', color:'var(--tm)' }}>
                <JxIconRF name="camera" size={32} color="var(--tm)"/>
                <div style={{ marginTop:8 }}>Sin registros físicos para el filtro actual.</div>
              </div>
            ) : (
              <table className="tbl" style={{ fontSize:12 }}>
                <thead><tr>
                  <th style={{ width:80 }}>Foto</th>
                  <th>Fecha</th>
                  <th>{modulo === 'movimientos_materiales' ? 'Material' : 'Herramienta'}</th>
                  <th>Tipo</th>
                  <th>Cantidad</th>
                  <th>Responsable</th>
                  <th>Observaciones foto</th>
                  <th style={{ textAlign:'center' }}>Acciones</th>
                </tr></thead>
                <tbody>
                  {filtered.map(ev => {
                    const mov = movs.find(m => m.id === ev.registro_relacionado_id);
                    const item = mov ? items.find(i => i.id === (mov.material_id || mov.herramienta_id)) : null;
                    const resp = mov ? personal.find(p => p.id === mov.responsable_id) : null;
                    return (
                      <tr key={ev.id}>
                        <td>
                          {thumbs[ev.id]
                            ? <img src={thumbs[ev.id]} alt="thumb"
                                onClick={()=>verFoto(ev)}
                                style={{ width:60, height:60, objectFit:'cover', borderRadius:4, cursor:'pointer', border:'1px solid var(--bd)' }}/>
                            : <span style={{ color:'var(--tm)' }}>—</span>}
                        </td>
                        <td className="col-m">{ev.fecha || mov?.fecha || '—'}</td>
                        <td>{item?.[itemNameField] || <span style={{ color:'var(--tm)' }}>(eliminado)</span>}</td>
                        <td>
                          <span className="badge b-blue">
                            {mov?.tipo_movimiento || mov?.accion || '—'}
                          </span>
                        </td>
                        <td className="col-num">
                          {mov?.cantidad != null ? `${mov.cantidad} ${mov.unidad || ''}` : '—'}
                        </td>
                        <td>{resp ? `${resp.nombres} ${resp.apellidos}` : '—'}</td>
                        <td style={{ fontSize:11, color:'var(--tm)', maxWidth:240 }}>{ev.observaciones || '—'}</td>
                        <td style={{ textAlign:'center', whiteSpace:'nowrap' }}>
                          <button className="btn btn-ghost btn-xs" title="Ver foto" onClick={()=>verFoto(ev)}>
                            <JxIconRF name="eye" size={11}/>
                          </button>
                          {!isAdmin && mov && (
                            <button
                              className="btn btn-amber btn-xs"
                              title="Solicitar al admin que revise/corrija este registro"
                              style={{ marginLeft:4 }}
                              onClick={()=>setSolicitudOpen({ evidencia: ev, mov, motivo: '' })}>
                              <JxIconRF name="alert" size={11}/> Solicitar cambio
                            </button>
                          )}
                          {isAdmin && mov && (
                            <span style={{ fontSize:10, color:'var(--green)', marginLeft:6 }}>(admin: editá desde la fila del movimiento)</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:12 }}>
            <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
          </div>
        </div>
      </div>

      {/* Modal foto grande */}
      {photoOpen && (
        <div className="overlay" onClick={()=>{ try { URL.revokeObjectURL(photoOpen.url); } catch {}; setPhotoOpen(null); }}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:10000, padding:20 }}>
          <div onClick={e=>e.stopPropagation()} style={{ maxWidth:'90vw', maxHeight:'90vh', display:'flex', flexDirection:'column', alignItems:'center', gap:10 }}>
            <img src={photoOpen.url} alt="evidencia" style={{ maxWidth:'100%', maxHeight:'80vh', objectFit:'contain', borderRadius:6 }}/>
            <div style={{ fontSize:12, color:'#ddd' }}>{photoOpen.ev.observaciones || photoOpen.ev.nombre_archivo}</div>
            <button className="btn btn-amber btn-sm" onClick={()=>{ try { URL.revokeObjectURL(photoOpen.url); } catch {}; setPhotoOpen(null); }}>Cerrar</button>
          </div>
        </div>
      )}

      {/* Modal solicitar cambio */}
      {solicitudOpen && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && setSolicitudOpen(null)}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.65)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:10001, padding:20 }}>
          <div className="card card-p" style={{ width:'100%', maxWidth:520, background:'#1A2333', border:'1px solid var(--bd)', borderRadius:10 }}>
            <div style={{ fontSize:14, fontWeight:700, marginBottom:10 }}>Solicitar revisión / corrección</div>
            <div style={{ fontSize:12, color:'var(--ts)', marginBottom:12, padding:'8px 10px', background:'rgba(242,183,5,0.08)', borderRadius:6 }}>
              Vas a enviar una solicitud al administrador para que revise este registro físico vs el digital. Si encuentra una diferencia, podrá corregirlo.
            </div>
            <label className="flabel">Describí qué está mal *</label>
            <textarea className="fi" rows={4}
              value={solicitudOpen.motivo}
              onChange={e=>setSolicitudOpen(prev => ({ ...prev, motivo: e.target.value }))}
              placeholder="Mínimo 10 caracteres. Ej: la cantidad registrada (50 kg) no coincide con la guía firmada (45 kg)"
              style={{ minHeight:90 }}/>
            <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:4 }}>
              El admin lo verá en su panel de Solicitudes con tu nombre y la foto del registro físico para verificar.
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:14 }}>
              <button className="btn btn-ghost btn-sm" onClick={()=>setSolicitudOpen(null)}>Cancelar</button>
              <button className="btn btn-amber btn-sm" onClick={enviarSolicitud}>
                <JxIconRF name="send" size={11}/> Enviar solicitud
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Helper detectar obra activa.
// Después de 10 intentos (5s) sin encontrar obras, deja de buscar y retorna null.
// Reanuda al recibir el evento 'jarvex_master_updated' del realtime
// (ej. cuando otro usuario crea una obra) o 'obra_activa_change'.
function useObraActiva() {
  const [obraId, setObraId] = uSM(null);
  uEM(() => {
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
  return obraId;
}

const MOV_MAT_TIPO = {
  entrada:    { cls:'b-green',  lbl:'Entrada',    icon:'arrowIn'  },
  salida:     { cls:'b-orange', lbl:'Salida',     icon:'arrowOut' },
  ajuste:     { cls:'b-blue',   lbl:'Ajuste',     icon:'edit'     },
  devolucion: { cls:'b-blue',   lbl:'Devolución', icon:'arrowIn'  },
  merma:      { cls:'b-red',    lbl:'Merma',      icon:'alert'    },
};

const MOV_HER_ACCION = {
  salida:        { cls:'b-amber',  lbl:'Salida',        icon:'arrowOut'   },
  entrada:       { cls:'b-green',  lbl:'Entrada',       icon:'arrowIn'    },
  mantenimiento: { cls:'b-orange', lbl:'Mantenimiento', icon:'tool'       },
  baja:          { cls:'b-gray',   lbl:'Baja',          icon:'trash'      },
  reposicion:    { cls:'b-blue',   lbl:'Reposición',    icon:'plus'       },
};

const EST_HER = {
  nuevo: 'b-blue', bueno: 'b-green', regular: 'b-yellow', malo: 'b-red',
  mantenimiento: 'b-orange', baja: 'b-gray',
};

// ─── Helpers de reverso ──────────────────────────────────
// Calcula el delta de stock que produjo el movimiento original sobre el material.
// Para reversar, aplicamos el delta opuesto.
function deltaStockMaterial(tipo, cantidad) {
  const c = Number(cantidad || 0);
  switch (tipo) {
    case 'entrada':    return  c;
    case 'devolucion': return  c; // entra al almacén
    case 'salida':     return -c;
    case 'merma':      return -c;
    case 'ajuste':     return  0; // ajuste manual: stock ya fue editado fuera
    default:           return 0;
  }
}

// Invierte el tipo de movimiento de materiales (para crear reverso)
function invertirTipoMaterial(tipo) {
  switch (tipo) {
    case 'entrada':    return 'salida';
    case 'salida':     return 'entrada';
    case 'devolucion': return 'salida';
    case 'merma':      return 'entrada';
    case 'ajuste':     return 'ajuste';
    default:           return 'ajuste';
  }
}

// Invierte la acción de movimiento de herramientas
function invertirAccionHerramienta(accion) {
  switch (accion) {
    case 'salida':        return 'entrada';     // devolución
    case 'entrada':       return 'salida';
    case 'mantenimiento': return 'entrada';
    case 'baja':          return 'reposicion';
    case 'reposicion':    return 'baja';
    default:              return 'entrada';
  }
}

// ─── MODAL REVERSO ───────────────────────────────────────
function ReversoModal({ mov, tipo /* 'mat' | 'her' */, lookupNombre, onClose, onConfirm }) {
  const [motivo, setMotivo] = uSM('');
  const [busy, setBusy] = uSM(false);
  const [err, setErr] = uSM('');

  const submit = async () => {
    setErr('');
    if ((motivo || '').trim().length < 10) {
      setErr('El motivo debe tener al menos 10 caracteres.');
      return;
    }
    setBusy(true);
    try {
      await onConfirm(motivo.trim());
    } catch (e) {
      setErr(e?.message || 'Error al reversar el movimiento.');
      setBusy(false);
    }
  };

  return (
    <Modal title="Reversar Movimiento" icon="arrowOut" onClose={onClose}>
      <div style={{ background:'rgba(231,76,60,0.06)', border:'1px solid rgba(231,76,60,0.2)', borderRadius:8, padding:'12px 14px', fontSize:12.5, color:'var(--ts)', marginBottom:14, lineHeight:1.5 }}>
        ¿Reversar este movimiento? Se creará un movimiento opuesto que cancela el original. Esta acción es trazable y aparecerá en auditoría.
      </div>
      <div style={{ marginBottom:12, fontSize:12, color:'var(--tm)' }}>
        <div><strong style={{ color:'var(--ts)' }}>Movimiento:</strong> {tipo === 'mat'
          ? `${(MOV_MAT_TIPO[mov.tipo_movimiento]||{}).lbl || mov.tipo_movimiento} de ${Number(mov.cantidad||0)} ${mov.unidad||''} de ${lookupNombre(mov)}`
          : `${(MOV_HER_ACCION[mov.accion]||{}).lbl || mov.accion} de ${lookupNombre(mov)}`}</div>
        <div style={{ marginTop:4 }}><strong style={{ color:'var(--ts)' }}>Fecha:</strong> {mov.fecha} {mov.hora || ''}</div>
      </div>
      {err && <div style={{ background:'rgba(231,76,60,0.1)', border:'1px solid rgba(231,76,60,0.25)', borderRadius:8, padding:'10px 12px', fontSize:12, color:'var(--red)', marginBottom:10 }}>{err}</div>}
      <div>
        <label className="flabel">Motivo del reverso *</label>
        <textarea className="fi" rows={3} placeholder="Ej.: Se registró por error 100 bolsas en lugar de 10"
                  value={motivo} onChange={e=>setMotivo(e.target.value)} autoFocus/>
        <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:4 }}>Mínimo 10 caracteres. Quedará en auditoría.</div>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn btn-red" onClick={submit} disabled={busy}>
          <JxIcon name="arrowOut" size={13}/>{busy ? 'Reversando…' : 'Confirmar Reverso'}
        </button>
      </div>
    </Modal>
  );
}

// ─── MOV. MATERIALES PAGE ─────────────────────────────────
function MovMaterialesPage({ showToast }) {
  const obraId = useObraActiva();
  const auth = window.__useAuth ? window.__useAuth() : null;
  const movHook = window.__hooks.useMovimientosMateriales(obraId);
  const { data: movs, loading, update: updateMov } = movHook;
  const { data: materiales } = window.__hooks.useMateriales(obraId);
  const { data: personal } = window.__hooks.usePersonal(obraId);
  const { data: evidencias } = window.__hooks.useEvidencias(obraId);
  const appMode = window.__useAppMode ? window.__useAppMode() : { isPrueba: true };

  const [reversoTarget, setReversoTarget] = uSM(null);
  const isAdmin = auth?.profile?.rol === 'admin';
  const canDelete = isAdmin && (appMode.isEdicion || appMode.isPrueba);

  // Mapa movimiento_id → evidencia (guía adjunta)
  const guiasPorMov = uMM(() => {
    const map = new Map();
    (evidencias || []).forEach(e => {
      if (e.modulo_relacionado === 'movimientos' && e.registro_relacionado_id && !e.deleted_at) {
        if (!map.has(e.registro_relacionado_id)) map.set(e.registro_relacionado_id, e);
      }
    });
    return map;
  }, [evidencias]);

  const adjuntarGuia = (movimiento) => async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      showToast?.('El archivo excede 15MB', 'red');
      return;
    }
    try {
      await window.__saveEvidenciaLocal({
        id: window.__newId(),
        obra_id: obraId,
        tipo_evidencia: 'guia_remision',
        modulo_relacionado: 'movimientos',
        registro_relacionado_id: movimiento.id,
        nombre_archivo: file.name,
        mime_type: file.type || 'application/octet-stream',
        blob: file,
        fecha: new Date().toISOString().slice(0,10),
        created_by: auth?.profile?.id ?? 'offline',
        observaciones: `Guía/factura del movimiento de ${movimiento.tipo_movimiento}`,
      });
      try { await window.__logAudit?.({ action:'insert', table:'evidencias', recordId: movimiento.id,
        newData:{ archivo: file.name, modulo:'movimientos' }, reason:'Adjunto de guía a movimiento' }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'evidencias' } })); } catch {}
      showToast?.('Guía adjuntada', 'green');
    } catch (err) {
      showToast?.('Error al subir: ' + (err.message || err), 'red');
    }
    // limpiar input para permitir re-disparar onChange con el mismo archivo
    if (e.target) e.target.value = '';
  };

  const verGuia = async (evidencia) => {
    try {
      // Si ya está en cloud (uploaded), abrir url
      if (evidencia.upload_status === 'uploaded' && evidencia.storage_path) {
        const sb = window.__supabase;
        if (sb) {
          const { data } = sb.storage.from('evidencias').getPublicUrl(evidencia.storage_path);
          if (data?.publicUrl) { window.open(data.publicUrl, '_blank'); return; }
        }
      }
      // Si está local, leer del blob
      const blobRow = await window.__db.evidencias_blobs.get(evidencia.id);
      if (blobRow?.blob) {
        const url = URL.createObjectURL(blobRow.blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        return;
      }
      showToast?.('No se encontró el archivo localmente. Sincroniza primero.', 'amber');
    } catch (err) {
      showToast?.('Error al abrir: ' + (err.message || err), 'red');
    }
  };

  const handleDeleteMov = async (m) => {
    if (!canDelete) return;
    const fecha = m.fecha || '';
    const cant = m.cantidad || 0;
    const mat = materiales?.find(x => x.id === m.material_id);
    const nombre = mat?.nombre_material || '(material)';
    if (!confirm(`¿Eliminar este movimiento?\n\n${m.tipo_movimiento} de ${cant} ${m.unidad || ''} de ${nombre}\nFecha: ${fecha}\n\nEl stock NO se reajusta — usa "Reversar" si quieres compensar el stock.`)) return;
    try {
      await updateMov(m.id, { deleted_at: new Date().toISOString() });
      try { await window.__logAudit?.({ action:'delete', table:'movimientos_materiales', recordId:m.id, oldData:m, reason:'Eliminación manual (modo edición)' }); } catch(e) {}
      showToast('Movimiento eliminado', 'amber');
    } catch (e) { showToast('Error al eliminar: ' + (e.message||e), 'red'); }
  };

  const [provs, setProvs] = uSM([]);
  const [partidas, setPartidas] = uSM([]);
  uEM(() => {
    const load = () => {
      window.__db.proveedores.toArray().then(setProvs);
      window.__db.partidas.toArray().then(setPartidas);
    };
    load();
    const interval = setInterval(load, 2000);
    return () => clearInterval(interval);
  }, []);

  const [q, setQ] = uSM('');
  const [tipo, setTipo] = uSM('todos');
  const [regFisicoOpen, setRegFisicoOpen] = uSM(false);

  const lookupMat = (id) => materiales?.find(m => m.id === id);
  const lookupPers = (id) => personal?.find(p => p.id === id);
  const lookupProv = (id) => provs?.find(p => p.id === id);
  const lookupPart = (id) => partidas?.find(p => p.id === id);

  const sorted = uMM(() => {
    if (!movs) return [];
    // Excluir movimientos eliminados (soft delete)
    return movs.filter(m => !m.deleted_at).sort((a, b) => {
      const fa = (a.fecha || '') + ' ' + (a.hora || '');
      const fb = (b.fecha || '') + ' ' + (b.hora || '');
      return fb.localeCompare(fa);
    });
  }, [movs]);

  const filtered = uMM(() => {
    return sorted.filter(m => {
      const matchT = tipo === 'todos' || m.tipo_movimiento === tipo;
      if (!matchT) return false;
      if (!q) return true;
      const mat = lookupMat(m.material_id);
      const ql = q.toLowerCase();
      return (mat?.nombre_material || '').toLowerCase().includes(ql) ||
             (m.documento_asociado || '').toLowerCase().includes(ql);
    });
  }, [sorted, q, tipo, materiales]);

  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7);

  const stats = uMM(() => ({
    total: sorted.length,
    entradasHoy: sorted.filter(m => m.fecha === today && m.tipo_movimiento === 'entrada').length,
    salidasHoy: sorted.filter(m => m.fecha === today && m.tipo_movimiento === 'salida').length,
    valorMes: sorted
      .filter(m => (m.fecha || '').startsWith(monthStart) && m.tipo_movimiento === 'entrada')
      .reduce((s, m) => s + (Number(m.precio_unitario_real || 0) * Number(m.cantidad || 0)), 0),
  }), [sorted]);

  // ── Reversar movimiento de materiales ───────────────────
  const handleReversoMaterial = async (motivo) => {
    if (!reversoTarget) return;
    const original = reversoTarget;
    const material = materiales?.find(m => m.id === original.material_id);
    if (!material) throw new Error('Material no encontrado.');
    if (original.reversed_by_id) throw new Error('Este movimiento ya fue reversado.');
    if (original.reverses_id)    throw new Error('No se puede reversar un movimiento que ya es un reverso.');

    const tipoInv = invertirTipoMaterial(original.tipo_movimiento);
    // Crear movimiento de reverso (positivo, mismo cantidad pero tipo invertido)
    const nowIso = new Date().toISOString();
    const fecha = nowIso.slice(0, 10);
    const hora = nowIso.slice(11, 16);
    const reverso = await movHook.create({
      obra_id: original.obra_id,
      material_id: original.material_id,
      fecha, hora,
      tipo_movimiento: tipoInv,
      cantidad: Math.abs(Number(original.cantidad || 0)),
      unidad: original.unidad || material.unidad,
      responsable_id: original.responsable_id || null,
      proveedor_id: original.proveedor_id || null,
      documento_asociado: original.documento_asociado || null,
      precio_unitario_real: original.precio_unitario_real ?? null,
      observaciones: 'REVERSO: ' + motivo,
      reverses_id: original.id,
    });

    // Marcar el original
    try {
      await movHook.update(original.id, { reversed_by_id: reverso.id });
    } catch (e) {
      // fallback directo a Dexie si update tira por algún wasAlreadyPending edge case
      await window.__db.movimientos_materiales.update(original.id, { reversed_by_id: reverso.id });
    }

    // Ajustar stock del material: aplicar delta opuesto al original
    const deltaOriginal = deltaStockMaterial(original.tipo_movimiento, original.cantidad);
    const deltaReverso = -deltaOriginal;
    const nuevoStock = (material.stock_actual ?? 0) + deltaReverso;
    const min = Number(material.stock_minimo || 0);
    const nuevaAlerta = nuevoStock <= 0 ? 'sin_stock'
      : (min > 0 && nuevoStock <= min * 0.5) ? 'critico'
      : (min > 0 && nuevoStock <= min) ? 'reponer' : 'ok';
    await window.__db.materiales.update(original.material_id, {
      stock_actual: nuevoStock,
      alerta: nuevaAlerta,
    });

    try {
      await window.__logAudit?.({
        action: 'insert',
        table: 'movimientos_materiales',
        recordId: reverso.id,
        newData: reverso,
        reason: `Reverso del movimiento ${original.id}: ${motivo}`,
      });
    } catch (e) {}

    setReversoTarget(null);
    movHook.refresh && movHook.refresh();
    showToast('Movimiento reversado correctamente', 'green');
  };

  const reversedSet = uMM(() => {
    const s = new Set();
    (movs || []).forEach(m => { if (m.reverses_id) s.add(m.reverses_id); });
    return s;
  }, [movs]);

  if (!obraId) return <SinObraEmpty icon="arrowIn"/>;
  if (loading) return <div className="page-wrap"><div className="empty-state"><JxIcon name="arrowIn" size={32} color="var(--tm)"/><p>Cargando movimientos…</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div><div className="pg-title">Movimiento de Materiales</div><div className="pg-sub">Historial completo · {sorted.length} movimientos registrados</div></div>
        <button className="btn btn-ghost btn-sm" onClick={()=>setRegFisicoOpen(true)} title="Ver fotos adjuntas a los movimientos">
          <JxIcon name="camera" size={13}/> Visualización registro físico
        </button>
      </div>
      {regFisicoOpen && (
        <RegistroFisicoModal modulo="movimientos_materiales" obraId={obraId}
          onClose={()=>setRegFisicoOpen(false)} showToast={showToast}/>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:18 }}>
        {[
          { label:'Total Movimientos', val:stats.total.toLocaleString('es-PE'), color:'var(--blue)' },
          { label:'Entradas Hoy',      val:stats.entradasHoy.toLocaleString('es-PE'), color:'var(--green)' },
          { label:'Salidas Hoy',       val:stats.salidasHoy.toLocaleString('es-PE'),  color:'var(--orange)' },
          { label:'Valor Entradas Mes', val:fmtS(stats.valorMes), color:'var(--amber)' },
        ].map((s,i)=>(
          <div key={i} className="card card-p"><div style={{ fontSize:11, color:'var(--tm)' }}>{s.label}</div><div style={{ fontSize:24, fontWeight:800, color:s.color, margin:'4px 0' }}>{s.val}</div></div>
        ))}
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
        <div className="search-bar"><JxIcon name="search" size={14} color="var(--tm)"/><input placeholder="Buscar material o documento…" value={q} onChange={e=>setQ(e.target.value)}/></div>
        {['todos','entrada','salida','ajuste','devolucion','merma'].map(t=>(
          <button key={t} onClick={()=>setTipo(t)} className={`btn btn-sm ${tipo===t?'btn-amber':'btn-ghost'}`}>
            {t==='todos' ? 'Todos' : MOV_MAT_TIPO[t]?.lbl || t}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card card-p empty-state"><JxIcon name="arrowIn" size={40} color="var(--tm)"/><p>No hay movimientos {tipo!=='todos' || q ? 'que coincidan con el filtro' : 'registrados aún'}.</p></div>
      ) : (
      <div className="card" style={{ overflow:'hidden' }}>
        <div style={{ overflowX:'auto' }}>
          <table className="tbl">
            <thead><tr>
              <th>Fecha / Hora</th><th>Tipo</th><th>Material</th>
              <th style={{ textAlign:'right' }}>Cantidad</th>
              <th>Responsable</th><th>Documento</th>
              <th style={{ textAlign:'right' }}>Precio</th>
              <th style={{ textAlign:'center' }}>Guía</th>
              <th>Sync</th>
              {isAdmin && <th style={{ textAlign:'center' }}>Acción</th>}
            </tr></thead>
            <tbody>
              {filtered.map(m=>{
                const t = MOV_MAT_TIPO[m.tipo_movimiento] || MOV_MAT_TIPO.ajuste;
                const mat = lookupMat(m.material_id);
                const pers = lookupPers(m.responsable_id);
                const prov = lookupProv(m.proveedor_id);
                const yaReversado = !!m.reversed_by_id || reversedSet.has(m.id);
                const esReverso = !!m.reverses_id;
                const reversoOriginalShort = esReverso ? String(m.reverses_id).slice(0, 6) : '';
                const puedeReversar = isAdmin && !yaReversado && !esReverso;
                return (
                  <tr key={m.id} style={{ opacity: yaReversado ? 0.55 : 1 }}>
                    <td className="col-m">{m.fecha || '—'}<br/><span style={{ fontSize:11 }}>{m.hora || ''}</span></td>
                    <td>
                      <span className={`badge ${t.cls}`}><JxIcon name={t.icon} size={10}/>{t.lbl}</span>
                      {yaReversado && <div style={{ marginTop:4 }}><span className="badge b-gray" title="Este movimiento fue reversado">Reversado</span></div>}
                      {esReverso && <div style={{ marginTop:4 }}><span className="badge b-amber" title={`Reverso del movimiento ${m.reverses_id}`}>Reverso de #{reversoOriginalShort}</span></div>}
                    </td>
                    <td className="col-p">{mat?.nombre_material || '(material eliminado)'}</td>
                    <td style={{ textAlign:'right' }} className="col-num">{Number(m.cantidad || 0).toLocaleString('es-PE')} <span style={{ color:'var(--tm)', fontSize:11 }}>{m.unidad || mat?.unidad || ''}</span></td>
                    <td>{pers ? `${pers.nombres} ${pers.apellidos}` : (prov?.razon_social || '—')}</td>
                    <td className="col-m">{m.documento_asociado || '—'}</td>
                    <td style={{ textAlign:'right' }} className="col-num">{m.precio_unitario_real ? fmtS(m.precio_unitario_real) : '—'}</td>
                    <td style={{ textAlign:'center' }}>
                      {(() => {
                        const guia = guiasPorMov.get(m.id);
                        if (guia) {
                          return (
                            <button className="btn btn-ghost btn-xs" onClick={()=>verGuia(guia)}
                              title={`Ver: ${guia.nombre_archivo}`}>
                              <JxIcon name="file" size={11} color="var(--green)"/>
                            </button>
                          );
                        }
                        // Permitir adjuntar solo en entradas (donde tiene sentido tener factura/guía)
                        if (m.tipo_movimiento !== 'entrada') {
                          return <span style={{ fontSize:10, color:'var(--tm)' }}>—</span>;
                        }
                        return (
                          <label className="btn btn-ghost btn-xs" title="Adjuntar guía o factura (solo una vez)" style={{ cursor:'pointer' }}>
                            <JxIcon name="upload" size={11}/>
                            <input type="file" accept="image/*,.pdf"
                              style={{ display:'none' }}
                              onChange={adjuntarGuia(m)}/>
                          </label>
                        );
                      })()}
                    </td>
                    <td>{m.sync_status && m.sync_status !== 'synced'
                      ? <span className="badge b-amber" title={m.sync_status}>⏱</span>
                      : <span style={{color:'var(--green)',fontSize:11}}>✓</span>}
                    </td>
                    {isAdmin && (
                      <td style={{ textAlign:'center', whiteSpace:'nowrap' }}>
                        {puedeReversar ? (
                          <button className="btn btn-red btn-xs" title="Reversar movimiento" onClick={()=>setReversoTarget(m)}>
                            <JxIcon name="arrowOut" size={10}/>Reversar
                          </button>
                        ) : (
                          <span style={{ fontSize:10, color:'var(--tm)' }}>—</span>
                        )}
                        {canDelete && (
                          <button className="btn btn-ghost btn-xs" title="Eliminar (solo modo edición)" onClick={()=>handleDeleteMov(m)} style={{ marginLeft:4, color:'var(--red)' }}>
                            <JxIcon name="trash" size={10}/>
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding:'10px 16px', borderTop:'1px solid var(--border)', fontSize:11.5, color:'var(--tm)' }}>
          Mostrando {filtered.length} de {sorted.length} movimientos
        </div>
      </div>
      )}

      {reversoTarget && (
        <ReversoModal
          mov={reversoTarget}
          tipo="mat"
          lookupNombre={(m)=>lookupMat(m.material_id)?.nombre_material || '(material)'}
          onClose={()=>setReversoTarget(null)}
          onConfirm={handleReversoMaterial}
        />
      )}
    </div>
  );
}

// ─── MOV. HERRAMIENTAS PAGE ───────────────────────────────
function MovHerramientasPage({ showToast }) {
  const obraId = useObraActiva();
  const auth = window.__useAuth ? window.__useAuth() : null;
  const movHook = window.__hooks.useMovimientosHerramientas(obraId);
  const { data: movs, loading, update: updateMov } = movHook;
  const { data: herramientas, update: updateHerr } = window.__hooks.useHerramientas(obraId);
  const { data: personal } = window.__hooks.usePersonal(obraId);
  const appMode = window.__useAppMode ? window.__useAppMode() : { isPrueba: true };

  const [reversoTarget, setReversoTarget] = uSM(null);
  const isAdmin = auth?.profile?.rol === 'admin';
  const canDelete = isAdmin && (appMode.isEdicion || appMode.isPrueba);

  const handleDeleteMov = async (m) => {
    if (!canDelete) return;
    const herr = herramientas?.find(h => h.id === m.herramienta_id);
    const nombre = herr?.nombre_herramienta || '(herramienta)';
    if (!confirm(`¿Eliminar este movimiento?\n\n${m.accion} de "${nombre}"\nFecha: ${m.fecha}\n\nEl estado de la herramienta NO se reajusta — usa "Reversar" si quieres compensar.`)) return;
    try {
      await updateMov(m.id, { deleted_at: new Date().toISOString() });
      try { await window.__logAudit?.({ action:'delete', table:'movimientos_herramientas', recordId:m.id, oldData:m, reason:'Eliminación manual (modo edición)' }); } catch(e) {}
      showToast('Movimiento eliminado', 'amber');
    } catch (e) { showToast('Error al eliminar: ' + (e.message||e), 'red'); }
  };

  const [q, setQ] = uSM('');
  const [accion, setAccion] = uSM('todas');
  const [regFisicoOpen, setRegFisicoOpen] = uSM(false);

  const lookupHerr = (id) => herramientas?.find(h => h.id === id);
  const lookupPers = (id) => personal?.find(p => p.id === id);

  const sorted = uMM(() => {
    if (!movs) return [];
    // Excluir movimientos eliminados (soft delete)
    return movs.filter(m => !m.deleted_at).sort((a, b) => {
      const fa = (a.fecha || '') + ' ' + (a.hora || '');
      const fb = (b.fecha || '') + ' ' + (b.hora || '');
      return fb.localeCompare(fa);
    });
  }, [movs]);

  const filtered = uMM(() => {
    return sorted.filter(m => {
      const matchA = accion === 'todas' || m.accion === accion;
      if (!matchA) return false;
      if (!q) return true;
      const ql = q.toLowerCase();
      const h = lookupHerr(m.herramienta_id);
      const p = lookupPers(m.responsable_id);
      return (h?.nombre_herramienta || '').toLowerCase().includes(ql) ||
             (p ? `${p.nombres} ${p.apellidos}`.toLowerCase().includes(ql) : false);
    });
  }, [sorted, q, accion, herramientas, personal]);

  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7*24*60*60*1000).toISOString().slice(0, 10);

  const stats = uMM(() => ({
    total: sorted.length,
    salidasHoy: sorted.filter(m => m.fecha === today && m.accion === 'salida').length,
    devolHoy: sorted.filter(m => m.fecha === today && m.accion === 'entrada').length,
    danadas: sorted.filter(m => m.estado_devolucion === 'malo').length,
  }), [sorted]);

  const danadasRecientes = uMM(() =>
    sorted.filter(m => m.estado_devolucion === 'malo' && (m.fecha || '') >= sevenDaysAgo)
  , [sorted]);

  // ── Reversar movimiento de herramientas ──────────────────
  const reversedSet = uMM(() => {
    const s = new Set();
    (movs || []).forEach(m => { if (m.reverses_id) s.add(m.reverses_id); });
    return s;
  }, [movs]);

  const handleReversoHerramienta = async (motivo) => {
    if (!reversoTarget) return;
    const original = reversoTarget;
    if (original.reversed_by_id) throw new Error('Este movimiento ya fue reversado.');
    if (original.reverses_id)    throw new Error('No se puede reversar un movimiento que ya es un reverso.');

    const nowIso = new Date().toISOString();
    const fecha = nowIso.slice(0, 10);
    const hora = nowIso.slice(11, 16);
    const accionInv = invertirAccionHerramienta(original.accion);

    const reverso = await movHook.create({
      obra_id: original.obra_id,
      herramienta_id: original.herramienta_id,
      fecha, hora,
      accion: accionInv,
      responsable_id: original.responsable_id || null,
      estado_salida: original.estado_salida || null,
      estado_devolucion: original.estado_devolucion || null,
      observaciones: 'REVERSO: ' + motivo,
      reverses_id: original.id,
    });

    try {
      await movHook.update(original.id, { reversed_by_id: reverso.id });
    } catch (e) {
      await window.__db.movimientos_herramientas.update(original.id, { reversed_by_id: reverso.id });
    }

    // Ajustar estado/disponibilidad de la herramienta. Usar updateHerr (vía hook)
    // para que sync_status='pending_update' y el cambio llegue a Supabase.
    try {
      const h = herramientas?.find(x => x.id === original.herramienta_id);
      if (h) {
        const patch = { fecha_ultimo_movimiento: fecha };
        if (accionInv === 'entrada' || accionInv === 'reposicion') {
          patch.disponible = true;
          patch.ubicacion_actual = 'almacen';
          patch.ultimo_responsable_id = null;
        }
        if (accionInv === 'salida') {
          patch.disponible = false;
          patch.ubicacion_actual = 'en_uso';
          patch.ultimo_responsable_id = original.responsable_id || null;
        }
        if (accionInv === 'mantenimiento') {
          patch.disponible = false;
          patch.ubicacion_actual = 'mantenimiento';
          patch.estado_actual = 'mantenimiento';
        }
        if (accionInv === 'baja') {
          patch.disponible = false;
          patch.ubicacion_actual = 'baja';
          patch.estado_actual = 'baja';
        }
        await updateHerr(h.id, patch);
      }
    } catch (e) { console.warn('No se pudo sincronizar el estado de la herramienta tras reverso:', e?.message); }

    try {
      await window.__logAudit?.({
        action: 'insert',
        table: 'movimientos_herramientas',
        recordId: reverso.id,
        newData: reverso,
        reason: `Reverso del movimiento ${original.id}: ${motivo}`,
      });
    } catch (e) {}

    setReversoTarget(null);
    movHook.refresh && movHook.refresh();
    showToast('Movimiento reversado correctamente', 'green');
  };

  if (!obraId) return <SinObraEmpty icon="tool"/>;
  if (loading) return <div className="page-wrap"><div className="empty-state"><JxIcon name="tool" size={32} color="var(--tm)"/><p>Cargando movimientos…</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div><div className="pg-title">Movimiento de Herramientas</div><div className="pg-sub">Historial de salidas, devoluciones y mantenimientos · {sorted.length} registros</div></div>
        <button className="btn btn-ghost btn-sm" onClick={()=>setRegFisicoOpen(true)} title="Ver fotos adjuntas a los movimientos">
          <JxIcon name="camera" size={13}/> Visualización registro físico
        </button>
      </div>
      {regFisicoOpen && (
        <RegistroFisicoModal modulo="movimientos_herramientas" obraId={obraId}
          onClose={()=>setRegFisicoOpen(false)} showToast={showToast}/>
      )}

      {danadasRecientes.length > 0 && (
        <div className="alert-banner" style={{ marginBottom:14, background:'rgba(231,76,60,0.08)', border:'1px solid rgba(231,76,60,0.25)', borderRadius:8, padding:'10px 14px', display:'flex', alignItems:'center', gap:10, color:'var(--red)', fontSize:12.5 }}>
          <JxIcon name="alert" size={14} color="var(--red)"/>
          <span><strong>{danadasRecientes.length}</strong> herramienta{danadasRecientes.length>1?'s':''} devuelta{danadasRecientes.length>1?'s':''} en mal estado en los últimos 7 días.</span>
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:18 }}>
        {[
          { label:'Total Movimientos',     val:stats.total.toLocaleString('es-PE'),       color:'var(--blue)' },
          { label:'Salidas Hoy',           val:stats.salidasHoy.toLocaleString('es-PE'),  color:'var(--amber)' },
          { label:'Devoluciones Hoy',      val:stats.devolHoy.toLocaleString('es-PE'),    color:'var(--green)' },
          { label:'Herramientas Dañadas',  val:stats.danadas.toLocaleString('es-PE'),     color:'var(--red)' },
        ].map((s,i)=>(
          <div key={i} className="card card-p"><div style={{ fontSize:11, color:'var(--tm)' }}>{s.label}</div><div style={{ fontSize:26, fontWeight:800, color:s.color, margin:'4px 0' }}>{s.val}</div></div>
        ))}
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
        <div className="search-bar"><JxIcon name="search" size={14} color="var(--tm)"/><input placeholder="Buscar herramienta o responsable…" value={q} onChange={e=>setQ(e.target.value)}/></div>
        {['todas','salida','entrada','mantenimiento','baja','reposicion'].map(a=>(
          <button key={a} onClick={()=>setAccion(a)} className={`btn btn-sm ${accion===a?'btn-amber':'btn-ghost'}`}>
            {a==='todas' ? 'Todas' : MOV_HER_ACCION[a]?.lbl || a}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card card-p empty-state"><JxIcon name="tool" size={40} color="var(--tm)"/><p>No hay movimientos {accion!=='todas' || q ? 'que coincidan con el filtro' : 'registrados aún'}.</p></div>
      ) : (
      <div className="card" style={{ overflow:'hidden' }}>
        <div style={{ overflowX:'auto' }}>
          <table className="tbl">
            <thead><tr>
              <th>Fecha / Hora</th><th>Herramienta</th><th>Acción</th>
              <th>Responsable</th><th>Estado Salida</th><th>Estado Devol.</th>
              <th>Observaciones</th><th>Sync</th>
              {isAdmin && <th style={{ textAlign:'center' }}>Acción</th>}
            </tr></thead>
            <tbody>
              {filtered.map(m=>{
                const a = MOV_HER_ACCION[m.accion] || MOV_HER_ACCION.salida;
                const h = lookupHerr(m.herramienta_id);
                const p = lookupPers(m.responsable_id);
                const danado = m.estado_devolucion === 'malo';
                const yaReversado = !!m.reversed_by_id || reversedSet.has(m.id);
                const esReverso = !!m.reverses_id;
                const reversoOriginalShort = esReverso ? String(m.reverses_id).slice(0, 6) : '';
                const puedeReversar = isAdmin && !yaReversado && !esReverso;
                return (
                  <tr key={m.id} style={{ background: danado ? 'rgba(231,76,60,0.06)' : '', opacity: yaReversado ? 0.55 : 1 }}>
                    <td className="col-m">{m.fecha || '—'}<br/><span style={{ fontSize:11 }}>{m.hora || ''}</span></td>
                    <td className="col-p">{h?.nombre_herramienta || '(herramienta eliminada)'}</td>
                    <td>
                      <span className={`badge ${a.cls}`}><JxIcon name={a.icon} size={10}/>{a.lbl}</span>
                      {yaReversado && <div style={{ marginTop:4 }}><span className="badge b-gray" title="Movimiento reversado">Reversado</span></div>}
                      {esReverso && <div style={{ marginTop:4 }}><span className="badge b-amber" title={`Reverso del movimiento ${m.reverses_id}`}>Reverso de #{reversoOriginalShort}</span></div>}
                    </td>
                    <td>{p ? `${p.nombres} ${p.apellidos}` : '—'}</td>
                    <td>{m.estado_salida ? <span className={`badge ${EST_HER[m.estado_salida]||'b-gray'}`} style={{ textTransform:'capitalize' }}>{m.estado_salida}</span> : <span className="col-m">—</span>}</td>
                    <td>{m.estado_devolucion ? <span className={`badge ${EST_HER[m.estado_devolucion]||'b-gray'}`} style={{ textTransform:'capitalize' }}>{m.estado_devolucion}</span> : <span className="col-m">—</span>}</td>
                    <td className="col-m" style={{ color: danado?'var(--red)':'', fontSize:11 }}>{m.observaciones || '—'}</td>
                    <td>{m.sync_status && m.sync_status !== 'synced'
                      ? <span className="badge b-amber" title={m.sync_status}>⏱</span>
                      : <span style={{color:'var(--green)',fontSize:11}}>✓</span>}
                    </td>
                    {isAdmin && (
                      <td style={{ textAlign:'center', whiteSpace:'nowrap' }}>
                        {puedeReversar ? (
                          <button className="btn btn-red btn-xs" title="Reversar movimiento" onClick={()=>setReversoTarget(m)}>
                            <JxIcon name="arrowOut" size={10}/>Reversar
                          </button>
                        ) : (
                          <span style={{ fontSize:10, color:'var(--tm)' }}>—</span>
                        )}
                        {canDelete && (
                          <button className="btn btn-ghost btn-xs" title="Eliminar (solo modo edición)" onClick={()=>handleDeleteMov(m)} style={{ marginLeft:4, color:'var(--red)' }}>
                            <JxIcon name="trash" size={10}/>
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding:'10px 16px', borderTop:'1px solid var(--border)', fontSize:11.5, color:'var(--tm)' }}>
          Mostrando {filtered.length} de {sorted.length} movimientos
        </div>
      </div>
      )}

      {reversoTarget && (
        <ReversoModal
          mov={reversoTarget}
          tipo="her"
          lookupNombre={(m)=>lookupHerr(m.herramienta_id)?.nombre_herramienta || '(herramienta)'}
          onClose={()=>setReversoTarget(null)}
          onConfirm={handleReversoHerramienta}
        />
      )}
    </div>
  );
}

// ─── PROVEEDORES PAGE ─────────────────────────────────────
function ProveedoresPage({ showToast }) {
  // Hooks SIEMPRE al top-level del componente, nunca dentro de handlers/callbacks
  // (llamarlos en un onClick rompe las reglas de React → minified error #321).
  const auth = window.__useAuth ? window.__useAuth() : null;
  const isAdmin = auth?.profile?.rol === 'admin';
  const appMode = window.__useAppMode ? window.__useAppMode() : { isPrueba: true };
  const canDelete = isAdmin && (appMode.isEdicion || appMode.isPrueba);

  const [provs, setProvs] = uSM([]);
  const [loading, setLoading] = uSM(true);
  const [requestTarget, setRequestTarget] = uSM(null);

  uEM(() => {
    const load = () => window.__db.proveedores.toArray().then(d => { setProvs((d||[]).filter(x => !x.deleted_at)); setLoading(false); });
    load();
    const interval = setInterval(load, 2000);
    return () => clearInterval(interval);
  }, []);

  const [q, setQ] = uSM('');
  const [modal, setModal] = uSM(false);
  const [form, setForm] = uSM({});
  const [editingId, setEditingId] = uSM(null);
  const [sunatBusy, setSunatBusy] = uSM(false);

  const filtered = uMM(() => {
    if (!q) return provs;
    const ql = q.toLowerCase();
    return provs.filter(p =>
      (p.razon_social || '').toLowerCase().includes(ql) ||
      (p.ruc || '').toLowerCase().includes(ql)
    );
  }, [q, provs]);

  const consultarSUNAT = async () => {
    const ruc = (form.ruc || '').trim();
    if (!/^\d{11}$/.test(ruc)) { showToast('Ingresa primero un RUC de 11 dígitos', 'red'); return; }
    setSunatBusy(true);
    try {
      const data = await window.__identity.consultarRUC(ruc);
      // Auto-rellenar campos vacíos del form (no pisa lo que el usuario ya escribió)
      setForm(prev => ({
        ...prev,
        razon_social: prev.razon_social?.trim() || data.razonSocial || prev.razon_social,
        direccion: prev.direccion?.trim() || data.direccion || prev.direccion,
      }));
      const estado = data.estado ? ` · ${data.estado}` : '';
      showToast(`SUNAT: ${data.razonSocial || 'datos cargados'}${estado}`, 'green');
    } catch (e) {
      showToast(e.message || 'Error al consultar SUNAT', 'red');
    } finally {
      setSunatBusy(false);
    }
  };

  const openEditProv = (p) => {
    setForm({
      razon_social: p.razon_social || '',
      ruc: p.ruc || '',
      contacto: p.contacto || '',
      telefono: p.telefono || '',
      correo: p.correo || '',
      tipo_proveedor: p.tipo_proveedor || '',
      direccion: p.direccion || '',
      observaciones: p.observaciones || '',
      estado: p.estado || 'activo',
    });
    setEditingId(p.id);
    setModal(true);
  };

  const handleDeleteProv = async (p) => {
    if (!canDelete) return;
    if (!confirm(`¿Eliminar el proveedor "${p.razon_social}"?\n\nLas referencias históricas en movimientos no se verán afectadas.`)) return;
    try {
      await window.__db.proveedores.update(p.id, {
        deleted_at: new Date().toISOString(),
        sync_status: p.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        updated_at: new Date().toISOString(),
        updated_by: auth?.profile?.id || 'offline',
        version: (p.version ?? 0) + 1,
      });
      try { await window.__logAudit?.({ action:'delete', table:'proveedores', recordId:p.id, oldData:p, reason:'Eliminación manual (modo edición)' }); } catch(e) {}
      showToast(`Proveedor "${p.razon_social}" eliminado`, 'amber');
      window.__db.proveedores.toArray().then(arr => setProvs(arr.filter(x => !x.deleted_at)));
    } catch (e) { showToast('Error al eliminar: ' + (e.message||e), 'red'); }
  };

  const handleSubmit = async () => {
    const razon = (form.razon_social || '').trim();
    const ruc = (form.ruc || '').trim();
    if (!razon) { showToast('Falta la razón social', 'red'); return; }
    if (!ruc) { showToast('Falta el RUC', 'red'); return; }
    if (!/^\d{11}$/.test(ruc)) { showToast('El RUC debe tener exactamente 11 dígitos numéricos', 'red'); return; }
    // Validar RUC único local (excluyendo el propio si edita)
    const existe = provs.find(p => p.ruc === ruc && p.id !== editingId);
    if (existe) { showToast('RUC ya registrado', 'red'); return; }
    try {
      const now = new Date().toISOString();
      if (editingId) {
        const existing = await window.__db.proveedores.get(editingId);
        const newFields = {
          razon_social: razon,
          ruc,
          contacto: form.contacto?.trim() || null,
          telefono: form.telefono?.trim() || null,
          correo: form.correo?.trim() || null,
          tipo_proveedor: form.tipo_proveedor || null,
          direccion: form.direccion?.trim() || null,
          observaciones: form.observaciones?.trim() || null,
          estado: form.estado || 'activo',
        };
        await window.__db.proveedores.update(editingId, {
          ...newFields,
          updated_at: now,
          updated_by: auth?.profile?.id || 'offline',
          version: (existing?.version ?? 0) + 1,
          sync_status: existing?.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
        try { await window.__logAudit?.({ action:'update', table:'proveedores', recordId:editingId, oldData:existing, newData:newFields }); } catch(e) {}
        showToast(`Proveedor "${razon}" actualizado`, 'green');
      } else {
        const newId = window.__newId();
        const record = {
          id: newId,
          razon_social: razon,
          ruc,
          contacto: form.contacto?.trim() || null,
          telefono: form.telefono?.trim() || null,
          correo: form.correo?.trim() || null,
          tipo_proveedor: form.tipo_proveedor || null,
          direccion: form.direccion?.trim() || null,
          observaciones: form.observaciones?.trim() || null,
          estado: 'activo',
          sync_status: 'pending_create',
          created_at: now,
          updated_at: now,
          version: 1,
          created_by: auth?.profile?.id || 'offline',
        };
        await window.__db.proveedores.add(record);
        try { await window.__logAudit?.({ action:'insert', table:'proveedores', recordId:newId, newData:record }); } catch(e) {}
        showToast(`Proveedor "${razon}" creado`, 'green');
      }
      setModal(false); setForm({}); setEditingId(null);
      window.__db.proveedores.toArray().then(setProvs);
    } catch (e) {
      if (String(e?.message || '').includes('23505') || String(e?.name || '') === 'ConstraintError') {
        showToast('RUC ya registrado', 'red');
      } else {
        showToast('Error: ' + e.message, 'red');
      }
    }
  };

  if (loading) return <div className="page-wrap"><div className="empty-state"><JxIcon name="truck" size={32} color="var(--tm)"/><p>Cargando proveedores…</p></div></div>;

  const activos = provs.filter(p => p.estado === 'activo').length;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div><div className="pg-title">Proveedores</div><div className="pg-sub">{provs.length} proveedores · {activos} activos</div></div>
        <button className="btn btn-amber btn-sm" onClick={()=>{setForm({}); setEditingId(null); setModal(true);}}><JxIcon name="plus" size={13}/>Nuevo Proveedor</button>
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:14 }}>
        <div className="search-bar"><JxIcon name="search" size={14} color="var(--tm)"/><input placeholder="Buscar por razón social o RUC…" value={q} onChange={e=>setQ(e.target.value)}/></div>
      </div>

      {provs.length === 0 ? (
        <div className="card card-p empty-state"><JxIcon name="truck" size={40} color="var(--tm)"/><p>No hay proveedores registrados. Click en "Nuevo Proveedor".</p></div>
      ) : filtered.length === 0 ? (
        <div className="card card-p empty-state"><JxIcon name="search" size={40} color="var(--tm)"/><p>No se encontraron proveedores con ese criterio.</p></div>
      ) : (
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
        {filtered.map(p => (
          <div key={p.id} className="card card-p card-hover">
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10, gap:10 }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:14, fontWeight:700, color:'var(--tp)', marginBottom:3 }}>{p.razon_social}</div>
                <div style={{ fontSize:11, color:'var(--tm)' }}>RUC: <span className="col-m" style={{ color:'var(--ts)' }}>{p.ruc}</span></div>
              </div>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6, flexShrink:0 }}>
                <span className={`badge ${p.estado==='activo'?'b-green':'b-gray'}`} style={{ textTransform:'capitalize' }}>{p.estado || 'activo'}</span>
                {isAdmin ? (
                  <div style={{ display:'flex', gap:4 }}>
                    <button className="btn btn-ghost btn-xs" title="Editar proveedor" onClick={()=>openEditProv(p)}>
                      <JxIcon name="edit" size={11}/>
                    </button>
                    {canDelete && (
                      <button className="btn btn-red btn-xs" title="Eliminar (solo modo edición)" onClick={()=>handleDeleteProv(p)}>
                        <JxIcon name="trash" size={11}/>
                      </button>
                    )}
                  </div>
                ) : (
                  <button className="btn btn-ghost btn-xs" title="Solicitar cambio" onClick={()=>setRequestTarget(p)}>
                    <JxIcon name="alert" size={11}/>
                  </button>
                )}
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8 }}>
              <div style={{ fontSize:11.5 }}>
                <div style={{ color:'var(--tm)', fontSize:10, marginBottom:2 }}>CONTACTO</div>
                <div style={{ color:'var(--ts)' }}>{p.contacto || '—'}</div>
              </div>
              <div style={{ fontSize:11.5 }}>
                <div style={{ color:'var(--tm)', fontSize:10, marginBottom:2 }}>TELÉFONO</div>
                <div style={{ color:'var(--ts)' }}>{p.telefono || '—'}</div>
              </div>
            </div>
            {p.tipo_proveedor && <div style={{ marginTop:6 }}><span className="tag">{p.tipo_proveedor}</span></div>}
            {p.sync_status && p.sync_status !== 'synced' && (
              <div style={{ marginTop:8 }}><span className="badge b-amber" title={p.sync_status}>⏱ {p.sync_status}</span></div>
            )}
          </div>
        ))}
      </div>
      )}

      {modal && <Modal title={editingId ? 'Editar Proveedor' : 'Nuevo Proveedor'} icon="truck" onClose={()=>{setModal(false); setEditingId(null); setForm({});}}>
        <div className="g2">
          <div style={{ gridColumn:'1/-1' }}><label className="flabel">Razón Social *</label><input className="fi" placeholder="Nombre de la empresa" value={form.razon_social||''} onChange={e=>setForm({...form, razon_social:e.target.value})}/></div>
          <div>
            <label className="flabel">RUC *</label>
            <div style={{ display:'flex', gap:6 }}>
              <input className="fi" placeholder="20XXXXXXXXX" inputMode="numeric" maxLength={11} value={form.ruc||''} onChange={e=>setForm({...form, ruc:e.target.value.replace(/\D/g,'').slice(0,11)})} style={{ flex:1 }}/>
              <button type="button" className="btn btn-blue btn-sm" disabled={sunatBusy || (form.ruc||'').length !== 11} onClick={consultarSUNAT} title="Consultar datos en SUNAT">
                <JxIcon name="search" size={12}/>{sunatBusy ? '...' : 'SUNAT'}
              </button>
            </div>
          </div>
          <div><label className="flabel">Tipo de Proveedor</label>
            <select className="fi" value={form.tipo_proveedor||''} onChange={e=>setForm({...form, tipo_proveedor:e.target.value})}>
              <option value="">— Selecciona —</option>
              <option>Aglomerantes</option><option>Acero</option><option>Agregados</option>
              <option>Madera</option><option>Sanitario</option><option>Eléctrico</option>
              <option>Albañilería</option><option>Acabados</option><option>Servicios</option>
              <option>Otro</option>
            </select>
          </div>
          <div><label className="flabel">Nombre de Contacto</label><input className="fi" placeholder="Nombre completo" value={form.contacto||''} onChange={e=>setForm({...form, contacto:e.target.value})}/></div>
          <div><label className="flabel">Teléfono</label><input className="fi" placeholder="01-XXX-XXXX" value={form.telefono||''} onChange={e=>setForm({...form, telefono:e.target.value})}/></div>
          <div style={{ gridColumn:'1/-1' }}><label className="flabel">Correo Electrónico</label><input className="fi" type="email" placeholder="correo@empresa.com" value={form.correo||''} onChange={e=>setForm({...form, correo:e.target.value})}/></div>
          <div style={{ gridColumn:'1/-1' }}><label className="flabel">Dirección</label><input className="fi" placeholder="Av. / Calle, número, distrito" value={form.direccion||''} onChange={e=>setForm({...form, direccion:e.target.value})}/></div>
          <div style={{ gridColumn:'1/-1' }}><label className="flabel">Observaciones</label><textarea className="fi" placeholder="Condiciones de pago, tiempos de entrega, etc." value={form.observaciones||''} onChange={e=>setForm({...form, observaciones:e.target.value})}/></div>
          {editingId && (
            <div><label className="flabel">Estado</label>
              <select className="fi" value={form.estado||'activo'} onChange={e=>setForm({...form, estado:e.target.value})}>
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </select>
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={()=>{setModal(false); setEditingId(null); setForm({});}}>Cancelar</button>
          <button className="btn btn-amber" onClick={handleSubmit}><JxIcon name="check" size={13}/>{editingId ? 'Guardar Cambios' : 'Guardar Proveedor'}</button>
        </div>
      </Modal>}

      {requestTarget && (
        <RequestChangeModal
          table="proveedores"
          record={requestTarget}
          recordLabel={requestTarget.razon_social || requestTarget.ruc}
          fields={[
            { key: 'razon_social', label: 'Razón Social' },
            { key: 'ruc', label: 'RUC' },
            { key: 'tipo_proveedor', label: 'Tipo' },
            { key: 'contacto', label: 'Contacto' },
            { key: 'telefono', label: 'Teléfono' },
            { key: 'correo', label: 'Correo' },
            { key: 'direccion', label: 'Dirección' },
            { key: 'estado', label: 'Estado', options: [
              { value: 'activo', label: 'Activo' }, { value: 'inactivo', label: 'Inactivo' },
            ]},
          ]}
          showToast={showToast}
          onClose={() => setRequestTarget(null)}
        />
      )}
    </div>
  );
}

Object.assign(window, { MovMaterialesPage, MovHerramientasPage, ProveedoresPage });
