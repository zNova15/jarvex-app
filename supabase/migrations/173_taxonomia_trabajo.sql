-- ═══════════════════════════════════════════════════════════════════
-- 173 — Eje de TAXONOMÍA DEL TRABAJO en obras (naturaleza × origen)
--
-- Tanda 1 de 3, punto "taxonomía de trabajo" (docs/tanda-1-modelo-de-datos.md).
--
-- EL AGUJERO QUE TAPA: hoy una obra solo se clasifica por `estado` (el ciclo de
-- vida), `rubro_id` (mig 171, la especialidad técnica) y `ejecutora_tipo`
-- (empresa o consorcio). NO existe ningún eje que diga QUÉ CLASE DE TRABAJO es:
-- ejecutar una obra no es lo mismo que hacer su expediente técnico, y
-- supervisar no es ninguna de las dos. Hoy las tres son "una obra" idéntica.
--
-- SON CUATRO VALORES, NO CINCO. El documento lista cinco naturalezas e incluye
-- "bienes y servicios" entre ellas. Esa quinta NO entra acá: por decisión de
-- Gabriel va a su propia tabla `trabajos` (mig 174), porque un flujo corto de
-- cotización → compra → venta no tiene partidas, cronograma, avance, personal
-- de campo ni estructura de costos — es decir, no tiene casi nada de lo que
-- hace que una obra sea una obra. Las otras cuatro SÍ son obras: tienen
-- partidas, etapas y gente asignada.
--
-- ORIGEN (público/privado) va acá y no en un catálogo aparte porque no es una
-- clasificación que crezca: son dos, y de ellos dependen reglas distintas
-- (valorizaciones, penalidades, adelantos) en obra pública.
--
-- Aditivo. Los defaults describen correctamente las obras existentes: ambas son
-- de ejecución y su cliente es el GOBIERNO REGIONAL DE CAJAMARCA.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.obras ADD COLUMN IF NOT EXISTS tipo_trabajo text NOT NULL DEFAULT 'obra_ejecucion';
ALTER TABLE public.obras ADD COLUMN IF NOT EXISTS origen       text NOT NULL DEFAULT 'publico';

ALTER TABLE public.obras DROP CONSTRAINT IF EXISTS obras_tipo_trabajo_check;
ALTER TABLE public.obras ADD CONSTRAINT obras_tipo_trabajo_check
  CHECK (tipo_trabajo = ANY (ARRAY[
    'obra_ejecucion',          -- ejecutar una obra ya diseñada
    'obra_expediente',         -- expediente técnico + ejecución
    'supervision',             -- supervisión sola
    'supervision_expediente'   -- supervisión de expediente + ejecución
  ]));

ALTER TABLE public.obras DROP CONSTRAINT IF EXISTS obras_origen_check;
ALTER TABLE public.obras ADD CONSTRAINT obras_origen_check
  CHECK (origen = ANY (ARRAY['publico'::text, 'privado'::text]));

CREATE INDEX IF NOT EXISTS idx_obras_tipo_trabajo
  ON public.obras (tipo_trabajo) WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.obras.tipo_trabajo IS
  'Naturaleza del trabajo (mig 173). La lista canónica vive en src/lib/tipos-trabajo.js, con tests: este CHECK y esa constante se cambian juntos. "Bienes y servicios" NO está acá — es la tabla `trabajos` (mig 174).';
COMMENT ON COLUMN public.obras.origen IS
  'publico | privado (mig 173). En obra pública aplican reglas propias de valorización, adelantos y penalidades.';

NOTIFY pgrst, 'reload schema';
