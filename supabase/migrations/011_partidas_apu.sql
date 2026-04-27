-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Partidas (APU S10) — enriquecimiento jerárquico y tracking
-- ═══════════════════════════════════════════════════════════════════

-- partidas: agregar campos para el árbol jerárquico
ALTER TABLE partidas
  ADD COLUMN IF NOT EXISTS nivel         INTEGER,        -- profundidad (1 para "01", 2 para "01.02", etc.)
  ADD COLUMN IF NOT EXISTS parent_codigo TEXT,           -- código del padre ("02.01.01.01.02" → padre "02.01.01.01")
  ADD COLUMN IF NOT EXISTS orden         INTEGER;        -- orden de aparición en el presupuesto (estable)

CREATE INDEX IF NOT EXISTS idx_partidas_obra_codigo  ON partidas (obra_id, codigo_delfin);
CREATE INDEX IF NOT EXISTS idx_partidas_obra_parent  ON partidas (obra_id, parent_codigo);
CREATE INDEX IF NOT EXISTS idx_partidas_obra_orden   ON partidas (obra_id, orden);

-- insumos_partida: agregar el código S10 del recurso (ej "210020001" para CEMENTO)
-- y un campo de notas para registrar discrepancias
ALTER TABLE insumos_partida
  ADD COLUMN IF NOT EXISTS insumo_codigo TEXT,
  ADD COLUMN IF NOT EXISTS notas         TEXT;

CREATE INDEX IF NOT EXISTS idx_insumos_partida_obra_codigo
  ON insumos_partida (obra_id, insumo_codigo);

-- Vista helper: avance estimado por partida basado en consumo de insumos críticos.
-- Toma el insumo material con MAYOR % de consumo (cap 100%) como proxy del avance físico.
-- Esto sirve para el indicador "Avance estimado por consumo".
CREATE OR REPLACE VIEW v_partidas_avance_consumo AS
SELECT
  p.id                                  AS partida_id,
  p.obra_id,
  p.codigo_delfin,
  p.nombre_partida,
  p.unidad,
  p.metrado_contratado,
  p.costo_total_presupuestado,
  p.costo_real_acumulado,
  COALESCE(
    (
      SELECT LEAST(100, MAX(
        CASE
          WHEN ip.cantidad_presupuestada IS NOT NULL AND ip.cantidad_presupuestada > 0
            THEN (COALESCE(ip.cantidad_real_usada, 0) / ip.cantidad_presupuestada) * 100
          ELSE 0
        END
      ))
      FROM insumos_partida ip
      WHERE ip.partida_id = p.id
        AND ip.tipo_insumo = 'material'
        AND ip.cantidad_presupuestada > 0
    ),
    0
  )                                     AS avance_consumo_pct,
  CASE
    WHEN p.costo_total_presupuestado IS NULL OR p.costo_total_presupuestado = 0 THEN 0
    ELSE LEAST(100, (COALESCE(p.costo_real_acumulado, 0) / p.costo_total_presupuestado) * 100)
  END                                   AS avance_financiero_pct,
  p.porcentaje_avance                   AS avance_reportado_pct
FROM partidas p
WHERE p.deleted_at IS NULL;

GRANT SELECT ON v_partidas_avance_consumo TO authenticated;

-- KPI global: avance ponderado por costo a nivel obra.
-- Pondera el avance reportado de cada partida con peso = costo_total_presupuestado.
-- Si una partida no tiene costo, no aporta al cálculo.
CREATE OR REPLACE VIEW v_obras_avance_ponderado AS
SELECT
  o.id                                                                    AS obra_id,
  o.nombre_obra,
  COALESCE(SUM(p.costo_total_presupuestado), 0)                           AS presupuesto_total,
  COALESCE(SUM(p.costo_real_acumulado), 0)                                AS costo_real_total,
  CASE
    WHEN COALESCE(SUM(p.costo_total_presupuestado), 0) = 0 THEN 0
    ELSE
      SUM(p.porcentaje_avance * p.costo_total_presupuestado)
      / NULLIF(SUM(p.costo_total_presupuestado), 0)
  END                                                                     AS avance_ponderado_pct,
  COUNT(p.id)                                                             AS total_partidas,
  COUNT(p.id) FILTER (WHERE p.estado = 'terminado')                       AS partidas_terminadas,
  COUNT(p.id) FILTER (WHERE p.estado = 'en_ejecucion')                    AS partidas_en_ejecucion,
  COUNT(p.id) FILTER (WHERE p.estado = 'atrasado')                        AS partidas_atrasadas
FROM obras o
LEFT JOIN partidas p ON p.obra_id = o.id AND p.deleted_at IS NULL
WHERE o.deleted_at IS NULL
GROUP BY o.id, o.nombre_obra;

GRANT SELECT ON v_obras_avance_ponderado TO authenticated;
