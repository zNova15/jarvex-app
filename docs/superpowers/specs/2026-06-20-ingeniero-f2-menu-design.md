# Rol Ingeniero — Incremento 1: F2 (vínculo usuario↔frente) + MENÚ (acotar el rol)

**Fecha:** 2026-06-20
**Estado:** Diseño aprobado por Gabriel — listo para plan.

Primer incremento de la feature "rol Ingeniero". Arregla el problema inmediato (el ingeniero ve casi
toda la app) y crea la fundación que consumen O1/O2/O3: el **vínculo del usuario que loguea con su(s)
frente(s)** y el **menú acotado**. Las piezas O1 (dashboard del frente), O2 (reporte diario) y O3
(plan-vs-real → valorización) son specs posteriores.

## Decisiones cerradas (Gabriel)

- El **"Ingeniero a cargo"** de un frente pasa a ser un **usuario del sistema** (`profiles`), no un
  registro de `personal`.
- Un ingeniero puede tener **varios frentes**.
- El ingeniero ve **solo lo suyo** (se quitan del menú las páginas de obra-completa).
- Si no tiene frente asignado → estado vacío "pedí tu frente al admin".
- Seguridad: scoping del lado del cliente en v1; RLS server-side queda como refuerzo posterior (anotado).

## Alcance de ESTE incremento (límite claro)

- **SÍ:** la columna+UI del vínculo, el helper "mis frentes", y el **acotado del menú** (matriz de
  permisos + landing + estado vacío).
- **NO (queda para O1):** el **data-scoping** de las páginas que le quedan (Avance, Vinculación,
  Cumplimiento) para mostrar solo las partidas/salidas de su frente. En este incremento esas páginas
  siguen siendo de obra; lo que cambia es que el ingeniero ya **no** ve las páginas de obra-completa
  (Materiales/Proveedores/Dashboard Ejecutivo/KPIs/Activos/etc.).

---

## F2 — Vínculo usuario↔frente

### Migración `085_frente_ingeniero_user.sql`
```sql
ALTER TABLE public.frentes_obra ADD COLUMN IF NOT EXISTS ingeniero_user_id uuid;  -- → profiles.id (sin FK estricta, como el resto)
CREATE INDEX IF NOT EXISTS idx_frentes_ing_user ON public.frentes_obra(obra_id, ingeniero_user_id) WHERE ingeniero_user_id IS NOT NULL;
NOTIFY pgrst, 'reload schema';
```
- `ingeniero_user_id` es campo **no indexado** en Dexie → no se bumpea versión; el sync lo incluye
  (push lee el record; pull `select('*')`). El `frentes_obra` ya está en SyncEngine.
- El viejo `ingeniero_id` (personal) **se conserva** como etiqueta histórica; el scoping usa el nuevo
  `ingeniero_user_id`.

### UI en `jx-frentes.jsx`
- El selector **"Ingeniero a cargo"** pasa a listar **usuarios del sistema**: cargar
  `window.__db.profiles` filtrando `rol ∈ {'ingeniero','ingeniero_residente'}` y `activo !== false`,
  ordenado por apellidos/nombres. Guardar en `ingeniero_user_id`.
- La columna "Ingeniero a cargo" de la tabla muestra el nombre del usuario
  (`profilesById.get(f.ingeniero_user_id)`); fallback "—".
- (Se reutiliza el patrón del selector actual; solo cambia la fuente de datos de `personal` →
  `profiles`.)

### Helper resolver (`src/lib/frente-partidas.js`, junto a los de F1)
```js
// Frentes (filas) donde el usuario es el ingeniero a cargo (soporta varios).
export function frentesDeUsuario(userId, { frentes = [] }) {
  if (!userId) return [];
  return frentes.filter(f => f && !f.deleted_at && f.activo !== false && f.ingeniero_user_id === userId);
}
```
Lo consumen MENÚ (landing/estado-vacío) y, después, O1 (data-scoping) y O2.

## MENÚ — Acotar el rol ingeniero

### Matriz de permisos (`jx-admin.jsx`, fila `ingeniero` de `PERM_MATRIX`)
Hoy el ingeniero tiene `'r'` en ~30 módulos (Materiales, Mov. Materiales, Herramientas, Proveedores,
Activos Pesados, KPIs, Dashboard Ejecutivo, Importar, Personal, Asistencia, Ubicaciones, SSOMA…).
Se **achica** la lista `'r'` a lo que necesita para su contexto:

- **`'w'` (igual que hoy):** `Vinculación Salidas`, `Avance`, `Incidencias`, `Evidencias`,
  `Cumplimiento Cronograma`, `Solicitudes Cambio`.
- **`'r'` (acotado):** `Obras`, `Partidas`, `Cronograma`, `Comparativo`, `Centro Alertas`,
  `Búsqueda Global`, `Reportes`.
- **`'x'` (todo lo demás):** Materiales, Mov. Materiales, Herramientas, Mov. Herramientas, Insumos,
  Versiones presupuesto, Personal, Asistencia, Proveedores, Ubicaciones, Requisiciones, Activos
  Pesados, KPIs por Obra, Dashboard Ejecutivo, Importar, Charlas Seguridad, IPERC, EPP, Inspecciones
  SSOMA, Capacitaciones, Mantenimiento, Horas Máquina (+ lo financiero/RRHH/SUNAT que ya era `'x'`).
- El sidebar ya filtra por `window.__canSeeSidebarItem(rol, itemId)` → con la matriz acotada, las
  secciones sin ítems visibles se ocultan solas. **No hay que tocar jx-sidebar.**
- La matriz es **override-able** por el admin (`getEffectivePermMatrix` + localStorage
  `jx_perm_overrides_v1`), así que Gabriel puede ajustar fino después.

### Landing + estado vacío
- **Landing del ingeniero:** su pantalla de inicio pasa a ser **Cumplimiento Cronograma** (la tendrá
  scopeada en O1; por ahora es su home razonable). Ajustar el mapeo rol→página-default (donde se
  resuelve la página inicial del usuario; el plan localiza el punto exacto — `__defaultPageForRol`
  o equivalente). Si ya cae en una página permitida, basta con apuntar a `cumplimiento`.
- **Sin frente:** si `frentesDeUsuario(userId, {frentes}).length === 0`, la home muestra un estado
  vacío claro: *"Todavía no tenés un frente asignado. Pedile al administrador que te asigne uno en
  Frentes de Trabajo."* (componente liviano o banner en la página de inicio del ingeniero).

## Helpers puros + pruebas

- **`frentesDeUsuario`** en `frente-partidas.js` — test en `frente-partidas.test.js`: usuario con 2
  frentes devuelve ambos; excluye `deleted_at`/`activo===false`/otro usuario; `userId` nulo → `[]`.
- **Build:** `TMPDIR=/var/tmp npm run build`. **Unit:** `TMPDIR=/var/tmp npm run test:unit`.
- **Manual:** asignar un usuario ingeniero a 2 frentes en Frentes; loguear como ese usuario →
  el menú está acotado (sin Materiales/Proveedores/Dashboard Ejecutivo) y cae en su home; un ingeniero
  sin frente ve el estado vacío.

## Archivos

| Acción | Archivo |
|--------|---------|
| Crear | `supabase/migrations/085_frente_ingeniero_user.sql` |
| Modificar | `src/lib/frente-partidas.js` (`frentesDeUsuario`) + su test |
| Modificar | `src/components/jx-frentes.jsx` (selector "Ingeniero a cargo" → usuarios; columna muestra usuario) |
| Modificar | `src/components/jx-admin.jsx` (fila `ingeniero` de `PERM_MATRIX` acotada) |
| Modificar | (landing) el punto donde se resuelve la página inicial por rol + estado vacío "sin frente" |

## Fuera de alcance (próximos specs)

- **O1** — dashboard del frente: data-scoping de Avance/Vinculación/Gantt a las partidas/salidas del
  frente (vía `frentesDeUsuario` + `partidasDeFrente` + `frente_id` en movimientos).
- **O2** — reporte diario rico (descripción + metrado + foto en `avance_obra`).
- **O3** — plan-vs-real → valorización mensual.
- **RLS** server-side para que un ingeniero no pueda leer otros frentes vía API.
