-- ═══════════════════════════════════════════════════════════════════
-- 197 — LA POSTULACIÓN EXISTE COMO DATO — tanda 15, entrega 1.
--
-- El bloque "Licitaciones" existe desde la tanda 2 (src/lib/bloques-inicio.js)
-- y su propia descripción promete "el plantel profesional Y LOS TRABAJOS A LOS
-- QUE NOS PRESENTAMOS". Lo segundo nunca se construyó: el bloque tiene un solo
-- ítem adentro (Registro Profesional, mig 171).
--
-- Y ahí está el problema que esta migración cierra. La mig 171 dejó construido
-- el verificador de requisitos mínimos —`buscarPlantel()` en
-- src/lib/experiencia-profesional.js— pero los requisitos se TIPEAN cada vez
-- y se pierden al cerrar la pestaña. O sea: la pieza más cara ya estaba hecha
-- y no servía para trabajar, porque no había dónde guardar CONTRA QUÉ PROCESO
-- se estaba evaluando. Esta migración le da a esa pieza su expediente.
--
-- POR QUÉ TABLA APARTE Y NO UNA `obras` CON estado='postulando'
-- (el mismo criterio que la mig 174 usó para bienes y servicios):
--   · Una postulación no tiene partidas, ni cronograma de ejecución, ni
--     almacén, ni personal asignado, ni asistencia, ni valorizaciones, ni
--     un solo asiento contable. Comparte el nombre y nada más.
--   · La mayoría NUNCA va a ser obra: se pierden. Meterlas en `obras`
--     ensucia todos los selectores de obra de la app y todos los filtros de
--     contabilidad con procesos que no existieron nunca.
--   · `obras` es el titular de imputación de media app (obra_id está en
--     accounting_movements, movimientos_materiales, evidencias…). Una fila que
--     no puede recibir ningún movimiento no debe vivir ahí.
-- El enganche es `licitaciones.obra_id`, NULLABLE, y se llena SOLO cuando se
-- gana y alguien aprieta el botón: el paso a Trabajos es manual y confirmado,
-- nunca automático.
--
-- POR QUÉ `licitacion_requisitos` TIENE LA FORMA QUE TIENE: es, campo por
-- campo, el objeto que come evaluarRequisito() (experiencia-profesional.js:178)
-- — cargo, profesion, meses_minimos, rubro_id, exige_colegiatura,
-- exige_sustento. No hay capa de traducción que se pueda desincronizar: la
-- fila que se guarda ES el requisito que se evalúa.
--
-- CAMPOS QUE NACEN VACÍOS A PROPÓSITO: `fuente`, `fuente_pagina` y
-- `fuente_cita` los llena el escáner de bases (entrega 3), que tiene la regla
-- de citar la página de origen de cada dato extraído. Hoy todo entra 'manual'.
-- `clase` acepta 'empresa' desde ahora aunque la entrega 1 solo use 'personal':
-- los requisitos de empresa (experiencia en obras similares, facturación, CDC)
-- son la entrega siguiente y no quiero mover un CHECK para eso.
--
-- Aditivo y reversible.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. La postulación ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.licitaciones (
  id uuid PRIMARY KEY,

  -- Identificación del proceso
  nomenclatura text,                 -- 'LP-SM-1-2026-MDCH-1'
  objeto text NOT NULL,              -- qué se convoca
  entidad_convocante text,
  entidad_ruc text,

  -- Taxonomía: MISMOS valores que obras (mig 173) para que el prellenado al
  -- pasar a Trabajos sea campo a campo, sin tabla de equivalencias. Se le suma
  -- 'bienes_servicios', que en la app es la tabla `trabajos` (mig 174) y no un
  -- tipo_trabajo de obras — pero a un proceso de selección SÍ se postula.
  tipo_trabajo text NOT NULL DEFAULT 'obra_ejecucion',
  origen text NOT NULL DEFAULT 'publico',
  rubro_id uuid REFERENCES public.rubros_obra(id),   -- la especialidad técnica

  -- Economía del proceso
  valor_referencial numeric(18,2),
  moneda text NOT NULL DEFAULT 'PEN',

  -- Con quién postulamos (empresa del grupo o la que lidera el consorcio)
  postulante_company_id uuid REFERENCES public.companies(id),

  -- Seguimiento
  etapa text NOT NULL DEFAULT 'identificado',
  fecha_presentacion date,           -- el hito que manda; el resto del
                                     -- cronograma llega con la entrega 5
  -- Se llena SOLO al ganar, con el botón. NULL = todavía no es un trabajo.
  obra_id uuid REFERENCES public.obras(id),
  trabajo_id uuid,                   -- si el proceso era de bienes/servicios

  notas text,

  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  sync_status text,
  last_synced_at timestamptz,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);

ALTER TABLE public.licitaciones DROP CONSTRAINT IF EXISTS licitaciones_tipo_trabajo_check;
ALTER TABLE public.licitaciones ADD CONSTRAINT licitaciones_tipo_trabajo_check
  CHECK (tipo_trabajo = ANY (ARRAY[
    'obra_ejecucion'::text, 'obra_expediente'::text,
    'supervision'::text, 'supervision_expediente'::text,
    'bienes_servicios'::text]));

ALTER TABLE public.licitaciones DROP CONSTRAINT IF EXISTS licitaciones_origen_check;
ALTER TABLE public.licitaciones ADD CONSTRAINT licitaciones_origen_check
  CHECK (origen = ANY (ARRAY['publico'::text, 'privado'::text]));

-- El kanban del documento, más 'desistido'. Ese último estado NO es un adorno:
-- es el resultado que justifica todo el módulo. "No calificamos, no gastamos
-- una semana en esto" es una decisión que hoy no queda registrada en ningún
-- lado, y es la que el verificador de requisitos existe para poder tomar.
ALTER TABLE public.licitaciones DROP CONSTRAINT IF EXISTS licitaciones_etapa_check;
ALTER TABLE public.licitaciones ADD CONSTRAINT licitaciones_etapa_check
  CHECK (etapa = ANY (ARRAY[
    'identificado'::text,   -- lo vimos convocado
    'requisitos'::text,     -- verificando si calificamos
    'preparacion'::text,    -- armando el expediente
    'presentado'::text,
    'evaluacion'::text,
    'buena_pro'::text,      -- ganado
    'no_ganado'::text,
    'desistido'::text]));   -- no calificábamos: no se presentó

CREATE INDEX IF NOT EXISTS idx_licitaciones_etapa
  ON public.licitaciones (etapa) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_licitaciones_fecha_presentacion
  ON public.licitaciones (fecha_presentacion) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_licitaciones_obra
  ON public.licitaciones (obra_id) WHERE obra_id IS NOT NULL AND deleted_at IS NULL;

COMMENT ON TABLE public.licitaciones IS
  'Proceso de selección al que el grupo se postula. NO es una obra: obra_id se llena solo al ganar, con confirmación manual (tanda 15, entrega 1).';
COMMENT ON COLUMN public.licitaciones.etapa IS
  'Kanban de seguimiento. "desistido" = el verificador dijo que no calificábamos y no se presentó.';

-- ── 2. Los requisitos del proceso ──────────────────────────────────
-- Espejo EXACTO del objeto `requisito` de evaluarRequisito()
-- (src/lib/experiencia-profesional.js:178). Si acá se agrega un campo, allá
-- también — no hay adaptador en el medio a propósito.
CREATE TABLE IF NOT EXISTS public.licitacion_requisitos (
  id uuid PRIMARY KEY,
  licitacion_id uuid NOT NULL REFERENCES public.licitaciones(id),
  orden integer NOT NULL DEFAULT 100,

  -- 'personal' hoy; 'empresa' lo usa la entrega 2.
  clase text NOT NULL DEFAULT 'personal',

  cargo text,                        -- 'Residente de Obra'
  profesion text,                    -- 'Ingeniero Civil'
  meses_minimos numeric(8,1) NOT NULL DEFAULT 0,
  rubro_id uuid REFERENCES public.rubros_obra(id),  -- NULL = experiencia general
  exige_colegiatura boolean NOT NULL DEFAULT true,
  exige_sustento boolean NOT NULL DEFAULT true,

  -- A quién decidimos presentar en ese puesto. Sin esto la pantalla contesta
  -- "quién podría" y no guarda "a quién elegimos", que es lo que después hay
  -- que sostener con papeles en el expediente.
  candidato_personal_id uuid REFERENCES public.personal(id),

  -- De dónde salió el requisito. El escáner de bases (entrega 3) escribe
  -- 'extraccion' y cita la página; lo tipeado a mano queda 'manual'.
  fuente text NOT NULL DEFAULT 'manual',
  fuente_pagina integer,
  fuente_cita text,

  notas text,

  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  sync_status text,
  last_synced_at timestamptz,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);

ALTER TABLE public.licitacion_requisitos DROP CONSTRAINT IF EXISTS licitacion_requisitos_clase_check;
ALTER TABLE public.licitacion_requisitos ADD CONSTRAINT licitacion_requisitos_clase_check
  CHECK (clase = ANY (ARRAY['personal'::text, 'empresa'::text]));

ALTER TABLE public.licitacion_requisitos DROP CONSTRAINT IF EXISTS licitacion_requisitos_fuente_check;
ALTER TABLE public.licitacion_requisitos ADD CONSTRAINT licitacion_requisitos_fuente_check
  CHECK (fuente = ANY (ARRAY['manual'::text, 'extraccion'::text]));

CREATE INDEX IF NOT EXISTS idx_licitacion_requisitos_licitacion
  ON public.licitacion_requisitos (licitacion_id) WHERE deleted_at IS NULL;

COMMENT ON TABLE public.licitacion_requisitos IS
  'Requisitos mínimos de un proceso. La fila ES el objeto que come evaluarRequisito() — misma forma, sin traducción.';

-- ── 3. RLS ─────────────────────────────────────────────────────────
ALTER TABLE public.licitaciones          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.licitacion_requisitos ENABLE ROW LEVEL SECURITY;

-- Quién entra: el equipo de propuestas y la conducción. RR.HH. SÍ ve la ficha
-- profesional (mig 171) porque es dato de personal, pero NO tiene por qué
-- saber a qué procesos se está postulando el grupo — eso es información
-- comercial, no de recursos humanos.
DROP POLICY IF EXISTS "licitaciones: equipo lee" ON public.licitaciones;
CREATE POLICY "licitaciones: equipo lee" ON public.licitaciones
  FOR SELECT TO authenticated
  USING (public.has_role(ARRAY['admin'::text, 'gerente'::text, 'licitaciones'::text]));
DROP POLICY IF EXISTS "licitaciones: equipo escribe" ON public.licitaciones;
CREATE POLICY "licitaciones: equipo escribe" ON public.licitaciones
  FOR ALL TO authenticated
  USING (public.has_role(ARRAY['admin'::text, 'gerente'::text, 'licitaciones'::text]))
  WITH CHECK (public.has_role(ARRAY['admin'::text, 'gerente'::text, 'licitaciones'::text]));

DROP POLICY IF EXISTS "lic_requisitos: equipo lee" ON public.licitacion_requisitos;
CREATE POLICY "lic_requisitos: equipo lee" ON public.licitacion_requisitos
  FOR SELECT TO authenticated
  USING (public.has_role(ARRAY['admin'::text, 'gerente'::text, 'licitaciones'::text]));
DROP POLICY IF EXISTS "lic_requisitos: equipo escribe" ON public.licitacion_requisitos;
CREATE POLICY "lic_requisitos: equipo escribe" ON public.licitacion_requisitos
  FOR ALL TO authenticated
  USING (public.has_role(ARRAY['admin'::text, 'gerente'::text, 'licitaciones'::text]))
  WITH CHECK (public.has_role(ARRAY['admin'::text, 'gerente'::text, 'licitaciones'::text]));

-- ── 4. Cerco del rol campo (lección de la mig 167) ─────────────────
-- Toda tabla nueva nace con su cerco. Acá es redundante —las policies de
-- arriba ya son una allowlist de tres roles y 'campo' no está— pero se aplica
-- igual: el día que alguien afloje la policy permisiva, el cerco RESTRICTIVE
-- sigue de pie. Es exactamente lo que la mig 167 enseñó.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['licitaciones', 'licitacion_requisitos'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS campo_cerco_select ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS campo_cerco_insert ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS campo_cerco_update ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS campo_cerco_delete ON public.%I', t);
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

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- VERIFICACIÓN
--   SELECT count(*) FROM public.licitaciones;            -- 0, tabla nueva
--   SELECT count(*) FROM public.licitacion_requisitos;   -- 0
--   -- las dos tablas con RLS y 6 policies cada una (2 permisivas + 4 cerco):
--   SELECT tablename, count(*) FROM pg_policies
--    WHERE schemaname='public' AND tablename IN ('licitaciones','licitacion_requisitos')
--    GROUP BY tablename;
--
-- REVERTIR (pegar en el SQL Editor si algo sale mal):
--   DROP TABLE IF EXISTS public.licitacion_requisitos;
--   DROP TABLE IF EXISTS public.licitaciones;
--   NOTIFY pgrst, 'reload schema';
-- ═══════════════════════════════════════════════════════════════════
