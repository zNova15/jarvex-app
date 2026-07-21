-- 145: trigger de ajuste de stock EPP al EDITAR la cantidad de un movimiento
-- (pedido 21-jul-2026 — PENDIENTE DE APLICAR cuando vuelva el conector MCP).
--
-- Contexto: la almacenera ahora puede SOLICITAR el cambio de cantidad de un
-- movimiento de EPP (RequestChangeModal en Entregas EPP) y el admin lo aprueba
-- desde Solicitudes. La aprobación actualiza movimientos_epp.cantidad, pero a
-- diferencia de materiales (ajustar_stock_material_update_cantidad, mig ~1xx)
-- movimientos_epp NO tenía trigger de edición → epps.stock_actual quedaba
-- desfasado en el server. Espejo exacto del de materiales.
CREATE OR REPLACE FUNCTION public.ajustar_stock_epp_update_cantidad()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE
  v_dcant NUMERIC;
  v_delta NUMERIC;
BEGIN
  IF NEW.deleted_at IS NOT NULL OR OLD.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.cantidad IS NOT DISTINCT FROM OLD.cantidad OR NEW.epp_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_dcant := COALESCE(NEW.cantidad, 0) - COALESCE(OLD.cantidad, 0);
  v_delta := CASE NEW.tipo_movimiento
    WHEN 'entrada'    THEN  v_dcant
    WHEN 'devolucion' THEN  v_dcant
    WHEN 'salida'     THEN -v_dcant
    WHEN 'merma'      THEN -v_dcant
    WHEN 'ajuste'     THEN  v_dcant
    ELSE 0 END;

  IF v_delta <> 0 THEN
    UPDATE epps
    SET
      stock_actual = GREATEST(0, COALESCE(stock_actual, 0) + v_delta),
      alerta = CASE
        WHEN GREATEST(0, COALESCE(stock_actual, 0) + v_delta) <= 0 THEN 'sin_stock'
        WHEN stock_minimo > 0 AND GREATEST(0, COALESCE(stock_actual, 0) + v_delta) <= stock_minimo * 0.5 THEN 'critico'
        WHEN stock_minimo > 0 AND GREATEST(0, COALESCE(stock_actual, 0) + v_delta) <= stock_minimo THEN 'reponer'
        ELSE 'ok'
      END,
      updated_at = now()
    WHERE id = NEW.epp_id;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_update_stock_epp_cantidad ON public.movimientos_epp;
CREATE TRIGGER trg_update_stock_epp_cantidad
  AFTER UPDATE ON public.movimientos_epp
  FOR EACH ROW EXECUTE FUNCTION public.ajustar_stock_epp_update_cantidad();
