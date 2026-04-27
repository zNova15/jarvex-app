-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Vistas y funciones para dashboards
-- ═══════════════════════════════════════════════════════════════════

-- ── Vista: KPIs por obra ──────────────────────────────────────────────
CREATE OR REPLACE VIEW v_dashboard_obra AS
SELECT
  o.id,
  o.nombre_obra,
  o.estado,
  o.avance_fisico,
  o.avance_financiero,
  o.presupuesto_total,
  o.costo_real_acumulado,
  ROUND(
    (o.costo_real_acumulado / NULLIF(o.presupuesto_total, 0)) * 100,
    1
  ) AS pct_presupuesto_usado,
  (SELECT COUNT(*) FROM personal p WHERE p.obra_id = o.id AND p.estado = 'activo' AND p.deleted_at IS NULL)
    AS personal_activo,
  (SELECT COUNT(*) FROM herramientas h WHERE h.obra_id = o.id AND h.ubicacion_actual = 'en_uso')
    AS herramientas_en_uso,
  (SELECT COUNT(*) FROM materiales m WHERE m.obra_id = o.id AND m.alerta IN ('critico','sin_stock') AND m.deleted_at IS NULL)
    AS materiales_en_alerta,
  (SELECT COUNT(*) FROM partidas pa WHERE pa.obra_id = o.id AND pa.estado = 'atrasado' AND pa.deleted_at IS NULL)
    AS partidas_atrasadas,
  (SELECT COUNT(*) FROM incidencias i WHERE i.obra_id = o.id AND i.estado = 'abierta')
    AS incidencias_abiertas
FROM obras o
WHERE o.deleted_at IS NULL;

-- ── Vista: Asistencia por obra y fecha ───────────────────────────────
CREATE OR REPLACE VIEW v_asistencia_resumen AS
SELECT
  a.obra_id,
  a.fecha,
  COUNT(*) AS total_registros,
  COUNT(*) FILTER (WHERE a.estado_asistencia = 'asistio')  AS asistieron,
  COUNT(*) FILTER (WHERE a.estado_asistencia = 'tardanza') AS tardanzas,
  COUNT(*) FILTER (WHERE a.estado_asistencia = 'falta')    AS faltas,
  COUNT(*) FILTER (WHERE a.estado_asistencia = 'permiso')  AS permisos,
  ROUND(
    COUNT(*) FILTER (WHERE a.estado_asistencia IN ('asistio','tardanza'))::NUMERIC / NULLIF(COUNT(*), 0) * 100,
    1
  ) AS pct_asistencia
FROM asistencia a
GROUP BY a.obra_id, a.fecha;

-- ── Vista: Estado del almacén por obra ───────────────────────────────
CREATE OR REPLACE VIEW v_almacen_resumen AS
SELECT
  m.obra_id,
  COUNT(*) AS total_materiales,
  COUNT(*) FILTER (WHERE m.alerta = 'ok')        AS materiales_ok,
  COUNT(*) FILTER (WHERE m.alerta = 'reponer')   AS materiales_reponer,
  COUNT(*) FILTER (WHERE m.alerta = 'critico')   AS materiales_critico,
  COUNT(*) FILTER (WHERE m.alerta = 'sin_stock') AS materiales_sin_stock,
  SUM(m.stock_actual * COALESCE(m.precio_unitario_real_prom, m.precio_unitario_estimado, 0))
    AS valor_inventario_total
FROM materiales m
WHERE m.deleted_at IS NULL
GROUP BY m.obra_id;

-- ── Vista: Comparativo planificado vs real por partida ────────────────
CREATE OR REPLACE VIEW v_comparativo_partidas AS
SELECT
  p.id,
  p.obra_id,
  p.nombre_partida,
  p.categoria,
  p.metrado_contratado,
  p.metrado_ejecutado,
  p.porcentaje_avance AS avance_real,
  c.avance_esperado,
  COALESCE(p.porcentaje_avance, 0) - COALESCE(c.avance_esperado, 0) AS desviacion_avance,
  p.costo_total_presupuestado,
  p.costo_real_acumulado,
  p.diferencia AS desviacion_costo,
  CASE
    WHEN p.diferencia > 0 THEN 'sobrecosto'
    WHEN p.diferencia < 0 THEN 'ahorro'
    ELSE 'dentro_presupuesto'
  END AS estado_costo,
  c.estado AS estado_cronograma
FROM partidas p
LEFT JOIN cronograma c ON c.partida_id = p.id
WHERE p.deleted_at IS NULL;

-- ── Función RPC: curva S (planificado vs ejecutado por semana) ────────
CREATE OR REPLACE FUNCTION fn_curva_s(p_obra_id UUID)
RETURNS TABLE (
  semana     TEXT,
  planificado NUMERIC,
  ejecutado   NUMERIC,
  acum_plan   NUMERIC,
  acum_real   NUMERIC
) AS $$
  WITH semanas AS (
    SELECT DISTINCT semana FROM avance_obra WHERE obra_id = p_obra_id AND semana IS NOT NULL
  ),
  pres_total AS (
    SELECT COALESCE(SUM(costo_total_presupuestado), 1) as total
    FROM partidas WHERE obra_id = p_obra_id AND deleted_at IS NULL
  ),
  real_por_semana AS (
    SELECT
      ao.semana AS sem,
      SUM(ao.metrado_ejecutado * COALESCE(p.precio_unitario_pres, 0)) AS costo_sem
    FROM avance_obra ao
    JOIN partidas p ON p.id = ao.partida_id
    WHERE ao.obra_id = p_obra_id
    GROUP BY ao.semana
  )
  SELECT
    s.semana,
    ROUND(pt.total / 20.0, 2) AS planificado,
    COALESCE(r.costo_sem, 0)  AS ejecutado,
    SUM(ROUND(pt.total / 20.0, 2)) OVER (ORDER BY s.semana) AS acum_plan,
    SUM(COALESCE(r.costo_sem, 0)) OVER (ORDER BY s.semana)  AS acum_real
  FROM semanas s
  CROSS JOIN pres_total pt
  LEFT JOIN real_por_semana r ON r.sem = s.semana
  ORDER BY s.semana
$$ LANGUAGE sql STABLE SECURITY DEFINER;
