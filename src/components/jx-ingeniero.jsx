// ═══════════════════════════════════════════════════════════════════
// JARVEX — Página del rol Ingeniero
//
// Inbox de salidas de material pendientes de vincular a una partida.
// El almacenero ya no asigna partida cuando registra una salida (Paquete C);
// el ingeniero las revisa diariamente y las imputa a las partidas
// correspondientes. Para CORREGIR vínculos ya hechos: cualquier
// modificación requiere un change_request que admin/gerencia aprueba.
//
// Lo que VE el ingeniero (operativo, sin financiero):
//   - Material, cantidad, unidad
//   - Quién retiró + observación
//   - Fecha/hora
// Lo que NO ve: precio_unitario_real, costos, valores monetarios.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
const { useState: uS, useEffect: uE, useMemo: uM, useCallback: uCB } = React;

import { aplicarConsumoPartida, revertirConsumoPartida } from '../lib/partida-allocation.js';
import { createChangeRequest } from '../lib/changeRequests.js';

const JxIcon = (props) => (window.JxIcon ? <window.JxIcon {...props}/> : null);
const Modal = (props) => (window.Modal ? <window.Modal {...props}/> : null);

// Hook util — detectar obra activa con retry (mismo patrón que otras pages)
function useObraIdActiva() {
  const [obraId, setObraId] = uS(null);
  uE(() => {
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
    window.addEventListener('obra_activa_change', onChange);
    window.addEventListener('jarvex_master_updated', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('obra_activa_change', onChange);
      window.removeEventListener('jarvex_master_updated', onChange);
    };
  }, []);
  return obraId;
}

// Agrupa array por una función key, devolviendo un array de [key, items[]]
function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return Array.from(m.entries());
}

function IngenieroInboxPage({ showToast }) {
  const obraId = useObraIdActiva();
  const [tab, setTab] = uS('inbox'); // inbox | historial
  const [salidasPendientes, setSalidasPendientes] = uS([]);
  const [salidasHistorial, setSalidasHistorial] = uS([]);
  const [loading, setLoading] = uS(true);
  const [materiales, setMateriales] = uS([]);
  const [personal, setPersonal] = uS([]);
  const [partidas, setPartidas] = uS([]);
  const [busquedaPartida, setBusquedaPartida] = uS('');
  const [asignarModal, setAsignarModal] = uS(null);          // mov a asignar (modo inbox)
  const [cambiarModal, setCambiarModal] = uS(null);          // mov a re-asignar (modo historial)
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id || 'offline';

  const cargar = uCB(async () => {
    if (!obraId) return;
    setLoading(true);
    try {
      const [salidas, mats, pers, parts] = await Promise.all([
        window.__db.movimientos_materiales
          .where('obra_id').equals(obraId)
          .filter(m => m.tipo_movimiento === 'salida' && !m.reverses_id && !m.reversed_by_id)
          .toArray(),
        window.__db.materiales.where('obra_id').equals(obraId).filter(m => !m.deleted_at).toArray(),
        window.__db.personal.where('obra_id').equals(obraId).filter(p => !p.deleted_at).toArray(),
        window.__db.partidas.where('obra_id').equals(obraId).filter(p => !p.deleted_at).toArray(),
      ]);
      salidas.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || (b.hora || '').localeCompare(a.hora || ''));
      setSalidasPendientes(salidas.filter(s => !s.partida_id));
      setSalidasHistorial(salidas.filter(s => s.partida_id));
      setMateriales(mats);
      setPersonal(pers);
      setPartidas(parts.sort((a, b) => (a.codigo_delfin || '').localeCompare(b.codigo_delfin || '')));
    } catch (e) {
      console.error('[ingeniero] cargar:', e);
      showToast?.('Error cargando datos: ' + (e.message || e), 'red');
    } finally {
      setLoading(false);
    }
  }, [obraId, showToast]);

  uE(() => {
    cargar();
    const onChange = (e) => {
      const t = e?.detail?.tabla || e?.detail?.table;
      if (!t || ['movimientos_materiales', 'partidas', 'insumos_partida', 'materiales'].includes(t)) cargar();
    };
    window.addEventListener('jx_data_changed', onChange);
    return () => window.removeEventListener('jx_data_changed', onChange);
  }, [cargar]);

  const matName = (id) => materiales.find(m => m.id === id)?.nombre_material || '—';
  const persName = (id) => {
    if (!id) return '—';
    const p = personal.find(x => x.id === id);
    return p ? `${p.nombres || ''} ${p.apellidos || ''}`.trim() : '—';
  };
  const partLabel = (id) => {
    const p = partidas.find(x => x.id === id);
    if (!p) return '—';
    return `${p.codigo_delfin || ''} · ${p.nombre_partida || ''}`.trim();
  };

  // Agrupado por fecha para el inbox (uno se enfoca en lo del día)
  const inboxPorDia = uM(
    () => groupBy(salidasPendientes, s => s.fecha || 'sin fecha').sort((a, b) => b[0].localeCompare(a[0])),
    [salidasPendientes]
  );

  // Asignar partida (inbox) — aplica imputación + marca quién/cuándo asignó.
  const asignarPartida = async (mov, partidaId) => {
    if (!partidaId) { showToast?.('Elegí una partida', 'red'); return; }
    try {
      const material = materiales.find(m => m.id === mov.material_id);
      const now = new Date().toISOString();
      await window.__db.movimientos_materiales.update(mov.id, {
        partida_id: partidaId,
        partida_asignada_por: userId,
        partida_asignada_at: now,
        updated_at: now,
        updated_by: userId,
        version: (mov.version ?? 0) + 1,
        sync_status: mov.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      await aplicarConsumoPartida({ mov, partida_id: partidaId, material, userId });
      try { await window.__logAudit?.({ action: 'update', table: 'movimientos_materiales', recordId: mov.id, newData: { partida_id: partidaId }, reason: `Ingeniero vinculó salida a partida` }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'movimientos_materiales' } })); } catch {}
      try { window.dispatchEvent(new Event('online')); } catch {}
      showToast?.(`✓ Vinculado a ${partLabel(partidaId).slice(0, 40)}`, 'green');
      setAsignarModal(null);
      setBusquedaPartida('');
    } catch (e) {
      showToast?.('Error: ' + (e.message || e), 'red');
    }
  };

  // Crear change_request para modificar vínculo ya hecho (modo historial).
  const solicitarCambio = async (mov, nuevaPartidaId, motivo) => {
    if (!nuevaPartidaId) { showToast?.('Elegí una partida nueva', 'red'); return; }
    if (mov.partida_id === nuevaPartidaId) { showToast?.('Es la misma partida actual', 'amber'); return; }
    if (!motivo || motivo.trim().length < 10) { showToast?.('Motivo mín 10 caracteres', 'red'); return; }
    try {
      await createChangeRequest({
        table: 'movimientos_materiales',
        recordId: mov.id,
        recordLabel: `${matName(mov.material_id)} · ${mov.cantidad} ${mov.unidad} · ${mov.fecha}`,
        proposedChanges: {
          partida_id: { old: mov.partida_id, new: nuevaPartidaId },
        },
        reason: motivo.trim(),
      });
      showToast?.('✓ Solicitud de cambio enviada — admin la aprobará', 'green');
      setCambiarModal(null);
      setBusquedaPartida('');
    } catch (e) {
      showToast?.('Error creando solicitud: ' + (e.message || e), 'red');
    }
  };

  if (!obraId) {
    return (
      <div className="card card-p" style={{ textAlign: 'center', color: 'var(--tm)', padding: 40 }}>
        <JxIcon name="building" size={36} color="var(--tm)"/>
        <div style={{ marginTop: 12 }}>Seleccioná una obra para ver las salidas a vincular.</div>
      </div>
    );
  }

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Vinculación de Salidas</div>
          <div className="pg-sub">
            Asigná cada salida del almacén a su partida correspondiente. Vista operativa — sin costos.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className={`btn ${tab === 'inbox' ? 'btn-amber' : 'btn-ghost'} btn-sm`} onClick={() => setTab('inbox')}>
            📥 Inbox ({salidasPendientes.length})
          </button>
          <button className={`btn ${tab === 'historial' ? 'btn-amber' : 'btn-ghost'} btn-sm`} onClick={() => setTab('historial')}>
            📜 Historial ({salidasHistorial.length})
          </button>
        </div>
      </div>

      {loading && <div className="card card-p" style={{ textAlign: 'center', color: 'var(--tm)' }}>Cargando…</div>}

      {!loading && tab === 'inbox' && (
        <>
          {salidasPendientes.length === 0 ? (
            <div className="card card-p" style={{ textAlign: 'center', color: 'var(--green)', padding: 40 }}>
              <JxIcon name="check" size={36} color="var(--green)"/>
              <div style={{ marginTop: 12, fontWeight: 600 }}>Inbox vacío — todas las salidas están vinculadas a una partida</div>
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--tm)' }}>
                Las nuevas salidas de almacén aparecerán acá automáticamente.
              </div>
            </div>
          ) : (
            inboxPorDia.map(([dia, items]) => (
              <div key={dia} style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 12, color: 'var(--tm)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, fontWeight: 600 }}>
                  📅 {dia} · {items.length} salida(s)
                </div>
                <div className="card" style={{ overflow: 'hidden' }}>
                  <table className="tbl" style={{ fontSize: 12.5 }}>
                    <thead>
                      <tr>
                        <th style={{ width: 70 }}>Hora</th>
                        <th>Material</th>
                        <th style={{ width: 80, textAlign: 'right' }}>Cant.</th>
                        <th style={{ width: 70 }}>Unidad</th>
                        <th>Retira</th>
                        <th>Observación</th>
                        <th style={{ width: 140, textAlign: 'right' }}>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(mov => (
                        <tr key={mov.id}>
                          <td style={{ fontFamily: 'monospace', color: 'var(--tm)' }}>{(mov.hora || '').slice(0, 5) || '—'}</td>
                          <td style={{ fontWeight: 600 }}>{matName(mov.material_id)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{mov.cantidad}</td>
                          <td style={{ color: 'var(--tm)' }}>{mov.unidad}</td>
                          <td>{persName(mov.responsable_id)}</td>
                          <td style={{ fontSize: 11.5, color: 'var(--tm)', fontStyle: 'italic' }}>{mov.observaciones || '—'}</td>
                          <td style={{ textAlign: 'right' }}>
                            <button className="btn btn-amber btn-sm" onClick={() => setAsignarModal(mov)}>
                              <JxIcon name="link" size={11}/> Asignar partida
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </>
      )}

      {!loading && tab === 'historial' && (
        <>
          {salidasHistorial.length === 0 ? (
            <div className="card card-p" style={{ textAlign: 'center', color: 'var(--tm)' }}>
              No hay salidas vinculadas todavía.
            </div>
          ) : (
            <div className="card" style={{ overflow: 'hidden' }}>
              <table className="tbl" style={{ fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={{ width: 100 }}>Fecha</th>
                    <th>Material</th>
                    <th style={{ width: 80, textAlign: 'right' }}>Cant.</th>
                    <th style={{ width: 70 }}>Unidad</th>
                    <th>Partida asignada</th>
                    <th style={{ width: 130, textAlign: 'right' }}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {salidasHistorial.slice(0, 100).map(mov => (
                    <tr key={mov.id}>
                      <td style={{ fontFamily: 'monospace', color: 'var(--tm)' }}>{mov.fecha}</td>
                      <td style={{ fontWeight: 600 }}>{matName(mov.material_id)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{mov.cantidad}</td>
                      <td style={{ color: 'var(--tm)' }}>{mov.unidad}</td>
                      <td style={{ fontSize: 11.5 }}>{partLabel(mov.partida_id)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => setCambiarModal(mov)}>
                          <JxIcon name="edit" size={11}/> Solicitar cambio
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {salidasHistorial.length > 100 && (
                <div style={{ padding: 10, textAlign: 'center', fontSize: 11, color: 'var(--tm)' }}>
                  Mostrando 100 de {salidasHistorial.length} · filtros próximamente
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Modal: asignar partida (inbox) */}
      {asignarModal && (
        <Modal
          title={`Asignar partida — ${matName(asignarModal.material_id)} · ${asignarModal.cantidad} ${asignarModal.unidad}`}
          icon="link"
          onClose={() => { setAsignarModal(null); setBusquedaPartida(''); }}>
          <PartidaSelector
            partidas={partidas}
            busqueda={busquedaPartida}
            onBusqueda={setBusquedaPartida}
            onPick={pid => asignarPartida(asignarModal, pid)}/>
        </Modal>
      )}

      {/* Modal: solicitar cambio (historial) */}
      {cambiarModal && (
        <SolicitarCambioModal
          mov={cambiarModal}
          matName={matName(cambiarModal.material_id)}
          partidaActual={partLabel(cambiarModal.partida_id)}
          partidas={partidas}
          busqueda={busquedaPartida}
          onBusqueda={setBusquedaPartida}
          onClose={() => { setCambiarModal(null); setBusquedaPartida(''); }}
          onConfirm={(nuevaId, motivo) => solicitarCambio(cambiarModal, nuevaId, motivo)}/>
      )}
    </div>
  );
}

// ── Selector visual de partidas con búsqueda + scroll ──
function PartidaSelector({ partidas, busqueda, onBusqueda, onPick }) {
  const q = busqueda.toLowerCase().trim();
  const filtradas = q
    ? partidas.filter(p => (p.codigo_delfin || '').toLowerCase().includes(q) || (p.nombre_partida || '').toLowerCase().includes(q))
    : partidas;
  return (
    <div>
      <input
        className="fi"
        autoFocus
        placeholder="Buscar por código o nombre…"
        value={busqueda}
        onChange={e => onBusqueda(e.target.value)}
        style={{ marginBottom: 10, width: '100%' }}/>
      <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid var(--bd)', borderRadius: 6 }}>
        {filtradas.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--tm)', fontSize: 12 }}>Sin resultados</div>
        ) : (
          filtradas.slice(0, 200).map(p => (
            <button
              key={p.id}
              onClick={() => onPick(p.id)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '8px 12px', background: 'transparent', border: 'none',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                cursor: 'pointer', color: 'var(--ts)',
              }}
              onMouseOver={e => e.currentTarget.style.background = 'rgba(242,183,5,0.08)'}
              onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
              <div style={{ fontFamily: 'monospace', fontSize: 10.5, color: 'var(--amber)' }}>{p.codigo_delfin || ''}</div>
              <div style={{ fontSize: 12.5, marginTop: 2 }}>{p.nombre_partida || '—'}</div>
            </button>
          ))
        )}
      </div>
      {filtradas.length > 200 && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--tm)' }}>
          Mostrando 200 de {filtradas.length} · refiná la búsqueda
        </div>
      )}
    </div>
  );
}

// ── Modal de solicitud de cambio ──
function SolicitarCambioModal({ mov, matName, partidaActual, partidas, busqueda, onBusqueda, onClose, onConfirm }) {
  const [nuevaId, setNuevaId] = uS(null);
  const [motivo, setMotivo] = uS('');
  const [saving, setSaving] = uS(false);
  const nuevaLabel = nuevaId ? (() => {
    const p = partidas.find(x => x.id === nuevaId);
    return p ? `${p.codigo_delfin} · ${p.nombre_partida}` : '—';
  })() : null;

  const submit = async () => {
    setSaving(true);
    try { await onConfirm(nuevaId, motivo); }
    finally { setSaving(false); }
  };

  return (
    <Modal title="Solicitar cambio de partida" icon="edit" onClose={onClose}>
      <div style={{ fontSize: 12.5, marginBottom: 10, color: 'var(--ts)' }}>
        <strong>{matName}</strong> · {mov.cantidad} {mov.unidad} · {mov.fecha}
      </div>
      <div style={{ padding: 10, background: 'rgba(0,0,0,0.2)', borderRadius: 6, marginBottom: 12, fontSize: 12 }}>
        <div style={{ color: 'var(--tm)', fontSize: 10.5, textTransform: 'uppercase' }}>Partida actual</div>
        <div style={{ marginTop: 3 }}>{partidaActual}</div>
      </div>
      {!nuevaId ? (
        <>
          <div style={{ fontSize: 11.5, color: 'var(--tm)', marginBottom: 6 }}>Elegí la nueva partida:</div>
          <PartidaSelector
            partidas={partidas}
            busqueda={busqueda}
            onBusqueda={onBusqueda}
            onPick={setNuevaId}/>
        </>
      ) : (
        <>
          <div style={{ padding: 10, background: 'rgba(46,204,113,0.10)', border: '1px solid rgba(46,204,113,0.3)', borderRadius: 6, marginBottom: 12, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <div style={{ color: 'var(--tm)', fontSize: 10.5, textTransform: 'uppercase' }}>Nueva partida</div>
                <div style={{ marginTop: 3, color: 'var(--green)', fontWeight: 600 }}>{nuevaLabel}</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setNuevaId(null)}>Cambiar</button>
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label className="flabel">Motivo del cambio (mín 10 caracteres)</label>
            <textarea
              className="fi"
              rows={3}
              placeholder="Ej: la salida se cargó a partida incorrecta — el cemento se usó en cimientos del eje B, no del eje A"
              value={motivo}
              onChange={e => setMotivo(e.target.value)}/>
            <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 4 }}>
              Admin/gerencia revisará y aprobará. Si se aprueba, el costo se revierte de la partida actual y se aplica a la nueva.
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
            <button className="btn btn-amber" onClick={submit} disabled={saving || motivo.trim().length < 10}>
              <JxIcon name="check" size={13}/> {saving ? 'Enviando…' : 'Enviar solicitud'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

Object.assign(window, { IngenieroInboxPage });
