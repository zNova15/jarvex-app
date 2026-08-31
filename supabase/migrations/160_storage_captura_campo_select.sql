-- 160 — FIX subida del portal de campo (bug real, 31-ago-2026, autorizado por Gabriel).
--
-- Síntoma: "Subida de archivo al Storage falló: new row violates row-level
-- security policy" desde el teléfono con la cuenta campo, aunque las políticas
-- de INSERT (migs 155/158) evaluaban TRUE.
--
-- Causa raíz (verificada con JWT simulado): la API de Storage sube con
-- INSERT ... RETURNING, y Postgres exige que la fila nueva TAMBIÉN pase las
-- políticas de SELECT para poder devolverla. El rol campo (y cualquier rol no
-- contable sin obra vinculada al folder, ej. ingenieros usando el atajo
-- interno) no pasaba NINGUNA política de SELECT de storage.objects → el INSERT
-- entero rebota con error de RLS. La misma trampa aplicaba al reintento con
-- upsert (UPDATE) si el archivo ya existía.
--
-- Fix: SELECT + UPDATE espejo de la política de INSERT de la carpeta fija
-- 'captura-campo/' (mig 158). El bucket ya es público (los visores usan
-- publicUrl), así que ver la METADATA de esos objetos no expone nada nuevo;
-- el UPDATE queda limitado al dueño del objeto (re-subida idempotente propia).

DROP POLICY IF EXISTS "evidencias storage: carpeta captura-campo select" ON storage.objects;
CREATE POLICY "evidencias storage: carpeta captura-campo select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'evidencias'
    AND (storage.foldername(name))[1] = 'captura-campo'
    AND auth.uid() IS NOT NULL
  );

DROP POLICY IF EXISTS "evidencias storage: carpeta captura-campo update" ON storage.objects;
CREATE POLICY "evidencias storage: carpeta captura-campo update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'evidencias'
    AND (storage.foldername(name))[1] = 'captura-campo'
    AND owner = auth.uid()
  )
  WITH CHECK (
    bucket_id = 'evidencias'
    AND (storage.foldername(name))[1] = 'captura-campo'
    AND owner = auth.uid()
  );
