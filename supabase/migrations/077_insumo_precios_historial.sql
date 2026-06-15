-- 077: historial de precios para herramienta/epp/emergencia + columnas de precio.

-- 1) herramientas e insumos_emergencia no tenían precio estimado (epps ya tiene).
ALTER TABLE public.herramientas       ADD COLUMN IF NOT EXISTS precio_unitario_estimado NUMERIC(14,4);
ALTER TABLE public.insumos_emergencia ADD COLUMN IF NOT EXISTS precio_unitario_estimado NUMERIC(14,4);

-- 2) Tabla UNIFICADA de historial de precios para herramienta/epp/emergencia.
--    Los materiales conservan material_precios_historial (mig 020). Genérica por
--    (item_tipo,item_id) y SIN FK al catálogo ni al movimiento (como
--    stock_ubicaciones): así el push no depende de un orden de tablas y no hay
--    riesgo de 23503 por punteros a registros que aún no subieron.
CREATE TABLE IF NOT EXISTS insumo_precios_historial (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  obra_id           UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  item_tipo         TEXT NOT NULL CHECK (item_tipo IN ('material','herramienta','epp','emergencia')),
  item_id           UUID NOT NULL,
  precio_anterior   NUMERIC(14,4) DEFAULT 0,
  precio_nuevo      NUMERIC(14,4) NOT NULL,
  fecha             DATE NOT NULL DEFAULT CURRENT_DATE,
  motivo            TEXT,
  documento_ref     TEXT,
  fuente            TEXT CHECK (fuente IN ('manual','apu','movimiento','importacion')) DEFAULT 'manual',
  origen_movimiento_id UUID,
  version           INTEGER DEFAULT 1 NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at        TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at        TIMESTAMPTZ,
  created_by        UUID REFERENCES auth.users(id),
  updated_by        UUID REFERENCES auth.users(id),
  idempotency_key   TEXT UNIQUE,
  last_synced_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_iph_item  ON insumo_precios_historial(item_tipo, item_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_iph_obra  ON insumo_precios_historial(obra_id)            WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_iph_fecha ON insumo_precios_historial(fecha DESC);

ALTER TABLE insumo_precios_historial ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "iph: ve"        ON insumo_precios_historial;
DROP POLICY IF EXISTS "iph: crea"      ON insumo_precios_historial;
DROP POLICY IF EXISTS "iph: actualiza" ON insumo_precios_historial;
DROP POLICY IF EXISTS "iph: elimina"   ON insumo_precios_historial;
CREATE POLICY "iph: ve"        ON insumo_precios_historial FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "iph: crea"      ON insumo_precios_historial FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "iph: actualiza" ON insumo_precios_historial FOR UPDATE USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "iph: elimina"   ON insumo_precios_historial FOR DELETE USING (is_admin());

DROP TRIGGER IF EXISTS trg_iph_updated_at ON insumo_precios_historial;
CREATE TRIGGER trg_iph_updated_at
  BEFORE UPDATE ON insumo_precios_historial
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
