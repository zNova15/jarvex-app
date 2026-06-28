-- ═══════════════════════════════════════════════════════════════════
-- 112 — Trigger de stock al EDITAR la cantidad de un movimiento de materiales.
--
-- Contexto: el stock de `materiales` lo mantiene el server por deltas:
--   · AFTER INSERT  → recalcular_stock_material      (suma/resta la cantidad)
--   · AFTER DELETE  → retroceder_stock_material      (la deshace)
--   · UPDATE deleted_at → ajustar_stock_material_softdelete (la deshace/rehace)
-- Pero NO había trigger para UPDATE de `cantidad`. Como `materiales` es master
-- table (el pull la baja con bulkPut y `stock_actual` se strippea del push),
-- editar la cantidad de un movimiento ajustaba el stock SOLO en el Dexie local,
-- y al re-sincronizar el server (con stock viejo) lo sobreescribía → el stock
-- quedaba mal. Afectaba al "editar cantidad" del Super Admin y bloqueaba poder
-- aprobar solicitudes de cambio de cantidad del almacenero de forma automática.
--
-- Fix: trigger AFTER UPDATE OF cantidad que aplica el delta (NEW-OLD) al stock
-- con el mismo signo por tipo de movimiento que los demás triggers. Guarda:
--   · solo filas activas (los cambios de deleted_at los maneja el softdelete).
--   · no-op si la cantidad no cambió (protege de updates de fila completa que
--     incluyen `cantidad` en el SET sin cambiarla — el cliente pushea todo).
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ajustar_stock_material_update_cantidad()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_dcant NUMERIC;          -- NEW.cantidad - OLD.cantidad
  v_delta NUMERIC;          -- efecto con signo sobre stock_actual
  v_ent   NUMERIC := 0;
  v_sal   NUMERIC := 0;
BEGIN
  -- Solo filas activas; deleted_at lo gobierna ajustar_stock_material_softdelete.
  IF NEW.deleted_at IS NOT NULL OR OLD.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- Sin cambio real de cantidad → nada que hacer (el cliente puede pushear la
  -- fila completa con `cantidad` igual).
  IF NEW.cantidad IS NOT DISTINCT FROM OLD.cantidad OR NEW.material_id IS NULL THEN
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
  v_ent := CASE WHEN NEW.tipo_movimiento IN ('entrada','devolucion') THEN v_dcant ELSE 0 END;
  v_sal := CASE WHEN NEW.tipo_movimiento IN ('salida','merma')       THEN v_dcant ELSE 0 END;

  IF v_delta <> 0 OR v_ent <> 0 OR v_sal <> 0 THEN
    UPDATE materiales
    SET
      stock_actual   = GREATEST(0, COALESCE(stock_actual, 0)   + v_delta),
      total_entradas = GREATEST(0, COALESCE(total_entradas, 0) + v_ent),
      total_salidas  = GREATEST(0, COALESCE(total_salidas, 0)  + v_sal),
      alerta = CASE
        WHEN GREATEST(0, COALESCE(stock_actual, 0) + v_delta) <= 0 THEN 'sin_stock'
        WHEN stock_minimo > 0 AND GREATEST(0, COALESCE(stock_actual, 0) + v_delta) <= stock_minimo * 0.5 THEN 'critico'
        WHEN stock_minimo > 0 AND GREATEST(0, COALESCE(stock_actual, 0) + v_delta) <= stock_minimo THEN 'reponer'
        ELSE 'ok'
      END,
      updated_at = now()
    WHERE id = NEW.material_id;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_update_stock_material_cantidad ON public.movimientos_materiales;
CREATE TRIGGER trg_update_stock_material_cantidad
AFTER UPDATE OF cantidad ON public.movimientos_materiales
FOR EACH ROW EXECUTE FUNCTION public.ajustar_stock_material_update_cantidad();
