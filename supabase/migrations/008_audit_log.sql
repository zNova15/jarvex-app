-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Audit Log
-- Registro inmutable de quién modifica qué, cuándo y por qué.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  user_email  TEXT,
  action      TEXT NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  table_name  TEXT NOT NULL,
  record_id   UUID,
  old_data    JSONB,
  new_data    JSONB,
  reason      TEXT
);

-- Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_audit_log_table_record
  ON audit_log (table_name, record_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_created
  ON audit_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_created
  ON audit_log (created_at DESC);

-- ── RLS ─────────────────────────────────────────────────────────────
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- SELECT: solo administradores pueden ver el log
DROP POLICY IF EXISTS "audit_log: solo admin lee" ON audit_log;
CREATE POLICY "audit_log: solo admin lee" ON audit_log
  FOR SELECT
  USING (is_admin());

-- INSERT: cualquier autenticado puede registrar logs propios
DROP POLICY IF EXISTS "audit_log: autenticado inserta propio" ON audit_log;
CREATE POLICY "audit_log: autenticado inserta propio" ON audit_log
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

-- UPDATE/DELETE: nadie. Los logs son inmutables. (No se crean policies.)
