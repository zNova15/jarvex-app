-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Flujo inverso almacén → contabilidad
--
-- Hoy: la contadora siempre sube la factura primero (Captura Mágica)
-- y luego la almacenera valida el ingreso físico. Pero es común que
-- el material llegue antes que la factura — la almacenera no tiene
-- forma de registrar el ingreso inmediatamente.
--
-- Esta migración agrega:
--   1) `pendiente_sustento`: flag para marcar que el ingreso espera
--      su factura (la contadora lo subirá después).
--   2) `accounting_movement_id`: link directo al accounting_movement
--      cuando la factura llega y se vincula al ingreso pre-existente.
--   3) `observaciones_almacen`: texto libre de la almacenera al
--      registrar (ej. "proveedor entregó sin guía, marca XX").
--
-- Flujo nuevo:
--   - Almacén crea mov con `pendiente_sustento=true`, sin factura
--   - Contabilidad ve cola "Ingresos sin sustento"
--   - Contabilidad sube factura via Captura Mágica → la vincula al
--     movimiento existente (UPDATE en vez de INSERT) → `pendiente_sustento`
--     pasa a false y `accounting_movement_id` queda apuntando a la factura
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.movimientos_materiales
  ADD COLUMN IF NOT EXISTS pendiente_sustento BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS accounting_movement_id UUID NULL
    REFERENCES public.accounting_movements(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS observaciones_almacen TEXT NULL;

-- Índice parcial — solo entradas pendientes son interesantes para la
-- cola de contabilidad. Mantiene el índice chico.
-- (movimientos_materiales no usa soft-delete en server; el patrón es
-- reversar con un mov inverso vía reverses_id.)
CREATE INDEX IF NOT EXISTS idx_movimientos_materiales_pendiente_sustento
  ON public.movimientos_materiales (obra_id, pendiente_sustento, fecha)
  WHERE pendiente_sustento = true;

-- Lookup rápido para mostrar "movimientos de esta factura" en el
-- banner de almacén (paquete B).
CREATE INDEX IF NOT EXISTS idx_movimientos_materiales_accounting_movement
  ON public.movimientos_materiales (accounting_movement_id)
  WHERE accounting_movement_id IS NOT NULL;

COMMENT ON COLUMN public.movimientos_materiales.pendiente_sustento IS
  'true = ingreso registrado por almacén sin factura. La contadora lo verá en su cola para subir la factura después.';
COMMENT ON COLUMN public.movimientos_materiales.accounting_movement_id IS
  'Link a la factura (accounting_movement) cuando ya fue sustentada. NULL = sin factura asociada.';
COMMENT ON COLUMN public.movimientos_materiales.observaciones_almacen IS
  'Texto libre de la almacenera al registrar (ej. "sin guía, marca XX").';

NOTIFY pgrst, 'reload schema';
