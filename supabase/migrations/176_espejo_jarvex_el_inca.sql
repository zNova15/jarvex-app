-- ═══════════════════════════════════════════════════════════════════
-- 176 — EL ESPEJO DE LAS 2 OPERACIONES INTERNAS QUE FALTABAN
--
-- Pendiente abierto desde la tanda 3: "cargar el espejo de 4 operaciones
-- internas". Medido el 3-sep-2026 sobre producción, quedan DOS —no cuatro—:
-- las otras dos eran notas de crédito a ESPERANZA y SAMADAY, y desde que
-- Gabriel decidió tratarlas como TERCEROS (commit 9cd53aa) ya no son
-- operaciones internas: no llevan espejo.
--
-- Las dos que quedan:
--   · JARVEX → CONSORCIO EL INCA · Factura E001-1 · S/ 12.920,00 · 06-jul-2026
--   · JARVEX → CONSORCIO EL INCA · Factura E001-2 · S/ 19.028,68 · 06-jul-2026
-- JARVEX tiene la VENTA cargada; EL INCA no tiene la COMPRA. Las hermanas
-- E001-3 y E001-4, de la misma serie y del día siguiente, sí tienen su par
-- (backfill del 07-ago-2026): estas dos quedaron afuera.
--
-- QUÉ CAMBIA Y QUÉ NO:
--   · El número CONSOLIDADO del grupo NO se mueve. Una interna huérfana ya
--     salía del ingreso externo: lo que no existe no hay que eliminarlo. Lo
--     que estaba incompleto era el libro del comprador.
--   · Lo que SÍ cambia: CONSORCIO EL INCA suma S/ 31.948,68 de costo (y la
--     obra de Baños del Inca, ese costo imputado), y las dos facturas dejan
--     de figurar en el recuadro "operaciones internas sin espejo" del
--     Consolidado. Es plata que EL INCA debe y no estaba en sus libros.
--
-- CÓMO SE ESCRIBIÓ: calcado del backfill que ya existe en la base
-- (idempotency_key 'backfill_icesp_<id de la venta>', vínculo mutuo por
-- related_movement_id, notas con 'intercompany_mirror_of'). Sin
-- items_factura, igual que los espejos anteriores: el desglose se hereda por
-- 'desglose_heredado_de' y así el inventario del comprador no cuenta dos
-- veces los mismos ítems.
--
-- Único apartamiento del backfill viejo, a propósito: el payment_status se
-- COPIA de la venta ('pending') en vez de fijarlo en 'paid'. JARVEX no cobró
-- estas facturas; poner el espejo en "pagado" diría que EL INCA ya pagó.
--
-- ⚠ SE EJECUTA A MANO EN EL SQL EDITOR. El clasificador del MCP de Supabase
-- bloquea las escrituras financieras (regla de CLAUDE.md: entregar el SQL, no
-- rodear el bloqueo).
--
-- IDEMPOTENTE: si el espejo ya existe (por documento + importe, o por la
-- idempotency_key), no inserta nada. Se puede correr dos veces sin miedo.
-- ═══════════════════════════════════════════════════════════════════

begin;

with venta as (
  select *
  from accounting_movements
  where id in (
    '1bec6720-6cb9-496f-80fc-fc3676fa7bd4',   -- E001-1 · S/ 12.920,00
    '8cb4ec13-a59c-4408-aaee-94a5a1476188'    -- E001-2 · S/ 19.028,68
  )
    and deleted_at is null
),
nuevos as (
  insert into accounting_movements (
    id, company_id, date, type, clase, category, description, amount, currency,
    third_party_name, third_party_ruc, payment_status, document_type, document_number,
    is_intercompany, related_company_id, related_movement_id, obra_id, destino_contable,
    notas, version, created_by, idempotency_key
  )
  select
    gen_random_uuid(),
    '033b5d1b-ecea-4088-ad00-96b0bf7177f8',        -- CONSORCIO EL INCA (el comprador)
    v.date, 'cost', 'compra', 'Factura',
    'Factura ' || v.document_number
      || ' · JARVEX INGENIERIA, TECNOLOGIA Y PROYECTOS E.I.R.L. (espejo de operación interna)',
    v.amount, v.currency,
    'JARVEX INGENIERIA, TECNOLOGIA Y PROYECTOS E.I.R.L.', '20615646505',
    v.payment_status,                               -- se copia: la venta está 'pending'
    v.document_type, v.document_number,
    true,
    '2be31c12-0dbc-48d6-8900-4882e904bd1b',        -- JARVEX (el vendedor)
    v.id,                                           -- el comprador apunta a la venta
    v.obra_id, 'obra',
    jsonb_build_object(
      'subtotal',               (v.notas::jsonb ->> 'subtotal')::numeric,
      'igv',                    (v.notas::jsonb ->> 'igv')::numeric,
      'backfill',               true,
      'backfill_fecha',         '2026-09-03',
      'intercompany_auto',      true,
      'desglose_heredado_de',   v.id,
      'intercompany_mirror_of', v.id
    )::text,
    1, v.created_by,
    'backfill_icesp_' || v.id
  from venta v
  where not exists (
    select 1 from accounting_movements x
    where x.deleted_at is null
      and x.company_id = '033b5d1b-ecea-4088-ad00-96b0bf7177f8'
      and x.document_number = v.document_number
      and abs(coalesce(x.amount, 0) - coalesce(v.amount, 0)) < 0.01
  )
  and not exists (
    select 1 from accounting_movements y
    where y.idempotency_key = 'backfill_icesp_' || v.id
  )
  returning id, related_movement_id
)
-- El vínculo queda MUTUO, como en los pares E001-3 / E001-4 que ya están en
-- la base. El SyncEngine tiene rompe-ciclos para eso (un par mutuo sin subir
-- se traba en el gate de FK del push), así que no hace falta dejarlo de un
-- solo lado.
update accounting_movements v
   set related_movement_id = n.id,
       version             = coalesce(v.version, 1) + 1,
       updated_at          = now()
  from nuevos n
 where v.id = n.related_movement_id
   and v.related_movement_id is null;

commit;

-- ── VERIFICACIÓN (correr después; tiene que devolver 2 filas emparejadas) ──
--
-- select c.name as empresa, m.type, m.document_number, m.amount,
--        m.related_movement_id is not null as vinculado
--   from accounting_movements m
--   join companies c on c.id = m.company_id
--  where m.deleted_at is null
--    and m.document_number in ('E001-1', 'E001-2')
--    and m.company_id in ('2be31c12-0dbc-48d6-8900-4882e904bd1b',
--                         '033b5d1b-ecea-4088-ad00-96b0bf7177f8')
--  order by m.document_number, m.type;
--
-- Y en la app: Contabilidad → Consolidado. El recuadro "operaciones internas
-- sin espejo" tiene que quedar VACÍO, y la utilidad consolidada tiene que
-- seguir en −1.354.976,76 (si se movió, algo más cambió: avisá).
