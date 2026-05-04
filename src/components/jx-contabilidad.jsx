import React from "react";
const { useState: uSC, useMemo: uMC, useEffect: uEC } = React;

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
const STATUS_BADGE = { paid: 'b-green', pending: 'b-amber', cancelled: 'b-gray' };
const STATUS_LABEL = { paid: 'Pagado', pending: 'Pendiente', cancelled: 'Anulado' };
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
  const isAdmin = auth?.profile?.rol === 'admin';
  const userId = auth?.profile?.id ?? 'offline';
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
  const [form, setForm] = uSC({});

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
      direccion:'', telefono:'', email:'', representante_legal:'', inicio_actividades:'',
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
      rol_grupo: c.rol_grupo || 'mixta',
      regimen_tributario: c.regimen_tributario || 'RG',
      margen_objetivo_pct: c.margen_objetivo_pct ?? '',
      direccion: c.direccion || '',
      telefono: c.telefono || '',
      email: c.email || '',
      representante_legal: c.representante_legal || '',
      inicio_actividades: c.inicio_actividades || '',
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
          rol_grupo: form.rol_grupo || null,
          regimen_tributario: form.regimen_tributario || null,
          margen_objetivo_pct: form.margen_objetivo_pct === '' || form.margen_objetivo_pct == null
            ? null : Number(form.margen_objetivo_pct),
          direccion: form.direccion?.trim() || null,
          telefono: form.telefono?.trim() || null,
          email: form.email?.trim() || null,
          representante_legal: form.representante_legal?.trim() || null,
          inicio_actividades: form.inicio_actividades || null,
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
          rol_grupo: form.rol_grupo || null,
          regimen_tributario: form.regimen_tributario || null,
          margen_objetivo_pct: form.margen_objetivo_pct === '' || form.margen_objetivo_pct == null
            ? null : Number(form.margen_objetivo_pct),
          direccion: form.direccion?.trim() || null,
          telefono: form.telefono?.trim() || null,
          email: form.email?.trim() || null,
          representante_legal: form.representante_legal?.trim() || null,
          inicio_actividades: form.inicio_actividades || null,
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
        {isAdmin && (
          <button className="btn btn-amber btn-sm" onClick={openNueva}>
            <JxIcon name="plus" size={13}/>Nueva Empresa
          </button>
        )}
      </div>

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
        <Modal title={editingId ? 'Editar Empresa' : 'Nueva Empresa'} icon="building" onClose={()=>{setModal(null); setEditingId(null);}}>
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
                <input className="fi" placeholder="11 dígitos" maxLength={11} value={form.ruc||''} onChange={e=>setForm({...form, ruc:e.target.value.replace(/\D/g,'').slice(0,11)})} style={{ flex:1 }}/>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  title="Buscar datos en SUNAT por este RUC"
                  disabled={!/^\d{11}$/.test(String(form.ruc || ''))}
                  onClick={async () => {
                    try {
                      const data = await window.__identity.consultarRUC(form.ruc);
                      setForm(prev => ({
                        ...prev,
                        legal_name: data.razonSocial || prev.legal_name || '',
                        name: prev.name || data.razonSocial || '',
                        direccion: data.direccion || prev.direccion || '',
                        // Auto-rellenar rubro si SUNAT lo trae (solo con v2/token)
                        rubro: data.rubroSugerido || prev.rubro || 'otro',
                        inicio_actividades: data.fechaInicioActividades || prev.inicio_actividades || '',
                        notas: [
                          data.actividadEconomica && `Actividad: ${data.actividadEconomica}`,
                          data.ciiu && `CIIU: ${data.ciiu}`,
                          data.estado, data.condicion,
                        ].filter(Boolean).join(' · ') || prev.notas || '',
                      }));
                      const extra = data.rubroSugerido ? ` · rubro: ${data.rubroSugerido}` : '';
                      showToast(`SUNAT: ${data.razonSocial || 'datos cargados'}${extra}`, 'green');
                    } catch (e) {
                      showToast(e.message || 'Error consultando SUNAT', 'red');
                    }
                  }}
                  style={{ whiteSpace:'nowrap' }}>
                  <JxIcon name="search" size={12}/> SUNAT
                </button>
              </div>
            </div>
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
  const isAdmin = auth?.profile?.rol === 'admin';
  const userId = auth?.profile?.id ?? 'offline';
  const { data: companies } = window.__hooks.useCompanies();
  const { data: movs } = window.__hooks.useAccountingMovements();

  const [filtroEmpresa, setFiltroEmpresa] = uSC('todas');
  const [filtroTipo, setFiltroTipo] = uSC('todos');
  const [filtroEstado, setFiltroEstado] = uSC('todos');
  const [busqueda, setBusqueda] = uSC('');
  const [modal, setModal] = uSC(null);
  const [editingId, setEditingId] = uSC(null);
  const [form, setForm] = uSC({});

  const companiesActivas = uMC(() => (companies || []).filter(c => c.status === 'activa'), [companies]);

  const filtered = uMC(() => {
    if (!movs) return [];
    let f = [...movs];
    if (filtroEmpresa !== 'todas') f = f.filter(m => m.company_id === filtroEmpresa);
    if (filtroTipo !== 'todos') f = f.filter(m => m.type === filtroTipo);
    if (filtroEstado !== 'todos') f = f.filter(m => m.payment_status === filtroEstado);
    if (busqueda) {
      const q = busqueda.toLowerCase();
      f = f.filter(m => (m.description||'').toLowerCase().includes(q)
        || (m.third_party_name||'').toLowerCase().includes(q)
        || (m.document_number||'').toLowerCase().includes(q));
    }
    return f.sort((a,b) => (b.date||'').localeCompare(a.date||''));
  }, [movs, filtroEmpresa, filtroTipo, filtroEstado, busqueda]);

  const openNuevo = () => {
    if (!companiesActivas.length) { showToast('Crea primero una empresa', 'red'); return; }
    setForm({
      company_id: companiesActivas[0].id,
      date: new Date().toISOString().slice(0,10),
      type: 'income',
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
      type: m.type,
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
    try {
      if (editingId) {
        const orig = movs.find(m => m.id === editingId);
        await window.__db.accounting_movements.update(editingId, {
          company_id: form.company_id,
          date: form.date,
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
        await window.__db.accounting_movements.add({
          id,
          company_id: form.company_id,
          date: form.date,
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
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_acc_mov_${id}`,
        });
        try { await window.__logAudit?.({ action:'insert', table:'accounting_movements', recordId:id, newData:form }); } catch {}
        showToast('Movimiento registrado', 'green');
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

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Movimientos Contables</div>
          <div className="pg-sub">{filtered.length} de {(movs || []).length} movimientos · ingresos / costos / gastos por empresa</div>
        </div>
        <button className="btn btn-amber btn-sm" onClick={openNuevo}>
          <JxIcon name="plus" size={13}/>Nuevo Movimiento
        </button>
      </div>

      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:14 }}>
        <div className="search-bar" style={{ flex:'1 1 200px' }}><JxIcon name="search" size={14} color="var(--tm)"/><input placeholder="Buscar descripción / cliente / doc…" value={busqueda} onChange={e=>setBusqueda(e.target.value)}/></div>
        <select className="fi" value={filtroEmpresa} onChange={e=>setFiltroEmpresa(e.target.value)} style={{ minWidth:160 }}>
          <option value="todas">Todas las empresas</option>
          {(companies || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
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
      </div>

      {filtered.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="dollar" size={40} color="var(--tm)"/>
          <p>No hay movimientos {(movs || []).length > 0 ? 'que coincidan con el filtro' : 'registrados aún'}.</p>
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
                {filtered.map(m => {
                  const c = lookupCompany(m.company_id);
                  const isIc = m.is_intercompany;
                  return (
                    <tr key={m.id} style={isIc ? { background:'rgba(52,152,219,0.04)' } : null}>
                      <td className="col-m">{m.date}</td>
                      <td className="col-p">{c?.name || '—'}</td>
                      <td>
                        <span className={`badge ${TYPE_BADGE[m.type]}`}>{TYPE_LABEL[m.type]}</span>
                        {isIc && <div style={{ marginTop:3 }}><span className="badge b-blue" title="Operación interna entre empresas del grupo" style={{ fontSize:9 }}>INTERCO</span></div>}
                      </td>
                      <td>{m.description || '—'}{m.category && <div style={{ fontSize:10, color:'var(--tm)' }}>{m.category}</div>}</td>
                      <td>{m.third_party_name || '—'}</td>
                      <td className="col-m" style={{ fontSize:11 }}>{m.document_type ? `${m.document_type} ${m.document_number || ''}` : '—'}</td>
                      <td style={{ textAlign:'right', fontWeight:700, color:TYPE_COLOR[m.type] }} className="col-num">{fmtCur(m.amount, m.currency)}</td>
                      <td>
                        <select className="fi" value={m.payment_status} onChange={e=>cambiarEstadoPago(m, e.target.value)} style={{ fontSize:11, padding:'4px 6px', minWidth:110 }}>
                          <option value="pending">⏱ Pendiente</option>
                          <option value="paid">✓ Pagado</option>
                          <option value="cancelled">✗ Anulado</option>
                        </select>
                      </td>
                      <td style={{ textAlign:'center', whiteSpace:'nowrap' }}>
                        <button className="btn btn-ghost btn-xs" title={isIc?'Editar desde Operaciones entre empresas':'Editar'} onClick={()=>openEditar(m)} disabled={isIc}>
                          <JxIcon name="edit" size={11}/>
                        </button>
                        {isAdmin && (
                          <button className="btn btn-red btn-xs" title="Eliminar" onClick={()=>eliminar(m)} style={{ marginLeft:4 }} disabled={isIc}>
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

      {(modal === 'nuevo' || modal === 'editar') && (
        <Modal title={editingId ? 'Editar Movimiento' : 'Nuevo Movimiento'} icon="dollar" onClose={()=>{setModal(null); setEditingId(null);}} wide>
          <div className="g2">
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
              <label className="flabel">Cuenta PCGE (opcional)</label>
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
  const isAdmin = auth?.profile?.rol === 'admin';
  const userId = auth?.profile?.id ?? 'offline';
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
      date: new Date().toISOString().slice(0,10),
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
        related_movement_id: buyerMovId,
        notas: form.notas || null,
        created_by: userId, updated_by: userId,
        created_at: now, updated_at: now,
        version: 1, sync_status: 'pending_create', last_synced_at: null,
        idempotency_key: `${userId}_acc_mov_${sellerMovId}`,
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
        version: 1, sync_status: 'pending_create', last_synced_at: null,
        idempotency_key: `${userId}_acc_mov_${buyerMovId}`,
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
        version: 1, sync_status: 'pending_create', last_synced_at: null,
        idempotency_key: `${userId}_ictx_${ictxId}`,
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
        <button className="btn btn-amber btn-sm" onClick={openNueva}>
          <JxIcon name="plus" size={13}/>Nueva Operación Interna
        </button>
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
  const { data: companies } = window.__hooks.useCompanies();
  const { data: movs } = window.__hooks.useAccountingMovements();

  const [filtroEmpresa, setFiltroEmpresa] = uSC('todas');
  const [filtroMoneda, setFiltroMoneda] = uSC('PEN');
  const [filtroDesde, setFiltroDesde] = uSC('');
  const [filtroHasta, setFiltroHasta] = uSC('');

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

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Dashboard Contable</div>
          <div className="pg-sub">Vista rápida de ingresos, costos y márgenes por empresa</div>
        </div>
      </div>

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

  const companiesActivas = uMC(() => (companies || []).filter(c => c.status === 'activa' && !c.deleted_at), [companies]);
  const lookupCompany = (id) => companies?.find(c => c.id === id);
  const lookupObra = (id) => obras?.find(o => o.id === id);

  const sorted = uMC(() => [...(cadenas || [])].sort((a,b) => (b.fecha || '').localeCompare(a.fecha || '')), [cadenas]);

  // ── Cálculos por cadena ──────────────────────────────────────
  const calcular = (c) => {
    const cant = Number(c.cantidad || 0);
    const precioReal = Number(c.precio_real_unitario || 0);
    const eslabones = Array.isArray(c.eslabones) ? c.eslabones : [];
    const ultimo = eslabones[eslabones.length - 1];
    const precioFinal = Number(ultimo?.precio_unit || 0);
    const presup = Number(c.precio_referencial_contrato || 0);
    const costoTotalReal = precioReal * cant;
    const costoCargadoObra = precioFinal * cant;
    const presupTotal = presup * cant;
    const gananciaGrupoReal = costoCargadoObra - costoTotalReal;
    const gananciaEjecutoraAparente = presupTotal - costoCargadoObra;
    const gananciaTotalEfectiva = presupTotal - costoTotalReal;
    return {
      cant, precioReal, precioFinal, presup,
      costoTotalReal, costoCargadoObra, presupTotal,
      gananciaGrupoReal, gananciaEjecutoraAparente, gananciaTotalEfectiva,
    };
  };

  // ── Sugerencia de precios distribuidos ──────────────────────
  // Dado precio_real y precio_referencial_contrato, distribuye el markup
  // entre los eslabones intermedios proporcional a sus margen_objetivo_pct
  // (o uniformemente si no están definidos). Deja al final un precio_carga
  // ligeramente menor que el referencial para mantener un margen positivo
  // pero pequeño en la ejecutora.
  const sugerirPrecios = () => {
    if (!form) return;
    const real = Number(form.precio_real_unitario || 0);
    const ref  = Number(form.precio_referencial_contrato || 0);
    if (!(real > 0 && ref > real)) {
      showToast('Ingresá precio real y precio referencial (ref > real)', 'red');
      return;
    }
    const eslabones = form.eslabones || [];
    if (eslabones.length === 0) { showToast('Agregá al menos 1 eslabón', 'red'); return; }
    const margenObjetivoEjecutora = 0.05; // 5% remanente en la ejecutora
    const precioCargaObra = ref * (1 - margenObjetivoEjecutora);
    // El precio del último eslabón = precio que paga la ejecutora = precioCargaObra.
    // Los eslabones intermedios distribuyen markup proporcional.
    const N = eslabones.length;
    const margenes = eslabones.map((es, i) => {
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
    showToast(`Precios sugeridos. Precio final ${precioCargaObra.toFixed(2)}, ejecutora deja ${(margenObjetivoEjecutora*100).toFixed(0)}% aparente.`, 'green');
  };

  const openNueva = () => {
    if (companiesActivas.length === 0) {
      showToast('Necesitás registrar al menos 1 empresa activa', 'red');
      return;
    }
    setForm({
      obra_id: obras?.find(o => !o.deleted_at)?.id || '',
      fecha: new Date().toISOString().slice(0,10),
      item_nombre: '',
      cantidad: '',
      unidad: 'kg',
      proveedor_externo_nombre: '',
      proveedor_externo_ruc: '',
      precio_real_unitario: '',
      precio_referencial_contrato: '',
      eslabones: [
        { company_id: companiesActivas[0]?.id || '', precio_unit: '', factura: '', fecha_op: new Date().toISOString().slice(0,10) },
      ],
      ejecutora_company_id: '',
      estado: 'borrador',
      notas: '',
    });
    setEditingId(null);
    setModal(true);
  };

  const openEditar = (c) => {
    setForm({
      obra_id: c.obra_id || '',
      fecha: c.fecha || new Date().toISOString().slice(0,10),
      item_nombre: c.item_nombre || '',
      cantidad: c.cantidad ?? '',
      unidad: c.unidad || 'kg',
      proveedor_externo_nombre: c.proveedor_externo_nombre || '',
      proveedor_externo_ruc: c.proveedor_externo_ruc || '',
      precio_real_unitario: c.precio_real_unitario ?? '',
      precio_referencial_contrato: c.precio_referencial_contrato ?? '',
      eslabones: c.eslabones?.length ? c.eslabones : [{ company_id:'', precio_unit:'', factura:'', fecha_op: c.fecha }],
      ejecutora_company_id: c.ejecutora_company_id || '',
      estado: c.estado || 'borrador',
      notas: c.notas || '',
    });
    setEditingId(c.id);
    setModal(true);
  };

  const guardar = async () => {
    if (!form.obra_id) { showToast('Seleccioná la obra destino', 'red'); return; }
    if (!form.item_nombre?.trim()) { showToast('Falta el nombre del ítem', 'red'); return; }
    const cant = Number(form.cantidad);
    if (!(cant > 0)) { showToast('Cantidad inválida', 'red'); return; }
    const eslabones = (form.eslabones || []).filter(e => e.company_id && Number(e.precio_unit) > 0);
    if (eslabones.length === 0) { showToast('Agregá al menos 1 eslabón con empresa y precio', 'red'); return; }

    const ejecutora = form.ejecutora_company_id || eslabones[eslabones.length - 1].company_id;
    const now = new Date().toISOString();
    try {
      if (editingId) {
        const orig = await window.__db.trazabilidad_cadenas.get(editingId);
        await window.__db.trazabilidad_cadenas.update(editingId, {
          obra_id: form.obra_id,
          fecha: form.fecha,
          item_nombre: form.item_nombre.trim(),
          cantidad: cant,
          unidad: form.unidad || null,
          proveedor_externo_nombre: form.proveedor_externo_nombre?.trim() || null,
          proveedor_externo_ruc: form.proveedor_externo_ruc?.trim() || null,
          precio_real_unitario: Number(form.precio_real_unitario) || 0,
          precio_referencial_contrato: Number(form.precio_referencial_contrato) || 0,
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
        const rec = {
          id,
          obra_id: form.obra_id,
          fecha: form.fecha,
          item_nombre: form.item_nombre.trim(),
          cantidad: cant,
          unidad: form.unidad || null,
          proveedor_externo_nombre: form.proveedor_externo_nombre?.trim() || null,
          proveedor_externo_ruc: form.proveedor_externo_ruc?.trim() || null,
          precio_real_unitario: Number(form.precio_real_unitario) || 0,
          precio_referencial_contrato: Number(form.precio_referencial_contrato) || 0,
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
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_chain_${id}`,
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
          <CadenaVisual cadena={verCadena} lookupCompany={lookupCompany} lookupObra={lookupObra} calcular={calcular}/>
        </Modal>
      )}

      {/* ── MODAL CREAR/EDITAR ───────────────────────────────── */}
      {modal && form && (
        <Modal title={editingId ? 'Editar Cadena' : 'Nueva Cadena de Trazabilidad'} icon="compare" onClose={()=>{setModal(false); setEditingId(null); setForm(null);}} wide>
          <div className="g2">
            <div>
              <label className="flabel">Obra destino *</label>
              <select className="fi" value={form.obra_id||''} onChange={e=>setForm({...form, obra_id:e.target.value})}>
                <option value="">— Seleccionar —</option>
                {(obras||[]).filter(o => !o.deleted_at).map(o => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}
              </select>
            </div>
            <div>
              <label className="flabel">Fecha</label>
              <input className="fi" type="date" value={form.fecha||''} onChange={e=>setForm({...form, fecha:e.target.value})}/>
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <label className="flabel">Ítem (material o servicio) *</label>
              <input className="fi" value={form.item_nombre||''} onChange={e=>setForm({...form, item_nombre:e.target.value})} placeholder="Ej: Fierro corrugado 1/2&quot; ASTM A615 G60"/>
            </div>
            <div>
              <label className="flabel">Cantidad *</label>
              <input className="fi" type="number" min="0" step="0.01" value={form.cantidad ?? ''} onChange={e=>setForm({...form, cantidad:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Unidad</label>
              <select className="fi" value={form.unidad||'kg'} onChange={e=>setForm({...form, unidad:e.target.value})}>
                <option value="kg">kg</option><option value="m">m</option>
                <option value="m2">m²</option><option value="m3">m³</option>
                <option value="und">und</option><option value="bls">bls</option>
                <option value="gal">gal</option><option value="hr">hr</option>
              </select>
            </div>

            {/* ── Origen externo + Presupuesto referencial ── */}
            <div style={{ gridColumn:'1/-1', marginTop:6, fontSize:11, color:'var(--blue)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', borderTop:'1px dashed var(--border)', paddingTop:10 }}>
              Origen y referencia
            </div>
            <div>
              <label className="flabel">Proveedor externo (real)</label>
              <input className="fi" value={form.proveedor_externo_nombre||''} onChange={e=>setForm({...form, proveedor_externo_nombre:e.target.value})} placeholder="Aceros Arequipa"/>
            </div>
            <div>
              <label className="flabel">RUC proveedor</label>
              <input className="fi" maxLength={11} value={form.proveedor_externo_ruc||''} onChange={e=>setForm({...form, proveedor_externo_ruc:e.target.value.replace(/\D/g,'').slice(0,11)})}/>
            </div>
            <div>
              <label className="flabel">Precio REAL unitario (S/) *</label>
              <input className="fi" type="number" min="0" step="0.01" value={form.precio_real_unitario ?? ''} onChange={e=>setForm({...form, precio_real_unitario:e.target.value})} placeholder="5.00"/>
              <div style={{ fontSize:10, color:'var(--tm)', marginTop:3 }}>Lo que pagó la primera empresa del grupo al proveedor externo.</div>
            </div>
            <div>
              <label className="flabel">Precio referencial contrato (S/) *</label>
              <input className="fi" type="number" min="0" step="0.01" value={form.precio_referencial_contrato ?? ''} onChange={e=>setForm({...form, precio_referencial_contrato:e.target.value})} placeholder="25.00"/>
              <div style={{ fontSize:10, color:'var(--tm)', marginTop:3 }}>El precio del cliente final / presupuesto contractual.</div>
            </div>

            {/* ── Eslabones ── */}
            <div style={{ gridColumn:'1/-1', marginTop:6, fontSize:11, color:'var(--amber)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', borderTop:'1px dashed var(--border)', paddingTop:10, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span>Eslabones del grupo (orden = flujo)</span>
              <button type="button" className="btn btn-ghost btn-xs" onClick={sugerirPrecios} title="Distribuir markup automáticamente según margen objetivo de cada empresa">
                <JxIcon name="refresh" size={11}/> Sugerir precios
              </button>
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              {(form.eslabones || []).map((es, i) => {
                const arr = form.eslabones || [];
                const ant = i === 0 ? Number(form.precio_real_unitario || 0) : Number(arr[i-1]?.precio_unit || 0);
                const cur = Number(es.precio_unit || 0);
                const markupPct = ant > 0 ? ((cur - ant) / ant * 100) : 0;
                const co = lookupCompany(es.company_id);
                return (
                  <div key={i} style={{ display:'grid', gridTemplateColumns:'24px 2fr 1fr 1fr 1fr 32px', gap:8, alignItems:'center', marginBottom:8, padding:'8px 10px', background:'rgba(255,255,255,0.025)', border:'1px solid var(--border)', borderRadius:8 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'var(--amber)', textAlign:'center' }}>#{i+1}</div>
                    <select className="fi" value={es.company_id||''} onChange={e=>{
                      const nuevos = [...arr]; nuevos[i] = { ...nuevos[i], company_id: e.target.value };
                      setForm({ ...form, eslabones: nuevos });
                    }}>
                      <option value="">— Empresa —</option>
                      {companiesActivas.map(c => <option key={c.id} value={c.id}>{c.name}{c.rol_grupo?` · ${c.rol_grupo}`:''}</option>)}
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
              const cant = Number(form.cantidad || 0);
              const real = Number(form.precio_real_unitario || 0);
              const ref = Number(form.precio_referencial_contrato || 0);
              const last = (form.eslabones || []).filter(e => e.precio_unit).slice(-1)[0];
              const final = Number(last?.precio_unit || 0);
              if (!(cant > 0 && real > 0 && final > 0)) return null;
              const costoReal = real * cant;
              const cargado = final * cant;
              const presup = ref * cant;
              return (
                <div style={{ gridColumn:'1/-1', background:'rgba(46,204,113,0.06)', border:'1px solid rgba(46,204,113,0.25)', borderRadius:8, padding:'12px 14px', fontSize:12 }}>
                  <div style={{ fontSize:11, color:'var(--green)', fontWeight:700, textTransform:'uppercase', marginBottom:8 }}>Resumen en vivo</div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10 }}>
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
    </div>
  );
}

// Componente visual de una cadena (para el modal de detalle).
function CadenaVisual({ cadena, lookupCompany, lookupObra, calcular }) {
  const r = calcular(cadena);
  const obra = lookupObra(cadena.obra_id);
  const eslabones = cadena.eslabones || [];
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
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
        <Box titulo="Externo" sub={cadena.proveedor_externo_nombre || 'Proveedor externo'} precio={r.precioReal} total={r.costoTotalReal} color="#3498DB"/>
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
                  precio={cur}
                  total={cur * r.cant}
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
        <Box titulo="Cliente final" sub="Presupuesto contractual" precio={r.presup} total={r.presupTotal} color="#9B59B6"/>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 }}>
        <div className="kpi-card">
          <div style={{ fontSize:10.5, color:'var(--tm)' }}>Ganancia grupo (real)</div>
          <div style={{ fontSize:18, fontWeight:800, color: r.gananciaGrupoReal>=0?'var(--green)':'var(--red)' }}>{fmtCur(r.gananciaGrupoReal)}</div>
          <div style={{ fontSize:10, color:'var(--tm)' }}>cargado − real</div>
        </div>
        <div className="kpi-card">
          <div style={{ fontSize:10.5, color:'var(--tm)' }}>Ganancia ejecutora (aparente)</div>
          <div style={{ fontSize:18, fontWeight:800, color: r.gananciaEjecutoraAparente>=0?'var(--green)':'var(--red)' }}>{fmtCur(r.gananciaEjecutoraAparente)}</div>
          <div style={{ fontSize:10, color:'var(--tm)' }}>{r.presupTotal>0 ? `${(r.gananciaEjecutoraAparente/r.presupTotal*100).toFixed(1)}% del presupuesto` : '—'}</div>
        </div>
        <div className="kpi-card">
          <div style={{ fontSize:10.5, color:'var(--tm)' }}>Ganancia total efectiva</div>
          <div style={{ fontSize:18, fontWeight:800, color: r.gananciaTotalEfectiva>=0?'var(--green)':'var(--red)' }}>{fmtCur(r.gananciaTotalEfectiva)}</div>
          <div style={{ fontSize:10, color:'var(--tm)' }}>presupuesto − costo real</div>
        </div>
      </div>
      {cadena.notas && (
        <div style={{ fontSize:11.5, color:'var(--ts)', padding:'8px 10px', background:'rgba(255,255,255,0.025)', border:'1px solid var(--border)', borderRadius:6 }}>
          <strong>Notas:</strong> {cadena.notas}
        </div>
      )}
    </div>
  );
}

Object.assign(window, {
  EmpresasPage, MovimientosContablesPage, IntercompanyPage,
  ContabilidadDashboardPage, ConsolidadoPage,
  TrazabilidadPage,
});
