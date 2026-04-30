import React from "react";
const { useState: uS, useMemo: uM, useEffect: uE } = React;

const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtSk = (n) => {
  const v = Number(n || 0);
  if (v >= 1e6) return 'S/ ' + (v/1e6).toFixed(2) + 'M';
  if (v >= 1e3) return 'S/ ' + (v/1e3).toFixed(0) + 'K';
  return 'S/ ' + v.toFixed(0);
};

const VAL_BADGE = {
  borrador:'b-gray', presentada:'b-blue', aprobada:'b-amber',
  facturada:'b-green', pagada:'b-green', rechazada:'b-red',
};
const VAL_LABEL = {
  borrador:'Borrador', presentada:'Presentada', aprobada:'Aprobada',
  facturada:'Facturada', pagada:'Pagada', rechazada:'Rechazada',
};
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function useObraActiva() {
  const [obraId, setObraId] = uS(null);
  uE(() => {
    let cancelled = false;
    let attempts = 0;
    const find = async () => {
      attempts++;
      const obras = await window.__db.obras.toArray();
      const stored = window.__getObraActivaId?.();
      const a = (stored && obras.find(o => o.id === stored && !o.deleted_at))
             || obras.find(o => !o.deleted_at);
      if (a) { if (!cancelled) setObraId(a.id); return; }
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
  return obraId;
}

function ValorizacionesPage({ showToast }) {
  const obraId = useObraActiva();
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id ?? 'offline';
  const isAdmin = auth?.profile?.rol === 'admin';
  const { data: valorizaciones } = window.__hooks.useValorizaciones(obraId);
  const { data: partidas } = window.__hooks.usePartidas(obraId);
  const { data: obras } = window.__hooks.useObras();
  const { data: companies } = window.__hooks.useCompanies();
  const obra = (obras || []).find(o => o.id === obraId);

  const [modal, setModal] = uS(null);
  const [editing, setEditing] = uS(null);
  const [form, setForm] = uS({});
  const [valPartidas, setValPartidas] = uS([]); // [{ partida_id, codigo, nombre, unidad, metrado_contratado, pu, metrado_anterior, metrado_mes }]
  const [filtroAnio, setFiltroAnio] = uS('todos');

  const sorted = uM(() => {
    let f = [...(valorizaciones || [])];
    if (filtroAnio !== 'todos') f = f.filter(v => String(v.periodo_anio) === filtroAnio);
    return f.sort((a,b) => (b.numero||0) - (a.numero||0));
  }, [valorizaciones, filtroAnio]);

  const aniosDisponibles = uM(() => {
    return Array.from(new Set((valorizaciones||[]).map(v => v.periodo_anio).filter(Boolean))).sort();
  }, [valorizaciones]);

  const nextNumero = uM(() => Math.max(0, ...(valorizaciones||[]).map(v => v.numero||0)) + 1, [valorizaciones]);

  // Calcular metrado anterior por partida (suma de valorizaciones aprobadas/facturadas/pagadas)
  const metradoAnteriorPorPartida = async () => {
    const map = new Map();
    const valsPrev = (valorizaciones || []).filter(v => ['presentada','aprobada','facturada','pagada'].includes(v.estado));
    for (const v of valsPrev) {
      try {
        const vps = await window.__db.valorizacion_partidas.where('valorizacion_id').equals(v.id).filter(x=>!x.deleted_at).toArray();
        vps.forEach(vp => {
          map.set(vp.partida_id, (map.get(vp.partida_id) || 0) + Number(vp.metrado_mes || 0));
        });
      } catch {}
    }
    return map;
  };

  const openNueva = async () => {
    if (!partidas || !partidas.length) { showToast('Esta obra no tiene partidas. Importa el APU primero.', 'red'); return; }
    const hoy = new Date();
    const anteriorMap = await metradoAnteriorPorPartida();
    setForm({
      numero: nextNumero,
      periodo_mes: hoy.getMonth() + 1,
      periodo_anio: hoy.getFullYear(),
      fecha_corte: hoy.toISOString().slice(0,10),
      cliente_nombre: obra?.cliente || '',
      cliente_ruc: obra?.cliente_ruc || '',
      detraccion_pct: 12,
      igv_pct: 18,
      retenciones: 0,
      adelantos: 0,
      company_id: (companies || []).find(c => c.status === 'activa')?.id || '',
      estado: 'borrador',
      notas: '',
    });
    setValPartidas(partidas.map(p => ({
      partida_id: p.id,
      codigo: p.codigo_delfin || '',
      nombre: p.nombre_partida,
      unidad: p.unidad,
      metrado_contratado: Number(p.metrado_contratado || 0),
      pu: Number(p.precio_unitario_pres || 0),
      metrado_anterior: Number(anteriorMap.get(p.id) || 0),
      metrado_mes: 0,
      observacion: '',
    })));
    setEditing(null);
    setModal(true);
  };

  const verDetalle = async (v) => {
    setEditing(v);
    setForm({
      numero: v.numero, periodo_mes: v.periodo_mes, periodo_anio: v.periodo_anio,
      fecha_corte: v.fecha_corte, cliente_nombre: v.cliente_nombre || '',
      cliente_ruc: v.cliente_ruc || '',
      detraccion_pct: Number(v.detraccion_pct||12),
      igv_pct: Number(v.igv_pct||18),
      adelantos: Number(v.adelantos||0),
      retenciones: Number(v.retenciones||0),
      company_id: v.company_id || '',
      estado: v.estado, notas: v.notas || '',
      factura_serie: v.factura_serie || '',
      factura_numero: v.factura_numero || '',
    });
    try {
      const vps = await window.__db.valorizacion_partidas.where('valorizacion_id').equals(v.id).filter(x=>!x.deleted_at).toArray();
      setValPartidas(vps.map(vp => ({
        partida_id: vp.partida_id,
        codigo: vp.codigo,
        nombre: vp.nombre_partida,
        unidad: vp.unidad,
        metrado_contratado: Number(vp.metrado_contratado||0),
        pu: Number(vp.precio_unitario||0),
        metrado_anterior: Number(vp.metrado_anterior||0),
        metrado_mes: Number(vp.metrado_mes||0),
        observacion: vp.observacion || '',
      })));
    } catch { setValPartidas([]); }
    setModal(true);
  };

  // Cálculos
  const totales = uM(() => {
    let bruto = 0;
    valPartidas.forEach(vp => { bruto += vp.metrado_mes * vp.pu; });
    bruto = +bruto.toFixed(2);
    const subtotal = +(bruto - (Number(form.adelantos)||0) - (Number(form.retenciones)||0)).toFixed(2);
    const igv = +(subtotal * (Number(form.igv_pct||18) / 100)).toFixed(2);
    const total = +(subtotal + igv).toFixed(2);
    const detraccion = +(total * (Number(form.detraccion_pct||12) / 100)).toFixed(2);
    const neto = +(total - detraccion).toFixed(2);
    return { bruto, subtotal, igv, total, detraccion, neto };
  }, [valPartidas, form.adelantos, form.retenciones, form.igv_pct, form.detraccion_pct]);

  const updateMetrado = (partida_id, valor) => {
    setValPartidas(valPartidas.map(vp => vp.partida_id === partida_id ? { ...vp, metrado_mes: Number(valor)||0 } : vp));
  };

  const guardar = async () => {
    if (!form.company_id) { showToast('Selecciona empresa emisora', 'red'); return; }
    const now = new Date().toISOString();
    try {
      let valId;
      if (editing) {
        valId = editing.id;
        await window.__db.valorizaciones.update(valId, {
          ...form,
          monto_bruto: totales.bruto,
          monto_subtotal: totales.subtotal,
          monto_igv: totales.igv,
          monto_total: totales.total,
          detraccion_monto: totales.detraccion,
          monto_neto_cobrar: totales.neto,
          updated_at: now, updated_by: userId,
          version: (editing.version ?? 0) + 1,
          sync_status: editing.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
        // Soft delete partidas viejas
        const old = await window.__db.valorizacion_partidas.where('valorizacion_id').equals(valId).toArray();
        for (const o of old) {
          await window.__db.valorizacion_partidas.update(o.id, { deleted_at: now, sync_status: 'pending_delete' });
        }
      } else {
        valId = window.__newId();
        await window.__db.valorizaciones.add({
          id: valId, obra_id: obraId,
          numero: form.numero,
          periodo_mes: form.periodo_mes,
          periodo_anio: form.periodo_anio,
          fecha_corte: form.fecha_corte,
          cliente_nombre: form.cliente_nombre || null,
          cliente_ruc: form.cliente_ruc || null,
          monto_bruto: totales.bruto,
          adelantos: Number(form.adelantos)||0,
          retenciones: Number(form.retenciones)||0,
          monto_subtotal: totales.subtotal,
          igv_pct: Number(form.igv_pct)||18,
          monto_igv: totales.igv,
          monto_total: totales.total,
          detraccion_pct: Number(form.detraccion_pct)||12,
          detraccion_monto: totales.detraccion,
          monto_neto_cobrar: totales.neto,
          factura_serie: form.factura_serie || null,
          factura_numero: form.factura_numero || null,
          estado: form.estado,
          notas: form.notas || null,
          company_id: form.company_id || null,
          accounting_movement_id: null,
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_val_${valId}`,
        });
      }
      // Insertar partidas con metrado > 0
      const conMetrado = valPartidas.filter(vp => vp.metrado_mes > 0);
      for (const vp of conMetrado) {
        const id = window.__newId();
        const acum = vp.metrado_anterior + vp.metrado_mes;
        const monto_mes = +(vp.metrado_mes * vp.pu).toFixed(2);
        const monto_acum = +(acum * vp.pu).toFixed(2);
        const pct = vp.metrado_contratado > 0 ? +(acum / vp.metrado_contratado * 100).toFixed(2) : 0;
        await window.__db.valorizacion_partidas.add({
          id, valorizacion_id: valId,
          partida_id: vp.partida_id,
          codigo: vp.codigo,
          nombre_partida: vp.nombre,
          unidad: vp.unidad,
          metrado_contratado: vp.metrado_contratado,
          precio_unitario: vp.pu,
          metrado_anterior: vp.metrado_anterior,
          metrado_mes: vp.metrado_mes,
          metrado_acumulado: acum,
          monto_mes, monto_acumulado: monto_acum,
          porcentaje_avance: pct,
          observacion: vp.observacion || null,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_val_part_${id}`,
        });
      }
      try {
        window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'valorizaciones' } }));
        window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'valorizacion_partidas' } }));
        window.dispatchEvent(new Event('online'));
      } catch {}
      showToast(editing ? 'Valorización actualizada' : `Valorización N° ${form.numero} creada por ${fmtS(totales.total)}`, 'green');
      setModal(null); setEditing(null); setValPartidas([]);
    } catch (e) {
      console.error('[val save]', e);
      showToast('Error: ' + (e.message || e), 'red');
    }
  };

  // Generar accounting_movement al aprobar/facturar
  const generarMovContable = async (val) => {
    if (val.accounting_movement_id) {
      showToast('Esta valorización ya tiene movimiento contable asociado', 'amber');
      return;
    }
    if (!val.company_id) {
      showToast('Asigna una empresa antes de generar el movimiento', 'red');
      return;
    }
    if (!confirm(`¿Generar movimiento contable de INGRESO por ${fmtS(val.monto_total)} en la empresa correspondiente?`)) return;
    const now = new Date().toISOString();
    const movId = window.__newId();
    try {
      await window.__db.accounting_movements.add({
        id: movId,
        company_id: val.company_id,
        date: val.fecha_emision || val.fecha_corte,
        type: 'income',
        category: 'Valorización de obra',
        description: `Valorización N° ${val.numero} de ${MESES[val.periodo_mes-1]} ${val.periodo_anio}`,
        amount: val.monto_total,
        currency: 'PEN',
        third_party_name: val.cliente_nombre || null,
        third_party_ruc: val.cliente_ruc || null,
        payment_status: 'pending',
        document_type: 'factura',
        document_number: val.factura_serie && val.factura_numero ? `${val.factura_serie}-${val.factura_numero}` : null,
        is_intercompany: false,
        notas: `Detracción 12%: S/${val.detraccion_monto?.toFixed(2)} · Neto a cobrar: S/${val.monto_neto_cobrar?.toFixed(2)}`,
        created_by: userId, updated_by: userId,
        created_at: now, updated_at: now,
        version: 1, sync_status: 'pending_create', last_synced_at: null,
        idempotency_key: `${userId}_acc_mov_${movId}`,
      });
      await window.__db.valorizaciones.update(val.id, {
        accounting_movement_id: movId,
        estado: 'facturada',
        fecha_emision: val.fecha_emision || now.slice(0,10),
        updated_at: now, updated_by: userId,
        version: (val.version ?? 0) + 1,
        sync_status: val.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      try {
        window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'accounting_movements' } }));
        window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'valorizaciones' } }));
      } catch {}
      showToast('Movimiento contable creado y valorización marcada como facturada', 'green');
    } catch (e) { showToast('Error: '+e.message, 'red'); }
  };

  const eliminar = async (v) => {
    if (!isAdmin) return;
    if (!confirm(`¿Eliminar valorización N° ${v.numero}?`)) return;
    try {
      await window.__db.valorizaciones.update(v.id, {
        deleted_at: new Date().toISOString(),
        sync_status: v.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'valorizaciones' } })); } catch {}
      showToast('Eliminada', 'amber');
    } catch (e) { showToast('Error: '+e.message, 'red'); }
  };

  if (!obraId) return <div className="page-wrap"><div className="empty-state"><JxIcon name="dollar" size={32} color="var(--tm)"/><p>Selecciona una obra activa.</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Valorizaciones</div>
          <div className="pg-sub">{obra?.nombre_obra} · {sorted.length} valorizaciones · total emitido {fmtSk(sorted.reduce((s,v)=>s+Number(v.monto_total||0),0))}</div>
        </div>
        <button className="btn btn-amber btn-sm" onClick={openNueva}>
          <JxIcon name="plus" size={13}/>Nueva Valorización
        </button>
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:14 }}>
        <select className="fi" value={filtroAnio} onChange={e=>setFiltroAnio(e.target.value)} style={{ minWidth:120 }}>
          <option value="todos">Todos los años</option>
          {aniosDisponibles.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {sorted.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="dollar" size={40} color="var(--tm)"/>
          <p style={{ maxWidth:480 }}>
            No hay valorizaciones. Crea la primera para emitir factura al cliente por el avance del mes.
          </p>
        </div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <div style={{ overflowX:'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>N°</th><th>Periodo</th><th>Corte</th><th>Cliente</th>
                <th style={{ textAlign:'right' }}>Bruto</th>
                <th style={{ textAlign:'right' }}>Total</th>
                <th style={{ textAlign:'right' }}>Detracción</th>
                <th style={{ textAlign:'right' }}>Neto</th>
                <th>Estado</th>
                <th style={{ textAlign:'center' }}>Acciones</th>
              </tr></thead>
              <tbody>
                {sorted.map(v => (
                  <tr key={v.id}>
                    <td className="col-m"><strong>#{v.numero}</strong></td>
                    <td className="col-m">{MESES[v.periodo_mes-1]} {v.periodo_anio}</td>
                    <td className="col-m">{v.fecha_corte}</td>
                    <td>{v.cliente_nombre || '—'}</td>
                    <td style={{ textAlign:'right' }} className="col-num">{fmtS(v.monto_bruto)}</td>
                    <td style={{ textAlign:'right', fontWeight:700, color:'var(--blue)' }} className="col-num">{fmtS(v.monto_total)}</td>
                    <td style={{ textAlign:'right', color:'var(--orange)' }} className="col-num">{fmtS(v.detraccion_monto)}</td>
                    <td style={{ textAlign:'right', fontWeight:700, color:'var(--green)' }} className="col-num">{fmtS(v.monto_neto_cobrar)}</td>
                    <td><span className={`badge ${VAL_BADGE[v.estado]}`}>{VAL_LABEL[v.estado]}</span></td>
                    <td style={{ textAlign:'center', whiteSpace:'nowrap' }}>
                      <button className="btn btn-ghost btn-xs" title="Ver / Editar" onClick={()=>verDetalle(v)}>
                        <JxIcon name="eye" size={11}/>
                      </button>
                      {!v.accounting_movement_id && ['aprobada','presentada'].includes(v.estado) && (
                        <button className="btn btn-amber btn-xs" title="Generar mov. contable y facturar" onClick={()=>generarMovContable(v)} style={{ marginLeft:4 }}>
                          <JxIcon name="check" size={10}/>$
                        </button>
                      )}
                      {isAdmin && (
                        <button className="btn btn-red btn-xs" title="Eliminar" onClick={()=>eliminar(v)} style={{ marginLeft:4 }}>
                          <JxIcon name="trash" size={11}/>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal && (
        <Modal title={editing ? `Valorización N° ${form.numero}` : 'Nueva Valorización'} icon="dollar" onClose={()=>{setModal(null); setEditing(null); setValPartidas([]);}} wide>
          <div className="g2">
            <div>
              <label className="flabel">N°</label>
              <input className="fi" type="number" value={form.numero||1} onChange={e=>setForm({...form, numero:Number(e.target.value)})}/>
            </div>
            <div>
              <label className="flabel">Mes</label>
              <select className="fi" value={form.periodo_mes||1} onChange={e=>setForm({...form, periodo_mes:Number(e.target.value)})}>
                {MESES.map((m,i) => <option key={i} value={i+1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="flabel">Año</label>
              <input className="fi" type="number" value={form.periodo_anio||new Date().getFullYear()} onChange={e=>setForm({...form, periodo_anio:Number(e.target.value)})}/>
            </div>
            <div>
              <label className="flabel">Fecha de corte</label>
              <input className="fi" type="date" value={form.fecha_corte||''} onChange={e=>setForm({...form, fecha_corte:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Cliente</label>
              <input className="fi" value={form.cliente_nombre||''} onChange={e=>setForm({...form, cliente_nombre:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">RUC cliente</label>
              <input className="fi" maxLength={11} value={form.cliente_ruc||''} onChange={e=>setForm({...form, cliente_ruc:e.target.value.replace(/\D/g,'').slice(0,11)})}/>
            </div>
            <div>
              <label className="flabel">Empresa emisora *</label>
              <select className="fi" value={form.company_id||''} onChange={e=>setForm({...form, company_id:e.target.value})}>
                <option value="">— Selecciona —</option>
                {(companies||[]).filter(c=>c.status==='activa').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="flabel">Estado</label>
              <select className="fi" value={form.estado||'borrador'} onChange={e=>setForm({...form, estado:e.target.value})}>
                {Object.entries(VAL_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginTop:14, marginBottom:8, display:'flex', justifyContent:'space-between' }}>
            <strong style={{ fontSize:13 }}>Detalle por partida</strong>
            <span style={{ fontSize:11, color:'var(--tm)' }}>Solo las que tengan avance del mes &gt; 0 se guardan</span>
          </div>
          <div style={{ overflowX:'auto', maxHeight:320, border:'1px solid var(--border)', borderRadius:6 }}>
            <table className="tbl" style={{ fontSize:11 }}>
              <thead><tr>
                <th style={{ minWidth:80 }}>Código</th>
                <th style={{ minWidth:200 }}>Partida</th>
                <th style={{ width:60 }}>Und.</th>
                <th style={{ width:80, textAlign:'right' }}>M. contr.</th>
                <th style={{ width:90, textAlign:'right' }}>P. Unit.</th>
                <th style={{ width:80, textAlign:'right' }}>M. anterior</th>
                <th style={{ width:90, textAlign:'right' }}>M. del mes</th>
                <th style={{ width:90, textAlign:'right' }}>Monto mes</th>
                <th style={{ width:70, textAlign:'right' }}>% acum.</th>
              </tr></thead>
              <tbody>
                {valPartidas.map(vp => {
                  const acum = vp.metrado_anterior + vp.metrado_mes;
                  const monto = vp.metrado_mes * vp.pu;
                  const pct = vp.metrado_contratado > 0 ? (acum / vp.metrado_contratado * 100) : 0;
                  return (
                    <tr key={vp.partida_id}>
                      <td className="col-m" style={{ fontFamily:'monospace' }}>{vp.codigo}</td>
                      <td>{vp.nombre}</td>
                      <td className="col-m">{vp.unidad}</td>
                      <td style={{ textAlign:'right' }}>{vp.metrado_contratado.toFixed(2)}</td>
                      <td style={{ textAlign:'right' }}>{fmtS(vp.pu)}</td>
                      <td style={{ textAlign:'right', color:'var(--tm)' }}>{vp.metrado_anterior.toFixed(2)}</td>
                      <td>
                        <input className="fi" type="number" min="0" step="0.0001"
                          value={vp.metrado_mes || ''}
                          onChange={e=>updateMetrado(vp.partida_id, e.target.value)}
                          style={{ fontSize:11, textAlign:'right', padding:'3px 6px' }}/>
                      </td>
                      <td style={{ textAlign:'right', fontWeight:600 }}>{fmtS(monto)}</td>
                      <td style={{ textAlign:'right', color: pct>100?'var(--red)':'var(--green)' }}>{pct.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background:'rgba(242,183,5,0.15)', fontWeight:700 }}>
                  <td colSpan={7} style={{ padding:'8px 12px', textAlign:'right' }}>BRUTO MES:</td>
                  <td style={{ textAlign:'right', color:'var(--amber)' }}>{fmtS(totales.bruto)}</td>
                  <td/>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Adicionales y resumen */}
          <div className="g2" style={{ marginTop:14 }}>
            <div>
              <label className="flabel">Adelanto a descontar (S/)</label>
              <input className="fi" type="number" min="0" step="0.01" value={form.adelantos||''} onChange={e=>setForm({...form, adelantos:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Retenciones (S/)</label>
              <input className="fi" type="number" min="0" step="0.01" value={form.retenciones||''} onChange={e=>setForm({...form, retenciones:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">IGV %</label>
              <input className="fi" type="number" step="0.01" value={form.igv_pct||18} onChange={e=>setForm({...form, igv_pct:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Detracción %</label>
              <input className="fi" type="number" step="0.01" value={form.detraccion_pct||12} onChange={e=>setForm({...form, detraccion_pct:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Factura serie</label>
              <input className="fi" value={form.factura_serie||''} onChange={e=>setForm({...form, factura_serie:e.target.value})} placeholder="F001"/>
            </div>
            <div>
              <label className="flabel">Factura número</label>
              <input className="fi" value={form.factura_numero||''} onChange={e=>setForm({...form, factura_numero:e.target.value})} placeholder="00012345"/>
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <label className="flabel">Notas</label>
              <textarea className="fi" rows={2} value={form.notas||''} onChange={e=>setForm({...form, notas:e.target.value})}/>
            </div>
          </div>

          {/* Resumen totales */}
          <div className="card card-p" style={{ marginTop:14, background:'rgba(0,0,0,0.18)' }}>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:6, fontSize:12 }}>
              <div>Bruto:</div><div style={{ textAlign:'right' }}>{fmtS(totales.bruto)}</div>
              <div>(-) Adelantos:</div><div style={{ textAlign:'right', color:'var(--orange)' }}>{fmtS(form.adelantos||0)}</div>
              <div>(-) Retenciones:</div><div style={{ textAlign:'right', color:'var(--orange)' }}>{fmtS(form.retenciones||0)}</div>
              <div style={{ fontWeight:700, borderTop:'1px solid var(--border)', paddingTop:6 }}>Subtotal:</div>
              <div style={{ textAlign:'right', fontWeight:700, borderTop:'1px solid var(--border)', paddingTop:6 }}>{fmtS(totales.subtotal)}</div>
              <div>(+) IGV ({form.igv_pct}%):</div><div style={{ textAlign:'right' }}>{fmtS(totales.igv)}</div>
              <div style={{ fontWeight:800, color:'var(--blue)' }}>TOTAL FACTURA:</div>
              <div style={{ textAlign:'right', fontWeight:800, color:'var(--blue)' }}>{fmtS(totales.total)}</div>
              <div>(-) Detracción ({form.detraccion_pct}%):</div>
              <div style={{ textAlign:'right', color:'var(--orange)' }}>{fmtS(totales.detraccion)}</div>
              <div style={{ fontWeight:800, color:'var(--green)' }}>NETO A COBRAR:</div>
              <div style={{ textAlign:'right', fontWeight:800, color:'var(--green)' }}>{fmtS(totales.neto)}</div>
            </div>
          </div>

          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>{setModal(null); setEditing(null); setValPartidas([]);}}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardar}>
              <JxIcon name="check" size={13}/>{editing ? 'Guardar' : 'Crear Valorización'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { ValorizacionesPage });
