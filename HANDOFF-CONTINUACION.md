# JARVEX — Handoff para continuar en otro dispositivo / chat

> Documento para retomar el trabajo desde CERO en otra máquina o en un chat nuevo.
> Última actualización: **2026-07-23**. Producción en commit **`55d06b7`**.
> (Leé también `HANDOFF.md` en la raíz — ese documenta la arquitectura profunda.)

---

## 0. PROMPT DE ARRANQUE (pegá esto en el chat nuevo)

```
Voy a continuar el desarrollo de JARVEX desde otra máquina. Primero leé el archivo
HANDOFF-CONTINUACION.md en la raíz del repo (y HANDOFF.md para la arquitectura).
Soy Gabriel Julca Salazar, admin de la app, hablo español. Confirmame:
1) que verificaste el estado de producción (commit y migraciones),
2) qué pendientes hay abiertos,
y esperá mi pedido. No toques nada hasta que te lo indique.
```

---

## 1. QUÉ ES JARVEX (stack)

- **PWA ERP offline-first** para gestión de obras de construcción y almacén (empresa peruana, consorcio de obras).
- **Front:** React 19 + Vite. **Local-first:** Dexie/IndexedDB + un `SyncEngine` propio que empuja/baja a Supabase.
- **Backend:** Supabase (Postgres + Storage + RLS). Proyecto **`kztnttgzgkvsgornjfln`**.
- **Deploy:** Vercel, auto-deploy al hacer push a `main` → **https://jarvex-app.vercel.app** (dominio de producción).
- **Repo:** https://github.com/zNova15/jarvex-app — **PÚBLICO**, rama principal `main`, autor `zNova15`. ⚠ Repo público: NUNCA commitees secretos (service_role key, API keys, contraseñas).
- **Vercel:** límite 12/12 funciones serverless (plan Hobby) — **no crear nuevos endpoints en `api/`**; multiplexar dentro de los existentes (ej. `api/captura-magica.js` maneja varios modos por `body.tipo`).

---

## 2. SETUP DE LA MÁQUINA

Gabriel alterna entre 2 computadoras vía git. Esta guía asume Windows secundaria; adaptá rutas si es la macOS principal.

- **Node portable** (no hay Node global en la Windows secundaria): `%LOCALAPPDATA%\jarvex-tools\node-v22.14.0-win-x64`. Prependé al PATH en cada comando:
  ```powershell
  $env:PATH = "$env:LOCALAPPDATA\jarvex-tools\node-v22.14.0-win-x64;$env:PATH"
  ```
  En la macOS principal probablemente hay Node global — usá el que esté.
- **Instalar deps tras clonar:** `npm install` (hay `pdf-lib`, `pdfjs-dist`, `jszip`, etc.).
- **git:** el primer push desde una máquina nueva puede pedir login por navegador (Git Credential Manager).

---

## 3. FLUJO DE DEPLOY (memorizarlo)

Rama `staging` = candidatos. Rama `main` = producción (Vercel despliega solo al recibir push).

```powershell
# 1) Trabajar y commitear en staging
git add -A
git commit -F <archivo-mensaje>   # (o -m). Terminar con: Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
git push origin staging
# 2) Promover a producción
git checkout main
git merge --ff-only staging
git push origin main              # ← esto dispara el deploy en Vercel
git checkout staging              # volver a staging
```

**Gate verde antes de deployar** (obligatorio):
```powershell
npm run test:unit    # deben pasar TODOS (hoy: 504 tests)
npm run build        # debe compilar limpio
```
El **lint NO es gate** (tiene cientos de errores preexistentes).

**Verificar chunks tras build** (regla anti-pantalla-blanca, ver §6): revisá que no aparezca un chunk NUEVO inesperado en `dist/assets` (ej. `jx-solicitudes-*.js` NO debe existir como chunk aparte).

**Migraciones NO las aplica Vercel.** Se aplican aparte por el MCP de Supabase (ver §4) o dándole el SQL a Gabriel para el SQL Editor.

**Gotcha PWA:** tras cada deploy, la app instalada sigue cacheada. El usuario debe **cerrar y reabrir** (o `Ctrl+Shift+R`) para ver la versión nueva. Muchos "no me funciona / se duplicó" fueron por versión vieja cacheada.

---

## 4. MCP CONNECTORS (Supabase + Vercel vía claude.ai)

En el chat nuevo hay que tener conectados en **claude.ai → Configuración → Conectores**:
- **Supabase** → herramientas `mcp__claude_ai_Supabase__*` (apply_migration, execute_sql, get_logs, list_tables, get_advisors…). Cargarlas con `ToolSearch` `select:...`.
- **Vercel** → `mcp__claude_ai_Vercel__*`. Team **`team_syOqnJQfmm2LaFnNrVvmxrvx`**, proyecto jarvex-app **`prj_yUMtT5AJBV0zj8bsroS8ES8mZmWZ`**.

Con estos se aplican migraciones y se verifica el deploy directo desde el chat. **Se desconectan seguido** a mitad de sesión — si pasa, reautorizar en claude.ai. El `.mcp.json` del repo apunta al MCP hosted de Supabase con OAuth pero el CLI `claude` no está instalado en la Windows; los connectors de claude.ai son la vía que funciona.

**Verificar deploy en producción** (2 formas, porque el sandbox Bash NO tiene salida de red — `curl` da 000):
- **PowerShell SÍ tiene red** → poleá el hash del bundle hasta que cambie:
  ```powershell
  $get = { (Invoke-WebRequest -Uri "https://jarvex-app.vercel.app/" -UseBasicParsing -TimeoutSec 15).Content }
  $rx = 'assets/index-[A-Za-z0-9_-]+\.js'; $old = ([regex]::Match((& $get), $rx)).Value
  do { Start-Sleep 15; $now = ([regex]::Match((& $get), $rx)).Value } until ($now -ne $old)
  "ACTUALIZADO: $now"
  ```
- O con el MCP de Vercel: `list_deployments` / `get_deployment` (readyState READY, target production).

**Clasificador de auto-mode:** bloquea por seguridad UPDATE/DELETE masivos sobre registros financieros, `DROP CONSTRAINT`, y algunas migraciones "grandes" vía MCP. Cuando pase: dividir la migración en partes chicas (suele pasar), o entregar el SQL exacto a Gabriel para el SQL Editor. NO intentar rodearlo maliciosamente.

**Deadlock de `apply_migration` contra Realtime:** al alterar políticas de tablas publicadas (ej. `evidencias`), `apply_migration` deadlockea contra el subscription manager. Solución: usar `execute_sql` con `lock table realtime.subscription in access exclusive mode;` DENTRO de la transacción, ANTES del DDL.

---

## 5. ESTADO ACTUAL DE PRODUCCIÓN (2026-07-23)

- **Commit desplegado:** `55d06b7` (verificado servido en jarvex-app.vercel.app).
- **Migraciones aplicadas:** 131 → **146** (todas). Las últimas: 145 (trigger de stock EPP al editar cantidad) y 146 (docs SCTR contables en RLS) — aplicadas el 22-jul al reconectar el MCP.
- **Tests:** 504 pasando.
- **Dexie** en versión 43. Próxima migración SQL sería la **147**.

**Roles (18 canónicos)** con allowlists EXCLUSIVAS de menú en `jx-admin.jsx` (~línea 1230): `__AYUDANTE_CONTADOR_ITEMS`, `__ASISTENTE_ADMIN_ITEMS`, `__INGENIERO_ITEMS`, `__RESIDENTE_ITEMS`, `__SEGURIDAD_ITEMS`. **Estas listas GANAN sobre la matriz de permisos y los special-cases de `__canSeeSidebarItem`** → para darle una sección nueva a esos roles, hay que agregarla A SU LISTA (no basta la matriz).

---

## 6. REGLAS / PATRONES CRÍTICOS (no romper)

1. **NUNCA `import()` dinámico de un módulo EAGER** (ej. `jx-solicitudes.jsx`, que expone `window.RequestChangeModal` al arrancar). Rollup lo parte en un chunk aparte con init circular → `"Uncaught TypeError: r is not a function"` al bootear = **pantalla en blanco para TODOS**. Usar los globales `window.*` ya expuestos. (Incidente real 21-jul, hotfix `747049a`.)
2. **Anti-doble-click en lotes:** el guard por ESTADO (`busy`) tiene CARRERA — se activa recién después de validaciones con `await` a Dexie; clicks extra en esa ventana (35–400 ms) pasan y **duplican registros**. Patrón correcto: **ref SÍNCRONO** que envuelve el handler:
   ```js
   const enCursoRef = React.useRef(false);
   const handler = async (t) => { if (enCursoRef.current) return; enCursoRef.current = true;
     try { await handlerInner(t); } finally { enCursoRef.current = false; } };
   ```
   Aplicado en los 3 lotes de almacén (materiales, herramientas, EPP). (Incidente real 22-jul, commit `55d06b7`.)
3. **`categoriaDe(persona, subsById)` devuelve `{ categoria, sub }`** — comparar `.categoria`, no el objeto (bug real en jx-pagos).
4. **Ayuda contextual (`src/lib/ayuda-contenido.js`):** REGLA PERMANENTE — cada mejora o cambio de comportamiento de una sección debe **actualizar su entrada en el MISMO commit**. Es el onboarding de los usuarios nuevos (botón "?" del Header, `components/jx-ayuda.jsx`). Hay tests que validan que ninguna entrada quede vacía.
5. **Visibilidad de evidencias por rol:** `src/lib/evidencias-visibilidad.js` (cliente) + policy RLS `"evidencias: ver segun tipo"` (server). Los tipos CONTABLES (bancarizacion, factura, comprobante_captura, guia_remision, recibo_honorarios, pago_evidencia, sctr_cotizacion/pago/factura/otro) solo los ven admin/contador/ayudante_contador + autor. El certificado SCTR (tipo `sctr`) SÍ lo ve la ing. de seguridad.
6. **Secretos:** service_role key, API keys de n8n/Gmail, contraseñas → NUNCA en chat ni en el repo. Si hace falta un UPDATE masivo financiero que el clasificador bloquea, se entrega el SQL a Gabriel.
7. **Bash sandbox sin red** (curl=000). Verificar deploys/HTTP por **PowerShell** o por el **MCP de Vercel**.

---

## 7. PENDIENTES ABIERTOS (lo que falta)

### 7.1 — n8n: reconectar la credencial de Gmail (BLOQUEANTE para los reportes por email)
Los reportes 2.0 (diario/semanal/mensual) se generan bien: una **GitHub Action horaria** arma el HTML y lo deja en la tabla `reportes_email_outbox` de Supabase. Un **workflow de n8n** ("JARVEX · Enviar reportes del outbox (email)", id `MxnEgZIBBOCnlNsg`, ACTIVO) toma lo pendiente cada 10 min y lo envía por Gmail → marca `enviado`.
**Problema:** la credencial "Gmail account" de n8n da `invalid_grant` (token de Google expirado/revocado) — el workflow corre pero **falla al enviar**. Lo debe arreglar **Gabriel manualmente en la UI de n8n** (Google exige consentimiento manual): n8n → **Credentials → "Gmail account" → Reconnect / Sign in with Google** → aceptar permisos. Tip: si la app OAuth de Google está en modo "Testing", los tokens mueren cada 7 días → publicar la app (OAuth consent screen → Publish).
**Cuando lo reconecte:** verificar una ejecución exitosa del workflow `MxnEgZIBBOCnlNsg` y **DESACTIVAR el workflow viejo** `H11tBHgKxGZSTJey` ("JARVEX · Reporte diario por email", 18:00, correo feo) para que no lleguen dos correos.
- Instancia n8n: `https://prueba-1-n8n.f4livu.easypanel.host` (self-hosted en Easypanel). La **API key la re-pega Gabriel** en el chat (NO está en el repo por seguridad). Credenciales que reusa el workflow nuevo: Gmail `pWUHSyKcUwkQ16Zg`, Supabase `6ReCsCAt8iPWhCwq`.
- Template del workflow versionado en `scripts/n8n/enviar-outbox-reportes.json`.
- Además: activar las pestañas **Semanal** y **Mensual** en la app (Reportes → Envío por email; vienen apagadas). NO agregar los secrets de Gmail en GitHub (el envío va por n8n; el camino SMTP directo de `scripts/reporte-email/send.mjs` queda dormido).

### 7.2 — Duplicados AMBIGUOS de almacén a revisar con la almacenera
Los duplicados técnicos inequívocos (<2 s de delta) ya se limpiaron. Quedan 4 casos con minutos de diferencia (pueden ser registros legítimos) — **confirmar con la almacenera** si sobran; si sí, eliminarlos desde la app y correr "Recalcular stocks":
- ENMALLADO HDPE ×3 (salida, 22-jul)
- ROLLO CINTA DE SEGURIDAD amarillo ×2 (salida, 22-jul)
- TUBO PVC-U 160mm alcantarillado ×2 (salida, 21-jul, 34 min de delta)
- ARENA GRUESA CAMA APOYO ×2 (entrada, fecha 15-jul)

### 7.3 — Barrido de las 27 ventas pre-inicio (Gabriel corre el SQL)
Facturas de VENTA emitidas ANTES de la fecha de inicio de la obra vinculada (25 INTERCO S/650,354 + 2 externas) que deben pasar a **Contabilidad Neta**. El clasificador bloquea el UPDATE masivo por MCP → Gabriel lo corre en Supabase → SQL Editor (idempotente):
```sql
update public.accounting_movements m
set obra_id = null, destino_contable = 'contabilidad_neta',
    updated_at = now(), version = coalesce(m.version, 0) + 1
from public.obras o
where o.id = m.obra_id and m.deleted_at is null
  and o.fecha_inicio is not null and m.date is not null
  and m.date < o.fecha_inicio;
```
(Las 130 compras externas pre-inicio ya se barrieron en su momento; solo faltan las ventas.)

### 7.4 — Solicitudes viejas de la asistente contable (manuales)
Las 29 solicitudes que estaban en la bandeja se crearon con formato descriptivo (acción manual). Solo las **nuevas** usan el formato estructurado auto-aplicable (vinculación + eliminar bancarización). Las viejas se resuelven a mano una vez, o la asistente las re-crea con los selectores nuevos.

---

## 8. QUÉ SE HIZO EN LAS ÚLTIMAS SESIONES (por si preguntan)

De más viejo a más nuevo (commits en `main`):
- `f8dde7a` Reportes email 2.0 (diario/semanal/mensual programables, mobile-first).
- `2a0bd2f` Fix urgente sync: `evidencias.obra_id` nullable (mig 141) + `recalcular_stock_material` convergente (mig 142).
- `f98b5d2` Evidencias por rol + confirmación de bancarización + filtros Emisor/Receptor en Movs. Contables + fix Crear Usuario (mig 143 guías contables).
- `04090bf` Fix raíz "⏳ Subiendo bancarización" eterno (SyncEngine estampa 'synced' al bajar) + botón Ver/Cambiar.
- `5ac3379` "Cambiar" bancarización solo admin/contadora; ✕ eliminar pagos registrados.
- `b6e5cfd` Hotfix ReferenceError 'pendiente'.
- `e11ecb0` Ayuda contextual: botón "?" global (`jx-ayuda.jsx` + `ayuda-contenido.js`, ~90 secciones).
- `86160fc` Pagos habilitado para ayudante_contador (mig 144 RLS).
- `43c686a` Pagos: solo personal activo, sin gente de subcontratos, sección Historial.
- `b945802` Residente de Obra acotado a lo técnico; Personal solo Obrero/Subcontratos.
- `ca67082` Ing. de Seguridad acotada (SSOMA + EPP en consulta); "Solicitar subcontrato".
- `c0ed784` Reportes email por Gmail SMTP directo (alternativa, dormida sin secrets).
- `d22efc7` Template del workflow n8n.
- `747049a` HOTFIX pantalla en blanco (quitar import dinámico de jx-solicitudes).
- `4cfe2be` Contadora Jefe: **SCTR con IA** (sube 1 PDF del trámite → la IA separa cotización/certificado/pago/factura con `pdf-lib` y extrae asegurados/vigencia; modal de corroboración matchea vs personal por DNI/nombre y vincula) + Pagos organizado (documento vs transferencias) + Inicio limpio + subcontratos "sin contrato" visibles (mig 146 escrita).
- `811f7bc` Vinculación de insumos EN LOTE para ingenieros (casillas + barra de lote).
- `0fc56da` Solicitudes de la asistente AUTO-APLICABLES (vinculación de factura + eliminar bancarización, estructuradas).
- `55d06b7` **(ACTUAL)** Fix raíz duplicados de almacén (carrera del guard en los 3 lotes) + aviso anti re-registro + fix stock EPP negativo (ZAPATOS 41) + migs 145/146 aplicadas.

**Librerías puras clave** (con tests, en `src/lib/`): `personal-categoria`, `evidencias-visibilidad`, `sctr-paquete`, `reporte-email-programacion`, `stock-cronologia`, `depositos-bancarizacion`, `dedupe-movs-contables`, `pagos`, `ayuda-contenido`.

---

## 9. MEMORIA PERSISTENTE (solo en la Windows secundaria)

En ESTA máquina hay memoria auto-cargada en `C:\Users\Jarvex\.claude\projects\c--Users-Jarvex-Documents-JARVEX-APP\memory\jarvex-app-repo.md` con todo el detalle histórico. **En otro dispositivo esa memoria NO existe** — por eso este handoff. Si querés, pedile al chat nuevo que vuelva a crear su memoria de proyecto a partir de este documento.
