-- ═══════════════════════════════════════════════════════════════════
-- 135 — Fase 5 Social: padrón de actores + compromisos + quejas/reclamos.
-- social_actores = padrón (autoridades, dirigentes, instituciones, vecinos).
-- social_compromisos = compromisos de actas con la comunidad (vencimiento;
--   el semáforo vencido/por_vencer se deriva en el cliente, lib/social.js).
-- social_quejas = quejas/reclamos/sugerencias con seguimiento hasta cierre.
-- Actas y evidencias de cierre van como evidencias (modulo social_*).
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS social_actores (
  id uuid PRIMARY KEY,
  obra_id uuid REFERENCES obras(id),
  nombre text NOT NULL,
  tipo text CHECK (tipo = ANY (ARRAY['autoridad','dirigente','institucion','vecino','otro'])),
  organizacion text,
  cargo text,
  telefono text,
  comunidad text,
  notas text,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_soc_act_obra ON social_actores (obra_id) WHERE deleted_at IS NULL;
DROP TRIGGER IF EXISTS trg_soc_act_updated ON social_actores;
CREATE TRIGGER trg_soc_act_updated BEFORE UPDATE ON social_actores FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE social_actores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "soc_act: autenticado lee" ON social_actores;
CREATE POLICY "soc_act: autenticado lee" ON social_actores FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "soc_act: autenticado inserta" ON social_actores;
CREATE POLICY "soc_act: autenticado inserta" ON social_actores FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "soc_act: autenticado actualiza" ON social_actores;
CREATE POLICY "soc_act: autenticado actualiza" ON social_actores FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "soc_act: admin borra" ON social_actores;
CREATE POLICY "soc_act: admin borra" ON social_actores FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));

CREATE TABLE IF NOT EXISTS social_compromisos (
  id uuid PRIMARY KEY,
  obra_id uuid REFERENCES obras(id),
  fecha_acta date NOT NULL,
  descripcion text NOT NULL,
  comunidad text,
  actor_id uuid REFERENCES social_actores(id),
  fecha_limite date,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado = ANY (ARRAY['pendiente','en_proceso','cumplido'])),
  fecha_cumplimiento date,
  notas text,
  responsable_id uuid,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_soc_comp_obra ON social_compromisos (obra_id) WHERE deleted_at IS NULL;
DROP TRIGGER IF EXISTS trg_soc_comp_updated ON social_compromisos;
CREATE TRIGGER trg_soc_comp_updated BEFORE UPDATE ON social_compromisos FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE social_compromisos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "soc_comp: autenticado lee" ON social_compromisos;
CREATE POLICY "soc_comp: autenticado lee" ON social_compromisos FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "soc_comp: autenticado inserta" ON social_compromisos;
CREATE POLICY "soc_comp: autenticado inserta" ON social_compromisos FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "soc_comp: autenticado actualiza" ON social_compromisos;
CREATE POLICY "soc_comp: autenticado actualiza" ON social_compromisos FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "soc_comp: admin borra" ON social_compromisos;
CREATE POLICY "soc_comp: admin borra" ON social_compromisos FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));

CREATE TABLE IF NOT EXISTS social_quejas (
  id uuid PRIMARY KEY,
  obra_id uuid REFERENCES obras(id),
  fecha date NOT NULL,
  tipo text NOT NULL DEFAULT 'queja' CHECK (tipo = ANY (ARRAY['queja','reclamo','sugerencia'])),
  descripcion text NOT NULL,
  reclamante text,
  actor_id uuid REFERENCES social_actores(id),
  estado text NOT NULL DEFAULT 'abierta' CHECK (estado = ANY (ARRAY['abierta','en_atencion','cerrada'])),
  respuesta text,
  fecha_cierre date,
  responsable_id uuid,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_soc_quej_obra ON social_quejas (obra_id) WHERE deleted_at IS NULL;
DROP TRIGGER IF EXISTS trg_soc_quej_updated ON social_quejas;
CREATE TRIGGER trg_soc_quej_updated BEFORE UPDATE ON social_quejas FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE social_quejas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "soc_quej: autenticado lee" ON social_quejas;
CREATE POLICY "soc_quej: autenticado lee" ON social_quejas FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "soc_quej: autenticado inserta" ON social_quejas;
CREATE POLICY "soc_quej: autenticado inserta" ON social_quejas FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "soc_quej: autenticado actualiza" ON social_quejas;
CREATE POLICY "soc_quej: autenticado actualiza" ON social_quejas FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "soc_quej: admin borra" ON social_quejas;
CREATE POLICY "soc_quej: admin borra" ON social_quejas FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));
NOTIFY pgrst, 'reload schema';
