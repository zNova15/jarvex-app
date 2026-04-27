-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Triggers de negocio
-- ═══════════════════════════════════════════════════════════════════

-- ── Trigger: actualizar stock de material tras movimiento ─────────────

CREATE OR REPLACE FUNCTION recalcular_stock_material()
RETURNS TRIGGER AS $$
DECLARE
  v_delta NUMERIC;
BEGIN
  -- Determinar delta según tipo de movimiento
  v_delta := CASE NEW.tipo_movimiento
    WHEN 'entrada'    THEN  NEW.cantidad
    WHEN 'devolucion' THEN  NEW.cantidad
    WHEN 'salida'     THEN -NEW.cantidad
    WHEN 'merma'      THEN -NEW.cantidad
    WHEN 'ajuste'     THEN  NEW.cantidad   -- positivo = suma, negativo = resta
    ELSE 0
  END;

  UPDATE materiales
  SET
    stock_actual   = stock_actual + v_delta,
    total_entradas = total_entradas + CASE WHEN v_delta > 0 THEN v_delta ELSE 0 END,
    total_salidas  = total_salidas  + CASE WHEN v_delta < 0 THEN -v_delta ELSE 0 END,
    -- Actualizar precio promedio ponderado si es entrada con precio
    precio_unitario_real_prom = CASE
      WHEN NEW.tipo_movimiento IN ('entrada', 'devolucion') AND NEW.precio_unitario_real IS NOT NULL
      THEN (
        (COALESCE(precio_unitario_real_prom, 0) * GREATEST(stock_actual, 0) + NEW.precio_unitario_real * NEW.cantidad)
        / GREATEST(stock_actual + v_delta, 1)
      )
      ELSE precio_unitario_real_prom
    END,
    -- Actualizar alerta
    alerta = CASE
      WHEN (stock_actual + v_delta) <= 0 THEN 'sin_stock'
      WHEN (stock_actual + v_delta) <= stock_minimo * 0.5 THEN 'critico'
      WHEN (stock_actual + v_delta) <= stock_minimo THEN 'reponer'
      ELSE 'ok'
    END,
    updated_at = now()
  WHERE id = NEW.material_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_stock_on_movimiento
  AFTER INSERT ON movimientos_materiales
  FOR EACH ROW EXECUTE FUNCTION recalcular_stock_material();

-- ── Trigger: actualizar disponibilidad de herramienta ─────────────────

CREATE OR REPLACE FUNCTION actualizar_disponibilidad_herramienta()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE herramientas
  SET
    disponible              = (NEW.accion IN ('entrada', 'reposicion')),
    ubicacion_actual        = CASE NEW.accion
                                WHEN 'salida'        THEN 'en_uso'
                                WHEN 'entrada'       THEN 'almacen'
                                WHEN 'mantenimiento' THEN 'mantenimiento'
                                WHEN 'baja'          THEN 'baja'
                                WHEN 'reposicion'    THEN 'almacen'
                                ELSE ubicacion_actual
                              END,
    ultimo_responsable_id   = NEW.responsable_id,
    fecha_ultimo_movimiento = NEW.fecha,
    updated_at              = now()
  WHERE id = NEW.herramienta_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_herramienta_on_movimiento
  AFTER INSERT ON movimientos_herramientas
  FOR EACH ROW EXECUTE FUNCTION actualizar_disponibilidad_herramienta();

-- ── Trigger: actualizar metrado_ejecutado y % avance en partida ───────

CREATE OR REPLACE FUNCTION actualizar_avance_partida()
RETURNS TRIGGER AS $$
DECLARE
  v_total_metrado NUMERIC;
  v_pct NUMERIC;
BEGIN
  SELECT COALESCE(SUM(metrado_ejecutado), 0)
  INTO v_total_metrado
  FROM avance_obra
  WHERE partida_id = NEW.partida_id;

  SELECT
    CASE
      WHEN metrado_contratado > 0
      THEN LEAST(ROUND((v_total_metrado / metrado_contratado) * 100, 2), 100)
      ELSE 0
    END
  INTO v_pct
  FROM partidas WHERE id = NEW.partida_id;

  UPDATE partidas
  SET
    metrado_ejecutado = v_total_metrado,
    porcentaje_avance = v_pct,
    estado = CASE
      WHEN v_pct >= 100 THEN 'terminado'
      WHEN v_pct > 0    THEN 'en_ejecucion'
      ELSE estado
    END,
    updated_at = now()
  WHERE id = NEW.partida_id;

  -- Actualizar avance físico global de la obra
  UPDATE obras o
  SET
    avance_fisico = (
      SELECT ROUND(AVG(p.porcentaje_avance), 2)
      FROM partidas p
      WHERE p.obra_id = o.id AND p.deleted_at IS NULL
    ),
    updated_at = now()
  WHERE o.id = NEW.obra_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_avance_on_registro
  AFTER INSERT OR UPDATE ON avance_obra
  FOR EACH ROW EXECUTE FUNCTION actualizar_avance_partida();

-- ── Trigger: auto-crear incidencia por conflicto de stock ─────────────

CREATE OR REPLACE FUNCTION detectar_stock_negativo()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT stock_actual FROM materiales WHERE id = NEW.material_id) < 0 THEN
    INSERT INTO incidencias (
      obra_id, tipo_incidencia, severidad, modulo_origen,
      registro_origen_id, descripcion, creado_por
    )
    VALUES (
      NEW.obra_id,
      'stock_conflicto',
      'alta',
      'movimientos_materiales',
      NEW.id,
      format('Stock negativo detectado en material %s tras movimiento de sincronización. Revisar y ajustar.', NEW.material_id::text),
      NEW.created_by
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_detectar_stock_negativo
  AFTER INSERT ON movimientos_materiales
  FOR EACH ROW EXECUTE FUNCTION detectar_stock_negativo();
