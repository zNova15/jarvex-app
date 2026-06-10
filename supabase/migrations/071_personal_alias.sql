-- 071: alias / apodo del personal — buscable y visible en selectores.
-- En obra a la gente se la conoce por el apodo ("Coco", "Chato") más que por
-- el nombre legal; el buscador de Personal y los selectores de movimientos
-- lo incluyen en el label.

ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS alias TEXT;

NOTIFY pgrst, 'reload schema';
