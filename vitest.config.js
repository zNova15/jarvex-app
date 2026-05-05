import { defineConfig } from 'vitest/config';

// Vitest config separado del Vite config principal para no cargar el plugin
// PWA ni los demás plugins de la app cuando solo corremos tests unitarios.
export default defineConfig({
  test: {
    // Solo testeamos los unit tests bajo src/. Los E2E (Playwright) viven en
    // tests/e2e/ y se corren con su propio runner (`tests/e2e/run-all.mjs`).
    include: ['src/**/__tests__/**/*.{test,spec}.{js,jsx,ts,tsx}'],
    exclude: ['node_modules', 'dist', 'tests/e2e/**'],
    environment: 'node',
  },
});
