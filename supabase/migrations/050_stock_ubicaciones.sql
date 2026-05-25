-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Stock por ubicación + traspasos entre almacenes
--
-- Hoy cada material/herramienta/EPP tiene UNA sola `ubicacion_id` (dónde
-- está). No soporta "5 serruchos en Almacén 1 y 3 en Almacén 2".
--
-- Esta tabla guarda el DESGLOSE de stock por ubicación. El stock total
-- (materiales.stock_actual, etc.) se mantiene como la suma de todas las
-- ubicaciones — así no se rompe ninguna validación, recálculo ni reporte
-- existente. stock_ubicaciones es solo el detalle de dónde está cada cosa.
--
-- Genérica para los 3 inventarios vía item_tipo + item_id.
--
-- Un TRASPASO entre almacenes = resta cantidad en la ubicación origen +
-- suma en la destino (el total no cambia) + 2 movimientos para trazabilidad.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.stock_ubicaciones (
  id            UUID PRIMARY KEY,
  obra_id       UUID NOT NULL REFERENCES public.obras(id) ON DELETE CASCADE,
  item_tipo     TEXT NOT NULL CHECK (item_tipo IN ('material','herramienta','epp')),
  item_id       UUID NOT NULL,
  ubicacion_id  UUID NOT NULL REFERENCES public.ubicaciones_obra(id) ON DELETE CASCADE,
  cantidad      NUMERIC NOT NULL DEFAULT 0,
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID,
  updated_by    UUID,
  idempotency_key TEXT,
  last_synced_at TIMESTAMPTZ,
  deleted_at    TIMESTAMPTZ
);

-- Una fila por (item, ubicación). El upsert de stock usa esta unicidad.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_ubicaciones_item_ubic
  ON public.stock_ubicaciones (item_tipo, item_id, ubicacion_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_stock_ubicaciones_item
  ON public.stock_ubicaciones (obra_id, item_tipo, item_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_stock_ubicaciones_ubic
  ON public.stock_ubicaciones (ubicacion_id)
  WHERE deleted_at IS NULL;

-- RLS: misma política bulk-authenticated que el resto de tablas de obra.
ALTER TABLE public.stock_ubicaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_ubicaciones_all ON public.stock_ubicaciones;
CREATE POLICY stock_ubicaciones_all ON public.stock_ubicaciones
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Realtime: que el desglose se propague entre dispositivos al instante.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_ubicaciones;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE public.stock_ubicaciones IS
  'Desglose de stock por ubicación (item_tipo+item_id → ubicacion → cantidad). El stock total del item es la suma. Soporta traspasos entre almacenes.';

NOTIFY pgrst, 'reload schema';
