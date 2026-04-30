-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migración 023 — Valorizaciones mensuales                         ║
-- ║                                                                    ║
-- ║  La valorización es el documento mensual donde se cuantifica el   ║
-- ║  avance ejecutado por la obra y se emite factura al cliente.      ║
-- ║                                                                    ║
-- ║  Estructura:                                                       ║
-- ║   - valorizaciones (cabecera mensual)                             ║
-- ║   - valorizacion_partidas (detalle: metrado mes/acum por partida) ║
-- ║   - valorizacion_adicionales (adelantos, retenciones, otros)      ║
-- ║                                                                    ║
-- ║  Cuando se aprueba:                                                ║
-- ║   - Se genera 1 accounting_movement tipo income en la empresa     ║
-- ║     constructora (ingresos por valorización).                     ║
-- ║   - Se calcula detracción 12% (construcción) automáticamente.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS valorizaciones (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  obra_id               UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  numero                INTEGER NOT NULL,                  -- 1, 2, 3... correlativo
  periodo_mes           INTEGER NOT NULL CHECK (periodo_mes BETWEEN 1 AND 12),
  periodo_anio          INTEGER NOT NULL,
  fecha_corte           DATE NOT NULL,
  fecha_emision         DATE,
  fecha_aprobacion      DATE,
  -- Cliente
  cliente_nombre        TEXT,
  cliente_ruc           TEXT,
  -- Montos
  monto_bruto           NUMERIC(14,2) DEFAULT 0,           -- suma de partidas
  adelantos             NUMERIC(14,2) DEFAULT 0,           -- adelanto descontado
  retenciones           NUMERIC(14,2) DEFAULT 0,           -- retención garantía (5%, 10%)
  monto_subtotal        NUMERIC(14,2) DEFAULT 0,
  igv_pct               NUMERIC(5,2) DEFAULT 18,
  monto_igv             NUMERIC(14,2) DEFAULT 0,
  monto_total           NUMERIC(14,2) DEFAULT 0,           -- subtotal + IGV
  -- Detracción (12% construcción)
  detraccion_pct        NUMERIC(5,2) DEFAULT 12,
  detraccion_monto      NUMERIC(14,2) DEFAULT 0,
  monto_neto_cobrar     NUMERIC(14,2) DEFAULT 0,           -- total - detracción
  -- Documento
  factura_serie         TEXT,
  factura_numero        TEXT,
  -- Estado
  estado                TEXT CHECK (estado IN (
                          'borrador','presentada','aprobada',
                          'facturada','pagada','rechazada'
                        )) DEFAULT 'borrador',
  motivo_rechazo        TEXT,
  notas                 TEXT,
  -- Vinculación con contabilidad (cuando se factura)
  company_id            UUID REFERENCES companies(id),     -- empresa que emite
  accounting_movement_id UUID REFERENCES accounting_movements(id),
  -- estándar
  version               INTEGER DEFAULT 1 NOT NULL,
  created_at            TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at            TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at            TIMESTAMPTZ,
  created_by            UUID REFERENCES auth.users(id),
  updated_by            UUID REFERENCES auth.users(id),
  idempotency_key       TEXT UNIQUE,
  last_synced_at        TIMESTAMPTZ,
  UNIQUE (obra_id, numero)
);

CREATE INDEX IF NOT EXISTS idx_val_obra   ON valorizaciones(obra_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_val_estado ON valorizaciones(estado)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_val_period ON valorizaciones(periodo_anio, periodo_mes);

CREATE TABLE IF NOT EXISTS valorizacion_partidas (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  valorizacion_id     UUID NOT NULL REFERENCES valorizaciones(id) ON DELETE CASCADE,
  partida_id          UUID NOT NULL REFERENCES partidas(id),
  -- Snapshot de la partida al momento de valorizar
  codigo              TEXT,
  nombre_partida      TEXT,
  unidad              TEXT,
  metrado_contratado  NUMERIC(14,4),
  precio_unitario     NUMERIC(14,4),
  -- Avance del periodo
  metrado_anterior    NUMERIC(14,4) DEFAULT 0,             -- acumulado hasta valorización anterior
  metrado_mes         NUMERIC(14,4) DEFAULT 0,             -- ejecutado este mes
  metrado_acumulado   NUMERIC(14,4) DEFAULT 0,             -- anterior + mes
  monto_mes           NUMERIC(14,2) DEFAULT 0,             -- metrado_mes × pu
  monto_acumulado     NUMERIC(14,2) DEFAULT 0,             -- metrado_acumulado × pu
  porcentaje_avance   NUMERIC(5,2) DEFAULT 0,              -- metrado_acumulado / contratado * 100
  observacion         TEXT,
  version             INTEGER DEFAULT 1 NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at          TIMESTAMPTZ,
  idempotency_key     TEXT UNIQUE,
  last_synced_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_val_part_val ON valorizacion_partidas(valorizacion_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_val_part_part ON valorizacion_partidas(partida_id);

CREATE TABLE IF NOT EXISTS valorizacion_adicionales (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  valorizacion_id UUID NOT NULL REFERENCES valorizaciones(id) ON DELETE CASCADE,
  tipo            TEXT CHECK (tipo IN (
                    'adelanto','retencion','penalidad','reajuste','otro'
                  )),
  concepto        TEXT NOT NULL,
  monto           NUMERIC(14,2) NOT NULL,
  signo           TEXT CHECK (signo IN ('+','-')) DEFAULT '-',
  notas           TEXT,
  version         INTEGER DEFAULT 1 NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at      TIMESTAMPTZ,
  idempotency_key TEXT UNIQUE,
  last_synced_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_val_adic_val ON valorizacion_adicionales(valorizacion_id) WHERE deleted_at IS NULL;

-- ── RLS + Triggers ──────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'valorizaciones','valorizacion_partidas','valorizacion_adicionales'
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
