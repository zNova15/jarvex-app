-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — EPPs como base separada
--
-- Hasta hoy los EPPs se mezclaban con materiales. Razón: el almacenero
-- los registra cuando llegan compras grandes (cascos, guantes, arneses).
-- Pero los EPPs requieren control distinto:
--   - Vida útil normada (R.M. 050-2013-TR): casco 1 año, guantes 15 días.
--   - Salida con firma del trabajador (registro físico SUNAFIL).
--   - Talla por unidad (no hay "stock total" significativo).
--
-- Tablas nuevas:
--   - `epps`: inventario (paralelo a `materiales`)
--   - `movimientos_epp`: ingreso/salida con firma_url
--
-- Mantenemos `epp_entregas` (asignación a trabajador) como flujo paralelo
-- para no romper datos viejos.
-- ═══════════════════════════════════════════════════════════════════

-- ── Tabla epps (inventario) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.epps (
  id              UUID PRIMARY KEY,
  obra_id         UUID REFERENCES public.obras(id) ON DELETE SET NULL,
  ubicacion_id    UUID REFERENCES public.ubicaciones_obra(id) ON DELETE SET NULL,
  nombre_epp      TEXT NOT NULL,
  tipo_epp        TEXT NOT NULL,         -- Casco, Guantes, Arnés, Lentes, Botas, Mascarilla, Chaleco, Auriculares, Tapones, Otro
  marca           TEXT,
  modelo          TEXT,
  talla           TEXT,                  -- S, M, L, XL, 38, 40, 42…
  vida_util_dias  INTEGER,               -- referencial; ver lib/epp-utils.js CATALOGO_EPP
  unidad          TEXT DEFAULT 'Und',
  stock_inicial   NUMERIC(12,2) DEFAULT 0,
  stock_actual    NUMERIC(12,2) DEFAULT 0,
  stock_minimo    NUMERIC(12,2) DEFAULT 0,
  precio_unitario_estimado NUMERIC(12,2),
  proveedor_principal_id UUID REFERENCES public.proveedores(id) ON DELETE SET NULL,
  alerta          TEXT DEFAULT 'ok',     -- ok | cerca | reponer | critico | agotado | sin_stock
  estado          TEXT DEFAULT 'activo', -- activo | suspendido
  observaciones   TEXT,
  -- Sync metadata (igual a materiales)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id),
  version         INTEGER DEFAULT 1,
  idempotency_key TEXT UNIQUE,
  -- Si el EPP nació de un material (migración desde catálogo materiales),
  -- guardamos el material_id origen para trazabilidad.
  material_origen_id UUID REFERENCES public.materiales(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_epps_obra        ON public.epps(obra_id);
CREATE INDEX IF NOT EXISTS idx_epps_ubicacion   ON public.epps(ubicacion_id);
CREATE INDEX IF NOT EXISTS idx_epps_tipo        ON public.epps(tipo_epp);
CREATE INDEX IF NOT EXISTS idx_epps_alerta      ON public.epps(alerta);
CREATE INDEX IF NOT EXISTS idx_epps_deleted_at  ON public.epps(deleted_at);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.epps_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_epps_updated_at ON public.epps;
CREATE TRIGGER trg_epps_updated_at
  BEFORE UPDATE ON public.epps
  FOR EACH ROW EXECUTE FUNCTION public.epps_set_updated_at();

-- ── Tabla movimientos_epp ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.movimientos_epp (
  id              UUID PRIMARY KEY,
  obra_id         UUID NOT NULL REFERENCES public.obras(id) ON DELETE CASCADE,
  epp_id          UUID NOT NULL REFERENCES public.epps(id) ON DELETE CASCADE,
  fecha           DATE NOT NULL DEFAULT current_date,
  hora            TIME,
  tipo_movimiento TEXT NOT NULL,         -- entrada | salida | reposicion | descarte
  cantidad        NUMERIC(12,2) NOT NULL,
  unidad          TEXT,
  -- Salida: trabajador que recibe + firma. Entrada: proveedor + documento.
  personal_id     UUID REFERENCES public.personal(id) ON DELETE SET NULL,
  proveedor_id    UUID REFERENCES public.proveedores(id) ON DELETE SET NULL,
  documento_asociado TEXT,
  precio_unitario_real NUMERIC(12,2),
  motivo          TEXT,                  -- inicial | reposicion | cambio | perdida | dotacion | descarte
  -- Firma del trabajador en la salida (URL al storage de Supabase). Para
  -- registros físicos exigidos por SUNAFIL. Puede ser null si todavía no
  -- se subió (offline) o si el flujo es ingreso.
  firma_url       TEXT,
  observaciones   TEXT,
  -- Sync metadata
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id),
  version         INTEGER DEFAULT 1,
  idempotency_key TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_movepp_obra      ON public.movimientos_epp(obra_id);
CREATE INDEX IF NOT EXISTS idx_movepp_epp       ON public.movimientos_epp(epp_id);
CREATE INDEX IF NOT EXISTS idx_movepp_personal  ON public.movimientos_epp(personal_id);
CREATE INDEX IF NOT EXISTS idx_movepp_fecha     ON public.movimientos_epp(fecha DESC);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.movimientos_epp_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_movepp_updated_at ON public.movimientos_epp;
CREATE TRIGGER trg_movepp_updated_at
  BEFORE UPDATE ON public.movimientos_epp
  FOR EACH ROW EXECUTE FUNCTION public.movimientos_epp_set_updated_at();

-- ── RLS — mismo patrón que materiales (USING true para authenticated) ──
ALTER TABLE public.epps             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimientos_epp  ENABLE ROW LEVEL SECURITY;

-- epps
DROP POLICY IF EXISTS "epps_select_all"  ON public.epps;
DROP POLICY IF EXISTS "epps_insert_auth" ON public.epps;
DROP POLICY IF EXISTS "epps_update_auth" ON public.epps;
DROP POLICY IF EXISTS "epps_delete_admin" ON public.epps;
CREATE POLICY "epps_select_all"  ON public.epps FOR SELECT TO authenticated USING (true);
CREATE POLICY "epps_insert_auth" ON public.epps FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "epps_update_auth" ON public.epps FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "epps_delete_admin" ON public.epps FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.rol = 'admin')
);

-- movimientos_epp
DROP POLICY IF EXISTS "movepp_select_all"  ON public.movimientos_epp;
DROP POLICY IF EXISTS "movepp_insert_auth" ON public.movimientos_epp;
DROP POLICY IF EXISTS "movepp_update_auth" ON public.movimientos_epp;
DROP POLICY IF EXISTS "movepp_delete_admin" ON public.movimientos_epp;
CREATE POLICY "movepp_select_all"  ON public.movimientos_epp FOR SELECT TO authenticated USING (true);
CREATE POLICY "movepp_insert_auth" ON public.movimientos_epp FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "movepp_update_auth" ON public.movimientos_epp FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "movepp_delete_admin" ON public.movimientos_epp FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.rol = 'admin')
);

-- ── Realtime — habilitar en publication ──────────────────────────────
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.epps;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.movimientos_epp;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
