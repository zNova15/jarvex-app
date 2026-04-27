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

  return { user, profile, offline, loading, login, logout };
}
