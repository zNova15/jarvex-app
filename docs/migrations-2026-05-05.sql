-- ─────────────────────────────────────────────────────────────────────
-- JARVEX — Migración 2026-05-05
--
-- Crea las tablas que ya existen en Dexie (cliente IndexedDB) pero faltan
-- en Supabase remoto. Sin esto, los users ven errores 404 en consola al
-- hacer sync.
--
-- Tablas:
--   1. ubicaciones_obra (catálogo per-obra de zonas físicas)
--   2. trazabilidad_cadenas (cadenas de transferencia intercompany)
--   3. accounting_movements: agrega columnas chain_id + chain_step_index
--      (sin esto, las facturas internas no se sincronizan)
--   4. recepciones / recepcion_items: añade columnas extra que el cliente
--      empezó a guardar (factura_ref, accounting_movement_id, etc.) por
--      compatibilidad. Solo si esas tablas ya existen.
--
-- Cómo correrlo:
--   1. Supabase Dashboard → SQL Editor → New query
--   2. Pegá TODO este archivo
--   3. RUN
--
-- Es idempotente: usa CREATE TABLE IF NOT EXISTS y ADD COLUMN IF NOT EXISTS.
-- Podés ejecutarlo varias veces sin riesgo.
-- ─────────────────────────────────────────────────────────────────────


-- 1) ubicaciones_obra ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ubicaciones_obra (
  id uuid PRIMARY KEY,
  obra_id uuid NOT NULL,
  nombre text NOT NULL,
  descripcion text,
  orden integer DEFAULT 0,
  activo boolean DEFAULT true,
  -- Auditoría/sync estándar
  created_by uuid,
  updated_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  version integer DEFAULT 1,
  sync_status text,
  last_synced_at timestamptz,
  idempotency_key text,
  deleted_at timestamptz,
  demo boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_ubicaciones_obra_obra_id ON public.ubicaciones_obra (obra_id);
CREATE INDEX IF NOT EXISTS idx_ubicaciones_obra_activo ON public.ubicaciones_obra (activo);

-- RLS
ALTER TABLE public.ubicaciones_obra ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ubicaciones_obra: select autenticado" ON public.ubicaciones_obra;
CREATE POLICY "ubicaciones_obra: select autenticado"
  ON public.ubicaciones_obra FOR SELECT
  TO authenticated
  USING (deleted_at IS NULL);

DROP POLICY IF EXISTS "ubicaciones_obra: insert autenticado" ON public.ubicaciones_obra;
CREATE POLICY "ubicaciones_obra: insert autenticado"
  ON public.ubicaciones_obra FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "ubicaciones_obra: update autenticado" ON public.ubicaciones_obra;
CREATE POLICY "ubicaciones_obra: update autenticado"
  ON public.ubicaciones_obra FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "ubicaciones_obra: admin elimina" ON public.ubicaciones_obra;
CREATE POLICY "ubicaciones_obra: admin elimina"
  ON public.ubicaciones_obra FOR DELETE
  TO authenticated
  USING ((SELECT rol FROM public.profiles WHERE id = auth.uid()) = 'admin');


-- 2) trazabilidad_cadenas ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trazabilidad_cadenas (
  id uuid PRIMARY KEY,
  obra_id uuid NOT NULL,
  fecha date,
  -- Resumen agregado de items[] para retrocompatibilidad
  item_nombre text,
  cantidad numeric,
  unidad text,
  precio_real_unitario numeric,
  precio_referencial_contrato numeric,
  proveedor_externo_nombre text,
  proveedor_externo_ruc text,
  -- Multi-items + cadena (JSON)
  items jsonb DEFAULT '[]'::jsonb,
  eslabones jsonb DEFAULT '[]'::jsonb,
  ejecutora_company_id uuid,
  -- Comprobante origen que originó la cadena (movimiento contable)
  comprobante_origen_id uuid,
  estado text DEFAULT 'borrador',
  notas text,
  -- Auditoría/sync estándar
  created_by uuid,
  updated_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  version integer DEFAULT 1,
  sync_status text,
  last_synced_at timestamptz,
  idempotency_key text,
  deleted_at timestamptz,
  demo boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_trazabilidad_obra_id ON public.trazabilidad_cadenas (obra_id);
CREATE INDEX IF NOT EXISTS idx_trazabilidad_estado ON public.trazabilidad_cadenas (estado);
CREATE INDEX IF NOT EXISTS idx_trazabilidad_ejecutora ON public.trazabilidad_cadenas (ejecutora_company_id);

ALTER TABLE public.trazabilidad_cadenas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trazabilidad_cadenas: select autenticado" ON public.trazabilidad_cadenas;
CREATE POLICY "trazabilidad_cadenas: select autenticado"
  ON public.trazabilidad_cadenas FOR SELECT
  TO authenticated
  USING (deleted_at IS NULL);

DROP POLICY IF EXISTS "trazabilidad_cadenas: insert autenticado" ON public.trazabilidad_cadenas;
CREATE POLICY "trazabilidad_cadenas: insert autenticado"
  ON public.trazabilidad_cadenas FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "trazabilidad_cadenas: update autenticado" ON public.trazabilidad_cadenas;
CREATE POLICY "trazabilidad_cadenas: update autenticado"
  ON public.trazabilidad_cadenas FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "trazabilidad_cadenas: admin elimina" ON public.trazabilidad_cadenas;
CREATE POLICY "trazabilidad_cadenas: admin elimina"
  ON public.trazabilidad_cadenas FOR DELETE
  TO authenticated
  USING ((SELECT rol FROM public.profiles WHERE id = auth.uid()) = 'admin');


-- 3) accounting_movements: columnas para facturas internas ─────────
-- Estas ya existían en Dexie pero faltaban en Supabase server.
ALTER TABLE public.accounting_movements
  ADD COLUMN IF NOT EXISTS chain_id uuid;
ALTER TABLE public.accounting_movements
  ADD COLUMN IF NOT EXISTS chain_step_index integer;
ALTER TABLE public.accounting_movements
  ADD COLUMN IF NOT EXISTS factura_interna_meta jsonb;
ALTER TABLE public.accounting_movements
  ADD COLUMN IF NOT EXISTS estado_factura text;
ALTER TABLE public.accounting_movements
  ADD COLUMN IF NOT EXISTS orden_compra_id uuid;
ALTER TABLE public.accounting_movements
  ADD COLUMN IF NOT EXISTS proveedor_id uuid;

CREATE INDEX IF NOT EXISTS idx_acc_mov_chain_id ON public.accounting_movements (chain_id);


-- 4) intercompany_transactions: columna chain_id ───────────────────
ALTER TABLE public.intercompany_transactions
  ADD COLUMN IF NOT EXISTS chain_id uuid;

CREATE INDEX IF NOT EXISTS idx_ictx_chain_id ON public.intercompany_transactions (chain_id);


-- 5) recepciones / recepcion_items: columnas extra (sin romper si no existe la tabla)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='recepciones') THEN
    ALTER TABLE public.recepciones ADD COLUMN IF NOT EXISTS guia_remision text;
    ALTER TABLE public.recepciones ADD COLUMN IF NOT EXISTS factura_ref text;
    ALTER TABLE public.recepciones ADD COLUMN IF NOT EXISTS accounting_movement_id uuid;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='recepcion_items') THEN
    ALTER TABLE public.recepcion_items ADD COLUMN IF NOT EXISTS material_id uuid;
    ALTER TABLE public.recepcion_items ADD COLUMN IF NOT EXISTS precio_unitario_factura numeric;
    ALTER TABLE public.recepcion_items ADD COLUMN IF NOT EXISTS diferencia_precio_pct numeric;
    ALTER TABLE public.recepcion_items ADD COLUMN IF NOT EXISTS observaciones text;
  END IF;
END $$;


-- 6) materiales / herramientas / activos_pesados: ubicacion_id ─────
ALTER TABLE public.materiales        ADD COLUMN IF NOT EXISTS ubicacion_id uuid;
ALTER TABLE public.herramientas      ADD COLUMN IF NOT EXISTS ubicacion_id uuid;
ALTER TABLE public.activos_pesados   ADD COLUMN IF NOT EXISTS ubicacion_id uuid;

CREATE INDEX IF NOT EXISTS idx_materiales_ubicacion       ON public.materiales (ubicacion_id);
CREATE INDEX IF NOT EXISTS idx_herramientas_ubicacion     ON public.herramientas (ubicacion_id);
CREATE INDEX IF NOT EXISTS idx_activos_pesados_ubicacion  ON public.activos_pesados (ubicacion_id);


-- 7) evidencias: blob_ref para evidencias compartidas (factura → OC) ─
ALTER TABLE public.evidencias
  ADD COLUMN IF NOT EXISTS blob_ref uuid;


-- ─────────────────────────────────────────────────────────────────────
-- DONE. Verificá con:
--   SELECT * FROM pg_policies WHERE schemaname = 'public'
--     AND tablename IN ('ubicaciones_obra', 'trazabilidad_cadenas')
--     ORDER BY tablename, cmd;
-- ─────────────────────────────────────────────────────────────────────
