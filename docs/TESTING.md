# JARVEX — Tests

Cómo correr los tests de la app y qué cubren.

## Tests unitarios (vitest)

Validan funciones puras: scrubbers de PII, cálculos de stock, helpers de fechas, etc. Corren en milisegundos.

```bash
npm run test:unit          # corre 1 vez
npm run test:unit:watch    # watch mode mientras desarrollás
```

Los archivos están en `src/**/__tests__/*.test.js`.

## Tests E2E (Playwright)

Levantan un Chrome real, hacen login en producción y validan flows críticos. Cada test demora 30–60s. Total ~5 min para la suite completa.

### Setup (una vez)

1. Instalá deps de tests:
   ```bash
   cd tests
   npm install
   cd ..
   ```
2. Exportá credenciales de un usuario de prueba (admin o el tuyo):
   ```bash
   export JX_TEST_EMAIL="grabieljesusjulcasalazar@gmail.com"
   export JX_TEST_PASSWORD="..."
   ```

### Correr

```bash
# Suite completa, headless (rápido, sin ventana de browser)
npm run test:e2e

# Mismo, pero viendo el browser (útil para debug)
npm run test:e2e:headed

# Un solo test
node tests/e2e/06-sync-no-leak-local-fields.test.mjs

# Apuntar a otra URL (ej: preview de Vercel)
JX_TEST_URL=https://jarvex-app-git-mibranch.vercel.app/ npm run test:e2e
```

Si un test falla, dejará un screenshot en `tests/screenshots/fail-*.png` con el estado de la app cuando rompió.

### Qué cubre cada test

| # | Test | Qué verifica |
|---|---|---|
| 01 | smoke | Login carga, dashboard renderiza, globals (`window.__db`) expuestos, 0 errores en consola |
| 02 | navegacion | Cambiar entre 5 pantallas distintas sin errores |
| 03 | busqueda | Búsqueda global devuelve resultados |
| 04 | alertas | Sistema de alertas/notificaciones funciona |
| 05 | sync-offline | Crear movimiento online → push OK; offline → pending; online de nuevo → push exitoso. Doble-click no duplica. |
| 06 | sync-no-leak | **Regression** del bug JARVEX-APP-4: el SyncEngine no manda campos `_*` (metadatos locales) al server. |

### Cuándo correrlos

- **Antes de cada deploy a producción**: `npm run test:e2e`. 5 min ahora ahorra 1 hora de "¿por qué se rompió?" después.
- **Después de un cambio en SyncEngine, supabase migration o RLS**: obligatorio. Estos componentes tienen efectos en cascada que solo se ven en E2E.
- **Antes de mergear PR grande**: aunque los unit tests pasen.

### Agregar un test nuevo

1. Copiá un test existente que se parezca al flow que querés cubrir (`06-sync-no-leak-local-fields.test.mjs` es buen template).
2. Ajustá la lógica.
3. Asegurate de exportar `run()` y agregar el `if (import.meta.url === ...)` final para correrlo standalone.
4. Agregalo a `tests/e2e/run-all.mjs`:
   ```js
   import { run as miTest } from './07-mi-nuevo-test.test.mjs';
   const TESTS = [..., { name: '07-mi-test', fn: miTest }];
   ```
5. Cleanup: tu test DEBE borrar lo que creó. Si dejás records con `[E2E TEST]` en producción, se acumulan y ensucian la base.

### Debugging

- `HEADLESS=false` para ver el browser.
- `await page.pause()` adentro del test para parar y inspeccionar (solo en headed).
- Los screenshots de fallo en `tests/screenshots/` muestran el estado exacto.
- Los logs `page.__consoleErrors` capturan errores JS de la app durante el test.
