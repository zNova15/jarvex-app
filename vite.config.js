import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { sentryVitePlugin } from '@sentry/vite-plugin'

// Sentry source maps: solo activamos el upload si SENTRY_AUTH_TOKEN está
// presente (en CI / Vercel). En dev local no aplica — el plugin no rompe
// el build si no hay token, simplemente no sube los maps.
const SENTRY_TOKEN = process.env.SENTRY_AUTH_TOKEN;

// Versión del release. Vercel expone VERCEL_GIT_COMMIT_SHA en builds;
// localmente caemos a npm_package_version o 'dev'. Sin esto, Sentry
// recibía 'jarvex@unknown' y NO podía mapear sourcemaps a release →
// stacktraces en prod aparecían minificados ("Wo at index-XXX.js:9:52000")
// en vez de simbolicados ("handleSubmit at jx-almacen.jsx:680").
const RELEASE = `jarvex@${
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
  process.env.npm_package_version ||
  'dev'
}`;

export default defineConfig({
  // Inyectamos VITE_APP_VERSION en build-time. Vite reemplaza
  // `import.meta.env.VITE_APP_VERSION` por este string literal.
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(RELEASE),
  },
  // Generar source maps en producción para que Sentry pueda mapear los
  // stack traces minificados a líneas reales del código fuente. Sin esto,
  // un error aparece como "at Wo (index-XXX.js:9:52390)" en vez de
  // "at handleSubmitMaterial (jx-almacen.jsx:680:5)".
  build: {
    sourcemap: true,
  },
  plugins: [
    react(),
    // Sentry plugin — solo en build de Vercel (cuando hay token). El plugin
    // sube los .map.js a Sentry y los borra del bundle público para que
    // los users del cliente no los descarguen (ahorra bandwidth + privacidad
    // del código fuente).
    SENTRY_TOKEN && sentryVitePlugin({
      org: 'novvx-proyect',
      project: 'jarvex-app',
      authToken: SENTRY_TOKEN,
      // Borrar los archivos .map del bundle público después de subirlos.
      // Sentry los tiene, los users del cliente NO.
      sourcemaps: {
        filesToDeleteAfterUpload: ['./dist/**/*.map'],
      },
      // No fallar el build si la subida falla (ej: token inválido o Sentry
      // caído). Es deseable que un problema con Sentry no bloquee deploys.
      errorHandler: (err) => {
        console.warn('[Sentry plugin] upload failed (non-fatal):', err.message);
      },
    }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'icons/*.png'],
      workbox: {
        // El bundle creció con Versiones + Contabilidad; el default de 2MiB
        // ya quedó corto. Subimos a 5MiB para que workbox lo precachee.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // skipWaiting + clientsClaim para que el SW nuevo tome control
        // inmediatamente sin esperar a que el usuario cierre la pestaña.
        skipWaiting: true,
        clientsClaim: true,
        // Limpia precaches viejos al activar el nuevo SW. Sin esto, los
        // usuarios existentes pueden quedar con index.html viejo apuntando
        // a bundles JS que ya no existen en el server → pantalla negra.
        cleanupOutdatedCaches: true,
        // index.html SIEMPRE desde la red si hay conexión. Si falla, usa
        // el cacheado. Esto evita que un usuario con SW viejo quede
        // bloqueado en una versión que ya no funciona.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/auth/],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/storage\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'evidencias-cache',
              // 1 día máx (antes era 7d). Si una evidencia se borra del server,
              // el SW sigue sirviendo la versión local pero por menos tiempo.
              // Logout también borra esta cache desde el cliente (useAuth.js).
              expiration: { maxEntries: 200, maxAgeSeconds: 24 * 60 * 60 },
            },
          },
          // SUNAT/RENIEC y otros endpoints serverless propios: NO cachear
          // (las respuestas vienen del proxy /api/*, siempre frescas).
          {
            urlPattern: /\/api\/(sunat|reniec)/,
            handler: 'NetworkOnly',
          },
        ],
      },
      manifest: {
        name: 'JARVEX — Gestión de Obras',
        short_name: 'JARVEX',
        description: 'Sistema ERP para control de almacén y gestión de obra',
        theme_color: '#0E1620',
        background_color: '#0E1620',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': '/src' },
  },
  // Producción: solo eliminamos `debugger` y `console.log/info/debug`. Los
  // console.error y console.warn SE MANTIENEN porque son críticos para
  // diagnosticar problemas que ven los users en runtime (errores de sync,
  // 401/403 contra Supabase, fallos de RLS, etc.). Sin estos, debugar
  // bugs reportados por users sería casi imposible.
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['debugger'] : [],
    pure: process.env.NODE_ENV === 'production' ? ['console.log', 'console.info', 'console.debug'] : [],
  },
})
