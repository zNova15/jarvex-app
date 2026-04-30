-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migración 021 — Módulo Contabilidad                              ║
-- ║                                                                    ║
-- ║  Tablas:                                                           ║
-- ║   - companies (empresas del grupo: constructora, comercial, etc.) ║
-- ║   - accounting_movements (ingresos / costos / gastos por empresa) ║
-- ║   - intercompany_transactions (operaciones entre empresas)        ║
-- ║                                                                    ║
-- ║  Lógica clave:                                                    ║
-- ║   Cuando se registra una operación entre empresas (B vende a A),  ║
-- ║   el cliente crea 2 accounting_movements (uno income en B, uno    ║
-- ║   cost en A), ambos con is_intercompany=true y                    ║
-- ║   related_movement_id apuntando entre sí. La transacción se       ║
-- ║   guarda en intercompany_transactions con FKs a ambos movs.       ║
-- ║                                                                    ║
-- ║   El consolidado real RESTA los is_intercompany=true para evitar  ║
-- ║   contar dos veces.                                               ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ── COMPANIES ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT NOT NULL,
  legal_name      TEXT,
  ruc             TEXT,
  company_type    TEXT CHECK (company_type IN (
                    'constructora', 'comercial', 'servicios',
                    'maquinaria', 'inmobiliaria', 'otro'
                  )) DEFAULT 'otro',
  status          TEXT CHECK (status IN ('activa', 'inactiva')) DEFAULT 'activa',
  notas           TEXT,
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

CREATE INDEX IF NOT EXISTS idx_companies_status ON companies(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_companies_ruc    ON companies(ruc) WHERE deleted_at IS NULL;

-- ── ACCOUNTING_MOVEMENTS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounting_movements (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  date                DATE NOT NULL DEFAULT CURRENT_DATE,
  type                TEXT NOT NULL CHECK (type IN ('income', 'cost', 'expense')),
  category            TEXT,
  description         TEXT,
  amount              NUMERIC(14,2) NOT NULL,
  currency            TEXT DEFAULT 'PEN' CHECK (currency IN ('PEN', 'USD')),
  third_party_name    TEXT,           -- cliente o proveedor
  third_party_ruc     TEXT,
  payment_status      TEXT CHECK (payment_status IN ('pending', 'paid', 'cancelled')) DEFAULT 'pending',
  document_type       TEXT CHECK (document_type IN (
                        'factura', 'boleta', 'recibo', 'contrato',
                        'nota_credito', 'nota_debito', 'otro'
                      )),
  document_number     TEXT,
  file_url            TEXT,           -- path to file in storage
  is_intercompany     BOOLEAN DEFAULT false,
  related_company_id  UUID REFERENCES companies(id),
  related_movement_id UUID REFERENCES accounting_movements(id),
  notas               TEXT,
  -- estándar
  version             INTEGER DEFAULT 1 NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at          TIMESTAMPTZ,
  created_by          UUID REFERENCES auth.users(id),
  updated_by          UUID REFERENCES auth.users(id),
  idempotency_key     TEXT UNIQUE,
  last_synced_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_acc_mov_company       ON accounting_movements(company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_acc_mov_type          ON accounting_movements(type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_acc_mov_date          ON accounting_movements(date DESC);
CREATE INDEX IF NOT EXISTS idx_acc_mov_intercompany  ON accounting_movements(is_intercompany) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_acc_mov_related       ON accounting_movements(related_movement_id);

-- ── INTERCOMPANY_TRANSACTIONS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intercompany_transactions (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_company_id  UUID NOT NULL REFERENCES companies(id),
  buyer_company_id   UUID NOT NULL REFERENCES companies(id),
  date               DATE NOT NULL DEFAULT CURRENT_DATE,
  operation_type     TEXT CHECK (operation_type IN (
                       'materiales', 'servicio', 'alquiler',
                       'maquinaria', 'mano_obra', 'otro'
                     )) DEFAULT 'otro',
  description        TEXT,
  amount             NUMERIC(14,2) NOT NULL,
  currency           TEXT DEFAULT 'PEN' CHECK (currency IN ('PEN', 'USD')),
  document_type      TEXT,
  document_number    TEXT,
  payment_status     TEXT CHECK (payment_status IN ('pending', 'paid', 'cancelled')) DEFAULT 'pending',
  seller_movement_id UUID REFERENCES accounting_movements(id),
  buyer_movement_id  UUID REFERENCES accounting_movements(id),
  notas              TEXT,
  -- estándar
  version            INTEGER DEFAULT 1 NOT NULL,
  created_at         TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at         TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at         TIMESTAMPTZ,
  created_by         UUID REFERENCES auth.users(id),
  updated_by         UUID REFERENCES auth.users(id),
  idempotency_key    TEXT UNIQUE,
  last_synced_at     TIMESTAMPTZ,
  CHECK (seller_company_id != buyer_company_id)
);

CREATE INDEX IF NOT EXISTS idx_ic_seller ON intercompany_transactions(seller_company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ic_buyer  ON intercompany_transactions(buyer_company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ic_date   ON intercompany_transactions(date DESC);

-- ── RLS ──────────────────────────────────────────────────────────────
ALTER TABLE companies                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_movements       ENABLE ROW LEVEL SECURITY;
ALTER TABLE intercompany_transactions  ENABLE ROW LEVEL SECURITY;

-- companies
DROP POLICY IF EXISTS "comp: ve"        ON companies;
DROP POLICY IF EXISTS "comp: crea"      ON companies;
DROP POLICY IF EXISTS "comp: actualiza" ON companies;
DROP POLICY IF EXISTS "comp: elimina"   ON companies;
CREATE POLICY "comp: ve"        ON companies FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "comp: crea"      ON companies FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "comp: actualiza" ON companies FOR UPDATE USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "comp: elimina"   ON companies FOR DELETE USING (is_admin());

-- accounting_movements
DROP POLICY IF EXISTS "am: ve"        ON accounting_movements;
DROP POLICY IF EXISTS "am: crea"      ON accounting_movements;
DROP POLICY IF EXISTS "am: actualiza" ON accounting_movements;
DROP POLICY IF EXISTS "am: elimina"   ON accounting_movements;
CREATE POLICY "am: ve"        ON accounting_movements FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "am: crea"      ON accounting_movements FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "am: actualiza" ON accounting_movements FOR UPDATE USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "am: elimina"   ON accounting_movements FOR DELETE USING (is_admin());

-- intercompany_transactions
DROP POLICY IF EXISTS "ic: ve"        ON intercompany_transactions;
DROP POLICY IF EXISTS "ic: crea"      ON intercompany_transactions;
DROP POLICY IF EXISTS "ic: actualiza" ON intercompany_transactions;
DROP POLICY IF EXISTS "ic: elimina"   ON intercompany_transactions;
CREATE POLICY "ic: ve"        ON intercompany_transactions FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "ic: crea"      ON intercompany_transactions FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "ic: actualiza" ON intercompany_transactions FOR UPDATE USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "ic: elimina"   ON intercompany_transactions FOR DELETE USING (is_admin());

-- ── Triggers updated_at ──────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_companies_updated_at ON companies;
CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_acc_mov_updated_at ON accounting_movements;
CREATE TRIGGER trg_acc_mov_updated_at
  BEFORE UPDATE ON accounting_movements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_ic_updated_at ON intercompany_transactions;
CREATE TRIGGER trg_ic_updated_at
  BEFORE UPDATE ON intercompany_transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Vista de resumen contable por empresa ────────────────────────────
CREATE OR REPLACE VIEW v_company_resumen AS
SELECT
  c.id AS company_id,
  c.name,
  c.company_type,
  c.status,
  COALESCE(SUM(CASE WHEN m.type = 'income'  THEN m.amount END), 0) AS ingresos,
  COALESCE(SUM(CASE WHEN m.type = 'cost'    THEN m.amount END), 0) AS costos,
  COALESCE(SUM(CASE WHEN m.type = 'expense' THEN m.amount END), 0) AS gastos,
  COALESCE(SUM(CASE WHEN m.type = 'income'  AND m.is_intercompany THEN m.amount END), 0) AS ingresos_internos,
  COALESCE(SUM(CASE WHEN m.type = 'cost'    AND m.is_intercompany THEN m.amount END), 0) AS costos_internos,
  COALESCE(SUM(CASE WHEN m.payment_status = 'pending' AND m.type = 'income' THEN m.amount END), 0) AS por_cobrar,
  COALESCE(SUM(CASE WHEN m.payment_status = 'pending' AND m.type IN ('cost','expense') THEN m.amount END), 0) AS por_pagar,
  COUNT(m.id) AS movimientos
FROM companies c
LEFT JOIN accounting_movements m ON m.company_id = c.id AND m.deleted_at IS NULL
WHERE c.deleted_at IS NULL
GROUP BY c.id, c.name, c.company_type, c.status;

ALTER VIEW v_company_resumen SET (security_invoker = true);
GRANT SELECT ON v_company_resumen TO authenticated;
