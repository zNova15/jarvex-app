-- 083: frente_id en las 5 tablas de movimiento (S1 — frente opcional en salidas).
-- Columna aditiva, sin FK estricta (como personal.frente_id). NO indexada en Dexie
-- (campo suelto; el sync la incluye igual). Índice parcial server-side para filtros.

ALTER TABLE public.movimientos_materiales        ADD COLUMN IF NOT EXISTS frente_id uuid;
ALTER TABLE public.movimientos_herramientas      ADD COLUMN IF NOT EXISTS frente_id uuid;
ALTER TABLE public.movimientos_epp               ADD COLUMN IF NOT EXISTS frente_id uuid;
ALTER TABLE public.movimientos_maquinaria        ADD COLUMN IF NOT EXISTS frente_id uuid;
ALTER TABLE public.movimientos_insumos_emergencia ADD COLUMN IF NOT EXISTS frente_id uuid;

CREATE INDEX IF NOT EXISTS idx_mov_mat_frente  ON public.movimientos_materiales(obra_id, frente_id) WHERE frente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mov_herr_frente ON public.movimientos_herramientas(obra_id, frente_id) WHERE frente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mov_epp_frente  ON public.movimientos_epp(obra_id, frente_id) WHERE frente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mov_maq_frente  ON public.movimientos_maquinaria(obra_id, frente_id) WHERE frente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mov_emerg_frente ON public.movimientos_insumos_emergencia(obra_id, frente_id) WHERE frente_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
