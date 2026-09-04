import React from "react";
import { trackPageView } from "./lib/posthog.js";
import SyncDetailModal from "./components/SyncDetailModal.jsx";
import BotonAyuda from "./components/jx-ayuda.jsx";
import { planoDe, resolveLanding, areaDe } from "./lib/nav-planos.js";
import { getEmpresaActivaId, EMPRESA_ACTIVA_EVENT } from "./lib/empresa-activa.js";
import { esPaginaDeEmpresa } from "./lib/desglose-empresa.js";
import { cargarObrasAsignadas } from "./lib/obras-asignadas.js";
import { tomarPaginaTrasCambioDeTema } from "./lib/tema.js";
import { empujarHistorial, sacarHistorial, puedeVolver } from "./lib/nav-historial.js";

// Sección a la que volver tras el reload por cambio de tema. Se lee (y consume)
// UNA vez por carga de página, acá a nivel de módulo: dentro de un useState
// initializer el doble render de StrictMode lo consumiría dos veces.
const __volverTrasTema = tomarPaginaTrasCambioDeTema();
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
  const colors = { green: 'var(--green)', red: 'var(--red)', amber: 'var(--amber)', blue: 'var(--blue)' };
  const icons  = { green: 'checkCircle', red: 'alertCircle', amber: 'bell', blue: 'alertCircle' };
  const c = colors[type] || colors.amber;
  return (
    <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999, animation:'fadeUp .3s ease', display:'flex', alignItems:'center', gap:12, background:'var(--bg-c2)', border:`1px solid color-mix(in srgb, ${c} 25%, transparent)`, borderLeft:`3px solid ${c}`, borderRadius:10, padding:'14px 18px', boxShadow:'0 8px 32px rgba(0,0,0,0.5)', maxWidth:380 }}>
      <JxIcon name={icons[type]||'checkCircle'} size={16} color={c}/>
      <span style={{ fontSize:13, color:'var(--tp)', fontWeight:500 }}>{message}</span>
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
      <div style={{ width:'100%', maxWidth:420, background:'var(--bg-c)', border:'1px solid var(--border-h)', borderRadius:14, padding:'28px 28px 22px', boxShadow:'0 24px 80px rgba(0,0,0,0.6)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <div style={{ fontSize:17, fontWeight:800, color:'var(--tp)' }}>Recuperar Contraseña</div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--tm)', cursor:'pointer', padding:4 }}>
            <JxIcon name="x" size={16}/>
          </button>
        </div>

        {sent ? (
          <div>
            <div style={{ background:'rgba(46,204,113,0.08)', border:'1px solid rgba(46,204,113,0.25)', borderRadius:8, padding:'14px 16px', fontSize:12.5, color:'var(--green)', marginBottom:14, lineHeight:1.5 }}>
              Te enviamos un enlace a <strong>{email}</strong>. Revisa tu correo (y la carpeta de spam) y sigue las instrucciones.
            </div>
            <button onClick={onClose} className="btn btn-amber" style={{ width:'100%', justifyContent:'center', padding:'12px' }}>Cerrar</button>
          </div>
        ) : (
          <>
            <div style={{ fontSize:12.5, color:'var(--tm)', marginBottom:14, lineHeight:1.5 }}>
              Ingresa tu correo y te enviaremos un enlace para restablecer tu contraseña.
            </div>
            {err && <div style={{ background:'rgba(231,76,60,0.1)', border:'1px solid rgba(231,76,60,0.25)', borderRadius:8, padding:'10px 14px', fontSize:12.5, color:'var(--red)', marginBottom:14, display:'flex', gap:8, alignItems:'center' }}>
              <JxIcon name="alertCircle" size={14} color="var(--red)"/>{err}
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
    <div style={{ minHeight:'100vh', background:'var(--bg-p)', display:'flex', alignItems:'center', justifyContent:'center', position:'relative', overflow:'hidden' }}>
      <CircuitBg/>
      <div style={{ position:'relative', zIndex:1, width:'100%', maxWidth:420, padding:'0 20px' }}>
        <div style={{ background:'var(--bg-glass)', backdropFilter:'blur(20px)', border:'1px solid var(--border-h)', borderRadius:16, padding:'40px 36px', boxShadow:'0 24px 80px rgba(0,0,0,0.6)' }}>
          <div style={{ textAlign:'center', marginBottom:24 }}>
            <img src="/jarvex-logo.png" alt="JARVEX" style={{ height:60, objectFit:'contain', marginBottom:6 }} onError={e=>{ e.target.style.display='none'; }}/>
            <div style={{ fontSize:11, color:'var(--tm)', letterSpacing:'.16em', fontWeight:600, textTransform:'uppercase' }}>Restablecer Contraseña</div>
          </div>

          {done ? (
            <div style={{ background:'rgba(46,204,113,0.08)', border:'1px solid rgba(46,204,113,0.25)', borderRadius:8, padding:'14px 16px', fontSize:13, color:'var(--green)', textAlign:'center', lineHeight:1.5 }}>
              Contraseña actualizada. Redirigiendo al inicio de sesión…
            </div>
          ) : (
            <>
              <div style={{ fontSize:12.5, color:'var(--tm)', marginBottom:18, textAlign:'center' }}>
                Ingresa tu nueva contraseña dos veces.
              </div>
              {err && <div style={{ background:'rgba(231,76,60,0.1)', border:'1px solid rgba(231,76,60,0.25)', borderRadius:8, padding:'10px 14px', fontSize:12.5, color:'var(--red)', marginBottom:14, display:'flex', gap:8, alignItems:'center' }}>
                <JxIcon name="alertCircle" size={14} color="var(--red)"/>{err}
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
                <a href="#" style={{ fontSize:12, color:'var(--blue)', textDecoration:'none' }} onClick={e=>{ e.preventDefault(); window.history.replaceState({}, '', '/'); window.location.reload(); }}>Volver al inicio de sesión</a>
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
  // Email arranca vacío — el placeholder muestra el formato sugerido sin pre-llenar
  const [email, setEmail]   = uSA('');
  const [pass, setPass]     = uSA('');
  const [loading, setLoad]  = uSA(false);
  const [err, setErr]       = uSA(() => {
    // Si la sesión anterior se cerró por inactividad, mostramos motivo aquí
    try {
      const reason = sessionStorage.getItem('jx_logout_reason');
      if (reason === 'inactivity') {
        sessionStorage.removeItem('jx_logout_reason');
        return 'Tu sesión se cerró por inactividad. Volvé a iniciar sesión.';
      }
    } catch {}
    return '';
  });
  const [showPass, setShow] = uSA(false);
  const [resetOpen, setResetOpen] = uSA(false);
  // Acceso rápido de CAMPO: email FIJO de la cuenta compartida (el admin la
  // crea en Usuarios con rol 'campo' y este correo EXACTO; el PIN es su
  // contraseña). No es un secreto — sin el PIN no abre nada, y el rol campo
  // solo puede subir fotos de facturas (cerco RLS mig 155).
  const CAMPO_EMAIL = 'campo@jarvex.pe';
  const [campoOpen, setCampoOpen] = uSA(false);
  const [campoPin, setCampoPin] = uSA('');

  const handleCampoLogin = async () => {
    const pin = campoPin.trim();
    if (!/^\d{4,8}$/.test(pin)) { setErr('El PIN es de 4 a 8 dígitos — pedíselo al administrador.'); return; }
    setErr(''); setLoad(true);
    try {
      await onLogin(CAMPO_EMAIL, pin);
    } catch (e) {
      const m = e.message || '';
      // 'Invalid login' cubre DOS casos: PIN malo O que el admin nunca creó la
      // cuenta campo@jarvex.pe — no afirmar categóricamente "PIN incorrecto".
      setErr(m.includes('Invalid login')
        ? 'No se pudo entrar: PIN incorrecto, o el administrador todavía no creó el acceso de campo. Avisale al admin.'
        : m.includes('Email not confirmed')
          ? 'El acceso de campo está pendiente de confirmación — avisale al administrador.'
          : (m || 'Error al ingresar.'));
      setLoad(false);
    }
  };

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
    <div style={{ minHeight:'100vh', background:'var(--bg-p)', display:'flex', alignItems:'center', justifyContent:'center', position:'relative', overflow:'hidden' }}>
      <CircuitBg/>

      {/* Glow orbs */}
      <div style={{ position:'absolute', top:'20%', left:'15%', width:400, height:400, borderRadius:'50%', background:'radial-gradient(circle,rgba(52,152,219,0.08) 0%,transparent 70%)', pointerEvents:'none' }}/>
      <div style={{ position:'absolute', bottom:'20%', right:'15%', width:350, height:350, borderRadius:'50%', background:'radial-gradient(circle,rgba(242,183,5,0.06) 0%,transparent 70%)', pointerEvents:'none' }}/>

      <div style={{ position:'relative', zIndex:1, width:'100%', maxWidth:420, padding:'0 20px' }}>
        {/* Card */}
        <div style={{ background:'var(--bg-glass)', backdropFilter:'blur(20px)', border:'1px solid var(--border-h)', borderRadius:16, padding:'40px 36px', boxShadow:'0 24px 80px rgba(0,0,0,0.6)' }}>

          {/* Logo */}
          <div style={{ textAlign:'center', marginBottom:32 }}>
            <img src="/jarvex-logo.png" alt="JARVEX" style={{ height:70, objectFit:'contain', marginBottom:6 }}
              onError={e=>{ e.target.style.display='none'; }}/>
            <div style={{ fontSize:11, color:'var(--tm)', letterSpacing:'.16em', fontWeight:600, textTransform:'uppercase' }}>Sistema de Gestión de Obras</div>
          </div>

          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:22, fontWeight:800, color:'var(--tp)', letterSpacing:'-.02em', marginBottom:4 }}>Iniciar Sesión</div>
            <div style={{ fontSize:12.5, color:'var(--tm)' }}>Accede a tu plataforma de control de obra</div>
          </div>

          {err && <div style={{ background:'rgba(231,76,60,0.1)', border:'1px solid rgba(231,76,60,0.25)', borderRadius:8, padding:'10px 14px', fontSize:12.5, color:'var(--red)', marginBottom:14, display:'flex', gap:8, alignItems:'center' }}>
            <JxIcon name="alertCircle" size={14} color="var(--red)"/>{err}
          </div>}

          <div style={{ marginBottom:14 }}>
            <label className="flabel">Correo Electrónico</label>
            <div style={{ position:'relative' }}>
              <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}>
                <JxIcon name="user" size={14} color="var(--tm)"/>
              </span>
              <input className="fi" type="email" placeholder="usuario@jarvex.pe" value={email} onChange={e=>setEmail(e.target.value)} style={{ paddingLeft:36 }} onKeyDown={e=>e.key==='Enter'&&handleLogin()}/>
            </div>
          </div>

          <div style={{ marginBottom:22 }}>
            <label className="flabel">Contraseña</label>
            <div style={{ position:'relative' }}>
              <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}>
                <JxIcon name="lock" size={14} color="var(--tm)"/>
              </span>
              <input className="fi" type={showPass?'text':'password'} placeholder="••••••••" value={pass} onChange={e=>setPass(e.target.value)} style={{ paddingLeft:36, paddingRight:40 }} onKeyDown={e=>e.key==='Enter'&&handleLogin()}/>
              <button onClick={()=>setShow(!showPass)} style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'var(--tm)', display:'flex', padding:2 }}>
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
            <a href="#" style={{ fontSize:12, color:'var(--blue)', textDecoration:'none' }} onClick={e=>{ e.preventDefault(); setResetOpen(true); }}>¿Olvidaste tu contraseña?</a>
          </div>

          {/* ── Acceso rápido de CAMPO (mejora 2): la cuenta compartida campo@
              entra solo con el PIN que reparte el admin. Aterriza directo en el
              portal de captura de facturas (resolveLanding) y no ve nada más
              (allowlist + cerco RLS mig 155). ── */}
          <div style={{ marginTop:18, paddingTop:14, borderTop:'1px solid var(--border)' }}>
            {!campoOpen ? (
              <button onClick={()=>setCampoOpen(true)} className="btn btn-ghost" style={{ width:'100%', justifyContent:'center', padding:'11px', fontSize:13 }}>
                📸 Personal de campo: subir factura de una compra
              </button>
            ) : (
              <div>
                <label className="flabel">PIN de campo (te lo da el administrador)</label>
                {/* PIN NUMÉRICO de 4-8 dígitos (decisión de Gabriel): teclado
                    numérico del celular y filtro de solo dígitos. */}
                <input className="fi" type="password" inputMode="numeric" maxLength={8} placeholder="PIN de 4 a 8 dígitos" value={campoPin}
                  onChange={e=>setCampoPin(e.target.value.replace(/\D/g, ''))} style={{ fontSize:16, textAlign:'center', letterSpacing:'.3em' }}
                  onKeyDown={e=>e.key==='Enter'&&handleCampoLogin()}/>
                <div style={{ display:'flex', gap:8, marginTop:8 }}>
                  <button onClick={handleCampoLogin} disabled={loading} className="btn btn-amber" style={{ flex:1, justifyContent:'center', padding:'11px', fontSize:13 }}>
                    {loading ? 'Verificando…' : '📸 Entrar y subir factura'}
                  </button>
                  <button onClick={()=>{ setCampoOpen(false); setCampoPin(''); }} className="btn btn-ghost" style={{ padding:'11px' }}>✕</button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ textAlign:'center', marginTop:20, fontSize:11, color:'var(--tm)' }}>
          JARVEX Tecnología, Ingeniería y Proyectos E.I.R.L. · v2.0.0 · © 2026
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      {resetOpen && <ResetPasswordRequestModal initialEmail={email} onClose={()=>setResetOpen(false)}/>}
    </div>
  );
}

// ── HEADER BAR ────────────────────────────────────────────
function Header({ page, plano = 'obra', onInicio, onVolver, puedeVolver, onToggleSidebar, onLogout, profile, obraActiva, syncStatus, onSync, isMobile, notifs: notifsProp }) {
  const pageLabels = {
    inicio:'Inicio',
    dashboard:'Dashboard',obras:'Obras / Proyectos',reportes:'Reportes',
    personal:'Personal',asistencia:'Asistencia',materiales:'Materiales',
    'mov-materiales':'Movimiento de Materiales','herramientas':'Herramientas',
    'mov-herramientas':'Movimiento de Herramientas',proveedores:'Proveedores',
    evidencias:'Evidencias',plantillas:'Plantillas','vinculacion-salidas':'Vinculación de Salidas','dashboard-tecnico':'Dashboard Técnico','mis-partidas':'Partidas del Proyecto','cronograma-frente':'Cronograma de mis Partidas','salidas-frente':'Vinculación de insumos','reporte-diario':'Reporte Diario','borradores-reporte':'Borradores','mis-reportes':'Mis Reportes','detalle-partida':'Detalle de partida','plan-real':'Plan vs Real','emitir-alerta':'Emitir Alerta','aprobaciones-reporte':'Aprobación de Frentes','rendimiento-ingenieros':'Rendimiento de Ingenieros','control-consumo':'Control de Consumo',partidas:'Partidas',insumos:'Insumos por Partida','dashboard-gestion':'Dashboard Gestión de Obra','movimientos-insumos':'Movimientos de Insumos',
    versiones:'Versiones de Presupuesto',
    cronograma:'Cronograma / Gantt',avance:'Avance de Obra',comparativo:'Planificado vs Real',
    costos:'Costos',incidencias:'Incidencias',usuarios:'Usuarios',roles:'Roles y Permisos',
    configuracion:'Configuración',
    'contabilidad':'Contabilidad',
    'cont-dashboard':'Dashboard Contable', 'conciliacion-insumos':'Conciliación de Insumos', empresas:'Empresas',
    'bienes-servicios':'Bienes y Servicios', trabajos:'Trabajos',
    'panel-obra':'Panel del trabajo',
    pagos:'Pagos',
    'guias-remision':'Guías de Remisión',
    profesionales:'Registro Profesional',
    'movimientos-contables':'Movimientos Contables', intercompany:'Operaciones entre Empresas',
    consolidado:'Consolidado del Grupo',
    trazabilidad:'Cadenas Intercompany de la obra',
    'compras-categoria':'Compras por Categoría',
    'analisis-insumos':'Análisis de Insumos',
    'captura-campo':'Captura de Campo',
    'ordenes-intercompany':'Órdenes Intercompany',
    'captura-magica':'✨ Captura Mágica',
    'cuentas-bancarias':'Cuentas Bancarias', 'flujo-caja':'Flujo de Caja / Cronograma de Pagos',
    'solicitud-residente':'Solicitud de Insumos', 'compras-pendientes':'Vinculación de Compras',
    'reporte-especialidad':'Reporte Diario de Especialidad', 'panel-residente':'Panel del Residente',
    'charlas-plan':'Planificador de Charlas', 'sctr-personal':'SCTR del Personal', 'inducciones':'Inducciones',
    'gestion-ambiental':'Gestión Ambiental',
    'gestion-calidad':'Gestión de Calidad',
    'gestion-social':'Gestión Social',
    requisiciones:'Requisiciones', 'ordenes-compra':'Órdenes de Compra',
    ordenes:'Órdenes de Compra y Servicio',
    valorizaciones:'Valorizaciones', 'activos-pesados':'Activos Pesados / Maquinaria',
    'charlas-seguridad':'Charlas de Seguridad', iperc:'IPERC — Matriz de Riesgos',
    epp:'Entregas de EPP',
    'mov-epp':'Movimientos de EPPs',
    'inspecciones-seguridad':'Inspecciones de Seguridad',
    capacitaciones:'Capacitaciones',
    subcontratistas:'Subcontratistas', subcontratos:'Subcontratos',
    'subcontrato-valorizaciones':'Valorizaciones de Subcontrato',
    'personal-contratos':'Contratos Laborales',
    planillas:'Planillas / Sueldos',
    'dashboard-ejecutivo':'Dashboard Ejecutivo','dashboard-gestion':'Dashboard Gestión de Obra','movimientos-insumos':'Movimientos de Insumos',
    conflictos:'Bandeja de Conflictos',
    solicitudes:'Solicitudes de Cambio',
  };

  // notifs viene como prop desde App() para compartir una sola suscripción
  // realtime entre Header y Sidebar (sin crear dos canales).
  const notifs = notifsProp || { notifications:[], unreadCount:0, markAllRead:()=>{}, clearAll:()=>{} };
  const [notifOpen, setNotifOpen] = uSA(false);

  const initials = profile
    ? (profile.nombres?.[0] ?? '') + (profile.apellidos?.[0] ?? '')
    : '··';

  const [menu, setMenu] = uSA(false);

  // Selector de obra activa (FEATURE 3)
  // Solo admin y gerente pueden cambiar de obra. Otros roles ven solo la
  // obra que el admin les asignó (sin dropdown).
  const obraHook = window.__useObraActiva ? window.__useObraActiva() : { obras:[], obraId:null, obra:null, setObraActiva:()=>{} };
  const [obraDropdownOpen, setObraDropdownOpen] = uSA(false);
  // Cambio rápido de obra: admin/gerente + los roles contables que trabajan
  // entre varias obras (la contadora salta de una obra a otra para conciliar).
  const canSwitchObra = ['admin', 'gerente', 'contador', 'ayudante_contador'].includes(profile?.rol);
  const handleSelectObra = (id) => {
    setObraDropdownOpen(false);
    if (!canSwitchObra) return;
    if (id === obraHook.obraId) return;
    // Ventana de seguridad: cambiar de obra re-apunta TODOS los módulos
    // (almacén, personal, caja chica, Captura Mágica…). Un click accidental
    // acá puede hacer que el usuario registre movimientos en la obra
    // equivocada sin darse cuenta.
    const destino = (obraHook.obras || []).find(o => o.id === id);
    const actual = obraDisplay?.nombre_obra || '(obra actual)';
    if (!confirm(
      `¿Cambiar de obra activa?\n\n` +
      `De: ${actual}\n` +
      `A:  ${destino?.nombre_obra || '(obra)'}\n\n` +
      `TODOS los módulos (almacén, movimientos, personal, caja chica, ` +
      `Captura Mágica…) pasarán a mostrar y registrar sobre la obra nueva. ` +
      `Te quedás en la misma pantalla, ahora sobre la obra nueva.`
    )) return;
    // SIN recarga: el `key` del contenedor incluye la obra activa, así la página
    // actual se remonta sola sobre la obra nueva y el usuario no sale de donde está.
    if (window.__setObraActivaId) window.__setObraActivaId(id);
  };
  const obraDisplay = obraHook.obra || obraActiva;

  return (
    <div style={{ height:58, background:'var(--bg-header)', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', paddingLeft: isMobile ? 10 : 16, paddingRight: isMobile ? 10 : 20, gap: isMobile ? 8 : 12, flexShrink:0, zIndex:5 }}>
      {page !== 'inicio' && (
        <button onClick={onToggleSidebar} className="btn btn-ghost btn-icon" aria-label="Abrir menú"><JxIcon name="menu" size={16}/></button>
      )}
      {page !== 'inicio' && puedeVolver && onVolver && profile?.rol !== 'campo' && (
        <button onClick={onVolver} className="btn btn-ghost btn-sm" title="Volver a la pantalla anterior"
                style={{ display:'flex', alignItems:'center', gap:4, color:'var(--ts)', flexShrink:0 }}>
          <JxIcon name="chevL" size={14}/>{!isMobile && 'Volver'}
        </button>
      )}
      {page !== 'inicio' && onInicio && profile?.rol !== 'campo' && (
        <button onClick={onInicio} className="btn btn-ghost btn-sm" title="Ir al inicio"
                style={{ display:'flex', alignItems:'center', gap:4, color:'var(--ts)', flexShrink:0 }}>
          <JxIcon name="dashboard" size={14}/>{!isMobile && 'Inicio'}
        </button>
      )}
      <div style={{ fontSize: isMobile ? 13 : 14, fontWeight:600, color:'var(--tp)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', minWidth:0 }}>{pageLabels[page] || page}</div>
      <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap: isMobile ? 6 : 10, flexShrink:0 }}>
        {syncStatus && (
          <div onClick={onSync} title={isMobile ? syncStatus.label : 'Click para sincronizar ahora'}
               style={{ display:'flex', alignItems:'center', gap:6, padding: isMobile ? '6px' : '4px 10px', borderRadius:20, fontSize:11.5, fontWeight:600, cursor:'pointer', background: syncStatus.bg }}>
            <div style={{ width:7, height:7, borderRadius:'50%', background: syncStatus.color, ...(syncStatus.syncing ? {animation:'pulse 1.2s ease-in-out infinite'} : {}) }}/>
            {!isMobile && <span style={{ color: syncStatus.color }}>{syncStatus.label}</span>}
          </div>
        )}
        {plano === 'obra' && obraDisplay && !isMobile && (
          <div style={{ position:'relative' }}>
            <button
              onClick={canSwitchObra ? (()=>setObraDropdownOpen(o=>!o)) : undefined}
              title={canSwitchObra ? 'Cambiar obra activa' : 'Obra asignada por el administrador'}
              style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 10px', borderRadius:8, fontSize:12, color:'var(--ts)', background:'var(--tint-neutral)', border:'1px solid var(--border)', cursor: canSwitchObra ? 'pointer' : 'default' }}>
              <span className="dot-pulse"/>
              <span style={{ maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>Obra: {obraDisplay.nombre_obra}</span>
              {canSwitchObra && <span style={{ fontSize:10, color:'var(--tm)' }}>▾</span>}
            </button>
            {canSwitchObra && obraDropdownOpen && (
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
        {/* Ayuda contextual de la sección activa (personalizada por rol). */}
        <BotonAyuda page={page} rol={profile?.rol}/>
        <div style={{ position:'relative' }}>
          <button className="btn btn-ghost btn-icon"
                  onClick={() => { setNotifOpen(o => !o); if (!notifOpen) notifs.markAllRead(); }}
                  style={{ position:'relative' }}>
            <JxIcon name="bell" size={16}/>
            {notifs.unreadCount > 0 && (
              <span style={{ position:'absolute', top:2, right:2, minWidth:14, height:14, borderRadius:7, background:'var(--red)', color:'white', fontSize:9, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center', padding:'0 3px', border:'1.5px solid var(--bg-header)' }}>
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
        {/* Menú de usuario: nombre/rol + Cerrar sesión. Visible en TODAS las
            pantallas (incluido Inicio, donde no hay sidebar con logout). */}
        <div style={{ position:'relative' }}>
          <button className="btn btn-ghost btn-icon" onClick={()=>setMenu(o=>!o)} title={`${profile?.nombres||''} ${profile?.apellidos||''}`.trim() || profile?.email || 'Cuenta'} aria-label="Cuenta">
            <span style={{ width:26, height:26, borderRadius:'50%', background:'var(--amber)', color:'#0D1822', fontSize:12, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center' }}>
              {(profile?.nombres?.[0] || profile?.email?.[0] || '?').toUpperCase()}
            </span>
          </button>
          {menu && (
            <>
              <div onClick={()=>setMenu(false)} style={{ position:'fixed', inset:0, zIndex:90 }}/>
              <div style={{ position:'absolute', top:42, right:0, width:240, background:'var(--bg-c)', border:'1px solid var(--border)', borderRadius:10, boxShadow:'0 8px 32px rgba(0,0,0,0.5)', zIndex:100, overflow:'hidden' }}>
                <div style={{ padding:'12px 14px', borderBottom:'1px solid var(--border)' }}>
                  <div style={{ fontSize:13, fontWeight:700, color:'var(--tp)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{`${profile?.nombres||''} ${profile?.apellidos||''}`.trim() || profile?.email || 'Usuario'}</div>
                  {profile?.rol && <div style={{ fontSize:11, color:'var(--tm)', marginTop:2, textTransform:'capitalize' }}>{String(profile.rol).replace(/_/g,' ')}</div>}
                </div>
                <button onClick={()=>{ setMenu(false); onLogout?.(); }}
                  style={{ display:'flex', alignItems:'center', gap:10, width:'100%', padding:'12px 14px', background:'none', border:'none', cursor:'pointer', textAlign:'left', color:'var(--red)', fontSize:13, fontWeight:600 }}>
                  <JxIcon name="logout" size={15} color="var(--red)"/> Cerrar sesión
                </button>
              </div>
            </>
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

// ── LAZY PAGE WRAPPER ─────────────────────────────────────
// Carga el chunk dinámicamente y, una vez registrado window[component],
// renderiza el componente con las props provistas. Mientras tanto muestra
// un spinner. Patrón window.* preservado (no se refactoriza a ES imports).
const PAGE_REGISTRY = {
  // pageId → { chunk: 'jx-XXX', component: 'WindowExportName' }
  // === jx-almacen (lazy) ===
  'materiales':             { chunk: 'jx-almacen', component: 'MaterialesPage' },
  'herramientas':           { chunk: 'jx-almacen', component: 'HerramientasPage' },
  'personal':               { chunk: 'jx-almacen', component: 'PersonalPage' },
  'asistencia':             { chunk: 'jx-almacen', component: 'AsistenciaPage' },
  // === jx-obra ===
  'obras':                  { chunk: 'jx-obra', component: 'ObrasPage' },
  'partidas':               { chunk: 'jx-obra', component: 'PartidasPage' },
  'cronograma':             { chunk: 'jx-obra', component: 'CronogramaPage' },
  'avance':                 { chunk: 'jx-obra', component: 'AvancePage' },
  'comparativo':            { chunk: 'jx-obra', component: 'ComparativoPage' },
  // === jx-gestion ===
  'insumos':                { chunk: 'jx-gestion', component: 'InsumosPage' },
  'costos':                 { chunk: 'jx-gestion', component: 'CostosPage' },
  'incidencias':            { chunk: 'jx-gestion', component: 'IncidenciasPage' },
  'versiones':              { chunk: 'jx-gestion', component: 'VersionesPage' },
  // === jx-movimientos ===
  'mov-materiales':         { chunk: 'jx-movimientos', component: 'MovMaterialesPage' },
  'mov-herramientas':       { chunk: 'jx-movimientos', component: 'MovHerramientasPage' },
  'proveedores':            { chunk: 'jx-movimientos', component: 'ProveedoresPage' },
  // === jx-caja-chica ===
  'caja-chica':             { chunk: 'jx-caja-chica', component: 'CajaChicaPage' },
  // === jx-ubicaciones ===
  'ubicaciones':            { chunk: 'jx-ubicaciones', component: 'UbicacionesPage' },
  'frentes':                { chunk: 'jx-frentes', component: 'FrentesPage' },
  // === jx-evidencias ===
  'evidencias':             { chunk: 'jx-evidencias', component: 'EvidenciasPage' },
  'plantillas':             { chunk: 'jx-evidencias', component: 'PlantillasPage' },
  // === jx-ingeniero ===
  'vinculacion-salidas':    { chunk: 'jx-ingeniero', component: 'IngenieroInboxPage' },
  'control-consumo':        { chunk: 'jx-control-consumo', component: 'ControlConsumoPage' },
  'dashboard-tecnico':      { chunk: 'jx-mi-frente', component: 'DashboardTecnicoPage' },
  'mis-partidas':           { chunk: 'jx-mi-frente', component: 'MisPartidasPage' },
  'cronograma-frente':      { chunk: 'jx-mi-frente', component: 'CronogramaFrentePage' },
  'salidas-frente':         { chunk: 'jx-mi-frente', component: 'SalidasFrentePage' },
  'reporte-diario':         { chunk: 'jx-mi-frente', component: 'ReporteDiarioPage' },
  'borradores-reporte':     { chunk: 'jx-mi-frente', component: 'BorradoresPage' },
  'mis-reportes':           { chunk: 'jx-mi-frente', component: 'MisReportesPage' },
  'detalle-partida':        { chunk: 'jx-mi-frente', component: 'DetallePartidaPage' },
  'plan-real':              { chunk: 'jx-mi-frente', component: 'PlanRealPage' },
  'emitir-alerta':          { chunk: 'jx-mi-frente', component: 'EmitirAlertaPage' },
  'aprobaciones-reporte':   { chunk: 'jx-mi-frente', component: 'AprobacionesReportePage' },
  'rendimiento-ingenieros': { chunk: 'jx-mi-frente', component: 'RendimientoIngenierosPage' },
  // === jx-reportes ===
  'reportes':               { chunk: 'jx-reportes', component: 'ReportesPage' },
  // === jx-admin ===
  'usuarios':               { chunk: 'jx-admin', component: 'UsuariosPage' },
  'roles':                  { chunk: 'jx-admin', component: 'RolesPage' },
  'configuracion':          { chunk: 'jx-admin', component: 'ConfiguracionPage' },
  // === jx-importar ===
  'importar':               { chunk: 'jx-importar', component: 'ImportarPage' },
  // === jx-captura-magica ===
  'captura-magica':         { chunk: 'jx-captura-magica', component: 'CapturaMagicaPage' },
  // === jx-contabilidad ===
  'contabilidad':           { chunk: 'jx-contabilidad', component: 'ContabilidadGrupoPage' },
  'cont-dashboard':         { chunk: 'jx-contabilidad', component: 'ContabilidadDashboardPage' },
  'compras-categoria':      { chunk: 'jx-compras-categoria', component: 'ComprasCategoriaPage' },
  'analisis-insumos':       { chunk: 'jx-analisis-insumos', component: 'AnalisisInsumosPage' },
  'captura-campo':          { chunk: 'jx-captura-campo', component: 'CapturaCampoPage' },
  'pagos':                  { chunk: 'jx-pagos', component: 'PagosPage' },
  'guias-remision':         { chunk: 'jx-guias', component: 'GuiasRemisionPage' },
  'profesionales':          { chunk: 'jx-profesionales', component: 'ProfesionalesPage' },
  'ordenes-intercompany':   { chunk: 'jx-ordenes-intercompany', component: 'OrdenesIntercompanyPage' },
  'conciliacion-insumos':   { chunk: 'jx-conciliacion', component: 'ConciliacionInsumosPage' },
  'empresas':               { chunk: 'jx-contabilidad', component: 'EmpresasPage' },
  'movimientos-contables':  { chunk: 'jx-contabilidad', component: 'MovimientosContablesPage' },
  'intercompany':           { chunk: 'jx-contabilidad', component: 'IntercompanyPage' },
  'consolidado':            { chunk: 'jx-contabilidad', component: 'ConsolidadoPage' },
  'trazabilidad':           { chunk: 'jx-contabilidad', component: 'TrazabilidadPage' },
  // === jx-compras ===
  'requisiciones':          { chunk: 'jx-compras', component: 'RequisicionesPage' },
  'ordenes-compra':         { chunk: 'jx-compras', component: 'OrdenesCompraPage' },
  // === jx-ordenes (registro documental por empresa, tanda 5) ===
  'ordenes':                { chunk: 'jx-ordenes', component: 'OrdenesPage' },
  'compras-pendientes':     { chunk: 'jx-compras-pendientes', component: 'ComprasPendientesPage' },
  // === jx-valorizaciones ===
  'valorizaciones':         { chunk: 'jx-valorizaciones', component: 'ValorizacionesPage' },
  // === jx-tesoreria ===
  'cuentas-bancarias':      { chunk: 'jx-tesoreria', component: 'CuentasBancariasPage' },
  'flujo-caja':             { chunk: 'jx-tesoreria', component: 'FlujoCajaPage' },
  // === jx-activos ===
  'activos-pesados':        { chunk: 'jx-activos', component: 'ActivosPesadosPage' },
  // === jx-ssoma ===
  'reporte-especialidad':   { chunk: 'jx-especialidad', component: 'ReporteEspecialidadPage' },
  'charlas-plan':           { chunk: 'jx-seguridad', component: 'CharlasPlanPage' },
  'sctr-personal':          { chunk: 'jx-seguridad', component: 'SctrPage' },
  'inducciones':            { chunk: 'jx-seguridad', component: 'InduccionesPage' },
  'gestion-ambiental':      { chunk: 'jx-ambiental', component: 'AmbientalPage' },
  'gestion-calidad':        { chunk: 'jx-calidad', component: 'CalidadPage' },
  'gestion-social':         { chunk: 'jx-social', component: 'SocialPage' },
  'panel-residente':        { chunk: 'jx-especialidad', component: 'PanelResidentePage' },
  'charlas-seguridad':      { chunk: 'jx-ssoma', component: 'CharlasSeguridadPage' },
  'iperc':                  { chunk: 'jx-ssoma', component: 'IpercPage' },
  'epp':                    { chunk: 'jx-ssoma', component: 'EppPage' },
  // === jx-epps (inventario separado de materiales) ===
  'epps-inventario':        { chunk: 'jx-epps', component: 'EppsInventarioPage' },
  'mov-epp':                { chunk: 'jx-epps', component: 'MovEppPage' },
  'insumos-persona':        { chunk: 'jx-insumos-persona', component: 'InsumosPorPersonaPage' },
  'movimientos-insumos':    { chunk: 'jx-movimientos-insumos', component: 'MovimientosInsumosPage' },
  // === jx-ssoma-extra ===
  'inspecciones-seguridad': { chunk: 'jx-ssoma-extra', component: 'InspeccionesSeguridadPage' },
  'capacitaciones':         { chunk: 'jx-ssoma-extra', component: 'CapacitacionesPage' },
  // === jx-insumos-emergencia ===
  'insumos-emergencia':     { chunk: 'jx-insumos-emergencia', component: 'InsumosEmergenciaPage' },
  // === jx-trabajos ===
  'bienes-servicios':       { chunk: 'jx-trabajos', component: 'BienesServiciosPage' },
  // === jx-subcontratos ===
  'subcontratistas':        { chunk: 'jx-subcontratos', component: 'SubcontratistasPage' },
  'subcontratos':           { chunk: 'jx-subcontratos', component: 'SubcontratosPage' },
  // === jx-subcontratos-val ===
  'subcontrato-valorizaciones': { chunk: 'jx-subcontratos-val', component: 'SubcontratoValorizacionesPage' },
  // === jx-planillas ===
  'planillas':              { chunk: 'jx-planillas', component: 'PlanillasPage' },
  // === jx-personal-contratos ===
  'personal-contratos':     { chunk: 'jx-personal-contratos', component: 'PersonalContratosPage' },
  // === jx-dashboard-ejecutivo ===
  'dashboard-ejecutivo':    { chunk: 'jx-dashboard-ejecutivo', component: 'DashboardEjecutivoPage' },
  'dashboard-gestion':      { chunk: 'jx-dashboard-gestion', component: 'DashboardGestionPage' },
  // === jx-mantenimiento ===
  'mantenimiento-programado': { chunk: 'jx-mantenimiento', component: 'MantenimientoProgramadoPage' },
  // === jx-cts-grati ===
  'cts':                    { chunk: 'jx-cts-grati', component: 'CTSPage' },
  'gratificaciones':        { chunk: 'jx-cts-grati', component: 'GratificacionesPage' },
  // === jx-plame ===
  'plame':                  { chunk: 'jx-plame', component: 'PlamePage' },
  // === jx-plan-cuentas ===
  'plan-cuentas':           { chunk: 'jx-plan-cuentas', component: 'PlanCuentasPage' },
  'balance-general':        { chunk: 'jx-plan-cuentas', component: 'BalanceGeneralPage' },
  'estado-resultados':      { chunk: 'jx-plan-cuentas', component: 'EstadoResultadosPage' },
  // === jx-asientos ===
  'libro-diario':           { chunk: 'jx-asientos', component: 'LibroDiarioPage' },
  // === jx-alertas ===
  'alertas':                { chunk: 'jx-alertas', component: 'AlertasCentralizadasPage' },
  // === jx-reportes-financieros ===
  'flujo-proyectado':       { chunk: 'jx-reportes-financieros', component: 'FlujoProyectadoPage' },
  'comparativo-periodos':   { chunk: 'jx-reportes-financieros', component: 'ComparativoPeriodosPage' },
  // === jx-busqueda ===
  'busqueda':               { chunk: 'jx-busqueda', component: 'BusquedaGlobalPage' },
  // === jx-kpis-obra ===
  'kpis-obra':              { chunk: 'jx-kpis-obra', component: 'KPIsObraPage' },
  // === jx-cumplimiento-cronograma ===
  'cumplimiento-cronograma': { chunk: 'jx-cumplimiento-cronograma', component: 'CumplimientoCronogramaPage' },
  // === jx-solicitud-residente ===
  'solicitud-residente':    { chunk: 'jx-solicitud-residente', component: 'SolicitudResidentePage' },
  // === jx-audit-log ===
  'audit-log':              { chunk: 'jx-audit-log', component: 'AuditLogPage' },
  // === jx-comprobantes ===
  'comprobantes':           { chunk: 'jx-comprobantes', component: 'ComprobantesElectronicosPage' },
  // === jx-libros-electronicos ===
  'libros-electronicos':    { chunk: 'jx-libros-electronicos', component: 'LibrosElectronicosPage' },
  // === jx-config-sunat (incluye lib/sunat-ubl.js) ===
  'config-sunat':           { chunk: 'jx-config-sunat', component: 'ConfigSUNATPage' },
  // === jx-conflicts ===
  'conflictos':             { chunk: 'jx-conflicts', component: 'ConflictsPage' },
};

// Pre-fetch de chunks que el rol va a usar. Se llama post-login para
// que cuando el user clickee en el sidebar, los chunks ya estén en
// memoria. Almacenero NO descarga jx-contabilidad/jx-tesoreria/jx-planillas;
// contador NO descarga jx-almacen/jx-ssoma. Bundle inicial sigue chico,
// pero la navegación se siente instantánea dentro del rol.
window.__prefetchChunksForRol = function(rol) {
  if (!rol || !window.__loadChunk || !window.__canSeeSidebarItem) return;
  const chunks = new Set();
  for (const [pageId, info] of Object.entries(PAGE_REGISTRY)) {
    if (window.__canSeeSidebarItem(rol, pageId)) {
      chunks.add(info.chunk);
    }
  }
  // Cargar de a uno con requestIdleCallback para no competir con la
  // pantalla activa. Si el browser no soporta rIC, fallback a setTimeout
  // con stagger pequeño para no saturar la red.
  const lista = [...chunks];
  const cargar = (i) => {
    if (i >= lista.length) return;
    const ric = window.requestIdleCallback || ((cb) => setTimeout(cb, 100));
    ric(() => {
      window.__loadChunk(lista[i]).catch(() => {}).finally(() => cargar(i + 1));
    }, { timeout: 5000 });
  };
  setTimeout(() => cargar(0), 1500); // dejar que el initial render termine
};

function LazyPageSpinner() {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:14, color:'var(--tm)' }}>
      <style>{`@keyframes jxLazySpin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ width:48, height:48, borderRadius:'50%', border:'3px solid rgba(242,183,5,0.15)', borderTopColor:'var(--amber)', animation:'jxLazySpin 0.8s linear infinite' }}/>
      <div style={{ fontSize:13, color:'var(--tm)' }}>Cargando módulo…</div>
    </div>
  );
}

function LazyPageError({ chunk, error, onRetry }) {
  // CASO FRECUENTE Y CONFUNDIBLE: la pantalla "no deja entrar" no porque tenga
  // un bug, sino porque el navegador (PWA instalada) se quedó con un
  // index.html viejo que pide chunks que el deploy nuevo ya borró. Reintentar
  // el mismo import falla siempre; lo que lo arregla es limpiar el cache.
  const viejo = !!window.__esChunkViejo?.(error);
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:12, color:'var(--tm)', padding:20 }}>
      <JxIcon name="alertCircle" size={28} color="var(--red)"/>
      <div style={{ fontSize:14, fontWeight:600, color:'var(--ts)' }}>
        {viejo ? 'Tu app quedó con una versión vieja' : 'No se pudo cargar el módulo'}
      </div>
      <div style={{ fontSize:12, color:'var(--tm)', maxWidth:400, textAlign:'center', lineHeight:1.5 }}>
        {viejo
          ? <>Se publicó una versión nueva y esta pantalla ya no está en la copia que tenés guardada.
              Limpiá el cache y volvé a entrar — no se pierde nada de lo cargado.</>
          : <>{chunk} · {(error && error.message) || 'error desconocido'}</>}
      </div>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', justifyContent:'center', marginTop:6 }}>
        {viejo && (
          <button className="btn btn-amber" onClick={() => window.__hardReload?.()}>
            🔄 Limpiar cache y recargar
          </button>
        )}
        <button className="btn btn-ghost" onClick={onRetry}>Reintentar</button>
      </div>
      {viejo && (
        <div style={{ fontSize:10.5, color:'var(--tm)', maxWidth:400, textAlign:'center' }}>
          {chunk} · {(error && error.message) || 'error desconocido'}
        </div>
      )}
    </div>
  );
}

function LazyPage({ chunk, component, ...props }) {
  const [, setTick] = uSA(0);
  const [error, setError] = uSA(null);
  const ready = !!window[component];

  uEA(() => {
    if (ready) return;
    let cancelled = false;
    setError(null);
    const loader = window.__loadChunk;
    if (!loader) { setError(new Error('loader missing')); return; }
    loader(chunk)
      .then(() => { if (!cancelled) setTick(t => t + 1); })
      .catch((err) => { if (!cancelled) setError(err); });
    return () => { cancelled = true; };
  }, [chunk, component, ready]);

  if (error) {
    return <LazyPageError chunk={chunk} error={error} onRetry={() => { setError(null); setTick(t => t + 1); }}/>;
  }
  const Comp = window[component];
  if (!Comp) return <LazyPageSpinner/>;
  return React.createElement(Comp, props);
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
  // Pantalla inicial según el rol: el almacenero arranca en "Mov. Materiales",
  // el contador en "Movs. Contables", el gerente en "Dashboard Ejecutivo", etc.
  // Si el rol todavía no se cargó (auth pendiente), arrancamos en 'dashboard'
  // y el effect de abajo lo cambia cuando el profile esté disponible.
  // Aterrizaje: TODOS arrancan en el INICIO (launcher de 2 planos). Desde ahí
  // entran a una sección general o a una obra. (Fase 3: auto-entrar a la obra
  // única para roles operativos, con el filtro de asignación real.)
  // Cambiar el tema recarga (ver src/lib/tema.js). Sin esto la recarga te
  // devolvía al Inicio y perdías la sección donde estabas.
  const [page, setPage]             = uSA(() => __volverTrasTema?.page || 'inicio');
  // Override de plano para los ítems DUALES (ej. movimientos-contables aparece en
  // el workspace de obra Y en el área general de contabilidad). El sidebar pasa el
  // plano del ítem clickeado; null = usar planoDe(page).
  const [navPlano, setNavPlano]     = uSA(__volverTrasTema?.plano || null);
  // Historial de navegación (src/lib/nav-historial.js) — el botón «← Volver»
  // del Header. UN solo punto de entrada (irAPagina) cubre TODA la app: el
  // sidebar, los atajos, los CustomEvents cross-página y el hash pasan todos
  // por acá, así que empujar la pantalla que se deja alcanza sin tocar cada
  // pantalla una por una. No sobrevive a un F5 (arranca en []) a propósito:
  // es estado de sesión de navegación, no de negocio.
  const [navHistorial, setNavHistorial] = uSA([]);
  // OJO StrictMode: `setNavHistorial` se llama SUELTA acá, nunca anidada
  // dentro del updater de otro setState — su propio updater (empujarHistorial)
  // es puro, así que el doble-invoke de dev de React no duplica la entrada.
  const irAPagina = React.useCallback((p, planoItem) => {
    if (p !== page) setNavHistorial(h => empujarHistorial(h, { page, plano: navPlano }));
    setPage(p);
    setNavPlano(planoItem || null);
  }, [page, navPlano]);
  const volver = React.useCallback(() => {
    const { entrada, pila } = sacarHistorial(navHistorial);
    if (!entrada) return;
    setPage(entrada.page);
    setNavPlano(entrada.plano || null);
    setNavHistorial(pila);
  }, [navHistorial]);
  window.__navTo = (p, plano) => irAPagina(p, plano); // navegación programática (sin plano → resetea el override)
  window.__pageActual = page;        // lo lee cambiarTema() para volver acá tras recargar
  window.__navPlanoActual = navPlano;

  // Al cargar el profile (post-login):
  //   1. Redirigir a la home del rol (solo la primera vez).
  //   2. Disparar prefetch de los chunks que el rol va a usar — así su
  //      navegación dentro del menú se siente instantánea.
  const _homeAplicadaRef = React.useRef(!!__volverTrasTema);
  uEA(() => {
    if (_homeAplicadaRef.current) return;
    const rol = auth?.profile?.rol;
    if (!rol) return;
    _homeAplicadaRef.current = true;
    if (page === 'dashboard' && window.__defaultPageForRol) {
      const home = window.__defaultPageForRol(rol);
      if (home && home !== page) setPage(home);
    }
    // Prefetch en background — no bloquea nada, no espera nada.
    if (window.__prefetchChunksForRol) {
      window.__prefetchChunksForRol(rol);
    }
  }, [auth?.profile?.rol]);

  // Landing por rol: los roles operativos (almacenero/ingeniero/…) con UNA sola
  // obra asignada entran DIRECTO a su workspace y su página de siempre, saltando
  // el launcher. Los roles globales (admin/gerente/contador/…) o con varias/ninguna
  // obra se quedan en el Inicio. (Async porque obra_usuarios se consulta a Supabase.)
  const _landingRef = React.useRef(!!__volverTrasTema);
  uEA(() => {
    if (_landingRef.current) return;
    const rol = auth?.profile?.rol;
    const uid = auth?.profile?.id;
    if (!rol) return;
    _landingRef.current = true;
    (async () => {
      const ids = await cargarObrasAsignadas({ userId: uid, rol });
      const obrasAsignadas = ids ? [...ids] : [];   // null (ve todas) → no auto-entrar
      const home = window.__defaultPageForRol?.(rol) || 'dashboard-gestion';
      const { page: lpage, obraId } = resolveLanding({ rol, obrasAsignadas, homePorRol: { [rol]: home } });
      if (lpage !== 'inicio') {
        // Aterrizaje de plano OBRA → entra al workspace. De plano GENERAL (ej.
        // el rol campo → 'captura-campo') → ir DIRECTO a esa página: forzar
        // 'dashboard-gestion' aquí dejaba al rol campo en "Sin acceso" (no puede
        // ver dashboard-gestion) — su portal quedaba inalcanzable.
        if (planoDe(lpage) !== 'obra') {
          setPage(lpage);
          return;
        }
        if (obraId && window.__setObraActivaId) window.__setObraActivaId(obraId);
        setPage(lpage);
      }
    })();
  }, [auth?.profile?.rol, auth?.profile?.id]);
  // Rol CAMPO (cuenta compartida con PIN): SOLO el portal de captura. Cualquier
  // navegación fuera (Inicio con su selector de obra, workspace, etc.) vuelve
  // al portal — hallazgo de Gabriel 31-ago: la cuenta veía el Inicio completo.
  uEA(() => {
    if (auth?.profile?.rol === 'campo' && page !== 'captura-campo') setPage('captura-campo');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.profile?.rol, page]);
  // Contador de versión de permisos. Aumenta cada vez que el admin
  // cambia la matriz desde Roles & Permisos. Lo agregamos al `key` del
  // contenedor de la página para forzar un remount completo de la
  // pantalla actual — así las variables `canWrite` que calculan sus
  // valores en el render inicial vuelven a calcularse con los nuevos
  // permisos sin que cada pantalla tenga que suscribirse al evento.
  // Empresa activa: define si el sidebar muestra la contabilidad DEL GRUPO o
  // la de una empresa (tanda 2F). Reactivo, para que entrar o salir del
  // contexto reordene el menú al instante.
  const [empresaActivaId, setEmpresaActivaId_] = uSA(() => getEmpresaActivaId());
  uEA(() => {
    const on = (e) => setEmpresaActivaId_(e?.detail?.id ?? getEmpresaActivaId());
    window.addEventListener(EMPRESA_ACTIVA_EVENT, on);
    return () => window.removeEventListener(EMPRESA_ACTIVA_EVENT, on);
  }, []);

  const [permsVer, setPermsVer] = uSA(0);
  uEA(() => {
    const onPerms = () => setPermsVer(v => v + 1);
    window.addEventListener('jx_perms_changed', onPerms);
    return () => window.removeEventListener('jx_perms_changed', onPerms);
  }, []);

  // Obra activa reactiva SOLO para el `key` del contenedor: al cambiar de obra
  // desde el header, remontamos la página actual (que re-lee la obra al montar)
  // en vez de recargar toda la app — así el usuario se queda donde estaba.
  const [obraKey, setObraKey] = uSA(() => (typeof window !== 'undefined' && window.__getObraActivaId?.()) || '');
  uEA(() => {
    const onObra = () => setObraKey(window.__getObraActivaId?.() || '');
    window.addEventListener('obra_activa_change', onObra);
    return () => window.removeEventListener('obra_activa_change', onObra);
  }, []);

  // En móvil arrancamos con el drawer cerrado (collapsed=true).
  // En desktop arrancamos con el sidebar expandido (collapsed=false).
  const [collapsed, setCollapsed]   = uSA(() =>
    typeof window !== 'undefined' && window.innerWidth <= 768
  );
  const [toast, setToast]           = uSA(null);
  const [obraActiva, setObraActiva] = uSA(null);
  const [syncDetailOpen, setSyncDetailOpen] = uSA(false);

  // PostHog: trackear cambio de pantalla. Esto responde la pregunta del
  // Council "¿qué pantallas se usan?" — cada vez que el user navega
  // (cambia el state `page`), mandamos un $pageview con el id de la pantalla
  // y el rol del user. Después en el dashboard de PostHog filtramos por
  // pantalla para ver uso real.
  uEA(() => {
    if (!page) return;
    trackPageView(page, {
      // Sin nombres ni emails — solo metadata útil para análisis
      user_rol: auth?.profile?.rol || 'anonymous',
      is_mobile: isMobile,
    });
  }, [page, auth?.profile?.rol, isMobile]);

  // Si el viewport cambia entre móvil/desktop, ajustamos el estado del sidebar.
  uEA(() => {
    setCollapsed(isMobile);
  }, [isMobile]);
  const sync = window.__useSync ? window.__useSync() : { syncing:false, pending:0 };
  const online = window.__useOnline ? window.__useOnline() : true;
  // Una única suscripción realtime para toda la app: la compartimos con
  // Header (notificaciones) y Sidebar (badge de estado). Si Header llamara
  // a useRealtimeNotifications también, abriríamos dos canales.
  const notifs = window.__useRealtimeNotifications
    ? window.__useRealtimeNotifications()
    : { notifications:[], unreadCount:0, markAllRead:()=>{}, clearAll:()=>{}, realtimeStatus:'idle', forceReconnect:()=>{} };

  const showToast = uCA((msg, type='amber') => setToast({ msg, type, key: Date.now() }), []);
  // Exponer toast como global para que helpers/loaders sin acceso al closure
  // (ej. errores en useEffect de páginas heredadas) puedan notificar al usuario
  // en lugar de solo silenciar con console.error.
  uEA(() => { window.__showToast = showToast; return () => { if (window.__showToast === showToast) delete window.__showToast; }; }, [showToast]);

  // Escucha eventos de notificaciones realtime y muestra toast in-app inmediato.
  //
  // ANTES: cada addNotif() de useRealtimeNotifications disparaba un toast.
  // En una obra con 5+ usuarios activos esto generaba 1000+ toasts al admin
  // (cada movimiento, cada asistencia, cada avance) → reportado por el user.
  //
  // AHORA:
  //  · Tipos "ruidosos" (movimiento, asistencia, avance) NO muestran toast
  //    — quedan solo en el badge de notificaciones del header.
  //  · Tipos críticos (incidencia, stock_critico, change_request) sí toast,
  //    pero throttle: máximo 1 cada 8 segundos por tipo. Si llegan varios
  //    dentro de la ventana, mostramos uno coalescente: "3 nuevas
  //    incidencias".
  uEA(() => {
    if (!auth?.profile) return;
    const TIPOS_RUIDOSOS = new Set(['movimiento', 'mov_herramienta', 'asistencia', 'avance', 'obra_nueva']);
    const ultimoToastPorTipo = new Map(); // tipo → { lastShownAt, pendingCount, pendingTimer }
    const COALESCE_MS = 8000;

    const dispararToast = (n, count = 1) => {
      const txt = count > 1
        ? `${count} nuevas notificaciones — ${n.titulo}`
        : `${n.titulo}${n.descripcion ? ' — ' + n.descripcion : ''}`;
      const tipo = n.tipo === 'change_request' ? 'amber' : n.tipo === 'incidencia' ? 'red' : 'blue';
      showToast(txt, tipo);
      try {
        if (typeof Notification !== 'undefined' &&
            Notification.permission === 'granted' &&
            (document.hidden || tipo === 'red')) {
          const notif = new Notification(n.titulo || 'JARVEX', {
            body: n.descripcion || '',
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            tag: n.tipo || 'jarvex',
            requireInteraction: tipo === 'red',
          });
          notif.onclick = () => { window.focus(); notif.close(); };
        }
      } catch (_) {}
    };

    const onNotif = (e) => {
      const n = e?.detail;
      if (!n) return;
      // Tipos ruidosos → solo badge (que ya está actualizado por
      // useRealtimeNotifications). NO toast.
      if (TIPOS_RUIDOSOS.has(n.tipo)) return;

      const ahora = Date.now();
      const estado = ultimoToastPorTipo.get(n.tipo) || { lastShownAt: 0, pendingCount: 0, pendingTimer: null };
      const desdeUltimo = ahora - estado.lastShownAt;

      if (desdeUltimo >= COALESCE_MS) {
        // Mostrar inmediato y resetear ventana
        dispararToast(n);
        ultimoToastPorTipo.set(n.tipo, { lastShownAt: ahora, pendingCount: 0, pendingTimer: null });
      } else {
        // Estamos dentro de la ventana — coalescer
        const next = { ...estado, pendingCount: estado.pendingCount + 1 };
        if (!estado.pendingTimer) {
          next.pendingTimer = setTimeout(() => {
            const cur = ultimoToastPorTipo.get(n.tipo);
            if (cur && cur.pendingCount > 0) {
              dispararToast(n, cur.pendingCount + 1);
            }
            ultimoToastPorTipo.set(n.tipo, { lastShownAt: Date.now(), pendingCount: 0, pendingTimer: null });
          }, COALESCE_MS - desdeUltimo);
        }
        ultimoToastPorTipo.set(n.tipo, next);
      }
    };
    window.addEventListener('jarvex_new_notif', onNotif);
    return () => {
      window.removeEventListener('jarvex_new_notif', onNotif);
      for (const v of ultimoToastPorTipo.values()) {
        if (v.pendingTimer) clearTimeout(v.pendingTimer);
      }
    };
  }, [auth?.profile, showToast]);

  // Atajo Cmd+K / Ctrl+K → abrir búsqueda global
  uEA(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        irAPagina('busqueda');   // irAPagina resetea navPlano (no dejar el plano pegado)
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Navegación cross-página vía CustomEvent (alertas, búsqueda)
  uEA(() => {
    const onNav = (e) => {
      const p = e?.detail?.page;
      if (!p || typeof p !== 'string') return;
      // Los resultados de la Búsqueda Global y las alertas son CROSS-OBRA: un
      // comprobante encontrado ahí puede ser de otra obra. Desde la entrega B,
      // 'movimientos-contables' en plano obra queda acotado a la obra activa,
      // así que estos saltos van explícitamente a su vista general.
      if (p === 'movimientos-contables') { irAPagina(p, 'general'); return; }
      irAPagina(p);   // resetea navPlano
    };
    window.addEventListener('jx_navigate', onNav);
    return () => window.removeEventListener('jx_navigate', onNav);
  }, []);

  // Sincronizar página con hash (#/ruta) — apoyo para deep-links y los smoke tests
  uEA(() => {
    const fromHash = () => {
      const h = (window.location.hash || '').replace(/^#\/?/, '').trim();
      if (h) irAPagina(h);   // resetea navPlano
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);

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

  // Badge honesto. Prioridades:
  //   offline > syncing > FAILED > pending > synced
  // El consejo flageó que mostrar "Sincronizado" mientras hay records
  // en FAILED es la mentira que causó los problemas de producción.
  let syncStatus = null;
  if (!online) syncStatus = { color:'var(--amber)', label:'Sin conexión', bg:'rgba(245,158,11,0.12)', kind:'offline' };
  else if (sync.syncing) syncStatus = { color:'var(--blue)', label:'Sincronizando…', bg:'rgba(96,165,250,0.12)', syncing:true, kind:'syncing' };
  else if (sync.failed > 0) syncStatus = { color:'var(--red)', label:`${sync.failed} con error · click para revisar`, bg:'rgba(239,68,68,0.14)', kind:'failed' };
  else if (sync.pending > 0) syncStatus = { color:'var(--amber)', label:`${sync.pending} pendiente${sync.pending>1?'s':''}`, bg:'rgba(245,158,11,0.12)', kind:'pending' };
  else syncStatus = { color:'var(--green)', label:'Sincronizado', bg:'rgba(52,211,153,0.1)', kind:'synced' };

  // Guard de acceso por rol: si el rol del usuario no puede ver esta página
  // (según __canSeeSidebarItem / matriz de permisos), mostramos un mensaje
  // en vez del componente. Evita que un usuario navegue por URL a páginas
  // bloqueadas por su rol.
  const rolActual = auth?.profile?.rol || '';
  const puedeVerPagina = (p) => {
    // El INICIO (launcher) es seguro para todos: no muestra datos, solo deriva.
    if (p === 'inicio') return true;
    // Política deny-by-default: si no hay rol o no es canónico, delegamos al
    // helper que ya hace el chequeo correcto. Antes acá había un short-circuit
    // a true que era una fuga de info — un usuario sin rol asignado veía todo.
    if (rolActual === 'admin') return true;
    return window.__canSeeSidebarItem?.(rolActual, p) ?? false;
  };
  // Entrar a una obra desde el Inicio: fija la obra activa (sin recarga) y navega
  // a una página de plano OBRA (la home del rol si es de obra, si no Gestión).
  // Entrar a una obra: fija la obra activa (sin recarga) y navega a una página de
  // plano OBRA. Si se pide una página concreta (acceso rápido del Inicio) y es de
  // obra, va a esa; si no, a la home del rol (o Gestión).
  const entrarObra = (oid, pageDestino) => {
    // AISLAMIENTO: no entrar a una obra que no está asignada al usuario.
    const perm = window.__obrasPermitidas;
    if (oid && perm && !perm.has(oid)) { showToast('No tenés asignada esa obra', 'red'); return; }
    if (oid && window.__setObraActivaId) window.__setObraActivaId(oid);
    let destino = pageDestino && planoDe(pageDestino) === 'obra' ? pageDestino : null;
    if (!destino) { const h = window.__defaultPageForRol?.(rolActual) || 'dashboard-gestion'; if (planoDe(h) === 'obra') destino = h; }
    if (!destino && rolActual !== 'admin') {
      // El fallback fijo 'dashboard-gestion' (módulo Avance) era un callejón
      // "Sin acceso" para contador/tesorero (cuyo home es de plano general):
      // primera página de plano OBRA que el rol sí puede ver, en orden del menú.
      for (const it of (window.NAV || [])) {
        if (it.id && (it.plano || planoDe(it.id)) === 'obra' && (window.__canSeeSidebarItem?.(rolActual, it.id) ?? false)) { destino = it.id; break; }
      }
    }
    // Último recurso: el PANEL DEL TRABAJO (entrega B), no 'dashboard-gestion'
    // — ese era el callejón "Sin acceso" para los roles que no ven Avance. El
    // panel es un lanzador: solo ofrece las secciones que el rol sí puede abrir.
    irAPagina(destino || 'panel-obra', 'obra');
  };
  const NoAcceso = () => (
    <div className="page-wrap" style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'60vh' }}>
      <div className="card card-p" style={{ maxWidth:480, textAlign:'center', padding:'34px 28px' }}>
        <JxIcon name="lock" size={32} color="var(--amber)"/>
        <div style={{ fontSize:16, fontWeight:700, color:'var(--tp)', marginTop:10 }}>Sin acceso a este módulo</div>
        <div style={{ fontSize:12, color:'var(--tm)', marginTop:6 }}>
          Tu rol actual no tiene permiso para ver esta página. Si necesitas acceso, contacta al administrador.
        </div>
      </div>
    </div>
  );

  const renderPage = () => {
    if (!puedeVerPagina(page)) return <NoAcceso/>;
    // Páginas EAGER (en chunk principal): dashboard + solicitudes.
    // Las páginas de almacén ahora son lazy (PAGE_REGISTRY abajo).
    switch(page) {
      case 'inicio':        return <window.InicioPage onNav={(p, plano)=>irAPagina(p, plano)} onEnterObra={entrarObra}/>;
      // Trabajos necesita navegar Y fijar la obra activa, igual que Inicio:
      // por eso no va por PAGE_REGISTRY, que solo pasa showToast.
      case 'trabajos':      return <LazyPage chunk="jx-trabajos" component="TrabajosPage" showToast={showToast}
                                     onNav={(p, plano)=>irAPagina(p, plano)} onEnterObra={entrarObra}/>;
      // Panel del trabajo (tanda 2, entrega B): el desglose de la obra activa.
      // Navega a secciones de los DOS planos (sus grupos son de obra; "cambiar
      // de trabajo" y "configurar la obra" son generales) → necesita onNav.
      case 'panel-obra':    return <LazyPage chunk="jx-trabajos" component="PanelObraPage" showToast={showToast}
                                     onNav={(p, plano)=>irAPagina(p, plano)}/>;
      case 'dashboard':     return <DashboardPage showToast={showToast}/>;
      case 'solicitudes':   return <SolicitudesPage showToast={showToast}/>;
    }
    // Páginas LAZY: el chunk se carga on-demand y luego se renderiza window[component].
    const entry = PAGE_REGISTRY[page];
    if (entry) {
      return <LazyPage chunk={entry.chunk} component={entry.component} showToast={showToast}/>;
    }
    return <ComingSoon page={page}/>;
  };

  // Si la URL indica un flujo de recuperación de contraseña, mostrar la pantalla
  // de reset ANTES de Login/App (incluso si hay sesión transitoria por el token).
  if (resetFlow) return <ResetPasswordScreen/>;

  if (auth?.loading) {
    return (
      <div style={{ minHeight:'100vh', background:'var(--bg-p)', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--ts)', fontSize:13 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ width:18, height:18, borderRadius:'50%', border:'2px solid rgba(242,183,5,0.3)', borderTopColor:'var(--amber)', display:'inline-block', animation:'spin .7s linear infinite' }}/>
          Cargando JARVEX…
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!auth?.profile) return <LoginScreen onLogin={(email, pass) => auth.login(email, pass)}/>;

  // El plano de la página actual decide qué sidebar/header se muestra (navPlano
  // overridea para ítems duales). El INICIO es un launcher full-width: sin sidebar.
  // En el plano general, `areaActual` sub-divide el sidebar (Contabilidad ≠ Admin).
  // navPlano (override de ítems duales como movimientos-contables) SOLO aplica
  // cuando la página NO es inequívocamente general; así un navPlano='obra' stale
  // (p.ej. tras Cmd+K/hash a una página general) no fuerza el sidebar/header de
  // obra. El caso dual real (movimientos-contables) tiene planoDe='obra', por lo
  // que sigue respetando navPlano='general' al entrar desde Contabilidad.
  const planoBase = page === 'inicio' ? 'general' : planoDe(page);
  const planoActual = planoBase === 'general' ? 'general' : (navPlano || planoBase);
  // ÁREA DEL SIDEBAR. Con una EMPRESA ACTIVA, las pantallas contables se
  // muestran como lo que son en ese momento: la contabilidad de ESA empresa.
  // Si no, el menú volvía a listar las 22 secciones del grupo y, como dijo
  // Gabriel, «aquí tienes nuevamente todo mezclado» — entrabas por una empresa
  // y al tocar Movimientos veías los de todas.
  const areaBase = planoActual === 'general' ? (page === 'inicio' ? null : areaDe(page)) : null;
  // Solo las páginas que SON la contabilidad de una empresa entran al contexto.
  // El "Resumen por entidad" y el Consolidado siguen siendo del GRUPO aunque
  // haya una empresa activa: ahí se comparan todas, no se mira una.
  // 'empresas' entra también: parado en el PANEL de una empresa, el menú de la
  // izquierda tiene que ser el desglose de ESA empresa. Mostrando el catálogo
  // (área 'empresas') el desglose aparecía recién después de saltar a una
  // pantalla contable — «cuando doy ahí en esa sección de contabilidad, sí me
  // debería desglosar […] en la parte izquierda».
  // Solo en el plano GENERAL: dentro de una obra manda la obra, aunque haya
  // una empresa activa guardada (el mismo corte que hace useEmpresaBloqueada).
  const areaActual = (planoActual === 'general' && empresaActivaId
      && (page === 'empresas' || esPaginaDeEmpresa(page)))
    ? 'empresa' : areaBase;
  window.__plano = planoActual;   // lo leen páginas lazy (ej. Movimientos: scope por obra)
  return (
    <div style={{ display:'flex', height:'100vh', overflow:'hidden' }}>
      {page !== 'inicio' && (
        <Sidebar current={page} onNav={irAPagina} collapsed={collapsed} onToggle={()=>setCollapsed(c=>!c)}
                 plano={planoActual} area={areaActual}
                 realtimeStatus={notifs.realtimeStatus} onReconnectRealtime={notifs.forceReconnect}/>
      )}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minWidth:0 }}>
        <Header page={page}
                plano={planoActual}
                onInicio={()=>irAPagina('inicio')}
                onVolver={volver}
                puedeVolver={puedeVolver(navHistorial)}
                onToggleSidebar={()=>setCollapsed(c=>!c)}
                onLogout={()=>auth.logout()}
                profile={auth.profile}
                obraActiva={obraActiva}
                syncStatus={syncStatus}
                notifs={notifs}
                onSync={() => {
                  // El modal se abre SIEMPRE: con FAILED/pending muestra el
                  // detalle; con todo OK da acceso a la verificación con el
                  // servidor, "Forzar resync" y el mantenimiento del admin
                  // (antes esas herramientas eran INALCANZABLES estando todo
                  // sincronizado — el click solo disparaba un sync a ciegas).
                  setSyncDetailOpen(true);
                  // Con todo OK, además dispara el sync manual de siempre.
                  if (!((sync.failed || 0) > 0 || (sync.pending || 0) > 0) && sync.sync) sync.sync();
                }}
                isMobile={isMobile}/>
        <div style={{ flex:1, overflow:'hidden', background:'var(--bg-p)' }} key={`${page}_${planoActual}_${permsVer}_${planoActual === 'obra' ? obraKey : ''}`}>
          {renderPage()}
        </div>
      </div>
      {toast && <Toast key={toast.key} message={toast.msg} type={toast.type} onDone={()=>setToast(null)}/>}
      <SyncDetailModal open={syncDetailOpen} onClose={()=>setSyncDetailOpen(false)} showToast={showToast}/>
    </div>
  );
}

// Listener vanilla (sin hooks) que escucha el evento jx_sync_blocked_rls
// y dispara un toast nativo del browser (alert) o usa el showToast global
// si está disponible. Antes era un componente con hooks, pero estaba
// causando errores de useState en producción al renderizar — pasamos a
// vanilla JS para evitar cualquier issue de hook order/dispatcher.
if (typeof window !== 'undefined' && !window.__jx_rls_listener_attached) {
  window.__jx_rls_listener_attached = true;
  let lastShown = 0;
  window.addEventListener('jx_sync_blocked_rls', (e) => {
    const now = Date.now();
    if (now - lastShown < 30_000) return; // no más de 1 toast cada 30s
    lastShown = now;
    const tabla = e.detail?.tabla || 'desconocida';
    const msg = `⚠ Sync bloqueado: tu cuenta no puede modificar "${tabla}" en el servidor. Avisale al admin (los datos se guardan localmente pero NO se sincronizan).`;
    if (typeof window.__showToast === 'function') {
      window.__showToast(msg, 'red');
    } else {
      console.error('[RLS bloqueado]', msg);
    }
  });
}

// En el build de Vite, main.jsx monta el árbol con AuthContext.
// Solo registramos App en window para que Root() lo pueda usar.
Object.assign(window, { App });