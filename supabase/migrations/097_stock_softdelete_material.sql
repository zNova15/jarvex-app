-- 097: revertir el stock de materiales en el SOFT-DELETE de un movimiento.
--
-- BUG (raíz): materiales.stock_actual es trigger-managed (se strippea al pushear,
-- SyncEngine TRIGGER_MANAGED_FIELDS). El server lo mantiene con
-- recalcular_stock_material() en AFTER INSERT y retroceder_stock_material() en
-- AFTER DELETE (hard). Pero la app borra con SOFT-delete (UPDATE deleted_at), que
-- NO dispara ningún trigger de stock → eliminar un movimiento nunca revertía el
-- stock en el server. La reversión que hace la app en Dexie se strippea y nunca
-- llega. Resultado: drift permanente (ej. borrar una salida no devolvía su stock).
--
-- Fix: trigger en AFTER UPDATE OF deleted_at que revierte (soft-delete) o re-aplica
-- (restauración) el delta del movimiento, espejando recalcular/retroceder. Más un
-- heal de los materiales ya driftados y el cierre de un borrado aprobado que quedó
-- a medias (entrada de 750 de "MEDIANO AZUL CEMENTO PARA PVC RAIN").

-- ── 1) Guard en retroceder_stock_material: si la fila ya estaba soft-deleted,
--    su stock YA fue revertido por el trigger nuevo → no revertir de nuevo en un
--    hard-delete posterior (evita doble reversión). ──
CREATE OR REPLACE FUNCTION public.retroceder_stock_material()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE
  v_delta NUMERIC;
BEGIN
  -- Si el movimiento ya estaba soft-deleted, el stock ya se revirtió al borrarlo
  -- lógicamente; un hard-delete posterior no debe volver a tocarlo.
  IF OLD.deleted_at IS NOT NULL THEN
    RETURN OLD;
  END IF;

  v_delta := CASE OLD.tipo_movimiento
    WHEN 'entrada'    THEN -OLD.cantidad
    WHEN 'devolucion' THEN -OLD.cantidad
    WHEN 'salida'     THEN  OLD.cantidad
    WHEN 'merma'      THEN  OLD.cantidad
    WHEN 'ajuste'     THEN -OLD.cantidad
    ELSE 0
  END;

  UPDATE materiales
  SET
    stock_actual   = GREATEST(0, stock_actual + v_delta),
    total_entradas = GREATEST(0, total_entradas + CASE WHEN v_delta < 0 THEN v_delta ELSE 0 END),
    total_salidas  = GREATEST(0, total_salidas  + CASE WHEN v_delta > 0 THEN -v_delta ELSE 0 END),
    alerta = CASE
      WHEN (stock_actual + v_delta) <= 0 THEN 'sin_stock'
      WHEN stock_minimo > 0 AND (stock_actual + v_delta) <= stock_minimo * 0.5 THEN 'critico'
      WHEN stock_minimo > 0 AND (stock_actual + v_delta) <= stock_minimo THEN 'reponer'
      ELSE 'ok'
    END,
    updated_at = now()
  WHERE id = OLD.material_id;

  RETURN OLD;
END;
$function$;

-- ── 2) Trigger de soft-delete / restauración ──
CREATE OR REPLACE FUNCTION public.ajustar_stock_material_softdelete()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE
  v_sign  int := 0;   -- -1 = soft-delete (revertir), +1 = restaurar (re-aplicar)
  v_tipo  text;
  v_cant  NUMERIC;
  v_delta NUMERIC;
  v_ent   NUMERIC := 0;
  v_sal   NUMERIC := 0;
BEGIN
  IF (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
    v_sign := -1; v_tipo := OLD.tipo_movimiento; v_cant := COALESCE(OLD.cantidad, 0);
  ELSIF (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL) THEN
    v_sign := 1;  v_tipo := NEW.tipo_movimiento; v_cant := COALESCE(NEW.cantidad, 0);
  ELSE
    RETURN NEW;   -- no hubo transición de deleted_at
  END IF;

  -- delta de stock que aporta el movimiento cuando está ACTIVO
  v_delta := v_sign * (CASE v_tipo
    WHEN 'entrada'    THEN  v_cant
    WHEN 'devolucion' THEN  v_cant
    WHEN 'salida'     THEN -v_cant
    WHEN 'merma'      THEN -v_cant
    WHEN 'ajuste'     THEN  v_cant
    ELSE 0 END);
  v_ent := CASE WHEN v_tipo IN ('entrada','devolucion') THEN v_sign * v_cant ELSE 0 END;
  v_sal := CASE WHEN v_tipo IN ('salida','merma')       THEN v_sign * v_cant ELSE 0 END;

  IF v_delta <> 0 OR v_ent <> 0 OR v_sal <> 0 THEN
    UPDATE materiales
    SET
      stock_actual   = GREATEST(0, stock_actual + v_delta),
      total_entradas = GREATEST(0, total_entradas + v_ent),
      total_salidas  = GREATEST(0, total_salidas  + v_sal),
      alerta = CASE
        WHEN GREATEST(0, stock_actual + v_delta) <= 0 THEN 'sin_stock'
        WHEN stock_minimo > 0 AND GREATEST(0, stock_actual + v_delta) <= stock_minimo * 0.5 THEN 'critico'
        WHEN stock_minimo > 0 AND GREATEST(0, stock_actual + v_delta) <= stock_minimo THEN 'reponer'
        ELSE 'ok'
      END,
      updated_at = now()
    WHERE id = NEW.material_id;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_softdelete_stock_material ON public.movimientos_materiales;
CREATE TRIGGER trg_softdelete_stock_material
  AFTER UPDATE OF deleted_at ON public.movimientos_materiales
  FOR EACH ROW
  EXECUTE FUNCTION public.ajustar_stock_material_softdelete();

-- ── 3) Cerrar el borrado aprobado que quedó a medias: la entrada de 750 de
--    "MEDIANO AZUL CEMENTO PARA PVC RAIN" (solicitud aprobada, movimiento vivo).
--    El trigger nuevo revierte su stock al marcarla deleted_at. ──
UPDATE public.movimientos_materiales
SET deleted_at = now(), updated_at = now()
WHERE id = '32a689ea-8c8b-47e0-81ae-6a7ab2946c96' AND deleted_at IS NULL;

-- ── 4) Heal: recomputar stock_actual/total_entradas/total_salidas/alerta para
--    TODOS los materiales vivos a partir de sus movimientos VIVOS (+ stock_inicial),
--    pero solo escribir donde el valor realmente cambia (minimiza sync). Corrige el
--    drift acumulado por todos los soft-deletes pasados. ──
WITH vivos AS (
  SELECT material_id,
    SUM(CASE tipo_movimiento WHEN 'entrada' THEN cantidad WHEN 'devolucion' THEN cantidad
                             WHEN 'salida' THEN -cantidad WHEN 'merma' THEN -cantidad
                             WHEN 'ajuste' THEN cantidad ELSE 0 END) AS delta,
    SUM(CASE WHEN tipo_movimiento IN ('entrada','devolucion') THEN cantidad ELSE 0 END) AS entradas,
    SUM(CASE WHEN tipo_movimiento IN ('salida','merma') THEN cantidad ELSE 0 END) AS salidas
  FROM public.movimientos_materiales
  WHERE deleted_at IS NULL
  GROUP BY material_id
),
nv AS (
  SELECT m.id,
    GREATEST(0, COALESCE(m.stock_inicial,0) + COALESCE(v.delta,0)) AS stock_n,
    COALESCE(v.entradas,0) AS ent_n,
    COALESCE(v.salidas,0)  AS sal_n,
    m.stock_minimo AS smin
  FROM public.materiales m
  LEFT JOIN vivos v ON v.material_id = m.id
  WHERE m.deleted_at IS NULL
)
UPDATE public.materiales mat
SET
  stock_actual   = nv.stock_n,
  total_entradas = nv.ent_n,
  total_salidas  = nv.sal_n,
  alerta = CASE
    WHEN nv.stock_n <= 0 THEN 'sin_stock'
    WHEN nv.smin > 0 AND nv.stock_n <= nv.smin * 0.5 THEN 'critico'
    WHEN nv.smin > 0 AND nv.stock_n <= nv.smin THEN 'reponer'
    ELSE 'ok'
  END,
  updated_at = now()
FROM nv
WHERE mat.id = nv.id
  AND ( ABS(COALESCE(mat.stock_actual,0)   - nv.stock_n) > 0.001
     OR ABS(COALESCE(mat.total_entradas,0) - nv.ent_n)   > 0.001
     OR ABS(COALESCE(mat.total_salidas,0)  - nv.sal_n)   > 0.001 );
