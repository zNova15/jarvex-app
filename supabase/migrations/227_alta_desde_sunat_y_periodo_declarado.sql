-- ═══════════════════════════════════════════════════════════════════
-- 227 — DAR DE ALTA LO QUE SUNAT TIENE Y JARVEX NO, Y DECLARARLO EN SU MES
--
-- Pedido de Gabriel (23-set-2026), con dos casos reales detrás:
--
-- 1) LAS FACTURAS QUE NO SE PUEDEN BAJAR DEL PORTAL. En enero-2026 de GASOMI
--    faltan dos comprobantes del BANCO DE CREDITO DEL PERU (FI01-17943297 de
--    S/ 40,50 y FN01-41488655 de S/ 10,00). No es descuido: el portal de SUNAT
--    no deja descargarlos —pasa seguido con los emitidos por bancos— y sin
--    ellos el total de NO GRAVADAS del Registro de Compras no cuadra. La
--    asistente de contabilidad lo detecto cuadrando el mes.
--
--    El dato ESTA: viene en el CSV del RCE que ya se carga en «SUNAT vs
--    JARVEX», con su desglose (base, IGV, no gravado, total, moneda, tipo de
--    cambio). Lo que faltaba era poder darlo de alta desde ahi y marcarlo como
--    «registrado, pero sin su comprobante» para ir a buscar el papel despues.
--    Por eso `falta_comprobante`: un movimiento que existe para que el mes
--    cuadre, que NO es lo mismo que uno al que simplemente nadie le subio el
--    PDF todavia. Sin la marca, la unica forma de distinguirlos seria la
--    memoria de quien lo cargo.
--
-- 2) EL COMPROBANTE QUE SE DECLARA EN OTRO MES. Una factura emitida en febrero
--    se puede declarar en junio (el credito fiscal se puede usar dentro de los
--    12 meses siguientes, art. 2 de la Ley 29215). Hoy el Registro de Compras
--    y Ventas filtra por `date` a secas, asi que esa factura sale si o si en
--    febrero y no hay manera de moverla. `periodo_declarado` es el mes en el
--    que el comprobante se DECLARA; la fecha de emision no se toca, porque es
--    un dato del papel. Cuando esta vacio, se declara en su mes de emision,
--    que es el caso normal.
--
-- Las dos columnas son NULL/false por defecto: ninguna fila existente cambia
-- de comportamiento por esta migracion.
-- ═══════════════════════════════════════════════════════════════════

alter table public.accounting_movements
  add column if not exists periodo_declarado text,
  add column if not exists falta_comprobante boolean not null default false,
  add column if not exists falta_comprobante_motivo text;

-- 'YYYYMM' o nada. Un periodo mal escrito no se nota mirando la pantalla —
-- el comprobante simplemente desaparece de los dos meses— asi que se ataja
-- en la base, que es donde no hay forma de esquivarlo.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'accounting_movements_periodo_declarado_fmt'
  ) then
    alter table public.accounting_movements
      add constraint accounting_movements_periodo_declarado_fmt
      check (periodo_declarado is null or periodo_declarado ~ '^[0-9]{4}(0[1-9]|1[0-2])$');
  end if;
end $$;

-- El Registro de Compras y Ventas pregunta «que comprobantes se declaran en
-- este mes» y hasta ahora eso se resolvia recorriendo todo. El indice es
-- parcial: solo las filas que efectivamente tienen un periodo distinto del de
-- su emision, que son una minoria y van a seguir siendolo.
create index if not exists accounting_movements_periodo_declarado_idx
  on public.accounting_movements (company_id, periodo_declarado)
  where periodo_declarado is not null and deleted_at is null;

comment on column public.accounting_movements.periodo_declarado is
  'Mes YYYYMM en el que el comprobante se DECLARA, cuando no es el de su fecha de emision (credito fiscal diferido, Ley 29215 art. 2). NULL = se declara en su mes de emision.';
comment on column public.accounting_movements.falta_comprobante is
  'Se dio de alta desde el corte de SUNAT para que el mes cuadre, pero el comprobante fisico todavia no esta. No es lo mismo que "nadie subio el PDF": es un registro hecho a partir del dato de SUNAT.';
comment on column public.accounting_movements.falta_comprobante_motivo is
  'Por que no se pudo conseguir el comprobante (ej. "el portal de SUNAT no deja descargar los emitidos por bancos").';
