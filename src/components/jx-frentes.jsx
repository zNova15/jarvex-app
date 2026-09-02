import React from "react";
import { cubre, partidasDeFrente } from "../lib/frente-partidas.js";
import { hijosDirectos, cadenaBreadcrumb } from "../lib/partida-arbol.js";
const { useState: uS, useEffect: uE, useMemo: uM } = React;

// ¿Es el frente especial "Gastos Generales"? (insumos de oficina/generales).
const esGastosGenerales = (f) => !!(f && (f.es_gastos_generales || String(f.nombre || '').trim().toLowerCase() === 'gastos generales'));

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
  // Usuarios del sistema (profiles, sincronizados a Dexie) → "Ingeniero a cargo" (F2).
  const [usuarios, setUsuarios] = uS([]);
  uE(() => { window.__db.profiles.toArray().then(setUsuarios).catch(() => {}); }, []);
  const usuariosById = uM(() => { const m = new Map(); (usuarios || []).forEach(u => m.set(u.id, u)); return m; }, [usuarios]);
  const nombreUsuario = (id) => { const u = usuariosById.get(id); return u ? (`${u.nombres || ''} ${u.apellidos || ''}`.trim() || u.email || '—') : '—'; };
  const usuariosIngOpts = uM(() => (usuarios || []).filter(u => !u.deleted_at && u.activo !== false && ['ingeniero', 'ingeniero_residente'].includes(u.rol)).sort((a, b) => `${a.apellidos || ''} ${a.nombres || ''}`.localeCompare(`${b.apellidos || ''} ${b.nombres || ''}`)), [usuarios]);
  const { data: obras } = window.__hooks.useObras();
  const { data: partidas } = window.__hooks.usePartidas(obraId);
  const { data: frentePartidas, create: fpCreate, remove: fpRemove } = window.__hooks.useFrentePartidas(obraId);
  const obra = (obras || []).find(o => o.id === obraId);
  // F1: partidas cubiertas por cada frente (expande los nodos asignados).
  const coberturaPorFrente = uM(() => {
    const m = {};
    for (const f of (frentes || [])) m[f.id] = partidasDeFrente(f.id, { frentePartidas: frentePartidas || [], partidas: partidas || [] }).length;
    return m;
  }, [frentes, frentePartidas, partidas]);
  const personalById = uM(() => { const m = new Map(); (personal || []).forEach(p => m.set(p.id, p)); return m; }, [personal]);
  const nombrePers = (id) => { const p = personalById.get(id); return p ? `${p.nombres} ${p.apellidos || ''}`.trim() : '—'; };

  // Conteo de personal por frente
  const conteos = uM(() => {
    const m = {};
    for (const p of (personal || [])) { if (p.frente_id && !p.deleted_at) m[p.frente_id] = (m[p.frente_id] || 0) + 1; }
    return m;
  }, [personal]);

  const sorted = uM(() => [...(frentes || [])].sort((a, b) => {
    if (esGastosGenerales(a) !== esGastosGenerales(b)) return esGastosGenerales(a) ? 1 : -1;  // GG siempre al final
    if ((a.activo !== false) !== (b.activo !== false)) return a.activo === false ? 1 : -1;
    return Number(a.orden ?? 99) - Number(b.orden ?? 99) || (a.nombre || '').localeCompare(b.nombre || '');
  }), [frentes]);

  // El frente "Gastos Generales" lo crea la BD: la mig 101 lo sembró para las obras
  // existentes y un TRIGGER en `obras` (mig 105) lo crea para las nuevas — race-free.
  // (Se quitó el auto-ensure del cliente: corría en cada device antes de sincronizar
  //  el GG de la BD y generaba duplicados.)

  const [modal, setModal] = uS(null);
  const [editing, setEditing] = uS(null);
  const [form, setForm] = uS({ nombre: '', descripcion: '', ingeniero_user_id: '', orden: 0, activo: true });
  const [asignarFrente, setAsignarFrente] = uS(null);  // F1: frente cuyo árbol de partidas se edita
  const [foco, setFoco] = uS('');                       // nodo actual del árbol ('' = raíz)
  const asignadasDelFrente = uM(() => (frentePartidas || []).filter(fp => asignarFrente && fp.frente_id === asignarFrente.id && !fp.deleted_at), [frentePartidas, asignarFrente]);
  const codigosAsignados = uM(() => asignadasDelFrente.map(fp => String(fp.codigo_delfin).trim()), [asignadasDelFrente]);
  const nodos = uM(() => hijosDirectos(partidas || [], foco), [partidas, foco]);

  const openNueva = () => {
    const orden = ((frentes || []).reduce((m, f) => Math.max(m, Number(f.orden) || 0), 0) || 0) + 1;
    setEditing(null);
    setForm({ nombre: '', descripcion: '', ingeniero_user_id: '', orden, activo: true });
    setModal('form');
  };
  const openEditar = (f) => {
    setEditing(f);
    setForm({ nombre: f.nombre || '', descripcion: f.descripcion || '', ingeniero_user_id: f.ingeniero_user_id || '', orden: Number(f.orden) || 0, activo: f.activo !== false });
    setModal('form');
  };
  const openAsignar = (f) => { setAsignarFrente(f); setFoco(''); setModal('partidas'); };
  const toggleNodo = async (nodo) => {
    if (!canWrite || !asignarFrente) return;
    const C = String(nodo.code).trim();
    const directa = asignadasDelFrente.find(fp => String(fp.codigo_delfin).trim() === C);
    try {
      if (directa) await fpRemove(directa.id);
      else await fpCreate({ obra_id: obraId, frente_id: asignarFrente.id, codigo_delfin: C, partida_id: nodo.partida?.id || null, nivel: C.split('.').filter(Boolean).length });
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  const guardar = async () => {
    const nombre = (form.nombre || '').trim();
    if (!nombre) { showToast('Nombre requerido', 'red'); return; }
    if (!obraId) { showToast('No hay obra activa', 'red'); return; }
    const dup = (frentes || []).some(f => (f.nombre || '').trim().toLowerCase() === nombre.toLowerCase() && (!editing || f.id !== editing.id) && !f.deleted_at);
    if (dup) { showToast('Ya existe un frente con ese nombre', 'red'); return; }
    try {
      if (editing) {
        await update(editing.id, { nombre, descripcion: form.descripcion || null, ingeniero_user_id: form.ingeniero_user_id || null, orden: Number(form.orden) || 0, activo: !!form.activo });
        showToast('Frente actualizado', 'green');
      } else {
        await create({ obra_id: obraId, nombre, descripcion: form.descripcion || null, ingeniero_user_id: form.ingeniero_user_id || null, orden: Number(form.orden) || 0, activo: true });
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
                  const gg = esGastosGenerales(f);
                  return (
                    <tr key={f.id} style={{ opacity: inactivo ? 0.55 : 1, background: gg ? 'rgba(52,152,219,0.05)' : undefined }}>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{gg ? '—' : (f.orden ?? '—')}</td>
                      <td className="col-p"><strong>{f.nombre}</strong>{gg && <span className="badge b-blue" style={{ marginLeft: 6, fontSize: 9 }} title="Frente del sistema: insumos de oficina/generales">sistema</span>}</td>
                      <td style={{ fontSize: 11, color: 'var(--tm)' }}>{f.descripcion || (gg ? 'Insumos de oficina / generales (fuera de partidas)' : '—')}</td>
                      <td style={{ fontSize: 12 }}>{gg ? <span style={{ color: 'var(--tm)' }}>—</span> : (f.ingeniero_user_id ? nombreUsuario(f.ingeniero_user_id) : '—')}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{c || <span style={{ color: 'var(--tm)' }}>0</span>}</td>
                      <td><span className={`badge ${inactivo ? 'b-gray' : 'b-green'}`}>{inactivo ? 'Inactivo' : 'Activo'}</span></td>
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {gg ? (
                          <span style={{ fontSize: 11, color: 'var(--tm)' }} title="Frente del sistema. La almacenera asigna acá los insumos de oficina/generales que no entran en partidas. No se edita ni se borra.">Destino de insumos de oficina/generales</span>
                        ) : (<>
                          <button className="btn btn-ghost btn-xs" title="Partidas asignadas a este frente" onClick={() => openAsignar(f)} style={{ marginRight: 4 }}>Partidas · {coberturaPorFrente[f.id] || 0}</button>
                          {canWrite && (
                            <>
                              <button className="btn btn-ghost btn-xs" title="Editar" onClick={() => openEditar(f)}><JxIcon name="edit" size={11} /></button>
                              <button className={`btn btn-xs ${inactivo ? 'btn-amber' : 'btn-ghost'}`} title={inactivo ? 'Reactivar' : 'Desactivar'} onClick={() => toggleActivo(f)} style={{ marginLeft: 4 }}>{inactivo ? '↻' : '⏸'}</button>
                              <button className="btn btn-red btn-xs" title="Eliminar" onClick={() => eliminar(f)} style={{ marginLeft: 4 }}><JxIcon name="trash" size={11} /></button>
                            </>
                          )}
                        </>)}
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
              <select className="fi" value={form.ingeniero_user_id} onChange={e => setForm({ ...form, ingeniero_user_id: e.target.value })}>
                <option value="">— Sin asignar —</option>
                {usuariosIngOpts.map(u => <option key={u.id} value={u.id}>{nombreUsuario(u.id)}{u.email ? ` · ${u.email}` : ''}</option>)}
              </select>
              <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 3 }}>Usuario del sistema con rol ingeniero. Verá solo este frente al entrar.</div></div>
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

      {modal === 'partidas' && asignarFrente && (
        <Modal title={`Partidas · ${asignarFrente.nombre}`} icon="flag" onClose={() => { setModal(null); setAsignarFrente(null); }}>
          <div style={{ fontSize: 12, color: 'var(--tm)', marginBottom: 8 }}>
            Marcá capítulos, subcapítulos o ítems; los hijos se incluyen solos.{' '}
            <strong style={{ color: 'var(--tp)' }}>{coberturaPorFrente[asignarFrente.id] || 0} partidas cubiertas</strong>
            {asignarFrente.ingeniero_user_id ? <> · Ing. {nombreUsuario(asignarFrente.ingeniero_user_id)}</> : null}.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, fontSize: 12, marginBottom: 8, alignItems: 'center' }}>
            {cadenaBreadcrumb(foco).map((code, i) => (
              <span key={code || 'root'} style={{ display: 'inline-flex', alignItems: 'center' }}>
                {i > 0 && <span style={{ color: 'var(--tm)' }}>/</span>}
                <button className="btn btn-ghost btn-xs" onClick={() => setFoco(code)}>{code === '' ? 'Raíz' : code}</button>
              </span>
            ))}
          </div>
          <div style={{ maxHeight: 360, overflow: 'auto', display: 'grid', gap: 2 }}>
            {nodos.length === 0 && <div style={{ color: 'var(--tm)', fontSize: 12, fontStyle: 'italic', padding: 6 }}>Sin partidas en este nivel.</div>}
            {nodos.map(nodo => {
              const C = nodo.code;
              const directa = codigosAsignados.includes(C);
              const heredada = !directa && codigosAsignados.some(a => a !== C && cubre(a, C));
              const checked = directa || heredada;
              const nombre = nodo.partida?.nombre_partida || (nodo.esFolder ? '(capítulo)' : '');
              return (
                <div key={C} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 6, background: directa ? 'rgba(245,180,40,0.10)' : 'transparent' }}>
                  <input type="checkbox" checked={checked} disabled={heredada || !canWrite} onChange={() => toggleNodo(nodo)} title={heredada ? 'Cubierta por un nivel superior ya asignado' : ''} />
                  <span style={{ fontFamily: 'monospace', fontSize: 12, minWidth: 96 }}>{C}</span>
                  <span style={{ fontSize: 12, flex: 1 }}>{nombre}</span>
                  {heredada && <span className="badge b-gray" style={{ fontSize: 9 }}>heredada</span>}
                  {nodo.esFolder && <button className="btn btn-ghost btn-xs" onClick={() => setFoco(C)}>Abrir ▸</button>}
                </div>
              );
            })}
          </div>
          <div className="modal-actions">
            <button className="btn btn-amber" onClick={() => { setModal(null); setAsignarFrente(null); }}>Listo</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { FrentesPage });
