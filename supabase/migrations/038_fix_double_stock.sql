-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Recalcular stock_actual desde movimientos (fix bug ×2)
--
-- Causa: el cliente actualizaba stock_actual local + el trigger del
-- server (003_triggers.sql) también lo actualizaba al insertar el
-- movimiento. SyncEngine pushea materiales antes que
-- movimientos_materiales, así que el server recibía:
--   1. UPDATE materiales SET stock=30 (del cliente)
--   2. INSERT movimientos_materiales → trigger → stock=30+30=60
-- Resultado: stock duplicado al ×2 en cada material que tuvo
-- movimientos.
--
-- Fix UI ya commiteado: stripLocalFields filtra stock_actual y demás
-- campos manejados por el trigger antes de pushear (cliente sigue
-- actualizando local para UX rápido, pero NO manda al server).
--
-- Esta migration arregla los stocks que YA quedaron duplicados:
-- recalcula stock_actual = stock_inicial + entradas_sumadas - salidas_sumadas.
-- ═══════════════════════════════════════════════════════════════════

-- ── Materiales ──────────────────────────────────────────────────────
UPDATE public.materiales m
SET
  total_entradas = COALESCE(s.entradas, 0),
  total_salidas  = COALESCE(s.salidas, 0),
  stock_actual   = COALESCE(m.stock_inicial, 0)
                   + COALESCE(s.entradas, 0)
                   - COALESCE(s.salidas, 0),
  alerta = CASE
    WHEN (COALESCE(m.stock_inicial, 0) + COALESCE(s.entradas, 0) - COALESCE(s.salidas, 0)) <= 0
      THEN 'sin_stock'
    WHEN COALESCE(m.stock_minimo, 0) <= 0 THEN 'ok'
    WHEN (COALESCE(m.stock_inicial, 0) + COALESCE(s.entradas, 0) - COALESCE(s.salidas, 0)) <= m.stock_minimo * 0.5
      THEN 'critico'
    WHEN (COALESCE(m.stock_inicial, 0) + COALESCE(s.entradas, 0) - COALESCE(s.salidas, 0)) <= m.stock_minimo
      THEN 'reponer'
    ELSE 'ok'
  END,
  updated_at = now()
FROM (
  SELECT
    material_id,
    SUM(CASE WHEN tipo_movimiento IN ('entrada', 'devolucion') THEN cantidad ELSE 0 END) AS entradas,
    SUM(CASE WHEN tipo_movimiento IN ('salida', 'merma', 'ajuste_negativo') THEN cantidad ELSE 0 END) AS salidas
  FROM public.movimientos_materiales
  WHERE deleted_at IS NULL
  GROUP BY material_id
) s
WHERE s.material_id = m.id
  AND m.deleted_at IS NULL;

-- Materiales SIN movimientos: stock_actual = stock_inicial
-- Postgres no permite alias en UPDATE en algunas versiones cuando hay
-- subquery con NOT EXISTS — usamos nombre completo de tabla en todos
-- lados para evitar ambigüedad "column m.deleted_at does not exist".
UPDATE public.materiales
SET
  total_entradas = 0,
  total_salidas  = 0,
  stock_actual   = COALESCE(public.materiales.stock_inicial, 0),
  updated_at     = now()
WHERE public.materiales.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.movimientos_materiales mm
    WHERE mm.material_id = public.materiales.id
      AND mm.deleted_at IS NULL
  );

-- ── EPPs (mismo patrón) ─────────────────────────────────────────────
UPDATE public.epps e
SET
  total_entradas = COALESCE(s.entradas, 0),
  total_salidas  = COALESCE(s.salidas, 0),
  stock_actual   = COALESCE(e.stock_inicial, 0)
                   + COALESCE(s.entradas, 0)
                   - COALESCE(s.salidas, 0),
  updated_at = now()
FROM (
  SELECT
    epp_id,
    SUM(CASE WHEN tipo_movimiento IN ('entrada', 'devolucion') THEN cantidad ELSE 0 END) AS entradas,
    SUM(CASE WHEN tipo_movimiento IN ('salida', 'merma', 'baja') THEN cantidad ELSE 0 END) AS salidas
  FROM public.movimientos_epp
  WHERE deleted_at IS NULL
  GROUP BY epp_id
) s
WHERE s.epp_id = e.id
  AND e.deleted_at IS NULL;

-- EPPs sin movimientos
UPDATE public.epps
SET
  total_entradas = 0,
  total_salidas  = 0,
  stock_actual   = COALESCE(public.epps.stock_inicial, 0),
  updated_at     = now()
WHERE public.epps.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.movimientos_epp me
    WHERE me.epp_id = public.epps.id
      AND me.deleted_at IS NULL
  );

NOTIFY pgrst, 'reload schema';
