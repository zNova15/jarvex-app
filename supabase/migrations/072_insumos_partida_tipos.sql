-- 072: el parser de APU produce categorías 'subcontrato' y 'subpartida'
-- (secciones reales de los APU de Delphin/S10), pero el CHECK original solo
-- permitía material/mano_obra/herramienta/equipo → esos insumos fallaban el
-- push con 23514 y quedaban trabados para siempre.
DO $$
DECLARE c TEXT;
BEGIN
  SELECT conname INTO c FROM pg_constraint
  WHERE conrelid = 'public.insumos_partida'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%tipo_insumo%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.insumos_partida DROP CONSTRAINT %I', c);
  END IF;
END $$;
ALTER TABLE public.insumos_partida
  ADD CONSTRAINT insumos_partida_tipo_insumo_check
  CHECK (tipo_insumo IS NULL OR tipo_insumo IN ('material','mano_obra','herramienta','equipo','subcontrato','subpartida'));
NOTIFY pgrst, 'reload schema';
