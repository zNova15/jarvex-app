// Helpers compartidos entre los endpoints serverless de /api.
//
// IMPORTANTE: este archivo NO debe tener `export default`. Vercel cuenta
// como serverless function a TODO archivo .js en /api/ que tenga
// `export default`, contra el límite de 12 functions del plan Hobby.
// Antes este archivo tenía un `export default function notAnEndpoint`
// pensado como guard, pero eso lo hacía contar como function — el guard
// era contraproducente. Si Vercel por algún motivo lo expusiera como
// endpoint (solo si lo solicitan como /api/_lib), responde con 404 por
// defecto (no hay handler match).

// ── 1. Validar usuario autenticado ────────────────────────────────
//
// Verifica el header `Authorization: Bearer <jwt>` contra Supabase Auth.
// Devuelve { user_id, profile } si el token es válido.
// Lanza error con `status` y `message` si no.
//
// Uso:
//   const { user_id, profile } = await requireAuth(req);
//   if (profile.rol !== 'admin') throw httpError(403, 'Solo admin');
//
export async function requireAuth(req) {
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    throw httpError(503, 'Backend no configurado (faltan env vars Supabase)');
  }
  const auth = req.headers.authorization || req.headers.Authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    throw httpError(401, 'Falta token Authorization Bearer');
  }
  const token = auth.slice(7);
  let userResp;
  try {
    userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    throw httpError(502, 'Error validando sesión');
  }
  if (!userResp.ok) throw httpError(401, 'Token inválido o expirado');
  const userData = await userResp.json();
  const userId = userData?.id;
  if (!userId) throw httpError(401, 'No se pudo identificar al usuario');
  // Cargar profile para chequeo de rol
  let profile = null;
  try {
    const profResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=id,rol,activo`,
      { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } }
    );
    const arr = await profResp.json();
    profile = Array.isArray(arr) ? arr[0] : null;
  } catch (e) { /* profile null */ }
  if (profile?.activo === false) throw httpError(403, 'Cuenta desactivada');
  return { user_id: userId, profile, token };
}

export async function requireAdmin(req) {
  const ctx = await requireAuth(req);
  if (ctx.profile?.rol !== 'admin') throw httpError(403, 'Solo administradores');
  return ctx;
}

// ── 2. Rate limiting in-memory por IP (suficiente para mitigar abuso) ──
//
// LIMITACIÓN: Vercel funcs son stateless entre invocaciones — este map se
// pierde cada cold start. Es una primera línea contra spam, no anti-DDoS
// serio. Para producción usar @upstash/ratelimit o Vercel KV.
//
const _rateBuckets = new Map();

export function rateLimit(req, { windowMs = 60_000, max = 30, key = null } = {}) {
  const ip = key || (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown')
    .split(',')[0].trim();
  const now = Date.now();
  const bucket = _rateBuckets.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }
  bucket.count++;
  _rateBuckets.set(ip, bucket);
  // Limpieza ocasional
  if (_rateBuckets.size > 5000) {
    for (const [k, b] of _rateBuckets) if (now > b.resetAt) _rateBuckets.delete(k);
  }
  if (bucket.count > max) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    throw httpError(429, `Demasiadas requests. Esperá ${retryAfter}s.`, { retryAfter });
  }
  return { remaining: max - bucket.count, resetAt: bucket.resetAt };
}

// ── 3. Sanitizar inputs para concatenación a prompts AI ────────────
//
// Quita caracteres de control, normaliza newlines, limita longitud.
// Previene prompt injection básico — un atacante NO puede inyectar
// "\n\nIGNORÁ ANTERIOR" porque los \n se reemplazan por espacios.
//
export function sanitizeForPrompt(s, max = 500) {
  if (s === null || s === undefined) return '';
  return String(s)
    // Caracteres de control y bidi/RTL marks
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f‪-‮⁦-⁩]/g, '')
    // Newlines, tabs, carriage returns → espacio único
    .replace(/[\n\r\t]+/g, ' ')
    // Backticks y comillas que rompen JSON/markdown
    .replace(/[`]/g, "'")
    // Espacios múltiples
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// ── 4. Sanitizar errores antes de devolverlos al cliente ───────────
//
// En producción NO devolvemos `detail` upstream (que podría contener
// info sensible: tokens en headers, paths, etc.). En dev sí, para
// debugging. El error se loguea siempre en server-side.
//
export function sanitizeError(err, fallback = 'Error en el servicio') {
  const isProd = process.env.NODE_ENV === 'production';
  console.error('[api error]', err);
  if (err && typeof err === 'object' && err._httpError) {
    return { status: err.status, body: { error: err.message, ...(err.extra || {}) } };
  }
  return {
    status: 502,
    body: {
      error: fallback,
      ...(isProd ? {} : { detail: String(err?.message || err).slice(0, 400) }),
    },
  };
}

export function httpError(status, message, extra = null) {
  const e = new Error(message);
  e._httpError = true;
  e.status = status;
  e.extra = extra;
  return e;
}

// ── 5. Validar magic bytes (tipo de archivo real) ──────────────────
//
// Recibe un Buffer y valida que el contenido coincida con el mimeType
// declarado por el cliente. Previene que un atacante suba .exe disfrazado.
//
export function validateFileBytes(buffer, declaredMime) {
  if (!buffer || buffer.length < 8) return { ok: false, reason: 'archivo vacío o muy corto' };
  const head4 = buffer.slice(0, 4);
  const head8 = buffer.slice(0, 8);
  // PDF
  if (head4.toString('utf8') === '%PDF') {
    return { ok: declaredMime === 'application/pdf', actualType: 'pdf' };
  }
  // JPEG (FFD8FFxx)
  if (head4[0] === 0xFF && head4[1] === 0xD8 && head4[2] === 0xFF) {
    return { ok: ['image/jpeg', 'image/jpg'].includes(declaredMime), actualType: 'jpeg' };
  }
  // PNG (89 50 4E 47 0D 0A 1A 0A)
  if (head8.toString('hex').toLowerCase() === '89504e470d0a1a0a') {
    return { ok: declaredMime === 'image/png', actualType: 'png' };
  }
  // WEBP (RIFF....WEBP)
  if (head4.toString('utf8') === 'RIFF' && buffer.slice(8, 12).toString('utf8') === 'WEBP') {
    return { ok: declaredMime === 'image/webp', actualType: 'webp' };
  }
  // HEIC/HEIF (....ftypheic / ....ftyphei[fcmsx])
  if (buffer.slice(4, 8).toString('utf8') === 'ftyp') {
    const brand = buffer.slice(8, 12).toString('utf8');
    if (['heic', 'heif', 'heix', 'hevc', 'hevx', 'mif1'].includes(brand)) {
      return { ok: ['image/heic', 'image/heif'].includes(declaredMime), actualType: 'heic' };
    }
  }
  return { ok: false, reason: 'tipo de archivo no permitido (solo PDF/JPEG/PNG/WEBP/HEIC)' };
}

// ── 6. Validar dígito verificador de DNI peruano ───────────────────
//
// El DNI peruano tiene 8 dígitos numéricos. NO tiene dígito verificador
// estándar como el RUC (sum mod 11). Sin embargo, validamos formato y
// rechazamos patrones obvios (00000000, 11111111, etc.).
//
export function isValidDNI(dni) {
  if (!/^\d{8}$/.test(dni)) return false;
  // Rechazar patrones triviales que NUNCA son DNIs reales
  if (/^(\d)\1{7}$/.test(dni)) return false;       // todos iguales
  if (dni === '12345678' || dni === '87654321') return false;
  return true;
}

// Validar RUC peruano (11 dígitos, dígito verificador mod 11).
// Tipos válidos: 10 (persona natural), 15 (extranjero), 17 (no domiciliado),
// 20 (sociedad).
export function isValidRUC(ruc) {
  if (!/^\d{11}$/.test(ruc)) return false;
  const tipo = ruc.slice(0, 2);
  if (!['10', '15', '17', '20'].includes(tipo)) return false;
  // Dígito verificador
  const factores = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let suma = 0;
  for (let i = 0; i < 10; i++) suma += Number(ruc[i]) * factores[i];
  const resto = 11 - (suma % 11);
  const dv = resto >= 10 ? resto - 10 : resto;
  return dv === Number(ruc[10]);
}

// ── 7. CORS controlado ─────────────────────────────────────────────
//
// Solo permite el dominio de la app + localhost para dev. Reemplaza el
// `Access-Control-Allow-Origin: *` que era inseguro.
//
const ALLOWED_ORIGINS = [
  // Dominio de producción
  'https://jarvex-app.vercel.app',
  // Dominios de preview Vercel (regex)
  /^https:\/\/jarvex-app-[\w-]+\.vercel\.app$/,
  // Local dev
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:3000',
];

export function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  const allowed = ALLOWED_ORIGINS.some(o =>
    typeof o === 'string' ? o === origin : o.test(origin || '')
  );
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-supabase-token');
}
