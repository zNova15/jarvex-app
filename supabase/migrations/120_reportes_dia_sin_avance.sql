-- 120: REPORTE "DÍA SIN AVANCE" de los ingenieros (pedido de Gabriel: si un día
-- no se avanzó metrado, igual se reporta, con motivo y foto). Tabla PROPIA en
-- vez de filas en avance_obra: allí partida_id es NOT NULL y el trigger
-- actualizar_avance_partida (frágil, ya rompió avances 2 veces) corre en cada
-- INSERT — un "sin avance" es del día/frente, no de una partida.
-- Las fotos van como evidencias tipo 'foto_sin_avance' (modulo 'reportes_dia').

CREATE TABLE IF NOT EXISTS reportes_dia (
  id uuid PRIMARY KEY,
  obra_id uuid NOT NULL REFERENCES obras(id),
  frente_id uuid REFERENCES frentes_obra(id),
  fecha date NOT NULL,
  motivo text NOT NULL,
  responsable_id uuid REFERENCES profiles(id),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_reportes_dia_obra_fecha
  ON reportes_dia (obra_id, fecha) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reportes_dia_resp
  ON reportes_dia (responsable_id, fecha) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_reportes_dia_updated ON reportes_dia;
CREATE TRIGGER trg_reportes_dia_updated
  BEFORE UPDATE ON reportes_dia
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE reportes_dia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reportes_dia: autenticado lee" ON reportes_dia;
CREATE POLICY "reportes_dia: autenticado lee" ON reportes_dia
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "reportes_dia: autenticado inserta" ON reportes_dia;
CREATE POLICY "reportes_dia: autenticado inserta" ON reportes_dia
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "reportes_dia: autenticado actualiza" ON reportes_dia;
CREATE POLICY "reportes_dia: autenticado actualiza" ON reportes_dia
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "reportes_dia: admin borra" ON reportes_dia;
CREATE POLICY "reportes_dia: admin borra" ON reportes_dia
  FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));

-- ── Vista para RECORDATORIOS: días (últimos 14) en que cada ingeniero con
-- frente asignado NO reportó ni avance ni "sin avance". La consume SOLO el
-- workflow de email (n8n con service key) — el banner in-app calcula local.
-- OJO zona horaria: current_date en el server es UTC; a las 18:00 de Lima
-- (23:00 UTC) reclamaría el día EN CURSO → se ancla a America/Lima.
-- Estados REALES del CHECK de obras: activo|terminado|cancelado|pausado|
-- planificacion (los primeros nombres del filtro no existían y una obra
-- 'terminado' generaba recordatorios eternos). Piso adicional por la FECHA DE
-- ASIGNACIÓN del ingeniero (min created_at de sus frentes): a un recién
-- asignado no se le reclaman días previos a su llegada.
CREATE OR REPLACE VIEW v_dias_sin_reporte AS
WITH ingenieros AS (
  SELECT f.ingeniero_user_id AS user_id, f.obra_id,
         MIN(f.created_at)::date AS asignado_desde
  FROM frentes_obra f
  JOIN obras o ON o.id = f.obra_id
  WHERE f.ingeniero_user_id IS NOT NULL
    AND f.deleted_at IS NULL
    AND COALESCE(o.estado, 'activo') NOT IN ('terminado', 'cancelado', 'pausado')
  GROUP BY 1, 2
),
dias AS (
  SELECT i.user_id, i.obra_id, gs::date AS fecha
  FROM ingenieros i
  CROSS JOIN LATERAL generate_series(
    GREATEST((now() AT TIME ZONE 'America/Lima')::date - 14,
             i.asignado_desde,
             (SELECT COALESCE(o.fecha_inicio, (now() AT TIME ZONE 'America/Lima')::date - 14) FROM obras o WHERE o.id = i.obra_id)),
    (now() AT TIME ZONE 'America/Lima')::date - 1,   -- hasta AYER: hoy todavía puede reportar
    INTERVAL '1 day'
  ) gs
)
SELECT d.user_id, p.email,
       TRIM(COALESCE(p.nombres, '') || ' ' || COALESCE(p.apellidos, '')) AS nombre,
       d.obra_id, o.nombre_obra, d.fecha
FROM dias d
JOIN profiles p ON p.id = d.user_id AND p.activo IS NOT FALSE
JOIN obras o ON o.id = d.obra_id
WHERE NOT EXISTS (
    SELECT 1 FROM avance_obra a
    WHERE a.responsable_id = d.user_id AND a.obra_id = d.obra_id
      AND a.fecha = d.fecha AND a.deleted_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM reportes_dia r
    WHERE r.responsable_id = d.user_id AND r.obra_id = d.obra_id
      AND r.fecha = d.fecha AND r.deleted_at IS NULL
  );

-- La vista expone emails → solo para el workflow de recordatorios (n8n con
-- service key). La app NO la usa (el recordatorio in-app se calcula local).
REVOKE SELECT ON v_dias_sin_reporte FROM anon, authenticated;
GRANT SELECT ON v_dias_sin_reporte TO service_role;

NOTIFY pgrst, 'reload schema';
