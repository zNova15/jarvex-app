-- 158 — Portal de campo SIMPLE + PIN de 4-8 dígitos (pedido de Gabriel, 31-ago).
--
-- 1) El portal ya NO pide obra (la asigna contabilidad al registrar en Captura
--    Mágica) → las fotos de campo van a la carpeta fija 'captura-campo/' del
--    bucket. La política "subir por obra" (104) exige que la carpeta sea una
--    obra del usuario → los usuarios reales del atajo (ingenieros, almacenera)
--    quedarían bloqueados. Permisiva nueva SOLO para esa carpeta (la fila de
--    evidencias sigue gobernada por su propia RLS; esta carpeta solo recibe
--    fotos de comprobantes de campo).
DROP POLICY IF EXISTS "evidencias storage: carpeta captura-campo" ON storage.objects;
CREATE POLICY "evidencias storage: carpeta captura-campo" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'evidencias'
    AND (storage.foldername(name))[1] = 'captura-campo'
    AND auth.uid() IS NOT NULL
  );

-- 2) PIN de 4 a 8 dígitos ("me dijeron si puede ser de 4 para mayor rapidez").
--    Posible porque este RPC escribe el hash DIRECTO (no pasa por la política
--    de largo mínimo de GoTrue) y el login solo verifica el hash. Riesgo
--    conocido y aceptado: 4 dígitos = 10,000 combinaciones (rate-limit de
--    Supabase lo frena; el cerco limita el botín a subir fotos; rotación al
--    despedir personal). El candado del trigger (mig 157) sigue intacto.
CREATE OR REPLACE FUNCTION public.admin_set_campo_pin(new_pin text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
BEGIN
  IF new_pin !~ '^\d{4,8}$' THEN
    RAISE EXCEPTION 'PIN inválido: debe ser numérico de 4 a 8 dígitos';
  END IF;
  PERFORM set_config('app.campo_pin_ok', '1', true);
  UPDATE auth.users
     SET encrypted_password = extensions.crypt(new_pin, extensions.gen_salt('bf')),
         updated_at = now()
   WHERE email = 'campo@jarvex.pe';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta campo@jarvex.pe no existe';
  END IF;
  RETURN true;
END $$;

NOTIFY pgrst, 'reload schema';
