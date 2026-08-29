-- 152 — FASE 2 del plan de consumo: pull incremental CONSOLIDADO.
--
-- Hoy cada ciclo de sync hace ~90-190 requests REST (uno por tabla, casi todos
-- devuelven 0 filas). Esta función responde TODOS los incrementales en UN solo
-- request: recibe [{k,t,w}] (clave opaca del cliente, tabla, watermark) y
-- devuelve {k: {rows:[...]}} con las filas cuyo updated_at >= w.
--
-- SEGURIDAD
-- · SECURITY INVOKER: corre con el rol del llamador → la RLS de CADA tabla
--   aplica exactamente igual que vía PostgREST. La función no otorga ningún
--   acceso que el REST no diera ya.
-- · Solo `authenticated` puede ejecutarla (una pestaña deslogueada no pulea —
--   coherente con el guard de sesión de syncAll, fase 1).
-- · Nombre de tabla validado por regex + to_regclass en schema public.
--
-- SEMÁNTICA (paridad con el pull incremental del cliente)
-- · updated_at >= w (gte, igual que el cliente: el re-pull del borde es barato
--   e idempotente) e INCLUYE tombstones (deleted_at no se filtra: el cliente
--   separa vivos de borrados).
-- · order by id + limit: si una tabla devuelve >= p_limit filas se responde
--   {trunc:true} SIN filas — el cliente cae al pull paginado por keyset de
--   siempre para esa tabla (fetchAllRows), que es quien sabe paginar bien.
--   NUNCA devolvemos una página parcial: ordenada por id no se puede avanzar
--   el watermark con seguridad.
-- · Tabla sin columna updated_at o id → {skip:true} → pull legacy.
-- · Error en una tabla → {err:...} para ESA clave; el resto sigue (mismo
--   aislamiento por-tabla que los loops del cliente).

create or replace function public.sync_pull(p_entries jsonb, p_limit int default 500)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  ent jsonb;
  res jsonb := '{}'::jsonb;
  k text; t text; w text;
  filas jsonb; n int; cap int;
begin
  cap := least(greatest(coalesce(p_limit, 500), 1), 1000);

  if p_entries is null or jsonb_typeof(p_entries) <> 'array'
     or jsonb_array_length(p_entries) > 250 then
    return jsonb_build_object('__err', 'entradas_invalidas');
  end if;

  for ent in select * from jsonb_array_elements(p_entries) loop
    k := ent->>'k';  t := ent->>'t';  w := ent->>'w';
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
    exception when others then
      res := res || jsonb_build_object(k, jsonb_build_object('err', sqlerrm));
    end;
  end loop;

  return res;
end;
$$;

revoke all on function public.sync_pull(jsonb, int) from public;
revoke all on function public.sync_pull(jsonb, int) from anon;
grant execute on function public.sync_pull(jsonb, int) to authenticated;
