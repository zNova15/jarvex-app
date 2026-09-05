// Vercel serverless function: POST /api/r2
//
// Firma URLs prefirmadas (presigned) de Cloudflare R2 para las fotos de
// evidencias, previa validación de la sesión de Supabase del solicitante.
// R2 no tiene RLS: la autorización la da (a) que el usuario esté logueado y
// activo, y (b) el modelo de CAPABILITY del path — el path incluye el UUID de
// la evidencia (`<obra>/<aaaa-mm>/<id>.<ext>`), que solo se obtiene leyendo la
// fila en la tabla `evidencias`, protegida por RLS. Un usuario nunca aprende el
// path de una evidencia que su rol no puede ver (la RLS de la tabla oculta la
// fila) → firmar "cualquier path para un usuario activo" no filtra nada. La RLS
// del Storage de Supabase era defensa en profundidad sobre eso mismo.
//
// Los bytes viajan navegador ↔ R2 DIRECTO (no pasan por Vercel) → egress de
// Vercel y de Supabase ≈ 0; el egress de R2 es $0 para siempre.
//
// Body: {
//   action: 'sign_get' | 'sign_put',
//   path: string,           // clave dentro del bucket: <obra>/<aaaa-mm>/<id>.<ext>
//   contentType?: string,   // solo para sign_put
// }
// Returns: { url, expiresIn }
//
// Requiere en Vercel env vars:
//   - VITE_SUPABASE_URL (o SUPABASE_URL)
//   - SUPABASE_SERVICE_ROLE_KEY   ← para validar el token del solicitante
//   - R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
//   - R2_BUCKET (default 'jarvex-evidencias')

import crypto from 'node:crypto';

// TTL de la URL prefirmada. GET: 7 días (calza con la caché del cliente
// `jx_signed_urls` + el Service Worker que cachea 30 días → egress mínimo).
// 7 días es el MÁXIMO que permite SigV4 (604800 s). PUT: corto, solo para la
// ventana de subida.
const GET_EXPIRES = 7 * 24 * 3600;   // 604800 (tope de SigV4)
const PUT_EXPIRES = 3600;            // 1 h

// Path válido: <segmento>/<aaaa-mm>/<archivo>.<ext>. Sin '..', sin barras raras.
// El primer segmento es obra_id (uuid) o la carpeta fija 'captura-campo'.
const PATH_RE = /^[A-Za-z0-9_-]+\/\d{4}-\d{2}\/[A-Za-z0-9_.-]+\.[A-Za-z0-9]+$/;

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}
function sha256hex(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}
// Codifica cada segmento del path preservando las '/' (RFC 3986, como AWS SigV4).
function encodeKey(key) {
  return key.split('/').map(encodeURIComponent).join('/');
}

// Genera una URL prefirmada (query-signed) para R2 vía AWS SigV4.
// signedHeaders = 'host' solamente → el cliente puede mandar cualquier
// Content-Type en el PUT sin romper la firma.
function presignR2({ method, bucket, key, expires, accountId, accessKeyId, secretKey }) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const region = 'auto';
  const service = 's3';
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');   // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);                             // YYYYMMDD
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;

  const canonicalUri = `/${bucket}/${encodeKey(key)}`;
  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(params)
    .sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');

  const canonicalHeaders = `host:${host}\n`;
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Solo POST' });
  }

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
  const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
  const R2_SECRET = process.env.R2_SECRET_ACCESS_KEY;
  const R2_BUCKET = process.env.R2_BUCKET || 'jarvex-evidencias';

  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET) {
    // Sin R2 configurado: 503 → el cliente cae al camino Supabase (fallback).
    return res.status(503).json({
      error: 'R2 no configurado',
      detail: 'Faltan R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY en Vercel.',
    });
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return res.status(503).json({ error: 'Backend no configurado', detail: 'Falta SUPABASE_SERVICE_ROLE_KEY.' });
  }

  // ── 1. Validar que el solicitante es un usuario logueado y activo ──
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Falta token Authorization Bearer' });
  }
  const callerToken = authHeader.slice(7);
  try {
    const callerResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${callerToken}` },
    });
    if (!callerResp.ok) {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }
    const caller = await callerResp.json();
    const callerId = caller?.id;
    if (!callerId) return res.status(401).json({ error: 'No se pudo identificar al usuario' });
    // Perfil activo (mismo criterio que create-user). Si no hay fila de perfil
    // (raro), no bloqueamos por eso: basta con un token de Auth válido.
    const profResp = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${callerId}&select=activo`, {
      headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
    });
    const profArr = await profResp.json().catch(() => []);
    const prof = Array.isArray(profArr) ? profArr[0] : null;
    if (prof && prof.activo === false) {
      return res.status(403).json({ error: 'Tu cuenta está inactiva' });
    }
  } catch (e) {
    return res.status(502).json({ error: 'Error validando sesión', detail: e.message });
  }

  // ── 2. Validar acción y path ──
  const body = req.body || {};
  const action = body.action;
  const path = typeof body.path === 'string' ? body.path.replace(/^\/+/, '') : '';
  if (action !== 'sign_get' && action !== 'sign_put') {
    return res.status(422).json({ error: "action debe ser 'sign_get' o 'sign_put'" });
  }
  if (!path || path.includes('..') || !PATH_RE.test(path)) {
    return res.status(422).json({ error: 'path inválido' });
  }

  // ── 3. Firmar ──
  const method = action === 'sign_put' ? 'PUT' : 'GET';
  const expires = action === 'sign_put' ? PUT_EXPIRES : GET_EXPIRES;
  try {
    const url = presignR2({
      method,
      bucket: R2_BUCKET,
      key: path,
      expires,
      accountId: R2_ACCOUNT_ID,
      accessKeyId: R2_ACCESS_KEY_ID,
      secretKey: R2_SECRET,
    });
    return res.status(200).json({ url, expiresIn: expires });
  } catch (e) {
    return res.status(500).json({ error: 'No se pudo firmar la URL', detail: e.message });
  }
}
