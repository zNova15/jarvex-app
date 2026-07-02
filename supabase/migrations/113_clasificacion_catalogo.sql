-- 113: catálogo de aprendizaje del clasificador de ítems de factura.
-- Memoria compartida entre dispositivos: cada corrección manual (fuente='manual')
-- pisa lo aprendido por IA (fuente='ia') para esa descripción normalizada.
-- SIN UNIQUE en descripcion_normalizada a propósito: dos devices pueden aprender
-- la misma descripción offline con ids distintos (un UNIQUE dejaría el segundo
-- push FAILED sin auto-cura); la fila canónica se resuelve al LEER
-- (manual > ia, luego updated_at desc).

CREATE TABLE IF NOT EXISTS clasificacion_catalogo (
  id uuid PRIMARY KEY,
  descripcion_normalizada text NOT NULL,
  categoria text NOT NULL CHECK (categoria IN (
    'materiales','herramientas','maquinaria','epp',
    'insumos_emergencia','gastos_generales','otros'
  )),
  subcategoria text,
  fuente text NOT NULL DEFAULT 'ia' CHECK (fuente IN ('ia','manual')),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_clasif_catalogo_desc
  ON clasificacion_catalogo (descripcion_normalizada) WHERE deleted_at IS NULL;

-- Trigger estándar del repo: bumpea updated_at + version en cada UPDATE.
DROP TRIGGER IF EXISTS trg_clasif_catalogo_updated ON clasificacion_catalogo;
CREATE TRIGGER trg_clasif_catalogo_updated
  BEFORE UPDATE ON clasificacion_catalogo
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE clasificacion_catalogo ENABLE ROW LEVEL SECURITY;

-- Patrón RLS del repo (mig 109): lectura/escritura para autenticados,
-- DELETE físico solo admin (el borrado normal es soft vía deleted_at).
DROP POLICY IF EXISTS "clasif_catalogo: autenticado lee" ON clasificacion_catalogo;
CREATE POLICY "clasif_catalogo: autenticado lee" ON clasificacion_catalogo
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "clasif_catalogo: autenticado inserta" ON clasificacion_catalogo;
CREATE POLICY "clasif_catalogo: autenticado inserta" ON clasificacion_catalogo
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "clasif_catalogo: autenticado actualiza" ON clasificacion_catalogo;
CREATE POLICY "clasif_catalogo: autenticado actualiza" ON clasificacion_catalogo
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "clasif_catalogo: admin borra" ON clasificacion_catalogo;
CREATE POLICY "clasif_catalogo: admin borra" ON clasificacion_catalogo
  FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));
