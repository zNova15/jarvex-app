-- 069: Tipo de documento del personal. No todos los trabajadores tienen DNI:
-- hay personal extranjero con carnet de extranjería (CE) o pasaporte. La
-- columna `dni` pasa a ser "número de documento" (se mantiene el nombre por
-- compatibilidad); `tipo_documento` dice qué documento es.
--   dni       → 8 dígitos numéricos (validable contra RENIEC)
--   ce        → carnet de extranjería (hasta 12 alfanumérico, sin RENIEC)
--   pasaporte → hasta 12 alfanumérico, sin RENIEC

ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS tipo_documento TEXT DEFAULT 'dni';

NOTIFY pgrst, 'reload schema';
