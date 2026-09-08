-- ═══════════════════════════════════════════════════════════════════
-- 198 — EL REQUISITO, COMO LO PIDEN LAS BASES DE VERDAD — tanda 15.
--
-- La mig 197 modeló un requisito de personal como "X meses en tal rubro".
-- Al medir las bases REALES que trajo Gabriel el 8-set-2026 (Anexos 12 y 13
-- del proceso de Chilete, Gobierno Regional de Cajamarca) resultó que esa
-- forma cubre menos de la mitad del requisito. Literal de esas bases:
--
--   «Jefe de Supervisión del Proyecto — Experiencia no menor de 03 AÑOS,
--    sustentada con copia de diploma de incorporación al Colegio respectivo.
--    Sustentar como mínimo 02 PARTICIPACIONES como Residente de obra y/o
--    Supervisor de obra y/o Inspector de obra y/o Gerente de obra y/o Gerente
--    de proyecto y/o Ingeniero residente y/o Ingeniero supervisor y/o Jefe de
--    Obra y/o Jefe de Supervisión de Obra en la ejecución de obras iguales o
--    similares al objeto de la convocatoria, por un plazo NO MENOR A 02 MESES
--    CADA PARTICIPACIÓN, EN LOS ÚLTIMOS 10 AÑOS.»
--
-- Ese párrafo tiene CINCO criterios y la mig 197 guardaba uno.
--
-- EL FALSO ✅ QUE ESTO CIERRA: alguien con cinco años seguidos en UNA sola
-- obra pasaba el filtro de meses y el verificador lo daba por calificado.
-- No califica: le falta la segunda participación. Un verificador que dice
-- "sí" cuando la respuesta es "no" es peor que no tener verificador — es la
-- semana de trabajo que este módulo existe para no perder.
--
-- LAS PARTICIPACIONES NO SE FUSIONAN. Es lo contrario de los meses: dos obras
-- simultáneas son UN año (por eso la mig 171 fusiona periodos) pero son DOS
-- participaciones. Son dos preguntas distintas sobre los mismos datos y cada
-- una tiene su regla; mezclarlas rompe una de las dos.
--
-- POR QUÉ `cargos_equivalentes` ES UNA LISTA Y NO UN TEXTO: son diez
-- sinónimos por puesto, distintos en cada puesto y redactados a mano por cada
-- entidad. Con texto libre no hay forma de preguntar "¿el cargo de esta
-- constancia está en la lista?", que es exactamente lo único que se le pide.
--
-- POR QUÉ `definicion_obras_similares` VA EN `licitaciones` Y NO EN EL PUESTO:
-- "obras iguales o similares al objeto de la convocatoria" se define UNA VEZ
-- por proceso, y en estas bases es una lista larguísima («casa comunal y/o
-- colegios y/o institutos y/o universidades y/o edificaciones en general…»).
-- NO es un rubro del catálogo `rubros_obra`: el rubro es nuestra taxonomía
-- estable, esto es la definición que escribió esta entidad para este proceso.
-- Conviven: el rubro filtra, la definición se le muestra a quien decide.
--
-- Y `colegiatura_fecha` EN LA FICHA: la experiencia general de esas bases se
-- acredita «con copia de diploma de incorporación al Colegio», o sea que se
-- cuenta desde que la persona se colegió. La mig 171 guardaba hasta cuándo
-- está HÁBIL, que es otra cosa: sirve para saber si puede presentarse hoy, no
-- cuántos años lleva. Sin este campo los 03 años no se pueden medir.
--
-- Todo aditivo, con defaults que APAGAN los criterios nuevos: una fila vieja
-- se sigue evaluando exactamente igual que antes de esta migración.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. La definición de "obra similar" es del PROCESO ──────────────
ALTER TABLE public.licitaciones
  ADD COLUMN IF NOT EXISTS definicion_obras_similares text;

COMMENT ON COLUMN public.licitaciones.definicion_obras_similares IS
  'Qué cuenta como "obra igual o similar" segun ESTAS bases. Texto de la entidad, no un rubro del catalogo.';

-- ── 2. Los cuatro criterios que faltaban en el puesto ──────────────
ALTER TABLE public.licitacion_requisitos
  -- «como mínimo 02 participaciones». Distinto de los meses: no se fusiona.
  ADD COLUMN IF NOT EXISTS participaciones_minimas integer NOT NULL DEFAULT 0,
  -- «por un plazo no menor a 02 meses cada participación». Las más cortas no
  -- cuentan como participación (aunque sus meses sí sumen al total).
  ADD COLUMN IF NOT EXISTS meses_por_participacion numeric(8,1) NOT NULL DEFAULT 0,
  -- «en los últimos 10 años». NULL = las bases no acotan la antigüedad.
  ADD COLUMN IF NOT EXISTS ventana_anios integer,
  -- Los sinónimos de cargo que las bases aceptan para ESTE puesto.
  ADD COLUMN IF NOT EXISTS cargos_equivalentes jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- «experiencia no menor de 03 años» (la general, por colegiatura). Es OTRO
  -- número que `meses_minimos`, que mide la experiencia ESPECÍFICA en el cargo.
  ADD COLUMN IF NOT EXISTS meses_generales_minimos numeric(8,1) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.licitacion_requisitos.participaciones_minimas IS
  'Cuantas participaciones distintas exigen las bases. NO se fusionan periodos: dos obras simultaneas son DOS participaciones y UN ano.';
COMMENT ON COLUMN public.licitacion_requisitos.meses_generales_minimos IS
  'Experiencia general, la que se acredita con la colegiatura. Distinta de meses_minimos (especifica en el cargo).';

ALTER TABLE public.licitacion_requisitos
  DROP CONSTRAINT IF EXISTS licitacion_requisitos_cargos_equivalentes_check;
ALTER TABLE public.licitacion_requisitos
  ADD CONSTRAINT licitacion_requisitos_cargos_equivalentes_check
  CHECK (jsonb_typeof(cargos_equivalentes) = 'array');

-- ── 3. Desde cuándo está colegiado ─────────────────────────────────
ALTER TABLE public.personal_profesional
  ADD COLUMN IF NOT EXISTS colegiatura_fecha date;

COMMENT ON COLUMN public.personal_profesional.colegiatura_fecha IS
  'Fecha de incorporacion al colegio profesional. Es con lo que las bases acreditan la experiencia GENERAL; colegiatura_habil_hasta solo dice si puede presentarse hoy.';

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- VERIFICACIÓN
--   SELECT column_name, data_type, column_default
--     FROM information_schema.columns
--    WHERE table_name='licitacion_requisitos'
--      AND column_name IN ('participaciones_minimas','meses_por_participacion',
--                          'ventana_anios','cargos_equivalentes','meses_generales_minimos')
--    ORDER BY column_name;   -- esperado: 5 filas
--
-- REVERTIR
--   ALTER TABLE public.licitacion_requisitos
--     DROP COLUMN IF EXISTS participaciones_minimas,
--     DROP COLUMN IF EXISTS meses_por_participacion,
--     DROP COLUMN IF EXISTS ventana_anios,
--     DROP COLUMN IF EXISTS cargos_equivalentes,
--     DROP COLUMN IF EXISTS meses_generales_minimos;
--   ALTER TABLE public.licitaciones DROP COLUMN IF EXISTS definicion_obras_similares;
--   ALTER TABLE public.personal_profesional DROP COLUMN IF EXISTS colegiatura_fecha;
--   NOTIFY pgrst, 'reload schema';
-- ═══════════════════════════════════════════════════════════════════
