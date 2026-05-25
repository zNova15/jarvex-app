-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Maquinaria (Equipos Pesados): stock por cantidad + movimientos
--
-- `activos_pesados` es hoy 1-registro-por-máquina (placa/serie). Eso sirve
-- para volquetes/excavadoras con placa, pero la obra también mueve equipos
-- menores por cantidad (rotomartillos, vibradoras): "ingreso 3 vibradoras".
-- La migración histórica (SuperAdmin) necesita cargar esos movimientos.
--
-- Estrategia aditiva (igual que Herramientas en 051):
--   • activos_pesados.maneja_cantidad=true → equipo de cantidad (usa
--     stock_actual). false (default) → máquina con placa, flujo actual.
--   • Nueva tabla movimientos_maquinaria (espejo de movimientos_materiales).
--   • stock_ubicaciones suma 'maquinaria' a los item_tipo permitidos.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.activos_pesados
  ADD COLUMN IF NOT EXISTS stock_actual    NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stock_minimo    NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unidad          TEXT,
  ADD COLUMN IF NOT EXISTS maneja_cantidad BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS alerta          TEXT DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS obra_id         UUID;

CREATE TABLE IF NOT EXISTS public.movimientos_maquinaria (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id         UUID NOT NULL REFERENCES public.obras(id) ON DELETE CASCADE,
  activo_id       UUID NOT NULL REFERENCES public.activos_pesados(id) ON DELETE CASCADE,
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  hora            TIME,
  tipo_movimiento TEXT NOT NULL CHECK (tipo_movimiento IN ('entrada','salida')),
  cantidad        NUMERIC NOT NULL,
  unidad          TEXT,
  responsable_id  UUID REFERENCES public.personal(id),
  proveedor_id    UUID REFERENCES public.proveedores(id),
  estado          TEXT,
  frente_zona     TEXT,
  documento_asociado TEXT,
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

CREATE INDEX IF NOT EXISTS idx_mov_maq_obra   ON public.movimientos_maquinaria (obra_id);
CREATE INDEX IF NOT EXISTS idx_mov_maq_activo ON public.movimientos_maquinaria (activo_id);

-- RLS: misma política bulk-authenticated que el resto de tablas de obra.
ALTER TABLE public.movimientos_maquinaria ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mov_maquinaria_all ON public.movimientos_maquinaria;
CREATE POLICY mov_maquinaria_all ON public.movimientos_maquinaria
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- stock_ubicaciones: permitir el desglose de maquinaria.
ALTER TABLE public.stock_ubicaciones DROP CONSTRAINT IF EXISTS stock_ubicaciones_item_tipo_check;
ALTER TABLE public.stock_ubicaciones ADD CONSTRAINT stock_ubicaciones_item_tipo_check
  CHECK (item_tipo IN ('material','herramienta','epp','maquinaria'));

-- Realtime: que los movimientos se propaguen entre dispositivos.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.movimientos_maquinaria;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE public.movimientos_maquinaria IS
  'Ingresos/salidas de maquinaria/equipos por cantidad (activos_pesados.maneja_cantidad=true). Espejo de movimientos_materiales.';

NOTIFY pgrst, 'reload schema';
