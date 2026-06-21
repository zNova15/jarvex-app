-- 091: marca de respaldo a la nube (OneDrive via n8n). Aditivo: el flag arranca
-- en false; n8n (service_role) lo pone true tras copiar el archivo a OneDrive.
-- La app no toca estas columnas. (evidencias NO tiene deleted_at; el archivo está
-- en Storage cuando url_archivo no es null.)
ALTER TABLE public.evidencias
  ADD COLUMN IF NOT EXISTS respaldado_onedrive boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS respaldado_onedrive_at timestamptz,
  ADD COLUMN IF NOT EXISTS onedrive_url text;

CREATE INDEX IF NOT EXISTS idx_evidencias_respaldo
  ON public.evidencias (obra_id)
  WHERE respaldado_onedrive = false AND url_archivo IS NOT NULL;

NOTIFY pgrst, 'reload schema';
