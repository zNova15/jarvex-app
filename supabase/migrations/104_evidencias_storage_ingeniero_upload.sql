-- 104: arregla que los INGENIEROS no podían subir fotos de sus reportes de avance.
-- La política de storage 'evidencias: subir por obra' exigía que el usuario fuera
-- miembro de la obra (obra_usuarios) Y con rol_obra <> 'solo_lectura'. Los ingenieros
-- están asignados como 'solo_lectura', así que su upload a Storage fallaba en silencio
-- (retries -> failed) y la metadata nunca llegaba al servidor -> 0 evidencias de avance.
-- Fix: basta con ser MIEMBRO ACTIVO de la obra para subir evidencias (se quita la
-- condicion rol_obra <> 'solo_lectura'). La visibilidad/edicion real la controla la app.
DROP POLICY IF EXISTS "evidencias: subir por obra" ON storage.objects;
CREATE POLICY "evidencias: subir por obra" ON storage.objects
  FOR INSERT TO public
  WITH CHECK (
    bucket_id = 'evidencias'
    AND auth.uid() IS NOT NULL
    AND (
      (SELECT profiles.rol FROM profiles WHERE profiles.id = auth.uid()) = 'admin'
      OR EXISTS (
        SELECT 1 FROM obra_usuarios
        WHERE (obra_usuarios.obra_id)::text = (storage.foldername(objects.name))[1]
          AND obra_usuarios.usuario_id = auth.uid()
          AND obra_usuarios.activo = true
      )
    )
  );
