// ═══════════════════════════════════════════════════════════════════
// JARVEX — Caja Chica (Almacén)
//
// Fondo de dinero que maneja la almacenera para compras urgentes que no
// pasan por requisición/OC. Libro de movimientos:
//   • entrada = reposición/asignación de fondo (le dan plata)
//   • salida  = gasto (compró algo urgente)
// Saldo actual = Σ entradas − Σ salidas.
// ═══════════════════════════════════════════════════════════════════

import React from "react";
import { exportarDataset } from "../lib/export-historico.js";
import { getEvidenciaSrc, abrirUrlEvidencia } from "../lib/evidencias-url.js";
import { getCurrentMode } from "../lib/app-mode-core.js";
const { useState: uS, useMemo: uM, useEffect: uE } = React;

// EL RESPALDO DE UN GASTO DE CAJA CHICA (8-set-2026). Pedido de Gabriel con el
// feedback de la almacenera: «caja chica con descarga de Excel y también para
// agregar foto de movimientos (puede ser facturas, PDF, foto de evidencia)».
// Hasta hoy el gasto se anotaba con un número de boleta escrito a mano y el
// papel no estaba en ningún lado: al cerrar la caja no había con qué cotejar.
// Tipo propio —no 'factura'— porque la boleta de caja chica NO es un
// comprobante contable del libro; y con visibilidad propia (mig 200), porque
// con el ELSE true de la policy la vería cualquier usuario autenticado.
const TIPO_EVI_CAJA = 'caja_chica_respaldo';
const MAX_RESPALDO_MB = 10;

const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hoyISO = () => new Date().toISOString().slice(0, 10);

function CajaChicaPage({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const userId = auth?.profile?.id ?? 'offline';
  const myRol = auth?.profile?.rol;
  const isAdmin = myRol === 'admin';
  const canWrite = isAdmin || (window.__hasPerm?.(myRol, 'Caja Chica', 'w') ?? false);

  const appMode = window.__useAppMode ? window.__useAppMode() : { superAdmin: false };
  const superAdmin = !!appMode.superAdmin;

  const { obraId } = window.__useObraActiva ? window.__useObraActiva() : { obraId: null };
  const { data: movimientos, create, update, remove, refresh } = window.__hooks.useCajaChica(obraId);
  const { data: personal } = window.__hooks.usePersonal(obraId);

  const [modal, setModal] = uS(null);   // 'entrada' | 'salida'
  const [editingId, setEditingId] = uS(null); // id si estamos editando (Super Admin)
  const [form, setForm] = uS({});
  const [busy, setBusy] = uS(false);
  const [requestTarget, setRequestTarget] = uS(null); // movimiento para "Solicitar Cambio" (rol almacén)
  // Respaldos adjuntos: Map(movimiento_id → [evidencia]). Se leen de Dexie, que
  // es lo que hay offline; el archivo en sí lo sube el EvidenceUploader.
  const [respaldos, setRespaldos] = uS(() => new Map());
  const [subiendo, setSubiendo] = uS(null);   // id del movimiento cuyo archivo se está guardando

  const cargarRespaldos = React.useCallback(async () => {
    if (!obraId) { setRespaldos(new Map()); return; }
    try {
      const evs = await window.__db.evidencias
        .filter(e => !e.deleted_at && e.obra_id === obraId && e.modulo_relacionado === 'caja_chica_movimientos')
        .toArray();
      const m = new Map();
      for (const e of evs.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))) {
        const arr = m.get(e.registro_relacionado_id) || [];
        arr.push(e);
        m.set(e.registro_relacionado_id, arr);
      }
      setRespaldos(m);
    } catch { /* sin respaldos: la tabla se ve igual, solo sin el clip */ }
  }, [obraId]);
  uE(() => { cargarRespaldos(); }, [cargarRespaldos]);
  uE(() => {
    const on = (e) => { const t = e?.detail?.tabla; if (!t || t === 'evidencias') cargarRespaldos(); };
    window.addEventListener('jx_data_changed', on);
    return () => window.removeEventListener('jx_data_changed', on);
  }, [cargarRespaldos]);

  // Adjuntar la foto / el PDF de un movimiento. Acepta imagen y PDF: el gasto
  // se respalda con lo que le hayan dado en el mostrador — a veces una boleta
  // fotografiada, a veces la factura en PDF que llegó por correo.
  const adjuntarRespaldo = async (mov, file) => {
    if (!file || subiendo) return;
    // En modo PRUEBA no se sube nada: __saveEvidenciaLocal crearía una
    // evidencia PENDING que el uploader mandaría al bucket REAL. Mismo guard
    // que SSOMA y Ambiental.
    if (getCurrentMode() === 'prueba') { showToast('En modo PRUEBA no se suben archivos reales', 'amber'); return; }
    const esImagen = String(file.type || '').startsWith('image/');
    const esPdf = file.type === 'application/pdf';
    if (!esImagen && !esPdf) { showToast('Solo se aceptan imágenes o PDF', 'red'); return; }
    if (file.size > MAX_RESPALDO_MB * 1024 * 1024) { showToast(`El archivo supera los ${MAX_RESPALDO_MB} MB`, 'red'); return; }
    setSubiendo(mov.id);
    try {
      await window.__saveEvidenciaLocal?.({
        id: window.__newId(),
        obra_id: obraId,
        tipo_evidencia: TIPO_EVI_CAJA,
        modulo_relacionado: 'caja_chica_movimientos',
        registro_relacionado_id: mov.id,
        nombre_archivo: file.name || `caja_chica_${mov.id}.${esPdf ? 'pdf' : 'jpg'}`,
        mime_type: file.type || (esPdf ? 'application/pdf' : 'image/jpeg'),
        blob: file,
        fecha: mov.fecha || hoyISO(),
        observaciones: `Respaldo de caja chica · ${mov.tipo_movimiento === 'entrada' ? 'ingreso' : 'gasto'} ${fmtS(mov.monto)}${mov.concepto ? ' · ' + mov.concepto : ''}`,
        created_by: userId,
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'evidencias' } })); } catch {}
      showToast('Respaldo adjuntado', 'green');
      cargarRespaldos();
    } catch (e) {
      showToast('Error con el archivo: ' + (e?.message || e), 'red');
    } finally { setSubiendo(null); }
  };

  const verRespaldo = async (ev) => {
    try {
      const src = await getEvidenciaSrc(ev);
      if (src?.url) abrirUrlEvidencia(src.url);
      else showToast('El archivo todavía se está subiendo — probá en unos segundos', 'amber');
    } catch (e) { showToast('Error: ' + (e?.message || e), 'red'); }
  };

  const exportarExcel = async () => {
    if (!obraId) { showToast('No hay obra activa', 'red'); return; }
    try {
      const obra = await window.__db.obras.get(obraId);
      const r = await exportarDataset('caja_chica', obraId, obra?.nombre_obra || obra?.nombre || 'obra', {}, { porModo: true });
      showToast(`Exportado: ${r.filas} movimientos → ${r.archivo}`, 'green');
    } catch (e) { showToast('Error al exportar: ' + (e.message || e), 'red'); }
  };

  // El almacén puede pedir cambios (no editar directo); el admin/super admin edita.
  const puedeSolicitar = canWrite && !isAdmin;
  const mostrarAcciones = superAdmin || puedeSolicitar;

  const personalById = uM(() => {
    const m = new Map();
    (personal || []).forEach(p => m.set(p.id, p));
    return m;
  }, [personal]);

  // Movimientos ordenados desc (más reciente arriba) + saldo running.
  const { ordenados, saldo, totalEntradas, totalSalidas } = uM(() => {
    const vivos = (movimientos || []).filter(m => !m.deleted_at && !m.reverses_id);
    // asc para calcular saldo acumulado
    const asc = [...vivos].sort((a, b) => {
      const fa = `${a.fecha || ''} ${a.created_at || ''}`;
      const fb = `${b.fecha || ''} ${b.created_at || ''}`;
      return fa < fb ? -1 : 1;
    });
    let run = 0, ent = 0, sal = 0;
    const conSaldo = asc.map(m => {
      const monto = Number(m.monto || 0);
      if (m.tipo_movimiento === 'entrada') { run += monto; ent += monto; }
      else { run -= monto; sal += monto; }
      return { ...m, _saldo: run };
    });
    return {
      ordenados: conSaldo.reverse(),
      saldo: run, totalEntradas: ent, totalSalidas: sal,
    };
  }, [movimientos]);

  const abrir = (tipo) => {
    setEditingId(null);
    setForm({ tipo_movimiento: tipo, fecha: hoyISO(), monto: '', concepto: '', responsable_id: '', proveedor: '', documento_asociado: '', observaciones: '' });
    setModal(tipo);
  };
  // Super Admin: editar un movimiento existente (corregir fecha/monto/etc.).
  const abrirEditar = (m) => {
    setEditingId(m.id);
    setForm({
      tipo_movimiento: m.tipo_movimiento, fecha: (m.fecha || '').slice(0, 10), monto: String(m.monto ?? ''),
      concepto: m.concepto || '', responsable_id: m.responsable_id || '', proveedor: m.proveedor || '',
      documento_asociado: m.documento_asociado || '', observaciones: m.observaciones || '',
    });
    setModal(m.tipo_movimiento);
  };
  const eliminar = async (m) => {
    if (!superAdmin) return;
    if (!confirm(`¿Eliminar este movimiento de caja chica (${m.tipo_movimiento} ${fmtS(m.monto)})? Recalcula el saldo.`)) return;
    try {
      await remove(m.id);
      try { await window.__logAudit?.({ action: 'delete', table: 'caja_chica_movimientos', recordId: m.id, oldData: m, reason: 'Super Admin · eliminar movimiento caja chica' }); } catch {}
      showToast('Movimiento eliminado', 'amber');
      refresh?.();
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  const guardar = async () => {
    if (busy) return;
    if (!obraId) { showToast('No hay obra activa', 'red'); return; }
    const monto = parseFloat(form.monto);
    if (!(monto > 0)) { showToast('Ingresá un monto mayor a 0', 'red'); return; }
    if (!editingId && form.tipo_movimiento === 'salida' && monto > saldo) {
      if (!confirm(`El gasto (${fmtS(monto)}) supera el saldo actual (${fmtS(saldo)}). El saldo quedará negativo. ¿Registrar igual?`)) return;
    }
    setBusy(true);
    try {
      const fields = {
        obra_id: obraId,
        fecha: form.fecha || hoyISO(),
        tipo_movimiento: form.tipo_movimiento,
        monto,
        concepto: form.concepto?.trim() || null,
        responsable_id: form.responsable_id || null,
        proveedor: form.proveedor?.trim() || null,
        documento_asociado: form.documento_asociado?.trim() || null,
        observaciones: form.observaciones?.trim() || null,
      };
      if (editingId) {
        await update(editingId, fields);
        try { await window.__logAudit?.({ action: 'update', table: 'caja_chica_movimientos', recordId: editingId, newData: fields, reason: 'Super Admin · editar movimiento caja chica' }); } catch {}
        showToast('Movimiento actualizado', 'green');
      } else {
        await create(fields);
        try { await window.__logAudit?.({ action: 'insert', table: 'caja_chica_movimientos', reason: `${form.tipo_movimiento} caja chica ${fmtS(monto)}` }); } catch {}
        showToast(form.tipo_movimiento === 'entrada' ? 'Ingreso de fondo registrado' : 'Gasto registrado', 'green');
      }
      setModal(null); setForm({}); setEditingId(null);
      refresh?.();
    } catch (e) {
      showToast('Error: ' + (e.message || e), 'red');
    } finally { setBusy(false); }
  };

  if (!obraId) return <SinObraEmpty icon="dollar" />;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Caja Chica</div>
          <div className="pg-sub">Fondo para compras urgentes que maneja la almacenera</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost btn-sm" onClick={exportarExcel}
            title="Descargar el libro de caja chica en Excel, con el saldo acumulado y si cada movimiento tiene respaldo">
            <JxIcon name="download" size={13} />Exportar Excel
          </button>
          {canWrite ? (
            <>
              <button className="btn btn-green btn-sm" onClick={() => abrir('entrada')}><JxIcon name="arrowIn" size={13} />Ingreso de fondo</button>
              <button className="btn btn-ghost btn-sm" onClick={() => abrir('salida')}><JxIcon name="arrowOut" size={13} />Registrar gasto</button>
            </>
          ) : <span className="badge b-gray" title="Tu rol es solo lectura para Caja Chica">Solo lectura</span>}
        </div>
      </div>

      {/* Tarjetas resumen */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 16 }}>
        <div className="card card-p" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: 'var(--tm)', marginBottom: 4 }}>SALDO ACTUAL</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: saldo < 0 ? 'var(--red)' : 'var(--amber)' }}>{fmtS(saldo)}</div>
        </div>
        <div className="card card-p" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: 'var(--tm)', marginBottom: 4 }}>INGRESOS (FONDO)</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--green)' }}>{fmtS(totalEntradas)}</div>
        </div>
        <div className="card card-p" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: 'var(--tm)', marginBottom: 4 }}>GASTOS</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--red)' }}>{fmtS(totalSalidas)}</div>
        </div>
      </div>

      {ordenados.length === 0 ? (
        <div className="card card-p empty-state"><JxIcon name="dollar" size={40} color="var(--tm)" /><p>Todavía no hay movimientos de caja chica. Registrá el primer ingreso de fondo.</p></div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Fecha</th><th>Tipo</th><th>Concepto</th>
                <th style={{ textAlign: 'right' }}>Monto</th>
                <th>Responsable</th><th>Proveedor / Doc.</th>
                <th style={{ textAlign: 'center' }} title="La foto o el PDF de la boleta/factura del movimiento">Respaldo</th>
                <th style={{ textAlign: 'right' }}>Saldo</th>
                {mostrarAcciones && <th style={{ textAlign: 'center' }}>{superAdmin ? '⚡ Acciones' : 'Acciones'}</th>}
              </tr></thead>
              <tbody>
                {ordenados.map(m => {
                  const resp = personalById.get(m.responsable_id);
                  const esEntrada = m.tipo_movimiento === 'entrada';
                  return (
                    <tr key={m.id}>
                      <td className="col-m">{m.fecha || '—'}</td>
                      <td><span className={`badge ${esEntrada ? 'b-green' : 'b-red'}`}>{esEntrada ? 'Ingreso' : 'Gasto'}</span></td>
                      <td>{m.concepto || '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: esEntrada ? 'var(--green)' : 'var(--red)' }}>{esEntrada ? '+' : '−'} {fmtS(m.monto)}</td>
                      <td className="col-m">{resp ? `${resp.nombres} ${resp.apellidos || ''}`.trim() : '—'}</td>
                      <td className="col-m" style={{ fontSize: 11 }}>{[m.proveedor, m.documento_asociado].filter(Boolean).join(' · ') || '—'}</td>
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {(respaldos.get(m.id) || []).map(ev => (
                          <button key={ev.id} className="btn btn-ghost btn-xs" style={{ padding: '1px 5px' }}
                            title={`${ev.nombre_archivo || 'respaldo'}${ev.sync_status && ev.sync_status !== 'synced' ? ' (subiendo)' : ''} — clic para abrir`}
                            onClick={() => verRespaldo(ev)}>
                            <JxIcon name={ev.mime_type === 'application/pdf' ? 'file' : 'image'} size={11} />
                          </button>
                        ))}
                        {canWrite && (
                          <label className="btn btn-ghost btn-xs" style={{ padding: '1px 5px', cursor: subiendo === m.id ? 'wait' : 'pointer', opacity: subiendo === m.id ? 0.5 : 1 }}
                            title="Adjuntar la boleta, la factura o una foto del gasto (imagen o PDF)">
                            <JxIcon name="camera" size={11} />
                            <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} disabled={!!subiendo}
                              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; adjuntarRespaldo(m, f); }} />
                          </label>
                        )}
                        {!canWrite && !(respaldos.get(m.id) || []).length && <span style={{ color: 'var(--tm)', fontSize: 11 }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: m._saldo < 0 ? 'var(--red)' : 'var(--ts)' }}>{fmtS(m._saldo)}</td>
                      {mostrarAcciones && (
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {superAdmin ? (
                            <>
                              <button className="btn btn-ghost btn-xs" title="⚡ Editar movimiento" onClick={() => abrirEditar(m)}><JxIcon name="edit" size={11} /></button>
                              <button className="btn btn-red btn-xs" title="⚡ Eliminar movimiento" onClick={() => eliminar(m)} style={{ marginLeft: 4 }}><JxIcon name="trash" size={11} /></button>
                            </>
                          ) : (
                            <button className="btn btn-ghost btn-xs" title="Solicitar cambio (requiere aprobación de un admin)" onClick={() => setRequestTarget(m)}><JxIcon name="edit" size={11} /> Solicitar cambio</button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal nuevo / editar movimiento */}
      {modal && (
        <Modal title={editingId ? '⚡ Editar movimiento de caja chica' : (modal === 'entrada' ? 'Ingreso de fondo a caja chica' : 'Registrar gasto de caja chica')} icon="dollar" onClose={() => { setModal(null); setForm({}); setEditingId(null); }}>
          <div className="g2">
            {editingId && (
              <div style={{ gridColumn: '1/-1' }}><label className="flabel">Tipo</label>
                <select className="fi" value={form.tipo_movimiento || 'entrada'} onChange={e => setForm({ ...form, tipo_movimiento: e.target.value })}>
                  <option value="entrada">Ingreso de fondo</option>
                  <option value="salida">Gasto</option>
                </select></div>
            )}
            <div><label className="flabel">Fecha</label>
              <input className="fi" type="date" value={form.fecha || ''} max={hoyISO()} onChange={e => setForm({ ...form, fecha: e.target.value })} /></div>
            <div><label className="flabel">Monto (S/) *</label>
              <input className="fi" type="number" min="0" step="0.01" value={form.monto || ''} onChange={e => setForm({ ...form, monto: e.target.value })} placeholder="0.00" /></div>
            <div style={{ gridColumn: '1/-1' }}><label className="flabel">Concepto</label>
              <input className="fi" value={form.concepto || ''} onChange={e => setForm({ ...form, concepto: e.target.value })} placeholder={modal === 'entrada' ? 'Reposición de fondo de caja chica' : 'Compra urgente de…'} /></div>
            <div><label className="flabel">{modal === 'entrada' ? 'Recibe' : 'Gasta'} (responsable)</label>
              <select className="fi" value={form.responsable_id || ''} onChange={e => setForm({ ...form, responsable_id: e.target.value })}>
                <option value="">—</option>
                {(personal || []).filter(p => !p.deleted_at).map(p => <option key={p.id} value={p.id}>{p.nombres} {p.apellidos || ''}</option>)}
              </select></div>
            {modal === 'salida' && (
              <div><label className="flabel">Proveedor / dónde compró</label>
                <input className="fi" value={form.proveedor || ''} onChange={e => setForm({ ...form, proveedor: e.target.value })} placeholder="Ferretería, bodega…" /></div>
            )}
            <div style={{ gridColumn: '1/-1' }}><label className="flabel">Comprobante (boleta/factura nro)</label>
              <input className="fi" value={form.documento_asociado || ''} onChange={e => setForm({ ...form, documento_asociado: e.target.value })} placeholder="Opcional" /></div>
            <div style={{ gridColumn: '1/-1' }}><label className="flabel">Observaciones</label>
              <textarea className="fi" rows={2} value={form.observaciones || ''} onChange={e => setForm({ ...form, observaciones: e.target.value })} /></div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={() => { setModal(null); setForm({}); setEditingId(null); }} disabled={busy}>Cancelar</button>
            <button className={`btn ${form.tipo_movimiento === 'entrada' ? 'btn-green' : 'btn-amber'}`} onClick={guardar} disabled={busy}>
              {busy ? 'Guardando…' : editingId ? 'Guardar cambios' : (form.tipo_movimiento === 'entrada' ? 'Registrar ingreso' : 'Registrar gasto')}
            </button>
          </div>
        </Modal>
      )}

      {/* Solicitar cambio (rol almacén) — requiere aprobación de un admin */}
      {requestTarget && (
        <RequestChangeModal
          table="caja_chica_movimientos"
          record={requestTarget}
          recordLabel={`${requestTarget.fecha || ''} · ${requestTarget.concepto || (requestTarget.tipo_movimiento === 'entrada' ? 'Ingreso' : 'Gasto')} · S/ ${requestTarget.monto ?? ''}`.trim()}
          allowDelete
          fields={[
            { key: 'fecha', label: 'Fecha', type: 'date' },
            { key: 'tipo_movimiento', label: 'Tipo', options: [
              { value: 'entrada', label: 'Ingreso de fondo' },
              { value: 'salida', label: 'Gasto' },
            ]},
            { key: 'monto', label: 'Monto (S/)', type: 'number' },
            { key: 'concepto', label: 'Concepto' },
            { key: 'proveedor', label: 'Proveedor' },
            { key: 'documento_asociado', label: 'Documento asociado' },
            { key: 'observaciones', label: 'Observaciones' },
          ]}
          showToast={showToast}
          onClose={() => setRequestTarget(null)}
        />
      )}
    </div>
  );
}

Object.assign(window, { CajaChicaPage });
