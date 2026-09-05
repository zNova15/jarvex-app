// Vercel serverless function: POST /api/r2
//
// Firma URLs prefirmadas (presigned) de Cloudflare R2 para las fotos de
// evidencias, previa validación de la sesión de Supabase del solicitante.
// Los bytes viajan navegador ↔ R2 DIRECTO (no pasan por Vercel) → egress de
// Vercel y de Supabase ≈ 0; el egress de R2 es $0 para siempre.
//
// Body: {
//   action: 'sign_get' | 'sign_put',
//   path: string,           // clave dentro del bucket: <obra>/<aaaa-mm>/<uuid>.<ext>
//   contentType?: string,   // solo sign_put
//   size?: number,          // solo sign_put (bytes)
// }
// Returns: { url, expiresIn }   ·   404 si el objeto no está en R2 (sign_get)
//
// ── AUTORIZACIÓN ─────────────────────────────────────────────────────
// R2 no tiene RLS: la reponemos acá.
// - LECTURA (sign_get): modelo CAPABILITY. El path incluye el UUID de la
//   evidencia, que solo se obtiene leyendo la fila de `evidencias` (protegida
//   por RLS) → un usuario nunca aprende el path de una evidencia que su rol no
//   puede ver. Basta con sesión válida + perfil activo.
// - ESCRITURA (sign_put): NO alcanza el modelo capability, porque un PUT
//   SOBRESCRIBE. Sin este cerco, cualquiera que pudiera VER una evidencia
//   podía reemplazar su foto en silencio (lo que en Supabase Storage frenaban
//   las policies de las migs 136/160). Regla: si la fila ya existe, solo su
//   dueño (created_by/subido_por) o un admin pueden firmar el PUT.
// - La cuenta compartida del portal de campo (rol 'campo', entra con PIN) queda
//   cercada a la carpeta 'captura-campo/' (espejo de las migs 155/158/160).
//
// ── CORS QUE REQUIERE EL BUCKET ──────────────────────────────────────
// El navegador hace PUT con Content-Type (no safelisted) → preflight OPTIONS.
// Sin esta política, subir y abrir fotos falla con un simple "Failed to fetch":
//   [{ "AllowedOrigins": ["https://jarvex-app.vercel.app",
//                         "<previews de Vercel exactos>", "http://localhost:5173"],
//      "AllowedMethods": ["GET","PUT","HEAD"],
//      "AllowedHeaders": ["Content-Type","Cache-Control"],
//      "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
// R2 NO acepta comodines en AllowedOrigins: hay que listar los orígenes exactos.
// El Bearer de Supabase NUNCA viaja a R2 → no hace falta permitir 'authorization'.
//
// Requiere en Vercel env vars:
//   - VITE_SUPABASE_URL (o SUPABASE_URL)
//   - SUPABASE_SERVICE_ROLE_KEY   ← valida el token del solicitante
//   - R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
//   - R2_BUCKET (default 'jarvex-evidencias')
//   - R2_SKIP_HEAD (opcional, '1'): saltea el HEAD de existencia en sign_get.
//     Activar SOLO cuando Supabase ya no tenga nada que sirva de fallback
//     (fase final), para ahorrar una operación clase B por firma.

import crypto from 'node:crypto';

// TTL de la URL prefirmada. GET: 7 días (calza con la caché `jx_signed_urls`
// del cliente + el Service Worker, que cachea 30 días → egress mínimo). 7 días
// es el MÁXIMO que permite SigV4. PUT: corto, solo la ventana de subida.
const GET_EXPIRES = 7 * 24 * 3600;   // 604800 (tope de SigV4)
const PUT_EXPIRES = 3600;            // 1 h

// Path válido: <segmento>/<aaaa-mm>/<uuid>.<ext>. El primer segmento es un
// obra_id (uuid) o la carpeta fija 'captura-campo'. Verificado contra los 1.829
// objetos de producción (5-sep-2026): el 100% tiene esta forma.
const PATH_RE = /^[A-Za-z0-9_-]+\/\d{4}-\d{2}\/[0-9a-fA-F-]{36}\.[A-Za-z0-9]{1,10}$/;
// En la SUBIDA además acotamos la extensión y el tipo: sin esto se podía dejar
// cualquier objeto (html/svg/binario de 5 GB) en el bucket.
const PUT_EXT_RE = /\.(jpg|jpeg|png|webp|heic|heif|pdf)$/i;
const PUT_MIME_RE = /^(image\/(jpeg|jpg|png|webp|heic|heif)|application\/pdf|application\/octet-stream)$/i;
const MAX_PUT_BYTES = 8 * 1024 * 1024;   // espejo de MAX_PHOTO_BYTES del cliente
const CARPETA_CAMPO = 'captura-campo';

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
// signedHeaders = 'host' solamente → el cliente puede mandar Content-Type y
// Cache-Control sin romper la firma (R2 los persiste como metadata del objeto).
// Verificado byte a byte contra aws4fetch para GET/PUT/HEAD.
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

  const sbHeaders = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` };
  const firmar = (method, key, expires) => presignR2({
    method, bucket: R2_BUCKET, key, expires,
    accountId: R2_ACCOUNT_ID, accessKeyId: R2_ACCESS_KEY_ID, secretKey: R2_SECRET,
  });

  // ── 1. Validar que el solicitante es un usuario logueado y activo ──
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Falta token Authorization Bearer' });
  }
  const callerToken = authHeader.slice(7);
  let callerId = null;
  let callerRol = null;
  try {
    const callerResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${callerToken}` },
    });
    if (!callerResp.ok) {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }
    const caller = await callerResp.json();
    callerId = caller?.id;
    if (!callerId) return res.status(401).json({ error: 'No se pudo identificar al usuario' });

    // Perfil: FALLA CERRADO. `activo` es la única barrera contra una cuenta dada
    // de baja (Auth le sigue refrescando el token), así que un error de red o de
    // permisos NO puede degradar en "lo dejamos pasar". Verificado el 5-sep-2026:
    // los 17 usuarios de Auth tienen fila en profiles, así que exigirla no deja
    // a nadie afuera.
    const profResp = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${callerId}&select=rol,activo`, { headers: sbHeaders });
    if (!profResp.ok) {
      return res.status(502).json({ error: 'No se pudo validar el perfil' });
    }
    const profArr = await profResp.json().catch(() => null);
    const prof = Array.isArray(profArr) ? profArr[0] : null;
    if (!prof) return res.status(403).json({ error: 'Tu usuario no tiene perfil' });
    if (prof.activo === false) return res.status(403).json({ error: 'Tu cuenta está inactiva' });
    callerRol = prof.rol || null;
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
  // La cuenta compartida del portal de campo (PIN) solo toca su carpeta.
  const carpeta = path.slice(0, path.indexOf('/'));
  if (callerRol === 'campo' && carpeta !== CARPETA_CAMPO) {
    return res.status(403).json({ error: 'Esta cuenta solo accede a las capturas de campo' });
  }

  // ── 3. Firmar ──
  try {
    if (action === 'sign_get') {
      // Comprobar que el objeto EXISTE antes de entregar la URL. Sin esto, una
      // evidencia todavía no migrada recibía una URL de R2 válida que devuelve
      // 404, y el cliente la cacheaba 7 días → imagen rota que no se recupera
      // sola. Devolver 404 hace que el cliente caiga a Supabase (el fallback
      // que el diseño prometía). Cuesta una operación clase B por firma, y la
      // firma se reutiliza 7 días.
      if (process.env.R2_SKIP_HEAD !== '1') {
        const head = await fetch(firmar('HEAD', path, 300), { method: 'HEAD' });
        if (head.status === 404) {
          return res.status(404).json({ error: 'No está en R2', fallback: 'supabase' });
        }
        if (!head.ok) {
          // 403/400 = credencial, bucket o firma mal → no servir una URL rota.
          return res.status(502).json({ error: `R2 respondió ${head.status} al verificar el objeto` });
        }
      }
      return res.status(200).json({ url: firmar('GET', path, GET_EXPIRES), expiresIn: GET_EXPIRES });
    }

    // ── sign_put: cerco anti-tampering ──
    if (!PUT_EXT_RE.test(path)) {
      return res.status(422).json({ error: 'Extensión no permitida para subir' });
    }
    const contentType = typeof body.contentType === 'string' ? body.contentType : '';
    if (contentType && !PUT_MIME_RE.test(contentType)) {
      return res.status(422).json({ error: `Tipo de archivo no permitido: ${contentType}` });
    }
    const size = Number(body.size);
    if (Number.isFinite(size) && size > MAX_PUT_BYTES) {
      return res.status(422).json({ error: `Archivo muy grande (máximo ${MAX_PUT_BYTES / 1024 / 1024} MB)` });
    }

    // El nombre del archivo ES el id de la evidencia. Si esa fila YA existe,
    // solo su dueño (o un admin, que repara) puede pisar el objeto. Si no
    // existe, es una subida nueva (el upsert de metadata ocurre DESPUÉS del
    // PUT, y los reintentos re-suben el mismo path) → se permite.
    const evidenciaId = path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
    const evResp = await fetch(
      `${SUPABASE_URL}/rest/v1/evidencias?id=eq.${encodeURIComponent(evidenciaId)}&select=created_by,subido_por`,
      { headers: sbHeaders }
    );
    if (!evResp.ok) {
      return res.status(502).json({ error: 'No se pudo verificar la evidencia' });
    }
    const evArr = await evResp.json().catch(() => null);
    const fila = Array.isArray(evArr) ? evArr[0] : null;
    if (fila) {
      const esDueno = fila.created_by === callerId || fila.subido_por === callerId;
      if (!esDueno && callerRol !== 'admin') {
        return res.status(403).json({ error: 'Esa evidencia es de otro usuario' });
      }
    }

    return res.status(200).json({ url: firmar('PUT', path, PUT_EXPIRES), expiresIn: PUT_EXPIRES });
  } catch (e) {
    return res.status(500).json({ error: 'No se pudo firmar la URL', detail: e.message });
  }
}
