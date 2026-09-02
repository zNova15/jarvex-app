-- ═══════════════════════════════════════════════════════════════════
-- 170 — Las funciones de TRIGGER salen de la API REST
--
-- El advisor marcaba que 5 funciones SECURITY DEFINER eran invocables por
-- anon/authenticated vía /rest/v1/rpc/<nombre>. Las cinco son funciones de
-- TRIGGER (retornan `trigger`, cada una atada a exactamente 1 trigger) y
-- ninguna se llama nunca desde la app:
--   asignar_creador_a_obra · crear_gastos_generales_obra · handle_new_user
--   protect_campo_password · protect_profile_rol
-- Las dos últimas son GUARDAS de seguridad (protegen el rol del profile y la
-- contraseña del portal de campo): que se pudieran invocar sueltas por REST
-- era justo lo contrario de su propósito.
--
-- Revocar EXECUTE NO las apaga: PostgreSQL chequea el privilegio al CREAR el
-- trigger, no al dispararlo. Verificado en producción con un INSERT de prueba
-- revertido: crear_gastos_generales_obra siguió creando el frente "Gastos
-- Generales" con el REVOKE ya aplicado.
--
-- NO se tocan las helpers de RLS (has_role, is_admin, current_user_rol,
-- user_has_access_to_obra, user_rol_in_obra): las políticas las llaman en
-- nombre del rol que consulta, así que necesitan EXECUTE sí o sí. Tampoco
-- admin_wipe_data / admin_set_campo_pin, que son RPC legítimas de admin con
-- su propio guard interno (ver mig 166).
-- ═══════════════════════════════════════════════════════════════════
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND pg_get_function_result(p.oid) = 'trigger'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated, public', f.sig);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
