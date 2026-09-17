-- ═══════════════════════════════════════════════════════════════════
-- 221 — El número de la constancia de detracción (17-set-2026)
--
-- POR QUÉ. Tanda 4: el Registro de Compras se lleva con el formato del Excel
-- modelo de las contadoras, y ese formato tiene DOS columnas para la
-- detracción: «CONSTANCIA DE DEPOSITO DE DETRACCION (3) → NUMERO» y «FECHA DE
-- EMISION». La app guardaba la fecha (`detraccion_constancia_fecha`), el
-- porcentaje, el monto, el código del bien o servicio y hasta la imagen de la
-- constancia — pero no el NÚMERO, que es el dato con el que SUNAT cruza el
-- depósito. La columna salía vacía y había que ir a abrir la imagen de cada
-- una de las 28 constancias para copiarlo a mano.
--
-- ES EL NÚMERO, NO EL CÓDIGO. `detraccion_codigo` es el código del bien o
-- servicio sujeto al SPOT (037 «demás servicios gravados con el IGV», por
-- ejemplo): dice QUÉ se detrajo. Este campo es el número de la constancia que
-- emite el Banco de la Nación: dice CUÁL fue el depósito. Confundirlos deja el
-- registro cruzando contra un código de catálogo.
--
-- SIN BACKFILL: nace vacío y se llena al registrar o corregir cada depósito.
-- Las 28 que ya están cargadas tienen su imagen; el número se transcribe
-- cuando se las vuelva a tocar, y hasta entonces el registro avisa que falta
-- en vez de declarar un blanco silencioso.
-- ═══════════════════════════════════════════════════════════════════

alter table public.accounting_movements
  add column if not exists detraccion_constancia_numero text;

comment on column public.accounting_movements.detraccion_constancia_numero is
  'Número de la constancia de depósito de detracción del Banco de la Nación. '
  'Es una columna del Registro de Compras y es con lo que SUNAT cruza el '
  'depósito. NO confundir con detraccion_codigo, que es el código del bien o '
  'servicio sujeto al SPOT.';
