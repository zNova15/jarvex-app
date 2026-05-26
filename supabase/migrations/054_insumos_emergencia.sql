-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Insumos de Emergencia (SSOMA / Seguridad)
--
-- Inventario propio de insumos de emergencia (botiquín, extintores,
-- camillas, etc.) con su unidad y stock, separado de Materiales/EPP.
-- Lleva su catálogo + movimientos de entrada/salida (igual patrón que
-- Materiales: stock_actual = Σ entradas − Σ salidas).
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.insumos_emergencia (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id         UUID NOT NULL REFERENCES public.obras(id) ON DELETE CASCADE,
  nombre          TEXT NOT NULL,
  categoria       TEXT,
  unidad          TEXT NOT NULL DEFAULT 'Und',
  stock_inicial   NUMERIC DEFAULT 0,
  stock_actual    NUMERIC DEFAULT 0,
  stock_minimo    NUMERIC DEFAULT 0,
  alerta          TEXT DEFAULT 'ok',
  estado          TEXT DEFAULT 'activo',
  vencimiento     DATE,                 -- algunos insumos de emergencia caducan
  observaciones   TEXT,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID,
  updated_by      UUID,
  idempotency_key TEXT UNIQUE,
  last_synced_at  TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_insumos_emerg_obra ON public.insumos_emergencia (obra_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.movimientos_insumos_emergencia (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id               UUID NOT NULL REFERENCES public.obras(id) ON DELETE CASCADE,
  insumo_emergencia_id  UUID NOT NULL REFERENCES public.insumos_emergencia(id) ON DELETE CASCADE,
  fecha                 DATE NOT NULL DEFAULT CURRENT_DATE,
  hora                  TIME,
  tipo_movimiento       TEXT NOT NULL CHECK (tipo_movimiento IN ('entrada','salida')),
  cantidad              NUMERIC NOT NULL,
  unidad                TEXT,
  responsable_id        UUID REFERENCES public.personal(id),
  proveedor_id          UUID REFERENCES public.proveedores(id),
  documento_asociado    TEXT,
  frente_zona           TEXT,
  observaciones         TEXT,
  version               INTEGER NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            UUID,
  updated_by            UUID,
  idempotency_key       TEXT UNIQUE,
  last_synced_at        TIMESTAMPTZ,
  deleted_at            TIMESTAMPTZ,
  reverses_id           UUID,
  reversed_by_id        UUID
);

CREATE INDEX IF NOT EXISTS idx_mov_insumos_emerg_obra ON public.movimientos_insumos_emergencia (obra_id);
CREATE INDEX IF NOT EXISTS idx_mov_insumos_emerg_item ON public.movimientos_insumos_emergencia (insumo_emergencia_id);

ALTER TABLE public.insumos_emergencia ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS insumos_emergencia_all ON public.insumos_emergencia;
CREATE POLICY insumos_emergencia_all ON public.insumos_emergencia
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.movimientos_insumos_emergencia ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mov_insumos_emergencia_all ON public.movimientos_insumos_emergencia;
CREATE POLICY mov_insumos_emergencia_all ON public.movimientos_insumos_emergencia
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.insumos_emergencia;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.movimientos_insumos_emergencia;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE public.insumos_emergencia IS
  'Inventario de insumos de emergencia (botiquín, extintores, etc.) con stock por cantidad. Movimientos en movimientos_insumos_emergencia.';

NOTIFY pgrst, 'reload schema';
