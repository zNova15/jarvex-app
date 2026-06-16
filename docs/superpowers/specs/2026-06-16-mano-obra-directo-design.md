# Control de Consumo — Nivel 3: Mano de Obra (Personal Directo, Productividad HH)

**Fecha:** 2026-06-16
**Estado:** Diseño aprobado por el dueño (Gabriel) — listo para plan de implementación.
**Alcance de este spec:** SOLO la mirada de **personal directo** (productividad en horas-hombre).
La mirada de **subcontratos** (avance + costo por tarea) es un spec aparte, posterior.

---

## 1. Objetivo

Dar al ingeniero/dueño un tablero que detecte cuándo la **mano de obra directa** está
consumiendo **más horas** de las que el **avance físico** justifica, partida por partida,
con el **mismo semáforo** que el tablero de Materiales (Nivel 1). Es una señal de gestión,
no un número de planilla.

Una partida está 🔴 cuando las **horas reales** atribuidas superan las **horas ganadas**
(presupuesto HH × % avance) por encima del umbral, o cuando ya quemó más horas que su
**presupuesto total** de mano de obra.

## 2. Decisiones de diseño (cerradas)

- **Personal directo únicamente.** Se excluye todo trabajador con `personal.subcontratista_id`
  no nulo (esos son de subcontrato, otra mirada).
- **Relación frente↔partida es muchos-a-muchos.** Una partida puede ser trabajada por varios
  frentes; un frente trabaja varias partidas.
- **Reparto AUTOMÁTICO ponderado por HH presupuestada** (no por avance, no por metrado), con
  **ajuste manual** opcional por par (frente, partida). Elegido por el dueño.
  - *Por qué presupuesto y no avance:* ponderar por avance daría peso 0 a una partida en 0%,
    haciéndola **invisible** justo cuando quema horas sin mostrar avance. El peso por presupuesto
    conserva el 100% de las HH reales y mantiene visible el sobreconsumo sin avance.
  - *Límite honesto:* en una partida **compartida** por varios frentes el reparto exacto es una
    **estimación** — el índice es una **bandera**, no un número fino. El ajuste manual corrige
    los casos en disputa.
- **Doble baseline** (igual que Nivel 1): se toma el **peor** estado entre
  (a) consumo vs presupuesto total y (b) índice vs avance. Esto evita falsas alarmas cuando el
  avance se reporta tarde.
- **Foto del frente en la asistencia** (`asistencia.frente_id_snapshot`): la atribución usa el
  frente del trabajador **en la fecha** de la fila, no su frente actual. Verificado en código:
  **no existe** registro histórico de cambios de frente, así que el snapshot al registrar es
  **obligatorio** (no se puede reconstruir).
- **Reusa el patrón de Nivel 1:** helper puro testeable + vista; mismos `UMBRAL`, mismo
  `peor()`, mismo orden peor-primero.

## 3. Fuera de alcance (v1, a propósito)

- Costo en soles de la mano de obra (la asistencia no guarda jornal/pago) → se mide en HH.
- Subcontratos (mirada separada).
- Peso por cargo (1 HH de operario = 1 HH de peón en v1).
- Confirmación/ledger semanal de valor ganado (más preciso pero exige disciplina semanal) → v2.
- Jornada configurable por obra (v1 usa una constante `JORNADA_HORAS = 8`, en un solo lugar).
- Publicación de 🔴 al Centro de Alertas.

## 4. Datos

### 4.1 Existente que se reutiliza (verificado)

| Dato | Fuente | Nota |
|------|--------|------|
| Horas reales | `asistencia.horas_trabajadas` (NUMERIC, suele venir NULL) | fallback `JORNADA_HORAS` |
| Estado del día | `asistencia.estado_asistencia` | `falta`/`permiso`/`descanso` = 0 HH |
| Trabajador | `asistencia.personal_id` → `personal` | |
| Directo vs subcontrato | `personal.subcontratista_id` | NULL = directo (se mide) |
| Frente del trabajador | `personal.frente_id` | solo como **backfill** del snapshot |
| Avance físico | `partidas.porcentaje_avance` (acumulado 0–100) | clamp [0,1] |
| Presupuesto HH | `insumos_partida` con `tipo_insumo='mano_obra'`, `cantidad_presupuestada` | normalizar unidad |
| Unidad del presupuesto | `insumos_partida.unidad` | jornal→×8, hh→×1 |

### 4.2 Artefactos nuevos

**Migración Supabase `082_mano_obra_productividad.sql`:**

1. **Tabla nueva `frente_partidas`** (membresía frente↔partida + override de reparto):
   ```
   id                 uuid    PRIMARY KEY DEFAULT gen_random_uuid()
   obra_id            uuid    NOT NULL
   frente_id          uuid    NOT NULL          -- → frentes_obra.id
   partida_id         uuid    NOT NULL          -- → partidas.id
   override_real_hh   numeric NULL              -- si se setea, fija las HH reales de ese par
   created_by         uuid
   updated_by         uuid
   created_at         timestamptz DEFAULT now()
   updated_at         timestamptz DEFAULT now()
   version            integer DEFAULT 1
   sync_status        text
   idempotency_key    text
   deleted_at         timestamptz NULL
   ```
   - Trigger de `version`/`updated_at` y RLS como las demás tablas de obra.
   - Índice único parcial sugerido: `(obra_id, frente_id, partida_id) WHERE deleted_at IS NULL`.

2. **Columna nueva `asistencia.frente_id_snapshot uuid NULL`** + backfill de una sola vez:
   ```sql
   ALTER TABLE public.asistencia ADD COLUMN IF NOT EXISTS frente_id_snapshot uuid;
   UPDATE public.asistencia a
     SET frente_id_snapshot = p.frente_id
     FROM public.personal p
    WHERE p.id = a.personal_id AND a.frente_id_snapshot IS NULL;
   ```

**Dexie `db.version(26)`:**
- Agregar store `frente_partidas: 'id, obra_id, frente_id, partida_id, deleted_at, sync_status'`.
- `asistencia`: `frente_id_snapshot` es **campo no indexado** → no cambia la declaración del store,
  pero la capa de sync debe incluirlo (no removerlo en `stripLocalFields`).

**Escritura del snapshot:** al crear/editar una fila de `asistencia`, setear
`frente_id_snapshot = personal.frente_id` del trabajador en ese momento (en el flujo de
registro de asistencia). Las filas previas al backfill quedan con el frente actual (aceptable;
ver banner en §6).

## 5. Helper puro: `src/lib/mano-obra-directo.js`

Sin Dexie ni React. Unit-testeable. Reutiliza `UMBRAL`, `RANK`/`peor`, `estadoPorConsumo`,
`estadoPorIndice` de `control-consumo.js` (exportarlos desde ahí si hace falta, o reimplementar
idéntico). Constante local `export const JORNADA_HORAS = 8;`.

### 5.1 Firma

```js
calcularProductividadMO({
  partidas = [],        // filas `partidas`
  insumosPartida = [],  // filas `insumos_partida`
  asistencia = [],      // filas `asistencia`
  personal = [],        // filas `personal`
  frentePartidas = [],  // filas `frente_partidas`
  frentes = [],         // filas `frentes_obra` (para nombres)
  jornadaHoras = JORNADA_HORAS,
}) => ({
  filas,                // por partida, peor-primero
  resumen,              // { rojo, ambar, verde }
  hhTotalReal,          // total HH reales de personal directo
  hhSinAtribuir,        // HH reales que no cayeron en ninguna partida
  pctSinAtribuir,       // hhSinAtribuir / hhTotalReal (0 si total 0)
  frentesSinPartidas,   // [{ frente_id, nombre, realHH }] con HH pero sin partidas marcadas
})
```

### 5.2 Cálculo, paso a paso

**A. Normalización de unidad (presupuesto → HH):**
```
factorUnidad(u):
  s = lower(trim(u))
  if s in {hh, hora, horas, h}                          -> 1
  if s in {jornal, jornada, jor, jrn, dia, día, hh-dia} -> jornadaHoras
  else                                                  -> jornadaHoras   // default + (registrar unidad desconocida)
```

**B. `budgetHH(P)`** = Σ sobre `insumos_partida` con `tipo_insumo='mano_obra'`, `partida_id=P`,
`!deleted_at` de `Number(cantidad_presupuestada||0) × factorUnidad(unidad)`.

**C. `earnedHH(P)`** = `budgetHH(P) × clamp(Number(porcentaje_avance||0)/100, 0, 1)`.

**D. HH reales por frente** (`realHHporFrente`): índice `personalById`. Para cada fila de
`asistencia`:
- `p = personalById[row.personal_id]`; si no existe **o** `p.subcontratista_id != null` → **omitir**.
- `hh = (row.estado_asistencia in {falta,permiso,descanso}) ? 0
        : (row.horas_trabajadas != null && Number(row.horas_trabajadas) > 0
             ? Number(row.horas_trabajadas) : jornadaHoras)`
  (usar chequeo explícito `!= null && > 0`, **no** `||`, para no convertir un 0 legítimo en 8).
- `frente = row.frente_id_snapshot ?? p.frente_id ?? null`.
- acumular `realHHporFrente[frente] += hh`; `hhTotalReal += hh`.
- si `frente == null` → esas HH van a `hhSinAtribuir` (bucket "sin frente").

**E. Membresía** desde `frentePartidas` (`!deleted_at`): mapa `frente → [{ partida_id, override_real_hh }]`.

**F. Prorrateo: HH reales por partida** (`realHHporPartida`). Para cada frente `F` con
`realHHporFrente[F] > 0`:
- `asignadas = membresía[F]`.
- si `asignadas` está vacío → sumar `realHHporFrente[F]` a `hhSinAtribuir`; push a
  `frentesSinPartidas`; continuar.
- separar `conOverride` (override_real_hh != null) de `sinOverride`.
  - cada par con override aporta su `override_real_hh` a `realHHporPartida[partida_id]`.
  - `residual = max(0, realHHporFrente[F] − Σ override_real_hh)`.
  - `denom = Σ budgetHH(partida_id)` sobre `sinOverride`.
  - si `denom > 0` → para cada par sin override: `realHHporPartida[P] += residual × budgetHH(P)/denom`.
  - si `denom == 0` y hay pares sin override → reparto **equitativo**: `residual / n` a cada uno
    (y el frente se considera "sin presupuesto MO para prorratear").
  - si no hay pares sin override → el residual queda en `hhSinAtribuir` (todo fue override).

**G. Estado por partida** (mismo doble baseline que Nivel 1):
- `bHH = budgetHH(P)`, `rHH = realHHporPartida[P]||0`, `eHH = earnedHH(P)`, `avance = clamp(...)`.
- si `bHH <= 0` → `{ estado:'sin_presupuesto', pctConsumo:null, indice:null }` (rank 0, gris).
- si no:
  - `pctConsumo = rHH / bHH`.
  - `indice = (avance > 0 && eHH > 0) ? rHH / eHH : null`.
  - `estado = peor(estadoPorConsumo(pctConsumo), estadoPorIndice(indice))`.

  *Nota:* no se fuerza rojo cuando `eHH==0 & rHH>0`; el baseline de consumo
  (`rHH/bHH > 1.00 → rojo`) ya atrapa la quema real, y el resto se mantiene calmo igual que
  Nivel 1 cuando el avance simplemente no se reportó todavía. (Decisión consciente, coherente
  con Materiales.)

**H. Fila por partida:**
`{ partida, estado, avance, budgetHH, realHH, earnedHH, pctConsumo, indice, frentes }` donde
`frentes` = lista de `{ frente_id, nombre, hh }` que aportaron a esa partida (para el drill-down).

**I. Orden** peor-primero: `RANK[b.estado] - RANK[a.estado] || (b.indice||0) - (a.indice||0)`.

**J. `resumen`** = conteo de filas por estado (rojo/ambar/verde). `pctSinAtribuir = hhTotalReal>0 ? hhSinAtribuir/hhTotalReal : 0`.

### 5.3 Casos borde cubiertos (tests obligatorios)

| Caso | Resultado esperado |
|------|--------------------|
| S1 partida compartida (X por A y B) | reparto por presupuesto; índice es bandera (puede salir alto); 🔴 direccionalmente correcto |
| S2 quema sin avance (W: 60 real / 40 budget / 0% avance) | `pctConsumo=1.5 → 🔴` por baseline de consumo |
| S3 reasignación de frente | atribución por `frente_id_snapshot`, no por frente actual |
| S4 horas NULL | fallback `JORNADA_HORAS`; `0` legítimo se respeta (chequeo `!=null && >0`) |
| S5 unidad jornal | `×JORNADA_HORAS` en `budgetHH` |
| Partida sin presupuesto MO (`budgetHH=0`) | `estado='sin_presupuesto'`, no penaliza, no recibe peso de prorrateo |
| Frente sin partidas marcadas | HH no desaparecen: van a `hhSinAtribuir` + `frentesSinPartidas` |
| Trabajador subcontrato | filtrado por `subcontratista_id != null` |
| Trabajador sin frente (`snapshot` y `frente_id` NULL) | HH al bucket "sin frente" → `hhSinAtribuir` |
| `avance > 100` | `clamp` a 1 antes de `earnedHH` |
| Override en un par | fija HH de ese par; el residual del frente se reparte entre los demás |

## 6. UI: `src/components/jx-control-consumo.jsx`

Convertir la página en **dos pestañas**: `[ Materiales | Mano de Obra ]`.
- **Materiales** = el contenido actual (sin cambios funcionales).
- **Mano de Obra** = nueva, alimentada por `calcularProductividadMO`.

Pestaña Mano de Obra:
- **Cabecera/resumen:** `N sobreconsumo · N atención · N en línea` (igual que Materiales).
- **Banner de HH sin atribuir:** si `pctSinAtribuir > 0.10` (o hay `frentesSinPartidas`), mostrar
  aviso ámbar: *"N frentes sin partidas marcadas — el índice subestima el consumo"* con el detalle
  de esos frentes y sus HH. (Evita el fallo silencioso más peligroso del modelo barato.)
- **Banner de datos previos:** una sola vez / discreto: *"Las asistencias previas a esta función
  pueden estar atribuidas al frente actual del trabajador."*
- **Filtros** (reusar barra de Materiales): buscar partida, por estado, por capítulo (`codigo_delfin`),
  y filtro por **frente**.
- **Lista por partida** (primaria), columnas:
  `Partida | Presup. HH | Reales HH | Ganadas HH | % vs presup. | Índice vs avance | Estado`.
  Borde izquierdo con color del estado; orden peor-primero. Expandible → tabla de **frentes** que
  aportaron HH a esa partida (`frente · HH · % del total`).
- **Configurar frentes:** botón que abre un modal/checklist para marcar qué partidas trabaja cada
  frente (CRUD sobre `frente_partidas`) y, opcionalmente, fijar el `override_real_hh` de un par.
  (Único dato manual nuevo; de baja frecuencia.)

`ControlConsumoPage` ya está registrada (PAGE_CHUNKS / PAGE_REGISTRY / sidebar / `__moduleIdMap`);
**no se agrega ruta nueva** — la pestaña MO vive dentro de la misma página. Carga adicional vía
`window.__db`: `asistencia`, `personal`, `frente_partidas`, `frentes_obra` (las dos primeras ya
existen). El `useEffect` de recarga debe escuchar también `asistencia` y `frente_partidas` en
`jx_data_changed`.

## 7. Pruebas

- **Unit (`src/lib/__tests__/mano-obra-directo.test.js`):** un test por cada fila de §5.3
  (S1–S5 + bordes), con números concretos. Verificar conservación de HH en el prorrateo
  (lo repartido = lo real del frente), el filtro de subcontrato, el snapshot vs frente actual,
  la normalización de unidad, el clamp de avance, el override y el conteo de `hhSinAtribuir`.
- **Build:** `TMPDIR=/var/tmp npm run build`. **Unit:** `TMPDIR=/var/tmp npm run test:unit`.
- **Manual:** una obra con asistencia + un frente con 2 partidas (una compartida con otro frente);
  verificar reparto, banner de sin-atribuir al desmarcar partidas, override.

## 8. Archivos

| Acción | Archivo |
|--------|---------|
| Crear | `supabase/migrations/082_mano_obra_productividad.sql` |
| Crear | `src/lib/mano-obra-directo.js` |
| Crear | `src/lib/__tests__/mano-obra-directo.test.js` |
| Modificar | `src/db/jarvex.db.js` (Dexie v26: store `frente_partidas`; sync incluye `frente_id_snapshot`) |
| Modificar | `src/components/jx-control-consumo.jsx` (pestañas + pestaña Mano de Obra + modal de configuración) |
| Modificar | flujo de registro de `asistencia` (escribir `frente_id_snapshot`) |
| Posible | `src/lib/control-consumo.js` (exportar `UMBRAL`/`peor`/`estadoPor*` para reuso) |
