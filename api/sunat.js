// Vercel serverless function: /api/sunat?ruc=20100070970
//
// Proxy a decolecta.com (sucesor de apis.net.pe) para evitar CORS.
//
// Estrategia:
//   1. Si hay DECOLECTA_TOKEN (o APIS_NET_PE_TOKEN como alias legacy) →
//      decolecta v1/sunat/ruc/full → devuelve actividad económica,
//      dirección detallada, locales anexos, etc. Plan free 100 cons/mes.
//   2. Si no → fallback a apis.net.pe v1/ruc legacy (gratis sin token,
//      solo razón social + dirección).

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
  const { ruc } = req.query || {};
  const r = String(ruc || '').trim();

  if (!/^\d{11}$/.test(r)) {
    return res.status(422).json({ error: 'RUC debe tener 11 dígitos numéricos' });
  }

  const token = process.env.DECOLECTA_TOKEN || process.env.APIS_NET_PE_TOKEN;
  const useFull = !!token;
  const url = useFull
    ? `https://api.decolecta.com/v1/sunat/ruc/full?numero=${r}`
    : `https://api.apis.net.pe/v1/ruc?numero=${r}`;

  try {
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
      return res.status(503).json({ error: 'SUNAT: token inválido — verifica DECOLECTA_TOKEN en Vercel env' });
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
    // decolecta v1/full devuelve snake_case: razon_social, numero_documento,
    //   direccion, estado, condicion, ubigeo, distrito, provincia, departamento,
    //   tipo, actividad_economica, numero_trabajadores, tipo_facturacion,
    //   tipo_contabilidad, comercio_exterior, locales_anexos[], es_agente_retencion,
    //   es_buen_contribuyente.
    // apis.net.pe v1 (legacy) devuelve camelCase: numeroDocumento, razonSocial.
    const actividad = data.actividad_economica || data.actividadEconomica || null;

    const normalized = {
      // Campos que ya devolvía el endpoint antes (compat con el frontend):
      numeroDocumento: data.numero_documento || data.numeroDocumento || r,
      razonSocial: data.razon_social || data.razonSocial || data.nombre || '',
      direccion: data.direccion || '',
      estado: data.estado || '',
      condicion: data.condicion || '',
      tipo: data.tipo || '',
      departamento: data.departamento || '',
      provincia: data.provincia || '',
      distrito: data.distrito || '',
      // Campos nuevos (presentes solo con token):
      actividadEconomica: actividad,
      ciiu: data.ciiu || null,
      rubroSugerido: clasificarRubro(actividad),
      fechaInscripcion: data.fecha_inscripcion || data.fechaInscripcion || null,
      fechaInicioActividades: data.fecha_inicio_actividades || data.fechaInicioActividades || null,
      sistemaEmision: data.sistema_emision || data.sistemaEmision || null,
      tipoFacturacion: data.tipo_facturacion || null,
      tipoContabilidad: data.tipo_contabilidad || null,
      esAgenteRetencion: data.es_agente_retencion ?? null,
      esBuenContribuyente: data.es_buen_contribuyente ?? null,
      ubigeo: data.ubigeo || null,
      localesAnexos: Array.isArray(data.locales_anexos) ? data.locales_anexos : null,
      _source: useFull ? 'decolecta/v1/full' : 'apis.net.pe/v1',
    };

    // Cache de 1 hora — los datos de RUC cambian raramente.
    // Importante: con plan free de 100 cons/mes, esto evita gastar el cuota
    // si consultás varias veces el mismo RUC en una hora.
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json(normalized);
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'SUNAT tardó demasiado' });
    }
    return res.status(502).json({ error: 'No se pudo conectar a SUNAT', detail: e.message });
  }
}
