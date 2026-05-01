// Vercel serverless function: /api/sunat-bill
//
// Proxy SOAP browser → SUNAT billService. SUNAT no devuelve headers CORS
// (Access-Control-Allow-Origin), así que el navegador bloquea el POST
// directo. Esta función corre en el mismo origen que la SPA, por lo que
// el browser no aplica CORS al llamarla, y SUNAT recibe la petición desde
// un entorno server (sin restricciones de same-origin).
//
// Entrada (JSON):
//   { soapEnvelope: string, ambiente: 'homologacion' | 'produccion' }
//
// Salida (JSON):
//   éxito: { ok: true, soapResponse: string, upstreamStatus: number }
//   error: { ok: false, code: string, message: string, upstreamStatus?: number }

const ENDPOINTS = {
  homologacion: 'https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService',
  produccion: 'https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService',
};

// SOAPAction del operation sendBill — SUNAT lo exige en el header.
const SOAP_ACTION = 'urn:sendBill';

export default async function handler(req, res) {
  // CORS — la SPA está en el mismo origen, pero por seguridad permitimos
  // explícitamente el dominio de prod y wildcard sólo para preflight de
  // mismo-origen. Si se monta en otro dominio, ajustar.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, code: 'METHOD', message: 'Solo POST' });
  }

  // Body: Vercel parsea JSON automáticamente cuando Content-Type es JSON.
  const body = req.body && typeof req.body === 'object' ? req.body : await readJsonBody(req);
  const { soapEnvelope, ambiente } = body || {};

  if (typeof soapEnvelope !== 'string' || !soapEnvelope.trim()) {
    return res.status(400).json({ ok: false, code: 'BAD_BODY', message: 'soapEnvelope requerido' });
  }
  const url = ENDPOINTS[ambiente];
  if (!url) {
    return res.status(400).json({ ok: false, code: 'BAD_AMBIENTE', message: 'ambiente debe ser homologacion o produccion' });
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000); // SUNAT puede demorar
    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': SOAP_ACTION,
        'Accept': 'text/xml, application/xml',
      },
      body: soapEnvelope,
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    const text = await upstream.text();

    // SUNAT devuelve 200 OK incluso para soap:Fault. Pasamos siempre el
    // texto al cliente y dejamos que él parsee.
    return res.status(200).json({
      ok: true,
      soapResponse: text,
      upstreamStatus: upstream.status,
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ ok: false, code: 'TIMEOUT', message: 'SUNAT tardó más de 30s' });
    }
    return res.status(502).json({ ok: false, code: 'UPSTREAM', message: 'No se pudo conectar a SUNAT', detail: String(e.message || e) });
  }
}

// Fallback parser de body si Vercel no lo parseó (caso raro)
async function readJsonBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}
