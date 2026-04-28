-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migración 018 — Versiones de Presupuesto (hasta 5 por obra)      ║
-- ║  Permite congelar v1 (inicial) → v2 (modificado) → v3 → v4 → v5   ║
-- ║  y comparar las 5 columnas en una sola pantalla.                  ║
-- ║  La tabla `partidas` actual sigue siendo la "Real" en uso.        ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS presupuestos_versiones (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  obra_id         UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  numero          SMALLINT NOT NULL CHECK (numero BETWEEN 1 AND 5),
  nombre          TEXT NOT NULL,
  tipo            TEXT CHECK (tipo IN ('inicial','modificado','propuesta','adicional','real')),
  descripcion     TEXT,
  fecha           DATE,
  monto_total     NUMERIC(14,2) DEFAULT 0,
  bloqueado       BOOLEAN DEFAULT false,
  archivo_origen  TEXT,
  notas           TEXT,
  -- estándar
  version         INTEGER DEFAULT 1 NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at      TIMESTAMPTZ,
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id),
  idempotency_key TEXT UNIQUE,
  last_synced_at  TIMESTAMPTZ,
  UNIQUE (obra_id, numero)
);

CREATE INDEX IF NOT EXISTS idx_pres_versiones_obra ON presupuestos_versiones(obra_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS partidas_versionadas (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  version_id        UUID NOT NULL REFERENCES presupuestos_versiones(id) ON DELETE CASCADE,
  obra_id           UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  codigo            TEXT NOT NULL,
  nombre_partida    TEXT NOT NULL,
  unidad            TEXT,
  metrado           NUMERIC(14,4) DEFAULT 0,
  precio_unitario   NUMERIC(14,4) DEFAULT 0,
  costo_total       NUMERIC(14,2) DEFAULT 0,
  nivel             SMALLINT DEFAULT 1,
  parent_codigo     TEXT,
  orden             INTEGER DEFAULT 0,
  -- estándar
  version           INTEGER DEFAULT 1 NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at        TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at        TIMESTAMPTZ,
  created_by        UUID REFERENCES auth.users(id),
  updated_by        UUID REFERENCES auth.users(id),
  idempotency_key   TEXT UNIQUE,
  last_synced_at    TIMESTAMPTZ,
  UNIQUE (version_id, codigo)
);

CREATE INDEX IF NOT EXISTS idx_partidas_ver_version ON partidas_versionadas(version_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_partidas_ver_obra    ON partidas_versionadas(obra_id)    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_partidas_ver_codigo  ON partidas_versionadas(codigo);

-- ── RLS ──────────────────────────────────────────────────────────────
ALTER TABLE presupuestos_versiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE partidas_versionadas   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pres_ver: ve"         ON presupuestos_versiones;
DROP POLICY IF EXISTS "pres_ver: crea"       ON presupuestos_versiones;
DROP POLICY IF EXISTS "pres_ver: actualiza"  ON presupuestos_versiones;
DROP POLICY IF EXISTS "pres_ver: elimina"    ON presupuestos_versiones;

CREATE POLICY "pres_ver: ve"         ON presupuestos_versiones FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "pres_ver: crea"       ON presupuestos_versiones FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "pres_ver: actualiza"  ON presupuestos_versiones FOR UPDATE USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "pres_ver: elimina"    ON presupuestos_versiones FOR DELETE USING (is_admin());

DROP POLICY IF EXISTS "part_ver: ve"         ON partidas_versionadas;
DROP POLICY IF EXISTS "part_ver: crea"       ON partidas_versionadas;
DROP POLICY IF EXISTS "part_ver: actualiza"  ON partidas_versionadas;
DROP POLICY IF EXISTS "part_ver: elimina"    ON partidas_versionadas;

CREATE POLICY "part_ver: ve"         ON partidas_versionadas FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "part_ver: crea"       ON partidas_versionadas FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "part_ver: actualiza"  ON partidas_versionadas FOR UPDATE USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "part_ver: elimina"    ON partidas_versionadas FOR DELETE USING (is_admin());

-- Triggers updated_at
CREATE TRIGGER trg_pres_versiones_updated_at
  BEFORE UPDATE ON presupuestos_versiones
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_partidas_ver_updated_at
  BEFORE UPDATE ON partidas_versionadas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Vista de comparativa (derivada): hasta 5 columnas por código ────
-- Esta view permite a la app obtener una matriz con todas las partidas
-- mergeadas por código jerárquico, con los costos de cada versión.
-- security_invoker=true para respetar RLS del usuario.
CREATE OR REPLACE VIEW v_versiones_comparativa AS
SELECT
  obra_id,
  codigo,
  -- Nombre representativo (el último visto)
  MAX(nombre_partida)                                                         AS nombre_partida,
  MAX(unidad)                                                                  AS unidad,
  -- Costos por versión (1..5)
  MAX(CASE WHEN ver_numero = 1 THEN costo_total END)                          AS costo_v1,
  MAX(CASE WHEN ver_numero = 2 THEN costo_total END)                          AS costo_v2,
  MAX(CASE WHEN ver_numero = 3 THEN costo_total END)                          AS costo_v3,
  MAX(CASE WHEN ver_numero = 4 THEN costo_total END)                          AS costo_v4,
  MAX(CASE WHEN ver_numero = 5 THEN costo_total END)                          AS costo_v5,
  MAX(CASE WHEN ver_numero = 1 THEN metrado END)                              AS metrado_v1,
  MAX(CASE WHEN ver_numero = 2 THEN metrado END)                              AS metrado_v2,
  MAX(CASE WHEN ver_numero = 3 THEN metrado END)                              AS metrado_v3,
  MAX(CASE WHEN ver_numero = 4 THEN metrado END)                              AS metrado_v4,
  MAX(CASE WHEN ver_numero = 5 THEN metrado END)                              AS metrado_v5,
  MIN(orden)                                                                   AS orden_min
FROM (
  SELECT pv.obra_id, pv.codigo, pv.nombre_partida, pv.unidad, pv.costo_total,
         pv.metrado, pv.orden, v.numero AS ver_numero
  FROM partidas_versionadas pv
  JOIN presupuestos_versiones v ON v.id = pv.version_id
  WHERE pv.deleted_at IS NULL AND v.deleted_at IS NULL
) sub
GROUP BY obra_id, codigo;

ALTER VIEW v_versiones_comparativa SET (security_invoker = true);

GRANT SELECT ON v_versiones_comparativa TO authenticated;
