-- ═══════════════════════════════════════════════════════════════════
-- 133 — Fase 3 Ambiental: archivo de cumplimiento ISO 14001.
-- Cada registro = evidencia de una CATEGORÍA fija en una fecha; la matriz de
-- cumplimiento mensual (categoría × mes) se calcula en el cliente (lib/ambiental).
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ambiental_registros (
  id uuid PRIMARY KEY,
  obra_id uuid REFERENCES obras(id),
  categoria text NOT NULL,
  fecha date NOT NULL,
  descripcion text NOT NULL,
  responsable_id uuid,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE,
  CONSTRAINT ambiental_registros_categoria_check CHECK (categoria = ANY (ARRAY[
    'residuos','monitoreo_agua','monitoreo_aire','monitoreo_ruido','permisos','incidentes','capacitacion','inspecciones'
  ]))
);
CREATE INDEX IF NOT EXISTS idx_amb_reg_obra ON ambiental_registros (obra_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_amb_reg_fecha ON ambiental_registros (fecha) WHERE deleted_at IS NULL;
DROP TRIGGER IF EXISTS trg_amb_reg_updated ON ambiental_registros;
CREATE TRIGGER trg_amb_reg_updated BEFORE UPDATE ON ambiental_registros FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE ambiental_registros ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "amb_reg: autenticado lee" ON ambiental_registros;
CREATE POLICY "amb_reg: autenticado lee" ON ambiental_registros FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "amb_reg: autenticado inserta" ON ambiental_registros;
CREATE POLICY "amb_reg: autenticado inserta" ON ambiental_registros FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "amb_reg: autenticado actualiza" ON ambiental_registros;
CREATE POLICY "amb_reg: autenticado actualiza" ON ambiental_registros FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "amb_reg: admin borra" ON ambiental_registros;
CREATE POLICY "amb_reg: admin borra" ON ambiental_registros FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));
NOTIFY pgrst, 'reload schema';
