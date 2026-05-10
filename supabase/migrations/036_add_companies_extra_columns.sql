-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Agregar columnas faltantes a companies
--
-- Causa: el formulario de Empresa en jx-contabilidad.jsx setea 10
-- campos que NO existen en la tabla companies del server. PostgREST
-- devuelve PGRST204 'Could not find the actividades_economicas column'
-- y la empresa nunca llega al server (Sentry JARVEX-APP-8 evento 3).
--
-- Estas columnas representan datos completos de la empresa para SUNAT
-- y operación: contacto, régimen tributario, margen objetivo, etc.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS rubro                  TEXT,
  ADD COLUMN IF NOT EXISTS rol_grupo              TEXT,
  ADD COLUMN IF NOT EXISTS regimen_tributario     TEXT,
  ADD COLUMN IF NOT EXISTS margen_objetivo_pct    NUMERIC,
  ADD COLUMN IF NOT EXISTS direccion              TEXT,
  ADD COLUMN IF NOT EXISTS telefono               TEXT,
  ADD COLUMN IF NOT EXISTS email                  TEXT,
  ADD COLUMN IF NOT EXISTS representante_legal    TEXT,
  ADD COLUMN IF NOT EXISTS inicio_actividades     DATE,
  ADD COLUMN IF NOT EXISTS actividades_economicas JSONB DEFAULT '[]'::jsonb;

-- Forzar reload del schema cache de PostgREST.
NOTIFY pgrst, 'reload schema';
