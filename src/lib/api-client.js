// Cliente HTTP con autenticación automática para los endpoints /api/*.
//
// Agrega el `Authorization: Bearer <jwt>` desde la sesión activa de Supabase.
// Si no hay sesión, manda el request igual (algunos endpoints podrían ser
// públicos en el futuro y la app cliente querer recibir el 401 limpio).
//
// El import de supabase es lazy + protegido: en entornos de test (node sin
// window) la carga puede fallar — devolvemos headers vacíos en vez de propagar.

const DEFAULT_TIMEOUT_MS = 30000;
let _supabaseRef = null;
let _supabaseLoadFailed = false;

async function getSupabase() {
  if (_supabaseRef) return _supabaseRef;
  if (_supabaseLoadFailed) return null;
  if (typeof window === 'undefined') {
    _supabaseLoadFailed = true;
    return null;
  }
  try {
    const mod = await import('./supabase');
    _supabaseRef = mod.supabase;
    return _supabaseRef;
  } catch {
    _supabaseLoadFailed = true;
    return null;
  }
}

async function getAuthHeaders() {
  try {
    const sb = await getSupabase();
    if (!sb) return {};
    const { data: { session } } = await sb.auth.getSession();
    const token = session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

// Fetch contra /api/* con auth + timeout configurable.
export async function apiFetch(path, opts = {}) {
  const { timeout = DEFAULT_TIMEOUT_MS, ...rest } = opts;
  const authHeaders = await getAuthHeaders();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(path, {
      ...rest,
      signal: rest.signal || controller.signal,
      headers: {
        ...(rest.headers || {}),
        ...authHeaders,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}
