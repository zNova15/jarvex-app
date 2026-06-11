import React from "react";
import { SearchableSelect } from "./jx-searchable-select.jsx";
const { useState: uS, useMemo: uM, useEffect: uE } = React;

const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtSk = (n) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1e6) return 'S/ ' + (v/1e6).toFixed(2) + 'M';
  if (Math.abs(v) >= 1e3) return 'S/ ' + (v/1e3).toFixed(0) + 'K';
  return 'S/ ' + v.toFixed(0);
};

const SC_BADGE = {
  borrador:'b-gray', firmado:'b-blue', en_ejecucion:'b-amber',
  suspendido:'b-yellow', liquidado:'b-green', cancelado:'b-red',
};
const SC_LABEL = {
  borrador:'Borrador', firmado:'Firmado', en_ejecucion:'En ejecución',
  suspendido:'Suspendido', liquidado:'Liquidado', cancelado:'Cancelado',
};

function useObraActiva() {
  const [obraId, setObraId] = uS(null);
  uE(() => {
    let cancelled = false;
    let attempts = 0;
    const find = async () => {
      attempts++;
      const obras = await window.__db.obras.toArray();
      const stored = window.__getObraActivaId?.();
      const a = (stored && obras.find(o => o.id === stored && !o.deleted_at)) || obras.find(o => !o.deleted_at);
      if (a) { if (!cancelled) setObraId(a.id); return; }
      if (cancelled || attempts >= 10) return;
      setTimeout(find, 500);
    };
    find();
    return () => { cancelled = true; };
  }, []);
  return obraId;
}

// ╔═══ SUBCONTRATISTAS (catálogo) ════════════════════════════╗
function SubcontratistasPage({ showToast }) {
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id ?? 'offline';
  const myRol = auth?.profile?.rol;
  const isAdmin = myRol === 'admin';
  const canWrite = isAdmin || (window.__hasPerm?.(myRol, 'Subcontratistas', 'w') ?? false);
  const { data: subs } = window.__hooks.useSubcontratistas();
  // Cuadrilla: personal de la obra activa agrupado por subcontratista. Los
  // subcontratistas son globales pero el personal es por obra, así que la
  // cuadrilla que se ve es la de la obra activa.
  const obraId = useObraActiva();
  const { data: personal, update: updPersonal, create: crtPersonal } = window.__hooks.usePersonal(obraId);
  const { data: frentes } = window.__hooks.useFrentesObra(obraId);
  // Herramientas de la obra: para bloquear inhabilitar con préstamos pendientes
  // (misma regla de negocio que PersonalPage en jx-almacen).
  const { data: herramientasObra } = window.__hooks.useHerramientas(obraId);
  // Editar la CUADRILLA toca la tabla personal → permiso del módulo Personal.
  const canWritePersonal = isAdmin || (window.__hasPerm?.(myRol, 'Personal', 'w') ?? false);
  // Sin obra activa NO se edita la cuadrilla: usePersonal(null) lista personal de
  // TODAS las obras (cross-obra) y crear escribiría obra_id null — NOT NULL en el
  // server → push fallaría para siempre. Mientras useObraActiva() resuelve, solo lectura.
  const canEditCrew = canWritePersonal && !!obraId;
  const appModeSub = window.__useAppMode ? window.__useAppMode() : {};
  const frentesById = uM(() => new Map((frentes || []).map(f => [f.id, f.nombre])), [frentes]);

  const [modal, setModal] = uS(null);
  const [editing, setEditing] = uS(null);
  const [form, setForm] = uS({});
  const [busy, setBusy] = uS(false);
  const [crewOf, setCrewOf] = uS(null); // subcontratista cuya cuadrilla se ve
  const [nuevoMiembro, setNuevoMiembro] = uS(null); // null | { nombres, apellidos, dni, es_jefe } — mini-form
  const [miembroSel, setMiembroSel] = uS('');       // persona directa elegida para sumar a la cuadrilla
  const [crewBusy, setCrewBusy] = uS(false);

  // Historial individual (mismos tipos del CHECK de personal_historial:
  // alta/cargo/frente/estado/subcontrato/area — NO inventar otros).
  const logHistSub = async (tipo, antes, despues, personalId) => {
    if (String(antes ?? '') === String(despues ?? '')) return;
    try {
      const id = window.__newId(); const now = new Date().toISOString();
      const isPruebaH = !!appModeSub.isPrueba;
      await window.__db.personal_historial.add({
        id, personal_id: personalId, obra_id: obraId, fecha: now.slice(0, 10), tipo,
        valor_anterior: (antes != null && antes !== '') ? String(antes) : null,
        valor_nuevo: (despues != null && despues !== '') ? String(despues) : null,
        motivo: 'Gestión de cuadrilla (Subcontratistas)', created_by: userId, updated_by: userId, created_at: now, updated_at: now,
        version: 1, sync_status: isPruebaH ? 'synced' : 'pending_create', last_synced_at: null,
        idempotency_key: `${userId}_phist_${id}`, ...(isPruebaH ? { demo: true } : {}),
      });
    } catch (e) { console.warn('[cuadrilla historial]', e?.message); }
  };

  // ── Acciones de cuadrilla ──────────────────────────────────────────
  const agregarMiembro = async (personaId) => {
    if (crewBusy) return; // re-entrada durante el await = doble updPersonal + historial duplicado
    if (!obraId) return;  // sin obra activa, "personal" puede ser de otras obras
    const p = (personal || []).find(x => x.id === personaId);
    if (!p || !crewOf) return;
    setCrewBusy(true);
    try {
      const oldVals = { subcontratista_id: p.subcontratista_id, es_jefe_subcontrato: p.es_jefe_subcontrato, seguro_a_cargo: p.seguro_a_cargo };
      const newVals = { subcontratista_id: crewOf.id, es_jefe_subcontrato: false, seguro_a_cargo: p.seguro_a_cargo || crewOf.seguro_a_cargo || 'empresa' };
      await updPersonal(p.id, newVals);
      try { await window.__logAudit?.({ action:'update', table:'personal', recordId:p.id, oldData:oldVals, newData:newVals, reason:`Cuadrilla (Subcontratistas): agregado a ${crewOf.razon_social}` }); } catch {}
      await logHistSub('subcontrato', p.subcontratista_id ? '(otro subcontrato)' : 'Directo', crewOf.razon_social, p.id);
      showToast(`✓ ${p.nombres} ${p.apellidos} agregado a la cuadrilla`, 'green');
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
    finally { setCrewBusy(false); setMiembroSel(''); } // reset también en error — que no quede nadie "seleccionado" sin haber sido agregado
  };

  const toggleJefe = async (p) => {
    // Mismo aviso suave que PersonalPage: lo normal es 1-2 jefes por subcontrato.
    if (!p.es_jefe_subcontrato) {
      const jefes = (personal || []).filter(x =>
        x.subcontratista_id === p.subcontratista_id && x.es_jefe_subcontrato && !x.deleted_at && x.id !== p.id
      );
      if (jefes.length >= 2) {
        const ls = jefes.map(j => `· ${j.nombres} ${j.apellidos}`).join('\n');
        if (!confirm(`Este subcontrato ya tiene ${jefes.length} jefes:\n${ls}\n\n¿Agregar otro jefe de todas formas?`)) return;
      }
    }
    setCrewBusy(true);
    try {
      await updPersonal(p.id, { es_jefe_subcontrato: !p.es_jefe_subcontrato });
      try { await window.__logAudit?.({ action:'update', table:'personal', recordId:p.id, oldData:{ es_jefe_subcontrato: p.es_jefe_subcontrato }, newData:{ es_jefe_subcontrato: !p.es_jefe_subcontrato }, reason:'Cuadrilla (Subcontratistas): cambio de jefatura' }); } catch {}
      showToast(p.es_jefe_subcontrato ? `${p.nombres} ya no es jefe` : `★ ${p.nombres} ${p.apellidos} ahora es jefe de la cuadrilla`, 'green');
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
    finally { setCrewBusy(false); }
  };

  // Habilitar/inhabilitar = estado activo ↔ inactivo (cuando un miembro se va
  // de la cuadrilla o vuelve). El historial individual lo registra.
  const toggleHabilitado = async (p) => {
    const nuevo = p.estado === 'activo' ? 'inactivo' : 'activo';
    // Misma regla que PersonalPage: no se inhabilita a alguien con
    // herramientas sin devolver (es el último responsable y siguen en uso).
    if (nuevo === 'inactivo') {
      const herrPendientes = (herramientasObra || []).filter(h =>
        !h.deleted_at && h.ultimo_responsable_id === p.id && (h.disponible === false || h.ubicacion_actual === 'en_uso')
      );
      if (herrPendientes.length > 0) {
        const lista = herrPendientes.slice(0, 5).map(h => `· ${h.nombre_herramienta}`).join('\n');
        showToast(`No podés inhabilitar a ${p.nombres}: tiene ${herrPendientes.length} herramienta(s) sin devolver:\n${lista}`, 'red');
        return;
      }
    }
    setCrewBusy(true);
    try {
      const newVals = { estado: nuevo, ...(nuevo === 'inactivo' ? { es_jefe_subcontrato: false } : {}) };
      await updPersonal(p.id, newVals);
      try { await window.__logAudit?.({ action:'update', table:'personal', recordId:p.id, oldData:{ estado: p.estado, es_jefe_subcontrato: p.es_jefe_subcontrato }, newData:newVals, reason:`Cuadrilla (Subcontratistas): ${nuevo === 'activo' ? 'habilitado' : 'inhabilitado'}` }); } catch {}
      await logHistSub('estado', p.estado, nuevo, p.id);
      showToast(nuevo === 'activo' ? `✓ ${p.nombres} habilitado` : `${p.nombres} inhabilitado (inactivo)`, nuevo === 'activo' ? 'green' : 'amber');
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
    finally { setCrewBusy(false); }
  };

  const quitarDeCuadrilla = async (p) => {
    if (!confirm(`¿Quitar a ${p.nombres} ${p.apellidos} de la cuadrilla?\n\nVuelve como personal directo de la empresa (no se elimina ni pierde su historial).`)) return;
    setCrewBusy(true);
    try {
      const oldVals = { subcontratista_id: p.subcontratista_id, es_jefe_subcontrato: p.es_jefe_subcontrato, seguro_a_cargo: p.seguro_a_cargo };
      const newVals = { subcontratista_id: null, es_jefe_subcontrato: false, seguro_a_cargo: null };
      await updPersonal(p.id, newVals);
      try { await window.__logAudit?.({ action:'update', table:'personal', recordId:p.id, oldData:oldVals, newData:newVals, reason:`Cuadrilla (Subcontratistas): quitado de ${crewOf?.razon_social || '(subcontrato)'} — vuelve directo` }); } catch {}
      await logHistSub('subcontrato', crewOf?.razon_social || '(subcontrato)', 'Directo', p.id);
      showToast(`${p.nombres} ${p.apellidos} ahora es personal directo`, 'amber');
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
    finally { setCrewBusy(false); }
  };

  const crearMiembro = async () => {
    if (!obraId) { showToast('Esperá a que cargue la obra activa', 'red'); return; } // personal.obra_id es NOT NULL en el server
    const f = nuevoMiembro || {};
    const dni = String(f.dni || '').replace(/\D/g, '');
    if (!f.nombres?.trim() || !f.apellidos?.trim()) { showToast('Faltan nombres y apellidos', 'red'); return; }
    if (!/^\d{8}$/.test(dni)) { showToast('El DNI debe tener exactamente 8 dígitos', 'red'); return; }
    const dupe = (personal || []).find(x => x.dni === dni && !x.deleted_at);
    if (dupe) { showToast(`Ya existe un trabajador con DNI ${dni}: ${dupe.nombres} ${dupe.apellidos}${dupe.subcontratista_id ? '' : ' — agregalo desde el buscador de arriba'}`, 'red'); return; }
    // Mismo aviso suave que PersonalPage: lo normal es 1-2 jefes por subcontrato.
    if (f.es_jefe) {
      const jefes = (personal || []).filter(x =>
        x.subcontratista_id === crewOf.id && x.es_jefe_subcontrato && !x.deleted_at
      );
      if (jefes.length >= 2) {
        const ls = jefes.map(j => `· ${j.nombres} ${j.apellidos}`).join('\n');
        if (!confirm(`Este subcontrato ya tiene ${jefes.length} jefes:\n${ls}\n\n¿Agregar otro jefe de todas formas?`)) return;
      }
    }
    setCrewBusy(true);
    try {
      const created = await crtPersonal({
        obra_id: obraId, nombres: f.nombres.trim(), apellidos: f.apellidos.trim(), dni,
        tipo_documento: 'dni', cargo: f.es_jefe ? `Jefe Subcontrato ${crewOf.razon_social}`.slice(0, 60) : 'Obrero',
        estado: 'activo', fecha_ingreso: new Date().toISOString().slice(0, 10),
        subcontratista_id: crewOf.id, es_jefe_subcontrato: !!f.es_jefe,
        seguro_a_cargo: crewOf.seguro_a_cargo || 'empresa',
      });
      try { await window.__logAudit?.({ action:'insert', table:'personal', recordId:created?.id, newData:created, reason:`Cuadrilla (Subcontratistas): alta en ${crewOf.razon_social}` }); } catch {}
      await logHistSub('alta', null, `Cuadrilla ${crewOf.razon_social}${f.es_jefe ? ' · jefe' : ''}`, created?.id);
      showToast(`✓ ${f.nombres.trim()} ${f.apellidos.trim()} creado en la cuadrilla`, 'green');
      setNuevoMiembro(null);
    } catch (e) { showToast('Error: ' + (e.message?.includes('UNIQUE') ? 'Ya existe un trabajador con ese DNI' : e.message), 'red'); }
    finally { setCrewBusy(false); }
  };

  const sorted = uM(() => [...(subs||[])].sort((a,b) => (a.razon_social||'').localeCompare(b.razon_social||'')), [subs]);
  const crewBySub = uM(() => {
    const m = new Map();
    // Guard: usePersonal(null) devuelve personal de TODAS las obras (no []),
    // así que sin obra activa no agrupamos — evita cuadrillas cross-obra.
    if (!obraId) return m;
    for (const p of (personal || [])) {
      if (!p.subcontratista_id || p.deleted_at) continue;
      if (!m.has(p.subcontratista_id)) m.set(p.subcontratista_id, []);
      m.get(p.subcontratista_id).push(p);
    }
    return m;
  }, [personal, obraId]);

  const consultarRUC = async () => {
    const ruc = (form.ruc || '').trim();
    if (!/^\d{11}$/.test(ruc)) { showToast('RUC debe ser 11 dígitos', 'red'); return; }
    setBusy(true);
    try {
      const data = await window.__identity.consultarRUC(ruc);
      setForm(prev => ({
        ...prev,
        razon_social: prev.razon_social?.trim() || data.nombre || data.razonSocial || prev.razon_social,
        direccion: prev.direccion?.trim() || data.direccion || prev.direccion,
      }));
      showToast('SUNAT: ' + (data.nombre || 'datos cargados'), 'green');
    } catch (e) { showToast(e.message, 'red'); }
    finally { setBusy(false); }
  };

  const openNueva = () => {
    setForm({ razon_social:'', ruc:'', contacto:'', telefono:'', email:'', direccion:'', especialidad:'', estado:'activo', seguro_a_cargo:'empresa', notas:'' });
    setEditing(null);
    setModal(true);
  };

  const guardar = async () => {
    if (!form.razon_social?.trim()) { showToast('Razón social requerida', 'red'); return; }
    const now = new Date().toISOString();
    try {
      if (editing) {
        await window.__db.subcontratistas.update(editing.id, {
          ...form,
          updated_at: now, updated_by: userId,
          version: (editing.version ?? 0) + 1,
          sync_status: editing.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
      } else {
        const id = window.__newId();
        await window.__db.subcontratistas.add({
          id, ...form,
          ruc: form.ruc?.trim() || null,
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_sub_${id}`,
        });
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'subcontratistas' } })); } catch {}
      showToast(editing ? 'Subcontratista actualizado' : 'Subcontratista creado', 'green');
      setModal(null); setEditing(null);
    } catch (e) { showToast('Error: '+e.message, 'red'); }
  };

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Subcontratistas</div>
          <div className="pg-sub">{sorted.length} registrados</div>
        </div>
        {canWrite ? (
          <button className="btn btn-amber btn-sm" onClick={openNueva}><JxIcon name="plus" size={13}/>Nuevo</button>
        ) : (
          <span className="badge b-gray" title="Tu rol es solo lectura para Subcontratistas">Solo lectura</span>
        )}
      </div>

      {sorted.length === 0 ? (
        <div className="card card-p empty-state"><p>No hay subcontratistas.</p></div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <table className="tbl">
            <thead><tr>
              <th>Razón social</th><th>RUC</th><th>Especialidad</th><th>Estado</th><th>Seguro</th>
              <th style={{ textAlign:'center' }}>Cuadrilla</th>
              <th style={{ textAlign:'center' }}>Acciones</th>
            </tr></thead>
            <tbody>
              {sorted.map(s => {
                const crew = crewBySub.get(s.id) || [];
                const jefes = crew.filter(p => p.es_jefe_subcontrato).length;
                return (
                <tr key={s.id}>
                  <td className="col-p"><strong>{s.razon_social}</strong>{s.contacto ? <div style={{fontSize:11,color:'var(--tm)'}}>{s.contacto}{s.telefono?` · ${s.telefono}`:''}</div> : null}</td>
                  <td className="col-m">{s.ruc || '—'}</td>
                  <td>{s.especialidad || '—'}</td>
                  <td><span className={`badge ${s.estado==='activo'?'b-green':'b-gray'}`}>{s.estado}</span></td>
                  <td><span className={`badge ${s.seguro_a_cargo==='subcontrato'?'b-gray':'b-green'}`} title="Quién asume el seguro/SCTR del personal de este subcontrato">{s.seguro_a_cargo==='subcontrato'?'Subcontrato':'Empresa'}</span></td>
                  <td style={{ textAlign:'center' }}>
                    {crew.length > 0 ? (
                      <button className="btn btn-ghost btn-xs" onClick={()=>setCrewOf(s)} title="Ver / gestionar la cuadrilla (personal de la obra activa)">
                        {crew.length}{jefes>0 ? ` · ${jefes} jefe${jefes>1?'s':''}` : ''}
                      </button>
                    ) : (canEditCrew
                      ? <button className="btn btn-ghost btn-xs" onClick={()=>setCrewOf(s)} title="Armar la cuadrilla de este subcontrato">+ armar</button>
                      : <span style={{color:'var(--tm)',fontSize:12}}>—</span>)}
                  </td>
                  <td style={{ textAlign:'center' }}>
                    <button className="btn btn-ghost btn-xs" onClick={()=>{setForm({...s}); setEditing(s); setModal(true);}}><JxIcon name="edit" size={11}/></button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={editing ? 'Editar Subcontratista' : 'Nuevo Subcontratista'} icon="users" onClose={()=>{setModal(null); setEditing(null);}}>
          <div className="g2">
            <div><label className="flabel">RUC</label>
              <div style={{display:'flex', gap:6}}>
                <input className="fi" maxLength={11} value={form.ruc||''} onChange={e=>setForm({...form, ruc:e.target.value.replace(/\D/g,'').slice(0,11)})} style={{flex:1}}/>
                <button className="btn btn-blue btn-sm" disabled={busy || (form.ruc||'').length!==11} onClick={consultarRUC}>SUNAT</button>
              </div>
            </div>
            <div><label className="flabel">Estado</label>
              <select className="fi" value={form.estado||'activo'} onChange={e=>setForm({...form, estado:e.target.value})}>
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
                <option value="bloqueado">Bloqueado</option>
              </select>
            </div>
            <div style={{gridColumn:'1/-1'}}><label className="flabel">Razón social *</label><input className="fi" value={form.razon_social||''} onChange={e=>setForm({...form, razon_social:e.target.value})}/></div>
            <div><label className="flabel">Especialidad / tipo</label><input className="fi" value={form.especialidad||''} placeholder="Instalaciones eléctricas, mov. tierras…" onChange={e=>setForm({...form, especialidad:e.target.value})}/></div>
            <div><label className="flabel">Seguro / SCTR a cargo de</label>
              <select className="fi" value={form.seguro_a_cargo||'empresa'} onChange={e=>setForm({...form, seguro_a_cargo:e.target.value})} title="Default que se aplica al personal que agregues a este subcontrato">
                <option value="empresa">Empresa ejecutora</option>
                <option value="subcontrato">El subcontrato</option>
              </select>
            </div>
            <div><label className="flabel">Contacto</label><input className="fi" value={form.contacto||''} onChange={e=>setForm({...form, contacto:e.target.value})}/></div>
            <div><label className="flabel">Teléfono</label><input className="fi" value={form.telefono||''} onChange={e=>setForm({...form, telefono:e.target.value})}/></div>
            <div><label className="flabel">Email</label><input className="fi" value={form.email||''} onChange={e=>setForm({...form, email:e.target.value})}/></div>
            <div style={{gridColumn:'1/-1'}}><label className="flabel">Dirección</label><input className="fi" value={form.direccion||''} onChange={e=>setForm({...form, direccion:e.target.value})}/></div>
            <div style={{gridColumn:'1/-1'}}><label className="flabel">Notas / acuerdos</label>
              <textarea className="fi" rows={2} value={form.notas||''} onChange={e=>setForm({...form, notas:e.target.value})}
                placeholder="Acuerdos del trato: qué EPPs les damos y cuáles ponen ellos (ej. todo menos zapatos de seguridad), forma de pago al líder, etc."/>
              <div style={{fontSize:11,color:'var(--tm)',marginTop:3}}>Visible al entregar EPP a personal de este subcontrato.</div>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>{setModal(null); setEditing(null);}}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardar}><JxIcon name="check" size={13}/>{editing?'Guardar':'Crear'}</button>
          </div>
        </Modal>
      )}

      {crewOf && (() => {
        const crew = (crewBySub.get(crewOf.id) || []).slice().sort((a,b) =>
          (b.es_jefe_subcontrato?1:0) - (a.es_jefe_subcontrato?1:0) ||
          `${a.nombres} ${a.apellidos}`.localeCompare(`${b.nombres} ${b.apellidos}`));
        const activos = crew.filter(p => p.estado === 'activo').length;
        const jefes = crew.filter(p => p.es_jefe_subcontrato).length;
        const aseguraEmpresa = crew.filter(p => (p.seguro_a_cargo || 'empresa') === 'empresa').length;
        // Frentes en los que trabaja este subcontrato = derivados del personal de su cuadrilla.
        const frentesDelSub = [...new Set(crew.map(p => p.frente_id).filter(Boolean))].map(id => frentesById.get(id)).filter(Boolean);
        return (
          <Modal title={`Cuadrilla · ${crewOf.razon_social}`} icon="users" onClose={()=>{ setCrewOf(null); setNuevoMiembro(null); setMiembroSel(''); }}>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:12 }}>
              <span className="badge b-blue">{crew.length} trabajadores</span>
              <span className="badge b-green">{activos} activos</span>
              <span className="badge b-gray">{jefes} {jefes===1?'jefe':'jefes'}</span>
              <span className="badge b-green" title="Personal cuyo seguro/SCTR asume la empresa ejecutora">{aseguraEmpresa} asegura empresa</span>
            </div>
            {frentesDelSub.length > 0 && (
              <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:12, alignItems:'center' }}>
                <span style={{ fontSize:11.5, color:'var(--tm)' }}>Trabaja en:</span>
                {frentesDelSub.map(n => <span key={n} className="badge b-amber">{n}</span>)}
              </div>
            )}
            {canEditCrew && (
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'flex-end', marginBottom:12, padding:'10px 12px', background:'rgba(39,174,96,0.05)', border:'1px dashed rgba(39,174,96,0.35)', borderRadius:8 }}>
                <div style={{ flex:'1 1 240px' }}>
                  <label className="flabel">Agregar miembro existente (personal directo)</label>
                  <SearchableSelect value={miembroSel} disabled={crewBusy} onChange={v => { setMiembroSel(v); if (v) agregarMiembro(v); }}
                    options={[{ value:'', label:'— Buscar persona directa —' },
                      ...((personal || []).filter(p => !p.deleted_at && !p.subcontratista_id)
                        .sort((a,b)=>`${a.nombres} ${a.apellidos}`.localeCompare(`${b.nombres} ${b.apellidos}`))
                        .map(p => ({ value:p.id, label:`${p.nombres} ${p.apellidos}${p.alias?` «${p.alias}»`:''}${p.cargo?` (${p.cargo})`:''} · ${p.dni||'s/doc'}` })))]}
                    placeholder="— Buscar persona directa —"/>
                </div>
                <button className="btn btn-green btn-sm" disabled={crewBusy} onClick={()=>setNuevoMiembro(nuevoMiembro ? null : { nombres:'', apellidos:'', dni:'', es_jefe:false })}>
                  <JxIcon name="plus" size={12}/> Nuevo miembro
                </button>
              </div>
            )}
            {canEditCrew && nuevoMiembro && (
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'flex-end', marginBottom:12, padding:'10px 12px', background:'var(--bg-s)', borderRadius:8 }}>
                <div><label className="flabel">Nombres *</label><input className="fi" value={nuevoMiembro.nombres} onChange={e=>setNuevoMiembro({...nuevoMiembro, nombres:e.target.value})}/></div>
                <div><label className="flabel">Apellidos *</label><input className="fi" value={nuevoMiembro.apellidos} onChange={e=>setNuevoMiembro({...nuevoMiembro, apellidos:e.target.value})}/></div>
                <div><label className="flabel">DNI *</label><input className="fi" style={{width:110}} maxLength={8} inputMode="numeric" value={nuevoMiembro.dni} onChange={e=>setNuevoMiembro({...nuevoMiembro, dni:e.target.value.replace(/\D/g,'').slice(0,8)})}/></div>
                <label style={{ display:'flex', gap:6, alignItems:'center', fontSize:12, paddingBottom:8, cursor:'pointer' }}>
                  <input type="checkbox" checked={!!nuevoMiembro.es_jefe} onChange={e=>setNuevoMiembro({...nuevoMiembro, es_jefe:e.target.checked})}/> Es jefe
                </label>
                <button className="btn btn-amber btn-sm" disabled={crewBusy} onClick={crearMiembro}>{crewBusy ? '…' : 'Crear y agregar'}</button>
              </div>
            )}
            <div className="card" style={{ overflow:'hidden' }}>
              <table className="tbl">
                <thead><tr><th>Nombre</th><th>Cargo</th><th>Frente</th><th>Estado</th><th>Seguro</th>{canEditCrew && <th style={{textAlign:'center'}}>Acciones</th>}</tr></thead>
                <tbody>
                  {crew.length === 0 && (
                    <tr><td colSpan={canEditCrew ? 6 : 5} style={{ textAlign:'center', color:'var(--tm)', fontSize:12.5, padding:18 }}>
                      Cuadrilla vacía — agregá personal directo con el buscador o creá miembros nuevos.
                    </td></tr>
                  )}
                  {crew.map(p => (
                    <tr key={p.id} style={{ opacity: p.estado === 'activo' ? 1 : 0.55 }}>
                      <td className="col-p">{p.es_jefe_subcontrato && <span className="badge b-blue" style={{marginRight:6}}>Jefe</span>}{p.nombres} {p.apellidos}{p.alias ? <span style={{color:'var(--tm)',fontWeight:400}}> «{p.alias}»</span> : null}</td>
                      <td>{p.cargo || '—'}</td>
                      <td>{p.frente_id ? (frentesById.get(p.frente_id) || '—') : '—'}</td>
                      <td><span className={`badge ${p.estado==='activo'?'b-green':'b-gray'}`}>{p.estado}</span></td>
                      <td>{(p.seguro_a_cargo||'empresa')==='subcontrato' ? 'Subcontrato' : 'Empresa'}</td>
                      {canEditCrew && (
                        <td style={{ textAlign:'center', whiteSpace:'nowrap' }}>
                          <button className="btn btn-ghost btn-xs" disabled={crewBusy} title={p.es_jefe_subcontrato ? 'Quitar jefatura' : 'Hacer jefe de la cuadrilla'} onClick={()=>toggleJefe(p)}>
                            {p.es_jefe_subcontrato ? '★' : '☆'}
                          </button>
                          <button className="btn btn-ghost btn-xs" disabled={crewBusy} title={p.estado==='activo' ? 'Inhabilitar (se fue de la cuadrilla — queda inactivo, conserva historial)' : 'Habilitar (vuelve a estar activo)'} onClick={()=>toggleHabilitado(p)}>
                            {p.estado === 'activo' ? '⏸' : '▶'}
                          </button>
                          <button className="btn btn-ghost btn-xs" disabled={crewBusy} title="Quitar del subcontrato (vuelve como personal directo)" onClick={()=>quitarDeCuadrilla(p)} style={{ color:'var(--red)' }}>
                            ✕
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize:11, color:'var(--tm)', marginTop:10 }}>
              Cuadrilla de la obra activa. ★ = jefe (cobra por encargo y maneja su gente) · ⏸/▶ = inhabilitar cuando se van / habilitar cuando vuelven (conservan su historial, EPPs entregados y SCTR) · ✕ = pasa a personal directo. Los acuerdos del trato (EPPs que cubre la empresa, etc.) se anotan en «Notas / acuerdos» del subcontratista.
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}

// ╔═══ SUBCONTRATOS (contratos por obra) ═════════════════════╗
function SubcontratosPage({ showToast }) {
  const obraId = useObraActiva();
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id ?? 'offline';
  const myRol = auth?.profile?.rol;
  const isAdmin = myRol === 'admin';
  const canWrite = isAdmin || (window.__hasPerm?.(myRol, 'Subcontratos', 'w') ?? false);
  const { data: contratos } = window.__hooks.useSubcontratos(obraId);
  const { data: subs } = window.__hooks.useSubcontratistas();

  const [modal, setModal] = uS(null);
  const [editing, setEditing] = uS(null);
  const [form, setForm] = uS({});

  const sorted = uM(() => [...(contratos||[])].sort((a,b) => (b.fecha_inicio||'').localeCompare(a.fecha_inicio||'')), [contratos]);
  const lookupSub = (id) => subs?.find(s => s.id === id);

  const nextCodigo = uM(() => {
    const yr = new Date().getFullYear();
    const count = (contratos||[]).filter(c => (c.codigo||'').startsWith(`SC-${yr}`)).length + 1;
    return `SC-${yr}-${String(count).padStart(3,'0')}`;
  }, [contratos]);

  const openNueva = () => {
    if (!(subs||[]).filter(s=>s.estado==='activo').length) { showToast('Crea primero un subcontratista activo', 'red'); return; }
    setForm({
      codigo: nextCodigo,
      subcontratista_id: subs.find(s=>s.estado==='activo')?.id,
      alcance: '',
      fecha_inicio: new Date().toISOString().slice(0,10),
      fecha_fin: '',
      monto_contrato: '',
      moneda: 'PEN',
      retencion_pct: 5,
      detraccion_pct: 12,
      igv_pct: 18,
      estado: 'borrador',
      observaciones: '',
    });
    setEditing(null);
    setModal(true);
  };

  const guardar = async () => {
    const monto = parseFloat(form.monto_contrato);
    if (!Number.isFinite(monto) || monto <= 0) { showToast('Monto inválido', 'red'); return; }
    if (!form.alcance?.trim()) { showToast('Alcance requerido', 'red'); return; }
    const now = new Date().toISOString();
    try {
      const data = {
        ...form,
        monto_contrato: monto,
        retencion_pct: parseFloat(form.retencion_pct)||0,
        detraccion_pct: parseFloat(form.detraccion_pct)||12,
        igv_pct: parseFloat(form.igv_pct)||18,
        saldo_pendiente: monto - (Number(editing?.monto_valorizado || 0)),
      };
      if (editing) {
        await window.__db.subcontratos.update(editing.id, {
          ...data, updated_at: now, updated_by: userId,
          version: (editing.version ?? 0) + 1,
          sync_status: editing.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
      } else {
        const id = window.__newId();
        await window.__db.subcontratos.add({
          id, obra_id: obraId, ...data,
          monto_valorizado: 0, retencion_acumulada: 0,
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_sct_${id}`,
        });
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'subcontratos' } })); } catch {}
      showToast(editing?'Contrato actualizado':`Subcontrato ${form.codigo} creado por ${fmtS(monto)}`, 'green');
      setModal(null); setEditing(null);
    } catch (e) { showToast('Error: '+e.message, 'red'); }
  };

  const eliminar = async (c) => {
    if (!isAdmin) return;
    if (!confirm(`¿Eliminar ${c.codigo}?`)) return;
    try {
      await window.__db.subcontratos.update(c.id, {
        deleted_at: new Date().toISOString(),
        sync_status: c.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'subcontratos' } })); } catch {}
    } catch (e) {}
  };

  if (!obraId) return <div className="page-wrap"><div className="empty-state"><p>Selecciona una obra.</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Subcontratos</div>
          <div className="pg-sub">{sorted.length} contratos · valor total {fmtSk(sorted.reduce((s,c)=>s+Number(c.monto_contrato||0),0))}</div>
        </div>
        {canWrite ? (
          <button className="btn btn-amber btn-sm" onClick={openNueva}><JxIcon name="plus" size={13}/>Nuevo Contrato</button>
        ) : (
          <span className="badge b-gray" title="Tu rol es solo lectura para Subcontratos">Solo lectura</span>
        )}
      </div>

      {sorted.length === 0 ? (
        <div className="card card-p empty-state"><p>No hay subcontratos.</p></div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <table className="tbl">
            <thead><tr>
              <th>Código</th><th>Subcontratista</th><th>Alcance</th>
              <th>Inicio</th><th>Fin</th>
              <th style={{ textAlign:'right' }}>Contrato</th>
              <th style={{ textAlign:'right' }}>Valorizado</th>
              <th>Estado</th>
              <th style={{ textAlign:'center' }}>Acciones</th>
            </tr></thead>
            <tbody>
              {sorted.map(c => {
                const sub = lookupSub(c.subcontratista_id);
                return (
                  <tr key={c.id}>
                    <td className="col-m"><strong>{c.codigo}</strong></td>
                    <td className="col-p">{sub?.razon_social || '—'}</td>
                    <td style={{ fontSize:11.5, maxWidth:280 }}>{c.alcance}</td>
                    <td className="col-m">{c.fecha_inicio || '—'}</td>
                    <td className="col-m">{c.fecha_fin || '—'}</td>
                    <td style={{ textAlign:'right', fontWeight:700, color:'var(--blue)' }}>{fmtS(c.monto_contrato)}</td>
                    <td style={{ textAlign:'right', color:'var(--green)' }}>{fmtS(c.monto_valorizado || 0)}</td>
                    <td><span className={`badge ${SC_BADGE[c.estado]}`}>{SC_LABEL[c.estado]}</span></td>
                    <td style={{ textAlign:'center' }}>
                      <button className="btn btn-ghost btn-xs" onClick={()=>{setForm({...c}); setEditing(c); setModal(true);}}><JxIcon name="edit" size={11}/></button>
                      {isAdmin && <button className="btn btn-red btn-xs" onClick={()=>eliminar(c)} style={{marginLeft:4}}><JxIcon name="trash" size={11}/></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={editing ? `Subcontrato ${form.codigo}` : 'Nuevo Subcontrato'} icon="package" onClose={()=>{setModal(null); setEditing(null);}} wide>
          <div className="g2">
            <div><label className="flabel">Código</label><input className="fi" value={form.codigo||''} onChange={e=>setForm({...form, codigo:e.target.value})}/></div>
            <div><label className="flabel">Estado</label>
              <select className="fi" value={form.estado||'borrador'} onChange={e=>setForm({...form, estado:e.target.value})}>
                {Object.entries(SC_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div style={{gridColumn:'1/-1'}}><label className="flabel">Subcontratista *</label>
              <select className="fi" value={form.subcontratista_id||''} onChange={e=>setForm({...form, subcontratista_id:e.target.value})}>
                <option value="">—</option>
                {(subs||[]).filter(s=>s.estado==='activo').map(s => <option key={s.id} value={s.id}>{s.razon_social} {s.ruc?`(${s.ruc})`:''}</option>)}
              </select>
            </div>
            <div style={{gridColumn:'1/-1'}}><label className="flabel">Alcance del trabajo *</label><textarea className="fi" rows={3} value={form.alcance||''} onChange={e=>setForm({...form, alcance:e.target.value})} placeholder="Ej: Instalaciones eléctricas del edificio A — incluye tableros, cableado, luminarias, conexión a red"/></div>
            <div><label className="flabel">Fecha inicio</label><input className="fi" type="date" value={form.fecha_inicio||''} onChange={e=>setForm({...form, fecha_inicio:e.target.value})}/></div>
            <div><label className="flabel">Fecha fin</label><input className="fi" type="date" value={form.fecha_fin||''} onChange={e=>setForm({...form, fecha_fin:e.target.value})}/></div>
            <div><label className="flabel">Monto del contrato *</label><input className="fi" type="number" min="0" step="0.01" value={form.monto_contrato||''} onChange={e=>setForm({...form, monto_contrato:e.target.value})}/></div>
            <div><label className="flabel">Moneda</label>
              <select className="fi" value={form.moneda||'PEN'} onChange={e=>setForm({...form, moneda:e.target.value})}>
                <option value="PEN">S/</option><option value="USD">USD</option>
              </select>
            </div>
            <div><label className="flabel">Retención garantía %</label><input className="fi" type="number" step="0.1" value={form.retencion_pct||5} onChange={e=>setForm({...form, retencion_pct:e.target.value})}/></div>
            <div><label className="flabel">Detracción %</label><input className="fi" type="number" step="0.1" value={form.detraccion_pct||12} onChange={e=>setForm({...form, detraccion_pct:e.target.value})}/></div>
            <div><label className="flabel">Fianza fiel cumplimiento</label><input className="fi" type="number" step="0.01" value={form.fianza_fiel_cumplimiento||''} onChange={e=>setForm({...form, fianza_fiel_cumplimiento:e.target.value})}/></div>
            <div><label className="flabel">Fianza adelanto</label><input className="fi" type="number" step="0.01" value={form.fianza_adelanto||''} onChange={e=>setForm({...form, fianza_adelanto:e.target.value})}/></div>
            <div style={{gridColumn:'1/-1'}}><label className="flabel">Observaciones</label><textarea className="fi" rows={2} value={form.observaciones||''} onChange={e=>setForm({...form, observaciones:e.target.value})}/></div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>{setModal(null); setEditing(null);}}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardar}><JxIcon name="check" size={13}/>{editing?'Guardar':'Crear'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { SubcontratistasPage, SubcontratosPage });
