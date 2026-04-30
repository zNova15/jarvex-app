import React from "react";
const { useState: uS, useMemo: uM, useEffect: uE } = React;

const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtSk = (n) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1e6) return 'S/ ' + (v/1e6).toFixed(2) + 'M';
  if (Math.abs(v) >= 1e3) return 'S/ ' + (v/1e3).toFixed(0) + 'K';
  return 'S/ ' + v.toFixed(0);
};

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const PLN_BADGE = {
  borrador:'b-gray', calculada:'b-blue', aprobada:'b-amber',
  pagada:'b-green', cerrada:'b-green',
};
const PLN_LABEL = {
  borrador:'Borrador', calculada:'Calculada', aprobada:'Aprobada',
  pagada:'Pagada', cerrada:'Cerrada',
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

function PlanillasPage({ showToast }) {
  const obraId = useObraActiva();
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id ?? 'offline';
  const isAdmin = auth?.profile?.rol === 'admin';
  const myRol = auth?.profile?.rol;
  const puedeGestionar = isAdmin || ['gerente','asistente_admin'].includes(myRol);

  const { data: planillas } = window.__hooks.usePlanillas(obraId);
  const { data: personal } = window.__hooks.usePersonal(obraId);
  const { data: companies } = window.__hooks.useCompanies();

  const [modal, setModal] = uS(null); // null | 'nueva' | 'detalle'
  const [editing, setEditing] = uS(null);
  const [form, setForm] = uS({});
  const [boletas, setBoletas] = uS([]);

  const sorted = uM(() => [...(planillas||[])].sort((a,b) => {
    const da = (a.periodo_anio || 0) * 100 + (a.periodo_mes || 0);
    const db = (b.periodo_anio || 0) * 100 + (b.periodo_mes || 0);
    return db - da;
  }), [planillas]);

  const calcularBoletas = async (planillaId, dias = 30) => {
    // Carga los contratos vigentes y construye boletas iniciales
    const result = [];
    const personalActivo = (personal || []).filter(p => p.estado === 'activo');
    for (const p of personalActivo) {
      try {
        const contratos = await window.__db.personal_contrato
          .where('personal_id').equals(p.id)
          .filter(c => !c.deleted_at && c.estado === 'vigente')
          .toArray();
        const contrato = contratos[0]; // toma el más reciente vigente
        const basico = Number(contrato?.sueldo_basico || 0);
        const asig = Number(contrato?.asignacion_familiar || 0);
        const bonos = Number(contrato?.bonificaciones_fijas || 0);
        const remBasica = +(basico * (dias / 30)).toFixed(2);
        const totalIngresos = +(remBasica + asig + bonos).toFixed(2);
        // Descuentos: AFP/ONP estándar
        let descAfpOnp = 0;
        if (contrato?.tipo_pension === 'AFP') {
          const aporte = Number(contrato.afp_pct_aporte_obligatorio||10) / 100;
          const seguro = Number(contrato.afp_pct_seguro||1.49) / 100;
          const comision = Number(contrato.afp_pct_comision||1.55) / 100;
          descAfpOnp = +(totalIngresos * (aporte + seguro + comision)).toFixed(2);
        } else if (contrato?.tipo_pension === 'ONP') {
          descAfpOnp = +(totalIngresos * 0.13).toFixed(2);
        }
        const totalDesc = +descAfpOnp.toFixed(2);
        const neto = +(totalIngresos - totalDesc).toFixed(2);
        const essalud = +(totalIngresos * 0.09).toFixed(2);
        result.push({
          id: window.__newId(),
          planilla_id: planillaId,
          personal_id: p.id,
          contrato_id: contrato?.id || null,
          nombres: p.nombres, apellidos: p.apellidos, dni: p.dni, cargo: p.cargo,
          dias_trabajados: dias,
          sueldo_basico: basico,
          remuneracion_basica: remBasica,
          asignacion_familiar: asig,
          horas_extras_25: 0, horas_extras_35: 0, horas_extras_100: 0,
          monto_horas_extras: 0,
          bonificaciones: bonos,
          total_ingresos: totalIngresos,
          descuento_afp_onp: descAfpOnp,
          descuento_ir_5ta: 0,
          descuento_otros: 0,
          total_descuentos: totalDesc,
          neto_pagar: neto,
          essalud_empleador: essalud,
          pagado: false,
        });
      } catch (e) { console.error('[boleta calc]', e); }
    }
    return result;
  };

  const openNueva = async () => {
    const hoy = new Date();
    const planillaId = window.__newId();
    const bols = await calcularBoletas(planillaId, 30);
    setForm({
      id: planillaId,
      periodo_mes: hoy.getMonth() + 1,
      periodo_anio: hoy.getFullYear(),
      fecha_pago: '',
      company_id: (companies || []).find(c => c.status==='activa')?.id || '',
      estado: 'borrador',
      notas: '',
    });
    setBoletas(bols);
    setEditing(null);
    setModal('nueva');
  };

  const verDetalle = async (p) => {
    setForm({ ...p });
    setEditing(p);
    try {
      const bols = await window.__db.planilla_boletas.where('planilla_id').equals(p.id).filter(b=>!b.deleted_at).toArray();
      setBoletas(bols);
    } catch { setBoletas([]); }
    setModal('detalle');
  };

  const totales = uM(() => {
    let basico=0, asig=0, bonos=0, ingresos=0, desc=0, neto=0, essalud=0, hExtras=0;
    boletas.forEach(b => {
      basico += Number(b.remuneracion_basica||0);
      asig += Number(b.asignacion_familiar||0);
      bonos += Number(b.bonificaciones||0);
      ingresos += Number(b.total_ingresos||0);
      desc += Number(b.total_descuentos||0);
      neto += Number(b.neto_pagar||0);
      essalud += Number(b.essalud_empleador||0);
      hExtras += Number(b.monto_horas_extras||0);
    });
    return { basico, asig, bonos, ingresos, desc, neto, essalud, hExtras, count: boletas.length };
  }, [boletas]);

  const updateBoleta = (idx, patch) => {
    setBoletas(boletas.map((b, i) => {
      if (i !== idx) return b;
      const nb = { ...b, ...patch };
      // Recalcular si cambian horas extras o descuentos
      const ingresos = Number(nb.remuneracion_basica||0) + Number(nb.asignacion_familiar||0) + Number(nb.bonificaciones||0) + Number(nb.monto_horas_extras||0);
      const desc = Number(nb.descuento_afp_onp||0) + Number(nb.descuento_ir_5ta||0) + Number(nb.descuento_otros||0);
      nb.total_ingresos = +ingresos.toFixed(2);
      nb.total_descuentos = +desc.toFixed(2);
      nb.neto_pagar = +(ingresos - desc).toFixed(2);
      nb.essalud_empleador = +(ingresos * 0.09).toFixed(2);
      return nb;
    }));
  };

  const guardar = async () => {
    if (!form.company_id) { showToast('Selecciona empresa empleadora', 'red'); return; }
    if (boletas.length === 0) { showToast('No hay boletas para guardar', 'amber'); return; }
    const now = new Date().toISOString();
    try {
      const planillaId = form.id;
      const planillaData = {
        obra_id: obraId,
        company_id: form.company_id,
        periodo_mes: parseInt(form.periodo_mes),
        periodo_anio: parseInt(form.periodo_anio),
        fecha_pago: form.fecha_pago || null,
        total_trabajadores: totales.count,
        total_basico: totales.basico,
        total_horas_extras: totales.hExtras,
        total_asignaciones: totales.asig,
        total_bonificaciones: totales.bonos,
        total_remuneraciones: totales.ingresos,
        total_descuentos: totales.desc,
        total_neto: totales.neto,
        total_essalud: totales.essalud,
        estado: form.estado,
        notas: form.notas || null,
      };
      if (editing) {
        await window.__db.planillas.update(planillaId, {
          ...planillaData,
          updated_at: now, updated_by: userId,
          version: (editing.version ?? 0) + 1,
          sync_status: editing.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
        // Soft delete boletas viejas
        const old = await window.__db.planilla_boletas.where('planilla_id').equals(planillaId).toArray();
        for (const o of old) {
          await window.__db.planilla_boletas.update(o.id, { deleted_at: now, sync_status: 'pending_delete' });
        }
      } else {
        await window.__db.planillas.add({
          id: planillaId,
          ...planillaData,
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_pln_${planillaId}`,
        });
      }
      // Insertar boletas
      for (const b of boletas) {
        await window.__db.planilla_boletas.add({
          ...b,
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_blt_${b.id}`,
        });
      }
      try {
        window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'planillas' } }));
        window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'planilla_boletas' } }));
      } catch {}
      showToast(editing ? 'Planilla actualizada' : `Planilla ${MESES[form.periodo_mes-1]}/${form.periodo_anio} creada con ${boletas.length} boletas`, 'green');
      setModal(null); setEditing(null); setBoletas([]);
    } catch (e) { console.error('[pln save]', e); showToast('Error: '+e.message, 'red'); }
  };

  const eliminar = async (p) => {
    if (!isAdmin) return;
    if (!confirm(`¿Eliminar planilla ${MESES[p.periodo_mes-1]}/${p.periodo_anio}?`)) return;
    try {
      await window.__db.planillas.update(p.id, {
        deleted_at: new Date().toISOString(),
        sync_status: p.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'planillas' } })); } catch {}
    } catch (e) {}
  };

  if (!obraId) return <div className="page-wrap"><div className="empty-state"><p>Selecciona una obra.</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Planillas / Sueldos</div>
          <div className="pg-sub">{sorted.length} planillas · {(personal||[]).filter(p=>p.estado==='activo').length} trabajadores activos</div>
        </div>
        {puedeGestionar && (
          <button className="btn btn-amber btn-sm" onClick={openNueva}><JxIcon name="plus" size={13}/>Nueva Planilla</button>
        )}
      </div>

      {sorted.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="user" size={40} color="var(--tm)"/>
          <p style={{maxWidth:480}}>
            No hay planillas registradas.<br/>
            <small style={{color:'var(--tm)'}}>Asegurate de que los trabajadores tengan contratos vigentes con sueldo configurado antes de crear la primera planilla.</small>
          </p>
        </div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <table className="tbl">
            <thead><tr>
              <th>Periodo</th>
              <th style={{ textAlign:'right' }}>Trabajadores</th>
              <th style={{ textAlign:'right' }}>Bruto</th>
              <th style={{ textAlign:'right' }}>Descuentos</th>
              <th style={{ textAlign:'right' }}>Neto pagar</th>
              <th style={{ textAlign:'right' }}>EsSalud (9%)</th>
              <th>Estado</th>
              <th style={{ textAlign:'center' }}>Acciones</th>
            </tr></thead>
            <tbody>
              {sorted.map(p => (
                <tr key={p.id}>
                  <td className="col-m"><strong>{MESES[p.periodo_mes-1]} {p.periodo_anio}</strong></td>
                  <td style={{ textAlign:'right' }}>{p.total_trabajadores}</td>
                  <td style={{ textAlign:'right' }}>{fmtS(p.total_remuneraciones)}</td>
                  <td style={{ textAlign:'right', color:'var(--orange)' }}>{fmtS(p.total_descuentos)}</td>
                  <td style={{ textAlign:'right', fontWeight:700, color:'var(--green)' }}>{fmtS(p.total_neto)}</td>
                  <td style={{ textAlign:'right' }}>{fmtS(p.total_essalud)}</td>
                  <td><span className={`badge ${PLN_BADGE[p.estado]}`}>{PLN_LABEL[p.estado]}</span></td>
                  <td style={{ textAlign:'center' }}>
                    <button className="btn btn-ghost btn-xs" onClick={()=>verDetalle(p)}><JxIcon name="eye" size={11}/></button>
                    {isAdmin && <button className="btn btn-red btn-xs" onClick={()=>eliminar(p)} style={{marginLeft:4}}><JxIcon name="trash" size={11}/></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={editing ? `Planilla ${MESES[form.periodo_mes-1]} ${form.periodo_anio}` : 'Nueva Planilla'} icon="user" onClose={()=>{setModal(null); setEditing(null); setBoletas([]);}} wide>
          <div className="g2">
            <div><label className="flabel">Mes</label>
              <select className="fi" value={form.periodo_mes||1} onChange={e=>setForm({...form, periodo_mes:Number(e.target.value)})} disabled={!!editing}>
                {MESES.map((m,i) => <option key={i} value={i+1}>{m}</option>)}
              </select>
            </div>
            <div><label className="flabel">Año</label><input className="fi" type="number" value={form.periodo_anio||new Date().getFullYear()} onChange={e=>setForm({...form, periodo_anio:Number(e.target.value)})} disabled={!!editing}/></div>
            <div><label className="flabel">Empresa empleadora</label>
              <select className="fi" value={form.company_id||''} onChange={e=>setForm({...form, company_id:e.target.value})}>
                <option value="">—</option>
                {(companies||[]).filter(c=>c.status==='activa').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div><label className="flabel">Estado</label>
              <select className="fi" value={form.estado||'borrador'} onChange={e=>setForm({...form, estado:e.target.value})}>
                {Object.entries(PLN_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div><label className="flabel">Fecha de pago</label><input className="fi" type="date" value={form.fecha_pago||''} onChange={e=>setForm({...form, fecha_pago:e.target.value})}/></div>
            <div style={{gridColumn:'1/-1'}}><label className="flabel">Notas</label><input className="fi" value={form.notas||''} onChange={e=>setForm({...form, notas:e.target.value})}/></div>
          </div>

          <div style={{ marginTop:14, marginBottom:8 }}>
            <strong style={{ fontSize:13 }}>Boletas ({boletas.length})</strong>
          </div>

          {boletas.length === 0 ? (
            <div className="card card-p empty-state" style={{padding:20}}>
              <p style={{maxWidth:380}}>
                No hay boletas. Verifica que los trabajadores activos tengan contrato vigente con sueldo configurado en el módulo Personal.
              </p>
            </div>
          ) : (
            <div style={{ overflowX:'auto', maxHeight:420, border:'1px solid var(--border)', borderRadius:6 }}>
              <table className="tbl" style={{ fontSize:11 }}>
                <thead><tr>
                  <th style={{minWidth:140}}>Trabajador</th>
                  <th style={{width:60, textAlign:'right'}}>Días</th>
                  <th style={{width:90, textAlign:'right'}}>Básico</th>
                  <th style={{width:80, textAlign:'right'}}>Asig.Fam</th>
                  <th style={{width:80, textAlign:'right'}}>Bonos</th>
                  <th style={{width:80, textAlign:'right'}}>H.Extras</th>
                  <th style={{width:90, textAlign:'right'}}>Ingresos</th>
                  <th style={{width:90, textAlign:'right'}}>AFP/ONP</th>
                  <th style={{width:80, textAlign:'right'}}>IR 5ª</th>
                  <th style={{width:80, textAlign:'right'}}>Otros</th>
                  <th style={{width:90, textAlign:'right'}}>NETO</th>
                </tr></thead>
                <tbody>
                  {boletas.map((b, idx) => (
                    <tr key={b.id}>
                      <td>
                        <strong>{b.nombres} {b.apellidos}</strong>
                        <div style={{ fontSize:10, color:'var(--tm)' }}>{b.dni} · {b.cargo}</div>
                      </td>
                      <td><input className="fi" type="number" value={b.dias_trabajados||0} onChange={e=>{
                        const dias = Number(e.target.value)||0;
                        const remB = +(Number(b.sueldo_basico||0) * (dias/30)).toFixed(2);
                        updateBoleta(idx, { dias_trabajados: dias, remuneracion_basica: remB });
                      }} style={{ fontSize:10, padding:'2px 4px', textAlign:'right' }}/></td>
                      <td style={{ textAlign:'right' }}>{fmtS(b.remuneracion_basica)}</td>
                      <td style={{ textAlign:'right' }}>{fmtS(b.asignacion_familiar)}</td>
                      <td style={{ textAlign:'right' }}>{fmtS(b.bonificaciones)}</td>
                      <td><input className="fi" type="number" step="0.01" value={b.monto_horas_extras||0} onChange={e=>updateBoleta(idx, { monto_horas_extras: Number(e.target.value)||0 })} style={{ fontSize:10, padding:'2px 4px', textAlign:'right' }}/></td>
                      <td style={{ textAlign:'right', fontWeight:600 }}>{fmtS(b.total_ingresos)}</td>
                      <td style={{ textAlign:'right', color:'var(--orange)' }}>{fmtS(b.descuento_afp_onp)}</td>
                      <td><input className="fi" type="number" step="0.01" value={b.descuento_ir_5ta||0} onChange={e=>updateBoleta(idx, { descuento_ir_5ta: Number(e.target.value)||0 })} style={{ fontSize:10, padding:'2px 4px', textAlign:'right' }}/></td>
                      <td><input className="fi" type="number" step="0.01" value={b.descuento_otros||0} onChange={e=>updateBoleta(idx, { descuento_otros: Number(e.target.value)||0 })} style={{ fontSize:10, padding:'2px 4px', textAlign:'right' }}/></td>
                      <td style={{ textAlign:'right', fontWeight:700, color:'var(--green)' }}>{fmtS(b.neto_pagar)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background:'rgba(242,183,5,0.15)', fontWeight:700 }}>
                    <td colSpan={6} style={{ padding:'8px 12px' }}>TOTAL ({totales.count})</td>
                    <td style={{ textAlign:'right' }}>{fmtS(totales.ingresos)}</td>
                    <td style={{ textAlign:'right', color:'var(--orange)' }}>{fmtS(totales.desc)}</td>
                    <td/><td/>
                    <td style={{ textAlign:'right', color:'var(--green)' }}>{fmtS(totales.neto)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <div style={{ marginTop:10, display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, fontSize:11 }}>
            <div className="card card-p" style={{padding:8, textAlign:'center'}}>
              <div style={{ color:'var(--tm)' }}>Total Bruto</div>
              <div style={{ fontWeight:700, color:'var(--blue)' }}>{fmtS(totales.ingresos)}</div>
            </div>
            <div className="card card-p" style={{padding:8, textAlign:'center'}}>
              <div style={{ color:'var(--tm)' }}>Descuentos</div>
              <div style={{ fontWeight:700, color:'var(--orange)' }}>{fmtS(totales.desc)}</div>
            </div>
            <div className="card card-p" style={{padding:8, textAlign:'center'}}>
              <div style={{ color:'var(--tm)' }}>NETO PAGAR</div>
              <div style={{ fontWeight:700, color:'var(--green)' }}>{fmtS(totales.neto)}</div>
            </div>
            <div className="card card-p" style={{padding:8, textAlign:'center'}}>
              <div style={{ color:'var(--tm)' }}>EsSalud (9%)</div>
              <div style={{ fontWeight:700 }}>{fmtS(totales.essalud)}</div>
            </div>
          </div>

          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>{setModal(null); setEditing(null); setBoletas([]);}}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardar}><JxIcon name="check" size={13}/>{editing?'Guardar':'Crear Planilla'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { PlanillasPage });
