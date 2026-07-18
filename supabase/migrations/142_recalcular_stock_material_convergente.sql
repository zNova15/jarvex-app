-- 142: recalcular_stock_material converge en vez de rechazar (fix 18-jul-2026).
--
-- Era el ÚNICO trigger de stock sin GREATEST(0, …): sus 3 hermanos (edición de
-- cantidad, soft-delete, retroceso) y TODOS los de EPP ya recortan en 0. Sin
-- el recorte, cuando una SALIDA llega al server antes que su ENTRADA (el orden
-- de llegada no está garantizado en una app offline-first), el UPDATE dejaba
-- el agregado negativo y el CHECK materiales_stock_actual_non_negative
-- rechazaba el movimiento PARA SIEMPRE con
--   "new row for relation materiales violates check constraint …"
-- (caso real: salidas de la almacenera rechazadas, 18-jul-2026).
--
-- Ahora: recorta en 0 igual que los demás triggers, y cuando detecta el
-- déficit deja una incidencia 'stock_conflicto' (best-effort, jamás bloquea)
-- para que el desorden de llegada quede visible y se corrija con
-- "Recalcular stocks" si la entrada nunca llega. El guard real contra salidas
-- inválidas es el candado cronológico del CLIENTE (lib/stock-cronologia).
CREATE OR REPLACE FUNCTION public.recalcular_stock_material()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_delta NUMERIC;
  v_stock NUMERIC;
BEGIN
  -- Determinar delta según tipo de movimiento
  v_delta := CASE NEW.tipo_movimiento
    WHEN 'entrada'    THEN  NEW.cantidad
    WHEN 'devolucion' THEN  NEW.cantidad
    WHEN 'salida'     THEN -NEW.cantidad
    WHEN 'merma'      THEN -NEW.cantidad
    WHEN 'ajuste'     THEN  NEW.cantidad   -- positivo = suma, negativo = resta
    ELSE 0
  END;

  -- Déficit transitorio (salida llegó antes que su entrada): incidencia visible.
  SELECT stock_actual INTO v_stock FROM materiales WHERE id = NEW.material_id;
  IF COALESCE(v_stock, 0) + v_delta < 0 THEN
    BEGIN
      INSERT INTO incidencias (
        obra_id, tipo_incidencia, severidad, modulo_origen,
        registro_origen_id, descripcion, creado_por
      ) VALUES (
        NEW.obra_id, 'stock_conflicto', 'alta', 'movimientos_materiales', NEW.id,
        format('Salida sincronizada con stock insuficiente en el server (material %s, faltan %s). Suele indicar que la ENTRADA correspondiente aún no llegó; si no se corrige solo, usar "Recalcular stocks".',
               NEW.material_id::text, abs(COALESCE(v_stock, 0) + v_delta)::text),
        NEW.created_by
      );
    EXCEPTION WHEN OTHERS THEN
      NULL; -- la incidencia jamás debe bloquear el movimiento
    END;
  END IF;

  UPDATE materiales
  SET
    stock_actual   = GREATEST(0, stock_actual + v_delta),
    total_entradas = total_entradas + CASE WHEN v_delta > 0 THEN v_delta ELSE 0 END,
    total_salidas  = total_salidas  + CASE WHEN v_delta < 0 THEN -v_delta ELSE 0 END,
    -- Actualizar precio promedio ponderado si es entrada con precio
    precio_unitario_real_prom = CASE
      WHEN NEW.tipo_movimiento IN ('entrada', 'devolucion') AND NEW.precio_unitario_real IS NOT NULL
      THEN (
        (COALESCE(precio_unitario_real_prom, 0) * GREATEST(stock_actual, 0) + NEW.precio_unitario_real * NEW.cantidad)
        / GREATEST(stock_actual + v_delta, 1)
      )
      ELSE precio_unitario_real_prom
    END,
    -- Actualizar alerta
    alerta = CASE
      WHEN (stock_actual + v_delta) <= 0 THEN 'sin_stock'
      WHEN (stock_actual + v_delta) <= stock_minimo * 0.5 THEN 'critico'
      WHEN (stock_actual + v_delta) <= stock_minimo THEN 'reponer'
      ELSE 'ok'
    END,
    updated_at = now()
  WHERE id = NEW.material_id;

  RETURN NEW;
END;
$function$;
