-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Caja Chica (Almacén)
--
-- Fondo de dinero que maneja la almacenera para compras urgentes que no
-- pasan por el flujo de requisición/OC. Es un libro de movimientos:
--   • entrada = reposición/asignación de fondo (le dan plata)
--   • salida  = gasto (compró algo urgente)
-- El saldo actual = Σ(entradas) − Σ(salidas).
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.caja_chica_movimientos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id         UUID NOT NULL REFERENCES public.obras(id) ON DELETE CASCADE,
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  hora            TIME,
  tipo_movimiento TEXT NOT NULL CHECK (tipo_movimiento IN ('entrada','salida')),
  monto           NUMERIC NOT NULL CHECK (monto >= 0),
  concepto        TEXT,                 -- "Reposición de fondo" / "Compra urgente de …"
  responsable_id  UUID REFERENCES public.personal(id),  -- quién recibe/gasta (almacenera)
  proveedor       TEXT,                 -- a quién se le compró (texto libre)
  documento_asociado TEXT,              -- boleta/factura nro
  observaciones   TEXT,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID,
  updated_by      UUID,
  idempotency_key TEXT UNIQUE,
  last_synced_at  TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  reverses_id     UUID,
  reversed_by_id  UUID
);

CREATE INDEX IF NOT EXISTS idx_caja_chica_obra ON public.caja_chica_movimientos (obra_id, fecha);

ALTER TABLE public.caja_chica_movimientos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS caja_chica_all ON public.caja_chica_movimientos;
CREATE POLICY caja_chica_all ON public.caja_chica_movimientos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.caja_chica_movimientos;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE public.caja_chica_movimientos IS
  'Caja chica de almacén: entradas (reposición de fondo) y salidas (gastos urgentes). Saldo = Σ entradas − Σ salidas.';

NOTIFY pgrst, 'reload schema';
