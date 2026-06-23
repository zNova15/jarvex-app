-- 095: avance_obra.deleted_at. La tabla no tenia soft-delete, asi que el "borrado" del
-- avance inicial importado (deleted_at local) se perdia al sincronizar (la columna no
-- existia) y el registro RESUCITABA en el pull -> los avances iniciales se ACUMULABAN al
-- re-importar el Gantt. Con la columna, el soft-delete persiste y el re-import REEMPLAZA.
ALTER TABLE public.avance_obra ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
