-- ═══════════════════════════════════════════════════════════════════
-- 231 — CERRAR LA BASE (tanda A de la revisión Ola 1, 25/26-set-2026)
--
-- Todo lo que sigue salió medido en producción (ver
-- docs/revision-ola1/ola1-rls-migraciones.md). Ningún punto le cambia a un
-- usuario con sesión lo que ve o lo que puede escribir, salvo tres, que son
-- justamente los huecos:
--   · anon (la clave pública del bundle) deja de leer 283 evidencias.
--   · la cuenta compartida `campo` deja de leer/escribir las 15 tablas que
--     nacieron sin su cerco (Gabriel, 25-set: «solo compañías y sus fotos»).
--   · nadie sin ser admin puede crearse un perfil, ni firmar la auditoría con
--     el user_id de otro.
--
-- Secciones:
--   1. evidencias: la policy de SELECT vuelve a ser TO authenticated.
--   2. storage: las 4 policies TO public del bucket pasan a TO authenticated.
--   3. anon sin privilegios sobre las tablas de public.
--   4. Funciones SECURITY DEFINER fuera del alcance de anon/PUBLIC.
--   5. Triggers bancarios con los permisos correctos.
--   6. profiles: fuera el INSERT abierto; el candado de rol también en INSERT.
--   7. audit_log: fuera el INSERT con WITH CHECK (true).
--   8. rls033_*: se borran solo las que conviven con otra más amplia.
--   9. Cerco `campo` en las tablas que no lo tenían + forma InitPlan.
--  10. updated_at sellado por el server en INSERT y en UPDATE (bug de la 150).
--  11. Índices (updated_at, id) en las 6 tablas pesadas.
--  12. sync_pull: modo keyset opcional (el cliente actual no lo usa).
--  13. jx_invariantes_tablas(): el chequeo para toda tabla nueva.
--
-- Qué NO está acá, a propósito:
--   · La 034 (rls_rollback) NO se aplica: es un rollback de emergencia que
--     REABRE todo con USING(true). Lo que había que hacer con la 033 era
--     sacar lo redundante (sección 8), no revertirla. El comentario de la
--     155 («la 033 fue revertida por la 034») es falso: la 034 nunca corrió.
--   · La 176 (espejo E001-1/E001-2 a EL INCA) quedó superada por los datos:
--     ver 232.
--   · El cerco de ESCRITURA contable por rol es la tanda B.
-- ═══════════════════════════════════════════════════════════════════


-- ── 1) evidencias: SELECT solo para autenticados ─────────────────────
-- Las migs 189 y 201 la recrearon sin TO authenticated y con ELSE true:
-- anon listaba 283 evidencias (firmas EPP, SCTR, fotos) con ruta y
-- observaciones. El cuerpo no se toca (espejo de evidencias-visibilidad.js).
ALTER POLICY "evidencias: ver segun tipo" ON public.evidencias TO authenticated;


-- ── 2) storage: las policies del bucket evidencias, TO authenticated ──
-- Las cuatro ya exigían auth.uid() IS NOT NULL o rol admin: para anon el
-- resultado no cambia. Pasan a TO authenticated para que anon no las evalúe:
-- leen public.profiles y public.obra_usuarios, y después de la sección 3
-- anon no tiene privilegio sobre esas tablas (pasaría de «0 filas» a error).
ALTER POLICY "evidencias: actualizar por obra"  ON storage.objects TO authenticated;
ALTER POLICY "evidencias: gestionar (admin)"    ON storage.objects TO authenticated;
ALTER POLICY "evidencias: subir por obra"       ON storage.objects TO authenticated;
ALTER POLICY "evidencias: ver por obra"         ON storage.objects TO authenticated;


-- ── 3) anon sin privilegios en public ────────────────────────────────
-- Nada de la app lee tablas sin sesión (medido en pg_stat_statements: anon
-- solo aparece en el sync corriendo con la sesión caída, y en storage). Con
-- el REVOKE esas consultas fallan al instante en vez de evaluar RLS para
-- devolver 0 filas (172 ms por llamada en insumos_partida).
-- El pull ante un error de permiso solo registra y sigue: no mueve el cursor
-- ni reintenta en cascada (SyncEngine.js, pullMasterTables).
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL     ON TABLES    FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL     ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;


-- ── 4) SECURITY DEFINER fuera de anon/PUBLIC ─────────────────────────
-- Los helpers de las policies devolvían NULL/false para anon, pero no tienen
-- por qué estar expuestos por /rest/v1/rpc. recalcular_stock_herramientas_obra
-- sí ESCRIBE: con la anon key se podía forzar el UPDATE de herramientas de
-- cualquier obra en bucle (re-pull en todos los dispositivos = egress).
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.current_user_rol()', 'public.es_rol_global()', 'public.has_role(text[])',
    'public.is_admin()', 'public.mis_obras()', 'public.puede_ver_obra(uuid)',
    'public.user_has_access_to_obra(uuid)', 'public.user_rol_in_obra(uuid)',
    'public.recalcular_stock_herramientas_obra(uuid)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;

-- La RPC recalcula solo desde el historial (no acepta números de afuera),
-- pero salta RLS: que solo lo haga quien ve la obra. auth.uid() NULL es el
-- service_role (scripts): pasa.
CREATE OR REPLACE FUNCTION public.recalcular_stock_herramientas_obra(p_obra_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE n integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.puede_ver_obra(p_obra_id) THEN
    RAISE EXCEPTION 'Sin acceso a la obra %', p_obra_id USING ERRCODE = '42501';
  END IF;

  WITH sums AS (
    SELECT m.herramienta_id AS hid,
           SUM(CASE COALESCE(NULLIF(m.tipo_movimiento, ''), m.accion)
             WHEN 'entrada'    THEN  COALESCE(m.cantidad, 0)
             WHEN 'ingreso'    THEN  COALESCE(m.cantidad, 0)
             WHEN 'devolucion' THEN  COALESCE(m.cantidad, 0)
             WHEN 'reposicion' THEN  COALESCE(m.cantidad, 0)
             WHEN 'ajuste'     THEN  COALESCE(m.cantidad, 0)
             WHEN 'salida'     THEN -COALESCE(m.cantidad, 0)
             WHEN 'merma'      THEN -COALESCE(m.cantidad, 0)
             WHEN 'baja'       THEN -COALESCE(m.cantidad, 0)
             ELSE 0 END) AS bal
    FROM movimientos_herramientas m
    WHERE m.obra_id = p_obra_id
      AND m.deleted_at IS NULL
      AND m.reverses_id IS NULL
      AND m.reversed_by_id IS NULL
    GROUP BY m.herramienta_id
  ),
  upd AS (
    UPDATE herramientas h
    SET stock_actual = GREATEST(0, COALESCE(s.bal, 0)),
        alerta = CASE
          WHEN COALESCE(h.stock_minimo, 0) <= 0 THEN 'ok'
          WHEN GREATEST(0, COALESCE(s.bal, 0)) <= 0 THEN 'agotado'
          WHEN GREATEST(0, COALESCE(s.bal, 0)) <= h.stock_minimo * 0.5 THEN 'critico'
          WHEN GREATEST(0, COALESCE(s.bal, 0)) <= h.stock_minimo THEN 'reponer'
          WHEN GREATEST(0, COALESCE(s.bal, 0)) <= h.stock_minimo * 1.2 THEN 'cerca'
          ELSE 'ok' END,
        updated_at = now()
    FROM sums s
    WHERE h.id = s.hid
      AND h.obra_id = p_obra_id
      AND h.deleted_at IS NULL
      AND h.stock_actual IS DISTINCT FROM GREATEST(0, COALESCE(s.bal, 0))
    RETURNING 1
  )
  SELECT count(*) INTO n FROM upd;
  RETURN n;
END;
$function$;


-- ── 5) Triggers bancarios ────────────────────────────────────────────
-- check_parte_deposito y mb_check_cuenta_coherente validan integridad
-- leyendo otras tablas: con SECURITY INVOKER lo hacían con el RLS de quien
-- escribe (un gerente recibía «depósito no existe»; un rol que no ve
-- pagos_partes pasaba el chequeo en silencio). Un trigger no necesita
-- EXECUTE para dispararse: se le quita a todos. Hoy 0 filas en esas tablas.
ALTER FUNCTION public.check_parte_deposito()      SECURITY DEFINER;
ALTER FUNCTION public.mb_check_cuenta_coherente() SECURITY DEFINER;
ALTER FUNCTION public.mb_check_cuenta_coherente() SET search_path = public, pg_temp;
ALTER FUNCTION public.mb_marcar_conciliado()      SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION public.check_parte_deposito()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mb_check_cuenta_coherente() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mb_marcar_conciliado()      FROM PUBLIC, anon, authenticated;


-- ── 6) profiles ──────────────────────────────────────────────────────
-- "profiles: insert" (WITH CHECK true, para public) no estaba en ninguna
-- migración. Con ella, un usuario sin perfil (si handle_new_user fallara
-- una vez) podía crearse el suyo con rol='admin'. Quedan
-- "profiles: admin inserta" y rls033_profiles_insert: solo admin.
-- handle_new_user es SECURITY DEFINER y create-user usa service_role: ninguno
-- depende de esta policy.
DROP POLICY IF EXISTS "profiles: insert" ON public.profiles;

-- Defensa en profundidad: el candado de rol también en INSERT. auth.uid()
-- NULL = GoTrue (handle_new_user) o service_role (api/create-user): pasan.
CREATE OR REPLACE FUNCTION public.protect_profile_rol()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  caller_rol text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL AND COALESCE(NEW.rol, 'solo_lectura') <> 'solo_lectura' THEN
      SELECT rol INTO caller_rol FROM public.profiles WHERE id = auth.uid();
      IF caller_rol IS NULL OR caller_rol <> 'admin' THEN
        RAISE EXCEPTION 'Solo un administrador puede crear perfiles con rol (intento por user %)', auth.uid()
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- Si rol o activo cambiaron, validar que el caller sea admin
  IF (NEW.rol IS DISTINCT FROM OLD.rol)
     OR (NEW.activo IS DISTINCT FROM OLD.activo) THEN
    SELECT rol INTO caller_rol
    FROM public.profiles
    WHERE id = auth.uid();

    IF caller_rol IS NULL OR caller_rol <> 'admin' THEN
      RAISE EXCEPTION 'Solo un administrador puede modificar rol o activo (intento por user %)', auth.uid()
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS protect_profile_rol_trigger ON public.profiles;
CREATE TRIGGER protect_profile_rol_trigger
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_rol();


-- ── 7) audit_log ─────────────────────────────────────────────────────
-- rls033_audit_insert (WITH CHECK true) vivía en OR con "audit_log:
-- autenticado inserta propio" (user_id = auth.uid()): cualquiera podía firmar
-- una entrada con el user_id de la contadora. Medido: las 503 entradas de
-- los últimos 7 días traen user_id; ninguna función del server escribe acá.
-- El cliente (src/lib/audit.js) sube solo las filas del usuario de la sesión.
DROP POLICY IF EXISTS rls033_audit_insert ON public.audit_log;


-- ── 8) rls033_*: fuera las redundantes ───────────────────────────────
-- La 033 agregó policies por rol (has_role) que quedaron en OR con las
-- viejas `uid IS NOT NULL` / `true`: no restringen nada y cuestan una
-- consulta a profiles POR FILA. Se borra una rls033 solo si en su tabla hay
-- otra PERMISSIVE para el mismo comando, para authenticated/public, cuya
-- expresión es trivialmente más amplia. Cero cambio de acceso.
-- Se QUEDAN las que son la política real (DELETE solo admin, epps,
-- ubicaciones_obra, trazabilidad_cadenas, obra_usuarios, profiles, audit
-- select): esas no tienen hermana más amplia.
DO $$
DECLARE r record; n int := 0;
  amplia constant text := '^\(?\s*(true|\(?\s*\(?\s*select auth\.uid\(\) as uid\)?\s*is not null\)?|\(?auth\.uid\(\) is not null\)?)\s*\)?$';
BEGIN
  FOR r IN
    SELECT p.tablename, p.policyname
    FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.policyname LIKE 'rls033_%' AND p.permissive = 'PERMISSIVE'
      AND EXISTS (
        SELECT 1 FROM pg_policies a
        WHERE a.schemaname = 'public' AND a.tablename = p.tablename
          AND a.policyname NOT LIKE 'rls033_%' AND a.permissive = 'PERMISSIVE'
          AND (a.cmd = p.cmd OR a.cmd = 'ALL')
          AND a.roles && ARRAY['public','authenticated']::name[]
          AND CASE
                WHEN p.cmd IN ('SELECT','DELETE') THEN coalesce(a.qual,'') ~* amplia
                WHEN p.cmd = 'INSERT' THEN coalesce(a.with_check,'') ~* amplia
                ELSE coalesce(a.qual,'') ~* amplia
                     AND (a.with_check IS NULL OR a.with_check ~* amplia)
              END)
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'rls033 redundantes borradas: %', n;
END $$;


-- ── 9) Cerco `campo` ─────────────────────────────────────────────────
-- 9a) Las tablas que nacieron después de la 155 sin su cerco (180, 183,
-- 192-196, 205-207, 216, 217, 222) y el SELECT de obras. Decisión de
-- Gabriel (25-set): la cuenta campo ve SOLO companies y sus fotos
-- (evidencias factura_campo, cerco fino de la 155). app_config sigue
-- legible (el cliente de campo la baja; no tiene secretos).
-- Solo se CREA lo que falta: no se pisa ningún cerco existente.
DO $$
DECLARE t text; c text; n int := 0;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
             AND tablename NOT IN ('evidencias','profiles') LOOP
    FOREACH c IN ARRAY ARRAY['select','insert','update','delete'] LOOP
      CONTINUE WHEN c = 'select' AND t IN ('companies','app_config');
      CONTINUE WHEN EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                              AND tablename = t AND policyname = 'campo_cerco_' || c);
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      IF c = 'select' THEN
        EXECUTE format('CREATE POLICY campo_cerco_select ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING ((SELECT public.current_user_rol()) IS DISTINCT FROM ''campo'')', t);
      ELSIF c = 'insert' THEN
        EXECUTE format('CREATE POLICY campo_cerco_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.current_user_rol()) IS DISTINCT FROM ''campo'')', t);
      ELSIF c = 'update' THEN
        EXECUTE format('CREATE POLICY campo_cerco_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING ((SELECT public.current_user_rol()) IS DISTINCT FROM ''campo'') WITH CHECK ((SELECT public.current_user_rol()) IS DISTINCT FROM ''campo'')', t);
      ELSE
        EXECUTE format('CREATE POLICY campo_cerco_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING ((SELECT public.current_user_rol()) IS DISTINCT FROM ''campo'')', t);
      END IF;
      n := n + 1;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'campo_cerco creadas: %', n;
END $$;

-- 9b) Forma InitPlan en TODAS las campo_cerco_*: `current_user_rol()` suelto
-- se evalúa por fila (una consulta a profiles por fila: 355 ms para las
-- 6.722 de insumos_partida_versionadas). Envuelto en (SELECT …) se calcula
-- una vez por consulta. Mismo resultado: la función es STABLE.
DO $$
DECLARE r record; nq text; nw text; n int := 0;
  pat constant text := '(public\.)?current_user_rol\(\)';
  rep constant text := '(SELECT public.current_user_rol())';
BEGIN
  FOR r IN SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies
           WHERE schemaname = 'public' AND policyname LIKE 'campo_cerco_%' LOOP
    nq := CASE WHEN r.qual IS NULL OR r.qual ~* 'select (public\.)?current_user_rol\(\)' THEN NULL
               ELSE regexp_replace(r.qual, pat, rep, 'g') END;
    nw := CASE WHEN r.with_check IS NULL OR r.with_check ~* 'select (public\.)?current_user_rol\(\)' THEN NULL
               ELSE regexp_replace(r.with_check, pat, rep, 'g') END;
    CONTINUE WHEN nq IS NULL AND nw IS NULL;
    IF nq IS NOT NULL AND nw IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s) WITH CHECK (%s)', r.policyname, r.tablename, nq, nw);
    ELSIF nq IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)', r.policyname, r.tablename, nq);
    ELSE
      EXECUTE format('ALTER POLICY %I ON public.%I WITH CHECK (%s)', r.policyname, r.tablename, nw);
    END IF;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'campo_cerco pasadas a InitPlan: %', n;
END $$;


-- ── 10) updated_at sellado por el server ─────────────────────────────
-- La 150 lo hizo para las tablas de agosto y nada lo re-corrió: 28 tablas
-- sin sello en INSERT y 24 sin sello en UPDATE. Sin el sello, una fila
-- creada/editada offline llega con el updated_at del cliente, queda detrás
-- del watermark de los demás dispositivos y NO baja nunca por pull (el
-- síntoma «a la contadora no le salen las recomendaciones» de la 217).
-- El push ya cuenta con que el server suba version (CAS con version − 1).

-- UPDATE sin columna version (evidencias, reportes_email_config): solo la fecha.
CREATE OR REPLACE FUNCTION public.set_updated_at_on_update()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.set_updated_at_on_update() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t record; n_ins int := 0; n_upd int := 0; tiene_version boolean;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = 'public' AND tb.table_type = 'BASE TABLE'
      AND c.column_name = 'updated_at'
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                   WHERE tgrelid = format('public.%I', t.table_name)::regclass
                     AND tgname = 'trg_updated_at_insert') THEN
      EXECUTE format('CREATE TRIGGER trg_updated_at_insert BEFORE INSERT ON public.%I
                        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_on_insert()', t.table_name);
      n_ins := n_ins + 1;
    END IF;

    -- ¿Ya hay un BEFORE UPDATE por fila que selle updated_at?
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
      WHERE tg.tgrelid = format('public.%I', t.table_name)::regclass
        AND NOT tg.tgisinternal
        AND (tg.tgtype & 2) = 2      -- BEFORE
        AND (tg.tgtype & 1) = 1      -- FOR EACH ROW
        AND (tg.tgtype & 16) = 16    -- UPDATE
        AND p.proname ~ 'updated'
    ) THEN
      SELECT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = t.table_name
                       AND column_name = 'version') INTO tiene_version;
      EXECUTE format('CREATE TRIGGER trg_updated_at_update BEFORE UPDATE ON public.%I
                        FOR EACH ROW EXECUTE FUNCTION public.%s()',
                     t.table_name,
                     CASE WHEN tiene_version THEN 'update_updated_at' ELSE 'set_updated_at_on_update' END);
      n_upd := n_upd + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'triggers de updated_at creados: INSERT % · UPDATE %', n_ins, n_upd;
END $$;


-- ── 11) Índices para el pull incremental ─────────────────────────────
-- Ninguna tabla pesada tenía índice por updated_at: cada pull era Seq Scan +
-- sort (71.060 llamadas × 165 ms solo en insumos_partida_versionadas). El
-- orden (updated_at, id) es el del cursor compuesto (sección 12 / tanda E).
-- Tablas chicas (< 7.000 filas): CREATE INDEX sin CONCURRENTLY es instantáneo.
CREATE INDEX IF NOT EXISTS idx_insumos_partida_versionadas_upd_id ON public.insumos_partida_versionadas (updated_at, id);
CREATE INDEX IF NOT EXISTS idx_insumos_partida_upd_id             ON public.insumos_partida (updated_at, id);
CREATE INDEX IF NOT EXISTS idx_partidas_upd_id                    ON public.partidas (updated_at, id);
CREATE INDEX IF NOT EXISTS idx_accounting_movements_upd_id        ON public.accounting_movements (updated_at, id);
CREATE INDEX IF NOT EXISTS idx_evidencias_upd_id                  ON public.evidencias (updated_at, id);
CREATE INDEX IF NOT EXISTS idx_movimientos_materiales_upd_id      ON public.movimientos_materiales (updated_at, id);


-- ── 12) sync_pull: modo keyset opcional ──────────────────────────────
-- Hoy filtra `updated_at >= w` sin id: todo bloque con el mismo sello se
-- reenvía cada ciclo, y si pasa del tope devuelve {trunc:true} y el cliente
-- cae a GET individuales. Se agrega, SIN cambiar lo existente, un modo por
-- cursor compuesto: si la entrada trae `i` (el id del borde), filtra
-- (updated_at, id) > (w, i), ordena por (updated_at, id) y devuelve la
-- página aunque esté llena: {rows, mas:true}. Una página parcial es válida
-- en keyset: el cliente avanza el cursor a la última fila.
-- El cliente actual NO manda `i` → comportamiento idéntico. Lo adopta la
-- tanda E (SyncEngine).
CREATE OR REPLACE FUNCTION public.sync_pull(p_entries jsonb, p_limit integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  ent jsonb;
  res jsonb := '{}'::jsonb;
  k text; t text; w text; i text; tipo_id text;
  filas jsonb; n int; cap int;
begin
  cap := least(greatest(coalesce(p_limit, 500), 1), 1000);

  if p_entries is null or jsonb_typeof(p_entries) <> 'array'
     or jsonb_array_length(p_entries) > 250 then
    return jsonb_build_object('__err', 'entradas_invalidas');
  end if;

  for ent in select * from jsonb_array_elements(p_entries) loop
    k := ent->>'k';  t := ent->>'t';  w := ent->>'w';  i := ent->>'i';
    if k is null or t is null or w is null then
      continue;
    end if;

    if t !~ '^[a-z][a-z0-9_]{0,62}$' or to_regclass('public.' || t) is null then
      res := res || jsonb_build_object(k, jsonb_build_object('err', 'tabla_invalida'));
      continue;
    end if;

    if not exists (
         select 1 from information_schema.columns c
         where c.table_schema = 'public' and c.table_name = t and c.column_name = 'updated_at')
       or not exists (
         select 1 from information_schema.columns c
         where c.table_schema = 'public' and c.table_name = t and c.column_name = 'id') then
      res := res || jsonb_build_object(k, jsonb_build_object('skip', true));
      continue;
    end if;

    begin
      if i is not null then
        -- Keyset: el id se compara en su tipo real (uuid en casi todas).
        select format_type(a.atttypid, a.atttypmod) into tipo_id
          from pg_attribute a
         where a.attrelid = to_regclass('public.' || t) and a.attname = 'id' and not a.attisdropped;
        execute format(
          'select coalesce(jsonb_agg(to_jsonb(s) order by s.updated_at, s.id), ''[]''::jsonb), count(*)::int
             from (select * from public.%I
                    where (updated_at, id) > (%L::timestamptz, %L::%s)
                    order by updated_at, id
                    limit %s) s',
          t, w, i, tipo_id, cap)
        into filas, n;
        res := res || jsonb_build_object(k, jsonb_build_object('rows', filas, 'mas', n >= cap));
      else
        execute format(
          'select coalesce(jsonb_agg(to_jsonb(s)), ''[]''::jsonb), count(*)::int
             from (select * from public.%I
                    where updated_at >= %L::timestamptz
                    order by id
                    limit %s) s',
          t, w, cap)
        into filas, n;

        if n >= cap then
          res := res || jsonb_build_object(k, jsonb_build_object('trunc', true));
        else
          res := res || jsonb_build_object(k, jsonb_build_object('rows', filas));
        end if;
      end if;
    exception when others then
      res := res || jsonb_build_object(k, jsonb_build_object('err', sqlerrm));
    end;
  end loop;

  return res;
end;
$function$;
REVOKE EXECUTE ON FUNCTION public.sync_pull(jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_pull(jsonb, integer) TO authenticated;


-- ── 13) jx_invariantes_tablas() ──────────────────────────────────────
-- Lo que la 150, la 155 y la 167 pidieron de «toda tabla nueva» y nadie
-- verificaba. Debe devolver 0 filas; correrla después de crear una tabla
-- (MCP de Supabase o SQL Editor): SELECT * FROM public.jx_invariantes_tablas();
CREATE OR REPLACE FUNCTION public.jx_invariantes_tablas()
RETURNS TABLE (tabla text, falta text)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  -- RLS apagada
  SELECT c.relname::text, 'RLS habilitada'
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
  UNION ALL
  -- cerco campo (companies y app_config se leen a propósito; evidencias y
  -- profiles tienen cerco fino con el mismo nombre)
  SELECT t.tablename::text, 'policy ' || x.pol
    FROM pg_tables t
   CROSS JOIN (VALUES ('campo_cerco_select'),('campo_cerco_insert'),
                      ('campo_cerco_update'),('campo_cerco_delete')) x(pol)
   WHERE t.schemaname = 'public'
     AND NOT (x.pol = 'campo_cerco_select' AND t.tablename IN ('companies','app_config'))
     AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public'
                       AND p.tablename = t.tablename AND p.policyname = x.pol)
  UNION ALL
  -- sello de updated_at en INSERT (150)
  SELECT c.table_name::text, 'trigger trg_updated_at_insert'
    FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
   WHERE c.table_schema = 'public' AND tb.table_type = 'BASE TABLE' AND c.column_name = 'updated_at'
     AND NOT EXISTS (SELECT 1 FROM pg_trigger tg
                      WHERE tg.tgrelid = format('public.%I', c.table_name)::regclass
                        AND tg.tgname = 'trg_updated_at_insert')
  UNION ALL
  -- sello de updated_at en UPDATE
  SELECT c.table_name::text, 'trigger BEFORE UPDATE que selle updated_at'
    FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
   WHERE c.table_schema = 'public' AND tb.table_type = 'BASE TABLE' AND c.column_name = 'updated_at'
     AND NOT EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
                      WHERE tg.tgrelid = format('public.%I', c.table_name)::regclass
                        AND NOT tg.tgisinternal AND (tg.tgtype & 2) = 2
                        AND (tg.tgtype & 16) = 16 AND p.proname ~ 'updated')
  UNION ALL
  -- anon no debe tener privilegios
  SELECT c.relname::text, 'sin privilegios para anon'
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m')
     AND (has_table_privilege('anon', c.oid, 'SELECT')
          OR has_table_privilege('anon', c.oid, 'INSERT')
          OR has_table_privilege('anon', c.oid, 'UPDATE')
          OR has_table_privilege('anon', c.oid, 'DELETE'))
  ORDER BY 1, 2;
$$;
REVOKE EXECUTE ON FUNCTION public.jx_invariantes_tablas() FROM PUBLIC, anon, authenticated;


NOTIFY pgrst, 'reload schema';
