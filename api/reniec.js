// Vercel serverless function: /api/reniec?dni=12345678
// Proxy a apis.net.pe v1 para evitar CORS.

export default async function handler(req, res) {
  const { dni } = req.query || {};
  const d = String(dni || '').trim();

  if (!/^\d{8}$/.test(d)) {
    return res.status(422).json({ error: 'DNI debe tener 8 dígitos numéricos' });
  }

  try {
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
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'RENIEC tardó demasiado' });
    }
    return res.status(502).json({ error: 'No se pudo conectar a RENIEC', detail: e.message });
  }
}
