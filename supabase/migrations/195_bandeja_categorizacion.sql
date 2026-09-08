-- ═══════════════════════════════════════════════════════════════════
-- 195 — LA BANDEJA QUE APRENDE — tanda 14, entrega 4.
--
-- QUÉ DECIDE ESTA TABLA
-- «Esta descripción de factura ES este insumo del catálogo canónico» — o «esto
-- no es un insumo». Una decisión por TEXTO, no por factura: el mismo nombre
-- aparece en facturas de varias entidades, se decide una vez y vale para todas,
-- las de ayer y las que entren mañana.
--
-- ── POR QUÉ NO REUSA `insumo_mapeo` (mig 183) ─────────────────────
-- Porque son preguntas distintas contra catálogos distintos, y compartirlas
-- rompería la que ya funciona. `insumo_mapeo` responde «¿qué CÓDIGO DEL
-- PRESUPUESTO de la obra es esto?» (434 códigos) y alimenta Abastecimiento.
-- Su llave lógica es `norm`, y `resolverMapeos()` devuelve UNA fila por norm.
-- Si la bandeja escribiera ahí, la pestaña «Mapeo al presupuesto» leería un id
-- de `catalogo_insumos` como si fuera un código del presupuesto —no existe
-- entre los 434— y el cruce oferta/demanda de Abastecimiento se envenenaría en
-- silencio. Tabla aparte, entonces; las dos conviven y ninguna pisa a la otra.
--
-- ── LO MEDIDO CONTRA PRODUCCIÓN ANTES DE ESCRIBIR (7-set-2026) ────
-- 2.424 líneas de compra → 1.885 descripciones distintas, S/ 1.950.400, en 24
-- entidades. NO hay Pareto corto: el top 20 es el 34,6% de la plata, el top 100
-- el 68,4%, y hacen falta 200 decisiones para llegar al 83,5%. Al otro extremo,
-- 1.473 de esas 1.885 mueven menos de S/ 500 cada una y juntas son el 5,8%:
-- comida de restaurante, medicinas, ropa, «artículo 1», «saldos». Por eso la
-- bandeja ordena por plata y por eso `no_insumo` se opera EN LOTE — sin las dos
-- cosas la pantalla no se termina nunca.
--
-- ── `decision = 'no_insumo'` ES UNA RESPUESTA, NO UN DESCARTE ─────
-- Es la lección de mig 183 y de mig 181: lo que no se guarda vuelve a
-- preguntarse en cada visita, y una pantalla que repite lo ya contestado se
-- abandona. «Esto no es un insumo del catálogo» se recuerda igual que un
-- mapeo, y ni esta PC ni la otra lo vuelven a preguntar.
--
-- ── SIN UNIQUE SOBRE (company_id, norm), A PROPÓSITO ──────────────
-- Lo mismo que migs 113/154/183/192/193: Gabriel alterna dos PCs y la app es
-- offline-first. Dos devices decidiendo la misma descripción generarían un
-- 23505 que el SyncEngine manda a conflictos manuales por un caso benigno. Se
-- resuelve al LEER (`resolverCategorias()` en src/lib/bandeja-categorizacion.js):
-- 'manual' pisa a 'regla', y a igual fuente gana la más reciente.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS insumo_categoria (
  id uuid PRIMARY KEY,

  -- La descripción de la factura pasada por normMapeo() — la MISMA
  -- normalización del motor de mapeo, para que la decisión y la propuesta
  -- hablen el mismo idioma.
  norm text NOT NULL,
  -- Un ejemplar del texto crudo, para que la pantalla muestre algo legible.
  muestra text,

  -- 'catalogo'  → es el insumo `catalogo_insumo_id`.
  -- 'no_insumo' → no está en el catálogo y no debe estarlo (comida, medicinas,
  --               anticipos, liquidaciones). Se recuerda; no se vuelve a pedir.
  decision text NOT NULL CHECK (decision IN ('catalogo','no_insumo')),

  -- A qué fila del catálogo canónico. NULL cuando decision = 'no_insumo'.
  -- Sin FK dura a catalogo_insumos: esa tabla se desactiva por `activo`, no se
  -- borra, pero una fila creada offline en la otra PC puede no haber llegado
  -- todavía y una FK real haría fallar el push por orden de llegada.
  catalogo_insumo_id uuid,

  -- La familia/subfamilia que quedó, copiadas al decidir. Redundantes contra
  -- catalogo_insumos a propósito: son la respuesta CONGELADA. Si mañana alguien
  -- mueve el insumo de familia, lo que se decidió acá no cambia de sentido solo
  -- por eso — y el reporte de gasto por familia de un periodo cerrado no se
  -- mueve solo. Vacías cuando decision = 'no_insumo'.
  familia text,
  subfamilia text,

  -- La unidad que decía la factura y la del catálogo, con el factor entre las
  -- dos cuando difieren (varillas ↔ kg). Misma disciplina de procedencia que
  -- mig 183: 'tabla' (norma), 'descripcion' (lo dice la propia factura),
  -- 'supuesto' (default de la familia) o 'manual' (lo escribió una persona).
  unidad_origen text,
  unidad_destino text,
  factor numeric,
  factor_fuente text CHECK (factor_fuente IN ('tabla','descripcion','supuesto','manual')),

  -- 'regla' = lo propuso el motor y nadie lo tocó; 'manual' = lo decidió una
  -- persona. 'manual' PISA a 'regla' para siempre, y 'regla' nunca pisa a
  -- 'manual' — la disciplina de clasificar-items.js.
  fuente text NOT NULL DEFAULT 'manual' CHECK (fuente IN ('regla','manual')),
  -- El puntaje del motor cuando la propuesta salió de él, para poder auditar
  -- después qué tan buena era.
  score numeric,
  nota text,

  -- El catálogo tiene dueño desde mig 193, y la decisión también: NULL = vale
  -- para todo el grupo; con valor = solo para esa entidad. Parado en una
  -- entidad se ve lo suyo + lo general, y lo suyo manda.
  company_id uuid REFERENCES companies(id),

  demo boolean NOT NULL DEFAULT false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE,

  -- Un insumo del catálogo es obligatorio si se dijo que es del catálogo, y
  -- está prohibido si se dijo que no lo es. Sin esto, una fila 'no_insumo' con
  -- `catalogo_insumo_id` cargado haría que el gasto se cuente dos veces.
  CONSTRAINT insumo_categoria_catalogo_coherente CHECK (
    (decision = 'catalogo'  AND catalogo_insumo_id IS NOT NULL) OR
    (decision = 'no_insumo' AND catalogo_insumo_id IS NULL)
  )
);

COMMENT ON TABLE insumo_categoria IS
  'Qué insumo del catálogo canónico es cada descripción de factura. Tanda 14, entrega 4. NO reemplaza insumo_mapeo (mig 183), que apunta al presupuesto de la obra.';
COMMENT ON COLUMN insumo_categoria.decision IS
  'catalogo = es este insumo. no_insumo = no está en el catálogo y no debe estarlo; se recuerda para no volver a preguntarlo.';
COMMENT ON COLUMN insumo_categoria.familia IS
  'La familia CONGELADA al decidir: mover el insumo de familia después no cambia lo que ya se decidió.';

-- Toda lectura pregunta lo mismo: «lo de esta entidad más lo general, por
-- norm». Sin este índice es un full scan en cada propuesta de la bandeja.
CREATE INDEX IF NOT EXISTS idx_insumo_categoria_norm
  ON insumo_categoria (company_id, norm) WHERE deleted_at IS NULL;
-- El avance de la bandeja se cuenta por decisión.
CREATE INDEX IF NOT EXISTS idx_insumo_categoria_decision
  ON insumo_categoria (decision) WHERE deleted_at IS NULL;
-- «¿Qué se compró de este insumo del catálogo?» — el cruce que habilita medir
-- el gasto por familia sin recorrer la tabla entera.
CREATE INDEX IF NOT EXISTS idx_insumo_categoria_insumo
  ON insumo_categoria (catalogo_insumo_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_insumo_categoria_updated ON insumo_categoria;
CREATE TRIGGER trg_insumo_categoria_updated
  BEFORE UPDATE ON insumo_categoria
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE insumo_categoria ENABLE ROW LEVEL SECURITY;

-- Mismo criterio que catalogo_insumos (mig 192) y catalogo_familia_mapeo
-- (mig 193): son NOMBRES DE CATEGORÍAS, sin plata. Todos leen —la almacenera y
-- el ingeniero necesitan que el catálogo les proponga igual que al contador—;
-- escriben admin y gerente; el DELETE físico solo admin.
DROP POLICY IF EXISTS "insumo_categoria: autenticado lee" ON insumo_categoria;
CREATE POLICY "insumo_categoria: autenticado lee" ON insumo_categoria
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insumo_categoria: gerencia inserta" ON insumo_categoria;
CREATE POLICY "insumo_categoria: gerencia inserta" ON insumo_categoria
  FOR INSERT TO authenticated WITH CHECK (has_role(ARRAY['admin'::text,'gerente'::text]));
DROP POLICY IF EXISTS "insumo_categoria: gerencia actualiza" ON insumo_categoria;
CREATE POLICY "insumo_categoria: gerencia actualiza" ON insumo_categoria
  FOR UPDATE TO authenticated USING (has_role(ARRAY['admin'::text,'gerente'::text]));
DROP POLICY IF EXISTS "insumo_categoria: admin borra" ON insumo_categoria;
CREATE POLICY "insumo_categoria: admin borra" ON insumo_categoria
  FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));

-- ═══════════════════════════════════════════════════════════════════
-- EL ACERO CORRUGADO, QUE LA ENTREGA 2 DEJÓ FUERA DEL CATÁLOGO
--
-- Medido hoy: el padre «ACERO CORRUGADO fy = 4200 kg/cm2 GRADO 60» y sus
-- cuatro presentaciones en varillas de 9 m viven SOLO en
-- `catalogo_disgregacion`. Nunca entraron a `catalogo_insumos`, así que el
-- insumo más caro de la obra —S/ 88.000 en varillas de 1/4", 3/8", 1/2" y 5/8"
-- repartidos en cinco descripciones distintas— no tiene contra qué proponerse
-- y cae siempre en «sin candidato».
--
-- Medido el efecto de arreglarlo sobre las 184 descripciones más caras: la
-- plata con propuesta pasa de 11,9% a 17,7% y la que no tiene candidato baja de
-- 51,9% a 44,9%. Es el arreglo de mayor palanca de toda la entrega.
--
-- Se insertan desde la propia tabla de disgregación (no a mano) para que el
-- nombre y la unidad sean exactamente los que ya están cargados. `origen` queda
-- en 'xlsx' porque de ahí salieron: si Gabriel reimporta el archivo, el diff
-- las reconoce por `norm` y no las duplica.
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO catalogo_insumos (id, tipo, nombre, norm, unidad, familia, origen, activo, nota, demo, company_id)
SELECT gen_random_uuid(), 'insumo', f.nombre, f.norm, f.unidad, 'ferreteria', 'xlsx', true,
       'Alta desde la disgregación del acero (mig 195): el xlsx lo traía solo en la hoja DISGREGADOS.',
       false, f.company_id
FROM (
  -- UNION (no UNION ALL): la misma fila padre se repite en cada hijo, así que
  -- sin deduplicar se insertarían cuatro «ACERO CORRUGADO fy = 4200» iguales.
  SELECT padre_nombre AS nombre, padre_norm AS norm, padre_unidad AS unidad, company_id
  FROM catalogo_disgregacion WHERE deleted_at IS NULL AND COALESCE(activo, true)
  UNION
  SELECT hijo_nombre AS nombre, hijo_norm AS norm, hijo_unidad AS unidad, company_id
  FROM catalogo_disgregacion WHERE deleted_at IS NULL AND COALESCE(activo, true)
) f
WHERE f.norm IS NOT NULL AND f.nombre IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM catalogo_insumos c
    WHERE c.deleted_at IS NULL AND c.norm = f.norm
      AND c.company_id IS NOT DISTINCT FROM f.company_id
  );

NOTIFY pgrst, 'reload schema';
