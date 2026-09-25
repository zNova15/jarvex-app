-- ═══════════════════════════════════════════════════════════════════
-- 230 — PRE-ÓRDENES EDITABLES: FECHA POR LÍNEA Y PROVEEDOR EN LA CABECERA
--       (ronda 4, tanda 4.4 de docs/plan-simulador-ordenes.md, 25-set-2026)
--
-- ── EL PROBLEMA ───────────────────────────────────────────────────
-- Desde la 4.3, «Cerrar mes» escribe lo aceptado como requisiciones del plan
-- (pre-órdenes). El flujo del §16.3 dice que ahí se EDITAN antes de emitir:
-- descripción, unidad, cantidad, precio, proveedor y fecha. Tres de esas
-- cosas no tenían dónde guardarse:
--
--   · La FECHA POR LÍNEA. `requisiciones.fecha_necesidad` es una sola para
--     toda la pre-orden, y «Concreto — octubre» puede traer el cemento para
--     el 1 y el acero para el 15. El cronograma de entregas de la 2.3 vive
--     como TEXTO en `observacion` («Entregas — octubre: 10; …»): sirve para
--     leerlo, no para corregirlo.
--   · El PROVEEDOR. El simulador lo dejaba anotado en `requisicion_items.notas`
--     («Proveedor sugerido: X»), línea por línea, y la pantalla lo leía de la
--     primera línea. Lo que se elegía para emitir no se guardaba: cambiar de
--     pestaña lo perdía, y la otra computadora nunca lo veía.
--
-- ── LAS COLUMNAS ──────────────────────────────────────────────────
-- `requisicion_items.fecha_entrega`: cuándo se necesita ESA línea. NULL =
-- la de la cabecera (`requisiciones.fecha_necesidad`), que es lo que vale
-- para todo lo escrito antes de esta migración y para toda requisición que
-- carga el residente a mano.
--
-- `requisiciones.proveedor_id` / `proveedor_nombre`: a quién se le va a
-- emitir. Van los dos porque el catálogo no tiene a todos (el mismo criterio
-- que `ordenes_compra.proveedor_nombre`): un proveedor escrito a mano se
-- guarda solo con el nombre. Sin FK a propósito: el candidato puede ser un
-- proveedor del catálogo o una empresa del grupo (577 candidatos en total).
--
-- Ninguna entra al descuento de `coberturaPrevia()`: lo que evita pedir dos
-- veces es código × cantidad × factor, y eso ya existía.
--
-- La app solo escribe estas columnas cuando alguien EDITA una pre-orden, así
-- que una requisición común no depende de que esta migración esté aplicada.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE requisicion_items
  ADD COLUMN IF NOT EXISTS fecha_entrega date;

ALTER TABLE requisiciones
  ADD COLUMN IF NOT EXISTS proveedor_id uuid,
  ADD COLUMN IF NOT EXISTS proveedor_nombre text;

COMMENT ON COLUMN requisicion_items.fecha_entrega IS
  'Cuándo se necesita esta línea. NULL = la fecha_necesidad de su requisición. La edita el simulador de órdenes (pre-órdenes).';
COMMENT ON COLUMN requisiciones.proveedor_id IS
  'A quién se le va a emitir la orden (proveedores.id o companies.id). Sin FK: puede ser cualquiera de los dos. NULL con proveedor_nombre = escrito a mano.';
COMMENT ON COLUMN requisiciones.proveedor_nombre IS
  'Nombre del proveedor elegido para emitir la orden de esta requisición.';
