-- 161 — Flag manual "¿esta factura requiere guía de remisión?" (pedido de las
-- contadoras 31-ago, autorizado por Gabriel). Aditiva, patrón mig 147.
--
-- null         → decide la heurística (tiene ítems que NO son servicios)
-- 'no_requiere'→ la contadora marcó que NO lleva guía (sale de la lista para siempre)
-- 'requiere'   → forzada a la lista aunque la heurística diga que no
--
-- Sin índice ni cambio de Dexie/SyncEngine: el push manda el registro entero y
-- el pull baja la fila completa (select('*') y RPC sync_pull con to_jsonb).
-- APLICAR ANTES de deployar el código que la escribe (si no, PGRST204 al push).
ALTER TABLE accounting_movements ADD COLUMN IF NOT EXISTS guia_estado text;

NOTIFY pgrst, 'reload schema';
