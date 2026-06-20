# Rol Ingeniero — Incremento 1 (F2 + MENÚ) — Plan

> Spec: `docs/superpowers/specs/2026-06-20-ingeniero-f2-menu-design.md`. Ejecución inline, commit al final.

### Task 1 — Migración 085 `frentes_obra.ingeniero_user_id`
- [ ] Crear `supabase/migrations/085_frente_ingeniero_user.sql` (ADD COLUMN + índice parcial + NOTIFY); aplicar vía MCP y verificar.

### Task 2 — Helper `frentesDeUsuario` (TDD)
- [ ] Test en `src/lib/__tests__/frente-partidas.test.js`: usuario con 2 frentes → ambos; excluye deleted/activo===false/otro usuario; userId nulo → []. Correr (fail).
- [ ] Implementar `frentesDeUsuario` en `src/lib/frente-partidas.js`. Correr (pass).

### Task 3 — jx-frentes: "Ingeniero a cargo" → usuario del sistema
- [ ] Cargar `window.__db.profiles` (rol ∈ {ingeniero,ingeniero_residente}, activo) → `usuariosIng` + `profilesById`.
- [ ] Form/guardar: usar `ingeniero_user_id` (en vez de/`junto a` ingeniero_id). Selector lista usuarios. Columna muestra `profilesById.get(f.ingeniero_user_id)`.

### Task 4 — jx-admin: acotar la fila `ingeniero` de PERM_MATRIX
- [ ] `'r'` solo en: Obras, Partidas, Cronograma, Comparativo, Centro Alertas, Búsqueda Global, Reportes. `'w'` igual (Vinculación/Avance/Incidencias/Evidencias/Cumplimiento/Solicitudes). Resto `'x'`.

### Task 5 — Landing + estado vacío del ingeniero
- [ ] Localizar el resolver de página inicial por rol; ingeniero → `cumplimiento`. Estado vacío "sin frente" usando `frentesDeUsuario`.

### Task 6 — Verificación
- [ ] `TMPDIR=/var/tmp npm run test:unit` + `build`. Commit.
