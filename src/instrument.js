// ═══════════════════════════════════════════════════════════════════
// JARVEX — Sentry instrumentation
//
// IMPORTANTE: este archivo se importa PRIMERO en main.jsx, antes que
// cualquier otro módulo. Sin eso, Sentry pierde errores de los imports
// y del bootstrap inicial.
//
// Configuración pensada para JARVEX (ERP de constructora con datos
// contables/SUNAT/personal sensibles):
//
//   - sendDefaultPii: FALSE — JAMÁS mandamos PII de users. Ver beforeSend.
//   - sample rates conservadores para no quemar la cuota free de Sentry
//     (5K eventos/mes alcanzan para 5-10 users si no hay loops).
//   - Replay solo on-error (no en sesión random), para tener video del
//     crash sin grabar todas las sesiones.
//   - Scrubbing agresivo en beforeSend: DNIs, RUCs, emails, tokens.
//   - Filtros de noise: extensiones, ResizeObserver loop, errores que ya
//     manejamos en código (network failures, abort).
//
// Ver: https://docs.sentry.io/platforms/javascript/guides/react/
// ═══════════════════════════════════════════════════════════════════

import * as Sentry from "@sentry/react";

// Solo inicializar si hay DSN configurado. En dev local probablemente no
// hay DSN — la app sigue funcionando sin Sentry.
const dsn = import.meta.env.VITE_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,

    // Entornos: production / preview / development. Vite setea MODE.
    environment: import.meta.env.MODE,

    // Versión de release — útil para correlacionar bugs con deploys.
    // Inyectada en build (default 'unknown' si no hay).
    release: import.meta.env.VITE_APP_VERSION || 'jarvex@unknown',

    // ❌ NO mandamos PII por defecto. JARVEX maneja DNIs, RUCs, datos
    // contables, comprobantes SUNAT, planillas — todo eso es privado.
    sendDefaultPii: false,

    integrations: [
      // Tracing: spans automáticos para fetch/xhr, navegación, etc.
      Sentry.browserTracingIntegration(),
      // Replay: graba la pantalla del user. Solo cuando hay un error.
      Sentry.replayIntegration({
        // Maskear todo el texto del DOM por defecto (privacy first)
        maskAllText: true,
        // No grabar imágenes/videos (pueden ser fotos de obra con PII)
        blockAllMedia: true,
        // Maskear inputs (passwords, etc.)
        maskAllInputs: true,
      }),
    ],

    // ── Sample rates conservadores ──────────────────────────────────
    // Tracing: 10% en producción (no necesitamos cada request, solo muestra)
    tracesSampleRate: import.meta.env.MODE === 'production' ? 0.1 : 1.0,

    // Replay: NO grabar sesiones random (consume mucho — un user activo de
    // 8h grabado son ~30MB). Solo grabamos cuando hay un error y los 60s
    // previos al crash.
    replaysSessionSampleRate: 0.0,
    replaysOnErrorSampleRate: 1.0,

    // ── Filtros de noise ────────────────────────────────────────────
    // Errores que NO queremos en Sentry (ruido, no son bugs reales).
    ignoreErrors: [
      // Extensiones del browser
      /chrome-extension:\/\//i,
      /moz-extension:\/\//i,
      // ResizeObserver loop benigno (no afecta UX)
      /ResizeObserver loop limit exceeded/i,
      /ResizeObserver loop completed with undelivered notifications/i,
      // Network errors que ya manejamos con sync engine
      /Network request failed/i,
      /NetworkError when attempting to fetch/i,
      /Failed to fetch/i,
      /Load failed/i,
      // Cancelaciones intencionales
      /AbortError/i,
      /The operation was aborted/i,
      // Service Worker que está actualizando
      /InvalidStateError.*ServiceWorker/i,
      // Falsos positivos típicos
      /Non-Error promise rejection captured/i,
    ],

    // ── beforeSend: scrubbing de PII ────────────────────────────────
    // Última línea de defensa antes de enviar a Sentry. Acá filtramos
    // DNIs, RUCs, emails, tokens, claves que se pudieran haber colado
    // en mensajes de error o breadcrumbs.
    beforeSend(event, hint) {
      try {
        // 1. Limpiar el mensaje del error (puede tener "DNI 12345678 no encontrado")
        if (event.message) {
          event.message = scrubPII(event.message);
        }

        // 2. Limpiar exception messages
        if (event.exception?.values) {
          event.exception.values.forEach(ex => {
            if (ex.value) ex.value = scrubPII(ex.value);
          });
        }

        // 3. Limpiar breadcrumbs (clicks, console logs, navegación)
        if (event.breadcrumbs) {
          event.breadcrumbs = event.breadcrumbs
            // Filtrar breadcrumbs con datos sensibles
            .filter(bc => {
              if (!bc.message) return true;
              // Si menciona service_role o eyJ (JWT) → drop
              if (/service_role|eyJ[a-zA-Z0-9_-]{20,}/.test(bc.message)) return false;
              return true;
            })
            .map(bc => ({
              ...bc,
              message: bc.message ? scrubPII(bc.message) : bc.message,
              data: bc.data ? scrubObjectPII(bc.data) : bc.data,
            }));
        }

        // 4. Limpiar URL (query params pueden tener datos)
        if (event.request?.url) {
          event.request.url = scrubPII(event.request.url);
        }

        // 5. NO mandar el body de la request
        if (event.request?.data) {
          event.request.data = '[scrubbed by jarvex]';
        }

        // 6. Limpiar contexts (incluido el user ya que sendDefaultPii=false)
        if (event.user) {
          // Mantenemos solo el id (UUID, no es PII directa) para correlacionar
          // bugs por user. El email/nombre se quita.
          event.user = event.user.id ? { id: event.user.id } : undefined;
        }
      } catch (err) {
        // Si el scrubber falla por algún motivo, mejor mandar nada que
        // mandar PII accidentalmente.
        return null;
      }
      return event;
    },

    // ── beforeBreadcrumb: limpiar breadcrumbs antes de agregarlos ───
    beforeBreadcrumb(breadcrumb, hint) {
      // Filtrar breadcrumbs de DOM clicks que tengan datos en aria-label
      if (breadcrumb.category === 'ui.click' && breadcrumb.message) {
        breadcrumb.message = scrubPII(breadcrumb.message);
      }
      // Filtrar fetch/xhr que apunten a Supabase auth (tokens en URL)
      if ((breadcrumb.category === 'fetch' || breadcrumb.category === 'xhr')
          && breadcrumb.data?.url) {
        if (/\/auth\/v1\/(token|user)/.test(breadcrumb.data.url)) {
          // Sí queremos saber que pasó el call, pero sin parámetros
          breadcrumb.data.url = breadcrumb.data.url.replace(/\?.*$/, '?[scrubbed]');
        }
      }
      return breadcrumb;
    },
  });

  // Marcar tag útil para filtrar en el dashboard
  Sentry.setTag('app', 'jarvex');

  console.info('[Sentry] inicializado en modo', import.meta.env.MODE);
} else if (import.meta.env.MODE === 'production') {
  console.warn('[Sentry] VITE_SENTRY_DSN no configurado en producción — errores no se reportan');
}

// ─── Helpers de scrubbing ────────────────────────────────────────────

// Patrones de PII conocidos en JARVEX (Perú)
// - DNI: 8 dígitos
// - RUC: 11 dígitos (empieza con 10/15/20/17)
// - Carnet ext: 9-12 dígitos
// - Email: standard
// - JWT: eyJ... (Supabase tokens)
// - UUIDs: dejamos pasar (son identificadores opacos, no PII)
const RE_DNI       = /\b[0-9]{8}\b/g;
const RE_RUC       = /\b(10|15|17|20)[0-9]{9}\b/g;
const RE_EMAIL     = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const RE_JWT       = /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g;
const RE_BEARER    = /Bearer\s+[a-zA-Z0-9._\-+/]+={0,2}/gi;
const RE_PHONE     = /\b9\d{8}\b/g; // celulares peruanos: 9 dígitos empezando con 9
const RE_CCI       = /\b00\d{18,20}\b/g; // CCI bancario peruano

function scrubPII(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(RE_RUC,    '[ruc]')
    .replace(RE_DNI,    '[dni]')   // después de RUC para no matchear los primeros 8 del RUC
    .replace(RE_EMAIL,  '[email]')
    .replace(RE_JWT,    '[jwt]')
    .replace(RE_BEARER, 'Bearer [token]')
    .replace(RE_CCI,    '[cci]')
    .replace(RE_PHONE,  '[phone]');
}

function scrubObjectPII(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    // Claves sensibles directas — siempre scrub
    if (/dni|ruc|email|password|pass|secret|token|key|authorization|cookie/i.test(k)) {
      out[k] = '[scrubbed]';
      continue;
    }
    if (typeof v === 'string') {
      out[k] = scrubPII(v);
    } else if (typeof v === 'object' && v !== null) {
      out[k] = scrubObjectPII(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Helpers exportados para que el SyncEngine y otros módulos puedan
// reportar errores específicos manualmente.
export function captureException(error, context = {}) {
  if (!dsn) return;
  Sentry.withScope(scope => {
    if (context.tags) {
      Object.entries(context.tags).forEach(([k, v]) => scope.setTag(k, v));
    }
    if (context.extra) {
      // Scrub también el extra para no filtrar PII en context
      scope.setExtra('extra', scrubObjectPII(context.extra));
    }
    if (context.level) scope.setLevel(context.level);
    Sentry.captureException(error);
  });
}

export function captureMessage(message, level = 'info') {
  if (!dsn) return;
  Sentry.captureMessage(scrubPII(message), level);
}

export { Sentry };
