-- ═══════════════════════════════════════════════════════════════════
-- 199 — EL CV SE VUELVE FICHA, Y EL PROCESO SE LEE ENTERO — tanda 15,
--        entrega 4 (8-set-2026).
--
-- Tres cosas que los documentos reales de Gabriel dejaron claras:
--
-- 1. EL PADRÓN ESTÁ VACÍO Y LA GENTE NO ESTÁ EN NINGUNA OBRA. Los CVs que
--    trae son de profesionales de afuera, que se presentan en una propuesta y
--    recién si se gana entran a una obra. `personal.obra_id` era NOT NULL
--    desde la mig 001 porque el personal nacía en la obra; un profesional del
--    banco de propuestas no tiene obra todavía. Se hace nullable. Los cercos
--    RLS (migs 177/178) ya contemplaban `obra_id IS NULL` como "fila global":
--    no hay que tocar ni una política. El índice único (dni, obra_id) no
--    dedupe con obra NULL (NULL ≠ NULL para Postgres), así que se agrega uno
--    parcial para el caso sin obra.
--
-- 2. «EL CV» SON 8 PÁGINAS DE CURRÍCULUM Y 31 DE CONSTANCIAS ESCANEADAS
--    (medido: cv de 39 páginas, 8-set-2026). Lo que sustenta una experiencia
--    no es un PDF aparte: es la PÁGINA N de ese mismo CV. Por eso la
--    experiencia guarda `sustento_pagina` además de `evidencia_id`, y la
--    frase de donde salió (`fuente_cita`) para que se pueda comprobar, igual
--    que los requisitos de las bases (mig 197).
--
-- 3. LAS BASES DICEN MUCHO MÁS QUE EL PLANTEL. La convocatoria de El Peruano
--    trae el nombre de la inversión, el CUI, el monto referencial DESGLOSADO
--    (ejecución + supervisión + liquidación), el plazo, el mecanismo (Obras
--    por Impuestos, Ley 29230) y el calendario completo con 10 etapas. Y las
--    bases dicen si se puede ir en CONSORCIO y con qué reglas — que es como
--    de verdad se participa cuando una empresa sola no llega en experiencia
--    o en capital. Todo eso hoy no tenía dónde guardarse.
--
-- Todo aditivo. Los defaults dejan el comportamiento anterior intacto.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Un profesional puede existir sin obra ───────────────────────
ALTER TABLE public.personal ALTER COLUMN obra_id DROP NOT NULL;

COMMENT ON COLUMN public.personal.obra_id IS
  'Obra en la que trabaja. NULL = profesional del banco de propuestas (tanda 15): existe para postular, todavia no esta en ninguna obra.';

-- Con obra NULL el índice (dni, obra_id) no dedupe. Éste sí.
CREATE UNIQUE INDEX IF NOT EXISTS personal_dni_sin_obra_vivo_uidx
  ON public.personal (dni) WHERE obra_id IS NULL AND deleted_at IS NULL;

-- ── 2. La ficha profesional que sale de un CV ──────────────────────
ALTER TABLE public.personal_profesional
  ADD COLUMN IF NOT EXISTS ruc text,
  -- Diplomados, cursos, especializaciones: [{nombre, institucion, horas, desde, hasta}]
  ADD COLUMN IF NOT EXISTS capacitaciones jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- 'manual' (tipeada) · 'cv_ia' (propuesta por el lector de CV y aprobada)
  ADD COLUMN IF NOT EXISTS fuente text NOT NULL DEFAULT 'manual',
  -- Qué costó, con qué modelo y cuándo se leyó el CV: {fecha, costo, modelos, paginasOcr}
  ADD COLUMN IF NOT EXISTS cv_analisis jsonb;

ALTER TABLE public.personal_profesional DROP CONSTRAINT IF EXISTS personal_profesional_fuente_check;
ALTER TABLE public.personal_profesional ADD CONSTRAINT personal_profesional_fuente_check
  CHECK (fuente = ANY (ARRAY['manual'::text, 'cv_ia'::text]));
ALTER TABLE public.personal_profesional DROP CONSTRAINT IF EXISTS personal_profesional_capacitaciones_check;
ALTER TABLE public.personal_profesional ADD CONSTRAINT personal_profesional_capacitaciones_check
  CHECK (jsonb_typeof(capacitaciones) = 'array');

-- ── 3. La experiencia, con la página del CV que la sustenta ────────
ALTER TABLE public.personal_experiencia
  ADD COLUMN IF NOT EXISTS entidad_ruc text,
  ADD COLUMN IF NOT EXISTS fuente text NOT NULL DEFAULT 'manual',
  -- De qué página del CV salió la experiencia y la frase literal.
  ADD COLUMN IF NOT EXISTS fuente_pagina integer,
  ADD COLUMN IF NOT EXISTS fuente_cita text,
  -- En qué página del archivo `evidencia_id` está la constancia que la
  -- sustenta. Un CV trae las constancias adentro; señalar la página evita
  -- partir el PDF en 31 archivos.
  ADD COLUMN IF NOT EXISTS sustento_pagina integer;

ALTER TABLE public.personal_experiencia DROP CONSTRAINT IF EXISTS personal_experiencia_fuente_check;
ALTER TABLE public.personal_experiencia ADD CONSTRAINT personal_experiencia_fuente_check
  CHECK (fuente = ANY (ARRAY['manual'::text, 'cv_ia'::text]));

COMMENT ON COLUMN public.personal_experiencia.sustento_pagina IS
  'Pagina, dentro del archivo evidencia_id, donde esta la constancia que sustenta esta experiencia (el CV trae las constancias adentro).';

-- ── 4. El proceso completo: lo que dice la convocatoria y las bases ─
ALTER TABLE public.licitaciones
  -- Código Único de Inversión (Invierte.pe). Es la llave con la que la
  -- entidad nombra el proyecto en todos sus documentos.
  ADD COLUMN IF NOT EXISTS cui text,
  -- El nombre LARGO de la inversión, tal como lo escribe la entidad. Es lo que
  -- piden citar textual en las cartas y anexos («…con CUI N° …»).
  ADD COLUMN IF NOT EXISTS nombre_inversion text,
  -- 'oxi' (Obras por Impuestos, Ley 29230) · 'ley_contrataciones' (Ley 30225 /
  -- 32069) · 'privado' · 'otro'. Cambia el calendario, los sobres y quién paga.
  ADD COLUMN IF NOT EXISTS mecanismo text,
  ADD COLUMN IF NOT EXISTS plazo_ejecucion_dias integer,
  ADD COLUMN IF NOT EXISTS lugar text,
  ADD COLUMN IF NOT EXISTS sistema_contratacion text,   -- suma alzada, precios unitarios…
  -- El desglose del monto referencial: en OxI el convenio suma ejecución +
  -- supervisión + liquidación, y a la EMPRESA le toca solo la ejecución.
  ADD COLUMN IF NOT EXISTS monto_ejecucion numeric(18,2),
  ADD COLUMN IF NOT EXISTS monto_supervision numeric(18,2),
  -- Consorcio: si las bases lo permiten y bajo qué reglas (texto de la entidad).
  ADD COLUMN IF NOT EXISTS consorcio_permitido boolean,
  ADD COLUMN IF NOT EXISTS consorcio_reglas text,
  -- El plan de consorcio NUESTRO: [{company_id?, nombre, ruc?, porcentaje, aporta, notas}]
  -- `aporta` es texto libre: 'experiencia', 'capital', 'personal', 'RNP'…
  ADD COLUMN IF NOT EXISTS consorcio jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- El calendario del proceso: [{etapa, desde, hasta, fuente_pagina}]. La
  -- entrega 5 (calendario + kanban) lo convierte en avisos; hoy se guarda para
  -- no tipearlo dos veces.
  ADD COLUMN IF NOT EXISTS cronograma jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Notas de cómo pensamos participar (sola, en consorcio, con quién, por qué).
  ADD COLUMN IF NOT EXISTS participacion_notas text,
  -- Bitácora de lecturas: [{fecha, archivo, costo, modelos, paginasOcr, requisitos}]
  ADD COLUMN IF NOT EXISTS analisis jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- 'manual' · 'extraccion' (la creó el lector de bases/convocatoria)
  ADD COLUMN IF NOT EXISTS fuente text NOT NULL DEFAULT 'manual';

ALTER TABLE public.licitaciones DROP CONSTRAINT IF EXISTS licitaciones_mecanismo_check;
ALTER TABLE public.licitaciones ADD CONSTRAINT licitaciones_mecanismo_check
  CHECK (mecanismo IS NULL OR mecanismo = ANY (ARRAY['oxi'::text, 'ley_contrataciones'::text, 'privado'::text, 'otro'::text]));
ALTER TABLE public.licitaciones DROP CONSTRAINT IF EXISTS licitaciones_fuente_check;
ALTER TABLE public.licitaciones ADD CONSTRAINT licitaciones_fuente_check
  CHECK (fuente = ANY (ARRAY['manual'::text, 'extraccion'::text]));
ALTER TABLE public.licitaciones DROP CONSTRAINT IF EXISTS licitaciones_consorcio_check;
ALTER TABLE public.licitaciones ADD CONSTRAINT licitaciones_consorcio_check
  CHECK (jsonb_typeof(consorcio) = 'array');
ALTER TABLE public.licitaciones DROP CONSTRAINT IF EXISTS licitaciones_cronograma_check;
ALTER TABLE public.licitaciones ADD CONSTRAINT licitaciones_cronograma_check
  CHECK (jsonb_typeof(cronograma) = 'array');
ALTER TABLE public.licitaciones DROP CONSTRAINT IF EXISTS licitaciones_analisis_check;
ALTER TABLE public.licitaciones ADD CONSTRAINT licitaciones_analisis_check
  CHECK (jsonb_typeof(analisis) = 'array');

COMMENT ON COLUMN public.licitaciones.consorcio IS
  'Plan de consorcio propio: quienes vamos, con que porcentaje y que aporta cada uno. Es la forma habitual de llegar a la experiencia o al capital que piden las bases.';

-- ── 5. Los requisitos de la EMPRESA, con su forma propia ───────────
-- Un requisito de empresa no se mide en meses de un cargo: es «experiencia en
-- obras similares por un monto acumulado de 1 vez el valor referencial en los
-- últimos 8 años», «RNP vigente», «capacidad libre de contratación». La fila
-- ya aceptaba clase='empresa' (mig 197); le faltaban estos tres campos.
ALTER TABLE public.licitacion_requisitos
  ADD COLUMN IF NOT EXISTS descripcion text,
  ADD COLUMN IF NOT EXISTS monto_minimo numeric(18,2),
  ADD COLUMN IF NOT EXISTS multiplo_valor_referencial numeric(8,2);

COMMENT ON COLUMN public.licitacion_requisitos.multiplo_valor_referencial IS
  'Para requisitos de empresa: «monto facturado acumulado equivalente a X veces el valor referencial». Se guarda el X; el monto se calcula contra el proceso.';

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- VERIFICACIÓN
--   SELECT is_nullable FROM information_schema.columns
--    WHERE table_name='personal' AND column_name='obra_id';        -- YES
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_name='licitaciones' AND column_name IN
--     ('cui','nombre_inversion','mecanismo','plazo_ejecucion_dias','lugar',
--      'sistema_contratacion','monto_ejecucion','monto_supervision',
--      'consorcio_permitido','consorcio_reglas','consorcio','cronograma',
--      'participacion_notas','analisis','fuente');                 -- 15
--
-- REVERTIR
--   ALTER TABLE public.personal ALTER COLUMN obra_id SET NOT NULL;  -- falla si ya hay filas sin obra
--   DROP INDEX IF EXISTS personal_dni_sin_obra_vivo_uidx;
--   ALTER TABLE public.personal_profesional DROP COLUMN IF EXISTS ruc, DROP COLUMN IF EXISTS capacitaciones,
--     DROP COLUMN IF EXISTS fuente, DROP COLUMN IF EXISTS cv_analisis;
--   ALTER TABLE public.personal_experiencia DROP COLUMN IF EXISTS entidad_ruc, DROP COLUMN IF EXISTS fuente,
--     DROP COLUMN IF EXISTS fuente_pagina, DROP COLUMN IF EXISTS fuente_cita, DROP COLUMN IF EXISTS sustento_pagina;
--   ALTER TABLE public.licitaciones DROP COLUMN IF EXISTS cui, DROP COLUMN IF EXISTS nombre_inversion,
--     DROP COLUMN IF EXISTS mecanismo, DROP COLUMN IF EXISTS plazo_ejecucion_dias, DROP COLUMN IF EXISTS lugar,
--     DROP COLUMN IF EXISTS sistema_contratacion, DROP COLUMN IF EXISTS monto_ejecucion,
--     DROP COLUMN IF EXISTS monto_supervision, DROP COLUMN IF EXISTS consorcio_permitido,
--     DROP COLUMN IF EXISTS consorcio_reglas, DROP COLUMN IF EXISTS consorcio, DROP COLUMN IF EXISTS cronograma,
--     DROP COLUMN IF EXISTS participacion_notas, DROP COLUMN IF EXISTS analisis, DROP COLUMN IF EXISTS fuente;
--   ALTER TABLE public.licitacion_requisitos DROP COLUMN IF EXISTS descripcion,
--     DROP COLUMN IF EXISTS monto_minimo, DROP COLUMN IF EXISTS multiplo_valor_referencial;
--   NOTIFY pgrst, 'reload schema';
-- ═══════════════════════════════════════════════════════════════════
