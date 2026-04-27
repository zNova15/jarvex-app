-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Cronograma S10: dependencias entre partidas
-- ═══════════════════════════════════════════════════════════════════

-- partidas.duracion_dias — duración planificada del cronograma
-- partidas.predecesoras — string CSV con códigos de partidas predecesoras
--                         (ej "01.02,02.01.01") para futura ruta crítica
ALTER TABLE partidas
  ADD COLUMN IF NOT EXISTS duracion_dias INTEGER,
  ADD COLUMN IF NOT EXISTS predecesoras  TEXT;

-- materiales.codigo_s10 — código del catálogo S10 (ej "210020001")
-- Permite matchear inserciones desde "lista de insumos" sin duplicar.
ALTER TABLE materiales
  ADD COLUMN IF NOT EXISTS codigo_s10 TEXT;

CREATE INDEX IF NOT EXISTS idx_materiales_obra_codigo_s10
  ON materiales (obra_id, codigo_s10);

-- Vista actualizada de avance por partida que incorpora atraso vs cronograma.
-- Una partida está "atrasada" si fecha_fin_planificada < hoy y avance_reportado < 80%.
CREATE OR REPLACE VIEW v_partidas_estado_cronograma AS
SELECT
  p.id                                  AS partida_id,
  p.obra_id,
  p.codigo_delfin,
  p.nombre_partida,
  p.fecha_inicio_planificada,
  p.fecha_fin_planificada,
  p.duracion_dias,
  p.porcentaje_avance,
  p.estado,
  CASE
    WHEN p.fecha_fin_planificada IS NULL THEN 'sin_planificar'
    WHEN p.fecha_fin_planificada < CURRENT_DATE AND COALESCE(p.porcentaje_avance, 0) < 80
      THEN 'atrasada'
    WHEN p.fecha_inicio_planificada IS NOT NULL
      AND p.fecha_inicio_planificada > CURRENT_DATE
      THEN 'futura'
    WHEN p.fecha_inicio_planificada IS NOT NULL
      AND p.fecha_inicio_planificada <= CURRENT_DATE
      AND (p.fecha_fin_planificada IS NULL OR p.fecha_fin_planificada >= CURRENT_DATE)
      THEN 'en_curso'
    ELSE 'normal'
  END                                   AS estado_cronograma,
  CASE
    WHEN p.fecha_inicio_planificada IS NULL OR p.fecha_fin_planificada IS NULL THEN NULL
    WHEN CURRENT_DATE < p.fecha_inicio_planificada THEN 0
    WHEN CURRENT_DATE > p.fecha_fin_planificada THEN 100
    ELSE ROUND(
      (EXTRACT(EPOCH FROM (CURRENT_DATE - p.fecha_inicio_planificada))::numeric
       / NULLIF(EXTRACT(EPOCH FROM (p.fecha_fin_planificada - p.fecha_inicio_planificada))::numeric, 0))
      * 100, 1
    )
  END                                   AS avance_esperado_pct
FROM partidas p
WHERE p.deleted_at IS NULL;

GRANT SELECT ON v_partidas_estado_cronograma TO authenticated;
