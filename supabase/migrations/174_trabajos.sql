-- ═══════════════════════════════════════════════════════════════════
-- 174 — TRABAJOS: bienes y servicios con flujo corto propio
--
-- Tanda 1 de 3, punto 3 (docs/tanda-1-modelo-de-datos.md): "nuevo tipo dentro
-- de la taxonomía de trabajo, junto a obra y supervisión, con flujo corto
-- propio (no las etapas de expediente técnico/ejecución de una obra):
-- cotización → compra → venta (bienes), o prestación directa del servicio.
-- Responsable único asignado, sin la disgregación de personal de campo."
--
-- POR QUÉ TABLA APARTE Y NO UN tipo_trabajo MÁS EN `obras` (decisión de
-- Gabriel): vender un lote de material no tiene partidas, ni cronograma, ni
-- avance físico, ni valorizaciones, ni personal, ni asistencia, ni EPP, ni
-- almacén, ni frentes. Meterlo en `obras` obligaría a apagar a mano casi todo
-- lo que hace que una obra sea una obra, y a filtrar el catálogo de obras en
-- cada pantalla para que no aparezcan ventas de material mezcladas con la obra
-- de saneamiento de Los Baños del Inca.
--
-- EL ÚNICO ENGANCHE TRANSVERSAL ES accounting_movements.trabajo_id, y es
-- nullable. Funciona EXACTAMENTE igual que obra_id (nullable desde la mig 041):
-- el titular contable sigue siendo company_id — el trabajo es la etiqueta de a
-- qué se imputa, no un titular. NO se toca company_id NOT NULL, ni un solo
-- filtro de libros, PLE, EE.FF. o comprobantes.
--
-- POR QUÉ trabajo_cotizaciones NO REUSA `cotizaciones` (mig 022): dos razones.
-- La formal es que cotizaciones.requisicion_id es NOT NULL. La de fondo es que
-- son cosas distintas: las de la mig 022 son cotizaciones RECIBIDAS de
-- proveedores (tienen proveedor_id) dentro del circuito de compras; estas son
-- EMITIDAS al cliente. Forzarlas en la misma tabla mezcla dos direcciones
-- opuestas del mismo documento.
--
-- La COMPRA al proveedor no necesita tabla: es un accounting_movement
-- type='cost' con trabajo_id, y la venta un type='income' con el mismo
-- trabajo_id. El par compra/venta queda trazado por ahí, que es lo que el
-- documento pide como "flujo corto".
--
-- Aditivo.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. El trabajo ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trabajos (
  id uuid PRIMARY KEY,
  codigo text,
  nombre text NOT NULL,
  tipo text NOT NULL DEFAULT 'bien',          -- 'bien' | 'servicio'
  origen text NOT NULL DEFAULT 'privado',     -- 'publico' | 'privado'
  cliente text,
  cliente_ruc text,
  -- Quién presta/vende: una empresa del grupo o un consorcio.
  ejecutor_company_id uuid REFERENCES public.companies(id),
  consorcio_id uuid REFERENCES public.consorcios(id),
  -- Responsable ÚNICO (doc §3): sin la disgregación de personal de campo que
  -- llevan las obras.
  responsable_id uuid REFERENCES public.profiles(id),
  estado text NOT NULL DEFAULT 'cotizacion',
  monto_estimado numeric(14,2),
  moneda text NOT NULL DEFAULT 'PEN',
  fecha_inicio date,
  fecha_fin date,
  observaciones text,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);

ALTER TABLE public.trabajos DROP CONSTRAINT IF EXISTS trabajos_tipo_check;
ALTER TABLE public.trabajos ADD CONSTRAINT trabajos_tipo_check
  CHECK (tipo = ANY (ARRAY['bien'::text, 'servicio'::text]));

ALTER TABLE public.trabajos DROP CONSTRAINT IF EXISTS trabajos_origen_check;
ALTER TABLE public.trabajos ADD CONSTRAINT trabajos_origen_check
  CHECK (origen = ANY (ARRAY['publico'::text, 'privado'::text]));

-- Ciclo CORTO y propio: no son las etapas de una obra (doc §3).
ALTER TABLE public.trabajos DROP CONSTRAINT IF EXISTS trabajos_estado_check;
ALTER TABLE public.trabajos ADD CONSTRAINT trabajos_estado_check
  CHECK (estado = ANY (ARRAY[
    'cotizacion',   -- se está cotizando al cliente
    'adjudicado',   -- nos lo dieron
    'ejecucion',    -- comprando el bien / prestando el servicio
    'entregado',    -- entregado, falta cobrar
    'cerrado',
    'cancelado'
  ]));

CREATE INDEX IF NOT EXISTS idx_trabajos_estado
  ON public.trabajos (estado) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_trabajos_company
  ON public.trabajos (ejecutor_company_id) WHERE deleted_at IS NULL;

-- ── 2. Cotizaciones emitidas al cliente ────────────────────────────
CREATE TABLE IF NOT EXISTS public.trabajo_cotizaciones (
  id uuid PRIMARY KEY,
  trabajo_id uuid NOT NULL REFERENCES public.trabajos(id) ON DELETE CASCADE,
  numero text,
  fecha date,
  validez_dias integer,
  monto numeric(14,2),
  moneda text NOT NULL DEFAULT 'PEN',
  estado text NOT NULL DEFAULT 'borrador',
  evidencia_id uuid,              -- el PDF enviado (FK-less, técnica registro_relacionado)
  notas text,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);

ALTER TABLE public.trabajo_cotizaciones DROP CONSTRAINT IF EXISTS trabajo_cotizaciones_estado_check;
ALTER TABLE public.trabajo_cotizaciones ADD CONSTRAINT trabajo_cotizaciones_estado_check
  CHECK (estado = ANY (ARRAY['borrador'::text, 'enviada'::text, 'aceptada'::text, 'rechazada'::text, 'vencida'::text]));

CREATE INDEX IF NOT EXISTS idx_trabajo_cotizaciones_trabajo
  ON public.trabajo_cotizaciones (trabajo_id) WHERE deleted_at IS NULL;

-- ── 3. El único enganche transversal ───────────────────────────────
-- Nullable, exactamente como obra_id. El titular contable sigue siendo
-- company_id: esto es la etiqueta de a qué trabajo se imputa el movimiento.
ALTER TABLE public.accounting_movements
  ADD COLUMN IF NOT EXISTS trabajo_id uuid REFERENCES public.trabajos(id);
CREATE INDEX IF NOT EXISTS idx_am_trabajo_id
  ON public.accounting_movements (trabajo_id) WHERE trabajo_id IS NOT NULL;

-- ── 4. Triggers de updated_at ──────────────────────────────────────
DROP TRIGGER IF EXISTS trg_trabajos_updated ON public.trabajos;
CREATE TRIGGER trg_trabajos_updated BEFORE UPDATE ON public.trabajos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_trabajo_cotizaciones_updated ON public.trabajo_cotizaciones;
CREATE TRIGGER trg_trabajo_cotizaciones_updated BEFORE UPDATE ON public.trabajo_cotizaciones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 5. RLS ─────────────────────────────────────────────────────────
-- Un trabajo es información comercial y contable: lo ven y escriben la
-- conducción, contabilidad y el equipo que busca trabajos (licitaciones). Los
-- roles de obra no tienen nada que hacer acá — a diferencia de `consorcios`,
-- esto NO es un dato que ya sea visible en otra tabla.
ALTER TABLE public.trabajos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trabajo_cotizaciones ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
  lectores text := 'ARRAY[''admin''::text, ''gerente''::text, ''contador''::text, ''ayudante_contador''::text, ''tesorero''::text, ''asistente_admin''::text, ''licitaciones''::text]';
  escritores text := 'ARRAY[''admin''::text, ''gerente''::text, ''contador''::text, ''licitaciones''::text]';
BEGIN
  FOREACH t IN ARRAY ARRAY['trabajos', 'trabajo_cotizaciones'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s: equipo lee" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "%s: equipo lee" ON public.%I FOR SELECT TO authenticated USING (public.has_role(%s))', t, t, lectores);
    EXECUTE format('DROP POLICY IF EXISTS "%s: equipo escribe" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "%s: equipo escribe" ON public.%I FOR ALL TO authenticated USING (public.has_role(%s)) WITH CHECK (public.has_role(%s))', t, t, escritores, escritores);
  END LOOP;
END $$;

-- ── 6. Cerco del rol campo (lección de las migs 167, 171 y 172) ────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['trabajos', 'trabajo_cotizaciones'] LOOP
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

COMMENT ON TABLE public.trabajos IS
  'Bienes y servicios con flujo corto (mig 174): cotización → compra → venta, o prestación directa. Tabla APARTE de `obras` porque no tiene partidas, cronograma, avance, personal, EPP ni almacén. Su único enganche transversal es accounting_movements.trabajo_id, nullable, igual que obra_id.';
COMMENT ON COLUMN public.accounting_movements.trabajo_id IS
  'A qué trabajo de bienes/servicios se imputa (mig 174). Etiqueta, NO titular: el titular contable sigue siendo company_id. Excluyente en la práctica con obra_id, pero sin CHECK: un movimiento puede no ser de ninguno de los dos.';

NOTIFY pgrst, 'reload schema';
