# F1 — Frentes ↔ Partidas + Ingeniero a cargo (fundación)

**Fecha:** 2026-06-19
**Estado:** Diseño aprobado por Gabriel — listo para plan.

Fundación del programa de Gestión de Obra. Define **qué partidas trabaja cada frente** y **quién
es el ingeniero a cargo**. Es la fuente única que consumen: Salidas con frente (punto 2 / track S),
el dashboard del Ingeniero (punto 4 / track O) y **Mano de Obra (productividad HH)** (spec pendiente,
que deja de tener su propia tabla y lee F1).

---

## 1. Objetivo

Un vínculo muchos-a-muchos entre frentes y partidas, asignable a **cualquier nivel de la jerarquía**
(capítulo `02`, subcapítulo `02.01`, ítem `02.01.01.01`), con los hijos incluidos automáticamente,
sin explotar filas. Más el ingeniero a cargo del frente (ya existe el campo).

## 2. Decisiones cerradas (Gabriel)

- **Muchos-a-muchos:** una partida puede pertenecer a varios frentes; un frente trabaja varias
  partidas. El reparto de consumo entre frentes que comparten una partida lo resuelve la lógica de
  Mano de Obra (ya diseñada), no F1.
- **Asignación por NODO, no por hoja:** se marca un nodo del árbol (capítulo/subcapítulo/ítem) y
  todos sus descendientes quedan cubiertos. Se pueden mezclar niveles en un mismo frente.
- **Se guarda el nodo, no se expande:** una asignación = una fila (el nodo). La expansión a las
  partidas hijas se calcula al leer (el capítulo `02` con 998 partidas = 1 fila, no 998).
- **Inclusión automática de futuras:** marcar un capítulo cubre sus partidas actuales y las que se
  agreguen luego bajo ese código, sin re-asignar.
- **Sin doble conteo:** si se marca un capítulo y además un ítem dentro de él, la partida queda
  cubierta una sola vez (de-dup al leer).
- **Ingeniero a cargo:** `frentes_obra.ingeniero_id` **ya existe** y jx-frentes ya lo gestiona
  (form + selector ~línea 200). F1 solo lo reafirma; no se agrega columna.

## 3. Modelo de datos

### Tabla nueva `frente_partidas` (migración `082_frente_partidas.sql`)

Guarda el **nodo asignado**. La clave es `codigo_delfin` (dirección jerárquica canónica), porque un
nodo intermedio puede no tener fila propia en `partidas` (igual que `hijosDirectos` soporta
"intermedios sin fila propia"). `partida_id` queda como referencia opcional cuando el nodo SÍ es una
partida con fila.

```
id                 uuid    PRIMARY KEY DEFAULT gen_random_uuid()
obra_id            uuid    NOT NULL
frente_id          uuid    NOT NULL          -- → frentes_obra.id
codigo_delfin      text    NOT NULL          -- nodo asignado ('02', '02.01', '02.01.01.01')
partida_id         uuid    NULL              -- → partidas.id si el nodo tiene fila propia
nivel              integer NULL              -- profundidad del nodo (segmentos), para la UI
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
- Índice único parcial: `(obra_id, frente_id, codigo_delfin) WHERE deleted_at IS NULL`
  (evita asignar dos veces el mismo nodo al mismo frente).
- Índices de apoyo: `(obra_id, frente_id)` y `(obra_id, codigo_delfin)`.

### Dexie `db.version(26)`

- Store nuevo: `frente_partidas: 'id, obra_id, frente_id, codigo_delfin, deleted_at, sync_status'`.
- No se toca ninguna tabla existente.

## 4. Helpers puros (`src/lib/frente-partidas.js`)

Sin Dexie ni React. Unit-testeables. La expansión usa el **mismo criterio de prefijo por segmentos**
de `partida-arbol.js` (`c === a || c.startsWith(a + '.')`), que evita que `02.1` matchee `02.10`.

```js
// ¿el nodo asignado `a` cubre la partida de código `c`? (ancestro-o-sí-mismo)
export const cubre = (a, c) => {
  if (!a || !c) return false;
  const A = String(a).trim(), C = String(c).trim();
  return C === A || C.startsWith(A + '.');
};

// Partidas cubiertas por un frente (expande los nodos asignados por jerarquía).
// Devuelve TODAS las partidas (filas) bajo los nodos asignados, sin duplicar.
export function partidasDeFrente(frenteId, { frentePartidas = [], partidas = [] }) {
  const codigos = frentePartidas
    .filter(fp => fp.frente_id === frenteId && !fp.deleted_at && fp.codigo_delfin)
    .map(fp => String(fp.codigo_delfin).trim());
  if (!codigos.length) return [];
  return partidas.filter(p =>
    p && !p.deleted_at && p.codigo_delfin &&
    codigos.some(a => cubre(a, String(p.codigo_delfin).trim()))
  );
}

// Frentes que cubren una partida dada (inverso; para "shared partida").
// Devuelve ids de frente, sin duplicar.
export function frentesDePartida(partidaId, { frentePartidas = [], partidas = [] }) {
  const p = partidas.find(x => x.id === partidaId && !x.deleted_at);
  if (!p || !p.codigo_delfin) return [];
  const c = String(p.codigo_delfin).trim();
  const ids = new Set();
  for (const fp of frentePartidas) {
    if (!fp.deleted_at && fp.codigo_delfin && cubre(String(fp.codigo_delfin).trim(), c)) ids.add(fp.frente_id);
  }
  return [...ids];
}
```

Notas:
- `partidasDeFrente` devuelve **todas** las partidas cubiertas (incluidas carpetas intermedias con
  fila). Los consumidores que necesiten solo HOJAS con presupuesto (Mano de Obra, consumo) filtran
  por las que tienen insumos/que no tienen hijos — F1 no impone ese criterio.
- La de-dup es natural: cada partida se evalúa una vez contra el conjunto de nodos.

## 5. UI de asignación (`src/components/jx-frentes.jsx`)

jx-frentes ya hace el CRUD de frentes con `ingeniero_id`. Se agrega, por frente:

- **Acción "Partidas asignadas (N)"** en la fila del frente (N = `partidasDeFrente(...).length`),
  que abre un **modal con el árbol de partidas**.
- **Árbol navegable** reusando `hijosDirectos(partidas, foco)` para bajar capítulo → subcapítulo →
  ítems, con breadcrumb (`cadenaBreadcrumb`). Cada nodo (carpeta u hoja) tiene una **casilla**.
  - Marcar un nodo crea una fila `frente_partidas` (`codigo_delfin` del nodo + `partida_id` si tiene
    fila + `nivel`). Desmarcar = soft-delete de esa fila.
  - Un nodo cuyo **ancestro ya está asignado** se muestra como **"heredado"** (cubierto, casilla
    deshabilitada/atenuada) — no se guarda por separado. Esto se calcula con `cubre`.
  - Se permite mezclar niveles (un capítulo + un ítem suelto de otro capítulo).
- **Contador de cobertura** visible ("N partidas cubiertas") con `partidasDeFrente`.
- **Ingeniero a cargo:** el selector ya existe (~línea 200); reafirmar que liste usuarios con rol
  ingeniero (no bloquear si el rol exacto se decide en O1).
- **Permisos:** la asignación sigue el gating de escritura ya vigente en jx-frentes (admin/gestión);
  no se introduce un permiso nuevo en F1.
- Recarga: el modal escucha `jx_data_changed` para `partidas` y `frente_partidas`.

## 6. Fuera de alcance de F1 (queda para sus piezas)

- **Dashboard del Ingeniero** (O1) y **qué rol exacto** (`ingeniero` vs `ingeniero_residente`) lo ve.
- **Ajuste manual de reparto de horas** (`override_real_hh`) de Mano de Obra — se agrega como
  columna en `frente_partidas` (o tabla aparte) cuando se construya MO.
- **Frente en salidas** (S1) y la **alerta de completar frente** (S2/F3).
- Indexar `personal.frente_id` y el resolver usuario→frente (F2).

## 7. Quién consume F1

| Pieza | Qué lee |
|-------|---------|
| S1/S2 (salidas con frente) | lista de frentes; opcionalmente `partidasDeFrente` para sugerir partida |
| O1 (dashboard ingeniero) | `frentesDePartida` / `partidasDeFrente` para acotar al frente del ingeniero |
| Mano de Obra (pendiente) | `partidasDeFrente` para el reparto de HH; **elimina su tabla propia** |

## 8. Pruebas

**Unit (`src/lib/__tests__/frente-partidas.test.js`):**
- `cubre`: `cubre('02','02.01')` true; `cubre('02.1','02.10')` **false**; `cubre('02','02')` true;
  nulls → false.
- `partidasDeFrente`: asignar capítulo `02` cubre todas las hijas (`02.01`, `02.01.01`, …) y no las de
  `03`; mezcla de niveles (`02` + `03.05.01`) sin duplicar; nodo sin partidas cubiertas → `[]`;
  partidas `deleted_at` excluidas; asignación `deleted_at` excluida; **inclusión de hija "futura"**
  (una partida nueva bajo `02` aparece sin nueva asignación).
- `frentesDePartida`: una partida cubierta por dos frentes (uno por capítulo, otro por ítem) devuelve
  ambos, sin duplicar; partida sin código → `[]`.

**Build:** `TMPDIR=/var/tmp npm run build`. **Unit:** `TMPDIR=/var/tmp npm run test:unit`.

**Manual:** asignar a un frente el capítulo `02` + un ítem suelto; verificar el contador, la cobertura
heredada en el árbol, que el ingeniero quede guardado, y que sincronice a otra PC.

## 9. Archivos

| Acción | Archivo |
|--------|---------|
| Crear | `supabase/migrations/082_frente_partidas.sql` |
| Crear | `src/lib/frente-partidas.js` (`cubre`, `partidasDeFrente`, `frentesDePartida`) |
| Crear | `src/lib/__tests__/frente-partidas.test.js` |
| Modificar | `src/db/jarvex.db.js` (Dexie v26: store `frente_partidas`) |
| Modificar | `src/components/jx-frentes.jsx` (modal de asignación de partidas + contador) |

## 10. Efecto sobre el spec de Mano de Obra

Al construir Mano de Obra, su spec se reescribe para: (a) **eliminar** la tabla `frente_partidas`
propia y leer la de F1; (b) obtener las partidas del frente vía `partidasDeFrente`; (c) mover el
`override_real_hh` a una columna sobre la tabla de F1 (o tabla aparte) en ese momento. El
`asistencia.frente_id_snapshot` de MO sigue válido (es una foto puntual, no el vínculo F1).
