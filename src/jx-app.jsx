import React from "react";
const { useState: uSA, useEffect: uEA, useCallback: uCA } = React;

// Hook compartido: detecta viewport móvil
function useIsMobileApp() {
  const [m, setM] = uSA(() => typeof window !== 'undefined' ? window.innerWidth <= 768 : false);
  uEA(() => {
    const onR = () => setM(window.innerWidth <= 768);
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);
  return m;
}

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

// ── RESET PASSWORD MODAL (solicitar enlace) ───────────────
function ResetPasswordRequestModal({ initialEmail, onClose }) {
  const [email, setEmail] = uSA(initialEmail || '');
  const [loading, setLoading] = uSA(false);
  const [err, setErr] = uSA('');
  const [sent, setSent] = uSA(false);

  const handleSend = async () => {
    setErr('');
    const e = (email || '').trim();
    if (!e) { setErr('Ingresa tu correo electrónico.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { setErr('Correo electrónico inválido.'); return; }
    setLoading(true);
    try {
      const sb = window.__supabase;
      if (!sb) throw new Error('Supabase no disponible (modo offline).');
      const { error } = await sb.auth.resetPasswordForEmail(e, {
        redirectTo: window.location.origin + '/?reset=1',
      });
      if (error) throw error;
      setSent(true);
    } catch (ex) {
      const msg = ex?.message || '';
      if (/invalid email/i.test(msg)) setErr('El correo es inválido.');
      else if (/not found|no user/i.test(msg)) setErr('No existe una cuenta con ese correo.');
      else if (/rate limit/i.test(msg)) setErr('Demasiados intentos. Intenta de nuevo en unos minutos.');
      else setErr(msg || 'Error al enviar el enlace de recuperación.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(8,12,18,0.7)', backdropFilter:'blur(6px)', zIndex:9000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ width:'100%', maxWidth:420, background:'#1C2D40', border:'1px solid rgba(255,255,255,0.1)', borderRadius:14, padding:'28px 28px 22px', boxShadow:'0 24px 80px rgba(0,0,0,0.6)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <div style={{ fontSize:17, fontWeight:800, color:'#F0F2F5' }}>Recuperar Contraseña</div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'#5A6A7A', cursor:'pointer', padding:4 }}>
            <JxIcon name="x" size={16}/>
          </button>
        </div>

        {sent ? (
          <div>
            <div style={{ background:'rgba(46,204,113,0.08)', border:'1px solid rgba(46,204,113,0.25)', borderRadius:8, padding:'14px 16px', fontSize:12.5, color:'#7BD99B', marginBottom:14, lineHeight:1.5 }}>
              Te enviamos un enlace a <strong>{email}</strong>. Revisa tu correo (y la carpeta de spam) y sigue las instrucciones.
            </div>
            <button onClick={onClose} className="btn btn-amber" style={{ width:'100%', justifyContent:'center', padding:'12px' }}>Cerrar</button>
          </div>
        ) : (
          <>
            <div style={{ fontSize:12.5, color:'#5A6A7A', marginBottom:14, lineHeight:1.5 }}>
              Ingresa tu correo y te enviaremos un enlace para restablecer tu contraseña.
            </div>
            {err && <div style={{ background:'rgba(231,76,60,0.1)', border:'1px solid rgba(231,76,60,0.25)', borderRadius:8, padding:'10px 14px', fontSize:12.5, color:'#EF6B5E', marginBottom:14, display:'flex', gap:8, alignItems:'center' }}>
              <JxIcon name="alertCircle" size={14} color="#EF6B5E"/>{err}
            </div>}
            <div style={{ marginBottom:18 }}>
              <label className="flabel">Correo Electrónico</label>
              <input className="fi" type="email" placeholder="usuario@jarvex.pe" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleSend()} autoFocus/>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={onClose} className="btn btn-ghost" style={{ flex:1, justifyContent:'center', padding:'12px' }}>Cancelar</button>
              <button onClick={handleSend} disabled={loading} className="btn btn-amber" style={{ flex:1, justifyContent:'center', padding:'12px', opacity:loading?0.75:1 }}>
                {loading ? 'Enviando…' : 'Enviar enlace'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── RESET PASSWORD SCREEN (después de click en enlace de email) ───
function ResetPasswordScreen() {
  const [pass, setPass] = uSA('');
  const [pass2, setPass2] = uSA('');
  const [loading, setLoading] = uSA(false);
  const [err, setErr] = uSA('');
  const [done, setDone] = uSA(false);
  const [ready, setReady] = uSA(false);

  // Supabase recovery token llega en hash o como query — el SDK lo procesa
  // automáticamente en background si detectSessionInUrl está habilitado.
  uEA(() => {
    const sb = window.__supabase;
    if (!sb) { setReady(true); return; }
    // Esperar a que la sesión de recovery se establezca
    let cancelled = false;
    const check = async () => {
      try { await sb.auth.getSession(); } catch {}
      if (!cancelled) setReady(true);
    };
    check();
    const sub = sb.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setReady(true);
    });
    return () => { cancelled = true; sub?.data?.subscription?.unsubscribe?.(); };
  }, []);

  const handleSubmit = async () => {
    setErr('');
    if (!pass || pass.length < 8) { setErr('La contraseña debe tener al menos 8 caracteres.'); return; }
    if (pass !== pass2) { setErr('Las contraseñas no coinciden.'); return; }
    setLoading(true);
    try {
      const sb = window.__supabase;
      const { error } = await sb.auth.updateUser({ password: pass });
      if (error) throw error;
      setDone(true);
      setTimeout(() => {
        window.history.replaceState({}, '', '/');
        window.location.reload();
      }, 1800);
    } catch (ex) {
      setErr(ex?.message || 'No se pudo cambiar la contraseña. El enlace puede haber expirado.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight:'100vh', background:'#0D1520', display:'flex', alignItems:'center', justifyContent:'center', position:'relative', overflow:'hidden' }}>
      <CircuitBg/>
      <div style={{ position:'relative', zIndex:1, width:'100%', maxWidth:420, padding:'0 20px' }}>
        <div style={{ background:'rgba(28,45,64,0.85)', backdropFilter:'blur(20px)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:16, padding:'40px 36px', boxShadow:'0 24px 80px rgba(0,0,0,0.6)' }}>
          <div style={{ textAlign:'center', marginBottom:24 }}>
            <img src="/jarvex-logo.png" alt="JARVEX" style={{ height:60, objectFit:'contain', marginBottom:6 }} onError={e=>{ e.target.style.display='none'; }}/>
            <div style={{ fontSize:11, color:'#405565', letterSpacing:'.16em', fontWeight:600, textTransform:'uppercase' }}>Restablecer Contraseña</div>
          </div>

          {done ? (
            <div style={{ background:'rgba(46,204,113,0.08)', border:'1px solid rgba(46,204,113,0.25)', borderRadius:8, padding:'14px 16px', fontSize:13, color:'#7BD99B', textAlign:'center', lineHeight:1.5 }}>
              Contraseña actualizada. Redirigiendo al inicio de sesión…
            </div>
          ) : (
            <>
              <div style={{ fontSize:12.5, color:'#5A6A7A', marginBottom:18, textAlign:'center' }}>
                Ingresa tu nueva contraseña dos veces.
              </div>
              {err && <div style={{ background:'rgba(231,76,60,0.1)', border:'1px solid rgba(231,76,60,0.25)', borderRadius:8, padding:'10px 14px', fontSize:12.5, color:'#EF6B5E', marginBottom:14, display:'flex', gap:8, alignItems:'center' }}>
                <JxIcon name="alertCircle" size={14} color="#EF6B5E"/>{err}
              </div>}
              <div style={{ marginBottom:14 }}>
                <label className="flabel">Nueva Contraseña</label>
                <input className="fi" type="password" placeholder="Mínimo 8 caracteres" value={pass} onChange={e=>setPass(e.target.value)} disabled={!ready}/>
              </div>
              <div style={{ marginBottom:20 }}>
                <label className="flabel">Confirmar Contraseña</label>
                <input className="fi" type="password" placeholder="Repite la contraseña" value={pass2} onChange={e=>setPass2(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleSubmit()} disabled={!ready}/>
              </div>
              <button onClick={handleSubmit} disabled={loading || !ready} className="btn btn-amber" style={{ width:'100%', justifyContent:'center', padding:'13px', fontSize:14, opacity:(loading || !ready)?0.75:1 }}>
                {loading ? 'Actualizando…' : (ready ? 'Cambiar Contraseña' : 'Verificando enlace…')}
              </button>
              <div style={{ textAlign:'center', marginTop:14 }}>
                <a href="#" style={{ fontSize:12, color:'#3498DB', textDecoration:'none' }} onClick={e=>{ e.preventDefault(); window.history.replaceState({}, '', '/'); window.location.reload(); }}>Volver al inicio de sesión</a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── LOGIN SCREEN ──────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [email, setEmail]   = uSA('admin@jarvex.pe');
  const [pass, setPass]     = uSA('');
  const [loading, setLoad]  = uSA(false);
  const [err, setErr]       = uSA('');
  const [showPass, setShow] = uSA(false);
  const [resetOpen, setResetOpen] = uSA(false);

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
            <a href="#" style={{ fontSize:12, color:'#3498DB', textDecoration:'none' }} onClick={e=>{ e.preventDefault(); setResetOpen(true); }}>¿Olvidaste tu contraseña?</a>
          </div>
        </div>

        <div style={{ textAlign:'center', marginTop:20, fontSize:11, color:'#2A3A4A' }}>
          JARVEX Tecnología, Ingeniería y Proyectos E.I.R.L. · v2.0.0 · © 2026
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      {resetOpen && <ResetPasswordRequestModal initialEmail={email} onClose={()=>setResetOpen(false)}/>}
    </div>
  );
}

// ── HEADER BAR ────────────────────────────────────────────
function Header({ page, onToggleSidebar, onLogout, profile, obraActiva, syncStatus, onSync, isMobile }) {
  const pageLabels = {
    dashboard:'Dashboard',obras:'Obras / Proyectos',reportes:'Reportes',
    personal:'Personal',asistencia:'Asistencia',materiales:'Materiales',
    'mov-materiales':'Movimiento de Materiales','herramientas':'Herramientas',
    'mov-herramientas':'Movimiento de Herramientas',proveedores:'Proveedores',
    evidencias:'Evidencias',partidas:'Partidas',insumos:'Insumos por Partida',
    versiones:'Versiones de Presupuesto',
    cronograma:'Cronograma / Gantt',avance:'Avance de Obra',comparativo:'Planificado vs Real',
    costos:'Costos',incidencias:'Incidencias',usuarios:'Usuarios',roles:'Roles y Permisos',
    configuracion:'Configuración',
    'cont-dashboard':'Dashboard Contable', empresas:'Empresas',
    'movimientos-contables':'Movimientos Contables', intercompany:'Operaciones entre Empresas',
    consolidado:'Consolidado del Grupo',
    'cuentas-bancarias':'Cuentas Bancarias', 'flujo-caja':'Flujo de Caja / Cronograma de Pagos',
    requisiciones:'Requisiciones', 'ordenes-compra':'Órdenes de Compra',
    valorizaciones:'Valorizaciones', 'activos-pesados':'Activos Pesados / Maquinaria',
    'charlas-seguridad':'Charlas de Seguridad', iperc:'IPERC — Matriz de Riesgos',
    epp:'Entregas de EPP',
    'inspecciones-seguridad':'Inspecciones de Seguridad',
    capacitaciones:'Capacitaciones',
    subcontratistas:'Subcontratistas', subcontratos:'Subcontratos',
    'subcontrato-valorizaciones':'Valorizaciones de Subcontrato',
    'personal-contratos':'Contratos Laborales',
    planillas:'Planillas / Sueldos',
    'dashboard-ejecutivo':'Dashboard Ejecutivo',
    conflictos:'Bandeja de Conflictos',
    solicitudes:'Solicitudes de Cambio',
  };

  const notifs = window.__useRealtimeNotifications ? window.__useRealtimeNotifications() : { notifications:[], unreadCount:0, markAllRead:()=>{}, clearAll:()=>{} };
  const [notifOpen, setNotifOpen] = uSA(false);

  const initials = profile
    ? (profile.nombres?.[0] ?? '') + (profile.apellidos?.[0] ?? '')
    : '··';

  const [menu, setMenu] = uSA(false);

  // Selector de obra activa (FEATURE 3)
  const obraHook = window.__useObraActiva ? window.__useObraActiva() : { obras:[], obraId:null, obra:null, setObraActiva:()=>{} };
  const [obraDropdownOpen, setObraDropdownOpen] = uSA(false);
  const handleSelectObra = (id) => {
    setObraDropdownOpen(false);
    if (id === obraHook.obraId) return;
    if (window.__setObraActivaId) window.__setObraActivaId(id);
    // Reload de toda la app: la mayoría de componentes leen la obra al montar.
    setTimeout(() => window.location.reload(), 100);
  };
  const obraDisplay = obraHook.obra || obraActiva;

  return (
    <div style={{ height:58, background:'#0D1822', borderBottom:'1px solid rgba(255,255,255,0.06)', display:'flex', alignItems:'center', paddingLeft: isMobile ? 10 : 16, paddingRight: isMobile ? 10 : 20, gap: isMobile ? 8 : 12, flexShrink:0, zIndex:5 }}>
      <button onClick={onToggleSidebar} className="btn btn-ghost btn-icon" aria-label="Abrir menú"><JxIcon name="menu" size={16}/></button>
      <div style={{ fontSize: isMobile ? 13 : 14, fontWeight:600, color:'var(--tp)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', minWidth:0 }}>{pageLabels[page] || page}</div>
      <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap: isMobile ? 6 : 10, flexShrink:0 }}>
        {syncStatus && (
          <div onClick={onSync} title={isMobile ? syncStatus.label : 'Click para sincronizar ahora'}
               style={{ display:'flex', alignItems:'center', gap:6, padding: isMobile ? '6px' : '4px 10px', borderRadius:20, fontSize:11.5, fontWeight:600, cursor:'pointer', background: syncStatus.bg }}>
            <div style={{ width:7, height:7, borderRadius:'50%', background: syncStatus.color, ...(syncStatus.syncing ? {animation:'pulse 1.2s ease-in-out infinite'} : {}) }}/>
            {!isMobile && <span style={{ color: syncStatus.color }}>{syncStatus.label}</span>}
          </div>
        )}
        {obraDisplay && !isMobile && (
          <div style={{ position:'relative' }}>
            <button
              onClick={()=>setObraDropdownOpen(o=>!o)}
              title="Cambiar obra activa"
              style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 10px', borderRadius:8, fontSize:12, color:'var(--ts)', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', cursor:'pointer' }}>
              <span className="dot-pulse"/>
              <span style={{ maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>Obra: {obraDisplay.nombre_obra}</span>
              <span style={{ fontSize:10, color:'var(--tm)' }}>▾</span>
            </button>
            {obraDropdownOpen && (
              <>
                <div onClick={()=>setObraDropdownOpen(false)} style={{ position:'fixed', inset:0, zIndex:90 }}/>
                <div style={{ position:'absolute', top:38, right:0, width:300, maxHeight:380, overflow:'auto', background:'var(--bg-c)', border:'1px solid var(--border)', borderRadius:10, boxShadow:'0 8px 32px rgba(0,0,0,0.5)', zIndex:100 }}>
                  <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontSize:11, color:'var(--tm)', fontWeight:700, letterSpacing:'.05em', textTransform:'uppercase' }}>Cambiar Obra Activa</div>
                  {(obraHook.obras || []).length === 0 ? (
                    <div style={{ padding:'18px 14px', fontSize:12, color:'var(--tm)', textAlign:'center' }}>No hay obras disponibles</div>
                  ) : (obraHook.obras.map(o => (
                    <button key={o.id} onClick={()=>handleSelectObra(o.id)}
                      style={{ display:'flex', alignItems:'center', gap:10, width:'100%', padding:'11px 14px', background: o.id === obraHook.obraId ? 'rgba(242,183,5,0.08)':'none', border:'none', borderBottom:'1px solid var(--border)', cursor:'pointer', textAlign:'left' }}>
                      <JxIcon name={o.id === obraHook.obraId ? 'checkCircle' : 'building'} size={13} color={o.id === obraHook.obraId ? 'var(--amber)' : 'var(--tm)'}/>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:12.5, color:'var(--tp)', fontWeight: o.id === obraHook.obraId ? 700:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{o.nombre_obra}</div>
                        {o.estado && <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:2, textTransform:'capitalize' }}>{o.estado}</div>}
                      </div>
                    </button>
                  )))}
                </div>
              </>
            )}
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
            <div style={{ position:'absolute', top:42, right: isMobile ? -10 : 0, width: isMobile ? 'calc(100vw - 16px)' : 360, maxWidth: isMobile ? 'calc(100vw - 16px)' : 360, maxHeight:480, overflow:'auto', background:'var(--bg-c)', border:'1px solid var(--border)', borderRadius:10, boxShadow:'0 8px 32px rgba(0,0,0,0.5)', zIndex:100 }}>
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

// ── Detectar flujo de reset (Supabase recovery) ───────────
function isResetFlow() {
  if (typeof window === 'undefined') return false;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('reset') === '1') return true;
    const hash = window.location.hash || '';
    if (hash.includes('access_token=') && hash.includes('type=recovery')) return true;
    if (hash.includes('type=recovery')) return true;
  } catch {}
  return false;
}

// ── MAIN APP ──────────────────────────────────────────────
function App() {
  const auth = window.__useAuth();   // hook expuesto desde main.jsx
  const [resetFlow] = uSA(() => isResetFlow());
  const isMobile = useIsMobileApp();
  const [page, setPage]             = uSA('dashboard');
  // En móvil arrancamos con el drawer cerrado (collapsed=true).
  // En desktop arrancamos con el sidebar expandido (collapsed=false).
  const [collapsed, setCollapsed]   = uSA(() =>
    typeof window !== 'undefined' && window.innerWidth <= 768
  );
  const [toast, setToast]           = uSA(null);
  const [obraActiva, setObraActiva] = uSA(null);

  // Si el viewport cambia entre móvil/desktop, ajustamos el estado del sidebar.
  uEA(() => {
    setCollapsed(isMobile);
  }, [isMobile]);
  const sync = window.__useSync ? window.__useSync() : { syncing:false, pending:0 };
  const online = window.__useOnline ? window.__useOnline() : true;

  const showToast = uCA((msg, type='amber') => setToast({ msg, type, key: Date.now() }), []);

  // Escucha eventos de notificaciones realtime y muestra toast in-app inmediato
  uEA(() => {
    if (!auth?.profile) return;
    const onNotif = (e) => {
      const n = e?.detail;
      if (!n) return;
      const txt = `${n.titulo}${n.descripcion ? ' — ' + n.descripcion : ''}`;
      const tipo = n.tipo === 'change_request' ? 'amber' : n.tipo === 'incidencia' ? 'red' : 'blue';
      showToast(txt, tipo);
    };
    window.addEventListener('jarvex_new_notif', onNotif);
    return () => window.removeEventListener('jarvex_new_notif', onNotif);
  }, [auth?.profile, showToast]);

  // Pedir permiso de notificaciones del navegador una sola vez tras el login.
  // Si el usuario ya respondió (granted o denied), no se vuelve a preguntar.
  uEA(() => {
    if (!auth?.profile) return;
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'default') return;
    const flagKey = 'jarvex_notif_asked';
    if (localStorage.getItem(flagKey)) return;
    // Esperamos 8 segundos tras login para no saturar la primera impresión
    const t = setTimeout(() => {
      try {
        Notification.requestPermission().finally(() => {
          localStorage.setItem(flagKey, '1');
        });
      } catch (e) {}
    }, 8000);
    return () => clearTimeout(t);
  }, [auth?.profile]);

  // Cargar obra activa desde Dexie cuando hay sesión
  // Respeta localStorage.obra_activa_id si existe (FEATURE 3)
  uEA(() => {
    if (!auth?.profile) return;
    const storedId = window.__getObraActivaId ? window.__getObraActivaId() : null;
    window.__db.obras.toArray().then(obras => {
      const visibles = obras.filter(o => !o.deleted_at);
      const activa = (storedId && visibles.find(o => o.id === storedId)) || visibles[0];
      if (activa) setObraActiva(activa);
    });
    const onChange = () => {
      const id = window.__getObraActivaId ? window.__getObraActivaId() : null;
      window.__db.obras.toArray().then(obras => {
        const visibles = obras.filter(o => !o.deleted_at);
        const activa = (id && visibles.find(o => o.id === id)) || visibles[0];
        if (activa) setObraActiva(activa);
      });
    };
    window.addEventListener('obra_activa_change', onChange);
    return () => window.removeEventListener('obra_activa_change', onChange);
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
      case 'versiones':     return <VersionesPage showToast={showToast}/>;
      case 'cronograma':    return <CronogramaPage showToast={showToast}/>;
      case 'avance':        return <AvancePage showToast={showToast}/>;
      case 'comparativo':   return <ComparativoPage showToast={showToast}/>;
      case 'costos':        return <CostosPage showToast={showToast}/>;
      case 'incidencias':   return <IncidenciasPage showToast={showToast}/>;
      case 'evidencias':    return <EvidenciasPage showToast={showToast}/>;
      case 'usuarios':      return <UsuariosPage showToast={showToast}/>;
      case 'roles':         return <RolesPage showToast={showToast}/>;
      case 'configuracion': return <ConfiguracionPage showToast={showToast}/>;
      case 'cont-dashboard':         return <ContabilidadDashboardPage showToast={showToast}/>;
      case 'empresas':               return <EmpresasPage showToast={showToast}/>;
      case 'movimientos-contables':  return <MovimientosContablesPage showToast={showToast}/>;
      case 'intercompany':           return <IntercompanyPage showToast={showToast}/>;
      case 'consolidado':            return <ConsolidadoPage showToast={showToast}/>;
      case 'cuentas-bancarias':      return <CuentasBancariasPage showToast={showToast}/>;
      case 'flujo-caja':             return <FlujoCajaPage showToast={showToast}/>;
      case 'requisiciones':          return <RequisicionesPage showToast={showToast}/>;
      case 'ordenes-compra':         return <OrdenesCompraPage showToast={showToast}/>;
      case 'valorizaciones':         return <ValorizacionesPage showToast={showToast}/>;
      case 'activos-pesados':        return <ActivosPesadosPage showToast={showToast}/>;
      case 'charlas-seguridad':      return <CharlasSeguridadPage showToast={showToast}/>;
      case 'iperc':                  return <IpercPage showToast={showToast}/>;
      case 'epp':                    return <EppPage showToast={showToast}/>;
      case 'subcontratistas':        return <SubcontratistasPage showToast={showToast}/>;
      case 'subcontratos':           return <SubcontratosPage showToast={showToast}/>;
      case 'planillas':              return <PlanillasPage showToast={showToast}/>;
      case 'inspecciones-seguridad': return <InspeccionesSeguridadPage showToast={showToast}/>;
      case 'capacitaciones':         return <CapacitacionesPage showToast={showToast}/>;
      case 'subcontrato-valorizaciones': return <SubcontratoValorizacionesPage showToast={showToast}/>;
      case 'personal-contratos':     return <PersonalContratosPage showToast={showToast}/>;
      case 'dashboard-ejecutivo':    return <DashboardEjecutivoPage showToast={showToast}/>;
      case 'conflictos':    return <ConflictsPage showToast={showToast}/>;
      case 'solicitudes':   return <SolicitudesPage showToast={showToast}/>;
      default:              return <ComingSoon page={page}/>;
    }
  };

  // Si la URL indica un flujo de recuperación de contraseña, mostrar la pantalla
  // de reset ANTES de Login/App (incluso si hay sesión transitoria por el token).
  if (resetFlow) return <ResetPasswordScreen/>;

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
                onSync={()=>sync.sync && sync.sync()}
                isMobile={isMobile}/>
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