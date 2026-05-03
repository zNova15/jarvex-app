// Vercel serverless function: POST /api/create-user
//
// Crea un usuario con email auto-confirmado usando la Admin API de Supabase.
// Esto evita que el usuario tenga que confirmar su email para poder loguearse.
//
// Body: {
//   email: string,
//   password: string,
//   nombres?: string,
//   apellidos?: string,
//   rol?: string,
//   created_by?: string  // admin que está creando (para audit)
// }
//
// Returns: { user_id, email, profile_created: boolean }
//
// Requiere en Vercel env vars:
//   - VITE_SUPABASE_URL (o SUPABASE_URL)
//   - SUPABASE_SERVICE_ROLE_KEY  ← KEY DE SERVICE ROLE, NO la anon
//
// Solo lo puede invocar un admin: validamos pasando el JWT del solicitante en
// el header Authorization. Si su perfil no tiene rol='admin' rechazamos.

const ROLES_VALIDOS = new Set([
  'admin','gerente','ingeniero_residente','supervisor','almacenero',
  'asistente_admin','contador','tesorero','jefe_compras','rrhh',
  'prevencionista','maestro_obra','solo_lectura',
]);

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
  const { email, password, nombres, apellidos, rol } = body;

  if (!email || !password) {
    return res.status(422).json({ error: 'Email y password requeridos' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(422).json({ error: 'Password mínimo 8 caracteres' });
  }
  const rolFinal = rol && ROLES_VALIDOS.has(rol) ? rol : 'solo_lectura';

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
    // Buscar perfil del solicitante
    const profResp = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${callerId}&select=rol,activo`, {
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
    });
    const profArr = await profResp.json();
    const callerProfile = Array.isArray(profArr) ? profArr[0] : null;
    if (!callerProfile || callerProfile.rol !== 'admin') {
      return res.status(403).json({ error: 'Solo un administrador puede crear usuarios' });
    }
    if (callerProfile.activo === false) {
      return res.status(403).json({ error: 'Tu cuenta de admin está inactiva' });
    }
  } catch (e) {
    return res.status(502).json({ error: 'Error validando admin', detail: e.message });
  }

  // ── 2. Crear usuario via Admin API con email_confirm:true ───
  // Si el email ya existe (porque el admin lo creó antes con signUp normal y
  // quedó sin confirmar), hacemos fallback: lo buscamos por email, le forzamos
  // email_confirm:true y actualizamos su password con la que mandó el admin.
  let newUserId = null;
  let wasUpdated = false;
  try {
    const createResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          nombres: nombres || null,
          apellidos: apellidos || null,
        },
      }),
    });
    if (createResp.ok) {
      const created = await createResp.json();
      newUserId = created?.id || created?.user?.id;
    } else {
      const errBody = await createResp.json().catch(() => ({}));
      const msg = errBody?.msg || errBody?.error_description || errBody?.error || `HTTP ${createResp.status}`;
      const yaExiste = createResp.status === 422 || createResp.status === 400 ||
        /already.*registered|already.*exists|duplicate|email_exists/i.test(msg);
      if (!yaExiste) {
        return res.status(createResp.status).json({ error: 'Error creando usuario', detail: msg });
      }
      // ── Fallback: usuario ya existe → buscarlo y auto-confirmarlo ──
      const listResp = await fetch(
        `${SUPABASE_URL}/auth/v1/admin/users?per_page=200`,
        { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } }
      );
      if (!listResp.ok) {
        return res.status(409).json({ error: 'Usuario ya existe pero no se pudo recuperar', detail: msg });
      }
      const listData = await listResp.json();
      const existing = (listData?.users || []).find(u => u.email?.toLowerCase() === email.toLowerCase());
      if (!existing) {
        return res.status(409).json({ error: 'Usuario ya existe pero no se encontró por email' });
      }
      newUserId = existing.id;
      // Forzar email_confirm + actualizar password
      const updResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${newUserId}`, {
        method: 'PUT',
        headers: {
          apikey: SERVICE_ROLE,
          Authorization: `Bearer ${SERVICE_ROLE}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email_confirm: true,
          password,
          user_metadata: {
            nombres: nombres || existing.user_metadata?.nombres || null,
            apellidos: apellidos || existing.user_metadata?.apellidos || null,
          },
        }),
      });
      if (!updResp.ok) {
        const updErr = await updResp.json().catch(()=>({}));
        return res.status(502).json({ error: 'No se pudo confirmar usuario existente', detail: updErr?.msg || updErr?.error || 'unknown' });
      }
      wasUpdated = true;
    }
    if (!newUserId) {
      return res.status(502).json({ error: 'Supabase no devolvió ID del usuario' });
    }
  } catch (e) {
    return res.status(502).json({ error: 'Error en Admin API', detail: e.message });
  }

  // ── 3. Upsert profile (con service role, bypass RLS) ────────
  let profileCreated = false;
  try {
    // Primero esperamos un poco al trigger handle_new_user (si existe)
    await new Promise(r => setTimeout(r, 400));
    // Hacer upsert con todos los campos finales
    const upResp = await fetch(`${SUPABASE_URL}/rest/v1/profiles?on_conflict=id`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify({
        id: newUserId,
        email,
        nombres: nombres || null,
        apellidos: apellidos || null,
        rol: rolFinal,
        activo: true,
      }),
    });
    if (upResp.ok) profileCreated = true;
    else {
      const errText = await upResp.text();
      console.warn('[create-user] profile upsert failed:', errText);
    }
  } catch (e) {
    console.warn('[create-user] profile upsert exception:', e.message);
  }

  return res.status(200).json({
    user_id: newUserId,
    email,
    rol: rolFinal,
    profile_created: profileCreated,
    was_updated: wasUpdated,
    message: wasUpdated
      ? 'Usuario ya existía: email confirmado y password actualizado. Ya puede ingresar.'
      : 'Usuario creado y email auto-confirmado. Ya puede ingresar.',
  });
}
