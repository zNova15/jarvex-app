import React from "react";
import { derivarTypeContable } from "../lib/clasificacion-contable.js";
const { useState: uSS, useEffect: uES, useMemo: uMS, useCallback: uCS } = React;

// ─── Helpers ─────────────────────────────────────────────
const STATUS_BADGE = {
  pendiente:  { class: 'b-amber',  label: 'Pendiente' },
  aprobada:   { class: 'b-green',  label: 'Aprobada' },
  rechazada:  { class: 'b-red',    label: 'Rechazada' },
  cancelada:  { class: 'b-gray',   label: 'Cancelada' },
};

const TABLE_LABELS = {
  // Maestras
  materiales: 'Materiales',
  herramientas: 'Herramientas',
  personal: 'Personal',
  proveedores: 'Proveedores',
  obras: 'Obras',
  partidas: 'Partidas',
  // Operaciones
  movimientos_materiales: 'Mov. Materiales',
  movimientos_herramientas: 'Mov. Herramientas',
  asistencia: 'Asistencia',
  avance_obra: 'Avance Obra',
  incidencias: 'Incidencias',
  evidencias: 'Evidencias',
  // Versionado
  presupuestos_versiones: 'Versiones Presupuesto',
  partidas_versionadas: 'Partidas Versionadas',
  // Contabilidad
  companies: 'Empresas',
  accounting_movements: 'Movs. Contables',
  intercompany_transactions: 'Operaciones Intercompany',
  // Compras
  requisiciones: 'Requisiciones',
  requisicion_items: 'Items de Requisición',
  cotizaciones: 'Cotizaciones',
  ordenes_compra: 'Órdenes de Compra',
  oc_items: 'Items de OC',
  recepciones: 'Recepciones',
  // Valorizaciones
  valorizaciones: 'Valorizaciones',
  valorizacion_partidas: 'Partidas Valorizadas',
  // Tesorería
  cuentas_bancarias: 'Cuentas Bancarias',
  movimientos_bancarios: 'Movs. Bancarios',
  cronograma_pagos: 'Cronograma Pagos',
  // Maquinaria
  activos_pesados: 'Activos Pesados',
  horas_maquina: 'Horas Máquina',
  consumos_combustible: 'Consumos Combustible',
  mantenimientos_maquinaria: 'Mantenimientos',
  // SSOMA
  charlas_seguridad: 'Charlas Seguridad',
  iperc: 'IPERC',
  epp_entregas: 'Entregas EPP',
  inspecciones_seguridad: 'Inspecciones SSOMA',
  capacitaciones: 'Capacitaciones',
  // Subcontratos
  subcontratistas: 'Subcontratistas',
  subcontratos: 'Subcontratos',
  subcontrato_valorizaciones: 'Valor. Subcontrato',
  // RRHH
  personal_contrato: 'Contratos Laborales',
  planillas: 'Planillas',
  planilla_boletas: 'Boletas Planilla',
};

function fmtDate(ts) {
  try { return new Date(ts).toLocaleString('es-PE'); } catch { return ts; }
}

// ─── Diff visual de proposed_changes ─────────────────────
function ChangeDiff({ changes }) {
  if (!changes || typeof changes !== 'object') return <span style={{ color: 'var(--tm)' }}>—</span>;
  const entries = Object.entries(changes);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {entries.map(([field, val]) => {
        const oldV = val && typeof val === 'object' ? val.old : undefined;
        const newV = val && typeof val === 'object' ? val.new : val;
        // Etiquetas legibles opcionales (ej. frente_id → "Frente de trabajo" y los
        // nombres de frente en vez de los uuid). Las pone RequestChangeModal.
        const fieldLabel = (val && typeof val === 'object' && val.label) ? val.label : field;
        const oldLabel = (val && typeof val === 'object' && 'oldLabel' in val) ? val.oldLabel : oldV;
        const newLabel = (val && typeof val === 'object' && 'newLabel' in val) ? val.newLabel : newV;
        // Claves __* ESTRUCTURADAS que SÍ se auto-aplican al aprobar (no son
        // pedidos manuales): vinculación de factura y eliminación de
        // bancarización (21-jul). Se muestran como un cambio normal.
        const AUTO_KEYS = new Set(['__vinculacion_destino', '__banc_eliminar', '__detraccion_eliminar']);
        // Pedido descriptivo (campo no estructurado): requiere acción manual del admin.
        if (field.startsWith('__') && !AUTO_KEYS.has(field)) {
          return (
            <div key={field} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 12, alignItems: 'center' }}>
              <span style={{ background: 'rgba(242,183,5,0.12)', border: '1px solid rgba(242,183,5,0.3)', color: 'var(--amber)', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>📝 Pedido descrito en el motivo · acción manual del admin</span>
            </div>
          );
        }
        return (
          <div key={field} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 12, alignItems: 'center' }}>
            <span style={{ color: 'var(--tm)', fontWeight: 600, minWidth: 100 }}>{fieldLabel}:</span>
            {oldV !== undefined && (
              <span style={{ background: 'rgba(231,76,60,0.1)', border: '1px solid rgba(231,76,60,0.25)', color: 'var(--red)', padding: '2px 8px', borderRadius: 4, textDecoration: 'line-through', fontSize: 11.5 }}>
                {String(oldLabel ?? '—')}
              </span>
            )}
            {oldV !== undefined && <span style={{ color: 'var(--tm)' }}>→</span>}
            <span style={{ background: 'rgba(46,204,113,0.1)', border: '1px solid rgba(46,204,113,0.25)', color: 'var(--green)', padding: '2px 8px', borderRadius: 4, fontSize: 11.5 }}>
              {String(newLabel ?? '—')}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Contexto del registro objetivo de una solicitud ─────────────────
// El admin veía "salida · CODO INY..." sin saber QUÉ movimiento era (fecha,
// cantidad, frente...). Esto lee el registro real de Dexie y muestra un
// resumen + un modal "Ver registro" con todos los campos legibles.
const CTX_OCULTOS = new Set(['id', 'sync_status', 'version', 'created_by', 'updated_by', 'last_synced_at', 'idempotency_key', 'demo', 'blob_ref', 'local_path_temporal', 'upload_retries', 'updated_at']);
// FK conocidas → cómo resolver su nombre legible.
const CTX_LOOKUPS = {
  material_id: { tabla: 'materiales', campo: 'nombre_material' },
  herramienta_id: { tabla: 'herramientas', campo: 'nombre_herramienta' },
  epp_id: { tabla: 'epps', campo: 'nombre_epp' },
  frente_id: { tabla: 'frentes_obra', campo: 'nombre' },
  obra_id: { tabla: 'obras', campo: 'nombre_obra' },
  personal_id: { tabla: 'personal', campo: (p) => `${p.nombres || ''} ${p.apellidos || ''}`.trim() },
  // responsable_id: en almacén apunta a personal; en avance_obra (reportes de
  // ingeniero) es el id del USUARIO (profiles) → fallback si personal no lo tiene.
  responsable_id: { tabla: 'personal', campo: (p) => `${p.nombres || ''} ${p.apellidos || ''}`.trim(), fallback: { tabla: 'profiles', campo: (p) => `${p.nombres || ''} ${p.apellidos || ''}`.trim() || p.email || '' } },
  proveedor_id: { tabla: 'proveedores', campo: 'razon_social' },
  partida_id: { tabla: 'partidas', campo: 'nombre_partida' },
  ubicacion_id: { tabla: 'ubicaciones_obra', campo: 'nombre' },
  subcontratista_id: { tabla: 'subcontratistas', campo: 'razon_social' },
};
// Página de la app donde VIVE cada tabla objetivo (para saltar directo desde
// la solicitud a la sección del registro — pedido de Gabriel).
const TABLA_A_PAGINA = {
  movimientos_materiales: 'mov-materiales',
  movimientos_herramientas: 'mov-herramientas',
  movimientos_epp: 'mov-epp',
  movimientos_maquinaria: 'activos-pesados',
  movimientos_insumos_emergencia: 'insumos-emergencia',
  materiales: 'materiales',
  herramientas: 'herramientas',
  epps: 'epps-inventario',
  insumos_emergencia: 'insumos-emergencia',
  personal: 'personal',
  asistencia: 'asistencia',
  avance_obra: 'avance',
  accounting_movements: 'movimientos-contables',
  activos_pesados: 'activos-pesados',
  proveedores: 'proveedores',
  caja_chica_movimientos: 'caja-chica',
};

function ContextoRegistro({ table, recordId }) {
  const [reg, setReg] = uSS(undefined);          // undefined=cargando · null=no está · objeto
  const [nombres, setNombres] = uSS({});         // fk campo → nombre legible
  const [verDetalle, setVerDetalle] = uSS(false);
  uES(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await window.__db?.[table]?.get(recordId);
        if (cancel) return;
        if (!r) { setReg(null); return; }
        setReg(r);
        const res = {};
        for (const [campo, lk] of Object.entries(CTX_LOOKUPS)) {
          if (!r[campo]) continue;
          try {
            const row = await window.__db?.[lk.tabla]?.get(r[campo]);
            let val = row ? (typeof lk.campo === 'function' ? lk.campo(row) : (row[lk.campo] || null)) : null;
            if (!val && lk.fallback) {
              const row2 = await window.__db?.[lk.fallback.tabla]?.get(r[campo]);
              if (row2) val = typeof lk.fallback.campo === 'function' ? lk.fallback.campo(row2) : (row2[lk.fallback.campo] || null);
            }
            if (val) res[campo] = val;
          } catch {}
        }
        if (!cancel) setNombres(res);
      } catch { if (!cancel) setReg(null); }
    })();
    return () => { cancel = true; };
  }, [table, recordId]);

  if (reg === undefined) return null;
  if (reg === null) {
    return <div style={{ fontSize: 11, color: 'var(--tm)', fontStyle: 'italic', marginBottom: 8 }}>⚠ El registro no está en este dispositivo (pudo ser eliminado o aún no sincronizó).</div>;
  }
  // Resumen: los datos que ubican el registro de un vistazo.
  const partes = [];
  if (reg.fecha) partes.push(String(reg.fecha));
  if (reg.tipo_movimiento || reg.accion) partes.push(String(reg.tipo_movimiento || reg.accion).toUpperCase());
  const insumo = nombres.material_id || nombres.herramienta_id || nombres.epp_id;
  if (insumo) partes.push(insumo);
  if (reg.cantidad != null) partes.push(`${reg.cantidad} ${reg.unidad || ''}`.trim());
  if (nombres.frente_id) partes.push(`Frente: ${nombres.frente_id}`);
  if (nombres.personal_id || nombres.responsable_id) partes.push(`Resp.: ${nombres.personal_id || nombres.responsable_id}`);
  if (nombres.obra_id) partes.push(`Obra: ${nombres.obra_id}`);
  const fmtV = (k, v) => {
    if (v == null || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (nombres[k]) return `${nombres[k]}`;
    if (typeof v === 'object') { try { return JSON.stringify(v).slice(0, 200); } catch { return '[objeto]'; } }
    const s = String(v);
    if (/_at$/.test(k)) { try { return new Date(s).toLocaleString('es-PE'); } catch { return s; } }
    return s.length > 220 ? s.slice(0, 220) + '…' : s;
  };
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--tm)', letterSpacing: '.08em' }}>REGISTRO A MODIFICAR</div>
        <button className="btn btn-ghost btn-xs" style={{ fontSize: 10 }} onClick={() => setVerDetalle(v => !v)}>
          {verDetalle ? 'Ocultar detalle' : 'Ver registro completo'}
        </button>
        {TABLA_A_PAGINA[table] && (
          <button className="btn btn-ghost btn-xs" style={{ fontSize: 10, color: 'var(--amber)' }}
            title="Abrir la sección con este registro YA BUSCADO (la búsqueda llega pre-cargada)"
            onClick={() => {
              // Dejar la BÚSQUEDA pre-cargada en la página destino para aterrizar
              // en el REGISTRO exacto (cada página consume su "intent" al montar).
              // Antes solo navegaba a la sección y el admin tenía que buscar a mano.
              try {
                switch (table) {
                  case 'accounting_movements':
                    window.__movsBuscarIntent = reg?.document_number || ''; break;
                  case 'movimientos_materiales':
                    window.__movMatBuscar = nombres.material_id || reg?.documento_asociado || ''; break;
                  case 'movimientos_epp':
                    window.__movEppBuscar = nombres.epp_id || ''; break;
                  case 'materiales':
                    window.__almMatBuscar = reg?.nombre_material || ''; break;
                  case 'herramientas':
                    window.__almHerrBuscar = reg?.nombre_herramienta || ''; break;
                  case 'epps':
                    window.__eppInvBuscar = reg?.nombre_epp || ''; break;
                  case 'pagos':
                    window.__pagosBuscarIntent = reg?.beneficiario_nombre || reg?.concepto || ''; break;
                  case 'personal':
                    window.__personalBuscar = `${reg?.nombres || ''} ${reg?.apellidos || ''}`.trim(); break;
                  default: break;
                }
              } catch {}
              // Aterrizar en la OBRA del registro: las páginas de almacén/personal/EPP
              // se scopean por obra activa — si quedó otra obra seleccionada, la
              // búsqueda pre-cargada no encontraba nada. Se respeta el aislamiento
              // por obra (window.__obrasPermitidas). Las facturas van a Contabilidad
              // en plano GENERAL (filtro de obra arranca en "todas").
              try {
                const oid = reg?.obra_id;
                const permitidas = window.__obrasPermitidas; // Set | null (sin restricción)
                if (oid && window.__setObraActivaId && (!permitidas || permitidas.has(oid))) window.__setObraActivaId(oid);
              } catch {}
              if (table === 'accounting_movements') window.__navTo?.(TABLA_A_PAGINA[table], 'general');
              else window.__navTo?.(TABLA_A_PAGINA[table]);
            }}>
            ↗ Ir al registro
          </button>
        )}
      </div>
      {partes.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--ts)', marginTop: 4 }}>📄 {partes.join(' · ')}</div>
      )}
      {verDetalle && (
        <div style={{ marginTop: 8, background: 'var(--bg-s)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '6px 16px' }}>
          {Object.entries(reg)
            .filter(([k, v]) => !CTX_OCULTOS.has(k) && !k.startsWith('_') && v !== null && v !== '' && v !== undefined)
            .map(([k, v]) => (
              <div key={k} style={{ fontSize: 11.5, minWidth: 0 }}>
                <span style={{ color: 'var(--tm)' }}>{k.replace(/_/g, ' ')}: </span>
                <span style={{ color: 'var(--ts)', wordBreak: 'break-word' }}>{fmtV(k, v)}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// ─── EditarSolicitudModal — el solicitante corrige su solicitud pendiente ───
// Pedido de Gabriel: la almacenera (y otros roles) no veían qué solicitaron;
// ahora además pueden corregir el valor propuesto o el motivo sin re-crear.
// Solo se editan valores "planos" (texto/número/fecha). Los campos con
// etiqueta legible distinta al valor (FK tipo frente_id → nombre) no se
// editan acá: el selector con las opciones vive en el registro original.
function EditarSolicitudModal({ req, onClose, onSaved, showToast }) {
  const entries = Object.entries(req.proposed_changes || {});
  const esEliminacion = entries.some(([k]) => k === 'deleted_at');
  const esEditable = ([k, v]) => {
    if (k.startsWith('__') || k === 'deleted_at') return false;
    // Solo changes ESTRUCTURADOS de RequestChangeModal (traen label). Los
    // pseudo-campos crudos de flujos especiales y el timestamp de eliminación
    // no deben aparecer como inputs de texto libre.
    if (!v || typeof v !== 'object' || !v.label) return false;
    // Valor elegido de una lista (select) → no editable como texto libre.
    if (v.conOpciones) return false;
    const newLabel = 'newLabel' in v ? v.newLabel : undefined;
    return newLabel === undefined || newLabel === null || String(newLabel) === String(v.new ?? '');
  };
  const editables = entries.filter(esEditable);
  const soloDescriptivo = editables.length === 0 && entries.some(([k]) => k.startsWith('__'));
  const [vals, setVals] = uSS(() => {
    const o = {};
    for (const [k, v] of editables) o[k] = String((v && typeof v === 'object' && 'new' in v ? v.new : v) ?? '');
    return o;
  });
  const [reason, setReason] = uSS(req.reason || '');
  const [busy, setBusy] = uSS(false);

  const guardar = async () => {
    if (!reason.trim() || reason.trim().length < 10) {
      showToast('El motivo debe tener al menos 10 caracteres', 'red'); return;
    }
    const pc = {};
    let cambio = reason.trim() !== String(req.reason || '').trim();
    for (const [k, v] of entries) {
      const base = v && typeof v === 'object' ? { ...v } : { old: null, new: v };
      if (k.startsWith('__')) {
        // El pedido descriptivo ES el motivo → mantenerlos en sincronía.
        if (String(base.new ?? '') !== reason.trim()) cambio = true;
        base.new = reason.trim();
        pc[k] = base; continue;
      }
      if (k in vals) {
        let nv = vals[k];
        if (String(nv).trim() === '') { showToast('El valor propuesto no puede quedar vacío', 'red'); return; }
        if (typeof base.new === 'number') {
          // Coma decimal peruana: "12,5" — parseFloat la truncaría a 12 en silencio.
          const norm = String(nv).trim().replace(',', '.');
          if (!/^-?\d+(\.\d+)?$/.test(norm)) { showToast('El valor propuesto debe ser un número', 'red'); return; }
          nv = parseFloat(norm);
        }
        if (String(base.new ?? '') !== String(nv)) cambio = true;
        base.new = nv;
        if ('newLabel' in base) base.newLabel = String(nv);
      }
      pc[k] = base;
    }
    if (!cambio) { showToast('No cambiaste nada todavía', 'amber'); return; }
    setBusy(true);
    try {
      await window.__changeRequests.updateOwn(req.id, { proposedChanges: pc, reason: reason.trim() });
      showToast('Solicitud actualizada', 'green');
      onSaved();
    } catch (e) {
      showToast('Error: ' + (e?.message || e), 'red');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Editar mi solicitud" icon="edit" onClose={onClose}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--tm)', marginBottom: 4 }}>Registro:</div>
        <div style={{ fontSize: 13, color: 'var(--tp)', fontWeight: 600 }}>
          {TABLE_LABELS[req.target_table] || req.target_table} · {req.target_record_label || req.target_record_id}
        </div>
      </div>
      {editables.map(([k, v]) => {
        const label = (v && typeof v === 'object' && v.label) ? v.label : k;
        const oldV = v && typeof v === 'object' ? v.old : undefined;
        return (
          <div key={k} style={{ marginBottom: 10 }}>
            <label className="flabel">{label} — valor propuesto *</label>
            {oldV !== undefined && oldV !== null && (
              <div style={{ fontSize: 11, color: 'var(--tm)', marginBottom: 4 }}>Actual: {String(v.oldLabel ?? oldV)}</div>
            )}
            <input className="fi" value={vals[k]} onChange={e => setVals(s => ({ ...s, [k]: e.target.value }))} />
          </div>
        );
      })}
      {esEliminacion ? (
        <div style={{ background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.25)', borderRadius: 6, padding: '8px 12px', fontSize: 11.5, color: 'var(--ts)', marginBottom: 10 }}>
          <strong style={{ color: 'var(--red)' }}>Solicitud de eliminación</strong> — acá solo se corrige el motivo. Si ya no querés eliminar el registro, anulá la solicitud.
        </div>
      ) : entries.some(([k, v]) => !k.startsWith('__') && !esEditable([k, v])) && (
        <div style={{ background: 'rgba(242,183,5,0.08)', border: '1px solid rgba(242,183,5,0.25)', borderRadius: 6, padding: '8px 12px', fontSize: 11.5, color: 'var(--ts)', marginBottom: 10 }}>
          Esta solicitud propone un valor elegido de una lista (ej. un frente o una unidad). Para cambiarlo, anulala y creá una nueva desde el registro. Acá podés corregir el motivo.
        </div>
      )}
      <div>
        <label className="flabel">{soloDescriptivo ? 'Pedido / motivo * (describe qué cambiar)' : 'Motivo * (mín. 10 caracteres)'}</label>
        <textarea className="fi" rows={3} value={reason} onChange={e => setReason(e.target.value)} />
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" disabled={busy} onClick={onClose}>Cancelar</button>
        <button className="btn btn-amber" disabled={busy} onClick={guardar}>
          <JxIcon name="check" size={13} />{busy ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </Modal>
  );
}

// ─── SolicitudesPage ─────────────────────────────────────
function SolicitudesPage({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const isAdmin = auth?.profile?.rol === 'admin';
  // Revisores que pueden ver "Pendientes" y aprobar/rechazar: admin y Contador Jefe.
  const esRevisor = isAdmin || auth?.profile?.rol === 'contador';
  const myId = auth?.profile?.id;

  const [tab, setTab] = uSS(esRevisor ? 'pendientes' : 'mias');
  const [requests, setRequests] = uSS([]);
  const [loading, setLoading] = uSS(true);
  const [busy, setBusy] = uSS(false);
  // Anti-fantasma: cola local sin subir + total real de pendientes en el server.
  const [colaLocal, setColaLocal] = uSS([]);
  const [pendTotalServer, setPendTotalServer] = uSS(null);

  const [reviewing, setReviewing] = uSS(null);     // request en revisión
  const [reviewMode, setReviewMode] = uSS(null);   // 'approve' | 'reject'
  const [reviewComment, setReviewComment] = uSS('');
  const [editando, setEditando] = uSS(null);       // request propia en edición

  // Buscador + clasificación (pedido de Gabriel): la bandeja mezclaba 33
  // solicitudes de varias personas y áreas — las 27 de la contadora quedaban
  // enterradas bajo las de almacén y sin forma de filtrarlas.
  const [q, setQ] = uSS('');                        // texto de búsqueda libre
  const [fPersona, setFPersona] = uSS('');          // filtro por requester_email
  const [fTipo, setFTipo] = uSS('');                // filtro por target_table
  // Filtros extra de la pestaña RESUELTAS (historial del admin).
  const [fEstado, setFEstado] = uSS('');            // '' | aprobada | rechazada
  const [fPedidaDesde, setFPedidaDesde] = uSS('');  // rango de CUÁNDO la pidieron
  const [fPedidaHasta, setFPedidaHasta] = uSS('');
  const [fResDesde, setFResDesde] = uSS('');        // rango de CUÁNDO se resolvió
  const [fResHasta, setFResHasta] = uSS('');
  // Al cambiar de pestaña, los filtros ya no aplican (otra lista) → resetear.
  uES(() => { setQ(''); setFPersona(''); setFTipo(''); setFEstado(''); setFPedidaDesde(''); setFPedidaHasta(''); setFResDesde(''); setFResHasta(''); }, [tab]);

  const norm = (s) => String(s == null ? '' : s).toLowerCase();
  // Personas que enviaron solicitudes (con conteo) → chips de clasificación.
  const personas = uMS(() => {
    const m = new Map();
    for (const r of requests) { const k = r.requester_email || '—'; m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [requests]);
  // Tipos (tabla objetivo) con conteo → select de clasificación por área.
  const tipos = uMS(() => {
    const m = new Map();
    for (const r of requests) { const k = r.target_table || '—'; m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [requests]);
  const filtered = uMS(() => {
    const term = norm(q).trim();
    const words = term ? term.split(/\s+/) : [];
    return requests.filter(r => {
      if (fPersona && (r.requester_email || '—') !== fPersona) return false;
      if (fTipo && (r.target_table || '—') !== fTipo) return false;
      // Filtros del historial de resueltas (fechas en ISO → comparación segura).
      if (fEstado && r.status !== fEstado) return false;
      // Fechas en zona LOCAL (el input type=date es local; .slice(0,10) daba el día UTC).
      const fl = (iso) => (window.__fecha?.fechaLocalDe ? window.__fecha.fechaLocalDe(iso) : String(iso || '').slice(0, 10));
      if (fPedidaDesde && fl(r.created_at) < fPedidaDesde) return false;
      if (fPedidaHasta && fl(r.created_at) > fPedidaHasta) return false;
      if (fResDesde && (!r.reviewed_at || fl(r.reviewed_at) < fResDesde)) return false;
      if (fResHasta && (!r.reviewed_at || fl(r.reviewed_at) > fResHasta)) return false;
      if (!words.length) return true;
      const hay = norm([
        r.requester_email,
        r.target_record_label,
        r.reason,
        TABLE_LABELS[r.target_table] || r.target_table,
        JSON.stringify(r.proposed_changes || {}),  // captura valores/motivos descriptivos
      ].join(' • '));
      return words.every(w => hay.includes(w));
    });
  }, [requests, q, fPersona, fTipo, fEstado, fPedidaDesde, fPedidaHasta, fResDesde, fResHasta]);

  const cr = window.__changeRequests || {};

  const reload = uCS(async () => {
    setLoading(true);
    try {
      let data;
      if (tab === 'resueltas' && esRevisor) {
        // Historial del admin: todo lo APROBADO/RECHAZADO (filtros en la UI).
        data = (await cr.list?.({ limit: 500 }) || []).filter(r => r.status === 'aprobada' || r.status === 'rechazada');
        setPendTotalServer(null);
      } else if (tab === 'pendientes' && esRevisor) {
        data = await cr.list?.({ status: 'pendiente', limit: 500 }) || [];
        // Chequeo anti-fantasma: si el conteo del server supera lo listado, hay
        // solicitudes que la bandeja NO muestra (truncamiento) — avisar.
        try {
          const totalPend = await cr.countPending?.();
          setPendTotalServer(typeof totalPend === 'number' ? totalPend : null);
        } catch { setPendTotalServer(null); }
      } else {
        data = await cr.list?.({ requesterId: myId, limit: 500 }) || [];
        setPendTotalServer(null);
      }
      setRequests(data);
      // Cola LOCAL sin subir (las verdaderas "fantasma"): solicitudes que este
      // dispositivo nunca logró insertar en el server.
      try { setColaLocal(await cr.colaLocal?.() || []); } catch { setColaLocal([]); }
    } catch (e) {
      console.warn('[SolicitudesPage] load error', e);
    } finally {
      setLoading(false);
    }
  }, [tab, esRevisor, myId]);

  const subirColaLocal = async () => {
    setBusy(true);
    try {
      const n = await cr.sync?.();
      const resto = await cr.colaLocal?.() || [];
      setColaLocal(resto);
      if (n > 0 && resto.length === 0) showToast(`✓ ${n} solicitud(es) subida(s) — el admin ya las ve.`, 'green');
      else if (n > 0) showToast(`⚠ Subieron ${n}, pero ${resto.length} siguen sin poder subir (mirá el motivo en la lista).`, 'amber');
      else showToast(resto.length ? `⚠ Ninguna pudo subir — revisá los motivos (o son de otro usuario de esta PC).` : 'Nada pendiente de subir.', resto.length ? 'red' : 'blue');
      reload();
    } catch (e) {
      showToast('Error: ' + (e?.message || e), 'red');
    } finally {
      setBusy(false);
    }
  };

  uES(() => { reload(); }, [reload]);

  const handleCancel = async (req) => {
    if (!confirm('¿Anular esta solicitud? El admin ya no la verá.')) return;
    setBusy(true);
    try {
      await cr.cancel(req.id);
      showToast('Solicitud cancelada', 'amber');
      reload();
    } catch (e) {
      showToast('Error: ' + (e?.message || e), 'red');
    } finally {
      setBusy(false);
    }
  };

  // applyChange callback: aplica los cambios al registro target.
  // Usa los hooks expuestos en window.__hooks. Lo más universal es
  // escribir directamente a Dexie + Supabase via las funciones update.
  // Aquí usamos un atajo: escribimos directo a Supabase y a Dexie local.
  const applyChange = async (req) => {
    const fields = {};
    let espejoDiferido = null;   // { espejo, patch, v } — se aplica tras el update principal
    for (const [k, v] of Object.entries(req.proposed_changes || {})) {
      if (k.startsWith('__')) continue;   // pedido descriptivo: no es columna real, el admin lo aplica a mano
      fields[k] = v && typeof v === 'object' && 'new' in v ? v.new : v;
    }

    // Coherencia: si se devuelve un trabajador a "Directo" (subcontratista_id
    // vacío), jefe y seguro del subcontrato dejan de aplicar → limpiarlos.
    // Igual que PersonalPage.handleSubmit cuando subId es null.
    if (req.target_table === 'personal' && 'subcontratista_id' in fields && !fields.subcontratista_id) {
      fields.subcontratista_id = null;
      fields.es_jefe_subcontrato = false;
      fields.seguro_a_cargo = null;
    }

    // Leer registro actual para oldData (si existe)
    let oldData = null;
    try {
      const local = await window.__db?.[req.target_table]?.get(req.target_record_id);
      if (local) oldData = local;
    } catch (e) {}
    if (!oldData) {
      try {
        const { data } = await window.__supabase
          .from(req.target_table)
          .select('*')
          .eq('id', req.target_record_id)
          .single();
        if (data) oldData = data;
      } catch (e) {}
    }

    // ── HOOK ESPECIAL: borrado de un movimiento de almacén ──
    // Aprobar una solicitud de eliminación debe correr el Eliminar unificado
    // (ajusta stock + revierte partida), no solo poner deleted_at. Si dejaría
    // stock negativo, lanza y la aprobación falla (queda pendiente).
    const MOV_TABLES = ['movimientos_materiales', 'movimientos_herramientas', 'movimientos_epp', 'movimientos_maquinaria', 'movimientos_insumos_emergencia'];
    if (MOV_TABLES.includes(req.target_table) && 'deleted_at' in fields && fields.deleted_at) {
      const { eliminarMovimientoCompleto } = await import('../lib/eliminar-movimiento.js');
      const userId = window.__currentUserId || 'admin-approval';
      await eliminarMovimientoCompleto({ tabla: req.target_table, movId: req.target_record_id, userId });
      return { oldData, newData: { deleted_at: fields.deleted_at } };
    }

    // ── HOOK ESPECIAL: cambio de partida_id en movimientos_materiales ──
    // Cuando un ingeniero pide reasignar una salida a otra partida, no
    // basta con UPDATE — hay que revertir el consumo de la partida vieja
    // y aplicarlo a la nueva (insumos_partida.cantidad_real_usada +
    // partidas.costo_real_acumulado). De lo contrario el costo queda mal.
    if (req.target_table === 'movimientos_materiales' && 'partida_id' in fields && oldData) {
      try {
        const [{ revertirConsumoPartida, aplicarConsumoPartida }] = await Promise.all([
          import('../lib/partida-allocation.js'),
        ]);
        const material = await window.__db.materiales.get(oldData.material_id);
        const userId = window.__currentUserId || 'admin-approval';
        // 1) revertir si la partida vieja existía
        if (oldData.partida_id) {
          await revertirConsumoPartida({ mov: oldData, partida_id: oldData.partida_id, material, userId });
        }
        // 2) aplicar a la nueva
        if (fields.partida_id) {
          await aplicarConsumoPartida({ mov: { ...oldData, ...fields }, partida_id: fields.partida_id, material, userId });
          // Si la salida estaba marcada como "general al frente", al asignarle una
          // partida real deja de ser general (evita el registro contradictorio).
          fields.vinculacion_general = false;
        }
      } catch (e) {
        console.warn('[solicitudes] no se pudo recalcular consumo partida:', e?.message);
      }
    }

    // ── HOOK ESPECIAL: cambio de `cantidad` en un movimiento de materiales ──
    // Editar la cantidad NO es un UPDATE plano: ajusta el stock del catálogo
    // (+ desglose por almacén) y, si es una salida imputada, el consumo de la
    // partida. Si dejaría stock negativo, lanza y la aprobación falla (queda
    // pendiente). Reutiliza el helper unificado (mismo criterio que el borrado).
    // Solo materiales: es el único tipo con trigger server-side en UPDATE de
    // cantidad (mig 112) → el stock no diverge al re-sincronizar.
    const MOV_CANT_TABLES = ['movimientos_materiales'];
    if (MOV_CANT_TABLES.includes(req.target_table) && 'cantidad' in fields) {
      const { editarCantidadMovimiento } = await import('../lib/eliminar-movimiento.js');
      const userId = window.__currentUserId || 'admin-approval';
      await editarCantidadMovimiento({ tabla: req.target_table, movId: req.target_record_id, nuevaCantidad: fields.cantidad, userId });
      return { oldData, newData: { cantidad: fields.cantidad } };
    }

    // ── HOOK ESPECIAL: VINCULACIÓN de una factura (obra / gastos generales /
    // contabilidad neta / sin clasificar). Solicitud ESTRUCTURADA de la
    // asistente contable — antes era un pedido descriptivo manual (21-jul).
    const _rawVinc = req.proposed_changes?.['__vinculacion_destino'];
    const _vincDestino = _rawVinc && typeof _rawVinc === 'object' && 'new' in _rawVinc ? _rawVinc.new : _rawVinc;
    if (req.target_table === 'accounting_movements' && _vincDestino) {
      const v = String(_vincDestino);
      if (v.startsWith('obra:')) { fields.obra_id = v.slice(5); fields.destino_contable = 'obra'; }
      else if (v === '__empresa__') { fields.obra_id = null; fields.destino_contable = 'gastos_generales'; }
      else if (v === '__otros__') { fields.obra_id = null; fields.destino_contable = 'contabilidad_neta'; }
      else if (v === '__nose__') { fields.obra_id = null; fields.destino_contable = 'sin_clasificar'; }
      // Propagar al ESPEJO intercompany AUTOMÁTICO (si existe): la compra espejo
      // nació con la MISMA obra que la venta — al cambiar la vinculación de la
      // factura, el espejo la sigue para que ambos lados del grupo queden
      // consistentes. Solo espejos AUTO (una compra registrada a mano por la
      // compradora puede tener legítimamente otra obra/destino).
      if (fields.destino_contable) {
        // Solo RESOLVER el espejo acá; la escritura se hace DESPUÉS de que el
        // update principal en Supabase tenga éxito (si ese update falla, la
        // solicitud sigue pendiente y el espejo NO debe haber cambiado).
        try {
          const movId = req.target_record_id;
          const candidatos = await window.__db.accounting_movements
            .filter(m => !m.deleted_at && m.id !== movId &&
              (m.related_movement_id === movId ||
               (oldData?.related_movement_id && m.id === oldData.related_movement_id)))
            .toArray();
          const espejo = candidatos.find(m => {
            try { return !!JSON.parse(m.notas || '{}')?.intercompany_auto; } catch { return false; }
          });
          if (espejo) espejoDiferido = { espejo, patch: { obra_id: fields.obra_id ?? null, destino_contable: fields.destino_contable }, v };
        } catch (e) { console.warn('[solicitudes] espejo vinculación:', e?.message); }
      }
    }

    // ── COHERENCIA clase / vinculación → `type` ──
    // `type` (income/cost/expense) NO se pide en la solicitud: se DERIVA de la
    // clase y de la vinculación con la misma lib que usan todos los puntos de
    // escritura (src/lib/clasificacion-contable.js). Va DESPUÉS del hook de
    // vinculación, que es el que escribe destino_contable/obra_id.
    // Sin esto: aprobar "pasá esta factura a Gastos Generales" dejaba la fila
    // contradictoria y el Estado de Resultados seguía contándola como costo.
    // ⚠ Necesita la fila COMPLETA (oldData): sin ella no se sabe si es
    //   intercompany, y marcar una interna como 'expense' rompe la eliminación
    //   del Consolidado. Sin oldData solo se resuelve el caso inequívoco (venta).
    if (req.target_table === 'accounting_movements'
        && ('clase' in fields || 'destino_contable' in fields || 'obra_id' in fields)) {
      if (oldData) fields.type = derivarTypeContable({ ...oldData, ...fields });
      else if (fields.clase === 'venta') fields.type = 'income';
    }

    // ── HOOK ESPECIAL: ELIMINAR la bancarización de una factura (la asistente
    // se confundió de constancia/monto). 'todas' borra todas las partes y las
    // constancias directas; 'ultima' solo la última parte. Libera saldo de
    // vouchers (el trigger del server ignora partes con deleted_at) y si la
    // factura >S/2,000 queda descubierta, vuelve a "Pendiente".
    const _rawBanc = req.proposed_changes?.['__banc_eliminar'];
    const _bancDel = _rawBanc && typeof _rawBanc === 'object' && 'new' in _rawBanc ? _rawBanc.new : _rawBanc;
    if (req.target_table === 'accounting_movements' && (_bancDel === 'todas' || _bancDel === 'ultima')) {
      const movId = req.target_record_id;
      const now = new Date().toISOString();
      const userId = window.__currentUserId || 'admin-approval';
      const { SYNC_STATUS } = await import('../db/jarvex.db');
      const partes = (await window.__db.pagos_partes.where('accounting_movement_id').equals(movId).filter(p => !p.deleted_at).toArray())
        .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
      const aBorrar = _bancDel === 'todas' ? partes : partes.slice(-1);
      for (const p of aBorrar) {
        if (!p.last_synced_at) {
          await window.__db.pagos_partes.delete(p.id); // nunca llegó al server
        } else {
          await window.__db.pagos_partes.update(p.id, { deleted_at: now, updated_at: now, updated_by: userId, sync_status: SYNC_STATUS.PENDING_UPDATE });
        }
      }
      if (_bancDel === 'todas') {
        // Constancias directas del movimiento: DELETE en server (RLS lo permite
        // al admin; si aprueba la contadora y el server lo rechaza, al menos
        // desaparecen de este dispositivo y el admin puede purgarlas después).
        const evs = await window.__db.evidencias.filter(e => e.modulo_relacionado === 'accounting_movements' && e.registro_relacionado_id === movId && e.tipo_evidencia === 'bancarizacion' && !e.deleted_at).toArray();
        for (const ev of evs) {
          try { await window.__supabase.from('evidencias').delete().eq('id', ev.id); } catch (e2) { console.warn('[solicitudes] delete evidencia server:', e2?.message); }
          try { await window.__db.evidencias.delete(ev.id); } catch {}
          try { await window.__db.evidencias_blobs.delete(ev.id); } catch {}
        }
      }
      const restantes = partes.filter(p => !aBorrar.includes(p)).reduce((t, p) => t + (Number(p.monto) || 0), 0);
      const monto = Number(oldData?.amount || 0);
      if (oldData && oldData.currency === 'PEN' && monto > 2000 && restantes < monto - 0.01 && oldData.payment_status === 'paid') {
        fields.payment_status = 'pending'; // quedó descubierta → vuelve a Pendiente
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'pagos_partes' } })); } catch {}
      try { window.dispatchEvent(new Event('online')); } catch {}
      if (Object.keys(fields).length === 0) {
        return { oldData, newData: { bancarizacion_eliminada: _bancDel, partes_eliminadas: aBorrar.length } };
      }
    }

    // ── HOOK ESPECIAL: ELIMINAR la DETRACCIÓN registrada (la asistente la subió por
    // error o la confundió con la bancarización). Borra la constancia
    // 'constancia_detraccion' y revierte los campos detraccion_* del movimiento.
    // La detracción NO usa pagos_partes ni payment_status, así que no los toca.
    const _rawDetr = req.proposed_changes?.['__detraccion_eliminar'];
    const _detrDel = _rawDetr && typeof _rawDetr === 'object' && 'new' in _rawDetr ? _rawDetr.new : _rawDetr;
    if (req.target_table === 'accounting_movements' && (_detrDel === 'si' || _detrDel === true || _detrDel === 'todas')) {
      const movId = req.target_record_id;
      const evs = await window.__db.evidencias.filter(e => e.modulo_relacionado === 'accounting_movements' && e.registro_relacionado_id === movId && e.tipo_evidencia === 'constancia_detraccion' && !e.deleted_at).toArray();
      for (const ev of evs) {
        try { await window.__supabase.from('evidencias').delete().eq('id', ev.id); } catch (e2) { console.warn('[solicitudes] delete constancia_detraccion server:', e2?.message); }
        try { await window.__db.evidencias.delete(ev.id); } catch {}
        try { await window.__db.evidencias_blobs.delete(ev.id); } catch {}
      }
      fields.detraccion_aplica = false;
      fields.detraccion_monto = null;
      fields.detraccion_pct = null;
      fields.detraccion_codigo = null;
      fields.detraccion_estado = null;
      fields.detraccion_constancia_fecha = null;
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'evidencias' } })); } catch {}
      try { window.dispatchEvent(new Event('online')); } catch {}
    }

    // Pedido descriptivo-only (sin columnas reales): nada que aplicar
    // automáticamente. Aprobar = acusar recibo; el admin hizo el cambio a mano.
    if (Object.keys(fields).length === 0) {
      return { oldData, newData: {} };
    }

    // Aplicar en Supabase
    const { error } = await window.__supabase
      .from(req.target_table)
      .update(fields)
      .eq('id', req.target_record_id);
    if (error) throw error;

    // Reflejar localmente en Dexie (si la tabla existe)
    try {
      if (window.__db?.[req.target_table]) {
        await window.__db[req.target_table].update(req.target_record_id, fields);
      }
    } catch (e) {}

    // Propagar la vinculación al ESPEJO intercompany automático — recién ahora,
    // con el update principal confirmado (misma obra/destino en ambos lados).
    if (espejoDiferido) {
      try {
        const { espejo, patch, v } = espejoDiferido;
        const { SYNC_STATUS } = await import('../db/jarvex.db');
        await window.__db.accounting_movements.update(espejo.id, {
          ...patch,
          // El espejo es intercompany → sigue siendo 'cost' (regla dura), pero
          // se re-deriva igual para no dejar el type a la deriva si algún día
          // el espejo dejara de ser interno.
          type: derivarTypeContable({ ...espejo, ...patch }),
          updated_at: new Date().toISOString(),
          updated_by: window.__currentUserId || 'admin-approval',
          version: (Number(espejo.version) || 1) + 1,
          sync_status: espejo.sync_status === SYNC_STATUS.PENDING_CREATE ? SYNC_STATUS.PENDING_CREATE : SYNC_STATUS.PENDING_UPDATE,
        });
        try { await window.__logAudit?.({ action:'update', table:'accounting_movements', recordId: espejo.id,
          reason:`Vinculación propagada desde la solicitud aprobada de su factura (${v})` }); } catch {}
      } catch (e) { console.warn('[solicitudes] espejo vinculación (post-update):', e?.message); }
    }

    return { oldData, newData: fields };
  };

  const handleApprove = async () => {
    if (!reviewing) return;
    setBusy(true);
    try {
      await cr.approve(reviewing.id, reviewComment, applyChange);
      showToast('Solicitud aprobada y aplicada', 'green');
      setReviewing(null); setReviewMode(null); setReviewComment('');
      reload();
    } catch (e) {
      showToast('Error: ' + (e?.message || e), 'red');
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!reviewing) return;
    if (!reviewComment || reviewComment.trim().length < 3) {
      showToast('Indica el motivo del rechazo (mín 3 caracteres)', 'red');
      return;
    }
    setBusy(true);
    try {
      await cr.reject(reviewing.id, reviewComment);
      showToast('Solicitud rechazada', 'amber');
      setReviewing(null); setReviewMode(null); setReviewComment('');
      reload();
    } catch (e) {
      showToast('Error: ' + (e?.message || e), 'red');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Solicitudes de Cambio</div>
          <div className="pg-sub">
            {(() => {
              const filtroActivo = q || fPersona || fTipo;
              const base = tab === 'pendientes'
                ? `${requests.length} solicitudes esperando revisión`
                : `${requests.length} solicitudes propias — las pendientes se pueden editar o anular`;
              return filtroActivo ? `${filtered.length} de ${base}` : base;
            })()}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={reload}>
            <JxIcon name="activity" size={13} />Recargar
          </button>
        </div>
      </div>

      {/* ⚠ ANTI-FANTASMA 1: solicitudes guardadas en ESTE dispositivo que nunca
          llegaron al server — el solicitante cree que las envió y el admin no
          las ve. Con motivo del fallo y botón para reintentar la subida. */}
      {colaLocal.length > 0 && (
        <div className="card" style={{ marginBottom: 14, padding: '12px 14px', background: 'rgba(231,76,60,0.07)', border: '1px solid rgba(231,76,60,0.35)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--red)' }}>
              ⚠ {colaLocal.length} solicitud(es) SIN SUBIR al servidor
            </span>
            <span style={{ fontSize: 11, color: 'var(--tm)' }}>Están solo en este dispositivo — el admin NO las ve todavía.</span>
            <button className="btn btn-amber btn-xs" style={{ marginLeft: 'auto' }} disabled={busy} onClick={subirColaLocal}>
              ⬆ {busy ? 'Subiendo…' : 'Subir ahora'}
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
            {colaLocal.map(c => (
              <div key={c.id} style={{ fontSize: 11, color: 'var(--ts)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '4px 6px', background: 'var(--bg-c2)', borderRadius: 4 }}>
                <span style={{ fontWeight: 600 }}>{c.label}</span>
                <span style={{ color: 'var(--tm)' }}>{window.__fecha?.fechaHoraLocalDe ? window.__fecha.fechaHoraLocalDe(c.created_at) : String(c.created_at || '').slice(0, 16).replace('T', ' ')}</span>
                {c.deOtroUsuario && <span className="badge b-amber" style={{ fontSize: 9 }} title={`La creó ${c.requester_email || 'otro usuario'} en esta PC — sube recién cuando esa persona vuelva a iniciar sesión acá`}>de otro usuario</span>}
                {c.error && <span style={{ color: 'var(--red)', fontSize: 10.5 }} title={c.error}>✗ {String(c.error).slice(0, 80)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ⚠ ANTI-FANTASMA 2: el server tiene MÁS pendientes que las que lista la
          bandeja (truncamiento por límite) — que el admin sepa que hay más. */}
      {tab === 'pendientes' && esRevisor && !loading && requests.length > 0 && pendTotalServer != null && pendTotalServer > requests.length && (
        <div className="card" style={{ marginBottom: 14, padding: '10px 14px', background: 'rgba(242,183,5,0.07)', border: '1px solid rgba(242,183,5,0.35)', fontSize: 12, color: 'var(--ts)' }}>
          ⚠ El servidor tiene <strong>{pendTotalServer}</strong> solicitudes pendientes pero la lista muestra <strong>{requests.length}</strong>. Las más antiguas no aparecen — usá el buscador o los filtros para encontrarlas, y resolvé/rechazá las viejas para destrabar la lista.
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, borderBottom: '1px solid var(--border)' }}>
        <button
          className={`btn btn-ghost btn-sm`}
          onClick={() => setTab('mias')}
          style={{
            borderRadius: 0,
            borderBottom: tab === 'mias' ? '2px solid var(--amber)' : '2px solid transparent',
            color: tab === 'mias' ? 'var(--amber)' : 'var(--tm)',
            fontWeight: tab === 'mias' ? 700 : 500,
          }}>
          <JxIcon name="user" size={13} /> Mis Solicitudes
        </button>
        {esRevisor && (
          <button
            className={`btn btn-ghost btn-sm`}
            onClick={() => setTab('pendientes')}
            style={{
              borderRadius: 0,
              borderBottom: tab === 'pendientes' ? '2px solid var(--amber)' : '2px solid transparent',
              color: tab === 'pendientes' ? 'var(--amber)' : 'var(--tm)',
              fontWeight: tab === 'pendientes' ? 700 : 500,
            }}>
            <JxIcon name="shield" size={13} /> Pendientes de Revisión
          </button>
        )}
        {esRevisor && (
          <button
            className={`btn btn-ghost btn-sm`}
            onClick={() => setTab('resueltas')}
            style={{
              borderRadius: 0,
              borderBottom: tab === 'resueltas' ? '2px solid var(--amber)' : '2px solid transparent',
              color: tab === 'resueltas' ? 'var(--amber)' : 'var(--tm)',
              fontWeight: tab === 'resueltas' ? 700 : 500,
            }}>
            <JxIcon name="checkCircle" size={13} /> Resueltas
          </button>
        )}
      </div>

      {/* Filtros extra del historial de RESUELTAS: estado + cuándo la pidieron
          + cuándo la resolviste (se suman al buscador y chips de persona/tipo). */}
      {tab === 'resueltas' && esRevisor && !loading && requests.length > 0 && (
        <div className="card card-p" style={{ marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5 }}>
          <select className="fi" style={{ minWidth: 140 }} value={fEstado} onChange={e => setFEstado(e.target.value)}>
            <option value="">✔✖ Aprobadas y rechazadas</option>
            <option value="aprobada">✔ Solo aprobadas</option>
            <option value="rechazada">✖ Solo rechazadas</option>
          </select>
          <span style={{ color: 'var(--tm)' }}>Pedida del</span>
          <input className="fi" type="date" value={fPedidaDesde} onChange={e => setFPedidaDesde(e.target.value)} style={{ width: 135 }} />
          <span style={{ color: 'var(--tm)' }}>al</span>
          <input className="fi" type="date" value={fPedidaHasta} onChange={e => setFPedidaHasta(e.target.value)} style={{ width: 135 }} />
          <span style={{ color: 'var(--tm)', marginLeft: 6 }}>· Resuelta del</span>
          <input className="fi" type="date" value={fResDesde} onChange={e => setFResDesde(e.target.value)} style={{ width: 135 }} />
          <span style={{ color: 'var(--tm)' }}>al</span>
          <input className="fi" type="date" value={fResHasta} onChange={e => setFResHasta(e.target.value)} style={{ width: 135 }} />
          {(fEstado || fPedidaDesde || fPedidaHasta || fResDesde || fResHasta) && (
            <button className="btn btn-ghost btn-xs" onClick={() => { setFEstado(''); setFPedidaDesde(''); setFPedidaHasta(''); setFResDesde(''); setFResHasta(''); }}>✕ Limpiar fechas</button>
          )}
        </div>
      )}

      {loading ? (
        <div className="card card-p empty-state">
          <JxIcon name="shield" size={32} color="var(--tm)" />
          <p>Cargando solicitudes…</p>
        </div>
      ) : requests.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="checkCircle" size={40} color="var(--tm)" />
          <p>{tab === 'pendientes' ? 'No hay solicitudes pendientes de revisión.'
            : tab === 'resueltas' ? 'Todavía no aprobaste ni rechazaste ninguna solicitud.'
            : 'Aún no has creado solicitudes de cambio.'}</p>
        </div>
      ) : (
        // ── Lista con BUSCADOR + CLASIFICACIÓN (por persona y por tipo) ──────
        <>
          <div className="card card-p" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: personas.length > 1 ? 10 : 0 }}>
              <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 180 }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', opacity: .55, display: 'flex' }}>
                  <JxIcon name="search" size={14} />
                </span>
                <input className="fi" style={{ paddingLeft: 30 }} placeholder="Buscar por persona, registro o motivo…"
                       value={q} onChange={e => setQ(e.target.value)} />
              </div>
              <select className="fi" style={{ flex: '0 1 220px' }} value={fTipo} onChange={e => setFTipo(e.target.value)}>
                <option value="">🗂 Todos los tipos</option>
                {tipos.map(([t, n]) => <option key={t} value={t}>{(TABLE_LABELS[t] || t)} ({n})</option>)}
              </select>
              {(q || fPersona || fTipo || fEstado || fPedidaDesde || fPedidaHasta || fResDesde || fResHasta) && (
                <button className="btn btn-ghost btn-sm" onClick={() => { setQ(''); setFPersona(''); setFTipo(''); setFEstado(''); setFPedidaDesde(''); setFPedidaHasta(''); setFResDesde(''); setFResHasta(''); }}>
                  <JxIcon name="x" size={12} /> Limpiar
                </button>
              )}
              <span style={{ fontSize: 11.5, color: 'var(--tm)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>{filtered.length} de {requests.length}</span>
            </div>
            {personas.length > 1 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--tm)', letterSpacing: '.06em', marginRight: 2, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <JxIcon name="users" size={12} /> PERSONA:
                </span>
                <button className={fPersona === '' ? 'btn btn-amber btn-xs' : 'btn btn-ghost btn-xs'} onClick={() => setFPersona('')}>
                  Todas ({requests.length})
                </button>
                {personas.map(([email, n]) => (
                  <button key={email} title={email}
                          className={fPersona === email ? 'btn btn-amber btn-xs' : 'btn btn-ghost btn-xs'}
                          onClick={() => setFPersona(p => p === email ? '' : email)}>
                    {email} ({n})
                  </button>
                ))}
              </div>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="card card-p empty-state">
              <JxIcon name="search" size={34} color="var(--tm)" />
              <p>Ningún resultado con estos filtros.</p>
              <button className="btn btn-ghost btn-sm" onClick={() => { setQ(''); setFPersona(''); setFTipo(''); setFEstado(''); setFPedidaDesde(''); setFPedidaHasta(''); setFResDesde(''); setFResHasta(''); }}>Limpiar filtros</button>
            </div>
          ) : (tab === 'pendientes' || tab === 'resueltas') && esRevisor ? (
        // ── REVISOR (admin / Contador Jefe): cards con diff. En 'pendientes' con
        //    botones de aprobar/rechazar; en 'resueltas' como HISTORIAL de lo ya
        //    decidido (cuándo la pidieron, cuándo la resolviste y tu comentario).
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
          {filtered.map(req => (
            <div key={req.id} className="card card-p">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tp)', marginBottom: 4 }}>
                    <span className="tag" style={{ marginRight: 6 }}>{TABLE_LABELS[req.target_table] || req.target_table}</span>
                    {req.target_record_label || <span style={{ color: 'var(--tm)' }}>(sin etiqueta)</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>
                    Solicita: <span style={{ color: 'var(--ts)' }}>{req.requester_email || '—'}</span> · {fmtDate(req.created_at)}
                    {req.reviewed_at && (
                      <> · {req.status === 'aprobada' ? '✔ Aprobada' : '✖ Rechazada'} el <span style={{ color: 'var(--ts)' }}>{fmtDate(req.reviewed_at)}</span></>
                    )}
                  </div>
                  {tab === 'resueltas' && req.reviewer_comment && (
                    <div style={{ fontSize: 11.5, color: 'var(--ts)', marginTop: 3, fontStyle: 'italic' }}>💬 Tu comentario: {req.reviewer_comment}</div>
                  )}
                </div>
                <span className={`badge ${(STATUS_BADGE[req.status] || STATUS_BADGE.pendiente).class}`}>{(STATUS_BADGE[req.status] || STATUS_BADGE.pendiente).label}</span>
              </div>

              <ContextoRegistro table={req.target_table} recordId={req.target_record_id} />

              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--tm)', letterSpacing: '.08em', marginBottom: 6 }}>CAMBIOS PROPUESTOS</div>
                <ChangeDiff changes={req.proposed_changes} />
              </div>

              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--tm)', letterSpacing: '.08em', marginBottom: 4 }}>MOTIVO</div>
                <div style={{ fontSize: 12.5, color: 'var(--ts)', lineHeight: 1.5 }}>{req.reason}</div>
              </div>

              {tab === 'pendientes' && (
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="btn btn-red btn-sm" disabled={busy}
                          onClick={() => { setReviewing(req); setReviewMode('reject'); setReviewComment(''); }}>
                    <JxIcon name="x" size={13} />Rechazar
                  </button>
                  <button className="btn btn-green btn-sm" disabled={busy}
                          onClick={() => { setReviewing(req); setReviewMode('approve'); setReviewComment(''); }}>
                    <JxIcon name="check" size={13} />Aprobar
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        // ── MIS SOLICITUDES: tabla ─────────────────────
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Fecha</th>
                <th>Tabla</th>
                <th>Registro</th>
                <th>Cambios</th>
                <th>Motivo</th>
                <th>Estado</th>
                <th>Comentario admin</th>
                <th style={{ textAlign: 'center' }}>Acciones</th>
              </tr></thead>
              <tbody>
                {filtered.map(req => {
                  const st = STATUS_BADGE[req.status] || STATUS_BADGE.pendiente;
                  return (
                    <tr key={req.id}>
                      <td className="col-m">{fmtDate(req.created_at)}</td>
                      <td><span className="tag">{TABLE_LABELS[req.target_table] || req.target_table}</span></td>
                      <td className="col-p">{req.target_record_label || '—'}</td>
                      <td><ChangeDiff changes={req.proposed_changes} /></td>
                      <td style={{ fontSize: 12, maxWidth: 220 }}>{req.reason}</td>
                      <td><span className={`badge ${st.class}`}>{st.label}</span></td>
                      <td style={{ fontSize: 11.5, color: 'var(--ts)', maxWidth: 200 }}>{req.reviewer_comment || '—'}</td>
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {req.status === 'pendiente' && req.requester_id === myId && (
                          <>
                            <button className="btn btn-ghost btn-xs" disabled={busy} title="Editar solicitud (valor propuesto / motivo)" onClick={() => setEditando(req)}>
                              <JxIcon name="edit" size={11} />
                            </button>
                            <button className="btn btn-ghost btn-xs" disabled={busy} title="Anular solicitud" style={{ color: 'var(--red)' }} onClick={() => handleCancel(req)}>
                              <JxIcon name="x" size={11} /> Anular
                            </button>
                          </>
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
        </>
      )}

      {/* Modal de edición de solicitud propia (solicitante) */}
      {editando && (
        <EditarSolicitudModal
          req={editando}
          showToast={showToast}
          onClose={() => setEditando(null)}
          onSaved={() => { setEditando(null); reload(); }}
        />
      )}

      {/* Modal de revisión (admin) */}
      {reviewing && reviewMode && (
        <Modal
          title={reviewMode === 'approve' ? 'Aprobar solicitud' : 'Rechazar solicitud'}
          icon={reviewMode === 'approve' ? 'checkCircle' : 'alertCircle'}
          onClose={() => { setReviewing(null); setReviewMode(null); setReviewComment(''); }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--tm)', marginBottom: 4 }}>Registro:</div>
            <div style={{ fontSize: 13, color: 'var(--tp)', fontWeight: 600 }}>
              {TABLE_LABELS[reviewing.target_table] || reviewing.target_table} · {reviewing.target_record_label || reviewing.target_record_id}
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--tm)', marginBottom: 4 }}>Cambios propuestos:</div>
            <ChangeDiff changes={reviewing.proposed_changes} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--tm)', marginBottom: 4 }}>Motivo del solicitante:</div>
            <div style={{ fontSize: 12.5, color: 'var(--ts)' }}>{reviewing.reason}</div>
          </div>

          <div>
            <label className="flabel">
              {reviewMode === 'approve' ? 'Comentario (opcional)' : 'Motivo del rechazo *'}
            </label>
            <textarea className="fi" rows={3}
                      placeholder={reviewMode === 'approve' ? 'Notas adicionales…' : 'Explica al solicitante por qué se rechaza…'}
                      value={reviewComment}
                      onChange={e => setReviewComment(e.target.value)} />
          </div>

          <div className="modal-actions">
            <button className="btn btn-ghost" disabled={busy}
                    onClick={() => { setReviewing(null); setReviewMode(null); setReviewComment(''); }}>
              Cancelar
            </button>
            {reviewMode === 'approve' ? (
              <button className="btn btn-green" disabled={busy} onClick={handleApprove}>
                <JxIcon name="check" size={13} />{busy ? 'Aplicando…' : 'Aprobar y aplicar'}
              </button>
            ) : (
              <button className="btn btn-red" disabled={busy} onClick={handleReject}>
                <JxIcon name="x" size={13} />{busy ? 'Rechazando…' : 'Confirmar rechazo'}
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── RequestChangeModal — modal compartido para "Solicitar Cambio" ───
// Recibe: { table, record, fields: [{key, label, type?, options?}], onClose, showToast, allowDelete? }
// Se usa desde Materiales / Herramientas / Personal / Proveedores.
// Si allowDelete=true, expone tab "Eliminar registro" que crea un change_request
// con proposed_changes.deleted_at — al aprobarlo, applyChange hace soft-delete.
function RequestChangeModal({ table, record, recordLabel, fields, onClose, showToast: showToastProp, allowDelete = false }) {
  // NINGÚN call site pasa showToast hoy → sin este fallback, enviar la
  // solicitud tiraba TypeError. Cae al toast global del shell.
  const showToast = showToastProp || window.__showToast || (() => {});
  // Escape hatch universal: si el campo que el usuario quiere cambiar NO está en
  // la lista (ej. foto, un dato no editable), elige "Otro dato" y lo describe en
  // el motivo. Así nunca se ve forzado a falsear un campo (el bug que veía el admin).
  const DESCRIPTIVE = { key: '__descripcion', label: 'Otro dato (lo describo en el motivo)', descriptive: true };
  const allFields = [...fields, DESCRIPTIVE];
  const [mode, setMode] = uSS('edit'); // 'edit' | 'delete'
  // Arranca SIN campo elegido (antes defaulteaba a fields[0] → el usuario que no
  // encontraba su campo dejaba el default y tecleaba un valor cualquiera).
  const [field, setField] = uSS('');
  const [newValue, setNewValue] = uSS('');
  const [reason, setReason] = uSS('');
  const [busy, setBusy] = uSS(false);

  const fieldDef = allFields.find(f => f.key === field) || null;
  const esDescriptivo = fieldDef?.descriptive === true;
  const oldValue = record?.[field];
  // Paso de CONFIRMACIÓN antes de enviar: la solicitante ve el diff exacto
  // ("pasará de X → Y") y confirma. Nació del caso real: se quería cambiar
  // 'VARILLA ... 7cm' → '...70cm' (agregar un 0) y llegó "nombre → 10" porque
  // el valor propuesto arrancaba VACÍO e invitaba a escribir "lo que cambia"
  // en vez del valor completo. Ahora el campo se PRE-LLENA con el valor actual
  // (se EDITA, no se re-escribe) y el diff se confirma antes de salir.
  const [confirmData, setConfirmData] = uSS(null); // null | { parsedNew }

  // Al elegir campo: pre-llenar el valor propuesto con el ACTUAL para editarlo
  // (solo campos de texto/número/fecha; los de opciones usan su select).
  const elegirCampo = (k) => {
    setField(k);
    setConfirmData(null);
    const def = allFields.find(f => f.key === k);
    if (!k || !def || def.descriptive || def.options) { setNewValue(''); return; }
    let v = record?.[k];
    if (v == null || v === '') { setNewValue(''); return; }
    if (def.type === 'date') v = String(v).slice(0, 10);
    setNewValue(String(v));
  };

  // Etiqueta legible de un valor (para campos con options: uuid → nombre).
  const labelDe = (v) => {
    if (!fieldDef?.options) return v == null ? null : String(v);
    const o = fieldDef.options.find(x => String(x.value ?? x) === String(v ?? ''));
    return o ? (o.label ?? o) : (v == null ? null : String(v));
  };

  // Algunos campos tienen una opción con value '' legítima (ej. subcontratista_id
  // → "Directo de la empresa"). En esos casos '' es una elección válida que
  // representa "vaciar" el campo, no "no elegí".
  const hasEmptyOption = fieldDef?.options?.some(o => (o.value ?? o) === '');

  // Aviso de stock negativo al solicitar la ELIMINACIÓN de un movimiento: si borrarlo
  // dejaría el stock del item en negativo, avisamos (no bloquea — el admin decide; a
  // veces también hay que borrar otro movimiento, ej. la entrada que compensa la salida).
  const [delWarn, setDelWarn] = uSS(null);
  uES(() => {
    let cancel = false;
    const MOV_CAT = { movimientos_materiales: 'materiales', movimientos_epp: 'epps', movimientos_insumos_emergencia: 'insumos_emergencia' };
    const cat = MOV_CAT[table];
    if (mode !== 'delete' || !cat || !record) { setDelWarn(null); return; }
    (async () => {
      try {
        const itemId = record.material_id || record.epp_id || record.insumo_emergencia_id;
        if (!itemId) { setDelWarn(null); return; }
        const item = await window.__db?.[cat]?.get(itemId);
        if (cancel || !item) return;
        const { stockTrasBorrar, dejaNegativo } = await import('../lib/stock-guard.js');
        const ns = stockTrasBorrar(item.stock_actual, record);
        setDelWarn(dejaNegativo(ns) ? { nuevoStock: ns, unidad: item.unidad || '' } : null);
      } catch { if (!cancel) setDelWarn(null); }
    })();
    return () => { cancel = true; };
  }, [mode, table, record]);

  // Envío real del cambio ESTRUCTURADO. Las etiquetas legibles (uuid → nombre de
  // frente / obra, etc.) van en oldLabel/newLabel para el diff del admin.
  const enviarPayload = async (parsedNew) => {
    setBusy(true);
    try {
      const r = await window.__changeRequests.create({
        table,
        recordId: record.id,
        recordLabel: recordLabel || record.id,
        // conOpciones marca que el valor salió de un SELECT: el editor de "Mis
        // Solicitudes" no debe ofrecerlo como texto libre (rompería la convención,
        // ej. unidad 'Par' → 'pares').
        proposedChanges: { [field]: { old: oldValue ?? null, new: parsedNew, label: fieldDef?.label || field, oldLabel: labelDe(oldValue), newLabel: labelDe(parsedNew), ...(fieldDef?.options ? { conOpciones: true } : {}) } },
        reason: reason.trim(),
      });
      // Honestidad: si solo se pudo encolar local (sin conexión / falló el server),
      // NO decir "enviada al admin" — la asistente creía haber enviado y nunca llegaba.
      if (r && r._pending) showToast('Guardada. Se enviará al admin apenas haya conexión.', 'amber');
      else showToast('Solicitud enviada al admin', 'green');
      onClose();
    } catch (e) {
      showToast('Error: ' + (e?.message || e), 'red');
    } finally {
      setBusy(false);
    }
  };

  const submitEdit = async () => {
    if (!field) { showToast('Selecciona el campo a modificar', 'red'); return; }
    if (!reason || reason.trim().length < 10) {
      showToast('El motivo debe tener al menos 10 caracteres', 'red'); return;
    }

    // Pedido DESCRIPTIVO: el campo no está en la lista. No se captura un valor
    // estructurado — el admin lee el motivo y lo aplica a mano al aprobar.
    if (esDescriptivo) {
      setBusy(true);
      try {
        const r = await window.__changeRequests.create({
          table,
          recordId: record.id,
          recordLabel: recordLabel || record.id,
          proposedChanges: { __descripcion: { old: null, new: reason.trim() } },
          reason: reason.trim(),
        });
        if (r && r._pending) showToast('Guardada. Se enviará al admin apenas haya conexión.', 'amber');
        else showToast('Solicitud enviada al admin', 'green');
        onClose();
      } catch (e) {
        showToast('Error: ' + (e?.message || e), 'red');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!hasEmptyOption && (newValue === '' || newValue === null || newValue === undefined)) {
      showToast('Indica el valor propuesto', 'red'); return;
    }

    let parsedNew = newValue;
    if (fieldDef?.type === 'number') parsedNew = parseFloat(newValue);
    // '' en un campo con opción-vacía = limpiar → null (no '', que rompería un FK uuid)
    if (newValue === '' && hasEmptyOption) parsedNew = null;

    // Guard anti-fantasma: el valor propuesto no puede ser igual al actual
    // (mataba la confianza del admin: solicitudes "fecha X → misma X").
    const oldStr = oldValue == null ? '' : String(oldValue);
    const newStr = parsedNew == null ? '' : String(parsedNew);
    if (oldStr === newStr) {
      showToast('El valor propuesto es igual al actual. Editalo o elegí "Otro dato".', 'red');
      return;
    }

    // Campos de LISTA (select): el valor sale de opciones cerradas → NO hay
    // riesgo de "valor parcial" (el motivo del paso de confirmación). Enviar
    // DIRECTO. Bug real: la vinculación de facturas es un select; la asistente
    // pulsaba "Revisar y enviar", veía la pantalla de confirmar y creía haber
    // enviado → cerraba y la solicitud NUNCA llegaba (0 llegaron en 4 días).
    if (fieldDef?.options) { await enviarPayload(parsedNew); return; }

    // Texto libre / número: sí mostrar el diff exacto antes de enviar.
    setConfirmData({ parsedNew });
  };

  // Envío tras confirmar el diff (solo texto libre / número).
  const enviarConfirmado = () => enviarPayload(confirmData?.parsedNew);

  const submitDelete = async () => {
    if (!reason || reason.trim().length < 10) {
      showToast('El motivo debe tener al menos 10 caracteres', 'red'); return;
    }
    setBusy(true);
    try {
      const r = await window.__changeRequests.create({
        table,
        recordId: record.id,
        recordLabel: recordLabel || record.id,
        proposedChanges: { deleted_at: { old: null, new: new Date().toISOString() } },
        reason: reason.trim(),
      });
      if (r && r._pending) showToast('Guardada. Se enviará al admin apenas haya conexión.', 'amber');
      else showToast('Solicitud de eliminación enviada al admin', 'green');
      onClose();
    } catch (e) {
      showToast('Error: ' + (e?.message || e), 'red');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={mode === 'delete' ? 'Solicitar Eliminación' : 'Solicitar Cambio'} icon={mode === 'delete' ? 'trash' : 'alert'} onClose={onClose}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--tm)', marginBottom: 4 }}>Registro:</div>
        <div style={{ fontSize: 13, color: 'var(--tp)', fontWeight: 600 }}>{recordLabel || record?.id}</div>
      </div>

      {allowDelete && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
          <button
            type="button"
            className={mode === 'edit' ? 'btn btn-amber btn-sm' : 'btn btn-ghost btn-sm'}
            onClick={() => setMode('edit')}
            disabled={busy}
          >
            <JxIcon name="edit" size={12} /> Modificar campo
          </button>
          <button
            type="button"
            className={mode === 'delete' ? 'btn btn-red btn-sm' : 'btn btn-ghost btn-sm'}
            onClick={() => setMode('delete')}
            disabled={busy}
          >
            <JxIcon name="trash" size={12} /> Solicitar eliminación
          </button>
        </div>
      )}

      {mode === 'edit' && confirmData ? (
        // ── Paso 2: CONFIRMACIÓN — la solicitante ve el diff exacto y confirma ──
        (() => {
          const oldStr = oldValue == null ? '' : String(oldValue);
          const newStr = confirmData.parsedNew == null ? '' : String(confirmData.parsedNew);
          const esTextoLibre = !fieldDef?.type && !fieldDef?.options;
          const warnCorto = esTextoLibre && oldStr.length >= 8 && newStr.length > 0 && newStr.length < oldStr.length * 0.5;
          return (
            <div>
              <div style={{ fontSize: 12.5, color: 'var(--ts)', marginBottom: 10 }}>Revisá que el cambio sea EXACTAMENTE lo que querés pedir:</div>
              <div style={{ background: 'var(--bg-s)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--tm)', marginBottom: 8 }}>{fieldDef?.label || field}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 13 }}>
                  <span style={{ background: 'rgba(231,76,60,0.1)', border: '1px solid rgba(231,76,60,0.25)', color: 'var(--red)', padding: '4px 10px', borderRadius: 6, textDecoration: 'line-through' }}>{labelDe(oldValue) ?? '—'}</span>
                  <span style={{ color: 'var(--tm)' }}>→</span>
                  <span style={{ background: 'rgba(46,204,113,0.1)', border: '1px solid rgba(46,204,113,0.25)', color: 'var(--green)', padding: '4px 10px', borderRadius: 6, fontWeight: 600 }}>{labelDe(confirmData.parsedNew) ?? '—'}</span>
                </div>
              </div>
              {warnCorto && (
                <div style={{ background: 'rgba(242,183,5,0.10)', border: '1px solid rgba(242,183,5,0.35)', borderRadius: 6, padding: 10, marginBottom: 10, fontSize: 12, color: 'var(--ts)' }}>
                  <strong style={{ color: 'var(--amber)' }}>⚠ El valor nuevo es mucho más corto que el actual.</strong>
                  <div style={{ marginTop: 4 }}>Recordá que esto reemplaza el campo <strong>completo</strong>. Si solo querías corregir una parte (ej. agregar un número), volvé con "Corregir" y editá el valor entero.</div>
                </div>
              )}
              <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>Motivo: <span style={{ color: 'var(--ts)' }}>{reason}</span></div>
            </div>
          );
        })()
      ) : mode === 'edit' ? (
        <div className="g2">
          <div>
            <label className="flabel">Campo a modificar *</label>
            <select className="fi" value={field} onChange={e => elegirCampo(e.target.value)}>
              <option value="">— Selecciona el campo —</option>
              {allFields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </div>
          {field && !esDescriptivo && (
            <div>
              <label className="flabel">Valor actual</label>
              <input className="fi" disabled value={
                fieldDef?.options
                  ? (fieldDef.options.find(o => String(o.value ?? o) === String(oldValue ?? ''))?.label ?? (oldValue == null ? '—' : String(oldValue)))
                  : (oldValue == null ? '—' : String(oldValue))
              } />
            </div>
          )}
          {field && !esDescriptivo && (
            <div style={{ gridColumn: '1/-1' }}>
              <label className="flabel">Valor propuesto *</label>
              {fieldDef?.options ? (
                <select className="fi" value={newValue} onChange={e => setNewValue(e.target.value)}>
                  {!hasEmptyOption && <option value="">— Selecciona —</option>}
                  {fieldDef.options.map(o => (
                    <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
                  ))}
                </select>
              ) : (
                <>
                  <input
                    className="fi"
                    type={fieldDef?.type === 'number' ? 'number' : fieldDef?.type === 'date' ? 'date' : 'text'}
                    step={fieldDef?.type === 'number' ? '0.01' : undefined}
                    placeholder="Valor completo del campo"
                    value={newValue}
                    onChange={e => setNewValue(e.target.value)}
                  />
                  {!fieldDef?.type && (
                    <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 4, lineHeight: 1.4 }}>
                      Este valor <strong>reemplaza el campo completo</strong>: editá arriba lo que necesites cambiar (no escribas solo la parte nueva).
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {esDescriptivo && (
            <div style={{ gridColumn: '1/-1', background: 'rgba(242,183,5,0.08)', border: '1px solid rgba(242,183,5,0.25)', borderRadius: 6, padding: '9px 12px', fontSize: 12, color: 'var(--ts)' }}>
              Describí abajo, en el <strong>Motivo</strong>, exactamente qué necesitás cambiar (qué campo y a qué valor). El admin lo revisará y lo aplicará manualmente.
            </div>
          )}
          <div style={{ gridColumn: '1/-1' }}>
            <label className="flabel">Motivo * (mín. 10 caracteres)</label>
            <textarea className="fi" rows={3} placeholder="Explica por qué este registro debe cambiar…"
                      value={reason} onChange={e => setReason(e.target.value)} />
          </div>
        </div>
      ) : (
        <div>
          <div style={{ background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.25)', borderRadius: 6, padding: 10, marginBottom: 12, fontSize: 12, color: 'var(--ts)' }}>
            <strong style={{ color: 'var(--red)' }}>⚠ Solicitud de eliminación</strong>
            <div style={{ marginTop: 4 }}>El registro quedará marcado como eliminado (soft-delete) cuando el admin apruebe. Los movimientos históricos no se ven afectados.</div>
          </div>
          {delWarn && (
            <div style={{ background: 'rgba(242,183,5,0.10)', border: '1px solid rgba(242,183,5,0.35)', borderRadius: 6, padding: 10, marginBottom: 12, fontSize: 12, color: 'var(--ts)' }}>
              <strong style={{ color: 'var(--amber)' }}>⚠ Ojo con el stock</strong>
              <div style={{ marginTop: 4 }}>
                Borrar SOLO este movimiento dejaría el stock en <strong>{Number(delWarn.nuevoStock)} {delWarn.unidad}</strong> (negativo). Si te equivocaste de movimiento, probablemente también tengas que borrar el otro que lo compensa (ej. la entrada que va con esta salida). Podés enviar la solicitud igual — el admin decidirá; pero avisale para que los apruebe juntos.
              </div>
            </div>
          )}
          <label className="flabel">Motivo de la eliminación * (mín. 10 caracteres)</label>
          <textarea className="fi" rows={3} placeholder="Explica por qué este registro debe eliminarse…"
                    value={reason} onChange={e => setReason(e.target.value)} />
        </div>
      )}

      <div className="modal-actions">
        {mode === 'edit' && confirmData ? (
          <>
            <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirmData(null)}>← Corregir</button>
            <button className="btn btn-amber" disabled={busy} onClick={enviarConfirmado}>
              <JxIcon name="check" size={13} />{busy ? 'Enviando…' : 'Confirmar y enviar'}
            </button>
          </>
        ) : mode === 'delete' ? (
          <>
            <button className="btn btn-ghost" disabled={busy} onClick={onClose}>Cancelar</button>
            <button className="btn btn-red" disabled={busy} onClick={submitDelete}>
              <JxIcon name="trash" size={13} />{busy ? 'Enviando…' : 'Enviar Solicitud de Eliminación'}
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-ghost" disabled={busy} onClick={onClose}>Cancelar</button>
            <button className="btn btn-amber" disabled={busy} onClick={submitEdit}>
              <JxIcon name="check" size={13} />{busy ? 'Enviando…' : ((esDescriptivo || fieldDef?.options) ? 'Enviar Solicitud' : 'Revisar y enviar')}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

Object.assign(window, { SolicitudesPage, RequestChangeModal });
