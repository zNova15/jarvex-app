// Vercel serverless function: POST /api/set-password
//
// Permite a un ADMIN fijar una nueva contraseña para cualquier usuario usando la
// Admin API de Supabase. Es la vía robusta para entregar credenciales en una app
// de escritorio/PWA, donde el reset por correo depende de config externa frágil
// (allowlist de Redirect URL + entregabilidad SMTP).
//
// Body: { user_id: string, password: string (min 8) }
// Returns: { ok: true, user_id }
//
// Requiere en Vercel env vars:
//   - VITE_SUPABASE_URL (o SUPABASE_URL)
//   - SUPABASE_SERVICE_ROLE_KEY  ← service_role, NUNCA la anon
//
// Seguridad: solo lo invoca un admin. Validamos el JWT del solicitante en el
// header Authorization y exigimos profiles.rol === 'admin' && activo !== false.
// (Mismo patrón que api/create-user.js.)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Solo POST' });
  }

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return res.status(503).json({
      error: 'Backend no configurado',
      detail: 'Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno de Vercel. ' +
              'Agregala en Project → Settings → Environment Variables (valor en Supabase Dashboard → Settings → API → service_role).',
    });
  }

  const body = req.body || {};
  const { user_id, password } = body;

  if (!user_id) {
    return res.status(422).json({ error: 'user_id requerido' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(422).json({ error: 'Password mínimo 8 caracteres' });
  }

  // ── 1. Validar que el solicitante es admin ──────────────────
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Falta token Authorization Bearer' });
  }
  const callerToken = authHeader.slice(7);

  try {
    const callerResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${callerToken}`,
      },
    });
    if (!callerResp.ok) {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }
    const caller = await callerResp.json();
    const callerId = caller?.id;
    if (!callerId) {
      return res.status(401).json({ error: 'No se pudo identificar al usuario' });
    }
    const profResp = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${callerId}&select=rol,activo`, {
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
    });
    const profArr = await profResp.json();
    const callerProfile = Array.isArray(profArr) ? profArr[0] : null;
    if (!callerProfile || callerProfile.rol !== 'admin') {
      return res.status(403).json({ error: 'Solo un administrador puede resetear contraseñas' });
    }
    if (callerProfile.activo === false) {
      return res.status(403).json({ error: 'Tu cuenta de admin está inactiva' });
    }
  } catch (e) {
    return res.status(502).json({ error: 'Error validando admin', detail: e.message });
  }

  // ── 2. Fijar la contraseña vía Admin API (y asegurar email confirmado) ──
  try {
    const updResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user_id}`, {
      method: 'PUT',
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password, email_confirm: true }),
    });
    if (!updResp.ok) {
      const errBody = await updResp.json().catch(() => ({}));
      const msg = errBody?.msg || errBody?.error_description || errBody?.error || `HTTP ${updResp.status}`;
      return res.status(updResp.status).json({ error: 'No se pudo actualizar la contraseña', detail: msg });
    }
  } catch (e) {
    return res.status(502).json({ error: 'Error en Admin API', detail: e.message });
  }

  return res.status(200).json({
    ok: true,
    user_id,
    message: 'Contraseña actualizada. El usuario ya puede ingresar con ella.',
  });
}
