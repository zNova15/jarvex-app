# Almacén (M1/M2/M3/M3-bis/S1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Por ETAPAS; cada una
> compila y testea sola. Spec: `docs/superpowers/specs/2026-06-19-almacen-eliminar-guard-solicitudes-frente-design.md`.

**Goal:** Eliminar unificado que ajusta stock + revierte partida, guard de stock negativo por almacén,
solicitudes del almacenero, edición de cantidad del Super Admin con aviso, y frente opcional en las 5 salidas.

**Tech:** Supabase (mig 083), Dexie (sin bump: `frente_id` no indexado), React, Vitest.

---

### Task 1 — Migración 083: `frente_id` en las 5 tablas de movimiento

**Files:** Create `supabase/migrations/083_frente_id_movimientos.sql`; aplicar vía MCP (`kztnttgzgkvsgornjfln`).

- [ ] `ALTER TABLE ADD COLUMN IF NOT EXISTS frente_id uuid` en `movimientos_materiales`,
  `_herramientas`, `_epp`, `_maquinaria`, `_insumos_emergencia` + índice parcial `(obra_id, frente_id)`
  + `NOTIFY pgrst`. Aplicar y verificar con `execute_sql`.

### Task 2 — `stock-guard.js` (TDD, helper PURO de M2)

**Files:** Create `src/lib/stock-guard.js`; Test `src/lib/__tests__/stock-guard.test.js`.

- [ ] Test primero (spec §Helpers): `deltaPorAlmacen` por tipo; `simularCambio` borrado(15 bolsas)→
  inseguro+fecha; salida→seguro; edición reduce→inseguro / sube→seguro; excluye deleted/reversados; orden.
- [ ] Correr y ver fallar; implementar `deltaPorAlmacen`/`simularCambio`/`simularBorrado` (spec §M2);
  correr y ver pasar.

### Task 3 — `eliminar-movimiento.js` (core de M1, compartido)

**Files:** Create `src/lib/eliminar-movimiento.js`.

- [ ] `eliminarMovimiento({ tabla, mov, itemTipo, item, ubicacionId, movimientosDelItem, userId, ajustarCatalogo, revertEstado })`:
  corre guard (si tipo con cantidad) → si inseguro lanza con mensaje; ajusta `stock_actual` (callback
  `ajustarCatalogo(delta)`) + `aplicarDelta(-deltaPorAlmacen)`; si salida con `partida_id` →
  `revertirConsumoPartida`; `revertEstado?.()` (herramientas); soft-delete; `logAudit`. Spec §M1.

### Task 4 — Materiales + Herramientas (jx-movimientos.jsx)

- [ ] Reemplazar `handleDeleteMov`/`handleReversoMaterial` por **un solo "Eliminar"** que llama
  `eliminarMovimiento`; quitar el botón Reversar; gating: `isAdmin`→directo, almacenero→"Solicitar cambio".
  Igual para herramientas (con `revertEstado`).

### Task 5 — EPP / Emergencia / Maquinaria

- [ ] EPP (jx-epps.jsx): agregar "Eliminar" a nivel movimiento usando `eliminarMovimiento` + guard.
- [ ] Emergencia (jx-insumos-emergencia.jsx): agregar guard + `revertirConsumoPartida` al `eliminarMov`.
- [ ] Maquinaria (jx-activos.jsx): unificar label "Eliminar"; conservar lógica especial HM/custodia; sin guard de cantidad.

### Task 6 — Solicitudes (M3) en jx-solicitudes.jsx

- [ ] `applyChange`: cuando la solicitud es borrado de un `movimientos_*`, correr `eliminarMovimiento`
  (no el `update({deleted_at})` pelado). Campos editables por solicitud: `fecha`, documento,
  `observaciones`, `responsable_id`, `frente_id` (no cantidad/tipo).

### Task 7 — Super Admin: editar cantidad con aviso (M3-bis)

- [ ] Solo `superAdmin`: editar cantidad/tipo; preview con `simularCambio(nuevoDelta)` (aviso, no
  bloqueo); al confirmar ajustar stock por la diferencia + reajustar partida + actualizar mov + audit. Spec §M3-bis.

### Task 8 — S1 frente en las 5 salidas + recalc

- [ ] Picker `SearchableSelect` de frentes (`useFrentesObra`) tras "Almacén de origen" en los 5 modales;
  persistir `frente_id`. Asegurar que `recalcularStocks` excluya `!m.deleted_at`.

### Task 9 — Verificación

- [ ] `TMPDIR=/var/tmp npm run test:unit` + `TMPDIR=/var/tmp npm run build`. Commit por etapa.
