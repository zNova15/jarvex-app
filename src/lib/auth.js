import { supabase } from './supabase';
import { db } from '../db/jarvex.db';

const AUTH_KEY = 'current_session';
const PROFILE_KEY = 'current_profile';

// ── Guardar sesión en IndexedDB para uso offline ──────────────────────

async function cacheSession(session, profile) {
  await db.auth_cache.put({ key: AUTH_KEY, value: session });
  if (profile) {
    await db.auth_cache.put({ key: PROFILE_KEY, value: profile });
  }
}

async function clearCachedSession() {
  await db.auth_cache.delete(AUTH_KEY);
  await db.auth_cache.delete(PROFILE_KEY);
}

export async function getCachedSession() {
  const entry = await db.auth_cache.get(AUTH_KEY);
  return entry?.value ?? null;
}

export async function getCachedProfile() {
  const entry = await db.auth_cache.get(PROFILE_KEY);
  return entry?.value ?? null;
}

// ── Login (online + offline) ──────────────────────────────────────────

export async function login(email, password) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    const { data: profileData } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();

    await cacheSession(data.session, profileData);
    return { session: data.session, profile: profileData, offline: false };
  } catch (err) {
    // Si no hay internet, intentar con sesión cacheada
    if (!navigator.onLine) {
      const cachedSession = await getCachedSession();
      const cachedProfile = await getCachedProfile();
      if (cachedSession && cachedProfile) {
        return { session: cachedSession, profile: cachedProfile, offline: true };
      }
    }
    throw err;
  }
}

export async function logout() {
  try {
    await supabase.auth.signOut();
  } finally {
    await clearCachedSession();
  }
}

export async function getCurrentUser() {
  if (navigator.onLine) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();
      await cacheSession(session, profile);
      return { session, profile, offline: false };
    }
  }

  // Fallback offline
  const cachedSession = await getCachedSession();
  const cachedProfile = await getCachedProfile();
  if (cachedSession && cachedProfile) {
    const expiry = cachedSession.expires_at * 1000;
    if (expiry > Date.now()) {
      return { session: cachedSession, profile: cachedProfile, offline: true };
    }
  }

  return null;
}

export function getAuthHeader() {
  return supabase.auth.getSession().then(({ data: { session } }) => ({
    Authorization: session ? `Bearer ${session.access_token}` : '',
  }));
}
