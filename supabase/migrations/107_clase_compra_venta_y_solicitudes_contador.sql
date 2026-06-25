-- 107: (1) clasificación explícita Compra/Venta en movimientos contables,
--      (2) el Contador Jefe puede aprobar/rechazar solicitudes de cambio.

-- (1) accounting_movements.clase = 'compra' | 'venta' (explícito, elegido al registrar).
-- Backfill por tipo contable: income -> venta (la emitimos), cost/expense -> compra.
ALTER TABLE public.accounting_movements ADD COLUMN IF NOT EXISTS clase text;
UPDATE public.accounting_movements
  SET clase = CASE WHEN type = 'income' THEN 'venta' ELSE 'compra' END
  WHERE clase IS NULL;

-- (2) Permitir que el rol 'contador' (Contador Jefe) apruebe/rechace solicitudes de
--     cambio (UPDATE de change_requests). Política aparte (permisiva, OR con las demás)
--     para no tocar las existentes. El ayudante_contador solo crea (INSERT ya permitido).
DROP POLICY IF EXISTS "change_requests: contador aprueba" ON public.change_requests;
CREATE POLICY "change_requests: contador aprueba" ON public.change_requests
  FOR UPDATE TO public
  USING (has_role(ARRAY['contador'::text]))
  WITH CHECK (has_role(ARRAY['contador'::text]));
