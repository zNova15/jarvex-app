-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Herramientas: stock por cantidad (unificación con Materiales/EPP)
--
-- Hoy `herramientas` es 1-registro-por-unidad (disponible, estado_actual) y
-- `movimientos_herramientas` no tiene cantidad (usa `accion` salida/entrada).
-- Eso no permite cargar la realidad de obra: "12 palas, ingreso" / "3 palas,
-- salida". La migración histórica (SuperAdmin) necesita stock por cantidad.
--
-- Estrategia aditiva, sin romper el flujo serializado existente:
--   • herramientas.maneja_cantidad=true  → herramienta de lote (palas, picos):
--     usa stock_actual / stock_minimo como Materiales.
--   • maneja_cantidad=false (default)    → herramienta serializada (taladro
--     con serie): conserva el flujo actual 1-por-unidad.
--   • movimientos_herramientas gana `cantidad` + `tipo_movimiento` que conviven
--     con `accion` legacy. responsable_id pasa a NULLABLE (un ingreso de lote
--     no siempre tiene responsable).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.herramientas
  ADD COLUMN IF NOT EXISTS stock_actual    NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stock_minimo    NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS maneja_cantidad BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS unidad          TEXT,
  ADD COLUMN IF NOT EXISTS alerta          TEXT DEFAULT 'ok';

ALTER TABLE public.movimientos_herramientas
  ADD COLUMN IF NOT EXISTS cantidad        NUMERIC,
  ADD COLUMN IF NOT EXISTS tipo_movimiento TEXT,
  ADD COLUMN IF NOT EXISTS proveedor_id    UUID,
  ADD COLUMN IF NOT EXISTS frente_zona     TEXT;

-- Un ingreso de lote no siempre tiene responsable (sí en salida).
ALTER TABLE public.movimientos_herramientas
  ALTER COLUMN responsable_id DROP NOT NULL;

-- accion sigue NOT NULL: los movimientos de cantidad escriben accion =
-- tipo_movimiento ('entrada'/'salida'), valores ya válidos en el CHECK.

COMMENT ON COLUMN public.herramientas.maneja_cantidad IS
  'true: herramienta de lote (stock_actual por cantidad, como Materiales). false: serializada 1-por-unidad (flujo legacy).';

NOTIFY pgrst, 'reload schema';
