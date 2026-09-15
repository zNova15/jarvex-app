// ═══════════════════════════════════════════════════════════════════
// JARVEX — DONDE VIVE UN RECORRIDO CON IA (14-sep-2026).
//
// EL DEFECTO, CONTADO POR GABRIEL. «Suele tardar y me pasó que se cerró
// sesión. Y también que cuando cambié de pestaña pensé que seguiría en
// segundo plano y eso no fue así: si cambio de pestaña la categorización por
// IA no sigue.»
//
// LA CAUSA. El recorrido vivía en el componente: el estado era `useState` y
// el bucle, una promesa atada a ese render. Cambiar de pestaña desmonta el
// árbol, y con él se iba el estado, el `debeCancelar` y las respuestas ya
// pagadas. Y como nadie registraba «hay trabajo largo en curso», el cierre
// por inactividad de useAuth —que solo cuenta eventos de PERSONA— veía a
// alguien mirando una barra durante 20 minutos y cerraba la sesión.
//
// QUÉ HACE ESTO. El recorrido vive ACÁ, en el módulo, no en React:
//
//   1. SIGUE CORRIENDO al cambiar de pestaña o de sección. El componente se
//      SUSCRIBE y dibuja; si se desmonta, el bucle ni se entera. Al volver,
//      la barra sigue donde estaba.
//   2. LA SESIÓN NO SE CIERRA MIENTRAS TANTO: toma un token de
//      `sesion-ocupada.js` (el mismo mecanismo que salvó la lectura de bases
//      con IA), que además pide el wake lock y avisa antes de cerrar la
//      pestaña. Se suelta en un `finally`.
//   3. LAS RECOMENDACIONES SOBREVIVEN A TODO. Van a localStorage apenas
//      llegan, así que un refresco, un cierre de sesión o un cierre de
//      pestaña NO tiran a la basura media hora de respuestas: al volver a
//      entrar están ahí, esperando que alguien las mire.
//   4. DOS RECORRIDOS A LA VEZ, uno por sección (clasificación, correlaciones,
//      mapeo). El ritmo compartido lo pone `turnoIA` — ver barrido-ia.js.
//
// POR QUÉ NO SON DECISIONES. Porque nadie las miró todavía. Una recomendación
// guardada acá es una propuesta que espera un clic; lo que se guarda en la
// base lo sigue escribiendo la pantalla, cuando una persona acepta.
// ═══════════════════════════════════════════════════════════════════
import { ejecutarBarridoIA, turnoIA } from './barrido-ia.js';
import { ocupar } from './sesion-ocupada.js';

const CLAVE_LS = 'jx_ia_recomendaciones_v1';
// 15 días: más que suficiente para terminar una empresa, y poco como para
// que una propuesta vieja no quede colgada sobre un catálogo que cambió.
const TTL = 15 * 24 * 60 * 60 * 1000;
const TOPE = 4000;

const clave = (seccion, ambito, id) => `${seccion}::${ambito || '-'}::${id}`;

// ── El guardado ───────────────────────────────────────────────────
let mapa = null;   // { clave: { ...datos, t } } — cargado perezosamente

function cargar() {
  if (mapa) return mapa;
  mapa = {};
  try {
    const crudo = JSON.parse(localStorage.getItem(CLAVE_LS) || '{}');
    const corte = Date.now() - TTL;
    for (const [k, v] of Object.entries(crudo)) {
      if (v && (v.t || 0) > corte) mapa[k] = v;
    }
  } catch { mapa = {}; }
  return mapa;
}

function escribirAhora() {
  try {
    const m = cargar();
    const keys = Object.keys(m);
    if (keys.length > TOPE) {
      keys.sort((a, b) => (m[a].t || 0) - (m[b].t || 0));
      for (const k of keys.slice(0, keys.length - TOPE)) delete m[k];
    }
    localStorage.setItem(CLAVE_LS, JSON.stringify(m));
  } catch { /* sin localStorage el recorrido sigue, solo que no sobrevive al refresco */ }
}

// 🔴 EL DISCO NO SE TOCA EN CADA ÍTEM. `localStorage.setItem` es SÍNCRONO y
// serializa el mapa entero: con 2.000 propuestas son ~400 KB por ítem, y un
// recorrido de 1.885 descripciones los escribiría 1.885 veces, trabando el
// hilo principal justo mientras alguien intenta ir aceptando las que ya
// llegaron. La memoria se actualiza de inmediato (la pantalla ve todo al
// instante); el disco se pone al día a lo sumo cada `ESPERA_DISCO_MS`, y se
// fuerza al terminar el recorrido y en cada olvido/limpieza, que son las
// operaciones sueltas donde perder el último cambio sí se notaría.
const ESPERA_DISCO_MS = 1500;
let timerDisco = null;
let pendienteDisco = false;

function bajarADisco({ yaMismo = false } = {}) {
  if (yaMismo) {
    if (timerDisco) { clearTimeout(timerDisco); timerDisco = null; }
    pendienteDisco = false;
    escribirAhora();
    return;
  }
  if (timerDisco) { pendienteDisco = true; return; }   // ya hay una bajada en camino
  escribirAhora();                                      // la primera del tramo baja de una
  timerDisco = setTimeout(() => {
    timerDisco = null;
    if (pendienteDisco) { pendienteDisco = false; bajarADisco(); }
  }, ESPERA_DISCO_MS);
}

// ── Los avisos ────────────────────────────────────────────────────
const oyentes = new Map();   // seccion → Set<cb>

/** Devuelve la función que corta la suscripción (para el `useEffect`). */
export function suscribir(seccion, cb) {
  if (!oyentes.has(seccion)) oyentes.set(seccion, new Set());
  oyentes.get(seccion).add(cb);
  return () => { oyentes.get(seccion)?.delete(cb); };
}

function avisar(seccion) {
  for (const cb of oyentes.get(seccion) || []) {
    try { cb(); } catch { /* un oyente roto no puede frenar el recorrido */ }
  }
}

// ── Las recomendaciones ───────────────────────────────────────────

/**
 * Guarda UNA propuesta de la IA. `id` es la clave de la fila dentro de su
 * sección (la norm de la descripción, el par, el grupo…), `ambito` lo que
 * hace que la misma fila sea otra pregunta (la entidad, la obra, la pestaña).
 */
export function guardarRecomendacion(seccion, ambito, id, datos) {
  const m = cargar();
  m[clave(seccion, ambito, id)] = { ...datos, t: Date.now() };
  bajarADisco();
  avisar(seccion);
}

/** Todas las de una sección+ámbito, como objeto plano `{ id: datos }`. */
export function leerRecomendaciones(seccion, ambito) {
  const m = cargar();
  const pre = `${seccion}::${ambito || '-'}::`;
  const out = {};
  for (const [k, v] of Object.entries(m)) {
    if (k.startsWith(pre)) out[k.slice(pre.length)] = v;
  }
  return out;
}

/** Se olvida UNA — al aceptarla o al descartarla: ya cumplió su función. */
export function olvidarRecomendacion(seccion, ambito, id) {
  const m = cargar();
  const k = clave(seccion, ambito, id);
  if (!(k in m)) return;
  delete m[k];
  bajarADisco({ yaMismo: true });   // olvido suelto: que no lo resucite un refresco
  avisar(seccion);
}

/** Se olvidan todas las de una sección+ámbito («descartar las propuestas»). */
export function limpiarRecomendaciones(seccion, ambito) {
  const m = cargar();
  const pre = `${seccion}::${ambito || '-'}::`;
  let n = 0;
  for (const k of Object.keys(m)) if (k.startsWith(pre)) { delete m[k]; n++; }
  if (n) { bajarADisco({ yaMismo: true }); avisar(seccion); }
  return n;
}

// ── El recorrido ──────────────────────────────────────────────────
// 🔴 LA CLAVE ES SECCIÓN + ÁMBITO, NO SOLO LA SECCIÓN. Las tres pantallas
// cambian de ámbito sin cambiar de sección: el selector de Trabajo en mapeo,
// el de entidad en clasificación, las sub-pestañas Insumos/Servicios en
// correlaciones. Con la clave por sección sola, el recorrido de la obra
// «Puente Nuevo» aparecía dibujado sobre la obra «Colegio X» —«Recorriendo…
// 132 de 400», números de otra obra— y encima tapaba el botón para lanzar el
// propio. Cada ámbito tiene el suyo; el ritmo lo siguen compartiendo todos
// por `turnoIA`, así que dos a la vez no saturan nada.
const enCurso = new Map();   // `${seccion}::${ambito}` → { estado, cancelar, promesa }

const claveCorrida = (seccion, ambito) => `${seccion}::${ambito || '-'}`;

/** El estado visible de ESTE ámbito, o null si nunca corrió (o ya se cerró). */
export function estadoBarrido(seccion, ambito = null) {
  return enCurso.get(claveCorrida(seccion, ambito))?.estado || null;
}

/** ¿Está corriendo AHORA? Lo usa el guard anti-doble-arranque. */
export function barridoActivo(seccion, ambito = null) {
  return !!enCurso.get(claveCorrida(seccion, ambito))?.estado?.activo;
}

/** Pide que pare. El ítem en vuelo termina; lo hecho hasta acá queda. */
export function cancelarBarrido(seccion, ambito = null) {
  const r = enCurso.get(claveCorrida(seccion, ambito));
  if (r) r.cancelar = true;
}

/** Saca el cartel de «terminado» de la pantalla. No borra recomendaciones. */
export function cerrarBarrido(seccion, ambito = null) {
  const k = claveCorrida(seccion, ambito);
  const r = enCurso.get(k);
  if (r && r.estado?.activo) return;      // no se cierra algo que sigue corriendo
  enCurso.delete(k);
  avisar(seccion);
}

/**
 * Arranca el recorrido de una sección+ámbito. Si ya hay uno corriendo AHÍ, no
 * hace nada (dos recorridos sobre la misma lista se pisarían); en otra sección
 * —o en la misma con otro ámbito— sí puede haber otro a la vez, y el ritmo lo
 * comparten todos por `turnoIA`.
 *
 * `procesarItem` devuelve 'recomendada' | 'aplicada' | 'saltada'; en el modo
 * por defecto ('recomendar') NO debe escribir en la base: guarda con
 * `guardarRecomendacion` y listo.
 */
export function arrancarBarrido({ seccion, ambito = null, etiqueta = '', items = [], procesarItem, modo = 'recomendar', necesitaTurno = null }) {
  const kCorrida = claveCorrida(seccion, ambito);
  if (barridoActivo(seccion, ambito)) return enCurso.get(kCorrida).promesa;

  const reg = {
    cancelar: false,
    estado: {
      activo: true, modo, etiqueta, ambito,
      total: items.length, i: 0,
      recomendadas: 0, aplicadas: 0, saltadas: 0, errores: 0, sinIA: 0,
      cancelado: false, cortado: false, ultimoError: null,
      desde: Date.now(),
    },
    promesa: null,
  };
  enCurso.set(kCorrida, reg);
  avisar(seccion);

  // El token de «trabajo largo»: mientras esté tomado, el cierre por
  // inactividad se posterga, la pantalla no se duerme y cerrar la pestaña
  // pregunta antes. Se suelta SIEMPRE en el finally.
  const liberar = ocupar(`Recorrido con IA — ${etiqueta || seccion}`);

  reg.promesa = (async () => {
    try {
      const final = await ejecutarBarridoIA({
        items,
        procesarItem,
        esperarTurno: turnoIA,
        // El pre-filtro local (tanda 4): los ítems que ya se resolvieron sin
        // salir a la red no piden turno ni pausa. Ver bandas-correlacion.js.
        necesitaTurno,
        debeCancelar: () => reg.cancelar,
        onProgreso: (p) => {
          reg.estado = { ...reg.estado, ...p, activo: true };
          avisar(seccion);
        },
      });
      reg.estado = { ...reg.estado, ...final, activo: false };
      return final;
    } catch (e) {
      // Nada debería llegar acá (ejecutarBarridoIA atrapa por ítem), pero si
      // llega, el cartel tiene que decirlo en vez de quedarse girando.
      reg.estado = { ...reg.estado, activo: false, cortado: true, ultimoError: e?.message || String(e) };
      throw e;
    } finally {
      liberar();
      // Se terminó: el disco se pone al día sí o sí, sin esperar el throttle.
      bajarADisco({ yaMismo: true });
      avisar(seccion);
    }
  })();

  return reg.promesa;
}

/** Solo para los tests. */
export function _reiniciar() {
  enCurso.clear();
  oyentes.clear();
  if (timerDisco) { clearTimeout(timerDisco); timerDisco = null; }
  pendienteDisco = false;
  mapa = {};
  try { localStorage.removeItem(CLAVE_LS); } catch { /* sin localStorage no hay nada que limpiar */ }
}
