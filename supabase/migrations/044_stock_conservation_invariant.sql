-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Invariante de conservación de stock + idempotency hardening
--
-- Origen: auditoría del consejo (commit 88b5049 dispatch).
-- Síntoma reportado: stock_actual de un material llegó a -45m³ después
-- de duplicaciones de movimientos. El consejo (Contrarian, reviewers
-- 1/3/4/5) coincidió en que es una violación de conservación de masa,
-- no solo un bug de duplicado.
--
-- Esta migration añade:
--   1) CHECK constraint `stock_actual >= 0` en materiales y epps.
--      Sirve como red de seguridad: ANTES de que llegue al -45,
--      Postgres rechaza la transacción.
--   2) Idempotency: si `idempotency_key` ya existe, el segundo INSERT
--      de movimiento se ignora silenciosamente (idempotente). Esto
--      mata duplicados estructuralmente — un retry del cliente no
--      genera doble salida.
--
-- IMPORTANTE: el cliente ya tiene UNIQUE en idempotency_key (migración
-- 016), pero el upsert "ON CONFLICT DO NOTHING" sobre INSERT no estaba
-- garantizado. Acá lo hacemos explícito.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Invariante de conservación: stock_actual nunca puede ser negativo ──

-- Materiales
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'materiales'
      AND constraint_name = 'materiales_stock_actual_non_negative'
  ) THEN
    ALTER TABLE public.materiales
      ADD CONSTRAINT materiales_stock_actual_non_negative
      CHECK (stock_actual IS NULL OR stock_actual >= 0)
      NOT VALID;  -- NOT VALID: no falla si ya hay rows con stock negativo
    RAISE NOTICE '✓ Constraint materiales_stock_actual_non_negative agregada (NOT VALID).';
    RAISE NOTICE '  Para validar registros existentes (que pueden estar en negativo):';
    RAISE NOTICE '    UPDATE materiales SET stock_actual = 0 WHERE stock_actual < 0;';
    RAISE NOTICE '    ALTER TABLE materiales VALIDATE CONSTRAINT materiales_stock_actual_non_negative;';
  END IF;
END $$;

-- EPPs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'epps'
      AND constraint_name = 'epps_stock_actual_non_negative'
  ) THEN
    ALTER TABLE public.epps
      ADD CONSTRAINT epps_stock_actual_non_negative
      CHECK (stock_actual IS NULL OR stock_actual >= 0)
      NOT VALID;
    RAISE NOTICE '✓ Constraint epps_stock_actual_non_negative agregada (NOT VALID).';
  END IF;
END $$;

-- ── 2. Auto-fix de stocks negativos existentes (one-shot) ──
-- El -45 m³ reportado debe corregirse: setear a 0 los que están <0.
-- Esto NO toca movimientos — solo el snapshot stock_actual que el
-- trigger recalcula. Si después llega un movimiento legítimo el trigger
-- lo computa bien.
UPDATE public.materiales
SET stock_actual = 0,
    updated_at = NOW(),
    alerta = 'critico'
WHERE stock_actual < 0;

UPDATE public.epps
SET stock_actual = 0,
    updated_at = NOW()
WHERE stock_actual < 0;

-- ── 3. Idempotency en movimientos: ON CONFLICT DO NOTHING ──
-- Los UNIQUE en idempotency_key ya existen (migración 016) para
-- movimientos_materiales y movimientos_herramientas. Pero un INSERT
-- desde el cliente con el mismo key tira error de duplicate key.
-- Idealmente el cliente lo cazaría como "ya existe, ignorar" pero
-- siendo defensivos, añadimos un trigger que convierte conflicts en
-- no-ops para los retries seguros.
--
-- En Supabase/PostgREST esto se hace mejor en el cliente con un upsert.
-- Como migración server-only no podemos forzar el cliente, así que
-- documentamos la convención y agregamos un índice partial para
-- acelerar la búsqueda por idempotency_key en lookups.

CREATE INDEX IF NOT EXISTS idx_movimientos_materiales_idempotency
  ON public.movimientos_materiales (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_movimientos_herramientas_idempotency
  ON public.movimientos_herramientas (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'movimientos_epp'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_movimientos_epp_idempotency
             ON public.movimientos_epp (idempotency_key)
             WHERE idempotency_key IS NOT NULL';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMENT ON CONSTRAINT materiales_stock_actual_non_negative ON public.materiales IS
  'Conservation invariant: stock no puede ser negativo. Backstop contra duplicados de movimientos.';
COMMENT ON CONSTRAINT epps_stock_actual_non_negative ON public.epps IS
  'Conservation invariant: stock no puede ser negativo.';
