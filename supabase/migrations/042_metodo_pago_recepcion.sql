-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Método de pago + recepción de almacén
--
-- Mejoras al flujo de captura mágica:
-- 1. Registrar método de pago (efectivo / transferencia / yape / plin
--    / tarjeta) y estado (pagado / pendiente / crédito).
-- 2. Separar contabilidad de almacén: ahora un mov contable puede
--    quedar "pendiente de recepción" para que el almacenero confirme
--    la llegada física antes de generar el movimiento de inventario.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.accounting_movements
  ADD COLUMN IF NOT EXISTS metodo_pago             TEXT,
  ADD COLUMN IF NOT EXISTS recepcion_status        TEXT DEFAULT 'no_aplica',
  ADD COLUMN IF NOT EXISTS recepcion_movimiento_id UUID,
  ADD COLUMN IF NOT EXISTS recepcion_fecha         TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS recepcion_por           UUID;

-- payment_status ya existía (default 'pending'). Documentamos valores
-- canónicos para que la UI los respete:
--   'pagado'    — ya se pagó al proveedor
--   'pendiente' — debemos plata al proveedor
--   'credito'   — el proveedor nos vende a crédito (plazo)
-- Si el server tenía valores legados ('pending', 'paid'), siguen
-- siendo válidos pero las nuevas UI usarán los castellanos.

-- recepcion_status valores canónicos:
--   'no_aplica'           — el comprobante no genera ingreso al almacén
--                           (combustible, servicios, fletes, alquileres)
--   'pendiente_recepcion' — esperando que el almacenero confirme
--   'recibido'            — el almacenero registró el ingreso físico
--   'parcial'             — recibido parcialmente (futuro)

-- FK a movimientos_materiales (cuando se vincula al ingreso real)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'movimientos_materiales')
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                     WHERE table_schema = 'public'
                       AND table_name = 'accounting_movements'
                       AND constraint_name = 'accounting_movements_recepcion_mov_fkey') THEN
    ALTER TABLE public.accounting_movements
      ADD CONSTRAINT accounting_movements_recepcion_mov_fkey
      FOREIGN KEY (recepcion_movimiento_id)
      REFERENCES public.movimientos_materiales(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Índice para la query del almacenero "facturas pendientes en mi obra"
CREATE INDEX IF NOT EXISTS idx_accounting_movements_recepcion_pendiente
  ON public.accounting_movements(obra_id, recepcion_status)
  WHERE recepcion_status = 'pendiente_recepcion';

NOTIFY pgrst, 'reload schema';
