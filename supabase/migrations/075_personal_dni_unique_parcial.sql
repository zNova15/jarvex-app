-- 075: el UNIQUE(dni, obra_id) de personal pasa a índice PARCIAL.
-- Antes contaba también las filas soft-deleted, así que los DNIs placeholder
-- 'MIG-…' de personal temporal de migración (borrado) seguían ocupados y
-- re-crear un temporal con el mismo DNI fallaba con 23505 ("personal
-- duplicado"), trabando el sync. Ahora la unicidad solo aplica a filas vivas.
ALTER TABLE public.personal DROP CONSTRAINT IF EXISTS personal_dni_obra_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS personal_dni_obra_id_vivo_uidx
  ON public.personal (dni, obra_id) WHERE deleted_at IS NULL;
