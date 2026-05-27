-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Ubicación (almacén) en los movimientos de inventario
--
-- Las salidas ahora exigen indicar DE QUÉ almacén sale el insumo, y los
-- ingresos a qué almacén llegan. Hasta ahora ese dato solo se reflejaba en
-- `stock_ubicaciones` (el desglose), pero no quedaba en la fila del
-- movimiento. Agregamos `ubicacion_id` (origen en salida / destino en
-- ingreso) para que el movimiento sea auditable por sí mismo.
-- Aditivo y nullable: no rompe los movimientos existentes.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.movimientos_materiales   ADD COLUMN IF NOT EXISTS ubicacion_id UUID;
ALTER TABLE public.movimientos_epp          ADD COLUMN IF NOT EXISTS ubicacion_id UUID;
ALTER TABLE public.movimientos_herramientas ADD COLUMN IF NOT EXISTS ubicacion_id UUID;

NOTIFY pgrst, 'reload schema';
