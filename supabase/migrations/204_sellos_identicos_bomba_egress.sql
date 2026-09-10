-- 204 · La bomba de egress: los sellos idénticos que dejó un import masivo
--
-- SÍNTOMA (9-sep-2026, 17:00): Supabase cortó el proyecto entero con
--   "restricted due to the following violations: exceed_egress_quota".
--   Nadie podía entrar: /auth/v1/token respondía 402 antes de mirar la clave.
--
-- CAUSA: el pull incremental filtra .gte('updated_at', watermark) y avanza el
--   watermark a MAX(updated_at) de lo traído. El .gte (en vez de .gt) está
--   puesto a propósito, para no perder la fila que empata EXACTO con el
--   watermark, y el comentario del código dice "el re-pull del borde es barato".
--
--   Esa suposición se cae cuando la tabla entró de un import masivo: todas sus
--   filas comparten un único updated_at. Entonces "el borde" ES la tabla entera
--   y cada ciclo de sync la vuelve a bajar completa, aunque nada haya cambiado.
--
--   Medido en producción, por dispositivo y por ciclo (uno cada 30 s):
--     insumos_partida_versionadas   6.722 de 6.722 filas (100%)   5,14 MB
--     partidas_versionadas          1.158 de 1.158 filas (100%)   1,16 MB
--     insumos_partida               1.115 de 6.722 filas (16,6%)  0,69 MB
--     oc_items                         46 de    92 filas (50%)    0,08 MB
--                                                        TOTAL ≈ 7,07 MB
--   → 848 MB/hora por dispositivo. Con los 12 usuarios activos de hoy, los
--     5 GB/mes del plan Free se agotan en media hora de uso simultáneo.
--
-- ESTA MIGRACIÓN escalona los sellos HACIA ATRÁS desde el máximo, dejando UNA
-- sola fila en el máximo. Hacia atrás y no hacia adelante a propósito: así
-- ningún device se ve forzado a re-descargar nada. El que tiene el watermark
-- en el máximo pasa de bajar la tabla entera a bajar 1 fila.
--
-- Es seguro para todos los devices:
--   · watermark == máximo  → baja 1 fila; las demás ya las tiene (las venía
--     bajando cada 30 s desde junio).
--   · watermark más viejo  → las filas corridas siguen por encima de su
--     watermark, las sigue viendo.
--   · sin watermark        → full pull, ve todo.
--   No existe un watermark intermedio: antes TODAS las filas tenían el mismo
--   sello, así que el watermark solo podía ser ese valor o uno anterior.
--
-- Los triggers BEFORE UPDATE se desactivan durante el UPDATE porque
-- update_updated_at() hace `NEW.updated_at = now()` y `NEW.version = OLD.version + 1`.
-- Sin desactivarlos, esta migración pondría las 6.722 filas en el MISMO now()
-- (recreando la bomba) y además movería `version`, rompiendo el control de
-- concurrencia optimista.
--
-- El arreglo de raíz —para que el PRÓXIMO import masivo no reviva esto— va en
-- el código: cursor compuesto (updated_at, id) en SyncEngine.

begin;

-- ── insumos_partida_versionadas ────────────────────────────────────────────
alter table public.insumos_partida_versionadas disable trigger trg_insumos_ver_updated_at;

with orden as (
  select id, row_number() over (order by id) - 1 as n
  from public.insumos_partida_versionadas
  where updated_at = (select max(updated_at) from public.insumos_partida_versionadas)
)
update public.insumos_partida_versionadas t
   set updated_at = t.updated_at - (o.n * interval '1 millisecond')
  from orden o
 where t.id = o.id and o.n > 0;

alter table public.insumos_partida_versionadas enable trigger trg_insumos_ver_updated_at;

-- ── partidas_versionadas ───────────────────────────────────────────────────
alter table public.partidas_versionadas disable trigger trg_partidas_ver_updated_at;

with orden as (
  select id, row_number() over (order by id) - 1 as n
  from public.partidas_versionadas
  where updated_at = (select max(updated_at) from public.partidas_versionadas)
)
update public.partidas_versionadas t
   set updated_at = t.updated_at - (o.n * interval '1 millisecond')
  from orden o
 where t.id = o.id and o.n > 0;

alter table public.partidas_versionadas enable trigger trg_partidas_ver_updated_at;

-- ── insumos_partida ────────────────────────────────────────────────────────
-- (solo tiene trigger de INSERT; un UPDATE no le toca updated_at)
with orden as (
  select id, row_number() over (order by id) - 1 as n
  from public.insumos_partida
  where updated_at = (select max(updated_at) from public.insumos_partida)
)
update public.insumos_partida t
   set updated_at = t.updated_at - (o.n * interval '1 millisecond')
  from orden o
 where t.id = o.id and o.n > 0;

-- ── oc_items ───────────────────────────────────────────────────────────────
alter table public.oc_items disable trigger trg_oc_items_updated_at;

with orden as (
  select id, row_number() over (order by id) - 1 as n
  from public.oc_items
  where updated_at = (select max(updated_at) from public.oc_items)
)
update public.oc_items t
   set updated_at = t.updated_at - (o.n * interval '1 millisecond')
  from orden o
 where t.id = o.id and o.n > 0;

alter table public.oc_items enable trigger trg_oc_items_updated_at;

commit;
