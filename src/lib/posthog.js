// ═══════════════════════════════════════════════════════════════════
// JARVEX — PostHog (telemetría de uso)
//
// Trackea pantallas que se usan, clicks, y user identification para
// responder a la pregunta del Council Verdict:
//   *"¿Cuáles de las 60 pantallas se usaron esta semana?"*
//
// Configuración pensada para JARVEX (datos sensibles):
//
//   - sanitize_properties: scrubbing agresivo de PII en cada evento
//     (DNIs, RUCs, emails, JWT, números bancarios) — reuso del scrubber
//     del módulo Sentry para mantener una sola fuente de verdad.
//   - capture_pageview: false — manualmente trackeamos pageview cuando
//     cambia la "página" en JARVEX (no es una SPA con rutas reales,
//     usa state interno). Lo hacemos en App.jsx con setPage.
//   - mask_personal_data_properties: PostHog tiene su propio masking
//     pero nosotros aplicamos primero el scrubber con regex peruanas.
//   - autocapture: true — clicks de buttons + form submits — útil para
//     ver flujos de uso reales sin instrumentar cada botón.
//   - session_recording: ❌ false. JARVEX maneja datos contables/SUNAT/
//     planillas, NO queremos grabar pantallas con esa info.
//
// Si VITE_POSTHOG_KEY no está configurado, el módulo es no-op. La app
// sigue funcionando sin PostHog.
// ═══════════════════════════════════════════════════════════════════
import posthog from 'posthog-js';

const KEY = import.meta.env.VITE_POSTHOG_KEY;
// SIEMPRE usamos el reverse proxy /ingest/* (configurado en vercel.json)
// para esquivar adblockers. Ojo: NO usar import.meta.env.VITE_POSTHOG_HOST
// acá — Vite inlinea esa env var en build-time, y si en algún momento se
// definió apuntando a us.i.posthog.com, el bundle queda con esa URL
// hardcoded y los adblockers vuelven a bloquear todo.
const HOST = '/ingest';
// PostHog necesita saber el host real para descargar assets estáticos
// (toolbar, recordings) — el proxy /ingest/static/:path se encarga.
const UI_HOST = import.meta.env.VITE_POSTHOG_UI_HOST || 'https://us.posthog.com';

let _initialized = false;

// Patrones PII de Perú (mismos que en src/instrument.js de Sentry).
const RE_DNI    = /\b[0-9]{8}\b/g;
const RE_RUC    = /\b(10|15|17|20)[0-9]{9}\b/g;
const RE_EMAIL  = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const RE_JWT    = /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g;
const RE_PHONE  = /\b9\d{8}\b/g;
const RE_CCI    = /\b00\d{18,20}\b/g;

function scrubPII(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(RE_RUC,    '[ruc]')
    .replace(RE_DNI,    '[dni]')
    .replace(RE_EMAIL,  '[email]')
    .replace(RE_JWT,    '[jwt]')
    .replace(RE_CCI,    '[cci]')
    .replace(RE_PHONE,  '[phone]');
}

function scrubObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (/dni|ruc|email|password|pass|secret|token|key|authorization|cookie/i.test(k)) {
      out[k] = '[scrubbed]';
      continue;
    }
    if (typeof v === 'string')      out[k] = scrubPII(v);
    else if (Array.isArray(v))      out[k] = v.map(item => typeof item === 'string' ? scrubPII(item) : (typeof item === 'object' ? scrubObject(item) : item));
    else if (typeof v === 'object' && v !== null) out[k] = scrubObject(v);
    else                            out[k] = v;
  }
  return out;
}

export function initPostHog() {
  if (_initialized) return;
  if (!KEY) {
    if (import.meta.env.MODE === 'production') {
      console.warn('[PostHog] VITE_POSTHOG_KEY no configurado en producción — telemetría desactivada');
    }
    return;
  }

  posthog.init(KEY, {
    api_host: HOST,
    ui_host: UI_HOST,
    // Privacy / autocapture:
    autocapture: true,                    // captura clicks/forms automáticamente
    capture_pageview: false,              // lo manejamos manual con setPage (no hay rutas)
    capture_pageleave: true,              // tiempo en pantalla
    disable_session_recording: true,      // ❌ NO grabar pantalla (datos sensibles)
    persistence: 'localStorage',          // sin cookies de tracking
    cross_subdomain_cookie: false,
    // PostHog respeta DNT por default — está bien.
    respect_dnt: true,
    // Loadeamos toolbar solo si el user es admin (configurable runtime)
    loaded: () => {
      // Marcamos versión como super-property para filtrar bugs por release
      try {
        const release = import.meta.env.VITE_APP_VERSION || 'jarvex@unknown';
        posthog.register({ app_version: release, app_env: import.meta.env.MODE });
      } catch {}
    },
    // Antes de mandar cualquier evento al server, scrub PII de las
    // properties. Este es el último cordón de seguridad: aunque el código
    // de la app pase un DNI por error, acá lo limpiamos.
    sanitize_properties: (properties) => {
      try { return scrubObject(properties); }
      catch { return {}; }
    },
  });

  _initialized = true;
  console.info('[PostHog] inicializado en', HOST);
}

// ─── Helpers públicos ────────────────────────────────────────────

// Identificar al user con su id de Supabase + rol (NO email).
// El distinct_id queda asociado a las acciones que haga.
export function identifyUser(profile) {
  if (!_initialized || !profile?.id) return;
  try {
    posthog.identify(profile.id, {
      // SOLO metadata no-PII. NO email, NO nombre completo.
      rol: profile.rol || 'unknown',
      obra_id_activa: profile.obra_id || null,
    });
    // Super-properties: se inyectan automáticamente en CADA evento
    // posterior. Sin esto, los dashboards filtrados por rol solo verían
    // $pageview (que ya pasa user_rol manual) pero no los record_pushed
    // del SyncEngine. Con register, todo evento queda taggeado.
    posthog.register({
      user_rol: profile.rol || 'unknown',
      obra_activa: profile.obra_id || null,
    });
    // Group analytics: agrupar por obra para ver patrones por obra.
    if (profile.obra_id) {
      posthog.group('obra', profile.obra_id);
    }
  } catch (e) {
    console.warn('[PostHog] identify falló', e?.message);
  }
}

// Limpiar identidad al logout.
export function resetUser() {
  if (!_initialized) return;
  try { posthog.reset(); } catch {}
}

// Trackear cambio de pantalla. Llamar desde setPage del App.jsx.
export function trackPageView(pageId, extras = {}) {
  if (!_initialized) return;
  try {
    posthog.capture('$pageview', {
      page: pageId,
      // Properties extra opcionales. Pasaron por sanitize_properties.
      ...extras,
    });
  } catch {}
}

// Trackear evento custom (acciones de negocio: "registró movimiento",
// "creó valorización", etc.). Útil para feature usage analytics.
export function trackEvent(eventName, properties = {}) {
  if (!_initialized) return;
  try { posthog.capture(eventName, properties); }
  catch {}
}

// Exponer la instancia bajo window para debug en DevTools.
// Uso: window.posthog.capture('test', { foo: 'bar' });
if (typeof window !== 'undefined') {
  window.posthog = posthog;
}

export { posthog };
