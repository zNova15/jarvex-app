-- 096: el trigger actualizar_avance_partida() sumaba metrado_ejecutado SIN filtrar deleted_at
-- (la columna se agregó recién en mig 095). Al soft-deletear los avances iniciales duplicados
-- del re-import del Gantt, el trigger los seguía sumando -> inflaba porcentaje_avance/
-- metrado_ejecutado de la partida (01.02: 1.505 = 0.005+0.5+0.5+0.5 en vez de 0.5) y eso
-- chocaba con el valor correcto del cliente -> conflictos de sync. Además pisaba 'observado'.
-- Fix: filtrar deleted_at IS NULL + respetar 'observado'.
CREATE OR REPLACE FUNCTION public.actualizar_avance_partida()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE
  v_total_metrado NUMERIC;
  v_pct NUMERIC;
BEGIN
  SELECT COALESCE(SUM(metrado_ejecutado), 0) INTO v_total_metrado
  FROM avance_obra
  WHERE partida_id = NEW.partida_id AND deleted_at IS NULL;

  SELECT CASE
      WHEN metrado_contratado > 0
      THEN LEAST(ROUND((v_total_metrado / metrado_contratado) * 100, 2), 100)
      ELSE 0
    END
  INTO v_pct
  FROM partidas WHERE id = NEW.partida_id;

  UPDATE partidas SET
    metrado_ejecutado = v_total_metrado,
    porcentaje_avance = v_pct,
    estado = CASE
      WHEN estado = 'observado' THEN 'observado'
      WHEN v_pct >= 100 THEN 'terminado'
      WHEN v_pct > 0    THEN 'en_ejecucion'
      ELSE estado
    END,
    updated_at = now()
  WHERE id = NEW.partida_id;

  UPDATE obras o SET
    avance_fisico = (SELECT ROUND(AVG(p.porcentaje_avance), 2) FROM partidas p WHERE p.obra_id = o.id AND p.deleted_at IS NULL),
    updated_at = now()
  WHERE o.id = NEW.obra_id;
  RETURN NEW;
END;
$function$;

-- Recálculo one-time: corrige las partidas (que tienen avances) a partir de los avances NO
-- borrados, deshaciendo la inflación acumulada.
UPDATE partidas p SET
  metrado_ejecutado = sub.tot,
  porcentaje_avance = CASE WHEN p.metrado_contratado > 0 THEN LEAST(ROUND(sub.tot / p.metrado_contratado * 100, 2), 100) ELSE 0 END,
  estado = CASE
    WHEN p.estado = 'observado' THEN 'observado'
    WHEN p.metrado_contratado > 0 AND (sub.tot / p.metrado_contratado * 100) >= 100 THEN 'terminado'
    WHEN sub.tot > 0 THEN 'en_ejecucion'
    ELSE p.estado
  END,
  updated_at = now()
FROM (
  SELECT a.partida_id, COALESCE(SUM(a.metrado_ejecutado), 0) AS tot
  FROM avance_obra a WHERE a.deleted_at IS NULL GROUP BY a.partida_id
) sub
WHERE p.id = sub.partida_id AND p.deleted_at IS NULL;
