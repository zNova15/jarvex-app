import { useState, useEffect, createContext, useContext } from 'react';
import { getCurrentUser, login as authLogin, logout as authLogout } from '../lib/auth';
import { syncAll } from '../sync/SyncEngine';

export const AuthContext = createContext(null);

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
        setUser(result.session?.user ?? null);
        setProfile(result.profile);
        setOffline(result.offline);
        if (!result.offline) {
          // Sincronizar al iniciar si hay internet
          setTimeout(syncAll, 2000);
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
  }

  return { user, profile: profileEfectivo, offline, loading, login, logout };
}
