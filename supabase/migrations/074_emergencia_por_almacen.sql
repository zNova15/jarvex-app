-- 074: insumos de emergencia por almacén — paridad con mat/epp/herr/maquinaria.
-- El movimiento de emergencia guarda su `ubicacion_id`, el catálogo su ubicación
-- principal, y `stock_ubicaciones` admite item_tipo 'emergencia' (desglose por
-- almacén + traspaso entre almacenes, igual que los demás insumos).
ALTER TABLE public.movimientos_insumos_emergencia ADD COLUMN IF NOT EXISTS ubicacion_id UUID;
ALTER TABLE public.insumos_emergencia ADD COLUMN IF NOT EXISTS ubicacion_id UUID;

ALTER TABLE public.stock_ubicaciones DROP CONSTRAINT IF EXISTS stock_ubicaciones_item_tipo_check;
ALTER TABLE public.stock_ubicaciones ADD CONSTRAINT stock_ubicaciones_item_tipo_check
  CHECK (item_tipo IN ('material','herramienta','epp','maquinaria','emergencia'));

NOTIFY pgrst, 'reload schema';
