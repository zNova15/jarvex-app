-- 209 · Notas de crédito huérfanas: vincularlas a la factura que llegó después
--
-- Gabriel, 13-set-2026: «notas de crédito no se vinculan aún. Puede que
-- ocurra el caso donde una factura se inserte en el programa después que la
-- nota de crédito y entonces no se vinculan».
--
-- CONFIRMADO CONTRA LA BASE: la nota E001-13 de MILIAN SANCHEZ BENJAMIN
-- (GASOMI) se cargó el 21-ago a las 17:00 y la factura E001-61 que anula
-- (mismo importe, S/1.800,00) recién se cargó el 22-ago a las 00:19 — SIETE
-- HORAS después. Captura Mágica solo mira los movimientos YA cargados al
-- resolver `related_movement_id`, así que en ese momento no había con qué
-- cerrar el vínculo, y nada volvía a intentarlo cuando la factura por fin
-- llegó. La app YA NO tiene este agujero (commit de la misma fecha: al
-- confirmar una factura nueva se revisa si alguna nota la estaba esperando,
-- `notaEsperandoEstaFactura` en src/lib/notas-credito.js) — esta migración es
-- el backfill de lo que quedó huérfano ANTES de ese fix.
--
-- CRITERIO — el mismo que usa la app en código, sin ambigüedad:
--   · la nota no tiene `related_movement_id` vivo apuntando a una FACTURA
--     (vacío, o apuntando a algo borrado, o a OTRA nota — el espejo
--     intercompany usa el mismo campo para otra cosa, ver notas-credito.js),
--   · misma empresa y mismo RUC de contraparte,
--   · la factura es ANTERIOR o del mismo día que la nota,
--   · el importe es EXACTO (±S/0,05) — una rebaja parcial NO se auto-vincula,
--   · y esa factura es la ÚNICA candidata exacta de esa nota. Con más de un
--     candidato exacto (dos facturas del mismo importe al mismo proveedor) NO
--     se toca: el Escáner de Incoherencias la sigue proponiendo para que se
--     elija mirando el PDF.
--
-- MEDIDO antes de aplicar (13-set-2026): 12 pares, uno por empresa/proveedor,
-- de S/47,10 (BOTICAS IP) a S/508.745,84 (MUNICIPALIDAD DISTRITAL DE NVO
-- CHIMBOTE). Ninguno tiene más de un candidato exacto — verificado con la
-- misma consulta que hace este UPDATE, antes en modo SELECT.
--
-- Los triggers BEFORE UPDATE quedan CORRIENDO a propósito (son 12 filas, no
-- mueve el egress) — son los que bumpean updated_at/version para que el pull
-- de cada dispositivo se entere del vínculo nuevo.

with huerfanas as (
  select n.id as nota_id, n.company_id,
         regexp_replace(n.third_party_ruc, '\D', '', 'g') as ruc,
         abs(n.amount) as monto, n.date as fecha
  from accounting_movements n
  where n.deleted_at is null
    and n.document_type = 'nota_credito'
    and (n.related_movement_id is null or not exists (
      select 1 from accounting_movements d
      where d.id = n.related_movement_id and d.deleted_at is null
        and d.document_type not in ('nota_credito', 'nota_debito')
    ))
),
exactas as (
  select h.nota_id, f.id as factura_id,
         count(*) over (partition by h.nota_id) as n_candidatas
  from huerfanas h
  join accounting_movements f
    on f.company_id = h.company_id
   and f.deleted_at is null
   and f.document_type not in ('nota_credito', 'nota_debito')
   and coalesce(f.payment_status, '') <> 'cancelled'
   and regexp_replace(f.third_party_ruc, '\D', '', 'g') = h.ruc
   and (h.fecha is null or f.date is null or f.date <= h.fecha)
   and abs(abs(f.amount) - h.monto) <= 0.05
),
a_vincular as (
  select nota_id, factura_id from exactas where n_candidatas = 1
)
update accounting_movements m
   set related_movement_id = a_vincular.factura_id
  from a_vincular
 where m.id = a_vincular.nota_id;
