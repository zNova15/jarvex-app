-- 109: Feature 4 "Conciliación Tripartita" — Vinculación 2 (Facturas ↔ Presupuesto).
-- Junction N-a-M: enlaza un ÍTEM de factura (accounting_movements.notas.items_factura[idx])
-- con un INSUMO PRESUPUESTADO (insumos_partida consolidado por insumo_codigo de Delfín).
-- La hace el equipo de contabilidad, resolviendo que el mismo insumo tiene nombres
-- distintos en cada fuente ("Clavo número 3" <-> "Clavo N3").
CREATE TABLE IF NOT EXISTS public.conciliacion_vinculos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id uuid NOT NULL REFERENCES public.obras(id),
  insumo_codigo text NOT NULL,            -- código Delfín del insumo presupuestado (clave de la maestra)
  insumo_nombre text,                     -- denormalizado para display
  accounting_movement_id uuid NOT NULL REFERENCES public.accounting_movements(id),
  item_idx integer,                       -- índice del ítem en notas.items_factura
  item_descripcion text,                  -- denormalizado (nombre del proveedor)
  cantidad numeric DEFAULT 0,             -- cantidad del ítem atribuida a este insumo
  precio_unitario numeric DEFAULT 0,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  version integer DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  idempotency_key text
);
CREATE INDEX IF NOT EXISTS idx_concil_vinc_obra ON public.conciliacion_vinculos(obra_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_concil_vinc_factura ON public.conciliacion_vinculos(accounting_movement_id);
CREATE INDEX IF NOT EXISTS idx_concil_vinc_codigo ON public.conciliacion_vinculos(obra_id, insumo_codigo);

-- version/updated_at automáticos (mismo trigger que accounting_movements → el sync hace write-back de version)
DROP TRIGGER IF EXISTS trg_concil_vinc_updated_at ON public.conciliacion_vinculos;
CREATE TRIGGER trg_concil_vinc_updated_at BEFORE UPDATE ON public.conciliacion_vinculos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- RLS permisiva (modelo app-enforced, como las demás tablas operativas).
ALTER TABLE public.conciliacion_vinculos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "conciliacion_vinculos: autenticado" ON public.conciliacion_vinculos;
CREATE POLICY "conciliacion_vinculos: autenticado" ON public.conciliacion_vinculos
  FOR ALL TO public
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
