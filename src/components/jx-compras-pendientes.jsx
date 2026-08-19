// ═══════════════════════════════════════════════════════════════════
// JARVEX — Compras pendientes de recepción
//
// Pantalla pensada para el almacenero (también accesible a admin /
// jefe_compras). Lista todas las facturas que la contadora cargó vía
// captura mágica y que tienen recepcion_status='pendiente_recepcion'.
//
// El almacenero ve solo lo que necesita:
//   - Nombre del proveedor / razón social
//   - Items: descripción + cantidad + unidad (NO precio)
//   - Fecha de la factura
// Click en "Registrar recepción" → modal de ingreso con los items
// pre-rellenados. Al confirmar, marca la factura como 'recibido' y
// crea los movimientos de entrada al inventario.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { TIPO_INSUMO_LABEL, TIPO_INSUMO_BADGE } from "../lib/insumo-clasificador.js";
import { aplicarDelta } from "../lib/stock-ubicaciones.js";
import { calcAlerta } from "../lib/stock-utils.js";
import { getCurrentMode } from "../lib/app-mode-core.js";
import { registrarCambioPrecio } from "../lib/precio-historial.js";

const { useState: uS, useEffect: uE, useMemo: uM } = React;

const JxIcon = (props) => (window.JxIcon ? <window.JxIcon {...props}/> : null);
const Modal = (props) => (window.Modal ? <window.Modal {...props}/> : null);
const SearchableSelect = (props) => (window.SearchableSelect ? <window.SearchableSelect {...props}/> : null);

// Config por tipo de insumo: tabla de movimiento, fk, item_tipo de
// stock_ubicaciones y la tabla de catálogo (para subir stock_actual).
const CFG_TIPO = {
  material:    { mov: 'movimientos_materiales',         fk: 'material_id',         itemTipo: 'material',    cat: 'materiales',         nombreCol: 'nombre_material',    idkey: 'movmat' },
  herramienta: { mov: 'movimientos_herramientas',       fk: 'herramienta_id',      itemTipo: 'herramienta', cat: 'herramientas',       nombreCol: 'nombre_herramienta', idkey: 'movherr' },
  epp:         { mov: 'movimientos_epp',                fk: 'epp_id',              itemTipo: 'epp',         cat: 'epps',               nombreCol: 'nombre_epp',         idkey: 'movepp' },
  // Maquinaria por cantidad vive en activos_pesados (maneja_cantidad); emergencia
  // en insumos_emergencia. Sus movimientos usan tipo_movimiento 'entrada'.
  maquinaria:  { mov: 'movimientos_maquinaria',         fk: 'activo_id',           itemTipo: 'maquinaria',  cat: 'activos_pesados',    nombreCol: 'nombre',            idkey: 'movmaq' },
  emergencia:  { mov: 'movimientos_insumos_emergencia', fk: 'insumo_emergencia_id', itemTipo: 'emergencia',  cat: 'insumos_emergencia', nombreCol: 'nombre',            idkey: 'movemerg' },
};

// Normaliza un nombre para comparar (sin tildes, sin signos, minúsculas).
const _normNom = (s) => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
// Puntaje de similitud 0..1 entre dos nombres: Jaccard de tokens (≥2 chars) +
// bonus si uno contiene al otro. Sirve para sugerir el insumo del catálogo más
// parecido a la descripción de la factura (los nombres rara vez coinciden).
function simNombre(a, b) {
  const na = _normNom(a), nb = _normNom(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const sa = new Set(na.split(' ').filter(w => w.length >= 2));
  const sb = new Set(nb.split(' ').filter(w => w.length >= 2));
  if (!sa.size || !sb.size) return 0;
  let inter = 0; for (const w of sa) if (sb.has(w)) inter++;
  const jacc = inter / (sa.size + sb.size - inter);
  const contains = (na.includes(nb) || nb.includes(na)) ? 0.3 : 0;
  return Math.min(1, jacc + contains);
}
// Distancia en días absolutos entre dos fechas YYYY-MM-DD (Infinity si falta).
function diasEntre(a, b) {
  if (!a || !b) return Infinity;
  const ta = Date.parse(a), tb = Date.parse(b);
  if (isNaN(ta) || isNaN(tb)) return Infinity;
  return Math.abs(ta - tb) / 86400000;
}
// ¿Es un movimiento de INGRESO real (compra/recepción), candidato a vincular a
// una factura? Excluye lo que NO es una compra aunque tenga 'entrada':
//  - devolución / salida / baja
//  - REVERSO de otra operación (reverses_id / reversed_by_id / tipo='reverso'):
//    en herramientas el reverso de una salida queda con accion='entrada'.
//  - pierna de ENTRADA de un TRASPASO entre almacenes (mismo stock, no compra).
// En herramientas las devoluciones traen accion='entrada' pero tipo='devolucion',
// por eso filtramos por tipo_movimiento y solo caemos a `accion` al final.
const _esIngreso = (m) => {
  if (m?.reverses_id || m?.reversed_by_id) return false;
  const tm = String(m?.tipo_movimiento || '').toLowerCase();
  if (['devolucion', 'salida', 'baja', 'reverso', 'traspaso'].includes(tm)) return false;
  if (/traspaso/i.test(String(m?.observaciones || ''))) return false;
  if (tm === 'entrada' || tm === 'ingreso') return true;
  return String(m?.accion || '').toLowerCase() === 'entrada';
};

function ComprasPendientesPage({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : {};
  const userId = auth?.profile?.id || null;
  // useObraActiva retorna { obraId, obra, obras, setObraActiva, loading }.
  // Asignar el objeto entero a `obraId` rompe el filtro porque la comparación
  // `m.obra_id === obraId` siempre da false.
  const obraHook = window.__useObraActiva ? window.__useObraActiva() : { obraId: null };
  const obraId = obraHook?.obraId || null;

  const [movsContables, setMovsContables] = uS([]);
  const [materiales, setMateriales] = uS([]);
  const [herramientas, setHerramientas] = uS([]);
  const [epps, setEpps] = uS([]);
  const [maquinarias, setMaquinarias] = uS([]);   // activos_pesados por cantidad
  const [emergencias, setEmergencias] = uS([]);    // insumos_emergencia
  const [proveedores, setProveedores] = uS([]);
  const [loading, setLoading] = uS(true);
  const [recibiendoId, setRecibiendoId] = uS(null);   // id del mov contable a recibir
  const [busy, setBusy] = uS(false);
  // Negar recepción: facturas/ítems que NO debían llegar al almacén (la contadora
  // olvidó desmarcar el envío, le reportaron que no ingresará, etc.).
  const [negarTarget, setNegarTarget] = uS(null);     // { mc, idx|null } — idx null = factura completa
  const [negadas, setNegadas] = uS([]);               // facturas recepcion_status='no_recepcionado'
  const [verNegadas, setVerNegadas] = uS(false);

  // Carga inicial + reactivo a sync
  uE(() => {
    if (!obraId) return;
    let cancelled = false;
    const load = async () => {
      try {
        // `obra_id` NO está indexado en accounting_movements (ver
        // jarvex.db.js, schema version 15). Por eso filtramos en memoria.
        // Pasar `.where('obra_id')` con un keyPath no indexado en Dexie
        // tira SchemaError y la promesa rechaza → la lista queda vacía
        // sin que el usuario se entere.
        const [mcAll, mt, hr, ep, mq, em, pr] = await Promise.all([
          window.__db.accounting_movements.toArray(),
          window.__db.materiales.where('obra_id').equals(obraId).toArray(),
          window.__db.herramientas.where('obra_id').equals(obraId).toArray(),
          window.__db.epps.where('obra_id').equals(obraId).toArray(),
          // activos_pesados se indexa por obra_actual_id (no obra_id) → toArray + filtro.
          window.__db.activos_pesados.toArray().catch(() => []),
          window.__db.insumos_emergencia.where('obra_id').equals(obraId).toArray().catch(() => []),
          window.__db.proveedores.toArray(),
        ]);
        const mc = mcAll.filter(m =>
          m.obra_id === obraId &&
          ['pendiente_recepcion', 'parcial'].includes(m.recepcion_status) &&
          !m.deleted_at
        );
        // Negadas: facturas que el almacén marcó como "no ingresó" (la contadora
        // olvidó desmarcar, le reportaron que no entra, etc.). Fuera de la lista
        // principal, visibles en "Ver negadas" y reabribles.
        const neg = mcAll.filter(m => m.obra_id === obraId && m.recepcion_status === 'no_recepcionado' && !m.deleted_at);
        neg.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
        if (cancelled) return;
        mc.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        setMovsContables(mc);
        setNegadas(neg);
        setMateriales(mt);
        setHerramientas(hr);
        setEpps(ep);
        // Maquinaria: solo los activos por cantidad (los individuales no encajan
        // en una recepción por unidades) de esta obra (obra_id u obra_actual_id).
        setMaquinarias((mq || []).filter(x => x.maneja_cantidad && !x.deleted_at && (x.obra_id === obraId || x.obra_actual_id === obraId)));
        setEmergencias(em || []);
        setProveedores(pr);
      } catch (e) {
        console.warn('[compras-pendientes]', e?.message || e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const onChange = (e) => {
      const t = e?.detail?.tabla || e?.detail?.table;
      if (!t || ['accounting_movements','materiales','herramientas','epps','activos_pesados','insumos_emergencia','proveedores'].includes(t)) load();
    };
    window.addEventListener('jx_data_changed', onChange);
    window.addEventListener('jarvex_master_updated', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('jx_data_changed', onChange);
      window.removeEventListener('jarvex_master_updated', onChange);
    };
  }, [obraId]);

  const matsById = uM(() => new Map(materiales.map(m => [m.id, m])), [materiales]);
  const herrsById = uM(() => new Map(herramientas.map(h => [h.id, h])), [herramientas]);
  const eppsById = uM(() => new Map(epps.map(e => [e.id, e])), [epps]);
  const provsById = uM(() => new Map(proveedores.map(p => [p.id, p])), [proveedores]);
  // Catálogo unificado para verificar que un id existe en cualquier tabla
  const catalogoCompleto = uM(() => {
    const m = new Map();
    materiales.forEach(x => m.set(x.id, { tipo: 'material', record: x }));
    herramientas.forEach(x => m.set(x.id, { tipo: 'herramienta', record: x }));
    epps.forEach(x => m.set(x.id, { tipo: 'epp', record: x }));
    maquinarias.forEach(x => m.set(x.id, { tipo: 'maquinaria', record: x }));
    emergencias.forEach(x => m.set(x.id, { tipo: 'emergencia', record: x }));
    return m;
  }, [materiales, herramientas, epps, maquinarias, emergencias]);
  // Lista plana para el selector de match manual (vincular el ítem de la factura
  // a un insumo del catálogo aunque el nombre difiera) — los 5 tipos.
  const catalogoTodos = uM(() => [
    ...materiales.filter(x => !x.deleted_at && !x.es_grupo).map(x => ({ id: x.id, tipo: 'material', nombre: x.nombre_material || '—' })),
    ...herramientas.filter(x => !x.deleted_at && !x.es_grupo).map(x => ({ id: x.id, tipo: 'herramienta', nombre: x.nombre_herramienta || '—' })),
    ...epps.filter(x => !x.deleted_at && !x.es_grupo).map(x => ({ id: x.id, tipo: 'epp', nombre: x.nombre_epp || '—' })),
    ...maquinarias.filter(x => !x.deleted_at && !x.es_grupo).map(x => ({ id: x.id, tipo: 'maquinaria', nombre: x.nombre || '—' })),
    ...emergencias.filter(x => !x.deleted_at && !x.es_grupo).map(x => ({ id: x.id, tipo: 'emergencia', nombre: x.nombre || '—' })),
  ], [materiales, herramientas, epps, maquinarias, emergencias]);

  // Parse items del JSON de notas (los guarda captura mágica)
  const parseItems = (notasRaw) => {
    try {
      const j = JSON.parse(notasRaw || '{}');
      return Array.isArray(j.items_factura) ? j.items_factura : [];
    } catch { return []; }
  };

  const facturaSeleccionada = recibiendoId
    ? movsContables.find(m => m.id === recibiendoId)
    : null;

  // Estado de recepción derivado de los ítems (espejo del cierre en el modal):
  // un ítem está "resuelto" si se recibió completo, no va al almacén (servicio /
  // empresa / gasto de obra) o el almacén lo NEGÓ. Sirve para recalcular el
  // estado al negar/reabrir un ítem suelto sin abrir el modal de recepción.
  const recomputeStatus = (items) => {
    const resuelto = (it) => it.rechazado || it.tipo_insumo === 'servicio'
      || ['empresa', 'obra_general'].includes(it.destino)
      || ['para_venta', 'vendido'].includes(it.venta_status)   // separado para VENTA: no ingresa a obra
      || (Number(it.recibido) || 0) >= (Number(it.cantidad) || 0) - 0.0001;
    const algoRecibido = items.some(it => (Number(it.recibido) || 0) > 0);
    const hayRechazo = items.some(it => it.rechazado);
    if (!items.every(resuelto)) return algoRecibido ? 'parcial' : 'pendiente_recepcion';
    if (algoRecibido) return 'recibido';
    return hayRechazo ? 'no_recepcionado' : 'recibido';
  };

  // Negar la entrada: factura completa (idx null) o un ítem suelto. NO toca stock
  // (no crea movimientos): solo marca los ítems y reubica la factura fuera de la
  // lista de pendientes. Idempotente y reversible con "Reabrir".
  const negarRecepcion = async ({ mc, idx }, motivo) => {
    if (busy) return;
    setBusy(true);
    try {
      const isPrueba = getCurrentMode() === 'prueba';
      const fresh = await window.__db.accounting_movements.get(mc.id);
      if (!fresh) { showToast?.('La factura ya no existe (se sincronizó otro cambio)', 'red'); return; }
      const notasObj = (() => { try { return JSON.parse(fresh.notas || '{}'); } catch { return {}; } })();
      const items = Array.isArray(notasObj.items_factura) ? notasObj.items_factura : [];
      const now = new Date().toISOString();
      const sello = { rechazado: true, rechazo_motivo: motivo, rechazo_por: userId, rechazo_fecha: now };
      let nuevoStatus;
      if (idx == null) {
        // Factura completa: negar todo lo que no se recibió por completo.
        notasObj.items_factura = items.map(it =>
          (Number(it.recibido) || 0) >= (Number(it.cantidad) || 0) - 0.0001 ? it : { ...it, ...sello });
        notasObj.recepcion_rechazo = { motivo, por: userId, fecha: now };
        nuevoStatus = 'no_recepcionado';
      } else {
        // Un ítem suelto: marcarlo y recalcular el estado de la factura.
        notasObj.items_factura = items.map((it, i) => i === idx ? { ...it, ...sello } : it);
        nuevoStatus = recomputeStatus(notasObj.items_factura);
        if (nuevoStatus === 'no_recepcionado') notasObj.recepcion_rechazo = { motivo, por: userId, fecha: now };
      }
      const facturaNoSube = isPrueba || fresh.demo === true;
      await window.__db.accounting_movements.update(fresh.id, {
        notas: JSON.stringify(notasObj), recepcion_status: nuevoStatus,
        recepcion_fecha: now, recepcion_por: userId, updated_at: now, updated_by: userId,
        version: (fresh.version || 0) + 1,
        sync_status: facturaNoSube ? 'synced' : (fresh.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'),
      });
      try { await window.__logAudit?.({ action: 'update', table: 'accounting_movements', recordId: fresh.id, reason: `Recepción NEGADA (${idx == null ? 'factura completa' : 'ítem'}) — ${motivo} · ${fresh.document_number || ''}` }); } catch {}
      window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'accounting_movements' } }));
      try { window.dispatchEvent(new Event('online')); } catch {}
      showToast?.(idx == null ? 'Factura negada — sale de compras pendientes' : 'Ítem negado', 'green');
      setNegarTarget(null);
    } catch (e) { showToast?.('Error al negar: ' + (e?.message || e), 'red'); }
    finally { setBusy(false); }
  };

  // Reabrir una factura negada: limpia las marcas de rechazo y la devuelve a la
  // cola (pendiente / parcial según lo ya recibido).
  const reabrirNegada = async (mc) => {
    if (busy) return;
    setBusy(true);
    try {
      const isPrueba = getCurrentMode() === 'prueba';
      const fresh = await window.__db.accounting_movements.get(mc.id);
      if (!fresh) { showToast?.('La factura ya no existe', 'red'); return; }
      const notasObj = (() => { try { return JSON.parse(fresh.notas || '{}'); } catch { return {}; } })();
      const items = Array.isArray(notasObj.items_factura) ? notasObj.items_factura : [];
      notasObj.items_factura = items.map(({ rechazado, rechazo_motivo, rechazo_por, rechazo_fecha, ...rest }) => rest);
      delete notasObj.recepcion_rechazo;
      const now = new Date().toISOString();
      const nuevoStatus = recomputeStatus(notasObj.items_factura);
      const facturaNoSube = isPrueba || fresh.demo === true;
      await window.__db.accounting_movements.update(fresh.id, {
        notas: JSON.stringify(notasObj),
        recepcion_status: nuevoStatus === 'no_recepcionado' ? 'pendiente_recepcion' : nuevoStatus,
        updated_at: now, updated_by: userId, version: (fresh.version || 0) + 1,
        sync_status: facturaNoSube ? 'synced' : (fresh.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'),
      });
      try { await window.__logAudit?.({ action: 'update', table: 'accounting_movements', recordId: fresh.id, reason: `Recepción REABIERTA — ${fresh.document_number || ''}` }); } catch {}
      window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'accounting_movements' } }));
      try { window.dispatchEvent(new Event('online')); } catch {}
      showToast?.('Factura reabierta — vuelve a compras pendientes', 'green');
    } catch (e) { showToast?.('Error al reabrir: ' + (e?.message || e), 'red'); }
    finally { setBusy(false); }
  };

  if (!obraId) {
    return (
      <div className="page-wrap">
        <div className="empty-state">
          <JxIcon name="package" size={32} color="var(--tm)"/>
          <p>Selecciona una obra activa para ver las compras pendientes.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Compras pendientes de recepción</div>
          <div className="pg-sub">
            {movsContables.length} factura(s) por recibir (incluye recepciones parciales en curso)
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card card-p" style={{ textAlign:'center', color:'var(--tm)' }}>Cargando...</div>
      ) : movsContables.length === 0 ? (
        <div className="card card-p" style={{ textAlign:'center', color:'var(--tm)' }}>
          <JxIcon name="check" size={28} color="var(--green)"/>
          <p style={{ marginTop:10 }}>Sin compras pendientes. Cuando la contadora cargue una factura aparecerá aquí.</p>
        </div>
      ) : (
        <div style={{ display:'grid', gap:10 }}>
          {movsContables.map(mc => {
            const items = parseItems(mc.notas);
            const prov = mc.proveedor_id ? provsById.get(mc.proveedor_id) : null;
            const provName = prov?.razon_social || mc.third_party_name || '—';
            return (
              <div key={mc.id} className="card card-p" style={{ borderLeft:'3px solid var(--amber)' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10, flexWrap:'wrap' }}>
                  <div style={{ flex:1, minWidth:280 }}>
                    <div style={{ fontSize:11, color:'var(--amber)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em' }}>
                      {mc.document_type || 'comprobante'} {mc.document_number}
                      {mc.recepcion_status === 'parcial' && <span className="badge b-amber" style={{ marginLeft:8, fontSize:9 }}>Recepción parcial</span>}
                    </div>
                    <div style={{ fontSize:14, fontWeight:600, color:'var(--ts)', marginTop:2 }}>
                      {provName}
                    </div>
                    <div style={{ fontSize:11.5, color:'var(--tm)', marginTop:4 }}>
                      Fecha factura: {mc.date} · cargada el {(mc.created_at || '').slice(0,10)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                    <button className="btn btn-amber btn-sm" onClick={() => setRecibiendoId(mc.id)}>
                      <JxIcon name="arrowIn" size={12}/> Registrar recepción
                    </button>
                    <button className="btn btn-ghost btn-xs" style={{ color: 'var(--red)' }} disabled={busy}
                      title="La mercadería NO ingresó al almacén (la contadora olvidó desmarcarla, o te reportaron que no entra). Sale de compras pendientes sin tocar el stock."
                      onClick={() => setNegarTarget({ mc, idx: null })}>
                      <JxIcon name="x" size={11}/> Negar recepción
                    </button>
                  </div>
                </div>
                {items.length > 0 ? (
                  <div style={{ marginTop:10, padding:'8px 10px', background:'var(--bg2)', border:'1px solid var(--bd)', borderRadius:6 }}>
                    <div style={{ fontSize:10.5, color:'var(--tm)', fontWeight:600, marginBottom:4, textTransform:'uppercase', letterSpacing:'.05em' }}>
                      Items a recibir ({items.length})
                    </div>
                    <table className="tbl" style={{ fontSize:11.5 }}>
                      <thead><tr>
                        <th>Insumo</th>
                        <th style={{ width:90 }}>Tipo</th>
                        <th style={{ width:80, textAlign:'right' }}>Cantidad</th>
                        <th style={{ width:60 }}>Unidad</th>
                        <th style={{ width:80 }}>En catálogo</th>
                        <th style={{ width:34 }}></th>
                      </tr></thead>
                      <tbody>
                        {items.map((it, i) => {
                          const enCatalogo = it.material_id && catalogoCompleto.has(it.material_id);
                          const tipo = it.tipo_insumo || 'material';
                          const negado = !!it.rechazado;
                          const yaRecibido = (Number(it.recibido) || 0) >= (Number(it.cantidad) || 0) - 0.0001;
                          return (
                            <tr key={i} style={negado ? { opacity: 0.45, textDecoration: 'line-through' } : (it.destino === 'empresa' || it.destino === 'obra_general') ? { opacity: 0.6 } : null}>
                              <td style={{ color:'var(--ts)' }}>{it.descripcion || '—'}
                                {negado && <span className="badge b-red" style={{ marginLeft: 6, fontSize: 9 }} title={it.rechazo_motivo || 'No ingresó al almacén'}>🚫 negado</span>}
                                {it.destino === 'empresa' && <span className="badge b-gray" style={{ marginLeft: 6, fontSize: 9 }} title="Consumo general de la empresa (oficina) — no se recibe en el almacén de la obra">🏢 empresa</span>}
                                {it.destino === 'obra_general' && <span className="badge b-amber" style={{ marginLeft: 6, fontSize: 9 }} title="Gasto general de la obra (ej. comida del personal) — normalmente no se recibe en el almacén">🍽 gasto obra</span>}
                                {['para_venta', 'vendido'].includes(it.venta_status) && <span className="badge b-blue" style={{ marginLeft: 6, fontSize: 9 }} title="Contabilidad lo separó para VENTA (no va a ingresar a la obra). Si de verdad ingresó, avisá a contabilidad antes de recepcionarlo.">🏷 para venta</span>}
                              </td>
                              <td>
                                <span className={`badge ${TIPO_INSUMO_BADGE[tipo] || 'b-gray'}`} style={{ fontSize:9 }}>
                                  {TIPO_INSUMO_LABEL[tipo] || tipo}
                                </span>
                              </td>
                              <td style={{ textAlign:'right', fontWeight:600 }}>
                                {Number(it.cantidad).toLocaleString('es-PE')}
                                {Number(it.recibido) > 0 && <div style={{ fontSize:9.5, color:'var(--green)' }}>recibido {Number(it.recibido).toLocaleString('es-PE')}</div>}
                              </td>
                              <td style={{ color:'var(--tm)' }}>{it.unidad || '—'}</td>
                              <td>
                                {tipo === 'servicio'
                                  ? <span className="badge b-purple" style={{ fontSize:9 }}>N/A</span>
                                  : enCatalogo
                                    ? <span className="badge b-green" style={{ fontSize:9 }}>OK</span>
                                    : <span className="badge b-yellow" style={{ fontSize:9 }}>Falta</span>}
                              </td>
                              <td style={{ textAlign:'center' }}>
                                {/* Negar un ítem suelto (los ya recibidos no se pueden negar). */}
                                {!negado && !yaRecibido && (
                                  <button className="btn btn-ghost btn-xs" style={{ padding:'2px 5px', color:'var(--red)' }} disabled={busy}
                                    title="Este ítem no ingresó al almacén — negarlo (no toca stock)"
                                    onClick={() => setNegarTarget({ mc, idx: i })}>
                                    <JxIcon name="x" size={10}/>
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ marginTop:10, fontSize:11, color:'var(--tm)', fontStyle:'italic' }}>
                    La factura no detalla items (probablemente un gasto general).
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Facturas negadas — colapsable, reversible */}
      {negadas.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setVerNegadas(v => !v)}>
            <JxIcon name="eye" size={12} /> {verNegadas ? 'Ocultar' : 'Ver'} facturas negadas ({negadas.length})
          </button>
          {verNegadas && (
            <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
              {negadas.map(mc => {
                const prov = mc.proveedor_id ? provsById.get(mc.proveedor_id) : null;
                const provName = prov?.razon_social || mc.third_party_name || '—';
                let rechazo = null; try { rechazo = JSON.parse(mc.notas || '{}').recepcion_rechazo; } catch {}
                return (
                  <div key={mc.id} className="card card-p" style={{ borderLeft: '3px solid var(--red)', opacity: 0.9 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 260 }}>
                        <div style={{ fontSize: 11, color: 'var(--red)', fontWeight: 700 }}>🚫 {mc.document_type || 'comprobante'} {mc.document_number}</div>
                        <div style={{ fontSize: 13, color: 'var(--ts)', marginTop: 2 }}>{provName}</div>
                        {rechazo?.motivo && <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 3 }}>Motivo: <em>{rechazo.motivo}</em>{rechazo.fecha ? ` · ${String(rechazo.fecha).slice(0, 10)}` : ''}</div>}
                      </div>
                      <button className="btn btn-ghost btn-sm" disabled={busy} title="Devolver esta factura a compras pendientes" onClick={() => reabrirNegada(mc)}>
                        <JxIcon name="arrowIn" size={12} /> Reabrir
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal: motivo de la negación */}
      {negarTarget && (
        <NegarRecepcionModal
          target={negarTarget}
          busy={busy}
          onConfirm={(motivo) => negarRecepcion(negarTarget, motivo)}
          onClose={() => setNegarTarget(null)}
        />
      )}

      {/* Modal Registrar Recepción */}
      {facturaSeleccionada && (
        <RegistrarRecepcionModal
          factura={facturaSeleccionada}
          items={parseItems(facturaSeleccionada.notas)}
          obraId={obraId}
          userId={userId}
          catalogoCompleto={catalogoCompleto}
          catalogoTodos={catalogoTodos}
          provsById={provsById}
          busy={busy}
          setBusy={setBusy}
          showToast={showToast}
          onClose={() => setRecibiendoId(null)}
        />
      )}
    </div>
  );
}

// ─── Modal: negar la recepción (factura completa o un ítem) ───────────────────
function NegarRecepcionModal({ target, busy, onConfirm, onClose }) {
  const esFactura = target.idx == null;
  const MOTIVOS = [
    'La contadora olvidó desmarcar el envío al almacén',
    'Me reportaron que no ingresará',
    'Ya lo recibí por otro medio',
    'No corresponde a esta obra',
  ];
  const [motivo, setMotivo] = uS('');
  const [libre, setLibre] = uS('');
  const final = (libre.trim() || motivo).trim();
  return (
    <Modal title={esFactura ? 'Negar recepción de la factura' : 'Negar este ítem'} icon="x" onClose={onClose}>
      <div style={{ fontSize: 12, color: 'var(--tm)', marginBottom: 12 }}>
        {esFactura
          ? 'La factura completa saldrá de compras pendientes. No se toca el stock. Podés reabrirla después desde "Facturas negadas".'
          : 'Este ítem se marca como NO ingresado. No se toca el stock.'}
      </div>
      <label className="flabel">Motivo</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 10 }}>
        {MOTIVOS.map(m => (
          <label key={m} style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12, cursor: 'pointer', color: 'var(--ts)' }}>
            <input type="radio" name="motivo-negar" checked={motivo === m && !libre.trim()} onChange={() => { setMotivo(m); setLibre(''); }} />
            {m}
          </label>
        ))}
      </div>
      <label className="flabel">Otro motivo (opcional)</label>
      <input className="fi" value={libre} placeholder="Escribí un motivo distinto…" onChange={e => setLibre(e.target.value)} style={{ marginBottom: 14 }} />
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn btn-amber" style={{ background: 'var(--red)', borderColor: 'var(--red)' }} disabled={busy || !final}
          onClick={() => onConfirm(final)}>
          <JxIcon name="x" size={13} /> {busy ? 'Procesando…' : (esFactura ? 'Negar factura' : 'Negar ítem')}
        </button>
      </div>
    </Modal>
  );
}

// ─── Modal de Recepción (editable, con match manual y parcial multi-almacén) ──
function RegistrarRecepcionModal({ factura, items, obraId, userId, catalogoCompleto, catalogoTodos, provsById, busy, setBusy, showToast, onClose }) {
  // Cada fila: el tipo y el match son EDITABLES. Por defecto toma lo que dejó
  // la IA (material_id + tipo_insumo); el almacenero puede corregirlos.
  const tipoDeId = (id) => catalogoCompleto.get(id)?.tipo || null;
  // Tipos que NO ingresan al almacén: servicios/gastos (combustible, fletes,
  // alquiler, honorarios) y maquinaria (vive en activos_pesados, fuera de este
  // catálogo). NO son recibibles ni "creables" como insumo: si se forzaran a
  // 'material' —el select de Tipo solo ofrece material/herramienta/epp— se
  // crearía un insumo fantasma con stock que contamina inventario y reportes.
  // Los mostramos como N/A, igual que la lista de Compras Pendientes.
  const NO_STOCK = new Set(['servicio']);
  const [recep, setRecep] = uS(() =>
    items.map(it => {
      const ya = Number(it.recibido) || 0;
      const resta = Math.max(0, (Number(it.cantidad) || 0) - ya);
      const noStock = NO_STOCK.has(it.tipo_insumo);
      const matchId = it.material_id && catalogoCompleto.has(it.material_id) ? it.material_id : null;
      // Para no-stock conservamos el tipo real (servicio/maquinaria): NO lo
      // colapsamos a 'material' porque eso habilitaba el botón "Crear" y la
      // verificación. Para el resto, el tipo del match o el detectado por la IA.
      const tipo = noStock
        ? it.tipo_insumo
        : ((matchId && tipoDeId(matchId)) || (it.tipo_insumo || 'material'));
      // Consumo general de empresa (oficina) o gasto general de la obra (ej. comida
      // del personal): NO entra al almacén → por defecto no se recibe (cantidad 0,
      // sin verificar). El almacenero puede forzarlo si corresponde (ej. bidón de agua).
      const esEmpresa = it.destino === 'empresa' || it.destino === 'obra_general';
      // Ítem NEGADO por el almacén (no ingresó): no se recibe, no bloquea el cierre.
      const negado = !!it.rechazado;
      return {
        ...it, ya_recibido: ya, no_stock: noStock, es_empresa: esEmpresa, negado,
        cantidad_recibida: (esEmpresa || negado) ? 0 : resta,        // por defecto, lo que falta (0 si es de empresa/negado)
        verificado: !esEmpresa && !noStock && !negado && resta > 0 && !!matchId,  // listo si hay match y falta recibir
        match_id: noStock ? null : matchId, tipo,
        ubicacion_id: null, obs_item: '',
        // 'nuevo' = crea un movimiento de ingreso y sube stock (default).
        // 'existente' = se vincula a un movimiento de ingreso YA registrado
        // (la mercadería ya entró): solo le estampa la factura, NO toca stock.
        modo: 'nuevo', mov_existente_id: null,
        // creado_aqui = el insumo se creó en esta misma recepción (exige almacén).
        creado_aqui: false,
        // crear_nuevo = { nombre, unidad } de un insumo a crear EN confirmar()
        // (creación diferida, atómica con el movimiento). null = no crear.
        crear_nuevo: null,
      };
    })
  );
  const [obsGlobal, setObsGlobal] = uS('');
  // Fecha del MOVIMIENTO de ingreso (editable): por defecto hoy, pero se puede
  // backdatear si la mercadería se recibió antes y recién ahora la vinculamos.
  const [fechaMov, setFechaMov] = uS(() => new Date().toISOString().slice(0, 10));
  const [ubicaciones, setUbicaciones] = uS([]);
  // Movimientos de ingreso candidatos para VINCULAR (cache por insumo).
  const [candCache, setCandCache] = uS({});     // `${tipo}:${matchId}` -> array
  const [candLoading, setCandLoading] = uS({}); // misma clave -> bool
  const [candOpen, setCandOpen] = uS(null);     // idx de fila con el panel abierto
  const [crearForm, setCrearForm] = uS(null);   // { idx, nombre, unidad } del panel de creación
  // Candado SÍNCRONO contra doble-post. `busy` (estado de React) no protege de
  // un doble-click rápido: el 2do click dispara su handler ANTES de que React
  // re-renderice el botón con disabled, así que confirmar() correría dos veces
  // → movimientos duplicados + stock sumado dos veces. El ref se setea en el
  // mismo tick y bloquea la 2da entrada.
  const enviandoRef = React.useRef(false);

  uE(() => {
    let cancelled = false;
    (async () => {
      try {
        const u = await window.__db.ubicaciones_obra.where('obra_id').equals(obraId)
          .filter(x => x.activo !== false && !x.deleted_at).toArray();
        if (!cancelled) setUbicaciones(u || []);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [obraId]);

  const upd = (idx, patch) => setRecep(arr => arr.map((it, i) => i === idx ? { ...it, ...patch } : it));

  // Opciones de match para el SearchableSelect, filtradas por el tipo elegido en
  // la fila (material/herramienta/epp). value = id del insumo del catálogo.
  const opcionesPorTipo = uM(() => {
    const o = { material: [], herramienta: [], epp: [], maquinaria: [], emergencia: [] };
    for (const c of (catalogoTodos || [])) (o[c.tipo] || o.material).push({ value: c.id, label: c.nombre });
    return o;
  }, [catalogoTodos]);

  // Sugerencias de insumo del catálogo más parecido a la descripción de la
  // factura (top 3 del mismo tipo, score ≥ 0.25), por fila. Se calcula UNA vez y
  // se memoiza por una firma estable (tipo+descripción+match de cada fila): así
  // NO se reescanea el catálogo (que puede ser de miles de insumos) en cada
  // tecla de observación/cantidad, que solo cambian otras props de `recep`.
  const sugSignature = recep.map(r => (r.match_id || r.modo === 'existente') ? '' : `${r.tipo}::${r.descripcion}`).join('');
  const sugerenciasPorIdx = uM(() => recep.map(it =>
    (it.match_id || it.modo === 'existente') ? [] :
      (catalogoTodos || [])
        .filter(c => c.tipo === it.tipo)
        .map(c => ({ ...c, score: simNombre(it.descripcion, c.nombre) }))
        .filter(x => x.score >= 0.25)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [sugSignature, catalogoTodos]);

  // Carga (lazy, cacheado) los movimientos de ingreso de un insumo que TODAVÍA
  // no están atados a una factura, ordenados por cercanía a la fecha de la
  // factura. Son los candidatos a vincular ("la mercadería ya entró").
  // Candidatos a vincular: ingresos sin factura del insumo ELEGIDO y también de
  // insumos con NOMBRE SIMILAR al de la factura (la almacenera suele registrar
  // "Yeso" y la factura dice "Yeso de 7 kilos" — el movimiento vive en OTRO
  // insumo del catálogo). Cada candidato lleva el NOMBRE de su insumo para que
  // ella pueda corroborar antes de vincular.
  const _normDescCand = (d) => String(d || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60);
  const cargarCandidatos = async (tipo, matchId, descripcion) => {
    const k = `${tipo}:${matchId}:${_normDescCand(descripcion)}`;
    if (!matchId || candCache[k] || candLoading[k]) return;
    setCandLoading(s => ({ ...s, [k]: true }));
    try {
      const cfg = CFG_TIPO[tipo] || CFG_TIPO.material;
      const facDate = factura.date || '';
      const nombreDe = (id) => {
        const rec = catalogoCompleto.get(id)?.record;
        return rec ? (rec[cfg.nombreCol] || rec.nombre || '—') : '—';
      };
      // Insumos "parecidos" del mismo tipo (por la descripción de la factura Y
      // por el nombre del insumo elegido), sin el propio match.
      const nombreMatch = nombreDe(matchId);
      const similares = (catalogoTodos || [])
        .filter(c => c.tipo === tipo && c.id !== matchId)
        .map(c => ({ ...c, score: Math.max(simNombre(descripcion || '', c.nombre), simNombre(nombreMatch, c.nombre)) }))
        .filter(c => c.score >= 0.3)
        .sort((a, b) => b.score - a.score)
        .slice(0, 6);
      const ids = [matchId, ...similares.map(s => s.id)];
      const rows = await window.__db[cfg.mov].where(cfg.fk).anyOf(ids).toArray();
      const cand = rows
        .filter(m => !m.deleted_at && m.obra_id === obraId && _esIngreso(m)
          && !String(m.documento_asociado || '').trim() && !m.accounting_movement_id)
        .map(m => ({
          id: m.id,
          insumoId: m[cfg.fk],
          insumoNombre: nombreDe(m[cfg.fk]),
          esMismoInsumo: m[cfg.fk] === matchId,
          fecha: m.fecha || (m.created_at || '').slice(0, 10),
          cantidad: Number(m.cantidad) || 0,
          unidad: m.unidad || (catalogoCompleto.get(m[cfg.fk])?.record?.unidad) || '',
          observaciones: m.observaciones || '',
          dist: diasEntre(m.fecha || (m.created_at || '').slice(0, 10), facDate),
        }))
        // primero los del insumo elegido, luego por cercanía de fecha
        .sort((a, b) => (b.esMismoInsumo - a.esMismoInsumo) || (a.dist - b.dist) || (b.fecha || '').localeCompare(a.fecha || ''))
        .slice(0, 15);
      setCandCache(s => ({ ...s, [k]: cand }));
    } catch {
      setCandCache(s => ({ ...s, [k]: [] }));
    } finally {
      setCandLoading(s => ({ ...s, [k]: false }));
    }
  };

  // Arma el registro de catálogo de un insumo nuevo (NO lo escribe). La creación
  // real se DIFIERE a la transacción de confirmar(): así un insumo "a crear" que
  // se descarta (cambio de match, reclasificar, cancelar) nunca queda huérfano en
  // el catálogo, y un doble-click no crea dos. El nombre y la unidad son
  // editables (la factura suele traer el nombre mal escrito o una unidad distinta).
  const construirBaseInsumo = (cfg, id, nombre, unidad, isPrueba, now) => {
    const base = {
      id, obra_id: obraId, [cfg.nombreCol]: nombre, unidad: unidad || 'und',
      stock_inicial: 0, stock_actual: 0, stock_minimo: 0, alerta: 'ok', estado: 'activo',
      created_by: userId, updated_by: userId, created_at: now, updated_at: now,
      version: 1, sync_status: isPrueba ? 'synced' : 'pending_create', last_synced_at: null,
      idempotency_key: `${userId}_${cfg.cat}_${id}`,
      ...(isPrueba ? { demo: true } : {}),
    };
    if (cfg.cat === 'herramientas') Object.assign(base, { tipo_herramienta: 'manual', estado_actual: 'nuevo', ubicacion_actual: 'almacen', disponible: true, maneja_cantidad: true });
    if (cfg.cat === 'epps') Object.assign(base, { tipo_epp: 'Otro' });
    // activos_pesados: estado tiene CHECK ('operativo'|'mantenimiento'|'reparacion'|'baja')
    // → 'operativo' (no 'activo'); y tipo tiene CHECK (…,'maquinaria','equipo','otro')
    // → 'equipo' (NO 'menor', que no existe en el CHECK y trababa el push 23514).
    // Lo manejamos por cantidad (maneja_cantidad).
    if (cfg.cat === 'activos_pesados') Object.assign(base, { estado: 'operativo', maneja_cantidad: true, tipo: 'equipo' });
    // insumos_emergencia: estado 'activo' (sin CHECK) ya queda del base.
    return base;
  };

  // Tablas que la recepción toca: el set fijo para la transacción atómica.
  const TX_TABLAS = ['movimientos_materiales', 'movimientos_herramientas', 'movimientos_epp', 'movimientos_maquinaria', 'movimientos_insumos_emergencia', 'materiales', 'herramientas', 'epps', 'activos_pesados', 'insumos_emergencia', 'accounting_movements', 'stock_ubicaciones', 'material_precios_historial', 'insumo_precios_historial'];

  const confirmar = async () => {
    const validos = recep.filter(r => !r.no_stock && r.verificado && (
      (r.modo === 'existente' && r.mov_existente_id) ||
      (r.modo !== 'existente' && (r.match_id || r.crear_nuevo) && Number(r.cantidad_recibida) > 0)
    ));
    if (validos.length === 0) { showToast?.('Marcá al menos 1 ítem verificado: vinculá a un insumo (cantidad > 0) o a un movimiento ya registrado', 'red'); return; }
    // Una fila verificada de stock tiene que apuntar a un insumo (match) o tener
    // un insumo a crear; si no, no sabríamos a qué sumarle el ingreso.
    const sinMatch = recep.filter(r => !r.no_stock && r.verificado && r.modo !== 'existente' && !r.match_id && !r.crear_nuevo);
    if (sinMatch.length > 0) { showToast?.(`Vinculá o creá el insumo para: ${sinMatch.map(r => r.descripcion).slice(0, 3).join(', ')}${sinMatch.length > 3 ? '…' : ''}`, 'red'); return; }
    // Candado SÍNCRONO contra doble-click ANTES de cualquier await (incluido el
    // re-read y el prompt de exceso): si ya estaba cerrado, es un 2do disparo.
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      // En modo prueba todo lo creado/actualizado es demo: 'synced' + demo:true
      // para que no se pushee a Supabase y lo vea el filtro de modo prueba.
      const isPrueba = getCurrentMode() === 'prueba';

      // Releemos la factura FRESCA de la BD. El modal pudo abrirse con `notas`
      // viejas: la lista del padre se refresca async tras una recepción, y si la
      // tarjeta se reabre antes de ese refresh, `factura.notas` (prop) tiene el
      // `recibido` previo. Sin esto, re-confirmar la misma recepción doblaría el
      // stock. Toda la reconciliación se basa en esta copia fresca, no en el prop.
      const facFresh = await window.__db.accounting_movements.get(factura.id);
      if (!facFresh || facFresh.deleted_at) {
        showToast?.('La factura ya no está disponible (se borró o sincronizó). Reabrí la lista de compras pendientes.', 'red');
        return;
      }
      const facturaNoSube = isPrueba || facFresh.demo === true;
      let notasObj = {};
      try { notasObj = JSON.parse(facFresh.notas || '{}'); } catch {}
      const itemsFresh = Array.isArray(notasObj.items_factura) ? notasObj.items_factura : items;
      const yaFreshDe = (idx) => Number(itemsFresh[idx]?.recibido) || 0;

      // Aviso (no bloqueo) si se recibe MÁS de lo que falta — calculado sobre la
      // BD FRESCA, no sobre el ya_recibido con que se montó el modal.
      const excedidos = validos.filter(r => {
        if (r.modo === 'existente') return false; // el vínculo refleja lo ya entrado
        const idx = recep.indexOf(r);
        const falta = Math.max(0, (Number(r.cantidad) || 0) - yaFreshDe(idx));
        return Number(r.cantidad_recibida) > falta + 0.0001;
      });
      let permitirExceso = false;
      if (excedidos.length > 0) {
        const detalle = excedidos.map(r => { const idx = recep.indexOf(r); const falta = Math.max(0, (Number(r.cantidad) || 0) - yaFreshDe(idx)); return `• ${r.descripcion}: recibís ${Number(r.cantidad_recibida).toLocaleString('es-PE')} y faltaba ${falta.toLocaleString('es-PE')}`; }).join('\n');
        const ok = window.confirm(`Estás recibiendo MÁS de lo facturado en ${excedidos.length} ítem(s):\n\n${detalle}\n\n¿Confirmás de todos modos?`);
        if (!ok) return;
        permitirExceso = true;
      }

      // Almacén de llegada OBLIGATORIO para insumos recién creados: si nace en
      // esta recepción, tiene que entrar a un almacén concreto (no "sin asignar",
      // que dejaría stock sin ubicación y rompería el desglose desde el día 1).
      const faltaAlmacen = validos.filter(r => r.modo === 'nuevo' && r.creado_aqui && !r.ubicacion_id);
      if (faltaAlmacen.length > 0) {
        showToast?.(`Asigná un almacén de llegada a los insumos nuevos: ${faltaAlmacen.map(r => r.descripcion).slice(0, 3).join(', ')}${faltaAlmacen.length > 3 ? '…' : ''}`, 'red');
        return;
      }

      // Reconciliamos por ÍNDICE de fila, no por descripción: una misma factura
      // puede traer dos renglones con idéntica `descripcion`. `recep` es 1:1 y en
      // orden con items_factura (ambos derivan del mismo JSON), así que es estable.
      const recibidoPorIdx = new Map(); // idx de fila → cantidad recibida ahora
      const creadoPorIdx = new Map();   // idx de fila → id del insumo creado en la tx
      const vinculadosIds = new Set();  // mov_existente_id ya estampados en este envío
      const factorPorIdx = new Map();   // idx → factor de conversión aplicado (unidades insumo por unidad factura)
      const noVinculados = [];          // vínculos que no se pudieron aplicar (mov borrado)
      // El desglose por almacén (stock_ubicaciones) se aplica DESPUÉS de la
      // transacción: aplicarDelta dispara un evento jx_data_changed que correría
      // el load() del padre (lee `proveedores`, fuera del scope de la tx) en
      // pleno commit. Lo encolamos y lo aplicamos best-effort al cerrar la tx.
      const desgloseQueue = [];
      const NO_STOCK = new Set(['servicio']);
      let creados = 0, vinculados = 0, primerMov = null, todoCompleto = false, preciosReg = 0;

      // Historial de precio unitario fundamentado en el comprobante: si el precio
      // de la factura difiere del estimado del insumo, deja una fila de historial
      // (material→material_precios_historial; herr/epp→insumo_precios_historial) y
      // actualiza el precio estimado. Lo hace el helper compartido; acá solo
      // contamos. forzarDemo si la factura es demo aunque el insumo no lo sea.
      const registrarPrecio = async ({ itemTipo, matchId, precio, movId }) => {
        const ok = await registrarCambioPrecio({
          itemTipo, itemId: matchId, obraId, precioNuevo: precio,
          fuente: 'movimiento', documentoRef: facFresh.document_number || null,
          origenMovId: movId, motivo: 'Recepción comprobante ' + (facFresh.document_number || ''),
          userId, isPrueba, forzarDemo: facFresh.demo === true, now,
        });
        if (ok) preciosReg++;
      };

      // TODO en una sola transacción Dexie: si algo falla a mitad, se revierte
      // todo (no quedan movimientos creados ni stock subido sin que la factura
      // avance) y un reintento no re-suma stock.
      await window.__db.transaction('rw', TX_TABLAS, async () => {
        for (const it of validos) {
          const idx = recep.indexOf(it);
          const cfg = CFG_TIPO[it.tipo] || CFG_TIPO.material;

          // ── Camino VINCULAR: la mercadería ya entró y existe el movimiento ──
          // Solo estampa la factura. NO crea movimiento ni toca stock (eso ya lo
          // hizo el ingreso original).
          if (it.modo === 'existente' && it.mov_existente_id) {
            if (vinculadosIds.has(it.mov_existente_id)) continue; // un ingreso → una sola estampa
            const mov = await window.__db[cfg.mov].get(it.mov_existente_id);
            if (!mov || mov.deleted_at) { noVinculados.push(it.descripcion || 'ítem'); continue; }
            // `recibido` del ítem se acumula en unidades de la FACTURA: si la
            // factura dice 2 bolsas y el movimiento se anotó como 14 kg, la
            // equivalencia (editable en la fila) manda — sin esto quedaba
            // "recibido 14 de 2" y los números no cuadraban.
            const cantMov = Number(mov.cantidad) || 0;
            const faltaVinc = Math.max(0, (Number(it.cantidad) || 0) - yaFreshDe(idx));
            const mismaUnidadVinc = String(it.unidad || '').trim().toLowerCase() === String(mov.unidad || it.equiv_mov?.unidad || '').trim().toLowerCase();
            // Base: lo tipeado en la equivalencia; si quedó vacío, con misma
            // unidad cae a la cantidad del movimiento y con unidad distinta a lo
            // que falta. SIEMPRE clampeado a lo que falta: un vínculo nunca
            // sobre-acredita el ítem (no hay prompt de exceso en este camino).
            const baseVinc = Number(it.equiv_factura_cant) > 0
              ? Number(it.equiv_factura_cant)
              : (mismaUnidadVinc ? (cantMov || Number(it.cantidad_recibida) || 0) : faltaVinc);
            const cantVinc = Math.min(baseVinc, faltaVinc);
            // Registro legible de la conversión en el movimiento (auditable).
            const unidadesDistintas = String(it.unidad || '').toLowerCase() !== String(mov.unidad || it.equiv_mov?.unidad || '').toLowerCase();
            const notaEquiv = (unidadesDistintas && cantMov > 0 && cantVinc > 0)
              ? `Equivalencia: ${cantVinc} ${it.unidad || 'und'} (factura) = ${cantMov} ${mov.unidad || it.equiv_mov?.unidad || ''}`
              : null;
            const obsLink = [mov.observaciones, it.obs_item, notaEquiv, 'Factura ' + (facFresh.document_number || '')].filter(Boolean).join(' · ');
            await window.__db[cfg.mov].update(it.mov_existente_id, {
              documento_asociado: facFresh.document_number || mov.documento_asociado || null,
              accounting_movement_id: facFresh.id,
              proveedor_id: mov.proveedor_id || facFresh.proveedor_id || null,
              observaciones: obsLink,
              updated_at: now, updated_by: userId,
              version: (mov.version || 0) + 1,
              // Demo-coherencia: si la factura NO se va a pushear (demo/prueba), el
              // movimiento tampoco debe subir su accounting_movement_id (sería un
              // puntero a una factura inexistente en el server).
              sync_status: (facturaNoSube || mov.demo === true) ? 'synced' : (mov.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'),
            });
            primerMov = primerMov || it.mov_existente_id;
            vinculados++;
            vinculadosIds.add(it.mov_existente_id);
            if (idx >= 0) recibidoPorIdx.set(idx, (recibidoPorIdx.get(idx) || 0) + cantVinc);
            // El comprobante ahora respalda el precio de ese ingreso.
            // Precio al historial en unidades del INSUMO: con equivalencia
            // (2 und = 14 kg a S/21 la bolsa) el precio por kg = 21×2/14 = S/3.
            // Sin datos confiables de conversión, se omite (mejor sin dato que
            // envenenar el historial con S/21 "por kg").
            const precioVinc = !unidadesDistintas
              ? it.precio_unitario
              : (cantMov > 0 && cantVinc > 0 ? +(((Number(it.precio_unitario) || 0) * cantVinc) / cantMov).toFixed(4) : null);
            if (precioVinc != null) await registrarPrecio({ itemTipo: it.tipo, matchId: it.match_id, precio: precioVinc, movId: it.mov_existente_id });
            continue;
          }

          // ── Camino NUEVO: crea movimiento + sube stock ──
          // Clamp a lo que realmente falta según la BD fresca (salvo exceso
          // confirmado): si el modal venía con estado stale y la línea ya estaba
          // recibida, cant=0 y no se dobla el stock.
          const falta = Math.max(0, (Number(it.cantidad) || 0) - yaFreshDe(idx));
          const pedido = Number(it.cantidad_recibida) || 0;
          const cant = permitirExceso ? pedido : Math.min(pedido, falta);
          if (cant <= 0) continue;

          // Creación DIFERIDA del insumo: si la fila pidió crear uno nuevo, se
          // crea acá DENTRO de la tx (atómico con el movimiento). Si se cancela la
          // recepción o se reabre, no queda ningún insumo huérfano en el catálogo.
          let matchId = it.match_id;
          if (!matchId && it.crear_nuevo) {
            const nom = String(it.crear_nuevo.nombre || it.descripcion || '').trim();
            if (!nom) continue; // sin nombre no se crea (el botón ya lo exige)
            const uni = String(it.crear_nuevo.unidad || it.unidad || 'und').trim() || 'und';
            matchId = window.__newId();
            await window.__db[cfg.cat].add(construirBaseInsumo(cfg, matchId, nom, uni, isPrueba, now));
            if (idx >= 0) creadoPorIdx.set(idx, matchId);
          }
          if (!matchId) continue;

          // CONVERSIÓN DE UNIDADES (factura en bolsas/und, insumo del catálogo en
          // kg): factor = cuántas unidades del INSUMO trae 1 unidad de la FACTURA
          // (ej. 7 kg por bolsa). El stock y el movimiento van en unidades del
          // insumo (cant × factor); `recibido` de la factura queda en unidades de
          // la factura (cant). factor 1 = sin conversión (comportamiento de siempre).
          // El factor SOLO aplica si las unidades realmente difieren AHORA
          // (para insumos creados en esta recepción, la unidad es la del form).
          // Un factor tipeado para un match anterior y ya no visible en la UI
          // no debe multiplicar el stock en silencio.
          const unidadInsumo = (it.crear_nuevo ? it.crear_nuevo.unidad : catalogoCompleto.get(matchId)?.record?.unidad) || null;
          const unidadesDifierenAhora = !!unidadInsumo && String(unidadInsumo).trim().toLowerCase() !== String(it.unidad || 'und').trim().toLowerCase();
          const factor = (unidadesDifierenAhora && Number(it.factor_conv) > 0) ? Number(it.factor_conv) : 1;
          const cantStock = +(cant * factor).toFixed(4);
          // Precio por unidad del INSUMO (S/21 la bolsa de 7 kg → S/3 el kg).
          const precioUnitInsumo = factor !== 1 ? +((Number(it.precio_unitario) || 0) / factor).toFixed(4) : (Number(it.precio_unitario) || 0);
          const notaConv = factor !== 1
            ? `Equivalencia: ${cant} ${it.unidad || 'und'} (factura) × ${factor} = ${cantStock} ${unidadInsumo || ''}`
            : null;
          const movId = window.__newId();
          const obs = ['Recepción factura ' + facFresh.document_number, obsGlobal, it.obs_item, notaConv].filter(Boolean).join(' · ');
          const baseMov = {
            id: movId, obra_id: obraId, fecha: (fechaMov || now.slice(0, 10)), hora: now.slice(11, 16),
            cantidad: cantStock, unidad: (factor !== 1 ? (unidadInsumo || it.unidad) : it.unidad) || 'und', observaciones: obs,
            proveedor_id: facFresh.proveedor_id || null, documento_asociado: facFresh.document_number || null,
            accounting_movement_id: facFresh.id || null,
            ubicacion_id: it.ubicacion_id || null,
            created_by: userId, updated_by: userId, created_at: now, updated_at: now,
            version: 1, sync_status: isPrueba ? 'synced' : 'pending_create', idempotency_key: `${userId}_${cfg.idkey}_${movId}`,
            ...(isPrueba ? { demo: true } : {}),
          };
          if (cfg.cat === 'herramientas') Object.assign(baseMov, { herramienta_id: matchId, accion: 'entrada', tipo_movimiento: 'ingreso', estado_devolucion: 'nuevo' });
          else if (cfg.cat === 'epps') Object.assign(baseMov, { epp_id: matchId, tipo_movimiento: 'entrada', precio_unitario_real: precioUnitInsumo });
          // movimientos_maquinaria / movimientos_insumos_emergencia: tipo 'entrada',
          // sin precio_unitario_real ni partida_id (esas columnas no existen ahí).
          else if (cfg.cat === 'activos_pesados') Object.assign(baseMov, { activo_id: matchId, tipo_movimiento: 'entrada' });
          else if (cfg.cat === 'insumos_emergencia') Object.assign(baseMov, { insumo_emergencia_id: matchId, tipo_movimiento: 'entrada' });
          else Object.assign(baseMov, { material_id: matchId, tipo_movimiento: 'entrada', precio_unitario_real: precioUnitInsumo, partida_id: null });
          await window.__db[cfg.mov].add(baseMov);
          primerMov = primerMov || movId;

          // SUBIR stock_actual del insumo (sin catch silencioso: si falla, la
          // transacción revierte el movimiento también).
          const rec = await window.__db[cfg.cat].get(matchId);
          if (rec) {
            const nuevoStock = Math.max(0, (Number(rec.stock_actual) || 0) + cantStock);
            const patch = { stock_actual: nuevoStock, alerta: calcAlerta(nuevoStock, Number(rec.stock_minimo || 0)), updated_at: now, updated_by: userId, version: (rec.version || 0) + 1, sync_status: (isPrueba || rec.demo === true) ? 'synced' : (rec.sync_status === 'pending_create' ? 'pending_create' : 'pending_update') };
            if (cfg.cat === 'materiales' && it.ubicacion_id && !rec.ubicacion_id) patch.ubicacion_id = it.ubicacion_id;
            await window.__db[cfg.cat].update(matchId, patch);
          }
          // Desglose por almacén: se encola y se aplica al cerrar la tx.
          if (it.ubicacion_id) {
            desgloseQueue.push({ obraId, itemTipo: cfg.itemTipo, itemId: matchId, ubicacionId: it.ubicacion_id, delta: cantStock, userId });
          }
          // Historial de precio fundamentado en el comprobante. Con conversión,
          // el precio por unidad del INSUMO = precio de factura ÷ factor
          // (S/21 la bolsa de 7 kg → S/3 el kg).
          await registrarPrecio({ itemTipo: it.tipo, matchId, precio: precioUnitInsumo, movId });
          creados++;
          if (idx >= 0) recibidoPorIdx.set(idx, (recibidoPorIdx.get(idx) || 0) + cant);
          // Persistir el factor en el ítem: la Conciliación necesita volver la
          // entrada (en unidades del insumo) a unidades de factura.
          if (idx >= 0 && factor !== 1) factorPorIdx.set(idx, factor);
        }

        // items_factura con lo recibido acumulado (base FRESCA) + match elegido.
        const itemsActualizados = itemsFresh.map((orig, idx) => {
          const fila = recep[idx];
          const sumNow = recibidoPorIdx.get(idx) || 0;
          const recibido = (Number(orig.recibido) || 0) + sumNow;
          // Solo persistimos un cambio de tipo (reclasificación de gasto→insumo,
          // o el tipo corregido) si la fila REALMENTE se procesó (se recibió o
          // vinculó algo). Una reclasificación abandonada NO debe mutar el tipo:
          // si no, una línea de servicio sin recibir quedaría como 'material' con
          // recibido<cantidad y dejaría la factura 'parcial' para siempre.
          const procesada = recibidoPorIdx.has(idx) || (fila?.modo === 'existente' && fila?.mov_existente_id);
          const tipoFinal = (fila && !fila.no_stock && procesada) ? (fila.tipo || orig.tipo_insumo)
            : (NO_STOCK.has(orig.tipo_insumo) ? orig.tipo_insumo : (fila?.tipo || orig.tipo_insumo));
          // material_id: el insumo recién creado en la tx, o el match elegido, o el original.
          const matId = creadoPorIdx.get(idx) || fila?.match_id || orig.material_id;
          const linkExtra = (fila?.modo === 'existente' && fila?.mov_existente_id)
            ? { recepcion_modo: 'vinculado', mov_vinculado_id: fila.mov_existente_id }
            : {};
          return { ...orig, recibido, material_id: matId, tipo_insumo: tipoFinal, ...(factorPorIdx.has(idx) ? { factor_conv: factorPorIdx.get(idx) } : {}), ...linkExtra };
        });
        todoCompleto = itemsActualizados.every(it =>
          it.rechazado ||                                // negado por el almacén: no ingresa, no bloquea el cierre
          NO_STOCK.has(it.tipo_insumo) ||
          (it.destino || 'obra') === 'empresa' ||        // consumo de empresa: no se recibe en obra, no bloquea el cierre
          (it.destino || 'obra') === 'obra_general' ||   // gasto general de obra (comida, etc.): tampoco bloquea
          (Number(it.recibido) || 0) >= (Number(it.cantidad) || 0) - 0.0001);
        notasObj.items_factura = itemsActualizados;

        await window.__db.accounting_movements.update(facFresh.id, {
          notas: JSON.stringify(notasObj),
          recepcion_status: todoCompleto ? 'recibido' : 'parcial',
          recepcion_movimiento_id: primerMov || facFresh.recepcion_movimiento_id || null,
          recepcion_fecha: now, recepcion_por: userId,
          updated_at: now, updated_by: userId,
          version: (facFresh.version || 0) + 1,
          sync_status: facturaNoSube ? 'synced' : (facFresh.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'),
        });
      });

      // Desglose por almacén (best-effort, fuera de la tx; el total ya quedó
      // consistente en stock_actual aunque esto falle).
      for (const d of desgloseQueue) { try { await aplicarDelta(d); } catch (e) { console.warn('[recepcion] desglose', e?.message || e); } }

      try { await window.__logAudit?.({ action: 'update', table: 'accounting_movements', recordId: factura.id, reason: `Recepción ${todoCompleto ? 'completa' : 'PARCIAL'} — ${creados} ingreso(s) nuevo(s), ${vinculados} vinculado(s) · factura ${factura.document_number}` }); } catch {}
      TX_TABLAS.forEach(t => { try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: t } })); } catch {} });

      const avisoLink = noVinculados.length ? ` · ⚠ ${noVinculados.length} vínculo(s) no se aplicaron (el movimiento ya no existe): esas líneas siguen pendientes` : '';
      if (creados === 0 && vinculados === 0) {
        showToast?.(noVinculados.length
          ? `No se aplicó ningún vínculo: ${noVinculados.slice(0, 3).join(', ')} ya no existe(n). Reabrí la lista.`
          : 'No había nada nuevo para recibir (las líneas ya estaban recibidas).', noVinculados.length ? 'red' : 'amber');
      } else {
        const resumen = [creados ? `${creados} ingreso(s) nuevo(s)` : '', vinculados ? `${vinculados} vinculado(s) a movimientos ya registrados` : '', preciosReg ? `${preciosReg} precio(s) actualizado(s)` : ''].filter(Boolean).join(' · ');
        showToast?.(`✓ ${resumen}${todoCompleto ? '' : ' · queda PARCIAL (falta recibir el resto)'}${avisoLink}`, noVinculados.length ? 'amber' : 'green');
      }
      onClose();
    } catch (e) {
      showToast?.('Error al registrar recepción: ' + (e?.message || e), 'red');
      console.error('[registrar-recepcion]', e);
    } finally { enviandoRef.current = false; setBusy(false); }
  };

  const provName = factura.proveedor_id ? (provsById.get(factura.proveedor_id)?.razon_social || factura.third_party_name) : factura.third_party_name;
  const TIPOS = [['material', 'Material'], ['herramienta', 'Herramienta'], ['epp', 'EPP'], ['maquinaria', 'Maquinaria'], ['emergencia', 'Emergencia']];

  return (
    <Modal title={`Registrar recepción · ${factura.document_number}`} icon="arrowIn" onClose={onClose} size="xl">
      <div style={{ marginBottom: 12, padding: '10px 12px', background: 'rgba(52,152,219,0.08)', border: '1px solid rgba(52,152,219,0.25)', borderRadius: 6, fontSize: 12 }}>
        <strong>{provName || '—'}</strong> · factura del {factura.date}<br/>
        <span style={{ color: 'var(--tm)', fontSize: 11 }}>
          Vinculá cada ítem al insumo del catálogo (aunque el nombre difiera) y elegí cómo registrar el ingreso: <strong>🆕 "Recién lo estoy recibiendo"</strong> crea el ingreso y sube stock; <strong>🔗 "Ya había entrado antes"</strong> lo ata a un ingreso ya registrado sin volver a sumar stock. Recepción parcial: registrá lo que llegó y la factura queda <strong>parcial</strong> hasta recibir el resto. Si un ítem <strong>no debía llegar al almacén</strong> (ej. la contadora olvidó desmarcarlo), cerrá este modal y usá <strong>"Negar recepción"</strong> en la tarjeta.
        </span>
      </div>

      <div style={{ overflow: 'auto', maxHeight: 420, border: '1px solid var(--border)', borderRadius: 6, marginBottom: 12 }}>
        <table className="tbl" style={{ fontSize: 12 }}>
          <thead><tr>
            <th style={{ width: 34, textAlign: 'center' }}>✓</th>
            <th style={{ minWidth: 220 }}>Factura · vincular a insumo</th>
            <th style={{ width: 110 }}>Tipo</th>
            <th style={{ width: 90, textAlign: 'right' }}>Falta</th>
            <th style={{ width: 100, textAlign: 'right' }}>Recibo *</th>
            <th style={{ minWidth: 150 }}>Almacén</th>
            <th style={{ minWidth: 130 }}>Observación</th>
          </tr></thead>
          <tbody>
            {recep.map((it, i) => {
              const cfgCat = (CFG_TIPO[it.tipo] || CFG_TIPO.material).cat;
              const opciones = [{ value: '', label: '— Vincular a ' + (TIPOS.find(t => t[0] === it.tipo)?.[1] || '') + ' —' }, ...(opcionesPorTipo[it.tipo] || [])];
              // Servicio / maquinaria: no entran al almacén. Fila informativa (N/A)
              // y bloqueada — sin checkbox, sin vincular/crear, sin Tipo editable ni
              // cantidad. Así no puede forzarse a 'material' (insumo fantasma).
              if (it.no_stock) {
                const etiqueta = it.tipo_insumo === 'maquinaria' ? 'Maquinaria (activos pesados)' : 'Servicio / gasto';
                return (
                  <tr key={i} style={{ opacity: 0.55 }}>
                    <td style={{ textAlign: 'center' }}>
                      <span className="badge b-purple" style={{ fontSize: 9 }}>N/A</span>
                    </td>
                    <td>
                      <div style={{ fontSize: 12, color: 'var(--ts)', marginBottom: 3 }}>{it.descripcion}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--tm)', fontStyle: 'italic' }}>
                        No va a inventario — se registró solo como costo en contabilidad.
                      </div>
                      {/* La IA pudo equivocarse (ej. combustible marcado como gasto):
                          reclasificar a insumo de stock para recibirlo/vincularlo. */}
                      <button className="btn btn-ghost btn-xs" style={{ marginTop: 4 }}
                        onClick={() => { const resta = Math.max(0, (Number(it.cantidad) || 0) - (Number(it.ya_recibido) || 0)); upd(i, { no_stock: false, tipo: 'material', match_id: null, creado_aqui: false, modo: 'nuevo', mov_existente_id: null, cantidad_recibida: resta, verificado: false }); }}>
                        <JxIcon name="arrowIn" size={10} /> Es un insumo, no un gasto — recibirlo
                      </button>
                    </td>
                    <td>
                      <span className={`badge ${TIPO_INSUMO_BADGE[it.tipo_insumo] || 'b-purple'}`} style={{ fontSize: 9 }}>{etiqueta}</span>
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--tm)' }}>—</td>
                    <td style={{ textAlign: 'right', color: 'var(--tm)' }}>—</td>
                    <td style={{ color: 'var(--tm)' }}>—</td>
                    <td style={{ color: 'var(--tm)' }}>—</td>
                  </tr>
                );
              }
              // Ítem NEGADO por el almacén: fila informativa bloqueada (no se recibe).
              // Para reactivarlo, se reabre desde la lista de compras pendientes.
              if (it.negado) {
                return (
                  <tr key={i} style={{ opacity: 0.5 }}>
                    <td style={{ textAlign: 'center' }}><span className="badge b-red" style={{ fontSize: 9 }}>🚫</span></td>
                    <td>
                      <div style={{ fontSize: 12, color: 'var(--ts)', textDecoration: 'line-through' }}>{it.descripcion}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--tm)', fontStyle: 'italic' }}>Negado — no ingresó{it.rechazo_motivo ? ` · ${it.rechazo_motivo}` : ''}. Reabrilo desde la lista si fue un error.</div>
                    </td>
                    <td style={{ color: 'var(--tm)' }}>—</td>
                    <td style={{ textAlign: 'right', color: 'var(--tm)' }}>—</td>
                    <td style={{ textAlign: 'right', color: 'var(--tm)' }}>—</td>
                    <td style={{ color: 'var(--tm)' }}>—</td>
                    <td style={{ color: 'var(--tm)' }}>—</td>
                  </tr>
                );
              }
              return (
                <tr key={i} style={{ opacity: it.verificado ? 1 : 0.55 }}>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={it.verificado} onChange={e => upd(i, { verificado: e.target.checked })} />
                  </td>
                  <td>
                    <div style={{ fontSize: 12, color: 'var(--ts)', marginBottom: 3 }}>{it.descripcion}{it.es_empresa && <span className="badge b-gray" style={{ marginLeft: 6, fontSize: 9 }} title={it.destino === 'obra_general' ? 'Gasto general de la obra (ej. comida) — por defecto no se recibe en el almacén' : 'Consumo general de la empresa (oficina) — por defecto no se recibe en la obra'}>{it.destino === 'obra_general' ? '🍽 gasto obra' : '🏢 empresa'}</span>}</div>
                    {it.modo === 'existente' ? (
                      // Ya resuelta vinculando un movimiento de ingreso existente.
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span className="badge b-green" style={{ fontSize: 9.5 }}>
                            <JxIcon name="check" size={9} /> Vinculado: {it.equiv_mov?.insumoNombre || 'ingreso ya registrado'}
                          </span>
                          <button className="btn btn-ghost btn-xs" onClick={() => {
                            const resta = Math.max(0, (Number(it.cantidad) || 0) - (Number(it.ya_recibido) || 0));
                            // Restaurar el match ORIGINAL (el candidato similar pudo haberlo
                            // pisado) y forzar re-verificación manual.
                            const matchRestaurado = it.match_id_prev !== undefined ? it.match_id_prev : it.match_id;
                            upd(i, { modo: 'nuevo', mov_existente_id: null, cantidad_recibida: resta, match_id: matchRestaurado, match_id_prev: undefined, verificado: false, equiv_mov: null, equiv_factura_cant: null });
                          }}>
                            Deshacer
                          </button>
                        </div>
                        {/* EQUIVALENCIA de unidades: la factura vino en bolsas/und y el
                            movimiento se anotó en kg (u otra unidad). Ella indica cuántas
                            unidades de la FACTURA cubre ese movimiento y queda el registro
                            "2 und = 14 kg (7 kg por und)". */}
                        {it.equiv_mov && (
                          <div style={{ marginTop: 4, padding: '5px 7px', background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 5, fontSize: 10.5, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ color: 'var(--tm)' }}>Equivale a</span>
                            <input className="fi" type="number" min="0" step="0.01" value={it.equiv_factura_cant ?? ''}
                              onChange={e => upd(i, { equiv_factura_cant: e.target.value })}
                              style={{ width: 64, fontSize: 11, padding: '3px 5px', textAlign: 'right' }} />
                            <span style={{ color: 'var(--ts)' }}>{it.unidad || 'und'} de la factura = <strong>{Number(it.equiv_mov.cantidad).toLocaleString('es-PE')} {it.equiv_mov.unidad}</strong> del movimiento</span>
                            {Number(it.equiv_factura_cant) > 0 && Number(it.equiv_mov.cantidad) > 0 && String(it.unidad || '').toLowerCase() !== String(it.equiv_mov.unidad || '').toLowerCase() && (
                              <span style={{ color: 'var(--green)' }}>({(Number(it.equiv_mov.cantidad) / Number(it.equiv_factura_cant)).toLocaleString('es-PE', { maximumFractionDigits: 2 })} {it.equiv_mov.unidad} por {it.unidad || 'und'})</span>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        {/* Fila reclasificada desde servicio/gasto: dejar volver atrás. */}
                        {NO_STOCK.has(it.tipo_insumo) && (
                          <div style={{ marginBottom: 3 }}>
                            <span className="badge b-amber" style={{ fontSize: 9 }}>Reclasificado de gasto a insumo</span>
                            <button className="btn btn-ghost btn-xs" style={{ marginLeft: 6 }}
                              onClick={() => upd(i, { no_stock: true, match_id: null, crear_nuevo: null, creado_aqui: false, modo: 'nuevo', mov_existente_id: null, verificado: false })}>
                              Volver a gasto
                            </button>
                          </div>
                        )}
                        {/* Insumo a crear (creación diferida): chip editable, sin escribir aún. */}
                        {!it.match_id && it.crear_nuevo && crearForm?.idx !== i ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span className="badge b-green" style={{ fontSize: 9.5 }}>
                              <JxIcon name="plus" size={9} /> Se creará: {it.crear_nuevo.nombre} · {it.crear_nuevo.unidad}
                            </span>
                            <button className="btn btn-ghost btn-xs" onClick={() => setCrearForm({ idx: i, nombre: it.crear_nuevo.nombre, unidad: it.crear_nuevo.unidad })}>Editar</button>
                            <button className="btn btn-ghost btn-xs" onClick={() => upd(i, { crear_nuevo: null, creado_aqui: false, verificado: false })}>Quitar</button>
                          </div>
                        ) : (
                          <SearchableSelect value={it.match_id || ''} onChange={v => { if (candOpen === i) setCandOpen(null); upd(i, { match_id: v || null, crear_nuevo: null, creado_aqui: false, factor_conv: null, verificado: !!v && Number(it.cantidad_recibida) > 0 }); }}
                            options={opciones} fontSize={11} placeholder="— Buscar insumo del catálogo —" />
                        )}
                        {/* Sugerencias de insumo parecido (los nombres rara vez coinciden) */}
                        {!it.match_id && !it.crear_nuevo && crearForm?.idx !== i && (sugerenciasPorIdx[i] || []).length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4, alignItems: 'center' }}>
                            <span style={{ fontSize: 9.5, color: 'var(--tm)' }}>¿Es alguno?</span>
                            {(sugerenciasPorIdx[i] || []).map(s => (
                              <button key={s.id} className="badge b-blue" style={{ cursor: 'pointer', fontSize: 9.5, border: 'none' }}
                                title="Vincular a este insumo del catálogo"
                                onClick={() => upd(i, { match_id: s.id, crear_nuevo: null, creado_aqui: false, factor_conv: null, verificado: Number(it.cantidad_recibida) > 0 })}>
                                {s.nombre}
                              </button>
                            ))}
                          </div>
                        )}
                        {/* Crear insumo nuevo con nombre y unidad EDITABLES */}
                        {!it.match_id && !it.crear_nuevo && crearForm?.idx !== i && (
                          <button className="btn btn-ghost btn-xs" style={{ marginTop: 3 }}
                            onClick={() => setCrearForm({ idx: i, nombre: it.descripcion || '', unidad: it.unidad || 'und' })}>
                            <JxIcon name="plus" size={10} /> Crear nuevo insumo ({TIPOS.find(t => t[0] === it.tipo)?.[1]})
                          </button>
                        )}
                        {!it.match_id && crearForm?.idx === i && (
                          <div style={{ marginTop: 4, padding: 6, background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 5, display: 'grid', gap: 4 }}>
                            <span style={{ fontSize: 9.5, color: 'var(--tm)' }}>Nuevo {TIPOS.find(t => t[0] === it.tipo)?.[1]} — corregí nombre y unidad si hace falta:</span>
                            <input className="fi" value={crearForm.nombre} autoFocus placeholder="Nombre del insumo"
                              onChange={e => setCrearForm(f => ({ ...f, nombre: e.target.value }))} style={{ fontSize: 11, padding: '5px 6px' }} />
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <input className="fi" value={crearForm.unidad} placeholder="und" title="Unidad"
                                onChange={e => setCrearForm(f => ({ ...f, unidad: e.target.value }))} style={{ fontSize: 11, padding: '5px 6px', width: 90 }} />
                              <button className="btn btn-amber btn-xs" disabled={!String(crearForm.nombre || '').trim()}
                                onClick={() => { const nombre = String(crearForm.nombre || '').trim(); const unidad = String(crearForm.unidad || 'und').trim() || 'und'; upd(i, { crear_nuevo: { nombre, unidad }, unidad, creado_aqui: true, match_id: null, factor_conv: null, verificado: Number(it.cantidad_recibida) > 0 }); setCrearForm(null); }}>
                                <JxIcon name="check" size={10} /> Usar este insumo nuevo
                              </button>
                              <button className="btn btn-ghost btn-xs" onClick={() => setCrearForm(null)}>Cancelar</button>
                            </div>
                          </div>
                        )}
                        {/* Elección EXPLÍCITA: crear un ingreso nuevo (sube stock) vs
                            vincular a un ingreso ya registrado (no suma stock). Antes
                            era un botón escondido y no se entendía la diferencia. */}
                        {it.match_id && (
                          <div style={{ marginTop: 6, padding: '7px 9px', background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 5 }}>
                            <div style={{ fontSize: 9.5, color: 'var(--tm)', marginBottom: 5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>¿Cómo registrar este ingreso?</div>
                            <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 10.5, cursor: 'pointer', marginBottom: 5 }}>
                              <input type="radio" name={`modo-${i}`} checked={candOpen !== i} onChange={() => { setCandOpen(null); upd(i, { verificado: !!it.match_id && Number(it.cantidad_recibida) > 0 }); }} style={{ marginTop: 2, flexShrink: 0 }} />
                              <span><strong style={{ color: 'var(--ts)' }}>🆕 Recién lo estoy recibiendo</strong><br /><span style={{ color: 'var(--tm)' }}>Crea el ingreso y <strong>sube el stock</strong> del almacén.</span></span>
                            </label>
                            {/* Al elegir "ya había entrado" desmarcamos la fila hasta que se
                                elija un movimiento concreto: si no, quedaba verificada en modo
                                'nuevo' y al confirmar creaba un ingreso (doble stock). */}
                            <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 10.5, cursor: 'pointer' }}>
                              <input type="radio" name={`modo-${i}`} checked={candOpen === i} onChange={() => { setCandOpen(i); cargarCandidatos(it.tipo, it.match_id, it.descripcion); upd(i, { verificado: false }); }} style={{ marginTop: 2, flexShrink: 0 }} />
                              <span><strong style={{ color: 'var(--ts)' }}>🔗 Ya había entrado antes</strong><br /><span style={{ color: 'var(--tm)' }}>La mercadería ya se registró: <strong>elegí el ingreso</strong> abajo para vincular (no vuelve a sumar stock).</span></span>
                            </label>
                          </div>
                        )}
                        {candOpen === i && it.match_id && (() => {
                          const k = `${it.tipo}:${it.match_id}:${_normDescCand(it.descripcion)}`;
                          // Excluimos los movimientos ya elegidos por OTRA fila de
                          // esta misma factura (no vincular el mismo ingreso dos veces).
                          const usadosOtras = new Set(recep.filter((r, j) => j !== i && r.modo === 'existente' && r.mov_existente_id).map(r => r.mov_existente_id));
                          const lista = (candCache[k] || []).filter(c => !usadosOtras.has(c.id));
                          return (
                            <div style={{ marginTop: 4, padding: 6, background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 5 }}>
                              {candLoading[k] ? (
                                <span style={{ fontSize: 10.5, color: 'var(--tm)' }}>Buscando movimientos…</span>
                              ) : lista.length === 0 ? (
                                <span style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                                  No hay ingresos sin factura para este insumo. Volvé a <strong>"🆕 Recién lo estoy recibiendo"</strong> para registrarlo.
                                </span>
                              ) : (
                                <div style={{ display: 'grid', gap: 3 }}>
                                  <span style={{ fontSize: 9.5, color: 'var(--tm)' }}>Ingresos sin factura (cercanos a la fecha) — el nombre es el del insumo del movimiento:</span>
                                  {lista.map(c => (
                                    <button key={c.id} className="btn btn-ghost btn-xs" style={{ justifyContent: 'flex-start', textAlign: 'left', whiteSpace: 'normal', height: 'auto' }}
                                      title={c.esMismoInsumo ? undefined : 'Movimiento de OTRO insumo del catálogo con nombre parecido — al elegirlo, el ítem queda vinculado a ese insumo'}
                                      onClick={() => {
                                        const resta = Math.max(0, (Number(it.cantidad) || 0) - (Number(it.ya_recibido) || 0));
                                        // Default de "cuántas unidades de la FACTURA cubre":
                                        // mismas unidades → la cantidad del movimiento (clampeada a
                                        // lo que falta: un mov parcial de 14 sobre factura de 20 NO
                                        // debe cerrar los 20); unidades distintas → lo que falta
                                        // (no se puede inferir la conversión; editable en la fila).
                                        const mismaUnidad = String(it.unidad || '').trim().toLowerCase() === String(c.unidad || '').trim().toLowerCase();
                                        const defEquiv = mismaUnidad ? Math.min(Number(c.cantidad) || 0, resta) : resta;
                                        // Si el movimiento es de OTRO insumo (nombre similar), el ítem
                                        // queda vinculado a ESE insumo (precio e historial al correcto);
                                        // guardamos el match previo para que "Deshacer" lo restaure.
                                        upd(i, {
                                          modo: 'existente', mov_existente_id: c.id,
                                          match_id: c.insumoId,
                                          match_id_prev: it.match_id,
                                          cantidad_recibida: c.cantidad, verificado: true,
                                          equiv_mov: { cantidad: c.cantidad, unidad: c.unidad, insumoNombre: c.insumoNombre },
                                          equiv_factura_cant: defEquiv,
                                        });
                                        setCandOpen(null);
                                      }}>
                                      <span style={{ fontWeight: 600, color: 'var(--ts)' }}>{c.insumoNombre}</span>
                                      {!c.esMismoInsumo && <span className="badge b-blue" style={{ fontSize: 8.5, marginLeft: 5 }}>≈ similar</span>}
                                      <span style={{ display: 'block', fontSize: 10 }}>
                                        {c.fecha || 's/f'} · {Number(c.cantidad).toLocaleString('es-PE')} {c.unidad}
                                        {isFinite(c.dist) && c.dist <= 3 ? ' · mismo período' : ''}
                                      </span>
                                      {c.observaciones ? <span style={{ display: 'block', fontSize: 9, color: 'var(--tm)' }}>{String(c.observaciones).slice(0, 60)}</span> : null}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </>
                    )}
                  </td>
                  <td>
                    <select className="fi" value={it.tipo} style={{ fontSize: 11, padding: '5px 6px' }}
                      disabled={it.modo === 'existente'}
                      title={it.modo === 'existente' ? 'El tipo lo define el movimiento vinculado' : undefined}
                      onChange={e => { const nt = e.target.value; const keep = it.match_id && tipoDeId(it.match_id) === nt; upd(i, { tipo: nt, match_id: keep ? it.match_id : null, factor_conv: keep ? it.factor_conv : null, verificado: keep ? it.verificado : false }); }}>
                      {TIPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--tm)' }}>
                    {Number(Math.max(0, (Number(it.cantidad) || 0) - (it.ya_recibido || 0))).toLocaleString('es-PE')}
                    {it.ya_recibido > 0 && <div style={{ fontSize: 9, color: 'var(--green)' }}>de {Number(it.cantidad).toLocaleString('es-PE')}</div>}
                  </td>
                  <td>
                    {it.modo === 'existente' ? (
                      <div style={{ textAlign: 'right', fontWeight: 600, color: 'var(--green)' }}
                        title="Lo que se acredita a la FACTURA con este vínculo (en unidades de la factura; editable en el cuadro de equivalencia). No se vuelve a sumar stock.">
                        {Number(it.equiv_factura_cant ?? it.cantidad_recibida).toLocaleString('es-PE')} {it.unidad || ''}
                      </div>
                    ) : (() => {
                      // Conversión: la factura viene en una unidad (bolsa/und) y el
                      // insumo del catálogo en otra (kg) → factor editable: el stock
                      // sube convertido y la factura cierra en sus propias unidades.
                      const uniIns = it.match_id ? (catalogoCompleto.get(it.match_id)?.record?.unidad || '') : '';
                      const uniFac = it.unidad || 'und';
                      const distinta = !!uniIns && String(uniIns).trim().toLowerCase() !== String(uniFac).trim().toLowerCase();
                      const f = Number(it.factor_conv) > 0 ? Number(it.factor_conv) : null;
                      return (
                        <div>
                          <input className="fi" type="number" min="0" step="0.01" value={it.cantidad_recibida} disabled={!it.verificado}
                            title="Por defecto, lo que falta (en unidades de la FACTURA). Si recibís más de lo facturado se te pedirá confirmar."
                            onChange={e => upd(i, { cantidad_recibida: e.target.value })} style={{ fontSize: 12, textAlign: 'right' }} />
                          {distinta && it.verificado && (
                            <div style={{ marginTop: 3, fontSize: 9.5, color: 'var(--tm)', textAlign: 'right' }}
                              title={`La factura está en ${uniFac} y el insumo del catálogo en ${uniIns}: indicá cuántos ${uniIns} trae cada ${uniFac} (ej. 7 kg por bolsa) y el stock sube convertido.`}>
                              × <input className="fi" type="number" min="0" step="0.01" value={it.factor_conv ?? ''} placeholder="factor"
                                onChange={e => upd(i, { factor_conv: e.target.value })}
                                style={{ width: 56, fontSize: 10.5, padding: '2px 4px', textAlign: 'right', display: 'inline-block' }} /> {uniIns}/{uniFac}
                              {f && Number(it.cantidad_recibida) > 0 && (
                                <div style={{ color: 'var(--green)' }}>→ al stock: {(Number(it.cantidad_recibida) * f).toLocaleString('es-PE', { maximumFractionDigits: 2 })} {uniIns}</div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td>
                    {it.modo === 'existente' ? (
                      <span style={{ color: 'var(--tm)', fontSize: 11 }}>ya asignado en el ingreso</span>
                    ) : (() => {
                      // Para insumos recién creados el almacén es OBLIGATORIO: lo marcamos.
                      const obligatorio = it.creado_aqui && !it.ubicacion_id;
                      return (
                        <select className="fi" value={it.ubicacion_id || ''} onChange={e => upd(i, { ubicacion_id: e.target.value || null })}
                          style={{ fontSize: 11, padding: '5px 6px', ...(obligatorio ? { borderColor: 'var(--red)' } : {}) }}>
                          <option value="">{it.creado_aqui ? '— Elegí almacén (obligatorio) —' : '— Sin asignar —'}</option>
                          {ubicaciones.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                        </select>
                      );
                    })()}
                  </td>
                  <td>
                    <input className="fi" value={it.obs_item} onChange={e => upd(i, { obs_item: e.target.value })} placeholder="faltó / dañado…" style={{ fontSize: 11, padding: '5px 6px' }} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginBottom: 12, display: 'grid', gridTemplateColumns: '180px 1fr', gap: 10 }}>
        <div>
          <label className="flabel">Fecha del ingreso</label>
          <input className="fi" type="date" value={fechaMov} max={new Date().toISOString().slice(0, 10)}
            title="Fecha del movimiento de ingreso al almacén. Cambiala si la mercadería llegó otro día (no hoy)."
            onChange={e => setFechaMov(e.target.value || new Date().toISOString().slice(0, 10))} />
        </div>
        <div>
          <label className="flabel">Observación general de la recepción</label>
          <input className="fi" value={obsGlobal} onChange={e => setObsGlobal(e.target.value)} placeholder="Ej: llegó parcial, el resto lo recibe el almacén Central…" />
        </div>
      </div>

      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn btn-amber" onClick={confirmar} disabled={busy}>
          <JxIcon name="check" size={13} />{busy ? 'Procesando…' : 'Confirmar recepción'}
        </button>
      </div>
    </Modal>
  );
}

Object.assign(window, { ComprasPendientesPage });
