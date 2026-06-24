-- 099: revertir el ESTADO de una herramienta (disponible/ubicacion/responsable) al
-- soft-deletear un movimiento.
--
-- BUG: herramientas.disponible/ubicacion_actual/estado_actual son trigger-managed
-- (stripped). El server los setea con actualizar_disponibilidad_herramienta() en
-- AFTER INSERT, pero NO hay trigger en soft-delete → si se borra el ÚLTIMO movimiento
-- de una herramienta (p.ej. su única salida), queda congelada como 'en_uso'/no
-- disponible en el server para siempre (la reversión que hace la app en Dexie se
-- strippea). A diferencia de stock (acumulado), el estado depende del ÚLTIMO
-- movimiento vivo, así que el trigger RECOMPUTA desde él (no suma/resta delta).
-- (stock_actual de herramientas es app-managed — NO lo toca este trigger para no
-- chocar con el valor que pushea la app; solo se sana un drift puntual abajo.)

CREATE OR REPLACE FUNCTION public.ajustar_estado_herramienta_softdelete()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE v_last RECORD;
BEGIN
  -- solo en transición de deleted_at (soft-delete o restauración)
  IF NOT ((OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
       OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL)) THEN
    RETURN NEW;
  END IF;

  SELECT accion, responsable_id, fecha INTO v_last
  FROM movimientos_herramientas
  WHERE herramienta_id = NEW.herramienta_id AND deleted_at IS NULL
  ORDER BY fecha DESC, created_at DESC
  LIMIT 1;

  IF v_last.accion IS NULL THEN
    -- sin movimientos vivos → estado por defecto
    UPDATE herramientas
    SET disponible = true, ubicacion_actual = 'almacen', ultimo_responsable_id = NULL, updated_at = now()
    WHERE id = NEW.herramienta_id;
  ELSE
    -- mismo CASE que actualizar_disponibilidad_herramienta (el INSERT trigger)
    UPDATE herramientas
    SET disponible = (v_last.accion IN ('entrada','reposicion')),
        ubicacion_actual = CASE v_last.accion
          WHEN 'salida'        THEN 'en_uso'
          WHEN 'entrada'       THEN 'almacen'
          WHEN 'mantenimiento' THEN 'mantenimiento'
          WHEN 'baja'          THEN 'baja'
          WHEN 'reposicion'    THEN 'almacen'
          ELSE ubicacion_actual END,
        ultimo_responsable_id = v_last.responsable_id,
        fecha_ultimo_movimiento = v_last.fecha,
        updated_at = now()
    WHERE id = NEW.herramienta_id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_softdelete_estado_herramienta ON public.movimientos_herramientas;
CREATE TRIGGER trg_softdelete_estado_herramienta
  AFTER UPDATE OF deleted_at ON public.movimientos_herramientas
  FOR EACH ROW
  EXECUTE FUNCTION public.ajustar_estado_herramienta_softdelete();

-- ── HEAL puntual de stock_actual (app-managed, NO stripped → el set server-side
--    se propaga). Recomputa desde movimientos VIVOS con la fórmula del negocio
--    (entrada/reposicion +cantidad, salida -cantidad) y solo escribe donde difiere.
--    Corrige drift histórico (ej. "AMOLADORA METABO 7\"" quedó en 1, debe ser 0). ──
WITH vivos AS (
  SELECT herramienta_id,
    SUM(CASE accion WHEN 'entrada' THEN cantidad WHEN 'reposicion' THEN cantidad
                    WHEN 'salida' THEN -cantidad ELSE 0 END) AS delta
  FROM public.movimientos_herramientas WHERE deleted_at IS NULL GROUP BY herramienta_id
),
nv AS (
  SELECT h.id, GREATEST(0, COALESCE(h.stock_inicial,0) + COALESCE(v.delta,0)) AS stock_n
  FROM public.herramientas h LEFT JOIN vivos v ON v.herramienta_id = h.id
  WHERE h.deleted_at IS NULL
)
UPDATE public.herramientas hh
SET stock_actual = nv.stock_n, updated_at = now()
FROM nv
WHERE hh.id = nv.id AND ABS(COALESCE(hh.stock_actual,0) - nv.stock_n) > 0.001;
