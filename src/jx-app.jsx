import React from "react";
const { useState: uSA, useEffect: uEA, useCallback: uCA } = React;

// ── TOAST ─────────────────────────────────────────────────
function Toast({ message, type, onDone }) {
  uEA(() => { const t = setTimeout(onDone, 3200); return () => clearTimeout(t); }, []);
  const colors = { green: '#2ECC71', red: '#E74C3C', amber: '#F2B705', blue: '#3498DB' };
  const icons  = { green: 'checkCircle', red: 'alertCircle', amber: 'bell', blue: 'alertCircle' };
  const c = colors[type] || colors.amber;
  return (
    <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999, animation:'fadeUp .3s ease', display:'flex', alignItems:'center', gap:12, background:'#1E2D42', border:`1px solid ${c}40`, borderLeft:`3px solid ${c}`, borderRadius:10, padding:'14px 18px', boxShadow:'0 8px 32px rgba(0,0,0,0.5)', maxWidth:380 }}>
      <JxIcon name={icons[type]||'checkCircle'} size={16} color={c}/>
      <span style={{ fontSize:13, color:'#F0F2F5', fontWeight:500 }}>{message}</span>
    </div>
  );
}

// ── CIRCUIT PATTERN SVG ───────────────────────────────────
function CircuitBg() {
  return (
    <svg style={{ position:'absolute', inset:0, width:'100%', height:'100%', opacity:.07 }} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
          <path d="M60 0H0V60" fill="none" stroke="#7BAFD4" strokeWidth=".5"/>
        </pattern>
        <pattern id="circuit" width="120" height="120" patternUnits="userSpaceOnUse">
          <rect width="120" height="120" fill="url(#grid)"/>
          <circle cx="60" cy="60" r="3" fill="none" stroke="#F2B705" strokeWidth="1"/>
          <circle cx="0" cy="0" r="2" fill="none" stroke="#7BAFD4" strokeWidth=".8"/>
          <circle cx="120" cy="0" r="2" fill="none" stroke="#7BAFD4" strokeWidth=".8"/>
          <circle cx="0" cy="120" r="2" fill="none" stroke="#7BAFD4" strokeWidth=".8"/>
          <path d="M60 60 L90 60 L90 30" fill="none" stroke="#7BAFD4" strokeWidth=".8"/>
          <path d="M60 60 L30 60 L30 90" fill="none" stroke="#7BAFD4" strokeWidth=".8"/>
          <path d="M0 60 L30 60" fill="none" stroke="#F2B705" strokeWidth=".6"/>
          <rect x="86" y="26" width="8" height="8" fill="none" stroke="#F2B705" strokeWidth=".8"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#circuit)"/>
    </svg>
  );
}

// ── LOGIN SCREEN ──────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [email, setEmail]   = uSA('admin@jarvex.pe');
  const [pass, setPass]     = uSA('');
  const [loading, setLoad]  = uSA(false);
  const [err, setErr]       = uSA('');
  const [showPass, setShow] = uSA(false);

  const handleLogin = async () => {
    if (!email) { setErr('Ingresa tu correo electrónico.'); return; }
    if (!pass) { setErr('Ingresa tu contraseña.'); return; }
    setErr(''); setLoad(true);
    try {
      await onLogin(email, pass);
    } catch (e) {
      setErr(e.message?.includes('Invalid login') ? 'Email o contraseña incorrectos.' : (e.message || 'Error al iniciar sesión.'));
      setLoad(false);
    }
  };

  return (
    <div style={{ minHeight:'100vh', background:'#0D1520', display:'flex', alignItems:'center', justifyContent:'center', position:'relative', overflow:'hidden' }}>
      <CircuitBg/>

      {/* Glow orbs */}
      <div style={{ position:'absolute', top:'20%', left:'15%', width:400, height:400, borderRadius:'50%', background:'radial-gradient(circle,rgba(52,152,219,0.08) 0%,transparent 70%)', pointerEvents:'none' }}/>
      <div style={{ position:'absolute', bottom:'20%', right:'15%', width:350, height:350, borderRadius:'50%', background:'radial-gradient(circle,rgba(242,183,5,0.06) 0%,transparent 70%)', pointerEvents:'none' }}/>

      <div style={{ position:'relative', zIndex:1, width:'100%', maxWidth:420, padding:'0 20px' }}>
        {/* Card */}
        <div style={{ background:'rgba(28,45,64,0.85)', backdropFilter:'blur(20px)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:16, padding:'40px 36px', boxShadow:'0 24px 80px rgba(0,0,0,0.6)' }}>

          {/* Logo */}
          <div style={{ textAlign:'center', marginBottom:32 }}>
            <img src="/jarvex-logo.png" alt="JARVEX" style={{ height:70, objectFit:'contain', marginBottom:6 }}
              onError={e=>{ e.target.style.display='none'; }}/>
            <div style={{ fontSize:11, color:'#405565', letterSpacing:'.16em', fontWeight:600, textTransform:'uppercase' }}>Sistema de Gestión de Obras</div>
          </div>

          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:22, fontWeight:800, color:'#F0F2F5', letterSpacing:'-.02em', marginBottom:4 }}>Iniciar Sesión</div>
            <div style={{ fontSize:12.5, color:'#5A6A7A' }}>Accede a tu plataforma de control de obra</div>
          </div>

          {err && <div style={{ background:'rgba(231,76,60,0.1)', border:'1px solid rgba(231,76,60,0.25)', borderRadius:8, padding:'10px 14px', fontSize:12.5, color:'#EF6B5E', marginBottom:14, display:'flex', gap:8, alignItems:'center' }}>
            <JxIcon name="alertCircle" size={14} color="#EF6B5E"/>{err}
          </div>}

          <div style={{ marginBottom:14 }}>
            <label className="flabel">Correo Electrónico</label>
            <div style={{ position:'relative' }}>
              <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}>
                <JxIcon name="user" size={14} color="#5A6A7A"/>
              </span>
              <input className="fi" type="email" placeholder="usuario@jarvex.pe" value={email} onChange={e=>setEmail(e.target.value)} style={{ paddingLeft:36 }} onKeyDown={e=>e.key==='Enter'&&handleLogin()}/>
            </div>
          </div>

          <div style={{ marginBottom:22 }}>
            <label className="flabel">Contraseña</label>
            <div style={{ position:'relative' }}>
              <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}>
                <JxIcon name="lock" size={14} color="#5A6A7A"/>
              </span>
              <input className="fi" type={showPass?'text':'password'} placeholder="••••••••" value={pass} onChange={e=>setPass(e.target.value)} style={{ paddingLeft:36, paddingRight:40 }} onKeyDown={e=>e.key==='Enter'&&handleLogin()}/>
              <button onClick={()=>setShow(!showPass)} style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#5A6A7A', display:'flex', padding:2 }}>
                <JxIcon name="eye" size={14}/>
              </button>
            </div>
          </div>

          <button onClick={handleLogin} disabled={loading} className="btn btn-amber" style={{ width:'100%', justifyContent:'center', padding:'13px', fontSize:14, letterSpacing:'.01em', opacity:loading?0.75:1 }}>
            {loading ? (
              <><span style={{ width:14, height:14, borderRadius:'50%', border:'2px solid rgba(0,0,0,0.3)', borderTopColor:'rgba(0,0,0,0.8)', display:'inline-block', animation:'spin .7s linear infinite' }}/>Verificando…</>
            ) : (
              <><JxIcon name="lock" size={14}/>Ingresar al Sistema</>
            )}
          </button>

          <div style={{ textAlign:'center', marginTop:16 }}>
            <a href="#" style={{ fontSize:12, color:'#3498DB', textDecoration:'none' }} onClick={e=>e.preventDefault()}>¿Olvidaste tu contraseña?</a>
          </div>
        </div>

        <div style={{ textAlign:'center', marginTop:20, fontSize:11, color:'#2A3A4A' }}>
          JARVEX Tecnología, Ingeniería y Proyectos E.I.R.L. · v2.0.0 · © 2026
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── HEADER BAR ────────────────────────────────────────────
function Header({ page, onToggleSidebar, onLogout, profile, obraActiva, syncStatus, onSync }) {
  const pageLabels = {
    dashboard:'Dashboard',obras:'Obras / Proyectos',reportes:'Reportes',
    personal:'Personal',asistencia:'Asistencia',materiales:'Materiales',
    'mov-materiales':'Movimiento de Materiales','herramientas':'Herramientas',
    'mov-herramientas':'Movimiento de Herramientas',proveedores:'Proveedores',
    evidencias:'Evidencias',partidas:'Partidas',insumos:'Insumos por Partida',
    cronograma:'Cronograma / Gantt',avance:'Avance de Obra',comparativo:'Planificado vs Real',
    costos:'Costos',incidencias:'Incidencias',usuarios:'Usuarios',roles:'Roles y Permisos',
    configuracion:'Configuración',
    conflictos:'Bandeja de Conflictos',
  };

  const notifs = window.__useRealtimeNotifications ? window.__useRealtimeNotifications() : { notifications:[], unreadCount:0, markAllRead:()=>{}, clearAll:()=>{} };
  const [notifOpen, setNotifOpen] = uSA(false);

  const initials = profile
    ? (profile.nombres?.[0] ?? '') + (profile.apellidos?.[0] ?? '')
    : '··';

  const [menu, setMenu] = uSA(false);

  return (
    <div style={{ height:58, background:'#0D1822', borderBottom:'1px solid rgba(255,255,255,0.06)', display:'flex', alignItems:'center', paddingLeft:16, paddingRight:20, gap:12, flexShrink:0, zIndex:5 }}>
      <button onClick={onToggleSidebar} className="btn btn-ghost btn-icon"><JxIcon name="menu" size={16}/></button>
      <div style={{ fontSize:14, fontWeight:600, color:'var(--tp)' }}>{pageLabels[page] || page}</div>
      <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:10 }}>
        {syncStatus && (
          <div onClick={onSync} title="Click para sincronizar ahora"
               style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 10px', borderRadius:20, fontSize:11.5, fontWeight:600, cursor:'pointer', background: syncStatus.bg }}>
            <div style={{ width:7, height:7, borderRadius:'50%', background: syncStatus.color, ...(syncStatus.syncing ? {animation:'pulse 1.2s ease-in-out infinite'} : {}) }}/>
            <span style={{ color: syncStatus.color }}>{syncStatus.label}</span>
          </div>
        )}
        {obraActiva && (
          <div style={{ fontSize:12, color:'var(--tm)', display:'flex', alignItems:'center', gap:5 }}>
            <span className="dot-pulse"/>Obra: {obraActiva.nombre_obra}
          </div>
        )}
        <div style={{ position:'relative' }}>
          <button className="btn btn-ghost btn-icon"
                  onClick={() => { setNotifOpen(o => !o); if (!notifOpen) notifs.markAllRead(); }}
                  style={{ position:'relative' }}>
            <JxIcon name="bell" size={16}/>
            {notifs.unreadCount > 0 && (
              <span style={{ position:'absolute', top:2, right:2, minWidth:14, height:14, borderRadius:7, background:'var(--red)', color:'white', fontSize:9, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center', padding:'0 3px', border:'1.5px solid #0D1822' }}>
                {notifs.unreadCount > 9 ? '9+' : notifs.unreadCount}
              </span>
            )}
          </button>
          {notifOpen && (
            <div style={{ position:'absolute', top:42, right:0, width:360, maxHeight:480, overflow:'auto', background:'var(--bg-c)', border:'1px solid var(--border)', borderRadius:10, boxShadow:'0 8px 32px rgba(0,0,0,0.5)', zIndex:100 }}>
              <div style={{ padding:'12px 14px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div style={{ fontSize:13, fontWeight:700, color:'var(--tp)' }}>Notificaciones</div>
                {notifs.notifications.length > 0 && (
                  <button onClick={notifs.clearAll} style={{ background:'none', border:'none', color:'var(--tm)', fontSize:11, cursor:'pointer' }}>Limpiar</button>
                )}
              </div>
              {notifs.notifications.length === 0 ? (
                <div style={{ padding:'30px 14px', textAlign:'center', color:'var(--tm)', fontSize:12 }}>
                  <JxIcon name="bell" size={24} color="var(--tm)"/>
                  <div style={{ marginTop:8 }}>Sin notificaciones</div>
                </div>
              ) : notifs.notifications.map(n => (
                <div key={n.id} style={{ padding:'12px 14px', borderBottom:'1px solid var(--border)', display:'flex', gap:10 }}>
                  <div style={{ width:30, height:30, borderRadius:'50%', background:n.color+'22', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    <JxIcon name={n.icon} size={13} color={n.color}/>
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:'var(--tp)' }}>{n.titulo}</div>
                    <div style={{ fontSize:11.5, color:'var(--ts)', lineHeight:1.4, marginTop:2 }}>{n.descripcion}</div>
                    <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:4 }}>{new Date(n.fecha).toLocaleString('es-PE')}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ position:'relative' }}>
          <div onClick={()=>setMenu(m=>!m)}
               style={{ width:30, height:30, borderRadius:'50%', background:'linear-gradient(135deg,#223247,#1C2D40)', border:'1.5px solid rgba(242,183,5,0.35)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:'var(--amber)', cursor:'pointer', textTransform:'uppercase' }}>
            {initials}
          </div>
          {menu && (
            <div style={{ position:'absolute', top:38, right:0, background:'var(--bg-c)', border:'1px solid var(--border)', borderRadius:8, padding:6, minWidth:200, boxShadow:'0 8px 24px rgba(0,0,0,0.4)', zIndex:100 }}>
              <div style={{ padding:'10px 12px', borderBottom:'1px solid var(--border)' }}>
                <div style={{ fontSize:12.5, fontWeight:700, color:'var(--tp)' }}>{profile?.nombres} {profile?.apellidos}</div>
                <div style={{ fontSize:11, color:'var(--tm)' }}>{profile?.email}</div>
                <div style={{ fontSize:10, color:'var(--amber)', marginTop:4, textTransform:'uppercase', letterSpacing:'0.05em' }}>{profile?.rol}</div>
              </div>
              <div onClick={()=>{setMenu(false); onLogout();}}
                   style={{ padding:'10px 12px', cursor:'pointer', display:'flex', alignItems:'center', gap:8, color:'var(--ts)', fontSize:12.5, borderRadius:6 }}
                   onMouseEnter={e=>e.currentTarget.style.background='var(--bg-c2)'}
                   onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <JxIcon name="logout" size={13}/> Cerrar sesión
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── COMING SOON ───────────────────────────────────────────
function ComingSoon({ page }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:14, color:'var(--tm)' }}>
      <div style={{ width:64, height:64, borderRadius:16, background:'rgba(242,183,5,0.08)', border:'1px solid rgba(242,183,5,0.15)', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <JxIcon name="settings" size={28} color="rgba(242,183,5,0.4)"/>
      </div>
      <div>
        <div style={{ fontSize:18, fontWeight:700, color:'var(--ts)', textAlign:'center', marginBottom:6 }}>Módulo en Desarrollo</div>
        <div style={{ fontSize:13, color:'var(--tm)', textAlign:'center' }}>Esta pantalla estará disponible próximamente.</div>
      </div>
      <span className="badge b-amber" style={{ marginTop:4 }}>v2.1 — Próxima actualización</span>
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────
function App() {
  const auth = window.__useAuth();   // hook expuesto desde main.jsx
  const [page, setPage]             = uSA('dashboard');
  const [collapsed, setCollapsed]   = uSA(false);
  const [toast, setToast]           = uSA(null);
  const [obraActiva, setObraActiva] = uSA(null);
  const sync = window.__useSync ? window.__useSync() : { syncing:false, pending:0 };
  const online = window.__useOnline ? window.__useOnline() : true;

  const showToast = uCA((msg, type='amber') => setToast({ msg, type, key: Date.now() }), []);

  // Cargar obra activa desde Dexie cuando hay sesión
  uEA(() => {
    if (!auth?.profile) return;
    window.__db.obras.toArray().then(obras => {
      const activa = obras.find(o => !o.deleted_at);
      if (activa) setObraActiva(activa);
    });
  }, [auth?.profile, sync.lastSync]);

  let syncStatus = null;
  if (!online) syncStatus = { color:'#F59E0B', label:'Sin conexión', bg:'rgba(245,158,11,0.12)' };
  else if (sync.syncing) syncStatus = { color:'#60A5FA', label:'Sincronizando…', bg:'rgba(96,165,250,0.12)', syncing:true };
  else if (sync.pending > 0) syncStatus = { color:'#F59E0B', label:`${sync.pending} pendiente${sync.pending>1?'s':''}`, bg:'rgba(245,158,11,0.12)' };
  else syncStatus = { color:'#34D399', label:'Sincronizado', bg:'rgba(52,211,153,0.1)' };

  const renderPage = () => {
    switch(page) {
      case 'importar':      return <ImportarPage showToast={showToast}/>;
      case 'dashboard':     return <DashboardPage showToast={showToast}/>;
      case 'obras':         return <ObrasPage showToast={showToast}/>;
      case 'reportes':      return <ReportesPage showToast={showToast}/>;
      case 'materiales':    return <MaterialesPage showToast={showToast}/>;
      case 'herramientas':  return <HerramientasPage showToast={showToast}/>;
      case 'personal':      return <PersonalPage showToast={showToast}/>;
      case 'asistencia':    return <AsistenciaPage showToast={showToast}/>;
      case 'mov-materiales':  return <MovMaterialesPage showToast={showToast}/>;
      case 'mov-herramientas':return <MovHerramientasPage showToast={showToast}/>;
      case 'proveedores':   return <ProveedoresPage showToast={showToast}/>;
      case 'partidas':      return <PartidasPage showToast={showToast}/>;
      case 'insumos':       return <InsumosPage showToast={showToast}/>;
      case 'cronograma':    return <CronogramaPage showToast={showToast}/>;
      case 'avance':        return <AvancePage showToast={showToast}/>;
      case 'comparativo':   return <ComparativoPage showToast={showToast}/>;
      case 'costos':        return <CostosPage showToast={showToast}/>;
      case 'incidencias':   return <IncidenciasPage showToast={showToast}/>;
      case 'evidencias':    return <EvidenciasPage showToast={showToast}/>;
      case 'usuarios':      return <UsuariosPage showToast={showToast}/>;
      case 'roles':         return <RolesPage showToast={showToast}/>;
      case 'configuracion': return <ConfiguracionPage showToast={showToast}/>;
      case 'conflictos':    return <ConflictsPage showToast={showToast}/>;
      default:              return <ComingSoon page={page}/>;
    }
  };

  if (auth?.loading) {
    return (
      <div style={{ minHeight:'100vh', background:'#0D1520', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--ts)', fontSize:13 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ width:18, height:18, borderRadius:'50%', border:'2px solid rgba(242,183,5,0.3)', borderTopColor:'var(--amber)', display:'inline-block', animation:'spin .7s linear infinite' }}/>
          Cargando JARVEX…
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!auth?.profile) return <LoginScreen onLogin={(email, pass) => auth.login(email, pass)}/>;

  return (
    <div style={{ display:'flex', height:'100vh', overflow:'hidden' }}>
      <Sidebar current={page} onNav={p=>{setPage(p);}} collapsed={collapsed} onToggle={()=>setCollapsed(c=>!c)}/>
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minWidth:0 }}>
        <Header page={page}
                onToggleSidebar={()=>setCollapsed(c=>!c)}
                onLogout={()=>auth.logout()}
                profile={auth.profile}
                obraActiva={obraActiva}
                syncStatus={syncStatus}
                onSync={()=>sync.sync && sync.sync()}/>
        <div style={{ flex:1, overflow:'hidden', background:'var(--bg-p)' }} key={page}>
          {renderPage()}
        </div>
      </div>
      {toast && <Toast key={toast.key} message={toast.msg} type={toast.type} onDone={()=>setToast(null)}/>}
    </div>
  );
}

// En el build de Vite, main.jsx monta el árbol con AuthContext.
// Solo registramos App en window para que Root() lo pueda usar.
Object.assign(window, { App });