// Vercel serverless function: /api/sunat?ruc=20100070970
//
// Proxy a decolecta.com (sucesor de apis.net.pe) para evitar CORS.
//
// SECURITY:
// - Requiere usuario autenticado (Authorization: Bearer <jwt>).
// - Rate limit: 30 consultas / minuto / IP.
// - Validación de dígito verificador del RUC antes de consultar (ahorra cuota).
// - Errores upstream sanitizados — no se filtra info del token.
//
// Estrategia:
//   1. Si hay DECOLECTA_TOKEN (o APIS_NET_PE_TOKEN como alias legacy) →
//      decolecta v1/sunat/ruc/full → devuelve actividad económica,
//      dirección detallada, locales anexos, etc. Plan free 100 cons/mes.
//   2. Si no → fallback a apis.net.pe v1/ruc legacy (gratis sin token,
//      solo razón social + dirección).

import { requireAuth, rateLimit, sanitizeError, isValidRUC, setCorsHeaders } from '../lib/api-helpers.js';

// ── Mapeo de actividades económicas / CIIU → rubro JARVEX ────
// El mapeo busca palabras clave en el texto de actividad económica
// que devuelve SUNAT. Cuando una empresa tiene varias actividades, se
// usa la primera/principal.
const RUBRO_KEYWORDS = [
  // [palabras_clave, rubro_jarvex]
  [['fierro','acero','varillas','siderurg','metalurg'],          'importadora_acero'],
  [['cemento','clinker','aglomerante'],                          'importadora_cemento'],
  [['ferreter','herramienta','cerrajer'],                        'ferreteria'],
  [['materiales de construc','agregad','arena','grava','ladrill'], 'distribuidora_materiales'],
  [['transport','flete','carga por carretera'],                  'transporte'],
  [['alquiler de maquinaria','maquinaria de construc','alquiler de equipo'], 'alquiler_maquinaria'],
  [['venta de maquinaria','maquinaria pesada'],                  'venta_maquinaria'],
  [['mano de obra','contratista de mano de obra','servicios de personal','tercerizaci'], 'mano_obra'],
  [['superv','consultor','servicios de ingenier','servicios profesional'], 'supervision'],
  [['estudio','proyecto','arquitect','dise'],                    'estudios_proyectos'],
  [['inmobil','venta de bienes raic','alquiler de inmu'],        'inmobiliaria'],
  [['construcci','obras de ingenier','edificaci','obra civil'],  'ejecutora_obra'],
  [['contratista'],                                              'contratista_general'],
  [['importac','comercio internac'],                             'importadora_general'],
];

function clasificarRubro(actividadTexto) {
  if (!actividadTexto) return null;
  const t = String(actividadTexto).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const [keywords, rubro] of RUBRO_KEYWORDS) {
    if (keywords.some(k => t.includes(k))) return rubro;
  }
  return null;
}

// ── SOAP: enviar comprobante a billService de SUNAT (era /api/sunat-bill) ──
// Consolidado acá para no exceder el límite de 12 functions del plan
// Hobby de Vercel. Se diferencia por método HTTP:
//   GET  /api/sunat?ruc=...        → consulta info de RUC
//   POST /api/sunat                → envía SOAP envelope al billService
const BILL_ENDPOINTS = {
  homologacion: 'https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService',
  produccion: 'https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService',
};
const SOAP_ACTION = 'urn:sendBill';

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

async function handleSendBill(req, res) {
  try {
    await requireAuth(req);
    rateLimit(req, { windowMs: 60_000, max: 10 });
  } catch (e) {
    const sanitized = sanitizeError(e, 'No autorizado');
    return res.status(sanitized.status).json({ ok: false, ...sanitized.body });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : await readJsonBody(req);
  const { soapEnvelope, ambiente } = body || {};

  if (typeof soapEnvelope !== 'string' || !soapEnvelope.trim()) {
    return res.status(400).json({ ok: false, code: 'BAD_BODY', message: 'soapEnvelope requerido' });
  }
  if (soapEnvelope.length > 5_000_000 || !/<\w+:?Envelope/i.test(soapEnvelope)) {
    return res.status(400).json({ ok: false, code: 'BAD_BODY', message: 'soapEnvelope debe ser un SOAP envelope válido (<5MB)' });
  }
  const url = BILL_ENDPOINTS[ambiente];
  if (!url) {
    return res.status(400).json({ ok: false, code: 'BAD_AMBIENTE', message: 'ambiente debe ser homologacion o produccion' });
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
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
    return res.status(200).json({
      ok: true,
      soapResponse: text,
      upstreamStatus: upstream.status,
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ ok: false, code: 'TIMEOUT', message: 'SUNAT tardó más de 30s' });
    }
    console.error('[sunat sendBill] upstream error:', e?.message);
    const isProd = process.env.NODE_ENV === 'production';
    return res.status(502).json({
      ok: false,
      code: 'UPSTREAM',
      message: 'No se pudo conectar a SUNAT',
      ...(isProd ? {} : { detail: String(e.message || e) }),
    });
  }
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  // POST → envío SOAP al billService de SUNAT (consolidado de sunat-bill)
  if (req.method === 'POST') {
    return handleSendBill(req, res);
  }

  // GET → consulta de info de RUC vía decolecta/apis.net.pe
  try {
    await requireAuth(req);
    rateLimit(req, { windowMs: 60_000, max: 30 });

    const { ruc } = req.query || {};
    const r = String(ruc || '').trim();

    if (!isValidRUC(r)) {
      return res.status(422).json({ error: 'RUC inválido (formato o dígito verificador)' });
    }

    // Cadena de proveedores — cada token va a SU API (un token de apis.net.pe
    // mandado a decolecta da 401 seguro). 401/403/429/5xx → siguiente; 404 corta.
    const providers = [];
    if (process.env.DECOLECTA_TOKEN) {
      providers.push({ id: 'decolecta', url: `https://api.decolecta.com/v1/sunat/ruc/full?numero=${r}`, token: process.env.DECOLECTA_TOKEN });
    }
    if (process.env.APIS_NET_PE_TOKEN) {
      providers.push({ id: 'apis.net.pe/v2', url: `https://api.apis.net.pe/v2/sunat/ruc/full?numero=${r}`, token: process.env.APIS_NET_PE_TOKEN });
    }
    providers.push({ id: 'apis.net.pe/v1', url: `https://api.apis.net.pe/v1/ruc?numero=${r}`, token: null });

    let data = null, last = null, source = null;
    for (const p of providers) {
      let upstream;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10000);
        upstream = await fetch(p.url, {
          signal: ctrl.signal,
          headers: {
            Accept: 'application/json',
            ...(p.token ? { Authorization: `Bearer ${p.token}` } : {}),
          },
        });
        clearTimeout(timer);
      } catch {
        last = { id: p.id, status: 0 };
        continue;
      }
      if (upstream.ok) {
        try { data = await upstream.json(); } catch { last = { id: p.id, status: 200 }; continue; }
        source = p.id;
        break;
      }
      if (upstream.status === 404) {
        return res.status(404).json({ error: 'RUC no encontrado en SUNAT' });
      }
      // No filtrar el valor del token al cliente; al log sí va el proveedor.
      console.warn(`[sunat] ${p.id} respondió ${upstream.status}${p.token ? ' — revisá ese token en Vercel' : ''}`);
      last = { id: p.id, status: upstream.status };
    }
    if (!data) {
      if (last && last.status === 429) {
        return res.status(429).json({ error: 'Demasiadas consultas al servicio de RUC — espera un minuto y reintenta' });
      }
      return res.status(503).json({ error: `Servicio de RUC no disponible (${last ? `${last.id} respondió ${last.status || 'timeout'}` : 'sin proveedores'}) — reintenta o revisa los tokens en Vercel` });
    }

    // ── Normalizar respuesta a un shape único ────────────────
    // decolecta v1/full devuelve snake_case y a veces "-" cuando el campo
    // está vacío en SUNAT (típico en RUC 10 personas naturales).
    // apis.net.pe v1 (legacy) devuelve camelCase.
    const limpiarDash = (v) => {
      if (v == null) return null;
      const s = String(v).trim();
      if (!s || s === '-' || s === '_') return null;
      return s;
    };
    const actividadPrincipal = limpiarDash(data.actividad_economica) || limpiarDash(data.actividadEconomica) || null;
    // Algunos endpoints devuelven actividades secundarias en `actividades_economicas[]`
    // (no es el caso de decolecta plan free, pero dejamos preparado para futuro).
    const actividadesArr = Array.isArray(data.actividades_economicas) && data.actividades_economicas.length
      ? data.actividades_economicas.map(a => typeof a === 'string' ? a : (a.descripcion || a.actividad || '')).filter(Boolean)
      : (actividadPrincipal ? [actividadPrincipal] : []);

    // Dirección: si decolecta devuelve "-" o vacío, intentamos armar
    // una dirección de fallback con vía + número + distrito + provincia.
    const direccionRaw = limpiarDash(data.direccion);
    let direccionFallback = direccionRaw;
    if (!direccionRaw) {
      const partes = [
        limpiarDash(data.via_tipo) && limpiarDash(data.via_nombre) ? `${data.via_tipo} ${data.via_nombre}` : null,
        limpiarDash(data.numero) && `Nro ${data.numero}`,
        limpiarDash(data.manzana) && `Mz ${data.manzana}`,
        limpiarDash(data.lote) && `Lt ${data.lote}`,
        limpiarDash(data.distrito),
        limpiarDash(data.provincia),
        limpiarDash(data.departamento),
      ].filter(Boolean);
      if (partes.length) direccionFallback = partes.join(', ');
    }

    const normalized = {
      numeroDocumento: data.numero_documento || data.numeroDocumento || r,
      razonSocial: data.razon_social || data.razonSocial || data.nombre || '',
      direccion: direccionFallback || '',
      direccionExacta: direccionRaw || null, // null si SUNAT no la tiene literal
      estado: data.estado || '',
      condicion: data.condicion || '',
      tipo: limpiarDash(data.tipo) || '',
      departamento: limpiarDash(data.departamento) || '',
      provincia: limpiarDash(data.provincia) || '',
      distrito: limpiarDash(data.distrito) || '',
      // Actividad económica:
      actividadEconomica: actividadPrincipal,
      actividadesEconomicas: actividadesArr,
      ciiu: data.ciiu || null,
      rubroSugerido: clasificarRubro(actividadPrincipal),
      fechaInscripcion: data.fecha_inscripcion || data.fechaInscripcion || null,
      fechaInicioActividades: data.fecha_inicio_actividades || data.fechaInicioActividades || null,
      sistemaEmision: data.sistema_emision || data.sistemaEmision || null,
      tipoFacturacion: limpiarDash(data.tipo_facturacion) || null,
      tipoContabilidad: limpiarDash(data.tipo_contabilidad) || null,
      esAgenteRetencion: data.es_agente_retencion ?? null,
      esBuenContribuyente: data.es_buen_contribuyente ?? null,
      ubigeo: Array.isArray(data.ubigeo) ? (data.ubigeo[data.ubigeo.length - 1] || null) : limpiarDash(data.ubigeo),
      localesAnexos: Array.isArray(data.locales_anexos) ? data.locales_anexos : null,
      _source: source,
    };

    // Cache de 1 hora — los datos de RUC cambian raramente.
    // Importante: con plan free de 100 cons/mes, esto evita gastar el cuota
    // si consultás varias veces el mismo RUC en una hora.
    // Cache 5 min (no 1h): los datos de RUC pueden cambiar (cambio de
    // condición, domicilio) y un cache muy largo desinforma. SWR de 1h.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
    return res.status(200).json(normalized);
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'SUNAT tardó demasiado' });
    }
    const sanitized = sanitizeError(e, 'No se pudo conectar a SUNAT');
    return res.status(sanitized.status).json(sanitized.body);
  }
}
