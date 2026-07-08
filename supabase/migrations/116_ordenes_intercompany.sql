-- 116: Fase 4 — ÓRDENES DE COMPRA/SERVICIO INTERCOMPANY.
-- Desde las reglas de emisión (subcategoría → empresa emisora + intermediarias)
-- y la valorización al presupuesto (conciliacion_vinculos × insumos_partida), la
-- contadora jefe GENERA un borrador de orden por EMPRESA × OBRA × PERÍODO; el
-- ADMINISTRADOR la aprueba. Una orden aprobada queda lista para emitir el
-- comprobante (Fase 5: firma digital + envío SUNAT). Alimenta la Trazabilidad
-- de Cadenas via intermediarias.

CREATE TABLE IF NOT EXISTS ordenes_intercompany (
  id uuid PRIMARY KEY,
  codigo text,
  obra_id uuid REFERENCES obras(id),
  company_id uuid REFERENCES companies(id),            -- empresa EMISORA final
  intermediaria1_company_id uuid REFERENCES companies(id),
  intermediaria2_company_id uuid REFERENCES companies(id),
  ejecutora_company_id uuid REFERENCES companies(id),  -- empresa ejecutora de la obra (destino)
  periodo text,                                        -- 'YYYY-MM' (mes) o 'YYYY-Www' (semana)
  tipo_orden text NOT NULL DEFAULT 'compra',           -- compra | servicio
  estado text NOT NULL DEFAULT 'borrador',             -- borrador|pendiente_aprobacion|aprobada|rechazada|anulada
  items jsonb NOT NULL DEFAULT '[]'::jsonb,            -- [{insumo_codigo,insumo_nombre,unidad,cantidad,precio_unit,subcategoria,categoria}]
  igv_pct numeric NOT NULL DEFAULT 18,
  monto_subtotal numeric NOT NULL DEFAULT 0,
  monto_igv numeric NOT NULL DEFAULT 0,
  monto_total numeric NOT NULL DEFAULT 0,
  aprobado_por uuid,
  aprobado_at timestamptz,
  rechazo_motivo text,
  notas text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_ordenes_ic_obra  ON ordenes_intercompany (obra_id)     WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ordenes_ic_emp   ON ordenes_intercompany (company_id)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ordenes_ic_estado ON ordenes_intercompany (estado)     WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_ordenes_ic_updated ON ordenes_intercompany;
CREATE TRIGGER trg_ordenes_ic_updated
  BEFORE UPDATE ON ordenes_intercompany
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE ordenes_intercompany ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ordenes_ic: autenticado lee" ON ordenes_intercompany;
CREATE POLICY "ordenes_ic: autenticado lee" ON ordenes_intercompany
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "ordenes_ic: autenticado inserta" ON ordenes_intercompany;
CREATE POLICY "ordenes_ic: autenticado inserta" ON ordenes_intercompany
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "ordenes_ic: autenticado actualiza" ON ordenes_intercompany;
CREATE POLICY "ordenes_ic: autenticado actualiza" ON ordenes_intercompany
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "ordenes_ic: admin borra" ON ordenes_intercompany;
CREATE POLICY "ordenes_ic: admin borra" ON ordenes_intercompany
  FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));

NOTIFY pgrst, 'reload schema';
