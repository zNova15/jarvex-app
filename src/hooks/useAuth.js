import { useState, useEffect, useRef, createContext, useContext } from 'react';
import { getCurrentUser, login as authLogin, logout as authLogout } from '../lib/auth';
import { db } from '../db/jarvex.db';
import { syncAll } from '../sync/SyncEngine';
import { identifyUser, resetUser } from '../lib/posthog.js';

export const AuthContext = createContext(null);

// Lista canónica de roles válidos. Cualquier profile cuyo `rol` no esté acá
// se trata como inválido (NO se asume admin para evitar escalación).
const ROLES_VALIDOS = new Set([
  'admin','gerente','ingeniero_residente','ingeniero','supervisor','almacenero',
  'asistente_admin','contador','ayudante_contador','tesorero','jefe_compras','rrhh',
  'prevencionista','maestro_obra','solo_lectura',
  // Especialistas (Fase 1 gestiones de obra) — sin estos, un usuario real con
  // el rol era expulsado al hidratar sesión y su login rechazado.
  'ing_ambiental','ing_calidad','ing_social',
  // Portal de captura de campo (mejora 2, mig 155) — cuenta compartida con PIN.
  'campo',
]);

function rolEsValido(rol) {
  return typeof rol === 'string' && ROLES_VALIDOS.has(rol);
}

// Tiempo de inactividad antes de cerrar sesión. Default 30 min; el admin lo
// puede cambiar desde Administración (app_config clave 'sesion_timeout_min',
// mig 159). El valor sincronizado se cachea en localStorage para que el timer
// lo lea síncrono en cada reinicio (cualquier interacción reinicia el contador,
// así que un cambio de config rige desde la siguiente interacción).
const INACTIVITY_DEFAULT_MIN = 30;
export const INACTIVITY_MIN_MIN = 5;    // piso: evita el lockout de un typo (ej. 0)
export const INACTIVITY_MAX_MIN = 480;  // techo: 8 h (una jornada)
const INACTIVITY_LS_KEY = 'jx_sesion_timeout_min';
export function clampTimeoutMin(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return INACTIVITY_DEFAULT_MIN;
  return Math.min(INACTIVITY_MAX_MIN, Math.max(INACTIVITY_MIN_MIN, n));
}
export function getInactivityMin() {
  try {
    const raw = localStorage.getItem(INACTIVITY_LS_KEY);
    if (raw !== null && raw !== '') return clampTimeoutMin(raw);
  } catch {}
  return INACTIVITY_DEFAULT_MIN;
}

export function useAuth() {
  return useContext(AuthContext);
}

// Espejo del rol/id del profile en `window` para que módulos NO-React
// (SyncEngine corre en setInterval, fuera del árbol) puedan leerlo
// sin invocar useAuth() — invocar un hook fuera de un componente
// dispara "Invalid hook call" (ver Sentry JARVEX-APP-D).
// Se actualiza desde el effect del Provider abajo.
function publicarSesion(profile) {
  try {
    if (profile) {
      window.__currentRol     = profile.rol || null;
      window.__currentUserId  = profile.id || null;
    } else {
      window.__currentRol     = null;
      window.__currentUserId  = null;
    }
  } catch {}
}

export function useAuthProvider() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  // Tick interno para re-render cuando cambia el role override o el modo
  const [overrideTick, setOverrideTick] = useState(0);
  useEffect(() => {
    const onChange = () => setOverrideTick(t => t + 1);
    window.addEventListener('app_mode_change', onChange);
    window.addEventListener('jx_role_override_change', onChange);
    return () => {
      window.removeEventListener('app_mode_change', onChange);
      window.removeEventListener('jx_role_override_change', onChange);
    };
  }, []);

  useEffect(() => {
    getCurrentUser().then(result => {
      if (result) {
        // Hardening: validar que el rol del profile esté en la lista canónica.
        // Si no, NO seteamos el profile y forzamos logout para evitar que un
        // profile corrupto (rol vacío, rol inválido, etc.) sea tratado como
        // "sin restricciones" o como admin.
        if (result.profile && !rolEsValido(result.profile.rol)) {
          console.warn('[useAuth] Profile con rol inválido o vacío — forzando logout. Rol recibido:', result.profile.rol);
          authLogout().finally(() => {
            setUser(null); setProfile(null); setOffline(false);
            try { localStorage.removeItem('jx_user_role'); localStorage.removeItem('jx_user_role_real'); } catch {}
          });
        } else {
          setUser(result.session?.user ?? null);
          setProfile(result.profile);
          setOffline(result.offline);
          // PostHog: identificar al user al hidratar sesión existente
          // (refresh del browser con cookie/localStorage). Sin esto, el
          // primer pageview queda como "anónimo" hasta que login again.
          try { identifyUser(result.profile); } catch {}
          if (!result.offline) {
            setTimeout(syncAll, 2000);
          }
        }
      }
      setLoading(false);
    });
  }, []);

  // Sincroniza el rol con localStorage para que useAppMode pueda restringir
  // los modos prueba/edicion solo a admin de forma síncrona.
  // También guarda el rol REAL para poder volver del role override.
  useEffect(() => {
    // Espejo en window.__currentRol/window.__currentUserId para que el
    // SyncEngine y otros módulos NO-React puedan leerlos sin hooks.
    publicarSesion(profile);
    try {
      const rol = profile?.rol || '';
      const prevReal = localStorage.getItem('jx_user_role_real');
      if (prevReal !== rol) {
        if (rol) localStorage.setItem('jx_user_role_real', rol);
        else localStorage.removeItem('jx_user_role_real');
      }
      // Si NO hay override activo, sincronizar jx_user_role con el real
      const override = localStorage.getItem('jx_role_override');
      const mode = localStorage.getItem('app_mode');
      const overrideValid = override && mode === 'prueba' && rol === 'admin';
      const efectivo = overrideValid ? override : rol;
      const prevEfectivo = localStorage.getItem('jx_user_role');
      if (prevEfectivo !== efectivo) {
        if (efectivo) localStorage.setItem('jx_user_role', efectivo);
        else localStorage.removeItem('jx_user_role');
        window.dispatchEvent(new Event('app_mode_change'));
      }
    } catch (e) {}
  }, [profile]);

  // Aplica el role override al profile que se expone (sin tocar el real)
  const profileEfectivo = (() => {
    if (!profile) return profile;
    try {
      const override = localStorage.getItem('jx_role_override');
      const mode = localStorage.getItem('app_mode');
      // Override válido SOLO si user real es admin Y mode === 'prueba'
      if (override && mode === 'prueba' && profile.rol === 'admin') {
        return { ...profile, rol: override, _rolReal: profile.rol, _impersonando: true };
      }
    } catch {}
    return profile;
  })();

  async function login(email, password) {
    const result = await authLogin(email, password);
    // Validación defensiva: si Supabase devolvió un profile con rol inválido,
    // rechazamos el login en lugar de aceptarlo y dejar la app en estado raro.
    if (result.profile && !rolEsValido(result.profile.rol)) {
      await authLogout();
      throw new Error(
        `Tu cuenta no tiene un rol válido asignado (rol="${result.profile.rol || 'vacío'}"). Pedile al admin que te asigne uno.`
      );
    }
    setUser(result.session?.user ?? null);
    setProfile(result.profile);
    setOffline(result.offline);
    // PostHog: identificar al user por su id de Supabase + rol (sin email).
    try { identifyUser(result.profile); } catch {}
    if (!result.offline) {
      setTimeout(syncAll, 1000);
    }
    return result;
  }

  async function logout() {
    await authLogout();
    setUser(null);
    setProfile(null);
    setOffline(false);
    // PostHog: limpiar identidad anónima al cerrar sesión.
    try { resetUser(); } catch {}
    try {
      localStorage.removeItem('jx_user_role');
      localStorage.removeItem('jx_user_role_real');
      localStorage.removeItem('jx_role_override');
    } catch {}
  }

  // Copiar a localStorage el timeout configurado en app_config (llega por el
  // sync) — de ahí lo lee síncrono el timer de abajo. Se ignoran filas demo
  // (config editada en modo prueba no rige la sesión real).
  useEffect(() => {
    const refrescar = async () => {
      try {
        const rows = await db.app_config
          .filter(r => !r.deleted_at && r.demo !== true && r.clave === 'sesion_timeout_min')
          .toArray();
        if (!rows.length) return;
        rows.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
        localStorage.setItem(INACTIVITY_LS_KEY, String(clampTimeoutMin(rows[0].valor)));
      } catch { /* sin tabla aún (device con schema viejo) o sin localStorage */ }
    };
    refrescar();
    const onChange = (e) => { const t = e?.detail?.tabla; if (!t || t === 'app_config') refrescar(); };
    window.addEventListener('jx_data_changed', onChange);
    window.addEventListener('jx_sync_pull', refrescar);
    return () => { window.removeEventListener('jx_data_changed', onChange); window.removeEventListener('jx_sync_pull', refrescar); };
  }, []);

  // ── Logout por inactividad (configurable; default 30 min) ───────
  // Reinicia el timer en cada evento de usuario. Si pasa el timeout sin
  // actividad, cierra sesión automáticamente. Esto también ayuda contra
  // sesiones colgadas con datos en cache desactualizados — al volver a
  // loguear se vuelven a leer profile/permisos frescos del servidor.
  const inactivityTimer = useRef(null);
  useEffect(() => {
    if (!profile?.id) return;
    const reset = () => {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      inactivityTimer.current = setTimeout(() => {
        console.log('[useAuth] Sesión cerrada por inactividad');
        try { sessionStorage.setItem('jx_logout_reason', 'inactivity'); } catch {}
        logout();
      }, getInactivityMin() * 60 * 1000);
    };
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach(ev => window.addEventListener(ev, reset, { passive: true }));
    reset();
    return () => {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      events.forEach(ev => window.removeEventListener(ev, reset));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  return { user, profile: profileEfectivo, offline, loading, login, logout };
}
