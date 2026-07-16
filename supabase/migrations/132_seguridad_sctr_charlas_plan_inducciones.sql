-- ═══════════════════════════════════════════════════════════════════
-- 132 — Fase 2 Seguridad: SCTR por trabajador + planificador de charlas
-- (compartido seguridad/ambiental/social) + fichas de inducción.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE personal ADD COLUMN IF NOT EXISTS sctr_vencimiento date;
ALTER TABLE personal ADD COLUMN IF NOT EXISTS sctr_aseguradora text;

CREATE TABLE IF NOT EXISTS charlas_plan (
  id uuid PRIMARY KEY,
  obra_id uuid REFERENCES obras(id),
  area text NOT NULL DEFAULT 'seguridad',
  fecha date NOT NULL,
  tema text NOT NULL,
  expositor text,
  estado text NOT NULL DEFAULT 'programada',
  notas text,
  responsable_id uuid,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE,
  CONSTRAINT charlas_plan_area_check CHECK (area = ANY (ARRAY['seguridad','ambiental','social'])),
  CONSTRAINT charlas_plan_estado_check CHECK (estado = ANY (ARRAY['programada','realizada','cancelada']))
);
CREATE INDEX IF NOT EXISTS idx_charlas_plan_obra ON charlas_plan (obra_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_charlas_plan_fecha ON charlas_plan (fecha) WHERE deleted_at IS NULL;
DROP TRIGGER IF EXISTS trg_charlas_plan_updated ON charlas_plan;
CREATE TRIGGER trg_charlas_plan_updated BEFORE UPDATE ON charlas_plan FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE charlas_plan ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "charlas_plan: autenticado lee" ON charlas_plan;
CREATE POLICY "charlas_plan: autenticado lee" ON charlas_plan FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "charlas_plan: autenticado inserta" ON charlas_plan;
CREATE POLICY "charlas_plan: autenticado inserta" ON charlas_plan FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "charlas_plan: autenticado actualiza" ON charlas_plan;
CREATE POLICY "charlas_plan: autenticado actualiza" ON charlas_plan FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "charlas_plan: admin borra" ON charlas_plan;
CREATE POLICY "charlas_plan: admin borra" ON charlas_plan FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));

CREATE TABLE IF NOT EXISTS inducciones (
  id uuid PRIMARY KEY,
  obra_id uuid REFERENCES obras(id),
  personal_id uuid REFERENCES personal(id),
  tipo text NOT NULL DEFAULT 'seguridad',
  fecha date NOT NULL,
  observaciones text,
  responsable_id uuid,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE,
  CONSTRAINT inducciones_tipo_check CHECK (tipo = ANY (ARRAY['seguridad','ambiental']))
);
CREATE INDEX IF NOT EXISTS idx_inducciones_obra ON inducciones (obra_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inducciones_personal ON inducciones (personal_id) WHERE deleted_at IS NULL;
DROP TRIGGER IF EXISTS trg_inducciones_updated ON inducciones;
CREATE TRIGGER trg_inducciones_updated BEFORE UPDATE ON inducciones FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE inducciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inducciones: autenticado lee" ON inducciones;
CREATE POLICY "inducciones: autenticado lee" ON inducciones FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "inducciones: autenticado inserta" ON inducciones;
CREATE POLICY "inducciones: autenticado inserta" ON inducciones FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "inducciones: autenticado actualiza" ON inducciones;
CREATE POLICY "inducciones: autenticado actualiza" ON inducciones FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "inducciones: admin borra" ON inducciones;
CREATE POLICY "inducciones: admin borra" ON inducciones FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));

NOTIFY pgrst, 'reload schema';
