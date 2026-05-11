import React from "react";
import { useBusy } from "../hooks/useBusy.js";
const { useState: uS, useMemo: uM, useEffect: uE } = React;

const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtSk = (n) => {
  const v = Number(n || 0);
  if (v >= 1e6) return 'S/ ' + (v/1e6).toFixed(2) + 'M';
  if (v >= 1e3) return 'S/ ' + (v/1e3).toFixed(0) + 'K';
  return 'S/ ' + v.toFixed(0);
};

const REQ_ESTADO_BADGE = {
  borrador: 'b-gray', solicitada: 'b-amber', cotizando: 'b-blue',
  aprobada: 'b-green', ordenada: 'b-blue', recibida_parcial: 'b-amber',
  recibida: 'b-green', cancelada: 'b-red',
};
const REQ_ESTADO_LABEL = {
  borrador: 'Borrador', solicitada: 'Solicitada', cotizando: 'Cotizando',
  aprobada: 'Aprobada', ordenada: 'Ordenada', recibida_parcial: 'Recib. parcial',
  recibida: 'Recibida', cancelada: 'Cancelada',
};
const PRIORIDAD_COLOR = { baja:'var(--tm)', normal:'var(--ts)', alta:'var(--amber)', urgente:'var(--red)' };

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

// ╔════════════════════════════════════════════════════════════╗
// ║  REQUISICIONES                                             ║
// ╚════════════════════════════════════════════════════════════╝
function RequisicionesPage({ showToast }) {
  const obraId = useObraActiva();
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id ?? 'offline';
  const rol = auth?.profile?.rol || '';
  const isAdmin = rol === 'admin';
  // Doble click guard del botón "Crear Requisición"
  const [busyGuardar, , setBusyGuardar] = useBusy();
  // ¿El rol puede aprobar/cambiar estado de requisiciones?
  // Solo admin + roles con permiso de write en 'Requisiciones' (ej: ingeniero_residente)
  const canApprove = isAdmin || (window.__hasPerm?.(rol, 'Requisiciones', 'w') ?? false);
  // Mismo permiso para crear/editar/guardar. Si el admin marcó al rol
  // como "solo lectura" en la matriz, NO debe poder tocar nada de esta
  // pantalla. Antes solo se gateaba el cambio de estado, así que el
  // almacenero podía crear/editar igual a pesar del override.
  const canWrite = canApprove;
  const { data: requisiciones } = window.__hooks.useRequisiciones(obraId);
  const { data: materiales } = window.__hooks.useMateriales(obraId);

  const [modal, setModal] = uS(null); // null | 'nueva' | 'detalle'
  const [editing, setEditing] = uS(null);
  const [form, setForm] = uS({});
  const [items, setItems] = uS([]);
  const [busqueda, setBusqueda] = uS('');
  const [filtroEstado, setFiltroEstado] = uS('todos');

  const sorted = uM(() => {
    let f = [...(requisiciones || [])];
    if (filtroEstado !== 'todos') f = f.filter(r => r.estado === filtroEstado);
    if (busqueda) {
      const q = busqueda.toLowerCase();
      f = f.filter(r =>
        (r.codigo||'').toLowerCase().includes(q) ||
        (r.notas||'').toLowerCase().includes(q) ||
        (r.descripcion||'').toLowerCase().includes(q)
      );
    }
    return f.sort((a,b) => (b.fecha||'').localeCompare(a.fecha||''));
  }, [requisiciones, filtroEstado, busqueda]);

  // Conteo de items por requisición (carga async desde Dexie)
  const [itemsCountById, setItemsCountById] = uS({});
  uE(() => {
    let cancelled = false;
    (async () => {
      try {
        const allItems = await window.__db.requisicion_items.filter(x => !x.deleted_at).toArray();
        const map = {};
        for (const it of allItems) map[it.requisicion_id] = (map[it.requisicion_id] || 0) + 1;
        if (!cancelled) setItemsCountById(map);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [requisiciones]);

  const nextCodigo = uM(() => {
    const yr = new Date().getFullYear();
    const count = (requisiciones || []).filter(r => (r.codigo || '').startsWith(`REQ-${yr}`)).length + 1;
    return `REQ-${yr}-${String(count).padStart(3,'0')}`;
  }, [requisiciones]);

  const openNueva = () => {
    setForm({
      codigo: nextCodigo,
      descripcion: '',
      fecha: new Date().toISOString().slice(0,10),
      fecha_requerida: '',
      prioridad: 'normal',
      estado: 'borrador',
      notas: '',
    });
    setItems([{ material_id:'', nombre_libre:'', unidad:'', cantidad:'', observacion:'' }]);
    setEditing(null);
    setModal('nueva');
  };

  const verDetalle = async (r) => {
    setEditing(r);
    setForm({
      codigo: r.codigo,
      descripcion: r.descripcion || '',
      fecha: r.fecha,
      fecha_requerida: r.fecha_requerida || '',
      prioridad: r.prioridad,
      estado: r.estado,
      notas: r.notas || '',
    });
    try {
      const its = await window.__db.requisicion_items
        .where('requisicion_id').equals(r.id)
        .filter(x => !x.deleted_at)
        .toArray();
      setItems(its.length ? its : []);
    } catch { setItems([]); }
    setModal('detalle');
  };

  const guardar = async () => {
    if (busyGuardar) return; // doble click guard
    if (!canWrite) {
      showToast('No tenés permisos para crear ni editar requisiciones', 'red');
      return;
    }
    const itemsValidos = items.filter(i => (i.material_id || i.nombre_libre) && Number(i.cantidad) > 0);
    if (!itemsValidos.length) { showToast('Agrega al menos un item con cantidad', 'red'); return; }
    setBusyGuardar(true);
    const now = new Date().toISOString();
    try {
      let reqIdFinal;
      if (editing) {
        reqIdFinal = editing.id;
        await window.__db.requisiciones.update(editing.id, {
          ...form,
          fecha_requerida: form.fecha_requerida || null,
          updated_at: now, updated_by: userId,
          version: (editing.version ?? 0) + 1,
          sync_status: editing.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
        const oldItems = await window.__db.requisicion_items.where('requisicion_id').equals(editing.id).toArray();
        for (const oi of oldItems) {
          await window.__db.requisicion_items.update(oi.id, { deleted_at: now, sync_status: 'pending_delete' });
        }
      } else {
        reqIdFinal = window.__newId();
        await window.__db.requisiciones.add({
          id: reqIdFinal, obra_id: obraId,
          codigo: form.codigo,
          descripcion: form.descripcion || null,
          fecha: form.fecha,
          fecha_requerida: form.fecha_requerida || null,
          solicitante_id: userId,
          prioridad: form.prioridad,
          estado: form.estado,
          notas: form.notas || null,
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_req_${reqIdFinal}`,
        });
      }
      // Insertar items nuevos
      for (const i of itemsValidos) {
        const id = window.__newId();
        const matSel = materiales?.find(m => m.id === i.material_id);
        await window.__db.requisicion_items.add({
          id, requisicion_id: reqIdFinal,
          material_id: i.material_id || null,
          nombre_libre: i.material_id ? null : (i.nombre_libre || null),
          unidad: matSel?.unidad || i.unidad || null,
          cantidad: Number(i.cantidad),
          observacion: i.observacion || null,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_req_item_${id}`,
        });
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'requisiciones' } })); } catch {}
      try { window.dispatchEvent(new Event('online')); } catch {}
      showToast(editing ? 'Requisición actualizada' : `Requisición ${form.codigo} creada con ${itemsValidos.length} items`, 'green');
      setModal(null); setEditing(null); setForm({}); setItems([]);
    } catch (e) {
      console.error('[req save]', e);
      showToast('Error: ' + (e.message || e), 'red');
    } finally {
      setBusyGuardar(false);
    }
  };

  const cambiarEstado = async (r, nuevo) => {
    // Defensa server-side: aunque la UI lo esconda, validamos el rol
    if (!canApprove) {
      showToast('Solo admin o ingeniero residente pueden cambiar el estado', 'red');
      return;
    }
    try {
      await window.__db.requisiciones.update(r.id, {
        estado: nuevo,
        updated_at: new Date().toISOString(),
        version: (r.version ?? 0) + 1,
        sync_status: r.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      try { window.__logAudit?.({ action:'update', table:'requisiciones', recordId:r.id, oldData:{ estado:r.estado }, newData:{ estado:nuevo }, reason:`Cambio de estado de requisición ${r.codigo}` }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'requisiciones' } })); } catch {}
      showToast(`Estado cambiado a ${REQ_ESTADO_LABEL[nuevo]}`, 'green');
    } catch (e) { showToast('Error: ' + (e.message||e), 'red'); }
  };

  // Genera una Orden de Compra (estado 'borrador') a partir de una requisición.
  // Copia los items y se queda esperando que el usuario asigne el proveedor
  // y los precios. Marca la requisición como 'ordenada' (referencia al OC).
  const generarOCDesdeRequisicion = async (r) => {
    try {
      const reqItems = await window.__db.requisicion_items
        .where('requisicion_id').equals(r.id)
        .filter(x => !x.deleted_at)
        .toArray();
      if (!reqItems.length) {
        showToast('Esta requisición no tiene items', 'red');
        return;
      }
      // Verificar si ya hay una OC vinculada (para evitar duplicar)
      const ocsExistentes = await window.__db.ordenes_compra
        .filter(o => !o.deleted_at && o.requisicion_id === r.id).toArray();
      if (ocsExistentes.length > 0) {
        const seguir = confirm(`Esta requisición ya tiene ${ocsExistentes.length} OC asociada(s). ¿Crear otra de todos modos?`);
        if (!seguir) return;
      }
      // Calcular siguiente código de OC
      const yr = new Date().getFullYear();
      const todasOC = await window.__db.ordenes_compra.toArray();
      const count = todasOC.filter(o => (o.codigo || '').startsWith(`OC-${yr}`)).length + 1;
      const codigo = `OC-${yr}-${String(count).padStart(3, '0')}`;
      const ocId = window.__newId();
      const now = new Date().toISOString();
      // Subtotal estimado con precios estimados de la requisición
      let subtotal = 0;
      reqItems.forEach(it => {
        const p = Number(it.precio_estimado || 0);
        const c = Number(it.cantidad || 0);
        subtotal += p * c;
      });
      const igv = +(subtotal * 0.18).toFixed(2);
      await window.__db.ordenes_compra.add({
        id: ocId, obra_id: obraId,
        codigo,
        // Vinculamos a la requisición de origen para trazabilidad
        requisicion_id: r.id,
        requisicion_codigo: r.codigo,
        proveedor_id: null, // hay que asignarlo después
        fecha: now.slice(0,10),
        fecha_entrega: r.fecha_requerida || r.fecha_necesidad || null,
        moneda: 'PEN',
        condicion_pago: 'contado',
        estado: 'borrador',
        monto_subtotal: +subtotal.toFixed(2),
        monto_igv: igv,
        monto_total: +(subtotal + igv).toFixed(2),
        observaciones: `Generada desde Requisición ${r.codigo}${r.descripcion ? ' · ' + r.descripcion : ''}`,
        created_by: userId, updated_by: userId,
        created_at: now, updated_at: now,
        version: 1, sync_status: 'pending_create', last_synced_at: null,
        idempotency_key: `${userId}_oc_${ocId}`,
      });
      // Items
      for (const it of reqItems) {
        const id = window.__newId();
        await window.__db.oc_items.add({
          id, orden_compra_id: ocId,
          material_id: it.material_id || null,
          nombre_libre: it.material_id ? null : (it.nombre_libre || it.descripcion || null),
          unidad: it.unidad || null,
          cantidad: Number(it.cantidad),
          cantidad_recibida: 0,
          precio_unitario: Number(it.precio_estimado || 0),
          subtotal: +(Number(it.cantidad) * Number(it.precio_estimado || 0)).toFixed(2),
          requisicion_item_id: it.id,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_oc_item_${id}`,
        });
      }
      // Marcar requisición como ordenada
      await window.__db.requisiciones.update(r.id, {
        estado: 'ordenada',
        oc_id: ocId,
        oc_codigo: codigo,
        updated_at: now,
        version: (r.version ?? 0) + 1,
        sync_status: r.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      try { await window.__logAudit?.({ action:'insert', table:'ordenes_compra', recordId: ocId,
        newData: { codigo, requisicion: r.codigo, items: reqItems.length },
        reason: `OC generada desde requisición ${r.codigo}` }); } catch {}
      try {
        window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'ordenes_compra' } }));
        window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'requisiciones' } }));
      } catch {}
      showToast(`✓ OC ${codigo} generada · asigná el proveedor en Órdenes de Compra`, 'green');
    } catch (e) {
      showToast('Error: ' + (e.message || e), 'red');
    }
  };

  const eliminar = async (r) => {
    if (!isAdmin) return;
    if (!confirm(`¿Eliminar la requisición ${r.codigo}?`)) return;
    try {
      await window.__db.requisiciones.update(r.id, {
        deleted_at: new Date().toISOString(),
        sync_status: r.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'requisiciones' } })); } catch {}
      showToast('Eliminada', 'amber');
    } catch (e) { showToast('Error: '+e.message,'red'); }
  };

  const addItem = () => setItems([...items, { material_id:'', nombre_libre:'', unidad:'', cantidad:'', observacion:'' }]);
  const removeItem = (idx) => setItems(items.filter((_,i) => i !== idx));
  const updateItem = (idx, patch) => setItems(items.map((it,i) => i===idx ? { ...it, ...patch } : it));

  if (!obraId) return <div className="page-wrap"><div className="empty-state"><JxIcon name="package" size={32} color="var(--tm)"/><p>Selecciona una obra activa.</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Requisiciones</div>
          <div className="pg-sub">Solicitudes de compra desde obra · {sorted.length} de {(requisiciones || []).length}</div>
        </div>
        {canWrite ? (
          <button className="btn btn-amber btn-sm" onClick={openNueva}>
            <JxIcon name="plus" size={13}/>Nueva Requisición
          </button>
        ) : (
          <span className="badge b-gray" title="Tu rol es de solo lectura">Solo lectura</span>
        )}
      </div>

      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:14 }}>
        <div className="search-bar" style={{ flex:'1 1 200px' }}><JxIcon name="search" size={14} color="var(--tm)"/><input placeholder="Buscar código o notas…" value={busqueda} onChange={e=>setBusqueda(e.target.value)}/></div>
        <select className="fi" value={filtroEstado} onChange={e=>setFiltroEstado(e.target.value)} style={{ minWidth:140 }}>
          <option value="todos">Todos los estados</option>
          {Object.entries(REQ_ESTADO_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {sorted.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="package" size={40} color="var(--tm)"/>
          <p>No hay requisiciones {(requisiciones||[]).length>0?'que coincidan':'aún'}.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <div style={{ overflowX:'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Código</th>
                <th>Descripción</th>
                <th style={{ textAlign:'center' }}>Items</th>
                <th>Fecha</th>
                <th>Requerida</th>
                <th>Prioridad</th>
                <th>Estado</th>
                <th>Notas / Motivo</th>
                <th style={{ textAlign:'center' }}>Acciones</th>
              </tr></thead>
              <tbody>
                {sorted.map(r => {
                  const itemsCount = itemsCountById?.[r.id] ?? 0;
                  return (
                  <tr key={r.id}>
                    <td className="col-m" style={{ fontFamily:'monospace' }}><strong>{r.codigo || '—'}</strong></td>
                    <td className="col-p" style={{ maxWidth:280 }}>
                      <div style={{ fontWeight:600, color:'var(--tp)' }}>{r.descripcion || <span style={{ color:'var(--tm)' }}>(sin descripción)</span>}</div>
                      {r.solicitante_nombre && <div style={{ fontSize:10.5, color:'var(--tm)' }}>Solicitó: {r.solicitante_nombre}</div>}
                    </td>
                    <td style={{ textAlign:'center' }}>
                      <span className="badge b-blue">{itemsCount} {itemsCount === 1 ? 'item' : 'items'}</span>
                    </td>
                    <td className="col-m">{r.fecha}</td>
                    <td className="col-m">{r.fecha_requerida || r.fecha_necesidad || '—'}</td>
                    <td><span style={{ color: PRIORIDAD_COLOR[r.prioridad], fontWeight:600, textTransform:'uppercase', fontSize:11 }}>{r.prioridad}</span></td>
                    <td>
                      {canApprove ? (
                        <select className="fi" value={r.estado} onChange={e=>cambiarEstado(r, e.target.value)} style={{ fontSize:11, padding:'4px 6px' }}>
                          {Object.entries(REQ_ESTADO_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      ) : (
                        <span className={`badge ${r.estado === 'aprobada' ? 'b-green' : r.estado === 'recibida' ? 'b-green' : r.estado === 'cancelada' ? 'b-red' : 'b-amber'}`}
                          title="Solo admin o ingeniero residente pueden cambiar el estado">
                          {REQ_ESTADO_LABEL[r.estado] || r.estado}
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize:11, maxWidth:280, whiteSpace:'normal' }}>{r.notas || '—'}</td>
                    <td style={{ textAlign:'center', whiteSpace:'nowrap' }}>
                      <button className="btn btn-ghost btn-xs" title={canWrite ? 'Ver / Editar' : 'Ver detalle (solo lectura)'} onClick={()=>verDetalle(r)}>
                        <JxIcon name="eye" size={11}/>
                      </button>
                      <button className="btn btn-ghost btn-xs" title="Descargar PDF para imprimir y firmar" onClick={async ()=>{
                        try {
                          const its = await window.__db.requisicion_items.where('requisicion_id').equals(r.id).filter(x=>!x.deleted_at).toArray();
                          const obras = await window.__db.obras.toArray();
                          const obra = obras.find(o => o.id === r.obra_id);
                          window.__pdfs?.generateRequisicionPdf?.(r, its, obra, '');
                          showToast('PDF generado', 'green');
                        } catch (e) { showToast('Error PDF: '+e.message, 'red'); }
                      }} style={{ marginLeft:4 }}>
                        <JxIcon name="download" size={11}/>
                      </button>
                      {/* Generar OC desde requisición — solo si hay items y no fue cancelada */}
                      {canApprove && r.estado !== 'cancelada' && r.estado !== 'recibida' && (
                        <button className="btn btn-ghost btn-xs" title="Generar Orden de Compra a partir de esta requisición"
                          onClick={()=>generarOCDesdeRequisicion(r)} style={{ marginLeft:4 }}>
                          <JxIcon name="package" size={11}/> OC
                        </button>
                      )}
                      {isAdmin && (
                        <button className="btn btn-red btn-xs" title="Eliminar" onClick={()=>eliminar(r)} style={{ marginLeft:4 }}>
                          <JxIcon name="trash" size={11}/>
                        </button>
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

      {(modal === 'nueva' || modal === 'detalle') && (
        <Modal title={editing ? `Requisición ${form.codigo}` : 'Nueva Requisición'} icon="package" onClose={()=>{setModal(null); setEditing(null); setItems([]);}} wide>
          {!canWrite && (
            <div className="card card-p" style={{ background:'rgba(243,156,18,0.08)', border:'1px solid rgba(243,156,18,0.3)', marginBottom:12, fontSize:12, color:'var(--amber)' }}>
              👁️ Tu rol tiene acceso de solo lectura. Podés ver el detalle pero no modificarlo.
            </div>
          )}
          <div className="g2">
            <div>
              <label className="flabel">Código</label>
              <input className="fi" value={form.codigo||''} onChange={e=>setForm({...form, codigo:e.target.value})} disabled={!canWrite}/>
            </div>
            <div>
              <label className="flabel">Estado</label>
              <select className="fi" value={form.estado||'borrador'} onChange={e=>setForm({...form, estado:e.target.value})} disabled={!canWrite || (!canApprove && editing)}>
                {Object.entries(REQ_ESTADO_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <label className="flabel">Descripción / Nombre de la solicitud</label>
              <input className="fi" value={form.descripcion||''} onChange={e=>setForm({...form, descripcion:e.target.value})}
                placeholder="Ej: Materiales para vaciado de losa nivel 3 - Semana 18" disabled={!canWrite}/>
            </div>
            <div>
              <label className="flabel">Fecha</label>
              <input className="fi" type="date" value={form.fecha||''} onChange={e=>setForm({...form, fecha:e.target.value})} disabled={!canWrite}/>
            </div>
            <div>
              <label className="flabel">Fecha requerida</label>
              <input className="fi" type="date" value={form.fecha_requerida||''} onChange={e=>setForm({...form, fecha_requerida:e.target.value})} disabled={!canWrite}/>
            </div>
            <div>
              <label className="flabel">Prioridad</label>
              <select className="fi" value={form.prioridad||'normal'} onChange={e=>setForm({...form, prioridad:e.target.value})} disabled={!canWrite}>
                <option value="baja">Baja</option><option value="normal">Normal</option>
                <option value="alta">Alta</option><option value="urgente">Urgente</option>
              </select>
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <label className="flabel">Notas</label>
              <textarea className="fi" rows={2} value={form.notas||''} onChange={e=>setForm({...form, notas:e.target.value})} disabled={!canWrite}/>
            </div>
          </div>

          <div style={{ marginTop:14 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
              <strong style={{ fontSize:13 }}>Items ({items.length})</strong>
              {canWrite && (
                <button className="btn btn-ghost btn-sm" onClick={addItem}>
                  <JxIcon name="plus" size={11}/> Agregar item
                </button>
              )}
            </div>
            <div style={{ overflowX:'auto', maxHeight:300, border:'1px solid var(--border)', borderRadius:6 }}>
              <table className="tbl" style={{ fontSize:11 }}>
                <thead><tr>
                  <th>Material (de almacén)</th><th>O nombre libre</th>
                  <th style={{ width:80 }}>Unidad</th>
                  <th style={{ width:90, textAlign:'right' }}>Cantidad</th>
                  <th>Observación</th>
                  <th style={{ width:32 }}></th>
                </tr></thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={idx}>
                      <td>
                        <select className="fi" value={it.material_id||''} disabled={!canWrite} onChange={e=>{
                          const m = materiales?.find(x => x.id === e.target.value);
                          updateItem(idx, { material_id: e.target.value, unidad: m?.unidad || it.unidad });
                        }} style={{ fontSize:11 }}>
                          <option value="">— libre —</option>
                          {(materiales || []).filter(m => !m.deleted_at).map(m => (
                            <option key={m.id} value={m.id}>{m.nombre_material} ({m.unidad}) · stock {m.stock_actual ?? 0}</option>
                          ))}
                        </select>
                      </td>
                      <td><input className="fi" disabled={!canWrite || !!it.material_id} value={it.nombre_libre||''} onChange={e=>updateItem(idx, { nombre_libre:e.target.value })} placeholder="Si no está en almacén" style={{ fontSize:11 }}/></td>
                      <td><input className="fi" disabled={!canWrite} value={it.unidad||''} onChange={e=>updateItem(idx, { unidad:e.target.value })} style={{ fontSize:11 }}/></td>
                      <td><input className="fi" disabled={!canWrite} type="number" min="0" step="0.01" value={it.cantidad||''} onChange={e=>updateItem(idx, { cantidad:e.target.value })} style={{ fontSize:11, textAlign:'right' }}/></td>
                      <td><input className="fi" disabled={!canWrite} value={it.observacion||''} onChange={e=>updateItem(idx, { observacion:e.target.value })} style={{ fontSize:11 }}/></td>
                      <td>{canWrite && <button className="btn btn-ghost btn-xs" onClick={()=>removeItem(idx)}><JxIcon name="trash" size={10}/></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="modal-actions">
            <button className="btn btn-ghost" disabled={busyGuardar} onClick={()=>{setModal(null); setEditing(null); setItems([]);}}>{canWrite ? 'Cancelar' : 'Cerrar'}</button>
            {canWrite && (
              <button className="btn btn-amber" disabled={busyGuardar} onClick={guardar}>
                <JxIcon name="check" size={13}/>{busyGuardar ? 'Guardando…' : (editing ? 'Guardar Cambios' : 'Crear Requisición')}
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ╔════════════════════════════════════════════════════════════╗
// ║  ÓRDENES DE COMPRA                                         ║
// ╚════════════════════════════════════════════════════════════╝
// Flujo de estados de OC:
//   borrador        → recién creada (datos incompletos)
//   por_confirmar   → confirmada, PDF descargado, esperando firma del solicitante
//   firmada         → almacenero subió foto firmada (notif a compras)
//   enviada         → compras la envió al proveedor
//   recibida_parcial → factura(s) cubrieron parte de los items
//   recibida        → factura(s) cubrieron todos los items (compra completa)
//   cancelada
const OC_ESTADO_BADGE = {
  borrador: 'b-gray',
  por_confirmar: 'b-amber',
  firmada: 'b-blue',
  enviada: 'b-blue',
  aceptada: 'b-amber',
  recibida_parcial: 'b-amber',
  recibida: 'b-green',
  cancelada: 'b-red',
};
const OC_ESTADO_LABEL = {
  borrador: 'Borrador',
  por_confirmar: 'Por confirmar (firma)',
  firmada: 'Firmada',
  enviada: 'Enviada',
  aceptada: 'Aceptada',
  recibida_parcial: 'Comprada parcial',
  recibida: 'Comprada',
  cancelada: 'Cancelada',
};

function OrdenesCompraPage({ showToast }) {
  const obraId = useObraActiva();
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id ?? 'offline';
  const rol = auth?.profile?.rol || '';
  const isAdmin = rol === 'admin';
  const canApproveOC = isAdmin || (window.__hasPerm?.(rol, 'Órdenes de Compra', 'w') ?? false);
  // Doble click guard del botón "Crear OC" (operación compleja: OC + items + reserva)
  const [busyOC, , setBusyOC] = useBusy();
  const { data: ocs } = window.__hooks.useOrdenesCompra(obraId);
  const { data: materiales } = window.__hooks.useMateriales(obraId);
  const [proveedores, setProveedores] = uS([]);
  uE(() => { window.__db.proveedores.toArray().then(setProveedores); }, []);
  const fileInputRef = React.useRef(null);

  // Cancelar OC con motivo obligatorio. Restaura la requisición de origen
  // a estado 'aprobada' si la OC venía de una requisición.
  // Confirmar OC: borrador → por_confirmar. Genera PDF auto y avisa al
  // solicitante/almacenero que tiene que imprimir, hacer firmar y subir
  // la foto firmada para que pase a 'firmada'.
  const confirmarOC = async (oc) => {
    if (oc.estado !== 'borrador') {
      showToast('Solo se puede confirmar una OC en estado borrador', 'amber');
      return;
    }
    try {
      const items = await window.__db.oc_items.where('orden_compra_id').equals(oc.id).filter(x=>!x.deleted_at).toArray();
      if (!items.length) {
        showToast('La OC no tiene items', 'red');
        return;
      }
      // 1. Cambiar estado
      const now = new Date().toISOString();
      await window.__db.ordenes_compra.update(oc.id, {
        estado: 'por_confirmar',
        confirmada_at: now,
        confirmada_por: userId,
        updated_at: now, updated_by: userId,
        version: (oc.version ?? 0) + 1,
        sync_status: oc.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      // 2. Descargar PDF automáticamente
      try {
        const proveedor = lookupProv(oc.proveedor_id);
        const obras = await window.__db.obras.toArray();
        const obra = obras.find(o => o.id === oc.obra_id);
        const companies = await window.__db.companies.toArray();
        const company = companies.find(c => !c.deleted_at && c.status === 'activa');
        window.__pdfs?.generateOCPdf?.(oc, items, proveedor, obra, company);
      } catch (e) { console.warn('[OC confirmar] PDF', e); }
      // 3. Audit + dispatch
      try { await window.__logAudit?.({ action:'update', table:'ordenes_compra', recordId: oc.id,
        oldData:{ estado: 'borrador' }, newData:{ estado: 'por_confirmar' },
        reason:`OC ${oc.codigo} confirmada — PDF descargado, esperando firma del solicitante` }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'ordenes_compra' } })); } catch {}
      try { window.dispatchEvent(new CustomEvent('jarvex_new_notif', {
        detail: {
          tipo: 'oc_por_confirmar',
          titulo: `OC ${oc.codigo} lista para firma`,
          descripcion: `Imprimila, hacela firmar al solicitante y subila como evidencia (botón ⬆ en la OC)`,
        }
      })); } catch {}
      showToast(`✓ OC ${oc.codigo} confirmada · PDF descargado · imprimila y hacela firmar`, 'green');
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  const cancelarOC = async (oc) => {
    const motivo = prompt(`Motivo de cancelación de la OC ${oc.codigo}:\n(ej: "el solicitante dijo que era otro tipo", "se confundió de proveedor")`);
    if (!motivo || motivo.trim().length < 5) {
      showToast('Motivo requerido (mín 5 caracteres)', 'red');
      return;
    }
    try {
      const now = new Date().toISOString();
      await window.__db.ordenes_compra.update(oc.id, {
        estado: 'cancelada',
        motivo_cancelacion: motivo.trim(),
        cancelado_por: userId,
        cancelado_at: now,
        updated_at: now,
        version: (oc.version ?? 0) + 1,
        sync_status: oc.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      // Liberar la requisición de origen si está marcada como ordenada
      if (oc.requisicion_id) {
        const req = await window.__db.requisiciones.get(oc.requisicion_id);
        if (req && req.estado === 'ordenada') {
          await window.__db.requisiciones.update(oc.requisicion_id, {
            estado: 'aprobada',
            oc_id: null, oc_codigo: null,
            updated_at: now,
            version: (req.version ?? 0) + 1,
            sync_status: req.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
          });
          try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'requisiciones' } })); } catch {}
        }
      }
      try { await window.__logAudit?.({ action:'update', table:'ordenes_compra', recordId: oc.id,
        oldData:{ estado: oc.estado }, newData:{ estado:'cancelada', motivo },
        reason: `Cancelación OC ${oc.codigo}: ${motivo}` }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'ordenes_compra' } })); } catch {}
      showToast(`OC ${oc.codigo} cancelada`, 'amber');
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  const [modal, setModal] = uS(null);
  const [editing, setEditing] = uS(null);
  const [form, setForm] = uS({});
  const [items, setItems] = uS([]);
  const [recepciones, setRecepciones] = uS([]); // del OC abierto en detalle
  const [evidenciasOC, setEvidenciasOC] = uS([]); // evidencias ligadas a la OC abierta
  const [busqueda, setBusqueda] = uS('');
  const [filtroEstado, setFiltroEstado] = uS('todos');
  // 'todas' | 'pendientes' (firmada/enviada/aceptada/recibida_parcial) | 'completas' (recibida)
  const [vista, setVista] = uS('todas');

  const ESTADOS_PENDIENTES = ['firmada','enviada','aceptada','recibida_parcial'];

  const sorted = uM(() => {
    let f = [...(ocs || [])];
    if (vista === 'pendientes') f = f.filter(o => ESTADOS_PENDIENTES.includes(o.estado));
    else if (vista === 'completas') f = f.filter(o => o.estado === 'recibida');
    if (filtroEstado !== 'todos') f = f.filter(o => o.estado === filtroEstado);
    if (busqueda) {
      const q = busqueda.toLowerCase();
      f = f.filter(o =>
        (o.codigo||'').toLowerCase().includes(q) ||
        (o.proveedor_nombre||'').toLowerCase().includes(q) ||
        (o.numero_oc||'').toLowerCase().includes(q)
      );
    }
    return f.sort((a,b) => (b.fecha||'').localeCompare(a.fecha||''));
  }, [ocs, filtroEstado, busqueda, vista]);

  const conteoPendientes = uM(() =>
    (ocs || []).filter(o => ESTADOS_PENDIENTES.includes(o.estado)).length
  , [ocs]);

  // Conteo de items por OC + items con cantidad pendiente (cantidad_recibida < cantidad)
  const [ocItemsCount, setOcItemsCount] = uS({});
  const [ocItemsPendientes, setOcItemsPendientes] = uS({});
  uE(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const all = await window.__db.oc_items.filter(x => !x.deleted_at).toArray();
        const totales = {};
        const pendientes = {};
        for (const it of all) {
          totales[it.orden_compra_id] = (totales[it.orden_compra_id] || 0) + 1;
          if (Number(it.cantidad_recibida || 0) < Number(it.cantidad || 0)) {
            pendientes[it.orden_compra_id] = (pendientes[it.orden_compra_id] || 0) + 1;
          }
        }
        if (!cancelled) { setOcItemsCount(totales); setOcItemsPendientes(pendientes); }
      } catch {}
    };
    load();
    const onChange = (e) => { const t = e?.detail?.tabla; if (!t || t === 'oc_items' || t === 'recepciones' || t === 'recepcion_items') load(); };
    window.addEventListener('jx_data_changed', onChange);
    return () => { cancelled = true; window.removeEventListener('jx_data_changed', onChange); };
  }, [ocs]);

  const lookupProv = (id) => proveedores.find(p => p.id === id);

  const nextCodigo = uM(() => {
    const yr = new Date().getFullYear();
    const count = (ocs || []).filter(o => (o.codigo || '').startsWith(`OC-${yr}`)).length + 1;
    return `OC-${yr}-${String(count).padStart(3,'0')}`;
  }, [ocs]);

  const openNueva = () => {
    if (!proveedores.length) { showToast('Crea proveedores primero', 'red'); return; }
    setForm({
      codigo: nextCodigo,
      proveedor_id: proveedores[0].id,
      fecha: new Date().toISOString().slice(0,10),
      fecha_entrega: '',
      moneda: 'PEN',
      condicion_pago: 'contado',
      estado: 'borrador',
      observaciones: '',
    });
    setItems([{ material_id:'', nombre_libre:'', unidad:'', cantidad:'', precio_unitario:'' }]);
    setEditing(null);
    setModal(true);
  };

  const verDetalle = async (oc) => {
    setEditing(oc);
    setForm({
      codigo: oc.codigo,
      proveedor_id: oc.proveedor_id,
      fecha: oc.fecha,
      fecha_entrega: oc.fecha_entrega || '',
      moneda: oc.moneda,
      condicion_pago: oc.condicion_pago || '',
      estado: oc.estado,
      observaciones: oc.observaciones || '',
    });
    try {
      const its = await window.__db.oc_items.where('orden_compra_id').equals(oc.id).filter(x=>!x.deleted_at).toArray();
      setItems(its);
    } catch { setItems([]); }
    // Cargar recepciones formales asociadas
    try {
      const recs = await window.__db.recepciones.where('orden_compra_id').equals(oc.id).filter(x=>!x.deleted_at).toArray();
      // Para cada recepcion, sus items
      const recsConItems = await Promise.all(recs.map(async r => {
        const ris = await window.__db.recepcion_items.where('recepcion_id').equals(r.id).filter(x=>!x.deleted_at).toArray();
        return { ...r, items: ris };
      }));
      setRecepciones(recsConItems.sort((a,b) => (b.fecha||'').localeCompare(a.fecha||'')));
    } catch { setRecepciones([]); }
    // Cargar evidencias (facturas) ligadas a la OC
    try {
      const evs = await window.__db.evidencias
        .where('modulo_relacionado').equals('ordenes_compra')
        .filter(e => e.registro_relacionado_id === oc.id && !e.deleted_at)
        .toArray();
      setEvidenciasOC(evs.sort((a,b) => (b.fecha||'').localeCompare(a.fecha||'')));
    } catch { setEvidenciasOC([]); }
    setModal(true);
  };

  const totales = uM(() => {
    let subtotal = 0;
    items.forEach(i => {
      const c = Number(i.cantidad)||0;
      const p = Number(i.precio_unitario)||0;
      subtotal += c * p;
    });
    const igv = +(subtotal * 0.18).toFixed(2);
    return { subtotal: +subtotal.toFixed(2), igv, total: +(subtotal + igv).toFixed(2) };
  }, [items]);

  const guardar = async () => {
    if (busyOC) return; // doble click guard
    const itemsValidos = items.filter(i => (i.material_id || i.nombre_libre) && Number(i.cantidad) > 0 && Number(i.precio_unitario) > 0);
    if (!itemsValidos.length) { showToast('Agrega al menos un item válido', 'red'); return; }
    setBusyOC(true);
    const now = new Date().toISOString();
    try {
      let ocId;
      if (editing) {
        ocId = editing.id;
        await window.__db.ordenes_compra.update(ocId, {
          ...form,
          fecha_entrega: form.fecha_entrega || null,
          monto_subtotal: totales.subtotal,
          monto_igv: totales.igv,
          monto_total: totales.total,
          updated_at: now, updated_by: userId,
          version: (editing.version ?? 0) + 1,
          sync_status: editing.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
        const oldItems = await window.__db.oc_items.where('orden_compra_id').equals(ocId).toArray();
        for (const oi of oldItems) {
          await window.__db.oc_items.update(oi.id, { deleted_at: now, sync_status: 'pending_delete' });
        }
      } else {
        ocId = window.__newId();
        await window.__db.ordenes_compra.add({
          id: ocId, obra_id: obraId,
          codigo: form.codigo,
          proveedor_id: form.proveedor_id,
          fecha: form.fecha,
          fecha_entrega: form.fecha_entrega || null,
          monto_subtotal: totales.subtotal,
          monto_igv: totales.igv,
          monto_total: totales.total,
          moneda: form.moneda,
          condicion_pago: form.condicion_pago || null,
          estado: form.estado,
          observaciones: form.observaciones || null,
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_oc_${ocId}`,
        });
      }
      // Insertar items
      for (const i of itemsValidos) {
        const id = window.__newId();
        const c = Number(i.cantidad);
        const p = Number(i.precio_unitario);
        await window.__db.oc_items.add({
          id, orden_compra_id: ocId,
          material_id: i.material_id || null,
          nombre_libre: i.material_id ? null : (i.nombre_libre || null),
          unidad: i.unidad || null,
          cantidad: c,
          cantidad_recibida: i.cantidad_recibida || 0,
          precio_unitario: p,
          subtotal: +(c*p).toFixed(2),
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_oc_item_${id}`,
        });
      }
      try {
        window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'ordenes_compra' } }));
        window.dispatchEvent(new Event('online'));
      } catch {}
      showToast(editing ? 'OC actualizada' : `OC ${form.codigo} creada por ${fmtS(totales.total)}`, 'green');
      setModal(null); setEditing(null); setItems([]);
    } catch (e) {
      console.error('[oc save]', e);
      showToast('Error: ' + (e.message || e), 'red');
    } finally {
      setBusyOC(false);
    }
  };

  const cambiarEstado = async (oc, nuevo) => {
    if (!canApproveOC) {
      showToast('Solo admin o gerente pueden cambiar el estado de la OC', 'red');
      return;
    }
    try {
      await window.__db.ordenes_compra.update(oc.id, {
        estado: nuevo, updated_at: new Date().toISOString(),
        version: (oc.version ?? 0) + 1,
        sync_status: oc.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      try { window.__logAudit?.({ action:'update', table:'ordenes_compra', recordId:oc.id, oldData:{ estado:oc.estado }, newData:{ estado:nuevo }, reason:`Cambio de estado de OC ${oc.codigo}` }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'ordenes_compra' } })); } catch {}
    } catch (e) { showToast('Error: '+e.message, 'red'); }
  };

  const addItem = () => setItems([...items, { material_id:'', nombre_libre:'', unidad:'', cantidad:'', precio_unitario:'' }]);
  const removeItem = (idx) => setItems(items.filter((_,i) => i !== idx));
  const updateItem = (idx, patch) => setItems(items.map((it,i) => i===idx ? { ...it, ...patch } : it));

  if (!obraId) return <div className="page-wrap"><div className="empty-state"><JxIcon name="package" size={32} color="var(--tm)"/><p>Selecciona una obra activa.</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Órdenes de Compra</div>
          <div className="pg-sub">{sorted.length} órdenes · total {fmtSk(sorted.reduce((s,o)=>s+Number(o.monto_total||0),0))}</div>
        </div>
        <button className="btn btn-amber btn-sm" onClick={openNueva}>
          <JxIcon name="plus" size={13}/>Nueva OC
        </button>
      </div>

      <div style={{ display:'flex', gap:6, marginBottom:10 }}>
        <button
          className={`btn btn-sm ${vista === 'todas' ? 'btn-amber' : 'btn-ghost'}`}
          onClick={()=>setVista('todas')}>
          Todas ({(ocs||[]).length})
        </button>
        <button
          className={`btn btn-sm ${vista === 'pendientes' ? 'btn-amber' : 'btn-ghost'}`}
          onClick={()=>setVista('pendientes')}
          title="OCs firmadas/enviadas/aceptadas/parciales con items aún por recibir">
          ⏳ Con items pendientes ({conteoPendientes})
        </button>
        <button
          className={`btn btn-sm ${vista === 'completas' ? 'btn-amber' : 'btn-ghost'}`}
          onClick={()=>setVista('completas')}>
          ✓ Compradas
        </button>
      </div>

      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:14 }}>
        <div className="search-bar" style={{ flex:'1 1 200px' }}><JxIcon name="search" size={14} color="var(--tm)"/><input placeholder="Buscar código…" value={busqueda} onChange={e=>setBusqueda(e.target.value)}/></div>
        <select className="fi" value={filtroEstado} onChange={e=>setFiltroEstado(e.target.value)} style={{ minWidth:140 }}>
          <option value="todos">Todos los estados</option>
          {Object.entries(OC_ESTADO_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {sorted.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="package" size={40} color="var(--tm)"/>
          <p>No hay órdenes de compra registradas.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <div style={{ overflowX:'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Código</th>
                <th>Proveedor</th>
                <th style={{ textAlign:'center' }}>Items</th>
                <th>Fecha</th>
                <th>Entrega</th>
                <th style={{ textAlign:'right' }}>Monto</th>
                <th>Estado</th>
                <th style={{ textAlign:'center' }}>Acciones</th>
              </tr></thead>
              <tbody>
                {sorted.map(oc => {
                  const itemsN = ocItemsCount[oc.id] ?? 0;
                  const itemsPend = ocItemsPendientes[oc.id] ?? 0;
                  const provLabel = lookupProv(oc.proveedor_id)?.razon_social || oc.proveedor_nombre || '—';
                  return (
                  <tr key={oc.id}>
                    <td className="col-m" style={{ fontFamily:'monospace' }}>
                      <strong>{oc.codigo || oc.numero_oc || '—'}</strong>
                      {oc.numero_oc && oc.numero_oc !== oc.codigo && <div style={{ fontSize:10, color:'var(--tm)' }}>{oc.numero_oc}</div>}
                    </td>
                    <td className="col-p" style={{ maxWidth:240, fontWeight:600, color:'var(--tp)' }}>{provLabel}</td>
                    <td style={{ textAlign:'center' }}>
                      <span className="badge b-blue">{itemsN} {itemsN === 1 ? 'item' : 'items'}</span>
                      {itemsPend > 0 && (
                        <div style={{ fontSize:10, color:'var(--amber)', fontWeight:600, marginTop:2 }}>
                          ⏳ {itemsPend} pend.
                        </div>
                      )}
                    </td>
                    <td className="col-m">{oc.fecha}</td>
                    <td className="col-m">{oc.fecha_entrega || '—'}</td>
                    <td style={{ textAlign:'right', fontWeight:700, color:'var(--blue)' }} className="col-num">{fmtS(oc.monto_total || oc.total)}</td>
                    <td>
                      {canApproveOC ? (
                        <select className="fi" value={oc.estado} onChange={e=>cambiarEstado(oc, e.target.value)} style={{ fontSize:11, padding:'4px 6px' }}>
                          {Object.entries(OC_ESTADO_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      ) : (
                        <span className={`badge ${OC_ESTADO_BADGE[oc.estado] || 'b-gray'}`}
                          title="Solo admin o gerente pueden cambiar el estado">
                          {OC_ESTADO_LABEL[oc.estado] || oc.estado}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign:'center', whiteSpace:'nowrap' }}>
                      <button className="btn btn-ghost btn-xs" title="Ver / Editar" onClick={()=>verDetalle(oc)}>
                        <JxIcon name="eye" size={11}/>
                      </button>
                      {/* Confirmar OC: borrador → por_confirmar (descarga PDF auto) */}
                      {canApproveOC && oc.estado === 'borrador' && (
                        <button className="btn btn-amber btn-xs" title="Confirmar OC y descargar PDF para firma"
                          onClick={()=>confirmarOC(oc)} style={{ marginLeft:4 }}>
                          <JxIcon name="check" size={11}/> Confirmar
                        </button>
                      )}
                      {/* Re-descargar PDF (cualquier estado salvo cancelada) */}
                      <button className="btn btn-ghost btn-xs" title="Descargar PDF" onClick={async ()=>{
                        try {
                          const items = await window.__db.oc_items.where('orden_compra_id').equals(oc.id).filter(x=>!x.deleted_at).toArray();
                          const proveedor = lookupProv(oc.proveedor_id);
                          const obras = await window.__db.obras.toArray();
                          const obra = obras.find(o => o.id === oc.obra_id);
                          const companies = await window.__db.companies.toArray();
                          const company = companies.find(c => !c.deleted_at && c.status === 'activa');
                          window.__pdfs?.generateOCPdf?.(oc, items, proveedor, obra, company);
                          showToast('PDF generado', 'green');
                        } catch (e) { showToast('Error PDF: '+e.message, 'red'); }
                      }} style={{ marginLeft:4 }}>
                        <JxIcon name="download" size={11}/>
                      </button>
                      {/* Adjuntar OC firmada (visible en por_confirmar, firmada, enviada — no en borrador ni final) */}
                      {oc.estado !== 'cancelada' && oc.estado !== 'borrador' && oc.estado !== 'recibida' && (
                        <button className="btn btn-ghost btn-xs" title="Adjuntar OC firmada (PDF/foto)"
                          onClick={()=>fileInputRef.current?.openForOC(oc)} style={{ marginLeft:4 }}>
                          <JxIcon name="upload" size={11}/>
                        </button>
                      )}
                      {/* Cancelar OC */}
                      {canApproveOC && oc.estado !== 'cancelada' && oc.estado !== 'recibida' && (
                        <button className="btn btn-red btn-xs" title="Cancelar OC (con motivo)"
                          onClick={()=>cancelarOC(oc)} style={{ marginLeft:4 }}>
                          <JxIcon name="x" size={11}/>
                        </button>
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

      {/* Input file invisible para adjuntar OC firmada */}
      <input ref={(el) => {
        if (el && !el.openForOC) {
          el.openForOC = (oc) => {
            el._targetOc = oc;
            el.click();
          };
        }
        if (typeof fileInputRef === 'object' && fileInputRef !== null) fileInputRef.current = el;
      }}
        type="file" accept="application/pdf,image/*" style={{ display:'none' }}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          const oc = e.target._targetOc;
          if (!f || !oc) return;
          if (f.size > 10 * 1024 * 1024) { showToast('Archivo muy grande (máx 10 MB)', 'red'); return; }
          try {
            const evId = window.__newId();
            const now = new Date().toISOString();
            await window.__saveEvidenciaLocal?.({
              id: evId, obra_id: oc.obra_id,
              tipo_evidencia: 'oc_firmada',
              modulo_relacionado: 'ordenes_compra',
              registro_relacionado_id: oc.id,
              nombre_archivo: f.name, mime_type: f.type, blob: f,
              fecha: now.slice(0,10),
              observaciones: `OC firmada · ${oc.codigo}`,
              created_by: userId,
            });
            // Estado nuevo: por_confirmar → firmada (lo más común). Si ya estaba
            // firmada/enviada, se mantiene. Si era borrador (no debería pasar
            // porque el botón está oculto), también pasa a firmada.
            const nuevoEstado = (oc.estado === 'borrador' || oc.estado === 'por_confirmar') ? 'firmada' : oc.estado;
            await window.__db.ordenes_compra.update(oc.id, {
              estado: nuevoEstado,
              oc_firmada_evidencia_id: evId,
              firmada_at: now,
              firmada_por: userId,
              updated_at: now, updated_by: userId,
              version: (oc.version ?? 0) + 1,
              sync_status: oc.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
            });
            try { await window.__logAudit?.({ action:'update', table:'ordenes_compra', recordId: oc.id,
              oldData:{ estado: oc.estado }, newData:{ estado: nuevoEstado, evidencia_id: evId },
              reason:`OC ${oc.codigo} firmada — solicitante firmó y almacén adjuntó evidencia` }); } catch {}
            try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'ordenes_compra' } })); } catch {}
            // Notificación a compras: la OC está lista para ejecutarse (comprar al proveedor)
            try { window.dispatchEvent(new CustomEvent('jarvex_new_notif', {
              detail: {
                tipo: 'oc_firmada',
                titulo: `OC ${oc.codigo} firmada · lista para comprar`,
                descripcion: `${oc.codigo} fue firmada por el solicitante. Compras puede ejecutar la compra y luego subir la factura por Captura Mágica.`,
              }
            })); } catch {}
            showToast(`✓ OC firmada adjuntada · ${oc.codigo} ahora lista para comprar`, 'green');
          } catch (err) { showToast('Error: ' + (err.message || err), 'red'); }
          e.target.value = ''; // limpiar input
        }}/>

      {modal && (
        <Modal title={editing ? `OC ${form.codigo}` : 'Nueva Orden de Compra'} icon="package" onClose={()=>{setModal(null); setEditing(null); setItems([]); setRecepciones([]); setEvidenciasOC([]);}} wide>
          <div className="g2">
            <div>
              <label className="flabel">Código</label>
              <input className="fi" value={form.codigo||''} onChange={e=>setForm({...form, codigo:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Proveedor *</label>
              <select className="fi" value={form.proveedor_id||''} onChange={e=>setForm({...form, proveedor_id:e.target.value})}>
                {proveedores.map(p => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
              </select>
            </div>
            <div>
              <label className="flabel">Fecha</label>
              <input className="fi" type="date" value={form.fecha||''} onChange={e=>setForm({...form, fecha:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Fecha entrega</label>
              <input className="fi" type="date" value={form.fecha_entrega||''} onChange={e=>setForm({...form, fecha_entrega:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Moneda</label>
              <select className="fi" value={form.moneda||'PEN'} onChange={e=>setForm({...form, moneda:e.target.value})}>
                <option value="PEN">S/ (PEN)</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div>
              <label className="flabel">Condición de pago</label>
              <input className="fi" value={form.condicion_pago||''} onChange={e=>setForm({...form, condicion_pago:e.target.value})} placeholder="Ej: Contado / 30 días"/>
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <label className="flabel">Observaciones</label>
              <textarea className="fi" rows={2} value={form.observaciones||''} onChange={e=>setForm({...form, observaciones:e.target.value})}/>
            </div>
          </div>

          <div style={{ marginTop:14 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
              <strong style={{ fontSize:13 }}>Items</strong>
              <button className="btn btn-ghost btn-sm" onClick={addItem}><JxIcon name="plus" size={11}/>Agregar</button>
            </div>
            <div style={{ overflowX:'auto', maxHeight:280, border:'1px solid var(--border)', borderRadius:6 }}>
              <table className="tbl" style={{ fontSize:11 }}>
                <thead><tr>
                  <th>Material</th><th>Nombre libre</th><th style={{ width:70 }}>Unidad</th>
                  <th style={{ width:90, textAlign:'right' }}>Cantidad</th>
                  {editing && <th style={{ width:90, textAlign:'right' }}>Recibido</th>}
                  <th style={{ width:100, textAlign:'right' }}>P. Unit.</th>
                  <th style={{ width:100, textAlign:'right' }}>Subtotal</th>
                  <th style={{ width:32 }}></th>
                </tr></thead>
                <tbody>
                  {items.map((it,idx) => {
                    const sub = (Number(it.cantidad)||0) * (Number(it.precio_unitario)||0);
                    return (
                      <tr key={idx}>
                        <td>
                          <select className="fi" value={it.material_id||''} onChange={e=>{
                            const m = materiales?.find(x => x.id === e.target.value);
                            updateItem(idx, { material_id:e.target.value, unidad: m?.unidad || it.unidad, precio_unitario: it.precio_unitario || m?.precio_unitario_estimado || '' });
                          }} style={{ fontSize:11 }}>
                            <option value="">— libre —</option>
                            {(materiales || []).map(m => <option key={m.id} value={m.id}>{m.nombre_material}</option>)}
                          </select>
                        </td>
                        <td><input className="fi" disabled={!!it.material_id} value={it.nombre_libre||''} onChange={e=>updateItem(idx, { nombre_libre:e.target.value })} style={{ fontSize:11 }}/></td>
                        <td><input className="fi" value={it.unidad||''} onChange={e=>updateItem(idx, { unidad:e.target.value })} style={{ fontSize:11 }}/></td>
                        <td><input className="fi" type="number" min="0" step="0.01" value={it.cantidad||''} onChange={e=>updateItem(idx, { cantidad:e.target.value })} style={{ fontSize:11, textAlign:'right' }}/></td>
                        {editing && (
                          <td style={{ textAlign:'right', fontWeight:600 }}>
                            {(() => {
                              const rec = Number(it.cantidad_recibida || 0);
                              const tot = Number(it.cantidad || 0);
                              const pend = tot - rec;
                              const color = rec >= tot ? 'var(--green)' : rec > 0 ? 'var(--amber)' : 'var(--tm)';
                              return (
                                <span style={{ color }} title={pend > 0 ? `Pendiente: ${pend}` : 'Recibido completo'}>
                                  {rec.toFixed(2)} / {tot.toFixed(2)}
                                </span>
                              );
                            })()}
                          </td>
                        )}
                        <td><input className="fi" type="number" min="0" step="0.0001" value={it.precio_unitario||''} onChange={e=>updateItem(idx, { precio_unitario:e.target.value })} style={{ fontSize:11, textAlign:'right' }}/></td>
                        <td style={{ textAlign:'right', fontWeight:600 }}>{fmtS(sub)}</td>
                        <td><button className="btn btn-ghost btn-xs" onClick={()=>removeItem(idx)}><JxIcon name="trash" size={10}/></button></td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background:'rgba(0,0,0,0.15)' }}>
                    <td colSpan={editing ? 6 : 5} style={{ padding:'8px 12px', textAlign:'right', fontWeight:600 }}>Subtotal:</td>
                    <td style={{ textAlign:'right', fontWeight:700 }}>{fmtS(totales.subtotal)}</td>
                    <td/>
                  </tr>
                  <tr style={{ background:'rgba(0,0,0,0.10)' }}>
                    <td colSpan={editing ? 6 : 5} style={{ padding:'6px 12px', textAlign:'right' }}>IGV (18%):</td>
                    <td style={{ textAlign:'right' }}>{fmtS(totales.igv)}</td>
                    <td/>
                  </tr>
                  <tr style={{ background:'rgba(242,183,5,0.15)', fontWeight:700 }}>
                    <td colSpan={editing ? 6 : 5} style={{ padding:'8px 12px', textAlign:'right' }}>TOTAL:</td>
                    <td style={{ textAlign:'right', color:'var(--amber)' }}>{fmtS(totales.total)}</td>
                    <td/>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Recepciones formales y evidencias (solo en modo edición) */}
          {editing && (recepciones.length > 0 || evidenciasOC.length > 0) && (
            <div style={{ marginTop:14, paddingTop:14, borderTop:'1px solid var(--border)' }}>
              {recepciones.length > 0 && (
                <div style={{ marginBottom:14 }}>
                  <div style={{ fontSize:12.5, fontWeight:700, color:'var(--green)', marginBottom:6 }}>
                    📦 Recepciones formales ({recepciones.length})
                  </div>
                  <div style={{ overflow:'auto', maxHeight:180, border:'1px solid var(--border)', borderRadius:6 }}>
                    <table className="tbl" style={{ fontSize:11 }}>
                      <thead><tr>
                        <th>Fecha</th><th>Guía remisión</th><th>Factura</th>
                        <th style={{ textAlign:'right' }}>Items</th>
                        <th>Observaciones</th>
                      </tr></thead>
                      <tbody>
                        {recepciones.map(r => {
                          const conDiff = (r.items || []).some(it => Math.abs(Number(it.diferencia_precio_pct || 0)) >= 5);
                          return (
                            <tr key={r.id}>
                              <td className="col-m">{r.fecha || '—'}</td>
                              <td style={{ fontFamily:'monospace' }}>{r.guia_remision || '—'}</td>
                              <td style={{ fontFamily:'monospace' }}>{r.factura_ref || '—'}</td>
                              <td style={{ textAlign:'right' }}>
                                {(r.items || []).length}
                                {conDiff && <span style={{ marginLeft:4, color:'var(--amber)' }} title="Con diferencias de precio ≥5%">⚠</span>}
                              </td>
                              <td style={{ fontSize:10.5, color:'var(--tm)' }}>{r.observaciones || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {evidenciasOC.length > 0 && (
                <div>
                  <div style={{ fontSize:12.5, fontWeight:700, color:'var(--blue)', marginBottom:6 }}>
                    📎 Facturas / evidencias ({evidenciasOC.length})
                  </div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                    {evidenciasOC.map(e => (
                      <button key={e.id} type="button" className="btn btn-ghost btn-sm"
                        title={`${e.nombre_archivo || 'archivo'} · ${(e.tamano_bytes/1024/1024).toFixed(2)} MB`}
                        onClick={async () => {
                          try {
                            const blobId = e.blob_ref || e.id;
                            const row = await window.__db.evidencias_blobs.get(blobId);
                            if (!row?.blob) { showToast('Archivo no disponible localmente', 'red'); return; }
                            const url = URL.createObjectURL(row.blob);
                            window.open(url, '_blank');
                            setTimeout(() => URL.revokeObjectURL(url), 60000);
                          } catch (err) { showToast('Error abriendo archivo: ' + (err.message || err), 'red'); }
                        }}>
                        <JxIcon name="image" size={12}/>
                        <span style={{ marginLeft:6, fontSize:11 }}>{e.nombre_archivo || 'archivo'}</span>
                        <span style={{ marginLeft:4, fontSize:10, color:'var(--tm)' }}>· {e.fecha || ''}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="modal-actions">
            <button className="btn btn-ghost" disabled={busyOC} onClick={()=>{setModal(null); setEditing(null); setItems([]); setRecepciones([]); setEvidenciasOC([]);}}>Cancelar</button>
            <button className="btn btn-amber" disabled={busyOC} onClick={guardar}>
              <JxIcon name="check" size={13}/>{busyOC ? 'Guardando…' : (editing ? 'Guardar' : 'Crear OC')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { RequisicionesPage, OrdenesCompraPage });
