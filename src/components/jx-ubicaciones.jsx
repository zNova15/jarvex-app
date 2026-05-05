import React from "react";
const { useState: uS, useEffect: uE, useMemo: uM } = React;

// Página de gestión del catálogo de ubicaciones de almacenaje por obra.
// Aplica a materiales, herramientas y equipos pesados.
function UbicacionesPage({ showToast }) {
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id ?? 'offline';
  const rol = auth?.profile?.rol;
  const canWrite = rol === 'admin' || rol === 'gerente' || rol === 'ingeniero_residente';

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
    window.addEventListener('jarvex_master_updated', onChange);
    window.addEventListener('obra_activa_change', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('jarvex_master_updated', onChange);
      window.removeEventListener('obra_activa_change', onChange);
    };
  }, []);

  const { data: ubicaciones, loading, create, update, remove, refresh } = window.__hooks.useUbicacionesObra(obraId);
  const { data: obras } = window.__hooks.useObras();
  const obra = (obras || []).find(o => o.id === obraId);

  const [conteos, setConteos] = uS({}); // { ubicacion_id: { mat, her, act, total } }
  uE(() => {
    if (!obraId || !ubicaciones?.length) { setConteos({}); return; }
    let cancelled = false;
    (async () => {
      const out = {};
      for (const u of ubicaciones) {
        try {
          const [mat, her, act] = await Promise.all([
            window.__db.materiales.where('ubicacion_id').equals(u.id).filter(r => !r.deleted_at).count(),
            window.__db.herramientas.where('ubicacion_id').equals(u.id).filter(r => !r.deleted_at).count(),
            window.__db.activos_pesados.where('ubicacion_id').equals(u.id).filter(r => !r.deleted_at).count(),
          ]);
          out[u.id] = { mat, her, act, total: mat + her + act };
        } catch { out[u.id] = { mat: 0, her: 0, act: 0, total: 0 }; }
      }
      if (!cancelled) setConteos(out);
    })();
    return () => { cancelled = true; };
  }, [obraId, ubicaciones]);

  const sorted = uM(() => {
    return [...(ubicaciones || [])].sort((a, b) => {
      if ((a.activo !== false) !== (b.activo !== false)) return a.activo === false ? 1 : -1;
      return Number(a.orden ?? 99) - Number(b.orden ?? 99) || (a.nombre || '').localeCompare(b.nombre || '');
    });
  }, [ubicaciones]);

  const [modal, setModal] = uS(null);
  const [editing, setEditing] = uS(null);
  const [form, setForm] = uS({ nombre: '', descripcion: '', orden: 0, activo: true });

  const openNueva = () => {
    const orden = ((ubicaciones || []).reduce((m, u) => Math.max(m, Number(u.orden) || 0), 0) || 0) + 1;
    setEditing(null);
    setForm({ nombre: '', descripcion: '', orden, activo: true });
    setModal('form');
  };

  const openEditar = (u) => {
    setEditing(u);
    setForm({
      nombre: u.nombre || '',
      descripcion: u.descripcion || '',
      orden: Number(u.orden) || 0,
      activo: u.activo !== false,
    });
    setModal('form');
  };

  const guardar = async () => {
    const nombre = (form.nombre || '').trim();
    if (!nombre) { showToast('Nombre requerido', 'red'); return; }
    if (!obraId) { showToast('No hay obra activa', 'red'); return; }
    const dup = (ubicaciones || []).some(u =>
      (u.nombre || '').trim().toLowerCase() === nombre.toLowerCase() &&
      (!editing || u.id !== editing.id) && !u.deleted_at
    );
    if (dup) { showToast('Ya existe una ubicación con ese nombre', 'red'); return; }

    try {
      if (editing) {
        await update(editing.id, {
          nombre,
          descripcion: form.descripcion || null,
          orden: Number(form.orden) || 0,
          activo: !!form.activo,
        });
        try { await window.__logAudit?.({ action: 'update', table: 'ubicaciones_obra', recordId: editing.id, oldData: editing, newData: { nombre, descripcion: form.descripcion, orden: form.orden, activo: form.activo } }); } catch {}
        showToast('Ubicación actualizada', 'green');
      } else {
        const created = await create({
          obra_id: obraId,
          nombre,
          descripcion: form.descripcion || null,
          orden: Number(form.orden) || 0,
          activo: true,
        });
        try { await window.__logAudit?.({ action: 'insert', table: 'ubicaciones_obra', recordId: created?.id, newData: created }); } catch {}
        showToast(`Ubicación "${nombre}" creada`, 'green');
      }
      setModal(null); setEditing(null);
    } catch (e) {
      showToast('Error: ' + (e.message || e), 'red');
    }
  };

  const toggleActivo = async (u) => {
    if (!canWrite) return;
    try {
      await update(u.id, { activo: u.activo === false });
      showToast(u.activo === false ? 'Ubicación reactivada' : 'Ubicación desactivada', 'amber');
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  const eliminar = async (u) => {
    if (!canWrite) return;
    const c = conteos[u.id]?.total || 0;
    if (c > 0 && u.activo !== false) {
      showToast(`Tiene ${c} item${c > 1 ? 's' : ''} asignado${c > 1 ? 's' : ''}. Desactívala primero.`, 'red');
      return;
    }
    const msg = c > 0
      ? `Esta ubicación tiene ${c} item${c > 1 ? 's' : ''} históricos. Se quitará del catálogo activo pero los items la siguen mostrando como "(inactiva)". ¿Continuar?`
      : `¿Eliminar la ubicación "${u.nombre}"?`;
    if (!confirm(msg)) return;
    try {
      await remove(u.id);
      try { await window.__logAudit?.({ action: 'delete', table: 'ubicaciones_obra', recordId: u.id, oldData: u }); } catch {}
      showToast('Ubicación eliminada', 'green');
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  const sembrar = async () => {
    if (!canWrite || !obraId) return;
    if (!confirm('¿Sembrar las 4 ubicaciones por defecto (Almacén Central, Patio, Frente de Obra, Externo)?')) return;
    try {
      const mod = await import('../lib/seed-ubicaciones.js');
      const creados = await mod.seedUbicacionesPorDefecto(obraId, userId);
      if (creados.length === 0) {
        showToast('Ya hay ubicaciones en esta obra. Nada que sembrar.', 'amber');
      } else {
        showToast(`${creados.length} ubicaciones creadas`, 'green');
        refresh?.();
      }
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  if (!obraId) {
    return (
      <div className="page-wrap">
        <div className="card card-p empty-state">
          <JxIcon name="map" size={32} color="var(--tm)" />
          <p>Selecciona una obra activa para gestionar sus ubicaciones de almacenaje.</p>
        </div>
      </div>
    );
  }

  const activos = (ubicaciones || []).filter(u => u.activo !== false).length;
  const total = (ubicaciones || []).length;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Ubicaciones de Obra</div>
          <div className="pg-sub">
            {obra ? <strong>{obra.nombre_obra}</strong> : '—'} · {total} ubicaciones · {activos} activas
          </div>
        </div>
        {canWrite && (
          <button className="btn btn-amber btn-sm" onClick={openNueva}>
            <JxIcon name="plus" size={13} />Nueva Ubicación
          </button>
        )}
      </div>

      {loading ? (
        <div className="card card-p empty-state"><JxIcon name="map" size={32} color="var(--tm)" /><p>Cargando…</p></div>
      ) : total === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="map" size={40} color="var(--tm)" />
          <p>No hay ubicaciones en esta obra.</p>
          {canWrite && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="btn btn-amber btn-sm" onClick={sembrar}>
                <JxIcon name="plus" size={12} />Sembrar 4 por defecto
              </button>
              <button className="btn btn-ghost btn-sm" onClick={openNueva}>Crear manual</button>
            </div>
          )}
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th style={{ width: 60, textAlign: 'right' }}>Orden</th>
                <th>Nombre</th>
                <th>Descripción</th>
                <th style={{ textAlign: 'right' }}># items</th>
                <th>Estado</th>
                <th style={{ textAlign: 'center' }}>Acciones</th>
              </tr></thead>
              <tbody>
                {sorted.map(u => {
                  const c = conteos[u.id] || { mat: 0, her: 0, act: 0, total: 0 };
                  const inactiva = u.activo === false;
                  return (
                    <tr key={u.id} style={{ opacity: inactiva ? 0.55 : 1 }}>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{u.orden ?? '—'}</td>
                      <td className="col-p"><strong>{u.nombre}</strong></td>
                      <td style={{ fontSize: 11, color: 'var(--tm)' }}>{u.descripcion || '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        {c.total > 0
                          ? <span title={`${c.mat} mat · ${c.her} herr · ${c.act} act`} style={{ fontWeight: 600 }}>{c.total}</span>
                          : <span style={{ color: 'var(--tm)' }}>0</span>}
                      </td>
                      <td><span className={`badge ${inactiva ? 'b-gray' : 'b-green'}`}>{inactiva ? 'Inactiva' : 'Activa'}</span></td>
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {canWrite && (
                          <>
                            <button className="btn btn-ghost btn-xs" title="Editar" onClick={() => openEditar(u)}>
                              <JxIcon name="edit" size={11} />
                            </button>
                            <button
                              className={`btn btn-xs ${inactiva ? 'btn-amber' : 'btn-ghost'}`}
                              title={inactiva ? 'Reactivar' : 'Desactivar'}
                              onClick={() => toggleActivo(u)}
                              style={{ marginLeft: 4 }}
                            >
                              {inactiva ? '↻' : '⏸'}
                            </button>
                            <button
                              className="btn btn-red btn-xs"
                              title="Eliminar"
                              onClick={() => eliminar(u)}
                              style={{ marginLeft: 4 }}
                            >
                              <JxIcon name="trash" size={11} />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal === 'form' && (
        <Modal
          title={editing ? 'Editar Ubicación' : 'Nueva Ubicación'}
          icon="map"
          onClose={() => { setModal(null); setEditing(null); }}
        >
          <div className="g2">
            <div style={{ gridColumn: '1/-1' }}>
              <label className="flabel">Nombre *</label>
              <input
                className="fi"
                placeholder="Patio, Bóveda, Almacén Central…"
                value={form.nombre}
                onChange={e => setForm({ ...form, nombre: e.target.value })}
              />
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <label className="flabel">Descripción</label>
              <input
                className="fi"
                placeholder="Detalle opcional"
                value={form.descripcion}
                onChange={e => setForm({ ...form, descripcion: e.target.value })}
              />
            </div>
            <div>
              <label className="flabel">Orden</label>
              <input
                className="fi"
                type="number"
                value={form.orden}
                onChange={e => setForm({ ...form, orden: e.target.value })}
              />
            </div>
            {editing && (
              <div>
                <label className="flabel">Estado</label>
                <select
                  className="fi"
                  value={form.activo ? '1' : '0'}
                  onChange={e => setForm({ ...form, activo: e.target.value === '1' })}
                >
                  <option value="1">Activa</option>
                  <option value="0">Inactiva</option>
                </select>
              </div>
            )}
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => { setModal(null); setEditing(null); }}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardar}>
              <JxIcon name="check" size={13} />{editing ? 'Guardar' : 'Crear'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { UbicacionesPage });
