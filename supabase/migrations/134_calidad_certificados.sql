-- ═══════════════════════════════════════════════════════════════════
-- 134 — Fase 4 Calidad: requisitos del expediente + certificados vs IA.
-- calidad_requisitos = specs mínimas por insumo según expediente técnico.
-- calidad_certificados = certificado subido y comparado (IA o manual):
--   resultado (IA) / resultado_manual (override del ing.) — el manual manda.
-- El PDF del certificado va como evidencia (modulo 'calidad_certificados').
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS calidad_requisitos (
  id uuid PRIMARY KEY,
  obra_id uuid REFERENCES obras(id),
  insumo_nombre text NOT NULL,
  norma text,
  especificacion text NOT NULL,
  fuente text,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_cal_req_obra ON calidad_requisitos (obra_id) WHERE deleted_at IS NULL;
DROP TRIGGER IF EXISTS trg_cal_req_updated ON calidad_requisitos;
CREATE TRIGGER trg_cal_req_updated BEFORE UPDATE ON calidad_requisitos FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE calidad_requisitos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cal_req: autenticado lee" ON calidad_requisitos;
CREATE POLICY "cal_req: autenticado lee" ON calidad_requisitos FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "cal_req: autenticado inserta" ON calidad_requisitos;
CREATE POLICY "cal_req: autenticado inserta" ON calidad_requisitos FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "cal_req: autenticado actualiza" ON calidad_requisitos;
CREATE POLICY "cal_req: autenticado actualiza" ON calidad_requisitos FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "cal_req: admin borra" ON calidad_requisitos;
CREATE POLICY "cal_req: admin borra" ON calidad_requisitos FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));

CREATE TABLE IF NOT EXISTS calidad_certificados (
  id uuid PRIMARY KEY,
  obra_id uuid REFERENCES obras(id),
  requisito_id uuid NOT NULL REFERENCES calidad_requisitos(id),
  fecha date NOT NULL,
  descripcion text,
  proveedor text,
  resultado text CHECK (resultado = ANY (ARRAY['cumple','observado','no_cumple'])),
  resultado_manual text CHECK (resultado_manual = ANY (ARRAY['cumple','observado','no_cumple'])),
  resumen_ia text,
  detalle_ia text,
  responsable_id uuid,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_cal_cert_obra ON calidad_certificados (obra_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cal_cert_req ON calidad_certificados (requisito_id) WHERE deleted_at IS NULL;
DROP TRIGGER IF EXISTS trg_cal_cert_updated ON calidad_certificados;
CREATE TRIGGER trg_cal_cert_updated BEFORE UPDATE ON calidad_certificados FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE calidad_certificados ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cal_cert: autenticado lee" ON calidad_certificados;
CREATE POLICY "cal_cert: autenticado lee" ON calidad_certificados FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "cal_cert: autenticado inserta" ON calidad_certificados;
CREATE POLICY "cal_cert: autenticado inserta" ON calidad_certificados FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "cal_cert: autenticado actualiza" ON calidad_certificados;
CREATE POLICY "cal_cert: autenticado actualiza" ON calidad_certificados FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "cal_cert: admin borra" ON calidad_certificados;
CREATE POLICY "cal_cert: admin borra" ON calidad_certificados FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));
NOTIFY pgrst, 'reload schema';
