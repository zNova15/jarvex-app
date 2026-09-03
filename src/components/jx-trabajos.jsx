// ═══════════════════════════════════════════════════════════════════
// JARVEX — Bienes y Servicios (mig 174).
//
// El flujo corto de docs/tanda-1-modelo-de-datos.md §3: cotizo al cliente,
// compro al proveedor, vendo. O presto el servicio y facturo. Sin partidas,
// sin cronograma, sin avance físico, sin personal de campo — un responsable
// único y listo.
//
// LO QUE ESTA PANTALLA NO HACE: registrar la compra y la venta. Esas son
// facturas, y las facturas se cargan donde siempre (Movimientos Contables o
// Captura Mágica) eligiendo el trabajo al que se imputan. Acá solo se ven
// agrupadas, con el margen CALCULADO al vuelo (src/lib/trabajos.js). Duplicar
// la carga de facturas acá habría creado un segundo camino para el mismo dato.
//
// La página NO cuelga de la obra activa: un trabajo de bienes y servicios no
// pertenece a ninguna obra. Va en GENERAL_ITEMS (src/lib/nav-planos.js).
//
// Usa Modal / JxIcon (globales).
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import {
  TIPOS, ESTADOS, ESTADOS_COTIZACION, TIPO_LBL, ESTADO_LBL, ESTADO_BADGE,
  COT_LBL, COT_BADGE, cotizacionesDe, cotizacionAceptada, esAbierto,
  resumenEconomico, totales, validarTrabajo, filtrarTrabajos,
} from "../lib/trabajos.js";
import {
  TIPOS_TRABAJO, ESTADO_OBRA_LBL, ESTADO_OBRA_BADGE, normalizarEstadoObra,
  TIPO_TRABAJO_DEFAULT, ORIGEN_DEFAULT,
} from "../lib/tipos-trabajo.js";
import { etiquetaEjecutora } from "../lib/consorcio.js";
const { useState: uST, useMemo: uMT, useRef: uRT } = React;

const fmt = (n, moneda = 'PEN') =>
  (moneda === 'USD' ? '$ ' : 'S/ ') +
  Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function BienesServiciosPage({ showToast }) {
  const { data: trabajos } = window.__hooks.useTrabajos?.() || { data: [] };
  const { data: cotizaciones } = window.__hooks.useTrabajoCotizaciones?.() || { data: [] };
  const { data: movs } = window.__hooks.useAccountingMovements?.() || { data: [] };
  const { data: companies } = window.__hooks.useCompanies?.() || { data: [] };
  const { data: consorcios } = window.__hooks.useConsorcios?.() || { data: [] };

  const auth = window.__useAuth?.();
  const myRol = auth?.profile?.rol;
  const isAdmin = myRol === 'admin';
  const userId = auth?.profile?.id ?? 'offline';
  const canWrite = isAdmin || (window.__hasPerm?.(myRol, 'Bienes y Servicios', 'w') ?? false);

  const [filtro, setFiltro] = uST({ texto: '', estado: '', tipo: '' });
  const [moneda, setMoneda] = uST('PEN');
  const [modal, setModal] = uST(null);        // null | 'nuevo' | 'editar'
  const [form, setForm] = uST({});
  const [editingId, setEditingId] = uST(null);
  const [detalleId, setDetalleId] = uST(null);
  const [cotModal, setCotModal] = uST(null);  // null | {} | cotización a editar
  const [guardando, setGuardando] = uST(false);

  // Solo empresas del grupo: quien vende es una empresa nuestra, no un proveedor.
  const companiesPropias = uMT(
    () => (companies || []).filter(c => !c.deleted_at && c.status === 'activa' && (c.tipo_entidad || 'propia') === 'propia'),
    [companies]);
  const nombreDe = (id) => (companies || []).find(c => c.id === id)?.name || '—';

  const lista = uMT(() => filtrarTrabajos(trabajos, filtro), [trabajos, filtro]);
  const tot = uMT(() => totales(lista, movs, moneda), [lista, movs, moneda]);
  const detalle = uMT(() => (trabajos || []).find(t => t.id === detalleId) || null, [trabajos, detalleId]);

  // Guard SÍNCRONO: el de estado se activa recién tras el primer await a Dexie
  // y un segundo click en esa ventana duplica el trabajo (regla crítica 2).
  const enCursoRef = uRT(false);
  const guardar = async () => {
    if (enCursoRef.current) return;
    enCursoRef.current = true;
    try { await guardarInner(); } finally { enCursoRef.current = false; }
  };

  const guardarInner = async () => {
    const v = validarTrabajo(form);
    if (!v.ok) { showToast?.(v.errores[0], 'red'); return; }
    setGuardando(true);
    const now = new Date().toISOString();
    const campos = {
      codigo: form.codigo?.trim() || null,
      nombre: form.nombre.trim(),
      tipo: form.tipo,
      origen: form.origen || 'privado',
      cliente: form.cliente?.trim() || null,
      cliente_ruc: form.cliente_ruc?.trim() || null,
      ejecutor_company_id: form.ejecutor_company_id || null,
      consorcio_id: form.consorcio_id || null,
      responsable_id: form.responsable_id || null,
      estado: form.estado,
      monto_estimado: form.monto_estimado === '' || form.monto_estimado == null ? null : Number(form.monto_estimado),
      moneda: form.moneda || 'PEN',
      fecha_inicio: form.fecha_inicio || null,
      fecha_fin: form.fecha_fin || null,
      observaciones: form.observaciones?.trim() || null,
      updated_at: now, updated_by: userId,
    };
    try {
      if (editingId) {
        const orig = (trabajos || []).find(t => t.id === editingId);
        await window.__db.trabajos.update(editingId, {
          ...campos,
          version: (orig?.version ?? 0) + 1,
          sync_status: orig?.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
        try { await window.__logAudit?.({ action:'update', table:'trabajos', recordId:editingId, oldData:orig, newData:campos }); } catch {}
        showToast?.(`"${campos.nombre}" actualizado`, 'green');
      } else {
        const id = window.__newId();
        const rec = {
          id, ...campos,
          created_at: now, created_by: userId,
          version: 1, sync_status: 'pending_create',
          idempotency_key: `${userId}_trabajos_${id}`,
        };
        await window.__db.trabajos.add(rec);
        try { await window.__logAudit?.({ action:'insert', table:'trabajos', recordId:id, newData:rec }); } catch {}
        showToast?.(`"${campos.nombre}" creado`, 'green');
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'trabajos' } })); } catch {}
      setModal(null); setForm({}); setEditingId(null);
    } catch (e) {
      showToast?.('Error: ' + (e.message || e), 'red');
    } finally { setGuardando(false); }
  };

  const cotEnCursoRef = uRT(false);
  const guardarCot = async () => {
    if (cotEnCursoRef.current) return;
    cotEnCursoRef.current = true;
    try { await guardarCotInner(); } finally { cotEnCursoRef.current = false; }
  };

  const guardarCotInner = async () => {
    const c = cotModal || {};
    if (!detalleId) return;
    const monto = c.monto === '' || c.monto == null ? null : Number(c.monto);
    if (monto != null && (!Number.isFinite(monto) || monto < 0)) {
      showToast?.('El monto de la cotización no puede ser negativo.', 'red'); return;
    }
    const now = new Date().toISOString();
    const campos = {
      trabajo_id: detalleId,
      numero: c.numero?.trim() || null,
      fecha: c.fecha || null,
      validez_dias: c.validez_dias === '' || c.validez_dias == null ? null : Number(c.validez_dias),
      monto,
      moneda: c.moneda || 'PEN',
      estado: c.estado || 'borrador',
      notas: c.notas?.trim() || null,
      updated_at: now, updated_by: userId,
    };
    try {
      if (c.id) {
        await window.__db.trabajo_cotizaciones.update(c.id, {
          ...campos,
          version: (c.version ?? 0) + 1,
          sync_status: c.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
      } else {
        const id = window.__newId();
        await window.__db.trabajo_cotizaciones.add({
          id, ...campos,
          created_at: now, created_by: userId,
          version: 1, sync_status: 'pending_create',
          idempotency_key: `${userId}_trabajo_cotizaciones_${id}`,
        });
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'trabajo_cotizaciones' } })); } catch {}
      setCotModal(null);
      showToast?.('Cotización guardada', 'green');
    } catch (e) { showToast?.('Error: ' + (e.message || e), 'red'); }
  };

  const eliminarCot = async (c) => {
    if (!window.confirm(`¿Eliminar la cotización ${c.numero || 'sin número'}?`)) return;
    const now = new Date().toISOString();
    try {
      await window.__db.trabajo_cotizaciones.update(c.id, {
        deleted_at: now, updated_at: now, updated_by: userId,
        version: (c.version ?? 0) + 1,
        sync_status: c.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'trabajo_cotizaciones' } })); } catch {}
    } catch (e) { showToast?.('Error: ' + (e.message || e), 'red'); }
  };

  const openNuevo = () => {
    setForm({
      nombre: '', codigo: '', tipo: 'bien', origen: 'privado', estado: 'cotizacion',
      cliente: '', cliente_ruc: '',
      ejecutor_company_id: companiesPropias[0]?.id || '',
      consorcio_id: '', monto_estimado: '', moneda: 'PEN',
      fecha_inicio: '', fecha_fin: '', observaciones: '',
    });
    setEditingId(null); setModal('nuevo');
  };

  const openEditar = (t) => {
    setForm({
      nombre: t.nombre || '', codigo: t.codigo || '', tipo: t.tipo || 'bien',
      origen: t.origen || 'privado', estado: t.estado || 'cotizacion',
      cliente: t.cliente || '', cliente_ruc: t.cliente_ruc || '',
      ejecutor_company_id: t.ejecutor_company_id || '',
      consorcio_id: t.consorcio_id || '',
      monto_estimado: t.monto_estimado ?? '', moneda: t.moneda || 'PEN',
      fecha_inicio: t.fecha_inicio || '', fecha_fin: t.fecha_fin || '',
      observaciones: t.observaciones || '',
    });
    setEditingId(t.id); setModal('editar');
  };

  const eliminar = async (t) => {
    if (!isAdmin) return;
    if (!window.confirm(`¿Eliminar "${t.nombre}"? Las facturas que se le imputaron no se borran.`)) return;
    const now = new Date().toISOString();
    try {
      await window.__db.trabajos.update(t.id, {
        deleted_at: now, updated_at: now, updated_by: userId,
        version: (t.version ?? 0) + 1,
        sync_status: t.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'trabajos' } })); } catch {}
      showToast?.('Trabajo eliminado', 'green');
    } catch (e) { showToast?.('Error: ' + (e.message || e), 'red'); }
  };

  // ── Detalle: early return DESPUÉS de todos los hooks (regla crítica 3) ──
  if (detalle) {
    const r = resumenEconomico(detalle.id, movs, moneda);
    const cots = cotizacionesDe(detalle.id, cotizaciones);
    const aceptada = cotizacionAceptada(detalle.id, cotizaciones);
    const misMovs = (movs || []).filter(m => !m.deleted_at && m.trabajo_id === detalle.id);
    return (
      <div className="page-wrap">
        <div className="pg-hd frow-sb">
          <div>
            <button className="btn btn-ghost btn-sm" onClick={() => setDetalleId(null)}>
              <JxIcon name="chevL" size={13}/> Volver
            </button>
            <div className="pg-title" style={{ marginTop: 6 }}>{detalle.nombre}</div>
            <div className="pg-sub">
              {TIPO_LBL[detalle.tipo]} · {detalle.cliente || 'sin cliente'}
              {detalle.codigo ? ` · ${detalle.codigo}` : ''}
            </div>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <span className={`badge ${ESTADO_BADGE[detalle.estado] || 'b-gray'}`}>{ESTADO_LBL[detalle.estado]}</span>
            {canWrite && (
              <button className="btn btn-ghost btn-sm" onClick={() => openEditar(detalle)}>
                <JxIcon name="edit" size={13}/> Editar
              </button>
            )}
          </div>
        </div>

        <div className="card card-p" style={{ marginBottom: 12 }}>
          <div className="frow-sb" style={{ marginBottom: 8 }}>
            <div style={{ fontSize:11, color:'var(--amber)', fontWeight:700, textTransform:'uppercase' }}>
              Compra, venta y margen
            </div>
            <select className="fi" style={{ width:'auto', fontSize:11 }} value={moneda} onChange={e=>setMoneda(e.target.value)}>
              <option value="PEN">Soles</option><option value="USD">Dólares</option>
            </select>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(130px, 1fr))', gap:10 }}>
            {[
              { l: 'Comprado', v: r.compras, c: 'var(--ts)' },
              { l: 'Vendido',  v: r.ventas,  c: 'var(--ts)' },
              { l: 'Margen',   v: r.margen,  c: r.margen >= 0 ? 'var(--green)' : 'var(--red)' },
            ].map(x => (
              <div key={x.l}>
                <div style={{ fontSize:10.5, color:'var(--tm)' }}>{x.l}</div>
                <div style={{ fontSize:16, fontWeight:700, color:x.c }}>{fmt(x.v, moneda)}</div>
              </div>
            ))}
            <div>
              <div style={{ fontSize:10.5, color:'var(--tm)' }}>Margen %</div>
              <div style={{ fontSize:16, fontWeight:700, color:'var(--ts)' }}>
                {r.pct == null ? '—' : `${r.pct}%`}
              </div>
            </div>
          </div>
          <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:8, lineHeight:1.5 }}>
            Sale de las {r.nMovs} factura{r.nMovs === 1 ? '' : 's'} imputada{r.nMovs === 1 ? '' : 's'} a este trabajo, sin las anuladas.
            Se calcula cada vez: no hay un margen guardado que se desactualice.
            {r.otraMoneda > 0 && ` Hay ${r.otraMoneda} movimiento${r.otraMoneda === 1 ? '' : 's'} en otra moneda que no se está${r.otraMoneda === 1 ? '' : 'n'} sumando acá.`}
          </div>
          {aceptada?.monto != null && (
            <div style={{ fontSize:11, color:'var(--tm)', marginTop:4 }}>
              Cotización aceptada: <strong>{fmt(aceptada.monto, aceptada.moneda)}</strong>
            </div>
          )}
        </div>

        <div className="card" style={{ marginBottom: 12, overflow:'hidden' }}>
          <div className="frow-sb" style={{ padding:'10px 14px' }}>
            <div style={{ fontSize:11, color:'var(--amber)', fontWeight:700, textTransform:'uppercase' }}>
              Cotizaciones al cliente ({cots.length})
            </div>
            {canWrite && (
              <button className="btn btn-amber btn-sm" onClick={() => setCotModal({ estado:'borrador', moneda:'PEN' })}>
                <JxIcon name="plus" size={12}/> Nueva
              </button>
            )}
          </div>
          {cots.length === 0 ? (
            <div style={{ padding:'0 14px 14px', fontSize:11.5, color:'var(--tm)' }}>
              Todavía no cotizaste este trabajo.
            </div>
          ) : (
            <div style={{ overflowX:'auto' }}>
              <table className="tbl">
                <thead><tr>
                  <th>N°</th><th>Fecha</th><th style={{textAlign:'right'}}>Monto</th>
                  <th>Validez</th><th>Estado</th>{canWrite && <th style={{textAlign:'center'}}>Acciones</th>}
                </tr></thead>
                <tbody>
                  {cots.map(c => (
                    <tr key={c.id}>
                      <td className="col-p">{c.numero || '—'}</td>
                      <td className="col-m">{c.fecha || '—'}</td>
                      <td className="col-m" style={{textAlign:'right'}}>{c.monto == null ? '—' : fmt(c.monto, c.moneda)}</td>
                      <td className="col-m">{c.validez_dias ? `${c.validez_dias} d` : '—'}</td>
                      <td><span className={`badge ${COT_BADGE[c.estado]||'b-gray'}`}>{COT_LBL[c.estado]}</span></td>
                      {canWrite && (
                        <td style={{textAlign:'center'}}>
                          <button className="btn btn-ghost btn-xs" onClick={()=>setCotModal({...c})}><JxIcon name="edit" size={11}/></button>
                          <button className="btn btn-ghost btn-xs" onClick={()=>eliminarCot(c)}><JxIcon name="trash" size={11}/></button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card" style={{ overflow:'hidden' }}>
          <div style={{ padding:'10px 14px', fontSize:11, color:'var(--amber)', fontWeight:700, textTransform:'uppercase' }}>
            Facturas imputadas ({misMovs.length})
          </div>
          {misMovs.length === 0 ? (
            <div style={{ padding:'0 14px 14px', fontSize:11.5, color:'var(--tm)', lineHeight:1.5 }}>
              Ninguna todavía. Las compras y ventas se cargan como siempre — en Movimientos Contables o
              Captura Mágica — eligiendo este trabajo. Acá se ven agrupadas.
            </div>
          ) : (
            <div style={{ overflowX:'auto' }}>
              <table className="tbl">
                <thead><tr>
                  <th>Fecha</th><th>Documento</th><th>Empresa</th><th>Concepto</th>
                  <th style={{textAlign:'right'}}>Monto</th><th>Tipo</th>
                </tr></thead>
                <tbody>
                  {misMovs.slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).map(m => (
                    <tr key={m.id}>
                      <td className="col-m">{m.date || '—'}</td>
                      <td className="col-m">{[m.document_type, m.document_number].filter(Boolean).join(' ') || '—'}</td>
                      <td>{nombreDe(m.company_id)}</td>
                      <td style={{ fontSize:11 }}>{m.description || m.concept || '—'}</td>
                      <td className="col-m" style={{textAlign:'right'}}>{fmt(m.amount, m.currency)}</td>
                      <td>
                        <span className={`badge ${m.type === 'income' ? 'b-green' : 'b-amber'}`}>
                          {m.type === 'income' ? 'Venta' : 'Compra'}
                        </span>
                        {m.estado_factura === 'anulada' && <span className="badge b-red" style={{marginLeft:4}}>Anulada</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {cotModal && (
          <Modal title={cotModal.id ? 'Editar cotización' : 'Nueva cotización'} icon="file" onClose={()=>setCotModal(null)}>
            <div className="g2">
              <div><label className="flabel">N° de cotización</label>
                <input className="fi" value={cotModal.numero||''} onChange={e=>setCotModal({...cotModal, numero:e.target.value})}/></div>
              <div><label className="flabel">Fecha</label>
                <input className="fi" type="date" value={cotModal.fecha||''} onChange={e=>setCotModal({...cotModal, fecha:e.target.value})}/></div>
              <div><label className="flabel">Monto</label>
                <input className="fi" type="number" step="0.01" min="0" value={cotModal.monto ?? ''} onChange={e=>setCotModal({...cotModal, monto:e.target.value})}/></div>
              <div><label className="flabel">Moneda</label>
                <select className="fi" value={cotModal.moneda||'PEN'} onChange={e=>setCotModal({...cotModal, moneda:e.target.value})}>
                  <option value="PEN">Soles</option><option value="USD">Dólares</option>
                </select></div>
              <div><label className="flabel">Validez (días)</label>
                <input className="fi" type="number" min="0" value={cotModal.validez_dias ?? ''} onChange={e=>setCotModal({...cotModal, validez_dias:e.target.value})}/></div>
              <div><label className="flabel">Estado</label>
                <select className="fi" value={cotModal.estado||'borrador'} onChange={e=>setCotModal({...cotModal, estado:e.target.value})}>
                  {ESTADOS_COTIZACION.map(e => <option key={e.v} value={e.v}>{e.label}</option>)}
                </select></div>
              <div style={{gridColumn:'1/-1'}}><label className="flabel">Notas</label>
                <textarea className="fi" value={cotModal.notas||''} onChange={e=>setCotModal({...cotModal, notas:e.target.value})}/></div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={()=>setCotModal(null)}>Cancelar</button>
              <button className="btn btn-amber" onClick={guardarCot}><JxIcon name="check" size={13}/> Guardar</button>
            </div>
          </Modal>
        )}
        {modal && <FormTrabajo />}
      </div>
    );
  }

  function FormTrabajo() {
    return (
      <Modal title={editingId ? 'Editar trabajo' : 'Nuevo bien o servicio'} icon="package"
        onClose={()=>{ setModal(null); setForm({}); setEditingId(null); }}>
        <div className="g2">
          <div style={{gridColumn:'1/-1'}}><label className="flabel">Nombre *</label>
            <input className="fi" placeholder="Ej: Venta de cemento a Municipalidad de Otuzco"
              value={form.nombre||''} onChange={e=>setForm({...form, nombre:e.target.value})}/></div>
          <div><label className="flabel">Código</label>
            <input className="fi" placeholder="Ej: BS-2026-001" value={form.codigo||''} onChange={e=>setForm({...form, codigo:e.target.value})}/></div>
          <div><label className="flabel">Tipo *</label>
            <select className="fi" value={form.tipo||'bien'} onChange={e=>setForm({...form, tipo:e.target.value})}>
              {TIPOS.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
            </select>
            <div style={{fontSize:10, color:'var(--tm)', marginTop:3}}>
              {TIPOS.find(t => t.v === (form.tipo||'bien'))?.desc}
            </div>
          </div>
          <div><label className="flabel">Cliente</label>
            <input className="fi" value={form.cliente||''} onChange={e=>setForm({...form, cliente:e.target.value})}/></div>
          <div><label className="flabel">RUC del cliente</label>
            <input className="fi" value={form.cliente_ruc||''} onChange={e=>setForm({...form, cliente_ruc:e.target.value})}/></div>
          <div><label className="flabel">Origen</label>
            <select className="fi" value={form.origen||'privado'} onChange={e=>setForm({...form, origen:e.target.value})}>
              <option value="privado">Privado</option><option value="publico">Público</option>
            </select></div>
          <div><label className="flabel">Estado</label>
            <select className="fi" value={form.estado||'cotizacion'} onChange={e=>setForm({...form, estado:e.target.value})}>
              {ESTADOS.map(e => <option key={e.v} value={e.v}>{e.label}</option>)}
            </select></div>
          <div style={{gridColumn:'1/-1'}}><label className="flabel">Quién lo vende o presta *</label>
            <select className="fi" value={form.consorcio_id ? `k:${form.consorcio_id}` : (form.ejecutor_company_id ? `c:${form.ejecutor_company_id}` : '')}
              onChange={e=>{
                const v = e.target.value;
                if (v.startsWith('k:')) setForm({...form, consorcio_id: v.slice(2), ejecutor_company_id: ''});
                else setForm({...form, ejecutor_company_id: v.slice(2), consorcio_id: ''});
              }}>
              <option value="">— Seleccionar —</option>
              {companiesPropias.map(c => <option key={c.id} value={`c:${c.id}`}>{c.name}</option>)}
              {(consorcios||[]).filter(k => !k.deleted_at && k.estado === 'activo')
                .map(k => <option key={k.id} value={`k:${k.id}`}>{k.nombre} (consorcio)</option>)}
            </select></div>
          <div><label className="flabel">Monto estimado</label>
            <input className="fi" type="number" step="0.01" min="0" value={form.monto_estimado ?? ''} onChange={e=>setForm({...form, monto_estimado:e.target.value})}/></div>
          <div><label className="flabel">Moneda</label>
            <select className="fi" value={form.moneda||'PEN'} onChange={e=>setForm({...form, moneda:e.target.value})}>
              <option value="PEN">Soles</option><option value="USD">Dólares</option>
            </select></div>
          <div><label className="flabel">Fecha inicio</label>
            <input className="fi" type="date" value={form.fecha_inicio||''} onChange={e=>setForm({...form, fecha_inicio:e.target.value})}/></div>
          <div><label className="flabel">Fecha fin</label>
            <input className="fi" type="date" value={form.fecha_fin||''} onChange={e=>setForm({...form, fecha_fin:e.target.value})}/></div>
          <div style={{gridColumn:'1/-1'}}><label className="flabel">Observaciones</label>
            <textarea className="fi" value={form.observaciones||''} onChange={e=>setForm({...form, observaciones:e.target.value})}/></div>
          <div style={{gridColumn:'1/-1', fontSize:10.5, color:'var(--tm)', lineHeight:1.5}}>
            Un bien o servicio no tiene partidas, cronograma ni personal de campo: lo lleva un responsable único.
            La compra y la venta se cargan como facturas normales eligiendo este trabajo.
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" disabled={guardando} onClick={()=>{ setModal(null); setForm({}); setEditingId(null); }}>Cancelar</button>
          <button className="btn btn-amber" disabled={guardando} onClick={guardar}>
            <JxIcon name="check" size={13}/>{guardando ? 'Guardando…' : (editingId ? 'Guardar' : 'Crear')}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Bienes y Servicios</div>
          <div className="pg-sub">
            {tot.n} trabajo{tot.n === 1 ? '' : 's'} · {tot.abiertos} abierto{tot.abiertos === 1 ? '' : 's'} ·
            margen {fmt(tot.margen, moneda)}
          </div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <select className="fi" style={{ width:'auto', fontSize:11.5 }} value={moneda} onChange={e=>setMoneda(e.target.value)}>
            <option value="PEN">Soles</option><option value="USD">Dólares</option>
          </select>
          {canWrite ? (
            <button className="btn btn-amber btn-sm" onClick={openNuevo}><JxIcon name="plus" size={13}/> Nuevo</button>
          ) : <span className="badge b-gray">Solo lectura</span>}
        </div>
      </div>

      <div className="card card-p" style={{ marginBottom:12, display:'flex', gap:8, flexWrap:'wrap' }}>
        <input className="fi" style={{ flex:'1 1 220px' }} placeholder="Buscar por nombre, código, cliente o RUC"
          value={filtro.texto} onChange={e=>setFiltro({...filtro, texto:e.target.value})}/>
        <select className="fi" style={{ width:'auto' }} value={filtro.estado} onChange={e=>setFiltro({...filtro, estado:e.target.value})}>
          <option value="">Todos los estados</option>
          {ESTADOS.map(e => <option key={e.v} value={e.v}>{e.label}</option>)}
        </select>
        <select className="fi" style={{ width:'auto' }} value={filtro.tipo} onChange={e=>setFiltro({...filtro, tipo:e.target.value})}>
          <option value="">Bienes y servicios</option>
          {TIPOS.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
        </select>
      </div>

      {lista.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="package" size={40} color="var(--tm)"/>
          <p>
            {(trabajos||[]).filter(t=>!t.deleted_at).length
              ? 'Ningún trabajo coincide con el filtro.'
              : 'Todavía no hay bienes ni servicios. Acá van las ventas de material y las prestaciones que no son una obra.'}
          </p>
        </div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <div style={{ overflowX:'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Trabajo</th><th>Tipo</th><th>Cliente</th><th>Vende</th>
                <th style={{textAlign:'right'}}>Comprado</th>
                <th style={{textAlign:'right'}}>Vendido</th>
                <th style={{textAlign:'right'}}>Margen</th>
                <th>Estado</th>
                {isAdmin && <th style={{textAlign:'center'}}>Acciones</th>}
              </tr></thead>
              <tbody>
                {lista.map(t => {
                  const r = resumenEconomico(t.id, movs, moneda);
                  return (
                    <tr key={t.id}>
                      <td className="col-p">
                        <button className="btn btn-ghost btn-xs" style={{ padding:0, fontWeight:700 }} onClick={()=>setDetalleId(t.id)}>
                          {t.nombre}
                        </button>
                        {t.codigo && <div style={{ fontSize:10, color:'var(--tm)' }}>{t.codigo}</div>}
                      </td>
                      <td><span className="badge b-gray">{TIPO_LBL[t.tipo]}</span></td>
                      <td style={{ fontSize:11.5 }}>{t.cliente || '—'}</td>
                      <td style={{ fontSize:11.5 }}>
                        {t.consorcio_id
                          ? ((consorcios||[]).find(k => k.id === t.consorcio_id)?.nombre || '—')
                          : nombreDe(t.ejecutor_company_id)}
                      </td>
                      <td className="col-m" style={{textAlign:'right'}}>{fmt(r.compras, moneda)}</td>
                      <td className="col-m" style={{textAlign:'right'}}>{fmt(r.ventas, moneda)}</td>
                      <td className="col-m" style={{textAlign:'right', color: r.margen >= 0 ? 'var(--green)' : 'var(--red)', fontWeight:600 }}>
                        {fmt(r.margen, moneda)}{r.pct == null ? '' : ` · ${r.pct}%`}
                      </td>
                      <td><span className={`badge ${ESTADO_BADGE[t.estado]||'b-gray'}`}>{ESTADO_LBL[t.estado]}</span></td>
                      {isAdmin && (
                        <td style={{textAlign:'center'}}>
                          <button className="btn btn-ghost btn-xs" onClick={()=>openEditar(t)}><JxIcon name="edit" size={11}/></button>
                          <button className="btn btn-ghost btn-xs" onClick={()=>eliminar(t)}><JxIcon name="trash" size={11}/></button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal && <FormTrabajo />}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
// TRABAJOS — la entrada de primer nivel (tanda 2, entrega A)
//
// EL PROBLEMA QUE RESUELVE, en palabras de Gabriel (3-sep): "intenté ir a ver
// la configuración de la obra activa de Miraflores y tuve que ingresar a la
// sección de Empresas para ahí encontrar el apartado de obras y editarlas".
//
// Pasaba porque no había ningún lugar que fuera "los trabajos que hacemos":
// `obras` vivía en el plano general junto a Empresas y contabilidad, así que el
// camino a una obra pasaba por un bloque que no tiene nada que ver con ella.
//
// Esta pantalla es la vista de la taxonomía que la tanda 1 dejó en el modelo:
// una obra de ejecución, una de expediente+ejecución, una supervisión y una
// venta de bienes son TRABAJOS distintos, y hasta ahora las cuatro eran "una
// obra" indistinguible. Se listan juntas porque para quien busca algo son lo
// mismo: un trabajo que el grupo está haciendo.
//
// Las obras salen de `obras` (con tipo_trabajo, mig 173) y los bienes y
// servicios de `trabajos` (mig 174). Son tablas distintas a propósito — un
// flujo corto no tiene partidas ni cronograma — y esta pantalla las une para
// mirarlas, sin fusionar los modelos.
// ═══════════════════════════════════════════════════════════════════
function TrabajosPage({ showToast, onNav, onEnterObra }) {
  const { data: obras } = window.__hooks.useObras?.() || { data: [] };
  const { data: trabajos } = window.__hooks.useTrabajos?.() || { data: [] };
  const { data: companies } = window.__hooks.useCompanies?.() || { data: [] };
  const { data: consorcios } = window.__hooks.useConsorcios?.() || { data: [] };
  const { data: consorcioSocios } = window.__hooks.useConsorcioSocios?.() || { data: [] };
  const { data: movs } = window.__hooks.useAccountingMovements?.() || { data: [] };

  const auth = window.__useAuth?.();
  const myRol = auth?.profile?.rol;
  const isAdmin = myRol === 'admin';

  const [texto, setTexto] = uST('');
  const [filtroTipo, setFiltroTipo] = uST('');     // '' | tipo_trabajo | 'bien' | 'servicio'
  const [soloAbiertos, setSoloAbiertos] = uST(false);

  const lookupCompany = (id) => (companies || []).find(c => c.id === id);

  // Obras y trabajos normalizados a una sola forma para poder listarlos juntos.
  const filas = uMT(() => {
    const q = texto.trim().toLowerCase();
    const coincide = (...campos) => !q || campos.some(v => String(v || '').toLowerCase().includes(q));

    const deObras = (obras || []).filter(o => !o.deleted_at).map(o => ({
      kind: 'obra',
      id: o.id,
      nombre: o.nombre_obra,
      tipoV: o.tipo_trabajo || TIPO_TRABAJO_DEFAULT,
      tipoLbl: TIPOS_TRABAJO.find(t => t.v === (o.tipo_trabajo || TIPO_TRABAJO_DEFAULT))?.corto || '—',
      origen: o.origen || ORIGEN_DEFAULT,
      cliente: o.cliente,
      ejecutor: etiquetaEjecutora(o, consorcios, consorcioSocios, lookupCompany),
      estado: normalizarEstadoObra(o.estado),
      estadoLbl: ESTADO_OBRA_LBL[normalizarEstadoObra(o.estado)],
      estadoBadge: ESTADO_OBRA_BADGE[normalizarEstadoObra(o.estado)],
      abierto: !['terminado', 'cancelado'].includes(normalizarEstadoObra(o.estado)),
      // En una obra lo que importa de un pantallazo es el avance.
      metrica: `${Number(o.avance_fisico || 0).toFixed(0)}% avance`,
      raw: o,
    }));

    const deTrabajos = (trabajos || []).filter(t => !t.deleted_at).map(t => {
      const r = resumenEconomico(t.id, movs, t.moneda || 'PEN');
      return {
        kind: 'trabajo',
        id: t.id,
        nombre: t.nombre,
        tipoV: t.tipo,
        tipoLbl: TIPO_LBL[t.tipo] || '—',
        origen: t.origen || 'privado',
        cliente: t.cliente,
        ejecutor: t.consorcio_id
          ? ((consorcios || []).find(k => k.id === t.consorcio_id)?.nombre || '—')
          : (lookupCompany(t.ejecutor_company_id)?.name || '—'),
        estado: t.estado,
        estadoLbl: ESTADO_LBL[t.estado],
        estadoBadge: ESTADO_BADGE[t.estado],
        abierto: esAbierto(t.estado),
        // En un bien o servicio lo que importa es el margen.
        metrica: r.ventas > 0 ? `margen ${fmt(r.margen, t.moneda || 'PEN')}` : 'sin ventas aún',
        raw: t,
      };
    });

    return [...deObras, ...deTrabajos]
      .filter(f => !filtroTipo || f.tipoV === filtroTipo)
      .filter(f => !soloAbiertos || f.abierto)
      .filter(f => coincide(f.nombre, f.cliente, f.ejecutor))
      .sort((a, b) => (b.abierto ? 1 : 0) - (a.abierto ? 1 : 0)
        || String(a.nombre || '').localeCompare(String(b.nombre || '')));
  }, [obras, trabajos, companies, consorcios, consorcioSocios, movs, texto, filtroTipo, soloAbiertos]);

  const totales = uMT(() => ({
    obras: filas.filter(f => f.kind === 'obra').length,
    bs: filas.filter(f => f.kind === 'trabajo').length,
    abiertos: filas.filter(f => f.abierto).length,
  }), [filas]);

  const abrir = (f) => {
    if (f.kind === 'obra') {
      // Fija la obra activa y entra a su panel: el camino que faltaba.
      onEnterObra?.(f.id, 'inicio');
    } else {
      onNav?.('bienes-servicios');
    }
  };

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Trabajos</div>
          <div className="pg-sub">
            {totales.obras} obra{totales.obras === 1 ? '' : 's'} · {totales.bs} bien{totales.bs === 1 ? '' : 'es'}/servicio{totales.bs === 1 ? '' : 's'} · {totales.abiertos} en curso
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isAdmin && (
            <button className="btn btn-ghost btn-sm" onClick={() => onNav?.('obras')} title="Crear o editar obras">
              <JxIcon name="building" size={13}/> Administrar obras
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => onNav?.('bienes-servicios')}>
            <JxIcon name="package" size={13}/> Bienes y Servicios
          </button>
        </div>
      </div>

      <div className="card card-p" style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="fi" style={{ flex: '1 1 220px' }} placeholder="Buscar por nombre, cliente o quién ejecuta"
          value={texto} onChange={e => setTexto(e.target.value)}/>
        <select className="fi" style={{ width: 'auto' }} value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}>
          <option value="">Todos los tipos</option>
          <optgroup label="Obras y supervisiones">
            {TIPOS_TRABAJO.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
          </optgroup>
          <optgroup label="Bienes y servicios">
            {TIPOS.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
          </optgroup>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--tm)', cursor: 'pointer' }}>
          <input type="checkbox" checked={soloAbiertos} onChange={e => setSoloAbiertos(e.target.checked)}/>
          Solo en curso
        </label>
      </div>

      {filas.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="hardHat" size={40} color="var(--tm)"/>
          <p>
            {(obras || []).length || (trabajos || []).length
              ? 'Ningún trabajo coincide con el filtro.'
              : 'Todavía no hay trabajos cargados.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: 12 }}>
          {filas.map(f => (
            <button key={`${f.kind}-${f.id}`} type="button" onClick={() => abrir(f)}
              className="card card-p"
              style={{ textAlign: 'left', cursor: 'pointer', border: '1px solid var(--border)', display: 'block' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                <JxIcon name={f.kind === 'obra' ? 'hardHat' : 'package'} size={13} color="var(--amber)"/>
                <span className="badge b-gray" style={{ fontSize: 9.5 }}>{f.tipoLbl}</span>
                <span className="badge b-gray" style={{ fontSize: 9.5 }}>{f.origen === 'publico' ? 'Pública' : 'Privada'}</span>
                <span className={`badge ${f.estadoBadge || 'b-gray'}`} style={{ fontSize: 9.5 }}>{f.estadoLbl}</span>
              </div>
              <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.35, marginBottom: 4 }}>
                {String(f.nombre || '').slice(0, 90)}{String(f.nombre || '').length > 90 ? '…' : ''}
              </div>
              {f.cliente && <div style={{ fontSize: 11, color: 'var(--tm)' }}>{f.cliente}</div>}
              <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 4 }}>
                Ejecuta: {f.ejecutor}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ts)', marginTop: 6, fontWeight: 600 }}>{f.metrica}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { BienesServiciosPage, TrabajosPage });
