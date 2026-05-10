// ═══════════════════════════════════════════════════════════════════
// JARVEX — Compras pendientes de recepción
//
// Pantalla pensada para el almacenero (también accesible a admin /
// jefe_compras). Lista todas las facturas que la contadora cargó vía
// captura mágica y que tienen recepcion_status='pendiente_recepcion'.
//
// El almacenero ve solo lo que necesita:
//   - Nombre del proveedor / razón social
//   - Items: descripción + cantidad + unidad (NO precio)
//   - Fecha de la factura
// Click en "Registrar recepción" → modal de ingreso con los items
// pre-rellenados. Al confirmar, marca la factura como 'recibido' y
// crea los movimientos de entrada al inventario.
// ═══════════════════════════════════════════════════════════════════
import React from "react";

const { useState: uS, useEffect: uE, useMemo: uM } = React;

const JxIcon = (props) => (window.JxIcon ? <window.JxIcon {...props}/> : null);
const Modal = (props) => (window.Modal ? <window.Modal {...props}/> : null);

function ComprasPendientesPage({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : {};
  const userId = auth?.profile?.id || null;
  const obraId = window.__useObraActiva ? window.__useObraActiva() : null;

  const [movsContables, setMovsContables] = uS([]);
  const [materiales, setMateriales] = uS([]);
  const [proveedores, setProveedores] = uS([]);
  const [loading, setLoading] = uS(true);
  const [recibiendoId, setRecibiendoId] = uS(null);   // id del mov contable a recibir
  const [busy, setBusy] = uS(false);

  // Carga inicial + reactivo a sync
  uE(() => {
    if (!obraId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [mc, mt, pr] = await Promise.all([
          window.__db.accounting_movements
            .where('obra_id').equals(obraId)
            .filter(m => m.recepcion_status === 'pendiente_recepcion' && !m.deleted_at)
            .toArray(),
          window.__db.materiales.where('obra_id').equals(obraId).toArray(),
          window.__db.proveedores.toArray(),
        ]);
        if (cancelled) return;
        mc.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        setMovsContables(mc);
        setMateriales(mt);
        setProveedores(pr);
      } catch (e) {
        console.warn('[compras-pendientes]', e?.message || e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const onChange = (e) => {
      const t = e?.detail?.tabla || e?.detail?.table;
      if (!t || ['accounting_movements','materiales','proveedores'].includes(t)) load();
    };
    window.addEventListener('jx_data_changed', onChange);
    window.addEventListener('jarvex_master_updated', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('jx_data_changed', onChange);
      window.removeEventListener('jarvex_master_updated', onChange);
    };
  }, [obraId]);

  const matsById = uM(() => new Map(materiales.map(m => [m.id, m])), [materiales]);
  const provsById = uM(() => new Map(proveedores.map(p => [p.id, p])), [proveedores]);

  // Parse items del JSON de notas (los guarda captura mágica)
  const parseItems = (notasRaw) => {
    try {
      const j = JSON.parse(notasRaw || '{}');
      return Array.isArray(j.items_factura) ? j.items_factura : [];
    } catch { return []; }
  };

  const facturaSeleccionada = recibiendoId
    ? movsContables.find(m => m.id === recibiendoId)
    : null;

  if (!obraId) {
    return (
      <div className="page-wrap">
        <div className="empty-state">
          <JxIcon name="package" size={32} color="var(--tm)"/>
          <p>Selecciona una obra activa para ver las compras pendientes.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Compras pendientes de recepción</div>
          <div className="pg-sub">
            {movsContables.length} factura(s) esperando que el almacén confirme la llegada
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card card-p" style={{ textAlign:'center', color:'var(--tm)' }}>Cargando...</div>
      ) : movsContables.length === 0 ? (
        <div className="card card-p" style={{ textAlign:'center', color:'var(--tm)' }}>
          <JxIcon name="check" size={28} color="var(--green)"/>
          <p style={{ marginTop:10 }}>Sin compras pendientes. Cuando la contadora cargue una factura aparecerá aquí.</p>
        </div>
      ) : (
        <div style={{ display:'grid', gap:10 }}>
          {movsContables.map(mc => {
            const items = parseItems(mc.notas);
            const prov = mc.proveedor_id ? provsById.get(mc.proveedor_id) : null;
            const provName = prov?.razon_social || mc.third_party_name || '—';
            return (
              <div key={mc.id} className="card card-p" style={{ borderLeft:'3px solid var(--amber)' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10, flexWrap:'wrap' }}>
                  <div style={{ flex:1, minWidth:280 }}>
                    <div style={{ fontSize:11, color:'var(--amber)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em' }}>
                      {mc.document_type || 'comprobante'} {mc.document_number}
                    </div>
                    <div style={{ fontSize:14, fontWeight:600, color:'var(--ts)', marginTop:2 }}>
                      {provName}
                    </div>
                    <div style={{ fontSize:11.5, color:'var(--tm)', marginTop:4 }}>
                      Fecha factura: {mc.date} · cargada el {(mc.created_at || '').slice(0,10)}
                    </div>
                  </div>
                  <button className="btn btn-amber btn-sm" onClick={() => setRecibiendoId(mc.id)}>
                    <JxIcon name="arrowIn" size={12}/> Registrar recepción
                  </button>
                </div>
                {items.length > 0 ? (
                  <div style={{ marginTop:10, padding:'8px 10px', background:'var(--bg2)', border:'1px solid var(--bd)', borderRadius:6 }}>
                    <div style={{ fontSize:10.5, color:'var(--tm)', fontWeight:600, marginBottom:4, textTransform:'uppercase', letterSpacing:'.05em' }}>
                      Items a recibir ({items.length})
                    </div>
                    <table className="tbl" style={{ fontSize:11.5 }}>
                      <thead><tr>
                        <th>Material</th>
                        <th style={{ width:90, textAlign:'right' }}>Cantidad</th>
                        <th style={{ width:60 }}>Unidad</th>
                        <th style={{ width:80 }}>En catálogo</th>
                      </tr></thead>
                      <tbody>
                        {items.map((it, i) => {
                          const enCatalogo = it.material_id && matsById.has(it.material_id);
                          return (
                            <tr key={i}>
                              <td style={{ color:'var(--ts)' }}>{it.descripcion || '—'}</td>
                              <td style={{ textAlign:'right', fontWeight:600 }}>{Number(it.cantidad).toLocaleString('es-PE')}</td>
                              <td style={{ color:'var(--tm)' }}>{it.unidad || '—'}</td>
                              <td>
                                {enCatalogo
                                  ? <span className="badge b-green" style={{ fontSize:9 }}>OK</span>
                                  : <span className="badge b-yellow" style={{ fontSize:9 }}>Falta</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ marginTop:10, fontSize:11, color:'var(--tm)', fontStyle:'italic' }}>
                    La factura no detalla items (probablemente un gasto general).
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Registrar Recepción */}
      {facturaSeleccionada && (
        <RegistrarRecepcionModal
          factura={facturaSeleccionada}
          items={parseItems(facturaSeleccionada.notas)}
          obraId={obraId}
          userId={userId}
          matsById={matsById}
          provsById={provsById}
          busy={busy}
          setBusy={setBusy}
          showToast={showToast}
          onClose={() => setRecibiendoId(null)}
        />
      )}
    </div>
  );
}

// ─── Modal de Recepción ──────────────────────────────────────────────
function RegistrarRecepcionModal({ factura, items, obraId, userId, matsById, provsById, busy, setBusy, showToast, onClose }) {
  // Estado local: lista de items con cantidad editable (default = cantidad de factura)
  const [recepItems, setRecepItems] = uS(() =>
    items.map(it => ({
      ...it,
      cantidad_recibida: Number(it.cantidad) || 0,
      verificado: true,
    }))
  );
  const [observaciones, setObservaciones] = uS('');
  const [ubicacionId, setUbicacionId] = uS(null);
  const [ubicaciones, setUbicaciones] = uS([]);

  uE(() => {
    let cancelled = false;
    (async () => {
      try {
        const u = await window.__db.ubicaciones_obra
          .where('obra_id').equals(obraId)
          .filter(x => x.activo !== false && !x.deleted_at)
          .toArray();
        if (!cancelled) setUbicaciones(u || []);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [obraId]);

  const updateRecep = (idx, patch) => {
    setRecepItems(arr => arr.map((it, i) => i === idx ? { ...it, ...patch } : it));
  };

  const confirmar = async () => {
    const validos = recepItems.filter(r => r.verificado && r.material_id && Number(r.cantidad_recibida) > 0);
    if (validos.length === 0) {
      showToast?.('Marcá al menos 1 ítem como verificado con cantidad > 0', 'red');
      return;
    }
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const movIds = [];
      for (const it of validos) {
        const movId = window.__newId();
        await window.__db.movimientos_materiales.add({
          id: movId,
          obra_id: obraId,
          material_id: it.material_id,
          fecha: now.slice(0, 10),
          hora: now.slice(11, 16),
          tipo_movimiento: 'entrada',
          cantidad: Number(it.cantidad_recibida) || 0,
          unidad: it.unidad || 'und',
          proveedor_id: factura.proveedor_id || null,
          documento_asociado: factura.document_number || null,
          precio_unitario_real: Number(it.precio_unitario) || 0,
          partida_id: null,
          observaciones: `Recepción factura ${factura.document_number}${observaciones ? ' · ' + observaciones : ''}`,
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create',
          idempotency_key: `${userId}_movmat_${movId}`,
        });
        // Si el almacenero eligió ubicación, actualizar el material
        if (ubicacionId) {
          const mat = matsById.get(it.material_id);
          if (mat && mat.ubicacion_id !== ubicacionId) {
            try {
              await window.__db.materiales.update(it.material_id, {
                ubicacion_id: ubicacionId,
                updated_at: now, updated_by: userId,
                version: (mat.version || 0) + 1,
                sync_status: mat.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
              });
            } catch {}
          }
        }
        movIds.push(movId);
      }
      // Marcar la factura como recibida (vincular al primer mov para auditoría)
      await window.__db.accounting_movements.update(factura.id, {
        recepcion_status: 'recibido',
        recepcion_movimiento_id: movIds[0] || null,
        recepcion_fecha: now,
        recepcion_por: userId,
        updated_at: now, updated_by: userId,
        version: (factura.version || 0) + 1,
        sync_status: factura.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });

      try { await window.__logAudit?.({
        action: 'update', table: 'accounting_movements', recordId: factura.id,
        newData: { recepcion_status: 'recibido', movs_creados: movIds.length },
        reason: `Recepción confirmada — ${validos.length} mov(s) de entrada · factura ${factura.document_number}`,
      }); } catch {}

      showToast?.(`✓ Recepción registrada: ${validos.length} ingreso(s) al almacén`, 'green');
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'movimientos_materiales' } })); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'accounting_movements' } })); } catch {}
      onClose();
    } catch (e) {
      showToast?.('Error al registrar recepción: ' + (e?.message || e), 'red');
      console.error('[registrar-recepcion]', e);
    } finally {
      setBusy(false);
    }
  };

  const provName = factura.proveedor_id
    ? (provsById.get(factura.proveedor_id)?.razon_social || factura.third_party_name)
    : factura.third_party_name;

  return (
    <Modal title={`Registrar recepción · ${factura.document_number}`} icon="arrowIn" onClose={onClose} wide>
      <div style={{ marginBottom: 12, padding: '10px 12px', background: 'rgba(52,152,219,0.08)', border: '1px solid rgba(52,152,219,0.25)', borderRadius: 6, fontSize: 12 }}>
        <strong>{provName || '—'}</strong> · factura del {factura.date}<br/>
        <span style={{ color: 'var(--tm)', fontSize: 11 }}>
          Verificá que cada ítem haya llegado físicamente. Marcá ✓ y ajustá la cantidad si recibiste diferente a la facturada.
        </span>
      </div>

      <div style={{ overflow: 'auto', maxHeight: 360, border: '1px solid var(--bd)', borderRadius: 6, marginBottom: 12 }}>
        <table className="tbl" style={{ fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ width: 40, textAlign: 'center' }}>✓</th>
              <th>Material</th>
              <th style={{ width: 100, textAlign: 'right' }}>Facturado</th>
              <th style={{ width: 110, textAlign: 'right' }}>Recibido *</th>
              <th style={{ width: 60 }}>Unidad</th>
            </tr>
          </thead>
          <tbody>
            {recepItems.map((it, i) => {
              const enCatalogo = it.material_id && matsById.has(it.material_id);
              return (
                <tr key={i} style={{ opacity: it.verificado ? 1 : 0.5 }}>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={it.verificado}
                      onChange={e => updateRecep(i, { verificado: e.target.checked })} />
                  </td>
                  <td>
                    <div style={{ fontSize: 12, color: enCatalogo ? 'var(--ts)' : 'var(--tm)' }}>
                      {it.descripcion}
                    </div>
                    {!enCatalogo && (
                      <div style={{ fontSize: 10, color: 'var(--red)', marginTop: 2 }}>
                        ⚠ no está en catálogo — pedile a gerencia que lo cree
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--tm)' }}>
                    {Number(it.cantidad).toLocaleString('es-PE')}
                  </td>
                  <td>
                    <input className="fi" type="number" min="0" step="0.01"
                      value={it.cantidad_recibida}
                      disabled={!it.verificado || !enCatalogo}
                      onChange={e => updateRecep(i, { cantidad_recibida: e.target.value })}
                      style={{ fontSize: 12, textAlign: 'right' }} />
                  </td>
                  <td style={{ color: 'var(--tm)' }}>{it.unidad || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="g2" style={{ marginBottom: 12 }}>
        <div>
          <label className="flabel">Ubicación destino (opcional)</label>
          <select className="fi" value={ubicacionId || ''} onChange={e => setUbicacionId(e.target.value || null)}>
            <option value="">— Sin asignar —</option>
            {ubicaciones.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="flabel">Observaciones</label>
          <input className="fi" value={observaciones}
            onChange={e => setObservaciones(e.target.value)}
            placeholder="Llegó completo / faltó X / vino dañado..." />
        </div>
      </div>

      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn btn-amber" onClick={confirmar} disabled={busy}>
          <JxIcon name="check" size={13} />
          {busy ? 'Procesando…' : 'Confirmar recepción'}
        </button>
      </div>
    </Modal>
  );
}

Object.assign(window, { ComprasPendientesPage });
