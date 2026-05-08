// ═══════════════════════════════════════════════════════════════════
// JARVEX — Sentry tunnel
//
// Endpoint que reenvía los envelopes de Sentry desde el browser al
// ingest endpoint de sentry.io. El cliente postea acá (mismo dominio
// que la app, siempre permitido), y este endpoint los reenvía.
//
// Por qué: muchos adblockers (uBlock, Brave Shields, AdGuard, Privacy
// Badger) bloquean los dominios *.ingest.sentry.io porque los tratan
// como tracking. El tunnel los esquiva porque del lado del browser
// la request va a /api/sentry-tunnel — un dominio propio que no está
// en ninguna blocklist.
//
// Compatibilidad: el SDK de Sentry detecta el `tunnel` option y manda
// los envelopes con Content-Type: application/x-sentry-envelope.
// Acá los parseamos para extraer el DSN destino del header del envelope
// y reenviamos al endpoint correcto.
//
// Validación de DSN: solo aceptamos eventos para los DSN que están en
// SENTRY_KNOWN_HOSTS — evita que el endpoint sea abusado como proxy
// genérico para enviar tráfico a cualquier sentry.io.
//
// Ver: https://docs.sentry.io/platforms/javascript/troubleshooting/#dealing-with-ad-blockers
// ═══════════════════════════════════════════════════════════════════

// Hosts de Sentry permitidos (dominio del DSN configurado).
// Si cambia el DSN, agregalo acá y a la env var del frontend.
const SENTRY_KNOWN_HOSTS = [
  'o4511347575685120.ingest.us.sentry.io',
  // Agregar acá si tenés más proyectos Sentry en el futuro
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Solo POST' });
    return;
  }

  try {
    // El body viene como Buffer (raw). Vercel/Node no parsean bodies
    // application/x-sentry-envelope automáticamente.
    let bodyChunks = [];
    for await (const chunk of req) {
      bodyChunks.push(chunk);
    }
    const envelopeBytes = Buffer.concat(bodyChunks);

    // El primer line del envelope es JSON con el header global,
    // que incluye 'dsn' (URL completa del DSN).
    const text = envelopeBytes.toString('utf-8');
    const newlineIdx = text.indexOf('\n');
    if (newlineIdx === -1) {
      res.status(400).json({ error: 'Envelope sin header line' });
      return;
    }
    const headerJson = text.slice(0, newlineIdx);
    let header;
    try {
      header = JSON.parse(headerJson);
    } catch {
      res.status(400).json({ error: 'Envelope header malformado' });
      return;
    }

    if (!header.dsn) {
      res.status(400).json({ error: 'Envelope sin DSN' });
      return;
    }

    // Extraer host del DSN. Formato: https://<key>@<host>/<projectId>
    let dsn;
    try {
      dsn = new URL(header.dsn);
    } catch {
      res.status(400).json({ error: 'DSN inválido' });
      return;
    }

    // Validar que el host esté en la lista de permitidos
    if (!SENTRY_KNOWN_HOSTS.includes(dsn.hostname)) {
      res.status(403).json({ error: 'Host del DSN no autorizado: ' + dsn.hostname });
      return;
    }

    // El project ID viene en el path del DSN: /<projectId>
    const projectId = dsn.pathname.replace(/^\/+/, '');
    if (!/^\d+$/.test(projectId)) {
      res.status(400).json({ error: 'Project ID inválido en DSN' });
      return;
    }

    // Reenviar al endpoint real de Sentry
    const sentryEndpoint = `https://${dsn.hostname}/api/${projectId}/envelope/`;
    const sentryResponse = await fetch(sentryEndpoint, {
      method: 'POST',
      body: envelopeBytes,
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        // Sentry usa el sentry_key del DSN para autenticar; viene en el envelope
      },
    });

    // Pasar el status del response de Sentry (200 OK normalmente)
    res.status(sentryResponse.status);

    // Pasar el body si lo hay
    const bodyText = await sentryResponse.text();
    if (bodyText) {
      res.setHeader('Content-Type', sentryResponse.headers.get('content-type') || 'application/json');
      res.send(bodyText);
    } else {
      res.end();
    }
  } catch (err) {
    console.error('[sentry-tunnel] error', err);
    res.status(500).json({ error: err?.message || 'tunnel error' });
  }
}

export const config = {
  api: {
    bodyParser: false, // Necesitamos el body raw para reenviar tal cual
  },
};
