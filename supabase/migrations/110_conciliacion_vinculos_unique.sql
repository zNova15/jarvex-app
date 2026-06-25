-- 110: evita vínculos duplicados EXACTOS (mismo ítem de factura → mismo insumo) que
-- descuadrarían el "facturado". Permite N-M (1 ítem → varios insumos, varios ítems → 1 insumo).
CREATE UNIQUE INDEX IF NOT EXISTS uq_concil_vinc_item_insumo
  ON public.conciliacion_vinculos (accounting_movement_id, item_idx, insumo_codigo)
  WHERE deleted_at IS NULL;
