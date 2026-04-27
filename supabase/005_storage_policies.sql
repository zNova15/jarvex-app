-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Políticas de Storage para evidencias
-- Ejecutar DESPUÉS de crear el bucket "evidencias" en el dashboard
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "evidencias: ver por obra" ON storage.objects;
DROP POLICY IF EXISTS "evidencias: subir por obra" ON storage.objects;
DROP POLICY IF EXISTS "evidencias: gestionar (admin)" ON storage.objects;

CREATE POLICY "evidencias: ver por obra"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'evidencias'
    AND auth.uid() IS NOT NULL
    AND (
      (SELECT rol FROM profiles WHERE id = auth.uid()) = 'admin'
      OR EXISTS (
        SELECT 1 FROM obra_usuarios
        WHERE obra_id::text = (storage.foldername(name))[1]
          AND usuario_id = auth.uid() AND activo = true
      )
    )
  );

CREATE POLICY "evidencias: subir por obra"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'evidencias'
    AND auth.uid() IS NOT NULL
    AND (
      (SELECT rol FROM profiles WHERE id = auth.uid()) = 'admin'
      OR EXISTS (
        SELECT 1 FROM obra_usuarios
        WHERE obra_id::text = (storage.foldername(name))[1]
          AND usuario_id = auth.uid() AND activo = true
          AND rol_obra != 'solo_lectura'
      )
    )
  );

CREATE POLICY "evidencias: gestionar (admin)"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'evidencias'
    AND (SELECT rol FROM profiles WHERE id = auth.uid()) = 'admin'
  );
