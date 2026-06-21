# HANDOFF — JARVEX · Rol Ingeniero + Respaldo en la nube
_Última actualización: 2026-06-21 · para retomar en una sesión nueva con contexto fresco._

---

## 0. TL;DR (leé esto primero)
- **App**: JARVEX, ERP de construcción peruano. **React + Vite + Dexie/IndexedDB (local-first) + sync a Supabase**. Repo `github.com/zNova15/jarvex-app` rama `main`. Deploy automático a **Vercel** al pushear a main. Proyecto Supabase `kztnttgzgkvsgornjfln`. Usuario/dueño: **Gabriel Julca Salazar** (admin). Idioma de trabajo: español.
- **En esta tanda de sesiones** se reconstruyó por completo el **rol Ingeniero** (módulo `src/components/jx-mi-frente.jsx`) y se sentó la base del **respaldo de archivos en la nube**.
- **Estado**: todo lo del Ingeniero está **DESPLEGADO en producción** (último commit `53933f8`). Build limpio, **239 tests** verdes (`TMPDIR=/var/tmp npm run test:unit`).
- **Lo único en pausa**: conectar el **respaldo a OneDrive vía n8n**. Está esperando que Gabriel conecte 2 credenciales en n8n (ver §6). Esa es **la próxima tarea**.

---

## 1. OBJETIVO GLOBAL
Dar al **rol Ingeniero** máxima versatilidad para gestionar su(s) frente(s) de obra **sin ver información monetaria**, y respaldar de forma estructurada en la nube la información delicada (reportes diarios + fotos, evidencias de movimientos de insumos, facturas, documentos), organizada **por obra**.

El modelo del Ingeniero cambió de "todo atado a un frente" a **"reporte libre + trazabilidad por color + partidas/insumos navegables por alcance"**. La aprobación de admin/gerente quedó **solo** para un caso: oficializar una partida huérfana como frente.

---

## 2. CÓMO ESTÁ ARMADO (lo que la próxima sesión necesita saber)

### Archivo central
`src/components/jx-mi-frente.jsx` — TODO el rol Ingeniero. Un componente `MiFrenteShell({ vista })` que renderiza 8 vistas según `vista`, más 2 componentes sueltos (`EmitirAlertaPage`, `AprobacionesReportePage`) y wrappers por página al final (`Object.assign(window, {...})`).

### Las 8 vistas del Ingeniero (todas sin dinero)
| pageId (sidebar/registro) | vista | Qué hace |
|---|---|---|
| `dashboard-tecnico` | dashboard | KPIs + semáforo de rendimiento |
| `mis-partidas` | partidas | **"Partidas del Proyecto"**: 2 pestañas (Mis partidas / Otras partidas), árbol con colores, insumos por partida |
| `cronograma-frente` | cronograma | Gantt scopeado (único lugar con el toggle de alcance) |
| `salidas-frente` | salidas | **"Vinculación de insumos"**: 2 pestañas (Insumos a mis Frentes / Insumos generales) + filtros |
| `reporte-diario` | reporte | Reporte GENERAL del ingeniero (no por frente) |
| `borradores-reporte` | borradores | Lista de borradores (localStorage) por usuario+día |
| `plan-real` | plan | Plan vs Real (metas) |
| `emitir-alerta` | — | Crea una incidencia (componente aparte) |
| `aprobaciones-reporte` | — | **"Aprobación de Frentes"** (solo admin/gerente): partida huérfana → crear frente |

### Helpers/libs propios del Ingeniero
- `src/lib/frente-partidas.js` — `cubre`, `partidasDeFrente(frenteId)`, `frentesDePartida(partidaId)`, `frentesDeUsuario(userId)`. El árbol se infiere por prefijos de `codigo_delfin`.
- `src/lib/partida-arbol.js` — `hijosDirectos(partidas, foco)` → nodos `{code, partida|null, esFolder}`. **OJO: un nodo puede tener `partida` Y `esFolder` (una partida que también es capítulo).**
- `src/lib/mi-frente.js` — `rendimientoPartida(p, avances, hoy)` → `{semaforo: verde/ambar/rojo/sin_dato}` (índice ≥0.95 verde, ≥0.75 ámbar, <0.75 rojo). + `resumenFrente`, `planVsReal`, `rollupMensual`. **6 tests.**
- `src/lib/color-ingeniero.js` — `colorIngeniero(id)` (color HSL determinístico por id), `segmentarAvance(partida, avances)` (barra multicolor por ingeniero). **5 tests.**
- `src/lib/fecha.js` — **zona horaria global**. `hoyLocal()`/`horaLocal()`/`ahoraLocal()` calculan en la TZ configurada (localStorage `jx_timezone`, default `America/Lima`). Reemplaza el `new Date().toISOString().slice(0,10)` (UTC, bug). Expuesto en `window.__fecha`. UI en Configuración → Sistema (`SistemaTab` en jx-admin.jsx). **5 tests.**
- (legacy, **dormido**) `src/lib/solicitudes-reporte.js` — ver §5/§7.

### Patrones para registrar cosas (si hay que agregar una página o tabla)
- **Página nueva**: `src/main.jsx` PAGE_CHUNKS (chunk→import) · `src/jx-app.jsx` mapa de títulos + PAGE_REGISTRY (pageId→{chunk,component}) · `src/components/jx-sidebar.jsx` NAV · `src/components/jx-admin.jsx` `__moduleIdMap` + `__INGENIERO_ITEMS` (si es del ingeniero) + `__canSeeSidebarItem`. Componente expuesto en `window` desde su archivo.
- **Tabla nueva**: migración SQL (espejo de tablas existentes: RLS + columnas `version/sync_status/last_synced_at/idempotency_key/deleted_at/demo`), aplicar vía MCP `apply_migration` a `kztnttgzgkvsgornjfln` · Dexie `db.version(N)` en `src/db/jarvex.db.js` · SyncEngine `src/sync/SyncEngine.js`: TRANSACTIONAL_TABLES (push) + MASTER_TABLES (pull `{tabla, query}`) + `TABLA_TO_MODULO` + `FK_DEPS` · hook en `src/hooks/useOfflineData.js` + registrar en `window.__hooks` (main.jsx).
- **Permisos**: `jx-admin.jsx` PERM_MATRIX (funciones por rol). `frentes_obra`/`frente_partidas` **NO** están en TABLA_TO_MODULO → `canPushTabla` los deja pasar para cualquier rol.

---

## 3. QUÉ SE CONSTRUYÓ Y DESPLEGÓ (esta sesión, en orden)

Commits clave (rama main, ya en Vercel):

1. **`703cbc9` — Reporte libre + alcance + barra multicolor**
   - Toggle "Ver otros frentes" → **"Habilitar otros frentes y partidas"**. Selector del header con Mis/Otros/★Todas (incl. sin frente). `esTodas = verOtros && frenteSelId==='__todas'`.
   - Reporte diario dejó de ser por-frente y **sin aprobación**. `frenteDePartida(pid)` deriva el frente del avance (null si huérfana). responsable_id = el ingeniero. Acumula.
   - `BarraAvance` multicolor por `responsable_id`.

2. **`b90ef82` — "Vinculación de insumos"** (2 pestañas + filtros día/partida). Vincula salida→partida con input+datalist de códigos.

3. **`615713c` — Partida huérfana → crear/oficializar frente** (mig **090** `solicitudes_frente`, Dexie v29). Anti-click sobre partida SIN frente → "Solicitar crear frente". Bandeja **"Aprobación de Frentes"** (admin/gerente): "Crear frente" / "Oficializar como frente pequeño" / "Rechazar". Al crear: `frentes_obra` + `frente_partidas` + `ingeniero_user_id`=solicitante + transfiere `salidas.frente_id` + re-atribuye avances.

4. **`75be71b` — Zona horaria global** (`lib/fecha.js`, ver §2). Corrige el bug de "hoy" en UTC. UI en Configuración → Sistema.

5. **`047c38a` — Reporte Diario general** (no por frente; se oculta el selector en esa vista). Buscador con toggle propio "Mis/Todas". **Día del reporte elegible**; si es pasado, exige **motivo** (queda en la descripción del avance). Borrador por `jx_repdraft_<obra>_<user>_<fecha>`. **Hasta 5 fotos por partida**.

6. **`134e6be` — "Mis Partidas" → "Partidas del Proyecto"**: 2 pestañas (Mis / Otras con selector Todas/por-frente). Quité el toggle global de acá (queda solo en Cronograma). Colores: capítulos ámbar (📁) vs partidas específicas verde (•). Click en Gantt **navega a la partida** en su pestaña (intent `costo` elige pestaña por `misPartidasIds`). `renderNodos(code, depth, parts, mostrarFrente)` parametrizado.

7. **`a584b17` — Gantt**: la **línea de "hoy" siempre se ve** (se incluye hoy en `ganttRango`). Barras: barra clara = plan (color del frente), relleno = % avance (color semáforo).

8. **`53933f8` — Módulo Google Drive** (Node) en `scripts/google-drive/` — ver §6 (camino que **se abandona** a favor de n8n→OneDrive, pero el código queda).

### También de esta tanda (antes de los de arriba)
- `d0e9e38` — Super admin puede **editar el frente de un movimiento histórico** (materiales, herramientas, emergencia) con modal compartido `EditarFrenteMovModal` en `jx-movimientos.jsx`. **Pendiente**: EPP (no tiene tabla de movimientos) y maquinaria.
- Migraciones del rol: **085** (`frentes_obra.ingeniero_user_id`), **086** (`avance_obra.descripcion`+`frente_id`), **087** (`avance_metas`), **088** (`solicitudes_reporte`, hoy **legacy**), **089** (fix RLS delete dueño), **090** (`solicitudes_frente`). Dexie llega a **v29**.

---

## 4. MODELO ACTUAL — INVARIANTES (no romper)
- **El reporte diario es del INGENIERO, no del frente.** Es uno solo por día. El selector de frente NO aplica en la vista reporte (está oculto). El buscador del reporte tiene su propio toggle `repTodas` (Mis/Todas).
- **Reportar es libre**: cualquier partida (propia / de otro frente / sin frente). El avance acumula y se atribuye por color a `responsable_id`. NO hay aprobación por reporte.
- **La aprobación admin/gerente existe SOLO para `solicitudes_frente`** (oficializar partida huérfana como frente).
- `partidasDelFrente` = el conjunto activo según alcance (todas si `esTodas`, o las del frente). Usado por dashboard/salidas/plan/cronograma. La vista **partidas** usa su propio `misPartidas`/`otrasPartidas` (pestañas), NO `partidasDelFrente`.
- **Regla de hooks**: TODOS los `useState/useMemo/useEffect/useRef` van **antes** de cualquier early return. (Ver §5.)

---

## 5. ERRORES QUE COMETIMOS — NO REPETIR

1. **React #310 (el más importante).** Causa: 2 `useMemo` (ganttPartidas/ganttRango) quedaron **después** de los early returns (`if (!obraId) return`, `if (misFrentes.length===0) return`). El ingeniero aterriza en una página que renderiza con data async vacía → early return (menos hooks) → luego data carga → render completo (más hooks) → #310. **Lección: en jx-mi-frente.jsx TODOS los hooks van arriba, antes de cualquier return. Es sólo orden de hooks, no es específico del rol.** (fix `d155302`.)

2. **Error de sync "RLS" al cancelar solicitud.** Apareció un "1 con error · Avance" al cancelar. Diagnóstico fino: el SyncEngine pushea los borrados como **UPDATE deleted_at** (no DELETE real), cubierto por la política UPDATE `(true)/(true)`. El 42501 del incidente fue **muy probablemente sesión expirada/transitorio**. Igual dejamos la política DELETE correcta para el dueño (mig **089**). **Lección: las FAILED-RLS no se reintentan solas (`_last_error_is_rls=true`); hay que usar "Reintentar fallidos". Y un borrado viaja como UPDATE, no como DELETE.**

3. **Service Account de Google Drive NO sube a Drive personal.** `credenciales.json` es service account; crear carpetas y listar funciona, pero subir archivos da *"Service Accounts do not have storage quota..."*. **Lección: para Drive personal hay que usar OAuth de usuario o un Shared Drive (Workspace). Por eso pivoteamos a n8n→OneDrive (ver §6).** (Comprobado en vivo.)

4. **Error de sintaxis JSX por un `)}` huérfano** al reemplazar una vista grande (quedó el cierre del wrapper viejo + el nuevo). **Lección: al reescribir un bloque `{vista === 'x' && (...)}` por un IIFE `(() => {...})()`, asegurarse de remover el `)}` del wrapper anterior. El build de Vite da `Unexpected token. Did you mean '{'}'}'` con el archivo:línea — ir directo ahí.**

5. **Imports/efectos muertos tras refactors.** Quedaron `EviThumb`/`getEvidenciaSrc`/`solicitudes-reporte` sin uso. Build no falla, pero confunde. **Lección: limpiar imports al sacar un flujo.**

6. **localStorage no existe en los tests (entorno node).** Un test de `fecha.js` falló por asumir persistencia. **Lección: en tests, no depender de localStorage; sólo verificar que getTZ/setTZ no lancen.**

**Disciplina que funcionó (seguir igual):** build + `test:unit` después de cada tanda; commit + push por feature; `TMPDIR=/var/tmp` en npm build/test (si no, falla por permisos de tmp).

---

## 6. PRÓXIMA TAREA — RESPALDO A ONEDRIVE VÍA n8n (lo que sigue)

**Decisión tomada con Gabriel:** destino **OneDrive** (paga 1 TB), respaldar **TODO** (reportes+fotos, evidencias de movimientos, facturas, documentos), estructura por obra. **Herramienta: n8n** (lo más fácil: maneja el OAuth en su UI y evita el problema de cuota del service account). **El módulo `scripts/google-drive/` queda como referencia pero NO es el camino elegido.**

### Hechos de Supabase (ya verificados) que usa el workflow
- Los archivos están en **Supabase Storage**, bucket **`evidencias`** (PRIVADO).
- Path en el bucket: **`{obra_id}/{YYYY_MM}/{evidenciaId}.{ext}`**. Se obtiene de `url_archivo` (helper `pathDeEvidencia` en `src/lib/evidencias-url.js`).
- Metadata en tabla **`evidencias`**: `id, obra_id, tipo_evidencia, modulo_relacionado, registro_relacionado_id, nombre_archivo, url_archivo, mime_type, tamano_bytes, fecha, observaciones, created_by, deleted_at`.
- **Reportes, evidencias de movimientos y facturas pasan TODOS por la tabla `evidencias`** → mirroreando esa tabla se cubre todo. (Las fotos de avance del reporte: `tipo_evidencia='foto_avance'`, `modulo_relacionado='avance_obra'`.)
- Para descargar desde n8n: Storage REST `GET {SUPABASE_URL}/storage/v1/object/evidencias/{path}` con `Authorization: Bearer <service_role>` (o signed URL). DB vía nodo Supabase o PostgREST con el service_role key (bypassa RLS).

### Diseño del workflow (n8n, polling cada ~10 min)
1. Schedule trigger.
2. Query `evidencias` donde `respaldado_onedrive = false` AND `deleted_at IS NULL` AND `url_archivo` no nulo (lookup del nombre de obra).
3. Por cada fila: descargar del Storage → subir a OneDrive en:
   ```
   JARVEX/<Obra>/
     Reportes Diarios/<fecha>/<ingeniero>/   (modulo_relacionado='avance_obra')
     Evidencias de Movimientos/               (movimientos_*)
     Facturas/                                (factura)
     Documentos/                              (resto)
   ```
4. UPDATE de la fila: `respaldado_onedrive = true` (+ opcional id/url de OneDrive).

### BLOQUEO actual — Gabriel debe conectar 2 credenciales en n8n
Su n8n (proyecto `FQTukYHHwIZexLf3`, "Gabriel Julca <xnova5515@gmail.com>") **NO tiene OneDrive ni Supabase**. Falta:
1. **Microsoft OneDrive** (OAuth) — login con la cuenta del 1 TB.
2. **Supabase** — host `https://kztnttgzgkvsgornjfln.supabase.co` + **service_role key** (Supabase → Project Settings → API). Es secreta: la pega él en n8n, **no se maneja en el chat**.
- _Dato:_ en n8n **Google Drive YA está conectado** (cred `X3IdXMWLcajyOyIO`). Si OneDrive complica, se puede arrancar con Drive sin conectar nada (15 GB vs 1 TB).

### Lo que hace la próxima sesión apenas estén las credenciales
1. Agregar columna **`respaldado_onedrive boolean default false`** en `evidencias` (migración 091, aditiva).
2. Construir + probar el workflow en n8n (vía MCP `n8n-oficial`). Hay tools de n8n cargadas (search_nodes, get_node_types, create_workflow_from_code, validate_workflow, etc.). **Seguir el protocolo del MCP n8n: get_sdk_reference → get_suggested_nodes → search_nodes → get_node_types → escribir → validate → create.**

---

## 7. FUERA DE ALCANCE / NO TOCAR (para no irse por las ramas)
- **Flujo viejo de "reporte de frente ajeno con aprobación"** (migs 088 `solicitudes_reporte`, `lib/solicitudes-reporte.js`, sus 8 tests): **DORMIDO/legacy.** Se reemplazó por el reporte libre. NO reactivar ni construir encima. La página `aprobaciones-reporte` se **reconvirtió** a "Aprobación de Frentes" (usa `solicitudes_frente`, no `solicitudes_reporte`).
- **Módulo `scripts/google-drive/` (service account/OAuth):** referencia, no es el camino. El respaldo va por **n8n→OneDrive**.
- No re-armar el rol Ingeniero: está terminado y desplegado. Sólo mejoras si Gabriel las pide.

---

## 8. PENDIENTES (cuando Gabriel quiera)
- **[próximo]** n8n → OneDrive (§6) — esperando las 2 credenciales.
- Editar frente de movimientos en **EPP** (requiere crearle una vista de movimientos) y **maquinaria** (custodia).
- **Rollout de la zona horaria** (`lib/fecha.js` / `window.__fecha.hoyLocal()`) al resto de módulos que aún usan `new Date().toISOString().slice(0,10)` (asistencia, movimientos).
- El **-3 de stock**: Gabriel corre Materiales → "Recalcular stocks".

---

## 9. COMANDOS ÚTILES
```bash
cd "/Users/macbookpro/Desktop/Nova/ClaudeCode/Empresa IA/JARVEX/jarvex-app"
TMPDIR=/var/tmp npm run build         # build prod (Vite/rolldown)
TMPDIR=/var/tmp npm run test:unit     # 239 tests (vitest)
git add -A && git commit -m "..." && git push origin main   # deploy a Vercel
node scripts/google-drive/drive-cli.js whoami               # (módulo Drive, referencia)
```
- **Migraciones**: MCP Supabase `apply_migration` a `kztnttgzgkvsgornjfln` (+ guardar el .sql en `supabase/migrations/`).
- **Secretos NUNCA al repo**: `credenciales.json`, `oauth-client.json`, `.drive-config.json`, service_role key → ya en `.gitignore`.
