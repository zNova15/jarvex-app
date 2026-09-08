-- ═══════════════════════════════════════════════════════════════════
-- 192 — EL CATÁLOGO CANÓNICO DE INSUMOS Y SERVICIOS — tanda 14, entrega 2.
--
-- Gabriel, 7-set-2026: «el archivo tiene una categorización simple, no es
-- perfecta, y el objetivo es que agilice el proceso de categorización».
-- `Modelos/Categorizacion Simple.xlsx` deja de ser un archivo suelto y pasa a
-- ser la lista contra la que la app propone nombres, unidades y familias:
-- 444 insumos en 10 familias comerciales, 34 servicios, y la disgregación del
-- acero.
--
-- POR QUÉ NO ALCANZABA CON LO QUE YA HABÍA:
--   · `insumos_partida` es el presupuesto DE UNA OBRA (434 códigos, con
--     obra_id): dice qué necesita Miraflores, no qué compra el grupo.
--   · `insumos_pendientes` (mig 122) son los nombres que alguien PIDIÓ y
--     todavía no existen en el inventario: es una bandeja, no un catálogo.
--   · `materiales`/`herramientas`/`epps` son el inventario REAL de cada obra,
--     con stock. Un catálogo de nombres no tiene stock ni obra.
-- Este catálogo es global al grupo, sin obra y sin stock: solo nombre, unidad
-- y familia.
--
-- 🔴 LA FAMILIA NO ES UN CUARTO VOCABULARIO. Ya conviven tres formas de
-- categorizar (clasificarInsumo → 5 tablas de inventario; clasificar-items →
-- 7 categorías de gasto; los 434 códigos del presupuesto). La familia
-- comercial del xlsx vive DENTRO de esta tabla y TRADUCE a las otras dos
-- (src/lib/catalogo-canonico.js: `tipoInsumoDe` y `categoriaItemDe`). Por eso
-- la columna se llama `familia` y no `categoria`: no compite con ninguna.
--
-- SIN UNIQUE sobre `norm`, a propósito (patrón migs 113/154/183): Gabriel
-- alterna dos PCs y la app es offline-first. Importar el mismo archivo en las
-- dos sin red generaría un 23505 que el SyncEngine manda a conflictos manuales
-- por un caso benigno. La fila que vale se resuelve al LEER
-- (`resolverCatalogo`: 'manual' pisa a 'xlsx', y a igual origen gana el
-- updated_at más reciente).
--
-- LO QUE EL ARCHIVO YA NO TRAE NO SE BORRA: se desactiva (`activo = false`).
-- Un insumo que salió del xlsx puede estar mapeado en `insumo_mapeo` o ser el
-- nombre de una línea de orden ya emitida; borrarlo dejaría huérfano un
-- documento formal. Y lo cargado a mano (`origen = 'manual'`) la importación
-- no lo toca nunca: el archivo no manda sobre lo que una persona escribió
-- después.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS catalogo_insumos (
  id uuid PRIMARY KEY,
  tipo text NOT NULL DEFAULT 'insumo' CHECK (tipo IN ('insumo','servicio')),
  -- El nombre tal como lo escribió quien arma el catálogo (mayúsculas, tildes,
  -- comillas de pulgada). Es lo que se le muestra a la gente.
  nombre text NOT NULL,
  -- La CLAVE LÓGICA: el nombre pasado por normMapeo() — la misma normalización
  -- del motor de mapeo, para que catálogo y línea de factura compartan espacio
  -- de claves y una cosa se pueda buscar en los dos lados con la misma llave.
  norm text NOT NULL,
  unidad text,
  -- Familia comercial (slug de FAMILIAS_CATALOGO). 'servicios' para la hoja
  -- de servicios.
  familia text NOT NULL DEFAULT 'otros',
  -- De dónde salió la fila. 'manual' gana sobre 'xlsx' al resolver y la
  -- importación no la pisa.
  origen text NOT NULL DEFAULT 'xlsx' CHECK (origen IN ('xlsx','manual')),
  activo boolean NOT NULL DEFAULT true,
  nota text,
  demo boolean NOT NULL DEFAULT false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_catalogo_insumos_norm
  ON catalogo_insumos (norm) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_catalogo_insumos_familia
  ON catalogo_insumos (familia) WHERE deleted_at IS NULL;

-- ── LA DISGREGACIÓN ────────────────────────────────────────────────
-- «ACERO CORRUGADO fy = 4200 kg/cm2 GRADO 60» se presupuesta en KILOS y se
-- compra en VARILLAS de 9 m. Es la primera fila de la hoja DISGREGADOS y el
-- caso que Gabriel puso de ejemplo.
--
-- EL FACTOR GUARDA SU PROCEDENCIA, igual que en insumo_mapeo (mig 183):
-- `tabla` (lo dice la norma), `descripcion` (lo dice el propio nombre: «x9m»),
-- `supuesto` (largo comercial asumido) o `manual` (lo grabó la contadora).
-- Gabriel, 6-sep-2026, sobre esta misma tabla: «esto se va a encargar de
-- completarlo la contadora, ella lo adecuará». Un factor que no se sabe se
-- guarda NULL; nunca se inventa un número para llenar la celda.
CREATE TABLE IF NOT EXISTS catalogo_disgregacion (
  id uuid PRIMARY KEY,
  -- El insumo como lo pide el presupuesto (el que está en kg).
  padre_norm text NOT NULL,
  padre_nombre text NOT NULL,
  padre_unidad text,
  -- La presentación en que se compra de verdad (la varilla).
  hijo_norm text NOT NULL,
  hijo_nombre text NOT NULL,
  hijo_unidad text,
  -- Cuántas unidades del PADRE trae UNA del hijo (una varilla de 1/2" × 9 m
  -- son 8,946 kg).
  factor numeric,
  factor_fuente text CHECK (factor_fuente IN ('tabla','descripcion','supuesto','manual')),
  nota text,
  origen text NOT NULL DEFAULT 'xlsx' CHECK (origen IN ('xlsx','manual')),
  activo boolean NOT NULL DEFAULT true,
  demo boolean NOT NULL DEFAULT false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_catalogo_disgregacion_padre
  ON catalogo_disgregacion (padre_norm) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_catalogo_disgregacion_hijo
  ON catalogo_disgregacion (hijo_norm) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_catalogo_insumos_updated ON catalogo_insumos;
CREATE TRIGGER trg_catalogo_insumos_updated
  BEFORE UPDATE ON catalogo_insumos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_catalogo_disgregacion_updated ON catalogo_disgregacion;
CREATE TRIGGER trg_catalogo_disgregacion_updated
  BEFORE UPDATE ON catalogo_disgregacion
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE catalogo_insumos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogo_disgregacion  ENABLE ROW LEVEL SECURITY;

-- Mismo criterio que insumo_mapeo (mig 183) e insumo_correlaciones (mig 154):
-- estas tablas solo contienen NOMBRES, UNIDADES y FACTORES DE CONVERSIÓN — ni
-- precios, ni montos, ni obra. TODOS los autenticados las LEEN (el catálogo
-- tiene que proponerle nombres hasta a la almacenera y al ingeniero); ESCRIBIR
-- queda para admin y gerente, que es quien importa el archivo, y el DELETE
-- físico solo para admin.
DROP POLICY IF EXISTS "catalogo_insumos: autenticado lee" ON catalogo_insumos;
CREATE POLICY "catalogo_insumos: autenticado lee" ON catalogo_insumos
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "catalogo_insumos: gerencia inserta" ON catalogo_insumos;
CREATE POLICY "catalogo_insumos: gerencia inserta" ON catalogo_insumos
  FOR INSERT TO authenticated WITH CHECK (has_role(ARRAY['admin'::text,'gerente'::text]));
DROP POLICY IF EXISTS "catalogo_insumos: gerencia actualiza" ON catalogo_insumos;
CREATE POLICY "catalogo_insumos: gerencia actualiza" ON catalogo_insumos
  FOR UPDATE TO authenticated USING (has_role(ARRAY['admin'::text,'gerente'::text]));
DROP POLICY IF EXISTS "catalogo_insumos: admin borra" ON catalogo_insumos;
CREATE POLICY "catalogo_insumos: admin borra" ON catalogo_insumos
  FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));

DROP POLICY IF EXISTS "catalogo_disgregacion: autenticado lee" ON catalogo_disgregacion;
CREATE POLICY "catalogo_disgregacion: autenticado lee" ON catalogo_disgregacion
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "catalogo_disgregacion: gerencia inserta" ON catalogo_disgregacion;
CREATE POLICY "catalogo_disgregacion: gerencia inserta" ON catalogo_disgregacion
  FOR INSERT TO authenticated WITH CHECK (has_role(ARRAY['admin'::text,'gerente'::text]));
DROP POLICY IF EXISTS "catalogo_disgregacion: gerencia actualiza" ON catalogo_disgregacion;
CREATE POLICY "catalogo_disgregacion: gerencia actualiza" ON catalogo_disgregacion
  FOR UPDATE TO authenticated USING (has_role(ARRAY['admin'::text,'gerente'::text]));
DROP POLICY IF EXISTS "catalogo_disgregacion: admin borra" ON catalogo_disgregacion;
CREATE POLICY "catalogo_disgregacion: admin borra" ON catalogo_disgregacion
  FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));

NOTIFY pgrst, 'reload schema';
