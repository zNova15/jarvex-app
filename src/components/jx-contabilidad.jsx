import React from "react";
import { sugerirCuentaPcge } from "../lib/sugerir-cuenta-pcge.js";
import { getEvidenciaSrc } from "../lib/evidencias-url.js";
import { getCurrentMode } from "../lib/app-mode-core.js";
import { usePagination } from "../hooks/usePagination.js";
import { TablePagination } from "./jx-pagination.jsx";
import { detectarDuplicados, claseDe } from "../lib/dedupe-movs-contables.js";
import { cmpComprobante } from "../lib/comparar-comprobante.js";
import { resumenRecepcion, rankearIngresosParaItem, rankearFacturasParaIngreso, itemsDeFactura, estadoRecepcionDeItems, parseNotas, referenciaSinCostos, reporteRecepcion } from "../lib/cruce-recepcion.js";
import { ConsultasPanel, useConsultasResumen } from "./jx-consultas.jsx";
import { crearConsulta } from "../lib/consultas-puente.js";
import { candidatosSinIngreso, poolParaVenta, vendidosVenta, estadoConsultaItem } from "../lib/insumos-venta.js";
import { validarVinculoDeposito, saldoDeposito, parMovimiento, parDeposito, mismoPar, movimientoBancarizado, TOL } from "../lib/depositos-bancarizacion.js";
import { useChart } from "../lib/chart-loader.js";
import { FusionEntidadModal } from "./jx-fusion-entidad.jsx";
const { useState: uSC, useMemo: uMC, useEffect: uEC, useRef: uRC } = React;

// Etiqueta humana de un mes 'YYYY-MM' → 'Junio 2026' (filtro de período).
const MESES_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const mesLabel = (ym) => { const [y, m] = String(ym || '').split('-'); return `${MESES_ES[Number(m) - 1] || m || '?'} ${y || ''}`.trim(); };

// ─── Gráfica genérica (Chart.js lazy via useChart) ───────────────────
// Se reconstruye sólo cuando cambia `sig` (firma de los datos), no en cada render.
function ChartCanvas({ type, data, options, sig, height = 240 }) {
  const Chart = useChart();
  const ref = uRC(null);
  const inst = uRC(null);
  uEC(() => {
    if (!Chart || !ref.current) return;
    if (inst.current) { inst.current.destroy(); inst.current = null; }
    inst.current = new Chart(ref.current, { type, data, options });
    return () => { if (inst.current) { inst.current.destroy(); inst.current = null; } };
  }, [Chart, sig]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div style={{ height }}><canvas ref={ref} /></div>;
}
// Paleta y estilos consistentes con el tema oscuro (Chart.js no lee CSS vars).
const CHART_GREEN = 'rgba(46,204,113,0.72)', CHART_RED = 'rgba(231,76,60,0.72)', CHART_AMBER = 'rgba(242,183,5,0.72)', CHART_BLUE = 'rgba(74,144,226,1)';
const CHART_AXIS = {
  x: { ticks: { color: '#5A6A7A', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' }, border: { display: false } },
  y: { ticks: { color: '#5A6A7A', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' }, border: { display: false } },
};
const CHART_LEGEND = { labels: { color: '#7A8A9A', font: { size: 11 }, boxWidth: 12, padding: 14 } };
const nombreMes = (ym) => { const [y, m] = (ym || '').split('-'); return ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][Number(m) - 1] + ' ' + String(y).slice(2); };

// ─── Helpers de formato ──────────────────────────────────────
const fmtCur = (n, currency = 'PEN') => {
  const symbol = currency === 'USD' ? 'USD ' : 'S/ ';
  return symbol + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtCurK = (n, currency = 'PEN') => {
  const v = Number(n || 0);
  const symbol = currency === 'USD' ? 'USD ' : 'S/ ';
  if (Math.abs(v) >= 1e6) return symbol + (v / 1e6).toFixed(2) + 'M';
  if (Math.abs(v) >= 1e3) return symbol + (v / 1e3).toFixed(0) + 'K';
  return symbol + v.toFixed(0);
};

const TYPE_LABEL = { income: 'Ingreso', cost: 'Costo', expense: 'Gasto' };
const TYPE_COLOR = { income: 'var(--green)', cost: 'var(--red)', expense: 'var(--amber)' };
const TYPE_BADGE = { income: 'b-green', cost: 'b-red', expense: 'b-amber' };
const STATUS_BADGE = { paid: 'b-green', pending: 'b-amber', credit: 'b-blue', cancelled: 'b-gray' };
const STATUS_LABEL = { paid: 'Pagado', pending: 'Pendiente', credit: 'Crédito', cancelled: 'Anulado' };
const COMPANY_TYPES = [
  { v: 'constructora', label: 'Constructora' },
  { v: 'comercial',    label: 'Comercializadora' },
  { v: 'servicios',    label: 'Servicios' },
  { v: 'maquinaria',   label: 'Maquinaria' },
  { v: 'inmobiliaria', label: 'Inmobiliaria' },
  { v: 'otro',         label: 'Otro' },
];

// Rubro / giro principal — define qué vende la empresa al grupo y al exterior.
// Sirve para sugerir cadenas de trazabilidad (ej: una "importadora_acero" puede
// abastecer a una "distribuidora_materiales" la cual abastece a la "ejecutora").
const RUBROS = [
  { v: 'importadora_acero',      label: 'Importadora · Acero / Fierro',     fam: 'acero' },
  { v: 'importadora_cemento',    label: 'Importadora · Cemento / Aglomerantes', fam: 'cemento' },
  { v: 'importadora_general',    label: 'Importadora · General',            fam: 'general' },
  { v: 'distribuidora_materiales', label: 'Distribuidora de Materiales',    fam: 'materiales' },
  { v: 'ferreteria',             label: 'Ferretería',                       fam: 'materiales' },
  { v: 'transporte',             label: 'Transporte / Flete',               fam: 'transporte' },
  { v: 'alquiler_maquinaria',    label: 'Alquiler de Maquinaria',           fam: 'maquinaria' },
  { v: 'venta_maquinaria',       label: 'Venta de Maquinaria',              fam: 'maquinaria' },
  { v: 'mano_obra',              label: 'Mano de Obra / Subcontratos',      fam: 'mano_obra' },
  { v: 'supervision',            label: 'Supervisión / Consultoría',        fam: 'servicios' },
  { v: 'estudios_proyectos',     label: 'Estudios y Proyectos',             fam: 'servicios' },
  { v: 'ejecutora_obra',         label: 'Ejecutora de Obra (contratista)',  fam: 'ejecutora' },
  { v: 'contratista_general',    label: 'Contratista General',              fam: 'ejecutora' },
  { v: 'inmobiliaria',           label: 'Inmobiliaria',                     fam: 'inmobiliaria' },
  { v: 'otro',                   label: 'Otro',                             fam: 'otro' },
];

// Rol de la empresa dentro del grupo del usuario (clave para trazabilidad).
const ROLES_GRUPO = [
  { v: 'origen',        label: 'Origen (compra a terceros y distribuye al grupo)' },
  { v: 'intermediaria', label: 'Intermediaria (revende dentro del grupo con margen)' },
  { v: 'ejecutora',     label: 'Ejecutora (firma contrato con cliente final)' },
  { v: 'mixta',         label: 'Mixta (cumple varios roles)' },
];

const REGIMENES = [
  { v: 'NRUS', label: 'NRUS · Nuevo RUS' },
  { v: 'RER',  label: 'RER · Régimen Especial' },
  { v: 'RMT',  label: 'RMT · Régimen MYPE Tributario' },
  { v: 'RG',   label: 'RG · Régimen General' },
];
const OP_TYPES = [
  { v: 'materiales', label: 'Venta de materiales' },
  { v: 'servicio',   label: 'Servicio' },
  { v: 'alquiler',   label: 'Alquiler' },
  { v: 'maquinaria', label: 'Alquiler de maquinaria' },
  { v: 'mano_obra',  label: 'Mano de obra' },
  { v: 'otro',       label: 'Otro' },
];

// ╔════════════════════════════════════════════════════════════╗
// ║  EMPRESAS PAGE                                             ║
// ╚════════════════════════════════════════════════════════════╝
function EmpresasPage({ showToast }) {
  const auth = window.__useAuth?.();
  const myRol = auth?.profile?.rol;
  const isAdmin = myRol === 'admin';
  const userId = auth?.profile?.id ?? 'offline';
  const canWrite = isAdmin || (window.__hasPerm?.(myRol, 'Empresas', 'w') ?? false);
  const { data: companies } = window.__hooks.useCompanies();
  const { data: movs } = window.__hooks.useAccountingMovements();
  const { data: obras } = window.__hooks.useObras?.() || { data: [] };

  // Roles efectivos por empresa derivados dinámicamente del estado de las obras.
  // Una empresa es "ejecutora" en una obra si está asignada como ejecutora_company_id
  // o aparece en consorcio_miembros. Para el resto (proveedora interna), se infiere
  // por aparecer como eslabón en cadenas de trazabilidad — pero por ahora solo
  // mostramos las obras donde es ejecutora (caso más común).
  const rolesPorObra = uMC(() => {
    const map = new Map(); // company_id → [{ obra_id, nombre, rol }]
    (obras || []).forEach(o => {
      if (o.deleted_at) return;
      const addRol = (cid, rol) => {
        if (!cid) return;
        if (!map.has(cid)) map.set(cid, []);
        map.get(cid).push({ obra_id: o.id, nombre: o.nombre_obra, rol });
      };
      if (o.ejecutora_tipo === 'consorcio' && Array.isArray(o.consorcio_miembros)) {
        o.consorcio_miembros.forEach(m => addRol(m.company_id, 'miembro_consorcio'));
      } else if (o.ejecutora_company_id) {
        addRol(o.ejecutora_company_id, 'ejecutora');
      }
    });
    return map;
  }, [obras]);

  const [modal, setModal] = uSC(null); // null | 'nueva' | 'editar'
  const [editingId, setEditingId] = uSC(null);
  const [fusionOpen, setFusionOpen] = uSC(false);
  const [form, setForm] = uSC({});
  // Cuántas empresas comparten RUC (para el badge del botón de fusión).
  const dupsRuc = uMC(() => {
    const m = new Map();
    (companies || []).forEach(c => { if (c.deleted_at) return; const r = String(c.ruc || '').replace(/\D/g, ''); if (r.length >= 8) m.set(r, (m.get(r) || 0) + 1); });
    return [...m.values()].filter(n => n > 1).length;
  }, [companies]);
  // Último lookup SUNAT (para mostrar panel diagnóstico con todos los datos extraídos)
  const [sunatData, setSunatData] = uSC(null);
  const [sunatLoading, setSunatLoading] = uSC(false);

  const resumenes = uMC(() => {
    const map = new Map();
    (movs || []).forEach(m => {
      const r = map.get(m.company_id) || { ingresos:0, costos:0, gastos:0 };
      const amt = Number(m.amount || 0);
      if (m.type === 'income')  r.ingresos += amt;
      if (m.type === 'cost')    r.costos += amt;
      if (m.type === 'expense') r.gastos += amt;
      map.set(m.company_id, r);
    });
    return map;
  }, [movs]);

  const openNueva = () => {
    setForm({
      name:'', legal_name:'', ruc:'', company_type:'constructora', status:'activa', notas:'',
      rubro:'otro', rol_grupo:'mixta', regimen_tributario:'RG', margen_objetivo_pct:'',
      mostrar_torpedo: true,
      direccion:'', telefono:'', email:'', representante_legal:'', inicio_actividades:'',
      actividades_economicas: [],
      logo_dataurl: null, nombre_corto: '', codigo_doc_prefix: '',
    });
    setEditingId(null);
    setModal('nueva');
  };
  const openEditar = (c) => {
    setForm({
      name: c.name || '',
      legal_name: c.legal_name || '',
      ruc: c.ruc || '',
      company_type: c.company_type || 'otro',
      status: c.status || 'activa',
      notas: c.notas || '',
      rubro: c.rubro || 'otro',
      mostrar_torpedo: c.mostrar_torpedo !== false,
      rol_grupo: c.rol_grupo || 'mixta',
      regimen_tributario: c.regimen_tributario || 'RG',
      margen_objetivo_pct: c.margen_objetivo_pct ?? '',
      direccion: c.direccion || '',
      telefono: c.telefono || '',
      email: c.email || '',
      representante_legal: c.representante_legal || '',
      inicio_actividades: c.inicio_actividades || '',
      actividades_economicas: Array.isArray(c.actividades_economicas) ? c.actividades_economicas : [],
      logo_dataurl: c.logo_dataurl || null,
      nombre_corto: c.nombre_corto || '',
      codigo_doc_prefix: c.codigo_doc_prefix || '',
    });
    setEditingId(c.id);
    setModal('editar');
  };

  const guardar = async () => {
    if (!form.name?.trim()) { showToast('Nombre requerido', 'red'); return; }
    const now = new Date().toISOString();
    try {
      if (editingId) {
        const orig = companies.find(c => c.id === editingId);
        await window.__db.companies.update(editingId, {
          name: form.name.trim(),
          legal_name: form.legal_name?.trim() || null,
          ruc: form.ruc?.trim() || null,
          company_type: form.company_type,
          status: form.status,
          notas: form.notas?.trim() || null,
          rubro: form.rubro || null,
          mostrar_torpedo: form.mostrar_torpedo !== false,   // mig 156: torpedo del portal de campo
          rol_grupo: form.rol_grupo || null,
          regimen_tributario: form.regimen_tributario || null,
          margen_objetivo_pct: form.margen_objetivo_pct === '' || form.margen_objetivo_pct == null
            ? null : Number(form.margen_objetivo_pct),
          direccion: form.direccion?.trim() || null,
          telefono: form.telefono?.trim() || null,
          email: form.email?.trim() || null,
          representante_legal: form.representante_legal?.trim() || null,
          inicio_actividades: form.inicio_actividades || null,
          actividades_economicas: Array.isArray(form.actividades_economicas) ? form.actividades_economicas : [],
          logo_dataurl: form.logo_dataurl || null,
          nombre_corto: form.nombre_corto?.trim() || null,
          codigo_doc_prefix: form.codigo_doc_prefix?.trim() || null,
          updated_at: now, updated_by: userId,
          version: (orig?.version ?? 0) + 1,
          sync_status: orig?.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
        try { await window.__logAudit?.({ action:'update', table:'companies', recordId:editingId, oldData:orig, newData:form, reason:'Edición empresa' }); } catch {}
        showToast(`Empresa "${form.name}" actualizada`, 'green');
      } else {
        const id = window.__newId();
        const rec = {
          id,
          name: form.name.trim(),
          legal_name: form.legal_name?.trim() || null,
          ruc: form.ruc?.trim() || null,
          company_type: form.company_type,
          status: form.status,
          notas: form.notas?.trim() || null,
          rubro: form.rubro || null,
          mostrar_torpedo: form.mostrar_torpedo !== false,   // mig 156: torpedo del portal de campo
          rol_grupo: form.rol_grupo || null,
          regimen_tributario: form.regimen_tributario || null,
          margen_objetivo_pct: form.margen_objetivo_pct === '' || form.margen_objetivo_pct == null
            ? null : Number(form.margen_objetivo_pct),
          direccion: form.direccion?.trim() || null,
          telefono: form.telefono?.trim() || null,
          email: form.email?.trim() || null,
          representante_legal: form.representante_legal?.trim() || null,
          inicio_actividades: form.inicio_actividades || null,
          actividades_economicas: Array.isArray(form.actividades_economicas) ? form.actividades_economicas : [],
          logo_dataurl: form.logo_dataurl || null,
          nombre_corto: form.nombre_corto?.trim() || null,
          codigo_doc_prefix: form.codigo_doc_prefix?.trim() || null,
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_companies_${id}`,
        };
        await window.__db.companies.add(rec);
        try { await window.__logAudit?.({ action:'insert', table:'companies', recordId:id, newData:rec, reason:'Nueva empresa' }); } catch {}
        showToast(`Empresa "${form.name}" creada`, 'green');
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'companies' } })); } catch {}
      try { window.dispatchEvent(new Event('online')); } catch {}
      setModal(null); setEditingId(null); setForm({});
    } catch (e) {
      showToast('Error: ' + (e.message || e), 'red');
    }
  };

  const eliminar = async (c) => {
    if (!isAdmin) return;
    // Anti-FANTASMA: si la empresa tiene movimientos contables, desactivarla dejaría
    // esos movimientos con empresa "—" (no se ve el nombre ni se puede filtrar). No
    // permitir; primero hay que reasignar/eliminar esos movimientos.
    const conMovs = (movs || []).filter(m => !m.deleted_at && (m.company_id === c.id || m.related_company_id === c.id)).length;
    if (conMovs > 0) {
      showToast(`No se puede desactivar "${c.name}": tiene ${conMovs} movimiento(s) contable(s) asociado(s). Reasigná o eliminá esos movimientos primero (o dejala activa) para no dejar facturas "fantasma".`, 'red');
      return;
    }
    if (!confirm(`¿Desactivar la empresa "${c.name}"?\n\nLos movimientos contables NO se borran. Solo se marca como inactiva.`)) return;
    try {
      await window.__db.companies.update(c.id, {
        deleted_at: new Date().toISOString(),
        sync_status: c.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
      });
      try { await window.__logAudit?.({ action:'delete', table:'companies', recordId:c.id, oldData:c, reason:'Desactivación empresa' }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'companies' } })); } catch {}
      showToast(`Empresa "${c.name}" desactivada`, 'amber');
    } catch (e) { showToast('Error: ' + (e.message||e), 'red'); }
  };

  const sorted = uMC(() => [...(companies || [])].sort((a,b) => (a.name||'').localeCompare(b.name||'')), [companies]);

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Empresas</div>
          <div className="pg-sub">{sorted.length} empresas registradas · {sorted.filter(c=>c.status==='activa').length} activas</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isAdmin && (
            <button className="btn btn-ghost btn-sm" onClick={() => setFusionOpen(true)} title="Fusionar empresas duplicadas (mismo RUC)">
              <JxIcon name="compare" size={13}/>Fusionar{dupsRuc > 0 ? <span className="badge b-amber" style={{ marginLeft: 6, fontSize: 9 }}>{dupsRuc}</span> : ''}
            </button>
          )}
          {canWrite ? (
            <button className="btn btn-amber btn-sm" onClick={openNueva}>
              <JxIcon name="plus" size={13}/>Nueva Empresa
            </button>
          ) : (
            <span className="badge b-gray" title="Tu rol es solo lectura para Empresas">Solo lectura</span>
          )}
        </div>
      </div>
      {fusionOpen && <FusionEntidadModal tipo="companies" registros={companies} showToast={showToast} onClose={() => setFusionOpen(false)} onDone={() => {}} />}

      {sorted.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="building" size={40} color="var(--tm)"/>
          <p>No hay empresas registradas. Crea la primera para empezar a registrar movimientos contables.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <div style={{ overflowX:'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Empresa</th><th>RUC</th><th>Rubro · Rol</th>
                <th style={{ textAlign:'right' }}>Margen</th>
                <th style={{ textAlign:'right' }}>Ingresos</th>
                <th style={{ textAlign:'right' }}>Costos</th>
                <th style={{ textAlign:'right' }}>Utilidad</th>
                <th>Estado</th>
                {isAdmin && <th style={{ textAlign:'center' }}>Acciones</th>}
              </tr></thead>
              <tbody>
                {sorted.map(c => {
                  const r = resumenes.get(c.id) || { ingresos:0, costos:0, gastos:0 };
                  const utilidad = r.ingresos - r.costos - r.gastos;
                  const rubroLabel = RUBROS.find(t => t.v === c.rubro)?.label || (COMPANY_TYPES.find(t => t.v === c.company_type)?.label || '—');
                  const rolLabel = ROLES_GRUPO.find(rr => rr.v === c.rol_grupo)?.label?.split('(')[0]?.trim() || '—';
                  const rolBadge = c.rol_grupo === 'origen' ? 'b-blue'
                    : c.rol_grupo === 'intermediaria' ? 'b-amber'
                    : c.rol_grupo === 'ejecutora' ? 'b-green' : 'b-gray';
                  const obrasDeRol = rolesPorObra.get(c.id) || [];
                  const obrasEjecutora = obrasDeRol.filter(x => x.rol === 'ejecutora' || x.rol === 'miembro_consorcio');
                  return (
                    <tr key={c.id}>
                      <td className="col-p">
                        <strong>{c.name}</strong>
                        {c.legal_name && <div style={{ fontSize:11, color:'var(--tm)' }}>{c.legal_name}</div>}
                        {c.regimen_tributario && <div style={{ fontSize:10, color:'var(--tm)', marginTop:2 }}>{c.regimen_tributario}</div>}
                      </td>
                      <td className="col-m">{c.ruc || '—'}</td>
                      <td>
                        <div style={{ fontSize:11.5 }}>{rubroLabel}</div>
                        <span className={`badge ${rolBadge}`} style={{ marginTop:3, fontSize:10 }}>Global: {rolLabel}</span>
                        {obrasEjecutora.length > 0 && (
                          <div style={{ marginTop:4, fontSize:10, color:'var(--green)' }} title={obrasEjecutora.map(x => x.nombre).join('\n')}>
                            ✓ Ejecutora en {obrasEjecutora.length} obra{obrasEjecutora.length !== 1 ? 's' : ''}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign:'right', color: c.margen_objetivo_pct ? 'var(--amber)' : 'var(--tm)' }} className="col-num">
                        {c.margen_objetivo_pct != null ? `${Number(c.margen_objetivo_pct).toFixed(1)}%` : '—'}
                      </td>
                      <td style={{ textAlign:'right' }} className="col-num">{fmtCurK(r.ingresos)}</td>
                      <td style={{ textAlign:'right' }} className="col-num">{fmtCurK(r.costos)}</td>
                      <td style={{ textAlign:'right', fontWeight:700, color: utilidad>=0?'var(--green)':'var(--red)' }} className="col-num">{fmtCurK(utilidad)}</td>
                      <td><span className={`badge ${c.status==='activa'?'b-green':'b-gray'}`}>{c.status}</span></td>
                      {isAdmin && (
                        <td style={{ textAlign:'center', whiteSpace:'nowrap' }}>
                          <button className="btn btn-ghost btn-xs" title="Editar" onClick={()=>openEditar(c)}>
                            <JxIcon name="edit" size={11}/>
                          </button>
                          <button className="btn btn-red btn-xs" title="Desactivar" onClick={()=>eliminar(c)} style={{ marginLeft:4 }}>
                            <JxIcon name="trash" size={11}/>
                          </button>
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

      {(modal === 'nueva' || modal === 'editar') && (
        <Modal title={editingId ? 'Editar Empresa' : 'Nueva Empresa'} icon="building" onClose={()=>{setModal(null); setEditingId(null); setSunatData(null);}}>
          <div className="g2">
            <div style={{ gridColumn:'1/-1' }}>
              <label className="flabel">Nombre comercial *</label>
              <input className="fi" placeholder="Ej: Constructora Nova" value={form.name||''} onChange={e=>setForm({...form, name:e.target.value})}/>
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <label className="flabel">Razón social</label>
              <input className="fi" placeholder="Ej: NOVA CONSTRUCCIONES S.A.C." value={form.legal_name||''} onChange={e=>setForm({...form, legal_name:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">RUC</label>
              <div style={{ display:'flex', gap:6 }}>
                <input className="fi" placeholder="11 dígitos" maxLength={11} value={form.ruc||''}
                  onChange={e=>{ setForm({...form, ruc:e.target.value.replace(/\D/g,'').slice(0,11)}); setSunatData(null); }}
                  style={{ flex:1 }}/>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  title="Buscar datos en SUNAT por este RUC"
                  disabled={!/^\d{11}$/.test(String(form.ruc || ''))}
                  onClick={async () => {
                    setSunatLoading(true);
                    try {
                      const data = await window.__identity.consultarRUC(form.ruc);
                      setSunatData(data);
                      setForm(prev => ({
                        ...prev,
                        legal_name: data.razonSocial || prev.legal_name || '',
                        name: prev.name || data.razonSocial || '',
                        // Si decolecta no devolvió dirección literal, usamos la
                        // armada del fallback (distrito/provincia/dpto).
                        direccion: data.direccion || prev.direccion || '',
                        rubro: data.rubroSugerido || prev.rubro || 'otro',
                        inicio_actividades: data.fechaInicioActividades || prev.inicio_actividades || '',
                        // El campo notas queda libre para el usuario; las
                        // actividades van a su propio campo.
                        actividades_economicas: data.actividadesEconomicas?.length
                          ? data.actividadesEconomicas
                          : (prev.actividades_economicas || []),
                      }));
                      const detalles = [];
                      if (data.direccion) detalles.push('dirección ✓');
                      if (data.actividadesEconomicas?.length) detalles.push(`${data.actividadesEconomicas.length} actividad(es)`);
                      if (data.rubroSugerido) detalles.push(`rubro: ${data.rubroSugerido}`);
                      const extra = detalles.length ? ` · ${detalles.join(' · ')}` : '';
                      showToast(`SUNAT: ${data.razonSocial || 'datos cargados'}${extra}`, 'green');
                    } catch (e) {
                      showToast(e.message || 'Error consultando SUNAT', 'red');
                    } finally { setSunatLoading(false); }
                  }}
                  style={{ whiteSpace:'nowrap' }}>
                  <JxIcon name="search" size={12}/> {sunatLoading ? '...' : 'SUNAT'}
                </button>
              </div>
            </div>
            {/* Panel diagnóstico SUNAT */}
            {sunatData && (
              <div style={{ gridColumn:'1/-1', padding:'10px 12px', background:'rgba(46,204,113,0.06)', border:'1px solid rgba(46,204,113,0.25)', borderRadius:8, fontSize:11.5 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:6 }}>
                  <div style={{ fontWeight:700, color:'var(--green)' }}>✓ SUNAT respondió</div>
                  <div style={{ fontSize:10, color:'var(--tm)', fontFamily:'monospace' }}>{sunatData._source || '?'}</div>
                </div>
                {sunatData._source && !sunatData._source.includes('decolecta') && (
                  <div style={{ fontSize:11, color:'var(--amber)', marginBottom:6, padding:'6px 8px', background:'rgba(242,183,5,0.08)', borderRadius:6 }}>
                    ⚠ Estás usando v1 (sin token). Para que aparezca el rubro, agregá <code>DECOLECTA_TOKEN</code> en Vercel y forzá redeploy.
                  </div>
                )}
                <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:'2px 10px', color:'var(--ts)' }}>
                  <span style={{ color:'var(--tm)' }}>Razón social:</span><span>{sunatData.razonSocial || '—'}</span>
                  <span style={{ color:'var(--tm)' }}>Dirección:</span><span>{sunatData.direccion || '— (no devuelta)'}</span>
                  <span style={{ color:'var(--tm)' }}>Estado:</span><span>{sunatData.estado || '—'} · {sunatData.condicion || '—'}</span>
                  {sunatData.actividadEconomica && (<>
                    <span style={{ color:'var(--tm)' }}>Actividad:</span><span style={{ fontSize:11 }}>{sunatData.actividadEconomica}</span>
                  </>)}
                  {sunatData.rubroSugerido && (<>
                    <span style={{ color:'var(--tm)' }}>Rubro auto:</span><span style={{ color:'var(--amber)', fontWeight:600 }}>{sunatData.rubroSugerido} (aplicado)</span>
                  </>)}
                  {sunatData.fechaInicioActividades && (<>
                    <span style={{ color:'var(--tm)' }}>Inicio activ.:</span><span>{sunatData.fechaInicioActividades}</span>
                  </>)}
                </div>
                {!sunatData.actividadEconomica && (
                  <div style={{ marginTop:6, fontSize:10.5, color:'var(--tm)' }}>
                    <em>Esta API no devolvió actividad económica. Probablemente el token decolecta no está activo en Vercel.</em>
                  </div>
                )}
              </div>
            )}
            <div>
              <label className="flabel">Tipo de empresa</label>
              <select className="fi" value={form.company_type||'otro'} onChange={e=>setForm({...form, company_type:e.target.value})}>
                {COMPANY_TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="flabel">Estado</label>
              <select className="fi" value={form.status||'activa'} onChange={e=>setForm({...form, status:e.target.value})}>
                <option value="activa">Activa</option>
                <option value="inactiva">Inactiva</option>
              </select>
            </div>

            {/* ── Trazabilidad: Rubro + Rol en el grupo ─────────────── */}
            <div style={{ gridColumn:'1/-1', marginTop:6, fontSize:11, color:'var(--amber)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', borderTop:'1px dashed var(--border)', paddingTop:10 }}>
              Trazabilidad — define qué hace y qué lugar ocupa en tu grupo
            </div>
            <div>
              <label className="flabel">Rubro / giro principal</label>
              <select className="fi" value={form.rubro||'otro'} onChange={e=>setForm({...form, rubro:e.target.value})}>
                {RUBROS.map(r => <option key={r.v} value={r.v}>{r.label}</option>)}
              </select>
              <div style={{ fontSize:10, color:'var(--tm)', marginTop:3 }}>Sirve para sugerir cadenas (ej: importadora → distribuidora → ejecutora).</div>
              {/* Mig 156: el admin ELIGE qué empresas salen en el torpedo de RUCs
                  del portal de captura de campo (pedido de Gabriel, 31-ago). */}
              <label style={{ display:'flex', alignItems:'center', gap:6, marginTop:8, fontSize:11.5, cursor:'pointer' }}>
                <input type="checkbox" checked={form.mostrar_torpedo !== false}
                  onChange={e=>setForm({...form, mostrar_torpedo: e.target.checked})}/>
                📸 Mostrar en el portal de campo (tabla "¿A qué RUC pido la factura?")
              </label>
            </div>
            <div>
              <label className="flabel">Rol en el grupo</label>
              <select className="fi" value={form.rol_grupo||'mixta'} onChange={e=>setForm({...form, rol_grupo:e.target.value})}>
                {ROLES_GRUPO.map(r => <option key={r.v} value={r.v}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label className="flabel">Régimen tributario</label>
              <select className="fi" value={form.regimen_tributario||'RG'} onChange={e=>setForm({...form, regimen_tributario:e.target.value})}>
                {REGIMENES.map(r => <option key={r.v} value={r.v}>{r.label}</option>)}
              </select>
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <label className="flabel" style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span>Actividades económicas</span>
                <button type="button" className="btn btn-ghost btn-xs"
                  onClick={()=>{
                    const arr = [...(form.actividades_economicas || []), ''];
                    setForm({...form, actividades_economicas: arr});
                  }}>
                  <JxIcon name="plus" size={10}/> Agregar
                </button>
              </label>
              {(form.actividades_economicas || []).length === 0 ? (
                <div className="fi" style={{ color:'var(--tm)', fontSize:11.5, fontStyle:'italic' }}>
                  Sin actividades. Hacé SUNAT lookup para autorrellenar, o agregalas manualmente.
                </div>
              ) : (
                (form.actividades_economicas || []).map((act, i) => (
                  <div key={i} style={{ display:'flex', gap:6, marginBottom:6, alignItems:'center' }}>
                    <span style={{ fontSize:10.5, color:'var(--amber)', fontWeight:700, minWidth:80 }}>
                      {i === 0 ? 'PRINCIPAL' : `SECUND. ${i}`}
                    </span>
                    <input className="fi" value={act}
                      placeholder={i === 0 ? 'Actividad principal del CIIU' : 'Actividad secundaria'}
                      onChange={e=>{
                        const arr = [...(form.actividades_economicas || [])];
                        arr[i] = e.target.value;
                        setForm({...form, actividades_economicas: arr});
                      }} style={{ flex:1, fontSize:11 }}/>
                    <button type="button" className="btn btn-ghost btn-xs"
                      onClick={()=>{
                        const arr = (form.actividades_economicas || []).filter((_, idx) => idx !== i);
                        setForm({...form, actividades_economicas: arr});
                      }}>
                      <JxIcon name="x" size={10}/>
                    </button>
                  </div>
                ))
              )}
              <div style={{ fontSize:10, color:'var(--tm)', marginTop:3 }}>
                Decolecta plan free devuelve solo la actividad principal. Para secundarias: agregalas manualmente o pagá un plan superior.
              </div>
            </div>
            <div>
              <label className="flabel">Margen objetivo (%)</label>
              <input className="fi" type="number" min="0" max="200" step="0.1"
                placeholder="Ej: 20"
                value={form.margen_objetivo_pct ?? ''}
                onChange={e=>setForm({...form, margen_objetivo_pct:e.target.value})}/>
              <div style={{ fontSize:10, color:'var(--tm)', marginTop:3 }}>% de markup por defecto cuando esta empresa revende dentro del grupo.</div>
            </div>

            {/* ── Datos de contacto / SUNAT ──────────────────────── */}
            <div style={{ gridColumn:'1/-1', marginTop:6, fontSize:11, color:'var(--amber)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', borderTop:'1px dashed var(--border)', paddingTop:10 }}>
              Datos formales
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <label className="flabel">Dirección fiscal</label>
              <input className="fi" value={form.direccion||''} onChange={e=>setForm({...form, direccion:e.target.value})} placeholder="Auto-rellenado por SUNAT"/>
            </div>
            <div>
              <label className="flabel">Teléfono</label>
              <input className="fi" value={form.telefono||''} onChange={e=>setForm({...form, telefono:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Email</label>
              <input className="fi" type="email" value={form.email||''} onChange={e=>setForm({...form, email:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Representante legal</label>
              <input className="fi" value={form.representante_legal||''} onChange={e=>setForm({...form, representante_legal:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Inicio de actividades</label>
              <input className="fi" type="date" value={form.inicio_actividades||''} onChange={e=>setForm({...form, inicio_actividades:e.target.value})}/>
            </div>

            <div style={{ gridColumn:'1/-1', padding:'14px 14px 10px', background:'rgba(242,183,5,0.05)', border:'1px dashed rgba(242,183,5,0.25)', borderRadius:8 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--amber)', marginBottom:8, textTransform:'uppercase', letterSpacing:0.3 }}>
                Branding para plantillas imprimibles
              </div>
              <div style={{ fontSize:11, color:'var(--tm)', marginBottom:10, lineHeight:1.5 }}>
                Cuando esta empresa es la ejecutora de una obra, las plantillas PDF (entrega de EPPs, asistencia, ingresos/salidas) usan este logo y nombre en vez de "JARVEX".
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'140px 1fr', gap:14, alignItems:'flex-start' }}>
                <div style={{ textAlign:'center' }}>
                  {form.logo_dataurl ? (
                    <div style={{ background:'#fff', borderRadius:6, padding:8, marginBottom:6, minHeight:80, display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <img src={form.logo_dataurl} alt="logo" style={{ maxHeight:70, maxWidth:120, objectFit:'contain' }}/>
                    </div>
                  ) : (
                    <div style={{ background:'rgba(0,0,0,0.2)', borderRadius:6, padding:'24px 8px', marginBottom:6, fontSize:10, color:'var(--tm)' }}>
                      Sin logo
                    </div>
                  )}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    id="empresa-logo-input"
                    style={{ display:'none' }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 2 * 1024 * 1024) {
                        showToast('Logo demasiado grande — máximo 2MB. Comprimilo antes de subir.', 'red');
                        e.target.value = '';
                        return;
                      }
                      // Re-encode a JPEG max 320x320 para que el dataURL pese poco
                      try {
                        const url = await new Promise((res, rej) => {
                          const r = new FileReader();
                          r.onload = () => res(r.result);
                          r.onerror = rej;
                          r.readAsDataURL(file);
                        });
                        const img = new Image();
                        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
                        const maxDim = 320;
                        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
                        const w = Math.round(img.width * scale);
                        const h = Math.round(img.height * scale);
                        const canvas = document.createElement('canvas');
                        canvas.width = w; canvas.height = h;
                        const ctx = canvas.getContext('2d');
                        // Fondo blanco — los logos suelen ser PNG con transparencia, y al
                        // imprimir en PDF queda raro sobre fondo blanco si no se aplana.
                        ctx.fillStyle = '#FFFFFF';
                        ctx.fillRect(0, 0, w, h);
                        ctx.drawImage(img, 0, 0, w, h);
                        const compressed = canvas.toDataURL('image/jpeg', 0.85);
                        setForm({ ...form, logo_dataurl: compressed });
                      } catch (err) {
                        showToast('Error procesando imagen: ' + (err.message || err), 'red');
                      }
                      e.target.value = '';
                    }}
                  />
                  <div style={{ display:'flex', gap:6, flexDirection:'column' }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={()=>document.getElementById('empresa-logo-input').click()}>
                      <JxIcon name="upload" size={11}/> {form.logo_dataurl ? 'Cambiar' : 'Subir logo'}
                    </button>
                    {form.logo_dataurl && (
                      <button type="button" className="btn btn-ghost btn-sm" style={{ color:'var(--red)' }} onClick={()=>setForm({...form, logo_dataurl: null})}>
                        Quitar
                      </button>
                    )}
                  </div>
                </div>
                <div style={{ display:'grid', gap:10 }}>
                  <div>
                    <label className="flabel">Nombre corto para plantillas (opcional)</label>
                    <input className="fi" value={form.nombre_corto||''} placeholder={form.name || 'Ej: CONSORCIO EL INCA'} maxLength={80} onChange={e=>setForm({...form, nombre_corto:e.target.value})}/>
                    <div style={{ fontSize:10, color:'var(--tm)', marginTop:3 }}>Si está vacío, se usa "{form.name || 'Razón social'}".</div>
                  </div>
                  <div>
                    <label className="flabel">Código de formato (opcional)</label>
                    <input className="fi" value={form.codigo_doc_prefix||''} placeholder="Ej: F-SSO-05" maxLength={20} onChange={e=>setForm({...form, codigo_doc_prefix:e.target.value})}/>
                    <div style={{ fontSize:10, color:'var(--tm)', marginTop:3 }}>Aparece arriba a la derecha en la plantilla de EPPs.</div>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ gridColumn:'1/-1' }}>
              <label className="flabel">Notas</label>
              <textarea className="fi" rows={2} value={form.notas||''} onChange={e=>setForm({...form, notas:e.target.value})}/>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>{setModal(null); setEditingId(null);}}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardar}>
              <JxIcon name="check" size={13}/>{editingId ? 'Guardar Cambios' : 'Crear Empresa'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ╔════════════════════════════════════════════════════════════╗
// ║  MOVIMIENTOS CONTABLES PAGE                               ║
// ╚════════════════════════════════════════════════════════════╝
function MovimientosContablesPage({ showToast }) {
  const auth = window.__useAuth?.();
  const myRol = auth?.profile?.rol;
  const isAdmin = myRol === 'admin';
  const userId = auth?.profile?.id ?? 'offline';
  const canWrite = isAdmin || (window.__hasPerm?.(myRol, 'Movs. Contables', 'w') ?? false);
  // El Ayudante de Contabilidad PUEDE crear y enlazar compras, pero NO editar/borrar
  // movimientos existentes → para un cambio usa "Solicitar cambio". El Contador Jefe
  // (y admin) sí editan directo.
  const esAyudante = myRol === 'ayudante_contador';
  const canCreate = canWrite;
  const canEditExisting = isAdmin || (canWrite && !esAyudante);
  const { data: companies } = window.__hooks.useCompanies();
  const { data: movs } = window.__hooks.useAccountingMovements();
  const { data: obras } = window.__hooks.useObras();

  // Obras a las que el usuario está asignado (para enlazar la compra/factura a la obra).
  // Admin/gerente ven todas; el resto, solo sus obras (obra_usuarios). Sin asignación = todas.
  const [misObrasIds, setMisObrasIds] = uSC(null);
  uEC(() => {
    const verTodas = isAdmin || myRol === 'gerente';
    if (verTodas || !userId || userId === 'offline') { setMisObrasIds(null); return; }
    let cancel = false;
    (async () => {
      try {
        const sb = window.__supabase;
        if (!sb) { setMisObrasIds(null); return; }
        const { data, error } = await sb.from('obra_usuarios')
          .select('obra_id').eq('usuario_id', userId).eq('activo', true);
        if (cancel || error) return;
        const ids = (data || []).map(r => r.obra_id);
        setMisObrasIds(ids.length ? new Set(ids) : null);
      } catch {}
    })();
    return () => { cancel = true; };
  }, [userId, myRol, isAdmin]);
  const obrasParaSelector = uMC(() => {
    const vivas = (obras || []).filter(o => !o.deleted_at);
    return misObrasIds ? vivas.filter(o => misObrasIds.has(o.id)) : vivas;
  }, [obras, misObrasIds]);
  const obraNombre = (id) => (obras || []).find(o => o.id === id)?.nombre_obra || null;

  // Ámbito en DOS filtros independientes (pedido de la asistente: poder
  // filtrar por obra Y empresa A LA VEZ, no un solo desplegable combinado).
  // En el workspace de una obra (window.__plano==='obra') la obra arranca
  // scopeada a la activa; en la Contabilidad general ambos arrancan en 'todas'.
  const [filtroObraSel, setFiltroObraSel] = uSC(() => {
    const o = window.__getObraActivaId?.();
    return (window.__plano === 'obra' && o) ? o : 'todas';
  });
  const [filtroEmpresaSel, setFiltroEmpresaSel] = uSC('todas');
  const [filtroClase, setFiltroClase] = uSC('todos');
  const [filtroTipo, setFiltroTipo] = uSC('todos');
  const [filtroEstado, setFiltroEstado] = uSC('todos');
  const [filtroEmisor, setFiltroEmisor] = uSC('todos');     // quién EMITIÓ el comprobante
  const [filtroReceptor, setFiltroReceptor] = uSC('todos'); // quién lo RECIBIÓ
  const [busqueda, setBusqueda] = uSC('');
  // Período: un MES puntual ("¿puedo ver solo los comprobantes de Junio?") o un
  // rango personalizado desde/hasta. 'todos' = sin filtro de fecha.
  const [filtroMes, setFiltroMes] = uSC('todos');   // 'todos' | 'YYYY-MM' | 'custom'
  const [filtroDesde, setFiltroDesde] = uSC('');
  const [filtroHasta, setFiltroHasta] = uSC('');
  const [modal, setModal] = uSC(null);
  const [editingId, setEditingId] = uSC(null);
  const [form, setForm] = uSC({});
  const [solicitarTarget, setSolicitarTarget] = uSC(null); // mov para "Solicitar cambio" (ayudante)
  // Subir bancarización SIN entrar a editar (lo puede hacer el ayudante de
  // contabilidad: editar es solo de admin/contador jefe, pero adjuntar la
  // bancarización es una evidencia, no una edición del movimiento).
  const [bancTarget, setBancTarget] = uSC(null);   // movimiento al que se le sube la bancarización
  const [bancFile, setBancFile] = uSC(null);
  // Bancarización EN PARTES: monto/método/n° operación de ESTA constancia
  // (un pago de S/7,000 puede bancarizarse en 3 transferencias: 900+3200+2900).
  const [bancMonto, setBancMonto] = uSC('');
  const [bancMetodo, setBancMetodo] = uSC('transferencia');
  const [bancRef, setBancRef] = uSC('');
  const [partesPorMov, setPartesPorMov] = uSC(() => new Map());   // mov_id → [{monto,...}]
  const [guiasPorMov, setGuiasPorMov] = uSC(() => new Map());      // mov_id → [guias]
  const [bancObra, setBancObra] = uSC('');
  const [bancSaving, setBancSaving] = uSC(false);
  const [soloSinBanc, setSoloSinBanc] = uSC(false); // filtro: ver solo los que faltan bancarización
  // DEPÓSITOS multi-factura: un depósito de p.ej. 20,000 cubre facturas de
  // 3,000+7,000+10,000 del mismo pagador→cobrador, consumiendo saldo.
  const [depositos, setDepositos] = uSC([]);                            // depósitos vivos
  const [partesPorDeposito, setPartesPorDeposito] = uSC(() => new Map()); // deposito_id → [partes]
  const [bancPorDeposito, setBancPorDeposito] = uSC(() => new Map());     // deposito_id → evidencia (constancia)
  const [bancModo, setBancModo] = uSC('exacto');     // 'exacto' (Caso 1) | 'parcial' (Caso 3) | 'dep_nuevo' / 'dep_existente' (Caso 2)
  const [bancTotalDep, setBancTotalDep] = uSC('');   // monto TOTAL del depósito nuevo
  const [bancDepId, setBancDepId] = uSC('');         // depósito existente elegido

  // Evidencias adjuntas a movs contables (factura PDF/imagen guardada
  // por Captura Mágica). Map<accId, {url, mime}>. Cuando la contadora
  // entra a verificar, ve un botón 👁️ para abrir el archivo.
  const [evidenciasPorMov, setEvidenciasPorMov] = uSC(() => new Map());
  const [bancarizacionPorMov, setBancarizacionPorMov] = uSC(() => new Map()); // tipo_evidencia='bancarizacion'
  const [evidenciaModal, setEvidenciaModal] = uSC(null); // { url, mime, nombre }
  // Puente CONTABILIDAD → ALMACÉN: "¿llegó?" — buscar los ingresos que respaldan
  // las líneas de una factura y vincularlos en 1 clic (mismo motor determinista).
  const [llegoTarget, setLlegoTarget] = uSC(null);   // { factura, grupos:[{idx,item,candidatos}] }
  const [buscandoLlego, setBuscandoLlego] = uSC(false);
  const vincLlegoRef = uRC(false);                    // guard SÍNCRONO anti-doble-click
  // Fase 2 — hilo de consultas con almacén.
  const [showConsultas, setShowConsultas] = uSC(false);
  const consResumen = useConsultasResumen('contabilidad', null);
  // 🏷 Insumos para VENTA (jefa de contabilidad): ítems facturados que nunca
  // ingresaron a obra → comprobar con almacén → separar → vincular la venta.
  const [showVenta, setShowVenta] = uSC(false);
  const [consultasVenta, setConsultasVenta] = uSC([]);   // puente_consultas (para leer respuestas)
  uEC(() => {
    if (!showVenta) return;
    let cancel = false;
    const load = async () => {
      try {
        const rows = await window.__db.puente_consultas.filter(c => !c.deleted_at && c.accounting_movement_id).toArray();
        if (!cancel) setConsultasVenta(rows);
      } catch {}
    };
    load();
    const on = (e) => { const t = e?.detail?.tabla; if (!t || t === 'puente_consultas') load(); };
    window.addEventListener('jx_data_changed', on);
    return () => { cancel = true; window.removeEventListener('jx_data_changed', on); };
  }, [showVenta]);
  // Fase 3 — reporte de recepción por insumo (lee items_factura[].recibido/destino).
  const [showReporte, setShowReporte] = uSC(false);
  const [reporteTab, setReporteTab] = uSC('insumo');
  const [repQ, setRepQ] = uSC('');
  const reporte = uMC(() => reporteRecepcion((movs || []).filter(m =>
    (filtroObraSel === 'todas' || m.obra_id === filtroObraSel) &&
    (filtroEmpresaSel === 'todas' || m.company_id === filtroEmpresaSel)
  )), [movs, filtroObraSel, filtroEmpresaSel]);
  // Detracción (SPOT): la asistente registra el depósito (constancia del Banco de
  // la Nación) y marca 'depositada'. Aplica a compras y ventas, sobre el mismo mov.
  const [detraccionPorMov, setDetraccionPorMov] = uSC(() => new Map()); // tipo_evidencia='constancia_detraccion'
  const [detrTarget, setDetrTarget] = uSC(null);
  const [detrFile, setDetrFile] = uSC(null);
  const [detrAplica, setDetrAplica] = uSC(true);

  // ── "¿llegó?" — buscar ingresos de almacén que respalden las líneas de una factura ──
  // Corre el matcher determinista (rankearIngresosParaItem) por cada línea NO resuelta
  // contra los ingresos (entradas) de la obra aún sin factura, ya replicados en Dexie.
  const buscarIngresos = async (facArg) => {
    setLlegoTarget({ factura: facArg, grupos: [] });
    setBuscandoLlego(true);
    try {
      const fac = (await window.__db.accounting_movements.get(facArg.id).catch(() => null)) || facArg;
      const notas = parseNotas(fac.notas);
      const items = Array.isArray(notas.items_factura) ? notas.items_factura : [];
      const ingresosRaw = (await window.__db.movimientos_materiales.toArray().catch(() => []))
        .filter(mm => !mm.deleted_at && mm.tipo_movimiento === 'entrada'
          && (fac.obra_id ? mm.obra_id === fac.obra_id : true)
          && !mm.accounting_movement_id);
      const matIds = [...new Set(ingresosRaw.map(m => m.material_id).filter(Boolean))];
      const mats = await window.__db.materiales.bulkGet(matIds).catch(() => []);
      const nombrePorId = new Map();
      (mats || []).forEach(m => m && nombrePorId.set(m.id, m.nombre_material));
      const ingresos = ingresosRaw.map(mm => ({
        id: mm.id, material_id: mm.material_id, materialNombre: nombrePorId.get(mm.material_id) || '',
        cantidad: mm.cantidad, unidad: mm.unidad, fecha: mm.fecha,
        obra_id: mm.obra_id, proveedor_id: mm.proveedor_id || null, _mov: mm,
      }));
      const ctx = { proveedor_id: fac.proveedor_id, third_party_name: fac.third_party_name, obra_id: fac.obra_id, fecha: fac.date };
      const noResuelto = (it) => !(it.rechazado || it.tipo_insumo === 'servicio'
        || ['empresa', 'obra_general'].includes(it.destino)
        || (Number(it.recibido) || 0) >= (Number(it.cantidad) || 0) - 0.0001);
      const grupos = items
        .map((item, idx) => ({ idx, item }))
        .filter(g => noResuelto(g.item))
        .map(g => ({ ...g, candidatos: rankearIngresosParaItem(g.item, ctx, ingresos) }));
      setLlegoTarget({ factura: fac, grupos });
    } catch (e) {
      showToast?.('Error buscando ingresos: ' + (e?.message || e), 'red');
    } finally {
      setBuscandoLlego(false);
    }
  };

  // Vincular una LÍNEA de factura a UN ingreso (1 clic). Escribe ambos lados y refresca.
  const vincularItemAIngreso = async (fac, itemIdx, cand) => {
    if (vincLlegoRef.current) return;
    vincLlegoRef.current = true;
    try {
      const isPrueba = (() => { try { return getCurrentMode() === 'prueba'; } catch { return false; } })();
      const uid = window.__currentUserId || userId || 'contador';
      const now = new Date().toISOString();
      const mov = cand.ingreso._mov;
      const facFresh = await window.__db.accounting_movements.get(fac.id);
      if (!facFresh) { showToast?.('La factura ya no está en este dispositivo', 'red'); return; }
      const notas = parseNotas(facFresh.notas);
      const items = Array.isArray(notas.items_factura) ? notas.items_factura.slice() : [];
      const orig = items[itemIdx];
      if (!orig) { showToast?.('La línea de la factura cambió — volvé a buscar', 'red'); return; }
      const qty = Number(mov.cantidad) || 0;
      const nuevoRecibido = Number(orig.cantidad) > 0
        ? Math.min(Number(orig.cantidad), (Number(orig.recibido) || 0) + qty)
        : (Number(orig.recibido) || 0) + qty;
      items[itemIdx] = { ...orig, recibido: nuevoRecibido, mov_vinculado_id: mov.id, recepcion_modo: 'vinculado' };
      notas.items_factura = items;
      const facNoSube = isPrueba || facFresh.demo === true;
      await window.__db.accounting_movements.update(facFresh.id, {
        notas: JSON.stringify(notas),
        recepcion_status: estadoRecepcionDeItems(items),
        recepcion_movimiento_id: facFresh.recepcion_movimiento_id || mov.id,
        recepcion_fecha: now, recepcion_por: uid,
        updated_at: now, updated_by: uid, version: (facFresh.version || 0) + 1,
        sync_status: facNoSube ? 'synced' : (facFresh.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'),
      });
      const movNoSube = isPrueba || mov.demo === true;
      await window.__db.movimientos_materiales.update(mov.id, {
        accounting_movement_id: facFresh.id, pendiente_sustento: false,
        updated_at: now, updated_by: uid, version: (mov.version || 0) + 1,
        sync_status: movNoSube ? 'synced' : (mov.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'),
      });
      try { await window.__logAudit?.({ action: 'update', table: 'accounting_movements', recordId: facFresh.id, reason: `Recepción vinculada — línea ${itemIdx + 1} ↔ ingreso de almacén · factura ${facFresh.document_number || ''}` }); } catch {}
      ['accounting_movements', 'movimientos_materiales'].forEach(t => { try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: t } })); } catch {} });
      try { window.dispatchEvent(new Event('online')); } catch {}
      showToast?.('🔗 Ingreso vinculado — recepción registrada', 'green');
      await buscarIngresos(facFresh); // refrescar: la línea resuelta sale de la lista
    } catch (e) {
      showToast?.('Error al vincular: ' + (e?.message || e), 'red');
    } finally {
      vincLlegoRef.current = false;
    }
  };

  // Fase 2 — enviar una consulta a almacén por una línea (referencia SIN costos).
  const preguntarAlmacen = async (fac, g) => {
    try {
      const it = g.item;
      await crearConsulta({
        obra_id: fac.obra_id || null, origen: 'contabilidad',
        accounting_movement_id: fac.id, item_idx: g.idx,
        referencia: referenciaSinCostos(fac, g.idx),
        pregunta: `¿Llegó a almacén: ${it.descripcion || 'insumo'} · ${Number(it.cantidad) || 0} ${it.unidad || ''} (factura ${fac.document_type || ''} ${fac.document_number || ''})?`.replace(/\s+/g, ' ').trim(),
      });
      showToast?.('Consulta enviada a almacén 💬', 'green');
    } catch (e) { showToast?.('Error al enviar la consulta: ' + (e?.message || e), 'red'); }
  };

  // ── Insumos para VENTA: escritor genérico del estado de un ítem ──
  const escribirVentaItem = async (facturaId, idx, patch, razon) => {
    const fresh = await window.__db.accounting_movements.get(facturaId);
    if (!fresh) { showToast('Factura no encontrada en este dispositivo — sincronizá', 'red'); return false; }
    const notas = parseNotas(fresh.notas);
    const items = Array.isArray(notas.items_factura) ? notas.items_factura.slice() : [];
    if (!items[idx]) { showToast('El ítem de la factura cambió — recargá', 'red'); return false; }
    items[idx] = { ...items[idx], ...patch };
    // Limpiar claves undefined (JSON.stringify las omite, pero el objeto en
    // memoria no debe arrastrarlas a estadoRecepcionDeItems).
    for (const k of Object.keys(items[idx])) if (items[idx][k] === undefined) delete items[idx][k];
    notas.items_factura = items;
    await window.__db.accounting_movements.update(facturaId, {
      notas: JSON.stringify(notas),
      // Un ítem separado/vendido deja de contar como pendiente de recepción
      // (itemNoRequiereAlmacen lo excluye) → el semáforo de la factura se
      // recalcula en el acto (antes quedaba 'parcial' para siempre).
      recepcion_status: estadoRecepcionDeItems(items),
      updated_at: new Date().toISOString(), updated_by: userId,
      version: (fresh.version ?? 0) + 1,
      sync_status: fresh.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
    });
    try { await window.__logAudit?.({ action:'update', table:'accounting_movements', recordId: facturaId, reason: razon }); } catch {}
    try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'accounting_movements' } })); } catch {}
    return true;
  };
  const canSepararVenta = isAdmin || myRol === 'contador'; // jefa de contabilidad + admin
  const pregVentaRef = uRC(false);   // guard SÍNCRONO anti doble-click (consultas duplicadas)
  const preguntarAlmacenVenta = async (row) => {
    if (pregVentaRef.current) return;
    pregVentaRef.current = true;
    try {
      const fac = (movs || []).find(m => m.id === row.facturaId);
      if (!fac) return;
      await crearConsulta({
        obra_id: fac.obra_id || null, origen: 'contabilidad',
        accounting_movement_id: fac.id, item_idx: row.idx,
        // flujo:'venta' distingue esta consulta de la vieja "¿llegó?": solo el
        // "No" de ESTA habilita separar (el "No llegó" de la otra = "todavía no").
        referencia: { ...referenciaSinCostos(fac, row.idx), flujo: 'venta' },
        pregunta: `¿Este insumo ingresó o va a ingresar a obra?: ${row.descripcion} · ${row.pendiente} ${row.unidad} (factura ${row.doc}). Contabilidad evalúa separarlo para VENTA.`.replace(/\s+/g, ' ').trim(),
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'puente_consultas' } })); } catch {}
      showToast('Consulta enviada a almacén 💬 — cuando respondan "No", vas a poder separarlo.', 'green');
    } catch (e) { showToast('Error al enviar la consulta: ' + (e?.message || e), 'red'); }
    finally { pregVentaRef.current = false; }
  };
  const separarParaVenta = async (row, respuestaNo) => {
    if (!canSepararVenta) return;
    const aviso = respuestaNo
      ? `🏷 Separar para VENTA:\n\n${row.descripcion} · ${row.pendiente} ${row.unidad}\nFactura ${row.doc} · ${row.proveedor}\n\nAlmacén confirmó que NO ingresó ni va a ingresar. ¿Separar?`
      : `⚠ SIN comprobación de almacén (solo un admin puede saltarla):\n\n${row.descripcion} · ${row.pendiente} ${row.unidad} (factura ${row.doc})\n\n¿Separar para venta igual?`;
    if (!window.confirm(aviso)) return;
    const ok = await escribirVentaItem(row.facturaId, row.idx, {
      venta_status: 'para_venta', venta_cantidad: row.pendiente,
      venta_marcado_por: userId, venta_marcado_at: new Date().toISOString(),
      venta_comprobado: respuestaNo ? 'almacen_no' : 'admin_directo',
    }, `Ítem separado para VENTA: ${row.descripcion} × ${row.pendiente} (${respuestaNo ? 'almacén confirmó no-ingreso' : 'admin sin comprobación'})`);
    if (ok) showToast(`🏷 ${row.descripcion} separado para venta (${row.pendiente} ${row.unidad}).`, 'green');
  };
  const devolverDeVenta = async (row) => {
    if (!canSepararVenta) return;
    if (!window.confirm(`↩ Quitar "${row.descripcion}" del pool de venta (vuelve a Sin ingreso a obra)?`)) return;
    const ok = await escribirVentaItem(row.facturaId, row.idx, {
      venta_status: undefined, venta_cantidad: undefined, venta_comprobado: undefined,
      venta_marcado_por: undefined, venta_marcado_at: undefined,
      venta_mov_id: undefined, venta_vendido_at: undefined,   // también al volver desde 'vendido'
    }, `Ítem devuelto del pool de venta: ${row.descripcion}`);
    if (ok) showToast('Ítem quitado del pool de venta.', 'amber');
  };
  const vincularVentaEmitida = async (row, ventaMovId) => {
    if (!canSepararVenta || !ventaMovId) return;
    const venta = (movs || []).find(m => m.id === ventaMovId);
    if (!venta) return;
    if (!window.confirm(`🧾 Vincular "${row.descripcion}" × ${row.cantidad} a la venta ${venta.document_number || ''} (${fmtCur(venta.amount, venta.currency)})?\n\nQueda la trazabilidad compra → venta.`)) return;
    const ok = await escribirVentaItem(row.facturaId, row.idx, {
      venta_status: 'vendido', venta_mov_id: ventaMovId,
      venta_vendido_at: new Date().toISOString(),
    }, `Ítem del pool de venta VINCULADO a la venta ${venta.document_number || ventaMovId}: ${row.descripcion} × ${row.cantidad}`);
    if (ok) showToast(`🧾 Vinculado a la venta ${venta.document_number || ''} — trazabilidad completa.`, 'green');
  };
  const [detrPct, setDetrPct] = uSC('');
  const [detrMonto, setDetrMonto] = uSC('');
  const [detrCodigo, setDetrCodigo] = uSC('');
  const [detrFecha, setDetrFecha] = uSC('');
  const [detrSaving, setDetrSaving] = uSC(false);

  uEC(() => {
    let cancelled = false;
    let blobUrlsActuales = [];   // objectURLs de la corrida vigente (se revocan antes de recrear)
    const cargar = async () => {
      // Revocar la tanda anterior ANTES de crear nuevos objectURLs: sin esto, cada
      // reload (sync/Captura Mágica/guardar) acumulaba objectURLs nunca revocados → fuga.
      blobUrlsActuales.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
      blobUrlsActuales = [];
      const nuevos = [];
      try {
        const evs = await window.__db.evidencias
          .filter(e =>
            (e.modulo_relacionado === 'accounting_movements' || e.modulo_relacionado === 'depositos_bancarizacion') &&
            !e.deleted_at &&
            e.registro_relacionado_id
          )
          .toArray();
        // Estado EFECTIVO de una evidencia: el SyncEngine estampa 'synced' al
        // BAJAR registros creados en otros dispositivos — si además tiene URL,
        // la constancia ESTÁ subida. Sin esta normalización, el dispositivo
        // que NO la creó mostraba "⏳ Subiendo bancarización" eterno aunque el
        // archivo estuviera en el server (bug reportado por Gabriel, 20-jul).
        const estadoEv = (ev) => (ev.url_archivo && (ev.sync_status === 'uploaded' || ev.sync_status === 'synced')) ? 'uploaded' : ev.sync_status;
        // Por registro se muestra UNA evidencia: gana la ya SUBIDA ('uploaded')
        // sobre cualquier pendiente/fallida, y entre iguales la más nueva.
        // (Antes ganaba la más nueva a secas: un registro fantasma atascado en
        // 'pending_upload' tapaba a la constancia ya subida.)
        const rankSync = (s) => s === 'uploaded' ? 0 : s === 'failed' ? 2 : 1;
        evs.sort((a, b) => (rankSync(estadoEv(a)) - rankSync(estadoEv(b))) || (b.created_at || '').localeCompare(a.created_at || ''));
        const map = new Map();       // facturas / comprobantes
        const mapBanc = new Map();    // evidencias de bancarización (directas al mov)
        const mapDep = new Map();     // constancias de DEPÓSITOS multi-factura
        const mapDetr = new Map();    // constancias de DETRACCIÓN (directas al mov)
        for (const ev of evs) {
          const esDeposito = ev.modulo_relacionado === 'depositos_bancarizacion';
          const esBanc = ev.tipo_evidencia === 'bancarizacion';
          const esDetr = ev.tipo_evidencia === 'constancia_detraccion';
          const target = esDeposito ? mapDep : (esBanc ? mapBanc : (esDetr ? mapDetr : map));
          if (target.has(ev.registro_relacionado_id)) continue;
          // Blob local si existe; si no, signed URL del bucket privado (la
          // url_archivo cruda NO sirve en un bucket privado → factura no abre).
          const src = await getEvidenciaSrc(ev);
          if (src?.url) {
            if (src.isBlob) nuevos.push(src.url);
            target.set(ev.registro_relacionado_id, {
              url: src.url,
              mime: ev.mime_type || 'application/pdf',
              nombre: ev.nombre_archivo || (esBanc ? 'bancarizacion' : 'comprobante'),
              sync: estadoEv(ev),   // subido vs pendiente/falló ('synced' con URL = subido)
            });
          }
        }
        if (!cancelled) { setEvidenciasPorMov(map); setBancarizacionPorMov(mapBanc); setBancPorDeposito(mapDep); setDetraccionPorMov(mapDetr); blobUrlsActuales = nuevos; }
        else nuevos.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
      } catch (e) { console.warn('[contab evidencias]', e?.message); nuevos.forEach(u => { try { URL.revokeObjectURL(u); } catch {} }); }
    };
    cargar();
    const onChange = (e) => {
      const t = e?.detail?.tabla || e?.detail?.table;
      if (!t || t === 'evidencias') cargar();
    };
    window.addEventListener('jx_data_changed', onChange);
    window.addEventListener('jarvex_master_updated', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('jx_data_changed', onChange);
      window.removeEventListener('jarvex_master_updated', onChange);
      blobUrlsActuales.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
    };
  }, []);
  // IA: sugerencia de cuenta PCGE
  const [aiSugCuenta, setAiSugCuenta] = uSC(null); // { result, confianza, razonamiento, advertencias }
  const [aiSugLoading, setAiSugLoading] = uSC(false);

  // Política auto-apply: confianza >= 0.85 sin advertencias críticas → aplica directo
  const aplicarSugerenciaAuto = (sug) => {
    if (!sug?.result?.cuenta_sugerida) return false;
    const conf = Number(sug.confianza || 0);
    const advCriticas = (sug.advertencias || []).some(a => /alucin|inv[aá]lida|no v[aá]lida|fuera de cat/i.test(String(a)));
    return conf >= 0.85 && !advCriticas;
  };

  const sugerirCuenta = async () => {
    if (!form.description?.trim() && !form.category?.trim()) {
      try { window.__showToast?.('Escribí descripción o categoría primero', 'amber'); } catch {}
      return;
    }
    setAiSugLoading(true);
    setAiSugCuenta(null);
    try {
      const sug = await sugerirCuentaPcge({
        type: form.type || 'expense',
        description: form.description || '',
        category: form.category || '',
        third_party_name: form.third_party_name || '',
        document_type: form.document_type || '',
        sugerencia_actual: form.cuenta_pcge || '',
      });
      setAiSugCuenta(sug);
      try { await window.__logAudit?.({ action:'insert', table:'audit', recordId: 'sugerir-cuenta',
        newData: { cuenta: sug.result.cuenta_sugerida, confianza: sug.confianza, cached: !!sug._cached },
        reason: `IA sugerencia cuenta PCGE: ${sug.result.cuenta_sugerida} (${(sug.confianza*100).toFixed(0)}%)` }); } catch {}
      // Auto-apply si confianza alta
      if (aplicarSugerenciaAuto(sug)) {
        setForm(prev => ({ ...prev, cuenta_pcge: sug.result.cuenta_sugerida }));
        try { window.__showToast?.(`✓ Cuenta ${sug.result.cuenta_sugerida} aplicada por IA (${(sug.confianza*100).toFixed(0)}%)`, 'green'); } catch {}
        try { await window.__logAudit?.({ action:'update', table:'audit', recordId:'sugerir-cuenta',
          newData: { cuenta_aplicada: sug.result.cuenta_sugerida, modo: 'auto-apply' },
          reason: 'IA cuenta PCGE auto-aplicada (confianza alta)' }); } catch {}
      }
      // Si confianza baja, el dropdown abajo del campo muestra alternativas
    } catch (e) {
      try { window.__showToast?.('Error sugiriendo cuenta: ' + (e.message || e), 'red'); } catch {}
    } finally {
      setAiSugLoading(false);
    }
  };

  const companiesActivas = uMC(() => (companies || []).filter(c => c.status === 'activa'), [companies]);

  // Reconciliación de los filtros de ámbito: si apuntan a una obra/empresa que YA
  // no figura en su selector (usuario no asignado a esa obra, obra eliminada,
  // empresa inactivada), el <select> controlado mostraría 'Todas' pero `filtered`
  // seguiría filtrando por ese id → tabla vacía/sub-filtrada sin recuperación.
  // Guard: no resetear mientras la fuente aún no cargó (evita reset prematuro).
  uEC(() => {
    if (filtroObraSel !== 'todas' && (obras || []).length &&
        !obrasParaSelector.some(o => o.id === filtroObraSel)) setFiltroObraSel('todas');
    if (filtroEmpresaSel !== 'todas' && (companies || []).length &&
        !companiesActivas.some(c => c.id === filtroEmpresaSel)) setFiltroEmpresaSel('todas');
  }, [filtroObraSel, filtroEmpresaSel, obrasParaSelector, companiesActivas, obras, companies]);

  // ¿El movimiento (>S/2000 en soles) está sin bancarización (ninguna o falló)?
  // Definida antes de `filtered` porque el useMemo la llama al filtrar por
  // "solo sin bancarización" (los const no se hoistean → TDZ si va después).
  // Solo CONTABILIDAD + admin evalúan bancarización: al resto de roles la RLS
  // del server les oculta las evidencias contables, así que verían "falta"
  // en movimientos que SÍ la tienen (falsa alarma).
  const puedeVerBanc = isAdmin || myRol === 'contador' || myRol === 'ayudante_contador';
  const depositosById = uMC(() => new Map((depositos || []).map(d => [d.id, d])), [depositos]);
  const faltaBancarizacion = (m) => {
    if (!puedeVerBanc) return false;
    if (!(m.currency === 'PEN' && Number(m.amount) > 2000)) return false;
    const evB = bancarizacionPorMov.get(m.id);
    if (evB && evB.sync !== 'failed') return false;
    // También cuenta como bancarizado si las partes cubren el total y las que
    // usan depósito apuntan a un depósito vivo (su constancia vive allí).
    return !movimientoBancarizado({ mov: m, tieneEvidenciaDirecta: false, partes: partesPorMov.get(m.id) || [], depositosById });
  };

  // Emisor / receptor del comprobante (pedido 20-jul): en una VENTA nuestra
  // empresa EMITE al tercero; en una COMPRA el proveedor emite y nuestra
  // empresa RECIBE. Permite ubicar un comprobante por quién lo emitió/recibió.
  const nombreCompanyDe = uMC(() => {
    const m = new Map((companies || []).map(c => [c.id, c.name]));
    return (id) => m.get(id) || '—';
  }, [companies]);
  const esVentaMov = (m) => (m.clase || (m.type === 'income' ? 'venta' : 'compra')) === 'venta';
  const emisorDe = (m) => esVentaMov(m) ? nombreCompanyDe(m.company_id) : (m.third_party_name || '—');
  const receptorDe = (m) => esVentaMov(m) ? (m.third_party_name || '—') : nombreCompanyDe(m.company_id);
  // Meses que realmente tienen comprobantes (para el selector de período).
  const opcionesMes = uMC(() => {
    const set = new Set();
    for (const m of (movs || [])) {
      const k = String(m.date || '').slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(k)) set.add(k);
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [movs]);
  const opcionesEmisor = uMC(() => [...new Set((movs || []).map(emisorDe).filter(n => n && n !== '—'))].sort((a, b) => a.localeCompare(b)), [movs, nombreCompanyDe]);
  const opcionesReceptor = uMC(() => [...new Set((movs || []).map(receptorDe).filter(n => n && n !== '—'))].sort((a, b) => a.localeCompare(b)), [movs, nombreCompanyDe]);

  const filtered = uMC(() => {
    if (!movs) return [];
    let f = [...movs];
    // Ámbito: por OBRA (m.obra_id) o por EMPRESA (m.company_id).
    if (filtroObraSel !== 'todas') f = f.filter(m => m.obra_id === filtroObraSel);
    if (filtroEmpresaSel !== 'todas') f = f.filter(m => m.company_id === filtroEmpresaSel);
    if (filtroClase !== 'todos') f = f.filter(m => (m.clase || (m.type === 'income' ? 'venta' : 'compra')) === filtroClase);
    if (filtroTipo !== 'todos') f = f.filter(m => m.type === filtroTipo);
    if (filtroEstado !== 'todos') f = f.filter(m => m.payment_status === filtroEstado);
    if (filtroEmisor !== 'todos') f = f.filter(m => emisorDe(m) === filtroEmisor);
    if (filtroReceptor !== 'todos') f = f.filter(m => receptorDe(m) === filtroReceptor);
    if (busqueda) {
      const q = busqueda.toLowerCase();
      f = f.filter(m => (m.description||'').toLowerCase().includes(q)
        || (m.third_party_name||'').toLowerCase().includes(q)
        || (m.document_number||'').toLowerCase().includes(q));
    }
    if (soloSinBanc) f = f.filter(faltaBancarizacion);
    // Período: mes puntual o rango personalizado (fechas en 'YYYY-MM-DD' →
    // comparación lexicográfica segura).
    if (filtroMes === 'custom') {
      if (filtroDesde) f = f.filter(m => (m.date || '') >= filtroDesde);
      if (filtroHasta) f = f.filter(m => (m.date || '') <= filtroHasta);
    } else if (filtroMes !== 'todos') {
      f = f.filter(m => String(m.date || '').slice(0, 7) === filtroMes);
    }
    // Orden ESTABLE: por fecha desc, y dentro de la misma fecha por número de
    // comprobante (natural) y luego created_at. Sin el desempate, las facturas de
    // un mismo día quedaban en orden de `id` (aleatorio tras un resync) → la
    // contadora las veía "desordenadas".
    return f.sort((a,b) =>
      (b.date||'').localeCompare(a.date||'')
      || cmpComprobante(a.document_number, b.document_number)
      || (a.created_at||'').localeCompare(b.created_at||''));
  }, [movs, filtroObraSel, filtroEmpresaSel, filtroClase, filtroTipo, filtroEstado, filtroEmisor, filtroReceptor, nombreCompanyDe, busqueda, soloSinBanc, filtroMes, filtroDesde, filtroHasta, bancarizacionPorMov, partesPorMov, depositosById]);

  // Paginación: tabla puede tener miles de movimientos contables.
  const movPg = usePagination(filtered, 100);

  const openNuevo = () => {
    if (!companiesActivas.length) { showToast('Crea primero una empresa', 'red'); return; }
    setForm({
      company_id: companiesActivas[0].id,
      // Fecha LOCAL (Lima): toISOString es UTC y desde las 19:00 pre-llenaba mañana.
      date: window.__fecha?.hoyLocal?.() || new Date().toISOString().slice(0,10),
      clase: 'compra',          // explícito: la mayoría de su flujo son compras
      type: 'cost',
      obra_id: '',
      category: '',
      cuenta_pcge: '',
      description: '',
      amount: '',
      currency: 'PEN',
      third_party_name: '',
      payment_status: 'pending',
      document_type: 'factura',
      document_number: '',
      notas: '',
      _bancFile: null,
    });
    setEditingId(null);
    setModal('nuevo');
  };

  const openEditar = (m) => {
    if (m.is_intercompany) {
      showToast('Los movimientos generados desde Operaciones entre empresas se editan desde esa pantalla', 'amber');
      return;
    }
    setForm({
      company_id: m.company_id,
      date: m.date || '',
      clase: m.clase || (m.type === 'income' ? 'venta' : 'compra'),
      type: m.type,
      obra_id: m.obra_id || '',
      destino_contable: m.destino_contable || (m.obra_id ? 'obra' : null),
      category: m.category || '',
      cuenta_pcge: m.cuenta_pcge || '',
      description: m.description || '',
      amount: m.amount,
      currency: m.currency || 'PEN',
      third_party_name: m.third_party_name || '',
      third_party_ruc: m.third_party_ruc || '',
      payment_status: m.payment_status || 'pending',
      document_type: m.document_type || 'factura',
      document_number: m.document_number || '',
      notas: m.notas || '',
    });
    setEditingId(m.id);
    setModal('editar');
  };

  const guardar = async () => {
    if (!form.company_id || !form.amount || !form.date) {
      showToast('Empresa, fecha y monto son requeridos', 'red');
      return;
    }
    const monto = parseFloat(form.amount);
    if (!Number.isFinite(monto) || monto < 0) { showToast('Monto inválido', 'red'); return; }
    const now = new Date().toISOString();
    let savedId = editingId;
    try {
      if (editingId) {
        const orig = movs.find(m => m.id === editingId);
        await window.__db.accounting_movements.update(editingId, {
          company_id: form.company_id,
          date: form.date,
          clase: form.clase || null,
          obra_id: form.obra_id || null,
          destino_contable: form.obra_id ? 'obra' : (form.destino_contable || null),
          type: form.type,
          category: form.category || null,
          cuenta_pcge: form.cuenta_pcge || null,
          description: form.description || null,
          amount: monto,
          currency: form.currency || 'PEN',
          third_party_name: form.third_party_name || null,
          third_party_ruc: form.third_party_ruc || null,
          payment_status: form.payment_status,
          document_type: form.document_type || null,
          document_number: form.document_number || null,
          notas: form.notas || null,
          updated_at: now, updated_by: userId,
          version: (orig?.version ?? 0) + 1,
          sync_status: orig?.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
        try { await window.__logAudit?.({ action:'update', table:'accounting_movements', recordId:editingId, oldData:orig, newData:form }); } catch {}
        showToast('Movimiento actualizado', 'green');
      } else {
        const id = window.__newId();
        savedId = id;
        const isPrueba = getCurrentMode() === 'prueba';
        await window.__db.accounting_movements.add({
          id,
          company_id: form.company_id,
          date: form.date,
          clase: form.clase || null,
          obra_id: form.obra_id || null,
          destino_contable: form.obra_id ? 'obra' : (form.destino_contable || null),
          type: form.type,
          category: form.category || null,
          cuenta_pcge: form.cuenta_pcge || null,
          description: form.description || null,
          amount: monto,
          currency: form.currency || 'PEN',
          third_party_name: form.third_party_name || null,
          third_party_ruc: form.third_party_ruc || null,
          payment_status: form.payment_status,
          document_type: form.document_type || null,
          document_number: form.document_number || null,
          file_url: null,
          is_intercompany: false,
          related_company_id: null,
          related_movement_id: null,
          notas: form.notas || null,
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1,
          sync_status: isPrueba ? 'synced' : 'pending_create',
          last_synced_at: null,
          idempotency_key: `${userId}_acc_mov_${id}`,
          ...(isPrueba ? { demo: true } : {}),
        });
        try { await window.__logAudit?.({ action:'insert', table:'accounting_movements', recordId:id, newData:form }); } catch {}
        showToast('Movimiento registrado', 'green');
      }
      // Evidencia de bancarización (> S/2000). La obra es opcional: las facturas
      // de Gastos Generales / Contabilidad Neta se archivan sin obra (mig 141).
      if (form._bancFile && savedId) {
        try {
          await window.__saveEvidenciaLocal({
            id: window.__newId(), obra_id: form.obra_id || null, tipo_evidencia: 'bancarizacion',
            modulo_relacionado: 'accounting_movements', registro_relacionado_id: savedId,
            nombre_archivo: form._bancFile.name, mime_type: form._bancFile.type || 'image/jpeg',
            blob: form._bancFile, fecha: form.date, created_by: userId,
            observaciones: 'Evidencia de bancarización (> S/2000)',
          });
          try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'evidencias' } })); } catch {}
        } catch (e) { showToast('Mov. guardado, pero falló adjuntar la bancarización: ' + (e.message||e), 'amber'); }
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'accounting_movements' } })); } catch {}
      try { window.dispatchEvent(new Event('online')); } catch {}
      setModal(null); setEditingId(null); setForm({});
    } catch (e) {
      showToast('Error: ' + (e.message || e), 'red');
    }
  };

  const eliminar = async (m) => {
    if (!isAdmin) return;
    if (m.is_intercompany) {
      showToast('Para eliminar este movimiento, elimina la operación entre empresas correspondiente', 'amber');
      return;
    }
    if (!confirm(`¿Eliminar movimiento de ${fmtCur(m.amount, m.currency)}?`)) return;
    try {
      await window.__db.accounting_movements.update(m.id, {
        deleted_at: new Date().toISOString(),
        sync_status: m.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
      });
      try { await window.__logAudit?.({ action:'delete', table:'accounting_movements', recordId:m.id, oldData:m }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'accounting_movements' } })); } catch {}
      showToast('Movimiento eliminado', 'amber');
    } catch (e) { showToast('Error: ' + (e.message||e), 'red'); }
  };

  // Eliminar la CONTRAPARTE AUTOMÁTICA (espejo intercompany que generó Captura
  // Mágica al confirmar una venta interna). A diferencia de una operación interna
  // MANUAL (bloqueada acá a propósito), esta la generó el sistema, así que se
  // permite quitarla directo desde la fila — el caso de uso es reemplazarla por el
  // comprobante real. Desvincula la venta original (related_movement_id) para no
  // dejar un puntero colgando.
  const eliminarEspejoAuto = async (m) => {
    if (!isAdmin) return;
    if (!confirm(`¿Eliminar la CONTRAPARTE AUTOMÁTICA de ${fmtCur(m.amount, m.currency)}?\n\nSe generó sola como espejo de una venta interna del grupo. Se quita SOLO esta compra automática; la venta original NO se toca. Después podés subir el comprobante real desde Captura Mágica.`)) return;
    try {
      const now = new Date().toISOString();
      await window.__db.accounting_movements.update(m.id, {
        deleted_at: now,
        sync_status: m.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
      });
      // Desvincular la venta original si apuntaba a este espejo.
      let notas = {}; try { notas = JSON.parse(m.notas || '{}'); } catch {}
      const ventaId = notas.intercompany_mirror_of || m.related_movement_id;
      if (ventaId) {
        try {
          const venta = await window.__db.accounting_movements.get(ventaId);
          if (venta && venta.related_movement_id === m.id) {
            await window.__db.accounting_movements.update(ventaId, {
              related_movement_id: null,
              updated_at: now,
              sync_status: venta.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
            });
          }
        } catch {}
      }
      try { await window.__logAudit?.({ action:'delete', table:'accounting_movements', recordId:m.id, oldData:m, reason:'Eliminación de contraparte intercompany automática (para reemplazar por el comprobante real)' }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'accounting_movements' } })); } catch {}
      showToast('Contraparte automática eliminada. Podés subir el comprobante real cuando quieras.', 'amber');
    } catch (e) { showToast('Error: ' + (e.message||e), 'red'); }
  };

  // ── Duplicados: detectar y fusionar (admin / contador jefe) ─────────
  // Caso real: la misma factura de VENTA confirmada dos veces en Captura
  // Mágica (el guard anti-dup solo cubría compras). El botón de eliminar está
  // deshabilitado para INTERCO, así que sin esta herramienta el duplicado no
  // se podía limpiar desde la UI.
  const puedeDedup = isAdmin || myRol === 'contador';
  const [dupGrupos, setDupGrupos] = uSC(null);   // null = modal cerrado
  const [fusionando, setFusionando] = uSC(false);
  const abrirDuplicados = () => setDupGrupos(detectarDuplicados(movs || []));

  // Fusiona un grupo: reasigna los hijos del duplicado (evidencias, partes de
  // bancarización, guías) al movimiento conservado y soft-borra el resto.
  // Requiere conexión: las evidencias no siguen el sync estándar (su ciclo es
  // del EvidenceUploader), así que su reasignación va directo al server.
  const fusionarGrupo = async (g) => {
    const sb = window.__supabase;
    if (!sb || !navigator.onLine) { showToast('Necesitás conexión para fusionar duplicados', 'red'); return false; }
    const now = new Date().toISOString();
    for (const dup of g.duplicados) {
      try {
        const { error } = await sb.from('evidencias')
          .update({ registro_relacionado_id: g.conservar.id, updated_at: now })
          .eq('registro_relacionado_id', dup.id)
          .eq('modulo_relacionado', 'accounting_movements');
        if (error) throw error;
      } catch (e) { showToast('No se pudo reasignar evidencias: ' + (e.message || e), 'red'); return false; }
      await window.__db.evidencias
        .filter(ev => ev.registro_relacionado_id === dup.id && ev.modulo_relacionado === 'accounting_movements')
        .modify({ registro_relacionado_id: g.conservar.id, updated_at: now });
      await window.__db.pagos_partes
        .filter(p => p.accounting_movement_id === dup.id && !p.deleted_at)
        .modify(p => {
          p.accounting_movement_id = g.conservar.id;
          p.updated_at = now; p.version = (p.version ?? 0) + 1;
          if (p.demo !== true && p.sync_status !== 'pending_create') p.sync_status = 'pending_update';
        });
      try {
        await window.__db.guias_remision
          .filter(gr => gr.accounting_movement_id === dup.id && !gr.deleted_at)
          .modify(gr => {
            gr.accounting_movement_id = g.conservar.id;
            gr.updated_at = now; gr.version = (gr.version ?? 0) + 1;
            if (gr.demo !== true && gr.sync_status !== 'pending_create') gr.sync_status = 'pending_update';
          });
      } catch { /* guias_remision puede no existir en Dexie viejos */ }
      await window.__db.accounting_movements.update(dup.id, {
        deleted_at: now,
        sync_status: dup.demo === true ? 'synced' : (dup.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete'),
      });
      try { await window.__logAudit?.({ action:'delete', table:'accounting_movements', recordId: dup.id, oldData: dup,
        reason: `Fusión de duplicado → se conserva ${g.conservar.id} (${g.conservar.document_number || ''})` }); } catch {}
    }
    try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'accounting_movements' } })); } catch {}
    return true;
  };
  const fusionarUno = async (g) => {
    setFusionando(true);
    try {
      if (await fusionarGrupo(g)) {
        showToast('Duplicado fusionado', 'green');
        setDupGrupos(gs => (gs || []).filter(x => x !== g));
      }
    } finally { setFusionando(false); }
  };
  const fusionarTodos = async () => {
    setFusionando(true);
    try {
      let ok = 0;
      for (const g of (dupGrupos || [])) { if (!(await fusionarGrupo(g))) break; ok++; }
      if (ok) showToast(`${ok} grupo(s) de duplicados fusionados`, 'green');
      setDupGrupos(null);
    } finally { setFusionando(false); }
  };

  // ── BANDEJA "Sin clasificar" (Contadora Jefe): facturas subidas con
  // "No sé / No me acuerdo" en Captura Mágica. La jefa las revisa y les asigna
  // el destino correcto (obra / gastos generales / contabilidad neta) — así
  // las asistentes no adivinan ni alteran los reportes.
  const esRevisorDestino = isAdmin || myRol === 'contador';
  const sinClasificar = uMC(() => (movs || []).filter(m => !m.deleted_at && m.destino_contable === 'sin_clasificar'), [movs]);
  const [bandejaOpen, setBandejaOpen] = uSC(false);
  const [bandejaSel, setBandejaSel] = uSC(() => new Map()); // mov_id → destino elegido ('' | obra_id | '__empresa__' | '__otros__')
  const asignarDestino = async (m, eleccion) => {
    if (!eleccion) { showToast('Elegí el destino para esta factura', 'red'); return; }
    const esObraDest = eleccion !== '__empresa__' && eleccion !== '__otros__';
    // Filtro de facturación: factura anterior al inicio de la obra elegida (advierte, no bloquea).
    if (esObraDest) {
      const od = obrasParaSelector.find(o => o.id === eleccion);
      if (od?.fecha_inicio && m.date && m.date < od.fecha_inicio &&
          !window.confirm(`⚠ La factura (${m.date}) es ANTERIOR al inicio de "${od.nombre_obra}" (${od.fecha_inicio}).\n\n¿Confirmás que va a esta obra?`)) return;
    }
    const patch = {
      obra_id: esObraDest ? eleccion : null,
      destino_contable: esObraDest ? 'obra' : (eleccion === '__empresa__' ? 'gastos_generales' : 'contabilidad_neta'),
      updated_at: new Date().toISOString(),
      updated_by: userId,
      version: (m.version ?? 0) + 1,
      sync_status: m.demo === true ? 'synced' : (m.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'),
    };
    try {
      await window.__db.accounting_movements.update(m.id, patch);
      try { await window.__logAudit?.({ action:'update', table:'accounting_movements', recordId:m.id,
        oldData:{ destino_contable:'sin_clasificar' }, newData:{ destino_contable: patch.destino_contable, obra_id: patch.obra_id },
        reason:'Bandeja de la Contadora Jefe: destino asignado a factura "No sé"' }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'accounting_movements' } })); } catch {}
      showToast(`✓ Destino asignado: ${esObraDest ? (obraNombre(eleccion) || 'obra') : (eleccion === '__empresa__' ? 'Gastos Generales' : 'Contabilidad Neta')}`, 'green');
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };

  const cambiarEstadoPago = async (m, nuevoEstado) => {
    try {
      await window.__db.accounting_movements.update(m.id, {
        payment_status: nuevoEstado,
        updated_at: new Date().toISOString(),
        updated_by: userId,
        version: (m.version ?? 0) + 1,
        sync_status: m.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'accounting_movements' } })); } catch {}
      showToast(`Marcado como ${STATUS_LABEL[nuevoEstado]}`, 'green');
    } catch (e) { showToast('Error: ' + (e.message||e), 'red'); }
  };

  const lookupCompany = (id) => companies?.find(c => c.id === id);

  // Partes de pago (pagos_partes) → Σ por movimiento y por depósito, más el
  // catálogo de depósitos multi-factura.
  uEC(() => {
    let cancel = false;
    const load = async () => {
      try {
        const rows = await window.__db.pagos_partes.filter(p => !p.deleted_at).toArray();
        if (cancel) return;
        const m = new Map();
        const pd = new Map();
        for (const r of rows) {
          if (r.accounting_movement_id) { const a = m.get(r.accounting_movement_id) || []; a.push(r); m.set(r.accounting_movement_id, a); }
          if (r.deposito_id) { const a = pd.get(r.deposito_id) || []; a.push(r); pd.set(r.deposito_id, a); }
        }
        setPartesPorMov(m);
        setPartesPorDeposito(pd);
      } catch {}
      try {
        const deps = await window.__db.depositos_bancarizacion.filter(d => !d.deleted_at).toArray();
        if (!cancel) setDepositos(deps);
      } catch { /* Dexie viejo sin la tabla (pre-v43) */ }
      try {
        const _esP = (() => { try { return getCurrentMode() === 'prueba'; } catch { return false; } })();
        const gs = await window.__db.guias_remision.filter(g => !g.deleted_at && g.accounting_movement_id && (_esP ? g.demo === true : g.demo !== true)).toArray();
        if (cancel) return;
        const gm = new Map();
        for (const g of gs) { const a = gm.get(g.accounting_movement_id) || []; a.push(g); gm.set(g.accounting_movement_id, a); }
        setGuiasPorMov(gm);
      } catch {}
    };
    load();
    const on = (e) => { const t = e?.detail?.tabla; if (!t || t === 'pagos_partes' || t === 'guias_remision' || t === 'depositos_bancarizacion') load(); };
    window.addEventListener('jx_data_changed', on);
    window.addEventListener('jarvex_master_updated', on);
    return () => { cancel = true; window.removeEventListener('jx_data_changed', on); window.removeEventListener('jarvex_master_updated', on); };
  }, []);

  // Deep-link desde Guías de Remisión: pre-cargar la búsqueda con el documento.
  uEC(() => {
    const intent = window.__movsBuscarIntent;
    if (intent) { window.__movsBuscarIntent = null; setBusqueda(String(intent)); }
  }, []);

  const openBanc = (m) => {
    // Arranca en el caso más probable: sin pagos previos → Pago exacto (Caso 1)
    // con el monto pre-llenado; con partes ya registradas → Pago en partes
    // (Caso 3), continuando la cobertura.
    const partesPrev = partesPorMov.get(m.id) || [];
    const pagado = partesPrev.reduce((t, x) => t + (Number(x.monto) || 0), 0);
    const pend = Math.max(0, (Number(m.amount) || 0) - pagado);
    setBancTarget(m); setBancObra(m.obra_id || ''); setBancFile(null);
    setBancMetodo('transferencia'); setBancRef(''); setBancTotalDep(''); setBancDepId('');
    // Modo por defecto: 'exacto' salvo que haya un pago EN CURSO real (partes
    // que aún NO cubren el total). Con la factura ya cubierta, abrir en
    // "pago en partes" confundía a las asistentes (pedido 20-jul).
    setBancModo(partesPrev.length > 0 && pend > TOL ? 'parcial' : 'exacto');
    setBancMonto(partesPrev.length > 0 ? '' : (pend > 0 ? pend.toFixed(2) : ''));
  };

  // ── DETRACCIÓN (SPOT) ───────────────────────────────────────────────
  // La IA de Captura Mágica RECOMIENDA la detracción al registrar la factura;
  // acá la asistente sube la constancia del depósito (Banco de la Nación) y la
  // marca 'depositada', o registra/corrige una detracción que la IA no detectó.
  const openDetraccion = (m) => {
    setDetrTarget(m);
    setDetrFile(null);
    setDetrAplica(m.detraccion_aplica !== false); // si la abren, por defecto aplica
    setDetrPct(m.detraccion_pct != null ? String(m.detraccion_pct) : '');
    setDetrMonto(m.detraccion_monto != null ? String(m.detraccion_monto) : '');
    setDetrCodigo(m.detraccion_codigo || '');
    setDetrFecha(m.detraccion_constancia_fecha || window.__fecha?.hoyLocal?.() || new Date().toISOString().slice(0, 10));
  };

  const subirDetraccion = async () => {
    if (!detrTarget) return;
    const m = detrTarget;
    const monto = detrMonto !== '' ? Number(detrMonto) : null;
    const pct = detrPct !== '' ? Number(detrPct) : null;
    if (detrAplica) {
      if (!(monto > 0)) { showToast('Ingresá el monto de la detracción.', 'red'); return; }
      // Guard bruto/neto: la detracción es un % del total (típ. 4–12%), NO el neto.
      // Si el monto es ≥ la mitad del total, casi seguro cargaron el neto por error.
      const _tot = Number(m.amount) || 0;
      if (_tot > 0 && monto >= _tot * 0.5) {
        if (!window.confirm(`⚠ El monto de detracción (S/ ${monto.toFixed(2)}) es demasiado alto para el total de la factura (S/ ${_tot.toFixed(2)}).\n\nLa detracción es un PORCENTAJE del total (normalmente 4% a 12%), no el neto a pagar. ${pct ? `Al ${pct}% serían S/ ${(_tot * pct / 100).toFixed(2)}.` : ''}\n\n¿Confirmás igual?`)) return;
      }
    } else if (!window.confirm('¿Marcar que esta factura NO tiene detracción? Se quitarán sus datos de detracción del movimiento.')) {
      return;
    }
    setDetrSaving(true);
    try {
      const now = new Date().toISOString();
      const esDemo = m.demo === true;
      let evidenciaId = null;
      let depositada = false;
      // Constancia del depósito (opcional): si la sube, la detracción queda 'depositada'.
      if (detrAplica && detrFile) {
        evidenciaId = window.__newId();
        await window.__saveEvidenciaLocal({
          id: evidenciaId,
          obra_id: m.obra_id || null,
          tipo_evidencia: 'constancia_detraccion',
          modulo_relacionado: 'accounting_movements',
          registro_relacionado_id: m.id,
          nombre_archivo: detrFile.name,
          mime_type: detrFile.type || 'application/octet-stream',
          blob: detrFile,
          observaciones: `Constancia de detracción (Banco de la Nación)${pct != null ? ' · ' + pct + '%' : ''}`,
          created_by: userId,
          demo: esDemo,
        });
        depositada = true;
      }
      const patch = detrAplica ? {
        detraccion_aplica: true,
        detraccion_pct: pct,
        detraccion_monto: monto,
        detraccion_codigo: String(detrCodigo || '').trim() || null,
        detraccion_estado: depositada ? 'depositada' : (m.detraccion_estado === 'depositada' ? 'depositada' : 'pendiente'),
        detraccion_constancia_fecha: depositada ? (detrFecha || now.slice(0, 10)) : (m.detraccion_constancia_fecha || null),
      } : {
        detraccion_aplica: false,
        detraccion_pct: null, detraccion_monto: null, detraccion_codigo: null,
        detraccion_estado: null, detraccion_constancia_fecha: null,
      };
      await window.__db.accounting_movements.update(m.id, {
        ...patch,
        updated_at: now, updated_by: userId,
        version: (m.version ?? 0) + 1,
        sync_status: esDemo ? 'synced' : (m.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'),
      });
      // Al QUITAR la detracción, borrar también su constancia (si no, quedaba huérfana).
      if (!detrAplica) {
        try {
          const evs = await window.__db.evidencias.filter(e => e.modulo_relacionado === 'accounting_movements' && e.registro_relacionado_id === m.id && e.tipo_evidencia === 'constancia_detraccion' && !e.deleted_at).toArray();
          for (const ev of evs) {
            if (!esDemo) { try { await window.__supabase.from('evidencias').delete().eq('id', ev.id); } catch (e2) { console.warn('[detraccion] delete constancia server:', e2?.message); } }
            try { await window.__db.evidencias.delete(ev.id); } catch {}
            try { await window.__db.evidencias_blobs.delete(ev.id); } catch {}
          }
          if (evs.length) { try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'evidencias', source: 'detr-remove' } })); } catch {} }
        } catch (e3) { console.warn('[detraccion] cleanup constancia:', e3?.message); }
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'accounting_movements' } })); } catch {}
      if (evidenciaId) { try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'evidencias', source: 'detr-upload' } })); } catch {} }
      try { await window.__logAudit?.({ action: 'update', table: 'accounting_movements', recordId: m.id,
        reason: detrAplica ? (depositada ? 'Detracción: constancia de depósito registrada' : 'Detracción registrada/corregida') : 'Detracción quitada del movimiento' }); } catch {}
      showToast(detrAplica ? (depositada ? 'Detracción depositada y constancia adjunta.' : 'Detracción registrada (pendiente de depósito).') : 'Detracción quitada.', 'green');
      setDetrTarget(null); setDetrFile(null);
    } catch (e) {
      showToast('No se pudo registrar la detracción: ' + (e.message || e), 'red');
    } finally {
      setDetrSaving(false);
    }
  };

  // Eliminar un PAGO registrado (solo admin / contadora jefe): permite corregir
  // montos o rehacer la bancarización con OTRO tipo (p. ej. era voucher
  // multi-factura y se registró como pago directo). Soft-delete → viaja al
  // server como UPDATE con deleted_at; la cobertura de la factura y el saldo
  // del voucher se recalculan solos (los loaders filtran deleted_at).
  const eliminarParteBanc = async (p) => {
    if (!(isAdmin || myRol === 'contador')) return;
    const msj = `¿Eliminar el pago de ${fmtCur(p.monto, bancTarget?.currency)}${p.deposito_id ? ' (aplicado desde un voucher — su saldo se libera)' : ''}?\n\nDespués registrá la bancarización correcta (otro monto u otro tipo). Si la factura quedó "Pagado" por esta cobertura, ajustá el estado a mano si corresponde.`;
    if (!window.confirm(msj)) return;
    try {
      const { SYNC_STATUS } = await import('../db/jarvex.db');
      const now = new Date().toISOString();
      const p0 = await window.__db.pagos_partes.get(p.id);
      if (!p0) return;
      if (!p0.last_synced_at) {
        await window.__db.pagos_partes.delete(p.id); // nunca llegó al server
      } else {
        await window.__db.pagos_partes.update(p.id, { deleted_at: now, updated_at: now, sync_status: SYNC_STATUS.PENDING_UPDATE });
      }
      try { await window.__logAudit?.({ action:'delete', table:'pagos_partes', recordId: p.id, oldData:{ monto: p.monto, deposito_id: p.deposito_id || null }, reason:'Corrección de bancarización (pago eliminado por admin/contador)' }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'pagos_partes' } })); } catch {}
      try { window.dispatchEvent(new Event('online')); } catch {}
      showToast('Pago eliminado — ahora registrá la bancarización correcta', 'green');
    } catch (e) {
      showToast('No se pudo eliminar el pago: ' + (e.message || e), 'red');
    }
  };

  const subirBancarizacion = async () => {
    if (!bancTarget) return;
    const esDepNuevo = bancModo === 'dep_nuevo';
    const esDepExistente = bancModo === 'dep_existente';
    if (!esDepExistente && !bancFile) { showToast('Elegí el archivo de la bancarización (foto o PDF)', 'red'); return; }
    // Anti-duplicado: reintentar "porque no se ve" creaba una segunda evidencia
    // idéntica. Solo aplica al PAGO EXACTO (en pago-en-partes es normal subir
    // varios vouchers a la misma factura).
    if (bancModo === 'exacto') {
      const yaSubida = bancarizacionPorMov.get(bancTarget.id);
      if (yaSubida && yaSubida.sync !== 'failed' && !window.confirm('Este movimiento YA tiene una bancarización subida (aunque el estado de sync general muestre errores de otros registros). ¿Subir OTRA constancia de todos modos?')) return;
    }
    // Obra para archivar: la del movimiento o la elegida en el modal. Puede ser
    // NINGUNA: las facturas de Gastos Generales / Contabilidad Neta van sin obra
    // (evidencias.obra_id es opcional desde mig 141).
    const obraId = bancTarget.obra_id || bancObra || null;

    // ── Tope de la FACTURA (todos los casos): lo aplicado no puede exceder lo
    // pendiente. Pago exacto = cubre exactamente lo que falta (monto automático).
    const _partesMov = partesPorMov.get(bancTarget.id) || [];
    const _pagado = _partesMov.reduce((t, x) => t + (Number(x.monto) || 0), 0);
    const _pendiente = Math.max(0, (Number(bancTarget.amount) || 0) - _pagado);
    const montoAplicar = bancModo === 'exacto' ? _pendiente : Number(bancMonto);
    // Cubierta al 100% + "pago exacto" = botón CAMBIAR: se adjunta la nueva
    // constancia SIN registrar otra parte (monto 0) en vez de bloquear.
    const esSoloConstancia = bancModo === 'exacto' && !(_pendiente > TOL);
    if (bancModo === 'parcial' && !(montoAplicar > 0)) { showToast('Indicá el monto de ESTE pago (la factura se está pagando en partes)', 'red'); return; }
    if (montoAplicar > _pendiente + TOL) {
      showToast(`El pago excede lo pendiente de la factura: quedan ${fmtCur(_pendiente, bancTarget.currency)} por cubrir (de ${fmtCur(bancTarget.amount, bancTarget.currency)})`, 'red');
      return;
    }

    const { newId, newIdempotencyKey, SYNC_STATUS } = await import('../db/jarvex.db');
    const esPrueba = (() => { try { return getCurrentMode() === 'prueba'; } catch { return false; } })();
    // Modo PRUEBA (o movimiento demo): NADA sube al server — antes la evidencia
    // se guardaba sin flag demo y el uploader la subía al Storage REAL apuntando
    // a un movimiento demo (fuga demo→real).
    const esDemo = esPrueba || bancTarget.demo === true;
    const now = new Date().toISOString();
    const hoy = (window.__fecha?.hoyLocal ? window.__fecha.hoyLocal() : now.slice(0, 10));
    const syncDemo = esDemo ? { demo: true, sync_status: SYNC_STATUS.SYNCED } : { sync_status: SYNC_STATUS.PENDING_CREATE };

    // Validaciones de los modos DEPÓSITO (multi-factura) ANTES de tocar la BD:
    // saldo suficiente + mismo pagador→cobrador (lib/depositos-bancarizacion).
    let depositoNuevo = null;
    let depositoElegido = null;
    if (esDepNuevo) {
      const total = Number(bancTotalDep);
      if (!(total > 0)) { showToast('Indicá el monto TOTAL del depósito/transferencia', 'red'); return; }
      if (!(montoAplicar > 0)) { showToast('Indicá cuánto de este depósito cubre ESTA factura', 'red'); return; }
      depositoNuevo = {
        id: newId(), obra_id: obraId, company_id: bancTarget.company_id || null,
        clase: claseDe(bancTarget),
        tercero_ruc: bancTarget.third_party_ruc || null,
        tercero_nombre: bancTarget.third_party_name || null,
        fecha: hoy, monto_total: total, moneda: bancTarget.currency || 'PEN',
        metodo: bancMetodo || 'transferencia', referencia: bancRef || null,
        evidencia_id: null, observaciones: 'Depósito de bancarización multi-factura',
        created_by: userId, updated_by: userId, created_at: now, updated_at: now, version: 1,
        idempotency_key: newIdempotencyKey(userId, 'depositos_bancarizacion'),
        ...syncDemo,
      };
      const v = validarVinculoDeposito({ deposito: depositoNuevo, partesDeposito: [], movimiento: bancTarget, monto: montoAplicar });
      if (!v.ok) { showToast(v.error, 'red'); return; }
    } else if (esDepExistente) {
      depositoElegido = depositosById.get(bancDepId);
      if (!depositoElegido) { showToast('Elegí el voucher con saldo a usar', 'red'); return; }
      if (!(montoAplicar > 0)) { showToast('Indicá cuánto del voucher cubre ESTA factura', 'red'); return; }
      const v = validarVinculoDeposito({ deposito: depositoElegido, partesDeposito: partesPorDeposito.get(bancDepId) || [], movimiento: bancTarget, monto: montoAplicar });
      if (!v.ok) { showToast(v.error, 'red'); return; }
    }

    // Ventana de confirmación (pedido 20-jul): una vez subida, la bancarización
    // queda FIJA para las asistentes — el cambio se solicita al admin o a la
    // Contadora Jefe. En pagos en partes se confirma parte por parte.
    {
      const _restan = Math.max(0, _pendiente - montoAplicar);
      const _queSube =
        esSoloConstancia ? 'Vas a adjuntar una NUEVA constancia a esta factura (ya cubierta al 100%) — no se registra ningún monto adicional.' :
        esDepNuevo ? `Vas a registrar un VOUCHER de ${fmtCur(Number(bancTotalDep), bancTarget.currency)} y aplicarle ${fmtCur(montoAplicar, bancTarget.currency)} a esta factura.` :
        esDepExistente ? `Vas a aplicar ${fmtCur(montoAplicar, bancTarget.currency)} del voucher elegido a esta factura.` :
        bancModo === 'parcial' ? `Vas a subir la constancia n.º ${_partesMov.length + 1} de esta factura, por ${fmtCur(montoAplicar, bancTarget.currency)}.` :
        `Vas a subir la bancarización de esta factura por ${fmtCur(montoAplicar, bancTarget.currency)} (cubre todo lo pendiente).`;
      const _aviso = myRol === 'ayudante_contador'
        ? 'IMPORTANTE: una vez subida NO podrás cambiarla ni eliminarla por tu cuenta — el cambio se solicita al administrador o a la Contadora Jefe (botón "Solicitar").'
        : 'Revisá que el archivo y el monto sean correctos antes de confirmar.';
      const _lineas = [_queSube];
      if (_restan > TOL) _lineas.push(`Tras este pago quedarán ${fmtCur(_restan, bancTarget.currency)} por cubrir.`);
      _lineas.push('', _aviso, '', '¿Confirmás subir esta bancarización?');
      if (!window.confirm(_lineas.join('\n'))) return;
    }

    setBancSaving(true);
    try {
      // 1) Evidencia (constancia). En pago exacto/parcial va al MOVIMIENTO; en depósito
      // NUEVO va al DEPÓSITO (una sola constancia respalda varias facturas).
      // En depósito EXISTENTE no hay archivo: ya se subió al crear el depósito.
      let evidenciaId = null;
      if (!esDepExistente) {
        evidenciaId = window.__newId();
        await window.__saveEvidenciaLocal({
          id: evidenciaId,
          obra_id: obraId,
          tipo_evidencia: 'bancarizacion',
          modulo_relacionado: esDepNuevo ? 'depositos_bancarizacion' : 'accounting_movements',
          registro_relacionado_id: esDepNuevo ? depositoNuevo.id : bancTarget.id,
          nombre_archivo: bancFile.name,
          mime_type: bancFile.type || 'application/octet-stream',
          blob: bancFile,
          observaciones: esDepNuevo
            ? `Constancia de depósito multi-factura (${fmtCur(Number(bancTotalDep), bancTarget.currency)})`
            : 'Evidencia de bancarización (> S/2000)',
          created_by: userId,
          demo: esDemo,
        });
      }
      // 2) Depósito nuevo (si aplica).
      if (esDepNuevo) {
        depositoNuevo.evidencia_id = evidenciaId;
        await window.__db.depositos_bancarizacion.add(depositoNuevo);
        try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'depositos_bancarizacion' } })); } catch {}
      }
      // 3) PARTE del pago: registra cuánto va cubierto de ESTA factura (con
      // depósito o suelta). La suma vs el total se ve en la columna.
      let parteOk = false;
      if (esDepNuevo || esDepExistente || montoAplicar > 0) {
        try {
          await window.__db.pagos_partes.add({
            id: newId(), pago_id: null, accounting_movement_id: bancTarget.id, obra_id: obraId,
            deposito_id: esDepNuevo ? depositoNuevo.id : (esDepExistente ? depositoElegido.id : null),
            fecha: hoy,
            monto: montoAplicar, metodo: bancMetodo || 'transferencia',
            referencia: esDepExistente ? (depositoElegido.referencia || null) : (bancRef || null),
            evidencia_id: esDepNuevo ? evidenciaId : null,
            observaciones: (esDepNuevo || esDepExistente) ? 'Cubierto por voucher multi-factura'
              : bancModo === 'exacto' ? 'Pago exacto de la factura' : 'Pago parcial (bancarización en partes)',
            created_by: userId, updated_by: userId, created_at: now, updated_at: now, version: 1,
            idempotency_key: newIdempotencyKey(userId, 'pagos_partes'),
            ...syncDemo,
          });
          parteOk = true;
          try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'pagos_partes' } })); } catch {}
        } catch (e2) {
          console.warn('[banc-parte]', e2?.message);
          showToast('La evidencia se adjuntó, pero la PARTE (monto) no se pudo registrar — reintentá desde el modal', 'amber');
        }
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'evidencias', source:'banc-upload' } })); } catch {}
      try { await window.__logAudit?.({ action:'insert', table:'evidencias', recordId: bancTarget.id,
        reason: esDepNuevo ? 'Depósito de bancarización multi-factura creado desde Movimientos'
          : esDepExistente ? 'Factura cubierta con saldo de depósito existente'
          : 'Bancarización adjunta desde Movimientos (sin edición)' }); } catch {}
      // Regla de cumplimiento (jul 2026): al quedar la factura CUBIERTA al 100%
      // por su(s) bancarización(es), pasa automáticamente a "Pagado".
      let marcadaPagada = false;
      const quedaCubierta = (_pagado + montoAplicar) >= (Number(bancTarget.amount) || 0) - TOL;
      if (quedaCubierta && bancTarget.payment_status !== 'paid') {
        try {
          await window.__db.accounting_movements.update(bancTarget.id, {
            payment_status: 'paid',
            updated_at: now, updated_by: userId,
            version: (bancTarget.version ?? 0) + 1,
            sync_status: bancTarget.demo === true ? 'synced' : (bancTarget.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'),
          });
          marcadaPagada = true;
          try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'accounting_movements' } })); } catch {}
        } catch (e3) { console.warn('[banc→pagado]', e3?.message); }
      }
      const saldoTxt = esDepNuevo
        ? ` · saldo restante del voucher: ${fmtCur(Number(bancTotalDep) - montoAplicar, bancTarget.currency)}`
        : esDepExistente
          ? ` · saldo restante del voucher: ${fmtCur(saldoDeposito(depositoElegido, partesPorDeposito.get(bancDepId) || []) - montoAplicar, bancTarget.currency)}`
          : '';
      const cubiertaTxt = quedaCubierta
        ? ` · factura cubierta al 100% ✅${marcadaPagada ? ' · estado → Pagado' : ''}`
        : ` · faltan ${fmtCur(Math.max(0, (Number(bancTarget.amount) || 0) - _pagado - montoAplicar), bancTarget.currency)}`;
      showToast(parteOk
        ? `Bancarización registrada · ${fmtCur(montoAplicar, bancTarget.currency)} aplicados${saldoTxt}${cubiertaTxt}`
        : 'Bancarización adjunta. Se sincronizará en breve.', 'green');
      setBancTarget(null); setBancFile(null); setBancObra(''); setBancMonto(''); setBancRef(''); setBancModo('exacto'); setBancTotalDep(''); setBancDepId('');
    } catch (e) {
      showToast('No se pudo adjuntar la bancarización: ' + (e.message || e), 'red');
    } finally {
      setBancSaving(false);
    }
  };

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Movimientos Contables</div>
          <div className="pg-sub">{filtered.length} de {(movs || []).length} movimientos · ingresos / costos / gastos por empresa</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          <button className="btn btn-ghost btn-sm" title="Reporte de recepción: de lo facturado, cuánto llegó a obra, cuánto falta y cuánto es consumo de empresa" onClick={()=>setShowReporte(true)}>
            📊 Recepción
          </button>
          <button className="btn btn-ghost btn-sm" title="Consultas con almacén — preguntar/responder si un insumo llegó" onClick={()=>setShowConsultas(true)}>
            💬 Consultas{consResumen.pendientes ? <span className="badge b-amber" style={{ marginLeft:4 }}>{consResumen.pendientes}</span> : ''}
          </button>
          <button className="btn btn-ghost btn-sm" title="Insumos facturados que NO ingresaron a obra: comprobar con almacén, separarlos y venderlos" onClick={()=>setShowVenta(true)}>
            🏷 Para venta
          </button>
          {puedeDedup && (
            <button className="btn btn-ghost btn-sm" title="Detectar comprobantes registrados dos veces y fusionarlos" onClick={abrirDuplicados}>
              <JxIcon name="search" size={13}/> Duplicados
            </button>
          )}
          {canWrite ? (
            <button className="btn btn-amber btn-sm" onClick={openNuevo}>
              <JxIcon name="plus" size={13}/>Nuevo Movimiento
            </button>
          ) : (
            <span className="badge b-gray" title="Tu rol es solo lectura para Movs. Contables">Solo lectura</span>
          )}
        </div>
      </div>

      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:14 }}>
        <div className="search-bar" style={{ flex:'1 1 200px' }}><JxIcon name="search" size={14} color="var(--tm)"/><input placeholder="Buscar descripción / cliente / doc…" value={busqueda} onChange={e=>setBusqueda(e.target.value)}/></div>
        <select className="fi" value={filtroObraSel} onChange={e=>setFiltroObraSel(e.target.value)} style={{ minWidth:170, maxWidth:240 }}
          title="Filtrar por OBRA — se combina con el filtro de empresa">
          <option value="todas">🏗 Todas las obras</option>
          {obrasParaSelector.map(o => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}
        </select>
        <select className="fi" value={filtroEmpresaSel} onChange={e=>setFiltroEmpresaSel(e.target.value)} style={{ minWidth:170, maxWidth:240 }}
          title="Filtrar por EMPRESA del grupo — se combina con el filtro de obra">
          <option value="todas">🏢 Todas las empresas</option>
          {companiesActivas.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="fi" value={filtroMes} onChange={e=>setFiltroMes(e.target.value)} style={{ minWidth:150 }}
          title="Ver solo los comprobantes de un mes, o un rango de fechas a medida">
          <option value="todos">📅 Todo el período</option>
          {opcionesMes.map(ym => <option key={ym} value={ym}>{mesLabel(ym)}</option>)}
          <option value="custom">Personalizado…</option>
        </select>
        {filtroMes === 'custom' && (
          <>
            <label style={{ fontSize:11, color:'var(--tm)' }}>Del</label>
            <input className="fi" type="date" value={filtroDesde} onChange={e=>setFiltroDesde(e.target.value)} style={{ minWidth:135 }}/>
            <label style={{ fontSize:11, color:'var(--tm)' }}>al</label>
            <input className="fi" type="date" value={filtroHasta} onChange={e=>setFiltroHasta(e.target.value)} style={{ minWidth:135 }}/>
          </>
        )}
        <select className="fi" value={filtroClase} onChange={e=>setFiltroClase(e.target.value)} style={{ minWidth:120 }} title="Compras (a proveedoras) vs Ventas (emitidas a la ejecutora)">
          <option value="todos">Compras y ventas</option>
          <option value="compra">🛒 Compras</option>
          <option value="venta">🧾 Ventas</option>
        </select>
        <select className="fi" value={filtroTipo} onChange={e=>setFiltroTipo(e.target.value)} style={{ minWidth:120 }}>
          <option value="todos">Todos</option>
          <option value="income">Ingresos</option>
          <option value="cost">Costos</option>
          <option value="expense">Gastos</option>
        </select>
        <select className="fi" value={filtroEstado} onChange={e=>setFiltroEstado(e.target.value)} style={{ minWidth:120 }}>
          <option value="todos">Todos</option>
          <option value="paid">Pagados</option>
          <option value="pending">Pendientes</option>
          <option value="cancelled">Anulados</option>
        </select>
        <select className="fi" value={filtroEmisor} onChange={e=>setFiltroEmisor(e.target.value)} style={{ minWidth:170, maxWidth:240 }} title="Quién EMITIÓ el comprobante (proveedores o nuestras empresas)">
          <option value="todos">Emisor: todos</option>
          {opcionesEmisor.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <select className="fi" value={filtroReceptor} onChange={e=>setFiltroReceptor(e.target.value)} style={{ minWidth:170, maxWidth:240 }} title="Quién RECIBIÓ el comprobante (normalmente nuestras empresas)">
          <option value="todos">Receptor: todos</option>
          {opcionesReceptor.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      {/* Resumen del PERÍODO filtrado: cuántos comprobantes y totales por clase.
          Le responde a la asistente "¿cuánto compramos/vendimos en Junio?" sin
          tener que sumar a mano. Anulados excluidos; NC restan (monto negativo). */}
      {filtroMes !== 'todos' && (() => {
        const sum = { venta: {}, compra: {} };
        for (const m of filtered) {
          if (m.payment_status === 'cancelled') continue;
          const cl = (m.clase || (m.type === 'income' ? 'venta' : 'compra')) === 'venta' ? 'venta' : 'compra';
          const cur = m.currency || 'PEN';
          sum[cl][cur] = (sum[cl][cur] || 0) + (Number(m.amount) || 0);
        }
        const fmtSum = (obj) => {
          const parts = Object.entries(obj).map(([c, v]) => `${c === 'USD' ? '$' : 'S/'} ${v.toLocaleString('es-PE', { maximumFractionDigits: 2 })}`);
          return parts.length ? parts.join(' · ') : 'S/ 0';
        };
        const label = filtroMes === 'custom'
          ? `${filtroDesde || 'inicio'} → ${filtroHasta || 'hoy'}`
          : mesLabel(filtroMes);
        return (
          <div style={{ display:'flex', gap:14, flexWrap:'wrap', alignItems:'center', padding:'8px 14px', marginBottom:12, borderRadius:8, background:'rgba(59,130,246,0.07)', border:'1px solid rgba(59,130,246,0.3)', fontSize:12 }}>
            <span style={{ fontWeight:700, color:'var(--blue)' }}>📅 {label}</span>
            <span style={{ color:'var(--ts)' }}>{filtered.length} comprobante{filtered.length === 1 ? '' : 's'}</span>
            <span style={{ color:'var(--green)' }}>🧾 Ventas: <strong>{fmtSum(sum.venta)}</strong></span>
            <span style={{ color:'var(--amber)' }}>🛒 Compras: <strong>{fmtSum(sum.compra)}</strong></span>
            <button className="btn btn-ghost btn-xs" style={{ marginLeft:'auto' }} title="Volver a ver todo el período"
              onClick={()=>{ setFiltroMes('todos'); setFiltroDesde(''); setFiltroHasta(''); }}>
              ✕ Quitar filtro de período
            </button>
          </div>
        );
      })()}

      {/* Aviso visible de bancarizaciones faltantes. Cualquiera con acceso de
          escritura (incluido el ayudante de contabilidad) puede subirlas sin
          entrar a editar el movimiento. */}
      {canWrite && (() => {
        const pend = filtered.filter(faltaBancarizacion);
        if (!pend.length && !soloSinBanc) return null;
        return (
          <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', padding:'10px 14px', marginBottom:12, borderRadius:8, background: pend.length ? 'rgba(242,183,5,0.08)' : 'rgba(46,204,113,0.08)', border: `1px solid ${pend.length ? 'rgba(242,183,5,0.35)' : 'rgba(46,204,113,0.35)'}` }}>
            <JxIcon name={pend.length ? 'alert' : 'check'} size={16} color={pend.length ? 'var(--amber)' : 'var(--green)'}/>
            {pend.length ? (
              <>
                <span style={{ fontSize:13, color:'var(--amber)', fontWeight:600 }}>
                  {pend.length} movimiento{pend.length>1?'s':''} de más de S/2000 sin bancarización
                </span>
                <span style={{ fontSize:11, color:'var(--tm)' }}>Subí el voucher/constancia desde el botón “Subir” de cada fila — no hace falta editar.</span>
              </>
            ) : (
              <span style={{ fontSize:13, color:'var(--green)', fontWeight:600 }}>No quedan movimientos sin bancarización en este filtro.</span>
            )}
            <button className="btn btn-ghost btn-xs" style={{ marginLeft:'auto' }} onClick={()=>setSoloSinBanc(v=>!v)}>
              {soloSinBanc ? 'Ver todos' : `Ver los ${pend.length} pendientes`}
            </button>
          </div>
        );
      })()}

      {/* Bandeja de la Contadora Jefe: facturas "No sé / No me acuerdo". */}
      {esRevisorDestino && sinClasificar.length > 0 && (
        <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', padding:'10px 14px', marginBottom:12, borderRadius:8, background:'rgba(155,89,182,0.10)', border:'1px solid rgba(155,89,182,0.4)' }}>
          <span style={{ fontSize:15 }}>🤔</span>
          <span style={{ fontSize:13, fontWeight:600, color:'#B980D6' }}>
            {sinClasificar.length} factura{sinClasificar.length > 1 ? 's' : ''} sin clasificar — las asistentes marcaron "No sé"
          </span>
          <span style={{ fontSize:11, color:'var(--tm)' }}>Revisalas y asignales obra, gastos generales o contabilidad neta.</span>
          <button className="btn btn-sm" style={{ marginLeft:'auto', background:'rgba(155,89,182,0.18)', color:'#B980D6', border:'1px solid rgba(155,89,182,0.4)' }}
            onClick={()=>{ setBandejaSel(new Map()); setBandejaOpen(true); }}>
            Revisar bandeja →
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="dollar" size={40} color="var(--tm)"/>
          <p>No hay movimientos {(movs || []).length > 0 ? (soloSinBanc ? 'sin bancarización con este filtro' : 'que coincidan con el filtro') : 'registrados aún'}.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <div style={{ overflowX:'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Fecha</th><th>Empresa</th><th>Tipo</th>
                <th>Descripción</th><th>Cliente / Proveedor</th><th>Doc.</th>
                <th style={{ textAlign:'right' }}>Monto</th><th>Estado</th>
                <th style={{ textAlign:'center' }}>Acciones</th>
              </tr></thead>
              <tbody>
                {movPg.pagedItems.map(m => {
                  const c = lookupCompany(m.company_id);
                  const isIc = m.is_intercompany;
                  let esEspejoAuto = false;
                  try { esEspejoAuto = !!(JSON.parse(m.notas || '{}')?.intercompany_auto); } catch {}
                  return (
                    <tr key={m.id} style={isIc ? { background:'rgba(52,152,219,0.04)' } : null}>
                      <td className="col-m">{m.date}</td>
                      <td className="col-p">{c?.name || '—'}</td>
                      <td>
                        {(() => { const cl = m.clase || (m.type === 'income' ? 'venta' : 'compra'); return (
                          <span className={`badge ${cl === 'venta' ? 'b-green' : 'b-amber'}`} title={cl === 'venta' ? 'Venta (emitida a la ejecutora)' : 'Compra (a proveedora)'}>{cl === 'venta' ? '🧾 Venta' : '🛒 Compra'}</span>
                        ); })()}
                        <div style={{ marginTop:3 }}><span className={`badge ${TYPE_BADGE[m.type]}`} style={{ fontSize:9 }}>{TYPE_LABEL[m.type]}</span></div>
                        {isIc && <div style={{ marginTop:3 }}><span className="badge b-blue" title="Operación interna entre empresas del grupo" style={{ fontSize:9 }}>INTERCO</span></div>}
                        {esEspejoAuto && <div style={{ marginTop:3 }}><span className="badge" title="Contraparte generada automáticamente al subir la venta interna. Se puede reemplazar subiendo el comprobante real en Captura Mágica." style={{ fontSize:9, background:'rgba(243,156,18,0.18)', color:'#E39A2B' }}>🔁 AUTO</span></div>}
                      </td>
                      <td>
                        {m.description || '—'}
                        {m.category && <div style={{ fontSize:10, color:'var(--tm)' }}>{m.category}</div>}
                        {m.obra_id && <div style={{ fontSize:10, color:'var(--blue)' }}>🏗 {obraNombre(m.obra_id) || 'obra'}</div>}
                        {!m.obra_id && m.destino_contable === 'sin_clasificar' && (
                          <div><span className="badge" style={{ fontSize:9, background:'rgba(155,89,182,0.18)', color:'#B980D6', cursor: esRevisorDestino ? 'pointer' : 'default' }}
                            title={esRevisorDestino ? 'Sin clasificar — click para abrir la bandeja y asignarle destino' : 'Sin clasificar — pendiente de la Contadora Jefe'}
                            onClick={()=>{ if (esRevisorDestino) { setBandejaSel(new Map()); setBandejaOpen(true); } }}>🤔 Sin clasificar</span></div>
                        )}
                        {!m.obra_id && m.destino_contable === 'gastos_generales' && <div style={{ fontSize:10, color:'var(--tm)' }}>🏢 Gastos Generales</div>}
                        {!m.obra_id && m.destino_contable === 'contabilidad_neta' && <div style={{ fontSize:10, color:'var(--tm)' }}>📄 Contabilidad Neta</div>}
                        {puedeVerBanc && m.currency === 'PEN' && Number(m.amount) > 2000 && (() => {
                          const evB = bancarizacionPorMov.get(m.id);
                          // Suma de PARTES registradas (bancarización parcial y/o depósitos).
                          const _partes = partesPorMov.get(m.id) || [];
                          const _suma = _partes.reduce((t, x) => t + (Number(x.monto) || 0), 0);
                          const _total = Number(m.amount) || 0;
                          const _completa = (evB && evB.sync === 'uploaded' && _partes.length === 0) || _suma >= _total - 0.01;
                          // "Subir" cuando falta. Cuando ya está cubierta al 100%,
                          // "Cambiar" es SOLO de admin/contadora jefe; la asistente
                          // pide el cambio con "Solicitar cambio" (pedido 20-jul).
                          const _puedeCambiar = isAdmin || myRol === 'contador';
                          const subirBtn = !canWrite ? null : (_completa && !_puedeCambiar) ? (
                            esAyudante ? (
                              <button className="btn btn-ghost btn-xs" style={{ marginLeft:6, padding:'1px 6px', fontSize:9, verticalAlign:'middle' }}
                                title="La bancarización ya está registrada: el cambio lo aplica el admin o la Contadora Jefe" onClick={()=>setSolicitarTarget(m)}>
                                <JxIcon name="edit" size={9}/> Solicitar cambio
                              </button>
                            ) : null
                          ) : (
                            <button className="btn btn-amber btn-xs" style={{ marginLeft:6, padding:'1px 6px', fontSize:9, verticalAlign:'middle' }} onClick={()=>openBanc(m)}
                              title={_completa ? 'Cambiar la constancia o corregir los pagos registrados (incluso el tipo)' : 'Subir la bancarización sin entrar a editar'}>
                              <JxIcon name="upload" size={9}/> {_completa ? 'Cambiar' : 'Subir'}
                            </button>
                          );
                          // Ver la constancia de bancarización (pedido 20-jul).
                          const verBanc = (evB && evB.url) ? (
                            <button className="btn btn-ghost btn-xs" style={{ marginLeft:4, padding:'0 4px', fontSize:9, verticalAlign:'middle', color:'var(--blue)' }}
                              title="Ver la constancia de bancarización" onClick={()=>setEvidenciaModal(evB)}>
                              <JxIcon name="eye" size={9}/> Ver
                            </button>
                          ) : null;
                          // Depósitos multi-factura que respaldan partes de este movimiento
                          // (la constancia vive en el depósito → botón para verla).
                          const _depsIds = [...new Set(_partes.filter(x => x.deposito_id && depositosById.get(x.deposito_id)).map(x => x.deposito_id))];
                          const _depsBtns = _depsIds.map(did => {
                            const d = depositosById.get(did);
                            const evD = bancPorDeposito.get(did);
                            return (
                              <button key={did} className="btn btn-ghost btn-xs" disabled={!evD}
                                style={{ padding:'0 4px', fontSize:9, color:'var(--blue)', verticalAlign:'middle' }}
                                title={`Depósito ${d.referencia || 's/ref'} de ${fmtCur(d.monto_total, d.moneda)} — click para ver la constancia`}
                                onClick={() => evD && setEvidenciaModal(evD)}>
                                🏦 {d.referencia || 'depósito'}
                              </button>
                            );
                          });
                          const _tagPartes = _partes.length > 0
                            ? <div style={{ fontSize:9.5, color: _suma >= _total - 0.01 ? 'var(--green)' : 'var(--amber)' }} title={_partes.map(x => fmtCur(x.monto, m.currency)).join(' + ')}>{_partes.length} parte(s): {fmtCur(_suma, m.currency)} de {fmtCur(_total, m.currency)}{_depsBtns}</div>
                            : null;
                          const _cubiertaPorPartes = movimientoBancarizado({ mov: m, tieneEvidenciaDirecta: false, partes: _partes, depositosById });
                          if (evB && evB.sync === 'uploaded') return <div style={{ fontSize:10, color:'var(--green)' }}>✅ Bancarizado{_suma > 0 && _suma < _total - 0.01 ? <span style={{ color:'var(--amber)' }} title="Las partes registradas no completan el total"> (parcial)</span> : null}{verBanc}{subirBtn}{_tagPartes}</div>;
                          {/* Cubierta por partes/depósitos = bancarizada — una evidencia
                              directa vieja atascada NO debe tapar el estado bueno. */}
                          if (_cubiertaPorPartes) return <div style={{ fontSize:10, color:'var(--green)' }}>✅ Bancarizado{_partes.some(x => x.deposito_id) ? ' (depósito)' : ''}{verBanc}{subirBtn}{_tagPartes}</div>;
                          if (evB && evB.sync === 'failed') return <div style={{ fontSize:10, color:'var(--red)' }} title="La evidencia no se pudo subir (revisá que estés asignado a la obra con un rol que no sea solo lectura)">⚠ Bancarización no subió{subirBtn}</div>;
                          if (evB) return <div style={{ fontSize:10, color:'var(--tm)' }} title="Subiendo evidencia de bancarización…">⏳ Subiendo bancarización{subirBtn}</div>;
                          return <div style={{ fontSize:10, color:'var(--amber)' }} title="Monto > S/2000 sin evidencia de bancarización">⚠ Falta bancarización{subirBtn}{_tagPartes}</div>;
                        })()}
                        {/* ≤ S/2,000 (o moneda extranjera): evidencia de pago OPCIONAL —
                            no es exigencia de bancarización, pero pueden adjuntarla. */}
                        {puedeVerBanc && !(m.currency === 'PEN' && Number(m.amount) > 2000) && (() => {
                          const evB = bancarizacionPorMov.get(m.id);
                          if (evB) return (
                            <div style={{ fontSize:10, color:'var(--green)' }}>
                              <span style={{ cursor:'pointer' }} title="Ver la constancia del pago" onClick={()=>setEvidenciaModal(evB)}>✅ Pago adjunto</span>
                              {canWrite && <button className="btn btn-ghost btn-xs" style={{ marginLeft:4, padding:'0 4px', fontSize:9 }} onClick={()=>openBanc(m)} title="Adjuntar otra constancia">+</button>}
                            </div>
                          );
                          if (!canWrite) return null;
                          return (
                            <div><button className="btn btn-ghost btn-xs" style={{ padding:'1px 6px', fontSize:9, color:'var(--tm)' }}
                              onClick={()=>openBanc(m)} title="Opcional: adjuntar la constancia del pago (voucher, transferencia, depósito)">
                              📎 Subir pago (opcional)
                            </button></div>
                          );
                        })()}
                        {/* DETRACCIÓN (SPOT) — compras y ventas. La IA la recomienda al capturar;
                            la asistente sube la constancia del depósito (BN) y marca 'depositada'. */}
                        {puedeVerBanc && (() => {
                          const evD = detraccionPorMov.get(m.id);
                          if (m.detraccion_aplica) {
                            const _monto = Number(m.detraccion_monto) || 0;
                            const _neto = Math.max(0, (Number(m.amount) || 0) - _monto);
                            const depositada = m.detraccion_estado === 'depositada';
                            return (
                              <div style={{ fontSize:10, marginTop:2, color: depositada ? 'var(--green)' : 'var(--amber)' }}
                                title={`Detracción${m.detraccion_pct != null ? ' ' + m.detraccion_pct + '%' : ''}${m.detraccion_codigo ? ' · código ' + m.detraccion_codigo : ''} · neto a pagar ${fmtCur(_neto, m.currency)}`}>
                                {depositada ? '✅' : '⏳'} Detracción {fmtCur(_monto, m.currency)}{m.detraccion_pct != null ? ` (${m.detraccion_pct}%)` : ''}{depositada ? ' · depositada' : ' · falta depósito'}
                                {evD && evD.url && (
                                  <button className="btn btn-ghost btn-xs" style={{ marginLeft:4, padding:'0 4px', fontSize:9, color:'var(--blue)', verticalAlign:'middle' }}
                                    title="Ver la constancia de detracción" onClick={()=>setEvidenciaModal(evD)}>
                                    <JxIcon name="eye" size={9}/> Ver
                                  </button>
                                )}
                                {canWrite && (
                                  <button className="btn btn-amber btn-xs" style={{ marginLeft:4, padding:'1px 6px', fontSize:9, verticalAlign:'middle' }}
                                    onClick={()=>openDetraccion(m)} title={depositada ? 'Cambiar la constancia o corregir la detracción' : 'Registrar el depósito de detracción (subir constancia)'}>
                                    <JxIcon name="upload" size={9}/> {depositada ? 'Cambiar' : 'Registrar depósito'}
                                  </button>
                                )}
                              </div>
                            );
                          }
                          if (!canWrite) return null;
                          return (
                            <div><button className="btn btn-ghost btn-xs" style={{ padding:'1px 6px', fontSize:9, color:'var(--tm)' }}
                              onClick={()=>openDetraccion(m)} title="¿Esta factura tiene detracción (SPOT)? Registrala acá.">
                              ＋ Detracción
                            </button></div>
                          );
                        })()}
                        {/* SEMÁFORO DE RECEPCIÓN — ¿los insumos de esta factura llegaron a almacén?
                            Solo lectura: lee recepcion_status + items_factura (el enlace lo crean
                            Captura Mágica y "Vinculación de Compras"). Puente contabilidad↔almacén. */}
                        {(() => {
                          const rr = resumenRecepcion(m);
                          if (!rr.aplica) return null;
                          const col = rr.tone === 'green' ? 'var(--green)' : rr.tone === 'red' ? '#EF6B5E' : rr.tone === 'muted' ? 'var(--tm)' : 'var(--amber)';
                          const accionable = canWrite && (rr.estado === 'sin_confirmar' || rr.estado === 'parcial');
                          return (
                            <div style={{ fontSize:10, marginTop:2, color: col, display:'flex', alignItems:'center', gap:4, flexWrap:'wrap' }}
                              title={`Recepción en almacén: ${rr.label}${rr.total ? ` · ${rr.recibidos}/${rr.total} ítems recibidos` : ''}`}>
                              <span>{rr.emoji} {rr.label}</span>
                              {accionable && (
                                <button className="btn btn-ghost btn-xs" style={{ padding:'0 5px', fontSize:9, color:'var(--blue, #3498DB)' }}
                                  onClick={()=>buscarIngresos(m)} title="Buscar los ingresos de almacén que corresponden a esta factura y vincularlos">
                                  🔎 ¿llegó?
                                </button>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td>{m.third_party_name || '—'}</td>
                      <td className="col-m" style={{ fontSize:11 }}>
                        {m.document_type ? `${m.document_type} ${m.document_number || ''}` : '—'}
                        {(guiasPorMov.get(m.id) || []).map(g => (
                          <button key={g.id} className="btn btn-ghost btn-xs" style={{ display:'block', padding:'1px 4px', fontSize:9.5, color:'var(--blue, #3498DB)' }}
                            title={`Guía de remisión vinculada — click para abrirla`}
                            onClick={() => { window.__guiasFocusIntent = g.serie_correlativo || ''; window.__navTo?.('guias-remision'); }}>
                            📄 {g.serie_correlativo || 'guía'}
                          </button>
                        ))}
                      </td>
                      <td style={{ textAlign:'right', fontWeight:700, color:TYPE_COLOR[m.type] }} className="col-num">{fmtCur(m.amount, m.currency)}</td>
                      <td>
                        <select className="fi" value={m.payment_status} disabled={esAyudante || isIc} title={esAyudante ? 'Solo lectura — usá "Solicitar" para pedir un cambio' : undefined} onChange={e=>cambiarEstadoPago(m, e.target.value)} style={{ fontSize:11, padding:'4px 6px', minWidth:110 }}>
                          <option value="pending">⏱ Pendiente</option>
                          <option value="paid">✓ Pagado</option>
                          <option value="cancelled">✗ Anulado</option>
                        </select>
                      </td>
                      <td style={{ textAlign:'center', whiteSpace:'nowrap' }}>
                        {/* Botón ver archivo — visible solo si hay
                            evidencia (PDF/imagen) vinculada al mov. */}
                        {evidenciasPorMov.has(m.id) && (() => {
                          const ev = evidenciasPorMov.get(m.id);
                          return (
                            <button className="btn btn-ghost btn-xs"
                              title="Ver factura adjunta"
                              onClick={() => setEvidenciaModal(ev)}
                              style={{ marginRight: 4, color: 'var(--blue)' }}>
                              <JxIcon name="eye" size={11}/>
                            </button>
                          );
                        })()}
                        {/* INTERCO ya NO bloquea la solicitud: la asistente puede pedir
                            p.ej. el cambio de VINCULACIÓN (obra) de una factura interna
                            — al aprobar, el cambio de obra se propaga también a su
                            compra espejo automática (hook en jx-solicitudes). */}
                        {esAyudante ? (
                          <button className="btn btn-ghost btn-xs" title="Solicitar un cambio (lo aprueba el Contador Jefe o un Admin)" onClick={()=>setSolicitarTarget(m)}>
                            <JxIcon name="edit" size={11}/> Solicitar
                          </button>
                        ) : (
                          <button className="btn btn-ghost btn-xs" title={isIc?'Editar desde Operaciones entre empresas':'Editar'} onClick={()=>openEditar(m)} disabled={isIc || !canEditExisting}>
                            <JxIcon name="edit" size={11}/>
                          </button>
                        )}
                        {isAdmin && (
                          <button className="btn btn-red btn-xs"
                            title={esEspejoAuto ? 'Eliminar la contraparte automática (para reemplazarla por el comprobante real)' : 'Eliminar'}
                            onClick={()=> esEspejoAuto ? eliminarEspejoAuto(m) : eliminar(m)}
                            style={{ marginLeft:4 }} disabled={isIc && !esEspejoAuto}>
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
          <TablePagination {...movPg} />
        </div>
      )}

      {/* Duplicados: comprobantes registrados 2+ veces (fusión admin/contador) */}
      {dupGrupos !== null && (
        <Modal title="Comprobantes duplicados" icon="search" onClose={()=>setDupGrupos(null)}>
          {dupGrupos.length === 0 ? (
            <div style={{ fontSize:13, color:'var(--green)', padding:'8px 0' }}>✅ No se detectaron comprobantes duplicados.</div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              <div style={{ fontSize:12, color:'var(--tm)' }}>
                El mismo comprobante quedó registrado más de una vez (p.ej. confirmado dos veces
                en Captura Mágica). Al fusionar se conserva UNO (el más antiguo ya sincronizado),
                sus evidencias/bancarizaciones/guías pasan al conservado y el resto se elimina.
              </div>
              {dupGrupos.map((g, i) => (
                <div key={i} style={{ border:'1px solid var(--bd)', borderRadius:8, padding:'8px 10px', display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
                  <div style={{ flex:1, minWidth:220 }}>
                    <div style={{ fontSize:12.5, fontWeight:700, color:'var(--tp)' }}>
                      {(g.conservar.document_type || 'doc')} {g.conservar.document_number} · {g.conservar.third_party_name || '—'}
                    </div>
                    <div style={{ fontSize:11, color:'var(--tm)' }}>
                      {g.conservar.date || 's/fecha'} · {fmtCur(g.conservar.amount, g.conservar.currency)} · {1 + g.duplicados.length} registros
                      {g.montosDistintos && <span style={{ color:'var(--amber)' }}> · ⚠ montos distintos — revisá antes de fusionar</span>}
                    </div>
                  </div>
                  <button className="btn btn-amber btn-xs" disabled={fusionando} onClick={()=>fusionarUno(g)}>
                    Fusionar ({g.duplicados.length})
                  </button>
                </div>
              ))}
              <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
                <button className="btn btn-ghost btn-sm" onClick={()=>setDupGrupos(null)}>Cerrar</button>
                <button className="btn btn-amber btn-sm" disabled={fusionando} onClick={fusionarTodos}>
                  {fusionando ? 'Fusionando…' : `Fusionar todos (${dupGrupos.length})`}
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* Bandeja "Sin clasificar" — la Contadora Jefe asigna destino a las facturas "No sé" */}
      {bandejaOpen && (
        <Modal title={`Bandeja: facturas sin clasificar (${sinClasificar.length})`} icon="bell" onClose={()=>setBandejaOpen(false)} wide>
          {sinClasificar.length === 0 ? (
            <div style={{ fontSize:13, color:'var(--green)', padding:'8px 0' }}>✅ No quedan facturas sin clasificar — bandeja vacía.</div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:8, maxHeight:'60vh', overflowY:'auto' }}>
              <div style={{ fontSize:11.5, color:'var(--tm)' }}>
                Estas facturas se subieron con <strong>"No sé / No me acuerdo"</strong>. Asignales el destino correcto —
                al guardar salen de la bandeja y quedan clasificadas.
              </div>
              {sinClasificar.map(m => {
                const c = lookupCompany(m.company_id);
                const sel = bandejaSel.get(m.id) || '';
                return (
                  <div key={m.id} style={{ border:'1px solid var(--bd)', borderRadius:8, padding:'8px 10px', display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
                    <div style={{ flex:'1 1 240px', minWidth:220 }}>
                      <div style={{ fontSize:12.5, fontWeight:700, color:'var(--tp)' }}>
                        {(m.document_type || 'doc')} {m.document_number || 's/n'} · {m.third_party_name || '—'}
                      </div>
                      <div style={{ fontSize:11, color:'var(--tm)' }}>
                        {m.date || 's/fecha'} · {c?.name || '—'} · <strong style={{ color:'var(--tp)' }}>{fmtCur(m.amount, m.currency)}</strong>
                        {m.description ? ` · ${String(m.description).slice(0, 60)}` : ''}
                      </div>
                    </div>
                    {evidenciasPorMov.has(m.id) && (
                      <button className="btn btn-ghost btn-xs" title="Ver la factura adjunta" style={{ color:'var(--blue)' }}
                        onClick={()=>setEvidenciaModal(evidenciasPorMov.get(m.id))}>
                        <JxIcon name="eye" size={11}/>
                      </button>
                    )}
                    <select className="fi" value={sel} style={{ minWidth:210, fontSize:12 }}
                      onChange={e=>setBandejaSel(prev => { const nm = new Map(prev); nm.set(m.id, e.target.value); return nm; })}>
                      <option value="">— Elegí el destino —</option>
                      <optgroup label="🏗 Obras">
                        {obrasParaSelector.map(o => <option key={o.id} value={o.id}>🏗 {o.nombre_obra}</option>)}
                      </optgroup>
                      <optgroup label="Sin obra">
                        <option value="__empresa__">🏢 Gastos Generales de la Empresa</option>
                        <option value="__otros__">📄 Contabilidad Neta (otros)</option>
                      </optgroup>
                    </select>
                    <button className="btn btn-amber btn-xs" disabled={!sel} onClick={()=>asignarDestino(m, sel)}>
                      Asignar
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>setBandejaOpen(false)}>Cerrar</button>
          </div>
        </Modal>
      )}

      {/* Subir bancarización sin entrar a editar (acceso para ayudante de contabilidad) */}
      {bancTarget && (
        <Modal title="Subir bancarización" icon="upload" onClose={()=>{ setBancTarget(null); setBancFile(null); }}>
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <div style={{ fontSize:12, color:'var(--tm)', padding:'8px 10px', borderRadius:6, background:'var(--bg-s)' }}>
              <strong style={{ color:'var(--tp)' }}>{bancTarget.third_party_name || 'Movimiento'}</strong> · {fmtCur(bancTarget.amount, bancTarget.currency)} · {bancTarget.date}
              {bancTarget.obra_id && <div style={{ fontSize:11, marginTop:2 }}>🏗 {obraNombre(bancTarget.obra_id) || 'obra'}</div>}
            </div>
            {!bancTarget.obra_id && (
              <div>
                <label className="flabel">Obra (opcional — solo si querés archivarla junto a una obra)</label>
                <select className="fi" value={bancObra} onChange={e=>setBancObra(e.target.value)}>
                  <option value="">— Sin obra (Gastos Generales / Contabilidad) —</option>
                  {obrasParaSelector.map(o => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}
                </select>
              </div>
            )}
            {/* ── Los 3 CASOS de bancarización (rediseño UX, feedback jul 2026) ── */}
            {(() => {
              const candidatos = (depositos || []).filter(d =>
                mismoPar(parDeposito(d), parMovimiento(bancTarget)) &&
                saldoDeposito(d, partesPorDeposito.get(d.id) || []) > TOL);
              const partesMov = (partesPorMov.get(bancTarget.id) || []);
              const sumaPartes = partesMov.reduce((t, x) => t + (Number(x.monto) || 0), 0);
              const totalMov = Number(bancTarget.amount) || 0;
              const pendiente = Math.max(0, totalMov - sumaPartes);
              const esMulti = bancModo === 'dep_nuevo' || bancModo === 'dep_existente';
              const montoNum = bancModo === 'exacto' ? pendiente : (Number(bancMonto) || 0);
              const excedeFactura = montoNum > pendiente + TOL;
              const elegirCaso = (caso) => {
                setBancDepId('');
                if (caso === 'multi') { setBancModo(candidatos.length ? 'dep_existente' : 'dep_nuevo'); setBancMonto(pendiente > 0 ? pendiente.toFixed(2) : ''); }
                else if (caso === 'exacto') { setBancModo('exacto'); setBancMonto(pendiente > 0 ? pendiente.toFixed(2) : ''); }
                else { setBancModo('parcial'); setBancMonto(''); }
              };
              const Card = ({ id, sel, icon, titulo, sub, ejemplo }) => (
                <button type="button" onClick={() => elegirCaso(id)}
                  style={{ flex:'1 1 155px', textAlign:'left', cursor:'pointer', padding:'10px 12px', borderRadius:8,
                    border: sel ? '2px solid var(--amber)' : '1px solid var(--bd)',
                    background: sel ? 'rgba(242,183,5,0.08)' : 'var(--bg-s)', color:'var(--tp)' }}>
                  <div style={{ fontSize:12.5, fontWeight:700 }}>{icon} {titulo}</div>
                  <div style={{ fontSize:10.5, color:'var(--ts)', marginTop:3, lineHeight:1.35 }}>{sub}</div>
                  <div style={{ fontSize:10, color:'var(--tm)', marginTop:3 }}>{ejemplo}</div>
                </button>
              );
              const pctCub = totalMov > 0 ? Math.min(100, (sumaPartes / totalMov) * 100) : 0;
              const pctEste = totalMov > 0 ? Math.max(0, Math.min(100 - pctCub, (montoNum / totalMov) * 100)) : 0;
              return (<>
                <div style={{ fontSize:11.5, fontWeight:700, color:'var(--ts)' }}>¿Cómo se pagó esta factura?</div>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                  <Card id="exacto" sel={bancModo === 'exacto'} icon="1️⃣" titulo="Pago exacto"
                    sub="Un solo voucher cubre esta factura completa" ejemplo="Ej: factura 2,500 → depósito de 2,500" />
                  <Card id="parcial" sel={bancModo === 'parcial'} icon="🧩" titulo="Pago en partes"
                    sub="Esta factura se paga con varios depósitos (cuotas)" ejemplo="Ej: 48,000 = 20,000 + 24,000 + 4,000" />
                  <Card id="multi" sel={esMulti} icon="🏦" titulo={`Voucher multi-factura${candidatos.length ? ` · ${candidatos.length} con saldo` : ''}`}
                    sub="Un depósito grande cubre 2 o más facturas, con control de saldo" ejemplo="Ej: depósito 5,000 cubre 2,600 + 2,400" />
                </div>

                {/* Barra de cobertura de la FACTURA: pagado (verde) + este pago (azul). */}
                <div>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:10.5, color:'var(--tm)', marginBottom:3, gap:8, flexWrap:'wrap' }}>
                    <span>Cobertura de la factura</span>
                    <span>
                      {sumaPartes > 0 && <span style={{ color:'var(--green)' }}>{fmtCur(sumaPartes, bancTarget.currency)} pagado</span>}
                      {sumaPartes > 0 && montoNum > 0 && ' + '}
                      {montoNum > 0 && <span style={{ color:'var(--blue)' }}>{fmtCur(montoNum, bancTarget.currency)} este pago</span>}
                      {' '}de {fmtCur(totalMov, bancTarget.currency)}
                    </span>
                  </div>
                  <div style={{ display:'flex', height:8, borderRadius:4, overflow:'hidden', background:'rgba(255,255,255,0.08)' }}>
                    <div style={{ width:`${pctCub}%`, background:'var(--green)' }}/>
                    <div style={{ width:`${pctEste}%`, background:'var(--blue)' }}/>
                  </div>
                  {excedeFactura && (
                    <div style={{ fontSize:10.5, color:'var(--red)', marginTop:3 }}>⚠ Este pago excede lo pendiente de la factura ({fmtCur(pendiente, bancTarget.currency)}) — ajustá el monto.</div>
                  )}
                  {pendiente <= TOL && (
                    <div style={{ fontSize:10.5, color:'var(--green)', marginTop:3 }}>✅ Esta factura ya está cubierta al 100% por los pagos registrados.</div>
                  )}
                  {/* Pagos ya registrados. Admin/contadora jefe pueden ELIMINAR
                      cada uno (✕) para corregir montos o rehacer la bancarización
                      con otro tipo (pedido 20-jul). */}
                  {partesMov.length > 0 && (
                    <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:4, display:'flex', flexWrap:'wrap', gap:5, alignItems:'center' }}>
                      {partesMov.map((x, i) => (
                        <span key={x.id || i} style={{ display:'inline-flex', alignItems:'center', gap:3, padding:'1px 7px', borderRadius:4, background:'rgba(255,255,255,0.06)' }}>
                          Pago {i + 1}: {fmtCur(x.monto, bancTarget.currency)} ({x.fecha || 's/fecha'}){x.deposito_id ? ' 🏦' : ''}
                          {(isAdmin || myRol === 'contador') && (
                            <button type="button" className="btn btn-ghost btn-xs" style={{ padding:'0 3px', fontSize:10, color:'var(--red)', lineHeight:1 }}
                              title="Eliminar este pago registrado (corregir monto o cambiar el tipo de bancarización)"
                              onClick={() => eliminarParteBanc(x)}>✕</button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Sub-elección del Caso 2: usar voucher con saldo vs subir uno nuevo. */}
                {esMulti && (
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                    <button type="button" className={`btn btn-xs ${bancModo === 'dep_existente' ? 'btn-amber' : 'btn-ghost'}`} disabled={!candidatos.length}
                      title={!candidatos.length ? 'No hay vouchers del mismo pagador→cobrador con saldo disponible' : undefined}
                      onClick={() => { setBancModo('dep_existente'); setBancDepId(''); }}>Usar voucher con saldo ({candidatos.length})</button>
                    <button type="button" className={`btn btn-xs ${bancModo === 'dep_nuevo' ? 'btn-amber' : 'btn-ghost'}`}
                      onClick={() => { setBancModo('dep_nuevo'); setBancDepId(''); }}>Subir voucher nuevo</button>
                  </div>
                )}
                {bancModo === 'dep_nuevo' && (
                  <div style={{ fontSize:11, color:'var(--tm)', padding:'6px 10px', borderRadius:6, background:'rgba(52,152,219,0.08)', border:'1px solid rgba(52,152,219,0.3)' }}>
                    Subís UNA transferencia/depósito grande (ej: S/ 5,000) del mismo {claseDe(bancTarget) === 'venta' ? 'cliente' : 'proveedor'}:
                    indicás el TOTAL del voucher y cuánto cubre ESTA factura; el resto queda como <strong>saldo</strong> para aplicar
                    a otras facturas. El sistema NO deja usar más que el total del voucher.
                  </div>
                )}

                {/* Vouchers con saldo (Caso 2): tarjetas con barra de saldo visible. */}
                {bancModo === 'dep_existente' && (
                  <div style={{ display:'flex', flexDirection:'column', gap:6, maxHeight:190, overflowY:'auto' }}>
                    {candidatos.map(d => {
                      const saldo = saldoDeposito(d, partesPorDeposito.get(d.id) || []);
                      const usado = Math.max(0, Number(d.monto_total) - saldo);
                      const pctUso = Number(d.monto_total) > 0 ? Math.min(100, (usado / Number(d.monto_total)) * 100) : 0;
                      const sel = bancDepId === d.id;
                      return (
                        <button key={d.id} type="button"
                          onClick={() => { setBancDepId(d.id); setBancMonto(Math.min(saldo, pendiente > 0 ? pendiente : saldo).toFixed(2)); }}
                          style={{ textAlign:'left', cursor:'pointer', padding:'8px 10px', borderRadius:8,
                            border: sel ? '2px solid var(--amber)' : '1px solid var(--bd)',
                            background: sel ? 'rgba(242,183,5,0.08)' : 'var(--bg-s)', color:'var(--tp)' }}>
                          <div style={{ display:'flex', justifyContent:'space-between', gap:8, fontSize:11.5, flexWrap:'wrap' }}>
                            <span style={{ fontWeight:600 }}>🏦 {d.referencia || 's/ref'} · {d.fecha || 's/fecha'}</span>
                            <span>total {fmtCur(d.monto_total, d.moneda)}</span>
                          </div>
                          <div style={{ height:6, borderRadius:3, background:'rgba(255,255,255,0.08)', margin:'6px 0 4px', overflow:'hidden' }}>
                            <div style={{ width:`${pctUso}%`, height:'100%', background:'var(--tm)' }}/>
                          </div>
                          <div style={{ fontSize:10.5, color:'var(--ts)' }}>
                            usado {fmtCur(usado, d.moneda)} · <strong style={{ color:'var(--green)' }}>saldo disponible {fmtCur(saldo, d.moneda)}</strong>
                          </div>
                        </button>
                      );
                    })}
                    {bancDepId && bancPorDeposito.get(bancDepId) && (
                      <button className="btn btn-ghost btn-xs" style={{ alignSelf:'flex-start', color:'var(--blue)' }}
                        onClick={() => setEvidenciaModal(bancPorDeposito.get(bancDepId))}>
                        <JxIcon name="eye" size={11}/> Ver constancia del voucher
                      </button>
                    )}
                  </div>
                )}

                {/* Archivo del voucher (no aplica al usar uno con saldo: ya está subido). */}
                {bancModo !== 'dep_existente' && (
                  <div>
                    <label className="flabel">Archivo (foto o PDF del voucher / constancia)</label>
                    <input className="fi" type="file" accept="image/*,application/pdf" onChange={e=>setBancFile((e.target.files||[])[0]||null)}/>
                    {bancFile && <div style={{ fontSize:11, color:'var(--green)', marginTop:4 }}>📎 {bancFile.name}</div>}
                  </div>
                )}

                {/* Montos según el caso. */}
                <div style={{ padding:'8px 10px', borderRadius:6, background:'var(--bg-s)' }}>
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    {bancModo === 'exacto' && (
                      <div style={{ fontSize:12, alignSelf:'center' }}>
                        {pendiente > TOL ? (
                          <>Se registrará el pago por <strong style={{ color:'var(--blue)' }}>{fmtCur(pendiente, bancTarget.currency)}</strong>
                          {sumaPartes > 0 ? ' (lo pendiente de la factura)' : ' (el total de la factura)'}.</>
                        ) : (
                          <>Se <strong style={{ color:'var(--amber)' }}>cambiará la constancia</strong> — no se registra ningún monto nuevo (la factura ya está cubierta al 100%).</>
                        )}
                      </div>
                    )}
                    {bancModo === 'parcial' && (
                      <div><label className="flabel">Monto de ESTE pago *</label>
                        <input className="fi" type="number" min="0" step="0.01" value={bancMonto} placeholder={`hasta ${pendiente.toFixed(2)}`}
                          onChange={e=>setBancMonto(e.target.value)} style={{ width:140, textAlign:'right' }}/></div>
                    )}
                    {bancModo === 'dep_nuevo' && (
                      <div><label className="flabel">TOTAL del voucher</label>
                        <input className="fi" type="number" min="0" step="0.01" value={bancTotalDep} placeholder="ej. 5000"
                          onChange={e=>setBancTotalDep(e.target.value)} style={{ width:130, textAlign:'right' }}/></div>
                    )}
                    {esMulti && (
                      <div><label className="flabel">Cubre de ESTA factura</label>
                        <input className="fi" type="number" min="0" step="0.01" value={bancMonto} placeholder="requerido"
                          onChange={e=>setBancMonto(e.target.value)} style={{ width:130, textAlign:'right' }}/></div>
                    )}
                    {bancModo !== 'dep_existente' && (<>
                      <div><label className="flabel">Método</label>
                        <select className="fi" value={bancMetodo} onChange={e=>setBancMetodo(e.target.value)} style={{ width:150 }}>
                          <option value="transferencia">Transferencia</option>
                          <option value="deposito">Depósito</option>
                          <option value="agente">Agente bancario</option>
                          <option value="cheque">Cheque</option>
                          <option value="otro">Otro</option>
                        </select></div>
                      <div><label className="flabel">N° operación</label>
                        <input className="fi" value={bancRef} placeholder="opcional" onChange={e=>setBancRef(e.target.value)} style={{ width:130 }}/></div>
                    </>)}
                  </div>
                  {bancModo === 'dep_nuevo' && Number(bancTotalDep) > 0 && montoNum > 0 && (
                    <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:6 }}>
                      Saldo del voucher que quedará para otras facturas: <strong style={{ color:'var(--blue)' }}>{fmtCur(Math.max(0, Number(bancTotalDep) - montoNum), bancTarget.currency)}</strong>
                      {montoNum > Number(bancTotalDep) + TOL && <span style={{ color:'var(--red)' }}> · ⚠ cubrís más que el total del voucher</span>}
                    </div>
                  )}
                  {bancModo === 'dep_existente' && bancDepId && (() => {
                    const d = depositosById.get(bancDepId);
                    const saldo = d ? saldoDeposito(d, partesPorDeposito.get(bancDepId) || []) : 0;
                    const excede = montoNum > saldo + TOL;
                    return (
                      <div style={{ fontSize:10.5, marginTop:6, color: excede ? 'var(--red)' : 'var(--tm)' }}>
                        {excede
                          ? `⚠ Excede el saldo del voucher (${fmtCur(saldo, d?.moneda)}) — no se puede cubrir más de lo depositado`
                          : <>Saldo del voucher tras aplicar: <strong style={{ color:'var(--blue)' }}>{fmtCur(Math.max(0, saldo - montoNum), d?.moneda)}</strong></>}
                      </div>
                    );
                  })()}
                </div>
              </>);
            })()}
            <div style={{ fontSize:11, color:'var(--tm)' }}>Esto solo adjunta la bancarización al movimiento — no modifica el movimiento, así que no requiere permiso de edición.</div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>{ setBancTarget(null); setBancFile(null); }} disabled={bancSaving}>Cancelar</button>
            <button className="btn btn-amber" onClick={subirBancarizacion}
              disabled={bancSaving
                || (bancModo !== 'dep_existente' && !bancFile)
                || (bancModo === 'dep_existente' && !bancDepId)
                || (bancModo === 'parcial' && !(Number(bancMonto) > 0))}>
              <JxIcon name="check" size={13}/> {(() => {
                if (bancSaving) return 'Guardando…';
                if (bancModo === 'parcial') return 'Registrar pago parcial';
                if (bancModo === 'dep_nuevo') return 'Registrar voucher y cubrir factura';
                if (bancModo === 'dep_existente') return 'Aplicar saldo del voucher';
                // 'exacto': si ya está cubierta al 100%, el submit CAMBIA la
                // constancia (sin registrar monto). OJO: `pendiente` del bloque
                // de arriba no llega hasta acá — se recalcula localmente.
                const _pagado = (partesPorMov.get(bancTarget.id) || []).reduce((t, x) => t + (Number(x.monto) || 0), 0);
                const _pend = Math.max(0, (Number(bancTarget.amount) || 0) - _pagado);
                return _pend > TOL ? 'Registrar pago exacto' : 'Cambiar constancia';
              })()}
            </button>
          </div>
        </Modal>
      )}

      {/* Modal: registrar DETRACCIÓN + subir la constancia del depósito (Banco de la Nación) */}
      {detrTarget && (
        <Modal title="Detracción (SPOT)" icon="upload" onClose={()=>{ setDetrTarget(null); setDetrFile(null); }}>
          <div style={{ fontSize:12, color:'var(--tm)', marginBottom:10 }}>
            {detrTarget.description || 'Movimiento'} · Total {fmtCur(detrTarget.amount, detrTarget.currency)} ({claseDe(detrTarget) === 'venta' ? 'venta' : 'compra'})
          </div>
          <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, fontWeight:600, marginBottom:10 }}>
            <input type="checkbox" checked={detrAplica} onChange={e=>setDetrAplica(e.target.checked)}/>
            Esta factura tiene detracción
          </label>
          {detrAplica && (
            <>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
                <div><label className="flabel">Detracción %</label><input className="fi" type="number" step="0.01" value={detrPct} onChange={e=>setDetrPct(e.target.value)}/></div>
                <div><label className="flabel">Monto detraído (S/)</label><input className="fi" type="number" step="0.01" value={detrMonto} onChange={e=>setDetrMonto(e.target.value)}/></div>
                <div><label className="flabel">Código SPOT</label><input className="fi" value={detrCodigo} onChange={e=>setDetrCodigo(e.target.value)} placeholder="ej. 037"/></div>
              </div>
              <div style={{ marginTop:6, fontSize:11, color:'var(--tm)' }}>
                Neto a pagar al proveedor: <b>{fmtCur(Math.max(0, (Number(detrTarget.amount)||0) - (Number(detrMonto)||0)), detrTarget.currency)}</b>
              </div>
              <div style={{ marginTop:12, paddingTop:10, borderTop:'1px solid var(--border)' }}>
                <label className="flabel">Constancia del depósito (Banco de la Nación) — opcional</label>
                <input className="fi" type="file" accept="image/*,application/pdf" onChange={e=>setDetrFile(e.target.files?.[0] || null)}/>
                <div style={{ marginTop:6 }}>
                  <label className="flabel">Fecha del depósito</label>
                  <input className="fi" type="date" value={detrFecha} onChange={e=>setDetrFecha(e.target.value)}/>
                </div>
                <div style={{ fontSize:11, color:'var(--tm)', marginTop:6 }}>
                  Si subís la constancia, la detracción queda marcada como <b>depositada</b>. Sin archivo, queda <b>pendiente de depósito</b> y la subís después.
                </div>
              </div>
            </>
          )}
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>{ setDetrTarget(null); setDetrFile(null); }} disabled={detrSaving}>Cancelar</button>
            <button className="btn btn-amber" onClick={subirDetraccion} disabled={detrSaving || (detrAplica && !(Number(detrMonto) > 0))}>
              <JxIcon name="check" size={13}/> {detrSaving ? 'Guardando…' : (!detrAplica ? 'Quitar detracción' : (detrFile ? 'Guardar y marcar depositada' : 'Guardar detracción'))}
            </button>
          </div>
        </Modal>
      )}

      {/* Visor de factura adjunta (PDF/imagen) */}
      {evidenciaModal && (
        <Modal title={`Comprobante: ${evidenciaModal.nombre}`} icon="eye"
          onClose={() => setEvidenciaModal(null)} wide>
          <div style={{ minHeight: 480, maxHeight: '70vh', background: '#0E1620', borderRadius: 6, overflow: 'hidden' }}>
            {evidenciaModal.mime?.startsWith('image/') ? (
              <img src={evidenciaModal.url} alt={evidenciaModal.nombre}
                style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}/>
            ) : (
              <PdfFrame url={evidenciaModal.url} nombre={evidenciaModal.nombre} />
            )}
          </div>
          <div className="modal-actions">
            <a href={evidenciaModal.url} target="_blank" rel="noopener noreferrer"
              className="btn btn-ghost btn-sm">
              <JxIcon name="external" size={12}/> Abrir en nueva pestaña
            </a>
            <button className="btn btn-amber btn-sm" onClick={() => setEvidenciaModal(null)}>
              Cerrar
            </button>
          </div>
        </Modal>
      )}

      {llegoTarget && (() => {
        const fac = llegoTarget.factura;
        const grupos = llegoTarget.grupos || [];
        return (
          <Modal title="¿Llegó a almacén?" icon="search" onClose={()=>setLlegoTarget(null)}>
            <div style={{ marginBottom:10, fontSize:12.5 }}>
              <div style={{ fontSize:10.5, fontWeight:700, color:'var(--tm)', letterSpacing:'.06em' }}>FACTURA</div>
              <strong>{fac.document_type} {fac.document_number || ''}</strong> · {fac.third_party_name || '—'} · {fac.date || 's/f'}
            </div>
            {buscandoLlego ? (
              <div className="empty-state" style={{ padding:20 }}><p>Buscando ingresos candidatos…</p></div>
            ) : grupos.length === 0 ? (
              <p style={{ fontSize:12.5, color:'var(--ts)' }}>Todas las líneas de esta factura ya están resueltas (recibidas, o marcadas como consumo de empresa/servicio). No hay nada pendiente de vincular.</p>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:12, maxHeight:'56vh', overflowY:'auto' }}>
                {grupos.map(g => (
                  <div key={g.idx} className="card card-p" style={{ padding:'10px 12px' }}>
                    <div style={{ fontSize:12.5, fontWeight:700, color:'var(--tp)' }}>
                      {g.item.descripcion || '(sin descripción)'} · {Number(g.item.cantidad)||0} {g.item.unidad || ''}
                      {Number(g.item.recibido)>0 && <span style={{ color:'var(--amber)', fontWeight:500 }}> · ya recibido {Number(g.item.recibido)}</span>}
                    </div>
                    {g.candidatos.length === 0 ? (
                      <div style={{ fontSize:11.5, color:'var(--tm)', marginTop:6 }}>Sin ingresos candidatos en almacén (por insumo/fecha/cantidad). La almacenera también puede vincularlo desde su lado con 🔎.</div>
                    ) : (
                      <div style={{ display:'flex', flexDirection:'column', gap:6, marginTop:8 }}>
                        {g.candidatos.map(c => {
                          const mm = c.ingreso;
                          const pct = Math.round(c.score*100);
                          const tone = pct>=75?'var(--green)':pct>=50?'var(--amber)':'var(--tm)';
                          return (
                            <div key={mm.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, borderTop:'1px solid var(--bd)', paddingTop:6 }}>
                              <div style={{ minWidth:0, flex:1 }}>
                                <div style={{ fontSize:12 }}><strong>{mm.materialNombre || 'insumo'}</strong> · {mm.cantidad} {mm.unidad||''} · {mm.fecha}</div>
                                {c.motivos?.length>0 && (
                                  <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginTop:4 }}>
                                    {c.motivos.map((mo,i)=><span key={i} style={{ fontSize:10, background:'rgba(52,152,219,0.1)', border:'1px solid rgba(52,152,219,0.25)', color:'var(--blue,#3498DB)', padding:'1px 6px', borderRadius:4 }}>{mo}</span>)}
                                  </div>
                                )}
                              </div>
                              <div style={{ textAlign:'center', whiteSpace:'nowrap' }}>
                                <div style={{ fontSize:11, fontWeight:700, color:tone, marginBottom:4 }}>{pct}%</div>
                                <button className="btn btn-green btn-sm" onClick={()=>vincularItemAIngreso(fac, g.idx, c)}><JxIcon name="check" size={12}/> Sí, este</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div style={{ marginTop:8, textAlign:'right' }}>
                      <button className="btn btn-ghost btn-xs" style={{ color:'var(--blue,#3498DB)' }} onClick={()=>preguntarAlmacen(fac, g)} title="Enviar una consulta a almacén por esta línea (con la referencia exacta, sin montos)">💬 Preguntar a almacén</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="modal-actions" style={{ marginTop:12 }}>
              <button className="btn btn-ghost" onClick={()=>setLlegoTarget(null)}>Cerrar</button>
            </div>
          </Modal>
        );
      })()}
      {showConsultas && (
        <ConsultasPanel rol="contabilidad" obraId={null} showToast={showToast} onClose={()=>setShowConsultas(false)} />
      )}
      {/* ── 🏷 INSUMOS PARA VENTA: ítems facturados sin ingreso a obra ── */}
      {showVenta && (() => {
        const candidatos = candidatosSinIngreso(movs || []);
        const pool = poolParaVenta(movs || []);
        const vendidos = vendidosVenta(movs || []);
        const ventasDisponibles = (movs || [])
          .filter(m => !m.deleted_at && (m.clase === 'venta' || m.type === 'income'))
          .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        const CONSULTA_BADGE = {
          sin_consulta:  { cls: 'b-gray', lbl: 'sin comprobar' },
          esperando:     { cls: 'b-amber', lbl: '💬 esperando a almacén' },
          no:            { cls: 'b-green', lbl: '✅ Almacén: NO va a ingresar' },
          no_otro_flujo: { cls: 'b-gray', lbl: '"No llegó" (consulta ¿llegó?) — sin comprobar para venta' },
          si:            { cls: 'b-red', lbl: '⚠ Almacén: SÍ ingresó' },
          parcial:       { cls: 'b-red', lbl: '⚠ Almacén: ingresó parcial' },
          otra_fecha:    { cls: 'b-red', lbl: '⚠ Almacén: ingresó en otra fecha' },
        };
        return (
          <Modal title="🏷 Insumos para Venta — sin ingreso a obra" icon="tag" onClose={()=>setShowVenta(false)} wide>
            <div style={{ fontSize:11.5, color:'var(--tm)', marginBottom:12, lineHeight:1.6 }}>
              Ítems FACTURADOS que no se vincularon a ningún ingreso de almacén. Flujo: <strong>1)</strong> preguntá a almacén si va a ingresar · <strong>2)</strong> con la respuesta "No", la Contadora Jefe/Admin lo separa · <strong>3)</strong> al emitir la factura de venta, se vincula (trazabilidad compra→venta).
            </div>

            {/* 1 · CANDIDATOS */}
            <div style={{ fontSize:12.5, fontWeight:700, color:'var(--amber)', marginBottom:6 }}>⏳ Sin ingreso a obra ({candidatos.length})</div>
            {candidatos.length === 0 ? (
              <div style={{ fontSize:11.5, color:'var(--tm)', padding:'8px 0 14px' }}>No hay ítems pendientes de ingreso — todo lo facturado llegó o ya fue separado.</div>
            ) : (
              <div style={{ maxHeight:240, overflowY:'auto', marginBottom:14 }}>
                <table className="tbl" style={{ fontSize:11.5 }}>
                  <thead><tr><th>Insumo</th><th>Factura</th><th style={{ textAlign:'right' }}>Pendiente</th><th>Comprobación</th><th></th></tr></thead>
                  <tbody>
                    {candidatos.map(row => {
                      const ec = estadoConsultaItem(consultasVenta, row.facturaId, row.idx);
                      const b = CONSULTA_BADGE[ec.estado] || CONSULTA_BADGE.sin_consulta;
                      const respuestaNo = ec.estado === 'no';
                      // Cualquier confirmación de llegada bloquea (si / parcial / otra fecha).
                      const bloqueado = ['si', 'parcial', 'otra_fecha'].includes(ec.estado);
                      return (
                        <tr key={`${row.facturaId}_${row.idx}`}>
                          <td style={{ fontWeight:600, color:'var(--tp)' }}>{row.descripcion}</td>
                          <td style={{ fontSize:10.5, color:'var(--tm)' }}>{row.doc} · {row.fecha}<div>{row.proveedor}</div></td>
                          <td style={{ textAlign:'right' }}>{row.pendiente} {row.unidad}</td>
                          <td><span className={`badge ${b.cls}`} style={{ fontSize:9.5 }}>{b.lbl}</span></td>
                          <td style={{ whiteSpace:'nowrap', textAlign:'right' }}>
                            {(ec.estado === 'sin_consulta' || ec.estado === 'no_otro_flujo') && (
                              <button className="btn btn-ghost btn-xs" title="Preguntar a almacén si este insumo ingresó o va a ingresar" onClick={()=>preguntarAlmacenVenta(row)}>💬 Comprobar</button>
                            )}
                            {bloqueado && <span style={{ fontSize:10, color:'var(--tm)' }} title="Almacén indica que el insumo ingresó: vinculá el ingreso con 🔎 ¿llegó? en vez de separarlo">ingresó → vinculá con ¿llegó?</span>}
                            {canSepararVenta && !bloqueado && (respuestaNo || isAdmin) && (
                              <button className="btn btn-amber btn-xs" style={{ marginLeft:4 }}
                                title={respuestaNo ? 'Almacén confirmó que no ingresó — separar para venta' : 'Separar SIN comprobación (solo admin)'}
                                onClick={()=>separarParaVenta(row, respuestaNo)}>🏷 Separar</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* 2 · POOL DISPONIBLE */}
            <div style={{ fontSize:12.5, fontWeight:700, color:'var(--green)', marginBottom:6 }}>
              🏷 Disponibles para venta ({pool.length})
              {pool.length > 0 && <span style={{ fontWeight:400, color:'var(--tm)', marginLeft:8, fontSize:11 }}>costo total S/ {pool.reduce((t, r) => t + r.costoTotal, 0).toLocaleString('es-PE', { minimumFractionDigits:2 })}</span>}
            </div>
            {pool.length === 0 ? (
              <div style={{ fontSize:11.5, color:'var(--tm)', padding:'8px 0 14px' }}>Nada separado todavía.</div>
            ) : (
              <div style={{ maxHeight:220, overflowY:'auto', marginBottom:14 }}>
                <table className="tbl" style={{ fontSize:11.5 }}>
                  <thead><tr><th>Insumo</th><th>Origen</th><th style={{ textAlign:'right' }}>Cant.</th><th style={{ textAlign:'right' }}>Costo</th><th></th></tr></thead>
                  <tbody>
                    {pool.map(row => (
                      <tr key={`${row.facturaId}_${row.idx}`}>
                        <td style={{ fontWeight:600, color:'var(--tp)' }}>{row.descripcion}</td>
                        <td style={{ fontSize:10.5, color:'var(--tm)' }}>{row.doc} · {row.proveedor}</td>
                        <td style={{ textAlign:'right' }}>
                          {row.cantidad} {row.unidad}
                          {row.ingresoPosterior > 0 && <div style={{ fontSize:9.5, color:'var(--amber)' }} title="Después de separarlo, almacén recepcionó parte: lo disponible para venta es lo que queda pendiente">⚠ ingresó {row.ingresoPosterior} después</div>}
                        </td>
                        <td style={{ textAlign:'right' }} title={`S/ ${row.costoUnit} c/u (costo de compra, referencia para el precio de venta)`}>S/ {row.costoTotal.toLocaleString('es-PE', { minimumFractionDigits:2 })}</td>
                        <td style={{ whiteSpace:'nowrap', textAlign:'right' }}>
                          {canSepararVenta && (
                            <>
                              <select className="fi" style={{ fontSize:10.5, padding:'3px 5px', maxWidth:190 }} value=""
                                title="Vincular a una factura de VENTA ya emitida (registrala antes por Captura Mágica o Nuevo Movimiento)"
                                onChange={e => { if (e.target.value) vincularVentaEmitida(row, e.target.value); e.target.value=''; }}>
                                <option value="">🧾 Vincular venta…</option>
                                {ventasDisponibles.slice(0, 40).map(v => (
                                  <option key={v.id} value={v.id}>{v.document_number || 's/n'} · {v.date} · {fmtCur(v.amount, v.currency)}</option>
                                ))}
                              </select>
                              <button className="btn btn-ghost btn-xs" style={{ marginLeft:4 }} title="Quitar del pool (vuelve a Sin ingreso)" onClick={()=>devolverDeVenta(row)}>↩</button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 3 · VENDIDOS */}
            <div style={{ fontSize:12.5, fontWeight:700, color:'var(--blue)', marginBottom:6 }}>🧾 Vendidos ({vendidos.length})</div>
            {vendidos.length === 0 ? (
              <div style={{ fontSize:11.5, color:'var(--tm)', padding:'8px 0' }}>Todavía no hay ítems vendidos desde este flujo.</div>
            ) : (
              <div style={{ maxHeight:180, overflowY:'auto' }}>
                <table className="tbl" style={{ fontSize:11.5 }}>
                  <thead><tr><th>Insumo</th><th>Compra</th><th style={{ textAlign:'right' }}>Cant.</th><th style={{ textAlign:'right' }}>Costo</th><th>Venta vinculada</th></tr></thead>
                  <tbody>
                    {vendidos.map(row => (
                      <tr key={`${row.facturaId}_${row.idx}`}>
                        <td style={{ fontWeight:600, color:'var(--tp)' }}>{row.descripcion}</td>
                        <td style={{ fontSize:10.5, color:'var(--tm)' }}>{row.doc}</td>
                        <td style={{ textAlign:'right' }}>{row.cantidad} {row.unidad}</td>
                        <td style={{ textAlign:'right' }}>S/ {row.costoTotal.toLocaleString('es-PE', { minimumFractionDigits:2 })}</td>
                        <td style={{ fontSize:10.5, whiteSpace:'nowrap' }}>
                          {row.ventaDoc ? <span className="badge b-green" style={{ fontSize:9.5 }}>🧾 {row.ventaDoc} · {row.ventaFecha}</span>
                            : row.ventaBorrada ? <>
                                <span className="badge b-red" style={{ fontSize:9.5 }} title="La factura de venta vinculada ya no existe (borrada/anulada)">venta borrada</span>
                                {canSepararVenta && <button className="btn btn-ghost btn-xs" style={{ marginLeft:4 }} title="Devolver al pool de venta" onClick={()=>devolverDeVenta(row)}>↩</button>}
                              </>
                            : <span style={{ color:'var(--tm)' }}>—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Modal>
        );
      })()}

      {showReporte && (() => {
        const tarjeta = (label, valor, color) => (
          <div style={{ flex:'1 1 120px', minWidth:110, background:'var(--bg-s)', border:'1px solid var(--bd)', borderRadius:8, padding:'8px 12px' }}>
            <div style={{ fontSize:10, color:'var(--tm)', letterSpacing:'.04em' }}>{label}</div>
            <div style={{ fontSize:18, fontWeight:700, color: color || 'var(--tp)' }}>{valor}</div>
          </div>
        );
        const insumos = reporte.porInsumo.filter(i => !repQ || i.nombre.toLowerCase().includes(repQ.toLowerCase()));
        return (
          <Modal title="Reporte de Recepción — de lo facturado, ¿qué llegó a obra?" icon="activity" onClose={()=>setShowReporte(false)} wide>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:12 }}>
              {tarjeta('Ítems facturados', reporte.totales.facturado)}
              {tarjeta('Recibido en obra', reporte.totales.recibido, 'var(--green)')}
              {tarjeta('Falta llegar', reporte.totales.faltante, reporte.totales.faltante > 0.001 ? '#EF6B5E' : 'var(--tm)')}
              {tarjeta('Consumo empresa', reporte.totales.aEmpresa, 'var(--tm)')}
              {tarjeta('Gasto general obra', reporte.totales.aObraGeneral, 'var(--tm)')}
            </div>
            <div style={{ display:'flex', gap:6, marginBottom:10, alignItems:'center', flexWrap:'wrap' }}>
              <button className={reporteTab==='insumo'?'btn btn-amber btn-sm':'btn btn-ghost btn-sm'} onClick={()=>setReporteTab('insumo')}>Por insumo ({reporte.porInsumo.length})</button>
              <button className={reporteTab==='factura'?'btn btn-amber btn-sm':'btn btn-ghost btn-sm'} onClick={()=>setReporteTab('factura')}>Por factura ({reporte.nFacturas})</button>
              {reporteTab==='insumo' && (
                <input className="fi" style={{ marginLeft:'auto', maxWidth:220 }} placeholder="Buscar insumo…" value={repQ} onChange={e=>setRepQ(e.target.value)} />
              )}
            </div>
            {reporte.nFacturas === 0 ? (
              <div className="empty-state" style={{ padding:20 }}><p>No hay facturas de compra con detalle de insumos en este ámbito.</p></div>
            ) : reporteTab === 'insumo' ? (
              <div style={{ overflowX:'auto', maxHeight:'52vh', overflowY:'auto' }}>
                <table className="tbl">
                  <thead><tr>
                    <th>Insumo</th><th style={{ textAlign:'right' }}>Facturado</th>
                    <th style={{ textAlign:'right' }}>Recibido</th><th style={{ textAlign:'right' }}>Falta</th>
                    <th style={{ textAlign:'center' }}>% obra</th><th>Destino</th>
                  </tr></thead>
                  <tbody>
                    {insumos.map((i, k) => (
                      <tr key={k}>
                        <td className="col-p">{i.nombre} <span style={{ color:'var(--tm)', fontSize:10 }}>· {i.nFacturas} fact.</span></td>
                        <td style={{ textAlign:'right' }}>{i.facturado} {i.unidad}</td>
                        <td style={{ textAlign:'right', color:'var(--green)' }}>{i.recibido}</td>
                        <td style={{ textAlign:'right', color: i.faltante > 0.001 ? '#EF6B5E' : 'var(--tm)', fontWeight: i.faltante > 0.001 ? 700 : 400 }}>{i.faltante}</td>
                        <td style={{ textAlign:'center' }}>{i.pctRecibido == null ? '—' : `${i.pctRecibido}%`}</td>
                        <td style={{ fontSize:11 }}>
                          {i.aObra > 0.001 && <span title="A obra">🏗 {i.aObra}</span>}
                          {i.aEmpresa > 0.001 && <span title="Consumo empresa" style={{ marginLeft:6 }}>🏢 {i.aEmpresa}</span>}
                          {i.aObraGeneral > 0.001 && <span title="Gasto general de obra" style={{ marginLeft:6 }}>🍽 {i.aObraGeneral}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ overflowX:'auto', maxHeight:'52vh', overflowY:'auto' }}>
                <table className="tbl">
                  <thead><tr><th>Comprobante</th><th>Proveedor</th><th>Fecha</th><th>Recepción</th><th style={{ textAlign:'center' }}>Líneas</th></tr></thead>
                  <tbody>
                    {reporte.porFactura.map(f => (
                      <tr key={f.facturaId}>
                        <td className="col-p">{f.doc}</td>
                        <td style={{ fontSize:11.5 }}>{f.proveedor || '—'}</td>
                        <td className="col-m">{f.fecha || '—'}</td>
                        <td style={{ fontSize:11.5, color: f.tone==='green'?'var(--green)':f.tone==='red'?'#EF6B5E':f.tone==='muted'?'var(--tm)':'var(--amber)' }}>{f.emoji} {f.label}</td>
                        <td style={{ textAlign:'center' }}>{f.recibidos}/{f.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="modal-actions" style={{ marginTop:12 }}>
              <button className="btn btn-ghost" onClick={()=>setShowReporte(false)}>Cerrar</button>
            </div>
          </Modal>
        );
      })()}
      {solicitarTarget && (
        <RequestChangeModal
          table="accounting_movements"
          record={solicitarTarget}
          recordLabel={`${solicitarTarget.document_type || 'doc'} ${solicitarTarget.document_number || ''} · ${fmtCur(solicitarTarget.amount, solicitarTarget.currency)}`}
          // INTERCO (no espejo AUTO): el par se edita/elimina desde "Operaciones
          // entre empresas" — acá solo se permite pedir la VINCULACIÓN (obra/destino,
          // que SÍ se propaga al espejo) y pedidos descriptivos. Sin allowDelete:
          // aprobar un borrado/monto/estado tocaría UN solo lado del par.
          allowDelete={!solicitarTarget.is_intercompany}
          fields={[
            ...(solicitarTarget.is_intercompany ? [] : [
            { key: 'amount', label: 'Monto', type: 'number' },
            { key: 'date', label: 'Fecha', type: 'date' },
            { key: 'description', label: 'Descripción' },
            { key: 'clase', label: 'Clase (compra/venta)' },
            { key: 'payment_status', label: 'Estado de pago' },
            { key: 'document_number', label: 'N° documento' },
            { key: 'third_party_name', label: 'Cliente / Proveedor' },
            ]),
            // Vinculación (obra / gastos generales / contabilidad neta): la
            // asistente describe en el motivo a dónde debe ir; el Contador Jefe
            // o Admin lo aplican desde Editar Movimiento → Vinculación.
            // Vinculación ESTRUCTURADA (21-jul): al aprobar se aplica sola —
            // obra_id + destino_contable (hook en jx-solicitudes.applyChange).
            { key: '__vinculacion_destino', label: 'Obra / Vinculación (destino)', options: [
              { value: '__empresa__', label: '🏢 Gastos Generales de la Empresa' },
              { value: '__otros__', label: '📄 Contabilidad Neta (Otros)' },
              { value: '__nose__', label: '🤔 Sin clasificar (lo revisa la Contadora)' },
              ...obrasParaSelector.map(o => ({ value: 'obra:' + o.id, label: '🏗 ' + o.nombre_obra })),
            ] },
            // Bancarización equivocada (21-jul): al aprobar se ELIMINAN las
            // partes (y constancias en 'todas'), se libera el voucher y si la
            // factura queda descubierta vuelve a "Pendiente" — automático.
            { key: '__banc_eliminar', label: 'Bancarización: ELIMINAR lo registrado', options: [
              { value: 'todas', label: 'Eliminar TODA la bancarización (partes y constancias)' },
              { value: 'ultima', label: 'Eliminar solo la ÚLTIMA parte registrada' },
            ] },
            // Detracción mal registrada / confundida con la bancarización: al aprobar
            // se borra la constancia_detraccion y se revierte la detracción del mov.
            { key: '__detraccion_eliminar', label: 'Detracción: ELIMINAR lo registrado', options: [
              { value: 'si', label: 'Quitar la detracción (borra su constancia y deja la factura sin detracción)' },
            ] },
            // Otros cambios de bancarización (tipo mal elegido, montos): descriptivo.
            { key: '__bancarizacion', label: 'Bancarización: otro cambio (describilo en el motivo)', descriptive: true },
          ]}
          showToast={showToast}
          onClose={() => setSolicitarTarget(null)}
        />
      )}
      {(modal === 'nuevo' || modal === 'editar') && (
        <Modal title={editingId ? 'Editar Movimiento' : 'Nuevo Movimiento'} icon="dollar" onClose={()=>{setModal(null); setEditingId(null);}} wide>
          {/* Si el mov tiene factura adjunta (vino de Captura Mágica),
              mostrar botón "Ver factura" arriba para que la contadora
              pueda revisarla sin salir del modal de edición. */}
          {editingId && evidenciasPorMov.has(editingId) && (() => {
            const ev = evidenciasPorMov.get(editingId);
            return (
              <div style={{
                marginBottom: 12,
                padding: '8px 12px',
                background: 'rgba(52,152,219,0.08)',
                border: '1px solid rgba(52,152,219,0.3)',
                borderRadius: 6,
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              }}>
                <span style={{ fontSize: 16, lineHeight: 1 }}>📎</span>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--blue)' }}>
                    Factura adjunta · {ev.nombre}
                  </div>
                </div>
                <button type="button" className="btn btn-ghost btn-sm"
                  onClick={() => setEvidenciaModal(ev)}>
                  <JxIcon name="eye" size={12}/> Ver factura
                </button>
              </div>
            );
          })()}
          <div className="g2">
            <div>
              <label className="flabel">Clase *</label>
              <select className="fi" value={form.clase||'compra'} onChange={e=>{
                const clase = e.target.value;
                // Sugerir el tipo contable acorde (venta→ingreso, compra→costo); editable después.
                setForm({...form, clase, type: clase === 'venta' ? 'income' : (form.type === 'income' ? 'cost' : (form.type || 'cost'))});
              }}>
                <option value="compra">🛒 Compra (a proveedora)</option>
                <option value="venta">🧾 Venta (emitida a la ejecutora)</option>
              </select>
            </div>
            <div>
              <label className="flabel">Vinculación {form.clase === 'venta' ? '(opcional)' : '(dónde se usan los insumos)'}</label>
              {(() => {
                // Valor combinado: obra real, o los destinos "sin obra".
                const vincVal = form.obra_id
                  ? form.obra_id
                  : form.destino_contable === 'gastos_generales' ? '__empresa__'
                  : form.destino_contable === 'contabilidad_neta' ? '__otros__'
                  : form.destino_contable === 'sin_clasificar' ? '__nose__'
                  : '';
                const obraSelForm = form.obra_id ? obrasParaSelector.find(o => o.id === form.obra_id) : null;
                const preInicio = obraSelForm?.fecha_inicio && form.date && form.date < obraSelForm.fecha_inicio;
                return (<>
                  <select className="fi" value={vincVal} onChange={e=>{
                    const v = e.target.value;
                    if (v === '__empresa__') setForm({...form, obra_id:'', destino_contable:'gastos_generales'});
                    else if (v === '__otros__') setForm({...form, obra_id:'', destino_contable:'contabilidad_neta'});
                    else if (v === '__nose__') setForm({...form, obra_id:'', destino_contable:'sin_clasificar'});
                    else setForm({...form, obra_id:v, destino_contable: v ? 'obra' : null});
                  }}>
                    <option value="">— Sin vinculación —</option>
                    <optgroup label="🏗 Obras">
                      {obrasParaSelector.map(o => <option key={o.id} value={o.id}>🏗 {o.nombre_obra}</option>)}
                    </optgroup>
                    <optgroup label="Sin obra">
                      <option value="__empresa__">🏢 Gastos Generales de la Empresa</option>
                      <option value="__otros__">📄 Contabilidad Neta (otros)</option>
                      <option value="__nose__">🤔 Sin clasificar (bandeja de la Contadora)</option>
                    </optgroup>
                  </select>
                  {preInicio && (
                    <div style={{ fontSize:10.5, color:'var(--amber)', marginTop:3 }}>
                      ⚠ La factura ({form.date}) es ANTERIOR al inicio de esta obra ({obraSelForm.fecha_inicio}). Puede ser una compra anticipada válida — verificá que sea la obra correcta.
                    </div>
                  )}
                </>);
              })()}
            </div>
            <div>
              <label className="flabel">Empresa *</label>
              <select className="fi" value={form.company_id||''} onChange={e=>setForm({...form, company_id:e.target.value})}>
                {companiesActivas.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="flabel">Fecha *</label>
              <input className="fi" type="date" value={form.date||''} onChange={e=>setForm({...form, date:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Tipo *</label>
              <select className="fi" value={form.type||'income'} onChange={e=>setForm({...form, type:e.target.value})}>
                <option value="income">Ingreso</option>
                <option value="cost">Costo</option>
                <option value="expense">Gasto</option>
              </select>
            </div>
            <div>
              <label className="flabel">Categoría</label>
              <input className="fi" placeholder="Ej: Materiales, Salarios, Servicios" value={form.category||''} onChange={e=>setForm({...form, category:e.target.value})}/>
            </div>
            <div>
              <label className="flabel" style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:6 }}>
                <span>Cuenta PCGE (opcional)</span>
                <button type="button" className="btn btn-ghost btn-xs"
                  disabled={aiSugLoading || (!form.description?.trim() && !form.category?.trim())}
                  title="Sugerir cuenta con IA según descripción y tercero"
                  onClick={sugerirCuenta}
                  style={{ fontSize:10 }}>
                  {aiSugLoading ? '⏳ Pensando…' : '✨ Sugerir'}
                </button>
              </label>
              <select className="fi" value={form.cuenta_pcge||''} onChange={e=>setForm({...form, cuenta_pcge:e.target.value})}>
                <option value="">Auto (según categoría)</option>
                {form.type === 'income' ? (
                  <>
                    <option value="70">70 — Ventas</option>
                    <option value="704">704 — Prestación de servicios</option>
                    <option value="75">75 — Otros ingresos de gestión</option>
                    <option value="77">77 — Ingresos financieros</option>
                  </>
                ) : (
                  <>
                    <option value="60">60 — Compras (materiales)</option>
                    <option value="62">62 — Gastos de personal</option>
                    <option value="63">63 — Servicios prestados por terceros</option>
                    <option value="64">64 — Tributos y aportes</option>
                    <option value="65">65 — Otros gastos de gestión</option>
                    <option value="66">66 — Pérdida medición de activos</option>
                    <option value="67">67 — Gastos financieros</option>
                    <option value="68">68 — Valuación y deterioro</option>
                  </>
                )}
              </select>
              {/* Panel de sugerencia IA */}
              {aiSugCuenta?.result?.cuenta_sugerida && (
                <div style={{ marginTop:6, padding:'8px 10px', borderRadius:6, fontSize:11,
                  background: aplicarSugerenciaAuto(aiSugCuenta) ? 'rgba(46,204,113,0.08)' : 'rgba(242,183,5,0.08)',
                  border: '1px solid ' + (aplicarSugerenciaAuto(aiSugCuenta) ? 'rgba(46,204,113,0.3)' : 'rgba(242,183,5,0.3)') }}>
                  <div style={{ color: aplicarSugerenciaAuto(aiSugCuenta) ? 'var(--green)' : 'var(--amber)', fontWeight:600, marginBottom:3 }}>
                    {aplicarSugerenciaAuto(aiSugCuenta) ? '✓' : '⚠'} IA sugiere: {aiSugCuenta.result.cuenta_sugerida} — {aiSugCuenta.result.descripcion_cuenta}
                    <span style={{ marginLeft:6, fontWeight:400, color:'var(--tm)' }}>({(aiSugCuenta.confianza*100).toFixed(0)}% confianza{aiSugCuenta._cached ? ' · cached' : ''})</span>
                  </div>
                  {aiSugCuenta.razonamiento && (
                    <div style={{ color:'var(--ts)', marginBottom:5 }}>{aiSugCuenta.razonamiento}</div>
                  )}
                  {!aplicarSugerenciaAuto(aiSugCuenta) && (
                    <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                      <button type="button" className="btn btn-amber btn-xs"
                        onClick={()=>{
                          setForm(prev => ({ ...prev, cuenta_pcge: aiSugCuenta.result.cuenta_sugerida }));
                          try { window.__logAudit?.({ action:'update', table:'audit', recordId:'sugerir-cuenta',
                            newData: { cuenta_aplicada: aiSugCuenta.result.cuenta_sugerida, modo: 'manual-confirm' },
                            reason: 'IA cuenta PCGE confirmada por usuario' }); } catch {}
                          setAiSugCuenta(null);
                        }}>
                        Aplicar {aiSugCuenta.result.cuenta_sugerida}
                      </button>
                      {(aiSugCuenta.result.alternativas || []).slice(0, 3).map((alt, i) => (
                        <button type="button" key={i} className="btn btn-ghost btn-xs"
                          onClick={()=>{
                            setForm(prev => ({ ...prev, cuenta_pcge: alt.cuenta }));
                            try { window.__logAudit?.({ action:'update', table:'audit', recordId:'sugerir-cuenta',
                              newData: { cuenta_aplicada: alt.cuenta, modo: 'alternativa-elegida' },
                              reason: `IA cuenta PCGE alternativa elegida: ${alt.cuenta}` }); } catch {}
                            setAiSugCuenta(null);
                          }}>
                          {alt.cuenta} — {alt.descripcion?.slice(0,30)}
                        </button>
                      ))}
                      <button type="button" className="btn btn-ghost btn-xs"
                        onClick={()=>{
                          try { window.__logAudit?.({ action:'update', table:'audit', recordId:'sugerir-cuenta',
                            newData: { modo: 'rechazada' },
                            reason: 'IA cuenta PCGE rechazada por usuario' }); } catch {}
                          setAiSugCuenta(null);
                        }}>
                        Descartar
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <label className="flabel">Descripción</label>
              <input className="fi" value={form.description||''} onChange={e=>setForm({...form, description:e.target.value})} placeholder="Ej: Cobro por contrato de obra"/>
            </div>
            <div>
              <label className="flabel">Monto *</label>
              <input className="fi" type="number" min="0" step="0.01" value={form.amount||''} onChange={e=>setForm({...form, amount:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Moneda</label>
              <select className="fi" value={form.currency||'PEN'} onChange={e=>setForm({...form, currency:e.target.value})}>
                <option value="PEN">S/ (PEN)</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div>
              <label className="flabel">Cliente / Proveedor</label>
              <input className="fi" value={form.third_party_name||''} onChange={e=>setForm({...form, third_party_name:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">RUC del tercero</label>
              <input className="fi" maxLength={11} value={form.third_party_ruc||''} onChange={e=>setForm({...form, third_party_ruc:e.target.value.replace(/\D/g,'').slice(0,11)})}/>
            </div>
            <div>
              <label className="flabel">Tipo documento</label>
              <select className="fi" value={form.document_type||'factura'} onChange={e=>setForm({...form, document_type:e.target.value})}>
                <option value="factura">Factura</option>
                <option value="boleta">Boleta</option>
                <option value="recibo">Recibo</option>
                <option value="contrato">Contrato</option>
                <option value="nota_credito">Nota de crédito</option>
                <option value="nota_debito">Nota de débito</option>
                <option value="otro">Otro</option>
              </select>
            </div>
            <div>
              <label className="flabel">N° documento</label>
              <input className="fi" value={form.document_number||''} onChange={e=>setForm({...form, document_number:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Estado de pago</label>
              <select className="fi" value={form.payment_status||'pending'} onChange={e=>setForm({...form, payment_status:e.target.value})}>
                <option value="pending">Pendiente</option>
                <option value="paid">Pagado</option>
                <option value="cancelled">Anulado</option>
              </select>
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <label className="flabel">Notas</label>
              <textarea className="fi" rows={2} value={form.notas||''} onChange={e=>setForm({...form, notas:e.target.value})}/>
            </div>
            {(() => {
              const monto = parseFloat(form.amount);
              const requiere = form.currency === 'PEN' && Number.isFinite(monto) && monto > 2000;
              if (!requiere) return null;
              const evBanc = editingId && bancarizacionPorMov.get(editingId);
              return (
                <div style={{ gridColumn:'1/-1', padding:'10px 12px', borderRadius:6, background:'rgba(242,183,5,0.06)', border:'1px solid rgba(242,183,5,0.3)' }}>
                  <div style={{ fontSize:12, fontWeight:600, color:'var(--amber)', marginBottom:6, display:'flex', alignItems:'center', gap:6 }}>
                    <JxIcon name="alert" size={13} color="var(--amber)"/> Bancarización requerida (monto &gt; S/2000)
                  </div>
                  {evBanc && (
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6, fontSize:12, color:'var(--green)' }}>
                      <span>✅ Evidencia adjunta · {evBanc.nombre}</span>
                      <button type="button" className="btn btn-ghost btn-xs" onClick={()=>setEvidenciaModal(evBanc)}><JxIcon name="eye" size={11}/> Ver</button>
                    </div>
                  )}
                  <input className="fi" type="file" accept="image/*,application/pdf" onChange={e=>setForm({...form, _bancFile: (e.target.files||[])[0] || null})}/>
                  {form._bancFile && <div style={{ fontSize:11, color:'var(--green)', marginTop:4 }}>📎 {form._bancFile.name} — se subirá al guardar{!form.obra_id ? ' (asigná una obra para poder subirla)' : ''}</div>}
                  {!form.obra_id && <div style={{ fontSize:11, color:'var(--tm)', marginTop:4 }}>Tip: elegí la obra arriba para subir la foto/voucher de la bancarización.</div>}
                </div>
              );
            })()}
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>{setModal(null); setEditingId(null);}}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardar}>
              <JxIcon name="check" size={13}/>{editingId ? 'Guardar Cambios' : 'Registrar'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ╔════════════════════════════════════════════════════════════╗
// ║  OPERACIONES ENTRE EMPRESAS (INTERCOMPANY)                 ║
// ╚════════════════════════════════════════════════════════════╝
function IntercompanyPage({ showToast }) {
  const auth = window.__useAuth?.();
  const myRol = auth?.profile?.rol;
  const isAdmin = myRol === 'admin';
  const userId = auth?.profile?.id ?? 'offline';
  const canWrite = isAdmin || (window.__hasPerm?.(myRol, 'Intercompany', 'w') ?? false);
  const { data: companies } = window.__hooks.useCompanies();
  const { data: ictx } = window.__hooks.useIntercompanyTransactions();

  const [modal, setModal] = uSC(false);
  const [form, setForm] = uSC({});

  const companiesActivas = uMC(() => (companies || []).filter(c => c.status === 'activa'), [companies]);
  const lookupCompany = (id) => companies?.find(c => c.id === id);

  const sorted = uMC(() => [...(ictx || [])].sort((a,b) => (b.date || '').localeCompare(a.date || '')), [ictx]);

  const openNueva = () => {
    if (companiesActivas.length < 2) {
      showToast('Necesitas al menos 2 empresas activas para registrar una operación interna', 'red');
      return;
    }
    setForm({
      seller_company_id: companiesActivas[0].id,
      buyer_company_id: companiesActivas[1].id,
      date: window.__fecha?.hoyLocal?.() || new Date().toISOString().slice(0,10),
      operation_type: 'materiales',
      description: '',
      amount: '',
      currency: 'PEN',
      document_type: 'factura',
      document_number: '',
      payment_status: 'pending',
      notas: '',
    });
    setModal(true);
  };

  // Crear: 1 transacción IC + 2 movimientos contables (ingreso vendedor + costo comprador) enlazados
  const guardar = async () => {
    if (!form.seller_company_id || !form.buyer_company_id) { showToast('Selecciona vendedor y comprador', 'red'); return; }
    if (form.seller_company_id === form.buyer_company_id) { showToast('El vendedor y el comprador no pueden ser la misma empresa', 'red'); return; }
    const monto = parseFloat(form.amount);
    if (!Number.isFinite(monto) || monto <= 0) { showToast('Monto inválido', 'red'); return; }

    const now = new Date().toISOString();
    const seller = lookupCompany(form.seller_company_id);
    const buyer  = lookupCompany(form.buyer_company_id);
    const sellerMovId = window.__newId();
    const buyerMovId  = window.__newId();
    const ictxId      = window.__newId();
    const opLabel = OP_TYPES.find(o => o.v === form.operation_type)?.label || form.operation_type;
    const isPrueba = getCurrentMode() === 'prueba';
    const syncBase = isPrueba ? 'synced' : 'pending_create';
    const demoFlag = isPrueba ? { demo: true } : {};

    try {
      // 1) Movimiento INGRESO en vendedor
      await window.__db.accounting_movements.add({
        id: sellerMovId,
        company_id: seller.id,
        date: form.date,
        type: 'income',
        category: opLabel,
        description: form.description || `${opLabel} a ${buyer.name}`,
        amount: monto,
        currency: form.currency,
        third_party_name: buyer.name,
        third_party_ruc: buyer.ruc || null,
        payment_status: form.payment_status,
        document_type: form.document_type || null,
        document_number: form.document_number || null,
        file_url: null,
        is_intercompany: true,
        related_company_id: buyer.id,
        // SIN link al comprador: el par con related_movement_id MUTUO (ambos
        // pending_create) se bloqueaba eternamente en el gate de FK del push
        // (el server tiene FK real). El vínculo queda derivable desde el
        // comprador, que sí apunta al vendedor.
        related_movement_id: null,
        notas: form.notas || null,
        created_by: userId, updated_by: userId,
        created_at: now, updated_at: now,
        version: 1, sync_status: syncBase, last_synced_at: null,
        idempotency_key: `${userId}_acc_mov_${sellerMovId}`,
        ...demoFlag,
      });

      // 2) Movimiento COSTO en comprador
      await window.__db.accounting_movements.add({
        id: buyerMovId,
        company_id: buyer.id,
        date: form.date,
        type: 'cost',
        category: opLabel,
        description: form.description || `${opLabel} desde ${seller.name}`,
        amount: monto,
        currency: form.currency,
        third_party_name: seller.name,
        third_party_ruc: seller.ruc || null,
        payment_status: form.payment_status,
        document_type: form.document_type || null,
        document_number: form.document_number || null,
        file_url: null,
        is_intercompany: true,
        related_company_id: seller.id,
        related_movement_id: sellerMovId,
        notas: form.notas || null,
        created_by: userId, updated_by: userId,
        created_at: now, updated_at: now,
        version: 1, sync_status: syncBase, last_synced_at: null,
        idempotency_key: `${userId}_acc_mov_${buyerMovId}`,
        ...demoFlag,
      });

      // 3) Transacción IC
      await window.__db.intercompany_transactions.add({
        id: ictxId,
        seller_company_id: seller.id,
        buyer_company_id: buyer.id,
        date: form.date,
        operation_type: form.operation_type,
        description: form.description || null,
        amount: monto,
        currency: form.currency,
        document_type: form.document_type || null,
        document_number: form.document_number || null,
        payment_status: form.payment_status,
        seller_movement_id: sellerMovId,
        buyer_movement_id: buyerMovId,
        notas: form.notas || null,
        created_by: userId, updated_by: userId,
        created_at: now, updated_at: now,
        version: 1, sync_status: syncBase, last_synced_at: null,
        idempotency_key: `${userId}_ictx_${ictxId}`,
        ...demoFlag,
      });

      try { await window.__logAudit?.({ action:'insert', table:'intercompany_transactions', recordId:ictxId,
        newData:{ seller: seller.name, buyer: buyer.name, amount: monto, op: opLabel },
        reason:`${opLabel}: ${seller.name} → ${buyer.name} por ${fmtCur(monto, form.currency)}` }); } catch {}

      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'accounting_movements' } })); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'intercompany_transactions' } })); } catch {}
      try { window.dispatchEvent(new Event('online')); } catch {}

      showToast(`Operación interna registrada: ${seller.name} → ${buyer.name} (${fmtCur(monto, form.currency)})`, 'green');
      setModal(false); setForm({});
    } catch (e) {
      showToast('Error: ' + (e.message || e), 'red');
    }
  };

  const eliminar = async (t) => {
    if (!isAdmin) return;
    if (!confirm(`¿Eliminar esta operación interna?\n\n${fmtCur(t.amount, t.currency)} entre ${lookupCompany(t.seller_company_id)?.name} → ${lookupCompany(t.buyer_company_id)?.name}\n\nSe eliminarán también los 2 movimientos contables asociados.`)) return;
    const now = new Date().toISOString();
    try {
      // Soft-delete los 2 movimientos relacionados + la transacción IC
      const ids = [t.seller_movement_id, t.buyer_movement_id].filter(Boolean);
      for (const id of ids) {
        const m = await window.__db.accounting_movements.get(id);
        if (m) {
          await window.__db.accounting_movements.update(id, {
            deleted_at: now,
            sync_status: m.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
          });
        }
      }
      await window.__db.intercompany_transactions.update(t.id, {
        deleted_at: now,
        sync_status: t.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
      });
      try { await window.__logAudit?.({ action:'delete', table:'intercompany_transactions', recordId:t.id, oldData:t }); } catch {}
      try {
        window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'accounting_movements' } }));
        window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'intercompany_transactions' } }));
      } catch {}
      showToast('Operación interna eliminada', 'amber');
    } catch (e) { showToast('Error: ' + (e.message||e), 'red'); }
  };

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Operaciones entre Empresas</div>
          <div className="pg-sub">{sorted.length} operaciones internas · cada una crea 2 movimientos contables enlazados (ingreso + costo)</div>
        </div>
        {canWrite ? (
          <button className="btn btn-amber btn-sm" onClick={openNueva}>
            <JxIcon name="plus" size={13}/>Nueva Operación Interna
          </button>
        ) : (
          <span className="badge b-gray" title="Tu rol es solo lectura para Intercompany">Solo lectura</span>
        )}
      </div>

      {sorted.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="compare" size={40} color="var(--tm)"/>
          <p style={{ maxWidth:520 }}>
            No hay operaciones internas registradas.<br/>
            Úsalas cuando una empresa del grupo le venda a otra (ej: comercializadora vende materiales a constructora).
            El sistema crea automáticamente los movimientos en ambas y los marca como internos para excluirlos del consolidado real.
          </p>
        </div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <div style={{ overflowX:'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Fecha</th><th>Vendedor → Comprador</th><th>Tipo</th>
                <th>Descripción</th><th>Doc.</th>
                <th style={{ textAlign:'right' }}>Monto</th><th>Estado pago</th>
                {isAdmin && <th style={{ textAlign:'center' }}>Acciones</th>}
              </tr></thead>
              <tbody>
                {sorted.map(t => {
                  const seller = lookupCompany(t.seller_company_id);
                  const buyer  = lookupCompany(t.buyer_company_id);
                  const opLabel = OP_TYPES.find(o => o.v === t.operation_type)?.label || t.operation_type;
                  return (
                    <tr key={t.id}>
                      <td className="col-m">{t.date}</td>
                      <td>
                        <strong>{seller?.name || '—'}</strong>
                        <span style={{ color:'var(--tm)', margin:'0 6px' }}>→</span>
                        <strong>{buyer?.name || '—'}</strong>
                      </td>
                      <td><span className="tag">{opLabel}</span></td>
                      <td style={{ fontSize:11.5 }}>{t.description || '—'}</td>
                      <td className="col-m" style={{ fontSize:11 }}>{t.document_type ? `${t.document_type} ${t.document_number || ''}` : '—'}</td>
                      <td style={{ textAlign:'right', fontWeight:700, color:'var(--blue)' }} className="col-num">{fmtCur(t.amount, t.currency)}</td>
                      <td><span className={`badge ${STATUS_BADGE[t.payment_status]}`}>{STATUS_LABEL[t.payment_status]}</span></td>
                      {isAdmin && (
                        <td style={{ textAlign:'center' }}>
                          <button className="btn btn-red btn-xs" title="Eliminar (también borra los 2 movimientos)" onClick={()=>eliminar(t)}>
                            <JxIcon name="trash" size={11}/>
                          </button>
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

      {modal && (
        <Modal title="Nueva Operación entre Empresas" icon="compare" onClose={()=>setModal(false)} wide>
          <div style={{ background:'rgba(52,152,219,0.06)', border:'1px solid rgba(52,152,219,0.25)', borderRadius:8, padding:'10px 12px', marginBottom:14, fontSize:12, color:'var(--ts)' }}>
            <strong style={{ color:'var(--blue)' }}>ℹ Cómo funciona:</strong> Esta operación crea automáticamente 2 movimientos contables:
            un <strong>INGRESO</strong> en la empresa vendedora y un <strong>COSTO</strong> en la compradora,
            ambos marcados como internos. En el consolidado real se restan para evitar contar dos veces.
          </div>
          <div className="g2">
            <div>
              <label className="flabel">Empresa vendedora *</label>
              <select className="fi" value={form.seller_company_id||''} onChange={e=>setForm({...form, seller_company_id:e.target.value})}>
                {companiesActivas.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="flabel">Empresa compradora *</label>
              <select className="fi" value={form.buyer_company_id||''} onChange={e=>setForm({...form, buyer_company_id:e.target.value})}>
                {companiesActivas.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="flabel">Fecha *</label>
              <input className="fi" type="date" value={form.date||''} onChange={e=>setForm({...form, date:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Tipo de operación</label>
              <select className="fi" value={form.operation_type||'materiales'} onChange={e=>setForm({...form, operation_type:e.target.value})}>
                {OP_TYPES.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <label className="flabel">Descripción</label>
              <input className="fi" value={form.description||''} onChange={e=>setForm({...form, description:e.target.value})} placeholder="Ej: Venta de cemento y agregados"/>
            </div>
            <div>
              <label className="flabel">Monto *</label>
              <input className="fi" type="number" min="0" step="0.01" value={form.amount||''} onChange={e=>setForm({...form, amount:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Moneda</label>
              <select className="fi" value={form.currency||'PEN'} onChange={e=>setForm({...form, currency:e.target.value})}>
                <option value="PEN">S/ (PEN)</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div>
              <label className="flabel">Tipo documento</label>
              <select className="fi" value={form.document_type||'factura'} onChange={e=>setForm({...form, document_type:e.target.value})}>
                <option value="factura">Factura</option>
                <option value="boleta">Boleta</option>
                <option value="contrato">Contrato</option>
                <option value="otro">Otro</option>
              </select>
            </div>
            <div>
              <label className="flabel">N° documento</label>
              <input className="fi" value={form.document_number||''} onChange={e=>setForm({...form, document_number:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Estado de pago</label>
              <select className="fi" value={form.payment_status||'pending'} onChange={e=>setForm({...form, payment_status:e.target.value})}>
                <option value="pending">Pendiente</option>
                <option value="paid">Pagado</option>
                <option value="cancelled">Anulado</option>
              </select>
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <label className="flabel">Notas</label>
              <textarea className="fi" rows={2} value={form.notas||''} onChange={e=>setForm({...form, notas:e.target.value})}/>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>setModal(false)}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardar}>
              <JxIcon name="check" size={13}/>Registrar Operación
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ╔════════════════════════════════════════════════════════════╗
// ║  DASHBOARD CONTABLE                                        ║
// ╚════════════════════════════════════════════════════════════╝
function ContabilidadDashboardPage({ showToast }) {
  // Vincular/cerrar un ingreso sin sustento ESCRIBE en movimientos_materiales
  // (módulo 'Mov. Materiales'). Si el rol no puede pushear esa tabla (contador y
  // ayudante tienen 'x' ahí), el cambio se aplicaría solo en local y nunca
  // sincronizaría → inconsistencia entre dispositivos. Por eso solo mostramos las
  // acciones a quien SÍ puede pushear (almacén/admin); el resto ve el aviso pero
  // no puede disparar la escritura rota (lo resuelve almacén en "Compras pendientes").
  const _dashRol = window.__useAuth?.()?.profile?.rol;
  const canVincSustento = _dashRol === 'admin' || (window.__hasPerm?.(_dashRol, 'Mov. Materiales', 'w') ?? false);
  const { data: companies } = window.__hooks.useCompanies();
  const { data: movs } = window.__hooks.useAccountingMovements();
  const { data: materiales } = window.__hooks.useMateriales();
  // Proveedores cargados manualmente — no hay hook genérico
  const [providers, setProviders] = uSC([]);
  uEC(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await window.__db.proveedores.filter(p => !p.deleted_at).toArray();
        if (!cancelled) setProviders(rows);
      } catch {}
    };
    load();
    const onChange = (e) => {
      const t = e?.detail?.tabla || e?.detail?.table;
      if (!t || t === 'proveedores') load();
    };
    window.addEventListener('jx_data_changed', onChange);
    return () => { cancelled = true; window.removeEventListener('jx_data_changed', onChange); };
  }, []);

  const [filtroEmpresa, setFiltroEmpresa] = uSC('todas');
  const [filtroMoneda, setFiltroMoneda] = uSC('PEN');
  const [filtroDesde, setFiltroDesde] = uSC('');
  const [filtroHasta, setFiltroHasta] = uSC('');

  // ── Ingresos pendientes de sustento (flujo inverso almacén → contabilidad) ──
  // La almacenera puede registrar ingresos sin factura. Aquí la contadora
  // los ve para vincularlos a una factura existente o marcarlos como
  // consumo sin sustento.
  const [pendientesSustento, setPendientesSustento] = uSC([]);
  const [vincularModal, setVincularModal] = uSC(null); // movimiento_materiales pendiente
  const [cerrarSinFacturaModal, setCerrarSinFacturaModal] = uSC(null);

  uEC(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await window.__db.movimientos_materiales
          .filter(m => m.pendiente_sustento === true && !m.accounting_movement_id
            && !m.deleted_at && m.demo !== true)
          .toArray();
        rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        if (!cancelled) setPendientesSustento(rows);
      } catch (e) {
        console.warn('[contabilidad] no se pudo cargar pendientes_sustento:', e?.message);
      }
    };
    load();
    const onChange = (e) => {
      const t = e?.detail?.tabla || e?.detail?.table;
      if (!t || t === 'movimientos_materiales') load();
    };
    window.addEventListener('jx_data_changed', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('jx_data_changed', onChange);
    };
  }, []);

  // Agrupar pendientes por proveedor (o "Sin proveedor" si null) para
  // facilitar el matching con facturas reales.
  const pendientesAgrupados = uMC(() => {
    const grupos = new Map();
    for (const mov of pendientesSustento) {
      const provId = mov.proveedor_id || '__sin_proveedor__';
      if (!grupos.has(provId)) grupos.set(provId, { proveedor_id: mov.proveedor_id, items: [] });
      grupos.get(provId).items.push(mov);
    }
    return Array.from(grupos.values());
  }, [pendientesSustento]);

  const matName = (id) => (materiales || []).find(m => m.id === id)?.nombre_material || '—';
  const provName = (id) => id ? ((providers || []).find(p => p.id === id)?.razon_social || '—') : 'Sin proveedor';

  // ── Sugerencias inteligentes para "Vincular factura" ──
  // MISMO matcher determinista que usa la almacenera con el 🔎 (insumo/fecha/
  // cantidad/proveedor/obra — rankearFacturasParaIngreso). Antes la contadora
  // veía solo "número de factura + fecha + monto" y tenía que adivinar; ahora ve
  // POR QUÉ cuadra cada factura y el ítem exacto de la factura que coincide.
  const sugerenciasVincular = uMC(() => {
    if (!vincularModal) return [];
    const facturas = (movs || []).filter(f => !f.deleted_at
      && (f.clase === 'compra' || f.type === 'cost')
      && f.clase !== 'venta' && f.type !== 'income'
      && f.recepcion_status !== 'no_aplica'
      && (vincularModal.obra_id ? (f.obra_id === vincularModal.obra_id || !f.obra_id) : true));
    const ingreso = {
      id: vincularModal.id,
      material_id: vincularModal.material_id,
      materialNombre: matName(vincularModal.material_id),
      cantidad: vincularModal.cantidad,
      unidad: vincularModal.unidad,
      fecha: vincularModal.fecha,
      obra_id: vincularModal.obra_id,
      proveedor_id: vincularModal.proveedor_id || null,
    };
    return rankearFacturasParaIngreso(ingreso, facturas);
  }, [vincularModal, movs, materiales]);

  const filtered = uMC(() => {
    let f = (movs || []).filter(m => m.currency === filtroMoneda);
    if (filtroEmpresa !== 'todas') f = f.filter(m => m.company_id === filtroEmpresa);
    if (filtroDesde) f = f.filter(m => (m.date || '') >= filtroDesde);
    if (filtroHasta) f = f.filter(m => (m.date || '') <= filtroHasta);
    return f;
  }, [movs, filtroEmpresa, filtroMoneda, filtroDesde, filtroHasta]);

  const kpis = uMC(() => {
    let ingresos = 0, costos = 0, gastos = 0, porCobrar = 0, porPagar = 0;
    filtered.forEach(m => {
      const a = Number(m.amount || 0);
      if (m.payment_status === 'cancelled') return;
      if (m.type === 'income')  ingresos += a;
      if (m.type === 'cost')    costos += a;
      if (m.type === 'expense') gastos += a;
      if (m.payment_status === 'pending') {
        if (m.type === 'income') porCobrar += a;
        else porPagar += a;
      }
    });
    const utilidad = ingresos - costos - gastos;
    const margen = ingresos > 0 ? (utilidad / ingresos * 100) : 0;
    return { ingresos, costos, gastos, utilidad, margen, porCobrar, porPagar };
  }, [filtered]);

  // Datos para las gráficas: evolución mensual (hasta 12 meses) de ingresos /
  // costos / gastos / utilidad. `sig` = firma para reconstruir el chart sólo
  // cuando los datos cambian (no en cada render).
  const chartData = uMC(() => {
    const porMes = new Map(); // 'YYYY-MM' -> { ing, cos, gas }
    for (const m of filtered) {
      if (m.payment_status === 'cancelled') continue;
      const ym = (m.date || '').slice(0, 7);
      if (!ym) continue;
      const a = Number(m.amount || 0);
      const cur = porMes.get(ym) || { ing: 0, cos: 0, gas: 0 };
      if (m.type === 'income') cur.ing += a;
      else if (m.type === 'cost') cur.cos += a;
      else if (m.type === 'expense') cur.gas += a;
      porMes.set(ym, cur);
    }
    const meses = Array.from(porMes.keys()).sort().slice(-12);
    const ing = meses.map(k => porMes.get(k).ing);
    const cos = meses.map(k => porMes.get(k).cos);
    const gas = meses.map(k => porMes.get(k).gas);
    const uti = meses.map((k, i) => ing[i] - cos[i] - gas[i]);
    // sig DEBE reflejar todos los valores renderizados (no solo el total): así el
    // chart se reconstruye también si se edita un tipo (income↔cost, mismo monto) o
    // se mueve un movimiento entre meses ya presentes. Incluimos las series y los 3
    // totales del doughnut.
    const sig = `${filtroMoneda}|${filtroEmpresa}|${filtroDesde}|${filtroHasta}|${meses.join(',')}|${ing.join(',')}|${cos.join(',')}|${gas.join(',')}|${Math.round(kpis.ingresos)}|${Math.round(kpis.costos)}|${Math.round(kpis.gastos)}`;
    return { meses, labels: meses.map(nombreMes), ing, cos, gas, uti, sig, hayDatos: meses.length > 0 };
  }, [filtered, filtroMoneda, filtroEmpresa, filtroDesde, filtroHasta, kpis]);

  // ── Handlers de pendientes de sustento ────────────────────────────
  const userId = window.__useAuth?.()?.profile?.id || 'offline';

  // Vincular un movimiento pendiente a una factura existente (accounting_movement
  // del mismo proveedor). Por simplicidad, se hace 1:1 — un mov ↔ una factura.
  // Guard SÍNCRONO anti doble-click (regla del repo): sin él, dos clicks en la
  // misma sugerencia re-sumaban la cantidad del ingreso a items_factura[idx].recibido.
  const vinculandoSustentoRef = uRC(false);
  const vincularAFactura = async (mov, accountingMovId, itemIdx = null) => {
    if (vinculandoSustentoRef.current) return;
    vinculandoSustentoRef.current = true;
    try {
      await vincularAFacturaInner(mov, accountingMovId, itemIdx);
    } finally {
      vinculandoSustentoRef.current = false;
    }
  };
  const vincularAFacturaInner = async (mov, accountingMovId, itemIdx = null) => {
    try {
      const factura = (movs || []).find(m => m.id === accountingMovId);
      if (!factura) { showToast?.('Factura no encontrada', 'red'); return; }
      const now = new Date().toISOString();
      await window.__db.movimientos_materiales.update(mov.id, {
        accounting_movement_id: accountingMovId,
        pendiente_sustento: false,
        updated_at: now,
        updated_by: userId,
        version: (mov.version ?? 0) + 1,
        sync_status: mov.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      // Si se vinculó desde una SUGERENCIA (sabemos el ítem exacto), escribimos
      // también el lado de la factura como lo hace la almacenera con el 🔎:
      // items_factura[idx].{recibido, mov_vinculado_id} + recepcion_status
      // recalculado — así el reporte de recepción queda exacto en ambos flujos.
      if (itemIdx != null) {
        const facFresh = await window.__db.accounting_movements.get(accountingMovId);
        const notas = parseNotas(facFresh?.notas);
        const items = Array.isArray(notas.items_factura) ? notas.items_factura.slice() : [];
        const orig = items[itemIdx];
        if (orig) {
          const qty = Number(mov.cantidad) || 0;
          const nuevoRecibido = Number(orig.cantidad) > 0
            ? Math.min(Number(orig.cantidad), (Number(orig.recibido) || 0) + qty)
            : (Number(orig.recibido) || 0) + qty;
          items[itemIdx] = { ...orig, recibido: nuevoRecibido, mov_vinculado_id: mov.id, recepcion_modo: 'vinculado' };
          notas.items_factura = items;
          await window.__db.accounting_movements.update(accountingMovId, {
            notas: JSON.stringify(notas),
            recepcion_status: estadoRecepcionDeItems(items),
            recepcion_movimiento_id: facFresh.recepcion_movimiento_id || mov.id,
            updated_at: now,
            updated_by: userId,
            version: (facFresh.version ?? 0) + 1,
            sync_status: facFresh.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
          });
        }
      } else if (factura.recepcion_status === 'pendiente_recepcion' || !factura.recepcion_status) {
        // Vinculación manual (sin ítem conocido): la factura pasa a 'parcial' —
        // la almacenera la cerrará completa después.
        await window.__db.accounting_movements.update(accountingMovId, {
          recepcion_status: 'parcial',
          updated_at: now,
          updated_by: userId,
          version: (factura.version ?? 0) + 1,
          sync_status: factura.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
      }
      try { await window.__logAudit?.({ action:'update', table:'movimientos_materiales', recordId: mov.id, oldData:{ pendiente_sustento:true }, newData:{ accounting_movement_id: accountingMovId }, reason:`Vinculado a factura ${factura.document_number || accountingMovId}` }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'movimientos_materiales' } })); } catch {}
      // También avisar el cambio en la FACTURA: sin esto, `movs` quedaba stale y
      // el modal re-sugería la misma línea ya completada.
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'accounting_movements' } })); } catch {}
      try { window.dispatchEvent(new Event('online')); } catch {}
      showToast?.(`✓ Ingreso vinculado a factura ${factura.document_number || ''}`, 'green');
      setVincularModal(null);
    } catch (e) {
      showToast?.('Error al vincular: ' + (e.message || e), 'red');
    }
  };

  // Marcar el ingreso como "sin factura" definitivo (consumo interno, donación,
  // material de descarte, etc.) — pendiente_sustento pasa a false sin link.
  const cerrarSinFactura = async (mov, motivo) => {
    if (!motivo || motivo.trim().length < 5) {
      showToast?.('Escribí un motivo (mín 5 caracteres)', 'red');
      return;
    }
    try {
      const now = new Date().toISOString();
      const obs = `${mov.observaciones_almacen ? mov.observaciones_almacen + ' · ' : ''}[cerrado sin factura: ${motivo.trim()}]`;
      await window.__db.movimientos_materiales.update(mov.id, {
        pendiente_sustento: false,
        observaciones_almacen: obs,
        updated_at: now,
        updated_by: userId,
        version: (mov.version ?? 0) + 1,
        sync_status: mov.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      try { await window.__logAudit?.({ action:'update', table:'movimientos_materiales', recordId: mov.id, oldData:{ pendiente_sustento:true }, newData:{ pendiente_sustento:false }, reason:`Cerrado sin factura: ${motivo.trim()}` }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'movimientos_materiales' } })); } catch {}
      try { window.dispatchEvent(new Event('online')); } catch {}
      showToast?.('✓ Ingreso cerrado sin factura', 'amber');
      setCerrarSinFacturaModal(null);
    } catch (e) {
      showToast?.('Error: ' + (e.message || e), 'red');
    }
  };

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Dashboard Contable</div>
          <div className="pg-sub">Vista rápida de ingresos, costos y márgenes por empresa</div>
        </div>
      </div>

      {/* ── Ingresos sin sustento (flujo inverso almacén → contabilidad) ── */}
      {pendientesSustento.length > 0 && (
        <div className="card" style={{ marginBottom:16, padding:'14px 16px', background:'rgba(242,183,5,0.06)', border:'1px solid rgba(242,183,5,0.35)' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10 }}>
            <div>
              <div style={{ fontSize:14, fontWeight:700, color:'var(--amber)' }}>
                🧾 {pendientesSustento.length} ingreso(s) sin sustento documental
              </div>
              <div style={{ fontSize:11.5, color:'var(--tm)', marginTop:3, lineHeight:1.5 }}>
                Almacén registró estos materiales sin factura. Vinculalos a una factura existente, o marcalos como "sin factura" si fue consumo interno / donación / muestra.
              </div>
            </div>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:6, maxHeight:300, overflowY:'auto' }}>
            {pendientesAgrupados.map(grp => (
              <div key={grp.proveedor_id || 'sin_prov'} style={{ background:'rgba(0,0,0,0.15)', borderRadius:6, padding:'8px 10px' }}>
                <div style={{ fontSize:11, color:'var(--tm)', marginBottom:6, fontWeight:600 }}>
                  Proveedor: <span style={{ color:'var(--tp)' }}>{provName(grp.proveedor_id)}</span>
                  <span style={{ marginLeft:8, opacity:0.6 }}>· {grp.items.length} ítem(s)</span>
                </div>
                {grp.items.map(mov => (
                  <div key={mov.id} style={{ display:'grid', gridTemplateColumns:'1fr 1fr auto auto', gap:8, alignItems:'center', padding:'6px 0', borderTop:'1px solid rgba(255,255,255,0.04)', fontSize:12 }}>
                    <div>
                      <div style={{ color:'var(--tp)', fontWeight:600 }}>{matName(mov.material_id)}</div>
                      <div style={{ fontSize:10.5, color:'var(--tm)' }}>{mov.fecha} · {mov.cantidad} {mov.unidad}</div>
                    </div>
                    <div style={{ fontSize:10.5, color:'var(--tm)', fontStyle:'italic' }}>
                      {mov.observaciones_almacen || '—'}
                    </div>
                    {canVincSustento ? (
                      <>
                        <button className="btn btn-amber btn-sm" onClick={()=>setVincularModal(mov)} title="Vincular a una factura existente de este proveedor">
                          <JxIcon name="link" size={11}/> Vincular factura
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={()=>setCerrarSinFacturaModal(mov)} title="Marcar como consumo sin factura">
                          <JxIcon name="x" size={11}/> Sin factura
                        </button>
                      </>
                    ) : (
                      <span style={{ gridColumn:'3 / span 2', fontSize:10.5, color:'var(--tm)', fontStyle:'italic', textAlign:'right' }} title="Esta acción escribe en almacén; la resuelve el almacenero en 'Compras pendientes'">Lo vincula almacén</span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal: vincular a factura existente */}
      {vincularModal && (
        <Modal title={`Vincular a factura — ${matName(vincularModal.material_id)}`} icon="link" onClose={()=>setVincularModal(null)}>
          <div style={{ fontSize:12, color:'var(--tm)', marginBottom:10 }}>
            Seleccioná la factura del proveedor <strong>{provName(vincularModal.proveedor_id)}</strong> que sustenta este ingreso de <strong>{vincularModal.cantidad} {vincularModal.unidad}</strong> de <strong>{matName(vincularModal.material_id)}</strong>.
          </div>
          {(() => {
            const estadoRec = (f) => f.recepcion_status === 'recibido' ? '✓ recibida'
              : f.recepcion_status === 'parcial' ? '⏳ parcial'
              : f.recepcion_status === 'pendiente_recepcion' ? '🆕 pendiente'
              : f.recepcion_status === 'no_recepcionado' ? '🚫 negada por almacén'
              : '—';
            const sugeridas = new Set(sugerenciasVincular.map(c => c.facturaId));
            const candidatas = (movs || []).filter(m =>
              (m.type === 'cost' || m.type === 'expense') &&
              (!vincularModal.proveedor_id || m.proveedor_id === vincularModal.proveedor_id) &&
              !m.deleted_at && !sugeridas.has(m.id));
            if (!sugerenciasVincular.length && !candidatas.length) {
              return (
                <div style={{ padding:'14px', background:'rgba(231,76,60,0.08)', border:'1px solid rgba(231,76,60,0.3)', borderRadius:6, fontSize:12, color:'var(--ts)' }}>
                  No hay facturas registradas para este proveedor. Subí la factura primero por Captura Mágica.
                </div>
              );
            }
            return (
              <div style={{ maxHeight:380, overflowY:'auto', display:'flex', flexDirection:'column', gap:6 }}>
                {/* ── SUGERENCIAS: mismas señales que ve la almacenera (🔎) ── */}
                {sugerenciasVincular.length > 0 && (
                  <div style={{ fontSize:11, fontWeight:700, color:'var(--green)' }}>
                    🎯 Coinciden con este ingreso (insumo · fecha · cantidad):
                  </div>
                )}
                {sugerenciasVincular.map(cand => {
                  const f = (movs || []).find(m => m.id === cand.facturaId);
                  if (!f) return null;
                  const it = itemsDeFactura(f)[cand.item_idx] || {};
                  return (
                    <button key={`sug-${cand.facturaId}`} className="card card-p"
                      style={{ textAlign:'left', cursor:'pointer', border:'1px solid rgba(46,204,113,0.45)', background:'rgba(46,204,113,0.05)' }}
                      title="Vincular: marca el ítem de la factura como recibido con este ingreso"
                      onClick={()=>vincularAFactura(vincularModal, cand.facturaId, cand.item_idx)}>
                      <div style={{ display:'flex', justifyContent:'space-between', gap:8, fontSize:12 }}>
                        <div style={{ minWidth:0 }}>
                          <div style={{ fontWeight:700, color:'var(--tp)' }}>
                            {f.document_number || 'sin n°'}
                            <span style={{ fontWeight:400, color:'var(--tm)', marginLeft:6, fontSize:10.5 }}>{f.date} · {f.third_party_name || provName(f.proveedor_id)} · S/ {Number(f.amount || 0).toLocaleString('es-PE')}</span>
                          </div>
                          {/* El ÍTEM exacto de la factura que cuadra con el ingreso */}
                          <div style={{ fontSize:11.5, color:'var(--ts)', marginTop:3 }}>
                            → <strong>{it.descripcion || '(ítem)'}</strong> · {Number(it.cantidad) || '?'} {it.unidad || ''}
                            {Number(it.precio_unitario) > 0 && <span style={{ color:'var(--tm)' }}> · S/ {Number(it.precio_unitario).toLocaleString('es-PE')} c/u</span>}
                            {Number(it.recibido) > 0 && <span style={{ color:'var(--amber)' }}> · ya recibido {Number(it.recibido)}</span>}
                          </div>
                          {/* Por qué cuadra (motivos del matcher) */}
                          <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginTop:4 }}>
                            {(cand.motivos || []).map((mo, i) => (
                              <span key={i} className="badge b-green" style={{ fontSize:9 }}>{mo}</span>
                            ))}
                          </div>
                        </div>
                        <div style={{ textAlign:'right', flexShrink:0 }}>
                          <div style={{ fontSize:14, fontWeight:800, color:'var(--green)' }}>{Math.round(cand.score * 100)}%</div>
                          <div style={{ fontSize:10, color:'var(--tm)' }}>{estadoRec(f)}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
                {/* ── Resto de facturas del proveedor (elección manual) ── */}
                {candidatas.length > 0 && (
                  <div style={{ fontSize:11, fontWeight:700, color:'var(--tm)', marginTop: sugerenciasVincular.length ? 8 : 0 }}>
                    {sugerenciasVincular.length ? 'Otras facturas (elección manual):' : 'Facturas del proveedor:'}
                  </div>
                )}
                {candidatas.slice(0, 30).map(f => {
                  const items = itemsDeFactura(f);
                  return (
                    <button key={f.id} className="card card-p" style={{ textAlign:'left', cursor:'pointer', border:'1px solid var(--bd)' }}
                      onClick={()=>vincularAFactura(vincularModal, f.id)}>
                      <div style={{ display:'flex', justifyContent:'space-between', gap:8, fontSize:12 }}>
                        <div style={{ minWidth:0 }}>
                          <div style={{ fontWeight:700, color:'var(--tp)' }}>{f.document_number || 'sin n°'}</div>
                          <div style={{ fontSize:10.5, color:'var(--tm)' }}>{f.date} · {f.third_party_name || provName(f.proveedor_id)} · S/ {Number(f.amount || 0).toLocaleString('es-PE')}</div>
                          {/* Ítems de la factura (hasta 3) para no vincular a ciegas */}
                          {items.length > 0 && (
                            <div style={{ fontSize:10.5, color:'var(--ts)', marginTop:3 }}>
                              {items.slice(0, 3).map((it, i) => (
                                <div key={i} style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                                  · {it.descripcion} — {Number(it.cantidad) || '?'} {it.unidad || ''}
                                </div>
                              ))}
                              {items.length > 3 && <div style={{ color:'var(--tm)' }}>… y {items.length - 3} ítem(s) más</div>}
                            </div>
                          )}
                        </div>
                        <div style={{ fontSize:10.5, color:'var(--tm)', flexShrink:0 }}>{estadoRec(f)}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </Modal>
      )}

      {/* Modal: cerrar sin factura */}
      {cerrarSinFacturaModal && (
        <CerrarSinFacturaModal
          mov={cerrarSinFacturaModal}
          matName={matName(cerrarSinFacturaModal.material_id)}
          onClose={()=>setCerrarSinFacturaModal(null)}
          onConfirm={(motivo)=>cerrarSinFactura(cerrarSinFacturaModal, motivo)}/>
      )}

      {/* Filtros */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:14 }}>
        <select className="fi" value={filtroEmpresa} onChange={e=>setFiltroEmpresa(e.target.value)} style={{ minWidth:180 }}>
          <option value="todas">Todas las empresas</option>
          {(companies || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="fi" value={filtroMoneda} onChange={e=>setFiltroMoneda(e.target.value)} style={{ minWidth:100 }}>
          <option value="PEN">S/ (PEN)</option>
          <option value="USD">USD</option>
        </select>
        <label style={{ fontSize:11, color:'var(--tm)' }}>Desde:</label>
        <input className="fi" type="date" value={filtroDesde} onChange={e=>setFiltroDesde(e.target.value)} style={{ minWidth:140 }}/>
        <label style={{ fontSize:11, color:'var(--tm)' }}>Hasta:</label>
        <input className="fi" type="date" value={filtroHasta} onChange={e=>setFiltroHasta(e.target.value)} style={{ minWidth:140 }}/>
        {(filtroEmpresa!=='todas' || filtroDesde || filtroHasta) && (
          <button className="btn btn-ghost btn-sm" onClick={()=>{ setFiltroEmpresa('todas'); setFiltroDesde(''); setFiltroHasta(''); }}>
            <JxIcon name="x" size={11}/> Limpiar
          </button>
        )}
        <span style={{ fontSize:11, color:'var(--tm)' }}>{filtered.length} movimientos</span>
      </div>

      {/* KPIs principales */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(170px, 1fr))', gap:12, marginBottom:18 }}>
        <div className="card card-p" style={{ borderLeft:'3px solid var(--green)' }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Ingresos</div>
          <div style={{ fontSize:22, fontWeight:800, color:'var(--green)', marginTop:4 }}>{fmtCurK(kpis.ingresos, filtroMoneda)}</div>
        </div>
        <div className="card card-p" style={{ borderLeft:'3px solid var(--red)' }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Costos</div>
          <div style={{ fontSize:22, fontWeight:800, color:'var(--red)', marginTop:4 }}>{fmtCurK(kpis.costos, filtroMoneda)}</div>
        </div>
        <div className="card card-p" style={{ borderLeft:'3px solid var(--amber)' }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Gastos</div>
          <div style={{ fontSize:22, fontWeight:800, color:'var(--amber)', marginTop:4 }}>{fmtCurK(kpis.gastos, filtroMoneda)}</div>
        </div>
        <div className="card card-p" style={{ borderLeft:`3px solid ${kpis.utilidad >= 0 ? 'var(--blue)' : 'var(--red)'}` }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Utilidad neta</div>
          <div style={{ fontSize:22, fontWeight:800, color: kpis.utilidad>=0?'var(--blue)':'var(--red)', marginTop:4 }}>{fmtCurK(kpis.utilidad, filtroMoneda)}</div>
        </div>
        <div className="card card-p" style={{ borderLeft:'3px solid var(--ts)' }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Margen neto</div>
          <div style={{ fontSize:22, fontWeight:800, color: kpis.margen>=0?'var(--green)':'var(--red)', marginTop:4 }}>
            {kpis.margen.toFixed(1)}%
          </div>
        </div>
        <div className="card card-p" style={{ borderLeft:'3px solid var(--orange)' }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Por cobrar</div>
          <div style={{ fontSize:22, fontWeight:800, color:'var(--orange)', marginTop:4 }}>{fmtCurK(kpis.porCobrar, filtroMoneda)}</div>
        </div>
        <div className="card card-p" style={{ borderLeft:'3px solid var(--orange)' }}>
          <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Por pagar</div>
          <div style={{ fontSize:22, fontWeight:800, color:'var(--orange)', marginTop:4 }}>{fmtCurK(kpis.porPagar, filtroMoneda)}</div>
        </div>
      </div>

      {/* Gráficas interactivas */}
      <div style={{ display:'grid', gridTemplateColumns:'minmax(0,2fr) minmax(0,1fr)', gap:14, marginBottom:18 }}>
        <div className="card card-p">
          <div style={{ fontSize:12.5, fontWeight:700, color:'var(--ts)', marginBottom:8 }}>Evolución mensual ({filtroMoneda})</div>
          {chartData.hayDatos ? (
            <ChartCanvas type="bar" height={260} sig={chartData.sig}
              data={{ labels: chartData.labels, datasets: [
                { label:'Ingresos', data: chartData.ing, backgroundColor: CHART_GREEN, borderRadius:4, order:2 },
                { label:'Costos',   data: chartData.cos, backgroundColor: CHART_RED,   borderRadius:4, order:2 },
                { label:'Gastos',   data: chartData.gas, backgroundColor: CHART_AMBER, borderRadius:4, order:2 },
                { type:'line', label:'Utilidad', data: chartData.uti, borderColor: CHART_BLUE, backgroundColor:'rgba(74,144,226,0.15)', borderWidth:2, tension:0.25, fill:false, order:1, pointRadius:3 },
              ] }}
              options={{ responsive:true, maintainAspectRatio:false, interaction:{ mode:'index', intersect:false },
                plugins:{ legend:{ position:'bottom', ...CHART_LEGEND } },
                scales:{ ...CHART_AXIS, y:{ ...CHART_AXIS.y, ticks:{ ...CHART_AXIS.y.ticks, callback:(v)=>fmtCurK(v, filtroMoneda) } } } }}/>
          ) : (
            <div className="empty-state" style={{ padding:'34px 0' }}><JxIcon name="chart" size={28} color="var(--tm)"/><p style={{ fontSize:12 }}>Sin movimientos en el rango.</p></div>
          )}
        </div>
        <div className="card card-p">
          <div style={{ fontSize:12.5, fontWeight:700, color:'var(--ts)', marginBottom:8 }}>Distribución por tipo</div>
          {(kpis.ingresos + kpis.costos + kpis.gastos) > 0 ? (
            <ChartCanvas type="doughnut" height={260} sig={chartData.sig}
              data={{ labels:['Ingresos','Costos','Gastos'], datasets:[{ data:[kpis.ingresos, kpis.costos, kpis.gastos], backgroundColor:[CHART_GREEN, CHART_RED, CHART_AMBER], borderWidth:2, borderColor:'#1C2D40' }] }}
              options={{ responsive:true, maintainAspectRatio:false, cutout:'62%', plugins:{ legend:{ position:'bottom', ...CHART_LEGEND } } }}/>
          ) : (
            <div className="empty-state" style={{ padding:'34px 0' }}><JxIcon name="chart" size={28} color="var(--tm)"/><p style={{ fontSize:12 }}>Sin datos.</p></div>
          )}
        </div>
      </div>

      {/* Resumen por empresa */}
      {filtroEmpresa === 'todas' && (companies || []).length > 0 && (
        <div className="card" style={{ overflow:'hidden' }}>
          <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontSize:13, fontWeight:700 }}>
            Desglose por empresa ({filtroMoneda})
          </div>
          <div style={{ overflowX:'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Empresa</th>
                <th style={{ textAlign:'right' }}>Ingresos</th>
                <th style={{ textAlign:'right' }}>Costos</th>
                <th style={{ textAlign:'right' }}>Gastos</th>
                <th style={{ textAlign:'right' }}>Utilidad</th>
                <th style={{ textAlign:'right' }}>Margen</th>
              </tr></thead>
              <tbody>
                {(companies || []).filter(c => c.status === 'activa').map(c => {
                  const ms = filtered.filter(m => m.company_id === c.id);
                  let i=0,co=0,g=0;
                  ms.forEach(m => {
                    const a = Number(m.amount||0);
                    if (m.payment_status === 'cancelled') return;
                    if (m.type === 'income') i+=a;
                    if (m.type === 'cost') co+=a;
                    if (m.type === 'expense') g+=a;
                  });
                  const u = i - co - g;
                  const mg = i>0 ? (u/i*100) : 0;
                  return (
                    <tr key={c.id}>
                      <td className="col-p">{c.name}</td>
                      <td style={{ textAlign:'right' }} className="col-num"><span style={{ color:'var(--green)' }}>{fmtCur(i, filtroMoneda)}</span></td>
                      <td style={{ textAlign:'right' }} className="col-num"><span style={{ color:'var(--red)' }}>{fmtCur(co, filtroMoneda)}</span></td>
                      <td style={{ textAlign:'right' }} className="col-num"><span style={{ color:'var(--amber)' }}>{fmtCur(g, filtroMoneda)}</span></td>
                      <td style={{ textAlign:'right', fontWeight:700, color: u>=0?'var(--blue)':'var(--red)' }} className="col-num">{fmtCur(u, filtroMoneda)}</td>
                      <td style={{ textAlign:'right', color: mg>=0?'var(--green)':'var(--red)' }} className="col-num">{mg.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ╔════════════════════════════════════════════════════════════╗
// ║  CONSOLIDADO                                               ║
// ╚════════════════════════════════════════════════════════════╝
function ConsolidadoPage({ showToast }) {
  const { data: companies } = window.__hooks.useCompanies();
  const { data: movs } = window.__hooks.useAccountingMovements();

  const [moneda, setMoneda] = uSC('PEN');
  const [vista, setVista] = uSC('real'); // 'real' | 'acumulado'

  const data = uMC(() => {
    const ms = (movs || []).filter(m => m.currency === moneda && m.payment_status !== 'cancelled');

    // Acumulado (incluye internas)
    let inAcum=0, coAcum=0, gAcum=0;
    // Externos (excluye internas)
    let inExt=0, coExt=0, gExt=0;
    // Internas (separadas)
    let inInt=0, coInt=0;

    ms.forEach(m => {
      const a = Number(m.amount||0);
      if (m.type === 'income')  inAcum += a;
      if (m.type === 'cost')    coAcum += a;
      if (m.type === 'expense') gAcum += a;

      if (m.is_intercompany) {
        if (m.type === 'income') inInt += a;
        if (m.type === 'cost')   coInt += a;
      } else {
        if (m.type === 'income')  inExt += a;
        if (m.type === 'cost')    coExt += a;
        if (m.type === 'expense') gExt += a;
      }
    });

    const utilidadAcum = inAcum - coAcum - gAcum;
    const margenAcum   = inAcum > 0 ? (utilidadAcum / inAcum * 100) : 0;
    const utilidadReal = inExt - coExt - gExt;
    const margenReal   = inExt > 0 ? (utilidadReal / inExt * 100) : 0;

    return {
      inAcum, coAcum, gAcum, utilidadAcum, margenAcum,
      inExt, coExt, gExt, utilidadReal, margenReal,
      inInt, coInt,
      eliminados: inInt + coInt,
      activeCount: (companies || []).filter(c => c.status === 'activa').length,
      totalMovs: ms.length,
    };
  }, [movs, companies, moneda]);

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Consolidado del Grupo</div>
          <div className="pg-sub">{data.activeCount} empresas activas · {data.totalMovs} movimientos en {moneda}</div>
        </div>
        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
          <select className="fi" value={moneda} onChange={e=>setMoneda(e.target.value)} style={{ minWidth:100 }}>
            <option value="PEN">S/ (PEN)</option>
            <option value="USD">USD</option>
          </select>
          <button className="btn btn-ghost btn-sm" title="Descargar PDF" onClick={()=>{
            try {
              window.__pdfs?.generateConsolidadoPdf?.(data, companies, `${moneda} · ${vista}`);
              showToast?.('PDF generado', 'green');
            } catch (e) { showToast?.('Error: '+e.message, 'red'); }
          }}>
            <JxIcon name="download" size={13}/>PDF
          </button>
        </div>
      </div>

      {/* Toggle de vista */}
      <div style={{ display:'flex', gap:6, padding:4, background:'var(--bg-s)', borderRadius:8, marginBottom:18, width:'fit-content' }}>
        <button
          className={`btn btn-sm ${vista==='real'?'btn-amber':'btn-ghost'}`}
          onClick={()=>setVista('real')}
          style={{ border:'none' }}>
          Vista consolidada real (sin intercompany)
        </button>
        <button
          className={`btn btn-sm ${vista==='acumulado'?'btn-amber':'btn-ghost'}`}
          onClick={()=>setVista('acumulado')}
          style={{ border:'none' }}>
          Vista acumulada (suma todo)
        </button>
      </div>

      <div style={{ background: vista==='real' ? 'rgba(46,204,113,0.06)' : 'rgba(255,179,0,0.06)',
        border: `1px solid ${vista==='real' ? 'rgba(46,204,113,0.25)' : 'rgba(255,179,0,0.25)'}`,
        borderRadius:8, padding:'10px 14px', marginBottom:14, fontSize:12.5, color:'var(--ts)' }}>
        {vista === 'real' ? (
          <>
            <strong style={{ color:'var(--green)' }}>Vista consolidada real:</strong> Resta operaciones internas entre empresas del grupo.
            Refleja cuánto ganó <strong>realmente</strong> el grupo frente a clientes y proveedores externos. Es el número que reportarías a accionistas o al holding.
          </>
        ) : (
          <>
            <strong style={{ color:'var(--amber)' }}>Vista acumulada:</strong> Suma todos los movimientos sin descontar operaciones internas.
            Útil para ver el volumen total de transacciones, pero <strong>infla</strong> los números porque cuenta dos veces lo que se vende entre empresas del grupo.
          </>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:12, marginBottom:18 }}>
        {vista === 'real' ? (
          <>
            <div className="card card-p" style={{ borderLeft:'3px solid var(--green)' }}>
              <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Ingreso externo real</div>
              <div style={{ fontSize:22, fontWeight:800, color:'var(--green)', marginTop:4 }}>{fmtCur(data.inExt, moneda)}</div>
            </div>
            <div className="card card-p" style={{ borderLeft:'3px solid var(--red)' }}>
              <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Costo externo real</div>
              <div style={{ fontSize:22, fontWeight:800, color:'var(--red)', marginTop:4 }}>{fmtCur(data.coExt, moneda)}</div>
            </div>
            <div className="card card-p" style={{ borderLeft:'3px solid var(--amber)' }}>
              <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Gastos externos</div>
              <div style={{ fontSize:22, fontWeight:800, color:'var(--amber)', marginTop:4 }}>{fmtCur(data.gExt, moneda)}</div>
            </div>
            <div className="card card-p" style={{ borderLeft:`3px solid ${data.utilidadReal>=0?'var(--blue)':'var(--red)'}` }}>
              <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Utilidad real del grupo</div>
              <div style={{ fontSize:22, fontWeight:800, color: data.utilidadReal>=0?'var(--blue)':'var(--red)', marginTop:4 }}>{fmtCur(data.utilidadReal, moneda)}</div>
            </div>
            <div className="card card-p" style={{ borderLeft:'3px solid var(--ts)' }}>
              <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Margen real</div>
              <div style={{ fontSize:22, fontWeight:800, color: data.margenReal>=0?'var(--green)':'var(--red)', marginTop:4 }}>{data.margenReal.toFixed(1)}%</div>
            </div>
          </>
        ) : (
          <>
            <div className="card card-p" style={{ borderLeft:'3px solid var(--green)' }}>
              <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Ingresos totales</div>
              <div style={{ fontSize:22, fontWeight:800, color:'var(--green)', marginTop:4 }}>{fmtCur(data.inAcum, moneda)}</div>
            </div>
            <div className="card card-p" style={{ borderLeft:'3px solid var(--red)' }}>
              <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Costos totales</div>
              <div style={{ fontSize:22, fontWeight:800, color:'var(--red)', marginTop:4 }}>{fmtCur(data.coAcum, moneda)}</div>
            </div>
            <div className="card card-p" style={{ borderLeft:'3px solid var(--amber)' }}>
              <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Gastos totales</div>
              <div style={{ fontSize:22, fontWeight:800, color:'var(--amber)', marginTop:4 }}>{fmtCur(data.gAcum, moneda)}</div>
            </div>
            <div className="card card-p" style={{ borderLeft:`3px solid ${data.utilidadAcum>=0?'var(--blue)':'var(--red)'}` }}>
              <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Utilidad acumulada</div>
              <div style={{ fontSize:22, fontWeight:800, color: data.utilidadAcum>=0?'var(--blue)':'var(--red)', marginTop:4 }}>{fmtCur(data.utilidadAcum, moneda)}</div>
            </div>
            <div className="card card-p" style={{ borderLeft:'3px solid var(--ts)' }}>
              <div style={{ fontSize:11, color:'var(--tm)', textTransform:'uppercase' }}>Margen acumulado</div>
              <div style={{ fontSize:22, fontWeight:800, color: data.margenAcum>=0?'var(--green)':'var(--red)', marginTop:4 }}>{data.margenAcum.toFixed(1)}%</div>
            </div>
          </>
        )}
      </div>

      {/* Detalle de operaciones internas */}
      {data.eliminados > 0 && (
        <div className="card card-p" style={{ borderLeft:'3px solid var(--blue)' }}>
          <div style={{ fontSize:13, fontWeight:700, color:'var(--blue)', marginBottom:8 }}>
            Operaciones internas (excluidas de la vista real)
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px,1fr))', gap:10 }}>
            <div>
              <div style={{ fontSize:10.5, color:'var(--tm)', textTransform:'uppercase' }}>Ingresos internos</div>
              <div style={{ fontSize:16, fontWeight:700, color:'var(--green)' }}>{fmtCur(data.inInt, moneda)}</div>
            </div>
            <div>
              <div style={{ fontSize:10.5, color:'var(--tm)', textTransform:'uppercase' }}>Costos internos</div>
              <div style={{ fontSize:16, fontWeight:700, color:'var(--red)' }}>{fmtCur(data.coInt, moneda)}</div>
            </div>
            <div>
              <div style={{ fontSize:10.5, color:'var(--tm)', textTransform:'uppercase' }}>Total eliminado del grupo</div>
              <div style={{ fontSize:16, fontWeight:700, color:'var(--blue)' }}>{fmtCur(data.eliminados, moneda)}</div>
            </div>
          </div>
          <div style={{ fontSize:11, color:'var(--tm)', marginTop:8 }}>
            Estos importes existen en ambas empresas (vendedor y comprador del grupo) — sumarlos contaría dos veces el mismo dinero.
            Por eso la <strong>vista real</strong> los excluye.
          </div>
        </div>
      )}
    </div>
  );
}

// ╔════════════════════════════════════════════════════════════╗
// ║  TRAZABILIDAD — CADENAS DE MARKUPS INTERCOMPANY            ║
// ╚════════════════════════════════════════════════════════════╝
// Cada cadena modela el flujo de un ítem desde el proveedor externo
// (precio real) pasando por las empresas del grupo (con markup interno
// en cada eslabón) hasta la empresa ejecutora del contrato. Se compara
// con el precio referencial del contrato del cliente para calcular la
// ganancia efectiva del grupo y la ganancia aparente de la ejecutora.
function TrazabilidadPage({ showToast }) {
  const auth = window.__useAuth?.();
  const isAdmin = auth?.profile?.rol === 'admin';
  const userId = auth?.profile?.id ?? 'offline';
  const { data: companies } = window.__hooks.useCompanies();
  const { data: cadenas } = window.__hooks.useTrazabilidadCadenas();
  const { data: obras } = window.__hooks.useObras();

  const [modal, setModal] = uSC(false);
  const [editingId, setEditingId] = uSC(null);
  const [form, setForm] = uSC(null);
  const [verCadena, setVerCadena] = uSC(null);
  // Toggle visualización del resumen: precios con o sin IGV
  const [conIgv, setConIgv] = uSC(false);
  const IGV_RATE = 0.18;

  const companiesActivas = uMC(() => (companies || []).filter(c => c.status === 'activa' && !c.deleted_at), [companies]);
  const lookupCompany = (id) => companies?.find(c => c.id === id);
  const lookupObra = (id) => obras?.find(o => o.id === id);

  // Obra activa del header — su ejecutora se usa para bloquear el dropdown.
  // Si es consorcio, devolvemos el primer miembro (caso raro; user puede
  // ajustar manualmente si necesita otro miembro como ejecutora).
  const obraActivaId = uMC(() => {
    try { return window.__getObraActivaId?.() || null; } catch { return null; }
  }, [obras]);
  const obraActiva = uMC(() => (obras || []).find(o => o.id === obraActivaId) || null, [obras, obraActivaId]);
  const ejecutoraDeObra = uMC(() => {
    if (!obraActiva) return null;
    if (obraActiva.ejecutora_company_id) {
      return companies?.find(c => c.id === obraActiva.ejecutora_company_id) || null;
    }
    if (obraActiva.ejecutora_tipo === 'consorcio' && Array.isArray(obraActiva.consorcio_miembros)) {
      const m = obraActiva.consorcio_miembros[0];
      return m?.company_id ? companies?.find(c => c.id === m.company_id) || null : null;
    }
    return null;
  }, [obraActiva, companies]);

  const sorted = uMC(() => [...(cadenas || [])].sort((a,b) => (b.fecha || '').localeCompare(a.fecha || '')), [cadenas]);

  // ── Cálculos por cadena ──────────────────────────────────────
  const calcular = (c) => {
    // Soporta cadenas multi-items (c.items) y legacy single-item.
    const items = Array.isArray(c.items) && c.items.length > 0
      ? c.items
      : [{ cantidad: c.cantidad || 0, precio_real_unitario: c.precio_real_unitario || 0, precio_referencial_contrato: c.precio_referencial_contrato || 0 }];
    const eslabones = Array.isArray(c.eslabones) ? c.eslabones : [];
    const ultimo = eslabones[eslabones.length - 1];
    const cant = items.reduce((s, it) => s + Number(it.cantidad || 0), 0);
    const costoTotalReal = items.reduce((s, it) => s + Number(it.cantidad || 0) * Number(it.precio_real_unitario || 0), 0);
    const presupTotal = items.reduce((s, it) => s + Number(it.cantidad || 0) * Number(it.precio_referencial_contrato || 0), 0);
    // Markup factor del último eslabón sobre el precio real
    const precioFinal = Number(ultimo?.precio_unit || 0);
    const precioReal = cant > 0 ? costoTotalReal / cant : 0;
    const presup = cant > 0 ? presupTotal / cant : 0;
    const factorFinal = precioReal > 0 ? precioFinal / precioReal : 1;
    const costoCargadoObra = costoTotalReal * factorFinal;
    const gananciaGrupoReal = costoCargadoObra - costoTotalReal;
    const gananciaEjecutoraAparente = presupTotal - costoCargadoObra;
    const gananciaTotalEfectiva = presupTotal - costoTotalReal;
    return {
      cant, precioReal, precioFinal, presup,
      costoTotalReal, costoCargadoObra, presupTotal,
      gananciaGrupoReal, gananciaEjecutoraAparente, gananciaTotalEfectiva,
      items,
    };
  };

  // ── Sugerencia de precios distribuidos (local, fallback) ────
  // Dado precio_real y precio_referencial_contrato, distribuye el markup
  // entre los eslabones intermedios proporcional a sus margen_objetivo_pct
  // (o uniformemente si no están definidos). Deja al final un precio_carga
  // ligeramente menor que el referencial para mantener un margen positivo
  // pero pequeño en la ejecutora.
  // Suma totales de items para usar como "precio_real" y "precio_objetivo" agregados.
  const totalesItems = (formActual = form) => {
    const items = (formActual?.items || []).filter(it => Number(it.cantidad) > 0);
    const cant = items.reduce((s, it) => s + Number(it.cantidad), 0);
    const totalReal = items.reduce((s, it) => s + Number(it.cantidad) * Number(it.precio_real_unitario || 0), 0);
    const totalRef  = items.reduce((s, it) => s + Number(it.cantidad) * Number(it.precio_referencial_contrato || 0), 0);
    return {
      cant,
      precio_real_prom: cant > 0 ? totalReal / cant : 0,
      precio_ref_prom:  cant > 0 ? totalRef  / cant : 0,
      total_real: totalReal,
      total_ref: totalRef,
    };
  };

  const sugerirPrecios = () => {
    if (!form) return;
    const tots = totalesItems();
    const real = tots.precio_real_prom;
    const ref  = tots.precio_ref_prom;
    if (!(real > 0 && ref > real)) {
      showToast('Completá items con precio real y precio referencial (ref > real)', 'red');
      return;
    }
    const eslabones = form.eslabones || [];
    if (eslabones.length === 0) { showToast('Agregá al menos 1 eslabón', 'red'); return; }
    const margenObjetivoEjecutora = 0.05;
    const precioCargaObra = ref * (1 - margenObjetivoEjecutora);
    const margenes = eslabones.map((es) => {
      const c = lookupCompany(es.company_id);
      const m = Number(c?.margen_objetivo_pct ?? 20);
      return Math.max(1, m);
    });
    const sumaMargenes = margenes.reduce((s, m) => s + m, 0);
    const totalMarkup = precioCargaObra - real;
    let acumulado = real;
    const nuevos = eslabones.map((es, i) => {
      const share = margenes[i] / sumaMargenes;
      acumulado = acumulado + totalMarkup * share;
      return { ...es, precio_unit: Math.round(acumulado * 100) / 100 };
    });
    setForm({ ...form, eslabones: nuevos });
    showToast(`Precios sugeridos (local). Precio final unit. promedio ${precioCargaObra.toFixed(2)}.`, 'green');
  };

  // ── Análisis IA de coherencia (rubro empresa vs material) ───
  // Reemplaza al viejo "Sugerir precios con IA" — ese se duplicaba con la
  // sugerencia local. Ahora la IA hace algo que la heurística NO puede:
  // analizar si los rubros de las empresas tienen sentido con los items
  // que están comprando, y advertir sobre riesgos SUNAT.
  const [iaSugiriendo, setIaSugiriendo] = uSC(false);
  const [iaAnalisis, setIaAnalisis] = uSC(null);
  const analizarCoherenciaIA = async () => {
    if (!form) return;
    const tots = totalesItems();
    if (tots.precio_real_prom <= 0) { showToast('Completá items con precio real', 'red'); return; }
    const eslabones = form.eslabones || [];
    if (eslabones.length < 2) { showToast('Necesitás al menos 2 eslabones', 'red'); return; }
    if (eslabones.some(e => !e.company_id)) { showToast('Asigná empresa a cada eslabón antes', 'red'); return; }
    setIaSugiriendo(true);
    try {
      const mod = await import('../lib/analizar-coherencia-ai.js');
      const ejecutoraId = form.ejecutora_company_id || eslabones[eslabones.length - 1].company_id;
      const payload = {
        items: (form.items || []).filter(it => Number(it.cantidad) > 0).map(it => ({
          descripcion: it.descripcion,
          unidad: it.unidad,
          cantidad: Number(it.cantidad),
          precio_unit: Number(it.precio_real_unitario) || 0,
        })),
        eslabones: eslabones.map((e, i) => {
          const c = lookupCompany(e.company_id);
          const isUlt = i === eslabones.length - 1;
          const isPrim = i === 0;
          return {
            company_id: e.company_id,
            name: c?.name || '?',
            rol_grupo: c?.rol_grupo,
            // Pasamos el rubro real desde companies — Claude lo cruza con el material.
            rubro: c?.rubro || c?.actividad_economica || c?.rol_grupo,
            posicion: isPrim ? 'primaria' : (isUlt || e.company_id === ejecutoraId) ? 'ejecutora' : 'secundaria',
          };
        }),
        proveedor_externo: {
          nombre: form.proveedor_externo_nombre,
          ruc: form.proveedor_externo_ruc,
        },
        precio_compra: tots.precio_real_prom,
        precio_objetivo: tots.precio_ref_prom,
      };
      const resp = await mod.analizarCoherenciaCadena(payload);
      setIaAnalisis(resp);
      const tone = resp.resultado === 'incoherente' ? 'red' : resp.resultado === 'advertencia' ? 'amber' : 'green';
      const emoji = resp.resultado === 'incoherente' ? '🚨' : resp.resultado === 'advertencia' ? '⚠️' : '✅';
      showToast(`${emoji} Análisis IA: ${resp.resultado.toUpperCase()} (${resp.hallazgos?.length || 0} hallazgos)`, tone);
    } catch (e) {
      showToast('IA falló: ' + (e.message || e), 'red');
    } finally {
      setIaSugiriendo(false);
    }
  };

  // ── Ajuste rápido: "# secundarias intermedias" ──────────────
  const ajustarCantidadSecundarias = (n) => {
    if (!form) return;
    const eslabones = [...(form.eslabones || [])];
    if (eslabones.length === 0) {
      eslabones.push({ company_id:'', precio_unit:'', factura:'', fecha_op: form.fecha, _rol:'primaria' });
    }
    // mantenemos primero (primaria) y último (ejecutora si existe)
    const primaria = eslabones[0];
    const ejecutoraIdx = eslabones.length > 1 ? eslabones.length - 1 : null;
    const ejecutora = ejecutoraIdx != null ? eslabones[ejecutoraIdx] : { company_id: form.ejecutora_company_id || '', precio_unit:'', factura:'', fecha_op: form.fecha };
    const intermedias = [];
    for (let i = 0; i < n; i++) {
      const existente = eslabones[1 + i];
      intermedias.push(existente && existente !== ejecutora ? existente : { company_id:'', precio_unit:'', factura:'', fecha_op: form.fecha });
    }
    const nuevos = [primaria, ...intermedias, ejecutora];
    setForm({ ...form, eslabones: nuevos });
  };

  // Comprobantes (facturas de proveedor externo) disponibles para asociar a una cadena.
  // Solo facturas tipo='cost' que NO sean intercompany y NO estén ya vinculadas a otra cadena.
  const [comprobantesDisponibles, setComprobantesDisponibles] = uSC([]);
  uEC(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const movs = await window.__db.accounting_movements
          .filter(m => !m.deleted_at && m.type === 'cost' && !m.is_intercompany &&
                  (m.document_type === 'factura' || m.document_type === 'boleta') &&
                  !m.chain_id)
          .toArray();
        if (!cancelled) setComprobantesDisponibles(movs.sort((a,b) => (b.date || '').localeCompare(a.date || '')));
      } catch { if (!cancelled) setComprobantesDisponibles([]); }
    };
    load();
    const onChange = (e) => { const t = e?.detail?.tabla; if (!t || t === 'accounting_movements') load(); };
    window.addEventListener('jx_data_changed', onChange);
    return () => { cancelled = true; window.removeEventListener('jx_data_changed', onChange); };
  }, []);

  // Construye items vacíos por defecto.
  const itemVacio = () => ({
    descripcion: '',
    unidad: 'und',
    cantidad: '',
    precio_real_unitario: '',
    precio_referencial_contrato: '',
  });

  const openNueva = () => {
    if (companiesActivas.length === 0) {
      showToast('Necesitás registrar al menos 1 empresa activa', 'red');
      return;
    }
    const obraId = obraActivaId || (obras || []).find(o => !o.deleted_at)?.id || '';
    if (!obraId) {
      showToast('Seleccioná una obra activa primero (en el selector de arriba)', 'red');
      return;
    }
    if (!ejecutoraDeObra) {
      showToast('La obra activa no tiene empresa ejecutora asignada — editala primero', 'red');
      return;
    }
    // Empresas mixtas (NO ejecutora) son las que pueden ser primaria/secundaria.
    const mixtas = companiesActivas.filter(c => c.id !== ejecutoraDeObra.id);
    if (mixtas.length === 0) {
      showToast('No hay empresas mixtas disponibles. Registrá al menos una empresa que no sea la ejecutora.', 'red');
      return;
    }
    const today = window.__fecha?.hoyLocal?.() || new Date().toISOString().slice(0,10);
    setForm({
      obra_id: obraId,
      fecha: today,
      comprobante_origen_id: '',
      proveedor_externo_nombre: '',
      proveedor_externo_ruc: '',
      items: [itemVacio()],
      eslabones: [
        // Eslabón 0 = primaria (la que compró al proveedor). Precio = factura.
        // Su precio_unit se prellena al elegir comprobante origen.
        { company_id: mixtas[0]?.id || '', precio_unit: '', factura: '', fecha_op: today },
        // Eslabón 1 = ejecutora (lock con la de la obra). Precio = lo que paga
        // al recibir → se setea con la sugerencia local/IA.
        { company_id: ejecutoraDeObra.id, precio_unit: '', factura: '', fecha_op: today },
      ],
      ejecutora_company_id: ejecutoraDeObra.id,
      estado: 'borrador',
      notas: '',
    });
    setEditingId(null);
    setModal(true);
  };

  const openEditar = (c) => {
    // Migrar shape viejo (item_nombre + cantidad sueltos) a items[]
    const items = Array.isArray(c.items) && c.items.length > 0
      ? c.items.map(it => ({
          descripcion: it.descripcion || '',
          unidad: it.unidad || 'und',
          cantidad: it.cantidad ?? '',
          precio_real_unitario: it.precio_real_unitario ?? '',
          precio_referencial_contrato: it.precio_referencial_contrato ?? '',
          material_id: it.material_id || null,
        }))
      : [{
          descripcion: c.item_nombre || '',
          unidad: c.unidad || 'und',
          cantidad: c.cantidad ?? '',
          precio_real_unitario: c.precio_real_unitario ?? '',
          precio_referencial_contrato: c.precio_referencial_contrato ?? '',
        }];
    setForm({
      obra_id: c.obra_id || '',
      fecha: c.fecha || window.__fecha?.hoyLocal?.() || new Date().toISOString().slice(0,10),
      comprobante_origen_id: c.comprobante_origen_id || '',
      proveedor_externo_nombre: c.proveedor_externo_nombre || '',
      proveedor_externo_ruc: c.proveedor_externo_ruc || '',
      items,
      eslabones: c.eslabones?.length ? c.eslabones : [{ company_id:'', precio_unit:'', factura:'', fecha_op: c.fecha }],
      ejecutora_company_id: c.ejecutora_company_id || '',
      estado: c.estado || 'borrador',
      notas: c.notas || '',
    });
    setEditingId(c.id);
    setModal(true);
  };

  // Cuando el user elige un comprobante origen, autocompletar proveedor + items.
  const elegirComprobante = (compId) => {
    if (!compId) {
      setForm(f => ({ ...f, comprobante_origen_id: '' }));
      return;
    }
    const comp = comprobantesDisponibles.find(m => m.id === compId);
    if (!comp) return;
    // Items: intentar leerlos desde notas (si captura mágica los persistió ahí)
    let items = [];
    try {
      const notas = typeof comp.notas === 'string' ? JSON.parse(comp.notas) : comp.notas;
      if (Array.isArray(notas?.items_factura)) {
        items = notas.items_factura.map(it => ({
          descripcion: it.descripcion || it.nombre || '',
          unidad: it.unidad || 'und',
          cantidad: Number(it.cantidad) || 0,
          precio_real_unitario: Number(it.precio_unitario || it.precio_real_unitario) || 0,
          precio_referencial_contrato: '',
        }));
      }
    } catch {}
    if (items.length === 0) {
      // Fallback: 1 item con la info disponible del movimiento
      items = [{
        descripcion: comp.description || 'Material/servicio del comprobante',
        unidad: 'und',
        cantidad: 1,
        precio_real_unitario: Number(comp.amount) || 0,
        precio_referencial_contrato: '',
      }];
    }
    // La empresa primaria (eslabón 0) ya pagó la factura — su precio_unit
    // = precio promedio ponderado de la factura. NO se le aplica markup.
    const cantTotal = items.reduce((s, it) => s + Number(it.cantidad || 0), 0);
    const totalReal = items.reduce((s, it) => s + Number(it.cantidad || 0) * Number(it.precio_real_unitario || 0), 0);
    const precioPromPrimaria = cantTotal > 0 ? +(totalReal / cantTotal).toFixed(4) : 0;

    setForm(f => {
      const eslabones = [...(f.eslabones || [])];
      if (eslabones[0]) {
        eslabones[0] = {
          ...eslabones[0],
          precio_unit: precioPromPrimaria,
          factura: comp.document_number || eslabones[0].factura,
          fecha_op: comp.date || eslabones[0].fecha_op,
        };
      }
      return {
        ...f,
        comprobante_origen_id: compId,
        proveedor_externo_nombre: comp.third_party_name || f.proveedor_externo_nombre,
        proveedor_externo_ruc: comp.third_party_ruc || f.proveedor_externo_ruc,
        fecha: comp.date || f.fecha,
        items: items.length ? items : f.items,
        eslabones,
      };
    });
    showToast(`Importados ${items.length} item(s) del comprobante ${comp.document_number || ''}. Empresa primaria pre-llenada.`, 'green');
  };

  const updateItem = (idx, patch) => {
    setForm(f => ({ ...f, items: f.items.map((it, i) => i === idx ? { ...it, ...patch } : it) }));
  };
  const addItem = () => setForm(f => ({ ...f, items: [...(f.items || []), itemVacio()] }));
  const removeItem = (idx) => setForm(f => ({
    ...f,
    items: (f.items || []).filter((_, i) => i !== idx).length === 0 ? [itemVacio()] : f.items.filter((_, i) => i !== idx),
  }));

  const guardar = async () => {
    if (!form.obra_id) { showToast('No hay obra activa', 'red'); return; }
    // Validar items: al menos 1 item con descripción y precio_real
    const itemsValidos = (form.items || []).filter(it =>
      String(it.descripcion || '').trim() && Number(it.cantidad) > 0 && Number(it.precio_real_unitario) > 0
    );
    if (itemsValidos.length === 0) {
      showToast('Agregá al menos 1 item con descripción, cantidad y precio real', 'red');
      return;
    }
    const eslabones = (form.eslabones || []).filter(e => e.company_id && Number(e.precio_unit) > 0);
    if (eslabones.length === 0) { showToast('Agregá al menos 1 eslabón con empresa y precio', 'red'); return; }

    const ejecutora = form.ejecutora_company_id || eslabones[eslabones.length - 1].company_id;
    const now = new Date().toISOString();
    // Resumen para retrocompatibilidad: agregamos los items al precio "agregado"
    // (cantidad total, precio promedio ponderado).
    const cantTotal = itemsValidos.reduce((s, it) => s + Number(it.cantidad || 0), 0);
    const totalReal = itemsValidos.reduce((s, it) => s + Number(it.cantidad || 0) * Number(it.precio_real_unitario || 0), 0);
    const totalRef  = itemsValidos.reduce((s, it) => s + Number(it.cantidad || 0) * Number(it.precio_referencial_contrato || 0), 0);
    const precioRealProm = cantTotal > 0 ? totalReal / cantTotal : 0;
    const precioRefProm  = cantTotal > 0 ? totalRef  / cantTotal : 0;
    const itemNombreResumen = itemsValidos.length === 1
      ? itemsValidos[0].descripcion
      : `${itemsValidos[0].descripcion} (+${itemsValidos.length - 1} más)`;
    const unidadResumen = itemsValidos.length === 1 ? itemsValidos[0].unidad : 'und';

    const itemsNorm = itemsValidos.map(it => ({
      descripcion: String(it.descripcion).trim(),
      unidad: it.unidad || 'und',
      cantidad: Number(it.cantidad) || 0,
      precio_real_unitario: Number(it.precio_real_unitario) || 0,
      precio_referencial_contrato: Number(it.precio_referencial_contrato) || 0,
      material_id: it.material_id || null,
    }));

    try {
      if (editingId) {
        const orig = await window.__db.trazabilidad_cadenas.get(editingId);
        await window.__db.trazabilidad_cadenas.update(editingId, {
          obra_id: form.obra_id,
          fecha: form.fecha,
          comprobante_origen_id: form.comprobante_origen_id || null,
          item_nombre: itemNombreResumen,
          cantidad: cantTotal,
          unidad: unidadResumen,
          proveedor_externo_nombre: form.proveedor_externo_nombre?.trim() || null,
          proveedor_externo_ruc: form.proveedor_externo_ruc?.trim() || null,
          precio_real_unitario: precioRealProm,
          precio_referencial_contrato: precioRefProm,
          items: itemsNorm,
          eslabones: eslabones.map(e => ({
            company_id: e.company_id,
            precio_unit: Number(e.precio_unit) || 0,
            factura: e.factura?.trim() || null,
            fecha_op: e.fecha_op || form.fecha,
          })),
          ejecutora_company_id: ejecutora,
          estado: form.estado,
          notas: form.notas?.trim() || null,
          updated_at: now, updated_by: userId,
          version: (orig?.version ?? 0) + 1,
          sync_status: orig?.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
        try { await window.__logAudit?.({ action:'update', table:'trazabilidad_cadenas', recordId:editingId, oldData:orig, newData:form, reason:'Edición cadena' }); } catch {}
        showToast('Cadena actualizada', 'green');
      } else {
        const id = window.__newId();
        const isPrueba = getCurrentMode() === 'prueba';
        const rec = {
          id,
          obra_id: form.obra_id,
          comprobante_origen_id: form.comprobante_origen_id || null,
          item_nombre: itemNombreResumen,
          cantidad: cantTotal,
          unidad: unidadResumen,
          precio_real_unitario: precioRealProm,
          precio_referencial_contrato: precioRefProm,
          items: itemsNorm,
          fecha: form.fecha,
          proveedor_externo_nombre: form.proveedor_externo_nombre?.trim() || null,
          proveedor_externo_ruc: form.proveedor_externo_ruc?.trim() || null,
          eslabones: eslabones.map(e => ({
            company_id: e.company_id,
            precio_unit: Number(e.precio_unit) || 0,
            factura: e.factura?.trim() || null,
            fecha_op: e.fecha_op || form.fecha,
          })),
          ejecutora_company_id: ejecutora,
          estado: form.estado,
          notas: form.notas?.trim() || null,
          created_at: now, updated_at: now,
          created_by: userId, updated_by: userId,
          version: 1,
          // En modo prueba: marcar como demo + no enviar a sync
          sync_status: isPrueba ? 'synced' : 'pending_create',
          last_synced_at: null,
          idempotency_key: `${userId}_chain_${id}`,
          ...(isPrueba ? { demo: true } : {}),
        };
        await window.__db.trazabilidad_cadenas.add(rec);
        try { await window.__logAudit?.({ action:'insert', table:'trazabilidad_cadenas', recordId:id, newData:rec, reason:`Nueva cadena: ${rec.item_nombre}` }); } catch {}
        showToast('Cadena creada', 'green');
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'trazabilidad_cadenas' } })); } catch {}
      setModal(false); setEditingId(null); setForm(null);
    } catch (e) {
      showToast('Error: ' + (e.message || e), 'red');
    }
  };

  const eliminar = async (c) => {
    if (!isAdmin) return;
    if (!confirm(`¿Eliminar la cadena "${c.item_nombre}"?`)) return;
    try {
      await window.__db.trazabilidad_cadenas.update(c.id, {
        deleted_at: new Date().toISOString(),
        sync_status: c.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
      });
      try { await window.__logAudit?.({ action:'delete', table:'trazabilidad_cadenas', recordId:c.id, oldData:c, reason:'Eliminación cadena' }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'trazabilidad_cadenas' } })); } catch {}
      showToast('Cadena eliminada', 'amber');
    } catch (e) { showToast('Error: ' + (e.message||e), 'red'); }
  };

  // Genera N-1 facturas internas borrador (una por cada paso de la cadena).
  // Si ya existían, abre el detalle visual para verlas.
  const generarFacturasDeCadena = async (c) => {
    try {
      const mod = await import('../lib/facturas-internas.js');
      const r = await mod.generarFacturasInternas(c, companies || [], userId);
      if (r.ya_existian) {
        showToast('Esta cadena ya tiene facturas generadas — abriendo detalle', 'amber');
      } else {
        showToast(`✓ ${r.creados} facturas internas borrador creadas`, 'green');
      }
      // Refrescar el record de la cadena (estado pasó a 'facturada')
      const updated = await window.__db.trazabilidad_cadenas.get(c.id);
      setVerCadena(updated || c);
    } catch (e) {
      showToast('Error generando facturas: ' + (e.message || e), 'red');
    }
  };

  // ── Resumen global ──────────────────────────────────────────
  const resumen = uMC(() => {
    let real = 0, cargada = 0, ref = 0;
    sorted.forEach(c => {
      const r = calcular(c);
      real += r.costoTotalReal;
      cargada += r.costoCargadoObra;
      ref += r.presupTotal;
    });
    return {
      real, cargada, ref,
      gananciaGrupo: cargada - real,
      gananciaEjec: ref - cargada,
      gananciaTotal: ref - real,
    };
  }, [sorted]);

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Trazabilidad de Cadenas</div>
          <div className="pg-sub">{sorted.length} cadenas · proveedor externo → empresas del grupo → ejecutora · vs presupuesto</div>
        </div>
        <button className="btn btn-amber btn-sm" onClick={openNueva}>
          <JxIcon name="plus" size={13}/>Nueva Cadena
        </button>
      </div>

      <div className="card card-p" style={{ marginBottom:14, background:'rgba(155,89,182,0.06)', border:'1px solid rgba(155,89,182,0.25)', fontSize:12, color:'var(--ts)' }}>
        <strong style={{ color:'var(--purple,#9B59B6)' }}>ℹ Cómo funciona:</strong> Una cadena registra el camino de un material o servicio
        desde el <strong>proveedor externo</strong> (precio real) pasando por las empresas de tu grupo (con markup interno) hasta la
        <strong> empresa ejecutora</strong> que firma el contrato. Se compara contra el <strong>presupuesto referencial</strong> del cliente
        para ver la ganancia real del grupo y la ganancia aparente que queda en la ejecutora.
      </div>

      {sorted.length > 0 && (
        <div className="g4" style={{ marginBottom:16 }}>
          <div className="kpi-card">
            <div style={{ fontSize:11.5, color:'var(--tm)' }}>Costo Real Externo</div>
            <div className="kpi-val" style={{ color:'var(--blue)' }}>{fmtCurK(resumen.real)}</div>
            <div style={{ fontSize:11, color:'var(--tm)' }}>lo que el grupo pagó afuera</div>
          </div>
          <div className="kpi-card">
            <div style={{ fontSize:11.5, color:'var(--tm)' }}>Costo Cargado Obra</div>
            <div className="kpi-val" style={{ color:'var(--amber)' }}>{fmtCurK(resumen.cargada)}</div>
            <div style={{ fontSize:11, color:'var(--tm)' }}>lo que paga la ejecutora al grupo</div>
          </div>
          <div className="kpi-card">
            <div style={{ fontSize:11.5, color:'var(--tm)' }}>Ganancia Aparente Ejecutora</div>
            <div className="kpi-val" style={{ color: resumen.gananciaEjec>=0?'var(--green)':'var(--red)' }}>{fmtCurK(resumen.gananciaEjec)}</div>
            <div style={{ fontSize:11, color:'var(--tm)' }}>{resumen.ref>0 ? `${(resumen.gananciaEjec/resumen.ref*100).toFixed(1)}% del presupuesto` : '—'}</div>
          </div>
          <div className="kpi-card">
            <div style={{ fontSize:11.5, color:'var(--tm)' }}>Ganancia Total Grupo</div>
            <div className="kpi-val" style={{ color: resumen.gananciaTotal>=0?'var(--green)':'var(--red)' }}>{fmtCurK(resumen.gananciaTotal)}</div>
            <div style={{ fontSize:11, color:'var(--tm)' }}>presupuesto − costo real</div>
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="compare" size={40} color="var(--tm)"/>
          <p style={{ maxWidth:560 }}>
            No hay cadenas registradas todavía.<br/>
            Creá la primera para trazar el flujo de un material o servicio desde el proveedor externo hasta la empresa ejecutora,
            pasando por todas las empresas intermedias de tu grupo. Útil para presupuestos donde la ganancia debe quedar distribuida.
          </p>
        </div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <div style={{ overflowX:'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Fecha</th><th>Ítem · Obra</th><th>Cadena</th>
                <th style={{ textAlign:'right' }}>Precio real</th>
                <th style={{ textAlign:'right' }}>Precio cargado</th>
                <th style={{ textAlign:'right' }}>Presupuesto</th>
                <th style={{ textAlign:'right' }}>Ganancia grupo</th>
                <th>Estado</th>
                <th style={{ textAlign:'center' }}>Acciones</th>
              </tr></thead>
              <tbody>
                {sorted.map(c => {
                  const r = calcular(c);
                  const obra = lookupObra(c.obra_id);
                  return (
                    <tr key={c.id}>
                      <td className="col-m">{c.fecha}</td>
                      <td>
                        <strong>{c.item_nombre}</strong>
                        <div style={{ fontSize:10.5, color:'var(--tm)' }}>{c.cantidad} {c.unidad} · {obra?.nombre_obra?.slice(0,40) || '—'}</div>
                      </td>
                      <td style={{ fontSize:11 }}>
                        {(c.eslabones || []).map((e, i, arr) => {
                          const co = lookupCompany(e.company_id);
                          return (
                            <span key={i}>
                              <span style={{ color: i === arr.length-1 ? 'var(--green)' : 'var(--ts)' }}>{co?.name?.slice(0,16) || '?'}</span>
                              {i < arr.length-1 && <span style={{ color:'var(--tm)', margin:'0 4px' }}>→</span>}
                            </span>
                          );
                        })}
                      </td>
                      <td style={{ textAlign:'right', color:'var(--blue)' }} className="col-num">{fmtCur(r.precioReal)} <div style={{ fontSize:10, color:'var(--tm)' }}>{fmtCurK(r.costoTotalReal)}</div></td>
                      <td style={{ textAlign:'right', color:'var(--amber)' }} className="col-num">{fmtCur(r.precioFinal)} <div style={{ fontSize:10, color:'var(--tm)' }}>{fmtCurK(r.costoCargadoObra)}</div></td>
                      <td style={{ textAlign:'right' }} className="col-num">{fmtCur(r.presup)} <div style={{ fontSize:10, color:'var(--tm)' }}>{fmtCurK(r.presupTotal)}</div></td>
                      <td style={{ textAlign:'right', fontWeight:700, color: r.gananciaGrupoReal>=0?'var(--green)':'var(--red)' }} className="col-num">{fmtCurK(r.gananciaGrupoReal)}</td>
                      <td><span className={`badge ${c.estado==='confirmada'?'b-green':c.estado==='facturada'?'b-blue':'b-gray'}`}>{c.estado || 'borrador'}</span></td>
                      <td style={{ textAlign:'center', whiteSpace:'nowrap' }}>
                        <button className="btn btn-ghost btn-xs" title="Ver detalle visual" onClick={()=>setVerCadena(c)}>
                          <JxIcon name="eye" size={11}/>
                        </button>
                        <button className="btn btn-ghost btn-xs" title="Editar" onClick={()=>openEditar(c)} style={{ marginLeft:4 }}>
                          <JxIcon name="edit" size={11}/>
                        </button>
                        {(c.estado === 'confirmada' || c.estado === 'facturada') ? (
                          <button className="btn btn-amber btn-xs"
                            title={c.estado === 'facturada' ? 'Ver facturas generadas' : 'Generar facturas internas (borradores)'}
                            onClick={()=>generarFacturasDeCadena(c)}
                            style={{ marginLeft:4 }}>
                            📄 {c.estado === 'facturada' ? 'Ver facturas' : 'Generar facturas'}
                          </button>
                        ) : (
                          <span title="Marcá la cadena como CONFIRMADA para poder generar facturas internas"
                            style={{ marginLeft:4, fontSize:10, color:'var(--tm)', fontStyle:'italic' }}>
                            (confirmá para facturar)
                          </span>
                        )}
                        {isAdmin && (
                          <button className="btn btn-red btn-xs" title="Eliminar" onClick={()=>eliminar(c)} style={{ marginLeft:4 }}>
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

      {/* ── MODAL DETALLE VISUAL ─────────────────────────────── */}
      {verCadena && (
        <Modal title={`Cadena: ${verCadena.item_nombre}`} icon="compare" onClose={()=>setVerCadena(null)} wide>
          {(verCadena.estado === 'confirmada' || verCadena.estado === 'facturada') && (
            <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:10 }}>
              <button className="btn btn-amber btn-sm" onClick={()=>generarFacturasDeCadena(verCadena)}>
                <JxIcon name="package" size={12}/> {verCadena.estado === 'facturada' ? 'Regenerar facturas' : 'Generar facturas internas'}
              </button>
            </div>
          )}
          <CadenaVisual cadena={verCadena} lookupCompany={lookupCompany} lookupObra={lookupObra} calcular={calcular}/>
        </Modal>
      )}

      {/* ── MODAL CREAR/EDITAR ───────────────────────────────── */}
      {modal && form && (
        <Modal title={editingId ? 'Editar Cadena' : 'Nueva Cadena de Trazabilidad'} icon="compare" onClose={()=>{setModal(false); setEditingId(null); setForm(null);}} wide>
          <div style={{ marginBottom:10, fontSize:11.5, color:'var(--tm)' }}>
            Obra: <strong style={{ color:'var(--tp)' }}>{lookupObra(form.obra_id)?.nombre_obra || '—'}</strong>
            <span style={{ marginLeft:10 }}>(usa la obra activa del header).</span>
          </div>
          <div className="g2">
            <div style={{ gridColumn:'1/-1' }}>
              <label className="flabel">Comprobante origen (factura del proveedor externo)</label>
              <select className="fi" value={form.comprobante_origen_id || ''} onChange={e=>elegirComprobante(e.target.value)}>
                <option value="">— Ingresar manualmente —</option>
                {comprobantesDisponibles.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.document_number || '(sin N°)'} · {c.third_party_name || 'sin proveedor'} · S/ {Number(c.amount).toFixed(2)} · {c.date}
                  </option>
                ))}
              </select>
              <div style={{ fontSize:10, color:'var(--tm)', marginTop:3 }}>
                Si la factura del proveedor ya fue subida por <strong>Captura Mágica</strong>, elegila acá y se autocompletan los items.
                Sino, escribilos manualmente abajo.
              </div>
            </div>
            <div>
              <label className="flabel">Fecha</label>
              <input className="fi" type="date" value={form.fecha||''} onChange={e=>setForm({...form, fecha:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Proveedor externo (real)</label>
              <input className="fi" value={form.proveedor_externo_nombre||''} onChange={e=>setForm({...form, proveedor_externo_nombre:e.target.value})} placeholder="Aceros Arequipa"/>
            </div>
            <div>
              <label className="flabel">RUC proveedor</label>
              <input className="fi" maxLength={11} value={form.proveedor_externo_ruc||''} onChange={e=>setForm({...form, proveedor_externo_ruc:e.target.value.replace(/\D/g,'').slice(0,11)})}/>
            </div>

            {/* ── Items de la factura ── */}
            <div style={{ gridColumn:'1/-1', marginTop:6, fontSize:11, color:'var(--blue)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', borderTop:'1px dashed var(--border)', paddingTop:10, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span>Items del comprobante</span>
              <button type="button" className="btn btn-ghost btn-xs" onClick={addItem}>
                <JxIcon name="plus" size={11}/> Agregar item
              </button>
            </div>
            <div style={{ gridColumn:'1/-1', overflow:'auto', border:'1px solid var(--border)', borderRadius:8 }}>
              <table className="tbl" style={{ fontSize:11 }}>
                <thead><tr>
                  <th style={{ minWidth:200 }}>Descripción</th>
                  <th style={{ width:70 }}>Unidad</th>
                  <th style={{ width:90, textAlign:'right' }}>Cantidad</th>
                  <th style={{ width:110, textAlign:'right' }}>Precio real (S/)</th>
                  <th style={{ width:130, textAlign:'right' }}>Precio ref. contrato (S/)</th>
                  <th style={{ width:32 }}></th>
                </tr></thead>
                <tbody>
                  {(form.items || []).map((it, idx) => (
                    <tr key={idx}>
                      <td><input className="fi" placeholder="Ej: Fierro 1/2&quot; ASTM A615" value={it.descripcion || ''} onChange={e=>updateItem(idx, { descripcion: e.target.value })} style={{ fontSize:11 }}/></td>
                      <td>
                        <select className="fi" value={it.unidad || 'und'} onChange={e=>updateItem(idx, { unidad: e.target.value })} style={{ fontSize:11 }}>
                          <option value="kg">kg</option><option value="m">m</option>
                          <option value="m2">m²</option><option value="m3">m³</option>
                          <option value="und">und</option><option value="bls">bls</option>
                          <option value="gal">gal</option><option value="hr">hr</option>
                        </select>
                      </td>
                      <td><input className="fi" type="number" min="0" step="0.01" value={it.cantidad ?? ''} onChange={e=>updateItem(idx, { cantidad: e.target.value })} style={{ fontSize:11, textAlign:'right' }}/></td>
                      <td><input className="fi" type="number" min="0" step="0.01" value={it.precio_real_unitario ?? ''} onChange={e=>updateItem(idx, { precio_real_unitario: e.target.value })} style={{ fontSize:11, textAlign:'right' }}/></td>
                      <td><input className="fi" type="number" min="0" step="0.01" value={it.precio_referencial_contrato ?? ''} onChange={e=>updateItem(idx, { precio_referencial_contrato: e.target.value })} style={{ fontSize:11, textAlign:'right' }} placeholder="0.00"/></td>
                      <td>
                        <button type="button" className="btn btn-ghost btn-xs" disabled={(form.items || []).length === 1} onClick={()=>removeItem(idx)}>
                          <JxIcon name="x" size={10}/>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background:'rgba(0,0,0,0.10)', fontWeight:600 }}>
                    <td colSpan={2} style={{ padding:'6px 8px', textAlign:'right' }}>Totales (S/):</td>
                    <td style={{ textAlign:'right' }}>{totalesItems().cant.toFixed(2)}</td>
                    <td style={{ textAlign:'right', color:'var(--blue)' }}>{fmtCur(totalesItems().total_real)}</td>
                    <td style={{ textAlign:'right', color:'var(--purple, #9B59B6)' }}>{fmtCur(totalesItems().total_ref)}</td>
                    <td/>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div style={{ gridColumn:'1/-1', fontSize:10, color:'var(--tm)' }}>
              <strong>Precio real</strong> = lo que pagó la empresa primaria al proveedor.
              <strong> Precio referencial</strong> = lo del contrato con el cliente final (puede dejarse en blanco para items sin presupuesto).
            </div>

            {/* ── Configuración rápida de la cadena ── */}
            <div style={{ gridColumn:'1/-1', marginTop:6, fontSize:11, color:'var(--purple, #9B59B6)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', borderTop:'1px dashed var(--border)', paddingTop:10 }}>
              Configuración de la cadena
            </div>
            <div style={{ gridColumn:'1/-1', display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:10 }}>
              <div>
                <label className="flabel">Empresa Primaria *</label>
                <select className="fi" value={(form.eslabones || [])[0]?.company_id || ''} onChange={e => {
                  const arr = [...(form.eslabones || [])];
                  if (arr.length === 0) arr.push({ company_id:'', precio_unit:'', factura:'', fecha_op: form.fecha });
                  arr[0] = { ...arr[0], company_id: e.target.value };
                  setForm({ ...form, eslabones: arr });
                }}>
                  <option value="">— Compradora externa —</option>
                  {/* Excluye la ejecutora de la obra activa: solo mixtas pueden ser primaria */}
                  {companiesActivas
                    .filter(c => c.id !== form.ejecutora_company_id)
                    .map(c => (
                      <option key={c.id} value={c.id}>{c.name}{c.rol_grupo ? ` · ${c.rol_grupo}` : ''}</option>
                    ))}
                </select>
                <div style={{ fontSize:10, color:'var(--tm)', marginTop:3 }}>Compra al proveedor externo. La ejecutora no aparece acá.</div>
              </div>
              <div>
                <label className="flabel"># empresas intermedias</label>
                <input className="fi" type="number" min="0" max="6"
                  value={Math.max(0, (form.eslabones || []).length - 2)}
                  onChange={e => ajustarCantidadSecundarias(Math.max(0, Math.min(6, Number(e.target.value) || 0)))}
                />
                <div style={{ fontSize:10, color:'var(--tm)', marginTop:3 }}>0 = primaria vende directo a la ejecutora.</div>
              </div>
              <div>
                <label className="flabel">Empresa Ejecutora 🔒</label>
                <input className="fi" disabled
                  value={ejecutoraDeObra?.name || lookupCompany(form.ejecutora_company_id)?.name || '—'}
                  style={{ opacity: 0.85, cursor: 'not-allowed', background: 'rgba(46,204,113,0.07)' }}
                />
                <div style={{ fontSize:10, color:'var(--tm)', marginTop:3 }}>
                  Bloqueada con la ejecutora de la obra activa
                  {obraActiva ? ` (${obraActiva.nombre_obra?.slice(0, 30) || ''})` : ''}.
                </div>
              </div>
            </div>

            {/* ── Eslabones ── */}
            <div style={{ gridColumn:'1/-1', marginTop:6, fontSize:11, color:'var(--amber)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', borderTop:'1px dashed var(--border)', paddingTop:10, display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:6 }}>
              <span>Eslabones del grupo (orden = flujo)</span>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                <button type="button" className="btn btn-ghost btn-xs" onClick={sugerirPrecios}
                  title="Distribuir markup automáticamente según margen objetivo de cada empresa">
                  <JxIcon name="refresh" size={11}/> Sugerir precios
                </button>
                <button type="button" className="btn btn-amber btn-xs" onClick={analizarCoherenciaIA} disabled={iaSugiriendo}
                  title="Claude analiza si los rubros de las empresas tienen sentido con los items de la cadena (compliance SUNAT)">
                  {iaSugiriendo ? '⏳ Analizando…' : '🧠 Análisis IA de coherencia'}
                </button>
              </div>
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              {(form.eslabones || []).map((es, i) => {
                const arr = form.eslabones || [];
                const ant = i === 0 ? totalesItems().precio_real_prom : Number(arr[i-1]?.precio_unit || 0);
                const cur = Number(es.precio_unit || 0);
                const markupPct = ant > 0 ? ((cur - ant) / ant * 100) : 0;
                const co = lookupCompany(es.company_id);
                const isPrim = i === 0;
                const isUlt = i === arr.length - 1;
                const rol = isPrim ? 'PRIMARIA' : isUlt ? 'EJECUTORA' : 'SECUNDARIA';
                const rolColor = isPrim ? 'var(--blue)' : isUlt ? 'var(--green)' : 'var(--amber)';
                return (
                  <div key={i} style={{ display:'grid', gridTemplateColumns:'90px minmax(160px, 2fr) minmax(100px, 1fr) 60px minmax(100px, 1fr) 32px', gap:8, alignItems:'center', marginBottom:8, padding:'8px 10px', background:'rgba(255,255,255,0.025)', border:'1px solid var(--border)', borderRadius:8 }}>
                    <div style={{ fontSize:9.5, fontWeight:700, color:rolColor, textAlign:'center', padding:'2px 4px', background:`${rolColor}1A`, borderRadius:4 }}>
                      #{i+1} {rol}
                    </div>
                    <select className="fi" value={es.company_id||''} disabled={isUlt} onChange={e=>{
                      const nuevos = [...arr]; nuevos[i] = { ...nuevos[i], company_id: e.target.value };
                      setForm({ ...form, eslabones: nuevos });
                    }} style={isUlt ? { opacity: 0.85, cursor: 'not-allowed', background: 'rgba(46,204,113,0.07)' } : {}}>
                      <option value="">— Empresa —</option>
                      {companiesActivas
                        .filter(c => isUlt ? c.id === form.ejecutora_company_id : c.id !== form.ejecutora_company_id)
                        .map(c => <option key={c.id} value={c.id}>{c.name}{c.rol_grupo?` · ${c.rol_grupo}`:''}</option>)}
                    </select>
                    <input className="fi" type="number" min="0" step="0.01" placeholder="Precio unit"
                      value={es.precio_unit ?? ''} onChange={e=>{
                        const nuevos = [...arr]; nuevos[i] = { ...nuevos[i], precio_unit: e.target.value };
                        setForm({ ...form, eslabones: nuevos });
                      }}/>
                    <div style={{ fontSize:11, color: markupPct >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {ant > 0 && cur > 0 ? `+${markupPct.toFixed(1)}%` : '—'}
                    </div>
                    <input className="fi" placeholder="Factura" value={es.factura||''} onChange={e=>{
                      const nuevos = [...arr]; nuevos[i] = { ...nuevos[i], factura: e.target.value };
                      setForm({ ...form, eslabones: nuevos });
                    }}/>
                    <button type="button" className="btn btn-ghost btn-xs" title="Quitar"
                      disabled={arr.length === 1}
                      onClick={()=>{
                        const nuevos = arr.filter((_, idx) => idx !== i);
                        setForm({ ...form, eslabones: nuevos.length ? nuevos : [{ company_id:'', precio_unit:'', factura:'', fecha_op: form.fecha }] });
                      }}>
                      <JxIcon name="x" size={11}/>
                    </button>
                  </div>
                );
              })}
              <button type="button" className="btn btn-ghost btn-sm"
                onClick={()=>{
                  const arr = [...(form.eslabones||[])];
                  arr.push({ company_id:'', precio_unit:'', factura:'', fecha_op: form.fecha });
                  setForm({ ...form, eslabones: arr });
                }}>
                <JxIcon name="plus" size={11}/> Agregar eslabón
              </button>
            </div>

            {/* ── Resumen en vivo ── */}
            {(() => {
              const tots = totalesItems();
              const last = (form.eslabones || []).filter(e => e.precio_unit).slice(-1)[0];
              const final = Number(last?.precio_unit || 0);
              if (!(tots.cant > 0 && tots.precio_real_prom > 0 && final > 0)) return null;
              const factor = tots.precio_real_prom > 0 ? final / tots.precio_real_prom : 1;
              // Toggle IGV: si conIgv = true, multiplicamos los netos por 1.18
              const mul = conIgv ? (1 + IGV_RATE) : 1;
              const costoReal = tots.total_real * mul;
              const cargado = (tots.total_real * factor) * mul;
              const presup = tots.total_ref * mul;
              return (
                <div style={{ gridColumn:'1/-1', background:'rgba(46,204,113,0.06)', border:'1px solid rgba(46,204,113,0.25)', borderRadius:8, padding:'12px 14px', fontSize:12 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, flexWrap:'wrap', gap:6 }}>
                    <div style={{ fontSize:11, color:'var(--green)', fontWeight:700, textTransform:'uppercase' }}>
                      Resumen en vivo · {conIgv ? 'CON IGV (18%)' : 'SIN IGV (neto)'}
                    </div>
                    <button type="button"
                      className={`btn btn-xs ${conIgv ? 'btn-amber' : 'btn-ghost'}`}
                      onClick={() => setConIgv(v => !v)}
                      title="Alternar entre precios netos y precios con IGV incluido">
                      {conIgv ? '✓ Con IGV' : '+ IGV'}
                    </button>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:10 }}>
                    <div><div style={{ color:'var(--tm)', fontSize:10.5 }}>Costo real</div><div style={{ color:'var(--blue)', fontWeight:700 }}>{fmtCur(costoReal)}</div></div>
                    <div><div style={{ color:'var(--tm)', fontSize:10.5 }}>Costo cargado a obra</div><div style={{ color:'var(--amber)', fontWeight:700 }}>{fmtCur(cargado)}</div></div>
                    <div><div style={{ color:'var(--tm)', fontSize:10.5 }}>Ganancia grupo</div><div style={{ color: cargado-costoReal>=0?'var(--green)':'var(--red)', fontWeight:700 }}>{fmtCur(cargado-costoReal)}</div></div>
                    <div><div style={{ color:'var(--tm)', fontSize:10.5 }}>Ganancia ejecutora aparente</div><div style={{ color: presup-cargado>=0?'var(--green)':'var(--red)', fontWeight:700 }}>{fmtCur(presup-cargado)} {presup>0?`(${((presup-cargado)/presup*100).toFixed(1)}%)`:''}</div></div>
                  </div>
                </div>
              );
            })()}

            <div>
              <label className="flabel">Estado</label>
              <select className="fi" value={form.estado||'borrador'} onChange={e=>setForm({...form, estado:e.target.value})}>
                <option value="borrador">Borrador</option>
                <option value="confirmada">Confirmada</option>
                <option value="facturada">Facturada</option>
              </select>
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <label className="flabel">Notas</label>
              <textarea className="fi" rows={2} value={form.notas||''} onChange={e=>setForm({...form, notas:e.target.value})}/>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>{setModal(false); setEditingId(null); setForm(null);}}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardar}>
              <JxIcon name="check" size={13}/>{editingId ? 'Guardar Cambios' : 'Crear Cadena'}
            </button>
          </div>
        </Modal>
      )}

      {/* Modal de resultado del análisis IA de coherencia */}
      {iaAnalisis && (
        <Modal title={
          iaAnalisis.resultado === 'incoherente' ? '🚨 Cadena INCOHERENTE'
          : iaAnalisis.resultado === 'advertencia' ? '⚠️ Cadena con advertencias'
          : '✅ Cadena coherente'
        } icon="alert" onClose={() => setIaAnalisis(null)} wide>
          <div style={{
            padding: '12px 14px',
            background: iaAnalisis.resultado === 'incoherente' ? 'rgba(231,76,60,0.1)'
                       : iaAnalisis.resultado === 'advertencia' ? 'rgba(242,183,5,0.1)'
                       : 'rgba(46,204,113,0.1)',
            border: `1px solid ${iaAnalisis.resultado === 'incoherente' ? 'rgba(231,76,60,0.4)'
                       : iaAnalisis.resultado === 'advertencia' ? 'rgba(242,183,5,0.4)'
                       : 'rgba(46,204,113,0.4)'}`,
            borderRadius: 8,
            marginBottom: 12,
          }}>
            <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--ts)' }}>
              {iaAnalisis.resumen}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 6 }}>
              Confianza del análisis: <strong>{Math.round((iaAnalisis.confianza || 0) * 100)}%</strong>
            </div>
          </div>

          {Array.isArray(iaAnalisis.hallazgos) && iaAnalisis.hallazgos.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
                Hallazgos ({iaAnalisis.hallazgos.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {iaAnalisis.hallazgos.map((h, i) => (
                  <div key={i} style={{
                    padding: '10px 12px',
                    background: 'rgba(255,255,255,0.025)',
                    border: `1px solid ${h.severidad === 'alta' ? 'rgba(231,76,60,0.4)' : h.severidad === 'media' ? 'rgba(242,183,5,0.3)' : 'var(--border)'}`,
                    borderRadius: 6,
                    fontSize: 12,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, flexWrap: 'wrap', gap: 6 }}>
                      <strong style={{ color: h.severidad === 'alta' ? 'var(--red)' : h.severidad === 'media' ? 'var(--amber)' : 'var(--tp)' }}>
                        {h.severidad === 'alta' ? '🔴' : h.severidad === 'media' ? '🟡' : '🔵'} {h.empresa}
                      </strong>
                      <span style={{ fontSize: 10.5, color: 'var(--tm)' }}>↔ {h.material}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ts)', marginBottom: 6 }}>{h.motivo}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--green)', borderTop: '1px dashed var(--border)', paddingTop: 6 }}>
                      💡 <strong>Sugerencia:</strong> {h.sugerencia}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {Array.isArray(iaAnalisis.advertencias_sunat) && iaAnalisis.advertencias_sunat.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--red)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
                ⚖️ Advertencias SUNAT
              </div>
              <ul style={{ fontSize: 12, color: 'var(--ts)', paddingLeft: 20, margin: 0 }}>
                {iaAnalisis.advertencias_sunat.map((a, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>{a}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="modal-actions">
            <button className="btn btn-amber" onClick={() => setIaAnalisis(null)}>Entendido</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Componente visual de una cadena (para el modal de detalle).
function CadenaVisual({ cadena, lookupCompany, lookupObra, calcular }) {
  const r = calcular(cadena);
  const obra = lookupObra(cadena.obra_id);
  const eslabones = cadena.eslabones || [];
  // Auth se resuelve UNA vez en el render (no dentro de handlers async).
  // Llamar a window.__useAuth() desde un onClick post-render tira
  // "Invalid hook call" porque React no está en su fase de render.
  const auth = window.__useAuth?.();

  // Toggle precios netos vs con IGV
  const [conIgv, setConIgv] = uSC(false);
  const IGV_RATE = 0.18;
  const mul = conIgv ? (1 + IGV_RATE) : 1;
  const ap = (n) => Number(n || 0) * mul;

  // Cargar facturas internas vinculadas a esta cadena
  const [facturas, setFacturas] = uSC([]);
  uEC(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const mod = await import('../lib/facturas-internas.js');
        const fs = await mod.listarFacturasDeCadena(cadena.id);
        if (!cancelled) setFacturas(fs);
      } catch { if (!cancelled) setFacturas([]); }
    };
    load();
    const onChange = (e) => {
      const t = e?.detail?.tabla;
      if (!t || t === 'accounting_movements' || t === 'intercompany_transactions') load();
    };
    window.addEventListener('jx_data_changed', onChange);
    return () => { cancelled = true; window.removeEventListener('jx_data_changed', onChange); };
  }, [cadena.id]);

  const descargarFacturaPdf = async (paso) => {
    try {
      const seller = paso.income;
      const buyer = paso.cost;
      if (!seller || !buyer) return;
      const allCompanies = await window.__db.companies.toArray();
      const emisor = allCompanies.find(c => c.id === seller.company_id);
      const adquiriente = allCompanies.find(c => c.id === buyer.company_id);
      const meta = seller.factura_interna_meta || {};
      // Items: si la meta tiene items[] (multi), usarlos; sino fallback legacy
      const items = Array.isArray(meta.items) && meta.items.length > 0
        ? meta.items
        : [{
            descripcion: meta.item_nombre || cadena.item_nombre,
            unidad: meta.unidad || cadena.unidad,
            cantidad: meta.cantidad || cadena.cantidad,
            precio_unitario: meta.precio_unitario || 0,
          }];
      const factura = {
        serie: meta.serie || 'FB01',
        correlativo: meta.correlativo || 1,
        fecha: meta.fecha || seller.date,
        moneda: meta.moneda || seller.currency,
        concepto: meta.concepto,
        observaciones: cadena.notas,
        chain_id: cadena.id,
        paso_idx: meta.paso_idx,
        paso_total: meta.paso_total,
        estado: seller.estado_factura || 'borrador',
        tipo_documento: seller.estado_factura === 'borrador' ? 'FACTURA INTERNA (BORRADOR)' : 'FACTURA INTERNA',
      };
      window.__pdfs?.generateFacturaInternaPdf?.(factura, items, emisor, adquiriente);
    } catch (e) { alert('Error PDF: ' + (e.message || e)); }
  };

  const marcarEmitida = async (paso) => {
    try {
      if (!confirm('¿Marcar esta factura como emitida (firmada y lista para SUNAT)?')) return;
      const mod = await import('../lib/facturas-internas.js');
      await mod.marcarFacturaEmitida(paso.income.id, auth?.profile?.id || 'offline');
    } catch (e) { alert('Error: ' + (e.message || e)); }
  };
  const Box = ({ titulo, sub, precio, total, color, icono }) => (
    <div style={{ flex:1, minWidth:140, background:'rgba(255,255,255,0.025)', border:`1px solid ${color}55`, borderTop:`3px solid ${color}`, borderRadius:8, padding:'10px 12px', textAlign:'center' }}>
      <div style={{ fontSize:10.5, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:4 }}>{titulo}</div>
      <div style={{ fontSize:12.5, fontWeight:700, color:'var(--tp)', marginBottom:4 }}>{sub}</div>
      <div style={{ fontSize:18, fontWeight:800, color }}>{fmtCur(precio)}</div>
      <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:2 }}>{fmtCurK(total)} total</div>
    </div>
  );
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div style={{ background:'rgba(155,89,182,0.06)', border:'1px solid rgba(155,89,182,0.25)', borderRadius:8, padding:'10px 14px', fontSize:12 }}>
        <strong>{cadena.item_nombre}</strong> · {cadena.cantidad} {cadena.unidad} · Obra: {obra?.nombre_obra || '—'} · Fecha: {cadena.fecha}
      </div>
      {/* Toggle IGV global del detalle */}
      <div style={{ display:'flex', justifyContent:'flex-end', alignItems:'center', gap:8, fontSize:11 }}>
        <span style={{ color:'var(--tm)' }}>Precios:</span>
        <button type="button"
          className={`btn btn-xs ${conIgv ? 'btn-ghost' : 'btn-amber'}`}
          onClick={() => setConIgv(false)}>
          Sin IGV
        </button>
        <button type="button"
          className={`btn btn-xs ${conIgv ? 'btn-amber' : 'btn-ghost'}`}
          onClick={() => setConIgv(true)}>
          Con IGV
        </button>
      </div>

      {/* Items individuales (multi-items) */}
      {Array.isArray(r.items) && r.items.length > 0 && (
        <div style={{ background:'rgba(52,152,219,0.05)', border:'1px solid rgba(52,152,219,0.25)', borderRadius:8, padding:'10px 12px' }}>
          <div style={{ fontSize:11, color:'var(--blue)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6 }}>
            Items del comprobante origen ({r.items.length}) · {conIgv ? 'CON IGV' : 'NETO'}
          </div>
          <div style={{ overflowX:'auto', WebkitOverflowScrolling:'touch' }}>
            <table className="tbl" style={{ fontSize:11, minWidth:560 }}>
              <thead><tr>
                <th style={{ minWidth:120 }}>Descripción</th>
                <th>Und</th>
                <th style={{ textAlign:'right' }}>Cant.</th>
                <th style={{ textAlign:'right' }}>P. real</th>
                <th style={{ textAlign:'right' }}>Subt. real</th>
                <th style={{ textAlign:'right' }}>P. ref.</th>
                <th style={{ textAlign:'right' }}>Subt. ref.</th>
              </tr></thead>
              <tbody>
                {r.items.map((it, i) => {
                  const subReal = Number(it.cantidad || 0) * Number(it.precio_real_unitario || 0);
                  const subRef  = Number(it.cantidad || 0) * Number(it.precio_referencial_contrato || 0);
                  return (
                    <tr key={i}>
                      <td style={{ fontWeight:600 }}>{it.descripcion || '—'}</td>
                      <td>{it.unidad || '—'}</td>
                      <td style={{ textAlign:'right' }}>{Number(it.cantidad || 0).toFixed(2)}</td>
                      <td style={{ textAlign:'right', color:'var(--blue)' }}>{fmtCur(ap(it.precio_real_unitario))}</td>
                      <td style={{ textAlign:'right', color:'var(--blue)' }}>{fmtCur(ap(subReal))}</td>
                      <td style={{ textAlign:'right', color:'var(--purple, #9B59B6)' }}>{fmtCur(ap(it.precio_referencial_contrato || 0))}</td>
                      <td style={{ textAlign:'right', color:'var(--purple, #9B59B6)' }}>{fmtCur(ap(subRef))}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background:'rgba(0,0,0,0.10)', fontWeight:700 }}>
                  <td colSpan={4} style={{ textAlign:'right' }}>TOTALES:</td>
                  <td style={{ textAlign:'right', color:'var(--blue)' }}>{fmtCur(ap(r.costoTotalReal))}</td>
                  <td/>
                  <td style={{ textAlign:'right', color:'var(--purple, #9B59B6)' }}>{fmtCur(ap(r.presupTotal))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
        <Box titulo="Externo" sub={cadena.proveedor_externo_nombre || 'Proveedor externo'} precio={ap(r.precioReal)} total={ap(r.costoTotalReal)} color="#3498DB"/>
        {eslabones.map((es, i) => {
          const co = lookupCompany(es.company_id);
          const ant = i === 0 ? r.precioReal : Number(eslabones[i-1].precio_unit || 0);
          const cur = Number(es.precio_unit || 0);
          const mk = ant > 0 ? ((cur - ant) / ant * 100) : 0;
          const isUlt = i === eslabones.length - 1;
          return (
            <React.Fragment key={i}>
              <div style={{ color:'var(--tm)', fontSize:18, fontWeight:700 }}>→</div>
              <div style={{ flex:1, minWidth:140 }}>
                <Box
                  titulo={isUlt ? 'Ejecutora' : `Eslabón ${i+1}`}
                  sub={co?.name || '?'}
                  precio={ap(cur)}
                  total={ap(cur * r.cant)}
                  color={isUlt ? '#2ECC71' : '#F2B705'}
                />
                <div style={{ textAlign:'center', fontSize:10.5, color: mk>=0?'var(--green)':'var(--red)', marginTop:4 }}>
                  +{mk.toFixed(1)}% markup
                </div>
              </div>
            </React.Fragment>
          );
        })}
        <div style={{ color:'var(--tm)', fontSize:18, fontWeight:700 }}>→</div>
        <Box titulo="Cliente final" sub="Presupuesto contractual" precio={ap(r.presup)} total={ap(r.presupTotal)} color="#9B59B6"/>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:10 }}>
        <div className="kpi-card">
          <div style={{ fontSize:10.5, color:'var(--tm)' }}>Ganancia grupo (real)</div>
          <div style={{ fontSize:18, fontWeight:800, color: r.gananciaGrupoReal>=0?'var(--green)':'var(--red)' }}>{fmtCur(ap(r.gananciaGrupoReal))}</div>
          <div style={{ fontSize:10, color:'var(--tm)' }}>cargado − real</div>
        </div>
        <div className="kpi-card">
          <div style={{ fontSize:10.5, color:'var(--tm)' }}>Ganancia ejecutora (aparente)</div>
          <div style={{ fontSize:18, fontWeight:800, color: r.gananciaEjecutoraAparente>=0?'var(--green)':'var(--red)' }}>{fmtCur(ap(r.gananciaEjecutoraAparente))}</div>
          <div style={{ fontSize:10, color:'var(--tm)' }}>{r.presupTotal>0 ? `${(r.gananciaEjecutoraAparente/r.presupTotal*100).toFixed(1)}% del presupuesto` : '—'}</div>
        </div>
        <div className="kpi-card">
          <div style={{ fontSize:10.5, color:'var(--tm)' }}>Ganancia total efectiva</div>
          <div style={{ fontSize:18, fontWeight:800, color: r.gananciaTotalEfectiva>=0?'var(--green)':'var(--red)' }}>{fmtCur(ap(r.gananciaTotalEfectiva))}</div>
          <div style={{ fontSize:10, color:'var(--tm)' }}>presupuesto − costo real</div>
        </div>
      </div>
      {cadena.notas && (
        <div style={{ fontSize:11.5, color:'var(--ts)', padding:'8px 10px', background:'rgba(255,255,255,0.025)', border:'1px solid var(--border)', borderRadius:6 }}>
          <strong>Notas:</strong> {cadena.notas}
        </div>
      )}

      {/* ── Facturas internas generadas ── */}
      {facturas.length === 0 && (cadena.estado === 'confirmada' || cadena.estado === 'borrador') && (
        <div style={{ borderTop:'1px solid var(--border)', paddingTop:12 }}>
          <div style={{ fontSize:11.5, color:'var(--tm)', padding:'10px 12px', background:'rgba(242,183,5,0.06)', border:'1px dashed rgba(242,183,5,0.4)', borderRadius:8 }}>
            ℹ Esta cadena aún no tiene facturas internas generadas.
            {cadena.estado === 'borrador'
              ? ' Editá la cadena y cambiala a estado "Confirmada" para poder generar las facturas.'
              : ' Cerrá este detalle y andá a la fila → botón "📄 Generar facturas".'}
          </div>
        </div>
      )}
      {facturas.length > 0 && (
        <div style={{ borderTop:'1px solid var(--border)', paddingTop:12 }}>
          <div style={{ fontSize:12.5, fontWeight:700, color:'var(--amber)', marginBottom:8 }}>
            📄 Facturas internas generadas ({facturas.length})
          </div>
          <div style={{ overflowX:'auto', border:'1px solid var(--border)', borderRadius:8 }}>
            <table className="tbl" style={{ fontSize:11 }}>
              <thead><tr>
                <th>Paso</th>
                <th>Vendedor → Comprador</th>
                <th>N° doc</th>
                <th style={{ textAlign:'right' }}>Total</th>
                <th>Estado</th>
                <th style={{ textAlign:'center' }}>Acciones</th>
              </tr></thead>
              <tbody>
                {facturas.map(paso => {
                  const seller = paso.income;
                  const buyer = paso.cost;
                  if (!seller || !buyer) return null;
                  const cV = lookupCompany(seller.company_id);
                  const cC = lookupCompany(buyer.company_id);
                  const estado = seller.estado_factura || 'borrador';
                  return (
                    <tr key={paso.step}>
                      <td style={{ textAlign:'center' }}>{paso.step + 1}</td>
                      <td>
                        <strong>{cV?.name || '?'}</strong>
                        <span style={{ color:'var(--tm)', margin:'0 6px' }}>→</span>
                        <strong>{cC?.name || '?'}</strong>
                      </td>
                      <td style={{ fontFamily:'monospace' }}>{seller.document_number}</td>
                      <td style={{ textAlign:'right', fontWeight:700, color:'var(--amber)' }}>
                        {fmtCur(seller.amount)}
                      </td>
                      <td>
                        <span className={`badge ${estado === 'emitida' ? 'b-blue' : estado === 'recibida' ? 'b-green' : 'b-gray'}`}>
                          {estado === 'borrador' ? 'Borrador' : estado === 'emitida' ? 'Emitida' : estado === 'recibida' ? 'Recibida' : estado}
                        </span>
                      </td>
                      <td style={{ textAlign:'center', whiteSpace:'nowrap' }}>
                        <button className="btn btn-ghost btn-xs" title="Descargar PDF" onClick={() => descargarFacturaPdf(paso)}>
                          <JxIcon name="download" size={11}/>
                        </button>
                        {estado === 'borrador' && (
                          <button className="btn btn-amber btn-xs" title="Marcar como emitida (firmada)" onClick={() => marcarEmitida(paso)} style={{ marginLeft:4 }}>
                            ✓
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:6 }}>
            💡 Las facturas borrador no llegan a SUNAT hasta que las marcás "emitida". Para registrar la recepción real,
            subí la factura firmada vía <strong>Captura Mágica</strong> y vinculala a esta cadena.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Modal de cierre "sin factura" para ingresos de almacén ──
// Cuando un ingreso registrado por almacén sin factura nunca tendrá una
// (consumo interno / donación / muestra), la contadora lo cierra acá con
// un motivo. pendiente_sustento pasa a false sin link a accounting_movement.
function CerrarSinFacturaModal({ mov, matName, onClose, onConfirm }) {
  const [motivo, setMotivo] = uSC('');
  const [saving, setSaving] = uSC(false);
  const submit = async () => {
    setSaving(true);
    try { await onConfirm(motivo); }
    finally { setSaving(false); }
  };
  return (
    <Modal title="Marcar ingreso sin factura" icon="x" onClose={onClose}>
      <div style={{ fontSize:12.5, color:'var(--ts)', marginBottom:10, lineHeight:1.5 }}>
        Vas a cerrar este ingreso de <strong>{mov.cantidad} {mov.unidad}</strong> de <strong>{matName}</strong> sin asociar una factura. Quedará registrado en auditoría.
      </div>
      <div style={{ marginBottom:10 }}>
        <label className="flabel">Motivo (mín 5 caracteres)</label>
        <textarea className="fi" rows={3}
          placeholder="Ej: consumo interno · donación de proveedor · muestra · material descartado"
          value={motivo}
          onChange={e=>setMotivo(e.target.value)}/>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-amber" onClick={submit} disabled={saving || motivo.trim().length < 5}>
          <JxIcon name="check" size={13}/> {saving ? 'Guardando…' : 'Cerrar sin factura'}
        </button>
      </div>
    </Modal>
  );
}


// Visor de PDF robusto: muchos PDFs viejos se subieron con content-type
// genérico (octet-stream) y el iframe directo mostraba un recuadro GRIS.
// Se re-tipa vía blob local (application/pdf) — el navegador siempre lo
// renderiza; si ni así, queda el aviso + "Abrir en nueva pestaña".
function PdfFrame({ url, nombre }) {
  const [src, setSrc] = uSC(null);
  const [err, setErr] = uSC(false);
  uEC(() => {
    let obj = null, cancel = false;
    (async () => {
      try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const buf = await resp.arrayBuffer();
        obj = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
        if (cancel) { URL.revokeObjectURL(obj); obj = null; return; }
        setSrc(obj);
      } catch { if (!cancel) setErr(true); }
    })();
    return () => { cancel = true; if (obj) { try { URL.revokeObjectURL(obj); } catch {} } };
  }, [url]);
  if (err) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 10, color: 'var(--tm)' }}>
      <JxIcon name="file" size={40} />
      <div style={{ fontSize: 12 }}>No se pudo previsualizar {nombre || 'el PDF'} acá.</div>
      <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-amber btn-sm">Abrir en nueva pestaña</a>
    </div>
  );
  if (!src) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--tm)', fontSize: 12 }}>Cargando PDF…</div>;
  return <iframe src={src} title={nombre || 'PDF'} style={{ width: '100%', height: '70vh', border: 'none', background: 'white' }} />;
}

Object.assign(window, {
  EmpresasPage, MovimientosContablesPage, IntercompanyPage,
  ContabilidadDashboardPage, ConsolidadoPage,
  TrazabilidadPage,
});
