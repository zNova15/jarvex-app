import React from "react";
import { calcAlerta } from "../lib/stock-utils.js";
import { getEvidenciaSrc } from "../lib/evidencias-url.js";
import { aplicarDelta } from "../lib/stock-ubicaciones.js";
import { eliminarMovimiento } from "../lib/eliminar-movimiento.js";
import { stockTrasEditar, dejaNegativo } from "../lib/stock-guard.js";
import { exportarDataset } from "../lib/export-historico.js";
import { FusionEntidadModal } from "./jx-fusion-entidad.jsx";
const { useState: uSM, useMemo: uMM, useEffect: uEM } = React;

// Botón "Exportar Excel" de las páginas de movimientos: descarga el dataset
// del export histórico (solo lectura — disponible para almaceneros también).
function BotonExportarMovs({ datasetId, obraId, showToast, label = 'Exportar Excel' }) {
  return (
    <button className="btn btn-ghost btn-sm" title="Descargar el Excel de estos movimientos (solo exporta — no modifica nada)"
      onClick={async () => {
        if (!obraId) { showToast?.('No hay obra activa', 'red'); return; }
        try {
          const obra = await window.__db.obras.get(obraId);
          const r = await exportarDataset(datasetId, obraId, obra?.nombre_obra || obra?.nombre || 'obra', {}, { porModo: true });
          showToast?.(`Exportado: ${r.filas} registros → ${r.archivo}`, 'green');
        } catch (e) { showToast?.('Error al exportar: ' + (e.message || e), 'red'); }
      }}>
      <JxIcon name="download" size={13}/> {label}
    </button>
  );
}

// Helper formato moneda
const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const JxIconRF = (props) => {
  const I = window.JxIcon;
  return I ? <I {...props}/> : null;
};

// Modal reusable (Super Admin / Admin): editar el FRENTE al que se atribuye un
// movimiento histórico. Sirve para materiales, herramientas, EPP, emergencia,
// maquinaria — cualquier movimiento que guarde frente_id. onSave recibe el
// frente_id elegido ('' = sin frente).
function EditarFrenteMovModal({ frenteActual, frentes, label, busy, onSave, onClose }) {
  const [sel, setSel] = React.useState(frenteActual || '');
  return (
    <Modal title="Editar frente del movimiento" icon="flag" onClose={onClose}>
      {label && <div style={{ fontSize: 12, color: 'var(--tm)', marginBottom: 8 }}>{label}</div>}
      <label className="flabel">Frente al que se envió</label>
      <select className="fi" value={sel} onChange={e => setSel(e.target.value)}>
        <option value="">— Sin frente —</option>
        {(frentes || []).map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
      </select>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-amber" disabled={busy} onClick={() => onSave(sel)}>Guardar frente</button>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════
// REGISTRO FÍSICO DIARIO
// Flujo: el almacenero al final del día firma su registro físico (hoja
// con todos los movimientos del día) y sube UNA foto. El admin puede
// subir/editar libremente.
//   - tipo_evidencia: 'registro_diario_materiales' | 'registro_diario_herramientas'
//   - 1 por día por obra para no-admin (validado al subir)
//   - Modal de visualización: tabla con fecha + foto + autor + notas
//     + acciones (ver foto / solicitar cambio / eliminar admin)
// ═══════════════════════════════════════════════════════════════════
const tipoEvidenciaPara = (modulo) => modulo === 'movimientos_materiales'
  ? 'registro_diario_materiales' : 'registro_diario_herramientas';

function RegistroFisicoModal({ modulo, obraId, onClose, showToast, refreshKey }) {
  const auth = window.__useAuth?.();
  const rol = auth?.profile?.rol || '';
  const isAdmin = rol === 'admin';
  const tipoEv = tipoEvidenciaPara(modulo);
  const [evidencias, setEvidencias] = uSM([]);
  const [personal, setPersonal] = uSM([]);
  const [thumbs, setThumbs] = uSM({});
  const [fDesde, setFDesde] = uSM('');
  const [fHasta, setFHasta] = uSM('');
  const [fNombre, setFNombre] = uSM('');
  const [photoOpen, setPhotoOpen] = uSM(null);
  const [solicitudOpen, setSolicitudOpen] = uSM(null);
  const [loading, setLoading] = uSM(true);

  uEM(() => {
    let cancelled = false;
    // Revocamos los objectURL CREADOS en esta corrida (no el estado `thumbs`, que
    // en el cleanup es el valor stale de la closure → fugaba las URLs nuevas).
    const creadas = [];
    (async () => {
      try {
        const [evs, allPers] = await Promise.all([
          window.__db.evidencias.filter(e =>
            !e.deleted_at &&
            e.tipo_evidencia === tipoEv &&
            (!obraId || e.obra_id === obraId)
          ).toArray(),
          window.__db.personal.filter(p => !p.deleted_at).toArray(),
        ]);
        if (cancelled) return;
        setEvidencias(evs.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')));
        setPersonal(allPers);
        const thumbsMap = {};
        for (const ev of evs.slice(0, 30)) {
          try {
            const blobEntry = await window.__db.evidencias_blobs.get(ev.id);
            if (blobEntry?.blob) { const u = URL.createObjectURL(blobEntry.blob); creadas.push(u); thumbsMap[ev.id] = u; }
          } catch {}
        }
        if (!cancelled) setThumbs(thumbsMap);
        else creadas.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
      } catch (e) { console.error('[regfisico]', e); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => {
      cancelled = true;
      creadas.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
    };
  }, [modulo, obraId, refreshKey]);

  const filtered = uMM(() => {
    return evidencias.filter(ev => {
      if (fDesde && (ev.fecha || '') < fDesde) return false;
      if (fHasta && (ev.fecha || '') > fHasta) return false;
      if (fNombre) {
        const q = fNombre.toLowerCase();
        const autor = personal.find(p => p.id === ev.subido_por || p.id === ev.created_by);
        const buf = [
          autor ? `${autor.nombres} ${autor.apellidos}` : '',
          ev.observaciones || '',
          ev.nombre_archivo || '',
        ].join(' ').toLowerCase();
        if (!buf.includes(q)) return false;
      }
      return true;
    });
  }, [evidencias, fDesde, fHasta, fNombre, personal]);

  const verFoto = async (ev) => {
    try {
      // Blob local o signed URL del bucket privado (cross-device).
      const src = await getEvidenciaSrc(ev);
      if (src?.url) {
        setPhotoOpen({ url: src.url, ev });
      } else {
        showToast?.('Foto no disponible', 'amber');
      }
    } catch (e) {
      showToast?.('Error: ' + e.message, 'red');
    }
  };

  const enviarSolicitud = async () => {
    const { evidencia, motivo } = solicitudOpen;
    if (!motivo || motivo.trim().length < 10) {
      showToast?.('El motivo debe tener al menos 10 caracteres', 'red');
      return;
    }
    try {
      await window.__changeRequests.create({
        table: 'evidencias',
        recordId: evidencia.id,
        recordLabel: `Registro diario · ${evidencia.fecha}`,
        proposedChanges: {
          revisar: { old: 'registro original', new: 'verificar y corregir según foto adjunta' },
          motivo_solicitante: { old: '', new: motivo.trim() },
          evidencia_id: { old: '', new: evidencia.id },
          fecha_registro: { old: '', new: evidencia.fecha },
        },
        reason: motivo.trim(),
      });
      showToast?.('✓ Solicitud enviada al administrador', 'green');
      setSolicitudOpen(null);
    } catch (e) {
      showToast?.('Error: ' + e.message, 'red');
    }
  };

  const eliminarRegistro = async (ev) => {
    if (!isAdmin) return;
    if (!confirm(`¿Eliminar el registro diario del ${ev.fecha}?`)) return;
    try {
      await window.__db.evidencias.update(ev.id, { deleted_at: new Date().toISOString() });
      try { await window.__db.evidencias_blobs.delete(ev.id); } catch {}
      try { await window.__logAudit?.({ action:'delete', table:'evidencias', recordId:ev.id, oldData:ev, reason:'Admin eliminó registro diario' }); } catch {}
      setEvidencias(prev => prev.filter(e => e.id !== ev.id));
      showToast?.('Registro eliminado', 'amber');
    } catch (e) { showToast?.('Error: ' + e.message, 'red'); }
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
              <label className="flabel" style={{ fontSize:10 }}>Buscar (autor / observación)</label>
              <input className="fi" value={fNombre} onChange={e=>setFNombre(e.target.value)} placeholder="ej: Carlos Quispe..." style={{ fontSize:12, padding:'6px 8px' }}/>
            </div>
            <div style={{ display:'flex', alignItems:'flex-end' }}>
              <span style={{ fontSize:11, color:'var(--tm)' }}>{filtered.length} registros diarios</span>
            </div>
          </div>
          <div style={{ flex:1, overflow:'auto', border:'1px solid var(--bd)', borderRadius:6 }}>
            {loading ? (
              <div style={{ padding:30, textAlign:'center', color:'var(--tm)' }}>Cargando…</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding:30, textAlign:'center', color:'var(--tm)' }}>
                <JxIconRF name="camera" size={32} color="var(--tm)"/>
                <div style={{ marginTop:8 }}>No hay registros diarios subidos aún.</div>
                <div style={{ fontSize:11, marginTop:4 }}>El almacenero sube 1 foto por día con el registro físico firmado.</div>
              </div>
            ) : (
              <table className="tbl" style={{ fontSize:12 }}>
                <thead><tr>
                  <th style={{ width:80 }}>Foto</th>
                  <th>Fecha</th>
                  <th>Subido por</th>
                  <th>Notas</th>
                  <th>Tamaño</th>
                  <th style={{ textAlign:'center' }}>Acciones</th>
                </tr></thead>
                <tbody>
                  {filtered.map(ev => {
                    const autor = personal.find(p => p.id === ev.subido_por || p.id === ev.created_by);
                    return (
                      <tr key={ev.id}>
                        <td>
                          {thumbs[ev.id]
                            ? <img src={thumbs[ev.id]} alt="thumb"
                                onClick={()=>verFoto(ev)}
                                style={{ width:60, height:60, objectFit:'cover', borderRadius:4, cursor:'pointer', border:'1px solid var(--bd)' }}/>
                            : <span style={{ color:'var(--tm)' }}>—</span>}
                        </td>
                        <td className="col-m" style={{ fontWeight:600 }}>{ev.fecha || '—'}</td>
                        <td>{autor ? `${autor.nombres} ${autor.apellidos}` : <span style={{ color:'var(--tm)' }}>—</span>}</td>
                        <td style={{ fontSize:11, color:'var(--tm)', maxWidth:280 }}>{ev.observaciones || '—'}</td>
                        <td style={{ fontSize:11, color:'var(--tm)' }}>{ev.tamano_bytes ? (ev.tamano_bytes/1024).toFixed(0) + ' KB' : '—'}</td>
                        <td style={{ textAlign:'center', whiteSpace:'nowrap' }}>
                          <button className="btn btn-ghost btn-xs" title="Ver foto" onClick={()=>verFoto(ev)}>
                            <JxIconRF name="eye" size={11}/>
                          </button>
                          {!isAdmin && (
                            <button
                              className="btn btn-amber btn-xs"
                              title="Solicitar al admin que revise/corrija este registro"
                              style={{ marginLeft:4 }}
                              onClick={()=>setSolicitudOpen({ evidencia: ev, motivo: '' })}>
                              <JxIconRF name="alert" size={11}/> Solicitar cambio
                            </button>
                          )}
                          {isAdmin && (
                            <button
                              className="btn btn-red btn-xs"
                              title="Eliminar este registro diario"
                              style={{ marginLeft:4 }}
                              onClick={()=>eliminarRegistro(ev)}>
                              <JxIconRF name="trash" size={11}/>
                            </button>
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

// Almacenes de una fila de movimiento (materiales/herramientas): la fila
// guarda UNA ubicación (salida = de dónde sale; entrada/devolución = a dónde
// llega). Si es pata de un TRASPASO, el otro lado viene anotado en
// observaciones ('Traspaso → X' / 'Traspaso ← Y'). Formato legado del
// traspaso de materiales: 'Traspaso Origen → Destino' (ambos lados en la
// observación, fila sin ubicacion_id).
function almacenesDeMov(m, ubicNombre) {
  const ubic = m.ubicacion_id ? (ubicNombre.get(m.ubicacion_id) || null) : null;
  const obs = String(m.observaciones || '');
  const haciaTr = obs.match(/Traspaso → ([^·]+)/);
  const desdeTr = obs.match(/Traspaso ← ([^·]+)/);
  if (!haciaTr && !desdeTr) {
    const par = obs.match(/Traspaso ([^·→←]+) → ([^·]+)/);
    if (par) return { salida: par[1].trim(), llegada: par[2].trim(), esTraspaso: true };
  }
  const tipo = m.accion || m.tipo_movimiento;
  // 'baja' y 'mantenimiento' (acciones legales del CHECK de herramientas,
  // hoy solo en data legacy/reversos) también son stock que SALE del almacén.
  const esSalida = tipo === 'salida' || tipo === 'merma' || tipo === 'baja' || tipo === 'mantenimiento';
  return {
    salida: esSalida ? ubic : (desdeTr ? desdeTr[1].trim() : null),
    llegada: !esSalida ? ubic : (haciaTr ? haciaTr[1].trim() : null),
    esTraspaso: !!(haciaTr || desdeTr),
  };
}

// La observación legible de un movimiento: saca la codificación de traspaso
// ('Traspaso A → B' / 'Traspaso → X' / 'Traspaso ← Y'), que ya se ve en las
// columnas de almacén, y deja la nota humana que escribió quien lo registró.
function obsLegible(m) {
  let s = String(m?.observaciones || '');
  s = s.replace(/Traspaso\s+[^·→←]*→\s*[^·]+/g, '')
       .replace(/Traspaso\s*→\s*[^·]+/g, '')
       .replace(/Traspaso\s*←\s*[^·]+/g, '');
  return s.split('·').map(x => x.trim()).filter(Boolean).join(' · ');
}

// Celda de observación compartida (truncada con tooltip del texto completo).
function CeldaObs({ texto }) {
  if (!texto) return <span style={{ color: 'var(--tm)', fontSize: 12 }}>—</span>;
  return <span title={texto} style={{ fontSize: 11, color: 'var(--tm)' }}>{texto.length > 70 ? texto.slice(0, 70) + '…' : texto}</span>;
}

// Celda de almacén compartida por las tablas de movimientos.
function CeldaAlmacen({ nombre, esTraspaso }) {
  if (!nombre) return <span style={{ color:'var(--tm)', fontSize:12 }}>—</span>;
  return <span className="tag" title={esTraspaso ? 'Parte de un traspaso entre almacenes' : 'Almacén'}>{esTraspaso ? '⇄ ' : ''}{nombre}</span>;
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
  entrada:       { cls:'b-green',  lbl:'Ingreso',       icon:'arrowIn'    },
  mantenimiento: { cls:'b-orange', lbl:'Mantenimiento', icon:'tool'       },
  baja:          { cls:'b-gray',   lbl:'Baja',          icon:'trash'      },
  reposicion:    { cls:'b-blue',   lbl:'Reposición',    icon:'plus'       },
};

// Badge fino: distingue INGRESO (compra/herramienta nueva) de DEVOLUCIÓN
// (retorno de un responsable). Ambos son accion='entrada' en el schema, pero
// el tipo_movimiento lleva la semántica. Cae a accion para datos viejos/importados.
function badgeMovHerr(m) {
  if (m.reverses_id || m.tipo_movimiento === 'reverso') return { cls:'b-gray', lbl:'Reverso', icon:'refresh' };
  if (m.tipo_movimiento === 'devolucion') return { cls:'b-blue',  lbl:'Devolución', icon:'arrowIn' };
  if (m.tipo_movimiento === 'ingreso')    return { cls:'b-green', lbl:'Ingreso',    icon:'arrowIn' };
  return MOV_HER_ACCION[m.accion] || MOV_HER_ACCION.salida;
}

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
          : `${badgeMovHerr(mov).lbl}${mov.cantidad != null && mov.cantidad !== '' ? ` de ${Number(mov.cantidad).toLocaleString('es-PE')}` : ''} de ${lookupNombre(mov)}`}</div>
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

// ═══════════════════════════════════════════════════════════════════
// MODAL "SUBIR REGISTRO DIARIO"
// El almacenero sube 1 foto/día (validado). Admin puede subir múltiples
// o reemplazar el del día.
// ═══════════════════════════════════════════════════════════════════
// Modo:
//   'hoy'      → almacenero sube el registro del día actual (no editable)
//   'cambio'   → almacenero pide cambio: puede ser por (a) atraso, día que
//                no se subió en su momento, o (b) corrección, registro ya
//                subido con fecha equivocada que hay que reemplazar.
//                Queda pendiente_aprobacion hasta que el admin apruebe.
function RegistroDiarioUploader({ modulo, obraId, onClose, onSaved, showToast, modo = 'hoy' }) {
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id ?? 'offline';
  const rol = auth?.profile?.rol || '';
  const isAdmin = rol === 'admin';
  const tipoEv = tipoEvidenciaPara(modulo);
  const hoy = new Date().toISOString().slice(0, 10);
  const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  // tipoCambio: 'atraso' (subir un día que se olvidó) | 'correccion' (reemplazar un registro existente con fecha equivocada).
  const [tipoCambio, setTipoCambio] = uSM('atraso');
  const [fecha, setFecha] = uSM(() => modo === 'cambio' ? ayer : hoy);
  const [motivoAtraso, setMotivoAtraso] = uSM('');
  const [foto, setFoto] = uSM(null);
  const [notas, setNotas] = uSM('');
  const [busy, setBusy] = uSM(false);
  const [yaExiste, setYaExiste] = uSM(false);
  const [registroExistente, setRegistroExistente] = uSM(null);
  // Para corrección: el almacenero elige cuál registro existente quiere reemplazar.
  const [registroACorregir, setRegistroACorregir] = uSM(null);
  const [registrosRecientes, setRegistrosRecientes] = uSM([]);

  // Cargar registros recientes para selector de corrección
  uEM(() => {
    if (modo !== 'cambio' || tipoCambio !== 'correccion') return;
    let cancelled = false;
    (async () => {
      try {
        const evs = await window.__db.evidencias.filter(e =>
          !e.deleted_at &&
          e.tipo_evidencia === tipoEv &&
          (!obraId || e.obra_id === obraId)
        ).toArray();
        if (cancelled) return;
        const sorted = evs.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')).slice(0, 30);
        setRegistrosRecientes(sorted);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [modo, tipoCambio, modulo, obraId, tipoEv]);

  // Validar si ya existe un registro de la fecha seleccionada (anti-duplicado para almacenero)
  uEM(() => {
    let cancelled = false;
    (async () => {
      try {
        const evs = await window.__db.evidencias.filter(e =>
          !e.deleted_at &&
          e.tipo_evidencia === tipoEv &&
          e.fecha === fecha &&
          (!obraId || e.obra_id === obraId)
        ).toArray();
        if (!cancelled) {
          setYaExiste(evs.length > 0);
          setRegistroExistente(evs[0] || null);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [fecha, modulo, obraId, tipoEv]);

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      showToast?.('Foto muy grande (máx 8 MB)', 'red');
      return;
    }
    if (foto?.url) try { URL.revokeObjectURL(foto.url); } catch {}
    setFoto({ blob: file, url: URL.createObjectURL(file) });
  };

  const handleSubmit = async () => {
    if (!foto?.blob) { showToast?.('Adjuntá una foto del registro físico', 'red'); return; }
    if (!fecha) { showToast?.('Seleccioná una fecha', 'red'); return; }
    // Validaciones por modo
    if (modo === 'hoy' && !isAdmin && fecha !== hoy) {
      showToast?.('Solo podés subir el registro del día actual', 'red'); return;
    }
    if (modo === 'cambio') {
      if (tipoCambio === 'atraso' && fecha >= hoy) {
        showToast?.('Para atrasos elegí una fecha anterior a hoy', 'red'); return;
      }
      if (tipoCambio === 'correccion' && !registroACorregir) {
        showToast?.('Elegí qué registro existente querés corregir', 'red'); return;
      }
      if (!motivoAtraso.trim() || motivoAtraso.trim().length < 10) {
        showToast?.(tipoCambio === 'correccion'
          ? 'Explicá qué hay que corregir (mín 10 caracteres)'
          : 'Explicá el motivo del atraso (mín 10 caracteres)', 'red');
        return;
      }
    }
    if (yaExiste && !isAdmin) {
      showToast?.('Ya existe un registro diario para esta fecha. Solo el admin puede reemplazarlo.', 'red');
      return;
    }
    setBusy(true);
    try {
      if (yaExiste && isAdmin && registroExistente) {
        await window.__db.evidencias.update(registroExistente.id, { deleted_at: new Date().toISOString() });
        try { await window.__db.evidencias_blobs.delete(registroExistente.id); } catch {}
      }
      const id = window.__newId();
      const esCambio = modo === 'cambio';
      const esCorreccion = esCambio && tipoCambio === 'correccion';
      // Almacenero pide cambio → queda pendiente de aprobación admin.
      // Admin sube directamente sin necesidad de aprobación.
      const necesitaAprobacion = esCambio && !isAdmin;
      const tipoCambioLabel = esCorreccion ? 'CORRECCIÓN' : (esCambio ? 'ATRASADO' : 'NORMAL');
      const obsBase = notas.trim() || `Registro diario · ${fecha}`;
      const obsFinal = esCambio
        ? `${obsBase}\n\n⏰ ${tipoCambioLabel} · motivo: ${motivoAtraso.trim()}${necesitaAprobacion ? ' · ⏳ pendiente aprobación admin' : ''}${esCorreccion && registroACorregir ? `\n· Reemplaza registro previo del ${registroACorregir.fecha}` : ''}`
        : obsBase;
      await window.__saveEvidenciaLocal({
        id, obra_id: obraId,
        tipo_evidencia: tipoEv,
        modulo_relacionado: modulo,
        registro_relacionado_id: esCorreccion ? registroACorregir?.id : null,
        nombre_archivo: foto.blob.name || `registro_${fecha}.jpg`,
        mime_type: foto.blob.type || 'image/jpeg',
        blob: foto.blob,
        observaciones: obsFinal,
        fecha,
        created_by: userId,
        registro_atrasado: esCambio && !esCorreccion || undefined,
        registro_correccion: esCorreccion || undefined,
        registro_id_a_corregir: esCorreccion ? registroACorregir?.id : undefined,
        motivo_atraso: esCambio ? motivoAtraso.trim() : undefined,
        pendiente_aprobacion: necesitaAprobacion || undefined,
      });
      try {
        await window.__logAudit?.({
          action: yaExiste ? 'update' : 'insert',
          table: 'evidencias',
          recordId: id,
          newData: { tipo_evidencia: tipoEv, fecha, obra_id: obraId, tipo_cambio: tipoCambio, pendiente: necesitaAprobacion },
          reason: necesitaAprobacion
            ? `Solicitud de cambio (${tipoCambioLabel.toLowerCase()}) · ${modulo} · ${fecha}`
            : `${yaExiste ? 'Reemplazado por admin' : 'Subida'} de registro diario · ${modulo}`,
        });
      } catch {}
      if (necesitaAprobacion) {
        try {
          const labelTipo = esCorreccion ? 'corrección' : 'atraso';
          await window.__changeRequests?.create({
            table: 'evidencias',
            recordId: id,
            recordLabel: `Registro diario ${labelTipo} · ${fecha} (${modulo === 'movimientos_materiales' ? 'Materiales' : 'Herramientas'})`,
            fields: {
              fecha,
              tipo_cambio: tipoCambio,
              motivo: motivoAtraso.trim(),
              modulo,
              obra_id: obraId,
              ...(esCorreccion && registroACorregir ? { registro_a_corregir_id: registroACorregir.id, fecha_original: registroACorregir.fecha } : {}),
            },
            reason: `Solicitud de ${labelTipo}: ${motivoAtraso.trim()}`,
          });
        } catch (e) { console.warn('change request no creada:', e); }
      }
      showToast?.(
        necesitaAprobacion
          ? `📤 Solicitud enviada al admin · ${tipoCambioLabel.toLowerCase()} (${fecha})`
          : `✓ Registro diario subido (${fecha})`,
        necesitaAprobacion ? 'amber' : 'green'
      );
      if (foto?.url) try { URL.revokeObjectURL(foto.url); } catch {}
      onSaved?.();
      onClose?.();
    } catch (e) {
      showToast?.('Error: ' + (e.message || e), 'red');
    } finally {
      setBusy(false);
    }
  };

  const cerrar = () => {
    if (foto?.url) try { URL.revokeObjectURL(foto.url); } catch {}
    onClose?.();
  };

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && cerrar()}
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:20 }}>
      <div className="card card-p" style={{ width:'100%', maxWidth:560, background:'#1A2333', border:'1px solid var(--bd)', borderRadius:10 }}>
        <div style={{ fontSize:14, fontWeight:700, marginBottom:10, display:'flex', alignItems:'center', gap:8 }}>
          <JxIconRF name={modo === 'cambio' ? 'edit' : 'camera'} size={15} color={modo === 'cambio' ? 'var(--blue)' : 'var(--amber)'}/>
          {modo === 'cambio'
            ? `Solicitar cambio · ${modulo === 'movimientos_materiales' ? 'Materiales' : 'Herramientas'}`
            : `Subir registro diario · ${modulo === 'movimientos_materiales' ? 'Materiales' : 'Herramientas'}`}
        </div>
        <div style={{ fontSize:12, color:'var(--ts)', marginBottom:14, padding:'10px 12px', background: modo === 'cambio' ? 'rgba(52,152,219,0.07)' : 'rgba(155,89,182,0.06)', borderRadius:6 }}>
          {modo === 'cambio'
            ? (isAdmin
                ? 'Como admin podés cargar/corregir registros directamente.'
                : 'Esto generará una solicitud al administrador. Explicá la razón. Tendrá que aprobarlo antes de quedar registrado.')
            : (isAdmin
                ? 'Como admin podés subir varios o reemplazar el registro del día.'
                : `Solo podés subir el registro del día de hoy (${hoy}). Si te atrasaste o te confundiste, usá "Solicitar cambio".`)}
        </div>

        {/* ── Selector de tipo de cambio (solo modo cambio) ── */}
        {modo === 'cambio' && (
          <div style={{ marginBottom:14 }}>
            <label className="flabel">¿Qué querés hacer?</label>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              <button type="button"
                className={`btn ${tipoCambio === 'atraso' ? 'btn-amber' : 'btn-ghost'} btn-sm`}
                onClick={()=>{ setTipoCambio('atraso'); setRegistroACorregir(null); setFecha(ayer); }}>
                <JxIconRF name="clock" size={11}/> Subir día atrasado
                <div style={{ fontSize:10, fontWeight:400, marginTop:2 }}>Día que se olvidó subir</div>
              </button>
              <button type="button"
                className={`btn ${tipoCambio === 'correccion' ? 'btn-amber' : 'btn-ghost'} btn-sm`}
                onClick={()=>setTipoCambio('correccion')}>
                <JxIconRF name="edit" size={11}/> Corregir registro existente
                <div style={{ fontSize:10, fontWeight:400, marginTop:2 }}>Subido con fecha equivocada</div>
              </button>
            </div>
          </div>
        )}

        {/* ── Selector de registro a corregir ── */}
        {modo === 'cambio' && tipoCambio === 'correccion' && (
          <div style={{ marginBottom:14 }}>
            <label className="flabel">Registro existente a reemplazar *</label>
            {registrosRecientes.length === 0 ? (
              <div className="fi" style={{ color:'var(--red)', fontSize:11.5 }}>
                No hay registros existentes para corregir. Probá "Subir día atrasado" en su lugar.
              </div>
            ) : (
              <select className="fi" value={registroACorregir?.id || ''}
                onChange={e=>{
                  const r = registrosRecientes.find(x => x.id === e.target.value);
                  setRegistroACorregir(r || null);
                  if (r) setFecha(r.fecha);
                }}>
                <option value="">— Seleccionar registro a corregir —</option>
                {registrosRecientes.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.fecha} · {(r.observaciones || '').slice(0, 50)}{(r.observaciones || '').length > 50 ? '…' : ''}
                  </option>
                ))}
              </select>
            )}
            <div style={{ fontSize:10, color:'var(--tm)', marginTop:3 }}>
              El admin va a ver el registro original y el nuevo, y decidirá si reemplaza.
            </div>
          </div>
        )}

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <div>
            <label className="flabel">Fecha del registro *</label>
            {modo === 'hoy' && !isAdmin ? (
              <input className="fi" type="date" value={hoy} disabled readOnly
                style={{ opacity: 0.7, cursor: 'not-allowed' }}/>
            ) : (
              <input className="fi" type="date" value={fecha} onChange={e=>setFecha(e.target.value)}
                max={modo === 'cambio' && tipoCambio === 'atraso' && !isAdmin ? ayer : (isAdmin ? undefined : hoy)}/>
            )}
          </div>
          <div style={{ display:'flex', alignItems:'flex-end' }}>
            {yaExiste && tipoCambio !== 'correccion' ? (
              <div style={{ fontSize:11, color: isAdmin ? 'var(--amber)' : 'var(--red)', padding:'6px 8px', background:'rgba(231,76,60,0.08)', borderRadius:6 }}>
                {isAdmin ? '⚠ Ya existe registro este día. Si subís uno nuevo, reemplaza el anterior.' : '⚠ Ya hay registro este día.'}
              </div>
            ) : <div style={{ fontSize:11, color:'var(--green)' }}>✓ Listo · podés subir</div>}
          </div>
        </div>

        {modo === 'cambio' && (
          <div style={{ marginTop:14 }}>
            <label className="flabel">{tipoCambio === 'correccion' ? 'Razón de la corrección *' : 'Motivo del atraso *'}</label>
            <textarea className="fi" rows={3} value={motivoAtraso} onChange={e=>setMotivoAtraso(e.target.value)}
              placeholder={tipoCambio === 'correccion'
                ? 'Ej: subí por error la hoja del 03/04 cuando debía ser del 04/04. La hoja correcta del 04 es la que adjunto ahora.'
                : 'Ej: el día anterior se cortó la luz al fin del turno y no pude tomar la foto antes de cerrar.'}
              minLength={10}/>
            <div style={{ fontSize:10, color:'var(--tm)', marginTop:3 }}>
              Mínimo 10 caracteres. El admin va a ver este motivo en su bandeja de Solicitudes.
            </div>
          </div>
        )}

        <div style={{ marginTop:14 }}>
          <label className="flabel">Foto del registro físico (firmado) *</label>
          <input type="file" accept="image/*" capture="environment" onChange={onFile}
            disabled={!isAdmin && yaExiste}/>
          {foto?.url && (
            <div style={{ marginTop:8, display:'flex', alignItems:'center', gap:10 }}>
              <img src={foto.url} alt="preview" style={{ width:120, height:120, objectFit:'cover', borderRadius:6, border:'1px solid var(--bd)' }}/>
              <div style={{ fontSize:11, color:'var(--tm)' }}>
                {foto.blob.name || 'Foto'}<br/>{(foto.blob.size/1024).toFixed(0)} KB
              </div>
              <button className="btn btn-ghost btn-xs" onClick={()=>{ try { URL.revokeObjectURL(foto.url); } catch {}; setFoto(null); }}>
                <JxIconRF name="x" size={11}/>
              </button>
            </div>
          )}
        </div>

        <div style={{ marginTop:14 }}>
          <label className="flabel">Notas (opcional)</label>
          <textarea className="fi" rows={2} value={notas} onChange={e=>setNotas(e.target.value)}
            placeholder="Ej: hoja completa firmada por residente · 38 movimientos del día"
            style={{ minHeight:60 }}/>
        </div>

        <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:14 }}>
          <button className="btn btn-ghost btn-sm" onClick={cerrar} disabled={busy}>Cancelar</button>
          <button className="btn btn-amber btn-sm"
            disabled={busy || !foto || (yaExiste && tipoCambio !== 'correccion' && !isAdmin)}
            onClick={handleSubmit}>
            <JxIconRF name="check" size={12}/>
            {busy
              ? 'Subiendo…'
              : modo === 'cambio' && !isAdmin
                ? 'Enviar solicitud al admin'
                : yaExiste && isAdmin
                  ? 'Reemplazar registro'
                  : 'Subir registro diario'}
          </button>
        </div>
      </div>
    </div>
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
  const { data: ubicaciones } = window.__hooks.useUbicacionesObra?.(obraId) || { data: [] };
  const { data: subcontratistas } = window.__hooks.useSubcontratistas?.() || { data: [] };
  const { data: frentesObra } = window.__hooks.useFrentesObra?.(obraId, { soloActivas: true }) || { data: [] };
  const frentesById = uMM(() => { const m = new Map(); (frentesObra || []).forEach(f => m.set(f.id, f)); return m; }, [frentesObra]);
  const [asignarFrenteTarget, setAsignarFrenteTarget] = uSM(null); // salida con frente pendiente a asignar
  const [selFrente, setSelFrente] = uSM('');
  const appMode = window.__useAppMode ? window.__useAppMode() : { isPrueba: true };

  // ── Mapa de TODOS los materiales (incluye soft-deleted Y de otras obras) ──
  // Necesario porque:
  //   1. Material eliminado del catálogo → mov histórico debería mostrar
  //      el nombre, no "(eliminado)".
  //   2. Material que vive en otra obra (caso raro pero posible si el form
  //      no reseteó la obra al crear) → el lookup debe encontrarlo igual.
  //   3. Material no sincronizado al device del user → fallback al server.
  // Estrategia: cargamos TODOS los materiales de Dexie sin filtros, y para
  // los IDs que aún no aparezcan, hacemos un fetch directo a Supabase.
  const [materialesAll, setMaterialesAll] = uSM([]);
  const [matsServer, setMatsServer] = uSM(new Map()); // id → {nombre_material, unidad}

  uEM(() => {
    let cancelled = false;
    const load = async () => {
      try {
        // Sin filtro de obra — si vive en otra obra del user, igual lo encontramos.
        const rows = await window.__db.materiales.toArray();
        if (!cancelled) setMaterialesAll(rows);
      } catch {}
    };
    load();
    const onChange = (e) => {
      const t = e?.detail?.tabla || e?.detail?.table;
      if (!t || t === 'materiales') load();
    };
    window.addEventListener('jx_data_changed', onChange);
    window.addEventListener('jarvex_master_updated', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('jx_data_changed', onChange);
      window.removeEventListener('jarvex_master_updated', onChange);
    };
  }, []);

  const matsByIdAll = uMM(() => {
    const map = new Map();
    materialesAll.forEach(m => map.set(m.id, m));
    return map;
  }, [materialesAll]);

  // ── Fallback al server: si hay movs cuyo material_id NO está en Dexie,
  //    pedimos los nombres a Supabase en una sola query. Así el otro admin
  //    ve "Cemento Sol 42.5kg" en vez de "(material no disponible)" aunque
  //    el material no haya llegado a su Dexie por algún sync trabado.
  uEM(() => {
    if (!movs || movs.length === 0) return;
    const sb = window.__supabase;
    if (!sb) return;
    const idsFaltantes = [];
    for (const m of movs) {
      if (!m.material_id) continue;
      if (matsByIdAll.has(m.material_id)) continue;
      if (matsServer.has(m.material_id)) continue;
      idsFaltantes.push(m.material_id);
    }
    if (idsFaltantes.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await sb
          .from('materiales')
          .select('id,nombre_material,unidad,obra_id')
          .in('id', idsFaltantes);
        if (cancelled || !data) return;
        setMatsServer(prev => {
          const next = new Map(prev);
          for (const r of data) next.set(r.id, r);
          return next;
        });
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [movs, matsByIdAll, matsServer]);

  const [reversoTarget, setReversoTarget] = uSM(null);
  const [editFechaTarget, setEditFechaTarget] = uSM(null);
  const [requestTarget, setRequestTarget] = uSM(null); // movimiento para "Solicitar cambio" (no-admin)
  const isAdmin = auth?.profile?.rol === 'admin';
  const canDelete = isAdmin && (appMode.isEdicion || appMode.isPrueba);
  const superAdmin = !!appMode.superAdmin;

  // Super Admin: editar fecha/hora de un movimiento histórico.
  const guardarFechaMov = async (mov, nuevaFecha, nuevaHora) => {
    if (!nuevaFecha) { showToast('Elegí una fecha', 'red'); return; }
    try {
      await updateMov(mov.id, { fecha: nuevaFecha, hora: nuevaHora || mov.hora || null });
      try { await window.__logAudit?.({ action:'update', table:'movimientos_materiales', recordId: mov.id,
        oldData:{ fecha: mov.fecha, hora: mov.hora }, newData:{ fecha: nuevaFecha, hora: nuevaHora },
        reason:'Super Admin · corrección de fecha histórica' }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'movimientos_materiales' } })); } catch {}
      showToast('✓ Fecha actualizada', 'green');
      setEditFechaTarget(null);
    } catch (e) {
      showToast('Error: ' + (e.message || e), 'red');
    }
  };

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
      // Blob local si existe; si no, signed URL del bucket privado. (Antes
      // miraba campos inexistentes upload_status/storage_path → nunca abría.)
      const src = await getEvidenciaSrc(evidencia);
      if (src?.url) {
        window.open(src.url, '_blank');
        if (src.isBlob) setTimeout(() => { try { URL.revokeObjectURL(src.url); } catch {} }, 60000);
        return;
      }
      showToast?.('No se encontró el archivo. Sincronizá primero.', 'amber');
    } catch (err) {
      showToast?.('Error al abrir: ' + (err.message || err), 'red');
    }
  };

  // Super Admin: editar la cantidad de un movimiento (ajusta stock + reajusta partida).
  // AVISA si dejaría stock negativo, pero NO bloquea (el SA asume el cambio).
  const editarCantidadSA = async (m) => {
    if (!superAdmin) return;
    const matLive = materiales?.find(x => x.id === m.material_id) || null;
    const nombre = matsByIdAll.get(m.material_id)?.nombre_material || 'material';
    const entrada = prompt(`Editar cantidad — ${m.tipo_movimiento} de "${nombre}".\nCantidad actual: ${m.cantidad}\n\nNueva cantidad:`, String(m.cantidad ?? ''));
    if (entrada == null) return;
    const nuevaCant = Number(entrada);
    if (!(nuevaCant > 0)) { showToast('Cantidad inválida', 'red'); return; }
    if (nuevaCant === Number(m.cantidad)) return;
    const nuevoStockResultante = stockTrasEditar(matLive?.stock_actual ?? 0, m, nuevaCant);
    if (dejaNegativo(nuevoStockResultante)) {
      showToast(`No se puede: este cambio dejaría el stock en ${nuevoStockResultante}. El stock no puede quedar negativo.`, 'red');
      return;
    }
    const extra = m.partida_id ? '\nSe reajustará el consumo de la partida vinculada.' : '';
    if (!confirm(`Cambiar cantidad de ${m.cantidad} → ${nuevaCant}.\nStock resultante: ${nuevoStockResultante}.${extra}\n\n¿Confirmás? (Super Admin)`)) return;
    try {
      const diff = deltaStockMaterial(m.tipo_movimiento, nuevaCant) - deltaStockMaterial(m.tipo_movimiento, m.cantidad);
      if (matLive) {
        const nuevoStock = (matLive.stock_actual ?? 0) + diff;
        const min = Number(matLive.stock_minimo || 0);
        const alerta = nuevoStock <= 0 ? 'sin_stock' : (min > 0 && nuevoStock <= min * 0.5) ? 'critico' : (min > 0 && nuevoStock <= min) ? 'reponer' : 'ok';
        await window.__db.materiales.update(m.material_id, { stock_actual: nuevoStock, alerta });
        if (m.ubicacion_id) { try { await aplicarDelta({ obraId, itemTipo: 'material', itemId: m.material_id, ubicacionId: m.ubicacion_id, delta: diff, userId: auth?.profile?.id || null }); } catch {} }
      }
      if (m.tipo_movimiento === 'salida' && m.partida_id && matLive) {
        try {
          const { revertirConsumoPartida, aplicarConsumoPartida } = await import('../lib/partida-allocation.js');
          await revertirConsumoPartida({ mov: m, partida_id: m.partida_id, material: matLive, userId: auth?.profile?.id || null });
          await aplicarConsumoPartida({ mov: { ...m, cantidad: nuevaCant }, partida_id: m.partida_id, material: matLive, userId: auth?.profile?.id || null });
        } catch (e) { console.warn('[SA cantidad partida]', e?.message); }
      }
      await updateMov(m.id, { cantidad: nuevaCant });
      try { await window.__logAudit?.({ action: 'update', table: 'movimientos_materiales', recordId: m.id, oldData: { cantidad: m.cantidad }, newData: { cantidad: nuevaCant }, reason: 'Super Admin · edición de cantidad' }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'movimientos_materiales' } })); } catch {}
      showToast('Cantidad actualizada · stock reajustado', 'green');
      movHook.refresh && movHook.refresh();
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  // Eliminar unificado: ajusta el stock (global + desglose por almacén) y revierte
  // la imputación a partida; el guard bloquea si dejaría stock negativo a futuro.
  const handleDeleteMov = async (m) => {
    if (!canDelete) return;
    const nombre = matsByIdAll.get(m.material_id)?.nombre_material || '(material no encontrado)';
    const matLive = materiales?.find(x => x.id === m.material_id) || null; // fila viva con stock_actual
    const deltaUndo = -deltaStockMaterial(m.tipo_movimiento, m.cantidad);
    const nuevoStockGlobal = (matLive?.stock_actual ?? 0) + deltaUndo;
    if (!confirm(`¿Eliminar este movimiento?\n\n${m.tipo_movimiento} de ${m.cantidad || 0} ${m.unidad || ''} de ${nombre}\nFecha: ${m.fecha || ''}\n\nEl stock SE AJUSTA automáticamente${m.partida_id ? ' y se revierte el consumo de la partida' : ''}.`)) return;
    try {
      await eliminarMovimiento({
        tabla: 'movimientos_materiales', mov: m, nuevoStockGlobal,
        material: matLive, userId: auth?.profile?.id || null, updateMov,
        revertirStock: async () => {
          if (!matLive) return;
          const min = Number(matLive.stock_minimo || 0);
          const nuevaAlerta = nuevoStockGlobal <= 0 ? 'sin_stock'
            : (min > 0 && nuevoStockGlobal <= min * 0.5) ? 'critico'
            : (min > 0 && nuevoStockGlobal <= min) ? 'reponer' : 'ok';
          await window.__db.materiales.update(m.material_id, { stock_actual: nuevoStockGlobal, alerta: nuevaAlerta });
          if (m.ubicacion_id) {
            try { await aplicarDelta({ obraId, itemTipo: 'material', itemId: m.material_id, ubicacionId: m.ubicacion_id, delta: deltaUndo, userId: auth?.profile?.id || null }); }
            catch (err) { console.warn('[elim mat desglose]', err?.message); }
          }
        },
      });
      showToast('Movimiento eliminado · stock ajustado', 'green');
      movHook.refresh && movHook.refresh();
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'movimientos_materiales' } })); } catch {}
    } catch (e) {
      showToast(e?.code === 'STOCK_NEGATIVO' ? e.message : ('Error al eliminar: ' + (e.message || e)), 'red');
    }
  };

  const [provs, setProvs] = uSM([]);
  const [partidas, setPartidas] = uSM([]);
  uEM(() => {
    let cancelled = false;
    const load = () => {
      if (cancelled) return;
      window.__db.proveedores.toArray().then(p => { if (!cancelled) setProvs(p); });
      window.__db.partidas.toArray().then(p => { if (!cancelled) setPartidas(p); });
    };
    load();
    // Antes hacía polling cada 2s — reemplazado por listener al evento
    // jx_data_changed que dispara sync engine + cualquier write local.
    // Fallback de 30s para casos donde el evento no se haya disparado.
    const onChange = (e) => {
      const t = e?.detail?.tabla;
      if (!t || t === 'proveedores' || t === 'partidas') load();
    };
    window.addEventListener('jx_data_changed', onChange);
    window.addEventListener('jx_sync_pull', load);
    const interval = setInterval(load, 30000);
    return () => {
      cancelled = true;
      window.removeEventListener('jx_data_changed', onChange);
      window.removeEventListener('jx_sync_pull', load);
      clearInterval(interval);
    };
  }, []);

  const [q, setQ] = uSM('');
  const [tipo, setTipo] = uSM('todos');
  const [regFisicoOpen, setRegFisicoOpen] = uSM(false);
  const [regDiarioOpen, setRegDiarioOpen] = uSM(false);
  const [regAtrasadoOpen, setRegAtrasadoOpen] = uSM(false);
  const [rfRefresh, setRfRefresh] = uSM(0);

  // Lookup en cascada: Dexie (todos) → server cache (matsServer).
  // Si el material no está en Dexie del user, el cache server lo provee
  // para que NUNCA aparezca "(material no disponible)" en la UI.
  const lookupMat = (id) =>
    matsByIdAll.get(id) || materiales?.find(m => m.id === id) || matsServer.get(id);
  const lookupPers = (id) => personal?.find(p => p.id === id);
  const lookupProv = (id) => provs?.find(p => p.id === id);
  const lookupPart = (id) => partidas?.find(p => p.id === id);
  const ubicNombre = uMM(() => { const m = new Map(); (ubicaciones || []).forEach(u => m.set(u.id, u.nombre)); return m; }, [ubicaciones]);
  const subNameMov = uMM(() => { const m = new Map(); (subcontratistas || []).forEach(sc => m.set(sc.id, sc.razon_social)); return m; }, [subcontratistas]);
  const almacenesDe = (m) => almacenesDeMov(m, ubicNombre);

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
      const pers = lookupPers(m.responsable_id);
      const alm = almacenesDe(m);
      const ql = q.toLowerCase();
      return (mat?.nombre_material || '').toLowerCase().includes(ql) ||
             (m.documento_asociado || '').toLowerCase().includes(ql) ||
             (pers ? `${pers.nombres} ${pers.apellidos} ${pers.alias || ''}`.toLowerCase().includes(ql) : false) ||
             (m.frente_zona || '').toLowerCase().includes(ql) ||
             (alm.salida || '').toLowerCase().includes(ql) ||
             (alm.llegada || '').toLowerCase().includes(ql);
    });
  }, [sorted, q, tipo, materiales, personal, ubicNombre, matsByIdAll, matsServer]);

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

  // ── Avisar a contabilidad: marcar un ingreso como "pendiente de sustento"
  // El mov queda visible en la cola de la contadora (Dashboard Contable →
  // "Ingresos sin sustento") para que ella vincule la factura cuando la
  // tenga. Solo aplica a entradas que NO tienen accounting_movement_id.
  const avisarContabilidad = async (mov) => {
    const matName = (materiales?.find(m => m.id === mov.material_id)?.nombre_material) || 'material';
    if (!confirm(
      `¿Avisar a contabilidad?\n\n` +
      `Ingreso: ${mov.cantidad} ${mov.unidad || ''} de ${matName}\n` +
      `Fecha: ${mov.fecha}\n\n` +
      `Va a aparecer en la cola "Ingresos sin sustento" del Dashboard Contable. ` +
      `La contadora lo vinculará con la factura cuando la suba.`
    )) return;
    try {
      const userId = window.__currentUserId || 'almacen';
      await window.__db.movimientos_materiales.update(mov.id, {
        pendiente_sustento: true,
        updated_at: new Date().toISOString(),
        updated_by: userId,
        version: (mov.version ?? 0) + 1,
        sync_status: mov.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      try { await window.__logAudit?.({ action:'update', table:'movimientos_materiales', recordId: mov.id, newData:{ pendiente_sustento:true }, reason:'Almacén avisó a contabilidad — falta sustento documental' }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'movimientos_materiales' } })); } catch {}
      try { window.dispatchEvent(new Event('online')); } catch {}
      showToast?.('📩 Avisado a contabilidad — aparecerá en su cola', 'green');
    } catch (e) {
      showToast?.('Error: ' + (e.message || e), 'red');
    }
  };

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
      // Conserva el almacén del original (mismo patrón que herramientas):
      // sin esto, la fila REVERSO mostraría '—' en las columnas de almacén.
      ubicacion_id: original.ubicacion_id || null,
      observaciones: 'REVERSO: ' + motivo,
      reverses_id: original.id,
    });
    // Devolver el stock al desglose por almacén: el reverso de una salida
    // re-ingresa al almacén original (y viceversa).
    if (original.ubicacion_id) {
      const deltaRev = (tipoInv === 'entrada' || tipoInv === 'devolucion' ? 1 : -1) * Math.abs(Number(original.cantidad || 0));
      try { await aplicarDelta({ obraId, itemTipo: 'material', itemId: original.material_id, ubicacionId: original.ubicacion_id, delta: deltaRev, userId: auth?.profile?.id || null }); } catch (err) { console.warn('[reverso mat desglose]', err?.message); }
    }

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

  // Diagnóstico de sync: cuántos movimientos están pendientes de subir al server
  // o tienen error. Si el almacenero crea offline o el push falla por
  // FK violation/RLS, los registros quedan locales — el banner los hace visibles
  // para que el user sepa que algo no subió y pueda reportarlo.
  // IMPORTANTE: este hook DEBE estar antes de cualquier `return` early para
  // no violar las reglas de hooks de React (cantidad consistente por render).
  const syncStats = uMM(() => {
    const pending = (movs || []).filter(m =>
      m.sync_status && ['pending_create','pending_update','pending_delete'].includes(m.sync_status)
    );
    const failed = (movs || []).filter(m => m.sync_status === 'failed');
    return { pending: pending.length, failed: failed.length, failedRecords: failed };
  }, [movs]);

  if (!obraId) return <SinObraEmpty icon="arrowIn"/>;
  if (loading) return <div className="page-wrap"><div className="empty-state"><JxIcon name="arrowIn" size={32} color="var(--tm)"/><p>Cargando movimientos…</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div><div className="pg-title">Movimiento de Materiales</div><div className="pg-sub">Historial completo · {sorted.length} movimientos registrados</div></div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <BotonExportarMovs datasetId="mov_materiales" obraId={obraId} showToast={showToast}/>
          <button className="btn btn-ghost btn-sm" onClick={()=>setRegFisicoOpen(true)} title="Ver registros físicos diarios subidos">
            <JxIcon name="camera" size={13}/> Visualización registro físico
          </button>
          <button className="btn btn-ghost btn-sm" onClick={()=>setRegAtrasadoOpen(true)} title="Solicitar cambio: día atrasado o corrección de registro">
            <JxIcon name="edit" size={13}/> Solicitar cambio
          </button>
          <button className="btn btn-amber btn-sm" onClick={()=>setRegDiarioOpen(true)} title="Subir foto del registro físico firmado HOY">
            <JxIcon name="plus" size={13}/> Subir registro diario (hoy)
          </button>
        </div>
      </div>

      {/* Aviso de urgencia: salidas sin frente asignado (S2 — completar después) */}
      {(movs || []).filter(m => m.frente_pendiente && !m.deleted_at).length > 0 && (
        <div style={{ marginBottom: 14, padding: '10px 14px', background: 'rgba(231,76,60,0.10)', border: '1px solid rgba(231,76,60,0.45)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>⚠</span>
          <div style={{ flex: 1, color: 'var(--ts)' }}>
            <strong style={{ color: 'var(--red)' }}>{(movs || []).filter(m => m.frente_pendiente && !m.deleted_at).length} salida(s) sin frente asignado</strong>
            <div style={{ marginTop: 3, fontSize: 11.5, color: 'var(--tm)' }}>Asigná el frente cuanto antes con el botón “⚠ Asignar frente” de la columna FRENTE.</div>
          </div>
        </div>
      )}
      {/* Banner diagnóstico de sync: solo aparece si hay records pendientes/fallidos */}
      {(syncStats.pending > 0 || syncStats.failed > 0) && (
        <div style={{
          marginBottom: 14,
          padding: '10px 14px',
          background: syncStats.failed > 0 ? 'rgba(231,76,60,0.10)' : 'rgba(242,183,5,0.10)',
          border: `1px solid ${syncStats.failed > 0 ? 'rgba(231,76,60,0.4)' : 'rgba(242,183,5,0.4)'}`,
          borderRadius: 6,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          fontSize: 12.5,
        }}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>{syncStats.failed > 0 ? '🔴' : '🟡'}</span>
          <div style={{ flex: 1, color: 'var(--ts)' }}>
            <strong style={{ color: syncStats.failed > 0 ? 'var(--red)' : 'var(--amber)' }}>
              {syncStats.failed > 0
                ? `${syncStats.failed} movimiento${syncStats.failed === 1 ? '' : 's'} con error de sincronización`
                : `${syncStats.pending} movimiento${syncStats.pending === 1 ? '' : 's'} sin sincronizar al servidor`}
            </strong>
            <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--tm)', lineHeight: 1.4 }}>
              {syncStats.failed > 0
                ? 'Estos registros existen sólo en este dispositivo. Posibles causas: el material referenciado no está en el server, o no tienes permisos. Detalles en consola (F12).'
                : 'Esperando que SyncEngine los suba. Si no se sincroniza en 1 minuto, recargá la página o avisale al admin.'}
            </div>
            {syncStats.failed > 0 && syncStats.failedRecords[0]?._last_error && (
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--red)', fontFamily: 'monospace' }}>
                Error: {syncStats.failedRecords[0]._last_error}
              </div>
            )}
          </div>
          {syncStats.failed > 0 && (
            <button className="btn btn-ghost btn-xs" title="Reintentar push de movimientos fallidos"
              onClick={async () => {
                try {
                  await Promise.all(syncStats.failedRecords.map(r =>
                    window.__db.movimientos_materiales.update(r.id, {
                      sync_status: r.deleted_at ? 'pending_delete' : 'pending_update',
                      _sync_retries: 0,
                      _last_error: null,
                    })
                  ));
                  showToast?.('Movimientos puestos en cola — reintentando…', 'amber');
                  if (window.__syncAll) await window.__syncAll(); else if (window.__sync?.sync) await window.__sync.sync();
                } catch (e) { showToast?.('Error: ' + (e?.message || e), 'red'); }
              }}>
              <JxIcon name="refresh" size={11}/> Reintentar
            </button>
          )}
        </div>
      )}
      {regFisicoOpen && (
        <RegistroFisicoModal modulo="movimientos_materiales" obraId={obraId}
          onClose={()=>setRegFisicoOpen(false)} showToast={showToast} refreshKey={rfRefresh}/>
      )}
      {regDiarioOpen && (
        <RegistroDiarioUploader modulo="movimientos_materiales" obraId={obraId}
          modo="hoy"
          onClose={()=>setRegDiarioOpen(false)}
          onSaved={()=>setRfRefresh(k=>k+1)}
          showToast={showToast}/>
      )}
      {regAtrasadoOpen && (
        <RegistroDiarioUploader modulo="movimientos_materiales" obraId={obraId}
          modo="cambio"
          onClose={()=>setRegAtrasadoOpen(false)}
          onSaved={()=>setRfRefresh(k=>k+1)}
          showToast={showToast}/>
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
        <div className="search-bar"><JxIcon name="search" size={14} color="var(--tm)"/><input placeholder="Buscar material, responsable, almacén, frente o documento…" value={q} onChange={e=>setQ(e.target.value)}/></div>
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
        <div className="tbl-sticky">
          <table className="tbl">
            <thead><tr>
              <th>Fecha / Hora</th><th>Tipo</th><th>Material</th>
              <th style={{ textAlign:'right' }}>Cantidad</th>
              <th>Almacén salida</th><th>Almacén llegada</th>
              <th>Responsable</th><th>Frente</th><th>Documento</th>
              <th style={{ minWidth:140 }}>Observación</th>
              <th style={{ textAlign:'right' }}>Precio</th>
              <th style={{ textAlign:'center' }}>Guía</th>
              <th>Sync</th>
              <th style={{ textAlign:'center' }}>Acción</th>
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
                    <td className="col-p">
                      {mat?.nombre_material || '(material no disponible)'}
                      {mat?.deleted_at && (
                        <span style={{ marginLeft:6, fontSize:10, color:'var(--tm)' }} title="El material fue eliminado del catálogo, pero el historial del movimiento se mantiene">
                          · histórico
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign:'right' }} className="col-num">{Number(m.cantidad || 0).toLocaleString('es-PE')} <span style={{ color:'var(--tm)', fontSize:11 }}>{m.unidad || mat?.unidad || ''}</span></td>
                    {(() => {
                      const alm = almacenesDe(m);
                      return (<>
                        <td><CeldaAlmacen nombre={alm.salida} esTraspaso={alm.esTraspaso}/></td>
                        <td><CeldaAlmacen nombre={alm.llegada} esTraspaso={alm.esTraspaso}/></td>
                      </>);
                    })()}
                    <td>{pers
                      ? <>{pers.nombres} {pers.apellidos}{pers.alias ? <span style={{ color:'var(--tm)' }}> «{pers.alias}»</span> : null}{pers.cargo ? <div style={{ fontSize:10.5, color:'var(--tm)' }}>{pers.cargo}{pers.subcontratista_id ? ` · ${subNameMov.get(pers.subcontratista_id) || 'subcontrato'}` : ''}</div> : null}</>
                      : (prov?.razon_social || '—')}</td>
                    <td>{
                      m.frente_pendiente
                        ? <button className="btn btn-red btn-xs" title="Falta el frente — asignalo" onClick={()=>{ setSelFrente(''); setAsignarFrenteTarget(m); }}>⚠ Asignar frente</button>
                        : <span style={{ display:'inline-flex', alignItems:'center', gap:4 }}>
                            {m.frente_id
                              ? <span className="badge b-amber" title="Frente de trabajo">{frentesById.get(m.frente_id)?.nombre || 'frente'}</span>
                              : m.frente_zona
                                ? <span className="badge b-amber" title="Frente / zona al que va">{m.frente_zona}</span>
                                : <span style={{ color:'var(--tm)', fontSize:12 }}>—</span>}
                            {isAdmin && <button className="btn btn-ghost btn-xs" title="Editar el frente al que se envió este movimiento" onClick={()=>{ setSelFrente(m.frente_id||''); setAsignarFrenteTarget(m); }} style={{ color:'#E74C3C', padding:'0 4px' }}>✎</button>}
                          </span>
                    }</td>
                    <td className="col-m">{m.documento_asociado || '—'}</td>
                    <td style={{ maxWidth:220 }}><CeldaObs texto={obsLegible(m)}/></td>
                    <td style={{ textAlign:'right' }} className="col-num">{m.precio_unitario_real ? fmtS(m.precio_unitario_real) : '—'}</td>
                    <td style={{ textAlign:'center', whiteSpace:'nowrap' }}>
                      {(() => {
                        const guia = guiasPorMov.get(m.id);
                        const tieneDocFactura = !!(m.documento_asociado && String(m.documento_asociado).trim());
                        // Estado 1: vinculado a accounting_movement (Paquete A nuevo)
                        if (m.accounting_movement_id) {
                          return <span className="badge b-green" title="Vinculado a factura por contabilidad">✓ Factura</span>;
                        }
                        // Estado 2: avisado a contabilidad — esperando sustento
                        if (m.pendiente_sustento) {
                          return <span className="badge b-amber" title="Almacén avisó a contabilidad — esperando que suban la factura">📩 Avisado</span>;
                        }
                        // Estado 3: tiene foto de guía adjunta
                        if (guia) {
                          return (
                            <button className="btn btn-ghost btn-xs" onClick={()=>verGuia(guia)}
                              title={`Ver: ${guia.nombre_archivo}`}>
                              <JxIcon name="file" size={11} color="var(--green)"/>
                            </button>
                          );
                        }
                        // Estado 4: salida (no aplica factura)
                        if (m.tipo_movimiento !== 'entrada') {
                          return <span style={{ fontSize:10, color:'var(--tm)' }}>—</span>;
                        }
                        // Estado 5: entrada con número de doc registrado (factura nominal
                        // ya conocida — flujo histórico). No mostrar 📩 porque ya hay
                        // sustento documental anotado. Permitimos adjuntar foto opcional.
                        if (tieneDocFactura) {
                          return (
                            <label className="btn btn-ghost btn-xs" title="Adjuntar foto de la factura/guía (opcional)" style={{ cursor:'pointer' }}>
                              <JxIcon name="upload" size={11}/>
                              <input type="file" accept="image/*,.pdf"
                                style={{ display:'none' }}
                                onChange={adjuntarGuia(m)}/>
                            </label>
                          );
                        }
                        // Estado 6: entrada SIN factura ni guía ni doc → botones adjuntar + avisar
                        return (
                          <div style={{ display:'flex', gap:3, justifyContent:'center' }}>
                            <label className="btn btn-ghost btn-xs" title="Adjuntar guía o factura (foto/PDF)" style={{ cursor:'pointer' }}>
                              <JxIcon name="upload" size={11}/>
                              <input type="file" accept="image/*,.pdf"
                                style={{ display:'none' }}
                                onChange={adjuntarGuia(m)}/>
                            </label>
                            <button
                              className="btn btn-ghost btn-xs"
                              title="Avisar a contabilidad que falta la factura — aparecerá en su cola"
                              onClick={()=>avisarContabilidad(m)}
                              style={{ fontSize:10, color:'var(--amber)' }}>
                              📩
                            </button>
                          </div>
                        );
                      })()}
                    </td>
                    <td>{(() => {
                      const s = m.sync_status;
                      if (s === 'failed') {
                        return <span className="badge b-red" title={`No sincronizado: ${m._last_error || 'error'}`}>⚠ Error</span>;
                      }
                      if (s && s !== 'synced') {
                        return <span className="badge b-amber" title={`Pendiente: ${s}`}>⏱ Local</span>;
                      }
                      return <span style={{color:'var(--green)',fontSize:11}} title="Sincronizado con el servidor">✓</span>;
                    })()}
                    </td>
                    <td style={{ textAlign:'center', whiteSpace:'nowrap' }}>
                      {isAdmin ? (
                        <>
                          {superAdmin && (
                            <button className="btn btn-ghost btn-xs" title="⚡ Super Admin: editar fecha/hora del movimiento" onClick={()=>setEditFechaTarget(m)} style={{ marginRight:4, color:'#E74C3C' }}>
                              📅
                            </button>
                          )}
                          {superAdmin && (
                            <button className="btn btn-ghost btn-xs" title="⚡ Super Admin: editar cantidad (ajusta stock; avisa si deja negativo)" onClick={()=>editarCantidadSA(m)} style={{ marginRight:4, color:'#E74C3C' }}>
                              #️⃣
                            </button>
                          )}
                          {canDelete ? (
                            <button className="btn btn-red btn-xs" title="Eliminar — ajusta el stock automáticamente" onClick={()=>handleDeleteMov(m)}>
                              <JxIcon name="trash" size={10}/> Eliminar
                            </button>
                          ) : (
                            <span style={{ fontSize:10, color:'var(--tm)' }}>—</span>
                          )}
                        </>
                      ) : (
                        <button className="btn btn-ghost btn-xs" title="Solicitar cambio o eliminación al administrador" onClick={()=>setRequestTarget(m)}>
                          <JxIcon name="edit" size={10}/> Solicitar
                        </button>
                      )}
                    </td>
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
      {asignarFrenteTarget && (
        <Modal title="Asignar frente de trabajo" icon="flag" onClose={()=>setAsignarFrenteTarget(null)}>
          <div style={{ fontSize:12, color:'var(--tm)', marginBottom:8 }}>
            Salida de {asignarFrenteTarget.cantidad} {asignarFrenteTarget.unidad||''} · {matsByIdAll.get(asignarFrenteTarget.material_id)?.nombre_material || 'material'}
          </div>
          <label className="flabel">Frente *</label>
          <select className="fi" value={selFrente} onChange={e=>setSelFrente(e.target.value)}>
            <option value="">— Elegí el frente —</option>
            {(frentesObra||[]).slice().sort((a,b)=>{
              const ga = !!(a.es_gastos_generales || /gastos generales/i.test(a.nombre||'')), gb = !!(b.es_gastos_generales || /gastos generales/i.test(b.nombre||''));
              if (ga!==gb) return ga?1:-1;
              return Number(a.orden??99)-Number(b.orden??99) || String(a.nombre||'').localeCompare(String(b.nombre||''));
            }).map(f => {
              const gg = f.es_gastos_generales || /gastos generales/i.test(f.nombre||'');
              return <option key={f.id} value={f.id}>{gg ? '⚑ Gastos Generales (oficina / fuera de partidas)' : f.nombre}</option>;
            })}
          </select>
          <div style={{ fontSize:11, color:'var(--tm)', marginTop:6 }}>Si el insumo fue para oficina o algo general (no para una partida de ejecución), elegí <strong>Gastos Generales</strong> en vez de dejarlo sin frente.</div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>setAsignarFrenteTarget(null)}>Cancelar</button>
            <button className="btn btn-amber" onClick={async ()=>{
              if (!selFrente) { showToast('Elegí un frente', 'red'); return; }
              try {
                const prev = asignarFrenteTarget.frente_id || null;
                await updateMov(asignarFrenteTarget.id, { frente_id: selFrente, frente_pendiente: false });
                if (prev && prev !== selFrente) { try { await window.__logAudit?.({ action:'update', table:'movimientos_materiales', recordId: asignarFrenteTarget.id, oldData:{ frente_id: prev }, newData:{ frente_id: selFrente }, reason:'Super Admin · corrección de frente histórico' }); } catch {} }
                try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'movimientos_materiales' } })); } catch {}
                showToast(prev ? 'Frente actualizado' : 'Frente asignado', 'green');
                setAsignarFrenteTarget(null); setSelFrente('');
              } catch(e){ showToast('Error: '+(e.message||e), 'red'); }
            }}>Guardar</button>
          </div>
        </Modal>
      )}
      {requestTarget && (
        <RequestChangeModal
          table="movimientos_materiales"
          record={requestTarget}
          recordLabel={`${requestTarget.tipo_movimiento} · ${matsByIdAll.get(requestTarget.material_id)?.nombre_material || 'material'}`}
          allowDelete
          fields={[
            // Al aprobar, el admin la cantidad reajusta stock + consumo de partida automáticamente.
            { key: 'cantidad', label: 'Cantidad', type: 'number' },
            { key: 'frente_id', label: 'Frente de trabajo', options: [
              { value: '', label: 'Sin frente' },
              ...(frentesObra || []).filter(f => !f.deleted_at).map(f => ({ value: f.id, label: f.nombre })),
            ] },
            { key: 'fecha', label: 'Fecha', type: 'date' },
            { key: 'documento_asociado', label: 'Documento / Vale' },
            { key: 'observaciones', label: 'Observaciones' },
          ]}
          showToast={showToast}
          onClose={() => setRequestTarget(null)}
        />
      )}
      {editFechaTarget && (
        <EditarFechaMovModal
          mov={editFechaTarget}
          onClose={()=>setEditFechaTarget(null)}
          onSave={(f,h)=>guardarFechaMov(editFechaTarget, f, h)}/>
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
  const { data: ubicacionesH } = window.__hooks.useUbicacionesObra?.(obraId) || { data: [] };
  const { data: frentesObra } = window.__hooks.useFrentesObra?.(obraId, { soloActivas: true }) || { data: [] };
  const appMode = window.__useAppMode ? window.__useAppMode() : { isPrueba: true };
  const ubicNombreH = uMM(() => { const m = new Map(); (ubicacionesH || []).forEach(u => m.set(u.id, u.nombre)); return m; }, [ubicacionesH]);
  const frentesById = uMM(() => { const m = new Map(); (frentesObra || []).forEach(f => m.set(f.id, f)); return m; }, [frentesObra]);

  const [reversoTarget, setReversoTarget] = uSM(null);
  const [editFechaTarget, setEditFechaTarget] = uSM(null);
  const [editFrenteTarget, setEditFrenteTarget] = uSM(null);
  const [requestTarget, setRequestTarget] = uSM(null); // movimiento para "Solicitar cambio" (no-admin)
  const isAdmin = auth?.profile?.rol === 'admin';
  const canDelete = isAdmin && (appMode.isEdicion || appMode.isPrueba);
  const superAdmin = !!appMode.superAdmin;

  // Super Admin / Admin: editar el frente al que se atribuye un movimiento de herramienta.
  const guardarFrenteMovHerr = async (frenteId) => {
    const mov = editFrenteTarget; if (!mov) return;
    try {
      await updateMov(mov.id, { frente_id: frenteId || null, frente_pendiente: false });
      try { await window.__logAudit?.({ action:'update', table:'movimientos_herramientas', recordId: mov.id, oldData:{ frente_id: mov.frente_id || null }, newData:{ frente_id: frenteId || null }, reason:'Super Admin · corrección de frente histórico' }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'movimientos_herramientas' } })); } catch {}
      showToast('Frente actualizado', 'green');
      setEditFrenteTarget(null);
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  // Super Admin: editar fecha/hora de un movimiento de herramienta histórico.
  const guardarFechaMov = async (mov, nuevaFecha, nuevaHora) => {
    if (!nuevaFecha) { showToast('Elegí una fecha', 'red'); return; }
    try {
      await updateMov(mov.id, { fecha: nuevaFecha, hora: nuevaHora || mov.hora || null });
      try { await window.__logAudit?.({ action:'update', table:'movimientos_herramientas', recordId: mov.id,
        oldData:{ fecha: mov.fecha, hora: mov.hora }, newData:{ fecha: nuevaFecha, hora: nuevaHora },
        reason:'Super Admin · corrección de fecha histórica' }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'movimientos_herramientas' } })); } catch {}
      showToast('✓ Fecha actualizada', 'green');
      setEditFechaTarget(null);
    } catch (e) {
      showToast('Error: ' + (e.message || e), 'red');
    }
  };

  // Para herramientas, la edición de cantidad del Super Admin no está soportada
  // (su stock es por estado/acción): se corrige eliminando y re-registrando.
  const editarCantidadSA = async () => {
    showToast('En herramientas, corregí la cantidad eliminando el movimiento y registrándolo de nuevo.', 'amber');
  };

  // Eliminar unificado de herramientas: revierte estado/disponibilidad/stock de la
  // herramienta (deshace el efecto del movimiento). Sin guard de negativo: el stock
  // de herramientas es por accion (no consumible como materiales).
  const handleDeleteMov = async (m) => {
    if (!canDelete) return;
    const herr = herramientas?.find(h => h.id === m.herramienta_id) || null;
    const nombre = herr?.nombre_herramienta || '(herramienta)';
    const cant = Number(m.cantidad) || 0;
    const accionInvH = invertirAccionHerramienta(m.accion);
    const deltaHerr = cant > 0 ? ((accionInvH === 'entrada' || accionInvH === 'reposicion') ? cant : accionInvH === 'salida' ? -cant : 0) : 0;
    const nuevoStockGlobal = herr ? Number(herr.stock_actual || 0) + deltaHerr : null;
    if (!confirm(`¿Eliminar este movimiento?\n\n${m.accion} de "${nombre}"\nFecha: ${m.fecha || ''}\n\nSe revierte el estado/stock de la herramienta automáticamente.`)) return;
    try {
      await eliminarMovimiento({
        tabla: 'movimientos_herramientas', mov: m, nuevoStockGlobal,
        material: null, userId: auth?.profile?.id || null, updateMov,
        revertirStock: async () => {
          if (!herr) return;
          const accionInv = invertirAccionHerramienta(m.accion);
          const patch = { fecha_ultimo_movimiento: new Date().toISOString().slice(0, 10) };
          if (cant > 0) {
            const delta = (accionInv === 'entrada' || accionInv === 'reposicion') ? cant
              : accionInv === 'salida' ? -cant : 0;
            if (delta !== 0) {
              const nuevoStock = Math.max(0, Number(herr.stock_actual || 0) + delta);
              patch.stock_actual = nuevoStock;
              patch.alerta = calcAlerta(nuevoStock, Number(herr.stock_minimo || 0));
              if (m.ubicacion_id) {
                try { await aplicarDelta({ obraId, itemTipo: 'herramienta', itemId: herr.id, ubicacionId: m.ubicacion_id, delta, userId: auth?.profile?.id || null }); }
                catch (err) { console.warn('[elim herr desglose]', err?.message); }
              }
            }
          }
          if (accionInv === 'entrada' || accionInv === 'reposicion') { patch.disponible = true; patch.ubicacion_actual = 'almacen'; patch.ultimo_responsable_id = null; }
          if (accionInv === 'salida') { patch.disponible = false; patch.ubicacion_actual = 'en_uso'; patch.ultimo_responsable_id = m.responsable_id || null; }
          if (accionInv === 'mantenimiento') { patch.disponible = false; patch.ubicacion_actual = 'mantenimiento'; patch.estado_actual = 'mantenimiento'; }
          if (accionInv === 'baja') { patch.disponible = false; patch.ubicacion_actual = 'baja'; patch.estado_actual = 'baja'; }
          await updateHerr(herr.id, patch);
        },
      });
      showToast('Movimiento eliminado · estado revertido', 'green');
      movHook.refresh && movHook.refresh();
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'movimientos_herramientas' } })); } catch {}
    } catch (e) {
      showToast(e?.code === 'STOCK_NEGATIVO' ? e.message : ('Error al eliminar: ' + (e.message || e)), 'red');
    }
  };

  const [q, setQ] = uSM('');
  const [accion, setAccion] = uSM('todas');
  const [regFisicoOpen, setRegFisicoOpen] = uSM(false);
  const [regDiarioOpen, setRegDiarioOpen] = uSM(false);
  const [regAtrasadoOpen, setRegAtrasadoOpen] = uSM(false);
  const [rfRefresh, setRfRefresh] = uSM(0);

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

  // Resumen de sync (mismo patrón que Materiales): la almacenera reportó
  // movimientos de herramientas que "no se subían" SIN ningún aviso — el
  // banner + reintentar le da visibilidad y auto-servicio.
  const syncStatsH = uMM(() => {
    const pending = (movs || []).filter(m =>
      m.sync_status && ['pending_create', 'pending_update', 'pending_delete'].includes(m.sync_status));
    const failed = (movs || []).filter(m => m.sync_status === 'failed');
    return { pending: pending.length, failed: failed.length, failedRecords: failed };
  }, [movs]);

  const filtered = uMM(() => {
    return sorted.filter(m => {
      // Filtros tipo-aware: "Ingreso" = entradas que NO son devolución;
      // "Devolución" = retornos (tipo_movimiento). Resto matchea por accion.
      const matchA = accion === 'todas'
        ? true
        : accion === 'entrada'    ? (m.accion === 'entrada' && m.tipo_movimiento !== 'devolucion')
        : accion === 'devolucion' ? (m.tipo_movimiento === 'devolucion')
        : m.accion === accion;
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
    // Los reversos (reverses_id) no se cuentan como movimientos del día — son
    // correcciones, no ingresos/salidas/devoluciones reales.
    salidasHoy: sorted.filter(m => m.fecha === today && m.accion === 'salida' && !m.reverses_id).length,
    // Devolución ≠ ingreso: una herramienta NUEVA que entra es un INGRESO, no
    // una devolución. Sólo cuentan como devolución los retornos (tipo_movimiento).
    devolHoy: sorted.filter(m => m.fecha === today && m.tipo_movimiento === 'devolucion' && !m.reverses_id).length,
    ingresosHoy: sorted.filter(m => m.fecha === today && m.accion === 'entrada' && m.tipo_movimiento !== 'devolucion' && m.tipo_movimiento !== 'reverso' && !m.reverses_id).length,
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

    const cantRev = Number(original.cantidad) || 0;   // 0 → herramienta serializada (sin cantidad)
    const reverso = await movHook.create({
      obra_id: original.obra_id,
      herramienta_id: original.herramienta_id,
      fecha, hora,
      accion: accionInv,
      // tipo_movimiento='reverso' para que NO se cuente como ingreso/salida/
      // devolución en las tarjetas ni se confunda en los badges.
      tipo_movimiento: 'reverso',
      // El reverso conserva la cantidad y el almacén del original para poder
      // deshacer el stock (toda herramienta es por cantidad).
      cantidad: cantRev || null,
      ubicacion_id: original.ubicacion_id || null,
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
        // Stock por cantidad: deshacer el delta del original. Reverso de una
        // salida SUMA de vuelta; reverso de una entrada RESTA. (Serializadas
        // sin cantidad → cantRev 0 → no toca stock.)
        if (cantRev > 0) {
          const delta = (accionInv === 'entrada' || accionInv === 'reposicion') ? cantRev
            : accionInv === 'salida' ? -cantRev : 0;
          if (delta !== 0) {
            const nuevoStock = Math.max(0, Number(h.stock_actual || 0) + delta);
            patch.stock_actual = nuevoStock;
            patch.alerta = calcAlerta(nuevoStock, Number(h.stock_minimo || 0));
            // Desglose por ubicación (si el original tenía almacén).
            if (original.ubicacion_id) {
              try { await aplicarDelta({ obraId, itemTipo: 'herramienta', itemId: h.id, ubicacionId: original.ubicacion_id, delta, userId: auth?.profile?.id || null }); } catch (err) { console.warn('[reverso herr desglose]', err?.message); }
            }
          }
        }
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
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <BotonExportarMovs datasetId="mov_herramientas" obraId={obraId} showToast={showToast}/>
          <button className="btn btn-ghost btn-sm" onClick={()=>setRegFisicoOpen(true)} title="Ver registros físicos diarios subidos">
            <JxIcon name="camera" size={13}/> Visualización registro físico
          </button>
          <button className="btn btn-ghost btn-sm" onClick={()=>setRegAtrasadoOpen(true)} title="Solicitar cambio: día atrasado o corrección de registro">
            <JxIcon name="edit" size={13}/> Solicitar cambio
          </button>
          <button className="btn btn-amber btn-sm" onClick={()=>setRegDiarioOpen(true)} title="Subir foto del registro físico firmado HOY">
            <JxIcon name="plus" size={13}/> Subir registro diario (hoy)
          </button>
        </div>
      </div>
      {/* Aviso de movimientos SIN SUBIR (pendientes o con error) + reintento. */}
      {(syncStatsH.pending > 0 || syncStatsH.failed > 0) && (
        <div style={{
          marginBottom: 14, padding: '10px 14px',
          background: syncStatsH.failed > 0 ? 'rgba(231,76,60,0.10)' : 'rgba(242,183,5,0.10)',
          border: `1px solid ${syncStatsH.failed > 0 ? 'rgba(231,76,60,0.4)' : 'rgba(242,183,5,0.4)'}`,
          borderRadius: 6, display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12.5,
        }}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>{syncStatsH.failed > 0 ? '🔴' : '🟡'}</span>
          <div style={{ flex: 1, color: 'var(--ts)' }}>
            <strong style={{ color: syncStatsH.failed > 0 ? 'var(--red)' : 'var(--amber)' }}>
              {syncStatsH.failed > 0
                ? `${syncStatsH.failed} movimiento${syncStatsH.failed === 1 ? '' : 's'} de herramientas NO se subieron al servidor`
                : `${syncStatsH.pending} movimiento${syncStatsH.pending === 1 ? '' : 's'} esperando subir`}
            </strong>
            <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--tm)', lineHeight: 1.4 }}>
              {syncStatsH.failed > 0
                ? 'Existen solo en esta computadora (las otras PCs no los ven). Tocá "Reintentar" — si sigue fallando, avisale al admin con el detalle de abajo. La columna "Sync" de la tabla marca cada uno con ⚠.'
                : 'Se suben solos en el próximo ciclo. Si en 1 minuto siguen acá, recargá la página.'}
            </div>
            {syncStatsH.failed > 0 && syncStatsH.failedRecords[0]?._last_error && (
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--red)', fontFamily: 'monospace' }}>
                Error: {syncStatsH.failedRecords[0]._last_error}
              </div>
            )}
          </div>
          {syncStatsH.failed > 0 && (
            <button className="btn btn-ghost btn-xs" title="Volver a intentar subir los movimientos fallidos"
              onClick={async () => {
                try {
                  await Promise.all(syncStatsH.failedRecords.map(r =>
                    window.__db.movimientos_herramientas.update(r.id, {
                      // pending_create si nunca llegó al server (version<=1);
                      // así el push reintenta el INSERT y no un UPDATE huérfano.
                      sync_status: r.deleted_at ? 'pending_delete'
                        : ((Number(r.version) || 1) <= 1 ? 'pending_create' : 'pending_update'),
                      _sync_retries: 0,
                      _last_error: null,
                    })
                  ));
                  showToast?.('Movimientos en cola — reintentando la subida…', 'amber');
                  if (window.__syncAll) await window.__syncAll(); else if (window.__sync?.sync) await window.__sync.sync();
                } catch (e) { showToast?.('Error: ' + (e?.message || e), 'red'); }
              }}>
              🔄 Reintentar
            </button>
          )}
        </div>
      )}
      {regFisicoOpen && (
        <RegistroFisicoModal modulo="movimientos_herramientas" obraId={obraId}
          onClose={()=>setRegFisicoOpen(false)} showToast={showToast} refreshKey={rfRefresh}/>
      )}
      {regDiarioOpen && (
        <RegistroDiarioUploader modulo="movimientos_herramientas" obraId={obraId}
          modo="hoy"
          onClose={()=>setRegDiarioOpen(false)}
          onSaved={()=>setRfRefresh(k=>k+1)}
          showToast={showToast}/>
      )}
      {regAtrasadoOpen && (
        <RegistroDiarioUploader modulo="movimientos_herramientas" obraId={obraId}
          modo="cambio"
          onClose={()=>setRegAtrasadoOpen(false)}
          onSaved={()=>setRfRefresh(k=>k+1)}
          showToast={showToast}/>
      )}

      {danadasRecientes.length > 0 && (
        <div className="alert-banner" style={{ marginBottom:14, background:'rgba(231,76,60,0.08)', border:'1px solid rgba(231,76,60,0.25)', borderRadius:8, padding:'10px 14px', display:'flex', alignItems:'center', gap:10, color:'var(--red)', fontSize:12.5 }}>
          <JxIcon name="alert" size={14} color="var(--red)"/>
          <span><strong>{danadasRecientes.length}</strong> herramienta{danadasRecientes.length>1?'s':''} devuelta{danadasRecientes.length>1?'s':''} en mal estado en los últimos 7 días.</span>
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:18 }}>
        {[
          { label:'Total Movimientos',     val:stats.total.toLocaleString('es-PE'),        color:'var(--blue)' },
          { label:'Ingresos Hoy',          val:stats.ingresosHoy.toLocaleString('es-PE'),  color:'var(--green)' },
          { label:'Salidas Hoy',           val:stats.salidasHoy.toLocaleString('es-PE'),   color:'var(--amber)' },
          { label:'Devoluciones Hoy',      val:stats.devolHoy.toLocaleString('es-PE'),     color:'var(--blue)' },
        ].map((s,i)=>(
          <div key={i} className="card card-p"><div style={{ fontSize:11, color:'var(--tm)' }}>{s.label}</div><div style={{ fontSize:26, fontWeight:800, color:s.color, margin:'4px 0' }}>{s.val}</div></div>
        ))}
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
        <div className="search-bar"><JxIcon name="search" size={14} color="var(--tm)"/><input placeholder="Buscar herramienta o responsable…" value={q} onChange={e=>setQ(e.target.value)}/></div>
        {['todas','entrada','salida','devolucion','mantenimiento','baja'].map(a=>(
          <button key={a} onClick={()=>setAccion(a)} className={`btn btn-sm ${accion===a?'btn-amber':'btn-ghost'}`}>
            {a==='todas' ? 'Todas' : a==='entrada' ? 'Ingreso' : a==='devolucion' ? 'Devolución' : MOV_HER_ACCION[a]?.lbl || a}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card card-p empty-state"><JxIcon name="tool" size={40} color="var(--tm)"/><p>No hay movimientos {accion!=='todas' || q ? 'que coincidan con el filtro' : 'registrados aún'}.</p></div>
      ) : (
      <div className="card" style={{ overflow:'hidden' }}>
        <div className="tbl-sticky">
          <table className="tbl">
            <thead><tr>
              <th>Fecha / Hora</th><th>Herramienta</th><th>Acción</th>
              <th style={{ textAlign:'right' }}>Cantidad</th>
              <th>Almacén salida</th><th>Almacén llegada</th>
              <th>Responsable</th><th>Frente</th><th>Estado Salida</th><th>Estado Devol.</th>
              <th>Observaciones</th><th>Sync</th>
              <th style={{ textAlign:'center' }}>Acción</th>
            </tr></thead>
            <tbody>
              {filtered.map(m=>{
                const a = badgeMovHerr(m);
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
                    <td style={{ textAlign:'right' }} className="col-num">
                      {m.cantidad != null && m.cantidad !== ''
                        ? <span style={{ fontWeight:700 }}>{Number(m.cantidad).toLocaleString('es-PE')} <span style={{ color:'var(--tm)', fontSize:11, fontWeight:400 }}>{h?.unidad || 'und'}</span></span>
                        : <span className="col-m">—</span>}
                    </td>
                    {(() => {
                      const alm = almacenesDeMov(m, ubicNombreH);
                      return (<>
                        <td><CeldaAlmacen nombre={alm.salida} esTraspaso={alm.esTraspaso}/></td>
                        <td><CeldaAlmacen nombre={alm.llegada} esTraspaso={alm.esTraspaso}/></td>
                      </>);
                    })()}
                    <td>{p ? <>{p.nombres} {p.apellidos}{p.alias ? <span style={{ color:'var(--tm)' }}> «{p.alias}»</span> : null}{p.cargo ? <div style={{ fontSize:10.5, color:'var(--tm)' }}>{p.cargo}</div> : null}</> : '—'}</td>
                    <td><span style={{ display:'inline-flex', alignItems:'center', gap:4 }}>
                      {m.frente_id
                        ? <span className="badge b-amber" title="Frente de trabajo">{frentesById.get(m.frente_id)?.nombre || 'frente'}</span>
                        : <span style={{ color:'var(--tm)', fontSize:12 }}>—</span>}
                      {isAdmin && <button className="btn btn-ghost btn-xs" title="Editar el frente al que se envió este movimiento" onClick={()=>setEditFrenteTarget(m)} style={{ color:'#E74C3C', padding:'0 4px' }}>✎</button>}
                    </span></td>
                    <td>{m.estado_salida ? <span className={`badge ${EST_HER[m.estado_salida]||'b-gray'}`} style={{ textTransform:'capitalize' }}>{m.estado_salida}</span> : <span className="col-m">—</span>}</td>
                    <td>{m.estado_devolucion ? <span className={`badge ${EST_HER[m.estado_devolucion]||'b-gray'}`} style={{ textTransform:'capitalize' }}>{m.estado_devolucion}</span> : <span className="col-m">—</span>}</td>
                    <td className="col-m" style={{ color: danado?'var(--red)':'', fontSize:11 }}>{m.observaciones || '—'}</td>
                    <td>{(() => {
                      const s = m.sync_status;
                      if (s === 'failed') {
                        return <span className="badge b-red" title={`No sincronizado: ${m._last_error || 'error'}`}>⚠ Error</span>;
                      }
                      if (s && s !== 'synced') {
                        return <span className="badge b-amber" title={`Pendiente: ${s}`}>⏱ Local</span>;
                      }
                      return <span style={{color:'var(--green)',fontSize:11}} title="Sincronizado con el servidor">✓</span>;
                    })()}
                    </td>
                    <td style={{ textAlign:'center', whiteSpace:'nowrap' }}>
                      {isAdmin ? (
                        <>
                          {superAdmin && (
                            <button className="btn btn-ghost btn-xs" title="⚡ Super Admin: editar fecha/hora del movimiento" onClick={()=>setEditFechaTarget(m)} style={{ marginRight:4, color:'#E74C3C' }}>
                              📅
                            </button>
                          )}
                          {superAdmin && (
                            <button className="btn btn-ghost btn-xs" title="⚡ Super Admin: editar cantidad (ajusta stock; avisa si deja negativo)" onClick={()=>editarCantidadSA(m)} style={{ marginRight:4, color:'#E74C3C' }}>
                              #️⃣
                            </button>
                          )}
                          {canDelete ? (
                            <button className="btn btn-red btn-xs" title="Eliminar — ajusta el stock automáticamente" onClick={()=>handleDeleteMov(m)}>
                              <JxIcon name="trash" size={10}/> Eliminar
                            </button>
                          ) : (
                            <span style={{ fontSize:10, color:'var(--tm)' }}>—</span>
                          )}
                        </>
                      ) : (
                        <button className="btn btn-ghost btn-xs" title="Solicitar cambio o eliminación al administrador" onClick={()=>setRequestTarget(m)}>
                          <JxIcon name="edit" size={10}/> Solicitar
                        </button>
                      )}
                    </td>
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
      {requestTarget && (
        <RequestChangeModal
          table="movimientos_herramientas"
          record={requestTarget}
          recordLabel={`${requestTarget.accion} · ${lookupHerr(requestTarget.herramienta_id)?.nombre_herramienta || 'herramienta'}`}
          allowDelete
          fields={[
            { key: 'fecha', label: 'Fecha', type: 'date' },
            { key: 'observaciones', label: 'Observaciones' },
          ]}
          showToast={showToast}
          onClose={() => setRequestTarget(null)}
        />
      )}
      {editFechaTarget && (
        <EditarFechaMovModal
          mov={editFechaTarget}
          onClose={()=>setEditFechaTarget(null)}
          onSave={(f,h)=>guardarFechaMov(editFechaTarget, f, h)}/>
      )}
      {editFrenteTarget && (
        <EditarFrenteMovModal
          frenteActual={editFrenteTarget.frente_id || ''}
          frentes={frentesObra}
          label={`${badgeMovHerr(editFrenteTarget).lbl} · ${lookupHerr(editFrenteTarget.herramienta_id)?.nombre_herramienta || 'herramienta'}`}
          onSave={guardarFrenteMovHerr}
          onClose={()=>setEditFrenteTarget(null)}/>
      )}
    </div>
  );
}

// ─── PROVEEDORES PAGE ─────────────────────────────────────
function ProveedoresPage({ showToast }) {
  // Hooks SIEMPRE al top-level del componente, nunca dentro de handlers/callbacks
  // (llamarlos en un onClick rompe las reglas de React → minified error #321).
  const auth = window.__useAuth ? window.__useAuth() : null;
  const myRol = auth?.profile?.rol;
  const isAdmin = myRol === 'admin';
  // canWrite gobierna crear/editar (alineado con canPushTabla('proveedores'),
  // que también exige 'Proveedores'-w): un rol sin write NO debe poder crear un
  // proveedor que luego no puede sincronizar (quedaría PENDING eterno). Los roles
  // de solo lectura (p.ej. ayudante_contador) ven la página + "Solicitar cambio".
  const canWrite = isAdmin || (window.__hasPerm?.(myRol, 'Proveedores', 'w') ?? false);
  const appMode = window.__useAppMode ? window.__useAppMode() : { isPrueba: true };
  const canDelete = canWrite && (appMode.isEdicion || appMode.isPrueba);

  const [provs, setProvs] = uSM([]);
  const [loading, setLoading] = uSM(true);
  const [requestTarget, setRequestTarget] = uSM(null);
  const [fusionOpen, setFusionOpen] = uSM(false);
  const dupsRuc = uMM(() => {
    const m = new Map();
    (provs || []).forEach(p => { if (p.deleted_at) return; const r = String(p.ruc || '').replace(/\D/g, ''); if (r.length >= 8) m.set(r, (m.get(r) || 0) + 1); });
    return [...m.values()].filter(n => n > 1).length;
  }, [provs]);

  uEM(() => {
    let cancelled = false;
    const load = () => {
      if (cancelled) return;
      window.__db.proveedores.toArray().then(d => {
        if (cancelled) return;
        setProvs((d || []).filter(x => !x.deleted_at));
        setLoading(false);
      });
    };
    load();
    // Antes polling 2s. Ahora reactivo a eventos + fallback 30s.
    const onChange = (e) => {
      const t = e?.detail?.tabla;
      if (!t || t === 'proveedores') load();
    };
    window.addEventListener('jx_data_changed', onChange);
    window.addEventListener('jx_sync_pull', load);
    const interval = setInterval(load, 30000);
    return () => {
      cancelled = true;
      window.removeEventListener('jx_data_changed', onChange);
      window.removeEventListener('jx_sync_pull', load);
      clearInterval(interval);
    };
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
    if (!canWrite) { showToast('No tenés permiso para crear/editar proveedores — usá "Solicitar cambio"', 'red'); return; }
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
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {isAdmin && (
            <button className="btn btn-ghost btn-sm" onClick={()=>setFusionOpen(true)} title="Fusionar proveedores duplicados (mismo RUC)">
              <JxIcon name="compare" size={13}/>Fusionar{dupsRuc>0 ? <span className="badge b-amber" style={{ marginLeft:6, fontSize:9 }}>{dupsRuc}</span> : ''}
            </button>
          )}
          {canWrite && (
            <button className="btn btn-amber btn-sm" onClick={()=>{setForm({}); setEditingId(null); setModal(true);}}><JxIcon name="plus" size={13}/>Nuevo Proveedor</button>
          )}
        </div>
      </div>
      {fusionOpen && <FusionEntidadModal tipo="proveedores" registros={provs} showToast={showToast} onClose={()=>setFusionOpen(false)} onDone={()=>{}} />}

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
                {canWrite ? (
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

// ─── Modal Super Admin: editar fecha/hora de un movimiento ───────────
// Solo accesible con Super Admin activo. Permite corregir la fecha de
// movimientos históricos (al arrancar la obra con registros de días
// pasados). Cada cambio queda en auditoría.
function EditarFechaMovModal({ mov, onClose, onSave }) {
  const [fecha, setFecha] = uSM(mov.fecha || new Date().toISOString().slice(0, 10));
  const [hora, setHora] = uSM(mov.hora || '');
  const [saving, setSaving] = uSM(false);
  const hoy = new Date().toISOString().slice(0, 10);
  const submit = async () => {
    setSaving(true);
    try { await onSave(fecha, hora); }
    finally { setSaving(false); }
  };
  return (
    <Modal title="⚡ Editar fecha del movimiento" icon="edit" onClose={onClose}>
      <div style={{ fontSize:12, color:'var(--tm)', marginBottom:12, lineHeight:1.5 }}>
        Corrección de fecha histórica (Super Admin). El movimiento original quedaba en
        <strong> {mov.fecha || '—'} {mov.hora || ''}</strong>.
      </div>
      <div className="g2">
        <div>
          <label className="flabel">Fecha</label>
          <input className="fi" type="date" max={hoy} value={fecha} onChange={e=>setFecha(e.target.value)}/>
        </div>
        <div>
          <label className="flabel">Hora (opcional)</label>
          <input className="fi" type="time" value={hora} onChange={e=>setHora(e.target.value)}/>
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-amber" onClick={submit} disabled={saving || !fecha}>
          <JxIcon name="check" size={13}/> {saving ? 'Guardando…' : 'Guardar fecha'}
        </button>
      </div>
    </Modal>
  );
}

Object.assign(window, { MovMaterialesPage, MovHerramientasPage, ProveedoresPage });
