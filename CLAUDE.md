# CLAUDE.md — JARVEX

> Guía para cualquier sesión de Claude Code que trabaje en este repo.
> Idioma de trabajo: **español**. Dueño/admin: **Gabriel Julca Salazar**.

---

## 🎯 Objetivo del proyecto

**Terminar y seguir mejorando JARVEX hasta que sea un programa de gestión de obras
de construcción eficaz y muy completo.** Cada tanda de trabajo debe acercar la app a
esa meta: más robusta, más clara para los usuarios de cada rol, y sin romper lo que
ya funciona en producción. No es un producto "de una sola entrega" — es un ERP vivo
que se pule con el feedback real de la obra (almacenera, ingenieros, contadora,
prevencionista, admin).

---

## ¿Qué es JARVEX?

- **PWA ERP offline-first** para gestión de obras de construcción y almacén (empresa
  peruana, consorcio de obras).
- **Frontend:** React 19 + Vite. **Local-first:** Dexie/IndexedDB + un `SyncEngine`
  propio (`src/sync/SyncEngine.js`) que empuja/baja a Supabase.
- **Backend:** Supabase (Postgres + Storage + RLS). Proyecto `kztnttgzgkvsgornjfln`.
- **Deploy:** Vercel — auto-deploy al pushear a `main` → https://jarvex-app.vercel.app
- **Repo:** público, ramas `main` (producción) y `staging` (candidatos).
- **IA en `api/*`:** Anthropic/Claude (principal, sonnet-4-6 y haiku-4-5) + Mistral
  (OCR en `api/captura-magica.js`).

---

## Comandos

```bash
npm install            # tras clonar (hay pdf-lib, pdfjs-dist, jszip, etc.)
npm run dev            # servidor de desarrollo (Vite)
npm run build          # build de producción — DEBE compilar limpio
npm run test:unit      # vitest — DEBEN pasar TODOS (baseline ~504 tests)
npm run lint           # eslint — NO es gate (cientos de errores preexistentes)
```

> Si en macOS el build/test falla por permisos de tmp, prefijá `TMPDIR=/var/tmp`.

### Green gate (obligatorio antes de deployar)
`npm run test:unit` (todos verdes) **y** `npm run build` (limpio). El lint no cuenta.
Tras el build, verificá que **no** aparezca un chunk nuevo inesperado en `dist/assets`
(regla anti-pantalla-blanca; ej. `jx-solicitudes-*.js` NO debe existir como chunk aparte).

---

## Flujo de deploy

Vercel despliega **solo** al recibir push a `main`.

```bash
# 1) Trabajar y commitear en staging
git add -A && git commit -m "..."      # terminar el mensaje con Co-Authored-By: Claude ...
git push origin staging
# 2) Promover a producción (dispara el deploy)
git checkout main && git merge --ff-only staging && git push origin main
git checkout staging                    # volver a staging
```

- **Migraciones NO las aplica Vercel.** Se aplican aparte por el MCP de Supabase
  (`apply_migration` / `execute_sql`) o entregándole el SQL a Gabriel para el SQL Editor.
  Los `.sql` viven en `supabase/migrations/NNN_*.sql`.
- **Gotcha PWA:** tras cada deploy la app instalada sigue cacheada — el usuario debe
  cerrar y reabrir (o `Ctrl+Shift+R`) para ver la versión nueva.

---

## Estructura del repo

- `src/components/jx-*.jsx` — módulos de la app (uno por área: almacén, seguridad/ssoma,
  pagos, movimientos, admin, solicitudes, ayuda, mi-frente/ingeniero, etc.).
- `src/lib/*.js` — **librerías puras con tests** (la lógica de negocio testeada):
  `personal-categoria`, `evidencias-visibilidad`, `sctr-paquete`,
  `reporte-email-programacion`, `stock-cronologia`, `depositos-bancarizacion`,
  `dedupe-movs-contables`, `pagos`, `ayuda-contenido`, `frente-partidas`, `mi-frente`,
  `color-ingeniero`, `fecha`, …
- `src/db/jarvex.db.js` — esquema Dexie (versionado `db.version(N)`).
- `src/sync/SyncEngine.js` — push/pull contra Supabase.
- `src/hooks/useOfflineData.js` — hooks de datos offline-first.
- `api/*.js` — funciones serverless de Vercel (**límite 12/12 en plan Hobby**).
- `supabase/migrations/` — migraciones SQL numeradas.
- `scripts/` — utilidades Node (backups, google-drive [referencia], n8n, reporte-email).
- `tests/` — e2e (Playwright); los unit tests van junto a cada lib.

### Funciones serverless: 8 en uso (el tope de 12 era de Hobby)
La cuenta está en plan **Pro** (verificado 3-sep-2026): el límite de 12 funciones
por deployment es de **Hobby** y ya no aplica. La regla vieja ("no crear
endpoints, 12/12") frenó decisiones sin motivo durante meses.

Aun así, **preferí multiplexar antes que crear** (ej. `api/captura-magica.js`
maneja varios modos por `body.tipo`): menos superficie que autenticar y menos
lugares donde se pueden quemar créditos de IA.

Uso real medido el 3-sep-2026 (por datos, no por logs — los de Vercel dan
timeout):
- **Vivas:** `captura-magica` (1.249 movs con ítems OCR), `sunat` (378
  proveedores), `categorize` (343 materiales), `validar-comprobante-ai` (136
  guías), `create-user`, `reniec` (esporádica).
- **`sugerir-cuenta-pcge` sirve DOS funciones** en el mismo endpoint:
  `sugerirCuentaPcge` está muerta (1 solo movimiento con `cuenta_pcge`) pero
  `sugerirClasificacionContable` no se puede descartar — 1.304 movimientos
  tienen `clase` y no hay forma de saber cuáles vinieron de ahí. No borrarla sin
  medir eso primero.
- **`sentry-tunnel`** solo se activa si `VITE_SENTRY_DSN` está configurado.
- **Borradas el 3-sep** por 0 uso comprobado: `ocr-asistencia` (0 asistencias),
  `asistente-solicitud-mat` (0 solicitudes de frente),
  `sugerir-cadena-trazabilidad` y `analizar-coherencia-cadena` (0 cadenas).
  Las de cadenas se rehacen con el diseño nuevo cuando la trazabilidad se mueva
  al desglose de cada obra.

### Cómo registrar una página o tabla nueva
- **Página nueva:** `src/main.jsx` (PAGE_CHUNKS) · `src/jx-app.jsx` (títulos +
  PAGE_REGISTRY) · `src/components/jx-sidebar.jsx` (NAV) · `src/components/jx-admin.jsx`
  (`__moduleIdMap` + allowlist del rol + `__canSeeSidebarItem`). El componente se expone
  en `window.*` desde su archivo.
- **Tabla nueva:** migración SQL (espejo de tablas existentes: RLS + columnas
  `version/sync_status/last_synced_at/idempotency_key/deleted_at`) · Dexie `db.version(N)`
  · SyncEngine (TRANSACTIONAL/MASTER_TABLES, `TABLA_TO_MODULO`, `FK_DEPS`) · hook en
  `useOfflineData.js` + registrar en `window.__hooks`.

---

## Reglas / patrones críticos (NO romper)

1. **NUNCA `import()` dinámico de un módulo EAGER** (ej. `jx-solicitudes.jsx`, que expone
   `window.RequestChangeModal` al arrancar). Rollup lo parte en un chunk con init circular
   → `"r is not a function"` al bootear = **pantalla en blanco para todos**. Usá los
   globales `window.*` ya expuestos.
2. **Anti-doble-click en lotes:** el guard por ESTADO (`busy`) tiene carrera (se activa
   recién tras `await` a Dexie; clicks en la ventana de 35–400 ms duplican registros).
   Patrón correcto: **ref SÍNCRONO** que envuelve el handler y corta el click extra en el
   mismo tick:
   ```js
   const enCursoRef = React.useRef(false);
   const handler = async (t) => { if (enCursoRef.current) return; enCursoRef.current = true;
     try { await handlerInner(t); } finally { enCursoRef.current = false; } };
   ```
3. **Regla de hooks:** todos los `useState/useMemo/useEffect/useRef` van **antes** de
   cualquier early return (evita React #310).
4. **Ayuda contextual (`src/lib/ayuda-contenido.js`):** cada cambio de comportamiento de
   una sección debe actualizar su entrada en el **mismo commit** (es el onboarding de los
   usuarios; botón "?" del Header). Hay tests que fallan si una entrada queda vacía.
5. **Visibilidad de evidencias por rol:** `src/lib/evidencias-visibilidad.js` (cliente) y
   la policy RLS `"evidencias: ver segun tipo"` (server) deben mantenerse en **espejo**.
6. **Roles:** 18 roles canónicos con **allowlists exclusivas de menú** en `jx-admin.jsx`
   (`__AYUDANTE_CONTADOR_ITEMS`, `__ASISTENTE_ADMIN_ITEMS`, `__INGENIERO_ITEMS`,
   `__RESIDENTE_ITEMS`, `__SEGURIDAD_ITEMS`). Estas listas **ganan** sobre la matriz de
   permisos → para darle una sección nueva a esos roles hay que agregarla **a su lista**.
7. **Zona horaria:** usar `window.__fecha.hoyLocal()` (`src/lib/fecha.js`, default
   `America/Lima`), nunca `new Date().toISOString().slice(0,10)` (da UTC).

---

## Secretos y entorno

- `.env.example` es la plantilla; los valores reales van en `.env.local` (gitignored) y en
  Vercel → Settings → Environment Variables.
- **NUNCA commitear secretos** (service_role key, API keys de Anthropic/Mistral/n8n/Gmail,
  contraseñas). El repo es **público**.
- El green gate local (`test:unit` + `build`) **no** necesita ninguna API key — esas son
  solo runtime en Vercel (para los `api/*`).
- Si un UPDATE/DELETE masivo financiero es bloqueado por el clasificador del MCP de
  Supabase, **entregar el SQL a Gabriel** para el SQL Editor (no rodear el bloqueo).

---

## Documentación profunda

- **`HANDOFF-CONTINUACION.md`** — estado de producción, flujo de deploy, MCP connectors,
  pendientes abiertos, historial de commits recientes. **Empezá por acá.**
- **`HANDOFF.md`** — arquitectura del rol Ingeniero (`jx-mi-frente.jsx`), respaldo en la
  nube, invariantes del modelo, errores ya cometidos (no repetir).
- `README.md`, `SETUP.md`, `DEPLOY.md`, `EMERGENCY.md` — setup y operación.

---

## Al empezar una sesión nueva

1. Leé `HANDOFF-CONTINUACION.md` (y `HANDOFF.md` para arquitectura).
2. Verificá el estado de producción (commit desplegado + migraciones) por los MCP de
   Vercel y Supabase.
3. Confirmá los pendientes abiertos y **esperá el pedido de Gabriel** antes de tocar nada.
