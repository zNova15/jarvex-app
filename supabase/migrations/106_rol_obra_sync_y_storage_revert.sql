-- 106: corrige el bug de roles de los usuarios (NO la RLS de storage — la 104 fue un error).
-- La causa real: obra_usuarios.rol_obra se fijaba al asignar la obra y NUNCA se
-- actualizaba al cambiar el rol del perfil → quedaba desincronizado. Los ingenieros
-- se crearon como solo_lectura (bug API create-user + CHECK obra_usuarios, arreglados en
-- commits/migs previos), se les corrigió el perfil a 'ingeniero', pero su rol_obra quedó
-- en 'solo_lectura' → la RLS de Storage (correctamente) les bloqueaba subir fotos.
-- (El cliente ahora propaga el rol a obra_usuarios en handleChangeRol — anti-recurrencia.)

-- (1) Revertir la mig 104: solo_lectura NO debe poder subir (es solo lectura).
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
          AND obra_usuarios.rol_obra <> 'solo_lectura'
      )
    )
  );

-- (2) Sincronizar rol_obra con el rol real del perfil (heal de los desincronizados).
--     rol_obra siempre debe reflejar profiles.rol (no hay UI de rol por-obra distinto).
UPDATE public.obra_usuarios ou
SET rol_obra = p.rol
FROM public.profiles p
WHERE ou.usuario_id = p.id
  AND ou.rol_obra <> p.rol;
