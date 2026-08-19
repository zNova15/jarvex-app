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

// ── Parseo SEGURO de la respuesta de un endpoint /api/* ──────────────
// Nunca uses `await resp.json()` directo: cuando la PLATAFORMA responde antes
// que la función (Vercel con la cuenta suspendida devuelve `402 Payment
// required` en TEXTO PLANO, header x-vercel-error: DEPLOYMENT_DISABLED), el
// .json() explota con "Unexpected token 'P'... is not valid JSON" y el usuario
// ve un error críptico en vez de la causa real (caso real: 19-ago-2026, la
// asistente contable con la bandeja llena de ese error).
//
// Devuelve SIEMPRE un objeto: el JSON del endpoint, o uno sintético con
// { error, code } legible. Códigos sintéticos:
//   'servicio_deshabilitado' → deployment caído por facturación de la nube
//   'servicio_no_json'       → respuesta no-JSON inesperada (proxy/HTML/5xx)
export async function apiParse(resp) {
  let raw = '';
  try { raw = await resp.text(); } catch { raw = ''; }
  if (raw) {
    try {
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') return data;
    } catch { /* no es JSON → abajo lo traducimos */ }
  }
  let vercelErr = '';
  try { vercelErr = resp.headers?.get?.('x-vercel-error') || ''; } catch {}
  const txt = `${raw} ${vercelErr}`;
  if (resp.status === 402 || /payment required|DEPLOYMENT_DISABLED|DEPLOYMENT_BLOCKED/i.test(txt)) {
    return {
      error: 'El servicio en la nube está DESHABILITADO por un tema de FACTURACIÓN de la cuenta de hosting (Vercel) — no es la IA ni tu conexión. '
        + 'La app y la sincronización siguen funcionando; la lectura automática de comprobantes vuelve apenas se regularice el pago.',
      code: 'servicio_deshabilitado',
      _status: resp.status,
    };
  }
  if (resp.status === 401 || resp.status === 403) {
    return { error: 'Tu sesión expiró o no tenés permiso para esta acción. Cerrá sesión y volvé a entrar.', code: 'no_autorizado', _status: resp.status };
  }
  return {
    error: `El servicio respondió algo inesperado (HTTP ${resp.status}). Reintentá en un momento; si sigue, avisá al administrador.`,
    code: 'servicio_no_json',
    _status: resp.status,
    _raw: String(raw).slice(0, 200),
  };
}
