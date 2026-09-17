-- ═══════════════════════════════════════════════════════════════════
-- 220 — La contadora puede corregir la cuenta del asiento (17-set-2026)
--
-- POR QUÉ. Pedido de las contadoras: «actualmente no es editable, y eso está
-- mal. Las contadoras tienen el criterio del estado peruano mucho más claro,
-- está súper bien tener las recomendaciones de la IA pero en caso se crea que
-- se debe cambiar el código se debería poder».
--
-- El Libro Diario NO se persiste: es una vista derivada de los movimientos. Por
-- eso «editar el asiento» no puede ser guardar el asiento — sería congelar una
-- foto que después no se actualiza cuando cambia el movimiento. Lo que se
-- guarda es la DECISIÓN sobre la cuenta, en el movimiento, y el asiento se
-- sigue derivando de ahí.
--
-- QUÉ SE PUEDE CORREGIR:
--   · `cuenta_pcge` (ya existía) — la cuenta de gasto o de ingreso. Le gana al
--     reparto automático que salió de los ítems del comprobante.
--   · `cuenta_pcge_contrapartida` (nueva) — la otra pata: caja (101) vs bancos
--     (104) vs cuenta por pagar (42) vs remuneraciones (41). Se equivoca
--     seguido porque sale de `metodo_pago`, que muchas veces viene vacío.
--
-- QUÉ NO: la línea del IGV (4011). Esa sale del desglose real del comprobante
-- desde el 31-ago y no se toca a mano — si el IGV está mal, lo que está mal es
-- el comprobante, y se corrige ahí.
--
-- CON QUIÉN Y CUÁNDO. Una cuenta puesta a mano le gana a todo lo que la app
-- deduzca, para siempre. Eso merece firma: sin saber quién la puso, dentro de
-- seis meses nadie se anima ni a confirmarla ni a cambiarla.
--
-- NO HAY BACKFILL, y es a propósito: el asiento es derivado, así que el
-- arreglo del clasificador (tanda 2) ya corrigió las 1.742 filas históricas sin
-- escribir un solo dato. Estas columnas nacen vacías y solo se llenan cuando
-- una persona decide algo distinto.
-- ═══════════════════════════════════════════════════════════════════

alter table public.accounting_movements
  add column if not exists cuenta_pcge_contrapartida text,
  add column if not exists cuenta_pcge_por          uuid references public.profiles(id),
  add column if not exists cuenta_pcge_at           timestamptz;

comment on column public.accounting_movements.cuenta_pcge is
  'Cuenta PCGE del gasto o del ingreso, elegida a mano. Le gana al reparto que '
  'la app deduce de los ítems del comprobante. NULL = que decida la app.';

comment on column public.accounting_movements.cuenta_pcge_contrapartida is
  'Cuenta PCGE de la contrapartida del asiento, elegida a mano: caja (101), '
  'bancos (104), cuentas por pagar (42), remuneraciones (41) o cuentas por '
  'cobrar (121) en las ventas. NULL = que la derive del método de pago.';

comment on column public.accounting_movements.cuenta_pcge_por is
  'Quién eligió la cuenta a mano. Una cuenta manual le gana a la app para '
  'siempre: sin firma, después nadie se anima ni a confirmarla ni a cambiarla.';

comment on column public.accounting_movements.cuenta_pcge_at is
  'Cuándo se eligió la cuenta a mano.';

-- Los códigos válidos son los del PCGE, que vive en el bundle (1.792 cuentas
-- generadas del PDF del MEF) y no en la base: replicarlos acá como CHECK sería
-- mantener la misma tabla en dos lugares, y el día que el MEF publique otra
-- versión habría que acordarse de los dos. Lo que sí se valida es la FORMA —
-- de dos a cinco dígitos— para que un dedazo no entre como cuenta.
alter table public.accounting_movements
  drop constraint if exists accounting_movements_cuenta_pcge_forma;

alter table public.accounting_movements
  add constraint accounting_movements_cuenta_pcge_forma check (
    (cuenta_pcge is null or cuenta_pcge ~ '^[0-9]{2,5}$')
    and (cuenta_pcge_contrapartida is null or cuenta_pcge_contrapartida ~ '^[0-9]{2,5}$')
  );

-- Para la pantalla «las que faltan definir»: se piden las de una empresa que
-- NO tienen cuenta puesta a mano. El índice parcial es chico porque solo
-- indexa las que sí la tienen (hoy: 1 de 1.742).
create index if not exists idx_accounting_movements_cuenta_manual
  on public.accounting_movements (company_id)
  where cuenta_pcge is not null and deleted_at is null;
