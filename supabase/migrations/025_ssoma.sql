-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migración 025 — SSOMA (Seguridad, Salud Ocupacional, Medio Amb.) ║
-- ║                                                                    ║
-- ║   - charlas_seguridad (charlas de 5min diarias)                   ║
-- ║   - charla_asistentes (M2M con personal)                          ║
-- ║   - iperc (matriz de identificación de peligros)                  ║
-- ║   - epp_entregas (registro de entrega de EPP a personal)          ║
-- ║   - inspecciones_seguridad (checklists periódicas)                ║
-- ║   - capacitaciones (cursos de SSOMA)                              ║
-- ║                                                                    ║
-- ║  Las "incidencias" ya existen — ahí van accidentes/quasiaccidentes║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ── CHARLAS DE 5 MINUTOS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS charlas_seguridad (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  obra_id         UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  hora            TEXT,
  tema            TEXT NOT NULL,
  facilitador_id  UUID REFERENCES personal(id),
  facilitador_nombre TEXT,
  duracion_min    INTEGER DEFAULT 5,
  contenido       TEXT,
  total_asistentes INTEGER DEFAULT 0,
  evidencia_id    UUID REFERENCES evidencias(id),
  observaciones   TEXT,
  -- estándar
  version         INTEGER DEFAULT 1 NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at      TIMESTAMPTZ,
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id),
  idempotency_key TEXT UNIQUE,
  last_synced_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_chs_obra  ON charlas_seguridad(obra_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chs_fecha ON charlas_seguridad(fecha DESC);

CREATE TABLE IF NOT EXISTS charla_asistentes (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  charla_id       UUID NOT NULL REFERENCES charlas_seguridad(id) ON DELETE CASCADE,
  personal_id     UUID REFERENCES personal(id),
  nombre          TEXT,                        -- snapshot por si se elimina
  dni             TEXT,
  firma_url       TEXT,
  version         INTEGER DEFAULT 1 NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at      TIMESTAMPTZ,
  idempotency_key TEXT UNIQUE,
  last_synced_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cha_charla   ON charla_asistentes(charla_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cha_personal ON charla_asistentes(personal_id);

-- ── IPERC (Matriz de identificación de peligros) ─────────────────────
CREATE TABLE IF NOT EXISTS iperc (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  obra_id            UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  fecha              DATE NOT NULL DEFAULT CURRENT_DATE,
  actividad          TEXT NOT NULL,
  proceso            TEXT,
  peligro            TEXT NOT NULL,             -- ej: trabajo en altura
  riesgo             TEXT NOT NULL,             -- ej: caída
  consecuencia       TEXT,
  -- Evaluación (matriz 5x5)
  probabilidad       INTEGER CHECK (probabilidad BETWEEN 1 AND 5),
  severidad          INTEGER CHECK (severidad BETWEEN 1 AND 5),
  nivel_riesgo       INTEGER,                   -- prob × sev
  clasificacion      TEXT CHECK (clasificacion IN (
                       'trivial','tolerable','moderado','importante','intolerable'
                     )),
  -- Controles
  control_existente  TEXT,
  control_propuesto  TEXT,
  responsable_id     UUID REFERENCES personal(id),
  fecha_implementacion DATE,
  estado             TEXT CHECK (estado IN (
                       'identificado','en_control','controlado','cerrado'
                     )) DEFAULT 'identificado',
  observaciones      TEXT,
  version            INTEGER DEFAULT 1 NOT NULL,
  created_at         TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at         TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at         TIMESTAMPTZ,
  created_by         UUID REFERENCES auth.users(id),
  updated_by         UUID REFERENCES auth.users(id),
  idempotency_key    TEXT UNIQUE,
  last_synced_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_iperc_obra  ON iperc(obra_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_iperc_clas  ON iperc(clasificacion) WHERE deleted_at IS NULL;

-- ── ENTREGAS DE EPP ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS epp_entregas (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  obra_id         UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  personal_id     UUID NOT NULL REFERENCES personal(id),
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  tipo_epp        TEXT NOT NULL,               -- casco, chaleco, guantes, botas, lentes, mascarilla, arnes, otro
  marca           TEXT,
  cantidad        INTEGER DEFAULT 1,
  motivo          TEXT CHECK (motivo IN (
                    'inicial','reposicion','cambio','perdida','dotacion'
                  )) DEFAULT 'inicial',
  costo_unitario  NUMERIC(10,2),
  costo_total     NUMERIC(14,2),
  firma_url       TEXT,                        -- firma del trabajador
  observaciones   TEXT,
  version         INTEGER DEFAULT 1 NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at      TIMESTAMPTZ,
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id),
  idempotency_key TEXT UNIQUE,
  last_synced_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_epp_obra      ON epp_entregas(obra_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_epp_personal  ON epp_entregas(personal_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_epp_fecha     ON epp_entregas(fecha DESC);

-- ── INSPECCIONES DE SEGURIDAD ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inspecciones_seguridad (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  obra_id            UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  fecha              DATE NOT NULL DEFAULT CURRENT_DATE,
  tipo               TEXT CHECK (tipo IN (
                       'general','epp','andamios','herramientas','area_trabajo','otra'
                     )) DEFAULT 'general',
  inspector_id       UUID REFERENCES personal(id),
  area_inspeccionada TEXT,
  resultado          TEXT CHECK (resultado IN (
                       'conforme','observaciones','no_conforme'
                     )) DEFAULT 'conforme',
  hallazgos          TEXT,
  acciones_correctivas TEXT,
  fecha_cierre       DATE,
  responsable_cierre_id UUID REFERENCES personal(id),
  evidencia_id       UUID REFERENCES evidencias(id),
  version            INTEGER DEFAULT 1 NOT NULL,
  created_at         TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at         TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at         TIMESTAMPTZ,
  created_by         UUID REFERENCES auth.users(id),
  updated_by         UUID REFERENCES auth.users(id),
  idempotency_key    TEXT UNIQUE,
  last_synced_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_insp_obra ON inspecciones_seguridad(obra_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_insp_fecha ON inspecciones_seguridad(fecha DESC);

-- ── CAPACITACIONES ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS capacitaciones (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  obra_id         UUID REFERENCES obras(id),
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  tema            TEXT NOT NULL,
  tipo            TEXT CHECK (tipo IN (
                    'induccion','dia_dia','reentrenamiento','primeros_auxilios',
                    'trabajo_altura','espacio_confinado','manejo_carga','otra'
                  )) DEFAULT 'induccion',
  duracion_horas  NUMERIC(4,1),
  expositor       TEXT,
  total_asistentes INTEGER DEFAULT 0,
  contenido       TEXT,
  evaluacion      BOOLEAN DEFAULT false,
  evidencia_id    UUID REFERENCES evidencias(id),
  observaciones   TEXT,
  version         INTEGER DEFAULT 1 NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at      TIMESTAMPTZ,
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id),
  idempotency_key TEXT UNIQUE,
  last_synced_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cap_obra  ON capacitaciones(obra_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cap_fecha ON capacitaciones(fecha DESC);

-- ── RLS + Triggers ───────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'charlas_seguridad','charla_asistentes','iperc',
    'epp_entregas','inspecciones_seguridad','capacitaciones'
  ])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "%I: ve" ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%I: crea" ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%I: actualiza" ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%I: elimina" ON %I', t, t);
    EXECUTE format('CREATE POLICY "%I: ve"        ON %I FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL)', t, t);
    EXECUTE format('CREATE POLICY "%I: crea"      ON %I FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL)', t, t);
    EXECUTE format('CREATE POLICY "%I: actualiza" ON %I FOR UPDATE USING ((SELECT auth.uid()) IS NOT NULL)', t, t);
    EXECUTE format('CREATE POLICY "%I: elimina"   ON %I FOR DELETE USING (is_admin())', t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at()', t, t);
  END LOOP;
END $$;
