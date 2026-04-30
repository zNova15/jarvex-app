-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migración 026 — Subcontratos                                     ║
-- ║                                                                    ║
-- ║  Contratos con subcontratistas (terceros que ejecutan parte de    ║
-- ║  la obra: instalaciones, encofrados, etc.) y sus valorizaciones.  ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS subcontratistas (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  razon_social    TEXT NOT NULL,
  ruc             TEXT,
  contacto        TEXT,
  telefono        TEXT,
  email           TEXT,
  direccion       TEXT,
  especialidad    TEXT,                          -- ej: "Instalaciones eléctricas"
  estado          TEXT CHECK (estado IN ('activo','inactivo','bloqueado')) DEFAULT 'activo',
  notas           TEXT,
  version         INTEGER DEFAULT 1 NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at      TIMESTAMPTZ,
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id),
  idempotency_key TEXT UNIQUE,
  last_synced_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sc_ruc    ON subcontratistas(ruc) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sc_estado ON subcontratistas(estado) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS subcontratos (
  id                       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  codigo                   TEXT,                                   -- ej: SC-2026-001
  obra_id                  UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  subcontratista_id        UUID NOT NULL REFERENCES subcontratistas(id),
  alcance                  TEXT NOT NULL,                          -- qué hace el subcontratista
  fecha_inicio             DATE,
  fecha_fin                DATE,
  monto_contrato           NUMERIC(14,2) NOT NULL,
  moneda                   TEXT DEFAULT 'PEN' CHECK (moneda IN ('PEN','USD')),
  retencion_pct            NUMERIC(5,2) DEFAULT 5,                 -- 5% retención garantía
  retencion_acumulada      NUMERIC(14,2) DEFAULT 0,
  fianza_fiel_cumplimiento NUMERIC(14,2),                          -- fianza recibida
  fianza_adelanto          NUMERIC(14,2),
  detraccion_pct           NUMERIC(5,2) DEFAULT 12,                -- detracción 12% construcción
  igv_pct                  NUMERIC(5,2) DEFAULT 18,
  monto_valorizado         NUMERIC(14,2) DEFAULT 0,                -- acumulado de valorizaciones
  saldo_pendiente          NUMERIC(14,2),                          -- contrato - valorizado
  estado                   TEXT CHECK (estado IN (
                             'borrador','firmado','en_ejecucion',
                             'suspendido','liquidado','cancelado'
                           )) DEFAULT 'borrador',
  observaciones            TEXT,
  archivo_contrato_url     TEXT,
  version                  INTEGER DEFAULT 1 NOT NULL,
  created_at               TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at               TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at               TIMESTAMPTZ,
  created_by               UUID REFERENCES auth.users(id),
  updated_by               UUID REFERENCES auth.users(id),
  idempotency_key          TEXT UNIQUE,
  last_synced_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sct_obra   ON subcontratos(obra_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sct_estado ON subcontratos(estado) WHERE deleted_at IS NULL;

-- Valorizaciones del subcontrato (parecido a valorizaciones del cliente, pero al revés)
CREATE TABLE IF NOT EXISTS subcontrato_valorizaciones (
  id                       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  subcontrato_id           UUID NOT NULL REFERENCES subcontratos(id) ON DELETE CASCADE,
  numero                   INTEGER NOT NULL,
  fecha                    DATE NOT NULL DEFAULT CURRENT_DATE,
  periodo_mes              INTEGER CHECK (periodo_mes BETWEEN 1 AND 12),
  periodo_anio             INTEGER,
  monto_avance             NUMERIC(14,2) NOT NULL,                 -- monto bruto del avance
  retencion_garantia       NUMERIC(14,2) DEFAULT 0,                -- 5% normalmente
  penalidad                NUMERIC(14,2) DEFAULT 0,                -- por atrasos / faltas
  adelanto_amortizado      NUMERIC(14,2) DEFAULT 0,
  monto_subtotal           NUMERIC(14,2),
  monto_igv                NUMERIC(14,2),
  monto_total              NUMERIC(14,2),                          -- a pagar al subc
  detraccion_monto         NUMERIC(14,2) DEFAULT 0,
  monto_neto_pagar         NUMERIC(14,2),
  factura_serie            TEXT,
  factura_numero           TEXT,
  estado                   TEXT CHECK (estado IN (
                             'borrador','aprobada','pagada','rechazada'
                           )) DEFAULT 'borrador',
  notas                    TEXT,
  accounting_movement_id   UUID REFERENCES accounting_movements(id),
  version                  INTEGER DEFAULT 1 NOT NULL,
  created_at               TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at               TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at               TIMESTAMPTZ,
  created_by               UUID REFERENCES auth.users(id),
  updated_by               UUID REFERENCES auth.users(id),
  idempotency_key          TEXT UNIQUE,
  last_synced_at           TIMESTAMPTZ,
  UNIQUE (subcontrato_id, numero)
);

CREATE INDEX IF NOT EXISTS idx_scv_sct    ON subcontrato_valorizaciones(subcontrato_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_scv_estado ON subcontrato_valorizaciones(estado) WHERE deleted_at IS NULL;

-- ── RLS + Triggers ───────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'subcontratistas','subcontratos','subcontrato_valorizaciones'
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
