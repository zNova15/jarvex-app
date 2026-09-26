-- ═══════════════════════════════════════════════════════════════════════
-- 235 · Tanda E (sync y sesión) — 26-set-2026
--
-- Dos cosas que el servidor tiene que decir y no decía:
--
-- 1) «ESTE USUARIO ESTÁ DESACTIVADO». Hasta hoy `profiles.activo = false`
--    solo lo miraban api/r2 y api/create-user: el usuario dado de baja desde
--    Administración seguía leyendo y escribiendo por PostgREST y por el sync
--    mientras su JWT viviera (Auth se lo sigue refrescando). Gabriel
--    (respuesta 10 de la revisión, 25-set): «al desactivar un usuario tiene
--    que quedar fuera al instante».
--    → jx_usuario_activo() + policy RESTRICTIVE `activo_cerco` FOR ALL en
--      TODA tabla de public. Un JWT sin fila en profiles tampoco pasa.
--      Va envuelta en (SELECT …): Postgres la evalúa UNA vez por consulta
--      (InitPlan), no por fila — es una lectura por PK de profiles.
--    → profiles es la excepción a medias: la fila PROPIA se sigue leyendo,
--      porque es justo lo que el cliente necesita para enterarse de que lo
--      desactivaron (si no, getCurrentUser cae al perfil cacheado y el
--      usuario queda "offline" adentro, con los datos a la vista).
--
-- 2) «ESTE ES TU ALCANCE». El watermark del pull es por tabla, no por obra
--    ni por rol: un ingeniero al que se le designa otra obra nunca bajaba el
--    histórico de esa obra (su cursor ya estaba por delante). sync_pull ahora
--    devuelve, junto con los datos, `__yo = {rol, global, obras}` — lo mismo
--    que usa la RLS para decidir qué ve. El cliente guarda su huella y, si
--    cambia, re-baja todo (respuesta 11: «re-pull automático al cambiar la
--    designación de obra»). Para los roles globales `obras` va en null: su
--    visibilidad no depende de mis_obras() y, si no, cada obra nueva que
--    crea el admin le dispararía una re-descarga completa.
--    Y si el usuario está desactivado, sync_pull no devuelve datos sino
--    {"__err":"usuario_inactivo"}: el cliente cierra la sesión en el acto.
--
-- 3) jx_invariantes_tablas() también exige `activo_cerco`: una tabla nueva
--    que la olvide aparece en el chequeo de siempre.
--
-- Lo que NO está acá: Storage de Supabase (las evidencias nuevas van a R2 y
-- api/r2 ya valida `activo`) ni revocar la sesión en Auth (con la RLS
-- cerrada, un token vivo no ve ni escribe nada).
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1) ¿El que llama está activo? ────────────────────────────────────
-- activo NULL cuenta como activo (la columna tiene default true y es
-- nullable); sin fila en profiles → false.
CREATE OR REPLACE FUNCTION public.jx_usuario_activo()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT COALESCE(p.activo, true) FROM public.profiles p WHERE p.id = auth.uid()),
    false)
$$;
REVOKE EXECUTE ON FUNCTION public.jx_usuario_activo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jx_usuario_activo() TO authenticated;


-- ── 2) El cerco, en toda tabla de public ─────────────────────────────
DO $$
DECLARE t record; n int := 0;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY IF EXISTS activo_cerco ON public.%I', t.tablename);
    IF t.tablename = 'profiles' THEN
      EXECUTE $p$
        CREATE POLICY activo_cerco ON public.profiles
          AS RESTRICTIVE FOR ALL TO authenticated
          USING ((SELECT public.jx_usuario_activo()) OR id = auth.uid())
          WITH CHECK ((SELECT public.jx_usuario_activo()))
      $p$;
    ELSE
      EXECUTE format(
        'CREATE POLICY activo_cerco ON public.%I
           AS RESTRICTIVE FOR ALL TO authenticated
           USING ((SELECT public.jx_usuario_activo()))
           WITH CHECK ((SELECT public.jx_usuario_activo()))',
        t.tablename);
    END IF;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'activo_cerco creada en % tablas', n;
END $$;


-- ── 3) sync_pull: usuario inactivo y `__yo` ──────────────────────────
-- Igual a la de la mig 231 (modo keyset por `i` y modo `>=` de siempre),
-- con dos agregados al principio. SECURITY INVOKER a propósito: cada
-- consulta dinámica corre con la RLS del que llama.
CREATE OR REPLACE FUNCTION public.sync_pull(p_entries jsonb, p_limit integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  ent jsonb;
  res jsonb;
  k text; t text; w text; i text; tipo_id text;
  filas jsonb; n int; cap int;
  es_global boolean;
begin
  if not public.jx_usuario_activo() then
    return jsonb_build_object('__err', 'usuario_inactivo');
  end if;

  cap := least(greatest(coalesce(p_limit, 500), 1), 1000);

  if p_entries is null or jsonb_typeof(p_entries) <> 'array'
     or jsonb_array_length(p_entries) > 250 then
    return jsonb_build_object('__err', 'entradas_invalidas');
  end if;

  es_global := coalesce(public.es_rol_global(), false);
  res := jsonb_build_object('__yo', jsonb_build_object(
    'rol', public.current_user_rol(),
    'global', es_global,
    'obras', case when es_global then null
                  else (select coalesce(jsonb_agg(o order by o), '[]'::jsonb)
                          from public.mis_obras() o) end));

  for ent in select * from jsonb_array_elements(p_entries) loop
    k := ent->>'k';  t := ent->>'t';  w := ent->>'w';  i := ent->>'i';
    if k is null or t is null or w is null or k = '__yo' then
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
        -- Keyset: el id se compara en su tipo real (uuid en todas hoy).
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


-- ── 4) El chequeo de toda tabla nueva también pide activo_cerco ──────
CREATE OR REPLACE FUNCTION public.jx_invariantes_tablas()
 RETURNS TABLE(tabla text, falta text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT c.relname::text, 'RLS habilitada'
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
  UNION ALL
  SELECT t.tablename::text, 'policy ' || x.pol
    FROM pg_tables t
   CROSS JOIN (VALUES ('campo_cerco_select'),('campo_cerco_insert'),
                      ('campo_cerco_update'),('campo_cerco_delete'),
                      ('activo_cerco')) x(pol)
   WHERE t.schemaname = 'public'
     AND NOT (x.pol = 'campo_cerco_select' AND t.tablename IN ('companies','app_config'))
     AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public'
                       AND p.tablename = t.tablename AND p.policyname = x.pol)
  UNION ALL
  SELECT c.table_name::text, 'trigger trg_updated_at_insert'
    FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
   WHERE c.table_schema = 'public' AND tb.table_type = 'BASE TABLE' AND c.column_name = 'updated_at'
     AND NOT EXISTS (SELECT 1 FROM pg_trigger tg
                      WHERE tg.tgrelid = format('public.%I', c.table_name)::regclass
                        AND tg.tgname = 'trg_updated_at_insert')
  UNION ALL
  SELECT c.table_name::text, 'trigger BEFORE UPDATE que selle updated_at'
    FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
   WHERE c.table_schema = 'public' AND tb.table_type = 'BASE TABLE' AND c.column_name = 'updated_at'
     AND NOT EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
                      WHERE tg.tgrelid = format('public.%I', c.table_name)::regclass
                        AND NOT tg.tgisinternal AND (tg.tgtype & 2) = 2
                        AND (tg.tgtype & 16) = 16 AND p.proname ~ 'updated')
  UNION ALL
  SELECT c.relname::text, 'sin privilegios para anon'
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m')
     AND (has_table_privilege('anon', c.oid, 'SELECT')
          OR has_table_privilege('anon', c.oid, 'INSERT')
          OR has_table_privilege('anon', c.oid, 'UPDATE')
          OR has_table_privilege('anon', c.oid, 'DELETE'))
  ORDER BY 1, 2;
$function$;
REVOKE EXECUTE ON FUNCTION public.jx_invariantes_tablas() FROM PUBLIC, anon, authenticated;
