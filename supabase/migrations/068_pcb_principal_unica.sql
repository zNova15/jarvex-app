-- 068: Una sola cuenta PRINCIPAL por trabajador (server-side).
--
-- El cliente ya desmarca las otras principales al guardar, pero con varios
-- dispositivos offline el invariante puede divergir. Este trigger lo hace
-- converger en el server: cuando una cuenta queda principal=true, las demás
-- del mismo trabajador pasan a false. (No recursa: el UPDATE interno setea
-- principal=false, que no dispara la condición WHEN del trigger. No bumpea
-- `version` a propósito — así no rompe el optimistic concurrency del cliente;
-- el cambio llega a los clientes por el pull full de la tabla maestra.)

CREATE OR REPLACE FUNCTION public.pcb_principal_unica()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.personal_cuentas_bancarias
  SET principal = false
  WHERE personal_id = NEW.personal_id
    AND id <> NEW.id
    AND principal = true
    AND deleted_at IS NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pcb_principal_unica ON public.personal_cuentas_bancarias;
CREATE TRIGGER trg_pcb_principal_unica
  AFTER INSERT OR UPDATE OF principal ON public.personal_cuentas_bancarias
  FOR EACH ROW
  WHEN (NEW.principal = true)
  EXECUTE FUNCTION public.pcb_principal_unica();

NOTIFY pgrst, 'reload schema';
