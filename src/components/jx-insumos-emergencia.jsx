// ═══════════════════════════════════════════════════════════════════
// JARVEX — Insumos de Emergencia (SSOMA / Seguridad)
//
// Inventario propio de insumos de emergencia (botiquín, extintores,
// camillas, etc.): catálogo con unidad + stock, y movimientos de
// entrada/salida. stock_actual = stock_inicial + Σ entradas − Σ salidas.
// Mismo patrón que Materiales pero acotado a Seguridad.
// ═══════════════════════════════════════════════════════════════════

import React from "react";
import { calcAlerta } from "../lib/stock-utils.js";

const { useState: uS, useMemo: uM, useEffect: uE } = React;
const hoyISO = () => new Date().toISOString().slice(0, 10);
const alertaClase = (a) => (a === 'agotado' || a === 'critico') ? 'b-red' : (a === 'reponer' || a === 'cerca') ? 'b-amber' : 'b-green';

function InsumosEmergenciaPage({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const userId = auth?.profile?.id ?? 'offline';
  const myRol = auth?.profile?.rol;
  const isAdmin = myRol === 'admin';
  const appMode = window.__useAppMode ? window.__useAppMode() : { isPrueba: true, isEdicion: false, superAdmin: false };
  const superAdmin = !!appMode.superAdmin;
  const canWrite = isAdmin || (window.__hasPerm?.(myRol, 'Insumos de Emergencia', 'w') ?? false);
  const canDelete = isAdmin && (appMode.isEdicion || appMode.isPrueba);

  const { obraId } = window.__useObraActiva ? window.__useObraActiva() : { obraId: null };
  const { data: insumos, create: createInsumo, update: updateInsumo, refresh } = window.__hooks.useInsumosEmergencia(obraId);
  const movHook = window.__hooks.useMovInsumosEmergencia(obraId);
  const { data: personal } = window.__hooks.usePersonal(obraId);

  const [q, setQ] = uS('');
  const [vista, setVista] = uS('inventario'); // 'inventario' | 'movimientos'
  const [modal, setModal] = uS(null);   // 'nuevo' | 'editar' | 'mov'
  const [form, setForm] = uS({});
  const [busy, setBusy] = uS(false);
  // Proveedores (tabla global): carga directa de Dexie como el resto de pantallas.
  const [proveedores, setProveedores] = uS([]);
  uE(() => { window.__db.proveedores.filter(p => !p.deleted_at).toArray().then(setProveedores).catch(() => {}); }, []);

  const personalById = uM(() => { const m = new Map(); (personal || []).forEach(p => m.set(p.id, p)); return m; }, [personal]);
  const insumoById = uM(() => { const m = new Map(); (insumos || []).forEach(i => m.set(i.id, i)); return m; }, [insumos]);
  const proveedorById = uM(() => { const m = new Map(); (proveedores || []).forEach(p => m.set(p.id, p)); return m; }, [proveedores]);

  // Movimientos de entrada/salida (más reciente primero) para la pestaña.
  const movimientos = uM(() => {
    return (movHook.data || [])
      .filter(mv => !mv.deleted_at)
      .slice()
      .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
  }, [movHook.data]);

  // Eliminar un movimiento (soft-delete) y revertir su efecto en el stock.
  const eliminarMov = async (mv) => {
    const ins = insumoById.get(mv.insumo_emergencia_id);
    if (!confirm(`¿Eliminar este movimiento (${mv.tipo_movimiento} de ${mv.cantidad} ${mv.unidad || ''} · ${ins?.nombre || 'insumo'})?\n\nEl stock se ajusta automáticamente.`)) return;
    try {
      const now = new Date().toISOString();
      await window.__db.movimientos_insumos_emergencia.update(mv.id, {
        deleted_at: now, updated_at: now, updated_by: userId,
        version: (mv.version ?? 0) + 1,
        sync_status: mv.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
      });
      if (ins) {
        const delta = mv.tipo_movimiento === 'entrada' ? -Number(mv.cantidad || 0) : Number(mv.cantidad || 0);
        const nuevoStock = Math.max(0, Number(ins.stock_actual ?? 0) + delta);
        await updateInsumo(ins.id, { stock_actual: nuevoStock, alerta: calcAlerta(nuevoStock, Number(ins.stock_minimo || 0)) });
      }
      try { await window.__logAudit?.({ action: 'delete', table: 'movimientos_insumos_emergencia', recordId: mv.id, reason: 'Eliminación de movimiento de insumo de emergencia' }); } catch {}
      showToast('Movimiento eliminado', 'amber'); refresh?.();
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  const filtered = uM(() => {
    const lista = (insumos || []).filter(i => !i.deleted_at);
    if (!q) return lista;
    const t = q.toLowerCase();
    return lista.filter(i => i.nombre?.toLowerCase().includes(t) || i.categoria?.toLowerCase().includes(t));
  }, [insumos, q]);

  const stats = uM(() => {
    const lista = (insumos || []).filter(i => !i.deleted_at);
    const bajos = lista.filter(i => i.alerta === 'agotado' || i.alerta === 'critico' || i.alerta === 'reponer').length;
    return { total: lista.length, bajos };
  }, [insumos]);

  // ── Insumo (catálogo) ──────────────────────────────────────────────
  const abrirNuevo = () => { setForm({ unidad: 'Und', stock_inicial: '', stock_minimo: '', categoria: '', vencimiento: '' }); setModal('nuevo'); };
  const abrirEditar = (i) => { setForm({ ...i, stock_inicial: i.stock_inicial ?? '', stock_minimo: i.stock_minimo ?? '' }); setModal('editar'); };

  const guardarInsumo = async () => {
    if (busy) return;
    if (!form.nombre?.trim() || !form.unidad?.trim()) { showToast('Completá nombre y unidad', 'red'); return; }
    setBusy(true);
    try {
      const stockMin = parseFloat(form.stock_minimo) || 0;
      if (modal === 'editar' && form.id) {
        await updateInsumo(form.id, {
          nombre: form.nombre.trim(), categoria: form.categoria?.trim() || null, unidad: form.unidad.trim(),
          stock_minimo: stockMin, vencimiento: form.vencimiento || null, observaciones: form.observaciones?.trim() || null,
          alerta: calcAlerta(Number(form.stock_actual ?? 0), stockMin),
        });
        showToast('Insumo actualizado', 'green');
      } else {
        const stockIni = parseFloat(form.stock_inicial) || 0;
        await createInsumo({
          obra_id: obraId, nombre: form.nombre.trim(), categoria: form.categoria?.trim() || null, unidad: form.unidad.trim(),
          stock_inicial: stockIni, stock_actual: stockIni, stock_minimo: stockMin,
          vencimiento: form.vencimiento || null, observaciones: form.observaciones?.trim() || null,
          alerta: calcAlerta(stockIni, stockMin), estado: 'activo',
        });
        showToast(`Insumo "${form.nombre.trim()}" creado`, 'green');
      }
      setModal(null); setForm({}); refresh?.();
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); } finally { setBusy(false); }
  };

  const eliminarInsumo = async (i) => {
    if (!canDelete) return;
    if (!confirm(`¿Eliminar el insumo "${i.nombre}"?`)) return;
    try { await updateInsumo(i.id, { deleted_at: new Date().toISOString() }); showToast('Insumo eliminado', 'amber'); refresh?.(); }
    catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  // ── Movimiento (entrada/salida) ────────────────────────────────────
  const abrirMov = (tipo) => { setForm({ tipo_movimiento: tipo, fecha: hoyISO(), insumo_emergencia_id: '', cantidad: '', responsable_id: '', proveedor_id: '', observaciones: '' }); setModal('mov'); };

  const guardarMov = async () => {
    if (busy) return;
    const insumo = (insumos || []).find(i => i.id === form.insumo_emergencia_id);
    if (!insumo) { showToast('Elegí un insumo', 'red'); return; }
    const cant = parseFloat(form.cantidad);
    if (!(cant > 0)) { showToast('Cantidad debe ser mayor a 0', 'red'); return; }
    const esEntrada = form.tipo_movimiento === 'entrada';
    const stockActual = Number(insumo.stock_actual ?? 0);
    if (!esEntrada && cant > stockActual) {
      showToast(`❌ Stock insuficiente de "${insumo.nombre}": hay ${stockActual} ${insumo.unidad}, pedís ${cant}. No se puede sacar lo que no existe.`, 'red');
      return;
    }
    setBusy(true);
    try {
      await movHook.create({
        obra_id: obraId, insumo_emergencia_id: insumo.id, fecha: form.fecha || hoyISO(),
        tipo_movimiento: form.tipo_movimiento, cantidad: cant, unidad: insumo.unidad,
        responsable_id: form.responsable_id || null, proveedor_id: form.proveedor_id || null,
        observaciones: form.observaciones?.trim() || null,
      });
      const nuevoStock = Math.max(0, stockActual + (esEntrada ? cant : -cant));
      await updateInsumo(insumo.id, { stock_actual: nuevoStock, alerta: calcAlerta(nuevoStock, Number(insumo.stock_minimo || 0)) });
      try { await window.__logAudit?.({ action: 'insert', table: 'movimientos_insumos_emergencia', reason: `${form.tipo_movimiento} ${cant} ${insumo.unidad} de ${insumo.nombre}` }); } catch {}
      showToast(esEntrada ? 'Ingreso registrado' : 'Salida registrada', 'green');
      setModal(null); setForm({}); refresh?.();
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); } finally { setBusy(false); }
  };

  if (!obraId) return <SinObraEmpty icon="package" />;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Insumos de Emergencia</div>
          <div className="pg-sub">{stats.total} insumos{stats.bajos > 0 ? ` · ${stats.bajos} con stock bajo` : ''}</div>
        </div>
        {canWrite ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-green btn-sm" onClick={() => abrirMov('entrada')}><JxIcon name="arrowIn" size={13} />Ingreso</button>
            <button className="btn btn-ghost btn-sm" onClick={() => abrirMov('salida')}><JxIcon name="arrowOut" size={13} />Salida</button>
            <button className="btn btn-amber btn-sm" onClick={abrirNuevo}><JxIcon name="plus" size={13} />Nuevo insumo</button>
          </div>
        ) : <span className="badge b-gray" title="Tu rol es solo lectura para Insumos de Emergencia">Solo lectura</span>}
      </div>

      {/* Pestañas: Inventario / Movimientos */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, background: 'var(--bg-s)', padding: 4, borderRadius: 8, width: 'fit-content' }}>
        <button className={`btn btn-sm ${vista === 'inventario' ? 'btn-amber' : 'btn-ghost'}`} style={{ border: 'none' }} onClick={() => setVista('inventario')}>
          <JxIcon name="package" size={13} />Inventario ({stats.total})
        </button>
        <button className={`btn btn-sm ${vista === 'movimientos' ? 'btn-amber' : 'btn-ghost'}`} style={{ border: 'none' }} onClick={() => setVista('movimientos')}>
          <JxIcon name="compare" size={13} />Movimientos ({movimientos.length})
        </button>
      </div>

      {vista === 'inventario' && (
      <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <div className="search-bar"><JxIcon name="search" size={14} color="var(--tm)" /><input placeholder="Buscar insumo…" value={q} onChange={e => setQ(e.target.value)} /></div>
      </div>

      {filtered.length === 0 ? (
        <div className="card card-p empty-state"><JxIcon name="package" size={40} color="var(--tm)" /><p>No hay insumos de emergencia. Click en "Nuevo insumo".</p></div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Insumo</th><th>Categoría</th><th>Unidad</th>
                <th style={{ textAlign: 'right' }}>Stock</th>
                <th style={{ textAlign: 'right' }}>Mínimo</th>
                <th>Vence</th><th>Sync</th>
                <th style={{ textAlign: 'center' }}>Acciones</th>
              </tr></thead>
              <tbody>
                {filtered.map(i => {
                  const st = Number(i.stock_actual ?? 0);
                  return (
                    <tr key={i.id}>
                      <td className="col-p"><strong>{i.nombre}</strong></td>
                      <td>{i.categoria || '—'}</td>
                      <td className="col-m">{i.unidad}</td>
                      <td style={{ textAlign: 'right' }}><span className={`badge ${alertaClase(i.alerta)}`}>{st.toLocaleString('es-PE')}</span></td>
                      <td style={{ textAlign: 'right', color: 'var(--tm)' }}>{Number(i.stock_minimo ?? 0).toLocaleString('es-PE')}</td>
                      <td className="col-m" style={{ fontSize: 11 }}>{i.vencimiento || '—'}</td>
                      <td>{i.sync_status && i.sync_status !== 'synced' ? <span className="badge b-amber">⏱</span> : <span style={{ color: 'var(--green)', fontSize: 11 }}>✓</span>}</td>
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {canWrite && <button className="btn btn-ghost btn-xs" title="Editar" onClick={() => abrirEditar(i)}><JxIcon name="edit" size={11} /></button>}
                        {canDelete && <button className="btn btn-red btn-xs" title="Eliminar (modo edición)" onClick={() => eliminarInsumo(i)} style={{ marginLeft: 4 }}><JxIcon name="trash" size={11} /></button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </>
      )}

      {/* Pestaña Movimientos */}
      {vista === 'movimientos' && (
        movimientos.length === 0 ? (
          <div className="card card-p empty-state"><JxIcon name="compare" size={40} color="var(--tm)" /><p>Sin movimientos todavía. Registrá un Ingreso o una Salida.</p></div>
        ) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr>
                  <th>Fecha</th><th>Tipo</th><th>Insumo</th>
                  <th style={{ textAlign: 'right' }}>Cantidad</th>
                  <th>Proveedor / Responsable</th><th>Observaciones</th>
                  {(canDelete || superAdmin) && <th style={{ textAlign: 'center' }}>Acciones</th>}
                </tr></thead>
                <tbody>
                  {movimientos.map(mv => {
                    const ins = insumoById.get(mv.insumo_emergencia_id);
                    const esEntrada = mv.tipo_movimiento === 'entrada';
                    const quien = esEntrada
                      ? (proveedorById.get(mv.proveedor_id)?.razon_social || '—')
                      : (() => { const p = personalById.get(mv.responsable_id); return p ? `${p.nombres} ${p.apellidos || ''}`.trim() : '—'; })();
                    return (
                      <tr key={mv.id}>
                        <td className="col-m">{mv.fecha || '—'}</td>
                        <td><span className={`badge ${esEntrada ? 'b-green' : 'b-amber'}`}>{esEntrada ? '↓ Ingreso' : '↑ Salida'}</span></td>
                        <td className="col-p"><strong>{ins?.nombre || '(insumo)'}</strong></td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: esEntrada ? 'var(--green)' : 'var(--amber)' }}>
                          {esEntrada ? '+' : '−'}{Number(mv.cantidad || 0).toLocaleString('es-PE')} <span style={{ color: 'var(--tm)', fontSize: 10.5, fontWeight: 400 }}>{mv.unidad || ins?.unidad || ''}</span>
                        </td>
                        <td>{quien}</td>
                        <td style={{ fontSize: 11, color: 'var(--tm)' }}>{mv.observaciones || '—'}</td>
                        {(canDelete || superAdmin) && (
                          <td style={{ textAlign: 'center' }}>
                            <button className="btn btn-red btn-xs" title="Eliminar movimiento (ajusta stock)" onClick={() => eliminarMov(mv)}><JxIcon name="trash" size={11} /></button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* Modal nuevo/editar insumo */}
      {(modal === 'nuevo' || modal === 'editar') && (
        <Modal title={modal === 'editar' ? 'Editar insumo de emergencia' : 'Nuevo insumo de emergencia'} icon="package" onClose={() => { setModal(null); setForm({}); }}>
          <div className="g2">
            <div style={{ gridColumn: '1/-1' }}><label className="flabel">Nombre *</label>
              <input className="fi" value={form.nombre || ''} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Botiquín, extintor PQS 6kg, camilla…" /></div>
            <div><label className="flabel">Categoría</label>
              <input className="fi" value={form.categoria || ''} onChange={e => setForm({ ...form, categoria: e.target.value })} placeholder="Primeros auxilios, contra incendios…" /></div>
            <div><label className="flabel">Unidad *</label>
              <input className="fi" value={form.unidad || ''} onChange={e => setForm({ ...form, unidad: e.target.value })} placeholder="Und, caja, kit…" /></div>
            {modal === 'nuevo' && (
              <div><label className="flabel">Stock inicial</label>
                <input className="fi" type="number" min="0" step="0.01" value={form.stock_inicial || ''} onChange={e => setForm({ ...form, stock_inicial: e.target.value })} placeholder="0" /></div>
            )}
            <div><label className="flabel">Stock mínimo</label>
              <input className="fi" type="number" min="0" step="0.01" value={form.stock_minimo || ''} onChange={e => setForm({ ...form, stock_minimo: e.target.value })} placeholder="0" /></div>
            <div><label className="flabel">Vencimiento</label>
              <input className="fi" type="date" value={form.vencimiento || ''} onChange={e => setForm({ ...form, vencimiento: e.target.value })} /></div>
            <div style={{ gridColumn: '1/-1' }}><label className="flabel">Observaciones</label>
              <textarea className="fi" rows={2} value={form.observaciones || ''} onChange={e => setForm({ ...form, observaciones: e.target.value })} /></div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={() => { setModal(null); setForm({}); }} disabled={busy}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardarInsumo} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </Modal>
      )}

      {/* Modal movimiento */}
      {modal === 'mov' && (
        <Modal title={form.tipo_movimiento === 'entrada' ? 'Ingreso de insumo de emergencia' : 'Salida de insumo de emergencia'} icon={form.tipo_movimiento === 'entrada' ? 'arrowIn' : 'arrowOut'} onClose={() => { setModal(null); setForm({}); }}>
          <div className="g2">
            <div style={{ gridColumn: '1/-1' }}><label className="flabel">Insumo *</label>
              <select className="fi" value={form.insumo_emergencia_id || ''} onChange={e => setForm({ ...form, insumo_emergencia_id: e.target.value })}>
                <option value="">Selecciona…</option>
                {(insumos || []).filter(i => !i.deleted_at).map(i => <option key={i.id} value={i.id}>{i.nombre} · stock {Number(i.stock_actual ?? 0)} {i.unidad}</option>)}
              </select></div>
            <div><label className="flabel">Fecha</label>
              <input className="fi" type="date" value={form.fecha || ''} max={hoyISO()} onChange={e => setForm({ ...form, fecha: e.target.value })} /></div>
            <div><label className="flabel">Cantidad *</label>
              <input className="fi" type="number" min="0" step="0.01" value={form.cantidad || ''} onChange={e => setForm({ ...form, cantidad: e.target.value })} placeholder="0" /></div>
            <div><label className="flabel">{form.tipo_movimiento === 'entrada' ? 'Proveedor' : 'Entregado a / responsable'}</label>
              {form.tipo_movimiento === 'entrada'
                ? <select className="fi" value={form.proveedor_id || ''} onChange={e => setForm({ ...form, proveedor_id: e.target.value })}>
                    <option value="">—</option>
                    {(proveedores || []).filter(p => !p.deleted_at).map(p => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
                  </select>
                : <select className="fi" value={form.responsable_id || ''} onChange={e => setForm({ ...form, responsable_id: e.target.value })}>
                    <option value="">—</option>
                    {(personal || []).filter(p => !p.deleted_at).map(p => <option key={p.id} value={p.id}>{p.nombres} {p.apellidos || ''}</option>)}
                  </select>}
            </div>
            <div style={{ gridColumn: '1/-1' }}><label className="flabel">Observaciones</label>
              <textarea className="fi" rows={2} value={form.observaciones || ''} onChange={e => setForm({ ...form, observaciones: e.target.value })} /></div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={() => { setModal(null); setForm({}); }} disabled={busy}>Cancelar</button>
            <button className={`btn ${form.tipo_movimiento === 'entrada' ? 'btn-green' : 'btn-amber'}`} onClick={guardarMov} disabled={busy}>{busy ? 'Guardando…' : 'Registrar'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { InsumosEmergenciaPage });
