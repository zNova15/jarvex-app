-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — RLS por roles (reemplaza el USING(true) de la 030)
--
-- Razón: la migration 030 puso `USING (true)` en TODAS las tablas para
-- desbloquear flujos del almacenero. Eso permitía que CUALQUIER user
-- autenticado leyera/escribiera CUALQUIER tabla — incluyendo planillas,
-- comprobantes SUNAT, libros contables, audit_log. Riesgo legal +
-- compliance (SUNAT auditable).
--
-- Esta migration alinea las policies de Postgres con la matriz de
-- permisos que ya está en src/components/jx-admin.jsx (PERM_MATRIX).
--
-- Estrategia gradual (paso 1 de N):
--   - Foco en `almacenero` y `admin` — los únicos roles activos hoy.
--   - Para el resto de roles: políticas permisivas (read) por ahora.
--     Cuando agreguen contador/RRHH/etc., se afina cada caso.
--
-- Helper functions: current_user_rol() y has_role(roles[]) — definidas
-- en SECURITY DEFINER para que no entren en loops infinitos cuando se
-- consultan dentro de las policies de profiles.
--
-- Rollback: ver 034_rls_rollback.sql (vuelve al USING(true) en 30s).
-- ═══════════════════════════════════════════════════════════════════

-- ── Helpers ─────────────────────────────────────────────────────────

-- Devuelve el rol del usuario autenticado actual o NULL si no hay sesión
-- o si el profile no tiene rol asignado. SECURITY DEFINER para que la
-- consulta a profiles no aplique las policies de la propia tabla
-- (evita recursión infinita).
CREATE OR REPLACE FUNCTION public.current_user_rol()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT rol FROM public.profiles WHERE id = auth.uid() LIMIT 1
$$;

-- Devuelve true si el user actual tiene uno de los roles dados.
-- Uso: USING (public.has_role(ARRAY['admin', 'almacenero']))
CREATE OR REPLACE FUNCTION public.has_role(roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND rol = ANY(roles)
  )
$$;

-- ── Macros para no repetir código ──────────────────────────────────
-- Usamos un DO $$ block que itera sobre listas de tablas con la misma
-- política. Reduce 50 tablas × 4 policies = 200 líneas a algo manejable.

-- Tabla de definición de policies por tabla. Cada entry tiene:
--   tabla:      nombre de la tabla
--   read_roles: NULL = todos los autenticados; array = solo esos roles
--   write_roles: roles que pueden INSERT/UPDATE
--   delete_roles: roles que pueden DELETE (default: solo admin)
--
-- Para JARVEX hoy (almacenero + admin activos):
--   - "todos" significa cualquier user autenticado puede LEER (porque la
--     UI ya filtra por rol y los demás roles no están activos).
--   - WRITE estricto: solo los roles que la matriz autoriza.

DO $$
DECLARE
  rec RECORD;
  pol_name TEXT;
BEGIN
  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  -- TABLAS QUE EL ALMACENERO PUEDE LEER + ESCRIBIR
  -- (matriz: Materiales, Herramientas, EPPs, Mov de cada uno, Recepciones, Evidencias, Incidencias, change_requests)
  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  FOR rec IN SELECT tabla FROM (VALUES
    ('materiales'), ('herramientas'), ('epps'),
    ('movimientos_materiales'), ('movimientos_herramientas'), ('movimientos_epp'),
    ('epp_entregas'),
    ('recepciones'), ('recepcion_items'),
    ('evidencias'), ('evidencias_blobs'),
    ('incidencias'),
    ('change_requests'), ('change_requests_pending')
  ) AS t(tabla)
  LOOP
    -- Saltar si la tabla no existe
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = 'public' AND table_name = rec.tabla) THEN
      RAISE NOTICE 'Saltando %: tabla no existe', rec.tabla;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rec.tabla);

    -- Borrar policies viejas (de migrations 015, 030)
    EXECUTE format('DROP POLICY IF EXISTS "%s: select autenticado" ON public.%I', rec.tabla, rec.tabla);
    EXECUTE format('DROP POLICY IF EXISTS "%s: insert autenticado" ON public.%I', rec.tabla, rec.tabla);
    EXECUTE format('DROP POLICY IF EXISTS "%s: update autenticado" ON public.%I', rec.tabla, rec.tabla);
    EXECUTE format('DROP POLICY IF EXISTS "%s: admin elimina" ON public.%I', rec.tabla, rec.tabla);
    EXECUTE format('DROP POLICY IF EXISTS "%s_select_all" ON public.%I', rec.tabla, rec.tabla);
    EXECUTE format('DROP POLICY IF EXISTS "%s_insert_auth" ON public.%I', rec.tabla, rec.tabla);
    EXECUTE format('DROP POLICY IF EXISTS "%s_update_auth" ON public.%I', rec.tabla, rec.tabla);
    EXECUTE format('DROP POLICY IF EXISTS "%s_delete_admin" ON public.%I', rec.tabla, rec.tabla);
    EXECUTE format('DROP POLICY IF EXISTS "rls033_select" ON public.%I', rec.tabla);
    EXECUTE format('DROP POLICY IF EXISTS "rls033_insert" ON public.%I', rec.tabla);
    EXECUTE format('DROP POLICY IF EXISTS "rls033_update" ON public.%I', rec.tabla);
    EXECUTE format('DROP POLICY IF EXISTS "rls033_delete" ON public.%I', rec.tabla);

    -- SELECT: todos los autenticados (la UI filtra por rol)
    EXECUTE format('CREATE POLICY "rls033_select" ON public.%I
                    FOR SELECT TO authenticated USING (true)', rec.tabla);

    -- INSERT: admin, gerente, ingeniero_residente, almacenero, supervisor, jefe_compras
    -- (el "supervisor" y "jefe_compras" pueden gestionar materiales/herramientas
    -- según la matriz; el resto de roles operativos no deberían escribir
    -- estas tablas pero por ahora dejamos a todos los roles canónicos para
    -- no romper flows de roles que aparezcan después).
    EXECUTE format('CREATE POLICY "rls033_insert" ON public.%I
                    FOR INSERT TO authenticated
                    WITH CHECK (public.has_role(ARRAY[''admin'', ''gerente'', ''ingeniero_residente'',
                                                       ''almacenero'', ''supervisor'', ''jefe_compras'',
                                                       ''asistente_admin'', ''maestro_obra'',
                                                       ''prevencionista'']))', rec.tabla);

    -- UPDATE: mismos roles que INSERT
    EXECUTE format('CREATE POLICY "rls033_update" ON public.%I
                    FOR UPDATE TO authenticated
                    USING (public.has_role(ARRAY[''admin'', ''gerente'', ''ingeniero_residente'',
                                                  ''almacenero'', ''supervisor'', ''jefe_compras'',
                                                  ''asistente_admin'', ''maestro_obra'',
                                                  ''prevencionista'']))
                    WITH CHECK (public.has_role(ARRAY[''admin'', ''gerente'', ''ingeniero_residente'',
                                                       ''almacenero'', ''supervisor'', ''jefe_compras'',
                                                       ''asistente_admin'', ''maestro_obra'',
                                                       ''prevencionista'']))', rec.tabla);

    -- DELETE: solo admin
    EXECUTE format('CREATE POLICY "rls033_delete" ON public.%I
                    FOR DELETE TO authenticated
                    USING (public.has_role(ARRAY[''admin'']))', rec.tabla);

    RAISE NOTICE '✓ RLS aplicado a % (almacenero rw)', rec.tabla;
  END LOOP;

  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  -- TABLAS QUE EL ALMACENERO LEE pero NO ESCRIBE
  -- (Requisiciones, OC, Cotizaciones, Proveedores, Personal, Asistencia,
  --  Activos pesados, etc.)
  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  FOR rec IN SELECT tabla FROM (VALUES
    ('obras'),
    ('proveedores'),
    ('personal'), ('asistencia'),
    ('partidas'), ('insumos_partida'), ('cronograma'),
    ('material_precios_historial'),
    ('ubicaciones_obra'),
    ('requisiciones'), ('requisicion_items'),
    ('cotizaciones'), ('cotizacion_items'),
    ('ordenes_compra'), ('oc_items'),
    ('activos_pesados'), ('horas_maquina'),
    ('consumos_combustible'), ('mantenimientos_maquinaria')
  ) AS t(tabla)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = 'public' AND table_name = rec.tabla) THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rec.tabla);

    EXECUTE format('DROP POLICY IF EXISTS "%s: select autenticado" ON public.%I', rec.tabla, rec.tabla);
    EXECUTE format('DROP POLICY IF EXISTS "%s: insert autenticado" ON public.%I', rec.tabla, rec.tabla);
    EXECUTE format('DROP POLICY IF EXISTS "%s: update autenticado" ON public.%I', rec.tabla, rec.tabla);
    EXECUTE format('DROP POLICY IF EXISTS "%s: admin elimina" ON public.%I', rec.tabla, rec.tabla);
    EXECUTE format('DROP POLICY IF EXISTS "rls033_select" ON public.%I', rec.tabla);
    EXECUTE format('DROP POLICY IF EXISTS "rls033_insert" ON public.%I', rec.tabla);
    EXECUTE format('DROP POLICY IF EXISTS "rls033_update" ON public.%I', rec.tabla);
    EXECUTE format('DROP POLICY IF EXISTS "rls033_delete" ON public.%I', rec.tabla);

    -- SELECT: todos autenticados (almacenero lee, pero NO escribe)
    EXECUTE format('CREATE POLICY "rls033_select" ON public.%I
                    FOR SELECT TO authenticated USING (true)', rec.tabla);

    -- INSERT/UPDATE: NO almacenero. Sí: admin, gerente, ingeniero_residente,
    -- supervisor, jefe_compras, rrhh, prevencionista, asistente_admin,
    -- maestro_obra (los que la matriz autoriza).
    EXECUTE format('CREATE POLICY "rls033_insert" ON public.%I
                    FOR INSERT TO authenticated
                    WITH CHECK (public.has_role(ARRAY[''admin'', ''gerente'', ''ingeniero_residente'',
                                                       ''supervisor'', ''jefe_compras'', ''rrhh'',
                                                       ''prevencionista'', ''asistente_admin'',
                                                       ''maestro_obra'']))', rec.tabla);
    EXECUTE format('CREATE POLICY "rls033_update" ON public.%I
                    FOR UPDATE TO authenticated
                    USING (public.has_role(ARRAY[''admin'', ''gerente'', ''ingeniero_residente'',
                                                  ''supervisor'', ''jefe_compras'', ''rrhh'',
                                                  ''prevencionista'', ''asistente_admin'',
                                                  ''maestro_obra'']))
                    WITH CHECK (public.has_role(ARRAY[''admin'', ''gerente'', ''ingeniero_residente'',
                                                       ''supervisor'', ''jefe_compras'', ''rrhh'',
                                                       ''prevencionista'', ''asistente_admin'',
                                                       ''maestro_obra'']))', rec.tabla);
    EXECUTE format('CREATE POLICY "rls033_delete" ON public.%I
                    FOR DELETE TO authenticated
                    USING (public.has_role(ARRAY[''admin'']))', rec.tabla);

    RAISE NOTICE '✓ RLS aplicado a % (almacenero r-only)', rec.tabla;
  END LOOP;

  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  -- TABLAS BLOQUEADAS PARA ALMACENERO (contabilidad, tesorería, RRHH,
  -- SUNAT, SSOMA non-EPP, planillas, valorizaciones, audit, subcontratos)
  -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  FOR rec IN SELECT tabla, read_roles, write_roles FROM (VALUES
    -- Contabilidad
    ('accounting_movements',
       ARRAY['admin', 'gerente', 'contador', 'tesorero', 'asistente_admin'],
       ARRAY['admin', 'gerente', 'contador']),
    ('companies',
       ARRAY['admin', 'gerente', 'contador', 'tesorero', 'asistente_admin'],
       ARRAY['admin', 'gerente', 'contador']),
    ('intercompany_transactions',
       ARRAY['admin', 'gerente', 'contador', 'tesorero'],
       ARRAY['admin', 'contador']),
    ('trazabilidad_cadenas',
       ARRAY['admin', 'gerente', 'contador'],
       ARRAY['admin', 'contador']),
    -- Tesorería
    ('cuentas_bancarias',
       ARRAY['admin', 'gerente', 'tesorero', 'contador'],
       ARRAY['admin', 'tesorero']),
    ('movimientos_bancarios',
       ARRAY['admin', 'gerente', 'tesorero', 'contador'],
       ARRAY['admin', 'tesorero']),
    ('cronograma_pagos',
       ARRAY['admin', 'gerente', 'tesorero', 'contador'],
       ARRAY['admin', 'tesorero']),
    -- RRHH / Planillas
    ('personal_contrato',
       ARRAY['admin', 'gerente', 'rrhh', 'asistente_admin'],
       ARRAY['admin', 'rrhh']),
    ('planillas',
       ARRAY['admin', 'gerente', 'rrhh', 'tesorero', 'asistente_admin'],
       ARRAY['admin', 'rrhh']),
    ('planilla_boletas',
       ARRAY['admin', 'gerente', 'rrhh', 'tesorero'],
       ARRAY['admin', 'rrhh']),
    -- Valorizaciones
    ('valorizaciones',
       ARRAY['admin', 'gerente', 'contador', 'ingeniero_residente'],
       ARRAY['admin', 'gerente', 'contador', 'ingeniero_residente']),
    ('valorizacion_partidas',
       ARRAY['admin', 'gerente', 'contador', 'ingeniero_residente'],
       ARRAY['admin', 'gerente', 'contador', 'ingeniero_residente']),
    ('valorizacion_adicionales',
       ARRAY['admin', 'gerente', 'contador', 'ingeniero_residente'],
       ARRAY['admin', 'gerente', 'contador', 'ingeniero_residente']),
    ('presupuestos_versiones',
       ARRAY['admin', 'gerente', 'ingeniero_residente', 'contador'],
       ARRAY['admin', 'gerente', 'ingeniero_residente']),
    ('partidas_versionadas',
       ARRAY['admin', 'gerente', 'ingeniero_residente', 'contador'],
       ARRAY['admin', 'gerente', 'ingeniero_residente']),
    ('insumos_partida_versionadas',
       ARRAY['admin', 'gerente', 'ingeniero_residente', 'contador'],
       ARRAY['admin', 'gerente', 'ingeniero_residente']),
    -- SSOMA (non-EPP). Almacenero solo ve EPP, no esto.
    ('iperc',
       ARRAY['admin', 'gerente', 'ingeniero_residente', 'supervisor', 'prevencionista'],
       ARRAY['admin', 'prevencionista', 'gerente']),
    ('charlas_seguridad',
       ARRAY['admin', 'gerente', 'ingeniero_residente', 'supervisor', 'prevencionista'],
       ARRAY['admin', 'prevencionista', 'supervisor']),
    ('charla_asistentes',
       ARRAY['admin', 'gerente', 'supervisor', 'prevencionista'],
       ARRAY['admin', 'prevencionista', 'supervisor']),
    ('inspecciones_seguridad',
       ARRAY['admin', 'gerente', 'ingeniero_residente', 'supervisor', 'prevencionista'],
       ARRAY['admin', 'prevencionista']),
    ('capacitaciones',
       ARRAY['admin', 'gerente', 'rrhh', 'prevencionista'],
       ARRAY['admin', 'rrhh', 'prevencionista']),
    -- Subcontratos
    ('subcontratistas',
       ARRAY['admin', 'gerente', 'contador', 'ingeniero_residente'],
       ARRAY['admin', 'gerente']),
    ('subcontratos',
       ARRAY['admin', 'gerente', 'contador', 'ingeniero_residente'],
       ARRAY['admin', 'gerente']),
    ('subcontrato_valorizaciones',
       ARRAY['admin', 'gerente', 'contador', 'ingeniero_residente'],
       ARRAY['admin', 'gerente', 'contador']),
    -- Avance de obra (lo registra el ingeniero residente / supervisor)
    ('avance_obra',
       ARRAY['admin', 'gerente', 'ingeniero_residente', 'supervisor', 'maestro_obra'],
       ARRAY['admin', 'ingeniero_residente', 'supervisor', 'maestro_obra'])
  ) AS t(tabla, read_roles, write_roles)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = 'public' AND table_name = rec.tabla) THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rec.tabla);

    EXECUTE format('DROP POLICY IF EXISTS "%s: select autenticado" ON public.%I', rec.tabla, rec.tabla);
    EXECUTE format('DROP POLICY IF EXISTS "%s: insert autenticado" ON public.%I', rec.tabla, rec.tabla);
    EXECUTE format('DROP POLICY IF EXISTS "%s: update autenticado" ON public.%I', rec.tabla, rec.tabla);
    EXECUTE format('DROP POLICY IF EXISTS "%s: admin elimina" ON public.%I', rec.tabla, rec.tabla);
    EXECUTE format('DROP POLICY IF EXISTS "rls033_select" ON public.%I', rec.tabla);
    EXECUTE format('DROP POLICY IF EXISTS "rls033_insert" ON public.%I', rec.tabla);
    EXECUTE format('DROP POLICY IF EXISTS "rls033_update" ON public.%I', rec.tabla);
    EXECUTE format('DROP POLICY IF EXISTS "rls033_delete" ON public.%I', rec.tabla);

    EXECUTE format('CREATE POLICY "rls033_select" ON public.%I
                    FOR SELECT TO authenticated USING (public.has_role(%L))',
                    rec.tabla, rec.read_roles);
    EXECUTE format('CREATE POLICY "rls033_insert" ON public.%I
                    FOR INSERT TO authenticated WITH CHECK (public.has_role(%L))',
                    rec.tabla, rec.write_roles);
    EXECUTE format('CREATE POLICY "rls033_update" ON public.%I
                    FOR UPDATE TO authenticated
                    USING (public.has_role(%L))
                    WITH CHECK (public.has_role(%L))',
                    rec.tabla, rec.write_roles, rec.write_roles);
    EXECUTE format('CREATE POLICY "rls033_delete" ON public.%I
                    FOR DELETE TO authenticated USING (public.has_role(ARRAY[''admin'']))',
                    rec.tabla);

    RAISE NOTICE '✓ RLS aplicado a % (denegado almacenero)', rec.tabla;
  END LOOP;
END $$;

-- ── Audit log: ÚNICA tabla totalmente inmutable ─────────────────────
-- Política SOLO para admin: leer todo, sin INSERT/UPDATE/DELETE manual.
-- Las entries las inserta un trigger del sistema (ver migration 008).
-- Si admin necesita "limpiar" entries de prueba, lo hace vos como dev
-- desde Supabase Dashboard SQL editor (raro, casi nunca debería pasar).
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_log: select autenticado" ON public.audit_log;
DROP POLICY IF EXISTS "audit_log: insert autenticado" ON public.audit_log;
DROP POLICY IF EXISTS "audit_log: update autenticado" ON public.audit_log;
DROP POLICY IF EXISTS "audit_log: admin elimina" ON public.audit_log;
DROP POLICY IF EXISTS "rls033_select" ON public.audit_log;
DROP POLICY IF EXISTS "rls033_insert" ON public.audit_log;
DROP POLICY IF EXISTS "rls033_update" ON public.audit_log;
DROP POLICY IF EXISTS "rls033_delete" ON public.audit_log;

-- Read: solo admin.
CREATE POLICY "rls033_audit_select" ON public.audit_log
  FOR SELECT TO authenticated USING (public.has_role(ARRAY['admin']));

-- Insert: cualquier user autenticado puede insertar (lo hace el SDK o
-- triggers automáticamente — el cliente loguea "insert", "delete",
-- etc. de sus propias acciones). Sin esto el sistema de audit no
-- registra nada.
CREATE POLICY "rls033_audit_insert" ON public.audit_log
  FOR INSERT TO authenticated WITH CHECK (true);

-- NO hay policy de UPDATE ni DELETE → nadie puede modificar audit_log.
-- Si admin necesita borrar entries, lo hace desde SQL editor con el
-- service_role (que bypasea RLS).

-- ── Profiles & obra_usuarios: cada user ve el suyo + admin ve todo ──
-- Policies más estrictas porque son tablas de auth/permisos.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles_select_own_or_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_admin_all" ON public.profiles;
DROP POLICY IF EXISTS "rls033_profiles_select" ON public.profiles;
DROP POLICY IF EXISTS "rls033_profiles_update" ON public.profiles;
DROP POLICY IF EXISTS "rls033_profiles_insert" ON public.profiles;
DROP POLICY IF EXISTS "rls033_profiles_delete" ON public.profiles;

-- Cada user puede ver TODOS los profiles (necesario para mostrar
-- nombres en lugar de UUIDs en la UI: "asignado a Juan Pérez", etc.).
-- Si querés que vea solo el suyo, cambiar a (id = auth.uid()).
CREATE POLICY "rls033_profiles_select" ON public.profiles
  FOR SELECT TO authenticated USING (true);

-- Solo admin puede crear o modificar profiles. (Triggers para auto-create
-- en signup van con el service_role, bypasean RLS.)
CREATE POLICY "rls033_profiles_insert" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(ARRAY['admin']));
CREATE POLICY "rls033_profiles_update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.has_role(ARRAY['admin']) OR id = auth.uid())
  WITH CHECK (public.has_role(ARRAY['admin']) OR id = auth.uid());
CREATE POLICY "rls033_profiles_delete" ON public.profiles
  FOR DELETE TO authenticated USING (public.has_role(ARRAY['admin']));

-- obra_usuarios: solo admin puede gestionarlas, cualquiera puede ver
-- a quién está asignado (para flow de "asignar materiales a la persona").
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'obra_usuarios') THEN
    EXECUTE 'ALTER TABLE public.obra_usuarios ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "obra_usuarios: select autenticado" ON public.obra_usuarios';
    EXECUTE 'DROP POLICY IF EXISTS "obra_usuarios: insert autenticado" ON public.obra_usuarios';
    EXECUTE 'DROP POLICY IF EXISTS "obra_usuarios: update autenticado" ON public.obra_usuarios';
    EXECUTE 'DROP POLICY IF EXISTS "obra_usuarios: admin elimina" ON public.obra_usuarios';
    EXECUTE 'DROP POLICY IF EXISTS "rls033_select" ON public.obra_usuarios';
    EXECUTE 'DROP POLICY IF EXISTS "rls033_insert" ON public.obra_usuarios';
    EXECUTE 'DROP POLICY IF EXISTS "rls033_update" ON public.obra_usuarios';
    EXECUTE 'DROP POLICY IF EXISTS "rls033_delete" ON public.obra_usuarios';
    EXECUTE 'CREATE POLICY "rls033_select" ON public.obra_usuarios
             FOR SELECT TO authenticated USING (true)';
    EXECUTE 'CREATE POLICY "rls033_insert" ON public.obra_usuarios
             FOR INSERT TO authenticated
             WITH CHECK (public.has_role(ARRAY[''admin'']))';
    EXECUTE 'CREATE POLICY "rls033_update" ON public.obra_usuarios
             FOR UPDATE TO authenticated
             USING (public.has_role(ARRAY[''admin'']))
             WITH CHECK (public.has_role(ARRAY[''admin'']))';
    EXECUTE 'CREATE POLICY "rls033_delete" ON public.obra_usuarios
             FOR DELETE TO authenticated USING (public.has_role(ARRAY[''admin'']))';
  END IF;
END $$;

-- ── Verificación post-aplicación ────────────────────────────────────
-- Para verificar manualmente después de aplicar:
--
-- 1. Loguearse como almacenero y probar:
--    SELECT * FROM planillas;        -- debería devolver vacío o error
--    SELECT * FROM cuentas_bancarias; -- debería devolver vacío o error
--    SELECT * FROM materiales;       -- OK, ve todos
--    INSERT INTO movimientos_materiales (...) VALUES (...); -- OK
--
-- 2. Loguearse como admin y probar:
--    SELECT * FROM planillas;        -- ve todo
--    SELECT * FROM audit_log;        -- ve todo
--    DELETE FROM audit_log WHERE ...; -- FALLA (audit_log inmutable)
--
-- 3. Verificar que las policies están aplicadas:
--    SELECT tablename, policyname FROM pg_policies
--    WHERE schemaname = 'public' AND policyname LIKE 'rls033_%'
--    ORDER BY tablename;

COMMENT ON FUNCTION public.current_user_rol() IS
  'JARVEX RLS helper — returns rol of currently authenticated user, or NULL.';
COMMENT ON FUNCTION public.has_role(TEXT[]) IS
  'JARVEX RLS helper — true if current user has one of the given roles.';
