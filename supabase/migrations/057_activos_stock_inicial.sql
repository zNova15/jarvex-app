-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — activos_pesados.stock_inicial (fix sync PGRST204)
--
-- La migración 052 agregó stock_actual/stock_minimo a activos_pesados, pero
-- el importador histórico también enviaba `stock_inicial`, columna que no
-- existía → los movimientos de maquinaria por cantidad fallaban al pushear
-- ("Could not find the 'stock_inicial' column of 'activos_pesados'").
-- Se agrega la columna (aditiva, nullable) para destrabar esos registros.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.activos_pesados ADD COLUMN IF NOT EXISTS stock_inicial NUMERIC DEFAULT 0;

NOTIFY pgrst, 'reload schema';
