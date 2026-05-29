-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Variantes padre-hijo (SKU) en inventarios
--
-- Un insumo genérico (ej. "Guantes") puede dividirse en variantes
-- concretas (Badana T9, C35/T9…). El "grupo" es una fila padre sin stock
-- propio; sus hijos (variantes) llevan el stock real y referencian al
-- padre con padre_id. El stock del grupo es la suma de sus variantes.
--   · padre_id  → id del insumo padre (grupo). NULL = ítem suelto o grupo.
--   · es_grupo  → true si la fila es un grupo (rollup, sin movimientos).
-- Aditivo y nullable en los 4 inventarios.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.materiales         ADD COLUMN IF NOT EXISTS padre_id UUID, ADD COLUMN IF NOT EXISTS es_grupo BOOLEAN DEFAULT false;
ALTER TABLE public.epps               ADD COLUMN IF NOT EXISTS padre_id UUID, ADD COLUMN IF NOT EXISTS es_grupo BOOLEAN DEFAULT false;
ALTER TABLE public.herramientas       ADD COLUMN IF NOT EXISTS padre_id UUID, ADD COLUMN IF NOT EXISTS es_grupo BOOLEAN DEFAULT false;
ALTER TABLE public.insumos_emergencia ADD COLUMN IF NOT EXISTS padre_id UUID, ADD COLUMN IF NOT EXISTS es_grupo BOOLEAN DEFAULT false;

NOTIFY pgrst, 'reload schema';
