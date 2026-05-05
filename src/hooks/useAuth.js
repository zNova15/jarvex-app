import { useState, useEffect, useRef, createContext, useContext } from 'react';
import { getCurrentUser, login as authLogin, logout as authLogout } from '../lib/auth';
import { syncAll } from '../sync/SyncEngine';

export const AuthContext = createContext(null);

// Lista canónica de roles válidos. Cualquier profile cuyo `rol` no esté acá
// se trata como inválido (NO se asume admin para evitar escalación).
const ROLES_VALIDOS = new Set([
  'admin','gerente','ingeniero_residente','supervisor','almacenero',
  'asistente_admin','contador','tesorero','jefe_compras','rrhh',
  'prevencionista','maestro_obra','solo_lectura',
]);

function rolEsValido(rol) {
  return typeof rol === 'string' && ROLES_VALIDOS.has(rol);
}

// Tiempo de inactividad antes de cerrar sesión (30 min). Cualquier interacción
// del usuario (mouse, teclado, scroll, click) reinicia el contador.
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

export function useAuth() {
  return useContext(AuthContext);
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
    try {
      localStorage.removeItem('jx_user_role');
      localStorage.removeItem('jx_user_role_real');
      localStorage.removeItem('jx_role_override');
    } catch {}
  }

  // ── Logout por inactividad (30 min sin interacción) ─────────────
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
      }, INACTIVITY_TIMEOUT_MS);
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
