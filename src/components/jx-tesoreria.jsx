import React from "react";
const { useState: uS, useMemo: uM, useEffect: uE } = React;

const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtSk = (n) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1e6) return 'S/ ' + (v/1e6).toFixed(2) + 'M';
  if (Math.abs(v) >= 1e3) return 'S/ ' + (v/1e3).toFixed(0) + 'K';
  return 'S/ ' + v.toFixed(0);
};

const PAGO_BADGE = { programado:'b-amber', pagado:'b-green', vencido:'b-red', anulado:'b-gray' };
const PAGO_LABEL = { programado:'Programado', pagado:'Pagado', vencido:'Vencido', anulado:'Anulado' };

// Bancos típicos de Perú (sugerencias del datalist — texto libre permitido).
const BANCOS_PE = ['BCP', 'BBVA', 'Interbank', 'Scotiabank', 'Banco de la Nación', 'BanBif', 'Banco Pichincha', 'Mibanco', 'Caja Arequipa', 'Caja Huancayo', 'Caja Piura', 'Caja Trujillo'];

// ╔═══ CUENTAS BANCARIAS ═════════════════════════════════════════╗
function CuentasBancariasPage({ showToast }) {
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id ?? 'offline';
  const myRol = auth?.profile?.rol;
  const isAdmin = myRol === 'admin';
  const canWrite = isAdmin || (window.__hasPerm?.(myRol, 'Cuentas Bancarias', 'w') ?? false);
  const { data: cuentas } = window.__hooks.useCuentasBancarias();
  const { data: movs } = window.__hooks.useMovimientosBancarios();
  const { data: companies } = window.__hooks.useCompanies();

  // Pestañas: cuentas de las EMPRESAS (tesorería) vs cuentas del PERSONAL
  // (trabajadores — tabla propia, no entra al flujo de caja).
  const [tab, setTab] = uS('empresas'); // 'empresas' | 'personal'

  const [modal, setModal] = uS(null);
  const [editing, setEditing] = uS(null);
  const [form, setForm] = uS({});

  const lookupCo = (id) => companies?.find(c => c.id === id);

  // Saldo actual = saldo_inicial + suma(movimientos de la cuenta)
  const saldoPorCuenta = uM(() => {
    const map = new Map();
    (cuentas || []).forEach(c => map.set(c.id, Number(c.saldo_inicial || 0)));
    (movs || []).forEach(m => {
      const cur = map.get(m.cuenta_id) || 0;
      map.set(m.cuenta_id, cur + Number(m.monto || 0));
    });
    return map;
  }, [cuentas, movs]);

  const openNueva = () => {
    if (!(companies||[]).length) { showToast('Crea primero una empresa', 'red'); return; }
    setForm({
      company_id: companies[0].id,
      banco: '',
      numero_cuenta: '',
      cci: '',
      tipo: 'corriente',
      moneda: 'PEN',
      saldo_inicial: 0,
      estado: 'activa',
    });
    setEditing(null);
    setModal(true);
  };

  const openEditar = (c) => {
    setForm({ ...c });
    setEditing(c);
    setModal(true);
  };

  const guardar = async () => {
    if (!form.banco?.trim()) { showToast('Banco requerido', 'red'); return; }
    const now = new Date().toISOString();
    try {
      if (editing) {
        await window.__db.cuentas_bancarias.update(editing.id, {
          banco: form.banco.trim(), numero_cuenta: form.numero_cuenta || null,
          cci: form.cci || null, tipo: form.tipo, moneda: form.moneda,
          saldo_inicial: Number(form.saldo_inicial)||0, estado: form.estado,
          notas: form.notas || null,
          updated_at: now, updated_by: userId,
          version: (editing.version ?? 0) + 1,
          sync_status: editing.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
      } else {
        const id = window.__newId();
        await window.__db.cuentas_bancarias.add({
          id, company_id: form.company_id,
          banco: form.banco.trim(),
          numero_cuenta: form.numero_cuenta || null,
          cci: form.cci || null,
          tipo: form.tipo, moneda: form.moneda,
          saldo_inicial: Number(form.saldo_inicial)||0,
          estado: form.estado, notas: form.notas || null,
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_cb_${id}`,
        });
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'cuentas_bancarias' } })); } catch {}
      showToast(editing ? 'Cuenta actualizada' : 'Cuenta creada', 'green');
      setModal(null); setEditing(null);
    } catch (e) { showToast('Error: '+e.message, 'red'); }
  };

  const eliminar = async (c) => {
    if (!isAdmin) return;
    if (!confirm(`¿Cerrar la cuenta ${c.banco} ${c.numero_cuenta || ''}?`)) return;
    try {
      await window.__db.cuentas_bancarias.update(c.id, {
        deleted_at: new Date().toISOString(),
        sync_status: c.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'cuentas_bancarias' } })); } catch {}
      showToast('Cuenta cerrada', 'amber');
    } catch (e) { showToast('Error: '+e.message, 'red'); }
  };

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Cuentas Bancarias</div>
          <div className="pg-sub">{tab === 'empresas'
            ? `${(cuentas||[]).length} cuentas · saldo total ${fmtSk((cuentas||[]).reduce((s,c)=>s+(saldoPorCuenta.get(c.id)||0),0))}`
            : 'Cuentas de abono de los trabajadores (sueldo, CTS) — no entran al flujo de caja'}</div>
        </div>
        {tab === 'empresas' && (canWrite ? (
          <button className="btn btn-amber btn-sm" onClick={openNueva}>
            <JxIcon name="plus" size={13}/>Nueva Cuenta
          </button>
        ) : (
          <span className="badge b-gray" title="Tu rol es solo lectura para Cuentas Bancarias">Solo lectura</span>
        ))}
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:14 }}>
        <button className={`btn btn-sm ${tab==='empresas'?'btn-amber':'btn-ghost'}`} onClick={()=>setTab('empresas')}><JxIcon name="dollar" size={13}/>Empresas</button>
        <button className={`btn btn-sm ${tab==='personal'?'btn-amber':'btn-ghost'}`} onClick={()=>setTab('personal')}><JxIcon name="users" size={13}/>Personal (trabajadores)</button>
      </div>

      {tab === 'personal' ? (
        <CuentasPersonalSection showToast={showToast} />
      ) : (cuentas||[]).length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="dollar" size={40} color="var(--tm)"/>
          <p>No hay cuentas bancarias. Crea una para empezar a registrar movimientos y programar pagos.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <table className="tbl">
            <thead><tr>
              <th>Banco</th><th>Cuenta</th><th>Tipo</th><th>Moneda</th>
              <th>Empresa</th>
              <th style={{ textAlign:'right' }}>Saldo Inicial</th>
              <th style={{ textAlign:'right' }}>Saldo Actual</th>
              <th>Estado</th>
              {isAdmin && <th style={{ textAlign:'center' }}>Acciones</th>}
            </tr></thead>
            <tbody>
              {(cuentas||[]).map(c => {
                const saldo = saldoPorCuenta.get(c.id) || 0;
                return (
                  <tr key={c.id}>
                    <td className="col-p"><strong>{c.banco}</strong></td>
                    <td className="col-m">{c.numero_cuenta || '—'}{c.cci && <div style={{ fontSize:10, color:'var(--tm)' }}>CCI: {c.cci}</div>}</td>
                    <td><span className="tag">{c.tipo}</span></td>
                    <td className="col-m">{c.moneda}</td>
                    <td>{lookupCo(c.company_id)?.name || '—'}</td>
                    <td style={{ textAlign:'right' }} className="col-num">{fmtS(c.saldo_inicial)}</td>
                    <td style={{ textAlign:'right', fontWeight:700, color:saldo>=0?'var(--green)':'var(--red)' }} className="col-num">{fmtS(saldo)}</td>
                    <td><span className={`badge ${c.estado==='activa'?'b-green':'b-gray'}`}>{c.estado}</span></td>
                    {isAdmin && (
                      <td style={{ textAlign:'center' }}>
                        <button className="btn btn-ghost btn-xs" onClick={()=>openEditar(c)}><JxIcon name="edit" size={11}/></button>
                        <button className="btn btn-red btn-xs" onClick={()=>eliminar(c)} style={{ marginLeft:4 }}><JxIcon name="trash" size={11}/></button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={editing ? 'Editar Cuenta' : 'Nueva Cuenta Bancaria'} icon="dollar" onClose={()=>{setModal(null); setEditing(null);}}>
          <div className="g2">
            <div>
              <label className="flabel">Empresa *</label>
              <select className="fi" value={form.company_id||''} onChange={e=>setForm({...form, company_id:e.target.value})} disabled={!!editing}>
                {(companies||[]).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="flabel">Banco *</label>
              <input className="fi" value={form.banco||''} placeholder="Ej: BCP, BBVA, Interbank" onChange={e=>setForm({...form, banco:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Número de cuenta</label>
              <input className="fi" value={form.numero_cuenta||''} onChange={e=>setForm({...form, numero_cuenta:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">CCI</label>
              <input className="fi" value={form.cci||''} onChange={e=>setForm({...form, cci:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Tipo</label>
              <select className="fi" value={form.tipo||'corriente'} onChange={e=>setForm({...form, tipo:e.target.value})}>
                <option value="corriente">Corriente</option>
                <option value="ahorro">Ahorro</option>
                <option value="detracciones">Detracciones (BN)</option>
                <option value="plazo_fijo">Plazo fijo</option>
              </select>
            </div>
            <div>
              <label className="flabel">Moneda</label>
              <select className="fi" value={form.moneda||'PEN'} onChange={e=>setForm({...form, moneda:e.target.value})}>
                <option value="PEN">S/ (PEN)</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div>
              <label className="flabel">Saldo inicial</label>
              <input className="fi" type="number" step="0.01" value={form.saldo_inicial||0} onChange={e=>setForm({...form, saldo_inicial:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Estado</label>
              <select className="fi" value={form.estado||'activa'} onChange={e=>setForm({...form, estado:e.target.value})}>
                <option value="activa">Activa</option>
                <option value="inactiva">Inactiva</option>
                <option value="cerrada">Cerrada</option>
              </select>
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <label className="flabel">Notas</label>
              <textarea className="fi" rows={2} value={form.notas||''} onChange={e=>setForm({...form, notas:e.target.value})}/>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>{setModal(null); setEditing(null);}}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardar}><JxIcon name="check" size={13}/>{editing ? 'Guardar' : 'Crear'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ╔═══ CUENTAS BANCARIAS DEL PERSONAL (trabajadores) ═════════════╗
// Cuentas de abono de los trabajadores de la obra activa (sueldo, CTS),
// separadas por persona. Tabla personal_cuentas_bancarias — NO entra al
// flujo de caja (eso es de las cuentas de empresas).
function CuentasPersonalSection({ showToast }) {
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id ?? 'offline';
  const myRol = auth?.profile?.rol;
  const isAdmin = myRol === 'admin';
  // Las cuentas de trabajadores son dato de PERSONAL: las gestiona quien
  // gestiona personal (RRHH/asistente) o quien gestiona cuentas (tesorero).
  const canWrite = isAdmin
    || (window.__hasPerm?.(myRol, 'Cuentas Bancarias', 'w') ?? false)
    || (window.__hasPerm?.(myRol, 'Personal', 'w') ?? false);

  const { obraId } = window.__useObraActiva ? window.__useObraActiva() : { obraId: null };
  const { data: personal } = window.__hooks.usePersonal(obraId);
  const { data: cuentas, refresh } = window.__hooks.usePersonalCuentas(obraId);

  const [q, setQ] = uS('');
  const [modal, setModal] = uS(false);
  const [editing, setEditing] = uS(null);
  const [form, setForm] = uS({});
  const [busy, setBusy] = uS(false);

  const personalById = uM(() => { const m = new Map(); (personal||[]).forEach(p => m.set(p.id, p)); return m; }, [personal]);
  const nombreDe = (pid) => { const p = personalById.get(pid); return p ? `${p.nombres} ${p.apellidos}`.trim() : '(persona eliminada)'; };

  const filas = uM(() => {
    const ql = q.toLowerCase();
    let list = (cuentas || []).slice();
    if (ql) list = list.filter(c => `${nombreDe(c.personal_id)} ${personalById.get(c.personal_id)?.dni || ''} ${c.banco || ''} ${c.numero_cuenta || ''} ${c.cci || ''}`.toLowerCase().includes(ql));
    // Orden por persona, principal primero
    list.sort((a, b) => nombreDe(a.personal_id).localeCompare(nombreDe(b.personal_id)) || (b.principal ? 1 : 0) - (a.principal ? 1 : 0));
    return list;
  }, [cuentas, q, personalById]);

  const sinCuenta = uM(() => {
    const con = new Set((cuentas||[]).map(c => c.personal_id));
    return (personal||[]).filter(p => p.estado === 'activo' && !con.has(p.id)).length;
  }, [cuentas, personal]);

  const openNueva = (personalId = '') => {
    setForm({ personal_id: personalId, banco: '', tipo_cuenta: 'ahorros', numero_cuenta: '', cci: '', moneda: 'PEN', principal: true, observaciones: '' });
    setEditing(null); setModal(true);
  };
  const openEditar = (c) => { setForm({ ...c }); setEditing(c); setModal(true); };

  const guardar = async () => {
    if (busy) return;
    if (!form.personal_id) { showToast('Elegí al trabajador', 'red'); return; }
    if (!form.banco?.trim()) { showToast('Banco requerido', 'red'); return; }
    if (!(form.numero_cuenta || '').trim() && !(form.cci || '').trim()) { showToast('Ingresá el número de cuenta o el CCI', 'red'); return; }
    if ((form.cci || '').trim() && !/^\d{20}$/.test(form.cci.replace(/[\s-]/g, ''))) { showToast('El CCI debe tener exactamente 20 dígitos', 'red'); return; }
    setBusy(true);
    const now = new Date().toISOString();
    try {
      // Una sola cuenta PRINCIPAL por persona: si esta queda principal,
      // desmarcamos las otras de la misma persona.
      if (form.principal) {
        const otras = (cuentas || []).filter(c => c.personal_id === form.personal_id && c.principal && c.id !== editing?.id);
        for (const o of otras) {
          await window.__db.personal_cuentas_bancarias.update(o.id, {
            principal: false, updated_at: now, updated_by: userId,
            version: (o.version ?? 0) + 1,
            sync_status: o.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
          });
        }
      }
      const campos = {
        personal_id: form.personal_id,
        banco: form.banco.trim(),
        tipo_cuenta: form.tipo_cuenta || 'ahorros',
        numero_cuenta: (form.numero_cuenta || '').trim() || null,
        cci: (form.cci || '').replace(/[\s-]/g, '') || null,
        moneda: form.moneda || 'PEN',
        principal: !!form.principal,
        observaciones: (form.observaciones || '').trim() || null,
      };
      if (editing) {
        await window.__db.personal_cuentas_bancarias.update(editing.id, {
          ...campos, updated_at: now, updated_by: userId,
          version: (editing.version ?? 0) + 1,
          sync_status: editing.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
      } else {
        const id = window.__newId();
        await window.__db.personal_cuentas_bancarias.add({
          id, obra_id: obraId, ...campos,
          created_by: userId, updated_by: userId, created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_pcb_${id}`,
        });
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'personal_cuentas_bancarias' } })); } catch {}
      refresh?.();
      showToast(editing ? 'Cuenta actualizada' : 'Cuenta agregada', 'green');
      setModal(false); setEditing(null);
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };

  const eliminar = async (c) => {
    if (!isAdmin) return;
    if (!confirm(`¿Eliminar la cuenta ${c.banco} de ${nombreDe(c.personal_id)}?`)) return;
    try {
      await window.__db.personal_cuentas_bancarias.update(c.id, {
        deleted_at: new Date().toISOString(),
        sync_status: c.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'personal_cuentas_bancarias' } })); } catch {}
      refresh?.();
      showToast('Cuenta eliminada', 'amber');
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  if (!obraId) return <div className="card card-p empty-state"><JxIcon name="users" size={32} color="var(--tm)"/><p>Elegí una obra activa para ver las cuentas del personal.</p></div>;

  const TIPO_LBL = { ahorros: 'Ahorros', corriente: 'Corriente', cts: 'CTS', otra: 'Otra' };
  return (
    <>
      <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap', alignItems:'center' }}>
        <div className="search-bar"><JxIcon name="search" size={14} color="var(--tm)"/><input placeholder="Buscar trabajador, DNI o banco…" value={q} onChange={e=>setQ(e.target.value)}/></div>
        {sinCuenta > 0 && <span className="badge b-amber" title="Trabajadores activos sin ninguna cuenta registrada">{sinCuenta} sin cuenta</span>}
        {canWrite && <button className="btn btn-amber btn-sm" style={{ marginLeft:'auto' }} onClick={()=>openNueva()}><JxIcon name="plus" size={13}/>Agregar cuenta</button>}
      </div>

      {filas.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="dollar" size={40} color="var(--tm)"/>
          <p>No hay cuentas de trabajadores registradas{q ? ' que coincidan con la búsqueda' : ''}. {canWrite ? 'Agregalas acá o importalas con la plantilla "Personal" (Importar Datos).' : ''}</p>
        </div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <table className="tbl">
            <thead><tr>
              <th>Trabajador</th><th>DNI</th><th>Banco</th><th>Tipo</th>
              <th>N° Cuenta</th><th>CCI</th><th>Moneda</th><th>Principal</th><th>Sync</th>
              {canWrite && <th style={{ textAlign:'center' }}>Acciones</th>}
            </tr></thead>
            <tbody>
              {filas.map(c => {
                const p = personalById.get(c.personal_id);
                return (
                  <tr key={c.id}>
                    <td className="col-p"><strong>{nombreDe(c.personal_id)}</strong>{p?.cargo && <div style={{ fontSize:10, color:'var(--tm)' }}>{p.cargo}</div>}</td>
                    <td className="col-m">{p?.dni || '—'}</td>
                    <td><strong>{c.banco}</strong></td>
                    <td><span className="tag">{TIPO_LBL[c.tipo_cuenta] || c.tipo_cuenta || '—'}</span></td>
                    <td className="col-m">{c.numero_cuenta || '—'}</td>
                    <td className="col-m" style={{ fontSize:11 }}>{c.cci || '—'}</td>
                    <td className="col-m">{c.moneda || 'PEN'}</td>
                    <td>{c.principal ? <span className="badge b-green">★ Principal</span> : <span style={{ color:'var(--tm)', fontSize:11 }}>—</span>}</td>
                    <td>{c.sync_status && c.sync_status !== 'synced' ? <span className="badge b-amber">⏱</span> : <span style={{ color:'var(--green)', fontSize:11 }}>✓</span>}</td>
                    {canWrite && (
                      <td style={{ textAlign:'center', whiteSpace:'nowrap' }}>
                        <button className="btn btn-ghost btn-xs" title="Editar" onClick={()=>openEditar(c)}><JxIcon name="edit" size={11}/></button>
                        {isAdmin && <button className="btn btn-red btn-xs" title="Eliminar" onClick={()=>eliminar(c)} style={{ marginLeft:4 }}><JxIcon name="trash" size={11}/></button>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={editing ? `Editar cuenta · ${nombreDe(editing.personal_id)}` : 'Agregar cuenta de trabajador'} icon="dollar" onClose={()=>{setModal(false); setEditing(null);}}>
          <div className="g2">
            <div style={{ gridColumn:'1/-1' }}>
              <label className="flabel">Trabajador *</label>
              <SearchableSelect
                value={form.personal_id || ''}
                onChange={v => setForm(f => ({ ...f, personal_id: v }))}
                options={[{ value:'', label:'— Selecciona —' }, ...(personal||[]).filter(p=>!p.deleted_at).sort((a,b)=>`${a.apellidos} ${a.nombres}`.localeCompare(`${b.apellidos} ${b.nombres}`)).map(p => ({ value:p.id, label:`${p.nombres} ${p.apellidos} · ${p.dni || 's/DNI'}` }))]}
                placeholder="— Selecciona trabajador —"/>
            </div>
            <div>
              <label className="flabel">Banco *</label>
              <input className="fi" list="bancos-pe" value={form.banco||''} placeholder="Ej: BCP, Banco de la Nación" onChange={e=>setForm({...form, banco:e.target.value})}/>
              <datalist id="bancos-pe">{BANCOS_PE.map(b => <option key={b} value={b}/>)}</datalist>
            </div>
            <div>
              <label className="flabel">Tipo de cuenta</label>
              <select className="fi" value={form.tipo_cuenta||'ahorros'} onChange={e=>setForm({...form, tipo_cuenta:e.target.value})}>
                <option value="ahorros">Ahorros (sueldo)</option>
                <option value="corriente">Corriente</option>
                <option value="cts">CTS</option>
                <option value="otra">Otra</option>
              </select>
            </div>
            <div>
              <label className="flabel">Número de cuenta</label>
              <input className="fi" value={form.numero_cuenta||''} onChange={e=>setForm({...form, numero_cuenta:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">CCI (20 dígitos)</label>
              <input className="fi" value={form.cci||''} placeholder="002-…" onChange={e=>setForm({...form, cci:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Moneda</label>
              <select className="fi" value={form.moneda||'PEN'} onChange={e=>setForm({...form, moneda:e.target.value})}>
                <option value="PEN">S/ (PEN)</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div style={{ display:'flex', alignItems:'flex-end', paddingBottom:8 }}>
              <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12.5, cursor:'pointer' }}>
                <input type="checkbox" checked={!!form.principal} onChange={e=>setForm({...form, principal:e.target.checked})}/>
                <span>Cuenta principal (abono de sueldo)</span>
              </label>
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <label className="flabel">Observaciones</label>
              <textarea className="fi" rows={2} value={form.observaciones||''} onChange={e=>setForm({...form, observaciones:e.target.value})}/>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" disabled={busy} onClick={()=>{setModal(false); setEditing(null);}}>Cancelar</button>
            <button className="btn btn-amber" disabled={busy} onClick={guardar}><JxIcon name="check" size={13}/>{busy ? 'Guardando…' : (editing ? 'Guardar' : 'Agregar')}</button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ╔═══ CRONOGRAMA DE PAGOS / FLUJO DE CAJA ═══════════════════════╗
function FlujoCajaPage({ showToast }) {
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id ?? 'offline';
  const myRol = auth?.profile?.rol;
  const isAdmin = myRol === 'admin';
  const canWrite = isAdmin || (window.__hasPerm?.(myRol, 'Flujo de Caja', 'w') ?? false);
  const { data: pagos } = window.__hooks.useCronogramaPagos();
  const { data: companies } = window.__hooks.useCompanies();
  const { data: cuentas } = window.__hooks.useCuentasBancarias();

  const [modal, setModal] = uS(null);
  const [editing, setEditing] = uS(null);
  const [form, setForm] = uS({});
  const [filtroEstado, setFiltroEstado] = uS('todos');
  const [filtroCompany, setFiltroCompany] = uS('todas');

  const lookupCo = (id) => companies?.find(c => c.id === id);
  const lookupCu = (id) => cuentas?.find(c => c.id === id);

  // Auto-calcular vencidos
  uE(() => {
    if (!pagos) return;
    const hoy = new Date().toISOString().slice(0,10);
    pagos.filter(p => p.estado === 'programado' && p.fecha_programada < hoy).forEach(async p => {
      try {
        await window.__db.cronograma_pagos.update(p.id, {
          estado: 'vencido',
          updated_at: new Date().toISOString(),
          sync_status: p.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
      } catch {}
    });
  }, [pagos]);

  const filtered = uM(() => {
    let f = [...(pagos||[])];
    if (filtroEstado !== 'todos') f = f.filter(p => p.estado === filtroEstado);
    if (filtroCompany !== 'todas') f = f.filter(p => p.company_id === filtroCompany);
    return f.sort((a,b) => (a.fecha_programada||'').localeCompare(b.fecha_programada||''));
  }, [pagos, filtroEstado, filtroCompany]);

  // KPIs próximas 4 semanas
  const flujoProx = uM(() => {
    const hoy = new Date();
    const en4Semanas = new Date(hoy.getTime() + 28*86400000).toISOString().slice(0,10);
    const proximos = (pagos||[]).filter(p => p.estado === 'programado' && p.fecha_programada >= hoy.toISOString().slice(0,10) && p.fecha_programada <= en4Semanas);
    const vencidos = (pagos||[]).filter(p => p.estado === 'vencido');
    return {
      proximos: proximos.reduce((s,p) => s + Number(p.monto||0), 0),
      proximosCount: proximos.length,
      vencidos: vencidos.reduce((s,p) => s + Number(p.monto||0), 0),
      vencidosCount: vencidos.length,
    };
  }, [pagos]);

  const openNueva = () => {
    if (!(companies||[]).length) { showToast('Crea primero una empresa', 'red'); return; }
    setForm({
      company_id: companies[0].id,
      cuenta_id: '',
      fecha_programada: new Date().toISOString().slice(0,10),
      monto: '',
      moneda: 'PEN',
      beneficiario: '',
      concepto: '',
      documento_ref: '',
      estado: 'programado',
    });
    setEditing(null);
    setModal(true);
  };

  const openEditar = (p) => {
    setForm({ ...p });
    setEditing(p);
    setModal(true);
  };

  const guardar = async () => {
    const monto = parseFloat(form.monto);
    if (!Number.isFinite(monto) || monto <= 0) { showToast('Monto inválido', 'red'); return; }
    const now = new Date().toISOString();
    try {
      if (editing) {
        await window.__db.cronograma_pagos.update(editing.id, {
          ...form, monto,
          updated_at: now, updated_by: userId,
          version: (editing.version ?? 0) + 1,
          sync_status: editing.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
      } else {
        const id = window.__newId();
        await window.__db.cronograma_pagos.add({
          id, ...form, monto,
          cuenta_id: form.cuenta_id || null,
          accounting_movement_id: null, movimiento_bancario_id: null,
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_cp_${id}`,
        });
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'cronograma_pagos' } })); } catch {}
      showToast(editing ? 'Pago actualizado' : 'Pago programado', 'green');
      setModal(null); setEditing(null);
    } catch (e) { showToast('Error: '+e.message, 'red'); }
  };

  const marcarPagado = async (p) => {
    if (!p.cuenta_id) { showToast('Asigna primero una cuenta de origen', 'red'); return; }
    if (!confirm(`¿Confirmar pago de ${fmtS(p.monto)} a ${p.beneficiario || 'beneficiario'}?\n\nSe registrará un retiro en la cuenta y se enlazará al movimiento contable.`)) return;
    const now = new Date().toISOString();
    try {
      const movId = window.__newId();
      await window.__db.movimientos_bancarios.add({
        id: movId,
        cuenta_id: p.cuenta_id,
        fecha: new Date().toISOString().slice(0,10),
        tipo: 'retiro',
        monto: -Math.abs(Number(p.monto)),
        descripcion: `Pago: ${p.concepto || 'Pago programado'} a ${p.beneficiario || ''}`,
        contraparte: p.beneficiario,
        referencia: p.documento_ref || null,
        accounting_movement_id: p.accounting_movement_id || null,
        created_by: userId, updated_by: userId,
        created_at: now, updated_at: now,
        version: 1, sync_status: 'pending_create', last_synced_at: null,
        idempotency_key: `${userId}_mb_${movId}`,
      });
      await window.__db.cronograma_pagos.update(p.id, {
        estado: 'pagado',
        fecha_pago_real: now.slice(0,10),
        movimiento_bancario_id: movId,
        updated_at: now, updated_by: userId,
        version: (p.version ?? 0) + 1,
        sync_status: p.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      // Si está vinculado a un acc_mov, marcar pagado
      if (p.accounting_movement_id) {
        const am = await window.__db.accounting_movements.get(p.accounting_movement_id);
        if (am) {
          await window.__db.accounting_movements.update(am.id, {
            payment_status: 'paid',
            updated_at: now, updated_by: userId,
            version: (am.version ?? 0) + 1,
            sync_status: am.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
          });
        }
      }
      try {
        window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'cronograma_pagos' } }));
        window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'movimientos_bancarios' } }));
        window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'accounting_movements' } }));
      } catch {}
      showToast(`Pago registrado: ${fmtS(p.monto)}`, 'green');
    } catch (e) { showToast('Error: '+e.message, 'red'); }
  };

  const eliminar = async (p) => {
    if (!isAdmin) return;
    if (!confirm('¿Eliminar este pago programado?')) return;
    try {
      await window.__db.cronograma_pagos.update(p.id, {
        deleted_at: new Date().toISOString(),
        sync_status: p.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'cronograma_pagos' } })); } catch {}
    } catch (e) { showToast('Error: '+e.message, 'red'); }
  };

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Flujo de Caja / Cronograma de Pagos</div>
          <div className="pg-sub">{filtered.length} de {(pagos||[]).length} pagos</div>
        </div>
        {canWrite ? (
          <button className="btn btn-amber btn-sm" onClick={openNueva}>
            <JxIcon name="plus" size={13}/>Programar Pago
          </button>
        ) : (
          <span className="badge b-gray" title="Tu rol es solo lectura para Flujo de Caja">Solo lectura</span>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px,1fr))', gap:12, marginBottom:14 }}>
        <div className="card card-p" style={{ borderLeft:'3px solid var(--amber)' }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Próximas 4 semanas</div>
          <div style={{ fontSize:22, fontWeight:800, color:'var(--amber)' }}>{fmtSk(flujoProx.proximos)}</div>
          <div style={{ fontSize:11, color:'var(--tm)' }}>{flujoProx.proximosCount} pagos</div>
        </div>
        <div className="card card-p" style={{ borderLeft:'3px solid var(--red)' }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Vencidos</div>
          <div style={{ fontSize:22, fontWeight:800, color:'var(--red)' }}>{fmtSk(flujoProx.vencidos)}</div>
          <div style={{ fontSize:11, color:'var(--tm)' }}>{flujoProx.vencidosCount} pagos</div>
        </div>
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:14 }}>
        <select className="fi" value={filtroCompany} onChange={e=>setFiltroCompany(e.target.value)} style={{ minWidth:160 }}>
          <option value="todas">Todas las empresas</option>
          {(companies||[]).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="fi" value={filtroEstado} onChange={e=>setFiltroEstado(e.target.value)} style={{ minWidth:140 }}>
          <option value="todos">Todos</option>
          {Object.entries(PAGO_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="calendar" size={40} color="var(--tm)"/>
          <p>Sin pagos programados.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <table className="tbl">
            <thead><tr>
              <th>Fecha</th><th>Empresa</th><th>Beneficiario</th>
              <th>Concepto</th><th>Doc.</th><th>Cuenta</th>
              <th style={{ textAlign:'right' }}>Monto</th><th>Estado</th>
              <th style={{ textAlign:'center' }}>Acciones</th>
            </tr></thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id}>
                  <td className="col-m">{p.fecha_programada}</td>
                  <td>{lookupCo(p.company_id)?.name || '—'}</td>
                  <td className="col-p">{p.beneficiario || '—'}</td>
                  <td style={{ fontSize:11.5 }}>{p.concepto || '—'}</td>
                  <td className="col-m" style={{ fontSize:11 }}>{p.documento_ref || '—'}</td>
                  <td className="col-m" style={{ fontSize:11 }}>{lookupCu(p.cuenta_id)?.banco || '—'}</td>
                  <td style={{ textAlign:'right', fontWeight:700, color:'var(--blue)' }} className="col-num">{fmtS(p.monto)}</td>
                  <td><span className={`badge ${PAGO_BADGE[p.estado]}`}>{PAGO_LABEL[p.estado]}</span></td>
                  <td style={{ textAlign:'center', whiteSpace:'nowrap' }}>
                    {p.estado !== 'pagado' && p.estado !== 'anulado' && (
                      <button className="btn btn-amber btn-xs" title="Marcar como pagado" onClick={()=>marcarPagado(p)}>
                        <JxIcon name="check" size={11}/>$
                      </button>
                    )}
                    <button className="btn btn-ghost btn-xs" title="Editar" onClick={()=>openEditar(p)} style={{ marginLeft:4 }}>
                      <JxIcon name="edit" size={11}/>
                    </button>
                    {isAdmin && (
                      <button className="btn btn-red btn-xs" title="Eliminar" onClick={()=>eliminar(p)} style={{ marginLeft:4 }}>
                        <JxIcon name="trash" size={11}/>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={editing ? 'Editar Pago Programado' : 'Programar Pago'} icon="dollar" onClose={()=>{setModal(null); setEditing(null);}}>
          <div className="g2">
            <div>
              <label className="flabel">Empresa *</label>
              <select className="fi" value={form.company_id||''} onChange={e=>setForm({...form, company_id:e.target.value})}>
                {(companies||[]).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="flabel">Cuenta de origen</label>
              <select className="fi" value={form.cuenta_id||''} onChange={e=>setForm({...form, cuenta_id:e.target.value})}>
                <option value="">— elegir al pagar —</option>
                {(cuentas||[]).filter(c => c.company_id === form.company_id && c.estado === 'activa').map(c => (
                  <option key={c.id} value={c.id}>{c.banco} {c.numero_cuenta || ''} ({c.moneda})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="flabel">Fecha programada *</label>
              <input className="fi" type="date" value={form.fecha_programada||''} onChange={e=>setForm({...form, fecha_programada:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Monto *</label>
              <input className="fi" type="number" min="0" step="0.01" value={form.monto||''} onChange={e=>setForm({...form, monto:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Moneda</label>
              <select className="fi" value={form.moneda||'PEN'} onChange={e=>setForm({...form, moneda:e.target.value})}>
                <option value="PEN">S/</option><option value="USD">USD</option>
              </select>
            </div>
            <div>
              <label className="flabel">Beneficiario</label>
              <input className="fi" value={form.beneficiario||''} onChange={e=>setForm({...form, beneficiario:e.target.value})} placeholder="Proveedor / acreedor"/>
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <label className="flabel">Concepto</label>
              <input className="fi" value={form.concepto||''} onChange={e=>setForm({...form, concepto:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Documento ref.</label>
              <input className="fi" value={form.documento_ref||''} onChange={e=>setForm({...form, documento_ref:e.target.value})} placeholder="Nº factura"/>
            </div>
            <div>
              <label className="flabel">Estado</label>
              <select className="fi" value={form.estado||'programado'} onChange={e=>setForm({...form, estado:e.target.value})}>
                {Object.entries(PAGO_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>{setModal(null); setEditing(null);}}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardar}><JxIcon name="check" size={13}/>{editing?'Guardar':'Programar'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { CuentasBancariasPage, FlujoCajaPage });
