// ── SERVICIO RESTRINGIDO (HTTP 402) ────────────────────────────────────────
//
// El 9-set-2026 Supabase cortó el proyecto por cuota de egress agotada y
// respondió 402 a TODA la API. La app no supo leer esa situación y se portó de
// la peor manera posible:
//
//   1. `getCurrentUser()` traía la sesión guardada, pedía `profiles`, recibía
//      402 y devolvía `profile: undefined` → el usuario quedaba "adentro" pero
//      sin rol, o sea sin menú.
//   2. A los 30 minutos de inactividad el timer llamaba a `logout()`, que hace
//      `fullLocalCleanup()` y BORRA la sesión cacheada de IndexedDB.
//   3. Al querer volver a entrar, el login pegaba contra el mismo 402.
//      Resultado: afuera hasta que se reinicie el ciclo de facturación.
//
// Cada equipo que se quedaba media hora quieto quemaba su propio salvavidas
// offline, teniendo TODOS los datos en IndexedDB al lado.
//
// La distinción que hay que hacer, y que el código no hacía, es que
// `navigator.onLine` es TRUE durante un 402: hay internet perfecto, el que dice
// que no al servidor. Para la app tiene que valer lo mismo que estar sin señal.
//
// Este módulo es el detector, deliberadamente chiquito y sin dependencias, para
// que lo puedan usar tanto el cliente de auth como el SyncEngine.

const EVENTO = 'jx_servicio_restringido';

let _restringido = false;
let _desde = null;
let _motivo = null;

// El 402 llega de formas distintas según por dónde entre: PostgrestError con
// `code`, AuthApiError con `status`, o un Error pelado cuyo mensaje trae el
// texto del gateway. Se revisan todas: equivocarse hacia "sí está restringido"
// es barato (la app pasa a offline), equivocarse hacia "no" deja al usuario
// afuera, que es el daño que estamos arreglando.
export function esErrorDeServicioRestringido(err) {
  if (!err) return false;
  const status = err.status ?? err.statusCode ?? err.originalError?.status;
  if (status === 402 || String(err.code) === '402') return true;
  const texto = `${err.message ?? ''} ${err.details ?? ''} ${err.hint ?? ''}`.toLowerCase();
  return texto.includes('exceed_egress_quota')
      || texto.includes('exceed_db_size_quota')
      || texto.includes('service for this project is restricted')
      || texto.includes('restricted due to the following violations');
}

export function marcarServicioRestringido(motivo = null) {
  const cambio = !_restringido;
  _restringido = true;
  if (!_desde) _desde = new Date().toISOString();
  if (motivo) _motivo = motivo;
  if (cambio) {
    console.warn('[servicio] Supabase respondió 402: el proyecto está restringido. La app pasa a modo offline y NO cierra sesión por inactividad.');
    avisar();
  }
  return true;
}

export function limpiarServicioRestringido() {
  if (!_restringido) return false;
  _restringido = false;
  _desde = null;
  _motivo = null;
  console.info('[servicio] El servicio volvió a responder normal.');
  avisar();
  return true;
}

// Un solo lugar donde preguntar. `motivo` sirve para el cartel de la UI.
export function servicioRestringido() {
  return { restringido: _restringido, desde: _desde, motivo: _motivo };
}

export function hayServicioRestringido() {
  return _restringido;
}

// Para la app vale lo mismo no tener señal que tener un servidor que dice 402.
export function estamosSinServidor() {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  } catch {}
  return _restringido;
}

// Atajo: mira el error, marca el estado si corresponde y contesta si lo era.
export function registrarSiEsRestriccion(err) {
  if (!esErrorDeServicioRestringido(err)) return false;
  marcarServicioRestringido(err?.message ?? null);
  return true;
}

function avisar() {
  try {
    window.dispatchEvent(new CustomEvent(EVENTO, { detail: servicioRestringido() }));
  } catch {}
}

export function alCambiarServicio(cb) {
  const h = (e) => cb(e.detail ?? servicioRestringido());
  try {
    window.addEventListener(EVENTO, h);
    return () => window.removeEventListener(EVENTO, h);
  } catch {
    return () => {};
  }
}

export const EVENTO_SERVICIO = EVENTO;
