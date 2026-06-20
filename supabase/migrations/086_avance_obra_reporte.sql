-- 086: reporte diario de avance enriquecido (O2). Narrativa libre + frente del avance.
-- avance_obra ya tiene fecha/partida_id/porcentaje_avance_reportado/metrado_ejecutado/
-- evidencia_id/responsable_id/observaciones. Aditivo, no indexado en Dexie.

ALTER TABLE public.avance_obra ADD COLUMN IF NOT EXISTS descripcion text;
ALTER TABLE public.avance_obra ADD COLUMN IF NOT EXISTS frente_id uuid;

NOTIFY pgrst, 'reload schema';
