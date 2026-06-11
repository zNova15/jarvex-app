// Vercel serverless function: /api/reniec?dni=12345678
//
// Proxy a decolecta.com (sucesor de apis.net.pe) para evitar CORS.
//
// SECURITY:
// - Requiere usuario autenticado (Authorization: Bearer <jwt>).
// - Rate limit: 30 consultas / minuto / IP (mitigación contra enumeración masiva).
// - Validación de formato DNI antes de pegarle a la API.
//
// Estrategia — CADENA de proveedores, cada token va a SU API (un token de
// apis.net.pe mandado a decolecta da 401 seguro — ese era el bug del toast
// "Token decolecta inválido y fallback apis.net.pe falló"):
//   1. DECOLECTA_TOKEN  → decolecta v1/reniec/dni (datos completos, 100/mes free).
//   2. APIS_NET_PE_TOKEN → apis.net.pe v2/reniec/dni con Bearer.
//   3. Gratis           → apis.net.pe v1/dni (solo nombres; rate limit agresivo
//                          por IP — y las functions de Vercel comparten IP).
// 401/403/429/5xx de un proveedor → se intenta el siguiente. 404 = DNI no
// existe (autoritativo, no se sigue probando). La respuesta normalizada
// siempre tiene los mismos campos; lo que el proveedor no provee viene null.

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

    const providers = [];
    if (process.env.DECOLECTA_TOKEN) {
      providers.push({ id: 'decolecta/v1/reniec', url: `https://api.decolecta.com/v1/reniec/dni?numero=${d}`, token: process.env.DECOLECTA_TOKEN });
    }
    if (process.env.APIS_NET_PE_TOKEN) {
      providers.push({ id: 'apis.net.pe/v2', url: `https://api.apis.net.pe/v2/reniec/dni?numero=${d}`, token: process.env.APIS_NET_PE_TOKEN });
    }
    providers.push({ id: 'apis.net.pe/v1', url: `https://api.apis.net.pe/v1/dni?numero=${d}`, token: null });

    let last = null;
    for (const p of providers) {
      let upstream;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        upstream = await fetch(p.url, {
          signal: ctrl.signal,
          headers: p.token
            ? { 'Accept': 'application/json', 'Authorization': `Bearer ${p.token}` }
            : { 'Accept': 'application/json' },
        });
        clearTimeout(timer);
      } catch {
        last = { id: p.id, status: 0 };
        continue;
      }
      if (upstream.ok) {
        let data = null;
        try { data = await upstream.json(); } catch { last = { id: p.id, status: 200 }; continue; }
        // El v1 gratis a veces devuelve 200 con los nombres VACÍOS para DNIs
        // que su base (desactualizada) no tiene — tratarlo como no-encontrado.
        const norm = normalize(data, d, p.id);
        if (!String(norm.nombres || '').trim() && !String(norm.apellidoPaterno || '').trim()) {
          last = { id: p.id, status: 404, gratis: !p.token };
          continue;
        }
        res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
        return res.status(200).json(norm);
      }
      if (upstream.status === 404) {
        // El no-encontrado del servicio GRATUITO no es confiable: su base está
        // desactualizada y suele no tener DNIs recientes. Decirlo claro para
        // que el usuario no dude de un DNI correcto.
        if (!p.token) {
          return res.status(404).json({ error: 'DNI no encontrado en el servicio gratuito de RENIEC (su base está desactualizada y puede no incluir DNIs recientes ni fecha de nacimiento). Verificá el número; si es correcto, registrate gratis en apis.net.pe y poné el token APIS_NET_PE_TOKEN en Vercel para usar la base completa.' });
        }
        return res.status(404).json({ error: 'DNI no encontrado en RENIEC — verificá el número' });
      }
      // 401/403 = token inválido para ESE proveedor; 429 = límite; 5xx = caído
      // → probar el siguiente de la cadena.
      console.warn(`[reniec] ${p.id} respondió ${upstream.status}${p.token ? ' — revisá ese token en Vercel (Settings → Environment Variables)' : ''}`);
      last = { id: p.id, status: upstream.status };
    }
    if (last && last.status === 429) {
      return res.status(429).json({ error: 'Demasiadas consultas al servicio de DNI — espera un minuto y reintenta' });
    }
    if (last && last.status === 404) {
      // Cayó acá por un 200-vacío tratado como no-encontrado.
      return res.status(404).json({ error: last.gratis
        ? 'DNI no encontrado en el servicio gratuito de RENIEC (su base está desactualizada y puede no incluir DNIs recientes ni fecha de nacimiento). Verificá el número; si es correcto, registrate gratis en apis.net.pe y poné el token APIS_NET_PE_TOKEN en Vercel para usar la base completa.'
        : 'DNI no encontrado en RENIEC — verificá el número' });
    }
    return res.status(503).json({ error: `Servicio de DNI no disponible (${last ? `${last.id} respondió ${last.status || 'timeout'}` : 'sin proveedores'}) — reintenta o revisa los tokens en Vercel` });
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
