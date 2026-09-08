-- ═══════════════════════════════════════════════════════════════════
-- 200 — LO QUE EL CV DICE Y LO QUE ALGUIEN VERIFICÓ, Y EL RESTO DE
--        LO QUE DICEN UNAS BASES — tanda 15, entrega 5 (8-set-2026).
--
-- Dos pedidos de Gabriel después de probar la entrega 4 en producción:
--
-- 1. «Que veas cómo nosotros podemos corroborar cada dato de lo que él
--    menciona […] y nosotros ya manualmente vamos corroborando que lo que ha
--    colocado está verificado.»
--
--    EL CV ES UNA DECLARACIÓN, NO UNA PRUEBA. Hasta ahora la app trataba
--    `evidencia_id` como sustento: si había archivo adjunto, la experiencia
--    contaba como presentable. Pero el archivo adjunto es el CV ENTERO, y que
--    el CV diga «trabajé 3 meses en PROREGIÓN» no prueba nada — la prueba es
--    la constancia, y a esa la tiene que MIRAR una persona.
--
--    Por eso cada dato leído del CV nace en 'pendiente' y guarda QUÉ
--    DOCUMENTO lo probaría (`sustento_esperado`). Un administrador abre el
--    CV, busca esa constancia y marca. Lo verificado es lo único que se
--    presenta sin riesgo en un proceso.
--
--    ESTADOS, y por qué son cuatro y no dos:
--      'pendiente'    nadie lo miró todavía (lo normal al terminar de leer)
--      'verificado'   una persona vio el documento que lo prueba
--      'observado'    el documento existe pero algo no cuadra (fechas, cargo)
--      'sin_sustento' se buscó y NO está: el dato es declarativo y nada más
--    'observado' y 'sin_sustento' son cosas distintas y la diferencia es cara:
--    lo observado se puede arreglar pidiendo el papel bien; lo que no existe
--    descalifica si se presenta.
--
-- 2. «Hay mucha data por extraer de allí y organizarla»: garantías,
--    penalidades, adelantos, forma de pago, qué documentos hay que presentar,
--    los factores de evaluación con su puntaje y las cosas a considerar. Todo
--    eso lo dicen las bases y hoy no tenía dónde guardarse, así que el lector
--    lo leía y se perdía.
--
-- Todo aditivo, con defaults que dejan intacto lo que ya existe: una fila
-- vieja se evalúa igual que antes de esta migración.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. La experiencia: declarada vs verificada ─────────────────────
ALTER TABLE public.personal_experiencia
  ADD COLUMN IF NOT EXISTS verificacion text NOT NULL DEFAULT 'pendiente',
  ADD COLUMN IF NOT EXISTS verificado_por uuid,
  ADD COLUMN IF NOT EXISTS verificado_at timestamptz,
  ADD COLUMN IF NOT EXISTS verificacion_nota text,
  -- Qué documento probaría este periodo. Lo PROPONE el lector de CV a partir
  -- de lo que el propio CV declara («Constancia de trabajo de PROREGIÓN»), y
  -- es lo que el administrador va a buscar entre las páginas escaneadas.
  ADD COLUMN IF NOT EXISTS sustento_esperado text,
  ADD COLUMN IF NOT EXISTS sustento_tipo text;

ALTER TABLE public.personal_experiencia DROP CONSTRAINT IF EXISTS personal_experiencia_verificacion_check;
ALTER TABLE public.personal_experiencia ADD CONSTRAINT personal_experiencia_verificacion_check
  CHECK (verificacion = ANY (ARRAY['pendiente'::text, 'verificado'::text, 'observado'::text, 'sin_sustento'::text]));

COMMENT ON COLUMN public.personal_experiencia.verificacion IS
  'Lo declarado en el CV vs lo que una persona comprobo mirando el documento. Solo "verificado" es presentable sin riesgo (tanda 15, entrega 5).';
COMMENT ON COLUMN public.personal_experiencia.sustento_esperado IS
  'Que documento probaria este periodo. Lo propone el lector de CV; el administrador lo busca y marca.';

CREATE INDEX IF NOT EXISTS idx_personal_experiencia_verificacion
  ON public.personal_experiencia (verificacion) WHERE deleted_at IS NULL;

-- ── 2. La ficha: verificación campo por campo ──────────────────────
-- Va en jsonb y no en columnas porque son muchos campos chicos y cada uno se
-- prueba con OTRO documento: el título con el diploma de la universidad, la
-- colegiatura con el diploma del colegio, el RUC con la ficha de SUNAT, el
-- RNP con su constancia. Una columna por campo serían veinte columnas que
-- solo el administrador mira.
--   { titulo: { estado, por, at, nota, pagina }, colegiatura: {...}, ... }
ALTER TABLE public.personal_profesional
  ADD COLUMN IF NOT EXISTS verificaciones jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Inscripción en el Registro Nacional de Proveedores: lo pide toda base y
  -- el CV suele traer su constancia (en este caso, en texto nativo).
  ADD COLUMN IF NOT EXISTS rnp_numero text,
  ADD COLUMN IF NOT EXISTS rnp_vigente_desde date;

ALTER TABLE public.personal_profesional DROP CONSTRAINT IF EXISTS personal_profesional_verificaciones_check;
ALTER TABLE public.personal_profesional ADD CONSTRAINT personal_profesional_verificaciones_check
  CHECK (jsonb_typeof(verificaciones) = 'object');

COMMENT ON COLUMN public.personal_profesional.verificaciones IS
  'Estado de comprobacion por campo: { titulo:{estado,por,at,nota,pagina}, colegiatura:{...}, ruc:{...} }. Las capacitaciones llevan el suyo dentro de su propio jsonb.';

-- ── 3. Lo que unas bases dicen y no tenía dónde guardarse ──────────
ALTER TABLE public.licitaciones
  -- [{ factor, puntaje_maximo, criterio, fuente_pagina, fuente_cita }]
  -- Un FACTOR da puntaje; un REQUISITO descalifica. Se guardan aparte a
  -- propósito: confundirlos es el error más caro al armar una propuesta.
  ADD COLUMN IF NOT EXISTS factores_evaluacion jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- [{ tipo, porcentaje, monto, detalle, fuente_* }] — fiel cumplimiento,
  -- adelanto directo, adelanto de materiales.
  ADD COLUMN IF NOT EXISTS garantias jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- [{ tipo, formula, tope, detalle, fuente_* }] — mora y otras.
  ADD COLUMN IF NOT EXISTS penalidades jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- [{ sobre, documento, obligatorio, fuente_* }] — el índice del expediente.
  ADD COLUMN IF NOT EXISTS documentos_presentacion jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- [{ tipo, titulo, detalle, fuente_* }] — adelantos, forma de pago, visita
  -- de obra, plazo de firma, subcontratación, seguros: «las cosas a
  -- considerar» que hoy alguien tiene que leer a mano en 96 páginas.
  ADD COLUMN IF NOT EXISTS condiciones jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Lo que el lector marcó para revisar. En la prueba real del 8-set el
  -- modelo avisó que una fecha venía truncada y que el documento traía avisos
  -- ajenos al proceso; eso vale y se perdía al cerrar la ventana.
  ADD COLUMN IF NOT EXISTS alertas jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
DECLARE col text;
BEGIN
  FOREACH col IN ARRAY ARRAY['factores_evaluacion','garantias','penalidades','documentos_presentacion','condiciones','alertas']
  LOOP
    EXECUTE format('ALTER TABLE public.licitaciones DROP CONSTRAINT IF EXISTS licitaciones_%s_check', col);
    EXECUTE format('ALTER TABLE public.licitaciones ADD CONSTRAINT licitaciones_%s_check CHECK (jsonb_typeof(%I) = ''array'')', col, col);
  END LOOP;
END $$;

COMMENT ON COLUMN public.licitaciones.condiciones IS
  'Las "cosas a considerar" de estas bases: adelantos, forma de pago, visita de obra, plazo de firma, subcontratacion, seguros.';

-- ── 4. Cuánto pesaba el archivo antes de optimizarlo ───────────────
-- Para poder MEDIR si comprimir vale la pena en vez de suponerlo (la regla
-- del 5-set: un PDF que pierde legibilidad NO se comprime).
ALTER TABLE public.evidencias
  ADD COLUMN IF NOT EXISTS tamano_original_bytes bigint;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- VERIFICACIÓN
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='personal_experiencia'
--      AND column_name IN ('verificacion','verificado_por','verificado_at',
--                          'verificacion_nota','sustento_esperado','sustento_tipo');  -- 6
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_name='licitaciones' AND column_name IN
--     ('factores_evaluacion','garantias','penalidades','documentos_presentacion',
--      'condiciones','alertas');                                                      -- 6
--
-- REVERTIR
--   ALTER TABLE public.personal_experiencia
--     DROP COLUMN IF EXISTS verificacion, DROP COLUMN IF EXISTS verificado_por,
--     DROP COLUMN IF EXISTS verificado_at, DROP COLUMN IF EXISTS verificacion_nota,
--     DROP COLUMN IF EXISTS sustento_esperado, DROP COLUMN IF EXISTS sustento_tipo;
--   ALTER TABLE public.personal_profesional
--     DROP COLUMN IF EXISTS verificaciones, DROP COLUMN IF EXISTS rnp_numero,
--     DROP COLUMN IF EXISTS rnp_vigente_desde;
--   ALTER TABLE public.licitaciones
--     DROP COLUMN IF EXISTS factores_evaluacion, DROP COLUMN IF EXISTS garantias,
--     DROP COLUMN IF EXISTS penalidades, DROP COLUMN IF EXISTS documentos_presentacion,
--     DROP COLUMN IF EXISTS condiciones, DROP COLUMN IF EXISTS alertas;
--   ALTER TABLE public.evidencias DROP COLUMN IF EXISTS tamano_original_bytes;
--   NOTIFY pgrst, 'reload schema';
-- ═══════════════════════════════════════════════════════════════════
