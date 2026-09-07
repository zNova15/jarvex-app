-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  191 — MOVIMIENTOS BANCARIOS POR ENTIDAD, Y LOS DOS LADOS DEL      ║
-- ║        MISMO DINERO (tanda 12, pedido de Gabriel 7-sep-2026)       ║
-- ╚════════════════════════════════════════════════════════════════════╝
--
-- La tabla `movimientos_bancarios` existe desde la mig 024 y NUNCA se usó: no
-- había pantalla que la mostrara, y el único movimiento que se creaba era el
-- retiro automático al marcar pagado un cronograma. En producción, al 7-sep:
-- 0 cuentas, 0 movimientos. Mientras tanto, la plata SÍ está registrada en
-- otro lado — 13 constancias bancarias en `pagos_partes` (8 depósitos + 5
-- transferencias, S/ 181.281, de abr a ago) y los depósitos de bancarización.
--
-- El pedido: «movimientos bancarios por empresa y entidad (para obras sería
-- movimiento bancario de las cuentas de consorcio EL INCA)». Dos ejes:
--
--   · TITULAR de la cuenta — `cuentas_bancarias.company_id` ya apunta a
--     `companies`, y una company puede ser propia O consorcio
--     (`companies.tipo_entidad`). CONSORCIO EL INCA es una fila más: sus
--     cuentas son suyas, y la obra las mira porque él es su ejecutora
--     (`obras.ejecutora_company_id`). No hace falta columna nueva.
--   · ENTIDAD BANCARIA — hoy `banco` es texto libre: «BCP», «bcp» y «Banco de
--     Crédito» son tres bancos distintos al agrupar. `banco_codigo` es la
--     forma normalizada con la que se agrupa; `banco` sigue siendo lo que se
--     escribe y se muestra.
--
-- Y la decisión de fondo (Gabriel, 7-sep): los movimientos entran POR LOS DOS
-- LADOS y se concilian. El lado del BANCO son las líneas del extracto
-- (`origen='extracto'`, con el saldo que el banco reporta en esa línea). El
-- lado de JARVEX es lo que ya se registró al trabajar: la constancia de un
-- pago (`pago_parte_id`) o un depósito de bancarización (`deposito_id`).
-- Conciliar es decir «esta línea del banco ES aquel pago», y por eso el
-- vínculo es ÚNICO: una constancia no puede quedar conciliada contra dos
-- líneas del extracto — sería la misma plata contada dos veces.
--
-- El saldo NO se guarda: sale de saldo_inicial + Σ movimientos, igual que el
-- stock sale de los movimientos de almacén.

-- ── 1. La cuenta: cómo se agrupa y cómo se le dice ──────────────────
ALTER TABLE public.cuentas_bancarias ADD COLUMN IF NOT EXISTS banco_codigo text;
ALTER TABLE public.cuentas_bancarias ADD COLUMN IF NOT EXISTS alias text;

COMMENT ON COLUMN public.cuentas_bancarias.banco_codigo IS
  'Entidad bancaria normalizada (bcp, bbva, interbank, nacion…) para agrupar. `banco` es el texto que se muestra.';
COMMENT ON COLUMN public.cuentas_bancarias.alias IS
  'Cómo le dicen a esta cuenta en la práctica ("la de detracciones", "la del consorcio").';

CREATE INDEX IF NOT EXISTS idx_cb_banco_codigo
  ON public.cuentas_bancarias(company_id, banco_codigo) WHERE deleted_at IS NULL;

-- Backfill: normaliza lo que ya esté escrito (hoy 0 filas, pero la migración
-- tiene que servir igual si se corre después de cargar cuentas a mano).
UPDATE public.cuentas_bancarias SET banco_codigo = CASE
    WHEN banco ILIKE '%credito%' OR banco ILIKE 'bcp%'        THEN 'bcp'
    WHEN banco ILIKE '%bbva%'    OR banco ILIKE '%continental%' THEN 'bbva'
    WHEN banco ILIKE '%interbank%'                            THEN 'interbank'
    WHEN banco ILIKE '%scotia%'                               THEN 'scotiabank'
    WHEN banco ILIKE '%nacion%'                               THEN 'nacion'
    WHEN banco ILIKE '%banbif%'                               THEN 'banbif'
    WHEN banco ILIKE '%pichincha%'                            THEN 'pichincha'
    WHEN banco ILIKE '%mibanco%'                              THEN 'mibanco'
    WHEN banco ILIKE '%comercio%'                             THEN 'comercio'
    WHEN banco ILIKE '%caja%'                                 THEN lower(regexp_replace(banco, '\s+', '_', 'g'))
    ELSE lower(regexp_replace(trim(banco), '\s+', '_', 'g'))
  END
  WHERE banco_codigo IS NULL AND banco IS NOT NULL;

-- ── 2. El movimiento: de qué lado viene y contra qué cuadra ─────────
ALTER TABLE public.movimientos_bancarios ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'manual';
ALTER TABLE public.movimientos_bancarios ADD COLUMN IF NOT EXISTS saldo_extracto numeric(14,2);
ALTER TABLE public.movimientos_bancarios ADD COLUMN IF NOT EXISTS obra_id uuid REFERENCES public.obras(id);
ALTER TABLE public.movimientos_bancarios ADD COLUMN IF NOT EXISTS pago_parte_id uuid REFERENCES public.pagos_partes(id);
ALTER TABLE public.movimientos_bancarios ADD COLUMN IF NOT EXISTS deposito_id uuid REFERENCES public.depositos_bancarizacion(id);
ALTER TABLE public.movimientos_bancarios ADD COLUMN IF NOT EXISTS import_hash text;
ALTER TABLE public.movimientos_bancarios ADD COLUMN IF NOT EXISTS conciliado_at timestamptz;
ALTER TABLE public.movimientos_bancarios ADD COLUMN IF NOT EXISTS conciliado_by uuid;

DO $$ BEGIN
  ALTER TABLE public.movimientos_bancarios
    ADD CONSTRAINT movimientos_bancarios_origen_check
    CHECK (origen = ANY (ARRAY['extracto','jarvex','manual']));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.movimientos_bancarios.origen IS
  'extracto = línea del estado de cuenta del banco | jarvex = generado por la app (pago, cronograma) | manual = tecleado a mano.';
COMMENT ON COLUMN public.movimientos_bancarios.saldo_extracto IS
  'El saldo que el banco reporta DESPUÉS de esta línea. Sirve para detectar el hueco: si el saldo calculado no coincide, falta un movimiento.';
COMMENT ON COLUMN public.movimientos_bancarios.import_hash IS
  'Huella de la línea importada (fecha|monto|referencia|descripción). Evita que reimportar el mismo extracto duplique todo.';

CREATE INDEX IF NOT EXISTS idx_mb_origen   ON public.movimientos_bancarios(origen)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mb_obra     ON public.movimientos_bancarios(obra_id) WHERE deleted_at IS NULL;

-- Reimportar el mismo extracto no duplica: la línea ya está.
CREATE UNIQUE INDEX IF NOT EXISTS ux_mb_import
  ON public.movimientos_bancarios(cuenta_id, import_hash)
  WHERE import_hash IS NOT NULL AND deleted_at IS NULL;

-- Una constancia se concilia contra UNA sola línea del banco. Sin esto, la
-- misma transferencia podría quedar cuadrada contra dos líneas del extracto y
-- el saldo mentiría por el doble.
CREATE UNIQUE INDEX IF NOT EXISTS ux_mb_pago_parte
  ON public.movimientos_bancarios(pago_parte_id)
  WHERE pago_parte_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_mb_deposito
  ON public.movimientos_bancarios(deposito_id)
  WHERE deposito_id IS NOT NULL AND deleted_at IS NULL;

-- ── 3. De qué cuenta salió la plata ─────────────────────────────────
-- La constancia de pago dice el método («transferencia») y el n° de operación,
-- pero nunca dijo DESDE QUÉ CUENTA. Sin eso no hay estado de cuenta posible:
-- los 13 pagos bancarios de producción no se pueden atribuir a ninguna cuenta.
ALTER TABLE public.pagos_partes            ADD COLUMN IF NOT EXISTS cuenta_id uuid REFERENCES public.cuentas_bancarias(id);
ALTER TABLE public.depositos_bancarizacion ADD COLUMN IF NOT EXISTS cuenta_id uuid REFERENCES public.cuentas_bancarias(id);

CREATE INDEX IF NOT EXISTS idx_pagos_partes_cuenta ON public.pagos_partes(cuenta_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dep_banc_cuenta     ON public.depositos_bancarizacion(cuenta_id) WHERE deleted_at IS NULL;

-- ── 4. Conciliado es una CONSECUENCIA, no una casilla suelta ────────
-- `conciliado` era un boolean que cualquiera podía marcar sin vincular nada.
-- Ahora lo decide el vínculo: si el movimiento apunta a una constancia, a un
-- depósito o a un asiento contable, está conciliado; si se desvincula, deja de
-- estarlo. Así no queda "conciliado" contra nada.
CREATE OR REPLACE FUNCTION public.mb_marcar_conciliado() RETURNS trigger AS $$
BEGIN
  IF NEW.pago_parte_id IS NOT NULL
     OR NEW.deposito_id IS NOT NULL
     OR NEW.accounting_movement_id IS NOT NULL THEN
    NEW.conciliado := true;
    IF NEW.conciliado_at IS NULL THEN
      NEW.conciliado_at := now();
      NEW.conciliado_by := COALESCE(NEW.conciliado_by, NEW.updated_by, auth.uid());
    END IF;
  ELSE
    NEW.conciliado := false;
    NEW.conciliado_at := NULL;
    NEW.conciliado_by := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mb_conciliado ON public.movimientos_bancarios;
CREATE TRIGGER trg_mb_conciliado
  BEFORE INSERT OR UPDATE ON public.movimientos_bancarios
  FOR EACH ROW EXECUTE FUNCTION public.mb_marcar_conciliado();

-- ── 5. La línea del banco pertenece a la cuenta, y punto ────────────
-- Un movimiento conciliado contra una constancia cuya `cuenta_id` es OTRA
-- cuenta sería un cuadre falso: la plata salió de un lado y se anotó en otro.
CREATE OR REPLACE FUNCTION public.mb_check_cuenta_coherente() RETURNS trigger AS $$
DECLARE
  cta_parte uuid;
  cta_dep   uuid;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;

  IF NEW.pago_parte_id IS NOT NULL THEN
    SELECT cuenta_id INTO cta_parte FROM public.pagos_partes WHERE id = NEW.pago_parte_id;
    IF cta_parte IS NOT NULL AND cta_parte <> NEW.cuenta_id THEN
      RAISE EXCEPTION 'La constancia dice que la plata salió de otra cuenta. Corregí la cuenta del pago o conciliá contra la línea correcta.';
    END IF;
  END IF;

  IF NEW.deposito_id IS NOT NULL THEN
    SELECT cuenta_id INTO cta_dep FROM public.depositos_bancarizacion WHERE id = NEW.deposito_id;
    IF cta_dep IS NOT NULL AND cta_dep <> NEW.cuenta_id THEN
      RAISE EXCEPTION 'El depósito está registrado en otra cuenta bancaria.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mb_cuenta_coherente ON public.movimientos_bancarios;
CREATE TRIGGER trg_mb_cuenta_coherente
  BEFORE INSERT OR UPDATE ON public.movimientos_bancarios
  FOR EACH ROW EXECUTE FUNCTION public.mb_check_cuenta_coherente();
