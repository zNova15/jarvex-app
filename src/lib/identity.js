// ═══════════════════════════════════════════════════════════════════
// JARVEX — Consulta de identidad peruana (SUNAT + RENIEC)
// Llama a nuestros endpoints serverless de Vercel (/api/sunat,
// /api/reniec) que internamente hacen el fetch a apis.net.pe v1.
// Esto evita el bloqueo de CORS del browser (apis.net.pe no envía
// Access-Control-Allow-Origin).
// ═══════════════════════════════════════════════════════════════════

const API_BASE = '/api'; // mismo origin que la SPA → sin CORS
const REQ_TIMEOUT_MS = 10000;

function timeoutFetch(url, opts = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), REQ_TIMEOUT_MS);
  return fetch(url, { ...opts, signal: controller.signal })
    .finally(() => clearTimeout(id));
}

/**
 * Consulta SUNAT por RUC (11 dígitos).
 * Retorna { razonSocial, direccion, estado, condicion, departamento, provincia, distrito }
 * o lanza Error con mensaje legible.
 */
export async function consultarRUC(ruc) {
  const r = String(ruc || '').trim();
  if (!/^\d{11}$/.test(r)) throw new Error('RUC debe tener 11 dígitos numéricos');
  if (!navigator.onLine) throw new Error('Sin conexión — no se puede consultar SUNAT');

  let res;
  try {
    res = await timeoutFetch(`${API_BASE}/sunat?ruc=${r}`);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('SUNAT tardó demasiado en responder');
    throw new Error('No se pudo conectar a SUNAT');
  }

  if (!res.ok) {
    let body = null;
    try { body = await res.json(); } catch (e) {}
    throw new Error(body?.error || `SUNAT respondió ${res.status}`);
  }

  const data = await res.json();
  // El endpoint /api/sunat ahora normaliza la respuesta de v1/v2.
  return {
    ruc: data.numeroDocumento || r,
    razonSocial: data.razonSocial || data.nombre || '',
    direccion: data.direccion || '',
    estado: data.estado || '',
    condicion: data.condicion || '',
    departamento: data.departamento || '',
    provincia: data.provincia || '',
    distrito: data.distrito || '',
    tipo: data.tipo || '',
    // Campos nuevos (presentes solo si APIS_NET_PE_TOKEN está configurado en Vercel
    // y la respuesta vino de v2/full). Pueden ser null en v1.
    actividadEconomica: data.actividadEconomica || null,
    actividadesEconomicas: Array.isArray(data.actividadesEconomicas) ? data.actividadesEconomicas : [],
    direccionExacta: data.direccionExacta || null,
    ciiu: data.ciiu || null,
    rubroSugerido: data.rubroSugerido || null,
    fechaInscripcion: data.fechaInscripcion || null,
    fechaInicioActividades: data.fechaInicioActividades || null,
    sistemaEmision: data.sistemaEmision || null,
    ubigeo: data.ubigeo || null,
    _source: data._source || null,
  };
}

/**
 * Consulta RENIEC por DNI (8 dígitos).
 * Retorna { nombres, apellidoPaterno, apellidoMaterno, apellidos, nombreCompleto }
 * o lanza Error con mensaje legible.
 */
export async function consultarDNI(dni) {
  const d = String(dni || '').trim();
  if (!/^\d{8}$/.test(d)) throw new Error('DNI debe tener 8 dígitos numéricos');
  if (!navigator.onLine) throw new Error('Sin conexión — no se puede consultar RENIEC');

  let res;
  try {
    res = await timeoutFetch(`${API_BASE}/reniec?dni=${d}`);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('RENIEC tardó demasiado en responder');
    throw new Error('No se pudo conectar a RENIEC');
  }

  if (!res.ok) {
    let body = null;
    try { body = await res.json(); } catch (e) {}
    throw new Error(body?.error || `RENIEC respondió ${res.status}`);
  }

  const data = await res.json();
  return {
    dni: data.numeroDocumento || d,
    nombres: data.nombres || '',
    apellidoPaterno: data.apellidoPaterno || '',
    apellidoMaterno: data.apellidoMaterno || '',
    apellidos: `${data.apellidoPaterno || ''} ${data.apellidoMaterno || ''}`.trim(),
    nombreCompleto: `${data.nombres || ''} ${data.apellidoPaterno || ''} ${data.apellidoMaterno || ''}`.trim(),
  };
}
