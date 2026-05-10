-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Agregar columnas faltantes a accounting_movements
--
-- Sentry JARVEX-APP-8/E (release jarvex@94a4667):
-- PGRST204 'Could not find the obra_id column of accounting_movements'.
--
-- El cliente envía 4 columnas que el server no tiene:
--   - obra_id          → vincular un mov contable a una obra
--   - proveedor_id     → vincular a proveedor (cuenta por pagar)
--   - orden_compra_id  → vincular a una OC (cierre del ciclo de compra)
--   - cuenta_pcge      → código del Plan Contable General Empresarial
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.accounting_movements
  ADD COLUMN IF NOT EXISTS obra_id          UUID,
  ADD COLUMN IF NOT EXISTS proveedor_id     UUID,
  ADD COLUMN IF NOT EXISTS orden_compra_id  UUID,
  ADD COLUMN IF NOT EXISTS cuenta_pcge      TEXT;

-- FKs opcionales (si las tablas existen). Sin CASCADE — si se borra
-- la obra/proveedor/OC, el mov contable queda con la ref nula pero
-- el monto sigue auditable.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'obras')
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                     WHERE table_schema = 'public'
                       AND table_name = 'accounting_movements'
                       AND constraint_name = 'accounting_movements_obra_id_fkey') THEN
    ALTER TABLE public.accounting_movements
      ADD CONSTRAINT accounting_movements_obra_id_fkey
      FOREIGN KEY (obra_id) REFERENCES public.obras(id) ON DELETE SET NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'proveedores')
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                     WHERE table_schema = 'public'
                       AND table_name = 'accounting_movements'
                       AND constraint_name = 'accounting_movements_proveedor_id_fkey') THEN
    ALTER TABLE public.accounting_movements
      ADD CONSTRAINT accounting_movements_proveedor_id_fkey
      FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id) ON DELETE SET NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'ordenes_compra')
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                     WHERE table_schema = 'public'
                       AND table_name = 'accounting_movements'
                       AND constraint_name = 'accounting_movements_orden_compra_id_fkey') THEN
    ALTER TABLE public.accounting_movements
      ADD CONSTRAINT accounting_movements_orden_compra_id_fkey
      FOREIGN KEY (orden_compra_id) REFERENCES public.ordenes_compra(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Índices útiles para queries frecuentes (filtrar por obra, proveedor, OC)
CREATE INDEX IF NOT EXISTS idx_accounting_movements_obra_id
  ON public.accounting_movements(obra_id) WHERE obra_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_accounting_movements_proveedor_id
  ON public.accounting_movements(proveedor_id) WHERE proveedor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_accounting_movements_orden_compra_id
  ON public.accounting_movements(orden_compra_id) WHERE orden_compra_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
