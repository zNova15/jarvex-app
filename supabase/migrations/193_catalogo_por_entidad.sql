-- ═══════════════════════════════════════════════════════════════════
-- 193 — EL CATÁLOGO TIENE DUEÑO, Y LAS CATEGORÍAS SE MAPEAN ENTRE ENTIDADES
-- tanda 14, corrección de la entrega 2 pedida por Gabriel el 7-set-2026.
--
-- LO QUE PIDIÓ, TEXTUAL:
--   «la categorización pueda ser independiente en cada entidad, como empresa o
--    consorcio ejecutor, para que cada empresa vaya manejando una base de
--    datos. Y a la vez tener una base de datos general de todo el programa»
--   «que el mapeo sea un mapeo de categorías en el que vayamos haciendo match
--    entre las categorías que tenemos en la empresa A, con la empresa B o
--    incluso de la empresa ejecutora o consorcio ejecutor A»
--
-- 1. `company_id` NULL = EL CATÁLOGO GENERAL DEL GRUPO. Con valor = el catálogo
--    de esa entidad. Al leer para una entidad se juntan los dos y, si el mismo
--    nombre está en ambos, MANDA EL DE LA ENTIDAD: el general es la referencia,
--    no una imposición. Nace en NULL, así que lo que ya está importado queda
--    como catálogo general sin tocar una sola fila.
--
-- 2. `catalogo_familia_mapeo` es el mapeo NUEVO: familia local de una entidad →
--    familia canónica del grupo. Que GASOMI le diga «FERRETERIA» y EL INCA
--    «MATERIAL DE FERRETERÍA» a lo mismo se decide UNA vez y vale para siempre.
--    Si las dos usan el mismo nombre no hay nada que mapear y la pantalla no
--    pregunta nada — el trabajo aparece solo donde de verdad difieren.
--
--    `decision = 'propia'` es una respuesta VÁLIDA y hay que recordarla: una
--    categoría puede no equivaler a ninguna del grupo (la lección de mig 183 —
--    sin guardar el «no aplica», la pregunta vuelve en cada visita y la
--    pantalla se abandona).
--
-- POR QUÉ EL MAPEO VIEJO NO SERVÍA (medido hoy contra producción):
-- hay 2.490 líneas de compra repartidas en 24 entidades, y la pestaña «Mapeo al
-- presupuesto» las tira TODAS contra el presupuesto de una obra. Solo 157 son de
-- CONSORCIO EL INCA, que es quien ejecuta Miraflores. Por eso a Gabriel le
-- aparecía «POR EL SALDO DE TARRAJEO DE LA OBRA: I.E. 040 NUEVA ESPERANZA,
-- NUEVO CHIMBOTE» —una factura de GASOMI, de otro proyecto, sin obra— pidiendo
-- ser mapeada contra una obra de agua potable en Cajamarca.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. El dueño del catálogo ───────────────────────────────────────
ALTER TABLE catalogo_insumos
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
ALTER TABLE catalogo_disgregacion
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);

COMMENT ON COLUMN catalogo_insumos.company_id IS
  'NULL = catálogo GENERAL del grupo. Con valor = catálogo propio de esa entidad (empresa o consorcio ejecutor).';

CREATE INDEX IF NOT EXISTS idx_catalogo_insumos_company
  ON catalogo_insumos (company_id, norm) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_catalogo_disgregacion_company
  ON catalogo_disgregacion (company_id) WHERE deleted_at IS NULL;

-- ── 2. El mapeo de categorías entre entidades ──────────────────────
CREATE TABLE IF NOT EXISTS catalogo_familia_mapeo (
  id uuid PRIMARY KEY,
  -- La entidad dueña de la familia local. NUNCA NULL: el catálogo general no
  -- se mapea contra sí mismo, ES el destino.
  company_id uuid NOT NULL REFERENCES companies(id),
  -- Cómo la llama esa entidad, tal como quedó en su catálogo.
  familia_local text NOT NULL,
  -- La familia del grupo a la que equivale. NULL mientras no se decide, y
  -- también cuando decision = 'propia'.
  familia_canonica text,
  decision text NOT NULL DEFAULT 'mapeada' CHECK (decision IN ('mapeada','propia')),
  nota text,
  demo boolean NOT NULL DEFAULT false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE,
  CONSTRAINT catalogo_familia_mapeo_canonica_si_mapeada
    CHECK (decision <> 'mapeada' OR familia_canonica IS NOT NULL)
);

-- Sin UNIQUE sobre (company_id, familia_local), a propósito y por lo mismo de
-- siempre (migs 113/154/183/192): dos PCs offline decidiendo la misma
-- equivalencia generarían un 23505 que el SyncEngine manda a conflictos
-- manuales por un caso benigno. Se resuelve al LEER.
CREATE INDEX IF NOT EXISTS idx_catalogo_familia_mapeo_company
  ON catalogo_familia_mapeo (company_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_catalogo_familia_mapeo_updated ON catalogo_familia_mapeo;
CREATE TRIGGER trg_catalogo_familia_mapeo_updated
  BEFORE UPDATE ON catalogo_familia_mapeo
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE catalogo_familia_mapeo ENABLE ROW LEVEL SECURITY;

-- Mismo criterio que catalogo_insumos (mig 192): son NOMBRES DE CATEGORÍAS, sin
-- plata. Todos leen; escriben admin y gerente; el DELETE físico solo admin.
DROP POLICY IF EXISTS "catalogo_familia_mapeo: autenticado lee" ON catalogo_familia_mapeo;
CREATE POLICY "catalogo_familia_mapeo: autenticado lee" ON catalogo_familia_mapeo
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "catalogo_familia_mapeo: gerencia inserta" ON catalogo_familia_mapeo;
CREATE POLICY "catalogo_familia_mapeo: gerencia inserta" ON catalogo_familia_mapeo
  FOR INSERT TO authenticated WITH CHECK (has_role(ARRAY['admin'::text,'gerente'::text]));
DROP POLICY IF EXISTS "catalogo_familia_mapeo: gerencia actualiza" ON catalogo_familia_mapeo;
CREATE POLICY "catalogo_familia_mapeo: gerencia actualiza" ON catalogo_familia_mapeo
  FOR UPDATE TO authenticated USING (has_role(ARRAY['admin'::text,'gerente'::text]));
DROP POLICY IF EXISTS "catalogo_familia_mapeo: admin borra" ON catalogo_familia_mapeo;
CREATE POLICY "catalogo_familia_mapeo: admin borra" ON catalogo_familia_mapeo
  FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));

NOTIFY pgrst, 'reload schema';
