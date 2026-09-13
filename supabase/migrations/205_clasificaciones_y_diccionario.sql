-- ═══════════════════════════════════════════════════════════════════
-- 205 — LAS CLASIFICACIONES SON DATO, Y TIENEN DICCIONARIO
-- Pedido de Gabriel el 13-set-2026, revisando staging:
--
--   «Catálogo debería tener la clasificación que tenemos junto al diccionario
--    de muestras de enlaces. Aquí podríamos crear nuevas clasificaciones y
--    agregar un diccionario de qué insumos irían a la nueva clasificación.
--    Además recuerda que tenemos clasificación de insumos y también quiero una
--    de servicios.»
--
-- ── EL DISEÑO DE DOS CAPAS (y por qué no una sola) ─────────────────
-- La base oficial NO viene acá: los 82 códigos del IUPC y los 938 términos del
-- Anexo 2 de la R.J. Nº 016-2026-INEI viajan en el bundle
-- (`src/lib/indices-unificados-iupc.js`), igual que las 13 clasificaciones del
-- árbol de servicios (`src/lib/clasificacion-servicios.js`).
--
-- Tres razones, y la primera pesa más que las otras dos:
--
-- 1. EGRESS. Meter ~1.030 filas en una tabla sincronizada significa que cada
--    device las baja y las revisa en cada ciclo, para siempre. Después del
--    corte del 9-set por egress agotado, agregar tráfico permanente para
--    guardar algo que NO CAMBIA sería exactamente la lección no aprendida.
-- 2. Es la LEY. El IUPC lo fija una resolución del INEI; no es dato de la
--    empresa y nadie debería poder editarlo desde la app. Cuando salga una
--    R.J. nueva se actualiza el archivo y se despliega, que es como debe ser.
-- 3. Un device recién instalado clasifica bien ANTES del primer sync.
--
-- Acá viven SOLO las clasificaciones que crea Gabriel y los términos que le
-- agrega al diccionario. Es poco y crece despacio. La pantalla mezcla las dos
-- capas y marca cuál es cuál.
--
-- ── POR QUÉ EL DICCIONARIO ES UNA TABLA APARTE ─────────────────────
-- Un término se le puede agregar a una clasificación OFICIAL («esta ferretería
-- le dice ‹cemento cabezón› al Portland tipo I» → término nuevo apuntando al
-- IUPC 21), sin que exista ninguna fila en `clasificaciones`. Si el diccionario
-- fuera una columna de esa tabla, no habría dónde ponerlo.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Las clasificaciones propias ─────────────────────────────────
CREATE TABLE IF NOT EXISTS clasificaciones (
  id uuid PRIMARY KEY,
  -- El código con el que se guarda en `catalogo_insumos.familia` y en
  -- `insumo_categoria.familia`. Lo escribe la persona (ej. 'GEO-01'). No puede
  -- chocar con el espacio del IUPC ('01'..'95') ni con el de servicios
  -- ('S01'..'S13'): eso lo valida la app al crear, acá solo se exige que no
  -- esté vacío y no tenga espacios.
  codigo text NOT NULL CHECK (codigo <> '' AND codigo !~ '\s'),
  nombre text NOT NULL,
  -- A qué árbol pertenece. Son los dos que pidió Gabriel.
  arbol text NOT NULL DEFAULT 'insumo' CHECK (arbol IN ('insumo','servicio')),
  -- Cómo la agrupa la contadora (vocabulario de CATEGORIAS_ITEM en
  -- src/lib/clasificar-items.js). NULL = lo deduce la app del árbol.
  gasto text CHECK (gasto IS NULL OR gasto IN (
    'materiales','herramientas','maquinaria','epp','insumos_emergencia',
    'gastos_generales','servicios','anticipo','otros')),
  nota text,
  activo boolean NOT NULL DEFAULT true,
  -- NULL = clasificación del GRUPO. Con valor = propia de esa entidad.
  -- Mismo criterio que catalogo_insumos (mig 193).
  company_id uuid REFERENCES companies(id),
  demo boolean NOT NULL DEFAULT false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);

-- Sin UNIQUE sobre (company_id, codigo), por lo mismo de siempre (migs
-- 113/154/183/192/193): dos PCs offline creando la misma clasificación darían
-- un 23505 que el SyncEngine manda a conflictos manuales por un caso benigno.
-- Se resuelve al LEER, quedándose con la más antigua.
CREATE INDEX IF NOT EXISTS idx_clasificaciones_codigo
  ON clasificaciones (codigo) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_clasificaciones_company
  ON clasificaciones (company_id, arbol) WHERE deleted_at IS NULL;

-- ── 2. El diccionario de muestras ──────────────────────────────────
CREATE TABLE IF NOT EXISTS clasificacion_terminos (
  id uuid PRIMARY KEY,
  -- El texto tal como lo escribió la persona: es lo que se ve en pantalla.
  termino text NOT NULL CHECK (termino <> ''),
  -- El mismo texto normalizado (sin tildes, minúsculas, sin puntuación). Lo
  -- calcula el cliente con normIUPC() y se guarda para poder buscar duplicados
  -- desde el server sin repetir la normalización en SQL.
  norm text NOT NULL,
  -- A qué clasificación apunta. Es un CÓDIGO, no un FK: puede apuntar tanto a
  -- una clasificación de esta tabla como a una del IUPC ('21') o del árbol de
  -- servicios ('S05'), que viven en el bundle y no tienen fila acá.
  clasificacion_codigo text NOT NULL CHECK (clasificacion_codigo <> ''),
  company_id uuid REFERENCES companies(id),
  demo boolean NOT NULL DEFAULT false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_clasificacion_terminos_cod
  ON clasificacion_terminos (clasificacion_codigo) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_clasificacion_terminos_norm
  ON clasificacion_terminos (norm) WHERE deleted_at IS NULL;

-- ── 3. Sellos y RLS ────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_clasificaciones_updated ON clasificaciones;
CREATE TRIGGER trg_clasificaciones_updated
  BEFORE UPDATE ON clasificaciones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_clasificacion_terminos_updated ON clasificacion_terminos;
CREATE TRIGGER trg_clasificacion_terminos_updated
  BEFORE UPDATE ON clasificacion_terminos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE clasificaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE clasificacion_terminos ENABLE ROW LEVEL SECURITY;

-- Mismo criterio que catalogo_insumos y catalogo_familia_mapeo (migs 192/193):
-- son NOMBRES DE CATEGORÍAS, sin plata. Todos leen —el clasificador corre en
-- todos los roles—; escriben admin y gerente; el DELETE físico solo admin.
DROP POLICY IF EXISTS "clasificaciones: autenticado lee" ON clasificaciones;
CREATE POLICY "clasificaciones: autenticado lee" ON clasificaciones
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "clasificaciones: gerencia inserta" ON clasificaciones;
CREATE POLICY "clasificaciones: gerencia inserta" ON clasificaciones
  FOR INSERT TO authenticated WITH CHECK (has_role(ARRAY['admin'::text,'gerente'::text]));
DROP POLICY IF EXISTS "clasificaciones: gerencia actualiza" ON clasificaciones;
CREATE POLICY "clasificaciones: gerencia actualiza" ON clasificaciones
  FOR UPDATE TO authenticated USING (has_role(ARRAY['admin'::text,'gerente'::text]));
DROP POLICY IF EXISTS "clasificaciones: admin borra" ON clasificaciones;
CREATE POLICY "clasificaciones: admin borra" ON clasificaciones
  FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));

DROP POLICY IF EXISTS "clasificacion_terminos: autenticado lee" ON clasificacion_terminos;
CREATE POLICY "clasificacion_terminos: autenticado lee" ON clasificacion_terminos
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "clasificacion_terminos: gerencia inserta" ON clasificacion_terminos;
CREATE POLICY "clasificacion_terminos: gerencia inserta" ON clasificacion_terminos
  FOR INSERT TO authenticated WITH CHECK (has_role(ARRAY['admin'::text,'gerente'::text]));
DROP POLICY IF EXISTS "clasificacion_terminos: gerencia actualiza" ON clasificacion_terminos;
CREATE POLICY "clasificacion_terminos: gerencia actualiza" ON clasificacion_terminos
  FOR UPDATE TO authenticated USING (has_role(ARRAY['admin'::text,'gerente'::text]));
DROP POLICY IF EXISTS "clasificacion_terminos: admin borra" ON clasificacion_terminos;
CREATE POLICY "clasificacion_terminos: admin borra" ON clasificacion_terminos
  FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));

COMMENT ON TABLE clasificaciones IS
  'Clasificaciones creadas desde la app. La base oficial (IUPC del INEI + árbol de servicios) vive en el bundle y NO se replica acá: ver el encabezado de la mig 205.';
COMMENT ON TABLE clasificacion_terminos IS
  'Diccionario de muestras agregado a mano. clasificacion_codigo puede apuntar a una clasificación de la tabla, a un código IUPC (01..95) o a uno de servicios (S01..S13).';

NOTIFY pgrst, 'reload schema';
