-- 150: (a) Sellar updated_at EN EL SERVER también en INSERT. El trigger
-- update_updated_at existía solo BEFORE UPDATE → un INSERT conservaba el
-- updated_at del CLIENTE, que puede ser HORAS anterior al commit (creado
-- offline, pusheado al recuperar señal). Como el pull incremental filtra por
-- updated_at > watermark, esas filas "con fecha en el pasado" quedaban por
-- detrás del watermark de cualquier device que sincronizó en el intermedio y
-- NUNCA bajaban por pull (síntoma recurrente: "no veo los movimientos/facturas
-- de ayer"). Con el sello en INSERT, el orden de updated_at sigue el orden de
-- commit y el watermark no puede saltarse filas.
-- OJO: función NUEVA solo-INSERT — update_updated_at() referencia OLD.version
-- y en un INSERT reventaría todos los inserts.
--
-- (b) RPC recalcular_stock_obra: recalcula materiales.stock_actual desde los
-- movimientos EN EL SERVER (misma regla que el cliente: entrada/devolución/
-- reposición/ajuste suman; salida/merma/baja restan; excluye borrados y
-- reversas). El botón "Recalcular stocks" del cliente escribía solo en local y
-- el siguiente pull lo revertía (stock_actual está excluido del push por ser
-- campo manejado por triggers).

create or replace function public.set_updated_at_on_insert()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t record;
begin
  for t in
    select c.table_name
    from information_schema.tables tb
    join information_schema.columns c
      on c.table_schema = tb.table_schema and c.table_name = tb.table_name
    where tb.table_schema = 'public' and tb.table_type = 'BASE TABLE'
      and c.column_name = 'updated_at'
  loop
    execute format('drop trigger if exists trg_updated_at_insert on public.%I', t.table_name);
    execute format(
      'create trigger trg_updated_at_insert before insert on public.%I
         for each row execute function public.set_updated_at_on_insert()',
      t.table_name);
  end loop;
end $$;

-- (b) Recalcular stock de una obra desde los movimientos (server-side).
-- SECURITY DEFINER: la almacenera puede corregir el stock aunque su RLS no le
-- permita UPDATE directo de materiales; la función solo deriva de movimientos.
create or replace function public.recalcular_stock_obra(p_obra_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer := 0;
begin
  with sums as (
    select m.material_id,
           sum(case
             when m.tipo_movimiento in ('entrada','ingreso','devolucion','reposicion','ajuste') then coalesce(m.cantidad, 0)
             when m.tipo_movimiento in ('salida','merma','baja') then -coalesce(m.cantidad, 0)
             else 0 end) as bal
    from movimientos_materiales m
    where m.obra_id = p_obra_id
      and m.deleted_at is null
      and m.reverses_id is null
      and m.reversed_by_id is null
    group by m.material_id
  ),
  upd as (
    update materiales mat
    set stock_actual = greatest(0, coalesce(s.bal, 0)),
        alerta = case
          when greatest(0, coalesce(s.bal, 0)) <= 0 then 'agotado'
          when coalesce(mat.stock_minimo, 0) > 0 and greatest(0, coalesce(s.bal, 0)) <= mat.stock_minimo * 0.5 then 'critico'
          when coalesce(mat.stock_minimo, 0) > 0 and greatest(0, coalesce(s.bal, 0)) <= mat.stock_minimo then 'reponer'
          when coalesce(mat.stock_minimo, 0) > 0 and greatest(0, coalesce(s.bal, 0)) <= mat.stock_minimo * 1.2 then 'cerca'
          else 'ok' end,
        updated_at = now()
    from sums s
    where mat.id = s.material_id
      and mat.obra_id = p_obra_id
      and mat.deleted_at is null
      and mat.stock_actual is distinct from greatest(0, coalesce(s.bal, 0))
    returning mat.id
  )
  select count(*) into n from upd;
  return n;
end $$;

revoke all on function public.recalcular_stock_obra(uuid) from public;
grant execute on function public.recalcular_stock_obra(uuid) to authenticated;

notify pgrst, 'reload schema';
