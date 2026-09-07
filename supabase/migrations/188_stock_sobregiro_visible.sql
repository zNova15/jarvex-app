-- ═══════════════════════════════════════════════════════════════════
-- 188 — El sobregiro de stock de EPP deja de perderse en silencio
--
-- Reporte de la almacenera (7-sep-2026): «registré zapatos de talla 38, eso fue
-- ingreso, pero para registrar la salida me sale que no hay stock».
--
-- Diagnóstico. Los triggers que mantienen el contador denormalizado hacen
--   stock_actual = GREATEST(0, stock_actual + delta)
-- Ese GREATEST evita que el contador quede negativo, pero DESTRUYE el déficit:
-- cuando entra una salida que el stock no alcanza a cubrir, la diferencia se
-- pierde y el contador queda por ENCIMA del historial para siempre.
--
-- Caso real ZAPATOS 38: el 13-jul se registraron 3 salidas duplicadas por
-- multi-click (misma trabajadora, mismo día, 200 ms entre sí — el guard
-- síncrono anti-doble-click recién se agregó el 22-jul). El historial bajó a
-- −1 y el contador se clampó en 0. El 5-sep ingresó 1 par: contador 1,
-- historial 0. La pantalla de EPPs calculaba el stock desde los movimientos,
-- veía 0 y bloqueaba la salida del par que estaba físicamente en el almacén.
--
-- `movimientos_materiales` ya registraba una incidencia al detectar el déficit
-- (recalcular_stock_material). Los EPP no: ahí el descuadre nacía
-- mudo. Esta migración les pone la MISMA señal, de modo que a partir de ahora
-- cada sobregiro quede documentado el día que ocurre, con su movimiento.
--
-- No toca ni un dato existente: solo agrega la incidencia. El GREATEST se
-- mantiene a propósito (un contador negativo rompería alertas y reportes); lo
-- que cambia es que deja rastro. El lado cliente ya sabe leer esa huella
-- (src/lib/stock-conciliacion.js → diagnosticoStock).
-- ═══════════════════════════════════════════════════════════════════

-- ── EPPs ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recalcular_stock_epp()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_delta NUMERIC;
  v_stock NUMERIC;
BEGIN
  v_delta := CASE NEW.tipo_movimiento
    WHEN 'entrada' THEN NEW.cantidad WHEN 'devolucion' THEN NEW.cantidad
    WHEN 'salida' THEN -NEW.cantidad WHEN 'merma' THEN -NEW.cantidad
    WHEN 'ajuste' THEN NEW.cantidad ELSE 0 END;

  -- Sobregiro: el GREATEST de abajo se va a comer este déficit. Dejarlo
  -- anotado ANTES, con el movimiento que lo causó, para que el descuadre
  -- tenga fecha y culpable en vez de aparecer meses después como
  -- "el sistema dice que no hay stock".
  SELECT stock_actual INTO v_stock FROM epps WHERE id = NEW.epp_id;
  IF COALESCE(v_stock, 0) + v_delta < 0 THEN
    BEGIN
      INSERT INTO incidencias (
        obra_id, tipo_incidencia, severidad, modulo_origen,
        registro_origen_id, descripcion, creado_por
      ) VALUES (
        NEW.obra_id, 'stock_conflicto', 'alta', 'movimientos_epp', NEW.id,
        format('Salida de EPP sin stock que la respalde (EPP %s, faltan %s). El contador se queda en 0 y el historial queda por debajo: suele ser una salida duplicada o un ingreso que nunca se registró. Revisar el historial del EPP antes de seguir descontando.',
               NEW.epp_id::text, abs(COALESCE(v_stock, 0) + v_delta)::text),
        NEW.created_by
      );
    EXCEPTION WHEN OTHERS THEN
      NULL; -- la incidencia jamás debe bloquear el movimiento
    END;
  END IF;

  UPDATE epps SET
    stock_actual = GREATEST(0, stock_actual + v_delta),
    alerta = CASE
      WHEN GREATEST(0, stock_actual + v_delta) <= 0 THEN 'sin_stock'
      WHEN stock_minimo > 0 AND GREATEST(0, stock_actual + v_delta) <= stock_minimo * 0.5 THEN 'critico'
      WHEN stock_minimo > 0 AND GREATEST(0, stock_actual + v_delta) <= stock_minimo THEN 'reponer'
      ELSE 'ok' END,
    updated_at = now()
  WHERE id = NEW.epp_id;
  RETURN NEW;
END;
$function$;

-- ── Herramientas: NO aplica (verificado el 7-sep-2026) ──────────────
-- `movimientos_herramientas` no tiene ningún trigger que toque stock_actual:
-- sus únicos triggers son de updated_at y de disponibilidad. El contador de
-- herramientas lo escribe el CLIENTE, y el alta carga stock_actual directo sin
-- movimiento de entrada que lo respalde. Por eso 81 de 86 herramientas vivas
-- muestran historial negativo: no es pérdida de datos, es que ese módulo nunca
-- llevó el stock por movimientos. Unificarlo es trabajo aparte (tanda propia):
-- tocarlo acá, sin el alta que genere su entrada inicial, dejaría el inventario
-- de herramientas en cero.
