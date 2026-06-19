# Almacén — Eliminar unificado + guard de stock negativo + solicitudes + frente en salidas

**Fecha:** 2026-06-19
**Estado:** Diseño — pendiente de revisión de Gabriel. Decisiones de fondo ya cerradas por él.

Bundle URGENTE del track de almacén. Cuatro piezas, con el orden de riesgo de mayor a menor:
- **M1** Unificar **Eliminar + Reversar** en un solo **"Eliminar Movimiento"** que ajusta el stock real
  y revierte la imputación a partida.
- **M2** **Guard de stock negativo a futuro** (por almacén) que bloquea el borrado peligroso.
- **M3** **Solicitudes del almacenero** (editar/eliminar con justificación → aprueba admin), reusando
  `change_requests`.
- **S1** **Campo "frente" (opcional)** en las salidas.

**Alcance:** los 5 tipos de movimiento — `movimientos_materiales`, `_herramientas`, `_epp`,
`_maquinaria`, `_insumos_emergencia`. El **guard de stock negativo aplica solo donde hay stock por
cantidad** (materiales, herramientas, EPP, emergencia); **maquinaria es serializada** (activos por
placa, sin `stock_actual` ni desglose) → frente sí, guard no.

---

## Decisiones cerradas (Gabriel)

- Una sola acción **"Eliminar"** que ajusta stock; se quita el botón **Reversar**.
- Guard de stock negativo **por almacén** (`ubicacion_id`); por-almacén ya cubre el total.
- **Admin** elimina/edita directo; **almacenero** genera **solicitud** con justificación → admin
  aprueba/rechaza.
- Frente en salidas **opcional** en este pase.
- Alcance a los 5 tipos de insumo.

## Hallazgos clave del estado actual (verificados)

- **`stock_actual` está MATERIALIZADO** en el catálogo (materiales/herramientas/epps/emergencia) y se
  actualiza por movimiento (jx-almacen.jsx:1525). El flujo normal **permite negativos** (no clampa).
- **Por almacén:** `stock_ubicaciones` (`item_tipo,item_id,ubicacion_id → cantidad`), vía
  `aplicarDelta` (stock-ubicaciones.js:60, **clampa a 0**). `item_tipo` ∈
  material|herramienta|epp|insumo_emergencia (**no** maquinaria).
- **Los 5 movimientos llevan `ubicacion_id`** (origen): mat/herr/epp por mig 056, emergencia nativo.
  Necesario para el guard por almacén.
- **`recalcularStocks`** (jx-almacen.jsx:706) suma entrada−salida por material, **excluye reversados**
  y **clampa a 0**; no es cronológico por fecha (no detecta negativos a futuro hoy).
- **Borrado/Reversa actual, por tipo (desparejo):**
  - materiales/herramientas: `handleDeleteMov` = soft-delete **sin** ajustar stock + `handleReverso*`
    = movimiento inverso que sí ajusta (par `reverses_id`/`reversed_by_id`). Ambos solo `admin`.
  - emergencia: `eliminarMov` **sí** ajusta stock al borrar (comportamiento opuesto). Sin reversar.
  - EPP: **no hay** borrado de movimiento (solo del catálogo). Movimientos inmutables.
  - maquinaria: `borrarHistorial` solo **superAdmin**, con lógica especial (resta `hm_acumuladas`,
    limpia custodia). Sin reversar.
- **BUG (lo arregla M1):** al hacer `deleted_at` en una salida con `partida_id`, **nadie llama**
  `revertirConsumoPartida` → `partidas.costo_real_acumulado` + `insumos_partida.cantidad_real_usada`
  quedan inflados (partida-allocation.js; gap en jx-solicitudes applyChange).
- **`change_requests` YA existe y ejecuta al aprobar:** `createChangeRequest({table,recordId,
  recordLabel,proposedChanges,reason})`, `approveChangeRequest(id,comment,applyChange)` (aprobar =
  ejecutar el callback), `RequestChangeModal({table,record,recordLabel,fields,allowDelete})` con
  pestañas editar (elige campo) y eliminar (`proposed_changes={deleted_at:{old:null,new:ISO}}`).
  Cola offline `change_requests_pending`. Hay un hook especial para `partida_id` en materiales.
- **Ningún movimiento tiene `frente_id`** hoy (en ninguna de las 5 tablas).
- **Picker de frentes:** `window.__hooks.useFrentesObra(obraId)` + `SearchableSelect`, ubicado tras
  "Almacén de origen" en cada modal de salida.

## Migración `083_frente_id_movimientos.sql`

`ALTER TABLE ADD COLUMN IF NOT EXISTS frente_id uuid` en las **5** tablas de movimiento
(`movimientos_materiales`, `_herramientas`, `_epp`, `_maquinaria`, `_insumos_emergencia`).
Índice parcial `(obra_id, frente_id) WHERE frente_id IS NOT NULL` en cada una. `NOTIFY pgrst`.
**Dexie:** `frente_id` es campo **no indexado** → no se cambia el store ni se bumpea versión
(igual que `asistencia.frente_id_snapshot`); el sync lo incluye solo (push lee el record, pull
`select('*')`).

## M2 — Guard de stock negativo (helper PURO, lo más testeado)

`src/lib/stock-guard.js`:

```js
// Delta con signo de un movimiento sobre SU almacén (ubicacion_id).
export function deltaPorAlmacen(mov) {
  const c = Number(mov.cantidad) || 0;
  switch (mov.tipo_movimiento) {
    case 'entrada': case 'devolucion': return  c;
    case 'salida':  case 'merma':      return -c;
    default:                            return  0; // ajuste/reverso no mueven cantidad neta
  }
}

// Reconstruye el saldo CRONOLÓGICO del (item, almacén) aplicando un CAMBIO al
// movimiento `movId`: nuevoDelta=0 ⇒ borrado; nuevoDelta=<número con signo> ⇒
// edición de cantidad/tipo (reemplaza su contribución). Verifica que ningún
// prefijo quede negativo. movimientos: filas del MISMO tipo, item y ubicacion_id.
export function simularCambio({ movimientos, movId, nuevoDelta = 0 }) {
  const vivos = movimientos
    .filter(m => !m.deleted_at && !m.reverses_id && !m.reversed_by_id)
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))
      || String(a.created_at || '').localeCompare(String(b.created_at || '')));
  let saldo = 0, min = 0, fechaViol = null;
  for (const m of vivos) {
    const d = m.id === movId ? Number(nuevoDelta) : deltaPorAlmacen(m);
    saldo += d;
    if (saldo < min) { min = saldo; fechaViol = m.fecha; }
  }
  return { seguro: min >= 0, minSaldo: min, fechaViolacion: fechaViol };
}
// Borrado = cambiar la contribución del movimiento a 0.
export const simularBorrado = ({ movimientos, movId }) =>
  simularCambio({ movimientos, movId, nuevoDelta: 0 });
```

- El componente arma `movimientos` = todos los del item en ese `ubicacion_id` (de la tabla del tipo)
  y llama `simularBorrado`. Si `!seguro` → bloquea con mensaje claro
  (*"No se puede borrar: dejaría el stock de {item} en {Almacén} negativo el {fecha}."*).
- Aplica a materiales/herramientas/epp/emergencia. **Maquinaria se exime** (serializada).
- Bloqueo duro para todos (incluido admin): para borrar, primero hay que borrar los movimientos
  posteriores que dependen. (Sin override en v1.)

## M1 — Eliminar unificado (ajusta stock + revierte partida)

Helper compartido `eliminarMovimiento({ tabla, mov, ... })` (lógica común, por componente):

1. **Guard** (M2) para los tipos con cantidad. Si `!seguro` → abortar con toast.
2. **Ajustar stock**: aplicar el **inverso** del movimiento:
   - `stock_actual` global del catálogo: `+= -deltaStock(mov)` (reusa `deltaStockMaterial`/equivalente).
   - `stock_ubicaciones`: `aplicarDelta(..., delta: -deltaPorAlmacen(mov))` en el `ubicacion_id`.
   - herramientas: revertir además `disponible`/`estado_actual`/`ubicacion_actual` (lógica que hoy
     vive en `handleReversoHerramienta`).
   - maquinaria: conservar su lógica especial (restar `hm_acumuladas`, limpiar custodia).
3. **Revertir imputación a partida** (arregla el bug): si `mov.tipo_movimiento==='salida'` y
   `mov.partida_id` → `revertirConsumoPartida({ mov, partida_id: mov.partida_id, material, userId })`.
4. **Soft-delete** `mov` (`deleted_at`).
5. **Audit log**.
- **Quitar el botón Reversar** de materiales y herramientas; el "Eliminar" pasa a ser el único camino
  y ahora sí ajusta stock. Los pares ya reversados históricos se dejan como están.
- **EPP**: se AGREGA el "Eliminar" a nivel movimiento (hoy no existe), con ajuste de stock + guard.
- **Emergencia**: ya ajusta al borrar; se le agrega el **guard** + la **reversión de partida**.
- **Asegurar** que `recalcularStocks` excluya `deleted_at` (agregar `!m.deleted_at` al filtro si falta)
  para que el materializado y el recalculado coincidan tras un borrado.

## M3 — Solicitudes del almacenero (reusa `change_requests`)

- **Gating:** `isAdmin` → "Eliminar" directo (corre M1+M2). **Almacenero** (`canWrite` no `isAdmin`) →
  ve **"Solicitar cambio"** que abre `RequestChangeModal` con `allowDelete` y los campos editables.
- **Aprobación = ejecución** (ya es así). Extender el `applyChange` de jx-solicitudes para movimientos:
  - **Solicitud de ELIMINAR** (`deleted_at`): correr `eliminarMovimiento` (M1+M2) en vez del simple
    `update({deleted_at})` — esto cierra el bug del consumo de partida también para el flujo de
    solicitudes.
  - **Solicitud de EDITAR**: limitar a campos que **no** mueven stock —
    `fecha`, `documento`/vale, `observaciones`, `responsable_id`, `frente_id`. (Cambiar `cantidad`/
    `tipo` NO se ofrece por solicitud en v1: el almacenero elimina y re-registra. Evita el recálculo
    de stock/costo en edición, que hoy ni siquiera existe.)
- Reusa la cola offline y el panel de Solicitudes existentes.

## M3-bis — Super Admin: editar cantidad con aviso

Solo **Super Admin** puede editar la **cantidad** (y el tipo) de un movimiento — la edición que
mueve stock. Admin regular y almacenero **no** editan cantidad. Al editarla:
1. Calcular el nuevo delta del movimiento (`deltaPorAlmacen` con la nueva cantidad/tipo).
2. **Previsualizar con `simularCambio({ ..., nuevoDelta })`** — **AVISA, no bloquea**: muestra si el
   cambio es seguro o si dejaría el stock de {item} en {Almacén} **negativo el {fecha}**, más
   cualquier otra complicación (movimiento imputado a una partida → su costo se reajustará). El SA
   confirma con conocimiento.
3. Al confirmar: ajustar `stock_actual` + `stock_ubicaciones` por el **delta de la diferencia**
   (nuevo − viejo); si es salida imputada, reajustar la partida (`revertirConsumoPartida` con la
   cantidad vieja + `aplicarConsumoPartida` con la nueva); actualizar el movimiento; audit log.
- Es un **aviso suave** (el SA es la máxima autoridad y asume el cambio), a diferencia del borrado de
  admin que es **bloqueo duro**.

## S1 — Frente (opcional) en las salidas

- Picker `SearchableSelect` de frentes (`useFrentesObra`, solo activos) **tras "Almacén de origen"** en
  los 5 modales de salida (mat ~2456, herr ~4491, epp ~1224, emergencia ~652, maquinaria ~827).
- Persistir `frente_id` en el movimiento creado. **Opcional** (sin validación obligatoria; eso es S2).
- En maquinaria el frente = "frente donde opera".
- (Futuro S2: obligatorio + alerta diferida — necesita F3, fuera de este bundle.)

## Helpers puros + pruebas

- **`src/lib/stock-guard.js`** (`deltaPorAlmacen`, `simularCambio`, `simularBorrado`) — **`src/lib/__tests__/stock-guard.test.js`**:
  - borrar un ingreso del día 13 con consumo posterior el 14 que deja saldo negativo → `seguro:false`,
    `fechaViolacion` correcta (el ejemplo de Gabriel).
  - borrar una salida → siempre seguro (sube el saldo).
  - editar (reducir) la cantidad de un ingreso del que ya se consumió → `seguro:false`; subirla → seguro.
  - cadena sin violación → `seguro:true`.
  - excluye `deleted_at`/reversados; ordena por fecha y `created_at`.
  - `deltaPorAlmacen` por cada `tipo_movimiento`.
- **Build:** `TMPDIR=/var/tmp npm run build`. **Unit:** `TMPDIR=/var/tmp npm run test:unit`.
- **Manual:** el caso 15-bolsas (bloqueo); borrar salida imputada → la partida baja su
  `costo_real_acumulado`; almacenero ve "Solicitar cambio" y no "Eliminar"; frente aparece en las 5
  salidas y sincroniza.

## Archivos

| Acción | Archivo |
|--------|---------|
| Crear | `supabase/migrations/083_frente_id_movimientos.sql` |
| Crear | `src/lib/stock-guard.js` + `src/lib/__tests__/stock-guard.test.js` |
| Crear | `src/lib/eliminar-movimiento.js` (helper `eliminarMovimiento` compartido) |
| Modificar | `src/components/jx-movimientos.jsx` (materiales/herramientas: Eliminar unificado, quitar Reversar, gating admin vs solicitud) |
| Modificar | `src/components/jx-epps.jsx` (agregar Eliminar de movimiento + frente en salida) |
| Modificar | `src/components/jx-insumos-emergencia.jsx` (guard + revertir partida + frente) |
| Modificar | `src/components/jx-activos.jsx` (Eliminar unificado maquinaria + frente; sin guard de cantidad) |
| Modificar | `src/components/jx-almacen.jsx` (frente en modales salida mat/herr; `recalcularStocks` excluye deleted) |
| Modificar | `src/components/jx-solicitudes.jsx` (applyChange: borrado de movimiento corre M1; campos editables) |

## Fuera de alcance (v1)

- Override de admin REGULAR para forzar un borrado que deja negativo (el Super Admin sí puede, con aviso).
- Editar `cantidad`/`tipo` por el almacenero o admin regular (solo Super Admin; el almacenero elimina + re-registra).
- S2 (frente obligatorio + alerta diferida) → necesita F3.
- Recalcular costo de partida ante edición de `precio` (la edición de `cantidad` del Super Admin sí reajusta partida).
