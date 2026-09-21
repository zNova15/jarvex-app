-- ═══════════════════════════════════════════════════════════════════
-- 224 — CUÁNDO SALIÓ DEL ALMACÉN lo que quedó en el Balance
--       (tanda 5 del destino, 21-set-2026)
--
-- ── EL AGUJERO QUE DEJÓ LA TANDA 1 ────────────────────────────────
-- Desde la mig 223 la contadora puede mandar una compra a una existencia
-- (20/24/25/26) en vez de a una cuenta del elemento 9, y el asiento escribe el
-- «20111 / 6111» que pidieron. Esa mitad está bien. La otra mitad NO EXISTÍA:
-- no había ninguna forma de sacar esa plata de ahí.
--
-- Y el error de dejarla adentro no se ve. Una compra mandada al inventario y
-- nunca descargada queda en el Balance para siempre: el activo crece sin
-- techo, el costo nunca llega al Estado de Resultados y la empresa paga renta
-- sobre una utilidad que no tuvo. Es el error simétrico —y más caro— del que
-- el aviso ámbar de la tanda 1 ya advertía en la otra dirección.
--
-- ── LO QUE SE GUARDA ES LA SALIDA, NO EL ASIENTO ──────────────────
-- Mismo criterio que las migs 220 y 223: el Libro Diario se deriva, acá solo
-- vive la DECISIÓN. Son tres datos y uno solo es una cuenta:
--
--   · `existencia_salida_fecha`   cuándo salió del almacén. NO es la fecha de
--                                 la factura: una bolsa de cemento comprada en
--                                 mayo y usada en agosto sale en agosto, y el
--                                 costo pertenece a agosto.
--   · `existencia_salida_cuenta`  a dónde fue: una del elemento 9 si se
--                                 consumió, o la 69 si se vendió.
--   · `existencia_salida_importe` cuánto salió. Permite la descarga PARCIAL,
--                                 que es el caso normal del cemento.
--
-- Las otras TRES patas del asiento salen solas de esas, con la misma regla de
-- la tanda 1 —se elige UNA cuenta—. Ver `src/lib/existencias-balance.js`.
--
-- ── UNA SOLA SALIDA POR COMPROBANTE, Y ESTÁ DICHO ─────────────────
-- Esto son columnas y no una tabla `existencia_salidas`, así que una compra
-- tiene UNA descarga, que puede ser parcial pero no repetida: la segunda
-- descarga se hace subiendo el importe de la primera, y el panel de saldo
-- muestra cuánto falta. Es la misma decisión de alcance que ya tomaron las
-- tandas 2 y 3 («un destino por comprobante, sin reparto») y se toma igual por
-- un motivo medible: al 21-set-2026 hay CERO movimientos con
-- `cuenta_pcge_destino` puesto (0 de 1.845), o sea que todavía nadie mandó
-- nada a una existencia. Montar un libro de descargas de varias filas —tabla,
-- versión de Dexie, SyncEngine, hook— para cero filas de uso sería construir
-- sobre una suposición. Cuando el uso aparezca y la descarga parcial repetida
-- moleste, la tabla es una migración más y estos campos se vuelcan a ella.
--
-- ── EL CHECK Y LA LECCIÓN DE LA REGLA 9 ───────────────────────────
-- 🔴 Un CHECK que la app no respeta deja el sync en reintento eterno (es lo
-- que pasó con `insumo_categoria`). Este acopla dos columnas —la salida solo
-- vale si el destino ES una existencia— así que la app tiene que BORRAR la
-- salida en la misma escritura en que el destino deja de ser una existencia.
-- Eso lo hace `fijarCuentaManual` y hay un test que falla si deja de hacerlo.
-- Se pone igual, y no se deja «a cargo del cliente», porque una salida
-- huérfana de su destino genera medio asiento fantasma en un libro que se
-- declara.
--
-- EL NOMBRE DEL CONSTRAINT NO ES DECORATIVO. Termina en
-- `_existencia_salida_cuenta_check` para que `campoDeConstraint()` del
-- SyncEngine pueda resolverlo: esa función busca el sufijo más largo del
-- nombre que sea una COLUMNA del record, y con un nombre como
-- `..._salida_coherente` se quedaba con «coherente» y el mensaje de error del
-- sync decía una palabra que no existe en ningún lado. Con éste resuelve a
-- `existencia_salida_cuenta`, que está en `CAMPO_HUMANO` como «salida del
-- inventario».
-- ═══════════════════════════════════════════════════════════════════

alter table public.accounting_movements
  add column if not exists existencia_salida_fecha date,
  add column if not exists existencia_salida_cuenta text,
  add column if not exists existencia_salida_importe numeric,
  add column if not exists existencia_salida_por uuid,
  add column if not exists existencia_salida_at timestamptz;

comment on column public.accounting_movements.existencia_salida_fecha is
  'Día en que lo comprado salió del almacén. NO es la fecha del comprobante: '
  'es la que decide a qué período pertenece el costo.';
comment on column public.accounting_movements.existencia_salida_cuenta is
  'A dónde fue al salir del inventario: una cuenta del elemento 9 (se '
  'consumió) o la 69 Costo de ventas (se vendió). Las otras patas del asiento '
  'se derivan de ésta (61x espejo, 791/781).';
comment on column public.accounting_movements.existencia_salida_importe is
  'Cuánto salió, en la moneda del comprobante. Puede ser menor que lo que '
  'entró: la descarga parcial es el caso normal.';

-- La forma, no el catálogo — mismo criterio que la mig 223: las cuentas del
-- elemento 9 no existen en ninguna norma y las del PCGE viven en el bundle.
-- Lo que se valida acá es la COHERENCIA entre las columnas, que es lo que el
-- generador del asiento da por cierto: o no hay salida, o la salida está
-- entera y cuelga de un destino que es una existencia.
alter table public.accounting_movements
  drop constraint if exists accounting_movements_existencia_salida_cuenta_check;

alter table public.accounting_movements
  add constraint accounting_movements_existencia_salida_cuenta_check check (
    (existencia_salida_cuenta is null
      and existencia_salida_fecha is null
      and existencia_salida_importe is null)
    or (
      existencia_salida_cuenta ~ '^[0-9]{2,5}$'
      and existencia_salida_fecha is not null
      and existencia_salida_importe is not null
      and existencia_salida_importe > 0
      -- Sin destino de existencia no hay nada de dónde sacar: el elemento 2 es
      -- lo único que queda en el Balance.
      and cuenta_pcge_destino is not null
      and left(cuenta_pcge_destino, 1) = '2'
    )
  );

-- Las dos preguntas del panel de saldo, las dos por empresa: «qué hay parado
-- en el Balance» (destino de existencia SIN salida) y «qué se descargó».
-- Parciales: hoy indexan cero filas y crecen con el uso.
create index if not exists idx_accounting_movements_existencia_parada
  on public.accounting_movements (company_id, date)
  where cuenta_pcge_destino is not null
    and existencia_salida_cuenta is null
    and deleted_at is null;

create index if not exists idx_accounting_movements_existencia_salida
  on public.accounting_movements (company_id, existencia_salida_fecha)
  where existencia_salida_cuenta is not null and deleted_at is null;
