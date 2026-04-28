// Vercel serverless function: /api/sunat?ruc=20100070970
//
// Proxy a apis.net.pe v1 para evitar CORS. apis.net.pe NO devuelve los
// headers Access-Control-Allow-Origin, así que el navegador bloquea el
// fetch directo. Como esta función corre en el mismo dominio (mismo
// origin que la SPA), el browser no aplica CORS.

export default async function handler(req, res) {
  const { ruc } = req.query || {};
  const r = String(ruc || '').trim();

  if (!/^\d{11}$/.test(r)) {
    return res.status(422).json({ error: 'RUC debe tener 11 dígitos numéricos' });
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const upstream = await fetch(`https://api.apis.net.pe/v1/ruc?numero=${r}`, {
      signal: ctrl.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timer);

    if (upstream.status === 401) {
      return res.status(503).json({ error: 'SUNAT requiere token ahora — avisa al admin' });
    }
    if (upstream.status === 404) {
      return res.status(404).json({ error: 'RUC no encontrado en SUNAT' });
    }
    if (upstream.status === 429) {
      return res.status(429).json({ error: 'Demasiadas consultas — espera un momento' });
    }
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `SUNAT respondió ${upstream.status}` });
    }

    const data = await upstream.json();
    // Cache de 1 hora — los datos de RUC cambian raramente
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json(data);
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'SUNAT tardó demasiado' });
    }
    return res.status(502).json({ error: 'No se pudo conectar a SUNAT', detail: e.message });
  }
}
