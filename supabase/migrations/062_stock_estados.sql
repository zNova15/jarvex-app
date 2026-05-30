-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Stock por ESTADO/condición (buckets) para herramientas
--
-- Una herramienta que se maneja por cantidad (ej. 3 taladros) puede tener
-- unidades en distintas condiciones: Nuevo / Bueno / En reparación / De
-- baja. Esta tabla subdivide el stock_actual del item por estado. El total
-- por estado nunca supera stock_actual; el resto queda "sin clasificar".
-- Cada bucket puede llevar una foto (foto_evidencia_id) y una nota.
--
-- Genérica vía item_tipo + item_id (hoy 'herramienta', a futuro otros).
-- Mover una unidad de un estado a otro NO cambia el stock total.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.stock_estados (
  id               UUID PRIMARY KEY,
  obra_id          UUID NOT NULL REFERENCES public.obras(id) ON DELETE CASCADE,
  item_tipo        TEXT NOT NULL CHECK (item_tipo IN ('material','herramienta','epp')),
  item_id          UUID NOT NULL,
  estado           TEXT NOT NULL CHECK (estado IN ('nuevo','bueno','reparacion','baja')),
  cantidad         NUMERIC NOT NULL DEFAULT 0,
  foto_evidencia_id UUID,
  notas            TEXT,
  version          INTEGER NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID,
  updated_by       UUID,
  idempotency_key  TEXT,
  last_synced_at   TIMESTAMPTZ,
  deleted_at       TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_estados_item_estado
  ON public.stock_estados (item_tipo, item_id, estado)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_stock_estados_item
  ON public.stock_estados (obra_id, item_tipo, item_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.stock_estados ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_estados_all ON public.stock_estados;
CREATE POLICY stock_estados_all ON public.stock_estados
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_estados;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE public.stock_estados IS
  'Desglose de stock por estado/condición (nuevo/bueno/reparacion/baja). El total por estado <= stock_actual del item. Foto y nota por bucket.';

NOTIFY pgrst, 'reload schema';
