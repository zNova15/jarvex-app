// ═══════════════════════════════════════════════════════════════════
// JARVEX — LA SESIÓN NO SE CIERRA MIENTRAS LA APP ESTÁ TRABAJANDO
// (tanda 19, 9-set-2026).
//
// EL DEFECTO, CONTADO POR GABRIEL. «Intenté probar de nuevo la revisión con
// IA de las bases, pero tarda tanto que mi sesión se cierra y se pierde el
// avance.»
//
// LA CAUSA, MEDIDA EN EL CÓDIGO. El cierre por inactividad de useAuth.js
// reinicia su reloj SOLO con eventos de persona: mousedown, keydown, scroll,
// touchstart, click. Leer unas bases de 94 páginas escaneadas son ~16 tandas
// de OCR más ~40 pasadas de extracción, todas EN SERIE, y la persona lo único
// que hace es mirar la barra. Para el contador de inactividad, alguien que
// espera 35 minutos frente a una barra de progreso es alguien que se fue.
// A los 30 minutos (el default de `sesion_timeout_min`) cerraba la sesión, el
// árbol de React se desmontaba con el modal adentro, y con él se iba el OCR
// que YA SE HABÍA PAGADO.
//
// Y ESE NO ERA EL ÚNICO MODO DE PERDERLO. Con la laptop suspendiéndose sola a
// los 10 minutos de no tocar nada, las peticiones en vuelo se cortan igual
// aunque la sesión siga viva. Y un Cmd+W distraído sobre una ventana que no
// avisa nada se lleva media hora de espera.
//
// QUÉ HACE ESTO. Un registro chiquito de «hay trabajo largo en curso», con
// tres consecuencias mientras haya al menos uno:
//
//   1. EL CIERRE POR INACTIVIDAD SE POSTERGA (no se desactiva). useAuth
//      pregunta acá antes de cerrar; si hay trabajo, vuelve a preguntar en un
//      minuto. Cuando el trabajo termina, el reloj arranca de nuevo COMPLETO
//      desde ese momento: la sesión sigue cerrándose sola si de verdad nadie
//      la usa, que es para lo que existe la regla.
//   2. LA PANTALLA NO SE DUERME (Screen Wake Lock, donde el navegador lo
//      tenga). El permiso se pierde solo cuando la pestaña deja de estar
//      visible, así que se vuelve a pedir al volver.
//   3. CERRAR LA PESTAÑA PREGUNTA ANTES. El navegador muestra su propio
//      cartel; no se puede elegir el texto, pero sí que aparezca.
//
// POR QUÉ UN REGISTRO Y NO UN FLAG EN EL MODAL. Porque esto no es de
// licitaciones: cualquier trabajo largo lo va a necesitar (leer un CV, un
// paquete SCTR, una importación grande). El que lo usa solo tiene que
// acordarse de soltar el token en un `finally`.
//
// SEGURIDAD: esto NO desactiva el cierre por inactividad, lo posterga
// mientras haya trabajo real registrado. Un token que nadie suelta dejaría la
// sesión abierta para siempre, así que cada uno tiene VENCIMIENTO propio
// (`MAX_MS`, 2 horas): pasado eso deja de contar aunque nadie lo haya
// soltado. Una lectura de bases que tarde más de dos horas está colgada, no
// trabajando.
// ═══════════════════════════════════════════════════════════════════

/** Cuánto vale como mucho un token sin soltar. Red de seguridad para que un
 *  `finally` que no corrió no deje la sesión abierta para siempre. */
export const MAX_MS = 2 * 60 * 60 * 1000;

/** token → { motivo, desde }. Es un contador con nombre, no un booleano:
 *  dos trabajos a la vez tienen que soltar los dos para que se libere. */
const trabajos = new Map();
let seq = 0;

// El permiso de «no apagues la pantalla». Se guarda para poder soltarlo y
// para no pedir dos.
let wakeLock = null;
let escuchandoVisibilidad = false;

const hayVentana = () => typeof window !== 'undefined';

/** Los que todavía valen: los vencidos se caen solos al pasar por acá. */
function vivos() {
  const ahora = Date.now();
  for (const [token, t] of trabajos) {
    if (ahora - t.desde > MAX_MS) trabajos.delete(token);
  }
  return trabajos;
}

// ── El wake lock ──────────────────────────────────────────────────
// `request('screen')` LANZA si la pestaña no está visible, y el permiso se
// suelta solo cuando el usuario cambia de pestaña. Las dos cosas se resuelven
// con el mismo listener: volver a pedirlo cuando la pestaña vuelve.
async function pedirWakeLock() {
  if (!hayVentana() || wakeLock) return;
  try {
    if (!navigator?.wakeLock?.request) return;
    if (document.visibilityState !== 'visible') return;
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener?.('release', () => { wakeLock = null; });
  } catch { wakeLock = null; }     // sin permiso se sigue igual, solo que la pantalla se puede dormir
}

function soltarWakeLock() {
  try { wakeLock?.release?.(); } catch { /* ya estaba suelto */ }
  wakeLock = null;
}

function alVolverLaPestana() {
  if (document.visibilityState === 'visible' && vivos().size > 0) pedirWakeLock();
}

/** El cartel del navegador al cerrar la pestaña. El texto lo elige él. */
function alCerrar(e) {
  if (vivos().size === 0) return;
  e.preventDefault();
  e.returnValue = '';
  return '';
}

function encender() {
  if (!hayVentana()) return;
  window.addEventListener('beforeunload', alCerrar);
  if (!escuchandoVisibilidad) {
    document.addEventListener('visibilitychange', alVolverLaPestana);
    escuchandoVisibilidad = true;
  }
  pedirWakeLock();
}

function apagar() {
  if (!hayVentana()) return;
  window.removeEventListener('beforeunload', alCerrar);
  soltarWakeLock();
}

function avisar() {
  if (!hayVentana()) return;
  try {
    window.dispatchEvent(new CustomEvent('jx_ocupado_cambio', {
      detail: { ocupado: vivos().size > 0, motivos: trabajosEnCurso().map(t => t.motivo) },
    }));
  } catch { /* navegador viejo sin CustomEvent: el aviso es opcional */ }
}

/**
 * Marca que empezó un trabajo largo. Devuelve la función que lo suelta.
 *
 * SIEMPRE en un `finally`:
 *
 *   const liberar = ocupar('Análisis de bases con IA');
 *   try { await correr(); } finally { liberar(); }
 *
 * Soltar dos veces no hace nada (la segunda no encuentra el token).
 */
export function ocupar(motivo = 'trabajo en curso') {
  const token = `t${++seq}`;
  const primero = vivos().size === 0;
  trabajos.set(token, { motivo: String(motivo), desde: Date.now() });
  if (primero) encender();
  avisar();
  let soltado = false;
  return function liberar() {
    if (soltado) return;
    soltado = true;
    trabajos.delete(token);
    if (vivos().size === 0) apagar();
    avisar();
  };
}

/** ¿Hay algo largo corriendo ahora mismo? Lo pregunta el cierre por
 *  inactividad antes de cerrar la sesión. */
export function hayTrabajoEnCurso() {
  return vivos().size > 0;
}

/** Qué se está haciendo y desde cuándo. Para poder decirlo en un log o en
 *  pantalla, en vez de un «esperá» sin explicación. */
export function trabajosEnCurso() {
  return [...vivos().values()].map(t => ({ motivo: t.motivo, desde: t.desde }));
}

/** Solo para los tests: deja el registro como recién arrancado. */
export function _reiniciar() {
  trabajos.clear();
  apagar();
}

export default { ocupar, hayTrabajoEnCurso, trabajosEnCurso, MAX_MS };
