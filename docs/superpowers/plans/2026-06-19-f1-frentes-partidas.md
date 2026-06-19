# F1 — Frentes ↔ Partidas: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans.

**Goal:** Vínculo muchos-a-muchos frente↔partida asignable por nodo (capítulo/subcap/ítem), guardado como nodo y expandido al leer, con UI en Frentes de Trabajo.

**Architecture:** Tabla `frente_partidas` (guarda el nodo `codigo_delfin`), helper puro `frente-partidas.js` que expande por prefijo de segmentos (igual que `partida-arbol.js`), UI de asignación en `jx-frentes.jsx`. Reusa `hijosDirectos`/`cadenaBreadcrumb`. `frentes_obra.ingeniero_id` ya existe.

**Tech Stack:** Supabase (mig 082, espejo de 065), Dexie v26, React, Vitest.

Spec: `docs/superpowers/specs/2026-06-19-f1-frentes-partidas-design.md`.

---

### Task 1: Migración 082 `frente_partidas`

**Files:** Create `supabase/migrations/082_frente_partidas.sql`; aplicar vía Supabase MCP (proyecto `kztnttgzgkvsgornjfln`).

- [ ] Crear la tabla espejo de `frentes_obra` (mismas columnas de sync), clave por `codigo_delfin`, `partida_id` nullable, índice único parcial `(obra_id, frente_id, codigo_delfin) WHERE deleted_at IS NULL`, RLS idéntica a 065 (select deleted_at IS NULL; insert/update true; delete admin), `NOTIFY pgrst`.
- [ ] Aplicar con `apply_migration` y verificar con `execute_sql` que la tabla existe.

### Task 2: Dexie v26 store

**Files:** Modify `src/db/jarvex.db.js` (insertar `db.version(26)` sobre v25).

- [ ] `frente_partidas: 'id, obra_id, frente_id, codigo_delfin, deleted_at, sync_status'`.

### Task 3: Helper puro `frente-partidas.js` (TDD)

**Files:** Create `src/lib/frente-partidas.js`; Test `src/lib/__tests__/frente-partidas.test.js`.

- [ ] **Step 1 — test que falla:** `cubre`, `partidasDeFrente`, `frentesDePartida` con los casos del spec §8 (incluido `02.1` no cubre `02.10`, mezcla de niveles sin duplicar, hija futura, deleted excluidos, partida en 2 frentes).
- [ ] **Step 2 — correr y ver fallar:** `TMPDIR=/var/tmp npm run test:unit -- frente-partidas`.
- [ ] **Step 3 — implementar** las 3 funciones puras del spec §4.
- [ ] **Step 4 — correr y ver pasar.**

### Task 4: UI de asignación en `jx-frentes.jsx`

**Files:** Modify `src/components/jx-frentes.jsx`.

- [ ] Cargar `frente_partidas` + `partidas` de la obra; botón "Partidas asignadas (N)" por frente (N = `partidasDeFrente`).
- [ ] Modal con árbol navegable (`hijosDirectos` + breadcrumb), casilla por nodo: marcar = crear fila (`codigo_delfin`+`partida_id`+`nivel`), desmarcar = soft-delete; nodo con ancestro asignado = "heredado" (deshabilitado) vía `cubre`.
- [ ] Contador de cobertura; recarga por `jx_data_changed` (`partidas`/`frente_partidas`).

### Task 5: Build + verificación

- [ ] `TMPDIR=/var/tmp npm run test:unit` (todo verde) y `TMPDIR=/var/tmp npm run build`.
- [ ] Commit.
