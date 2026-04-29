-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migración 019 — Insumos versionados (snapshot por versión)       ║
-- ║  Permite comparar no solo costos por partida sino también el      ║
-- ║  detalle de insumos (materiales/MO/equipos) entre versiones.      ║
-- ║  Se llena automáticamente al crear una versión que tiene APU.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS insumos_partida_versionadas (
  id                       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  version_id               UUID NOT NULL REFERENCES presupuestos_versiones(id) ON DELETE CASCADE,
  partida_versionada_id    UUID NOT NULL REFERENCES partidas_versionadas(id) ON DELETE CASCADE,
  obra_id                  UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  insumo_codigo            TEXT,
  nombre_insumo            TEXT NOT NULL,
  tipo_insumo              TEXT,
  unidad                   TEXT,
  cantidad_presupuestada   NUMERIC(14,4) DEFAULT 0,
  precio_presupuestado     NUMERIC(14,4) DEFAULT 0,
  costo_total              NUMERIC(14,2) DEFAULT 0,
  -- estándar
  version                  INTEGER DEFAULT 1 NOT NULL,
  created_at               TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at               TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at               TIMESTAMPTZ,
  created_by               UUID REFERENCES auth.users(id),
  updated_by               UUID REFERENCES auth.users(id),
  idempotency_key          TEXT UNIQUE,
  last_synced_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_insumos_ver_version ON insumos_partida_versionadas(version_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_insumos_ver_partida ON insumos_partida_versionadas(partida_versionada_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_insumos_ver_codigo  ON insumos_partida_versionadas(insumo_codigo);

ALTER TABLE insumos_partida_versionadas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ins_ver: ve"        ON insumos_partida_versionadas;
DROP POLICY IF EXISTS "ins_ver: crea"      ON insumos_partida_versionadas;
DROP POLICY IF EXISTS "ins_ver: actualiza" ON insumos_partida_versionadas;
DROP POLICY IF EXISTS "ins_ver: elimina"   ON insumos_partida_versionadas;

CREATE POLICY "ins_ver: ve"        ON insumos_partida_versionadas FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "ins_ver: crea"      ON insumos_partida_versionadas FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "ins_ver: actualiza" ON insumos_partida_versionadas FOR UPDATE USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "ins_ver: elimina"   ON insumos_partida_versionadas FOR DELETE USING (is_admin());

DROP TRIGGER IF EXISTS trg_insumos_ver_updated_at ON insumos_partida_versionadas;
CREATE TRIGGER trg_insumos_ver_updated_at
  BEFORE UPDATE ON insumos_partida_versionadas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
