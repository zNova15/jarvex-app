-- ═══════════════════════════════════════════════════════════════════
-- 215 — UN BIEN, UN ALTA (tanda 6, 15-set-2026).
--
-- 🔴 NO SE APLICÓ SOLA. Da de baja dos filas del registro de activos fijos,
-- que es un registro contable: la decisión es de Gabriel. Ver el final.
--
-- ── EL HALLAZGO ───────────────────────────────────────────────────
-- Encontrado midiendo para la tanda 6 (el join factura → activo fijo). De los
-- 12 activos vivos, CUATRO son en realidad dos bienes cargados dos veces:
--
--   MARTILLO DEMOLEDOR SDS HEXAGONAL … TOTAL   FE01-617   S/ 584,75
--     f464df99…  creado 07-set 22:03  por a7ea8d85…
--     1d6d3cf7…  creado 09-set 05:35  por effa55f7…
--
--   MARTILLO DEMOLEDOR TOTAL 1700KW            E001-1044  S/ 508,47
--     c2a1095b…  creado 07-set 22:03  por a7ea8d85…
--     cd8ab0c4…  creado 09-set 05:35  por effa55f7…
--
-- Las cuatro filas apuntan a la MISMA línea de la MISMA factura
-- (`accounting_movement_id` + `accounting_item_idx`) y son idénticas campo por
-- campo salvo el id, la fecha de creación y quién las creó. Son dos personas
-- cargando el mismo bien desde dos equipos, con dos días de diferencia.
--
-- ── POR QUÉ IMPORTA ───────────────────────────────────────────────
-- El registro 7.1 declara S/ 1.093,22 de adquisiciones que no existen, y su
-- depreciación se duplica junto con ellas: a la tasa cargada (20%), son
-- S/ 218,64 de depreciación de más en el ejercicio 2026. Eso es gasto
-- deducible inflado, y SUNAT lo repara.
--
-- ── LA CAUSA, Y POR QUÉ VA A VOLVER A PASAR SIN ESTO ──────────────
-- No hay ninguna restricción que impida dos altas sobre la misma línea. Del
-- lado de la app, `candidatosActivo()` recibe `yaCargados` y no vuelve a
-- ofrecer lo que ya está — pero eso es el cliente, y el cliente solo sabe lo
-- que alcanzó a bajar. Las dos PCs de Gabriel cargaron cada una antes de ver
-- lo del otro, que es exactamente el escenario para el que existe una
-- restricción en la base: es el único lugar que ve las dos.
--
-- ── EL ORDEN IMPORTA ──────────────────────────────────────────────
-- El índice no se puede crear con los duplicados vivos. Primero la baja
-- (soft delete, como todo en este repo: no se borra nada de un registro
-- contable), después el índice.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Baja de la fila MÁS NUEVA de cada par. Se conserva la primera: es la que
--    lleva más tiempo en los reportes y la que la contadora ya vio. Los ids
--    van literales a propósito — un DELETE por criterio sobre un registro
--    contable es cómo se borra de más.
update activos_fijos
   set deleted_at = now(), updated_at = now(), version = coalesce(version, 0) + 1
 where id in ('1d6d3cf7-338d-4962-b9ee-d87bfc13b233',
              'cd8ab0c4-c480-4688-9561-4807540e29be')
   and deleted_at is null;

-- 2. Que no vuelva a pasar: una línea de factura no puede tener dos altas
--    vivas. Parcial sobre `deleted_at is null` para que dar de baja y volver
--    a cargar siga siendo posible.
create unique index if not exists activos_fijos_una_alta_por_linea
  on activos_fijos (accounting_movement_id, accounting_item_idx)
  where deleted_at is null and accounting_movement_id is not null;

-- ── COMPROBACIÓN (tiene que devolver 0 filas) ─────────────────────
-- select accounting_movement_id, accounting_item_idx, count(*)
--   from activos_fijos
--  where deleted_at is null and accounting_movement_id is not null
--  group by 1,2 having count(*) > 1;
