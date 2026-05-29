-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Fixes de sync: deleted_at en movimientos + CHECK de alerta
--
-- 1) movimientos_epp / movimientos_herramientas / movimientos_materiales no
--    tenían columna deleted_at. El soft-delete (dedup de duplicados) escribía
--    deleted_at → push fallaba con PGRST204 "Could not find the 'deleted_at'
--    column". Se agrega para soportar soft-delete uniforme.
--
-- 2) materiales_alerta_check solo permitía ('ok','reponer','critico',
--    'sin_stock') pero calcAlerta() produce además 'agotado' y 'cerca'. Cuando
--    el recálculo de stock seteaba esos valores, el UPDATE de materiales
--    fallaba en el server y el stock quedaba en 0. Se amplía el CHECK al
--    vocabulario real de alerta de la app.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.movimientos_epp          ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.movimientos_herramientas ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.movimientos_materiales   ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE public.materiales DROP CONSTRAINT IF EXISTS materiales_alerta_check;
ALTER TABLE public.materiales ADD CONSTRAINT materiales_alerta_check
  CHECK (alerta IS NULL OR alerta = ANY (ARRAY['ok','cerca','reponer','critico','agotado','sin_stock']));

NOTIFY pgrst, 'reload schema';
