import { supabase } from './supabase';
import { db } from '../db/jarvex.db';
import { registrarSiEsRestriccion, esErrorDeServicioRestringido } from './servicio-restringido';

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

    // Servicio restringido (402). A propósito NO caemos acá a la sesión
    // cacheada: el servidor nunca llegó a mirar la contraseña, así que
    // aceptarla sería dejar entrar a cualquiera que agarre el equipo. Lo que sí
    // hacemos es decir la verdad, porque el mensaje crudo ("Failed to fetch" o
    // un 402 pelado) hace pensar que el usuario se equivocó de clave.
    if (registrarSiEsRestriccion(err)) {
      const e = new Error(
        'El servicio de la base de datos está suspendido temporalmente (se agotó la cuota del plan). ' +
        'No es tu contraseña. Si ya tenías la sesión abierta en este equipo, NO cierres sesión: ' +
        'puedes seguir trabajando sin conexión y todo se sincroniza cuando el servicio vuelva.'
      );
      e.servicioRestringido = true;
      throw e;
    }
    throw err;
  }
}

// Borra storage local sensible al cerrar sesión.
// - localStorage: roles, overrides, búsquedas recientes
// - IndexedDB auth_cache: tokens y profile cacheados
// - Service Worker caches: evidencias firmadas con tokens viejos
async function fullLocalCleanup() {
  try { await clearCachedSession(); } catch {}
  // localStorage keys que el cliente setea con info por-usuario
  const keysToClear = [
    'jx_user_role', 'jx_user_role_real', 'jx_role_override',
    'jx_recent_searches', 'jx_recent_global', 'jx_perm_overrides_v1',
    'app_mode', 'obra_activa_id', 'jarvex_notif_asked',
    'jx_pcge_suggestions_v1', // cache de IA por-usuario
    'jx_signed_urls',         // URLs firmadas de evidencias: coherente con el
                              // borrado de 'evidencias-cache' de abajo (que no
                              // herede enlaces válidos el siguiente usuario)
  ];
  for (const k of keysToClear) {
    try { localStorage.removeItem(k); } catch {}
  }
  // SW caches con datos potencialmente sensibles
  if (typeof caches !== 'undefined') {
    try {
      await caches.delete('evidencias-cache');
    } catch {}
  }
}

export async function logout() {
  try {
    await supabase.auth.signOut();
  } finally {
    await fullLocalCleanup();
  }
}

export async function getCurrentUser() {
  if (navigator.onLine) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

      // ANTES: se devolvía `profile` tal cual viniera. Si la consulta fallaba
      // —el 402 del 9-set, pero también una RLS transitoria o un corte de red a
      // media carga— eso era `undefined`, y arriba el guard de rol lo dejaba
      // pasar por falsy: el usuario quedaba adentro SIN ROL, o sea sin menú y
      // sin poder trabajar, con todos sus datos intactos en IndexedDB al lado.
      //
      // Ahora, si el server no nos da el profile, usamos el cacheado y lo
      // declaramos `offline: true` (que es la verdad: no estamos hablando con
      // el servidor). La app entra en modo offline, que es justo para lo que
      // fue construida.
      if (error || !profile) {
        if (error) registrarSiEsRestriccion(error);
        const cachedProfile = await getCachedProfile();
        if (cachedProfile) {
          console.warn('[auth] El servidor no devolvió el profile — se usa el cacheado y se sigue offline.', error?.message ?? '');
          return { session, profile: cachedProfile, offline: true };
        }
        return { session, profile: null, offline: true };
      }

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
