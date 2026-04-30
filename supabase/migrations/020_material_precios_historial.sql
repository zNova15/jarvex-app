-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migración 020 — Historial de precios de materiales               ║
-- ║                                                                    ║
-- ║  Cada cambio de precio_unitario_estimado en materiales se          ║
-- ║  registra como un evento. Permite ver evolución de costos en el    ║
-- ║  tiempo y auditar quién/cuándo lo cambió.                          ║
-- ║                                                                    ║
-- ║  Workflow esperado:                                                ║
-- ║   - Almacenero registra movimientos (con precio real de la guía).  ║
-- ║   - Si precio real difiere mucho del estimado, se levanta alerta.  ║
-- ║   - Gerencia / Contabilidad acepta la alerta y actualiza el precio ║
-- ║     estimado del material — eso queda en este historial.           ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS material_precios_historial (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  material_id       UUID NOT NULL REFERENCES materiales(id) ON DELETE CASCADE,
  obra_id           UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  precio_anterior   NUMERIC(14,4) DEFAULT 0,
  precio_nuevo      NUMERIC(14,4) NOT NULL,
  fecha             DATE NOT NULL DEFAULT CURRENT_DATE,
  motivo            TEXT,
  documento_ref     TEXT,                          -- nº de factura/guía o cotización
  fuente            TEXT CHECK (fuente IN (
                      'manual',           -- cambio manual por gerencia/contabilidad
                      'apu',              -- sincronizado desde APU
                      'movimiento',       -- detectado en un movimiento real
                      'importacion'       -- carga inicial desde Excel/Delphin
                    )) DEFAULT 'manual',
  origen_movimiento_id UUID REFERENCES movimientos_materiales(id),
  -- estándar
  version           INTEGER DEFAULT 1 NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at        TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at        TIMESTAMPTZ,
  created_by        UUID REFERENCES auth.users(id),
  updated_by        UUID REFERENCES auth.users(id),
  idempotency_key   TEXT UNIQUE,
  last_synced_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mph_material ON material_precios_historial(material_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mph_obra     ON material_precios_historial(obra_id)     WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mph_fecha    ON material_precios_historial(fecha DESC);

ALTER TABLE material_precios_historial ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mph: ve"        ON material_precios_historial;
DROP POLICY IF EXISTS "mph: crea"      ON material_precios_historial;
DROP POLICY IF EXISTS "mph: actualiza" ON material_precios_historial;
DROP POLICY IF EXISTS "mph: elimina"   ON material_precios_historial;

CREATE POLICY "mph: ve"        ON material_precios_historial FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "mph: crea"      ON material_precios_historial FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "mph: actualiza" ON material_precios_historial FOR UPDATE USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "mph: elimina"   ON material_precios_historial FOR DELETE USING (is_admin());

DROP TRIGGER IF EXISTS trg_mph_updated_at ON material_precios_historial;
CREATE TRIGGER trg_mph_updated_at
  BEFORE UPDATE ON material_precios_historial
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
