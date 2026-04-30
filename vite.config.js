import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
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
              expiration: { maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 },
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
})
