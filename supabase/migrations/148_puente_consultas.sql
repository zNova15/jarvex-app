-- 148: HILO DE CONSULTA almacén ↔ contabilidad (Fase 2 del puente insumo↔factura).
-- Buzón BIDIRECCIONAL: una parte pregunta con una referencia EXACTA (insumo, fecha,
-- cantidad, proveedor, N° de comprobante — SIN costos) y la otra responde
-- (Sí / Parcial / No / Otra fecha) y/o enlaza. Reemplaza el "aviso" unidireccional
-- (pendiente_sustento) por una conversación dirigida y persistente.
--
-- FK-less a propósito (accounting_movement_id / movimiento_id son referencias
-- "blandas"): la factura/ingreso siempre preexisten, y evitamos 23503 en el push.
-- La `referencia` (jsonb) es un SNAPSHOT sin costos → lo que el rol de almacén ve.
-- RLS: cualquier autenticado lee/inserta/actualiza (ambos roles conversan); borra admin.

CREATE TABLE IF NOT EXISTS puente_consultas (
  id uuid PRIMARY KEY,
  obra_id uuid REFERENCES obras(id),
  origen text NOT NULL,                    -- 'almacen' | 'contabilidad' (quién preguntó)
  estado text NOT NULL DEFAULT 'abierta',  -- 'abierta' | 'respondida' | 'cerrada'
  accounting_movement_id uuid,             -- factura consultada (soft ref)
  item_idx integer,                        -- línea de la factura (si aplica)
  movimiento_id uuid,                      -- ingreso de almacén consultado (soft ref)
  referencia jsonb NOT NULL DEFAULT '{}'::jsonb,  -- snapshot SIN costos
  pregunta text NOT NULL,
  respuesta text,
  respuesta_tipo text,                     -- 'si' | 'parcial' | 'no' | 'otra_fecha'
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE,
  CONSTRAINT puente_consultas_origen_chk CHECK (origen IN ('almacen','contabilidad')),
  CONSTRAINT puente_consultas_estado_chk CHECK (estado IN ('abierta','respondida','cerrada')),
  CONSTRAINT puente_consultas_resptipo_chk CHECK (respuesta_tipo IS NULL OR respuesta_tipo IN ('si','parcial','no','otra_fecha'))
);
CREATE INDEX IF NOT EXISTS idx_pconsultas_obra ON puente_consultas (obra_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pconsultas_mov ON puente_consultas (accounting_movement_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pconsultas_ingreso ON puente_consultas (movimiento_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pconsultas_estado ON puente_consultas (estado) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_puente_consultas_updated ON puente_consultas;
CREATE TRIGGER trg_puente_consultas_updated BEFORE UPDATE ON puente_consultas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE puente_consultas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pconsultas: autenticado lee" ON puente_consultas;
CREATE POLICY "pconsultas: autenticado lee" ON puente_consultas
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "pconsultas: autenticado inserta" ON puente_consultas;
CREATE POLICY "pconsultas: autenticado inserta" ON puente_consultas
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "pconsultas: autenticado actualiza" ON puente_consultas;
CREATE POLICY "pconsultas: autenticado actualiza" ON puente_consultas
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "pconsultas: admin borra" ON puente_consultas;
CREATE POLICY "pconsultas: admin borra" ON puente_consultas
  FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));

NOTIFY pgrst, 'reload schema';
