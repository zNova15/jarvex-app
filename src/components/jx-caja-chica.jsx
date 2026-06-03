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
const { useState: uS, useMemo: uM } = React;

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
        {canWrite ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-green btn-sm" onClick={() => abrir('entrada')}><JxIcon name="arrowIn" size={13} />Ingreso de fondo</button>
            <button className="btn btn-ghost btn-sm" onClick={() => abrir('salida')}><JxIcon name="arrowOut" size={13} />Registrar gasto</button>
          </div>
        ) : <span className="badge b-gray" title="Tu rol es solo lectura para Caja Chica">Solo lectura</span>}
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
                <th style={{ textAlign: 'right' }}>Saldo</th>
                {superAdmin && <th style={{ textAlign: 'center' }}>⚡ Acciones</th>}
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
                      <td style={{ textAlign: 'right', fontWeight: 600, color: m._saldo < 0 ? 'var(--red)' : 'var(--ts)' }}>{fmtS(m._saldo)}</td>
                      {superAdmin && (
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <button className="btn btn-ghost btn-xs" title="⚡ Editar movimiento" onClick={() => abrirEditar(m)}><JxIcon name="edit" size={11} /></button>
                          <button className="btn btn-red btn-xs" title="⚡ Eliminar movimiento" onClick={() => eliminar(m)} style={{ marginLeft: 4 }}><JxIcon name="trash" size={11} /></button>
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
    </div>
  );
}

Object.assign(window, { CajaChicaPage });
