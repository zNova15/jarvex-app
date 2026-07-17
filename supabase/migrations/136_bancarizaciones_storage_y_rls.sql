-- 136: BANCARIZACIONES visibles para contabilidad y admin (pedido de Gabriel,
-- jul 2026). Dos bugs de raíz + un endurecimiento de visibilidad:
--
-- (1) BUG "el admin no ve ninguna bancarización": las constancias que subía la
--     asistente (ayudante_contador) NUNCA llegaban al server. La policy de
--     INSERT de storage.objects exigía ser miembro activo de la obra
--     (obra_usuarios, rol_obra <> 'solo_lectura'); contabilidad trabaja
--     transversal a las obras, sin asignación → el upload a Storage fallaba
--     (5 retries → sync_status 'failed') y la metadata jamás se upserteaba a
--     public.evidencias. En SU dispositivo se veían por el blob local (por eso
--     "yo sí las subí"); en el del admin todo seguía "⚠ Falta bancarización".
--     Fix: los roles contables (contador, ayudante_contador) pueden SUBIR
--     evidencias de cualquier obra. Los failed locales se auto-reactivan
--     (reactivarFallidasConBlob) y suben al fin.
-- (2) Ídem SELECT de storage: contador/ayudante deben poder firmar URLs de
--     archivos de obras a las que no están asignados (el admin ya pasaba por
--     su cláusula rol='admin').
-- (3) ENDURECIMIENTO (pedido explícito): lo CONTABLE (bancarización, factura,
--     comprobante, recibos, pagos) lo ven SOLO contabilidad (asistente +
--     contadora jefe) y admin — se quitan gerente, tesorero y asistente_admin
--     del allowlist de la mig 121. Ningún otro rol con acceso a la sección de
--     Evidencias debe ver material contable.

-- (1) Subir: contabilidad sube constancias de cualquier obra.
DROP POLICY IF EXISTS "evidencias: subir por obra" ON storage.objects;
CREATE POLICY "evidencias: subir por obra" ON storage.objects
  FOR INSERT TO public
  WITH CHECK (
    bucket_id = 'evidencias'
    AND auth.uid() IS NOT NULL
    AND (
      (SELECT profiles.rol FROM profiles WHERE profiles.id = auth.uid())
        IN ('admin', 'contador', 'ayudante_contador')
      OR EXISTS (
        SELECT 1 FROM obra_usuarios
        WHERE (obra_usuarios.obra_id)::text = (storage.foldername(objects.name))[1]
          AND obra_usuarios.usuario_id = auth.uid()
          AND obra_usuarios.activo = true
          AND obra_usuarios.rol_obra <> 'solo_lectura'
      )
    )
  );

-- (1b) Actualizar (retry con upsert:true re-sube el mismo path): mismos
-- principales que el INSERT. Sin esta policy, un reintento tras subir el blob
-- pero fallar la metadata quedaba bloqueado en el UPDATE del upsert.
DROP POLICY IF EXISTS "evidencias: actualizar por obra" ON storage.objects;
CREATE POLICY "evidencias: actualizar por obra" ON storage.objects
  FOR UPDATE TO public
  USING (
    bucket_id = 'evidencias'
    AND auth.uid() IS NOT NULL
    AND (
      (SELECT profiles.rol FROM profiles WHERE profiles.id = auth.uid())
        IN ('admin', 'contador', 'ayudante_contador')
      OR EXISTS (
        SELECT 1 FROM obra_usuarios
        WHERE (obra_usuarios.obra_id)::text = (storage.foldername(objects.name))[1]
          AND obra_usuarios.usuario_id = auth.uid()
          AND obra_usuarios.activo = true
          AND obra_usuarios.rol_obra <> 'solo_lectura'
      )
    )
  )
  WITH CHECK (
    bucket_id = 'evidencias'
    AND auth.uid() IS NOT NULL
    AND (
      (SELECT profiles.rol FROM profiles WHERE profiles.id = auth.uid())
        IN ('admin', 'contador', 'ayudante_contador')
      OR EXISTS (
        SELECT 1 FROM obra_usuarios
        WHERE (obra_usuarios.obra_id)::text = (storage.foldername(objects.name))[1]
          AND obra_usuarios.usuario_id = auth.uid()
          AND obra_usuarios.activo = true
          AND obra_usuarios.rol_obra <> 'solo_lectura'
      )
    )
  );

-- (2) Ver/firmar URLs: contabilidad lee archivos de cualquier obra.
DROP POLICY IF EXISTS "evidencias: ver por obra" ON storage.objects;
CREATE POLICY "evidencias: ver por obra" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'evidencias'
    AND auth.uid() IS NOT NULL
    AND (
      (SELECT profiles.rol FROM profiles WHERE profiles.id = auth.uid())
        IN ('admin', 'contador', 'ayudante_contador')
      OR EXISTS (
        SELECT 1 FROM obra_usuarios
        WHERE (obra_usuarios.obra_id)::text = (storage.foldername(objects.name))[1]
          AND obra_usuarios.usuario_id = auth.uid()
          AND obra_usuarios.activo = true
      )
    )
  );

-- (3) Metadata: lo contable SOLO contabilidad + admin (+ el propio autor).
DROP POLICY IF EXISTS "evidencias: ver segun tipo" ON public.evidencias;
CREATE POLICY "evidencias: ver segun tipo" ON public.evidencias
  FOR SELECT TO authenticated
  USING (
    tipo_evidencia NOT IN ('bancarizacion', 'comprobante_captura', 'factura', 'recibo_honorarios', 'pago_evidencia')
    OR public.has_role(ARRAY['admin'::text, 'contador'::text, 'ayudante_contador'::text])
    OR subido_por = auth.uid()
    OR created_by = auth.uid()
  );

-- (4) FIX LATENTE de los especialistas (mismo modo de falla que el bug (1)):
-- la mig 131 agregó ing_ambiental/ing_calidad/ing_social al CHECK de
-- profiles.rol pero NO al de obra_usuarios.rol_obra (mig 103). Asignar una
-- obra a un especialista reventaba con check_violation (la UI propaga
-- rol_obra = rol del perfil) → sin fila en obra_usuarios, la policy de
-- Storage les bloqueaba subir las fotos de su reporte diario.
ALTER TABLE public.obra_usuarios DROP CONSTRAINT IF EXISTS obra_usuarios_rol_obra_check;
ALTER TABLE public.obra_usuarios ADD CONSTRAINT obra_usuarios_rol_obra_check CHECK (
  rol_obra = ANY (ARRAY[
    'admin','gerente','ingeniero_residente','ingeniero','supervisor','almacenero',
    'asistente_admin','contador','ayudante_contador','tesorero','jefe_compras','rrhh',
    'prevencionista','ing_ambiental','ing_calidad','ing_social','maestro_obra','solo_lectura'
  ]::text[])
);

NOTIFY pgrst, 'reload schema';
