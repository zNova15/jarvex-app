import React from "react";
import { filtroInicialEmpresa } from "../lib/empresa-activa.js";
import { useEmpresaBloqueada } from "../hooks/useEmpresaActiva.js";
import {
  nombreCuenta, saldoCorrido, cuadreDeCuenta, totales, agruparPorEntidad,
  pendientesDeJarvex, sugerirCruces, parsearExtracto,
} from "../lib/bancos.js";
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

  // ÁMBITO por empresa activa (Gabriel, 4-sep-2026): desde el panel de una
  // empresa se llega acá a AGREGAR su cuenta. Sin esto la lista mostraba las
  // de todo el grupo y "Nueva Cuenta" arrancaba en companies[0] — con dos
  // clicks de distracción la cuenta quedaba a nombre de otra empresa.
  const empresaFija = useEmpresaBloqueada();
  const cuentasVisibles = uM(
    () => (cuentas || []).filter(c => !empresaFija || c.company_id === empresaFija),
    [cuentas, empresaFija]);

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
      company_id: (empresaFija && companies.some(c => c.id === empresaFija))
        ? empresaFija : companies[0].id,
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
            ? `${cuentasVisibles.length} cuenta(s) · saldo total ${fmtSk(cuentasVisibles.reduce((s,c)=>s+(saldoPorCuenta.get(c.id)||0),0))}`
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

      {tab === 'empresas' && window.EmpresaActivaBanner ? <window.EmpresaActivaBanner/> : null}

      {tab === 'personal' ? (
        <CuentasPersonalSection showToast={showToast} />
      ) : cuentasVisibles.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="dollar" size={40} color="var(--tm)"/>
          <p>{empresaFija
            ? 'Esta empresa todavía no tiene cuentas bancarias. Creá la primera con “Nueva Cuenta” — queda a su nombre.'
            : 'No hay cuentas bancarias. Crea una para empezar a registrar movimientos y programar pagos.'}</p>
          {canWrite && (
            <button className="btn btn-amber btn-sm" onClick={openNueva} style={{ marginTop:10 }}>
              <JxIcon name="plus" size={13}/>Nueva Cuenta
            </button>
          )}
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
              {cuentasVisibles.map(c => {
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
              <select className="fi" value={form.company_id||''} onChange={e=>setForm({...form, company_id:e.target.value})}
                disabled={!!editing || !!empresaFija}
                title={empresaFija ? 'Estás dentro de esta empresa: la cuenta se crea a su nombre.' : undefined}>
                {(empresaFija && !editing ? (companies||[]).filter(c => c.id === empresaFija) : (companies||[]))
                  .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
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
  const [filtroCompanyRaw, setFiltroCompany] = uS(() => filtroInicialEmpresa('todas'));
  // ÁMBITO, no filtro: con una empresa activa esta pantalla es la contabilidad
  // de ESA empresa y el selector va clavado (Gabriel: «netamente y
  // exclusivamente de esa empresa seleccionada»).
  const empresaFija = useEmpresaBloqueada();
  const filtroCompany = empresaFija || filtroCompanyRaw;

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
      {window.EmpresaActivaBanner ? <window.EmpresaActivaBanner/> : null}

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
        <select className="fi" value={filtroCompany} onChange={e=>setFiltroCompany(e.target.value)} style={{ minWidth:160 }}
          disabled={!!empresaFija}
          title={empresaFija ? 'Estás dentro de la contabilidad de esta empresa: son SUS cuentas y pagos.' : undefined}>
          {!empresaFija && <option value="todas">Todas las empresas</option>}
          {(companies||[]).filter(c => !empresaFija || c.id === empresaFija).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
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


// ╔═══ MOVIMIENTOS BANCARIOS POR ENTIDAD ═════════════════════════════╗
//
// Gabriel, 7-sep-2026: «los movimientos bancarios por empresa y entidad (para
// obras sería movimiento bancario de las cuentas de consorcio EL INCA)».
//
// La tabla `movimientos_bancarios` existía desde la mig 024 y NUNCA tuvo
// pantalla: 0 filas en producción. Mientras tanto la plata sí estaba anotada
// en otro lado —13 constancias bancarias en `pagos_partes`, S/ 181.281 entre
// abril y agosto—, pero nadie podía ver una cuenta y decir «esto es lo que
// tiene y esto es lo que se movió».
//
// LOS DOS EJES, que son el pedido literal:
//   · TITULAR — una company. Y acá está lo que hace que la obra funcione sin
//     inventar nada: CONSORCIO EL INCA es una company con tipo_entidad
//     'consorcio'. Dentro de una obra el titular no se elige: es su ejecutora
//     (`obras.ejecutora_company_id`), clavado, como el resto del workspace.
//   · ENTIDAD BANCARIA — normalizada (src/lib/bancos.js), para que «BCP» y
//     «Banco de Crédito» no salgan como dos bancos en el resumen.
//
// LOS DOS LADOS, que es la decisión de fondo: el extracto del banco entra por
// un lado (`origen='extracto'`), lo registrado al trabajar por el otro
// (constancias de pago y depósitos de bancarización), y la pestaña de
// conciliación dice cuál es cuál. El que confirma es el tesorero: la app
// propone con puntaje, no cuadra sola.
function MovimientosBancariosPage({ showToast }) {
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id ?? 'offline';
  const myRol = auth?.profile?.rol;
  const isAdmin = myRol === 'admin';
  const canWrite = isAdmin || (window.__hasPerm?.(myRol, 'Cuentas Bancarias', 'w') ?? false);

  const { data: cuentas } = window.__hooks.useCuentasBancarias();
  const { data: movs } = window.__hooks.useMovimientosBancarios();
  const { data: companies } = window.__hooks.useCompanies();
  const { data: obras } = window.__hooks.useObras();

  const { obraId } = window.__useObraActiva ? window.__useObraActiva() : { obraId: null };
  const empresaFija = useEmpresaBloqueada();

  // ── EL TITULAR ────────────────────────────────────────────────────
  // Dentro de una obra manda la obra: el titular es su ejecutora y el selector
  // queda clavado. Es la misma regla del resto del workspace — no se elige
  // empresa a mano adentro de un trabajo.
  //
  // 🔴 `obraId` viene de localStorage y sobrevive al F5 aunque ya no estés
  // parado en ningún trabajo (mismo corte que hace `useEmpresaBloqueada`
  // consigo misma). Sin el `window.__plano === 'obra'`, entrar al bloque de
  // una empresa con una obra activa vieja en el storage volvía a clavar el
  // titular en la ejecutora de esa obra — Gabriel, 9-sep-2026: entró a la
  // contabilidad de una empresa y Movimientos Bancarios le mostraba
  // "Consorcio el Inca" bloqueado, sin poder ver las cuentas de la empresa
  // que había elegido.
  const enObraTes = window.__plano === 'obra';
  const obraActiva = uM(() => (enObraTes ? (obras || []).find(o => o.id === obraId) || null : null), [enObraTes, obras, obraId]);
  const titularForzado = obraActiva?.ejecutora_company_id || empresaFija || null;

  const [titularSel, setTitularSel] = uS('');
  const [cuentaSel, setCuentaSel] = uS('todas');
  const [tab, setTab] = uS('movimientos');   // movimientos | conciliacion | entidades
  const [desde, setDesde] = uS('');
  const [hasta, setHasta] = uS('');
  const [q, setQ] = uS('');

  // Sin contexto y sin elección del usuario, arrancamos en el primer titular
  // que TENGA cuentas: abrir en "— entidad titular —" con la tabla vacía
  // parece que la pantalla no funciona. Se DERIVA en el render y no en un
  // efecto a propósito — con efecto, el primer pintado salía vacío y el
  // contenido aparecía de golpe un frame después.
  const primerConCuenta = uM(
    () => (cuentas || []).find(c => c.company_id)?.company_id || '',
    [cuentas]);
  const titular = titularForzado || titularSel || primerConCuenta;

  // Cambiar de titular resetea la cuenta: la de antes es de otra empresa.
  uE(() => { setCuentaSel('todas'); }, [titular]);

  const companyById = uM(() => new Map((companies || []).map(c => [c.id, c])), [companies]);
  const empresaTitular = companyById.get(titular) || null;

  const cuentasDelTitular = uM(
    () => (cuentas || []).filter(c => c.company_id === titular),
    [cuentas, titular]);

  const cuentasEnVista = uM(
    () => cuentaSel === 'todas' ? cuentasDelTitular : cuentasDelTitular.filter(c => c.id === cuentaSel),
    [cuentasDelTitular, cuentaSel]);

  const idsEnVista = uM(() => new Set(cuentasEnVista.map(c => c.id)), [cuentasEnVista]);

  // ── EL LADO DE JARVEX (constancias y depósitos) ────────────────────
  // Se leen de Dexie a mano y no por hook: son dos tablas que solo esta
  // pantalla cruza, y meterlas en el bundle global de hooks las bajaría en
  // todos los roles (el almacenero no necesita saber de bancarizaciones).
  const [partes, setPartes] = uS([]);
  const [depositos, setDepositos] = uS([]);
  uE(() => {
    let vivo = true;
    const cargar = async () => {
      if (!window.__db) return;
      try {
        const [pp, dp] = await Promise.all([
          window.__db.pagos_partes.filter(p => !p.deleted_at).toArray(),
          window.__db.depositos_bancarizacion.filter(d => !d.deleted_at).toArray(),
        ]);
        if (vivo) { setPartes(pp); setDepositos(dp); }
      } catch { /* offline sin tablas: la pestaña muestra el vacío */ }
    };
    cargar();
    const on = (e) => {
      const t = e?.detail?.tabla;
      if (!t || ['pagos_partes', 'depositos_bancarizacion', 'movimientos_bancarios'].includes(t)) cargar();
    };
    window.addEventListener('jx_data_changed', on);
    return () => { vivo = false; window.removeEventListener('jx_data_changed', on); };
  }, []);

  // ── LOS MOVIMIENTOS DE LO QUE ESTOY MIRANDO ───────────────────────
  const movsDeVista = uM(
    () => (movs || []).filter(m => idsEnVista.has(m.cuenta_id)),
    [movs, idsEnVista]);

  const movsFiltrados = uM(() => {
    const ql = q.trim().toLowerCase();
    return movsDeVista.filter(m => {
      if (desde && String(m.fecha || '') < desde) return false;
      if (hasta && String(m.fecha || '') > hasta) return false;
      if (!ql) return true;
      return `${m.descripcion || ''} ${m.contraparte || ''} ${m.referencia || ''}`.toLowerCase().includes(ql);
    });
  }, [movsDeVista, desde, hasta, q]);

  // El saldo corrido solo tiene sentido sobre UNA cuenta: sumar el saldo de la
  // cuenta en soles con la de dólares daría un número que no existe. Con
  // "todas" mostramos la tabla sin la columna de saldo.
  const unaSolaCuenta = cuentasEnVista.length === 1 ? cuentasEnVista[0] : null;
  const filas = uM(() => {
    if (unaSolaCuenta) {
      // El saldo corrido se calcula sobre TODOS los movimientos de la cuenta y
      // recién después se filtra: si no, filtrar por mes daría un saldo que
      // arranca de cero y no se parece a nada.
      const todos = saldoCorrido(movsDeVista, unaSolaCuenta.saldo_inicial);
      const visibles = new Set(movsFiltrados.map(m => m.id));
      return todos.filter(m => visibles.has(m.id)).reverse();   // lo último, arriba
    }
    return movsFiltrados.slice().sort((a, b) =>
      String(b.fecha || '').localeCompare(String(a.fecha || '')));
  }, [unaSolaCuenta, movsDeVista, movsFiltrados]);

  const tot = uM(() => totales(movsFiltrados), [movsFiltrados]);
  const cuadre = uM(
    () => unaSolaCuenta ? cuadreDeCuenta(movsDeVista, unaSolaCuenta.saldo_inicial) : null,
    [unaSolaCuenta, movsDeVista]);
  const saldoVista = uM(
    () => cuentasEnVista.reduce((s, c) => s + Number(c.saldo_inicial || 0), 0)
       + movsDeVista.reduce((s, m) => s + Number(m.monto || 0), 0),
    [cuentasEnVista, movsDeVista]);

  // ── LA CONCILIACIÓN ───────────────────────────────────────────────
  const pendientes = uM(() => pendientesDeJarvex({
    partes, depositos, movimientos: movs || [],
    cuentaId: unaSolaCuenta?.id || null,
  }), [partes, depositos, movs, unaSolaCuenta]);

  const cruces = uM(
    () => sugerirCruces(movsDeVista, pendientes),
    [movsDeVista, pendientes]);

  // ── EL ÁRBOL POR ENTIDAD ──────────────────────────────────────────
  // Sin filtrar por titular a propósito: esta pestaña es la mirada de arriba
  // —qué tiene cada empresa y cada consorcio, en qué banco—, y desde acá se
  // entra a una cuenta. Dentro de una obra sí se acota a su ejecutora.
  const arbol = uM(() => {
    const ctas = titularForzado ? (cuentas || []).filter(c => c.company_id === titularForzado) : (cuentas || []);
    return agruparPorEntidad(ctas, movs || [], companies || []);
  }, [cuentas, movs, companies, titularForzado]);

  // ── ESCRIBIR ──────────────────────────────────────────────────────
  const [modal, setModal] = uS(null);          // 'nuevo' | 'importar'
  const [form, setForm] = uS({});
  const [busy, setBusy] = uS(false);

  const avisar = (tabla) => {
    try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla } })); } catch {}
  };

  const nuevoMovimiento = async () => {
    if (busy) return;
    const monto = parseFloat(form.monto);
    if (!form.cuenta_id) { showToast('Elige la cuenta', 'red'); return; }
    if (!Number.isFinite(monto) || monto === 0) { showToast('El monto no puede ser cero', 'red'); return; }
    setBusy(true);
    const now = new Date().toISOString();
    try {
      const id = window.__newId();
      // El signo lo decide el sentido elegido, no lo que se teclee: escribir
      // "-500" en una entrada era la forma más fácil de descuadrar la cuenta.
      const signo = form.sentido === 'entrada' ? 1 : -1;
      await window.__db.movimientos_bancarios.add({
        id,
        cuenta_id: form.cuenta_id,
        fecha: form.fecha || new Date().toISOString().slice(0, 10),
        tipo: form.tipo || (signo > 0 ? 'deposito' : 'retiro'),
        monto: signo * Math.abs(monto),
        descripcion: (form.descripcion || '').trim() || null,
        contraparte: (form.contraparte || '').trim() || null,
        referencia: (form.referencia || '').trim() || null,
        saldo_extracto: form.saldo_extracto === '' || form.saldo_extracto == null
          ? null : Number(form.saldo_extracto),
        origen: 'manual',
        obra_id: obraId || null,
        conciliado: false,
        accounting_movement_id: null, pago_parte_id: null, deposito_id: null,
        import_hash: null,
        created_by: userId, updated_by: userId, created_at: now, updated_at: now,
        version: 1, sync_status: 'pending_create', last_synced_at: null,
        idempotency_key: `${userId}_mb_${id}`,
      });
      avisar('movimientos_bancarios');
      showToast('Movimiento registrado', 'green');
      setModal(null);
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };

  /**
   * Cuadrar una línea del banco con lo que ya estaba registrado.
   *
   * Además del vínculo, completa la `cuenta_id` de la constancia cuando venía
   * vacía: hasta hoy nadie preguntaba de qué cuenta salió la plata, y ése es
   * justamente el dato que faltaba para que el estado de cuenta exista.
   */
  const conciliar = async (linea, pend) => {
    const now = new Date().toISOString();
    try {
      const tabla = pend.clase === 'pago_parte' ? 'pagos_partes' : 'depositos_bancarizacion';
      const actual = await window.__db[tabla].get(pend.id);
      if (actual && !actual.cuenta_id) {
        await window.__db[tabla].update(pend.id, {
          cuenta_id: linea.cuenta_id,
          updated_at: now, updated_by: userId,
          version: (actual.version ?? 0) + 1,
          sync_status: actual.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
      }
      const mov = await window.__db.movimientos_bancarios.get(linea.id);
      await window.__db.movimientos_bancarios.update(linea.id, {
        [pend.clase === 'pago_parte' ? 'pago_parte_id' : 'deposito_id']: pend.id,
        conciliado: true, fecha_conciliacion: now.slice(0, 10),
        conciliado_at: now, conciliado_by: userId,
        obra_id: mov?.obra_id || pend.obra_id || null,
        updated_at: now, updated_by: userId,
        version: (mov?.version ?? 0) + 1,
        sync_status: mov?.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      avisar('movimientos_bancarios');
      avisar(tabla);
      return true;
    } catch (e) { showToast('Error al conciliar: ' + (e.message || e), 'red'); return false; }
  };

  const conciliarTodosLosSeguros = async () => {
    if (busy || !cruces.seguros.length) return;
    setBusy(true);
    let ok = 0;
    for (const c of cruces.seguros) if (await conciliar(c.linea, c.pendiente)) ok++;
    setBusy(false);
    showToast(`${ok} movimiento(s) conciliado(s)`, ok ? 'green' : 'amber');
  };

  const desconciliar = async (m) => {
    if (!canWrite) return;
    const now = new Date().toISOString();
    try {
      await window.__db.movimientos_bancarios.update(m.id, {
        pago_parte_id: null, deposito_id: null, accounting_movement_id: null,
        conciliado: false, fecha_conciliacion: null, conciliado_at: null, conciliado_by: null,
        updated_at: now, updated_by: userId,
        version: (m.version ?? 0) + 1,
        sync_status: m.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      avisar('movimientos_bancarios');
      showToast('Se deshizo el cruce', 'amber');
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  const eliminarMov = async (m) => {
    if (!isAdmin) return;
    if (!confirm('¿Eliminar este movimiento? El saldo de la cuenta se recalcula.')) return;
    try {
      await window.__db.movimientos_bancarios.update(m.id, {
        deleted_at: new Date().toISOString(),
        sync_status: m.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
      });
      avisar('movimientos_bancarios');
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  // ── IMPORTAR EL EXTRACTO ──────────────────────────────────────────
  const [imp, setImp] = uS(null);   // { cuenta_id, lineas, descartadas, columnas, yaEstaban }

  const leerArchivo = async (file, cuentaId) => {
    if (!file) return;
    setBusy(true);
    try {
      const { parseExcelFile } = await import('../lib/excel.js');
      const { rows } = await parseExcelFile(file);
      const { lineas, descartadas, columnas } = parsearExtracto(rows);
      // Las que ya están: reimportar el mes anterior no puede duplicar nada.
      const huellas = new Set((movs || [])
        .filter(m => m.cuenta_id === cuentaId && m.import_hash)
        .map(m => m.import_hash));
      const nuevas = lineas.filter(l => !huellas.has(l.import_hash));
      setImp({
        cuenta_id: cuentaId, lineas: nuevas, descartadas, columnas,
        yaEstaban: lineas.length - nuevas.length, archivo: file.name,
      });
    } catch (e) { showToast('No se pudo leer el archivo: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };

  const guardarImportacion = async () => {
    if (busy || !imp?.lineas?.length) return;
    setBusy(true);
    const now = new Date().toISOString();
    try {
      for (const l of imp.lineas) {
        const id = window.__newId();
        await window.__db.movimientos_bancarios.add({
          id, cuenta_id: imp.cuenta_id,
          fecha: l.fecha, tipo: l.tipo, monto: l.monto,
          descripcion: l.descripcion, contraparte: null, referencia: l.referencia,
          saldo_extracto: l.saldo_extracto, import_hash: l.import_hash,
          origen: 'extracto', obra_id: null, conciliado: false,
          accounting_movement_id: null, pago_parte_id: null, deposito_id: null,
          created_by: userId, updated_by: userId, created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_mb_${id}`,
        });
      }
      avisar('movimientos_bancarios');
      showToast(`${imp.lineas.length} línea(s) del extracto importadas`, 'green');
      setImp(null); setModal(null);
      setTab('conciliacion');   // el paso siguiente es cuadrarlas
    } catch (e) { showToast('Error al importar: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };

  // ── PINTAR ────────────────────────────────────────────────────────
  const ORIGEN_BADGE = { extracto: 'b-blue', jarvex: 'b-green', manual: 'b-gray' };
  const ORIGEN_LABEL = { extracto: 'Banco', jarvex: 'JARVEX', manual: 'A mano' };
  const nombreDeCuenta = (id) => nombreCuenta((cuentas || []).find(c => c.id === id));

  const abrirNuevo = () => {
    const cta = unaSolaCuenta?.id || cuentasDelTitular[0]?.id || '';
    if (!cta) { showToast('Esta entidad todavía no tiene cuentas bancarias', 'red'); return; }
    setForm({
      cuenta_id: cta, fecha: new Date().toISOString().slice(0, 10),
      sentido: 'salida', tipo: 'retiro', monto: '', descripcion: '',
      contraparte: '', referencia: '', saldo_extracto: '',
    });
    setModal('nuevo');
  };

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Movimientos Bancarios</div>
          <div className="pg-sub">
            {empresaTitular
              ? `${empresaTitular.name} · ${cuentasDelTitular.length} cuenta(s) · saldo ${fmtSk(saldoVista)}`
              : 'Elige una entidad para ver sus cuentas y su estado de cuenta'}
          </div>
        </div>
        {canWrite && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { setImp(null); setModal('importar'); }}>
              <JxIcon name="upload" size={13} />Importar extracto
            </button>
            <button className="btn btn-amber btn-sm" onClick={abrirNuevo}>
              <JxIcon name="plus" size={13} />Nuevo movimiento
            </button>
          </div>
        )}
      </div>

      {/* Dentro de una obra el titular no se elige: es su ejecutora. */}
      {obraActiva && (
        <div className="card card-p" style={{ marginBottom: 12, borderLeft: '3px solid var(--blue)' }}>
          <div style={{ fontSize: 12 }}>
            <strong>{empresaTitular?.name || 'la ejecutora'}</strong> es la que ejecuta este trabajo:
            lo que ves son <strong>sus</strong> cuentas y sus movimientos. Una obra no tiene cuenta
            propia — la plata de la obra se mueve por las cuentas del consorcio.
          </div>
        </div>
      )}
      {!obraActiva && window.EmpresaActivaBanner ? <window.EmpresaActivaBanner /> : null}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${tab === 'movimientos' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('movimientos')}>
          <JxIcon name="list" size={13} />Estado de cuenta
        </button>
        <button className={`btn btn-sm ${tab === 'conciliacion' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('conciliacion')}>
          <JxIcon name="compare" size={13} />Conciliación
          {cruces.seguros.length > 0 && <span className="badge b-green" style={{ marginLeft: 6 }}>{cruces.seguros.length}</span>}
        </button>
        <button className={`btn btn-sm ${tab === 'entidades' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('entidades')}>
          <JxIcon name="building" size={13} />Por entidad
        </button>
      </div>

      {/* Selector titular › cuenta — el eje del pedido. */}
      {tab !== 'entidades' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="fi" style={{ minWidth: 220 }} value={titular || ''}
            disabled={!!titularForzado}
            title={titularForzado ? 'El titular lo fija el contexto en el que estás.' : undefined}
            onChange={e => setTitularSel(e.target.value)}>
            <option value="">— entidad titular —</option>
            {(companies || [])
              .filter(c => titularForzado ? c.id === titularForzado : c.tipo_entidad !== 'tercero')
              .map(c => (
                <option key={c.id} value={c.id}>
                  {c.tipo_entidad === 'consorcio' ? '◆ ' : ''}{c.name}
                </option>
              ))}
          </select>
          <select className="fi" style={{ minWidth: 200 }} value={cuentaSel} onChange={e => setCuentaSel(e.target.value)}>
            <option value="todas">Todas sus cuentas ({cuentasDelTitular.length})</option>
            {cuentasDelTitular.map(c => (
              <option key={c.id} value={c.id}>{nombreCuenta(c)} · {c.moneda}</option>
            ))}
          </select>
          {tab === 'movimientos' && (
            <>
              <input className="fi" type="date" style={{ maxWidth: 150 }} value={desde} onChange={e => setDesde(e.target.value)} title="Desde" />
              <input className="fi" type="date" style={{ maxWidth: 150 }} value={hasta} onChange={e => setHasta(e.target.value)} title="Hasta" />
              <div className="search-bar">
                <JxIcon name="search" size={14} color="var(--tm)" />
                <input placeholder="Buscar concepto o n° de operación…" value={q} onChange={e => setQ(e.target.value)} />
              </div>
            </>
          )}
        </div>
      )}

      {/* ── ESTADO DE CUENTA ── */}
      {tab === 'movimientos' && (
        cuentasDelTitular.length === 0 ? (
          <div className="card card-p empty-state">
            <JxIcon name="dollar" size={40} color="var(--tm)" />
            <p>
              {empresaTitular
                ? `${empresaTitular.name} no tiene ninguna cuenta bancaria cargada. Créala en Cuentas Bancarias y luego importa su extracto aquí.`
                : 'Elige la entidad titular arriba.'}
            </p>
            {empresaTitular && (
              <button className="btn btn-amber btn-sm" style={{ marginTop: 10 }}
                onClick={() => window.__navTo?.('cuentas-bancarias', 'general')}>
                Ir a Cuentas Bancarias
              </button>
            )}
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px,1fr))', gap: 12, marginBottom: 14 }}>
              <div className="card card-p" style={{ borderLeft: '3px solid var(--blue)' }}>
                <div style={{ fontSize: 11, color: 'var(--tm)', textTransform: 'uppercase' }}>Saldo</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: saldoVista >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtSk(saldoVista)}</div>
                <div style={{ fontSize: 11, color: 'var(--tm)' }}>{cuentasEnVista.length} cuenta(s)</div>
              </div>
              <div className="card card-p" style={{ borderLeft: '3px solid var(--green)' }}>
                <div style={{ fontSize: 11, color: 'var(--tm)', textTransform: 'uppercase' }}>Entró</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--green)' }}>{fmtSk(tot.entradas)}</div>
              </div>
              <div className="card card-p" style={{ borderLeft: '3px solid var(--red)' }}>
                <div style={{ fontSize: 11, color: 'var(--tm)', textTransform: 'uppercase' }}>Salió</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--red)' }}>{fmtSk(tot.salidas)}</div>
              </div>
              <div className="card card-p" style={{ borderLeft: '3px solid var(--amber)' }}>
                <div style={{ fontSize: 11, color: 'var(--tm)', textTransform: 'uppercase' }}>Sin conciliar</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--amber)' }}>{tot.sinConciliar}</div>
                <div style={{ fontSize: 11, color: 'var(--tm)' }}>de {tot.total} movimientos</div>
              </div>
            </div>

            {/* El chequeo que hace confiable a la pantalla: ¿coincide con el banco? */}
            {cuadre && cuadre.cuadra === false && (
              <div className="card card-p" style={{ marginBottom: 12, borderLeft: '3px solid var(--red)' }}>
                <div style={{ fontSize: 12.5 }}>
                  <strong>La cuenta no cuadra con el banco.</strong> Al {cuadre.hasta} el extracto dice{' '}
                  <strong>{fmtS(cuadre.banco)}</strong> y con lo cargado acá da <strong>{fmtS(cuadre.calculado)}</strong>:
                  faltan movimientos por <strong>{fmtS(Math.abs(cuadre.diferencia))}</strong>. Importa el extracto
                  completo del período o revisa el saldo inicial de la cuenta.
                </div>
              </div>
            )}
            {cuadre && cuadre.cuadra === true && (
              <div className="card card-p" style={{ marginBottom: 12, borderLeft: '3px solid var(--green)' }}>
                <div style={{ fontSize: 12.5 }}>
                  Cuadra con el extracto al {cuadre.hasta}: <strong>{fmtS(cuadre.banco)}</strong>.
                </div>
              </div>
            )}

            {filas.length === 0 ? (
              <div className="card card-p empty-state">
                <JxIcon name="list" size={40} color="var(--tm)" />
                <p>Todavía no hay movimientos en esta cuenta. Importa el extracto del banco o registra uno a mano.</p>
              </div>
            ) : (
              <div className="card" style={{ overflowX: 'auto' }}>
                <table className="tbl">
                  <thead><tr>
                    <th>Fecha</th>
                    {!unaSolaCuenta && <th>Cuenta</th>}
                    <th>Concepto</th><th>N° oper.</th><th>Origen</th>
                    <th style={{ textAlign: 'right' }}>Monto</th>
                    {unaSolaCuenta && <th style={{ textAlign: 'right' }}>Saldo</th>}
                    <th>Cuadre</th>
                    <th style={{ textAlign: 'center' }}>Acciones</th>
                  </tr></thead>
                  <tbody>
                    {filas.map(m => (
                      <tr key={m.id}>
                        <td className="col-m">{m.fecha}</td>
                        {!unaSolaCuenta && <td style={{ fontSize: 11 }}>{nombreDeCuenta(m.cuenta_id)}</td>}
                        <td style={{ fontSize: 11.5 }}>
                          {m.descripcion || '—'}
                          {m.contraparte && <div style={{ fontSize: 10, color: 'var(--tm)' }}>{m.contraparte}</div>}
                        </td>
                        <td className="col-m" style={{ fontSize: 11 }}>{m.referencia || '—'}</td>
                        <td><span className={`badge ${ORIGEN_BADGE[m.origen] || 'b-gray'}`}>{ORIGEN_LABEL[m.origen] || m.origen || '—'}</span></td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: Number(m.monto) >= 0 ? 'var(--green)' : 'var(--red)' }} className="col-num">
                          {fmtS(m.monto)}
                        </td>
                        {unaSolaCuenta && (
                          <td style={{ textAlign: 'right' }} className="col-num">{m.saldo != null ? fmtS(m.saldo) : '—'}</td>
                        )}
                        <td>
                          {m.conciliado
                            ? <span className="badge b-green" title={m.conciliado_at ? `Conciliado el ${String(m.conciliado_at).slice(0, 10)}` : undefined}>Cuadrado</span>
                            : <span className="badge b-amber">Pendiente</span>}
                        </td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {m.conciliado && canWrite && (
                            <button className="btn btn-ghost btn-xs" title="Deshacer el cruce" onClick={() => desconciliar(m)}>
                              <JxIcon name="x" size={11} />
                            </button>
                          )}
                          {isAdmin && (
                            <button className="btn btn-red btn-xs" title="Eliminar" style={{ marginLeft: 4 }} onClick={() => eliminarMov(m)}>
                              <JxIcon name="trash" size={11} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )
      )}

      {/* ── CONCILIACIÓN ── */}
      {tab === 'conciliacion' && (
        <>
          <div className="card card-p" style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, color: 'var(--tm)' }}>
              A la izquierda, lo que dice el <strong>banco</strong>. A la derecha, lo que ya se
              <strong> registró en JARVEX</strong> (constancias de pago y bancarizaciones). Cuadrar es
              decir que son la misma operación: el número de operación manda, el monto confirma y la
              fecha desempata. Una constancia se cruza con <strong>una sola</strong> línea.
            </div>
          </div>

          {cruces.seguros.length > 0 && (
            <div className="card" style={{ marginBottom: 14, overflow: 'hidden' }}>
              <div className="card-p frow-sb" style={{ borderBottom: '1px solid var(--border)' }}>
                <strong style={{ fontSize: 13 }}>
                  {cruces.seguros.length} cruce(s) seguros — coincide el n° de operación y el monto
                </strong>
                {canWrite && (
                  <button className="btn btn-green btn-sm" disabled={busy} onClick={conciliarTodosLosSeguros}>
                    <JxIcon name="check" size={13} />Confirmar todos
                  </button>
                )}
              </div>
              <table className="tbl">
                <thead><tr>
                  <th>Fecha (banco)</th><th>Concepto</th><th style={{ textAlign: 'right' }}>Monto</th>
                  <th>↔</th><th>Registrado en JARVEX</th><th>Puntaje</th>
                  <th style={{ textAlign: 'center' }}>Acción</th>
                </tr></thead>
                <tbody>
                  {cruces.seguros.map(c => (
                    <tr key={c.linea.id}>
                      <td className="col-m">{c.linea.fecha}</td>
                      <td style={{ fontSize: 11.5 }}>{c.linea.descripcion || '—'}<div style={{ fontSize: 10, color: 'var(--tm)' }}>{c.linea.referencia || 'sin n° oper.'}</div></td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }} className="col-num">{fmtS(c.linea.monto)}</td>
                      <td style={{ textAlign: 'center', color: 'var(--green)' }}>=</td>
                      <td style={{ fontSize: 11.5 }}>{c.pendiente.etiqueta}<div style={{ fontSize: 10, color: 'var(--tm)' }}>{c.pendiente.fecha} · {c.pendiente.referencia || 'sin n° oper.'}</div></td>
                      <td><span className="badge b-green">{c.score}</span></td>
                      <td style={{ textAlign: 'center' }}>
                        {canWrite && (
                          <button className="btn btn-green btn-xs" disabled={busy}
                            onClick={async () => { if (await conciliar(c.linea, c.pendiente)) showToast('Cuadrado', 'green'); }}>
                            <JxIcon name="check" size={11} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {cruces.probables.length > 0 && (
            <div className="card" style={{ marginBottom: 14, overflow: 'hidden' }}>
              <div className="card-p" style={{ borderBottom: '1px solid var(--border)' }}>
                <strong style={{ fontSize: 13 }}>{cruces.probables.length} posible(s) — míralo antes de confirmar</strong>
                <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>
                  Coincide el monto y la fecha está cerca, pero falta el n° de operación de alguno de los dos lados.
                  Las marcadas <strong>«2 iguales»</strong> tienen más de una constancia idéntica: el monto y el día
                  son los mismos en las dos, así que cuál es cuál solo lo sabes tú.
                </div>
              </div>
              <table className="tbl">
                <thead><tr>
                  <th>Fecha (banco)</th><th>Concepto</th><th style={{ textAlign: 'right' }}>Monto</th>
                  <th>↔</th><th>Registrado en JARVEX</th><th>Puntaje</th>
                  <th style={{ textAlign: 'center' }}>Acción</th>
                </tr></thead>
                <tbody>
                  {cruces.probables.map(c => (
                    <tr key={c.linea.id}>
                      <td className="col-m">{c.linea.fecha}</td>
                      <td style={{ fontSize: 11.5 }}>{c.linea.descripcion || '—'}<div style={{ fontSize: 10, color: 'var(--tm)' }}>{c.linea.referencia || 'sin n° oper.'}</div></td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }} className="col-num">{fmtS(c.linea.monto)}</td>
                      <td style={{ textAlign: 'center', color: 'var(--amber)' }}>?</td>
                      <td style={{ fontSize: 11.5 }}>
                        {c.pendiente.etiqueta}
                        <div style={{ fontSize: 10, color: 'var(--tm)' }}>{c.pendiente.fecha} · {c.pendiente.referencia || 'sin n° oper.'}</div>
                        {c.ambiguo && (
                          <span className="badge b-red" style={{ marginTop: 3 }}
                            title="Hay más de una constancia con el mismo monto y la misma fecha: la app no puede saber cuál es. Elige tú, o carga el n° de operación.">
                            {c.candidatos} iguales
                          </span>
                        )}
                      </td>
                      <td><span className={`badge ${c.ambiguo ? 'b-red' : 'b-amber'}`}>{c.score}</span></td>
                      <td style={{ textAlign: 'center' }}>
                        {canWrite && (
                          <button className="btn btn-amber btn-xs" disabled={busy}
                            onClick={async () => { if (await conciliar(c.linea, c.pendiente)) showToast('Cuadrado', 'green'); }}>
                            <JxIcon name="check" size={11} />Es el mismo
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px,1fr))', gap: 14 }}>
            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="card-p" style={{ borderBottom: '1px solid var(--border)' }}>
                <strong style={{ fontSize: 13 }}>Solo en el banco ({cruces.soloBanco.length})</strong>
                <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>
                  Se movió plata que nadie registró: comisiones, el ITF, un pago hecho desde el celular.
                </div>
              </div>
              {cruces.soloBanco.length === 0 ? (
                <div className="card-p" style={{ fontSize: 12, color: 'var(--tm)' }}>Nada suelto de este lado.</div>
              ) : (
                <table className="tbl">
                  <thead><tr><th>Fecha</th><th>Concepto</th><th style={{ textAlign: 'right' }}>Monto</th></tr></thead>
                  <tbody>
                    {cruces.soloBanco.slice(0, 50).map(m => (
                      <tr key={m.id}>
                        <td className="col-m">{m.fecha}</td>
                        <td style={{ fontSize: 11.5 }}>{m.descripcion || '—'}</td>
                        <td style={{ textAlign: 'right', color: Number(m.monto) >= 0 ? 'var(--green)' : 'var(--red)' }} className="col-num">{fmtS(m.monto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="card-p" style={{ borderBottom: '1px solid var(--border)' }}>
                <strong style={{ fontSize: 13 }}>Solo en JARVEX ({cruces.soloJarvex.length})</strong>
                <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>
                  Está registrado con su constancia, pero no aparece en el extracto cargado: falta importar ese período.
                </div>
              </div>
              {cruces.soloJarvex.length === 0 ? (
                <div className="card-p" style={{ fontSize: 12, color: 'var(--tm)' }}>Nada suelto de este lado.</div>
              ) : (
                <table className="tbl">
                  <thead><tr><th>Fecha</th><th>Qué es</th><th style={{ textAlign: 'right' }}>Monto</th></tr></thead>
                  <tbody>
                    {cruces.soloJarvex.slice(0, 50).map(p => (
                      <tr key={p.clase + p.id}>
                        <td className="col-m">{p.fecha || '—'}</td>
                        <td style={{ fontSize: 11.5 }}>{p.etiqueta}<div style={{ fontSize: 10, color: 'var(--tm)' }}>{p.metodo || ''} {p.referencia || ''}</div></td>
                        <td style={{ textAlign: 'right', color: Number(p.monto) >= 0 ? 'var(--green)' : 'var(--red)' }} className="col-num">{fmtS(p.monto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── POR ENTIDAD ── */}
      {tab === 'entidades' && (
        arbol.length === 0 ? (
          <div className="card card-p empty-state">
            <JxIcon name="building" size={40} color="var(--tm)" />
            <p>Todavía no hay cuentas bancarias cargadas en ninguna entidad.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 14 }}>
            {arbol.map(t => (
              <div className="card" key={t.id} style={{ overflow: 'hidden' }}>
                <div className="card-p frow-sb" style={{
                  borderBottom: '1px solid var(--border)',
                  borderLeft: `3px solid ${t.tipo_entidad === 'consorcio' ? 'var(--purple)' : 'var(--blue)'}`,
                }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>
                      {t.tipo_entidad === 'consorcio' && <span className="badge b-purple" style={{ marginRight: 6 }}>Consorcio</span>}
                      {t.nombre}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--tm)' }}>
                      RUC {t.ruc || '—'} · {t.cuentas} cuenta(s) en {t.bancos.length} banco(s)
                      {t.sinConciliar > 0 && ` · ${t.sinConciliar} sin conciliar`}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: t.saldo >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtSk(t.saldo)}</div>
                  </div>
                </div>
                <table className="tbl">
                  <thead><tr>
                    <th>Entidad bancaria</th><th>Cuenta</th><th>Tipo</th><th>Moneda</th>
                    <th style={{ textAlign: 'right' }}>Movs.</th>
                    <th style={{ textAlign: 'right' }}>Saldo</th>
                    <th style={{ textAlign: 'center' }}>Ver</th>
                  </tr></thead>
                  <tbody>
                    {t.bancos.flatMap(b => b.cuentas.map(c => (
                      <tr key={c.id}>
                        <td className="col-p"><strong>{b.nombre}</strong></td>
                        <td className="col-m" style={{ fontSize: 11 }}>{c.numero_cuenta || '—'}</td>
                        <td><span className="tag">{c.tipo}</span></td>
                        <td className="col-m">{c.moneda}</td>
                        <td style={{ textAlign: 'right' }} className="col-num">
                          {c.movimientos}
                          {c.sinConciliar > 0 && <span className="badge b-amber" style={{ marginLeft: 4 }}>{c.sinConciliar}</span>}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: c.saldo >= 0 ? 'var(--green)' : 'var(--red)' }} className="col-num">{fmtS(c.saldo)}</td>
                        <td style={{ textAlign: 'center' }}>
                          <button className="btn btn-ghost btn-xs" onClick={() => {
                            if (!titularForzado) setTitularSel(t.id);
                            setCuentaSel(c.id);
                            setTab('movimientos');
                          }}>Estado de cuenta</button>
                        </td>
                      </tr>
                    )))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── MODAL: movimiento a mano ── */}
      {modal === 'nuevo' && (
        <Modal title="Nuevo movimiento bancario" icon="dollar" onClose={() => setModal(null)}>
          <div className="g2">
            <div>
              <label className="flabel">Cuenta *</label>
              <select className="fi" value={form.cuenta_id || ''} onChange={e => setForm({ ...form, cuenta_id: e.target.value })}>
                {cuentasDelTitular.map(c => <option key={c.id} value={c.id}>{nombreCuenta(c)} · {c.moneda}</option>)}
              </select>
            </div>
            <div>
              <label className="flabel">Fecha *</label>
              <input className="fi" type="date" value={form.fecha || ''} onChange={e => setForm({ ...form, fecha: e.target.value })} />
            </div>
            <div>
              <label className="flabel">Sentido *</label>
              <select className="fi" value={form.sentido || 'salida'}
                onChange={e => setForm({ ...form, sentido: e.target.value, tipo: e.target.value === 'entrada' ? 'deposito' : 'retiro' })}>
                <option value="salida">Salió plata de la cuenta</option>
                <option value="entrada">Entró plata a la cuenta</option>
              </select>
            </div>
            <div>
              <label className="flabel">Tipo</label>
              <select className="fi" value={form.tipo || 'retiro'} onChange={e => setForm({ ...form, tipo: e.target.value })}>
                <option value="deposito">Depósito</option>
                <option value="retiro">Retiro</option>
                <option value="transferencia_in">Transferencia recibida</option>
                <option value="transferencia_out">Transferencia enviada</option>
                <option value="comision">Comisión / ITF</option>
                <option value="interes">Interés</option>
                <option value="otro">Otro</option>
              </select>
            </div>
            <div>
              <label className="flabel">Monto *</label>
              <input className="fi" type="number" min="0" step="0.01" value={form.monto || ''}
                onChange={e => setForm({ ...form, monto: e.target.value })} placeholder="Siempre positivo" />
              <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 3 }}>El signo lo pone el sentido de arriba.</div>
            </div>
            <div>
              <label className="flabel">N° de operación</label>
              <input className="fi" value={form.referencia || ''} onChange={e => setForm({ ...form, referencia: e.target.value })} />
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <label className="flabel">Concepto</label>
              <input className="fi" value={form.descripcion || ''} onChange={e => setForm({ ...form, descripcion: e.target.value })} />
            </div>
            <div>
              <label className="flabel">Contraparte</label>
              <input className="fi" value={form.contraparte || ''} onChange={e => setForm({ ...form, contraparte: e.target.value })} placeholder="Quién pagó o cobró" />
            </div>
            <div>
              <label className="flabel">Saldo que quedó (si lo sabes)</label>
              <input className="fi" type="number" step="0.01" value={form.saldo_extracto ?? ''}
                onChange={e => setForm({ ...form, saldo_extracto: e.target.value })} />
              <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 3 }}>Sirve para avisar si la cuenta se descuadra.</div>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn btn-amber" disabled={busy} onClick={nuevoMovimiento}>
              <JxIcon name="check" size={13} />Registrar
            </button>
          </div>
        </Modal>
      )}

      {/* ── MODAL: importar el extracto ── */}
      {modal === 'importar' && (
        <Modal title="Importar extracto bancario" icon="upload" onClose={() => { setModal(null); setImp(null); }}>
          {!imp ? (
            <>
              <div style={{ fontSize: 12.5, color: 'var(--tm)', marginBottom: 12 }}>
                Sube el Excel que baja del banco tal como viene. Se reconocen solas las columnas de
                fecha, concepto, n° de operación, cargo/abono y saldo — cada banco las llama distinto.
                Una línea que ya esté cargada <strong>no se duplica</strong>.
              </div>
              <div className="g2">
                <div style={{ gridColumn: '1/-1' }}>
                  <label className="flabel">¿A qué cuenta pertenece este extracto? *</label>
                  <select className="fi" value={form.cuenta_import || ''} onChange={e => setForm({ ...form, cuenta_import: e.target.value })}>
                    <option value="">— elegir cuenta —</option>
                    {cuentasDelTitular.map(c => <option key={c.id} value={c.id}>{nombreCuenta(c)} · {c.moneda}</option>)}
                  </select>
                </div>
                <div style={{ gridColumn: '1/-1' }}>
                  <label className="flabel">Archivo (.xlsx / .csv)</label>
                  <input className="fi" type="file" accept=".xlsx,.xls,.csv" disabled={!form.cuenta_import || busy}
                    onChange={e => leerArchivo(e.target.files?.[0], form.cuenta_import)} />
                  {!form.cuenta_import && <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 4 }}>Elige primero la cuenta.</div>}
                </div>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12.5, marginBottom: 10 }}>
                <strong>{imp.archivo}</strong> → <strong>{nombreDeCuenta(imp.cuenta_id)}</strong>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                <span className="badge b-green">{imp.lineas.length} para importar</span>
                {imp.yaEstaban > 0 && <span className="badge b-gray">{imp.yaEstaban} ya estaban</span>}
                {imp.descartadas.length > 0 && <span className="badge b-amber">{imp.descartadas.length} descartadas</span>}
              </div>

              {imp.lineas.length > 0 && (
                <div className="card" style={{ maxHeight: 260, overflow: 'auto', marginBottom: 12 }}>
                  <table className="tbl">
                    <thead><tr><th>Fecha</th><th>Concepto</th><th>N° oper.</th><th style={{ textAlign: 'right' }}>Monto</th><th style={{ textAlign: 'right' }}>Saldo</th></tr></thead>
                    <tbody>
                      {imp.lineas.slice(0, 100).map((l, i) => (
                        <tr key={i}>
                          <td className="col-m">{l.fecha}</td>
                          <td style={{ fontSize: 11 }}>{l.descripcion || '—'}</td>
                          <td className="col-m" style={{ fontSize: 11 }}>{l.referencia || '—'}</td>
                          <td style={{ textAlign: 'right', color: l.monto >= 0 ? 'var(--green)' : 'var(--red)' }} className="col-num">{fmtS(l.monto)}</td>
                          <td style={{ textAlign: 'right' }} className="col-num">{l.saldo_extracto != null ? fmtS(l.saldo_extracto) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {imp.descartadas.length > 0 && (
                <div className="card card-p" style={{ marginBottom: 12, borderLeft: '3px solid var(--amber)' }}>
                  <div style={{ fontSize: 12 }}>
                    <strong>{imp.descartadas.length} fila(s) no se pudieron leer</strong> — casi siempre son los
                    totales del pie o filas en blanco. Motivos:{' '}
                    {[...new Set(imp.descartadas.map(d => d.motivo))].join(', ')}.
                  </div>
                </div>
              )}

              {imp.lineas.length === 0 && (
                <div className="card card-p" style={{ fontSize: 12.5 }}>
                  No hay nada nuevo para importar en este archivo.
                </div>
              )}
            </>
          )}
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => { setModal(null); setImp(null); }}>Cerrar</button>
            {imp && imp.lineas.length > 0 && (
              <button className="btn btn-amber" disabled={busy} onClick={guardarImportacion}>
                <JxIcon name="check" size={13} />Importar {imp.lineas.length} línea(s)
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { CuentasBancariasPage, FlujoCajaPage, MovimientosBancariosPage });
