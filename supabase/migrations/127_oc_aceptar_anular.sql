-- ═══════════════════════════════════════════════════════════════════
-- 127 — Órdenes de Compra: aceptación (desde requisición) + anulación.
--
-- Arregla bugs latentes que rompían la sync HOY:
--  · estado no incluía 'por_confirmar' ni 'firmada' (que confirmarOC y la
--    subida de OC firmada escriben) → esas OCs fallaban el push.
--  · el código de cancelarOC escribía motivo_cancelacion/cancelado_por/
--    cancelado_at, columnas inexistentes → PostgREST rechazaba el update.
--
-- Agrega el modelo de anulación con motivo (dinámica pedida por Gabriel:
-- "puede ocurrir que las órdenes se anulen").
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS requisicion_codigo text;
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS motivo_anulacion text;
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS anulado_por uuid;
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS anulado_at timestamptz;
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS confirmada_at timestamptz;
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS confirmada_por uuid;
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS firmada_at timestamptz;
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS firmada_por uuid;
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS oc_firmada_evidencia_id uuid;

ALTER TABLE ordenes_compra DROP CONSTRAINT IF EXISTS ordenes_compra_estado_check;
ALTER TABLE ordenes_compra ADD CONSTRAINT ordenes_compra_estado_check CHECK (estado = ANY (ARRAY[
  'borrador','por_confirmar','firmada','enviada','aceptada',
  'recibida_parcial','recibida','anulada','cancelada'
]));

-- oc_items: guardar el tipo de insumo y el nombre para no depender solo de material_id.
ALTER TABLE oc_items ADD COLUMN IF NOT EXISTS tipo_insumo text NOT NULL DEFAULT 'material';
ALTER TABLE oc_items ADD COLUMN IF NOT EXISTS insumo_id uuid;
ALTER TABLE oc_items ADD COLUMN IF NOT EXISTS insumo_pendiente_id uuid;
ALTER TABLE oc_items ADD COLUMN IF NOT EXISTS nombre text;
ALTER TABLE oc_items ADD COLUMN IF NOT EXISTS requisicion_item_id uuid;

NOTIFY pgrst, 'reload schema';
