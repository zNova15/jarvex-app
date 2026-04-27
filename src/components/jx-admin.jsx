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
                    <td><span className={`badge ${ROL_COLORS_ADM[u.rol]||'b-gray'}`}>{ROL_LABELS[u.rol]||u.rol||'—'}</span></td>
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
                {ROL_KEYS.map(r => <option key={r} value={r}>{ROL_LABELS[r]}</option>)}
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
            <div style={{ fontSize:12, color:'var(--tm)', marginBottom:8 }}>Rol actual: <strong style={{ color:'var(--ts)' }}>{ROL_LABELS[modalRol.rol]||modalRol.rol||'—'}</strong></div>
            {ROL_KEYS.map(r => (
              <button key={r} className={`btn ${r===modalRol.rol?'btn-amber':'btn-ghost'}`}
                      disabled={busy}
                      onClick={()=>handleChangeRol(r)}
                      style={{ justifyContent:'flex-start' }}>
                <span className={`badge ${ROL_COLORS_ADM[r]}`} style={{ marginRight:8 }}>{ROL_LABELS[r]}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── ROLES Y PERMISOS PAGE (matriz informativa) ────────────
const PERM_MATRIX_MODULES = [
  'Obras','Personal','Asistencia','Materiales','Mov. Materiales','Herramientas',
  'Mov. Herramientas','Proveedores','Partidas','Avance','Cronograma','Costos',
  'Incidencias','Evidencias','Reportes','Usuarios/Config'
];

// 'w' = write/edit, 'r' = read only, 'x' = no access
const PERM_MATRIX = {
  // Admin: w all
  admin:               PERM_MATRIX_MODULES.map(()=>'w'),
  // Gerente: w Obras, Personal, Partidas, Avance, Costos, Reportes; r rest; x Usuarios
  gerente: PERM_MATRIX_MODULES.map(m => {
    if (m === 'Usuarios/Config') return 'x';
    return ['Obras','Personal','Partidas','Avance','Costos','Reportes'].includes(m) ? 'w' : 'r';
  }),
  // Ing Residente: w Personal, Asistencia, Partidas, Avance; r Materiales, Herramientas, Costos; x Usuarios
  ingeniero_residente: PERM_MATRIX_MODULES.map(m => {
    if (m === 'Usuarios/Config') return 'x';
    if (['Personal','Asistencia','Partidas','Avance'].includes(m)) return 'w';
    if (['Materiales','Herramientas','Costos'].includes(m)) return 'r';
    return 'r';
  }),
  // Supervisor: w Asistencia, Mov.Materiales, Mov.Herramientas, Avance; r rest; x Usuarios, Costos
  supervisor: PERM_MATRIX_MODULES.map(m => {
    if (m === 'Usuarios/Config' || m === 'Costos') return 'x';
    if (['Asistencia','Mov. Materiales','Mov. Herramientas','Avance'].includes(m)) return 'w';
    return 'r';
  }),
  // Almacenero
  almacenero: PERM_MATRIX_MODULES.map(m => {
    if (['Partidas','Avance','Costos','Usuarios/Config'].includes(m)) return 'x';
    if (['Materiales','Mov. Materiales','Herramientas','Mov. Herramientas'].includes(m)) return 'w';
    if (['Personal','Asistencia'].includes(m)) return 'r';
    return 'r';
  }),
  // Asistente Admin
  asistente_admin: PERM_MATRIX_MODULES.map(m => {
    if (m === 'Usuarios/Config' || m === 'Costos') return 'x';
    if (['Personal','Asistencia','Proveedores'].includes(m)) return 'w';
    return 'r';
  }),
  // Solo lectura
  solo_lectura: PERM_MATRIX_MODULES.map(m => m === 'Usuarios/Config' ? 'x' : 'r'),
};

function RolesPage() {
  const [counts, setCounts] = uSAd({});
  uEAd(() => {
    const load = async () => {
      try {
        const sb = window.__supabase;
        if (!sb) return;
        const { data } = await sb.from('profiles').select('rol');
        const c = {};
        ROL_KEYS.forEach(r => { c[r] = (data||[]).filter(p=>p.rol===r).length; });
        setCounts(c);
      } catch (e) {}
    };
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const Cell = ({ v }) => {
    if (v === 'w') return (
      <div style={{ display:'flex', justifyContent:'center' }}>
        <span style={{ width:22, height:22, borderRadius:5, background:'rgba(46,204,113,0.18)', border:'1px solid rgba(46,204,113,0.4)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <JxIcon name="check" size={12} color="var(--green)"/>
        </span>
      </div>
    );
    if (v === 'r') return (
      <div style={{ display:'flex', justifyContent:'center' }}>
        <span style={{ width:22, height:22, borderRadius:5, background:'rgba(242,183,5,0.18)', border:'1px solid rgba(242,183,5,0.4)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13 }}>
          👁
        </span>
      </div>
    );
    return (
      <div style={{ display:'flex', justifyContent:'center' }}>
        <span style={{ width:22, height:22, borderRadius:5, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', display:'flex', alignItems:'center', justifyContent:'center', color:'rgba(255,255,255,0.25)', fontSize:12 }}>
          ✗
        </span>
      </div>
    );
  };

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Roles y Permisos</div>
          <div className="pg-sub">Matriz informativa de permisos por rol del sistema</div>
        </div>
      </div>

      <div className="card card-p" style={{ marginBottom:16, background:'rgba(52,152,219,0.08)', border:'1px solid rgba(52,152,219,0.25)' }}>
        <div style={{ fontSize:12.5, color:'var(--ts)', display:'flex', gap:10, alignItems:'flex-start' }}>
          <JxIcon name="info" size={14} color="var(--blue)"/>
          <span>Esta matriz refleja los permisos configurados en las políticas RLS de Supabase. Para modificarlos, edita las policies SQL.</span>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:`repeat(${ROL_KEYS.length},1fr)`, gap:8, marginBottom:16 }}>
        {ROL_KEYS.map(r => (
          <div key={r} className="card card-p" style={{ textAlign:'center' }}>
            <div style={{ fontSize:10.5, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.06em' }}>{ROL_LABELS[r]}</div>
            <div style={{ fontSize:22, fontWeight:800, color:'var(--amber)', margin:'4px 0' }}>{counts[r] ?? 0}</div>
            <div style={{ fontSize:10.5, color:'var(--tm)' }}>usuarios</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ overflow:'hidden' }}>
        <div style={{ display:'grid', gridTemplateColumns:`200px repeat(${ROL_KEYS.length},1fr)`, borderBottom:'1px solid var(--border)', background:'rgba(0,0,0,0.18)' }}>
          <div style={{ padding:'10px 14px', fontSize:10.5, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.08em' }}>Módulo</div>
          {ROL_KEYS.map(r => (
            <div key={r} style={{ padding:'10px 4px', fontSize:10.5, fontWeight:700, color:'var(--tm)', textTransform:'uppercase', textAlign:'center' }}>
              {ROL_LABELS[r]}
            </div>
          ))}
        </div>
        {PERM_MATRIX_MODULES.map((mod, i) => (
          <div key={mod} style={{ display:'grid', gridTemplateColumns:`200px repeat(${ROL_KEYS.length},1fr)`, borderBottom:'1px solid rgba(255,255,255,0.04)', background:i%2?'rgba(0,0,0,0.06)':'transparent', alignItems:'center' }}>
            <div style={{ padding:'10px 14px', fontSize:12.5, color:'var(--ts)' }}>{mod}</div>
            {ROL_KEYS.map(r => <div key={r} style={{ padding:'8px 4px' }}><Cell v={PERM_MATRIX[r][i]}/></div>)}
          </div>
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
const DB_TABLES_LIST = [
  'obras','personal','materiales','herramientas','proveedores','partidas',
  'insumos_partida','cronograma','profiles','asistencia','movimientos_materiales',
  'movimientos_herramientas','avance_obra','incidencias','evidencias','sync_queue'
];

function ConfiguracionPage({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : {};
  const isAdmin = auth?.profile?.rol === 'admin';
  const [tab, setTab] = uSAd('empresa');
  const tabs = [
    { id:'empresa', label:'Empresa', icon:'building' },
    { id:'obras',   label:'Obras',    icon:'hardHat' },
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
                    {ROL_KEYS.map(r => <option key={r} value={r}>{ROL_LABELS[r]}</option>)}
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
                              {ROL_KEYS.map(r => <option key={r} value={r}>{ROL_LABELS[r]}</option>)}
                            </select>
                          ) : (
                            <span className={`badge ${ROL_COLORS_ADM[a.rol_obra]||'b-gray'}`}>
                              {ROL_LABELS[a.rol_obra]||a.rol_obra||'—'}
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

function SistemaTab({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : {};
  const isAdmin = auth?.profile?.rol === 'admin';
  const appMode = window.__useAppMode ? window.__useAppMode() : { mode: 'prueba', setMode: ()=>{}, isPrueba: true };
  const { mode, setMode, isPrueba } = appMode;

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
      <div className="card card-p" style={{ gridColumn:'1 / -1', borderLeft: isPrueba ? '3px solid var(--amber)' : '3px solid var(--green)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12, flexWrap:'wrap', gap:10 }}>
          <div style={{ fontSize:13, fontWeight:700, display:'flex', alignItems:'center', gap:8 }}>
            <JxIcon name={isPrueba ? 'alert' : 'lock'} size={14} color={isPrueba ? 'var(--amber)' : 'var(--green)'}/>
            Modo de Operación
            <span className={`badge ${isPrueba ? 'b-amber' : 'b-green'}`} style={{ marginLeft:6 }}>
              {isPrueba ? '🧪 PRUEBA' : '🔒 PRODUCCIÓN'}
            </span>
          </div>
          <div style={{ display:'flex', gap:8 }} title={isAdmin ? '' : 'Solo el administrador puede cambiar el modo'}>
            <button
              className={`btn btn-sm ${mode==='prueba' ? 'btn-amber' : 'btn-ghost'}`}
              disabled={!isAdmin || mode==='prueba'}
              onClick={()=>{ setMode('prueba'); showToast?.('Modo prueba activado','amber'); }}>
              🧪 Prueba
            </button>
            <button
              className={`btn btn-sm ${mode==='produccion' ? 'btn-amber' : 'btn-ghost'}`}
              disabled={!isAdmin || mode==='produccion'}
              onClick={()=>{ setMode('produccion'); showToast?.('Modo producción activado','green'); }}>
              🔒 Producción
            </button>
          </div>
        </div>
        <div style={{ fontSize:12.5, color:'var(--ts)', lineHeight:1.5 }}>
          {isPrueba
            ? 'Modo prueba activo. Permite borrar datos en bloque para reiniciar. No usar en producción.'
            : 'Modo producción activo. Eliminación masiva deshabilitada para prevenir pérdida accidental de datos.'}
        </div>
        {!isAdmin && (
          <div style={{ fontSize:11.5, color:'var(--tm)', marginTop:8, fontStyle:'italic' }}>
            Solo el administrador puede cambiar el modo.
          </div>
        )}
      </div>

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
          <button className="btn btn-red btn-sm" onClick={()=>setConfirm('cache')}>
            <JxIcon name="trash" size={13}/>Limpiar caché local
          </button>
          <button className="btn btn-red btn-sm" onClick={()=>setConfirm('auth')}>
            <JxIcon name="lock" size={13}/>Cerrar sesiones offline
          </button>
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
                {isPrueba && n > 0 && (
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
            ¿Borrar TODOS los registros de la tabla <code style={{ color:'var(--amber)' }}>{tableConfirm}</code> en este dispositivo? Esto NO afecta los datos en Supabase si ya fueron sincronizados. Modo: prueba.
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
        <Modal title={confirm==='cache'?'Limpiar caché local':'Cerrar sesiones offline'} icon="alert" onClose={()=>setConfirm(null)}>
          <div style={{ fontSize:13, color:'var(--ts)', marginBottom:12 }}>
            {confirm === 'cache'
              ? '¿Seguro que deseas borrar todos los datos locales? Se recargará la app y se sincronizará desde Supabase.'
              : '¿Cerrar todas las sesiones offline guardadas? Tendrás que volver a iniciar sesión.'}
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>setConfirm(null)}>Cancelar</button>
            <button className="btn btn-red" disabled={busy} onClick={confirm==='cache'?clearLocal:clearAuth}>
              {busy?'Procesando...':'Confirmar'}
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
