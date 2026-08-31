-- 163 — OVERRIDE MANUAL de la clasificación costo/gasto (pedido de Gabriel,
-- 31-ago-2026, sobre el punto 4a).
--
-- La mig 162 dejó el tipo contable DERIVADO de la vinculación: obra → costo,
-- Gastos Generales → gasto. Es correcto el 95 % de las veces, pero hay casos
-- reales que la vinculación no puede expresar: una compra vinculada a una OBRA
-- que igual es un GASTO administrativo (útiles de oficina de la obra, atención
-- al cliente, comida de reunión). Antes la única forma de marcarla gasto era
-- desvincularla de la obra — y así se perdía la atribución a la obra.
--
-- null      → decide la derivación (clase + vinculación). Es el default.
-- 'cost'    → la contadora forzó COSTO
-- 'expense' → la contadora forzó GASTO
--
-- ⚠ La REGLA DURA sigue por encima de esto: un movimiento intercompany es
--   SIEMPRE 'cost' aunque tenga override (el Consolidado elimina las internas
--   sumando income+cost; si no, se evaporan de los dos lados). Ver
--   src/lib/clasificacion-contable.js.
-- ⚠ Tampoco aplica a las VENTAS: una venta es ingreso, no hay costo/gasto que
--   elegir.
--
-- Sin índice ni cambio de Dexie/SyncEngine: el push manda el registro entero y
-- el pull baja la fila completa (select('*') y RPC sync_pull con to_jsonb).
-- APLICAR ANTES de deployar el código que la escribe (si no, PGRST204 al push).
ALTER TABLE public.accounting_movements
  ADD COLUMN IF NOT EXISTS clasificacion_manual text;

ALTER TABLE public.accounting_movements
  DROP CONSTRAINT IF EXISTS acc_mov_clasificacion_manual_check;
ALTER TABLE public.accounting_movements
  ADD CONSTRAINT acc_mov_clasificacion_manual_check
  CHECK (clasificacion_manual IS NULL OR clasificacion_manual = ANY (ARRAY['cost'::text, 'expense'::text]));

COMMENT ON COLUMN public.accounting_movements.clasificacion_manual IS
  'Override manual costo/gasto. null = lo decide la vinculación (destino_contable). Los intercompany ignoran este campo: siempre cost.';

NOTIFY pgrst, 'reload schema';
