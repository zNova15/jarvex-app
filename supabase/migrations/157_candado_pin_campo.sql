-- 157 — CANDADO del PIN de la cuenta de campo (hallazgo de Gabriel, 31-ago):
-- "Mi Perfil → Cambiar mi contraseña" usa el self-service de Supabase Auth
-- (auth/v1/user), que la RLS NO gobierna → cualquier peón con el PIN podía
-- cambiarlo y dejar fuera al resto del personal. La UI ya oculta Mi Perfil
-- para el rol campo, pero eso no frena una llamada directa a la API.
--
-- Solución en dos piezas:
--  1) Trigger BEFORE UPDATE en auth.users: si cambia encrypted_password de
--     campo@jarvex.pe SIN el permiso transaccional → EXCEPTION. El login
--     (last_sign_in_at) y demás updates no tocan la contraseña → pasan.
--  2) RPC admin_set_campo_pin(new_pin): SOLO service_role la ejecuta (la usa
--     el endpoint admin-gated /api/create-user). Valida ^\d{6,8}$, abre el
--     candado SOLO dentro de su transacción (set_config local) y actualiza.
-- Nota: un UPDATE manual en el SQL Editor ahora también rebota — es a
-- propósito; el camino oficial es el panel ⚙️ del portal.

CREATE OR REPLACE FUNCTION public.protect_campo_password()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.email = 'campo@jarvex.pe'
     AND NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password
     AND coalesce(current_setting('app.campo_pin_ok', true), '') <> '1' THEN
    RAISE EXCEPTION 'El PIN de la cuenta de campo solo lo cambia el administrador desde el panel del portal'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protect_campo_password_trigger ON auth.users;
CREATE TRIGGER protect_campo_password_trigger
  BEFORE UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.protect_campo_password();

CREATE OR REPLACE FUNCTION public.admin_set_campo_pin(new_pin text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
BEGIN
  IF new_pin !~ '^\d{6,8}$' THEN
    RAISE EXCEPTION 'PIN inválido: debe ser numérico de 6 a 8 dígitos';
  END IF;
  PERFORM set_config('app.campo_pin_ok', '1', true);   -- candado abierto SOLO en esta transacción
  UPDATE auth.users
     SET encrypted_password = extensions.crypt(new_pin, extensions.gen_salt('bf')),
         updated_at = now()
   WHERE email = 'campo@jarvex.pe';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta campo@jarvex.pe no existe';
  END IF;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.admin_set_campo_pin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_campo_pin(text) FROM anon;
REVOKE ALL ON FUNCTION public.admin_set_campo_pin(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_campo_pin(text) TO service_role;

NOTIFY pgrst, 'reload schema';
