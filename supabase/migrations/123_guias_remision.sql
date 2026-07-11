-- 123: GUÍAS DE REMISIÓN (pedido de Gabriel): la Captura Mágica las detectaba
-- como "Otro" comprobante. Tabla propia con VÍNCULO BIDIRECCIONAL a la factura
-- (accounting_movement_id): desde la factura se llega a su guía y desde la
-- guía a la factura. doc_referencia = el "Doc. Ref." impreso en la guía
-- (ej. F001-025131) para el auto-match. La evidencia PDF va como tipo
-- 'guia_remision' (NO contable: el almacén también trabaja con guías).

CREATE TABLE IF NOT EXISTS guias_remision (
  id uuid PRIMARY KEY,
  obra_id uuid REFERENCES obras(id),
  company_id uuid REFERENCES companies(id),            -- destinataria (grupo)
  proveedor_id uuid REFERENCES proveedores(id),        -- remitente
  emisor_ruc text,
  emisor_razon_social text,
  serie_correlativo text,          -- T001-000309
  fecha_emision date,
  fecha_traslado date,
  punto_partida text,
  punto_llegada text,
  motivo_traslado text,
  doc_referencia text,             -- factura referenciada en la guía (texto)
  accounting_movement_id uuid REFERENCES accounting_movements(id),   -- factura vinculada
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  transportista jsonb,             -- { placa, chofer, dni, licencia, razon_social, ruc }
  evidencia_id uuid,               -- PDF de la guía (FK-less, técnica registro_relacionado)
  observaciones text,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_guias_obra ON guias_remision (obra_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_guias_mov ON guias_remision (accounting_movement_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_guias_remision_updated ON guias_remision;
CREATE TRIGGER trg_guias_remision_updated BEFORE UPDATE ON guias_remision
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE guias_remision ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "guias: autenticado lee" ON guias_remision;
CREATE POLICY "guias: autenticado lee" ON guias_remision
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "guias: autenticado inserta" ON guias_remision;
CREATE POLICY "guias: autenticado inserta" ON guias_remision
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "guias: autenticado actualiza" ON guias_remision;
CREATE POLICY "guias: autenticado actualiza" ON guias_remision
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "guias: admin borra" ON guias_remision;
CREATE POLICY "guias: admin borra" ON guias_remision
  FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));

NOTIFY pgrst, 'reload schema';
