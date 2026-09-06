-- ═══════════════════════════════════════════════════════════════════
-- 183 — MAPEO DE LÍNEAS DE FACTURA AL CATÁLOGO CANÓNICO — tanda 7, entrega 5.
--
-- El presupuesto dice qué necesita la obra en `insumos_partida.insumo_codigo`
-- (434 códigos). Las facturas dicen qué se compró, en texto libre: 2.440 líneas
-- que son 1.852 descripciones distintas ya normalizadas. Esta tabla guarda la
-- traducción de una a otra, decidida por una persona y recordada para siempre.
--
-- POR QUÉ HACE FALTA UNA TABLA Y NO UN CAMPO EN LA LÍNEA:
-- Las líneas viven dentro de `accounting_movements.notas.items_factura` (JSON).
-- El mismo texto —«VARILLA DE ACERO CORRUGADO DE 1/2»— aparece en varias
-- facturas de varias empresas. Mapearlo en cada línea obligaría a decidir lo
-- mismo una y otra vez y a reescribir comprobantes ya cerrados. La clave es la
-- DESCRIPCIÓN NORMALIZADA: se decide una vez y vale para todas las facturas,
-- las de ayer y las que entren mañana. Es la misma memoria de
-- `clasificacion_catalogo` (mig 141) y de `insumo_correlaciones` (mig 154).
--
-- POR QUÉ `decision` Y NO SOLO `insumo_codigo` NULL:
-- «esto no está en el presupuesto» es una respuesta VÁLIDA y hay que
-- recordarla: la mitad del gasto medido (S/ 921.960 de S/ 1,81 M) son perfiles
-- de acero, laptops y herramientas que la obra no presupuestó nunca. Sin
-- guardar el «no aplica», esas 1.371 descripciones volverían a preguntarse en
-- cada visita y la pantalla se volvería inservible — la misma lección que dejó
-- el escáner de facturas (mig 181): una herramienta que pregunta de más se deja
-- de abrir.
--
-- POR QUÉ EL FACTOR GUARDA SU PROCEDENCIA:
-- Gabriel, 6-sep-2026, sobre la tabla de conversión del acero: «esto se va a
-- encargar de completarlo la contadora, ella lo adecuará». Entonces el factor
-- que propone la norma (`tabla`), el que lee de la propia factura
-- (`descripcion`) y el que se asume por defecto (`supuesto`) se distinguen del
-- que ella grabó (`manual`), la pantalla los pinta distinto, y ninguno
-- `supuesto` se consolida solo.
--
-- SIN UNIQUE sobre `norm`, a propósito (patrón migs 113/154/182): Gabriel
-- alterna dos PCs y la app es offline-first. Dos devices decidiendo la misma
-- descripción sin red generarían un 23505 que el SyncEngine manda a conflictos
-- manuales por un caso benigno. La fila que vale se resuelve al LEER
-- (resolverMapeos en src/lib/mapeo-insumos.js: manual > ia > regla, y a igual
-- fuente gana updated_at). Aislamiento del modo prueba: `demo`.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS insumo_mapeo (
  id uuid PRIMARY KEY,
  -- Descripción de la línea NORMALIZADA por normMapeo(). Es la clave lógica.
  norm text NOT NULL,
  -- Un ejemplo del texto crudo, solo para que la pantalla muestre algo legible.
  muestra text,
  decision text NOT NULL DEFAULT 'mapeado' CHECK (decision IN ('mapeado','no_aplica')),
  -- Código del catálogo del presupuesto. Obligatorio si decision='mapeado'.
  insumo_codigo text,
  -- Cuántas unidades canónicas trae UNA unidad de la factura.
  factor numeric,
  factor_fuente text CHECK (factor_fuente IN ('tabla','descripcion','supuesto','manual')),
  unidad_origen text,
  unidad_destino text,
  -- Quién lo propuso. Manda sobre las demás al resolver (manual > ia > regla).
  fuente text NOT NULL DEFAULT 'manual' CHECK (fuente IN ('regla','ia','manual')),
  -- Puntaje del motor al momento de decidir. Solo para auditar después qué tan
  -- bien venía proponiendo; no se usa para nada al leer.
  score numeric,
  nota text,
  demo boolean NOT NULL DEFAULT false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE,
  CONSTRAINT insumo_mapeo_codigo_si_mapeado
    CHECK (decision <> 'mapeado' OR insumo_codigo IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_insumo_mapeo_norm
  ON insumo_mapeo (norm) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_insumo_mapeo_codigo
  ON insumo_mapeo (insumo_codigo) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_insumo_mapeo_updated ON insumo_mapeo;
CREATE TRIGGER trg_insumo_mapeo_updated
  BEFORE UPDATE ON insumo_mapeo
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE insumo_mapeo ENABLE ROW LEVEL SECURITY;

-- Mismo patrón que insumo_correlaciones (mig 154): la tabla solo contiene
-- NOMBRES de insumos y factores de conversión — ni precios ni montos —, así que
-- los autenticados leen y escriben; el DELETE físico queda para admin.
DROP POLICY IF EXISTS "insumo_mapeo: autenticado lee" ON insumo_mapeo;
CREATE POLICY "insumo_mapeo: autenticado lee" ON insumo_mapeo
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insumo_mapeo: autenticado inserta" ON insumo_mapeo;
CREATE POLICY "insumo_mapeo: autenticado inserta" ON insumo_mapeo
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "insumo_mapeo: autenticado actualiza" ON insumo_mapeo;
CREATE POLICY "insumo_mapeo: autenticado actualiza" ON insumo_mapeo
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "insumo_mapeo: admin borra" ON insumo_mapeo;
CREATE POLICY "insumo_mapeo: admin borra" ON insumo_mapeo
  FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));

NOTIFY pgrst, 'reload schema';
