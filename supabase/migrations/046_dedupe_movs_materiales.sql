-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Limpieza de duplicados + prevención estructural
--
-- Origen: el almacenero reportó stocks ilógicos (ARENA GRUESA DE RÍO
-- con entrada 45 + salida 90 = stock 0 después de duplicados de
-- movimientos a las 10:48:00 exactas). 8 grupos de duplicados con
-- 13 movimientos extra a eliminar.
--
-- Esta migration:
--   1. Borra los movimientos duplicados (mantiene el primero por
--      created_at, hard delete porque son ficticios — el trigger de
--      stock ya sumó esos descuentos de más).
--   2. Agrega trigger AFTER DELETE que recalcula el stock cuando se
--      borra un movimiento (en general — útil para reversos también).
--   3. Recalcula stock_actual, total_entradas, total_salidas y alerta
--      de TODOS los materiales afectados desde el historial limpio.
--   4. Mismo tratamiento para movimientos_herramientas y movimientos_epp
--      por si tienen duplicados similares (defensivo).
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Trigger AFTER DELETE para retroceder el stock ──────────────
-- El trigger AFTER INSERT (recalcular_stock_material) ya suma/resta. Si
-- borramos un movimiento, hay que invertir su efecto. Si no, el stock
-- queda desincronizado contra el historial.
CREATE OR REPLACE FUNCTION public.retroceder_stock_material()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_delta NUMERIC;
BEGIN
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
$$;

DROP TRIGGER IF EXISTS trg_retroceder_stock_on_movimiento ON public.movimientos_materiales;
CREATE TRIGGER trg_retroceder_stock_on_movimiento
  AFTER DELETE ON public.movimientos_materiales
  FOR EACH ROW EXECUTE FUNCTION public.retroceder_stock_material();

-- ── 2. Limpieza de duplicados ──────────────────────────────────────
-- Política: dentro de cada grupo {material/fecha/hora/cantidad/tipo/obra},
-- conservar el más antiguo (created_at MIN) y borrar el resto.
-- Hard delete porque no son movs reales — son artefactos de double-click.
WITH dups AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY material_id, fecha, hora, cantidad, tipo_movimiento, obra_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM movimientos_materiales
  WHERE reversed_by_id IS NULL
)
DELETE FROM movimientos_materiales m
USING dups d
WHERE m.id = d.id AND d.rn > 1;

-- ── 3. Recalcular stock de TODOS los materiales desde el historial ──
-- Para garantizar consistencia tras el borrado masivo. El trigger AFTER
-- DELETE ya retrocede stock por cada fila borrada, pero hacemos un
-- recálculo desde cero como red de seguridad — si había drift previo,
-- aquí se corrige.
WITH historial AS (
  SELECT
    material_id,
    SUM(CASE
      WHEN tipo_movimiento IN ('entrada','devolucion') THEN cantidad
      WHEN tipo_movimiento IN ('salida','merma')       THEN -cantidad
      WHEN tipo_movimiento = 'ajuste'                  THEN cantidad
      ELSE 0
    END) AS stock_calc,
    SUM(CASE WHEN tipo_movimiento IN ('entrada','devolucion') THEN cantidad ELSE 0 END) AS tot_entradas,
    SUM(CASE WHEN tipo_movimiento IN ('salida','merma') THEN cantidad ELSE 0 END) AS tot_salidas
  FROM movimientos_materiales
  WHERE reversed_by_id IS NULL
  GROUP BY material_id
)
UPDATE materiales m
SET
  stock_actual = GREATEST(0, COALESCE(h.stock_calc, 0)),
  total_entradas = COALESCE(h.tot_entradas, 0),
  total_salidas = COALESCE(h.tot_salidas, 0),
  alerta = CASE
    WHEN GREATEST(0, COALESCE(h.stock_calc, 0)) <= 0 THEN 'sin_stock'
    WHEN m.stock_minimo > 0 AND COALESCE(h.stock_calc, 0) <= m.stock_minimo * 0.5 THEN 'critico'
    WHEN m.stock_minimo > 0 AND COALESCE(h.stock_calc, 0) <= m.stock_minimo THEN 'reponer'
    ELSE 'ok'
  END,
  updated_at = now()
FROM historial h
WHERE m.id = h.material_id;

-- Materiales sin ningún movimiento: stock = 0 (no aparecen en el LEFT JOIN)
UPDATE materiales SET stock_actual = 0, total_entradas = 0, total_salidas = 0
WHERE NOT EXISTS (SELECT 1 FROM movimientos_materiales mm WHERE mm.material_id = materiales.id);

-- ── 4. Tratamiento defensivo para movimientos_herramientas ─────────
-- Misma lógica: borrar duplicados exactos por {herramienta/fecha/hora/
-- cantidad/tipo/obra} si los hay.
WITH dups_h AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY herramienta_id, fecha, hora, cantidad, tipo_movimiento, obra_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM movimientos_herramientas
)
DELETE FROM movimientos_herramientas mh
USING dups_h d
WHERE mh.id = d.id AND d.rn > 1;

-- ── 5. Tratamiento defensivo para movimientos_epp si existe ────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='movimientos_epp') THEN
    EXECUTE $del$
      WITH dups_e AS (
        SELECT id,
          ROW_NUMBER() OVER (
            PARTITION BY epp_id, fecha, hora, cantidad, tipo_movimiento, obra_id, trabajador_id
            ORDER BY created_at ASC, id ASC
          ) AS rn
        FROM movimientos_epp
      )
      DELETE FROM movimientos_epp me
      USING dups_e d
      WHERE me.id = d.id AND d.rn > 1
    $del$;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.retroceder_stock_material() IS
  'Trigger AFTER DELETE en movimientos_materiales: retrocede el efecto del movimiento borrado sobre stock_actual del material. Indispensable para que el stock quede consistente tras limpieza de duplicados o reversos.';
