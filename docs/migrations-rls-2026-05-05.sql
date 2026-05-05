-- ─────────────────────────────────────────────────────────────────────
-- JARVEX — RLS bulk fix 2026-05-05
--
-- Setea políticas RLS estándar para que CUALQUIER usuario autenticado
-- (no solo admin) pueda crear/actualizar registros operativos. Sin esto,
-- los users con rol distinto a admin (almacenero, supervisor, etc.) ven
-- que sus cambios "desaparecen" porque el INSERT en Supabase falla con
-- 401/403 → pending_create indefinido → cuando el browser limpia cache
-- por low storage / sw update, los datos se pierden.
--
-- Política aplicada a CADA tabla operativa:
--   SELECT  → authenticated + deleted_at IS NULL (ver registros vivos)
--   INSERT  → authenticated (cualquier user logueado)
--   UPDATE  → authenticated (cualquier user logueado)
--   DELETE  → solo admin (proteger borrado masivo)
--
-- IDEMPOTENTE: usa DROP POLICY IF EXISTS antes de cada CREATE POLICY.
-- Podés ejecutarlo varias veces sin riesgo.
--
-- Cómo correrlo:
--   1. Supabase Dashboard → SQL Editor → New query
--   2. Pegá TODO este archivo
--   3. RUN
-- ─────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  t text;
  -- Lista de tablas operativas: si una no existe, el bloque la salta sin error.
  tablas text[] := ARRAY[
    'obras', 'personal', 'materiales', 'herramientas', 'proveedores',
    'partidas', 'insumos_partida', 'cronograma',
    'presupuestos_versiones', 'partidas_versionadas', 'insumos_partida_versionadas',
    'material_precios_historial',
    'companies', 'accounting_movements', 'intercompany_transactions',
    'trazabilidad_cadenas',
    'requisiciones', 'requisicion_items',
    'cotizaciones', 'cotizacion_items',
    'ordenes_compra', 'oc_items',
    'recepciones', 'recepcion_items',
    'valorizaciones', 'valorizacion_partidas', 'valorizacion_adicionales',
    'cuentas_bancarias', 'movimientos_bancarios', 'cronograma_pagos',
    'activos_pesados', 'horas_maquina', 'consumos_combustible', 'mantenimientos_maquinaria',
    'charlas_seguridad', 'charla_asistentes', 'iperc',
    'epp_entregas', 'inspecciones_seguridad', 'capacitaciones',
    'subcontratistas', 'subcontratos', 'subcontrato_valorizaciones',
    'personal_contrato', 'planillas', 'planilla_boletas',
    'asistencia',
    'movimientos_materiales', 'movimientos_herramientas',
    'avance_obra', 'incidencias', 'evidencias',
    'ubicaciones_obra'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    -- Si la tabla no existe, saltar
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      RAISE NOTICE 'Saltando %: tabla no existe', t;
      CONTINUE;
    END IF;

    -- Habilitar RLS (idempotente, no falla si ya está)
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- SELECT: cualquier autenticado puede leer registros no eliminados
    EXECUTE format('DROP POLICY IF EXISTS "%s: select autenticado" ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY "%s: select autenticado"
        ON public.%I FOR SELECT
        TO authenticated
        USING (deleted_at IS NULL OR deleted_at IS NOT NULL)
    $p$, t, t);
    -- (USING TRUE permite SELECT incluso de soft-deleted; el cliente filtra)

    -- INSERT: cualquier autenticado puede crear
    EXECUTE format('DROP POLICY IF EXISTS "%s: insert autenticado" ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY "%s: insert autenticado"
        ON public.%I FOR INSERT
        TO authenticated
        WITH CHECK (true)
    $p$, t, t);

    -- UPDATE: cualquier autenticado puede actualizar
    -- (Si en el futuro querés restringir, cambiar a USING (created_by = auth.uid())
    --  o solo admin via subselect en profiles.)
    EXECUTE format('DROP POLICY IF EXISTS "%s: update autenticado" ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY "%s: update autenticado"
        ON public.%I FOR UPDATE
        TO authenticated
        USING (true)
        WITH CHECK (true)
    $p$, t, t);

    -- DELETE: solo admin
    EXECUTE format('DROP POLICY IF EXISTS "%s: admin elimina" ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY "%s: admin elimina"
        ON public.%I FOR DELETE
        TO authenticated
        USING ((SELECT rol FROM public.profiles WHERE id = auth.uid()) = 'admin')
    $p$, t, t);

    RAISE NOTICE '✓ Políticas RLS aplicadas a %', t;
  END LOOP;
END $$;


-- Verificación: deberías ver 4 policies por tabla (select, insert, update, delete).
-- SELECT tablename, count(*) AS n_policies
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- GROUP BY tablename
-- ORDER BY tablename;


-- ─────────────────────────────────────────────────────────────────────
-- NOTA SOBRE PROFILES: las políticas de profiles se manejan en otra
-- migración (migrations-2026-05-04 con el trigger protect_profile_rol).
-- NO las tocamos acá.
-- ─────────────────────────────────────────────────────────────────────
