-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — stock_estados: agregar 'regular' al CHECK de estado
--
-- La UI de buckets por condición (stock-estados.js, ESTADOS_COND) ofrece
-- Nuevo / Bueno / Regular / En reparación / De baja, pero el CHECK de la
-- mig 062 solo admitía ('nuevo','bueno','reparacion','baja'): un bucket
-- 'regular' pasaba local (Dexie) y el push al server lo rechazaba con
-- 23514. Se alinea el CHECK con la UI.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.stock_estados
  DROP CONSTRAINT IF EXISTS stock_estados_estado_check;

ALTER TABLE public.stock_estados
  ADD CONSTRAINT stock_estados_estado_check
  CHECK (estado IN ('nuevo','bueno','regular','reparacion','baja'));
