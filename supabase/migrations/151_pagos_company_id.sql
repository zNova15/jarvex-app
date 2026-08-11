-- 151: empresa PAGADORA en pagos (pedido de la asistente: los recibos por
-- honorarios de un mismo trabajador pueden venir de empresas distintas del
-- grupo — ej. Luis con recibos de JADE y de CONSORCIO EL INCA — y estaban
-- todos mezclados). Column nullable: los pagos históricos quedan sin empresa
-- hasta que la asistente los clasifique desde la pestaña "Recibos".
-- (Aplicada por MCP el 11-ago-2026.)
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
CREATE INDEX IF NOT EXISTS idx_pagos_company ON pagos(company_id) WHERE deleted_at IS NULL;
NOTIFY pgrst, 'reload schema';
