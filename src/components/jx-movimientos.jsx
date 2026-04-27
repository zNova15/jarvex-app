import React from "react";
const { useState: uSM, useMemo: uMM, useEffect: uEM } = React;

// Helper formato moneda
const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

// Helper detectar obra activa
function useObraActiva() {
  const [obraId, setObraId] = uSM(null);
  uEM(() => {
    let cancelled = false;
    const find = async () => {
      const obras = await window.__db.obras.toArray();
      const a = obras.find(o => !o.deleted_at);
      if (a) { if (!cancelled) setObraId(a.id); }
      else if (!cancelled) setTimeout(find, 500);
    };
    find();
    return () => { cancelled = true; };
  }, []);
  return obraId;
}

const MOV_MAT_TIPO = {
  entrada:    { cls:'b-green',  lbl:'Entrada',    icon:'arrowIn'  },
  salida:     { cls:'b-orange', lbl:'Salida',     icon:'arrowOut' },
  ajuste:     { cls:'b-blue',   lbl:'Ajuste',     icon:'edit'     },
  devolucion: { cls:'b-blue',   lbl:'Devolución', icon:'arrowIn'  },
  merma:      { cls:'b-red',    lbl:'Merma',      icon:'alert'    },
};

const MOV_HER_ACCION = {
  salida:        { cls:'b-amber',  lbl:'Salida',        icon:'arrowOut'   },
  entrada:       { cls:'b-green',  lbl:'Entrada',       icon:'arrowIn'    },
  mantenimiento: { cls:'b-orange', lbl:'Mantenimiento', icon:'tool'       },
  baja:          { cls:'b-gray',   lbl:'Baja',          icon:'trash'      },
  reposicion:    { cls:'b-blue',   lbl:'Reposición',    icon:'plus'       },
};

const EST_HER = {
  nuevo: 'b-blue', bueno: 'b-green', regular: 'b-yellow', malo: 'b-red',
  mantenimiento: 'b-orange', baja: 'b-gray',
};

// ─── MOV. MATERIALES PAGE ─────────────────────────────────
function MovMaterialesPage({ showToast }) {
  const obraId = useObraActiva();
  const { data: movs, loading } = window.__hooks.useMovimientosMateriales(obraId);
  const { data: materiales } = window.__hooks.useMateriales(obraId);
  const { data: personal } = window.__hooks.usePersonal(obraId);

  const [provs, setProvs] = uSM([]);
  const [partidas, setPartidas] = uSM([]);
  uEM(() => {
    const load = () => {
      window.__db.proveedores.toArray().then(setProvs);
      window.__db.partidas.toArray().then(setPartidas);
    };
    load();
    const interval = setInterval(load, 2000);
    return () => clearInterval(interval);
  }, []);

  const [q, setQ] = uSM('');
  const [tipo, setTipo] = uSM('todos');

  const lookupMat = (id) => materiales?.find(m => m.id === id);
  const lookupPers = (id) => personal?.find(p => p.id === id);
  const lookupProv = (id) => provs?.find(p => p.id === id);
  const lookupPart = (id) => partidas?.find(p => p.id === id);

  const sorted = uMM(() => {
    if (!movs) return [];
    return [...movs].sort((a, b) => {
      const fa = (a.fecha || '') + ' ' + (a.hora || '');
      const fb = (b.fecha || '') + ' ' + (b.hora || '');
      return fb.localeCompare(fa);
    });
  }, [movs]);

  const filtered = uMM(() => {
    return sorted.filter(m => {
      const matchT = tipo === 'todos' || m.tipo_movimiento === tipo;
      if (!matchT) return false;
      if (!q) return true;
      const mat = lookupMat(m.material_id);
      const ql = q.toLowerCase();
      return (mat?.nombre_material || '').toLowerCase().includes(ql) ||
             (m.documento_asociado || '').toLowerCase().includes(ql);
    });
  }, [sorted, q, tipo, materiales]);

  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7);

  const stats = uMM(() => ({
    total: sorted.length,
    entradasHoy: sorted.filter(m => m.fecha === today && m.tipo_movimiento === 'entrada').length,
    salidasHoy: sorted.filter(m => m.fecha === today && m.tipo_movimiento === 'salida').length,
    valorMes: sorted
      .filter(m => (m.fecha || '').startsWith(monthStart) && m.tipo_movimiento === 'entrada')
      .reduce((s, m) => s + (Number(m.precio_unitario_real || 0) * Number(m.cantidad || 0)), 0),
  }), [sorted]);

  if (loading || !obraId) return <div className="page-wrap"><div className="empty-state"><JxIcon name="arrowIn" size={32} color="var(--tm)"/><p>Cargando movimientos…</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div><div className="pg-title">Movimiento de Materiales</div><div className="pg-sub">Historial completo · {sorted.length} movimientos registrados</div></div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:18 }}>
        {[
          { label:'Total Movimientos', val:stats.total.toLocaleString('es-PE'), color:'var(--blue)' },
          { label:'Entradas Hoy',      val:stats.entradasHoy.toLocaleString('es-PE'), color:'var(--green)' },
          { label:'Salidas Hoy',       val:stats.salidasHoy.toLocaleString('es-PE'),  color:'var(--orange)' },
          { label:'Valor Entradas Mes', val:fmtS(stats.valorMes), color:'var(--amber)' },
        ].map((s,i)=>(
          <div key={i} className="card card-p"><div style={{ fontSize:11, color:'var(--tm)' }}>{s.label}</div><div style={{ fontSize:24, fontWeight:800, color:s.color, margin:'4px 0' }}>{s.val}</div></div>
        ))}
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
        <div className="search-bar"><JxIcon name="search" size={14} color="var(--tm)"/><input placeholder="Buscar material o documento…" value={q} onChange={e=>setQ(e.target.value)}/></div>
        {['todos','entrada','salida','ajuste','devolucion','merma'].map(t=>(
          <button key={t} onClick={()=>setTipo(t)} className={`btn btn-sm ${tipo===t?'btn-amber':'btn-ghost'}`}>
            {t==='todos' ? 'Todos' : MOV_MAT_TIPO[t]?.lbl || t}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card card-p empty-state"><JxIcon name="arrowIn" size={40} color="var(--tm)"/><p>No hay movimientos {tipo!=='todos' || q ? 'que coincidan con el filtro' : 'registrados aún'}.</p></div>
      ) : (
      <div className="card" style={{ overflow:'hidden' }}>
        <div style={{ overflowX:'auto' }}>
          <table className="tbl">
            <thead><tr>
              <th>Fecha / Hora</th><th>Tipo</th><th>Material</th>
              <th style={{ textAlign:'right' }}>Cantidad</th>
              <th>Responsable</th><th>Documento</th>
              <th style={{ textAlign:'right' }}>Precio</th><th>Sync</th>
            </tr></thead>
            <tbody>
              {filtered.map(m=>{
                const t = MOV_MAT_TIPO[m.tipo_movimiento] || MOV_MAT_TIPO.ajuste;
                const mat = lookupMat(m.material_id);
                const pers = lookupPers(m.responsable_id);
                const prov = lookupProv(m.proveedor_id);
                return (
                  <tr key={m.id}>
                    <td className="col-m">{m.fecha || '—'}<br/><span style={{ fontSize:11 }}>{m.hora || ''}</span></td>
                    <td><span className={`badge ${t.cls}`}><JxIcon name={t.icon} size={10}/>{t.lbl}</span></td>
                    <td className="col-p">{mat?.nombre_material || '(material eliminado)'}</td>
                    <td style={{ textAlign:'right' }} className="col-num">{Number(m.cantidad || 0).toLocaleString('es-PE')} <span style={{ color:'var(--tm)', fontSize:11 }}>{m.unidad || mat?.unidad || ''}</span></td>
                    <td>{pers ? `${pers.nombres} ${pers.apellidos}` : (prov?.razon_social || '—')}</td>
                    <td className="col-m">{m.documento_asociado || '—'}</td>
                    <td style={{ textAlign:'right' }} className="col-num">{m.precio_unitario_real ? fmtS(m.precio_unitario_real) : '—'}</td>
                    <td>{m.sync_status && m.sync_status !== 'synced'
                      ? <span className="badge b-amber" title={m.sync_status}>⏱</span>
                      : <span style={{color:'var(--green)',fontSize:11}}>✓</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding:'10px 16px', borderTop:'1px solid var(--border)', fontSize:11.5, color:'var(--tm)' }}>
          Mostrando {filtered.length} de {sorted.length} movimientos
        </div>
      </div>
      )}
    </div>
  );
}

// ─── MOV. HERRAMIENTAS PAGE ───────────────────────────────
function MovHerramientasPage({ showToast }) {
  const obraId = useObraActiva();
  const { data: movs, loading } = window.__hooks.useMovimientosHerramientas(obraId);
  const { data: herramientas } = window.__hooks.useHerramientas(obraId);
  const { data: personal } = window.__hooks.usePersonal(obraId);

  const [q, setQ] = uSM('');
  const [accion, setAccion] = uSM('todas');

  const lookupHerr = (id) => herramientas?.find(h => h.id === id);
  const lookupPers = (id) => personal?.find(p => p.id === id);

  const sorted = uMM(() => {
    if (!movs) return [];
    return [...movs].sort((a, b) => {
      const fa = (a.fecha || '') + ' ' + (a.hora || '');
      const fb = (b.fecha || '') + ' ' + (b.hora || '');
      return fb.localeCompare(fa);
    });
  }, [movs]);

  const filtered = uMM(() => {
    return sorted.filter(m => {
      const matchA = accion === 'todas' || m.accion === accion;
      if (!matchA) return false;
      if (!q) return true;
      const ql = q.toLowerCase();
      const h = lookupHerr(m.herramienta_id);
      const p = lookupPers(m.responsable_id);
      return (h?.nombre_herramienta || '').toLowerCase().includes(ql) ||
             (p ? `${p.nombres} ${p.apellidos}`.toLowerCase().includes(ql) : false);
    });
  }, [sorted, q, accion, herramientas, personal]);

  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7*24*60*60*1000).toISOString().slice(0, 10);

  const stats = uMM(() => ({
    total: sorted.length,
    salidasHoy: sorted.filter(m => m.fecha === today && m.accion === 'salida').length,
    devolHoy: sorted.filter(m => m.fecha === today && m.accion === 'entrada').length,
    danadas: sorted.filter(m => m.estado_devolucion === 'malo').length,
  }), [sorted]);

  const danadasRecientes = uMM(() =>
    sorted.filter(m => m.estado_devolucion === 'malo' && (m.fecha || '') >= sevenDaysAgo)
  , [sorted]);

  if (loading || !obraId) return <div className="page-wrap"><div className="empty-state"><JxIcon name="tool" size={32} color="var(--tm)"/><p>Cargando movimientos…</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div><div className="pg-title">Movimiento de Herramientas</div><div className="pg-sub">Historial de salidas, devoluciones y mantenimientos · {sorted.length} registros</div></div>
      </div>

      {danadasRecientes.length > 0 && (
        <div className="alert-banner" style={{ marginBottom:14, background:'rgba(231,76,60,0.08)', border:'1px solid rgba(231,76,60,0.25)', borderRadius:8, padding:'10px 14px', display:'flex', alignItems:'center', gap:10, color:'var(--red)', fontSize:12.5 }}>
          <JxIcon name="alert" size={14} color="var(--red)"/>
          <span><strong>{danadasRecientes.length}</strong> herramienta{danadasRecientes.length>1?'s':''} devuelta{danadasRecientes.length>1?'s':''} en mal estado en los últimos 7 días.</span>
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:18 }}>
        {[
          { label:'Total Movimientos',     val:stats.total.toLocaleString('es-PE'),       color:'var(--blue)' },
          { label:'Salidas Hoy',           val:stats.salidasHoy.toLocaleString('es-PE'),  color:'var(--amber)' },
          { label:'Devoluciones Hoy',      val:stats.devolHoy.toLocaleString('es-PE'),    color:'var(--green)' },
          { label:'Herramientas Dañadas',  val:stats.danadas.toLocaleString('es-PE'),     color:'var(--red)' },
        ].map((s,i)=>(
          <div key={i} className="card card-p"><div style={{ fontSize:11, color:'var(--tm)' }}>{s.label}</div><div style={{ fontSize:26, fontWeight:800, color:s.color, margin:'4px 0' }}>{s.val}</div></div>
        ))}
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
        <div className="search-bar"><JxIcon name="search" size={14} color="var(--tm)"/><input placeholder="Buscar herramienta o responsable…" value={q} onChange={e=>setQ(e.target.value)}/></div>
        {['todas','salida','entrada','mantenimiento','baja','reposicion'].map(a=>(
          <button key={a} onClick={()=>setAccion(a)} className={`btn btn-sm ${accion===a?'btn-amber':'btn-ghost'}`}>
            {a==='todas' ? 'Todas' : MOV_HER_ACCION[a]?.lbl || a}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card card-p empty-state"><JxIcon name="tool" size={40} color="var(--tm)"/><p>No hay movimientos {accion!=='todas' || q ? 'que coincidan con el filtro' : 'registrados aún'}.</p></div>
      ) : (
      <div className="card" style={{ overflow:'hidden' }}>
        <div style={{ overflowX:'auto' }}>
          <table className="tbl">
            <thead><tr>
              <th>Fecha / Hora</th><th>Herramienta</th><th>Acción</th>
              <th>Responsable</th><th>Estado Salida</th><th>Estado Devol.</th>
              <th>Observaciones</th><th>Sync</th>
            </tr></thead>
            <tbody>
              {filtered.map(m=>{
                const a = MOV_HER_ACCION[m.accion] || MOV_HER_ACCION.salida;
                const h = lookupHerr(m.herramienta_id);
                const p = lookupPers(m.responsable_id);
                const danado = m.estado_devolucion === 'malo';
                return (
                  <tr key={m.id} style={{ background: danado ? 'rgba(231,76,60,0.06)' : '' }}>
                    <td className="col-m">{m.fecha || '—'}<br/><span style={{ fontSize:11 }}>{m.hora || ''}</span></td>
                    <td className="col-p">{h?.nombre_herramienta || '(herramienta eliminada)'}</td>
                    <td><span className={`badge ${a.cls}`}><JxIcon name={a.icon} size={10}/>{a.lbl}</span></td>
                    <td>{p ? `${p.nombres} ${p.apellidos}` : '—'}</td>
                    <td>{m.estado_salida ? <span className={`badge ${EST_HER[m.estado_salida]||'b-gray'}`} style={{ textTransform:'capitalize' }}>{m.estado_salida}</span> : <span className="col-m">—</span>}</td>
                    <td>{m.estado_devolucion ? <span className={`badge ${EST_HER[m.estado_devolucion]||'b-gray'}`} style={{ textTransform:'capitalize' }}>{m.estado_devolucion}</span> : <span className="col-m">—</span>}</td>
                    <td className="col-m" style={{ color: danado?'var(--red)':'', fontSize:11 }}>{m.observaciones || '—'}</td>
                    <td>{m.sync_status && m.sync_status !== 'synced'
                      ? <span className="badge b-amber" title={m.sync_status}>⏱</span>
                      : <span style={{color:'var(--green)',fontSize:11}}>✓</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding:'10px 16px', borderTop:'1px solid var(--border)', fontSize:11.5, color:'var(--tm)' }}>
          Mostrando {filtered.length} de {sorted.length} movimientos
        </div>
      </div>
      )}
    </div>
  );
}

// ─── PROVEEDORES PAGE ─────────────────────────────────────
function ProveedoresPage({ showToast }) {
  // Hooks SIEMPRE al top-level del componente, nunca dentro de handlers/callbacks
  // (llamarlos en un onClick rompe las reglas de React → minified error #321).
  const auth = window.__useAuth ? window.__useAuth() : null;

  const [provs, setProvs] = uSM([]);
  const [loading, setLoading] = uSM(true);

  uEM(() => {
    const load = () => window.__db.proveedores.toArray().then(d => { setProvs(d); setLoading(false); });
    load();
    const interval = setInterval(load, 2000);
    return () => clearInterval(interval);
  }, []);

  const [q, setQ] = uSM('');
  const [modal, setModal] = uSM(false);
  const [form, setForm] = uSM({});

  const filtered = uMM(() => {
    if (!q) return provs;
    const ql = q.toLowerCase();
    return provs.filter(p =>
      (p.razon_social || '').toLowerCase().includes(ql) ||
      (p.ruc || '').toLowerCase().includes(ql)
    );
  }, [q, provs]);

  const handleSubmit = async () => {
    const razon = (form.razon_social || '').trim();
    const ruc = (form.ruc || '').trim();
    if (!razon) { showToast('Falta la razón social', 'red'); return; }
    if (!ruc) { showToast('Falta el RUC', 'red'); return; }
    if (!/^\d{11}$/.test(ruc)) { showToast('El RUC debe tener exactamente 11 dígitos numéricos', 'red'); return; }
    // Validar RUC único local
    const existe = provs.find(p => p.ruc === ruc);
    if (existe) { showToast('RUC ya registrado', 'red'); return; }
    try {
      await window.__db.proveedores.add({
        id: window.__newId(),
        razon_social: razon,
        ruc,
        contacto: form.contacto?.trim() || null,
        telefono: form.telefono?.trim() || null,
        correo: form.correo?.trim() || null,
        tipo_proveedor: form.tipo_proveedor || null,
        direccion: form.direccion?.trim() || null,
        observaciones: form.observaciones?.trim() || null,
        estado: 'activo',
        sync_status: 'pending_create',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: 1,
        created_by: auth?.profile?.id || 'offline',
      });
      showToast(`Proveedor "${razon}" creado`, 'green');
      setModal(false); setForm({});
      window.__db.proveedores.toArray().then(setProvs);
    } catch (e) {
      if (String(e?.message || '').includes('23505') || String(e?.name || '') === 'ConstraintError') {
        showToast('RUC ya registrado', 'red');
      } else {
        showToast('Error: ' + e.message, 'red');
      }
    }
  };

  if (loading) return <div className="page-wrap"><div className="empty-state"><JxIcon name="truck" size={32} color="var(--tm)"/><p>Cargando proveedores…</p></div></div>;

  const activos = provs.filter(p => p.estado === 'activo').length;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div><div className="pg-title">Proveedores</div><div className="pg-sub">{provs.length} proveedores · {activos} activos</div></div>
        <button className="btn btn-amber btn-sm" onClick={()=>{setForm({}); setModal(true);}}><JxIcon name="plus" size={13}/>Nuevo Proveedor</button>
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:14 }}>
        <div className="search-bar"><JxIcon name="search" size={14} color="var(--tm)"/><input placeholder="Buscar por razón social o RUC…" value={q} onChange={e=>setQ(e.target.value)}/></div>
      </div>

      {provs.length === 0 ? (
        <div className="card card-p empty-state"><JxIcon name="truck" size={40} color="var(--tm)"/><p>No hay proveedores registrados. Click en "Nuevo Proveedor".</p></div>
      ) : filtered.length === 0 ? (
        <div className="card card-p empty-state"><JxIcon name="search" size={40} color="var(--tm)"/><p>No se encontraron proveedores con ese criterio.</p></div>
      ) : (
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
        {filtered.map(p => (
          <div key={p.id} className="card card-p card-hover">
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10, gap:10 }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:14, fontWeight:700, color:'var(--tp)', marginBottom:3 }}>{p.razon_social}</div>
                <div style={{ fontSize:11, color:'var(--tm)' }}>RUC: <span className="col-m" style={{ color:'var(--ts)' }}>{p.ruc}</span></div>
              </div>
              <span className={`badge ${p.estado==='activo'?'b-green':'b-gray'}`} style={{ textTransform:'capitalize', flexShrink:0 }}>{p.estado || 'activo'}</span>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8 }}>
              <div style={{ fontSize:11.5 }}>
                <div style={{ color:'var(--tm)', fontSize:10, marginBottom:2 }}>CONTACTO</div>
                <div style={{ color:'var(--ts)' }}>{p.contacto || '—'}</div>
              </div>
              <div style={{ fontSize:11.5 }}>
                <div style={{ color:'var(--tm)', fontSize:10, marginBottom:2 }}>TELÉFONO</div>
                <div style={{ color:'var(--ts)' }}>{p.telefono || '—'}</div>
              </div>
            </div>
            {p.tipo_proveedor && <div style={{ marginTop:6 }}><span className="tag">{p.tipo_proveedor}</span></div>}
            {p.sync_status && p.sync_status !== 'synced' && (
              <div style={{ marginTop:8 }}><span className="badge b-amber" title={p.sync_status}>⏱ {p.sync_status}</span></div>
            )}
          </div>
        ))}
      </div>
      )}

      {modal && <Modal title="Nuevo Proveedor" icon="truck" onClose={()=>setModal(false)}>
        <div className="g2">
          <div style={{ gridColumn:'1/-1' }}><label className="flabel">Razón Social *</label><input className="fi" placeholder="Nombre de la empresa" value={form.razon_social||''} onChange={e=>setForm({...form, razon_social:e.target.value})}/></div>
          <div><label className="flabel">RUC *</label><input className="fi" placeholder="20XXXXXXXXX" inputMode="numeric" maxLength={11} value={form.ruc||''} onChange={e=>setForm({...form, ruc:e.target.value.replace(/\D/g,'').slice(0,11)})}/></div>
          <div><label className="flabel">Tipo de Proveedor</label>
            <select className="fi" value={form.tipo_proveedor||''} onChange={e=>setForm({...form, tipo_proveedor:e.target.value})}>
              <option value="">— Selecciona —</option>
              <option>Aglomerantes</option><option>Acero</option><option>Agregados</option>
              <option>Madera</option><option>Sanitario</option><option>Eléctrico</option>
              <option>Albañilería</option><option>Acabados</option><option>Servicios</option>
              <option>Otro</option>
            </select>
          </div>
          <div><label className="flabel">Nombre de Contacto</label><input className="fi" placeholder="Nombre completo" value={form.contacto||''} onChange={e=>setForm({...form, contacto:e.target.value})}/></div>
          <div><label className="flabel">Teléfono</label><input className="fi" placeholder="01-XXX-XXXX" value={form.telefono||''} onChange={e=>setForm({...form, telefono:e.target.value})}/></div>
          <div style={{ gridColumn:'1/-1' }}><label className="flabel">Correo Electrónico</label><input className="fi" type="email" placeholder="correo@empresa.com" value={form.correo||''} onChange={e=>setForm({...form, correo:e.target.value})}/></div>
          <div style={{ gridColumn:'1/-1' }}><label className="flabel">Dirección</label><input className="fi" placeholder="Av. / Calle, número, distrito" value={form.direccion||''} onChange={e=>setForm({...form, direccion:e.target.value})}/></div>
          <div style={{ gridColumn:'1/-1' }}><label className="flabel">Observaciones</label><textarea className="fi" placeholder="Condiciones de pago, tiempos de entrega, etc." value={form.observaciones||''} onChange={e=>setForm({...form, observaciones:e.target.value})}/></div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={()=>setModal(false)}>Cancelar</button>
          <button className="btn btn-amber" onClick={handleSubmit}><JxIcon name="check" size={13}/>Guardar Proveedor</button>
        </div>
      </Modal>}
    </div>
  );
}

Object.assign(window, { MovMaterialesPage, MovHerramientasPage, ProveedoresPage });
