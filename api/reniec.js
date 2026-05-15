// Vercel serverless function: /api/reniec?dni=12345678
//
// Proxy a decolecta.com (sucesor de apis.net.pe) para evitar CORS.
//
// SECURITY:
// - Requiere usuario autenticado (Authorization: Bearer <jwt>).
// - Rate limit: 30 consultas / minuto / IP (mitigación contra enumeración masiva).
// - Validación de formato DNI antes de pegarle a la API.
//
// Estrategia:
//   1. Si hay DECOLECTA_TOKEN (o APIS_NET_PE_TOKEN como alias legacy) →
//      decolecta v1/reniec/dni → devuelve nombres + apellidos + fecha de
//      nacimiento + sexo + ubigeo (plan free 100/mes).
//   2. Fallback → apis.net.pe v1/dni gratis (solo nombres + apellidos,
//      sin fecha de nacimiento).
// La respuesta normalizada siempre incluye los mismos campos; lo que
// la API gratis no devuelve viene como null.

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

    const token = process.env.DECOLECTA_TOKEN || process.env.APIS_NET_PE_TOKEN;
    const useFull = !!token;

    const url = useFull
      ? `https://api.decolecta.com/v1/reniec/dni?numero=${d}`
      : `https://api.apis.net.pe/v1/dni?numero=${d}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const upstream = await fetch(url, {
      signal: ctrl.signal,
      headers: useFull
        ? { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
        : { 'Accept': 'application/json' },
    });
    clearTimeout(timer);

    if (upstream.status === 401) {
      // Token decolecta inválido — caer al endpoint gratis sin romper UX
      if (useFull) {
        console.warn('[reniec] decolecta 401 — verificá DECOLECTA_TOKEN en Vercel, cayendo a apis.net.pe v1');
        const fallbackCtrl = new AbortController();
        const fbTimer = setTimeout(() => fallbackCtrl.abort(), 8000);
        const fb = await fetch(`https://api.apis.net.pe/v1/dni?numero=${d}`, {
          signal: fallbackCtrl.signal,
          headers: { 'Accept': 'application/json' },
        });
        clearTimeout(fbTimer);
        if (!fb.ok) {
          return res.status(503).json({ error: 'Token decolecta inválido y fallback apis.net.pe falló' });
        }
        const data = await fb.json();
        res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
        return res.status(200).json(normalize(data, d, 'apis.net.pe/v1'));
      }
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
    return res.status(200).json(normalize(data, d, useFull ? 'decolecta/v1/reniec' : 'apis.net.pe/v1'));
  } catch (e) {
    const sanitized = sanitizeError(e, 'No se pudo conectar a RENIEC');
    return res.status(sanitized.status).json(sanitized.body);
  }
}

// Normaliza la respuesta entre decolecta (snake_case con campos extra) y
// apis.net.pe v1 (camelCase básico). Devuelve siempre los mismos campos;
// los que la API gratis no provee vienen como null.
function normalize(data, dni, source) {
  if (!data || typeof data !== 'object') return { numeroDocumento: dni, _source: source };

  // decolecta v1/reniec/dni keys posibles: first_name / first_last_name /
  // second_last_name / full_name / document_number / date_of_birth /
  // birth_date / gender / ubigeo / civil_status.
  // apis.net.pe v1/dni keys: nombres / apellidoPaterno / apellidoMaterno /
  // numeroDocumento / tipoDocumento.
  const nombres = data.nombres ?? data.first_name ?? data.firstName ?? '';
  const apellidoPaterno = data.apellidoPaterno ?? data.first_last_name ?? data.firstLastName ?? data.paterno ?? '';
  const apellidoMaterno = data.apellidoMaterno ?? data.second_last_name ?? data.secondLastName ?? data.materno ?? '';
  const numeroDocumento = data.numeroDocumento ?? data.document_number ?? data.documentNumber ?? dni;

  // Fecha de nacimiento: aceptamos varias keys. Normalizamos a ISO
  // YYYY-MM-DD para que el <input type="date"> la acepte sin parseo extra.
  let fechaNacimiento = data.fechaNacimiento ?? data.fecha_nacimiento ?? data.date_of_birth
    ?? data.dateOfBirth ?? data.birth_date ?? data.birthDate ?? null;
  if (fechaNacimiento) fechaNacimiento = toIsoDate(fechaNacimiento);

  const sexo = data.sexo ?? data.gender ?? null;
  const ubigeo = data.ubigeo ?? data.ubigeo_reniec ?? null;
  const estadoCivil = data.estadoCivil ?? data.civil_status ?? data.estado_civil ?? null;
  const direccion = data.direccion ?? data.address ?? null;

  return {
    numeroDocumento,
    nombres,
    apellidoPaterno,
    apellidoMaterno,
    fechaNacimiento,
    sexo,
    ubigeo,
    estadoCivil,
    direccion,
    _source: source,
  };
}

function toIsoDate(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    return `${m[3]}-${mm}-${dd}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}
