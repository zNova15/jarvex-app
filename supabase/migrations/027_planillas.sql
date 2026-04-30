-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migración 027 — Planillas / RRHH (versión MVP)                   ║
-- ║                                                                    ║
-- ║  Cálculo simplificado:                                             ║
-- ║    - Datos contractuales por trabajador (sueldo, AFP, condic.)    ║
-- ║    - Planilla mensual: básico + h. extra + asig. familiar -       ║
-- ║      descuentos (AFP/ONP, EsSalud, IR 5ª) = neto                  ║
-- ║    - Boleta de pago (simple)                                      ║
-- ║                                                                    ║
-- ║  NO INCLUYE (próximas iteraciones):                                ║
-- ║    - PLAME / T-Registro SUNAT (formato exacto)                    ║
-- ║    - CTS / gratificaciones automáticas                            ║
-- ║    - Vacaciones con cálculo de truncos                            ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- Datos contractuales: extiende personal con info salarial
CREATE TABLE IF NOT EXISTS personal_contrato (
  id                       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  personal_id              UUID NOT NULL REFERENCES personal(id) ON DELETE CASCADE,
  fecha_inicio             DATE NOT NULL,
  fecha_fin                DATE,
  sueldo_basico            NUMERIC(14,2) DEFAULT 0,
  asignacion_familiar      NUMERIC(14,2) DEFAULT 0,                  -- 102.50 PEN actual
  bonificaciones_fijas     NUMERIC(14,2) DEFAULT 0,
  regimen                  TEXT CHECK (regimen IN (
                             'general','construccion_civil','agrario','mype'
                           )) DEFAULT 'construccion_civil',
  tipo_pension             TEXT CHECK (tipo_pension IN ('AFP','ONP')) DEFAULT 'ONP',
  afp_nombre               TEXT,                                     -- Integra/Prima/Profuturo/Habitat
  afp_pct_aporte_obligatorio NUMERIC(5,2) DEFAULT 10.00,
  afp_pct_seguro           NUMERIC(5,2) DEFAULT 1.49,
  afp_pct_comision         NUMERIC(5,2) DEFAULT 1.55,
  cargo_planilla           TEXT,
  tiene_essalud            BOOLEAN DEFAULT true,
  domicilio_fiscal         TEXT,
  cuenta_bancaria          TEXT,                                     -- para abono de sueldos
  cci                      TEXT,
  estado                   TEXT CHECK (estado IN (
                             'vigente','suspendido','liquidado'
                           )) DEFAULT 'vigente',
  notas                    TEXT,
  version                  INTEGER DEFAULT 1 NOT NULL,
  created_at               TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at               TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at               TIMESTAMPTZ,
  created_by               UUID REFERENCES auth.users(id),
  updated_by               UUID REFERENCES auth.users(id),
  idempotency_key          TEXT UNIQUE,
  last_synced_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pcon_personal ON personal_contrato(personal_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pcon_estado   ON personal_contrato(estado) WHERE deleted_at IS NULL;

-- Planilla mensual (cabecera)
CREATE TABLE IF NOT EXISTS planillas (
  id                       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  obra_id                  UUID REFERENCES obras(id),
  company_id               UUID REFERENCES companies(id),
  periodo_mes              INTEGER NOT NULL CHECK (periodo_mes BETWEEN 1 AND 12),
  periodo_anio             INTEGER NOT NULL,
  fecha_pago               DATE,
  total_trabajadores       INTEGER DEFAULT 0,
  total_basico             NUMERIC(14,2) DEFAULT 0,
  total_horas_extras       NUMERIC(14,2) DEFAULT 0,
  total_asignaciones       NUMERIC(14,2) DEFAULT 0,
  total_bonificaciones     NUMERIC(14,2) DEFAULT 0,
  total_remuneraciones     NUMERIC(14,2) DEFAULT 0,                  -- bruto
  total_descuentos         NUMERIC(14,2) DEFAULT 0,
  total_neto               NUMERIC(14,2) DEFAULT 0,                  -- a pagar
  total_essalud            NUMERIC(14,2) DEFAULT 0,                  -- aporte empleador 9%
  estado                   TEXT CHECK (estado IN (
                             'borrador','calculada','aprobada','pagada','cerrada'
                           )) DEFAULT 'borrador',
  accounting_movement_id   UUID REFERENCES accounting_movements(id),
  notas                    TEXT,
  version                  INTEGER DEFAULT 1 NOT NULL,
  created_at               TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at               TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at               TIMESTAMPTZ,
  created_by               UUID REFERENCES auth.users(id),
  updated_by               UUID REFERENCES auth.users(id),
  idempotency_key          TEXT UNIQUE,
  last_synced_at           TIMESTAMPTZ,
  UNIQUE (obra_id, periodo_anio, periodo_mes)
);

CREATE INDEX IF NOT EXISTS idx_pln_obra   ON planillas(obra_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pln_period ON planillas(periodo_anio, periodo_mes);

-- Boleta de pago (1 por trabajador en una planilla)
CREATE TABLE IF NOT EXISTS planilla_boletas (
  id                       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  planilla_id              UUID NOT NULL REFERENCES planillas(id) ON DELETE CASCADE,
  personal_id              UUID NOT NULL REFERENCES personal(id),
  contrato_id              UUID REFERENCES personal_contrato(id),
  -- snapshot de datos del trabajador
  nombres                  TEXT,
  apellidos                TEXT,
  dni                      TEXT,
  cargo                    TEXT,
  -- ingresos
  dias_trabajados          NUMERIC(5,2) DEFAULT 0,
  sueldo_basico            NUMERIC(14,2) DEFAULT 0,
  remuneracion_basica      NUMERIC(14,2) DEFAULT 0,                  -- proporcional a días
  asignacion_familiar      NUMERIC(14,2) DEFAULT 0,
  horas_extras_25          NUMERIC(8,2) DEFAULT 0,                   -- 25% recargo
  horas_extras_35          NUMERIC(8,2) DEFAULT 0,                   -- 35% recargo
  horas_extras_100         NUMERIC(8,2) DEFAULT 0,                   -- domingos / feriados
  monto_horas_extras       NUMERIC(14,2) DEFAULT 0,
  bonificaciones           NUMERIC(14,2) DEFAULT 0,
  total_ingresos           NUMERIC(14,2) DEFAULT 0,
  -- descuentos
  descuento_afp_onp        NUMERIC(14,2) DEFAULT 0,
  descuento_ir_5ta         NUMERIC(14,2) DEFAULT 0,
  descuento_otros          NUMERIC(14,2) DEFAULT 0,
  total_descuentos         NUMERIC(14,2) DEFAULT 0,
  -- neto a pagar
  neto_pagar               NUMERIC(14,2) DEFAULT 0,
  -- aportes empleador
  essalud_empleador        NUMERIC(14,2) DEFAULT 0,                  -- 9% del bruto
  -- pago
  fecha_pago               DATE,
  forma_pago               TEXT,                                     -- transferencia / efectivo
  cuenta_destino           TEXT,
  pagado                   BOOLEAN DEFAULT false,
  observaciones            TEXT,
  version                  INTEGER DEFAULT 1 NOT NULL,
  created_at               TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at               TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at               TIMESTAMPTZ,
  created_by               UUID REFERENCES auth.users(id),
  updated_by               UUID REFERENCES auth.users(id),
  idempotency_key          TEXT UNIQUE,
  last_synced_at           TIMESTAMPTZ,
  UNIQUE (planilla_id, personal_id)
);

CREATE INDEX IF NOT EXISTS idx_blt_planilla ON planilla_boletas(planilla_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_blt_personal ON planilla_boletas(personal_id) WHERE deleted_at IS NULL;

-- ── RLS + Triggers ───────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'personal_contrato','planillas','planilla_boletas'
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
