-- 094: FIX avance_consumo_pct. En Postgres LEAST(100, NULL) = 100 (ignora NULL). Cuando una
-- partida NO tiene insumos tipo 'material' (ej. solo equipo), MAX(...) da NULL y la vista
-- devolvia 100% de consumo erroneo. Se envuelve el MAX en COALESCE(...,0) -> LEAST(100,0)=0.
CREATE OR REPLACE VIEW v_partidas_avance_consumo
WITH (security_invoker = true) AS
SELECT id AS partida_id,
    obra_id,
    codigo_delfin,
    nombre_partida,
    unidad,
    metrado_contratado,
    costo_total_presupuestado,
    costo_real_acumulado,
    COALESCE(( SELECT LEAST(100::numeric, COALESCE(max(
                CASE
                    WHEN ip.cantidad_presupuestada IS NOT NULL AND ip.cantidad_presupuestada > 0::numeric THEN COALESCE(ip.cantidad_real_usada, 0::numeric) / ip.cantidad_presupuestada * 100::numeric
                    ELSE 0::numeric
                END), 0::numeric))
           FROM insumos_partida ip
          WHERE ip.partida_id = p.id AND ip.tipo_insumo = 'material'::text AND ip.cantidad_presupuestada > 0::numeric), 0::numeric) AS avance_consumo_pct,
        CASE
            WHEN costo_total_presupuestado IS NULL OR costo_total_presupuestado = 0::numeric THEN 0::numeric
            ELSE LEAST(100::numeric, COALESCE(costo_real_acumulado, 0::numeric) / costo_total_presupuestado * 100::numeric)
        END AS avance_financiero_pct,
    porcentaje_avance AS avance_reportado_pct
   FROM partidas p
  WHERE deleted_at IS NULL;
