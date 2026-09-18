-- ═══════════════════════════════════════════════════════════════════
-- 223 — La cuenta de DESTINO del asiento (18-set-2026)
--
-- POR QUÉ. Pedido de las contadoras, vía Gabriel: «ya se tiene el libro diario
-- y cada factura se desglosa en las cuentas a las que pertenece. Eso está
-- bien, se puede corregir incluso. Ahora, luego cada asiento se traslada a su
-- asiento de destino». Hasta hoy JARVEX escribía solo la mitad por naturaleza
-- (QUÉ se compró) y no tenía dónde escribir la mitad por función (PARA QUÉ
-- fue).
--
-- El caso que lo explica es el del combustible que ellas mismas dieron: dos
-- facturas de «PETRÓLEO DIESEL B5», mismo proveedor, mismo importe; una para
-- el generador de la obra y otra para la camioneta de reparto. La cuenta por
-- naturaleza es la MISMA en las dos (6032). Lo único que las separa es el
-- destino: 92 contra 95. Sin esta columna las dos son la misma fila, y el
-- costo de la obra y el gasto de ventas quedan revueltos para siempre.
--
-- QUÉ SE GUARDA. Igual que en la mig 220: NO el asiento —que se sigue
-- derivando del movimiento cada vez— sino la DECISIÓN. Una sola cuenta:
--
--   · `cuenta_pcge_destino` — el destino elegido. La otra pata del asiento de
--     destino NO se guarda porque no es una decisión: sale sola de esta. Si el
--     destino es una existencia (20/24/25/26), la contrapartida es la subcuenta
--     espejo de la 61 (611/612/613/614) — es el «20111 / 6111» del ejemplo que
--     mandaron las contadoras. Si es del elemento 9, es la 791, salvo que lo
--     trasladado salga de la 68, que el PCGE manda por la 78. Todo eso vive en
--     `src/lib/destino-asiento.js`, con sus tests, y en un solo lugar.
--
-- POR QUÉ NO HAY TABLA PARA EL ELEMENTO 9. Porque el PCGE 2019 (p. 206) no lo
-- define: «Se deja a criterio de las entidades el uso de las cuentas de este
-- elemento». Son SIETE filas acordadas una vez con las contadoras —94, 95 y 97
-- en uso; 90, 91, 92 y 93 disponibles— y no cambian de un mes a otro.
-- Sincronizar siete filas para siempre sería tráfico permanente para guardar
-- algo fijo: la lección del corte por egress del 9-set. Viajan en el bundle
-- (`src/lib/pcge-elemento9.js`). Lo que SÍ irá a la base el día que haga falta
-- es el desglose por obra (92 + obra + frente), que sí es propio y sí cambia.
--
-- NO HAY BACKFILL, a propósito. El asiento es derivado: el destino sugerido
-- sale de `destino_contable`, que ya está lleno en 1.104 de los 1.789
-- movimientos vivos (708 gastos generales → 94, 396 obra → 92). Esos 1.104 van
-- a mostrar su destino sin que nadie escriba un dato. Esta columna nace vacía y
-- solo se llena cuando una persona decide algo distinto de lo sugerido.
-- ═══════════════════════════════════════════════════════════════════

alter table public.accounting_movements
  add column if not exists cuenta_pcge_destino text;

comment on column public.accounting_movements.cuenta_pcge_destino is
  'Cuenta de DESTINO del asiento, elegida a mano: el elemento 9 (costos y '
  'gastos por función: 90-97) o una existencia del elemento 2 (20/24/25/26) '
  'cuando lo comprado queda en inventario. NULL = usar la que sugiere la app a '
  'partir de destino_contable. La contrapartida NO se guarda: se deriva de '
  'esta (61x espejo, 791, o 781 si sale de la 68).';

-- La forma, no el catálogo: las cuentas del elemento 2 viven en el bundle
-- (1.792 filas generadas del PDF del MEF) y las del 9 no existen en ninguna
-- norma. Replicarlas acá como CHECK sería mantener la misma tabla en dos
-- lugares. Lo que se valida es que un dedazo no entre como cuenta — el resto
-- lo valida `validarDestino()`, que sí conoce los dos catálogos.
alter table public.accounting_movements
  drop constraint if exists accounting_movements_cuenta_destino_forma;

alter table public.accounting_movements
  add constraint accounting_movements_cuenta_destino_forma check (
    cuenta_pcge_destino is null or cuenta_pcge_destino ~ '^[0-9]{2,5}$'
  );

-- Para la pila de «destino por definir», que es como se va a trabajar esta
-- pantalla: se piden las de una empresa que YA tienen destino a mano, para
-- descontarlas. Parcial, así que hoy indexa cero filas y crece con el uso.
create index if not exists idx_accounting_movements_cuenta_destino
  on public.accounting_movements (company_id)
  where cuenta_pcge_destino is not null and deleted_at is null;

-- ── EL PERÍODO YA PRESENTADO ──────────────────────────────────────
-- Gabriel, 18-set: «Bloquearlo, pero no por completo, en caso muy raro que se
-- quiera cambiar un dato de un comprobante antiguo se podría. Hasta el momento
-- se tiene presentados varios comprobantes por lo menos hasta el mes de julio
-- del 2026.»
--
-- Va en `app_config` y no en una constante del código porque el cierre avanza
-- cada mes que se declara: pedirle un deploy a alguien para correr una fecha
-- es garantizar que la fecha quede vieja. `src/lib/periodo-contable.js` la lee
-- de acá y cae en '2026-07-31' si la fila no está.
insert into public.app_config (id, clave, valor)
select gen_random_uuid(), 'periodo_cerrado_hasta', '"2026-07-31"'::jsonb
where not exists (
  select 1 from public.app_config
  where clave = 'periodo_cerrado_hasta' and deleted_at is null
);
