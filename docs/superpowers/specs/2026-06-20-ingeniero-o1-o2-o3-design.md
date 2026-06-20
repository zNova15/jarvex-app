# Rol Ingeniero — O1 + O2 + O3: página "Mi Frente"

**Fecha:** 2026-06-20
**Estado:** Diseño (decisiones por defecto, aprobado "vamos con todo"). Construir completo.

Segundo incremento del rol Ingeniero, sobre F2+MENÚ ya hecho. Integra O1 (dashboard del frente),
O2 (reporte diario rico) y O3 (plan-vs-real → valorización) en **una sola página "Mi Frente"** que es
el **home del ingeniero**. Reusa `frentesDeUsuario` (F2), `partidasDeFrente` (F1) y `frente_id` en
movimientos (mig 083).

## Decisiones por defecto

- **Una página "Mi Frente"** (pestañas), no tres páginas sueltas. Es el home del ingeniero.
- **Multi-frente:** si el ingeniero tiene varios frentes, un selector arriba elige el frente activo;
  el resto de la página se scopea a ese frente.
- **Foto en el avance:** opcional (no obligatoria), vía `evidencias` tipo `foto_avance`.
- **Plan (O3):** el ingeniero fija una **meta de metrado** por partida y fecha (tabla nueva
  `avance_metas`). Comparación plan (meta) vs real (avance reportado). El **rollup mensual** de
  metrado real por partida se muestra como **reporte** (pre-llena/sirve de referencia para la
  valorización; NO sobre-escribe `valorizaciones` automáticamente — se evita el riesgo de
  reconciliación).
- **Estado vacío:** si `frentesDeUsuario` = [] → "pedí tu frente al administrador".
- **Scoping:** la página Mi Frente es el hub scopeado. Además se acota la lista de partidas de la
  página **Avance** a las partidas del frente del ingeniero (data-scoping liviano).

## Datos

### Migración `086_avance_obra_reporte.sql`
```sql
ALTER TABLE public.avance_obra ADD COLUMN IF NOT EXISTS descripcion text;   -- narrativa libre del día
ALTER TABLE public.avance_obra ADD COLUMN IF NOT EXISTS frente_id uuid;     -- frente al que pertenece el avance
NOTIFY pgrst, 'reload schema';
```
- No indexados en Dexie → sin bump por estos; el sync los incluye (`select('*')`).

### Migración `087_avance_metas.sql` (plan O3)
Tabla nueva `avance_metas` (espejo de las tablas de obra):
```
id uuid PK, obra_id uuid NOT NULL, frente_id uuid, partida_id uuid NOT NULL,
fecha date NOT NULL, meta_metrado numeric, meta_descripcion text,
created_by uuid, updated_by uuid, created_at/updated_at, version int default 1,
sync_status text, last_synced_at, idempotency_key text, deleted_at, demo boolean default false
```
- Índice `(obra_id, partida_id, fecha)`. RLS estándar (select deleted_at IS NULL; insert/update true;
  delete admin). `NOTIFY pgrst`.
- **Dexie v27:** store `avance_metas: 'id, obra_id, partida_id, fecha, deleted_at, sync_status'`.
- **SyncEngine:** registrar en TRANSACTIONAL_TABLES (tras `avance_obra`), MASTER_TABLES, y FK_DEPS
  (`partida_id`→partidas).

## Helper puro (`src/lib/mi-frente.js`)
- `resumenFrente({ frente, partidas, frentePartidas, movimientos, avances })` → KPIs:
  `nPartidas`, `avancePromedio` (prom. ponderado por presupuesto o simple de `porcentaje_avance`),
  `nSalidas`, `metradoReal` (suma de `avance_obra.metrado_ejecutado`).
- `planVsReal({ partidasDelFrente, metas, avances, fecha|mes })` → por partida:
  `{ partida, metaMetrado, realMetrado, pctAvance, desvio }` (real − meta).
- `rollupMensual({ avances, mes })` → por partida: suma `metrado_ejecutado` del mes.
- Unit-testeable; usa `partidasDeFrente`/`frentesDeUsuario` para el conjunto del frente.

## UI: `src/components/jx-mi-frente.jsx` (`MiFrentePage`)

Página con selector de frente (si varios) + pestañas:

1. **Resumen** — KPIs del frente (partidas, avance %, salidas, metrado real), nombre del frente +
   ingeniero. Estado vacío si no tiene frente.
2. **Mis Partidas** — lista de las partidas del frente (`partidasDeFrente`) con código/nombre,
   `porcentaje_avance`, presupuesto (sin precios si el rol no los ve), y botón **"Reportar avance"**.
3. **Salidas a mi frente** — `movimientos_materiales` con `frente_id ∈ mis frentes` (lo que salió de
   almacén para su frente); fecha, material, cantidad, almacén.
4. **Reporte diario (O2)** — formulario: elegí partida (de las suyas) → **descripción** (texto),
   **metrado avanzado**, **% avance**, **foto** (opcional). Al guardar: upsert en `avance_obra`
   (`fecha`, `partida_id`, `frente_id`, `porcentaje_avance_reportado`, `metrado_ejecutado`,
   `descripcion`, `responsable_id`=usuario) + evidencia `foto_avance` si subió foto.
5. **Plan vs Real (O3)** — (a) fijar **meta de metrado** por partida para una fecha (`avance_metas`);
   (b) tabla `planVsReal` (meta vs real, desvío con color); (c) **rollup mensual** del metrado real
   por partida (referencia para la valorización).

### Registro de la página (4 puntos)
- `main.jsx` PAGE_CHUNKS: `'mi-frente': () => import('./components/jx-mi-frente.jsx')`.
- `jx-app.jsx`: título + PAGE_REGISTRY `{ chunk:'mi-frente', component:'MiFrentePage' }`.
- `jx-sidebar.jsx`: NAV item `{ id:'mi-frente', label:'Mi Frente', icon:'flag' }` en INGENIERÍA.
- `jx-admin.jsx`: `__moduleIdMap['mi-frente'] = null` (utility, visible a todos los que entran; o
  un módulo propio); dar `'w'`/visibilidad al rol ingeniero. **Home del ingeniero → `'mi-frente'`**
  (cambiar `__HOME_POR_ROL.ingeniero` de `'avance'` a `'mi-frente'`).

### Data-scoping liviano de Avance
- En la página **Avance de Obra**, si el usuario es ingeniero (no admin), filtrar el selector de
  partidas a las de sus frentes (`frentesDeUsuario` + `partidasDeFrente`). (Cambio acotado.)

## Pruebas
- **Unit** (`src/lib/__tests__/mi-frente.test.js`): `resumenFrente`, `planVsReal` (meta>real,
  real>meta, sin meta), `rollupMensual` (suma por partida/mes, ignora otros meses/deleted).
- **Build** + **test:unit**.
- **Manual:** loguear como ingeniero con frente → Mi Frente muestra sus partidas/salidas; reportar un
  avance con foto; fijar una meta y ver plan-vs-real; ver el rollup mensual.

## Archivos
| Acción | Archivo |
|--------|---------|
| Crear | `supabase/migrations/086_avance_obra_reporte.sql`, `087_avance_metas.sql` |
| Crear | `src/lib/mi-frente.js` + test |
| Crear | `src/components/jx-mi-frente.jsx` (`MiFrentePage`) |
| Modificar | `src/db/jarvex.db.js` (v27: `avance_metas`) |
| Modificar | `src/sync/SyncEngine.js` (registrar `avance_metas`) |
| Modificar | `src/main.jsx`, `src/jx-app.jsx`, `src/components/jx-sidebar.jsx`, `src/components/jx-admin.jsx` (registro + home + permiso) |
| Modificar | `src/components/` Avance (scoping liviano de partidas por frente) |

## Fuera de alcance
- Auto-escritura de `valorizaciones` desde el rollup (queda como reporte de referencia).
- RLS server-side para el aislamiento por frente (refuerzo posterior).
- Gantt visual embebido (se muestran fechas planificadas en la lista; el Gantt rico ya existe en su
  página).
