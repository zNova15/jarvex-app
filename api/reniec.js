// Vercel serverless function: /api/reniec?dni=12345678
// Proxy a apis.net.pe v1 para evitar CORS.
//
// SECURITY:
// - Requiere usuario autenticado (Authorization: Bearer <jwt>).
// - Rate limit: 30 consultas / minuto / IP (mitigación contra enumeración masiva).
// - Validación de formato DNI antes de pegarle a RENIEC (ahorra cuota).

import { requireAuth, rateLimit, sanitizeError, isValidDNI, setCorsHeaders } from '../lib/api-helpers.js';

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    await requireAuth(req);
    rateLimit(req, { windowMs: 60_000, max: 30 });

    const { dni } = req.query || {};
    const d = String(dni || '').trim();

    if (!isValidDNI(d)) {
      return res.status(422).json({ error: 'DNI debe tener 8 dígitos numéricos válidos' });
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const upstream = await fetch(`https://api.apis.net.pe/v1/dni?numero=${d}`, {
      signal: ctrl.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timer);

    if (upstream.status === 401) {
      return res.status(503).json({ error: 'RENIEC requiere token ahora — avisa al admin' });
    }
    if (upstream.status === 404) {
      return res.status(404).json({ error: 'DNI no encontrado en RENIEC' });
    }
    if (upstream.status === 429) {
      return res.status(429).json({ error: 'Demasiadas consultas — espera un momento' });
    }
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `RENIEC respondió ${upstream.status}` });
    }

    const data = await upstream.json();
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json(data);
  } catch (e) {
    const sanitized = sanitizeError(e, 'No se pudo conectar a RENIEC');
    return res.status(sanitized.status).json(sanitized.body);
  }
}
