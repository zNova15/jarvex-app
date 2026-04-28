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
        // skipWaiting + clientsClaim para que el SW nuevo tome control
        // inmediatamente sin esperar a que el usuario cierre la pestaña.
        // Esencial cuando se cierran APIs externas (caso SUNAT v2 → v1).
        skipWaiting: true,
        clientsClaim: true,
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
          // SUNAT/RENIEC: NO cachear — siempre red (las respuestas pueden
          // cambiar, los endpoints pueden cambiar de política como acabó
          // pasando con apis.net.pe v2)
          {
            urlPattern: /^https:\/\/api\.apis\.net\.pe\//,
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
