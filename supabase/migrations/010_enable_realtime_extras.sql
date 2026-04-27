-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Realtime Extras
-- Habilita realtime para tablas críticas faltantes en 006_enable_realtime.sql
-- ═══════════════════════════════════════════════════════════════════

-- Movimientos de herramientas (entradas/salidas/devoluciones)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE movimientos_herramientas;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Asistencia diaria de personal
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE asistencia;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Solicitudes de cambio (admins reciben notificación al llegar nuevas)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE change_requests;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Asignaciones obra ↔ usuario (cambios afectan visibilidad RLS)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE obra_usuarios;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
