// ═══════════════════════════════════════════════════════════════════
// JARVEX — ÓRDENES DE COMPRA Y DE SERVICIO (tanda 5, B2 + B3).
//
// Gabriel, 4-sep-2026, probando la tanda 3 en producción:
//   «no encuentro las órdenes de compra ni las de servicio, y las necesito
//    para respaldar las compras de la obra actual».
//
// POR QUÉ ESTA PANTALLA EXISTE SI YA HAY UNA DE ÓRDENES DE COMPRA:
// `jx-compras.jsx` tiene el circuito de LOGÍSTICA — requisición → OC →
// recepción — y vive dentro del desglose de un trabajo. Está bien donde
// está, pero es un flujo de almacén: se entra por «pedir material», no por
// «respaldar una factura». Gabriel fue a buscarlas a la CONTABILIDAD, que es
// donde se necesita el papel, y ahí no había nada.
//
// Esto es el REGISTRO DOCUMENTAL de la empresa: todas sus órdenes emitidas
// (de compra y de servicio), y la puerta para emitir las que faltan. Las dos
// pantallas leen la MISMA tabla `ordenes_compra`.
//
// LA PESTAÑA QUE JUSTIFICA LA TANDA — «Sin respaldo»:
// medido el 4-sep contra producción, con el umbral de S/ 2.000 que propuso
// Gabriel, 200 de 1.205 comprobantes de compra (el 17% de los papeles)
// concentran S/ 3,91 M — el 97% del dinero. Emitirlas de a una a mano es
// inviable; emitirlas en lote, con la grilla editable antes de confirmar, es
// una tarde. Al emitir se llena `accounting_movements.orden_compra_id`, que
// existe desde la mig 041 con 0 de 1.378 filas usadas.
//
// EL GUARD SÍNCRONO de emitir() no es decorativo: es la regla crítica #2 del
// CLAUDE.md. Un doble click en «Emitir 200 órdenes» con el guard por estado
// duplica el lote entero.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import {
  TIPO_ORDEN_LABEL, textosDeTipo, proximoCodigo,
  comprobantesSinOrden, agruparPorEmpresa, resumenRespaldo,
  borradorDesdeMovimiento, recalcularBorrador,
  UMBRAL_POR_DEFECTO,
} from "../lib/ordenes.js";
import { filtroInicialEmpresa, setEmpresaActivaId } from "../lib/empresa-activa.js";
import { useEmpresaBloqueada } from "../hooks/useEmpresaActiva.js";

const { useState: uS, useMemo: uM, useEffect: uE, useRef: uR } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);
const Modal = (p) => (window.Modal ? <window.Modal {...p} /> : null);

const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtSk = (n) => {
  const v = Number(n || 0);
  if (v >= 1e6) return 'S/ ' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return 'S/ ' + (v / 1e3).toFixed(0) + 'K';
  return 'S/ ' + v.toFixed(0);
};

const ESTADO_BADGE = {
  borrador: 'b-gray', por_confirmar: 'b-amber', firmada: 'b-blue', enviada: 'b-blue',
  aceptada: 'b-green', recibida_parcial: 'b-amber', recibida: 'b-green',
  anulada: 'b-red', cancelada: 'b-red',
};
const ESTADO_LABEL = {
  borrador: 'Borrador', por_confirmar: 'Por confirmar', firmada: 'Firmada', enviada: 'Enviada',
  aceptada: 'Aceptada', recibida_parcial: 'Recibida parcial', recibida: 'Recibida',
  anulada: 'Anulada', cancelada: 'Anulada',
};
const ANULADA = new Set(['anulada', 'cancelada']);

function OrdenesPage({ showToast }) {
  const toast = showToast || window.__showToast || (() => {});
  const auth = window.__useAuth?.();
  const rol = auth?.profile?.rol || '';
  const userId = auth?.profile?.id ?? 'offline';
  const isAdmin = rol === 'admin';
  const canEmitir = isAdmin || rol === 'contador' || rol === 'gerente'
    || (window.__hasPerm?.(rol, 'Órdenes de Compra', 'w') ?? false);

  const { data: companies } = window.__hooks.useCompanies();
  const { data: movs } = window.__hooks.useAccountingMovements();
  const { data: obras } = window.__hooks.useObras();
  const { data: cfg } = window.__hooks.useAppConfig();
  const resolverConfig = window.__hooks.resolverConfig;

  // ── Estado (TODOS los hooks antes de cualquier return: regla #3) ──
  const [ordenes, setOrdenes] = uS([]);
  const [proveedores, setProveedores] = uS([]);
  const [tab, setTab] = uS('emitidas');
  // Dentro de la contabilidad de UNA empresa el selector queda CLAVADO: es la
  // regla de la tanda 2G («netamente y exclusivamente de esa empresa
  // seleccionada»), y una orden mal atribuida se numera en la serie de otro RUC.
  const empresaFija = useEmpresaBloqueada();
  // ÁMBITO DE OBRA (tanda 6). La misma pantalla, abierta desde el workspace de
  // un trabajo, es «las órdenes que respaldan las compras de ESTA obra».
  // No se acota la EMPRESA junto con la obra a propósito: en Miraflores, de
  // 460 comprobantes solo 112 son del titular (CONSORCIO EL INCA) — el resto
  // es la cadena intercompany, y fijar el titular escondería 3 de cada 4.
  // Mismo criterio que Movimientos de esta obra (docs/tanda-2-navegacion.md B1).
  const enObra = window.__plano === 'obra';
  const obraScopeId = enObra ? (() => { try { return window.__getObraActivaId?.() || null; } catch { return null; } })() : null;
  // Dentro de una obra el filtro arranca en TODAS: acotar además por la
  // empresa activa (que puede ser vieja, de la última vez que se entró a un
  // panel de empresa) escondería la mayor parte de la obra sin decir por qué.
  const [filtroEmpresaRaw, setFiltroEmpresa] = uS(() => (enObra ? 'todas' : filtroInicialEmpresa('todas')));
  const filtroEmpresa = empresaFija || filtroEmpresaRaw;
  const [filtroTipo, setFiltroTipo] = uS('todos');
  const [busqueda, setBusqueda] = uS('');
  const [verAnuladas, setVerAnuladas] = uS(false);
  const [borradores, setBorradores] = uS([]);
  const [emitiendo, setEmitiendo] = uS(false);
  const [progreso, setProgreso] = uS(null);
  const [detalle, setDetalle] = uS(null);
  const [detalleItems, setDetalleItems] = uS([]);
  const emitiendoRef = uR(false);

  const umbral = uM(() => {
    const v = Number(resolverConfig?.(cfg, 'orden_umbral_monto', UMBRAL_POR_DEFECTO));
    return Number.isFinite(v) && v > 0 ? v : UMBRAL_POR_DEFECTO;
  }, [cfg, resolverConfig]);

  const recargarOrdenes = React.useCallback(async () => {
    try {
      const all = await window.__db.ordenes_compra.toArray();
      setOrdenes(all.filter(o => !o.deleted_at));
    } catch { setOrdenes([]); }
  }, []);

  uE(() => {
    recargarOrdenes();
    window.__db.proveedores.toArray().then(p => setProveedores(p.filter(x => !x.deleted_at))).catch(() => {});
    const on = (e) => { if (!e?.detail?.tabla || e.detail.tabla === 'ordenes_compra') recargarOrdenes(); };
    window.addEventListener('jx_data_changed', on);
    window.addEventListener('jx_sync_pull', recargarOrdenes);
    return () => {
      window.removeEventListener('jx_data_changed', on);
      window.removeEventListener('jx_sync_pull', recargarOrdenes);
    };
  }, [recargarOrdenes]);

  const companyId = filtroEmpresa === 'todas' ? null : filtroEmpresa;
  const lookupCompany = React.useCallback((id) => (companies || []).find(c => c.id === id) || null, [companies]);
  const lookupProv = React.useCallback((id) => (proveedores || []).find(p => p.id === id) || null, [proveedores]);
  const lookupObra = React.useCallback((id) => (obras || []).find(o => o.id === id) || null, [obras]);

  const resumen = uM(
    () => resumenRespaldo(movs || [], ordenes, { umbral, companyId, obraId: obraScopeId }),
    [movs, ordenes, umbral, companyId, obraScopeId]
  );

  // ── Pestaña 1: las emitidas ─────────────────────────────────────
  const emitidas = uM(() => {
    let f = (ordenes || []).filter(o => !o.deleted_at);
    if (companyId) f = f.filter(o => o.company_id === companyId);
    if (obraScopeId) f = f.filter(o => o.obra_id === obraScopeId);
    if (filtroTipo !== 'todos') f = f.filter(o => (o.tipo || 'compra') === filtroTipo);
    if (!verAnuladas) f = f.filter(o => !ANULADA.has(o.estado));
    if (busqueda) {
      const q = busqueda.toLowerCase();
      f = f.filter(o =>
        (o.codigo || '').toLowerCase().includes(q) ||
        (o.proveedor_nombre || '').toLowerCase().includes(q) ||
        (o.titulo || '').toLowerCase().includes(q));
    }
    return f.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
  }, [ordenes, companyId, obraScopeId, filtroTipo, verAnuladas, busqueda]);

  // ── Pestaña 2: lo que falta respaldar ───────────────────────────
  const pendientes = uM(
    () => comprobantesSinOrden(movs || [], ordenes, { umbral, companyId, obraId: obraScopeId }),
    [movs, ordenes, umbral, companyId, obraScopeId]
  );
  const gruposPendientes = uM(
    () => agruparPorEmpresa(pendientes, companies || []),
    [pendientes, companies]
  );

  // Los borradores se arman al entrar a la pestaña y se conservan mientras se
  // editan: recalcularlos en cada render tiraría abajo lo que la contadora
  // acaba de escribir en la grilla.
  const prepararBorradores = () => {
    const b = pendientes.slice(0, 400).map(m => borradorDesdeMovimiento(m, {
      company: lookupCompany(m.company_id),
      proveedor: lookupProv(m.proveedor_id),
      obra: lookupObra(m.obra_id),
    }));
    setBorradores(b);
  };

  uE(() => {
    if (tab === 'respaldo' && borradores.length === 0 && pendientes.length > 0) prepararBorradores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, pendientes.length]);

  const actualizarBorrador = (idx, patch) => {
    setBorradores(bs => bs.map((b, i) => {
      if (i !== idx) return b;
      const next = { ...b, ...patch };
      return ('total' in patch || 'igvPct' in patch) ? recalcularBorrador(next) : next;
    }));
  };

  const seleccionados = uM(() => borradores.filter(b => b.incluir), [borradores]);
  const montoSeleccionado = uM(
    () => seleccionados.reduce((s, b) => s + Number(b.total || 0), 0),
    [seleccionados]
  );

  // ── LA EMISIÓN EN LOTE ──────────────────────────────────────────
  //
  // Una orden = una fila en `ordenes_compra` + un `oc_items` + el
  // `orden_compra_id` del comprobante. Los tres en la misma pasada: si se
  // escribiera la orden y no el movimiento, el comprobante volvería a
  // aparecer en esta lista y se emitiría dos veces.
  //
  // El correlativo se calcula sobre un acumulador LOCAL (`emitidasAhora`) y
  // no releyendo Dexie en cada vuelta: en un lote de 200, releer daría el
  // mismo número dos veces hasta que la escritura anterior se vea.
  const emitirLote = async () => {
    if (emitiendoRef.current) return;
    if (!seleccionados.length) { toast('No hay comprobantes seleccionados', 'amber'); return; }
    if (!canEmitir) { toast('No tenés permiso para emitir órdenes', 'red'); return; }
    const sinEmpresa = seleccionados.filter(b => !b.company_id);
    if (sinEmpresa.length) { toast(`${sinEmpresa.length} comprobante(s) sin empresa emisora — no se pueden numerar`, 'red'); return; }
    if (!window.confirm(`Emitir ${seleccionados.length} órdenes por ${fmtS(montoSeleccionado)}?\n\nCada comprobante queda atado a su orden.`)) return;

    emitiendoRef.current = true;
    setEmitiendo(true);
    setProgreso({ hechas: 0, total: seleccionados.length });
    const emitidasAhora = [...ordenes];
    let ok = 0; const errores = [];

    try {
      for (const b of seleccionados) {
        try {
          const company = lookupCompany(b.company_id);
          const anio = b.fecha ? Number(String(b.fecha).slice(0, 4)) : new Date().getFullYear();
          const { correlativo, codigo } = proximoCodigo(emitidasAhora, { company, tipo: b.tipo, anio });
          const ocId = window.__newId();
          const itemId = window.__newId();
          const now = new Date().toISOString();
          const obra = lookupObra(b.obra_id);
          const T = textosDeTipo(b.tipo);

          const fila = {
            id: ocId,
            codigo, correlativo, anio,
            tipo: b.tipo,
            company_id: b.company_id,
            obra_id: b.obra_id || null,
            trabajo_id: b.trabajo_id || null,
            proveedor_id: b.proveedor_id || null,
            proveedor_nombre: b.proveedor_nombre || null,
            proveedor_ruc: b.proveedor_ruc || null,
            proveedor_direccion: b.proveedor_direccion || null,
            fecha: b.fecha || now.slice(0, 10),
            fecha_entrega: null,
            moneda: 'PEN',
            condicion_pago: b.condicion_pago || null,
            estado: 'recibida',   // el bien/servicio YA se recibió: la orden es el respaldo de algo que pasó
            titulo: b.titulo || null,
            obra_descripcion: b.obra_descripcion || obra?.nombre_obra || null,
            contrato_ref: null,
            ejecutor_ref: null,
            igv_pct: Number(b.igvPct ?? 18),
            monto_subtotal: Number(b.valorVenta || 0),
            monto_igv: Number(b.igv || 0),
            monto_total: Number(b.total || 0),
            accounting_movement_id: b.movimiento_id,
            emitida_retroactiva: true,
            observaciones: `Respaldo retroactivo del comprobante ${b.documento || ''}`.trim(),
            created_by: userId, updated_by: userId,
            created_at: now, updated_at: now,
            version: 1, sync_status: 'pending_create', last_synced_at: null,
            idempotency_key: `${userId}_oc_${ocId}`,
          };

          await window.__db.ordenes_compra.add(fila);
          await window.__db.oc_items.add({
            id: itemId,
            orden_compra_id: ocId,
            tipo_insumo: b.tipo === 'servicio' ? 'servicio' : 'material',
            material_id: null, insumo_id: null, insumo_pendiente_id: null,
            nombre: b.descripcion || 'Insumos y materiales',
            nombre_libre: b.descripcion || 'Insumos y materiales',
            unidad: b.unidad || T.unidadPorDefecto,
            cantidad: Number(b.cantidad || 1),
            cantidad_recibida: Number(b.cantidad || 1),
            precio_unitario: Number(b.valorVenta || 0) / Math.max(1, Number(b.cantidad || 1)),
            subtotal: Number(b.valorVenta || 0),
            created_at: now, updated_at: now,
            version: 1, sync_status: 'pending_create', last_synced_at: null,
            idempotency_key: `${userId}_oc_item_${itemId}`,
          });

          // El otro lado del vínculo. Sin esto la factura sigue "sin respaldo".
          const mv = await window.__db.accounting_movements.get(b.movimiento_id);
          if (mv) {
            await window.__db.accounting_movements.update(b.movimiento_id, {
              orden_compra_id: ocId,
              updated_at: now, updated_by: userId,
              version: (mv.version ?? 0) + 1,
              sync_status: mv.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
            });
          }

          emitidasAhora.push(fila);
          ok++;
          setProgreso({ hechas: ok, total: seleccionados.length });
        } catch (e) {
          errores.push(`${b.documento || b.movimiento_id}: ${e.message || e}`);
        }
      }

      try {
        await window.__logAudit?.({
          action: 'create', table: 'ordenes_compra', recordId: null,
          newData: { emitidas: ok, monto: montoSeleccionado },
          reason: `Emisión masiva de respaldo — ${ok} órdenes por ${fmtS(montoSeleccionado)} (umbral S/ ${umbral})`,
        });
      } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'ordenes_compra' } })); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'accounting_movements' } })); } catch {}
      await recargarOrdenes();
      setBorradores([]);
      if (errores.length) {
        console.warn('[órdenes] errores de emisión', errores);
        toast(`${ok} órdenes emitidas · ${errores.length} con error (ver consola)`, 'amber');
      } else {
        toast(`✓ ${ok} órdenes emitidas · ${fmtS(montoSeleccionado)} respaldados`, 'green');
      }
      setTab('emitidas');
    } finally {
      emitiendoRef.current = false;
      setEmitiendo(false);
      setProgreso(null);
    }
  };

  // ── PDF ─────────────────────────────────────────────────────────
  const descargarPdf = async (o) => {
    try {
      const items = await window.__db.oc_items.where('orden_compra_id').equals(o.id).filter(x => !x.deleted_at).toArray();
      window.__pdfs?.generateOrdenPdf?.(o, items, {
        company: lookupCompany(o.company_id) || {},
        obra: lookupObra(o.obra_id),
        proveedor: lookupProv(o.proveedor_id),
      });
    } catch (e) { toast('Error generando el PDF: ' + (e.message || e), 'red'); }
  };

  const verDetalle = async (o) => {
    try {
      const items = await window.__db.oc_items.where('orden_compra_id').equals(o.id).filter(x => !x.deleted_at).toArray();
      setDetalleItems(items);
      setDetalle(o);
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
  };

  const anular = async (o) => {
    const motivo = window.prompt(`Motivo de anulación de ${o.codigo}:`);
    if (!motivo || motivo.trim().length < 5) { toast('Motivo requerido (mín. 5 caracteres)', 'red'); return; }
    try {
      const now = new Date().toISOString();
      await window.__db.ordenes_compra.update(o.id, {
        estado: 'anulada', motivo_anulacion: motivo.trim(), anulado_por: userId, anulado_at: now,
        updated_at: now, updated_by: userId,
        version: (o.version ?? 0) + 1,
        sync_status: o.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      // El comprobante vuelve a quedar sin respaldo — que es la verdad.
      if (o.accounting_movement_id) {
        const mv = await window.__db.accounting_movements.get(o.accounting_movement_id);
        if (mv && mv.orden_compra_id === o.id) {
          await window.__db.accounting_movements.update(mv.id, {
            orden_compra_id: null,
            updated_at: now, updated_by: userId,
            version: (mv.version ?? 0) + 1,
            sync_status: mv.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
          });
        }
      }
      try { await window.__logAudit?.({ action: 'update', table: 'ordenes_compra', recordId: o.id, oldData: { estado: o.estado }, newData: { estado: 'anulada', motivo }, reason: `Anulación ${o.codigo}: ${motivo}` }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'ordenes_compra' } })); } catch {}
      await recargarOrdenes();
      toast(`${o.codigo} anulada`, 'amber');
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
  };

  const empresasConMovs = uM(() => {
    const ids = new Set((movs || []).map(m => m.company_id).filter(Boolean));
    (ordenes || []).forEach(o => { if (o.company_id) ids.add(o.company_id); });
    return (companies || []).filter(c => !c.deleted_at && ids.has(c.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [companies, movs, ordenes]);

  const Banner = window.EmpresaActivaBanner;
  const obraScope = obraScopeId ? lookupObra(obraScopeId) : null;

  return (
    <div className="pg">
      <div className="pg-head">
        <div>
          <div className="pg-title">Órdenes de compra y servicio</div>
          <div className="pg-sub">
            {emitidas.length} órdenes · {fmtSk(emitidas.reduce((s, o) => s + Number(o.monto_total || 0), 0))}
            {obraScope ? ' · esta obra' : (companyId ? ` · ${lookupCompany(companyId)?.name || ''}` : ' · todo el grupo')}
          </div>
        </div>
      </div>

      {/* EL CARTEL DE LA OBRA (tanda 6). Hermano del de empresa y del de
          Movimientos de esta obra: sin él, una lista más corta de lo normal no
          tendría explicación — y no habría forma de salir del ámbito. */}
      {obraScope && (
        <div className="card card-p" style={{
          marginBottom: 12, borderLeft: '3px solid var(--amber)',
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <JxIcon name="hardHat" size={16} color="var(--amber)" />
          <div style={{ flex: 1, minWidth: 200, fontSize: 12, color: 'var(--ts)' }}>
            Las órdenes que respaldan las compras de <strong style={{ color: 'var(--tp)' }}>{obraScope.nombre_obra}</strong>
            <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 2 }}>
              Cada orden la numera la empresa que la emite (OC-001-2026 por RUC), pero aquí solo se ven
              las de este trabajo — incluidas las de las otras empresas del grupo que le compran.
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => window.__navTo?.('ordenes', 'general')}
            title="Salir del ámbito de la obra y ver las órdenes de todo el grupo">
            Ver las de todo el grupo →
          </button>
        </div>
      )}

      {!obraScope && Banner && <Banner onSalir={() => { setFiltroEmpresa('todas'); setBorradores([]); }} />}

      {/* ── LA BARRA DEL RESPALDO ───────────────────────────────────
          El número que Gabriel fue a buscar y no estaba: cuánto del dinero
          por encima del umbral tiene un papel que lo respalde. */}
      <div className="card card-p" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 2 }}>
              Respaldo de compras por encima de {fmtS(resumen.umbral)}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>
              {resumen.respaldados} de {resumen.sobreUmbral} comprobantes tienen orden ·{' '}
              <strong style={{ color: resumen.sinRespaldo ? 'var(--amber)' : 'var(--green)' }}>
                {fmtS(resumen.montoSinRespaldo)} sin respaldo
              </strong>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: resumen.pctRespaldado >= 90 ? 'var(--green)' : 'var(--amber)' }}>
              {resumen.pctRespaldado.toFixed(0)}%
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>del monto respaldado</div>
          </div>
        </div>
        <div style={{ height: 6, background: 'var(--bg-c2)', borderRadius: 3, marginTop: 10, overflow: 'hidden' }}>
          <div style={{
            width: `${Math.min(100, resumen.pctRespaldado)}%`, height: '100%',
            background: resumen.pctRespaldado >= 90 ? 'var(--green)' : 'var(--amber)',
          }} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${tab === 'emitidas' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('emitidas')}>
          Emitidas ({emitidas.length})
        </button>
        <button className={`btn btn-sm ${tab === 'respaldo' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('respaldo')}>
          Sin respaldo ({resumen.sinRespaldo})
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <select className="fi" value={filtroEmpresa} disabled={!!empresaFija}
          title={empresaFija ? 'Estás dentro de la contabilidad de esta empresa: son SUS órdenes.' : undefined}
          onChange={e => {
            setFiltroEmpresa(e.target.value);
            // Dentro de una obra, filtrar por empresa es UN FILTRO de esta
            // pantalla, no entrar a la contabilidad de esa empresa. Sin este
            // corte, elegir JARVEX acá dejaba el contexto pegado y el menú
            // entero pasaba a ser el de JARVEX al salir del trabajo.
            if (!enObra) setEmpresaActivaId(e.target.value === 'todas' ? null : e.target.value);
            setBorradores([]);
          }} style={{ minWidth: 220 }}>
          {!empresaFija && <option value="todas">Todas las empresas</option>}
          {empresasConMovs.filter(c => !empresaFija || c.id === empresaFija)
            .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {tab === 'emitidas' && (
          <>
            <select className="fi" value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)} style={{ minWidth: 160 }}>
              <option value="todos">Compra y servicio</option>
              <option value="compra">Solo órdenes de compra</option>
              <option value="servicio">Solo órdenes de servicio</option>
            </select>
            <div className="search-bar" style={{ flex: '1 1 180px' }}>
              <JxIcon name="search" size={14} color="var(--tm)" />
              <input placeholder="Buscar código, proveedor o rubro…" value={busqueda} onChange={e => setBusqueda(e.target.value)} />
            </div>
            <label style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 5, color: 'var(--tm)' }}>
              <input type="checkbox" checked={verAnuladas} onChange={e => setVerAnuladas(e.target.checked)} /> ver anuladas
            </label>
          </>
        )}
      </div>

      {tab === 'emitidas' ? (
        emitidas.length === 0 ? (
          <div className="card card-p empty-state">
            <JxIcon name="package" size={40} color="var(--tm)" />
            <p>No hay órdenes emitidas en esta vista.</p>
            {resumen.sinRespaldo > 0 && (
              <button className="btn btn-amber btn-sm" onClick={() => setTab('respaldo')}>
                Hay {resumen.sinRespaldo} comprobantes sin respaldo — emitirlas
              </button>
            )}
          </div>
        ) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr>
                  <th>N°</th><th>Tipo</th><th>Empresa que emite</th><th>Proveedor</th>
                  <th>Fecha</th><th style={{ textAlign: 'right' }}>Importe total</th>
                  <th>Estado</th><th style={{ textAlign: 'center' }}>Acciones</th>
                </tr></thead>
                <tbody>
                  {emitidas.map(o => {
                    const anulada = ANULADA.has(o.estado);
                    return (
                      <tr key={o.id} style={anulada ? { opacity: 0.6 } : undefined}>
                        <td className="col-m" style={{ fontFamily: 'monospace', fontWeight: 700 }}>
                          {o.codigo || '—'}
                          {o.emitida_retroactiva && <div style={{ fontSize: 9.5, color: 'var(--tm)', fontFamily: 'inherit' }}>respaldo retroactivo</div>}
                        </td>
                        <td>
                          <span className={`badge ${(o.tipo || 'compra') === 'servicio' ? 'b-purple' : 'b-blue'}`}>
                            {(o.tipo || 'compra') === 'servicio' ? 'Servicio' : 'Compra'}
                          </span>
                        </td>
                        <td className="col-p" style={{ maxWidth: 200, fontSize: 11.5 }}>{lookupCompany(o.company_id)?.name || '—'}</td>
                        <td className="col-p" style={{ maxWidth: 200, fontSize: 11.5 }}>
                          {o.proveedor_nombre || lookupProv(o.proveedor_id)?.razon_social || '—'}
                          {o.titulo && <div style={{ fontSize: 10, color: 'var(--tm)' }}>{o.titulo}</div>}
                        </td>
                        <td className="col-m">{o.fecha || '—'}</td>
                        <td className="col-num" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--blue)' }}>{fmtS(o.monto_total)}</td>
                        <td><span className={`badge ${ESTADO_BADGE[o.estado] || 'b-gray'}`}>{ESTADO_LABEL[o.estado] || o.estado}</span></td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <button className="btn btn-ghost btn-xs" title="Ver detalle" onClick={() => verDetalle(o)}><JxIcon name="eye" size={11} /></button>
                          <button className="btn btn-ghost btn-xs" title="Descargar el PDF con la marca de la empresa" onClick={() => descargarPdf(o)} style={{ marginLeft: 4 }}><JxIcon name="download" size={11} /></button>
                          {canEmitir && !anulada && (
                            <button className="btn btn-red btn-xs" title="Anular (con motivo)" onClick={() => anular(o)} style={{ marginLeft: 4 }}><JxIcon name="x" size={11} /></button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : (
        // ── PESTAÑA «SIN RESPALDO» ────────────────────────────────
        pendientes.length === 0 ? (
          <div className="card card-p empty-state">
            <JxIcon name="checkCircle" size={40} color="var(--green)" />
            <p>Todos los comprobantes por encima de {fmtS(umbral)} tienen su orden.</p>
          </div>
        ) : (
          <>
            <div className="card card-p" style={{ marginBottom: 12, background: 'var(--tint-neutral)' }}>
              <div style={{ fontSize: 12, color: 'var(--ts)', lineHeight: 1.55 }}>
                Cada fila genera <strong>una orden</strong> atada a ese comprobante. Revisá el
                nombre de lo comprado, el tipo y el monto antes de emitir — después la orden
                queda ligada a la factura y solo se puede anular con motivo.
                {gruposPendientes.length > 1 && (
                  <> Hay <strong>{gruposPendientes.length} empresas</strong> emitiendo: cada una numera su propia serie.</>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setBorradores(bs => bs.map(b => ({ ...b, incluir: true })))}>Marcar todas</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setBorradores(bs => bs.map(b => ({ ...b, incluir: false })))}>Desmarcar todas</button>
              <div style={{ flex: 1 }} />
              <div style={{ fontSize: 12, color: 'var(--tm)' }}>
                {seleccionados.length} seleccionadas · <strong style={{ color: 'var(--amber)' }}>{fmtS(montoSeleccionado)}</strong>
              </div>
              {canEmitir && (
                <button className="btn btn-amber btn-sm" disabled={emitiendo || !seleccionados.length} onClick={emitirLote}>
                  <JxIcon name="check" size={13} />
                  {emitiendo
                    ? `Emitiendo ${progreso?.hechas ?? 0}/${progreso?.total ?? 0}…`
                    : `Emitir ${seleccionados.length} órdenes`}
                </button>
              )}
            </div>

            <div className="card" style={{ overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl" style={{ fontSize: 11.5 }}>
                  <thead><tr>
                    <th style={{ width: 32 }}></th>
                    <th>Comprobante</th>
                    <th>Empresa / Proveedor</th>
                    <th style={{ minWidth: 220 }}>Qué se compró (editable)</th>
                    <th style={{ width: 110 }}>Tipo</th>
                    <th style={{ width: 70 }}>IGV</th>
                    <th style={{ width: 120, textAlign: 'right' }}>Importe total</th>
                  </tr></thead>
                  <tbody>
                    {borradores.map((b, idx) => (
                      <tr key={b.movimiento_id} style={b.incluir ? undefined : { opacity: 0.45 }}>
                        <td style={{ textAlign: 'center' }}>
                          <input type="checkbox" checked={!!b.incluir} onChange={e => actualizarBorrador(idx, { incluir: e.target.checked })} />
                        </td>
                        <td className="col-m" style={{ fontFamily: 'monospace', fontSize: 10.5 }}>
                          {b.documento || '—'}
                          <div style={{ color: 'var(--tm)', fontFamily: 'inherit' }}>{b.fecha || ''}</div>
                        </td>
                        <td style={{ maxWidth: 190, fontSize: 10.5 }}>
                          <div style={{ fontWeight: 600 }}>{b.proveedor_nombre || '—'}</div>
                          <div style={{ color: 'var(--tm)' }}>emite: {lookupCompany(b.company_id)?.name || '⚠ sin empresa'}</div>
                        </td>
                        <td>
                          <input className="fi" style={{ fontSize: 11 }} value={b.descripcion || ''}
                            onChange={e => actualizarBorrador(idx, { descripcion: e.target.value })} />
                        </td>
                        <td>
                          <select className="fi" style={{ fontSize: 11 }} value={b.tipo}
                            onChange={e => actualizarBorrador(idx, { tipo: e.target.value, unidad: textosDeTipo(e.target.value).unidadPorDefecto })}>
                            <option value="compra">Compra</option>
                            <option value="servicio">Servicio</option>
                          </select>
                        </td>
                        <td>
                          <select className="fi" style={{ fontSize: 11 }} value={String(b.igvPct)}
                            onChange={e => actualizarBorrador(idx, { igvPct: Number(e.target.value) })}>
                            <option value="18">18%</option>
                            <option value="0">Sin IGV</option>
                          </select>
                        </td>
                        <td>
                          <input className="fi" type="number" min="0" step="0.01" style={{ fontSize: 11, textAlign: 'right' }}
                            value={b.total} onChange={e => actualizarBorrador(idx, { total: e.target.value })} />
                          <div style={{ fontSize: 9.5, color: 'var(--tm)', textAlign: 'right' }}>
                            v.venta {fmtS(b.valorVenta)} + IGV {fmtS(b.igv)}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {pendientes.length > borradores.length && (
              <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 8 }}>
                Mostrando las {borradores.length} más caras de {pendientes.length}. Emitidas éstas, aparecen las siguientes.
              </div>
            )}
          </>
        )
      )}

      {detalle && (
        <Modal title={`${TIPO_ORDEN_LABEL[detalle.tipo || 'compra']} ${detalle.codigo || ''}`} icon="package"
          onClose={() => { setDetalle(null); setDetalleItems([]); }} wide>
          <div className="g2">
            <div><label className="flabel">Empresa que emite</label><div className="fi" style={{ background: 'var(--bg-c2)' }}>{lookupCompany(detalle.company_id)?.name || '—'}</div></div>
            <div><label className="flabel">Proveedor</label><div className="fi" style={{ background: 'var(--bg-c2)' }}>{detalle.proveedor_nombre || lookupProv(detalle.proveedor_id)?.razon_social || '—'}</div></div>
            <div><label className="flabel">Fecha</label><div className="fi" style={{ background: 'var(--bg-c2)' }}>{detalle.fecha || '—'}</div></div>
            <div><label className="flabel">Estado</label><div className="fi" style={{ background: 'var(--bg-c2)' }}>{ESTADO_LABEL[detalle.estado] || detalle.estado}</div></div>
            {detalle.obra_descripcion && (
              <div style={{ gridColumn: '1/-1' }}><label className="flabel">Obra</label><div className="fi" style={{ background: 'var(--bg-c2)', height: 'auto', minHeight: 34, whiteSpace: 'normal' }}>{detalle.obra_descripcion}</div></div>
            )}
          </div>
          <div style={{ marginTop: 14, overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
            <table className="tbl" style={{ fontSize: 11 }}>
              <thead><tr>
                <th>#</th><th>{textosDeTipo(detalle.tipo).columnaDescripcion}</th>
                <th>Unidad</th><th style={{ textAlign: 'right' }}>Cant.</th>
                <th style={{ textAlign: 'right' }}>P. Unit.</th><th style={{ textAlign: 'right' }}>Importe</th>
              </tr></thead>
              <tbody>
                {detalleItems.map((it, i) => (
                  <tr key={it.id}>
                    <td>{i + 1}</td>
                    <td>{it.nombre || it.nombre_libre || '—'}</td>
                    <td>{it.unidad || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{Number(it.cantidad || 0).toFixed(2)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtS(it.precio_unitario)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtS(it.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={5} style={{ textAlign: 'right', padding: '6px 12px' }}>Valor de venta:</td><td style={{ textAlign: 'right' }}>{fmtS(detalle.monto_subtotal)}</td></tr>
                <tr><td colSpan={5} style={{ textAlign: 'right', padding: '6px 12px' }}>IGV ({Number(detalle.igv_pct ?? 18)}%):</td><td style={{ textAlign: 'right' }}>{fmtS(detalle.monto_igv)}</td></tr>
                <tr style={{ background: 'rgba(242,183,5,0.15)', fontWeight: 700 }}>
                  <td colSpan={5} style={{ textAlign: 'right', padding: '8px 12px' }}>{textosDeTipo(detalle.tipo).total}:</td>
                  <td style={{ textAlign: 'right', color: 'var(--amber)' }}>{fmtS(detalle.monto_total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => { setDetalle(null); setDetalleItems([]); }}>Cerrar</button>
            <button className="btn btn-amber" onClick={() => descargarPdf(detalle)}><JxIcon name="download" size={13} />Descargar PDF</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { OrdenesPage });
export { OrdenesPage };
