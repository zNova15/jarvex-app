// ═══════════════════════════════════════════════════════════════════
// JARVEX — Órdenes de compra/servicio INTERCOMPANY (Fase 4)
//
// Desde las reglas de emisión (Fase 3: subcategoría → empresa emisora +
// intermediarias) y la valorización al presupuesto (conciliacion_vinculos ×
// insumos_partida), la CONTADORA JEFE genera un borrador de orden por
// EMPRESA × OBRA × PERÍODO (mes). Cada línea = insumo vinculado, valorizado
// al precio del expediente (cantidad y precio EDITABLES). El ADMINISTRADOR
// aprueba. Una orden aprobada queda lista para emitir el comprobante
// (Fase 5: firma digital + envío SUNAT). La cadena de intermediarias
// alimenta la Trazabilidad.
//
// Permisos: generar/editar borrador = admin | contador (jefe). Aprobar = admin.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { getCurrentMode } from "../hooks/useAppMode";

const { useState: uS, useMemo: uM, useEffect: uE } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);
const Modal = (p) => (window.Modal ? <window.Modal {...p} /> : null);

const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CAT_LBL = {
  materiales: 'Materiales', herramientas: 'Herramientas', maquinaria: 'Maquinaria', epp: 'EPP',
  insumos_emergencia: 'Emergencia', gastos_generales: 'Gastos generales', otros: 'Otros',
};
const ESTADOS = {
  borrador: { lbl: 'Borrador', cls: 'b-gray' },
  pendiente_aprobacion: { lbl: 'Pendiente de aprobación', cls: 'b-amber' },
  aprobada: { lbl: 'Aprobada', cls: 'b-green' },
  rechazada: { lbl: 'Rechazada', cls: 'b-red' },
  anulada: { lbl: 'Anulada', cls: 'b-gray' },
};
// MISMA derivación de código que Conciliación/Compras por Categoría (los vínculos
// guardan este código): Delfín trimeado o clave sintética 'sc:' para sin código.
const codigoDe = (ip) => (ip.insumo_codigo && String(ip.insumo_codigo).trim())
  || ('sc:' + (ip.nombre_insumo || '') + '|' + (ip.tipo_insumo || '') + '|' + (ip.unidad || ''));

const calcMontos = (items, igvPct = 18) => {
  const sub = (items || []).reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.precio_unit) || 0), 0);
  const igv = sub * (Number(igvPct) || 0) / 100;
  return { monto_subtotal: +sub.toFixed(2), monto_igv: +igv.toFixed(2), monto_total: +(sub + igv).toFixed(2) };
};

function OrdenesIntercompanyPage({ showToast }) {
  const toast = showToast || window.__showToast || (() => {});
  const auth = window.__useAuth?.();
  const rol = auth?.profile?.rol;
  const userId = auth?.profile?.id ?? 'offline';
  const isAdmin = rol === 'admin';
  const canGestionar = isAdmin || rol === 'contador';   // jefe/admin generan + editan borrador
  const canAprobar = isAdmin;                            // solo admin aprueba
  const { data: companies } = window.__hooks.useCompanies();
  const { data: obras } = window.__hooks.useObras();

  const [ordenes, setOrdenes] = uS([]);
  const [genObra, setGenObra] = uS('');
  const [genPeriodo, setGenPeriodo] = uS(() => new Date().toISOString().slice(0, 7));
  const [genBusy, setGenBusy] = uS(false);
  const [busy, setBusy] = uS(false);
  const [detalle, setDetalle] = uS(null);        // orden abierta en el modal
  const [rechazarId, setRechazarId] = uS(null);  // orden a rechazar (pide motivo)
  const [filtroEstado, setFiltroEstado] = uS('todas');

  const esPrueba = (() => { try { return getCurrentMode() === 'prueba'; } catch { return false; } })();
  const filaDelModo = (r) => (esPrueba ? r.demo === true : r.demo !== true);

  const cargar = async () => {
    try {
      const rows = await window.__db.ordenes_intercompany.filter(o => !o.deleted_at && filaDelModo(o)).toArray();
      rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      setOrdenes(rows);
    } catch { setOrdenes([]); }
  };
  uE(() => {
    cargar();
    const on = (e) => { const t = e?.detail?.tabla; if (!t || t === 'ordenes_intercompany') cargar(); };
    window.addEventListener('jx_data_changed', on);
    window.addEventListener('jarvex_master_updated', on);
    return () => { window.removeEventListener('jx_data_changed', on); window.removeEventListener('jarvex_master_updated', on); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esPrueba]);

  const companiesActivas = uM(() => (companies || []).filter(c => c.status === 'activa' && !c.deleted_at), [companies]);
  const companyNombre = (id) => (companies || []).find(c => c.id === id)?.name || (id ? '—' : null);
  const obraNombre = (id) => (obras || []).find(o => o.id === id)?.nombre_obra || '—';
  const obrasActivas = uM(() => (obras || []).filter(o => !o.deleted_at), [obras]);

  // Empresa ejecutora de una obra (destino de las órdenes).
  const ejecutoraDe = (obraId) => {
    const o = (obras || []).find(x => x.id === obraId);
    if (!o) return null;
    if (o.ejecutora_company_id) return o.ejecutora_company_id;
    if (o.ejecutora_tipo === 'consorcio' && Array.isArray(o.consorcio_miembros) && o.consorcio_miembros[0]) return o.consorcio_miembros[0].company_id;
    return null;
  };
  const prefijoDe = (id) => {
    const c = (companies || []).find(x => x.id === id);
    if (!c) return 'OI';
    return (c.codigo_doc_prefix || c.nombre_corto || (c.name || 'OI').split(/\s+/).map(w => w[0]).join('').slice(0, 4)).toUpperCase();
  };

  const guardarOrden = async (id, patch, reason) => {
    const fresh = await window.__db.ordenes_intercompany.get(id);
    if (!fresh) { toast('La orden ya no existe', 'red'); return null; }
    const { SYNC_STATUS } = await import('../db/jarvex.db');
    const now = new Date().toISOString();
    await window.__db.ordenes_intercompany.update(id, {
      ...patch, updated_at: now, updated_by: userId, version: (fresh.version ?? 0) + 1,
      sync_status: esPrueba ? SYNC_STATUS.SYNCED
        : (fresh.sync_status === SYNC_STATUS.PENDING_CREATE ? SYNC_STATUS.PENDING_CREATE : SYNC_STATUS.PENDING_UPDATE),
    });
    try { await window.__logAudit?.({ action: 'update', table: 'ordenes_intercompany', recordId: id, reason: reason || 'Orden intercompany' }); } catch {}
    window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'ordenes_intercompany' } }));
    try { window.dispatchEvent(new Event('online')); } catch {}
    return true;
  };

  // ── GENERAR borradores del período ──
  const generarOrdenes = async () => {
    if (!genObra) { toast('Elegí la obra', 'red'); return; }
    if (!/^\d{4}-\d{2}$/.test(genPeriodo)) { toast('Elegí el mes (período)', 'red'); return; }
    if (genBusy) return;
    setGenBusy(true);
    try {
      const { newId, newIdempotencyKey, SYNC_STATUS } = await import('../db/jarvex.db');
      // Reglas de emisión (canónica por subcategoría, updated_at desc).
      const reglasRows = await window.__db.emision_reglas.filter(r => !r.deleted_at && filaDelModo(r)).toArray();
      const reglaPorSubcat = new Map();
      [...reglasRows].sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || ''))).forEach(r => reglaPorSubcat.set(r.subcategoria, r));

      // Valorización al presupuesto de la obra.
      const [vins, ips, movsAll] = await Promise.all([
        window.__db.conciliacion_vinculos.where('obra_id').equals(genObra).filter(v => !v.deleted_at).toArray(),
        window.__db.insumos_partida.where('obra_id').equals(genObra).filter(ip => !ip.deleted_at).toArray(),
        window.__db.accounting_movements.toArray(),
      ]);
      const acum = new Map();
      for (const ip of ips) {
        const codigo = codigoDe(ip);
        const cant = Number(ip.cantidad_presupuestada) || 0;
        const monto = Number(ip.costo_presupuestado) || (cant * (Number(ip.precio_presupuestado) || 0));
        const cur = acum.get(codigo) || { cant: 0, monto: 0 }; cur.cant += cant; cur.monto += monto; acum.set(codigo, cur);
      }
      const precioPorCodigo = new Map();
      for (const [codigo, a] of acum) if (a.cant > 0) precioPorCodigo.set(codigo, a.monto / a.cant);
      const vincPorItem = new Map();
      for (const v of vins) { const k = `${v.accounting_movement_id}|${v.item_idx}`; const a = vincPorItem.get(k) || []; a.push(v); vincPorItem.set(k, a); }

      // Compras de la obra en el período con ítems clasificados y vinculados.
      const porEmisora = new Map();   // companyId → { regla, lineas: Map<codigo, linea> }
      let itemsSinRegla = 0, itemsSinVinculo = 0;
      for (const mv of movsAll) {
        if (mv.deleted_at || mv.obra_id !== genObra || mv.clase === 'venta') continue;
        if ((mv.date || '').slice(0, 7) !== genPeriodo) continue;
        let notas; try { notas = typeof mv.notas === 'string' ? JSON.parse(mv.notas) : mv.notas; } catch { notas = null; }
        const arr = notas && Array.isArray(notas.items_factura) ? notas.items_factura : null;
        if (!arr) continue;
        arr.forEach((it, idx) => {
          if (!it.subcategoria) return;
          const regla = reglaPorSubcat.get(it.subcategoria);
          if (!regla || !regla.company_id) { itemsSinRegla++; return; }
          const vs = vincPorItem.get(`${mv.id}|${idx}`) || [];
          if (!vs.length) { itemsSinVinculo++; return; }
          const emp = porEmisora.get(regla.company_id) || { regla, lineas: new Map() };
          for (const v of vs) {
            const precio = precioPorCodigo.get(v.insumo_codigo) ?? 0;
            const cantidad = (Number(v.cantidad) || 0) / vs.length;   // 1 ítem → N insumos: reparte 1/N
            const cod = v.insumo_codigo || '';
            const prev = emp.lineas.get(cod);
            if (prev) { prev.cantidad += cantidad; }
            else emp.lineas.set(cod, {
              insumo_codigo: cod, insumo_nombre: v.insumo_nombre || it.descripcion || '—',
              unidad: it.unidad || '', cantidad, precio_unit: +Number(precio).toFixed(4),
              subcategoria: it.subcategoria, categoria: it.categoria || null,
            });
          }
          porEmisora.set(regla.company_id, emp);
        });
      }

      if (porEmisora.size === 0) {
        toast(`No hay ítems vinculados con emisora designada en ${genPeriodo}${itemsSinRegla ? ` · ${itemsSinRegla} sin regla` : ''}${itemsSinVinculo ? ` · ${itemsSinVinculo} sin vincular` : ''}`, 'amber');
        return;
      }

      // Órdenes ya existentes para (obra, período) — no duplicar por emisora.
      const yaExisten = new Set(ordenes.filter(o => o.obra_id === genObra && o.periodo === genPeriodo && o.estado !== 'anulada').map(o => o.company_id));
      const ejecutora = ejecutoraDe(genObra);
      const now = new Date().toISOString();
      const yr = genPeriodo.slice(0, 4);
      // Correlativo POR empresa+año: cuántas órdenes ya tiene cada empresa en el
      // año + cuántas se le crean en este lote (no un contador global del lote).
      const seqPorEmpresa = new Map();
      let creadas = 0, saltadas = 0;
      for (const [companyId, emp] of porEmisora) {
        if (yaExisten.has(companyId)) { saltadas++; continue; }
        const lineas = [...emp.lineas.values()].map(l => ({ ...l, cantidad: +Number(l.cantidad).toFixed(4) }));
        const montos = calcMontos(lineas, 18);
        const previas = ordenes.filter(o => o.company_id === companyId && (o.periodo || '').slice(0, 4) === yr && o.estado !== 'anulada').length;
        const enLote = seqPorEmpresa.get(companyId) || 0;
        const seq = previas + enLote + 1;
        seqPorEmpresa.set(companyId, enLote + 1);
        const codigo = `OI-${prefijoDe(companyId)}-${yr}-${String(seq).padStart(3, '0')}`;
        const id = newId();
        await window.__db.ordenes_intercompany.add({
          id, codigo, obra_id: genObra, company_id: companyId,
          intermediaria1_company_id: emp.regla.intermediaria1_company_id || null,
          intermediaria2_company_id: emp.regla.intermediaria2_company_id || null,
          ejecutora_company_id: ejecutora || null,
          periodo: genPeriodo, tipo_orden: 'compra', estado: 'borrador',
          items: lineas, igv_pct: 18, ...montos,
          aprobado_por: null, aprobado_at: null, rechazo_motivo: null, notas: null,
          created_by: userId, updated_by: userId, created_at: now, updated_at: now, version: 1,
          idempotency_key: newIdempotencyKey(userId, 'ordenes_intercompany'),
          ...(esPrueba ? { demo: true, sync_status: SYNC_STATUS.SYNCED } : { sync_status: SYNC_STATUS.PENDING_CREATE }),
        });
        creadas++;
      }
      try { await window.__logAudit?.({ action: 'create', table: 'ordenes_intercompany', reason: `Generó ${creadas} orden(es) intercompany · ${obraNombre(genObra)} · ${genPeriodo}` }); } catch {}
      window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'ordenes_intercompany' } }));
      try { window.dispatchEvent(new Event('online')); } catch {}
      toast(`✓ ${creadas} borrador(es) generado(s)${saltadas ? ` · ${saltadas} ya existía(n)` : ''}`, 'green');
    } catch (e) { toast('Error al generar: ' + (e?.message || e), 'red'); }
    finally { setGenBusy(false); }
  };

  // ── Transiciones de estado ──
  const enviarAprobacion = async (o) => { if (busy) return; setBusy(true); try { await guardarOrden(o.id, { estado: 'pendiente_aprobacion' }, `Enviada a aprobación · ${o.codigo}`); toast('Enviada a aprobación del administrador', 'green'); setDetalle(null); } finally { setBusy(false); } };
  const aprobar = async (o) => { if (busy) return; setBusy(true); try { await guardarOrden(o.id, { estado: 'aprobada', aprobado_por: userId, aprobado_at: new Date().toISOString(), rechazo_motivo: null }, `Aprobada · ${o.codigo}`); toast('Orden aprobada — lista para emitir el comprobante', 'green'); setDetalle(null); } finally { setBusy(false); } };
  const rechazar = async (o, motivo) => { if (busy) return; setBusy(true); try { await guardarOrden(o.id, { estado: 'rechazada', rechazo_motivo: motivo }, `Rechazada · ${o.codigo} · ${motivo}`); toast('Orden rechazada', 'amber'); setRechazarId(null); setDetalle(null); } finally { setBusy(false); } };
  const volverBorrador = async (o) => { if (busy) return; setBusy(true); try { await guardarOrden(o.id, { estado: 'borrador', rechazo_motivo: null }, `Reabierta a borrador · ${o.codigo}`); toast('Vuelta a borrador — podés editarla', 'green'); } finally { setBusy(false); } };
  const anular = async (o) => { if (busy) return; setBusy(true); try { await guardarOrden(o.id, { estado: 'anulada' }, `Anulada · ${o.codigo}`); toast('Orden anulada', 'amber'); setDetalle(null); } finally { setBusy(false); } };
  const guardarLineas = async (o, items) => {
    if (busy) return; setBusy(true);
    try { const montos = calcMontos(items, o.igv_pct || 18); await guardarOrden(o.id, { items, ...montos }, `Editó líneas · ${o.codigo}`); toast('Cambios guardados', 'green'); }
    finally { setBusy(false); }
  };

  const ordenesFiltradas = uM(() => filtroEstado === 'todas' ? ordenes : ordenes.filter(o => o.estado === filtroEstado), [ordenes, filtroEstado]);
  const kpis = uM(() => {
    const por = (e) => ordenes.filter(o => o.estado === e);
    return {
      borrador: por('borrador').length,
      pendiente: por('pendiente_aprobacion').length,
      aprobadas: por('aprobada').length,
      totalAprob: por('aprobada').reduce((s, o) => s + (Number(o.monto_total) || 0), 0),
    };
  }, [ordenes]);

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Órdenes Intercompany</div>
          <div className="pg-sub">Genera las órdenes de compra/servicio entre empresas del grupo desde las reglas de emisión, valorizadas al presupuesto</div>
        </div>
      </div>

      {!canGestionar ? (
        <div className="card card-p empty-state"><p>Esta sección es de la contadora jefe y administradores.</p></div>
      ) : (<>
        {/* Generador */}
        <div className="card card-p" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ts)', marginBottom: 8 }}>Generar borradores del período</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label className="flabel">Obra</label>
              <select className="fi" value={genObra} onChange={e => setGenObra(e.target.value)} style={{ minWidth: 220 }}>
                <option value="">— Elegí la obra —</option>
                {obrasActivas.map(o => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}
              </select>
            </div>
            <div>
              <label className="flabel">Período (mes)</label>
              <input className="fi" type="month" value={genPeriodo} onChange={e => setGenPeriodo(e.target.value)} style={{ width: 160 }} />
            </div>
            <button className="btn btn-amber" disabled={genBusy || !genObra} onClick={generarOrdenes}>
              <JxIcon name="plus" size={13} /> {genBusy ? 'Generando…' : 'Generar órdenes'}
            </button>
            {genObra && ejecutoraDe(genObra) && (
              <div style={{ fontSize: 11, color: 'var(--tm)', alignSelf: 'center' }}>Ejecutora: <strong>{companyNombre(ejecutoraDe(genObra))}</strong></div>
            )}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 8 }}>
            Una orden por empresa emisora × obra × mes. Solo entran los ítems <strong>clasificados, con emisora designada</strong> (Compras por Categoría) y <strong>vinculados</strong> al presupuesto. Podés ajustar cantidad y precio antes de enviar a aprobación.
          </div>
        </div>

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 14 }}>
          <div className="kpi-card"><div style={{ fontSize: 11.5, color: 'var(--tm)' }}>Borradores</div><div className="kpi-val" style={{ fontSize: 19 }}>{kpis.borrador}</div></div>
          <div className="kpi-card"><div style={{ fontSize: 11.5, color: 'var(--tm)' }}>Pendientes de aprobación</div><div className="kpi-val" style={{ fontSize: 19, color: 'var(--amber)' }}>{kpis.pendiente}</div></div>
          <div className="kpi-card"><div style={{ fontSize: 11.5, color: 'var(--tm)' }}>Aprobadas</div><div className="kpi-val" style={{ fontSize: 19, color: 'var(--green)' }}>{kpis.aprobadas}</div></div>
          <div className="kpi-card"><div style={{ fontSize: 11.5, color: 'var(--tm)' }}>Total aprobado</div><div className="kpi-val" style={{ fontSize: 17, color: 'var(--green)' }}>{fmtS(kpis.totalAprob)}</div></div>
        </div>

        {/* Filtro + lista */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <select className="fi" value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} style={{ width: 200 }}>
            <option value="todas">Todos los estados</option>
            {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.lbl}</option>)}
          </select>
        </div>

        {ordenesFiltradas.length === 0 ? (
          <div className="card card-p empty-state"><JxIcon name="list" size={36} color="var(--tm)" /><p>No hay órdenes. Generá los borradores del período arriba.</p></div>
        ) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr>
                  <th>Código</th><th>Emisora</th><th>Obra · Período</th>
                  <th style={{ textAlign: 'right' }}>Total</th><th>Estado</th><th style={{ width: 90 }}></th>
                </tr></thead>
                <tbody>
                  {ordenesFiltradas.map(o => {
                    const cadena = [o.intermediaria1_company_id, o.intermediaria2_company_id].filter(Boolean);
                    const est = ESTADOS[o.estado] || ESTADOS.borrador;
                    return (
                      <tr key={o.id}>
                        <td style={{ fontWeight: 600, fontSize: 12 }}>{o.codigo || '—'}<div style={{ fontSize: 9.5, color: 'var(--tm)' }}>{(o.items || []).length} línea(s)</div></td>
                        <td style={{ fontSize: 12 }}>{companyNombre(o.company_id)}
                          {cadena.length > 0 && <div style={{ fontSize: 9.5, color: 'var(--tm)' }}>vía {cadena.map(c => companyNombre(c)).join(' → ')}</div>}
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--tm)' }}>{obraNombre(o.obra_id)}<div>{o.periodo}</div></td>
                        <td style={{ textAlign: 'right', fontSize: 12.5, fontWeight: 700 }}>{fmtS(o.monto_total)}<div style={{ fontSize: 9.5, fontWeight: 400, color: 'var(--tm)' }}>+IGV inc.</div></td>
                        <td><span className={`badge ${est.cls}`} style={{ fontSize: 10 }}>{est.lbl}</span>
                          {o.estado === 'rechazada' && o.rechazo_motivo && <div style={{ fontSize: 9.5, color: 'var(--red)' }} title={o.rechazo_motivo}>{o.rechazo_motivo.slice(0, 40)}</div>}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button className="btn btn-ghost btn-xs" onClick={() => setDetalle(o)}>Ver</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </>)}

      {detalle && (
        <OrdenDetalleModal
          orden={ordenes.find(o => o.id === detalle.id) || detalle}
          companyNombre={companyNombre} obraNombre={obraNombre}
          canGestionar={canGestionar} canAprobar={canAprobar} busy={busy}
          onGuardarLineas={guardarLineas}
          onEnviar={enviarAprobacion} onAprobar={aprobar} onRechazar={() => setRechazarId(detalle.id)}
          onVolverBorrador={volverBorrador} onAnular={anular}
          onClose={() => setDetalle(null)}
        />
      )}
      {rechazarId && (
        <RechazarModal busy={busy}
          onConfirm={(m) => rechazar(ordenes.find(o => o.id === rechazarId), m)}
          onClose={() => setRechazarId(null)} />
      )}
    </div>
  );
}

// ─── Modal detalle: líneas editables (borrador) + transiciones + cadena ───────
function OrdenDetalleModal({ orden, companyNombre, obraNombre, canGestionar, canAprobar, busy, onGuardarLineas, onEnviar, onAprobar, onRechazar, onVolverBorrador, onAnular, onClose }) {
  const editable = canGestionar && orden.estado === 'borrador';
  const [items, setItems] = uS(() => (orden.items || []).map(l => ({ ...l })));
  // Re-sincronizar cuando cambia la orden persistida (tras guardar o al abrir
  // otra): sin esto el estado local quedaba con los strings tecleados.
  uE(() => { setItems((orden.items || []).map(l => ({ ...l }))); }, [orden.id, orden.updated_at]);
  const sub = items.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.precio_unit) || 0), 0);
  const igv = sub * (Number(orden.igv_pct) || 18) / 100;
  const setLinea = (i, patch) => setItems(arr => arr.map((l, j) => j === i ? { ...l, ...patch } : l));
  const quitar = (i) => setItems(arr => arr.filter((_, j) => j !== i));
  // Comparar en NÚMERO (los inputs guardan string): "6" y 6 no deben marcar dirty,
  // si no el botón "Enviar a aprobación" (gateado por !dirty) no volvía nunca.
  const norm = (arr) => JSON.stringify((arr || []).map(l => ({ ...l, cantidad: Number(l.cantidad) || 0, precio_unit: Number(l.precio_unit) || 0 })));
  const dirty = norm(items) !== norm(orden.items);
  const cadena = [orden.intermediaria1_company_id, orden.intermediaria2_company_id].filter(Boolean);
  const est = ESTADOS[orden.estado] || ESTADOS.borrador;

  return (
    <Modal title={`Orden ${orden.codigo || ''}`} icon="list" onClose={onClose} size="xl">
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 12, fontSize: 12 }}>
        <div>
          <div style={{ color: 'var(--tm)' }}>Emisora</div>
          <div style={{ fontWeight: 700, color: 'var(--ts)' }}>{companyNombre(orden.company_id)}</div>
          <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 4 }}>
            Cadena: <strong>compra</strong>{cadena.map(c => <span key={c}> → {companyNombre(c)}</span>)} → <strong>{companyNombre(orden.company_id)}</strong> → {companyNombre(orden.ejecutora_company_id) || 'ejecutora'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span className={`badge ${est.cls}`} style={{ fontSize: 10 }}>{est.lbl}</span>
          <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 4 }}>{obraNombre(orden.obra_id)} · {orden.periodo}</div>
        </div>
      </div>

      {orden.estado === 'rechazada' && orden.rechazo_motivo && (
        <div style={{ padding: '8px 10px', background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.3)', borderRadius: 6, fontSize: 11.5, color: 'var(--red)', marginBottom: 12 }}>
          Rechazada: {orden.rechazo_motivo}
        </div>
      )}

      <div style={{ border: '1px solid var(--bd)', borderRadius: 6, overflow: 'auto', maxHeight: 340, marginBottom: 10 }}>
        <table className="tbl" style={{ fontSize: 12 }}>
          <thead><tr>
            <th>Insumo</th><th style={{ width: 110 }}>Subcategoría</th>
            <th style={{ width: 90, textAlign: 'right' }}>Cantidad</th>
            <th style={{ width: 70 }}>Unidad</th>
            <th style={{ width: 110, textAlign: 'right' }}>Precio unit.</th>
            <th style={{ width: 110, textAlign: 'right' }}>Subtotal</th>
            {editable && <th style={{ width: 34 }}></th>}
          </tr></thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={editable ? 7 : 6} style={{ textAlign: 'center', color: 'var(--tm)', padding: 12 }}>Sin líneas.</td></tr>
            ) : items.map((l, i) => (
              <tr key={i}>
                <td style={{ fontSize: 11.5 }}>{l.insumo_nombre}<div style={{ fontSize: 9.5, color: 'var(--tm)' }}>{String(l.insumo_codigo || '').startsWith('sc:') ? 'sin código' : l.insumo_codigo}</div></td>
                <td style={{ fontSize: 10.5, color: 'var(--tm)' }}>{l.subcategoria || '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  {editable
                    ? <input className="fi" type="number" min="0" step="0.01" value={l.cantidad} onChange={e => setLinea(i, { cantidad: e.target.value })} style={{ fontSize: 11, textAlign: 'right', width: 80 }} />
                    : Number(l.cantidad).toLocaleString('es-PE')}
                </td>
                <td style={{ fontSize: 11, color: 'var(--tm)' }}>{l.unidad || '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  {editable
                    ? <input className="fi" type="number" min="0" step="0.0001" value={l.precio_unit} onChange={e => setLinea(i, { precio_unit: e.target.value })} style={{ fontSize: 11, textAlign: 'right', width: 90 }} />
                    : fmtS(l.precio_unit)}
                </td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtS((Number(l.cantidad) || 0) * (Number(l.precio_unit) || 0))}</td>
                {editable && <td style={{ textAlign: 'center' }}><button className="btn btn-ghost btn-xs" style={{ color: 'var(--red)' }} onClick={() => quitar(i)} title="Quitar línea"><JxIcon name="x" size={10} /></button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 24, fontSize: 12, marginBottom: 14 }}>
        <div style={{ textAlign: 'right', color: 'var(--tm)' }}>
          <div>Subtotal: <strong style={{ color: 'var(--ts)' }}>{fmtS(sub)}</strong></div>
          <div>IGV ({orden.igv_pct || 18}%): <strong style={{ color: 'var(--ts)' }}>{fmtS(igv)}</strong></div>
          <div style={{ fontSize: 14 }}>Total: <strong style={{ color: 'var(--green)' }}>{fmtS(sub + igv)}</strong></div>
        </div>
      </div>

      <div className="modal-actions" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cerrar</button>
        {editable && dirty && <button className="btn btn-amber" disabled={busy} onClick={() => onGuardarLineas(orden, items.map(l => ({ ...l, cantidad: Number(l.cantidad) || 0, precio_unit: Number(l.precio_unit) || 0 })))}>Guardar cambios</button>}
        {canGestionar && orden.estado === 'borrador' && !dirty && <button className="btn btn-amber" disabled={busy || items.length === 0} onClick={() => onEnviar(orden)}>Enviar a aprobación</button>}
        {canGestionar && orden.estado === 'rechazada' && <button className="btn btn-ghost" disabled={busy} onClick={() => onVolverBorrador(orden)}>Volver a borrador</button>}
        {canAprobar && orden.estado === 'pendiente_aprobacion' && <>
          <button className="btn btn-ghost" style={{ color: 'var(--red)' }} disabled={busy} onClick={onRechazar}>Rechazar</button>
          <button className="btn btn-amber" style={{ background: 'var(--green)', borderColor: 'var(--green)' }} disabled={busy} onClick={() => onAprobar(orden)}>✓ Aprobar</button>
        </>}
        {canGestionar && ['borrador', 'rechazada'].includes(orden.estado) && <button className="btn btn-ghost btn-xs" style={{ color: 'var(--tm)' }} disabled={busy} onClick={() => onAnular(orden)}>Anular</button>}
      </div>

      {orden.estado === 'aprobada' && (
        <div style={{ marginTop: 10, padding: '8px 10px', background: 'rgba(46,204,113,0.08)', border: '1px solid rgba(46,204,113,0.3)', borderRadius: 6, fontSize: 11.5, color: 'var(--ts)' }}>
          ✓ Aprobada. Lista para <strong>emitir el comprobante</strong> con la llave digital de {companyNombre(orden.company_id)} <span style={{ color: 'var(--tm)' }}>(emisión SUNAT — próxima fase).</span>
        </div>
      )}
    </Modal>
  );
}

function RechazarModal({ busy, onConfirm, onClose }) {
  const [motivo, setMotivo] = uS('');
  return (
    <Modal title="Rechazar orden" icon="x" onClose={onClose}>
      <label className="flabel">Motivo del rechazo</label>
      <textarea className="fi" rows={3} value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ej: el precio de la subcategoría fierro no corresponde…" style={{ marginBottom: 14, resize: 'vertical' }} />
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn btn-amber" style={{ background: 'var(--red)', borderColor: 'var(--red)' }} disabled={busy || !motivo.trim()} onClick={() => onConfirm(motivo.trim())}>Rechazar</button>
      </div>
    </Modal>
  );
}

Object.assign(window, { OrdenesIntercompanyPage });
export { OrdenesIntercompanyPage };
