import React from "react";
const { useState: uS, useMemo: uM, useEffect: uE } = React;

// ─── DATA ───────────────────────────────────────────────
const MAT_DATA = [
  { id:'MAT-001', nombre:'Cemento Portland Tipo I', cat:'Aglomerantes', unidad:'Bolsa', stock:8, minimo:50, entradas:480, salidas:472, estado:'critico', proveedor:'PACASMAYO SAC', obs:'' },
  { id:'MAT-002', nombre:'Fierro 3/8" x 9m', cat:'Acero', unidad:'Barra', stock:12, minimo:100, entradas:350, salidas:338, estado:'critico', proveedor:'Aceros Arequipa', obs:'' },
  { id:'MAT-003', nombre:'Fierro 1/2" x 9m', cat:'Acero', unidad:'Barra', stock:64, minimo:80, entradas:200, salidas:136, estado:'reponer', proveedor:'Aceros Arequipa', obs:'' },
  { id:'MAT-004', nombre:'Ladrillo King Kong 18H', cat:'Albañilería', unidad:'Millar', stock:4.5, minimo:2, entradas:12, salidas:7.5, estado:'ok', proveedor:'Ladrillos Fortes', obs:'' },
  { id:'MAT-005', nombre:'Arena Gruesa', cat:'Agregados', unidad:'M³', stock:22, minimo:10, entradas:80, salidas:58, estado:'ok', proveedor:'Canteras del Sur', obs:'' },
  { id:'MAT-006', nombre:'Piedra Chancada 1/2"', cat:'Agregados', unidad:'M³', stock:18, minimo:15, entradas:60, salidas:42, estado:'ok', proveedor:'Canteras del Sur', obs:'' },
  { id:'MAT-007', nombre:'Agua Destilada', cat:'Insumos', unidad:'Litro', stock:0, minimo:100, entradas:500, salidas:500, estado:'sinstock', proveedor:'—', obs:'Solicitar urgente' },
  { id:'MAT-008', nombre:'Tubo PVC 4" Desagüe', cat:'Sanitario', unidad:'Und', stock:35, minimo:20, entradas:80, salidas:45, estado:'ok', proveedor:'Mexichem Perú', obs:'' },
  { id:'MAT-009', nombre:'Cable TW 2.5mm²', cat:'Eléctrico', unidad:'Metro', stock:420, minimo:200, entradas:800, salidas:380, estado:'ok', proveedor:'Indeco SA', obs:'' },
  { id:'MAT-010', nombre:'Madera Tornillo 2x3', cat:'Encofrado', unidad:'Pie²', stock:210, minimo:300, entradas:600, salidas:390, estado:'reponer', proveedor:'Madereras Lima', obs:'Reordenar esta semana' },
  { id:'MAT-011', nombre:'Alambre #16', cat:'Acero', unidad:'Kg', stock:85, minimo:50, entradas:200, salidas:115, estado:'ok', proveedor:'Aceros Arequipa', obs:'' },
  { id:'MAT-012', nombre:'Pintura Látex Blanco', cat:'Acabados', unidad:'Galón', stock:28, minimo:20, entradas:60, salidas:32, estado:'ok', proveedor:'Sherwin Williams', obs:'' },
];

const HERR_DATA = [
  { id:'HRR-001', nombre:'Amoladora Bosch 7"', tipo:'Eléctrica', estado:'bueno', ubicacion:'en-uso', disponible:false, responsable:'Carlos Quispe', fecha:'26/04/2026', obs:'' },
  { id:'HRR-002', nombre:'Amoladora Dewalt 4.5"', tipo:'Eléctrica', estado:'regular', ubicacion:'almacen', disponible:true, responsable:'—', fecha:'24/04/2026', obs:'Disco desgastado' },
  { id:'HRR-003', nombre:'Taladro Percutor Bosch', tipo:'Eléctrica', estado:'nuevo', ubicacion:'en-uso', disponible:false, responsable:'Juan Flores', fecha:'26/04/2026', obs:'' },
  { id:'HRR-004', nombre:'Nivel Láser NL-200', tipo:'Medición', estado:'bueno', ubicacion:'almacen', disponible:true, responsable:'—', fecha:'23/04/2026', obs:'' },
  { id:'HRR-005', nombre:'Andamio Tubular x4', tipo:'Estructura', estado:'regular', ubicacion:'en-uso', disponible:false, responsable:'Frente B', fecha:'20/04/2026', obs:'' },
  { id:'HRR-006', nombre:'Mezcladora 200L', tipo:'Maquinaria', estado:'mantenimiento', ubicacion:'mantenimiento', disponible:false, responsable:'—', fecha:'22/04/2026', obs:'Cambio de faja' },
  { id:'HRR-007', nombre:'Vibradora de Concreto', tipo:'Maquinaria', estado:'bueno', ubicacion:'en-uso', disponible:false, responsable:'Pedro Lima', fecha:'26/04/2026', obs:'' },
  { id:'HRR-008', nombre:'Compactadora Manual', tipo:'Maquinaria', estado:'bueno', ubicacion:'almacen', disponible:true, responsable:'—', fecha:'18/04/2026', obs:'' },
  { id:'HRR-009', nombre:'Cortadora de Fierro', tipo:'Eléctrica', estado:'malo', ubicacion:'baja', disponible:false, responsable:'—', fecha:'10/04/2026', obs:'Requiere reparación mayor' },
  { id:'HRR-010', nombre:'Plancha Compactadora', tipo:'Maquinaria', estado:'bueno', ubicacion:'almacen', disponible:true, responsable:'—', fecha:'21/04/2026', obs:'' },
];

const PERS_DATA = [
  { id:'PER-001', nombre:'Carlos Quispe Mamani', dni:'42158736', cargo:'Operario Eléctrico', area:'Instalaciones', ingreso:'15/01/2026', estado:'activo', tel:'946-112-334', obs:'' },
  { id:'PER-002', nombre:'Juan Flores Ramos', dni:'38421567', cargo:'Operario Civil', area:'Estructura', ingreso:'15/01/2026', estado:'activo', tel:'912-445-678', obs:'' },
  { id:'PER-003', nombre:'Pedro Lima Torres', dni:'51234789', cargo:'Oficial', area:'Estructura', ingreso:'20/01/2026', estado:'activo', tel:'965-332-190', obs:'' },
  { id:'PER-004', nombre:'Roberto Vargas Cruz', dni:'47895123', cargo:'Peón', area:'General', ingreso:'01/02/2026', estado:'activo', tel:'978-556-321', obs:'' },
  { id:'PER-005', nombre:'Luis Mamani Quispe', dni:'33215678', cargo:'Peón', area:'Almacén', ingreso:'01/02/2026', estado:'activo', tel:'934-221-009', obs:'' },
  { id:'PER-006', nombre:'Miguel Torres Huanca', dni:'62451239', cargo:'Operario Civil', area:'Estructura', ingreso:'15/02/2026', estado:'activo', tel:'948-673-450', obs:'' },
  { id:'PER-007', nombre:'Sofía Ríos Mendoza', dni:'74123568', cargo:'Asistente Admin', area:'Administración', ingreso:'15/01/2026', estado:'activo', tel:'901-224-781', obs:'' },
  { id:'PER-008', nombre:'Fernando Castro López', dni:'58123490', cargo:'Electricista', area:'Instalaciones', ingreso:'20/02/2026', estado:'suspendido', tel:'916-889-302', obs:'Suspendido 3 días' },
  { id:'PER-009', nombre:'Ana Gutiérrez Ponce', dni:'66874532', cargo:'Almacenera', area:'Almacén', ingreso:'15/01/2026', estado:'activo', tel:'975-441-223', obs:'' },
  { id:'PER-010', nombre:'Jorge Salas Mendoza', dni:'43872156', cargo:'Capataz', area:'Estructura', ingreso:'15/01/2026', estado:'activo', tel:'988-112-774', obs:'' },
];

const ASIST_DATA = [
  { id:'PER-001', nombre:'Carlos Quispe Mamani', cargo:'Operario Eléctrico', entrada:'07:58', salida:'17:02', horas:9.1, estado:'asistio' },
  { id:'PER-002', nombre:'Juan Flores Ramos', cargo:'Operario Civil', entrada:'07:45', salida:'17:00', horas:9.3, estado:'asistio' },
  { id:'PER-003', nombre:'Pedro Lima Torres', cargo:'Oficial', entrada:'08:25', salida:'17:00', horas:8.6, estado:'tardanza' },
  { id:'PER-004', nombre:'Roberto Vargas Cruz', cargo:'Peón', entrada:'—', salida:'—', horas:0, estado:'falta' },
  { id:'PER-005', nombre:'Luis Mamani Quispe', cargo:'Peón', entrada:'07:55', salida:'17:00', horas:9.1, estado:'asistio' },
  { id:'PER-006', nombre:'Miguel Torres Huanca', cargo:'Operario Civil', entrada:'07:50', salida:'17:05', horas:9.2, estado:'asistio' },
  { id:'PER-007', nombre:'Sofía Ríos Mendoza', cargo:'Asistente Admin', entrada:'08:00', salida:'17:00', horas:9.0, estado:'asistio' },
  { id:'PER-008', nombre:'Fernando Castro López', cargo:'Electricista', entrada:'—', salida:'—', horas:0, estado:'permiso' },
  { id:'PER-009', nombre:'Ana Gutiérrez Ponce', cargo:'Almacenera', entrada:'07:52', salida:'17:00', horas:9.1, estado:'asistio' },
  { id:'PER-010', nombre:'Jorge Salas Mendoza', cargo:'Capataz', entrada:'07:40', salida:'17:10', horas:9.5, estado:'asistio' },
];

// ─── HELPERS ────────────────────────────────────────────
const MAT_EST  = { ok:'b-green', reponer:'b-yellow', critico:'b-red', sinstock:'b-gray' };
const MAT_ELBL = { ok:'Stock OK', reponer:'Por Reponer', critico:'Crítico', sinstock:'Sin Stock' };
const HERR_EST = { nuevo:'b-blue', bueno:'b-green', regular:'b-yellow', malo:'b-red', mantenimiento:'b-orange', baja:'b-gray' };
const HERR_UBI = { 'en-uso':'b-amber', almacen:'b-blue', mantenimiento:'b-orange', baja:'b-gray', perdida:'b-red' };
const HERR_ULB = { 'en-uso':'En Uso', almacen:'Almacén', mantenimiento:'Mantenimiento', baja:'Dado de Baja', perdida:'Perdida' };
const ASIST_EST= { asistio:'b-green', tardanza:'b-yellow', falta:'b-red', permiso:'b-blue', descanso:'b-gray' };
const ASIST_LBL= { asistio:'Asistió', tardanza:'Tardanza', falta:'Falta', permiso:'Permiso', descanso:'Descanso' };
const PERS_EST = { activo:'b-green', inactivo:'b-gray', suspendido:'b-yellow', retirado:'b-red', inhabilitado:'b-red' };

// ─── MODAL wrapper ──────────────────────────────────────
function Modal({ title, icon, onClose, children, wide }) {
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { maxWidth: 700 } : {}}>
        <div className="modal-hd">
          <div className="modal-hd-left">
            {icon && <div style={{ width:32,height:32,borderRadius:8,background:'rgba(242,183,5,.12)',display:'flex',alignItems:'center',justifyContent:'center' }}><JxIcon name={icon} size={15} color="var(--amber)" /></div>}
            <span>{title}</span>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-icon"><JxIcon name="x" size={15} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── MATERIALES PAGE ────────────────────────────────────
function MaterialesPage({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const isAdmin = auth?.profile?.rol === 'admin';
  const [q, setQ] = uS('');
  const [modal, setModal] = uS(null); // 'ingreso' | 'salida' | 'nuevo' | 'editar'
  const [editingId, setEditingId] = uS(null); // id del material en edición
  const [obraId, setObraId] = uS(null);
  const [requestTarget, setRequestTarget] = uS(null); // material para "Solicitar Cambio"

  // Detectar obra activa — respeta localStorage 'obra_activa_id', si no usa la primera
  uE(() => {
    let cancelled = false;
    const findObra = async () => {
      const obras = await window.__db.obras.toArray();
      const stored = window.__getObraActivaId?.();
      const activa = (stored && obras.find(o => o.id === stored && !o.deleted_at))
                  || obras.find(o => !o.deleted_at);
      if (activa) {
        if (!cancelled) setObraId(activa.id);
      } else if (!cancelled) {
        setTimeout(findObra, 500);
      }
    };
    findObra();
    return () => { cancelled = true; };
  }, []);

  // Hook real de materiales
  const { data: materiales, loading, create: createMaterial, update: updateMaterial, refresh } = window.__hooks.useMateriales(obraId);
  const { data: personal } = window.__hooks.usePersonal(obraId);
  const movHook = window.__hooks.useMovimientosMateriales(obraId);

  // Proveedores desde Dexie directamente
  const [provs, setProvs] = uS([]);
  uE(() => { window.__db.proveedores.toArray().then(setProvs); }, [obraId]);

  // Estado del form
  const [form, setForm] = uS({});

  const filtered = uM(() => {
    if (!materiales) return [];
    if (!q) return materiales;
    return materiales.filter(m =>
      m.nombre_material?.toLowerCase().includes(q.toLowerCase()) ||
      m.categoria?.toLowerCase().includes(q.toLowerCase())
    );
  }, [q, materiales]);

  const alertasCount = uM(() =>
    materiales?.filter(m => m.alerta === 'critico' || m.alerta === 'sin_stock').length ?? 0,
  [materiales]);

  const openModal = (type) => {
    setForm({
      fecha: new Date().toISOString().slice(0, 10),
      hora: new Date().toTimeString().slice(0, 5),
      tipo_movimiento: type === 'ingreso' ? 'entrada' : 'salida',
    });
    setModal(type);
  };

  const openEditMaterial = (m) => {
    setForm({
      nombre_material: m.nombre_material || '',
      categoria: m.categoria || '',
      unidad: m.unidad || '',
      stock_inicial: m.stock_inicial ?? '',
      stock_minimo: m.stock_minimo ?? '',
      precio: m.precio_unitario_estimado ?? '',
      proveedor_id: m.proveedor_principal_id || null,
    });
    setEditingId(m.id);
    setModal('editar');
  };

  const handleSubmitMaterial = async () => {
    if (!form.nombre_material || !form.unidad) {
      showToast('Completa nombre y unidad', 'red');
      return;
    }
    try {
      if (editingId) {
        // EDITAR — preserva stock_actual y alerta
        const oldData = materiales.find(m => m.id === editingId);
        const newFields = {
          nombre_material: form.nombre_material,
          categoria: form.categoria || 'General',
          unidad: form.unidad,
          stock_inicial: parseFloat(form.stock_inicial) || 0,
          stock_minimo: parseFloat(form.stock_minimo) || 0,
          precio_unitario_estimado: parseFloat(form.precio) || null,
          proveedor_principal_id: form.proveedor_id || null,
        };
        await updateMaterial(editingId, newFields);
        try { await window.__logAudit?.({ action:'update', table:'materiales', recordId:editingId, oldData, newData:newFields }); } catch(e) {}
        showToast(`Material "${form.nombre_material}" actualizado`, 'green');
      } else {
        const created = await createMaterial({
          obra_id: obraId,
          nombre_material: form.nombre_material,
          categoria: form.categoria || 'General',
          unidad: form.unidad,
          stock_inicial: parseFloat(form.stock_inicial) || 0,
          stock_actual: parseFloat(form.stock_inicial) || 0,
          stock_minimo: parseFloat(form.stock_minimo) || 0,
          precio_unitario_estimado: parseFloat(form.precio) || null,
          proveedor_principal_id: form.proveedor_id || null,
          alerta: 'ok',
          estado: 'activo',
        });
        try { await window.__logAudit?.({ action:'insert', table:'materiales', recordId:created?.id, newData:created }); } catch(e) {}
        showToast(`Material "${form.nombre_material}" creado`, 'green');
      }
      setModal(null);
      setForm({});
      setEditingId(null);
    } catch (e) {
      showToast('Error: ' + e.message, 'red');
    }
  };

  const handleSubmitMovimiento = async (tipo) => {
    if (!form.material_id || !form.cantidad) {
      showToast('Selecciona material y cantidad', 'red');
      return;
    }
    const material = materiales.find(m => m.id === form.material_id);
    try {
      const movCreated = await movHook.create({
        obra_id: obraId,
        material_id: form.material_id,
        fecha: form.fecha,
        hora: form.hora,
        tipo_movimiento: tipo === 'ingreso' ? 'entrada' : 'salida',
        cantidad: parseFloat(form.cantidad),
        unidad: material.unidad,
        responsable_id: form.responsable_id || null,
        proveedor_id: form.proveedor_id || null,
        documento_asociado: form.documento || null,
        precio_unitario_real: parseFloat(form.precio) || null,
        observaciones: form.observaciones || null,
      });
      try { await window.__logAudit?.({ action:'insert', table:'movimientos_materiales', recordId:movCreated?.id, newData:movCreated, reason:`${tipo} de ${parseFloat(form.cantidad)} ${material.unidad} de ${material.nombre_material}` }); } catch(e) {}
      // Actualizar stock local optimistamente
      const delta = tipo === 'ingreso' ? parseFloat(form.cantidad) : -parseFloat(form.cantidad);
      const nuevoStock = (material.stock_actual ?? 0) + delta;
      const nuevaAlerta = nuevoStock <= 0 ? 'sin_stock'
        : nuevoStock <= material.stock_minimo * 0.5 ? 'critico'
        : nuevoStock <= material.stock_minimo ? 'reponer' : 'ok';
      await window.__db.materiales.update(form.material_id, {
        stock_actual: nuevoStock,
        alerta: nuevaAlerta,
      });
      refresh();
      showToast(`${tipo === 'ingreso' ? 'Ingreso' : 'Salida'} registrado · ${navigator.onLine ? 'sincronizando…' : 'guardado offline'}`, 'green');
      setModal(null);
      setForm({});
    } catch (e) {
      showToast('Error: ' + e.message, 'red');
    }
  };

  // Mapeo alerta → badge styling
  const ALERTA_STYLE = {
    ok:        { class: 'b-green',  label: 'OK' },
    reponer:   { class: 'b-yellow', label: 'Reponer' },
    critico:   { class: 'b-red',    label: 'Crítico' },
    sin_stock: { class: 'b-gray',   label: 'Sin stock' },
  };

  if (loading || !obraId) {
    return <div className="page-wrap"><div className="empty-state"><JxIcon name="package" size={32} color="var(--tm)"/><p>Cargando materiales…</p></div></div>;
  }

  const matSeleccionado = form.material_id ? materiales.find(m => m.id === form.material_id) : null;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Materiales</div>
          <div className="pg-sub">{materiales.length} materiales registrados · {alertasCount} alertas activas</div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-ghost btn-sm" onClick={()=>openModal('salida')}><JxIcon name="arrowOut" size={13}/>Registrar Salida</button>
          <button className="btn btn-ghost btn-sm" onClick={()=>openModal('ingreso')}><JxIcon name="arrowIn" size={13}/>Registrar Ingreso</button>
          <button className="btn btn-amber btn-sm" onClick={()=>{setForm({}); setModal('nuevo');}}><JxIcon name="plus" size={13}/>Nuevo Material</button>
        </div>
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:14 }}>
        <div className="search-bar"><JxIcon name="search" size={14} color="var(--tm)"/><input placeholder="Buscar por nombre o categoría…" value={q} onChange={e=>setQ(e.target.value)}/></div>
      </div>

      {materiales.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="package" size={40} color="var(--tm)"/>
          <p>No hay materiales registrados aún. Click en "Nuevo Material" para empezar.</p>
        </div>
      ) : (
      <div className="card" style={{ overflow:'hidden' }}>
        <div style={{ overflowX:'auto' }}>
          <table className="tbl">
            <thead><tr>
              <th>Material</th><th>Categoría</th><th>Unidad</th>
              <th style={{textAlign:'right'}}>Stock Actual</th><th style={{textAlign:'right'}}>Stock Mín.</th>
              <th style={{textAlign:'right'}}>Entradas</th><th style={{textAlign:'right'}}>Salidas</th>
              <th>Estado</th><th>Sync</th><th style={{textAlign:'center'}}>Acciones</th>
            </tr></thead>
            <tbody>
              {filtered.map(m => {
                const a = ALERTA_STYLE[m.alerta] || ALERTA_STYLE.ok;
                const stockColor = m.alerta === 'critico' ? 'var(--red)'
                  : m.alerta === 'sin_stock' ? 'var(--tm)'
                  : m.alerta === 'reponer' ? 'var(--yellow)' : 'var(--tp)';
                return (
                  <tr key={m.id}>
                    <td className="col-p">{m.nombre_material}</td>
                    <td><span className="tag">{m.categoria || '—'}</span></td>
                    <td className="col-m">{m.unidad}</td>
                    <td style={{textAlign:'right'}} className="col-num">
                      <span style={{ color: stockColor, fontWeight: 600 }}>{Number(m.stock_actual ?? 0).toLocaleString('es-PE')}</span>
                    </td>
                    <td style={{textAlign:'right'}} className="col-num">{Number(m.stock_minimo ?? 0).toLocaleString('es-PE')}</td>
                    <td style={{textAlign:'right'}} className="col-num"><span style={{color:'var(--green)'}}>{Number(m.total_entradas ?? 0).toLocaleString('es-PE')}</span></td>
                    <td style={{textAlign:'right'}} className="col-num"><span style={{color:'var(--orange)'}}>{Number(m.total_salidas ?? 0).toLocaleString('es-PE')}</span></td>
                    <td><span className={`badge ${a.class}`}>{a.label}</span></td>
                    <td>{m.sync_status && m.sync_status !== 'synced'
                      ? <span className="badge b-amber" title={m.sync_status}>⏱ pendiente</span>
                      : <span style={{color:'var(--green)',fontSize:11}}>✓</span>}
                    </td>
                    <td style={{textAlign:'center'}}>
                      {isAdmin ? (
                        <button className="btn btn-ghost btn-xs" title="Editar material" onClick={()=>openEditMaterial(m)}>
                          <JxIcon name="edit" size={11}/>
                        </button>
                      ) : (
                        <button className="btn btn-ghost btn-xs" title="Solicitar cambio" onClick={()=>setRequestTarget(m)}>
                          <JxIcon name="alert" size={11}/>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding:'12px 16px', borderTop:'1px solid var(--border)', fontSize:11.5, color:'var(--tm)', display:'flex', justifyContent:'space-between' }}>
          <span>Mostrando {filtered.length} de {materiales.length} materiales</span>
        </div>
      </div>
      )}

      {/* Modal Ingreso */}
      {modal==='ingreso' && <Modal title="Registrar Ingreso de Material" icon="arrowIn" onClose={()=>setModal(null)}>
        <div className="g2">
          <div><label className="flabel">Fecha</label><input className="fi" type="date" value={form.fecha||''} onChange={e=>setForm({...form, fecha:e.target.value})}/></div>
          <div><label className="flabel">Hora</label><input className="fi" type="time" value={form.hora||''} onChange={e=>setForm({...form, hora:e.target.value})}/></div>
          <div><label className="flabel">Material</label>
            <select className="fi" value={form.material_id||''} onChange={e=>setForm({...form, material_id:e.target.value})}>
              <option value="">Selecciona...</option>
              {materiales.map(m => <option key={m.id} value={m.id}>{m.nombre_material} ({m.unidad})</option>)}
            </select>
          </div>
          <div><label className="flabel">Cantidad</label><input className="fi" type="number" min="0" step="0.01" value={form.cantidad||''} onChange={e=>setForm({...form, cantidad:e.target.value})}/></div>
          <div><label className="flabel">Proveedor</label>
            <select className="fi" value={form.proveedor_id||''} onChange={e=>setForm({...form, proveedor_id:e.target.value||null})}>
              <option value="">— sin especificar —</option>
              {provs.map(p => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
            </select>
          </div>
          <div><label className="flabel">Documento / Guía</label><input className="fi" placeholder="N° guía o factura" value={form.documento||''} onChange={e=>setForm({...form, documento:e.target.value})}/></div>
          <div><label className="flabel">Precio Unitario (S/)</label><input className="fi" type="number" step="0.01" placeholder="0.00" value={form.precio||''} onChange={e=>setForm({...form, precio:e.target.value})}/></div>
        </div>
        <div style={{marginTop:14}}><label className="flabel">Observaciones</label><textarea className="fi" value={form.observaciones||''} onChange={e=>setForm({...form, observaciones:e.target.value})} placeholder="Notas adicionales…"/></div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={()=>setModal(null)}>Cancelar</button>
          <button className="btn btn-amber" onClick={()=>handleSubmitMovimiento('ingreso')}><JxIcon name="check" size={13}/>Registrar Ingreso</button>
        </div>
      </Modal>}

      {/* Modal Salida */}
      {modal==='salida' && <Modal title="Registrar Salida de Material" icon="arrowOut" onClose={()=>setModal(null)}>
        <div className="g2">
          <div><label className="flabel">Fecha</label><input className="fi" type="date" value={form.fecha||''} onChange={e=>setForm({...form, fecha:e.target.value})}/></div>
          <div><label className="flabel">Hora</label><input className="fi" type="time" value={form.hora||''} onChange={e=>setForm({...form, hora:e.target.value})}/></div>
          <div><label className="flabel">Material</label>
            <select className="fi" value={form.material_id||''} onChange={e=>setForm({...form, material_id:e.target.value})}>
              <option value="">Selecciona...</option>
              {materiales.map(m => <option key={m.id} value={m.id}>{m.nombre_material} ({m.unidad}) · stock: {m.stock_actual}</option>)}
            </select>
          </div>
          <div><label className="flabel">Cantidad</label><input className="fi" type="number" min="0" step="0.01" value={form.cantidad||''} onChange={e=>setForm({...form, cantidad:e.target.value})}/></div>
          <div><label className="flabel">Responsable</label>
            <select className="fi" value={form.responsable_id||''} onChange={e=>setForm({...form, responsable_id:e.target.value||null})}>
              <option value="">— sin especificar —</option>
              {personal.map(p => <option key={p.id} value={p.id}>{p.nombres} {p.apellidos} · {p.cargo}</option>)}
            </select>
          </div>
          <div><label className="flabel">Frente / Zona</label><input className="fi" placeholder="Ej: Frente A, Piso 2" value={form.frente_zona||''} onChange={e=>setForm({...form, frente_zona:e.target.value})}/></div>
          <div><label className="flabel">Stock Disponible</label>
            {matSeleccionado ? (
              <div style={{background:matSeleccionado.stock_actual >= (parseFloat(form.cantidad)||0) ? 'var(--green-l)' : 'var(--red-l)', border:`1px solid ${matSeleccionado.stock_actual >= (parseFloat(form.cantidad)||0) ? 'rgba(46,204,113,.2)' : 'rgba(231,76,60,.2)'}`, borderRadius:6, padding:'10px 13px', fontSize:13, color: matSeleccionado.stock_actual >= (parseFloat(form.cantidad)||0) ? 'var(--green)' : 'var(--red)', fontWeight:600}}>
                {matSeleccionado.stock_actual >= (parseFloat(form.cantidad)||0) ? '✓' : '⚠'} {matSeleccionado.stock_actual} {matSeleccionado.unidad} disponibles
              </div>
            ) : <div className="fi" style={{color:'var(--tm)'}}>—</div>}
          </div>
        </div>
        <div style={{marginTop:14}}><label className="flabel">Observaciones</label><textarea className="fi" value={form.observaciones||''} onChange={e=>setForm({...form, observaciones:e.target.value})} placeholder="Notas adicionales…"/></div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={()=>setModal(null)}>Cancelar</button>
          <button className="btn btn-amber" onClick={()=>handleSubmitMovimiento('salida')}><JxIcon name="check" size={13}/>Registrar Salida</button>
        </div>
      </Modal>}

      {/* Modal Nuevo / Editar Material */}
      {(modal==='nuevo' || modal==='editar') && <Modal title={editingId ? 'Editar Material' : 'Nuevo Material'} icon="package" onClose={()=>{setModal(null); setEditingId(null); setForm({});}}>
        <div className="g2">
          <div style={{gridColumn:'1/-1'}}><label className="flabel">Nombre del material *</label><input className="fi" placeholder="Ej: Cemento Sol Tipo I" value={form.nombre_material||''} onChange={e=>setForm({...form, nombre_material:e.target.value})}/></div>
          <div><label className="flabel">Categoría</label>
            <select className="fi" value={form.categoria||''} onChange={e=>setForm({...form, categoria:e.target.value})}>
              <option value="">— Selecciona —</option>
              <option>Cemento</option><option>Acero</option><option>Albañilería</option>
              <option>Agregados</option><option>Ferretería</option><option>Eléctrico</option>
              <option>Sanitario</option><option>Acabados</option><option>Otro</option>
            </select>
          </div>
          <div><label className="flabel">Unidad *</label>
            <select className="fi" value={form.unidad||''} onChange={e=>setForm({...form, unidad:e.target.value})}>
              <option value="">— Selecciona —</option>
              <option>bolsa</option><option>varilla</option><option>m³</option><option>kg</option>
              <option>unidad</option><option>caja</option><option>galón</option><option>rollo</option>
            </select>
          </div>
          <div><label className="flabel">Stock inicial</label><input className="fi" type="number" min="0" step="0.01" value={form.stock_inicial||''} onChange={e=>setForm({...form, stock_inicial:e.target.value})}/></div>
          <div><label className="flabel">Stock mínimo</label><input className="fi" type="number" min="0" step="0.01" value={form.stock_minimo||''} onChange={e=>setForm({...form, stock_minimo:e.target.value})}/></div>
          <div><label className="flabel">Precio estimado (S/)</label><input className="fi" type="number" step="0.01" placeholder="0.00" value={form.precio||''} onChange={e=>setForm({...form, precio:e.target.value})}/></div>
          <div><label className="flabel">Proveedor principal</label>
            <select className="fi" value={form.proveedor_id||''} onChange={e=>setForm({...form, proveedor_id:e.target.value||null})}>
              <option value="">— sin especificar —</option>
              {provs.map(p => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
            </select>
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={()=>{setModal(null); setEditingId(null); setForm({});}}>Cancelar</button>
          <button className="btn btn-amber" onClick={handleSubmitMaterial}><JxIcon name="check" size={13}/>{editingId ? 'Guardar Cambios' : 'Crear Material'}</button>
        </div>
      </Modal>}

      {requestTarget && (
        <RequestChangeModal
          table="materiales"
          record={requestTarget}
          recordLabel={requestTarget.nombre_material}
          fields={[
            { key: 'nombre_material', label: 'Nombre del material' },
            { key: 'categoria', label: 'Categoría' },
            { key: 'unidad', label: 'Unidad' },
            { key: 'stock_minimo', label: 'Stock mínimo', type: 'number' },
            { key: 'precio_unitario_estimado', label: 'Precio estimado (S/)', type: 'number' },
          ]}
          showToast={showToast}
          onClose={() => setRequestTarget(null)}
        />
      )}
    </div>
  );
}

// ─── HERRAMIENTAS PAGE ──────────────────────────────────
function HerramientasPage({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const isAdmin = auth?.profile?.rol === 'admin';
  const [q, setQ] = uS('');
  const [modal, setModal] = uS(null);
  const [form, setForm] = uS({});
  const [editingId, setEditingId] = uS(null);
  const [obraId, setObraId] = uS(null);
  const [requestTarget, setRequestTarget] = uS(null);

  uE(() => {
    let cancelled = false;
    const find = async () => {
      const obras = await window.__db.obras.toArray();
      const stored = window.__getObraActivaId?.();
      const a = (stored && obras.find(o => o.id === stored && !o.deleted_at))
             || obras.find(o => !o.deleted_at);
      if (a) { if (!cancelled) setObraId(a.id); }
      else if (!cancelled) setTimeout(find, 500);
    };
    find();
    return () => { cancelled = true; };
  }, []);

  const { data: herramientas, loading, create: createHerr, update: updateHerr, refresh } = window.__hooks.useHerramientas(obraId);
  const { data: personal } = window.__hooks.usePersonal(obraId);
  const movHook = window.__hooks.useMovimientosHerramientas(obraId);

  const filtered = uM(() => {
    if (!herramientas) return [];
    if (!q) return herramientas;
    return herramientas.filter(h =>
      h.nombre_herramienta?.toLowerCase().includes(q.toLowerCase()) ||
      h.marca?.toLowerCase().includes(q.toLowerCase()) ||
      h.tipo_herramienta?.toLowerCase().includes(q.toLowerCase())
    );
  }, [q, herramientas]);

  const enUso = herramientas?.filter(h => h.ubicacion_actual === 'en_uso').length ?? 0;
  const disponibles = herramientas?.filter(h => h.disponible).length ?? 0;

  const ESTADO_STYLE = {
    nuevo:          { class:'b-green',  label:'Nuevo' },
    bueno:          { class:'b-green',  label:'Bueno' },
    regular:        { class:'b-yellow', label:'Regular' },
    malo:           { class:'b-red',    label:'Malo' },
    mantenimiento:  { class:'b-orange', label:'Mantenimiento' },
    inhabilitado:   { class:'b-gray',   label:'Inhabilitado' },
    baja:           { class:'b-gray',   label:'Baja' },
  };
  const UBIC_STYLE = {
    almacen:        { class:'b-blue',   label:'En Almacén' },
    en_uso:         { class:'b-amber',  label:'En Uso' },
    mantenimiento:  { class:'b-orange', label:'Mantenimiento' },
    perdida:        { class:'b-red',    label:'Pérdida' },
    baja:           { class:'b-gray',   label:'Baja' },
  };

  const openMov = (accion) => {
    setForm({
      fecha: new Date().toISOString().slice(0, 10),
      hora: new Date().toTimeString().slice(0, 5),
      accion,
    });
    setModal('mov');
  };

  const openEditHerr = (h) => {
    setForm({
      nombre_herramienta: h.nombre_herramienta || '',
      tipo_herramienta: h.tipo_herramienta || 'manual',
      marca: h.marca || '',
      modelo: h.modelo || '',
      serie: h.serie || '',
      estado_actual: h.estado_actual || 'bueno',
    });
    setEditingId(h.id);
    setModal('editar');
  };

  const handleSubmitHerr = async () => {
    if (!form.nombre_herramienta) {
      showToast('Falta nombre', 'red');
      return;
    }
    try {
      if (editingId) {
        const oldData = herramientas.find(h => h.id === editingId);
        const newFields = {
          nombre_herramienta: form.nombre_herramienta,
          tipo_herramienta: form.tipo_herramienta || 'manual',
          marca: form.marca || null,
          modelo: form.modelo || null,
          serie: form.serie || null,
          estado_actual: form.estado_actual || 'bueno',
        };
        await updateHerr(editingId, newFields);
        try { await window.__logAudit?.({ action:'update', table:'herramientas', recordId:editingId, oldData, newData:newFields }); } catch(e) {}
        showToast(`Herramienta "${form.nombre_herramienta}" actualizada`, 'green');
      } else {
        const created = await createHerr({
          obra_id: obraId,
          nombre_herramienta: form.nombre_herramienta,
          tipo_herramienta: form.tipo_herramienta || 'manual',
          marca: form.marca || null,
          modelo: form.modelo || null,
          serie: form.serie || null,
          estado_actual: form.estado_actual || 'bueno',
          ubicacion_actual: 'almacen',
          disponible: true,
        });
        try { await window.__logAudit?.({ action:'insert', table:'herramientas', recordId:created?.id, newData:created }); } catch(e) {}
        showToast(`Herramienta "${form.nombre_herramienta}" creada`, 'green');
      }
      setModal(null); setForm({}); setEditingId(null);
    } catch (e) {
      showToast('Error: ' + e.message, 'red');
    }
  };

  const handleSubmitMov = async () => {
    if (!form.herramienta_id || !form.responsable_id) {
      showToast('Selecciona herramienta y responsable', 'red');
      return;
    }
    const herr = herramientas.find(h => h.id === form.herramienta_id);
    try {
      const movCreated = await movHook.create({
        obra_id: obraId,
        herramienta_id: form.herramienta_id,
        fecha: form.fecha,
        hora: form.hora,
        accion: form.accion,
        responsable_id: form.responsable_id,
        estado_salida: form.accion === 'salida' ? form.estado : null,
        estado_devolucion: form.accion === 'entrada' ? form.estado : null,
        observaciones: form.observaciones || null,
      });
      try { await window.__logAudit?.({ action:'insert', table:'movimientos_herramientas', recordId:movCreated?.id, newData:movCreated, reason:`${form.accion} de "${herr.nombre_herramienta}"` }); } catch(e) {}
      // Optimistic update local
      const updates = {};
      if (form.accion === 'salida') {
        updates.disponible = false;
        updates.ubicacion_actual = 'en_uso';
        updates.ultimo_responsable_id = form.responsable_id;
        updates.fecha_ultimo_movimiento = form.fecha;
      } else if (form.accion === 'entrada') {
        updates.disponible = true;
        updates.ubicacion_actual = 'almacen';
        updates.fecha_ultimo_movimiento = form.fecha;
        if (form.estado) updates.estado_actual = form.estado;
      } else if (form.accion === 'mantenimiento') {
        updates.disponible = false;
        updates.ubicacion_actual = 'mantenimiento';
        updates.estado_actual = 'mantenimiento';
      }
      await window.__db.herramientas.update(form.herramienta_id, updates);
      refresh();

      // Si devolución con estado peor → crear incidencia
      if (form.accion === 'entrada' && form.estado === 'malo' && herr.estado_actual !== 'malo') {
        await window.__db.incidencias.add({
          id: window.__newId(),
          obra_id: obraId,
          tipo_incidencia: 'herramienta',
          severidad: 'media',
          modulo_origen: 'movimientos_herramientas',
          descripcion: `Herramienta "${herr.nombre_herramienta}" devuelta en mal estado.`,
          estado: 'abierta',
          sync_status: 'pending_create',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        showToast('Incidencia creada por daño en herramienta', 'amber');
      } else {
        showToast(`${form.accion === 'salida' ? 'Salida' : form.accion === 'entrada' ? 'Devolución' : 'Movimiento'} registrado`, 'green');
      }
      setModal(null); setForm({});
    } catch (e) {
      showToast('Error: ' + e.message, 'red');
    }
  };

  if (loading || !obraId) {
    return <div className="page-wrap"><div className="empty-state"><JxIcon name="tool" size={32} color="var(--tm)"/><p>Cargando herramientas…</p></div></div>;
  }

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Herramientas</div>
          <div className="pg-sub">{herramientas.length} herramientas · {enUso} en uso · {disponibles} disponibles</div>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button className="btn btn-green btn-sm" onClick={()=>openMov('entrada')}><JxIcon name="arrowIn" size={13}/>Registrar Devolución</button>
          <button className="btn btn-ghost btn-sm" onClick={()=>openMov('salida')}><JxIcon name="arrowOut" size={13}/>Registrar Salida</button>
          <button className="btn btn-amber btn-sm" onClick={()=>{setForm({}); setModal('nuevo');}}><JxIcon name="plus" size={13}/>Nueva Herramienta</button>
        </div>
      </div>

      <div style={{display:'flex',gap:8,marginBottom:14}}>
        <div className="search-bar"><JxIcon name="search" size={14} color="var(--tm)"/><input placeholder="Buscar herramienta…" value={q} onChange={e=>setQ(e.target.value)}/></div>
      </div>

      {herramientas.length === 0 ? (
        <div className="card card-p empty-state"><JxIcon name="tool" size={40} color="var(--tm)"/><p>No hay herramientas registradas. Click en "Nueva Herramienta".</p></div>
      ) : (
      <div className="card" style={{overflow:'hidden'}}>
        <div style={{overflowX:'auto'}}>
          <table className="tbl">
            <thead><tr>
              <th>Herramienta</th><th>Tipo</th><th>Marca / Modelo</th><th>Estado</th>
              <th>Ubicación</th><th>Disponible</th><th>Últ. Movimiento</th><th>Sync</th>
              <th style={{textAlign:'center'}}>Acciones</th>
            </tr></thead>
            <tbody>
              {filtered.map(h => {
                const e = ESTADO_STYLE[h.estado_actual] || ESTADO_STYLE.bueno;
                const u = UBIC_STYLE[h.ubicacion_actual] || UBIC_STYLE.almacen;
                const resp = personal.find(p => p.id === h.ultimo_responsable_id);
                return (
                  <tr key={h.id}>
                    <td className="col-p">{h.nombre_herramienta}</td>
                    <td><span className="tag">{h.tipo_herramienta?.replace('_',' ') || '—'}</span></td>
                    <td className="col-m">{[h.marca, h.modelo].filter(Boolean).join(' ') || '—'}</td>
                    <td><span className={`badge ${e.class}`}>{e.label}</span></td>
                    <td><span className={`badge ${u.class}`}>{u.label}</span></td>
                    <td>{h.disponible ? <span className="badge b-green">Sí</span> : <span className="badge b-gray">No</span>}</td>
                    <td className="col-m">{h.fecha_ultimo_movimiento || '—'}{resp ? ` · ${resp.nombres}` : ''}</td>
                    <td>{h.sync_status && h.sync_status !== 'synced'
                      ? <span className="badge b-amber">⏱</span>
                      : <span style={{color:'var(--green)',fontSize:11}}>✓</span>}</td>
                    <td style={{textAlign:'center'}}>
                      {isAdmin ? (
                        <button className="btn btn-ghost btn-xs" title="Editar herramienta" onClick={()=>openEditHerr(h)}>
                          <JxIcon name="edit" size={11}/>
                        </button>
                      ) : (
                        <button className="btn btn-ghost btn-xs" title="Solicitar cambio" onClick={()=>setRequestTarget(h)}>
                          <JxIcon name="alert" size={11}/>
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

      {/* Modal Movimiento (salida/devolución) */}
      {modal==='mov' && <Modal title={form.accion === 'salida' ? 'Registrar Salida de Herramienta' : form.accion === 'entrada' ? 'Registrar Devolución' : 'Mantenimiento'} icon="tool" onClose={()=>setModal(null)}>
        <div className="g2">
          <div style={{gridColumn:'1/-1'}}><label className="flabel">Herramienta</label>
            <select className="fi" value={form.herramienta_id||''} onChange={e=>setForm({...form, herramienta_id:e.target.value})}>
              <option value="">Selecciona...</option>
              {herramientas
                .filter(h => form.accion === 'salida' ? h.disponible : !h.disponible)
                .map(h => <option key={h.id} value={h.id}>{h.nombre_herramienta} · {h.marca || ''} {h.modelo || ''}</option>)}
            </select>
          </div>
          <div><label className="flabel">Responsable</label>
            <select className="fi" value={form.responsable_id||''} onChange={e=>setForm({...form, responsable_id:e.target.value})}>
              <option value="">Selecciona...</option>
              {personal.map(p => <option key={p.id} value={p.id}>{p.nombres} {p.apellidos} · {p.cargo}</option>)}
            </select>
          </div>
          <div><label className="flabel">Estado de {form.accion === 'salida' ? 'Salida' : 'Devolución'}</label>
            <select className="fi" value={form.estado||''} onChange={e=>setForm({...form, estado:e.target.value})}>
              <option value="">— sin cambio —</option>
              <option value="nuevo">Nuevo</option><option value="bueno">Bueno</option>
              <option value="regular">Regular</option><option value="malo">Malo</option>
            </select>
          </div>
          <div><label className="flabel">Fecha</label><input className="fi" type="date" value={form.fecha||''} onChange={e=>setForm({...form, fecha:e.target.value})}/></div>
          <div><label className="flabel">Hora</label><input className="fi" type="time" value={form.hora||''} onChange={e=>setForm({...form, hora:e.target.value})}/></div>
        </div>
        <div style={{marginTop:14}}><label className="flabel">Observaciones</label><textarea className="fi" value={form.observaciones||''} onChange={e=>setForm({...form, observaciones:e.target.value})} placeholder="Condición de la herramienta, daños, etc."/></div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={()=>setModal(null)}>Cancelar</button>
          <button className="btn btn-amber" onClick={handleSubmitMov}><JxIcon name="check" size={13}/>Registrar</button>
        </div>
      </Modal>}

      {/* Modal Nueva / Editar Herramienta */}
      {(modal==='nuevo' || modal==='editar') && <Modal title={editingId ? 'Editar Herramienta' : 'Nueva Herramienta'} icon="tool" onClose={()=>{setModal(null); setEditingId(null); setForm({});}}>
        <div className="g2">
          <div style={{gridColumn:'1/-1'}}><label className="flabel">Nombre *</label><input className="fi" placeholder="Ej: Amoladora 7&quot;" value={form.nombre_herramienta||''} onChange={e=>setForm({...form, nombre_herramienta:e.target.value})}/></div>
          <div><label className="flabel">Tipo</label>
            <select className="fi" value={form.tipo_herramienta||''} onChange={e=>setForm({...form, tipo_herramienta:e.target.value})}>
              <option value="manual">Manual</option><option value="electrica">Eléctrica</option>
              <option value="maquinaria_liviana">Maquinaria Liviana</option><option value="maquinaria_pesada">Maquinaria Pesada</option>
              <option value="medicion">Medición</option><option value="seguridad">Seguridad</option>
            </select>
          </div>
          <div><label className="flabel">Estado actual</label>
            <select className="fi" value={form.estado_actual||''} onChange={e=>setForm({...form, estado_actual:e.target.value})}>
              <option value="nuevo">Nuevo</option><option value="bueno">Bueno</option>
              <option value="regular">Regular</option><option value="malo">Malo</option>
            </select>
          </div>
          <div><label className="flabel">Marca</label><input className="fi" placeholder="Ej: Bosch" value={form.marca||''} onChange={e=>setForm({...form, marca:e.target.value})}/></div>
          <div><label className="flabel">Modelo</label><input className="fi" placeholder="Ej: GA7020" value={form.modelo||''} onChange={e=>setForm({...form, modelo:e.target.value})}/></div>
          <div style={{gridColumn:'1/-1'}}><label className="flabel">N° Serie</label><input className="fi" placeholder="Ej: BS-2024-001" value={form.serie||''} onChange={e=>setForm({...form, serie:e.target.value})}/></div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={()=>{setModal(null); setEditingId(null); setForm({});}}>Cancelar</button>
          <button className="btn btn-amber" onClick={handleSubmitHerr}><JxIcon name="check" size={13}/>{editingId ? 'Guardar Cambios' : 'Crear Herramienta'}</button>
        </div>
      </Modal>}

      {requestTarget && (
        <RequestChangeModal
          table="herramientas"
          record={requestTarget}
          recordLabel={requestTarget.nombre_herramienta}
          fields={[
            { key: 'nombre_herramienta', label: 'Nombre' },
            { key: 'marca', label: 'Marca' },
            { key: 'modelo', label: 'Modelo' },
            { key: 'serie', label: 'N° Serie' },
            { key: 'estado_actual', label: 'Estado actual', options: [
              { value: 'nuevo', label: 'Nuevo' }, { value: 'bueno', label: 'Bueno' },
              { value: 'regular', label: 'Regular' }, { value: 'malo', label: 'Malo' },
            ]},
          ]}
          showToast={showToast}
          onClose={() => setRequestTarget(null)}
        />
      )}
    </div>
  );
}

// ─── PERSONAL PAGE ──────────────────────────────────────
function PersonalPage({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const isAdmin = auth?.profile?.rol === 'admin';
  const [q, setQ] = uS('');
  const [modal, setModal] = uS(null);
  const [form, setForm] = uS({});
  const [editingId, setEditingId] = uS(null);
  const [reniecBusy, setReniecBusy] = uS(false);
  const [obraId, setObraId] = uS(null);
  const [requestTarget, setRequestTarget] = uS(null);

  uE(() => {
    let cancelled = false;
    const find = async () => {
      const obras = await window.__db.obras.toArray();
      const stored = window.__getObraActivaId?.();
      const a = (stored && obras.find(o => o.id === stored && !o.deleted_at))
             || obras.find(o => !o.deleted_at);
      if (a) { if (!cancelled) setObraId(a.id); }
      else if (!cancelled) setTimeout(find, 500);
    };
    find();
    return () => { cancelled = true; };
  }, []);

  const { data: personal, loading, create: createPersonal, update: updatePersonal } = window.__hooks.usePersonal(obraId);

  const consultarRENIEC = async () => {
    const dni = (form.dni || '').trim();
    if (!/^\d{8}$/.test(dni)) { showToast('Ingresa primero un DNI de 8 dígitos', 'red'); return; }
    setReniecBusy(true);
    try {
      const data = await window.__identity.consultarDNI(dni);
      setForm(prev => ({
        ...prev,
        nombres: prev.nombres?.trim() || data.nombres || prev.nombres,
        apellidos: prev.apellidos?.trim() || data.apellidos || prev.apellidos,
      }));
      showToast(`RENIEC: ${data.nombreCompleto || 'datos cargados'}`, 'green');
    } catch (e) {
      showToast(e.message || 'Error al consultar RENIEC', 'red');
    } finally {
      setReniecBusy(false);
    }
  };

  const filtered = uM(() => {
    if (!personal) return [];
    if (!q) return personal;
    return personal.filter(p =>
      `${p.nombres} ${p.apellidos}`.toLowerCase().includes(q.toLowerCase()) ||
      p.cargo?.toLowerCase().includes(q.toLowerCase()) ||
      p.dni?.includes(q)
    );
  }, [q, personal]);

  const ESTADO_STYLE = {
    activo:     { class:'b-green',  label:'Activo' },
    inactivo:   { class:'b-gray',   label:'Inactivo' },
    suspendido: { class:'b-yellow', label:'Suspendido' },
    retirado:   { class:'b-red',    label:'Retirado' },
  };

  const openEditPersonal = (p) => {
    setForm({
      nombres: p.nombres || '',
      apellidos: p.apellidos || '',
      dni: p.dni || '',
      cargo: p.cargo || '',
      area: p.area || '',
      fecha_ingreso: p.fecha_ingreso || '',
      telefono: p.telefono || '',
      estado: p.estado || 'activo',
    });
    setEditingId(p.id);
    setModal('editar');
  };

  const handleSubmit = async () => {
    const dni = (form.dni || '').trim();
    if (!form.nombres?.trim() || !form.apellidos?.trim() || !dni) {
      showToast('Faltan campos obligatorios (nombres, apellidos, DNI)', 'red');
      return;
    }
    if (!/^\d{8}$/.test(dni)) {
      showToast('El DNI debe tener exactamente 8 dígitos numéricos', 'red');
      return;
    }
    try {
      if (editingId) {
        const oldData = personal.find(p => p.id === editingId);
        const newFields = {
          nombres: form.nombres.trim(),
          apellidos: form.apellidos.trim(),
          dni,
          cargo: form.cargo || null,
          area: form.area || null,
          fecha_ingreso: form.fecha_ingreso || null,
          telefono: form.telefono?.trim() || null,
          estado: form.estado || 'activo',
        };
        await updatePersonal(editingId, newFields);
        try { await window.__logAudit?.({ action:'update', table:'personal', recordId:editingId, oldData, newData:newFields }); } catch(e) {}
        showToast(`Trabajador "${form.nombres} ${form.apellidos}" actualizado`, 'green');
      } else {
        const created = await createPersonal({
          obra_id: obraId,
          nombres: form.nombres.trim(),
          apellidos: form.apellidos.trim(),
          dni,
          cargo: form.cargo || null,
          area: form.area || null,
          fecha_ingreso: form.fecha_ingreso || new Date().toISOString().slice(0,10),
          telefono: form.telefono?.trim() || null,
          estado: 'activo',
        });
        try { await window.__logAudit?.({ action:'insert', table:'personal', recordId:created?.id, newData:created }); } catch(e) {}
        showToast(`Trabajador "${form.nombres} ${form.apellidos}" registrado`, 'green');
      }
      setModal(null); setForm({}); setEditingId(null);
    } catch (e) {
      showToast('Error: ' + (e.message?.includes('UNIQUE') ? 'Ya existe un trabajador con ese DNI' : e.message), 'red');
    }
  };

  if (loading || !obraId) {
    return <div className="page-wrap"><div className="empty-state"><JxIcon name="users" size={32} color="var(--tm)"/><p>Cargando personal…</p></div></div>;
  }

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div><div className="pg-title">Personal</div><div className="pg-sub">{personal.length} trabajadores · {personal.filter(p=>p.estado==='activo').length} activos</div></div>
        <div style={{display:'flex',gap:8}}>
          <button className="btn btn-amber btn-sm" onClick={()=>{setForm({}); setModal('nuevo');}}><JxIcon name="plus" size={13}/>Nuevo Trabajador</button>
        </div>
      </div>
      <div style={{display:'flex',gap:8,marginBottom:14}}>
        <div className="search-bar"><JxIcon name="search" size={14} color="var(--tm)"/><input placeholder="Buscar por nombre, cargo o DNI…" value={q} onChange={e=>setQ(e.target.value)}/></div>
      </div>
      {personal.length === 0 ? (
        <div className="card card-p empty-state"><JxIcon name="users" size={40} color="var(--tm)"/><p>No hay personal registrado. Click en "Nuevo Trabajador".</p></div>
      ) : (
      <div className="card" style={{overflow:'hidden'}}>
        <table className="tbl">
          <thead><tr>
            <th>Nombre Completo</th><th>DNI</th><th>Cargo</th><th>Área</th>
            <th>F. Ingreso</th><th>Estado</th><th>Teléfono</th><th>Sync</th>
            <th style={{textAlign:'center'}}>Acciones</th>
          </tr></thead>
          <tbody>
            {filtered.map(p => {
              const e = ESTADO_STYLE[p.estado] || ESTADO_STYLE.activo;
              return (
                <tr key={p.id}>
                  <td className="col-p">{p.nombres} {p.apellidos}</td>
                  <td className="col-m">{p.dni}</td>
                  <td>{p.cargo || '—'}</td>
                  <td><span className="tag">{p.area || '—'}</span></td>
                  <td className="col-m">{p.fecha_ingreso || '—'}</td>
                  <td><span className={`badge ${e.class}`}>{e.label}</span></td>
                  <td className="col-m">{p.telefono || '—'}</td>
                  <td>{p.sync_status && p.sync_status !== 'synced'
                    ? <span className="badge b-amber">⏱</span>
                    : <span style={{color:'var(--green)',fontSize:11}}>✓</span>}</td>
                  <td style={{textAlign:'center'}}>
                    {isAdmin ? (
                      <button className="btn btn-ghost btn-xs" title="Editar trabajador" onClick={()=>openEditPersonal(p)}>
                        <JxIcon name="edit" size={11}/>
                      </button>
                    ) : (
                      <button className="btn btn-ghost btn-xs" title="Solicitar cambio" onClick={()=>setRequestTarget(p)}>
                        <JxIcon name="alert" size={11}/>
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {(modal === 'nuevo' || modal === 'editar') && <Modal title={editingId ? 'Editar Trabajador' : 'Nuevo Trabajador'} icon="user" onClose={()=>{setModal(null); setEditingId(null); setForm({});}}>
        <div className="g2">
          <div><label className="flabel">Nombres *</label><input className="fi" value={form.nombres||''} onChange={e=>setForm({...form, nombres:e.target.value})}/></div>
          <div><label className="flabel">Apellidos *</label><input className="fi" value={form.apellidos||''} onChange={e=>setForm({...form, apellidos:e.target.value})}/></div>
          <div>
            <label className="flabel">DNI *</label>
            <div style={{ display:'flex', gap:6 }}>
              <input className="fi" placeholder="8 dígitos" inputMode="numeric" maxLength={8} value={form.dni||''} onChange={e=>setForm({...form, dni:e.target.value.replace(/\D/g,'').slice(0,8)})} style={{ flex:1 }}/>
              <button type="button" className="btn btn-blue btn-sm" disabled={reniecBusy || (form.dni||'').length !== 8} onClick={consultarRENIEC} title="Consultar datos en RENIEC">
                <JxIcon name="search" size={12}/>{reniecBusy ? '...' : 'RENIEC'}
              </button>
            </div>
          </div>
          <div><label className="flabel">Teléfono</label><input className="fi" placeholder="9 dígitos" inputMode="numeric" maxLength={9} value={form.telefono||''} onChange={e=>setForm({...form, telefono:e.target.value.replace(/\D/g,'').slice(0,9)})}/></div>
          <div><label className="flabel">Cargo</label>
            <select className="fi" value={form.cargo||''} onChange={e=>setForm({...form, cargo:e.target.value})}>
              <option value="">— Selecciona —</option>
              <option>Capataz</option><option>Operario</option><option>Oficial</option><option>Peón</option>
              <option>Almacenero</option><option>Maestro de Obra</option><option>Supervisor SST</option>
              <option>Topógrafo</option><option>Ingeniero Residente</option><option>Otro</option>
            </select>
          </div>
          <div><label className="flabel">Área</label>
            <select className="fi" value={form.area||''} onChange={e=>setForm({...form, area:e.target.value})}>
              <option value="">— Selecciona —</option>
              <option>Estructuras</option><option>Acabados</option><option>Instalaciones Sanitarias</option>
              <option>Instalaciones Eléctricas</option><option>Almacén</option><option>Seguridad</option>
              <option>Topografía</option><option>Administración</option>
            </select>
          </div>
          <div><label className="flabel">Fecha de ingreso</label><input className="fi" type="date" value={form.fecha_ingreso||''} onChange={e=>setForm({...form, fecha_ingreso:e.target.value})}/></div>
          {editingId && (
            <div><label className="flabel">Estado</label>
              <select className="fi" value={form.estado||'activo'} onChange={e=>setForm({...form, estado:e.target.value})}>
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
                <option value="suspendido">Suspendido</option>
                <option value="retirado">Retirado</option>
              </select>
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={()=>{setModal(null); setEditingId(null); setForm({});}}>Cancelar</button>
          <button className="btn btn-amber" onClick={handleSubmit}><JxIcon name="check" size={13}/>{editingId ? 'Guardar Cambios' : 'Registrar Trabajador'}</button>
        </div>
      </Modal>}

      {requestTarget && (
        <RequestChangeModal
          table="personal"
          record={requestTarget}
          recordLabel={`${requestTarget.nombres || ''} ${requestTarget.apellidos || ''}`.trim() || requestTarget.dni}
          fields={[
            { key: 'nombres', label: 'Nombres' },
            { key: 'apellidos', label: 'Apellidos' },
            { key: 'dni', label: 'DNI' },
            { key: 'cargo', label: 'Cargo' },
            { key: 'area', label: 'Área' },
            { key: 'telefono', label: 'Teléfono' },
            { key: 'estado', label: 'Estado', options: [
              { value: 'activo', label: 'Activo' }, { value: 'inactivo', label: 'Inactivo' },
              { value: 'suspendido', label: 'Suspendido' }, { value: 'retirado', label: 'Retirado' },
            ]},
          ]}
          showToast={showToast}
          onClose={() => setRequestTarget(null)}
        />
      )}
    </div>
  );
}

// ─── ASISTENCIA PAGE ─────────────────────────────────────
function AsistenciaPage({ showToast }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = uS(today);
  const [modal, setModal] = uS(null); // null | 'masivo' | 'editar'
  const [editingAsist, setEditingAsist] = uS(null); // asistencia individual en edición
  const [editForm, setEditForm] = uS({}); // form del modal de edición individual
  const [rows, setRows] = uS([]); // estado de las filas en el modal masivo
  const [photoBlob, setPhotoBlob] = uS(null);
  const [photoUrl, setPhotoUrl] = uS(null);
  const [obraId, setObraId] = uS(null);
  const [busy, setBusy] = uS(false);

  uE(() => {
    let cancelled = false;
    const find = async () => {
      const obras = await window.__db.obras.toArray();
      const stored = window.__getObraActivaId?.();
      const a = (stored && obras.find(o => o.id === stored && !o.deleted_at))
             || obras.find(o => !o.deleted_at);
      if (a) { if (!cancelled) setObraId(a.id); }
      else if (!cancelled) setTimeout(find, 500);
    };
    find();
    return () => { cancelled = true; };
  }, []);

  const { data: personal } = window.__hooks.usePersonal(obraId);
  const { data: asistencias, loading, create: createAsistencia, update: updateAsistencia, refresh } = window.__hooks.useAsistencia(obraId);

  // Asistencia del día seleccionado
  const delDia = uM(() => asistencias?.filter(a => a.fecha === date) ?? [], [asistencias, date]);

  // KPIs del día
  const kpis = uM(() => {
    const total = personal?.filter(p => p.estado === 'activo').length ?? 0;
    const presentes = delDia.filter(a => a.estado_asistencia === 'asistio').length;
    const tardanzas = delDia.filter(a => a.estado_asistencia === 'tardanza').length;
    const faltas    = delDia.filter(a => a.estado_asistencia === 'falta').length;
    const permisos  = delDia.filter(a => a.estado_asistencia === 'permiso').length;
    const horas     = delDia.reduce((s, a) => s + Number(a.horas_trabajadas || 0), 0);
    return { total, presentes, tardanzas, faltas, permisos, horas };
  }, [delDia, personal]);

  const ESTADO_STYLE = {
    asistio:  { class:'b-green',  label:'Asistió' },
    tardanza: { class:'b-yellow', label:'Tardanza' },
    falta:    { class:'b-red',    label:'Falta' },
    permiso:  { class:'b-blue',   label:'Permiso' },
    descanso: { class:'b-gray',   label:'Descanso' },
  };

  // Mapear personal activo con su asistencia del día
  const personalConAsistencia = uM(() => {
    if (!personal) return [];
    return personal
      .filter(p => p.estado === 'activo')
      .map(p => {
        const reg = delDia.find(a => a.personal_id === p.id);
        return { ...p, asistencia: reg };
      });
  }, [personal, delDia]);

  const calcularHoras = (entrada, salida) => {
    if (!entrada || !salida) return 0;
    const [h1, m1] = entrada.split(':').map(Number);
    const [h2, m2] = salida.split(':').map(Number);
    const diff = (h2 + m2/60) - (h1 + m1/60);
    return Math.max(0, Math.round(diff * 100) / 100);
  };

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { showToast('Foto muy grande (máx 8 MB)', 'red'); return; }
    setPhotoBlob(file);
    setPhotoUrl(URL.createObjectURL(file));
  };

  // ── MODAL MASIVO ────────────────────────────────────────
  const openMasivo = () => {
    // Pre-llenar las filas con personal activo, marcando "asistio" por defecto
    // o el estado existente si ya hay asistencia para esa fecha
    const initialRows = personalConAsistencia.map(p => {
      const a = p.asistencia;
      return {
        personal_id: p.id,
        nombre: `${p.nombres || ''} ${p.apellidos || ''}`.trim(),
        cargo: p.cargo || '—',
        existing_id: a?.id || null,
        estado_asistencia: a?.estado_asistencia || 'asistio',
        hora_ingreso: a?.hora_ingreso || '07:00',
        hora_salida:  a?.hora_salida  || '17:00',
        observaciones: a?.observaciones || '',
      };
    });
    setRows(initialRows);
    setPhotoBlob(null);
    setPhotoUrl(null);
    setModal('masivo');
  };

  const updateRow = (idx, patch) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  };

  const aplicarATodos = (estado) => {
    setRows(prev => prev.map(r => ({ ...r, estado_asistencia: estado })));
  };

  const handleSubmitMasivo = async () => {
    if (rows.length === 0) {
      showToast('No hay personal activo para registrar', 'red');
      return;
    }
    setBusy(true);
    try {
      // 1. Subir UNA evidencia compartida si hay foto
      let evidId = null;
      if (photoBlob) {
        evidId = window.__newId();
        await window.__saveEvidenciaLocal({
          id: evidId,
          obra_id: obraId,
          tipo_evidencia: 'foto_asistencia',
          modulo_relacionado: 'asistencia',
          registro_relacionado_id: null, // diaria, no atada a un solo trabajador
          nombre_archivo: `asistencia_diaria_${date}.jpg`,
          mime_type: photoBlob.type || 'image/jpeg',
          blob: photoBlob,
          fecha: date,
          created_by: window.__useAuth?.()?.profile?.id || 'offline',
        });
      }

      // 2. Crear o actualizar cada asistencia
      let okCount = 0;
      let errCount = 0;
      for (const r of rows) {
        try {
          const horas = r.estado_asistencia === 'falta' ? 0 : calcularHoras(r.hora_ingreso, r.hora_salida);
          const payload = {
            obra_id: obraId,
            personal_id: r.personal_id,
            fecha: date,
            hora_ingreso: r.estado_asistencia === 'falta' ? null : r.hora_ingreso,
            hora_salida:  r.estado_asistencia === 'falta' ? null : r.hora_salida,
            horas_trabajadas: horas,
            estado_asistencia: r.estado_asistencia,
            observaciones: r.observaciones?.trim() || null,
            evidencia_id: evidId || null,
          };
          if (r.existing_id) {
            await updateAsistencia(r.existing_id, payload);
          } else {
            await createAsistencia(payload);
          }
          okCount++;
        } catch (e) {
          errCount++;
          console.warn('asistencia row failed', r.personal_id, e);
        }
      }
      refresh();
      // Audit: una sola entrada por sesión masiva — el detalle queda en new_data
      try {
        await window.__logAudit?.({
          action: 'insert',
          table: 'asistencia',
          recordId: null,
          newData: {
            fecha: date,
            ok: okCount,
            errores: errCount,
            evidencia_id: evidId,
            registros: rows.map(r => ({ personal_id: r.personal_id, estado: r.estado_asistencia, ingreso: r.hora_ingreso, salida: r.hora_salida })),
          },
          reason: `Asistencia diaria masiva (${okCount} trabajadores)`,
        });
      } catch (e) {}
      showToast(
        `Asistencia diaria guardada · ${okCount} registros${errCount ? ` · ${errCount} con error` : ''}`,
        errCount ? 'amber' : 'green'
      );
      setModal(null); setPhotoBlob(null); setPhotoUrl(null); setRows([]);
    } catch (e) {
      showToast('Error: ' + e.message, 'red');
    } finally {
      setBusy(false);
    }
  };

  // ── MODAL EDITAR INDIVIDUAL ─────────────────────────────
  const openEditar = (asistencia, p) => {
    setEditingAsist(asistencia);
    setEditForm({
      personal_nombre: `${p.nombres} ${p.apellidos}`.trim(),
      estado_asistencia: asistencia.estado_asistencia || 'asistio',
      hora_ingreso: asistencia.hora_ingreso || '07:00',
      hora_salida:  asistencia.hora_salida  || '17:00',
      observaciones: asistencia.observaciones || '',
    });
    setModal('editar');
  };

  const handleSubmitEditar = async () => {
    if (!editingAsist) return;
    setBusy(true);
    try {
      const horas = editForm.estado_asistencia === 'falta'
        ? 0
        : calcularHoras(editForm.hora_ingreso, editForm.hora_salida);
      const newFields = {
        estado_asistencia: editForm.estado_asistencia,
        hora_ingreso: editForm.estado_asistencia === 'falta' ? null : editForm.hora_ingreso,
        hora_salida:  editForm.estado_asistencia === 'falta' ? null : editForm.hora_salida,
        horas_trabajadas: horas,
        observaciones: editForm.observaciones?.trim() || null,
      };
      await updateAsistencia(editingAsist.id, newFields);
      try { await window.__logAudit?.({ action:'update', table:'asistencia', recordId:editingAsist.id, oldData:editingAsist, newData:newFields, reason:`Corrección manual de asistencia (${editForm.personal_nombre})` }); } catch(e) {}
      refresh();
      showToast('Asistencia actualizada', 'green');
      setModal(null); setEditingAsist(null); setEditForm({});
    } catch (e) {
      showToast('Error: ' + e.message, 'red');
    } finally {
      setBusy(false);
    }
  };

  if (loading || !obraId) {
    return <div className="page-wrap"><div className="empty-state"><JxIcon name="calendar" size={32} color="var(--tm)"/><p>Cargando asistencia…</p></div></div>;
  }

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div><div className="pg-title">Control de Asistencia</div><div className="pg-sub">Registro diario masivo · 1 evidencia por día</div></div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <input className="fi" type="date" value={date} onChange={e=>setDate(e.target.value)} style={{width:'auto'}}/>
          <button className="btn btn-amber btn-sm" onClick={openMasivo}>
            <JxIcon name="users" size={13}/>Registrar Asistencia Diaria
          </button>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
        {[
          {label:'Total Personal',val:kpis.total,color:'var(--blue)'},
          {label:'Presentes',val:kpis.presentes,color:'var(--green)'},
          {label:'Tardanzas',val:kpis.tardanzas,color:'var(--yellow)'},
          {label:'Faltas/Permisos',val:kpis.faltas + kpis.permisos,color:'var(--red)'},
        ].map((s,i)=>(
          <div key={i} className="card card-p" style={{borderColor:s.color+'30'}}>
            <div style={{fontSize:11,color:'var(--tm)',fontWeight:500}}>{s.label}</div>
            <div style={{fontSize:28,fontWeight:800,color:s.color,lineHeight:1.1,margin:'6px 0 2px'}}>{s.val}</div>
            <div className="progress-bar"><div className="progress-fill" style={{width:`${kpis.total ? (s.val/kpis.total)*100 : 0}%`,background:s.color}}/></div>
          </div>
        ))}
      </div>

      <div className="card" style={{overflow:'hidden'}}>
        <table className="tbl">
          <thead><tr>
            <th>Trabajador</th><th>Cargo</th><th>H. Ingreso</th>
            <th>H. Salida</th><th>Hrs. Trabajadas</th><th>Estado</th><th>Evidencia</th><th>Acciones</th>
          </tr></thead>
          <tbody>
            {personalConAsistencia.length === 0 ? (
              <tr><td colSpan={8} style={{textAlign:'center', padding:32, color:'var(--tm)'}}>No hay personal registrado en esta obra</td></tr>
            ) : personalConAsistencia.map(p => {
              const a = p.asistencia;
              const e = a ? ESTADO_STYLE[a.estado_asistencia] : null;
              return (
                <tr key={p.id}>
                  <td className="col-p">{p.nombres} {p.apellidos}</td>
                  <td>{p.cargo || '—'}</td>
                  <td className="col-num">{a?.hora_ingreso || '—'}</td>
                  <td className="col-num">{a?.hora_salida || '—'}</td>
                  <td className="col-num"><span style={{color:a?.horas_trabajadas>0?'var(--tp)':'var(--tm)',fontWeight:600}}>{a?.horas_trabajadas>0 ? Number(a.horas_trabajadas).toFixed(1)+' h' : '—'}</span></td>
                  <td>{e ? <span className={`badge ${e.class}`}>{e.label}</span> : <span className="badge b-gray">Sin marcar</span>}</td>
                  <td>{a?.evidencia_id ? <span className="badge b-blue"><JxIcon name="camera" size={10}/> Foto</span> : <span className="col-m">—</span>}</td>
                  <td>
                    {a && (
                      <button className="btn btn-ghost btn-xs" title="Editar asistencia" onClick={()=>openEditar(a, p)}>
                        <JxIcon name="edit" size={11}/>
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{padding:'12px 16px',borderTop:'1px solid var(--border)',fontSize:11.5,color:'var(--tm)'}}>
          <span>Total horas trabajadas: <strong style={{color:'var(--tp)'}}>{kpis.horas.toFixed(1)} hrs</strong></span>
        </div>
      </div>

      {/* ── MODAL MASIVO — registro diario de toda la cuadrilla ── */}
      {modal === 'masivo' && <Modal title={`Asistencia Diaria · ${date}`} icon="users" onClose={()=>{setModal(null); setPhotoBlob(null); setPhotoUrl(null); setRows([]);}}>
        {rows.length === 0 ? (
          <div style={{padding:'30px 0', textAlign:'center', color:'var(--tm)'}}>
            <JxIcon name="users" size={32} color="var(--tm)"/>
            <p style={{fontSize:13, marginTop:8}}>No hay personal activo en esta obra. Registra trabajadores primero.</p>
          </div>
        ) : (
        <>
          <div style={{display:'flex', gap:8, marginBottom:12, flexWrap:'wrap', alignItems:'center'}}>
            <span style={{fontSize:11.5, color:'var(--tm)'}}>Aplicar a todos:</span>
            <button className="btn btn-green btn-xs" onClick={()=>aplicarATodos('asistio')}>✓ Asistió</button>
            <button className="btn btn-ghost btn-xs" onClick={()=>aplicarATodos('tardanza')}>Tardanza</button>
            <button className="btn btn-red btn-xs" onClick={()=>aplicarATodos('falta')}>Falta</button>
            <button className="btn btn-blue btn-xs" onClick={()=>aplicarATodos('permiso')}>Permiso</button>
            <button className="btn btn-ghost btn-xs" onClick={()=>aplicarATodos('descanso')}>Descanso</button>
          </div>

          <div style={{maxHeight:'45vh', overflowY:'auto', border:'1px solid var(--border)', borderRadius:8}}>
            <table className="tbl" style={{minWidth:560}}>
              <thead><tr>
                <th>Trabajador</th><th>Estado</th><th>Ingreso</th><th>Salida</th><th>Observaciones</th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const isFalta = r.estado_asistencia === 'falta';
                  return (
                    <tr key={r.personal_id}>
                      <td className="col-p" style={{fontSize:12}}>
                        {r.nombre}
                        {r.cargo !== '—' && <div style={{fontSize:10.5, color:'var(--tm)'}}>{r.cargo}</div>}
                      </td>
                      <td>
                        <select className="fi" style={{padding:'5px 8px', fontSize:11.5}}
                                value={r.estado_asistencia}
                                onChange={e=>updateRow(i, { estado_asistencia: e.target.value })}>
                          <option value="asistio">Asistió</option>
                          <option value="tardanza">Tardanza</option>
                          <option value="falta">Falta</option>
                          <option value="permiso">Permiso</option>
                          <option value="descanso">Descanso</option>
                        </select>
                      </td>
                      <td>
                        <input className="fi" type="time" disabled={isFalta} style={{padding:'5px 8px', fontSize:11.5, opacity: isFalta ? 0.4 : 1}}
                               value={r.hora_ingreso}
                               onChange={e=>updateRow(i, { hora_ingreso: e.target.value })}/>
                      </td>
                      <td>
                        <input className="fi" type="time" disabled={isFalta} style={{padding:'5px 8px', fontSize:11.5, opacity: isFalta ? 0.4 : 1}}
                               value={r.hora_salida}
                               onChange={e=>updateRow(i, { hora_salida: e.target.value })}/>
                      </td>
                      <td>
                        <input className="fi" placeholder="—" style={{padding:'5px 8px', fontSize:11.5}}
                               value={r.observaciones}
                               onChange={e=>updateRow(i, { observaciones: e.target.value })}/>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{marginTop:16}}>
            <label className="flabel">Evidencia diaria (foto del formato físico firmado)</label>
            {photoUrl ? (
              <div style={{position:'relative', display:'inline-block'}}>
                <img src={photoUrl} alt="evidencia diaria" style={{maxHeight:180, borderRadius:8, border:'1px solid var(--border)'}}/>
                <button onClick={()=>{setPhotoBlob(null); setPhotoUrl(null);}}
                        style={{position:'absolute', top:6, right:6, background:'rgba(231,76,60,0.9)', color:'white', border:'none', borderRadius:'50%', width:24, height:24, cursor:'pointer'}}>×</button>
              </div>
            ) : (
              <label style={{display:'block', border:'1.5px dashed var(--border-h)', borderRadius:8, padding:'16px', textAlign:'center', color:'var(--tm)', fontSize:12, cursor:'pointer'}}>
                <JxIcon name="camera" size={20} color="var(--tm)"/>
                <div style={{marginTop:6}}>Subir foto del formato firmado del día</div>
                <div style={{marginTop:2, fontSize:10.5}}>(Una sola foto para toda la cuadrilla)</div>
                <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} style={{display:'none'}}/>
              </label>
            )}
          </div>
        </>
        )}

        <div className="modal-actions">
          <button className="btn btn-ghost" disabled={busy} onClick={()=>{setModal(null); setPhotoBlob(null); setPhotoUrl(null); setRows([]);}}>Cancelar</button>
          <button className="btn btn-amber" disabled={busy || rows.length === 0} onClick={handleSubmitMasivo}>
            <JxIcon name="check" size={13}/>{busy ? 'Guardando…' : `Guardar ${rows.length} registros`}
          </button>
        </div>
      </Modal>}

      {/* ── MODAL EDITAR INDIVIDUAL ── */}
      {modal === 'editar' && <Modal title={`Editar Asistencia · ${editForm.personal_nombre || ''}`} icon="edit" onClose={()=>{setModal(null); setEditingAsist(null); setEditForm({});}}>
        <div className="g2">
          <div style={{gridColumn:'1/-1'}}><label className="flabel">Estado</label>
            <select className="fi" value={editForm.estado_asistencia||'asistio'} onChange={e=>setEditForm({...editForm, estado_asistencia:e.target.value})}>
              <option value="asistio">Asistió</option>
              <option value="tardanza">Tardanza</option>
              <option value="falta">Falta</option>
              <option value="permiso">Permiso</option>
              <option value="descanso">Descanso</option>
            </select>
          </div>
          {editForm.estado_asistencia !== 'falta' && <>
            <div><label className="flabel">Hora ingreso</label><input className="fi" type="time" value={editForm.hora_ingreso||''} onChange={e=>setEditForm({...editForm, hora_ingreso:e.target.value})}/></div>
            <div><label className="flabel">Hora salida</label><input className="fi" type="time" value={editForm.hora_salida||''} onChange={e=>setEditForm({...editForm, hora_salida:e.target.value})}/></div>
          </>}
          <div style={{gridColumn:'1/-1'}}><label className="flabel">Observaciones</label>
            <textarea className="fi" value={editForm.observaciones||''} onChange={e=>setEditForm({...editForm, observaciones:e.target.value})} placeholder="Opcional..."/>
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" disabled={busy} onClick={()=>{setModal(null); setEditingAsist(null); setEditForm({});}}>Cancelar</button>
          <button className="btn btn-amber" disabled={busy} onClick={handleSubmitEditar}>
            <JxIcon name="check" size={13}/>{busy ? 'Guardando…' : 'Guardar Cambios'}
          </button>
        </div>
      </Modal>}
    </div>
  );
}

Object.assign(window, { MaterialesPage, HerramientasPage, PersonalPage, AsistenciaPage, Modal });