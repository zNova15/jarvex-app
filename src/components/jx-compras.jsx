import React from "react";
import { useBusy } from "../hooks/useBusy.js";
import { proximoCodigo, TIPO_ORDEN_LABEL } from "../lib/ordenes.js";
import { titularContableDeObra } from "../lib/consorcio.js";
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
  pendiente: 'b-amber', pendiente_aprobacion: 'b-amber',
  aprobada: 'b-green', aprobada_parcial: 'b-amber', rechazada: 'b-red',
  ordenada: 'b-blue', recibida_parcial: 'b-amber',
  recibida: 'b-green', cancelada: 'b-red',
};
const REQ_ESTADO_LABEL = {
  borrador: 'Borrador', solicitada: 'Solicitada', cotizando: 'Cotizando',
  pendiente: 'Pendiente', pendiente_aprobacion: 'Pendiente',
  aprobada: 'Aceptada', aprobada_parcial: 'Aceptada parcial', rechazada: 'Rechazada',
  ordenada: 'Ordenada', recibida_parcial: 'Recib. parcial',
  recibida: 'Recibida', cancelada: 'Cancelada',
};
const PRIORIDAD_COLOR = { baja:'var(--tm)', normal:'var(--ts)', alta:'var(--amber)', urgente:'var(--red)' };
// Estados que cuentan como "esperando revisión".
const REQ_PENDIENTE = new Set(['pendiente', 'pendiente_aprobacion', 'solicitada']);
const TIPO_INSUMO_LABEL = { material:'Material', herramienta:'Herramienta', epp:'EPP', emergencia:'Emergencia', maquinaria:'Maquinaria' };
const nombreItem = (it) => it?.nombre || it?.descripcion || it?.nombre_libre || '—';

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

// Genera una Orden de Compra (estado 'aceptada') a partir de una requisición
// aprobada. Usa la cantidad_aprobada del ítem (aceptación parcial) o la
// cantidad pedida. Copia tipo_insumo/nombre. Devuelve { ocId, codigo } o null.
async function generarOCDesdeRequisicionAprobada(req, reqItems, obraId, userId) {
  const validos = (reqItems || []).filter(it => !it.deleted_at && Number(it.cantidad_aprobada ?? it.cantidad) > 0);
  if (!validos.length) return null;
  // Tanda 5: la OC nace con DUEÑO. Antes el código era global (`OC-2026-001`
  // contando todas las órdenes del grupo) y no decía qué RUC la emite — con lo
  // cual no había plantilla ni serie posible. El titular contable de la obra
  // (el consorcio ejecutor, o la empresa si es de una sola) es quien la emite.
  const yr = new Date().getFullYear();
  const todasOC = (await window.__db.ordenes_compra.toArray()).filter(o => !o.deleted_at);
  let company = null;
  try {
    const obra = await window.__db.obras.get(obraId);
    const consorcios = await window.__db.consorcios.toArray();
    const cid = titularContableDeObra(obra, consorcios);
    if (cid) company = await window.__db.companies.get(cid);
  } catch { /* sin empresa la orden igual se crea: la numera la serie sin dueño */ }
  const { codigo, correlativo, anio } = proximoCodigo(todasOC, { company, tipo: 'compra', anio: yr });
  const ocId = window.__newId();
  const now = new Date().toISOString();
  let subtotal = 0;
  validos.forEach(it => { subtotal += Number(it.precio_estimado || 0) * Number(it.cantidad_aprobada ?? it.cantidad ?? 0); });
  const igv = +(subtotal * 0.18).toFixed(2);
  await window.__db.ordenes_compra.add({
    id: ocId, obra_id: obraId,
    codigo, correlativo, anio,
    tipo: 'compra',
    company_id: company?.id || null,
    requisicion_id: req.id,
    requisicion_codigo: req.codigo,
    proveedor_id: null,
    fecha: now.slice(0, 10),
    fecha_entrega: req.fecha_necesidad || req.fecha_requerida || null,
    moneda: 'PEN',
    condicion_pago: 'contado',
    estado: 'aceptada',
    monto_subtotal: +subtotal.toFixed(2),
    monto_igv: igv,
    monto_total: +(subtotal + igv).toFixed(2),
    observaciones: `Aceptada desde Solicitud ${req.codigo}${req.descripcion ? ' · ' + req.descripcion : ''}`,
    created_by: userId, updated_by: userId,
    created_at: now, updated_at: now,
    version: 1, sync_status: 'pending_create', last_synced_at: null,
    idempotency_key: `${userId}_oc_${ocId}`,
  });
  for (const it of validos) {
    const id = window.__newId();
    const cant = Number(it.cantidad_aprobada ?? it.cantidad);
    await window.__db.oc_items.add({
      id, orden_compra_id: ocId,
      tipo_insumo: it.tipo_insumo || 'material',
      insumo_id: it.insumo_id || it.material_id || null,
      insumo_pendiente_id: it.insumo_pendiente_id || null,
      material_id: it.material_id || (it.tipo_insumo === 'material' ? it.insumo_id : null) || null,
      nombre: nombreItem(it),
      nombre_libre: (it.material_id || it.insumo_id) ? null : nombreItem(it),
      unidad: it.unidad || null,
      cantidad: cant,
      cantidad_recibida: 0,
      precio_unitario: Number(it.precio_estimado || 0),
      subtotal: +(cant * Number(it.precio_estimado || 0)).toFixed(2),
      requisicion_item_id: it.id,
      created_at: now, updated_at: now,
      version: 1, sync_status: 'pending_create', last_synced_at: null,
      idempotency_key: `${userId}_oc_item_${id}`,
    });
  }
  return { ocId, codigo };
}

// ╔════════════════════════════════════════════════════════════╗
// ║  REQUISICIONES  (Solicitudes de Insumos + revisión)        ║
// ╚════════════════════════════════════════════════════════════╝
function RequisicionesPage({ showToast }) {
  const obraId = useObraActiva();
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id ?? 'offline';
  const userName = `${auth?.profile?.nombres || ''} ${auth?.profile?.apellidos || ''}`.trim() || auth?.profile?.email || '';
  const rol = auth?.profile?.rol || '';
  const isAdmin = rol === 'admin';
  // Revisor: admin, o un rol con write en 'Requisiciones' Y 'Órdenes de Compra'
  // (aceptar GENERA una OC → sin write en OC esa orden nunca se sube: quedaría
  // FAILED). Por defecto solo el admin revisa, como pidió Gabriel.
  const esRevisor = isAdmin || ((window.__hasPerm?.(rol, 'Requisiciones', 'w') ?? false) && (window.__hasPerm?.(rol, 'Órdenes de Compra', 'w') ?? false));
  const [busyGuardar, , setBusyGuardar] = useBusy();

  const { data: requisiciones } = window.__hooks.useRequisiciones(obraId);

  const [tab, setTab] = uS(esRevisor ? 'pendientes' : 'mias');
  const [busqueda, setBusqueda] = uS('');
  const [filtroEstado, setFiltroEstado] = uS('todos');

  // Edición de la solicitud propia (edit-once).
  const [editModal, setEditModal] = uS(null);   // requisición en edición
  const [form, setForm] = uS({});
  const [items, setItems] = uS([]);

  // Revisión (revisor): aceptar / denegar / parcial.
  const [revisando, setRevisando] = uS(null);
  const [revItems, setRevItems] = uS([]);
  const [revMotivo, setRevMotivo] = uS('');
  const [revParcial, setRevParcial] = uS(false);
  const [revObs, setRevObs] = uS('');
  const [revBusy, setRevBusy] = uS(false);

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

  const misReqs = uM(() => (requisiciones || []).filter(r => r.solicitante_id === userId || r.created_by === userId), [requisiciones, userId]);
  const pendientes = uM(() => (requisiciones || []).filter(r => REQ_PENDIENTE.has(r.estado)), [requisiciones]);

  const sorted = uM(() => {
    let f = tab === 'pendientes' ? [...pendientes] : [...misReqs];
    if (filtroEstado !== 'todos') f = f.filter(r => r.estado === filtroEstado);
    if (busqueda) {
      const q = busqueda.toLowerCase();
      f = f.filter(r =>
        (r.codigo||'').toLowerCase().includes(q) ||
        (r.notas||'').toLowerCase().includes(q) ||
        (r.razon||'').toLowerCase().includes(q) ||
        (r.responsable_nombre||'').toLowerCase().includes(q) ||
        (r.descripcion||'').toLowerCase().includes(q)
      );
    }
    return f.sort((a,b) => (b.fecha||'').localeCompare(a.fecha||''));
  }, [misReqs, pendientes, tab, filtroEstado, busqueda]);

  const cargarItems = async (reqId) => {
    try {
      return await window.__db.requisicion_items.where('requisicion_id').equals(reqId).filter(x => !x.deleted_at).toArray();
    } catch { return []; }
  };

  // ── Edición de solicitud propia (edit-once) ──
  const abrirEditar = async (r) => {
    setForm({
      descripcion: r.descripcion || '',
      razon: r.razon || '',
      prioridad: r.prioridad || 'normal',
      fecha_necesidad: r.fecha_necesidad || r.fecha_requerida || '',
      fecha_urgente: r.fecha_urgente || '',
    });
    setItems(await cargarItems(r.id));
    setEditModal(r);
  };
  const puedeEditar = (r) => (r.solicitante_id === userId || r.created_by === userId) && REQ_PENDIENTE.has(r.estado) && Number(r.veces_editada || 0) < 1;

  const guardarEdicion = async () => {
    if (busyGuardar || !editModal) return;
    if ((form.razon || '').trim().length < 3) { showToast('La razón no puede quedar vacía', 'red'); return; }
    setBusyGuardar(true);
    const now = new Date().toISOString();
    try {
      await window.__db.requisiciones.update(editModal.id, {
        descripcion: form.descripcion || null,
        razon: (form.razon || '').trim(),
        prioridad: form.prioridad,
        fecha_necesidad: form.fecha_necesidad || null,
        fecha_requerida: form.fecha_necesidad || null,
        fecha_urgente: form.fecha_urgente || null,
        veces_editada: Number(editModal.veces_editada || 0) + 1,
        updated_at: now, updated_by: userId,
        version: (editModal.version ?? 0) + 1,
        sync_status: editModal.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      // Actualizar cantidades de los ítems editados
      for (const it of items) {
        await window.__db.requisicion_items.update(it.id, {
          cantidad: Number(it.cantidad) || 0,
          cantidad_minima: Number(it.cantidad_minima) > 0 ? Number(it.cantidad_minima) : null,
          unidad: it.unidad || null,
          updated_at: now,
          version: (it.version ?? 0) + 1,
          sync_status: it.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'requisiciones' } })); } catch {}
      showToast('Solicitud actualizada (1 edición usada)', 'green');
      setEditModal(null);
    } catch (e) { showToast('Error: ' + (e.message||e), 'red'); }
    finally { setBusyGuardar(false); }
  };

  const eliminar = async (r) => {
    if (!(r.solicitante_id === userId || r.created_by === userId || isAdmin)) return;
    if (!confirm(`¿Eliminar la solicitud ${r.codigo}?`)) return;
    try {
      await window.__db.requisiciones.update(r.id, {
        deleted_at: new Date().toISOString(),
        sync_status: r.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'requisiciones' } })); } catch {}
      showToast('Solicitud eliminada', 'amber');
    } catch (e) { showToast('Error: '+e.message,'red'); }
  };

  // ── Revisión (revisor) ──
  const abrirRevision = async (r) => {
    const its = await cargarItems(r.id);
    setRevItems(its.map(it => ({ ...it, cantidad_aprobada: it.cantidad })));
    setRevMotivo(''); setRevParcial(false); setRevObs('');
    setRevisando(r);
  };

  const setRevItemCant = (id, val) => setRevItems(prev => prev.map(it => it.id === id ? { ...it, cantidad_aprobada: val } : it));

  const denegar = async () => {
    if (revBusy || !revisando) return;
    if (revMotivo.trim().length < 5) { showToast('Indicá el motivo del rechazo (mín 5 caracteres)', 'red'); return; }
    setRevBusy(true);
    const now = new Date().toISOString();
    try {
      await window.__db.requisiciones.update(revisando.id, {
        estado: 'rechazada',
        motivo_revision: revMotivo.trim(),
        motivo_rechazo: revMotivo.trim(),
        revisor_id: userId, revisor_nombre: userName, revisado_at: now,
        updated_at: now, updated_by: userId,
        version: (revisando.version ?? 0) + 1,
        sync_status: revisando.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      try { await window.__logAudit?.({ action:'update', table:'requisiciones', recordId:revisando.id, oldData:{ estado:revisando.estado }, newData:{ estado:'rechazada', motivo:revMotivo.trim() }, reason:`Solicitud ${revisando.codigo} rechazada` }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'requisiciones' } })); } catch {}
      try { window.dispatchEvent(new CustomEvent('jarvex_new_notif', { detail:{ tipo:'requisicion', titulo:`Solicitud ${revisando.codigo} rechazada`, descripcion: revMotivo.trim().slice(0,120) } })); } catch {}
      showToast(`Solicitud ${revisando.codigo} rechazada`, 'amber');
      setRevisando(null);
    } catch (e) { showToast('Error: '+(e.message||e), 'red'); }
    finally { setRevBusy(false); }
  };

  const aceptar = async () => {
    if (revBusy || !revisando) return;
    if (revMotivo.trim().length < 5) { showToast('Indicá el motivo de la aceptación (mín 5 caracteres)', 'red'); return; }
    // Validar cantidades aprobadas
    const aprobados = [];
    for (const it of revItems) {
      const aprob = revParcial ? Number(it.cantidad_aprobada) : Number(it.cantidad);
      if (revParcial) {
        if (!(aprob >= 0)) { showToast(`Cantidad aprobada inválida en "${nombreItem(it)}"`, 'red'); return; }
        if (aprob > Number(it.cantidad)) { showToast(`No podés aprobar más de lo pedido en "${nombreItem(it)}"`, 'red'); return; }
      }
      aprobados.push({ ...it, cantidad_aprobada: aprob });
    }
    const conCantidad = aprobados.filter(it => Number(it.cantidad_aprobada) > 0);
    if (!conCantidad.length) { showToast('Al menos un ítem debe quedar con cantidad aprobada > 0', 'red'); return; }
    if (revParcial && revObs.trim().length < 5) { showToast('En aceptación parcial, detallá las observaciones (mín 5)', 'red'); return; }
    setRevBusy(true);
    const now = new Date().toISOString();
    try {
      // 1) Persistir cantidad_aprobada por ítem
      for (const it of aprobados) {
        await window.__db.requisicion_items.update(it.id, {
          cantidad_aprobada: Number(it.cantidad_aprobada),
          updated_at: now,
          version: (it.version ?? 0) + 1,
          sync_status: it.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
      }
      // 2) Estado de la requisición
      const estadoNuevo = revParcial ? 'aprobada_parcial' : 'aprobada';
      // 3) Generar OC de los ítems con cantidad > 0
      const oc = await generarOCDesdeRequisicionAprobada(revisando, conCantidad, obraId, userId);
      await window.__db.requisiciones.update(revisando.id, {
        estado: estadoNuevo,
        motivo_revision: revMotivo.trim(),
        observaciones_parcial: revParcial ? revObs.trim() : null,
        revisor_id: userId, revisor_nombre: userName, revisado_at: now,
        oc_id: oc?.ocId || null, oc_codigo: oc?.codigo || null,
        updated_at: now, updated_by: userId,
        version: (revisando.version ?? 0) + 1,
        sync_status: revisando.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      try { await window.__logAudit?.({ action:'update', table:'requisiciones', recordId:revisando.id, oldData:{ estado:revisando.estado }, newData:{ estado:estadoNuevo, oc:oc?.codigo }, reason:`Solicitud ${revisando.codigo} aceptada${revParcial?' (parcial)':''} → ${oc?.codigo || 'sin OC'}` }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'ordenes_compra' } })); window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'requisiciones' } })); } catch {}
      try { window.dispatchEvent(new CustomEvent('jarvex_new_notif', { detail:{ tipo:'requisicion', titulo:`Solicitud ${revisando.codigo} aceptada${revParcial?' (parcial)':''}`, descripcion: oc ? `Se generó la orden ${oc.codigo}` : 'Sin ítems para orden' } })); } catch {}
      showToast(`✓ Aceptada · ${oc ? `orden ${oc.codigo} generada` : 'sin OC'}`, 'green');
      setRevisando(null);
    } catch (e) { showToast('Error: '+(e.message||e), 'red'); }
    finally { setRevBusy(false); }
  };

  const descargarPdf = async (r) => {
    try {
      const its = await cargarItems(r.id);
      const obras = await window.__db.obras.toArray();
      const obra = obras.find(o => o.id === r.obra_id);
      const companies = await window.__db.companies.toArray();
      const company = companies.find(c => !c.deleted_at && c.status === 'activa') || companies[0];
      window.__pdfs?.generateRequisicionPdf?.(r, its, obra, r.responsable_nombre || r.solicitante_nombre || '', company);
      showToast('PDF generado', 'green');
    } catch (e) { showToast('Error PDF: '+e.message, 'red'); }
  };

  const updItem = (idx, patch) => setItems(items.map((it,i) => i===idx ? { ...it, ...patch } : it));

  if (!obraId) return <div className="page-wrap"><div className="empty-state"><JxIcon name="package" size={32} color="var(--tm)"/><p>Selecciona una obra activa.</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Requisiciones</div>
          <div className="pg-sub">
            {tab === 'pendientes' ? `${sorted.length} solicitud(es) esperando revisión` : `${sorted.length} solicitud(es) tuya(s) · las pendientes se pueden editar (1 vez) o eliminar`}
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={()=>window.__navTo?.('solicitud-residente')} title="Cargar una nueva solicitud de insumos">
          <JxIcon name="plus" size={13}/> Nueva solicitud
        </button>
      </div>

      {/* Pestañas */}
      <div style={{ display:'flex', gap:6, marginBottom:14, borderBottom:'1px solid var(--border)' }}>
        <button className="btn btn-ghost btn-sm" onClick={()=>setTab('mias')}
          style={{ borderRadius:0, borderBottom: tab==='mias'?'2px solid var(--amber)':'2px solid transparent', color: tab==='mias'?'var(--amber)':'var(--tm)', fontWeight: tab==='mias'?700:500 }}>
          <JxIcon name="user" size={13}/> Mis Solicitudes
        </button>
        {esRevisor && (
          <button className="btn btn-ghost btn-sm" onClick={()=>setTab('pendientes')}
            style={{ borderRadius:0, borderBottom: tab==='pendientes'?'2px solid var(--amber)':'2px solid transparent', color: tab==='pendientes'?'var(--amber)':'var(--tm)', fontWeight: tab==='pendientes'?700:500 }}>
            <JxIcon name="shield" size={13}/> Pendientes de Revisión {pendientes.length > 0 && <span className="badge b-amber" style={{ marginLeft:4 }}>{pendientes.length}</span>}
          </button>
        )}
      </div>

      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:14 }}>
        <div className="search-bar" style={{ flex:'1 1 200px' }}><JxIcon name="search" size={14} color="var(--tm)"/><input placeholder="Buscar código, responsable, razón…" value={busqueda} onChange={e=>setBusqueda(e.target.value)}/></div>
        <select className="fi" value={filtroEstado} onChange={e=>setFiltroEstado(e.target.value)} style={{ minWidth:140 }}>
          <option value="todos">Todos los estados</option>
          {['pendiente','aprobada','aprobada_parcial','rechazada','ordenada','recibida','cancelada'].map(k => <option key={k} value={k}>{REQ_ESTADO_LABEL[k]}</option>)}
        </select>
      </div>

      {sorted.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="package" size={40} color="var(--tm)"/>
          <p>{tab==='pendientes' ? 'No hay solicitudes pendientes de revisión.' : 'No tenés solicitudes. Cargá una desde "Solicitud de Insumos".'}</p>
        </div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <div style={{ overflowX:'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Código</th>
                <th>Descripción / Responsable</th>
                <th style={{ textAlign:'center' }}>Ítems</th>
                <th>Deseada</th>
                <th>Prioridad</th>
                <th>Estado</th>
                <th>Razón / Motivo revisión</th>
                <th style={{ textAlign:'center' }}>Acciones</th>
              </tr></thead>
              <tbody>
                {sorted.map(r => {
                  const itemsCount = itemsCountById?.[r.id] ?? 0;
                  const esPend = REQ_PENDIENTE.has(r.estado);
                  return (
                  <tr key={r.id}>
                    <td className="col-m" style={{ fontFamily:'monospace' }}><strong>{r.codigo || '—'}</strong>{r.oc_codigo && <div style={{ fontSize:10, color:'var(--green)' }}>→ {r.oc_codigo}</div>}</td>
                    <td className="col-p" style={{ maxWidth:280 }}>
                      <div style={{ fontWeight:600, color:'var(--tp)' }}>{r.descripcion || <span style={{ color:'var(--tm)' }}>(sin descripción)</span>}</div>
                      {(r.responsable_nombre || r.solicitante_nombre) && <div style={{ fontSize:10.5, color:'var(--tm)' }}>Solicita: {r.responsable_nombre || r.solicitante_nombre}</div>}
                    </td>
                    <td style={{ textAlign:'center' }}><span className="badge b-blue">{itemsCount}</span></td>
                    <td className="col-m">{r.fecha_necesidad || r.fecha_requerida || '—'}{r.fecha_urgente && <div style={{ fontSize:10, color:'var(--red)' }}>urg: {r.fecha_urgente}</div>}</td>
                    <td><span style={{ color: PRIORIDAD_COLOR[r.prioridad], fontWeight:600, textTransform:'uppercase', fontSize:11 }}>{r.prioridad}</span></td>
                    <td><span className={`badge ${REQ_ESTADO_BADGE[r.estado] || 'b-gray'}`}>{REQ_ESTADO_LABEL[r.estado] || r.estado}</span></td>
                    <td style={{ fontSize:11, maxWidth:280, whiteSpace:'normal' }}>
                      {r.razon ? <div>{r.razon}</div> : null}
                      {r.motivo_revision && <div style={{ color: r.estado==='rechazada'?'var(--red)':'var(--amber)', marginTop:2 }}><strong>{r.estado==='rechazada'?'Rechazo':'Nota'}:</strong> {r.motivo_revision}</div>}
                      {r.observaciones_parcial && <div style={{ color:'var(--amber)', marginTop:2 }}><strong>Parcial:</strong> {r.observaciones_parcial}</div>}
                    </td>
                    <td style={{ textAlign:'center', whiteSpace:'nowrap' }}>
                      {tab==='pendientes' && esRevisor && esPend && (
                        <button className="btn btn-amber btn-xs" title="Revisar (aceptar / denegar)" onClick={()=>abrirRevision(r)}>
                          <JxIcon name="shield" size={11}/> Revisar
                        </button>
                      )}
                      <button className="btn btn-ghost btn-xs" title="Descargar PDF" onClick={()=>descargarPdf(r)} style={{ marginLeft:4 }}>
                        <JxIcon name="download" size={11}/>
                      </button>
                      {tab==='mias' && puedeEditar(r) && (
                        <button className="btn btn-ghost btn-xs" title="Editar (1 sola vez)" onClick={()=>abrirEditar(r)} style={{ marginLeft:4 }}>
                          <JxIcon name="edit" size={11}/>
                        </button>
                      )}
                      {tab==='mias' && esPend && (r.solicitante_id===userId || r.created_by===userId) && (
                        <button className="btn btn-red btn-xs" title="Eliminar solicitud" onClick={()=>eliminar(r)} style={{ marginLeft:4 }}>
                          <JxIcon name="trash" size={11}/>
                        </button>
                      )}
                      {tab==='mias' && !puedeEditar(r) && esPend && Number(r.veces_editada||0) >= 1 && (
                        <span style={{ fontSize:10, color:'var(--tm)', marginLeft:6 }} title="Ya usaste tu edición">✎ usada</span>
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

      {/* Modal editar solicitud propia */}
      {editModal && (
        <Modal title={`Editar solicitud ${editModal.codigo}`} icon="edit" onClose={()=>setEditModal(null)} wide>
          <div style={{ background:'rgba(242,183,5,0.08)', border:'1px solid rgba(242,183,5,0.3)', borderRadius:6, padding:'8px 12px', marginBottom:12, fontSize:11.5, color:'var(--ts)' }}>
            Podés hacer <strong>una sola edición</strong>. Después de guardar, la solicitud queda bloqueada hasta la revisión.
          </div>
          <div className="g2">
            <div style={{ gridColumn:'1/-1' }}>
              <label className="flabel">Descripción</label>
              <input className="fi" value={form.descripcion||''} onChange={e=>setForm({...form, descripcion:e.target.value})}/>
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <label className="flabel">Razón del requerimiento *</label>
              <textarea className="fi" rows={2} value={form.razon||''} onChange={e=>setForm({...form, razon:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Prioridad</label>
              <select className="fi" value={form.prioridad||'normal'} onChange={e=>setForm({...form, prioridad:e.target.value})}>
                <option value="baja">Baja</option><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option>
              </select>
            </div>
            <div>
              <label className="flabel">Fecha deseada</label>
              <input className="fi" type="date" value={form.fecha_necesidad||''} onChange={e=>setForm({...form, fecha_necesidad:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Fecha urgente (opcional)</label>
              <input className="fi" type="date" value={form.fecha_urgente||''} max={form.fecha_necesidad||undefined} onChange={e=>setForm({...form, fecha_urgente:e.target.value})}/>
            </div>
          </div>
          <div style={{ marginTop:14 }}>
            <strong style={{ fontSize:13 }}>Ítems ({items.length})</strong>
            <div style={{ overflowX:'auto', maxHeight:260, border:'1px solid var(--border)', borderRadius:6, marginTop:8 }}>
              <table className="tbl" style={{ fontSize:11 }}>
                <thead><tr><th>Tipo</th><th>Insumo</th><th style={{ width:90, textAlign:'right' }}>Cantidad</th><th style={{ width:90, textAlign:'right' }}>Mín.</th><th style={{ width:70 }}>Unidad</th></tr></thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={it.id}>
                      <td>{TIPO_INSUMO_LABEL[it.tipo_insumo] || 'Material'}</td>
                      <td>{nombreItem(it)}</td>
                      <td><input className="fi" type="number" min="0" step="0.01" value={it.cantidad||''} onChange={e=>updItem(idx,{ cantidad:e.target.value })} style={{ textAlign:'right', fontSize:11 }}/></td>
                      <td><input className="fi" type="number" min="0" step="0.01" value={it.cantidad_minima||''} onChange={e=>updItem(idx,{ cantidad_minima:e.target.value })} style={{ textAlign:'right', fontSize:11 }}/></td>
                      <td><input className="fi" value={it.unidad||''} onChange={e=>updItem(idx,{ unidad:e.target.value })} style={{ fontSize:11 }}/></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" disabled={busyGuardar} onClick={()=>setEditModal(null)}>Cancelar</button>
            <button className="btn btn-amber" disabled={busyGuardar} onClick={guardarEdicion}>
              <JxIcon name="check" size={13}/>{busyGuardar ? 'Guardando…' : 'Guardar (usa mi edición)'}
            </button>
          </div>
        </Modal>
      )}

      {/* Modal revisión (revisor) */}
      {revisando && (
        <Modal title={`Revisar ${revisando.codigo}`} icon="shield" onClose={()=>setRevisando(null)} wide>
          <div className="g2" style={{ marginBottom:10 }}>
            <div><div style={{ fontSize:11, color:'var(--tm)' }}>Solicita</div><div style={{ fontSize:13, fontWeight:600 }}>{revisando.responsable_nombre || revisando.solicitante_nombre || '—'}</div></div>
            <div><div style={{ fontSize:11, color:'var(--tm)' }}>Prioridad · fecha deseada</div><div style={{ fontSize:13, fontWeight:600, textTransform:'uppercase' }}>{revisando.prioridad} · <span style={{ textTransform:'none' }}>{revisando.fecha_necesidad || revisando.fecha_requerida || '—'}</span>{revisando.fecha_urgente && <span style={{ color:'var(--red)', textTransform:'none' }}> · urgente {revisando.fecha_urgente}</span>}</div></div>
            <div style={{ gridColumn:'1/-1' }}><div style={{ fontSize:11, color:'var(--tm)' }}>Razón del requerimiento</div><div style={{ fontSize:12.5, color:'var(--ts)' }}>{revisando.razon || '—'}</div></div>
          </div>

          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
            <strong style={{ fontSize:13 }}>Ítems ({revItems.length})</strong>
            <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:'var(--ts)', cursor:'pointer' }}>
              <input type="checkbox" checked={revParcial} onChange={e=>setRevParcial(e.target.checked)}/> Aceptación parcial (ajustar cantidades)
            </label>
          </div>
          <div style={{ overflowX:'auto', maxHeight:260, border:'1px solid var(--border)', borderRadius:6 }}>
            <table className="tbl" style={{ fontSize:11 }}>
              <thead><tr><th>Tipo</th><th>Insumo</th><th style={{ textAlign:'right' }}>Pedido</th><th style={{ width:70 }}>Unidad</th>{revParcial && <th style={{ width:110, textAlign:'right' }}>Aprobar</th>}</tr></thead>
              <tbody>
                {revItems.map(it => (
                  <tr key={it.id}>
                    <td>{TIPO_INSUMO_LABEL[it.tipo_insumo] || 'Material'}</td>
                    <td>{nombreItem(it)}{it.insumo_pendiente_id && <span className="badge b-amber" style={{ marginLeft:4, fontSize:9 }}>nuevo</span>}{it.cantidad_minima ? <div style={{ fontSize:10, color:'var(--tm)' }}>mín urgente: {it.cantidad_minima}</div> : null}</td>
                    <td style={{ textAlign:'right' }}>{it.cantidad} {it.unidad || ''}</td>
                    <td>{it.unidad || '—'}</td>
                    {revParcial && <td><input className="fi" type="number" min="0" max={it.cantidad} step="0.01" value={it.cantidad_aprobada} onChange={e=>setRevItemCant(it.id, e.target.value)} style={{ textAlign:'right', fontSize:11 }}/></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop:12 }}>
            <label className="flabel">Motivo de la decisión * <span style={{ color:'var(--tm)', fontWeight:400 }}>(obligatorio para aceptar o denegar)</span></label>
            <textarea className="fi" rows={2} value={revMotivo} onChange={e=>setRevMotivo(e.target.value)} placeholder="Ej: Procede — es urgente para el vaciado / No procede — el frente aún no arranca."/>
          </div>
          {revParcial && (
            <div style={{ marginTop:10 }}>
              <label className="flabel">Observaciones de la aceptación parcial *</label>
              <textarea className="fi" rows={2} value={revObs} onChange={e=>setRevObs(e.target.value)} placeholder="Ej: Se aprueba menos cantidad porque hay stock parcial en otro almacén."/>
            </div>
          )}

          <div className="modal-actions">
            <button className="btn btn-ghost" disabled={revBusy} onClick={()=>setRevisando(null)}>Cancelar</button>
            <button className="btn btn-red" disabled={revBusy} onClick={denegar}><JxIcon name="x" size={13}/>{revBusy?'…':'Denegar'}</button>
            <button className="btn btn-green" disabled={revBusy} onClick={aceptar}><JxIcon name="check" size={13}/>{revBusy?'…':(revParcial?'Aceptar parcial y generar OC':'Aceptar y generar OC')}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ╔════════════════════════════════════════════════════════════╗
// ║  ÓRDENES DE COMPRA                                         ║
// ╚════════════════════════════════════════════════════════════╝
// Flujo: la OC nace 'aceptada' desde una solicitud aprobada. El delegado
// asigna proveedor y precios, confirma (PDF para firma), adjunta la firmada,
// la envía al proveedor y recibe. Puede ANULARSE con motivo en cualquier
// momento antes de recibirse.
const OC_ESTADO_BADGE = {
  borrador: 'b-gray', por_confirmar: 'b-amber', firmada: 'b-blue', enviada: 'b-blue',
  aceptada: 'b-green', recibida_parcial: 'b-amber', recibida: 'b-green',
  anulada: 'b-red', cancelada: 'b-red',
};
const OC_ESTADO_LABEL = {
  borrador: 'Borrador', por_confirmar: 'Por confirmar (firma)', firmada: 'Firmada', enviada: 'Enviada',
  aceptada: 'Aceptada', recibida_parcial: 'Comprada parcial', recibida: 'Comprada',
  anulada: 'Anulada', cancelada: 'Anulada',
};
const OC_ANULADA = new Set(['anulada', 'cancelada']);

// La empresa cuya marca lleva el PDF: la que EMITE la orden. Se prefiere el
// `company_id` de la propia orden (las nuevas lo traen); para las viejas cae
// en la ejecutora de la obra, y recién si no hay ninguna, en la primera activa
// del grupo — que es lo que hacía SIEMPRE antes de la tanda 5.
async function companyDeOC(oc, fallback) {
  try {
    if (oc?.company_id) {
      const c = await window.__db.companies.get(oc.company_id);
      if (c) return c;
    }
  } catch {}
  if (fallback) return fallback;
  try {
    const companies = await window.__db.companies.toArray();
    return companies.find(c => !c.deleted_at && c.status === 'activa') || companies[0] || {};
  } catch { return {}; }
}
// Estados a los que un delegado puede llevar la OC MANUALMENTE (dropdown). No
// incluye 'anulada'/'aceptada'/'borrador': anular tiene su propio botón (pide
// motivo + libera la requisición) y aceptada/borrador son estados de origen.
const OC_ESTADOS_MANUALES = ['por_confirmar', 'firmada', 'enviada', 'recibida_parcial', 'recibida'];

function OrdenesCompraPage({ showToast }) {
  const obraId = useObraActiva();
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id ?? 'offline';
  const rol = auth?.profile?.rol || '';
  const isAdmin = rol === 'admin';
  const canApproveOC = isAdmin || (window.__hasPerm?.(rol, 'Órdenes de Compra', 'w') ?? false);
  const [busyOC, , setBusyOC] = useBusy();
  const { data: ocs } = window.__hooks.useOrdenesCompra(obraId);
  const { data: materiales } = window.__hooks.useMateriales(obraId);
  const [proveedores, setProveedores] = uS([]);
  uE(() => { window.__db.proveedores.toArray().then(setProveedores); }, []);
  // La empresa que EMITE: el titular contable de la obra (el consorcio
  // ejecutor, o la empresa si la obra es de una sola). Define la serie del
  // correlativo y la marca del PDF — tanda 5.
  const { data: obrasTodas } = window.__hooks.useObras();
  const { data: consorcios } = window.__hooks.useConsorcios?.() || { data: [] };
  const { data: companies } = window.__hooks.useCompanies();
  const obraActual = uM(() => (obrasTodas || []).find(o => o.id === obraId) || null, [obrasTodas, obraId]);
  const companyEmisora = uM(() => {
    const cid = titularContableDeObra(obraActual, consorcios || []);
    return cid ? ((companies || []).find(c => c.id === cid) || null) : null;
  }, [obraActual, consorcios, companies]);
  const fileInputRef = React.useRef(null);

  const confirmarOC = async (oc) => {
    if (!['borrador','aceptada'].includes(oc.estado)) { showToast('Solo se confirma una OC aceptada o en borrador', 'amber'); return; }
    if (!oc.proveedor_id) { showToast('Asigná el proveedor (y precios) antes de confirmar — abrí la OC con 👁', 'red'); return; }
    try {
      const items = await window.__db.oc_items.where('orden_compra_id').equals(oc.id).filter(x=>!x.deleted_at).toArray();
      if (!items.length) { showToast('La OC no tiene ítems', 'red'); return; }
      const now = new Date().toISOString();
      await window.__db.ordenes_compra.update(oc.id, {
        estado: 'por_confirmar', confirmada_at: now, confirmada_por: userId,
        updated_at: now, updated_by: userId,
        version: (oc.version ?? 0) + 1,
        sync_status: oc.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      try {
        const proveedor = lookupProv(oc.proveedor_id);
        const obras = await window.__db.obras.toArray();
        const obra = obras.find(o => o.id === oc.obra_id);
        // La marca del PDF es la de la empresa que EMITE la orden (tanda 5).
        // Antes era «la primera empresa activa del grupo»: una OC del
        // CONSORCIO EL INCA salía con el logo de la que estuviera primero.
        const company = await companyDeOC(oc, companyEmisora);
        window.__pdfs?.generateOrdenPdf?.(oc, items, { company, obra, proveedor });
      } catch (e) { console.warn('[OC confirmar] PDF', e); }
      try { await window.__logAudit?.({ action:'update', table:'ordenes_compra', recordId: oc.id, oldData:{ estado: oc.estado }, newData:{ estado: 'por_confirmar' }, reason:`OC ${oc.codigo} confirmada — PDF para firma` }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'ordenes_compra' } })); } catch {}
      showToast(`✓ OC ${oc.codigo} confirmada · PDF descargado`, 'green');
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  const anularOC = async (oc) => {
    const motivo = prompt(`Motivo de anulación de la OC ${oc.codigo}:\n(ej: "el solicitante canceló", "se compró por otro medio")`);
    if (!motivo || motivo.trim().length < 5) { showToast('Motivo requerido (mín 5 caracteres)', 'red'); return; }
    try {
      const now = new Date().toISOString();
      await window.__db.ordenes_compra.update(oc.id, {
        estado: 'anulada', motivo_anulacion: motivo.trim(), anulado_por: userId, anulado_at: now,
        updated_at: now, updated_by: userId,
        version: (oc.version ?? 0) + 1,
        sync_status: oc.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      // Liberar la requisición de origen (vuelve a aprobada, sin OC).
      if (oc.requisicion_id) {
        const req = await window.__db.requisiciones.get(oc.requisicion_id);
        if (req && req.oc_id === oc.id) {
          await window.__db.requisiciones.update(oc.requisicion_id, {
            oc_id: null, oc_codigo: null,
            updated_at: now,
            version: (req.version ?? 0) + 1,
            sync_status: req.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
          });
          try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'requisiciones' } })); } catch {}
        }
      }
      try { await window.__logAudit?.({ action:'update', table:'ordenes_compra', recordId: oc.id, oldData:{ estado: oc.estado }, newData:{ estado:'anulada', motivo }, reason: `Anulación OC ${oc.codigo}: ${motivo}` }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'ordenes_compra' } })); } catch {}
      showToast(`OC ${oc.codigo} anulada`, 'amber');
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  const [modal, setModal] = uS(null);
  const [editing, setEditing] = uS(null);
  const [form, setForm] = uS({});
  const [items, setItems] = uS([]);
  const [recepciones, setRecepciones] = uS([]);
  const [evidenciasOC, setEvidenciasOC] = uS([]);
  const [busqueda, setBusqueda] = uS('');
  const [filtroEstado, setFiltroEstado] = uS('todos');
  // 'aceptadas' (activas) | 'anuladas' | 'compradas'
  const [vista, setVista] = uS('aceptadas');

  const ESTADOS_ACTIVOS = ['aceptada','borrador','por_confirmar','firmada','enviada','recibida_parcial'];

  const sorted = uM(() => {
    let f = [...(ocs || [])];
    if (vista === 'aceptadas') f = f.filter(o => ESTADOS_ACTIVOS.includes(o.estado));
    else if (vista === 'anuladas') f = f.filter(o => OC_ANULADA.has(o.estado));
    else if (vista === 'compradas') f = f.filter(o => o.estado === 'recibida');
    if (filtroEstado !== 'todos') f = f.filter(o => o.estado === filtroEstado);
    if (busqueda) {
      const q = busqueda.toLowerCase();
      f = f.filter(o => (o.codigo||'').toLowerCase().includes(q) || (o.proveedor_nombre||'').toLowerCase().includes(q) || (o.requisicion_codigo||'').toLowerCase().includes(q));
    }
    return f.sort((a,b) => (b.fecha||'').localeCompare(a.fecha||''));
  }, [ocs, filtroEstado, busqueda, vista]);

  const conteoActivas = uM(() => (ocs||[]).filter(o => ESTADOS_ACTIVOS.includes(o.estado)).length, [ocs]);
  const conteoAnuladas = uM(() => (ocs||[]).filter(o => OC_ANULADA.has(o.estado)).length, [ocs]);

  const [ocItemsCount, setOcItemsCount] = uS({});
  const [ocItemsPendientes, setOcItemsPendientes] = uS({});
  uE(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const all = await window.__db.oc_items.filter(x => !x.deleted_at).toArray();
        const totales = {}; const pendientes = {};
        for (const it of all) {
          totales[it.orden_compra_id] = (totales[it.orden_compra_id] || 0) + 1;
          if (Number(it.cantidad_recibida || 0) < Number(it.cantidad || 0)) pendientes[it.orden_compra_id] = (pendientes[it.orden_compra_id] || 0) + 1;
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

  // El correlativo es POR EMPRESA, TIPO y AÑO (tanda 5): el mismo cálculo que
  // usa el registro documental, para que las dos puertas no numeren distinto.
  const nextCodigo = uM(
    () => proximoCodigo(ocs || [], { company: companyEmisora, tipo: form.tipo || 'compra' }).codigo,
    [ocs, companyEmisora, form.tipo]
  );

  const openNueva = () => {
    if (!proveedores.length) { showToast('Creá proveedores primero', 'red'); return; }
    setForm({ codigo: nextCodigo, tipo: 'compra', proveedor_id: proveedores[0].id, fecha: new Date().toISOString().slice(0,10), fecha_entrega: '', moneda: 'PEN', condicion_pago: 'contado', estado: 'aceptada', observaciones: '' });
    setItems([{ material_id:'', nombre:'', unidad:'', cantidad:'', precio_unitario:'', tipo_insumo:'material' }]);
    setEditing(null); setModal(true);
  };

  const verDetalle = async (oc) => {
    setEditing(oc);
    setForm({ codigo: oc.codigo, tipo: oc.tipo || 'compra', proveedor_id: oc.proveedor_id, fecha: oc.fecha, fecha_entrega: oc.fecha_entrega || '', moneda: oc.moneda, condicion_pago: oc.condicion_pago || '', estado: oc.estado, observaciones: oc.observaciones || '' });
    try { setItems(await window.__db.oc_items.where('orden_compra_id').equals(oc.id).filter(x=>!x.deleted_at).toArray()); } catch { setItems([]); }
    try {
      const recs = await window.__db.recepciones.where('orden_compra_id').equals(oc.id).filter(x=>!x.deleted_at).toArray();
      const recsConItems = await Promise.all(recs.map(async r => ({ ...r, items: await window.__db.recepcion_items.where('recepcion_id').equals(r.id).filter(x=>!x.deleted_at).toArray() })));
      setRecepciones(recsConItems.sort((a,b) => (b.fecha||'').localeCompare(a.fecha||'')));
    } catch { setRecepciones([]); }
    try {
      const evs = await window.__db.evidencias.where('modulo_relacionado').equals('ordenes_compra').filter(e => e.registro_relacionado_id === oc.id && !e.deleted_at).toArray();
      setEvidenciasOC(evs.sort((a,b) => (b.fecha||'').localeCompare(a.fecha||'')));
    } catch { setEvidenciasOC([]); }
    setModal(true);
  };

  const totales = uM(() => {
    let subtotal = 0;
    items.forEach(i => { subtotal += (Number(i.cantidad)||0) * (Number(i.precio_unitario)||0); });
    const igv = +(subtotal * 0.18).toFixed(2);
    return { subtotal: +subtotal.toFixed(2), igv, total: +(subtotal + igv).toFixed(2) };
  }, [items]);

  const guardar = async () => {
    if (busyOC) return;
    const itemsValidos = items.filter(i => (i.material_id || i.nombre || i.nombre_libre) && Number(i.cantidad) > 0 && Number(i.precio_unitario) > 0);
    if (!itemsValidos.length) { showToast('Agregá al menos un ítem con cantidad y precio', 'red'); return; }
    setBusyOC(true);
    const now = new Date().toISOString();
    try {
      let ocId;
      if (editing) {
        ocId = editing.id;
        await window.__db.ordenes_compra.update(ocId, { ...form, fecha_entrega: form.fecha_entrega || null, monto_subtotal: totales.subtotal, monto_igv: totales.igv, monto_total: totales.total, updated_at: now, updated_by: userId, version: (editing.version ?? 0) + 1, sync_status: editing.sync_status === 'pending_create' ? 'pending_create' : 'pending_update' });
        const oldItems = await window.__db.oc_items.where('orden_compra_id').equals(ocId).toArray();
        for (const oi of oldItems) await window.__db.oc_items.update(oi.id, { deleted_at: now, sync_status: 'pending_delete' });
      } else {
        ocId = window.__newId();
        const num = proximoCodigo(ocs || [], { company: companyEmisora, tipo: form.tipo || 'compra' });
        await window.__db.ordenes_compra.add({ id: ocId, obra_id: obraId, codigo: form.codigo || num.codigo, correlativo: num.correlativo, anio: num.anio, tipo: form.tipo || 'compra', company_id: companyEmisora?.id || null, proveedor_id: form.proveedor_id, fecha: form.fecha, fecha_entrega: form.fecha_entrega || null, monto_subtotal: totales.subtotal, monto_igv: totales.igv, monto_total: totales.total, moneda: form.moneda, condicion_pago: form.condicion_pago || null, estado: form.estado, observaciones: form.observaciones || null, created_by: userId, updated_by: userId, created_at: now, updated_at: now, version: 1, sync_status: 'pending_create', last_synced_at: null, idempotency_key: `${userId}_oc_${ocId}` });
      }
      for (const i of itemsValidos) {
        const id = window.__newId();
        const c = Number(i.cantidad); const p = Number(i.precio_unitario);
        await window.__db.oc_items.add({ id, orden_compra_id: ocId, tipo_insumo: i.tipo_insumo || 'material', insumo_id: i.insumo_id || i.material_id || null, insumo_pendiente_id: i.insumo_pendiente_id || null, requisicion_item_id: i.requisicion_item_id || null, material_id: i.material_id || null, nombre: i.nombre || i.nombre_libre || null, nombre_libre: i.material_id ? null : (i.nombre || i.nombre_libre || null), unidad: i.unidad || null, cantidad: c, cantidad_recibida: i.cantidad_recibida || 0, precio_unitario: p, subtotal: +(c*p).toFixed(2), created_at: now, updated_at: now, version: 1, sync_status: 'pending_create', last_synced_at: null, idempotency_key: `${userId}_oc_item_${id}` });
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'ordenes_compra' } })); window.dispatchEvent(new Event('online')); } catch {}
      showToast(editing ? 'OC actualizada' : `OC ${form.codigo} creada por ${fmtS(totales.total)}`, 'green');
      setModal(null); setEditing(null); setItems([]);
    } catch (e) { console.error('[oc save]', e); showToast('Error: ' + (e.message || e), 'red'); }
    finally { setBusyOC(false); }
  };

  const cambiarEstado = async (oc, nuevo) => {
    if (!canApproveOC) { showToast('Solo delegados pueden cambiar el estado de la OC', 'red'); return; }
    try {
      await window.__db.ordenes_compra.update(oc.id, { estado: nuevo, updated_at: new Date().toISOString(), version: (oc.version ?? 0) + 1, sync_status: oc.sync_status === 'pending_create' ? 'pending_create' : 'pending_update' });
      try { window.__logAudit?.({ action:'update', table:'ordenes_compra', recordId:oc.id, oldData:{ estado:oc.estado }, newData:{ estado:nuevo }, reason:`Cambio de estado de OC ${oc.codigo}` }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'ordenes_compra' } })); } catch {}
    } catch (e) { showToast('Error: '+e.message, 'red'); }
  };

  const addItem = () => setItems([...items, { material_id:'', nombre:'', unidad:'', cantidad:'', precio_unitario:'', tipo_insumo:'material' }]);
  const removeItem = (idx) => setItems(items.filter((_,i) => i !== idx));
  const updateItem = (idx, patch) => setItems(items.map((it,i) => i===idx ? { ...it, ...patch } : it));

  const descargarOCPdf = async (oc) => {
    try {
      const its = await window.__db.oc_items.where('orden_compra_id').equals(oc.id).filter(x=>!x.deleted_at).toArray();
      const proveedor = lookupProv(oc.proveedor_id);
      const obras = await window.__db.obras.toArray();
      const obra = obras.find(o => o.id === oc.obra_id);
      const company = await companyDeOC(oc, companyEmisora);
      window.__pdfs?.generateOrdenPdf?.(oc, its, { company, obra, proveedor });
      showToast('PDF generado', 'green');
    } catch (e) { showToast('Error PDF: '+e.message, 'red'); }
  };

  if (!obraId) return <div className="page-wrap"><div className="empty-state"><JxIcon name="package" size={32} color="var(--tm)"/><p>Selecciona una obra activa.</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Órdenes de Compra</div>
          <div className="pg-sub">{sorted.length} órdenes · total {fmtSk(sorted.reduce((s,o)=>s+Number(o.monto_total||0),0))}</div>
        </div>
        {canApproveOC && (
          <button className="btn btn-amber btn-sm" onClick={openNueva}><JxIcon name="plus" size={13}/>Nueva OC</button>
        )}
      </div>

      <div style={{ display:'flex', gap:6, marginBottom:10, flexWrap:'wrap' }}>
        {/* Al cambiar de pestaña, reseteo el filtro de estado: si no, un filtro
            (ej. 'enviada') dejaba la pestaña Anuladas vacía sin explicación. */}
        <button className={`btn btn-sm ${vista === 'aceptadas' ? 'btn-amber' : 'btn-ghost'}`} onClick={()=>{ setVista('aceptadas'); setFiltroEstado('todos'); }}>Aceptadas ({conteoActivas})</button>
        <button className={`btn btn-sm ${vista === 'anuladas' ? 'btn-amber' : 'btn-ghost'}`} onClick={()=>{ setVista('anuladas'); setFiltroEstado('todos'); }}>Anuladas ({conteoAnuladas})</button>
        <button className={`btn btn-sm ${vista === 'compradas' ? 'btn-amber' : 'btn-ghost'}`} onClick={()=>{ setVista('compradas'); setFiltroEstado('todos'); }}>✓ Compradas</button>
      </div>

      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:14 }}>
        <div className="search-bar" style={{ flex:'1 1 200px' }}><JxIcon name="search" size={14} color="var(--tm)"/><input placeholder="Buscar código o solicitud…" value={busqueda} onChange={e=>setBusqueda(e.target.value)}/></div>
        <select className="fi" value={filtroEstado} onChange={e=>setFiltroEstado(e.target.value)} style={{ minWidth:140 }}>
          <option value="todos">Todos los estados</option>
          {Object.entries(OC_ESTADO_LABEL).filter(([k])=>k!=='cancelada').map(([k,v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {sorted.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="package" size={40} color="var(--tm)"/>
          <p>No hay órdenes de compra en esta vista.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <div style={{ overflowX:'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Código</th><th>Proveedor / Solicitud</th>
                <th style={{ textAlign:'center' }}>Ítems</th><th>Fecha</th><th>Entrega</th>
                <th style={{ textAlign:'right' }}>Monto</th><th>Estado</th>
                <th style={{ textAlign:'center' }}>Acciones</th>
              </tr></thead>
              <tbody>
                {sorted.map(oc => {
                  const itemsN = ocItemsCount[oc.id] ?? 0;
                  const itemsPend = ocItemsPendientes[oc.id] ?? 0;
                  const provLabel = lookupProv(oc.proveedor_id)?.razon_social || oc.proveedor_nombre || '(asignar proveedor)';
                  const anulada = OC_ANULADA.has(oc.estado);
                  return (
                  <tr key={oc.id} style={anulada ? { opacity:0.65 } : undefined}>
                    <td className="col-m" style={{ fontFamily:'monospace' }}><strong>{oc.codigo || '—'}</strong></td>
                    <td className="col-p" style={{ maxWidth:240 }}>
                      <div style={{ fontWeight:600, color: lookupProv(oc.proveedor_id) ? 'var(--tp)' : 'var(--tm)' }}>{provLabel}</div>
                      {oc.requisicion_codigo && <div style={{ fontSize:10, color:'var(--tm)' }}>desde {oc.requisicion_codigo}</div>}
                      {anulada && oc.motivo_anulacion && <div style={{ fontSize:10, color:'var(--red)' }}>Anulada: {oc.motivo_anulacion}</div>}
                    </td>
                    <td style={{ textAlign:'center' }}>
                      <span className="badge b-blue">{itemsN}</span>
                      {itemsPend > 0 && <div style={{ fontSize:10, color:'var(--amber)', fontWeight:600 }}>⏳ {itemsPend} pend.</div>}
                    </td>
                    <td className="col-m">{oc.fecha}</td>
                    <td className="col-m">{oc.fecha_entrega || '—'}</td>
                    <td style={{ textAlign:'right', fontWeight:700, color:'var(--blue)' }} className="col-num">{fmtS(oc.monto_total || 0)}</td>
                    <td>
                      {canApproveOC && !anulada ? (
                        <select className="fi" value={oc.estado} onChange={e=>cambiarEstado(oc, e.target.value)} style={{ fontSize:11, padding:'4px 6px' }}>
                          {/* Estado actual (siempre visible) + transiciones manuales permitidas. */}
                          {[...new Set([oc.estado, ...OC_ESTADOS_MANUALES])].map(k => <option key={k} value={k}>{OC_ESTADO_LABEL[k] || k}</option>)}
                        </select>
                      ) : (
                        <span className={`badge ${OC_ESTADO_BADGE[oc.estado] || 'b-gray'}`}>{OC_ESTADO_LABEL[oc.estado] || oc.estado}</span>
                      )}
                    </td>
                    <td style={{ textAlign:'center', whiteSpace:'nowrap' }}>
                      <button className="btn btn-ghost btn-xs" title="Ver / Editar" onClick={()=>verDetalle(oc)}><JxIcon name="eye" size={11}/></button>
                      {canApproveOC && !anulada && ['borrador','aceptada'].includes(oc.estado) && (
                        <button className="btn btn-amber btn-xs" title="Confirmar y descargar PDF para firma" onClick={()=>confirmarOC(oc)} style={{ marginLeft:4 }}><JxIcon name="check" size={11}/> Confirmar</button>
                      )}
                      <button className="btn btn-ghost btn-xs" title="Descargar PDF" onClick={()=>descargarOCPdf(oc)} style={{ marginLeft:4 }}><JxIcon name="download" size={11}/></button>
                      {!anulada && oc.estado !== 'borrador' && oc.estado !== 'recibida' && (
                        <button className="btn btn-ghost btn-xs" title="Adjuntar OC firmada (PDF/foto)" onClick={()=>fileInputRef.current?.openForOC(oc)} style={{ marginLeft:4 }}><JxIcon name="upload" size={11}/></button>
                      )}
                      {canApproveOC && !anulada && oc.estado !== 'recibida' && (
                        <button className="btn btn-red btn-xs" title="Anular OC (con motivo)" onClick={()=>anularOC(oc)} style={{ marginLeft:4 }}><JxIcon name="x" size={11}/></button>
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

      <input ref={(el) => {
        if (el && !el.openForOC) { el.openForOC = (oc) => { el._targetOc = oc; el.click(); }; }
        if (typeof fileInputRef === 'object' && fileInputRef !== null) fileInputRef.current = el;
      }}
        type="file" accept="application/pdf,image/*" style={{ display:'none' }}
        onChange={async (e) => {
          const f = e.target.files?.[0]; const oc = e.target._targetOc;
          if (!f || !oc) return;
          if (f.size > 10 * 1024 * 1024) { showToast('Archivo muy grande (máx 10 MB)', 'red'); return; }
          try {
            const evId = window.__newId(); const now = new Date().toISOString();
            await window.__saveEvidenciaLocal?.({ id: evId, obra_id: oc.obra_id, tipo_evidencia: 'oc_firmada', modulo_relacionado: 'ordenes_compra', registro_relacionado_id: oc.id, nombre_archivo: f.name, mime_type: f.type, blob: f, fecha: now.slice(0,10), observaciones: `OC firmada · ${oc.codigo}`, created_by: userId });
            const nuevoEstado = (oc.estado === 'borrador' || oc.estado === 'por_confirmar' || oc.estado === 'aceptada') ? 'firmada' : oc.estado;
            await window.__db.ordenes_compra.update(oc.id, { estado: nuevoEstado, oc_firmada_evidencia_id: evId, firmada_at: now, firmada_por: userId, updated_at: now, updated_by: userId, version: (oc.version ?? 0) + 1, sync_status: oc.sync_status === 'pending_create' ? 'pending_create' : 'pending_update' });
            try { await window.__logAudit?.({ action:'update', table:'ordenes_compra', recordId: oc.id, oldData:{ estado: oc.estado }, newData:{ estado: nuevoEstado, evidencia_id: evId }, reason:`OC ${oc.codigo} firmada` }); } catch {}
            try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'ordenes_compra' } })); } catch {}
            showToast(`✓ OC firmada adjuntada · ${oc.codigo}`, 'green');
          } catch (err) { showToast('Error: ' + (err.message || err), 'red'); }
          e.target.value = '';
        }}/>

      {modal && (
        <Modal title={editing ? `OC ${form.codigo}` : 'Nueva Orden de Compra'} icon="package" onClose={()=>{setModal(null); setEditing(null); setItems([]); setRecepciones([]); setEvidenciasOC([]);}} wide>
          <div className="g2">
            <div><label className="flabel">Código</label><input className="fi" value={form.codigo||''} onChange={e=>setForm({...form, codigo:e.target.value})}/></div>
            <div>
              <label className="flabel">Tipo de orden</label>
              <select className="fi" value={form.tipo || 'compra'} disabled={!!editing}
                onChange={e=>setForm({...form, tipo:e.target.value, codigo: proximoCodigo(ocs || [], { company: companyEmisora, tipo: e.target.value }).codigo })}>
                <option value="compra">{TIPO_ORDEN_LABEL.compra}</option>
                <option value="servicio">{TIPO_ORDEN_LABEL.servicio}</option>
              </select>
            </div>
            <div style={{ gridColumn:'1/-1', fontSize:11, color:'var(--tm)', marginTop:-4 }}>
              Emite: <strong style={{ color:'var(--tp)' }}>{companyEmisora?.name || 'sin empresa ejecutora definida en la obra'}</strong>
              {' '}— su logo y su RUC van en el PDF, y el correlativo es de SU serie.
            </div>
            <div>
              <label className="flabel">Proveedor *</label>
              <select className="fi" value={form.proveedor_id||''} onChange={e=>setForm({...form, proveedor_id:e.target.value})}>
                <option value="">— asignar —</option>
                {proveedores.map(p => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
              </select>
            </div>
            <div><label className="flabel">Fecha</label><input className="fi" type="date" value={form.fecha||''} onChange={e=>setForm({...form, fecha:e.target.value})}/></div>
            <div><label className="flabel">Fecha entrega</label><input className="fi" type="date" value={form.fecha_entrega||''} onChange={e=>setForm({...form, fecha_entrega:e.target.value})}/></div>
            <div><label className="flabel">Moneda</label><select className="fi" value={form.moneda||'PEN'} onChange={e=>setForm({...form, moneda:e.target.value})}><option value="PEN">S/ (PEN)</option><option value="USD">USD</option></select></div>
            <div><label className="flabel">Condición de pago</label><input className="fi" value={form.condicion_pago||''} onChange={e=>setForm({...form, condicion_pago:e.target.value})} placeholder="Contado / 30 días"/></div>
            <div style={{ gridColumn:'1/-1' }}><label className="flabel">Observaciones</label><textarea className="fi" rows={2} value={form.observaciones||''} onChange={e=>setForm({...form, observaciones:e.target.value})}/></div>
          </div>

          <div style={{ marginTop:14 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
              <strong style={{ fontSize:13 }}>Ítems</strong>
              <button className="btn btn-ghost btn-sm" onClick={addItem}><JxIcon name="plus" size={11}/>Agregar</button>
            </div>
            <div style={{ overflowX:'auto', maxHeight:280, border:'1px solid var(--border)', borderRadius:6 }}>
              <table className="tbl" style={{ fontSize:11 }}>
                <thead><tr>
                  <th>Insumo</th><th style={{ width:70 }}>Unidad</th>
                  <th style={{ width:90, textAlign:'right' }}>Cantidad</th>
                  {editing && <th style={{ width:90, textAlign:'right' }}>Recibido</th>}
                  <th style={{ width:100, textAlign:'right' }}>P. Unit.</th>
                  <th style={{ width:100, textAlign:'right' }}>Subtotal</th>
                  <th style={{ width:32 }}></th>
                </tr></thead>
                <tbody>
                  {items.map((it,idx) => {
                    const sub = (Number(it.cantidad)||0) * (Number(it.precio_unitario)||0);
                    const nom = it.nombre || it.nombre_libre || (materiales?.find(m=>m.id===it.material_id)?.nombre_material) || '';
                    return (
                      <tr key={idx}>
                        <td><input className="fi" value={nom} onChange={e=>updateItem(idx, { nombre:e.target.value, material_id:'' })} placeholder="Nombre del insumo" style={{ fontSize:11 }}/></td>
                        <td><input className="fi" value={it.unidad||''} onChange={e=>updateItem(idx, { unidad:e.target.value })} style={{ fontSize:11 }}/></td>
                        <td><input className="fi" type="number" min="0" step="0.01" value={it.cantidad||''} onChange={e=>updateItem(idx, { cantidad:e.target.value })} style={{ fontSize:11, textAlign:'right' }}/></td>
                        {editing && (
                          <td style={{ textAlign:'right', fontWeight:600 }}>
                            {(() => { const rec = Number(it.cantidad_recibida || 0); const tot = Number(it.cantidad || 0); const color = rec >= tot ? 'var(--green)' : rec > 0 ? 'var(--amber)' : 'var(--tm)'; return <span style={{ color }}>{rec.toFixed(2)} / {tot.toFixed(2)}</span>; })()}
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
                  <tr style={{ background:'var(--bg-c2)' }}><td colSpan={editing ? 4 : 3} style={{ padding:'8px 12px', textAlign:'right', fontWeight:600 }}>Subtotal:</td><td style={{ textAlign:'right', fontWeight:700 }}>{fmtS(totales.subtotal)}</td><td/></tr>
                  <tr style={{ background:'var(--tint-neutral)' }}><td colSpan={editing ? 4 : 3} style={{ padding:'6px 12px', textAlign:'right' }}>IGV (18%):</td><td style={{ textAlign:'right' }}>{fmtS(totales.igv)}</td><td/></tr>
                  <tr style={{ background:'rgba(242,183,5,0.15)', fontWeight:700 }}><td colSpan={editing ? 4 : 3} style={{ padding:'8px 12px', textAlign:'right' }}>TOTAL:</td><td style={{ textAlign:'right', color:'var(--amber)' }}>{fmtS(totales.total)}</td><td/></tr>
                </tfoot>
              </table>
            </div>
          </div>

          {editing && (recepciones.length > 0 || evidenciasOC.length > 0) && (
            <div style={{ marginTop:14, paddingTop:14, borderTop:'1px solid var(--border)' }}>
              {recepciones.length > 0 && (
                <div style={{ marginBottom:14 }}>
                  <div style={{ fontSize:12.5, fontWeight:700, color:'var(--green)', marginBottom:6 }}>📦 Recepciones ({recepciones.length})</div>
                  <div style={{ overflow:'auto', maxHeight:180, border:'1px solid var(--border)', borderRadius:6 }}>
                    <table className="tbl" style={{ fontSize:11 }}>
                      <thead><tr><th>Fecha</th><th>Guía</th><th>Factura</th><th style={{ textAlign:'right' }}>Ítems</th><th>Obs.</th></tr></thead>
                      <tbody>{recepciones.map(r => (<tr key={r.id}><td className="col-m">{r.fecha || '—'}</td><td style={{ fontFamily:'monospace' }}>{r.guia_remision || '—'}</td><td style={{ fontFamily:'monospace' }}>{r.factura_ref || '—'}</td><td style={{ textAlign:'right' }}>{(r.items || []).length}</td><td style={{ fontSize:10.5, color:'var(--tm)' }}>{r.observaciones || '—'}</td></tr>))}</tbody>
                    </table>
                  </div>
                </div>
              )}
              {evidenciasOC.length > 0 && (
                <div>
                  <div style={{ fontSize:12.5, fontWeight:700, color:'var(--blue)', marginBottom:6 }}>📎 Adjuntos ({evidenciasOC.length})</div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                    {evidenciasOC.map(e => (
                      <button key={e.id} type="button" className="btn btn-ghost btn-sm" onClick={async () => {
                        try { const blobId = e.blob_ref || e.id; const row = await window.__db.evidencias_blobs.get(blobId); if (!row?.blob) { showToast('Archivo no disponible localmente', 'red'); return; } const url = URL.createObjectURL(row.blob); window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60000); } catch (err) { showToast('Error abriendo archivo: ' + (err.message || err), 'red'); }
                      }}><JxIcon name="image" size={12}/><span style={{ marginLeft:6, fontSize:11 }}>{e.nombre_archivo || 'archivo'}</span></button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="modal-actions">
            <button className="btn btn-ghost" disabled={busyOC} onClick={()=>{setModal(null); setEditing(null); setItems([]); setRecepciones([]); setEvidenciasOC([]);}}>Cerrar</button>
            {canApproveOC && (
              <button className="btn btn-amber" disabled={busyOC} onClick={guardar}><JxIcon name="check" size={13}/>{busyOC ? 'Guardando…' : (editing ? 'Guardar' : 'Crear OC')}</button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { RequisicionesPage, OrdenesCompraPage });
