-- 139: DESTINO CONTABLE explícito de las facturas (pedido de Gabriel, jul 2026).
-- Las asistentes vinculaban facturas a obras equivocadas por apuro. Ahora la
-- Captura Mágica exige elegir el destino: obra específica / gastos generales /
-- contabilidad neta (otros) / "no sé" — este último queda 'sin_clasificar' y
-- cae a la BANDEJA de la Contadora Jefe (Movimientos Contables), que lo
-- reasigna al destino correcto. Columna aditiva y nullable (los movimientos
-- históricos quedan null = clasificación implícita por obra_id).
ALTER TABLE public.accounting_movements ADD COLUMN IF NOT EXISTS destino_contable text;

ALTER TABLE public.accounting_movements DROP CONSTRAINT IF EXISTS acc_mov_destino_contable_check;
ALTER TABLE public.accounting_movements ADD CONSTRAINT acc_mov_destino_contable_check
  CHECK (destino_contable IS NULL OR destino_contable = ANY (ARRAY['obra','gastos_generales','contabilidad_neta','sin_clasificar']::text[]));

-- Índice parcial para la bandeja (los sin_clasificar son pocos y se consultan seguido).
CREATE INDEX IF NOT EXISTS idx_acc_mov_sin_clasificar ON public.accounting_movements (created_at)
  WHERE destino_contable = 'sin_clasificar' AND deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
