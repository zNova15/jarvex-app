-- 078: la recepción de Compras Pendientes ahora también recibe/vincula maquinaria
-- (activos_pesados por cantidad) e insumos de emergencia. Sus movimientos deben
-- poder guardar la referencia a la factura (igual que mig 076 para epp/herr).
ALTER TABLE public.movimientos_maquinaria         ADD COLUMN IF NOT EXISTS accounting_movement_id uuid;
ALTER TABLE public.movimientos_insumos_emergencia ADD COLUMN IF NOT EXISTS accounting_movement_id uuid;
CREATE INDEX IF NOT EXISTS movimientos_maquinaria_acc_mov_idx         ON public.movimientos_maquinaria         (accounting_movement_id) WHERE accounting_movement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS movimientos_insumos_emergencia_acc_mov_idx ON public.movimientos_insumos_emergencia (accounting_movement_id) WHERE accounting_movement_id IS NOT NULL;
