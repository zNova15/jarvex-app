-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Fix sync de la migración histórica
--
-- Dos columnas/constraints faltaban tras 051/052/057:
--   • herramientas.stock_inicial: el importador histórico la enviaba pero
--     no se agregó en 051 → PGRST204 "Could not find the 'stock_inicial'
--     column of 'herramientas'". Aditiva, nullable con default 0.
--   • activos_pesados.tipo CHECK: solo admitía la enum específica
--     (excavadora/volquete/...). El importador setea 'maquinaria' o
--     'equipo' (porque el catálogo viene como "Maquinaria") → CHECK
--     violado. Se amplía la lista para incluir 'maquinaria' y 'equipo'.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.herramientas ADD COLUMN IF NOT EXISTS stock_inicial NUMERIC DEFAULT 0;

ALTER TABLE public.activos_pesados DROP CONSTRAINT IF EXISTS activos_pesados_tipo_check;
ALTER TABLE public.activos_pesados ADD CONSTRAINT activos_pesados_tipo_check
  CHECK (tipo IS NULL OR tipo = ANY (ARRAY[
    'excavadora','retroexcavadora','volquete','cargador','tractor','motoniveladora',
    'rodillo','grua','pavimentadora','bulldozer','camion',
    'maquinaria','equipo','otro'
  ]));

NOTIFY pgrst, 'reload schema';
