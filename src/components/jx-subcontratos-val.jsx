import React from "react";
const { useState: uS, useMemo: uM, useEffect: uE } = React;

const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtSk = (n) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1e6) return 'S/ ' + (v/1e6).toFixed(2) + 'M';
  if (Math.abs(v) >= 1e3) return 'S/ ' + (v/1e3).toFixed(0) + 'K';
  return 'S/ ' + v.toFixed(0);
};

const SCV_BADGE = {
  borrador:'b-gray', aprobada:'b-amber', pagada:'b-green', rechazada:'b-red',
};
const SCV_LABEL = {
  borrador:'Borrador', aprobada:'Aprobada', pagada:'Pagada', rechazada:'Rechazada',
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

function SubcontratoValorizacionesPage({ showToast }) {
  const obraId = useObraActiva();
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id ?? 'offline';
  const isAdmin = auth?.profile?.rol === 'admin';
  const { data: contratos } = window.__hooks.useSubcontratos(obraId);
  const { data: subs } = window.__hooks.useSubcontratistas();
  const { data: companies } = window.__hooks.useCompanies();

  const [subcontratoId, setSubcontratoId] = uS(null);
  const { data: valorizaciones } = window.__hooks.useSubcontratoValorizaciones(subcontratoId);

  const [modal, setModal] = uS(null);
  const [editing, setEditing] = uS(null);
  const [form, setForm] = uS({});

  const contratosVigentes = uM(() => {
    return (contratos||[]).filter(c => c.estado !== 'cancelado')
      .sort((a,b) => (b.fecha_inicio||'').localeCompare(a.fecha_inicio||''));
  }, [contratos]);

  const subcontratoSel = uM(() => contratosVigentes.find(c => c.id === subcontratoId), [contratosVigentes, subcontratoId]);
  const subcontratistaSel = uM(() => (subs||[]).find(s => s.id === subcontratoSel?.subcontratista_id), [subs, subcontratoSel]);

  // Auto-seleccionar primer contrato cuando carguen
  uE(() => {
    if (!subcontratoId && contratosVigentes.length > 0) {
      setSubcontratoId(contratosVigentes[0].id);
    }
    if (subcontratoId && !contratosVigentes.find(c => c.id === subcontratoId)) {
      setSubcontratoId(contratosVigentes[0]?.id || null);
    }
  }, [contratosVigentes]);

  const sortedVals = uM(() => {
    return [...(valorizaciones||[])].sort((a,b) => (b.numero||0) - (a.numero||0));
  }, [valorizaciones]);

  const nextNumero = uM(() => Math.max(0, ...(valorizaciones||[]).map(v => v.numero||0)) + 1, [valorizaciones]);

  const montoValorizado = Number(subcontratoSel?.monto_valorizado || 0);
  const montoContrato = Number(subcontratoSel?.monto_contrato || 0);
  const restante = montoContrato - montoValorizado;
  const pctAvance = montoContrato > 0 ? (montoValorizado / montoContrato * 100) : 0;

  // Cálculos en vivo del modal
  const totales = uM(() => {
    const avance = Number(form.monto_avance) || 0;
    const retencion = Number(form.retencion_garantia) || 0;
    const penalidad = Number(form.penalidad) || 0;
    const adelanto = Number(form.adelanto_amortizado) || 0;
    const igvPct = Number(form.igv_pct) || 18;
    const detPct = Number(form.detraccion_pct) || 12;
    const subtotal = +(avance - retencion - penalidad - adelanto).toFixed(2);
    const igv = +(subtotal * (igvPct/100)).toFixed(2);
    const total = +(subtotal + igv).toFixed(2);
    const detraccion = +(total * (detPct/100)).toFixed(2);
    const neto = +(total - detraccion).toFixed(2);
    return { subtotal, igv, total, detraccion, neto };
  }, [form.monto_avance, form.retencion_garantia, form.penalidad, form.adelanto_amortizado, form.igv_pct, form.detraccion_pct]);

  const openNueva = () => {
    if (!subcontratoSel) { showToast('Selecciona un subcontrato', 'red'); return; }
    const hoy = new Date();
    setForm({
      numero: nextNumero,
      fecha: hoy.toISOString().slice(0,10),
      periodo_mes: hoy.getMonth() + 1,
      periodo_anio: hoy.getFullYear(),
      monto_avance: '',
      retencion_garantia: 0,
      penalidad: 0,
      adelanto_amortizado: 0,
      igv_pct: Number(subcontratoSel.igv_pct || 18),
      detraccion_pct: Number(subcontratoSel.detraccion_pct || 12),
      factura_serie: '',
      factura_numero: '',
      estado: 'borrador',
      notas: '',
    });
    setEditing(null);
    setModal(true);
  };

  // Auto-calcular retención cuando cambia monto_avance
  uE(() => {
    if (!modal || editing) return;
    const avance = Number(form.monto_avance) || 0;
    const retPct = Number(subcontratoSel?.retencion_pct || 5);
    const ret = +(avance * retPct/100).toFixed(2);
    setForm(prev => ({ ...prev, retencion_garantia: ret }));
  }, [form.monto_avance, modal, editing, subcontratoSel]);

  const verDetalle = (v) => {
    setEditing(v);
    setForm({
      numero: v.numero,
      fecha: v.fecha,
      periodo_mes: v.periodo_mes,
      periodo_anio: v.periodo_anio,
      monto_avance: Number(v.monto_avance||0),
      retencion_garantia: Number(v.retencion_garantia||0),
      penalidad: Number(v.penalidad||0),
      adelanto_amortizado: Number(v.adelanto_amortizado||0),
      igv_pct: Number(v.igv_pct || subcontratoSel?.igv_pct || 18),
      detraccion_pct: Number(v.detraccion_pct || subcontratoSel?.detraccion_pct || 12),
      factura_serie: v.factura_serie || '',
      factura_numero: v.factura_numero || '',
      estado: v.estado,
      notas: v.notas || '',
    });
    setModal(true);
  };

  const guardar = async () => {
    const avance = Number(form.monto_avance);
    if (!Number.isFinite(avance) || avance <= 0) { showToast('Monto de avance inválido', 'red'); return; }
    if (!subcontratoSel) { showToast('Subcontrato no seleccionado', 'red'); return; }
    const now = new Date().toISOString();
    try {
      const data = {
        numero: Number(form.numero),
        fecha: form.fecha,
        periodo_mes: Number(form.periodo_mes),
        periodo_anio: Number(form.periodo_anio),
        monto_avance: avance,
        retencion_garantia: Number(form.retencion_garantia)||0,
        penalidad: Number(form.penalidad)||0,
        adelanto_amortizado: Number(form.adelanto_amortizado)||0,
        monto_subtotal: totales.subtotal,
        igv_pct: Number(form.igv_pct)||18,
        monto_igv: totales.igv,
        monto_total: totales.total,
        detraccion_pct: Number(form.detraccion_pct)||12,
        detraccion_monto: totales.detraccion,
        monto_neto_pagar: totales.neto,
        factura_serie: form.factura_serie || null,
        factura_numero: form.factura_numero || null,
        estado: form.estado || 'borrador',
        notas: form.notas || null,
      };
      if (editing) {
        await window.__db.subcontrato_valorizaciones.update(editing.id, {
          ...data,
          updated_at: now, updated_by: userId,
          version: (editing.version ?? 0) + 1,
          sync_status: editing.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
      } else {
        const id = window.__newId();
        await window.__db.subcontrato_valorizaciones.add({
          id, subcontrato_id: subcontratoId, ...data,
          accounting_movement_id: null,
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_scv_${id}`,
        });
      }
      try {
        window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'subcontrato_valorizaciones' } }));
      } catch {}
      showToast(editing ? 'Valorización actualizada' : `Valorización N° ${form.numero} creada por ${fmtS(totales.neto)}`, 'green');
      setModal(null); setEditing(null);
    } catch (e) {
      console.error('[scv save]', e);
      showToast('Error: '+(e.message||e), 'red');
    }
  };

  // Aprobar y registrar movimiento contable (cost)
  const aprobarYRegistrar = async (v) => {
    if (v.accounting_movement_id) {
      showToast('Esta valorización ya tiene movimiento contable', 'amber');
      return;
    }
    const company = (companies||[]).find(c => c.status === 'activa');
    if (!company) { showToast('No hay empresa activa para registrar el costo', 'red'); return; }
    if (!confirm(`¿Aprobar y registrar movimiento de COSTO por ${fmtS(v.monto_total)} en ${company.name}?`)) return;
    const now = new Date().toISOString();
    const movId = window.__newId();
    try {
      await window.__db.accounting_movements.add({
        id: movId,
        company_id: company.id,
        date: v.fecha,
        type: 'cost',
        category: 'Subcontrato — valorización',
        description: `Subcontrato ${subcontratoSel?.codigo || ''} · Val N° ${v.numero} ${v.periodo_mes ? MESES[v.periodo_mes-1] : ''} ${v.periodo_anio || ''}`.trim(),
        amount: v.monto_total,
        currency: subcontratoSel?.moneda || 'PEN',
        third_party_name: subcontratistaSel?.razon_social || null,
        third_party_ruc: subcontratistaSel?.ruc || null,
        payment_status: 'pending',
        document_type: 'factura',
        document_number: v.factura_serie && v.factura_numero ? `${v.factura_serie}-${v.factura_numero}` : null,
        is_intercompany: false,
        notas: `Detracción ${v.detraccion_pct||12}%: S/${Number(v.detraccion_monto||0).toFixed(2)} · Neto a pagar: S/${Number(v.monto_neto_pagar||0).toFixed(2)} · Retención: S/${Number(v.retencion_garantia||0).toFixed(2)}`,
        created_by: userId, updated_by: userId,
        created_at: now, updated_at: now,
        version: 1, sync_status: 'pending_create', last_synced_at: null,
        idempotency_key: `${userId}_acc_mov_${movId}`,
      });
      await window.__db.subcontrato_valorizaciones.update(v.id, {
        accounting_movement_id: movId,
        estado: 'aprobada',
        updated_at: now, updated_by: userId,
        version: (v.version ?? 0) + 1,
        sync_status: v.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      // Update subcontrato acumulados
      const sct = subcontratoSel;
      const newValorizado = Number(sct.monto_valorizado||0) + Number(v.monto_avance||0);
      const newRetAcum = Number(sct.retencion_acumulada||0) + Number(v.retencion_garantia||0);
      await window.__db.subcontratos.update(sct.id, {
        monto_valorizado: newValorizado,
        retencion_acumulada: newRetAcum,
        saldo_pendiente: Number(sct.monto_contrato||0) - newValorizado,
        updated_at: now, updated_by: userId,
        version: (sct.version ?? 0) + 1,
        sync_status: sct.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      try {
        window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'accounting_movements' } }));
        window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'subcontrato_valorizaciones' } }));
        window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'subcontratos' } }));
      } catch {}
      showToast('Valorización aprobada y costo registrado', 'green');
    } catch (e) { showToast('Error: '+e.message, 'red'); }
  };

  const cancelarValorizacion = async (v) => {
    if (!confirm(`¿Cancelar valorización N° ${v.numero}? Si estaba aprobada, se revertirá el monto valorizado y la retención acumulada.`)) return;
    const now = new Date().toISOString();
    try {
      const wasAprobadaOPagada = ['aprobada','pagada'].includes(v.estado);
      await window.__db.subcontrato_valorizaciones.update(v.id, {
        estado: 'rechazada',
        updated_at: now, updated_by: userId,
        version: (v.version ?? 0) + 1,
        sync_status: v.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      if (wasAprobadaOPagada && subcontratoSel) {
        const sct = subcontratoSel;
        const newValorizado = Math.max(0, Number(sct.monto_valorizado||0) - Number(v.monto_avance||0));
        const newRetAcum = Math.max(0, Number(sct.retencion_acumulada||0) - Number(v.retencion_garantia||0));
        await window.__db.subcontratos.update(sct.id, {
          monto_valorizado: newValorizado,
          retencion_acumulada: newRetAcum,
          saldo_pendiente: Number(sct.monto_contrato||0) - newValorizado,
          updated_at: now, updated_by: userId,
          version: (sct.version ?? 0) + 1,
          sync_status: sct.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
      }
      try {
        window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'subcontrato_valorizaciones' } }));
        window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'subcontratos' } }));
      } catch {}
      showToast('Valorización cancelada', 'amber');
    } catch (e) { showToast('Error: '+e.message, 'red'); }
  };

  const eliminar = async (v) => {
    if (!isAdmin) return;
    if (!confirm(`¿Eliminar valorización N° ${v.numero}? (soft delete)`)) return;
    const now = new Date().toISOString();
    try {
      // Si estaba aprobada/pagada, revertir acumulados también
      if (['aprobada','pagada'].includes(v.estado) && subcontratoSel) {
        const sct = subcontratoSel;
        const newValorizado = Math.max(0, Number(sct.monto_valorizado||0) - Number(v.monto_avance||0));
        const newRetAcum = Math.max(0, Number(sct.retencion_acumulada||0) - Number(v.retencion_garantia||0));
        await window.__db.subcontratos.update(sct.id, {
          monto_valorizado: newValorizado,
          retencion_acumulada: newRetAcum,
          saldo_pendiente: Number(sct.monto_contrato||0) - newValorizado,
          updated_at: now, updated_by: userId,
          version: (sct.version ?? 0) + 1,
          sync_status: sct.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
      }
      await window.__db.subcontrato_valorizaciones.update(v.id, {
        deleted_at: now,
        sync_status: v.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
      });
      try {
        window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'subcontrato_valorizaciones' } }));
        window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'subcontratos' } }));
      } catch {}
      showToast('Eliminada', 'amber');
    } catch (e) { showToast('Error: '+e.message, 'red'); }
  };

  if (!obraId) return (
    <div className="page-wrap">
      <div className="empty-state"><JxIcon name="dollar" size={32} color="var(--tm)"/><p>Selecciona una obra activa.</p></div>
    </div>
  );

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Valorizaciones de Subcontratos</div>
          <div className="pg-sub">Lo que pagamos a los subcontratistas por sus avances</div>
        </div>
        {subcontratoSel && (
          <button className="btn btn-amber btn-sm" onClick={openNueva}>
            <JxIcon name="plus" size={13}/>Nueva Valorización
          </button>
        )}
      </div>

      {/* Selector de subcontrato */}
      <div className="card card-p" style={{ marginBottom:14 }}>
        <label className="flabel">Selecciona subcontrato</label>
        {contratosVigentes.length === 0 ? (
          <div style={{ fontSize:12, color:'var(--tm)', marginTop:4 }}>
            No hay subcontratos vigentes en esta obra. Crea uno desde la sección de Subcontratos.
          </div>
        ) : (
          <select
            className="fi"
            value={subcontratoId || ''}
            onChange={e=>setSubcontratoId(e.target.value || null)}
            style={{ marginTop:4 }}
          >
            <option value="">— Selecciona —</option>
            {contratosVigentes.map(c => {
              const sub = (subs||[]).find(s => s.id === c.subcontratista_id);
              return (
                <option key={c.id} value={c.id}>
                  {c.codigo} · {sub?.razon_social || 'sin nombre'} · {fmtS(c.monto_contrato)}
                </option>
              );
            })}
          </select>
        )}

        {subcontratoSel && (
          <div className="g2" style={{ marginTop:12, fontSize:12 }}>
            <div>
              <div style={{ color:'var(--tm)', fontSize:11 }}>Subcontratista</div>
              <div style={{ fontWeight:700 }}>{subcontratistaSel?.razon_social || '—'}</div>
              <div style={{ fontSize:11, color:'var(--tm)' }}>
                {subcontratistaSel?.ruc ? `RUC ${subcontratistaSel.ruc}` : ''}
                {subcontratistaSel?.especialidad ? ` · ${subcontratistaSel.especialidad}` : ''}
              </div>
            </div>
            <div>
              <div style={{ color:'var(--tm)', fontSize:11 }}>Monto del contrato</div>
              <div style={{ fontWeight:700, color:'var(--blue)' }}>{fmtS(montoContrato)}</div>
              <div style={{ fontSize:11, color:'var(--tm)' }}>
                Retención {subcontratoSel.retencion_pct||5}% · Detracción {subcontratoSel.detraccion_pct||12}% · IGV {subcontratoSel.igv_pct||18}%
              </div>
            </div>
            <div>
              <div style={{ color:'var(--tm)', fontSize:11 }}>Valorizado</div>
              <div style={{ fontWeight:700, color:'var(--green)' }}>{fmtS(montoValorizado)}</div>
              <div style={{ fontSize:11, color:'var(--tm)' }}>{pctAvance.toFixed(1)}% del contrato</div>
            </div>
            <div>
              <div style={{ color:'var(--tm)', fontSize:11 }}>Restante</div>
              <div style={{ fontWeight:700, color:'var(--amber)' }}>{fmtS(restante)}</div>
              <div style={{ fontSize:11, color:'var(--tm)' }}>Retención acum: {fmtS(subcontratoSel.retencion_acumulada||0)}</div>
            </div>
          </div>
        )}
      </div>

      {!subcontratoSel ? null : sortedVals.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="dollar" size={40} color="var(--tm)"/>
          <p style={{ maxWidth:480 }}>
            No hay valorizaciones para este subcontrato. Crea la primera para registrar el avance del subcontratista.
          </p>
        </div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <div style={{ overflowX:'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>N°</th>
                <th>Fecha</th>
                <th>Periodo</th>
                <th style={{ textAlign:'right' }}>Avance</th>
                <th style={{ textAlign:'right' }}>Retención</th>
                <th style={{ textAlign:'right' }}>Penalidad</th>
                <th style={{ textAlign:'right' }}>Adel. amort.</th>
                <th style={{ textAlign:'right' }}>Subtotal</th>
                <th style={{ textAlign:'right' }}>IGV</th>
                <th style={{ textAlign:'right' }}>Total</th>
                <th style={{ textAlign:'right' }}>Detracción</th>
                <th style={{ textAlign:'right' }}>Neto a pagar</th>
                <th>Estado</th>
                <th style={{ textAlign:'center' }}>Acciones</th>
              </tr></thead>
              <tbody>
                {sortedVals.map(v => (
                  <tr key={v.id}>
                    <td className="col-m"><strong>#{v.numero}</strong></td>
                    <td className="col-m">{v.fecha}</td>
                    <td className="col-m">{v.periodo_mes ? `${MESES[v.periodo_mes-1]} ${v.periodo_anio||''}` : '—'}</td>
                    <td style={{ textAlign:'right' }} className="col-num">{fmtS(v.monto_avance)}</td>
                    <td style={{ textAlign:'right', color:'var(--orange)' }} className="col-num">{fmtS(v.retencion_garantia)}</td>
                    <td style={{ textAlign:'right', color:'var(--orange)' }} className="col-num">{fmtS(v.penalidad)}</td>
                    <td style={{ textAlign:'right', color:'var(--orange)' }} className="col-num">{fmtS(v.adelanto_amortizado)}</td>
                    <td style={{ textAlign:'right' }} className="col-num">{fmtS(v.monto_subtotal)}</td>
                    <td style={{ textAlign:'right' }} className="col-num">{fmtS(v.monto_igv)}</td>
                    <td style={{ textAlign:'right', fontWeight:700, color:'var(--blue)' }} className="col-num">{fmtS(v.monto_total)}</td>
                    <td style={{ textAlign:'right', color:'var(--orange)' }} className="col-num">{fmtS(v.detraccion_monto)}</td>
                    <td style={{ textAlign:'right', fontWeight:700, color:'var(--green)' }} className="col-num">{fmtS(v.monto_neto_pagar)}</td>
                    <td><span className={`badge ${SCV_BADGE[v.estado]}`}>{SCV_LABEL[v.estado]}</span></td>
                    <td style={{ textAlign:'center', whiteSpace:'nowrap' }}>
                      <button className="btn btn-ghost btn-xs" title="Ver / Editar" onClick={()=>verDetalle(v)}>
                        <JxIcon name="eye" size={11}/>
                      </button>
                      {v.estado === 'aprobada' && !v.accounting_movement_id && (
                        <button className="btn btn-amber btn-xs" title="Aprobar y registrar costo" onClick={()=>aprobarYRegistrar(v)} style={{ marginLeft:4 }}>
                          <JxIcon name="check" size={10}/>$
                        </button>
                      )}
                      {v.estado === 'borrador' && (
                        <button className="btn btn-amber btn-xs" title="Aprobar y registrar costo" onClick={()=>aprobarYRegistrar(v)} style={{ marginLeft:4 }}>
                          <JxIcon name="check" size={10}/>$
                        </button>
                      )}
                      {['aprobada','pagada'].includes(v.estado) && (
                        <button className="btn btn-ghost btn-xs" title="Cancelar valorización" onClick={()=>cancelarValorizacion(v)} style={{ marginLeft:4 }}>
                          <JxIcon name="x" size={11}/>
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
              <tfoot>
                <tr style={{ background:'rgba(242,183,5,0.10)', fontWeight:700 }}>
                  <td colSpan={9} style={{ padding:'8px 12px', textAlign:'right' }}>TOTALES:</td>
                  <td style={{ textAlign:'right', color:'var(--blue)' }}>{fmtS(sortedVals.reduce((s,v)=>s+Number(v.monto_total||0),0))}</td>
                  <td style={{ textAlign:'right', color:'var(--orange)' }}>{fmtS(sortedVals.reduce((s,v)=>s+Number(v.detraccion_monto||0),0))}</td>
                  <td style={{ textAlign:'right', color:'var(--green)' }}>{fmtS(sortedVals.reduce((s,v)=>s+Number(v.monto_neto_pagar||0),0))}</td>
                  <td colSpan={2}/>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {modal && (
        <Modal title={editing ? `Valorización N° ${form.numero}` : 'Nueva Valorización'} icon="dollar" onClose={()=>{setModal(null); setEditing(null);}} wide>
          <div className="g2">
            <div>
              <label className="flabel">N°</label>
              <input className="fi" type="number" value={form.numero||1} onChange={e=>setForm({...form, numero:Number(e.target.value)})}/>
            </div>
            <div>
              <label className="flabel">Fecha</label>
              <input className="fi" type="date" value={form.fecha||''} onChange={e=>setForm({...form, fecha:e.target.value})}/>
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
              <label className="flabel">Monto avance bruto *</label>
              <input className="fi" type="number" min="0" step="0.01" value={form.monto_avance||''} onChange={e=>setForm({...form, monto_avance:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Retención garantía ({subcontratoSel?.retencion_pct||5}%)</label>
              <input className="fi" type="number" min="0" step="0.01" value={form.retencion_garantia||0} onChange={e=>setForm({...form, retencion_garantia:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Penalidad</label>
              <input className="fi" type="number" min="0" step="0.01" value={form.penalidad||0} onChange={e=>setForm({...form, penalidad:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Adelanto amortizado</label>
              <input className="fi" type="number" min="0" step="0.01" value={form.adelanto_amortizado||0} onChange={e=>setForm({...form, adelanto_amortizado:e.target.value})}/>
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
              <label className="flabel">Factura serie (subcontratista)</label>
              <input className="fi" value={form.factura_serie||''} onChange={e=>setForm({...form, factura_serie:e.target.value})} placeholder="F001"/>
            </div>
            <div>
              <label className="flabel">Factura número</label>
              <input className="fi" value={form.factura_numero||''} onChange={e=>setForm({...form, factura_numero:e.target.value})} placeholder="00012345"/>
            </div>
            <div>
              <label className="flabel">Estado</label>
              <select className="fi" value={form.estado||'borrador'} onChange={e=>setForm({...form, estado:e.target.value})}>
                {Object.entries(SCV_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <label className="flabel">Notas</label>
              <textarea className="fi" rows={2} value={form.notas||''} onChange={e=>setForm({...form, notas:e.target.value})}/>
            </div>
          </div>

          {/* Resumen totales */}
          <div className="card card-p" style={{ marginTop:14, background:'rgba(0,0,0,0.18)' }}>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:6, fontSize:12 }}>
              <div>Avance bruto:</div><div style={{ textAlign:'right' }}>{fmtS(form.monto_avance||0)}</div>
              <div>(-) Retención garantía:</div><div style={{ textAlign:'right', color:'var(--orange)' }}>{fmtS(form.retencion_garantia||0)}</div>
              <div>(-) Penalidad:</div><div style={{ textAlign:'right', color:'var(--orange)' }}>{fmtS(form.penalidad||0)}</div>
              <div>(-) Adelanto amortizado:</div><div style={{ textAlign:'right', color:'var(--orange)' }}>{fmtS(form.adelanto_amortizado||0)}</div>
              <div style={{ fontWeight:700, borderTop:'1px solid var(--border)', paddingTop:6 }}>Subtotal:</div>
              <div style={{ textAlign:'right', fontWeight:700, borderTop:'1px solid var(--border)', paddingTop:6 }}>{fmtS(totales.subtotal)}</div>
              <div>(+) IGV ({form.igv_pct||18}%):</div><div style={{ textAlign:'right' }}>{fmtS(totales.igv)}</div>
              <div style={{ fontWeight:800, color:'var(--blue)' }}>TOTAL FACTURA:</div>
              <div style={{ textAlign:'right', fontWeight:800, color:'var(--blue)' }}>{fmtS(totales.total)}</div>
              <div>(-) Detracción ({form.detraccion_pct||12}%):</div>
              <div style={{ textAlign:'right', color:'var(--orange)' }}>{fmtS(totales.detraccion)}</div>
              <div style={{ fontWeight:800, color:'var(--green)' }}>NETO A PAGAR AL SUBCONTRATISTA:</div>
              <div style={{ textAlign:'right', fontWeight:800, color:'var(--green)' }}>{fmtS(totales.neto)}</div>
            </div>
          </div>

          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>{setModal(null); setEditing(null);}}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardar}>
              <JxIcon name="check" size={13}/>{editing ? 'Guardar' : 'Crear Valorización'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { SubcontratoValorizacionesPage });
