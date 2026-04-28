// ═══════════════════════════════════════════════════════════════════
// JARVEX — Consulta de identidad peruana (SUNAT + RENIEC)
// API pública apis.net.pe v1 (sin token, rate-limited).
// La v2 cambió de política y ahora exige token de Decolecta — la v1
// sigue siendo gratuita y abierta. Si en el futuro la v1 también se
// cierra: swap a apisperu.com (con JWT) o decolecta con APIKEY.
// ═══════════════════════════════════════════════════════════════════

const API_BASE = 'https://api.apis.net.pe/v1';
const REQ_TIMEOUT_MS = 8000;

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
    res = await timeoutFetch(`${API_BASE}/ruc?numero=${r}`);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('SUNAT tardó demasiado en responder');
    throw new Error('No se pudo conectar a SUNAT');
  }

  if (res.status === 404) throw new Error('RUC no encontrado en SUNAT');
  if (res.status === 422) throw new Error('RUC inválido según SUNAT');
  if (res.status === 429) throw new Error('Demasiadas consultas a SUNAT — espera un momento');
  if (res.status === 401) throw new Error('La API ahora requiere token. Avisa al admin.');
  if (!res.ok) throw new Error(`SUNAT respondió ${res.status}`);

  const data = await res.json();
  // apis.net.pe v1 devuelve `nombre` como razón social. Mantenemos compat
  // con `razonSocial` por si en el futuro vuelve a estar.
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
    res = await timeoutFetch(`${API_BASE}/dni?numero=${d}`);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('RENIEC tardó demasiado en responder');
    throw new Error('No se pudo conectar a RENIEC');
  }

  if (res.status === 404) throw new Error('DNI no encontrado en RENIEC');
  if (res.status === 422) throw new Error('DNI inválido según RENIEC');
  if (res.status === 429) throw new Error('Demasiadas consultas a RENIEC — espera un momento');
  if (res.status === 401) throw new Error('La API ahora requiere token. Avisa al admin.');
  if (!res.ok) throw new Error(`RENIEC respondió ${res.status}`);

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
