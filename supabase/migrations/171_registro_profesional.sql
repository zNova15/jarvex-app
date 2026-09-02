-- ═══════════════════════════════════════════════════════════════════
-- 171 — REGISTRO PROFESIONAL para postular a procesos de selección
--
-- Pedido de Gabriel (1-sep) a partir del equipo que busca obras y arma las
-- propuestas: necesitan saber QUÉ PROFESIONALES TENEMOS y con cuánta
-- experiencia por rubro, porque las bases exigen un plantel clave con
-- profesión, colegiatura habilitada y X meses en cierto tipo de obra.
--
-- DECISIONES DE DISEÑO
--
-- 1. NO se crea otra tabla de personas. `personal` ya es el registro global
--    (DNI con unique parcial desde la mig 074) y `personal-categoria.js` ya
--    distingue "Profesionales". La ficha profesional es 1:1 contra esa fila:
--    así el profesional que además está en planilla es UNA sola persona, y no
--    hay que reconciliar dos padrones.
--
-- 2. La ficha va en tabla APARTE y no como columnas de `personal`: son datos
--    sensibles (CV, títulos) que solo el equipo de propuestas y RR.HH. deben
--    ver, y `personal` la leen almacén, SSOMA y planillas. Separarlas permite
--    un RLS más ajustado sin tocar el de `personal`.
--
-- 3. La EXPERIENCIA se guarda como PERIODOS, nunca como "años de experiencia".
--    El total se calcula (src/lib/experiencia-profesional.js) fusionando los
--    periodos solapados: quien estuvo en dos obras a la vez tiene UN año, no
--    dos — presentar el número inflado es una observación segura en la
--    evaluación. Un dato calculado además no se desactualiza solo.
--
-- 4. Los RUBROS son catálogo editable (no un enum ni texto libre): con texto
--    libre "saneamiento" y "Saneamiento Básico" no suman juntos y el total
--    por rubro deja de ser confiable, que es justo lo que hay que defender.
--
-- Todo aditivo y reversible.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Catálogo de rubros ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rubros_obra (
  id uuid PRIMARY KEY,
  nombre text NOT NULL,
  descripcion text,
  orden integer NOT NULL DEFAULT 100,
  activo boolean NOT NULL DEFAULT true,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rubros_obra_nombre
  ON public.rubros_obra (lower(nombre)) WHERE deleted_at IS NULL;

-- Set inicial de obra pública peruana. El admin agrega/renombra desde la app;
-- el idempotency_key determinista hace que re-aplicar no duplique.
INSERT INTO public.rubros_obra (id, nombre, orden, idempotency_key)
VALUES
  (gen_random_uuid(), 'Saneamiento (agua y alcantarillado)', 10, 'rubro_saneamiento'),
  (gen_random_uuid(), 'Carreteras y obras viales',           20, 'rubro_viales'),
  (gen_random_uuid(), 'Pistas y veredas',                    30, 'rubro_pistas_veredas'),
  (gen_random_uuid(), 'Edificaciones',                       40, 'rubro_edificaciones'),
  (gen_random_uuid(), 'Puentes y obras de arte',             50, 'rubro_puentes'),
  (gen_random_uuid(), 'Electrificación',                     60, 'rubro_electrificacion'),
  (gen_random_uuid(), 'Riego y obras hidráulicas',           70, 'rubro_riego'),
  (gen_random_uuid(), 'Defensas ribereñas',                  80, 'rubro_defensas'),
  (gen_random_uuid(), 'Otros',                              999, 'rubro_otros')
ON CONFLICT (idempotency_key) DO NOTHING;

-- Nuestras propias obras también clasifican: así la experiencia del personal
-- en obras del grupo se puede proponer sola.
ALTER TABLE public.obras ADD COLUMN IF NOT EXISTS rubro_id uuid REFERENCES public.rubros_obra(id);

-- ── 2. Ficha profesional (1:1 con personal) ────────────────────────
CREATE TABLE IF NOT EXISTS public.personal_profesional (
  id uuid PRIMARY KEY,
  personal_id uuid NOT NULL REFERENCES public.personal(id),
  profesion text,                    -- 'Ingeniero Civil', 'Arquitecto', …
  titulo text,                       -- título profesional
  universidad text,
  anio_egreso integer,
  colegio text,                      -- 'CIP', 'CAP', 'CQP', …
  colegiatura_numero text,
  colegiatura_habil_hasta date,      -- vencimiento de la habilidad
  especialidades jsonb NOT NULL DEFAULT '[]'::jsonb,
  cv_evidencia_id uuid,              -- CV en PDF (FK-less, técnica registro_relacionado)
  resumen text,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);
-- Una ficha viva por persona (parcial: borrarla y rehacerla es válido).
CREATE UNIQUE INDEX IF NOT EXISTS uq_personal_profesional_persona
  ON public.personal_profesional (personal_id) WHERE deleted_at IS NULL;

-- ── 3. Experiencia (N periodos por persona) ────────────────────────
CREATE TABLE IF NOT EXISTS public.personal_experiencia (
  id uuid PRIMARY KEY,
  personal_id uuid NOT NULL REFERENCES public.personal(id),
  rubro_id uuid REFERENCES public.rubros_obra(id),
  entidad text,                      -- quién contrató (entidad o empresa)
  obra_nombre text,
  cargo text,
  monto numeric,                     -- monto de la obra (lo piden algunas bases)
  moneda text NOT NULL DEFAULT 'PEN',
  fecha_inicio date,
  fecha_fin date,                    -- NULL = sigue en curso
  -- Si la experiencia es en una obra NUESTRA, queda trazada; las de otras
  -- empresas van con obra_id NULL y su constancia escaneada.
  obra_id uuid REFERENCES public.obras(id),
  evidencia_id uuid,                 -- constancia/certificado que la sustenta
  observaciones text,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_personal_experiencia_persona
  ON public.personal_experiencia (personal_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_personal_experiencia_rubro
  ON public.personal_experiencia (rubro_id) WHERE deleted_at IS NULL;

-- ── 4. Triggers de updated_at ──────────────────────────────────────
DROP TRIGGER IF EXISTS trg_rubros_obra_updated ON public.rubros_obra;
CREATE TRIGGER trg_rubros_obra_updated BEFORE UPDATE ON public.rubros_obra
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_personal_profesional_updated ON public.personal_profesional;
CREATE TRIGGER trg_personal_profesional_updated BEFORE UPDATE ON public.personal_profesional
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_personal_experiencia_updated ON public.personal_experiencia;
CREATE TRIGGER trg_personal_experiencia_updated BEFORE UPDATE ON public.personal_experiencia
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 5. Rol nuevo: licitaciones ─────────────────────────────────────
-- El equipo que busca obras y arma las propuestas. El CHECK se reescribe
-- entero (el de la mig 079) agregando el rol.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_rol_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_rol_check CHECK (rol = ANY (ARRAY[
  'admin', 'gerente', 'ingeniero_residente', 'ingeniero', 'supervisor',
  'almacenero', 'asistente_admin', 'contador', 'ayudante_contador', 'tesorero',
  'jefe_compras', 'rrhh', 'prevencionista', 'maestro_obra', 'solo_lectura',
  'ing_ambiental', 'ing_calidad', 'ing_social', 'campo', 'licitaciones'
]));

-- ── 6. RLS ─────────────────────────────────────────────────────────
ALTER TABLE public.rubros_obra          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_profesional ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_experiencia ENABLE ROW LEVEL SECURITY;

-- Rubros: catálogo inofensivo, lo lee cualquiera (las obras lo muestran);
-- lo escribe admin.
DROP POLICY IF EXISTS "rubros: autenticado lee" ON public.rubros_obra;
CREATE POLICY "rubros: autenticado lee" ON public.rubros_obra
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "rubros: admin escribe" ON public.rubros_obra;
CREATE POLICY "rubros: admin escribe" ON public.rubros_obra
  FOR ALL TO authenticated
  USING (public.has_role(ARRAY['admin'::text]))
  WITH CHECK (public.has_role(ARRAY['admin'::text]));

-- Ficha y experiencia: datos personales (CV, títulos). SOLO el equipo de
-- propuestas, RR.HH. y la conducción. El resto de la app no los necesita.
DROP POLICY IF EXISTS "prof: equipo lee" ON public.personal_profesional;
CREATE POLICY "prof: equipo lee" ON public.personal_profesional
  FOR SELECT TO authenticated
  USING (public.has_role(ARRAY['admin'::text, 'gerente'::text, 'rrhh'::text, 'licitaciones'::text]));
DROP POLICY IF EXISTS "prof: equipo escribe" ON public.personal_profesional;
CREATE POLICY "prof: equipo escribe" ON public.personal_profesional
  FOR ALL TO authenticated
  USING (public.has_role(ARRAY['admin'::text, 'gerente'::text, 'rrhh'::text, 'licitaciones'::text]))
  WITH CHECK (public.has_role(ARRAY['admin'::text, 'gerente'::text, 'rrhh'::text, 'licitaciones'::text]));

DROP POLICY IF EXISTS "exp: equipo lee" ON public.personal_experiencia;
CREATE POLICY "exp: equipo lee" ON public.personal_experiencia
  FOR SELECT TO authenticated
  USING (public.has_role(ARRAY['admin'::text, 'gerente'::text, 'rrhh'::text, 'licitaciones'::text]));
DROP POLICY IF EXISTS "exp: equipo escribe" ON public.personal_experiencia;
CREATE POLICY "exp: equipo escribe" ON public.personal_experiencia
  FOR ALL TO authenticated
  USING (public.has_role(ARRAY['admin'::text, 'gerente'::text, 'rrhh'::text, 'licitaciones'::text]))
  WITH CHECK (public.has_role(ARRAY['admin'::text, 'gerente'::text, 'rrhh'::text, 'licitaciones'::text]));

-- ── 7. Cerco del rol campo (lección de la mig 167) ─────────────────
-- TODA tabla nueva nace con su cerco: la cuenta compartida del portal de
-- campo no toca nada fuera de sus fotos.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rubros_obra', 'personal_profesional', 'personal_experiencia'] LOOP
    EXECUTE format($f$
      CREATE POLICY campo_cerco_select ON public.%I AS RESTRICTIVE
        FOR SELECT TO authenticated USING (current_user_rol() IS DISTINCT FROM 'campo'::text);
      CREATE POLICY campo_cerco_insert ON public.%I AS RESTRICTIVE
        FOR INSERT TO authenticated WITH CHECK (current_user_rol() IS DISTINCT FROM 'campo'::text);
      CREATE POLICY campo_cerco_update ON public.%I AS RESTRICTIVE
        FOR UPDATE TO authenticated USING (current_user_rol() IS DISTINCT FROM 'campo'::text)
        WITH CHECK (current_user_rol() IS DISTINCT FROM 'campo'::text);
      CREATE POLICY campo_cerco_delete ON public.%I AS RESTRICTIVE
        FOR DELETE TO authenticated USING (current_user_rol() IS DISTINCT FROM 'campo'::text);
    $f$, t, t, t, t);
  END LOOP;
END $$;

-- ── 8. Evidencias: CV y constancias son datos PERSONALES ───────────
-- Espejo server de src/lib/evidencias-visibilidad.js (regla crítica 5). Sin
-- esto los tipos nuevos caerían en el "todo lo no contable lo ve cualquiera" y
-- el CV de un ingeniero quedaría visible para toda la obra.
-- Se reescribe la policy de la mig 143 conservando su bloque contable EXACTO y
-- sumándole el bloque profesional, que tiene OTROS roles (no los contables).
DROP POLICY IF EXISTS "evidencias: ver segun tipo" ON public.evidencias;
CREATE POLICY "evidencias: ver segun tipo" ON public.evidencias
  FOR SELECT TO authenticated
  USING (
    -- Autor: siempre ve lo suyo.
    subido_por = auth.uid() OR created_by = auth.uid()
    OR (
      CASE
        WHEN tipo_evidencia IN ('bancarizacion', 'comprobante_captura', 'factura',
                                'recibo_honorarios', 'pago_evidencia', 'guia_remision',
                                'sctr_cotizacion', 'sctr_pago', 'sctr_factura', 'sctr_otro',
                                'constancia_detraccion', 'factura_campo')
          THEN public.has_role(ARRAY['admin'::text, 'contador'::text, 'ayudante_contador'::text])
        WHEN tipo_evidencia IN ('cv_profesional', 'constancia_experiencia')
          THEN public.has_role(ARRAY['admin'::text, 'gerente'::text, 'rrhh'::text, 'licitaciones'::text])
        ELSE true
      END
    )
  );

COMMENT ON TABLE public.personal_experiencia IS
  'Periodos de experiencia por persona y rubro (mig 171). Los MESES se calculan fusionando periodos solapados en src/lib/experiencia-profesional.js — nunca se guardan como número.';

NOTIFY pgrst, 'reload schema';
