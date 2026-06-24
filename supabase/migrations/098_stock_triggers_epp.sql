-- 098: stock server-side para EPP (estaba roto: stock_actual stripped sin triggers).
--
-- BUG: epps.stock_actual está en SyncEngine TRIGGER_MANAGED_FIELDS (se strippea al
-- pushear) PERO movimientos_epp NO tenía NINGÚN trigger de stock → el server nunca
-- recalculó el stock de EPP: quedó CONGELADO en 0 para los 49 items (19 con stock
-- real >0, ej. TAPA OIDOS deb. 25, GUANTES deb. 20). La reversión que hace la app en
-- Dexie se strippea y nunca llega. Mismo modelo que materiales pero faltaba TODA la
-- suite de triggers (no solo el de soft-delete).
--
-- Fix: triggers INSERT (suma delta) + soft-delete/restauración + hard-delete (con
-- guard) sobre movimientos_epp, espejando materiales (mig 097). epps tiene CHECK
-- stock_actual >= 0 → GREATEST(0,...). epps NO tiene total_entradas/total_salidas
-- (esas claves en TRIGGER_MANAGED_FIELDS.epps son fantasma), así que solo tocamos
-- stock_actual + alerta. Luego HEAL recomputando desde los movimientos vivos.

-- ── 1) INSERT: sumar el delta del movimiento ──
CREATE OR REPLACE FUNCTION public.recalcular_stock_epp()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE v_delta NUMERIC;
BEGIN
  v_delta := CASE NEW.tipo_movimiento
    WHEN 'entrada' THEN NEW.cantidad WHEN 'devolucion' THEN NEW.cantidad
    WHEN 'salida' THEN -NEW.cantidad WHEN 'merma' THEN -NEW.cantidad
    WHEN 'ajuste' THEN NEW.cantidad ELSE 0 END;
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

-- ── 2) Hard-DELETE: revertir el delta (con guard si ya estaba soft-deleted) ──
CREATE OR REPLACE FUNCTION public.retroceder_stock_epp()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE v_delta NUMERIC;
BEGIN
  IF OLD.deleted_at IS NOT NULL THEN RETURN OLD; END IF;
  v_delta := CASE OLD.tipo_movimiento
    WHEN 'entrada' THEN -OLD.cantidad WHEN 'devolucion' THEN -OLD.cantidad
    WHEN 'salida' THEN OLD.cantidad WHEN 'merma' THEN OLD.cantidad
    WHEN 'ajuste' THEN -OLD.cantidad ELSE 0 END;
  UPDATE epps SET
    stock_actual = GREATEST(0, stock_actual + v_delta),
    alerta = CASE
      WHEN GREATEST(0, stock_actual + v_delta) <= 0 THEN 'sin_stock'
      WHEN stock_minimo > 0 AND GREATEST(0, stock_actual + v_delta) <= stock_minimo * 0.5 THEN 'critico'
      WHEN stock_minimo > 0 AND GREATEST(0, stock_actual + v_delta) <= stock_minimo THEN 'reponer'
      ELSE 'ok' END,
    updated_at = now()
  WHERE id = OLD.epp_id;
  RETURN OLD;
END;
$function$;

-- ── 3) Soft-delete / restauración ──
CREATE OR REPLACE FUNCTION public.ajustar_stock_epp_softdelete()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE v_sign int := 0; v_tipo text; v_cant NUMERIC; v_delta NUMERIC;
BEGIN
  IF (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
    v_sign := -1; v_tipo := OLD.tipo_movimiento; v_cant := COALESCE(OLD.cantidad,0);
  ELSIF (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL) THEN
    v_sign := 1;  v_tipo := NEW.tipo_movimiento; v_cant := COALESCE(NEW.cantidad,0);
  ELSE
    RETURN NEW;
  END IF;
  v_delta := v_sign * (CASE v_tipo
    WHEN 'entrada' THEN v_cant WHEN 'devolucion' THEN v_cant
    WHEN 'salida' THEN -v_cant WHEN 'merma' THEN -v_cant
    WHEN 'ajuste' THEN v_cant ELSE 0 END);
  IF v_delta <> 0 THEN
    UPDATE epps SET
      stock_actual = GREATEST(0, stock_actual + v_delta),
      alerta = CASE
        WHEN GREATEST(0, stock_actual + v_delta) <= 0 THEN 'sin_stock'
        WHEN stock_minimo > 0 AND GREATEST(0, stock_actual + v_delta) <= stock_minimo * 0.5 THEN 'critico'
        WHEN stock_minimo > 0 AND GREATEST(0, stock_actual + v_delta) <= stock_minimo THEN 'reponer'
        ELSE 'ok' END,
      updated_at = now()
    WHERE id = NEW.epp_id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_update_stock_on_mov_epp ON public.movimientos_epp;
CREATE TRIGGER trg_update_stock_on_mov_epp
  AFTER INSERT ON public.movimientos_epp FOR EACH ROW
  EXECUTE FUNCTION public.recalcular_stock_epp();

DROP TRIGGER IF EXISTS trg_retroceder_stock_epp ON public.movimientos_epp;
CREATE TRIGGER trg_retroceder_stock_epp
  AFTER DELETE ON public.movimientos_epp FOR EACH ROW
  EXECUTE FUNCTION public.retroceder_stock_epp();

DROP TRIGGER IF EXISTS trg_softdelete_stock_epp ON public.movimientos_epp;
CREATE TRIGGER trg_softdelete_stock_epp
  AFTER UPDATE OF deleted_at ON public.movimientos_epp FOR EACH ROW
  EXECUTE FUNCTION public.ajustar_stock_epp_softdelete();

-- ── 4) HEAL: recomputar stock_actual + alerta de TODOS los EPP desde sus
--    movimientos VIVOS (+ stock_inicial). Corrige los 19 drifts (stock congelado). ──
WITH vivos AS (
  SELECT epp_id,
    SUM(CASE tipo_movimiento WHEN 'entrada' THEN cantidad WHEN 'devolucion' THEN cantidad
                             WHEN 'salida' THEN -cantidad WHEN 'merma' THEN -cantidad
                             WHEN 'ajuste' THEN cantidad ELSE 0 END) AS delta
  FROM public.movimientos_epp WHERE deleted_at IS NULL GROUP BY epp_id
),
nv AS (
  SELECT e.id, GREATEST(0, COALESCE(e.stock_inicial,0) + COALESCE(v.delta,0)) AS stock_n, e.stock_minimo AS smin
  FROM public.epps e LEFT JOIN vivos v ON v.epp_id = e.id
  WHERE e.deleted_at IS NULL
)
UPDATE public.epps ep
SET stock_actual = nv.stock_n,
    alerta = CASE
      WHEN nv.stock_n <= 0 THEN 'sin_stock'
      WHEN nv.smin > 0 AND nv.stock_n <= nv.smin * 0.5 THEN 'critico'
      WHEN nv.smin > 0 AND nv.stock_n <= nv.smin THEN 'reponer'
      ELSE 'ok' END,
    updated_at = now()
FROM nv
WHERE ep.id = nv.id
  AND ( ABS(COALESCE(ep.stock_actual,0) - nv.stock_n) > 0.001 OR ep.alerta IS DISTINCT FROM (CASE
      WHEN nv.stock_n <= 0 THEN 'sin_stock'
      WHEN nv.smin > 0 AND nv.stock_n <= nv.smin * 0.5 THEN 'critico'
      WHEN nv.smin > 0 AND nv.stock_n <= nv.smin THEN 'reponer'
      ELSE 'ok' END) );
