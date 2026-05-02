import React from "react";
import { listAuditLogs } from "../lib/audit";
const { useState: uSAd, useMemo: uMAd, useEffect: uEAd } = React;

// ── Constantes ────────────────────────────────────────────
const ROL_LABELS = {
  admin:               'Admin',
  gerente:             'Gerente',
  ingeniero_residente: 'Ing. Residente',
  supervisor:          'Supervisor',
  almacenero:          'Almacenero',
  asistente_admin:     'Asist. Admin',
  solo_lectura:        'Solo Lectura',
};

const ROL_COLORS_ADM = {
  admin:               'b-red',
  gerente:             'b-blue',
  ingeniero_residente: 'b-amber',
  supervisor:          'b-blue',
  almacenero:          'b-green',
  asistente_admin:     'b-blue',
  solo_lectura:        'b-gray',
};

const ROL_KEYS = ['admin','gerente','ingeniero_residente','supervisor','almacenero','asistente_admin','solo_lectura'];

// ── Roles Custom (definidos por el admin, persistidos en localStorage) ──
// Cada rol custom: { key, label, color }
//   - key   : identificador único en snake_case (no debe colisionar con ROL_KEYS)
//   - label : nombre legible
//   - color : una de las clases b-* o color hex (default: b-gray)
const CUSTOM_ROLES_KEY = 'jx_custom_roles_v1';
function loadCustomRoles() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_ROLES_KEY) || '[]'); }
  catch { return []; }
}
function saveCustomRoles(list) {
  try { localStorage.setItem(CUSTOM_ROLES_KEY, JSON.stringify(list)); } catch {}
  try { window.dispatchEvent(new CustomEvent('jx_roles_changed', { detail: list })); } catch {}
}
function getAllRolKeys() {
  const customs = loadCustomRoles().map(r => r.key);
  return [...ROL_KEYS, ...customs];
}
function getAllRolLabels() {
  const labels = { ...ROL_LABELS };
  loadCustomRoles().forEach(r => { labels[r.key] = r.label; });
  return labels;
}
function getAllRolColors() {
  const colors = { ...ROL_COLORS_ADM };
  loadCustomRoles().forEach(r => { colors[r.key] = r.color || 'b-gray'; });
  return colors;
}

// Exponer para otros componentes
window.__roles = {
  loadCustomRoles, saveCustomRoles,
  getAllRolKeys, getAllRolLabels, getAllRolColors,
};

const initialsOf = (n='', a='') => ((n[0]||'') + (a[0]||'')).toUpperCase() || '??';

// ── USUARIOS PAGE ─────────────────────────────────────────
function UsuariosPage({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : {};
  const myRol = auth?.profile?.rol;
  const myId  = auth?.profile?.id;
  const isAdmin = myRol === 'admin';

  const [profiles, setProfiles] = uSAd([]);
  const [obraUsuarios, setObraUsuarios] = uSAd([]);
  const [loading, setLoading] = uSAd(true);
  const [search, setSearch] = uSAd('');
  const [modalNew, setModalNew] = uSAd(false);
  const [modalRol, setModalRol] = uSAd(null);
  const [form, setForm] = uSAd({ email:'', password:'', nombres:'', apellidos:'', rol:'solo_lectura' });
  const [busy, setBusy] = uSAd(false);

  const reload = async () => {
    try {
      const sb = window.__supabase;
      if (!sb) { setLoading(false); return; }
      const [{ data: p }, { data: ou }] = await Promise.all([
        sb.from('profiles').select('*').order('apellidos'),
        sb.from('obra_usuarios').select('id, obra_id, usuario_id, activo'),
      ]);
      setProfiles(p || []);
      setObraUsuarios(ou || []);
    } catch (e) { console.warn('UsuariosPage reload', e); }
    finally { setLoading(false); }
  };

  uEAd(() => {
    reload();
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, []);

  const obrasPorUsuario = uMAd(() => {
    const m = {};
    (obraUsuarios||[]).forEach(o => {
      if (o.activo === false) return;
      m[o.usuario_id] = (m[o.usuario_id] || 0) + 1;
    });
    return m;
  }, [obraUsuarios]);

  const filtered = uMAd(() => {
    const q = search.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter(p =>
      (`${p.nombres||''} ${p.apellidos||''}`).toLowerCase().includes(q) ||
      (p.email||'').toLowerCase().includes(q)
    );
  }, [profiles, search]);

  const stats = uMAd(() => {
    const total = profiles.length;
    const activos = profiles.filter(p => p.activo !== false).length;
    const porRol = {};
    ROL_KEYS.forEach(r => { porRol[r] = profiles.filter(p => p.rol === r).length; });
    return { total, activos, porRol };
  }, [profiles]);

  const handleCreate = async () => {
    if (!form.email || !form.password) { showToast?.('Email y password requeridos','red'); return; }
    if (form.password.length < 8) { showToast?.('Mínimo 8 caracteres','red'); return; }
    setBusy(true);
    try {
      const sb = window.__supabase;

      // 1. Guardar la sesión del admin — signUp puede auto-loguear al usuario nuevo
      //    y reemplazar la sesión actual, lo que rompería el UPDATE posterior bajo RLS.
      const { data: { session: adminSession } } = await sb.auth.getSession();

      // 2. Crear el usuario en auth.users (el trigger handle_new_user crea el row en profiles)
      const { data: signUpData, error: signUpErr } = await sb.auth.signUp({
        email: form.email,
        password: form.password,
        options: { data: { nombres: form.nombres, apellidos: form.apellidos } }
      });
      if (signUpErr) throw signUpErr;
      const newUserId = signUpData?.user?.id;
      if (!newUserId) throw new Error('No se obtuvo el ID del usuario creado');

      // 3. Restaurar la sesión del admin (si signUp la reemplazó)
      if (adminSession?.access_token && adminSession?.refresh_token) {
        const { data: { session: nowSession } } = await sb.auth.getSession();
        if (nowSession?.user?.id !== adminSession.user.id) {
          await sb.auth.setSession({
            access_token: adminSession.access_token,
            refresh_token: adminSession.refresh_token,
          });
        }
      }

      // 4. Esperar a que el trigger cree el row en profiles (puede tardar ms)
      let profileExists = false;
      for (let i = 0; i < 15; i++) {
        const { data: prof } = await sb.from('profiles').select('id').eq('id', newUserId).maybeSingle();
        if (prof) { profileExists = true; break; }
        await new Promise(r => setTimeout(r, 250));
      }

      // 5. Hacer el upsert/update con nombres, apellidos y rol — siempre por id
      const profileData = {
        id: newUserId,
        email: form.email,
        nombres: form.nombres || null,
        apellidos: form.apellidos || null,
        rol: form.rol || 'solo_lectura',
        activo: true,
      };
      const { error: upErr } = profileExists
        ? await sb.from('profiles').update({
            nombres: profileData.nombres,
            apellidos: profileData.apellidos,
            rol: profileData.rol,
          }).eq('id', newUserId)
        : await sb.from('profiles').upsert(profileData, { onConflict: 'id' });
      if (upErr) throw upErr;

      showToast?.('Usuario creado','green');
      setModalNew(false);
      setForm({ email:'', password:'', nombres:'', apellidos:'', rol:'solo_lectura' });
      reload();
    } catch (e) {
      showToast?.('Error: ' + (e.message || e),'red');
    } finally { setBusy(false); }
  };

  const handleChangeRol = async (newRol) => {
    if (!modalRol) return;
    setBusy(true);
    try {
      const sb = window.__supabase;
      const { data, error } = await sb
        .from('profiles')
        .update({ rol: newRol })
        .eq('id', modalRol.id)
        .select();
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('No se pudo actualizar (sin permisos o RLS bloqueó la operación)');
      }
      showToast?.('Rol actualizado','green');
      setModalRol(null);
      reload();
    } catch (e) { showToast?.('Error: ' + (e.message||e),'red'); }
    finally { setBusy(false); }
  };

  const handleToggleActivo = async (u) => {
    if (u.id === myId) { showToast?.('No puedes desactivarte a ti mismo','amber'); return; }
    try {
      const sb = window.__supabase;
      const newVal = !(u.activo !== false);
      const { error } = await sb.from('profiles').update({ activo: newVal }).eq('id', u.id);
      if (error) throw error;
      showToast?.(newVal ? 'Usuario activado' : 'Usuario desactivado', 'green');
      reload();
    } catch (e) { showToast?.('Error: ' + (e.message||e),'red'); }
  };

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Usuarios</div>
          <div className="pg-sub">{stats.total} usuarios · {stats.activos} activos {!isAdmin && '· solo lectura'}</div>
        </div>
        {isAdmin && (
          <button className="btn btn-amber btn-sm" onClick={()=>setModalNew(true)}>
            <JxIcon name="plus" size={13}/>Nuevo Usuario
          </button>
        )}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:18 }}>
        {[
          { label:'Total Usuarios', val:stats.total, color:'var(--blue)' },
          { label:'Activos', val:stats.activos, color:'var(--green)' },
          { label:'Admins', val:stats.porRol.admin||0, color:'var(--red)' },
          { label:'Roles distintos', val:Object.values(stats.porRol).filter(v=>v>0).length, color:'var(--amber)' },
        ].map((s,i)=>(
          <div key={i} className="card card-p">
            <div style={{ fontSize:11, color:'var(--tm)' }}>{s.label}</div>
            <div style={{ fontSize:26, fontWeight:800, color:s.color, margin:'4px 0' }}>{s.val}</div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom:12 }}>
        <input className="fi" placeholder="Buscar por nombre o email..." value={search}
               onChange={e=>setSearch(e.target.value)} style={{ maxWidth:360 }}/>
      </div>

      {loading ? (
        <div className="card card-p" style={{ textAlign:'center', color:'var(--tm)' }}>Cargando usuarios...</div>
      ) : filtered.length === 0 ? (
        <div className="card card-p" style={{ textAlign:'center', color:'var(--tm)' }}>
          {profiles.length === 0 ? 'Sin usuarios registrados' : 'Sin resultados para la búsqueda'}
        </div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <table className="tbl">
            <thead><tr>
              <th>Usuario</th><th>Email</th><th>Rol</th><th>Estado</th><th>Obras</th><th>Acciones</th>
            </tr></thead>
            <tbody>
              {filtered.map(u => {
                const activo = u.activo !== false;
                const obras = obrasPorUsuario[u.id] || 0;
                const isMe = u.id === myId;
                return (
                  <tr key={u.id}>
                    <td>
                      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                        <div style={{ width:32, height:32, borderRadius:'50%', background:'rgba(242,183,5,0.15)', border:'1.5px solid rgba(242,183,5,0.3)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:'var(--amber)', flexShrink:0 }}>
                          {initialsOf(u.nombres, u.apellidos)}
                        </div>
                        <span className="col-p">{u.nombres||''} {u.apellidos||''}{isMe && <span style={{ color:'var(--tm)', marginLeft:6, fontSize:11 }}>(tú)</span>}</span>
                      </div>
                    </td>
                    <td className="col-m">{u.email}</td>
                    <td><span className={`badge ${getAllRolColors()[u.rol]||'b-gray'}`}>{getAllRolLabels()[u.rol]||u.rol||'—'}</span></td>
                    <td><span className={`badge ${activo?'b-green':'b-gray'}`}>{activo?'Activo':'Inactivo'}</span></td>
                    <td className="col-m">{obras}</td>
                    <td>
                      <div style={{ display:'flex', gap:4 }}>
                        {isAdmin ? (
                          <>
                            <button className="btn btn-ghost btn-xs" title="Cambiar Rol"
                                    disabled={isMe} onClick={()=>setModalRol(u)}>
                              <JxIcon name="edit" size={11}/>
                            </button>
                            <button className={`btn ${activo?'btn-red':'btn-green'} btn-xs`} title={activo?'Desactivar':'Activar'}
                                    disabled={isMe} onClick={()=>handleToggleActivo(u)}>
                              <JxIcon name={activo?'lock':'check'} size={11}/>
                            </button>
                          </>
                        ) : <span style={{ fontSize:11, color:'var(--tm)' }}>—</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalNew && (
        <Modal title="Nuevo Usuario" icon="user" onClose={()=>setModalNew(false)}>
          <div className="g2">
            <div><label className="flabel">Nombres *</label>
              <input className="fi" value={form.nombres} onChange={e=>setForm({...form, nombres:e.target.value})}/></div>
            <div><label className="flabel">Apellidos *</label>
              <input className="fi" value={form.apellidos} onChange={e=>setForm({...form, apellidos:e.target.value})}/></div>
            <div><label className="flabel">Email *</label>
              <input className="fi" type="email" value={form.email} onChange={e=>setForm({...form, email:e.target.value})}/></div>
            <div><label className="flabel">Password * (mín 8)</label>
              <input className="fi" type="password" value={form.password} onChange={e=>setForm({...form, password:e.target.value})}/></div>
            <div style={{ gridColumn:'1 / -1' }}>
              <label className="flabel">Rol</label>
              <select className="fi" value={form.rol} onChange={e=>setForm({...form, rol:e.target.value})}>
                {getAllRolKeys().map(r => <option key={r} value={r}>{getAllRolLabels()[r]}</option>)}
              </select>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>setModalNew(false)}>Cancelar</button>
            <button className="btn btn-amber" disabled={busy} onClick={handleCreate}>
              <JxIcon name="check" size={13}/>{busy?'Creando...':'Crear Usuario'}
            </button>
          </div>
        </Modal>
      )}

      {modalRol && (
        <Modal title={`Cambiar Rol: ${modalRol.nombres||''} ${modalRol.apellidos||''}`} icon="edit" onClose={()=>setModalRol(null)}>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            <div style={{ fontSize:12, color:'var(--tm)', marginBottom:8 }}>Rol actual: <strong style={{ color:'var(--ts)' }}>{getAllRolLabels()[modalRol.rol]||modalRol.rol||'—'}</strong></div>
            {getAllRolKeys().map(r => (
              <button key={r} className={`btn ${r===modalRol.rol?'btn-amber':'btn-ghost'}`}
                      disabled={busy}
                      onClick={()=>handleChangeRol(r)}
                      style={{ justifyContent:'flex-start' }}>
                <span className={`badge ${getAllRolColors()[r]||'b-gray'}`} style={{ marginRight:8 }}>{getAllRolLabels()[r]}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── ROLES Y PERMISOS PAGE (matriz informativa) ────────────
// Estructura por grupos para UX. PERM_MATRIX_MODULES es array plano
// (compatible con código existente); MODULE_GROUPS define cómo
// renderizar la tabla con separadores.
const MODULE_GROUPS = [
  { group: 'Operaciones diarias', modules: ['Obras','Personal','Asistencia','Materiales','Mov. Materiales','Herramientas','Mov. Herramientas','Proveedores'] },
  { group: 'Gestión de obra', modules: ['Partidas','Insumos','Versiones presupuesto','Cronograma','Avance','Comparativo','Costos','Valorizaciones','Incidencias','Evidencias'] },
  { group: 'Compras / Logística', modules: ['Requisiciones','Órdenes de Compra','Cotizaciones','Recepciones'] },
  { group: 'Subcontratos', modules: ['Subcontratistas','Subcontratos','Valor. Subcontrato'] },
  { group: 'Maquinaria', modules: ['Activos Pesados','Mantenimiento','Horas Máquina'] },
  { group: 'SSOMA', modules: ['Charlas Seguridad','IPERC','EPP','Inspecciones SSOMA','Capacitaciones'] },
  { group: 'RRHH', modules: ['Contratos Laborales','Planillas','CTS','Gratificaciones'] },
  { group: 'Contabilidad', modules: ['Empresas','Movs. Contables','Intercompany','Consolidado','Plan de Cuentas','Libro Diario','Balance General','Estado Resultados'] },
  { group: 'Tesorería', modules: ['Cuentas Bancarias','Flujo de Caja','Flujo Proyectado','Comparativo Periodos'] },
  { group: 'SUNAT', modules: ['Comprobantes Electrónicos','Libros Electrónicos','PLAME / T-Registro','Config SUNAT'] },
  { group: 'Ejecutivo / Reportes', modules: ['Dashboard Ejecutivo','KPIs por Obra','Cumplimiento Cronograma','Centro Alertas','Búsqueda Global','Reportes'] },
  { group: 'Administración', modules: ['Importar','Solicitudes Cambio','Conflictos Sync','Auditoría','Usuarios/Config'] },
];

const PERM_MATRIX_MODULES = MODULE_GROUPS.flatMap(g => g.modules);

// Helpers para clasificar módulos
const READ_DEFAULT_RO = new Set(PERM_MATRIX_MODULES);

// 'w' = write/edit, 'r' = read only, 'x' = no access
const PERM_MATRIX = {
  // Admin: w en todo
  admin: PERM_MATRIX_MODULES.map(() => 'w'),

  // Gerente: w en gestión de obra, contabilidad, tesorería, SUNAT, ejecutivo;
  // r en resto; x solo en Usuarios/Config
  gerente: PERM_MATRIX_MODULES.map(m => {
    if (m === 'Usuarios/Config') return 'x';
    const wList = [
      'Obras','Personal','Partidas','Avance','Comparativo','Costos','Valorizaciones',
      // Compras: el gerente aprueba requisiciones y firma OC
      'Requisiciones','Órdenes de Compra','Cotizaciones','Recepciones','Proveedores',
      'Subcontratistas','Subcontratos','Valor. Subcontrato','Activos Pesados',
      'Empresas','Movs. Contables','Intercompany','Consolidado','Plan de Cuentas',
      'Libro Diario','Balance General','Estado Resultados',
      'Cuentas Bancarias','Flujo de Caja','Flujo Proyectado','Comparativo Periodos',
      'Comprobantes Electrónicos','Libros Electrónicos','PLAME / T-Registro','Config SUNAT',
      'Dashboard Ejecutivo','KPIs por Obra','Cumplimiento Cronograma','Centro Alertas',
      'Reportes','Auditoría','Solicitudes Cambio',
    ];
    return wList.includes(m) ? 'w' : 'r';
  }),

  // Ing. Residente: w en operaciones de obra, SSOMA y partidas; r resto; x Contabilidad/SUNAT/Usuarios
  ingeniero_residente: PERM_MATRIX_MODULES.map(m => {
    if (m === 'Usuarios/Config') return 'x';
    if (['Empresas','Intercompany','Consolidado','Libro Diario','Balance General','Estado Resultados',
         'Cuentas Bancarias','Flujo de Caja','Comprobantes Electrónicos','Libros Electrónicos',
         'PLAME / T-Registro','Config SUNAT'].includes(m)) return 'x';
    if (['Personal','Asistencia','Partidas','Insumos','Cronograma','Avance','Comparativo',
         'Valorizaciones','Subcontratos','Valor. Subcontrato','Mantenimiento','Horas Máquina',
         'Charlas Seguridad','IPERC','EPP','Inspecciones SSOMA','Capacitaciones',
         'Incidencias','Evidencias','Requisiciones','KPIs por Obra','Cumplimiento Cronograma'].includes(m)) return 'w';
    return 'r';
  }),

  // Supervisor: w asistencia, movimientos, avance, evidencias; r resto operativo; x Contabilidad/SUNAT
  supervisor: PERM_MATRIX_MODULES.map(m => {
    if (m === 'Usuarios/Config') return 'x';
    if (['Costos','Empresas','Intercompany','Consolidado','Libro Diario','Balance General',
         'Estado Resultados','Plan de Cuentas','Cuentas Bancarias','Flujo de Caja',
         'Flujo Proyectado','Comparativo Periodos','Movs. Contables','Comprobantes Electrónicos',
         'Libros Electrónicos','PLAME / T-Registro','Config SUNAT','Planillas','CTS','Gratificaciones',
         'Contratos Laborales'].includes(m)) return 'x';
    if (['Asistencia','Mov. Materiales','Mov. Herramientas','Avance','Evidencias','Incidencias',
         'Charlas Seguridad','IPERC','EPP','Inspecciones SSOMA','Horas Máquina'].includes(m)) return 'w';
    return 'r';
  }),

  // Almacenero: w en almacén + EPP (entrega); r en compras/maquinaria/personal/asistencia;
  // x en gestión presupuestal, contabilidad, RRHH, SUNAT, ejecutivo, auditoría
  almacenero: PERM_MATRIX_MODULES.map(m => {
    if (m === 'Usuarios/Config') return 'x';
    // Write: lo que el almacenero ejecuta directamente
    if (['Materiales','Mov. Materiales','Herramientas','Mov. Herramientas','Recepciones','EPP'].includes(m)) return 'w';
    // Lectura: lo que necesita consultar para hacer su trabajo
    if (['Requisiciones','Órdenes de Compra','Cotizaciones','Proveedores','Personal','Asistencia',
         'Activos Pesados','Mantenimiento','Horas Máquina','Evidencias','Incidencias'].includes(m)) return 'r';
    // Resto (RRHH, contabilidad, SUNAT, ejecutivo, SSOMA distinto a EPP, auditoría) → sin acceso
    return 'x';
  }),

  // Asistente Admin: w en personal/proveedores/asistencia/SUNAT comprobantes; r contabilidad
  asistente_admin: PERM_MATRIX_MODULES.map(m => {
    if (m === 'Usuarios/Config') return 'x';
    if (['Costos','Plan de Cuentas','Libro Diario','Balance General','Estado Resultados',
         'Empresas','Intercompany','Config SUNAT'].includes(m)) return 'x';
    if (['Personal','Asistencia','Proveedores','Subcontratistas','Contratos Laborales','Planillas',
         'CTS','Gratificaciones','Comprobantes Electrónicos','PLAME / T-Registro',
         'Movs. Contables','Cuentas Bancarias','Solicitudes Cambio','Importar'].includes(m)) return 'w';
    return 'r';
  }),

  // Solo lectura: r en todo, x en admin/config/auditoría
  solo_lectura: PERM_MATRIX_MODULES.map(m => {
    if (['Usuarios/Config','Auditoría','Config SUNAT','Importar'].includes(m)) return 'x';
    return 'r';
  }),
};

// Storage local de overrides de permisos por rol (UI-level)
const PERM_STORAGE_KEY = 'jx_perm_overrides_v1';
function loadPermOverrides() {
  try { return JSON.parse(localStorage.getItem(PERM_STORAGE_KEY) || '{}'); }
  catch { return {}; }
}
function savePermOverrides(obj) {
  try { localStorage.setItem(PERM_STORAGE_KEY, JSON.stringify(obj)); } catch {}
  try { window.dispatchEvent(new CustomEvent('jx_perms_changed', { detail: obj })); } catch {}
}
// Devuelve la matriz efectiva: defaults + overrides aplicados
// Incluye roles built-in + custom (custom default = solo lectura en todo)
function getEffectivePermMatrix() {
  const ov = loadPermOverrides();
  const out = {};
  const todasKeys = getAllRolKeys();
  todasKeys.forEach(r => {
    // Custom roles → default todo en 'r' (solo lectura), excepto Usuarios/Config en 'x'
    const baseDefault = ROL_KEYS.includes(r)
      ? (PERM_MATRIX[r] || PERM_MATRIX_MODULES.map(()=>'r')).slice()
      : PERM_MATRIX_MODULES.map(m => m === 'Usuarios/Config' ? 'x' : 'r');
    const rolOv = ov[r] || {};
    PERM_MATRIX_MODULES.forEach((mod, i) => {
      if (rolOv[mod] && ['w','r','x'].includes(rolOv[mod])) baseDefault[i] = rolOv[mod];
    });
    out[r] = baseDefault;
  });
  return out;
}
// Exponer para que otras pantallas puedan consultar
window.__getEffectivePermMatrix = getEffectivePermMatrix;

// Mapping de id de sidebar → módulo en la matriz de permisos.
// Si el módulo es null/undefined, la página NO está en la matriz y se considera
// visible para todos (utilities como dashboard, búsqueda, importar, configuración
// que tiene tabs internas filtradas por rol).
window.__moduleIdMap = {
  // Operaciones
  'obras': 'Obras',
  'personal': 'Personal',
  'asistencia': 'Asistencia',
  'materiales': 'Materiales',
  'mov-materiales': 'Mov. Materiales',
  'herramientas': 'Herramientas',
  'mov-herramientas': 'Mov. Herramientas',
  'proveedores': 'Proveedores',
  // Gestión de obra
  'partidas': 'Partidas',
  'insumos': 'Insumos',
  'versiones': 'Versiones presupuesto',
  'cronograma': 'Cronograma',
  'avance': 'Avance',
  'comparativo': 'Comparativo',
  'costos': 'Costos',
  'valorizaciones': 'Valorizaciones',
  'incidencias': 'Incidencias',
  'evidencias': 'Evidencias',
  // Compras
  'solicitud-residente': 'Requisiciones',
  'requisiciones': 'Requisiciones',
  'ordenes-compra': 'Órdenes de Compra',
  // Subcontratos
  'subcontratistas': 'Subcontratistas',
  'subcontratos': 'Subcontratos',
  'subcontrato-valorizaciones': 'Valor. Subcontrato',
  // Maquinaria
  'activos-pesados': 'Activos Pesados',
  'mantenimiento-programado': 'Mantenimiento',
  // SSOMA
  'charlas-seguridad': 'Charlas Seguridad',
  'iperc': 'IPERC',
  'epp': 'EPP',
  'inspecciones-seguridad': 'Inspecciones SSOMA',
  'capacitaciones': 'Capacitaciones',
  // RRHH
  'personal-contratos': 'Contratos Laborales',
  'planillas': 'Planillas',
  'cts': 'CTS',
  'gratificaciones': 'Gratificaciones',
  'plame': 'PLAME / T-Registro',
  // Contabilidad
  'cont-dashboard': 'Movs. Contables',
  'empresas': 'Empresas',
  'movimientos-contables': 'Movs. Contables',
  'intercompany': 'Intercompany',
  'consolidado': 'Consolidado',
  'plan-cuentas': 'Plan de Cuentas',
  'libro-diario': 'Libro Diario',
  'balance-general': 'Balance General',
  'estado-resultados': 'Estado Resultados',
  // Tesorería
  'cuentas-bancarias': 'Cuentas Bancarias',
  'flujo-caja': 'Flujo de Caja',
  'flujo-proyectado': 'Flujo Proyectado',
  'comparativo-periodos': 'Comparativo Periodos',
  // SUNAT
  'comprobantes': 'Comprobantes Electrónicos',
  'libros-electronicos': 'Libros Electrónicos',
  'config-sunat': 'Config SUNAT',
  // Ejecutivo
  'dashboard-ejecutivo': 'Dashboard Ejecutivo',
  'kpis-obra': 'KPIs por Obra',
  'cumplimiento-cronograma': 'Cumplimiento Cronograma',
  'alertas': 'Centro Alertas',
  'reportes': 'Reportes',
  // Administración
  'audit-log': 'Auditoría',
  'conflictos': 'Conflictos Sync',
  'solicitudes': 'Solicitudes Cambio',
  'usuarios': 'Usuarios/Config',
  'roles': 'Usuarios/Config',
  'importar': 'Importar',
  // Items SIN restricción (utilities visibles para todos):
  'dashboard': null,
  'busqueda': null,
  'configuracion': null, // tabs internas se filtran solas
};

// Helper que devuelve si el rol puede ver el item del sidebar (lectura mínimo)
window.__canSeeSidebarItem = function(rol, itemId) {
  if (!rol) return true;
  if (rol === 'admin') return true;
  const modulo = window.__moduleIdMap?.[itemId];
  if (modulo === null || modulo === undefined) return true;
  return window.__hasPerm?.(rol, modulo, 'r') ?? true;
};
window.__hasPerm = function(rol, modulo, nivel = 'r') {
  if (!rol) return false;
  if (rol === 'admin') return true;
  const m = getEffectivePermMatrix()[rol] || [];
  const idx = PERM_MATRIX_MODULES.indexOf(modulo);
  if (idx < 0) return false;
  const v = m[idx];
  if (nivel === 'w') return v === 'w';
  if (nivel === 'r') return v === 'w' || v === 'r';
  return v !== 'x';
};

function RolesPage() {
  const [counts, setCounts] = uSAd({});
  const auth = window.__useAuth ? window.__useAuth() : {};
  const isAdmin = auth?.profile?.rol === 'admin';
  const appMode = window.__useAppMode ? window.__useAppMode() : { isPrueba: false, isEdicion: false };
  // Admin puede editar permisos en modo prueba O edición (modo prueba funciona igual que edición pero con data demo)
  const canEdit = isAdmin && (appMode.isPrueba || appMode.isEdicion);
  const [overrides, setOverrides] = uSAd(loadPermOverrides());
  const [customRoles, setCustomRoles] = uSAd(loadCustomRoles());
  const [showAddRole, setShowAddRole] = uSAd(false);
  const [newRoleForm, setNewRoleForm] = uSAd({ key:'', label:'', color:'b-gray' });
  const matrix = uMAd(() => getEffectivePermMatrix(), [overrides, customRoles]);
  const todasRolKeys = uMAd(() => getAllRolKeys(), [customRoles]);
  const todasRolLabels = uMAd(() => getAllRolLabels(), [customRoles]);
  const todasRolColors = uMAd(() => getAllRolColors(), [customRoles]);

  uEAd(() => {
    const load = async () => {
      try {
        const sb = window.__supabase;
        if (!sb) return;
        const { data } = await sb.from('profiles').select('rol');
        const c = {};
        todasRolKeys.forEach(r => { c[r] = (data||[]).filter(p=>p.rol===r).length; });
        setCounts(c);
      } catch (e) {}
    };
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [todasRolKeys.join(',')]);

  const crearRolCustom = () => {
    if (!canEdit) return;
    const key = (newRoleForm.key || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const label = (newRoleForm.label || '').trim();
    if (!key || !label) { alert('Ingresa key y nombre del rol'); return; }
    if (todasRolKeys.includes(key)) { alert(`Ya existe un rol con key "${key}"`); return; }
    const next = [...customRoles, { key, label, color: newRoleForm.color || 'b-gray' }];
    setCustomRoles(next);
    saveCustomRoles(next);
    try { window.__logAudit?.({ action:'insert', table:'roles_custom', recordId: key,
      newData:{ key, label, color: newRoleForm.color }, reason:'Creación de rol custom' }); } catch {}
    setShowAddRole(false);
    setNewRoleForm({ key:'', label:'', color:'b-gray' });
  };

  const eliminarRolCustom = (key) => {
    if (!canEdit) return;
    if (ROL_KEYS.includes(key)) { alert('No se pueden eliminar roles del sistema'); return; }
    const usuariosConRol = counts[key] || 0;
    if (usuariosConRol > 0) {
      if (!confirm(`Hay ${usuariosConRol} usuario(s) con este rol. Si lo eliminas tendrás que reasignarlos manualmente. ¿Continuar?`)) return;
    } else {
      if (!confirm(`¿Eliminar el rol "${todasRolLabels[key]}"?`)) return;
    }
    const next = customRoles.filter(r => r.key !== key);
    setCustomRoles(next);
    saveCustomRoles(next);
    // También limpiar overrides del rol borrado
    const ov = { ...overrides };
    delete ov[key];
    setOverrides(ov);
    savePermOverrides(ov);
    try { window.__logAudit?.({ action:'delete', table:'roles_custom', recordId: key,
      reason:'Eliminación de rol custom' }); } catch {}
  };

  const editarRolCustom = (key, patch) => {
    if (!canEdit) return;
    const next = customRoles.map(r => r.key === key ? { ...r, ...patch } : r);
    setCustomRoles(next);
    saveCustomRoles(next);
    try { window.__logAudit?.({ action:'update', table:'roles_custom', recordId: key,
      newData: patch, reason:'Edición de rol custom' }); } catch {}
  };

  const cycle = (rol, modIdx) => {
    if (!canEdit) return;
    if (rol === 'admin') return; // admin nunca pierde permisos
    const mod = PERM_MATRIX_MODULES[modIdx];
    const cur = matrix[rol][modIdx];
    const next = cur === 'w' ? 'r' : cur === 'r' ? 'x' : 'w';
    const ov = { ...overrides };
    ov[rol] = { ...(ov[rol] || {}), [mod]: next };
    setOverrides(ov);
    savePermOverrides(ov);
    try { window.__logAudit?.({ action:'update', table:'permisos', recordId:`${rol}:${mod}`,
      oldData:{ valor: cur }, newData:{ valor: next }, reason:`Cambio permiso ${rol} → ${mod}` }); } catch {}
  };

  const resetAll = () => {
    if (!canEdit) return;
    if (!confirm('¿Restaurar TODOS los permisos a los valores por defecto del sistema? Se eliminarán todas las personalizaciones.')) return;
    setOverrides({});
    savePermOverrides({});
    try { window.__logAudit?.({ action:'delete', table:'permisos', recordId:'all', reason:'Reset matriz de permisos a defaults' }); } catch {}
  };

  const tieneOverrides = uMAd(() => {
    return Object.keys(overrides).some(r => Object.keys(overrides[r] || {}).length > 0);
  }, [overrides]);

  const Cell = ({ v, rol, modIdx, custom }) => {
    const cursor = canEdit && rol !== 'admin' ? 'pointer' : 'default';
    const ring = custom ? 'inset 0 0 0 1px rgba(242,183,5,0.55)' : 'none';
    const onClick = () => cycle(rol, modIdx);
    const inner = v === 'w' ? (
      <span style={{ width:22, height:22, borderRadius:5, background:'rgba(46,204,113,0.18)', border:'1px solid rgba(46,204,113,0.4)', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:ring }}>
        <JxIcon name="check" size={12} color="var(--green)"/>
      </span>
    ) : v === 'r' ? (
      <span style={{ width:22, height:22, borderRadius:5, background:'rgba(242,183,5,0.18)', border:'1px solid rgba(242,183,5,0.4)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, boxShadow:ring }}>
        👁
      </span>
    ) : (
      <span style={{ width:22, height:22, borderRadius:5, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', display:'flex', alignItems:'center', justifyContent:'center', color:'rgba(255,255,255,0.25)', fontSize:12, boxShadow:ring }}>
        ✗
      </span>
    );
    return (
      <div style={{ display:'flex', justifyContent:'center' }}
           onClick={onClick}
           title={canEdit && rol !== 'admin' ? `Click para cambiar (w → 👁 → ✗ → w)${custom ? ' · personalizado' : ''}` : (rol==='admin' ? 'El admin siempre tiene acceso completo' : 'Activa Modo Edición para cambiar permisos')}
           style={{ cursor }}>
        {inner}
      </div>
    );
  };

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Roles y Permisos</div>
          <div className="pg-sub">
            {canEdit
              ? 'Click en cada celda para alternar permiso (w → 👁 → ✗). El admin siempre tiene acceso total.'
              : 'Matriz de permisos por rol. Activa Modo Edición (siendo admin) para personalizar.'}
          </div>
        </div>
        {canEdit && tieneOverrides && (
          <button className="btn btn-ghost btn-sm" onClick={resetAll} title="Restaurar a valores por defecto">
            <JxIcon name="refresh" size={12}/> Restaurar defaults
          </button>
        )}
      </div>

      <div className="card card-p" style={{ marginBottom:16, background: canEdit ? 'rgba(242,183,5,0.07)' : 'rgba(52,152,219,0.08)', border: canEdit ? '1px solid rgba(242,183,5,0.3)' : '1px solid rgba(52,152,219,0.25)' }}>
        <div style={{ fontSize:12.5, color:'var(--ts)', display:'flex', gap:10, alignItems:'flex-start' }}>
          <JxIcon name={canEdit ? 'alert' : 'info'} size={14} color={canEdit ? 'var(--amber)' : 'var(--blue)'}/>
          <span>
            {canEdit ? (
              <>
                <strong>Modo edición activo.</strong> Los cambios se guardan localmente y controlan qué módulos ven los usuarios en la app.
                {' '}<strong style={{ color:'var(--amber)' }}>Importante:</strong> la seguridad real a nivel de base de datos sigue dependiendo de las políticas RLS de Supabase — esta matriz es una capa de UI/UX adicional.
                {tieneOverrides && <> Las celdas con borde ámbar son personalizaciones tuyas.</>}
              </>
            ) : (
              <>Esta matriz controla qué módulos ven los usuarios según su rol. Activa <strong>Modo Edición</strong> en Configuración → Sistema para personalizar.</>
            )}
          </span>
        </div>
      </div>

      {/* Cards de conteo por rol — un grid scrollable horizontalmente si hay muchos */}
      <div style={{ display:'flex', gap:8, marginBottom:16, overflowX:'auto', paddingBottom:4 }}>
        {todasRolKeys.map(r => {
          const esCustom = !ROL_KEYS.includes(r);
          return (
            <div key={r} className="card card-p" style={{ textAlign:'center', minWidth:130, position:'relative', borderTop: esCustom ? '2px solid var(--amber)' : 'none' }}>
              <div style={{ fontSize:10.5, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.06em' }}>
                {todasRolLabels[r]}
                {esCustom && <span style={{ marginLeft:4, fontSize:9, color:'var(--amber)' }}>custom</span>}
              </div>
              <div style={{ fontSize:22, fontWeight:800, color:'var(--amber)', margin:'4px 0' }}>{counts[r] ?? 0}</div>
              <div style={{ fontSize:10.5, color:'var(--tm)' }}>usuarios</div>
              {esCustom && canEdit && (
                <button className="btn btn-ghost btn-xs"
                  title="Eliminar este rol custom"
                  onClick={()=>eliminarRolCustom(r)}
                  style={{ position:'absolute', top:4, right:4, padding:'2px 4px' }}>
                  <JxIcon name="trash" size={10}/>
                </button>
              )}
            </div>
          );
        })}
        {canEdit && (
          <button className="card card-p"
            onClick={()=>setShowAddRole(true)}
            style={{ minWidth:130, border:'2px dashed var(--border)', background:'transparent', color:'var(--tm)', cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
            <JxIcon name="plus" size={16}/>
            <div style={{ fontSize:11, marginTop:4 }}>Crear rol custom</div>
          </button>
        )}
      </div>

      {showAddRole && canEdit && (
        <div className="card card-p" style={{ marginBottom:16, borderLeft:'3px solid var(--amber)' }}>
          <div style={{ fontSize:13, fontWeight:700, color:'var(--tp)', marginBottom:10 }}>Nuevo rol custom</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1.4fr 1fr auto auto', gap:10, alignItems:'flex-end' }}>
            <div>
              <label className="flabel">Key (sin espacios)</label>
              <input className="fi" value={newRoleForm.key}
                placeholder="ej: jefe_calidad"
                onChange={e=>setNewRoleForm({...newRoleForm, key:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Nombre legible</label>
              <input className="fi" value={newRoleForm.label}
                placeholder="ej: Jefe de Calidad"
                onChange={e=>setNewRoleForm({...newRoleForm, label:e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Color del badge</label>
              <select className="fi" value={newRoleForm.color}
                onChange={e=>setNewRoleForm({...newRoleForm, color:e.target.value})}>
                <option value="b-gray">Gris</option>
                <option value="b-blue">Azul</option>
                <option value="b-green">Verde</option>
                <option value="b-amber">Ámbar</option>
                <option value="b-red">Rojo</option>
                <option value="b-yellow">Amarillo</option>
              </select>
            </div>
            <button className="btn btn-amber btn-sm" onClick={crearRolCustom}>
              <JxIcon name="check" size={12}/> Crear
            </button>
            <button className="btn btn-ghost btn-sm" onClick={()=>{ setShowAddRole(false); setNewRoleForm({ key:'', label:'', color:'b-gray' }); }}>
              Cancelar
            </button>
          </div>
          <div style={{ fontSize:11, color:'var(--tm)', marginTop:6 }}>
            Default: solo lectura en todos los módulos (sin acceso a Usuarios/Config). Click en celdas para editar permisos después.
          </div>
        </div>
      )}

      <div className="card" style={{ overflow:'auto' }}>
        <div style={{ display:'grid', gridTemplateColumns:`200px repeat(${todasRolKeys.length},minmax(110px,1fr))`, borderBottom:'1px solid var(--border)', background:'rgba(0,0,0,0.18)' }}>
          <div style={{ padding:'10px 14px', fontSize:10.5, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.08em' }}>Módulo</div>
          {todasRolKeys.map(r => (
            <div key={r} style={{ padding:'10px 4px', fontSize:10.5, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', textAlign:'center' }}>
              {todasRolLabels[r]}
            </div>
          ))}
        </div>
        {MODULE_GROUPS.map(grp => (
          <React.Fragment key={grp.group}>
            <div style={{ display:'grid', gridTemplateColumns:`200px repeat(${todasRolKeys.length},minmax(110px,1fr))`, background:'rgba(242,183,5,0.07)', borderBottom:'1px solid rgba(242,183,5,0.18)' }}>
              <div style={{ padding:'8px 14px', fontSize:11, fontWeight:700, color:'var(--amber)', textTransform:'uppercase', letterSpacing:'.07em' }}>{grp.group}</div>
              <div style={{ gridColumn:`2 / span ${todasRolKeys.length}` }}/>
            </div>
            {grp.modules.map((mod) => {
              const i = PERM_MATRIX_MODULES.indexOf(mod);
              return (
                <div key={mod} style={{ display:'grid', gridTemplateColumns:`200px repeat(${todasRolKeys.length},minmax(110px,1fr))`, borderBottom:'1px solid rgba(255,255,255,0.04)', background:i%2?'rgba(0,0,0,0.06)':'transparent', alignItems:'center' }}>
                  <div style={{ padding:'10px 14px 10px 24px', fontSize:12.5, color:'var(--ts)' }}>{mod}</div>
                  {todasRolKeys.map(r => {
                    const ovRol = overrides[r] || {};
                    const custom = Object.prototype.hasOwnProperty.call(ovRol, mod);
                    return (
                      <div key={r} style={{ padding:'8px 4px' }}>
                        <Cell v={matrix[r][i]} rol={r} modIdx={i} custom={custom}/>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </React.Fragment>
        ))}
        <div style={{ display:'flex', gap:18, padding:'12px 16px', background:'rgba(0,0,0,0.15)', fontSize:11.5, color:'var(--tm)' }}>
          <span style={{ display:'flex', alignItems:'center', gap:6 }}><span style={{ color:'var(--green)' }}>✓</span> Edición</span>
          <span style={{ display:'flex', alignItems:'center', gap:6 }}><span>👁</span> Solo lectura</span>
          <span style={{ display:'flex', alignItems:'center', gap:6 }}><span style={{ color:'var(--tm)' }}>✗</span> Sin acceso</span>
        </div>
      </div>
    </div>
  );
}

// ── CONFIGURACIÓN PAGE ────────────────────────────────────
// Lista completa de tablas Dexie v10 (datos de negocio + sync queue).
// Excluye tablas internas: sync_metadata, sync_conflicts, audit_log_pending,
// change_requests_pending, auth_cache, evidencias_blobs (manejadas aparte).
const DB_TABLES_LIST = [
  // Maestras
  'obras','personal','materiales','herramientas','proveedores','partidas',
  'insumos_partida','cronograma','profiles',
  // Versionado de presupuesto
  'presupuestos_versiones','partidas_versionadas','insumos_partida_versionadas',
  'material_precios_historial',
  // Contabilidad
  'companies','accounting_movements','intercompany_transactions',
  // Compras
  'requisiciones','requisicion_items','cotizaciones','cotizacion_items',
  'ordenes_compra','oc_items','recepciones','recepcion_items',
  // Valorizaciones
  'valorizaciones','valorizacion_partidas','valorizacion_adicionales',
  // Tesorería
  'cuentas_bancarias','movimientos_bancarios','cronograma_pagos',
  // Activos / Maquinaria
  'activos_pesados','horas_maquina','consumos_combustible','mantenimientos_maquinaria',
  // SSOMA
  'charlas_seguridad','charla_asistentes','iperc',
  'epp_entregas','inspecciones_seguridad','capacitaciones',
  // Subcontratos
  'subcontratistas','subcontratos','subcontrato_valorizaciones',
  // Planillas / RRHH
  'personal_contrato','planillas','planilla_boletas',
  // Operaciones diarias
  'asistencia','movimientos_materiales','movimientos_herramientas',
  'avance_obra','incidencias','evidencias',
  // Cola de sync (visible para diagnóstico)
  'sync_queue',
];

function ConfiguracionPage({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : {};
  const isAdmin = auth?.profile?.rol === 'admin';
  const [tab, setTab] = uSAd('empresa');
  const tabs = [
    { id:'empresa', label:'Empresa', icon:'building' },
    { id:'obras',   label:'Obras',    icon:'hardHat' },
    { id:'catalogos', label:'Catálogos', icon:'layers' },
    { id:'sistema', label:'Sistema',  icon:'settings' },
    { id:'notif',   label:'Notificaciones', icon:'bell' },
    { id:'auditoria', label:'Auditoría', icon:'shield' },
  ];
  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Configuración</div>
          <div className="pg-sub">Parámetros del sistema y ajustes de la plataforma</div>
        </div>
      </div>

      <div style={{ display:'flex', gap:4, marginBottom:20, background:'var(--bg-s)', padding:4, borderRadius:8, width:'fit-content' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)}
                  className={`btn ${tab===t.id?'btn-amber':'btn-ghost'} btn-sm`} style={{ border:'none' }}>
            <JxIcon name={t.icon} size={13}/>{t.label}
          </button>
        ))}
      </div>

      {tab === 'empresa'  && <EmpresaTab/>}
      {tab === 'obras'    && <ObrasTab showToast={showToast} isAdmin={isAdmin}/>}
      {tab === 'catalogos'&& <CatalogosTab showToast={showToast} isAdmin={isAdmin}/>}
      {tab === 'sistema'  && <SistemaTab showToast={showToast}/>}
      {tab === 'notif'    && <NotifTab showToast={showToast}/>}
      {tab === 'auditoria'&& <AuditoriaTab showToast={showToast} isAdmin={isAdmin}/>}
    </div>
  );
}

function EmpresaTab() {
  const [stats, setStats] = uSAd({ obras:0, usuarios:0, personal:0, movs:0 });
  uEAd(() => {
    const load = async () => {
      try {
        const db = window.__db;
        const [o,u,p,mm,mh] = await Promise.all([
          db.obras.count(), db.profiles.count(), db.personal.count(),
          db.movimientos_materiales.count(), db.movimientos_herramientas.count()
        ]);
        setStats({ obras:o, usuarios:u, personal:p, movs: mm+mh });
      } catch (e) {}
    };
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
      <div className="card card-p">
        <div style={{ fontSize:13, fontWeight:700, marginBottom:16, display:'flex', gap:8, alignItems:'center' }}>
          <JxIcon name="building" size={14} color="var(--amber)"/>Datos de la Empresa
        </div>
        <div style={{ textAlign:'center', padding:'12px 0 18px' }}>
          <img src="/jarvex-logo.png" alt="JARVEX" style={{ maxHeight:80, objectFit:'contain' }}
               onError={e=>{ e.target.style.display='none'; }}/>
        </div>
        <div style={{ fontSize:14, fontWeight:700, color:'var(--ts)', textAlign:'center', marginBottom:6 }}>
          JARVEX TECNOLOGÍA, INGENIERÍA Y PROYECTOS E.I.R.L.
        </div>
        <div style={{ fontSize:12, color:'var(--tm)', textAlign:'center' }}>ERP integral para empresas constructoras</div>
      </div>

      <div className="card card-p">
        <div style={{ fontSize:13, fontWeight:700, marginBottom:16, display:'flex', gap:8, alignItems:'center' }}>
          <JxIcon name="barChart" size={14} color="var(--amber)"/>Estado actual
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          {[
            { label:'Obras',     val: stats.obras,    color:'var(--amber)' },
            { label:'Usuarios',  val: stats.usuarios, color:'var(--blue)' },
            { label:'Personal',  val: stats.personal, color:'var(--green)' },
            { label:'Movimientos', val: stats.movs,   color:'var(--orange)' },
          ].map((s,i)=>(
            <div key={i} style={{ background:'rgba(0,0,0,0.18)', borderRadius:8, padding:'14px 12px' }}>
              <div style={{ fontSize:11, color:'var(--tm)' }}>{s.label}</div>
              <div style={{ fontSize:24, fontWeight:800, color:s.color, marginTop:4 }}>{s.val}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ObrasTab({ showToast, isAdmin }) {
  const { data: obras } = window.__hooks.useObras();
  const [activeId, setActiveId] = uSAd(() => localStorage.getItem('obra_activa_id') || null);
  const [usuariosObra, setUsuariosObra] = uSAd(null); // { id, nombre_obra } | null

  const setActive = (id) => {
    localStorage.setItem('obra_activa_id', id);
    setActiveId(id);
    showToast?.('Obra activa actualizada','green');
  };

  if (!obras || obras.length === 0) {
    return <div className="card card-p" style={{ textAlign:'center', color:'var(--tm)' }}>No hay obras registradas</div>;
  }

  return (
    <div className="card" style={{ overflow:'hidden' }}>
      <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ fontSize:13, fontWeight:700 }}>Obras del Sistema</div>
        <div style={{ fontSize:11, color:'var(--tm)' }}>{obras.length} obras · clic para activar</div>
      </div>
      {obras.map(o => {
        const isActive = o.id === activeId;
        return (
          <div key={o.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid rgba(255,255,255,0.04)', background:isActive?'rgba(242,183,5,0.07)':'transparent', cursor:'pointer' }}
               onClick={()=>setActive(o.id)}>
            <div>
              <div style={{ fontSize:13, fontWeight:600, color:isActive?'var(--amber)':'var(--ts)' }}>
                {o.nombre_obra || o.nombre || 'Obra'}
              </div>
              <div style={{ fontSize:11, color:'var(--tm)', marginTop:2 }}>
                {o.cliente || 'Sin cliente'} · {o.ubicacion || 'Sin ubicación'} · <span className={`badge b-gray`} style={{ marginLeft:4 }}>{o.estado||'—'}</span>
              </div>
            </div>
            <div style={{ display:'flex', gap:6, alignItems:'center' }}>
              {isActive && <span className="badge b-amber">Activa</span>}
              {isAdmin && (
                <>
                  <button className="btn btn-ghost btn-xs"
                          title="Gestionar usuarios asignados a esta obra"
                          onClick={(e)=>{ e.stopPropagation(); setUsuariosObra({ id:o.id, nombre_obra: o.nombre_obra || o.nombre || 'Obra' }); }}>
                    <JxIcon name="users" size={11}/>
                  </button>
                  <button className="btn btn-ghost btn-xs" onClick={(e)=>{e.stopPropagation(); showToast?.('Editar desde módulo Obras','amber');}}><JxIcon name="edit" size={11}/></button>
                  <button className="btn btn-red btn-xs" onClick={(e)=>{e.stopPropagation(); showToast?.('Archivar desde módulo Obras','amber');}}><JxIcon name="archive" size={11}/></button>
                </>
              )}
            </div>
          </div>
        );
      })}

      {usuariosObra && (
        <ObraUsuariosModal
          obra={usuariosObra}
          isAdmin={isAdmin}
          showToast={showToast}
          onClose={()=>setUsuariosObra(null)}
        />
      )}
    </div>
  );
}

// ── Modal: Usuarios asignados a una obra ─────────────────────────
function ObraUsuariosModal({ obra, isAdmin, showToast, onClose }) {
  const [asignaciones, setAsignaciones] = uSAd([]);    // obra_usuarios + profile join
  const [profiles, setProfiles] = uSAd([]);            // profiles activos globales
  const [loading, setLoading] = uSAd(true);
  const [busy, setBusy] = uSAd(false);
  const [adding, setAdding] = uSAd(false);
  const [form, setForm] = uSAd({ usuario_id:'', rol_obra:'solo_lectura' });

  const reload = async () => {
    try {
      const sb = window.__supabase;
      if (!sb) { setLoading(false); return; }
      const [{ data: ou, error: e1 }, { data: ps, error: e2 }] = await Promise.all([
        sb.from('obra_usuarios')
          .select('id, obra_id, usuario_id, rol_obra, activo, profiles:usuario_id (nombres, apellidos, email, rol)')
          .eq('obra_id', obra.id),
        sb.from('profiles').select('*').eq('activo', true).order('apellidos'),
      ]);
      if (e1) console.warn('obra_usuarios', e1);
      if (e2) console.warn('profiles', e2);
      setAsignaciones(ou || []);
      setProfiles(ps || []);
    } catch (e) {
      console.warn('ObraUsuariosModal reload', e);
    } finally {
      setLoading(false);
    }
  };

  uEAd(() => { reload(); /* eslint-disable-next-line */ }, [obra?.id]);

  const idsAsignadosActivos = uMAd(
    () => new Set((asignaciones||[]).filter(a => a.activo !== false).map(a => a.usuario_id)),
    [asignaciones]
  );
  const profilesDisponibles = uMAd(
    () => (profiles||[]).filter(p => !idsAsignadosActivos.has(p.id)),
    [profiles, idsAsignadosActivos]
  );

  const handleAsignar = async () => {
    if (!form.usuario_id) { showToast?.('Selecciona un usuario','red'); return; }
    setBusy(true);
    try {
      const sb = window.__supabase;
      // Buscar si ya existe asignación inactiva → reactivar; si no, insertar
      const existente = (asignaciones||[]).find(a => a.usuario_id === form.usuario_id);
      if (existente) {
        const { error } = await sb.from('obra_usuarios')
          .update({ activo:true, rol_obra: form.rol_obra })
          .eq('id', existente.id);
        if (error) throw error;
        try { await window.__logAudit?.({ action:'update', table:'obra_usuarios', recordId: existente.id,
          newData:{ activo:true, rol_obra: form.rol_obra }, reason:'Reactivación de usuario en obra' }); } catch(e){}
      } else {
        const { data, error } = await sb.from('obra_usuarios')
          .insert({ obra_id: obra.id, usuario_id: form.usuario_id, rol_obra: form.rol_obra, activo:true })
          .select().single();
        if (error) throw error;
        try { await window.__logAudit?.({ action:'insert', table:'obra_usuarios', recordId: data?.id,
          newData: data, reason:'Asignación de usuario a obra' }); } catch(e){}
      }
      showToast?.('Usuario asignado','green');
      setAdding(false);
      setForm({ usuario_id:'', rol_obra:'solo_lectura' });
      await reload();
    } catch (e) {
      showToast?.('Error al asignar: '+(e.message||e),'red');
    } finally { setBusy(false); }
  };

  const handleQuitar = async (a) => {
    if (!a?.id) return;
    setBusy(true);
    try {
      const sb = window.__supabase;
      const { error } = await sb.from('obra_usuarios').update({ activo:false }).eq('id', a.id);
      if (error) throw error;
      try { await window.__logAudit?.({ action:'update', table:'obra_usuarios', recordId:a.id,
        newData:{ activo:false }, reason:'Desasignación de usuario de obra' }); } catch(e){}
      showToast?.('Usuario removido de la obra','amber');
      await reload();
    } catch (e) {
      showToast?.('Error al quitar: '+(e.message||e),'red');
    } finally { setBusy(false); }
  };

  const handleCambiarRolObra = async (a, nuevoRol) => {
    if (!a?.id || !nuevoRol || nuevoRol === a.rol_obra) return;
    setBusy(true);
    try {
      const sb = window.__supabase;
      const { error } = await sb.from('obra_usuarios').update({ rol_obra: nuevoRol }).eq('id', a.id);
      if (error) throw error;
      try { await window.__logAudit?.({ action:'update', table:'obra_usuarios', recordId:a.id,
        newData:{ rol_obra: nuevoRol }, reason:`Cambio de rol_obra a ${nuevoRol}` }); } catch(e){}
      showToast?.('Rol actualizado','green');
      await reload();
    } catch (e) {
      showToast?.('Error: '+(e.message||e),'red');
    } finally { setBusy(false); }
  };

  return (
    <Modal title={`Usuarios asignados a ${obra.nombre_obra}`} icon="users" onClose={onClose} wide>
      {loading ? (
        <div style={{ padding:20, textAlign:'center', color:'var(--tm)', fontSize:12 }}>Cargando…</div>
      ) : (
        <>
          <div style={{ marginBottom:14 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
              <div style={{ fontSize:12, color:'var(--tm)' }}>
                {asignaciones.filter(a => a.activo !== false).length} usuario(s) activo(s)
                {asignaciones.some(a => a.activo === false) && ` · ${asignaciones.filter(a => a.activo === false).length} inactivo(s)`}
              </div>
              {isAdmin && !adding && (
                <button className="btn btn-amber btn-sm" onClick={()=>setAdding(true)}>
                  <JxIcon name="plus" size={12}/>Asignar usuario
                </button>
              )}
            </div>

            {adding && isAdmin && (
              <div style={{ background:'rgba(242,183,5,0.06)', border:'1px solid rgba(242,183,5,0.25)',
                            borderRadius:8, padding:12, marginBottom:12, display:'grid',
                            gridTemplateColumns:'1.4fr 1fr auto auto', gap:8, alignItems:'end' }}>
                <div>
                  <label className="flabel">Usuario</label>
                  <select className="fi" value={form.usuario_id}
                          onChange={e=>setForm({...form, usuario_id:e.target.value})}>
                    <option value="">— Selecciona —</option>
                    {profilesDisponibles.map(p => (
                      <option key={p.id} value={p.id}>
                        {(p.nombres||'')} {(p.apellidos||'')} · {p.email}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="flabel">Rol en la obra</label>
                  <select className="fi" value={form.rol_obra}
                          onChange={e=>setForm({...form, rol_obra:e.target.value})}>
                    {getAllRolKeys().map(r => <option key={r} value={r}>{getAllRolLabels()[r]}</option>)}
                  </select>
                </div>
                <button className="btn btn-amber btn-sm" disabled={busy} onClick={handleAsignar}>
                  <JxIcon name="check" size={12}/>Asignar
                </button>
                <button className="btn btn-ghost btn-sm" disabled={busy}
                        onClick={()=>{ setAdding(false); setForm({ usuario_id:'', rol_obra:'solo_lectura' }); }}>
                  Cancelar
                </button>
              </div>
            )}
          </div>

          <div style={{ maxHeight:380, overflowY:'auto', border:'1px solid var(--border)', borderRadius:8 }}>
            {asignaciones.length === 0 ? (
              <div style={{ padding:24, textAlign:'center', color:'var(--tm)', fontSize:12 }}>
                No hay usuarios asignados a esta obra todavía.
              </div>
            ) : (
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                <thead>
                  <tr style={{ background:'var(--bg-s)', textAlign:'left', color:'var(--tm)' }}>
                    <th style={{ padding:'8px 12px' }}>Nombre</th>
                    <th style={{ padding:'8px 12px' }}>Email</th>
                    <th style={{ padding:'8px 12px' }}>Rol en obra</th>
                    <th style={{ padding:'8px 12px' }}>Estado</th>
                    {isAdmin && <th style={{ padding:'8px 12px', width:60 }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {asignaciones.map(a => {
                    const p = a.profiles || {};
                    const inactivo = a.activo === false;
                    return (
                      <tr key={a.id} style={{ borderTop:'1px solid var(--border)', opacity: inactivo ? 0.5 : 1 }}>
                        <td style={{ padding:'8px 12px', color:'var(--ts)', fontWeight:500 }}>
                          {(p.nombres||'')} {(p.apellidos||'')}
                        </td>
                        <td style={{ padding:'8px 12px', color:'var(--tm)' }}>{p.email||'—'}</td>
                        <td style={{ padding:'8px 12px' }}>
                          {isAdmin && !inactivo ? (
                            <select className="fi" style={{ padding:'4px 6px', fontSize:11 }}
                                    value={a.rol_obra || 'solo_lectura'}
                                    disabled={busy}
                                    onChange={e=>handleCambiarRolObra(a, e.target.value)}>
                              {getAllRolKeys().map(r => <option key={r} value={r}>{getAllRolLabels()[r]}</option>)}
                            </select>
                          ) : (
                            <span className={`badge ${ROL_COLORS_ADM[a.rol_obra]||'b-gray'}`}>
                              {getAllRolLabels()[a.rol_obra]||a.rol_obra||'—'}
                            </span>
                          )}
                        </td>
                        <td style={{ padding:'8px 12px' }}>
                          <span className={`badge ${inactivo?'b-gray':'b-green'}`}>
                            {inactivo ? 'Inactivo' : 'Activo'}
                          </span>
                        </td>
                        {isAdmin && (
                          <td style={{ padding:'8px 12px', textAlign:'right' }}>
                            {!inactivo && (
                              <button className="btn btn-red btn-xs" disabled={busy}
                                      title="Quitar usuario de esta obra"
                                      onClick={()=>handleQuitar(a)}>
                                <JxIcon name="x" size={11}/>
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {!isAdmin && (
            <div style={{ marginTop:10, fontSize:11, color:'var(--tm)', fontStyle:'italic' }}>
              Solo el administrador puede modificar asignaciones.
            </div>
          )}

          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ─── CATÁLOGOS TAB ────────────────────────────────────────
// Gestión de Unidades de medida + Categorías + Materiales base.
// Admin edita; otros roles leen y solicitan cambio.
function CatalogosTab({ showToast, isAdmin }) {
  const cat = window.__catalogos || {};
  const [seccion, setSeccion] = uSAd('unidades');
  const [unidadesCustom, setUnidadesCustom] = uSAd(cat.loadCustomUnidades?.() || []);
  const [categoriasCustom, setCategoriasCustom] = uSAd(cat.loadCustomCategorias?.() || []);
  const [matsCustom, setMatsCustom] = uSAd(cat.loadCustomMateriales?.() || []);
  const [nuevoUnidad, setNuevoUnidad] = uSAd({ codigo:'', nombre:'', categoria:'longitud' });
  const [nuevoMat, setNuevoMat] = uSAd({ nombre:'', unidad:'und', categoria:'General', precio:0 });
  const [nuevaCat, setNuevaCat] = uSAd('');

  const unidadesEstandar = cat.UNIDADES_ESTANDAR || [];
  const matsBase = cat.MATERIALES_BASE || [];
  const categoriasBase = cat.CATEGORIAS_MATERIAL || [];

  const agregarUnidad = () => {
    if (!isAdmin) return;
    const c = (nuevoUnidad.codigo || '').trim();
    if (!c || !nuevoUnidad.nombre.trim()) { showToast('Código y nombre requeridos', 'red'); return; }
    if ([...unidadesEstandar, ...unidadesCustom].some(u => u.codigo === c)) {
      showToast(`Ya existe la unidad "${c}"`, 'amber'); return;
    }
    const nuevo = [...unidadesCustom, { codigo: c, nombre: nuevoUnidad.nombre.trim(), categoria: nuevoUnidad.categoria }];
    setUnidadesCustom(nuevo); cat.saveCustomUnidades?.(nuevo);
    try { window.__logAudit?.({ action:'insert', table:'catalogo_unidades', recordId:c, newData:nuevoUnidad, reason:'Nueva unidad custom' }); } catch {}
    setNuevoUnidad({ codigo:'', nombre:'', categoria:'longitud' });
    showToast(`Unidad "${c}" agregada`, 'green');
  };
  const eliminarUnidad = (codigo) => {
    if (!isAdmin) return;
    if (!confirm(`¿Eliminar la unidad custom "${codigo}"?`)) return;
    const nuevo = unidadesCustom.filter(u => u.codigo !== codigo);
    setUnidadesCustom(nuevo); cat.saveCustomUnidades?.(nuevo);
    try { window.__logAudit?.({ action:'delete', table:'catalogo_unidades', recordId:codigo, reason:'Eliminación unidad custom' }); } catch {}
    showToast(`Unidad eliminada`, 'amber');
  };

  const agregarCategoria = () => {
    if (!isAdmin) return;
    const v = nuevaCat.trim();
    if (!v) return;
    if ([...categoriasBase, ...categoriasCustom].includes(v)) { showToast('Ya existe esa categoría', 'amber'); return; }
    const nuevo = [...categoriasCustom, v];
    setCategoriasCustom(nuevo); cat.saveCustomCategorias?.(nuevo);
    try { window.__logAudit?.({ action:'insert', table:'catalogo_categorias', recordId:v, reason:'Nueva categoría material' }); } catch {}
    setNuevaCat('');
    showToast(`Categoría "${v}" agregada`, 'green');
  };
  const eliminarCategoria = (v) => {
    if (!isAdmin) return;
    if (!confirm(`¿Eliminar la categoría custom "${v}"?`)) return;
    const nuevo = categoriasCustom.filter(c => c !== v);
    setCategoriasCustom(nuevo); cat.saveCustomCategorias?.(nuevo);
    showToast('Categoría eliminada', 'amber');
  };

  const agregarMat = () => {
    if (!isAdmin) return;
    if (!nuevoMat.nombre.trim()) { showToast('Nombre requerido', 'red'); return; }
    const nuevo = [...matsCustom, { ...nuevoMat, nombre: nuevoMat.nombre.trim(), precio: parseFloat(nuevoMat.precio)||0 }];
    setMatsCustom(nuevo); cat.saveCustomMateriales?.(nuevo);
    try { window.__logAudit?.({ action:'insert', table:'catalogo_materiales', recordId:nuevoMat.nombre, newData:nuevoMat, reason:'Nuevo material catálogo' }); } catch {}
    setNuevoMat({ nombre:'', unidad:'und', categoria:'General', precio:0 });
    showToast(`Material "${nuevoMat.nombre}" agregado al catálogo`, 'green');
  };
  const eliminarMat = (nombre) => {
    if (!isAdmin) return;
    if (!confirm(`¿Eliminar "${nombre}" del catálogo custom?\n(No afecta materiales ya creados en obras)`)) return;
    const nuevo = matsCustom.filter(m => m.nombre !== nombre);
    setMatsCustom(nuevo); cat.saveCustomMateriales?.(nuevo);
    showToast('Material eliminado del catálogo', 'amber');
  };

  return (
    <div>
      <div className="card card-p" style={{ marginBottom:14, background: isAdmin ? 'rgba(242,183,5,0.06)' : 'rgba(52,152,219,0.06)' }}>
        <div style={{ fontSize:12.5, color:'var(--ts)' }}>
          <strong>Catálogos del sistema.</strong> {isAdmin
            ? 'Como admin podés agregar y eliminar entradas del catálogo. Las entradas estándar (no custom) no se borran.'
            : 'Solo los administradores pueden modificar los catálogos. Si necesitás agregar una unidad o categoría nueva, andá a "Solicitar Cambio".'}
        </div>
      </div>

      <div style={{ display:'flex', gap:6, marginBottom:14 }}>
        {[
          { id:'unidades',    l:'Unidades de medida' },
          { id:'categorias',  l:'Categorías de material' },
          { id:'materiales',  l:'Materiales base' },
        ].map(t => (
          <button key={t.id} className={`btn ${seccion===t.id?'btn-amber':'btn-ghost'} btn-sm`} onClick={()=>setSeccion(t.id)} style={{ border:'none' }}>
            {t.l}
          </button>
        ))}
      </div>

      {seccion === 'unidades' && (
        <div>
          {isAdmin && (
            <div className="card card-p" style={{ marginBottom:12, display:'grid', gridTemplateColumns:'1fr 2fr 1fr auto', gap:10, alignItems:'end' }}>
              <div><label className="flabel">Código nuevo *</label><input className="fi" value={nuevoUnidad.codigo} onChange={e=>setNuevoUnidad({...nuevoUnidad, codigo:e.target.value})} placeholder="ej: pza"/></div>
              <div><label className="flabel">Nombre *</label><input className="fi" value={nuevoUnidad.nombre} onChange={e=>setNuevoUnidad({...nuevoUnidad, nombre:e.target.value})} placeholder="ej: Pieza"/></div>
              <div><label className="flabel">Categoría</label>
                <select className="fi" value={nuevoUnidad.categoria} onChange={e=>setNuevoUnidad({...nuevoUnidad, categoria:e.target.value})}>
                  {Object.keys(cat.CATEGORIAS_UNIDAD_LABEL || {}).map(k => <option key={k} value={k}>{cat.CATEGORIAS_UNIDAD_LABEL[k]}</option>)}
                </select>
              </div>
              <button className="btn btn-amber btn-sm" onClick={agregarUnidad}><JxIcon name="plus" size={11}/>Agregar</button>
            </div>
          )}
          <div className="card" style={{ overflow:'auto' }}>
            <table className="tbl"><thead><tr>
              <th>Código</th><th>Nombre</th><th>Categoría</th><th>Tipo</th><th>Acciones</th>
            </tr></thead><tbody>
              {[...unidadesEstandar.map(u=>({...u,std:true})), ...unidadesCustom.map(u=>({...u,std:false}))].map(u => (
                <tr key={u.codigo + u.std}>
                  <td className="col-m" style={{ fontFamily:'monospace', fontWeight:700 }}>{u.codigo}</td>
                  <td>{u.nombre}</td>
                  <td><span className="tag">{cat.CATEGORIAS_UNIDAD_LABEL?.[u.categoria] || u.categoria}</span></td>
                  <td>{u.std ? <span className="badge b-blue">estándar</span> : <span className="badge b-amber">custom</span>}</td>
                  <td>{!u.std && isAdmin && <button className="btn btn-red btn-xs" onClick={()=>eliminarUnidad(u.codigo)}><JxIcon name="trash" size={11}/></button>}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
        </div>
      )}

      {seccion === 'categorias' && (
        <div>
          {isAdmin && (
            <div className="card card-p" style={{ marginBottom:12, display:'flex', gap:10, alignItems:'end' }}>
              <div style={{ flex:1 }}><label className="flabel">Nueva categoría</label><input className="fi" value={nuevaCat} onChange={e=>setNuevaCat(e.target.value)} placeholder="ej: Carpintería metálica"/></div>
              <button className="btn btn-amber btn-sm" onClick={agregarCategoria}><JxIcon name="plus" size={11}/>Agregar</button>
            </div>
          )}
          <div className="card" style={{ overflow:'auto' }}>
            <table className="tbl"><thead><tr><th>Categoría</th><th>Tipo</th><th>Acciones</th></tr></thead><tbody>
              {[...categoriasBase.map(c=>({c,std:true})), ...categoriasCustom.map(c=>({c,std:false}))].map(({c,std}) => (
                <tr key={c+std}>
                  <td>{c}</td>
                  <td>{std ? <span className="badge b-blue">estándar</span> : <span className="badge b-amber">custom</span>}</td>
                  <td>{!std && isAdmin && <button className="btn btn-red btn-xs" onClick={()=>eliminarCategoria(c)}><JxIcon name="trash" size={11}/></button>}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
        </div>
      )}

      {seccion === 'materiales' && (
        <div>
          {isAdmin && (
            <div className="card card-p" style={{ marginBottom:12, display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr auto', gap:10, alignItems:'end' }}>
              <div><label className="flabel">Material *</label><input className="fi" value={nuevoMat.nombre} onChange={e=>setNuevoMat({...nuevoMat, nombre:e.target.value})}/></div>
              <div><label className="flabel">Unidad</label>
                <select className="fi" value={nuevoMat.unidad} onChange={e=>setNuevoMat({...nuevoMat, unidad:e.target.value})}>
                  {(cat.getAllUnidades?.() || []).map(u => <option key={u.codigo} value={u.codigo}>{u.codigo} ({u.nombre})</option>)}
                </select>
              </div>
              <div><label className="flabel">Categoría</label>
                <select className="fi" value={nuevoMat.categoria} onChange={e=>setNuevoMat({...nuevoMat, categoria:e.target.value})}>
                  {(cat.getAllCategorias?.() || []).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div><label className="flabel">Precio est. (S/)</label><input className="fi" type="number" min="0" step="0.01" value={nuevoMat.precio} onChange={e=>setNuevoMat({...nuevoMat, precio:e.target.value})}/></div>
              <button className="btn btn-amber btn-sm" onClick={agregarMat}><JxIcon name="plus" size={11}/></button>
            </div>
          )}
          <div className="card" style={{ overflow:'auto', maxHeight:600 }}>
            <table className="tbl"><thead><tr>
              <th>Material</th><th>Categoría</th><th>Unidad</th><th style={{textAlign:'right'}}>Precio</th><th>Tipo</th><th>Acciones</th>
            </tr></thead><tbody>
              {[...matsBase.map(m=>({...m,std:true})), ...matsCustom.map(m=>({...m,std:false}))].map((m, idx) => (
                <tr key={m.nombre+idx}>
                  <td>{m.nombre}</td>
                  <td><span className="tag">{m.categoria}</span></td>
                  <td className="col-m">{m.unidad}</td>
                  <td style={{ textAlign:'right' }}>S/ {Number(m.precio||0).toFixed(2)}</td>
                  <td>{m.std ? <span className="badge b-blue">estándar</span> : <span className="badge b-amber">custom</span>}</td>
                  <td>{!m.std && isAdmin && <button className="btn btn-red btn-xs" onClick={()=>eliminarMat(m.nombre)}><JxIcon name="trash" size={11}/></button>}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
        </div>
      )}
    </div>
  );
}

function SistemaTab({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : {};
  // Para Sistema usamos el rol REAL (no el override) — solo admin ve esto
  const isAdmin = (auth?.profile?._rolReal || auth?.profile?.rol) === 'admin';
  const appMode = window.__useAppMode ? window.__useAppMode() : { mode: 'edicion', setMode: ()=>{}, isPrueba: false, isEdicion: true, isProduccion: false, isImpersonating: false, roleOverride: null, setRoleOverride: ()=>{}, clearRoleOverride: ()=>{} };
  const { mode, setMode, isPrueba, isEdicion, isProduccion } = appMode;
  const [demoCount, setDemoCount] = uSAd(0);
  const [seedBusy, setSeedBusy] = uSAd(false);

  uEAd(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const n = await window.__demo?.count?.();
        if (!cancelled) setDemoCount(n || 0);
      } catch {}
    };
    refresh();
    const t = setInterval(refresh, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // Confirmación inline (NO usar window.confirm porque más abajo se shadowea
  // el global 'confirm' con un useState `confirm`). Modal in-app más confiable.
  const [demoConfirm, setDemoConfirm] = uSAd(null); // null | 'seed' | 'clear'

  const doSeedDemo = async () => {
    if (!isAdmin) return;
    setSeedBusy(true);
    setDemoConfirm(null);
    try {
      if (demoCount > 0) {
        showToast?.('Limpiando demo viejo…', 'amber');
        await window.__demo.clear();
      }
      showToast?.('Generando datos demo (puede tomar 5-10s)…', 'blue');
      const stats = await window.__demo.seed();
      showToast?.(`✓ Demo creado: ${stats.obras} obras + ${stats.personas} trabajadores + ${stats.materiales} materiales + partidas + asistencia + compras + RRHH + SSOMA`, 'green');
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'all' } })); } catch {}
      try {
        const n = await window.__demo.count();
        setDemoCount(n || 0);
      } catch {}
    } catch (e) { showToast?.('Error: '+(e.message||e), 'red'); console.error('[demo]', e); }
    finally { setSeedBusy(false); }
  };
  const doClearDemo = async () => {
    if (!isAdmin) return;
    setSeedBusy(true);
    setDemoConfirm(null);
    try {
      const r = await window.__demo.clear();
      showToast?.(`${r.eliminados} registros demo eliminados`, 'amber');
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'all' } })); } catch {}
      try {
        const n = await window.__demo.count();
        setDemoCount(n || 0);
      } catch {}
    } catch (e) { showToast?.('Error: '+(e.message||e), 'red'); console.error('[demo]', e); }
    finally { setSeedBusy(false); }
  };

  // Wrappers: si no hay confirmación necesaria → ejecuta directo
  const seedDemo = async () => {
    if (!isAdmin) return;
    if (demoCount > 0) { setDemoConfirm('seed'); return; }
    return doSeedDemo();
  };
  const clearDemo = async () => {
    if (!isAdmin || demoCount === 0) return;
    setDemoConfirm('clear');
  };

  const [counts, setCounts] = uSAd({});
  const [online, setOnline] = uSAd(navigator.onLine);
  const [confirm, setConfirm] = uSAd(null);
  const [busy, setBusy] = uSAd(false);
  const [tableConfirm, setTableConfirm] = uSAd(null);

  uEAd(() => {
    const load = async () => {
      try {
        const db = window.__db;
        const out = {};
        for (const t of DB_TABLES_LIST) {
          try { out[t] = await db[t].count(); } catch (e) { out[t] = 0; }
        }
        setCounts(out);
      } catch (e) {}
    };
    load();
    const onOn = () => setOnline(true);
    const onOff = () => setOnline(false);
    window.addEventListener('online', onOn);
    window.addEventListener('offline', onOff);
    const t = setInterval(load, 5000);
    return () => { clearInterval(t); window.removeEventListener('online', onOn); window.removeEventListener('offline', onOff); };
  }, []);

  const triggerSync = () => {
    window.dispatchEvent(new Event('online'));
    showToast?.('Sincronización solicitada','green');
  };

  const clearLocal = async () => {
    setBusy(true);
    try {
      const db = window.__db;
      await Promise.all(DB_TABLES_LIST.map(t => { try { return db[t].clear(); } catch(e) { return Promise.resolve(); } }));
      showToast?.('Caché local limpiada','green');
      setTimeout(()=>location.reload(), 800);
    } catch(e) { showToast?.('Error: '+(e.message||e),'red'); }
    finally { setBusy(false); setConfirm(null); }
  };

  const clearAuth = async () => {
    setBusy(true);
    try {
      await window.__db.auth_cache.clear();
      showToast?.('Sesiones offline cerradas','green');
      setTimeout(()=>location.reload(), 800);
    } catch(e) { showToast?.('Error: '+(e.message||e),'red'); }
    finally { setBusy(false); setConfirm(null); }
  };

  const totalLocal = Object.values(counts).reduce((a,b)=>a+(b||0),0);

  const clearTable = async (tableName) => {
    setBusy(true);
    try {
      await window.__db[tableName].clear();
      setCounts(c => ({ ...c, [tableName]: 0 }));
      showToast?.(`Tabla \`${tableName}\` vaciada localmente`, 'green');
    } catch(e) {
      showToast?.('Error: '+(e.message||e),'red');
    } finally {
      setBusy(false);
      setTableConfirm(null);
    }
  };

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
      <div className="card card-p" style={{ gridColumn:'1 / -1', borderLeft: isPrueba ? '3px solid #9B59B6' : isEdicion ? '3px solid var(--amber)' : '3px solid var(--green)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12, flexWrap:'wrap', gap:10 }}>
          <div style={{ fontSize:13, fontWeight:700, display:'flex', alignItems:'center', gap:8 }}>
            <JxIcon name={isPrueba ? 'alert' : isEdicion ? 'edit' : 'lock'} size={14}
              color={isPrueba ? '#9B59B6' : isEdicion ? 'var(--amber)' : 'var(--green)'}/>
            Modo de Operación
            <span className={`badge ${isPrueba ? 'b-purple' : isEdicion ? 'b-amber' : 'b-green'}`} style={{ marginLeft:6 }}>
              {isPrueba ? '🧪 PRUEBA' : isEdicion ? '✏️ EDICIÓN' : '🔒 PRODUCCIÓN'}
            </span>
          </div>
          {/* Selector de modo solo visible para admin */}
          {isAdmin && (
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <button
                className={`btn btn-sm ${mode==='prueba' ? 'btn-amber' : 'btn-ghost'}`}
                disabled={mode==='prueba'}
                onClick={()=>{ setMode('prueba'); showToast?.('Modo PRUEBA activado · viendo solo data demo','amber'); }}>
                🧪 Prueba
              </button>
              <button
                className={`btn btn-sm ${mode==='edicion' ? 'btn-amber' : 'btn-ghost'}`}
                disabled={mode==='edicion'}
                onClick={()=>{ setMode('edicion'); showToast?.('Modo EDICIÓN activado','amber'); }}>
                ✏️ Edición
              </button>
              <button
                className={`btn btn-sm ${mode==='produccion' ? 'btn-amber' : 'btn-ghost'}`}
                disabled={mode==='produccion'}
                onClick={()=>{ setMode('produccion'); showToast?.('Modo PRODUCCIÓN activado','green'); }}>
                🔒 Producción
              </button>
            </div>
          )}
        </div>
        <div style={{ fontSize:12.5, color:'var(--ts)', lineHeight:1.5 }}>
          {isAdmin ? (<>
            {isPrueba && '🧪 Modo PRUEBA activo. Toda la app muestra SOLO datos demo precargados. Lo que crees aquí NO se mezcla con tu data real. Funciona idéntico al modo Edición pero con data ficticia, ideal para testear todas las funciones del sistema.'}
            {isEdicion && '✏️ Modo EDICIÓN activo sobre data REAL. Podés eliminar registros, ajustar configuraciones y reiniciar tablas. Cambia a PRODUCCIÓN cuando todo esté listo para tus operarios.'}
            {isProduccion && '🔒 Modo PRODUCCIÓN activo. Eliminación masiva deshabilitada. Es lo que ven tus operarios día a día. Cambia a EDICIÓN si necesitás corregir algo.'}
          </>) : (<>
            🔒 Estás viendo el sistema en modo <strong>PRODUCCIÓN</strong>. Acceso según tu rol ({(window.__useAuth?.()?.profile?.rol || 'operario').replace('_', ' ')}). Si necesitás cambiar configuraciones del sistema o usar el modo prueba/edición, pedile al administrador.
          </>)}
        </div>

        {/* Selector "Ver como rol" — SOLO en modo prueba para admin real */}
        {isPrueba && isAdmin && (
          <div style={{ marginTop:14, paddingTop:14, borderTop:'1px solid var(--bd)' }}>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--ts)', marginBottom:6, display:'flex', alignItems:'center', gap:8 }}>
              <JxIcon name="users" size={13} color="#9B59B6"/>
              Probar el sistema como otro rol
              {appMode.isImpersonating && <span className="badge b-purple">Impersonando: {appMode.roleOverride}</span>}
            </div>
            <div style={{ fontSize:11.5, color:'var(--tm)', marginBottom:10 }}>
              Ver el sistema con los permisos de otro rol sin cambiar tu rol real. Solo afecta lo que VES — internamente seguís siendo admin.
              Vuelve a admin con un click. Al salir de modo prueba, se restaura automáticamente.
            </div>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {[
                { v:null, l:'👑 Admin (yo)', cls:'b-amber' },
                { v:'gerente', l:'Gerente', cls:'b-blue' },
                { v:'ingeniero_residente', l:'Ing. Residente', cls:'b-blue' },
                { v:'supervisor', l:'Supervisor', cls:'b-gray' },
                { v:'almacenero', l:'Almacenero', cls:'b-gray' },
                { v:'asistente_admin', l:'Asistente Admin', cls:'b-gray' },
                { v:'solo_lectura', l:'Solo lectura', cls:'b-gray' },
              ].map(r => {
                const active = (appMode.roleOverride || null) === r.v;
                return (
                  <button key={r.v || 'admin'}
                    className={`btn btn-sm ${active ? 'btn-amber' : 'btn-ghost'}`}
                    disabled={active}
                    onClick={() => {
                      appMode.setRoleOverride(r.v);
                      showToast?.(r.v ? `Viendo como ${r.l}` : 'Volviste a admin', 'amber');
                    }}>
                    {r.l}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Sección Demo Data — visible solo en modo prueba o cuando hay registros demo */}
        {(isPrueba || demoCount > 0) && isAdmin && (
          <div style={{ marginTop:14, paddingTop:14, borderTop:'1px solid var(--bd)' }}>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--ts)', marginBottom:8 }}>
              Datos de prueba ({demoCount} registros)
              {seedBusy && <span style={{ marginLeft:10, color:'var(--amber)', fontSize:11 }}>· procesando…</span>}
            </div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <button className="btn btn-amber btn-sm" onClick={seedDemo} disabled={seedBusy}>
                <JxIcon name="plus" size={12}/> {seedBusy ? 'Procesando…' : demoCount > 0 ? 'Recargar demo' : 'Generar datos demo'}
              </button>
              {demoCount > 0 && (
                <button className="btn btn-ghost btn-sm" onClick={clearDemo} disabled={seedBusy} style={{ color:'var(--red)' }}>
                  <JxIcon name="trash" size={12}/> Limpiar demo
                </button>
              )}
            </div>
            <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:6 }}>
              Genera 1 obra a mitad de ejecución + 12 trabajadores + 60 materiales con stock variado + 24 partidas con avance + asistencia + compras + valorizaciones + maquinaria + SSOMA + planillas + tesorería. Solo visible en modo PRUEBA.
            </div>
          </div>
        )}
      </div>

      {/* Modal confirmación demo (inline, NO depende de window.confirm ni de un Modal externo) */}
      {(demoConfirm === 'seed' || demoConfirm === 'clear') && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && setDemoConfirm(null)}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 }}>
          <div className="card card-p" style={{ minWidth:380, maxWidth:520, background:'#1A2333', border:'1px solid var(--bd)', borderRadius:10, boxShadow:'0 12px 48px rgba(0,0,0,0.5)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
              <JxIcon name="alert" size={18} color={demoConfirm === 'clear' ? 'var(--red)' : 'var(--amber)'}/>
              <div style={{ fontSize:14, fontWeight:700, color:'var(--tp)' }}>
                {demoConfirm === 'seed' ? '¿Recargar datos demo?' : '¿Eliminar todos los datos demo?'}
              </div>
            </div>
            <div style={{ fontSize:13, color:'var(--ts)', lineHeight:1.5, marginBottom:14 }}>
              {demoConfirm === 'seed' && (
                <>Ya hay <strong style={{ color:'var(--amber)' }}>{demoCount} registros</strong> demo cargados.
                  Si continuás, se eliminarán y se generarán de cero (toma 5-10s).
                  <br/><br/>
                  <span style={{ color:'var(--tm)', fontSize:12 }}>Tu data real (modo edición/producción) NO se toca.</span></>
              )}
              {demoConfirm === 'clear' && (
                <>Vas a eliminar <strong style={{ color:'var(--red)' }}>{demoCount} registros</strong> marcados como demo.
                  <br/><br/>
                  <span style={{ color:'var(--tm)', fontSize:12 }}>Tu data real (modo edición/producción) NO se toca. Esta acción NO se puede deshacer.</span></>
              )}
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
              <button className="btn btn-ghost btn-sm" onClick={()=>setDemoConfirm(null)}>Cancelar</button>
              {demoConfirm === 'seed' ? (
                <button className="btn btn-amber btn-sm" onClick={doSeedDemo}>
                  <JxIcon name="check" size={12}/>Sí, recargar de cero
                </button>
              ) : (
                <button className="btn btn-red btn-sm" onClick={doClearDemo}>
                  <JxIcon name="trash" size={12}/>Sí, eliminar todo
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="card card-p">
        <div style={{ fontSize:13, fontWeight:700, marginBottom:14 }}>Información del Sistema</div>
        <div style={{ display:'flex', flexDirection:'column', gap:8, fontSize:12.5 }}>
          {[
            { label:'Versión', val:'JARVEX ERP v2.1 · Sprint 2G' },
            { label:'Navegador', val: navigator.userAgent.split(' ').slice(-2).join(' ') },
            { label:'Estado de red', val: online ? '🟢 Online' : '🔴 Offline' },
            { label:'Total registros locales', val: totalLocal.toLocaleString() },
          ].map((s,i)=>(
            <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid var(--border)' }}>
              <span style={{ color:'var(--tm)' }}>{s.label}</span>
              <span style={{ color:'var(--ts)', fontWeight:500, fontSize:12 }}>{s.val}</span>
            </div>
          ))}
        </div>

        <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:16 }}>
          <button className="btn btn-amber btn-sm" onClick={triggerSync}>
            <JxIcon name="refresh" size={13}/>Sincronizar ahora
          </button>
          {/* Acciones destructivas solo para admin */}
          {isAdmin && (
            <>
              <button className="btn btn-red btn-sm" onClick={()=>setConfirm('cache')}>
                <JxIcon name="trash" size={13}/>Limpiar caché local
              </button>
              <button className="btn btn-red btn-sm" onClick={()=>setConfirm('auth')}>
                <JxIcon name="lock" size={13}/>Cerrar sesiones offline
              </button>
            </>
          )}
        </div>
      </div>

      <div className="card card-p">
        <div style={{ fontSize:13, fontWeight:700, marginBottom:14 }}>Registros locales por tabla</div>
        <div style={{ maxHeight:380, overflowY:'auto' }}>
          {DB_TABLES_LIST.map(t => {
            const n = counts[t] ?? 0;
            return (
              <div key={t} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'7px 0', borderBottom:'1px solid rgba(255,255,255,0.04)', fontSize:12, gap:8 }}>
                <span style={{ color:'var(--tm)', fontFamily:'monospace', flex:1, overflow:'hidden', textOverflow:'ellipsis' }}>{t}</span>
                <span style={{ color:n>0?'var(--ts)':'var(--tm)', fontWeight:n>0?600:400, minWidth:36, textAlign:'right' }}>{n}</span>
                {isAdmin && (isPrueba || isEdicion) && n > 0 && (
                  <button
                    className="btn btn-red btn-xs"
                    title={`Borrar todos los registros locales de ${t}`}
                    onClick={()=>setTableConfirm(t)}>
                    <JxIcon name="trash" size={11}/>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {tableConfirm && (
        <Modal title={`Vaciar tabla: ${tableConfirm}`} icon="alert" onClose={()=>setTableConfirm(null)}>
          <div style={{ fontSize:13, color:'var(--ts)', marginBottom:12 }}>
            ¿Borrar TODOS los registros de la tabla <code style={{ color:'var(--amber)' }}>{tableConfirm}</code> en este dispositivo ({(counts[tableConfirm]||0).toLocaleString()} registros)? Esto NO afecta los datos en Supabase si ya fueron sincronizados. Solo disponible en modo edición.
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>setTableConfirm(null)}>Cancelar</button>
            <button className="btn btn-red" disabled={busy} onClick={()=>clearTable(tableConfirm)}>
              {busy?'Procesando...':'Vaciar tabla'}
            </button>
          </div>
        </Modal>
      )}

      {confirm && (
        <Modal title={confirm==='cache'?'⚠️ Limpiar caché local':'Cerrar sesiones offline'} icon="alert" onClose={()=>setConfirm(null)}>
          {confirm === 'cache' ? (
            <div style={{ fontSize:13, color:'var(--ts)', marginBottom:12, lineHeight:1.55 }}>
              <div style={{ background:'rgba(229,57,53,0.10)', border:'1px solid rgba(229,57,53,0.35)', borderRadius:8, padding:'10px 12px', marginBottom:12 }}>
                <div style={{ fontWeight:700, color:'var(--red)', marginBottom:6, display:'flex', alignItems:'center', gap:6 }}>
                  <JxIcon name="alert" size={13} color="var(--red)"/> Acción IRREVERSIBLE en este dispositivo
                </div>
                <div style={{ fontSize:12, color:'var(--ts)' }}>
                  Vas a borrar <strong>{totalLocal.toLocaleString()} registros</strong> de <strong>{DB_TABLES_LIST.length} tablas</strong> de la base local (IndexedDB).
                </div>
              </div>

              <div style={{ fontSize:12.5, fontWeight:600, color:'var(--tp)', marginBottom:6 }}>Esto borrará localmente:</div>
              <ul style={{ margin:'0 0 12px 18px', padding:0, fontSize:12, color:'var(--tm)', lineHeight:1.7 }}>
                <li>Todas las <strong>obras, partidas, materiales, herramientas y personal</strong> guardados en este equipo.</li>
                <li>Todo el <strong>historial de movimientos</strong>, asistencia, valorizaciones y cronograma.</li>
                <li>Cola de <strong>cambios pendientes de sincronizar</strong> (si hay algo offline sin subir, se pierde).</li>
                <li>Auditoría local, solicitudes de cambio y notificaciones.</li>
              </ul>

              <div style={{ fontSize:12.5, fontWeight:600, color:'var(--green)', marginBottom:6 }}>NO se borra:</div>
              <ul style={{ margin:'0 0 12px 18px', padding:0, fontSize:12, color:'var(--tm)', lineHeight:1.7 }}>
                <li>Los datos en <strong>Supabase</strong> (la nube). Lo ya sincronizado se vuelve a bajar al recargar.</li>
                <li>Tu cuenta de usuario ni los permisos.</li>
              </ul>

              <div style={{ background:'rgba(255,179,0,0.10)', border:'1px solid rgba(255,179,0,0.35)', borderRadius:8, padding:'10px 12px', fontSize:12, color:'var(--ts)' }}>
                <strong style={{ color:'var(--amber)' }}>Antes de borrar:</strong> verifica que estés <strong>online</strong> y que la última sincronización haya terminado.
                Si estás offline o tienes cambios sin subir, esos datos <strong>se perderán</strong>.
              </div>
            </div>
          ) : (
            <div style={{ fontSize:13, color:'var(--ts)', marginBottom:12 }}>
              ¿Cerrar todas las sesiones offline guardadas en este dispositivo? Cualquier usuario que use la app sin internet tendrá que volver a iniciar sesión la próxima vez.
            </div>
          )}
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>setConfirm(null)}>Cancelar</button>
            <button className="btn btn-red" disabled={busy} onClick={confirm==='cache'?clearLocal:clearAuth}>
              {busy?'Procesando...':(confirm==='cache'?'Sí, borrar todo':'Confirmar')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function NotifTab({ showToast }) {
  const [prefs, setPrefs] = uSAd(() => {
    try { return JSON.parse(localStorage.getItem('notif_prefs') || '{}'); }
    catch (e) { return {}; }
  });
  const items = [
    { key:'stock_critico', label:'Stock crítico de materiales', desc:'Notificar cuando un material llegue al mínimo' },
    { key:'partidas_atrasadas', label:'Partidas atrasadas', desc:'Alertar cuando una partida supere su fecha límite' },
    { key:'asistencia_incompleta', label:'Asistencia incompleta', desc:'Notificar si la asistencia diaria queda por debajo del 80%' },
    { key:'sync_failures', label:'Errores de sincronización', desc:'Avisar cuando un registro falle al sincronizar con Supabase' },
  ];
  const toggle = (k) => {
    const next = { ...prefs, [k]: !prefs[k] };
    setPrefs(next);
    localStorage.setItem('notif_prefs', JSON.stringify(next));
    showToast?.('Preferencia guardada','green');
  };
  return (
    <div className="card card-p" style={{ maxWidth:760 }}>
      <div className="card card-p" style={{ marginBottom:16, background:'rgba(242,183,5,0.08)', border:'1px solid rgba(242,183,5,0.25)' }}>
        <div style={{ fontSize:12.5, color:'var(--ts)' }}>
          🚧 Las notificaciones automáticas se activarán en Fase 3 (n8n). Por ahora, las preferencias se guardan localmente.
        </div>
      </div>
      <div style={{ fontSize:13, fontWeight:700, marginBottom:14 }}>Preferencias de notificación</div>
      {items.map(it => {
        const on = !!prefs[it.key];
        return (
          <div key={it.key} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 0', borderBottom:'1px solid var(--border)' }}>
            <div>
              <div style={{ fontSize:13, fontWeight:500, color:'var(--tp)' }}>{it.label}</div>
              <div style={{ fontSize:11.5, color:'var(--tm)', marginTop:2 }}>{it.desc}</div>
            </div>
            <div onClick={()=>toggle(it.key)}
                 style={{ width:40, height:22, borderRadius:11, background:on?'var(--amber)':'rgba(255,255,255,0.1)', cursor:'pointer', position:'relative', flexShrink:0, transition:'background .2s' }}>
              <div style={{ position:'absolute', top:3, left:on?20:3, width:16, height:16, borderRadius:'50%', background:'white', transition:'left .2s', boxShadow:'0 1px 4px rgba(0,0,0,0.4)' }}/>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── AUDITORÍA TAB ─────────────────────────────────────────────────
const AUDIT_TABLES = [
  'profiles','obras','obra_usuarios','personal','materiales','herramientas',
  'proveedores','partidas','insumos_partida','cronograma',
  'asistencia','movimientos_materiales','movimientos_herramientas',
  'avance_obra','incidencias','evidencias',
];

const ACTION_BADGE = {
  insert: 'b-green',
  update: 'b-amber',
  delete: 'b-red',
};

const ACTION_LABEL = {
  insert: 'Insert',
  update: 'Update',
  delete: 'Delete',
};

function fmtDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-PE', { dateStyle:'short', timeStyle:'medium' });
  } catch (e) { return iso; }
}

function AuditoriaTab({ showToast, isAdmin }) {
  const [logs, setLogs] = uSAd([]);
  const [loading, setLoading] = uSAd(true);
  const [filterTable, setFilterTable] = uSAd('');
  const [filterUser, setFilterUser] = uSAd('');
  const [selected, setSelected] = uSAd(null);

  const reload = async () => {
    setLoading(true);
    try {
      const rows = await listAuditLogs({
        table: filterTable || undefined,
        limit: 100,
      });
      setLogs(rows);
    } catch (e) {
      showToast?.('Error cargando logs: '+(e.message||e), 'red');
    } finally {
      setLoading(false);
    }
  };

  uEAd(() => {
    if (isAdmin) reload();
    else setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterTable, isAdmin]);

  const filtered = uMAd(() => {
    const q = filterUser.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(l =>
      (l.user_email || '').toLowerCase().includes(q) ||
      (l.user_id || '').toLowerCase().includes(q)
    );
  }, [logs, filterUser]);

  if (!isAdmin) {
    return (
      <div className="card card-p" style={{ textAlign:'center', color:'var(--tm)' }}>
        <JxIcon name="lock" size={28} color="var(--tm)"/>
        <div style={{ marginTop:10, fontSize:13 }}>
          Solo administradores pueden ver el log de auditoría.
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Filtros */}
      <div className="card card-p" style={{ marginBottom:12, display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <JxIcon name="filter" size={13} color="var(--tm)"/>
          <select value={filterTable} onChange={e=>setFilterTable(e.target.value)}
                  style={{ background:'var(--bg-s)', color:'var(--ts)', border:'1px solid var(--border)', borderRadius:6, padding:'6px 8px', fontSize:12 }}>
            <option value="">Todas las tablas</option>
            {AUDIT_TABLES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6, flex:1, minWidth:200 }}>
          <JxIcon name="search" size={13} color="var(--tm)"/>
          <input value={filterUser} onChange={e=>setFilterUser(e.target.value)}
                 placeholder="Buscar por email o ID de usuario"
                 style={{ background:'var(--bg-s)', color:'var(--ts)', border:'1px solid var(--border)', borderRadius:6, padding:'6px 8px', fontSize:12, width:'100%' }}/>
        </div>
        <button className="btn btn-amber btn-sm" onClick={reload} disabled={loading}>
          <JxIcon name="settings" size={13}/>{loading?'Cargando...':'Refrescar'}
        </button>
      </div>

      {/* Tabla */}
      <div className="card" style={{ overflow:'hidden' }}>
        <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ fontSize:13, fontWeight:700 }}>Registro de auditoría</div>
          <div style={{ fontSize:11, color:'var(--tm)' }}>
            {filtered.length} {filtered.length === 1 ? 'evento' : 'eventos'} · últimos 100
          </div>
        </div>

        {loading ? (
          <div style={{ padding:24, textAlign:'center', color:'var(--tm)', fontSize:12 }}>Cargando…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding:24, textAlign:'center', color:'var(--tm)', fontSize:12 }}>
            No hay eventos de auditoría con los filtros actuales.
          </div>
        ) : (
          <div style={{ maxHeight:520, overflowY:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead style={{ position:'sticky', top:0, background:'var(--bg-s)', zIndex:1 }}>
                <tr style={{ textAlign:'left', color:'var(--tm)' }}>
                  <th style={{ padding:'8px 10px', fontWeight:600 }}>Fecha/hora</th>
                  <th style={{ padding:'8px 10px', fontWeight:600 }}>Usuario</th>
                  <th style={{ padding:'8px 10px', fontWeight:600 }}>Acción</th>
                  <th style={{ padding:'8px 10px', fontWeight:600 }}>Tabla</th>
                  <th style={{ padding:'8px 10px', fontWeight:600 }}>Registro</th>
                  <th style={{ padding:'8px 10px', fontWeight:600 }}>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(l => (
                  <tr key={l.id}
                      onClick={()=>setSelected(l)}
                      style={{ borderTop:'1px solid rgba(255,255,255,0.04)', cursor:'pointer' }}
                      onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.03)'}
                      onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <td style={{ padding:'8px 10px', color:'var(--ts)', whiteSpace:'nowrap' }}>{fmtDateTime(l.created_at)}</td>
                    <td style={{ padding:'8px 10px', color:'var(--ts)' }}>{l.user_email || l.user_id || '—'}</td>
                    <td style={{ padding:'8px 10px' }}>
                      <span className={`badge ${ACTION_BADGE[l.action] || 'b-gray'}`}>{ACTION_LABEL[l.action] || l.action}</span>
                    </td>
                    <td style={{ padding:'8px 10px', color:'var(--ts)', fontFamily:'monospace' }}>{l.table_name}</td>
                    <td style={{ padding:'8px 10px', color:'var(--tm)', fontFamily:'monospace', fontSize:11 }}>
                      {l.record_id ? l.record_id.slice(0,8)+'…' : '—'}
                    </td>
                    <td style={{ padding:'8px 10px', color:'var(--tm)', maxWidth:240, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {l.reason || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <Modal title={`Auditoría · ${selected.table_name} · ${ACTION_LABEL[selected.action] || selected.action}`}
               icon="shield" onClose={()=>setSelected(null)}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, fontSize:12, marginBottom:12 }}>
            <div><span style={{ color:'var(--tm)' }}>Fecha:</span> <span style={{ color:'var(--ts)' }}>{fmtDateTime(selected.created_at)}</span></div>
            <div><span style={{ color:'var(--tm)' }}>Usuario:</span> <span style={{ color:'var(--ts)' }}>{selected.user_email || selected.user_id || '—'}</span></div>
            <div><span style={{ color:'var(--tm)' }}>Tabla:</span> <span style={{ color:'var(--ts)', fontFamily:'monospace' }}>{selected.table_name}</span></div>
            <div><span style={{ color:'var(--tm)' }}>Registro:</span> <span style={{ color:'var(--ts)', fontFamily:'monospace', fontSize:11 }}>{selected.record_id || '—'}</span></div>
            <div style={{ gridColumn:'1 / -1' }}>
              <span style={{ color:'var(--tm)' }}>Motivo:</span> <span style={{ color:'var(--ts)' }}>{selected.reason || '—'}</span>
            </div>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--tm)', marginBottom:6, textTransform:'uppercase', letterSpacing:0.5 }}>old_data</div>
              <pre style={{ background:'rgba(0,0,0,0.25)', borderRadius:6, padding:10, fontSize:11, color:'var(--ts)', maxHeight:360, overflow:'auto', margin:0, whiteSpace:'pre-wrap', wordBreak:'break-word' }}>
{selected.old_data ? JSON.stringify(selected.old_data, null, 2) : '— (sin datos previos)'}
              </pre>
            </div>
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--tm)', marginBottom:6, textTransform:'uppercase', letterSpacing:0.5 }}>new_data</div>
              <pre style={{ background:'rgba(0,0,0,0.25)', borderRadius:6, padding:10, fontSize:11, color:'var(--ts)', maxHeight:360, overflow:'auto', margin:0, whiteSpace:'pre-wrap', wordBreak:'break-word' }}>
{selected.new_data ? JSON.stringify(selected.new_data, null, 2) : '— (sin datos nuevos)'}
              </pre>
            </div>
          </div>

          <div className="modal-actions" style={{ marginTop:14 }}>
            <button className="btn btn-ghost" onClick={()=>setSelected(null)}>Cerrar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { UsuariosPage, RolesPage, ConfiguracionPage, AuditoriaTab });
