-- 076: trazabilidad factura ↔ movimiento de ingreso.
-- La recepción de Compras Pendientes ahora puede VINCULAR una línea de factura
-- a un movimiento de ingreso YA registrado (sin duplicar stock) además de crear
-- uno nuevo. Para eso todos los movimientos de inventario deben poder guardar la
-- referencia a la factura (accounting_movements.id) y su número de documento.
-- materiales ya tenía ambas columnas; epp tenía documento_asociado; herramientas
-- no tenía ninguna — y el push de una recepción de herramienta con
-- documento_asociado fallaba con PGRST204 ("column not found").
ALTER TABLE public.movimientos_epp          ADD COLUMN IF NOT EXISTS accounting_movement_id uuid;
ALTER TABLE public.movimientos_herramientas ADD COLUMN IF NOT EXISTS accounting_movement_id uuid;
ALTER TABLE public.movimientos_herramientas ADD COLUMN IF NOT EXISTS documento_asociado     text;
-- Índices ligeros para poder listar "todos los movimientos de una factura".
CREATE INDEX IF NOT EXISTS movimientos_epp_acc_mov_idx          ON public.movimientos_epp          (accounting_movement_id) WHERE accounting_movement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS movimientos_herramientas_acc_mov_idx ON public.movimientos_herramientas (accounting_movement_id) WHERE accounting_movement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS movimientos_materiales_acc_mov_idx   ON public.movimientos_materiales   (accounting_movement_id) WHERE accounting_movement_id IS NOT NULL;
