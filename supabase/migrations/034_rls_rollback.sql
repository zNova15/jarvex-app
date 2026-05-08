-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — RLS rollback (volver al USING(true) de la 030)
--
-- ADVERTENCIA: ejecutar SOLO si la migration 033 rompe operativa y
-- necesitás restaurar el estado anterior URGENTE. Esta migration vuelve
-- a abrir el RLS al estado pre-033 (cualquier autenticado lee/escribe
-- todo, solo admin borra). El audit_log también vuelve a ser editable.
--
-- Después de ejecutarla, rebloquear con un fix sobre la 033 lo antes
-- posible — no dejar producción con USING(true) por mucho tiempo.
-- ═══════════════════════════════════════════════════════════════════

-- Borrar policies de la 033 en TODAS las tablas
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname LIKE 'rls033_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
                   rec.policyname, rec.tablename);
  END LOOP;
END $$;

-- Restaurar policies abiertas (USING true) tabla por tabla (igual que 030).
DO $$
DECLARE
  t TEXT;
  tablas TEXT[] := ARRAY[
    'obras', 'personal', 'materiales', 'herramientas', 'epps',
    'movimientos_materiales', 'movimientos_herramientas', 'movimientos_epp',
    'epp_entregas',
    'partidas', 'insumos_partida', 'cronograma',
    'presupuestos_versiones', 'partidas_versionadas',
    'insumos_partida_versionadas', 'material_precios_historial',
    'companies', 'accounting_movements', 'intercompany_transactions',
    'trazabilidad_cadenas',
    'requisiciones', 'requisicion_items',
    'cotizaciones', 'cotizacion_items',
    'ordenes_compra', 'oc_items',
    'recepciones', 'recepcion_items',
    'valorizaciones', 'valorizacion_partidas', 'valorizacion_adicionales',
    'cuentas_bancarias', 'movimientos_bancarios', 'cronograma_pagos',
    'activos_pesados', 'horas_maquina', 'consumos_combustible',
    'mantenimientos_maquinaria',
    'charlas_seguridad', 'charla_asistentes', 'iperc',
    'inspecciones_seguridad', 'capacitaciones',
    'subcontratistas', 'subcontratos', 'subcontrato_valorizaciones',
    'personal_contrato', 'planillas', 'planilla_boletas',
    'asistencia', 'avance_obra', 'incidencias', 'evidencias',
    'evidencias_blobs', 'ubicaciones_obra',
    'change_requests'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = 'public' AND table_name = t) THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "rls033_rollback_select" ON public.%I
                    FOR SELECT TO authenticated USING (true)', t);
    EXECUTE format('CREATE POLICY "rls033_rollback_insert" ON public.%I
                    FOR INSERT TO authenticated WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY "rls033_rollback_update" ON public.%I
                    FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY "rls033_rollback_delete" ON public.%I
                    FOR DELETE TO authenticated USING (
                      EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND rol = ''admin'')
                    )', t);
  END LOOP;
END $$;

-- audit_log también
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rls033_audit_select" ON public.audit_log;
DROP POLICY IF EXISTS "rls033_audit_insert" ON public.audit_log;
CREATE POLICY "rls033_rollback_select" ON public.audit_log
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "rls033_rollback_insert" ON public.audit_log
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "rls033_rollback_update" ON public.audit_log
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "rls033_rollback_delete" ON public.audit_log
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND rol = 'admin')
  );

-- profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rls033_profiles_select" ON public.profiles;
DROP POLICY IF EXISTS "rls033_profiles_insert" ON public.profiles;
DROP POLICY IF EXISTS "rls033_profiles_update" ON public.profiles;
DROP POLICY IF EXISTS "rls033_profiles_delete" ON public.profiles;
CREATE POLICY "rls033_rollback_profiles_select" ON public.profiles
  FOR SELECT TO authenticated USING (true);

-- obra_usuarios
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'obra_usuarios') THEN
    EXECUTE 'ALTER TABLE public.obra_usuarios ENABLE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY "rls033_rollback_select" ON public.obra_usuarios
             FOR SELECT TO authenticated USING (true)';
    EXECUTE 'CREATE POLICY "rls033_rollback_insert" ON public.obra_usuarios
             FOR INSERT TO authenticated WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "rls033_rollback_update" ON public.obra_usuarios
             FOR UPDATE TO authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;

-- ⚠ ESTADO POST-ROLLBACK: cualquier usuario autenticado puede leer y
-- escribir TODAS las tablas. Volver al RLS estricto (033) lo antes
-- posible.
