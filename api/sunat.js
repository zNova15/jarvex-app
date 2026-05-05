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

import { requireAuth, rateLimit, sanitizeError, isValidRUC, setCorsHeaders } from './_lib.js';

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

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    await requireAuth(req);
    rateLimit(req, { windowMs: 60_000, max: 30 });

    const { ruc } = req.query || {};
    const r = String(ruc || '').trim();

    if (!isValidRUC(r)) {
      return res.status(422).json({ error: 'RUC inválido (formato o dígito verificador)' });
    }

    const token = process.env.DECOLECTA_TOKEN || process.env.APIS_NET_PE_TOKEN;
    const useFull = !!token;
    const url = useFull
      ? `https://api.decolecta.com/v1/sunat/ruc/full?numero=${r}`
      : `https://api.apis.net.pe/v1/ruc?numero=${r}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const upstream = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        ...(useFull ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    clearTimeout(timer);

    if (upstream.status === 401) {
      // No filtrar nombre de la env var al cliente
      console.error('[sunat] upstream 401 — verificá DECOLECTA_TOKEN en Vercel');
      return res.status(503).json({ error: 'SUNAT temporalmente no disponible — avisá al admin' });
    }
    if (upstream.status === 404) {
      return res.status(404).json({ error: 'RUC no encontrado en SUNAT' });
    }
    if (upstream.status === 429) {
      return res.status(429).json({ error: 'Cuota agotada (100/mes en plan free decolecta) — esperá o paga upgrade' });
    }
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `SUNAT respondió ${upstream.status}` });
    }

    const data = await upstream.json();

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
      ubigeo: data.ubigeo || null,
      localesAnexos: Array.isArray(data.locales_anexos) ? data.locales_anexos : null,
      _source: useFull ? 'decolecta/v1/full' : 'apis.net.pe/v1',
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
