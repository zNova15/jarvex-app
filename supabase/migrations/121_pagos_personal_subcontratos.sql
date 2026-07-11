-- 121: PAGOS de personal y subcontratos + pagos EN PARTES (pedido de Gabriel).
-- · personal.modo_pago: cómo se le paga a cada trabajador (planilla | rxh
--   (recibo por honorarios) | otro). Sin CHECK server (imports con texto libre
--   ya reventaron CHECKs antes); la UI valida.
-- · pagos: el COMPROMISO (a un personal, a un subcontrato, o libre) con monto
--   acordado. Ej: pago de S/7,000 al subcontrato X.
-- · pagos_partes: cada transferencia/depósito PARCIAL que completa un monto
--   (900 + 3200 + 2900 = 7000), con su evidencia. También sirve para las
--   BANCARIZACIONES EN PARTES de una factura (accounting_movement_id) — "va
--   para todos los movimientos de dinero en general".
-- · Evidencias de esta área (recibo_honorarios, pago_evidencia) son CONTABLES:
--   solo contadora jefe + admin (+ autor) — se agregan al RLS de la mig 119.

ALTER TABLE personal ADD COLUMN IF NOT EXISTS modo_pago text;

CREATE TABLE IF NOT EXISTS pagos (
  id uuid PRIMARY KEY,
  obra_id uuid REFERENCES obras(id),
  beneficiario_tipo text NOT NULL DEFAULT 'personal',   -- personal | subcontrato | otro
  personal_id uuid REFERENCES personal(id),
  subcontrato_id uuid REFERENCES subcontratos(id),
  beneficiario_nombre text,          -- para 'otro' (o denormalizado para mostrar)
  concepto text,
  modo_pago text,                    -- planilla | rxh | otro | subcontrato
  monto_acordado numeric(14,2) NOT NULL DEFAULT 0,
  moneda text NOT NULL DEFAULT 'PEN',
  periodo text,                      -- 'YYYY-MM' u otra referencia
  estado text NOT NULL DEFAULT 'pendiente',   -- pendiente | parcial | pagado | anulado
  notas text,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_pagos_obra ON pagos (obra_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pagos_personal ON pagos (personal_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pagos_subcontrato ON pagos (subcontrato_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS pagos_partes (
  id uuid PRIMARY KEY,
  pago_id uuid REFERENCES pagos(id),
  accounting_movement_id uuid REFERENCES accounting_movements(id),
  obra_id uuid REFERENCES obras(id),
  fecha date,
  monto numeric(14,2) NOT NULL DEFAULT 0,
  metodo text,                       -- transferencia | deposito | agente | efectivo | yape_plin | cheque | otro
  referencia text,                   -- nro de operación / voucher
  evidencia_id uuid,                 -- FK-less a evidencias (misma técnica que registro_relacionado_id)
  observaciones text,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE,
  CONSTRAINT pagos_partes_padre CHECK (pago_id IS NOT NULL OR accounting_movement_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_pagos_partes_pago ON pagos_partes (pago_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pagos_partes_mov ON pagos_partes (accounting_movement_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_pagos_updated ON pagos;
CREATE TRIGGER trg_pagos_updated BEFORE UPDATE ON pagos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_pagos_partes_updated ON pagos_partes;
CREATE TRIGGER trg_pagos_partes_updated BEFORE UPDATE ON pagos_partes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE pagos ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos_partes ENABLE ROW LEVEL SECURITY;

-- Los DATOS de pagos son sensibles (sueldos): solo roles contables + admin leen.
DROP POLICY IF EXISTS "pagos: lee contable" ON pagos;
CREATE POLICY "pagos: lee contable" ON pagos
  FOR SELECT TO authenticated
  USING (public.has_role(ARRAY['admin'::text, 'contador'::text, 'gerente'::text, 'ayudante_contador'::text, 'tesorero'::text]));
DROP POLICY IF EXISTS "pagos: escribe contable" ON pagos;
CREATE POLICY "pagos: escribe contable" ON pagos
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(ARRAY['admin'::text, 'contador'::text]));
DROP POLICY IF EXISTS "pagos: actualiza contable" ON pagos;
CREATE POLICY "pagos: actualiza contable" ON pagos
  FOR UPDATE TO authenticated
  USING (public.has_role(ARRAY['admin'::text, 'contador'::text]));
DROP POLICY IF EXISTS "pagos: admin borra" ON pagos;
CREATE POLICY "pagos: admin borra" ON pagos
  FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));

DROP POLICY IF EXISTS "pagos_partes: lee contable" ON pagos_partes;
CREATE POLICY "pagos_partes: lee contable" ON pagos_partes
  FOR SELECT TO authenticated
  USING (public.has_role(ARRAY['admin'::text, 'contador'::text, 'gerente'::text, 'ayudante_contador'::text, 'tesorero'::text]));
DROP POLICY IF EXISTS "pagos_partes: escribe contable" ON pagos_partes;
CREATE POLICY "pagos_partes: escribe contable" ON pagos_partes
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(ARRAY['admin'::text, 'contador'::text, 'ayudante_contador'::text]));
DROP POLICY IF EXISTS "pagos_partes: actualiza contable" ON pagos_partes;
CREATE POLICY "pagos_partes: actualiza contable" ON pagos_partes
  FOR UPDATE TO authenticated
  USING (public.has_role(ARRAY['admin'::text, 'contador'::text, 'ayudante_contador'::text]));
DROP POLICY IF EXISTS "pagos_partes: admin borra" ON pagos_partes;
CREATE POLICY "pagos_partes: admin borra" ON pagos_partes
  FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));

-- Evidencias de pagos = CONTABLES (solo jefe/admin/autor las leen).
DROP POLICY IF EXISTS "evidencias: ver segun tipo" ON public.evidencias;
CREATE POLICY "evidencias: ver segun tipo" ON public.evidencias
  FOR SELECT TO authenticated
  USING (
    tipo_evidencia NOT IN ('bancarizacion', 'comprobante_captura', 'factura', 'recibo_honorarios', 'pago_evidencia')
    OR public.has_role(ARRAY['admin'::text, 'contador'::text, 'ayudante_contador'::text, 'gerente'::text, 'tesorero'::text, 'asistente_admin'::text])
    OR subido_por = auth.uid()
    OR created_by = auth.uid()
  );

NOTIFY pgrst, 'reload schema';
