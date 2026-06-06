import React from "react";
const { useState: uS, useEffect: uE, useMemo: uM } = React;

// Catálogo de FRENTES DE TRABAJO por obra (zonas/sub-obras: Captación, Línea de
// Conducción, Alcantarillado, etc.). El personal se asigna a un frente; los
// frentes de un subcontrato se derivan de los frentes de su personal.
function FrentesPage({ showToast }) {
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

  const { data: frentes, loading, create, update, remove, refresh } = window.__hooks.useFrentesObra(obraId);
  const { data: personal } = window.__hooks.usePersonal(obraId);
  const { data: obras } = window.__hooks.useObras();
  const obra = (obras || []).find(o => o.id === obraId);
  const personalById = uM(() => { const m = new Map(); (personal || []).forEach(p => m.set(p.id, p)); return m; }, [personal]);
  const nombrePers = (id) => { const p = personalById.get(id); return p ? `${p.nombres} ${p.apellidos || ''}`.trim() : '—'; };

  // Conteo de personal por frente
  const conteos = uM(() => {
    const m = {};
    for (const p of (personal || [])) { if (p.frente_id && !p.deleted_at) m[p.frente_id] = (m[p.frente_id] || 0) + 1; }
    return m;
  }, [personal]);

  const sorted = uM(() => [...(frentes || [])].sort((a, b) => {
    if ((a.activo !== false) !== (b.activo !== false)) return a.activo === false ? 1 : -1;
    return Number(a.orden ?? 99) - Number(b.orden ?? 99) || (a.nombre || '').localeCompare(b.nombre || '');
  }), [frentes]);

  const [modal, setModal] = uS(null);
  const [editing, setEditing] = uS(null);
  const [form, setForm] = uS({ nombre: '', descripcion: '', ingeniero_id: '', orden: 0, activo: true });

  const openNueva = () => {
    const orden = ((frentes || []).reduce((m, f) => Math.max(m, Number(f.orden) || 0), 0) || 0) + 1;
    setEditing(null);
    setForm({ nombre: '', descripcion: '', ingeniero_id: '', orden, activo: true });
    setModal('form');
  };
  const openEditar = (f) => {
    setEditing(f);
    setForm({ nombre: f.nombre || '', descripcion: f.descripcion || '', ingeniero_id: f.ingeniero_id || '', orden: Number(f.orden) || 0, activo: f.activo !== false });
    setModal('form');
  };

  const guardar = async () => {
    const nombre = (form.nombre || '').trim();
    if (!nombre) { showToast('Nombre requerido', 'red'); return; }
    if (!obraId) { showToast('No hay obra activa', 'red'); return; }
    const dup = (frentes || []).some(f => (f.nombre || '').trim().toLowerCase() === nombre.toLowerCase() && (!editing || f.id !== editing.id) && !f.deleted_at);
    if (dup) { showToast('Ya existe un frente con ese nombre', 'red'); return; }
    try {
      if (editing) {
        await update(editing.id, { nombre, descripcion: form.descripcion || null, ingeniero_id: form.ingeniero_id || null, orden: Number(form.orden) || 0, activo: !!form.activo });
        showToast('Frente actualizado', 'green');
      } else {
        await create({ obra_id: obraId, nombre, descripcion: form.descripcion || null, ingeniero_id: form.ingeniero_id || null, orden: Number(form.orden) || 0, activo: true });
        showToast(`Frente "${nombre}" creado`, 'green');
      }
      setModal(null); setEditing(null);
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  const toggleActivo = async (f) => {
    if (!canWrite) return;
    try { await update(f.id, { activo: f.activo === false }); showToast(f.activo === false ? 'Frente reactivado' : 'Frente desactivado', 'amber'); }
    catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };
  const eliminar = async (f) => {
    if (!canWrite) return;
    const c = conteos[f.id] || 0;
    if (c > 0 && f.activo !== false) { showToast(`Tiene ${c} trabajador${c > 1 ? 'es' : ''} asignado${c > 1 ? 's' : ''}. Desactívalo primero.`, 'red'); return; }
    if (!confirm(c > 0 ? `Este frente tiene ${c} trabajador(es) histórico(s). ¿Eliminarlo del catálogo activo?` : `¿Eliminar el frente "${f.nombre}"?`)) return;
    try { await remove(f.id); showToast('Frente eliminado', 'green'); }
    catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };
  const sembrar = async () => {
    if (!canWrite || !obraId) return;
    if (!confirm('¿Sembrar frentes típicos de saneamiento (Captación, Línea de Conducción, Reservorio, Línea de Distribución, Redes de Agua, Alcantarillado, UBS)?')) return;
    try {
      const mod = await import('../lib/seed-frentes.js');
      const creados = await mod.seedFrentesPorDefecto(obraId, userId);
      if (!creados.length) showToast('Ya hay frentes en esta obra.', 'amber');
      else { showToast(`${creados.length} frentes creados`, 'green'); refresh?.(); }
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  // Ingenieros sugeridos para "a cargo" (cargo contiene 'ingenier'), pero permite cualquiera.
  const personalOpts = uM(() => (personal || []).filter(p => !p.deleted_at).sort((a, b) =>
    `${a.apellidos} ${a.nombres}`.localeCompare(`${b.apellidos} ${b.nombres}`)), [personal]);

  if (!obraId) return (
    <div className="page-wrap"><div className="card card-p empty-state"><JxIcon name="flag" size={32} color="var(--tm)" /><p>Selecciona una obra activa para gestionar sus frentes de trabajo.</p></div></div>
  );

  const activos = (frentes || []).filter(f => f.activo !== false).length;
  const total = (frentes || []).length;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Frentes de Trabajo</div>
          <div className="pg-sub">{obra ? <strong>{obra.nombre_obra}</strong> : '—'} · {total} frentes · {activos} activos</div>
        </div>
        {canWrite && <button className="btn btn-amber btn-sm" onClick={openNueva}><JxIcon name="plus" size={13} />Nuevo Frente</button>}
      </div>

      {loading ? (
        <div className="card card-p empty-state"><JxIcon name="flag" size={32} color="var(--tm)" /><p>Cargando…</p></div>
      ) : total === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="flag" size={40} color="var(--tm)" />
          <p>No hay frentes de trabajo en esta obra.</p>
          {canWrite && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="btn btn-amber btn-sm" onClick={sembrar}><JxIcon name="plus" size={12} />Sembrar típicos</button>
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
                <th>Frente</th>
                <th>Descripción</th>
                <th>Ingeniero a cargo</th>
                <th style={{ textAlign: 'right' }}># personal</th>
                <th>Estado</th>
                <th style={{ textAlign: 'center' }}>Acciones</th>
              </tr></thead>
              <tbody>
                {sorted.map(f => {
                  const c = conteos[f.id] || 0;
                  const inactivo = f.activo === false;
                  return (
                    <tr key={f.id} style={{ opacity: inactivo ? 0.55 : 1 }}>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{f.orden ?? '—'}</td>
                      <td className="col-p"><strong>{f.nombre}</strong></td>
                      <td style={{ fontSize: 11, color: 'var(--tm)' }}>{f.descripcion || '—'}</td>
                      <td style={{ fontSize: 12 }}>{f.ingeniero_id ? nombrePers(f.ingeniero_id) : '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{c || <span style={{ color: 'var(--tm)' }}>0</span>}</td>
                      <td><span className={`badge ${inactivo ? 'b-gray' : 'b-green'}`}>{inactivo ? 'Inactivo' : 'Activo'}</span></td>
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {canWrite && (
                          <>
                            <button className="btn btn-ghost btn-xs" title="Editar" onClick={() => openEditar(f)}><JxIcon name="edit" size={11} /></button>
                            <button className={`btn btn-xs ${inactivo ? 'btn-amber' : 'btn-ghost'}`} title={inactivo ? 'Reactivar' : 'Desactivar'} onClick={() => toggleActivo(f)} style={{ marginLeft: 4 }}>{inactivo ? '↻' : '⏸'}</button>
                            <button className="btn btn-red btn-xs" title="Eliminar" onClick={() => eliminar(f)} style={{ marginLeft: 4 }}><JxIcon name="trash" size={11} /></button>
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
        <Modal title={editing ? 'Editar Frente' : 'Nuevo Frente'} icon="flag" onClose={() => { setModal(null); setEditing(null); }}>
          <div className="g2">
            <div style={{ gridColumn: '1/-1' }}><label className="flabel">Nombre *</label>
              <input className="fi" placeholder="Alcantarillado, Captación, Línea de Conducción…" value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} /></div>
            <div style={{ gridColumn: '1/-1' }}><label className="flabel">Descripción</label>
              <input className="fi" placeholder="Detalle opcional" value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })} /></div>
            <div style={{ gridColumn: '1/-1' }}><label className="flabel">Ingeniero a cargo</label>
              <select className="fi" value={form.ingeniero_id} onChange={e => setForm({ ...form, ingeniero_id: e.target.value })}>
                <option value="">— Sin asignar —</option>
                {personalOpts.map(p => <option key={p.id} value={p.id}>{p.nombres} {p.apellidos || ''}{p.cargo ? ` · ${p.cargo}` : ''}</option>)}
              </select></div>
            <div><label className="flabel">Orden</label>
              <input className="fi" type="number" value={form.orden} onChange={e => setForm({ ...form, orden: e.target.value })} /></div>
            {editing && (
              <div><label className="flabel">Estado</label>
                <select className="fi" value={form.activo ? '1' : '0'} onChange={e => setForm({ ...form, activo: e.target.value === '1' })}>
                  <option value="1">Activo</option><option value="0">Inactivo</option>
                </select></div>
            )}
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => { setModal(null); setEditing(null); }}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardar}><JxIcon name="check" size={13} />{editing ? 'Guardar' : 'Crear'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { FrentesPage });
