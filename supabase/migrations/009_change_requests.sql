-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Change Requests
-- Solicitudes de cambio sobre registros que el usuario no-admin
-- detecta erróneos. El admin aprueba/rechaza con trazabilidad completa.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS change_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  requester_id          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  requester_email       TEXT,
  target_table          TEXT NOT NULL,
  target_record_id      UUID,
  target_record_label   TEXT,
  proposed_changes      JSONB NOT NULL,
  reason                TEXT NOT NULL CHECK (char_length(reason) >= 10),
  evidence_url          TEXT,
  status                TEXT NOT NULL DEFAULT 'pendiente'
                        CHECK (status IN ('pendiente', 'aprobada', 'rechazada', 'cancelada')),
  reviewer_id           UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reviewer_comment      TEXT,
  reviewed_at           TIMESTAMPTZ
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_change_requests_status_created
  ON change_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_change_requests_requester_created
  ON change_requests (requester_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_change_requests_target
  ON change_requests (target_table, target_record_id);

-- ── RLS ─────────────────────────────────────────────────────────────
ALTER TABLE change_requests ENABLE ROW LEVEL SECURITY;

-- SELECT: el solicitante ve sus propias requests; admin ve todas.
DROP POLICY IF EXISTS "change_requests: requester o admin lee" ON change_requests;
CREATE POLICY "change_requests: requester o admin lee" ON change_requests
  FOR SELECT
  USING (requester_id = auth.uid() OR is_admin());

-- INSERT: cualquier autenticado puede crear con status='pendiente' y requester_id = auth.uid().
DROP POLICY IF EXISTS "change_requests: autenticado inserta propio" ON change_requests;
CREATE POLICY "change_requests: autenticado inserta propio" ON change_requests
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND requester_id = auth.uid()
    AND status = 'pendiente'
  );

-- UPDATE: admin puede aprobar/rechazar; el solicitante puede cancelar
-- la propia request si sigue pendiente.
DROP POLICY IF EXISTS "change_requests: admin revisa o requester cancela" ON change_requests;
CREATE POLICY "change_requests: admin revisa o requester cancela" ON change_requests
  FOR UPDATE
  USING (
    is_admin()
    OR (requester_id = auth.uid() AND status = 'pendiente')
  )
  WITH CHECK (
    is_admin()
    OR (requester_id = auth.uid() AND status = 'cancelada')
  );

-- DELETE: nadie. Las solicitudes son auditables.
