-- ═══════════════════════════════════════════════════════════════════
-- 206 — QUÉ INSUMO DEL TRABAJO ES CADA INSUMO DE LA EMPRESA
--
-- QUÉ DECIDE ESTA TABLA
-- «El insumo X del catálogo de esta empresa ES el insumo Y del presupuesto de
-- este trabajo» — o «no está en ese presupuesto». Una fila por par
-- (trabajo, insumo de la empresa).
--
-- ── EL PEDIDO, TEXTUAL (Gabriel, 13-set-2026) ─────────────────────
-- «Lo que sí quiero mejorar es la sección de mapeo de presupuestos: esta
-- sección debería ser súper sencilla en realidad. Para empezar debería
-- detectar si el consorcio ejecutor ya clasificó los insumos y servicios del
-- presupuesto en base a la ley de clasificaciones (estos insumos y servicios
-- son distintos a las compras y ventas que realice el consorcio ejecutor). Con
-- los insumos y servicios del presupuesto que tenga clasificados solo se
-- comparará con los insumos y servicios ya clasificados de la empresa. Se
-- avisa aquí cuánto porcentaje falta clasificar del trabajo elegido (obra,
-- supervisión, etc) y pues de la empresa misma. […] Aquí no se vincula las
-- compras ni nada de eso, solo se mapea.»
--
-- Y el para qué: «que se tenga mapeado los insumos de cada empresa cómo se
-- relacionan con los diferentes insumos y servicios de los diferentes trabajos
-- que tenemos en el app. Para ya luego realizar diferentes acciones, pero
-- tener una relación clara de insumos y servicios entre las empresas y los
-- trabajos a realizar.»
--
-- ── POR QUÉ NO SIRVE `insumo_mapeo` (mig 183) ─────────────────────
-- Dos razones, y la segunda es un bug latente:
--
-- 1. MAPEA OTRA COSA. `insumo_mapeo.norm` es la DESCRIPCIÓN CRUDA DE UNA
--    FACTURA. Esto mapea un insumo del CATÁLOGO de la empresa, que es el nivel
--    donde la relación es estable: las descripciones son 2.220 en el grupo y
--    los insumos del catálogo 484. Con `insumo_categoria` (mig 195) ya
--    resolviendo descripción → catálogo, mapear el catálogo → presupuesto hace
--    que la cadena entera se derive de dos decisiones cortas en vez de 2.220
--    largas.
--
-- 2. NO TIENE TRABAJO. `insumo_mapeo` no guarda a qué obra pertenece el
--    `insumo_codigo`, y los códigos del presupuesto son POR OBRA. Con una sola
--    obra presupuestada (434 insumos) y 3 filas mapeadas nunca se notó, pero en
--    cuanto entre el presupuesto de la segunda obra una decisión tomada contra
--    la primera aparecería como «ya decidida» contra un código que en la
--    segunda no existe. Acá `obra_id` es NOT NULL, que es lo que la pregunta
--    pide.
--
-- `insumo_mapeo` se queda como está: la lee Abastecimiento y la escriben las
-- órdenes. Las dos conviven; ninguna pisa a la otra.
--
-- ── LO MEDIDO ANTES DE ESCRIBIR (13-set-2026) ─────────────────────
-- · 2 obras cargadas; UNA con presupuesto: «MEJORAMIENTO, AMPLIACION DEL
--   SERVICIO DE AGUA POTABLE…», 6.722 filas de `insumos_partida` que
--   consolidan en 434 insumos distintos (382 materiales + 52 no-materiales).
-- · 484 filas de catálogo (483 del grupo + 1 propia de GASOMI).
-- · `insumos_partida` NO tiene columna de clasificación. La del presupuesto se
--   deriva con el MISMO clasificador que la de la empresa
--   (`clasificarConIUPC`), así que los dos lados hablan el mismo idioma sin
--   agregarle una columna a una tabla de 6.722 filas que se reimporta entera
--   cada vez que se carga un presupuesto nuevo.
--
-- ── SIN UNIQUE SOBRE (obra_id, company_id, norm), A PROPÓSITO ─────
-- Lo mismo que migs 113/154/183/192/193/195: Gabriel alterna dos PCs y la app
-- es offline-first. Dos devices decidiendo el mismo par generarían un 23505
-- que el SyncEngine manda a conflictos manuales por un caso benigno. Se
-- resuelve al LEER (`resolverMapeosTrabajo()` en src/lib/mapeo-trabajo.js):
-- 'manual' pisa a 'regla' y, a igual fuente, gana la más reciente.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS insumo_trabajo_mapeo (
  id uuid PRIMARY KEY,

  -- El trabajo cuyo presupuesto estamos mapeando. NOT NULL: un mapeo sin
  -- trabajo no significa nada, porque los códigos son de SU presupuesto.
  obra_id uuid NOT NULL REFERENCES obras(id),

  -- De qué empresa es el insumo mapeado. NULL = el catálogo GENERAL del grupo,
  -- igual que en catalogo_insumos (mig 193) y en insumo_categoria (mig 195):
  -- parado en una entidad se ve lo suyo + lo general, y lo suyo manda.
  company_id uuid REFERENCES companies(id),

  -- El insumo de la EMPRESA: su `norm` (la clave lógica del catálogo, pasada
  -- por la misma normMapeo) y, para poder navegar, el id de la fila. Sin FK
  -- dura a catalogo_insumos por lo de siempre: una fila creada offline en la
  -- otra PC puede no haber llegado todavía y la FK haría fallar el push por
  -- orden de llegada.
  norm text NOT NULL,
  catalogo_insumo_id uuid,
  -- Su nombre, congelado al decidir: si mañana alguien renombra el insumo del
  -- catálogo, lo que se decidió no deja de poder leerse.
  muestra text,

  -- 'mapeado' → es el insumo `insumo_codigo` del presupuesto de esta obra.
  -- 'no_esta' → este insumo de la empresa NO está en ese presupuesto. Es una
  --             RESPUESTA, no un descarte: se recuerda, igual que 'no_aplica'
  --             en mig 183 y 'no_insumo' en mig 195. Lo que no se guarda vuelve
  --             a preguntarse en cada visita, y una pantalla que repite lo ya
  --             contestado se abandona.
  decision text NOT NULL DEFAULT 'mapeado' CHECK (decision IN ('mapeado','no_esta')),

  -- El código del insumo del presupuesto (`insumos_partida.insumo_codigo`).
  -- Obligatorio si decision = 'mapeado'.
  insumo_codigo text,
  -- Y su nombre, también congelado: los presupuestos se reimportan.
  insumo_nombre text,

  -- Las unidades de los dos lados con el factor entre ellas cuando difieren
  -- (el presupuesto pide kg, la empresa compra varillas). Misma disciplina de
  -- procedencia que mig 183: 'tabla' (norma), 'descripcion' (lo dice el propio
  -- nombre), 'supuesto' (valor comercial asumido) o 'manual' (lo escribió una
  -- persona).
  unidad_origen text,
  unidad_destino text,
  factor numeric,
  factor_fuente text CHECK (factor_fuente IN ('tabla','descripcion','supuesto','manual')),

  -- 'regla' = lo propuso el motor y nadie lo tocó; 'manual' = lo decidió una
  -- persona. 'manual' PISA a 'regla' para siempre y 'regla' nunca pisa a
  -- 'manual'.
  fuente text NOT NULL DEFAULT 'manual' CHECK (fuente IN ('regla','ia','manual')),
  -- El puntaje del motor cuando la propuesta salió de él, para poder auditar
  -- después qué tan buena era.
  score numeric,
  nota text,

  demo boolean NOT NULL DEFAULT false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  last_synced_at timestamptz,
  deleted_at timestamptz,
  idempotency_key text UNIQUE,

  -- Un código del presupuesto es obligatorio si se dijo que está mapeado, y
  -- está prohibido si se dijo que no está. Sin esto, una fila 'no_esta' con
  -- código cargado haría que el insumo cuente de los dos lados.
  CONSTRAINT insumo_trabajo_mapeo_coherente CHECK (
    (decision = 'mapeado' AND insumo_codigo IS NOT NULL) OR
    (decision = 'no_esta' AND insumo_codigo IS NULL)
  )
);

COMMENT ON TABLE insumo_trabajo_mapeo IS
  'Qué insumo del presupuesto de un trabajo es cada insumo del catálogo de una empresa. Tanda 19. NO reemplaza insumo_mapeo (mig 183), que mapea descripciones de factura y la lee Abastecimiento.';
COMMENT ON COLUMN insumo_trabajo_mapeo.decision IS
  'mapeado = es este insumo del presupuesto. no_esta = este insumo de la empresa no esta en ese presupuesto; se recuerda para no volver a preguntarlo.';
COMMENT ON COLUMN insumo_trabajo_mapeo.insumo_nombre IS
  'El nombre del insumo del presupuesto CONGELADO al decidir: los presupuestos se reimportan y la decision tiene que seguir leyendose.';

-- Toda lectura pregunta lo mismo: «lo de este trabajo y esta entidad, más lo
-- general». Sin el índice es un full scan por cada fila de la pantalla.
CREATE INDEX IF NOT EXISTS idx_insumo_trabajo_mapeo_llave
  ON insumo_trabajo_mapeo (obra_id, company_id, norm) WHERE deleted_at IS NULL;
-- «¿Qué insumos de las empresas apuntan a este código del presupuesto?» — el
-- cruce inverso, que es el que contesta «¿ya sé quién me vende esto?».
CREATE INDEX IF NOT EXISTS idx_insumo_trabajo_mapeo_codigo
  ON insumo_trabajo_mapeo (obra_id, insumo_codigo) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_insumo_trabajo_mapeo_updated ON insumo_trabajo_mapeo;
CREATE TRIGGER trg_insumo_trabajo_mapeo_updated
  BEFORE UPDATE ON insumo_trabajo_mapeo
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE insumo_trabajo_mapeo ENABLE ROW LEVEL SECURITY;

-- Mismo criterio que catalogo_insumos (mig 192) e insumo_categoria (mig 195):
-- son NOMBRES Y EQUIVALENCIAS, sin plata. Todos leen —el ingeniero y la
-- almacenera necesitan saber qué insumo del presupuesto es lo que tienen en la
-- mano igual que el contador—; escriben admin y gerente; el DELETE físico solo
-- admin.
DROP POLICY IF EXISTS "insumo_trabajo_mapeo: autenticado lee" ON insumo_trabajo_mapeo;
CREATE POLICY "insumo_trabajo_mapeo: autenticado lee" ON insumo_trabajo_mapeo
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insumo_trabajo_mapeo: gerencia inserta" ON insumo_trabajo_mapeo;
CREATE POLICY "insumo_trabajo_mapeo: gerencia inserta" ON insumo_trabajo_mapeo
  FOR INSERT TO authenticated WITH CHECK (has_role(ARRAY['admin'::text,'gerente'::text]));
DROP POLICY IF EXISTS "insumo_trabajo_mapeo: gerencia actualiza" ON insumo_trabajo_mapeo;
CREATE POLICY "insumo_trabajo_mapeo: gerencia actualiza" ON insumo_trabajo_mapeo
  FOR UPDATE TO authenticated USING (has_role(ARRAY['admin'::text,'gerente'::text]));
DROP POLICY IF EXISTS "insumo_trabajo_mapeo: admin borra" ON insumo_trabajo_mapeo;
CREATE POLICY "insumo_trabajo_mapeo: admin borra" ON insumo_trabajo_mapeo
  FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));
