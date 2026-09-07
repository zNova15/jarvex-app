-- ═══════════════════════════════════════════════════════════════════
-- 190 — Herramientas: el stock pasa a derivarse de los movimientos
--
-- CONTEXTO. Materiales y EPP llevan su contador EN EL SERVIDOR: cada
-- movimiento dispara un trigger que actualiza `stock_actual`, y el cliente
-- tiene ese campo en TRIGGER_MANAGED_FIELDS (no lo empuja; lo escribe local
-- solo para que la pantalla responda al instante). Herramientas era la
-- excepción: `movimientos_herramientas` no tenía NINGÚN trigger de stock
-- (solo disponibilidad y updated_at), así que el contador lo escribía y lo
-- EMPUJABA el cliente. Dos consecuencias:
--   • Dos dispositivos offline sobre la misma herramienta → last-write-wins
--     sobre un número ABSOLUTO: el que sincroniza último pisa al otro y el
--     contador queda desfasado del historial, sin rastro.
--   • Borrar, reversar o editar la cantidad de un movimiento en el servidor
--     no movía el contador (materiales y EPP sí tienen esos triggers desde
--     las migs 097/098).
--
-- VERIFICADO ANTES DE TOCAR NADA (7-sep-2026): las 86 herramientas vivas
-- CUADRAN — snapshot = historial en las 86, suma 114 = 114. La nota al pie de
-- la mig 188 decía "81 de 86 muestran historial negativo": ERA FALSO, salía de
-- una consulta que no mapeaba `tipo_movimiento = 'ingreso'` como entrada (el
-- 51% de los movimientos de la tabla). El código de la app siempre lo mapeó
-- bien (EFECTO en src/lib/stock-cronologia.js). No hay datos que reparar: esta
-- migración cierra el AGUJERO ESTRUCTURAL, no un descuadre.
--
-- DISEÑO: recálculo CONVERGENTE, no delta.
-- Materiales/EPP hacen `stock_actual = GREATEST(0, stock_actual + delta)`, y
-- por eso necesitan cuatro triggers (insert, update de cantidad, soft-delete,
-- reverso) y aun así el GREATEST se come los déficits para siempre (el caso
-- ZAPATOS 38 de la mig 188). Acá el trigger RECALCULA el saldo entero desde el
-- historial de esa herramienta. Es más simple y, sobre todo, más seguro:
--   • un solo trigger cubre alta, edición, borrado, restauración y reverso;
--   • es idempotente: si el mismo cálculo corre dos veces, da lo mismo;
--   • CONVERGE. Un cliente viejo (la PWA queda cacheada tras el deploy) que
--     siga empujando un `stock_actual` absoluto no rompe nada: el siguiente
--     movimiento vuelve a derivar el número del historial;
--   • sobre los datos de HOY es un no-op exacto (las 86 ya cuadran).
-- Costo: una suma sobre los movimientos de UNA herramienta por escritura —
-- hoy 206 movimientos en total, máximo 14 por herramienta. Se agrega el índice
-- por herramienta_id, que no existía.
--
-- La regla de signos es la MISMA del cliente (EFECTO): entrada/ingreso/
-- devolución/reposición/ajuste suman; salida/merma/baja restan; se excluyen
-- borrados, reversas y reversados. Y los niveles de alerta son los de
-- calcAlerta() (src/lib/stock-utils.js), no los del trigger de EPP —para que
-- servidor y cliente no se pisen con etiquetas distintas.
-- ═══════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_mov_herr_herramienta
  ON public.movimientos_herramientas (herramienta_id);

-- ── Saldo de una herramienta según su historial vivo ────────────────
-- Función aparte: la usan el trigger y el RPC de recálculo, así que la regla
-- de signos vive en UN solo lugar.
CREATE OR REPLACE FUNCTION public.saldo_herramienta(p_herramienta_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT COALESCE(SUM(
    CASE COALESCE(NULLIF(m.tipo_movimiento, ''), m.accion)
      WHEN 'entrada'    THEN  COALESCE(m.cantidad, 0)
      WHEN 'ingreso'    THEN  COALESCE(m.cantidad, 0)
      WHEN 'devolucion' THEN  COALESCE(m.cantidad, 0)
      WHEN 'reposicion' THEN  COALESCE(m.cantidad, 0)
      WHEN 'ajuste'     THEN  COALESCE(m.cantidad, 0)
      WHEN 'salida'     THEN -COALESCE(m.cantidad, 0)
      WHEN 'merma'      THEN -COALESCE(m.cantidad, 0)
      WHEN 'baja'       THEN -COALESCE(m.cantidad, 0)
      ELSE 0
    END), 0)
  FROM movimientos_herramientas m
  WHERE m.herramienta_id = p_herramienta_id
    AND m.deleted_at IS NULL
    AND m.reverses_id IS NULL
    AND m.reversed_by_id IS NULL;
$function$;

-- ── Trigger: el contador sigue al historial ─────────────────────────
-- SECURITY DEFINER a propósito: el trigger corre con los permisos de QUIEN
-- escribe el movimiento, y con el cerco de obra/módulo (migs 177/178) una
-- suma con RLS del invocante podría ver menos filas de las que hay y dejar el
-- contador CORTO. El contador no puede depender de quién registró la salida.
-- La función no acepta números de afuera —solo deriva del historial— y queda
-- revocada de la API al pie de esta migración.
CREATE OR REPLACE FUNCTION public.recalcular_stock_herramienta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_id   uuid;
  v_ids  uuid[];
  v_bal  numeric;
  v_min  numeric;
  v_new  numeric;
BEGIN
  -- Las dos puntas: si un UPDATE re-apunta el movimiento a otra herramienta
  -- (fusión de duplicados), hay que recalcular la vieja y la nueva.
  v_ids := ARRAY(
    SELECT DISTINCT x FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.herramienta_id END,
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.herramienta_id END
    ]) AS x WHERE x IS NOT NULL);

  FOREACH v_id IN ARRAY v_ids LOOP
    v_bal := public.saldo_herramienta(v_id);
    SELECT COALESCE(stock_minimo, 0) INTO v_min FROM herramientas WHERE id = v_id;
    v_new := GREATEST(0, v_bal);

    UPDATE herramientas SET
      stock_actual = v_new,
      -- Mismos niveles que calcAlerta() en el cliente.
      alerta = CASE
        WHEN COALESCE(v_min, 0) <= 0 THEN 'ok'
        WHEN v_new <= 0             THEN 'agotado'
        WHEN v_new <= v_min * 0.5   THEN 'critico'
        WHEN v_new <= v_min         THEN 'reponer'
        WHEN v_new <= v_min * 1.2   THEN 'cerca'
        ELSE 'ok' END,
      updated_at = now()
    WHERE id = v_id;

    -- Sobregiro: el saldo real quedó NEGATIVO y el GREATEST de arriba lo
    -- clampa en 0 — el déficit se perdería en silencio, que es exactamente
    -- cómo nació el caso ZAPATOS 38 (mig 188). Se deja la incidencia el día
    -- que ocurre, con el movimiento que la causó. Nunca bloquea el movimiento.
    IF TG_OP = 'INSERT' AND v_bal < 0 THEN
      BEGIN
        INSERT INTO incidencias (
          obra_id, tipo_incidencia, severidad, modulo_origen,
          registro_origen_id, descripcion, creado_por
        ) VALUES (
          NEW.obra_id, 'stock_conflicto', 'alta', 'movimientos_herramientas', NEW.id,
          format('Salida de herramienta sin stock que la respalde (herramienta %s, faltan %s). El contador se queda en 0 y el historial queda por debajo: suele ser una salida duplicada o un ingreso que nunca se registró. Revisar el historial de la herramienta antes de seguir descontando.',
                 NEW.herramienta_id::text, abs(v_bal)::text),
          NEW.created_by
        );
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
  END LOOP;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

DROP TRIGGER IF EXISTS trg_recalcular_stock_herramienta ON public.movimientos_herramientas;
CREATE TRIGGER trg_recalcular_stock_herramienta
  AFTER INSERT OR UPDATE OR DELETE ON public.movimientos_herramientas
  FOR EACH ROW EXECUTE FUNCTION public.recalcular_stock_herramienta();

-- ── RPC de recálculo masivo (botón "Recalcular stocks") ─────────────
-- Espejo de recalcular_stock_obra (mig 150) para herramientas. SECURITY
-- DEFINER: la almacenera puede corregir el contador aunque su RLS no le
-- permita UPDATE directo de herramientas — la función solo DERIVA del
-- historial, no acepta números de afuera.
--
-- Solo toca herramientas QUE TIENEN movimientos. Una herramienta importada
-- con stock inicial y sin historial quedaría en 0 (mismo criterio que el RPC
-- de materiales).
CREATE OR REPLACE FUNCTION public.recalcular_stock_herramientas_obra(p_obra_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE n integer := 0;
BEGIN
  WITH sums AS (
    SELECT m.herramienta_id AS hid,
           SUM(CASE COALESCE(NULLIF(m.tipo_movimiento, ''), m.accion)
             WHEN 'entrada'    THEN  COALESCE(m.cantidad, 0)
             WHEN 'ingreso'    THEN  COALESCE(m.cantidad, 0)
             WHEN 'devolucion' THEN  COALESCE(m.cantidad, 0)
             WHEN 'reposicion' THEN  COALESCE(m.cantidad, 0)
             WHEN 'ajuste'     THEN  COALESCE(m.cantidad, 0)
             WHEN 'salida'     THEN -COALESCE(m.cantidad, 0)
             WHEN 'merma'      THEN -COALESCE(m.cantidad, 0)
             WHEN 'baja'       THEN -COALESCE(m.cantidad, 0)
             ELSE 0 END) AS bal
    FROM movimientos_herramientas m
    WHERE m.obra_id = p_obra_id
      AND m.deleted_at IS NULL
      AND m.reverses_id IS NULL
      AND m.reversed_by_id IS NULL
    GROUP BY m.herramienta_id
  ),
  upd AS (
    UPDATE herramientas h
    SET stock_actual = GREATEST(0, COALESCE(s.bal, 0)),
        alerta = CASE
          WHEN COALESCE(h.stock_minimo, 0) <= 0 THEN 'ok'
          WHEN GREATEST(0, COALESCE(s.bal, 0)) <= 0 THEN 'agotado'
          WHEN GREATEST(0, COALESCE(s.bal, 0)) <= h.stock_minimo * 0.5 THEN 'critico'
          WHEN GREATEST(0, COALESCE(s.bal, 0)) <= h.stock_minimo THEN 'reponer'
          WHEN GREATEST(0, COALESCE(s.bal, 0)) <= h.stock_minimo * 1.2 THEN 'cerca'
          ELSE 'ok' END,
        updated_at = now()
    FROM sums s
    WHERE h.id = s.hid
      AND h.obra_id = p_obra_id
      AND h.deleted_at IS NULL
      AND h.stock_actual IS DISTINCT FROM GREATEST(0, COALESCE(s.bal, 0))
    RETURNING 1
  )
  SELECT count(*) INTO n FROM upd;
  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.recalcular_stock_herramienta() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalcular_stock_herramientas_obra(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
