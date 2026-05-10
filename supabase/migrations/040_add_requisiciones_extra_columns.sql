-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Agregar columnas faltantes a requisiciones
--
-- Sentry JARVEX-APP-8 evento 9 (release jarvex@4929b36):
-- PGRST204 'Could not find the descripcion column of requisiciones'.
--
-- El cliente envía descripcion + solicitante_nombre + fecha_necesidad,
-- pero la tabla server solo tiene notas + solicitante_id + fecha_requerida.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.requisiciones
  ADD COLUMN IF NOT EXISTS descripcion         TEXT,
  ADD COLUMN IF NOT EXISTS solicitante_nombre  TEXT,
  ADD COLUMN IF NOT EXISTS fecha_necesidad     DATE;

NOTIFY pgrst, 'reload schema';
