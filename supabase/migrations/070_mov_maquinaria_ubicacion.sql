-- 070: ubicacion_id en movimientos_maquinaria — paridad con mat/epp/herr
-- (mig 056). El loader de migración histórica ya calcula el almacén del
-- movimiento (y alimenta stock_ubicaciones vía aplicarDelta), pero la fila
-- del movimiento no lo guardaba: sin esta columna el push fallaría (PGRST204).

ALTER TABLE public.movimientos_maquinaria ADD COLUMN IF NOT EXISTS ubicacion_id UUID;

NOTIFY pgrst, 'reload schema';
