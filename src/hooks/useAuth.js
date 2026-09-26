import { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import {
  getCurrentUser, login as authLogin, logout as authLogout, marcarMotivoSalida, MOTIVOS_SALIDA,
} from '../lib/auth';
import { supabase } from '../lib/supabase';
import { db } from '../db/jarvex.db';
import { syncAll, subirAntesDeSalir } from '../sync/SyncEngine';
import { identifyUser, resetUser } from '../lib/posthog.js';
import { hayTrabajoEnCurso, trabajosEnCurso } from '../lib/sesion-ocupada.js';
import { hayServicioRestringido } from '../lib/servicio-restringido.js';
import { fijarCerradoHasta, CLAVE_CONFIG as CLAVE_CIERRE } from '../lib/periodo-contable.js';

export const AuthContext = createContext(null);

// Lista canónica de roles válidos. Cualquier profile cuyo `rol` no esté acá
// se trata como inválido (NO se asume admin para evitar escalación).
const ROLES_VALIDOS = new Set([
  'admin','gerente','ingeniero_residente','ingeniero','supervisor','almacenero',
  'asistente_admin','contador','ayudante_contador','tesorero','jefe_compras','rrhh',
  'prevencionista','maestro_obra','solo_lectura',
  // Especialistas (Fase 1 gestiones de obra) — sin estos, un usuario real con
  // el rol era expulsado al hidratar sesión y su login rechazado.
  'ing_ambiental','ing_calidad','ing_social',
  // Portal de captura de campo (mejora 2, mig 155) — cuenta compartida con PIN.
  'campo',
]);

function rolEsValido(rol) {
  return typeof rol === 'string' && ROLES_VALIDOS.has(rol);
}

// Tiempo de inactividad antes de cerrar sesión. Default 30 min; el admin lo
// puede cambiar desde Administración (app_config clave 'sesion_timeout_min',
// mig 159). El valor sincronizado se cachea en localStorage para que el timer
// lo lea síncrono en cada reinicio (cualquier interacción reinicia el contador,
// así que un cambio de config rige desde la siguiente interacción).
const INACTIVITY_DEFAULT_MIN = 30;
export const INACTIVITY_MIN_MIN = 5;    // piso: evita el lockout de un typo (ej. 0)
export const INACTIVITY_MAX_MIN = 480;  // techo: 8 h (una jornada)
const INACTIVITY_LS_KEY = 'jx_sesion_timeout_min';
// Cada cuánto se vuelve a preguntar si el trabajo largo ya terminó.
const ESPERA_TRABAJO_MS = 60 * 1000;
export function clampTimeoutMin(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return INACTIVITY_DEFAULT_MIN;
  return Math.min(INACTIVITY_MAX_MIN, Math.max(INACTIVITY_MIN_MIN, n));
}
export function getInactivityMin() {
  try {
    const raw = localStorage.getItem(INACTIVITY_LS_KEY);
    if (raw !== null && raw !== '') return clampTimeoutMin(raw);
  } catch {}
  return INACTIVITY_DEFAULT_MIN;
}

export function useAuth() {
  return useContext(AuthContext);
}

// Espejo del rol/id del profile en `window` para que módulos NO-React
// (SyncEngine corre en setInterval, fuera del árbol) puedan leerlo
// sin invocar useAuth() — invocar un hook fuera de un componente
// dispara "Invalid hook call" (ver Sentry JARVEX-APP-D).
// Se actualiza desde el effect del Provider abajo.
function publicarSesion(profile) {
  try {
    if (profile) {
      window.__currentRol     = profile.rol || null;
      window.__currentUserId  = profile.id || null;
    } else {
      window.__currentRol     = null;
      window.__currentUserId  = null;
    }
  } catch {}
}

// Texto del aviso antes de cerrar sesión con trabajo sin subir.
export function mensajePendientesAlSalir({ registros = 0, evidencias = 0 } = {}) {
  const partes = [];
  if (registros > 0) partes.push(`${registros} ${registros === 1 ? 'registro' : 'registros'}`);
  if (evidencias > 0) partes.push(`${evidencias} ${evidencias === 1 ? 'foto o documento' : 'fotos o documentos'}`);
  if (!partes.length) return null;
  return `Quedan ${partes.join(' y ')} sin subir al servidor (sin conexión o el servidor no respondió).\n\n` +
    'No se pierden: quedan guardados en este equipo y se suben apenas alguien vuelva a entrar en él con conexión.\n\n' +
    '¿Cerrar sesión igual?';
}

export function useAuthProvider() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  // Tick interno para re-render cuando cambia el role override o el modo
  const [overrideTick, setOverrideTick] = useState(0);
  // Espejos síncronos para los listeners de abajo (se registran una vez).
  const profileRef = useRef(null);
  const offlineRef = useRef(false);
  const saliendoRef = useRef(false);
  useEffect(() => { profileRef.current = profile; }, [profile]);
  useEffect(() => { offlineRef.current = offline; }, [offline]);
  useEffect(() => {
    const onChange = () => setOverrideTick(t => t + 1);
    window.addEventListener('app_mode_change', onChange);
    window.addEventListener('jx_role_override_change', onChange);
    return () => {
      window.removeEventListener('app_mode_change', onChange);
      window.removeEventListener('jx_role_override_change', onChange);
    };
  }, []);

  useEffect(() => {
    getCurrentUser().then(result => {
      if (result) {
        // Hardening: validar que el rol del profile esté en la lista canónica.
        // Si no, NO seteamos el profile y forzamos logout para evitar que un
        // profile corrupto (rol vacío, rol inválido, etc.) sea tratado como
        // "sin restricciones" o como admin.
        if (result.profile && !rolEsValido(result.profile.rol)) {
          console.warn('[useAuth] Profile con rol inválido o vacío — forzando logout. Rol recibido:', result.profile.rol);
          authLogout().finally(() => {
            setUser(null); setProfile(null); setOffline(false);
            try { localStorage.removeItem('jx_user_role'); localStorage.removeItem('jx_user_role_real'); } catch {}
          });
        } else {
          setUser(result.session?.user ?? null);
          setProfile(result.profile);
          setOffline(result.offline);
          // PostHog: identificar al user al hidratar sesión existente
          // (refresh del browser con cookie/localStorage). Sin esto, el
          // primer pageview queda como "anónimo" hasta que login again.
          try { identifyUser(result.profile); } catch {}
          if (!result.offline) {
            setTimeout(syncAll, 2000);
          }
        }
      }
      setLoading(false);
    });
  }, []);

  // Sincroniza el rol con localStorage para que useAppMode pueda restringir
  // los modos prueba/edicion solo a admin de forma síncrona.
  // También guarda el rol REAL para poder volver del role override.
  useEffect(() => {
    // Espejo en window.__currentRol/window.__currentUserId para que el
    // SyncEngine y otros módulos NO-React puedan leerlos sin hooks.
    publicarSesion(profile);
    try {
      const rol = profile?.rol || '';
      const prevReal = localStorage.getItem('jx_user_role_real');
      if (prevReal !== rol) {
        if (rol) localStorage.setItem('jx_user_role_real', rol);
        else localStorage.removeItem('jx_user_role_real');
      }
      // Si NO hay override activo, sincronizar jx_user_role con el real
      const override = localStorage.getItem('jx_role_override');
      const mode = localStorage.getItem('app_mode');
      const overrideValid = override && mode === 'prueba' && rol === 'admin';
      const efectivo = overrideValid ? override : rol;
      const prevEfectivo = localStorage.getItem('jx_user_role');
      if (prevEfectivo !== efectivo) {
        if (efectivo) localStorage.setItem('jx_user_role', efectivo);
        else localStorage.removeItem('jx_user_role');
        window.dispatchEvent(new Event('app_mode_change'));
      }
    } catch (e) {}
  }, [profile]);

  // Aplica el role override al profile que se expone (sin tocar el real)
  const profileEfectivo = (() => {
    if (!profile) return profile;
    try {
      const override = localStorage.getItem('jx_role_override');
      const mode = localStorage.getItem('app_mode');
      // Override válido SOLO si user real es admin Y mode === 'prueba'
      if (override && mode === 'prueba' && profile.rol === 'admin') {
        return { ...profile, rol: override, _rolReal: profile.rol, _impersonando: true };
      }
    } catch {}
    return profile;
  })();

  async function login(email, password) {
    const result = await authLogin(email, password);
    // Validación defensiva: si Supabase devolvió un profile con rol inválido,
    // rechazamos el login en lugar de aceptarlo y dejar la app en estado raro.
    if (result.profile && !rolEsValido(result.profile.rol)) {
      await authLogout();
      throw new Error(
        `Tu cuenta no tiene un rol válido asignado (rol="${result.profile.rol || 'vacío'}"). Pedile al admin que te asigne uno.`
      );
    }
    setUser(result.session?.user ?? null);
    setProfile(result.profile);
    setOffline(result.offline);
    // PostHog: identificar al user por su id de Supabase + rol (sin email).
    try { identifyUser(result.profile); } catch {}
    if (!result.offline) {
      setTimeout(syncAll, 1000);
    }
    return result;
  }

  // Cierre común (manual, por inactividad, sesión vencida, usuario
  // desactivado). NUNCA borra los datos locales: lo pendiente de subir se
  // queda en el dispositivo. Si entra otra persona, el SyncEngine descarta
  // lo sincronizado del anterior antes de su primer pull (alcance-sync.js).
  const cerrarSesion = useCallback(async (motivo) => {
    if (saliendoRef.current) return;
    saliendoRef.current = true;
    try {
      if (motivo) marcarMotivoSalida(motivo);
      try { await authLogout(); } catch {}
    } finally {
      setUser(null);
      setProfile(null);
      setOffline(false);
      // PostHog: limpiar identidad anónima al cerrar sesión.
      try { resetUser(); } catch {}
      try {
        localStorage.removeItem('jx_user_role');
        localStorage.removeItem('jx_user_role_real');
        localStorage.removeItem('jx_role_override');
      } catch {}
      saliendoRef.current = false;
    }
  }, []);

  // Cerrar sesión a pedido (menú) o por inactividad. Antes de salir intenta
  // subir lo pendiente; si algo no pudo subir y quien cierra es una persona,
  // se le pregunta — en una PC compartida es la última oportunidad de verlo.
  async function logout({ preguntar = true } = {}) {
    let quedan = { registros: 0, evidencias: 0 };
    try { quedan = await subirAntesDeSalir(); } catch {}
    const aviso = mensajePendientesAlSalir(quedan);
    if (preguntar && aviso) {
      let seguir = true;
      try { seguir = window.confirm(aviso); } catch {}
      if (!seguir) return false;
    }
    await cerrarSesion(null);
    return true;
  }

  // ── LA SESIÓN SE CAE SOLA (tanda E, 26-set-2026) ────────────────────
  // Nadie escuchaba a supabase-js. Cuando la sesión se revocaba (los 11
  // refresh_token_reuse por día de los logs) o el token no se podía renovar,
  // la app seguía «adentro» con el sync apagado en silencio y el subidor
  // quemando los reintentos de las fotos. Ahora:
  //   · SIGNED_OUT que no pedimos → a la pantalla de ingreso, diciendo por qué;
  //   · el SyncEngine avisa si un ciclo no encontró sesión (jx_sin_sesion) o
  //     si el servidor dice que el usuario está desactivado
  //     (jx_usuario_inactivo, mig 235);
  //   · el subidor avisa si /api/r2 le devuelve 401 (jx_verificar_sesion):
  //     PostgREST puede seguir aceptando el JWT de una sesión ya revocada
  //     hasta que vence, pero Auth no — se pregunta a Auth.
  // Nada de esto borra los datos del dispositivo.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_OUT') return;
      if (saliendoRef.current || !profileRef.current) return;
      // Fuera del callback: supabase-js pide no llamar a auth adentro (lock).
      setTimeout(() => { cerrarSesion(MOTIVOS_SALIDA.SESION_VENCIDA); }, 0);
    });

    const verificarSinSesion = async () => {
      if (!profileRef.current || saliendoRef.current || !navigator.onLine) return;
      try {
        const { data: d, error } = await supabase.auth.getSession();
        if (d?.session) return;
        if (error && isAuthRetryableFetchError(error)) return; // la red, no la sesión
        cerrarSesion(MOTIVOS_SALIDA.SESION_VENCIDA);
      } catch {}
    };
    const alInactivo = () => {
      if (!profileRef.current) return;
      cerrarSesion(MOTIVOS_SALIDA.DESACTIVADO);
    };
    const verificarConAuth = async () => {
      if (!profileRef.current || saliendoRef.current || !navigator.onLine) return;
      try {
        const { data: d, error } = await supabase.auth.getUser();
        if (d?.user) return;
        if (!error || isAuthRetryableFetchError(error)) return;
        const st = Number(error.status) || 0;
        if (st === 401 || st === 403 || /session.*not.*found|invalid.*jwt|jwt.*expired/i.test(error.message || '')) {
          cerrarSesion(MOTIVOS_SALIDA.SESION_VENCIDA);
        }
      } catch {}
    };
    // Cambió el rol o las obras del usuario (lo detecta el SyncEngine con el
    // `__yo` de sync_pull): se relee el perfil para que el menú y los permisos
    // de la pantalla sigan al servidor sin tener que salir y volver a entrar.
    const releerPerfil = async () => {
      if (!profileRef.current || saliendoRef.current) return;
      try {
        const r = await getCurrentUser();
        if (!r) { cerrarSesion(null); return; }  // getCurrentUser ya dejó el motivo
        if (r.profile && !rolEsValido(r.profile.rol)) { cerrarSesion(null); return; }
        if (r.profile) { setProfile(r.profile); setOffline(!!r.offline); }
      } catch {}
    };
    // Entró sin conexión con el perfil guardado: al volver la red, se confirma
    // contra el servidor (sesión y perfil).
    const alVolverLaRed = () => { if (offlineRef.current) releerPerfil(); };

    window.addEventListener('jx_sin_sesion', verificarSinSesion);
    window.addEventListener('jx_usuario_inactivo', alInactivo);
    window.addEventListener('jx_verificar_sesion', verificarConAuth);
    window.addEventListener('jx_alcance_cambio', releerPerfil);
    window.addEventListener('online', alVolverLaRed);
    return () => {
      data?.subscription?.unsubscribe?.();
      window.removeEventListener('jx_sin_sesion', verificarSinSesion);
      window.removeEventListener('jx_usuario_inactivo', alInactivo);
      window.removeEventListener('jx_verificar_sesion', verificarConAuth);
      window.removeEventListener('jx_alcance_cambio', releerPerfil);
      window.removeEventListener('online', alVolverLaRed);
    };
  }, [cerrarSesion]);

  // Copiar a localStorage el timeout configurado en app_config (llega por el
  // sync) — de ahí lo lee síncrono el timer de abajo. Se ignoran filas demo
  // (config editada en modo prueba no rige la sesión real).
  //
  // Y la FECHA DE CIERRE contable (`periodo_cerrado_hasta`, tanda C del
  // 25-set-2026): hasta hoy nadie la leía y el aviso de «mes ya presentado»
  // decía julio para siempre. Se deja en `periodo-contable.js`, que es de
  // donde la toman el Libro Diario, la auditoría y el costo atrapado.
  useEffect(() => {
    const masReciente = (rows) => rows
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))[0];
    const refrescar = async () => {
      try {
        const rows = await db.app_config
          .filter(r => !r.deleted_at && r.demo !== true
            && (r.clave === 'sesion_timeout_min' || r.clave === CLAVE_CIERRE))
          .toArray();
        const cierre = masReciente(rows.filter(r => r.clave === CLAVE_CIERRE));
        if (cierre) fijarCerradoHasta(cierre.valor);
        const timeout = masReciente(rows.filter(r => r.clave === 'sesion_timeout_min'));
        if (!timeout) return;
        localStorage.setItem(INACTIVITY_LS_KEY, String(clampTimeoutMin(timeout.valor)));
      } catch { /* sin tabla aún (device con schema viejo) o sin localStorage */ }
    };
    refrescar();
    const onChange = (e) => { const t = e?.detail?.tabla; if (!t || t === 'app_config') refrescar(); };
    window.addEventListener('jx_data_changed', onChange);
    window.addEventListener('jx_sync_pull', refrescar);
    return () => { window.removeEventListener('jx_data_changed', onChange); window.removeEventListener('jx_sync_pull', refrescar); };
  }, []);

  // ── Logout por inactividad (configurable; default 30 min) ───────
  // Reinicia el timer en cada evento de usuario. Si pasa el timeout sin
  // actividad, cierra sesión automáticamente. Esto también ayuda contra
  // sesiones colgadas con datos en cache desactualizados — al volver a
  // loguear se vuelven a leer profile/permisos frescos del servidor.
  //
  // 🔴 ESPERAR NO ES ESTAR INACTIVO (tanda 19, 9-set-2026). El contador solo
  // se reinicia con eventos de PERSONA, y una lectura de bases con IA son 30 a
  // 50 minutos mirando una barra sin tocar nada: a los 30 la sesión se cerraba
  // sola, el modal se desmontaba y se perdía el OCR ya pagado. Mientras haya
  // un trabajo largo registrado (lib/sesion-ocupada.js) el cierre se POSTERGA
  // —se vuelve a preguntar en un minuto—, y cuando el trabajo termina el reloj
  // arranca de nuevo completo desde ese momento. La regla sigue en pie: una
  // sesión que de verdad nadie usa se cierra igual.
  const inactivityTimer = useRef(null);
  useEffect(() => {
    if (!profile?.id) return;
    // `hubo` recuerda que el vencimiento lo agarró trabajando: cuando el
    // trabajo termina NO se cierra en el acto —quedaría sin sesión justo al
    // aparecer el resultado que estuvo media hora esperando— sino que el
    // reloj vuelve a empezar entero desde ese momento.
    let hubo = false;
    function vencer() {
      if (hayTrabajoEnCurso()) {
        hubo = true;
        const que = trabajosEnCurso().map(t => t.motivo).join(', ');
        console.log(`[useAuth] Cierre por inactividad POSTERGADO: ${que}`);
        inactivityTimer.current = setTimeout(vencer, ESPERA_TRABAJO_MS);
        return;
      }
      if (hubo) { hubo = false; reset(); return; }

      // Con el servidor restringido (402), cerrar sesión por inactividad deja
      // al usuario AFUERA PARA SIEMPRE: `logout()` hace fullLocalCleanup(), que
      // borra la sesión cacheada de IndexedDB, y para volver a entrar hace falta
      // el servidor, que es justo el que no está. Pasó el 9-set-2026: cada
      // equipo que se quedaba media hora quieto quemaba su propio salvavidas
      // offline, con todos los datos ahí al lado.
      //
      // Mientras dure la restricción postergamos el cierre y seguimos
      // revisando. El timeout protege un equipo desatendido; acá el costo de
      // aplicarlo (perder el acceso por días, hasta que se reinicie el ciclo de
      // facturación) es muchísimo mayor que el riesgo que evita, y es un estado
      // temporal y visible. Cuando el servicio vuelve, el reloj sigue como
      // siempre.
      if (hayServicioRestringido()) {
        console.warn('[useAuth] Cierre por inactividad POSTERGADO: el servicio está restringido y volver a entrar sería imposible.');
        inactivityTimer.current = setTimeout(vencer, ESPERA_TRABAJO_MS);
        return;
      }

      console.log('[useAuth] Sesión cerrada por inactividad');
      marcarMotivoSalida(MOTIVOS_SALIDA.INACTIVIDAD);
      // Sin preguntar (no hay nadie mirando), pero intentando subir antes.
      logout({ preguntar: false });
    }
    function reset() {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      hubo = false;
      inactivityTimer.current = setTimeout(vencer, getInactivityMin() * 60 * 1000);
    }
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach(ev => window.addEventListener(ev, reset, { passive: true }));
    reset();
    return () => {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      events.forEach(ev => window.removeEventListener(ev, reset));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  return { user, profile: profileEfectivo, offline, loading, login, logout };
}
