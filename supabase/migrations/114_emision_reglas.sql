-- 114: reglas de designación de empresa emisora por SUBCATEGORÍA (Fase 3 del
-- clasificador). La contadora jefe define "las compras de <subcategoría> las
-- factura <empresa del grupo>"; el panel "Compras por Categoría" agrupa los
-- montos por empresa emisora designada. SIN UNIQUE en subcategoria (mismo
-- criterio que clasificacion_catalogo: dos devices offline pueden crear la
-- regla; la canónica se resuelve al LEER por updated_at desc).

CREATE TABLE IF NOT EXISTS emision_reglas (
  id uuid PRIMARY KEY,
  subcategoria text NOT NULL,
  categoria text,
  company_id uuid REFERENCES companies(id),
  notas text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_emision_reglas_subcat
  ON emision_reglas (subcategoria) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_emision_reglas_updated ON emision_reglas;
CREATE TRIGGER trg_emision_reglas_updated
  BEFORE UPDATE ON emision_reglas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE emision_reglas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "emision_reglas: autenticado lee" ON emision_reglas;
CREATE POLICY "emision_reglas: autenticado lee" ON emision_reglas
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "emision_reglas: autenticado inserta" ON emision_reglas;
CREATE POLICY "emision_reglas: autenticado inserta" ON emision_reglas
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "emision_reglas: autenticado actualiza" ON emision_reglas;
CREATE POLICY "emision_reglas: autenticado actualiza" ON emision_reglas
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "emision_reglas: admin borra" ON emision_reglas;
CREATE POLICY "emision_reglas: admin borra" ON emision_reglas
  FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));
