// Vercel serverless function: /api/sunat?ruc=20100070970
//
// Proxy a apis.net.pe para evitar CORS. apis.net.pe NO devuelve los
// headers Access-Control-Allow-Origin, así que el navegador bloquea el
// fetch directo. Como esta función corre en el mismo dominio (mismo
// origin que la SPA), el browser no aplica CORS.
//
// Estrategia:
//   1. Si hay APIS_NET_PE_TOKEN en env → usar v2/sunat/ruc/full (con rubro,
//      CIIU, fechas, sistema de emisión, comprobantes, etc.). Plan free
//      apis.net.pe da 100 consultas/mes.
//   2. Si no → fallback a v1/ruc (gratis, solo razón social + dirección).

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

  const token = process.env.APIS_NET_PE_TOKEN;
  const useV2 = !!token;
  const url = useV2
    ? `https://api.apis.net.pe/v2/sunat/ruc/full?numero=${r}`
    : `https://api.apis.net.pe/v1/ruc?numero=${r}`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const upstream = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        ...(useV2 ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    clearTimeout(timer);

    if (upstream.status === 401) {
      return res.status(503).json({ error: 'SUNAT requiere token — verifica APIS_NET_PE_TOKEN en Vercel env' });
    }
    if (upstream.status === 404) {
      return res.status(404).json({ error: 'RUC no encontrado en SUNAT' });
    }
    if (upstream.status === 429) {
      return res.status(429).json({ error: 'Cuota apis.net.pe agotada (100/mes en plan free) — esperá o paga upgrade' });
    }
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `SUNAT respondió ${upstream.status}` });
    }

    const data = await upstream.json();

    // ── Normalizar respuesta a un shape único, con o sin v2 ────
    // v1 devuelve: { numeroDocumento, razonSocial, direccion, estado, condicion,
    //                tipo, departamento, provincia, distrito }
    // v2 devuelve además: { actividadEconomica, ciiu, comprobantes, sistemaEmision,
    //                       fechaInscripcion, fechaInicioActividades, etc. }
    //   Los nombres exactos pueden variar entre versiones de la API; tomamos
    //   el primero no-vacío para ser tolerantes.
    const actividad = data.actividadEconomica
      || data.actividad_economica
      || data.actividad
      || (Array.isArray(data.actividadesEconomicas) ? data.actividadesEconomicas[0]?.actividad : null)
      || (Array.isArray(data.actividadesEconomicas) ? data.actividadesEconomicas[0]?.descripcion : null)
      || null;
    const ciiu = data.ciiu
      || (Array.isArray(data.actividadesEconomicas) ? data.actividadesEconomicas[0]?.ciiu : null)
      || null;

    const normalized = {
      // Campos que ya devolvía v1 (compat con el frontend actual):
      numeroDocumento: data.numeroDocumento || r,
      razonSocial: data.razonSocial || data.nombre || '',
      direccion: data.direccion || '',
      estado: data.estado || '',
      condicion: data.condicion || '',
      tipo: data.tipo || '',
      departamento: data.departamento || '',
      provincia: data.provincia || '',
      distrito: data.distrito || '',
      // Campos nuevos de v2 (null si solo v1):
      actividadEconomica: actividad,
      ciiu,
      rubroSugerido: clasificarRubro(actividad),
      fechaInscripcion: data.fechaInscripcion || null,
      fechaInicioActividades: data.fechaInicioActividades || data.fechaInicio || null,
      sistemaEmision: data.sistemaEmision || null,
      comprobantes: data.comprobantes || null,
      ubigeo: data.ubigeo || null,
      _source: useV2 ? 'apis.net.pe/v2/full' : 'apis.net.pe/v1',
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
