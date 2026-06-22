-- 092: origen del avance. Distingue el "avance inicial" importado del cronograma Gantt
-- de los reportes diarios de los ingenieros. Permite re-importar reemplazando SOLO el
-- avance inicial sin tocar lo que reportaron los ingenieros. Aditivo, default 'reporte'.
ALTER TABLE public.avance_obra ADD COLUMN IF NOT EXISTS origen text DEFAULT 'reporte';
COMMENT ON COLUMN public.avance_obra.origen IS 'reporte = reporte diario del ingeniero; importacion = avance inicial cargado al importar el cronograma Gantt';
