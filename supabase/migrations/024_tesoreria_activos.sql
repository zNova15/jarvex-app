-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migración 024 — Tesorería + Activos pesados (maquinaria)         ║
-- ║                                                                    ║
-- ║  Tesorería: cuentas bancarias por empresa, movimientos bancarios,  ║
-- ║  programación de pagos, conciliación.                              ║
-- ║                                                                    ║
-- ║  Activos: maquinaria pesada con hora-máquina, combustible y        ║
-- ║  mantenimiento. Separado de "herramientas" porque la lógica        ║
-- ║  económica es distinta (depreciación, costo por hora, etc.)        ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ╭─── TESORERÍA ──────────────────────────────────────────────────────╮

CREATE TABLE IF NOT EXISTS cuentas_bancarias (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  banco           TEXT NOT NULL,
  numero_cuenta   TEXT,
  cci             TEXT,                                 -- código CCI Perú
  tipo            TEXT CHECK (tipo IN (
                    'corriente','ahorro','detracciones','plazo_fijo'
                  )) DEFAULT 'corriente',
  moneda          TEXT DEFAULT 'PEN' CHECK (moneda IN ('PEN','USD')),
  saldo_inicial   NUMERIC(14,2) DEFAULT 0,
  fecha_apertura  DATE,
  estado          TEXT CHECK (estado IN ('activa','inactiva','cerrada')) DEFAULT 'activa',
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

CREATE INDEX IF NOT EXISTS idx_cb_company ON cuentas_bancarias(company_id) WHERE deleted_at IS NULL;

-- Movimiento bancario (depósito, retiro, transferencia)
CREATE TABLE IF NOT EXISTS movimientos_bancarios (
  id                       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cuenta_id                UUID NOT NULL REFERENCES cuentas_bancarias(id) ON DELETE CASCADE,
  fecha                    DATE NOT NULL DEFAULT CURRENT_DATE,
  tipo                     TEXT CHECK (tipo IN (
                             'deposito','retiro','transferencia_in',
                             'transferencia_out','interes','comision','otro'
                           )),
  monto                    NUMERIC(14,2) NOT NULL,        -- positivo: ingreso, negativo: egreso
  descripcion              TEXT,
  contraparte              TEXT,                          -- nombre del otro banco/persona
  referencia               TEXT,                          -- nº operación bancario
  conciliado               BOOLEAN DEFAULT false,
  fecha_conciliacion       DATE,
  accounting_movement_id   UUID REFERENCES accounting_movements(id),  -- vinculo con contabilidad
  cuenta_destino_id        UUID REFERENCES cuentas_bancarias(id),     -- en transferencias internas
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

CREATE INDEX IF NOT EXISTS idx_mb_cuenta ON movimientos_bancarios(cuenta_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mb_fecha  ON movimientos_bancarios(fecha DESC);

-- Programación de pagos (calendario de vencimientos)
CREATE TABLE IF NOT EXISTS cronograma_pagos (
  id                       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  accounting_movement_id   UUID REFERENCES accounting_movements(id),
  company_id               UUID NOT NULL REFERENCES companies(id),
  cuenta_id                UUID REFERENCES cuentas_bancarias(id),
  fecha_programada         DATE NOT NULL,
  monto                    NUMERIC(14,2) NOT NULL,
  moneda                   TEXT DEFAULT 'PEN',
  beneficiario             TEXT,                          -- proveedor / acreedor
  concepto                 TEXT,
  documento_ref            TEXT,                          -- nº factura
  estado                   TEXT CHECK (estado IN (
                             'programado','pagado','vencido','anulado'
                           )) DEFAULT 'programado',
  fecha_pago_real          DATE,
  movimiento_bancario_id   UUID REFERENCES movimientos_bancarios(id),
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

CREATE INDEX IF NOT EXISTS idx_cp_company ON cronograma_pagos(company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cp_estado  ON cronograma_pagos(estado) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cp_fecha   ON cronograma_pagos(fecha_programada);

-- ╭─── ACTIVOS PESADOS / MAQUINARIA ───────────────────────────────────╮

CREATE TABLE IF NOT EXISTS activos_pesados (
  id                       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  codigo                   TEXT,                              -- ej: EXC-001
  nombre                   TEXT NOT NULL,                     -- "Excavadora CAT 320"
  tipo                     TEXT CHECK (tipo IN (
                             'excavadora','retroexcavadora','volquete','cargador',
                             'tractor','motoniveladora','rodillo','grua',
                             'pavimentadora','bulldozer','camion','otro'
                           )),
  marca                    TEXT,
  modelo                   TEXT,
  anio                     INTEGER,
  placa                    TEXT,
  serie                    TEXT,
  costo_adquisicion        NUMERIC(14,2),
  fecha_adquisicion        DATE,
  vida_util_anios          INTEGER DEFAULT 5,
  depreciacion_acumulada   NUMERIC(14,2) DEFAULT 0,
  hm_acumuladas            NUMERIC(14,2) DEFAULT 0,           -- horas-máquina totales
  hm_proximo_mant          NUMERIC(14,2),                     -- mantenimiento programado
  estado                   TEXT CHECK (estado IN (
                             'operativo','mantenimiento','reparacion','baja'
                           )) DEFAULT 'operativo',
  obra_actual_id           UUID REFERENCES obras(id),         -- dónde está ahora
  company_id               UUID REFERENCES companies(id),     -- empresa propietaria
  operador_principal_id    UUID REFERENCES personal(id),
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

CREATE INDEX IF NOT EXISTS idx_ap_obra   ON activos_pesados(obra_actual_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ap_estado ON activos_pesados(estado) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ap_placa  ON activos_pesados(placa) WHERE deleted_at IS NULL;

-- Hora-máquina (parte diario por equipo)
CREATE TABLE IF NOT EXISTS horas_maquina (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  activo_id           UUID NOT NULL REFERENCES activos_pesados(id) ON DELETE CASCADE,
  obra_id             UUID NOT NULL REFERENCES obras(id),
  partida_id          UUID REFERENCES partidas(id),
  fecha               DATE NOT NULL DEFAULT CURRENT_DATE,
  horas_trabajadas    NUMERIC(6,2) NOT NULL CHECK (horas_trabajadas >= 0),
  hm_inicial          NUMERIC(14,2),                            -- horómetro inicial
  hm_final            NUMERIC(14,2),                            -- horómetro final
  operador_id         UUID REFERENCES personal(id),
  actividad           TEXT,
  observaciones       TEXT,
  version             INTEGER DEFAULT 1 NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at          TIMESTAMPTZ,
  created_by          UUID REFERENCES auth.users(id),
  updated_by          UUID REFERENCES auth.users(id),
  idempotency_key     TEXT UNIQUE,
  last_synced_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hm_activo ON horas_maquina(activo_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hm_obra   ON horas_maquina(obra_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hm_fecha  ON horas_maquina(fecha DESC);

-- Combustible
CREATE TABLE IF NOT EXISTS consumos_combustible (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  activo_id           UUID NOT NULL REFERENCES activos_pesados(id) ON DELETE CASCADE,
  obra_id             UUID REFERENCES obras(id),
  fecha               DATE NOT NULL DEFAULT CURRENT_DATE,
  galones             NUMERIC(10,2) NOT NULL,
  precio_galon        NUMERIC(10,4),
  total               NUMERIC(14,2),
  surtidor            TEXT,                                  -- grifo / surtidor
  operador_id         UUID REFERENCES personal(id),
  hm_actuales         NUMERIC(14,2),
  observaciones       TEXT,
  version             INTEGER DEFAULT 1 NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at          TIMESTAMPTZ,
  created_by          UUID REFERENCES auth.users(id),
  updated_by          UUID REFERENCES auth.users(id),
  idempotency_key     TEXT UNIQUE,
  last_synced_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cc_activo ON consumos_combustible(activo_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cc_fecha  ON consumos_combustible(fecha DESC);

-- Mantenimientos (preventivo y correctivo)
CREATE TABLE IF NOT EXISTS mantenimientos_maquinaria (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  activo_id           UUID NOT NULL REFERENCES activos_pesados(id) ON DELETE CASCADE,
  fecha               DATE NOT NULL DEFAULT CURRENT_DATE,
  tipo                TEXT CHECK (tipo IN ('preventivo','correctivo')) DEFAULT 'preventivo',
  hm_actuales         NUMERIC(14,2),
  descripcion         TEXT NOT NULL,
  costo_repuestos     NUMERIC(14,2) DEFAULT 0,
  costo_mano_obra     NUMERIC(14,2) DEFAULT 0,
  costo_total         NUMERIC(14,2) DEFAULT 0,
  taller              TEXT,                              -- propio o externo
  mecanico            TEXT,
  duracion_horas      NUMERIC(6,2),                       -- tiempo fuera de servicio
  observaciones       TEXT,
  version             INTEGER DEFAULT 1 NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at          TIMESTAMPTZ,
  created_by          UUID REFERENCES auth.users(id),
  updated_by          UUID REFERENCES auth.users(id),
  idempotency_key     TEXT UNIQUE,
  last_synced_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mm_activo ON mantenimientos_maquinaria(activo_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mm_fecha  ON mantenimientos_maquinaria(fecha DESC);

-- ── RLS + Triggers ──────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'cuentas_bancarias','movimientos_bancarios','cronograma_pagos',
    'activos_pesados','horas_maquina','consumos_combustible','mantenimientos_maquinaria'
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

-- ── Vista: costo por hora-máquina por activo ────────────────────────
CREATE OR REPLACE VIEW v_activos_costo_hora AS
SELECT
  a.id AS activo_id,
  a.codigo, a.nombre, a.tipo, a.estado,
  COALESCE(SUM(hm.horas_trabajadas), 0) AS hm_acumuladas,
  COALESCE(SUM(cc.total), 0) AS combustible_total,
  COALESCE(SUM(mm.costo_total), 0) AS mantenimiento_total,
  COALESCE(a.depreciacion_acumulada, 0) AS depreciacion,
  CASE
    WHEN COALESCE(SUM(hm.horas_trabajadas), 0) > 0
    THEN (COALESCE(SUM(cc.total),0) + COALESCE(SUM(mm.costo_total),0) + COALESCE(a.depreciacion_acumulada,0))
         / SUM(hm.horas_trabajadas)
    ELSE 0
  END AS costo_por_hora
FROM activos_pesados a
LEFT JOIN horas_maquina hm           ON hm.activo_id = a.id AND hm.deleted_at IS NULL
LEFT JOIN consumos_combustible cc    ON cc.activo_id = a.id AND cc.deleted_at IS NULL
LEFT JOIN mantenimientos_maquinaria mm ON mm.activo_id = a.id AND mm.deleted_at IS NULL
WHERE a.deleted_at IS NULL
GROUP BY a.id, a.codigo, a.nombre, a.tipo, a.estado, a.depreciacion_acumulada;

ALTER VIEW v_activos_costo_hora SET (security_invoker = true);
GRANT SELECT ON v_activos_costo_hora TO authenticated;
