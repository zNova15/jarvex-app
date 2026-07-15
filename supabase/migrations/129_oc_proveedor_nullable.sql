-- ═══════════════════════════════════════════════════════════════════
-- 129 — ordenes_compra.proveedor_id NULLABLE.
--
-- En el flujo nuevo la OC nace 'aceptada' desde una solicitud aprobada y el
-- proveedor se asigna DESPUÉS (al confirmar/comprar). Pero 022_compras.sql la
-- creó como `proveedor_id UUID NOT NULL`: el INSERT con proveedor_id=null
-- reventaba 23502 (not_null_violation) → la OC quedaba FAILED y NUNCA
-- sincronizaba (y sus oc_items 23503). El proveedor pasa a ser opcional hasta
-- la confirmación.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE ordenes_compra ALTER COLUMN proveedor_id DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
