-- 166 — Endurecimiento: admin_wipe_data() fuera del alcance de anon
--
-- El advisor de Supabase (1-sep) marcó que la función es SECURITY DEFINER y
-- ejecutable vía /rest/v1/rpc/admin_wipe_data por anon Y authenticated.
-- NO era un hueco abierto: la función verifica adentro que auth.uid() sea un
-- admin activo (anon tiene uid null → excepción). Pero es la función nuclear
-- (TRUNCATE CASCADE de ~50 tablas) y no hay razón para que un no-logueado
-- pueda siquiera invocarla y ejecutar el guard. Defensa en profundidad:
--
-- authenticated CONSERVA el EXECUTE a propósito: el "Reset de BD" legítimo de
-- Administración la llama con el JWT del admin y el guard interno decide.
REVOKE EXECUTE ON FUNCTION public.admin_wipe_data() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_wipe_data() FROM public;

NOTIFY pgrst, 'reload schema';
