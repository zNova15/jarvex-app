-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Realtime para movimientos_materiales + tablas transaccionales
-- faltantes
--
-- Razón: el cliente (useRealtimeNotifications.js) ya escucha estas tablas,
-- pero algunas no estaban en la publication, así que los eventos nunca
-- llegaban. Resultado: el admin registraba un movimiento y el almacenero no
-- lo veía hasta el siguiente pull periódico (~60s).
--
-- Idempotente: cada ALTER en su DO $$ ... EXCEPTION para no romper si la
-- tabla ya está agregada por una migración anterior.
-- ═══════════════════════════════════════════════════════════════════

-- Movimientos de materiales (entrada/salida/devolución/ajuste)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE movimientos_materiales;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Evidencias (fotos de incidencias / avance / SSOMA)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE evidencias;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Avance de obra (ya estaba en 006 pero por si acaso)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE avance_obra;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Incidencias (ya estaba en 006 pero por si acaso)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE incidencias;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
