-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Recepción parcial de facturas
--
-- Hoy: recepcion_status es flag binario que cierra apenas hay 1 ingreso.
-- Una factura por 2000 tubos que llega en 3 tandas (800+800+395)
-- marca 'recibido' en la primera entrega → aviso desaparece → se pierde
-- el seguimiento de los faltantes.
--
-- Cambio: agregar estado 'parcial' intermedio. NUNCA se pasa a 'recibido'
-- automáticamente — solo la almacenera lo decide con observación obligatoria.
-- 'no_aplica' se mantiene (operaciones que no involucran almacén — servicios,
-- alquileres puros, etc).
--
-- Flujo nuevo:
--   pendiente_recepcion (estado inicial al crear factura via Captura Mágica)
--   → parcial            (cuando se registra al menos 1 mov vinculado)
--   → recibido           (cierre manual con observación: completo / parcial /
--                         proveedor adeuda / etc.)
-- ═══════════════════════════════════════════════════════════════════

-- 1) CHECK constraint para el dominio de valores
ALTER TABLE public.accounting_movements
  DROP CONSTRAINT IF EXISTS accounting_movements_recepcion_status_check;

ALTER TABLE public.accounting_movements
  ADD CONSTRAINT accounting_movements_recepcion_status_check
  CHECK (recepcion_status IS NULL OR recepcion_status IN
    ('no_aplica', 'pendiente_recepcion', 'parcial', 'recibido'));

-- 2) Columnas de cierre manual
ALTER TABLE public.accounting_movements
  ADD COLUMN IF NOT EXISTS recepcion_observaciones TEXT NULL,
  ADD COLUMN IF NOT EXISTS recepcion_completada_at TIMESTAMP WITH TIME ZONE NULL,
  ADD COLUMN IF NOT EXISTS recepcion_completada_por UUID NULL
    REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.accounting_movements.recepcion_observaciones IS
  'Texto libre de la almacenera al cerrar la recepción (ej. "Proveedor quedó debiendo 5 unidades").';
COMMENT ON COLUMN public.accounting_movements.recepcion_completada_at IS
  'Cuando la almacenera marcó "entrega completa". NULL = sigue parcial / pendiente.';
COMMENT ON COLUMN public.accounting_movements.recepcion_completada_por IS
  'Usuario que cerró la recepción.';

-- 3) Migración one-shot: facturas con ≥1 mov vinculado pero todavía en
-- 'pendiente_recepcion' pasan a 'parcial' (corrige estado tras agregar
-- la columna accounting_movement_id en la migración 046).
UPDATE public.accounting_movements am
SET recepcion_status = 'parcial'
WHERE am.recepcion_status = 'pendiente_recepcion'
  AND EXISTS (
    SELECT 1 FROM public.movimientos_materiales mm
    WHERE mm.accounting_movement_id = am.id
  );

NOTIFY pgrst, 'reload schema';
